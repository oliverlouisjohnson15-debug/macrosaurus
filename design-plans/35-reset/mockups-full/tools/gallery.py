"""screens.json + metrics.json -> index.html, the gallery. python3 tools/gallery.py"""
import json, os, html
R = os.path.join(os.path.dirname(__file__), '..')
S = json.load(open(f'{R}/screens.json')); M = json.load(open(f'{R}/metrics.json'))
esc = html.escape
ORDER = ['Today', 'Log (+)', 'Food', 'Food · Cook', 'Train', 'Progress', 'You', 'Play', 'Onboarding', 'Empty & first run']
groups = {g: [s for s in S if s['group'] == g] for g in ORDER}
slug = lambda g: g.lower().replace(' · ', '-').replace(' & ', '-').replace(' (+)', '').replace(' ', '-')

SITEMAP = [
    ('Today', 'tab', ['today', 'today-checkin', 'today-day', 'weigh', 'recovery', 'talk']),
    ('+ Log', 'sheet', ['log', 'log-search', 'log-barcode', 'log-quick', 'log-estimate', 'log-drink', 'food-detail', 'edit-entry']),
    ('Food', 'tab', ['food', 'food-meal', 'cook', 'recipe', 'recipe-build', 'recipe-import', 'meal-plan', 'shopping', 'discover', 'fridge']),
    ('Train', 'tab', ['train', 'train-session', 'train-live', 'train-done', 'train-history', 'train-lifts', 'train-detail', 'train-exercise', 'train-block', 'train-new', 'train-picker']),
    ('Progress', 'tab', ['progress', 'checkin-1', 'checkin-2', 'checkin-3', 'goal', 'targets', 'coming-up', 'energy', 'shape', 'weighins']),
    ('You', 'gear', ['you', 'you-account', 'premium', 'you-body', 'you-meals', 'you-reminders', 'you-apps', 'you-appearance']),
    ('Play', 'Chompers', ['play', 'play-battle', 'play-shop', 'play-trophies', 'play-dressup', 'milestone', 'hatch']),
    ('Empty states', 'first run', ['today-first', 'log-empty', 'food-empty', 'cook-empty', 'train-empty', 'progress-empty']),
    ('Onboarding', 'first run', ['ob-signin', 'ob-hello', 'ob-egg', 'ob-about', 'ob-active', 'ob-goal', 'ob-plan', 'ob-ready']),
]
byid = {s['id']: s for s in S}

def short(t):
    return t.replace(' (sheet)', '').replace('Check-in · ', 'Check-in ')

sitemap = ''.join(
    f'<div class="sm-col"><div class="sm-h"><b>{esc(n)}</b><span>{esc(k)}</span></div><ol>'
    + ''.join(f'<li><a href="#{i}">{esc(short(byid[i]["title"]))}</a></li>' for i in ids) + '</ol></div>'
    for n, k, ids in SITEMAP)

rows = ''
names = {'today': 'Today', 'food': 'Food · Diary', 'cook': 'Food · Cook', 'train': 'Train', 'progress': 'Progress', 'you': 'You', 'play': 'Play', 'log': 'Log sheet'}
for b, m, x, y in M['pairs']:
    rows += (f'<tr><th scope="row">{names[b]}</th><td>{x["primaryY"]}<i>→</i><b>{y["primaryY"]}</b></td><td>{x["blocks"]}<i>→</i><b>{y["blocks"]}</b></td>'
             f'<td>{x["controls"]}<i>→</i><b>{y["controls"]}</b></td><td>{len(x["help"])}<i>→</i><b>{len(y["help"])}</b></td>'
             f'<td>{len(x["tiny"])}<i>→</i><b>{len(y["tiny"])}</b></td><td>{len(x["small"])}<i>→</i><b>{len(y["small"])}</b></td></tr>')

cards = ''
for g in ORDER:
    cards += f'<section class="grp" id="g-{slug(g)}"><h2>{esc(g)} <span>{len(groups[g])}</span></h2><div class="cards">'
    for s in groups[g]:
        cards += (f'<article class="card" id="{s["id"]}"><div class="dev"><iframe data-id="{s["id"]}" src="screens/{s["id"]}.html" title="{esc(s["title"])}" loading="lazy" tabindex="-1"></iframe></div>'
                  f'<h3>{esc(s["title"])}</h3><p>{esc(s["note"])}</p><a class="open" data-id="{s["id"]}" href="screens/{s["id"]}.html" target="_blank" rel="noopener">Open at 390×844</a></article>')
    cards += '</div></section>'

nav = ''.join(f'<a href="#g-{slug(g)}">{esc(g)}</a>' for g in ORDER)
n = len(S)
page = f'''<meta charset="utf-8">
<title>Macrosaurus Reset Mockup</title>
<style>
/* Layout: a long gallery. Sitemap and numbers first, then every screen as a live 390x844 frame, grouped by tab. */
@font-face {{ font-family: 'Plex'; src: url(assets/ibm-plex-sans-latin-400-normal.woff2) format('woff2'); font-weight: 400; }}
@font-face {{ font-family: 'Plex'; src: url(assets/ibm-plex-sans-latin-600-normal.woff2) format('woff2'); font-weight: 600; }}
@font-face {{ font-family: 'Plex'; src: url(assets/ibm-plex-sans-latin-700-normal.woff2) format('woff2'); font-weight: 700; }}
@font-face {{ font-family: 'Pixel'; src: url(assets/silkscreen-latin-400-normal.woff2) format('woff2'); }}
:root {{ --page: #f6efe0; --card: #fffdf7; --ink: #241f2e; --muted: #6b6459; --line: rgba(36,31,46,.16); --bar: #5B4FA6; --bar-text: #fffdf7; --bar-on: #FFD05E;
  --link: #4c4196; --good: #1F6153; --seg-on: #241f2e; --seg-on-text: #fffdf7; --frame: #241f2e;
  --ui: 'Plex', system-ui, -apple-system, 'Segoe UI', sans-serif; --num: 'Pixel', ui-monospace, monospace; --s: .5; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --page: #050507; --card: #0c0c11; --ink: #e8e8ea; --muted: #8b8b98; --line: rgba(232,232,234,.14); --bar: #000; --bar-text: #3DFF62; --bar-on: #3DFF62;
  --link: #3DFF62; --good: #3DFF62; --seg-on: #3DFF62; --seg-on-text: #06120a; --frame: #3a3a48; color-scheme: dark; }} }}
:root[data-theme="dark"] {{ --page: #050507; --card: #0c0c11; --ink: #e8e8ea; --muted: #8b8b98; --line: rgba(232,232,234,.14); --bar: #000; --bar-text: #3DFF62; --bar-on: #3DFF62;
  --link: #3DFF62; --good: #3DFF62; --seg-on: #3DFF62; --seg-on-text: #06120a; --frame: #3a3a48; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--page); color: var(--ink); font: 400 15px/1.5 var(--ui); }}
a {{ color: var(--link); }}
a:focus-visible, button:focus-visible {{ outline: 3px solid var(--link); outline-offset: 2px; }}
.top {{ position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bar); color: var(--bar-text); }}
.top .in {{ max-width: 1240px; margin: 0 auto; padding: 8px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }}
.top img {{ width: 32px; height: 32px; image-rendering: pixelated; }}
.top .nm {{ font: 400 15px var(--num); letter-spacing: .02em; }}
.top nav {{ display: flex; gap: 2px; flex-wrap: wrap; flex: 1; min-width: 0; }}
.top nav a {{ color: var(--bar-text); text-decoration: none; font-size: 13px; font-weight: 600; padding: 12px 8px; }}
.seg {{ display: flex; background: var(--card); padding: 3px; gap: 3px; box-shadow: 0 -2px 0 var(--frame), 0 2px 0 var(--frame), -2px 0 0 var(--frame), 2px 0 0 var(--frame); margin: 2px; }}
.seg button {{ font: 600 13px var(--ui); border: 0; background: none; color: var(--muted); min-height: 40px; padding: 0 14px; cursor: pointer; }}
.seg button[aria-pressed="true"] {{ background: var(--seg-on); color: var(--seg-on-text); }}
main {{ max-width: 1240px; margin: 0 auto; padding-inline: 16px; padding-block: 24px 64px; }}
h1 {{ font-size: clamp(24px, 4vw, 34px); line-height: 1.15; margin: 0 0 8px; text-wrap: balance; }}
.lede {{ max-width: 68ch; color: var(--muted); margin: 0 0 8px; }}
h2 {{ font-size: 20px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--ink); display: flex; align-items: baseline; gap: 10px; }}
h2 span {{ font: 400 14px var(--num); color: var(--muted); }}
.sitemap {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px 20px; }}
.sm-h {{ display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 4px; }}
.sm-h span {{ font-size: 12px; color: var(--muted); }}
.sitemap ol {{ margin: 0; padding: 0; list-style: none; }}
.sitemap li a {{ display: block; padding: 4px 0; font-size: 13px; text-decoration: none; }}
.sitemap li a:hover {{ text-decoration: underline; }}
.chrome {{ font-size: 13px; color: var(--muted); margin: 0 0 14px; }}
.facts {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 8px; }}
.fact {{ background: var(--card); padding: 14px 16px; box-shadow: 0 -2px 0 var(--frame), 0 2px 0 var(--frame), -2px 0 0 var(--frame), 2px 0 0 var(--frame); margin: 2px; }}
.fact b.n {{ font: 400 26px var(--num); display: block; color: var(--good); }}
.fact p {{ margin: 4px 0 0; font-size: 13px; color: var(--muted); }}
.tbl {{ overflow-x: auto; margin-top: 12px; }}
table {{ border-collapse: collapse; min-width: 640px; width: 100%; font-variant-numeric: tabular-nums; font-size: 14px; }}
th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }}
thead th {{ font-size: 12px; color: var(--muted); font-weight: 600; }}
td i {{ font-style: normal; color: var(--muted); padding: 0 6px; }}
td b {{ color: var(--good); }}
.note {{ font-size: 13px; color: var(--muted); max-width: 80ch; }}
.cards {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(390px * var(--s) + 8px), 1fr)); gap: 28px 20px; }}
.card {{ min-width: 0; scroll-margin-top: 80px; }}
.dev {{ width: calc(390px * var(--s) + 6px); height: calc(844px * var(--s) + 6px); padding: 3px; background: var(--frame); overflow: hidden; max-width: 100%; }}
.dev iframe {{ width: 390px; height: 844px; border: 0; transform: scale(var(--s)); transform-origin: 0 0; display: block; background: var(--page); }}
.card h3 {{ font-size: 15px; margin: 10px 0 2px; }}
.card p {{ font-size: 13px; color: var(--muted); margin: 0 0 4px; }}
.card .open {{ font-size: 13px; font-weight: 600; display: inline-block; padding: 8px 0; }}
@media (max-width: 520px) {{ :root {{ --s: .4; }} .cards {{ gap: 20px 12px; }} .top nav {{ order: 3; flex-basis: 100%; }} }}
@media (prefers-reduced-motion: reduce) {{ html {{ scroll-behavior: auto; }} }}
</style>
<header class="top"><div class="in"><img src="assets/egg-logo.png" alt=""><span class="nm">MACROSAURUS</span>
<nav aria-label="Screen groups">{nav}</nav>
<div class="seg" role="group" aria-label="Theme"><button id="t-paper" type="button" aria-pressed="true">Paper</button><button id="t-dark" type="button" aria-pressed="false">Dark</button></div></div></header>
<main>
<h1>The reset, every screen</h1>
<p class="lede">{n} screens of the overhauled app, in one direction, built from one shared stylesheet and one set of primitives. Each frame is the live 390×844 screen: Chompers walks, the egg wobbles, the dialogue blinks. Switch Paper and Dark above.</p>

<h2 id="sitemap">New sitemap <span>5 tabs · 4 places in Train</span></h2>
<p class="chrome">Top bar on every tab: the egg logo, the context, Chompers walking (tap for Play), the gear (You). Tabs: Today · Food · <b>+</b> · Train · Progress.</p>
<div class="sitemap">{sitemap}</div>

<h2 id="numbers">Checks and numbers <span>{M["runs"]} runs</span></h2>
<div class="facts">
<div class="fact"><b class="n">{M["bad"]}</b>failing runs<p>{n} screens × paper, dark × 390×844, 320×640. No horizontal scroll, no text under 11px, no target under 44px, no contrast failure, no text in a fill colour, no card in a card.</p></div>
<div class="fact"><b class="n">1 rule</b>left in Impeccable detect<p>cream-palette, on the paper page the brief asks for. No stripes, offset shadows, glows, eyebrows or sub-11px type.</p></div>
<div class="fact"><b class="n">17 → 4</b>places in Train<p>Home, Session, History, Block, plus one New block flow and an exercise picker sheet.</p></div>
<div class="fact"><b class="n">2 · 3 · 4 · 4</b>logging actions<p>Recent, search, barcode, quick add. Was 2 · 4 · 5 · 5. Three searched foods: 12 → 7.</p></div>
</div>
<div class="tbl"><table><thead><tr><th>Current app → mockup (390×844, paper)</th><th>Primary content y</th><th>Blocks</th><th>Controls</th><th>Help sentences</th><th>Targets under 44px</th><th>Text under 11px</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="note">Same Playwright collector on both sides. Primary y is CSS px from the top of the page (from the top of the sheet for the log sheet). Blocks are framed or filled surfaces at least 120×36 (controls and art excluded). Controls exclude the top bar and tab bar. The current app is main at bcf019b in ?demo. Its log sheet showed no recents, so the new sheet's four recent rows (8 targets) account for its higher control count.</p>
{cards}
</main>
<script>
(function () {{
  var root = document.documentElement, mq = window.matchMedia('(prefers-color-scheme: dark)');
  function current() {{ var t = root.getAttribute('data-theme'); return t ? t : (mq.matches ? 'dark' : 'light'); }}
  function apply() {{
    var dark = current() === 'dark';
    document.getElementById('t-paper').setAttribute('aria-pressed', String(!dark));
    document.getElementById('t-dark').setAttribute('aria-pressed', String(dark));
    document.querySelectorAll('iframe[data-id]').forEach(function (f) {{ var src = 'screens/' + f.dataset.id + (dark ? '-dark' : '') + '.html'; if (f.getAttribute('src') !== src) f.setAttribute('src', src); }});
    document.querySelectorAll('a.open').forEach(function (a) {{ a.href = 'screens/' + a.dataset.id + (dark ? '-dark' : '') + '.html'; }});
  }}
  function set(t) {{ root.setAttribute('data-theme', t); try {{ localStorage.setItem('mx-theme', t); }} catch (e) {{}} apply(); }}
  document.getElementById('t-paper').addEventListener('click', function () {{ set('light'); }});
  document.getElementById('t-dark').addEventListener('click', function () {{ set('dark'); }});
  try {{ var saved = localStorage.getItem('mx-theme'); if (saved) root.setAttribute('data-theme', saved); }} catch (e) {{}}
  if (mq.addEventListener) mq.addEventListener('change', apply);
  apply();
}})();
</script>
'''
open(f'{R}/index.html', 'w').write(page)
print('gallery:', n, 'screens')
