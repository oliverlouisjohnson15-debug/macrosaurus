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

// ---- rung 2b: the page that publishes nothing at all -----------------------------------------------
// The link that started all of this. Its HTML is 1.9 KB: an empty <div id="root"> and a Vite bundle,
// so every HTML-reading rung has nothing to work with and never will. It is built by Redbox Systems,
// a white-label platform behind a lot of UK regional ordering sites, and its menu comes from a
// same-origin GraphQL endpoint keyed by the outlet id already in the URL. The fixtures below are the
// real shapes, trimmed: the actual shell that came back, and the actual payload that answered.

const REDBOX_SHELL = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<meta name="client-version" content="v2" />
<meta name="author" content="Korelogic Limited - Redbox Systems - Online Ordering & Delivery Solutions Platform" />
<meta name="author-website" content="https://redbox.systems" />
<script type="module" crossorigin src="/assets/index.0887bb32.js"></script>
</head><body><div id="modal-root"></div><div id="root"></div></body></html>`;

const REDBOX_PAYLOAD = {
  data: {
    outlet: { name: 'Coast ', restaurant: { name: 'Coast' } },
    menuItemGroupsForOutlet: [
      { name: 'Starters', menuItems: [
        { name: 'BBQ Baby Back Ribs', description: 'Aioli', price: 800 },
        { name: 'Ramore  Nachos', description: 'Cheese, Sour Cream, Guacamole, Jalapenos.', price: 700 },
        { name: 'Garlic & Parmesan Bread', description: 'Garlic Mayo', price: 600 },
        { name: 'Salt & Chilli Prawns (for 2)', description: 'Prawn Crackers, Garlic Mayo, Chilli Oil.', price: 2000 },
      ] },
      { name: 'Pastas', menuItems: [
        { name: 'Chilli Beef Rigatoni', description: 'Tobacco Onions', price: 1800 },
        { name: 'Spaghetti Carbonara ', description: 'Comes with Garlic Bread', price: 1500 },
        { name: 'Side Salad', description: 'House dressing', price: 150 },
      ] },
    ],
  },
};

test('an empty SPA shell still gives up its outlet id when the platform is one we can ask', async () => {
  const { redboxOutletId, visibleText, looksLikeMenu, stateBlobs, dishesFromState } = await load();
  // Everything else genuinely has nothing: this is not a parser that could be made better.
  assert.strictEqual(looksLikeMenu(visibleText(REDBOX_SHELL)), false);
  assert.strictEqual(dishesFromState(stateBlobs(REDBOX_SHELL)).length, 0);
  assert.strictEqual(
    redboxOutletId(REDBOX_SHELL, '/takeaways/clrafoiq9963n0824lm3d17g1/coast/menu'),
    'clrafoiq9963n0824lm3d17g1'
  );
  // Without the platform's fingerprint it must not fire, however id-shaped the path looks: this is
  // the guard that stops one platform's query being aimed at somebody else's site.
  assert.strictEqual(redboxOutletId('<html><body>a normal site</body></html>', '/takeaways/clrafoiq9963n0824lm3d17g1/coast/menu'), '');
  // And with the fingerprint but no id in the path, there is nothing to ask about.
  assert.strictEqual(redboxOutletId(REDBOX_SHELL, '/about-us'), '');
});

test('the platform payload becomes a menu, with pence read as pence', async () => {
  const { dishesFromRedbox, placeFromRedbox, menuText } = await load();
  const dishes = dishesFromRedbox(REDBOX_PAYLOAD);
  assert.strictEqual(dishes.length, 7);
  assert.strictEqual(dishes[0].name, 'BBQ Baby Back Ribs');
  assert.strictEqual(dishes[0].section, 'Starters');
  assert.strictEqual(dishes[0].price, '£8.00');
  assert.strictEqual(dishes[4].section, 'Pastas');
  /* The unit is KNOWN here, so it is applied rather than guessed. The JSON walker's
     guess-by-magnitude would read this £1.50 side as £150, which is the sort of number that makes
     an app look broken at exactly the moment someone is trusting it. */
  assert.strictEqual(dishes.find((d) => d.name === 'Side Salad').price, '£1.50');
  assert.strictEqual(placeFromRedbox(REDBOX_PAYLOAD), 'Coast');
  const txt = menuText(dishes);
  assert.match(txt, /STARTERS[\s\S]*BBQ Baby Back Ribs {2}£8\.00/);
  assert.match(txt, /Prawn Crackers, Garlic Mayo, Chilli Oil/);
});

test('a platform reply that is an error, or empty, is not a menu', async () => {
  const { dishesFromRedbox, placeFromRedbox } = await load();
  // Their API answers 200 with an errors array when an instance is recycling; it must read as a miss.
  assert.deepStrictEqual(dishesFromRedbox({ errors: [{ message: 'unable to process' }], data: null }), []);
  assert.deepStrictEqual(dishesFromRedbox({}), []);
  assert.deepStrictEqual(dishesFromRedbox(null), []);
  assert.strictEqual(placeFromRedbox({ data: null }), '');
});

// ---- rung 2d: the menu is in the HTML, just not as data --------------------------------------------
// Shaped like the second real failure: a server-rendered ordering page (hungrrr) whose whole menu is
// ordinary markup with self-describing class names, wrapped - as ordering pages always are - in a
// <form>. It was reported as "not a menu" for two independent reasons, and both are asserted here.

const MARKUP_PAGE = `<!doctype html><html><head><title>Fyred Pizza</title></head><body>
<form id="orderForm" method="post">
  <div class="menuCategory" data-id="700215">
    <h2 class="categoryTitle"><span>Popular</span></h2>
    <div class="menuCategoryContent">
      <a href="#" class="orderMenuItem" data-id="2565249" data-price="8.5">
        <div class="orderMenuItemContent">
          <div class="orderMenuItemName"><strong>Margherita</strong></div>
          <div class="orderMenuItemDesc">Tomato base, Mozzarella, Basil</div>
          <div class="orderMenuItemPrice">&pound;8.50</div>
        </div>
      </a>
      <a href="#" class="orderMenuItem" data-id="2327113" data-price="12.5">
        <div class="orderMenuItemContent">
          <div class="orderMenuItemName"><strong>Sausage &amp; Onion</strong></div>
          <div class="orderMenuItemDesc">Tomato base, Mozzarella, Sausage, Red Onion, Basil, Parmesan, Chilli Honey</div>
          <div class="orderMenuItemPrice">&pound;12.50</div>
        </div>
      </a>
    </div>
  </div>
  <div class="menuCategory">
    <h2 class="categoryTitle"><span>Sides</span></h2>
    <div class="menuCategoryContent">
      <a href="#" class="orderMenuItem" data-price="4"><div class="orderMenuItemName"><strong>Garlic Bread</strong></div>
        <div class="orderMenuItemDesc">With mozzarella</div><div class="orderMenuItemPrice">&pound;4.00</div></a>
      <a href="#" class="orderMenuItem" data-price="3.5"><div class="orderMenuItemName"><strong>Dough Balls</strong></div>
        <div class="orderMenuItemDesc">Six, with garlic butter</div><div class="orderMenuItemPrice">&pound;3.50</div></a>
      <a href="#" class="orderMenuItem" data-price="2.5"><div class="orderMenuItemName"><strong>Skin On Fries</strong></div>
        <div class="orderMenuItemDesc">Regular portion</div><div class="orderMenuItemPrice">&pound;2.50</div></a>
    </div>
  </div>
</form></body></html>`;

test('a server-rendered markup menu is read, with its sections and prices', async () => {
  const { dishesFromMarkup, menuText } = await load();
  const dishes = dishesFromMarkup(MARKUP_PAGE);
  assert.strictEqual(dishes.length, 5);
  assert.strictEqual(dishes[0].name, 'Margherita');
  assert.strictEqual(dishes[0].section, 'Popular');
  assert.strictEqual(dishes[0].price, '£8.50');
  assert.strictEqual(dishes[1].description, 'Tomato base, Mozzarella, Sausage, Red Onion, Basil, Parmesan, Chilli Honey');
  assert.strictEqual(dishes[4].section, 'Sides');
  assert.match(menuText(dishes), /SIDES[\s\S]*Garlic Bread {2}£4\.00/);
});

test('stripping page furniture must never take the menu with it', async () => {
  const { visibleText } = await load();
  /* The real bug: <form>, <header> and <nav> were stripped whole, and an ordering page wraps its
     entire menu in a <form>. A 219 KB menu page came out as 6 KB with every dish gone, then
     reported itself as "not a menu" - a miss nothing downstream could see. Navigation left in is
     noise the model ignores; a deleted menu is unrecoverable. */
  const text = visibleText(MARKUP_PAGE);
  assert.match(text, /Margherita/);
  assert.match(text, /Sausage & Onion/);
  assert.match(text, /Skin On Fries/);
  // Scripts and styles are still removed, because those are never content.
  assert.doesNotMatch(visibleText('<html><body><form><script>var x="Ghost Dish"</script><p>Hi</p></form></body></html>'), /Ghost Dish/);
});

test('markup that is a navigation list is still not a menu', async () => {
  const { dishesFromMarkup } = await load();
  // Names with neither a price nor a description are links, headings or breadcrumbs.
  const nav = `<html><body><ul>
    <li><div class="product-title">Home</div></li>
    <li><div class="product-title">Our Story</div></li>
    <li><div class="product-title">Find Us</div></li></ul></body></html>`;
  assert.strictEqual(dishesFromMarkup(nav).length, 0);
});

// ---- rung 2c: asking an unknown platform, generically ----------------------------------------------

test('pickMenuQuery finds the menu query in a schema it has never seen', async () => {
  const { pickMenuQuery } = await load();
  // The real Redbox schema, trimmed to the candidates that actually compete.
  const schema = { data: { __schema: { queryType: { fields: [
    { name: 'ping', args: [] },
    { name: 'marketplace', args: [] },
    { name: 'menuItemTextSearch', args: [
      { name: 'outletId', type: { kind: 'NON_NULL', name: null } },
      { name: 'searchQuery', type: { kind: 'NON_NULL', name: null } } ] },
    { name: 'addOnMenuItems', args: [
      { name: 'outletId', type: { kind: 'NON_NULL', name: null } },
      { name: 'fulfilmentMethods', type: { kind: 'NON_NULL', name: null } } ] },
    { name: 'menuItemGroupsForOutlet', args: [
      { name: 'outletId', type: { kind: 'NON_NULL', name: null } },
      { name: 'narrowFulfilmentMethods', type: { kind: 'LIST', name: null } } ] },
  ] } } } };
  const pick = pickMenuQuery(schema);
  // Not the text search (needs a term we do not have), not the add-ons: the grouped outlet menu.
  assert.strictEqual(pick.field, 'menuItemGroupsForOutlet');
  assert.strictEqual(pick.idArg, 'outletId');
  // A schema with nothing menu-shaped must return nothing rather than a hopeful guess.
  assert.strictEqual(pickMenuQuery({ data: { __schema: { queryType: { fields: [{ name: 'user', args: [] }] } } } }), null);
  assert.strictEqual(pickMenuQuery({}), null);
});

test('buildMenuQuery asks only for fields the schema says exist', async () => {
  const { buildMenuQuery } = await load();
  // One unknown field rejects the whole GraphQL query, so this may never guess.
  const q = buildMenuQuery(
    { field: 'menuItemGroupsForOutlet', idArg: 'outletId', extraArgs: ['narrowFulfilmentMethods'] },
    ['id', 'name', 'description', 'price'], ['id', 'name', 'menuItems']);
  assert.match(q, /menuItemGroupsForOutlet\(outletId: \$id, narrowFulfilmentMethods: \[DELIVERY, COLLECTION\]\)/);
  assert.match(q, /menuItems \{ name description price \}/);
  assert.doesNotMatch(q, /title/);
  assert.strictEqual(buildMenuQuery({ field: 'x', idArg: 'id', extraArgs: [] }, [], []), '');
});

test('ids and API paths are read out of the page and its bundle', async () => {
  const { idsFromPath, apiPathsFromBundle, fillPath, bundleUrl } = await load();
  assert.deepStrictEqual(idsFromPath('/takeaways/clrafoiq9963n0824lm3d17g1/coast/menu'), ['clrafoiq9963n0824lm3d17g1']);
  assert.deepStrictEqual(idsFromPath('/restaurant/1043829/kebab-house'), ['1043829']);
  assert.deepStrictEqual(idsFromPath('/about/us'), []);
  const js = 'fetch("/api/outlets/:id/menu");fetch("/api/analytics/track");x="/v1/restaurant/${id}/products"';
  assert.deepStrictEqual(apiPathsFromBundle(js), ['/api/outlets/:id/menu', '/v1/restaurant/${id}/products']);
  assert.strictEqual(fillPath('/api/outlets/:id/menu', 'abc123'), '/api/outlets/abc123/menu');
  assert.strictEqual(fillPath('/api/outlets', 'abc123'), '/api/outlets/abc123');
  assert.strictEqual(
    bundleUrl('<script type="module" crossorigin src="/assets/index.0887bb32.js"></script>', 'https://x.co.uk/a/b'),
    'https://x.co.uk/assets/index.0887bb32.js');
});

test('menuPageLinks follows courses, and only on the same site', async () => {
  const { menuPageLinks } = await load();
  const html = `<html><body>
    <a href="/menu/starters">Starters</a>
    <a href="/menu/mains">Mains</a>
    <a href="/menu/puddings">Puddings</a>
    <a href="https://deliveroo.co.uk/x">Order on Deliveroo</a>
    <a href="/about">About us</a>
    <a href="/contact">Contact</a></body></html>`;
  const out = menuPageLinks(html, 'https://theanchor.pub/menu');
  assert.deepStrictEqual(out, [
    'https://theanchor.pub/menu/starters',
    'https://theanchor.pub/menu/mains',
    'https://theanchor.pub/menu/puddings',
  ]);
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
