#!/usr/bin/env python3
"""P2 publish-sync deploy (2026-07-05): cross-client leak fix.
Updates nodes/connections from /root/deploy_p1/p2/<wf>.json for the 3 affected senders, then
publish-syncs (workflow_history snapshot + activeVersionId) so n8n 2.26 actually runs the fix.
Usage: python3 publish_sync_p2.py <database.sqlite> <json_dir>
Run ONLY while n8n is stopped, directly against the volume DB; chown 1000:1000 + rm wal/shm after.
"""
import sqlite3, json, sys, uuid, time, os

DB = sys.argv[1]
JDIR = sys.argv[2]
WFS = ["morningCheckin1", "weekly000001ghl", "onboard00001ghl"]
MARKER = "$('IsSend').all(); const __OUT"

con = sqlite3.connect(DB)
cur = con.cursor()

ts = time.strftime("%Y%m%d_%H%M%S")
rows = []
for wid in WFS:
    r = cur.execute("SELECT id, nodes, connections, settings, active, versionId, activeVersionId FROM workflow_entity WHERE id=?", (wid,)).fetchone()
    assert r, f"{wid}: not found in workflow_entity"
    rows.append({"id": r[0], "nodes": r[1], "connections": r[2], "settings": r[3], "active": r[4], "versionId": r[5], "activeVersionId": r[6]})
bpath = f"/root/deploy_p1/wf_backup_p2_{ts}.json"
open(bpath, "w").write(json.dumps(rows))
print(f"[backup] {len(rows)} rows -> {bpath}")

for wid in WFS:
    d = json.load(open(os.path.join(JDIR, f"{wid}.json")))
    assert d["id"] == wid, f"{wid}: id mismatch in JSON file ({d['id']})"
    nodes_s = json.dumps(d["nodes"]); conns_s = json.dumps(d["connections"])
    assert MARKER in nodes_s, f"{wid}: leak-fix marker missing from update file — refusing"
    vid = str(uuid.uuid4())
    n = cur.execute("UPDATE workflow_entity SET nodes=?, connections=?, versionId=? WHERE id=?",
                    (nodes_s, conns_s, vid, wid)).rowcount
    assert n == 1
    name = cur.execute("SELECT name FROM workflow_entity WHERE id=?", (wid,)).fetchone()[0]
    cur.execute(
        "INSERT INTO workflow_history (versionId, workflowId, authors, nodes, connections, name, autosaved, nodeGroups) "
        "VALUES (?,?,?,?,?,?,0,'[]')",
        (vid, wid, "publish-sync-p2", nodes_s, conns_s, name))
    cur.execute("UPDATE workflow_entity SET activeVersionId=? WHERE id=?", (vid, wid))
    print(f"[publish] {wid}: nodes updated + published v={vid[:8]}")

con.commit()
print("[integrity]", con.execute("PRAGMA integrity_check;").fetchone()[0])

bad = []
for wid in WFS:
    v, av, nodes_s = cur.execute("SELECT versionId, activeVersionId, nodes FROM workflow_entity WHERE id=?", (wid,)).fetchone()
    h = cur.execute("SELECT nodes FROM workflow_history WHERE workflowId=? AND versionId=?", (wid, v)).fetchone()
    if v != av or not h or MARKER not in h[0] or MARKER not in nodes_s:
        bad.append(wid)
assert not bad, f"post-verify failed for: {bad}"
print(f"VERIFIED: all {len(WFS)} workflows published with leak-fix marker (entity + history + activeVersionId)")
print(f"rollback file: {bpath}")
con.close()
