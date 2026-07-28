#!/bin/bash
# deploy_fanout.sh — upload + import all fan-out patched workflows to Hetzner n8n
# Run from the build/n8n directory:
#   bash deploy_fanout.sh

set -e
HOST="root@167.233.94.171"
KEY="$(dirname "$0")/hetzner/ssh/n8n_hetzner"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no"
SCP="scp -i $KEY -o StrictHostKeyChecking=no"
REMOTE_DIR="/root/n8n"

FILES=(
  "_morning_checkin.json:morningCheckin1"
  "_eod_honest.json:eodPro00001ghl"
  "_market.json:market000001"
  "_monthly_ghl.json:monthly00001"
  "_onboarding_ghl.json:onboard00001"
  "_stage_ghl.json:stageTrans01ghl"
  "_badday_ghl.json:badDayOverr1ghl"
)

echo "=== Deploying fan-out workflows to Hetzner ==="

for entry in "${FILES[@]}"; do
  FILE="${entry%%:*}"
  ID="${entry##*:}"
  LOCAL="$(dirname "$0")/$FILE"

  echo ""
  echo "[$ID] uploading $FILE ..."
  $SCP "$LOCAL" "$HOST:$REMOTE_DIR/$FILE"

  echo "[$ID] importing ..."
  $SSH "$HOST" "cd $REMOTE_DIR && docker compose exec n8n n8n import:workflow --input=$REMOTE_DIR/$FILE"

  echo "[$ID] activating ..."
  $SSH "$HOST" "cd $REMOTE_DIR && docker compose exec n8n n8n update:workflow --id=$ID --active=true"

  echo "[$ID] done."
done

echo ""
echo "=== All imports done — restarting n8n ==="
$SSH "$HOST" "cd $REMOTE_DIR && docker compose restart n8n"
echo "=== Deploy complete ==="
