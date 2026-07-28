# n8n Hosting — Where to Run It Live (Decision Guide)

> **Plain-English summary:** Your whole product is a clock. Every morning at 6 AM it texts the
> client; every evening at 7 PM it scores their day; nudges fire through the day. For that clock to
> tick, the n8n server has to be **awake 24/7** and must **never lose your workflows**. That one
> requirement is what rules options in or out below.

---

## 1. Why the Render FREE tier will NOT work

The free tier gives **750 compute hours/month**, which sounds like enough (a month is only ~730
hours). The hours are not the problem. Two *other* free-tier behaviors break n8n:

### Problem 1 — Free services go to sleep → the 6 AM briefing never fires
A free Render service **shuts itself down after 15 minutes** of no website visitors. While it's
asleep, n8n's internal scheduler is **switched off**. Nobody is "visiting" the server at 6:00 AM, so
it stays asleep and the morning briefing simply **never sends**. The same kills the evening score,
the nudges, and the feedback questions — the entire daily loop depends on those timers firing on
time.

### Problem 2 — Free services have NO permanent storage → your workflows get erased
All of your workflows and saved logins (Airtable, Claude, Twilio, GoHighLevel) are stored in a
single database file on the server. Render only attaches **permanent disks to PAID plans**. On the
free plan the storage is temporary — **every restart or update wipes everything**, and you'd be
rebuilding all 7 workflows from scratch, repeatedly.

> **Bottom line:** Free tier = a clock that falls asleep and forgets the time. For a service you
> charge clients $500–$3,500/month to run reliably, a single missed 6 AM briefing can lose a client.
> The ~$8/month it costs to fix this is rounding error against that.

*(There are hacks — a second service "pinging" the free server every 10 minutes to keep it awake,
plus an external database to survive the wipes — but they're fragile and not worth it for a paid
client service.)*

---

## 2. The reliable options

| Option | Cost/mo | Stays awake? | Keeps your data? | Setup difficulty | Notes |
|---|---|---|---|---|---|
| **Render — FREE** | $0 | ❌ Sleeps | ❌ Wiped on restart | Easy | **Not viable** for scheduled workflows. |
| **Render — Starter + 1GB disk** | **~$8** | ✅ Always on | ✅ Permanent disk | **Easiest** | Managed platform, free HTTPS URL, no command line, **no ngrok needed**. |
| **Hetzner — CX22 VPS** | **~$5** | ✅ Always on | ✅ Full disk | Harder | Cheapest + more power, but you manage a Linux server (Docker, firewall) yourself. |

### Recommendation: **Render Starter (~$8/mo)**
For a non-technical operator it's the smoothest path:
- No Linux command line — everything is point-and-click in the Render dashboard.
- Gives a permanent web address (`your-app.onrender.com`), so **we can delete ngrok entirely** and
  point Twilio straight at Render. One less thing that can break.
- The permanent disk keeps all your workflows and logins safe across updates.

**Hetzner** saves you ~$3/month but you'd be running and securing a Linux server yourself — not worth
the savings unless cost is critical.

---

## 3. What "moving to Render" involves (preview — full click-by-click guide comes next)

1. Create a paid **Starter** web service on Render pointing at the official `n8nio/n8n` image.
2. Attach a **1GB persistent disk** mounted at `/home/node/.n8n` (this is the "never lose data" step).
3. Set the environment variables (the same ones from your laptop's Docker run command — Twilio token,
   the IPv4 DNS fix, the `crypto` permission, etc.).
4. **Match the encryption key** to your current laptop's n8n so your saved credentials still work
   after the move (otherwise every login has to be re-entered). *You* read that key (it's a secret).
5. Export your 7 workflows from the laptop and import them into Render.
6. Point the **Twilio inbound webhook** at the new Render URL and confirm a test message round-trips.

---

## 4. Decision needed from you

**Pick one to proceed:**
- ✅ **Render Starter (~$8/mo)** — I'll write the full step-by-step deploy + migration guide.
- 💰 **Hetzner (~$5/mo)** — cheaper, but a more technical setup; I'll lay out the extra steps first.

*(Free tier is off the table for the reasons in §1.)*
