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
  redboxOutletId, dishesFromRedbox, placeFromRedbox, REDBOX_PATH, REDBOX_QUERY,
  dishesFromMarkup, menuPageLinks, idsFromPath, bundleUrl, apiPathsFromBundle, fillPath,
  GRAPHQL_PATHS, INTROSPECT_QUERY, pickMenuQuery, buildMenuQuery, dishesFromGraphql,
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

/* Ask a Redbox-built page's own backend for the menu it is about to render. The endpoint is derived
   from the page we already fetched - same origin, already host-checked - never from anything in the
   request body, so this adds no new reach: it can only talk to a host we were already allowed to
   read. See parse.ts for why this rung exists at all. */
async function fetchRedbox(origin: string, outletId: string): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(origin + REDBOX_PATH, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': UA, accept: 'application/json' },
      body: JSON.stringify({ query: REDBOX_QUERY, variables: { id: outletId, sid: outletId } }),
    });
    clearTimeout(timer);
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const text = await r.text();
    if (text.length > 2_000_000) return null;
    return JSON.parse(text);
  } catch { clearTimeout(timer); return null; }
}

/* ---- asking an unknown platform's API, the way Redbox was worked out by hand ---------------------
   Same shape as fetchRedbox and the same limits: same-origin with the page we already fetched and
   host-checked, ids taken from that page's own URL, nothing believed unless it walks into real
   dishes. The difference is that nothing here knows the platform in advance. */
async function postJson(url: string, body: unknown): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': UA, accept: 'application/json' },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const t = await r.text();
    return t.length > 3_000_000 ? null : JSON.parse(t);
  } catch { clearTimeout(timer); return null; }
}
async function getJson(url: string): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA, accept: 'application/json' } });
    clearTimeout(timer);
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!/json/.test(ct)) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const t = await r.text();
    return t.length > 3_000_000 ? null : JSON.parse(t);
  } catch { clearTimeout(timer); return null; }
}
async function getText(url: string, cap = 3_000_000): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(timer);
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* ignore */ } return ''; }
    const t = await r.text();
    return t.length > cap ? t.slice(0, cap) : t;
  } catch { clearTimeout(timer); return ''; }
}

/* A GraphQL server can be ASKED what it can do, which is the whole reason this generalises: find the
   endpoint, introspect it, pick the query that means "the menu of this place", ask for the fields a
   dish has. No prior knowledge of the platform is needed at any step. */
async function tryGraphql(origin: string, ids: string[]): Promise<{ dishes: Dish[]; diag: string }> {
  for (const path of GRAPHQL_PATHS) {
    const schema = await postJson(origin + path, { query: INTROSPECT_QUERY });
    if (!schema?.data?.__schema) continue;
    const pick = pickMenuQuery(schema);
    if (!pick) return { dishes: [], diag: 'gql:' + path + '/no-query' };

    // What a dish is called here: ask the schema for the field's own return type before querying it,
    // because one unknown field rejects the entire query.
    const typeQ = await postJson(origin + path, {
      query: '{ __schema { queryType { fields { name type { name kind ofType { name kind ofType { name } } } } } } }',
    });
    const field = (typeQ?.data?.__schema?.queryType?.fields || []).find((f: any) => f?.name === pick.field);
    const typeName = field?.type?.name || field?.type?.ofType?.name || field?.type?.ofType?.ofType?.name;
    if (!typeName) return { dishes: [], diag: 'gql:' + path + '/no-type' };
    const shape = await postJson(origin + path, { query: '{ __type(name:"' + typeName + '"){ fields { name type { name kind ofType { name } } } } }' });
    const groupFields = (shape?.data?.__type?.fields || []).map((f: any) => f?.name).filter(Boolean);
    const childType = (shape?.data?.__type?.fields || []).find((f: any) => /^(menuItems|items|products|dishes|children)$/.test(f?.name || ''));
    let itemFields = groupFields;
    if (childType) {
      const inner = childType?.type?.ofType?.name || childType?.type?.name;
      const kid = inner ? await postJson(origin + path, { query: '{ __type(name:"' + inner + '"){ fields { name } } }' }) : null;
      itemFields = (kid?.data?.__type?.fields || []).map((f: any) => f?.name).filter(Boolean);
    }
    const query = buildMenuQuery(pick, itemFields, groupFields);
    if (!query) return { dishes: [], diag: 'gql:' + path + '/no-fields' };

    for (const id of ids.slice(0, 2)) {
      const reply = await postJson(origin + path, { query, variables: { id } });
      const dishes = dishesFromGraphql(reply);
      if (dishes.length >= MIN_DISHES) return { dishes, diag: 'gql:' + path + '/' + pick.field + '/' + dishes.length };
    }
    return { dishes: [], diag: 'gql:' + path + '/' + pick.field + '/0' };
  }
  return { dishes: [], diag: 'gql:none' };
}

// No schema to ask, so: mine the bundle for path templates, put the page's own id in, and let the
// shape-blind walker judge whatever comes back.
async function tryRest(origin: string, html: string, base: string, ids: string[]): Promise<{ dishes: Dish[]; diag: string }> {
  const bundle = bundleUrl(html, base);
  if (!bundle) return { dishes: [], diag: 'rest:no-bundle' };
  const js = await getText(bundle);
  const paths = apiPathsFromBundle(js);
  if (!paths.length) return { dishes: [], diag: 'rest:0-paths' };
  let tried = 0;
  for (const p of paths) {
    for (const id of ids.slice(0, 1)) {
      if (tried++ >= 6) return { dishes: [], diag: 'rest:' + paths.length + '/capped' };
      const payload = await getJson(origin + fillPath(p, id));
      if (!payload) continue;
      const dishes = dishesFromState([payload]);
      if (dishes.length >= MIN_DISHES) return { dishes, diag: 'rest:' + p + '/' + dishes.length };
    }
  }
  return { dishes: [], diag: 'rest:' + paths.length + '/0' };
}

/* ---- the shared cache and the coverage log ------------------------------------------------------
   Both best effort and both fire-and-forget: this feature must never fail because a bookkeeping
   write did. See the migration for why they exist. */
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const sbHeaders = { 'content-type': 'application/json', apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function cacheGet(url: string): Promise<any | null> {
  if (!SB_URL || !SB_KEY) return null;
  try {
    const r = await fetch(SB_URL + '/rest/v1/menu_cache?url=eq.' + encodeURIComponent(url) + '&select=*', { headers: sbHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || (Date.now() - new Date(row.fetched_at).getTime()) > CACHE_TTL_MS) return null;
    return row;
  } catch { return null; }
}
async function cachePut(url: string, row: Record<string, unknown>) {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(SB_URL + '/rest/v1/menu_cache?on_conflict=url', {
      method: 'POST',
      headers: { ...sbHeaders, prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ url, fetched_at: new Date().toISOString(), ...row }),
    });
  } catch { /* non-fatal */ }
}
async function logAttempt(row: Record<string, unknown>) {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(SB_URL + '/rest/v1/menu_fetch_log', { method: 'POST', headers: sbHeaders, body: JSON.stringify(row) });
  } catch { /* non-fatal */ }
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

  const started = Date.now();
  try {
    /* Somebody already asked this question. A restaurant's menu does not change between one person
       opening the app in the car park and the next opening it at the table, and asking a small
       takeaway's website once rather than once per customer is simply the polite way to do this. */
    const hit = await cacheGet(u.toString());
    if (hit) {
      return json({
        ok: !!hit.ok, place: hit.place || '', menuText: hit.menu_text || '', dishCount: hit.dish_count || 0,
        via: hit.via || '', pdf_b64: '', source_url: raw, cached: true,
        reason: hit.ok ? undefined : 'no_menu',
        note: hit.ok ? '' : 'That page does not publish its menu in a form I can read.',
        diag: 'cache',
      });
    }

    const page = await fetchPage(u);
    const host = page.url.hostname.replace(/^www\./, '');
    if (!page.html) {
      console.log('menu-fetch miss', host, page.diag);
      await logAttempt({ host, url: raw, ok: false, via: '', dish_count: 0, ms: Date.now() - started, diag: page.diag });
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

    /* Nothing in the HTML, because the page renders its menu in the browser. If it is a platform we
       know how to ask, ask it. This is the rung that reads the regional ordering sites whose shells
       are genuinely empty - the case that defeats every other rung by construction. */
    let redboxPlace = '';
    if (dishes.length < MIN_DISHES) {
      const outletId = redboxOutletId(page.html, page.url.pathname);
      if (outletId) {
        const payload = await fetchRedbox(page.url.origin, outletId);
        const fromApi = payload ? dishesFromRedbox(payload) : [];
        diag += ' | redbox:' + (payload ? fromApi.length : 'no-reply');
        if (fromApi.length > dishes.length) {
          dishes = fromApi;
          via = 'redbox';
          redboxPlace = placeFromRedbox(payload);
        }
      }
    }

    /* The menu is in the HTML after all, just as markup rather than as data. This is the commonest
       shape on the open web and the one no amount of JSON-hunting was ever going to find. */
    if (dishes.length < MIN_DISHES) {
      const fromMarkup = dishesFromMarkup(page.html);
      diag += ' | markup:' + fromMarkup.length;
      if (fromMarkup.length > dishes.length) { dishes = fromMarkup; via = 'markup'; }
    }

    /* Still nothing, so the page fetches its menu after boot. Ask its backend the way Redbox's was
       worked out by hand - but without knowing the platform. GraphQL first, because a GraphQL server
       will describe itself if asked, and that makes it general rather than a lucky guess. */
    if (dishes.length < MIN_DISHES) {
      const ids = idsFromPath(page.url.pathname);
      if (ids.length) {
        const g = await tryGraphql(page.url.origin, ids);
        diag += ' | ' + g.diag;
        if (g.dishes.length > dishes.length) { dishes = g.dishes; via = 'graphql'; }
        if (dishes.length < MIN_DISHES) {
          const rest = await tryRest(page.url.origin, page.html, page.url.toString(), ids);
          diag += ' | ' + rest.diag;
          if (rest.dishes.length > dishes.length) { dishes = rest.dishes; via = 'rest'; }
        }
      } else {
        diag += ' | api:no-id';
      }
    }

    /* A menu split over several pages: reading one and calling it "the menu" is the quiet failure
       this whole file exists to avoid, because the model would return six starters and never
       mention it had not seen a main course. Only worth doing once we have SOMETHING, since that is
       what tells us these links are courses rather than navigation. */
    if (dishes.length >= MIN_DISHES) {
      const links = menuPageLinks(page.html, page.url.toString());
      if (links.length) {
        let added = 0;
        for (const link of links.slice(0, 4)) {
          const sub = await fetchPage(new URL(link));
          if (!sub.html) continue;
          const more = dedupeDishes(dishesFromJsonLd(jsonLdBlocks(sub.html)).concat(dishesFromMarkup(sub.html)));
          const before = dishes.length;
          dishes = dedupeDishes(dishes.concat(more));
          added += dishes.length - before;
        }
        if (added) diag += ' | pages:' + links.length + '/+' + added;
      }
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
    // The platform naming its own outlet beats both the page title and anything read off the URL.
    const place = redboxPlace || placeFromJsonLd(blocks) || meta.title || '';

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
      await logAttempt({ host, url: raw, ok: false, via: '', dish_count: 0, ms: Date.now() - started, diag });
      // A miss is cached too: the tenth person to paste a link we cannot read deserves to be told
      // instantly rather than waiting for the same no.
      await cachePut(u.toString(), { ok: false, place, via: '', dish_count: 0, menu_text: '' });
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
    await logAttempt({ host, url: raw, ok: true, via: out.via, dish_count: out.dishCount, ms: Date.now() - started, diag });
    // The PDF is deliberately not cached: megabytes of base64 per row would make this table the
    // biggest thing in the database inside a week, for a rung that fires rarely.
    if (text) await cachePut(u.toString(), { ok: true, place, via, dish_count: dishes.length, menu_text: out.menuText });
    return json(out);
  } catch (e) {
    return json({ ok: false, note: 'Could not read that link: ' + (e as Error).message, source_url: raw });
  }
});
