#!/bin/sh
# Backup harian database & dokumen. Jadwalkan via cron: 30 1 * * * /opt/kmh-p2p/deploy/backup.sh
set -e
cd "$(dirname "$0")/.."
DEST=${BACKUP_DIR:-/var/backups/kmh-p2p}; mkdir -p "$DEST"; TS=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U kmh -Fc kmh > "$DEST/db-$TS.dump"
docker compose run --rm -v "$DEST":/backup --entrypoint sh app -c "tar czf /backup/uploads-$TS.tgz -C /app/data uploads"
find "$DEST" -type f -mtime +30 -delete
echo "Backup selesai: $DEST ($TS)"
# Pulihkan: docker compose exec -T db pg_restore -U kmh -d kmh --clean < db-YYYYMMDD-HHMM.dump
