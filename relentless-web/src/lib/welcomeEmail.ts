// Purchase welcome email, sent through GoHighLevel like every other client email so replies land in the
// same two-way inbox. Same dark template as the n8n coaching emails (build/n8n/_audit_20261024/email_lib.js).
// Best-effort: a failure is logged and never fails the Stripe webhook.

const GHL_API = process.env.GHL_API_URL || "https://services.leadconnectorhq.com";
const SITE = "https://www.getrelentlessai.com";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapEmail(eyebrow: string, headline: string, bodyHtml: string): string {
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:32px 16px;"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#141414;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">' +
    '<tr><td style="background-color:#000000;padding:24px 28px;border-bottom:2px solid #b31217;">' +
    `<img src="${SITE}/email-logo.png" width="36" height="36" alt="Relentless AI" style="display:block;border:0;" /></td></tr>` +
    '<tr><td style="padding:28px;">' +
    `<p style="margin:0 0 4px 0;color:#b31217;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">${esc(eyebrow)}</p>` +
    `<h1 style="margin:0 0 20px 0;color:#f5f5f5;font-size:20px;font-weight:600;line-height:1.35;">${esc(headline)}</h1>` +
    `<div style="color:#d4d4d4;font-size:15px;line-height:1.6;">${bodyHtml}</div>` +
    "</td></tr>" +
    '<tr><td style="padding:20px 28px;background-color:#0a0a0a;border-top:1px solid #2a2a2a;">' +
    '<p style="margin:0;color:#6b6b6b;font-size:12px;line-height:1.5;">Relentless AI &middot; Your executive coach, always on.<br/>Reply to this email to respond - it\'s a real two-way conversation.</p>' +
    "</td></tr></table></td></tr></table></body></html>"
  );
}

export function welcomeEmail(name: string | null) {
  const first = (name || "").trim().split(/\s+/)[0] || "there";
  const p = (t: string) => `<p style="margin:0 0 12px 0;">${t}</p>`;
  const html = wrapEmail(
    "Welcome to Relentless AI",
    `You're in, ${first}.`,
    p("Your subscription is active - $69/month, cancel anytime from Settings in your dashboard.") +
      p("<strong style=\"color:#f5f5f5;\">What happens next</strong>") +
      p("1. Finish your 2-minute setup so your coach knows your goals, timezone and phone.<br/>" +
        "2. From tomorrow you'll get a morning check-in and a briefing built around your day.<br/>" +
        "3. Through the day: well-timed nudges, meeting reminders and an honest evening score.") +
      p(`<a href="${SITE}/onboarding" style="display:inline-block;background:#b31217;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;">Finish setup</a>`) +
      p(`You can choose which messages you receive any time in <a href="${SITE}/settings" style="color:#e0b84a;">Settings</a>.`)
  );
  const text =
    `You're in, ${first}. Your Relentless AI subscription is active ($69/month, cancel anytime).\n\n` +
    `Next: finish your 2-minute setup at ${SITE}/onboarding - from tomorrow you'll get your morning check-in and briefing.`;
  return { subject: "Welcome to Relentless AI - you're in", html, text };
}

// Upsert the GHL contact by email (the location rejects duplicates, and provisioning later reuses it),
// then send the email. Returns the contact id when it worked.
export async function sendWelcomeEmail(email: string, name: string | null): Promise<string | null> {
  const token = process.env.GHL_TOKEN;
  const loc = process.env.GHL_LOCATION_ID;
  if (!token || !loc) {
    console.error("[welcome-email] GHL_TOKEN / GHL_LOCATION_ID not set");
    return null;
  }
  try {
    const up = await fetch(`${GHL_API}/contacts/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: loc, email, ...(name ? { name } : {}) }),
    });
    if (!up.ok) {
      console.error("[welcome-email] contact upsert failed", up.status, (await up.text()).slice(0, 200));
      return null;
    }
    const contactId = ((await up.json()) as { contact?: { id?: string } }).contact?.id;
    if (!contactId) return null;
    const { subject, html, text } = welcomeEmail(name);
    const r = await fetch(`${GHL_API}/conversations/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "Email", contactId, subject, html, message: text }),
    });
    if (!r.ok) {
      console.error("[welcome-email] send failed", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    return contactId;
  } catch (e) {
    console.error("[welcome-email] error", e instanceof Error ? e.message : e);
    return null;
  }
}
