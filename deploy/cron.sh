#!/usr/bin/env bash
# Installe (une seule fois) la sauvegarde complète de chaque nuit à 4 h 15 : base + photos + documents, 14 jours gardés dans ./backups.
# En plus, l'app copie elle-même sa base chaque nuit dans data/backups.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LINE="15 4 * * * $DIR/deploy/backup.sh >> $DIR/backups/backup.log 2>&1"
mkdir -p "$DIR/backups"; chmod +x "$DIR/deploy/backup.sh"
( crontab -l 2>/dev/null | grep -vF "$DIR/deploy/backup.sh" || true; echo "$LINE" ) | crontab -
echo "Sauvegarde programmée :"; crontab -l | grep -F "$DIR/deploy/backup.sh"
echo "Premier essai…"; "$DIR/deploy/backup.sh" && ls -lh "$DIR/backups" | tail -3
