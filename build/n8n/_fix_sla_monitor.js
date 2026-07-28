#!/usr/bin/env node
/* PHASE 5 — rebuild slaMonitor1 so it stops firing the daily false "15h ago" alert.
 *
 * ROOT CAUSE: cron '45 6 * * 1-5' = 06:45 Asia/Kolkata = 01:15 UTC. Morning sends fire at each
 * client's local 6 AM (10:30-14:30 UTC for US clients). At 01:15 UTC the newest morning_checkin
 * artifact is always ~11-15h old, so the "artifact in last 6h?" check ALWAYS fails -> false alert
 * every weekday ("15h ago"). It also alerts globally, not per client.
 *
 * REBUILD:
 *   - Schedule: hourly UTC ('0 * * * *') instead of the fixed mistimed cron.
 *   - Load ALL active clients + today's morning_checkin artifacts.
 *   - evaluate (per run, all clients): for each active client, compute their LOCAL time. Only
 *     consider a client "due" if it is >=2h past their local 06:00 today (their morning window has
 *     passed). For due clients, check whether a morning_checkin artifact opened TODAY in their local
 *     date. Alert ONLY for due clients with no artifact today -> names WHICH clients missed.
 *   - No due-and-missing clients => no alert (kills the false daily alarm).
 *
 * Reads _BACKUP_live_workflows_20260702.json, writes _deploy_p1/slaMonitor1.json.
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const w = wfs.find((x) => x.id === "slaMonitor1");
const AIR_BASE = "appjnWxg9sB3PV7Da";
const AIR_CRED = { airtableTokenApi: { id: "Z1DGfO9LPHXmAo4W", name: "Airtable Goecoach Personal Access Token account" } };

// 1. reschedule hourly UTC
const sched = w.nodes.find((n) => n.type.endsWith("scheduleTrigger"));
sched.parameters.rule = { interval: [{ field: "cronExpression", expression: "0 * * * *" }] };

// 2. add a loadClients node (active profiles) before searchMorning, and widen searchMorning to today.
const loadClients = {
  parameters: { operation: "search", base: { __rl: true, value: AIR_BASE, mode: "list" },
    table: { __rl: true, value: "={{ 'tbl_client_profile' }}", mode: "id" },
    filterByFormula: "={{ \"{active}=1\" }}", returnAll: true, options: {} },
  id: "sla-clients", name: "loadClients", type: "n8n-nodes-base.airtable", typeVersion: 2.2,
  position: [-200, 200], credentials: AIR_CRED,
};
if (!w.nodes.some((n) => n.name === "loadClients")) w.nodes.push(loadClients);

// widen searchMorning: all morning_checkin rows opened in the last 26h (covers every tz's "today")
const sm = w.nodes.find((n) => n.name === "searchMorning");
sm.parameters.filterByFormula = "={{ \"AND({expected_type}='morning_checkin', DATETIME_DIFF(NOW(),{opened_at},'hours')<=26)\" }}";
sm.parameters.returnAll = true;
delete sm.parameters.limit;

// 3. rewire: Schedule -> loadClients -> searchMorning -> evaluate (drop searchConv from the gating
//    path; GHL per-conversation check isn't reliable per-client here and caused half the noise).
w.connections[sched.name] = { main: [[{ node: "loadClients", type: "main", index: 0 }]] };
w.connections["loadClients"] = { main: [[{ node: "searchMorning", type: "main", index: 0 }]] };
w.connections["searchMorning"] = { main: [[{ node: "evaluate", type: "main", index: 0 }]] };
// keep manualTrigger -> loadClients too
const manual = w.nodes.find((n) => n.type.endsWith("manualTrigger"));
if (manual) w.connections[manual.name] = { main: [[{ node: "loadClients", type: "main", index: 0 }]] };

// 4. new evaluate: per-client, timezone-aware "due but missing today's artifact".
const evalNode = w.nodes.find((n) => n.name === "evaluate");
evalNode.parameters.jsCode = [
  "// PHASE 5: per-client timezone-aware morning-send SLA. Alert only for clients whose local",
  "// morning window (>=2h past local 06:00) has passed today with NO morning_checkin artifact today.",
  "var clients = [];",
  "try { clients = $('loadClients').all().map(function(it){ var f=(it.json&&it.json.fields)?it.json.fields:(it.json||{}); return f; }).filter(function(c){ return c && c.client_id; }); } catch(e){ clients=[]; }",
  "var arts = [];",
  "try { arts = $('searchMorning').all().map(function(it){ var f=(it.json&&it.json.fields)?it.json.fields:(it.json||{}); return f; }).filter(function(r){ return r && r.opened_at; }); } catch(e){ arts=[]; }",
  "",
  "function localParts(tz){ var d; try { d = new Date(new Date().toLocaleString('en-US',{timeZone:tz})); } catch(e){ d = new Date(); } return d; }",
  "function localDateStr(tz){ var d=localParts(tz); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }",
  "// map artifact opened_at (UTC ISO) -> the client's LOCAL date string",
  "function artLocalDate(openedAt, tz){ var t=new Date(openedAt); if(isNaN(t)) return ''; try { var s=new Date(t.toLocaleString('en-US',{timeZone:tz})); return s.getFullYear()+'-'+String(s.getMonth()+1).padStart(2,'0')+'-'+String(s.getDate()).padStart(2,'0'); } catch(e){ return ''; } }",
  "",
  "var missed = [];",
  "for (var i=0;i<clients.length;i++){",
  "  var c = clients[i]; var tz = c.timezone || 'America/New_York';",
  "  var ld = localParts(tz); var localHour = ld.getHours();",
  "  var due = localHour >= 8; // >=2h past local 06:00 -> the morning send window has passed",
  "  if (!due) continue;",
  "  var today = localDateStr(tz);",
  "  var hasToday = arts.some(function(a){ return a.client_id===c.client_id && artLocalDate(a.opened_at, tz)===today; });",
  "  if (!hasToday) missed.push(c.client_id);",
  "}",
  "",
  "var alert = missed.length > 0;",
  "var msg = alert",
  "  ? ('RELENTLESS AI ALERT: morning send missing for ' + missed.length + ' client(s) past their local 6 AM today: ' + missed.slice(0,10).join(', ') + '. Check morningCheckin1 + GHL.')",
  "  : 'ok';",
  "return [{ json: { alert: alert, missedCount: missed.length, missed: missed, message: msg } }];",
].join("\n");

// sanity
if (evalNode.parameters.jsCode.indexOf("localHour >= 8") === -1) throw new Error("eval rewrite failed");

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "slaMonitor1.json"), JSON.stringify(clean, null, 2));
console.log("slaMonitor1 rebuilt: hourly UTC, per-client tz-aware due-check, names missed clients, no false daily alert. -> _deploy_p1/slaMonitor1.json");
