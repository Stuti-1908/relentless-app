"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Status = "active" | "calendar" | "gmail" | "soon";
type Integration = {
  key: string;
  name: string;
  icon: string;
  blurb: string;
  status: Status;
};

const INTEGRATIONS: Integration[] = [
  { key: "biometrics", name: "Recovery & Energy", icon: "❤️", status: "active",
    blurb: "Wearable (Whoop/Oura) or a 30-second manual check-in — calibrates your day to your real capacity." },
  { key: "news", name: "Market Intelligence", icon: "📡", status: "active",
    blurb: "One relevant market signal for your industry — only what matters, nothing else." },
  { key: "crm", name: "CRM (GoHighLevel)", icon: "📇", status: "active",
    blurb: "New leads, stalled deals, and who's gone quiet — surfaced in every morning briefing." },
  { key: "calendar", name: "Google Calendar", icon: "📅", status: "calendar",
    blurb: "Today's meetings, pulled and prepped with context — and your focus blocks protected." },
  { key: "email", name: "Gmail", icon: "✉️", status: "gmail",
    blurb: "Overnight messages scanned — only what actually needs a reply, summarized in your briefing." },
  { key: "slack", name: "Slack", icon: "💬", status: "soon",
    blurb: "Every thread you were tagged in, summarized in two lines." },
  { key: "sales", name: "Sales Dashboard", icon: "📊", status: "soon",
    blurb: "Yesterday's revenue, refunds, and anything that looks off." },
  { key: "linkedin", name: "LinkedIn", icon: "in", status: "soon",
    blurb: "Relevant activity and signals from your network, distilled into the briefing." },
];

export default function ConnectionsPage() {
  return (
    <Suspense>
      <ConnectionsInner />
    </Suspense>
  );
}

function ConnectionsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [calConnected, setCalConnected] = useState<boolean | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailMsg, setGmailMsg] = useState<string | null>(null);

  useEffect(() => {
    async function checkConnections() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("google_calendar_refresh_token, gmail_refresh_token")
        .eq("id", user.id)
        .single();
      setCalConnected(!!data?.google_calendar_refresh_token);
      setGmailConnected(!!(data as Record<string, unknown>)?.gmail_refresh_token);
    }
    checkConnections();
  }, []);

  // After OAuth redirect back with ?calendar=connecting, trigger a sync
  useEffect(() => {
    if (searchParams.get("calendar") === "connecting" && calConnected) {
      handleSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calConnected]);

  // After Gmail OAuth redirect back with ?gmail=connecting, trigger a sync
  useEffect(() => {
    if (searchParams.get("gmail") === "connecting" && gmailConnected) {
      handleGmailSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gmailConnected]);

  async function handleConnect() {
    setCalLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: `${window.location.origin}/auth/callback?next=/connections?calendar=connecting`,
      },
    });
  }

  async function handleDisconnect() {
    setCalLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from("profiles")
        .update({ google_calendar_refresh_token: null, google_calendar_connected_at: null })
        .eq("id", user.id);
    }
    setCalConnected(false);
    setCalLoading(false);
    setSyncMsg(null);
  }

  async function handleSync() {
    setSyncMsg("Syncing…");
    try {
      const res = await fetch("/api/connections/google-calendar/sync");
      const data = await res.json();
      if (res.ok) setSyncMsg(`✓ Synced ${data.synced} event${data.synced !== 1 ? "s" : ""} for today`);
      else setSyncMsg(`Sync error: ${data.error}`);
    } catch {
      setSyncMsg("Sync failed — try again");
    }
    setCalLoading(false);
  }

  async function handleGmailConnect() {
    setGmailLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: `${window.location.origin}/auth/callback?next=/connections?gmail=connecting`,
      },
    });
  }

  async function handleGmailDisconnect() {
    setGmailLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ gmail_refresh_token: null, gmail_connected_at: null }).eq("id", user.id);
    }
    setGmailConnected(false);
    setGmailLoading(false);
    setGmailMsg(null);
  }

  async function handleGmailSync() {
    setGmailMsg("Syncing…");
    try {
      const res = await fetch("/api/connections/gmail/sync");
      const data = await res.json();
      if (res.ok) setGmailMsg(`✓ Synced ${data.synced} email${data.synced !== 1 ? "s" : ""} into your briefing`);
      else setGmailMsg(`Sync error: ${data.error}`);
    } catch {
      setGmailMsg("Sync failed — try again");
    }
    setGmailLoading(false);
  }

  const activeCount = INTEGRATIONS.filter((i) => i.status === "active").length + (calConnected ? 1 : 0) + (gmailConnected ? 1 : 0);

  return (
    <div className="conn-wrap">
      <div className="conn-top">
        <button className="conn-back" onClick={() => router.push("/dashboard")}>← Dashboard</button>
        <span className="diag-eyebrow">Connections</span>
      </div>

      <div className="conn-head">
        <h1>One briefing. <span className="hl">Built once.</span> Delivered every morning.</h1>
        <p>
          Connect the apps you start your day in. Relentless folds them into a single morning briefing —
          so you stop switching between six tabs to find out what happened while you slept.
        </p>
        <div className="conn-progress">
          <b>{activeCount} of {INTEGRATIONS.length}</b> sources live · the rest are rolling out — join the
          waitlist to get them first.
        </div>
      </div>

      <div className="conn-grid">
        {INTEGRATIONS.map((it) => {
          if (it.status === "calendar") {
            const connected = calConnected === true;
            const checking = calConnected === null;
            return (
              <div className={`conn-card ${connected ? "active" : "soon"}`} key={it.key}>
                <div className="conn-card-top">
                  <span className="conn-icon">{it.icon}</span>
                  <span className={`conn-status ${connected ? "active" : "soon"}`}>
                    {checking ? "…" : connected ? "● Active" : "Ready to connect"}
                  </span>
                </div>
                <h3>{it.name}</h3>
                <p>{it.blurb}</p>
                {connected ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <button className="btn btn-ghost btn-block" disabled style={{ opacity: 0.9 }}>
                      ✓ Connected
                    </button>
                    <button
                      className="btn btn-ghost btn-block"
                      onClick={handleSync}
                      disabled={calLoading}
                      style={{ fontSize: "0.85rem" }}
                    >
                      {calLoading ? "Syncing…" : "↻ Sync now"}
                    </button>
                    {syncMsg && <p style={{ fontSize: "0.8rem", opacity: 0.7, margin: 0 }}>{syncMsg}</p>}
                    <button
                      className="btn btn-ghost btn-block conn-soon-btn"
                      onClick={handleDisconnect}
                      disabled={calLoading}
                      style={{ fontSize: "0.8rem", opacity: 0.6 }}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary btn-block"
                    onClick={handleConnect}
                    disabled={calLoading || checking}
                  >
                    {calLoading ? "Connecting…" : "Connect Google Calendar"}
                  </button>
                )}
              </div>
            );
          }

          if (it.status === "gmail") {
            const connected = gmailConnected === true;
            const checking = gmailConnected === null;
            return (
              <div className={`conn-card ${connected ? "active" : "soon"}`} key={it.key}>
                <div className="conn-card-top">
                  <span className="conn-icon">{it.icon}</span>
                  <span className={`conn-status ${connected ? "active" : "soon"}`}>
                    {checking ? "…" : connected ? "● Active" : "Ready to connect"}
                  </span>
                </div>
                <h3>{it.name}</h3>
                <p>{it.blurb}</p>
                {connected ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <button className="btn btn-ghost btn-block" disabled style={{ opacity: 0.9 }}>
                      ✓ Connected
                    </button>
                    <button
                      className="btn btn-ghost btn-block"
                      onClick={handleGmailSync}
                      disabled={gmailLoading}
                      style={{ fontSize: "0.85rem" }}
                    >
                      {gmailLoading ? "Syncing…" : "↻ Sync now"}
                    </button>
                    {gmailMsg && <p style={{ fontSize: "0.8rem", opacity: 0.7, margin: 0 }}>{gmailMsg}</p>}
                    <button
                      className="btn btn-ghost btn-block conn-soon-btn"
                      onClick={handleGmailDisconnect}
                      disabled={gmailLoading}
                      style={{ fontSize: "0.8rem", opacity: 0.6 }}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary btn-block"
                    onClick={handleGmailConnect}
                    disabled={gmailLoading || checking}
                  >
                    {gmailLoading ? "Connecting…" : "Connect Gmail"}
                  </button>
                )}
              </div>
            );
          }

          if (it.status === "active") {
            return (
              <div className="conn-card active" key={it.key}>
                <div className="conn-card-top">
                  <span className="conn-icon">{it.icon}</span>
                  <span className="conn-status active">● Active</span>
                </div>
                <h3>{it.name}</h3>
                <p>{it.blurb}</p>
                <button className="btn btn-ghost btn-block" disabled style={{ opacity: 0.9 }}>
                  ✓ Connected
                </button>
              </div>
            );
          }

          return (
            <div className="conn-card soon" key={it.key}>
              <div className="conn-card-top">
                <span className="conn-icon">{it.icon}</span>
                <span className="conn-status soon">Coming soon</span>
              </div>
              <h3>{it.name}</h3>
              <p>{it.blurb}</p>
              <button
                className="btn btn-ghost btn-block conn-soon-btn"
                onClick={() => alert(`${it.name} integration is coming soon — you're on the early list.`)}
              >
                Join the waitlist
              </button>
            </div>
          );
        })}
      </div>

      <p className="footer-note">
        Each connection is private to your account and used only to build your briefing. You can disconnect
        any source anytime once it&apos;s live.
      </p>
    </div>
  );
}
