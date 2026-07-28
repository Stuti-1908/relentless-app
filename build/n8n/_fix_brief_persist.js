#!/usr/bin/env node
/* Add a tbl_briefings write to briefBuilder1 so the dashboard's Morning Briefing card shows
 * today's real briefing (it currently sends the SMS but never persists -> dashboard stale at 06-24).
 * Appends a `persistBriefing` Airtable-create node after openConversation.
 * Output: _deploy3/briefBuilder1.json
 */
const fs = require("fs");
const path = require("path");
const wfs = JSON.parse(fs.readFileSync(path.join(__dirname, "_NOW_workflows.json"), "utf8"));
const w = wfs.find((x) => x.id === "briefBuilder1");
if (!w) { console.error("briefBuilder1 not found"); process.exit(1); }

if (w.nodes.some((n) => n.name === "persistBriefing")) {
  console.log("persistBriefing already present — skipping add.");
} else {
  const persist = {
    id: "bb-persist",
    name: "persistBriefing",
    type: "n8n-nodes-base.airtable",
    typeVersion: 2.2,
    position: [1840, 220],
    onError: "continueRegularOutput",
    credentials: { airtableTokenApi: { id: "Z1DGfO9LPHXmAo4W", name: "Airtable Goecoach Personal Access Token account" } },
    parameters: {
      operation: "create",
      base: { __rl: true, value: "appjnWxg9sB3PV7Da", mode: "list" },
      table: { __rl: true, value: "={{ 'tbl_briefings' }}", mode: "id" },
      columns: {
        mappingMode: "defineBelow",
        matchingColumns: ["client_id"],
        schema: [],
        value: {
          client_id: "={{ $('extract').item.json.client_id || ($('Webhook').first().json.body.client_id) || 'client_test' }}",
          date: "={{ $now.toFormat('yyyy-MM-dd') }}",
          briefing_text: "={{ $('extract').item.json.reply }}",
          delivered_at: "={{ $now.toISO() }}",
          briefing_ran: true,
        },
      },
      options: { typecast: true },
    },
  };
  w.nodes.push(persist);
  // wire openConversation -> persistBriefing
  w.connections["openConversation"] = w.connections["openConversation"] || { main: [[]] };
  w.connections["openConversation"].main[0] = (w.connections["openConversation"].main[0] || []).concat([{ node: "persistBriefing", type: "main", index: 0 }]);
  console.log("added persistBriefing + wired openConversation -> persistBriefing");
}

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: !!w.active };
fs.mkdirSync(path.join(__dirname, "_deploy3"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "_deploy3", "briefBuilder1.json"), JSON.stringify(clean, null, 2));
console.log("-> _deploy3/briefBuilder1.json (active:", clean.active + ")");
