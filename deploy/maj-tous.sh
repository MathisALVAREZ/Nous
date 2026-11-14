#!/usr/bin/env bash
# Met à jour ta copie depuis GitHub, puis toutes les copies des autres couples.
# Usage, depuis ta copie principale :  bash deploy/maj-tous.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"; BASE="$(dirname "$SRC")"
git -C "$SRC" pull --ff-only
for d in "$SRC" "$BASE"/nous-*/; do
  d="${d%/}"; [ -f "$d/docker-compose.yml" ] && [ -f "$d/.env" ] || continue
  echo "== $(basename "$d")"
  [ "$d" = "$SRC" ] || git -C "$d" pull -q --ff-only "$SRC" main
  (cd "$d" && docker compose up -d --build --quiet-pull >/dev/null && docker logs "$(grep -E '^INSTANCE=' .env | cut -d= -f2- || echo nous)" --tail 1 2>&1 | tail -1)
done
