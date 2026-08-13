/*
 * menu.js - Eating out: reading a menu and ranking what is on it. Framework-free, no DOM and no
 * network. Exposes window.MenuIdeas + Node module.exports. Tested in tests/menu.test.js.
 *
 * Why this is its own module rather than more of app.jsx: everything here is a decision about
 * NUMBERS - what is actually left in the day, which dish wins under which lens, whether a reply from
 * the model is usable - and every one of those can be wrong in a way a screenshot will not show you.
 * The React side is left with layout and taps.
 *
 * THE SHAPE OF THE INTERACTION, and why it changed. The first version asked four questions before it
 * would do anything: where you are, how the menu is arriving, which of four goals you want, and
 * whether you have any notes. That is a form standing between someone and the one thing they came
 * for, and it is asked at the worst possible moment, which is while a waiter is stood there. The
 * apps that do this well ask for the menu and nothing else, then RANK what came back and let you
 * flip the ranking afterwards. So the model is now asked for a SPREAD of the best dishes on the menu
 * in one call, and the lens (fits my day / most protein / lightest) is applied HERE, in plain
 * arithmetic, instantly and for free. Changing your mind about what you want costs a tap rather than
 * another call, and the question never has to be asked up front at all.
 *
 * The other rule this file exists to hold: a dish that does not fit is still an answer. Someone
 * eating out may well want the thing that blows the budget, and an app that quietly filters it out
 * is lying by omission at the exact moment it was asked a real question. Nothing here removes a dish
 * for being too big. It says what it would cost and leaves the choice where it belongs.
 */
(function (root) {
  'use strict';

  // The three ways of reading the same list of dishes. Applied client-side, after the reply, so
  // switching between them is instant and free.
  var LENSES = [
    { id: 'fit', label: 'Fits', needsDay: true },
    { id: 'protein', label: 'Protein', needsDay: false },
    { id: 'light', label: 'Lightest', needsDay: false }
  ];
  function lens(id) {
    for (var i = 0; i < LENSES.length; i++) if (LENSES[i].id === id) return LENSES[i];
    return LENSES[1];
  }

  var MACROS = ['kcal', 'protein', 'carbs', 'fat'];

  function num(v) { var n = +v; return isFinite(n) ? n : 0; }

  /* ---- what a pasted link is actually worth ---------------------------------------------------
     Sending a link is the way people want to do this, so it was worth finding out what a link can
     honestly give us. The first answer, measured against real UK restaurant pages in August 2026,
     was: not the menu. Every chain site tested (Nando's, Wagamama, Pret, Greggs) serves an empty
     shell and renders its menu in JavaScript, so the HTML carries navigation and nothing else;
     Nando's ships 2.5 MB of it. The delivery aggregators and several restaurant groups return 403
     to anything that is not a browser. Sixteen URLs, no menu.

     That still holds for all sixteen, and the menu-fetch edge function does not try to beat either
     case. What the sample missed is that all sixteen were the same two kinds of page, and the page
     people actually paste is a third: a listing on a REGIONAL ORDERING PLATFORM, which every town
     has and which almost every independent is on. Those are Next.js and Nuxt apps that
     server-render for search engines, so the entire menu - sections, dishes, descriptions, prices -
     is sitting in the HTML as JSON, needing no browser and no rendering service. A good number of
     independents with their own site publish schema.org menu markup, or link a PDF that is real
     text. So the menu IS often behind the link, and supabase/functions/menu-fetch reads it.

     This function stays where it was, and stays worth having, for the times it is not: a chain, an
     aggregator, a page that was unreadable, a phone with no signal, or the moment before the fetch
     comes back. WHICH RESTAURANT is sat in the URL in plain text, it needs no network call at all,
     and for a chain it unlocks the published nutrition - which beats anything we would have parsed
     off their web page anyway. The page's own declared name wins where we have it (the client
     prefers menu-fetch's `place`); this is the floor, not the ceiling. And the camera remains the
     one route that works everywhere, and the only one that reads the specials board. */
  var AGG_HOSTS = /^(deliveroo|just-?eat|ubereats|uber|opentable|thefork|resy|sevenrooms|yelp|quandoo|bookatable)\./i;
  var MAP_HOSTS = /^(google|maps\.google|bing|tripadvisor|yell)\./i;
  var SOCIAL_HOSTS = /^(instagram|facebook|tiktok|twitter|x|threads|youtube|youtu)\./i;
  var SKIP_SEG = /^(menu|menus|food|order|ordering|place|restaurant|restaurants|takeaway|takeaways|store|stores|shop|listing|listings|delivery|collection|uk|gb|en|en gb|london|home|index|maps|dir|search|p|reel)$/i;
  var TLD = /\.(co\.uk|org\.uk|com|co|uk|net|london|restaurant|cafe|kitchen|bar|pub|eu|io)$/i;

  /* A path segment that is a database id rather than a word: a cuid/uuid, or a bare number. It is
     never part of a name, and - this is the useful half - a restaurant's OWN site has no reason to
     carry one, so seeing one is how we know a link belongs to a platform listing many restaurants
     even when its hostname is not one we have heard of. */
  var ID_SEG = /^(\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{12,})$/i;

  /* The restaurant, read out of the path of a listing page. Ids, numbers and the platform's own
     furniture ("takeaways", "menu") are dropped, and what is left last is the place: these URLs read
     as <what it is>/<id>/<who it is>/<what you are looking at>. */
  function nameFromPath(segs) {
    var cand = segs.filter(function (s) { return !ID_SEG.test(s); })
      .map(words)
      .filter(function (s) { return s.length > 2 && !SKIP_SEG.test(s); });
    return cand.length ? titleCase(cand[cand.length - 1]) : '';
  }

  function words(s) {
    try { s = decodeURIComponent(s); } catch (e) { /* leave it as it came */ }
    return s.replace(/\+/g, ' ').replace(/[-_]+/g, ' ').replace(/\.(html?|php|aspx)$/i, '').replace(/\s+/g, ' ').trim();
  }
  function titleCase(s) {
    return s.replace(/\S+/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
  }

  /* The restaurant's name, read out of a URL. Returns '' when the link genuinely does not name a
     place (an Instagram post is a photo id and nothing more), because a wrong name is worse than no
     name: it would send the model off to price the wrong restaurant's menu with total confidence. */
  function placeFromUrl(raw) {
    var u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return ''; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    var host = u.hostname.replace(/^www\./i, '').toLowerCase();
    var segs = u.pathname.split('/').filter(Boolean);

    // A social post names nothing. Say so by returning nothing.
    if (SOCIAL_HOSTS.test(host)) return '';

    if (MAP_HOSTS.test(host)) {
      // Google Maps puts it after /place/; TripAdvisor buries it in one long slug.
      var pi = segs.indexOf('place');
      if (pi !== -1 && segs[pi + 1]) return titleCase(words(segs[pi + 1]));
      for (var i = 0; i < segs.length; i++) {
        if (!/^Restaurant_Review/i.test(segs[i])) continue;
        var parts = segs[i].replace(/\.html?$/i, '').split('-');
        var ri = parts.indexOf('Reviews');
        // ...-Reviews-<Name>-<City>.html, so the name is what sits between the two.
        if (ri !== -1 && parts.length > ri + 1) return titleCase(words(parts.slice(ri + 1, parts.length - 1).join('-') || parts[ri + 1]));
      }
      return '';
    }

    // A delivery link's last meaningful path segment is the restaurant.
    if (AGG_HOSTS.test(host)) return nameFromPath(segs);

    /* A platform we have never heard of, giving itself away with a record id in the path. There are
       hundreds of these - every town has a local ordering site, and the white-label platforms behind
       them turn one codebase into a new hostname per region - so an allowlist of hostnames was never
       going to hold. Reading the domain here is the worst possible answer: it names the PLATFORM, so
       the model is sent off to price a menu at a company that does not cook anything, confidently
       and with the name shown back to the user as if it had understood. The restaurant is sat in the
       path immediately AFTER the id: these read as <what it is>/<id>/<who it is>/<what you are
       looking at>. Only what follows the id counts, so that a date or an order number on a
       restaurant's own site ("/booking/20260813") cannot promote some piece of that site's furniture
       into the name of the place - with nothing after the id this is not a listing, and the domain
       is still the best answer available. */
    for (var s = 0; s < segs.length; s++) {
      if (!ID_SEG.test(segs[s])) continue;
      var listed = nameFromPath(segs.slice(s + 1));
      if (listed) return listed;
      break;
    }

    // The restaurant's own site: the domain IS the name. A hostname with no separators cannot be
    // split back into words reliably ("thequalitychophouse"), and a bad guess reads as a bug, so
    // anything that does not already contain a break is handed over as the domain itself. A model
    // recognises "thequalitychophouse.com" exactly as well.
    var stem = host.replace(TLD, '');
    var spaced = words(stem.replace(/\./g, ' '));
    return spaced.indexOf(' ') === -1 ? host : titleCase(spaced);
  }

  /* What is genuinely left in the day. Clamped at zero on purpose: a person already 300 kcal over
     does not have "-300 kcal left", they have none, and handing a negative number to a model told to
     fit inside it produces nonsense. The overshoot is kept separately so the screen can say plainly
     that today is already full rather than quietly suggesting a salad.

     `ignore` is the pre-planned meal. Logging tomorrow's dinner today is a habit this app already
     supports, and the moment you open a menu with a placeholder sat in the diary, every dish looks
     like it busts the day, because the day has already been spent on the thing you are currently
     reconsidering. Excluding it is what makes the ranking mean anything. */
  function remaining(day, ignore) {
    if (!day || !day.rest || !day.target) return null;
    var out = { over: false };
    var back = ignore || {};
    for (var i = 0; i < MACROS.length; i++) {
      var k = MACROS[i];
      var used = num(day.rest[k]) - num(back[k]);
      var left = num(day.target[k]) - used;
      out[k] = Math.max(0, Math.round(left));
      if (k === 'kcal' && left < 0) { out.over = true; out.overBy = Math.round(-left); }
    }
    return out;
  }

  /* The whole ask, as one block of plain text. Written as facts rather than a conversation: the
     model is reading a menu, not being chatted to. There is no goal in here any more, deliberately.
     It is asked for a SPREAD covering every lens at once, which is what lets the ranking happen on
     the device afterwards, and it is told in as many words to include the indulgent option, because
     a list of nothing but sensible choices is not a menu anybody recognises. */
  function brief(opts) {
    opts = opts || {};
    var rem = opts.remaining;
    var lines = [];
    if (opts.place) lines.push('WHERE: ' + String(opts.place).trim() + '.');
    if (opts.mealName) lines.push('WHICH MEAL: this will be logged as ' + String(opts.mealName).trim() + '.');
    if (rem) {
      lines.push(rem.over
        ? ('TODAY SO FAR: they are already about ' + rem.overBy + ' kcal past their target for today, so there is nothing left in the budget. Do not refuse to answer and do not lecture them: rank as usual and let them see what each option costs.')
        : ('LEFT TODAY: ' + rem.kcal + ' kcal, ' + rem.protein + ' g protein, ' + rem.carbs + ' g carbs, ' + rem.fat + ' g fat. This is context for choosing which dishes are worth showing, NOT a filter: include dishes that do not fit as well as ones that do.'));
    }
    if (opts.note && String(opts.note).trim()) {
      lines.push('THEIR OWN NOTE, which overrides everything else about what to include: "' + String(opts.note).trim() + '".');
    }
    if (opts.menuText && String(opts.menuText).trim()) {
      // Where the text came from is worth one clause. A menu read off the restaurant's own listing
      // is their current menu, and saying so stops the model hedging it against a half-remembered
      // version of the same place - which it will do, and which shows up as prices that belong to
      // no menu in particular.
      lines.push('THE MENU, as text' + (opts.menuFrom ? ', taken from their own page at ' + String(opts.menuFrom).trim() + ' just now, so it is current' : '') + ':\n' + String(opts.menuText).trim());
    }
    if (opts.hasImages) lines.push('The menu is attached as image(s) and/or a PDF. Read every dish you can see on it.');
    if (!opts.menuText && !opts.hasImages) {
      lines.push('NO MENU WAS PROVIDED. Work from what you know of this place: if it is a UK chain, use its real published menu and nutrition. If you do not know it, say so in "note" and suggest what a place of that kind reliably serves, making clear in each "why" that you are going on the type of restaurant rather than their actual menu.');
    }
    return lines.join('\n\n');
  }

  /* Everything below is the way IN. The model is a good reader of menus and an unreliable filler-in
     of JSON, so nothing it sends is trusted structurally: totals are recomputed from the items when
     the items are there, macros that came back as strings are coerced, and any dish left without a
     name or without calories is dropped rather than rendered as a blank row. */

  function cleanItem(raw) {
    if (!raw) return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    return {
      name: name,
      grams: Math.max(0, Math.round(num(raw.grams))),
      kcal: Math.max(0, Math.round(num(raw.kcal))),
      protein_g: Math.max(0, num(raw.protein_g)),
      carbs_g: Math.max(0, num(raw.carbs_g)),
      fat_g: Math.max(0, num(raw.fat_g)),
      fiber_g: Math.max(0, num(raw.fiber_g)),
      satfat_g: Math.max(0, num(raw.satfat_g)),
      sugars_g: Math.max(0, num(raw.sugars_g)),
      salt_g: Math.max(0, num(raw.salt_g)),
      assumption: String(raw.assumption || '').trim()
    };
  }

  // Sum the parts. Used whenever a dish arrived with a breakdown, because the confirm screen the
  // user lands on sums the items too: a total that disagreed with its own parts would visibly change
  // the moment they opened it.
  function totalOf(items) {
    var t = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, satfat_g: 0, sugars_g: 0, salt_g: 0 };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      t.kcal += it.kcal; t.protein_g += it.protein_g; t.carbs_g += it.carbs_g; t.fat_g += it.fat_g;
      t.fiber_g += it.fiber_g; t.satfat_g += it.satfat_g; t.sugars_g += it.sugars_g; t.salt_g += it.salt_g;
    }
    t.kcal = Math.round(t.kcal);
    var keys = ['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'satfat_g', 'sugars_g'];
    for (var k = 0; k < keys.length; k++) t[keys[k]] = Math.round(t[keys[k]] * 10) / 10;
    t.salt_g = Math.round(t.salt_g * 100) / 100;
    return t;
  }

  var CONF = { low: 1, medium: 1, high: 1 };

  function cleanDish(raw) {
    if (!raw) return null;
    var name = String(raw.name || '').trim();
    if (!name) return null;
    var items = [];
    var rawItems = Array.isArray(raw.items) ? raw.items : [];
    for (var i = 0; i < rawItems.length; i++) { var it = cleanItem(rawItems[i]); if (it) items.push(it); }
    var t = items.length
      ? totalOf(items)
      : {
        kcal: Math.round(num(raw.kcal)), protein_g: num(raw.protein_g), carbs_g: num(raw.carbs_g),
        fat_g: num(raw.fat_g), fiber_g: num(raw.fiber_g), satfat_g: num(raw.satfat_g),
        sugars_g: num(raw.sugars_g), salt_g: num(raw.salt_g)
      };
    // No calories means no dish. A row reading "0 kcal" is not a lighter option, it is a failed read,
    // and it must not be offered as something to log.
    if (!(t.kcal > 0)) return null;
    var low = Math.round(num(raw.kcal_low)), high = Math.round(num(raw.kcal_high));
    // A range that does not contain the estimate is not a range. Drop it rather than draw it.
    if (!(low > 0 && high > low && low <= t.kcal && high >= t.kcal)) { low = 0; high = 0; }
    return {
      name: name,
      description: String(raw.description || '').trim(),
      why: String(raw.why || '').trim(),
      tweak: String(raw.tweak || '').trim(),
      // Where the numbers came from, which is the single most useful thing we can tell someone about
      // an estimate. A chain that publishes its nutrition has been measured; everything else has been
      // reasoned about from a menu description, and those two deserve different amounts of trust.
      // Only the model's explicit claim counts: anything else reads as an estimate, because assuming
      // "published" from silence is exactly the wrong direction to be wrong in.
      published: raw.source === 'published',
      confidence: CONF[raw.confidence] ? raw.confidence : 'medium',
      kcal: t.kcal,
      protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, fiber_g: t.fiber_g,
      satfat_g: t.satfat_g, sugars_g: t.sugars_g, salt_g: t.salt_g,
      kcal_low: low, kcal_high: high,
      items: items
    };
  }

  /* The reply, made safe. Deduplicated by name because a model asked to read a short menu will
     sometimes return the same dish twice under two spellings, and two identical rows read as a bug
     in the app rather than a thin menu. */
  function normalise(raw, limit) {
    raw = raw || {};
    var cap = limit || 10;
    var list = Array.isArray(raw.dishes) ? raw.dishes : (Array.isArray(raw.suggestions) ? raw.suggestions : []);
    var out = [], seen = {};
    for (var i = 0; i < list.length && out.length < cap; i++) {
      var s = cleanDish(list[i]);
      if (!s) continue;
      var k = s.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(s);
    }
    return {
      place: String(raw.place || '').trim(),
      menuRead: raw.menu_read === true,
      note: String(raw.note || '').trim(),
      dishes: out
    };
  }

  /* ---- the whole menu, for when none of the six are what you fancy -----------------------------
     The ranked shortlist answers "what should I have?", which is the question most people arrive
     with. It is the wrong tool for "what IS there?" - and that is the question you ask when none of
     the six appeal, or when you already know you want a burger, or when you are deciding between a
     starter and a pudding rather than between six mains. Six dishes off a forty-dish menu, with the
     other thirty-four invisible, is a shortlist presented as if it were the menu.

     So the fetched menu is parsed back into its sections and shown underneath. This costs nothing:
     menu-fetch already sent the text in a shape we defined, so this is reading our own format rather
     than parsing the web again, and it needs no second call, no second wait and no AI at all.

     Prices are kept as the string the restaurant printed. They are not macros and we do nothing
     arithmetic with them - but "£6.50" next to a dish is how a person recognises the thing they were
     about to order, and dropping it would make our menu look less like their menu. */
  function parseMenuText(text) {
    var lines = String(text || '').split('\n');
    var out = [], cur = null, last = null;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw || !raw.trim()) continue;
      // A description is indented under the dish it belongs to; anything else is a dish or a heading.
      if (/^\s{4,}\S/.test(raw) && last) { last.description = (last.description ? last.description + ' ' : '') + raw.trim(); continue; }
      var line = raw.trim();
      var item = line.match(/^-\s+(.*)$/);
      if (!item) {
        // A heading. Title-cased for display: the text carries them upper-case so the model can see
        // the structure, and SHOUTING AT SOMEONE reading a menu is a different thing entirely.
        if (line.length > 60) continue;
        cur = { name: titleCase(line.toLowerCase()), items: [] };
        out.push(cur);
        last = null;
        continue;
      }
      var body = item[1];
      var price = '';
      var pm = body.match(/\s{2,}(£[\d.,]+)\s*$/);
      if (pm) { price = pm[1]; body = body.slice(0, pm.index).trim(); }
      if (!body) continue;
      if (!cur) { cur = { name: '', items: [] }; out.push(cur); }
      last = { name: body, description: '', price: price };
      cur.items.push(last);
    }
    return out.filter(function (s) { return s.items.length; });
  }

  // How many dishes are actually on offer, for the one line that tells someone the shortlist is not
  // the whole story.
  function countItems(sections) {
    var n = 0;
    for (var i = 0; i < (sections || []).length; i++) n += (sections[i].items || []).length;
    return n;
  }

  /* Ranking, on the device. Nothing is ever REMOVED here, only ordered: a dish that busts the day is
     still on the menu, and someone who wants it is entitled to see what it costs rather than have
     the app decide on their behalf that they did not mean it. */
  function rank(dishes, lensId, rem) {
    var list = (dishes || []).slice();
    var id = lens(lensId).id;
    // Without a day to measure against, "fits" has nothing to mean, so it degrades to the closest
    // honest thing: the best protein for the calories.
    if (id === 'fit' && !rem) id = 'value';
    list.sort(function (a, b) {
      if (id === 'protein') return (b.protein_g - a.protein_g) || (a.kcal - b.kcal);
      if (id === 'light') return (a.kcal - b.kcal) || (b.protein_g - a.protein_g);
      if (id === 'value') return (b.protein_g / b.kcal) - (a.protein_g / a.kcal);
      // Fit: everything that lands inside the remaining calories first, best protein among those,
      // then everything that does not, least overshoot first. Sorting the misses by overshoot rather
      // than dropping them is what keeps "I know, and I want it anyway" a first-class answer.
      var af = a.kcal <= rem.kcal, bf = b.kcal <= rem.kcal;
      if (af !== bf) return af ? -1 : 1;
      if (af) return (b.protein_g - a.protein_g) || (a.kcal - b.kcal);
      return a.kcal - b.kcal;
    });
    return list;
  }

  /* What a dish would do to the rest of the day, in the terms the day itself is kept in. `fits` is
     only ever claimed when we HAVE the day's numbers: an unknown is reported as unknown rather than
     as a pass, because this is the line someone will act on without reading twice. */
  function impact(dish, rem) {
    if (!dish) return null;
    if (!rem) return { known: false };
    var after = {
      kcal: rem.kcal - dish.kcal,
      protein: Math.round((rem.protein - num(dish.protein_g)) * 10) / 10
    };
    return {
      known: true,
      fits: !rem.over && after.kcal >= 0,
      overBy: after.kcal < 0 ? Math.round(-after.kcal) : 0,
      leftKcal: Math.max(0, Math.round(after.kcal)),
      leftProtein: Math.max(0, Math.round(after.protein)),
      // A dish that covers the whole remaining protein target leaves "0 g protein", which is the
      // arithmetic and the opposite of the meaning: it is the best outcome available, and reading it
      // as a shortfall would talk someone out of exactly the dish they came here for.
      proteinMet: rem.protein > 0 && after.protein <= 0
    };
  }

  /* Hand-off to the estimate confirm screen. A chosen dish becomes exactly the shape a photo
     estimate produces, so the review, the portion control, the item editing, the UK food-tables
     check and the logging path are the ones that already exist rather than a second set built for
     this feature. The follow-up question is deliberately blanked: the estimator asks one to sharpen
     a photo it could not read, and there is no photo here yet - the sharpening happens later, when
     the food turns up and the entry is updated from a picture of it. */
  function toEstimate(dish) {
    if (!dish) return null;
    var note = dish.tweak
      ? (dish.description ? dish.description + ' ' + dish.tweak : dish.tweak)
      : dish.description;
    return {
      name: dish.name,
      items: dish.items.map(function (it) {
        return {
          name: it.name, grams: it.grams, kcal: it.kcal,
          protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, fiber_g: it.fiber_g,
          satfat_g: it.satfat_g, sugars_g: it.sugars_g, salt_g: it.salt_g,
          user_specified: false, assumption: it.assumption
        };
      }),
      kcal: dish.kcal,
      protein_g: dish.protein_g, carbs_g: dish.carbs_g, fat_g: dish.fat_g,
      fiber_g: dish.fiber_g, satfat_g: dish.satfat_g, sugars_g: dish.sugars_g, salt_g: dish.salt_g,
      kcal_low: dish.kcal_low, kcal_high: dish.kcal_high,
      // Published chain figures are measured, so the confirm screen should not hedge about them.
      confidence: dish.published ? 'high' : dish.confidence,
      assumptions: note || '',
      question: '', question_options: []
    };
  }

  var MenuIdeas = {
    LENSES: LENSES, lens: lens, remaining: remaining, brief: brief, placeFromUrl: placeFromUrl,
    normalise: normalise, rank: rank, impact: impact, toEstimate: toEstimate, totalOf: totalOf,
    parseMenuText: parseMenuText, countItems: countItems
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MenuIdeas;
  root.MenuIdeas = MenuIdeas;
})(typeof window !== 'undefined' ? window : this);
