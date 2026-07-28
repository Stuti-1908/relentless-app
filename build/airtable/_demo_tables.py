#!/usr/bin/env python3
"""
_demo_tables.py — inspect the client_test base and create any tables missing for the
Pro + War Room demo (tbl_business_health, tbl_war_room_sessions, tbl_monthly_reports).

Reads the Airtable PAT from relentless-web/.env.local (never prints it). The PAT needs
schema.bases:write granted to the client_test base. Idempotent: skips tables that exist.

Usage:
    python _demo_tables.py            # list + create missing
    python _demo_tables.py --list     # just list existing tables
"""
import os, sys, json, re, urllib.request, urllib.error

BASE_ID = "appjnWxg9sB3PV7Da"  # Relentless AI - client_test
ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "relentless-web", ".env.local")
META = "https://api.airtable.com/v0/meta/bases/" + BASE_ID + "/tables"


def load_token():
    """Pull the first Airtable PAT-looking token from .env.local without echoing it."""
    if not os.path.exists(ENV_PATH):
        sys.exit("Cannot find " + ENV_PATH)
    with open(ENV_PATH, encoding="utf-8") as f:
        text = f.read()
    # prefer an explicit schema-write token if named; else any AIRTABLE token var
    candidates = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if "AIRTABLE" in k.upper() and ("TOKEN" in k.upper() or "PAT" in k.upper() or "KEY" in k.upper()):
            candidates.append((k.strip(), v))
    if not candidates:
        sys.exit("No AIRTABLE token var found in .env.local")
    # Use the one most likely to have write scope (the web app's read+write token).
    return candidates[0][1]


def api(method, url, token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


# ---- field helpers ----
def T(n): return {"name": n, "type": "singleLineText"}
def L(n): return {"name": n, "type": "multilineText"}
def N(n): return {"name": n, "type": "number", "options": {"precision": 2}}
def C(n): return {"name": n, "type": "checkbox", "options": {"icon": "check", "color": "greenBright"}}
def D(n): return {"name": n, "type": "date", "options": {"dateFormat": {"name": "iso"}}}
def DT(n): return {"name": n, "type": "dateTime", "options": {"dateFormat": {"name": "iso"}, "timeFormat": {"name": "24hour"}, "timeZone": "utc"}}
def SEL(n, *c): return {"name": n, "type": "singleSelect", "options": {"choices": [{"name": x} for x in c]}}

WAR_ROOM = {"name": "tbl_war_room_sessions", "fields": [
    T("session_id"), T("client_id"), DT("session_date"),
    SEL("session_type", "problem_solving", "opportunity_mapping", "strategic_review"),
    N("duration_minutes"), L("focus_topic"), L("transcript_json"),
    L("decompose_output"), L("solve_output"), L("verify_output"),
    L("synthesize_output"), L("reflect_output"),
    N("final_confidence"), C("low_confidence_flag"),
    L("committed_action"), D("action_due_date"), C("action_completed"),
    C("follow_up_sent"), C("recurring_theme_detected"), N("session_rating"),
]}

BUSINESS_HEALTH = {"name": "tbl_business_health", "fields": [
    T("client_id"), D("week_start_date"),
    SEL("cash_position", "on_track", "tight", "critical"), L("biggest_risk"),
    SEL("team_health", "strong", "some_issues", "serious_problem", "solo"),
    L("market_changes"), L("avoided_decision"),
    SEL("risk_deliberate", "deliberate", "unexpected"),
    N("capital_score"), N("risk_score"), C("checkin_completed"), L("claude_analysis"),
    # extra fields the Pro EoD reads by name (severity/manageability/stage/date/capital_base)
    N("severity"), N("manageability"), SEL("stage", "launching", "growing", "operating"),
    D("date"), N("capital_base"), SEL("deliberate", "deliberate", "unexpected"),
]}

WANT = [WAR_ROOM, BUSINESS_HEALTH]


def main():
    token = load_token()
    status, data = api("GET", META, token)
    if status != 200:
        print("List failed:", status, data)
        if status in (401, 403):
            print(">> The token in .env.local lacks schema.bases:write on this base.")
            print(">> Fix: in Airtable > Builder hub > Personal access tokens, add the")
            print(">> 'schema.bases:write' scope and grant the token to the client_test base.")
        sys.exit(1)

    existing = {t["name"]: t for t in data.get("tables", [])}
    print("Existing tables (" + str(len(existing)) + "):")
    for n in sorted(existing):
        print("   -", n)

    if "--list" in sys.argv:
        return

    for spec in WANT:
        if spec["name"] in existing:
            print("SKIP (exists):", spec["name"])
            continue
        print("CREATE:", spec["name"], "...")
        st, resp = api("POST", META, token, {"name": spec["name"], "fields": spec["fields"]})
        if st == 200:
            print("   OK ->", resp.get("id"))
        else:
            print("   FAIL", st, json.dumps(resp)[:300])


if __name__ == "__main__":
    main()
