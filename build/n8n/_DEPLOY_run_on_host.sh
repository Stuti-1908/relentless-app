#!/usr/bin/env bash
# Relentless AI — direct-DB deploy wrapper. RUN ON THE HETZNER HOST.
# Orchestrates: stop-safe DB copy -> assert+write via python -> copy back -> restart n8n.
# Everything is gated by the python script's per-workflow fix assertions; nothing is written
# unless every fix marker is present. A timestamped backup is left in /root/deploy_p1 for rollback.
set -euo pipefail

DIR="/root/deploy_p1"          # holds the deploy JSONs + the two python/js scripts
CONTAINER="n8n-n8n-1"
DBPATH="/home/node/.n8n/database.sqlite"
STAMP="$(date +%Y%m%d_%H%M%S)"

cd "$DIR"
echo "== [1/5] copy live DB out of container =="
docker cp "${CONTAINER}:${DBPATH}" "${DIR}/deploy_${STAMP}.sqlite"

echo "== [2/5] DRY RUN (backup + assertions, no writes) =="
python3 _DEPLOY_ALL_direct_db.py --db "${DIR}/deploy_${STAMP}.sqlite" --srcdir "$DIR" --backup-dir "$DIR"

echo "== [3/5] APPLY (write fixes into the DB copy) =="
python3 _DEPLOY_ALL_direct_db.py --db "${DIR}/deploy_${STAMP}.sqlite" --srcdir "$DIR" --backup-dir "$DIR" --apply

echo "== [4/5] copy patched DB back into container =="
# n8n must be stopped while we swap the sqlite file to avoid WAL corruption.
cd /root/n8n && docker compose stop n8n
docker cp "${DIR}/deploy_${STAMP}.sqlite" "${CONTAINER}:${DBPATH}"
# clear stale WAL/SHM so the swapped DB is the source of truth
docker exec "${CONTAINER}" sh -c "rm -f ${DBPATH}-wal ${DBPATH}-shm" 2>/dev/null || true

echo "== [5/5] restart n8n =="
cd /root/n8n && docker compose start n8n
sleep 8
docker exec "${CONTAINER}" sh -c "sqlite3 ${DBPATH} \"SELECT id||' active='||active FROM workflow_entity WHERE id IN ('morningCheckin1','ghlInboundV1','briefBuilder1','slaMonitor1','contactRepair1');\"" || true

echo ""
echo "== DONE. Then run stale-pending cleanup (needs AIRTABLE_PAT):"
echo "   AIRTABLE_PAT=<pat> node ${DIR}/_expire_stale_pending.js --apply"
echo "== Rollback if needed:"
echo "   (stop n8n) python3 ${DIR}/_DEPLOY_ALL_direct_db.py --db <db-copy> --rollback ${DIR}/wf_backup_${STAMP}.json (copy back, start n8n)"
