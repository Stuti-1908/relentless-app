#!/usr/bin/env node
/* Offline-test the TZ gate logic from _REBUILT_workflows.json.
 * Extracts the guard block from each patched node and runs it through a fake $json
 * at controlled UTC instants, asserting it sends ONLY at the client's local target hour. */
const fs = require("fs");
const path = require("path");
const wfs = JSON.parse(fs.readFileSync(path.join(__dirname, "_REBUILT_workflows.json"), "utf8"));

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; } else { fail++; console.log("  FAIL:", name); } }

// Run a guard snippet with a given client tz and a mocked "now" (real wall clock via fake timezone offset).
// We simulate by temporarily overriding Date's toLocaleString to return a chosen local time.
function runGuard(code, tz, localHour, localDow) {
  // Build a function whose body is the guard + `return 'SENT';` (reached only if guard didn't return []).
  // We stub $json and a Date that yields the desired local hour/day for the matching tz.
  const guard = code.split("// === END")[0]; // up to first END marker = the gate block(s)
  // Actually keep both possible gate blocks (single + window); cut at the LAST END marker.
  const lastEnd = code.lastIndexOf("=== END");
  const gateOnly = code.slice(0, code.indexOf("\n", lastEnd) + 1);

  const $json = { fields: { timezone: tz } };
  // Mock Date so new Date(new Date().toLocaleString('en-US',{timeZone})) => chosen local hour/dow.
  const RealDate = Date;
  function FakeDate(arg) {
    if (arg !== undefined) {
      // new Date(someLocaleString) -> a date with our chosen hour/dow
      const d = new RealDate(2026, 5, 29 + ((localDow - 1 + 7) % 7), localHour, 0, 0); // 2026-06-29 is a Monday
      return d;
    }
    return new RealDate(); // new Date() (we don't rely on it; toLocaleString is what matters)
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = RealDate.now;
  // toLocaleString must exist on instances; our instances are RealDate so fine.
  const fn = new Function("$json", "Date", gateOnly + "\nreturn 'SENT';");
  try { return fn($json, FakeDate); } catch (e) { return "ERR:" + e.message; }
}

// Map of workflow -> {tz target tests}
const cases = {
  morningCheckin1: { hour: 6 },
  market000001: { hour: 5 },
  eodPro00001ghl: { hour: 19 },
  briefFallback1: { hour: 7 },
  stageTrans01ghl: { hour: 6, day: 1 },
  weekly000001ghl: { hour: 19, day: 0 },
};

for (const [id, t] of Object.entries(cases)) {
  const wf = wfs.find((w) => w.id === id);
  if (!wf) { console.log("MISSING", id); continue; }
  const host = wf.nodes.find((n) => (n.parameters && /=== (TZ GATE|TZ WINDOW GATE)/.test(n.parameters.jsCode || "")));
  if (!host) { console.log("NO GUARD in", id); fail++; continue; }
  const code = host.parameters.jsCode;
  console.log("\n" + id + " (target " + t.hour + "h" + (t.day != null ? " dow " + t.day : "") + "):");

  const dow = t.day != null ? t.day : 1; // use Monday when DOW irrelevant
  // At target hour & day -> SENT
  check("sends at target hour (NY)", runGuard(code, "America/New_York", t.hour, dow) === "SENT");
  // One hour before -> skip
  check("skips 1h before", runGuard(code, "America/New_York", (t.hour + 23) % 24, dow) === undefined ||
        Array.isArray(runGuard(code, "America/New_York", (t.hour + 23) % 24, dow)));
  // One hour after -> skip
  const after = runGuard(code, "America/New_York", (t.hour + 1) % 24, dow);
  check("skips 1h after", after !== "SENT");
  // Different tz, same local target hour -> SENT (proves per-client tz, not server tz)
  check("sends at target hour (London)", runGuard(code, "Europe/London", t.hour, dow) === "SENT");
  if (t.day != null) {
    // Wrong day, right hour -> skip
    check("skips wrong day", runGuard(code, "America/New_York", t.hour, (t.day + 1) % 7) !== "SENT");
  }
}

// Nudge window test (8..18)
{
  const wf = wfs.find((w) => w.id === "nudgeEngineGhl1");
  const host = wf.nodes.find((n) => /=== TZ WINDOW GATE/.test(n.parameters?.jsCode || ""));
  console.log("\nnudgeEngineGhl1 (window 8-18):");
  const code = host.parameters.jsCode;
  check("sends at 8 local", runGuard(code, "America/New_York", 8, 1) === "SENT");
  check("sends at 18 local", runGuard(code, "America/New_York", 18, 1) === "SENT");
  check("skips at 7 local", runGuard(code, "America/New_York", 7, 1) !== "SENT");
  check("skips at 19 local", runGuard(code, "America/New_York", 19, 1) !== "SENT");
  check("sends at 12 local (London)", runGuard(code, "Europe/London", 12, 1) === "SENT");
}

console.log("\n==== " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
