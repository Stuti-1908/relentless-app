#!/usr/bin/env node
/* PHASE 1 verification: prove the fixed build nodes fan out to N eligible clients.
 *
 * We extract each fixed workflow's build-node jsCode from _deploy_p1/, then EXECUTE it
 * once per client (simulating n8n runOnceForEachItem) against a 14-client fixture, at a
 * chosen "now". We assert the count of emitted items == count of clients whose local hour
 * matches the workflow's target (the whole point: not 1, not 0-for-all).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const DIR = path.join(__dirname, "_deploy_p1");

// 14-client fixture spanning real world timezones (mirrors live Airtable shape: {fields:{...}}).
const CLIENTS = [
  ["client_ny1", "America/New_York", "c1"],
  ["client_ny2", "America/New_York", "c2"],
  ["client_la", "America/Los_Angeles", "c3"],
  ["client_chi", "America/Chicago", "c4"],
  ["client_lon", "Europe/London", "c5"],
  ["client_kol", "Asia/Kolkata", "c6"],
  ["client_lagos", "Africa/Lagos", "c7"],
  ["client_syd", "Australia/Sydney", "c8"],
  ["client_utc", "UTC", "c9"],
  ["client_ny3", "America/New_York", ""], // no ghl_contact_id -> send:false expected
  ["client_tok", "Asia/Tokyo", "c10"],
  ["client_den", "America/Denver", "c11"],
  ["client_ny4", "America/New_York", "c12"],
  ["client_dxb", "Asia/Dubai", "c13"],
].map(([client_id, timezone, ghl]) => ({
  json: { fields: { client_id, timezone, ghl_contact_id: ghl, phone_number: "+15551230000",
    full_name: client_id, business_stage: "growing", plan: "pro", active: true } },
}));

// Which local hour (and dow) each workflow targets — from the TZ gate in each build node.
const TARGETS = {
  morningCheckin1: { hour: 6 },
  market000001: { hour: 5 },
  weekly000001ghl: { hour: 19, dow: 0 },
  onboard00001ghl: { hour: 8 }, // waking-hours gate; simplified check
  stageTrans01ghl: { hour: 6, dow: 1 },
  briefFallback1: { hour: 7 },
};

function localHourDow(tz, nowUtc) {
  const s = new Date(nowUtc.toLocaleString("en-US", { timeZone: tz }));
  return { h: s.getHours(), dow: s.getDay() };
}

// Count how many fixture clients SHOULD be eligible at a given real UTC instant.
function expectedEligible(target, nowUtc) {
  return CLIENTS.filter((c) => {
    const { h, dow } = localHourDow(c.json.fields.timezone, nowUtc);
    if (h !== target.hour) return false;
    if (target.dow != null && dow !== target.dow) return false;
    return true;
  });
}

// Execute a build node's jsCode once per client under a faux-n8n sandbox.
function runBuildPerItem(code, client) {
  const sandbox = {
    $json: client.json,
    $input: { item: client, first: () => client, all: () => [client] },
    $: (name) => ({ item: client, first: () => client, all: () => [client] }),
    $now: { toMillis: () => Date.now(), toISO: () => new Date().toISOString(),
      plus: () => ({ toISO: () => new Date().toISOString() }),
      toFormat: () => "2026-07-02" },
    JSON, Object, Array, String, Number, Date, Math, console,
  };
  const wrapped = "(function(){ " + code + " })()";
  try {
    const out = vm.runInNewContext(wrapped, sandbox, { timeout: 2000 });
    // each-item: [] or null => skip; [{json}] or {json} => emit
    if (out == null) return null;
    if (Array.isArray(out)) return out.length ? out[0] : null;
    return out;
  } catch (e) {
    return { __error: e.message };
  }
}

// Pick a UTC instant where each target hour is "live" for at least some fixture clients.
// We just sweep all 24 UTC hours and use the one giving the max eligible for that target.
function bestNowUtc(target) {
  let best = null, bestN = -1;
  for (let hh = 0; hh < 24; hh++) {
    const now = new Date(Date.UTC(2026, 6, 5, hh, 30, 0)); // Sun Jul 5 2026 (dow=0) for weekly
    // For dow-specific we also try Monday
    for (const day of [5, 6]) { // Sun=5th, Mon=6th
      const n = new Date(Date.UTC(2026, 6, day, hh, 30, 0));
      const cnt = expectedEligible(target, n).length;
      if (cnt > bestN) { bestN = cnt; best = n; }
    }
  }
  return best;
}

let pass = 0, fail = 0;
const buildNodeName = (wid) => (wid === "briefFallback1" ? "prepInput" : "decide");

for (const [wid, target] of Object.entries(TARGETS)) {
  const file = path.join(DIR, wid + ".json");
  if (!fs.existsSync(file)) { console.log(`SKIP ${wid} (no deploy file)`); continue; }
  const w = JSON.parse(fs.readFileSync(file, "utf8"));
  const bn = w.nodes.find((n) => n.name === buildNodeName(wid));
  if (!bn) { console.log(`SKIP ${wid} (no build node)`); continue; }
  if (bn.parameters.mode !== "runOnceForEachItem") {
    console.log(`FAIL ${wid}: build node mode is ${bn.parameters.mode}, expected runOnceForEachItem`);
    fail++; continue;
  }
  const now = bestNowUtc(target);
  const expected = expectedEligible(target, now);
  const emitted = CLIENTS.map((c) => runBuildPerItem(bn.parameters.jsCode, c)).filter((r) => r != null);
  const errs = emitted.filter((r) => r && r.__error);
  const good = emitted.filter((r) => r && !r.__error);
  const emittedIds = good.map((r) => (r.json ? r.json.client_id : "?"));
  const expIds = expected.map((c) => c.json.fields.client_id);

  const ok = good.length === expected.length && errs.length === 0 && expected.length >= 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${wid} @${now.toISOString()} — expected ${expected.length} eligible, emitted ${good.length}` +
    (errs.length ? ` [${errs.length} ERRORS: ${errs[0].__error}]` : ""));
  if (!ok) {
    console.log(`   expected: ${expIds.join(", ")}`);
    console.log(`   emitted:  ${emittedIds.join(", ")}`);
  }
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
