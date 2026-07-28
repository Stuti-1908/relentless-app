#!/usr/bin/env node
/* Make eodPro00001ghl per-client correct.
 *
 * Root problem: written single-client. Downstream nodes use $('Search records').first()
 * and unfiltered .all(), so in a multi-client loop every client's score is computed from
 * client #1's profile + ALL clients' biometrics/nudges mixed together.
 *
 * Fix (item-isolated):
 *   - Search records  : filter {active}=1  (loop every active client, one item each)
 *   - getBiometrics   : filter by the CURRENT item's client_id, newest first
 *   - fetchTodayNudges: filter by the CURRENT item's client_id (was hardcoded client_test)
 *   - fetchBusinessHealth: filter by CURRENT item's client_id (was .first())
 *   - fetchGhlTasks   : use CURRENT item's ghl_contact_id (was .first())
 *   - computeScore    : read the CURRENT item's profile via $('Search records').item (was .first())
 *
 * n8n note: $('Node').item = the input item paired with THIS execution of the per-item chain,
 * so it correctly tracks which client is flowing through. .first() always grabs item #0.
 *
 * Edits _REBUILT_workflows.json in place (the eodPro entry).
 */
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "_REBUILT_workflows.json");
const wfs = JSON.parse(fs.readFileSync(FILE, "utf8"));
const w = wfs.find((x) => x.id === "eodPro00001ghl");
if (!w) { console.error("eodPro00001ghl not in rebuilt set"); process.exit(1); }

const byName = (n) => w.nodes.find((x) => x.name === n);

// 1) Search records -> only active clients, one item per client.
const sr = byName("Search records");
sr.parameters.filterByFormula = '={{ "{active}=1" }}';
sr.parameters.returnAll = true;

// Reference to the current looped client's profile fields, from any downstream node.
const CUR = `($('Search records').item.json.fields || $('Search records').item.json)`;

// 2) getBiometrics -> filter to current client's rows, newest first.
const gb = byName("getBiometrics");
gb.parameters.filterByFormula = `={{ "{client_id}='" + ${CUR}.client_id + "'" }}`;
gb.parameters.sort = { sort: [{ field: "date", direction: "desc" }] };
gb.parameters.returnAll = false;
gb.parameters.limit = 7;

// 3) fetchTodayNudges -> current client_id (keep the 18h window).
const fn = byName("fetchTodayNudges");
fn.parameters.filterByFormula =
  `={{ "AND({client_id}='" + ${CUR}.client_id + "', DATETIME_DIFF(NOW(),{timestamp},'hours')<=18)" }}`;

// 4) fetchBusinessHealth -> current client_id (was .first()).
const fbh = byName("fetchBusinessHealth");
fbh.parameters.filterByFormula = `={{ "{client_id}='" + ${CUR}.client_id + "'" }}`;

// 5) fetchGhlTasks -> current client's ghl_contact_id (was .first()).
const fgt = byName("fetchGhlTasks");
if (fgt && fgt.parameters.url) {
  fgt.parameters.url = fgt.parameters.url
    .split("$('Search records').first()").join("$('Search records').item");
}

// 6) computeScore -> read the current item's profile (was .first()).
const cs = byName("computeScore");
cs.parameters.jsCode = cs.parameters.jsCode
  .split("$('Search records').first()").join("$('Search records').item");

fs.writeFileSync(FILE, JSON.stringify(wfs, null, 2));
console.log("eodPro00001ghl: per-client isolation applied (Search records {active}=1; biometrics/nudges/health/tasks/computeScore now item-scoped).");
