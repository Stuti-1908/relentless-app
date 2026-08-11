#!/usr/bin/env python3
"""_build_infer_industry.py -> _infer_industry.json

One-time workflow: infer each active client's industry from the only real
signal available (GHL task titles + recent nudge_content), since top_priority_1
is null for every current client and industry/market_keywords never existed as
a column before 007_add_industry_column.sql.

Deliberately conservative: Claude is asked to also return a confidence 0-1, and
anything below CONFIDENCE_THRESHOLD is left null rather than written as a guess
-- a wrong industry silently poisons every future Market Intelligence send for
that client, so "no signal" must stay distinguishable from "confidently wrong."

This workflow does NOT write to Supabase directly. It stops at a Code node
(reviewOutput) that assembles the full per-client result (name, inferred
industry, confidence, and the raw evidence Claude was given) so the output can
be read from the n8n execution and reviewed before a second, explicit write
step is run. See the workflow's own inline comments for the two-phase design.

Prerequisite: 007_add_industry_column.sql must be applied in Supabase first
(adds client_profile.industry / market_keywords + updates v_clients to expose
them). This workflow will run without it, but the eventual write step will
fail with a missing-column error if you skip it.

Usage:
    python _build_infer_industry.py           # writes _infer_industry.json only
Then deploy manually (or via the standard import/activate/restart sequence)
and execute it once from the n8n editor -- MANUAL TRIGGER ONLY, this should
never be scheduled or left active.
"""
import json, os

AIR = None  # no Airtable anywhere in this workflow -- Supabase + GHL only
SUPA_CRED = {"supabaseApi": {"id": "gSbZ6Y52r8jgE7xQ", "name": "Supabase - Relentless AI"}}
CLAUDE_CRED = {"httpHeaderAuth": {"id": "pcypOWLM78lgbOUQ", "name": "Header Auth account"}}
GHL_CRED_CANDIDATES = None  # resolved from an existing workflow at deploy time if needed

CONFIDENCE_THRESHOLD = 0.6

BUILD_PROMPT = r"""
// One item per active client. Gathers GHL task titles + recent nudge_content
// as the evidence for Claude to infer an industry from.
//
// Reads the client row from Loop Over Clients explicitly, NOT from $json --
// this node runs after getGhlTasks/getNudges (parallel side-fetches feeding
// evidence), so $json here is whichever of those two happened to arrive, never
// the client row itself. This was the root cause of a real bug in the first
// run of this script: client_id came back empty for every item, which also
// broke getGhlTasks (empty contactId in its URL) and made every loop
// iteration silently reuse client_test's data instead of advancing.
var p = $('Loop Over Clients').item.json;
p = p.fields ? p.fields : p;
var client_id = p.client_id || '';
var name = p.full_name || 'this client';
var stage = p.business_stage || 'growing';

var tasks = [];
try {
  var tj = $('getGhlTasks').item.json || {};
  var tl = Array.isArray(tj.tasks) ? tj.tasks : [];
  tasks = tl.filter(function(t){ return t && t.title; }).slice(0, 15).map(function(t){ return t.title; });
} catch(e) { tasks = []; }

var nudges = [];
try {
  nudges = $('getNudges').all().map(function(it){ return (it.json&&it.json.fields)?it.json.fields:(it.json||{}); })
    .filter(function(n){ return n && n.client_id===client_id && n.nudge_content; })
    .slice(0, 10).map(function(n){ return n.nudge_content; });
} catch(e) { nudges = []; }

var evidence = tasks.concat(nudges);
if (!evidence.length) {
  return [{ json: { client_id: client_id, name: name, skip: true, reason: 'no task or nudge evidence', evidence: [] } }];
}

var sys = [
  'You infer a client\'s business industry from fragments of their real task list and coaching nudges.',
  'Client: ' + name + ', a ' + stage + '-stage executive.',
  'EVIDENCE (task titles and coaching nudges, may be sparse or ambiguous):',
  evidence.map(function(e,i){ return (i+1) + '. ' + e; }).join('\n'),
  '',
  'Respond with ONLY a JSON object, no other text: {"industry": "<short label, 2-4 words, e.g. \'web hosting / agency services\'>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>"}',
  'If the evidence is too generic or contradictory to support a real guess (e.g. "call the bank", "block deep work time" with nothing industry-specific), set confidence below 0.4 rather than forcing a label.'
].join('\n');

return [{ json: {
  client_id: client_id, name: name, skip: false, evidence: evidence,
  body: { model: 'claude-sonnet-4-6', max_tokens: 200, system: sys,
    messages: [{ role: 'user', content: 'Infer the industry now.' }] }
} }];
""".strip()

EXTRACT = r"""
var ctx = $('buildPrompt').item.json;
if (ctx.skip) return [{ json: Object.assign({}, ctx, { industry: null, confidence: 0, write: false }) }];

var raw = '';
try {
  var c = $json;
  raw = (c.content && c.content[0] && c.content[0].text) ? c.content[0].text : '';
} catch(e) { raw = ''; }

var parsed = null;
try { parsed = JSON.parse(raw); } catch(e) {
  // tolerate a stray code fence or leading text around the JSON object
  var m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { parsed = JSON.parse(m[0]); } catch(e2) { parsed = null; } }
}

var THRESHOLD = __THRESHOLD__;
if (!parsed || typeof parsed.industry !== 'string' || typeof parsed.confidence !== 'number') {
  return [{ json: Object.assign({}, ctx, { industry: null, confidence: 0, write: false, parse_failed: true, raw: raw.slice(0, 200) }) }];
}

var write = parsed.confidence >= THRESHOLD;
return [{ json: Object.assign({}, ctx, {
  industry: write ? parsed.industry : null,
  confidence: parsed.confidence,
  reasoning: parsed.reasoning || '',
  write: write
}) }];
""".strip().replace("__THRESHOLD__", str(CONFIDENCE_THRESHOLD))

REVIEW = r"""
// Terminal node -- assembles the full per-client review row. Nothing past
// this point writes to Supabase. Read this execution's output, confirm the
// industry guesses look right, THEN run a second explicit write step
// (build/n8n/_build_apply_industry.py, generated from this review's approved
// output) -- do not skip straight to writing from here.
var r = $json;
return [{ json: {
  client_id: r.client_id,
  name: r.name,
  industry: r.industry,
  confidence: r.confidence != null ? Math.round(r.confidence * 100) / 100 : null,
  will_write: !!r.write,
  reasoning: r.reasoning || (r.skip ? r.reason : (r.parse_failed ? 'Claude response did not parse as JSON' : '')),
  evidence_used: (r.evidence || []).join(' | ')
} }];
""".strip()


def code(node_id, name, js, pos):
    return {"id": node_id, "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos, "parameters": {"jsCode": js}}


nodes = [
    {"id": "m", "name": "When clicking Execute workflow", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [80, 260], "parameters": {}},
    {"id": "prof", "name": "loadClients", "type": "n8n-nodes-base.supabase", "typeVersion": 1, "position": [300, 260],
     "credentials": SUPA_CRED,
     "parameters": {"operation": "getAll", "tableId": "v_clients", "returnAll": True,
                    "filters": {"conditions": [{"keyName": "active", "condition": "eq", "keyValue": "true"}]}}},
    {"id": "loop", "name": "Loop Over Clients", "type": "n8n-nodes-base.splitInBatches", "typeVersion": 3, "position": [520, 260],
     "parameters": {"batchSize": 1, "options": {}}},
    # per-client GHL tasks -- same endpoint eodPro00001ghl/nudgeEngineGhl1 already use
    {"id": "tasks", "name": "getGhlTasks", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [740, 180],
     "onError": "continueRegularOutput",
     "parameters": {"method": "GET",
                     "url": "={{ 'https://services.leadconnectorhq.com/contacts/' + (($json.fields ? $json.fields : $json).ghl_contact_id || '') + '/tasks' }}",
                     "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                     "sendHeaders": True,
                     "headerParameters": {"parameters": [{"name": "Version", "value": "2021-07-28"}, {"name": "Accept", "value": "application/json"}]},
                     "options": {}}},
    {"id": "nudg", "name": "getNudges", "type": "n8n-nodes-base.supabase", "typeVersion": 1, "position": [740, 340],
     "credentials": SUPA_CRED,
     "parameters": {"operation": "getAll", "tableId": "nudges", "returnAll": False, "limit": 300}},
    code("bp", "buildPrompt", BUILD_PROMPT, [960, 260]),
    {"id": "if1", "name": "HasEvidence", "type": "n8n-nodes-base.if", "typeVersion": 2.3, "position": [1180, 260],
     "parameters": {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                                    "conditions": [{"id": "c", "leftValue": "={{ $json.skip }}", "rightValue": "",
                                                    "operator": {"type": "boolean", "operation": "false", "singleValue": True}}],
                                    "combinator": "and"}, "options": {}}},
    {"id": "claude", "name": "callClaude", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1400, 180],
     "credentials": CLAUDE_CRED, "onError": "continueRegularOutput",
     "parameters": {"method": "POST", "url": "https://api.anthropic.com/v1/messages",
                     "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                     "sendHeaders": True, "headerParameters": {"parameters": [{"name": "anthropic-version", "value": "2023-06-01"}]},
                     "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.body) }}", "options": {}}},
    code("ex", "extract", EXTRACT, [1620, 180]),
    code("rv", "reviewOutput", REVIEW, [1840, 260]),
]

connections = {
    "When clicking Execute workflow": {"main": [[{"node": "loadClients", "type": "main", "index": 0}]]},
    "loadClients": {"main": [[{"node": "Loop Over Clients", "type": "main", "index": 0}]]},
    "Loop Over Clients": {"main": [[], [{"node": "getGhlTasks", "type": "main", "index": 0}, {"node": "getNudges", "type": "main", "index": 0}]]},
    "getGhlTasks": {"main": [[{"node": "buildPrompt", "type": "main", "index": 0}]]},
    "getNudges": {"main": [[{"node": "buildPrompt", "type": "main", "index": 0}]]},
    "buildPrompt": {"main": [[{"node": "HasEvidence", "type": "main", "index": 0}]]},
    "HasEvidence": {"main": [[{"node": "callClaude", "type": "main", "index": 0}], [{"node": "reviewOutput", "type": "main", "index": 0}]]},
    "callClaude": {"main": [[{"node": "extract", "type": "main", "index": 0}]]},
    "extract": {"main": [[{"node": "reviewOutput", "type": "main", "index": 0}]]},
    "reviewOutput": {"main": [[{"node": "Loop Over Clients", "type": "main", "index": 0}]]},
}

wf = {"id": "inferIndustry1", "name": "ONE-OFF - Infer Client Industry (review before write)",
      "nodes": nodes, "connections": connections,
      "settings": {"executionOrder": "v1"}, "active": False, "tags": []}

out = os.path.join(os.path.dirname(__file__), "_infer_industry.json")
json.dump(wf, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", out, "| nodes:", len(nodes))
