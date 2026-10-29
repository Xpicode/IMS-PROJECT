#!/bin/bash
# Restore one backup into an EMPTY database and documents folder (spec §15.7, A26).
#
#   restore.sh /backups/daily/ims-20261029-023000.tar.age /keys/age-identity.txt
#
# The age identity (private key) is brought in only for the restore; it is
# never stored on the server. Refuses to overwrite a database that has users.
set -euo pipefail
FILE="${1:?backup file}"
KEY="${2:?age identity file (private key)}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

age -d -i "$KEY" "$FILE" | tar -C "$WORK" -xf -
echo "--- manifest of the backup ---"; cat "$WORK/manifest.txt"

if [ "$(psql -Atc "SELECT to_regclass('public.users') IS NOT NULL")" = t ] && [ "$(psql -Atc 'SELECT EXISTS (SELECT 1 FROM users)')" = t ]; then
  if [ "${FORCE_RESTORE:-}" != "yes" ]; then
    echo "Refusing: the target database already has users. Restore into a new, empty database (or set FORCE_RESTORE=yes)." >&2
    exit 1
  fi
fi
pg_restore --no-owner --no-privileges --clean --if-exists --exit-on-error -d "$PGDATABASE" "$WORK/db.dump"

if [ -f "$WORK/documents.tar.gz" ]; then
  mkdir -p /documents && tar -C /documents -xzf "$WORK/documents.tar.gz"
fi

echo "--- check: rows now in the restored database ---"
ok=1
while IFS='=' read -r k v; do
  case "$k" in rows.*)
    t="${k#rows.}"; now="$(psql -Atc "SELECT count(*) FROM $t")"
    if [ "$v" = "$now" ]; then res=OK; else res=DIFFERENT; ok=0; fi
    printf '%-22s backup=%-8s restored=%-8s %s\n' "$t" "$v" "$now" "$res"
  esac
done < "$WORK/manifest.txt"
ledger="$(psql -Atc "SELECT NOT EXISTS (SELECT 1 FROM stock_balances b LEFT JOIN (SELECT item_id, location_id, SUM(quantity) q FROM stock_movements GROUP BY 1,2) m USING (item_id, location_id) WHERE b.quantity <> COALESCE(m.q, 0))")"
echo "ledger matches balances: $ledger"
[ "$ok" = 1 ] && [ "$ledger" = t ] && echo "RESTORE OK" || { echo "RESTORE CHECK FAILED" >&2; exit 1; }
