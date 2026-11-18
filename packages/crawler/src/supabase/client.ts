import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** Reads env at call time so Next.js and the standalone worker both work. */
export const createServerClient = (): SupabaseClient | null => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
};
