import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;
const KEY_VARS = ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'] as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '');
  return trimmed || undefined;
}

function schemeOf(value: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  return match ? match[1].toLowerCase() : 'none';
}

/** Accept only the API URL. Ignore a postgres connection string stored in SUPABASE_URL. */
function asHttpUrl(value: string): string | undefined {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.supabase\.co\/?$/i.test(value)) return `https://${value.replace(/\/$/, '')}`;
  return undefined;
}

function firstHttpUrl(): string | undefined {
  for (const name of URL_VARS) {
    const raw = readEnv(name);
    if (!raw) continue;
    const url = asHttpUrl(raw);
    if (url) return url;
    console.error(`Ignoring ${name}: expected an https URL, got scheme "${schemeOf(raw)}"`);
  }
  return undefined;
}

function firstKey(): string | undefined {
  for (const name of KEY_VARS) {
    const key = readEnv(name);
    if (key) return key;
  }
  return undefined;
}

/** Reads env at call time so a value added in Vercel after build is still visible. */
export const createServerClient = (): SupabaseClient | null => {
  const url = firstHttpUrl();
  const key = firstKey();
  if (!url || !key) {
    console.error('Missing a valid Supabase https URL or anon key');
    return null;
  }
  try {
    return createClient(url, key);
  } catch (error) {
    console.error('Failed to create Supabase client', error);
    return null;
  }
};
