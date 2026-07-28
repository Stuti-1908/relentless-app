#!/usr/bin/env node
/* Rebuild onboard00001ghl to deliver all 7 onboarding messages during the client's
 * FIRST active day (waking hours), instead of one per calendar day.
 *
 * Design:
 *   - Hourly UTC cron (per-client local-time gate inside).
 *   - Each hourly run: if onboarding_day in 1..7 AND it's a sane local hour (8..20),
 *     send that day's message and advance onboarding_day +1.
 *   - 7 messages across ~13 waking hours => comfortably spaced, all on day 1, no fragile waits.
 *   - Fixes the broken-IIFE guard and the .first() single-client bug.
 *
 * Pulls onboard00001ghl out of _LIVE_workflows.json, patches it, appends to _REBUILT_workflows.json,
 * and marks it active.
 */
const fs = require("fs");
const path = require("path");
const live = JSON.parse(fs.readFileSync(path.join(__dirname, "_LIVE_workflows.json"), "utf8"));
const REB = path.join(__dirname, "_REBUILT_workflows.json");
const rebuilt = JSON.parse(fs.readFileSync(REB, "utf8"));

const w = JSON.parse(JSON.stringify(live.find((x) => x.id === "onboard00001ghl")));

// 1) hourly UTC cron
for (const n of w.nodes) {
  if (/scheduleTrigger/.test(n.type)) {
    n.parameters.rule = { interval: [{ field: "cronExpression", expression: "0 * * * *" }] };
    n.parameters.timezone = "UTC";
  }
}

// 2) rewrite decide: clean top-level local-hour gate (8..20) + per-item profile + day burst.
const decide = w.nodes.find((n) => n.name === "decide");
decide.parameters.jsCode = `// === TZ WAKING-HOURS GATE (8..20 local; returns [] to skip) ===
{
  var __it = $json.fields ? $json.fields : $json;
  var __tz = __it.timezone || 'America/New_York';
  var __now; try { __now = new Date(new Date().toLocaleString('en-US',{timeZone:__tz})); } catch(e){ __now = new Date(); }
  var __h = __now.getHours();
  if (__h < 8 || __h > 20) { return []; }
}
// === END TZ GATE ===

// Burst onboarding: one themed message per hourly run during waking hours, advancing the day,
// so all 7 land on the client's first active day. Per-item ($('loadProfile').item) = current client.
var pr = $('loadProfile').item.json; var p = pr.fields ? pr.fields : pr;
var rid = $('loadProfile').item.json.id || '';
var day = Number(p.onboarding_day || 0);
var THEMES = {
 1:'Day 1 welcome: warmly welcome them to Relentless AI, explain they will get a focused morning briefing and an evening Executive Score daily, and that replying helps it learn. Set the tone: this is a performance edge, not another app to manage.',
 2:'Day 2: explain the Executive Score - a 0-100 read across Body, Focus, Execution, Alignment - and that it is a signal to act on, not a grade.',
 3:'Day 3: explain the real-time nudges and that a quick reply (even one word) sharpens future coaching.',
 4:'Day 4: encourage them to log their morning recovery/energy so the briefing calibrates intensity to their real capacity.',
 5:'Day 5 midpoint: check in - what is working, what feels off - and remind them consistency over intensity wins.',
 6:'Day 6: reinforce one habit that is sticking and tie it to their 12-month goal.',
 7:'Day 7 mini-report: celebrate the first week, summarize the value, and invite one piece of feedback on what would make this more useful.'
};
if (!(day >= 1 && day <= 7)) { return [{ json: { send:false, rid:rid, phone:p.phone_number, reason:'onboarding complete or not started (day='+day+')' } }]; }
var sys = ['You are onboarding '+(p.full_name||'a new client')+' ('+(p.business_stage||'growing')+' stage) to Relentless AI executive coaching.',
 THEMES[day],
 'Write ONE warm, concise plain-text SMS under 280 chars, no emojis. Sound like a sharp human coach, not marketing.'].join('\\n');
return [{ json: { send:true, rid:rid, phone:p.phone_number, ghl_contact_id:(p.ghl_contact_id||''), client_id:(p.client_id||''),
  onboarding_day:day, next_day:day+1,
  body:{ model:'claude-sonnet-4-6', max_tokens:250, system:sys, messages:[{role:'user',content:'Write the day '+day+' onboarding message.'}] } }}];
`;

// 3) ensure advanceDay references the current item's rid (decide already emits rid; it reads $('decide')).
// advanceDay already maps onboarding_day from $('decide')...next_day per the live build — leave as-is.

// 4) activate
w.active = true;
if (w.settings) w.settings.timezone = "UTC";

// replace if already present, else append
const i = rebuilt.findIndex((x) => x.id === "onboard00001ghl");
if (i >= 0) rebuilt[i] = w; else rebuilt.push(w);
fs.writeFileSync(REB, JSON.stringify(rebuilt, null, 2));
console.log("onboard00001ghl: burst-on-day-1 rebuild done (hourly, waking-hours gate, per-item, ACTIVE). Rebuilt set now", rebuilt.length, "workflows.");
