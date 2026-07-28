#!/usr/bin/env node
/* Fix market000001 (Market Signals): it currently has NO real news source — Claude is asked to
 * "give me this week's market signal" with zero live context, so it hallucinates plausible but
 * STALE/fabricated items from its training data (hence dates like "Jun 24/25/26" or old-year
 * events) and writeSignal hardcodes source:"news_api" even though no API is called.
 *
 * FIX: call NewsData.io (free tier: newsdata.io/api/1/latest, 200 req/day, no card required) with
 * the client's industry/keywords, feed the top real headlines (with real pubDate) into Claude's
 * prompt, and have Claude synthesize ONE signal FROM those real articles — citing the real
 * headline + date. writeSignal now records the true source and the real article date.
 *
 * New chain: loadProfile -> decide -> IsSend -> fetchNews -> buildPrompt -> callClaude -> extract
 *            -> writeSignal
 * (decide keeps the TZ gate + Pro-only gate + industry/keywords; buildPrompt merges news + builds
 * the Claude request body, replacing that responsibility in the old `decide`.)
 *
 * Needs an n8n credential "NewsData.io API Key" (httpHeaderAuth or query-param) — see notes below.
 * Reads _BACKUP_live_workflows_20260702.json, writes _deploy_p1/market000001.json.
 */
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "_BACKUP_live_workflows_20260702.json");
const OUT = path.join(__dirname, "_deploy_p1");
fs.mkdirSync(OUT, { recursive: true });
const wfs = JSON.parse(fs.readFileSync(SRC, "utf8"));
const w = wfs.find((x) => x.id === "market000001");
if (!w) { console.error("market000001 not found"); process.exit(1); }

const decide = w.nodes.find((n) => n.name === "decide");
const extract = w.nodes.find((n) => n.name === "extract");
const writeSignal = w.nodes.find((n) => n.name === "writeSignal");
const callClaude = w.nodes.find((n) => n.name === "callClaude");

// 1. `decide`: keep the TZ gate + Pro-only gate, but STOP building the Claude body here — just
//    pass through the client's industry/keywords/client_id. (multi-client loop-wrapper already
//    applied by the earlier Phase 1 fix — this REPLACES only the tail after the Pro-only check.)
decide.parameters.jsCode = [
  "// === TZ GATE (top-level; returns [] to skip this client) ===",
  "{",
  "  var __it = $json.fields ? $json.fields : $json;",
  "  var __tz = __it.timezone || 'America/New_York';",
  "  var __now;",
  "  try { __now = new Date(new Date().toLocaleString('en-US', { timeZone: __tz })); }",
  "  catch (e) { __now = new Date(); }",
  "  var __h = __now.getHours();",
  "  var __target = 5;",
  "  if (__h !== __target) { return []; }",
  "}",
  "// === END TZ GATE ===",
  "var pr=$('loadProfile').item.json;var p=pr.fields?pr.fields:pr;",
  "var plan=String(p.plan||'standard').toLowerCase();",
  "if(plan!=='pro'){return [{json:{send:false,reason:'market intel is Pro-only'}}];}",
  "return [{json:{send:true,client_id:(p.client_id||'client_test'),",
  "  industry:(p.industry||'their industry'), keywords:(p.market_keywords||''),",
  "  business_stage:(p.business_stage||'growing')}}];",
].join("\n");

// 2. NEW fetchNews node: NewsData.io /latest, query built from industry+keywords, English, last
//    48h (the API's `latest` endpoint returns recent articles; free tier has no date-range param,
//    so we ask for latest and rely on pubDate being recent). onError continue so a news outage
//    doesn't kill the send — buildPrompt falls back to a "no fresh signal" skip.
const fetchNews = {
  id: "mk-news",
  name: "fetchNews",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [416, 96],
  onError: "continueRegularOutput",
  parameters: {
    method: "GET",
    url: "https://newsdata.io/api/1/latest",
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "apikey", value: "={{ $credentials.newsDataApi ? $credentials.newsDataApi.apiKey : $env.NEWSDATA_API_KEY }}" },
        { name: "q", value: "={{ $json.keywords || $json.industry }}" },
        { name: "language", value: "en" },
        { name: "size", value: "5" },
      ],
    },
    options: {},
  },
};

// 3. NEW buildPrompt node: merge decide's client context + fetchNews articles into the Claude
//    request body. If NewsData returned nothing usable, `send:false` (skip rather than hallucinate).
const buildPrompt = {
  id: "mk-bp",
  name: "buildPrompt",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [636, 96],
  parameters: {
    jsCode: [
      "var ctx = $('decide').item.json;",
      "if (!ctx.send) return [{ json: ctx }];",
      "var resp = $json || {};",
      "var arts = Array.isArray(resp.results) ? resp.results : [];",
      "// keep only articles with a real title + pubDate, most recent first",
      "arts = arts.filter(function(a){ return a && a.title && a.pubDate; })",
      "           .sort(function(a,b){ return new Date(b.pubDate) - new Date(a.pubDate); })",
      "           .slice(0, 5);",
      "if (!arts.length) {",
      "  return [{ json: Object.assign({}, ctx, { send: false, reason: 'no fresh news articles found' }) }];",
      "}",
      "var lines = arts.map(function(a, i) {",
      "  var d = new Date(a.pubDate); var ds = isNaN(d) ? a.pubDate : d.toISOString().slice(0, 10);",
      "  return (i + 1) + '. [' + ds + '] ' + a.title + (a.source_id ? ' (' + a.source_id + ')' : '');",
      "}).join('\\n');",
      "var sys = ['You are a market-intelligence analyst briefing a ' + ctx.business_stage + '-stage executive in ' + ctx.industry + (ctx.keywords ? (' (watching: ' + ctx.keywords + ')') : '') + '.',",
      "  'Below are REAL, DATED news headlines from the last few days. Pick the ONE most relevant to this executive and write a specific market signal grounded in it: state what happened (with its real date), then a concrete SO-WHAT for this exec this week.',",
      "  'Plain text under 280 chars, no emojis. Do not invent facts beyond the headline. If none are relevant, say so briefly instead of forcing a connection.',",
      "  '', 'HEADLINES:', lines].join('\\n');",
      "return [{ json: Object.assign({}, ctx, { send: true,",
      "  top_source: arts[0].source_id || 'news', top_date: (new Date(arts[0].pubDate).toISOString().slice(0,10)),",
      "  body: { model: 'claude-sonnet-4-6', max_tokens: 220, system: sys, messages: [{ role: 'user', content: 'Give me this week market signal from the headlines above.' }] } }) }];",
    ].join("\n"),
  },
};

// 4. extract: same sanitize, but carry through client_id + the REAL source/date from buildPrompt.
extract.parameters.jsCode = [
  "var ctx = $('buildPrompt').item.json;",
  "if (!ctx.send) return [{ json: { skip: true, client_id: ctx.client_id, reason: ctx.reason } }];",
  "var t=$input.item.json.content[0].text;",
  "t=t.replace(/[\\u2014\\u2013]/g,'-').replace(/[\\u2018\\u2019]/g,\"'\").replace(/[\\u201c\\u201d]/g,'\"').replace(/[^\\x00-\\x7F]/g,'').replace(/\\s+/g,' ').trim();",
  "return [{json:{signal_text:t.slice(0,300),client_id:ctx.client_id,source:ctx.top_source,article_date:ctx.top_date}}];",
].join("\n");
extract.parameters.mode = "runOnceForEachItem";

// 5. writeSignal: record the REAL source + real article date (was hardcoded 'news_api' with no
//    real article date at all — that's the root cause of the stale/fabricated dates on the card).
writeSignal.parameters.columns.value = {
  client_id: "={{ $json.client_id }}",
  date: "={{ $now.toFormat('yyyy-MM-dd') }}",
  signal_text: "={{ $json.signal_text || '' }}",
  source: "={{ $json.source || 'newsdata.io' }}",
  article_date: "={{ $json.article_date || '' }}",
  delivered: "={{ !$json.skip }}",
};

// 6. rewire: IsSend -> fetchNews -> buildPrompt -> callClaude -> extract -> writeSignal
w.connections["IsSend"] = { main: [[{ node: "fetchNews", type: "main", index: 0 }]] };
w.connections["fetchNews"] = { main: [[{ node: "buildPrompt", type: "main", index: 0 }]] };
w.connections["buildPrompt"] = { main: [[{ node: "callClaude", type: "main", index: 0 }]] };
w.connections["callClaude"] = { main: [[{ node: "extract", type: "main", index: 0 }]] };
w.connections["extract"] = { main: [[{ node: "writeSignal", type: "main", index: 0 }]] };

if (!w.nodes.some((n) => n.name === "fetchNews")) w.nodes.push(fetchNews);
if (!w.nodes.some((n) => n.name === "buildPrompt")) w.nodes.push(buildPrompt);

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "market000001.json"), JSON.stringify(clean, null, 2));
console.log("market000001 fixed: NewsData.io free tier -> real dated headlines -> Claude synthesizes ONE grounded signal. -> _deploy_p1/market000001.json");
console.log("\nNEEDS: NEWSDATA_API_KEY env var on the n8n container (or an httpHeaderAuth/query cred named 'newsDataApi').");
console.log("Get a free key (no card) at https://newsdata.io/register — 200 requests/day on the free plan.");
