#!/usr/bin/env bash
set -euo pipefail

STAMP=$(date +"%Y%m%d-%H%M%S")
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"

PG_CONTAINER=$(docker compose -f infra/docker/docker-compose.yml ps -q postgres)
MINIO_CONTAINER=$(docker compose -f infra/docker/docker-compose.yml ps -q minio)

if [[ -z "$PG_CONTAINER" || -z "$MINIO_CONTAINER" ]]; then
  echo "services not running"
  exit 1
fi

docker exec "$PG_CONTAINER" pg_dump -U mark mark > "$OUT_DIR/postgres-$STAMP.sql"
docker exec "$MINIO_CONTAINER" tar -C /data -cf - . > "$OUT_DIR/minio-$STAMP.tar"

echo "backup completed in $OUT_DIR"
