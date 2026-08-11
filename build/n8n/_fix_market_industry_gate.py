#!/usr/bin/env python3
"""_fix_market_industry_gate.py -- stop market000001 sending a placeholder search.

Root cause (found 2026-08-11): decide's fallback `p.industry || 'their industry'`
meant every client with no industry set (all 11, until 007_add_industry_column.sql
+ manual/inferred backfill) had fetchNews search newsdata.io for the literal
string "their industry" -- a meaningless query. Claude then correctly declined
to force a signal from irrelevant results, per its own prompt instruction. The
"None of these headlines are relevant..." message a client saw was the system
being honest about garbage input, not a bug in the AI.

007_add_industry_column.sql adds client_profile.industry/market_keywords and
exposes them on v_clients, so decide's `p.industry` read is now correct -- but
the fallback silently masks the real problem (no industry set) instead of
surfacing it. This patch changes the fallback to skip sending entirely for a
client with no industry, same pattern as the existing plan!=='pro' skip just
above it. Market Intelligence will only fire for clients who actually have an
industry on file, which is the accurate behavior until every client is
backfilled (see build/n8n/_build_infer_industry.py for the one-time inference
pass that already ran and needs review before its 2 confident results are
written).

Usage:
    python _fix_market_industry_gate.py            # writes market000001_industry_fix.json, no deploy
    python _fix_market_industry_gate.py --deploy    # also scp/import/activate/restart

Run from the build/n8n directory. Requires SSH access (~/.ssh/id_dadaai) to Hetzner.
"""
import json, os, subprocess, sys

HOST = "root@167.233.94.171"
KEY = os.path.expanduser("~/.ssh/id_dadaai")
SSH = ["ssh", "-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=60", HOST]
WORKFLOW_ID = "market000001"

OLD = "if(plan!=='pro'){return [{json:{send:false,reason:'market intel is Pro-only'}}];}\nreturn [{json:{send:true,client_id:(p.client_id||'client_test'),\n  industry:(p.industry||'their industry'), keywords:(p.market_keywords||''),\n  business_stage:(p.business_stage||'growing')}}];"
NEW = "if(plan!=='pro'){return [{json:{send:false,reason:'market intel is Pro-only'}}];}\nif(!p.industry){return [{json:{send:false,reason:'no industry set for this client'}}];}\nreturn [{json:{send:true,client_id:(p.client_id||'client_test'),\n  industry:p.industry, keywords:(p.market_keywords||''),\n  business_stage:(p.business_stage||'growing')}}];"


def run(cmd, **kw):
    print("  $", " ".join(cmd) if isinstance(cmd, list) else cmd)
    kw.setdefault("encoding", "utf-8")
    return subprocess.run(cmd, check=True, **kw)


def fetch_live_workflow():
    remote_pull = (
        "rm -f /root/_mk_pull.sqlite*; "
        "for f in database.sqlite database.sqlite-wal database.sqlite-shm; do "
        "docker cp n8n-n8n-1:/home/node/.n8n/$f /root/_mk_pull.${f#database.} 2>/dev/null; done; "
        f"sqlite3 -json /root/_mk_pull.sqlite "
        f"\"SELECT id,name,nodes,connections,settings FROM workflow_entity WHERE id='{WORKFLOW_ID}';\""
    )
    out = subprocess.run(SSH + [remote_pull], check=True, capture_output=True, encoding="utf-8").stdout
    return json.loads(out)[0]


def patch(row):
    nodes = json.loads(row["nodes"])
    dc = next(n for n in nodes if n.get("name") == "decide")
    js = dc["parameters"]["jsCode"]

    if OLD not in js:
        if NEW in js:
            return None, 0  # already patched, idempotent no-op
        raise SystemExit("FATAL: expected pattern not found in decide -- workflow changed since this script was written")

    dc["parameters"]["jsCode"] = js.replace(OLD, NEW)

    wf = {
        "id": row["id"],
        "name": row["name"],
        "nodes": nodes,
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row.get("settings") else {"executionOrder": "v1"},
        "active": False,
    }
    return wf, 1


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
    print(f'  ssh -i {KEY} {HOST} \'docker logs n8n-n8n-1 --tail 60 | grep "Activated workflow \\"Relentless AI - Market Intelligence"\'')


def main():
    deploy_flag = "--deploy" in sys.argv

    print(f"Snapshotting live {WORKFLOW_ID} before touching it...")
    row = fetch_live_workflow()
    ts_cmd = (
        f"sqlite3 -json /root/_mk_pull.sqlite "
        f"\"SELECT id,name,nodes,connections,settings,active FROM workflow_entity WHERE id='{WORKFLOW_ID}';\" "
        f"> /root/{WORKFLOW_ID}_ROLLBACK_$(date +%Y%m%d_%H%M%S).json"
    )
    subprocess.run(SSH + [ts_cmd], check=True)

    wf, applied = patch(row)
    if wf is None:
        print("  already patched -- nothing to do")
        return

    print(f"  {applied}/1 substitution applied")

    out_path = os.path.join(os.path.dirname(__file__), f"{WORKFLOW_ID}_industry_fix.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)
    print(f"  wrote {out_path}")

    if deploy_flag:
        deploy(out_path)
    else:
        print("\nDry run only. Re-run with --deploy to ship it.")
        print("Prerequisite: 007_add_industry_column.sql must be applied in Supabase first (it is).")


if __name__ == "__main__":
    main()
