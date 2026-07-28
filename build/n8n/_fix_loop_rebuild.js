#!/usr/bin/env node
/* PHASE 1b — Loop-rebuild for stageTrans01ghl + eodPro00001ghl.
 *
 * These two senders have a PER-CLIENT Airtable/HTTP fetch in the middle of the chain
 * (fetchScores / getBiometrics+fetchGhlTasks+fetchTodayNudges+fetchBusinessHealth) that
 * references $('loadProfile').item / $('Search records').item. In a flat all-items chain
 * that .item is always client #0, so every client gets client #0's scores/biometrics.
 *
 * FIX: insert a `Loop Over Items` (splitInBatches v3, batch size 1) right after the profile
 * load, exactly like the working nudgeEngineGhl1. The loop feeds ONE client per iteration, so
 * the downstream .item refs resolve to the current client, and the whole sub-chain runs
 * per-client. The tail of the chain loops back into the Loop node.
 *
 * Wiring (mirrors nudgeEngine):
 *   profileLoad -> Loop
 *   Loop[out1 = loop body] -> firstFetch -> ... -> send -> tail -> Loop   (back-edge)
 *   Loop[out0 = done] -> (nothing)
 *
 * Reads _BACKUP_live_workflows_20260702.json, writes _deploy_p1/{id}.json.
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const byId = (id) => wfs.find((w) => w.id === id);

function addLoop(w, x, y) {
  const loop = {
    parameters: { options: {} },
    id: "loop-" + w.id,
    name: "Loop Over Clients",
    type: "n8n-nodes-base.splitInBatches",
    typeVersion: 3,
    position: [x, y],
  };
  w.nodes.push(loop);
  return loop.name;
}

/* Rewire: find edges out of `profileNode` (to `firstFetch`) and the tail node (`tailNode`)
 * to insert the loop. */
function insertLoop(w, profileNode, firstFetch, tailNode) {
  const loopName = addLoop(w, 200, 500);
  const C = w.connections;
  // profileNode -> firstFetch  becomes  profileNode -> Loop
  C[profileNode] = C[profileNode] || { main: [[]] };
  C[profileNode].main[0] = [{ node: loopName, type: "main", index: 0 }];
  // Loop: out0 (done) empty, out1 (loop) -> firstFetch
  C[loopName] = { main: [[], [{ node: firstFetch, type: "main", index: 0 }]] };
  // tailNode -> Loop (back-edge)
  C[tailNode] = C[tailNode] || { main: [[]] };
  C[tailNode].main[0] = [{ node: loopName, type: "main", index: 0 }];
  return loopName;
}

// ---- stageTrans01ghl ----
{
  const w = byId("stageTrans01ghl");
  // chain: loadProfile -> fetchScores -> decide -> IsSend -> callClaude -> extract -> send -> openConversation
  // tail = openConversation ; firstFetch = fetchScores ; profile = loadProfile
  insertLoop(w, "loadProfile", "fetchScores", "openConversation");
  // decide still reads $('loadProfile').item + $('fetchScores').all() — now per-iteration correct.
  // Its TZ gate uses $json (the loop item) — but wait: decide's input is fetchScores output, not
  // the profile. $json in decide = fetchScores row, not the client. The ORIGINAL decide reads the
  // client via $('loadProfile').item (not $json) for `p`, and the TZ gate reads $json.fields... which
  // in the loop is the fetchScores row (has no timezone!). FIX the gate to read the profile:
  const dec = w.nodes.find((n) => n.name === "decide");
  dec.parameters.jsCode = dec.parameters.jsCode.replace(
    "var __it = $json.fields ? $json.fields : $json;",
    "var __it = ($('loadProfile').item.json.fields) ? $('loadProfile').item.json.fields : $('loadProfile').item.json;"
  );
  const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
  fs.writeFileSync(path.join(OUT, "stageTrans01ghl.json"), JSON.stringify(clean, null, 2));
  console.log("stageTrans01ghl: Loop inserted (loadProfile->Loop->fetchScores...->openConversation->Loop); gate reads profile.");
}

// ---- eodPro00001ghl ----
{
  const w = byId("eodPro00001ghl");
  // chain: Search records -> getBiometrics -> fetchGhlTasks -> fetchTodayNudges -> fetchBusinessHealth
  //        -> computeScore -> (Send + Create a record); Send -> openConversation
  // tail(s): both "Create a record" and "openConversation" are leaf ends. The back-edge must fire
  //   once per client AFTER both branches. Simplest: back-edge from openConversation (end of the
  //   Send branch). "Create a record" is a side-write that completes within the iteration.
  insertLoop(w, "Search records", "getBiometrics", "openConversation");
  // computeScore TZ gate reads $json (was the Search-records client row fed straight through the
  // fetch chain). In the loop, computeScore's input is fetchBusinessHealth output — NOT the client.
  // The original computeScore reads client via $('Search records').item; fix the gate to read it too:
  const cs = w.nodes.find((n) => n.name === "computeScore");
  cs.parameters.jsCode = cs.parameters.jsCode.replace(
    "var __it = $json.fields ? $json.fields : $json;",
    "var __it = ($('Search records').item.json.fields) ? $('Search records').item.json.fields : $('Search records').item.json;"
  );
  const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
  fs.writeFileSync(path.join(OUT, "eodPro00001ghl.json"), JSON.stringify(clean, null, 2));
  console.log("eodPro00001ghl: Loop inserted (Search records->Loop->getBiometrics...->openConversation->Loop); gate reads client.");
}

console.log("\nNOTE: 'Create a record' in eodPro stays wired from computeScore (side-write per iteration).");
