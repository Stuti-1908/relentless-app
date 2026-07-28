#!/usr/bin/env python3
"""_build_morning_checkin.py -> _morning_checkin.json

Phase 2: the 6:00 AM Morning Check-in (id morningCheckin1). Step 1 of the 2-step morning: a warm,
personal good-morning that asks the client to reply with sleep / energy / stress (1-5 each) in a
parseable format. Opens a `morning_checkin` conversation; the GHL router matches the reply, stores
the reads, and triggers the Briefing Builder (step 2).

For now targets client_test only (controlled demo). TODO multi-client: load all active profiles +
per-client local-time scheduling (profiles.timezone).
"""
import json, os

BASE = "appjnWxg9sB3PV7Da"
PROFILE_TBL = "tbl_client_profile"
PENDING_TBL = "tbl_pending_replies"
AIR = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
CLAUDE = {"httpHeaderAuth": {"id": "pcypOWLM78lgbOUQ", "name": "Header Auth account"}}
GHL = {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "GHL Relentless"}}

DECIDE = r"""
// shared voice (inlined from voice.js)
var VOICE_BASE='You are Relentless AI, a sharp, warm executive coach and thinking partner who texts over SMS. You are NOT a chatbot or an automation - you sound like a real coach who knows this person and remembers the day. Be concise and human. Plain-text SMS only: no emojis, no markdown, ASCII characters only. End with exactly one question.';
function voiceSystem(o){o=o||{};var name=(o.name!=null&&String(o.name).trim())||'there';var stage=(o.stage!=null&&String(o.stage).trim())||'growing';var L=[VOICE_BASE,'You are coaching '+name+', a '+stage+'-stage executive.'];if(o.situation)L.push(String(o.situation).trim());if(o.maxChars)L.push('Keep the whole reply under '+o.maxChars+' characters.');return L.join('\n');}

var p=$json.fields?$json.fields:$json;
var name=p.full_name||'there';
var sit='It is early morning - this is the FIRST text of the day, before the briefing. Write a brief, warm, '
 +'personal good-morning to '+name+' and ask them to reply with three quick 1-5 reads so you can tailor todays '
 +'plan: sleep quality, energy, and stress. State the format EXPLICITLY so the reply is easy to parse, e.g. '
 +'"reply 3 numbers 1-5: sleep energy stress, like 4 3 2". Warm and human, not a form.';
var sys=voiceSystem({name:name,stage:p.business_stage,situation:sit,maxChars:220});
return [{json:{
  send: !!(p.ghl_contact_id),
  client_id:(p.client_id||'client_test'),
  ghl_contact_id:(p.ghl_contact_id||''),
  body:{model:'claude-sonnet-4-6',max_tokens:130,system:sys,messages:[{role:'user',content:'Write the morning check-in text now.'}]}
}}];
"""

EXTRACT = r"""
function sanitizeSms(t,m){if(m==null)m=320;t=String(t==null?'':t);t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();if(m&&t.length>m)t=t.slice(0,m).trim();return t;}
var ct='';try{var c=$('callClaude').first().json;ct=(c.content&&c.content[0]&&c.content[0].text)?c.content[0].text:'';}catch(e){ct='';}
var reply=sanitizeSms(ct,220);
if(!reply)reply='Morning! Before I build your plan, reply 3 numbers 1-5: sleep energy stress (e.g. 4 3 2).';
var d=$('decide').first().json;
return [{json:Object.assign({},d,{reply:reply})}];
"""

def code(i,n,s,p): return {"id":i,"name":n,"type":"n8n-nodes-base.code","typeVersion":2,"position":p,"parameters":{"jsCode":s}}

nodes=[
 {"id":"m","name":"When clicking Execute workflow","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[80,180],"parameters":{}},
 {"id":"s","name":"Schedule Trigger","type":"n8n-nodes-base.scheduleTrigger","typeVersion":1.2,"position":[80,360],
  "parameters":{"rule":{"interval":[{"field":"cronExpression","expression":"0 6 * * *"}]},"timezone":"Asia/Kolkata"}},
 {"id":"prof","name":"loadProfile","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[300,280],
  "alwaysOutputData":True,"credentials":AIR,
  "parameters":{"operation":"search","base":{"__rl":True,"value":BASE,"mode":"list"},
   "table":{"__rl":True,"value":"={{ '"+PROFILE_TBL+"' }}","mode":"id"},
   "filterByFormula":"={{ \"{client_id}='client_test'\" }}","returnAll":False,"limit":1,"options":{}}},
 code("d","decide",DECIDE,[520,280]),
 {"id":"if","name":"IsSend","type":"n8n-nodes-base.if","typeVersion":2.3,"position":[740,280],
  "parameters":{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"loose","version":3},
   "conditions":[{"id":"c","leftValue":"={{ $json.send }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}},
 {"id":"claude","name":"callClaude","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[960,200],
  "credentials":CLAUDE,"onError":"continueRegularOutput",
  "parameters":{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth",
   "sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},
   "sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.body) }}","options":{}}},
 code("e","extract",EXTRACT,[1180,200]),
 {"id":"send","name":"sendGHL","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[1400,200],
  "credentials":GHL,"onError":"continueRegularOutput",
  "parameters":{"method":"POST","url":"https://services.leadconnectorhq.com/conversations/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth",
   "sendHeaders":True,"headerParameters":{"parameters":[{"name":"Version","value":"2021-04-15"},{"name":"Content-Type","value":"application/json"}]},
   "sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify({ type:'SMS', contactId: $json.ghl_contact_id, message: $json.reply }) }}","options":{}}},
 {"id":"open","name":"openConversation","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[1620,200],
  "onError":"continueRegularOutput","credentials":AIR,
  "parameters":{"operation":"create","base":{"__rl":True,"value":BASE,"mode":"list"},
   "table":{"__rl":True,"value":"={{ '"+PENDING_TBL+"' }}","mode":"id"},
   "columns":{"mappingMode":"defineBelow","value":{
     "pending_id":"={{ 'pr_' + $now.toMillis() + '_morning_checkin' }}",
     "client_id":"={{ $json.client_id }}",
     "expected_type":"morning_checkin",
     "context_ref":"={{ JSON.stringify({ type:'morning_checkin', asks:'sleep energy stress 1-5' }) }}",
     "opened_at":"={{ $now.toISO() }}",
     "expires_at":"={{ $now.plus({ hours: 2 }).toISO() }}",
     "status":"open",
     "ghl_contact_id":"={{ $json.ghl_contact_id }}"}},
   "options":{}}},
]

connections={
 "When clicking Execute workflow":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "Schedule Trigger":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "loadProfile":{"main":[[{"node":"decide","type":"main","index":0}]]},
 "decide":{"main":[[{"node":"IsSend","type":"main","index":0}]]},
 "IsSend":{"main":[[{"node":"callClaude","type":"main","index":0}],[]]},
 "callClaude":{"main":[[{"node":"extract","type":"main","index":0}]]},
 "extract":{"main":[[{"node":"sendGHL","type":"main","index":0}]]},
 "sendGHL":{"main":[[{"node":"openConversation","type":"main","index":0}]]},
}

wf={"id":"morningCheckin1","name":"Relentless AI - Morning Check-in (sleep/energy/stress)",
 "nodes":nodes,"connections":connections,
 "settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","errorWorkflow":"errHandler01"},"active":False,"tags":[]}
out=os.path.join(os.path.dirname(__file__),"_morning_checkin.json")
json.dump(wf,open(out,"w",encoding="utf-8"),indent=2)
print("wrote",out,"| nodes:",len(nodes))
