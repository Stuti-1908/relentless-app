import { createClient } from "@/lib/supabase/server";

// Per-user tenant context — derived from the signed-in user's profile row, NOT from env vars.
// This is what makes the app multi-tenant + safe to share: a user with no client assigned
// (`clientId === null`) is "unprovisioned" and must be shown NO coaching data.
export type ClientContext = {
  userId: string;
  clientId: string | null;
  baseId: string | null;
  ghlContactId: string | null;
  plan: string;
};

export async function getClientContext(): Promise<{
  userId: string | null;
  ctx: ClientContext | null;
  profile: Record<string, unknown> | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, ctx: null, profile: null };

  // select("*") so this still works before the W3 tenant columns are added to `profiles`.
  const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const row = (p ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  return {
    userId: user.id,
    profile: p ? row : null,
    ctx: {
      userId: user.id,
      clientId: str(row.client_id),
      baseId: str(row.airtable_base_id),
      ghlContactId: str(row.ghl_contact_id),
      plan: str(row.plan) ?? "standard",
    },
  };
}
