#!/usr/bin/env node
/* PHASE 0.4 — fix ghlInboundV1 so DONE/SKIP/score replies actually close their pending row.
 *
 * ROOT CAUSE (verified in live exec 13337): a bare "DONE" matched a STALE open weekly_checkin
 * (whose answerShapeFits accepted any non-empty text) instead of the recurring_reminder row, so
 * it routed mode=weekly -> postWeekly -> closeWeekly and the recurring row stayed open. 22 stale
 * open rows had accumulated and kept intercepting replies.
 *
 * FIX (mirror the corrected pendingReplies.js):
 *   1. dispatch: replace the inlined answerShapeFits so weekly_checkin / morning_checkin / free-text
 *      do NOT swallow bare single-shot command tokens (DONE, SKIP, YES, NO, ...); add expiry filter
 *      in matchReply (ignore rows past expires_at) and pass now.
 *   2. loadPending: also filter out expired rows at the Airtable query
 *      (status='open' AND expires_at > NOW) so stale rows stop intercepting.
 *
 * Reads _BACKUP_live_workflows_20260702.json, writes _deploy_p1/ghlInboundV1.json.
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const w = wfs.find((x) => x.id === "ghlInboundV1");
const node = (n) => w.nodes.find((x) => x.name === n);

// --- 1. dispatch: patch the inlined answerShapeFits + matchReply expiry ---
const dispatch = node("dispatch");
let dc = dispatch.parameters.jsCode;

// Insert COMMAND_TOKENS + isBareCommandToken right after SINGLE_SHOT_ACCEPTS declaration.
const anchor = "function isScaleNumber(r){";
const inject =
  "var COMMAND_TOKENS=(function(){var s={};Object.keys(SINGLE_SHOT_ACCEPTS).forEach(function(k){SINGLE_SHOT_ACCEPTS[k].forEach(function(v){s[v]=1;});});return s;})();" +
  "function isBareCommandToken(r){var u=String(r==null?'':r).trim().toUpperCase();return u.length>0&&u.indexOf(' ')===-1&&!!COMMAND_TOKENS[u];}";
if (dc.indexOf("isBareCommandToken") === -1) {
  dc = dc.replace(anchor, inject + anchor);
}

// Replace the greedy answerShapeFits with the tightened version.
const oldShape =
  "function answerShapeFits(t,r){if(t==='manual_biometric')return isThreeScaleNumbers(r)||isScaleNumber(r);if(t==='weekly_checkin')return isScaleNumber(r)||normUpper(r).length>0;if(t==='morning_checkin')return String(r==null?'':r).trim().length>0;if(FREETEXT_TYPES.indexOf(t)>=0)return String(r==null?'':r).trim().length>0;var a=SINGLE_SHOT_ACCEPTS[t];if(a)return a.indexOf(normUpper(r))>=0;return false;}";
const newShape =
  "function answerShapeFits(t,r){if(t==='manual_biometric')return isThreeScaleNumbers(r)||isScaleNumber(r);" +
  "if(t==='weekly_checkin'){if(isScaleNumber(r))return true;return normUpper(r).length>0&&!isBareCommandToken(r);}" +
  "if(t==='morning_checkin')return String(r==null?'':r).trim().length>0&&!isBareCommandToken(r);" +
  "if(FREETEXT_TYPES.indexOf(t)>=0)return String(r==null?'':r).trim().length>0&&!isBareCommandToken(r);" +
  "var a=SINGLE_SHOT_ACCEPTS[t];if(a)return a.indexOf(normUpper(r))>=0;return false;}";
if (dc.indexOf(oldShape) === -1) throw new Error("dispatch: old answerShapeFits not found (verbatim) — inspect live code");
dc = dc.replace(oldShape, newShape);

// matchReply: add expiry filter + accept opts.now.
const oldMatchHead =
  "function matchReply(openRows,reply,opts){opts=opts||{};var cid=opts.client_id;var rows=(Array.isArray(openRows)?openRows:[]).filter(function(r){return r&&r.status==='open';}).filter(function(r){return cid==null||r.client_id===cid;});";
const newMatchHead =
  "function matchReply(openRows,reply,opts){opts=opts||{};var cid=opts.client_id;" +
  "var nowMs=opts.now!=null?(opts.now instanceof Date?opts.now.getTime():new Date(opts.now).getTime()):Date.now();" +
  "var rows=(Array.isArray(openRows)?openRows:[]).filter(function(r){return r&&r.status==='open';}).filter(function(r){return cid==null||r.client_id===cid;}).filter(function(r){return !r.expires_at||_ts(r.expires_at)>=nowMs;});";
if (dc.indexOf(oldMatchHead) === -1) throw new Error("dispatch: old matchReply head not found — inspect live code");
dc = dc.replace(oldMatchHead, newMatchHead);

// The row objects passed to matchReply must carry expires_at. dispatch builds rows from loadPending;
// add expires_at to that mapping.
const oldRowMap =
  "return { _id: (it.json&&it.json.id)||'', client_id:f.client_id, expected_type:f.expected_type,\n             context_ref:f.context_ref, opened_at:f.opened_at, status:f.status };";
const newRowMap =
  "return { _id: (it.json&&it.json.id)||'', client_id:f.client_id, expected_type:f.expected_type,\n             context_ref:f.context_ref, opened_at:f.opened_at, status:f.status, expires_at:f.expires_at };";
if (dc.indexOf(oldRowMap) !== -1) dc = dc.replace(oldRowMap, newRowMap);

dispatch.parameters.jsCode = dc;

// --- 2. loadPending: filter expired at the query ---
const lp = node("loadPending");
lp.parameters.filterByFormula = "={{ \"AND({status}='open', OR({expires_at}='', IS_AFTER({expires_at}, NOW())))\" }}";

// sanity assertions
const out = dispatch.parameters.jsCode;
if (out.indexOf("isBareCommandToken") === -1) throw new Error("post: isBareCommandToken missing");
if (out.indexOf("expires_at") === -1) throw new Error("post: expiry filter missing");

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "ghlInboundV1.json"), JSON.stringify(clean, null, 2));
console.log("ghlInboundV1 patched: tightened answerShapeFits + expiry filter (dispatch + loadPending). -> _deploy_p1/ghlInboundV1.json");
