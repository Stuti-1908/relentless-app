#!/usr/bin/env node
/* Sweep: convert $('loadProfile'|'Search records'|'decide'|'buildNudgePrompt'|'normalizeClient').first()
 * to .item across ALL rebuilt workflows. In a per-item (multi-client) chain, .first() always grabs
 * client #0; .item tracks the client actually flowing through. Critical because most clients share
 * the America/New_York timezone, so multiple pass the hourly gate at once. */
const fs = require("fs");
const path = require("path");
const FILE = path.join(__dirname, "_REBUILT_workflows.json");
const wfs = JSON.parse(fs.readFileSync(FILE, "utf8"));

const NODES = ["loadProfile", "Search records", "decide", "buildNudgePrompt", "normalizeClient"];
let count = 0;

function fixStr(s) {
  let out = s;
  for (const nd of NODES) {
    // match $('NodeName').first()  or  $("NodeName").first()
    const esc = nd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\$\\((['\"])" + esc + "\\1\\)\\.first\\(\\)", "g");
    out = out.replace(re, (m, q) => { count++; return "$(" + q + nd + q + ").item"; });
  }
  return out;
}

function walk(o) {
  if (typeof o === "string") return fixStr(o);
  if (Array.isArray(o)) return o.map(walk);
  if (o && typeof o === "object") {
    const r = {};
    for (const k of Object.keys(o)) r[k] = walk(o[k]);
    return r;
  }
  return o;
}

const fixed = wfs.map(walk);
fs.writeFileSync(FILE, JSON.stringify(fixed, null, 2));
console.log("Converted", count, ".first() -> .item across per-item nodes in", wfs.length, "workflows.");
