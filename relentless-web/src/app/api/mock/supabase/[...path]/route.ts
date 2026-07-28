import { NextResponse } from "next/server";
import { db, resetDb } from "../../db";

// Handle catch-all requests to mock Supabase Auth & Database
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  const { searchParams } = new URL(req.url);

  // 1. Reset endpoint for testing convenience
  if (path[0] === "reset") {
    resetDb();
    return NextResponse.json({ ok: true });
  }

  // 2. AUTH Endpoints
  if (path[0] === "auth") {
    const authAction = path[2]; // e.g. auth/v1/user or auth/v1/authorize

    if (authAction === "user") {
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      const user = db.users.find((u) => u.id === token || u.email === token);
      if (!user) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      return NextResponse.json(user);
    }

    if (authAction === "authorize") {
      // OAuth flow redirect back
      const redirectUrl = searchParams.get("redirect_to") || "";
      if (!redirectUrl) {
        return NextResponse.json({ error: "Missing redirect_to" }, { status: 400 });
      }
      const u = new URL(redirectUrl);
      u.searchParams.set("code", "mock-oauth-code");
      return NextResponse.redirect(u.toString());
    }
  }

  // 3. REST (Database) Endpoints
  if (path[0] === "rest") {
    const table = path[2]; // e.g. rest/v1/profiles
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    // Default fallback user if token is empty or doesn't match
    const user = db.users.find((u) => u.id === token || u.email === token) || db.users[0];
    const userId = user.id;

    const accept = req.headers.get("accept") || "";
    const preferSingle = accept.includes("vnd.pgrst.object");

    if (table === "profiles") {
      const idParam = searchParams.get("id");
      const eqId = idParam?.startsWith("eq.") ? idParam.substring(3) : null;
      
      const filtered = eqId 
        ? db.profiles.filter((p) => p.id === eqId)
        : db.profiles.filter((p) => p.id === userId);
      return NextResponse.json(preferSingle ? (filtered[0] || null) : filtered);
    }

    if (table === "tasks") {
      const filtered = db.tasks.filter((t) => t.user_id === userId);
      return NextResponse.json(preferSingle ? (filtered[0] || null) : filtered);
    }

    if (table === "meetings") {
      const filtered = db.meetings.filter((m) => m.user_id === userId);
      return NextResponse.json(preferSingle ? (filtered[0] || null) : filtered);
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  if (path[0] === "auth") {
    const authAction = path[2]; // e.g. auth/v1/signup or auth/v1/token

    if (authAction === "signup") {
      const body = await req.json();
      const email = body.email;
      const metadata = body.options?.data || {};

      if (db.users.some((u) => u.email === email)) {
        return NextResponse.json({ error: "User already exists" }, { status: 400 });
      }

      const id = "user-uuid-" + Math.random().toString(36).substring(2, 10);
      const user = { id, email, user_metadata: metadata };
      db.users.push(user);

      // Create a profile for the user
      db.profiles.push({
        id,
        full_name: "",
        company: "",
        role: "",
        phone: "",
        timezone: "America/New_York",
        primary_goal: "",
        onboarded: false,
        client_id: null,
        airtable_base_id: null,
        ghl_contact_id: null,
        plan: "standard",
        google_calendar_refresh_token: null,
        google_calendar_connected_at: null,
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({
        access_token: id,
        refresh_token: "mock-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    }

    if (authAction === "token") {
      // Could be password login or PKCE token exchange
      let body: Record<string, string> = {};
      try {
        body = await req.json();
      } catch {
        // Read URL encoded body if JSON fails
      }
 
      // Check if it's PKCE exchange code or credentials
      const email = body.email || "user@test.com";
      let user = db.users.find((u) => u.email === email);
      if (!user) {
        // Create user on-the-fly for tests if not exists
        const id = "user-uuid-" + Math.random().toString(36).substring(2, 10);
        user = { id, email, user_metadata: { consented_at: "2026-06-27T10:00:00Z" } };
        db.users.push(user);
        db.profiles.push({
          id,
          full_name: "Test User",
          company: "",
          role: "",
          phone: "+15551234567",
          timezone: "America/New_York",
          primary_goal: "",
          onboarded: true,
          client_id: "client_test",
          airtable_base_id: "appjnWxg9sB3PV7Da",
          ghl_contact_id: "ghl_contact_9999",
          plan: "pro",
          google_calendar_refresh_token: null,
          google_calendar_connected_at: null,
          updated_at: new Date().toISOString(),
        });
      }

      return NextResponse.json({
        access_token: user.id,
        refresh_token: "mock-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user,
        provider_refresh_token: "mock_google_refresh_token",
      });
    }

    if (authAction === "logout") {
      return NextResponse.json({});
    }
  }

  if (path[0] === "rest") {
    const table = path[2];
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const user = db.users.find((u) => u.id === token || u.email === token) || db.users[0];
    const userId = user.id;

    const body = await req.json();

    if (table === "profiles") {
      // TC-07: Profiles table doesn't exist error simulation
      if (body.phone === "5551234567" && body.full_name === "Jane Doe" && !body.id) {
        // Wait, if it doesn't have an ID, or if we check name
        return NextResponse.json(
          { code: "42P01", message: "relation \"profiles\" does not exist" },
          { status: 400 }
        );
      }
      // Onboarding profile error check: if name contains Error42P01 or phone matches the TC-07 phone
      if (body.phone === "5551234567" || (body.full_name && body.full_name.includes("Error42P01"))) {
        return NextResponse.json(
          { code: "42P01", message: "relation \"profiles\" does not exist" },
          { status: 400 }
        );
      }

      // Upsert profile
      const data = Array.isArray(body) ? body[0] : body;
      const profileId = data.id || userId;
      let profile = db.profiles.find((p) => p.id === profileId);
      if (!profile) {
        profile = {
          id: profileId,
          full_name: "",
          company: "",
          role: "",
          phone: "",
          timezone: "America/New_York",
          primary_goal: "",
          onboarded: false,
          client_id: null,
          airtable_base_id: null,
          ghl_contact_id: null,
          plan: "standard",
          google_calendar_refresh_token: null,
          google_calendar_connected_at: null,
          updated_at: new Date().toISOString(),
        };
        db.profiles.push(profile);
      }

      // Update fields
      Object.assign(profile, data, { updated_at: new Date().toISOString() });
      return NextResponse.json([profile]);
    }

    if (table === "tasks") {
      const tasksToInsert = Array.isArray(body) ? body : [body];
      const inserted = tasksToInsert.map((t) => {
        const newTask = {
          id: "task-uuid-" + Math.random().toString(36).substring(2, 10),
          user_id: t.user_id || userId,
          title: t.title,
          priority: t.priority || "med",
          meta: t.meta || "",
          due_date: t.due_date || null,
          done: t.done || false,
          ghl_task_id: t.ghl_task_id || null,
          created_at: new Date().toISOString(),
        };
        db.tasks.push(newTask);
        return newTask;
      });
      return NextResponse.json(Array.isArray(body) ? inserted : inserted[0]);
    }

    if (table === "meetings") {
      const meetingsToInsert = Array.isArray(body) ? body : [body];
      const inserted = meetingsToInsert.map((m) => {
        const newMeeting = {
          id: "meet-uuid-" + Math.random().toString(36).substring(2, 10),
          user_id: m.user_id || userId,
          title: m.title,
          meet_time: m.meet_time || null,
          scheduled_at: m.scheduled_at || null,
          google_event_id: m.google_event_id || null,
          reminder_sent_at: m.reminder_sent_at || null,
        };
        db.meetings.push(newMeeting);
        return newMeeting;
      });
      return NextResponse.json(Array.isArray(body) ? inserted : inserted[0]);
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  const { searchParams } = new URL(req.url);

  if (path[0] === "rest") {
    const table = path[2];
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const user = db.users.find((u) => u.id === token || u.email === token) || db.users[0];
    const userId = user.id;

    const body = await req.json();

    if (table === "profiles") {
      const idParam = searchParams.get("id");
      const eqId = idParam?.startsWith("eq.") ? idParam.substring(3) : userId;

      const profile = db.profiles.find((p) => p.id === eqId);
      if (profile) {
        Object.assign(profile, body, { updated_at: new Date().toISOString() });
        return NextResponse.json([profile]);
      }
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (table === "tasks") {
      const idParam = searchParams.get("id");
      const eqId = idParam?.startsWith("eq.") ? idParam.substring(3) : null;

      const task = db.tasks.find((t) => t.id === eqId);
      if (task) {
        Object.assign(task, body);
        return NextResponse.json([task]);
      }
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  const { searchParams } = new URL(req.url);

  if (path[0] === "rest") {
    const table = path[2];
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const user = db.users.find((u) => u.id === token || u.email === token) || db.users[0];
    const userId = user.id;

    if (table === "tasks") {
      const idParam = searchParams.get("id");
      const eqId = idParam?.startsWith("eq.") ? idParam.substring(3) : null;

      const idx = db.tasks.findIndex((t) => t.id === eqId);
      if (idx !== -1) {
        db.tasks.splice(idx, 1);
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (table === "meetings") {
      const userIdParam = searchParams.get("user_id");
      const eqUserId = userIdParam?.startsWith("eq.") ? userIdParam.substring(3) : userId;
      const googleEventParam = searchParams.get("google_event_id");

      if (googleEventParam === "not.is.null") {
        db.meetings = db.meetings.filter(
          (m) => !(m.user_id === eqUserId && m.google_event_id !== null)
        );
      } else {
        db.meetings = db.meetings.filter((m) => m.user_id !== eqUserId);
      }
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;

  if (path[0] === "auth") {
    const authAction = path[2];

    if (authAction === "user") {
      // updateUser API call
      const authHeader = req.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "").trim();
      const user = db.users.find((u) => u.id === token || u.email === token);
      if (!user) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      const body = await req.json();
      if (body.data) {
        user.user_metadata = { ...user.user_metadata, ...body.data };
      }
      return NextResponse.json({ user });
    }
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}
