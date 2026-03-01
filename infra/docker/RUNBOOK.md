# Self-host runbook

## 1. Prepare VM

- Ubuntu 24.04+
- Docker Engine + Compose plugin
- Domain pointing to VM public IP

## 2. Configure

1. Copy `apps/api/.env.example` to `apps/api/.env` and fill credentials.
2. Update `infra/docker/Caddyfile` with your real domain and contact email.

## 3. Start stack

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build
```

## 4. Verify

- API health: `https://<your-domain>/health`
- WebSocket namespace: `wss://<your-domain>/v1/session`

## 5. Backup/restore

- Backup: `infra/docker/scripts/backup.sh ./backups`
- Restore: `infra/docker/scripts/restore.sh <postgres.sql> <minio.tar>`
