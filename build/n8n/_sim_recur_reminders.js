#!/usr/bin/env node
/* Offline-test the matchFire recurrence/dedup logic from _recur_reminders.json. */
const fs = require("fs");
const path = require("path");
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, "_recur_reminders.json"), "utf8"));
const code = wf.nodes.find((n) => n.name === "matchFire").parameters.jsCode;

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } }

// Harness: stub $('splitTasks').item, $('getPhone').first(), $('normalizeProfile').item, $env, $now-less.
// We fake "now" by overriding the timezone conversion: matchFire calls
// new Date(new Date().toLocaleString('en-US',{timeZone:tz})). We can't easily force a wall-clock,
// so we test the PURE decision by re-implementing the harness with a controllable Date.
function run({ task, tz, contactId, client_id, fakeLocal }) {
  // fakeLocal: {hour, dow, dom, dateStr}
  const RealDate = Date;
  function FakeDate(arg) {
    if (arg !== undefined) {
      const d = new RealDate(2026, 0, 1, fakeLocal.hour, 0, 0);
      // override getters used by matchFire
      d.getHours = () => fakeLocal.hour;
      d.getDay = () => fakeLocal.dow;
      d.getDate = () => fakeLocal.dom;
      d.getFullYear = () => Number(fakeLocal.dateStr.slice(0, 4));
      d.getMonth = () => Number(fakeLocal.dateStr.slice(5, 7)) - 1;
      return d;
    }
    return new RealDate();
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = RealDate.now;

  const ctx = {
    "splitTasks": { item: { json: task } },
    "getPhone": { first: () => ({ json: { fields: { timezone: tz, ghl_contact_id: contactId } } }) },
    "normalizeProfile": { item: { json: { client_id } } },
  };
  const $ = (name) => ctx[name];
  const $env = {};
  const fn = new Function("$", "$env", "Date", code + "\n//done");
  // matchFire ends with `return [...]`; capture it
  const wrapped = new Function("$", "$env", "Date", "return (function(){ " + code + " })();");
  return wrapped($, $env, FakeDate)[0].json;
}

const weeklySat5pm = { task_id: "t1", title: "Dr visit", repeat_rule: "weekly", repeat_days: [6], remind_at: "17:00", last_reminded_on: null };
const daily7am = { task_id: "t2", title: "Meds", repeat_rule: "daily", repeat_days: [], remind_at: "07:00", last_reminded_on: null };
const monthly1st9am = { task_id: "t3", title: "Pay rent", repeat_rule: "monthly", repeat_days: [1], remind_at: "09:00", last_reminded_on: null };

console.log("WEEKLY (Sat 5pm):");
check("fires Sat 17:00", run({ task: weeklySat5pm, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 17, dow: 6, dom: 12, dateStr: "2026-06-13" } }).send === true);
check("skips Fri 17:00", run({ task: weeklySat5pm, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 17, dow: 5, dom: 11, dateStr: "2026-06-12" } }).send === false);
check("skips Sat 16:00", run({ task: weeklySat5pm, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 16, dow: 6, dom: 12, dateStr: "2026-06-13" } }).send === false);
check("skips if no contact", run({ task: weeklySat5pm, tz: "America/New_York", contactId: "", client_id: "cl1", fakeLocal: { hour: 17, dow: 6, dom: 12, dateStr: "2026-06-13" } }).send === false);

console.log("DAILY (7am):");
check("fires any day 07:00", run({ task: daily7am, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 7, dow: 3, dom: 10, dateStr: "2026-06-10" } }).send === true);
check("skips 08:00", run({ task: daily7am, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 8, dow: 3, dom: 10, dateStr: "2026-06-10" } }).send === false);

console.log("MONTHLY (1st 9am):");
check("fires 1st 09:00", run({ task: monthly1st9am, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 9, dow: 1, dom: 1, dateStr: "2026-07-01" } }).send === true);
check("skips 2nd 09:00", run({ task: monthly1st9am, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 9, dow: 2, dom: 2, dateStr: "2026-07-02" } }).send === false);

console.log("DEDUP:");
const already = Object.assign({}, weeklySat5pm, { last_reminded_on: "2026-06-13" });
check("skips if already reminded today", run({ task: already, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 17, dow: 6, dom: 13, dateStr: "2026-06-13" } }).send === false);
check("fires next week (diff date)", run({ task: already, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 17, dow: 6, dom: 20, dateStr: "2026-06-20" } }).send === true);

console.log("SMS + payload:");
const r = run({ task: weeklySat5pm, tz: "America/New_York", contactId: "c1", client_id: "cl1", fakeLocal: { hour: 17, dow: 6, dom: 13, dateStr: "2026-06-13" } });
check("sms mentions title + DONE/SKIP", /Dr visit/.test(r.sms) && /DONE/.test(r.sms) && /SKIP/.test(r.sms));
check("carries task_id + patchUrl", r.task_id === "t1" && /tasks\?id=eq\.t1/.test(r.patchUrl));
check("local_date set", r.local_date === "2026-06-13");

console.log("\n==== " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
