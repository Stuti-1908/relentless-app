#!/usr/bin/env python3
"""convert_inbound_router.py — convert ghlInboundV1's 9 Airtable nodes to Supabase.

The GHL Inbound Router handles every inbound client SMS reply. It is the highest-impact
workflow still on Airtable, and while Airtable's billing quota is exhausted every reply
a client sends is silently dropped (the workflow dies at the first Airtable node).

Reads  : <workflow>.json exported from n8n
Writes : <workflow>_supabase.json

Conversion rules (per docs/superpowers/specs/2026-07-29-airtable-to-supabase-migration-design.md §5):
  type      n8n-nodes-base.airtable -> n8n-nodes-base.supabase (typeVersion 1)
  target    base+table              -> tableId
  read      filterByFormula string  -> filters.conditions [{keyName,condition,keyValue}]
  write     columns.value           -> fieldsUi.fieldValues [{fieldId,fieldValue}]

Two things are deliberately NOT mechanical:

1. Record identity. Airtable updates rows by opaque recXXX ids. The three close*
   nodes therefore re-key onto `pending_id`, the natural business key, which carries a
   unique constraint for exactly this purpose. The `dispatch` code node is patched to
   carry pending_id through instead of the Airtable row id.

2. Filters the Supabase node cannot express. loadPending's
   AND(status='open', OR(expires_at='', expires_at > NOW())) and loadWarRoom's
   committed_action='' both need an OR, which the node's filter UI lacks. These read
   from the views v_open_pending_replies / v_open_war_room instead and do a plain getAll.
"""
import json, os, sys, shutil

SUPA_CRED = {"supabaseApi": {"id": "gSbZ6Y52r8jgE7xQ", "name": "Supabase - Relentless AI"}}


def supa(name, params, *, on_error=None, always_output=False, position=None, node_id=None):
    """Build a Supabase node matching the pattern already proven in morningCheckin1."""
    n = {
        "name": name,
        "type": "n8n-nodes-base.supabase",
        "typeVersion": 1,
        "parameters": params,
        "credentials": SUPA_CRED,
    }
    if position is not None:
        n["position"] = position
    if node_id is not None:
        n["id"] = node_id
    if always_output:
        n["alwaysOutputData"] = True
    if on_error:
        n["onError"] = on_error
    return n


def get_all(table, conditions=None, return_all=True):
    p = {"operation": "getAll", "tableId": table, "returnAll": return_all}
    if conditions:
        p["filters"] = {"conditions": conditions}
    return p


def create(table, fields):
    return {
        "operation": "create",
        "tableId": table,
        "fieldsUi": {"fieldValues": [{"fieldId": k, "fieldValue": v} for k, v in fields.items()]},
    }


def update(table, match_key, match_value, fields):
    return {
        "operation": "update",
        "tableId": table,
        "filterType": "manual",
        "matchingColumns": [match_key],
        "filters": {"conditions": [{"keyName": match_key, "condition": "eq", "keyValue": match_value}]},
        "fieldsUi": {"fieldValues": [{"fieldId": k, "fieldValue": v} for k, v in fields.items()]},
    }


# The close* nodes all write the same three columns; only the source expression differs.
def close_fields(src):
    return {
        "status": "matched",
        "matched_reply": f"={{{{ {src}.matched_reply }}}}",
        "inbound_msg_id": f"={{{{ {src}.messageId }}}}",
    }


# name -> builder. Mirrors the 9 Airtable nodes one-for-one.
BUILDERS = {
    # Idempotency guard. Exact-match read, so a plain eq filter is enough.
    "searchSeen": lambda: get_all(
        "inbound_seen",
        [{"keyName": "message_sid", "condition": "eq", "keyValue": "={{ $json.messageId }}"}],
        return_all=False,
    ),
    "createSeen": lambda: create(
        "inbound_seen",
        {"message_sid": "={{ $json.messageId }}", "received_at": "={{ $now.toISO() }}", "kind": "ghl_inbound"},
    ),
    # v_clients resolves identity (profiles + client_profile) into one flat row.
    "loadProfile": lambda: get_all(
        "v_clients",
        [{"keyName": "ghl_contact_id", "condition": "eq",
          "keyValue": "={{ $('parseInbound').first().json.contactId }}"}],
        return_all=False,
    ),
    # View absorbs the OR on expires_at. Also the safety net for the 45 stale open
    # rows left by the outage: all are past expiry, so the view excludes them and
    # no catch-up SMS can fire at a real client.
    "loadPending": lambda: get_all("v_open_pending_replies"),
    # View absorbs committed_action IS NULL OR = ''.
    "loadWarRoom": lambda: get_all("v_open_war_room"),
    # Re-keyed from Airtable recXXX to the natural key pending_id.
    "closePending": lambda: update(
        "pending_replies", "pending_id", "={{ $json.pendingRowId }}", close_fields("$json")
    ),
    "closeMorning": lambda: update(
        "pending_replies", "pending_id", "={{ $('dispatch').first().json.pendingRowId }}",
        close_fields("$('dispatch').first().json"),
    ),
    "closeWeekly": lambda: update(
        "pending_replies", "pending_id", "={{ $('dispatch').first().json.pendingRowId }}",
        close_fields("$('dispatch').first().json"),
    ),
    "writeBiometrics": lambda: create(
        "biometrics",
        {
            "client_id": "={{ $('dispatch').first().json.client_id }}",
            "date": "={{ $now.toFormat('yyyy-MM-dd') }}",
            "source": "manual",
            "manual_sleep_input": "={{ $('dispatch').first().json.sleep }}",
            "manual_energy_input": "={{ $('dispatch').first().json.energy }}",
            "manual_stress_input": "={{ $('dispatch').first().json.stress }}",
        },
    ),
}


def patch_dispatch(js):
    """Re-key the dispatch node from Airtable's row id to Supabase's pending_id.

    dispatch builds candidate rows with `_id: (it.json && it.json.id) || ''` and later
    sets pendingRowId from that. Against Supabase, `id` is a uuid while the close* nodes
    now match on pending_id, so _id must carry pending_id instead.

    Falls back to id then '' so the node stays safe if a row somehow lacks pending_id.
    """
    old = "_id: (it.json&&it.json.id)||''"
    new = "_id: (it.json&&(it.json.pending_id||it.json.id))||''"
    if old in js:
        return js.replace(old, new), True
    # tolerate whitespace variations rather than silently doing nothing
    compact = old.replace(" ", "")
    for line in js.split("\n"):
        if compact in line.replace(" ", ""):
            return js.replace(line.strip(), new), True
    return js, False


def convert(path):
    with open(path, encoding="utf-8") as f:
        wf = json.load(f)

    nodes = wf["nodes"] if isinstance(wf, dict) and "nodes" in wf else wf
    converted, patched_dispatch, unknown = [], False, []

    for i, n in enumerate(nodes):
        ntype = n.get("type", "")
        name = n.get("name", "")

        if "airtable" in ntype.lower():
            if name not in BUILDERS:
                unknown.append(name)
                continue
            nodes[i] = supa(
                name,
                BUILDERS[name](),
                on_error=n.get("onError"),
                always_output=n.get("alwaysOutputData", False),
                position=n.get("position"),
                node_id=n.get("id"),
            )
            converted.append(name)

        elif "code" in ntype.lower() and name == "dispatch":
            js = n.get("parameters", {}).get("jsCode", "")
            js2, ok = patch_dispatch(js)
            if ok:
                n["parameters"]["jsCode"] = js2
                patched_dispatch = True

    if unknown:
        print(f"  !! UNRECOGNISED Airtable nodes (left untouched): {unknown}", file=sys.stderr)

    out = path.replace(".json", "_supabase.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)

    print(f"  converted {len(converted)}/9 Airtable nodes: {', '.join(converted)}")
    print(f"  dispatch re-keyed to pending_id: {'yes' if patched_dispatch else 'NO — CHECK MANUALLY'}")
    print(f"  wrote {out}")
    return len(converted) == 9 and patched_dispatch and not unknown


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: convert_inbound_router.py <ghlInboundV1.json>")
    ok = convert(sys.argv[1])
    sys.exit(0 if ok else 1)
