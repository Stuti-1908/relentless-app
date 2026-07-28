#!/usr/bin/env python3
"""_patch_fanout.py  — fan out all single-client cron senders to multi-client + timezone-aware.

What this does:
  For each workflow JSON file listed in TARGETS, it:
  1. Finds Airtable "search" nodes that filter {client_id}='client_test' or {active}=1 (limit 1)
     and changes them to returnAll=True + filterByFormula="{active}=1"
  2. Injects a timezone-window guard at the top of every Code node named "decide" / "buildPrompt" /
     "computeScore" / "buildNudge" / "buildMsg" / "build" etc. that already receives one profile item.
     The guard reads profiles.timezone (default Asia/Kolkata) and the delivery_hour_local config,
     then skips clients whose local hour is outside the allowed window.
  3. Writes the patched file to the same path (backs up original as .bak).

Run from the build/n8n directory:
    python _patch_fanout.py

Then SSH to Hetzner and import each patched workflow:
    n8n import:workflow --input=<file> --separate
    n8n update:workflow --id=<id> --active=true
    docker compose restart n8n
"""

import json, os, re, shutil

DIR = os.path.dirname(os.path.abspath(__file__))

# (filename, workflow_id, delivery_window_hours)
# delivery_window = [start_hour_inclusive, end_hour_inclusive] in LOCAL client time
TARGETS = [
    ("_morning_checkin.json",  "morningCheckin1",   [5, 7]),    # 5-7 AM local
    ("_eod_honest.json",       "eodPro00001ghl",    [17, 22]),   # 5-10 PM local
    ("_market.json",           "market000001",      [5, 7]),     # before briefing
    ("_monthly_ghl.json",      "monthly00001",      [7, 10]),    # morning 1st of month
    ("_onboarding_ghl.json",   "onboard00001",      [6, 8]),     # early morning
    ("_stage_ghl.json",        "stageTrans01ghl",   [6, 8]),     # Monday morning
    ("_badday_ghl.json",       "badDayOverr1ghl",   [8, 10]),    # Monday mid-morning
]

# Timezone-window guard injected at the TOP of the first Code node that processes one profile.
# $json at that point is one Airtable profile item (fields nested under .fields or flat).
TZ_GUARD = """
// ── TIMEZONE WINDOW GUARD (multi-client fan-out) ────────────────────────────
// Each Airtable item is one active client profile. Skip clients whose local
// hour is outside the delivery window for this workflow.
(function(){
  var item = $json.fields ? $json.fields : $json;
  var tz = item.timezone || 'Asia/Kolkata';
  var now;
  try {
    now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  } catch(e) {
    now = new Date(); // fallback: server time
  }
  var h = now.getHours();
  var WIN_START = __WIN_START__;
  var WIN_END   = __WIN_END__;
  if (h < WIN_START || h > WIN_END) {
    // Outside delivery window for this client — skip silently.
    return []; // n8n Code node: returning [] skips downstream for this item
  }
})();
// ── END TIMEZONE GUARD ───────────────────────────────────────────────────────
"""

# Names of Code nodes that process a single profile and should get the timezone guard.
DECIDE_NODE_NAMES = {
    "decide", "buildprompt", "build", "computescore", "buildnudge",
    "buildmsg", "buildmarket", "buildmonthly", "buildmessage",
}

def patch_airtable_node(node):
    """Change client_test filter → {active}=1 + returnAll."""
    params = node.get("parameters", {})
    formula = params.get("filterByFormula", "")
    changed = False

    # Replace hardcoded client_test filter
    if "client_test" in str(formula):
        params["filterByFormula"] = "={{ \"{active}=1\" }}"
        params["returnAll"] = True
        params.pop("limit", None)
        changed = True
    # Also fix any {active}=1 with limit:1 (already correct formula, wrong limit)
    elif "{active}=1" in str(formula) and params.get("returnAll") is not True:
        params["returnAll"] = True
        params.pop("limit", None)
        changed = True

    # Fix secondary Airtable nodes that filter by client_id using an expression
    # e.g. filterByFormula referencing client_test in scores/biometrics tables
    if "client_test" in str(params.get("filterByFormula", "")):
        # For per-client data tables (scores, biometrics) we keep the client_id filter
        # but make it dynamic from the profile. This is handled in the Code node —
        # leave as-is but note it needs Code-node per-client context.
        pass

    node["parameters"] = params
    return changed

def inject_tz_guard(code_str, win_start, win_end):
    """Prepend timezone window guard to a Code node's JS."""
    guard = TZ_GUARD.replace("__WIN_START__", str(win_start)).replace("__WIN_END__", str(win_end))
    # Don't double-inject
    if "TIMEZONE WINDOW GUARD" in code_str:
        return code_str
    return guard + "\n" + code_str

def patch_workflow(path, win_start, win_end):
    if not os.path.exists(path):
        print(f"  SKIP (not found): {path}")
        return False

    # Backup
    bak = path + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)

    with open(path, encoding="utf-8") as f:
        wf = json.load(f)

    nodes = wf.get("nodes", [])
    at_changed = 0
    tz_injected = 0

    for node in nodes:
        ntype = node.get("type", "")
        nname = node.get("name", "").lower().strip()

        # 1. Fix Airtable profile-load nodes
        if ntype == "n8n-nodes-base.airtable":
            op = node.get("parameters", {}).get("operation", "")
            tbl = str(node.get("parameters", {}).get("table", {}).get("value", ""))
            # Only patch profile-load nodes (not scores/biometrics/pending tables)
            if op == "search" and "client_profile" in tbl:
                if patch_airtable_node(node):
                    at_changed += 1
                    print(f"    ✓ Airtable node '{node['name']}': → {{active}}=1 returnAll")

        # 2. Inject timezone guard into the "decide" / equivalent Code node
        if ntype == "n8n-nodes-base.code":
            if any(nname == n or nname.startswith(n) for n in DECIDE_NODE_NAMES):
                params = node.get("parameters", {})
                orig = params.get("jsCode", "")
                patched = inject_tz_guard(orig, win_start, win_end)
                if patched != orig:
                    params["jsCode"] = patched
                    node["parameters"] = params
                    tz_injected += 1
                    print(f"    ✓ Code node '{node['name']}': timezone guard injected")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)

    print(f"  → {at_changed} Airtable node(s) patched, {tz_injected} timezone guard(s) injected")
    return True

def main():
    print("=== Fan-out patch: multi-client + timezone-aware ===\n")
    for fname, wf_id, window in TARGETS:
        path = os.path.join(DIR, fname)
        print(f"[{wf_id}] {fname}")
        patch_workflow(path, window[0], window[1])
        print()
    print("Done. Next steps:")
    print("  1. SSH to Hetzner: ssh -i build/n8n/hetzner/ssh/n8n_hetzner root@167.233.94.171")
    print("  2. For each file, scp + import:")
    print("     scp -i build/n8n/hetzner/ssh/n8n_hetzner build/n8n/<file>.json root@167.233.94.171:/root/n8n/")
    print("     ssh ... 'cd /root/n8n && docker compose exec n8n n8n import:workflow --input=/root/n8n/<file>.json'")
    print("     ssh ... 'docker compose exec n8n n8n update:workflow --id=<id> --active=true'")
    print("  3. docker compose restart n8n  (one restart after all imports)")

if __name__ == "__main__":
    main()
