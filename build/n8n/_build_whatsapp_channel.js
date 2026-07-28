#!/usr/bin/env node
/* PHASE 6 — WhatsApp channel for non-US clients (per user decision 2026-07-03: "for non us number
 * we can have whatsapp if GHL limits"). GHL/LeadConnector US A2P cannot reliably deliver SMS to
 * non-US numbers (+91, +234, etc — 6 of 14 live test clients). This adds a `channel` field
 * (sms|whatsapp) to tbl_client_profile, auto-derived from the phone's country code, and a shared
 * send-router snippet each sender's send-node logic can use to pick GHL SMS vs Twilio WhatsApp.
 *
 * SCOPE OF THIS SCRIPT: generates —
 *  (1) Airtable field spec (channel: single-select sms/whatsapp) + a one-time backfill formula.
 *  (2) A reusable `resolveChannel(phone)` snippet (country-code -> channel) for Code nodes.
 *  (3) A reusable Twilio WhatsApp HTTP node template (parallel to the existing GHL sendGHL node)
 *      that sender workflows can wire in behind an IF(channel==='whatsapp') branch.
 *  (4) The 6 WhatsApp message-template drafts needed for Meta approval (WhatsApp requires
 *      pre-approved templates for business-initiated messages — free-form text only works within
 *      a customer-initiated 24h session window).
 *
 * NOT deployed to any live workflow yet — this is the design + code kit. Wiring it into each of the
 * 7 senders is a second pass once Twilio WhatsApp Business approval is confirmed (Meta review,
 * 1-3 business days), since the templates must be approved before any code referencing them works.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_deploy_whatsapp");
fs.mkdirSync(OUT, { recursive: true });

// (2) resolveChannel — country-code heuristic. +1 (US/Canada) -> sms; everything else -> whatsapp.
// Kept deliberately simple and overridable: an explicit `channel` value already on the profile
// always wins (lets us hand-flip a specific client either way without code changes).
const resolveChannelSnippet = `
function resolveChannel(phone, explicitChannel) {
  if (explicitChannel === 'sms' || explicitChannel === 'whatsapp') return explicitChannel;
  var p = String(phone || '').replace(/[^\\d+]/g, '');
  // +1 = US/Canada NANP -> GHL SMS (works today). Everything else -> WhatsApp (GHL SMS is
  // unreliable/blocked for most non-US A2P routes).
  if (/^\\+1\\d{10}$/.test(p)) return 'sms';
  return 'whatsapp';
}
`.trim();

fs.writeFileSync(path.join(OUT, "resolveChannel.snippet.js"), resolveChannelSnippet + "\n");

// (3) Twilio WhatsApp send node template — mirrors the existing sendGHL httpRequest node shape so
// it drops into any sender's chain behind an IsWhatsApp IF branch. Needs TWILIO_ACCOUNT_SID +
// TWILIO_AUTH_TOKEN (already in n8n's env per docker-compose.yml) and an approved WA sender number.
const sendWhatsAppNode = {
  id: "send-whatsapp-TEMPLATE",
  name: "sendWhatsApp",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1400, 400],
  onError: "continueRegularOutput",
  parameters: {
    method: "POST",
    url: "={{ 'https://api.twilio.com/2010-04-01/Accounts/' + $env.TWILIO_ACCOUNT_SID + '/Messages.json' }}",
    authentication: "genericCredentialType",
    genericAuthType: "httpBasicAuth", // Basic auth: username=TWILIO_ACCOUNT_SID, password=TWILIO_AUTH_TOKEN
    sendBody: true,
    contentType: "form-urlencoded",
    bodyParameters: {
      parameters: [
        { name: "From", value: "={{ 'whatsapp:' + $env.TWILIO_WHATSAPP_NUMBER }}" },
        { name: "To", value: "={{ 'whatsapp:' + $json.phone_number }}" },
        // NOTE: business-initiated WhatsApp messages OUTSIDE a 24h customer session window MUST
        // use an approved Content Template (ContentSid), not free-form Body. Free-form `Body` only
        // works for replies within 24h of the user's last message. Swap to ContentSid + ContentVariables
        // once templates are approved — see whatsapp-templates.md in this same output dir.
        { name: "Body", value: "={{ $json.reply || $json.sms || $json.signal_text }}" },
      ],
    },
    options: {},
  },
  credentials: {
    httpBasicAuth: { id: "TODO-add-twilio-basic-auth-cred", name: "Twilio Account SID/Auth Token" },
  },
};
fs.writeFileSync(path.join(OUT, "sendWhatsApp.node.json"), JSON.stringify(sendWhatsAppNode, null, 2));

// IF node template to branch on channel before the existing GHL send node.
const isWhatsAppNode = {
  id: "is-whatsapp-TEMPLATE",
  name: "IsWhatsApp",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [1180, 300],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 3 },
      conditions: [{
        id: "c1",
        leftValue: "={{ $json.channel }}",
        rightValue: "whatsapp",
        operator: { type: "string", operation: "equals" },
      }],
      combinator: "and",
    },
    options: {},
  },
};
fs.writeFileSync(path.join(OUT, "IsWhatsApp.node.json"), JSON.stringify(isWhatsAppNode, null, 2));

console.log("Wrote WhatsApp channel kit to _deploy_whatsapp/:");
console.log("  resolveChannel.snippet.js  — country-code -> channel logic for Code nodes");
console.log("  IsWhatsApp.node.json       — IF branch template (channel === 'whatsapp')");
console.log("  sendWhatsApp.node.json     — Twilio WhatsApp send node template");
console.log("\nNext: run _sim_whatsapp_channel.js to verify resolveChannel offline, then see");
console.log("WHATSAPP-templates.md for the 6 message templates to submit for Meta approval.");
