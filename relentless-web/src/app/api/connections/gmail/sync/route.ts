import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

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

function decodeBase64(str: string): string {
  try {
    return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(payload: GmailPayload): string {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64(payload.body.data).slice(0, 500);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64(part.body.data).slice(0, 500);
      }
    }
  }
  return "";
}

type GmailPayload = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
};

type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: GmailPayload;
  internalDate?: string;
  labelIds?: string[];
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("gmail_refresh_token")
    .eq("id", user.id)
    .single();

  const refreshToken = (profile as Record<string, unknown> | null)?.gmail_refresh_token as string | null;
  if (!refreshToken) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(refreshToken);
  } catch {
    return NextResponse.json({ error: "Failed to refresh Gmail token" }, { status: 502 });
  }

  // Fetch unread messages from the last 24 hours
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const listRes = await fetch(
    `${GMAIL_URL}/messages?q=is:unread after:${since}&maxResults=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    return NextResponse.json({ error: "Gmail fetch failed" }, { status: 502 });
  }
  const listData = await listRes.json();
  const messageIds: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

  // Fetch each message's subject + snippet in parallel
  const messages = await Promise.all(
    messageIds.map(async (id) => {
      const msgRes = await fetch(
        `${GMAIL_URL}/messages/${id}?format=full&fields=id,snippet,payload,internalDate,labelIds`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!msgRes.ok) return null;
      const msg: GmailMessage = await msgRes.json();
      const headers = (msg.payload as { headers?: { name: string; value: string }[] } | undefined)?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "";
      const body = msg.payload ? extractBody(msg.payload) : (msg.snippet ?? "");
      return { id, subject, from, snippet: msg.snippet ?? "", body };
    })
  );

  const emails = messages.filter(Boolean) as { id: string; subject: string; from: string; snippet: string; body: string }[];

  // Store the email summary in the user's profile for the briefing to pick up
  const emailSummary = emails.map((e) => `From: ${e.from}\nSubject: ${e.subject}\n${e.snippet}`).join("\n---\n");
  await supabase
    .from("profiles")
    .update({ gmail_last_sync: new Date().toISOString(), gmail_unread_summary: emailSummary.slice(0, 2000) })
    .eq("id", user.id);

  return NextResponse.json({ synced: emails.length, emails: emails.map((e) => ({ subject: e.subject, from: e.from, snippet: e.snippet })) });
}
