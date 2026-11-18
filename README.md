# FlashDeals Worker

Crawler-only monorepo. Four Vercel projects share one Supabase database with [flashdeals.app](../flashdeals.app).

## Layout

- `packages/crawler` — HTTP scraper, validator, price checker, scheduler, cron handlers
- `apps/shard-1` … `apps/shard-4` — thin Next.js apps with cron routes only
- `bin/scraper-worker.ts` — local long-running scheduler (optional)

## Shard ownership

| Project | Regions | Notes |
|---------|---------|--------|
| shard-1 | de, us | Full scrape + validate + price-check |
| shard-2 | uk, fr | Full pipeline |
| shard-3 | it, es | Full pipeline |
| shard-4 | ca | Full pipeline + second daily scrape of coupons & lightning-deals for all 7 regions |

No region is owned by two shards on the primary pass.

## Environment (every Vercel project)

Copy from `.env.example`. Use the **same** values as the website:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CRON_SECRET`

Do not set the Supabase service role key.

## Deploy on Vercel

Create four projects from this repo. For each:

1. Root Directory = `apps/shard-N`
2. Leave Install / Build empty in the UI — `vercel.json` sets `cd ../.. && npm install` and `next build`
3. Do **not** use `npm install --prefix=../..` (breaks npm workspaces on Vercel)
4. Add the three env vars above
5. Production branch = `main`

Schedules (Vercel Schedules beta, not legacy Cron Jobs) live in each app’s committed `vercel.json`. Regenerate after changing `packages/crawler/src/shards.ts`:

```bash
npm run generate:shards
```

After deploy, check the project **Schedules** tab and use **Run Schedule** to test without waiting.

## Local

```bash
cp .env.example .env.local
# fill values
npm install
npm run scraper:once
```
