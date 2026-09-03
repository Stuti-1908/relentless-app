"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Switched from Square to Stripe 2026-08-29/30. Uses a Stripe Payment Link
// (a fixed hosted checkout URL, created directly in the Stripe Dashboard --
// simpler than the dynamic Checkout Session approach originally built, no
// STRIPE_PRICE_ID/session-creation route needed). The signed-in user's id is
// passed via Stripe's own ?client_reference_id= URL param, the same field
// api/payment/stripe-webhook already reads to link a completed payment back
// to a Supabase user -- so verification is still REAL, server-to-server,
// via webhook signature (see stripe-webhook/route.ts), not redirect-trust
// like the old Square flow. See build/migration/010_stripe_payment_verification.sql.
const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/14AbJ1dyHfmbaq2aRx7Vm00";

export default function PaymentPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showBypass, setShowBypass] = useState(false);
  const [bypassCode, setBypassCode] = useState("");
  const [bypassBusy, setBypassBusy] = useState(false);
  const [bypassError, setBypassError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("payment_verified")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      // Already paid — skip straight past this gate (e.g. user hit back button).
      if (data?.payment_verified) {
        router.replace("/onboarding");
        return;
      }
      setUserId(user.id);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router]);

  function goToCheckout() {
    if (!userId) return;
    const url = `${STRIPE_PAYMENT_LINK}?client_reference_id=${encodeURIComponent(userId)}`;
    window.location.href = url;
  }

  async function submitBypass() {
    setBypassError(null);
    if (!bypassCode.trim()) {
      setBypassError("Enter the beta access code.");
      return;
    }
    setBypassBusy(true);
    try {
      const res = await fetch("/api/payment/beta-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: bypassCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setBypassError(
          data.reason === "invalid_code" ? "That code isn't valid." : "Something went wrong — try again."
        );
        setBypassBusy(false);
        return;
      }
      router.push("/onboarding");
    } catch {
      setBypassError("Something went wrong — try again.");
      setBypassBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="auth-center">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        <h2 style={{ fontSize: 22, margin: "14px 0 2px" }}>One step left</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>
          Relentless AI is a managed coaching subscription — $69/month, cancel anytime.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: "18px 20px",
            borderRadius: 12,
            background: "var(--gold-light)",
            border: "1px solid var(--line)",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Relentless AI — Executive Coaching
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 6 }}>
            $69<span style={{ fontSize: 16, fontWeight: 500, color: "var(--muted)" }}> / month</span>
          </div>
        </div>

        <button className="btn btn-primary btn-block" style={{ marginTop: 22 }} onClick={goToCheckout}>
          Continue to secure checkout →
        </button>

        <div className="hint" style={{ marginTop: 14 }}>
          You&apos;ll pay securely via Stripe, then come straight back here to finish setting up your
          account.
        </div>

        <div style={{ marginTop: 24, textAlign: "center" }}>
          {!showBypass ? (
            <a
              style={{ color: "var(--muted)", fontSize: 12, cursor: "pointer" }}
              onClick={() => setShowBypass(true)}
            >
              Have a beta access code?
            </a>
          ) : (
            <div className="stack" style={{ marginTop: 4 }}>
              <input
                value={bypassCode}
                onChange={(e) => setBypassCode(e.target.value)}
                placeholder="Beta access code"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !bypassBusy) submitBypass();
                }}
              />
              {bypassError && (
                <div
                  style={{
                    fontSize: 13,
                    padding: "9px 12px",
                    borderRadius: 8,
                    background: "#fef2f2",
                    color: "#b91c1c",
                    border: "1px solid #fecaca",
                  }}
                >
                  {bypassError}
                </div>
              )}
              <button className="btn btn-ghost btn-block" onClick={submitBypass} disabled={bypassBusy}>
                {bypassBusy ? "Checking…" : "Skip payment for now"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
