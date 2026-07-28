#!/usr/bin/env python3
"""
_build_eod_pro.py — produce _eod_pro.json from _eod_focus_real.json.
Adds the Pro 6-pillar path to the EoD score:
  - new fetchBusinessHealth Airtable node (tolerant; table referenced by name expression)
  - computeScore patched to compute Capital/Risk + compositePro when plan='pro',
    else the unchanged 4-pillar compositeStandard.
Validated offline by _sim_eod_pro.js. Import the output, then reactivate.
"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "_eod_focus_real.json")
OUT = os.path.join(BASE, "_eod_pro.json")

NEW_COMPUTE = r"""function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }
function roundHalfUp(x){ return Math.round(x); }
var BODY_BANDS = [[85,100,90,100],[70,84,75,89],[50,69,50,74],[0,49,0,49]];
function bodyScore(recovery, hasData){
  if(!hasData || recovery==null) return 60;
  var r = clamp(recovery,0,100);
  for(var i=0;i<BODY_BANDS.length;i++){ var rl=BODY_BANDS[i][0],rh=BODY_BANDS[i][1],bl=BODY_BANDS[i][2],bh=BODY_BANDS[i][3];
    if(r>=rl && r<=rh){ var span=(rh-rl)||1; return roundHalfUp(bl+((r-rl)/span)*(bh-bl)); } }
  return 60;
}
function focusScore(o){ o=o||{}; var ns=o.nudges_sent||0,nr=o.nudges_responded||0,ft=o.focus_blocks_total||0,fp=o.focus_blocks_protected||0;
  var nrr = ns>0 ? clamp(nr/ns,0,1) : 0.70;
  var fbp = ft>0 ? clamp(fp/ft,0,1) : 0.70;
  return roundHalfUp(nrr*50 + fbp*50);
}
function alignmentScore(interruptions){ return roundHalfUp(clamp(100-5*Math.max(0,interruptions||0),0,100)); }
// ---- Capital/Risk (Pro) inlined from harness/scoring/scoring.js (51 tests) ----
var CAPITAL_DELTA = { on_track:{launching:10,growing:15,operating:15}, tight:{launching:5,growing:0,operating:0}, critical:{launching:-10,growing:-20,operating:-25} };
function capitalScore(base, cashPosition, stage){ var b=(base==null)?70:base; var d=(CAPITAL_DELTA[cashPosition]&&CAPITAL_DELTA[cashPosition][stage])||0; return roundHalfUp(clamp(b+d,0,100)); }
function riskScore(o){ o=o||{}; var sev=clamp(o.severity||0,0,100); var unman=100-clamp(o.manageability==null?100:o.manageability,0,100); var wS,wU;
  if(o.stage==='launching'&&o.deliberate==='deliberate'){wS=0.3;wU=0.7;} else if(o.stage==='launching'&&o.deliberate==='unexpected'){wS=0.7;wU=0.3;} else {wS=0.5;wU=0.5;}
  return roundHalfUp(clamp(100-(sev*wS+unman*wU),0,100)); }
function compositeStandard(o){ return roundHalfUp(o.body*0.25+o.focus*0.25+o.execution*0.30+o.alignment*0.20); }
function compositePro(o){ return roundHalfUp(o.body*0.20+o.focus*0.20+o.execution*0.25+o.alignment*0.15+o.capital*0.15+o.risk*0.10); }
function scoreLabel(c){ if(c>=90)return 'Peak'; if(c>=75)return 'Strong'; if(c>=60)return 'Steady'; if(c>=45)return 'Below Par'; return 'Recovery Day'; }

// ---- Execution from GHL tasks (inlined; 13 unit tests) ----
function _norm(s){ return String(s==null?'':s).toLowerCase().trim().replace(/\s+/g,' '); }
function _titleMatches(tt,pr){ var a=_norm(tt),b=_norm(pr); if(!a||!b)return false; if(a===b)return true; if(a.length>=4&&b.length>=4&&(a.indexOf(b)>=0||b.indexOf(a)>=0))return true; return false; }
function _isCompleted(t){ var c=t&&t.completed; return c===true||c==='true'; }
function executionFromGhlTasks(tasks, tops){
  var list=Array.isArray(tasks)?tasks.filter(Boolean):[];
  var priorities=(Array.isArray(tops)?tops:[]).map(function(p){return String(p==null?'':p);}).filter(function(p){return _norm(p)!=='';}).slice(0,3);
  var completed=list.filter(_isCompleted); var completedCount=completed.length;
  var used={}; var matchedP=[];
  for(var k=0;k<priorities.length;k++){ for(var i=0;i<completed.length;i++){ if(used[i])continue; if(_titleMatches(completed[i].title,priorities[k])){ used[i]=true; matchedP.push(priorities[k]); break; } } }
  var matched=matchedP.length; var usedCount=Object.keys(used).length; var extra=completedCount-usedCount; var extraBonus=clamp(extra*5,0,10);
  var base=clamp(matched,0,3)*33.3; var score=roundHalfUp(clamp(base+extraBonus,0,100));
  return { matched:matched, extra:extra, extraBonus:extraBonus, completedCount:completedCount, totalTasks:list.length, execution_score:score, hasData:list.length>0, matchedPriorities:matchedP };
}

// ---- read profile + latest biometrics ----
const pr = $('Search records').first().json;
const p = pr.fields ? pr.fields : pr;
const plan = String(p.plan || 'standard').toLowerCase();
const isPro = plan === 'pro';
const bioItems = $('getBiometrics').all().map(it => (it.json && it.json.fields) ? it.json.fields : (it.json || {}));
let latest = null;
for (const b of bioItems) { if (b && b.recovery_score != null && b.recovery_score !== '') { if (!latest || String(b.date||'') > String(latest.date||'')) latest = b; } }
const hasBio = !!latest;
const recovery = hasBio ? Number(latest.recovery_score) : null;

// ---- tasks from GHL ----
let ghlTasks = [];
try { const tr = $('fetchGhlTasks').first().json; ghlTasks = Array.isArray(tr.tasks) ? tr.tasks : (Array.isArray(tr) ? tr : []); } catch (e) { ghlTasks = []; }
const tops = [p.top_priority_1, p.top_priority_2, p.top_priority_3];
const ex = executionFromGhlTasks(ghlTasks, tops);

// ---- nudges (Focus) ----
let _nudgeRows = [];
try { _nudgeRows = $('fetchTodayNudges').all().map(it => (it.json && it.json.fields) ? it.json.fields : (it.json || {})).filter(n => n && n.timestamp); } catch (e) { _nudgeRows = []; }
const nudges_sent = _nudgeRows.length;
const nudges_responded = _nudgeRows.filter(n => n.responded === true || n.responded === 'true').length;

// ---- business health (Pro only; tolerant — neutral 70 when no row) ----
let bh = null;
if (isPro) {
  try {
    const bhRows = $('fetchBusinessHealth').all().map(it => (it.json && it.json.fields) ? it.json.fields : (it.json || {})).filter(x => x && (x.cash_position || x.severity != null || x.manageability != null));
    if (bhRows.length) { bh = bhRows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]; }
  } catch (e) { bh = null; }
}

const body = bodyScore(recovery, hasBio);
const focus = focusScore({ nudges_sent: nudges_sent, nudges_responded: nudges_responded, focus_blocks_total: 0, focus_blocks_protected: 0 });
const execution = ex.hasData ? ex.execution_score : 70;
const alignment = alignmentScore(0);

let capital = null, risk = null, composite, label;
if (isPro) {
  capital = (bh && bh.cash_position) ? capitalScore(bh.capital_base != null ? Number(bh.capital_base) : null, String(bh.cash_position), String(bh.stage || p.business_stage || 'growing')) : 70;
  risk = (bh && (bh.severity != null || bh.manageability != null)) ? riskScore({ severity: Number(bh.severity||0), manageability: bh.manageability != null ? Number(bh.manageability) : 100, stage: String(bh.stage || p.business_stage || 'growing'), deliberate: bh.deliberate || null }) : 70;
  composite = compositePro({ body: body, focus: focus, execution: execution, alignment: alignment, capital: capital, risk: risk });
} else {
  composite = compositeStandard({ body: body, focus: focus, execution: execution, alignment: alignment });
}
label = scoreLabel(composite);

const toNumber = String(p.phone_number || '').replace('whatsapp:', '');
let reply = 'Executive Score today: ' + composite + '/100 (' + label + '). Body ' + body + ', Focus ' + focus + ', Execution ' + execution + ', Alignment ' + alignment;
if (isPro) { reply += ', Capital ' + capital + ', Risk ' + risk; }
reply += '.';

return [{ json: {
  toNumber: toNumber, reply: reply, client_id: (p.client_id || 'client_test'), plan: plan,
  body_score: body, focus_score: focus, execution_score: execution, alignment_score: alignment,
  capital_score: capital, risk_score: risk,
  composite_score: composite, score_label: label, biometric_missing: !hasBio, recovery_used: recovery,
  nudges_sent: nudges_sent, nudges_responded: nudges_responded,
  execution_matched: ex.matched, execution_extra: ex.extra, execution_completed: ex.completedCount, execution_hasData: ex.hasData,
  business_health_used: !!bh, pillars: (isPro ? 6 : 4)
}}];"""

FETCH_BH_NODE = {
    "id": "fetch-bh-001",
    "name": "fetchBusinessHealth",
    "type": "n8n-nodes-base.airtable",
    "typeVersion": 2.2,
    "position": [200, 620],
    "alwaysOutputData": True,
    "onError": "continueRegularOutput",
    "credentials": {"airtableTokenApi": {"id": "Z1DGfO9LPHXmAo4W", "name": "Airtable Goecoach Personal Access Token account"}},
    "parameters": {
        "operation": "search",
        "base": {"__rl": True, "value": "appjnWxg9sB3PV7Da", "mode": "list", "cachedResultName": "Relentless AI - client_test"},
        "table": {"__rl": True, "value": "={{ 'tbl_business_health' }}", "mode": "id", "cachedResultName": "tbl_business_health"},
        "filterByFormula": "={{ \"{client_id}='\" + ($('Search records').first().json.fields ? $('Search records').first().json.fields.client_id : 'client_test') + \"'\" }}",
        "returnAll": False,
        "limit": 1,
        "sort": {"property": [{"field": "date", "direction": "desc"}]},
        "options": {}
    }
}

def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    wf = data if isinstance(data, dict) else data[0]

    # 1. patch computeScore
    patched = False
    for n in wf["nodes"]:
        if n.get("name") == "computeScore":
            n["parameters"]["jsCode"] = NEW_COMPUTE
            patched = True
    assert patched, "computeScore node not found"

    # 2. add fetchBusinessHealth node (idempotent)
    if not any(n.get("name") == "fetchBusinessHealth" for n in wf["nodes"]):
        wf["nodes"].append(FETCH_BH_NODE)

    # 3. wire fetchTodayNudges -> fetchBusinessHealth -> computeScore
    conns = wf["connections"]
    # find what currently feeds computeScore: it's fetchTodayNudges per the chain
    if "fetchTodayNudges" in conns:
        conns["fetchTodayNudges"]["main"] = [[{"node": "fetchBusinessHealth", "type": "main", "index": 0}]]
    conns["fetchBusinessHealth"] = {"main": [[{"node": "computeScore", "type": "main", "index": 0}]]}

    # 4. set id + name + active false
    wf["id"] = "eodPro00001"
    wf["name"] = "Relentless AI - End-of-Day Score PRO (test)"
    wf["active"] = False

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(wf, f, indent=2)
    print("Wrote", OUT)
    print("Nodes:", [n["name"] for n in wf["nodes"]])

if __name__ == "__main__":
    main()
