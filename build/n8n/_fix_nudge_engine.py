# P5 (2026-07-06): nudgeEngineGhl1 fixes, patched on top of live export _LIVE_nudge.json:
# 1. extractNudge + norm(): /s+/g -> /\s+/g (lost backslash was deleting every lowercase 's'
#    from nudges AND breaking the anti-repeat comparison).
# 2. buildNudgePrompt: remove redundant $now.hour server-tz (IST) window gate — per-client tz
#    gate (8..18 local) already handles it; the IST gate was blocking US clients' daytime.
# 3. Throttle 75 -> 110 min (user wants ~2-hourly cadence; cron is hourly).
# 4. NEW node getGhlTasks (GET /contacts/{id}/tasks, GHL header auth) inserted between
#    getRecentNudges and buildNudgePrompt; prompt now lists up to 5 open tasks (due-today first)
#    and tells Claude to reference the most urgent task or priority.
import json, pathlib

HERE = pathlib.Path(__file__).parent
DST = HERE / "_deploy_p5"
DST.mkdir(exist_ok=True)
r = json.load(open(HERE / "_LIVE_nudge.json", encoding="utf-8"))[0]
nodes = json.loads(r["nodes"])
conns = json.loads(r["connections"])

# --- 1. extractNudge regex fix
ex = next(n for n in nodes if n["name"] == "extractNudge")
code = ex["parameters"]["jsCode"]
assert code.count("replace(/s+/g") == 2, code.count("replace(/s+/g")
code = code.replace("replace(/s+/g", "replace(/\\s+/g")
ex["parameters"]["jsCode"] = code

# --- 2+3+4. buildNudgePrompt
bp = next(n for n in nodes if n["name"] == "buildNudgePrompt")
code = bp["parameters"]["jsCode"]
old_gate = "const hour = $now.hour;\nif (hour < 8 || hour >= 19) return [{ json: Object.assign({}, baseOut, { skip_reason: 'outside_window' }) }];\n"
assert old_gate in code
code = code.replace(old_gate, "")
assert "< 75)" in code
code = code.replace("< 75)", "< 110)")

tasks_block = """
let openTasks = [];
try {
  const tj = $('getGhlTasks').item.json || {};
  const tl = Array.isArray(tj.tasks) ? tj.tasks : [];
  const nowLoc = new Date(new Date().toLocaleString('en-US', { timeZone: __tz }));
  const todayStr = nowLoc.getFullYear() + '-' + String(nowLoc.getMonth() + 1).padStart(2, '0') + '-' + String(nowLoc.getDate()).padStart(2, '0');
  const open = tl.filter(t => t && !t.completed && t.title);
  const dueToday = open.filter(t => String(t.dueDate || '').slice(0, 10) <= todayStr);
  const rest = open.filter(t => !dueToday.includes(t));
  openTasks = dueToday.concat(rest).slice(0, 5).map(t => String(t.title).slice(0, 60) + (String(t.dueDate || '').slice(0, 10) === todayStr ? ' (due today)' : ''));
} catch (e) { openTasks = []; }
"""
anchor = "const priorities = [p.top_priority_1, p.top_priority_2, p.top_priority_3].filter(Boolean);"
assert anchor in code
code = code.replace(anchor, tasks_block + anchor)

old_sys = "  'CURRENT FOCUS: ' + focus + '.',"
new_sys = ("  'CURRENT FOCUS: ' + focus + '.',\n"
           "  openTasks.length ? ('OPEN TASKS: ' + openTasks.join('; ') + '. Reference the most urgent one directly.') : '',")
assert old_sys in code
code = code.replace(old_sys, new_sys)
bp["parameters"]["jsCode"] = code

# --- 4. new getGhlTasks node (position near getRecentNudges)
grn = next(n for n in nodes if n["name"] == "getRecentNudges")
pos = [grn["position"][0] + 200, grn["position"][1] - 160]
nodes.append({
    "parameters": {
        "url": "={{ 'https://services.leadconnectorhq.com/contacts/' + ((($('normalizeClient').item.json.fields) || $('normalizeClient').item.json).ghl_contact_id || 'none') + '/tasks' }}",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "Version", "value": "2021-07-28"}]},
        "options": {},
    },
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": pos,
    "id": "b7f1c2d3-0000-4a5b-9c8d-getghltasks1",
    "name": "getGhlTasks",
    "alwaysOutputData": True,
    "onError": "continueRegularOutput",
    "credentials": {"httpHeaderAuth": {"id": "fLewYZwvD9PfMAQJ", "name": "Header Auth account 2"}},
})
# rewire: getRecentNudges -> getGhlTasks -> buildNudgePrompt
assert conns["getRecentNudges"]["main"][0][0]["node"] == "buildNudgePrompt"
conns["getRecentNudges"]["main"][0][0]["node"] = "getGhlTasks"
conns["getGhlTasks"] = {"main": [[{"node": "buildNudgePrompt", "type": "main", "index": 0}]]}

out = {"id": r["id"], "name": r["name"], "nodes": nodes, "connections": conns}
s = json.dumps(out, indent=2, ensure_ascii=False)
for marker in ["replace(/\\\\s+/g", "getGhlTasks", "OPEN TASKS", "< 110)"]:
    assert marker.replace("\\\\", "\\") in s or marker in s, marker
assert "$now.hour" not in s
json.dump(out, open(DST / "nudgeEngineGhl1.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("ALL OK -> _deploy_p5/nudgeEngineGhl1.json")
