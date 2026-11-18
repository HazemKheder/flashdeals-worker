import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shards = ['shard-1', 'shard-2', 'shard-3', 'shard-4'];

const packageJson = (id) => `{
  "name": "@flashdeals/${id}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint ."
  },
  "dependencies": {
    "@flashdeals/crawler": "*",
    "next": "16.1.2",
    "react": "19.2.3",
    "react-dom": "19.2.3"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5.7.2"
  }
}
`;

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const nextConfig = `import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@flashdeals/crawler'],
  // Allow importing the workspace package from outside this app directory.
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
`;

const layout = `export const metadata = {
  title: 'FlashDeals Crawler',
  description: 'Crawler-only worker shard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const page = (id) => `export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>FlashDeals crawler — ${id}</h1>
      <p>Cron-only worker. No public UI.</p>
    </main>
  );
}
`;

const scrapeRoute = `import { handleScrape } from '@flashdeals/crawler';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleScrape(request);
}
`;

const validateRoute = `import { handleValidate } from '@flashdeals/crawler';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleValidate(request);
}
`;

const priceCheckRoute = `import { handlePriceCheck } from '@flashdeals/crawler';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handlePriceCheck(request);
}
`;

function write(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

for (const id of shards) {
  const app = resolve(root, 'apps', id);
  write(resolve(app, 'package.json'), packageJson(id));
  write(resolve(app, 'tsconfig.json'), tsconfig);
  write(resolve(app, 'next.config.ts'), nextConfig);
  write(resolve(app, 'app/layout.tsx'), layout);
  write(resolve(app, 'app/page.tsx'), page(id));
  write(resolve(app, 'app/api/cron/scrape/route.ts'), scrapeRoute);
  write(resolve(app, 'app/api/cron/validate/route.ts'), validateRoute);
  write(resolve(app, 'app/api/cron/price-check/route.ts'), priceCheckRoute);
  console.log(`Scaffolded ${id}`);
}
