#!/usr/bin/env python3
"""Turn the published CoFID spreadsheet into the app's generic-foods table.

CoFID (McCance & Widdowson's Composition of Foods Integrated Dataset, OHID) is the
UK reference for UNPACKAGED food: "chicken breast, grilled", "potatoes, boiled".
Open Food Facts only knows packaged goods, so without this a search for anything
cooked at home has no right answer at all.

Usage:  python3 tools/build-generic-foods.py [path/to/cofid.xlsx]
        (downloads the published file if no path is given)
Writes: foods-uk.json at the repo root.

Every value is per 100 g, matching the per100 basis the confirm screen already uses.
Rows are arrays rather than objects purely for size: the table ships to every user.
"""
import io
import json
import os
import sys
import urllib.request
import zipfile
from xml.etree.ElementTree import iterparse

COFID_URL = ('https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/'
             'McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx')
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'foods-uk.json')

# Proximates sheet. Everything except sodium lives here.
PROX = {'name': 'B', 'group': 'D', 'protein': 'J', 'fat': 'K', 'carbs': 'L',
        'kcal': 'M', 'sugars': 'Q', 'fiber': 'Z', 'satfat': 'AB'}
SODIUM_COL = 'H'  # Inorganics sheet, mg per 100 g


def col(ref):
    """'AB12' -> 'AB'"""
    out = ''
    for ch in ref:
        if ch.isdigit():
            break
        out += ch
    return out


def shared_strings(z):
    out = []
    for _, el in iterparse(io.BytesIO(z.read('xl/sharedStrings.xml'))):
        if el.tag == NS + 'si':
            out.append(''.join(t.text or '' for t in el.iter(NS + 't')))
            el.clear()
    return out


def sheet_rows(z, path, strings):
    """Yield {column letter: cell text} for each row, data rows only (row 4 on)."""
    for _, el in iterparse(io.BytesIO(z.read(path))):
        if el.tag != NS + 'row':
            continue
        n = int(el.get('r') or 0)
        if n >= 4:
            row = {}
            for c in el.iter(NS + 'c'):
                v = c.find(NS + 'v')
                if v is None or v.text is None:
                    continue
                row[col(c.get('r'))] = strings[int(v.text)] if c.get('t') == 's' else v.text
            if row:
                yield n, row
        el.clear()


def num(raw):
    """CoFID marks trace amounts 'Tr' and unmeasured values 'N'. A trace really is
    about zero; 'N' means nobody looked, which is not the same as none, so it stays
    None and the app treats the food as unscored rather than inventing a virtuous 0."""
    if raw is None:
        return None
    s = str(raw).strip()
    if s == '' or s.upper() in ('N', 'N/A'):
        return None
    if s.upper().startswith('TR'):
        return 0.0
    s = s.lstrip('<~').strip()
    try:
        return float(s)
    except ValueError:
        return None


def r(x, dp=1):
    return None if x is None else round(x, dp)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if src:
        data = open(src, 'rb').read()
    else:
        print('downloading CoFID from gov.uk...')
        req = urllib.request.Request(COFID_URL, headers={'User-Agent': 'macrosaurus-build/1.0'})
        data = urllib.request.urlopen(req, timeout=180).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    strings = shared_strings(z)

    sodium = {}
    for n, row in sheet_rows(z, 'xl/worksheets/sheet5.xml', strings):
        sodium[n] = num(row.get(SODIUM_COL))

    foods, skipped = [], 0
    for n, row in sheet_rows(z, 'xl/worksheets/sheet4.xml', strings):
        name = (row.get(PROX['name']) or '').strip()
        kcal = num(row.get(PROX['kcal']))
        if not name or kcal is None:
            skipped += 1
            continue
        na = sodium.get(n)
        # Salt equivalent, the figure on every UK label: sodium (mg) x 2.5 / 1000.
        salt = None if na is None else na * 2.5 / 1000.0
        foods.append([
            name,
            round(kcal),
            r(num(row.get(PROX['protein']))),
            r(num(row.get(PROX['carbs']))),
            r(num(row.get(PROX['fat']))),
            r(num(row.get(PROX['fiber']))),
            r(num(row.get(PROX['satfat']))),
            r(num(row.get(PROX['sugars']))),
            r(salt, 2),
            (row.get(PROX['group']) or '').strip(),
        ])

    foods.sort(key=lambda f: f[0].lower())
    payload = {
        'source': 'CoFID 2021 (McCance & Widdowson), Office for Health Improvement and Disparities',
        'licence': 'Open Government Licence v3.0',
        'basis': 'per 100 g',
        'fields': ['name', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'satfat', 'sugars', 'salt', 'group'],
        'foods': foods,
    }
    with open(OUT, 'w') as fh:
        json.dump(payload, fh, separators=(',', ':'), ensure_ascii=False)
    scored = sum(1 for f in foods if f[5] is not None and f[6] is not None and f[7] is not None and f[8] is not None)
    print('wrote %s: %d foods (%d fully scoreable), %d skipped, %.0f KB'
          % (os.path.relpath(OUT, ROOT), len(foods), scored, skipped, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
