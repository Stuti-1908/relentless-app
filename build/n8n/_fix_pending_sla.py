# P3 fixes (2026-07-05), patched on top of LIVE export _LIVE_p3_source.json:
# 1. morningCheckin1 + briefBuilder1 openConversation: $json.client_id/$json.ghl_contact_id read
#    sendGHL's API response (empty) -> pending rows had client_id=None. Point at $('extract').item.
# 2. eodPro00001ghl openConversation: $('computeScore').first() = always client #1 -> .item.
# 3. slaMonitor1 evaluate: alert window localHour 8-9 only (max 2 alerts/morning, not hourly).
import json, pathlib

HERE = pathlib.Path(__file__).parent
DST = HERE / "_deploy_p3"
DST.mkdir(exist_ok=True)
rows = {r["id"]: r for r in json.load(open(HERE / "_LIVE_p3_source.json", encoding="utf-8"))}

def patch(wid, edits, markers):
    r = rows[wid]
    nodes_s = r["nodes"]
    for old, new, count in edits:
        assert nodes_s.count(old) == count, f"{wid}: expected {count}x {old!r}, found {nodes_s.count(old)}"
        nodes_s = nodes_s.replace(old, new)
    for m in markers:
        assert m in nodes_s, f"{wid}: marker missing post-patch: {m!r}"
    nodes = json.loads(nodes_s)  # must still be valid JSON
    out = {"id": wid, "name": r["name"], "nodes": nodes, "connections": json.loads(r["connections"])}
    json.dump(out, open(DST / f"{wid}.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"{wid}: patched -> _deploy_p3/{wid}.json")

# NB: nodes_s is a JSON string, so expressions appear with escaped quotes: \" -> stays plain ' here
for wid in ["morningCheckin1", "briefBuilder1"]:
    patch(wid,
        edits=[
            ("{{ $json.client_id }}", "{{ $('extract').item.json.client_id }}", 1),
            ("{{ $json.ghl_contact_id }}", "{{ $('extract').item.json.ghl_contact_id }}", 1),
        ],
        markers=["$('extract').item.json.client_id", "$('extract').item.json.ghl_contact_id"])

patch("eodPro00001ghl",
    edits=[
        ("$('computeScore').first().json.client_id", "$('computeScore').item.json.client_id", 1),
        ("$('computeScore').first().json.ghl_contact_id", "$('computeScore').item.json.ghl_contact_id", 1),
    ],
    markers=["$('computeScore').item.json.client_id"])

patch("slaMonitor1",
    edits=[
        ("var due = localHour >= 8;", "var due = localHour >= 8 && localHour <= 9;", 1),
    ],
    markers=["localHour >= 8 && localHour <= 9"])

print("ALL OK")
