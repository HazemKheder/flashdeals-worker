export interface ScrapedProduct {
  asin: string;
  title: string;
  description?: string;
  descriptionEn?: string;
  descriptionDe?: string;
  price?: number;
  originalPrice?: number;
  discountPercent?: number;
  currency: string;
  imageUrl?: string;
  imageUrls?: string[];
  productUrl: string;
  category?: string;
  categoryId?: string;
  brand?: string;
  rating?: number;
  reviewCount?: number;
  availability?: string;
  isPrime?: boolean;
  /** Coupon info extracted from the deal card */
  coupon?: {
    discountType: 'percentage' | 'fixed_amount';
    discountValue: number;
    /** Raw text e.g. "Save 20% with coupon" or "130.05 with voucher" */
    text?: string;
    /** The final price after applying the voucher, extracted directly from Amazon */
    voucherPrice?: number;
  };
}

export interface ScrapedDeal {
  productAsin: string;
  dealType: string;
  title?: string;
  description?: string;
  discountPercent?: number;
  validUntil?: Date;
}

export interface ScrapedCoupon {
  productAsin?: string;
  code?: string;
  title: string;
  description?: string;
  discountType: 'percentage' | 'fixed_amount' | 'free_shipping';
  discountValue?: number;
  minPurchase?: number;
  validUntil?: Date;
}

export interface RegionConfig {
  code: string;
  domain: string;
  currency: string;
  dealsUrl: string;
  couponsUrl: string;
}
