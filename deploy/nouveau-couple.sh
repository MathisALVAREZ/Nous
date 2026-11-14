#!/usr/bin/env bash
# Crée une copie indépendante de Nous pour un autre couple : son adresse, ses deux comptes, sa base.
# Usage :  bash deploy/nouveau-couple.sh <nom> <identifiant1:Prénom1> <identifiant2:Prénom2> [domaine] [villes]
# Exemple : bash deploy/nouveau-couple.sh lea-tom lea:Léa tom:Tom lea-tom.kratox.fr "Lyon,Paris"
set -euo pipefail
[ $# -ge 3 ] || { sed -n '2,4p' "$0"; exit 1; }
SLUG="$1"; U1="$2"; U2="$3"; DOMAIN="${4:-$SLUG.kratox.fr}"; CITIES="${5:-Paris}"
[[ "$SLUG" =~ ^[a-z0-9-]{2,30}$ ]] || { echo "Nom invalide : minuscules, chiffres et tirets uniquement."; exit 1; }
for u in "$U1" "$U2"; do [[ "$u" =~ ^[a-z0-9._-]{2,30}:[^:\;]{1,30}$ ]] || { echo "Compte invalide « $u » : attendu identifiant:Prénom (identifiant en minuscules sans accent)."; exit 1; }; done
[ "${U1%%:*}" != "${U2%%:*}" ] || { echo "Les deux identifiants doivent être différents."; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"; BASE="$(dirname "$SRC")"; DIR="$BASE/nous-$SLUG"
[ ! -e "$DIR" ] || { echo "Le dossier $DIR existe déjà."; exit 1; }
if ! getent hosts "$DOMAIN" >/dev/null; then echo "Attention : $DOMAIN ne pointe vers aucune adresse. Crée l'enregistrement DNS (type A vers ce VPS), sinon le certificat HTTPS échouera."; read -r -p "Continuer quand même ? [o/N] " r; [ "$r" = "o" ] || exit 1; fi

# Premier port local libre à partir de 3081
PORT=3081
while grep -qs "^PORT_LOCAL=$PORT$" "$BASE"/nous*/.env || ss -ltn 2>/dev/null | grep -q ":$PORT "; do PORT=$((PORT+1)); done

git clone -q "$SRC" "$DIR"     # les mises à jour viendront de ta copie principale (deploy/maj-tous.sh)
p1=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14); p2=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)
cat > "$DIR/.env" <<ENV
INSTANCE=nous-${SLUG}
DOMAIN=${DOMAIN}
PORT_LOCAL=${PORT}
NOUS_CITIES=${CITIES}
INIT_USERS=${U1%%:*}:${U1#*:}:${p1};${U2%%:*}:${U2#*:}:${p2}
VAPID_SUBJECT=mailto:contact@kratox.fr
ENV
chmod 600 "$DIR/.env"
mkdir -p "$DIR/data" && sudo chown -R 1000:1000 "$DIR/data"
bash "$DIR/deploy/traefik.sh"

echo
echo "================ À envoyer au couple ================"
echo "Adresse : https://${DOMAIN}"
echo "  ${U1#*:} : identifiant ${U1%%:*} · mot de passe ${p1}"
echo "  ${U2#*:} : identifiant ${U2%%:*} · mot de passe ${p2}"
echo "À changer à la première connexion (Plus → ⚙️ → Changer de mot de passe)."
echo "====================================================="
