#!/usr/bin/env python3
"""7-day onboarding sequence (god plan §5). Daily 6:30 check: reads profile.onboarding_day,
sends that day's themed welcome message (Claude), then increments onboarding_day. Days 1-7;
>7 or blank -> done (skip). Output: _onboarding.json."""
import json, os
BASE=os.path.dirname(os.path.abspath(__file__)); BID="appjnWxg9sB3PV7Da"
AT={"airtableTokenApi":{"id":"Z1DGfO9LPHXmAo4W","name":"Airtable Goecoach Personal Access Token account"}}
CL={"httpHeaderAuth":{"id":"pcypOWLM78lgbOUQ","name":"Header Auth account"}}
TW={"twilioApi":{"id":"Iup3ZRFuOaK60uct","name":"Twilio account"}}

DECIDE=r"""
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;
var rid=$('loadProfile').first().json.id||'';
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
if(!(day>=1&&day<=7)){return [{json:{send:false,rid:rid,phone:p.phone_number,reason:'onboarding complete or not started (day='+day+')'}}];}
var sys=['You are onboarding '+(p.full_name||'a new client')+' ('+(p.business_stage||'growing')+' stage) to Relentless AI executive coaching.',
 THEMES[day],
 'Write ONE warm, concise plain-text SMS under 280 chars, no emojis. Sound like a sharp human coach, not marketing.'].join('\n');
return [{json:{send:true,rid:rid,phone:p.phone_number,onboarding_day:day,next_day:day+1,
  body:{model:'claude-sonnet-4-6',max_tokens:250,system:sys,messages:[{role:'user',content:'Write the day '+day+' onboarding message.'}]}}}];
"""
EXTRACT=r"""var t=$input.first().json.content[0].text;t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,' ').trim();return [{json:{sms:t.slice(0,300)}}];"""

def code(nid,name,js,pos): return {"id":nid,"name":name,"type":"n8n-nodes-base.code","typeVersion":2,"position":pos,"parameters":{"jsCode":js}}

nodes=[
 {"id":"ob-m","name":"When clicking Execute workflow","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[-260,-120],"parameters":{}},
 {"id":"ob-s","name":"Schedule Trigger","type":"n8n-nodes-base.scheduleTrigger","typeVersion":1.2,"position":[-260,40],"parameters":{"rule":{"interval":[{"field":"cronExpression","expression":"30 6 * * *"}]},"timezone":"Asia/Kolkata"}},
 {"id":"ob-p","name":"loadProfile","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[-40,-40],"alwaysOutputData":True,"credentials":AT,"parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_client_profile' }}","mode":"id"},"filterByFormula":"={{ \"{client_id}='client_test'\" }}","returnAll":False,"limit":1,"options":{}}},
 code("ob-d","decide",DECIDE,[180,-40]),
 {"id":"ob-if","name":"IsSend","type":"n8n-nodes-base.if","typeVersion":2.3,"position":[400,-40],"parameters":{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"strict","version":3},"conditions":[{"id":"s1","leftValue":"={{ $json.send }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}},
 {"id":"ob-c","name":"callClaude","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[620,-120],"credentials":CL,"parameters":{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.body) }}","options":{}}},
 code("ob-e","extract",EXTRACT,[840,-120]),
 {"id":"ob-sm","name":"Send an SMS/MMS/WhatsApp message","type":"n8n-nodes-base.twilio","typeVersion":1,"position":[1060,-120],"credentials":TW,"parameters":{"from":"+14482429365","to":"={{ $('decide').first().json.phone }}","message":"={{ $json.sms }}","options":{}}},
 {"id":"ob-inc","name":"advanceDay","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[1280,-120],"alwaysOutputData":True,"onError":"continueRegularOutput","credentials":AT,
  "parameters":{"operation":"update","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_client_profile' }}","mode":"id"},
   "columns":{"mappingMode":"defineBelow","matchingColumns":["id"],"value":{"id":"={{ $('decide').first().json.rid }}","onboarding_day":"={{ $('decide').first().json.next_day }}"},"schema":[]},"options":{"typecast":True}}},
]
conns={
 "When clicking Execute workflow":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "Schedule Trigger":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "loadProfile":{"main":[[{"node":"decide","type":"main","index":0}]]},
 "decide":{"main":[[{"node":"IsSend","type":"main","index":0}]]},
 "IsSend":{"main":[[{"node":"callClaude","type":"main","index":0}],[]]},
 "callClaude":{"main":[[{"node":"extract","type":"main","index":0}]]},
 "extract":{"main":[[{"node":"Send an SMS/MMS/WhatsApp message","type":"main","index":0}]]},
 "Send an SMS/MMS/WhatsApp message":{"main":[[{"node":"advanceDay","type":"main","index":0}]]},
}
wf={"id":"onboard00001","name":"Relentless AI - 7-Day Onboarding","nodes":nodes,"connections":conns,"settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","errorWorkflow":"errHandler01"},"active":False,"tags":[]}
json.dump(wf,open(os.path.join(BASE,"_onboarding.json"),"w",encoding="utf-8"),indent=2)
print("Wrote _onboarding.json nodes:",len(nodes))
