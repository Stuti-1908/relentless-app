#!/usr/bin/env node
/* Finish multi-client isolation for weekly000001ghl + stageTrans01ghl.
 * Same class of bug as eodPro: loadProfile hardcoded to client_test and/or downstream
 * nodes use .first() instead of the current looped item.
 */
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "_REBUILT_workflows.json");
const wfs = JSON.parse(fs.readFileSync(FILE, "utf8"));

// ---- weekly000001ghl ----
const wk = wfs.find((x) => x.id === "weekly000001ghl");
if (wk) {
  const lp = wk.nodes.find((n) => n.name === "loadProfile");
  lp.parameters.filterByFormula = '={{ "{active}=1" }}';   // loop all active; decide gates plan==pro
  lp.parameters.returnAll = true;
  const dec = wk.nodes.find((n) => n.name === "decide");
  // decide reads the current client, not item #0
  dec.parameters.jsCode = dec.parameters.jsCode
    .split("$('loadProfile').first()").join("$('loadProfile').item");
  console.log("weekly000001ghl: loadProfile -> {active}=1 (returnAll), decide -> per-item profile.");
}

// ---- stageTrans01ghl ----
const st = wfs.find((x) => x.id === "stageTrans01ghl");
if (st) {
  // loadProfile already {active}=1. fetchScores hardcodes client_test -> current item's client_id.
  const CUR = `($('loadProfile').item.json.fields || $('loadProfile').item.json)`;
  const fsN = st.nodes.find((n) => n.name === "fetchScores");
  fsN.parameters.filterByFormula =
    `={{ "AND({client_id}='" + ${CUR}.client_id + "', DATETIME_DIFF(NOW(),{date},'days')<=7)" }}`;
  // decide reads fetchScores .all() — those are now this client's rows only (per-item chain). And
  // ensure decide's profile ref is per-item too if it uses .first().
  const dec = st.nodes.find((n) => n.name === "decide");
  if (dec) dec.parameters.jsCode = dec.parameters.jsCode
    .split("$('loadProfile').first()").join("$('loadProfile').item");
  console.log("stageTrans01ghl: fetchScores -> current client_id; decide -> per-item profile.");
}

fs.writeFileSync(FILE, JSON.stringify(wfs, null, 2));
console.log("Done.");
