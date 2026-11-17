# Nous

L'app à deux : agenda et villes, comptes partagés, recherche d'appart, petits mots avec notifications,
question du jour, photos, documents, listes, envies, comptes à rebours, roue, humeur du jour,
notre histoire, bons à offrir, mots programmés, « je pense à toi », menu de la semaine, tâches, cagnottes, trajets, infos pratiques,
tribunal, défi de la semaine, quiz, capsules, trophées, bilan du mois, playlist, instant du jour (photo façon BeReal, visible seulement après avoir posté la sienne), compteurs personnels (privés, partagés ou à deux) et suivi du cycle (privé, partagé seulement si la personne l'active).

## Mise en ligne sur le VPS (morgane.kratox.fr)

1. Créer l'enregistrement DNS `morgane.kratox.fr` (type A) vers l'adresse du VPS.
2. Copier ce dossier sur le VPS, par exemple dans `~/nous`.
3. Lancer `bash deploy/install.sh`. Le script :
   - crée `.env` avec deux mots de passe aléatoires et les affiche,
   - construit et démarre le conteneur (port local 3080, non exposé à Internet),
   - demande le certificat HTTPS avec certbot et active la configuration Nginx.
4. Ouvrir https://morgane.kratox.fr sur chaque téléphone, se connecter, puis :
   - Android : menu ⋮ de Chrome → « Installer l'application »,
   - iPhone : Partager → « Sur l'écran d'accueil »,
   - dans l'app : Plus → Réglages → Notifications → « Activer », et changer le mot de passe.

**VPS avec Traefik** (cas du VPS actuel) : après l'étape 3, ignorer l'erreur certbot et lancer `bash deploy/traefik.sh`.
Le script reprend le réseau, le point d'entrée et le résolveur de certificats d'un service déjà en place,
puis branche Nous dessus. La configuration Nginx de `deploy/` ne sert alors pas.

## Inviter d'autres couples

Une seule app, une seule base : chaque couple a son espace, totalement séparé des autres. L'inscription n'est possible
qu'avec un lien d'invitation.

1. Plus → ⚙️ Réglages → **Administration** → « Inviter un couple ». Le lien est valable 14 jours, une seule fois.
2. La personne qui l'ouvre crée son compte, puis reçoit un lien à envoyer à son ou sa partenaire (valable 7 jours).
3. Dès que les deux comptes existent, l'app s'ouvre pour eux.

L'administration (réservée à la variable `ADMIN` du `.env`, sinon à la première personne du premier couple) liste
les espaces, la place occupée, permet de réinitialiser un mot de passe ou de supprimer un espace. Elle ne donne
accès à aucun contenu. Espace disque par couple : `QUOTA_MB` (2048 par défaut).

La mise à jour depuis une version précédente migre automatiquement les données existantes dans le premier espace.

## Une copie séparée pour un autre couple (ancienne méthode)

Chaque couple a sa propre copie : son adresse, ses deux comptes, sa base de données. Depuis ta copie principale :

    bash deploy/nouveau-couple.sh lea-tom lea:Léa tom:Tom lea-tom.kratox.fr "Lyon,Paris"

Arguments : un nom court, les deux comptes `identifiant:Prénom`, l'adresse (par défaut `<nom>.kratox.fr`) et les
villes proposées dans l'agenda (six au plus). Le DNS de l'adresse doit pointer vers le VPS avant. Le script crée
le dossier `../nous-lea-tom`, branche la copie sur Traefik et affiche les identifiants à transmettre.

Mettre à jour toutes les copies d'un coup : `bash deploy/maj-tous.sh`.

Sauvegarde : ajouter `deploy/backup.sh` au cron (voir l'en-tête du script).
Mise à jour : remplacer les fichiers puis `docker compose up -d --build`.

## Mises à jour : la fenêtre « Quoi de neuf »

Chaque mise à jour visible par les utilisateurs ajoute une entrée en tête de `public/news.js` (id unique, date, titre,
quelques puces). La fenêtre s'ouvre une fois par compte après la mise à jour, puis reste accessible dans Réglages →
Nouveautés. Les fonctions d'administration n'y figurent jamais.

L'administrateur peut aussi envoyer une notification à tous les comptes : Administration → Notification à tout le monde.

## Sécurité

- Deux comptes seulement, créés au premier démarrage ; aucune inscription possible.
- Mots de passe hachés en Argon2id ; 5 échecs de connexion bloquent 15 minutes.
- Session par cookie `HttpOnly`, `Secure`, `SameSite=Lax` ; en-tête obligatoire sur les écritures (anti-CSRF).
- Politique CSP stricte, aucun script tiers, fichiers servis uniquement aux deux comptes.
- Le conteneur tourne sans privilèges, en lecture seule, et n'écoute que sur 127.0.0.1.

## Organisation

- `server.js` : API, sessions, fichiers, notifications push, rappels de 9 h.
- `public/` : l'application (aucune étape de compilation).
- `tools/build-demo.js` : assemble la version de démonstration en un seul fichier (`dist/index.html`).
- `data/` : base SQLite et fichiers envoyés (créé au premier démarrage, à sauvegarder).

## Essai en local

    npm install
    COOKIE_SECURE=0 INIT_USERS="mathis:Mathis:motdepasse1;morgane:Morgane:motdepasse2" node server.js
    # puis http://localhost:3000
