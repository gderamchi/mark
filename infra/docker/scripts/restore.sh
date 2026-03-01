#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: restore.sh <postgres.sql> <minio.tar>"
  exit 1
fi

PG_SQL=$1
MINIO_TAR=$2

PG_CONTAINER=$(docker compose -f infra/docker/docker-compose.yml ps -q postgres)
MINIO_CONTAINER=$(docker compose -f infra/docker/docker-compose.yml ps -q minio)

cat "$PG_SQL" | docker exec -i "$PG_CONTAINER" psql -U mark mark
cat "$MINIO_TAR" | docker exec -i "$MINIO_CONTAINER" tar -C /data -xf -

echo "restore completed"
