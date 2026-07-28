#!/usr/bin/env python3
"""Generate two Monday workflows (god plan §8/§10):
  - badDayOverride0 (Mon 8:30): if last 7 days were rough (avg composite low or >=2 recovery days),
    send a supportive reset SMS; else skip.
  - stageTransition (Mon 6:30): stage-aware week-planning SMS; flags if consistent high scores
    suggest readiness to advance a stage.
Both outbound-only (demoable). Output: _badday.json, _stage.json."""
import json, os
BASE=os.path.dirname(os.path.abspath(__file__)); BID="appjnWxg9sB3PV7Da"
AT={"airtableTokenApi":{"id":"Z1DGfO9LPHXmAo4W","name":"Airtable Goecoach Personal Access Token account"}}
CL={"httpHeaderAuth":{"id":"pcypOWLM78lgbOUQ","name":"Header Auth account"}}
TW={"twilioApi":{"id":"Iup3ZRFuOaK60uct","name":"Twilio account"}}

def code(nid,name,js,pos): return {"id":nid,"name":name,"type":"n8n-nodes-base.code","typeVersion":2,"position":pos,"parameters":{"jsCode":js}}
def prof(nid,pos): return {"id":nid,"name":"loadProfile","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":pos,"alwaysOutputData":True,"credentials":AT,"parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_client_profile' }}","mode":"id"},"filterByFormula":"={{ \"{client_id}='client_test'\" }}","returnAll":False,"limit":1,"options":{}}}
def scores(nid,pos,days): return {"id":nid,"name":"fetchScores","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":pos,"alwaysOutputData":True,"credentials":AT,"parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_daily_scores' }}","mode":"id"},"filterByFormula":"={{ \"AND({client_id}='client_test', DATETIME_DIFF(NOW(),{date},'days')<=%d)\" }}"%days,"returnAll":False,"limit":30,"sort":{"property":[{"field":"date","direction":"desc"}]},"options":{}}}
def claude(nid,pos): return {"id":nid,"name":"callClaude","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":pos,"credentials":CL,"parameters":{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.body) }}","options":{}}}
def sms(nid,pos): return {"id":nid,"name":"Send an SMS/MMS/WhatsApp message","type":"n8n-nodes-base.twilio","typeVersion":1,"position":pos,"credentials":TW,"parameters":{"from":"+14482429365","to":"={{ $('decide').first().json.phone }}","message":"={{ $json.sms }}","options":{}}}
def ifsend(nid,pos): return {"id":nid,"name":"IsSend","type":"n8n-nodes-base.if","typeVersion":2.3,"position":pos,"parameters":{"conditions":{"options":{"caseSensitive":True,"leftValue":"","typeValidation":"strict","version":3},"conditions":[{"id":"s1","leftValue":"={{ $json.send }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"}, "options":{}}}
EXTRACT=r"""var t=$input.first().json.content[0].text;t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,' ').trim();return [{json:{sms:t.slice(0,300)}}];"""

# ---- Bad-day override ----
BADDAY_DECIDE=r"""
function _num(v){if(v==null||v==='')return null;var n=Number(v);return Number.isFinite(n)?n:null;}
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;
var rows=$('fetchScores').all().map(function(it){return (it.json&&it.json.fields)?it.json.fields:(it.json||{});}).filter(function(r){return r&&r.composite_score!=null;});
var comps=rows.map(function(r){return _num(r.composite_score);}).filter(function(x){return x!==null;});
var avg=comps.length?Math.round(comps.reduce(function(a,b){return a+b;},0)/comps.length):null;
var recDays=comps.filter(function(c){return c<45;}).length;
var rough=(avg!=null&&avg<55)||recDays>=2;
if(!rough||!comps.length){return [{json:{send:false,phone:p.phone_number,reason:'week ok (avg '+avg+', recovery days '+recDays+')'}}];}
var sys=['You are a supportive executive coach. Last week was rough for '+(p.full_name||'the client')+' ('+(p.business_stage||'growing')+' stage): 7-day avg score '+avg+'/100, '+recDays+' recovery days.',
 'Write ONE plain-text SMS under 280 chars, no emojis: acknowledge the hard week WITHOUT judgment, reframe it as data not failure, and give ONE small reset action for today. Warm, steady, no toxic positivity.'].join('\n');
return [{json:{send:true,phone:p.phone_number,avg:avg,recovery_days:recDays,body:{model:'claude-sonnet-4-6',max_tokens:250,system:sys,messages:[{role:'user',content:'Write my Monday reset message.'}]}}}];
"""
# ---- Stage transition / weekly planning ----
STAGE_DECIDE=r"""
function _num(v){if(v==null||v==='')return null;var n=Number(v);return Number.isFinite(n)?n:null;}
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;
var rows=$('fetchScores').all().map(function(it){return (it.json&&it.json.fields)?it.json.fields:(it.json||{});}).filter(function(r){return r&&r.composite_score!=null;});
var comps=rows.map(function(r){return _num(r.composite_score);}).filter(function(x){return x!==null;});
var avg=comps.length?Math.round(comps.reduce(function(a,b){return a+b;},0)/comps.length):null;
// readiness signal: sustained high performance may indicate readiness to advance the stage
var strongWeeks=avg!=null&&avg>=80&&comps.length>=5;
var stage=p.business_stage||'growing';
var sys=['You are an executive coach kicking off the week with a STAGE-AWARE plan for '+(p.full_name||'the client')+', currently '+stage+' stage'+(avg!=null?(' (last-week avg '+avg+'/100)'):'')+'.',
 stage==='launching'?'Focus the week on momentum and customer learning.':stage==='operating'?'Focus the week on discipline, delegation and optimization.':'Focus the week on leverage, team performance and capital efficiency.',
 strongWeeks?'NOTE: performance has been consistently strong - gently raise whether they are ready to operate at the next stage and what that would require.':'',
 'Write ONE plain-text SMS under 280 chars, no emojis: the single highest-leverage focus for THIS week given the stage. Sharp, forward-looking.'].join('\n');
return [{json:{send:true,phone:p.phone_number,avg:avg,stage:stage,strong:strongWeeks,body:{model:'claude-sonnet-4-6',max_tokens:250,system:sys,messages:[{role:'user',content:'Plan my week.'}]}}}];
"""

def build(wid,name,cron,decide_js):
    nodes=[
     {"id":wid+"-m","name":"When clicking Execute workflow","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[-260,-120],"parameters":{}},
     {"id":wid+"-s","name":"Schedule Trigger","type":"n8n-nodes-base.scheduleTrigger","typeVersion":1.2,"position":[-260,40],"parameters":{"rule":{"interval":[{"field":"cronExpression","expression":cron}]},"timezone":"Asia/Kolkata"}},
     prof(wid+"-p",[-40,-40]), scores(wid+"-sc",[180,-40],7),
     code(wid+"-d","decide",decide_js,[400,-40]), ifsend(wid+"-if",[620,-40]),
     claude(wid+"-c",[840,-120]), code(wid+"-e","extract",EXTRACT,[1060,-120]), sms(wid+"-sm",[1280,-120]),
    ]
    conns={
     "When clicking Execute workflow":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
     "Schedule Trigger":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
     "loadProfile":{"main":[[{"node":"fetchScores","type":"main","index":0}]]},
     "fetchScores":{"main":[[{"node":"decide","type":"main","index":0}]]},
     "decide":{"main":[[{"node":"IsSend","type":"main","index":0}]]},
     "IsSend":{"main":[[{"node":"callClaude","type":"main","index":0}],[]]},
     "callClaude":{"main":[[{"node":"extract","type":"main","index":0}]]},
     "extract":{"main":[[{"node":"Send an SMS/MMS/WhatsApp message","type":"main","index":0}]]},
    }
    return {"id":wid,"name":name,"nodes":nodes,"connections":conns,"settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","errorWorkflow":"errHandler01"},"active":False,"tags":[]}

json.dump(build("badDayOverr1","Relentless AI - Bad-Day Override","30 8 * * 1",BADDAY_DECIDE),open(os.path.join(BASE,"_badday.json"),"w",encoding="utf-8"),indent=2)
json.dump(build("stageTrans01","Relentless AI - Stage Transition / Weekly Plan","30 6 * * 1",STAGE_DECIDE),open(os.path.join(BASE,"_stage.json"),"w",encoding="utf-8"),indent=2)
print("Wrote _badday.json and _stage.json")
