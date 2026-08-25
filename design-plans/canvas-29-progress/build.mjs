/* Builds the .dc.html artboards for the Progress-on-Today canvas.
   Every colour is a literal lifted from app/src/styles.css (artboards cannot see the app's
   CSS variables), and every icon is the app's own 24x24 pixel glyph, extracted from
   PX_ICONS in app/src/app.jsx into icons.json. Re-run: node build.mjs */
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const ICONS = JSON.parse(fs.readFileSync(path.join(here, 'icons.json'), 'utf8'));

const ic = (name, size, color) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" shape-rendering="crispEdges" style="display:block;flex-shrink:0;">${ICONS[name]}</svg>`;

/* ---- the two palettes, verbatim from styles.css ---- */
const P = { // :root / .theme-light  -- paper terrarium
  bg:'#e7e3da', card:'#fffdf7', surface2:'#f8f4e8', track:'#ece7dc', border:'#241f2e',
  header:'#5B4FA6', headerText:'#fffdf7', text:'#241f2e', muted:'#6b6459', accent:'#F0B429',
  onAccent:'#241f2e', accentInk:'#8A6100', good:'#2E7D6B', goodInk:'#1F6153', fatInk:'#8A6100',
  dangerInk:'#A93826', cardheadBg:'#241f2e', cardheadText:'#f4f1ea', navOff:'#ddd7f2',
  onHeaderAccent:'#FFD05E', weight:'#5B4FA6', pro:'#C7472F', carb:'#3D6FB4', fat:'#E0A21B',
  proInk:'#A93826', carbInk:'#2F5E9E', hero:'#2E7D6B', shadow:'#241f2e', scene:'#fdf1e7',
  sceneGround:'#f3e4d4', terraInk:'#5b5060', terraFaint:'#dad4e0', grey:'#8A8A90', pipGap:'#241f2e',
};
const D = { // .theme-dark -- neon on black
  bg:'#050507', card:'#0c0c11', surface2:'#101017', track:'#1a1a22', border:'#2f2f3a',
  header:'#000000', headerText:'#3DFF62', text:'#e8e8ea', muted:'#7c7c88', accent:'#3DFF62',
  onAccent:'#06120a', accentInk:'#3DFF62', good:'#3DFF62', goodInk:'#3DFF62', fatInk:'#FF4FD0',
  dangerInk:'#FF5A4D', cardheadBg:'#15151c', cardheadText:'#e8e8ea', navOff:'#7c7c88',
  onHeaderAccent:'#3DFF62', weight:'#9B7BFF', pro:'#3DFF62', carb:'#35E0E8', fat:'#FF4FD0',
  proInk:'#3DFF62', carbInk:'#35E0E8', hero:'#3DFF62', shadow:'#2f2f3a', scene:'#07070b',
  sceneGround:'#20202a', terraInk:'#3a3a48', terraFaint:'#2d2d3a', grey:'#8A8A90', pipGap:'#000000',
};

/* type: the app's two faces. Silkscreen for chrome/labels/numbers, Plex Mono at 13.5px for prose. */
const PF = (px, ls = '0.08em') => `font-family:'Silkscreen',ui-monospace,monospace;font-size:${px}px;line-height:1.45;letter-spacing:${ls};`;
const MONO = `font-family:'IBM Plex Mono',ui-monospace,'Courier New',monospace;`;
const TNUM = `font-variant-numeric:tabular-nums;letter-spacing:-0.02em;`;
const BOX = t => `border:3px solid ${t.border};box-shadow:3px 3px 0 0 ${t.shadow};`;
// Btn, kind="accent". NB `.pixel-btn` carries `border: 3px !important` (styles.css:382), which
// silently kills the `borderWidth: 2` app.jsx:3568 sets inline -- the trap documented at
// styles.css:361. The shipped button is 3px, pf 11px, px-4 py-3.
const btn = (t, label) => `<button style="${PF(11,'0.06em')}border:3px solid ${t.border};box-shadow:3px 3px 0 0 ${t.shadow};background:${t.accent};color:${t.onAccent};padding:12px 16px;text-transform:uppercase;cursor:pointer;flex-shrink:0;">${label}</button>`;

/* ---- the app's own components, copied by anatomy ---- */
// CardHead: filled ink strip, px-2.5 py-[7px], 2px rule under, pf 10px tracked 0.12em.
const cardHead = (t, title, right, rightColor) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-bottom:2px solid ${t.border};background:${t.cardheadBg};">
        <span style="${PF(10,'0.12em')}color:${t.cardheadText};text-transform:uppercase;">${title}</span>
        ${right ? `<span style="${PF(10,'0.12em')}color:${rightColor || t.accent};text-transform:uppercase;flex-shrink:0;">${right}</span>` : ''}
      </div>`;
// PageHeader: pf 9px kicker in the legacy grey, 12px gap, pf 20px title, 24px below.
const pageHeader = (t, kicker, title) => `
      <div style="margin-bottom:24px;">
        <div style="${PF(9)}color:${t.grey};text-transform:uppercase;">${kicker}</div>
        <h1 style="${PF(20)}margin:12px 0 0;font-weight:400;color:${t.text};">${title}</h1>
      </div>`;
// PipMeter: 3px frame, 1px ink gaps, 13px cells (9px when small).
const pip = (t, lit, cells, color, small, notch) => `
      <div style="display:flex;gap:1px;border:3px solid ${t.border};background:${t.pipGap};position:relative;">
        ${Array.from({ length: cells }, (_, i) => `<i style="flex:1 1 0;height:${small ? 9 : 13}px;background:${i < lit ? color : t.track};display:block;"></i>`).join('')}
        ${notch != null ? `<span style="position:absolute;top:-3px;bottom:-3px;width:3px;background:${t.text};opacity:0.55;left:calc(${notch / cells * 100}% + 1px);"></span>` : ''}
      </div>`;

/* The 90-day trend spark. Scale weight as light dots, the smoothed trend as the line the
   verdict is actually read off, and the goal as a dashed rule -- the three series TrendCard draws. */
const SCALE = [87.3,87.6,87.1,87.4,86.9,87.2,86.6,86.9,86.4,86.7,86.1,86.4,85.9,86.2,85.6,85.9,85.4,85.7,85.1,85.4,84.9,85.2,84.7,85.0,84.5,84.8,84.3,84.6,84.1,84.4,83.9,84.2,83.7,84.0,83.5,83.8,83.4,83.6,83.2,83.5,83.0,83.3,82.9,83.2];
const spark = (t, w, h, goalLine) => {
  const lo = 82.4, hi = 88.0;
  const x = i => (i / (SCALE.length - 1)) * w;
  const y = v => h - ((v - lo) / (hi - lo)) * h;
  // the trend line: a 7-point moving average, which is what recomputeTrend produces
  const trend = SCALE.map((_, i) => {
    const s = Math.max(0, i - 6), win = SCALE.slice(s, i + 1);
    return win.reduce((a, b) => a + b, 0) / win.length;
  });
  const pts = trend.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const dots = SCALE.map((v, i) => `<rect x="${(x(i) - 1).toFixed(1)}" y="${(y(v) - 1).toFixed(1)}" width="2" height="2" fill="${t.muted}" opacity="0.5"/>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;flex-shrink:0;" shape-rendering="crispEdges">
        ${goalLine ? `<line x1="0" y1="${y(82.9).toFixed(1)}" x2="${w}" y2="${y(82.9).toFixed(1)}" stroke="${t.accentInk}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>` : ''}
        ${dots}
        <polyline points="${pts}" fill="none" stroke="${t.weight}" stroke-width="2"/>
      </svg>`;
};

/* ---- THE NEW THING: the "This cycle" strip. Resting height is one row; it earns more only
   when the check-in is due or the read is thin, the same rule BuddyHabitat already follows. ---- */
const cycleStrip = (t, state) => {
  const footer = state === 'due' ? `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-top:2px solid ${t.border};background:${t.surface2};">
        <span style="${MONO}font-size:12px;color:${t.text};">Weekly check-in due</span>
        ${btn(t, 'Check in')}
      </div>` : state === 'thin' ? `
      <div style="padding:8px 12px;border-top:2px solid ${t.border};background:${t.surface2};">
        <span style="${MONO}font-size:11px;line-height:1.4;color:${t.fatInk};">Thin data so far: 3 of 7 days logged and 1 of 7 weigh-ins, so treat this as a rough read.</span>
      </div>` : '';
  if (state === 'empty') return `
    <div style="background:${t.card};${BOX(t)}margin-bottom:16px;overflow:hidden;">
      ${cardHead(t, 'This cycle', 'No read yet', t.cardheadText)}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;">
        <span style="${MONO}font-size:12px;line-height:1.5;color:${t.muted};">Weigh in for a week or so and this will tell you whether your plan is working.</span>
        ${btn(t, 'Weigh in')}
      </div>
    </div>`;
  const verdict = state === 'thin' ? 'Rough read' : 'On track';
  return `
    <div style="background:${t.card};${BOX(t)}margin-bottom:16px;overflow:hidden;">
      ${cardHead(t, 'This cycle', verdict, state === 'thin' ? t.cardheadText : t.accent)}
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;">
        <div style="min-width:0;">
          <div style="${MONO}${TNUM}font-size:20px;line-height:1.15;font-weight:700;color:${t.text};">83.1 kg</div>
          <div style="${MONO}${TNUM}font-size:10px;line-height:1.3;color:${t.muted};margin-top:1px;">&minus;0.4 a week &middot; target 0.5</div>
        </div>
        <div style="flex-grow:1;"></div>
        ${spark(t, 104, 34, true)}
        ${ic('chevron', 16, t.accentInk)}
      </div>
      ${footer}
    </div>`;
};

/* ---- the surrounding app, so each option is judged in place ---- */
const header = t => `
    <div style="height:63px;box-sizing:border-box;background:${t.header};border-bottom:3px solid ${t.border};display:flex;align-items:center;justify-content:space-between;padding:0 16px;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;background:#111;border:3px solid ${t.border};box-shadow:3px 3px 0 0 ${t.shadow};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">
          <svg width="20" height="20" viewBox="0 0 12 14" shape-rendering="crispEdges"><path d="M4 0h4v1h2v2h1v3h1v5h-1v2h-2v1H3v-1H1v-2H0V6h1V3h1V1h2z" fill="#fff"/></svg>
        </div>
        <div style="line-height:1.15;">
          <div style="${PF(12)}color:${t.headerText};">MACROSAURUS</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
            <span style="${MONO}font-size:9px;color:${t.onHeaderAccent};display:flex;align-items:center;gap:2px;">${ic('trend_up', 12, t.onHeaderAccent)}12d</span>
            <span style="${PF(7,'0.08em')}color:${t.onHeaderAccent};text-transform:uppercase;">Play &rsaquo;</span>
          </div>
        </div>
      </div>
      <div style="height:36px;box-sizing:border-box;background:#111;border:3px solid ${t.border};box-shadow:3px 3px 0 0 ${t.shadow};display:flex;align-items:center;gap:6px;padding:0 10px;color:#fff;">
        ${ic('gear', 20, '#fff')}<span style="${PF(8)}">YOU</span>
      </div>
    </div>`;

// The buddy's terrarium, abbreviated to its real anatomy: title bar, lit scene, speech on an
// inset strip, and the four-cell status row.
const habitat = t => `
    <div style="background:${t.card};${BOX(t)}margin-bottom:16px;overflow:hidden;">
      ${cardHead(t, 'Rexy &middot; Day 47', 'Level 6')}
      <div style="height:104px;position:relative;background:linear-gradient(180deg,${t.scene} 0%,${t.scene} 100%);border-bottom:2px solid ${t.border};overflow:hidden;">
        <div style="position:absolute;left:0;right:0;bottom:0;height:26px;background:${t.sceneGround};border-top:2px solid ${t.terraInk};"></div>
        <svg width="34" height="42" viewBox="0 0 17 21" shape-rendering="crispEdges" style="position:absolute;left:36px;bottom:24px;">
          <path d="M6 0h6v2h2v3h1v3h2v2h-3v6h1v3h-2v-2H8v2H6v-3H4v3H2v-4H0V8h2V5h2V2h2z" fill="${t.good}"/>
          <rect x="9" y="3" width="2" height="2" fill="${t.card}"/>
        </svg>
        <svg width="14" height="20" viewBox="0 0 7 10" shape-rendering="crispEdges" style="position:absolute;right:44px;bottom:24px;"><path d="M3 0h1v10H3zM0 3h1v4H0zM6 2h1v5H6zM1 3h1v1H1zM5 2h1v1H5z" fill="${t.terraInk}"/></svg>
      </div>
      <div style="padding:10px 12px;background:${t.surface2};border-bottom:2px solid ${t.border};">
        <div style="${MONO}font-size:12.5px;line-height:1.5;color:${t.text};">Protein's the one to chase today &mdash; 62 g left and the day's still young.</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));">
        ${[['940', 'KCAL LEFT'], ['62g', 'PROTEIN'], ['7.2k', 'STEPS'], ['5/7', 'WEEK']].map(([v, l], i) => `
        <div style="padding:8px 6px;text-align:center;${i < 3 ? `border-right:2px solid ${t.border};` : ''}">
          <div style="${MONO}${TNUM}font-size:14px;font-weight:700;color:${t.text};">${v}</div>
          <div style="${PF(7)}color:${t.muted};text-transform:uppercase;margin-top:2px;">${l}</div>
        </div>`).join('')}
      </div>
    </div>`;

// Today's plan, band for band as Dashboard draws it.
const planCard = t => `
    <div style="background:${t.card};${BOX(t)}margin-bottom:16px;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px 9px 12px;border-bottom:2px solid ${t.border};">
        <span style="${PF(10,'0.12em')}color:${t.text};text-transform:uppercase;">Today's plan</span>
        <div style="display:flex;border:2px solid ${t.border};background:${t.surface2};">
          <span style="${PF(9)}padding:5px 9px;background:${t.accent};color:${t.onAccent};text-transform:uppercase;">Left</span>
          <span style="${PF(9)}padding:5px 9px;color:${t.muted};text-transform:uppercase;">Eaten</span>
        </div>
      </div>
      <div style="padding:14px 12px 12px;border-bottom:2px solid ${t.border};">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px;">
          <div>
            <span style="${MONO}${TNUM}font-size:38px;font-weight:700;line-height:1;color:${t.hero};">940</span>
            <span style="${PF(9)}color:${t.muted};text-transform:uppercase;margin-left:6px;">kcal left</span>
          </div>
          <span style="${MONO}${TNUM}font-size:11px;color:${t.muted};">of 2,180</span>
        </div>
        ${pip(t, 6, 10, t.hero, false, 9)}
      </div>
      <div style="padding:12px 12px 14px;display:flex;flex-direction:column;gap:10px;">
        ${[['PROT', '62g', t.pro, t.proInk, 5], ['CARB', '118g', t.carb, t.carbInk, 4], ['FATS', '31g', t.fat, t.fatInk, 6]].map(([l, v, c, ink, lit]) => `
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="${PF(9)}color:${ink};text-transform:uppercase;width:38px;flex-shrink:0;">${l}</span>
          <div style="flex-grow:1;">${pip(t, lit, 10, c, true, 8)}</div>
          <span style="${MONO}${TNUM}font-size:12px;font-weight:600;color:${t.text};width:42px;text-align:right;flex-shrink:0;">${v}</span>
        </div>`).join('')}
      </div>
    </div>`;

// The bottom bar, with the shipped component's geometry: BottomNav slices the tab list
// 2 | FAB | rest (app.jsx:18017-18023), and the FAB is a `flex-1` SIBLING rather than a fixed
// cell -- so a fifth tab makes six equal flex children share 374px, ~62px each.
const bottomNav = (t, items, active) => {
  const half = 2;   // BOTTOM_NAV.slice(0, 2) ... FAB ... BOTTOM_NAV.slice(2)
  const cell = ([k, l]) => `
      <div style="flex:1 1 0;min-width:0;align-self:stretch;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:${k === active ? t.onHeaderAccent : t.navOff};">
        ${ic(k === 'dashboard' ? 'dash' : k === 'foodlog' ? 'food' : k === 'recipes' ? 'recipe' : k === 'train' ? 'dumbbell' : 'goal', 24, k === active ? t.onHeaderAccent : t.navOff)}
        <span style="${PF(9)}text-transform:uppercase;white-space:nowrap;">${l}</span>
      </div>`;
  return `
    <div style="height:64px;box-sizing:border-box;background:${t.header};border-top:3px solid ${t.border};display:flex;align-items:center;padding:0 8px;flex-shrink:0;position:relative;">
      ${items.slice(0, half).map(cell).join('')}
      <div style="flex:1 1 0;display:flex;justify-content:center;">
        <div style="width:68px;height:68px;box-sizing:border-box;border:3px solid ${t.hero === t.good && t.bg === '#050507' ? '#3DFF62' : t.border};box-shadow:3px 3px 0 0 ${t.shadow};background:${t.card};display:flex;align-items:center;justify-content:center;margin-top:-72px;">
          ${ic('plus', 48, t.bg === '#050507' ? '#3DFF62' : t.border)}
        </div>
      </div>
      ${items.slice(half).map(cell).join('')}
    </div>`;
};

const NAV4 = [['dashboard', 'Today'], ['foodlog', 'Food'], ['recipes', 'Cook'], ['train', 'Train']];
const NAV5 = [['dashboard', 'Today'], ['foodlog', 'Food'], ['recipes', 'Cook'], ['train', 'Train'], ['goals', 'Progress']];

const phone = (t, body, nav) => `
  <div style="width:390px;height:844px;box-sizing:border-box;background:${t.bg};color:${t.text};${MONO}font-size:13.5px;line-height:1.55;display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased;">
    ${header(t)}
    <div style="flex-grow:1;min-height:0;overflow:hidden;padding:24px 20px 0;">
${body}
    </div>
    ${nav}
  </div>`;

const doc = (title, inner) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap">
  <style>
    body { margin: 0; }
    a { color: #8A6100; } a:hover { color: #241f2e; }
  </style>
</helmet>
${inner}
</x-dc>
</body>
</html>
`;

/* =========================== the artboards =========================== */

// BEFORE: Today as it ships. Nothing on this screen answers "is the plan working".
fs.writeFileSync(path.join(here, 'TodayNow.dc.html'), doc('Today now',
  phone(P, pageHeader(P, 'Tuesday 25 August', 'Today') + habitat(P) + planCard(P), bottomNav(P, NAV4, 'dashboard'))));

// OPTION A (the recommendation): the compact "This cycle" strip, between the buddy and the plan.
fs.writeFileSync(path.join(here, 'Main.dc.html'), doc('Option A',
  phone(P, pageHeader(P, 'Tuesday 25 August', 'Today') + habitat(P) + cycleStrip(P, 'rest') + planCard(P), bottomNav(P, NAV4, 'dashboard'))));

// OPTION B: Progress back in the tab bar. Five tabs plus the FAB across 390px.
fs.writeFileSync(path.join(here, 'OptionB.dc.html'), doc('Option B',
  phone(P, pageHeader(P, 'Tuesday 25 August', 'Today') + habitat(P) + planCard(P), bottomNav(P, NAV5, 'dashboard'))));

// OPTION C: Progress becomes a tab of You, and lands there first.
const youScreen = t => `
      ${pageHeader(t, 'Your profile &amp; settings', 'You')}
      <div style="display:flex;gap:4px;margin-bottom:20px;border:2px solid ${t.border};background:${t.surface2};padding:4px;">
        ${[['Progress', true], ['Settings', false], ['Account', false]].map(([l, on]) => `
        <div style="flex:1 1 0;text-align:center;padding:8px 0;${on ? `background:${t.accent};color:${t.onAccent};` : `color:${t.muted};`}">
          <span style="${PF(9)}text-transform:uppercase;">${l}</span>
        </div>`).join('')}
      </div>
      ${(() => {
        // The full Progress page, as Goals renders it: the verdict, then the action it implies.
        return `
      <div style="background:${t.card};${BOX(t)}margin-bottom:12px;overflow:hidden;">
        ${cardHead(t, 'This cycle', 'On track')}
        <div style="padding:14px;">
          <div style="${MONO}font-size:12px;line-height:1.6;color:${t.muted};">Losing <span style="${TNUM}color:${t.text};font-weight:600;">0.4 kg</span> a week against a target of <span style="${TNUM}color:${t.text};font-weight:600;">0.5 kg</span>. At this rate you reach <span style="${TNUM}color:${t.text};font-weight:600;">78.0 kg</span> in about <span style="${TNUM}color:${t.text};font-weight:600;">13</span> weeks.</div>
          <div style="margin-top:12px;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px;">
              <span style="${PF(8)}color:${t.grey};text-transform:uppercase;">To your goal</span>
              <span style="${MONO}${TNUM}font-size:11px;color:${t.grey};">4.2 kg of 9.3 kg</span>
            </div>
            ${pip(t, 5, 10, t.good, true)}
          </div>
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:2px solid ${t.surface2};">
            <div>
              <span style="${MONO}${TNUM}font-size:24px;font-weight:700;color:${t.text};">83.1 kg</span>
              <div style="${MONO}font-size:10px;color:${t.grey};margin-top:2px;">trend weight</div>
            </div>
            ${btn(t, 'Weigh in')}
          </div>
        </div>
      </div>
      <div style="background:${t.card};${BOX(t)}margin-bottom:16px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="min-width:0;">
          <div style="${PF(9)}color:${t.grey};text-transform:uppercase;">Next check-in</div>
          <div style="${MONO}font-size:12.5px;font-weight:700;margin-top:2px;color:${t.text};">In 3 days</div>
        </div>
        <span style="${MONO}font-size:11px;color:${t.grey};flex-shrink:0;">Sun 30 Aug</span>
      </div>
      <div style="background:${t.card};${BOX(t)}padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
          <div style="display:flex;border:2px solid ${t.border};background:${t.surface2};">
            ${['1M', '3M', '6M', '1Y'].map((l, i) => `<span style="${PF(9)}padding:5px 8px;${i === 1 ? `background:${t.accent};color:${t.onAccent};` : `color:${t.muted};`}text-transform:uppercase;">${l}</span>`).join('')}
          </div>
        </div>
        ${spark(t, 306, 96, true)}
      </div>`;
      })()}`;
fs.writeFileSync(path.join(here, 'OptionC.dc.html'), doc('Option C',
  phone(P, youScreen(P), bottomNav(P, NAV4, null))));

// The strip's other states. It costs 82px at rest and only grows when it has earned it.
const stateSheet = t => `
  <div style="width:430px;box-sizing:border-box;background:${t.bg};color:${t.text};${MONO}font-size:13.5px;line-height:1.55;padding:28px 20px 32px;-webkit-font-smoothing:antialiased;">
    <div style="${PF(9)}color:${t.grey};text-transform:uppercase;">What the strip does</div>
    <h1 style="${PF(18)}margin:12px 0 6px;font-weight:400;">Four states</h1>
    <div style="${MONO}font-size:12px;line-height:1.6;color:${t.muted};margin-bottom:24px;">It earns its height rather than taking it &mdash; one row at rest, taller only when it is actually saying something. The same rule the buddy box already follows.</div>
    ${[['Resting &mdash; 94px', 'rest', 'The ordinary morning. The verdict, the trend weight, the shape of the last 90 days, and a way in.'],
       ['Check-in due &mdash; 158px', 'due', 'The one ask the app currently makes only through a coach line a shop nudge can outrank. Most of the extra height is the app&rsquo;s own accent Btn, which is 46px of it.'],
       ['Thin data &mdash; 143px', 'thin', 'The caveat travels with the verdict, so a rough read is never mistaken for a confident one.'],
       ['Nothing to read yet &mdash; 115px', 'empty', 'A fresh account. It asks for the one input that would give it something to say.']]
      .map(([label, state, note]) => `
    <div style="margin-bottom:26px;">
      <div style="${PF(9)}color:${t.accentInk};text-transform:uppercase;margin-bottom:8px;">${label}</div>
      ${cycleStrip(t, state)}
      <div style="${MONO}font-size:11.5px;line-height:1.55;color:${t.muted};">${note}</div>
    </div>`).join('')}
  </div>`;
fs.writeFileSync(path.join(here, 'BandStates.dc.html'), doc('Band states', stateSheet(P)));

// Option A after dark, because the two themes do not share a palette.
fs.writeFileSync(path.join(here, 'Dark.dc.html'), doc('After dark',
  phone(D, pageHeader(D, 'Tuesday 25 August', 'Today') + habitat(D) + cycleStrip(D, 'rest') + planCard(D), bottomNav(D, NAV4, 'dashboard'))));

console.log('wrote 6 artboards');
