# Fix P0 cross-client leak (2026-07-06): extract paired Claude outputs (filtered by IsSend)
# with UNFILTERED $('decide').all() -> index misalignment sent client A's text to client B.
# Fix: pair with $('IsSend').all() (true-branch output, same order as callClaude input).
import json, pathlib

SRC = pathlib.Path(__file__).parent / "_deploy_p1"
DST = pathlib.Path(__file__).parent / "_deploy_p2"
DST.mkdir(exist_ok=True)

OLD = "const __C = $input.all(); const __D = $('decide').all(); const __OUT = [];"
NEW = "const __C = $input.all(); const __D = $('IsSend').all(); const __OUT = [];"
OLD_COMMENT_KEY = "pair Claude response i with decide item i"

for name in ["morningCheckin1", "weekly000001ghl", "onboard00001ghl"]:
    wf = json.load(open(SRC / f"{name}.json", encoding="utf-8"))
    hit = 0
    for n in wf["nodes"]:
        code = n.get("parameters", {}).get("jsCode")
        if code and OLD in code:
            code = code.replace(OLD, NEW)
            lines = code.splitlines()
            if OLD_COMMENT_KEY in lines[0]:
                lines[0] = "// [leak-fix 2026-07-05: pair Claude response i with IsSend true-branch item i (filtered, same order as callClaude)]"
            n["parameters"]["jsCode"] = "\n".join(lines)
            hit += 1
    assert hit == 1, f"{name}: expected 1 extract patch, got {hit}"
    json.dump(wf, open(DST / f"{name}.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"{name}: patched extract, wrote _deploy_p2/{name}.json")

# assert fix marker present, old pattern gone
for name in ["morningCheckin1", "weekly000001ghl", "onboard00001ghl"]:
    s = open(DST / f"{name}.json", encoding="utf-8").read()
    assert "$('IsSend').all(); const __OUT" in s and OLD not in s
print("ALL OK")
