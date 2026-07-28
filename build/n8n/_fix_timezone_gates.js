#!/usr/bin/env node
/* Fix per-client timezone delivery across all scheduled senders.
 *
 * Problems found in live export (_LIVE_workflows.json, 2026-06-29):
 *  (1) The timezone guard was wrapped in an IIFE `(function(){... return []; })()`
 *      so its `return []` only exited the IIFE, never the Code node -> guard was a no-op.
 *  (2) Crons were fixed-time on Asia/Kolkata, so even a working guard had no chance to
 *      fire at each client's local target hour.
 *  (3) Three senders had no guard at all.
 *
 * Fix: a clean TOP-LEVEL guard that matches a SINGLE local target hour per workflow,
 * + switch each scheduled trigger to hourly (0 * * * *) in UTC so the guard decides per client.
 * Single-hour match means hourly firing delivers exactly once per client per local day.
 *
 * Input:  _LIVE_workflows.json
 * Output: _REBUILT_workflows.json (only the changed workflows, ready to import)
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "_LIVE_workflows.json");
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));

// workflowId -> { node: <code node name to host the guard>, hour: <local target hour>, day?: <0-6 local DOW or null> }
const PLAN = {
  morningCheckin1: { node: "decide", hour: 6 },              // 6 AM local check-in
  eodPro00001ghl:  { node: "computeScore", hour: 19 },        // 7 PM local EoD
  stageTrans01ghl: { node: "decide", hour: 6, day: 1 },       // Mon 6 AM local
  market000001:    { node: "decide", hour: 5 },               // 5 AM local market signal
  nudgeEngineGhl1: { node: null, hour: null },                // special: window 8-18, handled separately
  weekly000001ghl: { node: "decide", hour: 19, day: 0 },      // Sun 7 PM local (needs guard added)
  briefFallback1:  { node: null, hour: 7 },                   // 7 AM local fallback (guard added to first code node)
  slaMonitor1:     { node: null, hour: 6, day: null },        // Mon-Fri 6:45 -> keep simple, ops alert; leave as-is for now
};

// The clean, TOP-LEVEL guard. Returns [] (skips the item) when the client's local
// hour != target (and, if specified, local day-of-week != target). Single-hour match.
function guardCode(hour, day) {
  return `// === TZ GATE (top-level; returns [] to skip this client) ===
{
  var __it = $json.fields ? $json.fields : $json;
  var __tz = __it.timezone || 'America/New_York';
  var __now;
  try { __now = new Date(new Date().toLocaleString('en-US', { timeZone: __tz })); }
  catch (e) { __now = new Date(); }
  var __h = __now.getHours();
  var __target = ${hour};
  if (__h !== __target) { return []; }
  ${day != null ? `var __dow = __now.getDay(); if (__dow !== ${day}) { return []; }` : ``}
}
// === END TZ GATE ===
`;
}

// Strip any prior guard block (the broken IIFE version or a previous top-level version).
function stripOldGuard(code) {
  // Remove an IIFE guard: (function(){ ... TIMEZONE ... })();
  code = code.replace(/\(function\(\)\{[\s\S]*?TIMEZONE[\s\S]*?\}\)\(\);?/i, "");
  // Remove a prior top-level "=== TZ GATE ===" block if re-run.
  code = code.replace(/\/\/ === TZ GATE[\s\S]*?\/\/ === END TZ GATE ===\s*/i, "");
  // Remove leftover guard comment banners from the original.
  code = code.replace(/\/\/ ── TIMEZONE[\s\S]*?─+\n/gi, "");
  code = code.replace(/\/\/ ── END TIMEZONE[\s\S]*?─+\n/gi, "");
  return code.replace(/^\s*\n/, "");
}

function setHourlyCron(wf) {
  for (const n of wf.nodes) {
    if (/scheduleTrigger/.test(n.type)) {
      // Normalize to an hourly cron in UTC; the per-client guard owns the actual local timing.
      n.parameters = n.parameters || {};
      n.parameters.rule = { interval: [{ field: "cronExpression", expression: "0 * * * *" }] };
      n.parameters.timezone = "UTC";
    }
  }
}

const changed = [];

for (const [id, plan] of Object.entries(PLAN)) {
  const wf = wfs.find((w) => w.id === id);
  if (!wf) { console.log("SKIP (not found):", id); continue; }

  if (id === "slaMonitor1") { console.log("LEAVE AS-IS:", id, "(ops alert, Mon-Fri India fine)"); continue; }

  // 1) hourly cron
  setHourlyCron(wf);

  // 2) install the clean guard into the chosen code node (or first code node if not named)
  let hostName = plan.node;
  if (!hostName) {
    const firstCode = wf.nodes.find((n) => n.type === "n8n-nodes-base.code");
    hostName = firstCode ? firstCode.name : null;
  }

  if (id === "nudgeEngineGhl1") {
    // Nudges run a WINDOW (8-18 local), not a single hour. Guard = skip outside 8..18 local.
    const host = wf.nodes.find((n) => n.type === "n8n-nodes-base.code");
    if (host) {
      let c = stripOldGuard(host.parameters.jsCode || "");
      const winGuard = `// === TZ WINDOW GATE (8..18 local) ===
{
  var __it = $json.fields ? $json.fields : $json;
  var __tz = __it.timezone || 'America/New_York';
  var __now; try { __now = new Date(new Date().toLocaleString('en-US',{timeZone:__tz})); } catch(e){ __now = new Date(); }
  var __h = __now.getHours();
  if (__h < 8 || __h > 18) { return []; }
}
// === END TZ WINDOW GATE ===
`;
      host.parameters.jsCode = winGuard + c;
      changed.push(id);
      console.log("PATCHED:", id, "(window 8-18 local on", host.name + ")");
    }
    continue;
  }

  const host = wf.nodes.find((n) => n.name === hostName) || wf.nodes.find((n) => n.type === "n8n-nodes-base.code");
  if (!host) { console.log("WARN: no code node to host guard in", id); continue; }
  let c = stripOldGuard(host.parameters.jsCode || "");
  host.parameters.jsCode = guardCode(plan.hour, plan.day) + c;
  changed.push(id);
  console.log("PATCHED:", id, "-> guard hour", plan.hour, plan.day != null ? "day " + plan.day : "", "on", host.name);
}

// Emit only the changed workflows.
const out = wfs.filter((w) => changed.includes(w.id));
const OUT = path.join(__dirname, "_REBUILT_workflows.json");
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log("\nWrote", OUT, "with", out.length, "rebuilt workflows:", changed.join(", "));
