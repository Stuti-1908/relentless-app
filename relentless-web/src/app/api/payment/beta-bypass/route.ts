import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sameOriginOk } from "@/lib/csrf";

// Beta-tester bypass for the payment gate — added 2026-08-29 when the
// user reported existing/beta users getting stuck at /payment with no way
// through before real payment verification (Square, soon Stripe) is ready
// for production. Entering the correct code marks payment_verified=true the
// same way a real payment confirmation does (see api/payment/confirm), so
// downstream code doesn't need to know which path a user came through.
//
// The code lives in RELENTLESS_BETA_BYPASS_CODE (env var, not hardcoded) so
// it can be rotated without a redeploy. If the env var is unset, this route
// always rejects — fails closed, not open.
//
// This is explicitly a TEMPORARY testing mechanism, not a real access-control
// system: the code is a shared secret typed into a public-facing form, with
// no per-user tracking of who used it. Remove or disable this route once the
// product is out of the pre-launch testing phase.
function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: Request) {
  if (!sameOriginOk(req)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });

  // Session first, so an anonymous caller can't use this route to test codes.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  const expected = process.env.RELENTLESS_BETA_BYPASS_CODE;
  if (!expected) {
    return NextResponse.json({ ok: false, reason: "bypass_not_configured" }, { status: 503 });
  }

  let code = "";
  try {
    code = String((await req.json())?.code ?? "").trim();
  } catch {
    /* ignore */
  }
  if (!code || !sameCode(code, expected)) {
    console.warn("[api/payment/beta-bypass] wrong code", user.id);
    return NextResponse.json({ ok: false, reason: "invalid_code" }, { status: 403 });
  }

  // payment_verified is not writable from the user's own session (migration 014).
  const { error } = await createServiceClient()
    .from("profiles")
    .update({ payment_verified: true, payment_verified_at: new Date().toISOString(), subscription_status: "beta" })
    .eq("id", user.id);

  if (error) {
    console.error("[api/payment/beta-bypass] update failed", error.message);
    return NextResponse.json({ ok: false, reason: "db_error" }, { status: 502 });
  }
  console.log("[api/payment/beta-bypass] access granted", user.id);
  return NextResponse.json({ ok: true });
}
