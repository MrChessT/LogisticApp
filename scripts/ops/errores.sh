#!/usr/bin/env bash
# Errores registrados por la aplicación en producción (tabla app_errors, migración 0043). Solo lee.
#
#   bash scripts/ops/errores.sh        → últimos 7 días
#   bash scripts/ops/errores.sh 30     → últimos 30 días
#
# No guarda ninguna clave: el token de Supabase lo añade el proxy de la sesión (o SUPABASE_ACCESS_TOKEN).
set -euo pipefail

PROJECT_REF="yehawojsrxsjhzfivpfi"
days="${1:-7}"
if ! [[ "$days" =~ ^[0-9]{1,3}$ ]]; then
  echo "Uso: bash scripts/ops/errores.sh [días]" >&2
  exit 2
fi

query="select to_char(last_seen at time zone 'Europe/Madrid', 'DD/MM HH24:MI') as ultima, source as origen, count as veces, coalesce(path, '') as ruta, left(message, 160) as mensaje from app_errors where day >= current_date - ${days} order by last_seen desc limit 60"

curl -sS -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" \
  -H "Content-Type: application/json" \
  --data-binary "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1], "read_only": True}))' "$query")" |
  python3 -c '
import json, sys
rows = json.load(sys.stdin)
if not isinstance(rows, list):
    print("✗ No se pudo leer:", str(rows)[:300]); sys.exit(1)
if not rows:
    print("Sin errores registrados en el periodo."); sys.exit(0)
for r in rows:
    print(f"{r[\"ultima\"]}  {r[\"origen\"]:<9} ×{r[\"veces\"]:<4} {r[\"ruta\"][:40]:<40} {r[\"mensaje\"]}")
print(f"\n{len(rows)} errores distintos.")
'
