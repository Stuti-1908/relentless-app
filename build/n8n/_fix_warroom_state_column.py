#!/usr/bin/env python3
"""_fix_warroom_state_column.py — fix warRoom0001's routeTurn reading dead columns.

Symptom (found 2026-08-10): a War Room session gets stuck re-asking "Reply one
word: PROBLEM, OPPORTUNITY, or STRATEGY" on every message, never advancing past
the first turn, even though the session row's `state` and `transcript` columns
in war_room_sessions are updating correctly on write.

Root cause: routeTurn's READ side was never fully converted off the pre-Supabase
column names. Three call sites still referenced dead/nonexistent columns:

  1. sess.session_date  -> real column is opened_at (used to sort candidate
     sessions; a no-op with one session, breaks session selection with >1)
  2. parseTranscript(s) reading s.transcript_json (always null on read; the
     real content is in s.transcript, and Supabase already returns it as a
     parsed array, not a JSON string — JSON.parse-ing it a second time is what
     silently crashed and reset the phase)
  3. sess.focus_topic || sess.phase  -> real column is state. focus_topic is
     never populated on read (buildSessionPatch writes it, but that name gets
     translated to `state` by upsertSession's body-mapping before it ever
     reaches Supabase) and .phase doesn't exist as a column at all — so this
     ALWAYS fell through to the 'await_type' default regardless of the
     session's actual state, which is the direct cause of the observed loop.

This patches routeTurn only — no other node in the workflow needed changes.
Verified against the live system's actual node source before writing this
script, and the resulting deploy was tested end-to-end against a real stuck
session (state correctly advanced from await_type -> await_describe).

Prerequisite: run this from a machine with SSH access (~/.ssh/id_dadaai) to the
Hetzner host. Reads the CURRENT live workflow (via a WAL-inclusive DB copy) so
it always patches on top of whatever's actually deployed, not a stale local copy.

Usage:
    python _fix_warroom_state_column.py            # writes _warroom_patched.json, does not deploy
    python _fix_warroom_state_column.py --deploy    # also scp/import/activate/restart

Run from the build/n8n directory.
"""
import json, os, re, subprocess, sys, tempfile

HOST = "root@167.233.94.171"
KEY = os.path.expanduser("~/.ssh/id_dadaai")
SSH = ["ssh", "-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=60", HOST]
WORKFLOW_ID = "warRoom0001"

SUBSTITUTIONS = [
    (
        "rows.sort(function(a,b){ return String(b.session_date||'').localeCompare(String(a.session_date||'')); });",
        "rows.sort(function(a,b){ return String(b.opened_at||'').localeCompare(String(a.opened_at||'')); });",
    ),
    (
        "function parseTranscript(s){ try{ return JSON.parse(s.transcript_json||'[]'); }catch(e){ return []; } }",
        "function parseTranscript(s){ var t=s.transcript; if(Array.isArray(t)) return t; "
        "try{ return JSON.parse(t||'[]'); }catch(e){ return []; } }",
    ),
    (
        "var phase = sess.focus_topic || sess.phase || 'await_type';  // phase persisted in focus_topic (no phase column)",
        "var phase = sess.state || 'await_type';  // state is the real column; loadSession/v_open_war_room return it directly",
    ),
]


def run(cmd, **kw):
    print("  $", " ".join(cmd) if isinstance(cmd, list) else cmd)
    return subprocess.run(cmd, check=True, **kw)


def fetch_live_workflow(tmpdir):
    """Pull the CURRENT live workflow row (nodes+connections+settings), WAL-inclusive."""
    remote_pull = (
        "rm -f /root/_wr_pull.sqlite*; "
        "for f in database.sqlite database.sqlite-wal database.sqlite-shm; do "
        "docker cp n8n-n8n-1:/home/node/.n8n/$f /root/_wr_pull.${f#database.} 2>/dev/null; done; "
        f"sqlite3 -json /root/_wr_pull.sqlite "
        f"\"SELECT id,name,nodes,connections,settings FROM workflow_entity WHERE id='{WORKFLOW_ID}';\""
    )
    out = subprocess.run(SSH + [remote_pull], check=True, capture_output=True, text=True).stdout
    row = json.loads(out)[0]
    return row


def patch(row):
    nodes = json.loads(row["nodes"])
    rt = next(n for n in nodes if n.get("name") == "routeTurn")
    js = rt["parameters"]["jsCode"]

    applied = 0
    for old, new in SUBSTITUTIONS:
        if old not in js:
            if new in js:
                print(f"  already patched: {old[:60]}...")
                continue
            raise SystemExit(f"FATAL: expected pattern not found (workflow changed?):\n  {old[:100]}")
        js = js.replace(old, new)
        applied += 1

    rt["parameters"]["jsCode"] = js
    wf = {
        "id": row["id"],
        "name": row["name"],
        "nodes": nodes,
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row.get("settings") else {"executionOrder": "v1"},
        "active": False,
    }
    return wf, applied


def deploy(local_path):
    remote_path = f"/root/n8n/{WORKFLOW_ID}_fix.json"
    run(["scp", "-i", KEY, "-o", "StrictHostKeyChecking=no", local_path, f"{HOST}:{remote_path}"])
    run(SSH + [
        f"cd /root/n8n && "
        f"docker compose cp {remote_path} n8n:/tmp/{WORKFLOW_ID}_fix.json && "
        f"docker compose exec -T n8n n8n import:workflow --input=/tmp/{WORKFLOW_ID}_fix.json"
    ])
    run(SSH + [f"cd /root/n8n && docker compose exec -T n8n n8n update:workflow --id={WORKFLOW_ID} --active=true"])
    run(SSH + ["cd /root/n8n && docker compose restart n8n"])
    print("\nDeployed. Verify with:")
    print(f'  ssh -i {KEY} {HOST} \'docker logs n8n-n8n-1 --tail 60 | grep "Activated workflow \\"Relentless AI - War Room"\'')


def main():
    deploy_flag = "--deploy" in sys.argv

    print(f"Snapshotting live {WORKFLOW_ID} before touching it...")
    row = fetch_live_workflow(None)
    ts_cmd = f"sqlite3 -json /root/_wr_pull.sqlite \"SELECT id,name,nodes,connections,settings,active FROM workflow_entity WHERE id='{WORKFLOW_ID}';\" > /root/{WORKFLOW_ID}_ROLLBACK_$(date +%Y%m%d_%H%M%S).json"
    subprocess.run(SSH + [ts_cmd], check=True)

    wf, applied = patch(row)
    print(f"  {applied}/3 substitutions applied")

    out_path = os.path.join(os.path.dirname(__file__), f"{WORKFLOW_ID}_state_fix.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)
    print(f"  wrote {out_path}")

    if deploy_flag:
        deploy(out_path)
    else:
        print("\nDry run only. Re-run with --deploy to ship it.")


if __name__ == "__main__":
    main()
