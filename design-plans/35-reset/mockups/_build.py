#!/usr/bin/env python3
"""Builds the 35-reset mockups: one markup per screen, rendered in two skins (a.css, b.css).

    python3 design-plans/35-reset/mockups/_build.py

Writes A-<screen>.html and B-<screen>.html next to this file. The screens share markup on
purpose: the two directions differ in skin only (01-direction.md §3), so the pick is about the look.
Elements the audit harness measures carry data-primary (the screen's primary content) and
data-chrome (app bar, tab bar: excluded from the counts).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- pixel icons: 12x12 bitmaps, drawn as crisp SVG rects in currentColor ----------------------
ICONS = {
 'gear': ["....XXXX....", "..X.XXXX.X..", ".XXXXXXXXXX.", "..XXX..XXX..", "XXXX....XXXX", "XXX......XXX",
          "XXX......XXX", "XXXX....XXXX", "..XXX..XXX..", ".XXXXXXXXXX.", "..X.XXXX.X..", "....XXXX...."],
 'plus': ["............", ".....XX.....", ".....XX.....", ".....XX.....", ".....XX.....", ".XXXXXXXXXX.",
          ".XXXXXXXXXX.", ".....XX.....", ".....XX.....", ".....XX.....", ".....XX.....", "............"],
 'chev': ["............", "...XX.......", "....XX......", ".....XX.....", "......XX....", ".......XX...",
          ".......XX...", "......XX....", ".....XX.....", "....XX......", "...XX.......", "............"],
 'back': ["............", ".......XX...", "......XX....", ".....XX.....", "....XX......", "...XX.......",
          "...XX.......", "....XX......", ".....XX.....", "......XX....", ".......XX...", "............"],
 'close': ["............", ".XX......XX.", ".XXX....XXX.", "..XXX..XXX..", "...XXXXXX...", "....XXXX....",
           "....XXXX....", "...XXXXXX...", "..XXX..XXX..", ".XXX....XXX.", ".XX......XX.", "............"],
 'barcode': ["............", "X.XX.X.XX.XX", "X.XX.X.XX.XX", "X.XX.X.XX.XX", "X.XX.X.XX.XX", "X.XX.X.XX.XX",
             "X.XX.X.XX.XX", "X.XX.X.XX.XX", "X.XX.X.XX.XX", "X.XX.X.XX.XX", "X.XX.X.XX.XX", "............"],
 'search': ["............", "..XXXXX.....", ".XX...XX....", "XX.....XX...", "XX.....XX...", "XX.....XX...",
            ".XX...XX....", "..XXXXXXX...", ".......XXX..", "........XXX.", ".........XX.", "............"],
 'today': ["............", "..X..XX..X..", "...X....X...", "....XXXX....", "...XXXXXX...", "XX.XXXXXX.XX",
           "XX.XXXXXX.XX", "...XXXXXX...", "....XXXX....", "...X....X...", "..X..XX..X..", "............"],
 'food': ["............", ".X.X.X...XX.", ".X.X.X..XXX.", ".X.X.X..XXX.", ".XXXXX..XXX.", "..XXX...XXX.",
          "...X.....XX.", "...X.....XX.", "...X.....XX.", "...X.....XX.", "...X.....XX.", "............"],
 'train': ["............", "............", "XX........XX", "XX........XX", "XXX......XXX", "XXXXXXXXXXXX",
           "XXXXXXXXXXXX", "XXX......XXX", "XX........XX", "XX........XX", "............", "............"],
 'progress': ["............", "..........XX", ".........XXX", "........XX..", "..X....XX...", ".XXX..XX....",
              "XX.XXXX.....", "X...XX......", "............", "XXXXXXXXXXXX", "XXXXXXXXXXXX", "............"],
 'check': ["............", "............", "..........XX", ".........XX.", "........XX..", "XX.....XX...",
           ".XX...XX....", "..XX.XX.....", "...XXX......", "....X.......", "............", "............"],
 'scale': ["............", ".XXXXXXXXXX.", ".X........X.", ".X..XXXX..X.", ".X...XX...X.", ".X........X.",
           ".X........X.", ".X........X.", ".X........X.", ".X........X.", ".XXXXXXXXXX.", "............"],
 'moon': ["............", "....XXXX....", "..XXX.......", ".XX.........", ".XX.........", "XX..........",
          "XX..........", ".XX.......X.", ".XXX....XXX.", "..XXXXXXXX..", "....XXXX....", "............"],
 'flash': ["............", "......XX....", ".....XX.....", "....XX......", "...XXXXXX...", "......XX....",
           ".....XX.....", "....XX......", "...XX.......", "..XX........", "............", "............"],
 'spark': ["............", ".....XX.....", ".....XX.....", "..X..XX..X..", "...X....X...", "XXX..XX..XXX",
           "XXX..XX..XXX", "...X....X...", "..X..XX..X..", ".....XX.....", ".....XX.....", "............"],
 'cup': ["............", "...X.X.X....", "..X.X.X.....", "............", "XXXXXXXXXX..", "X........XX.",
         "X........X.X", "X........XX.", ".X......X...", "..XXXXXX....", "XXXXXXXXXXX.", "............"],
 'menu': ["............", "............", "XXXXXXXXXXXX", "............", "............", "XXXXXXXXXXXX",
          "............", "............", "XXXXXXXXXXXX", "............", "............", "............"],
}

def icon(name, size=20, cls='ic'):
    rows = ICONS[name]
    rects = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1"/>'
                    for y, r in enumerate(rows) for x, c in enumerate(r) if c == 'X')
    return (f'<svg class="{cls}" width="{size}" height="{size}" viewBox="0 0 12 12" fill="currentColor" '
            f'shape-rendering="crispEdges" aria-hidden="true">{rects}</svg>')

def buddy(px=2, cls=''):
    return f'<span class="buddy {cls}" style="--bpx:{px}" role="img" aria-label="Chompers"></span>'

# ---- shared chrome ------------------------------------------------------------------------------
def daynav(label):
    return (f'<span class="daynav"><button class="ab-btn" aria-label="Previous day">{icon("back", 16)}</button>'
            f'<button class="day">{label}</button><button class="ab-btn" aria-label="Next day">{icon("chev", 16)}</button></span>')

def appbar(context, back=None):
    left = (f'<button class="ab-btn" aria-label="Back to {back}">{icon("back")}<span class="ab-back">{back}</span></button>'
            if back else f'<button class="ab-btn ab-avatar" aria-label="Open Play">{buddy(1)}</button>')
    return (f'<header class="appbar" data-chrome>{left}<div class="ab-ctx">{context}</div>'
            f'<button class="ab-btn" aria-label="You and settings">{icon("gear")}</button></header>')

def tabbar(active):
    def tab(k, label, ic):
        on = ' aria-current="page"' if k == active else ''
        return f'<a class="tab" href="#"{on}>{icon(ic, 22)}<span>{label}</span></a>'
    return ('<nav class="tabbar" data-chrome>' + tab('today', 'Today', 'today') + tab('food', 'Food', 'food') +
            f'<button class="fab" aria-label="Log food">{icon("plus", 32)}</button>' +
            tab('train', 'Train', 'train') + tab('progress', 'Progress', 'progress') + '</nav>')

def row(title, detail='', trail='', lead='', chev=True, primary=False, tag='button', extra=''):
    p = ' data-primary' if primary else ''
    l = f'<span class="row-lead">{lead}</span>' if lead else ''
    d = f'<span class="row-d">{detail}</span>' if detail else ''
    t = f'<span class="row-trail">{trail}</span>' if trail else ''
    c = icon('chev', 16, 'ic row-chev') if chev else ''
    return f'<{tag} class="row"{p}{extra}>{l}<span class="row-main"><span class="row-t">{title}</span>{d}</span>{t}{c}</{tag}>'

def section(label, rows, more=None):
    m = f'<a class="sec-more" href="#">{more}</a>' if more else ''
    return f'<section class="sec"><div class="sec-h"><h2>{label}</h2>{m}</div><div class="rows">{"".join(rows)}</div></section>'

def meter(frac, cells=20, cls='', color='var(--cal)'):
    on = round(frac * cells)
    return (f'<div class="meter {cls}" style="--c:{color}" role="meter" aria-valuenow="{round(frac*100)}" aria-valuemin="0" aria-valuemax="100">' +
            ''.join(f'<i class="{"on" if i < on else ""}"></i>' for i in range(cells)) + '</div>')

def macro(label, left, of, color, ink):
    frac = 1 - left / of
    return (f'<div class="mac"><div class="mac-top"><span class="mac-l" style="color:{ink}">{label}</span>'
            f'<span class="mac-v"><b>{left}g</b> left</span></div>{meter(frac, 10, "meter-sm", color)}</div>')

# ---- screens ------------------------------------------------------------------------------------
def today():
    hero = f'''<div class="hero" data-primary>
      <button class="hero-flip" aria-label="Show eaten instead of left">
        <div class="hero-num"><span class="num">1101</span><span class="unit">kcal left</span></div>
        <div class="hero-of">1135 eaten · 2236 target</div>
      </button>
      {meter(1135/2236)}
      <div class="macs">{macro("Protein", 56, 131, "var(--pro)", "var(--pro-ink)")}{macro("Carbs", 107, 257, "var(--carb)", "var(--carb-ink)")}{macro("Fat", 48, 70, "var(--fat)", "var(--fat-ink)")}</div>
    </div>'''
    bud = f'''<div class="budline">
      <button class="bud-tile" aria-label="Open Play">{buddy(2)}</button>
      <div class="bud-main"><div class="bud-name"><span class="pxname">Chompers</span><span class="mood">peckish</span></div>
        <p class="bud-say">How often will you weigh in?</p>
        <div class="chips"><button class="chip chip-primary">Most mornings</button><button class="chip">Once a week</button></div></div>
    </div>'''
    rows = [row('Training', 'Lower B · Friday · ~76 min', lead=icon('train')),
            row('Weight', '83.0 kg trend', '<span class="good">−0.8 kg/wk</span>', lead=icon('scale')),
            row('Recovery', 'Slept 96 · Ready 82', lead=icon('moon'))]
    return appbar('Thu 8 Oct') + f'<main class="page">{hero}{bud}{section("Today", rows)}</main>' + tabbar('today')

def entry(name, amt, kcal, p, c, f, primary=False):
    pr = ' data-primary' if primary else ''
    return (f'<button class="row entry"{pr}><span class="row-main"><span class="row-t">{name}</span>'
            f'<span class="row-d">{amt} · <span style="color:var(--pro-ink)">P{p}</span> <span style="color:var(--carb-ink)">C{c}</span> <span style="color:var(--fat-ink)">F{f}</span></span></span>'
            f'<span class="row-trail num-s">{kcal}</span></button>')

def meal(name, kcal, entries):
    k = f'{kcal} kcal' if kcal else '—'
    body = ''.join(entries) if entries else '<p class="empty">Nothing yet</p>'
    return (f'<section class="sec meal"><div class="sec-h"><h2>{name}</h2><span class="sec-sum">{k}</span>'
            f'<button class="sec-add" aria-label="Add to {name}">{icon("plus", 16)}</button></div><div class="rows">{body}</div></section>')

def food():
    top = f'''<div class="seg" role="tablist"><button role="tab" aria-selected="true">Diary</button><button role="tab">Recipes</button></div>
    <div class="sumline"><div class="sum-k"><b class="num-s">1135</b> of 2236 kcal</div>
      <div class="sum-m"><span style="color:var(--pro-ink)">P 75</span><span style="color:var(--carb-ink)">C 150</span><span style="color:var(--fat-ink)">F 22</span></div>
      {meter(1135/2236, 20, "meter-xs")}</div>'''
    meals = (meal('Breakfast', 425, [entry('Porridge, banana &amp; whey', '360 g', 425, 27, 59, 9, True)]) +
             meal('Lunch', 616, [entry('Chicken &amp; rice bowl', '470 g', 616, 48, 70, 13)]) +
             meal('Dinner', 0, []) +
             meal('Snacks', 94, [entry('Apple', '180 g', 94, 0, 21, 0)]))
    return appbar(daynav('Today')) + f'<main class="page page-food">{top}{meals}</main>' + tabbar('food')

def recent(name, amt, kcal, primary=False):
    pr = ' data-primary' if primary else ''
    return (f'<div class="row rec"{pr}><button class="rec-pick"><span class="row-main"><span class="row-t">{name}</span>'
            f'<span class="row-d">{amt} · {kcal} kcal</span></span></button>'
            f'<button class="rec-add" aria-label="Log {name}">{icon("plus", 16)}</button></div>')

def logsheet():
    under = appbar('Thu 8 Oct') + '<main class="page under" aria-hidden="true"><div class="hero"><div class="hero-num"><span class="num">1101</span><span class="unit">kcal left</span></div></div></main>' + tabbar('today')
    sheet = f'''<div class="scrim" data-chrome></div>
    <div class="sheet" role="dialog" aria-label="Log food">
      <div class="grab" data-chrome></div>
      <div class="sh-top"><button class="mealpick">Breakfast {icon("chev", 12, "ic rot")}</button>
        <button class="ab-btn" aria-label="Close">{icon("close")}</button></div>
      <div class="banner"><b class="num-s">1101</b> kcal left <span class="dot">·</span> <span style="color:var(--pro-ink)">P 56</span> <span style="color:var(--carb-ink)">C 107</span> <span style="color:var(--fat-ink)">F 48</span></div>
      <label class="search" data-primary for="q">{icon("search", 18)}<input id="q" placeholder="Search foods and brands" autofocus>
        <button class="scanbtn" aria-label="Scan a barcode">{icon("barcode", 20)}</button></label>
      <div class="chips scroll"><button class="chip">{icon("flash", 14)} Quick add</button><button class="chip">{icon("spark", 14)} Estimate</button><button class="chip">{icon("menu", 14)} Menu</button><button class="chip">{icon("cup", 14)} Drink</button></div>
      <section class="sec"><div class="sec-h"><h2>Usual for breakfast</h2></div><div class="rows">
        {recent("Porridge, banana &amp; whey", "360 g", 425)}{recent("Greek yoghurt 0%", "150 g", 86)}{recent("Whey protein", "30 g", 117)}{recent("Banana", "1 medium", 102)}{recent("Semi-skimmed milk", "200 ml", 94)}
      </div></section>
    </div>'''
    return under + sheet

def day(d, label, state):
    mark = icon('check', 14) if state == 'done' else ''
    return f'<div class="dcell {state}"><span class="d-l">{d}</span><span class="d-box">{mark}</span><span class="d-n">{label}</span></div>'

def train():
    hero = f'''<div class="hero" data-primary>
      <div class="hero-k">Next up · Friday</div>
      <div class="hero-title">Lower B</div>
      <p class="hero-sub">8 exercises · ~76 min · opens with Hack squat 4×6–10</p>
      <button class="btn-primary">{icon("train", 18)} Start Lower B</button>
    </div>'''
    wk = f'''<section class="sec"><div class="sec-h"><h2>This week</h2><span class="sec-sum">1 left</span></div>
      <div class="week">{day("M","Upper A","done")}{day("T","Lower A","done")}{day("W","Rest","rest")}{day("T","Upper B","done")}{day("F","Lower B","next")}{day("S","Rest","rest")}{day("S","Rest","rest")}</div></section>'''
    prog = f'<div class="blockline"><span>Week 2 of 4 · 7 of 16 sessions</span>{meter(7/16, 16, "meter-xs", "var(--accent)")}</div>'
    rows = [row('History', 'Sessions and lifts'), row('Block &amp; schedule', 'Weeks, days, swaps'), row('Empty session', 'For a day off the plan')]
    return appbar('Summer growth') + f'<main class="page">{prog}{hero}{wk}{section("More", rows)}</main>' + tabbar('train')

def chart():
    # Trend weight, 24 Sep → 20 Nov. y: 77..86 kg mapped to 120..8; x: 0..300.
    W, H, x0, x1, y0, y1 = 300, 128, 34, 296, 10, 112
    kmin, kmax = 77.0, 86.0
    ys = lambda kg: y1 - (kg - kmin) / (kmax - kmin) * (y1 - y0)
    days_total = 57  # 24 Sep .. 20 Nov
    xs = lambda d: x0 + d / days_total * (x1 - x0)
    weigh = [(0, 84.9), (2, 84.4), (4, 84.6), (7, 84.0), (9, 84.2), (11, 83.6), (14, 83.4)]
    trend = [(0, 84.6), (4, 84.3), (7, 84.0), (11, 83.5), (14, 83.0)]
    plan = [(14, 83.0), (57, 78.4)]
    pts = lambda arr: ' '.join(f'{xs(d):.1f},{ys(k):.1f}' for d, k in arr)
    grid = ''.join(f'<line x1="{x0}" x2="{x1}" y1="{ys(k):.1f}" y2="{ys(k):.1f}" class="g"/><text x="{x0-6}" y="{ys(k)+3:.1f}" class="ax" text-anchor="end">{k:g}</text>' for k in (78, 82, 86))
    dots = ''.join(f'<rect x="{xs(d)-1.5:.1f}" y="{ys(k)-1.5:.1f}" width="3" height="3" class="wdot"/>' for d, k in weigh)
    goal = f'<line x1="{x0}" x2="{x1}" y1="{ys(78):.1f}" y2="{ys(78):.1f}" class="goal"/><text x="{x0+4}" y="{ys(78)-4:.1f}" class="ax">goal 78 kg</text>'
    now = f'<line x1="{xs(14):.1f}" x2="{xs(14):.1f}" y1="{y0}" y2="{y1}" class="g"/><text x="{xs(14)+4:.1f}" y="{y0+8}" class="ax">now</text>'
    xl = f'<text x="{x0}" y="{H-2}" class="ax">24 Sep</text><text x="{xs(14):.1f}" y="{H-2}" class="ax" text-anchor="middle">8 Oct</text><text x="{x1}" y="{H-2}" class="ax" text-anchor="end">20 Nov</text>'
    return (f'<svg class="chart" viewBox="0 0 {W} {H}" role="img" aria-label="Trend weight falling from 84.6 to 83.0 kg, projected to reach 78 kg around 20 November">'
            f'{grid}{goal}{now}<polyline points="{pts(plan)}" class="plan"/>{dots}<polyline points="{pts(trend)}" class="trend"/>'
            f'<rect x="{xs(14)-3:.1f}" y="{ys(83.0)-3:.1f}" width="6" height="6" class="tnow"/>{xl}</svg>')

def progress():
    hero = f'''<div class="hero" data-primary>
      <div class="verdict"><span class="badge good">Ahead of plan</span><span class="hero-of">this cycle</span></div>
      <div class="hero-num"><span class="num">−0.8</span><span class="unit">kg a week</span></div>
      <p class="hero-sub">Target is −0.5. At this rate you reach 78.0 kg in about 6 weeks.</p>
      <div class="seg seg-sm" role="tablist"><button role="tab">1M</button><button role="tab" aria-selected="true">3M</button><button role="tab">6M</button><button role="tab">1Y</button><button role="tab">All</button></div>
      {chart()}
    </div>'''
    plan = [row('Goal', 'Fat loss · 0.5 kg/wk · 78.0 kg'),
            row('Calories &amp; macros', '2236 kcal · P131 C257 F70'),
            '<div class="row rowsplit"><span class="row-main"><span class="row-t">Next check-in</span><span class="row-d">Mon 12 Oct · in 4 days</span></span><button class="chip">Check in now</button></div>']
    more = [row('Energy', 'Burn 2,312–2,852 kcal'), row('Coaching', 'Approve each change'),
            row('Weekly shape', 'Even'), row('Weigh-in log', '8 this cycle')]
    foot = '<button class="footlink">Fresh start</button>'
    return appbar('Progress') + f'<main class="page">{hero}{section("Plan", plan)}{section("More", more)}{foot}</main>' + tabbar('progress')

def toggle(on=True):
    return f'<span class="tog {"on" if on else ""}" role="switch" aria-checked="{str(on).lower()}"><i></i></span>'

def you():
    acct = [row('Demo account', 'Free plan', lead=f'<span class="avatar">{buddy(1)}</span>', primary=True),
            row('Try Premium', '7 days free', lead=icon('spark')), row('Sign out', chev=False)]
    body = [row('Body details', 'Male · 32 · 178 cm · Moderately active')]
    food = [row('Default meals', 'Breakfast, Lunch, Dinner, Snacks'),
            row('Share my recipes', 'Imports help the community library', toggle(True), chev=False)]
    apps = [row('Reminders', 'In-app banner · from 2pm'), row('Integrations', 'Apple Health, Garmin, Withings…')]
    look = [row('Theme', '', 'Paper'), row('Units', '', 'kg · cm'), row('Rearrange Today')]
    secs = (section('Account', acct) + section('Body', body) + section('Food', food) +
            section('Reminders &amp; apps', apps) + section('Appearance', look))
    return appbar('You', back='Today') + f'<main class="page">{secs}</main>' + tabbar('')

SCREENS = [('today', 'Today', today), ('food', 'Food · Diary', food), ('log', 'Log sheet', logsheet),
           ('train', 'Train', train), ('progress', 'Progress', progress), ('you', 'You', you)]

HEAD = '''<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="{skin}.css">
</head><body class="skin-{skin} screen-{key}">'''

for skin in ('a', 'b', 'c'):
    for key, label, fn in SCREENS:
        html = HEAD.format(title=f'{skin.upper()} · {label}', skin=skin, key=key) + fn() + '</body></html>\n'
        with open(os.path.join(HERE, f'{skin.upper()}-{key}.html'), 'w') as f:
            f.write(html)
print('built', 3 * len(SCREENS), 'mockups')
