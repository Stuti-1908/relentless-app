#!/usr/bin/env node
/* Expire stale open rows in tbl_pending_replies so they stop intercepting inbound replies.
 * A row is stale if status='open' AND expires_at < now. Sets status='expired'.
 *
 * Needs an Airtable PAT with write scope: AIRTABLE_PAT=<pat> node _expire_stale_pending.js [--apply]
 * Without --apply it lists what WOULD be expired (dry run).
 *
 * Base appjnWxg9sB3PV7Da, table tbl_pending_replies.
 */
const BASE = "appjnWxg9sB3PV7Da";
const TABLE = "tbl_pending_replies";
const PAT = process.env.AIRTABLE_PAT;
const APPLY = process.argv.includes("--apply");

if (!PAT) { console.error("Set AIRTABLE_PAT env var (write-scoped)."); process.exit(1); }

const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };
const api = `https://api.airtable.com/v0/${BASE}/${TABLE}`;

async function listOpen() {
  let records = [], offset;
  do {
    const url = new URL(api);
    url.searchParams.set("filterByFormula", "{status}='open'");
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error("list failed " + r.status + " " + (await r.text()).slice(0, 200));
    const d = await r.json();
    records = records.concat(d.records);
    offset = d.offset;
  } while (offset);
  return records;
}

async function expire(ids) {
  // Airtable PATCH max 10 records per call.
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10).map((id) => ({ id, fields: { status: "expired" } }));
    const r = await fetch(api, { method: "PATCH", headers: H, body: JSON.stringify({ records: batch, typecast: true }) });
    if (!r.ok) throw new Error("patch failed " + r.status + " " + (await r.text()).slice(0, 200));
    console.log(`  expired ${Math.min(i + 10, ids.length)}/${ids.length}`);
  }
}

(async () => {
  const now = Date.now();
  const open = await listOpen();
  const stale = open.filter((rec) => {
    const e = rec.fields.expires_at;
    return e && new Date(e).getTime() < now;
  });
  console.log(`open=${open.length}  stale(expired past expires_at)=${stale.length}`);
  stale.slice(0, 30).forEach((r) => console.log(`  ${r.id} type=${r.fields.expected_type} expires_at=${r.fields.expires_at}`));
  if (!APPLY) { console.log("\n[dry-run] pass --apply to set status=expired on the above."); return; }
  if (!stale.length) { console.log("nothing to expire."); return; }
  await expire(stale.map((r) => r.id));
  console.log("done.");
})().catch((e) => { console.error(e.message); process.exit(1); });
