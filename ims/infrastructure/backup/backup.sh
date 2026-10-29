#!/bin/bash
# One backup run. Produces /backups/daily/ims-<stamp>.tar.age (and a weekly copy
# on Sundays), prunes old ones, copies everything to the off-server remote, and
# records success/failure for monitoring.
#
# Needs: PGHOST PGUSER PGPASSWORD PGDATABASE, AGE_RECIPIENT (public key; the
# private key is kept OFF the server), optional RCLONE_REMOTE (e.g. "b2:ims-backups")
# with /config/rclone/rclone.conf, optional ALERT_WEBHOOK_URL.
set -euo pipefail
umask 077
: "${AGE_RECIPIENT:?set AGE_RECIPIENT (age public key)}"
: "${KEEP_DAILY:=14}" "${KEEP_WEEKLY:=8}"
OUT=/backups
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() {
  echo "[backup] FAILED: $1" >&2
  date -Iseconds > "$OUT/last-failure"
  echo "$1" >> "$OUT/last-failure"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -H 'content-type: application/json' \
      -d "{\"text\":\"IMS backup FAILED on $(hostname): $1\"}" "$ALERT_WEBHOOK_URL" || true
  fi
  exit 1
}

mkdir -p "$OUT/daily" "$OUT/weekly"
echo "[backup] start $STAMP"

# 1. Database (custom format: compressed, restorable table by table).
pg_dump --format=custom --no-owner --no-privileges -f "$WORK/db.dump" || fail "pg_dump"

# 2. Stored PDFs (they can also be redrawn from their snapshots, which are in the DB).
if [ -d /documents ]; then
  tar -C /documents -czf "$WORK/documents.tar.gz" . || fail "documents tar"
fi

# 3. Manifest: what was backed up, with row counts to check a restore against.
{
  echo "stamp=$STAMP"
  echo "postgres=$(psql -Atc 'SHOW server_version')"
  for t in users locations items stock_balances stock_movements stock_transactions assets borrowings asset_returns pdf_documents count_sessions audit_events; do
    echo "rows.$t=$(psql -Atc "SELECT count(*) FROM $t")"
  done
  echo "ledger_matches_balances=$(psql -Atc "SELECT NOT EXISTS (SELECT 1 FROM stock_balances b LEFT JOIN (SELECT item_id, location_id, SUM(quantity) q FROM stock_movements GROUP BY 1,2) m USING (item_id, location_id) WHERE b.quantity <> COALESCE(m.q, 0))")"
  (cd "$WORK" && sha256sum db.dump documents.tar.gz 2>/dev/null) | sed 's/^/sha256 /'
} > "$WORK/manifest.txt" || fail "manifest"

# 4. One encrypted file.
tar -C "$WORK" -cf - manifest.txt db.dump $( [ -f "$WORK/documents.tar.gz" ] && echo documents.tar.gz ) \
  | age -r "$AGE_RECIPIENT" -o "$OUT/daily/ims-$STAMP.tar.age" || fail "encrypt"
# (if/then, not `[ ] && cp`: under set -e a false test on weekdays would end the script)
if [ "$(date +%u)" = "7" ]; then cp "$OUT/daily/ims-$STAMP.tar.age" "$OUT/weekly/ims-$STAMP.tar.age"; fi

# 5. Retention: newest KEEP_DAILY daily and KEEP_WEEKLY weekly files.
# (find, not ls: ls on an empty folder fails and pipefail would end the script.
#  File names are ims-YYYYMMDD-HHMMSS, so name order is date order.)
prune() { find "$1" -maxdepth 1 -name 'ims-*.tar.age' | sort -r | tail -n +$(($2 + 1)) | xargs -r rm -f; }
prune "$OUT/daily" "$KEEP_DAILY"
prune "$OUT/weekly" "$KEEP_WEEKLY"

# 6. Off the server.
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone --config /config/rclone/rclone.conf sync "$OUT/daily" "$RCLONE_REMOTE/daily" || fail "rclone daily"
  rclone --config /config/rclone/rclone.conf sync "$OUT/weekly" "$RCLONE_REMOTE/weekly" || fail "rclone weekly"
else
  echo "[backup] WARNING: RCLONE_REMOTE not set, backup is only on this server"
fi

SIZE="$(du -h "$OUT/daily/ims-$STAMP.tar.age" | cut -f1)"
{ date -Iseconds; echo "ims-$STAMP.tar.age $SIZE"; } > "$OUT/last-success"
rm -f "$OUT/last-failure"
echo "[backup] done ims-$STAMP.tar.age ($SIZE)"
