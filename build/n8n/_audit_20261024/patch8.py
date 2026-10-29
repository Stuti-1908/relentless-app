"""Patch 8 (2026-10-29): Code nodes run in n8n's task runner, whose sandbox has NO global `fetch`.
Every toChannel lookup threw "fetch is not defined" -> channel_reason lookup_error -> every message went
out as SMS (international clients never got email, so no two-way) and notification opt-outs were never
seen (suppressed always false). updateNudgeIfNeeded / parseAndWriteWeekly hit the same wall.
Fix: a tiny fetch-compatible shim over the runner's RPC `helpers.httpRequest` at the top of each node.

Also: parseInbound strips quoted history / HTML from email replies so "4 3 2" + "On Tue ... wrote: ..."
is read as "4 3 2".
Base: patched7.json. Output: patched8.json (superset; deploy only this one).
"""
import json

out = json.load(open("patched7.json", encoding="utf-8"))

SHIM = r"""// ---- fetch shim: the task-runner sandbox has no global fetch; route through n8n's helpers.httpRequest ----
const fetch = (typeof helpers !== 'undefined' && helpers && typeof helpers.httpRequest === 'function')
  ? async function (url, o) {
      o = o || {};
      const r = await helpers.httpRequest({ url: url, method: o.method || 'GET', headers: o.headers || {}, body: o.body,
        json: false, returnFullResponse: true, ignoreHttpStatusErrors: true });
      const b = r && r.body;
      const t = typeof b === 'string' ? b : (b == null ? '' : (typeof b.toString === 'function' && b.constructor && b.constructor.name === 'Buffer' ? b.toString('utf8') : JSON.stringify(b)));
      const s = Number(r && r.statusCode) || 0;
      return { ok: s >= 200 && s < 300, status: s, text: async () => t, json: async () => JSON.parse(t || 'null') };
    }
  : globalThis.fetch;
"""
MARK = "// ---- fetch shim:"
n_shim = 0
for wid, w in out.items():
    for n in w["nodes"]:
        c = n.get("parameters", {}).get("jsCode", "")
        if "fetch(" in c and MARK not in c:
            n["parameters"]["jsCode"] = SHIM + c
            n_shim += 1

CLEAN_AFTER = "if (text === '[object Object]') text = '';        // guard against a stringified object\n"
CLEAN = CLEAN_AFTER + r"""// Email replies arrive with HTML and the whole quoted thread below the answer: keep only the new text.
if (/<[a-z][\s\S]*>/i.test(text)) text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
text = text.split(/\r?\n\s*(?:On\s[^\n]{0,200}?wrote:|-{2,}\s*Original Message\s*-{2,}|_{5,}|From:\s[^\n]*|Sent from my [^\n]*|Get Outlook for [^\n]*)/i)[0];
text = text.split(/\r?\n/).filter(function (l) { return !/^\s*>/.test(l); }).join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
"""
pi = [n for n in out["ghlInboundV1"]["nodes"] if n["name"] == "parseInbound"][0]
assert pi["parameters"]["jsCode"].count(CLEAN_AFTER) == 1
pi["parameters"]["jsCode"] = pi["parameters"]["jsCode"].replace(CLEAN_AFTER, CLEAN)

assert n_shim == 14, n_shim
json.dump(out, open("patched8.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("patched8:", n_shim, "nodes shimmed;", ", ".join(out))
