import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";

// Read-only billing summary for the Settings page. Everything comes from the signed-in user's own
// profiles row, which the Stripe webhook keeps current (see api/payment/stripe-webhook/route.ts).
// The price is the one shown on /payment — keep the two in sync if the Stripe price ever changes.
const PLAN = { name: "Relentless AI — Executive Coaching", amount: "$69", interval: "month" } as const;

type BillingState = "active" | "past_due" | "beta" | "cancelled" | "none";

export async function GET() {
  const { userId, profile } = await getClientContext();
  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  const p = profile ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const verified = p.payment_verified === true;
  const customerId = str(p.stripe_customer_id);
  const subId = str(p.stripe_subscription_id);
  const subStatus = str(p.subscription_status);

  let state: BillingState;
  if (verified && subId) state = subStatus === "past_due" ? "past_due" : "active";
  else if (verified) state = "beta";
  else if (subId || customerId) state = "cancelled";
  else state = "none";

  return NextResponse.json({ ok: true, plan: PLAN, state, canManage: !!customerId });
}
