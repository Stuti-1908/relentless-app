#!/bin/bash
# Deploy the patch 8 (fetch shim + email reply cleanup, includes 6+7) to production n8n (n8n-n8n-1). Rollback: /root/audit_fix/rollback.sh
set -euo pipefail
VOL=/var/lib/docker/volumes/n8n_data/_data
FIX=/root/audit_fix
BK=/root/n8n_backups/predeploy_audit_$(date -u +%Y%m%d_%H%M%S)

cd /root/n8n
docker compose stop n8n
mkdir -p "$BK"
cp -p "$VOL"/database.sqlite* "$BK"/
echo "$BK" > "$FIX/last_backup"
echo "backup -> $BK"

python3 "$FIX/apply.py" "$VOL/database.sqlite" "$FIX/patched8.json"

rm -f "$VOL/database.sqlite-wal" "$VOL/database.sqlite-shm"
chown 1000:1000 "$VOL/database.sqlite"
ls -la "$VOL/database.sqlite"

docker compose up -d n8n
sleep 45
echo "== activated (expect 18) =="
docker logs --since 2m n8n-n8n-1 2>&1 | grep -c "Activated workflow" || true
docker logs --since 2m n8n-n8n-1 2>&1 | grep -iE "error|fail" | grep -viE "error tracking|python" | head -5 || true
docker ps --format "{{.Names}} {{.Status}}" | grep n8n-n8n-1
