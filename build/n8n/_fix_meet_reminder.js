#!/usr/bin/env node
/* Fix meetReminder1 (was inactive + LEAD_MIN=3 + India-local "HH:MM" parse).
 * - computeWindow: select scheduled_at too.
 * - splitMeetings: prefer scheduled_at (absolute UTC, timezone-correct) over the bare meet_time;
 *   LEAD_MIN 3 -> 5. The dashboard saves scheduled_at via new Date(`${date}T${time}`).toISOString(),
 *   so it's the right UTC instant; comparing to UTC now reminds 5 min before the user's wall clock.
 * Output: _deploy3/meetReminder1.json (active:true).
 */
const fs = require("fs");
const path = require("path");
const wfs = JSON.parse(fs.readFileSync(path.join(__dirname, "_NOW_workflows.json"), "utf8"));
const w = wfs.find((x) => x.id === "meetReminder1");
if (!w) { console.error("meetReminder1 not found"); process.exit(1); }

// 1) computeWindow: add scheduled_at to the select.
const cw = w.nodes.find((n) => n.name === "computeWindow");
cw.parameters.jsCode = cw.parameters.jsCode.replace(
  "select=id,title,meet_time,user_id",
  "select=id,title,meet_time,scheduled_at,user_id"
);

// 2) splitMeetings: prefer scheduled_at; LEAD_MIN=5.
const sm = w.nodes.find((n) => n.name === "splitMeetings");
sm.parameters.jsCode = `const LEAD_MIN = 5;
let arr = [];
const first = $input.first() ? $input.first().json : null;
if (Array.isArray(first)) arr = first;
else if (first && Array.isArray(first.data)) arr = first.data;
else if (first && first.id) arr = $input.all().map(i => i.json).filter(x => x && x.id);
const now = new Date();
function minutesUntil(mt) {
  if (!mt) return null;
  let t;
  if (/T/.test(mt) || /\\d{4}-\\d{2}-\\d{2}/.test(mt)) { t = new Date(mt); } // ISO/timestamptz -> absolute UTC instant (timezone-correct)
  else { // legacy bare "HH:MM" fallback only -> today container-local
    const p = String(mt).split(':');
    const hh = parseInt(p[0], 10), mm = parseInt(p[1] || '0', 10);
    if (isNaN(hh)) return null;
    t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  }
  return (t - now) / 60000;
}
return arr
  .filter(m => m && m.id)
  .map(m => {
    // PREFER scheduled_at (absolute UTC from the dashboard); fall back to legacy meet_time.
    const when = m.scheduled_at || m.meet_time;
    const mu = minutesUntil(when);
    return { meeting_id: m.id, title: (m.title || 'your meeting'), meet_time: m.meet_time || null,
             scheduled_at: m.scheduled_at || null, user_id: m.user_id || null, minutesUntil: mu };
  })
  .filter(x => x.minutesUntil !== null && x.minutesUntil <= LEAD_MIN && x.minutesUntil > -0.5) // due in next ~5 min
  .map(x => ({ json: x }));`;

// 3) buildSms copy: "3 minutes" -> "5 minutes" if present.
const bs = w.nodes.find((n) => n.name === "buildSms");
if (bs && bs.parameters.jsCode) {
  bs.parameters.jsCode = bs.parameters.jsCode.replace(/about 3 minutes/g, "about 5 minutes").replace(/in 3 min/g, "in 5 min");
}

// 4) activate + keep every-minute cron (meetings need minute precision; scheduled_at is absolute UTC so tz is fine).
w.active = true;

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.mkdirSync(path.join(__dirname, "_deploy3"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "_deploy3", "meetReminder1.json"), JSON.stringify(clean, null, 2));
console.log("meetReminder1 fixed: prefer scheduled_at, LEAD_MIN=5, active=true. -> _deploy3/meetReminder1.json");
