#!/usr/bin/env python3
"""_build_eod_honest.py -> _eod_honest.json (id eodPro00001ghl, replaces the active GHL Pro EoD)

Phase 3: HONEST Executive Score. Patches the EoD GHL workflow:
  - replaces computeScore with per-pillar {value,hasData} + honestScore (re-normalized over real pillars,
    "-" for missing, soft note when too little signal). Body uses manualRecovery from the morning reads
    when no wearable recovery exists.
  - adds an openConversation(score_feedback) node after the GHL send so the client's YES/NO reaction is
    matched + acknowledged by the GHL router.

No more neutral-70 fills. Reuses tested scoring (bodyScore/focus/execution/capital/risk) + honestScore.js.
"""
import json, os

BASE = "appjnWxg9sB3PV7Da"
PENDING_TBL = "tbl_pending_replies"
AIR = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}

COMPUTE = r"""
function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function roundHalfUp(x){return Math.round(x);}
var BODY_BANDS=[[85,100,90,100],[70,84,75,89],[50,69,50,74],[0,49,0,49]];
function bodyScore(r){r=clamp(r,0,100);for(var i=0;i<BODY_BANDS.length;i++){var rl=BODY_BANDS[i][0],rh=BODY_BANDS[i][1],bl=BODY_BANDS[i][2],bh=BODY_BANDS[i][3];if(r>=rl&&r<=rh){var span=(rh-rl)||1;return roundHalfUp(bl+((r-rl)/span)*(bh-bl));}}return 60;}
function manualRecovery(s,e,st){var sleepEq=clamp(s,1,5)*14;var energyRec=clamp(e,1,5)*18;var stressAdj=(6-clamp(st,1,5))*8;return roundHalfUp(Math.min(100,(sleepEq+energyRec+stressAdj)/2.0));}
// honest focus = nudge-response ratio (we have no calendar/focus-block data, so don't fake the block half)
function focusFromNudges(ns,nr){return ns>0?roundHalfUp(clamp(nr/ns,0,1)*100):null;}
function _norm(s){return String(s==null?'':s).toLowerCase().trim().replace(/\s+/g,' ');}
function _titleMatches(tt,pr){var a=_norm(tt),b=_norm(pr);if(!a||!b)return false;if(a===b)return true;if(a.length>=4&&b.length>=4&&(a.indexOf(b)>=0||b.indexOf(a)>=0))return true;return false;}
function _isCompleted(t){var c=t&&t.completed;return c===true||c==='true';}
function executionFromGhlTasks(tasks,tops){var list=Array.isArray(tasks)?tasks.filter(Boolean):[];var priorities=(Array.isArray(tops)?tops:[]).map(function(p){return String(p==null?'':p);}).filter(function(p){return _norm(p)!=='';}).slice(0,3);var completed=list.filter(_isCompleted);var used={};var matchedP=[];for(var k=0;k<priorities.length;k++){for(var i=0;i<completed.length;i++){if(used[i])continue;if(_titleMatches(completed[i].title,priorities[k])){used[i]=true;matchedP.push(priorities[k]);break;}}}var matched=matchedP.length;var usedCount=Object.keys(used).length;var extra=completed.length-usedCount;var extraBonus=clamp(extra*5,0,10);var base=clamp(matched,0,3)*33.3;var score=roundHalfUp(clamp(base+extraBonus,0,100));return {execution_score:score,hasData:list.length>0,matched:matched,extra:extra,completedCount:completed.length};}
var CAPITAL_DELTA={on_track:{launching:10,growing:15,operating:15},tight:{launching:5,growing:0,operating:0},critical:{launching:-10,growing:-20,operating:-25}};
function capitalScore(base,cash,stage){var b=(base==null)?70:base;var d=(CAPITAL_DELTA[cash]&&CAPITAL_DELTA[cash][stage])||0;return roundHalfUp(clamp(b+d,0,100));}
function riskScore(o){o=o||{};var sev=clamp(o.severity||0,0,100);var unman=100-clamp(o.manageability==null?100:o.manageability,0,100);var wS,wU;if(o.stage==='launching'&&o.deliberate==='deliberate'){wS=0.3;wU=0.7;}else if(o.stage==='launching'&&o.deliberate==='unexpected'){wS=0.7;wU=0.3;}else{wS=0.5;wU=0.5;}return roundHalfUp(clamp(100-(sev*wS+unman*wU),0,100));}
// ---- honestScore.js (re-normalized over present pillars) ----
var STD_W={body:0.25,focus:0.25,execution:0.30,alignment:0.20};
var PRO_W={body:0.20,focus:0.20,execution:0.25,alignment:0.15,capital:0.15,risk:0.10};
var PILLAR_LABEL={body:'recovery',focus:'focus',execution:'priorities',alignment:'alignment',capital:'capital',risk:'risk'};
function scoreLabel(c){if(c>=90)return 'Peak';if(c>=75)return 'Strong';if(c>=60)return 'Steady';if(c>=45)return 'Below Par';return 'Recovery Day';}
function honestScore(pillars,opts){opts=opts||{};var W=opts.pro?PRO_W:STD_W;var minP=opts.minPillars!=null?opts.minPillars:2;pillars=pillars||{};var present=[],shown={},sumW=0,acc=0;Object.keys(W).forEach(function(k){var p=pillars[k];var v=p?Number(p.value):NaN;if(p&&p.hasData&&p.value!=null&&isFinite(v)){present.push(k);sumW+=W[k];acc+=W[k]*v;shown[k]=Math.round(v);}else{shown[k]=null;}});if(present.length<minP||sumW<=0){return {enoughData:false,composite:null,label:null,present:present,pillars:shown,coverage:''};}var composite=Math.round(acc/sumW);return {enoughData:true,composite:composite,label:scoreLabel(composite),present:present,pillars:shown,coverage:present.map(function(k){return PILLAR_LABEL[k];}).join(' + ')};}

// ===== read data (same sources as before) =====
var pr=$('Search records').first().json;var p=pr.fields?pr.fields:pr;
var plan=String(p.plan||'standard').toLowerCase();var isPro=plan==='pro';
var bioItems=$('getBiometrics').all().map(function(it){return (it.json&&it.json.fields)?it.json.fields:(it.json||{});});
var latest=null;
for(var i=0;i<bioItems.length;i++){var b=bioItems[i];var hasRec=(b&&b.recovery_score!=null&&b.recovery_score!=='');var hasMan=(b&&b.manual_energy_input!=null&&b.manual_energy_input!=='');if(hasRec||hasMan){if(!latest||String(b.date||'')>String(latest.date||''))latest=b;}}

// BODY: wearable recovery, else morning manual reads, else no data
var bodyVal=null,bodyHas=false;
if(latest){
  if(latest.recovery_score!=null&&latest.recovery_score!==''){bodyVal=bodyScore(Number(latest.recovery_score));bodyHas=true;}
  else if(latest.manual_energy_input!=null&&latest.manual_energy_input!==''){var rec=manualRecovery(Number(latest.manual_sleep_input||3),Number(latest.manual_energy_input||3),Number(latest.manual_stress_input||3));bodyVal=bodyScore(rec);bodyHas=true;}
}
// FOCUS: nudge-response (only if nudges were actually sent)
var nudgeRows=[];try{nudgeRows=$('fetchTodayNudges').all().map(function(it){return (it.json&&it.json.fields)?it.json.fields:(it.json||{});}).filter(function(n){return n&&n.timestamp;});}catch(e){}
var ns=nudgeRows.length;var nr=nudgeRows.filter(function(n){return n.responded===true||n.responded==='true';}).length;
var focusVal=focusFromNudges(ns,nr);var focusHas=(focusVal!=null);
// EXECUTION: GHL tasks
var ghlTasks=[];try{var tr=$('fetchGhlTasks').first().json;ghlTasks=Array.isArray(tr.tasks)?tr.tasks:(Array.isArray(tr)?tr:[]);}catch(e){}
var ex=executionFromGhlTasks(ghlTasks,[p.top_priority_1,p.top_priority_2,p.top_priority_3]);