#!/usr/bin/env bash
# Aplica UNA migración del repositorio a la base de datos de producción de LogisticApp, en una sola
# transacción (o entra entera o no entra nada), y recarga el esquema de la API.
#
#   bash scripts/ops/aplicar-migracion.sh supabase/migrations/0031_importacion_catalogo.sql
#
# · Solo acepta ficheros de supabase/migrations/ (nada de SQL suelto).
# · No guarda ninguna clave: el token de Supabase lo añade el proxy de la sesión (o SUPABASE_ACCESS_TOKEN).
# · Es lo único que autoriza la regla de .claude/settings.json.
set -euo pipefail

PROJECT_REF="yehawojsrxsjhzfivpfi"
file="${1:-}"

if [[ -z "$file" ]]; then
  echo "Uso: bash scripts/ops/aplicar-migracion.sh supabase/migrations/NNNN_nombre.sql" >&2
  exit 2
fi
case "$file" in
  supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql) ;;
  *) echo "✗ Solo se aplican ficheros de supabase/migrations/ (NNNN_nombre.sql)." >&2; exit 2 ;;
esac
if [[ ! -f "$file" ]]; then
  echo "✗ No existe $file" >&2
  exit 2
fi

body="$(python3 -c '
import json, sys
sql = open(sys.argv[1], encoding="utf-8").read()
print(json.dumps({"query": "begin;\n" + sql + "\nnotify pgrst, '\''reload schema'\'';\ncommit;"}))
' "$file")"

response="$(curl -sS -w '\n%{http_code}' -X POST \
  "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" \
  -H "Content-Type: application/json" \
  --data-binary "$body")"
status="${response##*$'\n'}"
payload="${response%$'\n'*}"

if [[ "$status" == "201" || "$status" == "200" ]]; then
  echo "✓ Aplicada $(basename "$file")"
else
  echo "✗ $(basename "$file") NO se aplicó (HTTP $status). No ha cambiado nada:" >&2
  echo "$payload" | head -c 1500 >&2
  echo >&2
  exit 1
fi
