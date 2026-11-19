import { requestUrl } from '../request-url';
import { createServerClient } from '../supabase/client';
import { ScraperScheduler } from '../jobs/scraper-scheduler';

function unauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function assertCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

export async function handleScrape(request: Request): Promise<Response> {
  try {
    if (!assertCronAuth(request)) return unauthorized();

    const supabase = createServerClient();
    if (!supabase) {
      return Response.json({ error: 'Service unavailable' }, { status: 503 });
    }

    const { searchParams } = requestUrl(request);
    const region = searchParams.get('region') || 'de';
    const maxProducts = parseInt(searchParams.get('maxProducts') || '25', 10);
    const explicitCategory = searchParams.get('category');

    const scheduler = new ScraperScheduler(supabase);

    if (explicitCategory) {
      const result = await scheduler.scrapeCategory(region, explicitCategory, maxProducts);
      return Response.json({ success: true, region, category: explicitCategory, result });
    }

    const result = await scheduler.scrapeAllCategories(region, maxProducts);
    return Response.json({ success: true, region, result });
  } catch (error: any) {
    console.error('[scrape]', error);
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
