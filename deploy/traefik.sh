#!/usr/bin/env bash
# Branche Nous sur le Traefik déjà en place sur le VPS (HTTPS automatique).
# À lancer depuis le dossier du projet :  bash deploy/traefik.sh
# Les réglages (réseau, point d'entrée, résolveur de certificats) sont repris d'un service qui marche déjà.
set -euo pipefail
DOMAIN="${DOMAIN:-morgane.kratox.fr}"
REF="${REF:-}"            # conteneur modèle ; détecté automatiquement si vide
cd "$(dirname "$0")/.."

labels_of() { docker inspect "$1" --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' 2>/dev/null | grep -i '^traefik\.' || true; }
if [ -z "$REF" ]; then
  for c in $(docker ps --format '{{.Names}}'); do
    [ "$c" = "nous" ] && continue
    if labels_of "$c" | grep -qi 'tls\.certresolver='; then REF="$c"; break; fi
  done
fi
L=""; [ -n "$REF" ] && L="$(labels_of "$REF")"
pick() { echo "$L" | grep -i -m1 "$1" | cut -d= -f2- || true; }

ENTRY="${ENTRY:-$(pick '\.entrypoints=')}";        ENTRY="${ENTRY:-websecure}"
RESOLVER="${RESOLVER:-$(pick 'tls\.certresolver=')}"; RESOLVER="${RESOLVER:-letsencrypt}"
NET="${NET:-$(pick '^traefik\.docker\.network=')}"
if [ -z "$NET" ]; then   # sinon : premier réseau commun entre Traefik et le conteneur modèle
  tn="$(docker inspect traefik --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}')"
  if [ -n "$REF" ]; then
    rn="$(docker inspect "$REF" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}')"
    NET="$(comm -12 <(echo "$tn" | sort) <(echo "$rn" | sort) | grep -v '^$' | head -1)"
  fi
  NET="${NET:-$(echo "$tn" | grep -v '^$' | head -1)}"
fi

echo "Modèle : ${REF:-aucun (valeurs par défaut)}"
echo "Réseau : $NET · point d'entrée : $ENTRY · certificats : $RESOLVER · domaine : $DOMAIN"

cat > docker-compose.override.yml <<YML
# Généré par deploy/traefik.sh — ne pas modifier à la main, relancer le script.
services:
  nous:
    networks: [proxy]
    labels:
      - traefik.enable=true
      - traefik.docker.network=${NET}
      - traefik.http.routers.nous.rule=Host(\`${DOMAIN}\`)
      - traefik.http.routers.nous.entrypoints=${ENTRY}
      - traefik.http.routers.nous.tls=true
      - traefik.http.routers.nous.tls.certresolver=${RESOLVER}
      - traefik.http.services.nous.loadbalancer.server.port=3000
networks:
  proxy:
    name: ${NET}
    external: true
YML

if [ ! -f .env ]; then echo "Fichier .env absent : lance d'abord bash deploy/install.sh"; exit 1; fi
docker compose up -d --build
echo "Attente du certificat…"; sleep 12
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://${DOMAIN}/manifest.webmanifest" || true)"
if [ "$code" = "200" ]; then echo "C'est en ligne : https://${DOMAIN}"
else echo "Pas encore de réponse correcte (code ${code:-aucun}). Vérifie le DNS de ${DOMAIN}, puis : docker logs traefik --tail 30"; fi
