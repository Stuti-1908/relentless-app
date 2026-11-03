import { createClient } from "@supabase/supabase-js";

// Service-role client for server routes only. Use it for every write to access-control columns on
// profiles (payment_verified, plan, client_id, ghl_contact_id, stripe_*): migration 014 removes the
// browser's ability to update those columns, so the session client can no longer write them.
export function createServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
