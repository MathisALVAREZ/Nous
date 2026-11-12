'use strict';
/* Nous — serveur : comptes (2 personnes), données partagées, fichiers, notifications push. */
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
const TZ = 'Europe/Paris';
fs.mkdirSync(FILES, { recursive: true });

const COLS = ['events', 'places', 'expenses', 'settlements', 'recurring', 'notes', 'folders', 'docfiles',
  'flats', 'answers', 'lists', 'items', 'wishes', 'countdowns', 'photos', 'wheel', 'profiles', 'moods', 'milestones', 'coupons', 'scheduled', 'cycles', 'trackers', 'tlogs', 'meals', 'chores', 'chorelog', 'pots', 'potins', 'trips', 'infos', 'disputes', 'defis', 'quiz', 'capsules', 'pokes', 'songs'];

/* ---------- base ---------- */
const db = new Database(path.join(DATA, 'nous.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL, pos INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS docs(col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, by TEXT, at INTEGER, PRIMARY KEY(col, id));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT, mime TEXT, size INTEGER, by TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS subs(endpoint TEXT PRIMARY KEY, user TEXT NOT NULL, sub TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`);
const getMeta = k => (db.prepare('SELECT v FROM meta WHERE k=?').get(k) || {}).v;
const setMeta = (k, v) => db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
let rev = +(getMeta('rev') || 1);
const bump = () => { rev++; setMeta('rev', rev); };

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const users = () => db.prepare('SELECT id, name FROM users ORDER BY pos').all();
const today = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // AAAA-MM-JJ
const hourNow = () => +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date());

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
const getDoc = (col, id) => { const r = db.prepare('SELECT data FROM docs WHERE col=? AND id=?').get(col, id); return r ? JSON.parse(r.data) : null; };
const allDocs = col => db.prepare('SELECT data FROM docs WHERE col=?').all(col).map(r => JSON.parse(r.data));
const wantsActivity = uid => (getDoc('profiles', uid) || {}).notifActivity !== false;

/* ---------- comptes initiaux ---------- */
async function initUsers() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const spec = (process.env.INIT_USERS || '').split(';').map(s => s.trim()).filter(Boolean);
  if (!spec.length) { console.warn('[nous] Aucun compte : définis INIT_USERS="identifiant:Prénom:motdepasse;…" au premier démarrage.'); return; }
  let pos = 0;
  for (const s of spec.slice(0, 2)) {
    const [id, name, ...rest] = s.split(':'); const pwd = rest.join(':');
    if (!id || !name || pwd.length < 8) { console.warn('[nous] Compte ignoré (mot de passe de 8 caractères minimum) :', id); continue; }
    db.prepare('INSERT INTO users(id,name,hash,pos) VALUES(?,?,?,?)').run(id.toLowerCase(), name, await argon2.hash(pwd, { type: argon2.argon2id }), pos++);
    console.log('[nous] Compte créé :', id.toLowerCase());
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
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
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
  req.user = db.prepare('SELECT id, name FROM users WHERE id=?').get(s.user);
  if (!req.user) return res.status(401).json({ error: 'Non connecté' });
  next();
}
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
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user,expires) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  setSession(res, token);
  res.json({ ok: true });
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
  if (+req.query.rev === rev) return res.json({ same: true, rev, v: VERSION });
  const me = req.user.id, cols = {};
  const rows = db.prepare('SELECT col, data FROM docs').all();
  const parsed = rows.map(r => [r.col, JSON.parse(r.data)]);
  const mine = new Set(parsed.filter(([c, d]) => c === 'answers' && d.user === me).map(([, d]) => d.date));
  for (const c of COLS) cols[c] = {};
  const hiddenT = new Set(parsed.filter(([c, d]) => c === 'trackers' && d.by !== me && (d.vis || 'private') === 'private').map(([, d]) => d.id));
  const sharers = new Set(parsed.filter(([c, d]) => c === 'profiles' && d.shareCycle === true).map(([, d]) => d.id));
  for (const [c, d] of parsed) if (cols[c]) { const v = viewFor(c, d, me, mine, sharers, hiddenT); if (v) cols[c][d.id] = v; }
  res.json({ rev, me: req.user, users: users(), cols, vapid: vapid.publicKey, today: today(), v: VERSION });
});

const lastPing = new Map();
const cooled = (k, ms) => { const t = lastPing.get(k) || 0; if (Date.now() - t < ms) return false; lastPing.set(k, Date.now()); return true; };
const dm = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
const FLAT_ST = { repere: 'Repéré', contacte: 'Contacté', visite: 'Visite prévue', dossier: 'Dossier envoyé', accepte: 'Accepté 🎉', refuse: 'Refusé' };

function notify(col, doc, prev, user) {
  const others = users().filter(u => u.id !== user.id);
  const send = (p, always) => others.forEach(o => { if (always || wantsActivity(o.id)) pushTo(o.id, p).catch(() => {}); });
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
      if (!wantsActivity(o.id)) return;
      const done = getDoc('answers', doc.date + '_' + o.id);
      pushTo(o.id, { title: 'Question du jour', body: done ? `${n} a répondu, viens voir vos réponses 👀` : `${n} a répondu. À toi !`, tag: 'question', url: '/#question' }).catch(() => {});
    });
  }
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
  if (col === 'cycles' && !prev && (getDoc('profiles', user.id) || {}).shareCycle === true && doc.start >= today(new Date(Date.now() - 2 * 864e5))) return send({ title: 'Cycle 🌸', body: `${n} a indiqué le début de ses règles. C'est le moment d'être aux petits soins.`, tag: 'cycle', url: '/#cycle' }, true);
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
  const prev = getDoc(col, id);
  const doc = { ...(req.body || {}), id, by: prev ? prev.by : req.user.id, at: Date.now() };
  delete doc.hidden; delete doc.sealed;
  if (col === 'wishes' && prev && prev.owner === req.user.id) { if (prev.reservedBy) doc.reservedBy = prev.reservedBy; else delete doc.reservedBy; }
  if (col === 'profiles' && id !== '_couple' && id !== req.user.id) return res.status(403).json({ error: 'Pas ton profil' });
  if (col === 'quiz') {
    if (!prev) req.body.about = req.user.id;
    else if (req.user.id === prev.about) { req.body.q = prev.q; if (prev.guess !== undefined) req.body.guess = prev.guess; else delete req.body.guess; }
    else { req.body.q = prev.q; req.body.answer = prev.answer; if (prev.ok !== undefined) req.body.ok = prev.ok; else delete req.body.ok; }
    if (prev) req.body.about = prev.about;
  }
  if (col === 'capsules' && prev) { if (prev.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' }); req.body.text = prev.text; req.body.openAt = prev.openAt; }
  if (col === 'pokes') req.body.user = req.user.id;
  if (col === 'tlogs') {
    const tr = getDoc('trackers', String((req.body || {}).tracker || ''));
    if (!tr || (tr.by !== req.user.id && tr.vis !== 'both')) return res.status(403).json({ error: 'Compteur inaccessible' });
    req.body.user = req.user.id;
  }
  if ((col === 'scheduled' || col === 'moods' || col === 'cycles' || col === 'trackers' || col === 'tlogs' || col === 'pokes') && prev && prev.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' });
  if (col === 'answers') { doc.user = req.user.id; if (prev && prev.user !== req.user.id) return res.status(403).json({ error: 'Pas ta réponse' }); }
  db.prepare('INSERT INTO docs(col,id,data,by,at) VALUES(?,?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data, at=excluded.at')
    .run(col, id, JSON.stringify(doc), doc.by, doc.at);
  bump();
  try { notify(col, doc, prev, req.user); } catch (e) { console.error(e); }
  res.json({ ok: true, rev });
});
app.delete('/api/c/:col/:id', auth, (req, res) => {
  const { col, id } = req.params;
  if (!COLS.includes(col)) return res.status(400).json({ error: 'Collection inconnue' });
  if (col === 'trackers') { const p = getDoc(col, id); if (p && p.by === req.user.id) for (const l of allDocs('tlogs')) if (l.tracker === id) db.prepare('DELETE FROM docs WHERE col=? AND id=?').run('tlogs', l.id); }
  if (col === 'scheduled' || col === 'cycles' || col === 'trackers' || col === 'tlogs' || col === 'capsules') { const p = getDoc(col, id); if (p && p.by !== req.user.id) return res.status(403).json({ error: 'Pas à toi' }); }
  db.prepare('DELETE FROM docs WHERE col=? AND id=?').run(col, id);
  bump();
  res.json({ ok: true, rev });
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
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\r\n"\\/]/g, '_').slice(0, 200);
    const meta = { id: f.filename, name, mime: f.mimetype || 'application/octet-stream', size: f.size };
    db.prepare('INSERT INTO files(id,name,mime,size,by,at) VALUES(?,?,?,?,?,?)').run(meta.id, meta.name, meta.mime, meta.size, req.user.id, Date.now());
    res.json(meta);
  });
});
const INLINE = /^(image\/(jpeg|png|gif|webp|heic|avif)|application\/pdf)$/;
app.get('/api/files/:id', auth, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if (!f || !/^[a-f0-9]{32}$/.test(f.id)) return res.status(404).end();
  const inline = INLINE.test(f.mime);
  res.set({
    'Content-Type': inline ? f.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': inline ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'" : "default-src 'none'; sandbox"
  });
  fs.createReadStream(path.join(FILES, f.id)).on('error', () => res.status(404).end()).pipe(res);
});
app.delete('/api/files/:id', auth, (req, res) => {
  const f = db.prepare('SELECT id FROM files WHERE id=?').get(req.params.id);
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
  const us = users(); if (!us.length) return;
  const all = p => Promise.all(us.map(u => pushTo(u.id, p).catch(() => {})));
  const q = QUESTIONS[qIndex(t)];
  await all({ title: 'Question du jour 💬', body: q.t === 'choice' ? `${q.q} ${q.a} ou ${q.b} ?` : q.q, tag: 'question', url: '/#question' });
  for (const f of allDocs('flats')) {
    if (f.visitAt && String(f.visitAt).slice(0, 10) === t && f.status === 'visite')
      await all({ title: 'Visite aujourd\'hui 🔑', body: `${f.title}${f.visitAt.length > 10 ? ' à ' + f.visitAt.slice(11, 16) : ''}`, tag: 'flat-' + f.id, url: '/#appart' });
    if (f.status === 'contacte' || f.status === 'dossier') {
      const days = Math.floor((Date.now() - (f.lastActionAt || f.at)) / 864e5);
      if ([5, 9, 14].includes(days)) await all({ title: 'Relance à faire 📞', body: `${f.title} : sans nouvelles depuis ${days} jours`, tag: 'flat-' + f.id, url: '/#appart' });
    }
  }
  for (const m of allDocs('milestones')) if (m.date && m.date.slice(4) === t.slice(4) && m.date < t) { const n = +t.slice(0, 4) - +m.date.slice(0, 4); await all({ title: `Il y a ${n} an${n > 1 ? 's' : ''} aujourd'hui ✨`, body: m.title, tag: 'ms-' + m.id, url: '/#histoire' }); }
  const since = (getDoc('profiles', '_couple') || {}).since;
  if (since && since.slice(4) === t.slice(4) && since < t) { const n = +t.slice(0, 4) - +since.slice(0, 4); await all({ title: `${n} an${n > 1 ? 's' : ''} ensemble 🥂`, body: 'Joyeux anniversaire à vous deux.', tag: 'anniv', url: '/#histoire' }); }
  // règles estimées dans 2 jours : rappel à la personne, et à l'autre seulement si le suivi est partagé
  const addD = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
  const cyc = allDocs('cycles');
  for (const u of us) {
    const starts = cyc.filter(c => c.by === u.id && c.start).map(c => c.start).sort(); if (!starts.length) continue;
    const gaps = []; for (let i = 1; i < starts.length; i++) { const g = diff(starts[i - 1], starts[i]); if (g >= 15 && g <= 60) gaps.push(g); }
    const last6 = gaps.slice(-6), avg = last6.length ? Math.round(last6.reduce((a, b) => a + b, 0) / last6.length) : 28;
    if (addD(starts[starts.length - 1], avg) !== addD(t, 2)) continue;
    await pushTo(u.id, { title: 'Cycle 🌸', body: 'Tes règles sont estimées dans 2 jours.', tag: 'cycle', url: '/#cycle' }).catch(() => {});
    if ((getDoc('profiles', u.id) || {}).shareCycle === true) for (const o of us) if (o.id !== u.id) await pushTo(o.id, { title: 'Cycle 🌸', body: `Les règles de ${u.name} sont estimées dans 2 jours.`, tag: 'cycle', url: '/#cycle' }).catch(() => {});
  }
  for (const c of allDocs('chores')) if (c.next === t && c.turn) await pushTo(c.turn, { title: 'À faire aujourd\'hui 🧹', body: `${c.title} : c'est ton tour`, tag: 'tache-' + c.id, url: '/#taches' }).catch(() => {});
  for (const c of allDocs('capsules')) if (c.openAt === t) await all({ title: 'Une capsule s\'ouvre 💊', body: c.title, tag: 'capsule', url: '/#capsules' });
  if (new Date(t + 'T12:00:00Z').getUTCDay() === 1 && QUESTIONS.defis) { const L = QUESTIONS.defis, k = Math.floor((Date.parse(t) - Date.parse('2026-01-05')) / (7 * 864e5)); await all({ title: 'Défi de la semaine 🏅', body: L[((k % L.length) + L.length) % L.length], tag: 'defi', url: '/#defi' }); }
  if (t.slice(8) === '01') await all({ title: 'Votre bilan du mois est prêt 📅', body: 'Jours ensemble, mots échangés, photos : le récap vous attend.', tag: 'bilan', url: '/#bilan' });
  for (const c of allDocs('countdowns')) if (c.date === t) await all({ title: 'C\'est aujourd\'hui ! 🎉', body: c.title, tag: 'cd-' + c.id, url: '/#rebours' });
}
setInterval(() => daily().catch(e => console.error(e)), 5 * 60e3);

/* ---------- mots programmés : livrés à l'heure choisie (heure de Paris) ---------- */
const nowLocal = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date()).replace(' ', 'T');
function deliverScheduled() {
  const now = nowLocal(); let n = 0;
  for (const s of allDocs('scheduled')) {
    if (!s.sendAt || s.sendAt > now) continue;
    const author = db.prepare('SELECT id, name FROM users WHERE id=?').get(s.by);
    db.prepare('DELETE FROM docs WHERE col=? AND id=?').run('scheduled', s.id); n++;
    if (!author) continue;
    const note = { id: 'n' + crypto.randomBytes(8).toString('hex'), text: s.text, to: s.to, by: s.by, at: Date.now() };
    db.prepare('INSERT INTO docs(col,id,data,by,at) VALUES(?,?,?,?,?)').run('notes', note.id, JSON.stringify(note), note.by, note.at);
    notify('notes', note, null, author);
  }
  if (n) bump();
}
setInterval(() => { try { deliverScheduled(); } catch (e) { console.error(e); } }, 20e3);

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
