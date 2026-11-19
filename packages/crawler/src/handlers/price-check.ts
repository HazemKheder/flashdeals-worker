import { requestUrl } from '../request-url';
import { createServerClient } from '../supabase/client';
import { PriceChecker } from '../scrapers/price-checker';

function unauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function assertCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

export async function handlePriceCheck(request: Request): Promise<Response> {
  try {
    if (!assertCronAuth(request)) return unauthorized();

    const supabase = createServerClient();
    if (!supabase) {
      return Response.json({ error: 'Service unavailable' }, { status: 503 });
    }

    const { searchParams } = requestUrl(request);
    const region = searchParams.get('region') || 'de';
    const maxProducts = parseInt(searchParams.get('maxProducts') || '50', 10);
    const categorySlug = searchParams.get('category');

    let categoryId: string | undefined;
    if (categorySlug) {
      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .eq('slug', categorySlug)
        .eq('is_active', true)
        .single();
      if (cat) categoryId = cat.id;
    }

    const checker = new PriceChecker(supabase);
    const result = await checker.check(region, maxProducts, categoryId);

    return Response.json({ success: true, region, category: categorySlug ?? 'all', result });
  } catch (error: any) {
    console.error('[price-check]', error);
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
