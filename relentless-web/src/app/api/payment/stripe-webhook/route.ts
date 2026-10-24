import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";

// REAL server-side payment verification. Stripe calls this endpoint directly,
// server-to-server; the signature check proves the request came from Stripe.
//
// Stripe Dashboard -> Developers -> Webhooks endpoint:
//   https://<your-domain>/api/payment/stripe-webhook
// Events: checkout.session.completed, checkout.session.async_payment_succeeded,
//   checkout.session.async_payment_failed, customer.subscription.updated,
//   customer.subscription.deleted (invoice.payment_failed is accepted and logged).
// Env: STRIPE_WEBHOOK_SECRET (endpoint signing secret), STRIPE_SECRET_KEY,
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Requires build/migration/011_stripe_subscription_lifecycle.sql.
//
// The user is identified via client_reference_id, which /payment/page.tsx sets
// to the signed-in Supabase auth user id on the Payment Link. Later
// subscription events are matched by stripe_subscription_id.

// past_due is deliberately NOT revoked: Stripe is still retrying the card
// (Smart Retries); access is removed only once Stripe gives up (unpaid/canceled).
const ACTIVE = new Set(["active", "trialing", "past_due"]);
const REVOKED = new Set(["canceled", "unpaid", "incomplete_expired"]);

type Result = { ok: true } | { ok: false; status: number; reason: string };

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

async function onCheckout(supabase: SupabaseClient, session: Stripe.Checkout.Session, paid: boolean): Promise<Result> {
  const userId = session.client_reference_id || session.metadata?.supabase_user_id;
  if (!userId) {
    console.error("[stripe-webhook] checkout session with no user id", session.id);
    return { ok: true }; // acknowledge; nothing to link
  }
  const patch: Record<string, unknown> = {
    stripe_customer_id: idOf(session.customer),
    stripe_subscription_id: idOf(session.subscription),
    stripe_checkout_session_id: session.id,
  };
  if (paid) {
    patch.payment_verified = true;
    patch.payment_verified_at = new Date().toISOString();
    patch.subscription_status = "active";
  } else {
    patch.subscription_status = "payment_pending";
  }
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) {
    console.error("[stripe-webhook] profiles update failed", error.message);
    return { ok: false, status: 500, reason: "db_error" }; // 500 -> Stripe retries
  }
  return { ok: true };
}

async function onSubscription(supabase: SupabaseClient, sub: Stripe.Subscription): Promise<Result> {
  const status = sub.status;
  const patch: Record<string, unknown> = { subscription_status: status };
  if (REVOKED.has(status)) patch.payment_verified = false;
  else if (ACTIVE.has(status)) patch.payment_verified = true;

  let query = supabase.from("profiles").update(patch);
  const userId = sub.metadata?.supabase_user_id;
  query = userId ? query.eq("id", userId) : query.eq("stripe_subscription_id", sub.id);
  const { data, error } = await query.select("id");
  if (error) {
    console.error("[stripe-webhook] subscription update failed", sub.id, error.message);
    return { ok: false, status: 500, reason: "db_error" };
  }
  if (!data || data.length === 0) {
    // A brand-new subscription can arrive before checkout.session.completed links it:
    // ask Stripe to retry. Older unmatched ones belong to other products on the same
    // Stripe account -> acknowledge, or Stripe would eventually disable this endpoint.
    const ageSec = Date.now() / 1000 - (sub.created || 0);
    console.warn("[stripe-webhook] no profile for subscription", sub.id, status, Math.round(ageSec) + "s old");
    if (ageSec < 3600) return { ok: false, status: 404, reason: "profile_not_linked" };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[api/payment/stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ ok: false, reason: "missing_signature" }, { status: 400 });

  // Signature verification needs the RAW body bytes, not a parsed object.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    console.error("[api/payment/stripe-webhook] signature verification failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 400 });
  }

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  let result: Result = { ok: true };
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      // Card payments arrive "paid"; delayed methods (bank debits) arrive "unpaid"
      // and are settled later by async_payment_succeeded / _failed.
      result = await onCheckout(supabase, s, s.payment_status === "paid" || s.payment_status === "no_payment_required");
      break;
    }
    case "checkout.session.async_payment_succeeded":
      result = await onCheckout(supabase, event.data.object, true);
      break;
    case "checkout.session.async_payment_failed":
      result = await onCheckout(supabase, event.data.object, false);
      break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      result = await onSubscription(supabase, event.data.object);
      break;
    case "invoice.payment_failed":
      // Access follows the subscription status (past_due -> unpaid/canceled), not single invoices.
      console.warn("[stripe-webhook] invoice payment failed", event.data.object.id);
      break;
    default:
      break;
  }

  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  return NextResponse.json({ ok: true });
}
