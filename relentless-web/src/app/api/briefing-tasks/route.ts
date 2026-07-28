import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Machine-to-machine read endpoint for the n8n morning-briefing workflow (briefBuilder1).
// Given a client_id, returns that client's OPEN to-do list ranked exactly like the dashboard
// (daily-recurring pinned first, then by closeness to today, priority HIGH->MED->LOW within a
// date), plus a compact plain-text summary the Claude prompt can drop straight in.
//
// Auth: a shared secret in the `x-briefing-secret` header (only n8n knows it). Uses the Supabase
// service-role key to read across users, so it MUST stay server-side and secret-gated.

type Prio = "high" | "med" | "low";
type TaskRow = {
  title: string;
  priority: Prio | null;
  due_date: string | null;
  done: boolean;
  repeat_rule: string | null;
  repeat_days: number[] | null;
};

function localISODate(d: Date, tz: string): string {
  // format YYYY-MM-DD in the client's own timezone
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function isRelevantToday(t: TaskRow, todayISO: string, dow: number, dom: number): boolean {
  const rule = t.repeat_rule || "none";
  if (rule === "none") return t.due_date === todayISO;
  if (rule === "daily") return true;
  if (rule === "weekly") return (t.repeat_days || []).includes(dow);
  if (rule === "monthly") return (t.repeat_days || []).includes(dom);
  return false;
}

function daysFromToday(iso: string, todayISO: string): number {
  const a = new Date(todayISO + "T00:00:00");
  const b = new Date(iso + "T00:00:00");
  return Math.abs(Math.round((b.getTime() - a.getTime()) / 86400000));
}

function taskDistance(t: TaskRow, todayISO: string, dow: number, dom: number): number {
  const rule = t.repeat_rule || "none";
  if (rule === "daily") return -1;
  if (rule === "none") return t.due_date ? daysFromToday(t.due_date, todayISO) : 1e9;
  return isRelevantToday(t, todayISO, dow, dom) ? 0 : 1e9;
}

export async function GET(request: Request) {
  const secret = process.env.BRIEFING_TASKS_SECRET;
  if (!secret || request.headers.get("x-briefing-secret") !== secret) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const clientId = (url.searchParams.get("client_id") || "").trim();
  if (!clientId) {
    return NextResponse.json({ ok: false, reason: "no_client_id" }, { status: 400 });
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 500 });
  }
  const sb = createClient(supaUrl, serviceKey, { auth: { persistSession: false } });

  // client_id -> user_id. (Timezone lives in Airtable, not the Supabase profiles table, so n8n
  // passes it as a ?tz= param; we only need the user id here.)
  const { data: prof, error: profErr } = await sb
    .from("profiles")
    .select("id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (profErr) {
    return NextResponse.json({ ok: false, reason: "profile_lookup_failed" }, { status: 502 });
  }
  if (!prof?.id) {
    // No linked dashboard user — return an empty (but successful) result so the briefing degrades gracefully.
    return NextResponse.json({ ok: true, count: 0, summary: "", tasks: [] });
  }

  // Timezone from the caller (n8n knows it from Airtable); default to US Eastern.
  const tz = (url.searchParams.get("tz") || "America/New_York").trim() || "America/New_York";

  const { data: rows, error: taskErr } = await sb
    .from("tasks")
    .select("title, priority, due_date, done, repeat_rule, repeat_days")
    .eq("user_id", prof.id)
    .eq("done", false);
  if (taskErr) {
    return NextResponse.json({ ok: false, reason: "task_lookup_failed" }, { status: 502 });
  }

  const now = new Date();
  const todayISO = localISODate(now, tz);
  // day-of-week / day-of-month in the client's timezone
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const dow = localNow.getDay();
  const dom = localNow.getDate();

  const rank: Record<string, number> = { high: 0, med: 1, low: 2 };
  const tasks = ((rows || []) as TaskRow[])
    .slice()
    .sort((a, b) => {
      const da = taskDistance(a, todayISO, dow, dom);
      const db = taskDistance(b, todayISO, dow, dom);
      if (da !== db) return da - db;
      return (rank[a.priority || "low"] ?? 3) - (rank[b.priority || "low"] ?? 3);
    });

  // Only surface what matters for a morning briefing: today's + overdue + daily. Skip far-future
  // and off-day recurring tasks so the prompt stays tight.
  const relevant = tasks.filter((t) => {
    const d = taskDistance(t, todayISO, dow, dom);
    return d <= 0 || (t.repeat_rule || "none") === "none"; // daily(-1), today(0), or any dated task
  });

  const PRIO_LABEL: Record<string, string> = { high: "HIGH", med: "MED", low: "LOW" };
  const line = (t: TaskRow) => {
    const rule = t.repeat_rule || "none";
    const when =
      rule === "daily"
        ? "daily"
        : t.due_date === todayISO
          ? "today"
          : t.due_date
            ? (t.due_date < todayISO ? "overdue " : "due ") + t.due_date
            : "recurring";
    return `${PRIO_LABEL[t.priority || "low"] || "LOW"} ${t.title} (${when})`;
  };

  const summary = relevant.length
    ? relevant.slice(0, 8).map(line).join("; ")
    : "";

  return NextResponse.json({
    ok: true,
    count: relevant.length,
    todayISO,
    summary,
    tasks: relevant.slice(0, 12).map((t) => ({
      title: t.title,
      priority: t.priority,
      due_date: t.due_date,
      repeat_rule: t.repeat_rule || "none",
    })),
  });
}
