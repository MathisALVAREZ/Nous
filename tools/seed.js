'use strict';
/* Données d'exemple pour la version de démonstration uniquement (jamais chargé sur le serveur). */
window.nousSeed = function () {
  const t = today(), now = Date.now(), ym = t.slice(0, 7), M = 'mathis', G = 'morgane';
  const cols = {}; for (const c of COLS) cols[c] = {};
  const add = (col, d, by, ago) => { d.id = d.id || col.slice(0, 2) + Object.keys(cols[col]).length + '_s'; d.by = d.by || by || M; d.at = now - (ago || 0) * 3600e3; cols[col][d.id] = d; return d; };
  const files = {};
  const pic = (emoji, c1, c2) => {
    const c = document.createElement('canvas'); c.width = c.height = 320; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 320, 320); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 320, 320);
    g.font = '150px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 160, 172);
    const id = 'fs' + Object.keys(files).length, data = c.toDataURL('image/jpeg', .72);
    files[id] = { name: 'exemple.jpg', mime: 'image/jpeg', size: Math.round(data.length * .75), data }; return id;
  };
  // réglages
  const ago = (y, m, d) => { const x = pd(t); x.setFullYear(x.getFullYear() - y); x.setMonth(x.getMonth() - m); x.setDate(x.getDate() - d); return iso(x); };
  add('profiles', { id: '_couple', seeded: true, defaultSplit: 'half', pct: 50, budget: 1200, since: ago(1, 8, 3) });
  // quotidien et jeux
  const mon = addDays(t, -((pd(t).getDay() + 6) % 7));
  add('meals', { id: t + '_soir', date: t, slot: 'soir', text: 'Risotto aux champignons', who: 'both', ing: 'Riz arborio\nChampignons de Paris\nParmesan\nBouillon de légumes' });
  add('meals', { id: addDays(t, 1) + '_midi', date: addDays(t, 1), slot: 'midi', text: 'Restes de risotto', who: M });
  add('meals', { id: addDays(t, 2) + '_soir', date: addDays(t, 2), slot: 'soir', text: 'Wraps poulet avocat', who: 'both', ing: 'Galettes de blé\nAvocats\nBlanc de poulet' }, G);
  add('chores', { id: 'ch1', title: 'Lessive', emoji: '🧺', every: 5, next: t, turn: M, last: addDays(t, -5) });
  add('chores', { id: 'ch2', title: 'Poubelles', emoji: '🗑️', every: 3, next: addDays(t, 1), turn: G });
  add('chores', { id: 'ch3', title: 'Aspirateur', emoji: '🧹', every: 7, next: addDays(t, 4), turn: M });
  [[M, 2], [G, 3], [G, 6], [M, 8], [G, 9]].forEach(([u, a]) => add('chorelog', { chore: 'ch' + (1 + a % 3), user: u, date: addDays(t, -a).slice(0, 7) === ym ? addDays(t, -a) : ym + '-01' }, u, a * 24));
  add('pots', { id: 'pot1', title: 'Vacances d\'été', emoji: '🏝️', goal: 1500 });
  [[M, 200, 40], [G, 150, 38], [M, 100, 12], [G, 120, 5]].forEach(([u, amount, a]) => add('potins', { pot: 'pot1', user: u, amount, date: addDays(t, -a) }, u, a * 24));
  add('trips', { who: M, from: 'Paris', to: 'Bordeaux', date: addDays(mon, 7), dep: '07:04', arr: '09:12', ref: 'Voiture 12 · place 45' });
  add('trips', { who: M, from: 'Bordeaux', to: 'Paris', date: addDays(mon, 9), dep: '18:46', arr: '20:54' });
  add('infos', { label: 'Pointure de Morgane', value: '38', emoji: '👟' }); add('infos', { label: 'Digicode de l\'immeuble', value: 'À renseigner', emoji: '🚪' }); add('infos', { label: 'Taille de bague', value: '52', emoji: '💍' }, G);
  add('disputes', { title: 'Qui avait promis de réserver le resto ?', sides: { [M]: 'J\'avais dit que je regarderais, pas que je réserverais.', [G]: 'Tu as dit « je m\'en occupe », mot pour mot.' }, winner: G, judgedAt: now - 3 * 864e5 }, G, 80);
  add('defis', { id: addDays(mon, -7), week: addDays(mon, -7), done: { [M]: now - 6 * 864e5, [G]: now - 5 * 864e5 } });
  add('quiz', { about: G, q: 'Mon dessert préféré ?', answer: 'Le tiramisu' }, G, 5);
  add('quiz', { about: M, q: 'Ce que je commande toujours au resto ?', answer: 'Un burger', guess: 'Un burger avec des frites', ok: true }, M, 60);
  add('capsules', { title: 'À ouvrir pour notre emménagement', text: 'Si tu lis ça, c\'est qu\'on a enfin nos clés.', openAt: addDays(t, 60) }, G, 100);
  add('pokes', { id: t + '_' + G, date: t, user: G, n: 2, last: now - 3600e3 }, G);
  add('songs', { title: 'Le morceau du trajet retour', artist: 'À remplacer par le vrai', why: 'Il passait dans la voiture en rentrant de Biarritz.' }, G, 30);
  add('songs', { title: 'Celui du premier concert', artist: 'À remplacer par le vrai', why: 'On l\'a hurlé tous les deux.' }, M, 200);
  // compteurs
  add('trackers', { id: 'tk_cafe', name: 'Cafés', emoji: '☕', vis: 'shared', goalType: 'max', goal: 4 });
  add('trackers', { id: 'tk_sport', name: 'Sport', emoji: '🏃', vis: 'both', goalType: 'none' }, G);
  add('trackers', { id: 'tk_clope', name: 'Clopes', emoji: '🚬', vis: 'private', goalType: 'max', goal: 5 });
  [3, 4, 2, 5, 3, 3, 4, 2, 3, 6, 3, 4, 3, 2].forEach((n, i) => add('tlogs', { id: `tk_cafe_${addDays(t, i - 13)}_${M}`, tracker: 'tk_cafe', date: addDays(t, i - 13), user: M, n, last: now - (13 - i) * 864e5 - 2 * 3600e3 }));
  [6, 4, 5, 3, 4, 2, 3, 3, 2, 4, 1, 2, 0, 1].forEach((n, i) => add('tlogs', { id: `tk_clope_${addDays(t, i - 13)}_${M}`, tracker: 'tk_clope', date: addDays(t, i - 13), user: M, n, last: now - (13 - i) * 864e5 - 3600e3 }));
  [[12, M], [9, G], [9, M], [5, G], [2, M], [2, G]].forEach(([a, u]) => add('tlogs', { id: `tk_sport_${addDays(t, -a)}_${u}`, tracker: 'tk_sport', date: addDays(t, -a), user: u, n: 1, last: now - a * 864e5 }, u));
  // humeur, histoire, bons, mot programmé
  add('moods', { id: t + '_' + G, date: t, user: G, emoji: '🥰', text: 'Hâte d\'être à ce soir' }, G, 2);
  add('milestones', { title: 'Premier rendez-vous', date: ago(1, 8, 3), emoji: '☕', note: 'Un café qui a duré quatre heures.' });
  add('milestones', { title: 'Premier week-end à deux', date: ago(1, 0, 0), emoji: '🌊', note: 'Biarritz, la pluie, et on a adoré quand même.' }, G);
  add('milestones', { title: 'On décide de chercher un appart', date: ago(0, 1, 6), emoji: '🔑' });
  add('coupons', { title: 'Un massage', emoji: '💆', from: G, to: M }, G, 30);
  add('coupons', { title: 'Petit-déj au lit', emoji: '🍳', from: M, to: G }, M, 50);
  add('coupons', { title: 'Tu choisis le film, sans discussion', emoji: '🎬', from: M, to: G, usedAt: now - 5 * 864e5 }, M, 300);
  add('scheduled', { text: 'Bravo pour ton service, je t\'attends avec un thé 🍵', to: G, sendAt: addDays(t, 1) + 'T23:35' });
  add('profiles', { id: M, home: 'Paris' }); add('profiles', { id: G, home: 'Paris', trackCycle: true, shareCycle: true }, G);
  for (const [a, n] of [[81, 5], [53, 4], [25, 5]]) add('cycles', { start: addDays(t, -a), end: addDays(t, -a + n - 1) }, G, a * 24);
  // villes : Mathis à Bordeaux du lundi au mercredi, les deux prochaines semaines
  const dow = pd(t).getDay(), nextMon = addDays(t, ((8 - dow) % 7) || 7);
  for (const w of [0, 14]) for (let i = 0; i < 3; i++) { const d = addDays(nextMon, w + i); add('places', { id: d + '_' + M, date: d, user: M, place: 'Bordeaux' }); }
  // agenda
  const sat = addDays(t, (6 - dow + 7) % 7 || 7);
  add('events', { title: 'Service du soir', kind: 'service', preset: 'soir', who: G, date: addDays(t, 1), time: '18:30', endTime: '23:30' }, G);
  add('events', { title: 'Service du midi', kind: 'service', preset: 'midi', who: G, date: addDays(t, 2), time: '11:30', endTime: '15:00' }, G);
  add('events', { title: 'Dîner chez Léa et Tom', kind: 'soiree', who: 'both', date: sat, time: '20:00', note: 'Apporter le dessert' });
  add('events', { title: 'TGV Paris → Bordeaux', kind: 'trajet', who: M, date: nextMon, time: '07:04', endTime: '09:12' });
  add('events', { title: 'Cours', kind: 'cours', who: M, date: nextMon, time: '09:30', endTime: '17:30' });
  add('events', { title: 'Cours', kind: 'cours', who: M, date: addDays(nextMon, 1), time: '09:00', endTime: '17:30' });
  add('events', { title: 'Ciné', kind: 'soiree', who: 'both', date: addDays(nextMon, 4), time: '20:30' }, G);
  // comptes
  const day = n => { const d = addDays(t, -n); return d.slice(0, 7) === ym ? d : ym + '-01'; };
  add('expenses', { label: 'Courses de la semaine', amount: 64.3, paidBy: M, split: 'half', cat: 'courses', date: day(1) });
  add('expenses', { label: 'Resto italien', amount: 58, paidBy: G, split: 'half', cat: 'resto', date: day(3) }, G);
  add('expenses', { label: 'Billets de train', amount: 46, paidBy: M, split: 'payer', cat: 'transport', date: day(4) });
  add('expenses', { label: 'Places de concert', amount: 70, paidBy: G, split: 'half', cat: 'sorties', date: day(6) }, G);
  add('expenses', { label: 'Cadeau pour Léa', amount: 35, paidBy: M, split: 'half', cat: 'cadeaux', date: day(8) });
  add('recurring', { id: 'rc1', label: 'Netflix', amount: 13.49, paidBy: M, split: 'half', cat: 'abos', day: 5, last: ym });
  add('expenses', { id: 'r_rc1_' + ym, label: 'Netflix', amount: 13.49, paidBy: M, split: 'half', cat: 'abos', date: ym + '-05', rec: 'rc1' });
  // petits mots
  add('notes', { text: 'Bon courage pour ton service 💪', to: G }, M, 26);
  add('notes', { text: 'Merci ❤️ Tu rentres à quelle heure ?', to: M }, G, 25);
  add('notes', { text: 'Je pense à toi 💭', to: M }, G, 3);
  // appart
  const hist = (...s) => s.map(([st, ago, by]) => ({ s: st, at: now - ago * 864e5, by: by || M }));
  add('flats', { title: 'T2 rue de la Tombe-Issoire', url: 'https://example.com/annonce-1', rent: 1090, charges: 80, surface: 38, area: 'Paris 14e', commute: { [M]: 14, [G]: 19 }, status: 'visite', visitAt: addDays(t, 2) + 'T18:30', lastActionAt: now - 864e5, history: hist(['repere', 6], ['contacte', 4], ['visite', 1, G]), ratings: { [M]: 4, [G]: 5 }, opinions: { [G]: 'Lumineux, et la cuisine est séparée !' }, notes: '3e étage avec ascenseur, non meublé.', photos: [pic('🛋️', '#9cc7ff', '#d7b8ff')] }, M, 150);
  add('flats', { title: 'T2 Montrouge, proche métro', url: 'https://example.com/annonce-2', rent: 980, charges: 110, surface: 42, area: 'Montrouge', commute: { [M]: 22, [G]: 27 }, status: 'contacte', lastActionAt: now - 6 * 864e5, history: hist(['repere', 8], ['contacte', 6]), ratings: { [M]: 3 }, photos: [pic('🪴', '#b9f0c8', '#8fd3ff')] }, M, 200);
  add('flats', { title: 'T2 avenue d\'Italie', rent: 1180, charges: 95, surface: 40, area: 'Paris 13e', commute: { [M]: 20, [G]: 16 }, status: 'dossier', lastActionAt: now - 2 * 864e5, history: hist(['repere', 9, G], ['contacte', 7, G], ['visite', 5, G], ['dossier', 2]), ratings: { [M]: 4, [G]: 4 } }, G, 220);
  add('flats', { title: 'T2 Malakoff', rent: 1020, charges: 70, surface: 36, area: 'Malakoff', commute: { [M]: 18, [G]: 30 }, status: 'refuse', lastActionAt: now - 3 * 864e5, history: hist(['repere', 12], ['contacte', 10], ['dossier', 7], ['refuse', 3]) }, M, 290);
  // question du jour
  const demoAns = (d, who, text) => { const q = qOf(d); add('answers', { id: d + '_' + who, date: d, user: who, text: q.t === 'who' ? (who === M ? G : M) : q.t === 'choice' ? (who === M ? 'a' : 'b') : text }, who, 2); };
  const y = addDays(t, -1);
  demoAns(y, M, 'Notre week-end à Biarritz, sans hésiter.'); demoAns(y, G, 'Le pique-nique improvisé sur les quais.');
  demoAns(t, G, 'Une réponse qui t\'attend…');
  // listes, dossiers, roue
  for (const [id, name, emoji] of [['l_courses', 'Courses', '🛒'], ['l_restos', 'Restos à tester', '🍜'], ['l_films', 'Films et séries', '🎬'], ['l_sorties', 'Idées de sorties', '🎡']]) add('lists', { id, name, emoji });
  [['l_courses', 'Lait d\'avoine'], ['l_courses', 'Parmesan'], ['l_courses', 'Café', true], ['l_restos', 'Le ramen de la rue Sainte-Anne'], ['l_restos', 'La trattoria du coin'], ['l_restos', 'Le bistrot étoilé pour une grande occasion'], ['l_sorties', 'Balade à vélo le long du canal'], ['l_sorties', 'Soirée jeux de société'], ['l_films', 'Finir la série du dimanche soir'], ['l_sorties', 'Expo à la Bourse de Commerce']].forEach(([list, text, done], i) => add('items', { list, text, done: !!done, lvl: /ramen|trattoria|jeux/.test(text) ? 1 : /étoilé/.test(text) ? 3 : /Expo/.test(text) ? 2 : 0 }, i % 2 ? G : M, i));
  for (const [id, name, emoji] of [['d_loc', 'Dossier locataire', '🔑'], ['d_admin', 'Administratif', '🗂️'], ['d_voy', 'Voyages', '✈️']]) add('folders', { id, name, emoji });
  ['Italien', 'Japonais', 'Burger', 'Thaï', 'Libanais', 'Crêpes', 'Pizza', 'On cuisine'].forEach((x, i) => add('wheel', { id: 'w_' + i, text: x }, M, -i));
  // envies
  add('wishes', { owner: M, text: 'Un casque audio', price: 150, reservedBy: G });
  add('wishes', { owner: M, text: 'Le dernier thriller de la rentrée' });
  add('wishes', { owner: G, text: 'Un cours de poterie', price: 60 }, G);
  add('wishes', { owner: G, text: 'Un week-end à la mer' }, G);
  // comptes à rebours
  const yr = +t.slice(0, 4), noel = `${t > yr + '-12-25' ? yr + 1 : yr}-12-25`;
  add('countdowns', { title: 'Noël', date: noel, emoji: '🎄' });
  add('countdowns', { title: 'Week-end à deux', date: addDays(t, 23), emoji: '🧳' }, G);
  // photos
  [['🌊', '#7fc8ff', '#ffe1a8', 'Biarritz', 40], ['🍝', '#ffb3a8', '#ffd98f', 'Le resto du samedi', 12], ['🌇', '#ffa9cc', '#8f9bff', 'Coucher de soleil sur les quais', 5], ['🎶', '#c4b0ff', '#ff9fc6', 'Avant le concert', 2]]
    .forEach(([e, a, b, caption, ago]) => add('photos', { fileId: pic(e, a, b), caption, date: addDays(t, -ago) }, ago % 2 ? G : M, ago * 24));
  return { cols, files };
};
