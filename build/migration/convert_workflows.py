#!/usr/bin/env python3
"""convert_workflows.py — convert the remaining Airtable nodes to Supabase.

Generalises the approach proven on the Inbound Router (convert_inbound_router.py)
to the other 12 workflows: 34 nodes, 10 distinct tables.

Usage:
    python convert_workflows.py <workflow.json> [<workflow.json> ...]

Writes <name>_supabase.json next to each input and prints a per-node report.
Exits non-zero if ANY node could not be converted confidently — a partial
conversion that silently leaves an Airtable node behind would fail at runtime
with the same 429 the migration exists to escape, so it is treated as failure.

Design (docs/superpowers/specs/2026-07-29-airtable-to-supabase-migration-design.md §5):
  type   n8n-nodes-base.airtable -> n8n-nodes-base.supabase (typeVersion 1)
  target base+table              -> tableId
  read   filterByFormula string  -> filters.conditions[] (eq only)
  write  columns.value           -> fieldsUi.fieldValues[]

Two rules the mechanical part cannot cover:

1. Filters with OR or date arithmetic have no equivalent in the Supabase node's
   filter UI. Those nodes are pointed at a view that already encodes the
   predicate (see 001/004) and do a plain getAll. TABLE_MAP encodes that choice
   per node, so it is explicit and reviewable rather than inferred.

2. Airtable updates rows by opaque recXXX ids; Supabase matches on a natural key.
   Any update/upsert must therefore declare its matching column.
"""
import json, re, sys, os

SUPA_CRED = {"supabaseApi": {"id": "gSbZ6Y52r8jgE7xQ", "name": "Supabase - Relentless AI"}}

# Airtable table name/id -> Supabase table for WRITES.
# The three opaque ids are resolved from how the nodes actually filter them:
#   tblGi8Xf5kPBCWDDv filters {active}=1        -> the client roster
#   tblh0BMyGi0uVObAE filters {client_id}=...   -> biometrics
#   tblhCNFTPM9NevFuz filters {committed_action}='' -> war room sessions
WRITE_TABLE = {
    "tbl_client_profile": "client_profile",
    "tblGi8Xf5kPBCWDDv": "client_profile",
    "tbl_pending_replies": "pending_replies",
    "tbl_biometrics": "biometrics",
    "tblh0BMyGi0uVObAE": "biometrics",
    "tbl_daily_scores": "daily_scores",
    "tbl_nudges": "nudges",
    "tbl_business_health": "business_health",
    "tbl_dead_letter": "dead_letter",
    "tbl_market_signals": "market_signals",
    "tbl_war_room_sessions": "war_room_sessions",
    "tblhCNFTPM9NevFuz": "war_room_sessions",
    "tbl_inbound_seen": "inbound_seen",
}

# Reads resolve to a view when the client roster is involved (v_clients flattens
# the profiles/client_profile join) or when the filter needs one.
READ_TABLE = dict(WRITE_TABLE)
READ_TABLE.update({
    "tbl_client_profile": "v_clients",
    "tblGi8Xf5kPBCWDDv": "v_clients",
})

# Per-node overrides, keyed (workflow_id, node_name).
#   view   — read this instead, with no filter; the view encodes the predicate
#   match  — natural key for update/upsert
#   eq     — build a simple equality filter from this column + expression
NODE_RULES = {
    # Filters using DATETIME_DIFF / OR — must read a view.
    ("eodPro00001ghl", "fetchTodayNudges"): {"view": "v_nudges_recent_18h", "eq_client": True},
    ("stageTrans01ghl", "fetchScores"): {"view": "v_daily_scores_last_7d", "eq_client": True},
    ("slaMonitor1", "searchMorning"): {"view": "v_recent_morning_checkins"},
    ("briefFallback1", "loadOpenMorning"): {"view": "v_open_pending_replies"},
    ("warRoom0001", "loadSession"): {"view": "v_open_war_room"},
    # The inbound matcher: OR(phone, ghl_contact_id) with phone-format tolerance.
    # v_clients_match exposes every recognisable key as match_key, so the node
    # filters on one column with a plain eq. The expression prefers contactId
    # (exact) and falls back to digits-only phone, which is the format-agnostic
    # key — the same weakness that once misidentified a Pro client as non-Pro.
    ("warRoom0001", "loadProfile"): {
        "view": "v_clients_match",
        "raw_filter": [{
            "keyName": "match_key",
            "condition": "eq",
            "keyValue": (
                "={{ $('Webhook').first().json.body.contactId "
                "|| ($('Webhook').first().json.body.From || '')"
                ".replace('whatsapp:','').replace(/\\D/g,'') }}"
            ),
        }],
    },
    # Updates/upserts need a natural key instead of Airtable's recXXX id.
    ("warRoom0001", "upsertSession"): {"match": "session_id"},
    ("briefFallback1", "expireRow"): {"match": "pending_id", "rekey_from": "rowId"},
    # client_profile's primary key is client_id — there is no `id` column, so
    # these two would fail at runtime if left matching on Airtable's row id.
    ("onboard00001ghl", "advanceDay"): {"match": "client_id", "rekey_from": "rid"},
    # ghl_contact_id lives in profiles, not client_profile: 001 deliberately kept
    # identity in one place rather than duplicating it. Contact Repair therefore
    # writes to profiles, keyed by client_id (unique, per 001's index).
    ("contactRepair1", "patchRow"): {
        "match": "client_id", "rekey_from": "rowId", "table": "profiles",
    },
}

# Code nodes that carry an Airtable record id forward to an update node. Same
# re-keying the Inbound Router needed: the row id becomes the natural key.
# (workflow_id, code_node_name) -> (old_js, new_js)
CODE_REKEY = {
    ("briefFallback1", "prepInput"): (
        "rowId:($json.id||'')",
        "rowId:($json.pending_id||$json.id||'')",
    ),
    # client_profile/profiles are keyed by client_id, so the row id these two
    # carried is replaced at source rather than translated at the update node.
    ("contactRepair1", "parseResult"): (
        "var rowId = row.id;",
        "var rowId = (row.client_id || row.id);",
    ),
    ("onboard00001ghl", "decide"): (
        "var rid = $json.id || '';",
        "var rid = $json.client_id || $json.id || '';",
    ),
}

# Client-roster reads: every one filters {active}=1, which maps to a plain eq.
ACTIVE_FILTER = [{"keyName": "active", "condition": "eq", "keyValue": "true"}]


def airtable_nodes(nodes):
    return [n for n in nodes if "airtable" in n.get("type", "").lower()]


def tbl_key(node):
    t = node.get("parameters", {}).get("table", {})
    tv = t.get("value") if isinstance(t, dict) else t
    m = re.search(r"tbl[_A-Za-z0-9]+", str(tv))
    return m.group(0) if m else None


def simple_eq(formula):
    """Extract a single {col}='<expr>' equality, or None if not that simple.

    Deliberately conservative: anything with AND/OR/DATETIME must go through a
    view, and returning None here is what routes it to the unconverted list
    rather than silently dropping the predicate. Better to refuse and report than
    to emit a node whose filter quietly means something different.

    The formulas are Airtable string concatenation, e.g.
        {{ "{client_id}='" + $('x').item.json.client_id + "'" }}
    so the value expression is whatever sits between the two concatenations. It
    can itself contain quotes, parens and `||` fallbacks:
        ($('a').item.json.fields || $('a').item.json).client_id
        ($('Webhook').first().json.body.client_id || 'client_test')
    Splitting on `+` at paren-depth zero handles those without trying to parse JS.
    """
    if not formula or re.search(r"DATETIME|IS_AFTER|IS_BEFORE|TODAY|OR\(|AND\(", formula):
        return None

    body = formula.strip()
    body = re.sub(r"^=?\{\{\s*", "", body)
    body = re.sub(r"\s*\}\}$", "", body)

    # Count Airtable field refs — {col} — in the formula body, NOT raw braces:
    # the surrounding n8n {{ }} contributes braces of its own. More than one
    # field ref means a compound predicate, which belongs in a view.
    fields = re.findall(r"\{(\w+)\}", body)
    if len(fields) != 1:
        return None
    col = fields[0]
    if not re.search(r"\{" + col + r"\}\s*=", body):
        return None

    # Split on '+' only at depth 0, so parens/brackets in the expression survive.
    parts, depth, cur = [], 0, ""
    for ch in body:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "+" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    parts = [p.strip() for p in parts if p.strip()]

    # A literal with no concatenation: "{col}='value'"
    if len(parts) == 1:
        lit = re.search(r"\{" + col + r"\}\s*=\s*'([^']*)'", parts[0])
        return [{"keyName": col, "condition": "eq", "keyValue": lit.group(1)}] if lit else None

    # Otherwise the middle segments are the value expression; the first and last
    # are the quoting fragments Airtable needed and Supabase does not.
    expr = " + ".join(parts[1:-1]).strip() if len(parts) > 2 else parts[1].strip()
    if not expr:
        return None
    return [{"keyName": col, "condition": "eq", "keyValue": "={{ " + expr + " }}"}]


def to_supabase(node, wf_id, report):
    name = node.get("name", "")
    params = node.get("parameters", {})
    op = params.get("operation", "")
    key = tbl_key(node)
    rule = NODE_RULES.get((wf_id, name), {})

    if op in ("create", "upsert", "update"):
        table = rule.get("table") or WRITE_TABLE.get(key)
    else:
        table = rule.get("view") or READ_TABLE.get(key)

    if not table:
        report.append((name, op, "UNMAPPED TABLE " + str(key), False))
        return None

    if op == "search":
        p = {"operation": "getAll", "tableId": table, "returnAll": True}
        conds = None
        if rule.get("raw_filter"):
            # Filter the rule states verbatim, for predicates no parser should
            # try to derive from the Airtable formula.
            conds = rule["raw_filter"]
        elif rule.get("view"):
            # The view carries the hard predicate; keep the per-client narrowing.
            if rule.get("eq_client"):
                conds = simple_eq(params.get("filterByFormula", ""))
        else:
            f = params.get("filterByFormula", "")
            if "{active}=1" in f.replace(" ", ""):
                conds = ACTIVE_FILTER
            else:
                conds = simple_eq(f)
                if f and conds is None:
                    report.append((name, op, "COMPLEX FILTER needs a view: " + f[:70], False))
                    return None
        if conds:
            p["filters"] = {"conditions": conds}
        note = "-> " + table + (" (view)" if table.startswith("v_") else "")

    elif op == "create":
        vals = (params.get("columns", {}) or {}).get("value", {})
        p = {
            "operation": "create",
            "tableId": table,
            "fieldsUi": {"fieldValues": [{"fieldId": k, "fieldValue": v} for k, v in vals.items()]},
        }
        note = "-> " + table + " (" + str(len(vals)) + " cols)"

    elif op in ("update", "upsert"):
        cols = params.get("columns", {}) or {}
        vals = dict(cols.get("value", {}))
        match = rule.get("match") or (cols.get("matchingColumns") or [None])[0]
        # The node matched on Airtable's `id`; the natural key now carries the
        # value that the upstream code node was patched to supply.
        # The node matched on Airtable's `id`; swap that for the natural key.
        # `match_value` lets a rule name the expression explicitly when the old
        # id expression cannot simply be relabelled (e.g. the upstream code node
        # carries client_id alongside the row id).
        rekey = rule.get("rekey_from")
        if rekey and match not in vals and "id" in vals:
            old_expr = vals.pop("id")
            # Default: keep the same upstream field, now carrying the natural key
            # because the code node feeding it was patched (see CODE_REKEY).
            # A rule may override when the value must come from a different field.
            vals[match] = rule.get("match_value", old_expr)
        if not match or match not in vals:
            report.append((name, op, "NO NATURAL KEY (had recXXX id)", False))
            return None
        p = {
            "operation": "update",
            "tableId": table,
            "filterType": "manual",
            "matchingColumns": [match],
            "filters": {"conditions": [{"keyName": match, "condition": "eq", "keyValue": vals[match]}]},
            "fieldsUi": {
                "fieldValues": [{"fieldId": k, "fieldValue": v} for k, v in vals.items() if k != match]
            },
        }
        note = "-> " + table + " (match " + match + ")"

    else:
        report.append((name, op, "UNSUPPORTED OP", False))
        return None

    out = {
        "name": name,
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "parameters": p,
        "credentials": SUPA_CRED,
    }
    for k in ("position", "id", "onError", "alwaysOutputData", "retryOnFail", "maxTries",
              "waitBetweenTries", "notesInFlow", "notes"):
        if k in node:
            out[k] = node[k]
    report.append((name, op, note, True))
    return out


def convert(path):
    wf = json.load(open(path, encoding="utf-8"))
    wf_id = wf.get("id") or os.path.basename(path).split(".")[0].replace("_supabase", "")
    nodes = wf["nodes"]
    report, failed = [], 0

    for i, n in enumerate(nodes):
        ntype = n.get("type", "").lower()
        name = n.get("name", "")

        if "code" in ntype and (wf_id, name) in CODE_REKEY:
            old, new = CODE_REKEY[(wf_id, name)]
            js = n.get("parameters", {}).get("jsCode", "")
            if old.replace(" ", "") in js.replace(" ", ""):
                # Match ignoring whitespace, but splice using the literal found.
                pat = re.escape(old).replace(r"\ ", r"\s*")
                js2, cnt = re.subn(pat, new.replace("\\", "\\\\"), js)
                if cnt:
                    n["parameters"]["jsCode"] = js2
                    report.append((name, "code", "re-keyed -> " + new.split(":")[0], True))
            else:
                report.append((name, "code", "REKEY PATTERN NOT FOUND", False))
                failed += 1
            continue

        if "airtable" not in ntype:
            continue
        conv = to_supabase(n, wf_id, report)
        if conv:
            nodes[i] = conv
        else:
            failed += 1

    print("[" + wf_id + "] " + str(len(report)) + " Airtable node(s)")
    for name, op, note, ok in report:
        print("   " + ("OK " if ok else "!! ") + name.ljust(20) + op.ljust(8) + note)

    remaining = airtable_nodes(nodes)
    if remaining:
        print("   !! " + str(len(remaining)) + " node(s) left on Airtable — NOT written")
        return False

    out = path.replace(".json", "_supabase.json")
    json.dump(wf, open(out, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("   wrote " + out)
    return failed == 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: convert_workflows.py <workflow.json> [...]")
    results = [convert(p) for p in sys.argv[1:]]
    print()
    print(str(sum(results)) + "/" + str(len(results)) + " workflows fully converted")
    sys.exit(0 if all(results) else 1)
