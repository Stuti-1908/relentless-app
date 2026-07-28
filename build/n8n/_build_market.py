#!/usr/bin/env python3
"""Pro Market Intelligence (Phase 8). 5:40 AM, Pro-gated. Generates a sharp, industry-specific
market signal for the client (Claude, from industry + market_keywords) and writes tbl_market_signals
-> the dashboard Market Signal card + the morning briefing can fold it in. Degrades gracefully
without a news API key; wire NewsData.io later by prepending a fetch + feeding headlines to Claude.
Output: _market.json."""
import json, os
BASE=os.path.dirname(os.path.abspath(__file__)); BID="appjnWxg9sB3PV7Da"
AT={"airtableTokenApi":{"id":"Z1DGfO9LPHXmAo4W","name":"Airtable Goecoach Personal Access Token account"}}
CL={"httpHeaderAuth":{"id":"pcypOWLM78lgbOUQ","name":"Header Auth account"}}

DECIDE=r"""
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;
var plan=String(p.plan||'standard').toLowerCase();
if(plan!=='pro'){return [{json:{send:false,reason:'market intel is Pro-only'}}];}
var industry=p.industry||'their industry';
var kw=p.market_keywords||'';
var sys=['You are a market-intelligence analyst briefing a '+(p.business_stage||'growing')+'-stage executive in '+industry+(kw?(' (watching: '+kw+')'):'')+'.',
 'Write ONE specific, non-generic market signal as plain text under 280 chars, no emojis: a concrete shift, trend, or competitor/buyer behavior worth acting on this week, ending with a SO-WHAT for this exec. Avoid hedging and platitudes.'].join('\n');
return [{json:{send:true,client_id:(p.client_id||'client_test'),
  body:{model:'claude-sonnet-4-6',max_tokens:220,system:sys,messages:[{role:'user',content:'Give me this week market signal.'}]}}}];
"""
EXTRACT=r"""var t=$input.first().json.content[0].text;t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,' ').trim();return [{json:{signal_text:t.slice(0,300),client_id:$('decide').first().json.client_id}}];"""

def code(nid,name,js,pos): return {"id":nid,"name":name,"type":"n8n-nodes-base.code","typeVersion":2,"position":pos,"parameters":{"jsCode":js}}

nodes=[
 {"id":"mk-m","name":"When clicking Execute workflow","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[-260,-120],"parameters":{}},
 {"id":"mk-s","name":"Schedule Trigger","type":"n8n-nodes-base.scheduleTrigger","typeVersion":1.2,"position":[-260,40],"parameters":{"rule":{"interval":[{"field":"cronExpression","expression":"40 5 * * *"}]},"timezone":"Asia/Kolkata"}},
 {"id":"mk-p","name":"loadProfile","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[-40,-40],"alwaysOutputData":True,"credentials":AT,"parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_client_profile' }}","mode":"id"},"filterByFormula":"={{ \"{client_id}='client_test'\" }}","returnAll":False,"limit":1,"options":{}}},
 code("mk-d","decide",DECIDE,[180,-40]),
 {"id":"mk-if","name":"IsSend","type":"n8n-nodes-base.if","typeVersion":2.3,"position":[400,-40],"parameters":{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"strict","version":3},"conditions":[{"id":"s1","leftValue":"={{ $json.send }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}},
 {"id":"mk-c","name":"callClaude","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[620,-120],"credentials":CL,"parameters":{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.body) }}","options":{}}},
 code("mk-e","extract",EXTRACT,[840,-120]),
 {"id":"mk-w","name":"writeSignal","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[1060,-120],"alwaysOutputData":True,"onError":"continueRegularOutput","credentials":AT,
  "parameters":{"operation":"create","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_market_signals' }}","mode":"id"},
   "columns":{"mappingMode":"defineBelow","value":{"client_id":"={{ $json.client_id }}","date":"={{ $now.toFormat('yyyy-MM-dd') }}","signal_text":"={{ $json.signal_text }}","source":"news_api","delivered":True},"matchingColumns":[],"schema":[]},"options":{"typecast":True}}},
]
conns={
 "When clicking Execute workflow":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "Schedule Trigger":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "loadProfile":{"main":[[{"node":"decide","type":"main","index":0}]]},
 "decide":{"main":[[{"node":"IsSend","type":"main","index":0}]]},
 "IsSend":{"main":[[{"node":"callClaude","type":"main","index":0}],[]]},
 "callClaude":{"main":[[{"node":"extract","type":"main","index":0}]]},
 "extract":{"main":[[{"node":"writeSignal","type":"main","index":0}]]},
}
wf={"id":"market000001","name":"Relentless AI - Market Intelligence (Pro)","nodes":nodes,"connections":conns,"settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","errorWorkflow":"errHandler01"},"active":False,"tags":[]}
json.dump(wf,open(os.path.join(BASE,"_market.json"),"w",encoding="utf-8"),indent=2)
print("Wrote _market.json nodes:",len(nodes))
