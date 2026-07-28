#!/usr/bin/env python3
"""P3 publish-sync deploy (2026-07-06): pending-row client_id + eodPro .first() + SLA alert window.
Updates nodes/connections from /root/deploy_p1/p3/<wf>.json, then publish-syncs
(workflow_history snapshot + activeVersionId) so n8n 2.26 runs the fix.
Usage: python3 publish_sync_p3.py <database.sqlite> <json_dir>
Run ONLY while n8n is stopped, against the volume DB; chown 1000:1000 + rm wal/shm after.
"""
import sqlite3, json, sys, uuid, time, os

DB = sys.argv[1]
JDIR = sys.argv[2]
# workflow -> markers that MUST be present in the new nodes (fix present) before publishing
MARKERS = {
    "morningCheckin1": ["$('extract').item.json.client_id", "$('IsSend').all(); const __OUT"],
    "briefBuilder1": ["$('extract').item.json.client_id"],
    "eodPro00001ghl": ["$('computeScore').item.json.client_id"],
    "slaMonitor1": ["localHour >= 8 && localHour <= 9"],
}

con = sqlite3.connect(DB)
cur = con.cursor()

ts = time.strftime("%Y%m%d_%H%M%S")
rows = []
for wid in MARKERS:
    r = cur.execute("SELECT id, nodes, connections, settings, active, versionId, activeVersionId FROM workflow_entity WHERE id=?", (wid,)).fetchone()
    assert r, f"{wid}: not found"
    rows.append({"id": r[0], "nodes": r[1], "connections": r[2], "settings": r[3], "active": r[4], "versionId": r[5], "activeVersionId": r[6]})
bpath = f"/root/deploy_p1/wf_backup_p3_{ts}.json"
open(bpath, "w").write(json.dumps(rows))
print(f"[backup] {len(rows)} rows -> {bpath}")

for wid, marks in MARKERS.items():
    d = json.load(open(os.path.join(JDIR, f"{wid}.json")))
    assert d["id"] == wid
    nodes_s = json.dumps(d["nodes"]); conns_s = json.dumps(d["connections"])
    for m in marks:
        assert m in nodes_s, f"{wid}: marker {m!r} missing — refusing to publish"
    vid = str(uuid.uuid4())
    assert cur.execute("UPDATE workflow_entity SET nodes=?, connections=?, versionId=? WHERE id=?",
                       (nodes_s, conns_s, vid, wid)).rowcount == 1
    name = cur.execute("SELECT name FROM workflow_entity WHERE id=?", (wid,)).fetchone()[0]
    cur.execute("INSERT INTO workflow_history (versionId, workflowId, authors, nodes, connections, name, autosaved, nodeGroups) "
                "VALUES (?,?,?,?,?,?,0,'[]')", (vid, wid, "publish-sync-p3", nodes_s, conns_s, name))
    cur.execute("UPDATE workflow_entity SET activeVersionId=? WHERE id=?", (vid, wid))
    print(f"[publish] {wid}: nodes updated + published v={vid[:8]}")

con.commit()
print("[integrity]", con.execute("PRAGMA integrity_check;").fetchone()[0])

bad = []
for wid, marks in MARKERS.items():
    v, av, nodes_s = cur.execute("SELECT versionId, activeVersionId, nodes FROM workflow_entity WHERE id=?", (wid,)).fetchone()
    h = cur.execute("SELECT nodes FROM workflow_history WHERE workflowId=? AND versionId=?", (wid, v)).fetchone()
    if v != av or not h or any(m not in h[0] or m not in nodes_s for m in marks):
        bad.append(wid)
assert not bad, f"post-verify failed for: {bad}"
print(f"VERIFIED: all {len(MARKERS)} workflows published with fix markers")
print(f"rollback file: {bpath}")
con.close()
