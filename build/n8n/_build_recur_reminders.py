#!/usr/bin/env python3
"""Generate _recur_reminders.json — recurring task reminders (Relentless AI, 2026-06-29).

Hourly cron (UTC). For each active client, reads their recurring tasks from Supabase, applies a
per-client LOCAL-time gate (profiles.timezone) + recurrence match (daily/weekly/monthly), and on a
match: sends a GHL SMS, stamps tasks.last_reminded_on (dedup = once per occurrence), and opens a
tbl_pending_replies row (expected_type=recurring_reminder) so the inbound router can ack DONE/SKIP.

Mirrors the proven meetReminder1 pattern (Supabase REST read/patch via $env.SUPABASE_SERVICE_KEY,
GHL send cred fLewYZwvD9PfMAQJ, Airtable phone lookup cred Z1DGfO9LPHXmAo4W).

Tasks schema (Supabase, added 2026-06-29):
  repeat_rule text ('none'|'daily'|'weekly'|'monthly'), repeat_days int[],
  remind_at time, last_reminded_on date, reminder_active boolean
"""
import json, os

BASE = "appjnWxg9sB3PV7Da"
AIR_CRED = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
GHL_CRED = {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "Header Auth account 2"}}

def supa_headers(extra=None):
    p = [
        {"name": "apikey", "value": "={{ $env.SUPABASE_SERVICE_KEY }}"},
        {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_SERVICE_KEY }}"},
    ]
    if extra:
        p += extra
    return {"parameters": p}

# Build the Supabase REST URL: recurring, active, not yet reminded today (today computed per-UTC; the
# precise once-per-local-day dedup is enforced by last_reminded_on stamping at the client's local date).
COMPUTE_URL = r"""
const SUPA = ($env.SUPABASE_URL) || 'https://iqdkoufpiafbhmicbdsy.supabase.co';
// pull all recurring + active tasks; per-client local gating happens in splitTasks.
const sel = 'id,user_id,title,repeat_rule,repeat_days,remind_at,last_reminded_on,reminder_active';
const url = SUPA + '/rest/v1/tasks?select=' + sel +
  '&repeat_rule=neq.none&reminder_active=is.true';
return [{ json: { supaUrl: SUPA, tasksUrl: url } }];
"""

# Per-task: resolve the client's tz (needs a profiles lookup), but to keep one round-trip we instead
# carry user_id forward and resolve client_id+tz+phone downstream — same as meetReminder1. Here we only
# pre-filter by shape; the LOCAL-time + recurrence match happens AFTER we know the timezone (matchFire).
SPLIT_TASKS = r"""
let arr = [];
const first = $input.first() ? $input.first().json : null;
if (Array.isArray(first)) arr = first;
else if (first && Array.isArray(first.data)) arr = first.data;
else if (first && first.id) arr = $input.all().map(i => i.json).filter(x => x && x.id);
return arr.filter(t => t && t.id && t.repeat_rule && t.repeat_rule !== 'none')
  .map(t => ({ json: {
    task_id: t.id, user_id: t.user_id || null, title: (t.title || 'your reminder'),
    repeat_rule: t.repeat_rule, repeat_days: Array.isArray(t.repeat_days) ? t.repeat_days : [],
    remind_at: t.remind_at || null, last_reminded_on: t.last_reminded_on || null
  }}));
"""

# After getProfile (client_id) + getPhone (Airtable: phone + ghl_contact_id + timezone), decide if this
# task fires NOW for this client in THEIR local time, and whether we already sent today (dedup).
MATCH_FIRE = r"""
const task = $('splitTasks').item.json;
const recAll = $('getPhone').first() ? ($('getPhone').first().json.fields || $('getPhone').first().json) : {};
const tz = recAll.timezone || 'America/New_York';
const contactId = (recAll.ghl_contact_id || '').toString().trim();

let now;
try { now = new Date(new Date().toLocaleString('en-US', { timeZone: tz })); }
catch (e) { now = new Date(); }
const localHour = now.getHours();
const localDow  = now.getDay();        // 0=Sun..6=Sat
const localDom  = now.getDate();       // 1..31
// local YYYY-MM-DD for dedup
const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
const localDate = y + '-' + m + '-' + d;

// remind_at "HH:MM[:SS]" -> target hour
let targetHour = null;
if (task.remind_at) { const hh = parseInt(String(task.remind_at).split(':')[0], 10); if (!isNaN(hh)) targetHour = hh; }

let fires = false;
if (targetHour !== null && localHour === targetHour) {
  if (task.repeat_rule === 'daily') fires = true;
  else if (task.repeat_rule === 'weekly') fires = (task.repeat_days || []).map(Number).indexOf(localDow) >= 0;
  else if (task.repeat_rule === 'monthly') fires = (task.repeat_days || []).map(Number).indexOf(localDom) >= 0;
}
// dedup: already sent today (local date)?
if (fires && task.last_reminded_on && String(task.last_reminded_on).slice(0,10) === localDate) fires = false;

let title = String(task.title || 'your reminder').slice(0, 80);
let sms = 'Reminder: ' + title + '. Reply DONE when done, or SKIP.';
sms = sms.replace(/[—–]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
         .replace(/[^\x00-\x7F]/g,'').replace(/\s+/g,' ').trim().slice(0,160);

const SUPA = ($env.SUPABASE_URL) || 'https://iqdkoufpiafbhmicbdsy.supabase.co';
const client_id = ($('normalizeProfile').item.json.client_id) || '';
return [{ json: {
  send: !!(fires && contactId),
  task_id: task.task_id, title: title, sms: sms,
  ghl_contact_id: contactId, client_id: client_id, tz: tz, local_date: localDate,
  patchUrl: SUPA + '/rest/v1/tasks?id=eq.' + task.task_id
}}];
"""

NORMALIZE_PROFILE = r"""
let r = $input.first() ? $input.first().json : null;
let row = Array.isArray(r) ? r[0] : (r && Array.isArray(r.data) ? r.data[0] : r);
let client_id = (row && row.client_id) ? row.client_id : '';
const t = $('splitTasks').item.json;
return [{ json: { client_id, task_id: t.task_id, title: t.title, repeat_rule: t.repeat_rule,
  repeat_days: t.repeat_days, remind_at: t.remind_at, last_reminded_on: t.last_reminded_on,
  user_id: t.user_id } }];
"""

def node(id_, name, type_, ver, pos, params, **extra):
    n = {"id": id_, "name": name, "type": type_, "typeVersion": ver, "position": pos, "parameters": params}
    n.update(extra)
    return n

nodes = [
    node("rt-m", "When clicking Execute workflow", "n8n-nodes-base.manualTrigger", 1, [-320, -160], {}),
    node("rt-s", "Schedule Trigger", "n8n-nodes-base.scheduleTrigger", 1.2, [-320, 40],
         {"rule": {"interval": [{"field": "cronExpression", "expression": "0 * * * *"}]}, "timezone": "UTC"}),
    node("rt-cu", "computeUrl", "n8n-nodes-base.code", 2, [-100, -60], {"jsCode": COMPUTE_URL}),
    node("rt-gt", "getTasks", "n8n-nodes-base.httpRequest", 4.2, [120, -60], {
        "method": "GET", "url": "={{ $json.tasksUrl }}",
        "sendHeaders": True, "headerParameters": supa_headers(),
        "options": {"response": {"response": {"neverError": True}}},
    }, alwaysOutputData=True),
    node("rt-st", "splitTasks", "n8n-nodes-base.code", 2, [340, -60], {"jsCode": SPLIT_TASKS}),
    node("rt-gp", "getProfile", "n8n-nodes-base.httpRequest", 4.2, [560, -60], {
        "method": "GET",
        "url": "={{ ($env.SUPABASE_URL || 'https://iqdkoufpiafbhmicbdsy.supabase.co') + '/rest/v1/profiles?id=eq.' + $json.user_id + '&select=client_id' }}",
        "sendHeaders": True, "headerParameters": supa_headers(),
        "options": {"response": {"response": {"neverError": True}}},
    }, alwaysOutputData=True),
    node("rt-np", "normalizeProfile", "n8n-nodes-base.code", 2, [780, -60], {"jsCode": NORMALIZE_PROFILE}),
    node("rt-gph", "getPhone", "n8n-nodes-base.airtable", 2.2, [1000, -60], {
        "operation": "search",
        "base": {"__rl": True, "value": BASE, "mode": "list"},
        "table": {"__rl": True, "value": "={{ 'tbl_client_profile' }}", "mode": "id"},
        "filterByFormula": "={{ \"{client_id}='\" + $json.client_id + \"'\" }}",
        "returnAll": False, "limit": 1, "options": {},
    }, credentials=AIR_CRED, alwaysOutputData=True),
    node("rt-mf", "matchFire", "n8n-nodes-base.code", 2, [1220, -60], {"jsCode": MATCH_FIRE}),
    node("rt-if", "IsSend", "n8n-nodes-base.if", 2.3, [1440, -60], {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
                        "conditions": [{"id": "c1", "leftValue": "={{ $json.send }}", "rightValue": "",
                                        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                        "combinator": "and"}, "options": {}}),
    node("rt-snd", "sendReminder", "n8n-nodes-base.httpRequest", 4.2, [1660, -160], {
        "method": "POST", "url": "https://services.leadconnectorhq.com/conversations/messages",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "Version", "value": "2021-04-15"},
            {"name": "Content-Type", "value": "application/json"}]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ type:'SMS', contactId: $json.ghl_contact_id, message: $json.sms }) }}",
        "options": {},
    }, credentials=GHL_CRED, onError="continueRegularOutput"),
    node("rt-mk", "markReminded", "n8n-nodes-base.httpRequest", 4.2, [1880, -160], {
        "method": "PATCH",
        "url": "={{ $('matchFire').item.json.patchUrl }}",
        "sendHeaders": True,
        "headerParameters": supa_headers([
            {"name": "Content-Type", "value": "application/json"},
            {"name": "Prefer", "value": "return=minimal"},
        ]),
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ last_reminded_on: $('matchFire').item.json.local_date }) }}",
        "options": {"response": {"response": {"neverError": True}}},
    }, onError="continueRegularOutput"),
    node("rt-oc", "openConversation", "n8n-nodes-base.airtable", 2.2, [2100, -160], {
        "operation": "create",
        "base": {"__rl": True, "value": BASE, "mode": "list"},
        "table": {"__rl": True, "value": "={{ 'tbl_pending_replies' }}", "mode": "id"},
        "columns": {"mappingMode": "defineBelow", "matchingColumns": ["pending_id"], "schema": [], "value": {
            "pending_id": "={{ 'pr_' + $now.toMillis() + '_recurring' }}",
            "client_id": "={{ $('matchFire').item.json.client_id }}",
            "expected_type": "recurring_reminder",
            "context_ref": "={{ JSON.stringify({ type:'recurring_reminder', task_id: $('matchFire').item.json.task_id, title: $('matchFire').item.json.title, opened_by:'recurReminder1' }) }}",
            "opened_at": "={{ $now.toISO() }}",
            "expires_at": "={{ $now.plus({ hours: 6 }).toISO() }}",
            "status": "open",
            "ghl_contact_id": "={{ $('matchFire').item.json.ghl_contact_id }}",
        }},
        "options": {"typecast": True},
    }, credentials=AIR_CRED, onError="continueRegularOutput"),
]

connections = {}
def link(src, dst, branch=0):
    c = connections.setdefault(src, {"main": [[]]})
    while len(c["main"]) <= branch:
        c["main"].append([])
    c["main"][branch].append({"node": dst, "type": "main", "index": 0})

link("When clicking Execute workflow", "computeUrl")
link("Schedule Trigger", "computeUrl")
link("computeUrl", "getTasks")
link("getTasks", "splitTasks")
link("splitTasks", "getProfile")
link("getProfile", "normalizeProfile")
link("normalizeProfile", "getPhone")
link("getPhone", "matchFire")
link("matchFire", "IsSend")
link("IsSend", "sendReminder", branch=0)   # true
link("sendReminder", "markReminded")
link("markReminded", "openConversation")

wf = {
    "id": "recurReminder1",
    "name": "Relentless AI - Recurring Task Reminders",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "timezone": "UTC", "errorWorkflow": "errHandler01"},
    "active": False,
    "tags": [],
}

out = os.path.join(os.path.dirname(__file__), "_recur_reminders.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(wf, fh, indent=2)
print("wrote", out, "nodes:", len(nodes))
