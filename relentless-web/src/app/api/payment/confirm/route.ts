import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOriginOk } from "@/lib/csrf";

// Marks the signed-in user's profile as payment_verified after they return
// from the Square Payment Link checkout.
//
// *** KNOWN GAP, explicit and accepted 2026-08-17 (see PaymentPage.tsx for
// the full note) — this is REDIRECT-TRUST ONLY. There is no Square API call
// here confirming a real payment/order exists. Any authenticated user who
// reaches this endpoint gets payment_verified=true, whether or not they
// actually paid. This was a deliberate scope decision to ship the flow today
// without a Square API access token; treat this as a stopgap, not a real
// paywall, until real verification (Square Orders/Payments API, checking a
// checkoutId/orderId query param against Square's servers) replaces it. ***
//
// sameOriginOk still applies — this at least prevents a third-party site
// from silently marking a user paid via a cross-origin POST, though it does
// nothing to stop the user themselves from just visiting this URL directly.
export async function POST(req: Request) {
  if (!sameOriginOk(req)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  const { error } = await supabase
    .from("profiles")
    .update({ payment_verified: true, payment_verified_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    console.error("[api/payment/confirm] update failed", error.message);
    return NextResponse.json({ ok: false, reason: "db_error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
