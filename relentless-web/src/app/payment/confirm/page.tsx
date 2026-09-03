"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Landing point after Stripe Payment Link checkout completes (see
// /payment/page.tsx for how the Payment Link URL, with
// ?client_reference_id=<user id>, is built).
//
// Unlike the old Square flow, this page does NOT itself mark the user paid
// — that happens server-to-server via api/payment/stripe-webhook when
// Stripe sends checkout.session.completed, verified by webhook signature.
// This page just POLLS profiles.payment_verified for a few seconds, since
// the webhook delivery can arrive slightly after the browser redirect
// (typically well under a second, but not guaranteed instant). If it
// doesn't land within the poll window, this is a genuine "something's
// wrong" state worth surfacing, not something to paper over by marking the
// user paid anyway — that would recreate the exact redirect-trust gap this
// Stripe migration exists to close.
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 8; // ~12 seconds total

export default function PaymentConfirmPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<"checking" | "error">("checking");

  useEffect(() => {
    let cancelled = false;
    let pollCount = 0;

    async function poll() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) router.replace("/login");
        return;
      }

      const { data } = await supabase
        .from("profiles")
        .select("payment_verified")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (data?.payment_verified) {
        router.replace("/onboarding");
        return;
      }

      pollCount += 1;
      if (pollCount >= MAX_POLLS) {
        setStatus("error");
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [supabase, router]);

  return (
    <div className="auth-center">
      <div className="auth-card" style={{ maxWidth: 480, textAlign: "center" }}>
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        {status === "checking" ? (
          <>
            <h2 style={{ fontSize: 20, margin: "14px 0 2px" }}>Confirming your payment…</h2>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>One moment — setting up your account.</p>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 20, margin: "14px 0 2px" }}>Still confirming</h2>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              Your payment may still be processing. If you were just charged and this doesn&apos;t
              resolve in a minute, contact support — we&apos;ll get you set up.
            </p>
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 16 }}
              onClick={() => router.push("/payment")}
            >
              Back to payment
            </button>
          </>
        )}
      </div>
    </div>
  );
}
