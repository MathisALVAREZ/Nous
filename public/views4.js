'use strict';
/* Nous — quotidien (menu, tâches, cagnotte, trajets, infos), appart (checklist, messages), jeux (tribunal, défi, quiz, capsules, trophées, bilan, playlist), « je pense à toi ». */
const monday = d => addDays(d, -((pd(d).getDay() + 6) % 7));
const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copié'); } catch (e) { toast('Copie impossible ici : sélectionne le texte à la main'); } }
const backSub = (key) => () => { S[key] = null; render(true); };

/* ================= JE PENSE À TOI ================= */
const pokeN = (u, d) => +(((S.cols.pokes || {})[d + '_' + u] || {}).n) || 0;
function poke(btn) {
  const t = today(), id = t + '_' + S.me.id, cur = (S.cols.pokes || {})[id] || { id, date: t, user: S.me.id, n: 0 };
  if (Date.now() - (poke.t || 0) < 1500) return; poke.t = Date.now();
  put('pokes', { ...cur, n: (+cur.n || 0) + 1, last: Date.now() });
  toast(S.demo ? `En vrai, le téléphone de ${other().name} vibre 💗` : `${other().name} le sait 💗`);
}
function pokeCard() {
  const t = today(), o = other(), mine = pokeN(S.me.id, t), his = pokeN(o.id, t);
  return h('section', { class: 'glass card' }, h('div', { class: 'row' },
    h('button', { class: 'pokebtn', 'aria-label': `Dire à ${o.name} que je pense à elle ou lui`, onclick: e => poke(e.currentTarget) }, '💗'),
    h('div', { class: 'grow' }, h('div', { class: 'mid' }, 'Je pense à toi'),
      h('div', { class: 'small muted' }, his ? `${o.name} a pensé à toi ${his} fois aujourd'hui` : `Un tap, et ${o.name} le sait.`),
      mine ? h('div', { class: 'small faint' }, `Toi : ${mine} fois aujourd'hui`) : null)));
}

/* ================= À FAIRE AUJOURD'HUI (accueil) ================= */
function todayCard() {
  const t = today(), me = S.me.id, rows = [];
  for (const c of all('chores')) if (c.next && c.next <= t && c.turn === me) rows.push(h('div', { class: 'item' }, h('span', { class: 'emo' }, c.emoji || '🧹'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, c.title), h('div', { class: 'small muted' }, c.next < t ? `En retard de ${daysBetween(c.next, t)} j` : 'C\'est ton tour')), h('button', { class: 'btn sm pri', onclick: () => choreDone(c) }, 'Fait')));
  for (const tr of all('trips')) if (tr.date === t) rows.push(h('button', { class: 'item', onclick: () => go('trajets') }, h('span', { class: 'emo' }, '🚄'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, `${tr.from} → ${tr.to}`), h('div', { class: 'small muted' }, `${nameOf(tr.who)} · ${tr.dep || ''}${tr.arr ? ' → ' + tr.arr : ''}${tr.arrivedAt ? ' · arrivé ✓' : ''}`))));
  for (const c of all('capsules')) if (c.openAt === t) rows.push(h('button', { class: 'item', onclick: () => go('capsules') }, h('span', { class: 'emo' }, '💌'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, 'Une capsule s\'ouvre aujourd\'hui'), h('div', { class: 'small muted ell' }, c.title))));
  return rows.length ? sec(eyebrow('Aujourd\'hui'), h('div', { class: 'list' }, rows)) : null;
}

/* ================= MENU DE LA SEMAINE ================= */
const SLOTS = [['midi', 'Midi'], ['soir', 'Soir']];
function mealForm(date, slot) {
  const id = date + '_' + slot, cur = (S.cols.meals || {})[id] || {};
  formSheet({
    title: `${cap(fmtD(date, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${slot}`, values: { who: 'both', ...cur },
    fields: [{ k: 'text', label: 'Au menu', ph: 'Pâtes au pesto, restes, resto…', required: true },
    { k: 'who', label: 'Qui mange', type: 'seg', options: [['both', 'Nous deux'], ...S.users.map(u => [u.id, u.id === S.me.id ? 'Moi' : u.name])] },
    { k: 'ing', label: 'Ingrédients à acheter', type: 'textarea', ph: 'Un par ligne', hint: 'Ils partent dans la liste Courses avec le bouton en bas du menu.' }],
    onSubmit: v => put('meals', { ...v, id, date, slot }), onDelete: cur.id ? () => del('meals', id) : null
  });
}
VIEWS.menu = () => {
  const w = S.menuWeek || monday(today()), t = today(), days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
  const meals = days.flatMap(d => SLOTS.map(([s]) => (S.cols.meals || {})[d + '_' + s]).filter(Boolean));
  const ings = [...new Set(meals.flatMap(m => String(m.ing || '').split('\n').map(x => x.trim()).filter(Boolean)))];
  const toCourses = async () => {
    if (!S.cols.lists.l_courses) await put('lists', { id: 'l_courses', name: 'Courses', emoji: '🛒' });
    const have = new Set(all('items').filter(i => i.list === 'l_courses' && !i.done).map(i => i.text.toLowerCase()));
    const add = ings.filter(x => !have.has(x.toLowerCase()));
    if (add.length) await putMany('items', add.map(text => ({ list: 'l_courses', text, done: false })));
    toast(add.length ? `${add.length} ingrédient${add.length > 1 ? 's' : ''} ajouté${add.length > 1 ? 's' : ''} aux courses` : 'Tout est déjà dans la liste');
  };
  return [
    head('Menu', { back: 'plus', sub: `Semaine du ${fmtD(w, { day: 'numeric', month: 'long' })}` }),
    h('div', { class: 'row between' }, h('button', { class: 'ibtn', 'aria-label': 'Semaine précédente', onclick: () => { S.menuWeek = addDays(w, -7); render(true); } }, icon('back')), h('button', { class: 'btn sm', onclick: () => { S.menuWeek = monday(t); render(true); } }, 'Cette semaine'), h('button', { class: 'ibtn', 'aria-label': 'Semaine suivante', onclick: () => { S.menuWeek = addDays(w, 7); render(true); } }, icon('next'))),
    sec(h('div', { class: 'list' }, days.map(d => h('div', { class: 'item', style: { alignItems: 'flex-start' } },
      h('div', { class: 'mday' + (d === t ? ' now' : '') }, h('div', { class: 'tiny b' }, fmtD(d, { weekday: 'short' }).replace('.', '')), h('div', { class: 'b num' }, +d.slice(8))),
      h('div', { class: 'grow col', style: { gap: '6px' } }, SLOTS.map(([s, l]) => { const m = (S.cols.meals || {})[d + '_' + s]; return h('button', { class: 'meal' + (m ? '' : ' empty'), onclick: () => mealForm(d, s) }, h('span', { class: 'tiny muted b' }, l), h('span', { class: 'grow ell' }, m ? m.text : 'Ajouter'), m && m.who !== 'both' ? avatar(m.who, true) : null); })))))),
    ings.length ? h('button', { class: 'btn pri full', onclick: toCourses }, `🛒 Envoyer ${ings.length} ingrédient${ings.length > 1 ? 's' : ''} dans Courses`) : h('p', { class: 'small faint center' }, 'Ajoute les ingrédients d\'un repas pour les envoyer d\'un coup dans la liste Courses.')
  ];
};

/* ================= QUI FAIT QUOI ================= */
function choreDone(c) {
  const t = today(), me = S.me.id;
  put('chorelog', { chore: c.id, user: me, date: t });
  put('chores', { ...c, next: addDays(t, Math.max(1, +c.every || 7)), turn: other().id === me ? me : other().id, last: t });
  toast('Noté ✓ Au tour de ' + other().name + ' la prochaine fois');
}
function choreForm(c) {
  formSheet({
    title: c.id ? 'Modifier la tâche' : 'Nouvelle tâche', values: { emoji: '🧹', every: 7, next: today(), turn: S.me.id, ...c },
    fields: [{ k: 'title', label: 'Quoi', ph: 'Lessive, poubelles, aspirateur…', required: true }, { k: 'emoji', label: 'Emoji', half: true }, { k: 'every', label: 'Tous les (jours)', type: 'number', min: 1, half: true, required: true },
    { k: 'next', label: 'Prochaine fois', type: 'date', required: true }, { k: 'turn', label: 'C\'est le tour de', type: 'seg', options: S.users.map(u => [u.id, u.id === S.me.id ? 'Moi' : u.name]) }],
    onSubmit: v => put('chores', v), onDelete: c.id ? () => del('chores', c.id) : null
  });
}
VIEWS.taches = () => {
  const t = today(), cs = all('chores').sort((a, b) => (a.next || '').localeCompare(b.next || '')), ym = t.slice(0, 7);
  const score = {}; for (const u of S.users) score[u.id] = all('chorelog').filter(l => l.user === u.id && l.date.slice(0, 7) === ym).length;
  const tot = Math.max(1, sum(Object.values(score)));
  return [
    head('Qui fait quoi', { back: 'plus', add: () => choreForm({}), addLabel: 'Nouvelle tâche' }),
    sec(eyebrow('Ce mois-ci'), S.users.map(u => h('div', { class: 'barrow' }, avatar(u.id, true), h('div', null, h('div', { class: 'small' }, u.name), h('div', { class: 'track' }, h('i', { style: { width: Math.max(3, score[u.id] / tot * 100) + '%' } }))), h('span', { class: 'b num' }, score[u.id])))),
    cs.length ? sec(h('div', { class: 'list' }, cs.map(c => { const late = c.next < t; return h('div', { class: 'item' },
      h('button', { class: 'row grow', style: { textAlign: 'left' }, onclick: () => choreForm(c) }, h('span', { class: 'emo' }, c.emoji || '🧹'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, c.title), h('div', { class: 'small ' + (late ? 'bad b' : 'muted') }, `${cap(rel(c.next))} · tour de ${nameOf(c.turn)} · tous les ${c.every} j`))),
      h('button', { class: 'btn sm' + (c.next <= t ? ' pri' : ''), onclick: () => choreDone(c) }, 'Fait')); })))
      : sec(h('div', { class: 'empty' }, 'Ajoutez les tâches qui reviennent : chacun son tour, sans avoir à se le rappeler.'))
  ];
};

/* ================= CAGNOTTE ================= */
function potSheet(id) {
  openSheet((S.cols.pots[id] || {}).title || 'Cagnotte', c => {
    const p = S.cols.pots[id]; if (!p) return h('div', { class: 'empty' }, 'Cagnotte supprimée.');
    const ins = all('potins').filter(x => x.pot === id).sort((a, b) => b.at - a.at);
    return [ins.length ? h('div', { class: 'list' }, ins.map(x => h('div', { class: 'item' }, avatar(x.user, true), h('div', { class: 'grow' }, h('div', { class: 'b' }, eur(x.amount)), h('div', { class: 'small muted' }, `${nameOf(x.user)} · ${fmtD(x.date)}`)), h('button', { class: 'ibtn', style: { width: '32px', height: '32px' }, 'aria-label': 'Retirer ce versement', onclick: async () => { await del('potins', x.id); c.refresh(); } }, icon('x'))))) : h('div', { class: 'empty' }, 'Aucun versement pour l\'instant.'),
    h('button', { class: 'btn full', onclick: () => { c.close(); formSheet({ title: 'Modifier la cagnotte', values: p, fields: [{ k: 'title', label: 'Pour quoi', required: true }, { k: 'goal', label: 'Objectif (€)', type: 'number', half: true }, { k: 'emoji', label: 'Emoji', half: true }], onSubmit: v => put('pots', v), onDelete: async () => { for (const x of ins) await del('potins', x.id); await del('pots', id); } }); } }, 'Modifier ou supprimer')];
  });
}
VIEWS.cagnotte = () => {
  const pots = all('pots').sort((a, b) => (a.at || 0) - (b.at || 0));
  const addIn = p => formSheet({ title: `Verser dans « ${p.title} »`, submit: 'Verser', values: { user: S.me.id, date: today() }, fields: [{ k: 'amount', label: 'Montant (€)', type: 'number', step: '0.01', required: true }, { k: 'user', label: 'De la part de', type: 'seg', options: S.users.map(u => [u.id, u.id === S.me.id ? 'Moi' : u.name]) }, { k: 'date', label: 'Date', type: 'date', required: true }], onSubmit: v => { if (!(+v.amount > 0)) { toast('Indique un montant'); return false; } return put('potins', { ...v, amount: +v.amount, pot: p.id }); } });
  return [
    head('Cagnottes', { back: 'plus', add: () => formSheet({ title: 'Nouvelle cagnotte', values: { emoji: '🏝️' }, fields: [{ k: 'title', label: 'Pour quoi', ph: 'Vacances, canapé, caution…', required: true }, { k: 'goal', label: 'Objectif (€)', type: 'number', half: true }, { k: 'emoji', label: 'Emoji', half: true }], onSubmit: v => put('pots', v) }), addLabel: 'Nouvelle cagnotte' }),
    pots.length ? pots.map(p => {
      const ins = all('potins').filter(x => x.pot === p.id), tot = sum(ins.map(x => x.amount)), goal = +p.goal || 0, pct = goal ? Math.min(100, tot / goal * 100) : 0;
      return sec(h('button', { class: 'row', style: { textAlign: 'left' }, onclick: () => potSheet(p.id) }, h('span', { class: 'emo', style: { fontSize: '22px' } }, p.emoji || '🏝️'), h('div', { class: 'grow' }, h('div', { class: 'mid ell' }, p.title), h('div', { class: 'small muted' }, goal ? `${eur0(tot)} sur ${eur0(goal)}${tot >= goal ? ' · objectif atteint 🎉' : ` · reste ${eur0(goal - tot)}`}` : eur(tot))), h('div', { class: 'big num', style: { fontSize: '22px' } }, goal ? Math.round(pct) + ' %' : '')),
        goal ? h('div', { class: 'track', style: { height: '12px' } }, h('i', { style: { width: Math.max(2, pct) + '%' } })) : null,
        h('div', { class: 'row between' }, h('div', { class: 'row small muted', style: { gap: '14px' } }, S.users.map(u => h('span', { class: 'row', style: { gap: '5px' } }, avatar(u.id, true), eur0(sum(ins.filter(x => x.user === u.id).map(x => x.amount)))))), h('button', { class: 'btn sm pri', onclick: () => addIn(p) }, 'Verser')));
    }) : sec(h('div', { class: 'empty' }, 'Créez une cagnotte pour un projet commun et suivez ce que chacun y met.'))
  ];
};

/* ================= TRAJETS ================= */
function tripForm(tr) {
  formSheet({
    title: tr.id ? 'Modifier le trajet' : 'Nouveau trajet', values: { who: S.me.id, from: 'Paris', to: 'Bordeaux', date: today(), ...tr },
    fields: [{ k: 'who', label: 'Qui voyage', type: 'seg', options: [...S.users.map(u => [u.id, u.id === S.me.id ? 'Moi' : u.name]), ['both', 'Nous deux']] },
    { k: 'from', label: 'Départ', half: true, required: true }, { k: 'to', label: 'Arrivée', half: true, required: true }, { k: 'date', label: 'Date', type: 'date', required: true },
    { k: 'dep', label: 'Heure de départ', type: 'time', half: true }, { k: 'arr', label: 'Heure d\'arrivée', type: 'time', half: true },
    { k: 'ref', label: 'Référence, voiture, place', ph: 'QDKL7P · voiture 12 · place 45' }, { k: 'note', label: 'Note', ph: 'Qui vient chercher, correspondance…' }],
    onSubmit: v => put('trips', v), onDelete: tr.id ? () => del('trips', tr.id) : null
  });
}
VIEWS.trajets = () => {
  const t = today(), me = S.me.id, ts = all('trips').sort((a, b) => (a.date + (a.dep || '')).localeCompare(b.date + (b.dep || '')));
  const next = ts.filter(x => x.date >= t), past = ts.filter(x => x.date < t).reverse().slice(0, 6);
  const row = tr => h('div', { class: 'item', style: { alignItems: 'flex-start' } },
    h('button', { class: 'row grow', style: { textAlign: 'left', alignItems: 'flex-start' }, onclick: () => tripForm(tr) }, h('span', { class: 'emo' }, '🚄'), h('div', { class: 'grow' }, h('div', { class: 'b' }, `${tr.from} → ${tr.to}`), h('div', { class: 'small muted' }, `${cap(fmtD(tr.date))} · ${cap(rel(tr.date))}${tr.dep ? ' · ' + tr.dep + (tr.arr ? ' → ' + tr.arr : '') : ''} · ${nameOf(tr.who)}`), tr.ref && h('div', { class: 'small' }, tr.ref), tr.note && h('div', { class: 'small muted' }, tr.note), tr.arrivedAt && h('div', { class: 'small good b' }, `Bien arrivé à ${new Date(tr.arrivedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`))),
    tr.date === t && !tr.arrivedAt && (tr.who === me || tr.who === 'both') ? h('button', { class: 'btn sm pri', onclick: () => { put('trips', { ...tr, arrivedAt: Date.now() }); toast(S.demo ? `En vrai, ${other().name} est prévenu` : `${other().name} est prévenu ✓`); } }, 'Bien arrivé') : null);
  return [
    head('Trajets', { back: 'plus', add: () => tripForm({}), addLabel: 'Nouveau trajet' }),
    sec(eyebrow('À venir'), next.length ? h('div', { class: 'list' }, next.map(row)) : h('div', { class: 'empty' }, 'Aucun trajet prévu. Ajoutez vos billets pour que l\'autre sache quand vous arrivez.')),
    past.length ? sec(eyebrow('Passés'), h('div', { class: 'list' }, past.map(row))) : null
  ];
};

/* ================= INFOS PRATIQUES ================= */
VIEWS.infos = () => {
  const form = i => formSheet({ title: i.id ? 'Modifier' : 'Nouvelle info', values: { emoji: '📌', ...i }, fields: [{ k: 'label', label: 'Quoi', ph: 'Digicode, pointure de Morgane, plaque…', required: true }, { k: 'value', label: 'Valeur', required: true }, { k: 'emoji', label: 'Emoji' }], onSubmit: v => put('infos', v), onDelete: i.id ? () => del('infos', i.id) : null });
  const is = all('infos').sort((a, b) => a.label.localeCompare(b.label));
  return [
    head('Infos pratiques', { back: 'plus', add: () => form({}), addLabel: 'Nouvelle info' }),
    sec(is.length ? h('div', { class: 'list' }, is.map(i => h('div', { class: 'item' }, h('button', { class: 'row grow', style: { textAlign: 'left' }, onclick: () => copyText(i.value) }, h('span', { class: 'emo' }, i.emoji || '📌'), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, i.label), h('div', { class: 'b', style: { overflowWrap: 'anywhere' } }, i.value))), h('button', { class: 'btn sm', onclick: () => form(i) }, 'Modifier')))) : h('div', { class: 'empty' }, 'Tout ce qu\'on se redemande sans arrêt : tailles, pointures, digicode, numéro du véto…')),
    h('p', { class: 'small faint center' }, 'Un tap sur une ligne copie la valeur. N\'y mettez pas de mots de passe ni de numéros de carte.')
  ];
};

/* ================= APPART : CHECKLIST ET MESSAGES ================= */
const CHECK = [['lum', 'Lumineux'], ['calme', 'Calme'], ['vitrage', 'Double vitrage'], ['eau', 'Pression et eau chaude'], ['chauff', 'Chauffage correct'], ['humid', 'Pas d\'humidité'], ['reseau', 'Réseau mobile'], ['fibre', 'Fibre'], ['rang', 'Rangements'], ['etat', 'Bon état général'], ['communs', 'Parties communes propres'], ['cave', 'Cave ou local vélo'], ['quartier', 'Quartier agréable'], ['transports', 'Transports proches']];
function checkScore(f) { const c = f.check || {}, ok = CHECK.filter(([k]) => c[k] === 'ok').length, ko = CHECK.filter(([k]) => c[k] === 'ko').length; return ok || ko ? `${ok} ✓ · ${ko} ✗` : '–'; }
const TPL = {
  apply: 'Bonjour,\n\nNous sommes très intéressés par votre annonce « {annonce} ». Nous sommes un couple, {noms}, tous les deux en activité, et nous cherchons un logement pour nous y installer durablement.\n\nNotre dossier est complet et prêt à vous être envoyé. Nous sommes disponibles pour une visite dès que possible, en journée comme en soirée.\n\nPourriez-vous nous indiquer vos prochaines disponibilités ?\n\nBien cordialement,\n{noms}',
  relance: 'Bonjour,\n\nJe me permets de revenir vers vous au sujet de l\'annonce « {annonce} », pour laquelle nous vous avons contacté récemment. Nous sommes toujours très intéressés et notre dossier complet est prêt.\n\nSerait-il possible de convenir d\'une visite, ou de savoir où en est notre candidature ?\n\nMerci d\'avance pour votre retour.\n\nBien cordialement,\n{noms}'
};
function tplSheet(f, kind) {
  const names = S.users.map(u => u.name).join(' et '), key = 'tpl_' + kind;
  let txt = (couple()[key] || TPL[kind]).replace(/\{annonce\}/g, f.title).replace(/\{noms\}/g, names);
  openSheet(kind === 'apply' ? 'Message de candidature' : 'Message de relance', c => [
    h('textarea', { class: 'inp', id: 'tpl_t', style: { minHeight: '300px' }, 'aria-label': 'Texte du message', value: txt, oninput: e => txt = e.target.value }),
    h('button', { class: 'btn pri full', onclick: () => copyText(txt) }, 'Copier le message'),
    h('button', { class: 'btn full', onclick: () => { put('profiles', { ...couple(), id: '_couple', [key]: txt.split(f.title).join('{annonce}').split(names).join('{noms}') }); toast('Enregistré comme modèle pour les prochains apparts'); } }, 'Garder ce texte comme modèle'),
    couple()[key] ? h('button', { class: 'btn full danger', onclick: () => { const cp = { ...couple(), id: '_couple' }; delete cp[key]; put('profiles', cp); c.close(); toast('Modèle d\'origine rétabli'); } }, 'Revenir au texte d\'origine') : null
  ]);
}
function flatExtras(f, save) {
  const c = f.check || {};
  return [h('hr', { class: 'sep' }),
  h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Checklist de visite · ' + checkScore(f)),
    h('div', { class: 'chips' }, CHECK.map(([k, l]) => h('button', { class: 'chip ck ' + (c[k] || ''), 'aria-label': `${l} : ${c[k] === 'ok' ? 'oui' : c[k] === 'ko' ? 'non' : 'à vérifier'}`, onclick: () => save({ check: { ...c, [k]: c[k] === 'ok' ? 'ko' : c[k] === 'ko' ? '' : 'ok' } }) }, c[k] === 'ok' ? '✓ ' : c[k] === 'ko' ? '✗ ' : '', l))),
    h('span', { class: 'small faint', style: { paddingLeft: '4px' } }, 'Un tap : oui. Deux : non. Trois : à vérifier.')),
  h('div', { class: 'frow' }, h('button', { class: 'btn sm', onclick: () => tplSheet(f, 'apply') }, '✉️ Candidature'), h('button', { class: 'btn sm', onclick: () => tplSheet(f, 'relance') }, '📞 Relance'))];
}

/* ================= TRIBUNAL ================= */
VIEWS.tribunal = () => {
  const me = S.me.id, o = other(), cases = all('disputes').sort((a, b) => b.at - a.at);
  const plead = d => formSheet({ title: d.id ? 'Ma version des faits' : 'Nouvelle affaire', submit: d.id ? 'Plaider' : 'Ouvrir l\'affaire', values: { title: d.title || '', mine: (d.sides || {})[me] || '' },
    fields: [!d.id && { k: 'title', label: 'L\'objet du litige', ph: 'Qui avait dit qu\'on irait chez ses parents ?', required: true }, { k: 'mine', label: 'Ma version', type: 'textarea', ph: 'Les faits, rien que les faits.', required: true }].filter(Boolean),
    onSubmit: v => put('disputes', { ...d, title: d.id ? d.title : v.title, sides: { ...(d.sides || {}), [me]: v.mine } }) });
  const judge = d => { const w = Math.random() < .5 ? me : o.id; put('disputes', { ...d, winner: w, judgedAt: Date.now() }); toast(`⚖️ La pièce a parlé : ${nameOf(w)} a raison`); };
  return [
    head('Le tribunal', { back: 'plus', add: () => plead({}), addLabel: 'Nouvelle affaire' }),
    cases.length ? cases.map(d => {
      const both = S.users.every(u => (d.sides || {})[u.id]), loser = d.winner && S.users.find(u => u.id !== d.winner);
      return sec(eyebrow('Affaire', d.winner ? h('span', { class: 'pill plain', c: 'var(--good)' }, 'Jugée') : h('span', { class: 'pill plain', c: 'var(--warn)' }, both ? 'En délibéré' : 'En attente')), h('div', { class: 'mid' }, d.title),
        S.users.map(u => h('div', { class: 'row', style: { alignItems: 'flex-start' } }, avatar(u.id, true), h('div', { class: 'grow' }, (d.sides || {})[u.id] ? h('div', { style: { whiteSpace: 'pre-wrap' } }, d.sides[u.id]) : h('span', { class: 'faint' }, u.id === me ? 'Tu n\'as pas encore plaidé' : `${u.name} n'a pas encore plaidé`)))),
        d.winner ? [h('p', { class: 'b' }, `⚖️ Verdict à pile ou face : ${nameOf(d.winner)} a raison. ${loser.name} doit un bon.`), loser.id === me ? h('button', { class: 'btn pri full', onclick: () => go('bons') }, 'Offrir un bon pour me faire pardonner') : null]
          : [!(d.sides || {})[me] ? h('button', { class: 'btn pri full', onclick: () => plead(d) }, 'Donner ma version') : null, both ? h('button', { class: 'btn pri full', onclick: () => judge(d) }, '⚖️ Rendre le verdict') : null],
        h('button', { class: 'btn sm danger', style: { alignSelf: 'flex-start' }, onclick: async () => { if (await confirmSheet('Classer l\'affaire ?', 'Elle sera supprimée.', 'Classer', true)) del('disputes', d.id); } }, 'Classer sans suite'));
    }) : sec(h('div', { class: 'empty' }, 'Un désaccord ? Chacun donne sa version, puis la pièce tranche. Le perdant offre un bon.'))
  ];
};

/* ================= DÉFI DE LA SEMAINE ================= */
const defiOf = w => { const L = (window.NOUS_QUESTIONS || []).defis || ['Faites quelque chose de nouveau ensemble.'], n = Math.floor(daysBetween('2026-01-05', w) / 7); return L[((n % L.length) + L.length) % L.length]; };
VIEWS.defi = () => {
  const w = monday(today()), me = S.me.id, d = (S.cols.defis || {})[w] || { id: w, week: w, done: {} }, both = S.users.every(u => (d.done || {})[u.id]);
  const past = all('defis').filter(x => x.week < w).sort((a, b) => b.week.localeCompare(a.week)).slice(0, 10);
  const nDone = all('defis').filter(x => S.users.every(u => (x.done || {})[u.id])).length;
  return [
    head('Défi de la semaine', { back: 'plus', extra: nDone ? h('span', { class: 'pill plain', c: 'var(--good)' }, `${nDone} réussi${nDone > 1 ? 's' : ''}`) : null }),
    sec(h('div', { class: 'eyebrow' }, `Semaine du ${fmtD(w, { day: 'numeric', month: 'long' })}`), h('p', { class: 'big', style: { fontSize: '24px' } }, defiOf(w)),
      S.users.map(u => h('div', { class: 'row' }, avatar(u.id, true), h('span', { class: 'grow ' + ((d.done || {})[u.id] ? 'good b' : 'muted') }, (d.done || {})[u.id] ? 'Validé ✓' : 'Pas encore validé'))),
      both ? h('p', { class: 'mid center' }, 'Défi réussi à deux 🎉') : null,
      h('button', { class: 'btn full ' + ((d.done || {})[me] ? '' : 'pri'), onclick: () => { const done = { ...(d.done || {}) }; if (done[me]) delete done[me]; else done[me] = Date.now(); put('defis', { ...d, done }); } }, (d.done || {})[me] ? 'Annuler ma validation' : 'C\'est fait ✓')),
    past.length ? sec(eyebrow('Semaines passées'), h('div', { class: 'list' }, past.map(x => { const ok = S.users.every(u => (x.done || {})[u.id]); return h('div', { class: 'item' }, h('span', { class: 'emo' }, ok ? '🏅' : '💤'), h('div', { class: 'grow' }, h('div', { class: ok ? 'b' : 'muted' }, defiOf(x.week)), h('div', { class: 'small faint' }, `Semaine du ${fmtD(x.week, { day: 'numeric', month: 'long' })}`))); }))) : null
  ];
};

/* ================= QUI ME CONNAÎT LE MIEUX ================= */
const QUIZQ = ['Mon plat préféré ?', 'Le film que je peux revoir dix fois ?', 'Ma plus grande peur ?', 'Ce que je commande toujours au resto ?', 'Mon pire défaut, selon moi ?', 'La destination de mes rêves ?', 'Ce qui m\'énerve le plus au quotidien ?', 'Ma chanson du moment ?', 'Mon dessert préféré ?', 'Le métier que je voulais faire enfant ?', 'Ce que je fais en premier le matin ?', 'Mon odeur préférée ?', 'La chose dont je suis le plus fier ?', 'Mon pire souvenir de vacances ?', 'Ce que j\'emporterais sur une île déserte ?', 'Ma boisson préférée ?', 'Le super-pouvoir que je choisirais ?', 'Mon plus gros craquage récent ?', 'La série que j\'ai le plus aimée ?', 'Ce qui me fait rire à tous les coups ?', 'Mon moment préféré de la journée ?', 'L\'animal que j\'aimerais avoir ?', 'Le cadeau qui m\'a le plus marqué ?', 'Ce que je préfère chez toi ?', 'Ma saison préférée ?', 'Le plat que je déteste ?', 'Mon endroit préféré à Paris ?', 'Ce que je ferais avec un jour de congé surprise ?', 'Mon tic de langage ?', 'La matière que je préférais à l\'école ?'];
VIEWS.quiz = () => {
  const me = S.me.id, o = other(), rs = all('quiz').sort((a, b) => b.at - a.at), ym = today().slice(0, 7);
  const ask = () => {
    const used = new Set(rs.filter(r => r.about === me).map(r => r.q)), pool = QUIZQ.filter(q => !used.has(q)), src = pool.length ? pool : QUIZQ;
    const v = { q: src[Math.floor(Math.random() * src.length)], answer: '' };
    openSheet('Une question sur moi', c => [h('p', { class: 'big', style: { fontSize: '23px' } }, v.q),
    h('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onclick: () => { v.q = src[Math.floor(Math.random() * src.length)]; c.refresh(); } }, 'Une autre question'),
    h('div', { class: 'f' }, h('label', { htmlFor: 'qz_a' }, 'Ma vraie réponse'), h('input', { class: 'inp', id: 'qz_a', value: v.answer, placeholder: `${o.name} ne la verra qu'après avoir deviné`, oninput: e => v.answer = e.target.value })),
    h('button', { class: 'btn pri full', onclick: () => { if (!v.answer.trim()) return toast('Écris ta réponse'); put('quiz', { about: me, q: v.q, answer: v.answer.trim() }); c.close(); toast(`À ${o.name} de deviner`); } }, `Envoyer à ${o.name}`)]);
  };
  const score = u => { const j = rs.filter(r => r.about !== u && r.ok != null && iso(new Date(r.at)).slice(0, 7) === ym); return [j.filter(r => r.ok).length, j.length]; };
  const toGuess = rs.filter(r => r.about === o.id && !r.guess), toJudge = rs.filter(r => r.about === me && r.guess && r.ok == null), waiting = rs.filter(r => r.about === me && !r.guess), done = rs.filter(r => r.ok != null).slice(0, 15);
  return [
    head('Qui me connaît le mieux', { back: 'plus', add: ask, addLabel: 'Poser une question sur moi' }),
    sec(eyebrow('Score du mois'), h('div', { class: 'row', style: { justifyContent: 'space-around' } }, S.users.map(u => { const [ok, n] = score(u.id); return h('div', { class: 'row' }, avatar(u.id), h('div', null, h('div', { class: 'big num' }, `${ok}/${n}`), h('div', { class: 'tiny muted' }, 'bonnes réponses'))); }))),
    toGuess.map(r => sec(eyebrow(`À toi de deviner ${o.name}`), h('p', { class: 'mid' }, r.q), inlineAdd('qz_' + r.id, 'Ta proposition…', g => put('quiz', { ...r, guess: g }), 'send'))),
    toJudge.map(r => sec(eyebrow('À toi de juger'), h('p', { class: 'mid' }, r.q), h('div', { class: 'small muted' }, 'Ta réponse : ' + r.answer), h('div', { class: 'b' }, `${o.name} a proposé : ${r.guess}`), h('div', { class: 'frow' }, h('button', { class: 'btn pri', onclick: () => put('quiz', { ...r, ok: true }) }, '✓ Bien vu'), h('button', { class: 'btn', onclick: () => put('quiz', { ...r, ok: false }) }, '✗ Raté')))),
    waiting.length ? sec(eyebrow(`En attente de ${o.name}`), h('div', { class: 'list' }, waiting.map(r => h('div', { class: 'item' }, h('span', { class: 'emo' }, '⏳'), h('div', { class: 'grow' }, h('div', { class: 'b' }, r.q), h('div', { class: 'small muted' }, 'Ta réponse : ' + r.answer)), h('button', { class: 'ibtn', style: { width: '32px', height: '32px' }, 'aria-label': 'Retirer cette question', onclick: () => del('quiz', r.id) }, icon('x')))))) : null,
    !toGuess.length && !toJudge.length ? h('button', { class: 'btn pri full', onclick: ask }, 'Poser une question sur moi') : null,
    done.length ? sec(eyebrow('Manches jouées'), h('div', { class: 'list' }, done.map(r => h('div', { class: 'item', style: { alignItems: 'flex-start' } }, h('span', { class: 'emo' }, r.ok ? '🎯' : '🙈'), h('div', { class: 'grow' }, h('div', { class: 'small muted' }, `Sur ${nameOf(r.about)} · ${r.q}`), h('div', { class: 'b' }, r.answer), h('div', { class: 'small ' + (r.ok ? 'good' : 'muted') }, `Proposé : ${r.guess}`)))))) : null
  ];
};

/* ================= CAPSULES TEMPORELLES ================= */
VIEWS.capsules = () => {
  const t = today(), cs = all('capsules').sort((a, b) => a.openAt.localeCompare(b.openAt));
  const sealed = cs.filter(c => c.openAt > t), open = cs.filter(c => c.openAt <= t).reverse();
  const form = () => formSheet({ title: 'Nouvelle capsule', submit: 'Sceller', values: { openAt: addDays(t, 180) }, fields: [{ k: 'title', label: 'Titre visible', ph: 'Pour notre anniversaire, pour dans six mois…', required: true }, { k: 'text', label: 'Le message', type: 'textarea', ph: 'Ce que tu veux qu\'on relise ce jour-là.', required: true }, { k: 'openAt', label: 'S\'ouvre le', type: 'date', required: true, hint: 'Une fois scellée, même toi tu ne pourras plus la relire avant cette date.' }],
    onSubmit: v => { if (v.openAt <= t) { toast('Choisis une date à venir'); return false; } return put('capsules', v); } });
  return [
    head('Capsules', { back: 'plus', add: form, addLabel: 'Nouvelle capsule' }),
    sealed.length ? sec(eyebrow('Scellées'), h('div', { class: 'list' }, sealed.map(c => h('div', { class: 'item' }, h('span', { class: 'emo' }, '🔒'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, c.title), h('div', { class: 'small muted' }, `De ${nameOf(c.by)} · s'ouvre le ${fmtD(c.openAt, { day: 'numeric', month: 'long', year: 'numeric' })} (${rel(c.openAt)})`)), c.by === S.me.id ? h('button', { class: 'ibtn', style: { width: '32px', height: '32px' }, 'aria-label': 'Détruire cette capsule', onclick: async () => { if (await confirmSheet('Détruire cette capsule ?', 'Son message sera perdu.', 'Détruire', true)) del('capsules', c.id); } }, icon('x')) : null)))) : null,
    open.map(c => sec(eyebrow(`Ouverte le ${fmtD(c.openAt, { day: 'numeric', month: 'long', year: 'numeric' })}`, avatar(c.by, true)), h('div', { class: 'mid' }, c.title), h('p', { style: { whiteSpace: 'pre-wrap' } }, c.text || ''), h('div', { class: 'small faint' }, `Écrite le ${fmtD(iso(new Date(c.at)), { day: 'numeric', month: 'long', year: 'numeric' })}`))),
    !cs.length ? sec(h('div', { class: 'empty' }, 'Écris un message qui ne s\'ouvrira qu\'à la date choisie : dans six mois, à votre anniversaire, le jour de l\'emménagement.')) : null
  ];
};

/* ================= TROPHÉES ================= */
function trophies() {
  const n = c => all(c).length, t = today(), cp = couple(), flats = all('flats');
  const days = cp.since && cp.since <= t ? daysBetween(cp.since, t) : 0;
  const defisOk = all('defis').filter(x => S.users.every(u => (x.done || {})[u.id])).length;
  const potOk = all('pots').some(p => +p.goal > 0 && sum(all('potins').filter(x => x.pot === p.id).map(x => x.amount)) >= +p.goal);
  const st = streak(), T = (e, name, desc, cur, goal) => ({ e, name, desc, cur: Math.min(cur, goal), goal, ok: cur >= goal });
  return [
    T('🔥', 'Une semaine de questions', 'Répondre tous les deux 7 jours d\'affilée', st, 7), T('🌋', 'Inséparables', '30 jours de question du jour d\'affilée', st, 30),
    T('💌', 'Premiers mots doux', '10 petits mots échangés', n('notes'), 10), T('📬', 'Pipelettes', '100 petits mots échangés', n('notes'), 100),
    T('💗', 'Dans mes pensées', '50 « je pense à toi »', sum(all('pokes').map(p => p.n)), 50),
    T('📸', 'Album démarré', '10 photos ajoutées', n('photos'), 10), T('🖼️', 'Photographes', '50 photos ajoutées', n('photos'), 50),
    T('🏠', 'En chasse', 'Premier appart repéré', flats.length, 1), T('🔑', 'Visiteurs', '3 apparts visités', flats.filter(f => (f.history || []).some(x => x.s === 'visite')).length, 3), T('🏆', 'Chez nous', 'Un dossier accepté', flats.filter(f => f.status === 'accepte').length, 1),
    T('✅', 'Bons comptes', 'Première régularisation', n('settlements'), 1), T('🧮', 'Comptables', '10 régularisations', n('settlements'), 10),
    T('🎟️', 'Généreux', '5 bons offerts', n('coupons'), 5), T('⚖️', 'Justice rendue', 'Une affaire jugée au tribunal', all('disputes').filter(d => d.winner).length, 1),
    T('🏅', 'Défi relevé', 'Un défi de la semaine réussi à deux', defisOk, 1), T('🥇', 'Champions', '10 défis réussis à deux', defisOk, 10),
    T('🎯', 'Je te connais', '10 bonnes réponses au quiz', all('quiz').filter(r => r.ok).length, 10), T('💊', 'Message pour le futur', 'Une capsule scellée', n('capsules'), 1),
    T('🏝️', 'Objectif atteint', 'Une cagnotte remplie', potOk ? 1 : 0, 1), T('🧹', 'Maison nickel', '20 tâches faites', n('chorelog'), 20),
    T('🎶', 'Bande-son', '10 morceaux dans la playlist', n('songs'), 10), T('📖', 'Notre histoire', '5 moments dans la frise', n('milestones'), 5),
    T('🗓️', 'Un an', '365 jours ensemble', days, 365), T('💎', 'Mille jours', '1 000 jours ensemble', days, 1000)
  ];
}
VIEWS.trophees = () => {
  const ts = trophies(), ok = ts.filter(x => x.ok).length;
  return [head('Trophées', { back: 'plus', sub: `${ok} débloqué${ok > 1 ? 's' : ''} sur ${ts.length}` }),
  h('div', { class: 'grid2' }, ts.sort((a, b) => b.ok - a.ok || b.cur / b.goal - a.cur / a.goal).map(x => h('div', { class: 'glass card trophy' + (x.ok ? ' ok' : '') }, h('div', { class: 'te' }, x.e), h('div', { class: 'b' }, x.name), h('div', { class: 'small muted' }, x.desc), x.ok ? h('div', { class: 'small good b' }, 'Débloqué ✓') : [h('div', { class: 'track' }, h('i', { style: { width: Math.max(3, x.cur / x.goal * 100) + '%' } })), h('div', { class: 'tiny faint num' }, `${x.cur} / ${x.goal}`)])))];
};

/* ================= BILAN DU MOIS ================= */
VIEWS.bilan = () => {
  const t = today(), def = () => { const d = pd(t); if (d.getDate() < 8) d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); };
  const ym = S.bilanMonth || def(), inM = d => d && String(d).slice(0, 7) === ym, tsIn = ts => ts && iso(new Date(ts)).slice(0, 7) === ym;
  const shift = n => { const d = pd(ym + '-01'); d.setMonth(d.getMonth() + n); S.bilanMonth = iso(d).slice(0, 7); render(true); };
  const last = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate();
  let together = 0; for (let i = 1; i <= last; i++) { const d = `${ym}-${pad(i)}`; if (d > t) break; const a = placeOf(S.users[0].id, d), b = S.users[1] && placeOf(S.users[1].id, d); if (a && a === b) together++; }
  const exp = all('expenses').filter(e => inM(e.date) && e.split !== 'payer'), big = exp.slice().sort((a, b) => b.amount - a.amount)[0];
  const qBoth = [...new Set(all('answers').filter(a => inM(a.date)).map(a => a.date))].filter(d => S.users.every(u => ans(d, u.id))).length;
  const photos = all('photos').filter(p => inM(p.date)), evs = all('events').filter(e => inM(e.date) && (e.kind === 'soiree' || e.who === 'both'));
  const visits = all('flats').filter(f => (f.history || []).some(x => x.s === 'visite' && tsIn(x.at))).length;
  const mood = u => { const c = {}; for (const m of all('moods')) if (m.user === u && inM(m.date)) c[m.emoji] = (c[m.emoji] || 0) + 1; const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? top[0] : '·'; };
  const tile = (e, v, l) => h('div', { class: 'glass card', style: { gap: '4px' } }, h('div', { style: { fontSize: '24px' } }, e), h('div', { class: 'big num', style: { fontSize: '26px' } }, v), h('div', { class: 'small muted' }, l));
  return [
    head('Bilan du mois', { back: 'plus' }),
    h('div', { class: 'row between' }, h('button', { class: 'ibtn', 'aria-label': 'Mois précédent', onclick: () => shift(-1) }, icon('back')), h('div', { class: 'mid' }, cap(fmtD(ym + '-01', { month: 'long', year: 'numeric' }))), h('button', { class: 'ibtn', 'aria-label': 'Mois suivant', onclick: () => shift(1) }, icon('next'))),
    h('div', { class: 'grid2' },
      tile('🫶', together, `jour${together > 1 ? 's' : ''} dans la même ville`), tile('💌', all('notes').filter(n => tsIn(n.at)).length, 'petits mots échangés'),
      tile('💗', sum(all('pokes').filter(p => inM(p.date)).map(p => p.n)), '« je pense à toi »'), tile('💬', qBoth, 'questions répondues à deux'),
      tile('🥂', evs.length, 'sorties et soirées'), tile('📸', photos.length, 'photos ajoutées'),
      tile('💶', eur0(sum(exp.map(e => e.amount))), 'dépensés ensemble'), tile('🔑', visits, `appart${visits > 1 ? 's' : ''} visité${visits > 1 ? 's' : ''}`),
      tile('🎟️', all('coupons').filter(c => tsIn(c.usedAt)).length, 'bons utilisés'), tile('🧹', all('chorelog').filter(l => inM(l.date)).length, 'tâches faites')),
    sec(eyebrow('Humeur du mois'), h('div', { class: 'row', style: { justifyContent: 'space-around' } }, S.users.map(u => h('div', { class: 'row' }, avatar(u.id, true), h('span', { style: { fontSize: '30px' } }, mood(u.id)))))),
    big ? sec(eyebrow('La plus grosse dépense'), h('div', { class: 'row' }, h('span', { class: 'emo' }, catOf(big.cat)[1]), h('div', { class: 'grow' }, h('div', { class: 'b' }, big.label), h('div', { class: 'small muted' }, `${fmtD(big.date)} · ${nameOf(big.paidBy)}`)), h('span', { class: 'amt' }, eur(big.amount)))) : null,
    photos.length ? sec(eyebrow('En images'), h('div', { class: 'pgrid' }, photos.slice(0, 9).map(p => h('button', { onclick: () => photoSheet(p.id), 'aria-label': p.caption || 'Photo' }, h('img', { src: B.fileUrl(p.fileId), alt: p.caption || '', loading: 'lazy' }))))) : null
  ];
};

/* ================= PLAYLIST ================= */
VIEWS.playlist = () => {
  const w = monday(today()), ss = all('songs').sort((a, b) => b.at - a.at);
  const form = s => formSheet({ title: s.id ? 'Modifier' : 'Ajouter un morceau', values: s, fields: [{ k: 'title', label: 'Titre', required: true }, { k: 'artist', label: 'Artiste' }, { k: 'url', label: 'Lien (Spotify, YouTube, Deezer…)', type: 'url', ph: 'https://…' }, { k: 'why', label: 'Pourquoi celui-là', type: 'textarea', ph: 'Il me fait penser à…' }], onSubmit: v => put('songs', v), onDelete: s.id ? () => del('songs', s.id) : null });
  return [
    head('Playlist à deux', { back: 'plus', add: () => form({}), addLabel: 'Ajouter un morceau' }),
    sec(eyebrow('Cette semaine'), h('div', { class: 'row', style: { justifyContent: 'space-around' } }, S.users.map(u => { const ok = ss.some(s => s.by === u.id && iso(new Date(s.at)) >= w); return h('div', { class: 'row' }, avatar(u.id, true), h('span', { class: ok ? 'good b' : 'muted' }, ok ? 'Morceau ajouté ✓' : 'Pas encore')); })), h('p', { class: 'small faint center' }, 'Un morceau chacun par semaine, avec un mot sur pourquoi.')),
    ss.length ? sec(h('div', { class: 'list' }, ss.map(s => h('div', { class: 'item', style: { alignItems: 'flex-start' } }, h('button', { class: 'row grow', style: { textAlign: 'left', alignItems: 'flex-start' }, onclick: () => s.by === S.me.id ? form(s) : null }, avatar(s.by, true), h('div', { class: 'grow' }, h('div', { class: 'b' }, s.title), h('div', { class: 'small muted' }, [s.artist, fmtD(iso(new Date(s.at)))].filter(Boolean).join(' · ')), s.why && h('div', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, '« ' + s.why + ' »'))), s.url ? h('a', { class: 'btn sm', href: s.url, target: '_blank', rel: 'noopener noreferrer' }, 'Écouter ↗') : null))))
      : sec(h('div', { class: 'empty' }, 'Ajoutez votre premier morceau avec le bouton +.'))
  ];
};

/* ================= PLUS (menu complet) ================= */
VIEWS.plus = () => {
  const t = today(), me = S.me.id, o = other(), w = monday(t);
  const groups = [
    ['Nous deux', [['mots', '💌', 'Petits mots'], ['question', '💬', 'Question du jour', ans(t, me) ? 0 : 1], ['bons', '🎟️', 'Bons', all('coupons').filter(c => c.to === me && !c.usedAt).length], ['envies', '🎁', 'Envies'], ['playlist', '🎶', 'Playlist'], ['cycle', '🌸', 'Cycle']]],
    ['Quotidien', [['listes', '✅', 'Listes', all('items').filter(i => !i.done).length], ['menu', '🍽️', 'Menu'], ['taches', '🧹', 'Qui fait quoi', all('chores').filter(c => c.next <= t && c.turn === me).length], ['cagnotte', '🏝️', 'Cagnottes'], ['trajets', '🚄', 'Trajets'], ['infos', '📌', 'Infos pratiques'], ['docs', '🗂️', 'Documents'], ['suivi', '📊', 'Suivi']]],
    ['Jeux', [['roue', '🎡', 'La roue'], ['defi', '🏅', 'Défi', ((S.cols.defis || {})[w] || { done: {} }).done[me] ? 0 : 1], ['quiz', '🎯', 'Quiz', all('quiz').filter(r => (r.about === o.id && !r.guess) || (r.about === me && r.guess && r.ok == null)).length], ['tribunal', '⚖️', 'Tribunal', all('disputes').filter(d => !d.winner && !(d.sides || {})[me]).length], ['trophees', '🏆', 'Trophées']]],
    ['Souvenirs', [['photos', '📸', 'Photos'], ['histoire', '📖', 'Notre histoire'], ['capsules', '💊', 'Capsules'], ['bilan', '📅', 'Bilan du mois'], ['rebours', '⏳', 'Comptes à rebours']]]
  ];
  return [head('Plus', { extra: h('button', { class: 'ibtn', 'aria-label': 'Réglages', onclick: () => go('reglages') }, '⚙️') }),
  groups.map(([name, tiles]) => [h('div', { class: 'eyebrow', style: { padding: '6px 4px 0' } }, name), h('div', { class: 'tiles' }, tiles.map(([id, e, lab, n]) => h('button', { class: 'glass tile', onclick: () => go(id) }, h('span', { class: 'e' }, e), lab, n ? h('span', { class: 'badge' }, n) : null)))])];
};
