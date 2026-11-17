'use strict';
/* Nous — serveur : plusieurs couples isolés, inscription sur invitation, données partagées à deux, fichiers, notifications push. */
const express = require('express');
const Database = require('better-sqlite3');
const argon2 = require('argon2');
const webpush = require('web-push');
const multer = require('multer');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const QUESTIONS = require('./public/questions.js');

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES = path.join(DATA, 'files');
const COOKIE_SECURE = process.env.COOKIE_SECURE !== '0';
const SESSION_DAYS = 90;
const MAX_FILE = 25 * 1024 * 1024;
const QUOTA = (+process.env.QUOTA_MB || 2048) * 1024 * 1024; // espace disque maximum par couple
const TZ = 'Europe/Paris';
// Villes proposées par défaut dans l'agenda d'un nouveau couple (chaque couple les change dans Réglages)
const CITIES = (process.env.NOUS_CITIES || 'Paris').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
const LOGIN_RE = /^[a-z0-9][a-z0-9.-]{1,29}$/; // pas de « _ » : il sert de séparateur dans les identifiants de documents
const TILES = path.join(DATA, 'tiles'); // cache des fonds de carte
fs.mkdirSync(FILES, { recursive: true }); fs.mkdirSync(TILES, { recursive: true });

const COLS = ['events', 'places', 'expenses', 'settlements', 'recurring', 'notes', 'folders', 'docfiles',
  'flats', 'answers', 'lists', 'items', 'wishes', 'countdowns', 'photos', 'wheel', 'profiles', 'moods', 'milestones', 'coupons', 'scheduled', 'cycles', 'trackers', 'tlogs', 'meals', 'chores', 'chorelog', 'pots', 'potins', 'trips', 'infos', 'disputes', 'defis', 'quiz', 'capsules', 'pokes', 'songs', 'poops', 'snaps', 'avent'];

/* ---------- base ---------- */
// Plusieurs couples dans une seule base : chaque donnée porte l'identifiant de son couple, et toute requête est filtrée dessus.
const db = new Database(path.join(DATA, 'nous.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS couples(id TEXT PRIMARY KEY, name TEXT, created INTEGER, rev INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL, pos INTEGER, couple TEXT, admin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS docs(couple TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, by TEXT, at INTEGER, PRIMARY KEY(couple, col, id));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT, mime TEXT, size INTEGER, by TEXT, at INTEGER, couple TEXT);
CREATE TABLE IF NOT EXISTS subs(endpoint TEXT PRIMARY KEY, user TEXT NOT NULL, sub TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, kind TEXT NOT NULL, couple TEXT, note TEXT, created_by TEXT, created INTEGER, expires INTEGER, used_by TEXT, used_at INTEGER);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS resets(id TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
`);
const getMeta = k => (db.prepare('SELECT v FROM meta WHERE k=?').get(k) || {}).v;
const setMeta = (k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
const colsOf = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);

// Migration d'une base à un seul couple (versions précédentes) : tout est rattaché au couple « c1 ».
db.transaction(() => {
  if (!colsOf('users').includes('couple')) { db.exec('ALTER TABLE users ADD COLUMN couple TEXT'); db.exec('ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0'); }
  if (!colsOf('files').includes('couple')) db.exec('ALTER TABLE files ADD COLUMN couple TEXT');
  let legacy = false;
  if (!colsOf('docs').includes('couple')) {
    legacy = true;
    db.exec(`CREATE TABLE docs2(couple TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, by TEXT, at INTEGER, PRIMARY KEY(couple, col, id));
      INSERT INTO docs2 SELECT 'c1', col, id, data, by, at FROM docs; DROP TABLE docs; ALTER TABLE docs2 RENAME TO docs;`);
  }
  const orphans = db.prepare('SELECT id, name FROM users WHERE couple IS NULL ORDER BY pos').all();
  if (orphans.length) {
    if (!db.prepare("SELECT 1 FROM couples WHERE id='c1'").get())
      db.prepare("INSERT INTO couples(id,name,created,rev) VALUES('c1',?,?,?)").run(orphans.map(u => u.name).join(' & '), Date.now(), +(getMeta('rev') || 1));
    db.prepare("UPDATE users SET couple='c1' WHERE couple IS NULL").run();
    legacy = true;
  }
  db.prepare("UPDATE files SET couple='c1' WHERE couple IS NULL").run();
  if (legacy) { // les villes de l'agenda du premier couple étaient fixées dans le code : on les garde
    const r = db.prepare("SELECT data FROM docs WHERE couple='c1' AND col='profiles' AND id='_couple'").get(), cp = r ? JSON.parse(r.data) : { id: '_couple', seeded: true };
    if (!cp.cities) { cp.cities = (process.env.NOUS_CITIES || 'Paris,Bordeaux,Gif-sur-Yvette').split(',').map(s => s.trim()).filter(Boolean); db.prepare("INSERT INTO docs(couple,col,id,data,by,at) VALUES('c1','profiles','_couple',?,?,?) ON CONFLICT(couple,col,id) DO UPDATE SET data=excluded.data").run(JSON.stringify(cp), cp.by || null, Date.now()); }
  }
  if (!db.prepare('SELECT 1 FROM users WHERE admin=1').get()) { // l'administrateur : ADMIN dans .env, sinon la première personne du premier couple
    const a = (process.env.ADMIN && db.prepare('SELECT id FROM users WHERE id=?').get(process.env.ADMIN)) || db.prepare("SELECT id FROM users WHERE couple='c1' ORDER BY pos LIMIT 1").get();
    if (a) db.prepare('UPDATE users SET admin=1 WHERE id=?').run(a.id);
  }
})();
if (!colsOf('users').includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT'); // adresse de récupération du mot de passe (facultative)
if (!colsOf('couples').includes('delete_at')) db.exec('ALTER TABLE couples ADD COLUMN delete_at INTEGER'); // suppression demandée par le couple
db.exec('CREATE INDEX IF NOT EXISTS files_couple ON files(couple); CREATE INDEX IF NOT EXISTS users_couple ON users(couple);');

const revs = new Map(db.prepare('SELECT id, rev FROM couples').all().map(c => [c.id, c.rev]));
const revOf = c => revs.get(c) || 1;
const bump = c => { const r = revOf(c) + 1; revs.set(c, r); db.prepare('UPDATE couples SET rev=? WHERE id=?').run(r, c); return r; };

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const usersOf = c => db.prepare('SELECT id, name FROM users WHERE couple=? ORDER BY pos').all(c);
const userById = id => db.prepare('SELECT id, name, couple, admin, email FROM users WHERE id=?').get(id);
const today = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // AAAA-MM-JJ
const hourNow = () => +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date());
const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;
const cleanEmail = s => String(s || '').trim().toLowerCase().slice(0, 254);
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);

/* ---------- clés push ---------- */
let vapid = getMeta('vapid') ? JSON.parse(getMeta('vapid')) : null;
if (!vapid) { vapid = webpush.generateVAPIDKeys(); setMeta('vapid', JSON.stringify(vapid)); }
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@kratox.fr', vapid.publicKey, vapid.privateKey);

async function pushTo(userId, payload) {
  const rows = db.prepare('SELECT endpoint, sub FROM subs WHERE user=?').all(userId);
  await Promise.all(rows.map(async r => {
    try { await webpush.sendNotification(JSON.parse(r.sub), JSON.stringify(payload), { TTL: 86400 }); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM subs WHERE endpoint=?').run(r.endpoint); }
  }));
  return rows.length;
}
const getDoc = (c, col, id) => { const r = db.prepare('SELECT data FROM docs WHERE couple=? AND col=? AND id=?').get(c, col, id); return r ? JSON.parse(r.data) : null; };
const allDocs = (c, col) => db.prepare('SELECT data FROM docs WHERE couple=? AND col=?').all(c, col).map(r => JSON.parse(r.data));
const saveDoc = (c, col, doc) => db.prepare('INSERT INTO docs(couple,col,id,data,by,at) VALUES(?,?,?,?,?,?) ON CONFLICT(couple,col,id) DO UPDATE SET data=excluded.data, at=excluded.at').run(c, col, doc.id, JSON.stringify(doc), doc.by || null, doc.at || Date.now());
const delDoc = (c, col, id) => db.prepare('DELETE FROM docs WHERE couple=? AND col=? AND id=?').run(c, col, id);
const wantsActivity = (c, uid) => (getDoc(c, 'profiles', uid) || {}).notifActivity !== false;

/* ---------- comptes initiaux (premier démarrage uniquement) ---------- */
async function initUsers() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const spec = (process.env.INIT_USERS || '').split(';').map(s => s.trim()).filter(Boolean);
  if (!spec.length) { console.warn('[nous] Aucun compte : définis INIT_USERS="identifiant:Prénom:motdepasse;…" au premier démarrage.'); return; }
  let pos = 0;
  db.prepare("INSERT OR IGNORE INTO couples(id,name,created,rev) VALUES('c1',?,?,1)").run(spec.map(s => s.split(':')[1]).join(' & '), Date.now());
  revs.set('c1', revs.get('c1') || 1);
  for (const s of spec.slice(0, 2)) {
    const [raw, name, ...rest] = s.split(':'); const id = String(raw || '').toLowerCase(), pwd = rest.join(':');
    if (!LOGIN_RE.test(id) || !name || pwd.length < 8) { console.warn('[nous] Compte ignoré (identifiant en minuscules, mot de passe de 8 caractères minimum) :', id); continue; }
    db.prepare("INSERT INTO users(id,name,hash,pos,couple,admin) VALUES(?,?,?,?,'c1',?)").run(id, cleanName(name), await argon2.hash(pwd, { type: argon2.argon2id }), pos, pos === 0 ? 1 : 0);
    pos++; console.log('[nous] Compte créé :', id);
  }
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'Permissions-Policy': 'geolocation=(self), microphone=(), camera=()' // la position ne sert qu'à la Caca map
  });
  next();
});
app.use(express.json({ limit: '1mb' }));

// Les cookies des autres services de *.kratox.fr arrivent aussi ici : on ne lit que le nôtre, sans jamais planter sur une valeur exotique.
const cookies = req => {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 'nous_s' && /^[a-f0-9]{64}$/.test(v)) out.nous_s = v;
  }
  return out;
};
function setSession(res, token) {
  const parts = ['nous_s=' + (token || ''), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + (token ? SESSION_DAYS * 86400 : 0)];
  if (COOKIE_SECURE) parts.push('Secure');
  res.set('Set-Cookie', parts.join('; '));
}
function auth(req, res, next) {
  const t = cookies(req).nous_s;
  const s = t && db.prepare('SELECT user, expires FROM sessions WHERE token=?').get(sha(t));
  if (!s || s.expires < Date.now()) return res.status(401).json({ error: 'Non connecté' });
  req.user = userById(s.user);
  if (!req.user || !req.user.couple) return res.status(401).json({ error: 'Non connecté' });
  req.c = req.user.couple; // le couple de la personne connectée : la seule portée de toutes ses requêtes
  next();
}
const adminOnly = (req, res, next) => req.user.admin ? next() : res.status(403).json({ error: 'Réservé à l\'administration' });
// Toute écriture doit porter l'en-tête X-Nous : un site tiers ne peut pas l'ajouter (protection CSRF).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Nous') !== '1') return res.status(403).json({ error: 'Requête refusée' });
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------- connexion ---------- */
const fails = new Map(); // clé -> {n, until}
const blocked = k => { const f = fails.get(k); return f && f.until > Date.now(); };
function fail(k) {
  const f = fails.get(k) || { n: 0, until: 0 };
  f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; }
  fails.set(k, f);
}
app.post('/api/login', async (req, res) => {
  const login = String(req.body.login || '').trim().toLowerCase(), pwd = String(req.body.password || '');
  const kIp = 'ip:' + req.ip, kUser = 'u:' + login;
  if (blocked(kIp) || blocked(kUser)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(login);
  let ok = false;
  try { ok = u ? await argon2.verify(u.hash, pwd) : (await argon2.hash(pwd), false); } catch (e) { ok = false; }
  if (!ok) { fail(kIp); fail(kUser); return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' }); }
  fails.delete(kUser);
  openSession(res, u.id);
  res.json({ ok: true });
});
function openSession(res, uid) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user,expires) VALUES(?,?,?)').run(sha(token), uid, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  setSession(res, token);
}

/* ---------- invitations et inscription ---------- */
// Un code d'invitation n'est conservé que sous forme d'empreinte : il n'apparaît en clair qu'une fois, à sa création.
const CODE_ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const newCode = () => Array.from(crypto.randomBytes(14), b => CODE_ABC[b % CODE_ABC.length]).join('');
function createInvite(kind, couple, by, note, days) {
  const code = newCode();
  db.prepare('INSERT INTO invites(id,kind,couple,note,created_by,created,expires) VALUES(?,?,?,?,?,?,?)').run(sha(code), kind, couple || null, cleanName(note) || null, by, Date.now(), Date.now() + days * 864e5);
  return code;
}
function findInvite(code) {
  if (!/^[a-z0-9]{10,20}$/.test(String(code || ''))) return null;
  const i = db.prepare('SELECT * FROM invites WHERE id=?').get(sha(code));
  if (!i || i.used_at || i.expires < Date.now()) return null;
  if (i.kind === 'partner' && db.prepare('SELECT COUNT(*) n FROM users WHERE couple=?').get(i.couple).n >= 2) return null;
  return i;
}
app.get('/api/invite/:code', (req, res) => {
  const k = 'ip:' + req.ip;
  if (blocked(k)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const i = findInvite(req.params.code);
  if (!i) { fail(k); return res.status(404).json({ error: 'Ce lien d\'invitation n\'est plus valable. Demande-en un nouveau.' }); }
  res.json({ kind: i.kind, partner: i.kind === 'partner' ? (usersOf(i.couple)[0] || {}).name : null });
});
app.post('/api/register', async (req, res) => {
  const k = 'ip:' + req.ip, b = req.body || {};
  if (blocked(k)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const login = String(b.login || '').trim().toLowerCase(), name = cleanName(b.name), pwd = String(b.password || '');
  if (!LOGIN_RE.test(login)) return res.status(400).json({ error: 'Identifiant : 2 à 30 caractères, lettres minuscules, chiffres, points ou tirets.' });
  if (!name) return res.status(400).json({ error: 'Indique ton prénom.' });
  if (pwd.length < 10) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 10 caractères.' });
  const email = cleanEmail(b.email);
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  const hash = await argon2.hash(pwd, { type: argon2.argon2id });
  let out;
  try {
    out = db.transaction(() => { // tout est revérifié dans la transaction : un lien ne peut servir qu'une fois
      const i = findInvite(b.code);
      if (!i) return { status: 404, error: 'Ce lien d\'invitation n\'est plus valable. Demande-en un nouveau.' };
      if (db.prepare('SELECT 1 FROM users WHERE id=?').get(login)) return { status: 409, error: 'Cet identifiant est déjà pris, choisis-en un autre.' };
      let couple = i.couple, pos = 1;
      if (i.kind === 'couple') { couple = 'c' + crypto.randomBytes(6).toString('hex'); pos = 0; db.prepare('INSERT INTO couples(id,name,created,rev) VALUES(?,?,?,1)').run(couple, name, Date.now()); revs.set(couple, 1); }
      else db.prepare('UPDATE couples SET name=? WHERE id=?').run(usersOf(couple).map(u => u.name).concat(name).join(' & '), couple);
      db.prepare('INSERT INTO users(id,name,hash,pos,couple,admin,email) VALUES(?,?,?,?,?,0,?)').run(login, name, hash, pos, couple, email || null);
      db.prepare('UPDATE invites SET used_by=?, used_at=? WHERE id=?').run(login, Date.now(), i.id);
      bump(couple);
      return { couple, kind: i.kind };
    })();
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Inscription impossible' }); }
  if (out.error) { if (out.status === 404) fail(k); return res.status(out.status).json({ error: out.error }); }
  if (out.kind === 'partner') for (const u of usersOf(out.couple)) if (u.id !== login) pushTo(u.id, { title: 'Nous 🎉', body: `${name} a rejoint votre espace.`, tag: 'join', url: '/' }).catch(() => {});
  openSession(res, login);
  res.json({ ok: true });
});
app.post('/api/partner-invite', auth, (req, res) => {
  if (usersOf(req.c).length >= 2) return res.status(400).json({ error: 'Votre espace est déjà complet.' });
  db.prepare("DELETE FROM invites WHERE kind='partner' AND couple=? AND used_at IS NULL").run(req.c);
  res.json({ code: createInvite('partner', req.c, req.user.id, null, 7), days: 7 });
});
app.post('/api/logout', (req, res) => {
  const t = cookies(req).nous_s;
  if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t));
  setSession(res, '');
  res.json({ ok: true });
});
app.post('/api/password', auth, async (req, res) => {
  const { old, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!(await argon2.verify(u.hash, String(old || '')))) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  if (String(next || '').length < 10) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 10 caractères' });
  db.prepare('UPDATE users SET hash=? WHERE id=?').run(await argon2.hash(String(next), { type: argon2.argon2id }), u.id);
  const cur = sha(cookies(req).nous_s);
  db.prepare('DELETE FROM sessions WHERE user=? AND token<>?').run(u.id, cur); // déconnecte les autres appareils
  res.json({ ok: true });
});

/* ---------- e-mails (mot de passe oublié) ---------- */
// SMTP configuré dans .env (Brevo : smtp-relay.brevo.com, port 587). Sans configuration, la récupération par e-mail est désactivée.
const APP_URL = (process.env.APP_URL || (process.env.DOMAIN ? 'https://' + process.env.DOMAIN : 'https://morgane.kratox.fr')).replace(/\/+$/, '');
const MAIL_FROM = process.env.MAIL_FROM || '';
const mailer = process.env.SMTP_HOST && MAIL_FROM ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587, secure: (+process.env.SMTP_PORT || 587) === 465,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
}) : null;
const escH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mailHtml(title, lines, btn) {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#e8edfb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0b1220">
<div style="max-width:480px;margin:0 auto;padding:32px 18px"><div style="background:#ffffff;border-radius:24px;padding:28px 24px;box-shadow:0 10px 36px rgba(40,60,120,.13)">
<div style="font-size:30px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(90deg,#0a7aff,#ff2d6f);-webkit-background-clip:text;background-clip:text;color:#0a7aff;-webkit-text-fill-color:transparent">Nous</div>
<h1 style="font-size:20px;margin:18px 0 10px">${escH(title)}</h1>
${lines.map(l => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px;color:rgba(11,18,32,.75)">${escH(l)}</p>`).join('')}
${btn ? `<p style="margin:22px 0 8px"><a href="${escH(btn[1])}" style="display:inline-block;background:#0a7aff;color:#fff;text-decoration:none;font-weight:650;padding:13px 22px;border-radius:999px">${escH(btn[0])}</a></p>
<p style="font-size:12px;color:rgba(11,18,32,.45);word-break:break-all">${escH(btn[1])}</p>` : ''}
</div><p style="font-size:12px;color:rgba(11,18,32,.45);text-align:center;margin-top:16px">Nous · l'app à deux</p></div></body></html>`;
}
async function sendMail(to, subject, title, lines, btn) {
  if (!mailer) throw new Error('E-mail non configuré');
  await mailer.sendMail({ from: MAIL_FROM, to, subject, text: [title, '', ...lines, btn ? '\n' + btn[0] + ' : ' + btn[1] : ''].join('\n'), html: mailHtml(title, lines, btn) });
}
app.post('/api/email', auth, async (req, res) => {
  const email = cleanEmail((req.body || {}).email);
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
  db.prepare('UPDATE users SET email=? WHERE id=?').run(email || null, req.user.id);
  let sent = false;
  if (email && mailer) { try { await sendMail(email, 'Ton adresse est enregistrée sur Nous', `C'est noté, ${req.user.name} ✨`, ['Cette adresse servira uniquement à recevoir un lien si tu oublies ton mot de passe.', 'Si tu n\'es pas à l\'origine de ce changement, ignore ce message.']); sent = true; } catch (e) { console.error('[nous] e-mail :', e.message); } }
  res.json({ ok: true, sent });
});
// Toujours la même réponse, qu'un compte existe ou non : on ne révèle pas qui utilise l'app.
const FORGOT_OK = 'Si un compte correspond et qu\'il a une adresse e-mail, un lien vient d\'y être envoyé. Pense à regarder dans les spams.';
app.post('/api/forgot', async (req, res) => {
  const k = 'fg:' + req.ip;
  if (blocked(k)) return res.status(429).json({ error: 'Trop de demandes. Réessaie dans 15 minutes.' });
  fail(k); // 5 demandes par quart d'heure et par adresse IP
  if (!mailer) return res.status(503).json({ error: 'La récupération par e-mail n\'est pas encore activée. Demande à l\'administrateur de réinitialiser ton mot de passe.' });
  const who = String((req.body || {}).who || '').trim().toLowerCase().slice(0, 254);
  if (!who) return res.status(400).json({ error: 'Indique ton identifiant ou ton adresse e-mail' });
  const us = db.prepare('SELECT id, name, email FROM users WHERE (id=? OR email=?) AND email IS NOT NULL').all(who, who);
  for (const u of us) {
    if (!cooled('forgot:' + u.id, 5 * 60e3)) continue; // un e-mail toutes les 5 minutes au plus par compte
    const code = crypto.randomBytes(24).toString('hex');
    db.prepare('DELETE FROM resets WHERE user=? OR expires < ?').run(u.id, Date.now());
    db.prepare('INSERT INTO resets(id,user,expires) VALUES(?,?,?)').run(sha(code), u.id, Date.now() + 3600e3);
    sendMail(u.email, 'Nouveau mot de passe pour Nous', `Bonjour ${u.name},`, [`Tu as demandé à changer le mot de passe du compte « ${u.id} ».`, 'Le lien ci-dessous est valable une heure et ne sert qu\'une fois. Si tu n\'as rien demandé, ignore cet e-mail : ton mot de passe actuel reste valable.'], ['Choisir un nouveau mot de passe', `${APP_URL}/?reinit=${code}`])
      .catch(e => console.error('[nous] e-mail :', e.message));
  }
  res.json({ ok: true, message: FORGOT_OK });
});
const findReset = code => { if (!/^[a-f0-9]{48}$/.test(String(code || ''))) return null; const r = db.prepare('SELECT * FROM resets WHERE id=?').get(sha(code)); return r && r.expires > Date.now() ? r : null; };
app.get('/api/reset/:code', (req, res) => {
  const k = 'ip:' + req.ip;
  if (blocked(k)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const r = findReset(req.params.code);
  if (!r) { fail(k); return res.status(404).json({ error: 'Ce lien a expiré ou a déjà servi. Refais une demande depuis l\'écran de connexion.' }); }
  const u = userById(r.user); res.json({ name: u ? u.name : '', login: r.user });
});
app.post('/api/reset', async (req, res) => {
  const k = 'ip:' + req.ip, b = req.body || {};
  if (blocked(k)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const r = findReset(b.code);
  if (!r) { fail(k); return res.status(404).json({ error: 'Ce lien a expiré ou a déjà servi. Refais une demande depuis l\'écran de connexion.' }); }
  if (String(b.password || '').length < 10) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 10 caractères' });
  db.prepare('UPDATE users SET hash=? WHERE id=?').run(await argon2.hash(String(b.password), { type: argon2.argon2id }), r.user);
  db.prepare('DELETE FROM resets WHERE user=?').run(r.user);
  db.prepare('DELETE FROM sessions WHERE user=?').run(r.user); // déconnecte tous les appareils
  fails.delete('u:' + r.user);
  openSession(res, r.user);
  res.json({ ok: true });
});

/* ---------- export et suppression de son espace ---------- */
// Zip sans compression écrit au fil de l'eau (les photos sont déjà compressées) : pas de fichier temporaire, mémoire constante.
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf, c = 0) => { c = ~c; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
function zipWriter(out) {
  const entries = []; let offset = 0;
  const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const write = buf => new Promise((ok, ko) => { offset += buf.length; if (out.write(buf)) ok(); else { out.once('drain', ok); out.once('close', () => ko(new Error('closed'))); } });
  return {
    async add(name, source) { // source : Buffer, ou chemin d'un fichier lu par morceaux
      const nb = Buffer.from(name, 'utf8'), start = offset;
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0808, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosT, 10); lh.writeUInt16LE(dosD, 12); lh.writeUInt16LE(nb.length, 26);
      await write(lh); await write(nb);
      let crc = 0, sz = 0;
      if (Buffer.isBuffer(source)) { crc = crc32(source); sz = source.length; await write(source); }
      else for await (const chunk of fs.createReadStream(source, { highWaterMark: 256 * 1024 })) { crc = crc32(chunk, crc); sz += chunk.length; await write(chunk); }
      const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(sz, 8); dd.writeUInt32LE(sz, 12); await write(dd);
      entries.push({ nb, crc, sz, start });
    },
    async end() {
      const cdStart = offset;
      for (const e of entries) {
        const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0808, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(dosT, 12); c.writeUInt16LE(dosD, 14);
        c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.sz, 20); c.writeUInt32LE(e.sz, 24); c.writeUInt16LE(e.nb.length, 28); c.writeUInt32LE(e.start, 42);
        await write(c); await write(e.nb);
      }
      const z = Buffer.alloc(22); z.writeUInt32LE(0x06054b50, 0); z.writeUInt16LE(entries.length, 8); z.writeUInt16LE(entries.length, 10); z.writeUInt32LE(offset - cdStart, 12); z.writeUInt32LE(cdStart, 16);
      await write(z); out.end();
    }
  };
}
const HEX32 = /\b[a-f0-9]{32}\b/g;
// Ce que la personne voit dans l'app, et rien de plus : les contenus privés de l'autre (cycle, compteurs, mots programmés,
// cases de l'Avent pas encore ouvertes, instant pas encore débloqué) ne sortent pas dans son export.
function visibleData(c, me) {
  const parsed = db.prepare('SELECT col, data FROM docs WHERE couple=?').all(c).map(r => [r.col, JSON.parse(r.data), r.data]);
  const mine = new Set(parsed.filter(([k, d]) => k === 'answers' && d.user === me).map(([, d]) => d.date));
  const hiddenT = new Set(parsed.filter(([k, d]) => k === 'trackers' && d.by !== me && (d.vis || 'private') === 'private').map(([, d]) => d.id));
  const sharers = new Set(parsed.filter(([k, d]) => k === 'profiles' && d.shareCycle === true).map(([, d]) => d.id));
  const mySnaps = new Set(parsed.filter(([k, d]) => k === 'snaps' && d.user === me).map(([, d]) => d.date));
  const cols = {}, seen = new Set(), secret = new Set();
  for (const [k, d, raw] of parsed) {
    if (!COLS.includes(k)) continue;
    const v = viewFor(k, d, me, mine, sharers, hiddenT, mySnaps);
    if (!v || v.hidden || v.sealed) { for (const m of raw.match(HEX32) || []) secret.add(m); continue; }
    (cols[k] = cols[k] || []).push(v);
    for (const m of JSON.stringify(v).match(HEX32) || []) seen.add(m);
  }
  for (const id of seen) secret.delete(id);
  return { cols, secret };
}
app.get('/api/export', auth, async (req, res) => {
  if (!cooled('export:' + req.user.id, 60e3)) return res.status(429).json({ error: 'Un export par minute au maximum' });
  const C = req.c, me = req.user.id, t = today();
  const { cols, secret } = visibleData(C, me);
  const files = db.prepare('SELECT * FROM files WHERE couple=? ORDER BY at').all(C).filter(f => /^[a-f0-9]{32}$/.test(f.id) && !secret.has(f.id) && fs.existsSync(path.join(FILES, f.id)));
  const used = new Set(), map = {};
  const safe = s => String(s || 'fichier').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'fichier';
  for (const f of files) {
    let base = `fichiers/${today(new Date(f.at || Date.now()))} ${safe(f.name)}`, p = base, i = 2;
    const dot = base.lastIndexOf('.');
    while (used.has(p.toLowerCase())) p = dot > 8 ? `${base.slice(0, dot)} (${i++})${base.slice(dot)}` : `${base} (${i++})`;
    used.add(p.toLowerCase()); map[f.id] = p;
  }
  const root = `Nous - export ${t}/`;
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="nous-export-${t}.zip"`, 'Cache-Control': 'no-store' });
  const z = zipWriter(res);
  try {
    await z.add(root + 'LISEZ-MOI.txt', Buffer.from([
      `Export de votre espace Nous, fait par ${req.user.name} le ${t}.`, '',
      '- donnees.json : tout ce que tu vois dans l\'app (agenda, comptes, mots, listes, etc.), au format JSON.',
      '- fichiers.json : à quel fichier du dossier « fichiers » correspond chaque identifiant cité dans donnees.json.',
      '- fichiers/ : vos photos, documents et instants.', '',
      'Les contenus encore privés de ton ou ta partenaire (suivi du cycle non partagé, compteurs privés, mots programmés,',
      'cases du calendrier de l\'Avent pas encore ouvertes…) ne figurent pas dans cet export.'].join('\r\n'), 'utf8'));
    await z.add(root + 'donnees.json', Buffer.from(JSON.stringify({ app: 'Nous', exportedAt: new Date().toISOString(), by: { id: me, name: req.user.name }, users: usersOf(C), collections: cols }, null, 2), 'utf8'));
    await z.add(root + 'fichiers.json', Buffer.from(JSON.stringify(Object.fromEntries(files.map(f => [f.id, { path: map[f.id], name: f.name, mime: f.mime, size: f.size, by: f.by, at: f.at && new Date(f.at).toISOString() }])), null, 2), 'utf8'));
    for (const f of files) await z.add(root + map[f.id], path.join(FILES, f.id));
    await z.end();
  } catch (e) { if (e.message !== 'closed') console.error('[nous] export :', e.message); res.destroy(); }
});
function deleteCouple(c) {
  const files = db.prepare('SELECT id FROM files WHERE couple=?').all(c);
  db.transaction(() => {
    for (const u of usersOf(c)) for (const t of ['sessions', 'subs', 'resets']) db.prepare(`DELETE FROM ${t} WHERE user=?`).run(u.id);
    for (const t of ['docs', 'files', 'users']) db.prepare(`DELETE FROM ${t} WHERE couple=?`).run(c);
    db.prepare('DELETE FROM invites WHERE couple=?').run(c);
    db.prepare('DELETE FROM couples WHERE id=?').run(c);
    db.prepare('DELETE FROM meta WHERE k LIKE ? OR k LIKE ?').run(`snap:${c}:%`, `snapsent:${c}:%`);
  })();
  for (const f of files) if (/^[a-f0-9]{32}$/.test(f.id)) fs.unlink(path.join(FILES, f.id), () => {});
  revs.delete(c);
  console.log('[nous] Espace supprimé :', c);
}
const DELETE_DELAY = 72 * 3600e3; // à deux, la suppression attend 3 jours : chacun peut l'annuler
const hasAdmin = c => !!db.prepare('SELECT 1 FROM users WHERE couple=? AND admin=1').get(c);
app.post('/api/space/delete', auth, async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  let ok = false; try { ok = await argon2.verify(u.hash, String((req.body || {}).password || '')); } catch (e) { }
  if (!ok) return res.status(400).json({ error: 'Mot de passe incorrect' });
  if (hasAdmin(req.c)) return res.status(400).json({ error: 'L\'espace de l\'administrateur ne peut pas être supprimé depuis l\'app.' });
  const others = usersOf(req.c).filter(x => x.id !== u.id);
  if (!others.length) { deleteCouple(req.c); setSession(res, ''); return res.json({ ok: true, deleted: true }); }
  const at = Date.now() + DELETE_DELAY;
  db.prepare('UPDATE couples SET delete_at=? WHERE id=?').run(at, req.c); bump(req.c);
  const when = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  for (const o of others) pushTo(o.id, { title: 'Nous ⚠️', body: `${u.name} a demandé la suppression de votre espace, prévue ${when}. Tu peux l'annuler dans Réglages.`, tag: 'suppression', url: '/#reglages' }).catch(() => {});
  res.json({ ok: true, deleteAt: at });
});
app.post('/api/space/cancel', auth, (req, res) => {
  db.prepare('UPDATE couples SET delete_at=NULL WHERE id=?').run(req.c); bump(req.c);
  for (const o of usersOf(req.c)) if (o.id !== req.user.id) pushTo(o.id, { title: 'Nous 💗', body: `${req.user.name} a annulé la suppression de votre espace.`, tag: 'suppression', url: '/' }).catch(() => {});
  res.json({ ok: true });
});
setInterval(() => { try { for (const { id } of db.prepare('SELECT id FROM couples WHERE delete_at IS NOT NULL AND delete_at < ?').all(Date.now())) if (!hasAdmin(id)) deleteCouple(id); } catch (e) { console.error(e); } }, 5 * 60e3);

/* ---------- sauvegarde automatique de la base (chaque nuit vers 4 h, 14 jours gardés) ---------- */
const BACKUPS = path.join(DATA, 'backups');
async function nightlyBackup() {
  const t = today();
  if (hourNow() < 4 || getMeta('backup') === t) return;
  setMeta('backup', t);
  fs.mkdirSync(BACKUPS, { recursive: true });
  await db.backup(path.join(BACKUPS, `nous-${t}.db`));
  setMeta('backupAt', Date.now());
  for (const f of fs.readdirSync(BACKUPS)) if (/^nous-\d{4}-\d{2}-\d{2}\.db$/.test(f) && f < `nous-${today(new Date(Date.now() - 14 * 864e5))}.db`) fs.unlinkSync(path.join(BACKUPS, f));
  console.log('[nous] Sauvegarde de la base :', t);
}
setInterval(() => nightlyBackup().catch(e => console.error('[nous] sauvegarde :', e.message)), 10 * 60e3);
setTimeout(() => nightlyBackup().catch(e => console.error('[nous] sauvegarde :', e.message)), 60e3);

/* ---------- données ---------- */
// Calendrier de l'Avent : la case n de l'année A s'ouvre le n décembre de A (heure de Paris).
const AV_ID = /^(\d{4})-(\d{2})_([a-z0-9][a-z0-9.-]{1,29})$/;
const aventDate = d => `${d.year}-12-${String(d.day).padStart(2, '0')}`;
const AV_KINDS = ['mot', 'photo', 'bon', 'defi'];
// Ce que chacun a le droit de voir : pas la réservation de ses propres envies, pas la réponse de l'autre avant d'avoir répondu.
function viewFor(col, doc, me, mine, sharers, hiddenT, mySnaps) {
  // Instant du jour : la photo de l'autre reste cachée tant qu'on n'a pas posté la sienne ce jour-là
  if (col === 'snaps' && doc.user !== me && !(mySnaps && mySnaps.has(doc.date))) return { id: doc.id, date: doc.date, user: doc.user, by: doc.by, at: doc.at, when: doc.when, onTime: doc.onTime, hidden: true };
  if (col === 'avent' && doc.by !== me && !doc.openedAt && aventDate(doc) > today()) return { id: doc.id, year: doc.year, day: doc.day, by: doc.by, at: doc.at, hidden: true }; // case de l'Avent : fermée jusqu'à son jour
  if (col === 'wishes' && doc.owner === me) { const d = { ...doc }; delete d.reservedBy; return d; }
  if (col === 'answers' && doc.user !== me && !mine.has(doc.date)) return { id: doc.id, date: doc.date, user: doc.user, by: doc.by, at: doc.at, hidden: true };
  if (col === 'scheduled' && doc.by !== me) return null;
  if (col === 'quiz' && doc.about !== me && !doc.guess) { const d = { ...doc }; delete d.answer; return d; } // réponse cachée tant qu'on n'a pas deviné
  if (col === 'capsules' && doc.by !== me && doc.openAt > today()) { const d = { ...doc, sealed: true }; delete d.text; return d; } // capsule scellée
  if (col === 'trackers' && hiddenT && hiddenT.has(doc.id)) return null; // compteur privé de l'autre
  if (col === 'tlogs' && hiddenT && hiddenT.has(doc.tracker)) return null;
  if (col === 'cycles' && doc.by !== me && !(sharers && sharers.has(doc.by))) return null; // suivi du cycle : privé tant que son auteur ne le partage pas // un mot programmé reste secret jusqu'à l'heure
  return doc;
}
app.get('/api/sync', auth, (req, res) => {
  const rev = revOf(req.c);
  const snapAt = snapSignalFor(req.c);
  if (+req.query.rev === rev) return res.json({ same: true, rev, v: VERSION, snapAt });
  const me = req.user.id, cols = {};
  const rows = db.prepare('SELECT col, data FROM docs WHERE couple=?').all(req.c);
  const parsed = rows.map(r => [r.col, JSON.parse(r.data)]);
  const mine = new Set(parsed.filter(([c, d]) => c === 'answers' && d.user === me).map(([, d]) => d.date));
  for (const c of COLS) cols[c] = {};
  const hiddenT = new Set(parsed.filter(([c, d]) => c === 'trackers' && d.by !== me && (d.vis || 'private') === 'private').map(([, d]) => d.id));
  const sharers = new Set(parsed.filter(([c, d]) => c === 'profiles' && d.shareCycle === true).map(([, d]) => d.id));
  const mySnaps = new Set(parsed.filter(([c, d]) => c === 'snaps' && d.user === me).map(([, d]) => d.date));
  for (const [c, d] of parsed) if (cols[c]) { const v = viewFor(c, d, me, mine, sharers, hiddenT, mySnaps); if (v) cols[c][d.id] = v; }
  res.json({ rev, me: { id: me, name: req.user.name, admin: !!req.user.admin, email: req.user.email || '' }, users: usersOf(req.c), cols, vapid: vapid.publicKey, today: today(), v: VERSION, cities: CITIES, snapAt, mail: !!mailer, adminSpace: hasAdmin(req.c), deleteAt: (db.prepare('SELECT delete_at d FROM couples WHERE id=?').get(req.c) || {}).d || null });
});

const lastPing = new Map();
const cooled = (k, ms) => { const t = lastPing.get(k) || 0; if (Date.now() - t < ms) return false; lastPing.set(k, Date.now()); return true; };
const dm = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const FLAT_ST = { repere: 'Repéré', contacte: 'Contacté', visite: 'Visite prévue', dossier: 'Dossier envoyé', accepte: 'Accepté 🎉', refuse: 'Refusé' };

function notify(c, col, doc, prev, user) {
  const users = () => usersOf(c), getD = (col2, id) => getDoc(c, col2, id);
  const others = users().filter(u => u.id !== user.id);
  const send = (p, always) => others.forEach(o => { if (always || wantsActivity(c, o.id)) pushTo(o.id, p).catch(() => {}); });
  const n = user.name;
  if (col === 'notes' && !prev) return send({ title: n + ' 💌', body: String(doc.text || '').slice(0, 300), tag: 'mot-' + doc.id, url: '/#mots' }, true);
  if (col === 'events' && !prev && cooled('ev:' + user.id, 60e3)) return send({ title: 'Agenda', body: `${n} a ajouté « ${doc.title} » le ${dm(doc.date)}`, tag: 'agenda', url: '/#agenda' });
  if (col === 'expenses' && !prev && !String(doc.id).startsWith('r_')) return send({ title: 'Comptes', body: `${n} a ajouté ${doc.label} (${(+doc.amount || 0).toFixed(2).replace('.', ',')} €)`, tag: 'comptes', url: '/#comptes' });
  if (col === 'settlements' && !prev) return send({ title: 'Comptes', body: `${n} a régularisé les comptes ✅`, tag: 'comptes', url: '/#comptes' });
  if (col === 'flats') {
    if (!prev) return send({ title: 'Appart', body: `${n} a repéré : ${doc.title}`, tag: 'flat-' + doc.id, url: '/#appart' });
    if (prev.status !== doc.status) return send({ title: 'Appart', body: `${doc.title} → ${FLAT_ST[doc.status] || doc.status}`, tag: 'flat-' + doc.id, url: '/#appart' });
  }
  if (col === 'answers' && !prev) {
    return others.forEach(o => {
      if (!wantsActivity(c, o.id)) return;
      const done = getD('answers', doc.date + '_' + o.id);
      pushTo(o.id, { title: 'Question du jour', body: done ? `${n} a répondu, viens voir vos réponses 👀` : `${n} a répondu. À toi !`, tag: 'question', url: '/#question' }).catch(() => {});
    });
  }
  if (col === 'snaps') {
    if (!prev) return others.forEach(o => { const has = getD('snaps', `${doc.date}_${o.id}`); pushTo(o.id, { title: `📸 ${n} a posté son instant`, body: has ? 'Viens voir !' : 'Poste le tien pour le voir 👀', tag: 'instant', url: '/' }).catch(() => {}); });
    const r = (doc.reactions || {})[user.id];
    if (r && r !== (prev.reactions || {})[user.id]) return pushTo(prev.user, { title: 'Instant du jour', body: `${n} a réagi ${r} à ton instant`, tag: 'instant', url: '/#instants' }).catch(() => {});
    return;
  }
  if (col === 'poops' && !prev && cooled('poop:' + user.id, 60e3)) return send({ title: `💩 ${n}`, body: `${n} vient de poser une pêche${doc.rating ? ' · ' + '★'.repeat(doc.rating) : ''}${doc.place ? ' · ' + doc.place : ''}`, tag: 'caca', url: '/#caca' });
  if (col === 'pokes' && cooled('poke:' + user.id, 15e3)) return send({ title: `${n} pense à toi 💗`, body: doc.n > 1 ? `Déjà ${doc.n} fois aujourd'hui` : 'Juste comme ça.', tag: 'poke', url: '/' }, true);
  if (col === 'trips') {
    if (!prev) return send({ title: 'Trajets', body: `${n} a ajouté un trajet ${doc.from} → ${doc.to} le ${dm(doc.date)}`, tag: 'trajet', url: '/#trajets' });
    if (!prev.arrivedAt && doc.arrivedAt) return send({ title: 'Bien arrivé 🚄', body: `${n} est bien arrivé à ${doc.to}`, tag: 'trajet', url: '/#trajets' }, true);
  }
  if (col === 'disputes') {
    if (!prev) return send({ title: 'Tribunal ⚖️', body: `${n} ouvre une affaire : ${doc.title}`, tag: 'trib-' + doc.id, url: '/#tribunal' });
    if (!prev.winner && doc.winner) return send({ title: 'Verdict ⚖️', body: `${(users().find(u => u.id === doc.winner) || {}).name || '?'} a raison : ${doc.title}`, tag: 'trib-' + doc.id, url: '/#tribunal' });
  }
  if (col === 'quiz') {
    if (!prev) return send({ title: 'Quiz 🎯', body: `${n} te pose une question sur lui. Sauras-tu deviner sa réponse ?`, tag: 'quiz', url: '/#quiz' });
    if (!prev.guess && doc.guess) return send({ title: 'Quiz 🎯', body: `${n} a tenté de deviner ta réponse. À toi de juger.`, tag: 'quiz', url: '/#quiz' });
    if (prev.ok == null && doc.ok != null) return send({ title: 'Quiz 🎯', body: doc.ok ? 'Bonne réponse 🎉' : 'Raté cette fois 😅', tag: 'quiz', url: '/#quiz' });
  }
  if (col === 'capsules' && !prev) return send({ title: 'Capsule 💊', body: `${n} a scellé une capsule jusqu'au ${dm(doc.openAt)}`, tag: 'capsule', url: '/#capsules' });
  if (col === 'potins' && !prev) return send({ title: 'Cagnotte 🏝️', body: `${n} a versé ${(+doc.amount || 0).toFixed(2).replace('.', ',')} €`, tag: 'cagnotte', url: '/#cagnotte' });
  if (col === 'songs' && !prev) return send({ title: 'Playlist 🎶', body: `${n} a ajouté ${doc.title}${doc.artist ? ' · ' + doc.artist : ''}`, tag: 'playlist', url: '/#playlist' });
  if (col === 'moods' && (!prev || prev.emoji !== doc.emoji) && cooled('mood:' + user.id, 20 * 60e3)) return send({ title: `Humeur de ${n}`, body: `${doc.emoji} ${doc.text || ''}`.trim(), tag: 'humeur', url: '/' });
  if (col === 'cycles' && !prev && (getD('profiles', user.id) || {}).shareCycle === true && doc.start >= today(new Date(Date.now() - 2 * 864e5))) return send({ title: 'Cycle 🌸', body: `${n} a indiqué le début de ses règles. C'est le moment d'être aux petits soins.`, tag: 'cycle', url: '/#cycle' }, true);
  if (col === 'coupons') {
    if (!prev) return send({ title: 'Un bon pour toi 🎟️', body: `${n} t'offre : ${doc.title}`, tag: 'bon-' + doc.id, url: '/#bons' }, true);
    if (!prev.usedAt && doc.usedAt) return send({ title: 'Bon utilisé 🎟️', body: `${n} utilise son bon : ${doc.title}`, tag: 'bon-' + doc.id, url: '/#bons' }, true);
  }
  if (col === 'photos' && !prev && cooled('ph:' + user.id, 10 * 60e3)) return send({ title: 'Photos', body: `${n} a ajouté des photos 📸`, tag: 'photos', url: '/#photos' });
  if (col === 'docfiles' && !prev && cooled('doc:' + user.id, 10 * 60e3)) return send({ title: 'Documents', body: `${n} a ajouté ${doc.name}`, tag: 'docs', url: '/#docs' });
}

app.put('/api/c/:col/:id', auth, (req, res) => {
  const { col, id } = req.params;
  if (!COLS.includes(col) || !/^[\w.-]{1,80}$/.test(id)) return res.status(400).json({ error: 'Collection inconnue' });
  const C = req.c, prev = getDoc(C, col, id);
  const doc = { ...(req.body || {}), id, by: prev ? prev.by : req.user.id, at: Date.now() };
  delete doc.hidden; delete doc.sealed;
  if (col === 'wishes' && prev && prev.owner === req.user.id) { if (prev.reservedBy) doc.reservedBy = prev.reservedBy; else delete doc.reservedBy; }
  if (col === 'profiles' && id !== '_couple' && id !== req.user.id) return res.status(403).json({ error: 'Pas ton profil' });
  // Documents personnels dont l'identifiant se termine par celui de leur auteur : personne ne peut écrire à la place de l'autre.
  if (['answers', 'moods', 'pokes', 'tlogs'].includes(col) && !id.endsWith('_' + req.user.id)) return res.status(403).json({ error: 'Pas à toi' });
  if (col === 'quiz') {
    if (!prev) { doc.about = req.user.id; delete doc.guess; delete doc.ok; }
    else {
      doc.about = prev.about; doc.q = prev.q;
      if (req.user.id === prev.about) { // la personne concernée : ne touche pas à la proposition de l'autre, ni à sa réponse une fois devinée
        if (prev.guess !== undefined) { doc.guess = prev.guess; doc.answer = prev.answer; } else { delete doc.guess; delete doc.ok; }
      } else { // celui qui devine : ne touche ni à la réponse ni au verdict
        doc.answer = prev.answer; if (prev.ok !== undefined) doc.ok = prev.ok; else delete doc.ok;
        if (prev.guess !== undefined) doc.guess = prev.guess;
      }
    }
  }
  if (col === 'snaps') { // une photo par personne et par jour, le jour même ; l'autre ne peut que réagir
    const t = today(), now = nowLocal();
    if (!prev) {
      if (id !== `${t}_${req.user.id}`) return res.status(403).json({ error: 'Un seul instant par jour, à prendre le jour même' });
      if (!db.prepare('SELECT 1 FROM files WHERE id=? AND couple=?').get(String(doc.fileId || ''), C)) return res.status(400).json({ error: 'Photo introuvable' });
      const sig = snapTimeFor(C, t), when = now.slice(11, 16), late = toMin(when) - toMin(sig);
      Object.assign(doc, { date: t, user: req.user.id, when, onTime: late >= 0 && late <= 10, lateMin: late > 10 ? late : null, reactions: {} });
    } else if (prev.user === req.user.id) return res.status(409).json({ error: 'Tu as déjà posté ton instant aujourd\'hui' });
    else {
      if (!getDoc(C, 'snaps', `${prev.date}_${req.user.id}`)) return res.status(403).json({ error: 'Poste ton instant pour pouvoir réagir' });
      const r = String((((req.body || {}).reactions) || {})[req.user.id] || '').slice(0, 8), reactions = { ...(prev.reactions || {}) };
      if (r) reactions[req.user.id] = r; else delete reactions[req.user.id];
      for (const k of Object.keys(doc)) delete doc[k];
      Object.assign(doc, prev, { at: Date.now(), reactions });
    }
  }
  if (col === 'avent') { // chacun prépare ses cases pour l'autre ; l'autre ne peut que les ouvrir, le jour venu
    const m = AV_ID.exec(id), day = m ? +m[2] : 0, year = m ? +m[1] : 0;
    if (!m || day < 1 || day > 24 || year < 2026 || year > +today().slice(0, 4) + 1) return res.status(400).json({ error: 'Case inconnue' });
    if (!prev) {
      if (m[3] !== req.user.id) return res.status(403).json({ error: 'Pas ta case' });
    } else if (prev.by !== req.user.id) {
      if (aventDate(prev) > today()) return res.status(403).json({ error: 'Patience, cette case n\'est pas encore ouvrable 🎄' });
      for (const k of Object.keys(doc)) delete doc[k];
      Object.assign(doc, prev, { at: Date.now(), openedAt: prev.openedAt || Date.now() });
      if (!prev.openedAt && prev.kind === 'bon' && prev.title) // le bon de la case rejoint les bons reçus
        saveDoc(C, 'coupons', { id: 'av' + crypto.randomBytes(6).toString('hex'), title: prev.title, emoji: prev.emoji || '🎟️', from: prev.by, to: req.user.id, by: prev.by, at: Date.now(), avent: day });
      saveDoc(C, col, doc);
      const rev2 = bump(C);
      if (!prev.openedAt) pushTo(prev.by, { title: '🎄 Calendrier de l\'Avent', body: `${req.user.name} a ouvert ta case du ${day} décembre`, tag: 'avent', url: '/#avent' }).catch(() => {});
      return res.json({ ok: true, rev: rev2 });
    } else if (prev.openedAt) return res.status(409).json({ error: 'Cette case a déjà été ouverte' });
    const kind = AV_KINDS.includes(doc.kind) ? doc.kind : 'mot';
    const fileId = kind === 'photo' && /^[a-f0-9]{32}$/.test(String(doc.fileId || '')) && db.prepare('SELECT 1 FROM files WHERE id=? AND couple=?').get(doc.fileId, C) ? doc.fileId : null;
    if (kind === 'photo' && !fileId) return res.status(400).json({ error: 'Photo introuvable' });
    const to = (usersOf(C).find(u => u.id !== req.user.id) || {}).id || null;
    for (const k of Object.keys(doc)) if (!['id', 'by', 'at'].includes(k)) delete doc[k];
    Object.assign(doc, { year, day, kind, to, text: String((req.body || {}).text || '').slice(0, 1000), title: String((req.body || {}).title || '').slice(0, 90), emoji: String((req.body || {}).emoji || '').slice(0, 8), fileId });
  }
  if (col === 'poops') { // une position et une note valides, rien d'autre
    const lat = +doc.lat, lng = +doc.lng;
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return res.status(400).json({ error: 'Position invalide' });
    doc.lat = Math.round(lat * 1e6) / 1e6; doc.lng = Math.round(lng * 1e6) / 1e6;
    doc.rating = Math.max(0, Math.min(5, Math.round(+doc.rating || 0)));
    doc.comment = String(doc.comment || '').slice(0, 280); doc.place = String(doc.place || '').slice(0, 60);
    doc.acc = doc.acc == null ? null : Math.max(0, Math.round(+doc.acc || 0)); doc.manual = !!doc.manual;
    doc.when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(doc.when || '') ? doc.when : new Date().toISOString().slice(0, 16);
  }
  if (col === 'docfiles' && /^[a-f0-9]{32}$/.test(String(doc.fileId || ''))) { // le nom affiché sert aussi au téléchargement
    doc.name = String(doc.name || '').replace(/[\r\n"\\/]/g, '-').trim().slice(0, 200) || (prev && prev.name) || 'fichier';
    db.prepare('UPDATE files SET name=? WHERE id=? AND couple=?').run(doc.name, doc.fileId, C);
  }
  if (col === 'capsules' && prev) { if (prev.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' }); doc.text = prev.text; doc.openAt = prev.openAt; }
  if (col === 'pokes' || col === 'moods') doc.user = req.user.id;
  if (col === 'tlogs') {
    const tr = getDoc(C, 'trackers', String(doc.tracker || ''));
    if (!tr || (tr.by !== req.user.id && tr.vis !== 'both')) return res.status(403).json({ error: 'Compteur inaccessible' });
    doc.user = req.user.id;
  }
  if ((col === 'scheduled' || col === 'moods' || col === 'cycles' || col === 'trackers' || col === 'tlogs' || col === 'pokes' || col === 'poops') && prev && prev.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' });
  if (col === 'answers') { doc.user = req.user.id; if (prev && prev.user !== req.user.id) return res.status(403).json({ error: 'Pas ta réponse' }); }
  saveDoc(C, col, doc);
  const rev = bump(C);
  try { notify(C, col, doc, prev, req.user); } catch (e) { console.error(e); }
  res.json({ ok: true, rev });
});
app.delete('/api/c/:col/:id', auth, (req, res) => {
  const { col, id } = req.params;
  if (!COLS.includes(col)) return res.status(400).json({ error: 'Collection inconnue' });
  const C = req.c;
  if (['scheduled', 'cycles', 'trackers', 'tlogs', 'capsules', 'pokes', 'moods', 'answers', 'poops', 'snaps', 'avent'].includes(col)) { const p = getDoc(C, col, id); if (p && p.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' }); if (p && col === 'avent' && p.openedAt) return res.status(409).json({ error: 'Cette case a déjà été ouverte' }); }
  if (col === 'trackers') for (const l of allDocs(C, 'tlogs')) if (l.tracker === id) delDoc(C, 'tlogs', l.id);
  delDoc(C, col, id);
  res.json({ ok: true, rev: bump(C) });
});

/* ---------- fichiers ---------- */
const upload = multer({
  storage: multer.diskStorage({ destination: FILES, filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')) }),
  limits: { fileSize: MAX_FILE, files: 1 }
});
app.post('/api/files', auth, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (25 Mo maximum)' : 'Envoi impossible' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
    const f = req.file;
    const used = db.prepare('SELECT COALESCE(SUM(size),0) s FROM files WHERE couple=?').get(req.c).s;
    if (used + f.size > QUOTA) { fs.unlink(f.path, () => {}); return res.status(400).json({ error: `Espace plein (${Math.round(QUOTA / 1048576)} Mo). Supprimez des photos ou des documents.` }); }
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\r\n"\\/]/g, '_').slice(0, 200);
    const meta = { id: f.filename, name, mime: f.mimetype || 'application/octet-stream', size: f.size };
    db.prepare('INSERT INTO files(id,name,mime,size,by,at,couple) VALUES(?,?,?,?,?,?,?)').run(meta.id, meta.name, meta.mime, meta.size, req.user.id, Date.now(), req.c);
    res.json(meta);
  });
});
const INLINE = /^(image\/(jpeg|png|gif|webp|heic|avif)|application\/pdf)$/;
app.get('/api/files/:id', auth, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=? AND couple=?').get(req.params.id, req.c);
  if (!f || !/^[a-f0-9]{32}$/.test(f.id)) return res.status(404).end();
  const inline = INLINE.test(f.mime) && req.query.dl !== '1'; // ?dl=1 : toujours en téléchargement
  res.set({
    'Content-Type': INLINE.test(f.mime) ? f.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': inline ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'" : "default-src 'none'; sandbox"
  });
  fs.createReadStream(path.join(FILES, f.id)).on('error', () => res.status(404).end()).pipe(res);
});
app.delete('/api/files/:id', auth, (req, res) => {
  const f = db.prepare('SELECT id FROM files WHERE id=? AND couple=?').get(req.params.id, req.c);
  if (f && /^[a-f0-9]{32}$/.test(f.id)) { db.prepare('DELETE FROM files WHERE id=?').run(f.id); fs.unlink(path.join(FILES, f.id), () => {}); }
  res.json({ ok: true });
});

/* ---------- push ---------- */
app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body && req.body.sub;
  if (!sub || !/^https:\/\//.test(sub.endpoint || '')) return res.status(400).json({ error: 'Abonnement invalide' });
  db.prepare('INSERT INTO subs(endpoint,user,sub) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user=excluded.user, sub=excluded.sub').run(sub.endpoint, req.user.id, JSON.stringify(sub));
  res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, (req, res) => {
  db.prepare('DELETE FROM subs WHERE endpoint=? AND user=?').run(String((req.body || {}).endpoint || ''), req.user.id);
  res.json({ ok: true });
});
app.post('/api/push/test', auth, async (req, res) => {
  const n = await pushTo(req.user.id, { title: 'Nous', body: 'Les notifications fonctionnent ✨', tag: 'test', url: '/' });
  res.json({ ok: true, devices: n });
});

/* ---------- rappels quotidiens (9 h, heure de Paris) ---------- */
const qIndex = iso => { const [y, m, d] = iso.split('-').map(Number); const n = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(2026, 0, 1)) / 864e5); return ((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length; };
async function daily() {
  const t = today();
  if (hourNow() < 9 || getMeta('daily') === t) return;
  setMeta('daily', t);
  for (const { id } of db.prepare('SELECT id FROM couples').all()) { try { await dailyFor(id, t); } catch (e) { console.error(e); } }
  try { for (const f of fs.readdirSync(TILES)) { const p = path.join(TILES, f); if (Date.now() - fs.statSync(p).mtimeMs > 60 * 864e5) fs.unlinkSync(p); } } catch (e) { } // tuiles inutilisées depuis 2 mois
}
async function dailyFor(c, t) {
  const us = usersOf(c); if (!us.length) return;
  const allDocs2 = col => allDocs(c, col), getDoc2 = (col, id) => getDoc(c, col, id);
  const all = p => Promise.all(us.map(u => pushTo(u.id, p).catch(() => {})));
  const q = QUESTIONS[qIndex(t)];
  await all({ title: 'Question du jour 💬', body: q.t === 'choice' ? `${q.q} ${q.a} ou ${q.b} ?` : q.q, tag: 'question', url: '/#question' });
  for (const f of allDocs2('flats')) {
    if (f.visitAt && String(f.visitAt).slice(0, 10) === t && f.status === 'visite')
      await all({ title: 'Visite aujourd\'hui 🔑', body: `${f.title}${f.visitAt.length > 10 ? ' à ' + f.visitAt.slice(11, 16) : ''}`, tag: 'flat-' + f.id, url: '/#appart' });
    if (f.status === 'contacte' || f.status === 'dossier') {
      const days = Math.floor((Date.now() - (f.lastActionAt || f.at)) / 864e5);
      if ([5, 9, 14].includes(days)) await all({ title: 'Relance à faire 📞', body: `${f.title} : sans nouvelles depuis ${days} jours`, tag: 'flat-' + f.id, url: '/#appart' });
    }
  }
  for (const m of allDocs2('milestones')) if (m.date && m.date.slice(4) === t.slice(4) && m.date < t) { const n = +t.slice(0, 4) - +m.date.slice(0, 4); await all({ title: `Il y a ${n} an${n > 1 ? 's' : ''} aujourd'hui ✨`, body: m.title, tag: 'ms-' + m.id, url: '/#histoire' }); }
  const since = (getDoc2('profiles', '_couple') || {}).since;
  if (since && since.slice(4) === t.slice(4) && since < t) { const n = +t.slice(0, 4) - +since.slice(0, 4); await all({ title: `${n} an${n > 1 ? 's' : ''} ensemble 🥂`, body: 'Joyeux anniversaire à vous deux.', tag: 'anniv', url: '/#histoire' }); }
  // règles estimées dans 2 jours : rappel à la personne, et à l'autre seulement si le suivi est partagé
  const addD = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const cyc = allDocs2('cycles');
  for (const u of us) {
    const starts = cyc.filter(c => c.by === u.id && c.start).map(c => c.start).sort(); if (!starts.length) continue;
    const gaps = []; for (let i = 1; i < starts.length; i++) { const g = diff(starts[i - 1], starts[i]); if (g >= 15 && g <= 60) gaps.push(g); }
    const last6 = gaps.slice(-6), avg = last6.length ? Math.round(last6.reduce((a, b) => a + b, 0) / last6.length) : 28;
    if (addD(starts[starts.length - 1], avg) !== addD(t, 2)) continue;
    await pushTo(u.id, { title: 'Cycle 🌸', body: 'Tes règles sont estimées dans 2 jours.', tag: 'cycle', url: '/#cycle' }).catch(() => {});
    if ((getDoc2('profiles', u.id) || {}).shareCycle === true) for (const o of us) if (o.id !== u.id) await pushTo(o.id, { title: 'Cycle 🌸', body: `Les règles de ${u.name} sont estimées dans 2 jours.`, tag: 'cycle', url: '/#cycle' }).catch(() => {});
  }
  for (const c of allDocs2('chores')) if (c.next === t && c.turn) await pushTo(c.turn, { title: 'À faire aujourd\'hui 🧹', body: `${c.title} : c'est ton tour`, tag: 'tache-' + c.id, url: '/#taches' }).catch(() => {});
  for (const c of allDocs2('capsules')) if (c.openAt === t) await all({ title: 'Une capsule s\'ouvre 💊', body: c.title, tag: 'capsule', url: '/#capsules' });
  if (new Date(t + 'T12:00:00Z').getUTCDay() === 1 && QUESTIONS.defis) { const L = QUESTIONS.defis, k = Math.floor((Date.parse(t) - Date.parse('2026-01-05')) / (7 * 864e5)); await all({ title: 'Défi de la semaine 🏅', body: L[((k % L.length) + L.length) % L.length], tag: 'defi', url: '/#defi' }); }
  if (t.slice(8) === '01') await all({ title: 'Votre bilan du mois est prêt 📅', body: 'Jours ensemble, mots échangés, photos : le récap vous attend.', tag: 'bilan', url: '/#bilan' });
  for (const c of allDocs2('countdowns')) if (c.date === t) await all({ title: 'C\'est aujourd\'hui ! 🎉', body: c.title, tag: 'cd-' + c.id, url: '/#rebours' });
  // Calendrier de l'Avent : la case du jour du 1er au 24 décembre, et deux rappels pour finir de le remplir fin novembre
  if (us.length === 2) {
    const Y = t.slice(0, 4), mo = t.slice(5, 7), dd = +t.slice(8);
    for (const u of us) {
      const o = us.find(x => x.id !== u.id);
      if (mo === '12' && dd <= 24 && getDoc2('avent', `${Y}-${t.slice(8)}_${o.id}`)) await pushTo(u.id, { title: `🎄 Case du ${dd} décembre`, body: `${o.name} t'a préparé une surprise. Viens l'ouvrir !`, tag: 'avent', url: '/#avent' }).catch(() => {});
      if (mo === '11' && (dd === 24 || dd === 30)) {
        const n = allDocs2('avent').filter(a => a.by === u.id && String(a.year) === Y).length;
        if (n < 24) await pushTo(u.id, { title: '🎄 Calendrier de l\'Avent', body: `${n ? n + ' case' + (n > 1 ? 's' : '') + ' prête' + (n > 1 ? 's' : '') + ' sur 24' : 'Aucune case prête'} pour ${o.name}. Ça s'ouvre le 1er décembre !`, tag: 'avent', url: '/#avent' }).catch(() => {});
      }
    }
  }
}
setInterval(() => daily().catch(e => console.error(e)), 5 * 60e3);

/* ---------- mots programmés : livrés à l'heure choisie (heure de Paris) ---------- */
const nowLocal = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(' ', 'T');
function deliverScheduled() {
  const now = nowLocal(), touched = new Set();
  for (const r of db.prepare("SELECT couple, data FROM docs WHERE col='scheduled'").all()) {
    const c = r.couple, s = JSON.parse(r.data);
    if (!s.sendAt || s.sendAt > now) continue;
    const author = userById(s.by);
    delDoc(c, 'scheduled', s.id); touched.add(c);
    if (!author || author.couple !== c) continue;
    const note = { id: 'n' + crypto.randomBytes(8).toString('hex'), text: s.text, to: s.to, by: s.by, at: Date.now() };
    saveDoc(c, 'notes', note);
    notify(c, 'notes', note, null, author);
  }
  for (const c of touched) bump(c);
}
setInterval(() => { try { deliverScheduled(); } catch (e) { console.error(e); } }, 20e3);

/* ---------- Instant du jour : un signal par couple et par jour, à une heure tirée au hasard ---------- */
const toMin = hm => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
function snapTimeFor(c, d) { // entre 10 h et 21 h 30, heure de Paris, tirée une fois par jour
  const k = `snap:${c}:${d}`; let v = getMeta(k);
  if (!v) { const m = 600 + crypto.randomInt(0, 691); v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; setMeta(k, v); }
  return v;
}
// L'heure du signal n'est révélée qu'une fois passée, pour garder la surprise.
function snapSignalFor(c) { const now = nowLocal(), at = snapTimeFor(c, now.slice(0, 10)); return now.slice(11, 16) >= at ? at : null; }
function snapSignals() {
  const now = nowLocal(), t = now.slice(0, 10), hm = now.slice(11, 16);
  for (const { id } of db.prepare('SELECT id FROM couples').all()) {
    const at = snapTimeFor(id, t), k = `snapsent:${id}:${t}`;
    if (hm < at || getMeta(k)) continue;
    setMeta(k, '1'); bump(id);
    if (toMin(hm) - toMin(at) > 30) continue; // serveur redémarré bien après l'heure : pas de signal en retard
    for (const u of usersOf(id)) if (!getDoc(id, 'snaps', `${t}_${u.id}`)) pushTo(u.id, { title: '⚡ C\'est l\'heure de l\'instant !', body: 'Tu as 10 minutes pour prendre ton instant du jour 📸', tag: 'instant', url: '/' }).catch(() => {});
  }
}
setInterval(() => { try { snapSignals(); } catch (e) { console.error(e); } }, 30e3);

/* ---------- fonds de carte (Caca map) ---------- */
// Les tuiles OpenStreetMap passent par le serveur : mises en cache, envoyées avec un User-Agent identifié comme le demande
// la politique d'usage d'OpenStreetMap, et sans exposer les adresses IP des utilisateurs. Réservé aux comptes connectés.
const TILE_UA = `Nous/1.0 (app privee de couple; ${(process.env.VAPID_SUBJECT || 'mailto:contact@kratox.fr').replace('mailto:', '')})`;
const tileHeaders = { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800' };
app.get('/tiles/:z/:x/:y.png', auth, async (req, res) => {
  const z = +req.params.z, x = +req.params.x, y = +req.params.y, n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= n || y >= n) return res.status(400).end();
  const file = path.join(TILES, `${z}-${x}-${y}.png`);
  let stale = null;
  try { const st = fs.statSync(file); if (Date.now() - st.mtimeMs < 30 * 864e5) return res.set(tileHeaders).sendFile(file); stale = file; } catch (e) { }
  try {
    const r = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { 'User-Agent': TILE_UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error('tuile ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFile(file, buf, () => {});
    res.set(tileHeaders).send(buf);
  } catch (e) { if (stale) return res.set(tileHeaders).sendFile(stale); res.status(504).end(); }
});

/* ---------- administration ---------- */
// L'administration voit qui utilise l'app et combien de place ça prend, jamais le contenu des couples.
app.get('/api/admin', auth, adminOnly, (req, res) => {
  const couples = db.prepare('SELECT id, name, created FROM couples ORDER BY created').all().map(c => ({
    id: c.id, created: c.created, mine: c.id === req.c,
    users: usersOf(c.id),
    items: db.prepare('SELECT COUNT(*) n FROM docs WHERE couple=?').get(c.id).n,
    bytes: db.prepare('SELECT COALESCE(SUM(size),0) s FROM files WHERE couple=?').get(c.id).s,
    lastSeen: db.prepare('SELECT MAX(at) a FROM docs WHERE couple=?').get(c.id).a || c.created,
    deleteAt: (db.prepare('SELECT delete_at d FROM couples WHERE id=?').get(c.id) || {}).d || null
  }));
  const invites = db.prepare("SELECT id, note, created, expires FROM invites WHERE kind='couple' AND used_at IS NULL AND expires > ? ORDER BY created DESC").all(Date.now()).map(i => ({ ...i, id: i.id.slice(0, 16) }));
  res.json({ couples, invites, quota: QUOTA, backupAt: +getMeta('backupAt') || null, mail: !!mailer });
});
app.post('/api/admin/invite', auth, adminOnly, (req, res) => res.json({ code: createInvite('couple', null, req.user.id, (req.body || {}).note, 14), days: 14 }));
app.delete('/api/admin/invite/:id', auth, adminOnly, (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) return res.status(400).json({ error: 'Invitation inconnue' });
  db.prepare("DELETE FROM invites WHERE kind='couple' AND used_at IS NULL AND substr(id,1,16)=?").run(req.params.id);
  res.json({ ok: true });
});
// Notification générale : envoyée à tous les comptes de tous les espaces (texte libre, pas de contenu des couples).
let lastBroadcast = 0;
app.post('/api/admin/broadcast', auth, adminOnly, async (req, res) => {
  const title = cleanName((req.body || {}).title) || 'Nous', body = String((req.body || {}).body || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 300);
  if (!body) return res.status(400).json({ error: 'Écris un message' });
  if (Date.now() - lastBroadcast < 60e3) return res.status(429).json({ error: 'Une notification générale par minute au maximum' });
  lastBroadcast = Date.now();
  const us = db.prepare('SELECT id FROM users').all();
  let devices = 0, reached = 0;
  for (const u of us) { const n = await pushTo(u.id, { title, body, tag: 'annonce-' + Date.now(), url: '/' }).catch(() => 0); devices += n; if (n) reached++; }
  res.json({ users: us.length, reached, devices });
});
app.post('/api/admin/reset', auth, adminOnly, async (req, res) => {
  const u = userById(String((req.body || {}).user || ''));
  if (!u) return res.status(404).json({ error: 'Compte introuvable' });
  const pwd = newCode().slice(0, 12);
  db.prepare('UPDATE users SET hash=? WHERE id=?').run(await argon2.hash(pwd, { type: argon2.argon2id }), u.id);
  db.prepare('DELETE FROM sessions WHERE user=?').run(u.id);
  res.json({ password: pwd });
});
app.post('/api/admin/delete-couple', auth, adminOnly, (req, res) => {
  const c = String((req.body || {}).couple || '');
  if (c === req.c) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre espace d\'ici.' });
  if (!db.prepare('SELECT 1 FROM couples WHERE id=?').get(c)) return res.status(404).json({ error: 'Espace introuvable' });
  deleteCouple(c);
  res.json({ ok: true });
});

/* ---------- fichiers statiques ---------- */
// Chaque version de l'app a une empreinte : les adresses des scripts changent à chaque mise à jour,
// donc un navigateur ne peut pas rester bloqué sur d'anciens fichiers.
const PUB = path.join(__dirname, 'public');
const VERSION = (() => { const hsh = crypto.createHash('sha1'); for (const f of fs.readdirSync(PUB).sort()) hsh.update(f).update(fs.readFileSync(path.join(PUB, f))); return hsh.digest('hex').slice(0, 10); })();
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  .replace(/(href|src)="\/([\w.-]+\.(?:js|css))"/g, `$1="/$2?v=${VERSION}"`)
  .replace('</head>', `<meta name="nous-version" content="${VERSION}">\n</head>`);
app.get(['/', '/index.html'], (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(INDEX));
app.use(express.static(PUB, {
  setHeaders: (res, p) => { res.set('Cache-Control', /\.(png|jpg|svg|ico)$/.test(p) ? 'public, max-age=86400' : 'no-cache'); }
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: 'Erreur serveur' }); });

initUsers().then(() => app.listen(PORT, () => console.log(`[nous] version ${VERSION}, en écoute sur le port ${PORT}`)));
