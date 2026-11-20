/** All Amazon regions this crawler supports. */
export const ALL_REGIONS = ['de', 'us', 'uk', 'fr', 'it', 'es', 'nl', 'be', 'ca'] as const;
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
  // Keep scrape batches small so each Vercel Hobby invocation finishes under 60s.
  { id: 'scrape', path: 'scrape', maxProducts: 10 },
  { id: 'validate', path: 'validate', maxProducts: 15 },
  { id: 'price-check', path: 'price-check', maxProducts: 30 },
] as const;

/** Lower-priority categories skipped for price-check. */
export const PRICE_CHECK_SKIP_CATEGORIES: CronCategory[] = ['baby', 'garden', 'smartphones'];

/** Busy categories that get a second daily scrape pass on shard-4. */
export const SECOND_PASS_CATEGORIES: CronCategory[] = ['coupons', 'lightning-deals'];

/** Soft cap while Vercel Schedules limits settle; legacy Cron Jobs were 100/project. */
export const MAX_VERCEL_SCHEDULES = 100;
export const CRON_SLOT_MINUTES = 10;

export interface ShardDefinition {
  id: string;
  /** Primary regions owned exclusively by this shard. */
  regions: CronRegion[];
  /** Minutes after midnight UTC before the first schedule on this shard. */
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
    regions: ['de', 'us', 'be'],
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
    regions: ['ca', 'nl'],
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
  /** Distinguishes a second daily scrape of the same region/category. */
  pass?: 'primary' | 'second';
}

/** Vercel Schedules (replaces legacy `crons`). Keep GET so existing handlers work. */
export interface VercelSchedule {
  schedule: string;
  path: string;
  requestMethod: 'GET';
}

export type VercelSchedulesMap = Record<string, VercelSchedule>;

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
          pass: 'primary',
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
        pass: 'second',
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
  if (entries.length > MAX_VERCEL_SCHEDULES) {
    throw new Error(
      `${shard.id} would create ${entries.length} schedules (limit ${MAX_VERCEL_SCHEDULES})`,
    );
  }
  return entries;
}

function scheduleName(entry: CronEntry): string {
  const base = `${entry.jobId}-${entry.region}-${entry.category}`;
  return entry.pass === 'second' ? `${base}-pass2` : base;
}

export function assignSchedules(
  entries: CronEntry[],
  startOffsetMinutes: number = 0,
): VercelSchedulesMap {
  const schedules: VercelSchedulesMap = {};

  entries.forEach((entry, index) => {
    const totalMinutes = startOffsetMinutes + index * CRON_SLOT_MINUTES;
    const minute = totalMinutes % 60;
    const hour = Math.floor(totalMinutes / 60) % 24;
    const name = scheduleName(entry);

    if (schedules[name]) {
      throw new Error(`Duplicate schedule name: ${name}`);
    }

    schedules[name] = {
      schedule: `${minute} ${hour} * * *`,
      path: `/api/cron/${entry.path}?region=${entry.region}&maxProducts=${entry.maxProducts}&category=${entry.category}`,
      requestMethod: 'GET',
    };
  });

  return schedules;
}

export function generateShardSchedules(shard: ShardDefinition): VercelSchedulesMap {
  return assignSchedules(buildShardEntries(shard), shard.startOffsetMinutes);
}

/** @deprecated Use generateShardSchedules */
export function generateShardCrons(shard: ShardDefinition): VercelSchedulesMap {
  return generateShardSchedules(shard);
}

export function getShard(id: string): ShardDefinition {
  const shard = SHARDS.find((s) => s.id === id);
  if (!shard) throw new Error(`Unknown shard: ${id}`);
  return shard;
}
