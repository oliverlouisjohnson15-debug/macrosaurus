/*
 * parse.ts - Every pure "read the recipe out of this page" rule the extractor uses, split out from
 * index.ts (which keeps the network I/O and the request handler) so the parsing can be unit-tested.
 *
 * This is the fragile half of recipe import: Instagram, TikTok and YouTube each hide the caption,
 * the creator's spoken words and the video URL somewhere different, change the shape without
 * warning, and serve a different one to a bot than to a browser. Every function here is a
 * best-effort read that degrades to '' or null rather than throwing, and every one is covered in
 * tests/recipe-extract.test.js against fixtures shaped like the real pages, so a change to one
 * platform's parsing cannot silently break another's.
 *
 * Types are stripped by node for the tests; it ships as-is to the Deno edge runtime.
 */

export const MAX_TEXT = 12000; // cap sourceText so a giant page can't blow up the AI call
export const clip = (s: string, n = MAX_TEXT) => (s || '').length > n ? (s || '').slice(0, n) : (s || '');

// Decode a JSON-escaped string body (\n, \uXXXX, \/, ...) captured by a regex group.
export function unescapeJson(s: string): string { try { return JSON.parse('"' + s.replace(/\n/g, '\\n') + '"'); } catch { return s; } }
export function decodeEntities(h: string): string {
  return (h || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h2) => String.fromCodePoint(parseInt(h2, 16)));
}
export const stripTags = (h: string) => decodeEntities((h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();

// Find the first balanced {...} object starting at/after a marker string. Ignores braces in strings.
export function jsonAfter(html: string, marker: string): any {
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

// Same balanced read as jsonAfter, but for the first [...] after a marker (TikTok's subtitle list).
export function jsonArrayAfter(html: string, marker: string): any {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('[', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
    }
  }
  return null;
}

export function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] || null;
  return u.searchParams.get('v');
}

// The caption tracks inside a player response, from the watch page or the InnerTube player API.
export function ytCaptionTracks(pr: any): any[] {
  const t = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(t) ? t : [];
}
// Prefer a human-written English track over the auto-generated one (ASR mishears ingredient names),
// then any English, then whatever exists - a Spanish transcript still beats nothing, the structurer
// reads it fine.
export function pickCaptionTrack(tracks: any[]): any {
  const en = tracks.filter((t) => String(t.languageCode || '').startsWith('en'));
  return en.find((t) => t.kind !== 'asr') || en[0] || tracks.find((t) => t.kind !== 'asr') || tracks[0] || null;
}

// ---- Instagram --------------------------------------------------------------------------------
export function instagramShortcode(u: URL): string | null {
  const parts = u.pathname.split('/').filter(Boolean);
  const i = parts.findIndex((p) => p === 'reel' || p === 'reels' || p === 'p' || p === 'tv');
  return i >= 0 ? (parts[i + 1] || null) : null;
}

// Read a <meta> content value tolerant of attribute order and quote style. `key` is the property/name.
export function metaContent(html: string, key: string): string {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const res = [
    new RegExp('<meta[^>]+(?:property|name)=["\']' + k + '["\'][^>]*?content=["\']([^"\']*)["\']', 'i'),
    new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*?(?:property|name)=["\']' + k + '["\']', 'i'),
  ];
  for (const re of res) { const mm = html.match(re); if (mm && mm[1]) return decodeEntities(mm[1]); }
  return '';
}
// Strip Instagram's "N likes, M comments - username on date:" engagement preamble from a preview line,
// leaving just the caption. Falls back to the whole string when the shape doesn't match.
export function stripIgPreamble(s: string): string {
  const q = s.match(/:\s*["\u201c\u201d']([\s\S]+?)["\u201c\u201d']\s*$/); // caption is often the trailing quoted part
  if (q && q[1]) return q[1].trim();
  return s.replace(/^\s*[\d.,]+\s+likes?,\s*[\d.,]+\s+comments?\s*[-\u2013\u2014]\s*/i, '')
          .replace(/^[^:]{0,80}?\son\s[^:]{0,40}:\s*/i, '').trim();
}
// Pull a caption out of Instagram HTML using several strategies, most reliable first.
export function captionFromHtml(html: string): { text: string; strat: string } {
  // 1) GraphQL caption node (present in embed + page JSON). Tolerant of escaped quotes/backslashes.
  let m = html.match(/edge_media_to_caption[\\\s"]*:[\s\S]{0,120}?[\\"]text[\\"]*\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) { const t = unescapeJson(m[1]); if (t.trim().length > 10) return { text: t, strat: 'graphql' }; }
  // 2) A bare "caption":"..." (or "caption_text":"...") field in embedded JSON.
  m = html.match(/[\\"](?:caption_text|caption)[\\"]*\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) { const t = unescapeJson(m[1]); if (t.trim().length > 15) return { text: t, strat: 'caption-field' }; }
  // 3) The rendered caption block in the /embed/captioned/ page (class name contains "Caption").
  m = html.match(/<div[^>]*class="[^"]*[Cc]aption[^"]*"[\s\S]*?<\/div>/);
  if (m) { const t = stripTags(m[0].replace(/<[^>]*class="[^"]*CaptionUsername[^"]*"[\s\S]*?<\/a>/i, '')); if (t.trim().length > 15) return { text: t, strat: 'caption-div' }; }
  // 4) Link-preview description (og / twitter / name), then peel off the engagement preamble.
  for (const key of ['og:description', 'twitter:description', 'description']) {
    const raw = metaContent(html, key);
    if (!raw) continue;
    const t = stripIgPreamble(raw);
    if (t.length > 15) return { text: t, strat: 'meta:' + key };
  }
  // 5) <title> ("username on Instagram: caption").
  const tt = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (tt) {
    const t = decodeEntities(tt).replace(/^[\s\S]*?on Instagram[^:]*:\s*/i, '').replace(/^["\u201c\u201d']|["\u201c\u201d']$/g, '').trim();
    if (t.length > 15 && !/^instagram$/i.test(t)) return { text: t, strat: 'title' };
  }
  return { text: '', strat: 'none' };
}

// The playable MP4 behind a Reel, when the embed exposes it. This is what lets the client read the
// on-screen ingredient card (frames) and, if transcription is switched on, hear the voiceover -
// the two places an Instagram recipe actually lives, since the caption is so often just a hook.
export function igVideoUrl(html: string): string {
  const m = html.match(/"video_url"\s*:\s*"((?:\\.|[^"\\])*)"/) || html.match(/<meta[^>]+property="og:video"[^>]+content="([^"]*)"/i);
  if (!m) return '';
  const url = decodeEntities(unescapeJson(m[1]));
  return /^https:\/\//.test(url) ? url : '';
}
// Instagram's own alt text ("Photo by X on ... may contain: text that says 'ADD 200G OATS'"). It is
// short, but it sometimes carries the on-screen text verbatim and costs nothing to read.
export function igAltText(html: string): string {
  const m = html.match(/"accessibility_caption"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const t = m ? unescapeJson(m[1]) : '';
  return /may contain|text that says/i.test(t) ? t : '';
}
export function igAuthor(html: string): string {
  const m = html.match(/"owner"\s*:\s*\{[^}]*?"username"\s*:\s*"((?:\\.|[^"\\])*)"/) || html.match(/"username"\s*:\s*"((?:\\.|[^"\\])*)"/);
  return m ? unescapeJson(m[1]).trim() : '';
}

// ---- TikTok -----------------------------------------------------------------------------------
export function isTikTokHost(h: string): boolean {
  h = h.replace(/^www\./, '');
  return h === 'tiktok.com' || h === 'm.tiktok.com' || h === 'vm.tiktok.com' || h === 'vt.tiktok.com';
}

// WebVTT (and TikTok's near-identical variant) to plain prose: drop the cue timings, the WEBVTT
// header and any inline tags, then collapse the repeated rolling-caption lines that karaoke-style
// subtitles produce, so "add 200g of" / "add 200g of oats" becomes one clean sentence.
export function vttToText(vtt: string): string {
  const lines = String(vtt || '').split(/\r?\n/);
  const out: string[] = [];
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || /^WEBVTT/i.test(line) || /^(NOTE|STYLE|REGION)\b/i.test(line)) continue;
    if (line.includes('-->') || /^\d+$/.test(line)) continue;
    const t = decodeEntities(line.replace(/<[^>]+>/g, '')).trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev === t) continue;
    // Rolling captions re-send the previous line with more words on the end: keep the longer one.
    if (prev && t.startsWith(prev)) { out[out.length - 1] = t; continue; }
    if (prev && prev.startsWith(t)) continue;
    out.push(t);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
// TikTok ships auto-generated captions (their "CLA" subtitles) as WebVTT URLs inside the video
// detail JSON on the page. That is the creator's spoken recipe, for free, with no transcription
// bill - by far the highest-value thing this function reads for TikTok.
export function tiktokSubtitleUrls(html: string): Array<{ url: string; lang: string }> {
  const out: Array<{ url: string; lang: string }> = [];
  const seen = new Set<string>();
  const add = (url: unknown, lang: unknown) => {
    const clean = decodeEntities(unescapeJson(String(url || '')));
    if (!/^https:\/\//.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push({ url: clean, lang: String(lang || '').toLowerCase() });
  };
  // Read the real array with a balanced parse - a lazy regex would stop at the first "]", which is
  // the one closing the nested UrlList, and drop every track after the first. The page ships this
  // JSON plain inside its rehydration script; when it arrives escaped instead (embedded in an
  // attribute), unescaping the quotes first makes the same parse work rather than needing a second,
  // shakier code path.
  for (const src of [html, html.indexOf('\\"subtitleInfos\\"') >= 0 ? html.replace(/\\"/g, '"') : '']) {
    if (!src) continue;
    for (const marker of ['"subtitleInfos"', '"SubtitleInfos"']) {
      const arr = jsonArrayAfter(src, marker);
      if (!Array.isArray(arr)) continue;
      for (const e of arr) add(e?.Url ?? e?.url, e?.LanguageCodeName ?? e?.language_code);
    }
  }
  // English first, then anything else (a Spanish transcript still beats no transcript).
  out.sort((a, b) => (b.lang.startsWith('en') ? 1 : 0) - (a.lang.startsWith('en') ? 1 : 0));
  return out;
}
export function tiktokVideoUrl(html: string): string {
  for (const key of ['playAddr', 'play_addr', 'downloadAddr']) {
    const m = html.match(new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"'));
    if (m && m[1]) { const url = decodeEntities(unescapeJson(m[1])); if (/^https:\/\//.test(url)) return url; }
  }
  return '';
}
