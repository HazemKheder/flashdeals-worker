import { SupabaseClient } from '@supabase/supabase-js';
import { AmazonHttpScraper, CategoryConfig } from '../scrapers/amazon-http-scraper';
import { PriceChecker } from '../scrapers/price-checker';
import { createServerClient } from '../supabase/client';
import { ScrapedProduct } from '../types/product';

interface JobResult {
  productsScraped: number;
  dealsFound: number;
  couponsFound: number;
  categoriesProcessed: number;
  errors: string[];
}

interface DbCategory {
  id: string;
  slug: string;
  amazon_bubble_id: string;
  name_en: string;
  name_de: string;
}

export class ScraperScheduler {
  private supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    const client = supabase || createServerClient();
    if (!client) throw new Error('Supabase client not available — check env vars');
    this.supabase = client;
  }

  private async createJob(regionId: string, jobType: string, categoryId?: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('scraping_jobs')
      .insert({
        region_id: regionId,
        job_type: jobType,
        status: 'running',
        started_at: new Date().toISOString(),
        metadata: categoryId ? { category_id: categoryId } : null,
      })
      .select('id')
      .single();

    if (error) return null;
    return data.id;
  }

  private async updateJob(
    jobId: string,
    status: 'completed' | 'failed',
    result?: JobResult,
    errorMessage?: string,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      status,
      completed_at: new Date().toISOString(),
    };
    if (result) {
      updateData.products_scraped = result.productsScraped;
      updateData.deals_found = result.dealsFound;
    }
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }
    await this.supabase.from('scraping_jobs').update(updateData).eq('id', jobId);
  }

  private async getRegion(regionCode: string): Promise<{ id: string; currency: string } | null> {
    const { data, error } = await this.supabase
      .from('regions')
      .select('id, currency')
      .eq('code', regionCode)
      .single();

    if (error || !data) return null;
    return data;
  }

  async getCategories(): Promise<DbCategory[]> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, slug, amazon_bubble_id, name_en, name_de')
      .eq('is_active', true)
      .order('display_order');

    if (error) return [];
    return data || [];
  }

  async getCategoryBySlug(slug: string): Promise<DbCategory | null> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, slug, amazon_bubble_id, name_en, name_de')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error) return null;
    return data;
  }

  private sanitizeProduct(product: ScrapedProduct): ScrapedProduct {
    const price = product.price && product.price <= 9999999.99 ? product.price : undefined;
    let originalPrice = product.originalPrice && product.originalPrice <= 9999999.99 ? product.originalPrice : undefined;

    if (originalPrice != null && price != null && originalPrice <= price) {
      originalPrice = undefined;
    }

    return {
      ...product,
      price,
      originalPrice,
      discountPercent:
        product.discountPercent != null && product.discountPercent >= 0 && product.discountPercent <= 100
          ? Math.round(product.discountPercent * 100) / 100
          : undefined,
      rating:
        product.rating != null && product.rating >= 0 && product.rating <= 5
          ? Math.round(product.rating * 100) / 100
          : undefined,
    };
  }

  private async upsertProduct(
    product: ScrapedProduct,
    regionId: string,
    currency: string,
    categoryId?: string,
  ): Promise<string | null> {
    const s = this.sanitizeProduct(product);

    if (!s.price || !s.imageUrl || !s.title || s.title.length < 10) {
      return null;
    }

    const { data, error } = await this.supabase
      .from('products')
      .upsert(
        {
          asin: s.asin,
          region_id: regionId,
          title: s.title,
          description: s.description || s.descriptionDe || s.title,
          description_en: s.descriptionEn,
          description_de: s.descriptionDe,
          price: s.price,
          original_price: s.originalPrice,
          discount_percent: s.discountPercent,
          currency,
          image_url: s.imageUrl,
          image_urls: s.imageUrls,
          product_url: s.productUrl,
          category: s.category,
          category_id: categoryId || s.categoryId,
          brand: s.brand,
          rating: s.rating,
          review_count: s.reviewCount,
          availability: s.availability,
          is_prime: s.isPrime,
          is_active: true,
          last_scraped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'asin,region_id' },
      )
      .select('id')
      .single();

    if (error) return null;
    return data.id;
  }

  private async createDeal(productId: string, product: ScrapedProduct): Promise<void> {
    if (!product.discountPercent || product.discountPercent < 5) return;

    await this.supabase.from('deals').upsert(
      {
        product_id: productId,
        deal_type: 'sale',
        title: `${Math.round(product.discountPercent)}% Off`,
        discount_percent: product.discountPercent,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id' },
    );
  }

  private async upsertCoupon(productId: string, regionId: string, product: ScrapedProduct): Promise<boolean> {
    if (!product.coupon) return false;

    const { discountType, discountValue, text, voucherPrice } = product.coupon;
    let rawTitle =
      (typeof text === 'string' ? text : null) ||
      (discountType === 'percentage'
        ? `${discountValue}% off with coupon`
        : `${product.currency} ${discountValue} off with coupon`);
    rawTitle = (rawTitle ?? 'Coupon').replace(/\.[a-zA-Z_][\w-]*\s*\{[^}]*\}/g, '').replace(/\s{2,}/g, ' ').trim();
    const title = (rawTitle || 'Coupon').slice(0, 255);

    const couponData = {
      title,
      discount_type: discountType === 'percentage' ? 'percentage' : 'fixed_amount',
      discount_value: discountValue,
      voucher_price: voucherPrice ?? null,
      is_active: true,
    };

    const { data: existing } = await this.supabase
      .from('coupons')
      .select('id')
      .eq('product_id', productId)
      .eq('region_id', regionId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (existing) {
      const { error } = await this.supabase
        .from('coupons')
        .update({ ...couponData, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) return false;
    } else {
      const { error } = await this.supabase.from('coupons').insert({
        product_id: productId,
        region_id: regionId,
        ...couponData,
      });
      if (error) return false;
    }
    return true;
  }

  private async logPriceObservation(
    productId: string,
    price: number,
    originalPrice: number | null,
  ): Promise<void> {
    await this.supabase.from('price_history').insert({
      product_id: productId,
      price,
      original_price: originalPrice,
      source: 'discovery',
    });
  }

  async scrapeCategory(
    regionCode: string,
    categorySlug: string,
    maxProducts: number = 50,
    delayBetweenRequests: number = 3000,
  ): Promise<JobResult> {
    const result: JobResult = {
      productsScraped: 0,
      dealsFound: 0,
      couponsFound: 0,
      categoriesProcessed: 0,
      errors: [],
    };

    try {
      const region = await this.getRegion(regionCode);
      if (!region) throw new Error(`Region not found: ${regionCode}`);

      const category = await this.getCategoryBySlug(categorySlug);
      if (!category) throw new Error(`Category not found: ${categorySlug}`);

      const jobId = await this.createJob(region.id, 'category', category.id);
      if (!jobId) throw new Error('Failed to create job record');

      const scraper = new AmazonHttpScraper(regionCode);
      const categoryConfig: CategoryConfig = {
        id: category.id,
        slug: category.slug,
        amazonBubbleId: category.amazon_bubble_id,
      };

      try {
        const productMap = await scraper.discoverDeals(categoryConfig, maxProducts, delayBetweenRequests);
        const products = Array.from(productMap.values());
        result.productsScraped = products.length;

        const priceChecker = new PriceChecker(this.supabase);

        for (const product of products) {
          try {
            const productId = await this.upsertProduct(product, region.id, region.currency, category.id);
            if (productId) {
              await this.createDeal(productId, product);
              if (product.discountPercent && product.discountPercent >= 5) result.dealsFound++;

              const couponCreated = await this.upsertCoupon(productId, region.id, product);
              if (couponCreated) result.couponsFound++;

              if (product.price) {
                const vp = product.coupon?.voucherPrice;
                const effectivePrice = (vp != null && vp > 0 && vp < product.price) ? vp : product.price;
                await this.logPriceObservation(productId, effectivePrice, product.originalPrice ?? null);
                await priceChecker.updateDealQualityForProduct(productId);
              }
            }
          } catch (error: any) {
            result.errors.push(`Error processing product ${product.asin}: ${error.message}`);
          }
        }

        result.categoriesProcessed = 1;
      } catch (error: any) {
        result.errors.push(error.message);
      }

      await this.updateJob(jobId, result.errors.length > 0 ? 'failed' : 'completed', result);
      return result;
    } catch (error: any) {
      result.errors.push(error.message);
      return result;
    }
  }

  async scrapeAllCategories(
    regionCode: string,
    maxProductsPerCategory: number = 30,
    delayBetweenRequests: number = 3000,
    delayBetweenCategories: number = 10000,
  ): Promise<JobResult> {
    const result: JobResult = {
      productsScraped: 0,
      dealsFound: 0,
      couponsFound: 0,
      categoriesProcessed: 0,
      errors: [],
    };

    const categories = await this.getCategories();
    if (categories.length === 0) {
      result.errors.push('No categories found');
      return result;
    }

    for (const category of categories) {
      try {
        const categoryResult = await this.scrapeCategory(
          regionCode,
          category.slug,
          maxProductsPerCategory,
          delayBetweenRequests,
        );

        result.productsScraped += categoryResult.productsScraped;
        result.dealsFound += categoryResult.dealsFound;
        result.couponsFound += categoryResult.couponsFound;
        result.categoriesProcessed++;
        result.errors.push(...categoryResult.errors);

        if (delayBetweenCategories > 0) {
          await AmazonHttpScraper.delay(delayBetweenCategories);
        }
      } catch (error: any) {
        result.errors.push(`Error scraping category ${category.slug}: ${error.message}`);
      }
    }

    return result;
  }
}
