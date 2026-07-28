#!/usr/bin/env python3
"""Generate the Monthly Executive Report workflow (Phase 6). Pulls last ~31 days of
tbl_daily_scores -> aggregateMonth (inlined from monthlyAggregation.js, 15 tests) + monthlyScore
-> Claude writes a short SMS report -> send -> log tbl_monthly_reports. Output: _monthly.json."""
import json, os
BASE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(BASE, "_monthly.json")
BID = "appjnWxg9sB3PV7Da"
AT = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
CL = {"httpHeaderAuth": {"id": "pcypOWLM78lgbOUQ", "name": "Header Auth account"}}
TW = {"twilioApi": {"id": "Iup3ZRFuOaK60uct", "name": "Twilio account"}}

AGG = r"""
function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function _num(v){if(v===undefined||v===null||v==='')return null;var n=Number(v);return Number.isFinite(n)?n:null;}
function _mean(a){var v=a.filter(function(x){return x!==null;});return v.length?v.reduce(function(p,c){return p+c;},0)/v.length:null;}
function _std(a){var v=a.filter(function(x){return x!==null;});if(v.length<2)return 0;var m=_mean(v);return Math.sqrt(v.reduce(function(p,c){return p+(c-m)*(c-m);},0)/v.length);}
function monthlyScore(base,t,c,p){t=clamp(t||0,0,5);c=clamp(c||0,0,3);p=clamp(p||0,0,4);return Math.round(clamp(base+t+c+p,0,100));}
function aggregateMonth(rows,prior,opts){opts=opts||{};
  var list=(Array.isArray(rows)?rows:[]).filter(Boolean).slice().sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''));});
  var comps=list.map(function(r){return _num(r.composite_score);}).filter(function(x){return x!==null;});
  if(!comps.length)return {hasData:false,base_score:null,trend_bonus:0,consistency_bonus:0,pillar_improvement_bonus:0,days:0};
  var base=Math.round(_mean(comps));
  var mid=Math.floor(comps.length/2);var fh=comps.slice(0,mid||1);var sh=comps.slice(mid);
  var td=(_mean(sh)||0)-(_mean(fh)||0);var trend=clamp(Math.floor(Math.max(0,td)/2),0,5);
  var sd=_std(comps);var cons=sd<=5?3:sd<=10?2:sd<=15?1:0;
  var PIL=['body_score','focus_score','execution_score','alignment_score'];var pib=0;
  var pl=(Array.isArray(prior)?prior:[]).filter(Boolean);
  if(pl.length){for(var i=0;i<PIL.length;i++){var cur=_mean(list.map(function(r){return _num(r[PIL[i]]);}));var prev=_mean(pl.map(function(r){return _num(r[PIL[i]]);}));if(cur!==null&&prev!==null&&cur>prev)pib++;}}
  pib=clamp(pib,0,4);
  var peak=comps.filter(function(c){return c>=90;}).length;var rec=comps.filter(function(c){return c<45;}).length;
  var em=_mean(list.map(function(r){return _num(r.execution_score);}));
  var best=null,worst=null;for(var k=0;k<list.length;k++){var c=_num(list[k].composite_score);if(c===null)continue;if(!best||c>_num(best.composite_score))best=list[k];if(!worst||c<_num(worst.composite_score))worst=list[k];}
  var o={hasData:true,days:list.length,base_score:base,trend_bonus:trend,consistency_bonus:cons,pillar_improvement_bonus:pib,peak_days:peak,recovery_days:rec,priority_completion_rate:em!==null?Math.round((em/100)*100)/100:null,best_day:best?{date:best.date,composite:_num(best.composite_score)}:null,worst_day:worst?{date:worst.date,composite:_num(worst.composite_score)}:null};
  if(String(opts.plan||'').toLowerCase()==='pro'){var cm=_mean(list.map(function(r){return _num(r.capital_score);}));var rm=_mean(list.map(function(r){return _num(r.risk_score);}));o.capital_avg=cm===null?null:Math.round(cm);o.risk_avg=rm===null?null:Math.round(rm);}
  return o;
}
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;
var plan=String(p.plan||'standard').toLowerCase();
var rows=$('fetchScores').all().map(function(it){return (it.json&&it.json.fields)?it.json.fields:(it.json||{});}).filter(function(r){return r&&r.composite_score!=null;});
var agg=aggregateMonth(rows,[],{plan:plan});
var monthly=agg.hasData?monthlyScore(agg.base_score,agg.trend_bonus,agg.consistency_bonus,agg.pillar_improvement_bonus):null;
var monthLabel=$now.minus({months:1}).toFormat('LLLL yyyy');
var sys=['You write a concise MONTHLY executive performance report as ONE plain-text SMS under 300 characters, no emojis.',
 'Client '+(p.full_name||'Client')+', '+(p.business_stage||'growing')+' stage, '+plan+' plan.',
 agg.hasData?('DATA: monthly score '+monthly+'/100 (avg '+agg.base_score+', trend+'+agg.trend_bonus+', consistency+'+agg.consistency_bonus+', improvement+'+agg.pillar_improvement_bonus+'). '+agg.days+' days, '+agg.peak_days+' peak days, '+agg.recovery_days+' recovery days. Priority completion '+Math.round((agg.priority_completion_rate||0)*100)+'%.'+(plan==='pro'&&agg.capital_avg!=null?(' Capital avg '+agg.capital_avg+', Risk avg '+agg.risk_avg+'.'):''))
            :'DATA: not enough daily scores yet this month.',
 'Write: 1 headline on the month, the score, and ONE concrete focus for next month. Sharp, executive tone.'].join('\n');
var body={model:'claude-sonnet-4-6',max_tokens:300,system:sys,messages:[{role:'user',content:'Write my monthly report for '+monthLabel+'.'}]};
return [{json:{body:body,phone:p.phone_number,client_id:(p.client_id||'client_test'),plan:plan,month_year:monthLabel,monthly_score:monthly,base_score:agg.base_score,trend_bonus:agg.trend_bonus,consistency_bonus:agg.consistency_bonus,pillar_improvement_bonus:agg.pillar_improvement_bonus,capital_avg:(agg.capital_avg!=null?agg.capital_avg:null),risk_avg:(agg.risk_avg!=null?agg.risk_avg:null),has_data:agg.hasData}}];
"""

EXTRACT = r"""
var t=$input.first().json.content[0].text;
t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,' ').trim();
var a=$('aggregate').first().json;
return [{json:Object.assign({},a,{sms:t.slice(0,300)})}];
"""

def code(nid,name,js,pos): return {"id":nid,"name":name,"type":"n8n-nodes-base.code","typeVersion":2,"position":pos,"parameters":{"jsCode":js}}

nodes=[
 {"id":"mt-man","name":"When clicking Execute workflow","type":"n8n-nodes-base.manualTrigger","typeVersion":1,"position":[-260,-120],"parameters":{}},
 {"id":"mt-sched","name":"Schedule Trigger","type":"n8n-nodes-base.scheduleTrigger","typeVersion":1.2,"position":[-260,40],"parameters":{"rule":{"interval":[{"field":"cronExpression","expression":"0 8 1 * *"}]},"timezone":"Asia/Kolkata"}},
 {"id":"mt-prof","name":"loadProfile","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[-40,-40],"alwaysOutputData":True,"credentials":AT,
  "parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_client_profile' }}","mode":"id"},"filterByFormula":"={{ \"{client_id}='client_test'\" }}","returnAll":False,"limit":1,"options":{}}},
 {"id":"mt-scores","name":"fetchScores","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[180,-40],"alwaysOutputData":True,"credentials":AT,
  "parameters":{"operation":"search","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_daily_scores' }}","mode":"id"},"filterByFormula":"={{ \"AND({client_id}='client_test', DATETIME_DIFF(NOW(),{date},'days')<=31)\" }}","returnAll":False,"limit":50,"sort":{"property":[{"field":"date","direction":"desc"}]},"options":{}}},
 code("mt-agg","aggregate",AGG,[400,-40]),
 {"id":"mt-claude","name":"callClaude","type":"n8n-nodes-base.httpRequest","typeVersion":4.2,"position":[620,-40],"credentials":CL,
  "parameters":{"method":"POST","url":"https://api.anthropic.com/v1/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendHeaders":True,"headerParameters":{"parameters":[{"name":"anthropic-version","value":"2023-06-01"}]},"sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify($json.body) }}","options":{}}},
 code("mt-ext","extract",EXTRACT,[840,-40]),
 {"id":"mt-sms","name":"Send an SMS/MMS/WhatsApp message","type":"n8n-nodes-base.twilio","typeVersion":1,"position":[1060,-40],"credentials":TW,
  "parameters":{"from":"+14482429365","to":"={{ $('aggregate').first().json.phone }}","message":"={{ $json.sms }}","options":{}}},
 {"id":"mt-log","name":"logReport","type":"n8n-nodes-base.airtable","typeVersion":2.2,"position":[1280,-40],"alwaysOutputData":True,"onError":"continueRegularOutput","credentials":AT,
  "parameters":{"operation":"create","base":{"__rl":True,"value":BID,"mode":"list"},"table":{"__rl":True,"value":"={{ 'tbl_monthly_reports' }}","mode":"id"},
   "columns":{"mappingMode":"defineBelow","value":{
     "client_id":"={{ $json.client_id }}","month_year":"={{ $json.month_year }}","monthly_score":"={{ $json.monthly_score }}",
     "base_score":"={{ $json.base_score }}","trend_bonus":"={{ $json.trend_bonus }}","consistency_bonus":"={{ $json.consistency_bonus }}",
     "pillar_improvement_bonus":"={{ $json.pillar_improvement_bonus }}","report_sent_sms":True},"matchingColumns":[],"schema":[]},
   "options":{"typecast":True}}},
]
conns={
 "When clicking Execute workflow":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "Schedule Trigger":{"main":[[{"node":"loadProfile","type":"main","index":0}]]},
 "loadProfile":{"main":[[{"node":"fetchScores","type":"main","index":0}]]},
 "fetchScores":{"main":[[{"node":"aggregate","type":"main","index":0}]]},
 "aggregate":{"main":[[{"node":"callClaude","type":"main","index":0}]]},
 "callClaude":{"main":[[{"node":"extract","type":"main","index":0}]]},
 "extract":{"main":[[{"node":"Send an SMS/MMS/WhatsApp message","type":"main","index":0}]]},
 "Send an SMS/MMS/WhatsApp message":{"main":[[{"node":"logReport","type":"main","index":0}]]},
}
wf={"id":"monthly00001","name":"Relentless AI - Monthly Report","nodes":nodes,"connections":conns,
    "settings":{"executionOrder":"v1","timezone":"Asia/Kolkata","errorWorkflow":"errHandler01"},"active":False,"tags":[]}
json.dump(wf,open(OUT,"w",encoding="utf-8"),indent=2)
print("Wrote",OUT,"nodes:",[n["name"] for n in nodes])
