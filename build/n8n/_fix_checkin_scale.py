# P4 (2026-07-06): morning check-in must explain the 1-5 scale (user request).
# Scoring semantics (build/harness/scoring/morningMood.js): sleep/energy higher=better,
# stress higher=worse. Patch on top of _deploy_p3/morningCheckin1.json (= live P3 version):
# 1. decide: prompt instructs Claude to always include a one-line scale key; maxChars 220->300.
# 2. extract: sanitize cap 220->300; fallback message includes the scale key.
import json, pathlib

HERE = pathlib.Path(__file__).parent
DST = HERE / "_deploy_p4"
DST.mkdir(exist_ok=True)
wf = json.load(open(HERE / "_deploy_p3" / "morningCheckin1.json", encoding="utf-8"))

EDITS = {
    "decide": [
        ('"reply 3 numbers 1-5: sleep energy stress, like 4 3 2". Warm and human, not a form.',
         '"reply 3 numbers 1-5: sleep energy stress, like 4 3 2". ALWAYS include a one-line scale key '
         'so the numbers are unambiguous: for sleep and energy 5 is best and 1 is worst; for stress 5 '
         'means very stressed and 1 means calm. Example key: "(sleep/energy: 5=great. stress: 5=maxed out)". '
         'Warm and human, not a form.'),
        ("maxChars:220", "maxChars:300"),
    ],
    "extract": [
        ("sanitizeSms(ct,220)", "sanitizeSms(ct,300)"),
        ("reply='Morning! Before I build your plan, reply 3 numbers 1-5: sleep energy stress (e.g. 4 3 2).'",
         "reply='Morning! Before I build your plan, reply 3 numbers 1-5: sleep energy stress (e.g. 4 3 2). "
         "Scale: sleep/energy 5=great, 1=rough. Stress 5=maxed out, 1=calm.'"),
    ],
}

for n in wf["nodes"]:
    if n["name"] in EDITS:
        code = n["parameters"]["jsCode"]
        for old, new in EDITS[n["name"]]:
            assert code.count(old) == 1, f"{n['name']}: expected 1x {old[:60]!r}, found {code.count(old)}"
            code = code.replace(old, new)
        n["parameters"]["jsCode"] = code
        print(f"patched node: {n['name']}")

s = json.dumps(wf, indent=2, ensure_ascii=False)
assert "5 is best and 1 is worst" in s and "sanitizeSms(ct,300)" in s
assert "$('IsSend').all(); const __OUT" in s  # leak fix retained
assert "$('extract').item.json.client_id" in s  # P3 pending-row fix retained
open(DST / "morningCheckin1.json", "w", encoding="utf-8").write(s)
print("ALL OK -> _deploy_p4/morningCheckin1.json")
