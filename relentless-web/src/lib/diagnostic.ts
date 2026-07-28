// SMB Growth Diagnostic — questions, scoring, and the diagnosis engine.
// Deterministic + self-contained (no external AI key): for a fixed 9-question set, a scored
// per-area diagnosis is effectively the "personalized AI diagnosis" the funnel promises. A
// Claude-enhanced narrative can be layered on later via an n8n webhook without changing this shape.

export type Choice = "A" | "B" | "C" | "D";
export type Area =
  | "pricing" | "leadflow" | "sales" | "retention" | "marketing"
  | "operations" | "finance" | "team" | "focus";

export type Option = { key: Choice; label: string; score: 0 | 1 | 2 | 3 };
export type Question = { id: number; area: Area; eyebrow: string; question: string; options: Option[] };

export const QUESTIONS: Question[] = [
  {
    id: 1, area: "pricing", eyebrow: "Pricing",
    question: "When a potential client says your price is too high, what do you do?",
    options: [
      { key: "A", label: "Hold firm — my price reflects the value I deliver", score: 3 },
      { key: "B", label: "Explain the value but sometimes negotiate", score: 2 },
      { key: "C", label: "Usually discount to win the business", score: 1 },
      { key: "D", label: "I don't know what to say so I just lower the price", score: 0 },
    ],
  },
  {
    id: 2, area: "leadflow", eyebrow: "Lead Flow",
    question: "Where do most of your new customers come from?",
    options: [
      { key: "A", label: "A predictable system I control (ads, referrals, outbound)", score: 3 },
      { key: "B", label: "Mostly referrals, plus a bit of marketing", score: 2 },
      { key: "C", label: "Word of mouth I can't really control", score: 1 },
      { key: "D", label: "It's inconsistent — I'm never sure", score: 0 },
    ],
  },
  {
    id: 3, area: "sales", eyebrow: "Sales & Follow-up",
    question: "When a qualified lead goes quiet, what happens?",
    options: [
      { key: "A", label: "A systematic follow-up sequence kicks in automatically", score: 3 },
      { key: "B", label: "I follow up a few times, manually", score: 2 },
      { key: "C", label: "I follow up once and move on", score: 1 },
      { key: "D", label: "They slip through the cracks", score: 0 },
    ],
  },
  {
    id: 4, area: "retention", eyebrow: "Retention",
    question: "Do you know why customers leave?",
    options: [
      { key: "A", label: "Yes — I track churn and act on it", score: 3 },
      { key: "B", label: "I have a rough idea", score: 2 },
      { key: "C", label: "Not really", score: 1 },
      { key: "D", label: "They just stop and I don't know why", score: 0 },
    ],
  },
  {
    id: 5, area: "marketing", eyebrow: "Visibility",
    question: "How consistently do you show up in front of your market?",
    options: [
      { key: "A", label: "A consistent system runs whether I feel like it or not", score: 3 },
      { key: "B", label: "When I have time", score: 2 },
      { key: "C", label: "Rarely", score: 1 },
      { key: "D", label: "Basically never", score: 0 },
    ],
  },
  {
    id: 6, area: "operations", eyebrow: "Operations",
    question: "How much of your week goes to high-leverage work vs. firefighting?",
    options: [
      { key: "A", label: "Mostly high-leverage — I work ON the business", score: 3 },
      { key: "B", label: "A balance of both", score: 2 },
      { key: "C", label: "Mostly in the weeds", score: 1 },
      { key: "D", label: "I'm the bottleneck for almost everything", score: 0 },
    ],
  },
  {
    id: 7, area: "finance", eyebrow: "Finance",
    question: "Do you know your numbers — margin, runway, cost to acquire a customer?",
    options: [
      { key: "A", label: "Yes — I review them every week", score: 3 },
      { key: "B", label: "Roughly, about once a month", score: 2 },
      { key: "C", label: "Only vaguely", score: 1 },
      { key: "D", label: "Not really", score: 0 },
    ],
  },
  {
    id: 8, area: "team", eyebrow: "Team & Delegation",
    question: "If you took a full week off, what would happen?",
    options: [
      { key: "A", label: "It runs without me", score: 3 },
      { key: "B", label: "Mostly fine, a few things wait", score: 2 },
      { key: "C", label: "It struggles", score: 1 },
      { key: "D", label: "It basically stops", score: 0 },
    ],
  },
  {
    id: 9, area: "focus", eyebrow: "Focus & Strategy",
    question: "How clear is your single most important priority this quarter?",
    options: [
      { key: "A", label: "Crystal clear — everyone knows it", score: 3 },
      { key: "B", label: "I know it, the team is fuzzy", score: 2 },
      { key: "C", label: "It shifts a lot", score: 1 },
      { key: "D", label: "I'm reacting day to day", score: 0 },
    ],
  },
];

export const MAX_SCORE = QUESTIONS.length * 3; // 27

type AreaDiag = { title: string; why: string; fixes: [string, string, string]; relentless: string };

const AREA_DIAGNOSIS: Record<Area, AreaDiag> = {
  pricing: {
    title: "You're leaving money on the table at the point of sale",
    why: "Discounting under pressure trains your market to expect it and quietly caps your margin — the fastest profit leak there is.",
    fixes: ["Set a floor price you will not cross and script the value response", "Lead with outcomes and ROI, not features, before any number is said", "Offer a smaller scope instead of a lower price when pushed"],
    relentless: "Relentless coaches the pricing conversation in your morning briefing and flags every deal where margin is at risk.",
  },
  leadflow: {
    title: "Your pipeline depends on luck, not a system",
    why: "If you can't name where the next 10 customers come from, growth is a coin flip — and you can't scale a coin flip.",
    fixes: ["Pick ONE channel and make it predictable before adding a second", "Track leads-in per week as a number you watch", "Turn happy customers into a repeatable referral ask"],
    relentless: "Relentless surfaces new leads and a daily lead-flow number so you always know if the top of the funnel is healthy.",
  },
  sales: {
    title: "Qualified leads are slipping through the cracks",
    why: "Most deals are lost to silence, not to 'no'. Inconsistent follow-up is the single most common revenue leak in a small business.",
    fixes: ["Build a 5-touch follow-up sequence that fires automatically", "Never end a conversation without a scheduled next step", "Review every 'gone quiet' lead weekly and re-engage"],
    relentless: "Relentless flags stalled deals and who's gone quiet in your morning briefing — before they go cold.",
  },
  retention: {
    title: "You're filling a leaky bucket",
    why: "Winning new customers while quietly losing old ones is the most expensive way to stand still. You can't fix churn you don't measure.",
    fixes: ["Ask every churned customer one question: why did you leave?", "Define your 'healthy customer' signal and watch it", "Build one proactive check-in before renewal/repeat points"],
    relentless: "Relentless tracks retention signals and prompts the check-ins that keep customers from drifting.",
  },
  marketing: {
    title: "You disappear the moment you get busy",
    why: "Visibility that depends on free time always loses to the work. Inconsistent presence means your market forgets you exactly when you need them.",
    fixes: ["Commit to ONE format and ONE cadence you can sustain", "Batch a week of content in a single block", "Make showing up a calendar commitment, not a mood"],
    relentless: "Relentless keeps your visibility cadence on track with nudges so it runs even on your busiest weeks.",
  },
  operations: {
    title: "You ARE the bottleneck",
    why: "When everything routes through you, the business can only grow as far as your hours — and you burn out before it does.",
    fixes: ["List the 3 tasks only you can do; delegate or automate the rest", "Document one repeatable process this week", "Protect a daily block for ON-the-business work"],
    relentless: "Relentless calibrates your day to your real capacity and protects the high-leverage block from the firefight.",
  },
  finance: {
    title: "You're flying without instruments",
    why: "Not knowing your margin, runway, and cost-to-acquire means every decision is a guess. The numbers you avoid are usually the ones costing you most.",
    fixes: ["Pick 3 numbers (margin, runway, CAC) and review them weekly", "Know your break-even before your next big spend", "Separate the vanity metrics from the ones that pay rent"],
    relentless: "Relentless puts your key numbers in front of you in the weekly business check-in so nothing hides.",
  },
  team: {
    title: "The business can't run without you",
    why: "If a week away would break it, you don't own a business — you own a demanding job. That ceiling caps both growth and your freedom.",
    fixes: ["Identify the single most dangerous dependency on you", "Hand off one recurring decision with a clear rulebook", "Build a 'what to do if I'm out' one-pager"],
    relentless: "Relentless helps you spot where you're the single point of failure and coach the delegation.",
  },
  focus: {
    title: "You're busy, but not aimed",
    why: "Reacting day to day feels productive but scatters your effort. Without one clear priority, even hard work doesn't compound.",
    fixes: ["Name the ONE outcome that matters most this quarter", "Kill or defer everything that doesn't serve it", "Make it the first thing in every morning briefing"],
    relentless: "Relentless front-loads your single highest-leverage priority every morning so you stop reacting and start aiming.",
  },
};

export type DiagnosisResult = {
  totalScore: number;
  maxScore: number;
  band: { key: "stuck" | "leaking" | "scaling"; label: string; summary: string };
  primary: { area: Area } & AreaDiag;
  secondary: ({ area: Area } & AreaDiag) | null;
  areaScores: { area: Area; eyebrow: string; score: number }[];
};

// answers: map of questionId -> chosen Choice
export function diagnose(answers: Record<number, Choice>): DiagnosisResult {
  const areaScores: { area: Area; eyebrow: string; score: number }[] = [];
  let total = 0;
  for (const q of QUESTIONS) {
    const choice = answers[q.id];
    const opt = q.options.find((o) => o.key === choice);
    const s = opt ? opt.score : 0;
    total += s;
    areaScores.push({ area: q.area, eyebrow: q.eyebrow, score: s });
  }

  // Weakest areas drive the diagnosis (lowest score first; tie-break by question order).
  const ranked = [...areaScores].sort((a, b) => a.score - b.score);
  const primaryArea = ranked[0].area;
  const secondaryArea = ranked[1] && ranked[1].score <= 1 ? ranked[1].area : null;

  const pct = total / MAX_SCORE;
  const band =
    pct < 0.45
      ? { key: "stuck" as const, label: "Stuck", summary: "Several core systems are leaking at once — but that also means the fastest wins are right in front of you." }
      : pct < 0.75
      ? { key: "leaking" as const, label: "Leaking", summary: "The foundation is there, but a couple of specific leaks are quietly capping your growth." }
      : { key: "scaling" as const, label: "Scaling-ready", summary: "You're running a tight ship — the opportunity now is leverage and compounding, not patching holes." };

  return {
    totalScore: total,
    maxScore: MAX_SCORE,
    band,
    primary: { area: primaryArea, ...AREA_DIAGNOSIS[primaryArea] },
    secondary: secondaryArea ? { area: secondaryArea, ...AREA_DIAGNOSIS[secondaryArea] } : null,
    areaScores,
  };
}
