#!/usr/bin/env node
/* PHASE 4 — briefing intelligence upgrade for briefBuilder1.
 *
 * PROBLEM: buildBriefing already has mood/energy/recovery/adaptation logic, but briefings come out
 * near-identical daily because the prompt has NO daily-varying, anti-repetition inputs: no date, no
 * yesterday's score, and no memory of recent briefings. With recovery defaulting to 60 and no mood
 * reply, Claude sees the same prompt every day.
 *
 * FIX: insert two read nodes before buildBriefing and feed their data into the prompt:
 *   - loadRecentBriefings (tbl_briefings, last 3 for this client, date desc) -> "DO NOT repeat these"
 *   - loadYesterdayScore  (tbl_daily_scores, latest for this client)          -> real daily signal
 * Then extend buildBriefing's system prompt with: today's local date + weekday, yesterday's
 * composite score + trend, and an explicit anti-repetition block quoting the last briefings.
 *
 * Chain becomes:
 *   loadProfile -> loadBiometrics -> loadRecentBriefings -> loadYesterdayScore -> buildBriefing -> ...
 *
 * Reads _BACKUP_live_workflows_20260702.json, writes _deploy_p1/briefBuilder1.json.
 * (Note: this file must be applied AFTER _fix_brief_persist already added persistBriefing — the live
 *  backup already contains persistBriefing, so we build on the live version.)
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const w = wfs.find((x) => x.id === "briefBuilder1");
const AIR_BASE = "appjnWxg9sB3PV7Da";
const AIR_CRED = { airtableTokenApi: { id: "Z1DGfO9LPHXmAo4W", name: "Airtable Goecoach Personal Access Token account" } };

// --- 1. two new read nodes ---
const loadRecent = {
  parameters: { operation: "search", base: { __rl: true, value: AIR_BASE, mode: "list" },
    table: { __rl: true, value: "={{ 'tbl_briefings' }}", mode: "id" },
    filterByFormula: "={{ \"{client_id}='\" + ($('Webhook').first().json.body.client_id || 'client_test') + \"'\" }}",
    returnAll: false, limit: 3, sort: { property: [{ field: "date", direction: "desc" }] }, options: {} },
  id: "bb-recent", name: "loadRecentBriefings", type: "n8n-nodes-base.airtable", typeVersion: 2.2,
  position: [400, 420], credentials: AIR_CRED, onError: "continueRegularOutput",
};
const loadScore = {
  parameters: { operation: "search", base: { __rl: true, value: AIR_BASE, mode: "list" },
    table: { __rl: true, value: "={{ 'tbl_daily_scores' }}", mode: "id" },
    filterByFormula: "={{ \"{client_id}='\" + ($('Webhook').first().json.body.client_id || 'client_test') + \"'\" }}",
    returnAll: false, limit: 3, sort: { property: [{ field: "date", direction: "desc" }] }, options: {} },
  id: "bb-score", name: "loadYesterdayScore", type: "n8n-nodes-base.airtable", typeVersion: 2.2,
  position: [600, 420], credentials: AIR_CRED, onError: "continueRegularOutput",
};
if (!w.nodes.some((n) => n.name === "loadRecentBriefings")) w.nodes.push(loadRecent);
if (!w.nodes.some((n) => n.name === "loadYesterdayScore")) w.nodes.push(loadScore);

// --- 2. rewire: loadBiometrics -> loadRecentBriefings -> loadYesterdayScore -> buildBriefing ---
w.connections["loadBiometrics"].main[0] = [{ node: "loadRecentBriefings", type: "main", index: 0 }];
w.connections["loadRecentBriefings"] = { main: [[{ node: "loadYesterdayScore", type: "main", index: 0 }]] };
w.connections["loadYesterdayScore"] = { main: [[{ node: "buildBriefing", type: "main", index: 0 }]] };

// --- 3. extend buildBriefing prompt with date + yesterday score + anti-repetition ---
const bb = w.nodes.find((n) => n.name === "buildBriefing");
let code = bb.parameters.jsCode;

// Inject data gathering right before the systemLines array is built.
const anchor = "var stageBlocks={launching:";
const inject = [
  "// ===== PHASE 4: daily-varying + anti-repetition context =====",
  "var __tz = p.timezone || 'America/New_York';",
  "var __localNow; try { __localNow = new Date(new Date().toLocaleString('en-US',{timeZone:__tz})); } catch(e){ __localNow = new Date(); }",
  "var __weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][__localNow.getDay()];",
  "var __dateStr = __localNow.getFullYear()+'-'+String(__localNow.getMonth()+1).padStart(2,'0')+'-'+String(__localNow.getDate()).padStart(2,'0');",
  "// recent briefings (avoid repeating)",
  "var __recent = []; try { __recent = $('loadRecentBriefings').all().map(function(it){var f=(it.json&&it.json.fields)?it.json.fields:(it.json||{});return f.briefing_text||'';}).filter(Boolean); } catch(e){ __recent=[]; }",
  "var __antiRepeat = __recent.length ? ('ANTI-REPETITION: Here are your last '+__recent.length+' briefings for this client. Do NOT reuse their opening line, structure, or phrasing - make today distinctly different in wording and angle:\\n- '+__recent.slice(0,3).join('\\n- ')) : '';",
  "// yesterday score (real daily signal)",
  "var __scores = []; try { __scores = $('loadYesterdayScore').all().map(function(it){var f=(it.json&&it.json.fields)?it.json.fields:(it.json||{});return f;}); } catch(e){ __scores=[]; }",
  "var __yScore = (__scores[0] && __scores[0].composite_score!=null) ? Number(__scores[0].composite_score) : null;",
  "var __pScore = (__scores[1] && __scores[1].composite_score!=null) ? Number(__scores[1].composite_score) : null;",
  "var __trend = (__yScore!=null && __pScore!=null) ? (__yScore>__pScore?'up':(__yScore<__pScore?'down':'flat')) : null;",
  "var __scoreLine = (__yScore!=null) ? ('YESTERDAY SCORE: '+__yScore+'/100'+(__trend?(' (trend '+__trend+' vs prior day)'):'')+'. Briefly reference how yesterday went and set today accordingly - do not just repeat the number.') : '';",
  "",
].join("\n");
if (code.indexOf("PHASE 4: daily-varying") === -1) {
  code = code.replace(anchor, inject + anchor);
}

// Add the new lines into the systemLines array (before OUTPUT RULES).
const outAnchor = "  'OUTPUT RULES: ONE plain-text SMS";
const newLines =
  "  'TODAY: '+__weekday+', '+__dateStr+'. Ground the briefing in today specifically.',\n" +
  "  __scoreLine,\n" +
  "  __antiRepeat,\n";
if (code.indexOf("Ground the briefing in today specifically") === -1) {
  code = code.replace(outAnchor, newLines + outAnchor);
}

// Bump max_tokens slightly for the richer prompt (still SMS-length output enforced by rules).
code = code.replace("max_tokens:320", "max_tokens:340");

bb.parameters.jsCode = code;

// sanity
if (bb.parameters.jsCode.indexOf("__antiRepeat") === -1) throw new Error("anti-repeat injection failed");
if (bb.parameters.jsCode.indexOf("__scoreLine") === -1) throw new Error("score injection failed");

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "briefBuilder1.json"), JSON.stringify(clean, null, 2));
console.log("briefBuilder1 upgraded: +loadRecentBriefings +loadYesterdayScore, prompt now has date + yesterday score + anti-repetition. -> _deploy_p1/briefBuilder1.json");
