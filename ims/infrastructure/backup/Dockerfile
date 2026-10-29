# Nightly backup job (spec §15.7): pg_dump + PDF volume, encrypted with age,
# 14 daily / 8 weekly kept, copied off the server with rclone.
# Same PostgreSQL major as the database (17), so pg_dump/pg_restore match.
FROM postgres:17-alpine
RUN apk add --no-cache age rclone tzdata curl bash
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
