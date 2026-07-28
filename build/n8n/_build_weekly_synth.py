#!/usr/bin/env python3
"""_build_weekly_synth.py -> _weekly_synth.json  (id weeklySynth1, webhook /webhook/weekly-synth)

Phase 4: turns a weekly business check-in REPLY into real intelligence (not just an ack):
  Claude extracts {cash_position, team_health, biggest_risk, severity, manageability, deliberate} from
  the free-text reply AND writes a sharp one-lever synthesis. A Code node then computes capital_score
  (capitalScore) + risk_score (riskScore) from scoring.js, writes a tbl_business_health row (which the
  honest EoD reads for Capital/Risk), and sends the synthesis via GHL.

Triggered by the GHL router when a weekly_checkin reply lands (HTTP POST, like the briefing builder).
Offline-tested by _sim_weekly_synth.js.
"""
import json, os

BASE = "appjnWxg9sB3PV7Da"
PROFILE_TBL = "tbl_client_profile"
BH_TBL = "tbl_business_health"
AIR = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
CLAUDE = {"httpHeaderAuth": {"id": "pcypOWLM78lgbOUQ", "name": "Header Auth account"}}
GHL = {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "GHL Relentless"}}

PROMPT = r"""
var b=($('Webhook').first().json.body)||{};
var pr={}; try{var p=$('loadProfile').first().json; pr=p.fields?p.fields:p;}catch(e){pr={};}
var name=pr.full_name||'the CEO'; var stage=pr.business_stage||'growing';
var replyText=String(b.reply_text||b.text||'').slice(0,500);
var sys=[
 'You are analyzing '+name+"'s weekly business check-in (a "+stage+'-stage company). They were asked for three reads: '
 +'(1) cash position - on track / tight / critical, (2) the single biggest risk this week, (3) team health - strong / some issues / serious / solo.',
 'From their reply, extract structured fields AND write a sharp one-lever coaching synthesis.',
 'Output STRICT JSON ONLY, no prose, no markdown fences: {"cash_position":"on_track|tight|critical","team_health":"strong|some_issues|serious_problem|solo","biggest_risk":"<short>","severity":<0-100>,"manageability":<0-100>,"deliberate":"deliberate|unexpected","synthesis":"<plain ASCII SMS under 280 chars naming the SINGLE biggest lever this week and one concrete move>"}',
 'severity = how damaging the biggest risk is (0 none, 100 existential). manageability = how much control they have over it (0 none, 100 fully). deliberate = is the risk a deliberate bet or unexpected.'
].join('\n');
return [{json:{ ghl_contact_id:(b.ghl_contact_id||pr.ghl_contact_id||''), client_id:(b.client_id||pr.client_id||'client_test'), stage:stage,
  body:{model:'claude-sonnet-4-6',max_tokens:400,system:sys,messages:[{role:'user',content:(replyText||'(no reply text)')}]} }}];
"""

PARSE = r"""
function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function roundHalfUp(x){return Math.round(x);}
var CAPITAL_DELTA={on_track:{launching:10,growing:15,operating:15},tight:{launching:5,growing:0,operating:0},critical:{launching:-10,growing:-20,operating:-25}};
function capitalScore(base,cash,stage){var b=(base==null)?70:base;var d=(CAPITAL_DELTA[cash]&&CAPITAL_DELTA[cash][stage])||0;return roundHalfUp(clamp(b+d,0,100));}
function riskScore(o){o=o||{};var sev=clamp(o.severity||0,0,100);var unman=100-clamp(o.manageability==null?100:o.manageability,0,100);var wS,wU;if(o.stage==='launching'&&o.deliberate==='deliberate'){wS=0.3;wU=0.7;}else if(o.stage==='launching'&&o.deliberate==='unexpected'){wS=0.7;wU=0.3;}else{wS=0.5;wU=0.5;}return roundHalfUp(clamp(100-(sev*wS+unman*wU),0,100));}
function sanitizeSms(t,m){if(m==null)m=320;t=String(t==null?'':t);t=t.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x00-\x7F]/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();if(m&&t.length>m)t=t.slice(0,m).trim();return t;}

var d=$('buildPrompt').first().json;
var raw=''; try{var c=$('callClaude').first().json; raw=(c.content&&c.content[0]&&c.content[0].text)?c.content[0].text:'';}catch(e){raw='';}
// pull the JSON object out of the response (tolerant to stray text/fences)
var j={}; try{ var m=String(raw).match(/\{[\s\S]*\}/); j=m?JSON.parse(m[0]):{}; }catch(e){ j={}; }
var stage=d.stage||'growing';
var cash=(['on_track','tight','critical'].indexOf(j.cash_position)>=0)?j.cash_position:'tight';
var team=(['strong','some_issues','serious_problem','solo'].indexOf(j.team_health)>=0)?j.team_health:'some_issues';
var deliberate=(j.deliberate==='deliberate')?'deliberate':'unexpected';
var capital_score=capitalScore(null,cash,stage);
var risk_score=riskScore({severity:Number(j.severity||50),manageability:Number(j.manageability==null?50:j.manageability),stage:stage,deliberate:deliberate});
var synthesis=sanitizeSms(j.synthesis||'',280);
if(!synthesis)synthesis='Got your reads. Your single lever this week: protect cash and make one concrete move on your biggest risk. What is that move?';
function monday(){var dt=new Date();var day=dt.getUTCDay()||7;dt.setUTCDate(dt.getUTCDate()-(day-1));return dt.toISOString().slice(0,10);}
return [{json:{
  ghl_contact_id:d.ghl_contact_id, client_id:d.client_id,