/** Fail fast when required env is missing (call from local scripts / health checks). */
export function assertWorkerEnv(): void {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ] as const;

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  if (!process.env.CRON_SECRET) {
    console.warn('CRON_SECRET is unset — cron routes will accept unauthenticated requests');
  }
}
