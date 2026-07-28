#!/usr/bin/env node
/* PHASE 1 — Multi-client engine fix (2026-07-02).
 *
 * ROOT CAUSE: the flat senders' build node (decide/prepInput/computeScore) runs in
 * runOnceForAllItems mode but reads $json (item #0) and returns ONE item, so only the
 * first Airtable client ever gets an SMS. Downstream `extract` reads $input.first()
 * (item #0's Claude response) while $('decide').item tracks the current item — a mismatch
 * once N>1.
 *
 * FIX (per flat sender):
 *   - BUILD node (decide/prepInput/computeScore): loop $input.all(), apply the SAME TZ gate
 *     per client, and push one output item PER eligible client (array out). Preserves the
 *     `return []`/skip semantics as "don't push this client".
 *   - EXTRACT node: set mode=runOnceForEachItem so $json / $input.item = THIS client's
 *     Claude response and $('decide').item = THIS client — perfectly aligned. Rewrite
 *     $input.first() -> $json and $('callClaude').first() -> $('callClaude').item.
 *
 * SCOPE: 7 flat senders. NOT touched (already correct): nudgeEngineGhl1 (Loop Over Items),
 * recurReminder1 (splitTasks task-level fan-out). eodPro00001ghl handled by its own block
 * because its build node is computeScore fed by a fetch chain.
 *
 * Reads _BACKUP_live_workflows_20260702.json, writes per-workflow files to _deploy_p1/.
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });

const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byId = (id) => wfs.find((w) => w.id === id);
const node = (w, name) => w.nodes.find((n) => n.name === name);

/** Wrap a single-client build body into a loop over $input.all().
 * The original body assumes $json = one client and ends with `return [{json:...}]`.
 * We keep the body verbatim but (a) drive it from a per-client variable and (b) collect
 * outputs. Simplest robust transform: rename the node to iterate — we execute the ORIGINAL
 * body as an inner function receiving each item's json, and the TZ gate's `return []`
 * becomes "skip this client".
 */
function loopWrapBuild(originalCode) {
  // The original code references $json (and sometimes $('loadProfile').item / $('X').item).
  // In runOnceForAllItems with our loop, $('node').item is NOT reliable, so we must ensure
  // the body only depends on the per-client object. All 7 build nodes read `$json.fields||$json`
  // at the top (verified). We shadow $json per iteration via a local proxy is not possible;
  // instead we run the body in runOnceForEachItem mode (see convertBuildToEach).
  throw new Error("unused");
}

/** Convert a BUILD node to runOnceForEachItem.
 * In this mode $json = the current client, and `return []` from the TZ gate cleanly SKIPS
 * this item (n8n drops items whose iteration returns an empty array / null). The body's
 * final `return [{json:X}]` returns this client's single built item. $('X').item refs
 * resolve to the current iteration. This is the minimal, semantics-preserving fix.
 */
function convertBuildToEach(n) {
  n.parameters = n.parameters || {};
  n.parameters.mode = "runOnceForEachItem";
  // Body already returns [] to skip and [{json}] to emit — valid in each-item mode.
}

/** Convert EXTRACT to runOnceForEachItem and fix cross-item .first() refs. */
function convertExtractToEach(n) {
  let c = n.parameters.jsCode || "";
  // $input.first() -> $input.item  (current client's Claude response)
  c = c.replace(/\$input\.first\(\)/g, "$input.item");
  // $('callClaude').first() -> $('callClaude').item
  c = c.replace(/\$\('callClaude'\)\.first\(\)/g, "$('callClaude').item");
  n.parameters.jsCode = c;
  n.parameters.mode = "runOnceForEachItem";
}

// ---- Simple flat senders: build=decide|prepInput, then extract (if present) ----
const SIMPLE = {
  morningCheckin1: { build: "decide", extract: "extract" },
  market000001: { build: "decide", extract: "extract" },
  weekly000001ghl: { build: "decide", extract: "extract" },
  onboard00001ghl: { build: "decide", extract: "extract" },
  stageTrans01ghl: { build: "decide", extract: "extract" },
  briefFallback1: { build: "prepInput", extract: null },
};

const results = [];
for (const [wid, cfg] of Object.entries(SIMPLE)) {
  const w = byId(wid);
  if (!w) { console.error("MISSING", wid); continue; }
  const b = node(w, cfg.build);
  if (!b) { console.error("MISSING build node", wid, cfg.build); continue; }
  convertBuildToEach(b);
  if (cfg.extract) {
    const e = node(w, cfg.extract);
    if (e) convertExtractToEach(e);
  }
  const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
  fs.writeFileSync(path.join(OUT, wid + ".json"), JSON.stringify(clean, null, 2));
  results.push(wid + " -> build=" + cfg.build + "[each]" + (cfg.extract ? " extract[each]" : ""));
}

// ---- eodPro00001ghl: build node = computeScore (fed by fetch chain) ----
// The fetch chain (Search records -> getBiometrics -> fetchGhlTasks -> fetchTodayNudges ->
// fetchBusinessHealth -> computeScore) already returns N client rows from `Search records`.
// The downstream Airtable/HTTP nodes run per input item, but computeScore must fan out per
// client. Converting computeScore to runOnceForEachItem makes each client compute its own
// score. Its cross-references (getBiometrics etc.) must be per-item — flagged for manual
// verification below.
{
  const w = byId("eodPro00001ghl");
  const cs = node(w, "computeScore");
  if (cs) {
    convertBuildToEach(cs);
    const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
    fs.writeFileSync(path.join(OUT, "eodPro00001ghl.json"), JSON.stringify(clean, null, 2));
    results.push("eodPro00001ghl -> computeScore[each] (VERIFY fetch-chain per-item refs)");
  }
}

console.log("Wrote to _deploy_p1/:");
results.forEach((r) => console.log("  " + r));
console.log("\nNOTE: run _verify_multiclient.js before deploying.");
