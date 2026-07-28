// SYNCED from the DEPLOYED briefing (briefing_intensity.json) on 2026-06-13.
// This mirrors the live n8n buildBriefing node, incl. the inlined intensityCalibration (TASK CALIBRATION).
// Source-of-truth modules: build/harness/scoring/{biometricAdaptation,intensityCalibration}.js — KEEP IN SYNC.

// Profile from "Search records"; biometrics rows from this node's input (tbl_biometrics search, last 7 days).
const pr = $('Search records').first().json;
const p = pr.fields ? pr.fields : pr;

// The biometrics search returns up to 7 recent rows; normalize to field-objects.
const bioItems = $input.all().map(it => (it.json && it.json.fields) ? it.json.fields : (it.json || {}));

// Pick the most recent by date for today's recovery.
let latest = null;
for (const b of bioItems) {
  if (b && b.recovery_score != null && b.recovery_score !== '') {
    if (!latest || String(b.date || '') > String(latest.date || '')) latest = b;
  }
}
let recovery = 60; // neutral fallback when no biometric on file
if (latest) recovery = Number(latest.recovery_score);

// ---- Phase 5 Biometric Adaptation (inlined from harness/scoring/biometricAdaptation.js; 12 unit tests) ----
function _toNum(v){ if(v===undefined||v===null||v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function _avgOf(rows,key,window){ const vals=[]; for(const r of rows){ if(vals.length>=window) break; const n=_toNum(r[key]); if(n!==null) vals.push(n);} if(!vals.length) return null; const s=vals.reduce((a,b)=>a+b,0); return Math.round((s/vals.length)*10)/10; }
function computeAdaptation(rawRows, opts){
  opts = opts || {};
  const window = opts.window || 7;
  const streakDays = opts.streakDays || 3;
  const threshold = opts.threshold != null ? opts.threshold : 60;
  const rows = (Array.isArray(rawRows)?rawRows:[]).filter(Boolean).slice()
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  const avg7_recovery=_avgOf(rows,'recovery_score',window);
  const avg7_sleep=_avgOf(rows,'sleep_score',window);
  const avg7_hrv=_avgOf(rows,'hrv_score',window);
  let lowRecoveryStreak=0;
  for(const r of rows){ const rec=_toNum(r.recovery_score); if(rec===null) break; if(rec<threshold) lowRecoveryStreak+=1; else break; }
  const adaptationActive = lowRecoveryStreak>=streakDays;
  let note='';
  if(adaptationActive){
    const avgTxt = avg7_recovery!=null?avg7_recovery:'low';
    note='ADAPTATION (multi-day trend): Recovery has been below '+threshold+' for '+lowRecoveryStreak+
      ' consecutive days (7-day avg recovery '+avgTxt+'/100). Apply a supportive, recovery-first tone. '+
      'Deprioritize cognitive-heavy and high-intensity work, protect rest, and have them commit to ONE '+
      'keystone priority only. Do not add performance pressure or penalize a low day in your language.';
  }
  return { avg7_recovery, avg7_sleep, avg7_hrv, lowRecoveryStreak, adaptationActive, daysConsidered: rows.length, note };
}
const adapt = computeAdaptation(bioItems);

// energy (manual 1-5) drives acute task-intensity calibration.
const energy = latest ? _toNum(latest.manual_energy_input) : null;
// ---- Acute energy -> task-intensity calibration (intensityCalibration.js, 11 tests) ----
function computeIntensity(recovery, energy){
  const rec = Number.isFinite(Number(recovery)) ? Number(recovery) : 60;
  const en = _toNum(energy);
  const names = ['low','moderate','high'];
  const rb = rec >= 70 ? 2 : (rec >= 45 ? 1 : 0);
  const eb = en === null ? rb : (en >= 4 ? 2 : (en >= 3 ? 1 : 0));
  let idx = Math.min(rb, eb);
  if (eb === 2 && rb >= 1) idx = 2;
  const band = names[idx];
  const notes = {
    high: 'TASK CALIBRATION - HIGH ENERGY DAY: Capacity is strong today. Front-load the single most demanding, highest-leverage priority into a focused morning deep-work block. Encourage tackling the hard or previously-avoided work now while capacity is high. Being ambitious today is right.',
    moderate: 'TASK CALIBRATION - STEADY DAY: Normal capacity. Recommend 2-3 priorities at a sustainable pace and protect one focused block. Do not overload the day or pile on high-stakes work.',
    low: 'TASK CALIBRATION - LOW ENERGY DAY: Capacity is limited today. Recommend only ONE light keystone priority plus low-cognitive admin or maintenance tasks. Explicitly DEFER high-stakes, demanding, or high-pressure work to a higher-energy day. Use a supportive, no-pressure tone and protect rest.',
  };
  return { band, note: notes[band], energy_used: en };
}
const intensity = computeIntensity(recovery, energy);


const stageBlocks = {
  launching: 'You coach a founder building their first customers. Prioritize momentum and customer learning. Capital constraints are normal. High deliberate risk is appropriate.',
  growing: 'You coach a leader scaling an existing business. Prioritize leverage, team performance, capital efficiency.',
  operating: 'You coach an executive optimizing an established business. Prioritize discipline and delegation.',
};

const system = [
  'STAGE CONTEXT: ' + (stageBlocks[p.business_stage] || stageBlocks.growing),
  p.twelve_month_goal ? '12-MONTH GOAL: ' + p.twelve_month_goal + '. Connect recommendations to this goal.' : '',
  'USER CONTEXT: Client ' + (p.full_name || 'Client') + '. Recovery ' + recovery + '/100' + (energy != null ? (', energy ' + energy + '/5') : '') + '.',
  adapt.adaptationActive ? adapt.note : intensity.note,
  'PRIORITIES: ' + [p.top_priority_1, p.top_priority_2, p.top_priority_3].filter(Boolean).join('; '),
  'OUTPUT RULES: Write ONE plain-text SMS under 280 characters. No emojis or special symbols. Rank the top 3 priorities for today. Warm, sharp, executive tone. No greeting fluff.',
].filter(Boolean).join('\n');

const body = { model: 'claude-sonnet-4-6', max_tokens: 300, system: system, messages: [{ role: 'user', content: 'Generate my morning briefing.' }] };
return [{ json: {
  body,
  phone: p.phone_number,
  full_name: p.full_name,
  recovery_used: recovery,
  energy_used: energy,
  intensity_band: intensity.band,
  recovery_date: latest ? latest.date : null,
  avg7_recovery: adapt.avg7_recovery,
  avg7_sleep: adapt.avg7_sleep,
  avg7_hrv: adapt.avg7_hrv,
  low_recovery_streak: adapt.lowRecoveryStreak,
  adaptation_active: adapt.adaptationActive,
  biometric_days_considered: adapt.daysConsidered
} }];
