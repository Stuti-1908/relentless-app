#!/usr/bin/env python3
"""_build_briefing_builder.py -> _briefing_builder.json

Phase 2 Briefing Builder (id briefBuilder1). Multi-source version.
Triggered each morning by the GHL router or 7:00 fallback.
Fetches News (Airtable), CRM (GHL contacts), Calendar (Supabase) and assembles via briefingAssembler.js.
"""
import json, os

BASE = "appjnWxg9sB3PV7Da"
PROFILE_TBL = "tbl_client_profile"
BIO_TBL = "tbl_biometrics"
PENDING_TBL = "tbl_pending_replies"
BRIEFINGS_TBL = "tbl_briefings"
MARKET_TBL = "tbl_market_signals"
AIR = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
CLAUDE = {"httpHeaderAuth": {"id": "pcypOWLM78lgbOUQ", "name": "Header Auth account"}}
GHL = {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "GHL Relentless"}}

# Read the full briefingAssembler.js
with open(os.path.join(os.path.dirname(__file__), "..", "harness", "scoring", "briefingAssembler.js"), 'r', encoding='utf-8') as f:
    BA_CODE = f.read()

# The profile/biometrics/mood/Claude-prompt code
PROFILE_CODE = r"""
// ===== profile+biometrics+intensity+mood =====
var pr=$('loadProfile').first().json;var p=pr.fields?pr.fields:pr;var trig={};try{trig=($('Webhook').first().json.body)||{};}catch(e){trig={};}
var hasMood=trig.hasMood===true||trig.energy!=null;
var bioItems=$('loadBiometrics').all().map(function(it){return(it.json&&it.json.fields)?it.json.fields:(it.json||{});});
var latest=null;for(var i=0;i<bioItems.length;i++){var b=bioItems[i];if(b&&b.recovery_score!=null&&b.recovery_score!==''){if(!latest||String(b.date||'')>String(latest.date||''))latest=b;}}
var recovery=60;if(latest)recovery=Number(latest.recovery_score);
function _toNum(v){if(v===undefined||v===null||v==='')return null;var n=Number(v);return Number.isFinite(n)?n:null;}
function _avgOf(rows,key,window){var vals=[];for(var i=0;i<rows.length;i++){if(vals.length>=window)break;var n=_toNum(rows[i][key]);if(n!==null)vals.push(n);}if(!vals.length)return null;var s=vals.reduce(function(a,b){return a+b;},0);return Math.round((s/vals.length)*10)/10;}
function computeAdaptation(rawRows,opts){opts=opts||{};var window=opts.window||7,streakDays=opts.streakDays||3,threshold=opts.threshold!=null?opts.threshold:60;var rows=(Array.isArray(rawRows)?rawRows:[]).filter(Boolean).slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''));});var avg7_recovery=_avgOf(rows,'recovery_score',window),avg7_sleep=_avgOf(rows,'sleep_score',window),avg7_hrv=_avgOf(rows,'hrv_score',window);var lowRecoveryStreak=0;for(var i=0;i<rows.length;i++){var rec=_toNum(rows[i].recovery_score);if(rec===null)break;if(rec<threshold)lowRecoveryStreak+=1;else break;}var adaptationActive=lowRecoveryStreak>=streakDays;var note='';if(adaptationActive){var avgTxt=avg7_recovery!=null?avg7_recovery:'low';note='ADAPTATION (multi-day trend): Recovery below '+threshold+' for '+lowRecoveryStreak+' consecutive days.';}return{avg7_recovery:avg7_recovery,avg7_sleep:avg7_sleep,avg7_hrv:avg7_hrv,lowRecoveryStreak:lowRecoveryStreak,adaptationActive:adaptationActive,daysConsidered:rows.length,note:note};}
var adapt=computeAdaptation(bioItems);
var energy=hasMood?_toNum(trig.energy):(latest?_toNum(latest.manual_energy_input):null);
function computeIntensity(recovery,energy){var rec=Number.isFinite(Number(recovery))?Number(recovery):60;var en=_toNum(energy);var names=['low','moderate','high'];var rb=rec>=70?2:(rec>=45?1:0);var eb=en===null?rb:(en>=4?2:(en>=3?1:0));var idx=Math.min(rb,eb);if(eb===2&&rb>=1)idx=2;var band=names[idx];var notes={high:'HIGH ENERGY DAY: Front-load demanding work.',moderate:'STEADY DAY: 2-3 priorities at sustainable pace.',low:'LOW ENERGY DAY: ONE light keystone priority.'};return{band:band,note:notes[band],energy_used:en};}
var intensity=computeIntensity(recovery,energy);
function _c15(v){if(v===undefined||v===null||v==='')return null;var n=Number(v);return Number.isFinite(n)?Number(n.toFixed(15)):null;}
function moodAssessment(reads){reads=reads||{};var e=_c15(reads.energy)||3,s=_c15(reads.sleep)||3,st=_c15(reads.stress)||3;var score=e+s+(6-st);var bucket;if(e<=2||s<=2||st>=4)bucket='low';else if(score>=12)bucket='high';else if(score>=9)bucket='moderate';else bucket='low';var tone;if(bucket==='low')tone='Client is running low. Open with warm, energizing line.';else if(bucket==='moderate')tone='Client is steady. Open with grounded, focused line.';else tone='Client is firing. Open with punchy momentum line.';return{bucket:bucket,score:score,energy:e,sleep:s,stress:st,tone:tone};}
var mood=hasMood?moodAssessment({sleep:trig.sleep,energy:trig.energy,stress:trig.stress}):null;

// ===== MULTI-SOURCE ASSEMBLY =====
var sources={};var enabled=String((p.briefing_sources||'news,crm,calendar')).toLowerCase();function on(s){return enabled.indexOf(s)>=0;}
if(on('news')){try{var newsRows=$('fetchNews').all().map(function(it){return(it.json&&it.json.fields)?it.json.fields:(it.json||{});});var newsRow=newsRows[0]||{};var newsText=newsRow.signal_text||newsRow.text||'';if(newsText.trim())sources.news={text:newsText.trim(),source:newsRow.source||'news'};}catch(e){}}
if(on('crm')){try{var crmData=$('fetchCRM').first().json||{};var contacts=crmData.contacts||[];var now=Date.now();var oneDayAgo=now-86400000;var twoWeeksAgo=now-1209600000;var newLeads=[],goneQuiet=[];for(var ci=0;ci<contacts.length;ci++){var c=contacts[ci];if(!c)continue;var name=(c.firstName||'')+' '+(c.lastName||'');if(name.trim()==='')name=c.email||c.phone||'Lead';if(c.dateAdded&&new Date(c.dateAdded).getTime()>oneDayAgo)newLeads.push(name.trim());else if(c.dateUpdated&&new Date(c.dateUpdated).getTime()<twoWeeksAgo)goneQuiet.push(name.trim());}if(newLeads.length||goneQuiet.length)sources.crm={newLeads:newLeads.slice(0,3),stalledDeals:[],goneQuiet:goneQuiet.slice(0,3)};}catch(e){}}
if(on('calendar')){try{var calData=$('fetchCalendar').all().map(function(it){return(it.json&&it.json.fields)?it.json.fields:(it.json||{});});var meetings=calData.filter(function(m){return m&&m.meet_time;}).map(function(m){return{title:m.title||'meeting',time:m.meet_time};}).slice(0,5);if(meetings.length)sources.calendar={meetings:meetings};}catch(e){}}
var priorities=[p.top_priority_1,p.top_priority_2,p.top_priority_3].filter(Boolean);
var moodObj=mood&&mood.tone?{tone:mood.tone,bucket:mood.bucket}:null;
var a=assembleBriefing({mood:moodObj,priorities:priorities,sources:sources});
var dashboardSections={};
if(a.sections.priorities)dashboardSections.priorities={summary:'Top priorities',content:a.sections.priorities.replace('PRIORITIES: ','')};
if(a.sections.crm){var crmParts=a.sections.crm.replace('CRM: ','').split(' | ');dashboardSections.crm={summary:crmParts[0]||'CRM',content:crmParts.join(', ')};}
if(a.sections.calendar){var calParts=a.sections.calendar.replace('CALENDAR (today): ','').split('; ');dashboardSections.calendar={summary:calParts.length+' meeting(s)',meetings:calParts.map(function(part){var m=part.trim().match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(.+)$/i);return m?{time:m[1],title:m[2]}:{time:'',title:part.trim()};})};}
if(a.sections.news)dashboardSections.news={summary:'Market check',content:a.sections.news.replace('NEWS: ','')};
var stageBlocks={launching:'You coach a founder building first customers. Prioritize momentum.',growing:'You coach a leader scaling. Prioritize leverage.',operating:'You coach an executive optimizing. Prioritize discipline.'};
var contextFromSources=a.contextBlock?a.contextBlock+'\n\n':'';var systemLines=[contextFromSources+'You are Relentless AI, a sharp warm executive coach texting the morning briefing. Plain-text SMS, ASCII only, no emojis.',mood?('MOOD OPENER: '+mood.tone):'Open with one short grounded line.','STAGE CONTEXT: '+(stageBlocks[p.business_stage]||stageBlocks.growing),p.twelve_month_goal?('12-MONTH GOAL: '+p.twelve_month_goal):'','USER CONTEXT: '+(p.full_name||'Client')+'. Recovery '+recovery+'/100'+(energy!=null?(', energy '+energy+'/5'):'')+'.',adapt.adaptationActive?adapt.note:intensity.note,'PRIORITIES: '+priorities.join('; '),'OUTPUT RULES: ONE plain-text SMS under 300 characters. Start with the mood opener, then rank today\'s top priorities. No emojis. Cover only readiness, focus, execution and priorities - do NOT mention finances, cash, runway, or downside metrics.']
var system=systemLines.join('\n');
var body={model:'claude-sonnet-4-6',max_tokens:320,system:system,messages:[{role:'user',content:'Generate my mood-adapted morning briefing.'}]};
return[{json:{body:body,client_id:(p.client_id||trig.client_id||''),ghl_contact_id:(p.ghl_contact_id||trig.ghl_contact_id||''),recovery_used:recovery,energy_used:energy,intensity_band:intensity.band,mood_bucket:mood?mood.bucket:'n/a',has_mood:hasMood,adaptation_active:adapt.adaptationActive,sections:dashboardSections}}];
"""

BUILD_CODE = BA_CODE + "\n\n" + PROFILE_CODE

def code(id_, name, src, pos):
    return {"id": id_, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": src}}

nodes = [
    {"id": "trig", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2.1, "position": [80, 300],
     "parameters": {"httpMethod": "POST", "path": "build-briefing", "responseMode": "responseNode", "options": {}},
     "webhookId": "a1b2c3d4-0003-4000-8000-000000000020"},
    {"id": "resp", "name": "Respond 200", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [300, 440],
     "parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify({ ok: true }) }}", "options": {}}},
    {"id": "prof", "name": "loadProfile", "type": "n8n-nodes-base.airtable", "typeVersion": 2.2, "position": [300, 220],
     "alwaysOutputData": True, "credentials": AIR,
     "parameters": {"operation": "search", "base": {"__rl": True, "value": BASE, "mode": "list"},
        "table": {"__rl": True, "value": "={{ '" + PROFILE_TBL + "' }}", "mode": "id"},
        "filterByFormula": "={{ \"{client_id}='\" + ($('Webhook').first().json.body.client_id || 'client_test') + \"'\" }}",
        "returnAll": False, "limit": 1, "options": {}}},
    {"id": "bio", "name": "loadBiometrics", "type": "n8n-nodes-base.airtable", "typeVersion": 2.2, "position": [520, 220],