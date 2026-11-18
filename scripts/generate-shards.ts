import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SHARDS,
  MAX_VERCEL_CRONS,
  buildShardEntries,
  generateShardCrons,
} from '../packages/crawler/src/shards';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const shard of SHARDS) {
  const entries = buildShardEntries(shard);
  const crons = generateShardCrons(shard);
  const vercelPath = resolve(root, 'apps', shard.id, 'vercel.json');

  mkdirSync(dirname(vercelPath), { recursive: true });
  writeFileSync(vercelPath, `${JSON.stringify({ crons }, null, 2)}\n`, 'utf8');

  const byJob: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  for (const entry of entries) {
    byJob[entry.jobId] = (byJob[entry.jobId] || 0) + 1;
    byRegion[entry.region] = (byRegion[entry.region] || 0) + 1;
  }

  console.log(
    `${shard.id}: ${crons.length}/${MAX_VERCEL_CRONS} crons | regions=${shard.regions.join(',')} | jobs=${JSON.stringify(byJob)} | byRegion=${JSON.stringify(byRegion)}`,
  );
}

console.log('Wrote vercel.json for all shards.');
