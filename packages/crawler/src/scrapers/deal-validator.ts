import { SupabaseClient } from '@supabase/supabase-js';
import { AmazonHttpScraper } from './amazon-http-scraper';
import { PriceChecker } from './price-checker';

export interface ValidatorResult {
  validated: number;
  priceUpdated: number;
  ratingsUpdated: number;
  dealsDeactivated: number;
  couponsDeactivated: number;
  couponsUpdated: number;
  productsDeactivated: number;
  fetchFailed: number;
  errors: string[];
}

interface ProductToValidate {
  id: string;
  asin: string;
  price: number | null;
  original_price: number | null;
  discount_percent: number | null;
  rating: number | null;
  review_count: number | null;
  image_url: string | null;
  image_urls: string[] | null;
  product_url: string;
  region: { code: string };
  deals: { id: string; is_active: boolean }[];
  coupons: { id: string; is_active: boolean; voucher_price: number | null; discount_value: number | null }[];
}

export class DealValidator {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  async validate(
    regionCode: string,
    maxProducts: number,
    delayMs: number,
    categoryId?: string,
  ): Promise<ValidatorResult> {
    const result: ValidatorResult = {
      validated: 0,
      priceUpdated: 0,
      ratingsUpdated: 0,
      dealsDeactivated: 0,
      couponsDeactivated: 0,
      couponsUpdated: 0,
      productsDeactivated: 0,
      fetchFailed: 0,
      errors: [],
    };

    const scraper = new AmazonHttpScraper(regionCode);

    const { data: region } = await this.supabase
      .from('regions')
      .select('id')
      .eq('code', regionCode)
      .single();

    if (!region) {
      result.errors.push(`Region not found: ${regionCode}`);
      return result;
    }

    let productQuery = this.supabase
      .from('products')
      .select(`
        id, asin, price, original_price, discount_percent, rating, review_count, image_url, image_urls, product_url,
        region:regions!inner(code),
        deals(id, is_active),
        coupons(id, is_active, voucher_price, discount_value)
      `)
      .eq('region_id', region.id)
      .eq('is_active', true)
      .order('last_scraped_at', { ascending: true, nullsFirst: true })
      .limit(maxProducts);

    if (categoryId) {
      productQuery = productQuery.eq('category_id', categoryId);
    }

    const { data: products, error } = await productQuery;

    if (error || !products) {
      result.errors.push(`Failed to fetch products: ${error?.message}`);
      return result;
    }

    const priceChecker = new PriceChecker(this.supabase);

    for (const product of products as unknown as ProductToValidate[]) {
      try {
        await AmazonHttpScraper.delay(delayMs);

        const current = await scraper.scrapeProductPage(product.asin);

        if (!current) {
          await this.markChecked(product.id);
          result.fetchFailed++;
          continue;
        }

        if (current.availability && /unavailable|nicht verfügbar|currently/i.test(current.availability)) {
          await this.deactivateProduct(product.id);
          result.productsDeactivated++;
          continue;
        }

        const oldPrice = product.price != null ? Number(product.price) : null;
        const newPrice = current.price || null;
        if (newPrice && oldPrice && Math.abs(newPrice - oldPrice) > 0.01) {
          await this.updateProductPrice(product.id, current);
          result.priceUpdated++;
        }

        if (newPrice) {
          const vp = current.coupon?.voucherPrice;
          const effectivePrice = (vp != null && vp > 0 && vp < newPrice) ? vp : newPrice;
          await this.logPriceObservation(product.id, effectivePrice, current.originalPrice ?? null);
          await priceChecker.updateDealQualityForProduct(product.id);
        }

        const oldRating = product.rating != null ? Number(product.rating) : null;
        const oldReviews = product.review_count != null ? Number(product.review_count) : null;
        const newRating = current.rating ?? null;
        const newReviews = current.reviewCount ?? null;

        const ratingChanged = newRating != null && (oldRating == null || Math.abs(newRating - oldRating) > 0.05);
        const reviewsChanged = newReviews != null && (oldReviews == null || newReviews !== oldReviews);

        if (ratingChanged || reviewsChanged) {
          await this.updateProductRating(product.id, newRating, newReviews);
          result.ratingsUpdated++;
        }

        const hasNewMainImage = current.imageUrl && current.imageUrl !== product.image_url;
        const hasNewGallery = current.imageUrls?.length && (
          !product.image_urls?.length || current.imageUrls.length > product.image_urls.length
        );
        if (hasNewMainImage || hasNewGallery) {
          const imgUpdate: Record<string, unknown> = {};
          if (hasNewMainImage) imgUpdate.image_url = current.imageUrl;
          if (hasNewGallery) imgUpdate.image_urls = current.imageUrls;
          await this.supabase.from('products').update(imgUpdate).eq('id', product.id);
        }

        const activeDeal = product.deals?.find((d) => d.is_active);
        if (activeDeal) {
          const stillDiscounted = current.discountPercent && current.discountPercent >= 5;
          if (!stillDiscounted) {
            await this.deactivateDeal(activeDeal.id);
            result.dealsDeactivated++;
          }
        }

        const activeCoupon = product.coupons?.find((c) => c.is_active);
        if (activeCoupon) {
          if (!current.coupon) {
            await this.deactivateCoupon(activeCoupon.id);
            result.couponsDeactivated++;
          } else {
            const oldVoucher = activeCoupon.voucher_price != null ? Number(activeCoupon.voucher_price) : null;
            const newVoucher = current.coupon.voucherPrice || null;
            if (newVoucher && oldVoucher && Math.abs(newVoucher - oldVoucher) > 0.01) {
              await this.updateCoupon(activeCoupon.id, current.coupon, newPrice);
              result.couponsUpdated++;
            }
          }
        }

        await this.markChecked(product.id);
        result.validated++;
      } catch (err: any) {
        result.errors.push(`Error validating ${product.asin}: ${err.message}`);
      }
    }

    return result;
  }

  private async markChecked(productId: string): Promise<void> {
    await this.supabase
      .from('products')
      .update({ last_scraped_at: new Date().toISOString() })
      .eq('id', productId);
  }

  private async deactivateProduct(productId: string): Promise<void> {
    await this.supabase
      .from('products')
      .update({ is_active: false, last_scraped_at: new Date().toISOString() })
      .eq('id', productId);

    await this.supabase.from('deals').update({ is_active: false }).eq('product_id', productId);
    await this.supabase.from('coupons').update({ is_active: false }).eq('product_id', productId);
  }

  private async updateProductPrice(
    productId: string,
    current: { price?: number; originalPrice?: number; discountPercent?: number },
  ): Promise<void> {
    const update: Record<string, unknown> = {
      last_scraped_at: new Date().toISOString(),
    };
    if (current.price) update.price = current.price;
    if (current.originalPrice && (!current.price || current.originalPrice > current.price)) {
      update.original_price = current.originalPrice;
    }
    if (current.discountPercent != null) update.discount_percent = current.discountPercent;

    await this.supabase.from('products').update(update).eq('id', productId);
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
      source: 'validator',
    });
  }

  private async updateProductRating(
    productId: string,
    rating: number | null,
    reviewCount: number | null,
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (rating != null) update.rating = Math.round(rating * 100) / 100;
    if (reviewCount != null) update.review_count = reviewCount;

    if (Object.keys(update).length > 0) {
      await this.supabase.from('products').update(update).eq('id', productId);
    }
  }

  private async deactivateDeal(dealId: string): Promise<void> {
    await this.supabase.from('deals').update({ is_active: false }).eq('id', dealId);
  }

  private async deactivateCoupon(couponId: string): Promise<void> {
    await this.supabase.from('coupons').update({ is_active: false }).eq('id', couponId);
  }

  private async updateCoupon(
    couponId: string,
    coupon: { discountType: string; discountValue: number; voucherPrice?: number; text?: string },
    _currentPrice: number | null,
  ): Promise<void> {
    await this.supabase
      .from('coupons')
      .update({
        discount_type: coupon.discountType === 'percentage' ? 'percentage' : 'fixed_amount',
        discount_value: coupon.discountValue,
        voucher_price: coupon.voucherPrice ?? null,
        title: coupon.text || undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', couponId);
  }
}
