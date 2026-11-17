'use strict';
/* Nous — Instant du jour (façon BeReal) : un signal à une heure surprise, une photo par jour chacun,
   et la photo de l'autre ne se dévoile qu'une fois la sienne postée (vérifié aussi côté serveur). */
const snapOf = (d, u) => (S.cols.snaps || {})[d + '_' + u];
const SNAP_REACTS = ['😍', '😂', '🥰', '😮', '🔥', '👍'];
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/* ----- composition : photo arrière plein cadre, selfie en médaillon ----- */
async function composeSnap(back, front) {
  const W = S.demo ? 600 : 1080, H = Math.round(W * 4 / 3);
  const cv = D.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const clip = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
  const draw = async (file, x, y, w, h, r) => {
    const b = await createImageBitmap(file), s = Math.max(w / b.width, h / b.height), dw = b.width * s, dh = b.height * s;
    g.save(); if (r) { clip(x, y, w, h, r); g.clip(); }
    g.drawImage(b, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); g.restore();
  };
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  await draw(back, 0, 0, W, H, 0);
  if (front) {
    const fw = Math.round(W * .3), fh = Math.round(fw * 4 / 3), m = Math.round(W * .04), r = Math.round(W * .035), b = Math.round(W * .006);
    g.fillStyle = '#000'; clip(m - b, m - b, fw + 2 * b, fh + 2 * b, r + b); g.fill();
    await draw(front, m, m, fw, fh, r);
  }
  return await new Promise((res, rej) => cv.toBlob(x => x ? res(x) : rej(new Error('Image illisible')), 'image/jpeg', S.demo ? .72 : .86));
}

/* ----- prise de l'instant : appareil arrière, puis selfie (un tap chacun : le téléphone l'exige) ----- */
function takeSnap() {
  if (snapOf(today(), S.me.id)) return toast('Tu as déjà pris ton instant aujourd\'hui');
  pickFiles('image/*', false, 'environment').then(fs => { if (fs.length) snapStep2(fs[0]); });
}
function snapStep2(back) {
  const url = URL.createObjectURL(back); let busy = false;
  const publish = async front => {
    if (busy) return; busy = true; toast('Publication…');
    try {
      const blob = await composeSnap(back, front);
      const m = await B.upload(blob, `instant-${today()}.jpg`);
      await put('snaps', { id: today() + '_' + S.me.id, date: today(), user: S.me.id, fileId: m.id, when: hhmm(), onTime: S.demo ? true : undefined, reactions: {} });
      c.close(); URL.revokeObjectURL(url);
      toast(S.demo ? `Publié ⚡ En vrai, ${other().name} est prévenu` : 'Instant publié ⚡');
    } catch (e) { busy = false; toast(e.message || 'Publication impossible'); }
  };
  const c = openSheet('Ton instant', () => [
    h('div', { class: 'viewer' }, h('img', { src: url, alt: 'Aperçu de ta photo' })),
    h('button', { class: 'btn pri full', onclick: () => pickFiles('image/*', false, 'user').then(fs => { if (fs.length) publish(fs[0]); }) }, '🤳 Ajouter un selfie et publier'),
    h('button', { class: 'btn full', onclick: () => publish(null) }, 'Publier sans selfie'),
    h('p', { class: 'small faint center' }, `${other().name} ne verra ta photo qu'après avoir posté la sienne, et inversement.`)
  ], { onClose: () => { if (!busy) URL.revokeObjectURL(url); } });
}

/* ----- affichage ----- */
function snapFrame(s, u) {
  if (s && !s.hidden) return h('button', { class: 'snapf', 'aria-label': `Instant de ${nameOf(u)}`, onclick: () => snapSheet(s) },
    h('img', { src: B.fileUrl(s.fileId), alt: '', loading: 'lazy' }),
    h('span', { class: 'snaptag' }, nameOf(u) + (s.when ? ' · ' + s.when : '') + (s.onTime ? ' ⚡' : '')),
    s.reactions && Object.keys(s.reactions).length ? h('span', { class: 'snapre' }, Object.values(s.reactions).join('')) : null);
  const today_ = s ? s.date === today() : true;
  return h('div', { class: 'snapf empty' + (s ? ' locked' : '') },
    h('div', { style: { fontSize: '30px' } }, s ? '🔒' : '⏳'),
    h('div', { class: 'small b' }, s ? `${nameOf(u)} a posté` : u === S.me.id ? 'Pas d\'instant' : `En attente de ${nameOf(u)}`),
    s ? h('div', { class: 'tiny muted' }, today_ ? 'Poste le tien pour le voir' : 'Tu n\'avais pas posté ce jour-là') : null);
}
function snapSheet(s) {
  const mine = s.user === S.me.id;
  openSheet(mine ? 'Ton instant' : `Instant de ${nameOf(s.user)}`, c => {
    const cur = (S.cols.snaps || {})[s.id] || s, re = cur.reactions || {};
    return [
      h('div', { class: 'viewer' }, h('img', { src: B.fileUrl(cur.fileId), alt: `Instant de ${nameOf(cur.user)}` })),
      h('div', { class: 'small muted' }, `${cap(fmtD(cur.date, { weekday: 'long', day: 'numeric', month: 'long' }))}${cur.when ? ' à ' + cur.when : ''}${cur.onTime ? ' · ⚡ pris à l\'heure' : cur.lateMin ? ` · ${cur.lateMin >= 60 ? Math.floor(cur.lateMin / 60) + ' h ' + pad(cur.lateMin % 60) : cur.lateMin + ' min'} après le signal` : ''}`),
      mine ? (Object.keys(re).length ? h('div', { class: 'chips' }, Object.entries(re).map(([u, e]) => h('span', { class: 'chip' }, avatar(u, true), ' ', e))) : h('p', { class: 'small faint' }, 'Pas encore de réaction.'))
        : h('div', { class: 'chips' }, SNAP_REACTS.map(e => h('button', { class: 'chip' + (re[S.me.id] === e ? ' on' : ''), style: { fontSize: '22px' }, 'aria-label': 'Réagir ' + e, onclick: async () => { const r = { ...re }; if (r[S.me.id] === e) delete r[S.me.id]; else r[S.me.id] = e; await put('snaps', { ...cur, reactions: r }); c.refresh(); } }, e))),
      mine && cur.date === today() ? h('button', { class: 'btn danger full', onclick: async () => { if (await confirmSheet('Supprimer ton instant ?', 'Tu pourras en reprendre un aujourd\'hui.', 'Supprimer', true)) { B.delFile(cur.fileId).catch(() => { }); c.close(); del('snaps', cur.id); } } }, 'Supprimer et reprendre') : null
    ];
  });
}
function snapStreak() {
  const both = d => S.users.every(u => snapOf(d, u.id));
  let n = 0, d = today(); if (!both(d)) d = addDays(d, -1);
  while (both(d) && n < 999) { n++; d = addDays(d, -1); }
  return n;
}
function snapCard() {
  const t = today(), me = S.me.id, o = other(), mine = snapOf(t, me), his = snapOf(t, o.id);
  const sig = S.snapAt ? h('span', { class: 'pill plain', c: 'var(--u1)' }, '⚡ ' + S.snapAt) : h('span', { class: 'tiny faint' }, 'Signal surprise à venir');
  return h('section', { class: 'glass card' }, eyebrow('Instant du jour', sig),
    h('div', { class: 'snapgrid' }, snapFrame(his, o.id),
      mine ? snapFrame(mine, me) : h('button', { class: 'snapf empty take', onclick: takeSnap }, h('div', { style: { fontSize: '32px' } }, '📸'), h('div', { class: 'b' }, 'Prendre mon instant'), h('div', { class: 'tiny muted' }, S.snapAt ? 'C\'est l\'heure !' : 'Dès maintenant ou au signal'))),
    h('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onclick: () => go('instants') }, 'Tous les instants'));
}
VIEWS.instants = () => {
  const days = [...new Set(all('snaps').map(s => s.date))].sort().reverse(), st = snapStreak(), t = today();
  if (!days.includes(t)) days.unshift(t);
  return [
    head('Instants', { back: 'plus', sub: 'Une photo par jour, sur le moment', extra: st ? h('span', { class: 'pill plain', c: 'var(--warn)' }, `🔥 ${st} jour${st > 1 ? 's' : ''}`) : null }),
    days.map(d => sec(eyebrow(cap(fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' })), d === t && S.snapAt ? h('span', { class: 'pill plain', c: 'var(--u1)' }, '⚡ ' + S.snapAt) : null),
      h('div', { class: 'snapgrid' }, S.users.map(u => d === t && u.id === S.me.id && !snapOf(d, u.id)
        ? h('button', { class: 'snapf empty take', onclick: takeSnap }, h('div', { style: { fontSize: '32px' } }, '📸'), h('div', { class: 'b' }, 'Prendre mon instant'))
        : snapFrame(snapOf(d, u.id), u.id)))))
  ];
};
