"""Build every screen, paper and dark: python3 tools/build.py  ->  screens/<id>.html, screens/<id>-dark.html, screens.json"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from kit import doc
import screens_a
MODS = [screens_a]
for m in ['screens_b', 'screens_c']:
    try: MODS.append(__import__(m))
    except ModuleNotFoundError: pass
root = os.path.join(os.path.dirname(__file__), '..')
out = []
for m in MODS:
    for s in m.SCREENS:
        body = s['fn']()
        for th in ('paper', 'dark'):
            fn = s['id'] + ('-dark' if th == 'dark' else '') + '.html'
            open(os.path.join(root, 'screens', fn), 'w').write(doc(body, s['title'] + ' · Macrosaurus mockup', th))
        out.append({k: s[k] for k in ('id', 'group', 'title', 'note')})
json.dump(out, open(os.path.join(root, 'screens.json'), 'w'), indent=1)
print(len(out), 'screens')
