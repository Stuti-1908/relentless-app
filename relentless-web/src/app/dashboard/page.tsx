"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Prio = "high" | "med" | "low";
type RepeatRule = "none" | "daily" | "weekly" | "monthly";
type Task = {
  id: string; title: string; prio: Prio; meta: string; dueDate: string | null; done: boolean; ghl: string | null;
  repeatRule: RepeatRule; repeatDays: number[]; remindAt: string | null;
};
type Meeting = { id: string; title: string; time: string | null; scheduledAt: string | null };

type MeetingRow = { id: string; title: string; meet_time: string | null; scheduled_at?: string | null };
const rowToMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  title: r.title,
  time: r.meet_time,
  scheduledAt: r.scheduled_at ?? null,
});

function todayISODate(): string {
  return localISODate(new Date());
}

function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateLabel(date: string | null): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return date;
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function taskMetaLabel(priorityMeta: string, dueDate: string | null): string {
  if (!dueDate) return priorityMeta || "No date";
  return `Due ${dateLabel(dueDate)}`;
}

function makeScheduledAt(date: string, hhmm: string): string | null {
  if (!date || !hhmm) return null;
  const d = new Date(`${date}T${hhmm}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtTime(hhmm: string | null): string {
  if (!hhmm) return "No time";
  if (hhmm.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(hhmm)) {
    const d = new Date(hhmm);
    if (isNaN(d.getTime())) return hhmm;
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const [h, m] = hhmm.split(":");
  const H = Number(h) % 12 || 12;
  return `${H}:${m} ${Number(h) < 12 ? "AM" : "PM"}`;
}

function fmtMeeting(m: Meeting): string {
  const raw = m.scheduledAt || m.time;
  if (!raw) return "No time";
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && (raw.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(raw))) {
    return `${dateLabel(localISODate(d))} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return fmtTime(raw);
}

type ExtendedBriefing = {
  text: string | null;
  priorities: string[];
  deliveredAt?: string | null;
  date: string | null;
  sections?: {
    recovery?: { summary: string; content: string };
    news?: { summary: string; content: string };
    calendar?: { summary: string; meetings: { title: string; time: string }[] };
    crm?: { summary: string; content: string };
  };
};

type Coaching = {
  configured?: boolean;
  reason?: string;
  plan?: string;
  score?: {
    composite: number | null;
    label: string | null;
    body: number | null;
    focus: number | null;
    execution: number | null;
    alignment: number | null;
    capital: number | null;
    risk: number | null;
    priorities_completed: number | null;
    date: string | null;
  };
  biometrics?: { recovery: number | null; hrv: number | null; sleep: number | null; source?: string | null; date: string | null };
  briefing?: ExtendedBriefing | null;
  briefings?: ExtendedBriefing[];
  trend?: TrendDay[];
  activity?: { title: string; detail?: string; at: string | null; kind: string }[];
  profile?: { name: string | null; stage: string | null; avoidance: string | null; goal: string | null };
  health?: {
    cash: string | null; team: string | null; biggestRisk: string | null;
    avoidedDecision: string | null; analysis: string | null;
    capital: number | null; risk: number | null; weekStart: string | null;
  } | null;
  marketSignal?: { text: string | null; source: string | null; date: string | null } | null;
  marketSignals?: { text: string | null; source: string | null; date: string | null }[];
  weeklyDeltas?: Record<string, { current: number | null; previous: number | null; change: number | null }>;
  monthly?: {
    monthYear: string | null; score: number | null; baseScore: number | null;
    trendBonus: number | null; consistencyBonus: number | null; pillarBonus: number | null;
    bodyAvg: number | null; focusAvg: number | null; executionAvg: number | null; alignmentAvg: number | null;
    capitalAvg: number | null; riskAvg: number | null; peakDays: number | null; recoveryDays: number | null;
    priorityCompletionRate: number | null; bestDay: string | null; worstDay: string | null;
  } | null;
};

type TrendDay = {
  date: string | null; composite: number | null; label?: string | null;
  body?: number | null; focus?: number | null; execution?: number | null;
  alignment?: number | null; capital?: number | null; risk?: number | null;
};

type TaskRow = {
  id: string; title: string; priority: Prio; meta: string; due_date?: string | null; done: boolean; ghl_task_id?: string | null;
  repeat_rule?: string | null; repeat_days?: number[] | null; remind_at?: string | null;
};
const rowToTask = (r: TaskRow): Task => ({
  id: r.id, title: r.title, prio: r.priority, meta: r.meta, dueDate: r.due_date ?? null, done: r.done, ghl: r.ghl_task_id ?? null,
  repeatRule: (r.repeat_rule as RepeatRule) ?? "none",
  repeatDays: Array.isArray(r.repeat_days) ? r.repeat_days : [],
  remindAt: r.remind_at ? String(r.remind_at).slice(0, 5) : null,
});

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A task is "relevant today" if it's due today, or it's a recurring task scheduled to fire today
// (daily = always; weekly/monthly = only on their matching day). Not-today recurring tasks (e.g. a
// weekly "every Monday" task on a Tuesday) sort with the dated tasks instead of pinning to the top.
function isRelevantToday(t: Task, todayISO: string, dow: number, dom: number): boolean {
  if (t.repeatRule === "none") return t.dueDate === todayISO;
  if (t.repeatRule === "daily") return true;
  if (t.repeatRule === "weekly") return (t.repeatDays || []).includes(dow);
  if (t.repeatRule === "monthly") return (t.repeatDays || []).includes(dom);
  return false;
}

// ── Per-occurrence completion for recurring tasks ──────────────────────────────
// A recurring task shouldn't be "done forever" when you check it off — it should stay
// done for the CURRENT occurrence, then come back on the next one. We store the completed
// occurrence's date in the task's `meta` field as "DONE:<yyyy-mm-dd>" (meta is display-only
// for recurring tasks and read by no backend workflow), and compare it to the current
// occurrence's date at render time. No cron/reset job needed — it self-resets by date.

// The date that identifies the occurrence active RIGHT NOW: for daily that's today; for
// weekly/monthly it's the most recent matching weekday / day-of-month on or before today.
// Checking off "every Monday" on Monday keeps it done until next Monday; "15th" until next 15th.
function currentOccurrenceDate(t: Task, now: Date): string | null {
  if (t.repeatRule === "daily") return localISODate(now);
  const days = t.repeatDays || [];
  if (!days.length) return null;
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let back = 0; back < 366; back++) {
    const d = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - back);
    const match =
      t.repeatRule === "weekly" ? days.includes(d.getDay())
      : t.repeatRule === "monthly" ? days.includes(d.getDate())
      : false;
    if (match) return localISODate(d);
  }
  return null;
}

const DONE_MARK = "DONE:";
// True only if this recurring task was completed for the occurrence that is active right now.
function isRecurringDoneNow(t: Task, now: Date): boolean {
  if (t.repeatRule === "none") return t.done;
  if (!t.meta || !t.meta.startsWith(DONE_MARK)) return false;
  const markedDate = t.meta.slice(DONE_MARK.length);
  return markedDate === currentOccurrenceDate(t, now);
}
// Effective done-state used everywhere in the UI (non-recurring = raw flag; recurring = per-occurrence).
function effectiveDone(t: Task, now: Date): boolean {
  return t.repeatRule === "none" ? t.done : isRecurringDoneNow(t, now);
}

// Chronological sort key for date-first ordering. Returns a string that sorts correctly:
//  "0"          -> daily recurring tasks (pinned above everything)
//  "1:<date>"   -> dated tasks (and weekly/monthly tasks due today), in true calendar order
//  "2"          -> undated / recurring-not-today tasks (sort to the very bottom)
// Everything in the same date then breaks ties by priority (handled by the comparator).
function taskSortKey(t: Task, todayISO: string, dow: number, dom: number): string {
  if (t.repeatRule === "daily") return "0";
  if (t.repeatRule === "none") return t.dueDate ? `1:${t.dueDate}` : "2";
  return isRelevantToday(t, todayISO, dow, dom) ? `1:${todayISO}` : "2";
}
function repeatLabel(t: Task): string | null {
  if (t.repeatRule === "none") return null;
  const time = t.remindAt ? ` · ${fmtTime(t.remindAt)}` : "";
  if (t.repeatRule === "daily") return `Every day${time}`;
  if (t.repeatRule === "weekly") {
    const days = (t.repeatDays || []).map((d) => DOW_LABELS[d]).join(" ");
    return `Every ${days || "week"}${time}`;
  }
  if (t.repeatRule === "monthly") {
    const days = (t.repeatDays || []).join(", ");
    return `Monthly (day ${days || "?"})${time}`;
  }
  return null;
}

async function syncTaskToGhl(body: {
  op: "create" | "complete" | "delete";
  title?: string;
  dueDate?: string | null;
  ghlTaskId?: string | null;
  completed?: boolean;
}): Promise<string | null> {
  try {
    const res = await fetch("/api/tasks-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.ghlTaskId ?? null;
  } catch {
    return null;
  }
}

function scoreBand(n: number): "green" | "gold" | "amber" {
  if (n >= 80) return "green";
  if (n >= 60) return "gold";
  return "amber";
}

function whenLabel(at: string | null): string {
  if (!at) return "";
  const d = new Date(at.length <= 10 ? `${at}T00:00:00` : at);
  if (isNaN(d.getTime())) return at;
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  const time = at.length > 10
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  const day = dayDiff === 0 ? "Today" : dayDiff === 1 ? "Yesterday"
    : dayDiff > 1 && dayDiff < 7 ? `${dayDiff} days ago`
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return time ? `${day} · ${time}` : day;
}

const STAGE_FOCUS: Record<string, string> = {
  launching: "Coaching focus: finding product-market fit and protecting runway. Move fast, but make deliberate bets.",
  growing: "Coaching focus: leverage and team performance. Watch for becoming the bottleneck in your own delivery.",
  operating: "Coaching focus: durable systems and margin. Delegate execution; spend your hours on the highest-leverage decisions.",
};
const STAGE_LABEL: Record<string, string> = { launching: "LAUNCHING", growing: "GROWING", operating: "OPERATING" };

// Recurring executive tasks auto-added once per week (idempotent via a week marker in `meta`).
const RECURRING_TASKS: { title: string; prio: Prio }[] = [
  { title: "Review last week's numbers — revenue, pipeline, cash", prio: "high" },
  { title: "Work the pipeline — re-engage stalled deals & leads gone quiet", prio: "high" },
  { title: "Set your top 3 priorities for the week", prio: "high" },
  { title: "1:1 check-ins with your key people", prio: "med" },
  { title: "Block protected deep-work time on the calendar", prio: "med" },
];

// ISO week key like "2026-W25" — the marker that makes weekly seeding idempotent.
function isoWeekKey(d = new Date()): string {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const showNum = (n: number | null | undefined): string => (n == null ? "—" : String(n));
const ACT_ICON: Record<string, string> = { briefing: "📨", score: "📊", nudge: "🔔", biometric: "❤️", feedback: "💬" };

const PILLAR_INFO: Record<string, { title: string; body: string }> = {
  composite: { title: "Executive Score", body: "Your overall daily performance — a weighted blend of Body, Focus, Execution and Alignment. It's the single number your evening text reports." },
  body: { title: "Body", body: "Physical readiness from your recovery, sleep and HRV. High Body = a good day to take on hard, high-stakes work." },
  focus: { title: "Focus", body: "How well you protected deep work — driven by nudge responses and protected focus blocks. Replying to nudges and guarding meeting-free time lifts this." },
  execution: { title: "Execution", body: "Whether you actually did your top priorities — computed from your completed GoHighLevel tasks vs. what you set out to do." },
  alignment: { title: "Alignment", body: "How well your day matched your stated priorities and 12-month goal — staying on the work that moves the needle." },
};

const TOUR_STEPS = [
  { key: "score", title: "Score & readiness", body: "Start here. This shows yesterday's performance score, today's recovery, completed tasks, and the live coaching status.", target: "tour-score" },
  { key: "briefing", title: "Morning briefing", body: "This is the daily executive briefing. It pulls together priorities, recovery, calendar, and business context.", target: "tour-briefing" },
  { key: "todos", title: "To-do list", body: "Add work here, choose a due date, change priority, and check items off as they get done.", target: "tour-todos" },
  { key: "meetings", title: "Meetings", body: "Add the meeting title, date, and time. The SMS workflow reminds the user 5 minutes before it starts.", target: "tour-meetings" },
  { key: "profile", title: "Profile", body: "Use this sidebar button to update phone, timezone, role, and goals so reminders stay accurate.", target: "tour-profile" },
  { key: "connections", title: "Connections", body: "Use this sidebar button to connect calendar and other sources for richer briefings.", target: "tour-connections" },
];

type Toast = { id: number; text: string };

// ── Inline SVG icon components ──────────────────────────────────────────────
function IconGrid() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}
function IconAudit() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <polyline points="9.5 12 11 13.5 14.5 10" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  );
}

function DeltaBadge({ change }: { change: number | null | undefined }) {
  if (change == null || change === 0) return null;
  const isPos = change > 0;
  const color = isPos ? "#10b981" : "#ef4444";
  return (
    <span style={{
      marginLeft: 6,
      fontSize: 10,
      padding: "1px 4px",
      borderRadius: 4,
      background: isPos ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
      color: color,
      border: `1px solid ${isPos ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
      fontWeight: 600
    }}>
      {isPos ? "↑" : "↓"}{Math.abs(change)}%
    </span>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [newTaskDate, setNewTaskDate] = useState(todayISODate());
  const [newTaskPrio, setNewTaskPrio] = useState<Prio>("med");
  const [newRepeat, setNewRepeat] = useState<RepeatRule>("none");

  // Payment gate: dashboard is normally only reached via /onboarding (which
  // already checks payment_verified), but a stale bookmark/back-button could
  // land here directly for an unpaid user — belt-and-suspenders check.
  // See build/migration/009_payment_gate.sql and api/payment/confirm/route.ts
  // for the known redirect-trust gap this column carries.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles").select("payment_verified,onboarded,client_id").eq("id", user.id).maybeSingle();
      if (cancelled || !data) return;
      if (!data.payment_verified) router.replace("/payment");
      else if (!data.onboarded) router.replace("/onboarding");
      // Self-heal: onboarding's one-shot provision can fail, leaving a paid client with no
      // coaching record (no messages ever). Retry on every dashboard visit until it sticks.
      else if (!data.client_id) {
        const r = await fetch("/api/provision", { method: "POST" }).catch(() => null);
        if (r?.ok && !cancelled) router.refresh();
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, router]);
  const [newRepeatDays, setNewRepeatDays] = useState<number[]>([]);
  const [newRemindAt, setNewRemindAt] = useState("09:00");
  // Inline recurrence editor (click a task's 🔁 schedule to edit)
  const [editRecurId, setEditRecurId] = useState<string | null>(null);
  const [editRepeat, setEditRepeat] = useState<RepeatRule>("none");
  const [editRepeatDays, setEditRepeatDays] = useState<number[]>([]);
  const [editRemindAt, setEditRemindAt] = useState("09:00");
  const [newMeet, setNewMeet] = useState("");
  const [newMeetDate, setNewMeetDate] = useState(todayISODate());
  const [newMeetTime, setNewMeetTime] = useState("");
  const [tourStep, setTourStep] = useState(0);
  const [showTour, setShowTour] = useState(false);
  const [tourCardPos, setTourCardPos] = useState<{ top: number; left: number } | null>(null);
  const [dictNote, setDictNote] = useState(
    '🎙️ Tap the mic and speak — e.g. "call the bank, finish the deck, email Sam" → each phrase becomes a task.'
  );
  const [recording, setRecording] = useState(false);
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(true);
  const [coachingAt, setCoachingAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prioPickerId, setPrioPickerId] = useState<string | null>(null);
  const [datePickerId, setDatePickerId] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [editText, setEditText] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedDay, setSelectedDay] = useState<TrendDay | null>(null);
  const [pillarKey, setPillarKey] = useState<string | null>(null);
  const [expandedAct, setExpandedAct] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [wrOpen, setWrOpen] = useState(false);
  const [wrMsgs, setWrMsgs] = useState<{ role: "you" | "ai"; text: string }[]>([]);
  const [wrInput, setWrInput] = useState("");
  const [wrSending, setWrSending] = useState(false);
  const [syncingTaskIds, setSyncingTaskIds] = useState<Set<string>>(new Set());
  const [briefIdx, setBriefIdx] = useState(0);

  const notify = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 2000);
  }, []);

  // "Tasks Today" counts tasks you still need to handle today: relevant TODAY (due today, or a
  // recurring task scheduled for today) PLUS anything overdue (a dated task whose due date is in
  // the past) — since overdue work still needs doing today. Future-dated tasks are excluded.
  const { done, todayTotal, prioDone, prioTotal } = useMemo(() => {
    const now = new Date();
    const today = todayISODate();
    const dow = now.getDay();
    const dom = now.getDate();
    const countsToday = (t: Task) =>
      isRelevantToday(t, today, dow, dom) ||
      (t.repeatRule === "none" && !!t.dueDate && t.dueDate < today);
    const todays = tasks.filter(countsToday);
    // "Priorities Done" is the HIGH-priority subset of today's tasks — the real must-dos — so it
    // stays distinct from "Tasks Today" (which counts everything due today).
    const highs = todays.filter((t) => t.prio === "high");
    return {
      done: todays.filter((t) => effectiveDone(t, now)).length,
      todayTotal: todays.length,
      prioDone: highs.filter((t) => effectiveDone(t, now)).length,
      prioTotal: highs.length,
    };
  }, [tasks]);

  const loadCoaching = useCallback(async () => {
    setCoachingLoading(true);
    try {
      const d = await fetch("/api/coaching", { cache: "no-store" }).then((r) => r.json());
      setCoaching(d);
      setCoachingAt(Date.now());
      setBriefIdx(0);
    } catch {
      /* keep last good data */
    } finally {
      setCoachingLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadCoaching();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadCoaching]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => loadCoaching(), 30_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, loadCoaching]);

  const cScore = coaching?.score;
  const cBio = coaching?.biometrics;
  const isLive = coaching?.configured && !!cScore?.composite;
  const notProvisioned = coaching?.configured === false && coaching?.reason === "not_provisioned";
  const isPro = coaching?.plan === "pro";
  
  // Custom type extensions for briefings history
  const briefings = coaching?.briefings ?? [];
  const activeBriefing = briefings[briefIdx] || coaching?.briefing;
  const deltas = coaching?.weeklyDeltas;
  
  const activeTourTarget = showTour ? TOUR_STEPS[tourStep]?.target : null;
  const isSidebarTour = activeTourTarget === "tour-profile" || activeTourTarget === "tour-connections";
  const tourTargetClass = (target: string) => activeTourTarget === target ? " tour-target-active" : "";

  // Position the tour card beside the highlighted target element
  const positionTourCard = useCallback(() => {
    const target = TOUR_STEPS[tourStep]?.target;
    if (!target) return;
    const el = document.querySelector(`[data-tour="${target}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardW = Math.min(400, window.innerWidth - 32);
    const cardH = 280; // approximate height
    const gap = 16;
    const isSidebar = target === "tour-profile" || target === "tour-connections";

    let top: number;
    let left: number;

    if (isSidebar) {
      // Place to the right of the sidebar button, vertically centered
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - cardH / 2;
    } else {
      // Try to place to the right of the target
      const rightSpace = window.innerWidth - rect.right - gap;
      if (rightSpace >= cardW) {
        left = rect.right + gap;
        top = rect.top;
      } else {
        // Fall back to right-aligned below the target
        left = Math.max(16, window.innerWidth - cardW - 16);
        top = rect.bottom + gap;
      }
    }

    // Clamp to viewport
    top = Math.max(16, Math.min(top, window.innerHeight - cardH - 16));
    left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));

    setTourCardPos({ top, left });
  }, [tourStep]);

  useEffect(() => {
    if (!showTour) return;
    const target = TOUR_STEPS[tourStep]?.target;
    if (!target) return;
    const isSidebar = target === "tour-profile" || target === "tour-connections";

    if (isSidebar) {
      // Sidebar buttons are already visible (fixed) — just position the card
      window.setTimeout(positionTourCard, 60);
    } else {
      // Scroll the main-area target into view first, then position
      window.setTimeout(() => {
        document.querySelector(`[data-tour="${target}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
        // Wait for scroll to settle
        window.setTimeout(positionTourCard, 350);
      }, 80);
    }
  }, [showTour, tourStep, positionTourCard]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const tourKey = `relentless-dashboard-tour-complete:${user.id}`;
      if (typeof window !== "undefined" && !window.localStorage.getItem(tourKey)) {
        setShowTour(true);
        setTourStep(0);
      }

      supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
        .then(({ data }) => {
          if (!cancelled && data?.full_name) setFirstName(data.full_name.split(" ")[0]);
        });

      const { data, error } = await supabase
        .from("tasks").select("*").order("created_at", { ascending: true });
      if (error) {
        if (!cancelled) {
          setTaskError("Tasks table not found yet. Run the one-time Supabase setup (WEB-01 guide) and reload.");
          setLoadingTasks(false);
        }
        return;
      }
      if (!cancelled) {
        setTasks((data ?? []).map((r) => rowToTask(r as TaskRow)));
        setLoadingTasks(false);
      }

      // Auto-sync Google Calendar if connected, then load meetings
      const { data: prof } = await supabase
        .from("profiles").select("google_calendar_refresh_token").eq("id", user.id).maybeSingle();
      if (prof?.google_calendar_refresh_token) {
        try { await fetch("/api/connections/google-calendar/sync"); } catch { /* best-effort */ }
      }

      const freshMeetings = await supabase
        .from("meetings").select("id,title,meet_time,scheduled_at").order("scheduled_at", { ascending: true });
      let mData: MeetingRow[] | null = (freshMeetings.data ?? null) as MeetingRow[] | null;
      let mErr = freshMeetings.error;
      if (mErr) {
        const legacy = await supabase
          .from("meetings").select("id,title,meet_time").order("meet_time", { ascending: true });
        mData = (legacy.data ?? null) as MeetingRow[] | null;
        mErr = legacy.error;
      }
      if (!cancelled) {
        if (mErr) {
          setMeetingError("Unable to load meetings. Please check your connection and reload.");
        } else {
          setMeetingError(null);
          setMeetings((mData ?? []).map((r) => rowToMeeting(r as MeetingRow)));
        }
        setLoadingMeetings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Auto-add the recurring executive tasks once per ISO week (idempotent). Runs after tasks load;
  // skips if this week's set already exists (DB marker) or was already seeded (localStorage guard).
  useEffect(() => {
    if (loadingTasks || taskError) return;
    const weekKey = isoWeekKey();
    const flag = `recurring-seeded-${weekKey}`;
    if (typeof window !== "undefined" && window.localStorage.getItem(flag)) return;
    if (tasks.some((t) => t.meta && t.meta.includes(weekKey))) {
      if (typeof window !== "undefined") window.localStorage.setItem(flag, "1");
      return;
    }
    // Optimistic guard set BEFORE the async insert prevents a double-seed across re-renders/tabs.
    if (typeof window !== "undefined") window.localStorage.setItem(flag, "1");
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // First-time users start with an empty to-do list — recurring tasks only kick in from their
      // second ISO week onward, so a brand-new signup never sees pre-filled tasks they didn't create.
      if (user.created_at && isoWeekKey(new Date(user.created_at)) === weekKey) {
        if (typeof window !== "undefined") window.localStorage.setItem(flag, "1");
        return;
      }
      const meta = `Weekly · ${weekKey}`;
      const rows = RECURRING_TASKS.map((r) => ({
        user_id: user.id, title: r.title, priority: r.prio, meta, due_date: todayISODate(), done: false,
      }));
      const { data, error } = await supabase.from("tasks").insert(rows).select("*");
      if (error || !data) {
        if (typeof window !== "undefined") window.localStorage.removeItem(flag); // allow retry
        return;
      }
      const seeded = data.map((d) => rowToTask(d as TaskRow));
      setTasks((ts) => [...ts, ...seeded]);
      notify("Added this week's recurring executive tasks");
      seeded.forEach(async (t) => {
        const ghlId = await syncTaskToGhl({ op: "create", title: t.title, dueDate: t.dueDate });
        if (ghlId) {
          setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ghl: ghlId } : x)));
          await supabase.from("tasks").update({ ghl_task_id: ghlId }).eq("id", t.id);
        }
      });
    })();
  }, [loadingTasks, taskError, tasks, supabase, notify]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function completeTour() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && typeof window !== "undefined") {
      window.localStorage.setItem(`relentless-dashboard-tour-complete:${user.id}`, "1");
    }
    setShowTour(false);
    setTourCardPos(null);
  }

  async function toggle(id: string) {
    if (syncingTaskIds.has(id)) return;
    const cur = tasks.find((t) => t.id === id);
    if (!cur) return;
    setSyncingTaskIds((s) => new Set(s).add(id));

    if (cur.repeatRule !== "none") {
      // Recurring: completion is per-occurrence. Mark THIS occurrence done (or clear it) by
      // stamping the current occurrence's date into `meta` as "DONE:<date>". It auto-resets on
      // the next occurrence because the stored date stops matching currentOccurrenceDate().
      const now = new Date();
      const wasDone = isRecurringDoneNow(cur, now);
      const occ = currentOccurrenceDate(cur, now);
      const nextMeta = wasDone || !occ ? "" : `${DONE_MARK}${occ}`;
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, meta: nextMeta } : t)));
      const { error } = await supabase.from("tasks").update({ meta: nextMeta }).eq("id", id);
      if (error) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, meta: cur.meta } : t)));
      else notify(wasDone ? "Reminder reopened" : "Done for now — back on the next one");
      setSyncingTaskIds((s) => { const n = new Set(s); n.delete(id); return n; });
      return;
    }

    const next = !cur.done;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: next } : t)));
    const { error } = await supabase.from("tasks").update({ done: next }).eq("id", id);
    if (error) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: cur.done } : t)));
    else {
      notify(next ? "Task completed" : "Task marked incomplete");
      if (cur.ghl) await syncTaskToGhl({ op: "complete", ghlTaskId: cur.ghl, completed: next });
    }
    setSyncingTaskIds((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  async function addTaskText(
    title: string,
    prio: Prio = "med",
    dueDate = newTaskDate,
    recur?: { rule: RepeatRule; days: number[]; remindAt: string },
  ) {
    const t = title.trim();
    if (!t) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const isRecurring = recur && recur.rule !== "none";
    const meta = isRecurring ? "Recurring reminder" : taskMetaLabel("Due today", dueDate || null);
    const insertRow: Record<string, unknown> = {
      user_id: user.id, title: t, priority: prio, meta, due_date: isRecurring ? null : (dueDate || null), done: false,
    };
    if (isRecurring) {
      insertRow.repeat_rule = recur!.rule;
      insertRow.repeat_days = recur!.days;
      insertRow.remind_at = recur!.remindAt;
      insertRow.reminder_active = true;
    }
    const { data, error } = await supabase.from("tasks").insert(insertRow).select("*").single();
    if (error || !data) return;
    const task = rowToTask(data as TaskRow);
    setTasks((ts) => [...ts, task]);
    notify(isRecurring ? "Recurring reminder added" : "Task added");
    // Recurring reminders live only in the app + SMS engine — don't mirror them to GHL one-off tasks.
    if (isRecurring) return;
    const ghlId = await syncTaskToGhl({ op: "create", title: t, dueDate: task.dueDate });
    if (ghlId) {
      setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, ghl: ghlId } : x)));
      await supabase.from("tasks").update({ ghl_task_id: ghlId }).eq("id", task.id);
    }
  }

  async function removeTask(id: string) {
    if (syncingTaskIds.has(id)) return;
    const prev = tasks;
    const cur = tasks.find((t) => t.id === id);
    setSyncingTaskIds((s) => new Set(s).add(id));
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) { setTasks(prev); }
    else {
      notify("Task deleted");
      if (cur?.ghl) await syncTaskToGhl({ op: "delete", ghlTaskId: cur.ghl });
    }
    setSyncingTaskIds((s) => { const n = new Set(s); n.delete(id); return n; });
  }

  async function saveTaskTitle(id: string, title: string) {
    const trimmed = title.trim();
    const cur = tasks.find((t) => t.id === id);
    setEditingId(null);
    if (!cur || !trimmed || trimmed === cur.title) return;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, title: trimmed } : t)));
    const { error } = await supabase.from("tasks").update({ title: trimmed }).eq("id", id);
    if (error) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, title: cur.title } : t)));
    else notify("Task renamed");
  }

  async function setPrio(id: string, next: Prio) {
    const cur = tasks.find((t) => t.id === id);
    if (!cur) return;
    setPrioPickerId(null);
    if (next === cur.prio) return;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, prio: next } : t)));
    const { error } = await supabase.from("tasks").update({ priority: next }).eq("id", id);
    if (error) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, prio: cur.prio } : t)));
    else notify(`Priority set to ${next === "med" ? "medium" : next}`);
  }

  async function setDue(id: string, nextDate: string | null) {
    const cur = tasks.find((t) => t.id === id);
    if (!cur) return;
    setDatePickerId(null);
    if (nextDate === cur.dueDate) return;
    const nextMeta = taskMetaLabel(cur.meta, nextDate);
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, dueDate: nextDate, meta: nextMeta } : t)));
    const { error } = await supabase.from("tasks").update({ due_date: nextDate, meta: nextMeta }).eq("id", id);
    if (error) setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, dueDate: cur.dueDate, meta: cur.meta } : t)));
    else notify(nextDate ? `Due date set to ${dateLabel(nextDate)}` : "Due date cleared");
  }

  function openRecurEdit(t: Task) {
    setEditRecurId(t.id);
    setEditRepeat(t.repeatRule);
    setEditRepeatDays(t.repeatDays ?? []);
    setEditRemindAt(t.remindAt ?? "09:00");
  }

  async function saveRecurrence(id: string) {
    const cur = tasks.find((t) => t.id === id);
    if (!cur) return;
    if (editRepeat === "weekly" && editRepeatDays.length === 0) { notify("Pick at least one day"); return; }
    if (editRepeat === "monthly" && editRepeatDays.length === 0) { notify("Pick a day of the month"); return; }

    const isRecurring = editRepeat !== "none";
    // Any occurrence-completion marker ("DONE:<date>") is tied to the old schedule; drop it so a
    // changed schedule starts fresh and a task turned non-recurring doesn't show "DONE:..." as its label.
    const clearMark = (cur.meta || "").startsWith(DONE_MARK);
    const nextMeta = clearMark ? (isRecurring ? "Recurring reminder" : "") : cur.meta;
    const patch: Record<string, unknown> = {
      repeat_rule: editRepeat,
      repeat_days: isRecurring ? editRepeatDays : null,
      remind_at: isRecurring ? editRemindAt : null,
      reminder_active: isRecurring,
      // Clear last_reminded_on so a changed schedule can fire fresh today if it now matches.
      last_reminded_on: null,
      ...(clearMark ? { meta: nextMeta } : {}),
    };
    const next: Task = {
      ...cur,
      meta: nextMeta,
      repeatRule: editRepeat,
      repeatDays: isRecurring ? editRepeatDays : [],
      remindAt: isRecurring ? editRemindAt : null,
    };
    setTasks((ts) => ts.map((t) => (t.id === id ? next : t)));
    setEditRecurId(null);
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) { setTasks((ts) => ts.map((t) => (t.id === id ? cur : t))); notify("Could not save"); }
    else notify(isRecurring ? "Reminder updated" : "Repeat turned off");
  }

  function addTask() {
    if (newRepeat !== "none") {
      if (newRepeat === "weekly" && newRepeatDays.length === 0) { notify("Pick at least one day"); return; }
      if (newRepeat === "monthly" && newRepeatDays.length === 0) { notify("Pick a day of the month"); return; }
      addTaskText(newTask, newTaskPrio, newTaskDate, { rule: newRepeat, days: newRepeatDays, remindAt: newRemindAt });
      setNewRepeat("none"); setNewRepeatDays([]); setNewRemindAt("09:00");
    } else {
      addTaskText(newTask, newTaskPrio, newTaskDate);
    }
    setNewTask("");
    setNewTaskPrio("med");
  }

  async function addMeet() {
    const v = newMeet.trim();
    if (!v || !newMeetDate || !newMeetTime) {
      notify("Add a meeting date and time");
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const scheduledAt = makeScheduledAt(newMeetDate, newMeetTime);
    const { data, error } = await supabase
      .from("meetings").insert({
        user_id: user.id,
        title: v,
        meet_time: scheduledAt || newMeetTime,
        scheduled_at: scheduledAt,
        reminder_sent_at: null,
      })
      .select("id,title,meet_time,scheduled_at").single();
    if (!error && data) {
      setMeetings((ms) => [...ms, rowToMeeting(data as MeetingRow)]);
      setNewMeet(""); setNewMeetDate(todayISODate()); setNewMeetTime("");
      notify("Meeting added");
    } else {
      notify("Couldn't save the meeting — please try again");
    }
  }

  async function removeMeeting(id: string) {
    const prev = meetings;
    setMeetings((ms) => ms.filter((m) => m.id !== id));
    const { error } = await supabase.from("meetings").delete().eq("id", id);
    if (error) setMeetings(prev);
    else notify("Meeting deleted");
  }

  function startDictation() {
    type SR = {
      lang: string; interimResults: boolean; maxAlternatives: number; start: () => void;
      onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void;
      onerror: (e: { error: string }) => void; onend: () => void
    };
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) {
      setDictNote("⚠ Voice input needs Chrome or Edge.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    setRecording(true);
    setDictNote("🎙️ Listening… speak your tasks now.");
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const parts = transcript.split(/,| and | then | also |;/i).map((s) => s.trim()).filter(Boolean);
      parts.forEach((p) => addTaskText(p.charAt(0).toUpperCase() + p.slice(1)));
      setDictNote(`✓ Added ${parts.length} task${parts.length > 1 ? "s" : ""} from: "${transcript}"`);
    };
    rec.onerror = (ev) => setDictNote(`⚠ Voice error: ${ev.error}. Try again or type.`);
    rec.onend = () => setRecording(false);
    rec.start();
  }

  const hasScore = cScore?.composite != null;
  const compositeScore = cScore?.composite ?? 0;
  const ringPct = Math.max(0, Math.min(100, compositeScore));
  const ringBand = scoreBand(compositeScore);
  const hasRecovery = cBio?.recovery != null;
  const showSkeletons = coachingLoading && !coaching;
  const cProfile = coaching?.profile;
  const cHealth = coaching?.health;
  const cActivity = coaching?.activity ?? [];
  const cMarket = coaching?.marketSignal;
  const cMonthly = coaching?.monthly;

  async function wrSend(text: string) {
    const msg = text.trim();
    if (!msg || wrSending) return;
    if (msg.toUpperCase() !== "WAR ROOM") setWrMsgs((m) => [...m, { role: "you", text: msg }]);
    setWrInput("");
    setWrSending(true);
    try {
      const res = await fetch("/api/warroom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      const reply = (data?.reply && String(data.reply)) || data?.error || "(no response)";
      setWrMsgs((m) => [...m, { role: "ai", text: reply }]);
    } catch {
      setWrMsgs((m) => [...m, { role: "ai", text: "War Room is unreachable right now." }]);
    } finally {
      setWrSending(false);
    }
  }

  function startWarRoom() {
    setWrOpen(true);
    if (wrMsgs.length === 0) wrSend("WAR ROOM");
  }

  // Hydration-safe states for greeting and today's date
  const [todayStr, setTodayStr] = useState("");
  const [greeting, setGreeting] = useState("Good morning");

  useEffect(() => {
    setTodayStr(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
    const hr = new Date().getHours();
    setGreeting(hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening");
  }, []);

  return (
    <>
      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <aside className={`cc-sidebar${isSidebarTour ? " tour-sidebar-active" : ""}`}>
        <div className="cc-logo">
          <img src="/icon-192.png" alt="Relentless" />
        </div>

        <nav className="cc-nav">
          <button className="cc-nav-btn active" aria-label="Dashboard">
            <IconGrid />
            <span className="cc-nav-tooltip">Dashboard</span>
          </button>

          <button
            className={`cc-nav-btn${tourTargetClass("tour-connections")}`}
            aria-label="Connections"
            data-tour="tour-connections"
            onClick={() => router.push("/connections")}
          >
            <IconLink />
            <span className="cc-nav-tooltip">Connections</span>
          </button>

          <button
            className="cc-nav-btn"
            aria-label="Notification settings"
            onClick={() => router.push("/settings")}
          >
            <IconBell />
            <span className="cc-nav-tooltip">Notification settings</span>
          </button>

          <button
            className="cc-nav-btn"
            aria-label="Free AI Business Audit"
            onClick={() => router.push("/diagnostic")}
          >
            <IconAudit />
            <span className="cc-nav-tooltip">Free AI Business Audit</span>
          </button>
        </nav>
      </aside>

      {/* ── MAIN ────────────────────────────────────────────────────────── */}
      <div className="cc-main">

        {/* Greeting strip */}
        <header className="cc-greeting">
          <div className="cc-greeting-text">
            <div className="cc-greeting-name">
              {greeting}{firstName ? `, ${firstName}` : ""}
            </div>
            <div className="cc-greeting-date">{todayStr}</div>
          </div>
          <div className="cc-greeting-right">
            {coaching?.plan && (
              <span className="cc-plan-chip">{coaching.plan === "pro" ? "Pro" : "Standard"}</span>
            )}
            <button
              className={`live-pill${autoRefresh ? " is-live" : ""}`}
              onClick={() => setAutoRefresh((v) => !v)}
              title={autoRefresh ? "Live updates on — click to pause" : "Paused — click to resume"}
            >
              <span className="live-dot" />
              {coachingLoading ? "Syncing" : autoRefresh ? "Live" : "Paused"}
            </button>
             {firstName && (
              <div className="cc-avatar-wrapper">
                <button
                  className="cc-avatar-btn"
                  onClick={() => setProfileDropdownOpen((v) => !v)}
                  aria-label="Open profile menu"
                >
                  <span className="cc-avatar">
                    {firstName.slice(0, 1).toUpperCase()}
                  </span>
                </button>
                {profileDropdownOpen && (
                  <>
                    <div
                      className="dropdown-backdrop"
                      onClick={() => setProfileDropdownOpen(false)}
                    />
                    <div className="cc-profile-dropdown">
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          router.push("/onboarding?edit=1");
                        }}
                      >
                        <IconUser />
                        Profile
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          router.push("/settings");
                        }}
                      >
                        <IconBell />
                        Notification settings
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          router.push("/settings#billing");
                        }}
                      >
                        <IconUser />
                        Plan &amp; billing
                      </button>
                      <button
                        className="dropdown-item signout-btn"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          signOut();
                        }}
                      >
                        <IconLogout />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/* ── CONTENT ───────────────────────────────────────────────────── */}
        <div className="cc-content">

          {/* Not-provisioned banner */}
          {notProvisioned && (
            <div className="provision-banner">
              <div className="provision-banner-icon">⚠️</div>
              <div>
                <h3>Your coaching isn&apos;t set up yet</h3>
                <p>
                  Your account is created, but your personal coaching workspace hasn&apos;t been provisioned.
                  Your tasks &amp; meetings are saved fully to your account — the live Score, Recovery,
                  and Briefing turn on once your coach activates you.
                </p>
              </div>
            </div>
          )}

          {/* ── ROW 1: KPI tiles ──────────────────────────────────────── */}
          <div className={`kpi-row${isPro ? "" : " no-pro"}${tourTargetClass("tour-score")}`} data-tour="tour-score">

            {/* Latest Score (from last evening's End-of-Day) */}
            <div className="card kpi">
              {isLive && <span className="kpi-live">LIVE</span>}
              <div className="kpi-label">Yesterday&apos;s Score</div>
              {showSkeletons ? (
                <>
                  <div className="kpi-big skel" />
                  <div className="skel skel-text" style={{ width: 64, marginTop: 4 }} />
                </>
              ) : hasScore ? (
                <>
                  <div className={`kpi-big ${ringBand}`}>{compositeScore}</div>
                  <div className="kpi-sub">{cScore?.label ?? "Last score"}</div>
                </>
              ) : (
                <>
                  <div className="kpi-big" style={{ color: "var(--muted)" }}>—</div>
                  <div className="kpi-sub">No score yet</div>
                </>
              )}
            </div>

            {/* Recovery */}
            <div className="card kpi">
              <div className="kpi-label">Recovery</div>
              {showSkeletons ? (
                <>
                  <div className="kpi-big skel" />
                  <div className="skel skel-text" style={{ width: 80, marginTop: 4 }} />
                </>
              ) : hasRecovery ? (
                <>
                  <div className="kpi-big green">{cBio?.recovery}</div>
                  <div className="kpi-sub">
                    {cBio?.hrv ? `HRV ${cBio.hrv}ms` : "HRV —"} · {cBio?.sleep ? `Sleep ${cBio.sleep}` : "Sleep —"}
                  </div>
                </>
              ) : (
                <>
                  <div className="kpi-big" style={{ color: "var(--muted)" }}>—</div>
                  <div className="kpi-sub">Reply with your check-in</div>
                </>
              )}
            </div>

            {/* Tasks Today */}
            <div className="card kpi">
              <div className="kpi-label">Tasks Today</div>
              <div className="kpi-big">{done}/{todayTotal}</div>
              <div className="kpi-sub">{todayTotal === 0 ? "Nothing due today" : `${todayTotal - done} remaining`}</div>
            </div>

            {/* Priorities Done — Pro only. Sourced from today's completed to-do tasks (the field the
                score used to read was never populated), so it always reflects real, live progress. */}
            {isPro && (
              <div className="card kpi">
                <div className="kpi-label">Priorities Done</div>
                <div className="kpi-big purple">
                  {prioDone}{prioTotal > 0 ? `/${prioTotal}` : ""}
                </div>
                <div className="kpi-sub">{prioTotal === 0 ? "No high-priority tasks today" : "High-priority tasks"}</div>
              </div>
            )}
          </div>

          {/* ── Cards pack into 2 balanced masonry columns (no row-pairing voids) ── */}
          <div className="bento-masonry">

          {/* Tasks card */}
          <div className={`card${tourTargetClass("tour-todos")}`} data-tour="tour-todos">
              <h2 className="sec">My To-Do List</h2>
              {taskError && <div className="smsnote" style={{ color: "#b91c1c" }}>⚠ {taskError}</div>}
              {!taskError && loadingTasks && <div className="smsnote">Loading your tasks…</div>}
              {!taskError && !loadingTasks && tasks.length === 0 && (
                <div className="smsnote">No tasks yet — add one below or tap the mic.</div>
              )}
              {[...tasks]
                .sort((a, b) => {
                  const rank = { high: 0, med: 1, low: 2 } as Record<string, number>;
                  const today = todayISODate();
                  const now = new Date();
                  const dow = now.getDay();
                  const dom = now.getDate();
                  // Order: undone before done; then DATE-first — daily tasks pinned to the very top,
                  // then all dated tasks in true chronological (calendar) order, and within the same
                  // date, priority HIGH -> MED -> LOW. Undated / recurring-not-today tasks sort last.
                  const doneDiff = (effectiveDone(a, now) ? 1 : 0) - (effectiveDone(b, now) ? 1 : 0);
                  if (doneDiff) return doneDiff;
                  const ka = taskSortKey(a, today, dow, dom);
                  const kb = taskSortKey(b, today, dow, dom);
                  if (ka !== kb) return ka < kb ? -1 : 1;
                  return (rank[a.prio] ?? 3) - (rank[b.prio] ?? 3);
                })
                .map((t) => {
                const isLongTitle = t.title.length > 60;
                const compact = isLongTitle && !expandedTaskIds.has(t.id) && editingId !== t.id;
                const tDone = effectiveDone(t, new Date());
                return (
                <div className={`task ${tDone ? "completed" : ""}`} key={t.id} style={syncingTaskIds.has(t.id) ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
                  <div className={`check ${tDone ? "done" : ""}`} onClick={() => toggle(t.id)}>
                    {tDone ? "✓" : ""}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingId === t.id ? (
                      <input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={() => saveTaskTitle(t.id, editText)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveTaskTitle(t.id, editText);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        style={{ width: "100%", font: "inherit", padding: "2px 6px" }}
                      />
                    ) : (
                      <div
                        className="tt"
                        title={compact ? t.title : "Click to rename"}
                        style={compact
                          ? { cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
                          : { cursor: "text" }}
                        onClick={() => {
                          if (compact) { setExpandedTaskIds((s) => new Set(s).add(t.id)); }
                          else { setEditingId(t.id); setEditText(t.title); }
                        }}
                      >
                        {t.title}
                      </div>
                    )}
                    <div className="meta" style={{ position: "relative" }}>
                      <span
                        className={`prio ${t.prio}`}
                        title="Click to change priority"
                        onClick={() => setPrioPickerId(prioPickerId === t.id ? null : t.id)}
                      >
                        {t.prio === "high" ? "HIGH" : t.prio === "med" ? "MED" : "LOW"}
                      </span>
                      {prioPickerId === t.id && (
                        <div
                          className="prio-picker"
                          style={{
                            position: "absolute", top: "100%", left: 0, zIndex: 20,
                            display: "flex", flexDirection: "column", background: "var(--card, #fff)",
                            border: "1px solid var(--border, #ddd)", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            marginTop: 4, overflow: "hidden", minWidth: 88,
                          }}
                        >
                          {(["high", "med", "low"] as Prio[]).map((p) => (
                            <span
                              key={p}
                              className={`prio ${p}`}
                              style={{ padding: "6px 10px", cursor: "pointer", textAlign: "left", borderRadius: 0 }}
                              onClick={() => setPrio(t.id, p)}
                            >
                              {p === "high" ? "HIGH" : p === "med" ? "MED" : "LOW"}
                            </span>
                          ))}
                        </div>
                      )}
                      {t.repeatRule !== "none" ? (
                        <span
                          title="Click to edit this reminder"
                          style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                          onClick={() => (editRecurId === t.id ? setEditRecurId(null) : openRecurEdit(t))}
                        >
                          🔁 {repeatLabel(t)}
                        </span>
                      ) : (
                        <span style={{ position: "relative" }}>
                          <span
                            title="Click to change the due date"
                            style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                            onClick={() => setDatePickerId(datePickerId === t.id ? null : t.id)}
                          >
                            {taskMetaLabel(t.meta, t.dueDate)}
                          </span>
                          {datePickerId === t.id && (
                            <span
                              style={{
                                position: "absolute", top: "100%", left: 0, zIndex: 20,
                                display: "flex", alignItems: "center", gap: 6, background: "var(--card, #fff)",
                                border: "1px solid var(--border, #ddd)", borderRadius: 8,
                                boxShadow: "0 4px 12px rgba(0,0,0,0.15)", marginTop: 4, padding: "6px 8px",
                              }}
                            >
                              <input
                                type="date"
                                className="date"
                                autoFocus
                                defaultValue={t.dueDate ?? ""}
                                onChange={(e) => setDue(t.id, e.target.value || null)}
                                aria-label="Due date"
                              />
                              {t.dueDate && (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: "2px 8px" }}
                                  onClick={() => setDue(t.id, null)}
                                >
                                  Clear
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    {editRecurId === t.id && (
                      <div className="recur-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8, padding: "8px", borderRadius: 8, background: "var(--bg, #f6f6f4)" }}>
                        <select
                          className="date"
                          value={editRepeat}
                          onChange={(e) => { setEditRepeat(e.target.value as RepeatRule); setEditRepeatDays([]); }}
                          aria-label="Repeat"
                        >
                          <option value="none">Don&apos;t repeat</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                        {editRepeat === "weekly" && (
                          <div style={{ display: "flex", gap: 4 }}>
                            {DOW_LABELS.map((lbl, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setEditRepeatDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort((a, b) => a - b)))}
                                className="btn btn-ghost"
                                style={{
                                  padding: "4px 8px", fontSize: 12, minWidth: 38,
                                  background: editRepeatDays.includes(i) ? "var(--amber, #d4af3c)" : undefined,
                                  color: editRepeatDays.includes(i) ? "#1a1a1a" : undefined,
                                  fontWeight: editRepeatDays.includes(i) ? 700 : 500,
                                }}
                              >
                                {lbl[0]}
                              </button>
                            ))}
                          </div>
                        )}
                        {editRepeat === "monthly" && (
                          <input
                            type="number" min={1} max={31} placeholder="Day 1-31"
                            value={editRepeatDays[0] ?? ""}
                            onChange={(e) => { const v = parseInt(e.target.value, 10); setEditRepeatDays(isNaN(v) ? [] : [Math.max(1, Math.min(31, v))]); }}
                            className="date" style={{ width: 90 }} aria-label="Day of month"
                          />
                        )}
                        {editRepeat !== "none" && (
                          <>
                            <label style={{ fontSize: 12, color: "var(--muted)" }}>at</label>
                            <input className="time" type="time" value={editRemindAt} onChange={(e) => setEditRemindAt(e.target.value)} aria-label="Reminder time" />
                          </>
                        )}
                        <button className="btn btn-primary" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => saveRecurrence(t.id)}>Save</button>
                        <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setEditRecurId(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                  {isLongTitle && (
                    <button
                      onClick={() => setExpandedTaskIds((s) => {
                        const n = new Set(s);
                        if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                        return n;
                      })}
                      className="item-delete"
                      title={compact ? "Show details" : "Collapse"}
                      aria-label={compact ? "Show task details" : "Collapse task"}
                      aria-expanded={!compact}
                      style={{ fontSize: 13 }}
                    >
                      {compact ? "▸" : "▾"}
                    </button>
                  )}
                  <button
                    onClick={() => removeTask(t.id)}
                    className="item-delete"
                    title="Delete task"
                    aria-label="Delete task"
                  >
                    ×
                  </button>
                </div>
                );
              })}
              <div className="addrow">
                <input
                  placeholder="Add a task…"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
                />
                {newRepeat === "none" && (
                  <input
                    className="date"
                    type="date"
                    value={newTaskDate}
                    onChange={(e) => setNewTaskDate(e.target.value)}
                    aria-label="Task due date"
                  />
                )}
                <select
                  className="date"
                  value={newTaskPrio}
                  onChange={(e) => setNewTaskPrio(e.target.value as Prio)}
                  aria-label="Priority"
                  title="Set this task's priority"
                >
                  <option value="high">High</option>
                  <option value="med">Medium</option>
                  <option value="low">Low</option>
                </select>
                <select
                  className="date"
                  value={newRepeat}
                  onChange={(e) => {
                    const r = e.target.value as RepeatRule;
                    setNewRepeat(r);
                    setNewRepeatDays([]);
                  }}
                  aria-label="Repeat"
                  title="Repeat this as a recurring SMS reminder"
                >
                  <option value="none">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <button
                  className="btn btn-ghost"
                  onClick={startDictation}
                  title="Speak your tasks"
                  style={recording ? { color: "#ef4444" } : undefined}
                >
                  {recording ? "● REC" : "🎤"}
                </button>
                <button className="btn btn-primary" onClick={addTask}>Add</button>
              </div>

              {newRepeat !== "none" && (
                <div className="recur-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 }}>
                  {newRepeat === "weekly" && (
                    <div style={{ display: "flex", gap: 4 }}>
                      {DOW_LABELS.map((lbl, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() =>
                            setNewRepeatDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort((a, b) => a - b)))
                          }
                          className="btn btn-ghost"
                          style={{
                            padding: "4px 8px", fontSize: 12, minWidth: 38,
                            background: newRepeatDays.includes(i) ? "var(--amber, #d4af3c)" : undefined,
                            color: newRepeatDays.includes(i) ? "#1a1a1a" : undefined,
                            fontWeight: newRepeatDays.includes(i) ? 700 : 500,
                          }}
                        >
                          {lbl[0]}
                        </button>
                      ))}
                    </div>
                  )}
                  {newRepeat === "monthly" && (
                    <input
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Day 1-31"
                      value={newRepeatDays[0] ?? ""}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setNewRepeatDays(isNaN(v) ? [] : [Math.max(1, Math.min(31, v))]);
                      }}
                      className="date"
                      style={{ width: 90 }}
                      aria-label="Day of month"
                    />
                  )}
                  <label style={{ fontSize: 12, color: "var(--muted)" }}>Remind at</label>
                  <input
                    className="time"
                    type="time"
                    value={newRemindAt}
                    onChange={(e) => setNewRemindAt(e.target.value)}
                    aria-label="Reminder time"
                  />
                  <span className="smsnote" style={{ margin: 0 }}>
                    📲 SMS reminder at your local time. Reply DONE or SKIP.
                  </span>
                </div>
              )}

              <div className="smsnote">{dictNote}</div>
              <div className="smsnote">🔔 Open tasks get an SMS nudge before end of day.</div>
            </div>

          {/* Meetings card */}
          <div className={`card${tourTargetClass("tour-meetings")}`} data-tour="tour-meetings">
              <h2 className="sec">Meetings</h2>
              {loadingMeetings && <div className="smsnote">Loading meetings…</div>}
              {meetingError && (
                <div className="smsnote" style={{ color: "#b91c1c", background: "#fef2f2", padding: "8px 12px", borderRadius: 8, border: "1px solid #fecaca" }}>
                  ⚠ {meetingError}
                </div>
              )}
              {!loadingMeetings && !meetingError && meetings.length === 0 && (
                <div className="smsnote">No meetings yet — add one below.</div>
              )}
              {meetings.map((m) => (
                <div className="meeting" key={m.id}>
                  <span className="mt">{m.title}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span className="mtime">{fmtMeeting(m)}</span>
                    <button
                      onClick={() => removeMeeting(m.id)}
                      className="item-delete"
                      title="Delete meeting"
                      aria-label="Delete meeting"
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
              <div className="addrow">
                <input placeholder="Meeting title…" value={newMeet} onChange={(e) => setNewMeet(e.target.value)} />
                <input className="date" type="date" value={newMeetDate} onChange={(e) => setNewMeetDate(e.target.value)} aria-label="Meeting date" />
                <input className="time" type="time" value={newMeetTime} onChange={(e) => setNewMeetTime(e.target.value)} />
              </div>
              <div className="addrow">
                <button className="btn btn-primary btn-block" onClick={addMeet}>Add meeting</button>
              </div>
              <div className="smsnote">⏰ You&apos;ll get a polite SMS 5 minutes before each meeting.</div>
            </div>

          {/* Score ring + Briefing */}
          <div className="bento-row">

            {/* Score ring card */}
            <div className="card">
              <div className="sec-title">
                <h2 className="sec">Yesterday&apos;s Score</h2>
                <span className="right-link" style={{ float: "none", fontSize: 10 }}>History →</span>
              </div>

              <div className="ringwrap">
                {showSkeletons ? (
                  <div className="ring ring-skel">
                    <div className="val">
                      <div className="n" style={{ color: "transparent" }}>00</div>
                      <div className="t" style={{ color: "transparent" }}>Loading</div>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`ring band-${hasScore ? ringBand : "empty"}${hasScore ? " ring-click" : ""}`}
                    style={{ "--pct": hasScore ? ringPct : 0 } as CSSProperties}
                    onClick={() => hasScore && setPillarKey("composite")}
                    title={hasScore ? "What is this score?" : undefined}
                  >
                    <div className="val">
                      <div className={`n ${hasScore ? ringBand : ""}`} style={hasScore ? undefined : { color: "var(--muted)" }}>
                        {hasScore ? compositeScore : "—"}
                      </div>
                      <div className="t">{hasScore ? (cScore?.label ?? "Today") : "No score yet"}</div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* 7-Day Sparkline */}
              {!showSkeletons && coaching?.trend && coaching.trend.length > 0 && (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 6, height: 32, margin: "14px 0" }} title="7-Day Performance Trend">
                  {coaching.trend.slice(-7).map((t, idx) => (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <div 
                        style={{ 
                          width: 8, 
                          height: `${(t.composite ?? 0) * 0.28}px`, 
                          background: t.composite && t.composite >= 80 ? "#10b981" : t.composite && t.composite >= 60 ? "#f59e0b" : "#ef4444", 
                          borderRadius: 2 
                        }} 
                        title={`${t.date}: ${t.composite}`}
                      />
                      <span style={{ fontSize: 7, color: "var(--muted)" }}>{t.date ? t.date.slice(8) : ""}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <div className="pillar pillar-click" onClick={() => setPillarKey("body")} title="What is Body?">
                  <span className="pl">Body <span className="pl-q">?</span></span>
                  <span className="pv green">
                    {showNum(cScore?.body)}
                    <DeltaBadge change={deltas?.body?.change} />
                  </span>
                </div>
                <div className="pillar pillar-click" onClick={() => setPillarKey("focus")} title="What is Focus?">
                  <span className="pl">Focus <span className="pl-q">?</span></span>
                  <span className="pv">
                    {showNum(cScore?.focus)}
                    <DeltaBadge change={deltas?.focus?.change} />
                  </span>
                </div>
                <div className="pillar pillar-click" onClick={() => setPillarKey("execution")} title="What is Execution?">
                  <span className="pl">Execution <span className="pl-q">?</span></span>
                  <span className="pv">
                    {showNum(cScore?.execution)}
                    <DeltaBadge change={deltas?.execution?.change} />
                  </span>
                </div>
                <div className="pillar pillar-click" onClick={() => setPillarKey("alignment")} title="What is Alignment?">
                  <span className="pl">Alignment <span className="pl-q">?</span></span>
                  <span className="pv">
                    {showNum(cScore?.alignment)}
                    <DeltaBadge change={deltas?.alignment?.change} />
                  </span>
                </div>
              </div>
            </div>

            {/* Briefing card */}
            <div className={`card briefing${tourTargetClass("tour-briefing")}`} data-tour="tour-briefing">
              <div className="sec-title">
                <h2 className="sec">Morning Briefing</h2>
                <span
                  className="right-link"
                  style={{ float: "none", fontSize: 10 }}
                  onClick={() => !coachingLoading && loadCoaching()}
                  title="Pull the latest score, recovery & briefing"
                >
                  {coachingLoading
                    ? "Refreshing…"
                    : coachingAt
                    ? `Updated ${Math.max(0, Math.round((nowMs - coachingAt) / 1000))}s ago · ↻`
                    : "↻ Refresh"}
                </span>
              </div>

              {briefings.length > 1 && (
                <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
                  {briefings.map((b, idx) => (
                    <button
                      key={idx}
                      onClick={() => setBriefIdx(idx)}
                      style={{
                        fontSize: 9,
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: briefIdx === idx ? "#1e293b" : "none",
                        color: briefIdx === idx ? "white" : "var(--muted)",
                        cursor: "pointer",
                        fontWeight: 600,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {b.date ? dateLabel(b.date) : `Briefing #${idx}`}
                    </button>
                  ))}
                </div>
              )}

              {showSkeletons ? (
                <div className="briefing-skel">
                  <div className="skel skel-line" />
                  <div className="skel skel-line" />
                  <div className="skel skel-line" />
                </div>
              ) : activeBriefing?.text ? (
            <div className="briefing-body">
              {/* Multi-source sections mode */}
              {activeBriefing.sections ? (
                <>
                  {activeBriefing.sections.recovery && (
                    <details className="briefing-section" open>
                      <summary>
                        <span className="section-title">How I wake up</span>
                        <span className="section-summary">{activeBriefing.sections.recovery.summary}</span>
                      </summary>
                      <div className="section-content">{activeBriefing.sections.recovery.content}</div>
                    </details>
                  )}
                  {activeBriefing.sections.news && (
                    <details className="briefing-section" open>
                      <summary>
                        <span className="section-title">Market check</span>
                        <span className="section-summary">{activeBriefing.sections.news.summary}</span>
                      </summary>
                      <div className="section-content">{activeBriefing.sections.news.content}</div>
                    </details>
                  )}
                  {activeBriefing.sections.calendar && (
                    <details className="briefing-section" open>
                      <summary>
                        <span className="section-title">Today&apos;s calendar</span>
                        <span className="section-summary">{activeBriefing.sections.calendar.summary}</span>
                      </summary>
                      <span className="section-content">
                        {activeBriefing.sections.calendar.meetings.map((m: { title: string; time: string }, idx: number) => (
                          <div key={idx} className="meeting-item">{m.time} — {m.title}</div>
                        ))}
                      </span>
                    </details>
                  )}
                  {/* Gates for disabled sections */}
                  {!activeBriefing.sections.news && (
                    <div className="section-disabled">Market check <span className="connect-badge">Connect</span></div>
                  )}
                  {!activeBriefing.sections.calendar && (
                    <div className="section-disabled">Today&apos;s calendar <span className="connect-badge">Connect</span></div>
                  )}
                  {!activeBriefing.sections.crm && (
                    <div className="section-disabled">CRM <span className="connect-badge">Connect</span></div>
                  )}
                  <div className="section-disabled">Social <span className="connect-badge">Connect</span></div>
                  <div className="section-disabled">Email <span className="connect-badge">Connect</span></div>
                  <div className="section-disabled">Slack <span className="connect-badge">Connect</span></div>
                  <div className="section-disabled">Sales intel <span className="connect-badge">Connect</span></div>
                </>
              ) : (
                /* Classic fallback: single text block */
                <>
                  {activeBriefing.text.split(/\n\n+/).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                  {activeBriefing.priorities.length > 0 && (
                    <div className="prio-row">
                      <b style={{ fontSize: 12 }}>Top priorities:</b>
                      {activeBriefing.priorities.map((p, i) => (
                        <button
                          key={i}
                          className="prio-chip"
                          title="Add as a task"
                          onClick={() => { addTaskText(p, "high"); notify("Added priority to your tasks"); }}
                        >
                          <span className="prio-n">{i + 1}</span>{p}<span className="prio-add">+</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
              ) : (
                <div className="briefing-body">
                  <p>Good morning{firstName ? `, ${firstName}` : ""} — your first briefing is on its way.</p>
                  <p style={{ color: "var(--muted)", fontSize: 13 }}>
                    Every morning at 6&nbsp;AM, Relentless&nbsp;AI texts you a personalized briefing built from your
                    recovery and your top priorities. It appears here the moment it sends.
                  </p>
                </div>
              )}

              {!showSkeletons && (
                <div className="chips">
                  <span className={`chip ${isLive ? "g" : ""}`}>{isLive ? "LIVE from backend" : "Preview"}</span>
                  {hasRecovery && <span className="chip g">Recovery {cBio?.recovery}</span>}
                  {activeBriefing?.deliveredAt && <span className="chip">{whenLabel(activeBriefing.deliveredAt)}</span>}
                  {isPro && <span className="chip b">Market Signal · Connected</span>}
                </div>
              )}
            </div>
          </div>

          {/* Trend card */}
            <div className="card">
              <h2 className="sec">Last 90 Days · Score Trend</h2>
              <div className="trend">
                {showSkeletons ? (
                  [38, 64, 48, 72, 56, 60, 80].map((h, i) => (
                    <div className="bar" key={i}>
                      <div className="b skel" style={{ height: `${h}%` }} />
                      <small className="skel skel-text" style={{ width: 20 }}>—</small>
                    </div>
                  ))
                ) : coaching?.trend && coaching.trend.length >= 1 ? (
                  coaching.trend.map((p, i) => {
                    const isLast = i === coaching.trend!.length - 1;
                    const lbl = isLast ? "Today" : p.date ? p.date.slice(5) : `#${i + 1}`;
                    const h = p.composite ?? 0;
                    const sel = !!selectedDay && selectedDay.date === p.date;
                    return (
                      <div
                        className={`bar bar-click${sel ? " bar-sel" : ""}`}
                        key={`${p.date}-${i}`}
                        onClick={() => setSelectedDay(sel ? null : p)}
                        title={`${lbl}: ${h}${p.label ? ` (${p.label})` : ""} — click for breakdown`}
                      >
                        <div className={`b b-${scoreBand(h)}`} style={{ height: `${h}%` }} />
                        <small>{lbl}</small>
                      </div>
                    );
                  })
                ) : (
                  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Today"].map((d, i) => (
                    <div className="bar" key={`${d}-${i}`}>
                      <div className="b" style={{ height: "4%", background: "var(--line, #e5e5e5)" }} />
                      <small>{d}</small>
                    </div>
                  ))
                )}
              </div>

              {selectedDay && (
                <div className="day-breakdown">
                  <div className="dbk-head">
                    <span className="dbk-date">
                      {selectedDay.date === coaching?.trend?.[coaching.trend.length - 1]?.date ? "Today" : selectedDay.date}
                    </span>
                    {selectedDay.label && <span className="dbk-label">{selectedDay.label}</span>}
                    <span className={`dbk-score ${scoreBand(selectedDay.composite ?? 0)}`}>{selectedDay.composite}</span>
                    <button className="dbk-close" onClick={() => setSelectedDay(null)} aria-label="Close breakdown">×</button>
                  </div>
                  <div className="dbk-pillars">
                    {(
                      [["Body", selectedDay.body], ["Focus", selectedDay.focus], ["Execution", selectedDay.execution], ["Alignment", selectedDay.alignment],
                      ] as [string, number | null | undefined][]
                    ).map(([lbl, v]) => (
                      <div className="dbk-pill" key={lbl}><span>{lbl}</span><b>{showNum(v)}</b></div>
                    ))}
                  </div>
                </div>
              )}

              <div className="smsnote">
                {showSkeletons
                  ? "Loading your score trend…"
                  : coaching?.trend && coaching.trend.length >= 1
                  ? `📈 Live — ${coaching.trend.length} score${coaching.trend.length > 1 ? "s" : ""} so far · tap any bar for breakdown.`
                  : "📈 Full 90-day history will render here from your live data."}
              </div>
            </div>

          {/* Activity timeline */}
        <div className="card timeline">
              <h2 className="sec">Recent Activity</h2>
              {showSkeletons ? (
                [0, 1, 2, 3].map((i) => (
                  <div className="ev" key={i}>
                    <div className="t skel skel-text" style={{ width: 170 }}>loading</div>
                    <div className="d skel skel-text" style={{ width: 70, marginTop: 4 }}>—</div>
                  </div>
                ))
              ) : cActivity.length > 0 ? (
                cActivity.map((e, i) => {
                  const open = expandedAct === i;
                  const hasDetail = !!e.detail;
                  return (
                    <div
                      className={`ev${hasDetail ? " ev-click" : ""}${open ? " ev-open" : ""}`}
                      key={i}
                      onClick={() => hasDetail && setExpandedAct(open ? null : i)}
                      title={hasDetail ? "Click to expand" : undefined}
                    >
                      <div className="ev-row">
                        <div className="t">
                          {ACT_ICON[e.kind] ? `${ACT_ICON[e.kind]} ` : ""}{e.title}
                          {hasDetail && <span className="ev-caret">{open ? "▾" : "▸"}</span>}
                        </div>
                        <div className="d">{whenLabel(e.at)}</div>
                      </div>
                      {open && hasDetail && <div className="ev-detail">{e.detail}</div>}
                    </div>
                  );
                })
              ) : (
                <div className="smsnote">
                  No activity yet — this fills in as your briefings, scores, nudges and check-ins land.
                </div>
              )}
            </div>

          {/* ── ROW 5: Pro — Stage Intel + War Room ───────────────────── */}
          {isPro && (
            <div className="bento-half">

              {/* Stage Intelligence */}
              <div className="card">
                <div className="stage-head">
                  <h2 className="sec" style={{ margin: 0 }}>Stage Intelligence</h2>
                  {cProfile?.stage && (
                    <span className="badge">{STAGE_LABEL[cProfile.stage] ?? cProfile.stage.toUpperCase()}</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "#374151", margin: "10px 0 0", lineHeight: 1.6 }}>
                  {cHealth?.analysis
                    || (cProfile?.stage && STAGE_FOCUS[cProfile.stage])
                    || "Your stage-specific coaching focus appears here once your profile and first weekly check-in are in."}
                </p>
                {cProfile?.goal && (
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
                    🎯 12-month goal: {cProfile.goal}
                  </p>
                )}
                {cHealth && (cHealth.cash || cHealth.team) && (
                  <div className="chips" style={{ marginTop: 10 }}>
                    {cHealth.cash && <span className="chip">Cash: {cHealth.cash.replace(/_/g, " ")}</span>}
                    {cHealth.team && <span className="chip">Team: {cHealth.team.replace(/_/g, " ")}</span>}
                  </div>
                )}
                {cProfile?.avoidance || cHealth?.avoidedDecision ? (
                  <div className="avoid">
                    <div className="label">⚠ AVOIDANCE PATTERN</div>
                    {cProfile?.avoidance || cHealth?.avoidedDecision}
                  </div>
                ) : (
                  <div className="smsnote" style={{ marginTop: 10 }}>✓ No avoidance pattern flagged this week.</div>
                )}
              </div>

              {/* War Room launcher */}
              <div className="card warroom-card">
                <div className="stage-head">
                  <h2 className="sec" style={{ margin: 0 }}>War Room <span className="pro-tag">PRO</span></h2>
                  <button className="btn btn-primary" onClick={startWarRoom}>
                    {wrMsgs.length ? "Resume session" : "Start a session"}
                  </button>
                </div>
                <p style={{ fontSize: 13, color: "#374151", margin: "12px 0 0", lineHeight: 1.6 }}>
                  An on-demand strategy session with your AI strategist. Bring a hard problem, an opportunity, or a
                  decision you&apos;ve been avoiding — it pressure-tests your thinking from first principles and ends
                  with one committed 24-hour action.
                </p>
              </div>
            </div>
          )}

          {/* ── ROW 6: Pro — Business Health + Market Signal + Monthly ── */}
          {isPro && (cHealth || cMarket?.text || cMonthly) && (
            <div className="bento-three">

              {/* Business Health */}
              {cHealth && (
                <div className="card">
                  <div className="stage-head">
                    <h2 className="sec" style={{ margin: 0 }}>Business Health</h2>
                    {cHealth.weekStart && <span className="badge">Wk {cHealth.weekStart}</span>}
                  </div>
                  <div className="bh-grid">
                    {cHealth.cash && (
                      <div className="bh-metric">
                        <div className="label">Cash</div>
                        <div className="bh-tag">{cHealth.cash.replace(/_/g, " ")}</div>
                      </div>
                    )}
                    {cHealth.team && (
                      <div className="bh-metric">
                        <div className="label">Team</div>
                        <div className="bh-tag">{cHealth.team.replace(/_/g, " ")}</div>
                      </div>
                    )}
                  </div>
                  {cHealth.biggestRisk && (
                    <p style={{ fontSize: 12, color: "#374151", margin: "12px 0 0" }}>
                      <b>Biggest risk:</b> {cHealth.biggestRisk}
                    </p>
                  )}
                  {cHealth.analysis && (
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: "7px 0 0" }}>{cHealth.analysis}</p>
                  )}
                </div>
              )}

              {/* Market Signals Feed */}
              {((coaching?.marketSignals && coaching.marketSignals.length > 0) || cMarket?.text) && (
                <div className="card">
                  <h2 className="sec">Market Signals <span className="pro-tag">PRO</span></h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
                    {(coaching?.marketSignals || (cMarket ? [cMarket] : [])).slice(0, 5).map((sig, idx: number) => {
                      if (!sig || !sig.text) return null;
                      return (
                        <div key={idx} style={{ 
                          paddingBottom: idx < Math.min(5, (coaching?.marketSignals || []).length) - 1 ? 10 : 0, 
                          borderBottom: idx < Math.min(5, (coaching?.marketSignals || []).length) - 1 ? "1px solid #f3f4f6" : "none" 
                        }}>
                          <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.6 }}>
                            📡 {sig.text}
                          </p>
                          <div className="smsnote" style={{ margin: "4px 0 0" }}>
                            {sig.source ? `Source: ${sig.source.replace(/_/g, " ")}` : ""}
                            {sig.date ? ` · ${whenLabel(sig.date)}` : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly Report */}
              {cMonthly && (
                <div className="card">
                  <div className="stage-head">
                    <h2 className="sec" style={{ margin: 0 }}>Monthly Report</h2>
                    {cMonthly.monthYear && <span className="badge">{cMonthly.monthYear}</span>}
                  </div>
                  <div className="mr-score">
                    <span className={scoreBand(cMonthly.score ?? 0)}>{showNum(cMonthly.score)}</span>
                    <small>monthly score</small>
                  </div>
                  <div className="mr-grid">
                    <div><span>Base</span><b>{showNum(cMonthly.baseScore)}</b></div>
                    <div><span>Trend bonus</span><b>+{showNum(cMonthly.trendBonus)}</b></div>
                    <div><span>Consistency</span><b>+{showNum(cMonthly.consistencyBonus)}</b></div>
                    <div><span>Pillar gain</span><b>+{showNum(cMonthly.pillarBonus)}</b></div>
                    <div><span>Peak days</span><b>{showNum(cMonthly.peakDays)}</b></div>
                    <div><span>Recovery days</span><b>{showNum(cMonthly.recoveryDays)}</b></div>
                  </div>
                  {(cMonthly.bestDay || cMonthly.worstDay) && (
                    <div className="smsnote">
                      {cMonthly.bestDay ? `🏔 Best day ${cMonthly.bestDay}` : ""}
                      {cMonthly.worstDay ? ` · 🌧 Toughest ${cMonthly.worstDay}` : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          </div>{/* /bento-masonry */}

          <div className="footer-note">
            {coaching?.configured
              ? "Relentless AI · live data from your coaching backend"
              : "Relentless AI — preview · live data turns on once your coach activates you"}
          </div>
        </div>
      </div>

      {/* ── PILLAR / SCORE EXPLAINER POPOVER ──────────────────────────── */}
      {pillarKey && PILLAR_INFO[pillarKey] && (
        <div className="popover-overlay" onClick={() => setPillarKey(null)}>
          <div className="popover" onClick={(e) => e.stopPropagation()}>
            <div className="popover-head">
              <strong>{PILLAR_INFO[pillarKey].title}</strong>
              <button onClick={() => setPillarKey(null)} aria-label="Close">×</button>
            </div>
            <p>{PILLAR_INFO[pillarKey].body}</p>
          </div>
        </div>
      )}

      {/* ── WAR ROOM CHAT SLIDE-OVER ──────────────────────────────────── */}
      {wrOpen && (
        <div className="wr-overlay" onClick={() => setWrOpen(false)}>
          <div className="wr-panel" onClick={(e) => e.stopPropagation()}>
            <div className="wr-head">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img src="/icon-192.png" alt="Relentless" style={{ width: 24, height: 24, borderRadius: "50%" }} />
                <strong>War Room</strong> <span className="pro-tag">PRO</span>
              </div>
              <button onClick={() => setWrOpen(false)} aria-label="Close War Room">×</button>
            </div>
            <div className="wr-msgs">
              {wrMsgs.length === 0 && <div className="wr-empty">Opening your session…</div>}
              {wrMsgs.map((m, i) => (
                <div className={`wr-msg wr-${m.role}`} key={i}>{m.text}</div>
              ))}
              {wrSending && (
                <div className="wr-msg wr-ai wr-typing">
                  <span /><span /><span />
                </div>
              )}
            </div>
            <div className="wr-input">
              <input
                placeholder="Type your reply…"
                value={wrInput}
                onChange={(e) => setWrInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") wrSend(wrInput); }}
                disabled={wrSending}
                autoFocus
              />
              <button
                className="btn btn-primary"
                onClick={() => wrSend(wrInput)}
                disabled={wrSending || !wrInput.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {showTour && (
        <>
          <div className={`tour-overlay${isSidebarTour ? "" : " tour-blur"}`} />
          <div
            className="tour-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-title"
            style={
              tourCardPos
                ? { top: tourCardPos.top, left: tourCardPos.left }
                : { bottom: 24, right: 24, top: "auto", left: "auto" }
            }
          >
            <div className="tour-kicker">Highlighted section {tourStep + 1}/{TOUR_STEPS.length}</div>
            <h2 id="tour-title">{TOUR_STEPS[tourStep].title}</h2>
            <p>{TOUR_STEPS[tourStep].body}</p>
            <div className="tour-dots" aria-hidden="true">
              {TOUR_STEPS.map((_, i) => (
                <span className={i === tourStep ? "on" : ""} key={i} />
              ))}
            </div>
            <div className="tour-actions">
              <button className="btn btn-ghost" onClick={completeTour}>Skip</button>
              <div>
                {tourStep > 0 && (
                  <button className="btn btn-ghost" onClick={() => setTourStep((s) => Math.max(0, s - 1))}>Back</button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    if (tourStep >= TOUR_STEPS.length - 1) completeTour();
                    else setTourStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1));
                  }}
                >
                  {tourStep >= TOUR_STEPS.length - 1 ? "Done" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── TOAST STACK ───────────────────────────────────────────────── */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <span className="dot-ok" />
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
