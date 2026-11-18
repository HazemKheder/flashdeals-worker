import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import cron from 'node-cron';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ScraperScheduler,
  DealValidator,
  PriceChecker,
  assertWorkerEnv,
} from '@flashdeals/crawler';

try {
  assertWorkerEnv();
} catch {
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

interface ScraperConfig {
  id: string;
  job_type: 'discovery' | 'validator' | 'price_checker';
  region_code: string;
  is_enabled: boolean;
  cron_expression: string;
  max_products_per_run: number;
  delay_between_requests_ms: number;
  delay_between_categories_ms: number;
}

const runningJobs = new Set<string>();

async function loadConfigs(): Promise<ScraperConfig[]> {
  const { data, error } = await supabase
    .from('scraper_config')
    .select('*')
    .eq('is_enabled', true);

  if (error) return [];
  return (data || []) as ScraperConfig[];
}

async function runDiscovery(config: ScraperConfig): Promise<void> {
  const jobKey = `discovery:${config.region_code}`;
  if (runningJobs.has(jobKey)) return;

  runningJobs.add(jobKey);
  try {
    const scheduler = new ScraperScheduler(supabase);
    await scheduler.scrapeAllCategories(
      config.region_code,
      config.max_products_per_run,
      config.delay_between_requests_ms,
      config.delay_between_categories_ms,
    );
  } catch {
    // Fatal error
  } finally {
    runningJobs.delete(jobKey);
  }
}

async function runValidator(config: ScraperConfig): Promise<void> {
  const jobKey = `validator:${config.region_code}`;
  if (runningJobs.has(jobKey)) return;

  runningJobs.add(jobKey);
  try {
    const validator = new DealValidator(supabase);
    await validator.validate(
      config.region_code,
      config.max_products_per_run,
      config.delay_between_requests_ms,
    );
  } catch {
    // Fatal error
  } finally {
    runningJobs.delete(jobKey);
  }
}

async function runPriceChecker(config: ScraperConfig): Promise<void> {
  const jobKey = `price_checker:${config.region_code}`;
  if (runningJobs.has(jobKey)) return;

  runningJobs.add(jobKey);
  try {
    const checker = new PriceChecker(supabase);
    await checker.check(config.region_code, config.max_products_per_run);
  } catch {
    // Fatal error
  } finally {
    runningJobs.delete(jobKey);
  }
}

async function runOnce(): Promise<void> {
  const configs = await loadConfigs();
  if (configs.length === 0) return;

  for (const config of configs) {
    if (config.job_type === 'discovery') {
      await runDiscovery(config);
    } else if (config.job_type === 'validator') {
      await runValidator(config);
    } else if (config.job_type === 'price_checker') {
      await runPriceChecker(config);
    }
  }
}

const scheduledTasks: cron.ScheduledTask[] = [];

async function startScheduler(): Promise<void> {
  const configs = await loadConfigs();

  if (configs.length === 0) {
    const recheck = cron.schedule('*/5 * * * *', async () => {
      const newConfigs = await loadConfigs();
      if (newConfigs.length > 0) {
        recheck.stop();
        await startScheduler();
      }
    });
    scheduledTasks.push(recheck);
    return;
  }

  for (const config of configs) {
    if (!cron.validate(config.cron_expression)) continue;

    const task = cron.schedule(config.cron_expression, () => {
      if (config.job_type === 'discovery') {
        runDiscovery(config);
      } else if (config.job_type === 'validator') {
        runValidator(config);
      } else if (config.job_type === 'price_checker') {
        runPriceChecker(config);
      }
    });

    scheduledTasks.push(task);
  }
}

function shutdown(): void {
  for (const task of scheduledTasks) task.stop();
  const waitStart = Date.now();
  const check = setInterval(() => {
    if (runningJobs.size === 0 || Date.now() - waitStart > 60_000) {
      clearInterval(check);
      process.exit(0);
    }
  }, 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function runSingleJob(jobType: string): Promise<void> {
  const configs = await loadConfigs();
  const config = configs.find((c) => c.job_type === jobType);
  if (!config) return;

  if (jobType === 'discovery') {
    await runDiscovery(config);
  } else if (jobType === 'validator') {
    await runValidator(config);
  } else if (jobType === 'price_checker') {
    await runPriceChecker(config);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jobArg = args.find((a) => a.startsWith('--job='));
  const jobType = jobArg?.split('=')[1];

  if (jobType) {
    await runSingleJob(jobType);
    process.exit(0);
  }

  if (args.includes('--once')) {
    await runOnce();
    process.exit(0);
  }

  await startScheduler();
}

main().catch(() => process.exit(1));
