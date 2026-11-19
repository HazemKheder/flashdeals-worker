function hasPublishableKey(): boolean {
  const names = [
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
  ];
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

/** Fail fast when required env is missing (call from local scripts / health checks). */
export function assertWorkerEnv(): void {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && !process.env.SUPABASE_URL?.trim()) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!hasPublishableKey()) {
    missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  if (!process.env.CRON_SECRET) {
    console.warn('CRON_SECRET is unset — cron routes will accept unauthenticated requests');
  }
}
