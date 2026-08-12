'use strict';
// Tests for the page-reading half of menu import: supabase/functions/menu-fetch/parse.ts.
//
// Two separate things are being guarded here, and they fail in opposite directions.
//
// The FIRST is the safety of an endpoint that fetches whatever URL somebody pastes. Everything else
// this backend fetches is one of three named platforms; this is the one that takes an arbitrary
// host, so the address rules below are the only thing standing between a signed-in user and using
// our server to knock on doors inside a private network. They fail CLOSED: anything not obviously a
// public web address is refused.
//
// The SECOND is looksLikeMenu, which decides whether the app is allowed to say it read a menu. That
// one fails OPEN in the safe direction: when it says no, the app falls back to "I have not seen this
// menu" and asks for a photo, which is exactly where it was before this existed. So the tests that
// matter most are the NEGATIVE ones - a JavaScript shell, a cookie wall, a homepage - because a
// false positive there is the app confidently pricing dishes off a page that has no menu on it.
//
// The module is TypeScript because it ships to the Deno edge runtime; node strips the types for us.
// Run with:  npm test   (the script passes --experimental-strip-types)
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/menu-fetch/parse.ts');

// ---- the address rules -------------------------------------------------------------------------

test('safeUrl refuses everything that is not a plain public web address', async () => {
  const { safeUrl } = await load();
  const no = (u) => assert.ok(safeUrl(u).reason, u + ' should have been refused');
  // The prize behind every SSRF: cloud metadata, and the loopback interface.
  no('http://169.254.169.254/latest/meta-data/');
  no('http://metadata.google.internal/computeMetadata/v1/');
  no('http://127.0.0.1:8000/');
  no('http://localhost/admin');
  no('https://[::1]/');
  no('http://[::ffff:127.0.0.1]/');       // IPv4 wearing an IPv6 hat
  no('http://10.0.0.5/');
  no('http://192.168.1.1/');
  no('http://172.20.3.4/');               // the middle of 172.16/12, which is easy to get wrong
  no('http://100.100.0.1/');              // carrier-grade NAT
  no('http://supabase.internal/');
  no('http://intranet/');                 // a bare name is an intranet name
  // Not addresses at all.
  no('file:///etc/passwd');
  no('gopher://evil.test/');
  no('javascript:alert(1)');
  no('not a url');
  // Shapes that smuggle a different destination past a careless parser.
  no('http://user:pass@evil.test/');
  no('http://example.com:8080/');
  no('http://example.com:22/');
});

test('safeUrl allows an ordinary restaurant link', async () => {
  const { safeUrl } = await load();
  const ok = (u) => { const r = safeUrl(u); assert.ok(r.url, u + ' should have been allowed: ' + r.reason); return r.url; };
  assert.strictEqual(ok('https://amiciportstewart.co.uk/a-la-carte/').hostname, 'amiciportstewart.co.uk');
  ok('http://www.thelocalpub.co.uk/menus/food.pdf');
  ok('https://example.com:443/menu');
});

test('the 172.16/12 boundary is the whole boundary, not a rounded version of it', async () => {
  const { privateIPv4 } = await load();
  assert.strictEqual(privateIPv4('172.15.255.255'), false);
  assert.strictEqual(privateIPv4('172.16.0.0'), true);
  assert.strictEqual(privateIPv4('172.31.255.255'), true);
  assert.strictEqual(privateIPv4('172.32.0.0'), false);
  // Anything we cannot parse as four ordinary octets is refused rather than waved through.
  assert.strictEqual(privateIPv4('999.1.1.1'), true);
  assert.strictEqual(privateIPv4('1.2.3'), true);
});

// ---- the proof that a menu was actually read -----------------------------------------------------

const MENU_PAGE = `<!doctype html><html><head><title>A La Carte | Amici Port Stewart</title>
<meta property="og:site_name" content="Amici Port Stewart" /></head><body>
<nav><a href="/">Home</a><a href="/a-la-carte/">A La Carte</a><a href="/contact/">Contact</a></nav>
<div class="cookie">We use cookies. <a href="/privacy/">Privacy</a></div>
<h2>Antipasti</h2>
<ul>
<li><h3>Bruschetta Classica</h3><p>Toasted sourdough, vine tomatoes, basil</p><span>£7.50</span></li>
<li><h3>Calamari Fritti</h3><p>Lightly floured squid, garlic aioli</p><span>£9.00</span></li>
<li><h3>Arancini</h3><p>Saffron risotto balls, mozzarella centre</p><span>£8.00</span></li>
</ul>
<h2>Secondi</h2>
<ul>
<li><h3>Pollo Milanese</h3><p>Breaded chicken breast, spaghetti pomodoro</p><span>£18.50</span></li>
<li><h3>Salmone alla Griglia</h3><p>Grilled fillet, seasonal greens</p><span>£21.00</span></li>
<li><h3>Ribeye</h3><p>10oz, hand cut chips, peppercorn sauce</p><span>£28.00</span></li>
</ul>
<footer><a href="/terms/">Terms</a></footer>
<script>window.dataLayer=[{"price":"9.99"}];</script></body></html>`;

test('htmlToText keeps the dishes and drops the furniture', async () => {
  const { htmlToText } = await load();
  const t = htmlToText(MENU_PAGE);
  assert.match(t, /Bruschetta Classica/);
  assert.match(t, /Toasted sourdough, vine tomatoes, basil/);
  assert.match(t, /£18\.50/);
  // Navigation, cookie furniture and the analytics blob are not the menu.
  assert.doesNotMatch(t, /dataLayer/);
  assert.doesNotMatch(t, /Home/);
  assert.doesNotMatch(t, /Terms/);
  // A dish and its price must not be welded into one word by tag removal.
  assert.doesNotMatch(t, /Arancini£/);
});

test('looksLikeMenu says yes to a real card', async () => {
  const { htmlToText, looksLikeMenu } = await load();
  assert.strictEqual(looksLikeMenu(htmlToText(MENU_PAGE)), true);
});

/* The negative cases. Each of these is a page the fetcher WILL be handed, and saying yes to any of
   them is the failure this whole feature was built to avoid: dishes priced to the calorie off a
   page that never had a menu on it. */

test('looksLikeMenu says no to a JavaScript shell', async () => {
  const { htmlToText, looksLikeMenu } = await load();
  const shell = `<!doctype html><html><head><title>Nando's</title></head><body>
    <div id="root"></div><script src="/static/js/main.8f3a.js"></script></body></html>`;
  assert.strictEqual(looksLikeMenu(htmlToText(shell)), false);
});

test('looksLikeMenu says no to a cookie wall or a block page', async () => {
  const { htmlToText, looksLikeMenu } = await load();
  const wall = `<html><body><h1>Before you continue</h1><p>We and our partners use cookies to
    personalise content and ads, to provide social media features and to analyse our traffic. You can
    change your choices at any time by visiting your preferences. Read our cookie policy and our
    privacy policy for the full detail of how this works and who we share information with.</p>
    <button>Accept all</button><button>Reject all</button></body></html>`;
  assert.strictEqual(looksLikeMenu(htmlToText(wall)), false);
  const blocked = `<html><body><h1>403 Forbidden</h1><p>Access denied.</p></body></html>`;
  assert.strictEqual(looksLikeMenu(htmlToText(blocked)), false);
});

test('looksLikeMenu says no to a homepage that merely mentions its menu', async () => {
  const { htmlToText, looksLikeMenu } = await load();
  const home = `<html><body><h1>Amici</h1><p>Authentic Italian dining on the north coast, open
    seven days. Book a table, or view our menus. Two courses from £19.95 on weekday lunch.</p>
    <a href="/a-la-carte/">A La Carte</a><a href="/wine/">Wine list</a></body></html>`;
  assert.strictEqual(looksLikeMenu(htmlToText(home)), false);
});

test('looksLikeMenu accepts a card that prints no prices at all', async () => {
  const { looksLikeMenu } = await load();
  const noPrices = 'STARTERS\n' + [
    'Soup of the day with soda bread', 'Chicken liver parfait, red onion marmalade',
    'Crab and sweetcorn croquettes', 'Beetroot and goats cheese salad',
    'Salt and chilli squid with lime mayonnaise', 'Black pudding bonbons, apple puree',
  ].join('\n') + '\nMAINS\n' + [
    'Roast rump of lamb, dauphinoise potato, seasonal vegetables',
    'Pan fried seabass, crushed new potatoes, samphire',
    'Grilled chicken supreme, wild mushroom sauce, buttered greens',
    '10oz sirloin, hand cut chips, roast tomato, garlic butter',
    'Slow braised beef cheek, horseradish mash', 'Wild mushroom and truffle risotto',
    'Beer battered haddock, chips, crushed peas',
  ].join('\n');
  assert.strictEqual(looksLikeMenu(noPrices), true);
});

// ---- JSON-LD: the exact route --------------------------------------------------------------------

test('menuFromJsonLd reads a menu nested inside a Restaurant, and prices it', async () => {
  const { jsonLdBlocks, menuFromJsonLd, looksLikeMenu } = await load();
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Amici',
    hasMenu: {
      '@type': 'Menu',
      hasMenuSection: [{
        '@type': 'MenuSection', name: 'Secondi',
        hasMenuItem: [
          { '@type': 'MenuItem', name: 'Pollo Milanese', description: 'Breaded chicken breast', offers: { '@type': 'Offer', price: '18.50' } },
          { '@type': 'MenuItem', name: 'Salmone alla Griglia', offers: { price: '21.00' } },
          { '@type': 'MenuItem', name: 'Ribeye', description: '10oz, hand cut chips', offers: [{ price: '28.00' }] },
          { '@type': 'MenuItem', name: 'Lasagne al Forno', offers: { price: '16.00' } },
          { '@type': 'MenuItem', name: 'Risotto ai Funghi', offers: { price: '15.50' } },
          { '@type': 'MenuItem', name: 'Melanzane Parmigiana', offers: { price: '15.00' } },
        ],
      }],
    },
  })}</script></head><body></body></html>`;
  const text = menuFromJsonLd(jsonLdBlocks(html));
  assert.match(text, /SECONDI/);
  assert.match(text, /- Pollo Milanese: Breaded chicken breast \(£18\.50\)/);
  assert.match(text, /- Ribeye/);
  assert.strictEqual(looksLikeMenu(text), true);
});

test('menuFromJsonLd ignores a page whose only structured data is the business itself', async () => {
  const { jsonLdBlocks, menuFromJsonLd } = await load();
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'LocalBusiness', name: 'Amici', address: { '@type': 'PostalAddress', addressLocality: 'Portstewart' },
  })}</script>`;
  assert.strictEqual(menuFromJsonLd(jsonLdBlocks(html)), '');
});

test('jsonLdBlocks survives one broken block without losing the others', async () => {
  const { jsonLdBlocks } = await load();
  const html = '<script type="application/ld+json">{ oops, not json }</script>'
    + '<script type="application/ld+json">{"@type":"Menu","name":"Food"}</script>';
  const blocks = jsonLdBlocks(html);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].name, 'Food');
});

// ---- following the site's own links --------------------------------------------------------------

test('pdfLinks finds the food menu and ranks it above the wine list', async () => {
  const { pdfLinks } = await load();
  const html = `<a href="/wp-content/uploads/2026/01/wine-list.pdf">Wine List</a>
    <a href="/wp-content/uploads/2026/01/a-la-carte-menu.pdf">A La Carte Menu</a>
    <a href="/privacy-policy.pdf">Privacy Policy</a>
    <a href="/christmas-party-booking.pdf">Party booking form</a>`;
  const out = pdfLinks(html, 'https://amiciportstewart.co.uk/');
  assert.strictEqual(out[0], 'https://amiciportstewart.co.uk/wp-content/uploads/2026/01/a-la-carte-menu.pdf');
  assert.ok(!out.some((u) => /privacy|booking/.test(u)), 'paperwork is not a menu');
});

test('menuPageLinks stays on the site and skips the page it is already on', async () => {
  const { menuPageLinks } = await load();
  const html = `<a href="/a-la-carte/">A La Carte</a>
    <a href="/menus/lunch/">Lunch menu</a>
    <a href="https://www.opentable.co.uk/amici">Book a table</a>
    <a href="https://instagram.com/amici">Follow us</a>
    <a href="/">Home</a>
    <a href="/contact/">Contact</a>`;
  const out = menuPageLinks(html, 'https://amiciportstewart.co.uk/a-la-carte/');
  assert.ok(out.every((u) => u.indexOf('https://amiciportstewart.co.uk/') === 0), 'must not walk off the site: ' + out.join(','));
  assert.ok(!out.some((u) => /a-la-carte/.test(u)), 'the page we are already reading is not a lead');
  assert.ok(out.some((u) => /lunch/.test(u)));
  assert.ok(!out.some((u) => /contact/.test(u)));
});

test('placeFromHtml prefers what the site calls itself over the page title', async () => {
  const { placeFromHtml } = await load();
  assert.strictEqual(placeFromHtml(MENU_PAGE), 'Amici Port Stewart');
  // No og:site_name, so the last piece of the title is the site rather than the page.
  assert.strictEqual(placeFromHtml('<title>A La Carte | The Harbour Bar</title>'), 'The Harbour Bar');
  assert.strictEqual(placeFromHtml('<title>Amici</title>'), 'Amici');
  assert.strictEqual(placeFromHtml('<html><body>no title</body></html>'), '');
});
