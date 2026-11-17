'use strict';
/* Nous — administration : inviter des couples, réinitialiser un mot de passe, supprimer un espace. Aucun accès au contenu. */
async function loadAdmin() {
  if (loadAdmin.busy) return; loadAdmin.busy = true;
  try { S.admin = await api('GET', '/api/admin'); } catch (e) { S.admin = { error: e.message }; }
  loadAdmin.busy = false; if (S.view === 'admin') render(true);
}
const inviteLink = code => `${location.origin}/?invitation=${code}`;
function showLinkSheet(title, link, text) {
  openSheet(title, () => [
    h('p', { class: 'small muted' }, text),
    h('input', { class: 'inp', id: 'adm_link', value: link, 'aria-label': 'Lien', onfocus: e => e.target.select(), oninput: e => { e.target.value = link; } }),
    h('button', { class: 'btn pri full', onclick: () => copyTo(link, $('#adm_link')) }, 'Copier'),
    navigator.share ? h('button', { class: 'btn full', onclick: () => navigator.share({ title: 'Nous', text: 'Votre invitation pour Nous, l\'app à deux 💗', url: link }).catch(() => { }) }, 'Envoyer…') : null
  ]);
}
VIEWS.admin = () => {
  if (!S.me.admin) return [head('Administration', { back: 'reglages' }), sec(h('div', { class: 'empty' }, 'Réservé à l\'administration.'))];
  const A = S.admin; if (!A) { loadAdmin(); return [head('Administration', { back: 'reglages' }), sec(h('div', { class: 'empty' }, 'Chargement…'))]; }
  if (A.error) return [head('Administration', { back: 'reglages' }), sec(h('p', { class: 'bad' }, A.error), h('button', { class: 'btn full', onclick: () => { S.admin = null; render(true); } }, 'Réessayer'))];
  const invite = () => formSheet({
    title: 'Inviter un couple', submit: 'Créer le lien', fields: [{ k: 'note', label: 'Pour qui (pour t\'en souvenir)', ph: 'Léa et Tom', required: true }],
    onSubmit: async v => { const r = await api('POST', '/api/admin/invite', { note: v.note }); S.admin = null; loadAdmin(); setTimeout(() => showLinkSheet('Invitation prête', inviteLink(r.code), `Envoie ce lien à l'une des deux personnes. Valable ${r.days} jours, une seule fois. Tu ne pourras plus l'afficher ensuite.`), 380); }
  });
  const act = async (fn, ok) => { try { const r = await fn(); S.admin = null; loadAdmin(); if (ok) ok(r); } catch (e) { toast(e.message); } };
  const total = A.couples.reduce((s, c) => s + c.bytes, 0);
  return [
    head('Administration', { back: 'reglages', add: invite, addLabel: 'Inviter un couple' }),
    sec(h('div', { class: 'row', style: { justifyContent: 'space-around' } },
      h('div', { class: 'center' }, h('div', { class: 'big num' }, A.couples.length), h('div', { class: 'tiny muted' }, 'espaces')),
      h('div', { class: 'center' }, h('div', { class: 'big num' }, A.couples.reduce((s, c) => s + c.users.length, 0)), h('div', { class: 'tiny muted' }, 'comptes')),
      h('div', { class: 'center' }, h('div', { class: 'big num' }, size(total)), h('div', { class: 'tiny muted' }, 'de fichiers')))),
    h('button', { class: 'btn pri full', onclick: invite }, 'Inviter un couple'),
    h('p', { class: 'small faint center' }, (A.backupAt ? `Dernière sauvegarde automatique : ${fmtT(A.backupAt)}` : 'Pas encore de sauvegarde automatique (elle se fait chaque nuit vers 4 h)') + (A.mail ? ' · e-mails activés' : ' · e-mails non configurés')),
    sec(eyebrow('Notification à tout le monde'),
      h('p', { class: 'small muted' }, 'Envoyée sur le téléphone de tous les comptes, tous espaces confondus, s\'ils ont activé les notifications.'),
      h('button', { class: 'btn full', onclick: () => formSheet({
        title: 'Notification générale', submit: 'Continuer', values: { title: 'Nous' },
        fields: [{ k: 'title', label: 'Titre', required: true }, { k: 'body', label: 'Message', type: 'textarea', ph: 'Nouvelle mise à jour : …', required: true, hint: '300 caractères maximum.' }],
        onSubmit: async v => {
          const nb = A.couples.reduce((s, c) => s + c.users.length, 0);
          if (!(await confirmSheet(`Envoyer à ${nb} compte${nb > 1 ? 's' : ''} ?`, `« ${v.title} » : ${v.body}`, 'Envoyer'))) return false;
          const r = await api('POST', '/api/admin/broadcast', v);
          toast(r.devices ? `Envoyée sur ${r.devices} appareil${r.devices > 1 ? 's' : ''} (${r.reached} compte${r.reached > 1 ? 's' : ''} sur ${r.users})` : 'Personne n\'a encore activé les notifications');
        }
      }) }, '📣 Envoyer une notification')),
    A.invites.length ? sec(eyebrow('Invitations en attente'), h('div', { class: 'list' }, A.invites.map(i => h('div', { class: 'item' }, h('span', { class: 'emo' }, '✉️'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, i.note || 'Sans nom'), h('div', { class: 'small muted' }, `Expire ${rel(iso(new Date(i.expires)))}`)),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmSheet('Annuler cette invitation ?', 'Le lien ne fonctionnera plus.', 'Annuler l\'invitation', true)) act(() => api('DELETE', '/api/admin/invite/' + i.id)); } }, 'Annuler'))))) : null,
    sec(eyebrow('Espaces'), h('div', { class: 'list' }, A.couples.map(c => h('div', { class: 'item', style: { alignItems: 'flex-start', flexDirection: 'column', gap: '8px' } },
      h('div', { class: 'row', style: { width: '100%' } }, h('span', { class: 'emo' }, c.mine ? '🏠' : '💑'), h('div', { class: 'grow' }, h('div', { class: 'b ell' }, c.users.map(u => u.name).join(' & ') || 'Espace vide', c.mine ? ' (vous)' : ''), h('div', { class: 'small muted' }, `Créé le ${fmtD(iso(new Date(c.created)), { day: 'numeric', month: 'short', year: 'numeric' })} · actif ${rel(iso(new Date(c.lastSeen)))} · ${c.items} éléments · ${size(c.bytes)}`), c.users.length < 2 ? h('div', { class: 'small warnc' }, 'En attente du ou de la partenaire') : null)),
      h('div', { class: 'chips' },
        c.users.map(u => h('button', { class: 'chip', onclick: async () => { if (await confirmSheet(`Nouveau mot de passe pour ${u.name} ?`, `L'ancien ne marchera plus et ${u.name} sera déconnecté de ses appareils.`, 'Réinitialiser', true)) act(() => api('POST', '/api/admin/reset', { user: u.id }), r => showLinkSheet(`Mot de passe de ${u.name}`, r.password, `Identifiant : ${u.id}. Transmets ce mot de passe provisoire, à changer dans Réglages dès la connexion.`)); } }, '🔑 ' + u.name)),
        !c.mine ? h('button', { class: 'chip', style: { color: 'var(--bad)' }, onclick: async () => { if (await confirmSheet('Supprimer cet espace ?', `Tout ce que ${c.users.map(u => u.name).join(' et ') || 'cet espace'} y a mis (agenda, comptes, photos, documents) sera effacé définitivement, ainsi que leurs comptes.`, 'Tout supprimer', true)) act(() => api('POST', '/api/admin/delete-couple', { couple: c.id }), () => toast('Espace supprimé')); } }, '🗑️ Supprimer') : null))))),
    h('p', { class: 'small faint center' }, 'L\'administration ne donne accès à aucun contenu des espaces : seulement les prénoms, la date de création et la place occupée.')
  ];
};
