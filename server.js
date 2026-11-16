'use strict';
/* Nous — serveur : plusieurs couples isolés, inscription sur invitation, données partagées à deux, fichiers, notifications push. */
const express = require('express');
const Database = require('better-sqlite3');
const argon2 = require('argon2');
const webpush = require('web-push');
const multer = require('multer');
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
  'flats', 'answers', 'lists', 'items', 'wishes', 'countdowns', 'photos', 'wheel', 'profiles', 'moods', 'milestones', 'coupons', 'scheduled', 'cycles', 'trackers', 'tlogs', 'meals', 'chores', 'chorelog', 'pots', 'potins', 'trips', 'infos', 'disputes', 'defis', 'quiz', 'capsules', 'pokes', 'songs', 'poops'];

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
db.exec('CREATE INDEX IF NOT EXISTS files_couple ON files(couple); CREATE INDEX IF NOT EXISTS users_couple ON users(couple);');

const revs = new Map(db.prepare('SELECT id, rev FROM couples').all().map(c => [c.id, c.rev]));
const revOf = c => revs.get(c) || 1;
const bump = c => { const r = revOf(c) + 1; revs.set(c, r); db.prepare('UPDATE couples SET rev=? WHERE id=?').run(r, c); return r; };

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const usersOf = c => db.prepare('SELECT id, name FROM users WHERE couple=? ORDER BY pos').all(c);
const userById = id => db.prepare('SELECT id, name, couple, admin FROM users WHERE id=?').get(id);
const today = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // AAAA-MM-JJ
const hourNow = () => +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date());
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
      db.prepare('INSERT INTO users(id,name,hash,pos,couple,admin) VALUES(?,?,?,?,?,0)').run(login, name, hash, pos, couple);
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

/* ---------- données ---------- */
// Ce que chacun a le droit de voir : pas la réservation de ses propres envies, pas la réponse de l'autre avant d'avoir répondu.
function viewFor(col, doc, me, mine, sharers, hiddenT) {
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
  if (+req.query.rev === rev) return res.json({ same: true, rev, v: VERSION });
  const me = req.user.id, cols = {};
  const rows = db.prepare('SELECT col, data FROM docs WHERE couple=?').all(req.c);
  const parsed = rows.map(r => [r.col, JSON.parse(r.data)]);
  const mine = new Set(parsed.filter(([c, d]) => c === 'answers' && d.user === me).map(([, d]) => d.date));
  for (const c of COLS) cols[c] = {};
  const hiddenT = new Set(parsed.filter(([c, d]) => c === 'trackers' && d.by !== me && (d.vis || 'private') === 'private').map(([, d]) => d.id));
  const sharers = new Set(parsed.filter(([c, d]) => c === 'profiles' && d.shareCycle === true).map(([, d]) => d.id));
  for (const [c, d] of parsed) if (cols[c]) { const v = viewFor(c, d, me, mine, sharers, hiddenT); if (v) cols[c][d.id] = v; }
  res.json({ rev, me: { id: me, name: req.user.name, admin: !!req.user.admin }, users: usersOf(req.c), cols, vapid: vapid.publicKey, today: today(), v: VERSION, cities: CITIES });
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
  if (['scheduled', 'cycles', 'trackers', 'tlogs', 'capsules', 'pokes', 'moods', 'answers', 'poops'].includes(col)) { const p = getDoc(C, col, id); if (p && p.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' }); }
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
    lastSeen: db.prepare('SELECT MAX(at) a FROM docs WHERE couple=?').get(c.id).a || c.created
  }));
  const invites = db.prepare("SELECT id, note, created, expires FROM invites WHERE kind='couple' AND used_at IS NULL AND expires > ? ORDER BY created DESC").all(Date.now()).map(i => ({ ...i, id: i.id.slice(0, 16) }));
  res.json({ couples, invites, quota: QUOTA });
});
app.post('/api/admin/invite', auth, adminOnly, (req, res) => res.json({ code: createInvite('couple', null, req.user.id, (req.body || {}).note, 14), days: 14 }));
app.delete('/api/admin/invite/:id', auth, adminOnly, (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) return res.status(400).json({ error: 'Invitation inconnue' });
  db.prepare("DELETE FROM invites WHERE kind='couple' AND used_at IS NULL AND substr(id,1,16)=?").run(req.params.id);
  res.json({ ok: true });
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
  const files = db.prepare('SELECT id FROM files WHERE couple=?').all(c);
  db.transaction(() => {
    for (const u of usersOf(c)) { db.prepare('DELETE FROM sessions WHERE user=?').run(u.id); db.prepare('DELETE FROM subs WHERE user=?').run(u.id); }
    for (const t of ['docs', 'files', 'users']) db.prepare(`DELETE FROM ${t} WHERE couple=?`).run(c);
    db.prepare('DELETE FROM invites WHERE couple=?').run(c);
    db.prepare('DELETE FROM couples WHERE id=?').run(c);
  })();
  for (const f of files) if (/^[a-f0-9]{32}$/.test(f.id)) fs.unlink(path.join(FILES, f.id), () => {});
  revs.delete(c);
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
