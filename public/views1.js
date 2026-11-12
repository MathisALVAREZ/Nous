'use strict';
/* Nous — vues principales : accueil, agenda, comptes, appart. */
const PLACES = [['Paris', '#7c7aff'], ['Bordeaux', '#ff4d88'], ['Gif-sur-Yvette', '#30c172'], ['Ailleurs', '#ffa726']];
const placeTag = (p, empty) => h('div', { class: 'small b ell ptag' }, p ? h('i', { class: 'dot', c: pcolor(p) }) : null, p || empty);
const pcolor = p => (PLACES.find(x => x[0] === p) || [0, '#ff9f0a'])[1];
const placeOf = (u, d) => { const e = (S.cols.places || {})[d + '_' + u]; return (e && e.place) || profile(u).home || null; };
const KINDS = [['event', 'Événement', '📌'], ['soiree', 'Soirée', '🥂'], ['service', 'Service', '🍽️'], ['cours', 'Cours', '🎓'], ['travail', 'Travail', '💼'], ['trajet', 'Trajet', '🚄']];
const kindOf = k => KINDS.find(x => x[0] === k) || KINDS[0];
const CATS = [['courses', '🛒', 'Courses'], ['resto', '🍝', 'Restos et bars'], ['logement', '🏠', 'Logement'], ['transport', '🚄', 'Transport'], ['sorties', '🎟️', 'Sorties'], ['voyage', '✈️', 'Voyages'], ['abos', '📺', 'Abonnements'], ['cadeaux', '🎁', 'Cadeaux'], ['autre', '💸', 'Autre']];
const catOf = c => CATS.find(x => x[0] === c) || CATS[CATS.length - 1];
const FST = [['repere', 'Repéré', '#8e8e93'], ['contacte', 'Contacté', '#0a84ff'], ['visite', 'Visite prévue', '#af52de'], ['dossier', 'Dossier envoyé', '#ff9500'], ['accepte', 'Accepté', '#28a85a'], ['refuse', 'Refusé', '#e0323a']];
const stOf = s => FST.find(x => x[0] === s) || FST[0];
const WD = [[1, 'L'], [2, 'M'], [3, 'M'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const qOf = d => { const Q = window.NOUS_QUESTIONS, [y, m, dd] = d.split('-').map(Number), n = Math.floor((Date.UTC(y, m - 1, dd) - Date.UTC(2026, 0, 1)) / 864e5); return Q[((n % Q.length) + Q.length) % Q.length]; };
const qText = q => q.t === 'choice' ? `${q.q} ${q.a} ou ${q.b} ?` : q.q;
const ans = (d, u) => (S.cols.answers || {})[d + '_' + u];
const sec = (...k) => h('section', { class: 'glass card' }, ...k);
const eyebrow = (t, right) => h('div', { class: 'row between' }, h('div', { class: 'eyebrow' }, t), right);

/* ================= ACCUEIL ================= */
function together() {
  const us = S.users; if (us.length < 2) return null;
  const t = today();
  for (let i = 0; i < 180; i++) {
    const d = addDays(t, i), a = placeOf(us[0].id, d), b = placeOf(us[1].id, d);
    if (a && a === b) {
      let end = d;
      for (let k = 0; k < 90; k++) { const n = addDays(end, 1); if (placeOf(us[0].id, n) === a && placeOf(us[1].id, n) === a) end = n; else break; }
      return { date: d, place: a, in: i, end };
    }
  }
  return null;
}
function balance() { // > 0 : l'autre me doit
  const me = S.me.id; let b = 0;
  for (const e of all('expenses')) {
    const a = +e.amount || 0, sh = shareOf(e);
    for (const u of S.users) if (u.id !== e.paidBy) { const owe = Math.round(a * sh[u.id] * 100) / 100; if (e.paidBy === me) b += owe; else if (u.id === me) b -= owe; }
  }
  for (const s of all('settlements')) { if (s.from === me) b += +s.amount; else if (s.to === me) b -= +s.amount; }
  return Math.round(b * 100) / 100;
}
function shareOf(e) {
  const r = {};
  for (const u of S.users) r[u.id] = e.split === 'payer' ? (u.id === e.paidBy ? 1 : 0) : e.split === 'other' ? (u.id === e.paidBy ? 0 : 1) : e.split === 'pct' && e.shares ? (+e.shares[u.id] || 0) / 100 : .5;
  return r;
}
const needsRelance = f => (f.status === 'contacte' || f.status === 'dossier') && (Date.now() - (f.lastActionAt || f.at || Date.now())) / 864e5 >= 5;
function sendNote(text) {
  put('notes', { text, to: other().id });
  toast(S.demo ? `En vrai, ${other().name} reçoit une notification` : `Envoyé à ${other().name} 💌`);
}
const QUICK = ['Je pense à toi 💭', 'Tu me manques 🥺', 'Bien rentré 🏠', 'Bonne journée ☀️', 'Bon courage 💪', 'Je t\'aime ❤️', 'Bonne nuit 🌙', 'J\'arrive 🏃'];
function quickNote() {
  let txt = '';
  openSheet(`Un mot pour ${other().name}`, c => [
    h('div', { class: 'chips' }, QUICK.map(q => h('button', { class: 'chip', onclick: () => { sendNote(q); c.close(); } }, q))),
    h('div', { class: 'f' }, h('label', { htmlFor: 'qn' }, 'Ou ton message'), h('textarea', { class: 'inp', id: 'qn', placeholder: 'Écris ce que tu veux…', oninput: e => txt = e.target.value })),
    h('button', { class: 'btn pri full', onclick: () => { if (!txt.trim()) return toast('Écris un petit quelque chose'); sendNote(txt.trim()); c.close(); } }, icon('send'), 'Envoyer'),
    h('button', { class: 'btn full', onclick: () => { c.close(); scheduleSheet(txt.trim()); } }, '⏰ Programmer pour plus tard')
  ]);
}
VIEWS.home = () => {
  const me = S.me, o = other(), t = today(), hr = new Date().getHours();
  const tg = together(), b = balance();
  const q = qOf(t), mine = ans(t, me.id), his = ans(t, o.id);
  const qst = !mine ? ['À toi de répondre', 'var(--u1)'] : his ? ['Réponses dévoilées', 'var(--good)'] : [`En attente de ${o.name}`, 'var(--warn)'];
  const nextEv = all('events').filter(e => e.date >= t).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
  const lastNote = all('notes').sort((a, b) => b.at - a.at)[0];
  const flats = all('flats'), active = flats.filter(f => !['refuse', 'accepte'].includes(f.status));
  const visits = flats.filter(f => f.status === 'visite' && f.visitAt && f.visitAt.slice(0, 10) >= t).sort((a, b) => a.visitAt.localeCompare(b.visitAt));
  const relances = flats.filter(needsRelance);
  const cd = all('countdowns').filter(c => c.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0];
  const photos = all('photos').sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at)).slice(0, 4);
  return [
    head(`${hr < 5 ? 'Bonne nuit' : hr < 18 ? 'Bonjour' : 'Bonsoir'} ${me.name}`, { sub: cap(fmtD(t, { weekday: 'long', day: 'numeric', month: 'long' })), extra: h('button', { class: 'ibtn', 'aria-label': 'Envoyer un petit mot', onclick: quickNote }, icon('heart')) }),
    S.demo && h('div', { class: 'demo-flag' }, 'Démo · données d\'exemple'),
    sec(eyebrow('Où on est aujourd\'hui'),
      h('div', { class: 'where' }, S.users.map(u => { const p = placeOf(u.id, t); return h('button', { onclick: () => placeSheet(u.id, t) }, avatar(u.id), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, u.name), placeTag(p, 'Ville à préciser'))); })),
      h('div', { class: 'row' },
        tg && tg.in > 0 && h('div', { class: 'big num' }, 'J-' + tg.in),
        h('p', { class: tg ? 'mid grow' : 'muted grow' }, !tg ? 'Indiquez vos villes dans l\'agenda pour voir quand vous vous retrouvez.'
          : tg.in === 0 ? `Ensemble à ${tg.place}${tg.end > t ? ' jusqu\'à ' + fmtD(tg.end, { weekday: 'long', day: 'numeric', month: 'long' }) : ' aujourd\'hui'}`
            : `Retrouvailles à ${tg.place}, ${fmtD(tg.date, { weekday: 'long', day: 'numeric', month: 'long' })}`))),
    moodCard(),
    h('button', { class: 'glass card tap', onclick: () => go('question') }, eyebrow('Question du jour', h('span', { class: 'pill', c: qst[1] }, qst[0])), h('p', { class: 'mid' }, qText(q))),
    h('div', { class: 'grid2' },
      h('button', { class: 'glass card tap', onclick: () => go('comptes') }, h('div', { class: 'eyebrow' }, 'Comptes'),
        h('div', { class: 'big num ' + (b > 0 ? 'good' : b < 0 ? 'warnc' : '') }, b === 0 ? '0 €' : eur(Math.abs(b))),
        h('div', { class: 'small muted' }, b === 0 ? 'Vous êtes quittes' : b > 0 ? `${o.name} te doit` : `Tu dois à ${o.name}`)),
      h('button', { class: 'glass card tap', onclick: () => { if (nextEv) S.cal = { ym: nextEv.date.slice(0, 7), sel: nextEv.date }; go('agenda'); } }, h('div', { class: 'eyebrow' }, 'À venir'),
        nextEv ? [h('div', { class: 'mid' }, kindOf(nextEv.kind)[2] + ' ' + nextEv.title), h('div', { class: 'small muted' }, cap(rel(nextEv.date)) + (nextEv.time ? ' à ' + nextEv.time : ''))] : h('div', { class: 'muted' }, 'Rien de prévu'))),
    sec(eyebrow('Petits mots', h('button', { class: 'btn sm', onclick: () => go('mots') }, 'Tout voir')),
      lastNote ? h('div', { class: 'row' }, avatar(lastNote.by), h('div', { class: 'grow' }, h('div', null, lastNote.text), h('div', { class: 'small faint' }, fmtT(lastNote.at)))) : h('p', { class: 'muted' }, 'Aucun mot pour l\'instant.'),
      h('button', { class: 'btn pri full', onclick: quickNote }, icon('heart'), `Envoyer un mot à ${o.name}`)),
    flats.length ? h('button', { class: 'glass card tap', onclick: () => go('appart') }, h('div', { class: 'eyebrow' }, 'Recherche d\'appart'),
      h('div', { class: 'mid' }, `${active.length} piste${active.length > 1 ? 's' : ''} en cours`),
      h('div', { class: 'chips' },
        visits[0] && h('span', { class: 'pill', c: stOf('visite')[2] }, `Visite ${rel(visits[0].visitAt.slice(0, 10))}`),
        relances.length ? h('span', { class: 'pill', c: 'var(--bad)' }, `${relances.length} relance${relances.length > 1 ? 's' : ''} à faire`) : null)) : null,
    flashCard(),
    cd && h('button', { class: 'glass card tap', onclick: () => go('rebours') }, h('div', { class: 'cd' }, h('div', { class: 'j' }, 'J-' + daysBetween(t, cd.date)), h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, 'Compte à rebours'), h('div', { class: 'mid' }, (cd.emoji || '🎉') + ' ' + cd.title), h('div', { class: 'small muted' }, cap(fmtD(cd.date, { weekday: 'long', day: 'numeric', month: 'long' })))))),
    photos.length ? h('button', { class: 'glass card tap', onclick: () => go('photos') }, h('div', { class: 'eyebrow' }, 'Dernières photos'), h('div', { class: 'strip' }, photos.map(p => h('img', { src: B.fileUrl(p.fileId), alt: p.caption || 'Photo', loading: 'lazy' })))) : null
  ];
};

/* ================= AGENDA ================= */
function placeSheet(who, date) {
  const cur = (S.cols.places || {})[date + '_' + who];
  const known = cur && PLACES.some(p => p[0] === cur.place);
  formSheet({
    title: 'Où es-tu ?', submit: 'Enregistrer',
    values: { who, place: cur ? (known ? cur.place : '__other') : (profile(who).home || 'Paris'), custom: cur && !known ? cur.place : '', from: date, to: date },
    fields: [
      { k: 'who', label: 'Pour', type: 'seg', options: S.users.map(u => [u.id, u.id === S.me.id ? 'Moi' : u.name]) },
      { k: 'place', label: 'Ville', type: 'select', options: [...PLACES.slice(0, 3).map(p => [p[0], p[0]]), ['__other', 'Autre ville…'], ['__clear', 'Revenir à la ville habituelle']] },
      { k: 'custom', label: 'Nom de la ville', ph: 'Lyon, Biarritz…', showIf: v => v.place === '__other', required: true },
      { k: 'from', label: 'Du', type: 'date', half: true, required: true },
      { k: 'to', label: 'Au', type: 'date', half: true, required: true },
      { k: 'days', label: 'Jours concernés', type: 'multi', options: WD, hint: 'Pratique pour un rythme régulier : par exemple du lundi au mercredi à Bordeaux pendant deux mois.' }
    ],
    onSubmit: async v => {
      if (v.to < v.from) { toast('La date de fin est avant le début'); return false; }
      const docs = [], dels = [];
      for (let d = v.from, n = 0; d <= v.to && n < 400; d = addDays(d, 1), n++) {
        if (!v.days.includes(pd(d).getDay())) continue;
        if (v.place === '__clear') dels.push(d + '_' + v.who);
        else docs.push({ id: d + '_' + v.who, date: d, user: v.who, place: v.place === '__other' ? v.custom.trim() : v.place });
      }
      if (docs.length) await putMany('places', docs);
      for (const id of dels) if (S.cols.places[id]) await del('places', id);
    }
  });
}
const PRESETS = { midi: ['Service du midi', '11:30', '15:00'], soir: ['Service du soir', '18:30', '23:30'], coupure: ['Coupure (midi et soir)', '11:30', '23:30'], repos: ['Repos', '', ''] };
function eventSheet(ev) {
  const isNew = !ev.id;
  formSheet({
    title: isNew ? 'Nouvel événement' : 'Modifier', values: { kind: 'event', who: 'both', ...ev },
    fields: [
      { k: 'kind', label: 'Type', type: 'select', options: KINDS.map(k => [k[0], k[2] + ' ' + k[1]]) },
      { k: 'preset', label: 'Horaires du service', type: 'select', showIf: v => v.kind === 'service', options: [['', 'Je saisis les horaires'], ['midi', 'Midi (11:30 – 15:00)'], ['soir', 'Soir (18:30 – 23:30)'], ['coupure', 'Coupure (11:30 – 23:30)'], ['repos', 'Repos']] },
      { k: 'title', label: 'Titre', ph: 'Dîner chez Léa, concert, TGV…', showIf: v => !(v.kind === 'service' && v.preset) },
      { k: 'who', label: 'Pour qui', type: 'seg', options: [[S.me.id, 'Moi'], [other().id, other().name], ['both', 'Nous deux']] },
      { k: 'date', label: 'Date', type: 'date', required: true },
      { k: 'time', label: 'Début', type: 'time', half: true, showIf: v => !(v.kind === 'service' && v.preset) },
      { k: 'endTime', label: 'Fin', type: 'time', half: true, showIf: v => !(v.kind === 'service' && v.preset) },
      isNew && { k: 'until', label: 'Répéter jusqu\'au (facultatif)', type: 'date' },
      isNew && { k: 'days', label: 'Jours de répétition', type: 'multi', options: WD, showIf: v => !!v.until },
      { k: 'note', label: 'Note', type: 'textarea', ph: 'Adresse, heure du train, à ne pas oublier…' }
    ].filter(Boolean),
    onSubmit: async v => {
      const d = { ...v }; const p = d.kind === 'service' && PRESETS[d.preset];
      if (p) { d.title = p[0]; d.time = p[1]; d.endTime = p[2]; }
      if (!d.title || !d.title.trim()) { toast('Donne un titre'); return false; }
      const until = d.until, days = d.days; delete d.until; delete d.days;
      if (isNew && until && until > d.date) {
        const docs = [];
        for (let x = d.date, n = 0; x <= until && n < 200; x = addDays(x, 1), n++) if (days.includes(pd(x).getDay())) docs.push({ ...d, date: x });
        await putMany('events', docs);
      } else await put('events', d);
      S.cal = { ym: d.date.slice(0, 7), sel: d.date };
    },
    onDelete: isNew ? null : () => del('events', ev.id)
  });
}
function eventRow(e) {
  return h('button', { class: 'item', onclick: () => eventSheet(e) },
    h('span', { class: 'emo' }, kindOf(e.kind)[2]),
    h('div', { class: 'grow' }, h('div', { class: 'b ell' }, e.title), h('div', { class: 'small muted ell' }, [e.time ? e.time + (e.endTime ? ' – ' + e.endTime : '') : 'Toute la journée', e.note].filter(Boolean).join(' · '))),
    e.who === 'both' ? h('div', { class: 'row', style: { gap: '0' } }, S.users.map(u => avatar(u.id, true))) : avatar(e.who, true));
}
VIEWS.agenda = () => {
  const c = S.cal || (S.cal = { ym: today().slice(0, 7), sel: today() });
  const [y, m] = c.ym.split('-').map(Number), first = new Date(y, m - 1, 1), start = addDays(iso(first), -((first.getDay() + 6) % 7)), t = today();
  const byDay = {}; for (const e of all('events')) (byDay[e.date] = byDay[e.date] || []).push(e);
  const shift = n => { const d = new Date(y, m - 1 + n, 1); S.cal = { ym: iso(d).slice(0, 7), sel: iso(d).slice(0, 7) === t.slice(0, 7) ? t : iso(d) }; render(true); };
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i); if (i === 35 && d.slice(0, 7) !== c.ym) break;
    const evs = (byDay[d] || []).slice(0, 3);
    cells.push(h('button', { class: 'day' + (d.slice(0, 7) !== c.ym ? ' out' : '') + (d === t ? ' today' : '') + (d === c.sel ? ' sel' : ''), 'aria-label': fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' }), onclick: () => { S.cal.sel = d; if (d.slice(0, 7) !== c.ym) S.cal.ym = d.slice(0, 7); render(true); } },
      h('span', { class: 'dn' }, +d.slice(8)),
      h('span', { class: 'bar' }, S.users.map(u => { const p = placeOf(u.id, d); return h('i', { c: p ? pcolor(p) : null }); })),
      h('span', { class: 'evs' }, evs.map(e => h('i', { c: e.who === 'both' ? 'var(--ink)' : ucolor(e.who) })))));
  }
  const sel = c.sel, evs = (byDay[sel] || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const segs = []; // périodes dans la même ville, sur 60 jours
  for (let i = 0, curSeg = null; i < 60; i++) {
    const d = addDays(t, i), a = placeOf(S.users[0].id, d), b = S.users[1] && placeOf(S.users[1].id, d);
    if (a && a === b) { if (curSeg && curSeg.place === a) curSeg.to = d; else segs.push(curSeg = { from: d, to: d, place: a }); } else curSeg = null;
  }
  const usedPlaces = [...new Set(cells.length ? S.users.flatMap(u => Array.from({ length: 31 }, (_, i) => placeOf(u.id, addDays(iso(first), i)))) : [])].filter(Boolean);
  return [
    head('Agenda', { add: () => eventSheet({ date: sel }), addLabel: 'Ajouter un événement', extra: h('button', { class: 'ibtn', 'aria-label': 'Indiquer une ville', onclick: () => placeSheet(S.me.id, sel) }, icon('pin')) }),
    sec(
      h('div', { class: 'row between' }, h('button', { class: 'ibtn', 'aria-label': 'Mois précédent', onclick: () => shift(-1) }, icon('back')), h('div', { class: 'mid' }, cap(fmtD(iso(first), { month: 'long', year: 'numeric' }))), h('button', { class: 'ibtn', 'aria-label': 'Mois suivant', onclick: () => shift(1) }, icon('next'))),
      h('div', { class: 'cal' }, ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => h('div', { class: 'dow' }, d)), cells),
      h('div', { class: 'legend' }, h('span', null, `Barre : ${S.users.map(u => u.name).join(' | ')}`), usedPlaces.map(p => h('span', null, h('i', { class: 'dot', c: pcolor(p) }), p)))),
    sec(eyebrow(cap(fmtD(sel, { weekday: 'long', day: 'numeric', month: 'long' })), h('span', { class: 'small faint' }, cap(rel(sel)))),
      h('div', { class: 'where' }, S.users.map(u => { const p = placeOf(u.id, sel); return h('button', { onclick: () => placeSheet(u.id, sel) }, avatar(u.id, true), h('div', { class: 'grow small' }, h('div', { class: 'ell' }, u.name), placeTag(p, 'À préciser'))); })),
      evs.length ? h('div', { class: 'list' }, evs.map(eventRow)) : h('div', { class: 'empty' }, 'Rien de prévu ce jour-là.'),
      h('button', { class: 'btn full', onclick: () => eventSheet({ date: sel }) }, icon('plus'), 'Ajouter')),
    sec(eyebrow('Dans la même ville'),
      segs.length ? h('div', { class: 'list' }, segs.slice(0, 5).map(s => { const n = daysBetween(s.from, s.to) + 1; return h('div', { class: 'item' }, h('i', { class: 'dot', c: pcolor(s.place) }), h('div', { class: 'grow' }, h('div', { class: 'b' }, s.from === s.to ? cap(fmtD(s.from)) : `${cap(fmtD(s.from))} → ${fmtD(s.to)}`), h('div', { class: 'small muted' }, s.place)), h('span', { class: 'pill plain' }, n + (n > 1 ? ' jours' : ' jour'))); }))
        : h('div', { class: 'empty' }, 'Aucune période commune sur les deux prochains mois.'))
  ];
};

/* ================= COMPTES ================= */
function splitFields() {
  const o = other(), u0 = S.users[0];
  return [
    { k: 'paidBy', label: 'Payé par', type: 'seg', options: S.users.map(u => [u.id, u.id === S.me.id ? 'Moi' : u.name]) },
    { k: 'split', label: 'Répartition', type: 'select', options: [['half', 'Moitié-moitié'], ['pct', 'Au prorata'], ['other', 'Avancé pour l\'autre (100 %)'], ['payer', 'Dépense perso (ne compte pas)']] },
    { k: 'pct', label: `Part de ${u0.name} (%)`, type: 'number', min: 0, max: 100, showIf: v => v.split === 'pct', required: true, hint: `Le reste est pour ${S.users[1] ? S.users[1].name : o.name}.` },
    { k: 'cat', label: 'Catégorie', type: 'select', options: CATS.map(c => [c[0], c[1] + ' ' + c[2]]) }
  ];
}
function packSplit(d) {
  if (d.split === 'pct') { const p = Math.max(0, Math.min(100, +d.pct || 0)); d.shares = { [S.users[0].id]: p }; if (S.users[1]) d.shares[S.users[1].id] = 100 - p; } else delete d.shares;
  d.amount = Math.round((+d.amount || 0) * 100) / 100; return d;
}
function expenseSheet(e) {
  const isNew = !e.id, cp = couple();
  formSheet({
    title: isNew ? 'Nouvelle dépense' : 'Modifier la dépense',
    values: { paidBy: S.me.id, split: cp.defaultSplit || 'half', pct: cp.pct == null ? 50 : cp.pct, cat: 'courses', date: today(), ...e, ...(e.shares ? { pct: e.shares[S.users[0].id] } : {}) },
    fields: [{ k: 'label', label: 'Quoi', ph: 'Courses, resto, billets de train…', required: true }, { k: 'amount', label: 'Montant (€)', type: 'number', step: '0.01', min: 0, half: true, required: true }, { k: 'date', label: 'Date', type: 'date', half: true, required: true }, ...splitFields()],
    onSubmit: v => { if (!(+v.amount > 0)) { toast('Indique un montant'); return false; } return put('expenses', packSplit({ ...v })); },
    onDelete: isNew ? null : () => del('expenses', e.id)
  });
}
function recurringSheet() {
  const edit = r => formSheet({
    title: r.id ? 'Modifier' : 'Dépense récurrente',
    values: { paidBy: S.me.id, split: couple().defaultSplit || 'half', pct: couple().pct == null ? 50 : couple().pct, cat: 'logement', day: 1, ...r },
    fields: [{ k: 'label', label: 'Quoi', ph: 'Loyer, Netflix, électricité…', required: true }, { k: 'amount', label: 'Montant (€)', type: 'number', step: '0.01', half: true, required: true }, { k: 'day', label: 'Jour du mois', type: 'number', min: 1, max: 28, half: true, required: true }, ...splitFields()],
    onSubmit: async v => { await put('recurring', packSplit({ ...v })); genRecurring(); ctl.refresh(); },
    onDelete: r.id ? async () => { await del('recurring', r.id); ctl.refresh(); } : null
  });
  const ctl = openSheet('Dépenses récurrentes', () => {
    const rs = all('recurring').sort((a, b) => a.day - b.day);
    return [
      h('p', { class: 'muted small' }, 'Ajoutées automatiquement chaque mois, le jour indiqué.'),
      rs.length ? h('div', { class: 'list' }, rs.map(r => h('button', { class: 'item', onclick: () => edit(r) }, h('span', { class: 'emo' }, catOf(r.cat)[1]), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, r.label), h('div', { class: 'small muted' }, `Le ${r.day} · payé par ${nameOf(r.paidBy)}`)), h('span', { class: 'amt' }, eur(r.amount))))) : h('div', { class: 'empty' }, 'Aucune pour l\'instant.'),
      h('button', { class: 'btn pri full', onclick: () => edit({}) }, icon('plus'), 'Ajouter')
    ];
  });
}
function genRecurring() {
  if (!S.me) return;
  const t = today(), ym = t.slice(0, 7), dn = +t.slice(8);
  for (const r of all('recurring')) {
    if (r.last === ym || dn < (+r.day || 1)) continue;
    const id = `r_${r.id}_${ym}`; r.last = ym; B.put('recurring', r).catch(() => { });
    if (!S.cols.expenses[id]) { const e = { id, label: r.label, amount: r.amount, paidBy: r.paidBy, split: r.split, shares: r.shares, cat: r.cat, date: `${ym}-${pad(+r.day || 1)}`, rec: r.id, by: r.by, at: Date.now() }; S.cols.expenses[id] = e; B.put('expenses', e).catch(() => { }); }
  }
}
async function settle() {
  const b = balance(), o = other(); if (!b) return;
  const from = b > 0 ? o.id : S.me.id, to = b > 0 ? S.me.id : o.id;
  if (await confirmSheet('Régulariser les comptes', `${nameOf(from)} rembourse ${eur(Math.abs(b))} à ${nameOf(to)}. Le solde repart de zéro et l'historique est conservé.`, 'C\'est remboursé'))
    put('settlements', { from, to, amount: Math.abs(b), date: today() });
}
VIEWS.comptes = () => {
  const b = balance(), o = other(), ym = (S.month || today()).slice(0, 7);
  const exp = all('expenses'), month = exp.filter(e => e.date && e.date.slice(0, 7) === ym && e.split !== 'payer');
  const total = month.reduce((s, e) => s + (+e.amount || 0), 0);
  const cost = {}; for (const u of S.users) cost[u.id] = month.reduce((s, e) => s + (+e.amount || 0) * shareOf(e)[u.id], 0);
  const byCat = {}; for (const e of month) byCat[e.cat] = (byCat[e.cat] || 0) + (+e.amount || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]), maxCat = cats.length ? cats[0][1] : 1;
  const feed = [...exp.map(e => ({ t: 'e', d: e.date, at: e.at, e })), ...all('settlements').map(s => ({ t: 's', d: s.date, at: s.at, s }))].sort((a, b) => (b.d + b.at).localeCompare(a.d + a.at)).slice(0, 80);
  let lastM = '';
  const mshift = n => { const d = pd(ym + '-01'); d.setMonth(d.getMonth() + n); S.month = iso(d); render(true); };
  return [
    head('Comptes', { add: () => expenseSheet({}), addLabel: 'Ajouter une dépense', extra: h('button', { class: 'ibtn', 'aria-label': 'Dépenses récurrentes', onclick: recurringSheet }, icon('rep')) }),
    sec(h('div', { class: 'row' }, avatar(b >= 0 ? o.id : S.me.id), h('div', { class: 'grow' },
      h('div', { class: 'small muted' }, b === 0 ? 'Rien à rembourser' : b > 0 ? `${o.name} te doit` : `Tu dois à ${o.name}`),
      h('div', { class: 'big num ' + (b > 0 ? 'good' : b < 0 ? 'warnc' : '') }, b === 0 ? 'Vous êtes quittes' : eur(Math.abs(b))))),
      b !== 0 && h('button', { class: 'btn full', onclick: settle }, 'Régulariser')),
    sec(h('div', { class: 'row between' }, h('button', { class: 'ibtn', 'aria-label': 'Mois précédent', onclick: () => mshift(-1) }, icon('back')), h('div', { class: 'center' }, h('div', { class: 'eyebrow' }, cap(fmtD(ym + '-01', { month: 'long', year: 'numeric' }))), h('div', { class: 'big num' }, eur(total))), h('button', { class: 'ibtn', 'aria-label': 'Mois suivant', onclick: () => mshift(1) }, icon('next'))),
      h('div', { class: 'row', style: { justifyContent: 'space-around' } }, S.users.map(u => h('div', { class: 'row' }, avatar(u.id, true), h('div', null, h('div', { class: 'tiny muted' }, 'Part de ' + u.name), h('div', { class: 'b num' }, eur(cost[u.id])))))),
      cats.length ? h('div', { class: 'bars' }, cats.map(([c, v]) => h('div', { class: 'barrow' }, h('span', null, catOf(c)[1]), h('div', null, h('div', { class: 'small' }, catOf(c)[2]), h('div', { class: 'track' }, h('i', { style: { width: Math.max(4, v / maxCat * 100) + '%' } }))), h('span', { class: 'b num small' }, eur0(v))))) : h('div', { class: 'empty' }, 'Aucune dépense commune ce mois-ci.')),
    sec(eyebrow('Historique'),
      feed.length ? h('div', { class: 'list' }, feed.map(x => {
        const mm = x.d.slice(0, 7), sepEl = mm !== lastM ? h('div', { class: 'tiny faint b', style: { padding: '10px 0 2px', textTransform: 'uppercase' } }, fmtD(mm + '-01', { month: 'long', year: 'numeric' })) : null; lastM = mm;
        if (x.t === 's') return [sepEl, h('div', { class: 'item' }, h('span', { class: 'emo' }, '✅'), h('div', { class: 'grow' }, h('div', { class: 'b' }, 'Comptes régularisés'), h('div', { class: 'small muted' }, `${nameOf(x.s.from)} → ${nameOf(x.s.to)} · ${fmtD(x.d)}`)), h('span', { class: 'amt good' }, eur(x.s.amount)))];
        const e = x.e, sp = e.split === 'payer' ? 'perso' : e.split === 'other' ? 'avancé' : e.split === 'pct' && e.shares ? S.users.map(u => e.shares[u.id]).join('/') : '50/50';
        return [sepEl, h('button', { class: 'item', onclick: () => expenseSheet(e) }, h('span', { class: 'emo' }, catOf(e.cat)[1]), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, e.label), h('div', { class: 'small muted ell' }, `${nameOf(e.paidBy)} · ${fmtD(e.date)} · ${sp}${e.rec ? ' · mensuel' : ''}`)), h('span', { class: 'amt' }, eur(e.amount)))];
      })) : h('div', { class: 'empty' }, 'Ajoutez votre première dépense avec le bouton +.'))
  ];
};

/* ================= APPART ================= */
const flatTotal = f => (+f.rent || 0) + (+f.charges || 0);
const fmtVisit = v => cap(fmtD(v.slice(0, 10))) + (v.length > 10 ? ' à ' + v.slice(11, 16) : '');
function flatForm(f) {
  const isNew = !f.id, vals = { status: 'repere', ...f };
  for (const u of S.users) vals['c_' + u.id] = (f.commute || {})[u.id];
  formSheet({
    title: isNew ? 'Nouvel appart' : 'Modifier', values: vals,
    fields: [
      { k: 'title', label: 'Nom', ph: 'T2 rue Monge, 45 m² Montrouge…', required: true },
      { k: 'url', label: 'Lien de l\'annonce', type: 'url', ph: 'https://…' },
      { k: 'rent', label: 'Loyer hors charges (€)', type: 'number', half: true }, { k: 'charges', label: 'Charges (€)', type: 'number', half: true },
      { k: 'surface', label: 'Surface (m²)', type: 'number', half: true }, { k: 'area', label: 'Quartier / ville', ph: 'Paris 14e', half: true },
      ...S.users.map(u => ({ k: 'c_' + u.id, label: `Trajet travail ${u.name} (min)`, type: 'number', half: true })),
      { k: 'avail', label: 'Disponible le', type: 'date', half: true }, { k: 'contact', label: 'Contact', ph: 'Agence, nom, téléphone', half: true },
      { k: 'notes', label: 'Notes', type: 'textarea', ph: 'Étage, ascenseur, meublé ou non, ce qui plaît, ce qui coince…' }
    ],
    onSubmit: v => {
      const d = { ...v }; d.commute = {};
      for (const u of S.users) { if (d['c_' + u.id] !== '' && d['c_' + u.id] != null) d.commute[u.id] = +d['c_' + u.id]; delete d['c_' + u.id]; }
      if (isNew) { d.lastActionAt = Date.now(); d.history = [{ s: 'repere', at: Date.now(), by: S.me.id }]; }
      return put('flats', d);
    }
  });
}
function flatSheet(id) {
  const ctl = openSheet((S.cols.flats[id] || {}).title || 'Appart', () => {
    const f = S.cols.flats[id]; if (!f) return h('div', { class: 'empty' }, 'Cette fiche a été supprimée.');
    const me = S.me.id, o = other(), tot = flatTotal(f), bud = +couple().budget || 0;
    const save = async patch => { Object.assign(f, patch); await put('flats', f); ctl.refresh(); };
    const log = s => [...(f.history || []), { s, at: Date.now(), by: me }];
    const setStatus = st => {
      if (st === f.status) return;
      if (st === 'visite') return formSheet({ title: 'Date de la visite', values: { v: f.visitAt || today() + 'T18:00' }, fields: [{ k: 'v', label: 'Jour et heure', type: 'datetime-local', required: true }], onSubmit: v => save({ status: st, visitAt: v.v, lastActionAt: Date.now(), history: log(st) }) });
      save({ status: st, lastActionAt: Date.now(), history: log(st) });
    };
    const addPhotos = async () => { const up = await uploadImages(await pickFiles('image/*', true)); if (up.length) save({ photos: [...(f.photos || []), ...up.map(u => u.id)] }); };
    const fact = (l, v) => v ? h('div', null, h('div', { class: 'tiny muted' }, l), h('div', { class: 'b num' }, v)) : null;
    const days = Math.floor((Date.now() - (f.lastActionAt || f.at)) / 864e5);
    return [
      (f.photos || []).length ? h('div', { class: 'chips scroll' }, f.photos.map(p => h('img', { src: B.fileUrl(p), alt: 'Photo de l\'appart', style: { height: '150px', width: 'auto', borderRadius: '16px', flex: 'none' } }))) : null,
      h('div', { class: 'row wrap', style: { gap: '18px' } }, fact('Loyer charges comprises', tot ? eur0(tot) : ''), fact('Surface', f.surface ? f.surface + ' m²' : ''), fact('Prix au m²', f.surface && tot ? Math.round(tot / f.surface) + ' €' : ''), fact('Secteur', f.area), fact('Disponible', f.avail ? fmtD(f.avail) : ''), ...S.users.map(u => fact('Trajet ' + u.name, (f.commute || {})[u.id] != null ? f.commute[u.id] + ' min' : ''))),
      bud && tot ? h('span', { class: 'pill', c: tot > bud ? 'var(--bad)' : 'var(--good)', style: { alignSelf: 'flex-start' } }, tot > bud ? `${eur0(tot - bud)} au-dessus du budget` : `Dans le budget (${eur0(bud)})`) : null,
      f.url && h('a', { class: 'btn full', href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'Voir l\'annonce ↗'),
      f.contact && h('p', { class: 'small muted' }, 'Contact : ' + f.contact),
      h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Où on en est'), h('div', { class: 'chips' }, FST.map(s => h('button', { class: 'chip' + (f.status === s[0] ? ' on' : ''), onclick: () => setStatus(s[0]) }, s[1])))),
      f.status === 'visite' && f.visitAt && h('p', { class: 'b' }, '🔑 Visite : ' + fmtVisit(f.visitAt)),
      (f.status === 'contacte' || f.status === 'dossier') && h('div', { class: 'row between' }, h('span', { class: 'small ' + (needsRelance(f) ? 'bad b' : 'muted') }, days < 1 ? 'Dernière action aujourd\'hui' : `Sans nouvelles depuis ${days} jour${days > 1 ? 's' : ''}`), h('button', { class: 'btn sm', onclick: () => save({ lastActionAt: Date.now(), history: log('relance') }) }, 'J\'ai relancé')),
      h('hr', { class: 'sep' }),
      h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Ma note'), h('div', { class: 'stars' }, [1, 2, 3, 4, 5].map(n => h('button', { class: ((f.ratings || {})[me] || 0) >= n ? 'on' : '', 'aria-label': n + ' sur 5', onclick: () => save({ ratings: { ...(f.ratings || {}), [me]: n } }) }, '★')))),
      h('div', { class: 'f' }, h('label', { htmlFor: 'f_op' }, 'Mon avis'), h('textarea', { class: 'inp', id: 'f_op', placeholder: 'Ce que j\'en pense…', value: (f.opinions || {})[me] || '', onchange: e => save({ opinions: { ...(f.opinions || {}), [me]: e.target.value } }) })),
      ((f.ratings || {})[o.id] || (f.opinions || {})[o.id]) ? h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(o.id, true), h('div', { class: 'grow' }, h('div', { class: 'b' }, `${o.name} ${(f.ratings || {})[o.id] ? '★'.repeat(f.ratings[o.id]) : ''}`), h('div', { class: 'small muted' }, (f.opinions || {})[o.id] || 'Pas encore d\'avis écrit'))) : h('p', { class: 'small faint' }, `${o.name} n'a pas encore donné son avis.`),
      f.notes && h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Notes'), h('p', { style: { whiteSpace: 'pre-wrap' } }, f.notes)),
      h('hr', { class: 'sep' }),
      h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Suivi'), h('div', { class: 'tl' }, (f.history || []).slice().reverse().map(x => h('div', { c: x.s === 'relance' ? 'var(--warn)' : stOf(x.s)[2] }, h('span', { class: 'b' }, x.s === 'relance' ? 'Relance' : stOf(x.s)[1]), h('span', { class: 'muted small' }, ` · ${nameOf(x.by)} · ${fmtT(x.at)}`))))),
      h('div', { class: 'frow' }, h('button', { class: 'btn', onclick: addPhotos }, '📷 Photos'), h('button', { class: 'btn', onclick: () => { ctl.close(); flatForm(f); } }, 'Modifier')),
      h('button', { class: 'btn danger full', onclick: async () => { if (await confirmSheet('Supprimer cette fiche ?', 'Les notes et le suivi seront perdus.', 'Supprimer', true)) { for (const p of f.photos || []) B.delFile(p).catch(() => { }); ctl.close(); del('flats', id); } } }, 'Supprimer la fiche')
    ];
  });
}
function compareSheet() {
  const fs = all('flats').filter(f => f.status !== 'refuse').sort((a, b) => flatTotal(a) - flatTotal(b)), bud = +couple().budget || 0;
  const avg = f => { const r = Object.values(f.ratings || {}).filter(Boolean); return r.length ? (r.reduce((a, b) => a + b, 0) / r.length).toFixed(1).replace('.', ',') + ' ★' : '–'; };
  openSheet('Comparer', () => fs.length ? h('div', { class: 'scrollx' }, h('table', { class: 'cmp' },
    h('thead', null, h('tr', null, ['Appart', 'Loyer CC', 'm²', '€/m²', ...S.users.map(u => '🚇 ' + u.name), 'Note', 'Étape'].map(t => h('th', null, t)))),
    h('tbody', null, fs.map(f => { const t = flatTotal(f); return h('tr', null, h('td', { class: 'b' }, f.title), h('td', { class: bud && t > bud ? 'bad b' : 'b' }, t ? eur0(t) : '–'), h('td', null, f.surface || '–'), h('td', null, f.surface && t ? Math.round(t / f.surface) : '–'), ...S.users.map(u => h('td', null, (f.commute || {})[u.id] != null ? f.commute[u.id] + ' min' : '–')), h('td', null, avg(f)), h('td', null, stOf(f.status)[1])); }))))
    : h('div', { class: 'empty' }, 'Ajoutez des apparts pour les comparer.'));
}
VIEWS.appart = () => {
  const flats = all('flats'), flt = S.flatFilter || 'actifs', bud = +couple().budget || 0;
  const count = s => flats.filter(f => f.status === s).length;
  const shown = flats.filter(f => flt === 'actifs' ? f.status !== 'refuse' : flt === 'relance' ? needsRelance(f) : f.status === flt)
    .sort((a, b) => (needsRelance(b) - needsRelance(a)) || (b.at || 0) - (a.at || 0));
  const nRel = flats.filter(needsRelance).length;
  const chip = (id, lab, n) => h('button', { class: 'chip' + (flt === id ? ' on' : ''), onclick: () => { S.flatFilter = id; render(true); } }, lab, n != null && h('span', { class: 'n' }, n));
  return [
    head('Appart', { add: () => flatForm({}), addLabel: 'Ajouter un appart', sub: bud ? `Budget max ${eur0(bud)} charges comprises` : null, extra: h('button', { class: 'ibtn', 'aria-label': 'Comparer', onclick: compareSheet }, icon('cmp')) }),
    h('div', { class: 'chips scroll' }, chip('actifs', 'En cours', flats.filter(f => f.status !== 'refuse').length), nRel ? chip('relance', 'À relancer', nRel) : null, FST.map(s => chip(s[0], s[1], count(s[0])))),
    shown.length ? shown.map(f => {
      const st = stOf(f.status), tot = flatTotal(f), img = (f.photos || [])[0];
      return h('button', { class: 'glass card tap flat', onclick: () => flatSheet(f.id) },
        h('div', { class: 'ph' }, img ? h('img', { src: B.fileUrl(img), alt: '', loading: 'lazy' }) : '🏠', h('span', { class: 'pill', c: st[2] }, st[1]), needsRelance(f) && h('span', { class: 'pill alert', c: 'var(--bad)' }, 'Relance à faire')),
        h('div', { class: 'in' },
          h('div', { class: 'row between' }, h('div', { class: 'mid ell grow' }, f.title), tot ? h('div', { class: 'amt ' + (bud && tot > bud ? 'bad' : '') }, eur0(tot)) : null),
          h('div', { class: 'small muted' }, [f.surface && f.surface + ' m²', f.area, f.surface && tot && Math.round(tot / f.surface) + ' €/m²'].filter(Boolean).join(' · ')),
          h('div', { class: 'row wrap small', style: { gap: '6px 14px' } },
            S.users.map(u => (f.commute || {})[u.id] != null ? h('span', { class: 'row', style: { gap: '5px' } }, avatar(u.id, true), f.commute[u.id] + ' min') : null),
            S.users.map(u => (f.ratings || {})[u.id] ? h('span', { class: 'row', style: { gap: '4px' } }, avatar(u.id, true), h('span', { style: { color: '#ffb400' } }, '★'), f.ratings[u.id]) : null)),
          f.status === 'visite' && f.visitAt ? h('div', { class: 'small b' }, '🔑 Visite ' + fmtVisit(f.visitAt)) : null));
    }) : sec(h('div', { class: 'empty' }, flats.length ? 'Aucun appart à cette étape.' : 'Ajoutez le premier appart repéré avec le bouton +.'))
  ];
};
