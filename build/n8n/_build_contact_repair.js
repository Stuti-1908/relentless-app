#!/usr/bin/env node
/* PHASE 3 — build contactRepair1: sweep clients with a phone but no ghl_contact_id, create the
 * GHL contact, and patch the Airtable row. Fixes the 8/14 live clients who can never receive SMS.
 *
 * Built correctly from the start (per-item via Loop Over Items; no run-once-for-all-items bug).
 * Schedule: every 6h at :45 (avoid colliding with the hourly :00/:30 senders).
 *
 * Confirmed config (from live workflows):
 *   Airtable: base appjnWxg9sB3PV7Da, table tbl_client_profile, cred Z1DGfO9LPHXmAo4W
 *   GHL: httpHeaderAuth cred fLewYZwvD9PfMAQJ, POST /contacts/, Version 2021-07-28,
 *        locationId HlI90j86nBEuhp9Oovf9
 *
 * Chain: Schedule -> Search records (phone!='' AND ghl_contact_id='') -> Loop Over Clients
 *        -> createContact (GHL) -> parseResult (Code) -> IsOk (IF)
 *           IsOk true  -> patchRow (Airtable update ghl_contact_id) -> Loop  (back-edge)
 *           IsOk false -> alertDLQ (Airtable create in tbl_dead_letter) -> Loop (back-edge)
 * Output: _deploy_p1/contactRepair1.json
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });

const AIR_BASE = "appjnWxg9sB3PV7Da";
const AIR_CRED = { airtableTokenApi: { id: "Z1DGfO9LPHXmAo4W", name: "Airtable Goecoach Personal Access Token account" } };
const GHL_CRED = { httpHeaderAuth: { id: "fLewYZwvD9PfMAQJ", name: "Header Auth account 2" } };
const GHL_LOCATION = "HlI90j86nBEuhp9Oovf9";

const nodes = [
  {
    parameters: { rule: { interval: [{ field: "hours", hoursInterval: 6, triggerAtMinute: 45 }] } },
    id: "cr-sched", name: "Schedule Trigger", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [-400, 300],
  },
  {
    parameters: { operation: "search", base: { __rl: true, value: AIR_BASE, mode: "list" },
      table: { __rl: true, value: "={{ 'tbl_client_profile' }}", mode: "id" },
      filterByFormula: "={{ \"AND({active}=1, {phone_number}!='', {ghl_contact_id}='')\" }}",
      returnAll: true, options: {} },
    id: "cr-search", name: "Search records", type: "n8n-nodes-base.airtable", typeVersion: 2.2, position: [-180, 300], credentials: AIR_CRED,
  },
  {
    parameters: { options: {} },
    id: "cr-loop", name: "Loop Over Clients", type: "n8n-nodes-base.splitInBatches", typeVersion: 3, position: [60, 300],
  },
  {
    parameters: {
      method: "POST", url: "https://services.leadconnectorhq.com/contacts/",
      authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
      sendHeaders: true, headerParameters: { parameters: [
        { name: "Version", value: "2021-07-28" }, { name: "Content-Type", value: "application/json" }] },
      sendBody: true, specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ locationId: '" + GHL_LOCATION + "', name: ($json.fields.full_name || 'Client'), phone: $json.fields.phone_number }) }}",
      options: { response: { response: { neverError: true, fullResponse: true } } },
    },
    id: "cr-create", name: "createContact", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [280, 200], credentials: GHL_CRED,
    onError: "continueRegularOutput",
  },
  {
    parameters: { mode: "runOnceForEachItem", jsCode:
      "// parse GHL create response; carry the Airtable row id for the patch/alert\n" +
      "var row = $('Loop Over Clients').item.json;\n" +
      "var rowId = row.id;\n" +
      "var f = row.fields || {};\n" +
      "var body = $json.body != null ? $json.body : $json;\n" +
      "var code = ($json.statusCode != null ? $json.statusCode : ($json.status != null ? $json.status : 0));\n" +
      "var contactId = (body && body.contact && body.contact.id) ? body.contact.id : ((body && body.id) ? body.id : '');\n" +
      "// GHL returns 400 'duplicated contact' with the existing id in meta — recover it if present\n" +
      "if (!contactId && body && body.meta && body.meta.contactId) contactId = body.meta.contactId;\n" +
      "return { json: { rowId: rowId, client_id: (f.client_id||''), phone: (f.phone_number||''), contactId: contactId, ok: !!contactId, ghlStatus: code, raw: JSON.stringify(body).slice(0,300) } };" },
    id: "cr-parse", name: "parseResult", type: "n8n-nodes-base.code", typeVersion: 2, position: [500, 200],
  },
  {
    parameters: { conditions: { options: { caseSensitive: true, typeValidation: "loose", version: 3 },
      conditions: [{ id: "ok", leftValue: "={{ $json.ok }}", rightValue: "", operator: { type: "boolean", operation: "true", singleValue: true } }],
      combinator: "and" }, options: {} },
    id: "cr-isok", name: "IsOk", type: "n8n-nodes-base.if", typeVersion: 2, position: [720, 200],
  },
  {
    parameters: { operation: "update", base: { __rl: true, value: AIR_BASE, mode: "list" },
      table: { __rl: true, value: "={{ 'tbl_client_profile' }}", mode: "id" },
      columns: { mappingMode: "defineBelow", matchingColumns: ["id"], schema: [],
        value: { id: "={{ $json.rowId }}", ghl_contact_id: "={{ $json.contactId }}" } },
      options: { typecast: true } },
    id: "cr-patch", name: "patchRow", type: "n8n-nodes-base.airtable", typeVersion: 2.2, position: [940, 100], credentials: AIR_CRED,
    onError: "continueRegularOutput",
  },
  {
    parameters: { operation: "create", base: { __rl: true, value: AIR_BASE, mode: "list" },
      table: { __rl: true, value: "={{ 'tbl_dead_letter' }}", mode: "id" },
      columns: { mappingMode: "defineBelow", schema: [],
        value: { source: "contactRepair1", client_id: "={{ $json.client_id }}",
          error: "={{ 'GHL contact create failed status=' + $json.ghlStatus + ' phone=' + $json.phone + ' :: ' + $json.raw }}",
          created_at: "={{ $now.toISO() }}" } },
      options: { typecast: true } },
    id: "cr-dlq", name: "alertDLQ", type: "n8n-nodes-base.airtable", typeVersion: 2.2, position: [940, 320], credentials: AIR_CRED,
    onError: "continueRegularOutput",
  },
];

const connections = {
  "Schedule Trigger": { main: [[{ node: "Search records", type: "main", index: 0 }]] },
  "Search records": { main: [[{ node: "Loop Over Clients", type: "main", index: 0 }]] },
  "Loop Over Clients": { main: [[], [{ node: "createContact", type: "main", index: 0 }]] },
  "createContact": { main: [[{ node: "parseResult", type: "main", index: 0 }]] },
  "parseResult": { main: [[{ node: "IsOk", type: "main", index: 0 }]] },
  "IsOk": { main: [[{ node: "patchRow", type: "main", index: 0 }], [{ node: "alertDLQ", type: "main", index: 0 }]] },
  "patchRow": { main: [[{ node: "Loop Over Clients", type: "main", index: 0 }]] },
  "alertDLQ": { main: [[{ node: "Loop Over Clients", type: "main", index: 0 }]] },
};

const wf = { id: "contactRepair1", name: "Relentless AI - Contact Repair (GHL backfill)", nodes, connections, settings: {}, active: true };
fs.writeFileSync(path.join(OUT, "contactRepair1.json"), JSON.stringify(wf, null, 2));
console.log("contactRepair1 built -> _deploy_p1/contactRepair1.json (Loop per-client, GHL create, patch/DLQ).");
