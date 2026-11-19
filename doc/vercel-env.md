# Vercel environment for crawler shards

Set these on **every** shard project (`flashdeals-worker-shard-1` … `shard-4`). Values must match the website project so all write to the same Supabase database.

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, `sb_publishable_...` |
| `CRON_SECRET` | Same secret on all shards and the website |

Use the publishable key, not the secret key. Writes go through the existing RLS scrape policies.

## Project settings

| Setting | Value |
|---------|--------|
| Root Directory | `apps/shard-N` |
| Install Command | leave empty / default — `vercel.json` sets `cd ../.. && npm install` |
| Build Command | leave empty / default — `vercel.json` sets `next build` |
| Framework | Next.js |

Do **not** use `npm install --prefix=../..`. That breaks npm workspaces on Vercel with `Tracker "idealTree" already exists`. If you already set that in Project Settings, clear the override so the repo `vercel.json` wins.

Before the first deploy (and after editing `packages/crawler/src/shards.ts`), run `npm run generate:shards` and commit the updated `apps/*/vercel.json` files.

## Schedules (not Cron Jobs)

Shard apps use Vercel **Schedules** (`schedules` in `vercel.json`), migrated from legacy Cron Jobs. Handlers stay on `GET` via `"requestMethod": "GET"`. `CRON_SECRET` auth is unchanged.

After deploy, open the project **Schedules** tab (not only Cron Jobs) and use **Run Schedule** to smoke-test.
