/*
 * build-calibration.mjs - regenerate tests/fixtures/calibration.json
 *
 * The calibration set is how we find out whether a change to AI_PROMPT actually helped. Before this
 * existed every prompt edit was unmeasured: we could not tell an improvement from a regression, and
 * could not have noticed the estimator drifting.
 *
 * TWO HALVES, and only one of them is here. A photo estimate is identification x portion, and the
 * published research is consistent that portion is where accuracy dies (20-40% error) while
 * identification is largely solved. These cases state the weight, so they measure the OTHER half:
 * given a known portion, does the estimator know what the food is made of? That is precisely the
 * half the fat checklist and the CoFID grounding are meant to move, so it is the half worth
 * measuring first, but do not read a good score here as a good score on a photograph.
 *
 * Portion cases need photographs and a set of scales, so they cannot be generated. Add them by hand
 * to the "portion" array with an image path and a weighed truth; tools/calibrate.mjs will pick them
 * up and report them separately.
 *
 * GROUND TRUTH comes from CoFID (McCance & Widdowson, OHID, Open Government Licence v3.0) - the same
 * table foods-uk.json is built from, so the truth is measured rather than recalled, and it is the
 * table the app itself treats as authoritative. Chain items come from published nutrition and are
 * marked with their provenance, because those are secondary sources and weaker evidence.
 *
 * Regenerate:  node tools/build-calibration.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const foods = JSON.parse(readFileSync('foods-uk.json', 'utf8')).foods;

// Find a CoFID row by an exact-ish name, so a table update that renames or removes a food fails
// loudly here rather than silently changing what we are calibrating against.
function cofid(nameStartsWith) {
  const lc = nameStartsWith.toLowerCase();
  const hit = foods.find(f => f[0].toLowerCase() === lc) || foods.find(f => f[0].toLowerCase().startsWith(lc));
  if (!hit) throw new Error('CoFID row not found: ' + nameStartsWith);
  return { name: hit[0], kcal: hit[1], protein: hit[2] || 0, carbs: hit[3] || 0, fat: hit[4] || 0, fiber: hit[5] || 0 };
}
const at = (n, g) => Math.round(n * g / 100 * 10) / 10;

/* Each case is a description a real person might type, paired with the weight it names. The
   description deliberately does NOT quote CoFID's own wording: matching the table's phrasing would
   test our string matching rather than the estimator's knowledge of food. */
const KNOWLEDGE = [
  ['chicken-breast',   '180 g grilled chicken breast, no skin',              'Chicken, breast, grilled without skin, meat only', 180],
  ['rice-boiled',      '220 g of boiled basmati rice',                       'Rice, white, basmati, boiled in unsalted water',   220],
  ['pasta-boiled',     '200 g of cooked spaghetti',                          'Pasta, white, spaghetti, dried, boiled in unsalted water', 200],
  ['baked-beans',      'a 200 g portion of baked beans in tomato sauce',     'Baked beans, canned in tomato sauce',              200],
  ['cheddar',          '40 g of mature cheddar',                             'Cheese, Cheddar, English',                          40],
  ['olive-oil',        '1 tbsp of olive oil (14 g)',                         'Oil, olive',                                        14],
  ['mackerel-grilled', '150 g grilled mackerel fillet',                      'Mackerel, flesh only, grilled',                    150],
  ['cod-grilled',      'a 140 g grilled cod fillet',                         'Cod, flesh only, grilled',                         140],
  ['egg-boiled',       '2 boiled eggs, about 100 g',                         'Eggs, chicken, whole, boiled',                     100],
  ['potato-boiled',    '250 g boiled potatoes',                              'Potatoes, old, boiled in unsalted water, flesh only', 250],
  ['broccoli',         '100 g of steamed broccoli',                          'Broccoli, green, steamed',                         100],
  ['wholemeal-bread',  '2 slices of wholemeal bread, 72 g',                  'Bread, wholemeal, average',                         72],
  ['banana',           'a banana, 120 g peeled',                             'Bananas, flesh only',                              120],
  ['peanut-butter',    '30 g of peanut butter',                              'Peanut butter, smooth',                             30],
  ['whole-milk',       '200 ml of whole milk',                               'Milk, whole, pasteurised, average',                200],
  ['greek-yoghurt',    '170 g of Greek yoghurt',                             'Yogurt, Greek style, plain',                       170],
];

const knowledge = KNOWLEDGE.map(([id, text, row, grams]) => {
  const f = cofid(row);
  return {
    id, text, grams,
    expect: { kcal: Math.round(f.kcal * grams / 100), protein: at(f.protein, grams), carbs: at(f.carbs, grams), fat: at(f.fat, grams), fiber: at(f.fiber, grams) },
    truth: 'CoFID: ' + f.name,
    confidence: 'measured'
  };
});

/* Chain items test the other thing AI_PROMPT claims to do: anchor to a chain's published nutrition.
   Weaker evidence than CoFID - these come from published figures via nutrition aggregators, not from
   a laboratory - so they are marked as such and given a wider tolerance by the runner. Re-check them
   against the chain's own allergen/nutrition PDF before trusting a regression here. */
const chain = [
  { id: 'bigmac', text: "a McDonald's Big Mac", grams: 219,
    expect: { kcal: 509, protein: 27, carbs: 41, fat: 25 },
    truth: "McDonald's UK published nutrition", confidence: 'published-secondary' },
  { id: 'greggs-sausage-roll', text: 'a Greggs sausage roll', grams: 106,
    expect: { kcal: 328, protein: 9.4, carbs: 23, fat: 21 },
    truth: 'Greggs published nutrition', confidence: 'published-secondary' },
];

const out = {
  note: 'Calibration set for the AI meal estimator. Generated by tools/build-calibration.mjs - do not hand-edit the knowledge cases. See that file for what this does and does not measure.',
  generated_from: 'foods-uk.json (CoFID 2021, OHID, OGL v3.0) + published chain nutrition',
  measures: 'Nutrition knowledge at a KNOWN weight. It does not measure portion estimation from a photograph, which the literature identifies as the dominant error source. Add photo cases to "portion" by hand.',
  targets: { kcal_mape: 0.2, note: 'Research models with depth data reach 13.5-15.3% MAPE on Nutrition5k. 20-25% is a realistic target for a single photo through a general vision model; these known-weight cases should beat it comfortably.' },
  knowledge, chain,
  portion: []
};

mkdirSync('tests/fixtures', { recursive: true });
writeFileSync('tests/fixtures/calibration.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote tests/fixtures/calibration.json:', knowledge.length, 'knowledge +', chain.length, 'chain cases');
