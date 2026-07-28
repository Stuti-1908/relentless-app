#!/usr/bin/env python3
"""Set the client_test profile phone_number to the operator's number so the live senders
deliver to it for verification. User-authorized 2026-06-18. Reads PAT from .env.local."""
import os, sys, json, urllib.parse, urllib.request, urllib.error

BASE_ID = "appjnWxg9sB3PV7Da"
ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "relentless-web", ".env.local")
PHONE = "+916355046464"

def token():
    with open(ENV, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or "=" not in line: continue
            k, v = line.split("=", 1)
            if "AIRTABLE" in k.upper() and ("TOKEN" in k.upper() or "PAT" in k.upper() or "KEY" in k.upper()):
                return v.strip().strip('"').strip("'")
    sys.exit("no token")

def api(method, url, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + tok); req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read().decode() or "{}")

def main():
    tok = token()
    url = "https://api.airtable.com/v0/" + BASE_ID + "/tbl_client_profile?filterByFormula=" + urllib.parse.quote("{client_id}='client_test'") + "&maxRecords=1"
    st, d = api("GET", url, tok)
    recs = d.get("records", []) if st == 200 else []
    if not recs: sys.exit("client_test profile not found: " + str(d))
    rid = recs[0]["id"]; cur = recs[0]["fields"].get("phone_number")
    print("current phone_number:", cur)
    st2, d2 = api("PATCH", "https://api.airtable.com/v0/" + BASE_ID + "/tbl_client_profile/" + rid, tok,
                  {"fields": {"phone_number": PHONE}, "typecast": True})
    print("update:", st2, "->", d2.get("fields", {}).get("phone_number") if st2 == 200 else d2)

if __name__ == "__main__":
    main()
