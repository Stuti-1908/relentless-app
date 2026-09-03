import Stripe from "stripe";

// Server-only Stripe client. STRIPE_SECRET_KEY must never be prefixed
// NEXT_PUBLIC_ — it is a restricted API key (rk_live_... / rk_test_...)
// with server-side scopes only, same handling as the Supabase service-role
// key elsewhere in this project.
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}
