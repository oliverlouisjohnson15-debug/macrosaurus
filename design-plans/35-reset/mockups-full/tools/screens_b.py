"""Screens: Train (4 places + 2 flows) and Progress (the plan's one home)."""
from kit import *
from screens_a import screen, root, sub, SCREENS as _A

SCREENS = []
def screen(id, group, title, note=''):
    def deco(fn):
        SCREENS.append(dict(id=id, group=group, title=title, note=note, fn=fn)); return fn
    return deco

def chart(vals, trend=None, goal=None, w=354, h=150, color='var(--wt)', ylab=None, xlab=None):
    lo, hi = min(vals + ([goal] if goal else [])) - 0.4, max(vals) + 0.4
    X = lambda i, n: 6 + i * (w - 40) / (n - 1)
    Y = lambda v: 10 + (hi - v) / (hi - lo) * (h - 34)
    dots = ''.join(f'<rect x="{X(i, len(vals)) - 2:.1f}" y="{Y(v) - 2:.1f}" width="4" height="4" fill="{color}" opacity=".45"/>' for i, v in enumerate(vals))
    tr = trend or vals
    pts = ' '.join(f'{X(i, len(tr)):.1f},{Y(v):.1f}' for i, v in enumerate(tr))
    g = (f'<line class="ax" x1="0" x2="{w - 34}" y1="{Y(goal):.1f}" y2="{Y(goal):.1f}" stroke-dasharray="4 4"/><text x="{w - 30}" y="{Y(goal) + 4:.1f}">goal</text>') if goal else ''
    yl = ''.join(f'<text x="{w - 30}" y="{Y(v) + 4:.1f}">{v:g}</text>' for v in (ylab or []))
    xl = ''.join(f'<text x="{X(i, len(xlab)) - 10:.1f}" y="{h - 4}">{t}</text>' for i, t in enumerate(xlab or []))
    return (f'<svg class="chart" viewBox="0 0 {w} {h}" role="img" aria-label="Trend chart">'
            f'<line class="ax" x1="0" x2="{w - 34}" y1="{h - 22}" y2="{h - 22}"/>{g}{dots}'
            f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="3" stroke-linejoin="miter"/>{yl}{xl}</svg>')

# ============================================================== TRAIN
WEEK = [('M', 'Upper A', 'done'), ('T', 'Lower A', 'done'), ('W', 'Rest', ''), ('T', 'Upper B', 'done'), ('F', 'Lower B', 'next'), ('S', 'Rest', ''), ('S', 'Rest', '')]

def days(week=WEEK):
    out = '<div class="days">'
    for d, n, st in week:
        inner = ic('check') if st == 'done' else ''
        out += f'<div class="day {st}" title="{n}"><span>{d}</span><span class="pip">{inner}</span></div>'
    return out + '</div>'

def train_home(next_hero=True):
    line = ('<div class="split sm" style="margin:4px 0 8px"><span class="b">Week 2 of 4</span><span class="muted">7 of 16 sessions</span></div>'
            + hp(44, 'wt', 16, 'thin', '7 of 16 sessions'))
    h = hero('<div class="split"><span class="sm b" style="color:var(--link)">Next · Friday</span><span class="sm muted">about 76 min</span></div>'
             '<div style="font-size:24px;font-weight:700;line-height:1.2;margin:4px 0">Lower B</div>'
             '<div class="sm muted">8 exercises · opens with hack squat 4 × 6–10</div><div class="sp16"></div>'
             + btn('Start Lower B', 'a', 'play', w=True), 'data-primary')
    rows = (row('History', 'Last: Upper B, Wednesday', 'history') + row('Block &amp; schedule', 'Mon Tue Thu Fri · 4 weeks', 'calendar')
            + row('Empty session', 'For a day that isn’t in the plan', 'plus'))
    return line + '<div class="sp16"></div>' + h + section('This week', days(), meta='1 left') + section('More', rows)

@screen('train', 'Train', 'Train', 'Hero = next session with Start. 17 internal screens become four places: this, Session, History, Block.')
def _(): return root('train', train_home(), 'Summer growth block')

EXS = [('Hack squat', '4 × 6–10 · 2 RIR', 'Last 62.5 kg × 10, 10, 9, 9'), ('Dumbbell Romanian deadlift', '3 × 6–10', 'Last 30 kg × 10'),
       ('Cable pull-through', '3 × 6–10', 'Last 35 kg × 10'), ('45° back extension', '3 × 8–12', 'Last bodyweight × 12'),
       ('Seated calf raise', '4 × 10–15', 'Last 40 kg × 14'), ('Copenhagen plank', '3 × 8–12 s', 'Last 12 s'),
       ('Hanging leg raise', '3 × 10–20', 'Last 14'), ('Side plank', '3 × 10–20 s', 'Last 20 s')]

@screen('train-session', 'Train', 'Session (before Start)', 'Preview and player are one screen: this is the session before Start. Tap an exercise to swap it.')
def _():
    rows = ''.join(row(t, f'{s} · {l}', lead=f'<span class="fig" style="width:28px;color:var(--link)">{chr(65 + i)}</span>', attrs='data-primary' if i == 0 else '') for i, (t, s, l) in enumerate(EXS))
    body = '<div class="sm muted">8 exercises · 26 sets · about 76 min</div>' + section('Exercises', rows, link='Reorder')
    return sub('Lower B', body, 'Train', foot=btn('Start session', 'a', 'play', w=True))

@screen('train-live', 'Train', 'Live session', 'One exercise in the window, a PREVIOUS column you can tap to copy, the rest timer in place. No tab bar.')
def _():
    bar = ('<header class="appbar"><button class="back" aria-label="Minimise session">' + ic('down') + '</button>'
           '<div class="title">Lower B · <span class="num" style="font-size:15px">32:14</span></div><button class="act txt">Finish</button></header>')
    sets = [('1', '60 × 10', '62.5', '10', True), ('2', '60 × 10', '62.5', '10', True), ('3', '60 × 9', '62.5', '9', True), ('4', '60 × 9', '62.5', '', False)]
    tb = ''.join(f'<tr><td class="fig" style="width:28px">{n}</td><td><button class="cell prev" style="width:100%">{pv}</button></td><td><div class="cell">{kg}</div></td>'
                 f'<td><div class="cell">{r or "<span class=muted>–</span>"}</div></td><td style="width:48px"><button class="tick{" on" if on else ""}" aria-label="Set {n} done">'
                 f'<span class="box">{ic("check") if on else ""}</span></button></td></tr>' for n, pv, kg, r, on in sets)
    h = hero('<div class="split"><div><div style="font-size:20px;font-weight:700">Hack squat</div><div class="sm muted">4 × 6–10 · 2 reps in reserve</div></div><span class="fig" style="color:var(--link)">A</span></div>'
             f'<table class="table" style="margin-top:8px"><thead><tr><th>Set</th><th>Previous</th><th>kg</th><th>Reps</th><th></th></tr></thead><tbody>{tb}</tbody></table>'
             '<div class="hrow" style="margin-top:8px">' + btn('Add set', 't', 'plus') + btn('Note', 't', 'edit') + '</div>', 'data-primary')
    rest = ('<div class="banner" style="margin-top:14px"><span class="b">Rest</span><span class="fig l">1:24</span>'
            '<span class="hrow" style="gap:0"><button class="btn t" style="min-height:44px">−15</button><button class="btn t" style="min-height:44px">+15</button><button class="btn t" style="min-height:44px">Skip</button></span></div>')
    nxt = ''.join(row(t, s, lead=f'<span class="fig" style="width:28px;color:var(--muted)">{chr(66 + i)}</span>') for i, (t, s, _) in enumerate(EXS[1:4]))
    prog = '<div class="split sm" style="margin-bottom:6px"><span class="b">6 of 26 sets</span><span class="muted">about 44 min left</span></div>' + hp(23, 'cal', 26, 'thin', '6 of 26 sets')
    return bar + f'<main class="page sub">{prog}<div class="sp16"></div>{h}{rest}{section("Up next", nxt, link="All 8")}</main>'

@screen('train-done', 'Train', 'Session done', 'The buddy reacts once, in the dialogue box. Records sit under it as rows.')
def _():
    body = (dialogue('New best on hack squat! 62.5 kg for 10. That’s a 4 kg jump on your estimated max.', None, mood='fired up', pose='cheer', emote='!', attrs='data-primary')
            + '<div class="sp16"></div><div class="kv"><div><div class="k">Sets</div><div class="fig l">26</div></div><div><div class="k">Moved</div><div class="fig l">12.4</div><span class="unit">tonnes</span></div><div><div class="k">Time</div><div class="fig l">74</div><span class="unit">min</span></div></div>'
            + section('Records', row('Hack squat', 'Est. max 82 kg · was 78', 'trophy', chev=False) + row('Seated calf raise', '45 kg × 15', 'trophy', chev=False)))
    return sub('Lower B · done', body, 'Train', foot=btn('Done', 'a', w=True))

HIST = [('Wed 7', 'Upper B', '27 sets · 11.8t · bench press best'), ('Tue 6', 'Lower A', '27 sets · 13.3t · hip thrust best'), ('Mon 5', 'Upper A', '31 sets · 15.1t'),
        ('Thu 1', 'Lower B', '18 sets · 9.0t'), ('Wed 30', 'Upper B', '18 sets · 7.9t'), ('Tue 29', 'Lower A', '22 sets · 10.6t')]

@screen('train-history', 'Train', 'History · sessions', 'Sessions and Lifts in one place (was History + Progress + Exercise).')
def _():
    rows = ''.join(row(n, s, lead=f'<span class="sm b" style="width:48px;color:var(--ink-2)">{d}</span>', attrs='data-primary' if i == 0 else '') for i, (d, n, s) in enumerate(HIST))
    body = seg(['Sessions', 'Lifts'], 'Sessions') + section('October', rows[:len(rows)], meta='4 sessions')
    return sub('History', body, 'Train', 'Search', 'search')

@screen('train-lifts', 'Train', 'History · lifts', 'Every exercise you’ve logged, best first. Tap for its detail.')
def _():
    lifts = [('Hack squat', 'Est. max 82 kg', 'trend_up'), ('Barbell bench press', 'Est. max 96 kg', 'trend_up'), ('Barbell hip thrust', 'Est. max 140 kg', 'trend_up'),
             ('Seated cable row', 'Est. max 88 kg', 'trend_up'), ('Dumbbell Romanian deadlift', 'Est. max 41 kg', None), ('Lat pulldown', 'Est. max 79 kg', None)]
    rows = ''.join(row(t, s, 'train', '<span class="sm" style="color:var(--good-ink);font-weight:600">rising</span>' if a else '<span class="sm">steady</span>', attrs='data-primary' if i == 0 else '') for i, (t, s, a) in enumerate(lifts))
    return sub('History', seg(['Sessions', 'Lifts'], 'Lifts') + section('Your lifts', rows, meta='24'), 'Train', 'Search', 'search')

@screen('train-detail', 'Train', 'Session detail', 'A past session: totals, then each exercise as a row with its sets.')
def _():
    ex = [('Barbell bench press', '80 × 8, 80 × 8, 80 × 7, 75 × 9'), ('Seated cable row', '70 × 10, 70 × 10, 70 × 9'), ('Dumbbell shoulder press', '26 × 10, 26 × 9, 26 × 8'),
          ('Lat pulldown', '65 × 10, 65 × 10, 65 × 9'), ('Cable lateral raise', '10 × 15, 10 × 14, 10 × 12')]
    rows = ''.join(row(t, s, attrs='data-primary' if i == 0 else '') for i, (t, s) in enumerate(ex))
    body = ('<div class="kv"><div><div class="k">Sets</div><div class="fig l">27</div></div><div><div class="k">Moved</div><div class="fig l">11.8</div><span class="unit">tonnes</span></div><div><div class="k">Time</div><div class="fig l">68</div><span class="unit">min</span></div></div>'
            + section('Exercises', rows) + '<div class="sp16"></div>' + btn('Repeat this session', 'b', w=True))
    return sub('Upper B · Wed 7 Oct', body, 'History', 'More', 'more')

@screen('train-exercise', 'Train', 'Exercise detail', 'Best and trend in the hero, then recent sessions. How-to is one row.')
def _():
    v = [74, 74.5, 75, 76, 75.5, 77, 78, 78, 79.5, 80, 82]
    h = hero('<div class="split"><div><span class="bignum ink">82</span> <span class="unit">kg est. max</span></div><span class="tag good">+4 kg in 4 weeks</span></div><div class="sp8"></div>'
             + chart(v, None, None, 354, 120, 'var(--cal)', [82, 74], ['Aug', 'Sep', 'Oct']), 'data-primary')
    rows = ''.join(row(d, s, None, chev=False) for d, s in [('Thu 1 Oct', '60 × 10, 10, 9, 9'), ('Thu 24 Sep', '57.5 × 10, 10, 10, 9'), ('Thu 17 Sep', '55 × 10, 10, 9, 8')])
    body = h + section('Recent', rows) + section('About', row('How to do it', 'Cues, set-up and common mistakes', 'help') + row('Swap for…', 'Leg press, belt squat, goblet squat', 'swap'))
    return sub('Hack squat', body, 'History')

@screen('train-block', 'Train', 'Block & schedule', 'One page for the block: weeks, the days you train, and every block-level action (was 8 screens).')
def _():
    weeks = '<div class="days" style="grid-template-columns:repeat(4,1fr)">' + ''.join(
        f'<button class="day {st}"><span>{n}</span><span class="pip" style="width:56px">{ic("check") if st == "done" else ""}</span></button>'
        for n, st in [('Wk 1', 'done'), ('Wk 2', 'next'), ('Wk 3', ''), ('Light', '')]) + '</div>'
    sch = ''.join(row(n, s, lead=f'<span class="sm b" style="width:40px;color:var(--ink-2)">{d}</span>', attrs='data-primary' if i == 0 else '') for i, (d, n, s) in enumerate(
        [('Mon', 'Upper A', '7 exercises · 64 min'), ('Tue', 'Lower A', '7 exercises · 70 min'), ('Thu', 'Upper B', '8 exercises · 68 min'), ('Fri', 'Lower B', '8 exercises · 76 min')]))
    more = (row('Muscle coverage', 'Sets per muscle this week', 'grid') + row('Change this block', 'Say what you want different', 'edit')
            + row('Start a new block', 'Ends this one after this week', 'plus') + row('Training settings', 'kg · rest 2:00 · reps in reserve', 'sliders'))
    body = '<div class="sm muted" style="margin-bottom:10px">Hypertrophy · 4 weeks · ends Sun 25 Oct</div>' + weeks + section('Schedule', sch, link='Move days') + section('Block', more)
    return sub('Summer growth block', body, 'Train', 'How it works', 'help')

@screen('train-new', 'Train', 'New block (flow)', 'Wizard, draft and builder become one short flow. Step 2 of 4 shown; answers are a ▶ menu.')
def _():
    opts = [('Build muscle', 'More sets, 6–15 reps'), ('Get stronger', 'Heavier, 3–6 reps'), ('Both', 'A mix, week to week'), ('General fitness', 'Fewer sets, more variety')]
    menu = '<div class="menu" data-primary style="border-top:2px solid var(--ink)">' + ''.join(f'<button class="{"sel" if i == 0 else ""}" style="min-height:56px">{t}<span class="sub">{s}</span></button>' for i, (t, s) in enumerate(opts)) + '</div>'
    body = '<div class="steps"><i class="on"></i><i class="on"></i><i></i><i></i></div><h1 style="font-size:24px;margin:18px 0 6px">What are you training for?</h1><p class="muted sm" style="margin-bottom:14px">You can change this later.</p>' + menu
    return sub('New block', body, 'Block', foot=btn('Next', 'a', w=True))

@screen('train-picker', 'Train', 'Exercise picker (sheet)', 'The library is a picker inside a session or the builder, not its own screen.')
def _():
    rows = ''.join(row(t, s, add=True) for t, s in [('Leg press', 'Machine · quads, glutes'), ('Belt squat', 'Machine · quads, glutes'), ('Goblet squat', 'Dumbbell · quads'), ('Bulgarian split squat', 'Dumbbells · quads, glutes'), ('Leg extension', 'Machine · quads')])
    body = (field('Search 400+ exercises', icon='search', focus=True) + '<div class="chips" style="margin-top:10px">' + chip('Quads', on=True) + chip('Glutes') + chip('Machines') + '</div>'
            + section('Swap hack squat for', rows, attrs='data-primary'))
    return sub('Lower B', '') + sheet('Swap exercise', body, tall=True)

@screen('train-empty', 'Empty & first run', 'Train · no block yet', 'One action: build a block. An empty session stays one tap away.')
def _():
    body = ('<div class="empty" data-primary><svg class="ico l" aria-hidden="true"><use href="#i-train"/></svg><h2>No block yet</h2>'
            '<p class="sm muted">Answer four questions and I’ll build your weeks.</p><div class="sp16"></div>' + btn('Build my block', 'a') + '</div>'
            + section('Or', row('Empty session', 'Log a workout as you go', 'plus') + row('Import a workout', 'From a link or a screenshot', 'link')))
    return root('train', body, 'Train')

# ============================================================== PROGRESS
WT = [85.3, 85.0, 85.1, 84.6, 84.8, 84.2, 84.4, 84.0, 83.9, 83.6, 83.8, 83.4, 83.3, 83.0]
TR = [85.2, 85.05, 84.9, 84.75, 84.6, 84.45, 84.3, 84.15, 84.0, 83.8, 83.65, 83.45, 83.25, 83.0]

def progress_page():
    h = hero('<div class="split"><span class="sm b" style="color:var(--good-ink)">Ahead of plan</span><span class="sm muted">trend</span></div>'
             '<div class="split" style="margin:4px 0 2px"><div><span class="bignum ink" style="font-size:40px">−0.8</span> <span class="unit">kg a week</span></div><span class="fig l">83.0</span></div>'
             '<div class="sm muted">Plan is −0.5 · 78.0 kg in about 6 weeks</div><div class="sp8"></div>'
             + seg(['1M', '3M', '6M', '1Y', 'All'], '3M') + '<div class="sp8"></div>' + chart(WT, TR, None, ylab=[85, 83], xlab=['Jul', 'Aug', 'Sep', 'Oct']), 'data-primary')
    plan = (row('Goal', 'Lose fat · 0.5 kg a week · to 78.0 kg', 'target') + row('Calories &amp; macros', '2,236 kcal · P131 C257 F70', 'flame')
            + row('Next check-in', 'Monday 12 Oct · in 4 days', 'calendar', '<span class="sm" style="color:var(--link);font-weight:600">Now</span>')
            + row('What’s coming up', 'Weekend in Lisbon · 23–25 Oct', 'star'))
    more = (row('Energy', 'You burn about 2,580 kcal a day', 'bolt') + row('Weekly shape', 'Even', 'grid') + row('Weigh-ins', '6 this week', 'scale') + row('Body fat', 'Add a reading with any weigh-in', 'drop'))
    return h + section('Your plan', plan) + section('More', more)

@screen('progress', 'Progress', 'Progress', 'The plan’s one home (MacroFactor’s Strategy). Hero = verdict + trend. Plan rows, then More.')
def _(): return root('progress', progress_page(), 'Progress')

@screen('checkin-1', 'Progress', 'Check-in · 1 your week', 'A short paged flow. A quiet week is this page and the last.')
def _():
    body = ('<div class="steps"><i class="on"></i><i></i><i></i></div><div class="sp16"></div>'
            + dialogue('You lost 0.8 kg this week. That’s a bit faster than the 0.5 we planned, which is fine for now.', None, mood='pleased', pose='talk', attrs='data-primary')
            + '<div class="sp16"></div><div class="kv"><div><div class="k">Days logged</div><div class="fig l">7/7</div></div><div><div class="k">Weigh-ins</div><div class="fig l">6</div></div><div><div class="k">Avg kcal</div><div class="fig l">2190</div></div></div>')
    return sub('Weekly check-in', body, 'Progress', foot=btn('Next', 'a', w=True))

@screen('checkin-2', 'Progress', 'Check-in · 2 the change', 'The one decision of the week, as a ▶ menu. Before → after in a plain table.')
def _():
    t = ''.join(f'<tr><td class="b">{k}</td><td class="muted">{a}</td><td><span class="fig">{b.split('|')[0]}</span> <span class="unit">{b.split('|')[1]}</span></td></tr>' for k, a, b in [('Calories', '2,236 kcal', '2,356|kcal'), ('Protein', '131 g', '131|g'), ('Carbs', '257 g', '280|g'), ('Fat', '70 g', '72|g')])
    body = ('<div class="steps"><i class="on"></i><i class="on"></i><i></i></div><div class="sp16"></div>'
            + dialogue('To keep your muscle I’d add 120 kcal a day, mostly carbs. Still 0.5 kg a week.', ['Sounds good', 'Keep my targets', 'Let me change them'], mood='thinking', pose='talk', emote='?', attrs='data-primary')
            + '<table class="table" style="margin-top:16px"><thead><tr><th></th><th>Now</th><th>From Monday</th></tr></thead><tbody>' + t + '</tbody></table>')
    return sub('Weekly check-in', body, 'Progress')

@screen('checkin-3', 'Progress', 'Check-in · 3 done', 'Done. The new number, said once.')
def _():
    body = ('<div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i></div><div class="sp16"></div>'
            + dialogue('Done! 2,356 kcal from Monday. See you next week.', None, mood='happy', pose='cheer', emote='♪', attrs='data-primary'))
    return sub('Weekly check-in', body, 'Progress', foot=btn('Back to Progress', 'a', w=True))

@screen('goal', 'Progress', 'Goal & strategy', 'Goal, pace, coaching and diet style on one page. Fresh start lives at its foot.')
def _():
    body = ('<div class="form" data-primary><div><label class="lbl">Goal</label>' + seg(['Lose fat', 'Maintain', 'Build'], 'Lose fat') + '</div>'
            + field(None, '78.0', label='Goal weight', unit='kg') + '<div><label class="lbl">Pace, kg a week</label>' + seg(['0.25', '0.5', '0.75'], '0.5') + '</div></div>'
            + '<p class="sm muted" style="margin-top:8px">0.5 kg a week: about 6 weeks to go.</p>'
            + section('Strategy', row('Coaching', 'I suggest, you approve', 'chat') + row('Diet style', 'Balanced', 'food') + row('Protein', '131 g · 1.6 g per kg', 'target'))
            + section('Check-ins', row('Check-in day', 'Monday', 'calendar') + row('Weigh-ins', 'Most mornings', 'scale'))
            + '<div class="sp24"></div>' + btn('Fresh start…', 't danger'))
    return sub('Goal &amp; strategy', body, 'Progress', foot=btn('Save', 'a', w=True))

@screen('targets', 'Progress', 'Calories & macros', 'Today’s target in the hero; each macro as a row with its share.')
def _():
    h = hero('<div><span class="bignum ink">2236</span> <span class="unit">kcal a day</span></div><div class="sm muted" style="margin-top:4px">Set by Macrosaurus · updated Mon 5 Oct</div>', 'data-primary')
    rows = (row('Protein', '23% of calories', None, '<span class="fig">131</span><span class="unit">g</span>', False, lead='<span class="lead" style="color:var(--pro-ink)">' + ic('target') + '</span>')
            + row('Carbs', '46% of calories', None, '<span class="fig">257</span><span class="unit">g</span>', False, lead='<span class="lead" style="color:var(--carb-ink)">' + ic('grid') + '</span>')
            + row('Fat', '28% of calories', None, '<span class="fig">70</span><span class="unit">g</span>', False, lead='<span class="lead" style="color:var(--fat-ink)">' + ic('drop') + '</span>'))
    body = h + section('Split', rows) + section('Change', row('Weekly shape', 'Even across the week', 'grid') + row('Set them myself', 'Turns off weekly changes', 'edit'))
    return sub('Calories &amp; macros', body, 'Progress')

@screen('energy', 'Progress', 'Energy', 'What you burn, worked out from what you eat and how your weight moves.')
def _():
    v = [2480, 2510, 2495, 2540, 2560, 2550, 2575, 2580]
    h = hero('<div><span class="bignum ink">2580</span> <span class="unit">kcal a day</span></div><div class="sm muted" style="margin:4px 0 8px">Up 100 since August</div>'
             + chart([x / 100 for x in v], None, None, 354, 120, 'var(--cal)', None, ['Aug', 'Sep', 'Oct']), 'data-primary')
    rows = ''.join(row(d, s, None, kcal(k), False) for d, s, k in [('This week', 'Ate 2,190 · lost 0.8 kg', 2580), ('Last week', 'Ate 2,240 · lost 0.6 kg', 2560), ('2 weeks ago', 'Ate 2,205 · lost 0.7 kg', 2575)])
    body = h + '<p class="sm muted" style="margin-top:12px">Worked out from what you log and your weight trend.</p>' + section('By week', rows)
    return sub('Energy', body, 'Progress')

@screen('shape', 'Progress', 'Weekly shape', 'Same weekly total, spread how you like.')
def _():
    dd = [('Mon', 2180), ('Tue', 2180), ('Wed', 2180), ('Thu', 2180), ('Fri', 2350), ('Sat', 2350), ('Sun', 2180)]
    rows = ''.join(f'<div class="row compact"><span class="sm b" style="width:40px">{d}</span><div class="grow">{hp(round(k / 25), "cal", 20, "thin", d)}</div><span class="fig" style="width:52px;text-align:right">{k}</span></div>' for d, k in dd)
    body = seg(['Even', 'Weekend', 'Training days'], 'Weekend', 'data-primary') + '<p class="sm muted" style="margin:10px 0 4px">Same 15,600 kcal a week. Fri and Sat get more.</p>' + rows
    return sub('Weekly shape', body, 'Progress', foot=btn('Save', 'a', w=True))

@screen('weighins', 'Progress', 'Weigh-ins', 'The log, newest first. Log weight in the bar.')
def _():
    rows = ''.join(row(d, f'Trend {t}', None, f'<span class="fig">{w}</span><span class="unit">kg</span>', True, attrs='data-primary' if i == 0 else '') for i, (d, w, t) in enumerate(
        [('Thu 8 Oct', '83.4', '83.0'), ('Wed 7 Oct', '83.6', '83.1'), ('Tue 6 Oct', '83.0', '83.2'), ('Mon 5 Oct', '83.8', '83.3'), ('Sun 4 Oct', '83.3', '83.4'), ('Sat 3 Oct', '83.9', '83.5')]))
    return sub('Weigh-ins', section('October', rows, meta='6 of 8 days'), 'Progress', 'Log weight', 'plus')

@screen('progress-empty', 'Empty & first run', 'Progress · first week', 'Before there’s a trend: what’s being learnt, and how far along.')
def _():
    h = hero('<div class="sm b" style="color:var(--link)">Still learning</div><div style="font-size:20px;font-weight:700;margin:4px 0 10px">Your first read is on Monday</div>'
             + hp(29, 'wt', 7, '', '2 of 7 days') + '<div class="sm muted" style="margin-top:8px">2 of 7 days logged · 1 weigh-in</div>', 'data-primary')
    plan = row('Goal', 'Lose fat · 0.5 kg a week · to 78.0 kg', 'target') + row('Calories &amp; macros', '2,236 kcal · P131 C257 F70', 'flame') + row('First check-in', 'Monday 12 Oct', 'calendar')
    return root('progress', h + section('Your plan', plan), 'Progress')

@screen('coming-up', 'Progress', 'What’s coming up', 'Holidays, events and rough weeks. The plan bends around them instead of marking you down.')
def _():
    rows = row('Weekend in Lisbon', 'Fri 23 – Sun 25 Oct · holding steady for that one', 'star', attrs='data-primary') + row('Work dinner', 'Thu 29 Oct · aiming at 2,600 kcal', 'food')
    body = section('Planned', rows) + section('Been and gone', row('Wedding', 'Sat 19 Sep · roughly stuck to it', 'check', chev=False))
    return sub('What’s coming up', body, 'Progress', foot=btn('Tell me what’s coming up', 'b', 'plus', w=True))
