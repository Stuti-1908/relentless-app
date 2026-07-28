# Your 3 tasks — P3 deploy, Airtable cleanup, GHL inbound check

*(2026-07-06. Everything else is already done: P3 files are uploaded to the server and verified;
the leak fix is live and confirmed working in production.)*

---

## Task 1 — Deploy P3 (stops the hourly alert spam) — ONE paste

1. Open **PowerShell**.
2. Type: `ssh -i ~/.ssh/id_dadaai root@167.233.94.171` and press **Enter**.
3. **Right-click** in the window to paste this whole block, then press **Enter**:

```bash
set -e
cd /root/n8n && docker compose stop n8n
VOL=/var/lib/docker/volumes/n8n_data/_data
cp $VOL/database.sqlite $VOL/database.sqlite.bak_p3_$(date +%Y%m%d_%H%M%S)
sqlite3 $VOL/database.sqlite "PRAGMA wal_checkpoint(TRUNCATE);" || true
python3 /root/deploy_p1/p3/publish_sync_p3.py $VOL/database.sqlite /root/deploy_p1/p3
rm -f $VOL/database.sqlite-wal $VOL/database.sqlite-shm
chown 1000:1000 $VOL/database.sqlite
docker compose up -d n8n
```

4. Success = `VERIFIED: all 4 workflows published with fix markers` + `Started`.
   Paste the output back to Claude to double-check.

**What it fixes:** hourly false alerts → max 2/morning, real ones only; reply-tracking rows get
the correct client attached; end-of-day rows no longer all credited to the first client.

---

## Task 2 — Airtable cleanup (stops your duplicate messages)

Open the **Relentless AI OPS** base → table **tbl_client_profile**. Then:

**A. Un-tick the `active` checkbox** on these 5 rows (your duplicate signups — keep `client_test`!):

| client_id | full_name |
|---|---|
| client_73bed63e | Stuti Gohil |
| client_10980ff1 | Stuti Gohil |
| client_0bf09430 | Stuti Gohil |
| client_bf127ca7 | Stuti S |
| client_720b9768 | Stuti Gohil |

**B. Fix 2 timezone cells:**

| client_id | change timezone to |
|---|---|
| client_d2232ae2 (Oyaide Joshua Silver) | `Africa/Lagos` |
| demo_pro (Demo CEO) | `America/New_York` |

**Keep untouched:** `client_test` (you, `Asia/Calcutta`) and `client_f5283731` (Stuti S — different
GHL contact; deactivate it too only if it's an old number of yours).

*(Alternative: tell Claude "yes, apply the Airtable changes" in a session where the action is
approved — the exact API script is ready.)*

---

## Task 3 — Fix GHL inbound (why replies like "2 1 5" do nothing)

In **GoHighLevel** (LeadConnector):

1. Left sidebar → **Automation**.
2. Find the workflow that handles incoming SMS — likely named around **"Customer Replied"**.
3. Check: is it **Published** (toggle top-right)? If it says Draft — publish it.
4. Open its **Webhook** action. The URL must be exactly:
   `https://167.233.94.171.nip.io/webhook/ghl-inbound` and method **POST**.
5. If there is no such automation: create one — Trigger = **Customer Replied**
   (channel: SMS), Action = **Webhook** (POST, URL above).
6. Test: text anything to your Relentless number, then tell Claude — we'll check
   n8n received it within a minute.

---

## After all 3 are done, still open (Claude's queue)
- Rebuild/unarchive meeting reminders (`meetReminder1` is archived — never runs).
- Deploy the dashboard to Vercel (your added tasks/meetings currently save nowhere).
- WhatsApp channel for +91/+234 clients (Option C — decided? Cost ≈ $1–2/client/month).
- Deploy relentless-web timezone picker (418 zones) to stop new signups defaulting to US time.
