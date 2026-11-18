import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@flashdeals/crawler'],
  // Allow importing the workspace package from outside this app directory.
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
