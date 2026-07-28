#!/usr/bin/env node
/* Fix stageTrans01ghl's real remaining bug (found live post-deploy, exec 13969/13959):
 * `decide` and `fetchScores` reference $('loadProfile').item — but loadProfile runs ONCE
 * upstream of `Loop Over Clients` (splitInBatches) with 14 items, then fetchScores (an Airtable
 * search) does NOT preserve n8n's pairedItem linkage back through the loop. So downstream,
 * $('loadProfile').item cannot resolve correctly -> decide throws "A 'json' property isn't an
 * object [item 0]" on every single run (verified: same error before AND after the Phase-1 loop
 * rebuild — the loop wiring was right, but the item-reference inside it was still wrong).
 *
 * FIX: reference $('Loop Over Clients').item instead of $('loadProfile').item — the splitInBatches
 * node's own per-iteration output IS the correctly paired current-client item.
 *
 * Reads current live DB copy (passed as argv[2]), writes _deploy_p1/stageTrans01ghl.json.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_deploy_p1");
const SRC = process.argv[2] || path.join(__dirname, "_BACKUP_live_workflows_20260702.json");

let w;
if (SRC.endsWith(".sqlite")) {
  console.error("Pass a JSON export, not sqlite, to this script."); process.exit(1);
}
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
w = Array.isArray(wfs) ? wfs.find((x) => x.id === "stageTrans01ghl") : wfs;
if (!w) { console.error("stageTrans01ghl not found in", SRC); process.exit(1); }

const decide = w.nodes.find((n) => n.name === "decide");
const fetchScores = w.nodes.find((n) => n.name === "fetchScores");

decide.parameters.jsCode = decide.parameters.jsCode.replace(/\$\('loadProfile'\)\.item/g, "$('Loop Over Clients').item");
fetchScores.parameters.filterByFormula = fetchScores.parameters.filterByFormula.replace(/\$\('loadProfile'\)\.item/g, "$('Loop Over Clients').item");

if (decide.parameters.jsCode.includes("$('loadProfile').item")) throw new Error("decide still references loadProfile.item — replace failed");
if (fetchScores.parameters.filterByFormula.includes("$('loadProfile').item")) throw new Error("fetchScores still references loadProfile.item — replace failed");

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "stageTrans01ghl.json"), JSON.stringify(clean, null, 2));
console.log("stageTrans01ghl fixed: decide + fetchScores now reference $('Loop Over Clients').item (correct per-iteration pairing) instead of the broken $('loadProfile').item chain through the Airtable search node.");
console.log("-> _deploy_p1/stageTrans01ghl.json");
