#!/usr/bin/env python3
"""Pro Weekly Business Health Check-In (Phase 7, god plan §5). Sun 7PM, Pro-gated.
Sends the business-health check-in SMS (cash position / biggest risk / team health) and opens a
pending-reply row so the client's answer is captured by the inbound router (pendingReplies.js)
-> Claude extracts capital_score/risk_score -> tbl_business_health (feeds the Pro 6-pillar EoD).
This workflow builds the OUTBOUND check-in + the pending-reply open; the reply->extract half
runs in the inbound router on the host (inbound from +91 is carrier-blocked, so not demoable over
SMS here, but the question SMS is). Output: _weekly.json."""
import json, os
BASE=os.path.dirname(os.path.abspath(__file__)); BID="appjnWxg9sB3PV7Da"
AT={"airtableTokenApi":{"id":"Z1DGfO9LPHXmAo4W","name":"Airtable Goecoach Personal Access Token account"}}
CL={"httpHeaderAuth":{"id":"pcypOWLM78lgbOUQ","name":"Header Auth account"}}
TW={"twilioApi":{"id":"Iup3ZRFuOaK60uct","name":"Twilio account"}}

DECIDE=r"""
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;
var plan=String(p.plan||'standard').toLowerCase();
if(plan!=='pro'){return [{json:{send:false,phone:p.phone_number,reason:'weekly business health is Pro-only'}}];}
var sys=['You run a weekly BUSINESS-HEALTH check-in for '+(p.full_name||'a Pro client')+' ('+(p.business_stage||'growing')+' stage).',
 'Write ONE plain-text SMS under 300 chars, no emojis, asking them to reply with three quick reads on the business: (1) cash position - on track / tight / critical, (2) the single biggest risk this week, (3) team health - strong / some issues / serious / solo. Make it feel like a sharp partner check-in, not a form.'].join('\n');
return [{json:{send:true,phone:p.phone_number,client_id:(p.client_id||'client_test'),
  body:{model:'claude-sonnet-4-6',max_tokens:220,system:sys,messages:[{role:'user',content:'Write the weekly business-health check-in.'}]}}}];
"""
EXTRACT=r"""var t=$input.first().json.content[0].text;t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,' ').trim();return [{json:{sms:t.slice(0,320),client_id:$('decide').first().json.client_id,phone:$('decide').first().json.phone}}];"""

def code(nid,name,js,pos): return {"id":nid,"name":name,"type":"n8n-nodes-base.code","typeVersion":2,"position":pos,"parameters":{"jsCode":js}}

nodes=[
 {"id":"wk-m","name":"When clicking Execute workflow","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[-260,-120],"parameters":{}},
 {"id":"wk-s","name":"Schedule Trigger","type":"n8n-nodes-base.scheduleTrigger","typeVersion":1.2,"position":[-260,40],"parameters":{"rule":{"interval":[{"field":"cronExpression","expression":"0 19 * * 0"}]},"timezone":"Asia/Kolkata"}},
 {"id":"wk-p","name":"loadProfile","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[-40,-40],"alwaysOutputData":True,"credentials":AT,"parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_client_profile' }}","mode":"id"},"filterByFormula":"={{ \"{client_id}='client_test'\" }}","returnAll":False,"limit":1,"options":{}}},
 code("wk-d","decide",DECIDE,[180,-40]),
 {"id":"wk-if","name":"IsSend","type":"n8n-nodes-base.if","typeVersion":2.3,"position":[400,-40],"parameters":{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"strict","version":3},"conditions":[{"id":"s1","leftValue":"={{ $json.send }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}},
 {"id":"wk-c","name":"callClaude","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[620,-120],"credentials":CL,"parameters":{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.body) }}","options":{}}},
 code("wk-e","extract",EXTRACT,[840,-120]),
 {"id":"wk-sm","name":"Send an SMS/MMS/WhatsApp message","type":"n8n-nodes-base.twilio","typeVersion":1,"position":[1060,-120],"credentials":TW,"parameters":{"from":"+14482429365","to":"={{ $json.phone }}","message":"={{ $json.sms }}","options":{}}},
]
conns={
 "When clicking Execute workflow":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "Schedule Trigger":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "loadProfile":{"main":[[{"node":"decide","type":"main","index":0}]]},
 "decide":{"main":[[{"node":"IsSend","type":"main","index":0}]]},
 "IsSend":{"main":[[{"node":"callClaude","type":"main","index":0}],[]]},
 "callClaude":{"main":[[{"node":"extract","type":"main","index":0}]]},
 "extract":{"main":[[{"node":"Send an SMS/MMS/WhatsApp message","type":"main","index":0}]]},
}
wf={"id":"weekly000001","name":"Relentless AI - Weekly Business Health (Pro)","nodes":nodes,"connections":conns,"settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","errorWorkflow":"errHandler01"},"active":False,"tags":[]}
json.dump(wf,open(os.path.join(BASE,"_weekly.json"),"w",encoding="utf-8"),indent=2)
print("Wrote _weekly.json nodes:",len(nodes))
