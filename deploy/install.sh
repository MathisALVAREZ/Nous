#!/usr/bin/env bash
# Installe Nous sur le VPS : conteneur Docker + Nginx + certificat HTTPS.
# À lancer depuis le dossier du projet :  bash deploy/install.sh
set -euo pipefail
DOMAIN="morgane.kratox.fr"
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  p1=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
  p2=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
  cat > .env <<ENV
INIT_USERS=mathis:Mathis:${p1};morgane:Morgane:${p2}
VAPID_SUBJECT=mailto:contact@kratox.fr
ENV
  chmod 600 .env
  echo "Comptes créés (à noter, puis à changer dans Réglages) :"
  echo "  mathis  / ${p1}"
  echo "  morgane / ${p2}"
fi

mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build

if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "Demande du certificat HTTPS pour ${DOMAIN} (le DNS doit déjà pointer vers ce serveur)…"
  sudo certbot certonly --nginx -d "${DOMAIN}"
fi
sudo cp deploy/${DOMAIN}.conf /etc/nginx/sites-available/${DOMAIN}
sudo ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}
sudo nginx -t && sudo systemctl reload nginx
echo "C'est en ligne : https://${DOMAIN}"
