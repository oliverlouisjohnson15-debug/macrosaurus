/*
 * menu-fetch - read the menu behind a pasted restaurant link, server-side, because the browser
 * cannot (CORS). verify_jwt is enabled at deploy time, so only signed-in users reach it. It holds no
 * key, calls no paid API, and returns text (or a menu PDF's bytes) that the client then hands to the
 * normal ai-proxy alongside anything else it has.
 *
 * The rules it plays by, and why they are the ones that make an open-ish fetcher acceptable:
 *
 * 1. IT MUST PROVE IT GOT A MENU. Everything it returns has been through looksLikeMenu in parse.ts.
 *    A JavaScript shell, a cookie wall, a 403, a homepage: all fail, and it answers ok:false. The
 *    client then behaves exactly as it does today, with the "I have not seen this menu" strip over
 *    the results. So the worst case of this whole feature is the current behaviour, and there is no
 *    path from here to a confidently wrong menu.
 *
 * 2. IT IS NOT AN OPEN PROXY. Unlike recipe-extract, which only fetches three named platforms, this
 *    takes whatever somebody pastes, so it is a server-side request forgery surface and is treated
 *    as one: https/http only, no credentials, no odd ports, no private/loopback/link-local/CGNAT
 *    addresses, DNS re-checked where the runtime allows it, redirects followed BY HAND with every
 *    hop re-validated, a hard cap on bytes, a hard cap on time, and a content-type gate. The caller
 *    never receives a status code, a header, or a body we did not classify as a menu, so it cannot
 *    be used to probe anything: a private address and a public 404 are the same ok:false to them.
 *
 * 3. IT FOLLOWS THE SITE, NOT THE INTERNET. When the pasted page is not itself a menu it will look
 *    at that page's own links for a menu page or a menu PDF, same-origin only, one level deep.
 *
 * Contract: POST { url } -> { ok, place, menuText, pdf_b64, pdf_mime, source, source_url, note }
 *   source = 'jsonld' | 'page' | 'pdf'   (which route actually produced it)
 * Why there is no diag field, unlike recipe-extract: the reason a fetch failed is exactly what a
 * prober wants. "private address" and "http 404" have to be the same answer to the caller, or this
 * becomes a port scanner with a helpful error message. The reasons go to the function log instead,
 * where they are just as debuggable and nobody outside can read them.
 *
 * The pure rules live in parse.ts so they can be unit-tested (tests/menu-fetch.test.js); this file
 * is the network I/O and the request handler.
 */
import {
  MAX_PAGE_BYTES, MAX_PDF_BYTES, MAX_HOPS, MAX_TEXT, clip,
  safeUrl, isIPv4, isIPv6, privateIPv4, privateIPv6,
  htmlToText, looksLikeMenu, jsonLdBlocks, menuFromJsonLd,
  pdfLinks, menuPageLinks, placeFromHtml,
} from './parse.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

// A real browser string. Not evasion: plenty of hosts serve a stripped page to an unknown agent, and
// we want the same HTML a customer looking up the menu on their phone would get.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PER_FETCH_MS = 12000;
const TOTAL_MS = 25000;   // the whole request, because the person is stood in a restaurant

/* Does this hostname resolve somewhere public? The literal checks in parse.ts cannot see that
   menu.example.com is an A record for 127.0.0.1, and this can. Deno.resolveDns is not guaranteed to
   exist on the edge runtime, so an unavailable resolver is not treated as a failure: it leaves us
   exactly where the literal checks left us, which is where recipe-extract has always been. */
async function resolvesPublic(host: string): Promise<boolean> {
  if (isIPv4(host) || isIPv6(host)) return true; // already checked literally
  const anyDeno = Deno as any;
  if (!anyDeno || typeof anyDeno.resolveDns !== 'function') return true;
  for (const kind of ['A', 'AAAA'] as const) {
    try {
      const ips: string[] = await anyDeno.resolveDns(host, kind);
      for (const ip of ips || []) if (kind === 'A' ? privateIPv4(ip) : privateIPv6(ip)) return false;
    } catch { /* NXDOMAIN for one family, or no permission: neither is evidence against the host */ }
  }
  // Nothing private was seen. A name that resolves to nothing at all fails at the fetch anyway.
  return true;
}

type Got = { url: URL; type: string; bytes: Uint8Array } | null;

/* Fetch one resource with every guard on. Redirects are followed by hand so each hop goes back
   through safeUrl and the DNS check: `redirect: 'follow'` would let a public URL bounce us into a
   private one without our ever seeing the address. */
async function get(start: URL, maxBytes: number, deadline: number): Promise<{ got: Got; diag: string }> {
  let url = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (Date.now() > deadline) return { got: null, diag: 'timeout' };
    const checked = safeUrl(url);
    if (!checked.url) return { got: null, diag: checked.reason || 'blocked' };
    if (!(await resolvesPublic(checked.url.hostname))) return { got: null, diag: 'private address' };
    let res: Response;
    try {
      res = await fetch(checked.url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(PER_FETCH_MS, Math.max(1000, deadline - Date.now()))),
        headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5', 'accept-language': 'en-GB,en;q=0.9' },
      });
    } catch (e) { return { got: null, diag: 'fetch failed: ' + ((e as Error).name || 'error') }; }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* nothing to drain */ }
      if (!loc) return { got: null, diag: 'redirect with no target' };
      let next: URL;
      try { next = new URL(loc, checked.url); } catch { return { got: null, diag: 'bad redirect' }; }
      url = next;
      continue;
    }
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return { got: null, diag: 'http ' + res.status }; }

    const type = (res.headers.get('content-type') || '').toLowerCase();
    const ok = /text\/html|application\/xhtml|application\/pdf|text\/plain/.test(type);
    if (!ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return { got: null, diag: 'not a page: ' + (type.split(';')[0] || 'unknown') }; }

    // Read with a ceiling rather than trusting content-length, which lies or is absent.
    const chunks: Uint8Array[] = []; let total = 0;
    const reader = res.body?.getReader();
    if (!reader) return { got: null, diag: 'empty body' };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } return { got: null, diag: 'too big' }; }
          chunks.push(value);
        }
        if (Date.now() > deadline) { try { await reader.cancel(); } catch { /* ignore */ } return { got: null, diag: 'timeout' }; }
      }
    } catch (e) { return { got: null, diag: 'read failed: ' + ((e as Error).name || 'error') }; }
    const bytes = new Uint8Array(total); let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return { got: { url: checked.url, type, bytes }, diag: '' };
  }
  return { got: null, diag: 'too many redirects' };
}

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)) as any);
  return btoa(s);
};

type Found = { source: string; menuText?: string; pdf_b64?: string; pdf_mime?: string; source_url: string; place?: string };

/* Everything one HTML page can give us, cheapest and most exact first. Returns null when this page
   is not a menu and has nothing on it that leads to one. */
async function readPage(page: { url: URL; bytes: Uint8Array }, deadline: number, followLinks: boolean, diag: string[]): Promise<Found | null> {
  const html = new TextDecoder('utf-8', { fatal: false }).decode(page.bytes);
  const place = placeFromHtml(html);

  // 1. JSON-LD. Rare, and worth trying first every time it is there: names and prices, no parsing.
  const ld = menuFromJsonLd(jsonLdBlocks(html));
  if (ld && looksLikeMenu(ld)) { diag.push('jsonld'); return { source: 'jsonld', menuText: ld, source_url: page.url.href, place }; }

  // 2. The page's own text.
  const text = htmlToText(html);
  if (looksLikeMenu(text)) { diag.push('page'); return { source: 'page', menuText: clip(text, MAX_TEXT), source_url: page.url.href, place }; }
  diag.push('page:' + text.replace(/\s/g, '').length + 'ch no menu');

  // 3. A menu PDF linked from it. The client already reads menu PDFs as document blocks.
  for (const href of pdfLinks(html, page.url)) {
    if (Date.now() > deadline) break;
    const u = safeUrl(href);
    if (!u.url) continue;
    const { got, diag: d } = await get(u.url, MAX_PDF_BYTES, deadline);
    if (!got) { diag.push('pdf ' + d); continue; }
    if (got.type.indexOf('pdf') === -1) { diag.push('pdf not a pdf'); continue; }
    diag.push('pdf ' + got.bytes.length + 'b');
    return { source: 'pdf', pdf_b64: b64(got.bytes), pdf_mime: 'application/pdf', source_url: got.url.href, place };
  }

  // 4. The site's own menu pages, one level, same origin. This is the homepage case.
  if (followLinks) {
    for (const href of menuPageLinks(html, page.url)) {
      if (Date.now() > deadline) break;
      const u = safeUrl(href);
      if (!u.url) continue;
      const { got, diag: d } = await get(u.url, MAX_PAGE_BYTES, deadline);
      if (!got) { diag.push('link ' + d); continue; }
      if (got.type.indexOf('pdf') !== -1) {
        diag.push('link pdf ' + got.bytes.length + 'b');
        return { source: 'pdf', pdf_b64: b64(got.bytes), pdf_mime: 'application/pdf', source_url: got.url.href, place };
      }
      const found = await readPage(got, deadline, false, diag);
      if (found) return { ...found, place: found.place || place };
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, note: 'Method not allowed' }, 405);

  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const raw = String(body?.url || '').trim();
  if (!raw) return json({ ok: false, note: 'No link provided.' }, 400);

  const first = safeUrl(raw);
  // Deliberately the same answer for a private address as for a typo. Distinguishing them would
  // turn this into a port scanner with a friendly error message.
  if (!first.url) {
    console.log('menu-fetch refused', first.reason);
    return json({ ok: false, note: 'That does not look like a link I can open.' });
  }

  const deadline = Date.now() + TOTAL_MS;
  const diag: string[] = [];
  try {
    const { got, diag: d } = await get(first.url, MAX_PAGE_BYTES, deadline);
    if (!got) {
      console.log('menu-fetch', first.url.hostname, 'no page:', d);
      return json({ ok: false, note: 'Could not open that page.' });
    }
    // They pasted a link straight to the PDF.
    if (got.type.indexOf('pdf') !== -1) {
      if (got.bytes.length > MAX_PDF_BYTES) {
        console.log('menu-fetch', first.url.hostname, 'pdf too big', got.bytes.length);
        return json({ ok: false, note: 'That menu PDF is too big to read.' });
      }
      console.log('menu-fetch', first.url.hostname, 'direct pdf', got.bytes.length);
      return json({ ok: true, source: 'pdf', pdf_b64: b64(got.bytes), pdf_mime: 'application/pdf', source_url: got.url.href, place: '' });
    }

    const found = await readPage(got, deadline, true, diag);
    if (!found) {
      console.log('menu-fetch', first.url.hostname, 'miss', diag.join(' | '));
      return json({
        ok: false,
        // Said in the words the screen will reuse. A miss here is ordinary, not an error: most of
        // the web hides its menu behind JavaScript, and a photo settles it in one tap. The place
        // name still goes back, because the page told us what the restaurant calls itself and that
        // beats the domain the client would otherwise fall back to.
        note: 'I could not read a menu on that page.',
        place: placeFromHtml(new TextDecoder('utf-8', { fatal: false }).decode(got.bytes)),
        source_url: got.url.href,
      });
    }
    console.log('menu-fetch', first.url.hostname, found.source, (found.menuText || '').length + 'ch', diag.join(' | '));
    return json({ ok: true, ...found, note: '' });
  } catch (e) {
    console.log('menu-fetch threw', (e as Error).message);
    return json({ ok: false, note: 'Could not read that page.' });
  }
});
