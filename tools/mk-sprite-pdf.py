#!/usr/bin/env python
"""Build a contact-sheet PDF of every Macrosaurus buddy sprite: one page per
palette+species variant, every animation strip broken into labelled frames."""
import os, io
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors

ROOT = 'sprites'
OUT = '/private/tmp/claude-501/-Users-oliverjohnson/96c497bd-1bff-4040-a577-d9e22accefaf/scratchpad/macrosaurus-sprites.pdf'
PAGE = landscape(A4)          # 842 x 595
W, H = PAGE

INK = colors.HexColor('#16161a')
MUTED = colors.HexColor('#6b6b76')
LINE = colors.HexColor('#d4d4dc')
CARD = colors.HexColor('#f2f2f4')
ACCENT = colors.HexColor('#3f7d3a')

SPECIES = [('doux','Doux'),('cole','Cole'),('kira','Kira'),('kuro','Kuro'),('loki','Loki'),
           ('mono','Mono'),('mort','Mort'),('nico','Nico'),('olaf','Olaf'),('sena','Sena'),
           ('tard','Taro'),('vita','Vita')]
ORDER = ['base/idle','base/move','base/dash','base/jump','base/scan','base/bite','base/kick',
         'base/avoid','base/hurt','base/dead','base/coma','egg/move','egg/crack','egg/hatch',
         'ghost/idle','ghost/move']
# where each strip is used in the app today
USE = {
 'base/idle':'IN USE - resting buddy everywhere (Today, Play, fight, celebrations)',
 'base/move':'IN USE - flourish when the day is part-logged',
 'base/dash':'IN USE - flourish on the first day back after a lapse',
 'base/jump':'IN USE - flourish when the day is closed; fight win',
 'base/scan':'IN USE - flourish when nothing is logged yet (the ask)',
 'base/bite':'IN USE - fight, buddy strikes',
 'base/kick':'UNUSED',
 'base/avoid':'UNUSED',
 'base/hurt':'IN USE - fight, buddy takes a hit',
 'base/dead':'IN USE - fight, buddy faints',
 'base/coma':'EXTRA - generated belly-up "food coma" pose (female/doux only, unused)',
 'egg/move':'IN USE - incubating egg, egg picker, hatch wobble',
 'egg/crack':'IN USE - hatch sequence, step 1',
 'egg/hatch':'IN USE - hatch sequence, step 2',
 'ghost/idle':'UNUSED',
 'ghost/move':'UNUSED',
}

def strips(pal, sp):
    out = []
    for key in ORDER:
        grp, name = key.split('/')
        p = f'{ROOT}/{pal}/{sp}/{grp}/{name}.png'
        if os.path.exists(p):
            im = Image.open(p).convert('RGBA')
            out.append((key, p, im))
    return out

def frame_reader(im, i, scale=12):
    """One 24x24 frame, nearest-neighbour scaled, on a light card so the pixels read."""
    f = im.crop((i*24, 0, (i+1)*24, 24)).resize((24*scale, 24*scale), Image.NEAREST)
    bg = Image.new('RGBA', f.size, (242, 242, 244, 255))
    bg.alpha_composite(f)
    buf = io.BytesIO(); bg.convert('RGB').save(buf, 'PNG'); buf.seek(0)
    return ImageReader(buf)

c = canvas.Canvas(OUT, pagesize=PAGE)
c.setTitle('Macrosaurus buddy sprites - full animation inventory')

def footer(label, n):
    c.setFont('Helvetica', 7.5); c.setFillColor(MUTED)
    c.drawString(30, 22, 'Macrosaurus buddy sprite pack  -  ' + label)
    c.drawRightString(W - 30, 22, str(n))

# ---------------- cover ----------------
page = 1
c.setFillColor(INK); c.setFont('Helvetica-Bold', 30)
c.drawString(50, H - 80, 'Macrosaurus buddy sprites')
c.setFont('Helvetica', 13); c.setFillColor(MUTED)
c.drawString(50, H - 104, 'Every dinosaur and every animation currently in the app - reference sheet for new animation work')
c.setStrokeColor(LINE); c.setLineWidth(1); c.line(50, H - 118, W - 50, H - 118)

hero = strips('female', 'olaf')
c.setFillColor(INK)
x = 50
for key, _, im in hero:
    if key in ('base/idle', 'base/move', 'base/scan', 'egg/move', 'ghost/idle'):
        c.drawImage(frame_reader(im, 0), x, H - 216, 74, 74, mask=None)
        c.setFont('Helvetica', 7.5); c.setFillColor(MUTED)
        c.drawString(x, H - 228, key)
        c.setFillColor(INK); x += 86

spec = [
 ('The format', [
   'Every strip is a horizontal PNG sprite sheet. Frame size is 24 x 24 pixels, so frameCount = imageWidth / 24.',
   'Frames run left to right with no padding, no margin, and a transparent background.',
   'Sprites sit on a shared baseline: a dinosaur leaves 3 empty pixel rows below its feet, an egg leaves 4.',
   'The app plays a strip with one CSS keyframe - translateX of the strip width, stepped into whole frames -',
   'so any new animation only has to match the 24 x 24 grid and the baseline to drop straight in.',
 ]),
 ('What exists today', [
   '12 species x 2 colourways (female, male) = 24 variants, 341 PNG files, ~1.4 MB total.',
   'Each complete variant ships 15 strips: 10 body (base), 3 egg, 2 ghost.',
   'The male colourway of Doux, Mort, Taro and Vita is missing idle, move, dash, hurt and kick,',
   'so those four are offered female-only in the app and cannot be recoloured.',
   'One extra strip exists outside the pack: female/doux base/coma, a generated belly-up pose, unused.',
 ]),
 ('How the app uses them', [
   'Resting: base/idle, at 5 fps, on every surface.',
   'Flourishes on Today, chosen by what the day looks like: scan (nothing logged), move (part-logged),',
   'jump (day closed), dash (first day back). One every 7-15 seconds, then straight back to idle.',
   'Fight: bite on strike, hurt when hit, dead on loss, jump on win - enemies use the same pack, hue-shifted.',
   'Egg: move while incubating, then crack then hatch as a one-shot sequence, then reveal on base/idle.',
   'Never used yet: ghost/idle, ghost/move, base/kick, base/avoid.',
 ]),
]
y = H - 262
for title, lines in spec:
    c.setFillColor(ACCENT); c.setFont('Helvetica-Bold', 10.5); c.drawString(50, y, title.upper())
    y -= 15
    c.setFillColor(INK); c.setFont('Helvetica', 9.5)
    for ln in lines:
        c.drawString(50, y, ln); y -= 12.5
    y -= 10
footer('cover', page); c.showPage(); page += 1

# ---------------- coverage matrix ----------------
c.setFillColor(INK); c.setFont('Helvetica-Bold', 20)
c.drawString(50, H - 60, 'Coverage matrix')
c.setFont('Helvetica', 10); c.setFillColor(MUTED)
c.drawString(50, H - 78, 'Filled = strip ships today.  Empty = missing.  Read down a column to see what a variant is short of.')

colx = 300
cw = (W - 80 - colx) / 24.0
rows = ORDER
rowh = 15.5
top = H - 120
# column headers
c.saveState(); c.setFont('Helvetica', 6.4); c.setFillColor(INK)
i = 0
for pal in ('female', 'male'):
    for sp, label in SPECIES:
        c.saveState(); c.translate(colx + i*cw + cw/2 + 2, top + 6); c.rotate(60)
        c.drawString(0, 0, f'{label[:4]} {pal[0].upper()}')
        c.restoreState(); i += 1
c.restoreState()

for r, key in enumerate(rows):
    y = top - r*rowh
    c.setFillColor(INK); c.setFont('Helvetica-Bold', 8.5); c.drawString(50, y, key)
    c.setFillColor(MUTED); c.setFont('Helvetica', 7)
    txt = USE[key]
    while c.stringWidth(txt, 'Helvetica', 7) > colx - 128: txt = txt[:-2]
    c.drawString(120, y, txt)
    i = 0
    for pal in ('female', 'male'):
        for sp, _ in SPECIES:
            grp, name = key.split('/')
            has = os.path.exists(f'{ROOT}/{pal}/{sp}/{grp}/{name}.png')
            c.setStrokeColor(LINE); c.setLineWidth(0.5)
            c.setFillColor(ACCENT if has else colors.white)
            c.rect(colx + i*cw, y - 2, cw - 2, 10, stroke=1, fill=1)
            i += 1
footer('coverage matrix', page); c.showPage(); page += 1

# ---------------- one page per variant ----------------
for pal in ('female', 'male'):
    for sp, label in SPECIES:
        items = strips(pal, sp)
        c.setFillColor(INK); c.setFont('Helvetica-Bold', 20)
        c.drawString(40, H - 52, f'{label}  -  {pal} colourway')
        c.setFont('Helvetica', 9); c.setFillColor(MUTED)
        c.drawString(40, H - 68, f'sprites/{pal}/{sp}/   -   {len(items)} animations   -   served at /sprites/{pal}/{sp}/<group>/<anim>.png')
        c.setStrokeColor(LINE); c.line(40, H - 78, W - 40, H - 78)

        percol, ncol = 6, 3
        colw = (W - 80) / float(ncol)
        for n, (key, path, im) in enumerate(items):
            col, row = n // percol, n % percol
            bx = 40 + col * colw
            by = H - 104 - row * 76
            frames = im.width // 24
            c.setFillColor(INK); c.setFont('Helvetica-Bold', 9)
            c.drawString(bx, by, key)
            c.setFillColor(MUTED); c.setFont('Helvetica', 7)
            c.drawString(bx + 62, by, f'{frames} frames')
            c.setFillColor(ACCENT if USE[key].startswith('IN USE') else MUTED)
            c.setFont('Helvetica', 6.4)
            c.drawRightString(bx + colw - 26, by, 'in use' if USE[key].startswith('IN USE') else USE[key].split(' ')[0].lower())
            for i in range(frames):
                fx = bx + i * 41
                c.setFillColor(CARD); c.setStrokeColor(LINE); c.setLineWidth(0.5)
                c.rect(fx, by - 52, 38, 38, stroke=1, fill=1)
                c.drawImage(frame_reader(im, i), fx, by - 52, 38, 38, mask=None)
                c.setFillColor(MUTED); c.setFont('Helvetica', 5.5)
                c.drawString(fx + 1, by - 60, str(i))
        footer(f'{label} / {pal}', page); c.showPage(); page += 1

c.save()
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB,', page - 1, 'pages')
