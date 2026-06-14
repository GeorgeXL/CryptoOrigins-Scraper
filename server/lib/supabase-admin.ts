import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null | undefined;

/** Service-role Supabase client (HTTPS REST, bypasses RLS). Requires SUPABASE_SERVICE_ROLE_KEY in .env */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient !== undefined) return adminClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceRoleKey) {
    adminClient = null;
    return null;
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export function requireSupabaseAdmin(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new Error(
      "Supabase service role not configured — add SUPABASE_SERVICE_ROLE_KEY to .env (Supabase dashboard → Settings → API)",
    );
  }
  return client;
}
