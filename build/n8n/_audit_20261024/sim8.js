// Patch 8: run every shimmed Code node in a vm sandbox WITHOUT fetch (like n8n's task runner), with only
// `helpers.httpRequest` available, and check routing/suppression actually work; plus email-reply cleaning.
const fs = require("fs"), vm = require("vm");
const P = JSON.parse(fs.readFileSync(__dirname + "/patched8.json", "utf8"));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + m); };

function runner(code, ctx) {  // mirrors JsTaskRunner.runDirectly: with(context) { async function(){code} }
  const context = vm.createContext({ ...ctx, console });
  return vm.runInContext("(async function(){" + code + "\n})()", context);
}
const calls = [];
const mkHelpers = row => ({ httpRequest: async o => { calls.push(o); return { statusCode: 200, body: JSON.stringify(row ? [row] : []) }; } });

(async () => {
  const intl = { client_id: "c1", full_name: "Bhakti M", phone_number: "+919876543210", email: "b@x.com", delivery_channel: "email" };
  for (const [wid, w] of Object.entries(P)) {
    const tc = w.nodes.find(n => n.name === "toChannel");
    const j = { client_id: "c1", ghl_contact_id: "C", reply: "hello" };
    const base = { $json: j, $: () => ({ first: () => ({ json: j }) }), $env: { SUPABASE_SERVICE_KEY: "k" } };
    const r1 = (await runner(tc.parameters.jsCode, { ...base, helpers: mkHelpers({ ...intl, notification_prefs: {} }) })).json;
    const r2 = (await runner(tc.parameters.jsCode, { ...base, helpers: mkHelpers({ ...intl, notification_prefs: { paused: true } }) })).json;
    const hdr = calls[calls.length - 1].headers || {};
    const isReply = wid === "ghlInboundV1";
    ok(r1.channel === "email" && r1.ghl_payload.type === "Email" && r1.channel_reason === "email" && hdr.apikey === "k"
       && r2.suppressed === !isReply, `${wid.padEnd(16)} no-fetch sandbox: lookup OK -> Email; paused -> ${isReply ? "still sent (reply)" : "suppressed"}`);
  }
  // other fetch users exist and are shimmed
  for (const nm of ["updateNudgeIfNeeded", "parseAndWriteWeekly"]) {
    const n = P.ghlInboundV1.nodes.find(x => x.name === nm);
    ok(n.parameters.jsCode.startsWith("// ---- fetch shim:"), `ghlInboundV1     ${nm} shimmed`);
  }
  // shim error path: non-2xx surfaces ok=false, never throws on status
  const t = await runner("const r = await fetch('u'); return [r.ok, r.status, await r.text()];".replace(/^/, P.ghlInboundV1.nodes.find(x => x.name === "toChannel").parameters.jsCode.split("// ---- choose")[0].split("const fetch")[0] + "const fetch" + P.ghlInboundV1.nodes.find(x => x.name === "toChannel").parameters.jsCode.split("const fetch")[1].split(": globalThis.fetch;")[0] + ": globalThis.fetch;\n"),
    { helpers: { httpRequest: async () => ({ statusCode: 401, body: '{"message":"bad"}' }) } });
  ok(t[0] === false && t[1] === 401 && t[2].includes("bad"), "shim maps 401 to ok=false with body");

  // parseInbound email cleaning
  const pi = P.ghlInboundV1.nodes.find(n => n.name === "parseInbound").parameters.jsCode;
  const parse = async body => { const out = await runner(pi, { $: () => ({ first: () => ({ json: { body, headers: {} } }) }), $env: {} }); return out[0] && out[0].json.text; };
  const cases = [
    [{ contact_id: "C", message: { body: "4 3 2\n" } }, "4 3 2"],
    [{ contact_id: "C", message: { body: "4 3 2\n\nOn Tue, Oct 28, 2026 at 7:01 AM Relentless AI <coach@x.com> wrote:\n> Good morning\n> reply with 3 numbers" } }, "4 3 2"],
    [{ contact_id: "C", message: { body: "<div dir=\"ltr\">5 4 1</div><br><div class=\"gmail_quote\"><div>On Wed, Oct 29 wrote:</div><blockquote>old</blockquote></div>" } }, "5 4 1"],
    [{ contact_id: "C", message: { body: "Closed the deal today!\nSent from my iPhone\n\n> earlier text" } }, "Closed the deal today!"],
    [{ contact_id: "C", message: { body: "Yes\n-----Original Message-----\nFrom: coach" } }, "Yes"],
  ];
  for (const [b, want] of cases) { const got = await parse(b); ok(got === want, `parseInbound -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`); }
  console.log(`RESULT ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
