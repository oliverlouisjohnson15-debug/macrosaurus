'use strict';
// Tests for the page-parsing half of recipe import: supabase/functions/recipe-extract/parse.ts.
//
// This is where "I shared a Reel and it did not upload" actually comes from. The platforms hide the
// caption, the creator's spoken words and the video URL in a different place each, serve a different
// page to a bot than to a browser, and change shape without telling anyone. The fixtures below are
// shaped like the real pages (heavily trimmed), so a regression in one platform's parsing shows up
// here instead of in someone's cookbook.
//
// The module is TypeScript because it ships to the Deno edge runtime; node strips the types for us.
// Run with:  npm test   (the script passes --experimental-strip-types)
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/recipe-extract/parse.ts');

// ---- link shapes -----------------------------------------------------------------------------
test('youtubeId reads every share shape YouTube hands out', async () => {
  const { youtubeId } = await load();
  const id = (u) => youtubeId(new URL(u));
  assert.strictEqual(id('https://www.youtube.com/shorts/aB3_x-9'), 'aB3_x-9');
  assert.strictEqual(id('https://youtu.be/aB3_x-9?t=12'), 'aB3_x-9');
  assert.strictEqual(id('https://www.youtube.com/watch?v=aB3_x-9&feature=share'), 'aB3_x-9');
  assert.strictEqual(id('https://m.youtube.com/embed/aB3_x-9'), 'aB3_x-9');
  assert.strictEqual(id('https://www.youtube.com/'), null);
});
test('instagramShortcode handles reel, reels, p and tv links', async () => {
  const { instagramShortcode } = await load();
  const c = (u) => instagramShortcode(new URL(u));
  assert.strictEqual(c('https://www.instagram.com/reel/CxYz123/'), 'CxYz123');
  assert.strictEqual(c('https://www.instagram.com/reels/CxYz123/'), 'CxYz123');
  assert.strictEqual(c('https://www.instagram.com/p/CxYz123/?igsh=abc'), 'CxYz123');
  assert.strictEqual(c('https://www.instagram.com/chef/reel/CxYz123/'), 'CxYz123'); // creator-prefixed
  assert.strictEqual(c('https://www.instagram.com/chef/'), null);
});
test('isTikTokHost accepts the share hosts and nothing else', async () => {
  const { isTikTokHost } = await load();
  ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].forEach(h => assert.ok(isTikTokHost(h), h));
  ['tiktok.com.evil.net', 'nottiktok.com', 'evil.com'].forEach(h => assert.strictEqual(isTikTokHost(h), false, h));
});

// ---- Instagram: the caption, the creator, the video ------------------------------------------
const IG_EMBED = `<html><head>
<meta property="og:image" content="https://scontent.cdninstagram.com/cover.jpg?token=1&amp;x=2" />
<title>chefjoe on Instagram: "high protein pasta"</title>
</head><body>
<script>window.__additionalDataLoaded('extra',{"shortcode_media":{"owner":{"id":"1","username":"chefjoe"},
"accessibility_caption":"Photo by Chef Joe on July 01. May be an image of text that says '200G PASTA 150G CHICKEN'",
"video_url":"https://scontent.cdninstagram.com/v/clip.mp4?efg=abc\\u0026oe=1",
"edge_media_to_caption":{"edges":[{"node":{"text":"Creamy chicken pasta\\n200g pasta\\n150g chicken\\n100ml cream\\nServes 2"}}]}}});</script>
</body></html>`;

test('captionFromHtml pulls the real caption out of an Instagram embed', async () => {
  const { captionFromHtml } = await load();
  const found = captionFromHtml(IG_EMBED);
  assert.strictEqual(found.strat, 'graphql');
  assert.ok(found.text.includes('200g pasta'));
  assert.ok(found.text.includes('\n'), 'the newlines that separate ingredients must survive');
});
test('captionFromHtml falls back to the link preview, minus the engagement preamble', async () => {
  const { captionFromHtml } = await load();
  const html = `<meta property="og:description" content="1,234 likes, 56 comments - chefjoe on July 1, 2026: &quot;Creamy chicken pasta, 200g pasta and 150g chicken&quot;">`;
  const found = captionFromHtml(html);
  assert.strictEqual(found.strat, 'meta:og:description');
  assert.strictEqual(found.text, 'Creamy chicken pasta, 200g pasta and 150g chicken');
});
test('captionFromHtml says so rather than returning junk when the page is blocked', async () => {
  const { captionFromHtml } = await load();
  const found = captionFromHtml('<html><head><title>Instagram</title></head><body>Login required</body></html>');
  assert.deepStrictEqual(found, { text: '', strat: 'none' });
});
test('igVideoUrl / igAltText / igAuthor read the rest of what the embed leaks', async () => {
  const { igVideoUrl, igAltText, igAuthor } = await load();
  assert.strictEqual(igVideoUrl(IG_EMBED), 'https://scontent.cdninstagram.com/v/clip.mp4?efg=abc&oe=1');
  assert.ok(igAltText(IG_EMBED).includes('200G PASTA'));
  assert.strictEqual(igAuthor(IG_EMBED), 'chefjoe');
  // alt text that describes a scene rather than on-screen writing is not recipe evidence
  assert.strictEqual(igAltText('{"accessibility_caption":"Photo by Chef Joe."}'), '');
  assert.strictEqual(igVideoUrl('<html>nothing here</html>'), '');
  assert.strictEqual(igAuthor('<html>nothing here</html>'), '');
});

// Instagram publishes no subtitle track, so a Reel's recipe is only reachable through the video
// itself - which makes the shortcode -> media id -> /api/v1/media/{id}/info/ path the whole game.
// The reference encoder below is the inverse of the shipped decoder; round-tripping it is what
// proves the base-64 conversion, since we cannot call Instagram from a test.
const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const idToShortcode = (id) => {
  let n = BigInt(id), out = '';
  while (n > 0n) { out = IG_ALPHABET[Number(n % 64n)] + out; n /= 64n; }
  return out;
};

test('shortcodeToMediaId round-trips real-shaped Instagram ids', async () => {
  const { shortcodeToMediaId } = await load();
  ['2818195408236934073', '3391234567890123456', '1', '64', '4095'].forEach((id) => {
    assert.strictEqual(shortcodeToMediaId(idToShortcode(id)), id, 'id ' + id);
  });
  // the shapes that actually arrive off a share link
  assert.strictEqual(shortcodeToMediaId('CxYz123'), shortcodeToMediaId('CxYz123?igsh=abc'));
  assert.strictEqual(shortcodeToMediaId('CxYz123/'), shortcodeToMediaId('CxYz123'));
  assert.ok(/^\d+$/.test(shortcodeToMediaId('C8QltIvIQyc')));
});
test('shortcodeToMediaId refuses anything that is not a shortcode', async () => {
  const { shortcodeToMediaId } = await load();
  ['', 'has space', 'nope!', 'A'.repeat(40), 'A'].forEach(c => assert.strictEqual(shortcodeToMediaId(c), '', JSON.stringify(c)));
});
test('igFromApiJson reads the full caption, a playable MP4 and the creator', async () => {
  const { igFromApiJson } = await load();
  const out = igFromApiJson({ items: [{
    caption: { text: 'Creamy chicken pasta\n200g pasta\n150g chicken\nServes 2' },
    user: { username: 'chefjoe' },
    video_duration: 41.2,
    video_versions: [
      { width: 1920, url: 'https://cdn.example/master.mp4' },
      { width: 1080, url: 'https://cdn.example/hd.mp4' },
      { width: 480, url: 'https://cdn.example/sd.mp4' },
    ],
    image_versions2: { candidates: [{ url: 'https://cdn.example/cover.jpg' }] },
  }] });
  assert.ok(out.caption.includes('200g pasta'));
  assert.strictEqual(out.videoUrl, 'https://cdn.example/hd.mp4'); // biggest that is still sane to fetch
  assert.strictEqual(out.thumbnail, 'https://cdn.example/cover.jpg');
  assert.strictEqual(out.author, 'chefjoe');
  assert.strictEqual(out.seconds, 41.2);
});
test('igFromApiJson digs the video out of a carousel and survives a stripped response', async () => {
  const { igFromApiJson } = await load();
  const carousel = igFromApiJson({ items: [{
    caption: { text: 'three ways with oats' }, user: { username: 'chefjoe' },
    carousel_media: [
      { image_versions2: { candidates: [{ url: 'https://cdn.example/photo.jpg' }] } },
      { video_versions: [{ width: 720, url: 'https://cdn.example/clip.mp4' }] },
    ],
  }] });
  assert.strictEqual(carousel.videoUrl, 'https://cdn.example/clip.mp4');
  assert.strictEqual(carousel.caption, 'three ways with oats');
  // Instagram drops fields without warning; nothing here may throw
  assert.deepStrictEqual(igFromApiJson({}), { caption: '', videoUrl: '', thumbnail: '', author: '', seconds: 0 });
  assert.deepStrictEqual(igFromApiJson(null), { caption: '', videoUrl: '', thumbnail: '', author: '', seconds: 0 });
  assert.strictEqual(igFromApiJson({ items: [{ video_versions: [{ url: 'http://insecure/clip.mp4' }] }] }).videoUrl, '');
});

// ---- TikTok: the spoken recipe ---------------------------------------------------------------
const TT_VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
right so we're starting with

2
00:00:03.000 --> 00:00:05.000
right so we're starting with two hundred grams of chicken

3
00:00:05.000 --> 00:00:07.500
<c>then a heaped tablespoon of &amp; paprika</c>
`;

test('vttToText turns rolling auto-captions into one clean sentence', async () => {
  const { vttToText } = await load();
  const out = vttToText(TT_VTT);
  assert.strictEqual(out, "right so we're starting with two hundred grams of chicken then a heaped tablespoon of & paprika");
  assert.ok(!out.includes('-->'));
  assert.ok(!/WEBVTT/.test(out));
  assert.strictEqual(vttToText(''), '');
  assert.strictEqual(vttToText('WEBVTT\n\n'), '');
});
test('tiktokSubtitleUrls finds the auto-caption tracks and puts English first', async () => {
  const { tiktokSubtitleUrls } = await load();
  const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"video":{
    "playAddr":"https://v16-webapp.tiktok.com/video.mp4?a=1",
    "subtitleInfos":[
      {"LanguageCodeName":"es-ES","Url":"https://v16.tiktokcdn.com/es.webvtt","UrlList":["https://v16.tiktokcdn.com/es.webvtt"],"Format":"webvtt"},
      {"LanguageCodeName":"eng-US","Url":"https://v16.tiktokcdn.com/en.webvtt","UrlList":["https://v16.tiktokcdn.com/en.webvtt"],"Format":"webvtt"}
    ]}}</script>`;
  const subs = tiktokSubtitleUrls(html);
  assert.strictEqual(subs.length, 2);
  assert.strictEqual(subs[0].url, 'https://v16.tiktokcdn.com/en.webvtt'); // English first
  // the nested UrlList must not truncate the read (a lazy regex would stop at its "]")
  assert.ok(subs.some(s => s.url.includes('es.webvtt')));
});
test('tiktokSubtitleUrls still copes when the JSON arrives escaped', async () => {
  const { tiktokSubtitleUrls } = await load();
  const html = `<div data-x="{\\"subtitleInfos\\":[{\\"LanguageCodeName\\":\\"eng-US\\",\\"Url\\":\\"https:\\/\\/v16.tiktokcdn.com\\/en.webvtt?a=1\\"}]}">`;
  const subs = tiktokSubtitleUrls(html);
  assert.strictEqual(subs.length, 1);
  assert.strictEqual(subs[0].url, 'https://v16.tiktokcdn.com/en.webvtt?a=1');
});
test('tiktokSubtitleUrls returns nothing rather than guessing on a caption-less video', async () => {
  const { tiktokSubtitleUrls } = await load();
  assert.deepStrictEqual(tiktokSubtitleUrls('<html><body>no data</body></html>'), []);
  assert.deepStrictEqual(tiktokSubtitleUrls('{"subtitleInfos":[]}'), []);
});
test('tiktokVideoUrl reads the playable MP4, preferring playAddr', async () => {
  const { tiktokVideoUrl } = await load();
  assert.strictEqual(tiktokVideoUrl('{"playAddr":"https:\\u002F\\u002Fv16.tiktok.com\\u002Fa.mp4","downloadAddr":"https://v16.tiktok.com/b.mp4"}'), 'https://v16.tiktok.com/a.mp4');
  assert.strictEqual(tiktokVideoUrl('{"downloadAddr":"https://v16.tiktok.com/b.mp4"}'), 'https://v16.tiktok.com/b.mp4');
  assert.strictEqual(tiktokVideoUrl('{"playAddr":""}'), '');
});

// ---- YouTube: picking a caption track --------------------------------------------------------
test('pickCaptionTrack prefers a written English track over the auto one', async () => {
  const { pickCaptionTrack, ytCaptionTracks } = await load();
  const tracks = [
    { languageCode: 'en', kind: 'asr', baseUrl: 'asr-en' },
    { languageCode: 'es', baseUrl: 'human-es' },
    { languageCode: 'en', baseUrl: 'human-en' },
  ];
  assert.strictEqual(pickCaptionTrack(tracks).baseUrl, 'human-en');
  assert.strictEqual(pickCaptionTrack([tracks[0]]).baseUrl, 'asr-en');   // auto English beats nothing
  assert.strictEqual(pickCaptionTrack([tracks[1]]).baseUrl, 'human-es'); // a Spanish recipe beats nothing
  assert.strictEqual(pickCaptionTrack([]), null);
  // and the tracks are read out of the player response wherever it came from
  assert.strictEqual(ytCaptionTracks({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }).length, 3);
  assert.deepStrictEqual(ytCaptionTracks({}), []);
  assert.deepStrictEqual(ytCaptionTracks(null), []);
});

// ---- shared plumbing --------------------------------------------------------------------------
test('jsonAfter / jsonArrayAfter read a balanced value, not a lazy regex match', async () => {
  const { jsonAfter, jsonArrayAfter } = await load();
  const html = 'var ytInitialPlayerResponse = {"a":{"b":"}"},"c":[1,2]}; more junk }';
  assert.deepStrictEqual(jsonAfter(html, 'ytInitialPlayerResponse'), { a: { b: '}' }, c: [1, 2] });
  assert.strictEqual(jsonAfter(html, 'notThere'), null);
  assert.strictEqual(jsonAfter('marker = {broken', 'marker'), null);
  assert.deepStrictEqual(jsonArrayAfter('"list":[{"u":"]"},{"n":[1]}] rest', '"list"'), [{ u: ']' }, { n: [1] }]);
  assert.strictEqual(jsonArrayAfter('nope', 'x'), null);
});
test('decodeEntities and unescapeJson survive the escaping the platforms actually use', async () => {
  const { decodeEntities, unescapeJson, clip } = await load();
  assert.strictEqual(decodeEntities('a &amp; b &quot;c&quot; &#39;d&#39; &#x27;e&#x27;'), `a & b "c" 'd' 'e'`);
  assert.strictEqual(unescapeJson('200g\\npasta \\u0026 cream'), '200g\npasta & cream');
  assert.strictEqual(unescapeJson('unterminated " quote'), 'unterminated " quote'); // never throws
  assert.strictEqual(clip('abcdef', 3), 'abc');
  assert.strictEqual(clip('', 3), '');
});
