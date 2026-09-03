import { NextResponse } from "next/server";

// *** DEPRECATED 2026-08-29/30 — replaced by real Stripe webhook verification.
// This was the Square-era redirect-trust confirm route: any authenticated
// user hitting this URL got payment_verified=true, no real payment check
// (an explicit, accepted gap at the time — see the payment gate's original
// 2026-08-17 rollout). Nothing in the app calls this anymore. /payment/
// page.tsx now sends the user to a fixed Stripe Payment Link (with
// ?client_reference_id=<user id>), and /payment/confirm/page.tsx polls for
// payment_verified, which is set by api/payment/stripe-webhook after
// verifying Stripe's webhook signature server-to-server — a real proof of
// payment, not a trusted redirect. Kept as a 410 stub (not deleted) only so
// the URL fails loudly and traceably if anything external still points at
// it, rather than 404ing silently.
export async function POST() {
  return NextResponse.json(
    { ok: false, reason: "deprecated_use_stripe_webhook" },
    { status: 410 }
  );
}
