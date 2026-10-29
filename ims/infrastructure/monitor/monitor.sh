#!/bin/bash
# IMS health check for the server (spec §15.7). Run every 10 minutes by the
# systemd timer in infrastructure/systemd/ (or cron). Prints one line per check
# and sends ONE alert listing every problem (webhook and/or email).
#
#   IMS_DIR=/opt/ims ./infrastructure/monitor/monitor.sh
#
# Settings come from $IMS_DIR/.env.production (DOMAIN, ALERT_WEBHOOK_URL,
# optional ALERT_EMAIL) plus the thresholds below.
set -uo pipefail
IMS_DIR="${IMS_DIR:-/opt/ims}"
ENV_FILE="${ENV_FILE:-$IMS_DIR/.env.production}"
set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a
DC="docker compose --project-directory $IMS_DIR --env-file $ENV_FILE"
: "${DISK_MAX_PCT:=85}" "${MEM_MIN_PCT:=10}" "${TLS_MIN_DAYS:=14}" "${BACKUP_MAX_HOURS:=26}" "${HTTP5XX_MAX:=20}" "${SYNC_BAD_MAX:=10}"
: "${PUBLIC_URL:=https://${DOMAIN}}" "${TLS_HOSTPORT:=${DOMAIN}:443}" "${CURL_OPTS:=}"
STATE_DIR="${STATE_DIR:-/var/lib/ims-monitor}"; mkdir -p "$STATE_DIR"
problems=()
check() { # name ok? detail
  if [ "$2" = ok ]; then echo "OK    $1: $3"; else echo "ALERT $1: $3"; problems+=("$1: $3"); fi
}

# Disk (root filesystem and Docker's data directory).
for mnt in / /var/lib/docker; do
  [ -d "$mnt" ] || continue
  pct=$(df -P "$mnt" | awk 'NR==2 {gsub("%","",$5); print $5}')
  [ "$pct" -lt "$DISK_MAX_PCT" ] && check "disk $mnt" ok "${pct}% used" || check "disk $mnt" bad "${pct}% used (limit ${DISK_MAX_PCT}%)"
done

# Memory available.
mem=$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} /MemFree/ {f=$2} END {if (a=="") a=f; printf "%d", a*100/t}' /proc/meminfo)
[ "$mem" -ge "$MEM_MIN_PCT" ] && check memory ok "${mem}% available" || check memory bad "only ${mem}% available"

# App + database through NGINX, as users reach it.
code=$(curl -s $CURL_OPTS -o /dev/null -m 10 -w '%{http_code}' "$PUBLIC_URL/api/health")
[ "$code" = 200 ] && check "app/db health" ok "HTTP 200" || check "app/db health" bad "$PUBLIC_URL/api/health answered HTTP $code"

# Containers not running or unhealthy.
# -a: without it, stopped containers are simply not listed and look fine.
bad=$($DC ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk '$2!="running" || ($3!="" && $3!="healthy") {print $1"("$2" "$3")"}' | xargs)
[ -z "$bad" ] && check containers ok "all running" || check containers bad "$bad"

# TLS certificate days left.
end=$(echo | openssl s_client -servername "$DOMAIN" -connect "$TLS_HOSTPORT" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$end" ]; then
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -ge "$TLS_MIN_DAYS" ] && check "TLS certificate" ok "$days days left" || check "TLS certificate" bad "expires in $days days"
else
  check "TLS certificate" bad "could not read the certificate"
fi

# Last successful backup.
last=$($DC exec -T backup cat /backups/last-success 2>/dev/null | head -1)
if [ -n "$last" ]; then
  age_h=$(( ($(date +%s) - $(date -d "$last" +%s)) / 3600 ))
  [ "$age_h" -le "$BACKUP_MAX_HOURS" ] && check backup ok "last success ${age_h}h ago" || check backup bad "last success ${age_h}h ago"
else
  check backup bad "no successful backup recorded"
fi
failed=$($DC exec -T backup sh -c 'test -f /backups/last-failure && tail -n1 /backups/last-failure' 2>/dev/null)
[ -n "$failed" ] && check "backup failure" bad "$failed"

# HTTP 5xx answers from NGINX in the last 10 minutes.
n5=$($DC logs --since 10m --no-log-prefix nginx 2>/dev/null | awk '$9 ~ /^5[0-9][0-9]$/' | wc -l)
[ "$n5" -le "$HTTP5XX_MAX" ] && check "HTTP errors" ok "$n5 server errors in 10 min" || check "HTTP errors" bad "$n5 server errors (5xx) in 10 min"

# Sync operations the server refused or that conflicted, last 24 hours.
nsync=$($DC exec -T db psql -U "${POSTGRES_USER:-ims_app}" -d "${POSTGRES_DB:-ims}" -Atc \
  "SELECT count(*) FROM sync_operations WHERE result <> 'ACKED' AND created_at > now() - interval '24 hours'" 2>/dev/null)
if [ -n "$nsync" ]; then
  [ "$nsync" -le "$SYNC_BAD_MAX" ] && check "sync problems" ok "$nsync conflicts/refusals in 24 h" || check "sync problems" bad "$nsync count submissions conflicted or were refused in 24 h"
else
  check "sync problems" bad "could not query the database"
fi

# One alert per new set of problems (don't repeat the same alert every 10 minutes; re-send hourly).
if [ ${#problems[@]} -gt 0 ]; then
  msg="IMS on ${DOMAIN}: $(printf '%s; ' "${problems[@]}")"
  # Same failing checks = same alert (numbers like "84% used" may drift between runs).
  sig=$(printf '%s\n' "${problems[@]}" | cut -d: -f1 | sha256sum | cut -c1-16)
  lastsig=$(cat "$STATE_DIR/last" 2>/dev/null); lastt=$(stat -c %Y "$STATE_DIR/last" 2>/dev/null || echo 0)
  if [ "$sig" != "$lastsig" ] || [ $(( $(date +%s) - lastt )) -ge 3600 ]; then
    echo "$sig" > "$STATE_DIR/last"
    json=$(printf '%s' "$msg" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
    [ -n "${ALERT_WEBHOOK_URL:-}" ] && curl -fsS $CURL_OPTS -m 10 -H 'content-type: application/json' -d "{\"text\":\"$json\"}" "$ALERT_WEBHOOK_URL" >/dev/null
    [ -n "${ALERT_EMAIL:-}" ] && command -v mail >/dev/null && echo "$msg" | mail -s "IMS alert: ${DOMAIN}" "$ALERT_EMAIL"
  fi
  exit 1
fi
rm -f "$STATE_DIR/last"
