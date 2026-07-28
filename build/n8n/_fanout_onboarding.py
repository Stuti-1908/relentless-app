#!/usr/bin/env python3
"""Fan out the live GHL 7-Day Onboarding (onboard00001ghl) to ALL active clients.

Reads _onboarding_ghl_LIVE.json (exported from Hetzner), applies the multi-user loop pattern
(same as nudge/EoD), writes _onboarding_ghl_FANOUT.json for import.

Changes:
 1. loadProfile -> filter {active}=1, returnAll:true (was {client_id}='client_test', limit 1).
 2. Insert splitInBatches(1) Loop Over Items after loadProfile.
    - loop output (index 1) -> decide ... -> advanceDay -> back to the loop node.
    - done output (index 0) -> nothing.
 3. decide -> read the CURRENT batch item ($json) instead of $('loadProfile').first(),
    carry ghl_contact_id, and gate send on day-range AND a non-empty ghl_contact_id.
 4. Send node -> contactId from $('decide').item (current iteration), not loadProfile.first().
 5. advanceDay -> $('decide').item instead of $('decide').first().
"""
import json, io, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "_onboarding_ghl_LIVE.json")
OUT = os.path.join(HERE, "_onboarding_ghl_FANOUT.json")

w = json.load(io.open(SRC, encoding="utf-8"))
w = w[0] if isinstance(w, list) else w

NEW_DECIDE = r"""
var pr=$json;var p=pr.fields?pr.fields:pr;
var rid=pr.id||'';
var gcid=(p.ghl_contact_id||'').toString().trim();
var day=Number(p.onboarding_day||0);
var THEMES={
 1:'Day 1 welcome: warmly welcome them to Relentless AI, explain they will get a focused morning briefing and an evening Executive Score daily, and that replying helps it learn. Set the tone: this is a performance edge, not another app to manage.',
 2:'Day 2: explain the Executive Score - a 0-100 read across Body, Focus, Execution, Alignment - and that it is a signal to act on, not a grade.',
 3:'Day 3: explain the real-time nudges and that a quick reply (even one word) sharpens future coaching.',
 4:'Day 4: encourage them to log their morning recovery/energy so the briefing calibrates intensity to their real capacity.',
 5:'Day 5 midpoint: check in - what is working, what feels off - and remind them consistency over intensity wins.',
 6:'Day 6: reinforce one habit that is sticking and tie it to their 12-month goal.',
 7:'Day 7 mini-report: celebrate the first week, summarize the value, and invite one piece of feedback on what would make this more useful.'
};
if(!(day>=1&&day<=7)||!gcid){return [{json:{send:false,rid:rid,ghl_contact_id:gcid,reason:(gcid?('onboarding complete or not started (day='+day+')'):'no ghl_contact_id')}}];}
var sys=['You are onboarding '+(p.full_name||'a new client')+' ('+(p.business_stage||'growing')+' stage) to Relentless AI executive coaching.',
 THEMES[day],
 'Write ONE warm, concise plain-text SMS under 280 chars, no emojis. Sound like a sharp human coach, not marketing.'].join('\n');
return [{json:{send:true,rid:rid,ghl_contact_id:gcid,onboarding_day:day,next_day:day+1,
  body:{model:'claude-sonnet-4-6',max_tokens:250,system:sys,messages:[{role:'user',content:'Write the day '+day+' onboarding message.'}]}}}];
"""

LOOP_NODE = {
    "id": "ob-loop", "name": "Loop Over Clients", "type": "n8n-nodes-base.splitInBatches",
    "typeVersion": 3, "position": [60, -40], "parameters": {"batchSize": 1, "options": {}},
}

for n in w["nodes"]:
    nm = n["name"]; p = n.setdefault("parameters", {})
    if nm == "loadProfile":
        p["filterByFormula"] = "={{ \"{active}=1\" }}"
        p["returnAll"] = True
        p.pop("limit", None)
    elif nm == "decide":
        p["jsCode"] = NEW_DECIDE
    elif nm == "Send an SMS/MMS/WhatsApp message":
        p["jsonBody"] = "={{ JSON.stringify({ type:'SMS', contactId: $('decide').item.json.ghl_contact_id, message: ($json.sms) }) }}"
    elif nm == "advanceDay":
        v = p["columns"]["value"]
        v["id"] = "={{ $('decide').item.json.rid }}"
        v["onboarding_day"] = "={{ $('decide').item.json.next_day }}"

# insert loop node
if not any(n["name"] == "Loop Over Clients" for n in w["nodes"]):
    w["nodes"].append(LOOP_NODE)

# rewire: loadProfile -> loop ; loop(index1 loop) -> decide ; advanceDay -> loop (loop-back)
c = w["connections"]
c["loadProfile"] = {"main": [[{"node": "Loop Over Clients", "type": "main", "index": 0}]]}
# splitInBatches: output 0 = done, output 1 = loop
c["Loop Over Clients"] = {"main": [[], [{"node": "decide", "type": "main", "index": 0}]]}
# advanceDay loops back into the batch node
c["advanceDay"] = {"main": [[{"node": "Loop Over Clients", "type": "main", "index": 0}]]}
# IsSend false-branch must also return to the loop so skipped clients still advance the batch
c["IsSend"] = {"main": [[{"node": "callClaude", "type": "main", "index": 0}],
                        [{"node": "Loop Over Clients", "type": "main", "index": 0}]]}

w["active"] = False  # import deactivates anyway; reactivate by id after
json.dump(w, io.open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", OUT, "| nodes:", len(w["nodes"]))
print("loadProfile filter:", [n["parameters"].get("filterByFormula") for n in w["nodes"] if n["name"] == "loadProfile"])
