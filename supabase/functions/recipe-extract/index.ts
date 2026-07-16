// recipe-extract - fetch the public text behind a shared YouTube Short or Instagram Reel so the
// client can hand it to the AI structurer (via the existing ai-proxy). This function holds NO API
// keys and calls no paid API: it only fetches public pages the browser itself cannot reach (CORS).
// verify_jwt is enabled at deploy time, so only signed-in users reach it; we additionally allow-list
// hosts to prevent it being used as an open fetch proxy (SSRF). Every failure degrades to ok:false so
// the client can fall back to a manual paste / screenshot flow. Contract:
//   POST { url } -> { ok, platform, title, author, thumbnail, sourceText, note }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_TEXT = 12000; // cap sourceText so a giant page can't blow up the AI call
const clip = (s: string, n = MAX_TEXT) => (s || '').length > n ? (s || '').slice(0, n) : (s || '');

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

const stripTags = (h: string) =>
  (h || '')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] || null;
  const v = u.searchParams.get('v');
  return v || null;
}

async function extractYouTube(u: URL) {
  const id = youtubeId(u);
  if (!id) return { ok: false, platform: 'youtube', note: 'Could not read the YouTube video id from that link.' };
  const watch = 'https://www.youtube.com/watch?v=' + id + '&hl=en&gl=US';
  let title = '', author = '', thumbnail = '', description = '', transcript = '';

  // 1) oEmbed for clean title/author/thumbnail (best effort).
  try {
    const o = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { headers: { 'user-agent': UA } });
    if (o.ok) { const j = await o.json(); title = j.title || ''; author = j.author_name || ''; thumbnail = j.thumbnail_url || ''; }
  } catch { /* best effort */ }

  // 2) Watch page -> player response (description + caption track), consent-cookied for the EU.
  try {
    const r = await fetch(watch, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' } });
    const html = await r.text();
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
            const tr = await fetch(pick.baseUrl + '&fmt=json3', { headers: { 'user-agent': UA } });
            if (tr.ok) {
              const tj = await tr.json();
              transcript = (tj.events || [])
                .map((e: any) => (e.segs || []).map((s: any) => s.utf8 || '').join(''))
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            }
          } catch { /* transcript optional */ }
        }
      }
    }
  } catch { /* fall through to whatever we have */ }

  const sourceText = clip(
    [title && ('Title: ' + title), description && ('Description:\n' + description), transcript && ('Transcript:\n' + transcript)]
      .filter(Boolean).join('\n\n')
  );
  if (!sourceText || sourceText.length < 20) {
    return { ok: false, platform: 'youtube', title, author, thumbnail, note: 'This Short has no usable caption or description. Paste the recipe text or share a screenshot instead.' };
  }
  return { ok: true, platform: 'youtube', title, author, thumbnail, sourceText };
}

function instagramShortcode(u: URL): string | null {
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p === 'reel' || p === 'reels' || p === 'p' || p === 'tv');
  return i >= 0 ? (parts[i + 1] || null) : null;
}

async function extractInstagram(u: URL) {
  const code = instagramShortcode(u);
  if (!code) return { ok: false, platform: 'instagram', note: 'Could not read the Instagram post id from that link.' };
  let caption = '', title = '', thumbnail = '';
  try {
    const r = await fetch('https://www.instagram.com/reel/' + code + '/embed/captioned/', { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
    const html = await r.text();
    // Preferred: the caption div rendered into the embed page.
    const m = html.match(/<div class="Caption"[\s\S]*?<div class="CaptionUsername"[\s\S]*?<\/a>([\s\S]*?)<\/div>/i);
    if (m && m[1]) caption = stripTags(m[1]);
    // Fallback: a JSON blob with the caption text.
    if (!caption) {
      const j = html.match(/"edge_media_to_caption":\s*\{\s*"edges":\s*\[\s*\{\s*"node":\s*\{\s*"text":\s*"((?:[^"\\]|\\.)*)"/);
      if (j && j[1]) { try { caption = JSON.parse('"' + j[1] + '"'); } catch { caption = j[1]; } }
    }
    const t = html.match(/<img[^>]+class="EmbeddedMediaImage"[^>]+src="([^"]+)"/i);
    if (t && t[1]) thumbnail = t[1].replace(/&amp;/g, '&');
  } catch { /* fall through */ }

  const sourceText = clip(caption);
  if (!sourceText || sourceText.length < 20) {
    return { ok: false, platform: 'instagram', thumbnail, note: 'Could not read this Reel automatically (Instagram often hides captions). Paste the caption or share a screenshot instead.' };
  }
  return { ok: true, platform: 'instagram', title, thumbnail, sourceText: 'Caption:\n' + sourceText };
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
  if (!isYT && !isIG) return json({ ok: false, note: 'Share a YouTube or Instagram link. Other sites are not supported yet.' }, 400);

  try {
    const out = isYT ? await extractYouTube(u) : await extractInstagram(u);
    return json({ ...out, source_url: raw });
  } catch (e) {
    return json({ ok: false, note: 'Could not read that link: ' + (e as Error).message, source_url: raw });
  }
});
