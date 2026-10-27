// Behaviour test for patch 7 (notification preferences): toChannel flags, prefFilter / prefGate routing.
const fs = require("fs");
const P = JSON.parse(fs.readFileSync(__dirname + "/patched7.json", "utf8"));
const AsyncF = Object.getPrototypeOf(async function () {}).constructor;
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };

let CLIENT = null, LAST_URL = "";
global.fetch = async url => { LAST_URL = url; return { json: async () => (CLIENT ? [CLIENT] : []) }; };
const base = { phone_number: "+919876543210", email: "b@example.com", full_name: "Bhakti Mamtora", delivery_channel: "sms" };
const expr = n => new Function("$json", "return (" + n.parameters.conditions.conditions[0].leftValue.replace(/^=\{\{|\}\}$/g, "") + ");");
const nodeOf = (w, name) => w.nodes.find(n => n.name === name);

(async () => {
  // ---- toChannel: suppressed flag per workflow ----
  const CAT = { morningCheckin1: "morning_checkin", briefBuilder1: "morning_briefing", nudgeEngineGhl1: "nudges", eodPro00001ghl: "evening_score",
    weekly000001ghl: "weekly", stageTrans01ghl: "weekly", onboard00001ghl: "onboarding", monthly00001ghl: "monthly_report",
    recurReminder1: "task_reminders", meetReminder1: "meeting_reminders", weeklySynth1: "weekly", ghlInboundV1: null };
  process.env.SUPABASE_SERVICE_KEY = "x";
  const callTc = async (wid, prefs, fetchFails) => {
    CLIENT = fetchFails ? null : { client_id: "c1", ...base, notification_prefs: prefs };
    const tc = nodeOf(P[wid], "toChannel");
    const j = { client_id: "c1", ghl_contact_id: "CONT", reply: "hi", sms: "hi" };
    return (await new AsyncF("$json", "$", "$env", "process", tc.parameters.jsCode)(j, () => ({ first: () => ({ json: j }) }), { SUPABASE_SERVICE_KEY: "x" }, process)).json;
  };
  for (const [wid, cat] of Object.entries(CAT)) {
    const none = await callTc(wid, {});
    const off = await callTc(wid, cat ? { [cat]: false } : { paused: true });
    const paused = await callTc(wid, { paused: true });
    const otherOff = await callTc(wid, { nudges: false, monthly_report: false, morning_checkin: false, morning_briefing: false, weekly: false, evening_score: false,
      onboarding: false, task_reminders: false, meeting_reminders: false, [cat || "x"]: true });
    const lookupFail = await callTc(wid, {}, true);
    const good = none.suppressed === false && lookupFail.suppressed === false && /select=\*/.test(LAST_URL)
      && (cat ? off.suppressed === true && paused.suppressed === true && /^suppressed:/.test(off.channel_reason) && otherOff.suppressed === false
              : off.suppressed === false && paused.suppressed === false);
    ok(good, `${wid.padEnd(16)} ${cat ? cat + " off/paused -> suppressed; default/other-off/lookup-fail -> sent" : "reply is NEVER suppressed (even when paused)"}`);
    ok(none.channel === "email" && none.ghl_payload.type === "Email", `${wid.padEnd(16)} email routing for +91 still works with select=*`);
  }

  // ---- prefFilter ----
  const FILT = { nudgeEngineGhl1: "nudges", weekly000001ghl: "weekly", stageTrans01ghl: "weekly", onboard00001ghl: "onboarding", monthly00001ghl: "monthly_report" };
  for (const [wid, cat] of Object.entries(FILT)) {
    const f = expr(nodeOf(P[wid], "prefFilter"));
    ok(f({}) === true && f({ notification_prefs: {} }) === true && f({ notification_prefs: null }) === true && f({ notification_prefs: { [cat]: true } }) === true
      && f({ notification_prefs: { [cat]: false } }) === false && f({ notification_prefs: { paused: true } }) === false && f({ notification_prefs: { morning_briefing: false } }) === true,
      `${wid.padEnd(16)} prefFilter: empty item + defaults pass, ${cat}=false / paused dropped`);
  }
  const mf = expr(nodeOf(P.morningCheckin1, "prefFilter"));
  ok(mf({ notification_prefs: { morning_checkin: false } }) === true && mf({ notification_prefs: { morning_briefing: false } }) === true
    && mf({ notification_prefs: { morning_checkin: false, morning_briefing: false } }) === false && mf({ notification_prefs: { paused: true } }) === false && mf({}) === true,
    "morningCheckin1  prefFilter: dropped only when check-in AND briefing are both off (or paused)");

  // ---- graph routing of prefGate ----
  const next = (w, name, branch) => (w.connections[name]?.main[branch] || []).map(t => t.node);
  const EXPECT = { briefBuilder1: [], eodPro00001ghl: ["Loop Over Clients"], recurReminder1: ["markReminded"], meetReminder1: ["markSent"], weeklySynth1: [], morningCheckin1: ["briefingOn"] };
  for (const [wid, skip] of Object.entries(EXPECT)) {
    const w = P[wid], g = expr(nodeOf(w, "prefGate"));
    const sendName = next(w, "prefGate", 0)[0];
    ok(g({ suppressed: false }) === true && g({}) === true && g({ suppressed: true }) === false
      && JSON.stringify(next(w, "toChannel", 0)) === '["prefGate"]' && /^(sendGHL|sendReminder|Send an SMS\/MMS\/WhatsApp message)$/.test(sendName)
      && JSON.stringify(next(w, "prefGate", 1)) === JSON.stringify(skip),
      `${wid.padEnd(16)} prefGate: sent -> ${sendName}; suppressed -> ${JSON.stringify(skip)}`);
  }
  const bo = expr(nodeOf(P.morningCheckin1, "briefingOn"));
  ok(bo({ briefing_on: true }) === true && bo({ briefing_on: false }) === false && next(P.morningCheckin1, "briefingOn", 0)[0] === "openConversation" && next(P.morningCheckin1, "briefingOn", 1).length === 0,
    "morningCheckin1  check-in off + briefing on -> pending reply still opened (7AM fallback builds the briefing); both off -> nothing");
  const mcOff = await callTc("morningCheckin1", { morning_checkin: false });
  const mcBoth = await callTc("morningCheckin1", { morning_checkin: false, morning_briefing: false });
  ok(mcOff.suppressed === true && mcOff.briefing_on === true && mcBoth.briefing_on === false, "morningCheckin1  briefing_on flag follows morning_briefing");

  // ---- invariants ----
  ok(!next(P.ghlInboundV1, "toChannel", 0).includes("prefGate") && !nodeOf(P.ghlInboundV1, "prefGate"), "ghlInboundV1     replies have no gate");
  const monAgg = nodeOf(P.monthly00001ghl, "aggregate").parameters.jsCode;
  ok(/\$\('prefFilter'\)\.all\(\)/.test(monAgg) && !/\$\('loadProfile'\)/.test(monAgg), "monthly00001ghl  aggregate reads the filtered list, not loadProfile");
  const onDec = JSON.stringify(nodeOf(P.onboard00001ghl, "decide").parameters);
  ok(!onDec.includes("$('loadProfile')") && onDec.includes("$('prefFilter')"), "onboard00001ghl decide reads the filtered list");
  console.log(`RESULT ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
