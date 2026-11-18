/** All Amazon regions this crawler supports. */
export const ALL_REGIONS = ['de', 'us', 'uk', 'fr', 'it', 'es', 'ca'] as const;
export type CronRegion = (typeof ALL_REGIONS)[number];

export const CRON_CATEGORIES = [
  'coupons',
  'lightning-deals',
  'computers',
  'home-kitchen',
  'fashion',
  'beauty',
  'toys',
  'automotive',
  'grocery',
  'smartphones',
  'garden',
  'baby',
] as const;
export type CronCategory = (typeof CRON_CATEGORIES)[number];

export const CRON_JOBS = [
  { id: 'scrape', path: 'scrape', maxProducts: 25 },
  { id: 'validate', path: 'validate', maxProducts: 25 },
  { id: 'price-check', path: 'price-check', maxProducts: 50 },
] as const;

/** Lower-priority categories skipped for price-check. */
export const PRICE_CHECK_SKIP_CATEGORIES: CronCategory[] = ['baby', 'garden', 'smartphones'];

/** Busy categories that get a second daily scrape pass on shard-4. */
export const SECOND_PASS_CATEGORIES: CronCategory[] = ['coupons', 'lightning-deals'];

export const MAX_VERCEL_CRONS = 100;
export const CRON_SLOT_MINUTES = 10;

export interface ShardDefinition {
  id: string;
  /** Primary regions owned exclusively by this shard. */
  regions: CronRegion[];
  /** Minutes after midnight UTC before the first cron on this shard. */
  startOffsetMinutes: number;
  /** Optional second scrape pass for hot categories across all regions. */
  secondPass?: {
    categories: CronCategory[];
    regions: readonly CronRegion[];
  };
}

export const SHARDS: ShardDefinition[] = [
  {
    id: 'shard-1',
    regions: ['de', 'us'],
    startOffsetMinutes: 0,
  },
  {
    id: 'shard-2',
    regions: ['uk', 'fr'],
    startOffsetMinutes: 5,
  },
  {
    id: 'shard-3',
    regions: ['it', 'es'],
    startOffsetMinutes: 10,
  },
  {
    id: 'shard-4',
    regions: ['ca'],
    startOffsetMinutes: 15,
    secondPass: {
      categories: SECOND_PASS_CATEGORIES,
      regions: ALL_REGIONS,
    },
  },
];

export interface CronEntry {
  jobId: string;
  path: string;
  region: CronRegion;
  category: CronCategory;
  maxProducts: number;
}

export interface VercelCron {
  path: string;
  schedule: string;
}

function buildPrimaryEntries(regions: CronRegion[]): CronEntry[] {
  const entries: CronEntry[] = [];

  for (const job of CRON_JOBS) {
    for (const category of CRON_CATEGORIES) {
      if (job.id === 'price-check' && PRICE_CHECK_SKIP_CATEGORIES.includes(category)) {
        continue;
      }
      for (const region of regions) {
        entries.push({
          jobId: job.id,
          path: job.path,
          region,
          category,
          maxProducts: job.maxProducts,
        });
      }
    }
  }

  return entries;
}

function buildSecondPassEntries(
  categories: CronCategory[],
  regions: readonly CronRegion[],
): CronEntry[] {
  const scrapeJob = CRON_JOBS.find((j) => j.id === 'scrape');
  if (!scrapeJob) return [];

  const entries: CronEntry[] = [];
  for (const category of categories) {
    for (const region of regions) {
      entries.push({
        jobId: scrapeJob.id,
        path: scrapeJob.path,
        region,
        category,
        maxProducts: scrapeJob.maxProducts,
      });
    }
  }
  return entries;
}

export function buildShardEntries(shard: ShardDefinition): CronEntry[] {
  const entries = buildPrimaryEntries(shard.regions);
  if (shard.secondPass) {
    entries.push(...buildSecondPassEntries(shard.secondPass.categories, shard.secondPass.regions));
  }
  if (entries.length > MAX_VERCEL_CRONS) {
    throw new Error(
      `${shard.id} would create ${entries.length} crons (limit ${MAX_VERCEL_CRONS})`,
    );
  }
  return entries;
}

export function assignSchedules(
  entries: CronEntry[],
  startOffsetMinutes: number = 0,
): VercelCron[] {
  return entries.map((entry, index) => {
    const totalMinutes = startOffsetMinutes + index * CRON_SLOT_MINUTES;
    const minute = totalMinutes % 60;
    const hour = Math.floor(totalMinutes / 60) % 24;

    return {
      path: `/api/cron/${entry.path}?region=${entry.region}&maxProducts=${entry.maxProducts}&category=${entry.category}`,
      schedule: `${minute} ${hour} * * *`,
    };
  });
}

export function generateShardCrons(shard: ShardDefinition): VercelCron[] {
  return assignSchedules(buildShardEntries(shard), shard.startOffsetMinutes);
}

export function getShard(id: string): ShardDefinition {
  const shard = SHARDS.find((s) => s.id === id);
  if (!shard) throw new Error(`Unknown shard: ${id}`);
  return shard;
}
