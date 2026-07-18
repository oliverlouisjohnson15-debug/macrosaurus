// recipe-extract - fetch the public text behind a shared YouTube Short, Instagram Reel or TikTok so the
// client can hand it to the AI structurer (via the existing ai-proxy). This function holds NO API
// keys and calls no paid API: it only fetches public pages the browser itself cannot reach (CORS).
// verify_jwt is enabled at deploy time, so only signed-in users reach it; we additionally allow-list
// hosts to prevent it being used as an open fetch proxy (SSRF). Every failure degrades to ok:false so
// the client can fall back to a manual paste / screenshot flow, and carries a short `diag` string so
// extraction problems are debuggable from the client. Contract:
//   POST { url } -> { ok, platform, title, author, thumbnail, sourceText, note, diag }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_BOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MAX_TEXT = 12000; // cap sourceText so a giant page can't blow up the AI call
const clip = (s: string, n = MAX_TEXT) => (s || '').length > n ? (s || '').slice(0, n) : (s || '');

// Decode a JSON-escaped string body (\n, \uXXXX, \/, ...) captured by a regex group.
function unescapeJson(s: string): string { try { return JSON.parse('"' + s.replace(/\n/g, '\\n') + '"'); } catch { return s; } }
function decodeEntities(h: string): string {
  return (h || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h2) => String.fromCodePoint(parseInt(h2, 16)));
}
const stripTags = (h: string) => decodeEntities((h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();

// Find the first balanced {...} object starting at/after a marker string. Ignores braces in strings.
function jsonAfter(html: string, marker: string): any {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
    }
  }
  return null;
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] || null;
  return u.searchParams.get('v');
}

async function extractYouTube(u: URL) {
  const id = youtubeId(u);
  if (!id) return { ok: false, platform: 'youtube', note: 'Could not read the YouTube video id from that link.' };
  let title = '', author = '', thumbnail = '', description = '', transcript = '', diag = '';
  try {
    const o = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { headers: { 'user-agent': UA_BROWSER } });
    if (o.ok) { const j = await o.json(); title = j.title || ''; author = j.author_name || ''; thumbnail = j.thumbnail_url || ''; }
  } catch { /* best effort */ }
  try {
    const r = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US', { headers: { 'user-agent': UA_BROWSER, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' } });
    const html = await r.text();
    diag = 'yt status ' + r.status + ', html ' + Math.round(html.length / 1024) + 'kb';
    const pr = jsonAfter(html, 'ytInitialPlayerResponse');
    if (pr) {
      const vd = pr.videoDetails || {};
      if (!title) title = vd.title || '';
      if (!author) author = vd.author || '';
      description = vd.shortDescription || '';
      const tracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length) {
        const pick = tracks.find((t: any) => (t.languageCode || '').startsWith('en')) || tracks[0];
        if (pick?.baseUrl) {
          try {
            const tr = await fetch(pick.baseUrl + '&fmt=json3', { headers: { 'user-agent': UA_BROWSER } });
            if (tr.ok) { const tj = await tr.json(); transcript = (tj.events || []).map((e: any) => (e.segs || []).map((s: any) => s.utf8 || '').join('')).join(' ').replace(/\s+/g, ' ').trim(); }
          } catch { /* transcript optional */ }
        }
      }
    } else { diag += ', no playerResponse'; }
  } catch (e) { diag += ' fetch err ' + (e as Error).message; }

  const sourceText = clip([title && ('Title: ' + title), description && ('Description:\n' + description), transcript && ('Transcript:\n' + transcript)].filter(Boolean).join('\n\n'));
  if (!sourceText || sourceText.length < 20) return { ok: false, platform: 'youtube', title, author, thumbnail, note: 'This Short has no usable caption or description. Paste the recipe text or share a screenshot instead. (' + diag + ')', diag };
  return { ok: true, platform: 'youtube', title, author, thumbnail, sourceText };
}

function instagramShortcode(u: URL): string | null {
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p === 'reel' || p === 'reels' || p === 'p' || p === 'tv');
  return i >= 0 ? (parts[i + 1] || null) : null;
}

// Pull a caption out of Instagram HTML using several strategies, most reliable first.
function captionFromHtml(html: string): { text: string; strat: string } {
  // 1) GraphQL caption node (present in embed + page JSON). Tolerant of escaped quotes/backslashes.
  let m = html.match(/edge_media_to_caption[\\\s"]*:[\s\S]{0,40}?[\\"]text[\\"]*\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) { const t = unescapeJson(m[1]); if (t.trim().length > 10) return { text: t, strat: 'graphql' }; }
  // 2) A bare "caption":"..." field.
  m = html.match(/[\\"]caption[\\"]*\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) { const t = unescapeJson(m[1]); if (t.trim().length > 15) return { text: t, strat: 'caption-field' }; }
  // 3) The rendered caption block in the /embed/captioned/ page.
  m = html.match(/<div[^>]*class="[^"]*Caption[^"]*"[\s\S]*?<\/div>/i);
  if (m) { const t = stripTags(m[0].replace(/<div[^>]*class="[^"]*CaptionUsername[^"]*"[\s\S]*?<\/a>/i, '')); if (t.trim().length > 15) return { text: t, strat: 'caption-div' }; }
  // 4) og:description link-preview text (usually "N likes, M comments - user on date: "caption"").
  m = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) || html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i);
  if (m && m[1]) {
    let t = decodeEntities(m[1]);
    const q = t.match(/:\s*[""']([\s\S]+)[""']\s*$/); // strip the "N likes... user on date:" preamble if present
    if (q && q[1]) t = q[1];
    if (t.trim().length > 15) return { text: t, strat: 'og' };
  }
  return { text: '', strat: 'none' };
}

async function extractInstagram(u: URL) {
  const code = instagramShortcode(u);
  if (!code) return { ok: false, platform: 'instagram', note: 'Could not read the Instagram post id from that link.' };
  const attempts: Array<{ url: string; ua: string }> = [
    { url: 'https://www.instagram.com/reel/' + code + '/embed/captioned/', ua: UA_BROWSER },
    { url: 'https://www.instagram.com/p/' + code + '/embed/captioned/', ua: UA_BROWSER },
    { url: 'https://www.instagram.com/reel/' + code + '/', ua: UA_BOT },
  ];
  let caption = '', thumbnail = '', diag = '';
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, { headers: { 'user-agent': a.ua, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
      const html = await r.text();
      const found = captionFromHtml(html);
      const tag = a.url.includes('/embed/') ? 'embed' : 'page';
      diag += (diag ? ' | ' : '') + tag + ' ' + r.status + '/' + Math.round(html.length / 1024) + 'kb/' + found.strat;
      if (!thumbnail) { const t = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i); if (t) thumbnail = decodeEntities(t[1]); }
      if (found.text) { caption = found.text; break; }
    } catch (e) { diag += (diag ? ' | ' : '') + 'err ' + (e as Error).message; }
  }
  const sourceText = clip(caption);
  if (!sourceText || sourceText.length < 20) {
    return { ok: false, platform: 'instagram', thumbnail, note: 'Could not read this Reel automatically (Instagram often hides captions from apps). Paste the caption or share a screenshot instead. (' + diag + ')', diag };
  }
  return { ok: true, platform: 'instagram', thumbnail, sourceText: 'Caption:\n' + sourceText, diag };
}

// TikTok has no captions API we can reach, but its public oEmbed returns the video caption in
// `title` (plus author + thumbnail); the video page's og:description / embedded "desc" is the
// fallback. Short share links (vm./vt.tiktok.com) 30x-redirect to the canonical video URL, so we
// resolve those first and re-check the host, so a short link can't redirect us off TikTok (SSRF).
function isTikTokHost(h: string): boolean {
  h = h.replace(/^www\./, '');
  return h === 'tiktok.com' || h === 'm.tiktok.com' || h === 'vm.tiktok.com' || h === 'vt.tiktok.com';
}
async function tiktokCanonical(u: URL): Promise<URL> {
  const h = u.hostname.replace(/^www\./, '');
  if (h !== 'vm.tiktok.com' && h !== 'vt.tiktok.com') return u;
  try {
    const r = await fetch(u.toString(), { headers: { 'user-agent': UA_BROWSER }, redirect: 'follow' });
    try { await r.body?.cancel(); } catch { /* ignore */ }
    try { const cu = new URL(r.url); if (isTikTokHost(cu.hostname) && cu.hostname.replace(/^www\./, '') !== u.hostname.replace(/^www\./, '')) return cu; } catch { /* keep original */ }
  } catch { /* keep original */ }
  return u;
}
async function extractTikTok(u0: URL) {
  const u = await tiktokCanonical(u0);
  const canon = u.toString().split('?')[0].split('#')[0];
  let title = '', author = '', thumbnail = '', caption = '', diag = '';
  try {
    const o = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(canon), { headers: { 'user-agent': UA_BROWSER } });
    diag = 'oembed ' + o.status;
    if (o.ok) { const j = await o.json(); title = j.title || ''; author = j.author_name || ''; thumbnail = j.thumbnail_url || ''; if (j.title) caption = j.title; }
  } catch (e) { diag += ' oembed-err ' + (e as Error).message; }
  if (!caption || caption.length < 20) {
    try {
      const r = await fetch(u.toString(), { headers: { 'user-agent': UA_BROWSER, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
      const html = await r.text();
      diag += ' | page ' + r.status + '/' + Math.round(html.length / 1024) + 'kb';
      if (!thumbnail) { const t = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i); if (t) thumbnail = decodeEntities(t[1]); }
      const m = html.match(/"desc"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (m && m[1]) { const t = unescapeJson(m[1]); if (t.trim().length > caption.length) caption = t; }
      if (!caption || caption.length < 20) {
        const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) || html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i);
        if (og && og[1]) { const t = decodeEntities(og[1]).trim(); if (t.length > 15) caption = t; }
      }
    } catch (e) { diag += ' page-err ' + (e as Error).message; }
  }
  const sourceText = clip(caption ? ('Caption:\n' + caption) : '');
  if (!sourceText || sourceText.length < 20) {
    return { ok: false, platform: 'tiktok', title, author, thumbnail, note: 'Could not read this TikTok automatically (its caption may be too short or hidden). Paste the caption or share a screenshot instead. (' + diag + ')', diag };
  }
  return { ok: true, platform: 'tiktok', title, author, thumbnail, sourceText, diag };
}

// Fetch the cover/thumbnail bytes server-side and base64 them, so the client can (a) inline them as
// durable recipe art (CDN links expire) and (b) hand the cover to the vision model when the caption
// has no usable recipe text: the ingredient list is very often overlaid on a Reel/TikTok cover.
async function fetchThumbBytes(url: string): Promise<{ b64: string; mime: string } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA_BROWSER } });
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > 2_500_000) return null; // skip empties / oversized covers
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CH)));
    return { b64: btoa(bin), mime };
  } catch { return null; }
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
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return json({ ok: false, note: 'Only http(s) links are supported.' }, 400);

  const host = u.hostname.replace(/^www\./, '');
  const isYT = host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  const isIG = host === 'instagram.com';
  const isTT = isTikTokHost(host);
  if (!isYT && !isIG && !isTT) return json({ ok: false, note: 'Share a YouTube, Instagram or TikTok link. Other sites are not supported yet.' }, 400);

  try {
    const out = isYT ? await extractYouTube(u) : isIG ? await extractInstagram(u) : await extractTikTok(u);
    // Attach cover bytes whenever we have a thumbnail URL (on success AND failure): the client inlines
    // them for durable art, and falls back to reading the cover with vision when the caption was thin.
    if ((out as any).thumbnail && !(out as any).thumb_b64) {
      const tb = await fetchThumbBytes((out as any).thumbnail);
      if (tb) { (out as any).thumb_b64 = tb.b64; (out as any).thumb_mime = tb.mime; }
    }
    console.log('recipe-extract', host, (out as any).ok, (out as any).thumb_b64 ? 'thumb' : 'no-thumb', (out as any).diag || '');
    return json({ ...out, source_url: raw });
  } catch (e) {
    return json({ ok: false, note: 'Could not read that link: ' + (e as Error).message, source_url: raw });
  }
});
