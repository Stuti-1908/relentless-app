"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The fixed $69/month Square Payment Link (see build/migration/009_payment_gate.sql
// for the schema this gates). Square Payment Links accept a redirect_url query
// param sent to the buyer's browser after checkout completes; we point it at
// /payment/confirm so we know which signed-in user just came back from paying.
//
// KNOWN GAP (2026-08-17, explicit user decision -- see conversation): this is
// redirect-trust only, NOT verified against Square's API. Anyone who lands on
// /payment/confirm with a session is marked paid, whether or not a real
// payment happened -- e.g. by bookmarking or guessing the URL. Square API
// verification (checking a real order/payment ID server-side) should replace
// this once a Square access token is available. Do not remove this comment
// when that hardening lands -- replace it with what changed.
const SQUARE_PAYMENT_LINK = "https://square.link/u/krl5xmYt";

export default function PaymentPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
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
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router]);

  function goToCheckout() {
    const redirectUrl = `${window.location.origin}/payment/confirm`;
    const url = `${SQUARE_PAYMENT_LINK}?redirect_url=${encodeURIComponent(redirectUrl)}`;
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
          You&apos;ll pay via Square, then come straight back here to finish setting up your account.
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
