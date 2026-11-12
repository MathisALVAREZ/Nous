'use strict';
/* Nous — le côté mignon : humeur du jour, notre histoire, bons à offrir, mots programmés. */

/* ----- humeur du jour ----- */
const MOODS = ['😊', '🥰', '😍', '😎', '🥳', '😴', '😐', '🥺', '😢', '😤', '🤯', '🤒'];
const moodOf = (u, d) => (S.cols.moods || {})[d + '_' + u];
function moodSheet() {
  const t = today(), cur = moodOf(S.me.id, t) || {}, v = { emoji: cur.emoji || '', text: cur.text || '' };
  openSheet('Ton humeur du jour', c => [
    h('div', { class: 'chips', style: { justifyContent: 'center' } }, MOODS.map(m => h('button', { class: 'chip' + (v.emoji === m ? ' on' : ''), style: { fontSize: '24px', minHeight: '50px', minWidth: '50px', justifyContent: 'center' }, 'aria-label': 'Humeur ' + m, onclick: () => { v.emoji = m; c.refresh(); } }, m))),
    h('div', { class: 'f' }, h('label', { htmlFor: 'mood_t' }, 'Un mot (facultatif)'), h('input', { class: 'inp', id: 'mood_t', maxLength: 80, placeholder: 'Crevé mais content, hâte d\'être à ce soir…', value: v.text, oninput: e => v.text = e.target.value })),
    h('button', { class: 'btn pri full', onclick: () => { if (!v.emoji) return toast('Choisis un emoji'); put('moods', { id: t + '_' + S.me.id, date: t, user: S.me.id, emoji: v.emoji, text: v.text.trim() }); c.close(); } }, 'Enregistrer')
  ]);
}
function moodCard() {
  const t = today();
  return sec(eyebrow('Humeur du jour'), h('div', { class: 'where' }, S.users.map(u => {
    const m = moodOf(u.id, t), mine = u.id === S.me.id;
    return h(mine ? 'button' : 'div', { class: 'moodcell', onclick: mine ? moodSheet : null },
      h('span', { class: 'emo', style: { fontSize: '24px' } }, m ? m.emoji : '·'),
      h('div', { class: 'grow' }, h('div', { class: 'b ell' }, u.name), h('div', { class: 'small muted' }, m ? (m.text || 'Sans commentaire') : mine ? 'Dis comment ça va' : 'Pas encore dit')));
  })));
}

/* ----- souvenir du jour ----- */
function flashback() {
  const t = today(), y = +t.slice(0, 4), md = t.slice(4);
  for (const m of all('milestones')) if (m.date.slice(4) === md && +m.date.slice(0, 4) < y) { const n = y - +m.date.slice(0, 4); return { label: `Il y a ${n} an${n > 1 ? 's' : ''} aujourd'hui`, text: (m.emoji || '✨') + ' ' + m.title, go: 'histoire' }; }
  const back = (months) => { const d = pd(t); d.setMonth(d.getMonth() - months); return d.getDate() === +t.slice(8) ? iso(d) : null; };
  for (const [months, label] of [[12, 'Il y a un an aujourd\'hui'], [24, 'Il y a deux ans aujourd\'hui'], [36, 'Il y a trois ans aujourd\'hui'], [6, 'Il y a six mois'], [1, 'Il y a un mois']]) {
    const d = back(months); if (!d) continue;
    const p = all('photos').find(x => x.date === d); if (p) return { label, photo: p, text: p.caption || '', go: 'photos' };
    const n = all('notes').find(x => iso(new Date(x.at)) === d); if (n) return { label, text: `« ${n.text} »`, who: n.by, go: 'mots' };
  }
  return null;
}
function flashCard() {
  const f = flashback(); if (!f) return null;
  return h('button', { class: 'glass card tap', onclick: () => go(f.go) }, h('div', { class: 'eyebrow' }, f.label),
    h('div', { class: 'row' }, f.photo ? h('img', { src: B.fileUrl(f.photo.fileId), alt: '', style: { width: '72px', height: '72px', objectFit: 'cover', borderRadius: '16px', flex: 'none' } }) : f.who ? avatar(f.who) : null, h('div', { class: 'mid grow' }, f.text || 'Un souvenir en photo')));
}

/* ----- notre histoire ----- */
VIEWS.histoire = () => {
  const t = today(), cp = couple(), ms = all('milestones').sort((a, b) => b.date.localeCompare(a.date));
  const form = m => formSheet({
    title: m.id ? 'Modifier' : 'Nouveau moment', values: { emoji: '✨', date: t, ...m },
    fields: [{ k: 'title', label: 'Quoi', ph: 'Premier rendez-vous, premier voyage, les clés de l\'appart…', required: true }, { k: 'date', label: 'Date', type: 'date', half: true, required: true }, { k: 'emoji', label: 'Emoji', half: true }, { k: 'note', label: 'Un souvenir à garder', type: 'textarea', ph: 'Ce qu\'il s\'est passé, ce qu\'on s\'est dit…' }],
    onSubmit: v => put('milestones', v), onDelete: m.id ? () => del('milestones', m.id) : null
  });
  const setSince = () => formSheet({ title: 'Ensemble depuis', values: { since: cp.since || t }, fields: [{ k: 'since', label: 'Date', type: 'date', required: true }], onSubmit: v => put('profiles', { ...cp, id: '_couple', since: v.since }) });
  let top;
  if (cp.since && cp.since <= t) {
    const days = daysBetween(cp.since, t), y = +t.slice(0, 4);
    let next = y + cp.since.slice(4); if (next < t) next = (y + 1) + cp.since.slice(4);
    const inD = daysBetween(t, next), yrs = +next.slice(0, 4) - +cp.since.slice(0, 4);
    top = h('button', { class: 'glass card tap', onclick: setSince }, h('div', { class: 'eyebrow' }, 'Ensemble depuis'),
      h('div', { class: 'big num' }, `${new Intl.NumberFormat('fr-FR').format(days)} jour${days > 1 ? 's' : ''}`),
      h('div', { class: 'small muted' }, `Depuis le ${fmtD(cp.since, { day: 'numeric', month: 'long', year: 'numeric' })} · ${inD === 0 ? `${yrs} an${yrs > 1 ? 's' : ''} aujourd'hui 🥂` : `${yrs} an${yrs > 1 ? 's' : ''} dans ${inD} jour${inD > 1 ? 's' : ''}`}`));
  } else top = h('button', { class: 'glass card tap', onclick: setSince }, h('div', { class: 'eyebrow' }, 'Ensemble depuis'), h('div', { class: 'mid' }, 'Indiquer la date de votre rencontre'), h('div', { class: 'small muted' }, 'Pour compter les jours et fêter les anniversaires.'));
  return [
    head('Notre histoire', { back: 'plus', add: () => form({}), addLabel: 'Ajouter un moment' }),
    top,
    ms.length ? sec(h('div', { class: 'tl story' }, ms.map(m => h('button', { c: 'var(--u1)', onclick: () => form(m) },
      h('div', { class: 'small muted' }, cap(fmtD(m.date, { day: 'numeric', month: 'long', year: 'numeric' })) + ' · ' + rel(m.date)),
      h('div', { class: 'mid' }, (m.emoji || '✨') + ' ' + m.title), m.note && h('div', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, m.note)))))
      : sec(h('div', { class: 'empty' }, 'Ajoutez vos dates clés : la rencontre, le premier voyage, l\'emménagement…'))
  ];
};

/* ----- bons à offrir ----- */
const BON_IDEAS = [['💆', 'Un massage'], ['🍳', 'Petit-déj au lit'], ['🧽', 'Je fais la vaisselle une semaine'], ['🎬', 'Tu choisis le film, sans discussion'], ['🍝', 'Je cuisine ton plat préféré'], ['🛋️', 'Une soirée où tu ne fais rien'], ['🤐', 'Un joker « tu as raison »'], ['🍰', 'Un dessert quand tu veux']];
VIEWS.bons = () => {
  const me = S.me.id, o = other(), tab = S.bonTab || 'recus';
  const list = all('coupons').filter(c => tab === 'recus' ? c.to === me : c.from === me).sort((a, b) => (!!a.usedAt - !!b.usedAt) || b.at - a.at);
  const offer = () => {
    const v = { emoji: '🎟️', title: '' };
    openSheet(`Offrir un bon à ${o.name}`, c => [
      h('div', { class: 'chips' }, BON_IDEAS.map(([e, t]) => h('button', { class: 'chip' + (v.title === t ? ' on' : ''), onclick: () => { v.emoji = e; v.title = t; c.refresh(); } }, e + ' ' + t))),
      h('div', { class: 'f' }, h('label', { htmlFor: 'bon_t' }, 'Bon pour…'), h('input', { class: 'inp', id: 'bon_t', maxLength: 90, placeholder: 'Ton idée', value: v.title, oninput: e => v.title = e.target.value })),
      h('button', { class: 'btn pri full', onclick: () => { if (!v.title.trim()) return toast('Écris ce que tu offres'); put('coupons', { title: v.title.trim(), emoji: v.emoji, from: me, to: o.id }); S.bonTab = 'offerts'; c.close(); toast(S.demo ? `En vrai, ${o.name} reçoit une notification` : `Bon offert à ${o.name} 🎟️`); } }, 'Offrir')
    ]);
  };
  const use = async c => { if (await confirmSheet('Utiliser ce bon ?', `« ${c.title} ». ${o.name} est prévenu tout de suite.`, 'Je l\'utilise')) put('coupons', { ...c, usedAt: Date.now() }); };
  return [
    head('Bons', { back: 'plus', add: offer, addLabel: 'Offrir un bon' }),
    h('div', { class: 'seg' }, [['recus', 'Reçus'], ['offerts', 'Offerts']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { S.bonTab = k; render(true); } }, l))),
    list.length ? list.map(c => h('div', { class: 'glass card coupon' + (c.usedAt ? ' used' : '') },
      h('div', { class: 'row' }, h('span', { class: 'emo', style: { fontSize: '24px', width: '48px', height: '48px' } }, c.emoji || '🎟️'),
        h('div', { class: 'grow' }, h('div', { class: 'tiny muted b', style: { textTransform: 'uppercase' } }, 'Bon pour'), h('div', { class: 'mid' }, c.title), h('div', { class: 'small muted' }, c.usedAt ? `Utilisé le ${fmtD(iso(new Date(c.usedAt)))}` : `Offert par ${nameOf(c.from)} le ${fmtD(iso(new Date(c.at)))}`))),
      !c.usedAt && (tab === 'recus' ? h('button', { class: 'btn pri full', onclick: () => use(c) }, 'Utiliser') : h('button', { class: 'btn sm danger', style: { alignSelf: 'flex-start' }, onclick: async () => { if (await confirmSheet('Reprendre ce bon ?', '', 'Reprendre', true)) del('coupons', c.id); } }, 'Reprendre'))))
      : sec(h('div', { class: 'empty' }, tab === 'recus' ? `${o.name} ne t'a pas encore offert de bon.` : `Offre un premier bon à ${o.name} avec le bouton +.`))
  ];
};

/* ----- mots programmés ----- */
const nowLocal = () => { const d = new Date(); return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtWhen = s => `${cap(fmtD(s.slice(0, 10)))} à ${s.slice(11, 16)}`;
function scheduleSheet(text) {
  const d = new Date(Date.now() + 3600e3);
  formSheet({
    title: 'Programmer un mot', submit: 'Programmer', values: { text: text || '', sendAt: `${iso(d)}T${pad(d.getHours())}:00` },
    fields: [{ k: 'text', label: `Ton mot pour ${other().name}`, type: 'textarea', ph: 'Bravo pour ton service, je t\'attends à la maison…', required: true }, { k: 'sendAt', label: 'Arrive le', type: 'datetime-local', required: true, hint: `${other().name} ne voit rien avant l'heure choisie.` }],
    onSubmit: v => { if (v.sendAt <= nowLocal()) { toast('Choisis une heure à venir'); return false; } put('scheduled', { text: v.text.trim(), to: other().id, sendAt: v.sendAt }); toast('Mot programmé ⏰'); }
  });
}
function schedCard() {
  const list = all('scheduled').filter(s => s.by === S.me.id).sort((a, b) => a.sendAt.localeCompare(b.sendAt));
  return sec(eyebrow('Mots programmés', h('button', { class: 'btn sm', onclick: () => scheduleSheet('') }, 'Programmer')),
    list.length ? h('div', { class: 'list' }, list.map(s => h('div', { class: 'item' }, h('span', { class: 'emo' }, '⏰'), h('div', { class: 'grow' }, h('div', { class: 'ell' }, s.text), h('div', { class: 'small muted' }, fmtWhen(s.sendAt))), h('button', { class: 'ibtn', style: { width: '32px', height: '32px' }, 'aria-label': 'Annuler ce mot', onclick: () => del('scheduled', s.id) }, icon('x')))))
      : h('p', { class: 'small muted' }, 'Écris maintenant, il arrive à l\'heure que tu choisis. Par exemple à la fin de son service.'));
}
