#!/usr/bin/env python3
"""
_add_status_callback.py
Patches the StatusCallback URL into every Twilio SMS send node across
the 4 production sender workflows (briefing, EoD, nudge, feedback).

Run AFTER importing status_callback_wf.json and confirming the webhook
URL is live. Update CALLBACK_URL below to your public n8n address.

Usage:
    python3 _add_status_callback.py
Then import each patched JSON via n8n UI > Settings > Import workflow.
"""

import json, copy, os

# ── CONFIG ────────────────────────────────────────────────────────────────────
# Change this to your public URL when you move to Render / Hetzner.
CALLBACK_URL = "https://boxy-capable-swiftly.ngrok-free.app/webhook/twilio-status"

# Workflow IDs → source JSON files (export fresh from n8n first if needed)
WORKFLOWS = {
    "D6u7ItI5CjwOlW75": "briefing_intensity.json",   # Morning Briefing
    "ZgR4RSOdn86JsfjV": "_eod_focus_real.json",       # End-of-Day Score
    "0EAKsIekNAOKYmQH": None,                         # Nudge Engine  – export first
    "xRaDYtW7kySPKQjO": None,                         # Feedback Question – export first
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def patch_workflow(src_path, wf_id):
    with open(src_path, encoding="utf-8") as f:
        data = json.load(f)

    wf = data if isinstance(data, dict) else data[0]
    nodes = wf.get("nodes", [])
    patched = 0

    for node in nodes:
        if node.get("type") == "n8n-nodes-base.twilio":
            params = node.setdefault("parameters", {})
            opts   = params.setdefault("options", {})
            if opts.get("statusCallback") != CALLBACK_URL:
                opts["statusCallback"] = CALLBACK_URL
                patched += 1
                print(f"  ✓ Patched node '{node.get('name')}' in {os.path.basename(src_path)}")

    if patched == 0:
        print(f"  ⚠ No Twilio nodes found / already patched in {os.path.basename(src_path)}")
        return None

    out_name = os.path.basename(src_path).replace(".json", "_statuscb.json")
    out_path = os.path.join(BASE_DIR, out_name)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2)
    print(f"  → Saved to {out_name}")
    return out_path

def main():
    print(f"\nStatusCallback URL: {CALLBACK_URL}\n")
    for wf_id, filename in WORKFLOWS.items():
        if filename is None:
            print(f"SKIP {wf_id} — no source file (export it from n8n first: n8n export:workflow --id={wf_id} --output=<file>.json)")
            continue
        src = os.path.join(BASE_DIR, filename)
        if not os.path.exists(src):
            print(f"SKIP {wf_id} — file not found: {src}")
            continue
        print(f"Patching {wf_id} ({filename}) ...")
        patch_workflow(src, wf_id)

    print("\nDone. Import each *_statuscb.json into n8n:")
    print("  n8n UI > ⋮ menu > Import workflow > select the file")
    print("  Then toggle Active ON for each workflow.\n")

if __name__ == "__main__":
    main()
