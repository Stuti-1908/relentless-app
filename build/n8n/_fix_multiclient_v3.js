#!/usr/bin/env node
/* PHASE 1 v3 — Multi-client fix WITHOUT any node `mode` change.
 *
 * WHY v3: n8n 2.26's `import:workflow` silently drops the Code node `mode` field, so the v2
 * approach (set mode=runOnceForEachItem) never persisted to workflow_entity (verified: 0
 * occurrences post-import). This version keeps the default runOnceForAllItems mode and instead
 * rewrites the build node's jsCode to LOOP over $input.all() internally, emitting one output
 * item per eligible client. No schema/mode change => import persists it.
 *
 * TRANSFORM (per build node): the original body has the uniform shape
 *     [gate block that reads $json and does `return []` to skip]
 *     [body that reads `$json` (var p=$json...) and ends `return [ { json: X } ]`]
 * We wrap it as:
 *     const __IN = $input.all(); const __OUT = [];
 *     for (let __i=0; __i<__IN.length; __i++) {
 *       const $json = __IN[__i].json;               // shadow $json to THIS client
 *       const __r = (function(){ <ORIGINAL BODY> })();
 *       if (Array.isArray(__r)) { for (const x of __r) __OUT.push(x); }
 *       else if (__r) __OUT.push(__r);
 *     }
 *     return __OUT;
 * The gate's `return []` returns [] from the IIFE (skip this client, push nothing). The body's
 * `return [{json:X}]` returns that client's item, pushed to __OUT. $('loadProfile').item refs:
 * with all-items mode these resolve to item[0], so we ALSO replace `$('loadProfile').item` and
 * `$('fetchScores').item` etc. with a per-iteration `$json`-based object. Since every body reads
 * its client from `$json` (var p=$json.fields?...), and the few `$('loadProfile').item` refs also
 * point at the same client row, we rewrite those specific refs to `({json:$json})` so they track
 * the loop. (Verified refs: only loadProfile.item / fetchScores.item appear.)
 *
 * EXTRACT node: with the build node now emitting N items, extract runs once per item in
 * all-items mode? No — extract is also runOnceForAllItems and reads $input.first(). We convert
 * extract the SAME way: loop $input.all(), and map $('decide').item -> the paired item. Simpler:
 * we rewrite extract to loop, using $input.all()[i] as the Claude response and carrying the
 * client_id that we now pass THROUGH callClaude via $json. But callClaude only returns Claude's
 * response, losing client_id. So instead extract must pair by index with $('decide').all()[i].
 * We rewrite extract to: loop i over $input.all(), d=$('decide').all()[i].json, c=input[i].json.
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byId = (id) => wfs.find((w) => w.id === id);
const node = (w, name) => w.nodes.find((n) => n.name === name);

function wrapBuildLoop(code) {
  // Replace cross-item refs that must track the loop with the per-iteration $json client.
  // $('loadProfile').item.json  -> ({fields:$json.fields||$json, id:$json.id, ...}) — but $json IS
  // the loadProfile item here, so $('loadProfile').item.json === $json. Safe to swap.
  let body = code
    .replace(/\$\('loadProfile'\)\.item\.json/g, "$json")
    .replace(/\$\('fetchScores'\)\.item\.json/g, "($__scoresByItem)");
  // fetchScores is a per-client Airtable lookup fanned from loadProfile; in all-items mode we
  // can't easily pair it. stageTrans is handled specially below; assert none slipped through:
  if (/\$\('fetchScores'\)/.test(body)) {
    // leave as-is; stageTrans handled in its own branch (not via this generic wrap)
    body = code;
  }
  return [
    "// [multi-client loop wrapper — emits one item per eligible client]",
    "const __IN = $input.all(); const __OUT = [];",
    "for (let __i = 0; __i < __IN.length; __i++) {",
    "  const $json = __IN[__i].json;",
    "  const __r = (function(){",
    body,
    "  })();",
    "  if (Array.isArray(__r)) { for (const __x of __r) __OUT.push(__x); }",
    "  else if (__r != null) __OUT.push(__r);",
    "}",
    "return __OUT;",
  ].join("\n");
}

function wrapExtractLoop(code) {
  // Original extract reads $input.first().json (Claude resp) + $('decide').item.json (client).
  // Rewrite to pair by index across the N items.
  let inner = code
    .replace(/\$input\.first\(\)/g, "__cItem")
    .replace(/\$\('callClaude'\)\.first\(\)/g, "__cItem")
    .replace(/\$\('decide'\)\.item/g, "__dItem")
    .replace(/\$json/g, "__cItem.json");
  return [
    "// [multi-client loop wrapper for extract — pair Claude response i with decide item i]",
    "const __C = $input.all(); const __D = $('decide').all(); const __OUT = [];",
    "for (let __i = 0; __i < __C.length; __i++) {",
    "  const __cItem = __C[__i];",
    "  const __dItem = __D[__i] || __C[__i];",
    "  const __r = (function(){",
    inner,
    "  })();",
    "  if (Array.isArray(__r)) { for (const __x of __r) __OUT.push(__x); }",
    "  else if (__r != null) __OUT.push(__r);",
    "}",
    "return __OUT;",
  ].join("\n");
}

// briefFallback1: prepInput reads $json, ends return [{json}]; no callClaude/extract after.
// Its downstream (postBriefing) is the Claude call + send, all per-item. So only prepInput needs
// the loop wrap.
const CFG = {
  morningCheckin1: { build: "decide", extract: "extract" },
  market000001: { build: "decide", extract: "extract" },
  weekly000001ghl: { build: "decide", extract: "extract" },
  onboard00001ghl: { build: "decide", extract: "extract" },
  briefFallback1: { build: "prepInput", extract: null },
  // stageTrans01ghl handled separately (fetchScores pairing)
};

const results = [];
for (const [wid, cfg] of Object.entries(CFG)) {
  const w = byId(wid);
  const b = node(w, cfg.build);
  b.parameters.jsCode = wrapBuildLoop(b.parameters.jsCode);
  delete b.parameters.mode; // ensure default all-items mode
  if (cfg.extract) {
    const e = node(w, cfg.extract);
    e.parameters.jsCode = wrapExtractLoop(e.parameters.jsCode);
    delete e.parameters.mode;
  }
  const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
  fs.writeFileSync(path.join(OUT, wid + ".json"), JSON.stringify(clean, null, 2));
  results.push(wid + " (loop-wrapped, no mode field)");
}

console.log("v3 wrote:");
results.forEach((r) => console.log("  " + r));
console.log("stageTrans01ghl + eodPro00001ghl: handled separately (fetch-chain pairing).");
