'use strict';
/* Nous — vues secondaires : petits mots, question du jour, photos, documents, listes, envies, comptes à rebours, roue, réglages. */
/* ----- petits mots ----- */
VIEWS.mots = () => {
  const notes = all('notes').sort((a, b) => b.at - a.at).slice(0, 80);
  return [
    head('Petits mots', { back: 'plus' }),
    sec(h('div', { class: 'chips' }, QUICK.map(q => h('button', { class: 'chip', onclick: () => sendNote(q) }, q))),
      inlineAdd('mot_in', `Un mot pour ${other().name}…`, sendNote, 'send'),
      h('p', { class: 'small faint' }, `${other().name} reçoit une notification sur son téléphone.`)),
    schedCard(),
    notes.length ? h('div', { class: 'thread' }, notes.map(n => h('div', { class: 'bub' + (n.by === S.me.id ? ' me' : '') }, n.text, h('time', null, fmtT(n.at))))) : sec(h('div', { class: 'empty' }, 'Envoie le premier mot.'))
  ];
};

/* ----- question du jour ----- */
function streak() {
  const both = d => S.users.every(u => ans(d, u.id));
  let n = 0, d = today(); if (!both(d)) d = addDays(d, -1);
  while (both(d) && n < 999) { n++; d = addDays(d, -1); }
  return n;
}
const ansText = (q, a) => !a ? '' : a.hidden ? '🔒 Réponse cachée' : q.t === 'who' ? nameOf(a.text) : q.t === 'choice' ? (a.text === 'a' ? q.a : q.b) : a.text;
VIEWS.question = () => {
  const t = today(), me = S.me.id, o = other(), q = qOf(t), mine = ans(t, me), his = ans(t, o.id), st = streak();
  const answer = text => put('answers', { id: t + '_' + me, date: t, user: me, text });
  let input;
  if (!mine) {
    if (q.t === 'who') input = h('div', { class: 'frow' }, S.users.map(u => h('button', { class: 'btn', onclick: () => answer(u.id) }, avatar(u.id, true), u.id === me ? 'Moi' : u.name)));
    else if (q.t === 'choice') input = h('div', { class: 'col' }, [['a', q.a], ['b', q.b]].map(([k, l]) => h('button', { class: 'btn full', onclick: () => answer(k) }, l)));
    else input = inlineAdd('q_in', 'Ta réponse…', answer, 'send');
  }
  const past = [];
  for (let i = 1; i <= 30 && past.length < 12; i++) { const d = addDays(t, -i); if (S.users.some(u => ans(d, u.id))) past.push(d); }
  const pair = (d, qq) => S.users.map(u => { const a = ans(d, u.id); return h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(u.id, true), h('div', { class: 'grow' }, a ? ansText(qq, a) : h('span', { class: 'faint' }, 'Pas de réponse'))); });
  return [
    head('Question du jour', { back: 'plus', extra: st ? h('span', { class: 'pill plain', c: 'var(--warn)' }, `🔥 ${st} jour${st > 1 ? 's' : ''}`) : null }),
    sec(h('div', { class: 'eyebrow' }, cap(fmtD(t, { weekday: 'long', day: 'numeric', month: 'long' }))), h('p', { class: 'big', style: { fontSize: '25px' } }, q.t === 'choice' ? q.q : q.q),
      !mine ? [h('p', { class: 'small muted' }, his ? `${o.name} a déjà répondu. Sa réponse s'affiche dès que tu réponds.` : 'Vos réponses se dévoilent quand vous avez répondu tous les deux.'), input]
        : [h('hr', { class: 'sep' }), h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(me, true), h('div', { class: 'grow b' }, ansText(q, mine))),
        his && !his.hidden ? h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(o.id, true), h('div', { class: 'grow b' }, ansText(q, his))) : h('p', { class: 'small muted' }, `En attente de la réponse de ${o.name}…`),
        his && !his.hidden && q.t !== 'open' ? h('span', { class: 'pill plain', c: mine.text === his.text ? 'var(--good)' : 'var(--u1)', style: { alignSelf: 'flex-start' } }, mine.text === his.text ? 'D\'accord tous les deux ✨' : 'Pas d\'accord, débat ce soir 😏') : null]),
    past.length ? sec(eyebrow('Les jours d\'avant'), h('div', { class: 'col', style: { gap: '16px' } }, past.map(d => { const qq = qOf(d); return h('div', { class: 'col', style: { gap: '6px' } }, h('div', { class: 'small muted' }, cap(fmtD(d)) + ' · ' + qText(qq)), pair(d, qq)); }))) : null
  ];
};

/* ----- photos ----- */
function photoSheet(id) {
  const ctl = openSheet('Photo', () => {
    const p = S.cols.photos[id]; if (!p) return h('div', { class: 'empty' }, 'Photo supprimée.');
    return [h('div', { class: 'viewer' }, h('img', { src: B.fileUrl(p.fileId), alt: p.caption || 'Photo' })),
    h('div', { class: 'f' }, h('label', { htmlFor: 'p_cap' }, 'Légende'), h('input', { class: 'inp', id: 'p_cap', placeholder: 'Où, quand, pourquoi on rigole…', value: p.caption || '', onchange: e => put('photos', { ...S.cols.photos[id], caption: e.target.value }) })),
    h('div', { class: 'f' }, h('label', { htmlFor: 'p_date' }, 'Date'), h('input', { class: 'inp', id: 'p_date', type: 'date', value: p.date, onchange: e => e.target.value && put('photos', { ...S.cols.photos[id], date: e.target.value }) })),
    h('p', { class: 'small faint' }, `Ajoutée par ${nameOf(p.by)}`),
    h('button', { class: 'btn danger full', onclick: async () => { if (await confirmSheet('Supprimer cette photo ?', '', 'Supprimer', true)) { B.delFile(p.fileId).catch(() => { }); ctl.close(); del('photos', id); } } }, 'Supprimer')];
  });
}
async function addPhotos() {
  const up = await uploadImages(await pickFiles('image/*', true));
  if (up.length) { await putMany('photos', up.map(u => ({ fileId: u.id, date: today(), caption: '' }))); toast(up.length > 1 ? `${up.length} photos ajoutées` : 'Photo ajoutée'); }
}
VIEWS.photos = () => {
  const ps = all('photos').sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at)), groups = {};
  for (const p of ps) (groups[p.date.slice(0, 7)] = groups[p.date.slice(0, 7)] || []).push(p);
  return [
    head('Photos', { back: 'plus', add: addPhotos, addLabel: 'Ajouter des photos', sub: ps.length ? `${ps.length} souvenir${ps.length > 1 ? 's' : ''}` : null }),
    ps.length ? Object.keys(groups).map(m => sec(h('div', { class: 'eyebrow' }, cap(fmtD(m + '-01', { month: 'long', year: 'numeric' }))), h('div', { class: 'pgrid' }, groups[m].map(p => h('button', { onclick: () => photoSheet(p.id), 'aria-label': p.caption || 'Photo' }, h('img', { src: B.fileUrl(p.fileId), alt: p.caption || '', loading: 'lazy' }))))))
      : sec(h('div', { class: 'empty' }, 'Votre album est vide. Ajoutez vos premières photos avec le bouton +.'))
  ];
};

/* ----- documents ----- */
const fileEmoji = m => /^image\//.test(m) ? '🖼️' : /pdf/.test(m) ? '📕' : /sheet|excel|csv/.test(m) ? '📊' : /word|document|text/.test(m) ? '📝' : /zip|rar|7z/.test(m) ? '🗜️' : '📄';
function openDoc(f) {
  if (/^image\//.test(f.mime)) return openSheet(f.name, () => h('div', { class: 'viewer' }, h('img', { src: B.fileUrl(f.fileId), alt: f.name })));
  if (S.demo) return toast('L\'ouverture des fichiers fonctionne sur la version en ligne');
  const a = h('a', { href: B.fileUrl(f.fileId), target: '_blank', rel: 'noopener' }); D.body.append(a); a.click(); a.remove();
}
VIEWS.docs = () => {
  const folders = all('folders').sort((a, b) => a.name.localeCompare(b.name)), files = all('docfiles');
  const cur = S.folder && S.cols.folders[S.folder];
  if (!cur) return [
    head('Documents', { back: 'plus', add: () => formSheet({ title: 'Nouveau dossier', values: { emoji: '📁' }, fields: [{ k: 'name', label: 'Nom', required: true }, { k: 'emoji', label: 'Emoji' }], onSubmit: v => put('folders', v) }), addLabel: 'Nouveau dossier' }),
    sec(folders.length ? h('div', { class: 'list' }, folders.map(f => { const n = files.filter(x => x.folder === f.id).length; return h('button', { class: 'item', onclick: () => { S.folder = f.id; window.scrollTo(0, 0); render(true); } }, h('span', { class: 'emo' }, f.emoji || '📁'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, f.name), h('div', { class: 'small muted' }, n ? `${n} fichier${n > 1 ? 's' : ''}` : 'Vide')), icon('next')); })) : h('div', { class: 'empty' }, 'Créez un premier dossier avec le bouton +.')),
    h('p', { class: 'small faint center' }, 'Fichiers jusqu\'à 25 Mo, visibles uniquement par vous deux.')
  ];
  const list = files.filter(x => x.folder === cur.id).sort((a, b) => b.at - a.at);
  const add = async () => {
    const fs = await pickFiles('', true);
    for (let i = 0; i < fs.length; i++) {
      toast(`Envoi ${i + 1}/${fs.length}…`);
      try { if (S.demo && fs[i].size > 400e3) throw new Error('En démo, fichiers de 400 ko maximum'); const m = await B.upload(fs[i], fs[i].name); await put('docfiles', { name: m.name, folder: cur.id, fileId: m.id, size: m.size, mime: m.mime }); }
      catch (e) { toast(e.message || 'Envoi impossible'); }
    }
  };
  return [
    head(cur.name, { back: () => { S.folder = null; render(true); }, add, addLabel: 'Ajouter des fichiers' }),
    sec(list.length ? h('div', { class: 'list' }, list.map(f => h('div', { class: 'item' },
      h('button', { class: 'row grow', style: { textAlign: 'left' }, onclick: () => openDoc(f) }, h('span', { class: 'emo' }, fileEmoji(f.mime || '')), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, f.name), h('div', { class: 'small muted' }, `${size(f.size)} · ${nameOf(f.by)} · ${fmtD(iso(new Date(f.at)))}`))),
      h('button', { class: 'ibtn', style: { width: '34px', height: '34px' }, 'aria-label': 'Supprimer ' + f.name, onclick: async () => { if (await confirmSheet('Supprimer ce fichier ?', f.name, 'Supprimer', true)) { B.delFile(f.fileId).catch(() => { }); del('docfiles', f.id); } } }, icon('x'))))) : h('div', { class: 'empty' }, 'Dossier vide. Ajoutez des fichiers avec le bouton +.')),
    !list.length && h('button', { class: 'btn danger', onclick: async () => { if (await confirmSheet('Supprimer ce dossier ?', '', 'Supprimer', true)) { S.folder = null; del('folders', cur.id); } } }, 'Supprimer le dossier')
  ];
};

/* ----- listes ----- */
VIEWS.listes = () => {
  const lists = all('lists').sort((a, b) => (a.at || 0) - (b.at || 0)), items = all('items');
  const cur = S.list && S.cols.lists[S.list];
  if (!cur) return [
    head('Listes', { back: 'plus', add: () => formSheet({ title: 'Nouvelle liste', values: { emoji: '📝' }, fields: [{ k: 'name', label: 'Nom', ph: 'Valise, cadeaux de Noël…', required: true }, { k: 'emoji', label: 'Emoji' }], onSubmit: v => put('lists', v) }), addLabel: 'Nouvelle liste' }),
    lists.length ? h('div', { class: 'grid2' }, lists.map(l => { const its = items.filter(i => i.list === l.id), left = its.filter(i => !i.done).length; return h('button', { class: 'glass card tap', onclick: () => { S.list = l.id; window.scrollTo(0, 0); render(true); } }, h('div', { style: { fontSize: '28px' } }, l.emoji || '📝'), h('div', { class: 'mid' }, l.name), h('div', { class: 'small muted' }, its.length ? (left ? `${left} à faire` : 'Tout est fait ✓') : 'Vide')); })) : sec(h('div', { class: 'empty' }, 'Créez une première liste avec le bouton +.'))
  ];
  const its = items.filter(i => i.list === cur.id).sort((a, b) => (a.done - b.done) || (b.at - a.at)), doneN = its.filter(i => i.done).length;
  return [
    head(`${cur.emoji || ''} ${cur.name}`, { back: () => { S.list = null; render(true); } }),
    sec(inlineAdd('li_in', 'Ajouter…', t => put('items', { list: cur.id, text: t, done: false })),
      its.length ? h('div', { class: 'list' }, its.map(i => h('div', { class: 'item' },
        h('button', { class: 'row grow', style: { textAlign: 'left' }, onclick: () => put('items', { ...i, done: !i.done }) }, h('span', { class: 'check' + (i.done ? ' on' : '') }, i.done ? '✓' : ''), h('span', { class: 'grow ' + (i.done ? 'done-t' : '') }, i.text)),
        cur.id !== 'l_courses' && h('button', { class: 'chip', style: { minHeight: '28px', padding: '0 9px', fontSize: '12px' }, 'aria-label': 'Niveau de budget', onclick: () => put('items', { ...i, lvl: ((i.lvl || 0) + 1) % 4 }) }, i.lvl ? '€'.repeat(i.lvl) : '€ ?'),
        avatar(i.by, true), h('button', { class: 'ibtn', style: { width: '32px', height: '32px' }, 'aria-label': 'Retirer', onclick: () => del('items', i.id) }, icon('x'))))) : h('div', { class: 'empty' }, 'Rien dans cette liste.')),
    h('div', { class: 'row' }, doneN ? h('button', { class: 'btn sm grow', onclick: () => its.filter(i => i.done).forEach(i => del('items', i.id)) }, `Retirer les ${doneN} cochés`) : null,
      h('button', { class: 'btn sm danger grow', onclick: async () => { if (await confirmSheet('Supprimer cette liste ?', '', 'Supprimer', true)) { its.forEach(i => del('items', i.id)); S.list = null; del('lists', cur.id); } } }, 'Supprimer la liste'))
  ];
};

/* ----- envies ----- */
function wishForm(w) {
  formSheet({
    title: w.id ? 'Modifier l\'envie' : 'Nouvelle envie', values: w,
    fields: [{ k: 'text', label: 'Ce qui me ferait plaisir', ph: 'Un livre, un parfum, un week-end…', required: true }, { k: 'url', label: 'Lien (facultatif)', type: 'url', ph: 'https://…' }, { k: 'price', label: 'Prix indicatif (€)', type: 'number' }],
    onSubmit: v => put('wishes', { ...v, owner: S.me.id }), onDelete: w.id ? () => del('wishes', w.id) : null
  });
}
VIEWS.envies = () => {
  const me = S.me.id, o = other(), tab = S.wishTab || 'me';
  const ws = all('wishes').filter(w => w.owner === (tab === 'me' ? me : o.id)).sort((a, b) => b.at - a.at);
  return [
    head('Envies', { back: 'plus', add: tab === 'me' ? () => wishForm({}) : null, addLabel: 'Ajouter une envie' }),
    h('div', { class: 'seg' }, [['me', 'Mes envies'], ['o', `Celles de ${o.name}`]].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { S.wishTab = k; render(true); } }, l))),
    sec(ws.length ? h('div', { class: 'list' }, ws.map(w => h('div', { class: 'item' },
      h('span', { class: 'emo' }, '🎁'),
      h('div', { class: 'grow' }, h('div', { class: 'b' }, w.text), h('div', { class: 'small muted' }, [w.price ? eur0(w.price) : '', w.url ? h('a', { href: w.url, target: '_blank', rel: 'noopener noreferrer' }, 'Voir le lien ↗') : ''].filter(Boolean).flatMap((x, i) => i ? [' · ', x] : [x]))),
      tab === 'me' ? h('button', { class: 'btn sm', onclick: () => wishForm(w) }, 'Modifier')
        : h('button', { class: 'chip' + (w.reservedBy ? ' on' : ''), onclick: () => put('wishes', { ...w, reservedBy: w.reservedBy ? null : me }) }, w.reservedBy ? 'Je m\'en occupe 🤫' : 'Je m\'en occupe')))) : h('div', { class: 'empty' }, tab === 'me' ? 'Note ici ce qui te ferait plaisir.' : `${o.name} n'a encore rien noté.`)),
    h('p', { class: 'small faint center' }, tab === 'me' ? `Tu ne vois pas si ${o.name} a prévu de t'offrir quelque chose. C'est fait exprès.` : `${o.name} ne voit pas ce que tu réserves.`)
  ];
};

/* ----- comptes à rebours ----- */
VIEWS.rebours = () => {
  const t = today(), cs = all('countdowns').sort((a, b) => a.date.localeCompare(b.date));
  const form = c => formSheet({ title: c.id ? 'Modifier' : 'Nouveau compte à rebours', values: { emoji: '🎉', date: addDays(t, 30), ...c }, fields: [{ k: 'title', label: 'Quoi', ph: 'Vacances, anniversaire, festival…', required: true }, { k: 'date', label: 'Date', type: 'date', half: true, required: true }, { k: 'emoji', label: 'Emoji', half: true }], onSubmit: v => put('countdowns', v), onDelete: c.id ? () => del('countdowns', c.id) : null });
  const row = c => { const n = daysBetween(t, c.date); return h('button', { class: 'glass card tap', onclick: () => form(c) }, h('div', { class: 'cd' }, h('div', { class: 'j' }, n === 0 ? 'Jour J' : n > 0 ? 'J-' + n : 'J+' + -n), h('div', { class: 'grow' }, h('div', { class: 'mid' }, (c.emoji || '🎉') + ' ' + c.title), h('div', { class: 'small muted' }, cap(fmtD(c.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))))); };
  const next = cs.filter(c => c.date >= t), past = cs.filter(c => c.date < t).reverse();
  return [head('Comptes à rebours', { back: 'plus', add: () => form({}) }),
  next.length ? next.map(row) : sec(h('div', { class: 'empty' }, 'Ajoutez ce que vous attendez avec impatience.')),
  past.length ? [h('div', { class: 'eyebrow', style: { padding: '6px 4px 0' } }, 'Déjà passés'), past.map(row)] : null];
};

/* ----- roue ----- */
const WCOL = ['#0a7aff', '#ff2d6f', '#af52de', '#ff9500', '#28a85a', '#32ade6', '#ff6b4a', '#5e5ce6'];
VIEWS.roue = () => {
  const lists = all('lists').filter(l => all('items').some(i => i.list === l.id && !i.done)).sort((a, b) => (a.at || 0) - (b.at || 0));
  const src = S.wheelSrc && S.cols.lists[S.wheelSrc] ? S.wheelSrc : 'own', max = S.wheelMax || 0;
  const pool = src === 'own' ? all('wheel').sort((a, b) => (a.at || 0) - (b.at || 0)) : all('items').filter(i => i.list === src && !i.done && (!max || !i.lvl || i.lvl <= max)).sort((a, b) => a.at - b.at);
  const opts = pool.slice(0, 16), n = opts.length;
  const pick = (k, v) => { S[k] = v; S.wheelRes = ''; S.wheelRot = 0; render(true); };
  const cv = h('canvas', { width: 600, height: 600, role: 'img', 'aria-label': 'Roue : ' + opts.map(o => o.text).join(', ') });
  cv.style.transform = `rotate(${S.wheelRot || 0}deg)`;
  if (n) {
    const g = cv.getContext('2d'), a = 2 * Math.PI / n;
    for (let i = 0; i < n; i++) {
      g.beginPath(); g.moveTo(300, 300); g.arc(300, 300, 298, -Math.PI / 2 + i * a, -Math.PI / 2 + (i + 1) * a); g.closePath(); g.fillStyle = WCOL[(n % WCOL.length === 1 && i === n - 1 ? i + 1 : i) % WCOL.length]; g.fill();
      g.save(); g.translate(300, 300); g.rotate(-Math.PI / 2 + (i + .5) * a); g.fillStyle = '#fff'; g.font = `600 ${n > 10 ? 20 : 27}px -apple-system, "Segoe UI", Roboto, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'middle';
      const txt = opts[i].text.length > 17 ? opts[i].text.slice(0, 16) + '…' : opts[i].text; g.fillText(txt, 278, 0); g.restore();
    }
    g.beginPath(); g.arc(300, 300, 34, 0, 7); g.fillStyle = '#fff'; g.fill();
  }
  const res = h('div', { class: 'mid center', style: { minHeight: '30px', fontSize: '22px' }, 'aria-live': 'polite' }, S.wheelRes || '');
  const spin = () => {
    if (n < 2 || S.spinning) return;
    S.spinning = true; S.wheelRes = ''; res.textContent = '';
    const i = Math.floor(Math.random() * n), seg = 360 / n, cur = S.wheelRot || 0;
    S.wheelRot = Math.ceil(cur / 360) * 360 + 360 * 5 + (360 - (i + .5) * seg);
    cv.style.transform = `rotate(${S.wheelRot}deg)`;
    setTimeout(() => { S.spinning = false; S.wheelRes = opts[i].text + ' !'; if (S.view === 'roue') render(true); }, 4300);
  };
  return [
    head('La roue', { back: 'plus', sub: src === 'own' ? 'On mange quoi ce soir ?' : 'On tire au sort dans ' + S.cols.lists[src].name }),
    h('div', { class: 'chips scroll' }, h('button', { class: 'chip' + (src === 'own' ? ' on' : ''), onclick: () => pick('wheelSrc', 'own') }, '🎡 Mes options'), lists.map(l => h('button', { class: 'chip' + (src === l.id ? ' on' : ''), onclick: () => pick('wheelSrc', l.id) }, (l.emoji || '') + ' ' + l.name))),
    src !== 'own' && h('div', { class: 'seg' }, [[0, 'Tout budget'], [1, '€'], [2, '€€ max'], [3, '€€€ max']].map(([k, l]) => h('button', { class: max === k ? 'on' : '', onclick: () => pick('wheelMax', k) }, l))),
    sec(n >= 2 ? [h('div', { class: 'wheelbox' }, cv), res, h('button', { class: 'btn pri full', onclick: spin }, 'Lancer la roue')] : h('div', { class: 'empty' }, src === 'own' ? 'Ajoutez au moins deux options.' : 'Il faut au moins deux idées dans cette liste pour ce budget.')),
    src === 'own' ? sec(eyebrow('Options'), inlineAdd('wh_in', 'Ajouter une option…', t => put('wheel', { text: t })),
      h('div', { class: 'chips' }, opts.map(o => h('button', { class: 'chip', 'aria-label': 'Retirer ' + o.text, onclick: () => del('wheel', o.id) }, o.text, h('span', { class: 'n' }, '✕')))))
      : h('p', { class: 'small faint center' }, 'Les idées viennent de la liste. Le niveau de budget (€, €€, €€€) se règle sur chaque ligne de la liste ; les idées sans niveau sont toujours gardées.')
  ];
};

/* ----- réglages ----- */
function b64u8(s) { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enablePush() {
  if (S.demo) return toast('Les notifications fonctionneront sur morgane.kratox.fr');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return toast('Installe d\'abord l\'app sur l\'écran d\'accueil, puis réessaie');
  try {
    if (await Notification.requestPermission() !== 'granted') return toast('Notifications refusées dans les réglages du téléphone');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(S.vapid) });
    await api('POST', '/api/push/subscribe', { sub: sub.toJSON() });
    S.pushOn = true; toast('Notifications activées sur cet appareil'); render(true);
  } catch (e) { toast('Activation impossible : ' + (e.message || 'erreur')); }
}
async function checkPush() {
  if (S.demo || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); const on = !!sub && Notification.permission === 'granted'; if (on !== !!S.pushOn) { S.pushOn = on; if (S.view === 'reglages') render(); } } catch (e) { }
}
VIEWS.reglages = () => {
  const me = S.me, pr = profile(me.id), cp = couple();
  const setP = patch => put('profiles', { ...pr, id: me.id, ...patch });
  const setC = patch => put('profiles', { ...cp, id: '_couple', ...patch });
  checkPush();
  const sw = (on, fn, label) => h('button', { class: 'chip' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: fn }, on ? 'Activé' : 'Désactivé');
  return [
    head('Réglages', { back: 'plus' }),
    sec(h('div', { class: 'row' }, avatar(me.id), h('div', { class: 'grow' }, h('div', { class: 'mid' }, me.name), h('div', { class: 'small muted' }, 'Connecté sur cet appareil'))),
      h('div', { class: 'f' }, h('label', { htmlFor: 's_home' }, 'Ma ville habituelle'), h('select', { class: 'inp', id: 's_home', onchange: e => setP({ home: e.target.value }) }, [['', 'Non précisée'], ...PLACES.slice(0, 3).map(p => [p[0], p[0]])].map(([v, l]) => h('option', { value: v, selected: (pr.home || '') === v }, l))), h('span', { class: 'small faint', style: { paddingLeft: '4px' } }, 'Utilisée les jours où tu n\'as rien indiqué dans l\'agenda.'))),
    sec(eyebrow('Notifications'),
      h('div', { class: 'row between' }, h('div', { class: 'grow' }, h('div', { class: 'b' }, 'Sur cet appareil'), h('div', { class: 'small muted' }, S.pushOn ? 'Les petits mots arrivent ici.' : 'À activer sur chaque téléphone.')), S.pushOn ? h('button', { class: 'btn sm', onclick: async () => { try { const r = await api('POST', '/api/push/test', {}); toast(r.devices ? 'Notification de test envoyée' : 'Aucun appareil abonné'); } catch (e) { toast(e.message); } } }, 'Tester') : h('button', { class: 'btn sm pri', onclick: enablePush }, 'Activer')),
      h('div', { class: 'row between' }, h('div', { class: 'grow' }, h('div', { class: 'b' }, 'Activité de l\'autre'), h('div', { class: 'small muted' }, 'Agenda, dépenses, appart, photos, question du jour. Les petits mots arrivent toujours.')), sw(pr.notifActivity !== false, () => setP({ notifActivity: pr.notifActivity === false }), 'Activité de l\'autre'))),
    sec(eyebrow('À deux'),
      h('div', { class: 'f' }, h('label', { htmlFor: 's_bud' }, 'Budget logement maximum, charges comprises (€)'), h('input', { class: 'inp', id: 's_bud', type: 'number', inputMode: 'numeric', value: cp.budget == null ? '' : cp.budget, onchange: e => setC({ budget: +e.target.value || 0 }) })),
      h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Répartition par défaut des dépenses'), h('div', { class: 'seg' }, [['half', 'Moitié-moitié'], ['pct', 'Au prorata']].map(([k, l]) => h('button', { class: (cp.defaultSplit || 'half') === k ? 'on' : '', onclick: () => setC({ defaultSplit: k }) }, l)))),
      cp.defaultSplit === 'pct' && h('div', { class: 'f' }, h('label', { htmlFor: 's_pct' }, `Part de ${S.users[0].name} (%)`), h('input', { class: 'inp', id: 's_pct', type: 'number', min: 0, max: 100, value: cp.pct == null ? 50 : cp.pct, onchange: e => setC({ pct: Math.max(0, Math.min(100, +e.target.value || 0)) }) }))),
    sec(eyebrow('Application'),
      S.installEvt ? h('button', { class: 'btn pri full', onclick: async () => { S.installEvt.prompt(); S.installEvt = null; render(true); } }, 'Installer sur l\'écran d\'accueil')
        : h('p', { class: 'small muted' }, 'Pour l\'avoir comme une vraie app : sur Android, menu ⋮ de Chrome puis « Installer l\'application ». Sur iPhone, bouton Partager de Safari puis « Sur l\'écran d\'accueil ».'),
      !S.demo && h('button', { class: 'btn full', onclick: () => formSheet({ title: 'Changer de mot de passe', submit: 'Changer', fields: [{ k: 'old', label: 'Mot de passe actuel', type: 'password', auto: 'current-password', required: true }, { k: 'next', label: 'Nouveau (10 caractères minimum)', type: 'password', auto: 'new-password', required: true }], onSubmit: async v => { await api('POST', '/api/password', v); toast('Mot de passe changé'); } }) }, 'Changer de mot de passe'),
      S.demo && h('button', { class: 'btn full', onclick: async () => { await B.login(other().id); await B.boot(); toast(`Tu vois l'app comme ${S.me.name}`); go('home'); } }, `Voir l'app comme ${other().name}`),
      S.demo && h('button', { class: 'btn full', onclick: async () => { if (await confirmSheet('Remettre la démo à zéro ?', 'Les données d\'exemple reviennent.', 'Remettre à zéro', true)) { try { localStorage.removeItem('nous-demo-v1'); } catch (e) { } Demo.raw = null; await B.boot(); go('home'); } } }, 'Réinitialiser la démo'),
      h('button', { class: 'btn danger full', onclick: async () => { try { await B.logout(); } catch (e) { } S.me = null; showLogin(); } }, 'Se déconnecter'),
      MYV && h('p', { class: 'tiny faint center' }, 'Version ' + MYV))
  ];
};
