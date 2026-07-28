# Deploy P2 — cross-client leak fix (P0)

**What:** `extract` in `morningCheckin1`, `weekly000001ghl`, `onboard00001ghl` now pairs Claude
responses with `$('IsSend').all()` (filtered, same order) instead of `$('decide').all()`
(unfiltered). Stops client A's message going to client B whenever IsSend drops anyone.
`market000001` pairs with `buildPrompt` — already aligned, untouched.

**Verified offline:** patch marker asserted in all 3 files; `node --check` clean; simulation
(4 clients, 1 filtered) reproduces the leak with old code and shows correct pairing with new code.

**Deploy (proven publish-sync recipe — workflow_entity.nodes alone does NOT change runtime):**

```bash
scp -i ~/.ssh/id_dadaai _deploy_p2/*.json root@167.233.94.171:/root/deploy_p1/p2/
ssh -i ~/.ssh/id_dadaai root@167.233.94.171
# on host — use the existing proven script:
python3 /root/deploy_p1/publish_sync.py   # point it at /root/deploy_p1/p2/*.json
```

publish_sync.py must, per workflow (recipe proven 2026-07-05):
1. UPDATE workflow_entity nodes/connections + new versionId
2. INSERT workflow_history row (versionId, workflowId, authors, nodes, connections, name, autosaved=0, nodeGroups='[]')
3. UPDATE workflow_entity SET activeVersionId = versionId
4. Stop n8n before patching the volume DB (`/var/lib/docker/volumes/n8n_data/_data`),
   `rm -f database.sqlite-wal database.sqlite-shm`, `chown 1000:1000 database.sqlite`, then
   `docker compose up -d` (full recreate, not restart).

**Post-deploy check:** next morningCheckin1 run — confirm each sent message's name matches the
ghl_contact_id's client (compare extract output client_id vs sendGHL contact in the execution).

**Fix marker to grep in live DB:** `$('IsSend').all(); const __OUT`
