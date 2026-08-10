#!/usr/bin/env python3
"""_fix_sla_delivery_hour.py -- patch slaMonitor1's evaluate node.

Bug: the SLA monitor hardcodes the morning-send due window as local hour 8-9,
which assumes every client is briefed at 06:00. Any client with a non-default
delivery_hour (client_test currently had 23, a leftover from migration
verification) gets flagged "missing" every single day forever, because the
monitor checks 2 hours after a 6 AM send that never happens for that client.

Fix: read delivery_hour from the client row (defaulting to 6, matching
morningCheckin1's own fallback) and compute the due window as
[delivery_hour+2, delivery_hour+3] instead of the hardcoded [8,9].

Run from the build/n8n directory:
    python _fix_sla_delivery_hour.py <path to exported slaMonitor1.json>
Writes <name>_fixed.json next to it.
"""
import json, sys

OLD = "  var ld = localParts(tz); var localHour = ld.getHours();\n  var due = localHour >= 8 && localHour <= 9; // >=2h past local 06:00 -> the morning send window has passed"

NEW = """  var ld = localParts(tz); var localHour = ld.getHours();
  // Respect the client's own delivery_hour instead of assuming everyone is
  // briefed at 06:00. Falls back to 6 to match morningCheckin1's own default
  // for clients who have not set one. Window is +2/+3h past their send, same
  // margin as before, just anchored to their actual time instead of 8-9.
  var dh = (c.delivery_hour != null && c.delivery_hour !== '') ? Number(c.delivery_hour) : 6;
  if (!(dh >= 0 && dh <= 23)) dh = 6;
  var due = localHour >= (dh + 2) && localHour <= (dh + 3);"""


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: _fix_sla_delivery_hour.py <slaMonitor1.json>")
    path = sys.argv[1]
    wf = json.load(open(path, encoding="utf-8"))
    nodes = wf["nodes"] if "nodes" in wf else wf

    found = False
    for n in nodes:
        if n.get("name") != "evaluate":
            continue
        js = n["parameters"]["jsCode"]
        if OLD not in js:
            print("!! exact OLD block not found -- node may already be patched or has drifted")
            print("   first 400 chars of jsCode for manual comparison:")
            print("   " + js[:400].replace("\n", "\n   "))
            sys.exit(1)
        n["parameters"]["jsCode"] = js.replace(OLD, NEW)
        found = True
        print("OK patched 'evaluate' node: due window now delivery_hour-aware")

    if not found:
        sys.exit("!! no node named 'evaluate' found")

    out = path.replace(".json", "_fixed.json")
    json.dump(wf, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("wrote", out)


if __name__ == "__main__":
    main()
