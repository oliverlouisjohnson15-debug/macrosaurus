/*
 * parse.ts - Every pure "read the menu out of this page" rule, split from index.ts (which keeps the
 * network I/O, the SSRF guards and the request handler) so the parsing can be unit-tested against
 * fixtures. Same split, and the same reasoning, as recipe-extract/parse.ts.
 *
 * WHY THIS EXISTS AT ALL, given app/menu.js says a link cannot give you a menu. That note was
 * written after testing sixteen URLs, and its conclusion held for every one of them - but they were
 * all the same two kinds of page: a chain's marketing site (Nando's, Wagamama, Pret) and a delivery
 * aggregator (Deliveroo, Just Eat). Chains render menus in JavaScript from a private API; the
 * aggregators 403 anything without a browser fingerprint. Both conclusions are still true and this
 * file does not try to beat either of them.
 *
 * What the sample missed is the page people actually paste, which is the third kind: a REGIONAL
 * ORDERING PLATFORM. Every town has one, they are built on a handful of white-label codebases, and
 * those codebases are Next.js and Nuxt apps that server-render for SEO - which means the menu is
 * sitting in the HTML as JSON, already structured, with sections and prices, needing no browser and
 * no rendering service. The independents that have their own site are the fourth kind, and a good
 * number of those publish schema.org Menu/hasMenu markup for Google, or link a PDF that is real
 * text. None of that is scraping in the arms-race sense: it is reading the structured data these
 * pages publish deliberately, for machines, to be found.
 *
 * So the ladder below climbs from most structured to least, and stops at the first rung that yields
 * something that actually looks like a menu:
 *
 *   1. JSON-LD          - schema.org Menu / hasMenu / MenuSection / MenuItem. Published on purpose,
 *                         correctly labelled, and the only rung where a dish is unambiguously a dish.
 *   2. Embedded state   - __NEXT_DATA__, Nuxt's __NUXT__, React flight chunks, Apollo caches. The
 *                         shape is different on every platform and changes without warning, so this
 *                         rung does not look for a known shape: it WALKS the JSON and recognises a
 *                         dish by what a dish has (a name, and a price or a description).
 *   3. Visible text     - the page with its script, style and navigation stripped, kept only if what
 *                         is left reads like a menu (prices against dish-shaped lines).
 *   4. A linked PDF     - handed back as a URL for the client to send as a document block, because
 *                         menu PDFs are usually real text and reading the text beats photographing
 *                         the page it is printed on.
 *
 * EVERY function here degrades to '' / [] / null rather than throwing, and none of them decide
 * anything on their own: a rung's output is accepted only if `looksLikeMenu` agrees it is a menu.
 * The cost of a false positive is worse than a miss - a page of navigation links handed to the model
 * as "the menu" produces six confidently-priced dishes that do not exist, which is precisely the
 * failure this whole feature is built to avoid. A miss just falls through to the camera.
 *
 * Types are stripped by node for the tests; it ships as-is to the Deno edge runtime.
 */

export const MAX_MENU_TEXT = 14000; // cap the text handed to the AI call, generous for a long menu
export const clip = (s: string, n = MAX_MENU_TEXT) => ((s || '').length > n ? (s || '').slice(0, n) : (s || ''));

/* Deliberately copied from recipe-extract/parse.ts rather than imported: each edge function deploys
   as its own bundle from its own directory, and a shared module across the two would couple their
   deploys together for the sake of thirty lines. */
export function decodeEntities(h: string): string {
  return (h || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => { try { return String.fromCodePoint(parseInt(x, 16)); } catch { return ' '; } });
}

// ---- the shape of a dish -------------------------------------------------------------------------

export interface Dish { section: string; name: string; description: string; price: string }

const MONEY = /£\s?\d{1,3}(?:[.,]\d{2})?|\d{1,3}[.,]\d{2}\s?(?:GBP|£)/gi;

/* A price, normalised to a string we can print, from any of the half-dozen shapes a platform stores
   one in: a number, a string with a symbol, or an {amount, currency} object. Pence are the trap -
   ordering platforms overwhelmingly store money as integer minor units, so a bare 850 is £8.50 and
   not an eight-hundred-pound main course. Anything at or above 200 with no decimal part is read as
   pence, which is right for every real menu price and wrong only for a £200+ item nobody sells. */
export function priceText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['amount', 'value', 'price', 'gross', 'minor', 'amountMinor']) {
      if (o[k] != null && typeof o[k] !== 'object') return priceText(o[k]);
    }
    return '';
  }
  if (typeof v === 'number') {
    if (!isFinite(v) || v <= 0) return '';
    const p = Number.isInteger(v) && v >= 200 ? v / 100 : v;
    return '£' + p.toFixed(2);
  }
  const s = String(v).trim();
  if (!s) return '';
  const m = s.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return '';
  const n = Number(m[1].replace(',', '.'));
  if (!isFinite(n) || n <= 0) return '';
  // A string price is written by a human or rendered for display, so it is already in pounds even
  // when it is a round number: "8" is £8, never 8p.
  const pounds = /^\d+$/.test(m[1]) && n >= 1000 ? n / 100 : n;
  return '£' + pounds.toFixed(2);
}

const NOT_A_DISH = /^(home|menu|menus|order|order now|basket|checkout|sign in|log ?in|register|account|contact|about|about us|delivery|collection|opening hours|reviews|allergens|privacy|terms|cookies|search|filter|back|next|previous|more|view all|see more|book|book a table|gift cards?|careers|jobs|faq|help|£?\d+(\.\d+)?)$/i;
const URLISH = /^(https?:|\/|#|data:|www\.)/i;

/* Does this look like the name of a dish, as opposed to a button, a slug or a heading? Kept strict
   on the things that are cheap to test and silent about the rest: length, at least one letter, not
   navigation furniture, not a URL or an id. Judging "is this food" by vocabulary was tried and
   dropped - it threw away every dish with a made-up name, which on a real menu is most of them. */
export function isDishName(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 2 || t.length > 90) return false;
  if (!/[a-z]/i.test(t)) return false;
  if (URLISH.test(t)) return false;
  if (/^[a-f0-9]{8,}$/i.test(t) || /^[a-z0-9_-]{20,}$/i.test(t)) return false; // an id or a slug
  if (NOT_A_DISH.test(t)) return false;
  return true;
}

// ---- rung 1: JSON-LD ------------------------------------------------------------------------------

/* Every <script type="application/ld+json"> on the page, parsed, with @graph containers flattened
   away so callers see a flat list of typed nodes. Invalid blocks are skipped rather than thrown:
   pages routinely ship one broken block alongside three good ones. */
export function jsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || ''))) {
    let parsed: any;
    try { parsed = JSON.parse(decodeEntities(m[1].trim())); } catch { continue; }
    const push = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(push); return; }
      if (Array.isArray(n['@graph'])) { n['@graph'].forEach(push); return; }
      out.push(n);
    };
    push(parsed);
  }
  return out;
}

const typeOf = (n: any): string[] => {
  const t = n && (n['@type'] ?? n.type);
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x: unknown) => String(x));
};
const hasType = (n: any, re: RegExp) => typeOf(n).some((t) => re.test(t));

/* The dishes out of schema.org markup. A Menu holds hasMenuSection holds hasMenuItem, but real
   pages nest those in every combination and skip levels freely, so this recurses over whatever it
   finds and carries the nearest enclosing section name down with it. */
export function dishesFromJsonLd(blocks: any[]): Dish[] {
  const out: Dish[] = [];
  const seen = new Set<any>();
  const walk = (node: any, section: string, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 8 || out.length > 400) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, section, depth + 1); return; }
    if (seen.has(node)) return;
    seen.add(node);

    const name = typeof node.name === 'string' ? node.name.trim() : '';
    if (hasType(node, /MenuSection$/i) && name) section = name;
    if (hasType(node, /MenuItem$/i) && isDishName(name)) {
      out.push({
        section,
        name,
        description: typeof node.description === 'string' ? node.description.trim() : '',
        price: priceText(node.offers ? (Array.isArray(node.offers) ? node.offers[0]?.price : (node.offers as any).price) : node.price),
      });
    }
    for (const k of ['hasMenu', 'hasMenuSection', 'hasMenuItem', 'menu', 'itemListElement', 'item', 'offers', 'mainEntity']) {
      if (node[k]) walk(node[k], section, depth + 1);
    }
  };
  for (const b of blocks) walk(b, '', 0);
  return dedupeDishes(out);
}

/* The restaurant's own name, as the page declares it. Preferred over anything read out of the URL:
   a listing page states who it is for, and a stated name beats a guessed one every time. */
export function placeFromJsonLd(blocks: any[]): string {
  for (const b of blocks) {
    if (!hasType(b, /(Restaurant|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|FastFoodRestaurant|LocalBusiness)$/i)) continue;
    const n = typeof b.name === 'string' ? b.name.trim() : '';
    if (n && n.length < 80) return n;
  }
  return '';
}

// ---- rung 2: whatever JSON the page shipped its state in --------------------------------------------

// Find the first balanced {...} or [...] at/after a marker. Braces inside strings are ignored.
export function jsonAfter(html: string, marker: string, open: '{' | '[' = '{'): any {
  const close = open === '{' ? '}' : ']';
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf(open, at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/* Every blob of state a server-rendered page might have left behind. Next.js has shipped three
   different mechanisms in as many years (__NEXT_DATA__, then flight chunks pushed into
   self.__next_f, and the streamed payload split across many script tags), Nuxt has __NUXT__, and
   Apollo/urql caches turn up under half a dozen names, so this collects them all and lets the dish
   walker sort out which one actually held the menu. */
export function stateBlobs(html: string): any[] {
  const out: any[] = [];
  const push = (v: any) => { if (v && typeof v === 'object') out.push(v); };

  const nd = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nd) { try { push(JSON.parse(nd[1].trim())); } catch { /* next rung */ } }

  for (const marker of ['window.__NUXT__', '__NUXT_DATA__', 'window.__APOLLO_STATE__', 'window.__INITIAL_STATE__', 'window.__PRELOADED_STATE__', 'window.__remixContext']) {
    push(jsonAfter(html, marker));
  }

  /* React Server Component flight data: dozens of self.__next_f.push([1,"...json fragment..."])
     calls whose string payloads concatenate into one stream. The stream as a whole is not valid
     JSON - it is line-prefixed chunks - so rather than reassemble it, take every balanced JSON
     object out of the decoded text and let the walker look inside each. */
  const flight: string[] = [];
  const fre = /self\.__next_f\.push\(\[\d+\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\)/g;
  let fm: RegExpExecArray | null;
  while ((fm = fre.exec(html))) {
    try { flight.push(JSON.parse('"' + fm[1] + '"')); } catch { /* skip this chunk */ }
  }
  if (flight.length) {
    const stream = flight.join('');
    for (let i = 0; i < stream.length && out.length < 40; i++) {
      // Only start at an object that could plausibly hold records, not at every brace in the stream.
      if (stream[i] !== '{' || !/"(name|title|items|products|menu|categories|sections)"/.test(stream.slice(i, i + 400))) continue;
      const v = jsonAfter(stream.slice(i), '');
      if (v && typeof v === 'object') { push(v); i += 200; }
    }
  }
  return out;
}

const NAME_KEYS = ['name', 'title', 'itemName', 'productName', 'displayName', 'label'];
const DESC_KEYS = ['description', 'desc', 'summary', 'subtitle', 'details', 'ingredients'];
const PRICE_KEYS = ['price', 'basePrice', 'unitPrice', 'amount', 'cost', 'priceGbp', 'price_gbp', 'minPrice', 'displayPrice'];
const SECTION_KEYS = ['categoryName', 'category', 'sectionName', 'section', 'groupName', 'courseName'];
const CHILD_KEYS = /^(items|products|dishes|menuItems|menu_items|categories|sections|groups|courses|children|data|nodes|edges|node|results|menus|menu|elements|list|options)$/i;

const str = (o: any, keys: string[]): string => {
  for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v.trim()) return v.trim(); }
  return '';
};

/* Recognise a dish in an unknown JSON shape, by what a dish HAS rather than where it sits. A record
   qualifies on a usable name plus either a price or a description - which is exactly the pair that
   separates a menu item from a category header (name only), a config flag, or an address.
   Deliberately shape-blind: the point is that it keeps working when a platform reorganises its
   payload, and works first time on the platform we have never seen, which is most of them. */
export function dishesFromState(blobs: any[]): Dish[] {
  const out: Dish[] = [];
  const seen = new Set<any>();
  const walk = (node: any, section: string, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 14 || out.length > 400) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, section, depth + 1); return; }
    if (seen.has(node)) return;
    seen.add(node);

    const name = str(node, NAME_KEYS);
    const description = str(node, DESC_KEYS);
    let price = '';
    for (const k of PRICE_KEYS) { if (node[k] != null) { price = priceText(node[k]); if (price) break; } }
    if (isDishName(name) && (price || description.length >= 12)) {
      out.push({ section, name, description: description.length > 300 ? description.slice(0, 300) : description, price });
    }
    // A container that names itself becomes the section for everything beneath it - which is how a
    // dish ends up labelled "Sides" without the platform ever having said so in those words.
    const own = str(node, SECTION_KEYS) || (name && !price ? name : '');
    for (const k of Object.keys(node)) {
      if (!CHILD_KEYS.test(k)) continue;
      walk(node[k], (own && own !== section && isDishName(own)) ? own : section, depth + 1);
    }
    // Unlabelled nesting: keep descending, but only through plain containers, so this cannot wander
    // the whole page state looking for anything with a name.
    for (const k of Object.keys(node)) {
      if (CHILD_KEYS.test(k)) continue;
      const v = node[k];
      if (v && typeof v === 'object' && depth < 10) walk(v, section, depth + 1);
    }
  };
  for (const b of blobs) walk(b, '', 0);
  return dedupeDishes(out);
}

/* The same dish arrives many times over: once per size, once in a "popular" carousel, once in the
   search index. Deduplicated on the name alone rather than name+section, because the duplicate that
   matters is the one that would make the model think a menu is twice the size it is. "&" is folded
   to "and" first, since a platform that renders "Cod & Chips" in one place and "Cod and Chips" in
   another is describing one dish and would otherwise be counted as two. */
export function dedupeDishes(list: Dish[]): Dish[] {
  const out: Dish[] = [];
  const seen = new Set<string>();
  for (const d of list) {
    const k = d.name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

// ---- rung 3: the visible text ----------------------------------------------------------------------

/* The page with everything that is not content taken out. A blunt instrument on purpose: it is the
   last rung before giving up, its output is only used if `looksLikeMenu` agrees, and the model is a
   far better reader of a messy menu than any parser we could write. */
export function visibleText(html: string): string {
  const body = (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|header|footer|form|aside|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|td|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* Is this text a menu? The test is prices attached to dish-shaped lines, in quantity: a restaurant
   page carries a handful of pounds signs in its delivery blurb, a menu carries one per dish. Six is
   the floor because five prices is a "specials" box or a set-lunch panel, and handing the model a
   fragment while telling it that it has the menu is how you get four invented dishes to pad it out.

   This function is the whole safety story for rungs 2 and 3. Nothing they produce is believed
   without it. */
export function looksLikeMenu(text: string): boolean {
  if (!text || text.length < 60) return false;
  const prices = (text.match(MONEY) || []).length;
  if (prices >= 6) return true;
  // A menu can be priceless (a set menu, a tasting menu, a chalkboard transcribed into the page), so
  // allow a second route: many short dish-shaped lines with descriptions under them.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const dishy = lines.filter((l) => l.length >= 8 && l.length <= 90 && isDishName(l) && /[a-z]{3}/i.test(l)).length;
  return prices >= 3 && dishy >= 12;
}

/* The dishes, as the text the AI call is handed. Sections become headings so the model can tell a
   starter from a main, which it needs in order to say "this is one complete thing to order". */
export function menuText(dishes: Dish[]): string {
  const lines: string[] = [];
  let section = '\u0000';
  for (const d of dishes) {
    if (d.section !== section) { section = d.section; if (section) lines.push('', section.toUpperCase()); }
    lines.push('- ' + d.name + (d.price ? '  ' + d.price : '') + (d.description ? '\n    ' + d.description.replace(/\s+/g, ' ') : ''));
  }
  return clip(lines.join('\n').trim());
}

// ---- rung 4: a menu that is a PDF -------------------------------------------------------------------

/* Links to a PDF that is plausibly the menu. Returned as absolute URLs for the client to send as a
   document block: menu PDFs are typed, not scanned, so the model reads the actual text rather than a
   picture of it - the same reason the file picker accepts a PDF directly. */
export function pdfMenuLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || '')) && out.length < 6) {
    const href = decodeEntities(m[1]);
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!/menu|food|drink|lunch|dinner|breakfast|brunch|takeaway|carte/i.test(href + ' ' + label)) continue;
    try { const abs = new URL(href, base).toString(); if (!out.includes(abs)) out.push(abs); } catch { /* skip */ }
  }
  return out;
}

// ---- the place ------------------------------------------------------------------------------------

const SITE_SUFFIX = /\s*[|\u2013\u2014-]\s*(menu|order online|order|takeaway|delivery|home|official site|book a table)\b.*$/i;

/* The restaurant's name from the page's own metadata, for when there is no JSON-LD. og:title on a
   listing page is the restaurant; og:site_name is the platform, so it is only worth having when
   nothing better exists, and the caller decides. */
export function placeFromMeta(html: string): { title: string; site: string } {
  const meta = (prop: string) => {
    const re = new RegExp('<meta[^>]+(?:property|name)\\s*=\\s*["\']' + prop + '["\'][^>]+content\\s*=\\s*["\']([^"\']*)["\']', 'i');
    const alt = new RegExp('<meta[^>]+content\\s*=\\s*["\']([^"\']*)["\'][^>]+(?:property|name)\\s*=\\s*["\']' + prop + '["\']', 'i');
    const m = html.match(re) || html.match(alt);
    return m ? decodeEntities(m[1]).trim() : '';
  };
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (meta('og:title') || (t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : '')).replace(SITE_SUFFIX, '').trim();
  return { title: title.length < 80 ? title : '', site: meta('og:site_name') };
}

// ---- not being an open proxy ------------------------------------------------------------------------

/* Hostnames that must never be fetched. Unlike recipe-extract, which only ever fetches three known
   platforms, this function is pointed at whatever URL the user pasted - so the allow-list cannot be
   the defence and this deny-list is. It covers loopback, every RFC1918 range, link-local (including
   169.254.169.254, the cloud metadata endpoint that makes SSRF worth attempting in the first place),
   carrier-grade NAT, .internal/.local names, and IPv6's equivalents. Checked on the original URL AND
   again on every redirect hop, because a public host that 302s to 127.0.0.1 is the whole trick. */
export function isBlockedHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/\.(local|internal|intranet|lan|home|corp|test|example|invalid|onion)$/.test(h)) return true;
  if (!h.includes('.') && !h.includes(':')) return true; // a bare name is on someone's internal network

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, Number(v4[2]), Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;          // RFC1918
    if (a === 192 && b === 0) return true;            // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true;                        // multicast + reserved
    return false;
  }
  if (h.includes(':')) { // IPv6, including ::ffff:127.0.0.1 style mapped addresses
    if (h === '::1' || h.startsWith('::') || /^f[cde]/.test(h)) return true;
    if (/^::ffff:/.test(h)) return isBlockedHost(h.replace(/^::ffff:/, ''));
    return false;
  }
  return false;
}
