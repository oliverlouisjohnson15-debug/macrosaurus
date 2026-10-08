"""Screens: Today, logging (+), Food (diary and Cook). Demo-account content (`?demo`, Thu 8 Oct)."""
from kit import *

SCREENS = []
def screen(id, group, title, note=''):
    def deco(fn):
        SCREENS.append(dict(id=id, group=group, title=title, note=note, fn=fn)); return fn
    return deco

def root(tab, body, ctx=DATE, walker='dino', foot=''):
    return appbar_root(ctx, walker) + f'<main class="page">{body}</main>' + foot + tabbar(tab)

def sub(title, body, back='Back', act=None, act_icon=None, foot=None):
    f = f'<div class="foot">{foot}</div>' if foot else ''
    return appbar_sub(title, back, act, act_icon) + f'<main class="page sub{" has-foot" if foot else ""}">{body}</main>' + f

# ============================================================== TODAY
def today_hero(left=1101, eaten=1135, target=2236, p=(55, 58), c=(107, 58), f=(48, 31), primary=True):
    pct = round(eaten / target * 100)
    return hero(
        f'<button style="display:block;width:100%" aria-label="Open today in detail">'
        f'<div class="split"><div><span class="bignum">{left}</span> <span class="unit">kcal left</span></div>'
        f'{ic("chevron", "chev")}</div>'
        f'<div class="sm muted" style="margin:6px 0 10px">{eaten:,} eaten of {target:,}</div>'
        f'{hp(pct, "cal", 20, "", f"{pct}% of today eaten")}'
        f'<div class="macros" style="margin-top:16px">{macro("pro", "Protein", p[0], "g", p[1])}{macro("carb", "Carbs", c[0], "g", c[1])}{macro("fat", "Fat", f[0], "g", f[1])}</div>'
        '</button>', 'data-primary' if primary else '')

def today_rows():
    return section('Today', row('Training', 'Lower B · Friday', 'train', '<span class="sm">Tomorrow</span>')
                   + row('Weight', 'Trend 83.0 kg · down 0.8 kg a week', 'scale')
                   + row('Recovery', 'Slept 7 h 12 · ready 82', 'moon'))

def today_body(prompt=None):
    return (today_hero() + '<div class="sp8"></div>'
            + (prompt or dialogue('Morning! How often will you weigh in? Either works, so pick what you’ll stick to.',
                                  ['Most mornings', 'Once a week'], mood='peckish'))
            + today_rows())

@screen('today', 'Today', 'Today', 'Hero = kcal left. One buddy dialogue holds the day’s one prompt. Three rows.')
def _(): return root('today', today_body())

@screen('today-checkin', 'Today', 'Today · check-in due', 'Same slot, another prompt: on check-in day the buddy asks this instead. Never both.')
def _():
    return root('today', today_body(dialogue('It’s Monday, so it’s check-in time. Two minutes and I’ll tune next week’s numbers.',
                                             ['Check in now', 'Later today'], mood='keen', pose='wave')))

@screen('today-day', 'Today', 'Today in detail (sheet)', 'Tapping the hero. Replaces the old LEFT / EATEN switch and the Details link.')
def _():
    rows = ''
    for k, n, e, t, kind in [('Calories', 'kcal', 1135, 2236, 'cal'), ('Protein', 'g', 76, 131, 'pro'), ('Carbs', 'g', 150, 257, 'carb'), ('Fat', 'g', 22, 70, 'fat'), ('Fibre', 'g', 19, 30, 'cal')]:
        rows += (f'<div class="row" style="display:block"><div class="split"><span class="t">{k}</span><span class="sm"><span class="fig">{e:,}</span> / {t:,} {n}</span></div>'
                 f'<div style="margin-top:8px">{hp(round(e / t * 100), kind, 20, "thin", k)}</div></div>')
    body = (f'<div data-primary>{rows}</div>'
            + section('By meal', row('Breakfast', None, None, kcal(425), False) + row('Lunch', None, None, kcal(616), False)
                      + row('Snacks', None, None, kcal(94), False)))
    return root('today', today_body()) + sheet('Thursday 8 October', body, tall=True)

@screen('weigh', 'Today', 'Log weight (sheet)', 'One weigh sheet for the whole app: the buddy, Progress and the shortcut all open it.')
def _():
    body = ('<div class="center" data-primary style="padding:8px 0 4px"><div class="stepper" style="justify-content:center;gap:8px">'
            f'<button aria-label="Down 0.1">{ic("back")}</button><span class="bignum ink">83.4</span><span class="unit">kg</span>'
            f'<button aria-label="Up 0.1" style="transform:scaleX(-1)">{ic("back")}</button></div>'
            '<div class="sm muted" style="margin-top:8px">Yesterday 83.6 · trend 83.0</div></div>'
            + '<div class="sp16"></div>' + row('Body fat', 'Optional', 'drop', '<span class="sm">Add</span>'))
    return root('today', today_body()) + sheet('Weigh-in · today', body, btn('Log 83.4 kg', 'a', w=True))

@screen('recovery', 'Today', 'Recovery', 'From the Recovery row. Sleep and readiness from Google Health.')
def _():
    nights = [('Thu', 432, 82), ('Wed', 401, 74), ('Tue', 455, 86), ('Mon', 389, 69), ('Sun', 470, 88), ('Sat', 512, 91), ('Fri', 366, 63)]
    rows = ''.join(row(d, f'Ready {r}', None, f'<span class="fig">{m // 60}</span><span class="unit">h</span> <span class="fig">{m % 60:02d}</span><span class="unit">m</span>', False) for d, m, r in nights[1:])
    body = (hero('<div class="split"><div><span class="bignum">82</span> <span class="unit">ready</span></div><span class="tag good">Train as planned</span></div>'
                 f'<div class="sm muted" style="margin:6px 0 10px">Slept 7 h 12 · resting HR 54</div>{hp(82, "cal", 20, "", "Readiness 82")}', 'data-primary')
            + section('Last 7 nights', rows, meta='Google Health'))
    return sub('Recovery', body, 'Today')

@screen('talk', 'Today', 'Talk to Chompers', 'Opened from the buddy (Today dialogue or Play). The same dialogue box, as a conversation.')
def _():
    body = (dialogue('Lunch was a solid 48 g of protein. You’ve got 1,101 kcal left. Want a dinner idea that fits?',
                     ['Yes, something quick', 'Log what I had', 'Just chatting'], mood='happy', pose='talk', attrs='data-primary')
            + '<div class="sp16"></div>' + field('Say something…', icon='chat', inbtn=[('mic', 'Speak'), ('camera', 'Add a photo')]))
    return sub('Chompers', body, 'Today')

# ============================================================== LOGGING (+)
LEFT_BANNER = ('<div class="banner"><span class="b">Left today</span><span><span class="fig">1101</span> kcal · '
               '<span style="color:var(--pro-ink)">P55</span> <span style="color:var(--carb-ink)">C107</span> <span style="color:var(--fat-ink)">F48</span></span></div>')

def log_head(meal='Breakfast'):
    return f'<button style="display:inline-flex;align-items:center;gap:6px;min-height:44px">{esc(meal)} {ic("down", "s")}</button>'

def log_top(focus=True, q=None, meal='Breakfast'):
    f = field('Search foods and brands', q, 'search', [('barcode', 'Scan a barcode')], focus=focus, attrs='data-primary')
    return LEFT_BANNER + '<div class="sp8"></div>' + f + '<div class="chips" style="margin-top:10px">' + chip('Quick add', 'bolt') + chip('Estimate', 'sparkle') + chip('Drink', 'drink') + '</div>'

RECENTS = [('Porridge, banana &amp; whey', '1 bowl · 425 kcal'), ('Greek yoghurt &amp; berries', '200 g · 210 kcal'),
           ('Flat white, oat milk', '1 cup · 95 kcal'), ('Toast &amp; peanut butter', '2 slices · 330 kcal')]

@screen('log', 'Log (+)', 'Log food', 'Opens on the meal for this hour, search focused, barcode inside the field. Recents ranked for this meal; + logs the usual amount and keeps the sheet open.')
def _():
    rows = ''.join(row(t, s, add=True) for t, s in RECENTS)
    body = log_top() + section('Usual for breakfast', rows, link='All recent')
    return root('today', today_body()) + sheet(log_head(), body, tall=True)

@screen('log-search', 'Log (+)', 'Search results', 'Typed “chicken th”. + logs the usual amount and the sheet stays open for the next food; tapping the name opens the amount screen.')
def _():
    res = [('Chicken thighs, skinless', 'Tesco · 100 g · 177 kcal'), ('Chicken thigh fillets', 'Sainsbury’s · 100 g · 165 kcal'),
           ('Roast chicken thigh, with skin', 'UK foods · 1 thigh · 250 kcal'), ('Chicken thigh kebab', 'Your food · 1 wrap · 520 kcal')]
    rows = ''.join(row(t, s, add=True) for t, s in res)
    body = log_top(True, 'chicken th') + section('Results', rows)
    foot = ('<div class="plate"><div class="grow"><div class="b">Added 2 to dinner · <span class="fig">640</span> kcal</div><div class="sm muted">Chicken &amp; rice bowl, side salad</div></div>'
            + btn('Undo', 't') + btn('Done', 'a') + '</div>')
    return root('food', '') + sheet(log_head('Dinner'), body, foot, tall=True)

@screen('log-barcode', 'Log (+)', 'Barcode', 'From the barcode button in the search field: one tap, straight to the camera.')
def _():
    body = ('<div class="viewfinder" data-primary><div class="frame"></div><div class="hint">Line the barcode up in the box</div></div>'
            '<div class="center" style="margin-top:12px">' + btn('Type the number', 't') + '</div>')
    return root('today', today_body()) + sheet(log_head(), body, tall=True)

@screen('log-quick', 'Log (+)', 'Quick add', 'Calories and macros directly. One serving, so there is no amount step.')
def _():
    body = ('<div class="form">' + field(None, '350', label='Calories', unit='kcal', focus=True, attrs='data-primary')
            + '<div class="kv">' + field(None, '25', label='Protein', unit='g') + field(None, '30', label='Carbs', unit='g') + field(None, '12', label='Fat', unit='g') + '</div>'
            + field('Meal deal, lunch', label='Name (optional)') + '</div>')
    return root('today', today_body()) + sheet('Quick add · Lunch', body, btn('Log 350 kcal', 'a', w=True), tall=True)

@screen('log-estimate', 'Log (+)', 'Estimate (AI)', 'Describe, photograph or paste a menu link. Menu is now an input here, not a separate tab.')
def _():
    items = [('Pepperoni pizza', '2 slices · 570 kcal'), ('Side salad, balsamic', '1 bowl · 92 kcal'), ('Garlic dip', '1 pot · 80 kcal')]
    rows = ''.join(row(t, s, end=f'<button class="btn t" style="min-height:44px">Edit</button>', chev=False, tag='div') for t, s in items)
    body = (field(None, 'Two slices of pepperoni pizza, a side salad and a garlic dip', 'sparkle', [('camera', 'Add a photo'), ('mic', 'Speak')])
            + section('Chompers’ estimate', rows, meta='742 kcal', attrs='data-primary'))
    return root('food', '') + sheet('Estimate · Dinner', body, btn('Log 3 items · 742 kcal', 'a', w=True), tall=True)

@screen('log-drink', 'Log (+)', 'Drink', 'Alcohol in units and kcal. Recent drinks first.')
def _():
    d = [('Pint of lager, 4%', '2.3 units · 182 kcal'), ('Glass of red, 175 ml', '2.3 units · 150 kcal'), ('Gin &amp; slimline tonic', '1 unit · 56 kcal'), ('Bottle of cider, 500 ml', '2.5 units · 210 kcal')]
    rows = ''.join(row(t, s, add=True) for t, s in d)
    body = field('Search drinks', icon='search') + section('Your drinks', rows, attrs='data-primary')
    return root('today', today_body()) + sheet('Drink · Dinner', body, tall=True)

@screen('food-detail', 'Log (+)', 'Food detail / amount', 'Tapping a result’s name. The amount, what it does to today, and Log.')
def _():
    body = ('<div class="sm muted">Fage Total 0% · per 170 g pot</div><div class="sp16"></div>'
            '<div class="split" data-primary><div><span class="bignum ink">97</span> <span class="unit">kcal</span></div>' + mm(17, 6, 0) + '</div>'
            '<div class="sp16"></div><div class="form">' + field(None, '1', label='Amount', focus=True) + '<div><label class="lbl">Serving</label>' + seg(['pot', 'g', 'tbsp'], 'pot') + '</div></div>'
            + '<div class="sp8"></div>' + row('Meal', 'Breakfast · today', 'calendar') + row('After this', '1,004 kcal left · 38 g protein left', 'target', chev=False))
    return root('today', today_body()) + sheet('Greek yoghurt, 0% fat', body, btn('Log to breakfast', 'a', w=True), tall=True)

@screen('edit-entry', 'Log (+)', 'Edit entry', 'Tapping a diary row. Copy, move and delete live here (the per-row ≡ menu goes).')
def _():
    body = ('<div class="split" data-primary><div><span class="bignum ink">616</span> <span class="unit">kcal</span></div>' + mm(48, 70, 13) + '</div><div class="sp16"></div>'
            '<div class="pair">' + field(None, '470', label='Amount', unit='g') + '<div><label class="lbl">Serving</label>' + seg(['g', 'bowl'], 'g') + '</div></div><div class="sp8"></div>'
            + row('Meal', 'Lunch', 'food') + row('Day', 'Today', 'calendar')
            + '<div class="hrow" style="margin-top:12px;justify-content:space-between">' + btn('Copy', 't', 'copy') + btn('Move', 't', 'swap') + btn('Delete', 't danger', 'trash') + '</div>')
    return food_page() + sheet('Chicken &amp; rice bowl', body, btn('Save', 'a', w=True), tall=True)

@screen('log-empty', 'Empty & first run', 'Log food · first time', 'No history yet: the chips and search carry it; one line says recents will appear.')
def _():
    body = log_top() + ('<div class="empty"><svg class="ico l" aria-hidden="true"><use href="#i-search"/></svg>'
                        '<p class="sm muted">Foods you log show up here for one-tap logging.</p></div>')
    return root('today', first_today()) + sheet(log_head(), body, tall=True)

# ============================================================== FOOD · diary
ENTRIES = {
    'Breakfast': [('Porridge, banana &amp; whey', '360 g', 425, (27, 59, 9))],
    'Lunch': [('Chicken &amp; rice bowl', '470 g', 616, (48, 70, 13))],
    'Dinner': [],
    'Snacks': [('Banana', '1 medium', 94, (1, 21, 0))],
}

def meal_sec(name, items, first=False):
    tot = sum(i[2] for i in items)
    head = (f'<div class="sec-h"><h2><button style="min-height:44px">{name}</button></h2><span class="hrow" style="gap:4px">'
            f'<span class="meta">{f"<span class=fig>{tot}</span> kcal" if items else ""}</span>'
            f'<button class="addbtn" aria-label="Add to {name}"><span class="box">{ic("plus")}</span></button></span></div>')
    rows = ''
    for k, (t, a, kc, (p, c, f)) in enumerate(items):
        rows += row(t, f'{a} · ' + mm(p, c, f), None, kcal(kc), False, attrs='data-primary' if first and k == 0 else '')
    if not items:
        rows = f'<div class="row"><span class="sm muted">Nothing yet</span></div>'
    return f'<section class="sec">{head.replace("min-height:32px", "")}{rows}</section>'

def day_switch(label='Today · Thu 8 Oct'):
    return (f'<div class="hrow" style="justify-content:space-between;margin-top:8px"><button class="btn t" aria-label="Previous day" style="min-width:44px">{ic("back")}</button>'
            f'<button class="b" style="min-height:44px">{label}</button>'
            f'<button class="btn t" aria-label="Next day" style="min-width:44px;transform:scaleX(-1)">{ic("back")}</button></div>')

def food_summary(eaten=1135, target=2236, p=76, c=150, f=22):
    return (f'<div style="margin-top:4px"><div class="split"><span><span class="fig">{eaten:,}</span> <span class="unit">of {target:,} kcal</span></span>{mm(p, c, f)}</div>'
            f'<div style="margin-top:8px">{hp(round(eaten / target * 100), "cal", 20, "thin", "kcal eaten")}</div></div>')

def food_page(entries=ENTRIES, eaten=1135, pcf=(76, 150, 22)):
    body = seg(['Diary', 'Cook'], 'Diary') + day_switch() + food_summary(eaten, 2236, *pcf)
    first = True
    for m, it in entries.items():
        body += meal_sec(m, it, first and bool(it)); first = first and not it
    return root('food', body, 'Food')

@screen('food', 'Food', 'Diary', 'One summary line, then meals as sections and entries as rows. Tap a row to edit; + on each meal.')
def _(): return food_page()

@screen('food-meal', 'Food', 'Meal actions (sheet)', 'Tapping a meal’s name. The meal’s existing ⋯ menu, as rows: copy, save, reorder, clear, delete.')
def _():
    body = ('<div data-primary>' + row('Copy to…', 'Another meal or day', 'copy') + row('Save as a meal', 'Log it in one tap next time', 'star')
            + row('Move up', None, 'back', chev=False) + row('Move down', None, 'down', chev=False) + row('Clear food', None, 'close', chev=False) + row('Delete meal', None, 'trash', chev=False) + '</div>')
    return food_page() + sheet('Breakfast', body)

@screen('food-empty', 'Empty & first run', 'Diary · empty day', 'A new day. Meals stay as sections so the + is where you expect it.')
def _(): return food_page({k: [] for k in ENTRIES}, 0, (0, 0, 0)).replace('data-primary', '').replace('<section class="sec"><div class="sec-h"><h2><button style="min-height:44px">Breakfast', '<section class="sec" data-primary><div class="sec-h"><h2><button style="min-height:44px">Breakfast', 1)

# ============================================================== FOOD · Cook
def cook_page(body):
    return root('food', seg(['Diary', 'Cook'], 'Cook') + '<div class="sp16"></div>' + body, 'Food')

@screen('cook', 'Food · Cook', 'Cook', 'Cook lives inside Food. Hero = the recipe that fits what’s left today. Your recipes, then four rows.')
def _():
    h = hero('<div class="hrow"><div class="thumb">' + ic('pot') + '</div><div class="grow"><div class="sm" style="color:var(--good-ink);font-weight:600">Fits what’s left</div>'
             '<div class="t b" style="font-size:17px;line-height:1.3">High-protein chicken pesto pasta</div>'
             '<div class="sm muted"><span class="fig">540</span> kcal · 46 g protein</div></div></div>'
             '<div class="hrow" style="margin-top:12px">' + btn('Log a serving', 'a') + btn('Open', 't') + '</div>', 'data-primary')
    mine = ''.join(row(t, s, None, chev=True) for t, s in [('Cottage cheese protein bagel', '310 kcal · 28 g protein'), ('Smoky bean tacos', '620 kcal · 31 g protein'), ('Overnight oats, PB', '390 kcal · 24 g protein')])
    more = row('Meal plan', '5 of 7 dinners planned', 'calendar') + row('Shopping list', '14 items', 'cart') + row('Discover', 'Recipes from the community', 'book') + row('What can I make?', 'Photo your fridge', 'fridge')
    body = field('Search your recipes', icon='search', inbtn=[('link', 'Import from a link')]) + '<div class="sp16"></div>' + h + section('Your recipes', mine, link='All 12') + section('More', more)
    return cook_page(body)

@screen('recipe', 'Food · Cook', 'Recipe detail', 'Per serving at the top, ingredients and method as plain lists, Log in the footer.')
def _():
    ing = ''.join(row(t, None, None, f'<span class="sm">{a}</span>', False, cls='compact') for t, a in [('Chicken breast', '500 g'), ('Wholewheat fusilli', '320 g'), ('Green pesto', '4 tbsp'), ('Cherry tomatoes', '250 g'), ('Spinach', '2 handfuls'), ('Parmesan', '30 g')])
    steps = ''.join(f'<div class="row" style="align-items:flex-start"><span class="fig" style="width:28px">{i}</span><span class="grow sm" style="font-size:15px">{s}</span></div>'
                    for i, s in enumerate(['Cook the pasta. Keep a mug of the water.', 'Fry the chicken in strips, 6–7 min.', 'Stir through pesto, tomatoes, spinach and a splash of pasta water.'], 1))
    body = (hero('<div class="split"><div><span class="bignum ink">540</span> <span class="unit">kcal a serving</span></div></div><div class="sp8"></div>' + mm(46, 52, 16)
                 + '<div class="hrow" style="margin-top:12px;justify-content:space-between"><span class="sm b">Serves</span><div class="stepper"><button aria-label="Fewer">' + ic('back') + '</button><span class="fig">4</span><button aria-label="More" style="transform:scaleX(-1)">' + ic('back') + '</button></div></div>', 'data-primary')
            + section('Ingredients', ing) + section('Method', steps))
    return sub('Chicken pesto pasta', body, 'Cook', 'More', 'more', btn('Log a serving', 'a', w=True))

@screen('recipe-build', 'Food · Cook', 'Recipe builder', 'Build from ingredients. The per-serving numbers update as you go and sit in the footer.')
def _():
    ing = ''.join(row(t, a, None, kcal(k), False) for t, a, k in [('Red lentils, dried', '200 g', 636), ('Chopped tomatoes', '2 tins', 168), ('Coconut milk, light', '400 ml', 292), ('Onion', '1 large', 60)])
    body = ('<div class="form">' + field(None, 'Lentil &amp; coconut dal', label='Name') + '</div>'
            + section('Ingredients', ing + '<div class="sp8"></div>' + field('Add an ingredient', icon='search', inbtn=[('barcode', 'Scan')], focus=True), attrs='data-primary'))
    foot = '<div class="plate"><div class="grow"><div class="b">Serves 4 · <span class="fig">289</span> kcal each</div>' + mm(14, 38, 8) + '</div>' + btn('Save', 'a') + '</div>'
    return sub('New recipe', body, 'Cook', foot=foot)

@screen('recipe-import', 'Food · Cook', 'Import a recipe (sheet)', 'Paste a link from TikTok, Instagram, YouTube or a recipe site, or photograph a page.')
def _():
    body = (field(None, 'tiktok.com/@highproteinuk/video/7431…', 'link', focus=False, attrs='data-primary')
            + '<div class="chips" style="margin-top:10px">' + chip('Paste link', 'copy') + chip('Photo of a page', 'camera') + '</div>'
            + section('Found', row('Gochujang chicken rice bowls', 'Serves 4 · about 610 kcal each', 'pot', chev=False)))
    return cook_page('') + sheet('Import a recipe', body, btn('Import', 'a', w=True))

@screen('meal-plan', 'Food · Cook', 'Meal plan', 'The week’s dinners. Gaps are rows you can fill; the list feeds the shopping list.')
def _():
    days = [('Mon', 'Chicken pesto pasta'), ('Tue', 'Smoky bean tacos'), ('Wed', 'Lentil &amp; coconut dal'), ('Thu', None), ('Fri', 'Gochujang chicken bowls'), ('Sat', None), ('Sun', 'Roast chicken traybake')]
    rows = ''.join(row(r or '<span class="muted" style="font-weight:500">Add a dinner</span>', None, None, None, True,
                       lead=f'<span class="sm b" style="width:36px;color:var(--ink-2)">{d}</span>', attrs='data-primary' if i == 0 else '') for i, (d, r) in enumerate(days))
    return sub('Meal plan · this week', rows, 'Cook', foot=btn('Add 5 dinners to the shopping list', 'b', w=True))

@screen('shopping', 'Food · Cook', 'Shopping list', 'Grouped by aisle. Tick as you go.')
def _():
    def item(t, a, on=False):
        return f'<div class="row compact"><button class="tick{" on" if on else ""}" aria-label="Tick {t}"><span class="box">{ic("check") if on else ""}</span></button><div class="grow"><div class="t" style="{"text-decoration:line-through;color:var(--muted)" if on else ""}">{t}</div></div><span class="sm muted">{a}</span></div>'
    body = (section('Meat &amp; fish', item('Chicken breast', '1 kg') + item('Chicken thighs', '600 g', True), attrs='data-primary')
            + section('Fruit &amp; veg', item('Cherry tomatoes', '500 g') + item('Spinach', '2 bags', True) + item('Limes', '3'))
            + section('Cupboard', item('Red lentils', '200 g') + item('Gochujang', '1 jar')))
    return sub('Shopping list', body, 'Cook', 'Share', 'share')

@screen('discover', 'Food · Cook', 'Discover', 'Community recipes, filtered to what fits you. Your contributor level moves to the foot.')
def _():
    rows = ''.join(row(t, s, 'pot') for t, s in [('Protein pancakes, 3 ingredients', '280 kcal · 30 g protein · by Sam'), ('Turkey chilli, slow cooker', '450 kcal · 41 g protein · by Priya'),
                                                 ('Halloumi &amp; harissa wraps', '520 kcal · 29 g protein · by Jo'), ('Miso salmon traybake', '480 kcal · 36 g protein · by Ade')])
    body = field('Search community recipes', icon='search') + '<div class="chips" style="margin-top:10px">' + chip('Fits today', on=True) + chip('High protein') + chip('Under 20 min') + '</div>' + section('Popular this week', rows, attrs='data-primary') + section('You', row('Contributor', '3 recipes shared · 2 to Regular', 'star'))
    return sub('Discover', body, 'Cook')

@screen('fridge', 'Food · Cook', 'What can I make?', 'After the fridge photo: what it saw, then recipes that fit what’s left today.')
def _():
    body = ('<div class="sm"><span class="b">Seen:</span> eggs, spinach, feta, peppers, wraps, Greek yoghurt</div>'
            + section('You could make', ''.join(row(t, s, 'pot') for t, s in [('Spinach &amp; feta omelette', '390 kcal · 27 g protein'), ('Breakfast wraps', '480 kcal · 30 g protein'), ('Shakshuka for one', '410 kcal · 24 g protein')]), attrs='data-primary'))
    return sub('What can I make?', body, 'Cook', foot=btn('Take another photo', 'b', 'camera', w=True))

@screen('cook-empty', 'Empty & first run', 'Cook · no recipes', 'Two ways in, both on the screen. Discover stays a row.')
def _():
    body = ('<div class="empty" data-primary><svg class="ico l" aria-hidden="true"><use href="#i-pot"/></svg><h2>No recipes yet</h2>'
            '<p class="sm muted">Import one from a link, or build your own.</p><div class="sp16"></div>' + btn('Import from a link', 'a', 'link') + btn('Build', 'b') + '</div>'
            + section('More', row('Discover', 'Recipes from the community', 'book') + row('What can I make?', 'Photo your fridge', 'fridge')))
    return cook_page(body)

# ============================================================== first-run Today
def first_today():
    h = today_hero(2236, 0, 2236, (131, 0), (257, 0), (70, 0))
    d = dialogue('…the egg wobbles. Log your first meal and it’ll start to hatch.', ['Log breakfast', 'Show me around'], name='Your egg', emote='?', pose='egg')
    rows = section('Getting started', row('Set your targets', 'Done', 'check', chev=False) + row('Log your first meal', None, 'food') + row('Weigh in', 'Once a week is fine', 'scale'), meta='1 of 3')
    return h + '<div class="sp8"></div>' + d + rows

@screen('today-first', 'Empty & first run', 'Today · first day', 'Before hatching: the egg wobbles in the bar, the egg speaks, and a three-step checklist replaces the Today rows.')
def _(): return root('today', first_today(), walker='egg')
