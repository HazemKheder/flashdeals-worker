import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    "@supabase/supabase-js": "^2.90.1",
    "cheerio": "^1.1.2",
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
  // Keep these as real node_modules so the cron functions can load them.
  serverExternalPackages: ['cheerio', '@supabase/supabase-js'],
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;
`;

const layout = `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlashDeals — Coming Soon',
  description: 'FlashDeals is almost ready. Discover timed Amazon deals soon.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
`;

const page = (_id) => `export default function Home() {
  return (
    <main className="coming-soon">
      <div className="coming-soon__orb coming-soon__orb--a" aria-hidden="true" />
      <div className="coming-soon__orb coming-soon__orb--b" aria-hidden="true" />

      <div className="coming-soon__content">
        <p className="coming-soon__brand">FlashDeals</p>
        <span className="coming-soon__rule" aria-hidden="true" />
        <h1 className="coming-soon__headline">Coming soon</h1>
        <p className="coming-soon__copy">
          We&apos;re lining up the best timed Amazon deals. The full experience is almost ready.
        </p>
        <a className="coming-soon__cta" href="https://www.flashdeals.app">
          Visit flashdeals.app
        </a>
      </div>
    </main>
  );
}
`;

const cronRoute = (handlerPath, exportName) => `export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const handler = await import('${handlerPath}');
    return await handler.${exportName}(request);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
`;

const scrapeRoute = cronRoute('@flashdeals/crawler/handlers/scrape', 'handleScrape');
const validateRoute = cronRoute('@flashdeals/crawler/handlers/validate', 'handleValidate');
const priceCheckRoute = cronRoute('@flashdeals/crawler/handlers/price-check', 'handlePriceCheck');

function write(filePath, contents) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, 'utf8');
}

const globalsCss = readFileSync(resolve(root, 'apps/shard-1/app/globals.css'), 'utf8');

for (const id of shards) {
  const app = resolve(root, 'apps', id);
  write(resolve(app, 'package.json'), packageJson(id));
  write(resolve(app, 'tsconfig.json'), tsconfig);
  write(resolve(app, 'next.config.ts'), nextConfig);
  write(resolve(app, 'app/globals.css'), globalsCss);
  write(resolve(app, 'app/layout.tsx'), layout);
  write(resolve(app, 'app/page.tsx'), page(id));
  write(resolve(app, 'app/api/cron/scrape/route.ts'), scrapeRoute);
  write(resolve(app, 'app/api/cron/validate/route.ts'), validateRoute);
  write(resolve(app, 'app/api/cron/price-check/route.ts'), priceCheckRoute);
  console.log(`Scaffolded ${id}`);
}
