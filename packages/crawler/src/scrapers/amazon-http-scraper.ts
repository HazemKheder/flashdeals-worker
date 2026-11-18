import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { ScrapedProduct, RegionConfig } from '../types/product';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
];

const LANGUAGE_CODES: Record<string, { en: string; native: string }> = {
  de: { en: 'en_GB', native: 'de_DE' },
  us: { en: 'en_US', native: 'en_US' },
  uk: { en: 'en_GB', native: 'en_GB' },
  fr: { en: 'en_GB', native: 'fr_FR' },
  it: { en: 'en_GB', native: 'it_IT' },
  es: { en: 'en_GB', native: 'es_ES' },
  ca: { en: 'en_CA', native: 'en_CA' },
};

/** Modern deals path: Amazon uses /deals (and .de uses /-/en/deals for English). */
const DEALS_PATH: Record<string, string> = {
  de: '/-/en/deals',
  us: '/deals',
  uk: '/deals',
  fr: '/deals',
  it: '/deals',
  es: '/deals',
  ca: '/deals',
};

/** Search path for "Today's Deals" (server-rendered product list when main deals grid is client-only). */
const DEALS_SEARCH_PATH: Record<string, string> = {
  de: '/-/en/s',
  us: '/s',
  uk: '/s',
  fr: '/s',
  it: '/s',
  es: '/s',
  ca: '/s',
};

/** ASINs we never treat as products (credit cards, etc.). */
const NON_PRODUCT_ASINS = new Set<string>(['B0CN8XJB15', 'B08HYJ6K1J']);

const REGION_CONFIGS: Record<string, RegionConfig> = {
  de: {
    code: 'de',
    domain: 'amazon.de',
    currency: 'EUR',
    dealsUrl: 'https://www.amazon.de/-/en/deals',
    couponsUrl: 'https://www.amazon.de/-/en/deals',
  },
  us: {
    code: 'us',
    domain: 'amazon.com',
    currency: 'USD',
    dealsUrl: 'https://www.amazon.com/deals',
    couponsUrl: 'https://www.amazon.com/deals',
  },
  uk: {
    code: 'uk',
    domain: 'amazon.co.uk',
    currency: 'GBP',
    dealsUrl: 'https://www.amazon.co.uk/deals',
    couponsUrl: 'https://www.amazon.co.uk/deals',
  },
  fr: {
    code: 'fr',
    domain: 'amazon.fr',
    currency: 'EUR',
    dealsUrl: 'https://www.amazon.fr/deals',
    couponsUrl: 'https://www.amazon.fr/deals',
  },
  it: {
    code: 'it',
    domain: 'amazon.it',
    currency: 'EUR',
    dealsUrl: 'https://www.amazon.it/deals',
    couponsUrl: 'https://www.amazon.it/deals',
  },
  es: {
    code: 'es',
    domain: 'amazon.es',
    currency: 'EUR',
    dealsUrl: 'https://www.amazon.es/deals',
    couponsUrl: 'https://www.amazon.es/deals',
  },
  ca: {
    code: 'ca',
    domain: 'amazon.ca',
    currency: 'CAD',
    dealsUrl: 'https://www.amazon.ca/deals',
    couponsUrl: 'https://www.amazon.ca/deals',
  },
};

export interface CategoryConfig {
  id: string;
  slug: string;
  amazonBubbleId: string;
}

export class AmazonHttpScraper {
  private region: RegionConfig;

  constructor(regionCode: string = 'de') {
    this.region = REGION_CONFIGS[regionCode] || REGION_CONFIGS.de;
  }

  static async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------------------------------------------------------------------------
  // HTTP fetching
  // ---------------------------------------------------------------------------

  private randomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  private getHeaders(language?: string): Record<string, string> {
    let acceptLang = 'en-US,en;q=0.9';
    if (language?.includes('de')) acceptLang = 'de-DE,de;q=0.9,en;q=0.8';
    else if (language?.includes('GB')) acceptLang = 'en-GB,en;q=0.9';

    return {
      'User-Agent': this.randomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': acceptLang,
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    };
  }

  async fetchPage(url: string, language?: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        headers: this.getHeaders(language),
        redirect: 'follow',
      });

      const text = await response.text();

      if (!response.ok) return null;

      return text;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Parsing utilities
  // ---------------------------------------------------------------------------

  /**
   * Upgrade an Amazon image URL to high resolution (1200px).
   * Amazon encodes size/quality in a suffix like `._AC_SF226,226_QL85_`
   * or `._AC_SL500_`. We strip all such suffixes and replace with large format.
   */
  static upscaleImageUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    return url
      .replace(/\._[A-Za-z0-9_,%]+_\./, '._AC_SL1200_.')
      .replace(/\?.*$/, '');
  }

  /**
   * Extract all product images from a product page.
   * Amazon stores image data in a JSON blob inside `data-a-dynamic-image`
   * and in the `imageGalleryData` / `colorImages` JS variable.
   */
  extractProductImages($: cheerio.CheerioAPI): string[] {
    const images = new Set<string>();

    // Strategy 1: data-a-dynamic-image JSON (landing image)
    const dynAttr = $('#landingImage').attr('data-a-dynamic-image')
      || $('#imgTagWrapperId img').attr('data-a-dynamic-image');
    if (dynAttr) {
      try {
        const obj = JSON.parse(dynAttr);
        for (const url of Object.keys(obj)) {
          const hi = AmazonHttpScraper.upscaleImageUrl(url);
          if (hi) images.add(hi);
        }
      } catch { /* ignore parse errors */ }
    }

    // Strategy 2: colorImages JS variable (contains hi-res URLs)
    const htmlStr = $.html();
    const colorImagesMatch = htmlStr.match(/'colorImages'\s*:\s*\{[^}]*'initial'\s*:\s*(\[[^\]]+\])/);
    if (colorImagesMatch?.[1]) {
      try {
        const arr = JSON.parse(colorImagesMatch[1].replace(/'/g, '"'));
        for (const item of arr) {
          const url = item.hiRes || item.large || item.main;
          if (url && typeof url === 'string') {
            const hi = AmazonHttpScraper.upscaleImageUrl(url);
            if (hi) images.add(hi);
          }
        }
      } catch { /* ignore */ }
    }

    // Strategy 3: thumbnail strip images
    $('#altImages .a-spacing-small img, #altImages .imageThumbnail img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && !src.includes('play-button') && !src.includes('video')) {
        const hi = AmazonHttpScraper.upscaleImageUrl(src);
        if (hi) images.add(hi);
      }
    });

    // Strategy 4: main image src as fallback
    const mainSrc = $('#landingImage').attr('src')
      || $('#imgTagWrapperId img').attr('src')
      || $('img[data-a-dynamic-image]').first().attr('src');
    if (mainSrc) {
      const hi = AmazonHttpScraper.upscaleImageUrl(mainSrc);
      if (hi) images.add(hi);
    }

    return Array.from(images);
  }

  parsePrice(priceText: string): number | null {
    if (!priceText) return null;
    let cleaned = priceText.replace(/[^\d.,]/g, '');
    // European format: 1.448,99 → 1448.99
    if (/\d+\.\d{3}/.test(cleaned)) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(',', '.');
    }
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }

  parseRating(ratingText: string): number | null {
    if (!ratingText) return null;
    const match = ratingText.match(/(\d+[.,]\d+)/);
    return match ? parseFloat(match[1].replace(',', '.')) : null;
  }

  extractAsin(url: string): string | null {
    const match = url.match(/\/dp\/([A-Z0-9]{10})|\/gp\/product\/([A-Z0-9]{10})/);
    return match ? (match[1] || match[2]) : null;
  }

  /** Exclude credit cards, gift-card promos, and other non-product items from deal scraping. */
  private isNonProductTitle(title: string): boolean {
    if (!title || title.length < 4) return true;
    const t = title.trim().toLowerCase();
    const nonProductPatterns = [
      /\b(amazon\s*)?(business\s*)?(amex|visa|mastercard|master\s*card)\b/i,
      /\b(amazon\s*)?(rewards\s*)?(credit\s*)?card\b/i,
      /\b(apply\s*now|jetzt\s*beantragen)\b/i,
      /\b(gift\s*card|geschenkgutschein)\s*$|^(\s*gift\s*card\s*)/i,
    ];
    return nonProductPatterns.some((p) => p.test(t));
  }

  private isCouponText(text: string): boolean {
    return /coupon|gutschein|voucher/i.test(text);
  }

  /** Extract "Coupon redeemed -€72.45" amount (the exact discount Amazon applies at checkout). */
  private extractCouponRedeemedAmount(text: string): number | null {
    if (!text) return null;
    const cleaned = text.replace(/\n/g, ' ').trim();
    // "Coupon redeemed -€72.45", "redeemed -€72.45", "−€72.45" (unicode minus), "Gutschein eingelöst -72,45 €"
    const patterns = [
      /(?:coupon|gutschein)\s+redeemed\s*[−-]\s*[€$£]\s*(\d+[.,]?\d*)/i,
      /redeemed\s*[−-]\s*[€$£]\s*(\d+[.,]?\d*)/i,
      /(?:coupon|gutschein)\s+eingelöst\s*[−-]\s*(\d+[.,]?\d*)\s*[€$£]/i,
      /eingelöst\s*[−-]\s*(\d+[.,]?\d*)\s*[€$£]/i,
      /[−-]\s*[€$£]\s*(\d+[.,]?\d*)\s*(?:redeemed|eingelöst)?/i,
      /[−-]\s*(\d+[.,]?\d*)\s*[€$£]\s*(?:redeemed|eingelöst)?/i,
    ];
    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match?.[1]) {
        const value = parseFloat(match[1].replace(',', '.'));
        if (value > 0) return value;
      }
    }
    return null;
  }

  private extractVoucherPrice(text: string): number | null {
    if (!text) return null;
    const cleaned = text.replace(/\n/g, ' ').trim();

    const patterns = [
      /[€$£]\s*(\d+[.,]?\d*)\s*(?:with|mit)\s*(?:voucher|coupon|gutschein)/i,
      /(\d+[.,]\d+)\s*[€$£]\s*(?:with|mit)\s*(?:voucher|coupon|gutschein)/i,
      /pay\s*[€$£]\s*(\d+[.,]?\d*)\s*(?:with|mit)/i,
      /zahlen?\s*(\d+[.,]\d+)\s*[€$£]/i,
      /(?:voucher|coupon|gutschein)\s*(?:price|preis)[:\s]*[€$£]\s*(\d+[.,]?\d*)/i,
      /(?:voucher|coupon|gutschein)\s*(?:price|preis)[:\s]*(\d+[.,]\d+)\s*[€$£]/i,
    ];

    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match?.[1]) {
        const value = parseFloat(match[1].replace(',', '.'));
        if (value > 0) return value;
      }
    }
    return null;
  }

  private parseCouponDiscount(
    text: string,
  ): { discountType: 'percentage' | 'fixed_amount'; discountValue: number; text: string } | null {
    if (!text) return null;
    const cleaned = this.stripCssFromText(text.trim());
    if (!cleaned) return null;

    // Prefer percentage that is clearly the coupon (e.g. "extra 5%", "5% with coupon") so we don't use the main deal % (e.g. 19%)
    const pctMatch =
      cleaned.match(/(?:extra|save)\s+(\d+)\s*%\s*(?:off)?\s*(?:with\s*coupon)?/i) ||
      cleaned.match(/(\d+)\s*%\s*(?:off)?\s*with\s*(?:coupon|voucher|gutschein)/i) ||
      cleaned.match(/(?:extra|save)\s+(\d+)\s*%|(\d+)\s*%\s*(?:off|with|mit)|(\d+)\s*%/i) ||
      cleaned.match(/(\d+)\s*%/);
    if (pctMatch) {
      const value = parseFloat((pctMatch[1] || pctMatch[2] || pctMatch[3] || pctMatch[4] || '0').replace(',', '.'));
      if (value > 0 && value <= 100) return { discountType: 'percentage', discountValue: value, text: cleaned };
    }

    // Fixed amount: "save €10", "€10 off", "10€ off", "$5 with voucher"
    const fixedMatch =
      cleaned.match(/(?:extra|save)\s*[€$£]\s*(\d+[.,]?\d*)|(?:extra|save)\s*(\d+[.,]?\d*)\s*[€$£]/i) ||
      cleaned.match(/[€$£]\s*(\d+[.,]?\d*)\s*(?:off|with|mit)?|[€$£]\s*(\d+[.,]?\d*)/i) ||
      cleaned.match(/(\d+[.,]?\d*)\s*[€$£]/);
    if (fixedMatch) {
      const value = parseFloat((fixedMatch[1] || fixedMatch[2] || '0').replace(',', '.'));
      if (value > 0) return { discountType: 'fixed_amount', discountValue: value, text: cleaned };
    }
    return null;
  }

  /**
   * Parse product-page voucher text: "Apply 5% voucher" / "Apply 50€ voucher" (EN) or
   * "Coupon: 10 %-Coupon anwenden" / "Coupon: 20€-Coupon anwenden" (DE). Always on already discounted price.
   */
  private parseApplyVoucher(
    text: string,
  ): { discountType: 'percentage' | 'fixed_amount'; discountValue: number; text: string } | null {
    if (!text) return null;
    const cleaned = this.stripCssFromText(text.replace(/\n/g, ' ').trim());
    if (!cleaned) return null;
    // EN: "Apply 5% voucher" / "Voucher: Apply 5% voucher" | DE: "Coupon: 10 %-Coupon anwenden" / "10 %-Coupon anwenden"
    const pctMatch = cleaned.match(
      /Apply\s+(\d+)\s*%\s*voucher|Voucher\s*:\s*Apply\s+(\d+)\s*%\s*voucher|(\d+)\s*%\s*(?:voucher|Gutschein)\s*(?:anwenden|apply)?/i
    ) || cleaned.match(/Coupon\s*:\s*(\d+)\s*%\s*-?\s*Coupon\s+anwenden|(\d+)\s*%\s*-?\s*Coupon\s+anwenden/i);
    if (pctMatch) {
      const value = parseFloat((pctMatch[1] || pctMatch[2] || pctMatch[3] || '0').replace(',', '.'));
      if (value > 0 && value <= 100) return { discountType: 'percentage', discountValue: value, text: cleaned };
    }
    // EN: "Apply 50€ voucher" | DE: "Coupon: 20€-Coupon anwenden" / "20€-Coupon anwenden"
    const fixedMatch = cleaned.match(
      /Apply\s+(\d+[.,]?\d*)\s*[€$£]\s*voucher|Voucher\s*:\s*Apply\s+(\d+[.,]?\d*)\s*[€$£]\s*voucher|Apply\s+[€$£]\s*(\d+[.,]?\d*)\s*voucher|(\d+[.,]?\d*)\s*[€$£]\s*(?:voucher|Gutschein)\s*(?:anwenden|apply)?/i
    ) || cleaned.match(/Coupon\s*:\s*(\d+[.,]?\d*)\s*[€$£]\s*-?\s*Coupon\s+anwenden|(\d+[.,]?\d*)\s*[€$£]\s*-?\s*Coupon\s+anwenden/i);
    if (fixedMatch) {
      const value = parseFloat((fixedMatch[1] || fixedMatch[2] || fixedMatch[3] || fixedMatch[4] || '0').replace(',', '.'));
      if (value > 0) return { discountType: 'fixed_amount', discountValue: value, text: cleaned };
    }
    return null;
  }

  /** Compute final price after applying voucher to the given (discounted) price. */
  private voucherPriceFromParsed(
    currentPrice: number,
    parsed: { discountType: 'percentage' | 'fixed_amount'; discountValue: number },
  ): number {
    if (parsed.discountType === 'percentage' && parsed.discountValue > 0 && parsed.discountValue <= 100) {
      return Math.round(currentPrice * (1 - parsed.discountValue / 100) * 100) / 100;
    }
    if (parsed.discountType === 'fixed_amount' && parsed.discountValue > 0) {
      const result = currentPrice - parsed.discountValue;
      return Math.round(Math.max(0, result) * 100) / 100;
    }
    return currentPrice;
  }

  // ---------------------------------------------------------------------------
  // Coupon extraction (works on both deal cards and product pages)
  // ---------------------------------------------------------------------------

  /** Get text from a cheerio element after stripping <style> and <script> tags. */
  private cleanElementText(el: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI): string {
    const clone = el.clone();
    clone.find('style, script').remove();
    return clone.text().replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  /** Remove CSS rules that leaked into text (e.g. `.foo { color: red; }`). */
  private stripCssFromText(text: string): string {
    return text
      .replace(/\.[a-zA-Z_][\w-]*\s*\{[^}]*\}/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  extractCoupon(
    $el: cheerio.Cheerio<AnyNode>,
    $: cheerio.CheerioAPI,
    currentPrice: number | null,
  ): ScrapedProduct['coupon'] {
    const fullText = this.cleanElementText($el, $);
    if (!this.isCouponText(fullText)) return undefined;

    // Strategy 1: exact voucher price ("You pay €X with voucher")
    const voucherPrice = this.extractVoucherPrice(fullText);
    if (voucherPrice != null && currentPrice != null && voucherPrice < currentPrice) {
      return {
        discountType: 'fixed_amount',
        discountValue: Math.round((currentPrice - voucherPrice) * 100) / 100,
        voucherPrice,
        text: `${voucherPrice.toFixed(2)} with voucher`,
      };
    }

    // Strategy 2: coupon-specific DOM elements
    const couponSelectors = [
      '.couponBadge', '[data-coupon-badge]',
      '.s-coupon-unclipped', '.s-coupon-clipped',
      '[class*="coupon"]', '[class*="Coupon"]',
      '[class*="voucher"]', '[class*="Voucher"]',
      '[class*="gutschein"]', '[class*="Gutschein"]',
    ];
    for (const sel of couponSelectors) {
      const el = $el.find(sel).first();
      if (el.length === 0) continue;
      const couponText = this.cleanElementText(el, $);
      if (this.isCouponText(couponText)) {
        const parsed = this.parseCouponDiscount(couponText);
        if (parsed) {
          const voucherPrice =
            currentPrice != null ? this.voucherPriceFromParsed(currentPrice, parsed) : undefined;
          return { ...parsed, voucherPrice };
        }
      }
    }

    // Strategy 3: text fragment containing coupon keyword
    const couponMatch = fullText.match(/[^.]*(?:coupon|gutschein|voucher)[^.]*/i);
    if (couponMatch) {
      const fragmentPrice = this.extractVoucherPrice(couponMatch[0]);
      if (fragmentPrice != null && currentPrice != null && fragmentPrice < currentPrice) {
        return {
          discountType: 'fixed_amount',
          discountValue: Math.round((currentPrice - fragmentPrice) * 100) / 100,
          voucherPrice: fragmentPrice,
          text: couponMatch[0].trim(),
        };
      }
      const parsed = this.parseCouponDiscount(couponMatch[0]);
      if (parsed) {
        const voucherPrice =
          currentPrice != null ? this.voucherPriceFromParsed(currentPrice, parsed) : undefined;
        return { ...parsed, voucherPrice };
      }
    }

    return undefined;
  }

  private extractCouponFromProductPage(
    $: cheerio.CheerioAPI,
    currentPrice: number | null,
  ): ScrapedProduct['coupon'] {
    if (currentPrice == null) return undefined;

    const selectors = [
      '#promoPriceBlockMessage_feature_div',
      '#vpcButton',
      '#couponBadge',
      '#couponFeature',
      '[id*="coupon"]',
      '[id*="voucher"]',
    ];

    for (const sel of selectors) {
      const el = $(sel).first();
      if (el.length === 0) continue;
      const text = this.cleanElementText(el, $);
      if (!this.isCouponText(text)) continue;

      // Product page standard: "Voucher: Apply 5% voucher" or "Voucher: Apply 50€ voucher" — always on already discounted price
      const applyVoucher = this.parseApplyVoucher(text);
      if (applyVoucher) {
        const voucherPrice = this.voucherPriceFromParsed(currentPrice, applyVoucher);
        return {
          ...applyVoucher,
          voucherPrice,
        };
      }

      // "Coupon redeemed -€X" (e.g. from cart/order summary)
      const redeemedAmount = this.extractCouponRedeemedAmount(text);
      if (redeemedAmount != null && redeemedAmount < currentPrice) {
        const voucherPrice = Math.round((currentPrice - redeemedAmount) * 100) / 100;
        return {
          discountType: 'fixed_amount',
          discountValue: Math.round(redeemedAmount * 100) / 100,
          voucherPrice,
          text: `${voucherPrice.toFixed(2)} with voucher`,
        };
      }

      const voucherPrice = this.extractVoucherPrice(text);
      if (voucherPrice != null && voucherPrice < currentPrice) {
        return {
          discountType: 'fixed_amount',
          discountValue: Math.round((currentPrice - voucherPrice) * 100) / 100,
          voucherPrice,
          text: `${voucherPrice.toFixed(2)} with voucher`,
        };
      }
      const parsed = this.parseCouponDiscount(text);
      if (parsed) {
        const voucherPrice = this.voucherPriceFromParsed(currentPrice, parsed);
        return { ...parsed, voucherPrice };
      }
    }

    // Fallback: scan body for "Apply X% voucher" / "Apply X€ voucher"
    const bodyText = $('body').text().replace(/\n/g, ' ');
    if (this.isCouponText(bodyText)) {
      const applyVoucher = this.parseApplyVoucher(bodyText);
      if (applyVoucher) {
        const voucherPrice = this.voucherPriceFromParsed(currentPrice, applyVoucher);
        return { ...applyVoucher, voucherPrice };
      }
      const redeemedAmount = this.extractCouponRedeemedAmount(bodyText);
      if (redeemedAmount != null && redeemedAmount < currentPrice) {
        const voucherPrice = Math.round((currentPrice - redeemedAmount) * 100) / 100;
        return {
          discountType: 'fixed_amount',
          discountValue: Math.round(redeemedAmount * 100) / 100,
          voucherPrice,
          text: `${voucherPrice.toFixed(2)} with voucher`,
        };
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Deals page scraping
  // ---------------------------------------------------------------------------

  buildDealsUrl(categoryBubbleId?: string, language?: string): string {
    const path = DEALS_PATH[this.region.code] ?? '/deals';
    const baseUrl = `https://www.${this.region.domain}${path}`;
    const params = new URLSearchParams();
    params.set('ref_', 'nav_cs_gb');
    if (language) params.set('language', language);
    if (categoryBubbleId) params.set('bubble-id', categoryBubbleId);
    return `${baseUrl}?${params.toString()}`;
  }

  /** URL for "Today's Deals" search results (often server-rendered with /dp/ links). */
  buildDealsSearchUrl(language?: string): string {
    const path = DEALS_SEARCH_PATH[this.region.code] ?? '/s';
    const baseUrl = `https://www.${this.region.domain}${path}`;
    const params = new URLSearchParams();
    params.set('i', 'todays-deals');
    if (language) params.set('language', language);
    return `${baseUrl}?${params.toString()}`;
  }

  /** Extract unique product ASINs from HTML (e.g. from search results). Excludes known non-products. */
  extractAsinsFromHtml(html: string): string[] {
    const asinRe = /\/dp\/([A-Z0-9]{10})(?:\?|$|["\/])/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = asinRe.exec(html)) !== null) {
      const asin = m[1];
      if (!NON_PRODUCT_ASINS.has(asin)) seen.add(asin);
    }
    return Array.from(seen);
  }

  /**
   * Extract deal ASINs (and optional merchantId) from deals page HTML.
   * Widget config contains "url":"/promotion/psp/...&redirectAsin=B0XXX&redirectMerchantId=A3XXX..."
   * which can be used to build product URLs: /dp/ASIN?m=MERCHANT_ID
   */
  extractDealAsinsFromResponse(html: string): { asin: string; merchantId?: string }[] {
    const seen = new Map<string, string | undefined>();
    const urlBlockRe = /"url"\s*:\s*"([^"]*?)"/g;
    let block: RegExpExecArray | null;
    while ((block = urlBlockRe.exec(html)) !== null) {
      const urlBlock = block[1];
      const asinM = urlBlock.match(/redirectAsin=([A-Z0-9]{10})/);
      if (!asinM) continue;
      const asin = asinM[1];
      if (NON_PRODUCT_ASINS.has(asin)) continue;
      const merchantM = urlBlock.match(/redirectMerchantId=([A-Z0-9]{14})/);
      const merchantId = merchantM ? merchantM[1] : undefined;
      if (!seen.has(asin)) seen.set(asin, merchantId);
    }
    return Array.from(seen.entries()).map(([asin, merchantId]) => ({ asin, merchantId }));
  }

  async scrapeDealsPage(
    category: CategoryConfig | null,
    language: string,
    maxProducts: number = 50,
  ): Promise<ScrapedProduct[]> {
    const url = this.buildDealsUrl(category?.amazonBubbleId, language);
    const html = await this.fetchPage(url, language);
    if (!html) return [];

    const $ = cheerio.load(html);
    const products: ScrapedProduct[] = [];
    const seenAsins = new Set<string>();

    const dealSelectors = [
      '[data-testid="product-card"]',
      '[data-testid="deal-card"]',
      '[data-component-type="s-search-result"]',
      '[data-deal-id]',
      '.a-carousel-card',
      '.octopus-pc-card-content',
    ];

    for (const selector of dealSelectors) {
      if (products.length >= maxProducts) break;

      $(selector).each((_, element) => {
        if (products.length >= maxProducts) return false;
        const $el = $(element);

        const href =
          $el.find('a[href*="/dp/"]').first().attr('href') ||
          $el.find('a[data-testid="product-card-link"][href*="/dp/"]').first().attr('href') ||
          $el.find('a[href*="/deal/"]').first().attr('href') ||
          $el.find('a').first().attr('href');
        if (!href) return;

        const fullUrl = href.startsWith('http') ? href : `https://www.${this.region.domain}${href}`;
        let asin = this.extractAsin(fullUrl) || $el.attr('data-asin') || null;
        if (!asin || seenAsins.has(asin)) return;
        seenAsins.add(asin);

        const title =
          $el.find('.a-truncate-full.a-offscreen').first().text().trim() ||
          $el.find('p[id^="title-"]').first().text().trim() ||
          $el.find('h2, .a-text-normal, [data-component-type="s-product-title"]').first().text().trim() ||
          $el.find('a').first().attr('title') ||
          $el.find('img').first().attr('alt');

        const priceText =
          $el.find('[data-testid="price-section"] .a-price .a-offscreen').first().text() ||
          $el.find('.a-price .a-offscreen, .a-price-whole').first().text();
        const price = this.parsePrice(priceText);

        const origPriceText = $el.find('.a-text-price .a-offscreen, .a-price.a-text-price').first().text();
        const originalPrice = this.parsePrice(origPriceText);

        const discountText = $el.find('.savingsPercentage, .a-color-price').first().text();
        const discountMatch = discountText.match(/(\d+)/);
        const discountPercent = discountMatch
          ? parseFloat(discountMatch[1])
          : price && originalPrice && originalPrice > price
            ? Math.round(((originalPrice - price) / originalPrice) * 100)
            : undefined;

        const rawImgUrl =
          $el.find('img[data-a-dynamic-image]').first().attr('src') ||
          $el.find('img.s-image').first().attr('src') ||
          $el.find('img').first().attr('src') ||
          $el.find('img').first().attr('data-src');
        const imageUrl = AmazonHttpScraper.upscaleImageUrl(rawImgUrl ?? undefined);

        const ratingText = $el.find('.a-icon-alt, [aria-label*="stars"]').first().text();
        const rating = this.parseRating(ratingText);

        const coupon = this.extractCoupon($el, $, price);

        if (title && title.length > 3 && !this.isNonProductTitle(title)) {
          products.push({
            asin,
            title,
            price: price || undefined,
            originalPrice: originalPrice || undefined,
            discountPercent,
            currency: this.region.currency,
            imageUrl: imageUrl || undefined,
            productUrl: fullUrl,
            rating: rating || undefined,
            categoryId: category?.id,
            coupon,
          });
        }
      });
    }

    // Fallback: extract product links when deal card selectors didn't match
    if (products.length === 0) {
      $('a[href*="/dp/"]').each((_, el) => {
        if (products.length >= maxProducts) return false;
        const href = $(el).attr('href');
        if (!href) return;
        const asin = this.extractAsin(href);
        if (!asin || seenAsins.has(asin)) return;
        seenAsins.add(asin);

        const fullUrl = href.startsWith('http') ? href : `https://www.${this.region.domain}${href}`;
        const title = $(el).attr('title') || $(el).text().trim() || $(el).find('img').attr('alt');
        if (title && title.length > 5 && !this.isNonProductTitle(title)) {
          products.push({
            asin,
            title,
            currency: this.region.currency,
            productUrl: fullUrl,
            categoryId: category?.id,
          });
        }
      });
    }

    // Coupons category: if bubble page had no real products, fetch main Goldbox and keep only deals with coupon data
    const isCouponsCategory = category?.slug === 'coupons';
    if (isCouponsCategory && products.length === 0) {
      const mainUrl = this.buildDealsUrl(undefined, language);
      const mainHtml = await this.fetchPage(mainUrl, language);
      if (mainHtml) {
        const $main = cheerio.load(mainHtml);
        const mainProducts: ScrapedProduct[] = [];
        const mainSeen = new Set<string>();

        for (const selector of dealSelectors) {
          if (mainProducts.length >= maxProducts) break;
          $main(selector).each((_, element) => {
            if (mainProducts.length >= maxProducts) return false;
            const $el = $main(element);
            const href =
              $el.find('a[href*="/dp/"]').first().attr('href') ||
              $el.find('a[href*="/deal/"]').first().attr('href') ||
              $el.find('a').first().attr('href');
            if (!href) return;
            const fullUrl = href.startsWith('http') ? href : `https://www.${this.region.domain}${href}`;
            const asin = this.extractAsin(fullUrl);
            if (!asin || mainSeen.has(asin)) return;
            mainSeen.add(asin);

            const title =
              $el.find('h2, .a-text-normal, [data-component-type="s-product-title"]').first().text().trim() ||
              $el.find('a').first().attr('title') ||
              $el.find('img').first().attr('alt');
            if (!title || title.length <= 3 || this.isNonProductTitle(title)) return;

            const priceText = $el.find('.a-price .a-offscreen, .a-price-whole').first().text();
            const price = this.parsePrice(priceText);
            const origPriceText = $el.find('.a-text-price .a-offscreen, .a-price.a-text-price').first().text();
            const originalPrice = this.parsePrice(origPriceText);
            const discountText = $el.find('.savingsPercentage, .a-color-price').first().text();
            const discountMatch = discountText.match(/(\d+)/);
            const discountPercent = discountMatch
              ? parseFloat(discountMatch[1])
              : price && originalPrice && originalPrice > price
                ? Math.round(((originalPrice - price) / originalPrice) * 100)
                : undefined;
            const rawImgUrl =
              $el.find('img[data-a-dynamic-image]').first().attr('src') ||
              $el.find('img.s-image').first().attr('src') ||
              $el.find('img').first().attr('src') ||
              $el.find('img').first().attr('data-src');
            const imageUrl = AmazonHttpScraper.upscaleImageUrl(rawImgUrl ?? undefined);
            const ratingText = $el.find('.a-icon-alt, [aria-label*="stars"]').first().text();
            const rating = this.parseRating(ratingText);
            const coupon = this.extractCoupon($el, $main, price);

            if (coupon) {
              mainProducts.push({
                asin,
                title,
                price: price || undefined,
                originalPrice: originalPrice || undefined,
                discountPercent,
                currency: this.region.currency,
                imageUrl: imageUrl || undefined,
                productUrl: fullUrl,
                rating: rating || undefined,
                categoryId: category?.id,
                coupon,
              });
            }
          });
        }

        if (mainProducts.length > 0) {
          products.push(...mainProducts);
        }
      }
    }

    if (products.length === 0) {
      const dealEntries = this.extractDealAsinsFromResponse(html || '');
      if (dealEntries.length > 0) {
        for (let i = 0; i < dealEntries.length && products.length < maxProducts; i++) {
          await AmazonHttpScraper.delay(800);
          const { asin, merchantId } = dealEntries[i];
          const scraped = await this.scrapeProductPage(asin, language, merchantId);
          if (scraped && !this.isNonProductTitle(scraped.title)) {
            products.push({
              ...scraped,
              categoryId: category?.id,
            });
          }
        }
      }
    }
    return products;
  }

  // ---------------------------------------------------------------------------
  // Individual product page scraping
  // ---------------------------------------------------------------------------

  buildProductUrl(asin: string, merchantId?: string): string {
    const base = `https://www.${this.region.domain}/dp/${asin}`;
    return merchantId ? `${base}?m=${merchantId}` : base;
  }

  async scrapeProductPage(asin: string, language?: string, merchantId?: string): Promise<ScrapedProduct | null> {
    const url = this.buildProductUrl(asin, merchantId);
    const html = await this.fetchPage(url, language);
    if (!html) return null;

    const $ = cheerio.load(html);

    // Title
    const title =
      $('#productTitle').text().trim() ||
      $('h1#title span').text().trim() ||
      $('h1').first().text().trim();
    if (!title) return null;

    // Price
    let price: number | null = null;
    for (const sel of [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      '#corePrice_feature_div .a-price .a-offscreen',
      '.a-price .a-offscreen',
    ]) {
      price = this.parsePrice($(sel).first().text().trim());
      if (price) break;
    }

    // Original / list price
    let originalPrice: number | null = null;
    for (const sel of [
      '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
      '.basisPrice .a-price .a-offscreen',
      '#corePrice_feature_div .a-text-price .a-offscreen',
      '.a-text-price .a-offscreen',
    ]) {
      originalPrice = this.parsePrice($(sel).first().text().trim());
      if (originalPrice && originalPrice !== price) break;
      originalPrice = null;
    }

    // Discount
    let discountPercent: number | undefined;
    const savingsText = $('.savingsPercentage').first().text();
    const savingsMatch = savingsText.match(/(\d+)/);
    if (savingsMatch) {
      discountPercent = parseFloat(savingsMatch[1]);
    } else if (price && originalPrice && originalPrice > price) {
      discountPercent = Math.round(((originalPrice - price) / originalPrice) * 100);
    }

    // Images (high-res + gallery)
    const allProductImages = this.extractProductImages($);
    const imageUrl = allProductImages[0] || AmazonHttpScraper.upscaleImageUrl(
      $('#landingImage').attr('src') ||
      $('#imgTagWrapperId img').attr('src') ||
      $('img[data-a-dynamic-image]').first().attr('src') ||
      undefined
    );
    const imageUrls = allProductImages.length > 1 ? allProductImages : undefined;

    // Rating & reviews
    const ratingText =
      $('#acrPopover .a-icon-alt').text() ||
      $('i.a-icon-star-small .a-icon-alt').text();
    const rating = this.parseRating(ratingText);

    const reviewText = $('#acrCustomerReviewText').text();
    const reviewMatch = reviewText.match(/[\d.,]+/);
    const reviewCount = reviewMatch ? parseInt(reviewMatch[0].replace(/[.,]/g, ''), 10) : undefined;

    // Availability
    const availText = $('#availability span').first().text().trim();
    const isAvailable = !availText || /in stock|auf lager|verfügbar|sofort/i.test(availText);

    // Prime
    const isPrime = $('#prime-badge').length > 0 || $('.a-icon-prime').length > 0;

    // Coupon from product page
    const coupon = this.extractCouponFromProductPage($, price);

    return {
      asin,
      title,
      price: price || undefined,
      originalPrice: originalPrice || undefined,
      discountPercent,
      currency: this.region.currency,
      imageUrl: imageUrl || undefined,
      imageUrls,
      productUrl: url,
      rating: rating || undefined,
      reviewCount: reviewCount || undefined,
      availability: isAvailable ? 'In Stock' : availText,
      isPrime,
      coupon,
    };
  }

  // ---------------------------------------------------------------------------
  // Combined discovery pipeline
  // ---------------------------------------------------------------------------

  async discoverDeals(
    category: CategoryConfig | null,
    maxProducts: number,
    delayBetweenRequests: number,
  ): Promise<Map<string, ScrapedProduct>> {
    const productMap = new Map<string, ScrapedProduct>();
    const languages = LANGUAGE_CODES[this.region.code] || LANGUAGE_CODES.de;

    const nativeProducts = await this.scrapeDealsPage(category, languages.native, maxProducts);
    for (const p of nativeProducts) {
      productMap.set(p.asin, { ...p, descriptionDe: p.title });
    }

    // 2. Fetch deals page in English (if different from native)
    if (languages.en !== languages.native) {
      await AmazonHttpScraper.delay(delayBetweenRequests);
      const enProducts = await this.scrapeDealsPage(category, languages.en, maxProducts);
      for (const p of enProducts) {
        const existing = productMap.get(p.asin);
        if (existing) {
          existing.descriptionEn = p.title;
          existing.title = p.title;
          // Merge any data that native didn't have
          if (!existing.price && p.price) existing.price = p.price;
          if (!existing.imageUrl && p.imageUrl) existing.imageUrl = p.imageUrl;
          if (!existing.coupon && p.coupon) existing.coupon = p.coupon;
        } else {
          productMap.set(p.asin, { ...p, descriptionEn: p.title });
        }
      }
    } else {
      for (const [, p] of productMap) {
        p.descriptionEn = p.title;
        if (!p.descriptionDe) p.descriptionDe = p.title;
      }
    }

    // 3. Enrich every product via its individual page for hi-res images + gallery
    for (const [asin, product] of productMap) {
      await AmazonHttpScraper.delay(delayBetweenRequests);
      const detailed = await this.scrapeProductPage(asin, languages.en);
      if (!detailed) continue;

      if (!product.price && detailed.price) product.price = detailed.price;
      if (!product.originalPrice && detailed.originalPrice) product.originalPrice = detailed.originalPrice;
      if (!product.discountPercent && detailed.discountPercent) product.discountPercent = detailed.discountPercent;
      if (detailed.imageUrl) product.imageUrl = detailed.imageUrl;
      if (detailed.imageUrls?.length) product.imageUrls = detailed.imageUrls;
      if (!product.rating && detailed.rating) product.rating = detailed.rating;
      if (!product.reviewCount && detailed.reviewCount) product.reviewCount = detailed.reviewCount;
      if (!product.coupon && detailed.coupon) product.coupon = detailed.coupon;
      if (!product.isPrime && detailed.isPrime) product.isPrime = detailed.isPrime;
    }

    return productMap;
  }

  getRegionConfig(): RegionConfig {
    return this.region;
  }
}
