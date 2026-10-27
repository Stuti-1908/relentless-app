"""Patch 7 (2026-10-27): honour the client's dashboard notification settings (client_profile.notification_prefs,
migration 012, exposed through v_clients). A missing key means ON, so nothing changes until a client opts out.

Two mechanisms, chosen so an opt-out never deletes dashboard data or stalls a loop:
  A. prefFilter  - an IF node right after the client-list node drops opted-out clients BEFORE any Claude call or
                   DB write (nudges, weekly, weekly plan, onboarding, monthly, morning check-in). Nodes that read the
                   whole client list ($('loadProfile').all()/.item) are re-pointed at prefFilter so they cannot
                   resurrect a dropped client.
  B. prefGate    - toChannel now emits `suppressed`; an IF node between toChannel and the send node routes suppressed
                   items past the send but into the same bookkeeping the send would have fed (so the evening score is
                   still computed and saved, reminders are still marked sent, loops keep iterating):
                   briefing, evening score, meeting + recurring reminders, weekly synthesis.
Replies to a client's own messages (ghlInboundV1) are never suppressed.
toChannel now selects * from v_clients so it keeps working before migration 012 is applied (prefs just read as empty).
Base: patched6.json. Output: patched7.json
"""
import json, re, uuid

w6 = json.load(open("patched6.json", encoding="utf-8"))
out = w6  # patch 7 is a superset of patch 6; deploy only patched7.json

# kind of each toChannel -> preference key (None = never suppressed)
CAT = {"morningCheckin1": "morning_checkin", "briefBuilder1": "morning_briefing", "nudgeEngineGhl1": "nudges",
       "eodPro00001ghl": "evening_score", "weekly000001ghl": "weekly", "stageTrans01ghl": "weekly",
       "onboard00001ghl": "onboarding", "monthly00001ghl": "monthly_report", "recurReminder1": "task_reminders",
       "meetReminder1": "meeting_reminders", "weeklySynth1": "weekly", "ghlInboundV1": None}


def node(w, name):
    m = [n for n in w["nodes"] if n["name"] == name]
    assert len(m) == 1, name
    return m[0]


def if_node(name, expr, pos):
    return {"id": str(uuid.uuid4()), "name": name, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": pos,
            "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                                          "conditions": [{"id": str(uuid.uuid4()), "leftValue": expr, "rightValue": "",
                                                          "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                                          "combinator": "and"}, "options": {}}}


def tgt(n):
    return {"node": n, "type": "main", "index": 0}


# ---- 1. toChannel: read prefs, emit `suppressed` -------------------------------------------------------------
OLD_SEL = "select=client_id,full_name,phone_number,email,delivery_channel&limit=1"
OLD_RET_TAIL = "channel_reason: channel_reason }) };"
for wid, cat in CAT.items():
    w = out[wid]
    tc = node(w, "toChannel")
    c = tc["parameters"]["jsCode"]
    assert c.count(OLD_SEL) == 1 and c.count(OLD_RET_TAIL) == 1, wid
    c = c.replace(OLD_SEL, "select=*&limit=1")
    prefs_js = (
        "const PREF_KEY = " + json.dumps(cat or "") + ";\n"
        "const prefs = (c && c.notification_prefs && typeof c.notification_prefs === 'object') ? c.notification_prefs : {};\n"
        "const suppressed = !!PREF_KEY && (prefs.paused === true || prefs[PREF_KEY] === false);\n"
        "const briefing_on = prefs.paused !== true && prefs.morning_briefing !== false;\n"
    )
    idx = c.index("const channel_reason =")
    c = c[:idx] + prefs_js + c[idx:]
    c = c.replace(OLD_RET_TAIL, "channel_reason: suppressed ? ('suppressed:' + PREF_KEY) : channel_reason, suppressed: suppressed, briefing_on: briefing_on }) };")
    tc["parameters"]["jsCode"] = c

# ---- 2. mechanism A: prefFilter after the client-list node ---------------------------------------------------
def not_opted_out(cond):
    return "={{ (() => { const p = $json.notification_prefs || {}; return !(p.paused === true || " + cond + "); })() }}"


FILTERS = {  # wid: (client-list node, "opted-out" JS condition)
    "nudgeEngineGhl1": ("loadProfile", "p.nudges === false"),
    "weekly000001ghl": ("loadProfile", "p.weekly === false"),
    "stageTrans01ghl": ("loadProfile", "p.weekly === false"),
    "onboard00001ghl": ("loadProfile", "p.onboarding === false"),
    "monthly00001ghl": ("loadProfile", "p.monthly_report === false"),
    "morningCheckin1": ("loadProfile", "(p.morning_checkin === false && p.morning_briefing === false)"),
}
for wid, (src, cond) in FILTERS.items():
    w = out[wid]
    s = node(w, src)
    f = if_node("prefFilter", not_opted_out(cond), [s["position"][0] + 110, s["position"][1] + 160])
    w["nodes"].append(f)
    old = w["connections"][src]["main"][0]
    w["connections"]["prefFilter"] = {"main": [old, []]}
    w["connections"][src]["main"][0] = [tgt("prefFilter")]
    for n in w["nodes"]:  # whole-list / paired references must see only the surviving clients
        if n["name"] in (src, "prefFilter"):
            continue
        for k, v in list(n["parameters"].items()):
            blob = json.dumps(v)
            if "$('%s')" % src in blob:
                n["parameters"][k] = json.loads(blob.replace("$('%s')" % src, "$('prefFilter')"))

# ---- 3. mechanism B: prefGate between toChannel and the send node ---------------------------------------------
GATES = {  # wid: skip targets for a suppressed item
    "briefBuilder1": [],
    "eodPro00001ghl": ["Loop Over Clients"],
    "recurReminder1": ["markReminded"],
    "meetReminder1": ["markSent"],
    "weeklySynth1": [],
    "morningCheckin1": ["briefingOn"],  # check-in off but briefing on: still open the pending reply so the 7AM fallback builds the briefing
}
for wid, skip in GATES.items():
    w = out[wid]
    tc = node(w, "toChannel")
    send = w["connections"]["toChannel"]["main"][0][0]["node"]
    g = if_node("prefGate", "={{ $json.suppressed !== true }}", [tc["position"][0] + 130, tc["position"][1]])
    w["nodes"].append(g)
    w["connections"]["toChannel"]["main"][0] = [tgt("prefGate")]
    w["connections"]["prefGate"] = {"main": [[tgt(send)], [tgt(t) for t in skip]]}
    if wid == "morningCheckin1":
        b = if_node("briefingOn", "={{ $json.briefing_on === true }}", [tc["position"][0] + 260, tc["position"][1] + 140])
        w["nodes"].append(b)
        w["connections"]["briefingOn"] = {"main": [[tgt("openConversation")], []]}

# ---- 4. sanity -----------------------------------------------------------------------------------------------
for wid, w in out.items():
    names = {n["name"] for n in w["nodes"]}
    for s, cc in w["connections"].items():
        assert s in names, (wid, s)
        for br in cc.get("main", []):
            for t in br or []:
                assert t["node"] in names, (wid, t["node"])
    assert len(names) == len(w["nodes"]), wid
    for n in w["nodes"]:
        assert "process.env" not in n.get("parameters", {}).get("jsCode", ""), (wid, n["name"])

json.dump(out, open("patched7.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("patched7:", ", ".join(out))
