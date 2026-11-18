import { createServerClient } from '../supabase/client';
import { DealValidator } from '../scrapers/deal-validator';

function unauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

function assertCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

export async function handleValidate(request: Request): Promise<Response> {
  try {
    if (!assertCronAuth(request)) return unauthorized();

    const supabase = createServerClient();
    if (!supabase) {
      return Response.json({ error: 'Service unavailable' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'de';
    const maxProducts = parseInt(searchParams.get('maxProducts') || '25', 10);
    const delayMs = parseInt(searchParams.get('delay') || '1500', 10);
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

    const validator = new DealValidator(supabase);
    const result = await validator.validate(region, maxProducts, delayMs, categoryId);

    return Response.json({ success: true, region, category: categorySlug ?? 'all', result });
  } catch (error: any) {
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
