#!/usr/bin/env python3
"""Generate _meetings.json — the Supabase meeting-reminder workflow (Relentless AI, 2026-06-20).

Fires every minute; texts a polite SMS ~5 minutes before each Supabase `meetings` row,
exactly once (dedup via the `reminder_sent_at` column added by meetings_reminder.sql).

Phone resolution (production-correct, single-tenant for the demo):
  meetings.user_id  ->  Supabase profiles.client_id  ->  Airtable tbl_client_profile.phone_number

The Supabase service_role key is read from $env.SUPABASE_SERVICE_KEY (added to the Hetzner
container's /root/n8n/.env). The non-secret project URL falls back to the known client_test URL.
"""
import json, os

SUPA = "https://iqdkoufpiafbhmicbdsy.supabase.co"   # NEXT_PUBLIC URL (not secret); $env override allowed
BASE = "appjnWxg9sB3PV7Da"                            # client_test Airtable base (demo single-tenant)
AIR_CRED = {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}}
GHL_CRED = {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "GHL Relentless"}}

def supa_headers():
    return {
        "parameters": [
            {"name": "apikey", "value": "={{ $env.SUPABASE_SERVICE_KEY }}"},
            {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_SERVICE_KEY }}"},
        ]
    }

# ---- Code-node sources (kept in sync with _sim_meetings.js for offline tests) ----

COMPUTE_WINDOW = r"""
// scheduled_at is the precise meeting timestamp. meet_time is retained as a legacy fallback.
const SUPA = ($env.SUPABASE_URL) || 'https://iqdkoufpiafbhmicbdsy.supabase.co';
const url = SUPA + '/rest/v1/meetings?select=id,title,scheduled_at,meet_time,user_id&reminder_sent_at=is.null';
return [{ json: { supaUrl: SUPA, meetingsUrl: url } }];
"""

# LEAD_MIN = remind this many minutes before. scheduled_at is preferred; "HH:MM" remains a fallback.
SPLIT_MEETINGS = r"""
const LEAD_MIN = 5;
let arr = [];
const first = $input.first() ? $input.first().json : null;
if (Array.isArray(first)) arr = first;
else if (first && Array.isArray(first.data)) arr = first.data;
else if (first && first.id) arr = $input.all().map(i => i.json).filter(x => x && x.id);
const now = new Date();
function minutesUntil(mt) {
  if (!mt) return null;
  let t;
  if (/T/.test(mt) || /\d{4}-\d{2}-\d{2}/.test(mt)) {      // full ISO/datetime (forward-compatible)
    t = new Date(mt);
  } else {                                                 // bare "HH:MM" -> today, container-local
    const p = String(mt).split(':');
    const hh = parseInt(p[0], 10), mm = parseInt(p[1] || '0', 10);
    if (isNaN(hh)) return null;
    t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  }
  return (t - now) / 60000;
}
return arr
  .filter(m => m && m.id)
  .map(m => {
    const scheduled = m.scheduled_at || m.meet_time || null;
    const mu = minutesUntil(scheduled);
    return { meeting_id: m.id, title: (m.title || 'your meeting'), scheduled_at: m.scheduled_at || null, meet_time: m.meet_time || null,
             user_id: m.user_id || null, minutesUntil: mu };
  })
  .filter(x => x.minutesUntil !== null && x.minutesUntil <= LEAD_MIN && x.minutesUntil > -0.5)  // due in next ~5 min
  .map(x => ({ json: x }));
"""

NORMALIZE_PROFILE = r"""
// getProfile returned profiles?id=eq.<user_id> (array of 0/1). Pull client_id; carry meeting context.
let r = $input.first() ? $input.first().json : null;
let row = Array.isArray(r) ? r[0] : (r && Array.isArray(r.data) ? r.data[0] : r);
let client_id = (row && row.client_id) ? row.client_id : 'client_test';
const m = $('splitMeetings').item.json;
return [{ json: { client_id, meeting_id: m.meeting_id, title: m.title, scheduled_at: m.scheduled_at, meet_time: m.meet_time } }];
"""

BUILD_SMS = r"""
// getPhone (Airtable) returned the client_profile row; build a short plain-ASCII reminder.
let rec = $input.first().json;
let f = rec.fields ? rec.fields : rec;
let phone = (f.phone_number || '').toString().trim();
const ctx = $('normalizeProfile').item.json;
const ghl = $('getPhone').first() ? ($('getPhone').first().json.fields || $('getPhone').first().json) : {};
let title = String(ctx.title || 'your meeting').slice(0, 60);
let sms = 'Reminder: "' + title + '" starts in about 5 minutes.';
sms = sms.replace(/[—–]/g, '-').replace(/[''']/g, "'").replace(/["]/g, '"')
         .replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
const supa = ($env.SUPABASE_URL) || 'https://iqdkoufpiafbhmicbdsy.supabase.co';
const contactId = (ghl.ghl_contact_id || '').toString().trim();
return [{ json: {
  send: contactId.length > 0,   // GHL needs a contactId; skip clients without one (no hardcoded fallback)
  to: phone,
  sms,
  meeting_id: ctx.meeting_id,
  patchUrl: supa + '/rest/v1/meetings?id=eq.' + ctx.meeting_id,
  ghl_contact_id: contactId
}}];
"""

def node(id_, name, type_, ver, pos, params, **extra):
    n = {"id": id_, "name": name, "type": type_, "typeVersion": ver, "position": pos, "parameters": params}
    n.update(extra)
    return n

nodes = [
    node("mt", "When clicking Execute workflow", "n8n-nodes-base.manualTrigger", 1, [-280, -160], {}),
    node("sch", "Schedule Trigger", "n8n-nodes-base.scheduleTrigger", 1.2, [-280, 40],
         {"rule": {"interval": [{"field": "cronExpression", "expression": "* * * * *"}]}, "timezone": "Asia/Kolkata"}),
    node("cw", "computeWindow", "n8n-nodes-base.code", 2, [-40, -60], {"jsCode": COMPUTE_WINDOW}),
    node("gm", "getMeetings", "n8n-nodes-base.httpRequest", 4.2, [180, -60], {
        "method": "GET",
        "url": "={{ $json.meetingsUrl }}",
        "sendHeaders": True, "headerParameters": supa_headers(),
        "options": {"response": {"response": {"neverError": True}}},
    }, alwaysOutputData=True),
    node("sm", "splitMeetings", "n8n-nodes-base.code", 2, [400, -60], {"jsCode": SPLIT_MEETINGS}),
    node("gp", "getProfile", "n8n-nodes-base.httpRequest", 4.2, [620, -60], {
        "method": "GET",
        "url": "={{ ($env.SUPABASE_URL || 'https://iqdkoufpiafbhmicbdsy.supabase.co') + '/rest/v1/profiles?id=eq.' + $json.user_id + '&select=client_id' }}",
        "sendHeaders": True, "headerParameters": supa_headers(),
        "options": {"response": {"response": {"neverError": True}}},
    }, alwaysOutputData=True),
    node("np", "normalizeProfile", "n8n-nodes-base.code", 2, [840, -60], {"jsCode": NORMALIZE_PROFILE}),
    node("gph", "getPhone", "n8n-nodes-base.airtable", 2.2, [1060, -60], {
        "operation": "search",
        "base": {"__rl": True, "value": BASE, "mode": "list"},
        "table": {"__rl": True, "value": "={{ 'tbl_client_profile' }}", "mode": "id"},
        "filterByFormula": "={{ \"{client_id}='\" + $json.client_id + \"'\" }}",
        "returnAll": False, "limit": 1, "options": {},
    }, credentials=AIR_CRED, alwaysOutputData=True),
    node("bs", "buildSms", "n8n-nodes-base.code", 2, [1280, -60], {"jsCode": BUILD_SMS}),
    node("iff", "IsSend", "n8n-nodes-base.if", 2.3, [1500, -60], {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 3},
                        "conditions": [{"id": "c1", "leftValue": "={{ $json.send }}", "rightValue": "",
                                        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                        "combinator": "and"}, "options": {}}),
    node("snd", "sendReminder", "n8n-nodes-base.httpRequest", 4.2, [1720, -160], {
        "method": "POST",
        "url": "https://services.leadconnectorhq.com/conversations/messages",
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "Version", "value": "2021-04-15"},
            {"name": "Content-Type", "value": "application/json"}]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ type:'SMS', contactId: $json.ghl_contact_id, message: $json.sms }) }}",
        "options": {},
    }, credentials=GHL_CRED, onError="continueRegularOutput"),  # GHL send; fall through to markSent (no retry storm)
    node("mk", "markSent", "n8n-nodes-base.httpRequest", 4.2, [1940, -160], {
        "method": "PATCH",
        "url": "={{ $('buildSms').item.json.patchUrl }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": supa_headers()["parameters"] + [
            {"name": "Content-Type", "value": "application/json"},
            {"name": "Prefer", "value": "return=minimal"},
        ]},
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ reminder_sent_at: $now.toISO() }) }}",
        "options": {"response": {"response": {"neverError": True}}},
    }, onError="continueRegularOutput"),
]

def conn(src, dst, out=0):
    return (src, {"main": [[{"node": dst, "type": "main", "index": 0}]] if out == 0
                  else [[], [{"node": dst, "type": "main", "index": 0}]]})

connections = {}
def link(src, dst, branch=0):
    c = connections.setdefault(src, {"main": [[], []] if False else [[]]})
    # ensure enough branches
    while len(c["main"]) <= branch:
        c["main"].append([])
    c["main"][branch].append({"node": dst, "type": "main", "index": 0})

link("When clicking Execute workflow", "computeWindow")
link("Schedule Trigger", "computeWindow")
link("computeWindow", "getMeetings")
link("getMeetings", "splitMeetings")
link("splitMeetings", "getProfile")
link("getProfile", "normalizeProfile")
link("normalizeProfile", "getPhone")
link("getPhone", "buildSms")
link("buildSms", "IsSend")
link("IsSend", "sendReminder", branch=0)   # true
link("sendReminder", "markSent")

wf = {
    "id": "meetReminder1",
    "name": "Relentless AI - Meeting Reminders (5 min)",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "timezone": "Asia/Kolkata", "errorWorkflow": "errHandler01"},
    "active": False,
    "tags": [],
}

out = os.path.join(os.path.dirname(__file__), "_meetings.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(wf, fh, indent=2)
print("wrote", out, "nodes:", len(nodes))
