// Notification categories a client can switch on/off from Settings. The keys are the contract
// with the n8n workflows (build/n8n/_audit_20261024/patch7.py reads the same names out of
// v_clients.notification_prefs). A key that is missing from the stored object means ON.
export const NOTIFICATION_CATEGORIES = [
  { key: "morning_checkin", title: "Morning check-in", blurb: "The quick sleep / energy / stress question that opens your day." },
  { key: "morning_briefing", title: "Morning briefing", blurb: "Your plan for the day: priorities, meetings and what to protect." },
  { key: "meeting_reminders", title: "Meeting reminders", blurb: "A heads-up a few minutes before each meeting on your calendar." },
  { key: "task_reminders", title: "Recurring task reminders", blurb: "Your alarm-style daily, weekly and monthly reminders." },
  { key: "nudges", title: "Nudges", blurb: "Short in-the-day pushes when something needs your attention." },
  { key: "evening_score", title: "Evening Executive Score", blurb: "Your end-of-day score and review." },
  { key: "weekly", title: "Weekly check-in & plan", blurb: "The weekly business check-in, weekly plan and synthesis." },
  { key: "monthly_report", title: "Monthly report", blurb: "Your month-in-review report." },
  { key: "onboarding", title: "7-day onboarding series", blurb: "The short welcome lessons in your first week." },
] as const;

export type NotificationKey = (typeof NOTIFICATION_CATEGORIES)[number]["key"];
export type NotificationPrefs = { paused?: boolean } & Partial<Record<NotificationKey, boolean>>;

const ALLOWED = new Set<string>(["paused", ...NOTIFICATION_CATEGORIES.map((c) => c.key)]);

// Keeps only allow-listed keys with boolean values; anything else is dropped.
export function sanitizePrefs(input: unknown): NotificationPrefs {
  const out: Record<string, boolean> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (ALLOWED.has(k) && typeof v === "boolean") out[k] = v;
    }
  }
  return out as NotificationPrefs;
}
