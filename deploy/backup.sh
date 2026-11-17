#!/usr/bin/env bash
# Sauvegarde quotidienne d'une instance : base + fichiers, 14 jours conservés.
# Cron (une ligne par couple) :  15 4 * * * /chemin/vers/le/dossier/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
INSTANCE="$(grep -E '^INSTANCE=' .env 2>/dev/null | cut -d= -f2- || true)"; INSTANCE="${INSTANCE:-nous}"
mkdir -p backups
docker exec "$INSTANCE" node -e "require('better-sqlite3')('/data/nous.db').backup('/data/nous-backup.db').then(()=>process.exit(0))"
tar -czf "backups/nous-$(date +%F).tar.gz" -C data nous-backup.db files
rm -f data/nous-backup.db
find backups -name 'nous-*.tar.gz' -mtime +14 -delete
