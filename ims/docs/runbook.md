# IMS runbook — deploy, back up, restore, monitor

For whoever runs the server. Every command runs on the server as the deploy user, in `/opt/ims` (a clone of the repository's `ims/` folder), unless it says otherwise. The production stack is `compose.yaml`: **nginx** (HTTPS, the only container with ports), **web** (the app), **db** (PostgreSQL 17, never published), **certbot** (certificate renewal), **backup** (nightly encrypted backups), plus a one-off **migrate**.

All `docker compose` commands below assume this alias:

```bash
alias dc='docker compose --env-file /opt/ims/.env.production'
```

---

## 1. Server (once)

**Size:** at least 2 vCPU / 4 GB RAM, 8 GB preferred (§15). 40 GB disk or more. Ubuntu 24.04 LTS.

**Hardening checklist (§15.6).** Tick each one before go-live:

- [ ] Non-root deploy user with sudo; SSH **keys only** (`PasswordAuthentication no`, `PermitRootLogin no` in `/etc/ssh/sshd_config`).
- [ ] Firewall: `ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable`. Docker publishes only NGINX's 80/443. **Never publish 5432.**
- [ ] `unattended-upgrades` on for security updates; reboot window agreed.
- [ ] `fail2ban` for SSH.
- [ ] Time zone UTC on the host (`timedatectl set-timezone UTC`); the app shows company time from `COMPANY_TIMEZONE`.
- [ ] Docker Engine + compose plugin from Docker's apt repository; deploy user in the `docker` group.
- [ ] DNS: an A record for the domain pointing at the server.
- [ ] Provider snapshots/backups on (an extra layer, not a replacement for §4).

## 2. First deploy

```bash
sudo mkdir -p /opt/ims && sudo chown $USER /opt/ims
git clone https://github.com/Xpicode/IMS.git /tmp/ims-src && cp -r /tmp/ims-src/ims/. /opt/ims/ && cd /opt/ims

cp .env.production.example .env.production && chmod 600 .env.production
# Fill in DOMAIN, COMPANY_*, and generate secrets:
openssl rand -base64 32   # → POSTGRES_PASSWORD
openssl rand -base64 32   # → AUTH_SECRET
```

**Backup key pair (once, NOT on the server):** on an admin's own computer run `age-keygen -o ims-backup-key.txt`. Put the **public** key (`age1…`) in `BACKUP_AGE_RECIPIENT`. Store the private key file in the company password manager **and** on paper in a safe. Without it the backups can't be opened, and it must never be stored on the server.

**Off-server copies:** create a bucket (Backblaze B2, S3, Google Drive, …), run `rclone config` once to make `infrastructure/backup/rclone/rclone.conf`, and set `BACKUP_RCLONE_REMOTE=<remote>:<bucket>`.

**First certificate.** NGINX can't start without one, so get it with certbot standalone while nothing listens on port 80:

```bash
dc run --rm -p 80:80 --entrypoint certbot certbot certonly --standalone \
  -d "$(grep ^DOMAIN= .env.production | cut -d= -f2)" --email it@company.example --agree-tos --no-eff-email
```

**Build, migrate, create the first admin, start:**

```bash
dc build
dc up -d db
dc run --rm migrate                       # applies all migrations to the empty database
dc run --rm -e ADMIN_EMAIL=you@company.example -e ADMIN_NAME="Your Name" \
   -e ADMIN_PASSWORD="$(read -rsp 'Admin password: ' p; echo "$p")" migrate npx tsx scripts/create-admin.ts
dc up -d
dc ps                                     # all running; web and db "healthy"
```

The demo seed is **never** run in production. Sign in, then create locations, users and items (or import CSV).

**Monitoring timer:**

```bash
sudo cp infrastructure/systemd/ims-monitor.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ims-monitor.timer
sudo /opt/ims/infrastructure/monitor/monitor.sh    # run once now; every line should say OK
```

## 3. After every deploy

```bash
curl -fsS https://$DOMAIN/api/health                          # {"status":"ok","db":"ok",...}
curl -sI http://$DOMAIN/login | head -1                        # 301 to https
curl -sI https://$DOMAIN/login | grep -iE 'strict-transport|content-security|x-frame'
dc logs --since 10m web | grep -iE 'error|unhandled' || echo "no errors"
```

Then sign in, open the dashboard, and download one recent PDF.

## 4. Backups

- Run nightly at `BACKUP_CRON` (default 02:30 company time) in the `backup` container. Each run makes one encrypted file `ims-YYYYMMDD-HHMMSS.tar.age` containing the database (`pg_dump` custom format), the PDF folder, and a manifest with row counts and a ledger check.
- Kept: 14 daily and 8 weekly (Sunday) copies, then synced off the server with rclone.
- `/backups/last-success` and `/backups/last-failure` drive the monitor. A failure also posts to `ALERT_WEBHOOK_URL`.
- Back up now (before every migration): `dc exec backup backup.sh`.
- List: `dc exec backup ls -l /backups/daily /backups/weekly`.

## 5. Restore (A26)

Restore into an **empty** database. The script refuses a database that already has users (override: `-e FORCE_RESTORE=yes`, only when you mean to replace everything).

```bash
# 1. Bring the private key in for the restore only (then delete it again).
scp ims-backup-key.txt server:/tmp/ims-backup-key.txt
# 2. On a NEW server or a fresh stack: deploy as in §2 up to "dc up -d db" (no migrate, no admin).
#    Copy the backup file into the backups volume (from rclone or the old server):
dc run --rm --entrypoint sh backup -c 'rclone --config /config/rclone/rclone.conf copy "$RCLONE_REMOTE/daily/ims-20261029-023000.tar.age" /backups/daily/'
# 3. Restore and check:
dc run --rm -v /tmp/ims-backup-key.txt:/keys/key.txt:ro -v ims_documents:/documents \
   backup restore /backups/daily/ims-20261029-023000.tar.age /keys/key.txt
#    → a table of row counts (backup vs restored, all OK), "ledger matches balances: t", "RESTORE OK"
# 4. Start the rest and run "After every deploy". Then: shred -u /tmp/ims-backup-key.txt
dc up -d
```

**Rehearsed on 29 Oct 2026** (local Docker): backup → restore into a brand-new PostgreSQL 17 + empty documents volume → every row count matched, ledger matched, the admin could sign in on the restored copy, and a PDF came back byte-identical. A second restore over the filled database was refused. **The witnessed restore on the real server is still required before go-live** (§21). Repeat it every 3 months.

## 6. Deploy a new version / roll back

```bash
cd /opt/ims && git -C /tmp/ims-src pull && cp -r /tmp/ims-src/ims/. /opt/ims/
export IMS_TAG=$(git -C /tmp/ims-src rev-parse --short HEAD)
dc build                              # builds ims-web:$IMS_TAG and ims-migrate:$IMS_TAG
dc exec backup backup.sh              # ALWAYS back up before migrating
dc run --rm migrate                   # migrations are a separate step, never at web start-up
dc up -d web                          # replaces the web container; data is in volumes
```

Then run §3. Set `IMS_TAG` in `.env.production` so it sticks.

**Roll back** the app: set `IMS_TAG` back to the previous tag and `dc up -d web`. Migrations only move forward. If the new version changed the database in a way the old one can't read, restore the backup taken just before the migration (§5) instead.

**Container replacement (A27)** is safe: `dc up -d --force-recreate web db` keeps all data, sessions and PDFs (they live in the `pg_data` and `documents` volumes). Rehearsed on 29 Oct 2026: 1,818 movements, 18,000 count entries, 1,337 PDFs, 121 users before and after; the existing session still worked; PDF identical.

## 7. Monitoring

`infrastructure/monitor/monitor.sh` runs every 10 minutes and checks:

- disk use below 85%, and free memory;
- `https://DOMAIN/api/health` (app and database);
- containers not running or unhealthy;
- TLS certificate has 14 days or more left;
- last successful backup under 26 h ago, and any backup failure;
- NGINX 5xx count;
- sync submissions refused or in conflict in the last 24 h.

One message lists every problem. It goes to `ALERT_WEBHOOK_URL` (Slack, Teams or Google Chat style `{"text": …}`) and/or `ALERT_EMAIL` (needs `mail`). The same set of problems is re-sent at most hourly. Thresholds can be changed in the environment (`DISK_MAX_PCT`, `TLS_MIN_DAYS`, …). Tested on 29 Oct 2026: with `web` stopped it reported `web(exited)` and HTTP 502 and sent one alert. When run again with the same problem, it sent nothing.

**Logs:** `dc logs --since 1h web nginx`. Each container keeps 5 × 10 MB. Every API response has a request ID (`requestId` in error bodies) to search for.

## 8. Certificates

Certbot tries to renew twice a day; NGINX reloads every 6 hours to pick up a new certificate. The monitor warns at 14 days. Manual: `dc run --rm certbot renew && dc exec nginx nginx -s reload`.

## 9. Credentials and access

| What                     | How to rotate                                                                                                                                            | Effect                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A user's password        | Admin → Users → Reset password                                                                                                                           | That user's sessions end                                                              |
| `AUTH_SECRET`            | New value in `.env.production`, `dc up -d web`                                                                                                           | Sign-in forms in progress must be reloaded                                            |
| `POSTGRES_PASSWORD`      | `dc exec db psql -U ims_app -d ims -c "ALTER USER ims_app PASSWORD '…'"`, update `.env.production`, `dc up -d web backup`                                | None, if done in that order                                                           |
| Backup key               | New `age-keygen`; update `BACKUP_AGE_RECIPIENT`; `dc up -d backup`                                                                                       | **Keep the old private key** until the last backup made with it has expired (8 weeks) |
| Server access (handover) | Add the new admin's SSH key, confirm they can log in, remove the old keys, rotate `POSTGRES_PASSWORD` and `AUTH_SECRET`, move the password-manager vault | —                                                                                     |

## 10. Load test

At pilot size: 10 office users issuing stock with 3–8 s pauses (mostly on the same 5 items), plus 30 phones each sending 50 count lines, all in the same second, three times. It creates its own `LOAD-*` locations, items and users, so **run it only on a rehearsal or staging stack, never on the live pilot database.**

```bash
docker run --rm -i --network <project>_default -e BASE=http://web:3000 \
  -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... grafana/k6 run - < load/pilot.js
# STRESS=1: no pauses, to find the limit
```

Results on 29 Oct 2026 (local Docker Desktop, 8 CPUs): 0 failed requests. Issue typical 0.21 s / p95 0.75 s. Pages typical 0.02 s / p95 0.27 s. Sync typical 0.58 s / p95 6.3 s for the simultaneous burst. Afterwards the ledger matched every balance, there were no negative balances, and every PDF was ready. The limit is one CPU core for the web process. If the monitor or users report slowness, add a second `web` container behind NGINX.

## 11. When something goes wrong

1. Run `sudo /opt/ims/infrastructure/monitor/monitor.sh` to see what's failing.
2. Run `dc ps`, then `dc logs --since 30m web db nginx`.
3. **Site down, but db healthy:** `dc up -d web`. If it still fails, roll back (§6).
4. **Database won't start:** don't delete volumes. Check disk space (`df -h`). If the data is damaged, restore the latest backup onto a fresh stack (§5) and tell users which hours of work to re-enter: anything after the backup time. Field phones keep unsent counts and send them again by themselves.
5. **Disk full:** `docker system prune` (images and build cache only, never `-a --volumes`). Check `/backups` retention.
6. Write down what happened and when in the tracker log.
