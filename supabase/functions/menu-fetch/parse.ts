/*
 * parse.ts - Every pure "is this URL safe to fetch" and "is there a menu in this page" rule, split
 * out from index.ts (which keeps the network I/O and the request handler) so all of it can be
 * unit-tested. Covered in tests/menu-fetch.test.js against fixtures shaped like the real pages.
 *
 * WHY THIS EXISTS AT ALL, given app/menu.js says a link cannot give you a menu. That note was
 * written after testing chains and delivery aggregators - Nando's, Wagamama, Pret, Greggs,
 * Deliveroo - and it is correct about them: they are JavaScript applications that serve an empty
 * shell, or they return 403 to anything without a browser fingerprint. But it over-generalises,
 * because the population it tested is the population where a fetched menu is worth least. We do not
 * need Nando's menu HTML; we have their published nutrition, which is measured rather than parsed.
 *
 * The place a link IS worth fetching is the independent restaurant, which is exactly where the app
 * had nothing: no published nutrition to fall back on, and a model that will cheerfully invent a
 * card's worth of plausible Italian when asked about a place it does not know. Those sites are
 * mostly WordPress, Squarespace and Wix, and they serve their text in the HTML, because their whole
 * business is being found by a search engine. So this tries, and - this is the part that makes it
 * safe to try - it has to PROVE it got a menu before anything claims it read one. looksLikeMenu is
 * that proof. A shell, a cookie wall or a 403 fails it, menuRead stays false, and the screen says it
 * has not seen the menu, exactly as it does today. The feature can only make things better or leave
 * them unchanged; it has no path to a confident wrong answer.
 *
 * Three routes are tried, cheapest and most structured first:
 *   1. JSON-LD  - schema.org Menu/hasMenu. Rare but exact: dish names and prices, no guessing.
 *   2. A linked PDF - very common for independents, and the app already reads menu PDFs as document
 *      blocks, so this reuses a path that works today rather than adding one.
 *   3. The page text - scripts, navigation and cookie furniture stripped, the rest handed over.
 *
 * Types are stripped by node for the tests; it ships as-is to the Deno edge runtime.
 */

export const MAX_TEXT = 12000;         // cap menuText so a giant page cannot blow up the AI call
export const MAX_PAGE_BYTES = 2000000; // stop reading a page after this much
export const MAX_PDF_BYTES = 4500000;  // matches MENU_PDF_MAX_BYTES in the client
export const MAX_HOPS = 4;             // redirects we will follow, each one re-checked

export const clip = (s: string, n = MAX_TEXT) => ((s || '').length > n ? (s || '').slice(0, n) : (s || ''));

export function decodeEntities(h: string): string {
  return (h || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ').replace(/&pound;/g, '£').replace(/&amp;pound;/g, '£')
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(+d); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => { try { return String.fromCodePoint(parseInt(x, 16)); } catch { return ' '; } });
}

/* ---- 1. is this address safe to fetch -------------------------------------------------------
   Unlike recipe-extract, which only ever fetches three named platforms, this takes whatever URL
   somebody pastes, so it is a server-side request forgery surface and has to be treated as one.
   Everything below is refused: anything that is not http(s), any credentials in the URL, any
   non-standard port, and any address inside a private, loopback, link-local or carrier-grade-NAT
   range, including the cloud metadata endpoints that are the usual prize. Redirects do not get a
   free pass: index.ts follows them by hand and puts every hop back through here.

   What this cannot settle on its own is a public hostname whose DNS answer points somewhere
   private. index.ts resolves and re-checks where the runtime lets it (see resolvesPublic); a
   rebind between that check and the fetch remains theoretically open, which is why the reply is
   only ever text handed to a model, never anything the caller can address or act on. */

const BLOCKED_HOSTS = /^(localhost|metadata|metadata\.google\.internal|instance-data)$/i;
const BLOCKED_SUFFIX = /\.(local|localhost|internal|home|lan|corp|intranet|test|example|invalid|onion)$/i;

export function privateIPv4(ip: string): boolean {
  const p = ip.split('.').map((n) => +n);
  if (p.length !== 4 || p.some((n) => !isFinite(n) || n < 0 || n > 255)) return true; // not an IPv4 we understand
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;          // link-local, and 169.254.169.254 with it
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;            // 192.0.0.0/24 + 192.0.2.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;                         // multicast + reserved
  return false;
}

export function privateIPv6(ip: string): boolean {
  const s = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (s === '::' || s === '::1') return true;
  // ::ffff:127.0.0.1 and friends are IPv4 wearing a hat. Note the URL parser normalises the dotted
  // form to hex (::ffff:7f00:1) before we ever see it, so both spellings have to be understood.
  const dotted = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return privateIPv4(dotted[1]);
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return privateIPv4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  if (/^f[cd][0-9a-f]{2}:/.test(s)) return true;     // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(s)) return true;     // link-local fe80::/10
  if (/^ff[0-9a-f]{2}:/.test(s)) return true;        // multicast
  return false;
}

export const isIPv4 = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
export const isIPv6 = (h: string) => h.indexOf(':') !== -1;

/* Is this a literal address, or a name, that we already know we must not fetch? Returns a reason
   string (for the diag field) or '' when the address is acceptable so far. */
export function unsafeAddress(host: string): string {
  const h = (host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!h) return 'no host';
  if (BLOCKED_HOSTS.test(h) || BLOCKED_SUFFIX.test(h)) return 'private hostname';
  if (isIPv4(h)) return privateIPv4(h) ? 'private address' : '';
  if (isIPv6(h)) return privateIPv6(h) ? 'private address' : '';
  if (h.indexOf('.') === -1) return 'private hostname';   // a bare name is an intranet name
  return '';
}

/* The whole URL, checked. Returns { url } or { reason }. */
export function safeUrl(raw: string | URL): { url?: URL; reason?: string } {
  let u: URL;
  try { u = raw instanceof URL ? raw : new URL(String(raw).trim()); } catch { return { reason: 'not a link' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { reason: 'not a web link' };
  if (u.username || u.password) return { reason: 'credentials in link' };
  if (u.port && u.port !== '80' && u.port !== '443') return { reason: 'unusual port' };
  const bad = unsafeAddress(u.hostname);
  if (bad) return { reason: bad };
  return { url: u };
}

/* ---- 2. reading the page --------------------------------------------------------------------- */

// Furniture that is never the menu, and reliably drowns it: scripts, styles, the head, SVG icon
// sprites, navigation, cookie walls. Everything else is left alone on purpose, including divs whose
// class happens to say "menu": on a restaurant site that is as likely to be the food as the nav, and
// guessing wrong loses the thing we came for.
const DROP_BLOCKS = /<(script|style|noscript|svg|head|template|iframe|form|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
const SELF_CLOSING = /<(br|hr)\s*\/?>/gi;
const BLOCK_END = /<\/(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|td|dt|dd)\s*>/gi;

export function htmlToText(html: string): string {
  return decodeEntities(
    String(html || '')
      .replace(DROP_BLOCKS, ' ')
      .replace(SELF_CLOSING, '\n')
      .replace(BLOCK_END, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter((l, i, a) => l !== '' || (a[i - 1] || '') !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* THE PROOF. Nothing downstream may claim a menu was read unless this says one was, so it is
   deliberately about evidence rather than vibes: prices in the shape a UK menu writes them, or the
   words a menu uses to divide itself up, over a body of text long enough to be a card rather than a
   "view our menu" teaser. An empty JavaScript shell, a cookie wall, a 403 page and a homepage all
   fail it, which is what lets index.ts try any link at all without risking a confident lie. */
const PRICE = /(?:£\s?\d{1,3}(?:\.\d{2})?)|(?:\b\d{1,2}\.\d{2}\b)/g;
const COURSE = /\b(starters?|mains?|main course|desserts?|puddings?|sides?|small plates|sharing|antipasti|primi|secondi|dolci|contorni|tapas|nibbles|to start|to follow|from the grill|a la carte)\b/i;

export function looksLikeMenu(text: string): boolean {
  const t = String(text || '');
  const bare = t.replace(/\s/g, '').length;
  if (bare < 80) return false;
  const prices = (t.match(PRICE) || []).length;
  const lines = t.split('\n').filter((l) => l.trim().length > 3).length;
  // Five prices spread over six lines is not something a page falls into by accident: a cookie wall
  // has none, and a homepage boasting "two courses from £19.95" has one. There is no length floor on
  // this branch on purpose, because the strongest source we have is also the shortest - a menu read
  // out of JSON-LD is all dish and no furniture, and a six-item card is barely 200 characters.
  if (prices >= 5 && lines >= 6) return true;
  // Some kitchens publish a card with no prices on it at all. Course headings over a real body of
  // lines is the same evidence by another route. The line count carries this branch; the length
  // floor is only here to reject twelve one-word links that happen to sit under the word "sides".
  if (COURSE.test(t) && lines >= 12 && bare >= 400) return true;
  return false;
}

/* ---- 3. JSON-LD: the exact route, when a site offers it -------------------------------------- */

export function jsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || '')))) {
    const body = decodeEntities(m[1]).trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try { out.push(JSON.parse(body)); } catch { /* one broken block must not lose the others */ }
  }
  return out;
}

const typeOf = (n: any): string[] => {
  const t = n && (n['@type'] || n.type);
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x: any) => String(x).toLowerCase());
};

/* Walk anything schema.org-shaped and write out the menu items as lines. Deliberately tolerant:
   sites nest Menu inside Restaurant.hasMenu, inside @graph, inside arrays, and half of them get the
   casing wrong. Returns '' when there is no menu in there, which is the common case. */
export function menuFromJsonLd(blocks: any[]): string {
  const lines: string[] = [];
  const seen = new Set<any>();
  const price = (n: any): string => {
    const p = n.offers ? (Array.isArray(n.offers) ? n.offers[0] : n.offers) : null;
    const v = (p && (p.price || p.lowPrice)) || n.price;
    return v || v === 0 ? '£' + String(v).replace(/^£/, '') : '';
  };
  const walk = (n: any, depth: number) => {
    if (!n || typeof n !== 'object' || depth > 8 || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const c of n) walk(c, depth + 1); return; }
    const types = typeOf(n);
    if (types.indexOf('menuitem') !== -1 && n.name) {
      const p = price(n);
      lines.push('- ' + String(n.name).trim() + (n.description ? ': ' + String(n.description).trim() : '') + (p ? ' (' + p + ')' : ''));
    } else if (types.indexOf('menusection') !== -1 && n.name) {
      lines.push('\n' + String(n.name).trim().toUpperCase());
    }
    for (const k of Object.keys(n)) {
      if (k === '@context' || k === '@type') continue;
      walk(n[k], depth + 1);
    }
  };
  walk(blocks, 0);
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // One or two stray items is a site tagging a special offer, not a menu.
  return lines.filter((l) => l.charAt(0) === '-').length >= 5 ? clip(text) : '';
}

/* ---- 4. following the site's own links -------------------------------------------------------- */

export function absolute(href: string, base: string | URL): URL | null {
  try {
    const u = new URL(String(href || '').trim(), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch { return null; }
}

function anchors(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || '')))) out.push({ href: decodeEntities(m[1]), text: htmlToText(m[2]).replace(/\n/g, ' ').trim() });
  return out;
}

const MENUISH = /(menu|carte|carta|food|drinks|dining|lunch|dinner|breakfast|brunch|specials|takeaway)/i;
const NOT_MENUISH = /(privacy|cookie|terms|gift|voucher|book|reserv|contact|careers|jobs|newsletter|christmas-party-booking)/i;

/* Menu PDFs, most likely first. Independents publish a card as a PDF constantly, and the app
   already reads menu PDFs as document blocks, so this is the cheapest real win available. */
export function pdfLinks(html: string, base: string | URL): string[] {
  const scored: { u: string; s: number }[] = [];
  for (const a of anchors(html)) {
    const u = absolute(a.href, base);
    if (!u) continue;
    if (!/\.pdf($|[?#])/i.test(u.pathname + u.search)) continue;
    const hay = u.pathname + ' ' + a.text;
    if (NOT_MENUISH.test(hay) && !MENUISH.test(a.text)) continue;
    let s = 0;
    if (MENUISH.test(hay)) s += 2;
    if (/a[-_ ]?la[-_ ]?carte|main menu|food menu/i.test(hay)) s += 2;
    if (/drink|wine|cocktail/i.test(hay)) s -= 1;   // real, but not what they are choosing a meal from
    scored.push({ u: u.href, s });
  }
  return dedupe(scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.u)).slice(0, 3);
}

/* Menu PAGES on the same site, for when somebody pastes the homepage. Same-origin only, so this
   cannot be talked into walking off to somewhere else entirely. */
export function menuPageLinks(html: string, base: string | URL): string[] {
  let origin = '';
  try { origin = (base instanceof URL ? base : new URL(String(base))).origin; } catch { return []; }
  const here = (base instanceof URL ? base : new URL(String(base))).href.replace(/#.*$/, '');
  const scored: { u: string; s: number }[] = [];
  for (const a of anchors(html)) {
    const u = absolute(a.href, base);
    if (!u || u.origin !== origin) continue;
    u.hash = '';
    if (u.href.replace(/#.*$/, '') === here) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?)($|[?#])/i.test(u.pathname)) continue;
    const hay = u.pathname + ' ' + a.text;
    if (!MENUISH.test(hay) || NOT_MENUISH.test(hay)) continue;
    let s = 1;
    if (/a[-_ ]?la[-_ ]?carte/i.test(hay)) s += 3;
    if (/(^|\/)(menus?|food)(\/|$)/i.test(u.pathname)) s += 2;
    if (/drink|wine|cocktail|kids|child/i.test(hay)) s -= 1;
    scored.push({ u: u.href, s });
  }
  return dedupe(scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.u)).slice(0, 3);
}

function dedupe(list: string[]): string[] {
  const seen: Record<string, 1> = {}; const out: string[] = [];
  for (const x of list) { if (!seen[x]) { seen[x] = 1; out.push(x); } }
  return out;
}

/* The restaurant's own name for itself, off the page rather than out of the URL. placeFromUrl in
   app/menu.js has to guess from a domain; a page will usually just tell you. */
export function placeFromHtml(html: string): string {
  const h = String(html || '');
  const og = h.match(/<meta[^>]+property\s*=\s*["']og:site_name["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    || h.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:site_name["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const t = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!t) return '';
  // "A La Carte | Amici Port Stewart" - the site's name is the last piece, not the page's.
  const parts = decodeEntities(t[1]).split(/\s*[|–\-·]\s*/).map((s) => s.trim()).filter(Boolean);
  const pick = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
  return pick.length > 60 ? '' : pick;
}
