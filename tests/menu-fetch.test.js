'use strict';
// Tests for the page-parsing half of reading a menu behind a link:
// supabase/functions/menu-fetch/parse.ts.
//
// Two things are being guarded here, and they are not the same thing.
//
// The first is the obvious one: that a real ordering platform's page yields its dishes. The fixtures
// below are shaped like the pages that actually work - a Next.js listing with its menu in
// __NEXT_DATA__, a restaurant publishing schema.org markup, a React flight-streamed page - trimmed
// hard but with the structure intact, so that a platform reorganising its payload shows up here
// rather than in a restaurant.
//
// The second matters more. This feature's worst outcome is not failing to read a menu: it is
// CLAIMING to have read one. A page of navigation links accepted as a menu becomes six confidently
// priced dishes that nobody serves, handed to someone deciding what to eat, with the app's full
// authority behind them. So a good half of what follows is the opposite of a success case - SPA
// shells, cookie banners, a specials box, a page with four prices on it - all asserting that nothing
// comes back. A miss falls through to the camera, which always works. A false positive does not get
// caught by anything downstream.
//
// The module is TypeScript because it ships to the Deno edge runtime; node strips the types for us.
// Run with:  npm test
const { test } = require('node:test');
const assert = require('node:assert');

const load = () => import('../supabase/functions/menu-fetch/parse.ts');

// ---- prices --------------------------------------------------------------------------------------
test('priceText reads the shapes platforms actually store money in', async () => {
  const { priceText } = await load();
  // Ordering platforms overwhelmingly store minor units. A bare 850 is £8.50, not £850.
  assert.strictEqual(priceText(850), '£8.50');
  assert.strictEqual(priceText(1250), '£12.50');
  assert.strictEqual(priceText(9.5), '£9.50');
  assert.strictEqual(priceText(8), '£8.00');
  assert.strictEqual(priceText('£12.95'), '£12.95');
  assert.strictEqual(priceText('12,95'), '£12.95');
  assert.strictEqual(priceText({ amount: 795, currency: 'GBP' }), '£7.95');
  assert.strictEqual(priceText(0), '');
  assert.strictEqual(priceText(null), '');
  assert.strictEqual(priceText('free'), '');
});

// ---- what counts as a dish -------------------------------------------------------------------------
test('isDishName keeps food and drops the furniture around it', async () => {
  const { isDishName } = await load();
  assert.ok(isDishName('Chicken Shawarma Wrap'));
  assert.ok(isDishName('Coast Signature Burger'));
  // A menu is full of invented names, so no vocabulary test can be applied: anything that reads like
  // a name has to pass.
  assert.ok(isDishName('The Big Yin'));
  assert.strictEqual(isDishName('Basket'), false);
  assert.strictEqual(isDishName('Sign in'), false);
  assert.strictEqual(isDishName('Opening hours'), false);
  assert.strictEqual(isDishName('/takeaways/coast/menu'), false);
  assert.strictEqual(isDishName('clrafoiq9963n0824lm3d17g1'), false);
  assert.strictEqual(isDishName('£8.50'), false);
  assert.strictEqual(isDishName(''), false);
  assert.strictEqual(isDishName(null), false);
});

// ---- rung 1: schema.org --------------------------------------------------------------------------
const JSON_LD_PAGE = `<!doctype html><html><head>
<title>The Harbour Grill | Menu</title>
<meta property="og:title" content="The Harbour Grill - Menu">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Restaurant",
"name":"The Harbour Grill","servesCuisine":"Seafood",
"hasMenu":{"@type":"Menu","hasMenuSection":[
 {"@type":"MenuSection","name":"Starters","hasMenuItem":[
   {"@type":"MenuItem","name":"Cullen Skink","description":"Smoked haddock, potato and leek chowder","offers":{"@type":"Offer","price":"7.50","priceCurrency":"GBP"}},
   {"@type":"MenuItem","name":"Salt and Chilli Squid","description":"With lime aioli","offers":{"price":"8.95"}}]},
 {"@type":"MenuSection","name":"Mains","hasMenuItem":[
   {"@type":"MenuItem","name":"Beer Battered Haddock","description":"Hand cut chips, mushy peas, tartare","offers":{"price":"16.50"}},
   {"@type":"MenuItem","name":"Harbour Fish Pie","description":"Salmon, haddock, prawns, mash, cheddar crust","offers":{"price":"17.95"}},
   {"@type":"MenuItem","name":"8oz Sirloin","description":"Peppercorn sauce, chips, rocket","offers":{"price":"26.00"}},
   {"@type":"MenuItem","name":"Wild Mushroom Risotto","description":"Parmesan, truffle oil","offers":{"price":"15.00"}}]}]}}</script>
</head><body><div id="app"></div></body></html>`;

test('a restaurant that publishes schema.org markup gives up its whole menu', async () => {
  const { jsonLdBlocks, dishesFromJsonLd, placeFromJsonLd, menuText } = await load();
  const blocks = jsonLdBlocks(JSON_LD_PAGE);
  const dishes = dishesFromJsonLd(blocks);
  assert.strictEqual(placeFromJsonLd(blocks), 'The Harbour Grill');
  assert.strictEqual(dishes.length, 6);
  // The section has to survive: the model needs it to tell a starter from a main, which is what
  // lets it return "one complete thing to order" rather than a dish and a half.
  assert.strictEqual(dishes[0].section, 'Starters');
  assert.strictEqual(dishes[2].section, 'Mains');
  assert.strictEqual(dishes[2].name, 'Beer Battered Haddock');
  assert.strictEqual(dishes[2].price, '£16.50');
  const txt = menuText(dishes);
  assert.match(txt, /STARTERS/);
  assert.match(txt, /Beer Battered Haddock {2}£16\.50/);
  // The small print under a dish name is where the cheese and the aioli live, so it has to travel.
  assert.match(txt, /mushy peas, tartare/);
});

// ---- rung 2: a Next.js ordering platform ------------------------------------------------------------
// Shaped like the page that prompted all of this: a regional takeaway platform, restaurant in the
// path behind a record id, and the whole menu server-rendered into __NEXT_DATA__ for SEO. Note that
// nothing here is labelled "menu item" - the walker has to recognise a dish by what it has.
const NEXT_PAGE = `<!doctype html><html><head><title>Coast | Causeway Eats</title>
<meta property="og:site_name" content="Causeway Eats">
<meta property="og:title" content="Coast - Order Online">
</head><body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"takeaway":{
"id":"clrafoiq9963n0824lm3d17g1","name":"Coast","cuisine":"Fish and Chips",
"categories":[
 {"categoryName":"Fish","items":[
  {"id":"a1","name":"Cod and Chips","description":"Fresh cod in our own batter with chips","price":1050},
  {"id":"a2","name":"Scampi and Chips","description":"Wholetail scampi, chips","price":990},
  {"id":"a3","name":"Fish Supper Special","description":"Cod, chips, mushy peas and a can","price":1350}]},
 {"categoryName":"Burgers","items":[
  {"id":"b1","name":"Quarter Pounder Meal","description":"Quarter pounder with cheese, chips and a can","price":890},
  {"id":"b2","name":"Chicken Fillet Burger","description":"Breaded chicken fillet, lettuce, mayo","price":650}]},
 {"categoryName":"Sides","items":[
  {"id":"c1","name":"Chips","description":"Regular portion","price":320},
  {"id":"c2","name":"Curry Sauce","description":"Pot of curry sauce","price":150}]}]}}},
"page":"/takeaways/[id]/[slug]/menu","buildId":"x1"}</script></body></html>`;

test('a Next.js ordering platform gives up its menu out of __NEXT_DATA__', async () => {
  const { stateBlobs, dishesFromState, menuText, placeFromMeta } = await load();
  const dishes = dishesFromState(stateBlobs(NEXT_PAGE));
  const names = dishes.map((d) => d.name);
  assert.ok(names.includes('Cod and Chips'), 'expected the fish, got ' + JSON.stringify(names));
  assert.ok(names.includes('Chicken Fillet Burger'));
  assert.ok(names.includes('Curry Sauce'));
  assert.strictEqual(dishes.length, 7);
  // Pence, read as pence.
  assert.strictEqual(dishes.find((d) => d.name === 'Cod and Chips').price, '£10.50');
  // The category name is nowhere near the item in the JSON; it has to be carried down the walk.
  assert.strictEqual(dishes.find((d) => d.name === 'Chips').section, 'Sides');
  assert.match(menuText(dishes), /FISH[\s\S]*Cod and Chips/);
  // og:title is the restaurant on a listing page; og:site_name is the platform. Only the first is
  // ever the answer, and the difference is why "Causeway Eats" was being shown as a restaurant.
  const meta = placeFromMeta(NEXT_PAGE);
  assert.strictEqual(meta.title, 'Coast');
  assert.strictEqual(meta.site, 'Causeway Eats');
});

test('flight-streamed React pages are read too', async () => {
  const { stateBlobs, dishesFromState } = await load();
  // Next's newer app router ships the payload as escaped chunks pushed into self.__next_f.
  const inner = JSON.stringify({
    restaurant: { name: 'Bombay House' },
    sections: [{ sectionName: 'Curries', items: [
      { name: 'Chicken Tikka Masala', description: 'Creamy tomato sauce, basmati rice', price: 1195 },
      { name: 'Lamb Rogan Josh', description: 'Slow cooked lamb, aromatic sauce', price: 1295 },
      { name: 'Saag Paneer', description: 'Spinach and Indian cheese', price: 995 },
      { name: 'Vegetable Balti', description: 'Mixed vegetables, balti sauce', price: 950 },
      { name: 'King Prawn Bhuna', description: 'Dry spiced king prawns', price: 1395 },
    ] }],
  });
  const page = '<html><body><script>self.__next_f.push([1,' + JSON.stringify('2:' + inner) + '])</script></body></html>';
  const dishes = dishesFromState(stateBlobs(page));
  assert.strictEqual(dishes.length, 5);
  assert.strictEqual(dishes[0].name, 'Chicken Tikka Masala');
  assert.strictEqual(dishes[0].section, 'Curries');
  assert.strictEqual(dishes[4].price, '£13.95');
});

test('the same dish listed three times over comes back once', async () => {
  const { dedupeDishes } = await load();
  // Platforms list a dish in its section, again in "popular", again in the search index.
  const out = dedupeDishes([
    { section: 'Fish', name: 'Cod and Chips', description: 'x', price: '£10.50' },
    { section: 'Popular', name: 'cod and chips', description: 'x', price: '£10.50' },
    { section: 'Fish', name: 'Cod & Chips', description: 'x', price: '£10.50' },
    { section: 'Sides', name: 'Chips', description: 'y', price: '£3.20' },
  ]);
  assert.deepStrictEqual(out.map((d) => d.name), ['Cod and Chips', 'Chips']);
});

// ---- the half that matters more: refusing to claim a menu ---------------------------------------

test('an SPA shell that renders its menu in JavaScript yields nothing', async () => {
  const { stateBlobs, dishesFromState, visibleText, looksLikeMenu } = await load();
  // This is the chain case app/menu.js measured and was right about: navigation, and no menu.
  const shell = `<!doctype html><html><head><title>Nando's UK</title></head><body>
    <nav><a href="/menu">Menu</a><a href="/order">Order</a><a href="/locations">Restaurants</a>
    <a href="/account">Sign in</a><a href="/basket">Basket</a></nav>
    <div id="root"></div>
    <div>Delivery from £3.50. Minimum order £12.00.</div>
    <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer></body></html>`;
  assert.strictEqual(dishesFromState(stateBlobs(shell)).length, 0);
  assert.strictEqual(looksLikeMenu(visibleText(shell)), false);
});

test('a specials box is not a menu, however many prices are in it', async () => {
  const { visibleText, looksLikeMenu } = await load();
  // Four prices on a marketing page. Accepting this would produce a six-dish "menu" from a fragment,
  // with the missing two invented to fill it out.
  const page = `<html><body><h1>Welcome to The Anchor</h1>
    <p>Sunday roast £14.95. Kids eat free. Two courses £19.95, three courses £24.95.</p>
    <p>Quiz night Thursdays, entry £2.00.</p></body></html>`;
  assert.strictEqual(looksLikeMenu(visibleText(page)), false);
});

test('a real text menu on a plain HTML page is read', async () => {
  const { visibleText, looksLikeMenu } = await load();
  const page = `<html><body><h2>Sandwiches</h2><ul>
    <li>Ham and mustard £4.50</li><li>Cheese and pickle £4.20</li><li>Tuna mayonnaise £4.80</li>
    <li>Chicken and stuffing £5.20</li><li>Egg and cress £3.90</li><li>BLT £5.50</li>
    <li>Coronation chicken £5.00</li></ul></body></html>`;
  const text = visibleText(page);
  assert.ok(looksLikeMenu(text));
  assert.match(text, /Coronation chicken £5\.00/);
  // Scripts and styles must not survive into what the model is told is the menu.
  assert.doesNotMatch(visibleText('<html><body><script>var x="Fake Dish £9.99"</script><p>Hi</p></body></html>'), /Fake Dish/);
});

test('a cookie banner and a nav bar cannot become dishes', async () => {
  const { dishesFromState, stateBlobs } = await load();
  const page = `<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{
    "nav":{"items":[{"name":"Home","href":"/"},{"name":"Menu","href":"/menu"},{"name":"Basket","href":"/basket"}]},
    "consent":{"items":[{"name":"Accept all","description":"We use cookies to improve your experience"}]}}}}</script></body></html>`;
  const dishes = dishesFromState(stateBlobs(page));
  // "Accept all" carries a description, so it clears the name+description bar - and is stopped by
  // nothing except the furniture list. This test is here because that is exactly how a false
  // positive gets in.
  assert.deepStrictEqual(dishes.map((d) => d.name), ['Accept all']);
  // ...which is why the caller requires MIN_DISHES before it believes any of this.
  assert.ok(dishes.length < 5);
});

// ---- PDFs ------------------------------------------------------------------------------------------
test('pdfMenuLinks finds the menu PDF and ignores the rest', async () => {
  const { pdfMenuLinks } = await load();
  const page = `<html><body>
    <a href="/docs/allergens.pdf">Allergen information</a>
    <a href="/menus/dinner-menu.pdf">Our dinner menu</a>
    <a href="https://cdn.example.com/wine.pdf">Wine list</a>
    <a href="/terms.pdf">Terms and conditions</a></body></html>`;
  const out = pdfMenuLinks(page, 'https://theanchor.co.uk/food');
  assert.deepStrictEqual(out, ['https://theanchor.co.uk/menus/dinner-menu.pdf']);
});

// ---- not being an open proxy -----------------------------------------------------------------------
test('isBlockedHost refuses everything that is not a public website', async () => {
  const { isBlockedHost } = await load();
  for (const h of [
    'localhost', '127.0.0.1', '0.0.0.0', '10.0.0.5', '172.16.4.1', '172.31.255.254', '192.168.1.1',
    '169.254.169.254', // the cloud metadata endpoint, which is the reason SSRF is worth attempting
    '100.64.0.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
    'db', 'kong', 'supabase_auth', 'printer.local', 'wiki.internal', '', '10.0.0.256',
  ]) {
    assert.strictEqual(isBlockedHost(h), true, h + ' should be blocked');
  }
  for (const h of ['causeway-eats.co.uk', 'www.nandos.co.uk', 'theanchor.pub', '8.8.8.8', '172.32.0.1', '192.169.0.1']) {
    assert.strictEqual(isBlockedHost(h), false, h + ' should be allowed');
  }
});

test('menuText stays inside the cap a giant menu would blow', async () => {
  const { menuText, MAX_MENU_TEXT } = await load();
  const many = Array.from({ length: 900 }, (_, i) => ({
    section: 'Section ' + (i % 12), name: 'Dish number ' + i,
    description: 'A long description that exists only to make this menu enormous, repeated often.',
    price: '£9.99',
  }));
  assert.ok(menuText(many).length <= MAX_MENU_TEXT);
});
