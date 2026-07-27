// recipe-extract - read everything public behind a shared YouTube Short, Instagram Reel or TikTok so
// the client can hand it to the AI structurer (via the existing ai-proxy). It only fetches public
// resources the browser itself cannot reach (CORS). verify_jwt is enabled at deploy time, so only
// signed-in users reach it; we additionally allow-list hosts to prevent it being used as an open
// fetch proxy (SSRF). Every failure degrades to ok:false so the client can fall back to a manual
// paste / screenshot flow, and carries a short `diag` string so extraction problems are debuggable.
//
// Most cooking Reels/TikToks never write the recipe down: it is SPOKEN, and shown on screen. Reading
// only the caption is why so many shares used to land as a two-line half-recipe. So this function
// serves three actions, and the client climbs them only as far as it needs to:
//
//   POST { url }                     -> extract: caption/description + the creator's own SPOKEN words
//                                      from free platform sources (YouTube caption tracks, TikTok's
//                                      auto-captions), plus the cover image bytes. No paid API.
//   POST { url, action:'media' }     -> the video bytes themselves (video/mp4), so the client can
//                                      decode frames and show the on-screen text to the vision model.
//                                      No paid API.
//   POST { url, action:'transcribe' }-> a real speech-to-text transcript of the audio. This is the
//                                      only paid path and it is OPT-IN: with no TRANSCRIBE_API_KEY
//                                      set it returns ok:false/not_configured and the ladder simply
//                                      stops one rung lower. Spend is recorded against the caller's
//                                      monthly AI usage, the same pot as ai-proxy.
//
// Extract contract: { ok, platform, title, author, thumbnail, sourceText, parts, tiers, note, diag }
//   parts = { title, author, caption, description, subtitles } - the labelled pieces, so the client
//   can re-assemble them with anything it reads itself (frames, audio) instead of re-parsing prose.

// Every pure "read it out of this page" rule lives in parse.ts so it can be unit-tested against
// fixtures (tests/recipe-extract.test.js); this file is the network I/O and the request handler.
import {
  clip, decodeEntities, jsonAfter, youtubeId, ytCaptionTracks, pickCaptionTrack,
  instagramShortcode, captionFromHtml, igVideoUrl, igAltText, igAuthor,
  isTikTokHost, vttToText, tiktokSubtitleUrls, tiktokVideoUrl,
} from './parse.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_BOT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

// ---- YouTube ----------------------------------------------------------------------------------
// Turn a YouTube caption track into plain text. json3 is the clean shape, but caption URLs
// increasingly 403 or return an empty body for it, so fall back to the legacy XML form before
// giving up: half the Shorts we care about only have auto-generated (ASR) captions.
async function captionTrackText(baseUrl: string): Promise<string> {
  const strip = (s: string) => s.replace(/\s+/g, ' ').trim();
  try {
    const r = await fetch(baseUrl + '&fmt=json3', { headers: { 'user-agent': UA_BROWSER } });
    if (r.ok) {
      const t = await r.text();
      if (t.trim().startsWith('{')) {
        const tj = JSON.parse(t);
        const out = strip((tj.events || []).map((e: any) => (e.segs || []).map((s: any) => s.utf8 || '').join('')).join(' '));
        if (out) return out;
      }
    }
  } catch { /* try XML */ }
  try {
    const r = await fetch(baseUrl, { headers: { 'user-agent': UA_BROWSER } });
    if (!r.ok) return '';
    const xml = await r.text();
    const lines = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')));
    return strip(lines.join(' '));
  } catch { return ''; }
}
// The public InnerTube player endpoint. The watch page increasingly ships without an inline
// ytInitialPlayerResponse (or without its caption tracks), and this is the same call the site's own
// player makes, so it is the difference between "no transcript" and a full spoken recipe.
const YT_INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // public web client key
async function ytInnertubePlayer(id: string, client: 'WEB' | 'ANDROID'): Promise<any> {
  const context = client === 'ANDROID'
    ? { client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'US' } }
    : { client: { clientName: 'WEB', clientVersion: '2.20240401.00.00', hl: 'en', gl: 'US' } };
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?key=' + YT_INNERTUBE_KEY, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA_BROWSER, 'accept-language': 'en-US,en;q=0.9' },
      body: JSON.stringify({ context, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function extractYouTube(u: URL) {
  const id = youtubeId(u);
  if (!id) return { ok: false, platform: 'youtube', note: 'Could not read the YouTube video id from that link.' };
  let title = '', author = '', thumbnail = '', description = '', transcript = '', diag = '';
  let tracks: any[] = [];
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
      tracks = ytCaptionTracks(pr);
    } else { diag += ', no playerResponse'; }
  } catch (e) { diag += ' fetch err ' + (e as Error).message; }

  // No captions in the page? Ask the player API directly (WEB carries caption tracks; ANDROID is the
  // long stop when WEB is age/bot-gated).
  if (!tracks.length) {
    for (const client of ['WEB', 'ANDROID'] as const) {
      const pr = await ytInnertubePlayer(id, client);
      if (!pr) { diag += ' | it:' + client + ' fail'; continue; }
      const vd = pr.videoDetails || {};
      if (!title) title = vd.title || '';
      if (!author) author = vd.author || '';
      if (!description) description = vd.shortDescription || '';
      tracks = ytCaptionTracks(pr);
      diag += ' | it:' + client + ' ' + tracks.length + ' tracks';
      if (tracks.length) break;
    }
  }
  const track = pickCaptionTrack(tracks);
  if (track?.baseUrl) {
    transcript = await captionTrackText(track.baseUrl);
    diag += ' | cap ' + (track.kind === 'asr' ? 'asr' : 'human') + '/' + (track.languageCode || '?') + ' ' + transcript.length + 'ch';
  }

  const parts = { title, author, description, subtitles: transcript };
  const sourceText = clip([title && ('Title: ' + title), description && ('Description:\n' + description), transcript && ('Transcript:\n' + transcript)].filter(Boolean).join('\n\n'));
  if (!sourceText || sourceText.length < 20) return { ok: false, platform: 'youtube', title, author, thumbnail, parts, note: 'This Short has no usable caption or description. (' + diag + ')', diag };
  return { ok: true, platform: 'youtube', title, author, thumbnail, parts, sourceText, diag };
}

// ---- Instagram --------------------------------------------------------------------------------
async function extractInstagram(u: URL) {
  const code = instagramShortcode(u);
  if (!code) return { ok: false, platform: 'instagram', note: 'Could not read the Instagram post id from that link.' };
  const attempts: Array<{ url: string; ua: string }> = [
    { url: 'https://www.instagram.com/reel/' + code + '/embed/captioned/', ua: UA_BROWSER },
    { url: 'https://www.instagram.com/p/' + code + '/embed/captioned/', ua: UA_BROWSER },
    { url: 'https://www.instagram.com/reel/' + code + '/', ua: UA_BOT },
  ];
  let caption = '', thumbnail = '', diag = '', mediaUrl = '', alt = '', author = '';
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, { headers: { 'user-agent': a.ua, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
      const html = await r.text();
      const found = captionFromHtml(html);
      const tag = a.url.includes('/embed/') ? 'embed' : 'page';
      diag += (diag ? ' | ' : '') + tag + ' ' + r.status + '/' + Math.round(html.length / 1024) + 'kb/' + found.strat;
      if (!thumbnail) { const t = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i); if (t) thumbnail = decodeEntities(t[1]); }
      if (!mediaUrl) { mediaUrl = igVideoUrl(html); if (mediaUrl) diag += '/video'; }
      if (!alt) alt = igAltText(html);
      if (!author) author = igAuthor(html);
      // Stop as soon as we have the caption: the media URL is nice to have here but never worth an
      // extra round trip, because the frames rung re-resolves it on its own request anyway.
      if (found.text) { caption = found.text; break; }
    } catch (e) { diag += (diag ? ' | ' : '') + 'err ' + (e as Error).message; }
  }
  const parts = { author, caption, screen: alt };
  const sourceText = clip([caption && ('Caption:\n' + caption), alt && ('On-screen text:\n' + alt)].filter(Boolean).join('\n\n'));
  const base = { platform: 'instagram', thumbnail, author, parts, mediaUrl, diag };
  if (!sourceText || sourceText.length < 20) {
    return { ...base, ok: false, note: 'Could not read this Reel\'s caption (Instagram often hides it from apps). (' + diag + ')' };
  }
  return { ...base, ok: true, sourceText };
}

// ---- TikTok -----------------------------------------------------------------------------------
// Its public oEmbed returns the video caption in `title` (plus author + thumbnail); the video
// page's og:description / embedded "desc" is the fallback, and the page also carries the
// auto-caption WebVTT tracks (parse.ts) - the creator's spoken recipe, free. Short share links
// (vm./vt.tiktok.com) 30x-redirect to the canonical video URL, so we resolve those first and
// re-check the host, so a short link can't redirect us off TikTok (SSRF).
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
  let title = '', author = '', thumbnail = '', caption = '', diag = '', subtitles = '', mediaUrl = '';
  try {
    const o = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(canon), { headers: { 'user-agent': UA_BROWSER } });
    diag = 'oembed ' + o.status;
    if (o.ok) { const j = await o.json(); title = j.title || ''; author = j.author_name || ''; thumbnail = j.thumbnail_url || ''; if (j.title) caption = j.title; }
  } catch (e) { diag += ' oembed-err ' + (e as Error).message; }
  // Always read the page now (not just when the caption is thin): the subtitles and the media URL
  // only live there, and they are worth far more than the caption we may already have.
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
    mediaUrl = tiktokVideoUrl(html);
    const subs = tiktokSubtitleUrls(html);
    diag += ' | subs ' + subs.length + (mediaUrl ? '/video' : '');
    for (const s of subs.slice(0, 3)) {
      try {
        const sr = await fetch(s.url, { headers: { 'user-agent': UA_BROWSER, referer: 'https://www.tiktok.com/' } });
        if (!sr.ok) continue;
        const txt = vttToText(await sr.text());
        if (txt.length > subtitles.length) subtitles = txt;
        if (subtitles.length > 80) break;
      } catch { /* next track */ }
    }
    if (subtitles) diag += '/' + subtitles.length + 'ch';
  } catch (e) { diag += ' page-err ' + (e as Error).message; }

  const parts = { title: '', author, caption, subtitles };
  const sourceText = clip([caption && ('Caption:\n' + caption), subtitles && ('Transcript:\n' + subtitles)].filter(Boolean).join('\n\n'));
  const base = { platform: 'tiktok', title, author, thumbnail, parts, mediaUrl, diag };
  if (!sourceText || sourceText.length < 20) {
    return { ...base, ok: false, note: 'Could not read this TikTok automatically (its caption may be too short or hidden). (' + diag + ')' };
  }
  return { ...base, ok: true, sourceText };
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

// ---- Video bytes: the frames path -------------------------------------------------------------
// The recipe a creator never wrote down is usually still ON SCREEN - the ingredient card held up for
// three seconds mid-Reel. The browser cannot fetch the MP4 itself (CORS, signed CDN hosts, Referer
// checks), so we re-resolve the media URL server-side from the share link the user gave us and
// stream the bytes back. The fetch target is always derived from an allow-listed platform page, never
// taken from the request body, so this cannot be turned into an open proxy.
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
async function resolveMedia(u: URL, platform: string): Promise<{ url: string; referer: string }> {
  // Deliberately a lighter path than the full extract (no subtitle downloads, no oEmbed): this runs
  // on a second request, and all it needs is the MP4 URL.
  const page = async (target: string, ua = UA_BROWSER) => {
    try {
      const r = await fetch(target, { headers: { 'user-agent': ua, 'accept-language': 'en-US,en;q=0.9' }, redirect: 'follow' });
      return r.ok ? await r.text() : '';
    } catch { return ''; }
  };
  if (platform === 'instagram') {
    const code = instagramShortcode(u);
    if (!code) return { url: '', referer: '' };
    for (const target of [
      'https://www.instagram.com/reel/' + code + '/embed/captioned/',
      'https://www.instagram.com/p/' + code + '/embed/captioned/',
    ]) {
      const url = igVideoUrl(await page(target));
      if (url) return { url, referer: 'https://www.instagram.com/' };
    }
    return { url: '', referer: 'https://www.instagram.com/' };
  }
  if (platform === 'tiktok') {
    const canon = await tiktokCanonical(u);
    return { url: tiktokVideoUrl(await page(canon.toString())), referer: 'https://www.tiktok.com/' };
  }
  return { url: '', referer: '' }; // YouTube streams are split/throttled; its captions carry the words instead
}
// Fetch the resolved media into memory, capped. Returns null when the CDN refuses us (signed URLs
// expire and TikTok rotates them), which just means the ladder skips the frames rung.
async function fetchMedia(media: { url: string; referer: string }): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!media.url) return null;
  try {
    const r = await fetch(media.url, {
      headers: { 'user-agent': UA_BROWSER, referer: media.referer, accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8', range: 'bytes=0-' + (MAX_MEDIA_BYTES - 1) },
      redirect: 'follow',
    });
    if (!r.ok && r.status !== 206) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const mime = (r.headers.get('content-type') || 'video/mp4').split(';')[0].trim();
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_MEDIA_BYTES) return null;
    return { bytes: buf, mime: mime.startsWith('video/') || mime.startsWith('audio/') ? mime : 'video/mp4' };
  } catch { return null; }
}

// ---- Speech to text: the last rung ------------------------------------------------------------
// Opt-in and off by default. Set TRANSCRIBE_API_KEY (an OpenAI-compatible audio-transcriptions key)
// to switch it on; TRANSCRIBE_URL / TRANSCRIBE_MODEL override the endpoint and model if you would
// rather point it at another provider. Whisper-compatible endpoints accept an MP4 container
// directly, so there is no ffmpeg step. With no key set this returns not_configured and the client
// simply stops one rung lower - nothing breaks, nothing is spent.
const TRANSCRIBE_URL = Deno.env.get('TRANSCRIBE_URL') || 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIBE_MODEL = Deno.env.get('TRANSCRIBE_MODEL') || 'whisper-1';
const TRANSCRIBE_USD_PER_MIN = Number(Deno.env.get('TRANSCRIBE_USD_PER_MIN') || '0.006');
async function transcribeMedia(bytes: Uint8Array, mime: string): Promise<{ text: string; seconds: number; note?: string }> {
  const key = Deno.env.get('TRANSCRIBE_API_KEY');
  if (!key) return { text: '', seconds: 0, note: 'not_configured' };
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'video/mp4' }), 'clip.mp4');
  form.append('model', TRANSCRIBE_MODEL);
  form.append('response_format', 'verbose_json');
  // A cooking video's vocabulary is predictable; nudging the model at it cuts "150g of oats" being
  // heard as "150 grams of oaths" and similar ingredient mangling.
  form.append('prompt', 'A short cooking video. The speaker lists recipe ingredients with amounts in grams, millilitres, tablespoons and teaspoons, then the method.');
  const r = await fetch(TRANSCRIBE_URL, { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: form });
  if (!r.ok) return { text: '', seconds: 0, note: 'transcribe ' + r.status + ' ' + (await r.text()).slice(0, 200) };
  const j = await r.json().catch(() => ({}));
  return { text: String(j?.text || '').replace(/\s+/g, ' ').trim(), seconds: Number(j?.duration) || 0 };
}
// Bill transcription to the same monthly pot as ai-proxy, so the fair-use ceiling stays meaningful
// once this is switched on. Best effort: a failed write must never fail the request.
async function recordTranscribeSpend(userId: string, seconds: number) {
  try {
    if (!userId || !(seconds > 0)) return;
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return;
    const cost = (seconds / 60) * TRANSCRIBE_USD_PER_MIN;
    await fetch(url + '/rest/v1/rpc/add_ai_usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: key, authorization: 'Bearer ' + key },
      body: JSON.stringify({ p_user: userId, p_period: new Date().toISOString().slice(0, 7), p_cost: cost }),
    });
  } catch { /* non-fatal */ }
}
function callerId(req: Request): string {
  try {
    const p = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').split('.')[1];
    if (!p) return '';
    const b = p.replace(/-/g, '+').replace(/_/g, '/').padEnd(p.length + (4 - (p.length % 4)) % 4, '=');
    return JSON.parse(atob(b))?.sub || '';
  } catch { return ''; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, note: 'Method not allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, note: 'Bad request body.' }, 400); }
  const raw = String(body?.url || '').trim();
  if (!raw) return json({ ok: false, note: 'No link provided.' }, 400);
  const action = String(body?.action || 'extract');

  let u: URL;
  try { u = new URL(raw); } catch { return json({ ok: false, note: 'That does not look like a valid link.' }, 400); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return json({ ok: false, note: 'Only http(s) links are supported.' }, 400);

  const host = u.hostname.replace(/^www\./, '');
  const isYT = host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  const isIG = host === 'instagram.com';
  const isTT = isTikTokHost(host);
  if (!isYT && !isIG && !isTT) return json({ ok: false, note: 'Share a YouTube, Instagram or TikTok link. Other sites are not supported yet.' }, 400);
  const platform = isYT ? 'youtube' : isIG ? 'instagram' : 'tiktok';

  try {
    // --- the video bytes, for client-side frame reading ---
    if (action === 'media') {
      const media = await fetchMedia(await resolveMedia(u, platform));
      if (!media) return json({ ok: false, platform, note: 'No downloadable video for that link.' }, 404);
      console.log('recipe-extract media', platform, media.bytes.length);
      return new Response(media.bytes, { headers: { ...cors, 'content-type': media.mime, 'content-length': String(media.bytes.length) } });
    }

    // --- speech to text (opt-in, paid) ---
    if (action === 'transcribe') {
      if (!Deno.env.get('TRANSCRIBE_API_KEY')) return json({ ok: false, platform, reason: 'not_configured', note: 'Audio transcription is not switched on.' });
      const media = await fetchMedia(await resolveMedia(u, platform));
      if (!media) return json({ ok: false, platform, reason: 'no_media', note: 'Could not download the video to listen to it.' });
      const t = await transcribeMedia(media.bytes, media.mime);
      if (!t.text) return json({ ok: false, platform, reason: 'no_speech', note: t.note || 'No speech found in that video.' });
      await recordTranscribeSpend(callerId(req), t.seconds);
      console.log('recipe-extract transcribe', platform, Math.round(t.seconds) + 's', t.text.length + 'ch');
      return json({ ok: true, platform, transcript: t.text, seconds: t.seconds });
    }

    // --- default: read every free source behind the link ---
    const out: any = isYT ? await extractYouTube(u) : isIG ? await extractInstagram(u) : await extractTikTok(u);
    // Attach cover bytes whenever we have a thumbnail URL (on success AND failure): the client inlines
    // them for durable art, and falls back to reading the cover with vision when the caption was thin.
    if (out.thumbnail && !out.thumb_b64) {
      const tb = await fetchThumbBytes(out.thumbnail);
      if (tb) { out.thumb_b64 = tb.b64; out.thumb_mime = tb.mime; }
    }
    // Tell the client which heavier rungs are worth attempting. `frames`/`transcribe` say the media
    // action MIGHT serve this platform, not that it definitely will: whether the CDN plays ball is
    // settled on that request, and a no is handled there. YouTube never serves media (its streams
    // are split and throttled) but its caption track already carries the spoken words.
    out.tiers = {
      text: !!out.sourceText,
      subtitles: !!(out.parts && out.parts.subtitles),
      frames: platform !== 'youtube',
      transcribe: platform !== 'youtube' && !!Deno.env.get('TRANSCRIBE_API_KEY'),
    };
    delete out.mediaUrl; // internal: the client asks for media by share link, never by CDN url
    console.log('recipe-extract', host, out.ok, out.thumb_b64 ? 'thumb' : 'no-thumb', JSON.stringify(out.tiers), out.diag || '');
    return json({ ...out, source_url: raw });
  } catch (e) {
    return json({ ok: false, note: 'Could not read that link: ' + (e as Error).message, source_url: raw });
  }
});
