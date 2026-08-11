#!/usr/bin/env python3
"""_fix_monthly_report_supabase.py -- convert monthly00001ghl's 3 remaining Airtable
nodes to Supabase.

Found 2026-08-11: monthly00001ghl was live (active=1) with 3 Airtable nodes still
in place -- loadProfile, fetchScores, logReport -- all targeting tbl_* tables that
no longer exist in Airtable (the data layer was migrated to Supabase on 2026-08-06;
see HANDOFF-2026-08-06.md). This workflow was apparently reactivated at some point
after that migration without being converted, so it would fail with the same
PUBLIC_API_BILLING_LIMIT_EXCEEDED 429 every other workflow hit before conversion,
the next time its cron fired (0 8 1 * * Asia/Kolkata -- the 1st of the month).

Conversion, following the exact pattern proven on all 14 previously-converted
workflows (convert_workflows.py / convert_inbound_router.py):

  loadProfile  -> v_clients, filters.conditions [active eq true]     (same as every
                  other converted "loadProfile" node in the project)
  fetchScores  -> v_daily_scores_last_31d (view; absorbs the DATETIME_DIFF<=31
                  the Supabase node's filter UI can't express -- see 006's schema
                  comment), filtered by client_id eq. The Airtable node had
                  client_id='client_test' HARDCODED -- a stale leftover never
                  updated when this workflow was fan-out patched for per-client
                  delivery windows (aggregate's TZ guard already treats $json as
                  one profile item, so the fetchScores node should have been
                  narrowed to that item's client_id, not left on a single-client
                  placeholder). Fixed here to read the per-item client_id.
  logReport    -> monthly_reports (create), same 7 columns the Airtable node wrote
                  (client_id, month_year, monthly_score, base_score, trend_bonus,
                  consistency_bonus, pillar_improvement_bonus) plus report_sent_sms.

Prerequisite: 006_schema_monthly_reports.sql must be applied in Supabase first
(monthly_reports table + v_daily_scores_last_31d view). This script does not check
that -- it will deploy either way, but the workflow will fail on its next run if
you skip it.

Usage:
    python _fix_monthly_report_supabase.py            # writes _monthlyreport_fix.json, no deploy
    python _fix_monthly_report_supabase.py --deploy    # also scp/import/activate/restart

Run from the build/n8n directory. Requires SSH access (~/.ssh/id_dadaai) to Hetzner.
"""
import json, os, subprocess, sys

HOST = "root@167.233.94.171"
KEY = os.path.expanduser("~/.ssh/id_dadaai")
SSH = ["ssh", "-i", KEY, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=60", HOST]
WORKFLOW_ID = "monthly00001ghl"

SUPA_CRED = {"supabaseApi": {"id": "gSbZ6Y52r8jgE7xQ", "name": "Supabase - Relentless AI"}}


def run(cmd, **kw):
    print("  $", " ".join(cmd) if isinstance(cmd, list) else cmd)
    kw.setdefault("encoding", "utf-8")
    return subprocess.run(cmd, check=True, **kw)


def fetch_live_workflow():
    remote_pull = (
        "rm -f /root/_mr_pull.sqlite*; "
        "for f in database.sqlite database.sqlite-wal database.sqlite-shm; do "
        "docker cp n8n-n8n-1:/home/node/.n8n/$f /root/_mr_pull.${f#database.} 2>/dev/null; done; "
        f"sqlite3 -json /root/_mr_pull.sqlite "
        f"\"SELECT id,name,nodes,connections,settings FROM workflow_entity WHERE id='{WORKFLOW_ID}';\""
    )
    out = subprocess.run(SSH + [remote_pull], check=True, capture_output=True, encoding="utf-8").stdout
    return json.loads(out)[0]


def supa_node(orig, params):
    n = {
        "name": orig["name"],
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "parameters": params,
        "credentials": SUPA_CRED,
    }
    for k in ("position", "id", "onError", "alwaysOutputData"):
        if k in orig:
            n[k] = orig[k]
    return n


def patch(row):
    nodes = json.loads(row["nodes"])
    already = [n for n in nodes if "airtable" in n.get("type", "").lower()]
    if not already:
        return None, 0  # nothing to do -- idempotent no-op

    if len(already) != 3 or {n["name"] for n in already} != {"loadProfile", "fetchScores", "logReport"}:
        raise SystemExit(
            f"FATAL: expected exactly loadProfile/fetchScores/logReport as the 3 Airtable "
            f"nodes, found: {[(n['name']) for n in already]} -- workflow changed since this "
            f"script was written, do not proceed blindly"
        )

    converted = 0
    for i, n in enumerate(nodes):
        if "airtable" not in n.get("type", "").lower():
            continue
        name = n["name"]

        if name == "loadProfile":
            params = {
                "operation": "getAll",
                "tableId": "v_clients",
                "returnAll": True,
                "filters": {"conditions": [{"keyName": "active", "condition": "eq", "keyValue": "true"}]},
            }
        elif name == "fetchScores":
            params = {
                "operation": "getAll",
                "tableId": "v_daily_scores_last_31d",
                "returnAll": False,
                "filters": {
                    "conditions": [
                        {
                            "keyName": "client_id",
                            "condition": "eq",
                            # was hardcoded 'client_test' in Airtable -- fixed to the per-item
                            # client_id, matching how every other converted cron sender reads it
                            "keyValue": "={{ ($json.fields ? $json.fields : $json).client_id }}",
                        }
                    ]
                },
            }
        elif name == "logReport":
            params = {
                "operation": "create",
                "tableId": "monthly_reports",
                "fieldsUi": {
                    "fieldValues": [
                        {"fieldId": "client_id", "fieldValue": "={{ $json.client_id }}"},
                        {"fieldId": "month_year", "fieldValue": "={{ $json.month_year }}"},
                        {"fieldId": "monthly_score", "fieldValue": "={{ $json.monthly_score }}"},
                        {"fieldId": "base_score", "fieldValue": "={{ $json.base_score }}"},
                        {"fieldId": "trend_bonus", "fieldValue": "={{ $json.trend_bonus }}"},
                        {"fieldId": "consistency_bonus", "fieldValue": "={{ $json.consistency_bonus }}"},
                        {"fieldId": "pillar_improvement_bonus", "fieldValue": "={{ $json.pillar_improvement_bonus }}"},
                        {"fieldId": "report_sent_sms", "fieldValue": True},
                    ]
                },
            }
        else:
            raise SystemExit(f"FATAL: unexpected Airtable node name '{name}'")

        nodes[i] = supa_node(n, params)
        converted += 1

    remaining = [n for n in nodes if "airtable" in n.get("type", "").lower()]
    if remaining:
        raise SystemExit(f"FATAL: {len(remaining)} Airtable node(s) left unconverted -- aborting")

    wf = {
        "id": row["id"],
        "name": row["name"],
        "nodes": nodes,
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row.get("settings") else {"executionOrder": "v1"},
        "active": False,
    }
    return wf, converted


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
    print(f'  ssh -i {KEY} {HOST} \'docker logs n8n-n8n-1 --tail 60 | grep "Activated workflow \\"Relentless AI - Monthly Report (GHL)"\'')


def main():
    deploy_flag = "--deploy" in sys.argv

    print(f"Snapshotting live {WORKFLOW_ID} before touching it...")
    row = fetch_live_workflow()
    ts_cmd = (
        f"sqlite3 -json /root/_mr_pull.sqlite "
        f"\"SELECT id,name,nodes,connections,settings,active FROM workflow_entity WHERE id='{WORKFLOW_ID}';\" "
        f"> /root/{WORKFLOW_ID}_ROLLBACK_$(date +%Y%m%d_%H%M%S).json"
    )
    subprocess.run(SSH + [ts_cmd], check=True)

    wf, converted = patch(row)
    if wf is None:
        print("  no Airtable nodes found -- already converted, nothing to do")
        return

    print(f"  {converted}/3 nodes converted")

    out_path = os.path.join(os.path.dirname(__file__), f"{WORKFLOW_ID}_supabase_fix.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)
    print(f"  wrote {out_path}")

    if deploy_flag:
        deploy(out_path)
    else:
        print("\nDry run only. Re-run with --deploy to ship it.")
        print("Prerequisite: 006_schema_monthly_reports.sql must be applied in Supabase first.")


if __name__ == "__main__":
    main()
