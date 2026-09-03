import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

// REAL server-side payment verification, replacing the old Square flow's
// known accepted gap (redirect-trust only, api/payment/confirm just
// believed whoever hit the URL). Stripe calls this endpoint directly,
// server-to-server, when a checkout event happens — the signature check
// below proves the request genuinely came from Stripe, not a user
// pretending to have paid by guessing/bookmarking a URL.
//
// Configure this URL as a webhook endpoint in the Stripe Dashboard
// (Developers -> Webhooks -> Add endpoint): https://<your-domain>/api/payment/stripe-webhook
// listening for `checkout.session.completed`. Set the endpoint's signing
// secret as STRIPE_WEBHOOK_SECRET in env — required for signature
// verification below; without it this route rejects every request.
//
// Uses the service-role Supabase client (not the session-bound one) since
// Stripe's request carries no user session/cookie — the user is identified
// via client_reference_id, which /payment/page.tsx sets to the signed-in
// Supabase auth user id via the Payment Link's ?client_reference_id= param.
export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[api/payment/stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ ok: false, reason: "missing_signature" }, { status: 400 });

  // Signature verification needs the RAW body bytes, not a parsed object —
  // Next.js route handlers give us that via req.text() before any parsing.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error("[api/payment/stripe-webhook] signature verification failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id || session.metadata?.supabase_user_id;

    if (!userId) {
      console.error("[api/payment/stripe-webhook] checkout.session.completed with no user id", session.id);
      return NextResponse.json({ ok: true }); // acknowledge to Stripe, nothing to link
    }

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from("profiles")
      .update({
        payment_verified: true,
        payment_verified_at: new Date().toISOString(),
        stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
        stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : null,
        stripe_checkout_session_id: session.id,
      })
      .eq("id", userId);

    if (error) {
      console.error("[api/payment/stripe-webhook] profiles update failed", error.message);
      // Return 500 so Stripe retries this webhook delivery rather than
      // silently losing a real payment confirmation.
      return NextResponse.json({ ok: false, reason: "db_error" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
