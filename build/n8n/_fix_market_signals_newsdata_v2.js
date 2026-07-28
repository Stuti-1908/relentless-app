#!/usr/bin/env node
/* Fix market000001 (Market Signals) — v2, built against the LIVE (already multi-client-loop-fixed)
 * workflow, not the stale pre-Phase-1 backup. The v1 script (_fix_market_signals_newsdata.js) was
 * accidentally based on the OLD single-client backup and would have REGRESSED the loop-wrapper fix
 * if deployed — this version preserves it.
 *
 * Root problem (unchanged from v1's diagnosis): no real news source — Claude invents plausible but
 * stale/fabricated market signals. Fix: NewsData.io free tier -> real dated headlines -> Claude
 * synthesizes ONE signal grounded in them, or skips instead of hallucinating.
 *
 * decide's multi-client loop wrapper is UNTOUCHED except its inner per-client body: instead of
 * building the full Claude `body` itself, it now just passes through send/client_id/industry/
 * keywords/business_stage — same as v1's `decide`, but INSIDE the existing loop-wrapper shell.
 *
 * IsSend -> fetchNews -> buildPrompt -> callClaude -> extract -> writeSignal (extract keeps ITS OWN
 * loop-wrapper style, pairing callClaude's per-item output with buildPrompt's per-item context,
 * mirroring the existing extract pattern already used in this workflow for callClaude<->decide).
 *
 * Usage: node _fix_market_signals_newsdata_v2.js <path-to-live-workflow-json>
 * Writes _deploy_p1/market000001.json.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "_deploy_p1");
const SRC = process.argv[2];
if (!SRC) { console.error("Usage: node _fix_market_signals_newsdata_v2.js <live-workflow.json>"); process.exit(1); }

const w = JSON.parse(fs.readFileSync(SRC, "utf8"));
if (w.id !== "market000001") { console.error("Expected market000001, got", w.id); process.exit(1); }

const node = (name) => w.nodes.find((n) => n.name === name);
const decide = node("decide");
const isSend = node("IsSend");
const extract = node("extract");
const writeSignal = node("writeSignal");

// 1. decide: keep the EXACT loop-wrapper shell (TZ gate + per-client for-loop), replace only the
//    inner per-client body after the TZ gate to stop building the Claude body here.
const OLD_INNER_MARKER = "var pr=$json;var p=pr.fields?pr.fields:pr;";
if (!decide.parameters.jsCode.includes(OLD_INNER_MARKER)) {
  throw new Error("decide: expected inner-body marker not found — live code may have changed, aborting");
}
const NEW_INNER = [
  "var pr=$json;var p=pr.fields?pr.fields:pr;",
  "var plan=String(p.plan||'standard').toLowerCase();",
  "if(plan!=='pro'){return [{json:{send:false,reason:'market intel is Pro-only'}}];}",
  "return [{json:{send:true,client_id:(p.client_id||'client_test'),",
  "  industry:(p.industry||'their industry'), keywords:(p.market_keywords||''),",
  "  business_stage:(p.business_stage||'growing')}}];",
].join("\n");
// Replace from the marker up to (but not including) the closing `\n\n  })();` of the IIFE.
const idx = decide.parameters.jsCode.indexOf(OLD_INNER_MARKER);
const closeIdx = decide.parameters.jsCode.indexOf("\n\n  })();", idx);
if (closeIdx === -1) throw new Error("decide: could not find IIFE close marker");
decide.parameters.jsCode = decide.parameters.jsCode.slice(0, idx) + NEW_INNER + decide.parameters.jsCode.slice(closeIdx);
if (!decide.parameters.jsCode.includes("industry:(p.industry")) throw new Error("decide replace failed");

// 2. New fetchNews node (GET newsdata.io/latest, per-item since IsSend fans out per client)
const fetchNews = {
  id: "mk-news", name: "fetchNews", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
  position: [416, 96], onError: "continueRegularOutput",
  parameters: {
    method: "GET", url: "https://newsdata.io/api/1/latest", sendQuery: true,
    queryParameters: { parameters: [
      { name: "apikey", value: "={{ $env.NEWSDATA_API_KEY }}" },
      { name: "q", value: "={{ $json.keywords || $json.industry }}" },
      { name: "language", value: "en" },
      { name: "size", value: "5" },
    ]},
    options: {},
  },
};

// 3. New buildPrompt: per-item (IsSend/fetchNews already fan out one-per-client), pairs with
//    $('decide') by index via .item (n8n's normal pairedItem tracking works here since there's no
//    manual loop-wrapper between decide and this node — only IF/HTTP passthrough nodes).
const buildPrompt = {
  id: "mk-bp", name: "buildPrompt", type: "n8n-nodes-base.code", typeVersion: 2,
  position: [636, 96],
  parameters: {
    jsCode: [
      "var ctx = $('decide').item.json;",
      "if (!ctx.send) return [{ json: ctx }];",
      "var resp = $json || {};",
      "var arts = Array.isArray(resp.results) ? resp.results : [];",
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

// 4. extract: keep the SAME loop-wrapper pairing style already used here (pairs callClaude's i-th
//    output with buildPrompt's i-th item — buildPrompt replaces decide as the paired context node
//    since it's the immediate upstream of callClaude and carries client_id/source/date through).
extract.parameters.jsCode = [
  "// [loop-wrapper for extract — pair Claude response i with buildPrompt item i]",
  "const __C = $input.all(); const __D = $('buildPrompt').all(); const __OUT = [];",
  "for (let __i = 0; __i < __C.length; __i++) {",
  "  const __cItem = __C[__i];",
  "  const __dItem = __D[__i] || __C[__i];",
  "  const __r = (function(){",
  "    var ctx = __dItem.json;",
  "    if (!ctx.send) return [{ json: { skip: true, client_id: ctx.client_id, reason: ctx.reason } }];",
  "    var t=__cItem.json.content[0].text;",
  "    t=t.replace(/[\\u2014\\u2013]/g,'-').replace(/[\\u2018\\u2019]/g,\"'\").replace(/[\\u201c\\u201d]/g,'\"').replace(/[^\\x00-\\x7F]/g,'').replace(/\\s+/g,' ').trim();",
  "    return [{json:{signal_text:t.slice(0,300),client_id:ctx.client_id,source:ctx.top_source,article_date:ctx.top_date}}];",
  "  })();",
  "  if (Array.isArray(__r)) { for (const __x of __r) __OUT.push(__x); }",
  "  else if (__r != null) __OUT.push(__r);",
  "}",
  "return __OUT;",
].join("\n");

// 5. writeSignal: record the REAL source + real article date (was hardcoded 'news_api', no date).
writeSignal.parameters.columns.value = {
  client_id: "={{ $json.client_id }}",
  date: "={{ $now.toFormat('yyyy-MM-dd') }}",
  signal_text: "={{ $json.signal_text || '' }}",
  source: "={{ $json.source || 'newsdata.io' }}",
  article_date: "={{ $json.article_date || '' }}",
  delivered: "={{ !$json.skip }}",
};

// 6. rewire IsSend's TRUE branch to fetchNews (index 0 of its main output), keep FALSE branch empty.
w.connections["IsSend"] = { main: [[{ node: "fetchNews", type: "main", index: 0 }], []] };
w.connections["fetchNews"] = { main: [[{ node: "buildPrompt", type: "main", index: 0 }]] };
w.connections["buildPrompt"] = { main: [[{ node: "callClaude", type: "main", index: 0 }]] };
w.connections["callClaude"] = { main: [[{ node: "extract", type: "main", index: 0 }]] };
w.connections["extract"] = { main: [[{ node: "writeSignal", type: "main", index: 0 }]] };

if (!w.nodes.some((n) => n.name === "fetchNews")) w.nodes.push(fetchNews);
if (!w.nodes.some((n) => n.name === "buildPrompt")) w.nodes.push(buildPrompt);

const clean = { id: w.id, name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {}, active: true };
fs.writeFileSync(path.join(OUT, "market000001.json"), JSON.stringify(clean, null, 2));
console.log("market000001 fixed (v2, preserves live multi-client loop wrapper): NewsData.io -> real dated headlines -> Claude synthesizes grounded signal, or skips. -> _deploy_p1/market000001.json");
