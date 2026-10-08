"""The mockup kit: the same primitives the app will get, as HTML-emitting functions.

Every screen in screens.py is built only from these, so the set stays one system. Names map to the
React primitives in 01-direction.md / DESIGN.md (AppBar, TabBar, Win, Hero, HP, Row, Section,
Dialogue, Sheet, Seg, Chip, Btn, Field).
"""
import html, re
from icons import I

esc = html.escape

# ---------------------------------------------------------------- icons
def _path(rows):
    d = []
    for y, r in enumerate(rows):
        x = 0
        while x < 12:
            if r[x] == '#':
                s = x
                while x < 12 and r[x] == '#': x += 1
                d.append(f'M{s} {y}h{x - s}v1h-{x - s}z')
            else:
                x += 1
    return ''.join(d)

SYMBOLS = {n: f'<symbol id="i-{n}" viewBox="0 0 12 12"><path d="{_path(r)}"/></symbol>' for n, r in I.items()}

def ic(name, cls='', label=None):
    assert name in I, name
    a = f' role="img" aria-label="{esc(label)}"' if label else ' aria-hidden="true"'
    return f'<svg class="ico {cls}"{a}><use href="#i-{name}"/></svg>'

# ---------------------------------------------------------------- pixel marks
CUR = '<svg class="cur" viewBox="0 0 4 7" aria-hidden="true"><path d="M0 0h1v1h1v1h1v1h1v1H3v1H2v1H1v1H0z"/></svg>'
CUR_SP = '<svg class="cur sp" viewBox="0 0 4 7" aria-hidden="true"></svg>'
# the speech tail: a stepped triangle, 2px cells; its last row sits on the box's top ring and the inner fill erases it
TAIL = ('<svg class="tail" viewBox="0 0 12 7" aria-hidden="true"><path class="o" d="M5 0h2v1h1v1h1v1h1v1h1v1h1v2H0V5h1V4h1V3h1V2h1V1h1z"/>'
        '<path class="i" d="M5 2h2v1h1v1h1v1h1v2H2V5h1V4h1V3h1z"/></svg>')
ADV = '<svg class="adv blink" viewBox="0 0 5 3" aria-hidden="true"><path d="M0 0h5v1H4v1H3v1H2V2H1V1H0z"/></svg>'
DUNE = '<svg class="dune" style="{}" viewBox="0 0 16 3" preserveAspectRatio="none" aria-hidden="true"><path fill="currentColor" d="M5 0h6v1h2v1h3v1H0V2h3V1h2z"/></svg>'

import re as _re
def menus(html_):
    """Every button in a .menu gets the cursor column: the selected one shows the ▶."""
    def fix(m):
        inner = _re.sub(r'(<button[^>]*class="[^"]*\bsel\b[^"]*"[^>]*>)', lambda b: b.group(1) + CUR, m.group(2))
        inner = _re.sub(r'(<button(?![^>]*\bsel\b)[^>]*>)', lambda b: b.group(1) + CUR_SP, inner)
        return m.group(1) + inner
    return _re.sub(r'(<div class="menu"[^>]*>)(.*?</div>)', fix, html_, flags=_re.S)

# ---------------------------------------------------------------- chrome
DATE = 'Thu 8 Oct'

def appbar_root(ctx=DATE, walker='dino'):
    w = ('<div class="walker"><i></i><button aria-label="Chompers. Open Play"></button></div>' if walker == 'dino'
         else '<div class="walker egg"><i></i><button aria-label="Your egg. Open Play"></button></div>')
    return (f'<header class="appbar"><button class="logo" aria-label="Macrosaurus, go to Today"><img src="../assets/egg-logo.png" alt=""></button>'
            f'<div class="ctx">{esc(ctx)}</div><div class="lane">{w}</div>'
            f'<button class="gear" aria-label="You and settings">{ic("gear")}</button></header>')

def appbar_sub(title, back='Back', act=None, act_icon=None):
    a = ''
    if act_icon: a = f'<button class="act" aria-label="{esc(act)}">{ic(act_icon)}</button>'
    elif act: a = f'<button class="act txt">{esc(act)}</button>'
    return (f'<header class="appbar"><button class="back" aria-label="Back to {esc(back)}">{ic("back")}</button>'
            f'<div class="title">{title}</div>{a}</header>')

TABS = [('today', 'Today', 'today'), ('food', 'Food', 'food'), None, ('train', 'Train', 'train'), ('progress', 'Progress', 'progress')]

def tabbar(on):
    out = []
    for t in TABS:
        if t is None:
            out.append(f'<button class="fab" aria-label="Log food">{ic("plus")}</button>'); continue
        k, l, i = t
        out.append(f'<button class="tab{" on" if k == on else ""}"{" aria-current=page" if k == on else ""}>{ic(i)}<span>{CUR if k == on else ""}{l}</span></button>')
    return '<nav class="tabbar">' + ''.join(out) + '</nav>'

# ---------------------------------------------------------------- blocks
def win(body, cls='', attrs=''):
    return f'<div class="win {cls}" {attrs}>{body}</div>'

def hero(body, attrs='', cls=''):
    return f'<section class="win hero {cls}" {attrs}>{body}</section>'

def hp(pct, kind='cal', cells=20, cls='', label='', marker=None):
    """HP meter: real cells, filled to the nearest cell (a partly eaten cell counts as filled once it is half full)."""
    on = round(pct / 100 * cells)
    return (f'<div class="hp {kind} {cls}" style="--n:{cells}" role="img" aria-label="{esc(label or str(pct) + "%")}">'
            + '<i class="on"></i>' * on + '<i></i>' * (cells - on) + '</div>')

def macro(kind, name, val, unit, pct, sub='left'):
    return (f'<div class="macro"><div class="k {kind}">{name}</div><div class="v"><span class="fig">{val}</span>'
            f'<span class="unit">{unit} {sub}</span></div>{hp(pct, kind, 10, "thin", name + " " + str(pct) + "% eaten")}</div>')

def section(title, body, meta=None, link=None, attrs=''):
    r = ''
    if link: r = f'<a class="link" href="#">{esc(link)}</a>'
    elif meta: r = f'<span class="meta">{meta}</span>'
    return f'<section class="sec" {attrs}><div class="sec-h"><h2>{title}</h2>{r}</div>{body}</section>'

def row(title, sub=None, icon=None, end=None, chev=True, attrs='', cls='', tag='button', add=False, lead=None):
    l = lead if lead is not None else (f'<span class="lead">{ic(icon)}</span>' if icon else '')
    s = f'<div class="s">{sub}</div>' if sub else ''
    e = ''
    if end is not None or chev or add:
        e = '<div class="end">' + (end or '') + (ic('chevron', 'chev') if chev and not add else '') + '</div>'
    a = f'<button class="addbtn" aria-label="Add {esc(re.sub("<[^>]+>", "", title))}"><span class="box">{ic("plus")}</span></button>' if add else ''
    if add:
        return f'<div class="row {cls}" {attrs}>{l}<button class="grow" style="text-align:left;min-height:44px"><div class="t">{title}</div>{s}</button>{e}{a}</div>'
    return f'<{tag} class="row {cls}" {attrs}>{l}<div class="grow"><div class="t">{title}</div>{s}</div>{e}</{tag}>'

def seg(opts, on, attrs=''):
    return f'<div class="seg" role="tablist" {attrs}>' + ''.join(
        f'<button role="tab" class="{"on" if o == on else ""}" aria-selected="{str(o == on).lower()}">{esc(o)}</button>' for o in opts) + '</div>'

def chip(label, icon=None, on=False):
    return f'<button class="chip{" on" if on else ""}">{ic(icon) if icon else ""}{esc(label)}</button>'

def btn(label, kind='a', icon=None, w=False, attrs=''):
    return f'<button class="btn {kind}{" w" if w else ""}" {attrs}>{ic(icon) if icon else ""}{esc(label)}</button>'

def field(ph=None, val=None, icon=None, inbtn=None, focus=False, label=None, unit=None, attrs=''):
    lab = f'<label class="lbl">{esc(label)}</label>' if label else ''
    i = ic(icon) if icon else ''
    v = f'<span class="val">{val}{"<span class=caret></span>" if focus else ""}</span>' if val is not None else f'<span class="ph">{"<span class=caret></span>" if focus else ""}{esc(ph or "")}</span>'
    u = f'<span class="unit" style="padding-right:10px">{esc(unit)}</span>' if unit else ''
    b = ''.join(f'<button class="in-btn" aria-label="{esc(l)}">{ic(n)}</button>' for n, l in (inbtn or []))
    return f'<div {attrs}>{lab}<div class="field{" focus" if focus else ""}" role="textbox" tabindex="0" aria-label="{esc(label or ph or "")}">{i}{v}{u}{b}</div></div>'

def mm(p, c, f):
    return f'<span class="mm"><b class="p">P{p}</b> · <b class="c">C{c}</b> · <b class="f">F{f}</b></span>'

def kcal(n):
    return f'<span class="fig">{n}</span><span class="unit">kcal</span>'

# ---------------------------------------------------------------- the buddy
def dialogue(text, options=None, name='Chompers', mood=None, emote='!', pose='idle', sel=0, attrs='', who_cls=None):
    em = f'<div class="emote bob" aria-hidden="true">{esc(emote)}</div>' if emote else ''
    mood_html = f'<em>{esc(mood)}</em>' if mood else ''
    menu = ''
    if options:
        menu = '<div class="menu" role="menu">' + ''.join(
            f'<button role="menuitem" class="{"sel" if i == sel else ""}">{o if isinstance(o, str) else o[0]}'
            f'{"" if isinstance(o, str) else "<span class=sub>" + o[1] + "</span>"}</button>' for i, o in enumerate(options)) + '</div>'
    adv = '' if options else ADV
    scene = ('<div class="scene" aria-hidden="true">' + DUNE.format('left:150px') + DUNE.format('left:250px;width:90px') +
             f'<svg class="cactus" style="left:218px" viewBox="0 0 6 11"><path fill="currentColor" d="M2 0h2v11H2zM0 3h1v4h1v1H0zM5 2h1v4H4V5h1z"/></svg>'
             '<svg class="ground" aria-hidden="true"><defs><pattern id="dash" width="12" height="2" patternUnits="userSpaceOnUse"><rect width="8" height="2" fill="currentColor"/></pattern></defs><rect width="100%" height="2" fill="url(#dash)"/></svg>'
             f'<div class="who {who_cls or pose}"></div>{em}</div>')
    return (f'<section class="dlg" {attrs}>{scene}<div class="win dbox">{TAIL}<div class="name">{esc(name)}{mood_html}</div>'
            f'<p data-buddy>{text}</p>{menu}{adv}</div></section>')

def mini(text, pose='idle', name='Chompers'):
    return (f'<div class="mini-dlg"><div class="who-s {pose}" aria-hidden="true"></div><div class="win dbox">{TAIL}<div class="name">{esc(name)}</div>'
            f'<p data-buddy class="sm">{text}</p></div></div>')

# ---------------------------------------------------------------- pages
def sheet(title, body, foot=None, tall=False, x=True, head_extra='', attrs=''):
    f = f'<div class="sfoot">{foot}</div>' if foot else ''
    xb = f'<button class="x" aria-label="Close">{ic("close")}</button>' if x else ''
    return (f'<div class="scrim"></div><div class="sheet{" tall" if tall else ""}" role="dialog" aria-label="{esc(re.sub("<[^>]+>", "", title))}" {attrs}>'
            f'<div class="grab"></div><div class="sh"><h1>{title}</h1>{head_extra}{xb}</div><div class="body">{body}</div>{f}</div>')

def doc(body, title, theme):
    body = menus(body)
    used = sorted(set(re.findall(r'#i-([a-z_]+)', body)))
    syms = ''.join(SYMBOLS[n] for n in used)
    cls = ' class="theme-dark"' if theme == 'dark' else ''
    return (f'<!doctype html><html lang="en-GB"{cls}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{esc(title)}</title><link rel="stylesheet" href="../system.css"></head><body>'
            f'<svg width="0" height="0" style="position:absolute" aria-hidden="true">{syms}</svg>{body}</body></html>')
