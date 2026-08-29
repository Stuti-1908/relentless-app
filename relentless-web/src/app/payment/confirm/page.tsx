"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Landing point for Square's redirect_url after checkout (see /payment/page.tsx
// for how that URL is built, and api/payment/confirm/route.ts for the KNOWN GAP
// note — this whole page trusts the redirect, no Square API verification yet).
export default function PaymentConfirmPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<"checking" | "error">("checking");

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
      try {
        const res = await fetch("/api/payment/confirm", { method: "POST" });
        if (!res.ok) throw new Error("confirm failed");
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }
      if (!cancelled) router.replace("/onboarding");
    })();
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
            <h2 style={{ fontSize: 20, margin: "14px 0 2px" }}>Something went wrong</h2>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              We couldn&apos;t confirm your account. If you were just charged, contact support —
              we&apos;ll get you set up.
            </p>
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 16 }}
              onClick={() => router.push("/payment")}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
