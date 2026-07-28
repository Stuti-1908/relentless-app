import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const CALENDAR_URL =
  process.env.GOOGLE_CALENDAR_URL || "https://www.googleapis.com/calendar/v3/calendars/primary/events";

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json();
  return data.access_token as string;
}

function toISO(dateTime: string | undefined): string | null {
  if (!dateTime) return null;
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("google_calendar_refresh_token, timezone")
    .eq("id", user.id)
    .single();

  if (!profile?.google_calendar_refresh_token) {
    return NextResponse.json({ error: "Calendar not connected" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(profile.google_calendar_refresh_token);
  } catch {
    return NextResponse.json({ error: "Failed to refresh token" }, { status: 502 });
  }

  // Resolve the user's timezone-aware day boundaries
  const now = new Date();
  const userTz = (profile as { timezone?: string; google_calendar_refresh_token: string }).timezone || "America/New_York";
  const todayStr = now.toLocaleDateString("sv-SE", { timeZone: userTz }); // "YYYY-MM-DD"

  // Build midnight-in-user-tz as UTC
  const dayStartLocal = new Date(`${todayStr}T00:00:00`);
  const dayEndLocal = new Date(`${todayStr}T00:00:00`);
  dayEndLocal.setDate(dayEndLocal.getDate() + 1);

  // Compute tz offset: diff between interpreting the same wall-clock in UTC vs the user's tz
  function wallClockOffset(d: Date, tz: string): number {
    const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
    return local.getTime() - utc.getTime();
  }
  const startOfDay = new Date(dayStartLocal.getTime() - wallClockOffset(dayStartLocal, userTz)).toISOString();
  const endOfDay = new Date(dayEndLocal.getTime() - wallClockOffset(dayEndLocal, userTz)).toISOString();

  const calRes = await fetch(
    `${CALENDAR_URL}?timeMin=${encodeURIComponent(startOfDay)}&timeMax=${encodeURIComponent(endOfDay)}&singleEvents=true&orderBy=startTime&maxResults=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!calRes.ok) {
    const body = await calRes.text();
    console.error("Google Calendar fetch failed:", calRes.status, body);
    return NextResponse.json({ error: "Calendar fetch failed" }, { status: 502 });
  }
  const calData = await calRes.json();
  const events: Array<{
    id: string;
    summary?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
  }> = calData.items || [];

  // Map to the meetings table schema. `scheduled_at` is the precise reminder timestamp;
  // `meet_time` also carries the ISO value so older workflows can still parse it.
  const rows = events.map((ev) => ({
    user_id: user.id,
    google_event_id: ev.id,
    title: ev.summary || "(No title)",
    meet_time: toISO(ev.start.dateTime),
    scheduled_at: toISO(ev.start.dateTime),
    // reminder_sent_at left null so the meeting-reminder workflow can still fire
    reminder_sent_at: null,
  }));

  // Delete only today's Google-sourced meetings for this user, then re-insert
  // (simpler than upsert when google_event_id column may not exist yet)
  const todayPrefix = startOfDay.slice(0, 10); // "YYYY-MM-DD"
  await supabase
    .from("meetings")
    .delete()
    .eq("user_id", user.id)
    .not("google_event_id", "is", null) // only delete Google-synced rows
    .gte("meet_time", startOfDay)
    .lt("meet_time", endOfDay);

  if (rows.length > 0) {
    const { error: insertErr } = await supabase.from("meetings").insert(rows);
    if (insertErr) {
      console.error("meetings insert error:", insertErr);
      return NextResponse.json({ error: `DB insert failed: ${insertErr.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: rows.length, date: todayPrefix });
}
