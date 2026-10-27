import { NextResponse } from "next/server";
import { getClientContext } from "@/lib/clientContext";
import { sameOriginOk } from "@/lib/csrf";
import { getStripe } from "@/lib/stripe";

// Opens Stripe's hosted Customer Portal (update card, see invoices, cancel) for the signed-in user.
// Needs the portal enabled in Stripe (Settings > Billing > Customer portal) and the API key to have
// the "Customer portal: write" permission; otherwise the UI falls back to a contact message.
export async function POST(request: Request) {
  if (!sameOriginOk(request)) return NextResponse.json({ ok: false, reason: "bad_origin" }, { status: 403 });

  const { userId, profile } = await getClientContext();
  if (!userId) return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });

  const customerId = typeof profile?.stripe_customer_id === "string" ? profile.stripe_customer_id : null;
  if (!customerId) return NextResponse.json({ ok: false, reason: "no_customer" }, { status: 200 });

  try {
    const origin = new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[billing/portal] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, reason: "portal_unavailable" }, { status: 502 });
  }
}
