'use strict';
/* Nous — Caca map : chaque passage sur le trône, épinglé sur une vraie carte, noté et commenté. */
const PM_TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};
const PM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
const isDark = () => { const t = D.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
const starsTxt = n => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));
const nowLocalInput = () => { const d = new Date(); return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const r6 = x => Math.round(x * 1e6) / 1e6;
const spot = p => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`; // ~100 m : même endroit
const poops = () => all('poops').filter(p => isFinite(p.lat) && isFinite(p.lng)).sort((a, b) => (b.when || '').localeCompare(a.when || '') || b.at - a.at);
const pFiltered = () => { const f = S.pmWho || 'all', per = S.pmPer || 'all', lim = per === '30' ? addDays(today(), -30) : per === 'month' ? today().slice(0, 7) + '-01' : ''; return poops().filter(p => (f === 'all' || p.by === f) && (!lim || (p.when || '').slice(0, 10) >= lim)); };

/* ----- poser un caca ----- */
function poopNow() {
  if (S.demo) { const c = S.map ? S.map.getCenter() : { lat: 48.8566, lng: 2.3522 }; toast('Démo : position fictive près du centre de la carte'); return poopSheet({ lat: c.lat + (Math.random() - .5) * .01, lng: c.lng + (Math.random() - .5) * .01, acc: 25 }); }
  if (!navigator.geolocation) { S.pmPlace = true; render(true); return toast('Localisation indisponible : touche la carte pour placer ton caca'); }
  toast('📍 Localisation en cours…');
  navigator.geolocation.getCurrentPosition(
    p => poopSheet({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
    e => { S.pmPlace = true; if (S.view === 'caca') render(true); toast(e.code === 1 ? 'Localisation refusée. Autorise-la pour l\'app dans les réglages du téléphone, ou touche la carte pour placer.' : 'Position introuvable : touche la carte pour placer ton caca.'); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 });
}
function poopSheet(pos, edit) {
  const v = edit ? { ...edit } : { rating: 0, comment: '', place: '', when: nowLocalInput() };
  openSheet(edit ? 'Modifier' : 'Nouvelle pêche 💩', c => [
    h('p', { class: 'small muted' }, edit ? (edit.manual ? 'Position placée à la main' : `Position GPS${edit.acc ? ` à ±${edit.acc} m près` : ''}`) : pos.manual ? 'Position placée à la main sur la carte' : `Position trouvée${pos.acc ? `, à ±${pos.acc} m près` : ''} 📍`),
    h('div', { class: 'f' }, h('div', { class: 'lab' }, 'Ta note'), h('div', { class: 'stars big-stars', role: 'radiogroup', 'aria-label': 'Note' }, [1, 2, 3, 4, 5].map(n => h('button', { type: 'button', class: v.rating >= n ? 'on' : '', 'aria-label': n + ' sur 5', 'aria-checked': String(v.rating === n), role: 'radio', onclick: () => { v.rating = v.rating === n ? 0 : n; c.refresh(); } }, '★'))),
      h('div', { class: 'small faint', style: { paddingLeft: '4px' } }, ['Pas noté', 'Catastrophique', 'Bof', 'Correct', 'Très bien', 'Légendaire 👑'][v.rating])),
    h('div', { class: 'f' }, h('label', { htmlFor: 'pm_c' }, 'Commentaire'), h('textarea', { class: 'inp', id: 'pm_c', maxLength: 280, placeholder: 'Propreté, papier, vue, ambiance…', value: v.comment, oninput: e => v.comment = e.target.value })),
    h('div', { class: 'f' }, h('label', { htmlFor: 'pm_p' }, 'Nom du lieu (facultatif)'), h('input', { class: 'inp', id: 'pm_p', maxLength: 60, placeholder: 'Chez tes parents, gare Montparnasse, au resto…', value: v.place, oninput: e => v.place = e.target.value })),
    h('div', { class: 'f' }, h('label', { htmlFor: 'pm_w' }, 'Quand'), h('input', { class: 'inp', id: 'pm_w', type: 'datetime-local', value: v.when, onchange: e => v.when = e.target.value || v.when })),
    h('button', { class: 'btn pri full', onclick: async () => {
      const d = edit ? { ...edit, rating: v.rating, comment: v.comment.trim(), place: v.place.trim(), when: v.when }
        : { lat: r6(pos.lat), lng: r6(pos.lng), acc: pos.acc || null, manual: !!pos.manual, rating: v.rating, comment: v.comment.trim(), place: v.place.trim(), when: v.when };
      c.close(); S.pmPlace = false; S.pmFocus = null;
      const saved = await put('poops', d);
      S.pmFocus = saved.id; if (S.view !== 'caca') go('caca'); else render(true);
      if (!edit) toast(S.demo ? `En vrai, ${other().name} est prévenu 💩` : 'Épinglé sur la carte 💩');
    } }, edit ? 'Enregistrer' : 'Poser sur la carte 💩'),
    edit && edit.by === S.me.id ? h('button', { class: 'btn danger full', onclick: async () => { if (await confirmSheet('Supprimer ce caca ?', 'Il disparaît de la carte.', 'Supprimer', true)) { c.close(); del('poops', edit.id); } } }, 'Supprimer') : null
  ]);
}

/* ----- carte ----- */
function pmPopup(p) {
  const mine = p.by === S.me.id;
  return h('div', { class: 'pmpop' },
    h('div', { class: 'row', style: { gap: '8px' } }, avatar(p.by, true), h('div', { class: 'grow' }, h('div', { class: 'b' }, nameOf(p.by)), h('div', { class: 'tiny muted' }, p.when ? `${cap(fmtD(p.when.slice(0, 10)))} à ${p.when.slice(11, 16)}` : ''))),
    h('div', { class: 'pmstars' }, starsTxt(p.rating)),
    p.place && h('div', { class: 'b small' }, '📍 ' + p.place),
    p.comment && h('div', { class: 'small', style: { whiteSpace: 'pre-wrap' } }, p.comment),
    mine && h('button', { class: 'btn sm full', style: { marginTop: '6px' }, onclick: () => { S.map.closePopup(); poopSheet(null, p); } }, 'Modifier'));
}
function mountMap() {
  const L = window.L;
  if (!L || !S.mapEl || !S.mapEl.isConnected) return;
  if (!S.map) {
    S.map = L.map(S.mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([48.8566, 2.3522], 12);
    if (!S.demo) L.tileLayer(isDark() ? PM_TILES.dark : PM_TILES.light, { subdomains: 'abcd', maxZoom: 19, attribution: PM_ATTR, crossOrigin: true }).addTo(S.map);
    else S.map.attributionControl.addAttribution('Démo : le fond de carte s\'affiche sur la version en ligne');
    L.control.zoom({ position: 'bottomright' }).addTo(S.map);
    S.pmLayer = L.layerGroup().addTo(S.map);
    S.map.on('click', e => { if (S.pmPlace) poopSheet({ lat: e.latlng.lat, lng: e.latlng.lng, acc: null, manual: true }); });
    S.pmFitted = false;
  }
  S.map.invalidateSize();
  const list = pFiltered(), sig = JSON.stringify(list.map(p => [p.id, p.lat, p.lng, p.rating, p.comment, p.place, p.when, p.by])) + S.users.map(u => u.id).join();
  // on ne redessine les épingles que si elles ont changé : une bulle ouverte reste ouverte pendant les synchronisations
  if (sig !== S.pmSig) {
    S.pmSig = sig; S.pmLayer.clearLayers(); S.pmMarkers = {};
    for (const p of list) {
    const icon = L.divIcon({ className: 'pmicon', html: `<span class="pm" style="--c:${S.users.findIndex(u => u.id === p.by) === 1 ? 'var(--u1)' : 'var(--u0)'}">💩</span>`, iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18] });
      S.pmMarkers[p.id] = L.marker([p.lat, p.lng], { icon, title: `${nameOf(p.by)} · ${starsTxt(p.rating)}`, riseOnHover: true }).bindPopup(() => pmPopup(p), { closeButton: false, maxWidth: 260 }).addTo(S.pmLayer);
    }
  }
  const ms = S.pmMarkers || {};
  if (S.pmFocus && ms[S.pmFocus]) { const p = list.find(x => x.id === S.pmFocus); S.map.setView([p.lat, p.lng], Math.max(S.map.getZoom(), 16)); ms[S.pmFocus].openPopup(); S.pmFocus = null; S.pmFitted = true; }
  else if (!S.pmFitted && list.length) { S.map.fitBounds(L.latLngBounds(list.map(p => [p.lat, p.lng])).pad(.25), { maxZoom: 15 }); S.pmFitted = true; }
}
function pmStats() {
  const ps = poops(), ym = today().slice(0, 7), t = today();
  const per = S.users.map(u => { const mine = ps.filter(p => p.by === u.id), rated = mine.filter(p => p.rating); return { u, n: mine.length, month: mine.filter(p => (p.when || '').slice(0, 7) === ym).length, today: mine.filter(p => (p.when || '').slice(0, 10) === t).length, avg: rated.length ? (rated.reduce((s, p) => s + p.rating, 0) / rated.length) : 0, spots: new Set(mine.map(spot)).size }; });
  const bySpot = {}; for (const p of ps) { const k = spot(p); (bySpot[k] = bySpot[k] || []).push(p); }
  const best = Object.values(bySpot).map(a => ({ a, avg: a.filter(p => p.rating).reduce((s, p) => s + p.rating, 0) / Math.max(1, a.filter(p => p.rating).length), n: a.length })).filter(x => x.avg > 0).sort((x, y) => y.avg - x.avg || y.n - x.n)[0];
  const fav = Object.values(bySpot).sort((x, y) => y.length - x.length)[0];
  return { per, best, fav, spots: Object.keys(bySpot).length };
}
VIEWS.caca = () => {
  if (!S.mapEl) S.mapEl = h('div', { class: 'pmap', role: 'application', 'aria-label': 'Carte des cacas' });
  setTimeout(mountMap, 0);
  const list = pFiltered(), st = pmStats(), name = p => (p.place || '').trim();
  const chip = (k, val, lab) => h('button', { class: 'chip' + ((S[k] || 'all') === val ? ' on' : ''), onclick: () => { S[k] = val; S.pmFitted = false; render(true); } }, lab);
  const maxN = Math.max(1, ...st.per.map(x => x.n));
  return [
    head('Caca map', { back: 'plus', sub: `${poops().length} pêche${poops().length > 1 ? 's' : ''} sur ${st.spots} lieu${st.spots > 1 ? 'x' : ''}` }),
    h('button', { class: 'btn pri full pmgo', onclick: poopNow }, '💩 Je viens de poser une pêche'),
    S.pmPlace ? h('div', { class: 'glass card row', style: { padding: '10px 14px' } }, h('span', { class: 'grow small b' }, '👆 Touche la carte à l\'endroit exact'), h('button', { class: 'btn sm', onclick: () => { S.pmPlace = false; render(true); } }, 'Annuler')) : null,
    S.mapEl,
    !window.L ? h('p', { class: 'small bad center' }, 'La carte n\'a pas pu se charger. Recharge la page.') : null,
    h('div', { class: 'row between wrap', style: { gap: '8px' } },
      h('div', { class: 'chips' }, chip('pmWho', 'all', 'Nous deux'), S.users.map(u => chip('pmWho', u.id, u.id === S.me.id ? 'Moi' : u.name))),
      h('div', { class: 'chips' }, chip('pmPer', 'all', 'Tout'), chip('pmPer', 'month', 'Ce mois'), chip('pmPer', '30', '30 j'))),
    !S.pmPlace ? h('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onclick: () => { S.pmPlace = true; render(true); toast('Touche la carte pour placer ton caca'); } }, '📌 Placer à la main') : null,
    sec(eyebrow('Le classement'),
      st.per.map(x => h('div', { class: 'barrow', style: { gridTemplateColumns: '26px 1fr auto' } }, avatar(x.u.id, true), h('div', null, h('div', { class: 'small' }, `${x.u.name} · ${x.month} ce mois · ${x.spots} lieu${x.spots > 1 ? 'x' : ''}${x.avg ? ` · ${x.avg.toFixed(1).replace('.', ',')} ★ de moyenne` : ''}`), h('div', { class: 'track' }, h('i', { style: { width: Math.max(3, x.n / maxN * 100) + '%' } }))), h('span', { class: 'b num' }, x.n))),
      st.best ? h('div', { class: 'small' }, `👑 Meilleur trône : ${name(st.best.a[0]) || 'un lieu sans nom'} (${st.best.avg.toFixed(1).replace('.', ',')} ★, ${st.best.n} visite${st.best.n > 1 ? 's' : ''})`) : null,
      st.fav && st.fav.length > 1 ? h('div', { class: 'small' }, `🏠 QG : ${name(st.fav[0]) || 'un lieu sans nom'} (${st.fav.length} fois)`) : null,
      st.per.some(x => x.today) ? h('div', { class: 'small muted' }, 'Aujourd\'hui : ' + st.per.map(x => `${x.u.name} ${x.today}`).join(' · ')) : null),
    sec(eyebrow('Dernières pêches'), list.length ? h('div', { class: 'list' }, list.slice(0, 20).map(p => h('button', { class: 'item', onclick: () => { S.pmFocus = p.id; mountMap(); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
      h('span', { class: 'emo' }, '💩'),
      h('div', { class: 'grow' }, h('div', { class: 'b ell' }, (name(p) || 'Lieu sans nom') + ' ', h('span', { class: 'pmstars small' }, starsTxt(p.rating))), h('div', { class: 'small muted ell' }, [nameOf(p.by), p.when ? `${fmtD(p.when.slice(0, 10))} ${p.when.slice(11, 16)}` : '', p.comment].filter(Boolean).join(' · '))),
      avatar(p.by, true)))) : h('div', { class: 'empty' }, 'Aucune pêche pour l\'instant. Le bouton en haut récupère ta position.')),
    h('p', { class: 'small faint center' }, 'Les positions ne sont visibles que par vous deux.')
  ];
};
