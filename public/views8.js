'use strict';
/* Nous — calendrier de l'Avent à deux : chacun prépare 24 cases pour l'autre (mot, photo, bon, défi).
   La case n s'ouvre le n décembre ; avant, le serveur ne transmet rien de son contenu, seulement qu'elle est remplie. */
const AV_ORDER = [7, 19, 2, 13, 22, 5, 16, 10, 1, 24, 12, 4, 18, 9, 21, 3, 15, 8, 20, 11, 23, 6, 14, 17]; // l'ordre des cases sur la grille, comme un vrai calendrier
const AV_KINDS = [['mot', '💌', 'Mot'], ['photo', '📸', 'Photo'], ['bon', '🎟️', 'Bon'], ['defi', '🏅', 'Défi']];
const avKind = k => AV_KINDS.find(x => x[0] === k) || AV_KINDS[0];
const AV_DEFIS = ['Un bisou surprise avant midi', 'Choisis la musique de la soirée', 'Envoie-moi ton plus vieux selfie', 'Un câlin de 20 secondes, chrono en main', 'Raconte-moi ton meilleur souvenir de Noël', 'Ce soir, film de Noël sous le plaid', 'Prépare-nous un chocolat chaud', 'Dis-moi trois choses que tu aimes chez moi', 'Une photo moche de nous deux, la plus moche possible', 'Appelle-moi juste pour dire bonjour', 'On décore un truc ensemble ce soir', 'Écris-moi un petit poème de quatre lignes', 'On danse sur une chanson de Noël, même ridicule', 'Choisis le resto de la semaine', 'Envoie-moi une photo de ce que tu vois là, tout de suite'];
const AV_MOTS = ['Plus que quelques jours avant Noël, et toujours aussi heureux de t\'avoir 🎄', 'Aujourd\'hui, je pense à la première fois où je t\'ai vu·e…', 'Ce que je préfère chez toi ce mois-ci : ', 'Mon souvenir préféré de cette année avec toi : ', 'Tu es mon cadeau préféré, et de loin.', 'Je t\'aime plus que les marrons chauds. Et c\'est beaucoup.', 'Une chose que je ne te dis pas assez : '];
const avYear = () => +today().slice(0, 4);
const avId = (d, u) => `${avYear()}-${pad(d)}_${u}`;
const avDoc = (d, u) => (S.cols.avent || {})[avId(d, u)];
const avDate = d => `${avYear()}-12-${pad(d)}`;
const avReady = (d, u) => { const x = avDoc(d, u); return x && !x.hidden && !x.openedAt && today() >= avDate(d); };
const avPick = l => l[Math.floor(Math.random() * l.length)];

/* ----- ouvrir une case reçue ----- */
function avShow(x, fresh) {
  const k = avKind(x.kind), from = x.by === S.me.id ? `Pour ${nameOf(x.to)}` : `De ${nameOf(x.by)}`;
  openSheet(`${k[1]} ${x.day} décembre`, c => [
    fresh && h('div', { class: 'avburst', 'aria-hidden': 'true' }, '🎁'),
    h('div', { class: 'eyebrow' }, from),
    x.kind === 'photo' && x.fileId ? h('div', { class: 'viewer' }, h('img', { src: B.fileUrl(x.fileId), alt: x.text || 'Photo' })) : null,
    x.kind === 'bon' ? h('div', { class: 'glass card coupon' }, h('div', { class: 'row' }, h('span', { class: 'emo', style: { fontSize: '24px', width: '48px', height: '48px' } }, x.emoji || '🎟️'),
      h('div', { class: 'grow' }, h('div', { class: 'tiny muted b', style: { textTransform: 'uppercase' } }, 'Bon pour'), h('div', { class: 'mid' }, x.title)))) : null,
    x.kind === 'defi' ? h('div', { class: 'tiny muted b', style: { textTransform: 'uppercase' } }, 'Défi du jour') : null,
    x.text ? h('p', { class: x.kind === 'mot' || x.kind === 'defi' ? 'mid' : '', style: { whiteSpace: 'pre-wrap' } }, x.text) : null,
    x.kind === 'bon' && x.by !== S.me.id ? h('p', { class: 'small muted' }, 'Ce bon t\'attend dans Plus → Bons, à utiliser quand tu veux.') : null,
    x.kind === 'bon' && x.by !== S.me.id ? h('button', { class: 'btn full', onclick: () => { c.close(); S.bonTab = 'recus'; go('bons'); } }, 'Voir mes bons') : null,
    h('button', { class: 'btn pri full', onclick: () => c.close() }, x.by === S.me.id ? 'Fermer' : 'Merci 💗')
  ]);
}
async function avOpen(d) {
  const o = other(), x = avDoc(d, o.id);
  if (!x || x.hidden) return toast(`Patience, cette case s'ouvre le ${d} décembre 🎄`);
  if (!x.openedAt) { await put('avent', { ...x, openedAt: Date.now() }); toast(S.demo ? `En vrai, ${o.name} sait que tu as ouvert sa case` : 'Case ouverte 🎄'); }
  avShow({ ...x, openedAt: x.openedAt || Date.now() }, !x.openedAt);
}

/* ----- préparer une case pour l'autre ----- */
function avEdit(d) {
  const me = S.me.id, o = other(), prev = avDoc(d, me);
  if (prev && prev.openedAt) return avShow(prev);
  const v = { kind: 'mot', text: '', title: '', emoji: '🎟️', fileId: null, ...(prev || {}) };
  let blob = null, preview = prev && prev.fileId ? B.fileUrl(prev.fileId) : null, busy = false;
  const label = { mot: `Ton mot pour ${o.name}`, photo: 'Une légende (facultatif)', bon: 'Un petit mot avec (facultatif)', defi: 'Le défi' };
  const save = async c => {
    if (busy) return;
    const text = (v.text || '').trim(), title = (v.title || '').trim();
    if ((v.kind === 'mot' || v.kind === 'defi') && !text) return toast(v.kind === 'mot' ? 'Écris ton mot' : 'Écris le défi');
    if (v.kind === 'bon' && !title) return toast('Écris ce que tu offres');
    if (v.kind === 'photo' && !blob && !v.fileId) return toast('Choisis une photo');
    busy = true;
    try {
      let fileId = v.kind === 'photo' ? v.fileId : null;
      if (v.kind === 'photo' && blob) { toast('Envoi de la photo…'); fileId = (await B.upload(blob, `avent-${pad(d)}.jpg`)).id; }
      await put('avent', { id: avId(d, me), year: avYear(), day: d, to: o.id, kind: v.kind, text, title: v.kind === 'bon' ? title : '', emoji: v.kind === 'bon' ? v.emoji : '', fileId });
      if (prev && prev.fileId && prev.fileId !== fileId) B.delFile(prev.fileId).catch(() => { });
      c.close(); toast(`Case du ${d} prête 🎄`);
    } catch (e) { busy = false; toast(e.message || 'Enregistrement impossible'); }
  };
  openSheet(`Case du ${d} décembre`, c => [
    h('p', { class: 'small muted' }, `${o.name} pourra l'ouvrir le ${d} décembre. D'ici là, ${o.name} voit seulement que la case est prête.`),
    h('div', { class: 'seg' }, AV_KINDS.map(([k, e, l]) => h('button', { class: v.kind === k ? 'on' : '', onclick: () => { v.kind = k; c.refresh(); } }, e + ' ' + l))),
    v.kind === 'photo' && [
      preview ? h('div', { class: 'viewer' }, h('img', { src: preview, alt: 'Ta photo' })) : null,
      h('button', { class: 'btn full', onclick: async () => { const fs = await pickFiles('image/*'); if (!fs.length) return; blob = await shrink(fs[0]); preview = URL.createObjectURL(blob); c.refresh(); } }, preview ? 'Changer la photo' : '📸 Choisir une photo')],
    v.kind === 'bon' && [
      h('div', { class: 'chips' }, BON_IDEAS.map(([e, t]) => h('button', { class: 'chip' + (v.title === t ? ' on' : ''), onclick: () => { v.emoji = e; v.title = t; c.refresh(); } }, e + ' ' + t))),
      h('div', { class: 'f' }, h('label', { htmlFor: 'av_t' }, 'Bon pour…'), h('input', { class: 'inp', id: 'av_t', maxLength: 90, placeholder: 'Ton idée', value: v.title, oninput: e => { v.title = e.target.value; v.emoji = '🎟️'; } })),
      h('p', { class: 'small faint' }, `En ouvrant la case, ${o.name} le retrouve dans ses bons.`)],
    h('div', { class: 'f' }, h('label', { htmlFor: 'av_x' }, label[v.kind]), h('textarea', { class: 'inp', id: 'av_x', maxLength: 1000, placeholder: v.kind === 'defi' ? 'Un câlin de 20 secondes…' : '', value: v.text || '', oninput: e => v.text = e.target.value })),
    (v.kind === 'mot' || v.kind === 'defi') && h('button', { class: 'btn full', onclick: () => { v.text = avPick(v.kind === 'mot' ? AV_MOTS : AV_DEFIS); c.refresh(); } }, '🎲 Une idée'),
    h('button', { class: 'btn pri full', onclick: () => save(c) }, prev ? 'Enregistrer' : 'Ranger dans la case'),
    prev && h('button', { class: 'btn danger full', onclick: async () => { if (!(await confirmSheet('Vider cette case ?', '', 'Vider', true))) return; if (prev.fileId) B.delFile(prev.fileId).catch(() => { }); await del('avent', prev.id); c.close(); } }, 'Vider la case')
  ]);
}

/* ----- la vue ----- */
VIEWS.avent = () => {
  const me = S.me.id, o = other(), t = today(), Y = avYear(), start = `${Y}-12-01`;
  const before = t < start, nDay = !before && t <= `${Y}-12-24` ? +t.slice(8) : before ? 0 : 25;
  const tab = S.avTab || (before ? 'prep' : 'recu');
  const mine = AV_ORDER.filter(d => avDoc(d, me)).length, theirs = AV_ORDER.filter(d => avDoc(d, o.id)).length;
  const ready = AV_ORDER.filter(d => avReady(d, o.id)).length;
  const daysLeft = daysBetween(t, start);
  const cell = d => {
    if (tab === 'prep') {
      const x = avDoc(d, me);
      return h('button', { class: 'avc' + (x ? ' full' : '') + (x && x.openedAt ? ' opened' : ''), 'aria-label': `Case du ${d}${x ? ', prête' : ', vide'}`, onclick: () => avEdit(d) },
        h('span', { class: 'n' }, d), h('span', { class: 'e' }, x ? (x.openedAt ? '✓' : avKind(x.kind)[1]) : '+'));
    }
    const x = avDoc(d, o.id), open = t >= avDate(d);
    const st = !open ? 'locked' : !x ? 'empty' : x.openedAt ? 'opened' : 'ready';
    return h('button', { class: 'avc ' + st, 'aria-label': `Case du ${d}`, onclick: () => st === 'locked' ? toast(x ? `${o.name} a préparé cette case. Rendez-vous le ${d} décembre 🎄` : `S'ouvre le ${d} décembre`) : st === 'empty' ? toast(`${o.name} n'a rien mis dans cette case`) : st === 'ready' ? avOpen(d) : avShow(x) },
      h('span', { class: 'n' }, d), h('span', { class: 'e' }, st === 'locked' ? (x ? '🎁' : '🔒') : st === 'empty' ? '·' : st === 'ready' ? '🎁' : avKind(x.kind)[1]));
  };
  return [
    head('Calendrier de l\'Avent', { back: 'plus', sub: `Décembre ${Y}` }),
    h('div', { class: 'seg' }, [['recu', `De ${o.name}`, ready], ['prep', `Pour ${o.name}`, 0]].map(([k, l, n]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { S.avTab = k; render(true); } }, l + (n ? ` · ${n} 🎁` : '')))),
    tab === 'recu'
      ? sec(h('div', { class: 'mid' }, before ? `S'ouvre dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''} 🎄` : nDay <= 24 ? (ready ? `${ready} case${ready > 1 ? 's' : ''} à ouvrir 🎁` : 'Rien à ouvrir pour l\'instant, reviens demain 🎄') : 'Joyeux Noël 🎅'),
        h('p', { class: 'small muted' }, before ? (theirs ? `${o.name} t'a déjà préparé ${theirs} case${theirs > 1 ? 's' : ''} sur 24 👀 Une case s'ouvre chaque jour à partir du 1er décembre.` : `${o.name} n'a pas encore rempli de case. Une case s'ouvre chaque jour à partir du 1er décembre.`) : `${theirs} case${theirs > 1 ? 's' : ''} préparée${theirs > 1 ? 's' : ''} par ${o.name}.`))
      : sec(h('div', { class: 'row between' }, h('div', { class: 'mid' }, `${mine}/24 cases prêtes`), mine === 24 ? h('span', { class: 'pill', c: 'var(--good)' }, 'Complet 🎉') : null),
        h('div', { class: 'track' }, h('i', { style: { width: (mine / 24 * 100) + '%' } })),
        h('p', { class: 'small muted' }, `Un mot, une photo, un bon ou un petit défi par case. ${o.name} ne voit rien du contenu avant le jour de la case, seulement combien sont prêtes.`)),
    h('div', { class: 'avgrid' }, AV_ORDER.map(cell)),
    tab === 'recu' && nDay > 0 && nDay <= 24 && !avDoc(nDay, me) ? h('button', { class: 'btn full', onclick: () => { S.avTab = 'prep'; avEdit(nDay); render(true); } }, `Ta case du ${nDay} pour ${o.name} est vide : la remplir`) : null
  ];
};

/* ----- carte d'accueil : le décompte fin novembre, puis la case du jour en décembre ----- */
function aventCard() {
  const t = today(), Y = avYear(), o = other();
  if (t < `${Y}-11-15` || t > `${Y}-12-24`) return null;
  if (t < `${Y}-12-01`) {
    const n = AV_ORDER.filter(d => avDoc(d, S.me.id)).length, left = daysBetween(t, `${Y}-12-01`);
    if (n === 24) return null;
    return h('button', { class: 'glass card tap', onclick: () => { S.avTab = 'prep'; go('avent'); } }, eyebrow('Calendrier de l\'Avent', h('span', { class: 'pill', c: 'var(--good)' }, `J-${left}`)),
      h('p', { class: 'mid' }, `🎄 ${n}/24 cases prêtes pour ${o.name}`), h('p', { class: 'small muted' }, 'Prépare ses surprises : une case s\'ouvre chaque jour à partir du 1er décembre.'));
  }
  const d = +t.slice(8), ready = avReady(d, o.id);
  return h('button', { class: 'glass card tap', onclick: () => { S.avTab = 'recu'; if (ready) avOpen(d); go('avent'); } }, eyebrow('Calendrier de l\'Avent', ready ? h('span', { class: 'pill', c: 'var(--u1)' }, 'À ouvrir') : null),
    h('p', { class: 'mid' }, ready ? `🎁 Ta case du ${d} décembre t'attend` : `🎄 Case du ${d} décembre`), h('p', { class: 'small muted' }, ready ? `${o.name} te l'a préparée.` : 'Retrouve toutes les cases déjà ouvertes.'));
}
