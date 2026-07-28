#!/usr/bin/env python3
"""_convert_ghl.py — convert a sender workflow from Twilio SMS to GoHighLevel SMS.

Replaces the `n8n-nodes-base.twilio` send node with an HTTP Request node that POSTs to GHL
conversations/messages ({type:SMS, contactId, message}). contactId comes from the client's
`ghl_contact_id` on tbl_client_profile (loaded by the workflow's profile node). Auth uses the
existing n8n Header Auth credential "GHL Relentless" (Authorization: Bearer <pit token>) + adds
the GHL Version header. Output: <name>_ghl.json (keeps the node name so connections are preserved).

Usage: python _convert_ghl.py <sender.json> [<sender2.json> ...]
"""
import json, os, sys

GHL_CRED = {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "GHL Relentless"}}

def profile_node_name(wf):
    # prefer an explicit profile loader; else the first Airtable node hitting tbl_client_profile
    names = [n["name"] for n in wf["nodes"]]
    for pref in ("loadProfile", "Search records"):
        if pref in names:
            return pref
    for n in wf["nodes"]:
        if n.get("type") == "n8n-nodes-base.airtable":
            tv = json.dumps(n.get("parameters", {}).get("table", {}))
            if "tbl_client_profile" in tv:
                return n["name"]
    return "loadProfile"

def convert(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    wf = data if isinstance(data, dict) else data[0]
    pnode = profile_node_name(wf)
    contact_expr = "={{ ($('%s').first().json.fields || $('%s').first().json).ghl_contact_id }}" % (pnode, pnode)

    converted = 0
    for n in wf["nodes"]:
        if n.get("type") == "n8n-nodes-base.twilio":
            msg = n.get("parameters", {}).get("message", "={{ $json.sms }}")
            n["type"] = "n8n-nodes-base.httpRequest"
            n["typeVersion"] = 4.2
            n["credentials"] = GHL_CRED
            n["onError"] = "continueRegularOutput"
            n["parameters"] = {
                "method": "POST",
                "url": "https://services.leadconnectorhq.com/conversations/messages",
                "authentication": "genericCredentialType",
                "genericAuthType": "httpHeaderAuth",
                "sendHeaders": True,
                "headerParameters": {"parameters": [
                    {"name": "Version", "value": "2021-04-15"},
                    {"name": "Content-Type", "value": "application/json"},
                ]},
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify({ type:'SMS', contactId: (%s), message: (%s) }) }}"
                    % (contact_expr.replace("={{ ", "").replace(" }}", ""), msg.replace("={{ ", "").replace(" }}", "")),
                "options": {},
            }
            converted += 1

    if not converted:
        print("  no Twilio node in", os.path.basename(path)); return None
    out = path.replace(".json", "_ghl.json")
    wf["id"] = (wf.get("id", "wf") + "ghl")[:16]
    wf["name"] = wf.get("name", "wf") + " (GHL)"
    wf["active"] = False
    with open(out, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2)
    print(f"  converted {converted} send node(s) -> {os.path.basename(out)}  (profile node: {pnode})")
    return out

if __name__ == "__main__":
    for p in sys.argv[1:]:
        print("Converting", os.path.basename(p))
        convert(p)
