#!/bin/bash
# Runs backup.sh on a schedule (BACKUP_CRON, default 02:30 every day, in TZ).
set -euo pipefail
: "${BACKUP_CRON:=30 2 * * *}"
if [ "${1:-}" = "now" ]; then exec /usr/local/bin/backup.sh; fi
if [ "${1:-}" = "restore" ]; then shift; exec /usr/local/bin/restore.sh "$@"; fi
echo "${BACKUP_CRON} /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "[backup] scheduled: ${BACKUP_CRON} (${TZ:-UTC})"
exec crond -f -l 6
