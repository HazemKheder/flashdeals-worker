import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@flashdeals/crawler'],
  // Keep these as real node_modules so the cron functions can load them.
  serverExternalPackages: ['cheerio', '@supabase/supabase-js'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
