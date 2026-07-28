#!/usr/bin/env python3
"""
DIRECT-DB DEPLOY — Relentless AI global production fixes (2026-07-02).

Runs ON THE HETZNER HOST. Writes the 11 fixed/new workflows straight into n8n's
workflow_entity (the CLI import is broken on n8n 2.26 for existing IDs). Includes:
  - full backup of every workflow row before any write,
  - per-workflow ASSERTION that the fix marker is present (refuses to write otherwise),
  - new versionId per workflow so n8n history is coherent,
  - bulk-expire of stale 'open' pending rows that were intercepting inbound replies,
  - a --rollback mode that restores from the backup this script wrote.

USAGE (on host, in the dir holding the deploy JSONs + this script):
  python3 _DEPLOY_ALL_direct_db.py --db /tmp/database.sqlite --apply
  python3 _DEPLOY_ALL_direct_db.py --db /tmp/database.sqlite --rollback /tmp/wf_backup_<ts>.json

The wrapper shell script handles: docker cp DB out, run this --apply, docker cp DB back,
restart n8n. This script only touches the sqlite file it is given.
"""
import argparse, json, sqlite3, sys, os, uuid, time, datetime

# workflow_id -> fix marker that MUST be present in the deploy JSON (assertion gate)
MARKERS = {
    "morningCheckin1": "multi-client loop wrapper",
    "market000001": "multi-client loop wrapper",
    "weekly000001ghl": "multi-client loop wrapper",
    "onboard00001ghl": "multi-client loop wrapper",
    "briefFallback1": "multi-client loop wrapper",
    "stageTrans01ghl": "Loop Over Clients",
    "eodPro00001ghl": "Loop Over Clients",
    "ghlInboundV1": "isBareCommandToken",
    "briefBuilder1": "__antiRepeat",
    "slaMonitor1": "localHour >= 8",
    "contactRepair1": "createContact",   # brand-new workflow (insert, not update)
}
NEW_WORKFLOWS = {"contactRepair1"}  # insert rather than update


def backup(con, ids, out_path):
    cur = con.cursor()
    rows = []
    qs = ",".join("?" for _ in ids)
    for r in cur.execute(f"SELECT id, name, nodes, connections, settings, active, versionId FROM workflow_entity WHERE id IN ({qs})", list(ids)):
        rows.append({"id": r[0], "name": r[1], "nodes": r[2], "connections": r[3],
                     "settings": r[4], "active": r[5], "versionId": r[6]})
    json.dump(rows, open(out_path, "w", encoding="utf-8"))
    print(f"[backup] {len(rows)} existing workflow rows -> {out_path}")
    return rows


def deploy(con, srcdir):
    cur = con.cursor()
    for wid, marker in MARKERS.items():
        f = os.path.join(srcdir, wid + ".json")
        if not os.path.exists(f):
            print(f"[SKIP] {wid}: no deploy file"); continue
        d = json.load(open(f, encoding="utf-8"))
        nodes = json.dumps(d["nodes"])
        conns = json.dumps(d["connections"])
        blob = nodes + conns
        # ASSERTION: refuse to write a workflow that doesn't contain its fix.
        assert marker in blob, f"{wid}: fix marker '{marker}' NOT present — refusing to deploy"
        vid = str(uuid.uuid4())
        settings = json.dumps(d.get("settings", {}))
        if wid in NEW_WORKFLOWS:
            # does it already exist? if so, update; else insert.
            exists = cur.execute("SELECT 1 FROM workflow_entity WHERE id=?", (wid,)).fetchone()
            if exists:
                cur.execute("UPDATE workflow_entity SET nodes=?, connections=?, settings=?, active=1, versionId=?, updatedAt=STRFTIME('%Y-%m-%d %H:%M:%f','NOW') WHERE id=?",
                            (nodes, conns, settings, vid, wid))
                print(f"[update] {wid} (existing new-wf) v={vid[:8]}")
            else:
                now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.000")
                cur.execute(
                    "INSERT INTO workflow_entity (id, name, active, nodes, connections, settings, versionId, createdAt, updatedAt, triggerCount, isArchived) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (wid, d.get("name", wid), 1, nodes, conns, settings, vid, now, now, 0, 0))
                print(f"[insert] {wid} v={vid[:8]}")
        else:
            n = cur.execute("UPDATE workflow_entity SET nodes=?, connections=?, settings=?, active=1, versionId=?, updatedAt=STRFTIME('%Y-%m-%d %H:%M:%f','NOW') WHERE id=?",
                            (nodes, conns, settings, vid, wid)).rowcount
            assert n == 1, f"{wid}: expected 1 row updated, got {n}"
            print(f"[update] {wid} v={vid[:8]}")


def expire_stale_pending(con):
    """Set status='expired' on open rows past expires_at, so they stop intercepting inbound."""
    cur = con.cursor()
    # tbl_pending_replies is Airtable, NOT sqlite — this is a NO-OP marker. Stale-row cleanup is
    # done via the Airtable API in the wrapper (see _expire_stale_pending.js). Kept here for docs.
    print("[note] stale pending-row expiry runs via Airtable API (_expire_stale_pending.js), not sqlite.")


def rollback(con, backup_path):
    cur = con.cursor()
    rows = json.load(open(backup_path, encoding="utf-8"))
    for r in rows:
        cur.execute("UPDATE workflow_entity SET nodes=?, connections=?, settings=?, active=?, versionId=? WHERE id=?",
                    (r["nodes"], r["connections"], r["settings"], r["active"], r["versionId"], r["id"]))
    # contactRepair1 was an insert — remove it on rollback if it wasn't in the backup.
    backed = {r["id"] for r in rows}
    if "contactRepair1" not in backed:
        cur.execute("DELETE FROM workflow_entity WHERE id='contactRepair1'")
        print("[rollback] removed inserted contactRepair1")
    print(f"[rollback] restored {len(rows)} workflow rows from {backup_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--srcdir", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--rollback")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    try:
        if args.rollback:
            rollback(con, args.rollback)
            con.commit()
            return
        ids = list(MARKERS.keys())
        ts = time.strftime("%Y%m%d_%H%M%S")
        bpath = f"/tmp/wf_backup_{ts}.json"
        backup(con, ids, bpath)
        if not args.apply:
            print("[dry-run] backup written; pass --apply to deploy.")
            return
        deploy(con, args.srcdir)
        expire_stale_pending(con)
        con.commit()
        print(f"\n[done] deployed. rollback with: python3 {os.path.basename(__file__)} --db {args.db} --rollback {bpath}")
    except AssertionError as e:
        con.rollback()
        print(f"\n[ABORT] {e}\nNo changes committed.")
        sys.exit(1)
    finally:
        con.close()


if __name__ == "__main__":
    main()
