import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHARDS,
  MAX_VERCEL_SCHEDULES,
  buildShardEntries,
  generateShardSchedules,
} from '../packages/crawler/src/shards';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const shard of SHARDS) {
  const entries = buildShardEntries(shard);
  const schedules = generateShardSchedules(shard);
  const count = Object.keys(schedules).length;
  const vercelPath = resolve(root, 'apps', shard.id, 'vercel.json');

  mkdirSync(dirname(vercelPath), { recursive: true });
  // Do not use `npm install --prefix=../..` — it breaks npm workspaces
  // ("Tracker idealTree already exists") on Vercel.
  writeFileSync(
    vercelPath,
    `${JSON.stringify(
      {
        $schema: 'https://openapi.vercel.sh/vercel.json',
        installCommand: 'cd ../.. && npm install',
        buildCommand: 'next build',
        schedules,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const byJob: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  for (const entry of entries) {
    byJob[entry.jobId] = (byJob[entry.jobId] || 0) + 1;
    byRegion[entry.region] = (byRegion[entry.region] || 0) + 1;
  }

  console.log(
    `${shard.id}: ${count}/${MAX_VERCEL_SCHEDULES} schedules | regions=${shard.regions.join(',')} | jobs=${JSON.stringify(byJob)} | byRegion=${JSON.stringify(byRegion)}`,
  );
}

console.log('Wrote vercel.json schedules for all shards.');
