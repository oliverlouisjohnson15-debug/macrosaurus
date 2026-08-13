'use strict';
// Tests for eating out (app/menu.js): the numbers behind reading a menu and ranking what is on it.
//
// What these are actually guarding is one thing: this feature makes a claim about the FUTURE, and
// the person acts on it. Everywhere else in the app a wrong number is a wrong diary entry they can
// correct later; here a wrong number is the wrong dinner. So the tests lean hard on the two ways
// that goes wrong quietly - a suggestion that says it fits when it does not, and a reply from the
// model whose totals do not match its own parts.
//
// Run with:  node --test
const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../app/menu.js');

const day = (rest, target) => ({ rest: rest, target: target });
const FULL_TARGET = { kcal: 2400, protein: 180, carbs: 240, fat: 80 };

test('remaining: what is genuinely left in the day', () => {
  const r = M.remaining(day({ kcal: 1400, protein: 110, carbs: 150, fat: 40 }, FULL_TARGET));
  assert.deepStrictEqual(
    { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, over: r.over },
    { kcal: 1000, protein: 70, carbs: 90, fat: 40, over: false }
  );
});

test('remaining: an overspent day has none left, not a negative amount', () => {
  const r = M.remaining(day({ kcal: 2700, protein: 200, carbs: 300, fat: 95 }, FULL_TARGET));
  // A negative budget handed to a model told to fit inside it produces nonsense, so it clamps.
  assert.strictEqual(r.kcal, 0);
  assert.strictEqual(r.protein, 0);
  assert.strictEqual(r.over, true);
  assert.strictEqual(r.overBy, 300);
});

test('remaining: no day context at all is null, never a made-up budget', () => {
  assert.strictEqual(M.remaining(null), null);
  assert.strictEqual(M.remaining({ rest: { kcal: 100 } }), null);
});

test('remaining: a pre-planned meal can be set aside so the ranking means something', () => {
  // Dinner is already logged at 900 kcal / 60 g protein, and they are stood in the restaurant
  // reconsidering it. Counting it would make every dish on the menu look like it busts the day.
  const d = day({ kcal: 1400, protein: 110, carbs: 150, fat: 40 }, FULL_TARGET);
  const withIt = M.remaining(d);
  const without = M.remaining(d, { kcal: 900, protein: 60, carbs: 80, fat: 20 });
  assert.strictEqual(withIt.kcal, 1000);
  assert.strictEqual(without.kcal, 1900);
  assert.strictEqual(without.protein, 130);
});

test('brief: the day is stated as numbers, and explicitly as context rather than a filter', () => {
  const b = M.brief({
    place: 'Dishoom', mealName: 'Dinner',
    remaining: M.remaining(day({ kcal: 1400, protein: 110, carbs: 150, fat: 40 }, FULL_TARGET)),
    menuText: 'House black daal 9.50'
  });
  assert.match(b, /Dishoom/);
  assert.match(b, /1000 kcal, 70 g protein/);
  assert.match(b, /House black daal/);
  // The one thing the model must not do with the budget is quietly drop everything above it.
  assert.match(b, /NOT a filter/);
  // No goal is sent any more: the ranking happens on the device, after the answer.
  assert.doesNotMatch(b, /RANK BY/);
});

test('brief: a menu fetched from their own page is said to be current', () => {
  // Without this the model hedges the menu it was handed against a half-remembered version of the
  // same restaurant, which shows up as prices belonging to no menu in particular.
  const b = M.brief({ place: 'Coast', menuText: 'Cod and Chips £10.50', menuFrom: 'causeway-eats.co.uk' });
  assert.match(b, /taken from their own page at causeway-eats\.co\.uk just now, so it is current/);
  assert.match(b, /Cod and Chips/);
  // A menu the person typed or photographed carries no such claim.
  assert.doesNotMatch(M.brief({ menuText: 'Cod and Chips £10.50' }), /taken from their own page/);
});

test('brief: an overspent day is stated without asking the model to refuse or lecture', () => {
  const b = M.brief({ remaining: M.remaining(day({ kcal: 2700 }, { kcal: 2400 })) });
  assert.match(b, /already about 300 kcal past/);
  assert.match(b, /do not lecture/);
  assert.doesNotMatch(b, /LEFT TODAY/);
});

test('brief: with no menu at all it says to work from the place, and to say so', () => {
  const b = M.brief({ place: 'Nando\'s' });
  assert.match(b, /NO MENU WAS PROVIDED/);
  // The dishes must announce that they came from the type of place rather than their menu.
  assert.match(b, /rather than their actual menu/);
});

test('brief: the user note overrides what to include', () => {
  const b = M.brief({ note: 'no dairy' });
  assert.match(b, /no dairy/);
  assert.match(b, /overrides everything else/);
});

// ---- the way in: nothing the model sends is trusted structurally -------------------------------

const SUGGESTION = {
  name: 'Chicken shish',
  why: 'Most protein for the calories.',
  confidence: 'high',
  kcal: 999, protein_g: 1, carbs_g: 1, fat_g: 1,   // deliberately wrong: the items are the truth
  items: [
    { name: 'chicken shish', grams: 220, kcal: 360, protein_g: 62, carbs_g: 0, fat_g: 12, fiber_g: 0, satfat_g: 3, sugars_g: 0, salt_g: 1.8 },
    { name: 'flatbread', grams: 90, kcal: 250, protein_g: 8, carbs_g: 48, fat_g: 2, fiber_g: 2.5, satfat_g: 0.4, sugars_g: 1, salt_g: 1.1 }
  ]
};

test('normalise: totals are recomputed from the items, never taken on trust', () => {
  const out = M.normalise({ dishes: [SUGGESTION] });
  const s = out.dishes[0];
  assert.strictEqual(s.kcal, 610);
  assert.strictEqual(s.protein_g, 70);
  assert.strictEqual(s.carbs_g, 48);
  assert.strictEqual(s.fat_g, 14);
  assert.strictEqual(s.salt_g, 2.9);
});

test('normalise: a suggestion with no calories is dropped, not shown as 0 kcal', () => {
  const out = M.normalise({ dishes: [{ name: 'Salad', kcal: 0 }, SUGGESTION] });
  assert.strictEqual(out.dishes.length, 1);
  assert.strictEqual(out.dishes[0].name, 'Chicken shish');
});

test('normalise: an unnamed suggestion is dropped', () => {
  const out = M.normalise({ dishes: [{ kcal: 500 }] });
  assert.strictEqual(out.dishes.length, 0);
});

test('normalise: the same dish twice under two spellings is one option', () => {
  const out = M.normalise({ dishes: [SUGGESTION, Object.assign({}, SUGGESTION, { name: 'Chicken Shish!' })] });
  assert.strictEqual(out.dishes.length, 1);
});

test('normalise: string macros from the model are coerced, not concatenated', () => {
  const out = M.normalise({ dishes: [{ name: 'Poke bowl', kcal: '540', protein_g: '38', carbs_g: '55', fat_g: '14' }] });
  const s = out.dishes[0];
  assert.strictEqual(s.kcal, 540);
  assert.strictEqual(s.protein_g, 38);
});

test('normalise: a range that does not contain the estimate is dropped rather than drawn', () => {
  const ok = M.normalise({ dishes: [{ name: 'A', kcal: 600, kcal_low: 500, kcal_high: 700 }] }).dishes[0];
  assert.strictEqual(ok.kcal_low, 500);
  const bad = M.normalise({ dishes: [{ name: 'B', kcal: 600, kcal_low: 700, kcal_high: 900 }] }).dishes[0];
  assert.strictEqual(bad.kcal_low, 0);
  assert.strictEqual(bad.kcal_high, 0);
});

test('normalise: caps the list and survives a junk reply', () => {
  const many = { dishes: Array.from({ length: 20 }, (_, n) => ({ name: 'Dish ' + n, kcal: 400 + n })) };
  assert.strictEqual(M.normalise(many).dishes.length, 10);
  assert.strictEqual(M.normalise(null).dishes.length, 0);
  assert.strictEqual(M.normalise({ suggestions: 'nope' }).dishes.length, 0);
});

// ---- the claim someone actually acts on --------------------------------------------------------

test('impact: fitting means fitting, and is only ever claimed when the day is known', () => {
  const rem = M.remaining(day({ kcal: 1400, protein: 110, carbs: 150, fat: 40 }, FULL_TARGET)); // 1000 left
  const s = M.normalise({ dishes: [SUGGESTION] }).dishes[0];                          // 610 kcal
  const im = M.impact(s, rem);
  assert.strictEqual(im.fits, true);
  assert.strictEqual(im.leftKcal, 390);
  assert.strictEqual(im.leftProtein, 0);   // 70 g left, 70 g in the dish
  // ...and that zero is the target being MET, which the screen must not read out as a shortfall.
  assert.strictEqual(im.proteinMet, true);
  // No day context: unknown is reported as unknown, never as a pass.
  assert.deepStrictEqual(M.impact(s, null), { known: false });
});

test('impact: falling short of the protein target is not reported as meeting it', () => {
  const rem = M.remaining(day({ kcal: 900, protein: 60 }, FULL_TARGET));   // 1500 kcal, 120 g protein left
  const s = M.normalise({ dishes: [SUGGESTION] }).dishes[0];     // 610 kcal, 70 g protein
  const im = M.impact(s, rem);
  assert.strictEqual(im.proteinMet, false);
  assert.strictEqual(im.leftProtein, 50);
});

test('impact: something too big says how far over, and does not claim to fit', () => {
  const rem = M.remaining(day({ kcal: 2100 }, { kcal: 2400, protein: 180, carbs: 240, fat: 80 })); // 300 left
  const s = M.normalise({ dishes: [SUGGESTION] }).dishes[0];                             // 610 kcal
  const im = M.impact(s, rem);
  assert.strictEqual(im.fits, false);
  assert.strictEqual(im.overBy, 310);
});

test('impact: on an already-overspent day nothing fits', () => {
  const rem = M.remaining(day({ kcal: 2700 }, { kcal: 2400 }));
  const s = M.normalise({ dishes: [{ name: 'Side salad', kcal: 90, protein_g: 2 }] }).dishes[0];
  assert.strictEqual(M.impact(s, rem).fits, false);
});

// ---- the hand-off to the existing confirm screen ------------------------------------------------

test('toEstimate: becomes exactly the shape a photo estimate produces', () => {
  const s = M.normalise({ dishes: [SUGGESTION] }).dishes[0];
  const est = M.toEstimate(s);
  assert.strictEqual(est.name, 'Chicken shish');
  assert.strictEqual(est.items.length, 2);
  assert.strictEqual(est.items[0].grams, 220);
  assert.strictEqual(est.items[0].user_specified, false);
  // The confirm screen sums the items itself, so the totals it will compute must match the ones here.
  const summed = est.items.reduce((a, it) => a + it.kcal, 0);
  assert.strictEqual(summed, est.kcal);
  // No follow-up question: there is no photo yet to sharpen, and the sheet must not ask one.
  assert.strictEqual(est.question, '');
  assert.deepStrictEqual(est.question_options, []);
});

test('toEstimate: the tweak survives as the assumption line the user reads', () => {
  const s = M.normalise({ dishes: [Object.assign({}, SUGGESTION, { description: 'Grilled skewers.', tweak: 'Ask for no rice.' })] }).dishes[0];
  assert.strictEqual(M.toEstimate(s).assumptions, 'Grilled skewers. Ask for no rice.');
});

test('lenses: only the day-dependent one is flagged, and an unknown id falls back', () => {
  assert.deepStrictEqual(M.LENSES.map(l => l.id), ['fit', 'protein', 'light']);
  assert.deepStrictEqual(M.LENSES.filter(l => l.needsDay).map(l => l.id), ['fit']);
  // A stale saved preference must not break the tab.
  assert.strictEqual(M.lens('nonsense').id, 'protein');
});

// ---- ranking, which happens here rather than in the model ---------------------------------------

const MENU = M.normalise({
  dishes: [
    { name: 'Big burger', kcal: 1250, protein_g: 55 },
    { name: 'Grilled chicken', kcal: 620, protein_g: 62 },
    { name: 'Side salad', kcal: 180, protein_g: 6 },
    { name: 'Steak', kcal: 900, protein_g: 70 }
  ]
}).dishes;
const names = list => list.map(d => d.name);

test('rank: nothing is ever removed for being too big, only ordered', () => {
  const rem = M.remaining(day({ kcal: 1700 }, { kcal: 2400, protein: 180, carbs: 240, fat: 80 })); // 700 left
  const fit = M.rank(MENU, 'fit', rem);
  // Everything is still there. Someone who wants the burger is entitled to see what it costs.
  assert.strictEqual(fit.length, 4);
  // Fitting first, best protein among them; then the misses, least overshoot first.
  assert.deepStrictEqual(names(fit), ['Grilled chicken', 'Side salad', 'Steak', 'Big burger']);
});

test('rank: the other two lenses ignore the day entirely', () => {
  const rem = M.remaining(day({ kcal: 1700 }, { kcal: 2400, protein: 180, carbs: 240, fat: 80 }));
  assert.deepStrictEqual(names(M.rank(MENU, 'protein', rem)), ['Steak', 'Grilled chicken', 'Big burger', 'Side salad']);
  assert.deepStrictEqual(names(M.rank(MENU, 'light', rem)), ['Side salad', 'Grilled chicken', 'Steak', 'Big burger']);
});

test('rank: with no day at all, fit degrades to best protein per calorie rather than lying', () => {
  const out = M.rank(MENU, 'fit', null);
  assert.strictEqual(out[0].name, 'Grilled chicken');   // 0.100 g/kcal, the best on the menu
  assert.strictEqual(out.length, 4);
});

test('rank: does not mutate the list it was given', () => {
  const before = names(MENU).join();
  M.rank(MENU, 'light', null);
  assert.strictEqual(names(MENU).join(), before);
});

// ---- where the numbers came from ----------------------------------------------------------------

test('published is only ever claimed when the model says so', () => {
  const pub = M.normalise({ dishes: [{ name: 'Peri chicken', kcal: 400, source: 'published' }] }).dishes[0];
  assert.strictEqual(pub.published, true);
  // Confidence is lifted with it: measured figures should not be hedged about on the confirm screen.
  assert.strictEqual(M.toEstimate(pub).confidence, 'high');
  // Silence, or anything else, reads as an estimate. Assuming "measured" from an absent field is
  // exactly the wrong direction to be wrong in.
  ['estimated', '', undefined, 'PUBLISHED', true].forEach(v => {
    assert.strictEqual(M.normalise({ dishes: [{ name: 'X', kcal: 400, source: v }] }).dishes[0].published, false);
  });
});

// ---- what a pasted link is worth -----------------------------------------------------------------
// Measured against real UK restaurant pages in August 2026: fetching the page behind a link returned
// a usable menu for NONE of sixteen tried. Chains render menus in JavaScript, aggregators 403
// anything that is not a browser, and independents are on the same platforms. So a link is read for
// the one thing it reliably carries, which needs no network call: WHICH restaurant.

test('placeFromUrl: a restaurant own-domain link gives the place', () => {
  assert.strictEqual(M.placeFromUrl('https://www.nandos.co.uk/food/menu'), 'nandos.co.uk');
  // A hostname with no word break cannot be split back into words, so it is handed over whole
  // rather than guessed at: a model reads it just as well and it does not look like a bug.
  assert.strictEqual(M.placeFromUrl('https://thequalitychophouse.com/restaurant-menus/'), 'thequalitychophouse.com');
  assert.strictEqual(M.placeFromUrl('https://franco-manca.co.uk/menus/'), 'Franco Manca');
});

test('placeFromUrl: a delivery link gives the restaurant, not the aggregator', () => {
  assert.strictEqual(M.placeFromUrl('https://deliveroo.co.uk/menu/london/soho/dishoom-carnaby'), 'Dishoom Carnaby');
  assert.strictEqual(M.placeFromUrl('https://www.just-eat.co.uk/restaurants-kricket-soho/menu'), 'Restaurants Kricket Soho');
});

test('placeFromUrl: a local ordering platform gives the restaurant, not the platform', () => {
  // The link that prompted this: a regional takeaway-ordering site nobody has an allowlist entry
  // for. Reading the domain gave "Causeway Eats", which cooks nothing, and the model was then sent
  // off to price the menu of a company that does not have one. The record id in the path is the
  // giveaway that this is a listing rather than a restaurant's own site.
  assert.strictEqual(
    M.placeFromUrl('https://www.causeway-eats.co.uk/takeaways/clrafoiq9963n0824lm3d17g1/coast/menu'),
    'Coast'
  );
  assert.strictEqual(M.placeFromUrl('https://order.foodhub.co.uk/restaurant/1043829/kebab-house'), 'Kebab House');
  assert.strictEqual(
    M.placeFromUrl('https://www.example-eats.com/store/3f1c8a2e-19b4-4c7d-9f2a-8b6e5d4c3a21/the-curry-house'),
    'The Curry House'
  );
});

test('placeFromUrl: an id on a restaurant own site does not turn the site furniture into the name', () => {
  // Only what sits AFTER the id counts. A date or an order number on a place's own site leaves
  // nothing after it, so the domain stays the answer rather than "Booking".
  assert.strictEqual(M.placeFromUrl('https://thequalitychophouse.com/booking/20260813'), 'thequalitychophouse.com');
  assert.strictEqual(M.placeFromUrl('https://franco-manca.co.uk/menus/'), 'Franco Manca');
});

test('placeFromUrl: maps and reviews links give the place', () => {
  assert.strictEqual(M.placeFromUrl('https://www.google.com/maps/place/Padella+Borough+Market/@51.5,-0.09,17z'), 'Padella Borough Market');
  assert.strictEqual(M.placeFromUrl('https://www.tripadvisor.co.uk/Restaurant_Review-g186338-d1234-Reviews-Kricket_Soho-London.html'), 'Kricket Soho');
});

test('placeFromUrl: a link that names no restaurant returns nothing, never a guess', () => {
  // An Instagram post is a photo id. Inventing a name from it would send the model off to price a
  // different restaurant's menu with total confidence, which is worse than asking.
  assert.strictEqual(M.placeFromUrl('https://www.instagram.com/p/Cabc123/'), '');
  assert.strictEqual(M.placeFromUrl('https://www.tiktok.com/@someone/video/12345'), '');
  assert.strictEqual(M.placeFromUrl('not a url'), '');
  assert.strictEqual(M.placeFromUrl(''), '');
  assert.strictEqual(M.placeFromUrl('javascript:alert(1)'), '');
});
