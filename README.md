# Nous

L'app à deux : agenda et villes, comptes partagés, recherche d'appart, petits mots avec notifications,
question du jour, photos, documents, listes, envies, comptes à rebours, roue, humeur du jour,
notre histoire, bons à offrir et mots programmés.

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

Sauvegarde : ajouter `deploy/backup.sh` au cron (voir l'en-tête du script).
Mise à jour : remplacer les fichiers puis `docker compose up -d --build`.

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
