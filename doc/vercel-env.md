# Vercel environment for crawler shards

Set these on **every** shard project (`flashdeals-worker-shard-1` … `shard-4`). Values must match the website project so all write to the same Supabase database.

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as flashdeals.app |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as flashdeals.app |
| `CRON_SECRET` | Same secret on all shards and (if kept) the website |

Never add `SUPABASE_SERVICE_ROLE_KEY`. Writes use the anon key and existing RLS scrape policies.

## Project settings

| Setting | Value |
|---------|--------|
| Root Directory | `apps/shard-N` |
| Install Command | `cd ../.. && npm install` |
| Build Command | `next build` |
| Framework | Next.js |

Before the first deploy (and after editing `packages/crawler/src/shards.ts`), run `npm run generate:shards` and commit the updated `apps/*/vercel.json` files.
