"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isValidTimezone } from "@/lib/timezones";
import { TimezoneSelect } from "@/components/TimezoneSelect";

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 5,
  display: "block",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [goal, setGoal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from any existing profile; if already onboarded, skip straight to the dashboard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // ?edit=1 reuses this form as a "profile settings" screen (don't skip past it).
      const isEditing = new URLSearchParams(window.location.search).get("edit") === "1";
      setEditing(isEditing);

      // Best-effort browser timezone as a sensible default — always applied (worldwide),
      // as long as it's a real IANA zone. Previously this was gated to a US-only allowlist,
      // which silently dropped every non-US client's detected zone (Bug 2).
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz && isValidTimezone(tz)) setTimezone(tz);
      } catch {}

      const { data, error: err } = await supabase
        .from("profiles")
        .select("full_name,company,role,phone,timezone,primary_goal,onboarded,payment_verified")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      // Payment gate: don't let onboarding be reached by typing the URL
      // directly before paying. Editing an already-onboarded profile is
      // exempt (payment_verified is already true by then anyway).
      if (!isEditing && !err && data && !data.payment_verified) {
        router.replace("/payment");
        return;
      }

      if (!err && data) {
        if (data.onboarded && !isEditing) {
          router.replace("/dashboard");
          return;
        }
        if (data.full_name) setFullName(data.full_name);
        if (data.company) setCompany(data.company);
        if (data.role) setRole(data.role);
        if (data.phone) setPhone(data.phone);
        // profiles.timezone has a DB default (America/New_York) on every new row, so it is
        // only a real user choice once they've onboarded; before that keep the browser zone.
        if (data.timezone && data.onboarded) setTimezone(data.timezone);
        if (data.primary_goal) setGoal(data.primary_goal);
      }
      // Prefill name from the signup email if we have nothing else.
      if (!err && !data?.full_name && user.email) {
        setFullName((prev) => prev || "");
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router]);

  function digits(s: string) {
    return s.replace(/\D/g, "");
  }

  async function save() {
    setError(null);
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (digits(phone).length < 10) {
      setError("Please enter a valid mobile number (at least 10 digits, with country code).");
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError("Session expired — please sign in again.");
      return;
    }
    const { error: err } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName.trim(),
      company: company.trim() || null,
      role: role.trim() || null,
      phone: phone.trim(),
      timezone,
      primary_goal: goal.trim() || null,
      onboarded: true,
      updated_at: new Date().toISOString(),
    });
    if (err) {
      setSaving(false);
      // 42P01 = undefined_table (profiles not created yet); use the structured code, not a string match.
      setError(
        err.code === "42P01"
          ? "Profiles table not found yet. Run the WEB-02 Supabase setup, then try again."
          : err.message
      );
      return;
    }
    // Auto-provision the user (creates GHL contact + Airtable client row + links Supabase profile)
    // so the dashboard shows real data and the SMS automation can reach them — no manual Phase-0.
    // Await it so the dashboard loads already-provisioned; falls through gracefully on failure.
    try {
      await fetch("/api/provision", { method: "POST" });
    } catch {
      /* non-fatal: dashboard shows the "setting up" banner until provisioning succeeds */
    }
    // Sync editable profile fields into the coaching record (non-blocking).
    fetch("/api/profile-sync", { method: "POST" }).catch(() => {});
    setSaving(false);
    router.push("/dashboard");
  }

  return (
    <div className="auth-center">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        <h2 style={{ fontSize: 22, margin: "14px 0 2px" }}>
          {editing ? "Edit your profile" : "Set up your account"}
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>
          {editing
            ? "Changes here update your coaching profile and the SMS service."
            : "Tell us a little about you so your briefings and reminders are accurate."}
        </p>

        <div className="stack">
          <div>
            <label style={labelStyle}>Full name *</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Raj Sharma" />
          </div>

          <div>
            <label style={labelStyle}>Mobile number * (where we text your coaching)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 010 0000"
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Company</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Digital Dada" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Your role</label>
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="CEO" />
            </div>
          </div>

          <div>
            <TimezoneSelect
              value={timezone}
              onChange={setTimezone}
              label="Timezone"
              placeholder="Type to search… (e.g. New York, London)"
              disabled={saving}
            />
          </div>

          <div>
            <label style={labelStyle}>Your #1 priority right now (optional)</label>
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Close Q3 revenue target"
            />
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              padding: "9px 12px",
              borderRadius: 8,
              background: "#fef2f2",
              color: "#b91c1c",
              border: "1px solid #fecaca",
            }}
          >
            {error}
          </div>
        )}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 22 }}
          onClick={save}
          disabled={saving || !ready}
        >
          {saving ? "Saving…" : editing ? "Save changes →" : "Save & go to my dashboard →"}
        </button>
      </div>
    </div>
  );
}
