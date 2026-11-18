import { SupabaseClient } from '@supabase/supabase-js';

export type DealQuality = 'best_price' | 'good_deal' | 'fair_deal' | 'suspicious' | 'inflated' | 'unverified';

export interface PriceCheckResult {
  checked: number;
  scored: number;
  insufficientData: number;
  errors: string[];
}

interface PriceHistory {
  lowest: number;
  highest: number;
  average: number;
  dataPoints: number;
  spanDays: number;
}

interface ProductRow {
  id: string;
  asin: string;
  price: number | null;
  original_price: number | null;
  discount_percent: number | null;
}

/** Minimum observations needed to compute min/avg/max and score. */
const MIN_DATA_POINTS = 5;
/** Minimum calendar span of history (days) to avoid false judgments from limited data. */
const MIN_HISTORY_DAYS = 3;

export class PriceChecker {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Score the deal quality based on our own accumulated price history.
   *
   * Logic:
   * - best_price:  current price <= lowest_ever * 1.05 (within 5% of all-time low)
   * - good_deal:   current price < average * 0.85 (15%+ below average)
   * - fair_deal:   current price < average (below average but not dramatically)
   * - suspicious:  claimed original_price > highest_ever * 1.15 (inflated RRP)
   * - inflated:    claimed original_price > highest_ever * 1.15 AND price >= average
   * - unverified:  not enough data to determine
   */
  scoreDeal(
    currentPrice: number,
    originalPrice: number | null,
    history: PriceHistory,
  ): DealQuality {
    const { lowest, highest, average } = history;

    // Discard nonsensical original_price (must be higher than current price)
    const validOriginal = originalPrice != null && originalPrice > currentPrice
      ? originalPrice
      : null;

    // Check if the claimed original price is inflated beyond historical highs
    if (validOriginal != null && validOriginal > highest * 1.15) {
      if (currentPrice >= average) {
        return 'inflated';
      }
      return 'suspicious';
    }

    // Best price: at or near the all-time low
    if (currentPrice <= lowest * 1.05) {
      return 'best_price';
    }

    // Good deal: 15%+ below average
    if (currentPrice < average * 0.85) {
      return 'good_deal';
    }

    // Fair deal: below average but not dramatically
    if (currentPrice < average) {
      return 'fair_deal';
    }

    // Price is at or above average with a discount claim
    if (validOriginal != null && currentPrice >= average) {
      return 'suspicious';
    }

    return 'unverified';
  }

  /**
   * Load price history for a product from our own price_history table.
   * Returns null if not enough data points or insufficient time span.
   */
  private async loadHistory(productId: string): Promise<PriceHistory | null> {
    const { data, error } = await this.supabase
      .from('price_history')
      .select('price, observed_at')
      .eq('product_id', productId)
      .order('observed_at', { ascending: true })
      .limit(1000);

    if (error || !data || data.length < MIN_DATA_POINTS) {
      return null;
    }

    const oldest = new Date(data[0].observed_at).getTime();
    const newest = new Date(data[data.length - 1].observed_at).getTime();
    const spanDays = (newest - oldest) / (1000 * 60 * 60 * 24);

    if (spanDays < MIN_HISTORY_DAYS) {
      return null;
    }

    const prices = data.map((r: { price: number }) => Number(r.price));
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const average = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;

    return { lowest, highest, average, dataPoints: prices.length, spanDays: Math.round(spanDays) };
  }

  /**
   * Recompute and upsert deal_quality for a single product (e.g. after logging a new price).
   */
  async updateDealQualityForProduct(productId: string): Promise<void> {
    const { data: product, error: productError } = await this.supabase
      .from('products')
      .select('id, price, original_price')
      .eq('id', productId)
      .single();

    if (productError || !product) return;

    const listedPrice = product.price != null ? Number(product.price) : null;
    const originalPrice = product.original_price != null ? Number(product.original_price) : null;

    if (listedPrice == null) {
      await this.upsertIntelligence(productId, null, 'unverified');
      return;
    }

    const { data: coupons } = await this.supabase
      .from('coupons')
      .select('voucher_price')
      .eq('product_id', productId)
      .eq('is_active', true)
      .not('voucher_price', 'is', null);

    let effectivePrice = listedPrice;
    if (coupons?.length) {
      for (const c of coupons) {
        const vp = Number(c.voucher_price);
        if (vp > 0 && vp < effectivePrice) effectivePrice = vp;
      }
    }

    const history = await this.loadHistory(productId);
    if (!history) {
      await this.upsertIntelligence(productId, null, 'unverified');
      return;
    }

    const quality = this.scoreDeal(effectivePrice, originalPrice, history);
    await this.upsertIntelligence(productId, history, quality);
  }

  /**
   * Run the price checker job.
   */
  async check(
    regionCode: string,
    maxProducts: number,
    categoryId?: string,
  ): Promise<PriceCheckResult> {
    const result: PriceCheckResult = {
      checked: 0,
      scored: 0,
      insufficientData: 0,
      errors: [],
    };

    const { data: regionData } = await this.supabase
      .from('regions')
      .select('id')
      .eq('code', regionCode)
      .single();

    if (!regionData) {
      result.errors.push(`Region '${regionCode}' not found`);
      return result;
    }

    let productQuery = this.supabase
      .from('products')
      .select('id, asin, price, original_price, discount_percent')
      .eq('region_id', regionData.id)
      .eq('is_active', true)
      .order('updated_at', { ascending: true })
      .limit(maxProducts);

    if (categoryId) {
      productQuery = productQuery.eq('category_id', categoryId);
    }

    const { data: products, error } = await productQuery;

    if (error) {
      result.errors.push(`Failed to load products: ${error.message}`);
      return result;
    }

    if (!products || products.length === 0) return result;

    const productIds = products.map((p: ProductRow) => p.id);
    const { data: existingIntel } = await this.supabase
      .from('price_intelligence')
      .select('product_id, checked_at')
      .in('product_id', productIds);

    const checkedMap = new Map<string, string>();
    if (existingIntel) {
      for (const row of existingIntel) {
        checkedMap.set(row.product_id, row.checked_at);
      }
    }

    const sorted = [...products].sort((a: ProductRow, b: ProductRow) => {
      const aChecked = checkedMap.get(a.id);
      const bChecked = checkedMap.get(b.id);
      if (!aChecked && bChecked) return -1;
      if (aChecked && !bChecked) return 1;
      if (aChecked && bChecked) return aChecked.localeCompare(bChecked);
      return 0;
    }) as ProductRow[];

    for (const product of sorted) {
      try {
        result.checked++;

        const listedPrice = product.price != null ? Number(product.price) : null;
        const originalPrice = product.original_price != null ? Number(product.original_price) : null;

        if (listedPrice == null) {
          await this.upsertIntelligence(product.id, null, 'unverified');
          continue;
        }

        const { data: coupons } = await this.supabase
          .from('coupons')
          .select('voucher_price')
          .eq('product_id', product.id)
          .eq('is_active', true)
          .not('voucher_price', 'is', null);

        let effectivePrice = listedPrice;
        if (coupons?.length) {
          for (const c of coupons) {
            const vp = Number(c.voucher_price);
            if (vp > 0 && vp < effectivePrice) effectivePrice = vp;
          }
        }

        const history = await this.loadHistory(product.id);

        if (!history) {
          await this.upsertIntelligence(product.id, null, 'unverified');
          result.insufficientData++;
          continue;
        }

        const quality = this.scoreDeal(effectivePrice, originalPrice, history);

        await this.upsertIntelligence(product.id, history, quality);
        result.scored++;
      } catch (err: any) {
        result.errors.push(`[${product.asin}] ${err.message}`);
      }
    }

    return result;
  }

  private async upsertIntelligence(
    productId: string,
    history: PriceHistory | null,
    quality: DealQuality,
  ): Promise<void> {
    const row = {
      product_id: productId,
      lowest_ever: history?.lowest ?? null,
      highest_ever: history?.highest ?? null,
      average: history?.average ?? null,
      current_external: null,
      deal_quality: quality,
      source: 'self',
      checked_at: new Date().toISOString(),
    };

    await this.supabase
      .from('price_intelligence')
      .upsert(row, { onConflict: 'product_id' });
  }
}
