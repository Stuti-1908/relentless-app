#!/usr/bin/env node
/* Fix a real bug found live 2026-07-05 11:00 UTC (exec 14227): buildPrompt correctly sets
 * send:false + a `reason` when NewsData.io returns no fresh articles, but buildPrompt -> callClaude
 * is an UNCONDITIONAL connection with no gate re-checking send. So the "no news" item still flows
 * into callClaude with no `body` field; `JSON.stringify($json.body)` on undefined literally returns
 * the JS value `undefined` (not the string "undefined"), and n8n's httpRequest node then fails
 * trying to send that as the JSON request body: '"undefined" is not valid JSON'.
 *
 * FIX: insert a `HasNews` IF node (mirrors the existing IsSend pattern) between buildPrompt and
 * callClaude, checking $json.send. True -> callClaude. False -> nothing (client gets no market
 * signal this cycle, correctly, since there was no real news to report - no fallback, no
 * hallucination, matches the whole point of this fix).
 *
 * Reads the CURRENT LIVE workflow JSON (must be pulled fresh - this fix builds on the already-live
 * NewsData.io integration, not the original pre-deploy backup). Usage:
 *   node _fix_market_no_news_gate.js <path-to-live-market000001.json>
 * Writes _deploy_p1/market000001.json.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_deploy_p1");
const SRC = process.argv[2];
if (!SRC) { console.error("Usage: node _fix_market_no_news_gate.js <live-workflow.json>"); process.exit(1); }

const w = JSON.parse(fs.readFileSync(SRC, "utf8"));
if (w.id !== "market000001") { console.error("Expected market000001, got", w.id); process.exit(1); }

if (w.nodes.some((n) => n.name === "HasNews")) {
  console.log("HasNews gate already present — skipping.");
} else {
  const hasNews = {
    id: "mk-hasnews",
    name: "HasNews",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [636, 220],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 3 },
        conditions: [{
          id: "hn1",
          leftValue: "={{ $json.send }}",
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        }],
        combinator: "and",
      },
      options: {},
    },
  };
  w.nodes.push(hasNews);

  // rewire buildPrompt -> HasNews -> [true: callClaude]
  w.connections["buildPrompt"] = { main: [[{ node: "HasNews", type: "main", index: 0 }]] };
  w.connections["HasNews"] = { main: [[{ node: "callClaude", type: "main", index: 0 }], []] };

  console.log("Inserted HasNews gate: buildPrompt -> HasNews(send===true) -> callClaude. False branch drops the item (no news, no send, no crash).");
}

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "market000001.json"), JSON.stringify(clean, null, 2));
console.log("-> _deploy_p1/market000001.json");
