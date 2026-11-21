/**
 * Title-based category relevance.
 * Amazon deal "bubble" pages often ignore the filter during big events and
 * return the same featured grid for every category — we must validate locally.
 */

type LocaleHints = {
  /** At least one include token should appear for a confident match. */
  include: string[];
  /** Hard reject if any of these appear (unless an include token also hits). */
  exclude?: string[];
};

const CATEGORY_HINTS: Record<string, LocaleHints> = {
  // Deal-type feeds (not product taxonomy). Matching is handled specially —
  // any deal title is acceptable for these slugs.
  coupons: {
    include: [],
  },
  'lightning-deals': {
    include: [],
  },
  computers: {
    include: [
      'laptop', 'notebook', 'computer', 'pc ', 'macbook', 'imac', 'monitor', 'gpu', 'grafikkarte',
      'ssd', 'tastatur', 'keyboard', 'maus', 'mouse', 'router', 'drucker', 'printer', 'tablet',
      'ordinateur', 'écran', 'computer', 'ordenador', 'bildschirm',
    ],
    exclude: ['jeans', 'shirt', 'kleid', 'handtuch', 'towel', 'garten', 'rasenmäher'],
  },
  'home-kitchen': {
    include: [
      'küche', 'kitchen', 'kochen', 'pfanne', 'topf', 'mixer', 'toaster', 'kaffee', 'coffee',
      'staubsauger', 'vacuum', 'saugroboter', 'heißluft', 'air fryer', 'bettwäsche', 'handtuch',
      'towel', 'waschen', 'bügeleisen', 'haushalt', 'cuisine', 'cocina', 'keuken', 'fritteuse',
      'mikrowelle', 'dishwasher', 'geschirr',
    ],
    exclude: ['jeans', 'sneaker', 'kleid', 'rasenmäher', 'gartenmöbel'],
  },
  fashion: {
    include: [
      'jeans', 'hose', 'shirt', 't-shirt', 'kleid', 'jacke', 'mantel', 'schuhe', 'sneaker',
      'pullover', 'cardigan', 'unterwäsche', 'socken', 'mode', 'fashion', 'veste', 'vests',
      'vest ', 'pantalon', 'abito', 'vestido', 'jumper', 'hoodie', 'blazer', 'rock', 'skirt',
      'shorts', 'leggings', 'amazon essentials', 'sweater', 'blouse', 'hemd', 'trui',
    ],
    exclude: ['rasenmäher', 'gartenbox', 'notebook', 'grafikkarte', 'saugroboter', 'zahnbürste', 'rasierer'],
  },
  beauty: {
    include: [
      'beauty', 'pflege', 'shampoo', 'creme', 'serum', 'rasierer', 'zahnbürste', 'haartrockner',
      'glätteisen', 'makeup', 'parfum', 'parfüm', 'beauté', 'bellezza', 'belleza', 'ipl',
      'haarentfern', 'skin', 'gesicht',
    ],
  },
  toys: {
    include: [
      'spielzeug', 'toy', 'lego', 'puzzle', 'puppe', 'barbie', 'nintendo', 'playstation',
      'xbox', 'brettspiel', 'jouet', 'giocattolo', 'juguete', 'speelgoed',
    ],
  },
  automotive: {
    include: [
      'auto', 'kfz', 'motor', 'reifen', 'öl', 'oil', 'fahrzeug', 'car ', 'automotive',
      'scheibenwischer', 'batterie auto', 'voiture', 'coche',
    ],
  },
  grocery: {
    include: [
      'lebensmittel', 'grocery', 'kaffee bohnen', 'tee ', 'schokolade', 'snack', 'nudeln',
      'pasta', 'öl nativ', 'épicerie', 'alimentari', 'alimentación', 'boodschappen', 'getränk',
    ],
  },
  smartphones: {
    include: [
      'smartphone', 'handy', 'iphone', 'galaxy', 'pixel', 'handyhülle', 'phone case',
      'ladegerät', 'charger', 'airpods', 'kopfhörer', 'headphone', 'earbuds',
    ],
  },
  garden: {
    include: [
      'garten', 'garden', 'rasenmäher', 'lawn mower', 'unkraut', 'hecke', 'heckenschere',
      'laubbläser', 'gartenmöbel', 'gartenbox', 'poolbox', 'terrassen', 'balkonmöbel',
      'campingstuhl', 'campingtisch', 'pavillon', 'sichtschutz', 'zaun', 'hochbeet',
      'gewächshaus', 'jardin', 'giardino', 'jardín', 'tuin', 'nematoden', 'vogelfutter',
      'meisenknödel', 'fliegenfalle', 'zimmerpflanze', 'gartenpflanze', 'blumenkasten',
      'pflanzenerde', 'kompost', 'gartenschlauch', 'gießkanne', 'grillwagen', 'trampolin',
      'bierzeltgarnitur', 'aufbewahrungsbox für den garten', 'outdoor trampoline',
    ],
    exclude: [
      'jeans', 'shirt', 't-shirt', 'pullover', 'cardigan', 'kleid', 'socken', 'hoodie',
      'handtuch', 'towel', 'waschlappen', 'washcloth', 'unterwäsche', 'vests', 'veste pack',
      'notebook', 'imac', 'mac mini', 'smartphone', 'iphone', 'rasierer', 'shaver',
      'haarfarbe', 'hair color', 'zahnbürste', 'nespresso', 'multigroom', 'play-doh',
    ],
  },
  baby: {
    include: [
      'baby', 'windel', 'kinderwagen', 'schnuller', 'babyflasche', 'bébé', 'bambini', 'bebé',
      'kindersitz', 'wickel',
    ],
  },
  electronics: {
    include: [
      'tv ', 'fernseher', 'lautsprecher', 'speaker', 'kamera', 'camera', 'elektronik',
      'headphones', 'kopfhörer', 'smartwatch', 'console',
    ],
  },
  sports: {
    include: [
      'sport', 'fitness', 'yoga', 'fahrrad', 'bike', 'hantel', 'lauf', 'outdoor sport',
    ],
  },
  books: {
    include: ['buch', 'book', 'roman', 'kindle', 'livre', 'libro', 'boek'],
  },
};

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ' ');
}

const DEAL_TYPE_SLUGS = new Set(['coupons', 'lightning-deals']);

export type CategoryMatchMode = 'strict' | 'exclude-only';

/** Returns true when the product title plausibly belongs to the category. */
export function matchesCategory(
  slug: string,
  title: string | null | undefined,
  mode: CategoryMatchMode = 'strict',
): boolean {
  if (!title) return false;
  // Coupons / lightning are deal feeds, not product departments.
  if (DEAL_TYPE_SLUGS.has(slug)) return true;

  const hints = CATEGORY_HINTS[slug];
  if (!hints) return true; // unknown category: don't block

  const hay = ` ${normalize(title)} `;
  const excluded = (hints.exclude || []).some((token) => hay.includes(normalize(token)));
  if (excluded) return false;
  if (mode === 'exclude-only') return true;

  const included = hints.include.some((token) => hay.includes(normalize(token)));
  if (hints.include.length === 0) return true;
  return included;
}

/** Best-effort category suggestion from title (used for cleanup / reassignment). */
export function suggestCategorySlug(title: string | null | undefined): string | null {
  if (!title) return null;
  const candidates = Object.keys(CATEGORY_HINTS).filter((slug) =>
    !['coupons', 'lightning-deals'].includes(slug) && matchesCategory(slug, title),
  );
  if (candidates.length === 0) return null;
  // Prefer more specific marketplace departments over broad home/electronics.
  const priority = [
    'books', 'garden', 'fashion', 'baby', 'toys', 'smartphones', 'computers',
    'beauty', 'automotive', 'grocery', 'sports', 'home-kitchen', 'electronics',
  ];
  for (const slug of priority) {
    if (candidates.includes(slug)) return slug;
  }
  return candidates[0];
}
