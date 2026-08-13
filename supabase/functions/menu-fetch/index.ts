// menu-fetch - read the actual menu behind a pasted restaurant link, server-side, so that "paste a
// link" stops meaning "tell me the name of the place" and starts meaning "here is what they serve".
// verify_jwt is enabled at deploy time, so only signed-in users reach it.
//
//   POST { url }  ->  { ok, place, menuText, dishCount, via, pdf, note, diag }
//
// Every rule for turning a page into dishes lives in parse.ts, unit-tested against fixtures in
// tests/menu-fetch.test.js; this file is the network I/O, the safety, and the ladder that decides
// which rung's answer to believe. Read the top of parse.ts for WHY a link is worth fetching at all,
// given app/menu.js spent a long comment explaining that it is not - the short version is that the
// sixteen URLs that proved it were all chains and aggregators, and the page people actually paste is
// a regional ordering platform that server-renders its whole menu into the HTML as JSON.
//
// FAILURE IS A FIRST-CLASS ANSWER HERE. This returns ok:false far more often than it returns a menu,
// and that is the design: the client climbs to the camera, which always works. What must never
// happen is ok:true carrying something that is not a menu, because the client will hand it to the
// model as though it were one and get six confidently-priced dishes that do not exist. So every rung
// below the structured ones has to satisfy looksLikeMenu() before it counts, and a thin result is
// reported as a miss rather than shipped as a menu.
//
// SSRF. Unlike recipe-extract, which only ever fetches three allow-listed platforms, this is pointed
// at a URL the user typed. The defences, in order: https/http only; the host is checked against
// parse.ts's deny-list (loopback, RFC1918, link-local incl. 169.254.169.254, CGNAT, .internal) BEFORE
// the request and AGAIN on every redirect hop, which is followed manually for exactly that reason;
// no credentials, cookies or auth headers are ever forwarded; the response must be HTML; the read is
// capped by bytes and by a wall-clock timeout; and nothing about the response body other than
// extracted menu text is ever returned to the caller. It cannot be used to read an internal service,
// and it cannot be used to exfiltrate one either, because a non-HTML or non-menu response comes back
// as the same flat ok:false as a 404.

import {
  clip, MAX_MENU_TEXT, jsonLdBlocks, dishesFromJsonLd, placeFromJsonLd, stateBlobs, dishesFromState,
  visibleText, looksLikeMenu, menuText, pdfMenuLinks, placeFromMeta, isBlockedHost, dedupeDishes,
  type Dish,
} from './parse.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

// A real browser's UA. Not an attempt to defeat bot detection - the sites this works on are not
// running any - but plenty of stacks serve a stripped page to something that announces itself as a
// crawler, and we want the same HTML a person's phone would get.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_HTML_BYTES = 4 * 1024 * 1024;   // Nando's ships 2.5MB of navigation; past this it is not a menu
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 12000;           // someone is stood in a restaurant; a slow miss is still a miss
const MIN_DISHES = 5;                     // fewer than this is a fragment, not a menu. See the note above.

/* One hop, with the host checked before it is made. Redirects are followed by hand so that every
   Location gets the same check as the URL the user pasted: `redirect: 'follow'` would let a public
   host bounce us into a private network in one step, which is the entire SSRF playbook. */
async function fetchPage(start: URL): Promise<{ html: string; url: URL; status: number; diag: string }> {
  let u = start;
  let diag = '';
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { html: '', url: u, status: 0, diag: diag + ' bad-scheme' };
    if (isBlockedHost(u.hostname)) return { html: '', url: u, status: 0, diag: diag + ' blocked-host' };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let r: Response;
    try {
      r = await fetch(u.toString(), {
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-GB,en;q=0.9',
        },
      });
    } catch (e) {
      clearTimeout(timer);
      return { html: '', url: u, status: 0, diag: diag + ' err:' + ((e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message.slice(0, 60)) };
    }
    clearTimeout(timer);
    diag += (diag ? ' > ' : '') + r.status;

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      try { await r.body?.cancel(); } catch { /* ignore */ }
      if (!loc) return { html: '', url: u, status: r.status, diag };
      try { u = new URL(loc, u); } catch { return { html: '', url: u, status: r.status, diag: diag + ' bad-location' }; }
      continue;
    }
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return { html: '', url: u, status: r.status, diag }; }

    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype && !/text\/html|application\/xhtml|text\/plain/.test(ctype)) {
      try { await r.body?.cancel(); } catch { /* ignore */ }
      return { html: '', url: u, status: r.status, diag: diag + ' ctype:' + ctype.split(';')[0] };
    }

    // Read with a hard byte cap rather than trusting content-length, which a chunked response has
    // no reason to send and a hostile one has every reason to lie about.
    const reader = r.body?.getReader();
    if (!reader) return { html: '', url: u, status: r.status, diag: diag + ' no-body' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.length;
        if (size > MAX_HTML_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } break; }
        chunks.push(value);
      }
    } catch { /* whatever arrived is what we parse */ }
    const buf = new Uint8Array(size > MAX_HTML_BYTES ? MAX_HTML_BYTES : size);
    let at = 0;
    for (const c of chunks) { if (at + c.length > buf.length) break; buf.set(c, at); at += c.length; }
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, at));
    return { html, url: u, status: r.status, diag: diag + ' ' + Math.round(html.length / 1024) + 'kb' };
  }
  return { html: '', url: u, status: 0, diag: diag + ' too-many-redirects' };
}

/* A linked menu PDF, fetched and base64'd so the client can send it as a document block. Handing
   back the URL instead would be a dead end: the PDF sits on the restaurant's own domain, which sends
   no CORS headers, so the browser cannot read it. Menu PDFs are typed rather than scanned, so this
   is the model reading the actual text - the best rung on the ladder when it is available, and the
   reason it is worth the extra round trip. Capped at the same size the file picker accepts. */
const MAX_PDF_BYTES = 4.5 * 1024 * 1024;
async function fetchPdf(url: string): Promise<{ b64: string; bytes: number } | null> {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (isBlockedHost(u.hostname)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(u.toString(), { headers: { 'user-agent': UA, accept: 'application/pdf,*/*' }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    // `redirect: 'follow'` is safe here only because the final URL is re-checked: a menu PDF is
    // routinely served off a CDN, so refusing redirects outright would lose most of them.
    try { if (isBlockedHost(new URL(r.url).hostname)) { await r.body?.cancel(); return null; } } catch { /* keep going */ }
    const ctype = (r.headers.get('content-type') || '').toLowerCase();
    if (ctype && !/pdf|octet-stream/.test(ctype)) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_PDF_BYTES) return null;
    if (String.fromCharCode(...buf.subarray(0, 5)) !== '%PDF-') return null; // it said PDF; check
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CH)));
    return { b64: btoa(bin), bytes: buf.length };
  } catch { clearTimeout(timer); return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, note: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, note: 'Bad request body.' }, 400); }
  const raw = String(body?.url || '').trim();
  if (!raw) return json({ ok: false, note: 'No link provided.' }, 400);

  let u: URL;
  try { u = new URL(raw); } catch { return json({ ok: false, note: 'That does not look like a valid link.' }, 400); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return json({ ok: false, note: 'Only http(s) links can be read.' }, 400);
  if (isBlockedHost(u.hostname)) return json({ ok: false, note: 'That link does not point at a public website.' }, 400);
  // Credentials in a URL are never part of a menu link, and forwarding them would be the one way
  // this function could be made to authenticate to something on someone else's behalf.
  u.username = ''; u.password = '';

  try {
    const page = await fetchPage(u);
    const host = page.url.hostname.replace(/^www\./, '');
    if (!page.html) {
      console.log('menu-fetch miss', host, page.diag);
      return json({ ok: false, reason: 'unreadable', note: 'Could not open that page.', diag: page.diag, source_url: raw });
    }

    // ---- the ladder. Structured first, and only what looksLikeMenu will vouch for after that. ----
    const blocks = jsonLdBlocks(page.html);
    let dishes: Dish[] = dishesFromJsonLd(blocks);
    let via = 'json-ld';
    let diag = page.diag + ' | ld:' + blocks.length + '/' + dishes.length;

    if (dishes.length < MIN_DISHES) {
      const blobs = stateBlobs(page.html);
      const fromState = dedupeDishes(dishesFromState(blobs));
      diag += ' | state:' + blobs.length + '/' + fromState.length;
      if (fromState.length > dishes.length) { dishes = fromState; via = 'embedded-state'; }
    }

    // A structured read is trusted on its own count: these are labelled records, not a guess about
    // what a line of text meant. The text rungs have to prove themselves instead.
    let text = dishes.length >= MIN_DISHES ? menuText(dishes) : '';

    if (!text) {
      const vis = visibleText(page.html);
      const ok = looksLikeMenu(vis);
      diag += ' | text:' + Math.round(vis.length / 1024) + 'kb/' + (ok ? 'menu' : 'not-menu');
      if (ok) { text = clip(vis); via = 'page-text'; dishes = []; }
    }

    // The PDF is offered alongside whatever we found rather than instead of it: the client sends it
    // as a document block, and a real menu PDF beats a thin text read of the page that links to it.
    const pdf = pdfMenuLinks(page.html, page.url.toString());

    const meta = placeFromMeta(page.html);
    const place = placeFromJsonLd(blocks) || meta.title || '';

    /* The PDF is fetched only when the page itself gave us nothing: a structured read of the live
       menu is more current than whatever PDF is linked in the footer, which on a lot of sites is
       last winter's. */
    let pdfB64 = '';
    if (!text && pdf.length) {
      const got = await fetchPdf(pdf[0]);
      if (got) { pdfB64 = got.b64; diag += ' | pdf:' + Math.round(got.bytes / 1024) + 'kb'; }
      else diag += ' | pdf:failed';
    }

    if (!text && !pdfB64) {
      console.log('menu-fetch miss', host, diag);
      return json({
        ok: false, reason: 'no_menu', place, source_url: raw, diag,
        note: 'That page does not publish its menu in a form I can read.',
      });
    }

    const out = {
      ok: true,
      place,
      site: meta.site,
      menuText: clip(text, MAX_MENU_TEXT),
      dishCount: dishes.length,
      via: text ? via : 'pdf',
      pdf_b64: pdfB64,
      source_url: raw,
      diag,
      note: '',
    };
    console.log('menu-fetch', host, out.via, out.dishCount + ' dishes', out.menuText.length + 'ch', diag);
    return json(out);
  } catch (e) {
    return json({ ok: false, note: 'Could not read that link: ' + (e as Error).message, source_url: raw });
  }
});
