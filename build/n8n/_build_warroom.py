#!/usr/bin/env python3
"""
_build_warroom.py — generate the War Room n8n workflow (Phase 9, demo-grade).

Stateful multi-turn SMS/HTTP session that wires the tested warRoom.js logic + Claude:
  WAR ROOM -> pick PROBLEM/OPPORTUNITY/STRATEGY -> describe -> Claude pressure-tests
  (DECOMPOSE/SOLVE/VERIFY with a probing question) -> client answers -> Claude SYNTHESIZE +
  committed action + confidence (REFLECT retry if <8) -> store tbl_war_room_sessions.

State lives in ONE tbl_war_room_sessions row per session (transcript_json holds the turns +
the current phase). Each inbound message is a separate execution that loads the active row,
advances the state machine, and updates it. Fully testable via curl (respondToWebhook returns
the reply), so it demos in a terminal with no SMS. For live SMS, point Twilio at /webhook/
war-room and either use the TwiML response or add a Twilio send node.

Gate: plan must be 'pro' (spec §12). Output: _warroom.json  (import, then activate).
"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "_warroom.json")

BASE_ID = "appjnWxg9sB3PV7Da"
WAR_TBL = "tblhCNFTPM9NevFuz"   # tbl_war_room_sessions
AIRTABLE_CRED = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
CLAUDE_CRED = {"httpHeaderAuth": {"id": "pcypOWLM78lgbOUQ", "name": "Header Auth account"}}

# ---- routeTurn: the state machine (inlines warRoom.js classify + confidence gates) ----
ROUTE_CODE = r"""
// ---- inlined from harness/scoring/warRoom.js (45 tests) ----
function classifySessionType(reply){ if(reply==null) return null;
  var f=String(reply).trim().toLowerCase().replace(/^[^a-z]+/,'').split(/\s+/)[0]||'';
  if(f.indexOf('problem')===0) return 'problem'; if(f.indexOf('opportunity')===0) return 'opportunity'; if(f.indexOf('strategy')===0) return 'strategy'; return null; }
// normalize either raw ('problem') or stored full ('problem_solving') form back to the raw key
function rawType(t){ t=String(t||''); if(t.indexOf('problem')===0) return 'problem'; if(t.indexOf('opportunity')===0) return 'opportunity'; if(t.indexOf('strateg')===0) return 'strategy'; return t; }
var SESSION_PROMPTS={
  problem:['Is this the real problem or a symptom?','What is the single root cause if you strip away the non-essential?','What would you do if your current approach were off the table?'],
  opportunity:['Which underexplored opportunity has the highest leverage vs effort?','What would have to be true for this to be your biggest win this quarter?','What is the cheapest experiment to validate it?'],
  strategy:['What should you STOP that no longer serves the 12-month goal?','What should you START that you have been avoiding?','What is working that you should DOUBLE DOWN on?'] };
function buildSystemPrompt(name,type,stage){
  var tl = type ? 'SESSION TYPE: '+type.toUpperCase()+'.' : 'SESSION TYPE: not chosen.';
  return ['You are a strategic thinking partner in a War Room session with '+(name||'the client')+', a '+(stage||'growing')+'-stage executive. You think from FIRST PRINCIPLES.',
    tl,
    'RULES: Pressure-test the client - do NOT validate them. Ask the uncomfortable avoided question. Strip every claim to what is provably true. Every reply ends with exactly one question OR one concrete action.',
    'METHOD: DECOMPOSE, SOLVE each part with a confidence 0.0-1.0, VERIFY (logic/facts/completeness/bias), then SYNTHESIZE weighted by confidence; if any part <0.8, REFLECT and retry it.',
    'OUTPUT: plain-text SMS, no emojis, under 320 characters.'].join('\n'); }

// Build a valid Anthropic messages array: non-empty content, first role=user, alternating roles
// (consecutive same-role turns are merged). This prevents the 400s that killed the synthesize turn.
function buildMsgs(tr){
  var msgs = (tr||[])
    .filter(function(m){ return m && (m.role==='user'||m.role==='assistant'); })
    .map(function(m){ return { role:(m.role==='assistant'?'assistant':'user'), content:String(m.text==null?'':m.text).trim() }; })
    .filter(function(m){ return m.content.length>0; });
  while(msgs.length && msgs[0].role==='assistant'){ msgs.shift(); }
  var merged=[];
  for(var i=0;i<msgs.length;i++){
    if(merged.length && merged[merged.length-1].role===msgs[i].role){ merged[merged.length-1].content += '\n\n' + msgs[i].content; }
    else { merged.push(msgs[i]); }
  }
  if(!merged.length){ merged=[{role:'user', content:'Continue the war room session.'}]; }
  return merged;
}

// ---- inputs ----
var body = $('Webhook').first().json.body || {};
var fromRaw = String(body.From||''); var toNumber = fromRaw.replace('whatsapp:','');
var text = String(body.Body||'').trim();
var upper = text.toUpperCase();

// profile (plan gate + name/stage)
var prof = {};
try { var pr = $('loadProfile').first().json; prof = pr.fields ? pr.fields : pr; } catch(e){ prof = {}; }
var plan = String(prof.plan||'standard').toLowerCase();
var name = prof.full_name || 'there';
var stage = prof.business_stage || 'growing';
var CID = prof.client_id || 'client_test';

// active session (most recent row for client with no committed_action yet)
var sess = null;
try {
  var rows = $('loadSession').all().map(function(it){ return (it.json&&it.json.fields)?Object.assign({_id:it.json.id},it.json.fields):(it.json||{}); })
    .filter(function(r){ return r && r.client_id===CID && (!r.committed_action || r.committed_action===''); });
  rows.sort(function(a,b){ return String(b.session_date||'').localeCompare(String(a.session_date||'')); });
  if(rows.length) sess = rows[0];
} catch(e){ sess = null; }

function parseTranscript(s){ try{ return JSON.parse(s.transcript_json||'[]'); }catch(e){ return []; } }

// ---- state machine ----
var out = { callClaude:false, reply:'', toNumber:toNumber, client_id:CID, plan:plan,
  rec_id:(sess?sess._id:''), session_id:(sess?sess.session_id:''), phase:'', session_type:(sess?sess.session_type:''),
  transcript:[], action:'', confidence:null, close:false };

// START: WAR ROOM trigger
if (!sess && (upper==='WAR ROOM' || upper==='WARROOM' || upper==='WAR')) {
  if (plan!=='pro') { out.reply='War Room is a Pro feature. Reply to your daily coaching as usual.'; out.phase='blocked'; return [{json:out}]; }
  out.session_id = 'wr_'+Date.now();
  out.phase='await_type'; out.transcript=[{role:'system',phase:'context',text:'session opened'}];
  out.reply='War Room activated, '+name+'. What are we solving today? Reply PROBLEM, OPPORTUNITY, or STRATEGY.';
  out.isNew=true; return [{json:out}];
}

if (!sess) { out.phase='none'; out.reply=''; out.ignore=true; return [{json:out}]; }

var tr = parseTranscript(sess);
var phase = sess.focus_topic || sess.phase || 'await_type';  // phase persisted in focus_topic (no phase column)
tr.push({role:'user', phase:phase, text:text});

if (phase==='await_type') {
  var ty = classifySessionType(text);
  if(!ty){ out.phase='await_type'; out.transcript=tr; out.reply='Reply one word: PROBLEM, OPPORTUNITY, or STRATEGY.'; return [{json:out}]; }
  out.session_type=ty; out.phase='await_describe'; out.transcript=tr;
  out.reply='Got it - '+ty.toUpperCase()+'. In one sentence: what is the situation, and what does solved look like?';
  return [{json:out}];
}

if (phase==='await_describe') {
  // call Claude: diagnosis + decompose/solve/verify, end with ONE probing question
  out.callClaude=true; out.phase='await_probe'; out.transcript=tr;
  var sp = SESSION_PROMPTS[rawType(sess.session_type)]||SESSION_PROMPTS.problem;
  var sys = buildSystemPrompt(name, sess.session_type, stage)+'\nPHASE: DIAGNOSIS. The client just described the situation. Pressure-test it: separate problem from symptom, name the key assumption, strip to what is provably true. Consider these angles: '+sp.join(' ')+' End with exactly ONE sharp probing question.';
  out.claude={ system:sys, messages: buildMsgs(tr) };
  return [{json:out}];
}

if (phase==='await_probe') {
  // call Claude: synthesize + committed action + confidence. Must end with: ACTION: <x> | CONFIDENCE: <1-10>
  out.callClaude=true; out.phase='closing'; out.transcript=tr;
  var sys2 = buildSystemPrompt(name, sess.session_type, stage)+'\nPHASE: SYNTHESIZE + COMMIT. Stop pressure-testing now. Do NOT ask another question. In two short sentences give ONE insight and ONE concrete action the client can do within 24h. Then on a FINAL separate line output EXACTLY this and nothing after it: ACTION: <the action> | CONFIDENCE: <integer 1-10>';
  out.claude={ system:sys2, messages: buildMsgs(tr) };
  return [{json:out}];
}

// fallback
out.phase=phase; out.transcript=tr; out.reply='Thanks. Reply DEEP to go deeper, or describe the next angle.';
return [{json:out}];
"""

# ---- afterClaude: parse Claude reply, extract ACTION/CONFIDENCE, finalize ----
AFTER_CLAUDE_CODE = r"""
var r = $('routeTurn').first().json;
var claudeText = '';
try { var c = $('callClaude').first().json; claudeText = (c.content && c.content[0] && c.content[0].text) ? c.content[0].text : ''; } catch(e){ claudeText=''; }
claudeText = String(claudeText||'').trim();

// EMPTY-GUARD: Claude returned nothing (API hiccup or sanitized-away). Do NOT emit reply:'' (the web
// shows "(no response)") and do NOT push an empty assistant turn (it would 400 the next call). Keep
// the session open + retryable; if we were closing, drop back to await_probe so the retry re-synthesizes.
if (!claudeText) {
  var retryPhase = (r.phase==='closing') ? 'await_probe' : r.phase;
  return [{ json: Object.assign({}, r, {
    reply: 'I hit a brief snag finishing that. Reply CONTINUE (or rephrase your last point) and I will pick it right back up.',
    claudeText:'', transcript: (r.transcript||[]), action:'', confidence:null, close:false, phase: retryPhase
  })}];
}

var tr = r.transcript || [];
tr.push({role:'assistant', phase:r.phase, text:claudeText});

var reply = claudeText;
var action=''; var confidence=null; var close=false;

if (r.phase==='closing') {
  // parse the final ACTION | CONFIDENCE line
  var m = claudeText.match(/ACTION:\s*(.+?)\s*\|\s*CONFIDENCE:\s*(\d{1,2})/i);
  if (m) { action = m[1].trim(); confidence = parseInt(m[2],10); }
  // strip the structured ACTION|CONFIDENCE line from the SMS the client sees (wherever it appears)
  reply = claudeText.replace(/\n?ACTION:[^\n]*\|\s*CONFIDENCE:\s*\d{1,2}[^\n]*/ig,'').replace(/\n{3,}/g,'\n\n').trim();
  if (confidence==null) {
    // Claude kept probing instead of committing the structured line — nudge once, stay retryable
    // (do NOT false-close with an empty committed_action, which leaves the session stuck open).
    r.phase='await_probe';
    reply = reply + '\n\nReply GO when ready and I will lock in your single 24-hour action.';
    close=false;
  } else if (confidence < 8) {
    // REFLECT gate (warRoom W5): one more pass, do not close yet
    r.phase='await_probe';
    reply = reply + '\n\nBefore we lock this in - what is the weakest assumption in that plan?';
    close=false;
  } else {
    close=true;
    reply = reply + (action ? ('\n\nCommitted: '+action+' (within 24h). I will check in tomorrow.') : '');
  }
}

return [{ json: Object.assign({}, r, {
  reply: reply, claudeText: claudeText, transcript: tr,
  action: action, confidence: confidence, close: close, phase: r.phase
})}];
"""

# ---- buildSessionPatch: produce Airtable fields for upsert ----
PATCH_CODE = r"""
var r = $input.first().json;
var nowISO = $now.toISO();
// Flat top-level keys = Airtable columns (defineBelow maps them null-safely). phase is
// persisted in focus_topic since the schema has no phase column.
var due = (r.close && r.action) ? new Date(Date.now()+24*60*60*1000).toISOString().slice(0,10) : null;
return [{ json: {
  session_id: r.session_id || ('wr_'+Date.now()),
  client_id: r.client_id,
  session_date: nowISO,
  transcript_json: JSON.stringify(r.transcript||[]),
  session_type: (function(t){ if(!t) return null; var x=String(t);
    if(x.indexOf('problem')===0) return 'problem_solving'; if(x.indexOf('opportunity')===0) return 'opportunity_mapping'; if(x.indexOf('strateg')===0) return 'strategic_review'; return null; })(r.session_type),
  committed_action: r.action || '',
  final_confidence: (r.confidence!=null) ? (r.confidence/10) : null,
  low_confidence_flag: (r.confidence!=null) ? (r.confidence<8) : false,
  action_due_date: due,
  focus_topic: r.phase || '',
  reply: r.reply || '',
  ignore: !!r.ignore,
  persist: !r.ignore && r.phase !== 'blocked' && r.phase !== 'none'
}}];
"""

def code_node(node_id, name, code, pos):
    return {"id": node_id, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": code}}

nodes = [
    {"id": "wh-wr-1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2.1, "position": [120, 300],
     "parameters": {"httpMethod": "POST", "path": "war-room", "responseMode": "responseNode", "options": {}}, "webhookId": "a1b2c3d4-0002-4000-8000-000000000003"},

    {"id": "load-prof-1", "name": "loadProfile", "type": "n8n-nodes-base.airtable", "typeVersion": 2.2, "position": [320, 200],
     "alwaysOutputData": True, "credentials": AIRTABLE_CRED,
     "parameters": {"operation": "search", "base": {"__rl": True, "value": BASE_ID, "mode": "list"},
        "table": {"__rl": True, "value": "={{ 'tbl_client_profile' }}", "mode": "id"},
        "filterByFormula": "={{ \"OR({phone_number}='\" + (($('Webhook').first().json.body.From||'').replace('whatsapp:','')) + \"', {ghl_contact_id}='\" + ($('Webhook').first().json.body.contactId||'') + \"')\" }}",
        "returnAll": False, "limit": 1, "options": {}}},

    {"id": "load-sess-1", "name": "loadSession", "type": "n8n-nodes-base.airtable", "typeVersion": 2.2, "position": [320, 400],
     "alwaysOutputData": True, "credentials": AIRTABLE_CRED,
     "parameters": {"operation": "search", "base": {"__rl": True, "value": BASE_ID, "mode": "list"},
        "table": {"__rl": True, "value": WAR_TBL, "mode": "list", "cachedResultName": "tbl_war_room_sessions"},
        "filterByFormula": "={{ \"{committed_action}=''\" }}",
        "returnAll": False, "limit": 10, "sort": {"property": [{"field": "session_date", "direction": "desc"}]}, "options": {}}},

    code_node("route-1", "routeTurn", ROUTE_CODE, [540, 300]),

    {"id": "if-claude-1", "name": "needsClaude", "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": [760, 300],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
        "conditions": [{"id": "c1", "leftValue": "={{ $json.callClaude }}", "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"}, "options": {}}},

    {"id": "claude-1", "name": "callClaude", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [980, 180],
     "credentials": CLAUDE_CRED, "onError": "continueRegularOutput",
     "parameters": {"method": "POST", "url": "https://api.anthropic.com/v1/messages",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True, "headerParameters": {"parameters": [{"name": "anthropic-version", "value": "2023-06-01"}]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:400, system: $json.claude.system, messages: $json.claude.messages }) }}",
        "options": {}}},

    code_node("after-1", "afterClaude", AFTER_CLAUDE_CODE, [1200, 180]),
    code_node("patch-1", "buildSessionPatch", PATCH_CODE, [1420, 300]),

    {"id": "if-persist-1", "name": "shouldPersist", "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": [1640, 300],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
        "conditions": [{"id": "cp1", "leftValue": "={{ $json.persist }}", "rightValue": "", "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"}, "options": {}}},

    {"id": "upsert-1", "name": "upsertSession", "type": "n8n-nodes-base.airtable", "typeVersion": 2.2, "position": [1860, 200],
     "alwaysOutputData": True, "onError": "continueRegularOutput", "credentials": AIRTABLE_CRED,
     "parameters": {"operation": "upsert", "base": {"__rl": True, "value": BASE_ID, "mode": "list"},
        "table": {"__rl": True, "value": WAR_TBL, "mode": "list", "cachedResultName": "tbl_war_room_sessions"},
        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["session_id"],
          "value": {
            "session_id": "={{ $json.session_id }}",
            "client_id": "={{ $json.client_id }}",
            "session_date": "={{ $json.session_date }}",
            "transcript_json": "={{ $json.transcript_json }}",
            "session_type": "={{ $json.session_type }}",
            "committed_action": "={{ $json.committed_action }}",
            "final_confidence": "={{ $json.final_confidence }}",
            "low_confidence_flag": "={{ $json.low_confidence_flag }}",
            "action_due_date": "={{ $json.action_due_date }}",
            "focus_topic": "={{ $json.focus_topic }}"
          },
          "schema": []},
        "options": {"typecast": True}}},

    {"id": "resp-1", "name": "Respond", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [2080, 300],
     "parameters": {"respondWith": "json", "responseBody": "={{ JSON.stringify({ reply: $('buildSessionPatch').first().json.reply }) }}", "options": {}}},
]

# routeTurn -> needsClaude. needsClaude true -> callClaude -> afterClaude -> buildSessionPatch.
# needsClaude false -> buildSessionPatch (uses routeTurn output directly via $input).
# For the false branch, buildSessionPatch reads $input.first() which will be the routeTurn item.
connections = {
    "Webhook": {"main": [[{"node": "loadProfile", "type": "main", "index": 0}]]},
    "loadProfile": {"main": [[{"node": "loadSession", "type": "main", "index": 0}]]},
    "loadSession": {"main": [[{"node": "routeTurn", "type": "main", "index": 0}]]},
    "routeTurn": {"main": [[{"node": "needsClaude", "type": "main", "index": 0}]]},
    "needsClaude": {"main": [
        [{"node": "callClaude", "type": "main", "index": 0}],
        [{"node": "buildSessionPatch", "type": "main", "index": 0}]
    ]},
    "callClaude": {"main": [[{"node": "afterClaude", "type": "main", "index": 0}]]},
    "afterClaude": {"main": [[{"node": "buildSessionPatch", "type": "main", "index": 0}]]},
    "buildSessionPatch": {"main": [[{"node": "shouldPersist", "type": "main", "index": 0}]]},
    "shouldPersist": {"main": [
        [{"node": "upsertSession", "type": "main", "index": 0}],
        [{"node": "Respond", "type": "main", "index": 0}]
    ]},
    "upsertSession": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
}

wf = {"id": "warRoom0001", "name": "Relentless AI - War Room (Pro, demo)", "nodes": nodes,
      "connections": connections, "settings": {"executionOrder": "v1", "timezone": "Asia/Kolkata"},
      "active": False, "tags": []}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(wf, f, indent=2)
print("Wrote", OUT, "with", len(nodes), "nodes")
