#!/usr/bin/env bash
# Sauvegarde quotidienne : base + fichiers, 14 jours conservés.
# Cron :  15 4 * * * /chemin/vers/nous/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
docker exec nous node -e "require('better-sqlite3')('/data/nous.db').backup('/data/nous-backup.db').then(()=>process.exit(0))"
tar -czf "backups/nous-$(date +%F).tar.gz" -C data nous-backup.db files
find backups -name 'nous-*.tar.gz' -mtime +14 -delete
