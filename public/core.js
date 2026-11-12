'use strict';
/* Nous — socle : utilitaires, stockage (serveur ou démo locale), feuilles, formulaires. */
const D = document;
const $ = (s, r = D) => r.querySelector(s);
const COLS = ['events', 'places', 'expenses', 'settlements', 'recurring', 'notes', 'folders', 'docfiles', 'flats', 'answers', 'lists', 'items', 'wishes', 'countdowns', 'photos', 'wheel', 'profiles', 'moods', 'milestones', 'coupons', 'scheduled'];
const S = { me: null, users: [], cols: {}, rev: 0, view: 'home', demo: false, dirty: false };
let B = null; // stockage actif
const VIEWS = {};

function h(tag, attrs, ...kids) {
  const el = D.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'c') el.style.setProperty('--c', v);
    else if (k === 'html') el.innerHTML = v; // uniquement pour les icônes SVG internes
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : D.createTextNode(String(c)));
  return el;
}
const ICON = {
  home: 'M3 11.5l9-8 9 8M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9',
  cal: 'M7 3v3M17 3v3M4 9.5h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  euro: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 9a3.6 3.6 0 1 0 0 6M7.5 11h5M7.5 13.2h5',
  flat: 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 7.5h2M13 7.5h2M9 11.5h2M13 11.5h2M10 21v-4.5h4V21',
  grid: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z',
  plus: 'M12 5v14M5 12h14', back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7', x: 'M6 6l12 12M18 6L6 18',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  send: 'M4 12l16-8-6 16-3-6.5z', pin: 'M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  cmp: 'M4 6h16M4 12h16M4 18h16M9 3v18', rep: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5'
};
const icon = n => h('span', { style: { display: 'contents' }, html: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n]}"/></svg>` });

/* ----- dates, argent ----- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const fmtD = (s, opt) => new Intl.DateTimeFormat('fr-FR', opt || { weekday: 'short', day: 'numeric', month: 'short' }).format(pd(s));
const fmtT = ts => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
const eur0 = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const rel = s => { const n = daysBetween(today(), s); return n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : n === -1 ? 'hier' : n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const size = n => n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1e3)) + ' ko';

/* ----- accès aux données ----- */
const all = col => Object.values(S.cols[col] || {});
const other = () => S.users.find(u => u.id !== S.me.id) || S.me;
const nameOf = id => id === 'both' ? 'Nous deux' : (S.users.find(u => u.id === id) || {}).name || '?';
const ucolor = id => S.users.findIndex(u => u.id === id) === 1 ? 'var(--u1)' : 'var(--u0)';
const avatar = (id, sm) => h('span', { class: 'ava' + (sm ? ' sm' : ''), c: ucolor(id) }, nameOf(id).slice(0, 2));
const couple = () => (S.cols.profiles || {})._couple || {};
const profile = id => (S.cols.profiles || {})[id] || { id };

/* ----- stockage serveur ----- */
async function api(method, url, body) {
  const opt = { method, headers: { 'X-Nous': '1' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch (e) { throw new Error('Pas de connexion'); }
  if (r.status === 401 && S.me) { S.me = null; showLogin(); throw new Error('Session expirée'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur serveur');
  return j;
}
function applySync(j) { S.me = j.me; S.users = j.users; S.cols = j.cols; S.rev = j.rev; S.vapid = j.vapid; }
const Remote = {
  async boot() { try { applySync(await api('GET', '/api/sync')); return true; } catch (e) { return false; } },
  async sync() { const j = await api('GET', '/api/sync?rev=' + S.rev); if (j.same) return false; applySync(j); return true; },
  login: (l, p) => api('POST', '/api/login', { login: l, password: p }),
  logout: () => api('POST', '/api/logout', {}),
  put: (col, doc) => api('PUT', `/api/c/${col}/${encodeURIComponent(doc.id)}`, doc).then(() => { S.rev = -1; }),
  del: (col, id) => api('DELETE', `/api/c/${col}/${encodeURIComponent(id)}`).then(() => { S.rev = -1; }),
  upload(blob, name) { const fd = new FormData(); fd.append('file', blob, name); return api('POST', '/api/files', fd); },
  fileUrl: id => '/api/files/' + id,
  delFile: id => api('DELETE', '/api/files/' + id)
};

/* ----- stockage démo (cet appareil uniquement) ----- */
const DEMO_USERS = [{ id: 'mathis', name: 'Mathis' }, { id: 'morgane', name: 'Morgane' }];
const Demo = {
  raw: null, files: {}, meId: null,
  load() {
    try { const j = JSON.parse(localStorage.getItem('nous-demo-v1')); if (j && j.cols) { this.raw = j.cols; this.files = j.files || {}; for (const c of COLS) this.raw[c] = this.raw[c] || {}; return; } } catch (e) { }
    const s = window.nousSeed(); this.raw = s.cols; this.files = s.files;
  },
  save() {
    try { localStorage.setItem('nous-demo-v1', JSON.stringify({ cols: this.raw, files: this.files })); }
    catch (e) { try { localStorage.setItem('nous-demo-v1', JSON.stringify({ cols: this.raw, files: {} })); } catch (e2) { } }
  },
  view() {
    const me = S.me.id, cols = {};
    const mine = new Set(Object.values(this.raw.answers).filter(a => a.user === me).map(a => a.date));
    for (const c of COLS) {
      cols[c] = {};
      for (const d of Object.values(this.raw[c] || {})) {
        let v = d;
        if (c === 'wishes' && d.owner === me) { v = { ...d }; delete v.reservedBy; }
        if (c === 'answers' && d.user !== me && !mine.has(d.date)) v = { id: d.id, date: d.date, user: d.user, hidden: true };
        if (c === 'scheduled' && d.by !== me) continue; // un mot programmé reste secret jusqu'à l'heure
        cols[c][d.id] = v;
      }
    }
    S.cols = cols;
  },
  async boot() {
    if (!this.raw) this.load();
    S.users = DEMO_USERS;
    let me = this.meId; try { me = me || localStorage.getItem('nous-demo-me'); } catch (e) { }
    me = me || 'mathis'; // la démo s'ouvre directement, sans passer par la connexion
    if (me === '-') return false;
    S.me = S.users.find(u => u.id === me) || S.users[0]; this.view(); return true;
  },
  async login(l) {
    const u = DEMO_USERS.find(u => u.id === String(l).trim().toLowerCase());
    if (!u) throw new Error('En démo, connecte-toi avec « mathis » ou « morgane »');
    this.meId = u.id; try { localStorage.setItem('nous-demo-me', u.id); } catch (e) { }
  },
  async logout() { this.meId = '-'; try { localStorage.setItem('nous-demo-me', '-'); } catch (e) { } },
  async sync() { // en démo, c'est l'app qui « livre » les mots programmés arrivés à l'heure
    const d = new Date(), now = `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; let n = 0;
    for (const s of Object.values(this.raw.scheduled || {})) if (s.sendAt <= now) { const id = 'n' + uid(); this.raw.notes[id] = { id, text: s.text, to: s.to, by: s.by, at: Date.now() }; delete this.raw.scheduled[s.id]; n++; }
    if (n) { this.save(); this.view(); } return n > 0;
  },
  async put(col, doc) {
    const prev = this.raw[col][doc.id], d = { ...doc }; delete d.hidden;
    if (col === 'wishes' && prev && prev.owner === S.me.id) { if (prev.reservedBy) d.reservedBy = prev.reservedBy; else delete d.reservedBy; }
    this.raw[col][doc.id] = d; this.save(); this.view();
  },
  async del(col, id) { delete this.raw[col][id]; this.save(); this.view(); },
  async upload(blob, name) {
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    const id = 'f' + uid(); this.files[id] = { name, mime: blob.type, size: blob.size, data }; this.save();
    return { id, name, mime: blob.type, size: blob.size };
  },
  fileUrl(id) { return (this.files[id] || {}).data || ''; },
  async delFile(id) { delete this.files[id]; this.save(); }
};

/* ----- écritures ----- */
function afterWrite() {
  if (S.demo) return render();
  clearTimeout(afterWrite.t); afterWrite.t = setTimeout(doSync, 400);
}
async function put(col, doc) {
  doc.id = doc.id || uid(); doc.by = doc.by || S.me.id; doc.at = Date.now();
  (S.cols[col] = S.cols[col] || {})[doc.id] = doc; render();
  try { await B.put(col, doc); } catch (e) { toast(e.message || 'Enregistrement impossible'); }
  afterWrite(); return doc;
}
async function putMany(col, docs) {
  for (const d of docs) { d.id = d.id || uid(); d.by = d.by || S.me.id; d.at = Date.now(); (S.cols[col] = S.cols[col] || {})[d.id] = d; }
  render();
  try { for (const d of docs) await B.put(col, d); } catch (e) { toast(e.message || 'Enregistrement impossible'); }
  afterWrite();
}
async function del(col, id) {
  if (S.cols[col]) delete S.cols[col][id]; render();
  try { await B.del(col, id); } catch (e) { toast(e.message || 'Suppression impossible'); }
  afterWrite();
}
async function doSync() {
  if (!S.me) return;
  try { if (await B.sync()) { genRecurring(); render(); } } catch (e) { }
}

/* ----- rendu ----- */
const TABS = [['home', 'Accueil', 'home'], ['agenda', 'Agenda', 'cal'], ['comptes', 'Comptes', 'euro'], ['appart', 'Appart', 'flat'], ['plus', 'Plus', 'grid']];
function render(force) {
  if (!S.me) return;
  const root = $('#app'), ae = D.activeElement;
  if (!force && ae && root.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) { S.dirty = true; return; }
  S.dirty = false;
  const v = VIEWS[S.view] || VIEWS.home;
  root.replaceChildren(...[v()].flat(Infinity).filter(Boolean));
  const tabs = $('#tabs'); tabs.hidden = false;
  const cur = TABS.some(t => t[0] === S.view) ? S.view : 'plus';
  tabs.replaceChildren(...TABS.map(([id, lab, ic]) => h('button', { class: 'tab' + (cur === id ? ' on' : ''), onclick: () => go(id), 'aria-current': cur === id ? 'page' : null }, icon(ic), lab)));
}
D.addEventListener('focusout', () => setTimeout(() => { if (S.dirty) render(); }, 80));
function go(view) {
  S.view = view;
  try { if (location.hash.slice(1) !== view) location.hash = view; } catch (e) { }
  window.scrollTo(0, 0); render(true);
}
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (S.me && v && v !== S.view && VIEWS[v]) { S.view = v; window.scrollTo(0, 0); render(true); } });

function head(title, o = {}) {
  return h('div', { class: 'head' },
    o.back && h('button', { class: 'ibtn', 'aria-label': 'Retour', onclick: typeof o.back === 'function' ? o.back : () => go(o.back) }, icon('back')),
    h('div', { class: 'grow' }, o.sub && h('div', { class: 'sub' }, o.sub), h('h1', null, title)),
    o.extra,
    o.add && h('button', { class: 'ibtn pri', 'aria-label': o.addLabel || 'Ajouter', onclick: o.add }, icon('plus')));
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('in');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('in'), 3000);
}
// Champ + bouton d'ajout rapide dans une vue ; garde le focus après l'ajout.
function inlineAdd(id, ph, onAdd, ic) {
  const inp = h('input', { class: 'inp', id, placeholder: ph, autocomplete: 'off', enterKeyHint: 'send' });
  const submit = async e => {
    e.preventDefault(); const t = inp.value.trim(); if (!t) return;
    inp.value = ''; onAdd(t); render(true); const n = $('#' + id); if (n) n.focus();
  };
  return h('form', { class: 'composer', onsubmit: submit }, h('div', { class: 'grow' }, inp), h('button', { class: 'ibtn pri', type: 'submit', 'aria-label': 'Ajouter' }, icon(ic || 'plus')));
}

/* ----- feuilles ----- */
function openSheet(title, body, opts = {}) {
  const root = $('#sheets');
  const scrim = h('div', { class: 'scrim' }), sh = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }), bodyEl = h('div', { class: 'sheet-b' });
  const ctl = {
    el: bodyEl,
    close() { scrim.classList.remove('in'); sh.classList.remove('in'); setTimeout(() => { scrim.remove(); sh.remove(); }, 340); if (opts.onClose) opts.onClose(); },
    refresh() { bodyEl.replaceChildren(...[typeof body === 'function' ? body(ctl) : body].flat(Infinity).filter(Boolean)); }
  };
  sh.append(h('div', { class: 'sheet-h' }, h('h2', null, title), h('button', { class: 'ibtn', 'aria-label': 'Fermer', onclick: ctl.close }, icon('x'))), bodyEl);
  ctl.refresh(); scrim.addEventListener('click', ctl.close); root.append(scrim, sh);
  requestAnimationFrame(() => requestAnimationFrame(() => { scrim.classList.add('in'); sh.classList.add('in'); }));
  return ctl;
}
function confirmSheet(title, text, okLabel, danger) {
  return new Promise(res => {
    let done = false;
    const c = openSheet(title, c => [
      text && h('p', { class: 'muted' }, text),
      h('button', { class: 'btn full ' + (danger ? 'danger' : 'pri'), onclick: () => { done = true; res(true); c.close(); } }, okLabel || 'Confirmer'),
      h('button', { class: 'btn full', onclick: () => c.close() }, 'Annuler')
    ], { onClose: () => { if (!done) res(false); } });
  });
}
function fieldEl(f, v, upd) {
  const id = 'f_' + f.k; let input;
  const set = val => { v[f.k] = val; upd(); };
  if (f.type === 'seg') {
    input = h('div', { class: 'seg', id });
    const draw = () => input.replaceChildren(...f.options.map(([val, lab]) => h('button', { type: 'button', class: v[f.k] === val ? 'on' : '', onclick: () => { set(val); draw(); } }, lab)));
    if (v[f.k] == null) v[f.k] = f.options[0][0]; draw();
  } else if (f.type === 'multi') {
    input = h('div', { class: 'chips', id });
    if (!Array.isArray(v[f.k])) v[f.k] = f.options.map(o => o[0]);
    const draw = () => input.replaceChildren(...f.options.map(([val, lab]) => h('button', { type: 'button', class: 'chip' + (v[f.k].includes(val) ? ' on' : ''), onclick: () => { set(v[f.k].includes(val) ? v[f.k].filter(x => x !== val) : [...v[f.k], val]); draw(); } }, lab)));
    draw();
  } else if (f.type === 'select') {
    if (v[f.k] == null) v[f.k] = f.options[0][0];
    input = h('select', { class: 'inp', id, onchange: e => set(e.target.value) }, f.options.map(([val, lab]) => h('option', { value: val, selected: v[f.k] === val }, lab)));
  } else if (f.type === 'textarea') {
    input = h('textarea', { class: 'inp', id, placeholder: f.ph || '', value: v[f.k] || '', oninput: e => set(e.target.value) });
  } else {
    const num = f.type === 'number';
    input = h('input', { class: 'inp', id, type: f.type || 'text', placeholder: f.ph || '', step: num ? (f.step || 'any') : null, min: f.min, max: f.max, inputMode: num ? 'decimal' : null, autocomplete: f.auto || 'off', value: v[f.k] == null ? '' : v[f.k], oninput: e => set(num ? (e.target.value === '' ? '' : +e.target.value) : e.target.value) });
  }
  return h('div', { class: 'f' }, h('label', { htmlFor: id }, f.label), input, f.hint && h('span', { class: 'small faint', style: { paddingLeft: '4px' } }, f.hint));
}
function formSheet({ title, fields, values = {}, submit = 'Enregistrer', onSubmit, onDelete, deleteLabel }) {
  const v = { ...values }, wraps = [];
  const upd = () => wraps.forEach(([f, w]) => { w.style.display = (!f.showIf || f.showIf(v)) ? '' : 'none'; });
  return openSheet(title, c => {
    wraps.length = 0;
    const form = h('form', {
      class: 'col', style: { gap: '14px' }, onsubmit: async e => {
        e.preventDefault();
        for (const f of fields) if (f.required && (!f.showIf || f.showIf(v)) && (v[f.k] == null || v[f.k] === '')) return toast(`Renseigne « ${f.label} »`);
        const btn = $('button[type=submit]', form); btn.disabled = true;
        let r; try { r = await onSubmit(v); } catch (err) { toast(err.message || 'Erreur'); r = false; }
        btn.disabled = false; if (r !== false) c.close();
      }
    });
    let row = null;
    for (const f of fields) {
      const w = fieldEl(f, v, upd); wraps.push([f, w]);
      if (f.half) { if (!row) { row = h('div', { class: 'frow' }); form.append(row); } row.append(w); if (row.children.length === 2) row = null; }
      else { row = null; form.append(w); }
    }
    form.append(h('button', { class: 'btn pri full', type: 'submit' }, submit));
    if (onDelete) form.append(h('button', { class: 'btn danger full', type: 'button', onclick: async () => { if (await confirmSheet('Supprimer ?', 'Cette action est définitive.', 'Supprimer', true)) { await onDelete(); c.close(); } } }, deleteLabel || 'Supprimer'));
    upd(); return form;
  });
}

/* ----- fichiers ----- */
function pickFiles(accept, multiple) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept: accept || '', multiple: !!multiple, style: { display: 'none' }, onchange: () => { res([...i.files]); i.remove(); } });
    D.body.append(i); i.click();
  });
}
async function shrink(file, max, q) {
  max = max || (S.demo ? 640 : 1800); q = q || (S.demo ? .7 : .84);
  try {
    const bmp = await createImageBitmap(file), s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = D.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', q));
  } catch (e) { return file; }
}
async function uploadImages(files) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    if (files.length > 1) toast(`Envoi ${i + 1}/${files.length}…`);
    try { const b = await shrink(files[i]); out.push(await B.upload(b, files[i].name.replace(/\.[^.]+$/, '') + '.jpg')); }
    catch (e) { toast(e.message || 'Envoi impossible'); }
  }
  return out;
}

/* ----- connexion, démarrage ----- */
function showLogin() {
  $('#tabs').hidden = true; $('#sheets').replaceChildren();
  const v = { login: S.demo ? 'mathis' : '', password: S.demo ? 'demo' : '' };
  const err = h('p', { class: 'small bad', role: 'alert' });
  const form = h('form', {
    class: 'glass card login', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      try { await B.login(v.login, v.password); if (await B.boot()) enter(); else err.textContent = 'Connexion impossible'; }
      catch (ex) { err.textContent = ex.message; }
    }
  },
    h('div', { class: 'logo' }, 'Nous'),
    h('p', { class: 'muted' }, 'Notre espace à deux. Agenda, comptes, appart, petits mots.'),
    h('div', { class: 'f' }, h('label', { htmlFor: 'l_login' }, 'Identifiant'), h('input', { class: 'inp', id: 'l_login', autocomplete: 'username', autocapitalize: 'none', value: v.login, oninput: e => v.login = e.target.value })),
    h('div', { class: 'f' }, h('label', { htmlFor: 'l_pwd' }, 'Mot de passe'), h('input', { class: 'inp', id: 'l_pwd', type: 'password', autocomplete: 'current-password', value: v.password, oninput: e => v.password = e.target.value })),
    err,
    h('button', { class: 'btn pri full', type: 'submit' }, 'Se connecter'),
    S.demo && h('p', { class: 'small faint center' }, 'Version de démonstration : identifiant « mathis » ou « morgane », mot de passe libre. Les données restent sur cet appareil.'));
  $('#app').replaceChildren(form);
}
function ensureDefaults() {
  if (couple().seeded) return;
  B.put('profiles', S.cols.profiles._couple = { id: '_couple', seeded: true, defaultSplit: 'half', pct: 50, budget: 1200, by: S.me.id, at: Date.now() }).catch(() => { });
  const def = {
    folders: [['d_loc', { name: 'Dossier locataire', emoji: '🔑' }], ['d_admin', { name: 'Administratif', emoji: '🗂️' }], ['d_voy', { name: 'Voyages', emoji: '✈️' }]],
    lists: [['l_courses', { name: 'Courses', emoji: '🛒' }], ['l_restos', { name: 'Restos à tester', emoji: '🍜' }], ['l_films', { name: 'Films et séries', emoji: '🎬' }], ['l_sorties', { name: 'Idées de sorties', emoji: '🎡' }]],
    wheel: ['Italien', 'Japonais', 'Burger', 'Thaï', 'Libanais', 'Crêpes', 'Pizza', 'On cuisine'].map((t, i) => ['w_' + i, { text: t }])
  };
  for (const col in def) for (const [id, d] of def[col]) if (!S.cols[col][id]) B.put(col, S.cols[col][id] = { id, ...d, by: S.me.id, at: Date.now() }).catch(() => { });
}
function enter() {
  for (const c of COLS) S.cols[c] = S.cols[c] || {};
  ensureDefaults(); genRecurring();
  const v = location.hash.slice(1); S.view = VIEWS[v] ? v : 'home';
  render(true);
  if (!enter.done) {
    enter.done = true;
    setInterval(() => { if (!D.hidden) doSync(); }, 15000);
    D.addEventListener('visibilitychange', () => { if (!D.hidden) doSync(); });
    if (!S.demo && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
  }
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
async function start() {
  S.demo = !!window.NOUS_DEMO; B = S.demo ? Demo : Remote;
  if (await B.boot()) enter(); else showLogin();
}
