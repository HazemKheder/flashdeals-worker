import { createClient, SupabaseClient } from '@supabase/supabase-js';

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  return trimmed || undefined;
}

/** Reads env at call time so a value added in Vercel after build is still visible. */
export const createServerClient = (): SupabaseClient | null => {
  const url = readEnv('SUPABASE_URL') ?? readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = readEnv('SUPABASE_ANON_KEY') ?? readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) {
    console.error('Missing Supabase URL or anon key');
    return null;
  }
  try {
    return createClient(url, key);
  } catch (error) {
    console.error('Failed to create Supabase client', error);
    return null;
  }
};
