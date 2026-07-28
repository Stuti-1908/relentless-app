// intensityCalibration.js — acute energy -> task-intensity calibration for the Morning Briefing.
//
// Product intent: if the client's energy/recovery is LOW, the briefing should recommend only light,
// low-pressure tasks (and defer high-stakes work); if it's HIGH, recommend the hardest, highest-leverage
// work. Recovery (0-100) is the base signal (works for wearables + manual mode, where recovery is
// derived from sleep/energy/stress). The day's self-reported ENERGY (1-5) is a strong override so a
// low-energy report always pulls intensity down, and a strong-energy report can lift a decent day.
//
// Pairs with biometricAdaptation.js: that handles CHRONIC multi-day low-recovery streaks (takes
// precedence when active); this handles the SINGLE-DAY acute level.

function _toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// recovery: number 0-100 (defaults to 60 neutral). energy: 1-5 or null.
function computeIntensity(recovery, energy) {
  const rec = Number.isFinite(Number(recovery)) ? Number(recovery) : 60;
  const en = _toNum(energy);

  const names = ['low', 'moderate', 'high'];
  // Recovery band.
  const rb = rec >= 70 ? 2 : (rec >= 45 ? 1 : 0);
  // Energy band (when reported). energy>=4 -> high, 3 -> moderate, <=2 -> low.
  const eb = en === null ? rb : (en >= 4 ? 2 : (en >= 3 ? 1 : 0));

  // Conservative blend: a low-energy report pulls the day DOWN (the core ask).
  let idx = Math.min(rb, eb);
  // ...but strong energy on an at-least-moderate recovery day can lift it to high.
  if (eb === 2 && rb >= 1) idx = 2;

  const band = names[idx];

  const notes = {
    high:
      'TASK CALIBRATION - HIGH ENERGY DAY: Capacity is strong today. Front-load the single most ' +
      'demanding, highest-leverage priority into a focused morning deep-work block. Encourage tackling ' +
      'the hard or previously-avoided work now while capacity is high. Being ambitious today is right.',
    moderate:
      'TASK CALIBRATION - STEADY DAY: Normal capacity. Recommend 2-3 priorities at a sustainable pace ' +
      'and protect one focused block. Do not overload the day or pile on high-stakes work.',
    low:
      'TASK CALIBRATION - LOW ENERGY DAY: Capacity is limited today. Recommend only ONE light keystone ' +
      'priority plus low-cognitive admin or maintenance tasks. Explicitly DEFER high-stakes, demanding, ' +
      'or high-pressure work to a higher-energy day. Use a supportive, no-pressure tone and protect rest.',
  };

  const labels = { high: 'High energy', moderate: 'Steady', low: 'Low energy' };

  return {
    band,                 // 'low' | 'moderate' | 'high'
    label: labels[band],
    recovery_used: rec,
    energy_used: en,
    note: notes[band],
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeIntensity };
}
