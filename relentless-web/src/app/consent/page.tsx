"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ConsentPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [reachedEnd, setReachedEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  // If this user already consented before, skip straight into the app.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.user_metadata?.consented_at) {
        // Already consented — let onboarding decide (it forwards to /dashboard if complete).
        router.replace("/onboarding");
      }
    });
  }, [router, supabase]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReachedEnd(true);
  }

  async function agreeAndContinue() {
    setSaving(true);
    // Persist consent on the user's profile so we never ask twice.
    await supabase.auth.updateUser({
      data: { consented_at: new Date().toISOString(), policy_version: "draft-2026-06" },
    });
    router.push("/onboarding");
  }

  return (
    <div className="auth-center">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        <h2 style={{ fontSize: 20, margin: "14px 0 4px" }}>Privacy Policy &amp; Consent</h2>
        <div className="draftbar">⚠ DRAFT policy for preview — final text pending legal review.</div>

        <div className="policy" onScroll={onScroll}>
          <p>Relentless AI provides an AI executive-coaching managed service. This policy explains what we collect and how we use it.</p>
          <h4>1. Data we collect</h4>
          <p>Biometric summaries (recovery, HRV, sleep) from your wearable or manual check-ins; your business priorities and tasks; calendar/meeting times you enter; daily scores and briefings we generate for you.</p>
          <h4>2. How we use it</h4>
          <p>To generate your morning briefing, daily Executive Score, nudges, and reminders. We never sell your data.</p>
          <h4>3. Biometric &amp; consent</h4>
          <p>We only pull biometric data after explicit consent. You may withdraw consent at any time.</p>
          <h4>4. Messaging</h4>
          <p>We send time-critical reminders by SMS (meeting reminders, missed-task nudges). Standard message rates may apply. Reply STOP to opt out.</p>
          <h4>5. Retention &amp; deletion</h4>
          <p>Daily scores 24 months; briefings 90 days; biometric summaries 12 months. On cancellation we delete your data and confirm in writing within 5 business days.</p>
          <h4>6. Your rights</h4>
          <p>Access, correct, or delete your data at any time by contacting support.</p>
          <h4>7. Jurisdiction</h4>
          <p>Governed by the laws of the State of Florida, USA.</p>
          <p style={{ color: "var(--green)", fontWeight: 600, marginTop: 18 }}>
            — You&apos;ve reached the end. You can now agree below. —
          </p>
        </div>

        <label className="agree-row">
          <input
            type="checkbox"
            disabled={!reachedEnd}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span style={{ color: reachedEnd ? "var(--ink)" : "var(--muted)" }}>
            {reachedEnd
              ? "I agree to the Terms & Privacy Policy."
              : "Scroll to the bottom to enable — then tick to agree to the Terms & Privacy Policy."}
          </span>
        </label>

        <button
          className="btn btn-primary btn-block"
          disabled={!agreed || saving}
          onClick={agreeAndContinue}
        >
          {saving ? "Saving…" : "Agree & continue"}
        </button>
      </div>
    </div>
  );
}
