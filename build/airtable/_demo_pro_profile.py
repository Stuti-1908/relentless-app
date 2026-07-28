#!/usr/bin/env python3
"""
_demo_pro_profile.py — create (idempotent) a dedicated PRO demo client profile so the War Room +
Pro 6-pillar demo works WITHOUT touching the live client_test record. New row in tbl_client_profile:
  client_id=demo_pro, plan=pro, phone_number=+15551239999.
Also seeds one tbl_business_health row so the Pro EoD shows real Capital/Risk.
Reads the Airtable PAT from relentless-web/.env.local (never prints it).
"""
import os, sys, json, urllib.request, urllib.error

BASE_ID = "appjnWxg9sB3PV7Da"
ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "relentless-web", ".env.local")
DEMO_PHONE = "+15551239999"
DEMO_CID = "demo_pro"


def token():
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if "AIRTABLE" in k.upper() and ("TOKEN" in k.upper() or "PAT" in k.upper() or "KEY" in k.upper()):
                return v.strip().strip('"').strip("'")
    sys.exit("no token in .env.local")


def api(method, url, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + tok)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def find(tok, table, formula):
    import urllib.parse
    url = "https://api.airtable.com/v0/" + BASE_ID + "/" + urllib.parse.quote(table) + "?filterByFormula=" + urllib.parse.quote(formula) + "&maxRecords=1"
    st, d = api("GET", url, tok)
    return (d.get("records") or []) if st == 200 else []


def main():
    tok = token()

    # 1. profile
    existing = find(tok, "tbl_client_profile", "{client_id}='" + DEMO_CID + "'")
    if existing:
        print("profile exists:", existing[0]["id"])
    else:
        st, d = api("POST", "https://api.airtable.com/v0/" + BASE_ID + "/tbl_client_profile", tok,
                    {"fields": {"client_id": DEMO_CID, "full_name": "Demo CEO", "plan": "pro",
                                "phone_number": DEMO_PHONE, "business_stage": "growing",
                                "twelve_month_goal": "Hit $5M ARR and a repeatable sales motion",
                                "top_priority_1": "Close the enterprise pilot",
                                "top_priority_2": "Ship onboarding v2",
                                "top_priority_3": "Hire a VP Sales", "active": True},
                     "typecast": True})
        print("profile create:", st, d.get("id", d))

    # 2. business_health row (feeds Capital/Risk)
    bh = find(tok, "tbl_business_health", "{client_id}='" + DEMO_CID + "'")
    if bh:
        print("business_health exists:", bh[0]["id"])
    else:
        st, d = api("POST", "https://api.airtable.com/v0/" + BASE_ID + "/tbl_business_health", tok,
                    {"fields": {"client_id": DEMO_CID, "cash_position": "on_track", "stage": "growing",
                                "capital_base": 70, "severity": 20, "manageability": 80,
                                "biggest_risk": "Key-man dependency on the founder for sales",
                                "checkin_completed": True}, "typecast": True})
        print("business_health create:", st, d.get("id", d))


if __name__ == "__main__":
    main()
