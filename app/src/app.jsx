const { useState, useEffect, useMemo, useRef } = React;
const E = window.Engine;
const Store = window.Store;
const Q = window.Quantity;
const Rcp = window.Recipe;
const LB_PER_KG = 2.2046226218;
const BRAND = 'Macrosaurus';
// palette
const CAL = 'var(--accent)', PRO = 'var(--pro)', FAT = 'var(--fat)', CARB = 'var(--carb)';
const MUTED = 'var(--muted)', BORDER = 'var(--border)', CARDBG = 'var(--card)';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/* activity levels replace steps + gym sliders */
const ACTIVITY = [
  { v: 'sedentary', l: 'Sedentary', d: 'Desk job, little exercise', steps: 3000, gym: 0 },
  { v: 'light', l: 'Lightly active', d: 'About 6k steps, 1 to 2 gym sessions a week', steps: 6000, gym: 2 },
  { v: 'moderate', l: 'Moderately active', d: 'About 9k steps, 3 to 4 gym sessions a week', steps: 9000, gym: 3 },
  { v: 'very', l: 'Very active', d: 'About 12k steps, 5 to 6 gym sessions a week', steps: 12000, gym: 5 },
  { v: 'extra', l: 'Extremely active', d: 'Active job plus near-daily training', steps: 15000, gym: 7 },
];
function withActivity(p) { const a = ACTIVITY.find(x => x.v === p.activityLevel) || ACTIVITY[2]; return Object.assign({}, p, { avgSteps: a.steps, gymSessionsPerWeek: a.gym }); }
// Lean (fat-free) mass in kg when body fat is known, else bodyweight.
function leanKg(p) { const f = E.fatFreeMassKg(p.weightKg, p.bodyFatPct); return (f != null && f > 0) ? f : p.weightKg; }
// ---- pixel-art glyphs (no emoji) ----
const PX_ICONS = {
  meat: ['.####.', '######', '######', '.####.', '...##.', '...##.'],
  plant: ['....#.', '..###.', '.####.', '####..', '.##.#.', '.#....'],
  drink: ['######', '#....#', '#....#', '.####.', '.####.', '..##..'],
  egg: ['..##..', '.####.', '######', '######', '.####.', '..##..'],
  grain: ['.####.', '######', '#.##.#', '######', '######', '.####.'],
  sweet: ['#....#', '.####.', '######', '######', '.####.', '#....#'],
  drop: ['..#...', '..#...', '.###..', '#####', '#####', '.###..'],
  dino: ['.####.', '#.##.#', '######', '#....#', '.#### ', '#....#'],
  down: ['..##..', '..##..', '..##..', '######', '.####.', '..##..'],
  up: ['..##..', '.####.', '######', '..##..', '..##..', '..##..'],
  scale: ['......', '######', '......', '......', '######', '......'],
  sun: ['#.#.#.', '.###..', '#####.', '.###..', '#.#.#.', '......'],
  moon: ['.###..', '###...', '##....', '###...', '.###..', '......'],
  doc: ['#####.', '#...#.', '#.#.#.', '#...#.', '#.#.#.', '#####.'],
  plate: ['.####.', '#....#', '#....#', '#....#', '.####.', '......'],
  glove: ['.###..', '#####.', '######', '######', '.####.', '.####.'],
  trophy: ['#.##.#', '######', '.####.', '..##..', '..##..', '.####.'],
  cup: ['######', '#....#', '#....#', '.####.', '.####.', '..##..'],
  snow: ['#.#.#.', '.###..', '######', '.###..', '#.#.#.', '..#...'],
};
function foodKind(name, isAlc) {
  if (isAlc) return 'drink';
  const n = (name || '').toLowerCase();
  if (/chicken|beef|steak|pork|bacon|ham|turkey|lamb|rib|sausage|fish|tuna|salmon|prawn|shrimp|meat/.test(n)) return 'meat';
  if (/salad|veg|broccoli|spinach|kale|leaf|greens|tomato|carrot|pepper|mushroom|bean|avocado|cucumber/.test(n)) return 'plant';
  if (/coffee|tea|juice|water|shake|smoothie|cola|milk|drink/.test(n)) return 'drink';
  if (/\begg/.test(n)) return 'egg';
  if (/bread|toast|rice|pasta|oat|cereal|bagel|roll|wrap|noodle|grain|granola|potato|pizza|burger/.test(n)) return 'grain';
  if (/cake|cookie|chocolate|candy|sweet|ice cream|donut|biscuit|honey|sugar/.test(n)) return 'sweet';
  return 'dino';
}
function PixelGlyph({ kind, color, size }) {
  const g = PX_ICONS[kind] || PX_ICONS.dino; const w = 6, h = g.length; const rects = [];
  g.forEach((row, y) => row.split('').forEach((c, x) => { if (c === '#') rects.push(<rect key={x + '_' + y} x={x} y={y} width="1" height="1" />); }));
  return <svg viewBox={`0 0 ${w} ${h}`} width={size || 20} height={size || 20} fill={color} style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}>{rects}</svg>;
}
// The Macrosaurus mascot: an original multi-colour pixel dino, our brand logo, drawn in the
// same crisp sprite style as the Macrodex creatures. `color` is accepted for call-site
// compatibility but ignored (the mascot carries its own fixed palette so it reads on any
// background: the dark nav chip, the header box, and light screens alike).
const DINO_ART = [
  '..........LLLLL.',
  '..........BBBBBB',
  '..........BBPBBB',
  '..........BBBB..',
  'L.........DBBB..',
  'BL.......DBBBB..',
  'BBLD.D.DDBBBBB..',
  'BBBLLLLLLLBBBB..',
  '.BBBBBBBBBBBBB..',
  '..BBBBBBBBBBBL..',
  '..BBBBBBBBBBB...',
  '..BBBBBBBBBB....',
  '..BBB..BBBB.....',
  '..BBB..BBB......',
  '..DDD..BDDD.....',
];
const DINO_COLORS = { L: '#7BD957', B: '#46B94A', D: '#2C8C3E', P: '#123A1C' };
function PixelDino({ size, className }) {
  const px = size || 24, w = DINO_ART[0].length, h = DINO_ART.length, rects = [];
  DINO_ART.forEach((row, y) => row.split('').forEach((ch, x) => { const c = DINO_COLORS[ch]; if (ch !== '.' && c) rects.push(<rect key={x + '_' + y} x={x} y={y} width="1.03" height="1.03" fill={c} />); }));
  return <svg role="img" aria-label="Macrosaurus" className={className} width={px} height={px * h / w} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" style={{ display: 'inline-block', verticalAlign: 'middle' }}>{rects}</svg>;
}

/* ---------- Add to home screen / install (PWA) ----------
   Macrosaurus is already an installable PWA (manifest + service worker). On Android/Chrome the
   browser fires `beforeinstallprompt`; we stash it here at module load, BEFORE React mounts, so the
   event is never lost, then a custom button can trigger the real native install dialog. iOS Safari
   has no such event, so there we show the manual Add-to-Home-Screen steps instead. When the app is
   already running installed (standalone display mode), every install affordance stays hidden. */
let DEFERRED_INSTALL = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); DEFERRED_INSTALL = e; try { window.dispatchEvent(new Event('mac:installable')); } catch (_) {} });
  window.addEventListener('appinstalled', function () { DEFERRED_INSTALL = null; try { window.dispatchEvent(new Event('mac:installed')); window.MTRACK && MTRACK('pwa_installed'); } catch (_) {} });
}
function isStandalonePWA() { try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true || (document.referrer || '').indexOf('android-app://') === 0; } catch (_) { return false; } }
function isIOSDevice() { try { const ua = navigator.userAgent || ''; return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); } catch (_) { return false; } }
// iOS can only "Add to Home Screen" from Safari itself, not Chrome/Firefox/Edge on iOS (all WebKit but
// no install path), so only surface the manual steps when we're actually in Safari.
function isIOSSafari() { try { const ua = navigator.userAgent || ''; return isIOSDevice() && /WebKit/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|mercury/i.test(ua); } catch (_) { return false; } }
// React hook exposing install state: whether the app is already installed, whether a native prompt is
// available (Android/Chrome), whether we're on iOS Safari (manual steps), and a trigger for the prompt.
function useInstallPrompt() {
  const [deferred, setDeferred] = useState(DEFERRED_INSTALL);
  const [installed, setInstalled] = useState(isStandalonePWA());
  useEffect(() => {
    function onCan() { setDeferred(DEFERRED_INSTALL); }
    function onDone() { setDeferred(null); setInstalled(true); }
    window.addEventListener('mac:installable', onCan);
    window.addEventListener('mac:installed', onDone);
    setDeferred(DEFERRED_INSTALL); // in case the event fired between module load and mount
    const mq = (window.matchMedia && window.matchMedia('(display-mode: standalone)')) || null;
    function onMode(e) { if (e.matches) setInstalled(true); }
    try { if (mq && mq.addEventListener) mq.addEventListener('change', onMode); } catch (_) {}
    return function () {
      window.removeEventListener('mac:installable', onCan);
      window.removeEventListener('mac:installed', onDone);
      try { if (mq && mq.removeEventListener) mq.removeEventListener('change', onMode); } catch (_) {}
    };
  }, []);
  async function promptInstall() {
    const d = deferred || DEFERRED_INSTALL;
    if (!d) return 'unavailable';
    try {
      d.prompt();
      const res = await d.userChoice;
      DEFERRED_INSTALL = null; setDeferred(null);
      window.MTRACK && MTRACK('pwa_install_prompt', { outcome: (res && res.outcome) || 'unknown' });
      return (res && res.outcome) || 'dismissed';
    } catch (_) { return 'error'; }
  }
  return { installed: installed, canInstall: !!deferred, isIOS: isIOSSafari(), promptInstall: promptInstall };
}
// The proactive home-screen nudge on the dashboard is dismissable per device, and comes back after a
// couple of weeks so it keeps gently offering without nagging every launch.
const INSTALL_DISMISS_KEY = 'mac_install_dismissed_at';
const INSTALL_RESHOW_MS = 14 * 24 * 60 * 60 * 1000;
function installRecentlyDismissed() { try { const v = +localStorage.getItem(INSTALL_DISMISS_KEY) || 0; return !!v && (Date.now() - v) < INSTALL_RESHOW_MS; } catch (_) { return false; } }
function markInstallDismissed() { try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (_) {} }
// Safari's Share glyph, so the iOS steps point at the exact button to tap.
function ShareIOSIcon({ size }) {
  const s = size || 16;
  return (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'text-bottom' }} aria-hidden="true">
    <path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </svg>);
}
// The step-by-step Add-to-Home-Screen sheet for iOS Safari (which has no programmatic install).
function IOSInstallSheet({ onClose }) {
  useBackClose(onClose);
  const steps = [
    ['1', <span>Tap the <b>Share</b> button <ShareIOSIcon /> in Safari's toolbar.</span>],
    ['2', <span>Scroll down and tap <b>Add to Home Screen</b>.</span>],
    ['3', <span>Tap <b>Add</b>. Macrosaurus lands on your home screen like any app.</span>],
  ];
  return (<div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
    <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-8 fade-in" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-1"><div className="text-lg font-bold">Add to Home Screen</div><button onClick={onClose} className="text-[#8A8A90] text-xl leading-none" aria-label="Close">×</button></div>
      <div className="text-[12px] text-[#8A8A90] mb-4 leading-relaxed">Install Macrosaurus in three quick taps in Safari, for a full-screen app with its own icon.</div>
      <div className="space-y-3">
        {steps.map(([n, body]) => (<div key={n} className="flex items-start gap-3">
          <span className="pixel-box w-6 h-6 flex items-center justify-center shrink-0 pf text-[9px]" style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--border)' }}>{n}</span>
          <div className="text-[13px] leading-snug pt-0.5">{body}</div>
        </div>))}
      </div>
      <button onClick={onClose} className="w-full pixel-btn mt-6 py-3 text-[11px] pf" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>GOT IT</button>
    </div>
  </div>);
}
// Proactive dashboard card: offers install to anyone who hasn't added the app yet, dismissable.
function InstallCard() {
  const { installed, canInstall, isIOS, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(installRecentlyDismissed());
  const [iosOpen, setIosOpen] = useState(false);
  if (installed || dismissed || (!canInstall && !isIOS)) return null;
  function dismiss() { markInstallDismissed(); setDismissed(true); }
  async function onInstall() {
    if (canInstall) { const r = await promptInstall(); if (r === 'accepted') setDismissed(true); }
    else { setIosOpen(true); window.MTRACK && MTRACK('pwa_ios_help', { from: 'dashboard' }); }
  }
  return (<Card className="p-4 mb-4 fade-in" style={{ borderColor: 'var(--accent)' }}>
    <div className="flex items-start gap-3">
      <div className="pixel-box w-10 h-10 flex items-center justify-center shrink-0" style={{ background: 'var(--accent)', borderColor: 'var(--border)' }}><PixelDino size={22} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold">Add Macrosaurus to your home screen</div>
          <button onClick={dismiss} aria-label="Dismiss" className="text-[#8A8A90] text-lg leading-none shrink-0">×</button>
        </div>
        <div className="text-[11px] text-[#8A8A90] mt-0.5 mb-3 leading-snug">{isIOS ? 'Install it like an app: full screen, its own icon, and faster launches, no App Store needed.' : 'Install the app for full-screen, offline-ready tracking and a home-screen icon, no Play Store needed.'}</div>
        <button onClick={onInstall} className="pixel-btn px-4 py-2.5 text-[10px] pf" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{isIOS ? 'SHOW ME HOW' : 'INSTALL APP'}</button>
      </div>
    </div>
    {iosOpen && <IOSInstallSheet onClose={() => setIosOpen(false)} />}
  </Card>);
}
// Persistent menu entry (in the Account tab) so install stays reachable even after the card is dismissed.
function InstallMenuRow() {
  const { installed, canInstall, isIOS, promptInstall } = useInstallPrompt();
  const [iosOpen, setIosOpen] = useState(false);
  if (installed || (!canInstall && !isIOS)) return null;
  async function onClick() {
    if (canInstall) promptInstall();
    else { setIosOpen(true); window.MTRACK && MTRACK('pwa_ios_help', { from: 'menu' }); }
  }
  return (<React.Fragment>
    <MenuRow label="Add to home screen" desc={isIOS ? 'Install Macrosaurus as an app from Safari' : 'Install Macrosaurus as an app on your device'} tone="accent" onClick={onClick} />
    {iosOpen && <IOSInstallSheet onClose={() => setIosOpen(false)} />}
  </React.Fragment>);
}

// Pixel flame, outer glow (fat/orange), inner core (accent). Replaces the 🔥 emoji.
const FIRE_OUTER = ['...#...', '..###..', '.#.###.', '.#####.', '#####.#', '#######', '#######', '.#####.', '..###..'];
const FIRE_INNER = ['.......', '.......', '.......', '...#...', '..###..', '..###..', '..###..', '...#...', '.......'];
function PixelFire({ size, color, core }) {
  const build = (grid, fill) => grid.flatMap((row, y) => row.split('').map((c, x) => c === '#' ? <rect key={fill + x + '_' + y} x={x} y={y} width="1" height="1" fill={fill} /> : null));
  return <svg viewBox="0 0 7 9" width={(size || 16) * 7 / 9} height={size || 16} className="inline-block align-[-0.15em]" style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}>{build(FIRE_OUTER, color || 'var(--fat)')}{build(FIRE_INNER, core || 'var(--danger)')}</svg>;
}

/* ---------- unit helpers ---------- */
function kgToStLb(kg) { const t = kg * LB_PER_KG; const st = Math.floor(t / 14); return { st, lb: +(t - st * 14).toFixed(1) }; }
function stLbToKg(st, lb) { return ((+st || 0) * 14 + (+lb || 0)) / LB_PER_KG; }
function cmToFtIn(cm) { const t = cm / 2.54; const ft = Math.floor(t / 12); return { ft, inch: Math.round(t - ft * 12) }; }
function ftInToCm(ft, inch) { return ((+ft || 0) * 12 + (+inch || 0)) * 2.54; }
function fmtWeight(kg, unit) { if (kg == null || isNaN(kg)) return '–'; if (unit === 'st_lb') { const { st, lb } = kgToStLb(kg); return `${st} st ${lb.toFixed(1)} lb`; } return kg.toFixed(1) + ' kg'; }
function fmtHeight(cm, unit) { if (unit === 'ft_in') { const { ft, inch } = cmToFtIn(cm); return `${ft}'${inch}"`; } return Math.round(cm) + ' cm'; }
function weekdayIdx(d) { return new Date(d + 'T00:00:00').getDay(); }
function shiftISO(d, n) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return Store.isoOf(x); } // isoOf keeps it the LOCAL date (toISOString would shift it a day in +UTC zones)
function prettyDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase(); }

/* ---------- image / AI helpers (the AI / Anthropic) ---------- */
const AI_MODEL = 'claude-sonnet-5';               // reasoning jobs: meal estimates, body fat
const AI_MODEL_FAST = 'claude-haiku-4-5-20251001'; // deterministic OCR: nutrition-label scans
// AI now runs through our own server-side proxy (Supabase Edge Function) that holds the Anthropic
// key, so users never need to bring their own. The proxy checks the signed-in user and enforces a
// small monthly spend cap per account. No API key is ever shipped to the browser.
const AI_PROXY = 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/ai-proxy';
// recipe-extract fetches the public text (title, description, transcript, caption) behind a shared
// YouTube/Instagram/TikTok link server-side (the browser can't, due to CORS). It holds no key and calls no
// paid API; we then hand its text to the normal ai-proxy to structure into a recipe.
const RECIPE_EXTRACT = 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/recipe-extract';
// nutrition-analyze turns ingredient LINES into per-ingredient + total macros via a real nutrition
// database (Edamam), server-side. If it is not configured, the client falls back to an AI estimate.
const NUTRITION_ANALYZE = 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/nutrition-analyze';
// google-health-proxy runs the Google OAuth token exchange (with the app secret) and returns daily
// step counts via the Google Health API; no Google token ever reaches the browser. GOOGLE_CLIENT_ID
// is public (it only names the app on the consent screen). Reads Fitbit device data too, since Fitbit
// now syncs into Google Health. See the google-health-proxy edge function.
const GH_PROXY = 'https://wnbksotvcjqfslrttjxy.supabase.co/functions/v1/google-health-proxy';
const GOOGLE_CLIENT_ID = '779915009623-ahbl494cs1psoeilmph4n8ij24goi9jh.apps.googleusercontent.com';
const GH_SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
// Minimum gap between Google Health syncs. We re-sync on app open and whenever the app returns to the
// foreground (throttled to this), so steps/sleep stay fresh through the day without hammering the API.
const GH_SYNC_GAP_MS = 10 * 60 * 1000;
function fileToDataURL(file) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); }
// Downscale + re-encode to JPEG so requests stay small and reliable across devices.
async function imageToB64(file, max) {
  max = max || 1152;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    return { b64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg' };
  } catch (e) {
    const d = await fileToDataURL(file); return { b64: d.split(',')[1], mime: d.substring(5, d.indexOf(';')) };
  }
}
// ---- Premium / billing (client) -------------------------------------------------------------
const FREE_AI_MONTHLY = 10;          // free-tier AI actions per month (mirrors app_config.free_ai_monthly)
const PRICE_MONTHLY_LABEL = '£4.99';
const PRICE_ANNUAL_LABEL = '£39.99';

// Send a message request to Claude via our server-side proxy. The proxy attaches the real API key,
// verifies the signed-in user and enforces the free/premium AI tiers. Returns the raw
// Anthropic message JSON (same shape as calling the API directly).
async function aiRequest(body) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token;
  if (!token) throw new Error('Please sign in to use AI features.');
  const res = await fetch(AI_PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.type === 'error' || j.error) {
    const e = j.error || {};
    // Route free-limit / premium-only / fair-use errors to the paywall (opener registered by App).
    // Still throw so the calling flow stops cleanly.
    if (e.type === 'free_limit' || e.type === 'premium_required' || e.type === 'budget_exceeded') {
      try { window.MPAYWALL && window.MPAYWALL(e); } catch (_) {}
    }
    const err = new Error(e.message || 'AI error'); err.aiError = e; throw err;
  }
  return j;
}
// ---- Google Health steps sync (client half) -------------------------------------------------
// The Google secret lives only in the edge function. Here we run the PKCE OAuth redirect, then hand
// the returned one-time code to the proxy, which exchanges it and returns step counts. Steps only.
const ghConfigured = () => !!GOOGLE_CLIENT_ID;
function b64url(bytes) { let s = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function ghRandom(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); }
async function ghChallenge(verifier) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)); return b64url(d); }
function ghRedirectUri() { return window.location.origin + '/'; }
function ghTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } }
// Kick off the Google consent redirect. access_type=offline + prompt=consent guarantee a refresh
// token. Stashes the PKCE verifier + a state nonce so the callback can prove the response is ours
// (and not, say, a Supabase auth ?code on the same URL).
async function ghConnect() {
  const verifier = ghRandom(64);
  const state = 'ghealth_' + ghRandom(16);
  sessionStorage.setItem('gh_pkce', verifier);
  sessionStorage.setItem('gh_state', state);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GH_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('code_challenge', await ghChallenge(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('redirect_uri', ghRedirectUri());
  window.location.href = u.toString();
}
async function ghPost(action, body) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token;
  if (!token) throw new Error('Please sign in first.');
  const res = await fetch(GH_PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify(Object.assign({ action, tz: ghTimezone() }, body || {})),
  });
  const data = await res.json();
  if (!res.ok) { const e = new Error((data && data.error && data.error.message) || 'Google Health request failed.'); e.gh = data && data.error; throw e; }
  return data;
}
// Merge a { date: count } map from Google Health into d.steps, letting a fresh reading win per date.
function mergeStepsInto(d, steps) {
  if (!steps) return 0;
  d.steps = d.steps || {};
  let n = 0;
  for (const k in steps) { const v = +steps[k]; if (isFinite(v) && v > 0) { d.steps[k] = Math.round(v); n++; } }
  return n;
}
// Merge a { date: { min, deep?, rem?, light?, awake? } } map (keyed by wake date) from Google Health
// into d.sleep, scoring each night against the user's target so the morning-catch effect can read it.
function mergeSleepInto(d, sleep) {
  if (!sleep) return 0;
  d.sleep = d.sleep || {};
  const target = (d.profile && d.profile.sleepTargetMin) || Game.SLEEP_TARGET_DEFAULT;
  let n = 0;
  for (const k in sleep) {
    const s = sleep[k]; const min = s && +s.min;
    if (!isFinite(min) || min <= 0) continue;
    const stages = (s.deep != null || s.rem != null || s.light != null || s.awake != null)
      ? { deep: +s.deep || 0, rem: +s.rem || 0, light: +s.light || 0, awake: +s.awake || 0 } : null;
    const sc = Game.sleepScore(min, target, stages);      // null for a stage-less night (no quality to judge)
    const rec = { min: Math.round(min) };
    if (isFinite(sc)) rec.score = sc;
    if (stages) Object.assign(rec, stages);
    d.sleep[k] = rec; n++;
  }
  return n;
}
// Merge a { date: { hrv?, rhr?, spo2?, tempDev? } } map from Google Health into d.health, then compute
// each day's rolling baseline (trailing average of the PRIOR readings) so readiness can compare today
// to the user's own normal. HRV and resting HR only mean anything relative to a personal baseline.
function mergeHealthInto(d, health) {
  if (!health) return 0;
  d.health = d.health || {};
  let n = 0;
  for (const k in health) {
    const h = health[k]; if (!h) continue;
    const rec = Object.assign({}, d.health[k]);
    ['hrv', 'rhr', 'spo2', 'tempDev'].forEach(f => { if (isFinite(h[f])) rec[f] = +h[f]; });
    d.health[k] = rec; n++;
  }
  const BASE_WIN = 14;
  const dates = Object.keys(d.health).sort();
  ['hrv', 'rhr'].forEach(metric => {
    const hist = [];
    dates.forEach(dt => {
      if (hist.length) d.health[dt][metric + 'Baseline'] = Math.round((hist.reduce((a, b) => a + b, 0) / hist.length) * 10) / 10;
      else delete d.health[dt][metric + 'Baseline'];
      const v = d.health[dt][metric];
      if (isFinite(v)) { hist.push(v); if (hist.length > BASE_WIN) hist.shift(); }
    });
  });
  return n;
}

// Call the AI with any number of images + a text prompt; expect one JSON object back.
// `key` is retained for signature compatibility but is no longer used, the proxy holds the key.
async function claudeVision(key, files, prompt, opts) {
  opts = opts || {};
  const model = opts.model || AI_MODEL;
  const maxTokens = opts.maxTokens || 2048;
  const maxImg = opts.maxImg || 1024;
  const content = [];
  for (const f of (files || [])) { const im = await imageToB64(f, maxImg); content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }); }
  content.push({ type: 'text', text: prompt });
  const j = await aiRequest({ model, max_tokens: maxTokens, messages: [{ role: 'user', content }] });
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
  return parseModelJSON(txt);
}
// AI coaching layer: the deterministic engine has ALREADY decided the numbers; this only turns them
// into a warm, plain-English explanation + one tip. Guardrailed so it can't invent numbers or give
// medical/extreme advice, and it's optional (needs a key, degrades gracefully offline). Returns text.
async function coachNarrative(key, payload) {
  const rules = 'You are Macrosaurus, a warm but honest UK body-composition coach. A deterministic engine has ALREADY decided this week\'s calorie change from the user\'s weight trend and intake. Do NOT invent, recalculate, or contradict any number, refer only to the figures given. In 2-3 short sentences, explain in plain UK English what this week\'s result means for the user, then give ONE concrete, evidence-aligned tip for the coming week (e.g. logging consistency, hitting the protein target, weighing in daily, or being patient with the weight trend). STEPS-FIRST COACHING: if steps_recommendedLever is "steps", make that one tip about daily activity, getting steps back up toward steps_suggestTargetPerDay a day, and if steps_avgThisCycle is below steps_avgPrevCycle say plainly that the loss slowed but so did the steps; a good coach lifts steps before cutting food. If steps_recommendedLever is "calories", note the steps are already solid (around steps_avgThisCycle a day) so the small calorie change is the right move this time. If the step fields are null, ignore steps entirely. No medical or supplement advice, no crash-dieting or extreme measures, no emojis, no headings, no bullet points, no markdown, no em dashes. Address the user directly as "you".';
  const prompt = rules + '\n\nThis week\'s check-in result (JSON):\n' + JSON.stringify(payload) + '\n\nCoach\'s take:';
  const j = await aiRequest({ model: AI_MODEL_FAST, max_tokens: 240, messages: [{ role: 'user', content: prompt }] });
  return ((j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '').trim();
}
// Deterministic steps-first line for the check-in result screen. Shows even when the AI coach is
// offline, and mirrors the lever the engine picked. British English, no em dashes (house style).
function stepsCoachLine(sc) {
  if (!sc || !sc.hasData || sc.lever === 'none') return null;
  const k = n => Math.round(n).toLocaleString('en-GB');
  if (sc.lever === 'steps') {
    return (sc.droppedVsPrev && sc.prevAvg)
      ? `Before we touch your food: your steps dropped from about ${k(sc.prevAvg)} to ${k(sc.avg)} a day this cycle. Get them back up towards ${k(sc.suggestTarget)} and that alone should get the scale moving again.`
      : `Before we touch your food: you averaged about ${k(sc.avg)} steps a day, under your ${k(sc.baseline)} baseline. Lifting them towards ${k(sc.suggestTarget)} is the first lever to pull, and easier to hold than eating less.`;
  }
  return `Your steps held up well this cycle (about ${k(sc.avg)} a day), so there is no easy activity left to add. That is why the small calorie change above is the right call this time.`;
}
// ---- Recipe extraction + structuring --------------------------------------------------------
// Fetch the public text behind a shared YouTube/Instagram/TikTok link via the recipe-extract Edge Function.
// Returns { ok, platform, title, author, thumbnail, sourceText, note }. Signed-in only (like aiRequest).
async function extractRecipeSource(url) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token;
  if (!token) throw new Error('Please sign in to import recipes.');
  const res = await fetch(RECIPE_EXTRACT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify({ url }),
  });
  const j = await res.json().catch(() => ({ ok: false, note: 'Could not reach the extractor.' }));
  return j;
}
// Instagram (and increasingly YouTube) thumbnail links are signed and expire, so the extractor also
// sends the image bytes (thumb_b64). Inline them as a compact data URL, the same way user photos are
// stored, so recipe art never rots when the CDN link dies. Returns '' when no bytes came back.
async function inlineThumb(src) {
  try {
    if (!src || !src.thumb_b64) return '';
    const bin = atob(src.thumb_b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const im = await imageToB64(new Blob([arr], { type: src.thumb_mime || 'image/jpeg' }), 640);
    return 'data:' + im.mime + ';base64,' + im.b64;
  } catch (e) { return ''; }
}
// Full-resolution cover blob from the extractor's bytes, for the vision fallback (inlineThumb caps at
// 640px for durable art; on-screen ingredient text reads better from the original). Null if no bytes.
function coverBlobFromSrc(src) {
  try {
    if (!src || !src.thumb_b64) return null;
    const bin = atob(src.thumb_b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: src.thumb_mime || 'image/jpeg' });
  } catch (e) { return null; }
}
// Turn extracted source text into a normalised recipe via the existing ai-proxy. `meta` carries the
// platform/url/thumbnail we already know so the model doesn't have to guess them.
async function structureRecipe(sourceText, meta) {
  // Fast model: parsing a written recipe into lines + steps is straightforward, and the user reviews
  // it, so speed matters more than the big model here. 4096 tokens to avoid truncation on long recipes.
  const j = await aiRequest({ model: AI_MODEL_FAST, max_tokens: 4096, messages: [{ role: 'user', content: RECIPE_PROMPT + '\n\nSOURCE TEXT:\n' + sourceText }] });
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
  return Rcp.normalize(parseModelJSON(txt), meta || {});
}
// Vision path: structure a recipe straight from image(s): a shared video's cover frame or the user's
// screenshots (reuses claudeVision). `hint` is any caption/title text we did manage to read, used as a
// weak hint while the image stays the source of truth for ingredients.
async function structureRecipeFromImages(files, meta, hint) {
  const ctx = hint && String(hint).trim()
    ? '\n\nThe post caption/title (a hint only, trust the image for ingredients):\n' + String(hint).trim()
    : '';
  const raw = await claudeVision(null, files, RECIPE_PROMPT + '\n\nThe recipe is shown in the attached image(s) (a video cover frame or screenshot); read any on-screen text carefully. If the image genuinely shows no recipe, return empty ingredients.' + ctx, { model: AI_MODEL_FAST, maxTokens: 4096, maxImg: 1024 });
  return Rcp.normalize(raw, meta || {});
}
// ---- Nutrition analysis (ingredient lines -> macros) ----------------------------------------
// AI fallback for when the nutrition database is unavailable: one cheap Haiku call estimates the
// macros for the AMOUNT in each ingredient line. Returns the same shape as the Edamam proxy.
async function aiAnalyzeLines(lines) {
  const prompt = 'For each UK recipe ingredient line below (each line includes an amount), estimate the nutrition FOR THAT AMOUNT using a typical UK product. Respond ONLY with compact JSON: {"items":[{"grams": number, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number}]}, one entry per line IN ORDER. grams = the weight of that amount. British English. Lines:\n' + lines.map((l, i) => (i + 1) + '. ' + l).join('\n');
  const j = await aiRequest({ model: AI_MODEL_FAST, max_tokens: 1600, messages: [{ role: 'user', content: prompt }] });
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
  const items = parseModelJSON(txt).items || [];
  return { source: 'ai', per_ingredient: lines.map((line, i) => { const it = items[i] || {}; return { line, weight: +it.grams || 0, macros: { kcal: Math.round(+it.kcal || 0), protein: +(+it.protein_g || 0).toFixed(1), carbs: +(+it.carbs_g || 0).toFixed(1), fat: +(+it.fat_g || 0).toFixed(1), fiber: +(+it.fiber_g || 0).toFixed(1) } }; }) };
}
// ---- Shared recipe library (Discover) --------------------------------------------------------
// Contribute a recipe to the anonymised shared pool (fire-and-forget). Only priced, attributable
// recipes; no photos or user data leave the account. Called on save when the user has opted in.
async function submitPublicRecipe(recipe) {
  try {
    if (!supa || !recipe || !recipe.source_url) return;
    const m = recipe.macros_per_serving || {}; if (!(m.kcal > 0)) return;
    const sess = (await supa.auth.getSession()).data.session; if (!sess) return;
    const t = recipe.tags || {};
    await supa.rpc('submit_public_recipe', {
      p_source_url: recipe.source_url, p_source_platform: recipe.source_platform || '', p_title: recipe.title || 'Recipe', p_servings: recipe.servings || 1,
      p_ingredients: (recipe.ingredients || []).map(i => Rcp.lineOf(i)), p_steps: recipe.steps || [],
      p_kcal: m.kcal || 0, p_protein: m.protein || 0, p_carbs: m.carbs || 0, p_fat: m.fat || 0, p_fiber: m.fiber || 0, p_private: !!recipe.private,
      // Credit the original creator, carry the (inlined) thumbnail, and the taxonomy so the finder can filter.
      p_source_author: recipe.source_author || '', p_thumbnail: recipe.thumbnail || '',
      p_meal: t.meal || '', p_cuisine: t.cuisine || '', p_main: t.main || '', p_effort: t.effort || '',
    });
  } catch (e) { /* fire and forget */ }
}
// Browse the shared pool: creator-credited, image-rich, protein-ranked, filterable by fit/meal/cuisine/creator/search.
async function browsePublicRecipes(opts) {
  opts = opts || {};
  if (!supa) return [];
  const r = await supa.rpc('browse_recipes', {
    p_kcal_max: opts.kcalMax != null ? opts.kcalMax : null, p_min_protein: opts.minProtein || 0, p_limit: opts.limit || 60,
    p_meal: opts.meal || null, p_cuisine: opts.cuisine || null, p_creator: opts.creator || null, p_search: (opts.search && opts.search.trim()) || null,
    p_main: opts.main || null, p_effort: opts.effort || null,
  });
  if (r.error) throw new Error(r.error.message);
  return r.data || [];
}
// The creators in the shared pool, most recipes first, for the "filter by creator" row.
async function browseRecipeCreators() {
  if (!supa) return [];
  const r = await supa.rpc('browse_recipe_creators', { p_limit: 40 });
  if (r.error) return [];
  return r.data || [];
}
// Analyse a recipe's ingredient lines into macros, cheapest source first, so a typical recipe prices
// for free and AI is a genuine fallback. Per line, in order:
//   1. Standard measures: "1 tbsp"/"2 cloves" -> grams (Rcp.gramsForLine), and pure staples
//      (oil, butter, sugar, flour...) priced from a built-in table. No network, no AI.
//   2. Open Food Facts: a confident name match, priced per-100g x grams.
//   3. AI: whatever is left, in one batched call.
// Returns { source: 'table'|'off'|'ai'|'mixed'|'none', per_ingredient } aligned by index (source per item).
async function analyzeRecipe(title, lines) {
  const clean = (lines || []).map(s => String(s || '').trim()).filter(Boolean);
  if (!clean.length) return { source: 'none', per_ingredient: [] };
  const per = new Array(clean.length).fill(null);
  await Promise.all(clean.map(async (line, i) => {
    const grams = Rcp.gramsForLine(line);
    const staple = Rcp.stapleMacros(line, grams);
    if (staple) { per[i] = { line, weight: grams, macros: staple, source: 'table' }; return; }
    const name = Rcp.nameFromLine(line);
    if (!(grams > 0) || !name) return;
    try {
      const best = Rcp.bestOffMatch(name, await offSearchByName(name));
      if (best) per[i] = { line, weight: grams, macros: Rcp.macrosFromPer100(best.per100, grams), source: 'off' };
    } catch (e) { /* fall to AI */ }
  }));
  const missIdx = clean.map((_, i) => i).filter(i => !per[i]);
  if (missIdx.length) {
    try {
      const ai = await aiAnalyzeLines(missIdx.map(i => clean[i]));
      (ai.per_ingredient || []).forEach((p, k) => { const i = missIdx[k], m = p && p.macros; if (m && (m.kcal || m.protein || m.carbs || m.fat)) per[i] = { line: clean[i], weight: +p.weight || Rcp.gramsForLine(clean[i]) || 0, macros: m, source: 'ai' }; });
    } catch (e) { /* leave unresolved; user can retry or set manually */ }
  }
  const kinds = {}; per.forEach(p => { if (p && p.source) kinds[p.source] = 1; });
  const list = Object.keys(kinds);
  return { source: list.length > 1 ? 'mixed' : list[0] || 'none', per_ingredient: per.map(p => p || { macros: null }) };
}
// Robustly parse the single JSON object the AI returns. LLMs occasionally add a trailing
// comma before a ] or }, wrap the JSON in ``` fences, or (if truncated) leave brackets open , 
// strict JSON.parse rejects all of these, so we clean and, as a last resort, auto-close.
function parseModelJSON(txt) {
  const s = String(txt || '').replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no data returned');
  // Walk from the first "{" and balance braces, ignoring any inside strings.
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } } }
  }
  const core = end >= 0 ? s.slice(start, end + 1) : s.slice(start);
  const stripped = core.replace(/,(\s*[}\]])/g, '$1'); // drop trailing commas
  const candidates = [core, stripped, autoClose(stripped)];
  for (const c of candidates) { try { return JSON.parse(c); } catch (e) { /* try next */ } }
  // Last resort: response was truncated mid-element, drop the incomplete tail back to the
  // last complete } or ] and re-close, salvaging whatever parsed cleanly.
  let work = stripped;
  for (let guard = 0; guard < 300 && work.length > start + 1; guard++) {
    const cut = Math.max(work.lastIndexOf('}'), work.lastIndexOf(']'));
    if (cut < 0) break;
    const closed = autoClose(work.slice(0, cut + 1).replace(/,\s*$/, ''));
    try { return JSON.parse(closed); } catch (e) { /* keep trimming */ }
    work = work.slice(0, cut);
  }
  throw new Error("couldn't read the estimate, please try again");
}
// Close any brackets/quote left open by a truncated response so JSON.parse can succeed.
function autoClose(json) {
  let inStr = false, esc = false; const stack = [];
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (c === '{' || c === '[') stack.push(c); else if (c === '}' || c === ']') stack.pop(); }
  }
  let out = json.replace(/,\s*$/, '');
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}
const LABEL_PROMPT = 'Read this nutrition label carefully and return ONLY the numbers printed on it. UK labels usually have a PER 100 g / 100 ml column, and sometimes also a PER SERVING / PER PORTION / PER PACK column. Read each column EXACTLY as printed. Do NOT convert, scale, invent or mix columns. Return ONLY compact JSON: {"name": string, "serving_g": number, "serving_label": string, "per_serving": {"kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number}, "per_100g": {"kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number}, "macros_estimated": boolean}. per_100g = the per-100 g/ml column (all 0 if not printed). per_serving = the per-serving/portion/pack column (all 0 if not printed). If only one column exists, fill it and leave the other all 0; NEVER scale one column into the other. serving_g and serving_label describe ONE natural unit the person would count and log, chosen in this priority order: (1) if the pack states a piece/item COUNT and a total pack WEIGHT (for example "12 meatballs" with "340 g", or "6 fish fingers 200 g"), set serving_g to the weight of ONE piece = round(total weight divided by count) and serving_label to a singular piece name like "1 meatball" or "1 fish finger"; (2) else if a single serving or portion size is stated (for example "per 30 g", "1 pot 125 g"), use it with a label like "1 pot" or "1 serving"; (3) else if only a whole pack/can/bottle size is stated, use it with a label like "1 can"; (4) else serving_g 0 and serving_label "". Use the product photo and all pack text (piece count, total weight, "contains N portions") to work this out. ACCURACY IS CRITICAL: read the EXACT printed digits for every value that is visible on the label (for example if it prints "Fat 2.5g", return 2.5, not a rounded or guessed number). Look carefully at the small print. Only when a macro is genuinely absent, blank or physically unreadable should you ESTIMATE it from the product name/type and the stated calories so that protein_g×4 + carbs_g×4 + fat_g×9 approximately equals the stated kcal for that column, and set "macros_estimated": true; if every macro was read directly from the label, set it false. Never leave a macro at 0 when calories are printed unless the label genuinely states 0. Write the product name in British English spelling, keeping the JSON keys exactly as specified.';
const AI_PROMPT = 'You are a BRUTALLY HONEST UK nutrition estimator helping someone log a meal accurately to build muscle and lose fat. Accuracy over reassurance. Most people badly UNDER-count, so never lowball and never round down.\n\nMETHOD, anchor to real published nutrition where you can:\n- RESTAURANT / CHAIN meals: if the dish matches a known UK chain (e.g. Pizza Express, Zizzi, Franco Manca, Nando\'s, Wagamama, Wetherspoons and other pub chains like Greene King, Pret, Greggs, Five Guys, McDonald\'s, KFC), use that chain\'s PUBLISHED nutrition for the closest matching menu item as your baseline, then adjust for what you can see (size, extra cheese, sides, sauces, dips). If the user names the place or dish, use it.\n- TAKEAWAY (curry house, kebab, chippy, independent): assume more oil, ghee, butter and bigger portions than a chain equivalent, these are calorie-dense, so err high.\n- HOME-COOKED: estimate from the visible ingredients and typical home portions, and count the cooking oils, butter and sauces.\nCount everything the eye misses: oils, butter, dressings, mayo, breading, glazes, cheese and sides. Use every clue from the image(s) and notes, and break the meal into its components.\n\nRespond ONLY with compact JSON: {"name": string, "items": [{"name": string, "grams": number, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "user_specified": boolean, "assumption": string}], "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "kcal_low": number, "kcal_high": number, "confidence": "low"|"medium"|"high", "assumptions": string}. Top-level totals are your best single estimate for the WHOLE portion and must equal the sum of the items. ALWAYS estimate fiber_g for every item and the total from the foods present, vegetables, salad, wholegrains, beans, fruit, potato skins, wholemeal bread all carry fibre; lean meat and most sauces carry little to none. Never leave fibre at 0 when fibrous foods are present. kcal_low/kcal_high = an honest plausible range (wider when unsure). grams = estimated cooked weight (0 only if impossible). CRITICAL: if the user states an explicit weight or countable portion for a food (e.g. "225g of chicken", "2 eggs", "a 30g scoop of whey", "1 tbsp olive oil"), treat it as EXACT and authoritative: set that item\'s grams to the stated weight (convert counts and spoons to grams using standard weights), derive its kcal and macros from a realistic per-100g profile for that food at that weight, and set "user_specified": true. Never override, round or second-guess a weight the user gave you. For any food the user did not quantify, set "user_specified": false and estimate grams as usual. "assumption" = a short per-item note, e.g. "Pizza Express Margherita baseline, ~11in" or "fried in ~1 tbsp oil". "assumptions" = one short sentence on the biggest drivers and any chain you anchored to. If unsure, err to the realistic higher end. Do not round down. Write all text fields (name, assumption, assumptions) in British English spelling (e.g. fibre, yoghurt, flavour, caramelised), while keeping the JSON keys exactly as specified.';
const RECIPE_PROMPT = 'You are a UK recipe parser for a macro-tracking app. You are given the text behind a shared cooking video (a title, description, spoken transcript and/or caption). Reconstruct the recipe as accurately as you can, filling sensible gaps from standard cooking knowledge but never inventing ingredients the text does not support. Do NOT estimate nutrition (a nutrition database does that from the ingredient lines). Respond ONLY with compact JSON: {"title": string, "servings": number, "source_platform": string, "ingredients": [string], "steps": [string], "stated_macros_per_serving": {"kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number} | null, "macros_confidence": "low"|"medium"|"high", "tags": {"meal": string, "cuisine": string, "main": string, "effort": string, "diet": [string]}}. ingredients = an array of plain ingredient LINES, each written like a shopping/recipe list item: the AMOUNT then the FOOD, ready to look up in a nutrition database, for example "150 g cottage cheese", "1 tbsp olive oil", "2 cloves garlic", "1 wholemeal pitta", "200 g chicken breast". Prefer metric weights (g/ml) and give your best weight when the source is vague, but keep natural counts for whole items (eggs, cloves, slices, pittas). Every line MUST include both an amount and the food, and MUST NOT include brand names or nutrition. servings = how many portions the recipe makes (estimate from the quantities if unstated; never 0). steps = the method as short ordered instructions. stated_macros_per_serving = ONLY the per-serving nutrition the source EXPLICITLY states (e.g. the caption says "480 kcal, 42g protein per serving"); if it does not clearly state per-serving macros, return null, do not estimate. macros_confidence reflects how complete the source text was. tags = classify the dish for browsing, using ONLY these values: meal is one of breakfast, lunch, dinner, snack, dessert, drink (or "" if genuinely unclear); cuisine is one of british, italian, indian, chinese, thai, mexican, japanese, mediterranean, middle-eastern, american, french, korean, vietnamese, greek, spanish, caribbean, or other; main is the primary protein or base ingredient, one of chicken, beef, pork, lamb, fish, seafood, eggs, tofu, beans, veg, cheese, or other; effort is quick (roughly 15 minutes or under, few steps), standard, or project (long or involved); diet is an array of any that clearly apply from high-protein, vegetarian, vegan, pescatarian, gluten-free, dairy-free (empty array if none clearly apply). Write all text in British English spelling (fibre, yoghurt, flavour), keeping the JSON keys exactly as specified.';
// Backfill classifier for recipes imported before tagging existed: title + ingredient lines are
// enough to bucket a dish, so this is one cheap fast-model call, no re-extraction of the video.
const TAG_PROMPT = 'You classify a UK recipe for a macro-tracking app\'s browse filters. Respond ONLY with compact JSON {"meal": string, "cuisine": string, "main": string, "effort": string, "diet": [string]} using ONLY these values: meal one of breakfast, lunch, dinner, snack, dessert, drink (or "" if unclear); cuisine one of british, italian, indian, chinese, thai, mexican, japanese, mediterranean, middle-eastern, american, french, korean, vietnamese, greek, spanish, caribbean, other; main (primary protein or base) one of chicken, beef, pork, lamb, fish, seafood, eggs, tofu, beans, veg, cheese, other; effort one of quick, standard, project; diet an array from high-protein, vegetarian, vegan, pescatarian, gluten-free, dairy-free (empty if none). Judge only from what is given.';
// Tag one existing recipe from its title + ingredients. Returns a validated tags object (never throws).
async function tagRecipe(recipe) {
  try {
    const lines = (recipe.ingredients || []).map(i => Rcp.lineOf(i)).filter(Boolean).slice(0, 40);
    const prompt = TAG_PROMPT + '\n\nTitle: ' + (recipe.title || '') + '\nIngredients:\n' + lines.join('\n');
    const j = await aiRequest({ model: AI_MODEL_FAST, max_tokens: 200, messages: [{ role: 'user', content: prompt }] });
    const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
    return Rcp.normTags(parseModelJSON(txt), recipe.steps, recipe.macros_per_serving);
  } catch (e) { return null; }
}
const BF_PROMPT = 'You are a physique coach giving a brutally honest but respectful body-fat estimate from photos. Judge only what you can see: visible abdominal definition, vascularity, muscle separation, waist and love-handle fat, back and side profile. Do not flatter; give the realistic figure. Respond ONLY with compact JSON: {"bodyfat_percent": number, "confidence": "low"|"medium"|"high", "note": string}. note is ONE short, honest, constructive sentence.';

/* ---------- data helpers ---------- */
// Meals shown for a given day: a per-day override if one exists, else the default template.
function mealsForDay(db, date) {
  const dm = db.day_meals && db.day_meals[date];
  const list = (dm && dm.length ? dm : db.meal_templates) || [];
  return list.slice().sort((a, b) => a.sort_order - b.sort_order);
}
// Inside an update(): give this date its own editable meal list (a copy of the default) if it hasn't got one.
function ensureDayMeals(d, date) {
  if (!d.day_meals) d.day_meals = {};
  if (!d.day_meals[date]) d.day_meals[date] = (d.meal_templates || []).map(m => ({ id: m.id, user_id: m.user_id, name: m.name, sort_order: m.sort_order }));
  return d.day_meals[date];
}
function currentTargets(db) { return db.targets.length ? db.targets[db.targets.length - 1] : null; }
function sumMacros(entries) {
  return entries.reduce((a, e) => ({ kcal: a.kcal + (e.computed_macros.kcal || 0), protein: a.protein + (e.computed_macros.protein || 0), carbs: a.carbs + (e.computed_macros.carbs || 0), fat: a.fat + (e.computed_macros.fat || 0), fiber: a.fiber + (e.computed_macros.fiber || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}
function entriesOn(db, date) { return db.log_entries.filter(e => e.date === date); }
// Atwater factors: protein 4, carbs 4, fat 9 kcal/g (alcohol is 7, handled via its own kcal).
function kcalFromMacros(m) { return Math.round((+m.protein || 0) * 4 + (+m.carbs || 0) * 4 + (+m.fat || 0) * 9); }
// Never log a food with real macros but zero/missing calories, fill from the macros.
function normalizeMacros(m, isAlcohol) { const mm = Object.assign({}, m); if (!isAlcohol && (!(+mm.kcal) || +mm.kcal <= 0) && ((+mm.protein) || (+mm.carbs) || (+mm.fat))) mm.kcal = kcalFromMacros(mm); return mm; }
// Smart foods: once you correct a food's numbers, remember them so the next scan or database pick of
// the same food is pre-filled with YOUR values instead of the database's. Keyed by normalised name.
function savedCorrection(db, name) {
  const key = (name || '').trim().toLowerCase(); if (!key) return null;
  return (db.foods || []).find(x => !x.is_alcohol && x.corrected && x.saved_base && x.name.trim().toLowerCase() === key) || null;
}
function savedByBarcode(db, code) { return code ? ((db.foods || []).find(x => x.corrected && x.saved_base && x.barcode === code) || null) : null; }
// Build a confirm-screen payload from community-consensus data (2+ users agreeing on a barcode).
function parsedFromCommunity(c, barcode) {
  const num = { kcal: Math.round(+c.kcal || 0), protein: +c.protein || 0, carbs: +c.carbs || 0, fat: +c.fat || 0, fiber: +c.fiber || 0 };
  const note = 'Verified by ' + c.votes + ' people who scanned this. Edit anything that looks off.';
  const base = { source: 'community', branded: true, barcode: barcode, servingG: +c.serving_g || 0, servingLabel: c.serving_label || null, saved: true, badgeLabel: 'VERIFIED', note: note };
  if (c.basis === 'serving') return Object.assign(base, { perServing: num, initial: { name: c.name || 'Product' } });
  return Object.assign(base, { per100: true, initial: Object.assign({ name: c.name || 'Product' }, num) });
}
function parsedFromSaved(sc, note) {
  const b = sc.saved_base || {};
  const num = { kcal: Math.round(+b.kcal || 0), protein: +b.protein || 0, carbs: +b.carbs || 0, fat: +b.fat || 0, fiber: +b.fiber || 0 };
  if (sc.saved_kind === 'serving') return { perServing: num, source: sc.source || 'custom', branded: true, servingG: +sc.saved_serving_g || 0, servingLabel: sc.saved_serving_label || null, saved: true, note: note, initial: { name: sc.name } };
  return { per100: true, source: sc.source || 'off', branded: true, servingG: +sc.saved_serving_g || 0, servingLabel: sc.saved_serving_label || null, saved: true, note: note, initial: Object.assign({ name: sc.name }, num) };
}
// Average scale weight across a date range, inclusive.
function avgWeight(entries, startISO, endISO) {
  const ws = entries.filter(w => w.date >= startISO && w.date <= endISO && w.scale_weight != null).map(w => w.scale_weight);
  return ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : null;
}
function countWeighIns(entries, startISO, endISO) { return entries.filter(w => w.date >= startISO && w.date <= endISO && w.scale_weight != null).length; }
function recomputeTrend(d) {
  d.weight_entries.sort((a, b) => a.date.localeCompare(b.date));
  const ts = E.trendSeries(d.weight_entries.map(x => ({ date: x.date, weightKg: x.scale_weight })));
  d.weight_entries.forEach((x, i) => x.trend_weight = ts[i].trendKg);
}
function daysBetween(aISO, bISO) { return Math.floor((new Date(bISO + 'T00:00:00') - new Date(aISO + 'T00:00:00')) / 86400000); }
// Start of the current check-in cycle. After a REAL check-in it's the day after (that check-in
// closed the previous cycle), but when the plan was just set up / changed with no check-in yet,
// it's that day itself, so the very first day of tracking isn't orphaned from cycle one.
function cycleStartISO(db, todayISO) {
  if (!db.last_checkin) return shiftISO(todayISO, -6);
  const checkedInOnLast = (db.checkins || []).some(c => c.date === db.last_checkin);
  return shiftISO(db.last_checkin, checkedInOnLast ? 1 : 0);
}
// Planned kcal for a given day: base target plus that day's cycling delta (floor-aware). Used to
// judge whether a logged day is "complete" (>= 60% of plan) without the circular carryover maths.
function plannedKcalOn(db, dISO) {
  const t = currentTargets(db); if (!t) return 0;
  const p = db.profile || {};
  const cyc = (p.cycling && p.cycling.enabled) ? E.cyclingDelta(p.cycling, weekdayIdx(dISO), t.kcal, E.kcalFloor(p)) : 0;
  return t.kcal + cyc;
}
function isCompleteDayOn(db, dISO) { return E.isCompleteDay(sumMacros(entriesOn(db, dISO)).kcal, plannedKcalOn(db, dISO)); }
// Distinct COMPLETE logged dates in a range: part-logged days don't count toward coverage.
function completeLoggedDates(db, startISO, endISO) {
  const dates = Array.from(new Set(db.log_entries.filter(e => e.date >= startISO && e.date <= endISO).map(e => e.date)));
  return dates.filter(dd => isCompleteDayOn(db, dd));
}
// The TDEE the app has LEARNED about this user, if it's recent enough to trust (smoothed expenditure
// first, else the last adaptive target's estimate). Used so goal/profile changes build on learned
// data instead of resetting to the Mifflin formula. Returns null when stale (>= 21 days) or absent.
function learnedTdee(db, todayISO) {
  const ex = db.expenditure;
  if (ex && ex.kcal > 0 && ex.updated && daysBetween(ex.updated, todayISO) < 21) return Math.round(ex.kcal);
  for (let i = (db.targets || []).length - 1; i >= 0; i--) {
    const t = db.targets[i];
    if (t && t.estimatedTDEE > 0 && (t.source || '').indexOf('adaptive') === 0 && t.effective_date && daysBetween(t.effective_date, todayISO) < 21) return Math.round(t.estimatedTDEE);
  }
  return null;
}
// Smoothed-expenditure prior for a check-in: the persisted state, else a fresh formula seed (n=0),
// so the first few cycles blend from Mifflin toward observed data.
function expenditurePrior(db, prof) {
  const ex = db.expenditure;
  if (ex && ex.kcal > 0) return { kcal: ex.kcal, n: +ex.n || 0 };
  return { kcal: E.tdeeFromProfile(prof), n: 0 };
}
function MiniStat({ label, value, ok }) { return (<div className="bg-[#1E1E22] rounded-xl px-3 py-3 text-center"><div className="text-xl font-bold tnum" style={{ color: ok ? 'var(--carb)' : 'var(--muted)' }}>{value}</div><div className="text-[11px] text-[#8A8A90] mt-0.5">{label}</div></div>); }
function Mini({ n, l, c }) { return (<div className="bg-[#1E1E22] rounded-xl px-2 py-2.5 text-center"><div className="text-base font-bold tnum" style={{ color: c }}>{n}</div><div className="text-[10px] text-[#8A8A90] mt-0.5">{l}</div></div>); }
function maintenanceKcal(db) {
  const base = currentTargets(db); const prof = withActivity(db.profile);
  return Math.max(E.kcalFloor(prof), Math.round((base && base.estimatedTDEE) || E.tdeeFromProfile(prof)));
}
function dietBreakActive(db, date) { const b = db.diet_break; return !!(b && date >= b.start && date <= b.end); }
// Research-backed eligibility: only offer a diet break after a sustained, well-tracked
// cut (~6 weeks). MATADOR (Byrne 2018) shows periodic maintenance breaks blunt metabolic
// adaptation and improve fat-loss efficiency. Thresholds keep the dashboard uncluttered.
const DIETBREAK_MIN_DAYS = 42, DIETBREAK_MIN_CHECKINS = 4, DIETBREAK_MIN_LOGGED = 28, DIETBREAK_SNOOZE_DAYS = 14;
function dietBreakStatus(db, today) {
  const p = db.profile || {};
  const logDates = db.log_entries.map(e => e.date);
  const firstLog = logDates.length ? logDates.reduce((a, b) => a < b ? a : b) : null;
  const firstCi = (db.checkins && db.checkins.length) ? db.checkins[0].date : null;
  const dietStart = (firstLog && firstCi) ? (firstLog < firstCi ? firstLog : firstCi) : (firstLog || firstCi || today);
  const anchors = [];
  if (db.last_break_end && db.last_break_end <= today) anchors.push(db.last_break_end);
  if (db.diet_break && db.diet_break.end < today) anchors.push(db.diet_break.end);
  const windowStart = anchors.length ? anchors.reduce((a, b) => a > b ? a : b) : dietStart;
  const daysDieting = Math.max(0, daysBetween(windowStart, today));
  const checkins = (db.checkins || []).filter(c => c.date >= windowStart).length;
  const loggedDays = new Set(logDates.filter(d => d >= windowStart)).size;
  const snoozed = db.diet_break_snooze && today <= db.diet_break_snooze;
  const eligible = p.goalType === 'cut' && !db.paused && !dietBreakActive(db, today)
    && daysDieting >= DIETBREAK_MIN_DAYS && checkins >= DIETBREAK_MIN_CHECKINS && loggedDays >= DIETBREAK_MIN_LOGGED && !snoozed;
  return { eligible, weeks: Math.max(1, Math.floor(daysDieting / 7)) };
}
function effectiveTarget(db, date) {
  let base = currentTargets(db); if (!base) return null;
  const p = db.profile;
  // Diet break: eat at maintenance, no cycling/carryover, goal targets untouched underneath.
  if (dietBreakActive(db, date)) {
    const mk = maintenanceKcal(db);
    const mt = E.macrosFromKcal(mk, Object.assign({}, withActivity(p), { goalType: 'maintain' }));
    base = Object.assign({}, base, { kcal: mk, protein_g: mt.protein_g, carbs_g: mt.carbs_g, fat_g: mt.fat_g });
    return { base, cyc: 0, carry: 0, eff: { kcal: mk, protein_g: mt.protein_g, carbs_g: mt.carbs_g, fat_g: mt.fat_g, deltaKcal: 0 }, onBreak: true };
  }
  // Thin wrapper: all composition maths (cycling, carryover, floor, override) lives in the engine.
  // The carryover window starts ON the last check-in day (inclusive), so that day's own under- or
  // over-eat rolls into the next day instead of vanishing in the gap between cycles. (Coverage/cadence
  // still uses cycleStartISO, which excludes the check-in morning.) Only COMPLETE logged days count.
  const cs = db.last_checkin ? db.last_checkin : shiftISO(date, -6);
  const eatenByDate = {};
  if (p.carryover && p.carryover.enabled) {
    db.log_entries.forEach(e => { if (e.date >= cs && e.date < date) eatenByDate[e.date] = (eatenByDate[e.date] || 0) + (e.computed_macros ? e.computed_macros.kcal : 0); });
  }
  const ov = (db.day_overrides || {})[date];
  return E.composeDayTarget({
    base, date, floorKcal: E.kcalFloor(p),
    cycling: p.cycling, carryover: p.carryover,
    cycleStart: cs, eatenByDate,
    overrideShiftKcal: (ov && ov.shiftKcal) || 0,
  });
}

/* ---------- primitives ---------- */
const inputCls = "w-full bg-[#1E1E22] pixel-box px-4 py-3 text-[var(--text)] focus:outline-none";
// Select all on focus so a field showing a default "0" is replaced as soon as you type, no fiddly deleting.
// Number field that's easy to overwrite: tapping a lone "0" clears it (select() alone is
// unreliable on mobile), and selects the text otherwise. Empty coerces back to 0 on save.
function NumInput(props) {
  const { onChange, onFocus, ...rest } = props;
  return <input type="number" inputMode="decimal" className={inputCls} {...rest} onChange={onChange}
    onFocus={(e) => {
      const v = props.value;
      if ((v === 0 || v === '0') && onChange) onChange({ target: { value: '' } });
      else { try { e.target.select(); } catch (_) { } }
      if (onFocus) onFocus(e);
    }} />;
}
function TextInput(props) { return <input type="text" className={inputCls} {...props} />; }
function Field({ label, children, hint }) { return (<label className="block mb-3.5"><div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">{label}</div>{children}{hint && <div className="text-[12px] text-[#8A8A90] mt-1.5 leading-snug">{hint}</div>}</label>); }
function Btn({ children, onClick, kind = 'primary', className = '', ...rest }) {
  const s = { primary: 'bg-white text-black font-bold', accent: 'bg-white text-black font-bold', ghost: 'bg-[#1E1E22] text-[var(--text)]', danger: 'bg-[#ff6b6b] text-black font-bold' };
  return <button onClick={onClick} className={`pixel-btn px-4 py-3 ${s[kind]} ${className}`} {...rest}>{children}</button>;
}
// One consistent "Add photo" control used across every photo/AI add-food flow. No `capture` flag,
// so the native picker offers Camera, Photo Library and Files in a single tap, same on all flows.
function PhotoButton({ label = 'Add photo', multiple = false, onFiles, tone = 'raised', className = '' }) {
  const bg = tone === 'inset' ? 'bg-[#0F0F12]' : 'bg-[#1E1E22]';
  return (
    <label className={`flex items-center justify-center gap-2 ${bg} rounded-2xl py-3 text-[13px] border border-[#262629] cursor-pointer active:scale-[.99] transition ${className}`}>
      <Icon.cam width="16" height="16" style={{ color: CAL }} /> {label}
      <input type="file" accept="image/*" multiple={multiple} className="hidden" onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
    </label>
  );
}
function Card({ children, className = '', ...rest }) { return <div className={`bg-[#161618] pixel-box ${className}`} {...rest}>{children}</div>; }
function Section({ title, children, className = '' }) { return (<div className={'mb-6 ' + className}><div className="text-lg font-bold mb-3">{title}</div>{children}</div>); }
function ConfirmDialog({ title, body, confirmLabel = 'Delete', confirmKind = 'danger', onConfirm, onClose }) {
  useBackClose(onClose);
  return (<div className="fixed inset-0 z-[85] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-[#0F0F12] w-full max-w-sm pixel-box p-5 fade-in" onClick={e => e.stopPropagation()}>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      {body && <div className="text-[12px] text-[#8A8A90] mb-4 leading-relaxed">{body}</div>}
      <div className="flex gap-2">
        <Btn kind="ghost" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn kind={confirmKind} className="flex-1" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Btn>
      </div>
    </div>
  </div>);
}
function Seg({ value, options, onChange }) { return (<div className="flex gap-2 flex-wrap">{options.map(o => (<button key={o.v} onClick={() => onChange(o.v)} className={`pixel-box flex-1 min-w-[28%] py-2.5 px-2 text-[13px] ${value === o.v ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#C9C9CF]'}`}>{o.l}</button>))}</div>); }
function Pill({ value, options, onChange }) { return (<div className="inline-flex pixel-box bg-[#1E1E22] p-1 gap-1">{options.map(o => (<button key={o.v} onClick={() => onChange(o.v)} className={`px-3.5 py-1.5 text-[12px] font-bold ${value === o.v ? 'bg-white text-black' : 'text-[#8A8A90]'}`}>{o.l}</button>))}</div>); }
function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false); const cur = options.find(o => o.v === value);
  return (<div className="relative"><button onClick={() => setOpen(o => !o)} className={inputCls + ' flex justify-between items-center text-left'}><span className="truncate">{cur ? cur.l : 'Select'}</span><span className="text-[#8A8A90] ml-2">▾</span></button>
    {open && <div className="absolute z-40 mt-1 w-full bg-[#1E1E22] border border-[#262629] rounded-2xl py-1 max-h-56 overflow-y-auto shadow-2xl">{options.map(o => <button key={o.v} onClick={() => { onChange(o.v); setOpen(false); }} className={`block w-full text-left px-4 py-2.5 text-sm hover:bg-[#262629] ${o.v === value ? 'text-[#4A9EEB]' : 'text-white'}`}>{o.l}</button>)}</div>}</div>);
}
function RowToggle({ label, on, onClick }) { return (<button onClick={onClick} className="w-full flex items-center justify-between gap-3 bg-[#1E1E22] pixel-box px-4 py-3 mb-3"><span className="text-sm text-left">{label}</span><span className="pf text-[9px] px-2.5 py-1.5 shrink-0" style={{ background: on ? 'var(--accent)' : 'var(--surface3)', color: on ? 'var(--on-accent)' : 'var(--muted)', border: '2px solid var(--border)' }}>{on ? 'ON' : 'OFF'}</span></button>); }
function Logo({ size = 'text-xl' }) { return (<div className={`${size} font-extrabold tracking-tight flex items-center gap-1.5 text-white`}><PixelDino size={18} color="var(--good)" /><span>Macro<span className="text-[#4A9EEB]">saurus</span></span></div>); }
function rateLabel(r, goalType) {
  const a = Math.abs(r || 0);
  if (goalType === 'gain') {
    if (a <= 0.35) return { t: 'Lean, minimal fat gain', c: CARB };
    if (a <= 0.7) return { t: 'Moderate, some fat gain', c: FAT };
    return { t: 'Fast, more fat to trim later', c: PRO };
  }
  if (a <= 0.35) return { t: 'Gentle, easy to sustain', c: CARB };
  if (a <= 0.7) return { t: 'Moderate, some hunger', c: FAT };
  return { t: 'Aggressive, harder to sustain', c: PRO };
}
// Consistent page header used across every main screen. The little 🦖 is our through-line.
function PageHeader({ kicker, title }) {
  return (<div className="mb-6"><div className="pf text-[9px] uppercase text-[#8A8A90]">{kicker}</div><h1 className="pf text-xl mt-3">{title}</h1></div>);
}
function Loading({ text }) {
  return (<div className="min-h-screen flex flex-col items-center justify-center gap-4 text-[#8A8A90]"><div style={{ animation: 'fade 1.1s ease-in-out infinite alternate' }}><PixelDino size={56} color="var(--good)" /></div><div className="text-sm">{text}</div></div>);
}

/* ---------- back-button layer stack ---------- */
// Every open sheet/modal registers here, backed by ONE sentinel history entry, so the hardware /
// browser back button closes the topmost open layer instead of leaving the app. The sentinel is
// re-armed while layers remain and consumed when the last layer closes programmatically, so
// forward/back navigation stays sane, and a reload with a stale entry in history is harmless.
const BACK_LAYERS = [];
let _backArmed = false;   // our sentinel entry is currently on top of the history stack
let _backIgnore = 0;      // popstates we triggered ourselves (consuming the sentinel)
function _armBack() { if (_backArmed) return; try { window.history.pushState({ msBack: 1 }, ''); _backArmed = true; } catch (e) {} }
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (_backIgnore > 0) { _backIgnore--; return; }
    _backArmed = false;
    if (!BACK_LAYERS.length) return; // stale entry from a reload: let the pop happen quietly
    const top = BACK_LAYERS[BACK_LAYERS.length - 1];
    top.close();
    setTimeout(() => { if (BACK_LAYERS.length) _armBack(); }, 0);
  });
}
function useBackClose(onClose) {
  const ref = useRef(onClose); ref.current = onClose;
  useEffect(() => {
    const layer = { close: () => { if (ref.current) ref.current(); } };
    BACK_LAYERS.push(layer);
    _armBack();
    return () => {
      const i = BACK_LAYERS.indexOf(layer);
      if (i >= 0) BACK_LAYERS.splice(i, 1);
      if (!BACK_LAYERS.length && _backArmed) {
        _backArmed = false; _backIgnore++;
        try { window.history.back(); } catch (e) { _backIgnore--; }
      }
    };
  }, []);
}
// For inline layers (JSX without a dedicated component): mounts the back-close hook and nothing else.
function BackClose({ onClose }) { useBackClose(onClose); return null; }

/* ---------- icons ---------- */
const Icon = {
  dash: (a) => <svg {...a} viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></svg>,
  food: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21c4.5 0 7-3.6 7-8.5C19 8 16 4 12 4S5 8 5 12.5C5 17.4 7.5 21 12 21z" /><path d="M12 4c0-1 .5-2 1.5-2.5" /></svg>,
  strategy: (a) => <svg {...a} viewBox="0 0 24 24" fill="currentColor"><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="7" r="2.4" /><circle cx="7" cy="17" r="2.4" /><circle cx="17" cy="17" r="2.4" /></svg>,
  goal: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></svg>,
  more: (a) => <svg {...a} viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  plus: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M12 5v14M5 12h14" /></svg>,
  cam: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.2" /></svg>,
  barcode: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6v12M7 6v12M11 6v12M15 6v12M19 6v12" /></svg>,
  star: (a) => <svg {...a} viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.3l6-.7z" /></svg>,
  chevron: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>,
  mic: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0" /><path d="M12 17v4M9 21h6" /></svg>,
  recipe: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9a3 3 0 0 1 3 3v15H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>,
  cart: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.2 11.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20.5 8H6" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>,
  gear: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v2.2M12 19.3v2.2M4.2 7l1.9 1.1M17.9 15.9l1.9 1.1M4.2 17l1.9-1.1M17.9 8.1l1.9-1.1" strokeLinecap="round" /></svg>,
  share: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" /></svg>,
  compass: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>,
  sliders: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h11M18 6h2M4 12h2M9 12h11M4 18h7M14 18h6" /><circle cx="16" cy="6" r="1.8" /><circle cx="7" cy="12" r="1.8" /><circle cx="12" cy="18" r="1.8" /></svg>,
  calendar: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>,
};

/* ---------- charts ---------- */
// Range state from the dayQuality thresholds: kcal ±10%, carbs/fat ±20%, protein a 90% floor.
// 'good' = in range, 'near' = within 1.5x the band, 'over' = past the top of the band,
// null = neutral (a day still in progress is never scolded).
// Full-width chunky Game Boy macro bar (label left, value right, pixel bar below).
// The bar always fills left-to-right by how much you have eaten (a progress metaphor) in BOTH
// Consumed and Remaining modes; only the number label changes. The macro keeps its own identity
// colour, a faint tick marks the target, and anything past it fills in the danger colour, so an
// overshoot reads at a glance without a normal mid-day bar ever looking like an alarm.
function PixelBar({ label, eaten, target, color, mode }) {
  const SCALE = 1.15; // track runs to 1.15x target so the tick sits at ~87% and overshoot is visible
  const isRem = mode === 'remaining';
  const over = target > 0 && eaten > target;
  const denom = target > 0 ? target * SCALE : 1;
  const fillPct = target > 0 ? Math.min(eaten, target) / denom * 100 : 0;
  const overPct = over ? Math.min(eaten - target, target * (SCALE - 1)) / denom * 100 : 0;
  const remaining = Math.round(target - eaten);
  return (
    <div className="mb-3">
      <div className="flex justify-between items-end mb-1">
        <span className="pf text-[9px]">{label}</span>
        <span className="tnum text-[13px]">{isRem
          ? (over
            ? <><span className="font-bold" style={{ color: 'var(--danger)' }}>{Math.round(eaten - target)}g</span><span className="text-[#8A8A90]"> over</span></>
            : <><span className="font-bold">{remaining}g</span><span className="text-[#8A8A90]"> left of {Math.round(target)}</span></>)
          : <><span className="font-bold" style={over ? { color: 'var(--danger)' } : undefined}>{Math.round(eaten)}</span><span className="text-[#8A8A90]">/{Math.round(target)}g</span></>}</span>
      </div>
      <div className="pixel-bar relative">
        <i style={{ width: fillPct + '%', background: color, transition: 'width .5s' }} />
        {over && <div className="absolute top-0 bottom-0" style={{ left: fillPct + '%', width: overPct + '%', background: 'var(--danger)' }} />}
        <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: (100 / SCALE) + '%', width: 2, marginLeft: -1, background: 'var(--text)', opacity: 0.3 }} />
      </div>
    </div>
  );
}
// One shared macro summary body used by BOTH the Dashboard macro card and the Food log day card,
// so Consumed/Remaining behaviour and the range feedback are identical everywhere.
function MacroSummaryCard({ et, tot, mode, avg }) {
  const remaining = et.eff.kcal - tot.kcal;
  const ft = E.fiberTarget(et.eff.kcal);
  const isRem = mode === 'remaining';
  const over = remaining < 0;
  const heroColor = over ? 'var(--danger)' : 'var(--hero)';
  const fibreOk = Math.round(tot.fiber) >= ft.min;
  return (<>
    <div className="pf text-[8px] text-[#8A8A90] mb-1">{isRem ? 'KCAL LEFT' : 'KCAL EATEN'}{avg ? ' (AVG)' : ''}</div>
    <div className="flex items-baseline gap-1 mb-4">
      <span className="text-5xl tnum" style={{ color: heroColor }}>{isRem ? Math.abs(Math.round(remaining)) : Math.round(tot.kcal)}</span>
      <span className="text-5xl tnum blink" style={{ color: heroColor }}>_</span>
      <span className="text-[11px] text-[#8A8A90] ml-1">{over ? 'over ' + et.eff.kcal : 'of ' + et.eff.kcal}</span>
    </div>
    <PixelBar label="PROT" eaten={tot.protein} target={et.eff.protein_g} color={PRO} mode={mode} />
    <PixelBar label="CARB" eaten={tot.carbs} target={et.eff.carbs_g} color={CARB} mode={mode} />
    <PixelBar label="FATS" eaten={tot.fat} target={et.eff.fat_g} color={FAT} mode={mode} />
    <div className="text-[11px] mt-2" style={{ color: fibreOk ? 'var(--good)' : 'var(--muted)' }}>FIBRE {Math.round(tot.fiber)} / {ft.min}g{fibreOk ? ' ✓' : ` · ${ft.min - Math.round(tot.fiber)} to go`}</div>
  </>);
}
const DINO_QUOTES = [
  '"KEEP HUNTING! YOUR GOALS ARE WITHIN REACH. DINO-MITE!"',
  '"EAT YOUR PROTEIN OR GO EXTINCT."',
  '"SMALL BITES, BIG GAINS. RAWR."',
  '"THE SCALE WOBBLES DAILY. THE TREND IS WHAT ROARS."',
  '"STAY CONSISTENT, STAY PREHISTORIC."',
  '"ONE GOOD DAY WON\'T DO IT. ONE BAD DAY WON\'T UNDO IT."',
];
// Motivating (not scolding) lines when a user reports an off-plan week, keeps the dino on their side.
const DINO_OFFPLAN = [
  'One off week won\'t undo you, the Macrosaurus has outlasted ice ages. Back on the hunt next cycle.',
  'No extinction here. Shake it off, line up a clean week, and we\'re roaring again.',
  'Even T-rex had off days (and tiny arms). Momentum\'s paused, not lost, go get the next one.',
  'The Macrosaurus dusts you off: one wobble, no drama. Clean cycle next and we retune properly.',
  'Head up, protein up. One honest reset and you\'re back to dino-mite.',
];
function MiniSpark({ points, color }) {
  if (!points || points.length < 2) return <div className="h-10" />;
  const W = 120, H = 40, min = Math.min(...points), max = Math.max(...points), span = (max - min) || 1;
  const d = points.map((v, i) => `${(i / (points.length - 1)) * W},${H - ((v - min) / span) * H}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10"><polyline points={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
function HabitGrid({ days, color }) {
  return (<div className="grid grid-cols-10 gap-1">{days.map((on, i) => <div key={i} className="aspect-square rounded-[3px]" style={{ background: on ? color : 'var(--border)' }} />)}</div>);
}
// Consistency "dig site": one pixel tile per day over the last 12 weeks, week-aligned into columns.
// Each active day is a fossil you uncovered (a Macrodex catch), so the grid doubles as a picture of
// how much of your collection you have earned. Tile = neither / logged or weighed / both.
function ConsistencyHeatmap({ db, today }) {
  const WEEKS = 12, N = WEEKS * 7;
  const logSet = new Set(db.log_entries.map(e => e.date));
  const weighSet = new Set(db.weight_entries.map(w => w.date));
  const start = shiftISO(today, -(N - 1));
  const pad = (new Date(start + 'T00:00:00').getDay() + 6) % 7; // Mon=0, so columns are weeks
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let i = 0; i < N; i++) cells.push(shiftISO(start, i));
  const level = d => (logSet.has(d) ? 1 : 0) + (weighSet.has(d) ? 1 : 0);
  const colorFor = lv => lv === 2 ? 'var(--good)' : lv === 1 ? 'var(--carb)' : 'var(--track)';
  const last7 = Array.from({ length: 7 }, (_, i) => shiftISO(today, -(6 - i)));
  const logWk = last7.filter(d => logSet.has(d)).length, weighWk = last7.filter(d => weighSet.has(d)).length;
  const activeDays = Array.from({ length: N }, (_, i) => shiftISO(start, i)).filter(d => level(d) > 0).length;
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="pf text-[9px] uppercase text-[#8A8A90] inline-flex items-center gap-1.5"><PixelDino size={13} color="var(--good)" /> Consistency</span>
        <span className="pf text-[8px] uppercase text-[#8A8A90]">Last {WEEKS} wks</span>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-bold tnum" style={{ color: 'var(--good)' }}>{activeDays}</span>
        <span className="text-[10px] text-[#8A8A90] leading-tight">active days,<br />each one hatched a catch</span>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: '3px' }}>
        {cells.map((d, i) => <div key={i} title={d || ''} style={{ aspectRatio: '1 / 1', background: d ? colorFor(level(d)) : 'transparent', boxShadow: d && level(d) > 0 ? 'inset -1px -1px 0 rgba(0,0,0,0.22)' : 'none' }} />)}
      </div>
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-[#8A8A90]">
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 inline-block" style={{ background: 'var(--track)' }} /> none</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 inline-block" style={{ background: 'var(--carb)' }} /> one</span>
        <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 inline-block" style={{ background: 'var(--good)' }} /> logged and weighed</span>
        <span className="ml-auto tnum">This week: {logWk}/7 logged · {weighWk}/7 weighed</span>
      </div>
    </Card>
  );
}
// Adaptive weight-app chart. FEW points → your ACTUAL weight is the bold line with markers, so real
// movement shows. MANY points (long range) → the smoothed TREND becomes the bold line (a moving
// average across the range) and raw weight fades to a faint background, so a year of daily weigh-ins
// stays readable. Points are spaced by real date, and tapping selects the nearest weigh-in.
function LineChart({ points, trend, color, decimals, unitLabel }) {
  const [sel, setSel] = useState(null);
  const H = 150, W = 320, padL = 30, padR = 8, padT = 14, padB = 18, plotW = W - padL - padR;
  const pts = (points || []).filter(p => p.value != null);
  if (pts.length < 2) return <div className="h-[150px] flex items-center justify-center text-center text-[12px] text-[#8A8A90] px-6">Weigh in on another day and your weight line will appear here.</div>;
  const trendPts = (trend || []).filter(p => p.value != null);
  const allVals = pts.map(p => p.value).concat(trendPts.map(p => p.value));
  let min = Math.min(...allVals), max = Math.max(...allVals);
  if (min === max) { min -= 1; max += 1; } const pad = (max - min) * 0.18; min -= pad; max += pad;
  const ms = d => new Date(d + 'T00:00:00').getTime();
  const t0 = ms(pts[0].date), t1 = ms(pts[pts.length - 1].date), tspan = (t1 - t0) || 1;
  const Xd = d => padL + ((ms(d) - t0) / tspan) * plotW;   // space by real date, not index
  const Y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const dense = pts.length > 45;                            // long range → lead with the trend
  const useTrend = dense && trendPts.length >= 2;
  const rawStr = pts.map(p => `${Xd(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const trendStr = trendPts.map(p => `${Xd(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const primaryPts = useTrend ? trendPts : pts;
  const area = `${Xd(primaryPts[0].date).toFixed(1)},${Y(min).toFixed(1)} ` + (useTrend ? trendStr : rawStr) + ` ${Xd(primaryPts[primaryPts.length - 1].date).toFixed(1)},${Y(min).toFixed(1)}`;
  const trendByDate = {}; trendPts.forEach(p => { trendByDate[p.date] = p.value; });
  const ticks = [max - pad * 0.4, (max + min) / 2, min + pad * 0.4];
  const fmtd = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const dec = decimals != null ? decimals : 1;
  const gid = 'lg' + color.replace(/[^a-z0-9]/gi, '');
  const suffix = unitLabel ? ' ' + unitLabel : '';
  const selPt = sel ? pts.find(p => p.date === sel) : null;
  const selX = selPt ? Xd(selPt.date) : 0;
  const selY = selPt ? Y(selPt.value) : 0;
  const boxW = 66, boxH = (selPt && trendByDate[selPt.date] != null) ? 32 : 22;
  const bx = Math.max(2, Math.min(W - boxW - 2, selX - boxW / 2));
  const by = selPt ? (selY < H / 2 ? Math.min(H - padB - boxH, selY + 9) : Math.max(padT, selY - boxH - 9)) : 0;
  // Tap anywhere: select the nearest weigh-in (works at any density); tap empty space to dismiss.
  function pick(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = null, bd = Infinity;
    pts.forEach(p => { const d = Math.abs(Xd(p.date) - sx); if (d < bd) { bd = d; best = p; } });
    setSel(best && bd < 22 ? (sel === best.date ? null : best.date) : null);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H, cursor: 'pointer' }} onClick={pick}>
      <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {ticks.map((t, i) => { const y = Y(t); return <g key={i}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--border)" strokeWidth="1" /><text x={2} y={y + 3} fill="var(--muted)" fontSize="8">{t.toFixed(dec)}</text></g>; })}
      <polygon points={area} fill={`url(#${gid})`} />
      {selPt && <line x1={selX} y1={padT} x2={selX} y2={H - padB} stroke={color} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />}
      <polyline points={rawStr} fill="none" stroke={color} strokeWidth={useTrend ? 1 : 2} opacity={useTrend ? 0.3 : 1} strokeLinejoin="round" strokeLinecap="round" />
      {trendStr && <polyline points={trendStr} fill="none" stroke={color} strokeWidth={useTrend ? 2 : 1.5} opacity={useTrend ? 1 : 0.4} strokeDasharray={useTrend ? '' : '4 3'} strokeLinejoin="round" strokeLinecap="round" />}
      {!dense && pts.map((p, i) => <circle key={'m' + i} cx={Xd(p.date)} cy={Y(p.value)} r={sel === p.date ? 3.4 : 2.2} fill={color} />)}
      {selPt && <circle cx={selX} cy={selY} r="3.4" fill={color} />}
      <text x={padL} y={H - 4} fill="var(--muted)" fontSize="8">{fmtd(pts[0].date)}</text>
      <text x={W - padR} y={H - 4} fill="var(--muted)" fontSize="8" textAnchor="end">{fmtd(pts[pts.length - 1].date)}</text>
      {selPt && <g style={{ pointerEvents: 'none' }}>
        <rect x={bx} y={by} width={boxW} height={boxH} rx="3" fill="var(--surface2)" stroke="var(--border)" strokeWidth="1" />
        <text x={bx + 5} y={by + 9} fill="var(--muted)" fontSize="7.5">{fmtd(selPt.date)}</text>
        <text x={bx + 5} y={by + 19} fill="var(--text)" fontSize="9" fontWeight="bold">{(+selPt.value).toFixed(dec)}{suffix}</text>
        {trendByDate[selPt.date] != null && <text x={bx + 5} y={by + 28} fill="var(--muted)" fontSize="7">trend {(+trendByDate[selPt.date]).toFixed(dec)}</text>}
      </g>}
    </svg>
  );
}
// Signed weight delta in the user's unit (small deltas read better in lb than st/lb).
function fmtWeightDelta(kg, unit, suffix) {
  if (kg == null || isNaN(kg)) return '–';
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '';
  const a = Math.abs(kg);
  const body = unit === 'st_lb' ? `${(a * 2.20462).toFixed(1)} lb` : `${a.toFixed(1)} kg`;
  return `${sign}${body}${suffix || ''}`;
}
function TrendCard({ db }) {
  const [tab, setTab] = useState('weight');
  const [range, setRange] = useState(90);
  const unit = db.profile.weight_unit;
  const today = Store.todayISO();
  const cut = range === 'all' ? '0000-00-00' : shiftISO(today, -range);
  const ents = db.weight_entries.slice().filter(e => e.date >= cut).sort((a, b) => a.date.localeCompare(b.date));
  const toDisp = kg => unit === 'st_lb' ? +(kg * LB_PER_KG).toFixed(1) : +kg.toFixed(1);
  const series = ents.map(e => {
    let v = null;
    if (tab === 'weight') v = toDisp(e.trend_weight != null ? e.trend_weight : e.scale_weight);
    else if (tab === 'bodyfat') v = e.bodyfat != null ? +e.bodyfat : null;
    else if (e.bodyfat != null && e.scale_weight != null) v = toDisp(e.scale_weight * (1 - e.bodyfat / 100));
    return { date: e.date, value: v };
  });
  // Raw measured points (scale weight / measured bf / measured lean) so daily values show as dots even when the smoothed line is flat.
  const dots = ents.map(e => {
    let v = null;
    if (tab === 'weight') v = e.scale_weight != null ? toDisp(e.scale_weight) : null;
    else if (tab === 'bodyfat') v = e.bodyfat != null ? +e.bodyfat : null;
    else if (e.bodyfat != null && e.scale_weight != null) v = toDisp(e.scale_weight * (1 - e.bodyfat / 100));
    return { date: e.date, value: v };
  });
  const color = tab === 'weight' ? 'var(--weight)' : tab === 'bodyfat' ? FAT : CARB;
  const yl = tab === 'bodyfat' ? '%' : (unit === 'st_lb' ? 'lb' : 'kg');
  const dec = tab === 'bodyfat' ? 1 : 1;
  // Headline + change track the ACTUAL measured weight (not the smoothed trend), so real movement shows.
  const valid = dots.filter(s => s.value != null);
  const first = valid[0], last = valid[valid.length - 1];
  const delta = (first && last) ? +(last.value - first.value).toFixed(1) : null;
  const rangeLabel = { 7: 'past week', 30: 'past month', 90: 'past 3 months', 180: 'past 6 months', 365: 'past year', all: 'all time' }[range];
  const deltaStr = delta == null ? '' : (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.abs(delta) + (tab === 'bodyfat' ? '%' : ' ' + yl);
  const deltaGood = (delta == null || delta === 0) ? null : (tab === 'bodyfat' ? delta < 0 : tab === 'lean' ? delta > 0 : db.profile.goalType === 'gain' ? delta > 0 : db.profile.goalType === 'cut' ? delta < 0 : true);
  return (
    <Card className="p-4 mb-6">
      <div className="flex gap-1 mb-3 bg-[#1E1E22] p-1 rounded-2xl text-[12px]">
        {[['weight', 'Weight'], ['bodyfat', 'Body Fat'], ['lean', 'Lean Mass']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2 transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}</button>)}
      </div>
      {tab === 'bodyfat' && window.MISPREMIUM === false && (
        <button onClick={() => { try { window.MPAYWALL && window.MPAYWALL({ type: 'premium_required' }); } catch (_) {} }} className="w-full text-left pixel-box p-3 mb-3 flex items-center gap-2" style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent)' }}>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold">Body-fat from a photo</div>
            <div className="text-[10px] text-[#8A8A90] leading-snug mt-0.5">Skip the calipers. Premium estimates your body fat from a progress photo, then charts it here over time.</div>
          </div>
          <span className="pf text-[8px] uppercase shrink-0" style={{ color: 'var(--accent)' }}>Try free ›</span>
        </button>
      )}
      {valid.length === 0 ? (
        <div className="text-center py-8 px-4">
          <div className="flex justify-center mb-3 opacity-40"><PixelDino size={40} color="var(--weight)" /></div>
          <div className="text-[13px] font-semibold mb-1">{tab === 'weight' ? 'No weigh-ins yet' : tab === 'bodyfat' ? 'No body-fat readings yet' : 'No lean-mass data yet'}</div>
          <div className="text-[11px] text-[#8A8A90] leading-relaxed max-w-[16rem] mx-auto">{tab === 'weight' ? 'Add today’s weight from Home and your trend line starts building right here.' : tab === 'bodyfat' ? 'Add a body-fat % with any weigh-in and it’ll chart here over time.' : 'Log a weight and a body-fat % on the same day to see your lean mass tracked here.'}</div>
        </div>
      ) : <>
      <div className="flex items-end justify-between mb-1 px-0.5">
        <div><span className="text-2xl font-bold tnum">{last ? last.value : '–'}</span><span className="text-[11px] text-[#8A8A90] ml-1">{tab === 'bodyfat' ? '%' : yl}</span></div>
        {delta != null && <div className="text-right"><div className="text-[13px] font-semibold tnum" style={{ color: deltaGood == null ? 'var(--muted)' : deltaGood ? 'var(--good)' : 'var(--fat)' }}>{deltaStr}</div><div className="text-[10px] text-[#8A8A90]">{rangeLabel}</div></div>}
      </div>
      <LineChart points={dots} trend={tab === 'weight' ? series : null} color={color} decimals={tab === 'bodyfat' ? 1 : 1} unitLabel={tab === 'bodyfat' ? '%' : yl} />
      <div className="text-[10px] text-[#8A8A90] mt-1 flex items-center gap-3"><span className="inline-flex items-center gap-1"><span style={{ width: 12, height: 2, background: color, opacity: (tab === 'weight' && valid.length > 45) ? 0.3 : 1, display: 'inline-block' }} /> {tab === 'weight' ? 'weight' : 'measured'}</span>{tab === 'weight' && <span className="inline-flex items-center gap-1"><span style={{ width: 12, height: 0, borderTop: `2px ${valid.length > 45 ? 'solid' : 'dashed'} ${color}`, opacity: valid.length > 45 ? 1 : 0.6, display: 'inline-block' }} /> trend{valid.length > 45 ? ' (avg)' : ''}</span>}<span className="ml-auto text-[#8A8A90]">tap a point</span></div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex gap-1">{[['W', 7], ['M', 30], ['3M', 90], ['6M', 180], ['Y', 365], ['All', 'all']].map(([l, v]) => <button key={l} onClick={() => setRange(v)} className={`px-2 py-1 rounded-lg text-[11px] ${range === v ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90]'}`}>{l}</button>)}</div>
        <div className="text-[10px] text-[#8A8A90]">{tab === 'bodyfat' ? '%' : yl}</div>
      </div>
      </>}
    </Card>
  );
}

/* =====================================================================
   AUTH (polished email login)
   ===================================================================== */
// Shown when a user arrives via a password-reset link (Supabase fires a PASSWORD_RECOVERY event and
// puts the session into a recovery state). They set a new password, which logs them straight in.
function ResetPassword({ onDone }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [done, setDone] = useState(false);
  async function save() {
    if (!supa) return;
    if (pw.length < 6) { setMsg('Use at least 6 characters.'); return; }
    if (pw !== pw2) { setMsg("The two passwords don't match."); return; }
    setBusy(true); setMsg('');
    try { const r = await supa.auth.updateUser({ password: pw }); if (r.error) throw r.error; setDone(true); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  return (
    <div className="theme-light min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b-[3px]" style={{ background: 'var(--header)', borderColor: 'var(--border)' }}>
        <div className="pixel-box w-9 h-9 flex items-center justify-center" style={{ background: '#111', borderColor: '#000' }}><PixelDino size={20} color="#fff" /></div>
        <span className="pf text-[12px]" style={{ color: 'var(--header-text)' }}>MACROSAURUS</span>
      </div>
      <div className="flex-1 flex flex-col justify-center px-6 py-10">
        <div className="w-full max-w-sm mx-auto fade-in">
          <h1 className="pf text-lg text-center mb-4" style={{ color: 'var(--header)' }}>SET A NEW PASSWORD</h1>
          {done
            ? <div className="pixel-box bg-[#161618] p-5 text-center" style={{ borderTopColor: 'var(--header)', borderTopWidth: '7px' }}>
                <div className="text-[13px] mb-4">Your password has been updated. You're signed in.</div>
                <button onClick={onDone} className="w-full pixel-btn py-3 text-[11px] pf" style={{ background: 'var(--header)', color: '#fff' }}>CONTINUE TO APP</button>
              </div>
            : <div className="pixel-box bg-[#161618] p-5" style={{ borderTopColor: 'var(--header)', borderTopWidth: '7px' }}>
                <div className="text-[11px] text-[#8A8A90] mb-3 leading-relaxed">Choose a new password for your account.</div>
                <Field label="New password"><input type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={e => setPw(e.target.value)} placeholder="at least 6 characters" /></Field>
                <Field label="Confirm password"><input type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="type it again" /></Field>
                <button onClick={save} className="w-full pixel-btn mt-1 py-3 text-[11px] pf" style={{ background: 'var(--header)', color: '#fff' }}>{busy ? 'SAVING…' : 'SAVE PASSWORD'}</button>
                {msg && <div className="text-[11px] mt-3 text-center" style={{ color: 'var(--danger)' }}>{msg}</div>}
              </div>}
        </div>
      </div>
    </div>
  );
}
// ---- Legal documents -------------------------------------------------------
// Plain-English UK-oriented drafts. Owner should have these reviewed by a solicitor before charging,
// and fill in the registered legal entity, address and (if applicable) ICO registration.
const LEGAL_UPDATED = "17 July 2026";
const LEGAL = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      { h: "Who we are", p: "Macrosaurus (\"we\", \"us\") provides an adaptive nutrition and body-composition tracking app. We are the data controller for the personal information described here. For any question or request, contact olly@macrosaurus.com." },
      { h: "Information we collect", p: "Your account details (email, and a password handled securely by our authentication provider); the profile and health inputs you enter (sex, age, height, weight, body fat, activity level and goals); your logs (food, drinks, weigh-ins and check-ins); any photos you choose to submit for AI estimation; records of your AI usage (call counts and cost); basic technical data needed to run the app; and privacy-friendly usage analytics and crash reports (which app actions you take and any errors, tied to your account id but never your food names, photos or health values)." },
      { h: "Why we use it, and our legal bases", p: "To provide the service and calculate your targets (performance of our contract with you). To process health-related information such as weight and body fat (your explicit consent, which you give by entering it and can withdraw at any time by deleting it or your account). To keep the service secure and to improve it (our legitimate interests). And to handle billing where a paid plan applies." },
      { h: "AI features", p: "When you use photo or text estimation, the content you submit is sent to our AI provider, Anthropic, to generate an estimate that is returned to you. Photos are not stored by us after processing, and your inputs are not used to train AI models. Anthropic processes this data under its own API terms." },
      { h: "Who we share it with", p: "We use trusted providers to run the app: Supabase (database and sign-in), Vercel (hosting), Anthropic (AI estimates), Open Food Facts (food lookups), Sentry (error monitoring, so we can fix crashes) and PostHog, hosted in the EU, for privacy-friendly, cookieless product analytics. Our analytics record only actions like signing up or logging a meal, never your food names, photos or health values. They process data only to provide their service to us. We do not sell your data and we do not use it for advertising." },
      { h: "Storage, security and retention", p: "Your data is stored in our cloud database, protected in transit and behind per-user access controls, and kept for as long as your account is active. You can export a full copy or permanently delete everything at any time from Menu, Account." },
      { h: "Your rights", p: "Under UK data protection law you can access, correct, export, restrict, object to or erase your personal data, and withdraw consent. Use the export and delete tools in the app, or contact us. You also have the right to complain to the Information Commissioner's Office (ico.org.uk)." },
      { h: "Cookies and local storage", p: "We use only essential local storage, to keep you signed in and to work offline. Our product analytics are cookieless and set no advertising or cross-site tracking cookies." },
      { h: "Children", p: "Macrosaurus is not intended for anyone under 18." },
      { h: "Changes", p: "We will update this policy as the app evolves and will note the date at the top." },
    ],
  },
  terms: {
    title: "Terms of Use",
    sections: [
      { h: "Agreement", p: "By creating an account or using Macrosaurus you agree to these terms. If you do not agree, please do not use the app." },
      { h: "Who can use it", p: "You must be at least 18 years old to use Macrosaurus." },
      { h: "What Macrosaurus is", p: "A tool to log food and track your macros and body composition, with a plan that adapts over time. It provides estimates and general guidance, not professional advice." },
      { h: "Not medical advice", p: "Macrosaurus is for general information and education only. It is not a substitute for professional medical, nutritional or psychological advice. Please read the Health disclaimer." },
      { h: "AI estimates", p: "Calorie and macro figures, barcode and label reads, and body-fat estimates are approximations and can be wrong. Always sense-check and edit them before relying on them." },
      { h: "Your account", p: "Keep your login details secure and do not share your account. You are responsible for activity that happens under it." },
      { h: "Acceptable use", p: "Do not misuse the app, attempt to break its security, or use it for anything unlawful." },
      { h: "Subscriptions and payment", p: "Some features may require a paid subscription. Where they do, pricing, billing and cancellation terms will be shown clearly at the point of purchase." },
      { h: "Availability", p: "We aim to keep the app running smoothly but do not guarantee it will always be available or free of errors." },
      { h: "Intellectual property", p: "The app, its design and its content are owned by us or our licensors. Food data is provided by Open Food Facts under its own open licence." },
      { h: "Disclaimer of warranties", p: "The app is provided \"as is\" and \"as available\", without warranties of any kind, to the fullest extent permitted by law." },
      { h: "Limitation of liability", p: "To the fullest extent permitted by law, we are not liable for any indirect or consequential loss, or for decisions you make based on the app's estimates. Nothing in these terms limits any liability that cannot be limited by law." },
      { h: "Termination", p: "You can delete your account at any time. We may suspend or end access if these terms are breached." },
      { h: "Changes", p: "We may update these terms and will note the date at the top. Continuing to use the app means you accept the changes." },
      { h: "Governing law", p: "These terms are governed by the laws of England and Wales, and the courts of England and Wales have jurisdiction." },
      { h: "Contact", p: "olly@macrosaurus.com" },
    ],
  },
  health: {
    title: "Health disclaimer",
    sections: [
      { h: "Not medical advice", p: "Macrosaurus provides general information to help you track food and body composition. It is not medical, nutritional or psychological advice, and it is not a substitute for care from a qualified professional." },
      { h: "Talk to a professional first", p: "Consult your GP or a registered dietitian before starting a new diet or exercise plan, especially if you are pregnant or breastfeeding, under 18, older, or have a medical condition such as diabetes or heart, kidney or liver disease, or an eating disorder." },
      { h: "Estimates are approximate", p: "Calorie and macro targets, food estimates and body-fat readings are approximations based on the information available. They are not guarantees, and individual needs vary." },
      { h: "Your relationship with food", p: "If you are struggling with food, eating or body image, or think you may have an eating disorder, please reach out for support. In the UK you can speak to your GP or contact Beat, the UK eating disorder charity (beateatingdisorders.org.uk). This app is not a treatment tool." },
      { h: "In an emergency", p: "If you feel unwell or are in crisis, do not rely on this app. Contact emergency services (999 in the UK) or NHS 111." },
    ],
  },
};
function LegalDoc({ doc, onClose }) {
  if (!doc || !LEGAL[doc]) return null;
  const d = LEGAL[doc];
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <BackClose onClose={onClose} />
      <div className="w-full max-w-md pixel-box flex flex-col max-h-[90vh] overflow-hidden sheet-up" style={{ background: '#0F0F12' }} onClick={e => e.stopPropagation()}>
        <div className="p-5 pb-3 flex-none flex items-start justify-between" style={{ borderBottom: '2px solid var(--border)' }}>
          <div><h2 className="text-lg font-semibold">{d.title}</h2><div className="text-[10px] text-[#8A8A90] mt-0.5">Last updated {LEGAL_UPDATED}</div></div>
          <button onClick={onClose} aria-label="Close" className="text-[#8A8A90] text-2xl leading-none shrink-0 ml-3">×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 space-y-3.5" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          {d.sections.map((s, i) => (<div key={i}><div className="text-sm mb-1" style={{ color: 'var(--accent)', fontSynthesis: 'none' }}>{s.h}</div><div className="text-[12px] text-[#8A8A90] leading-relaxed whitespace-pre-line">{s.p}</div></div>))}
        </div>
      </div>
    </div>
  );
}
function Auth() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [legal, setLegal] = useState(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [loginFailed, setLoginFailed] = useState(false); const [existing, setExisting] = useState(false);
  async function resendConfirm() {
    if (!supa) { setMsg('Accounts need an internet connection. Open the deployed site.'); return; }
    if (!email) { setMsg('Enter your email above and we\'ll send the confirmation link again.'); return; }
    setBusy(true); setMsg('');
    try { const r = await supa.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } }); if (r.error) throw r.error; setMsg('Confirmation email sent again to ' + email + '. Give it a minute, and check your spam/junk folder - Hotmail and Outlook often file it there.'); }
    // An already-confirmed address can't be "resent" a signup link; Supabase errors instead of
    // sending. Don't leave the user waiting on an email that will never come - point them at login.
    catch (e) { const m = e.message || ''; if (/already|confirm|registered/i.test(m)) { setNeedsConfirm(false); setMode('login'); setExisting(true); setMsg('This email is already confirmed - just log in below. Forgotten your password? Reset it with the link under the button.'); } else setMsg(m); }
    setBusy(false);
  }
  async function submit() {
    if (!supa) { setMsg('Accounts need an internet connection. Open the deployed site.'); return; }
    setNeedsConfirm(false); setLoginFailed(false); setExisting(false);
    if (mode === 'forgot') {
      if (!email) { setMsg('Enter your email and we\'ll send a reset link.'); return; }
      setBusy(true); setMsg('');
      try { const r = await supa.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }); if (r.error) throw r.error; setMsg('If an account exists for ' + email + ", we've emailed a link to reset your password. It can take a minute to arrive."); }
      catch (e) { setMsg(e.message); }
      setBusy(false); return;
    }
    if (!email || !pw) { setMsg('Enter your email and a password.'); return; }
    if (mode === 'signup') {
      if (pw.length < 6) { setMsg('Use a password of at least 6 characters.'); return; }
      if (pw !== pw2) { setMsg('Those passwords do not match, please retype them.'); return; }
    }
    setBusy(true); setMsg('');
    try {
      if (mode === 'signup') {
        const r = await supa.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin } });
        if (r.error) throw r.error;
        // Supabase obfuscates "email already registered" as a success with no session and an empty
        // identities array (so signup can't be used to probe who has an account). Telling these users
        // to "check your email" is exactly what manufactures the phantom "never got my verification
        // email" tickets - nothing is ever sent. Send them to log in / reset instead.
        const already = r.data && r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0;
        if (already) { setMode('login'); setExisting(true); setMsg('You already have an account for ' + email + '. Log in below - or reset your password if you\'ve forgotten it.'); }
        else { window.MTRACK && MTRACK('signup'); if (!r.data.session) { setNeedsConfirm(true); setMsg('Account created. Check your email for a confirmation link, then log in. It can take a minute - and on Hotmail/Outlook, check your junk folder.'); } }
      }
      else { const r = await supa.auth.signInWithPassword({ email, password: pw }); if (r.error) throw r.error; }
    } catch (e) {
      const m = e.message || '';
      // A wrong password comes back as the generic "Invalid login credentials". Left as-is, returning
      // users read it as "my account/verification is broken" and open a ticket - so name the real fix
      // (reset) and surface the Forgot-password link.
      if (/confirm/i.test(m)) { setNeedsConfirm(true); setMsg('Your email isn\'t confirmed yet - check your inbox (and junk folder) for the link, or resend it below.'); }
      else if (mode === 'login' && /invalid login credentials/i.test(m)) { setLoginFailed(true); setMsg('That email and password don\'t match. If you\'ve forgotten your password, reset it with the link below.'); }
      else setMsg(m);
    }
    setBusy(false);
  }
  return (
    <div className="theme-light min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b-[3px]" style={{ background: 'var(--header)', borderColor: 'var(--border)' }}>
        <div className="pixel-box w-9 h-9 flex items-center justify-center" style={{ background: '#111', borderColor: '#000' }}><PixelDino size={20} color="#fff" /></div>
        <span className="pf text-[12px]" style={{ color: 'var(--header-text)' }}>MACROSAURUS</span>
      </div>
      <div className="flex-1 flex flex-col justify-center px-6 py-10">
      <div className="w-full max-w-sm mx-auto fade-in">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="pixel-box p-4 mb-4" style={{ background: 'var(--header)', borderColor: 'var(--border)' }}><PixelDino size={56} color="#fff" /></div>
          <h1 className="pf text-lg" style={{ color: 'var(--header)' }}>MACROSAURUS</h1>
          <p className="text-[12px] text-[#8A8A90] mt-3 leading-relaxed">Adaptive body-comp tracker. Log food, hit your macros, let your plan retune itself.</p>
        </div>
        <div className="pixel-box bg-[#161618] p-5" style={{ borderTopColor: 'var(--header)', borderTopWidth: '7px' }}>
          <Field label="Email"><input type="email" autoComplete="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="you@email.com" /></Field>
          {mode !== 'forgot' && <Field label="Password"><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className={inputCls} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="at least 6 characters" /></Field>}
          {mode === 'signup' && <Field label="Confirm password"><input type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="type it again" /></Field>}
          {mode === 'forgot' && <div className="text-[11px] text-[#8A8A90] mb-3 leading-relaxed">Enter your account email and we'll send you a link to set a new password.</div>}
          <button onClick={submit} className="w-full pixel-btn mt-1 py-3 text-[11px] pf" style={{ background: 'var(--header)', color: '#fff' }}>{busy ? 'PLEASE WAIT…' : (mode === 'signup' ? 'CREATE ACCOUNT' : (mode === 'forgot' ? 'SEND RESET LINK' : 'LOG IN'))}</button>
          {mode === 'login' && <button onClick={() => { setMode('forgot'); setMsg(''); setNeedsConfirm(false); setLoginFailed(false); setExisting(false); }} className={'w-full text-[11px] mt-3 text-center' + (loginFailed ? ' underline font-semibold' : '')} style={{ color: 'var(--header)' }}>{loginFailed ? 'Reset your password' : 'Forgot your password?'}</button>}
          {msg && <div className="text-[11px] mt-3 text-center leading-relaxed" style={{ color: (existing || needsConfirm || loginFailed || mode === 'forgot') ? 'var(--header)' : 'var(--danger)' }}>{msg}</div>}
          {needsConfirm && <button onClick={resendConfirm} disabled={busy} className="w-full text-[11px] mt-3 text-center underline" style={{ color: 'var(--header)' }}>Didn't get the email? Resend confirmation link</button>}
        </div>
        {mode === 'forgot'
          ? <button onClick={() => { setMode('login'); setMsg(''); setNeedsConfirm(false); setLoginFailed(false); setExisting(false); }} className="w-full text-[11px] text-[#8A8A90] mt-5 text-center">← Back to log in</button>
          : <button onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMsg(''); setNeedsConfirm(false); setLoginFailed(false); setExisting(false); }} className="w-full text-[11px] text-[#8A8A90] mt-5 text-center">
            {mode === 'signup' ? <>Already have an account? <span className="font-semibold" style={{ color: 'var(--header)' }}>Log in</span></> : <>New here? <span className="font-semibold" style={{ color: 'var(--header)' }}>Create an account</span></>}
          </button>}
        <div className="text-[10px] text-[#8A8A90] text-center mt-8 leading-relaxed px-2">
          {mode === 'signup' ? 'By creating an account you agree to our ' : 'By using Macrosaurus you agree to our '}
          <button onClick={() => setLegal('terms')} className="underline" style={{ color: 'var(--header)' }}>Terms</button> and <button onClick={() => setLegal('privacy')} className="underline" style={{ color: 'var(--header)' }}>Privacy Policy</button>, and understand it is <button onClick={() => setLegal('health')} className="underline" style={{ color: 'var(--header)' }}>not medical advice</button>. Your data stays private to your account.
        </div>
      </div>
      </div>
      {legal && <LegalDoc doc={legal} onClose={() => setLegal(null)} />}
    </div>
  );
}

const BF_BANDS = {
  male: [{ r: '8–10%', v: 9, d: 'Very lean, clear abs and vascularity' }, { r: '11–14%', v: 12, d: 'Lean, abs visible and defined' }, { r: '15–19%', v: 17, d: 'Fit, flat stomach, faint definition' }, { r: '20–24%', v: 22, d: 'Average, soft midsection, no visible abs' }, { r: '25–29%', v: 27, d: 'Higher, rounder waist, softer look' }, { r: '30%+', v: 33, d: 'High, waist notably larger' }],
  female: [{ r: '14–17%', v: 16, d: 'Very lean, athletic, visible muscle' }, { r: '18–22%', v: 20, d: 'Lean, some muscle definition' }, { r: '23–27%', v: 25, d: 'Fit, smooth and healthy' }, { r: '28–32%', v: 30, d: 'Average, softer curves' }, { r: '33–37%', v: 35, d: 'Higher, fuller figure' }, { r: '38%+', v: 40, d: 'High' }],
};
function BodyFatPicker({ sex, apiKey, prevBf, onPick, onClose }) {
  useBackClose(onClose);
  const bands = BF_BANDS[sex === 'female' ? 'female' : 'male'];
  const [mode, setMode] = useState('bands');
  const [imgs, setImgs] = useState({}); // { front, back, side }
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [result, setResult] = useState(null);
  const SLOTS = [['front', 'Front'], ['back', 'Back'], ['side', 'Side']];
  function setSlot(slot, file) { if (!file) return; setImgs(x => Object.assign({}, x, { [slot]: { file, url: URL.createObjectURL(file) } })); }
  async function estimate() {
    const have = SLOTS.map(([s]) => s).filter(s => imgs[s]);
    if (!have.length) { setErr('Add at least one photo: front, back or side.'); return; }
    setBusy(true); setErr('');
    try {
      const prompt = BF_PROMPT + ' The person is ' + (sex === 'female' ? 'female' : 'male') + '.'
        + (prevBf != null ? ' Their last recorded body fat was ' + prevBf + '%. Treat that as a consistency anchor and only move away from it if the photos clearly justify it.' : '')
        + ' Photos provided (in order): ' + have.join(', ') + '.';
      const est = await claudeVision(apiKey, have.map(s => imgs[s].file), prompt, { model: AI_MODEL, maxTokens: 400 });
      setResult({ pct: Math.round(est.bodyfat_percent), confidence: est.confidence || 'medium', note: est.note || '' });
    } catch (e) { setErr('Estimate failed: ' + e.message); }
    setBusy(false);
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-[#262629] rounded-full mx-auto mb-4" />
        <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">Estimate body fat</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>
        {mode === 'bands' ? (<>
          <div className="text-[12px] text-[#8A8A90] mb-4">Pick whatever looks most like you, a rough guess is fine. Or let the AI read it from photos.</div>
          <button onClick={() => setMode('photos')} className="w-full flex items-center gap-3 bg-[#4A9EEB]/12 border border-[#4A9EEB]/40 rounded-2xl p-3.5 mb-4 active:scale-[.99] transition">
            <div className="text-2xl">📸</div><div className="text-left"><div className="font-semibold text-sm">Estimate from photos (AI)</div><div className="text-[11px] text-[#8A8A90]">Front, back and side for a no-BS read. Your photos are never saved.</div></div>
          </button>
          <div className="space-y-2">{bands.map((b, i) => (
            <button key={i} onClick={() => { onPick(b.v); onClose(); }} className="w-full text-left bg-[#1E1E22] border border-[#262629] rounded-2xl p-3.5 active:scale-[.99] transition flex items-center gap-3">
              <div className="text-2xl">{sex === 'female' ? '🧍‍♀️' : '🧍‍♂️'}</div>
              <div><div className="font-semibold text-sm">{b.r}</div><div className="text-[11px] text-[#8A8A90]">{b.d}</div></div>
            </button>))}</div>
        </>) : result ? (
          <div className="fade-in text-center">
            <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">AI estimate</div>
            <div className="text-5xl font-bold tnum">{result.pct}%</div>
            <div className="text-[12px] text-[#8A8A90] mt-1 mb-3">{result.confidence} confidence{prevBf != null ? ` · was ${prevBf}%` : ''}</div>
            {result.note && <div className="text-[13px] bg-[#1E1E22] border border-[#262629] rounded-2xl px-3 py-2.5 mb-4">{result.note}</div>}
            <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={() => { onPick(result.pct); onClose(); }}>Use {result.pct}%</Btn><Btn kind="ghost" onClick={() => { setResult(null); }}>Retake</Btn></div>
          </div>
        ) : busy ? (<DinoLoader label="Reading your photos" />) : (<>
          <button onClick={() => setMode('bands')} className="text-[13px] text-[#8A8A90] mb-3">‹ Back</button>
          <div className="text-[12px] text-[#8A8A90] mb-4">Add up to three photos in good light, fitted clothing or none. They're sent to the AI once for the estimate and <span className="text-white">never stored</span>.</div>
          <div className="grid grid-cols-3 gap-2 mb-4">{SLOTS.map(([s, l]) => (
            <label key={s} className="aspect-square rounded-2xl bg-[#1E1E22] border border-[#262629] flex flex-col items-center justify-center cursor-pointer overflow-hidden relative">
              {imgs[s] ? <img src={imgs[s].url} className="absolute inset-0 w-full h-full object-cover" /> : <><Icon.cam width="18" height="18" style={{ color: CAL }} /><div className="text-[11px] text-[#8A8A90] mt-1">{l}</div></>}
              <input type="file" accept="image/*" className="hidden" onChange={e => { setSlot(s, e.target.files[0]); e.target.value = ''; }} />
            </label>))}</div>
          <Btn kind="accent" className="w-full" onClick={estimate}>{busy ? 'Reading your photos…' : 'Estimate with AI'}</Btn>
          {err && <div className="text-[12px] text-[#F5C542] mt-3 fade-in">{err}</div>}
        </>)}
        {mode === 'bands' && err && <div className="text-[12px] text-[#F5C542] mt-3">{err}</div>}
      </div>
    </div>
  );
}

/* =====================================================================
   ONBOARDING WIZARD (account setup)
   ===================================================================== */
function Wizard({ initial, onDone, onCancel, initialKey }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState(initial || {
    sex: 'male', age: 32, heightCm: 175, height_unit: 'cm', weightKg: 82, weight_unit: 'st_lb', bodyFatPct: 20,
    activityLevel: 'moderate', goalType: 'cut', rateKgPerWeek: 0.5, dietStyle: 'balanced', proteinGPerKgLBM: 2.4, proteinManualG: '',
    program_mode: 'collaborative', carryover: { enabled: true, mode: 'dispersed', capKcal: 400 }, cycling: { enabled: false, highDays: [6], deltaPct: 0.15 }, aiKey: initialKey || '', theme: 'light',
  });
  const set = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));
  const [proteinTouched, setProteinTouched] = useState(false);
  const [bfPick, setBfPick] = useState(false);
  const s0 = kgToStLb(f.weightKg); const [st, setSt] = useState(s0.st); const [lb, setLb] = useState(s0.lb);
  const h0 = cmToFtIn(f.heightCm); const [ft, setFt] = useState(h0.ft); const [inch, setInch] = useState(h0.inch);
  const profile = useMemo(() => {
    const p = Object.assign({}, f);
    p.age = +f.age || 0;
    p.bodyFatPct = (f.bodyFatPct === '' || f.bodyFatPct == null || isNaN(+f.bodyFatPct)) ? null : +f.bodyFatPct;
    if (f.weight_unit === 'st_lb') p.weightKg = stLbToKg(+st || 0, +lb || 0);
    else p.weightKg = +f.weightKg || 0;
    if (f.height_unit === 'ft_in') p.heightCm = ftInToCm(+ft || 0, +inch || 0);
    else p.heightCm = +f.heightCm || 0;
    if (f.proteinManualG === '') delete p.proteinManualG;
    return withActivity(p);
  }, [f, st, lb, ft, inch]);
  const preview = useMemo(() => { try { return E.computeInitialTargets(profile); } catch (e) { return null; } }, [profile]);

  const steps = [
    { t: 'Your look', body: (
      <>
        <div className="text-[12px] text-[#8A8A90] mb-4 leading-relaxed">First, pick your palette. You can change it any time in Menu, Settings.</div>
        <Field label="Theme"><Seg value={f.theme || 'light'} onChange={v => set('theme', v)} options={[{ v: 'light', l: <span className="inline-flex items-center justify-center gap-1.5"><PixelGlyph kind="sun" color="currentColor" size={12} /> GB Color</span> }, { v: 'dark', l: <span className="inline-flex items-center justify-center gap-1.5"><PixelGlyph kind="moon" color="currentColor" size={12} /> Dark GB</span> }]} /></Field>
        <div className="pixel-box p-4 mt-4" style={{ background: 'var(--card)' }}>
          <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2.5">Preview</div>
          <div className="flex items-center gap-3" style={{ borderLeft: '4px solid var(--pro)', paddingLeft: 8 }}>
            <div className="w-9 h-9 pixel-box flex items-center justify-center shrink-0" style={{ background: 'var(--pro)' }}><PixelGlyph kind="plate" color="rgba(0,0,0,0.8)" size={18} /></div>
            <div className="min-w-0"><div className="text-sm font-bold truncate">Sample food</div><div className="text-[11px] tnum mt-0.5"><span className="font-bold" style={{ color: 'var(--pro)' }}>420</span><span className="text-[#8A8A90]"> kc</span> <span style={{ color: PRO }}>30P</span> <span style={{ color: CARB }}>40C</span> <span style={{ color: FAT }}>12F</span></div></div>
          </div>
        </div>
      </>) },
    { t: 'About you', body: (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sex"><Seg value={f.sex} onChange={v => set('sex', v)} options={[{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }]} /></Field>
          <Field label="Age"><NumInput value={f.age} onChange={e => set('age', e.target.value)} /></Field>
        </div>
        <Field label="Height">
          <div className="mb-2"><Seg value={f.height_unit} onChange={v => set('height_unit', v)} options={[{ v: 'cm', l: 'cm' }, { v: 'ft_in', l: 'ft / in' }]} /></div>
          {f.height_unit === 'cm' ? <NumInput value={f.heightCm} onChange={e => set('heightCm', e.target.value)} /> : <div className="flex gap-2 items-center"><NumInput value={ft} onChange={e => setFt(e.target.value)} /><span className="text-[#8A8A90]">ft</span><NumInput value={inch} onChange={e => setInch(e.target.value)} /><span className="text-[#8A8A90]">in</span></div>}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Weigh-in units"><Seg value={f.weight_unit} onChange={v => set('weight_unit', v)} options={[{ v: 'st_lb', l: 'st / lb' }, { v: 'kg', l: 'kg' }]} /></Field>
          <Field label="Current weight">
            {f.weight_unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(e.target.value)} /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={f.weightKg} onChange={e => set('weightKg', e.target.value)} />}
          </Field>
        </div>
        <Field label="Body fat %" hint="Used to size protein to your lean mass."><NumInput value={f.bodyFatPct} onChange={e => set('bodyFatPct', e.target.value)} /><button onClick={() => setBfPick(true)} className="text-[12px] text-[#4A9EEB] mt-1.5">Not sure? Estimate it visually →</button></Field>
      </>) },
    { t: 'Activity level', body: (
      <div className="space-y-2.5">{ACTIVITY.map(a => (
        <button key={a.v} onClick={() => set('activityLevel', a.v)} className={`w-full text-left pixel-box p-4 ${f.activityLevel === a.v ? 'bg-white text-black' : 'bg-[#1E1E22] text-white'}`} style={{ boxShadow: f.activityLevel === a.v ? '3px 3px 0 0 var(--shadow)' : 'none' }}>
          <div className="font-semibold">{a.l}</div><div className={`text-[12px] ${f.activityLevel === a.v ? 'text-black/60' : 'text-[#8A8A90]'}`}>{a.d}</div>
        </button>))}</div>) },
    { t: 'Your goal', body: (
      <>
        <Field label="Direction"><Seg value={f.goalType} onChange={v => { set('goalType', v); if (!proteinTouched) set('proteinGPerKgLBM', E.defaultProteinPerKgLBM(v)); }} options={[{ v: 'cut', l: 'Cut' }, { v: 'maintain', l: 'Maintain' }, { v: 'gain', l: 'Lean gain' }]} /></Field>
        {f.goalType !== 'maintain' && <Field label={`Rate: ${f.rateKgPerWeek} kg/week`}>
          <input type="range" min="0.1" max="1.2" step="0.05" value={f.rateKgPerWeek} onChange={e => set('rateKgPerWeek', +e.target.value)} className="w-full accent-[#4A9EEB]" />
          {(() => { const rl = rateLabel(f.rateKgPerWeek, f.goalType); return <div className="text-[12px] mt-1.5" style={{ color: rl.c }}>Pace: {rl.t}</div>; })()}
        </Field>}
      </>) },
    { t: 'Nutrition', body: (
      <>
        <Field label={`Protein: ${f.proteinManualG || Math.round((+f.proteinGPerKgLBM || 2.2) * leanKg(profile))} g (${(+f.proteinGPerKgLBM || 2.2).toFixed(1)} g/kg lean mass)`} hint={`Set per kg of LEAN mass, so body fat doesn't inflate the number. Your ${f.goalType === 'gain' ? 'lean-gain' : f.goalType} default is ${E.defaultProteinPerKgLBM(f.goalType)} g/kg lean. Evidence: Helms 2014 = 2.3–3.1 g/kg lean to hold muscle in a deficit; Jeff Nippard = 1.8–2.7 g/kg bodyweight when cutting. Drag to adjust.`}>
          <input type="range" min="1.8" max="3.1" step="0.1" value={+f.proteinGPerKgLBM || 2.2} onChange={e => { setProteinTouched(true); set('proteinGPerKgLBM', +e.target.value); set('proteinManualG', ''); }} className="w-full accent-[#4A9EEB]" />
        </Field>
        <Field label="Diet style"><Seg value={f.dietStyle} onChange={v => set('dietStyle', v)} options={[{ v: 'balanced', l: 'Balanced' }, { v: 'lower_carb', l: 'Lower carb' }, { v: 'higher_carb', l: 'Higher carb' }]} /></Field>
      </>) },
    { t: 'Your plan', body: preview ? (
      <Card className="p-6">
        <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-3">Daily targets</div>
        <div className="flex items-end gap-1 mb-4"><div className="text-5xl font-bold tnum">{preview.kcal}</div><div className="text-[#8A8A90] mb-1.5">kcal</div></div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div><div className="text-xl font-semibold tnum" style={{ color: PRO }}>{preview.protein_g}g</div><div className="text-[11px] text-[#8A8A90]">Protein</div></div>
          <div><div className="text-xl font-semibold tnum" style={{ color: FAT }}>{preview.fat_g}g</div><div className="text-[11px] text-[#8A8A90]">Fat</div></div>
          <div><div className="text-xl font-semibold tnum" style={{ color: CARB }}>{preview.carbs_g}g</div><div className="text-[11px] text-[#8A8A90]">Carbs</div></div>
        </div>
        <div className="text-[12px] text-[#8A8A90] mt-4 pt-4 border-t border-[#262629] space-y-1.5">
          <div className="uppercase tracking-widest text-[10px]">How this was worked out</div>
          <div><b className="text-[var(--text2)]">Calories:</b> maintenance ≈ {preview.estimatedTDEE} kcal (Mifflin–St Jeor BMR + your steps + training), {f.goalType === 'maintain' ? 'held at maintenance' : `then ${f.goalType === 'cut' ? '−' : '+'}${Math.round(Math.abs(f.rateKgPerWeek) * 7700 / 7)} kcal/day for a ${f.rateKgPerWeek} kg/week ${f.goalType}`}.</div>
          <div><b className="text-[var(--text2)]">Protein:</b> {f.proteinManualG ? `${preview.protein_g} g (manual)` : `${(+f.proteinGPerKgLBM || 2.2).toFixed(1)} g/kg lean mass = ${preview.protein_g} g`}. Based on Helms 2014 (2.3–3.1 g/kg lean in a deficit) and Jeff Nippard (1.8–2.7 g/kg bodyweight cutting).</div>
          <div><b className="text-[var(--text2)]">Fat & carbs:</b> fat from your diet style ({f.dietStyle.replace('_', ' ')}), carbs fill the rest.</div>
          <div>Everything retunes automatically from your weekly check-ins.</div>
        </div>
      </Card>) : <div /> },
  ];
  const last = step === steps.length - 1;
  // In dark theme --header is black (the top bar), so headings/progress that used it went invisible.
  const brand = f.theme === 'dark' ? 'var(--accent)' : 'var(--header)';
  return (
    <div className={(f.theme === 'dark' ? 'theme-dark' : 'theme-light') + ' min-h-screen'} style={{ background: 'var(--bg)', color: 'var(--text)' }}>
    <div className="flex items-center gap-3 px-5 py-4 border-b-[3px]" style={{ background: 'var(--header)', borderColor: 'var(--border)' }}>
      <div className="pixel-box w-9 h-9 flex items-center justify-center" style={{ background: '#111', borderColor: '#000' }}><PixelDino size={20} color="#fff" /></div>
      <span className="pf text-[12px]" style={{ color: 'var(--header-text)' }}>MACROSAURUS</span>
    </div>
    <div className="max-w-md mx-auto px-6 pt-8 pb-10 fade-in">
      <div className="flex items-center gap-1.5 mb-6">{steps.map((_, i) => <div key={i} className="h-2 flex-1 pixel-box" style={{ boxShadow: 'none', border: '2px solid var(--border)', background: i <= step ? brand : 'var(--track)' }} />)}</div>
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Step {step + 1} of {steps.length}</div>
      <h1 className="pf text-xl mb-6" style={{ color: brand }}>{steps[step].t}</h1>
      {steps[step].body}
      <div className="flex gap-3 mt-6">
        {step > 0 ? <Btn kind="ghost" onClick={() => setStep(step - 1)}>Back</Btn> : (onCancel ? <Btn kind="ghost" onClick={onCancel}>Cancel</Btn> : null)}
        <Btn className="flex-1" onClick={() => last ? onDone(profile) : setStep(step + 1)}>{last ? 'Save my plan' : 'Continue'}</Btn>
      </div>
      {bfPick && <BodyFatPicker sex={f.sex} apiKey={f.aiKey} prevBf={f.bodyFatPct} onPick={v => set('bodyFatPct', v)} onClose={() => setBfPick(false)} />}
    </div>
    </div>
  );
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */
// One combined check-in + coaching card: status line and cycle progress, the weigh-in row, and a
// compact coach line, merged from the old separate StatusCard and CoachCard so the dashboard has a
// single check-in surface. (The Goals screen keeps its own small check-in card.)
function StatusCard({ db, update, onCheckIn, onReview, streak, onOpenProgress }) {
  const unit = db.profile.weight_unit; const today = Store.todayISO();
  const daysSince = db.last_checkin ? daysBetween(db.last_checkin, today) : 999;
  const EARLY_DAY = 5, RECO_DAY = 7;
  const ready = daysSince >= EARLY_DAY;        // check-in unlocked (allowed early)
  const due = daysSince >= RECO_DAY;           // recommended cadence reached
  const daysToEarly = Math.max(0, EARLY_DAY - daysSince);
  const daysToReco = Math.max(0, RECO_DAY - daysSince);
  const alreadyToday = db.last_checkin === today;
  // Honest check-in day: when a weekly check-in day is set and the >=5-day gate has passed, nudge
  // on (or after) that weekday. The 5-day gate stays the source of truth for the unlock itself.
  const cd = db.profile.checkinDay;
  const cdOffset = cd != null ? (new Date(today + 'T00:00:00').getDay() - cd + 7) % 7 : null;
  const onCheckinDay = ready && daysSince < 900 && cd != null && cdOffset <= (daysSince - EARLY_DAY);
  // A suggested (not yet approved/rejected) adjustment from this cycle's check-in survives reloads.
  const pending = (db.pending_adjustment && db.pending_adjustment.date === db.last_checkin && db.pending_adjustment.result) ? db.pending_adjustment : null;
  // Compact coach line, from the same window the check-in itself reads.
  const cs = cycleStartISO(db, today);
  const cycleDays = Math.max(1, daysBetween(cs, today) + 1);
  const loggedDates = Array.from(new Set(db.log_entries.filter(e => e.date >= cs && e.date <= today).map(e => e.date)));
  const logged = loggedDates.filter(dd => isCompleteDayOn(db, dd)).length;
  const weighed = countWeighIns(db.weight_entries, cs, today);
  const needLogs = Math.max(4, Math.ceil(cycleDays * 0.7));
  const needWeigh = Math.max(3, Math.ceil(cycleDays * 0.5));
  const onTrack = logged >= needLogs && weighed >= needWeigh;
  const curAvg = avgWeight(db.weight_entries, cs, today);
  const prevAvg = avgWeight(db.weight_entries, shiftISO(cs, -cycleDays), shiftISO(cs, -1));
  const trendKg = (curAvg != null && prevAvg != null) ? +(curAvg - prevAvg).toFixed(2) : null;
  const trendStr = trendKg == null ? null : (trendKg > 0 ? '+' : trendKg < 0 ? '−' : '') + (unit === 'st_lb' ? (Math.abs(trendKg) * 2.20462).toFixed(1) + ' lb' : Math.abs(trendKg).toFixed(2) + ' kg');
  const todays = db.weight_entries.find(w => w.date === today);
  const lastEntry = db.weight_entries[db.weight_entries.length - 1];
  const seedKg = todays ? todays.scale_weight : (lastEntry ? lastEntry.scale_weight : db.profile.weightKg);
  const s0 = kgToStLb(seedKg);
  const [open, setOpen] = useState(false);
  const [kg, setKg] = useState(seedKg); const [st, setSt] = useState(s0.st); const [lb, setLb] = useState(s0.lb);
  const last7 = avgWeight(db.weight_entries, shiftISO(today, -6), today);
  function saveWeight(resume) {
    const w = unit === 'st_lb' ? stLbToKg(st, lb) : +kg; if (!w) return;
    update(d => {
      const t = Store.todayISO(); const ex = d.weight_entries.find(x => x.date === t);
      if (ex) ex.scale_weight = +w.toFixed(2); else d.weight_entries.push({ id: Store.uid(), date: t, scale_weight: +w.toFixed(2) });
      recomputeTrend(d);
      if (resume) { d.paused = false; d.profile.weightKg = +w.toFixed(2); d.last_checkin = t; }
    });
    setOpen(false);
  }
  const weighInputs = unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(+e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(+e.target.value)} /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={kg} onChange={e => setKg(e.target.value)} />;
  // Weight-trend spark, merged in from the old standalone card: one Progress surface, not two.
  const sparkPts = db.weight_entries.slice(-21).map(w => (w.trend_weight != null ? w.trend_weight : w.scale_weight)).filter(v => v != null);
  const TrendSpark = (onOpenProgress && sparkPts.length > 1) ? (
    <button onClick={onOpenProgress} className="w-full mt-3 pt-3 border-t border-[#262629] flex items-center gap-3">
      <span className="pf text-[8px] uppercase text-[#8A8A90] shrink-0">Weight trend</span>
      <div className="flex-1 min-w-0"><MiniSpark points={sparkPts} color="var(--weight)" /></div>
      <span className="pf text-[8px] shrink-0" style={{ color: 'var(--accent)' }}>Progress ›</span>
    </button>
  ) : null;
  if (db.paused) return (
    <Card className="p-5 mb-6">
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Goal</div>
      <div className="text-2xl font-bold mb-1">Goal paused</div>
      <div className="text-[12px] text-[#8A8A90] mb-4">Tracking is on hold. When you're back, weigh in to resume and your plan picks up from that weight.</div>
      {!open ? <Btn kind="accent" className="w-full" onClick={() => setOpen(true)}>Resume goal</Btn>
        : <div>{weighInputs}<Btn kind="accent" className="w-full mt-3" onClick={() => saveWeight(true)}>Weigh in & resume</Btn></div>}
    </Card>
  );
  // Nothing to action yet (check-in not unlocked, no pending proposal): collapse to a quiet line
  // that still keeps the daily weigh-in one tap away, rather than a full check-in card.
  if (!ready && !pending) return (
    <Card className="p-4 mb-6">
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Check-in</div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-bold">{alreadyToday ? 'Checked in today' : `${daysToEarly} day${daysToEarly === 1 ? '' : 's'} until check-in`}</div>
          <div className="text-[11px] text-[#8A8A90] mt-0.5">{todays ? 'Weighed in today · ' + fmtWeight(todays.scale_weight, unit) : 'Weigh in daily to keep your trend sharp'}</div>
        </div>
        <Btn kind="ghost" className="text-[12px] shrink-0" onClick={() => setOpen(o => !o)}>{todays ? 'Update' : 'Weigh in'}</Btn>
      </div>
      {open && <div className="mt-3">{weighInputs}<Btn kind="accent" className="w-full mt-3" onClick={() => saveWeight(false)}>Save weight</Btn></div>}
      {TrendSpark}
    </Card>
  );
  return (
    <Card className="p-5 mb-6">
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Check-in</div>
      <div className="text-2xl font-bold">{alreadyToday ? 'Checked in today' : onCheckinDay ? `It's your ${DOW_FULL[cd]} check-in` : due ? 'Check-in due' : ready ? 'Check-in unlocked' : `${daysToEarly} day${daysToEarly === 1 ? '' : 's'} until check-in`}</div>
      <div className="text-[12px] text-[#8A8A90] mb-3">{pending
        ? 'A new macro suggestion is waiting on you. Review it below.'
        : alreadyToday
          ? 'Fresh cycle underway. Keep logging and weighing daily.'
          : onCheckinDay
            ? 'Your check-in day is here, with enough days behind it for a clean read.'
            : due
              ? 'Recommended cadence reached. Time for your check-in.'
              : ready
                ? `Ready now. Waiting for day 7 (${daysToReco} more) gives a steadier read.`
                : `Runs on a 7-day cycle, unlockable from day 5. Weigh in daily until then.`}</div>
      <div className="h-1.5 rounded-full bg-[#262629] mb-4 overflow-hidden"><div className="h-full rounded-full" style={{ width: Math.min(100, (Math.min(daysSince, RECO_DAY) / RECO_DAY) * 100) + '%', background: due ? 'var(--good)' : 'var(--carb)' }} /></div>
      {pending && <Btn kind="accent" className="w-full mb-2" onClick={onReview}>Review this week's suggestion</Btn>}
      <div className="flex gap-2">
        {!pending && <Btn kind={ready ? 'accent' : 'ghost'} disabled={!ready} className="flex-1 text-sm" style={{ opacity: ready ? 1 : .45 }} onClick={onCheckIn}>{ready && !due ? 'Check in early' : 'Check in'}</Btn>}
        <Btn kind="ghost" className="flex-1 text-sm" onClick={() => setOpen(o => !o)}>{todays ? 'Update weight' : 'Log weight'}</Btn>
      </div>
      {open && <div className="mt-3">{weighInputs}<Btn kind="accent" className="w-full mt-3" onClick={() => saveWeight(false)}>Save weight</Btn></div>}
      <div className="text-[11px] text-[#8A8A90] mt-3 pt-3 border-t border-[#262629] flex justify-between">
        <span>{todays ? 'Logged today: ' + fmtWeight(todays.scale_weight, unit) : 'Not weighed in today'}</span>
        {last7 != null && <span>7-day avg <span className="text-white tnum">{fmtWeight(last7, unit)}</span></span>}
      </div>
      <div className="text-[11px] text-[#8A8A90] mt-2 leading-snug">This cycle: <span className="text-white tnum">{logged}/{cycleDays}</span> logged · <span className="text-white tnum">{weighed}/{cycleDays}</span> weighed{trendStr ? <> · trend <span className="text-white tnum">{trendStr}</span> vs last</> : null}.{alreadyToday
        ? ''
        : ready
          ? (onTrack ? ' Enough data, run your check-in.' : ` Aim for ${needLogs} logged, ${needWeigh} weigh-ins.`)
          : ''}</div>
      {TrendSpark}
    </Card>
  );
}

function CheckInModal({ db, update, onClose, resume }) {
  useBackClose(onClose);
  const p = db.profile; const unit = p.weight_unit; const today = Store.todayISO();
  const base = currentTargets(db);
  // Windows derive from the actual cadence (cycle start → today), not a fixed week.
  const cs = cycleStartISO(db, today);
  const cycleDays = Math.max(1, daysBetween(cs, today) + 1);
  const loggedDays = completeLoggedDates(db, cs, today).length; // only complete days count toward coverage
  const weighDays = countWeighIns(db.weight_entries, cs, today);
  // Check-ins are recommended first thing, before you've logged (or weighed) today, so an un-actioned
  // TODAY shouldn't count against your coverage. Judge over the days you could realistically have
  // completed by now: drop today from the denominator until it actually has a log / weigh-in.
  const todayLogged = isCompleteDayOn(db, today);
  const todayWeighed = db.weight_entries.some(w => w.date === today && w.scale_weight != null);
  const logWindow = Math.max(1, cycleDays - (todayLogged ? 0 : 1));
  const weighWindow = Math.max(1, cycleDays - (todayWeighed ? 0 : 1));
  const needLogs = Math.max(4, Math.ceil(logWindow * 0.7));
  const needWeigh = Math.max(3, Math.ceil(weighWindow * 0.5));
  const onTrack = loggedDays >= needLogs && weighDays >= needWeigh;
  const wkAvg = avgWeight(db.weight_entries, cs, today);
  const last = db.weight_entries[db.weight_entries.length - 1];
  const seed = kgToStLb(last ? last.scale_weight : p.weightKg);
  const [kg, setKg] = useState(last ? last.scale_weight : p.weightKg); const [st, setSt] = useState(seed.st); const [lb, setLb] = useState(seed.lb);
  const [bf, setBf] = useState(p.bodyFatPct != null ? p.bodyFatPct : '');
  // A persisted, still-undecided proposal (from d.pending_adjustment) reopens straight on the result screen.
  const [result, setResult] = useState(resume && resume.result ? resume.result : null);
  const [bfPick, setBfPick] = useState(false);
  const [adhered, setAdhered] = useState('yes'); // self-reported: did you actually follow the plan this cycle?
  const [coach, setCoach] = useState(null); // AI explanation of the check-in result: {loading}|{text}|{error}
  const [bonusCatch, setBonusCatch] = useState(null); // the guaranteed check-in catch, shown on the result screen
  useEffect(() => {
    if (!result || result.accepted) return;
    if (!['proposed', 'held', 'needdata'].includes(result.status)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    let cancelled = false; setCoach({ loading: true });
    const payload = {
      goal: p.goalType,
      targetRatePerWeek_kg: p.goalType === 'maintain' ? 0 : (p.goalType === 'cut' ? -Math.abs(p.rateKgPerWeek || 0) : Math.abs(p.rateKgPerWeek || 0)),
      actualRatePerWeek_kg: result.estimate ? result.estimate.weeklyChangeKg : null,
      outcome: result.status === 'proposed' ? (result.changed ? (result.direction === 'up' ? 'calories increased' : 'calories decreased') : 'no change (on target') : result.status === 'held' ? (result.offPlan ? 'held) user said this was an off-plan week' : 'held, not enough tracking or on a diet break') : 'not enough history yet',
      selfReportedOffPlan: !!result.offPlan,
      currentKcal: base ? base.kcal : null,
      newKcal: result.newTargets ? result.newTargets.kcal : (base ? base.kcal : null),
      deltaKcal: result.deltaKcal || 0,
      protein_g: result.newTargets ? result.newTargets.protein_g : (base ? base.protein_g : null),
      estimatedBurn_kcal: (result.estimate && !result.earlyPhase) ? ((result.expenditure && result.expenditure.kcal) || result.estimate.tdee) : null,
      phase: result.earlyPhase ? 'first cycle (early: rapid loss is largely water, targets nudged gently not fully retuned)' : 'normal adaptive cycle',
      daysLogged: loggedDays, daysWeighed: weighDays, cycleDays: cycleDays, enoughData: onTrack,
      dataConfidence: result.confidence || null, maxStepThisCycle_kcal: result.adjCap || null,
      underReportFlagged: !!result.underReportFlagged, unit: unit === 'st_lb' ? 'stones/pounds' : 'kilograms',
      // Steps-first coaching context. recommendedLever = 'steps' means progress was short AND daily
      // steps were low or had dropped: lead the tip with lifting steps toward suggestTargetPerDay
      // rather than eating less. 'calories' means steps were already solid, so the calorie move stands.
      steps_avgThisCycle: (result.stepsCoaching && result.stepsCoaching.hasData) ? result.stepsCoaching.avg : null,
      steps_avgPrevCycle: (result.stepsCoaching && result.stepsCoaching.hasData) ? result.stepsCoaching.prevAvg : null,
      steps_baseline: (result.stepsCoaching && result.stepsCoaching.hasData) ? result.stepsCoaching.baseline : null,
      steps_recommendedLever: (result.stepsCoaching && result.stepsCoaching.hasData) ? result.stepsCoaching.lever : null,
      steps_suggestTargetPerDay: (result.stepsCoaching && result.stepsCoaching.hasData) ? result.stepsCoaching.suggestTarget : null,
    };
    coachNarrative(p.aiKey, payload).then(t => { if (!cancelled) setCoach(t ? { text: t } : null); }).catch(() => { if (!cancelled) setCoach({ error: true }); });
    return () => { cancelled = true; };
  }, [result && result.status, result && result.accepted]);
  const [wErr, setWErr] = useState('');
  function complete() {
    const weightKg = unit === 'st_lb' ? stLbToKg(st, lb) : +kg; if (!weightKg) { setWErr("Enter today's weight to check in."); return; }
    setWErr('');
    const bfVal = (bf === '' || bf == null || isNaN(+bf)) ? null : +bf; // body fat optional
    const todayEntry = { date: today, scale_weight: +weightKg }; if (bfVal != null) todayEntry.bodyfat = bfVal;
    const entries = db.weight_entries.filter(w => w.date !== today).concat([todayEntry]);
    const curAvg = avgWeight(entries, cs, today);
    const prevAvg = avgWeight(entries, shiftISO(cs, -cycleDays), shiftISO(cs, -1));
    // Check-in rewards (any outcome, including a hold, counts as showing up). Idempotent per date.
    const firstGrant = !(db.game_awards || {})['checkin_catch:' + today];
    const bonus = firstGrant ? Game.checkinCatch(db.game_salt || '', today) : null;
    // Honest Rex: this cycle contains a day logged at >=20% OVER target, and they checked in anyway.
    // (Over-target only: honesty about a big day, never a reward for under-eating.)
    let honestOver = false;
    for (let hd = cs; hd <= today; hd = shiftISO(hd, 1)) {
      const tk = plannedKcalOn(db, hd); const dayK = sumMacros(entriesOn(db, hd)).kcal;
      if (tk > 0 && dayK >= tk * 1.2) { honestOver = true; break; }
    }
    update(d => {
      const ex = d.weight_entries.find(x => x.date === today);
      if (ex) { ex.scale_weight = +weightKg.toFixed(2); if (bfVal != null) ex.bodyfat = bfVal; } else { const ne = { id: Store.uid(), date: today, scale_weight: +weightKg.toFixed(2) }; if (bfVal != null) ne.bodyfat = bfVal; d.weight_entries.push(ne); }
      recomputeTrend(d);
      if (bfVal != null) d.profile.bodyFatPct = bfVal;
      if (curAvg != null) d.profile.weightKg = +curAvg.toFixed(2);
      d.last_checkin = today;
      d.pending_adjustment = null; // a new check-in supersedes any older un-actioned proposal
      d.checkins = (d.checkins || []).concat([{ date: today, weightKg: curAvg != null ? +curAvg.toFixed(2) : +weightKg.toFixed(2), onTrack: onTrack, adhered: adhered === 'yes', days: cycleDays, logged: loggedDays, weighed: weighDays, logWindow: logWindow, weighWindow: weighWindow }]);
      if (!(d.game_awards || {})['checkin_catch:' + today]) {
        d.game_awards = d.game_awards || {}; d.items = d.items || {}; d.badges = d.badges || { checkins: 0, inRange: 0 };
        d.game_awards['checkin_catch:' + today] = true;
        d.badges.checkins = (d.badges.checkins || 0) + 1;
        // Guaranteed catch from a boosted, at-least-rare pool, recorded straight into the catch log.
        if (bonus) { d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || []; if (!arr.some(x => x.id === bonus.id && x.src === 'checkin')) arr.push({ id: bonus.id, shiny: !!bonus.shiny, src: 'checkin' }); d.catch_log[today] = arr; }
        // Rare consistency awards: a 4-in-a-row check-in chain (each within 9 days) hatches an
        // Incubator; weighing in 5+ days this cycle earns a Macro Lure.
        const chain = Game.checkinChainLen((d.checkins || []).map(c => c.date));
        if (chain >= 4 && chain % 4 === 0) d.items.incubator = (d.items.incubator || 0) + 1;
        if (weighDays >= 5) d.items.lure = (d.items.lure || 0) + 1;
        if (honestOver && !d.game_awards['honest_rex']) { d.game_awards['honest_rex'] = true; d.items.honest_rex = (d.items.honest_rex || 0) + 1; }
      }
    });
    window.MTRACK && MTRACK('checkin_completed', { on_track: !!onTrack, adhered: adhered === 'yes' });
    if (bonus) setBonusCatch(bonus);
    if (dietBreakActive(db, today)) { setResult({ status: 'held', reason: `You're on a diet break at maintenance. I've logged your weigh-in, but I'll hold your goal targets until the break ends, then adaptive adjustments pick right back up.` }); return; }
    if (adhered === 'no') { setResult({ status: 'held', offPlan: true, dinoLine: DINO_OFFPLAN[Math.floor(Math.random() * DINO_OFFPLAN.length)], reason: `Macros held, no point retuning off a week that wasn't on plan. Your weigh-in's saved, so the trend stays honest. Log a clean cycle and your next check-in will dial things in properly.` }); return; }
    if (!onTrack) { setResult({ status: 'held', reason: `You logged food on ${loggedDays}/${logWindow} days and weighed in on ${weighDays}/${weighWindow} this cycle so far. Not enough to safely change your macros, so you'll stay on your current plan. Log and weigh in more consistently to unlock a change next time.` }); return; }
    // Everything from here is the pure engine pipeline: complete-day filtering, gap-aware trend
    // cycle means, early vs normal adjustment, expenditure smoothing and plateau detection.
    const byDate = {}; db.log_entries.filter(e => e.date >= cs && e.date <= today).forEach(e => byDate[e.date] = (byDate[e.date] || 0) + e.computed_macros.kcal);
    const targetByDate = {}; Object.keys(byDate).forEach(dd => targetByDate[dd] = plannedKcalOn(db, dd));
    const prof = withActivity(Object.assign({}, p, { weightKg: curAvg != null ? curAvg : p.weightKg }));
    const dec = E.checkInDecision({
      profile: prof, currentTargets: base,
      weights: entries.map(w => ({ date: w.date, kg: w.scale_weight })),
      kcalByDate: byDate, targetByDate,
      cycleStart: cs, today, cycleDays,
      weighDays, minDays: needLogs, periodDays: cycleDays, earlyCap: 150,
      expenditure: expenditurePrior(db, prof), checkins: db.checkins || [],
      waterHigh: !!(E.menstrualPhase(db.menstrual, today) || {}).waterHigh,
    });
    // Steps-first coaching: decide which lever to lead with (walk more vs eat less) from this cycle's
    // average daily steps versus last cycle and the activity-band baseline. The engine has ALREADY set
    // the calorie number; this only shapes the ADVICE, so a slow week that was really just a drop in
    // steps gets answered with "get your steps back up" before any talk of cutting food.
    const stThis = E.avgStepsInRange(db.steps, cs, today);
    const stPrev = E.avgStepsInRange(db.steps, shiftISO(cs, -cycleDays), shiftISO(cs, -1));
    const behindTarget = dec.status === 'proposed' && (p.goalType === 'gain' ? dec.direction === 'up' : dec.direction === 'down');
    dec.stepsCoaching = E.stepsCoaching({ thisCycle: stThis, prevCycle: stPrev, baseline: prof.avgSteps, behindTarget });
    if (dec.status === 'needdata') {
      setResult({ status: 'needdata', reason: dec.reasonCode === 'weighins'
        ? 'Not enough weigh-ins this cycle yet. Weigh in daily and your first adjustment will come through.'
        : 'Not enough history yet. Keep weighing in daily and logging full days, and your next check-in will retune from the averages.' });
      return;
    }
    // Persist what this cycle taught us (regardless of whether the target change is approved):
    // the smoothed expenditure, and the trend/step data plateau detection reads next time.
    update(d => {
      if (dec.expenditure && dec.expenditure.kcal > 0) d.expenditure = { kcal: dec.expenditure.kcal, n: dec.expenditure.n, updated: today };
      const ci = (d.checkins || [])[(d.checkins || []).length - 1];
      if (ci && ci.date === today && dec.estimate) { ci.weeklyChangeKg = dec.estimate.weeklyChangeKg; ci.deltaKcal = 0; ci.tdee = Math.round((dec.expenditure && dec.expenditure.kcal) || dec.estimate.tdee || 0) || null; }
      // Mis-tap protection: a changed proposal is persisted until explicitly approved or rejected,
      // so an accidental dismissal (or an app reload) never loses this week's suggestion.
      if (dec.status === 'proposed' && dec.changed) d.pending_adjustment = { date: today, result: dec };
      // In-range badge: the cycle trended within 0.1 kg/wk of the target rate (or held on goal).
      const inRange = dec.estimate && (Game.checkinInRange(dec.estimate.weeklyChangeKg, tgtRate) || (dec.status === 'proposed' && !dec.changed));
      if (inRange && !(d.game_awards || {})['checkin_inrange:' + today]) {
        d.game_awards = d.game_awards || {}; d.game_awards['checkin_inrange:' + today] = true;
        d.badges = d.badges || { checkins: 0, inRange: 0 }; d.badges.inRange = (d.badges.inRange || 0) + 1;
      }
    });
    setResult(dec);
  }
  function approve() { update(d => { d.targets.push(Object.assign({}, result.newTargets, { id: Store.uid(), effective_date: today, rationale: result.reason })); d.pending_adjustment = null; const ci = (d.checkins || [])[(d.checkins || []).length - 1]; if (ci) { ci.changed = true; ci.deltaKcal = result.deltaKcal || 0; } }); setResult(r => Object.assign({}, r, { accepted: true })); }
  function reject() { update(d => { d.pending_adjustment = null; }); onClose(); }
  // While a changed proposal is on screen and undecided, a backdrop tap must not dismiss it.
  const proposalShown = !!(result && result.status === 'proposed' && result.changed && !result.accepted);
  // Values that make the result screen readable at a glance: the rate you aimed for vs the rate you
  // actually trended, and when the next check-in comes round.
  const baseMac = base || {};
  const tgtRate = p.goalType === 'maintain' ? 0 : (p.goalType === 'cut' ? -Math.abs(p.rateKgPerWeek || 0) : Math.abs(p.rateKgPerWeek || 0));
  const actRate = result && result.estimate ? result.estimate.weeklyChangeKg : null;
  const rateOnGoal = actRate == null ? null : (p.goalType === 'cut' ? actRate < 0.02 : p.goalType === 'gain' ? actRate > -0.02 : Math.abs(actRate) < 0.15);
  const fmtRate = (r) => Math.abs(r) < 0.02 ? 'steady' : fmtWeightDelta(r, unit, '/wk');
  const nextCheckISO = shiftISO(today, 7);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => { if (!proposalShown) onClose(); }}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-[#262629] rounded-full mx-auto mb-4" />
        <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">Check-in</h2><button onClick={onClose} className="hit text-[#8A8A90] text-2xl leading-none">×</button></div>
        {proposalShown && <div className="text-[10px] text-[#8A8A90] mb-2">This suggestion stays saved on your dashboard until you approve it or stick with your current macros.</div>}
        {result ? (
          <div className="fade-in">
            <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">{result.status === 'proposed' && result.changed ? 'Suggested change' : result.status === 'held' ? 'Macros held' : 'Coaching'}</div>
            {result.offPlan && result.dinoLine && <div className="flex items-center gap-3 mb-3 pixel-box p-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
              <div className="shrink-0"><PixelDino size={30} color="var(--good)" /></div>
              <div className="text-[13px] font-semibold leading-snug">{result.dinoLine}</div>
            </div>}
            <p className="text-sm">{result.reason}</p>
            {bonusCatch && (() => { const bcr = CR_BY_ID[bonusCatch.id]; if (!bcr) return null;
              return <div className="flex items-center gap-3 mt-3 pixel-box p-3 fade-in" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: CR_RARITY_COLOR[bcr.rarity], borderWidth: 3 }}>
                <div className="shrink-0" style={crFx(bonusCatch.shiny, null)}><Sprite art={bcr.art} colors={bonusCatch.shiny ? crShiny(bcr.colors) : bcr.colors} px={5} /></div>
                <div className="min-w-0">
                  <div className="text-[9px]" style={{ color: 'var(--good)' }}>CHECK-IN CATCH! <span className="pf uppercase" style={{ color: CR_RARITY_COLOR[bcr.rarity] }}>{CR_RARITY_LABEL[bcr.rarity]}</span></div>
                  <div className="text-sm font-bold">{bcr.name}{bonusCatch.shiny ? <span style={{ color: 'var(--fat)' }}> ✦ shiny</span> : ''} joined your dex</div>
                  <div className="text-[10px] text-[#8A8A90] leading-snug">Showing up for the check-in is the win, whatever the scale said.</div>
                </div>
              </div>; })()}
            {result.estimate && <div className="mt-3 pixel-box p-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-[9px] uppercase tracking-widest text-[#8A8A90]">Aiming for</div><div className="text-[13px] tnum font-semibold">{fmtRate(tgtRate)}</div></div>
                <div><div className="text-[9px] uppercase tracking-widest text-[#8A8A90]">You trended</div><div className="text-[13px] tnum font-semibold" style={{ color: rateOnGoal == null ? 'var(--text)' : rateOnGoal ? 'var(--good)' : 'var(--fat)' }}>{fmtRate(actRate)}</div></div>
              </div>
              <div className="text-[10px] text-[#8A8A90] tnum mt-2 pt-2 border-t border-[#262629]">{result.earlyPhase
                ? 'Early read from a short trend, so a lot of this is still water weight. It sharpens each check-in as your trend settles.'
                : 'Your body is burning about ' + ((result.expenditure && result.expenditure.kcal) || result.estimate.tdee) + ' kcal a day, worked out from your intake versus how your weight moved.'}</div>
            </div>}
            {result.stepsCoaching && stepsCoachLine(result.stepsCoaching) && <div className="mt-3 pixel-box p-3" style={{ background: 'var(--surface3)', boxShadow: 'none', borderLeft: '4px solid var(--accent)' }}>
              <div className="text-[10px] uppercase tracking-widest text-[#8A8A90] mb-1.5">Steps first</div>
              <div className="text-[13px] leading-snug">{stepsCoachLine(result.stepsCoaching)}</div>
            </div>}
            {coach && <div className="mt-3 pixel-box p-3" style={{ background: 'var(--surface3)', boxShadow: 'none', borderLeft: '4px solid var(--good)' }}>
              <div className="text-[10px] uppercase tracking-widest text-[#8A8A90] mb-1.5 flex items-center gap-1.5"><PixelDino size={13} color="var(--good)" /> Coach's take</div>
              {coach.loading ? <div className="text-[12px] text-[#8A8A90]">Reading your week…</div>
                : coach.error ? <div className="text-[12px] text-[#8A8A90]">Couldn't reach the AI coach this time, your numbers above are all set.</div>
                : <div className="text-[13px] leading-snug">{coach.text}</div>}
            </div>}
            {result.status === 'proposed' && result.changed && !result.accepted && <div className="my-3">
              <div className="text-[10px] uppercase tracking-widest text-[#8A8A90] mb-1.5">New daily targets</div>
              <div className="grid grid-cols-2 min-[381px]:grid-cols-4 gap-2">{[
                { l: 'kcal', now: baseMac.kcal, next: result.newTargets.kcal, c: 'var(--text)', suf: '' },
                { l: 'protein', now: baseMac.protein_g, next: result.newTargets.protein_g, c: PRO, suf: 'g' },
                { l: 'carbs', now: baseMac.carbs_g, next: result.newTargets.carbs_g, c: CARB, suf: 'g' },
                { l: 'fat', now: baseMac.fat_g, next: result.newTargets.fat_g, c: FAT, suf: 'g' }
              ].map((r, i) => {
                const d = r.now != null ? Math.round((r.next - r.now) * 10) / 10 : null;
                return <div key={i} className="pixel-box p-2 text-center" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
                  <div className="text-[9px] uppercase tracking-widest text-[#8A8A90]">{r.l}</div>
                  <div className="text-lg font-bold tnum leading-tight" style={{ color: r.c }}>{r.next}{r.suf}</div>
                  {d != null && d !== 0
                    ? <div className="text-[10px] tnum" style={{ color: d > 0 ? 'var(--good)' : 'var(--fat)' }}>{d > 0 ? '+' : ''}{d}{r.suf} · was {r.now}{r.suf}</div>
                    : <div className="text-[10px] tnum text-[#8A8A90]">no change</div>}
                </div>;
              })}</div>
              {result.newTargets.squeezed && <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--fat)' }}>Heads up: this target sits at the safety floor, so fat (and possibly protein) had to be trimmed to fit. Your desired rate may not be achievable at this size.</div>}
            </div>}
            {result.plateau && result.plateau.plateau && !result.accepted && (() => {
              const dbStat = dietBreakStatus(db, today);
              return <div className="mt-3 pixel-box p-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
                <div className="text-[13px] leading-snug">Your cut looks stalled: {result.plateau.cycles} cycles of little movement despite calorie drops. A one-week diet break at maintenance, or a slower target rate, usually gets things moving again.</div>
                {dbStat.eligible && <Btn kind="ghost" className="w-full mt-2" onClick={() => { update(d => { d.diet_break = { start: today, end: shiftISO(today, 6), returnGoal: d.profile.goalType }; d.diet_break_snooze = null; }); onClose(); }}>Start a 7-day diet break</Btn>}
              </div>;
            })()}
            {!result.accepted && <div className="text-[11px] text-[#8A8A90] mt-3 flex items-start gap-1.5"><span>🗓</span><span>Next check-in around {fmtShortDay(nextCheckISO)}. Keep logging and weighing daily so it can retune accurately.</span></div>}
            {window.MISPREMIUM === false && <PremiumNudge db={db} update={update} className="mt-3" reason="manual" trackKey="checkin_premium" headline="You showed up this week" blurb="Premium adds body-fat photo tracking and unlimited AI logging, so every check-in has more to work with. 7 days free." />}
            {result.status === 'proposed' && result.changed && !result.accepted
              ? <div className="flex gap-2 mt-2"><Btn kind="accent" className="flex-1" onClick={approve}>Approve new macros</Btn><Btn kind="ghost" onClick={reject}>Stick to current</Btn></div>
              : <Btn kind="accent" className="w-full mt-2" onClick={onClose}>Done</Btn>}
            {result.accepted && <div className="text-[#34D399] text-sm mt-3">✓ New macros applied.</div>}
          </div>
        ) : (
          <div>
            <div className="text-[12px] text-[#8A8A90] mb-3">Compares this cycle's average weight to the previous one, so one odd morning never throws it off.</div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <MiniStat label="Food logs so far" value={loggedDays + '/' + logWindow} ok={loggedDays >= needLogs} />
              <MiniStat label="Weigh-ins so far" value={weighDays + '/' + weighWindow} ok={weighDays >= needWeigh} />
            </div>
            {!onTrack && <div className="text-[12px] text-[#F5C542] mb-3">You are short on tracking. You can still check in, but your macros will hold until you complete a fuller cycle.</div>}
            {wkAvg != null && <div className="text-[12px] text-[#8A8A90] mb-3 bg-[#1E1E22] rounded-xl px-3 py-2.5">This cycle: average <span className="text-white tnum font-semibold">{fmtWeight(wkAvg, unit)}</span></div>}
            <Field label="Today's weight">{unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(+e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(+e.target.value)} /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={kg} onChange={e => setKg(e.target.value)} />}{wErr && <div className="text-[11px] mt-1.5" style={{ color: 'var(--danger)' }}>{wErr}</div>}</Field>
            <Field label="Body fat %" hint="Optional. Leave it blank to keep your last figure. This sets your protein target and lean-mass trend."><NumInput value={bf} onChange={e => setBf(e.target.value)} placeholder="optional" /><button onClick={() => setBfPick(true)} className="text-[12px] text-[#4A9EEB] mt-1.5">Not sure? Estimate it visually →</button></Field>
            <Field label="Did you stick to your targets this cycle?" hint="Be honest, an adjustment only makes sense off a week you actually followed. Say “off-plan” and I'll hold your macros rather than chase a misleading week.">
              <Seg value={adhered} onChange={setAdhered} options={[{ v: 'yes', l: 'Yes, on track' }, { v: 'no', l: 'No, off-plan' }]} />
            </Field>
            {adhered === 'no' && <div className="text-[12px] text-[#8A8A90] mb-3">No worries, I'll still log your weigh-in and hold your macros steady. We'll retune after a clean cycle.</div>}
            <Btn kind="accent" className="w-full" onClick={complete}>Complete check-in</Btn>
          </div>
        )}
      </div>
      {bfPick && <BodyFatPicker sex={p.sex} apiKey={p.aiKey} prevBf={p.bodyFatPct} onPick={v => setBf(v)} onClose={() => setBfPick(false)} />}
    </div>
  );
}

function fmtWeighDay(dateISO) {
  const d = new Date(dateISO + 'T00:00:00');
  if (dateISO === Store.todayISO()) return 'Today';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function WeighInEditModal({ db, update, entry, onClose }) {
  useBackClose(onClose);
  const p = db.profile; const unit = p.weight_unit; const isNew = !entry;
  const today = Store.todayISO();
  const lastEntry = db.weight_entries[db.weight_entries.length - 1];
  const seedKg = entry ? entry.scale_weight : (lastEntry ? lastEntry.scale_weight : p.weightKg);
  const s0 = kgToStLb(seedKg || 0);
  const [date, setDate] = useState(entry ? entry.date : today);
  const [kg, setKg] = useState(seedKg || ''); const [st, setSt] = useState(s0.st); const [lb, setLb] = useState(s0.lb);
  const [bf, setBf] = useState(entry && entry.bodyfat != null ? entry.bodyfat : '');
  const [bfPick, setBfPick] = useState(false);
  const [wErr, setWErr] = useState('');
  const dupe = isNew && db.weight_entries.some(w => w.date === date);
  function save() {
    const w = unit === 'st_lb' ? stLbToKg(st, lb) : +kg; if (!w) { setWErr('Enter a weight to save.'); return; }
    setWErr('');
    const bfVal = (bf === '' || bf == null || isNaN(+bf)) ? null : +bf;
    update(d => {
      const ex = d.weight_entries.find(x => x.date === date);
      if (ex) { ex.scale_weight = +w.toFixed(2); if (bfVal != null) ex.bodyfat = bfVal; else delete ex.bodyfat; }
      else { const ne = { id: Store.uid(), date, scale_weight: +w.toFixed(2) }; if (bfVal != null) ne.bodyfat = bfVal; d.weight_entries.push(ne); }
      recomputeTrend(d);
    });
    onClose();
  }
  const weighInputs = unit === 'st_lb'
    ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(+e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(+e.target.value)} /><span className="text-[#8A8A90]">lb</span></div>
    : <NumInput value={kg} onChange={e => setKg(e.target.value)} />;
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">{isNew ? 'Add weigh-in' : 'Edit weigh-in'}</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>
        {isNew
          ? <Field label="Date"><input type="date" max={today} value={date} onChange={e => setDate(e.target.value)} className={inputCls} />{dupe && <div className="text-[11px] mt-1.5" style={{ color: 'var(--fat)' }}>You already weighed in on this day, saving overwrites it.</div>}</Field>
          : <div className="pf text-[9px] uppercase text-[#8A8A90] mb-3">{fmtWeighDay(date)}</div>}
        <Field label="Weight">{weighInputs}{wErr && <div className="text-[11px] mt-1.5" style={{ color: 'var(--danger)' }}>{wErr}</div>}</Field>
        <Field label="Body fat %" hint="Optional. Sets your protein target and lean-mass trend."><NumInput value={bf} onChange={e => setBf(e.target.value)} placeholder="optional" /><button onClick={() => setBfPick(true)} className="text-[12px] text-[#4A9EEB] mt-1.5">Not sure? Estimate it visually →</button></Field>
        <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={save}>Save</Btn><Btn kind="ghost" onClick={onClose}>Cancel</Btn></div>
      </div>
      {bfPick && <BodyFatPicker sex={p.sex} apiKey={p.aiKey} prevBf={p.bodyFatPct} onPick={v => setBf(v)} onClose={() => setBfPick(false)} />}
    </div>
  );
}
function WeighInLog({ db, update }) {
  const unit = db.profile.weight_unit;
  const [editing, setEditing] = useState(null);   // { new:true } or an entry
  const [confirmDel, setConfirmDel] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const entries = db.weight_entries.slice().sort((a, b) => b.date.localeCompare(a.date));
  const CAP = 8;
  const shown = showAll ? entries : entries.slice(0, CAP);
  function del(e) { update(d => { if (e.id) tombstone(d, [e.id]); d.weight_entries = d.weight_entries.filter(x => e.id ? x.id !== e.id : x.date !== e.date); recomputeTrend(d); }); }
  return (
    <Card className="p-4 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div><div className="font-semibold mb-0.5">Weigh-in log</div><div className="text-[11px] text-[#8A8A90]">Tap an entry to edit</div></div>
        <button onClick={() => setEditing({ new: true })} className="pixel-box px-3 py-1.5 text-[11px] shrink-0" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>+ Add</button>
      </div>
      {!entries.length
        ? <div className="text-[12px] text-[#8A8A90] py-2">No weigh-ins yet. Weigh in from the dashboard, or add a past day with “+ Add”.</div>
        : <div>{shown.map(e => {
          const lean = e.bodyfat != null ? e.scale_weight * (1 - e.bodyfat / 100) : null;
          return (
            <div key={e.id || e.date} className="flex items-center border-t border-[#262629] first:border-0">
              <button onClick={() => setEditing(e)} className="flex-1 text-left py-2.5 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-[#C9C9CF]">{fmtWeighDay(e.date)}</span>
                  <span className="text-[13px] tnum font-semibold">{fmtWeight(e.scale_weight, unit)}</span>
                </div>
                {e.bodyfat != null && <div className="text-[11px] text-[#8A8A90] tnum mt-0.5">{e.bodyfat}% bf · lean {fmtWeight(lean, unit)}</div>}
              </button>
              <button onClick={() => setConfirmDel(e)} className="hit text-[#8A8A90] pl-3 pr-1 text-xl leading-none shrink-0" aria-label="Delete">×</button>
            </div>
          );
        })}
          {entries.length > CAP && <button onClick={() => setShowAll(s => !s)} className="text-[12px] text-[#8A8A90] pt-2.5 border-t border-[#262629] w-full text-left">{showAll ? 'Show less' : `See all ${entries.length} weigh-ins`}</button>}
        </div>}
      {editing && <WeighInEditModal db={db} update={update} entry={editing.new ? null : editing} onClose={() => setEditing(null)} />}
      {confirmDel && <ConfirmDialog title="Delete weigh-in?" body={`Remove your ${fmtWeight(confirmDel.scale_weight, unit)} weigh-in from ${fmtWeighDay(confirmDel.date)}? Your weight trend will recompute.`} confirmLabel="Delete" onConfirm={() => del(confirmDel)} onClose={() => setConfirmDel(null)} />}
    </Card>
  );
}
function fmtShortDay(dateISO) { return new Date(dateISO + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function CheckInHistory({ db }) {
  const unit = db.profile.weight_unit; const goal = db.profile.goalType;
  const [showAll, setShowAll] = useState(false);
  const all = db.checkins || [];
  // Enrich each check-in from history: period covered, weight change vs previous, weekly rate.
  const rows = all.map((c, i) => {
    const prev = i > 0 ? all[i - 1] : null;
    const periodDays = c.days != null ? c.days : (prev ? Math.max(1, daysBetween(prev.date, c.date)) : null);
    const startISO = prev ? shiftISO(prev.date, 1) : c.date;
    const changeKg = prev ? (c.weightKg - prev.weightKg) : null;
    const rate = (changeKg != null && periodDays) ? changeKg / (periodDays / 7) : null;
    // Per-cycle "avg intake vs weekly change": what you ate against what the scale did.
    const byDay = {};
    db.log_entries.forEach(e => { if (e.date >= startISO && e.date <= c.date) byDay[e.date] = (byDay[e.date] || 0) + ((e.computed_macros && e.computed_macros.kcal) || 0); });
    const dayKcals = Object.values(byDay);
    const avgIn = dayKcals.length ? Math.round(dayKcals.reduce((a, b) => a + b, 0) / dayKcals.length) : null;
    const wkRate = c.weeklyChangeKg != null ? c.weeklyChangeKg : rate;
    return { c, startISO, periodDays, changeKg, rate, avgIn, wkRate };
  }).reverse();
  const CAP = 6;
  const shown = showAll ? rows : rows.slice(0, CAP);
  return (
    <Card className="p-4 mb-6">
      <div className="font-semibold mb-0.5">Check-ins</div><div className="text-[11px] text-[#8A8A90] mb-3">Each cycle: how long, weight change, and whether you were compliant.</div>
      {!rows.length ? <div className="text-[12px] text-[#8A8A90] py-2 leading-relaxed">No check-ins yet. About once a week a check-in reviews how your weight moved and fine-tunes your macros, your first unlocks 5 days after setup. Each one you complete lands here.</div>
        : <div className="space-y-2.5">{shown.map(({ c, startISO, periodDays, changeKg, rate, avgIn, wkRate }, i) => {
          const good = changeKg == null ? null : (goal === 'gain' ? changeKg > 0 : goal === 'cut' ? changeKg < 0 : Math.abs(changeKg) < 0.3);
          const hasCounts = c.logged != null && c.weighed != null && c.days != null;
          return (
            <div key={i} className="pixel-box p-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[12px] text-[#C9C9CF]">{periodDays ? `${fmtShortDay(startISO)} – ${fmtShortDay(c.date)}` : fmtShortDay(c.date)}{periodDays ? <span className="text-[#8A8A90]"> · {periodDays} days</span> : ''}</div>
                <span className="pf text-[8px] px-2 py-1" style={{ background: c.onTrack ? 'var(--accent-dim)' : 'transparent', color: c.onTrack ? 'var(--good)' : 'var(--fat)', border: '2px solid var(--border)' }}>{c.onTrack ? (c.changed ? 'ADJUSTED' : 'ON TRACK') : 'HELD'}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold tnum" style={{ color: good == null ? 'var(--text)' : good ? 'var(--good)' : 'var(--fat)' }}>{changeKg == null ? fmtWeight(c.weightKg, unit) : fmtWeightDelta(changeKg, unit)}</span>
                  {changeKg == null ? <span className="text-[11px] text-[#8A8A90]">baseline</span> : (rate != null && <span className="text-[11px] text-[#8A8A90] tnum">{fmtWeightDelta(rate, unit, '/wk')}</span>)}
                </div>
                <span className="text-[11px] tnum text-[#8A8A90]">{changeKg == null ? 'first check-in' : 'avg ' + fmtWeight(c.weightKg, unit)}</span>
              </div>
              <div className="text-[11px] mt-1.5 pt-1.5 border-t border-[#262629] flex items-center justify-between">
                <span className="text-[#8A8A90]">{hasCounts ? `Logged ${c.logged}/${c.logWindow != null ? c.logWindow : c.days} · Weighed ${c.weighed}/${c.weighWindow != null ? c.weighWindow : c.days}` : 'Compliance'}</span>
                <span style={{ color: c.onTrack ? 'var(--good)' : 'var(--fat)' }}>{c.onTrack ? 'Compliant' : 'Short'}</span>
              </div>
              {avgIn != null && wkRate != null && <div className="text-[10px] text-[#8A8A90] tnum mt-1">Ate ~{avgIn.toLocaleString()} kcal/day → trended {fmtWeightDelta(wkRate, unit, '/wk')}</div>}
            </div>
          );
        })}
          {rows.length > CAP && <button onClick={() => setShowAll(s => !s)} className="text-[12px] text-[#8A8A90] pt-1 w-full text-left">{showAll ? 'Show fewer' : `See all ${rows.length} check-ins`}</button>}
        </div>}
    </Card>
  );
}
// One condensed panel: switch between the trend Graph, the Daily weigh-in log, and Check-ins.
function ProgressPanel({ db, update }) {
  const [view, setView] = useState('graph');
  const tabs = [['graph', 'Graph'], ['daily', 'Daily'], ['checkins', 'Check-ins']];
  return (
    <div className="mb-2">
      <div className="flex gap-1 mb-3 pixel-box p-1 text-[12px]" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>
        {tabs.map(([k, l]) => <button key={k} onClick={() => setView(k)} className={`flex-1 py-2 ${view === k ? 'bg-white text-black font-bold' : 'text-[#8A8A90]'}`} style={{ borderRadius: 2 }}>{l}</button>)}
      </div>
      {view === 'graph' && <TrendCard db={db} />}
      {view === 'daily' && <WeighInLog db={db} update={update} />}
      {view === 'checkins' && <CheckInHistory db={db} />}
    </div>
  );
}

function ExpenditureCard({ db }) {
  const [showMath, setShowMath] = useState(false);
  const today = Store.todayISO();
  const t = currentTargets(db);
  const kcalByDate = {};
  db.log_entries.forEach(e => { kcalByDate[e.date] = (kcalByDate[e.date] || 0) + (e.computed_macros ? e.computed_macros.kcal : 0); });
  const targetByDate = {}; // lets the engine drop incomplete (abandoned) logging days from the intake average
  Object.keys(kcalByDate).forEach(dd => targetByDate[dd] = plannedKcalOn(db, dd));
  const weights = db.weight_entries.map(w => ({ date: w.date, kg: w.scale_weight }));
  const bmr = E.mifflinBMR(withActivity(db.profile));
  const est = E.liveExpenditure({ weights, kcalByDate, targetByDate, today, windowDays: 14, currentTargetKcal: t ? t.kcal : null, goalType: db.profile.goalType, rateKgPerWeek: db.profile.rateKgPerWeek, bmr });
  const unit = db.profile.weight_unit;
  if (!est.ok) {
    const weighGap = Math.max(0, est.needWeigh - est.weighDays), logGap = Math.max(0, est.needLog - est.loggedDays);
    return (
      <Card className="p-5 mb-4">
        <div className="pf text-[8px] text-[#8A8A90] mb-2">DAILY BURN</div>
        <div className="text-[13px] font-semibold mb-1">Still learning your burn</div>
        <div className="text-[12px] text-[#8A8A90] leading-relaxed mb-3">After a fortnight of weigh-ins and logged days, I can work out how many calories you actually burn a day, from what you eat versus how your weight moves.</div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label={weighGap > 0 ? weighGap + ' more to go' : 'enough'} value={est.weighDays + '/' + est.needWeigh} ok={weighGap === 0} />
          <MiniStat label={logGap > 0 ? logGap + ' more to go' : 'enough'} value={est.loggedDays + '/' + est.needLog} ok={logGap === 0} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[9px] text-[#8A8A90] mt-1 text-center"><div>weigh-ins</div><div>days logged</div></div>
      </Card>
    );
  }
  if (est.implausible) {
    const rate = unit === 'st_lb' ? (Math.abs(est.weeklyChangeKg) * 2.20462).toFixed(1) + ' lb/wk' : Math.abs(est.weeklyChangeKg).toFixed(2) + ' kg/wk';
    return (
      <Card className="p-5 mb-4">
        <div className="pf text-[8px] text-[#8A8A90] mb-2">DAILY BURN</div>
        <div className="text-[13px] font-semibold mb-1">Still settling</div>
        <div className="text-[12px] text-[#8A8A90] leading-relaxed">A sharp weight move ({est.direction === 'up' ? 'up' : 'down'} {rate}, most likely water or a scale blip) is skewing the estimate right now. Keep weighing in daily and it'll steady over the next few days.</div>
      </Card>
    );
  }
  const confColor = est.confidence === 'high' ? 'var(--good)' : est.confidence === 'medium' ? 'var(--fat)' : 'var(--muted)';
  const confLabel = est.confidence === 'high' ? 'DIALLED IN' : est.confidence === 'medium' ? 'GETTING THERE' : 'STILL LEARNING';
  const fcColor = est.forecast.dir === 'hold' ? 'var(--good)' : est.forecast.dir === 'unknown' ? 'var(--muted)' : 'var(--fat)';
  return (
    <Card className="p-5 mb-4">
      {/* Header: what this is, plus how sure we are (labelled so LOW reads as confidence, not "your burn is low"). */}
      <div className="flex items-center justify-between mb-2">
        <div className="pf text-[8px] text-[#8A8A90]">DAILY BURN</div>
        <span className="pf text-[7px] px-2 py-1 shrink-0" style={{ color: confColor, border: '2px solid ' + confColor }}>{confLabel}</span>
      </div>
      {/* Plain-English explanation of the number. */}
      <div className="text-[11px] text-[#8A8A90] leading-relaxed mb-3">The calories your body actually burns a day, learned from your intake and how your weight moves, not a formula guess.</div>
      {/* Hero figure with a single honest range (replaces the old duplicated "± band" and "Range" lines). */}
      <div className="flex items-baseline gap-2">
        <span className="text-4xl tnum" style={{ color: 'var(--hero)' }}>{est.tdee.toLocaleString()}</span>
        <span className="text-[11px] text-[#8A8A90]">kcal / day</span>
      </div>
      <div className="text-[11px] text-[#8A8A90] mt-0.5 tnum">most likely {est.low.toLocaleString()}–{est.high.toLocaleString()}</div>
      {/* Tap to reveal the arithmetic behind the number, so the adaptive figure feels earned, not magic. */}
      {(() => {
        const adj = Math.abs(Math.round((est.weeklyChangeKg * E.KCAL_PER_KG) / 7)); // kcal/day the weight trend is worth
        const sign = est.direction === 'up' ? '−' : '+'; // gaining => burn is below intake; losing => above
        return <>
          <button onClick={() => setShowMath(v => !v)} className="text-[10px] text-[#8A8A90] mt-2 inline-flex items-center gap-1" aria-expanded={showMath}>
            <span style={{ color: 'var(--hero)' }}>how this was worked out</span>
            <span className="tnum" style={{ display: 'inline-block', transform: showMath ? 'rotate(180deg)' : 'none' }}>⌄</span>
          </button>
          {showMath && <div className="fade-in text-[11px] text-[#8A8A90] leading-relaxed mt-2 space-y-1.5">
            <div>Over the last {est.windowDays} days you ate about <span className="text-[var(--text)] tnum">{est.avgKcal.toLocaleString()}</span> kcal a day, across {est.loggedDays} logged days.</div>
            {est.direction === 'flat'
              ? <div>Your weight held steady, so your burn is roughly what you ate.</div>
              : <div>Your weight trend moved <span className="text-[var(--text)] tnum">{fmtWeightDelta(est.weeklyChangeKg, unit, '/wk')}</span>. At ~7,700 kcal per kg, that's about <span className="text-[var(--text)] tnum">{adj.toLocaleString()}</span> kcal a day {est.direction === 'up' ? 'of surplus you stored' : 'you burned beyond what you ate'}.</div>}
            <div className="pt-1 tnum">{est.avgKcal.toLocaleString()} {est.direction === 'flat' ? '' : sign + ' ' + adj.toLocaleString() + ' '}≈ <span className="font-semibold" style={{ color: 'var(--hero)' }}>{est.tdee.toLocaleString()}</span> kcal burned a day.</div>
          </div>}
        </>;
      })()}
      {/* Weight trend on its own labelled row so it isn't mistaken for the burn figure. */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#262629]">
        <span className="pf text-[8px] text-[#8A8A90]">WEIGHT TREND</span>
        <span className="text-[12px] tnum font-semibold" style={{ color: est.direction === 'flat' ? 'var(--good)' : 'var(--text)' }}>{est.direction === 'flat' ? 'holding steady' : fmtWeightDelta(est.weeklyChangeKg, unit, '/wk')}</span>
      </div>
      {(() => {
        // Burn history: TDEE learned at each past check-in (persisted as ci.tdee going forward;
        // older check-ins fall back to the adaptive targets history), ending on today's live figure.
        const hist = (db.checkins || []).map(c => {
          if (c.tdee > 0) return c.tdee;
          const t = (db.targets || []).find(x => x.effective_date === c.date && x.estimatedTDEE > 0);
          return t ? Math.round(t.estimatedTDEE) : null;
        }).filter(x => x != null);
        const pts = hist.concat([est.tdee]).slice(-12);
        if (pts.length < 2) return null;
        return <div className="mt-3 pt-3 border-t border-[#262629]">
          <div className="pf text-[8px] text-[#8A8A90] mb-1">BURN OVER TIME</div>
          <MiniSpark points={pts} color="var(--hero)" />
        </div>;
      })()}
      {/* What the next weekly check-in is likely to do with your targets. */}
      <div className="text-[11px] mt-3 pt-3 border-t border-[#262629]" style={{ color: fcColor }}>Next weekly check-in: {est.forecast.text}.</div>
    </Card>
  );
}
function DietBreakCard({ db, update }) {
  const today = Store.todayISO();
  const [ask, setAsk] = useState(false);
  const [endAsk, setEndAsk] = useState(false);
  if (db.paused) return null;
  const brk = db.diet_break;
  const mk = maintenanceKcal(db);
  const goalLabel = (g) => g === 'gain' ? 'lean gain' : g === 'maintain' ? 'maintenance goal' : 'cut';
  if (dietBreakActive(db, today)) {
    const daysLeft = daysBetween(today, brk.end) + 1;
    return (
      <Card className="p-5 mb-4" style={{ borderTopColor: 'var(--hero)', borderTopWidth: '7px' }}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-lg font-bold">Diet break</div>
          <span className="text-[8px] px-2 py-1" style={{ color: 'var(--hero)', border: '2px solid var(--hero)' }}>MAINTENANCE</span>
        </div>
        <div className="text-[12px] text-[#8A8A90] mb-3 leading-relaxed">Eating at maintenance (~{mk} kcal) to recharge. <span className="text-[var(--text)]">{daysLeft} day{daysLeft === 1 ? '' : 's'} left</span>, then you return to your {goalLabel(brk.returnGoal)} automatically. Keep logging and weighing in.</div>
        <Btn kind="ghost" className="w-full" onClick={() => setEndAsk(true)}>End break now</Btn>
        {endAsk && <ConfirmDialog title="End your diet break?" body="You'll go back to your goal from today and your macros switch back straight away." confirmLabel="End break" confirmKind="accent" onConfirm={() => update(d => { d.last_break_end = today; d.diet_break = null; })} onClose={() => setEndAsk(false)} />}
      </Card>
    );
  }
  // Only surface once a sustained, well-tracked cut makes a break worthwhile.
  const status = dietBreakStatus(db, today);
  if (!status.eligible) return null;
  const start = (n) => update(d => { d.diet_break = { start: today, end: shiftISO(today, n - 1), returnGoal: d.profile.goalType }; d.diet_break_snooze = null; });
  const notNow = () => update(d => { d.diet_break_snooze = shiftISO(today, DIETBREAK_SNOOZE_DAYS); });
  return (
    <Card className="p-5 mb-4" style={{ borderTopColor: 'var(--hero)', borderTopWidth: '7px' }}>
      <div className="text-lg font-bold mb-1">Time for a diet break?</div>
      <div className="text-[12px] text-[#8A8A90] mb-3 leading-relaxed">You've been cutting steadily for {status.weeks} weeks. Taking a week or two at maintenance (~{mk} kcal) now can ease the metabolic slowdown that long cuts cause, so fat loss picks back up when you return. Your cut resumes automatically after, nothing to remember. <span className="text-[#6A6A70]">Backed by the MATADOR trial (Byrne 2018).</span></div>
      {!ask
        ? <div className="grid grid-cols-2 gap-2">
          <Btn kind="accent" onClick={() => setAsk(true)}>Yes please</Btn>
          <Btn kind="ghost" onClick={notNow}>Not now</Btn>
        </div>
        : <div className="fade-in">
          <div className="text-[11px] text-[#8A8A90] mb-2">How long?</div>
          <div className="grid grid-cols-2 gap-2">{[7, 14].map(n => <Btn key={n} kind="accent" onClick={() => start(n)}>{n} days</Btn>)}</div>
          <button className="text-[11px] text-[#8A8A90] w-full text-center mt-2" onClick={() => setAsk(false)}>Back</button>
        </div>}
    </Card>
  );
}
/* =====================================================================
   MACRODEX, collect original prehistoric creatures for logging (fun layer)
   Every logged day "catches" a deterministic creature; hitting macros unlocks
   rarer ones; a perfect day can be shiny. Your dashboard buddy evolves by streak.
   All art is original pixel work (no third-party IP).
   ===================================================================== */
// Multi-colour pixel sprite. `art` = array of equal-width strings; each char keys `colors`.
const CR_ART = {
  egg: ['................', '......KKKK......', '....KKllllKK....', '...KlllmmmllK...', '..KllmmmmmmmK...', '..KlmmmdmmmmK...', '.KlmmmmmmmdmK...', '.KmmmdmmmmmmK...', '.KmmmmmmmdmmK...', '.KmmdmmmmmmmK...', '..KmmmmmdmmK....', '..KbmmmmmmbK....', '...KKbbbbKK.....', '.....KKKK.......', '................', '................'],
  hatch: ['................', '.....KKKKK......', '....KlllllK.....', '...KlmmmmmlK....', '..KmmemmemmK....', '..KmmmmmmmmK....', '..KmbbbbbmmK....', '.KmmmmmmmmmK....', '.KbbbbbbbbmK....', '.KmmKmmmKmmK....', '.KmdK.d.KmdK....', '.Kdd.....dd.....', '................', '................', '................', '................'],
  saur: ['........KKKK..', '.......KllmK..', '......KlmemK..', '.....KlmmmK...', '..KKKlmmmK....', '.KllmmmmmKK...', 'KlmmmmmmmmmK..', '.KmmmmmmmmmK..', '.KbbbmmmmddK..', '.KmmmmmmdK....', '.KmmdmmK......', '.KmKKmK.......', '.KmdKmdK......', '.Kdd.Kdd......', '..............', '..............'],
  raptor: ['........KKKK...', '.......KllmmK..', '.....KKKlmemK..', '...KKlmmmmmK...', '..KlmmmmmmK....', '.KllmmmmmmmKKK.', 'KlmmmmmmmmmmmmK', '.KmmmmmmmmmmmK.', '.KbbbbmmmmddK..', '.KmmmmmmdK.....', '.KmmdmmK.......', '.KmKKmK........', '.KmdKmdK.......', '.Kdd.Kdd.......', '...............', '...............'],
  stego: ['................', '......l.l.l.....', '.....dKdKdKd.KK.', '...KKllllllllK..', '..KlmmmmmmmmmmK.', '.KKmmemmmmmmmmmK', '.KmmmmmmmmmmmdK.', '.KbbbbbbbbbbmmK.', '.KmmKmmKmmKmmK..', '.KmdKmdKmdKmdK..', '.Kdd.dd.dd.dd...', '................', '................', '................', '................', '................'],
  trike: ['................', '..KK............', '.KllK...........', '.KmmKKKKKKKK....', 'KlmmmllllllmK...', 'KmemmmmmmmmmmK..', 'KmmmmmmmmmmmmKK.', '.KbbbbbbbbbbmmK.', '.KmmKmmKmmKmmdK.', '.KmdKmdKmdKmmdK.', '.Kdd.dd.dd.ddK..', '..............K.', '................', '................', '................', '................'],
  rex: ['.....KKKKKK....', '....KllllllK...', '...KlmmmmmmK...', '...KmmemmmmK...', '...KmmmmmmmK...', '.KKKlmmmmmmK...', 'KllmmmmmmmmKK..', 'KmmmmmmmmmmmK..', '.KmmmmmmmmmmmKK', '.KbbbbbmmmmmmmK', '.KmdmmmdmmmmmmK', '.KmmKmmKmmdmmK.', '.KmdKmmKmmmdK..', '.Kdd.KKd.Kdd...', '...............', '...............'],
  longneck: ['..............KKKK..', '.............KllllK.', '.............KlmmmK.', '.............KmmmeK.', '.............KmmmmK.', '............KKmmmmK.', '...........KlmmmK...', '..........KlmmmK....', '.....KKKKKlmmmK.....', '...KKllllllmmmKKKK..', '..KlmdmmdmmmdmmmmmK.', '..KmmmmmmmmmmmmmmmK.', '..KbbbbbbbbbbbbbmmK.', '..KmmKmmKmmmKmmdmmK.', '..KmmKmmKmmmKmmmdK..', '..Kd.KKd.KKd.KKmdK..', '..KK...KK..KK..KKK..'],
  sprout: ['......l.......', '.....lll......', '....lllll.....', '......l.......', '.....KKKK.....', '....KllllK....', '...KlmemmlK...', '..KmmmmmmmK...', '..KmbbbbmmK...', '.KmmmmmmmmK...', '.KmmKmmmKmK...', '.KmdK.dKmdK...', '.Kdd...Kdd....', '..............', '..............', '..............'],
  brolly: ['...KKKKKKKK...', '..KllllllllK..', '.KmmmmmmmmmmK.', 'KdmdmdmdmdmdmK', '.....KK.......', '....KllK......', '...KlmemlK....', '..KmmmmmmmK...', '..KmbbbmmmK...', '.KmmmmmmmmK...', '.KmdKmKmdK....', '.Kdd...dd.....', '..............', '..............', '..............', '..............'],
  spino: ['.....d.d.d.....', '....dKdKdKd....', '..KKlllllllK...', '.KlmmemmmmmK...', 'KlmmmmmmmmmKK..', '.KmmmmmmmmmmK..', '.KbbbbmmmmddK..', '.KmmmmmmmdK....', '.KmmdmmK.......', '.KmKKmK........', '.KmdKmdK.......', '.Kdd.Kdd.......', '...............', '...............', '...............', '...............'],
  anky: ['................', '.....dddddd.....', '...KKlllllllKK..', '..KlmmemmmmmmmK.', 'KKmmmmmmmmmmmmmK', 'KdmmmmmmmmmmmmdK', '.KbbbbbbbbbbmmK.', '.KmmKmmKmmKmmK..', '.Kdd.dd.dd.dd...', '................', '................', '................', '................', '................', '................', '................'],
  ptero: ['KK............KK.', 'KllK........KllK.', '.KmlKK....KKlmK..', '.KmmmlKKKKlmmmK..', 'KKmmmmmmmmmmmmKK.', 'KllmmemmmmmmmmK..', '.KKmmmmmmmmmmK...', '..KKdmmmmmdKK....', '....KmmmmmK......', '....KbbbbK.......', '.....Km.mK.......', '.....Kd.dK.......', '.....KK.KK.......', '.................', '.................', '.................'],
  para: ['....KK.........', '...KllK........', '..KlmmK........', '..KmemK........', '..KmmmK........', '.KKmmmKK.......', 'KllmmmmmKKKK...', 'KmmmmmmmmmmmK..', '.KbbbbbmmmmdK..', '.KmmmmmmmmmK...', '.KmdmmmdmmK....', '.KmKKmmKmK.....', '.KmdK.Kmd......', '.Kdd..Kdd......', '...............', '...............'],
  pachy: ['....KKKKK.....', '...KllllllK...', '..KlmmmmmmK...', '..KmmemmmmK...', '..KmmmmmmK....', '.KKlmmmmK.....', 'KlmmmmmmmKK...', '.KmmmmmmmmmK..', '.KbbbmmmmddK..', '.KmmKmmmKmK...', '.KmdK.KmdK....', '.Kdd..Kdd.....', '..............', '..............', '..............', '..............'],
  dimetro: ['................', '...lllllll......', '..dKdKdKdKd.....', '.KKlllllllKKK...', 'KlmmemmmmmmmmK..', 'KmmmmmmmmmmmmKK.', '.KbbbbbbbbbmmK..', '.KmmKmmKmmKmK...', '.Kdd.dd.dd.dK...', '................', '................', '................', '................', '................', '................', '................'],
  boulder: ['................', '....KKKKKKK.....', '..KKlllllllKK...', '.KlmmmmmmmmmK...', 'KlmmdmmemmmmmK..', 'KmmmmmmmdmmmmK..', 'KmdmmmmmmmmmmK..', '.KbbbbbbbbbmK...', '.KmmKmmmKmmK....', '.Kdd.KdK.dd.....', '................', '................', '................', '................', '................', '................'],
  blob: ['.....KKKK.......', '....KllllK......', '...KlmemmlK.....', '..KmmmmmmmK.....', '.KKmmmmmmmKKK...', 'KlmmmmmmmmmmmK..', 'KmmbbbbbbbmmmK..', 'KmbbbbbbbbbbmK..', 'KmmbbbbbbbmmmK..', '.KmmmmmmmmmmK...', '.KmdKmmmKmdK....', '.Kdd..K..dd.....', '................', '................', '................', '................'],
  leafneck: ['.............b......', '............bbb.....', '.............b.KKKK.', '............bbKllllK', '.............KlmmmeK', '.............KmmmmmK', '............KKmmmmK.', '...........KlmmmK...', '..........KlmmmK....', '.....KKKKKlmmmK.....', '...KKllllllmmmKKKK..', '..KlmdmmdmmmdmmmmmK.', '..KmmmmmmmmmmmmmmmK.', '..KbbbbbbbbbbbbbmmK.', '..KmmKmmKmmmKmmdmmK.', '..KmmKmmKmmmKmmmdK..', '..Kd.KKd.KKd.KKmdK..'],
  domeback: ['................', '.....KKKKKK.....', '...KKllllllKK...', '..KlmmmmmmmmK...', '.KlmmmmmmmmmmK..', 'KKmmemmmmmmmmK..', 'KmmmmmmmmmmmdK..', '.KbbbbbbbbbmmK..', '.KmmKmmKmmKmK...', '.Kdd.dd.dd.dd...', '................', '................', '................', '................', '................', '................'],
};
// Lighten / darken a #rrggbb toward white / black by fraction f (0..1).
function crLighten(hex, f) {
  const h = String(hex).replace('#', ''); if (h.length < 6) return hex;
  const p = i => parseInt(h.slice(i, i + 2), 16), m = v => Math.round(v + (255 - v) * f).toString(16).padStart(2, '0');
  return '#' + m(p(0)) + m(p(2)) + m(p(4));
}
function crDarken(hex, f) {
  const h = String(hex).replace('#', ''); if (h.length < 6) return hex;
  const p = i => parseInt(h.slice(i, i + 2), 16), m = v => Math.round(v * (1 - f)).toString(16).padStart(2, '0');
  return '#' + m(p(0)) + m(p(2)) + m(p(4));
}
// Each creature carries a light/mid/dark ramp derived from its base colour (m), plus a bright
// belly (b) and a dark eye (e), so the hand-shaded sprites render in the logo's multi-tone style.
function crC(B, S) { return { K: '#241f2b', B: B, S: S, H: '#ffffff', W: '#ffffff', P: '#241f2b', A: S, T: '#fff6d5', L: '#54b53f', m: B, l: crLighten(B, 0.34), d: crDarken(B, 0.40), e: '#182014', b: crLighten(B, 0.55) }; }
function crShiny(c) { return Object.assign({}, c, { B: '#FFD400', S: '#B8860B', H: '#FFF6C0', A: '#B8860B', m: '#FFD400', l: crLighten('#FFD400', 0.30), d: crDarken('#FFD400', 0.38), e: '#2a2205', b: crLighten('#FFD400', 0.55) }); }
function crSilhouette() { const g = '#2a2830'; return { K: '#37343f', B: g, S: g, H: g, W: g, P: g, A: g, T: g, m: g, l: g, d: g, e: g, b: g }; }
function Sprite({ art, colors, px = 6 }) {
  const rows = CR_ART[art] || []; const w = rows.reduce((m, r) => Math.max(m, r.length), 0); const h = rows.length; const rects = [];
  // Normalise the larger multi-tone grids to about the old 12-cell footprint at a given px,
  // so every render site keeps its existing size no matter each sprite's exact dimensions.
  const cell = px * 12 / Math.max(w, h, 12);
  rows.forEach((row, y) => row.split('').forEach((ch, x) => { if (ch !== '.' && colors[ch]) rects.push(<rect key={x + '_' + y} x={x} y={y} width="1.03" height="1.03" fill={colors[ch]} />); }));
  return <svg width={w * cell} height={h * cell} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges">{rects}</svg>;
}

/* ---------- Share card (streak -> shareable image) ----------
   Turns a user's streak + buddy into a 1080x1080 PNG they can drop into a Story, WhatsApp or a group
   chat. Uses the Web Share API with a file where supported (mobile), and falls back to a download plus
   a copied link on desktop. Every card is watermarked with the app URL, so a shared streak doubles as
   an invitation. Drawn on a canvas from the same pixel grids the app renders, so it stays on-brand. */
const SHARE_URL = 'https://macrosaurus.com';
function drawPixelGrid(ctx, grid, colors, ox, oy, cell) {
  for (let y = 0; y < (grid || []).length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || !colors[ch]) continue;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(Math.round(ox + x * cell), Math.round(oy + y * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}
function renderStreakCard({ streak, best, caught, dexTotal, name, art, colors }) {
  const S = 1080;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#241f2b'); g.addColorStop(1, '#0e0c12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#39FF14'; ctx.lineWidth = 14; ctx.strokeRect(30, 30, S - 60, S - 60);
  ctx.textAlign = 'center';
  // wordmark (mascot + name)
  const mascotColors = { L: '#7BD957', B: '#46B94A', D: '#2C8C3E', P: '#123A1C' };
  drawPixelGrid(ctx, DINO_ART, mascotColors, S / 2 - (16 * 7) / 2, 92, 7);
  ctx.fillStyle = '#EDE9F0'; ctx.font = '800 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('MACROSAURUS', S / 2, 250);
  // buddy sprite, centred
  const grid = CR_ART[art] || CR_ART[Object.keys(CR_ART)[0]] || [];
  const gw = grid.reduce((m, r) => Math.max(m, r.length), 0) || 1, gh = grid.length || 1;
  const target = 380, cell = target / Math.max(gw, gh);
  drawPixelGrid(ctx, grid, colors || {}, S / 2 - (gw * cell) / 2, 300, cell);
  // streak number
  ctx.fillStyle = '#F5C518'; ctx.font = '900 220px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(String(streak), S / 2, 810);
  ctx.fillStyle = '#EDE9F0'; ctx.font = '800 52px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('DAY STREAK', S / 2, 872);
  // sub line
  ctx.fillStyle = '#9aa0a6'; ctx.font = '600 32px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const bits = [];
  if (name) bits.push(name);
  if (best && best > streak) bits.push('best ' + best);
  if (caught) bits.push(caught + '/' + dexTotal + ' dinos caught');
  ctx.fillText(bits.join('  ·  '), S / 2, 928);
  // footer / call to action
  ctx.fillStyle = '#39FF14'; ctx.font = '800 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('Track macros. Catch dinos.  macrosaurus.com', S / 2, 1004);
  return cv;
}
async function shareStreak(payload, toast) {
  const text = payload.streak > 0
    ? payload.streak + '-day streak on Macrosaurus. Track macros, catch dinos: ' + SHARE_URL
    : 'Tracking my macros (and catching dinos) on Macrosaurus: ' + SHARE_URL;
  let blob = null;
  try { const cv = renderStreakCard(payload); blob = await new Promise(r => cv.toBlob(r, 'image/png')); } catch (_) {}
  const file = blob ? new File([blob], 'macrosaurus-streak.png', { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: text });
      window.MTRACK && MTRACK('share_streak', { method: 'file', streak: payload.streak }); return;
    }
    if (navigator.share) {
      await navigator.share({ title: 'Macrosaurus', text: text, url: SHARE_URL });
      window.MTRACK && MTRACK('share_streak', { method: 'text', streak: payload.streak }); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; /* fall through to download */ }
  // Desktop / no Web Share: save the image and copy the link.
  try {
    if (blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'macrosaurus-streak.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    try { await navigator.clipboard.writeText(SHARE_URL); } catch (_) {}
    toast && toast(blob ? 'Streak image saved and link copied' : 'Link copied');
    window.MTRACK && MTRACK('share_streak', { method: 'download', streak: payload.streak });
  } catch (_) { toast && toast('Could not share right now'); }
}

const BIOMES = [
  { id: 'nursery', name: 'The Nursery', blurb: 'Where every log begins. Show up and something hatches.' },
  { id: 'protein', name: 'Protein Peaks', blurb: 'High, hard country. Only the well-fed climb it.' },
  { id: 'carb', name: 'Carb Canyon', blurb: 'Fast rivers of slow-release energy.' },
  { id: 'fat', name: 'Fat Flats', blurb: 'Rich, golden country. Steady does it.' },
  { id: 'fibre', name: 'Fibre Forest', blurb: 'Green, thriving and quietly smug.' },
  { id: 'apex', name: 'Apex Ridge', blurb: 'The summit. Only a perfect day reaches it.' },
  { id: 'mythic', name: 'The Wilds', blurb: 'Off every map. Legends roam here for those who never miss.' },
];
const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
const CR_RARITY_COLOR = { common: 'var(--muted)', uncommon: 'var(--good)', rare: 'var(--carb)', epic: 'var(--weight)', legendary: 'var(--header)', mythic: 'var(--fat)' };
const CR_RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic' };
// Egg tiers (quality days to hatch), colour-coded by the rarity band they crack open.
const EGG_TIER_COLOR = { 2: 'var(--good)', 5: 'var(--carb)', 10: 'var(--weight)' };
const EGG_TIER_LABEL = { 2: 'Common', 5: 'Uncommon+', 10: 'Rare+' };
const EGG_TIER_EGGCOLORS = { 2: crC('#9FE08A', '#4f8e3a'), 5: crC('#7FD9E5', '#3f9aa8'), 10: crC('#C9A8F0', '#7a4fb0') };
const BIOME_COLOR = { nursery: 'var(--muted)', protein: 'var(--pro)', carb: 'var(--carb)', fat: 'var(--fat)', fibre: 'var(--good)', apex: 'var(--weight)', mythic: 'var(--header)' };
const CREATURES = [
  // The Nursery, any logged day
  { id: 'nugg', name: 'Nugg', art: 'egg', colors: crC('#EAD9A0', '#C77D3A'), biome: 'nursery', rarity: 'common', cond: 'Log any food on any day.', lore: 'A speckled egg kept warm by good habits. Nobody knows what hatches from it, and that is rather the point. Feed it enough days and it makes up its own mind.', evo: [{ at: 5, name: 'Nuggle', art: 'hatch', colors: crC('#EAD9A0', '#C77D3A') }, { at: 10, name: 'Nuggosaur', art: 'saur', colors: crC('#E6C878', '#b8862f') }] },
  { id: 'dinky', name: 'Dinky', art: 'hatch', colors: crC('#7FD46B', '#3f8e2f'), biome: 'nursery', rarity: 'common', cond: 'Log any food on any day.', lore: 'A curious hatchling that follows you home the very first day you log. Fiercely loyal, faintly clumsy, and convinced it invented breakfast.', evo: [{ at: 5, name: 'Dinko', art: 'saur', colors: crC('#6cc258', '#2f7a24') }, { at: 10, name: 'Dinorush', art: 'raptor', colors: crC('#57b043', '#245e1a') }] },
  { id: 'pebble', name: 'Pebble', art: 'boulder', colors: crC('#9FB8C9', '#5f7d90'), biome: 'nursery', rarity: 'common', cond: 'Log any food on any day.', lore: 'Sleepy and stony-skinned, Pebble naps through most of the day and still somehow evolves. A patron saint of the slow-but-consistent.', evo: [{ at: 5, name: 'Cobble', art: 'saur', colors: crC('#8da7ba', '#4f6d80') }, { at: 10, name: 'Boulderex', art: 'anky', colors: crC('#7d97aa', '#3f5d70') }] },
  // Protein Peaks
  { id: 'protops', name: 'Protops', art: 'longneck', colors: crC('#E5556B', '#a83145'), biome: 'protein', rarity: 'common', cond: 'Hit your protein target.', lore: 'Grows a neck-length taller for every gram of protein you land. A devout believer in the second helping of chicken.', evo: [{ at: 5, name: 'Protolith', art: 'pachy', colors: crC('#d94459', '#8e2436') }, { at: 10, name: 'Proterex', art: 'rex', colors: crC('#c23a4d', '#71202e') }] },
  { id: 'flexor', name: 'Flexor', art: 'raptor', colors: crC('#F0655F', '#a83a34'), biome: 'protein', rarity: 'rare', cond: 'Hit protein AND land your calories.', lore: 'A swaggering raptor that only struts out when protein and calories both land on the same day. It does not know what a rest day is.' },
  // Carb Canyon
  { id: 'carbo', name: 'Carbo', art: 'saur', colors: crC('#4A90E2', '#2f66b0'), biome: 'carb', rarity: 'common', cond: 'Land your carb target.', lore: 'Bounds across the canyon on slow-release energy, powered by oats and good intentions. Naps at 3pm like clockwork.', evo: [{ at: 5, name: 'Carbon', art: 'longneck', colors: crC('#3f82d4', '#265a9e') }, { at: 10, name: 'Carbozon', art: 'rex', colors: crC('#356fbf', '#1e4a86') }] },
  { id: 'noodon', name: 'Noodon', art: 'para', colors: crC('#5AA0E8', '#356fb0'), biome: 'carb', rarity: 'uncommon', cond: 'Carbs on point with fibre in range.', lore: 'A gentle long-neck woven from whole grains and good noodles. Surprisingly wise; will not be rushed.' },
  // Fat Flats
  { id: 'fatzilla', name: 'Fatzilla', art: 'blob', colors: crC('#F5C518', '#c99a10'), biome: 'fat', rarity: 'common', cond: 'Hit your healthy fats.', lore: 'Radiates a warm, oily glow and insists that avocados are, technically, a personality trait. Difficult to argue with.', evo: [{ at: 5, name: 'Fatlas', art: 'dimetro', colors: crC('#e6b910', '#b8890c') }, { at: 10, name: 'Fatalisk', art: 'rex', colors: crC('#d4a810', '#9e7a08') }] },
  { id: 'buttron', name: 'Buttron', art: 'domeback', colors: crC('#F0C838', '#b8901c'), biome: 'fat', rarity: 'uncommon', cond: 'Fats on point and calories in range.', lore: 'Plated in golden scutes of grass-fed calm. Moves slowly, thinks richly, spreads easily.' },
  // Fibre Forest
  { id: 'sprowl', name: 'Sprowl', art: 'sprout', colors: crC('#5FBF4A', '#2f7a24'), biome: 'fibre', rarity: 'common', cond: 'Reach your fibre goal.', lore: 'Sprouts a fresh leaf for every serving of veg and photosynthesises a mild, leafy smugness. Beloved by your gut bacteria.', evo: [{ at: 5, name: 'Sprowler', art: 'longneck', colors: crC('#54b03f', '#276a1e') }, { at: 10, name: 'Frondzilla', art: 'stego', colors: crC('#49a034', '#1f5a18') }] },
  { id: 'frondo', name: 'Frondo', art: 'leafneck', colors: crC('#66C24F', '#357f28'), biome: 'fibre', rarity: 'uncommon', cond: 'Fibre goal plus a protein hit.', lore: 'A leafy long-neck that only trusts you once you have eaten your greens AND your protein. Keeps a tidy compost heap.' },
  // Apex Ridge, perfect days
  { id: 'veloci', name: 'Veloci', art: 'raptor', colors: crC('#B06BE0', '#7a3fb0'), biome: 'apex', rarity: 'rare', cond: 'Nail a perfect macro day.', lore: 'Fast, precise and unforgiving. Appears only when every macro lands in range, and vanishes the moment you get sloppy.' },
  { id: 'platealon', name: 'Platealon', art: 'stego', colors: crC('#2FB0A0', '#1e7a70'), biome: 'apex', rarity: 'rare', cond: 'A perfect, balanced day.', lore: 'Its back-plates only align when protein, carbs and fats sit in perfect harmony. A living spirit level for your diet.' },
  { id: 'triceros', name: 'Triceros', art: 'trike', colors: crC('#E0975B', '#a8642f'), biome: 'apex', rarity: 'rare', cond: 'A perfect day, three macros nailed.', lore: 'Three horns for three macros. Charges, without warning, at anyone who says "I will start again on Monday".' },
  { id: 'rexosaur', name: 'Rexosaur', art: 'rex', colors: crC('#6B5FC0', '#3a3170'), biome: 'apex', rarity: 'legendary', cond: 'A perfect day, on a rare roll.', lore: 'The apex predator of consistency. Seen only by those who truly earn the day, and only when the stars (and the macros) align.' },
  // The Wilds, wandering mythics
  { id: 'aurora', name: 'Aurora', art: 'ptero', colors: crC('#7FE0E8', '#3f9ea8'), biome: 'mythic', rarity: 'mythic', cond: 'Roams only after a perfect week (5+ perfect days in 7).', lore: 'A shimmering wanderer said to trail the northern lights across the sky. A whole week of perfect days is the only thing that draws it near.' },
  { id: 'chronos', name: 'Chronos', art: 'spino', colors: crC('#FFD400', '#B8860B'), biome: 'mythic', rarity: 'mythic', cond: 'A 30-day streak crowned by a perfect day.', lore: 'Ancient keeper of streaks. It remembers every single day you showed up, and it rewards only the truly relentless.' },
  // Migratory visitor: passes through once a month for the truly consistent (20 logged days in a calendar month).
  { id: 'drizzlodon', name: 'Drizzlodon', art: 'brolly', colors: crC('#7FB2E5', '#3b6ea8'), biome: 'mythic', rarity: 'epic', migratory: true, cond: 'Migratory: log food on 20 days in a calendar month, it visits again each month you manage it.', lore: 'A soggy but cheerful wanderer that follows the British drizzle from month to month, brolly-crest raised. It only lands where somebody has logged through twenty grey days without grumbling. Rain or shine, it shows up, just like you.' },
];
const CR_BY_ID = {}; CREATURES.forEach(c => CR_BY_ID[c.id] = c);
// The evolved form of a creature at a given re-catch count (levels): picks the highest unlocked
// stage. Post-17 content: evo lines gain an Elder (Lv25) and Ancient (Lv50) aura tier, rendered
// as a glow on the top sprite rather than new pixel art.
function creatureForm(cr, count) { if (!cr) return null; let f = { name: cr.name, art: cr.art, colors: cr.colors, aura: null }; if (cr.evo) { cr.evo.forEach(e => { if ((count || 0) >= e.at) f = { name: e.name, art: e.art || cr.art, colors: e.colors || cr.colors, aura: null }; }); if ((count || 0) >= 50) { f.aura = 'gold'; f.name = 'Ancient ' + f.name; } else if ((count || 0) >= 25) { f.aura = 'silver'; f.name = 'Elder ' + f.name; } } return f; }
// Combined sprite glow: shiny, the Lv25/Lv50 aura tiers, and the day/night evolution path.
function crFx(shiny, aura, affinity) { const fx = []; if (shiny) fx.push('drop-shadow(0 0 5px var(--fat))'); if (aura === 'silver') fx.push('drop-shadow(0 0 4px #cfd6e0)'); if (aura === 'gold') fx.push('drop-shadow(0 0 6px #FFD400)'); if (affinity === 'day') fx.push('drop-shadow(0 0 5px rgba(255,201,84,0.85))'); if (affinity === 'night') fx.push('drop-shadow(0 0 5px rgba(126,156,255,0.9))'); return fx.length ? { filter: fx.join(' ') } : null; }
// Day/night path display: badge glyph, colour and label (set at evolution, reflects when you eat).
const AFFINITY_META = { day: ['☀', 'var(--fat)', 'Day form'], night: ['☾', 'var(--carb)', 'Night form'] };
// Hearts a buddy needs at each evolution to trigger it: friendship deepens as it grows.
const EVO_HEART_REQ = [2, 3, 4];
// Your buddy's current form along ITS species line, chosen by bond-gated evo stage (not catch
// count). Level (cumulative quality days) still earns the Elder/Ancient aura for the devoted.
function buddyForm(species, evoStage, level) {
  if (!species) return null;
  let f = { name: species.name, art: species.art, colors: species.colors, aura: null };
  if (species.evo && species.evo.length && evoStage > 0) {
    const e = species.evo[Math.min(evoStage, species.evo.length) - 1];
    if (e) f = { name: e.name, art: e.art || species.art, colors: e.colors || species.colors, aura: null };
  }
  if ((level || 0) >= 50) { f.aura = 'gold'; f.name = 'Ancient ' + f.name; }
  else if ((level || 0) >= 25) { f.aura = 'silver'; f.name = 'Elder ' + f.name; }
  return f;
}
// Buddy level = cumulative QUALITY days (logged + protein + calories): care you cannot fake by
// just opening the app. Capped so the count is cheap and covers the top aura threshold.
function buddyLevel(db) {
  const seen = {}; let n = 0;
  const dates = (db.log_entries || []).map(e => e.date);
  for (let i = 0; i < dates.length && n < 60; i++) { const d = dates[i]; if (!seen[d]) { seen[d] = 1; if (isQualityDay(db, d)) n++; } }
  return n;
}
// The species the buddy is raised from: the creature you've caught most that has an evolution
// line (the one you've bonded with), falling back to Dinky, the day-one hatchling.
function buddySpeciesId(db) {
  const dex = macrodex(db); let best = null, bestCount = -1;
  Object.keys(dex).forEach(id => { const cr = CR_BY_ID[id]; if (cr && cr.evo && cr.evo.length && (dex[id].count || 0) > bestCount) { best = id; bestCount = dex[id].count || 0; } });
  return best || 'dinky';
}
// ---- Shared item system (earned from streaks, perfect weeks, biome sets and boss/ladder wins) ----
const ITEMS = {
  lure: { name: 'Macro Lure', kind: 'dex', desc: 'Point it at a macro to make today’s catch favour that biome.' },
  golden_steak: { name: 'Golden Steak', kind: 'dex', desc: 'Your next perfect day is guaranteed to catch a shiny.' },
  incubator: { name: 'Incubator', kind: 'dex', desc: 'Makes today’s catch a guaranteed rare or better, if you qualify for one.' },
  honest_rex: { name: 'Honest Rex', kind: 'dex', desc: 'Earned by logging a big over-target day honestly and still showing up to check in. Use it to lock in shiny odds on your next perfect day.' },
  amber: { name: 'Amber Fossil', kind: 'trophy', desc: 'A rare boss trophy sealed in golden amber.' },
  belt: { name: 'Champion Belt', kind: 'trophy', desc: 'Proof you cleared the whole fight ladder.' },
  medal: { name: 'Biome Medal', kind: 'trophy', desc: 'Awarded for completing a biome in the Macrodex.' },
};
const ITEM_ORDER = ['lure', 'golden_steak', 'incubator', 'honest_rex', 'medal', 'amber', 'belt'];
// Hopping dino shown while the AI is thinking, so a wait never looks like a crash.
function DinoLoader({ label }) {
  const cr = CR_BY_ID['carbo'] || CREATURES[1];
  const text = String(label || 'Working').replace(/[.…\s]+$/, '');
  // Safety net: if a fetch hangs, say so instead of hopping forever with no way out.
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 10000); return () => clearTimeout(t); }, []);
  return (
    <div className="flex flex-col items-center justify-center py-10 fade-in">
      <div className="dino-hop"><Sprite art={cr.art} colors={cr.colors} px={7} /></div>
      <div className="dino-shadow mt-1.5" style={{ width: 36 }} />
      <div className="text-[12px] text-[#8A8A90] mt-4">{text}<span className="dino-dot">.</span><span className="dino-dot">.</span><span className="dino-dot">.</span></div>
      {slow && <div className="text-[11px] text-[#8A8A90] mt-3 text-center px-8 leading-relaxed fade-in">Taking longer than usual. Check your connection, or go back and try again.</div>}
    </div>
  );
}

function dayQuality(db, date) {
  const day = entriesOn(db, date); if (!day.length) return null;
  const et = effectiveTarget(db, date); const t = et ? et.eff : null; const tot = sumMacros(day);
  if (!t) return { logged: true, proteinHit: false, carbHit: false, fatHit: false, kcalIn: false, fiberHit: false, perfect: false };
  const proteinHit = tot.protein >= t.protein_g * 0.9;
  const carbHit = t.carbs_g > 0 && Math.abs(tot.carbs - t.carbs_g) <= t.carbs_g * 0.2;
  const fatHit = t.fat_g > 0 && Math.abs(tot.fat - t.fat_g) <= t.fat_g * 0.2;
  const kcalIn = Math.abs(tot.kcal - t.kcal) <= t.kcal * 0.1;
  const fiberHit = tot.fiber >= E.fiberTarget(t.kcal).min;
  const perfect = proteinHit && kcalIn && carbHit && fatHit;
  return { logged: true, proteinHit, carbHit, fatHit, kcalIn, fiberHit, perfect };
}
function crHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function loggedDatesSet(db) { const s = new Set(); (db.log_entries || []).forEach(e => s.add(e.date)); return s; }
function streakEndingOn(db, dateISO) { const s = loggedDatesSet(db); let d = dateISO, n = 0; while (s.has(d) && n < 400) { n++; d = shiftISO(d, -1); } return n; }
function perfectDaysIn(db, endISO, span) { let n = 0; for (let i = 0; i < span; i++) { const q = dayQuality(db, shiftISO(endISO, -i)); if (q && q.perfect) n++; } return n; }
// A "quality" day powers egg incubation: you logged, hit your protein target and landed your
// calories. It rewards eating well, distinct from the breakthrough which rewards just showing up.
function isQualityDay(db, date) { const q = dayQuality(db, date); return !!(q && q.proteinHit && q.kcalIn); }
// Quality days strictly after `afterISO` up to and including `throughISO` (an egg's "distance").
function qualityDaysAfter(db, afterISO, throughISO) { let n = 0, d = shiftISO(afterISO, 1), g = 0; while (d <= throughISO && g < 400) { if (isQualityDay(db, d)) n++; d = shiftISO(d, 1); g++; } return n; }
// Your daily step goal: the step count assumed by your activity band (same target as the home tile).
// Daily step goal: a user-set target (profile.stepGoal) wins; otherwise fall back to the activity band.
function stepGoalFor(db) { const g = db.profile && +db.profile.stepGoal; return (g > 0 ? Math.round(g) : 0) || withActivity(db.profile).avgSteps || 0; }
// A step-goal day: you hit or beat that goal. Days with no step reading never qualify, so this is
// entirely opt-in and changes nothing until you actually track steps (manually or via Google Health).
function isStepGoalDay(db, date) { const g = stepGoalFor(db); return g > 0 && (+((db.steps || {})[date]) || 0) >= g; }
// This morning's readiness: our own recovery score (Oura/Whoop style, baseline-relative). Phase A feeds
// last night's sleep + a training-load proxy from steps; Phase B adds HRV + resting HR from db.health so
// the same tile just gets sharper. Returns 0..100 or null when there is nothing to score yet.
function readinessFor(db, dateISO) {
  const rec = (db.sleep || {})[dateISO] || null;                 // last night, keyed by wake (today's) date
  const steps = db.steps || {};
  const inp = {};
  // Recompute the sleep score from stages rather than trusting rec.score: older syncs stored a
  // duration-only score (100) on stage-less nights, and readiness must not echo that stale number.
  // A stage-less night yields null here, so it contributes no sleep signal to readiness at all.
  if (rec && isFinite(rec.min)) {
    const stages = (rec.deep != null || rec.rem != null || rec.light != null || rec.awake != null)
      ? { deep: rec.deep || 0, rem: rec.rem || 0, light: rec.light || 0, awake: rec.awake || 0 } : null;
    const target = (db.profile && db.profile.sleepTargetMin) || Game.SLEEP_TARGET_DEFAULT;
    const sc = Game.sleepScore(rec.min, target, stages);
    if (isFinite(sc)) inp.sleepScore = sc;
  }
  const loadY = +steps[shiftISO(dateISO, -1)] || 0;              // yesterday's steps as a rough load proxy
  const base = E.avgStepsInRange(steps, shiftISO(dateISO, -8), shiftISO(dateISO, -1)) || 0;
  if (loadY > 0 && base > 0) { inp.load = loadY; inp.loadBaseline = base; }
  const h = (db.health || {})[dateISO];                          // Phase B: { hrv, hrvBaseline, rhr, rhrBaseline, tempDev }
  if (h) { ['hrv', 'hrvBaseline', 'rhr', 'rhrBaseline', 'tempDev'].forEach(k => { if (isFinite(h[k])) inp[k] = h[k]; }); }
  return Game.readinessScore(inp);
}
// Egg "distance" (Pokemon GO style: walk to hatch). A day moves the egg along if it was a quality
// day OR a day you hit your step goal, counted once per date so it can never exceed one step a day.
function incubationDaysAfter(db, afterISO, throughISO) { let n = 0, d = shiftISO(afterISO, 1), g = 0; while (d <= throughISO && g < 400) { if (isQualityDay(db, d) || isStepGoalDay(db, d)) n++; d = shiftISO(d, 1); g++; } return n; }
function creatureForDay(db, date) {
  const q = dayQuality(db, date); if (!q) return null;
  const h = Game.seedFor(db.game_salt || '', date); // per-user roll; empty salt matches the legacy date-only hash
  const boost = (db.dex_boost && db.dex_boost.date === date) ? db.dex_boost : null;
  let pool = ['nugg', 'dinky', 'pebble'];
  if (q.proteinHit) pool.push('protops');
  if (q.proteinHit && q.kcalIn) pool.push('flexor');
  if (q.carbHit) pool.push('carbo');
  if (q.carbHit && q.fiberHit) pool.push('noodon');
  if (q.fatHit) pool.push('fatzilla');
  if (q.fatHit && q.kcalIn) pool.push('buttron');
  if (q.fiberHit) pool.push('sprowl');
  if (q.fiberHit && q.proteinHit) pool.push('frondo');
  if (q.perfect) pool = pool.concat(['veloci', 'platealon', 'triceros']);
  if (q.perfect && h % 14 === 0) pool.push('rexosaur');
  if (q.perfect && perfectDaysIn(db, date, 7) >= 5) pool.push('aurora');
  if (q.perfect && streakEndingOn(db, date) >= 30) pool.push('chronos');
  // Item boosts narrow the pool: Incubator forces rare+, Lure favours a chosen biome.
  let sub = null;
  if (boost && boost.rare) { const r = pool.filter(id => RARITY_RANK[CR_BY_ID[id].rarity] >= 2); if (r.length) sub = r; }
  if (!sub && boost && boost.lure) { const l = pool.filter(id => CR_BY_ID[id].biome === boost.lure); if (l.length) sub = l; }
  const from = sub || pool;
  const id = from[h % from.length];
  const shiny = (q.perfect && h % 11 === 0) || !!(boost && boost.shiny && q.perfect);
  return { id: id, shiny: shiny };
}
// The creature a day displays. Past days always render from the persisted catch_log (locked at
// first record, so editing old food never changes a caught creature); only TODAY renders the
// live provisional roll, which can still upgrade until the day ends.
function catchForDay(db, date) {
  const today = Store.todayISO();
  if (date === today) { const c = creatureForDay(db, date); if (c) return c; }
  const arr = (db.catch_log || {})[date] || [];
  if (arr.length) { const main = arr.filter(x => !x.migratory); const pick = main.length ? main[main.length - 1] : arr[arr.length - 1]; return { id: pick.id, shiny: !!pick.shiny }; }
  if (date === today) return null;
  return creatureForDay(db, date); // legacy fallback until the persist effect backfills catch_log
}
function macrodex(db) {
  const caught = {};
  const cl = db.catch_log || {};
  const dates = Object.keys(cl);
  if (dates.length) {
    // Read from the persisted catch log so a creature you've caught stays caught, even if you later edit that day's food.
    dates.sort().forEach(d => (cl[d] || []).forEach(c => {
      const cur = caught[c.id] || { count: 0, shiny: false, firstDate: d };
      cur.count++; if (c.shiny) cur.shiny = true; caught[c.id] = cur;
    }));
  } else {
    // Fallback for accounts logged before catch_log existed (until the persist effect backfills it).
    const seen = {}; db.log_entries.forEach(e => { seen[e.date] = true; });
    Object.keys(seen).sort().forEach(d => { const c = creatureForDay(db, d); if (!c) return; const cur = caught[c.id] || { count: 0, shiny: false, firstDate: d }; cur.count++; if (c.shiny) cur.shiny = true; caught[c.id] = cur; });
  }
  return caught;
}
const BUDDY_STAGES = [
  { min: 0, name: 'Dozing Egg', art: 'egg', colors: crC('#EAD9A0', '#C77D3A') },
  { min: 1, name: 'Hatchling', art: 'hatch', colors: crC('#7FD46B', '#3f8e2f') },
  { min: 3, name: 'Younglin', art: 'saur', colors: crC('#5fb84f', '#3a8030') },
  { min: 7, name: 'Saurling', art: 'saur', colors: crC('#2FB0A0', '#1e7a70') },
  { min: 14, name: 'Veloci', art: 'raptor', colors: crC('#B06BE0', '#7a3fb0') },
  { min: 30, name: 'Rexosaur', art: 'rex', colors: crC('#6B5FC0', '#3a3170') },
];
// Streak maths lives in the pure, unit-tested game module. A day counts as ACTIVE if it
// has food logs OR a weigh-in, and a monthly "streak freeze" forgives one missed day.
const computeStreak = Game.computeStreak;
const freezeReady = Game.freezeReady;

// --- The buddy as an individual you raise: personality, mood voice, and a view model ---
const PERSONALITIES = [
  { key: 'plucky', label: 'Plucky', blurb: 'never backs down' },
  { key: 'steady', label: 'Steady', blurb: 'slow and certain' },
  { key: 'greedy', label: 'Greedy', blurb: 'lives for mealtime' },
  { key: 'gentle', label: 'Gentle', blurb: 'a soft-hearted soul' },
  { key: 'brave', label: 'Brave', blurb: 'first into the pit' },
  { key: 'dozy', label: 'Dozy', blurb: 'napping at any hour' },
];
function personalityFor(seed) { return PERSONALITIES[crHash(String(seed || 'egg')) % PERSONALITIES.length]; }
// Mood is how the buddy reads right now; the line is a stable-per-day flavour string. Warm,
// never scolding, so a lapse is an invitation to feed it rather than a telling-off.
const MOOD_META = {
  thriving: { label: 'Thriving', color: 'var(--good)', lines: ['Firing on all cylinders.', 'Best it has felt in ages.', 'Practically glowing after that.'] },
  content: { label: 'Content', color: 'var(--carb)', lines: ['Fed and happy.', 'A good, steady day.', 'Quietly pleased with you.'] },
  peckish: { label: 'Peckish', color: 'var(--fat)', lines: ['Could do with more protein.', 'Still a little hungry.', 'Decent start, feed it up.'] },
  sluggish: { label: 'Sluggish', color: 'var(--weight)', lines: ['Waiting on today’s first meal.', 'A bit low, nothing logged yet.', 'Perks right up when you log.'] },
  asleep: { label: 'Napping', color: 'var(--muted)', lines: ['Fast asleep. Log to wake it.', 'Curled up, dreaming of snacks.'] },
};
function moodLine(mood, seed) { const m = MOOD_META[mood] || MOOD_META.content; return m.lines[crHash(String(seed) + mood) % m.lines.length]; }
// Live view model for the buddy: given name, personality, days-together, and the bond / mood /
// needs derived from how you have actually been eating. Pure read over db (no writes).
function buddyProfile(db, streak, buddy, level) {
  const today = Store.todayISO();
  const b = db.buddy || {};
  const dates = (db.log_entries || []).map(e => e.date).sort();
  const firstLog = dates[0] || null;
  const hatchedISO = b.hatchedISO || firstLog || today;
  // Trailing bond window, starting no earlier than the first log so newcomers aren't diluted.
  const start = firstLog && Game.daysBetween(firstLog, today) < Game.BOND_WINDOW ? firstLog : shiftISO(today, -(Game.BOND_WINDOW - 1));
  const recentQ = []; for (let d = start, g = 0; d <= today && g < Game.BOND_WINDOW + 1; d = shiftISO(d, 1), g++) recentQ.push(dayQuality(db, d));
  const loggedToday = entriesOn(db, today).length > 0;
  const todayQ = dayQuality(db, today);
  const bond = Game.buddyBond(recentQ);
  const lvl = level != null ? level : buddyLevel(db);
  // Species + current evolution form (bond-gated, stored high-water).
  const species = CR_BY_ID[b.speciesId] || CR_BY_ID['dinky'];
  const evoLine = (species && species.evo) || [];
  const evoStage = Math.min(b.evoStage || 0, evoLine.length);
  const form = buddyForm(species, evoStage, lvl);
  const next = evoStage < evoLine.length ? evoLine[evoStage] : null;
  const heartsNeed = next ? (EVO_HEART_REQ[evoStage] || 2) : 0;
  const evoInfo = next
    ? { atMax: false, nextName: next.name, levelNeed: next.at, level: lvl, heartsNeed, hearts: bond.hearts,
        ready: lvl >= next.at && bond.hearts >= heartsNeed,
        progress: Math.max(0, Math.min(1, Math.min(lvl / next.at, bond.hearts / (heartsNeed || 1)))) }
    : { atMax: true, level: lvl, progress: 1 };
  return {
    name: b.name || '',
    personality: PERSONALITIES.find(p => p.key === b.personality) || null,
    daysTogether: Math.max(1, Game.daysBetween(hatchedISO, today) + 1),
    bond, level: lvl, species, evoStage, form, evoInfo,
    affinity: evoStage > 0 ? (b.affinity || null) : null,   // only shows once evolved
    mood: Game.buddyMood(buddy.asleep, loggedToday, todayQ),
    needs: Game.buddyNeeds(loggedToday, todayQ, streak),
    craving: Game.buddyCraving(todayQ),
  };
}
// What the buddy is craving, in words, framing the day's macro gap as a thing to feed it.
const CRAVE_LABEL = { firstmeal: 'a first meal', protein: 'protein', fibre: 'fibre', fuel: 'more fuel' };

function BuddyCard({ db, streak, buddy, freezeReady, onOpenDex }) {
  const st = BUDDY_STAGES[Math.min(buddy.stage, BUDDY_STAGES.length - 1)];
  const dex = macrodex(db); const caught = Object.keys(dex).length;
  const next = BUDDY_STAGES[buddy.stage + 1] || null;
  const toNext = next ? Math.max(1, next.min - streak) : 0;
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <button onClick={onOpenDex} className="pixel-box p-2 shrink-0 relative" style={{ background: 'var(--surface3)' }}>
          <div style={buddy.asleep ? { filter: 'grayscale(0.85)', opacity: 0.45 } : null}><Sprite art={st.art} colors={st.colors} px={6} /></div>
          {buddy.asleep && <span className="pf absolute" style={{ top: 2, right: 3, fontSize: 9, color: 'var(--carb)' }}>Zz</span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] text-[#8A8A90] flex items-center gap-1.5">YOUR BUDDY · STREAK {streak}<span className="inline-flex items-center gap-0.5" title={freezeReady ? 'Streak freeze ready, one missed day is forgiven this month' : 'Streak freeze already used this month'} style={{ opacity: freezeReady ? 1 : 0.35 }}><PixelGlyph kind="snow" color="var(--carb)" size={10} /></span></div>
          <div className="text-lg font-bold leading-tight">{st.name}{buddy.asleep ? ' (napping)' : ''}</div>
          <div className="text-[11px] text-[#8A8A90] leading-snug">{buddy.asleep
            ? `${buddy.wakeIn} more logged day${buddy.wakeIn === 1 ? '' : 's'} wakes ${st.name} up.`
            : next ? `${toNext} more logged day${toNext === 1 ? '' : 's'} to evolve.` : 'Fully evolved. Legend status.'}</div>
        </div>
      </div>
      <button onClick={onOpenDex} className="pixel-btn w-full py-2.5 text-[9px] inline-flex items-center justify-center gap-2" style={{ background: 'var(--header)', color: '#fff' }}>MACRODEX · CAUGHT {caught} ›</button>
    </Card>
  );
}
// Macrodex Active section: the three always-on loops (today's catch, weekly breakthrough, egg
// incubation) gathered in one place at the top of the dex, each showing its reward reveal on the
// day it lands. This is what turns the dex from a static grid into the hub of the whole system.
function DexActiveSection({ db, today }) {
  const bt = db.breakthrough;
  const logged = new Set((db.log_entries || []).map(e => e.date)).size;
  const btState = Game.breakthroughState(logged, bt ? bt.base : logged);
  const eggs = db.eggs; const egg = eggs && eggs.cur ? eggs.cur : null;
  const eggProg = egg ? Game.eggProgress(incubationDaysAfter(db, egg.startDate, today), egg.tier) : null;
  const tc = catchForDay(db, today); const tcr = tc && CR_BY_ID[tc.id];
  const btJust = bt && bt.lastDate === today; const btCr = bt && bt.lastId ? CR_BY_ID[bt.lastId] : null;
  const eggJust = eggs && eggs.lastDate === today; const eggCr = eggs && eggs.lastId ? CR_BY_ID[eggs.lastId] : null;
  // Monthly Expedition: the featured creature to chase this month.
  const expMonth = today.slice(0, 7);
  const expCr = CR_BY_ID[Game.monthlyFeatured(expMonth)];
  const expDone = !!(db.game_awards || {})['expedition:' + expMonth];
  const expQ = Array.from(new Set((db.log_entries || []).map(e => e.date))).filter(d => d.slice(0, 7) === expMonth && isQualityDay(db, d)).length;
  const expSt = Game.expeditionState(expQ);
  const panel = 'pixel-box p-3';
  const pStyle = { background: 'var(--surface3)', boxShadow: 'none' };
  return (
    <div className="mb-4">
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Active</div>
      <div className={panel + ' mb-2'} style={pStyle}>
        <div className="flex items-center gap-2.5">
          <div className="pixel-box p-1 shrink-0" style={{ background: 'var(--surface2)', boxShadow: 'none', borderColor: tcr ? CR_RARITY_COLOR[tcr.rarity] : 'var(--border)', borderWidth: 3 }}>
            {tcr ? <div style={crFx(tc.shiny, null)}><Sprite art={tcr.art} colors={tc.shiny ? crShiny(tcr.colors) : tcr.colors} px={2.6} /></div> : <Sprite art="egg" colors={crSilhouette()} px={2.6} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="pf text-[7px] uppercase text-[#8A8A90] mb-0.5">Today's catch</div>
            {tcr ? <><div className="text-[11px] font-bold leading-tight">{tcr.name}{tc.shiny ? <span style={{ color: 'var(--fat)' }}> ✦</span> : ''}</div><div className="pf text-[7px] uppercase" style={{ color: CR_RARITY_COLOR[tcr.rarity] }}>{CR_RARITY_LABEL[tcr.rarity]}</div></>
              : <div className="text-[10px] text-[#8A8A90] leading-snug">Log a meal today to catch one. The macros you hit decide which.</div>}
          </div>
        </div>
      </div>
      <div className={panel + ' mb-2'} style={pStyle}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="pf text-[7px] uppercase text-[#8A8A90]">Weekly breakthrough</span>
          <span className="pf text-[7px] uppercase tnum" style={{ color: btState.breakthroughs > 0 ? 'var(--good)' : 'var(--muted)' }}>{btState.breakthroughs > 0 ? btState.breakthroughs + ' earned' : btState.stamps + '/' + btState.goal}</span>
        </div>
        <BreakthroughMeter state={btState} size={12} />
        {btJust && btCr ? <div className="flex items-center gap-2 mt-2 fade-in">
          <div className="shrink-0" style={crFx(bt.lastShiny, null)}><Sprite art={btCr.art} colors={bt.lastShiny ? crShiny(btCr.colors) : btCr.colors} px={2} /></div>
          <div className="text-[10px] leading-snug"><span style={{ color: 'var(--good)' }}>Breakthrough! </span><b>{btCr.name}{bt.lastShiny ? ' ✦' : ''}</b> joined your dex.</div>
        </div>
        : <div className="text-[9px] text-[#8A8A90] mt-1.5">Log {btState.toNext} more {btState.toNext === 1 ? 'day' : 'days'} for a guaranteed rare+ catch.</div>}
      </div>
      {expCr && <div className={panel + ' mb-2'} style={pStyle}>
        <div className="flex items-center gap-2.5">
          <div className="pixel-box p-1 shrink-0" style={{ background: 'var(--surface2)', boxShadow: 'none', borderColor: CR_RARITY_COLOR[expCr.rarity], borderWidth: 3 }}>
            {expDone ? <Sprite art={expCr.art} colors={expCr.colors} px={2.6} /> : <Sprite art={expCr.art} colors={crSilhouette()} px={2.6} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="pf text-[7px] uppercase text-[#8A8A90]">This month’s expedition</span>
              <span className="pf text-[7px] uppercase" style={{ color: CR_RARITY_COLOR[expCr.rarity] }}>{CR_RARITY_LABEL[expCr.rarity]}</span>
            </div>
            {expDone
              ? <div className="text-[10px] leading-snug"><span style={{ color: 'var(--good)' }}>Caught!</span> <b>{expCr.name}</b> joined your dex this month.</div>
              : <>
                <div className="text-[10px] font-bold leading-tight">{expCr.name}</div>
                <div className="pixel-bar mt-1" style={{ height: 9, borderWidth: 2 }}><i style={{ width: (expSt.days / expSt.goal * 100) + '%', background: 'var(--weight)', transition: 'width .4s' }} /></div>
                <div className="text-[9px] text-[#8A8A90] mt-1 leading-snug">{expSt.toGo} quality {expSt.toGo === 1 ? 'day' : 'days'} this month to catch it. A quality day: hit protein and land your calories.</div>
              </>}
          </div>
        </div>
      </div>}
      {egg && eggProg && <div className={panel} style={pStyle}>
        <div className="flex items-center gap-2.5">
          <div className="pixel-box p-1 shrink-0" style={{ background: 'var(--surface2)', boxShadow: 'none', borderColor: EGG_TIER_COLOR[egg.tier], borderWidth: 3 }}><Sprite art="egg" colors={EGG_TIER_EGGCOLORS[egg.tier]} px={2.6} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold">{egg.tier}-day egg <span className="pf text-[7px] uppercase" style={{ color: EGG_TIER_COLOR[egg.tier] }}>{EGG_TIER_LABEL[egg.tier]}</span></span>
              <span className="pf text-[7px] uppercase text-[#8A8A90] tnum">{eggProg.steps}/{eggProg.tier}</span>
            </div>
            <div className="pixel-bar" style={{ height: 9, borderWidth: 2 }}><i style={{ width: (eggProg.steps / eggProg.tier * 100) + '%', background: EGG_TIER_COLOR[egg.tier], transition: 'width .4s' }} /></div>
            <div className="text-[9px] text-[#8A8A90] mt-1 leading-snug">{eggJust && eggCr ? <span><span style={{ color: 'var(--good)' }}>Hatched!</span> <b>{eggCr.name}{eggs.lastShiny ? ' ✦' : ''}</b> joined your dex.</span> : eggProg.toGo === 0 ? 'Ready to hatch on your next quality or step-goal day.' : eggProg.toGo + ' ' + (eggProg.toGo === 1 ? 'day' : 'days') + ' to hatch. Each quality day (hit protein, land calories) or day you hit your step goal moves it along.'}</div>
          </div>
        </div>
      </div>}
      {(() => {
        // Sleep styles: a Pokemon Sleep style style-dex. A creature caught from a night's sleep carries
        // one of three styles; collect all three of each. Counts come from the style tags on catches.
        const collected = {};
        Object.keys(db.catch_log || {}).forEach(dt => (db.catch_log[dt] || []).forEach(c => { if (c && c.style) collected[c.style] = (collected[c.style] || 0) + 1; }));
        const sdex = db.sleepDex || {};
        const just = sdex.lastDate === today && sdex.lastId; const jcr = just && CR_BY_ID[sdex.lastId];
        return (
          <div className={panel + ' mt-2'} style={pStyle}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="pf text-[7px] uppercase text-[#8A8A90]">Sleep styles</span>
              <span className="pf text-[7px] uppercase tnum" style={{ color: Object.keys(collected).length ? 'var(--accent)' : 'var(--muted)' }}>{Object.keys(collected).length}/{Game.SLEEP_STYLES.length}</span>
            </div>
            <div className="flex gap-1.5">
              {Game.SLEEP_STYLES.map(st => {
                const on = collected[st] > 0;
                return <div key={st} className="pixel-box flex-1 text-center px-1 py-1" style={{ background: 'var(--surface2)', boxShadow: 'none', borderWidth: 2, borderColor: on ? 'var(--accent)' : 'var(--border)', opacity: on ? 1 : 0.5 }}>
                  <div className="pf text-[7px] uppercase" style={{ color: on ? 'var(--accent)' : 'var(--muted)' }}>{st}</div>
                  <div className="text-[9px] tnum" style={{ color: on ? 'var(--text)' : 'var(--muted)' }}>{on ? '×' + collected[st] : '–'}</div>
                </div>;
              })}
            </div>
            <div className="text-[9px] text-[#8A8A90] mt-1.5 leading-snug">{just && jcr ? <span><span style={{ color: 'var(--good)' }}>Slept well!</span> A {sdex.lastStyle} <b>{jcr.name}{sdex.lastShiny ? ' ✦' : ''}</b> joined your dex.</span> : 'Sleep well with Google Health connected and a creature gathers each morning. Better sleep draws rarer ones.'}</div>
          </div>
        );
      })()}
    </div>
  );
}
function MacrodexModal({ db, update, streak, onClose, onOpenFight, onOpenName }) {
  useBackClose(onClose);
  useEffect(() => { if (db.onboarding && db.onboarding.sawDex) return; update(d => { d.onboarding = d.onboarding || {}; d.onboarding.sawDex = true; }); }, []);
  const dex = macrodex(db); const caught = Object.keys(dex).length;
  const items = db.items || {}; const today = Store.todayISO();
  const boost = (db.dex_boost && db.dex_boost.date === today) ? db.dex_boost : null;
  const [sel, setSel] = useState(null); const [lurePick, setLurePick] = useState(false); const [trophies, setTrophies] = useState(false);
  const invIds = ITEM_ORDER.filter(id => (items[id] || 0) > 0);
  function useItem(id, macro) {
    update(d => {
      if (!(d.items && d.items[id] > 0)) return;
      d.items[id]--; if (d.items[id] <= 0) delete d.items[id];
      const b = (d.dex_boost && d.dex_boost.date === today) ? d.dex_boost : { date: today, lure: null, shiny: false, rare: false };
      if (id === 'lure') b.lure = macro; if (id === 'golden_steak' || id === 'honest_rex') b.shiny = true; if (id === 'incubator') b.rare = true;
      d.dex_boost = b;
    });
    setLurePick(false);
  }
  const cr = sel ? CR_BY_ID[sel] : null; const got = cr ? dex[cr.id] : null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-[#262629] rounded-full mx-auto mb-4" />
        {trophies ? <TrophyCabinet db={db} streak={streak} onBack={() => setTrophies(false)} />
        : cr ? (() => {
          const form = creatureForm(cr, got ? got.count : 0); const rc = CR_RARITY_COLOR[cr.rarity];
          const cnt = got ? got.count : 0;
          const nextEvo = cr.evo ? cr.evo.find(e => cnt < e.at) : null;
          const evoNote = cr.evo ? (nextEvo ? ` · evolves at Lv ${nextEvo.at}` : cnt < 25 ? ' · Elder aura at Lv 25' : cnt < 50 ? ' · Ancient aura at Lv 50' : ' · fully evolved') : '';
          const bm = BIOMES.find(b => b.id === cr.biome) || {};
          const migMonths = cr.migratory ? Array.from(new Set(Object.keys(db.catch_log || {}).flatMap(dd => ((db.catch_log || {})[dd] || []).filter(x => x.id === cr.id && x.migratory).map(x => x.migratory)))).sort() : [];
          return <div className="fade-in">
            <button onClick={() => setSel(null)} className="text-[11px] text-[#8A8A90] mb-3">‹ Back to dex</button>
            <div className="flex flex-col items-center text-center">
              <div className="pixel-box p-3 mb-3" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: got ? rc : 'var(--border)', borderWidth: 4 }}><div style={got ? crFx(got.shiny, form.aura) : null}>{got ? <Sprite art={form.art} colors={got.shiny ? crShiny(form.colors) : form.colors} px={7} /> : <Sprite art={cr.art} colors={crSilhouette()} px={7} />}</div></div>
              <div className="text-lg font-bold">{got ? form.name : '???'}{got && got.shiny ? <span style={{ color: 'var(--fat)' }}> ✦</span> : ''}</div>
              <div className="pf text-[8px] uppercase mt-1" style={{ color: rc }}>{CR_RARITY_LABEL[cr.rarity]}{cr.migratory ? ' · Migratory' : ''} · {bm.name}</div>
            </div>
            <div className="pixel-box p-3 mt-4 text-[11px]" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
              <div className="pf text-[8px] uppercase text-[#8A8A90] mb-1">How to catch</div>
              <div className="text-[var(--text2)] leading-snug">{cr.cond}</div>
            </div>
            <div className="mt-3 text-[11px] leading-relaxed">{got ? cr.lore : <span className="text-[#8A8A90]">Not yet caught. Meet the condition above on any logged day and it joins your dex, its lore unlocks then.</span>}</div>
            {got && migMonths.length > 0 && <div className="mt-2 text-[10px]" style={{ color: 'var(--carb)' }}>Migrated through: {migMonths.map(m => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })).join(', ')}</div>}
            {got && <div className="mt-3 text-[10px] text-[#8A8A90]">Caught <b className="text-[var(--text)]">Lv {got.count}</b>{evoNote}{got.shiny ? ' · ✦ shiny' : ''}</div>}
          </div>;
        })() : (<>
          <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">Play</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>

          {/* Boss fight, front and centre: this used to be a nameless button lost in a 2-up grid, so
              nobody knew there was a weekly boss to beat. Now it's the hub's headline call to action,
              spelling out who the boss is, its weakness (what to eat), and your readiness buff. */}
          {onOpenFight && (() => {
            const wk = fightWeekKey();
            const boss = bossForWeek();
            const wm = TYPE_META[Game.bossWeakness(wk)] || TYPE_META.balanced;
            const beaten = !!(db.fight && db.fight.lastBossWeek === wk);
            const readiness = readinessFor(db, today);
            const buff = readiness != null ? Game.readinessBuff(readiness) : null;
            const buffLine = buff && buff.atk > 1 ? 'You hit +' + Math.round((buff.atk - 1) * 100) + '% today'
              : buff && buff.atk < 1 ? 'Guard stance today, heals as you fight'
              : buff ? 'Full strength today' : null;
            const edge = beaten ? 'var(--good)' : 'var(--danger)';
            // pixel-box forces a grey border (!important), so the emphasis comes from a danger-tinted
            // background + the raised shadow (kept) + the red kicker text and filled FIGHT pill.
            return (
              <button onClick={onOpenFight} className="w-full text-left pixel-box p-3 mb-3 flex items-center gap-3"
                style={{ background: 'color-mix(in srgb, ' + edge + ' 13%, var(--surface2))' }}>
                <div className="pixel-box p-1.5 shrink-0" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
                  <Sprite art={boss.art} colors={boss.colors} px={3.2} />
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="pf text-[7px] uppercase" style={{ color: edge }}>{beaten ? 'Boss beaten this week ✓' : "This week's boss"}</div>
                  <div className="text-[13px] font-bold truncate">{boss.name}</div>
                  <div className="text-[9.5px] text-[#8A8A90] leading-snug mt-0.5">Weak to <span style={{ color: wm[1] }}>{wm[0]}</span>, so eat {wm[2]}.{buffLine ? ' ' + buffLine + '.' : ''}</div>
                </div>
                <span className="pf text-[9px] px-2.5 py-2.5 shrink-0" style={{ background: beaten ? 'var(--surface3)' : 'var(--danger)', color: beaten ? 'var(--muted)' : '#fff' }}>{beaten ? 'REMATCH ›' : 'FIGHT ›'}</span>
              </button>
            );
          })()}

          <div className="text-[11px] text-[#8A8A90] mb-2 leading-relaxed">Every logged day catches a creature. Tap one for its lore.</div>
          <div className="flex items-center gap-2 mb-3">
            <div className="pixel-bar flex-1" style={{ height: 14, borderWidth: 2 }}><i style={{ width: Math.round(Math.min(1, caught / CREATURES.length) * 100) + '%', background: 'var(--good)' }} /></div>
            <div className="pf text-[9px] tnum shrink-0">caught {caught}</div>
          </div>
          <div className={'grid gap-2 mb-4 ' + (onOpenName && !(db.buddy && db.buddy.name) ? 'grid-cols-2' : 'grid-cols-1')}>
            <button onClick={() => setTrophies(true)} className="pixel-btn py-2.5 text-[10px] inline-flex items-center justify-center gap-2" style={{ background: 'var(--surface2)' }}><PixelGlyph kind="trophy" color="var(--fat)" size={13} /> TROPHIES</button>
            {onOpenName && !(db.buddy && db.buddy.name) && <button onClick={onOpenName} className="pixel-btn py-2.5 text-[10px]" style={{ background: 'var(--surface2)' }}>NAME YOUR DINO</button>}
          </div>
          <DexActiveSection db={db} today={today} />
          {invIds.length > 0 && <div className="pixel-box p-3 mb-4" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
            <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Your items</div>
            {boost && (boost.lure || boost.shiny || boost.rare) && <div className="text-[9px] mb-2" style={{ color: 'var(--good)' }}>Active today:{boost.lure ? ` ${(BIOMES.find(b => b.id === boost.lure) || {}).name} lure` : ''}{boost.rare ? ' · rare boost' : ''}{boost.shiny ? ' · shiny locked' : ''}</div>}
            <div className="space-y-2">
              {invIds.map(id => { const it = ITEMS[id]; const n = items[id];
                return <div key={id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0"><div className="text-[11px] font-bold">{it.name} <span className="text-[#8A8A90]">×{n}</span></div><div className="text-[9px] text-[#8A8A90] leading-snug">{it.desc}</div></div>
                  {it.kind === 'dex' && <button onClick={() => id === 'lure' ? setLurePick(v => !v) : useItem(id)} className="pixel-btn px-2.5 py-1.5 text-[9px] shrink-0" style={{ background: 'var(--pro)', color: '#fff' }}>USE</button>}
                </div>;
              })}
            </div>
            {lurePick && <div className="mt-3 fade-in">
              <div className="text-[9px] text-[#8A8A90] mb-1.5">Point the lure at a biome for today’s catch:</div>
              <div className="grid grid-cols-2 gap-1.5">{[['protein', 'Protein'], ['carb', 'Carb'], ['fat', 'Fat'], ['fibre', 'Fibre']].map(([v, l]) => <button key={v} onClick={() => useItem('lure', v)} className="pixel-box py-2 text-[10px]" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>{l}</button>)}</div>
            </div>}
          </div>}
          <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Collection</div>
          {BIOMES.map(bm => { const list = CREATURES.filter(c => c.biome === bm.id); const done = list.filter(c => dex[c.id]).length; const complete = done === list.length && list.length > 0;
            return <div key={bm.id} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="pf text-[9px] uppercase flex items-center gap-1.5" style={{ color: complete ? 'var(--good)' : 'var(--text2)' }}><span style={{ width: 8, height: 8, background: BIOME_COLOR[bm.id], display: 'inline-block' }} />{bm.name}{complete ? ' ✓' : ''}</div>
                <div className="text-[9px] text-[#8A8A90] tnum">{done}/{list.length}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {list.map(c => { const g = dex[c.id]; const form = creatureForm(c, g ? g.count : 0); const rc = CR_RARITY_COLOR[c.rarity]; const strong = g && (c.rarity === 'legendary' || c.rarity === 'mythic' || g.shiny);
                  return <button key={c.id} onClick={() => setSel(c.id)} className="pixel-box p-2 flex flex-col items-center text-center" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: g ? rc : 'var(--border)', borderWidth: strong ? 4 : 3 }}>
                    <div className="h-14 flex items-center justify-center" style={g ? crFx(g.shiny, form.aura) : null}>{g ? <Sprite art={form.art} colors={g.shiny ? crShiny(form.colors) : form.colors} px={4} /> : <Sprite art={c.art} colors={crSilhouette()} px={4} />}</div>
                    <div className="text-[9px] mt-1 truncate w-full">{g ? form.name : '???'}</div>
                    {g ? <div className="text-[7px] uppercase tracking-wide" style={{ color: g.shiny ? 'var(--fat)' : 'var(--good)' }}>Lv {g.count}{g.shiny ? ' ✦' : ''}</div>
                       : <div className="text-[7px] uppercase tracking-wide" style={{ color: rc }}>{CR_RARITY_LABEL[c.rarity]}</div>}
                  </button>;
                })}
              </div>
            </div>;
          })}
        </>)}
      </div>
    </div>
  );
}
// Trophy cabinet: trophies won, shiny gallery, streak records and the badge tracks.
function TrophyCabinet({ db, streak, onBack }) {
  useBackClose(onBack);
  const items = db.items || {}; const dex = macrodex(db);
  const badges = db.badges || { checkins: 0, inRange: 0 };
  const longest = Math.max((db.records && db.records.longestStreak) || 0, streak || 0);
  const shinies = CREATURES.filter(c => dex[c.id] && dex[c.id].shiny);
  const trophyIds = ['amber', 'belt', 'medal'].filter(id => (items[id] || 0) > 0);
  const Track = ({ label, count, hint }) => {
    const t = Game.badgeTier(count);
    return <div className="pixel-box p-3 mb-2" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
      <div className="flex justify-between items-center"><div className="text-[11px] font-bold">{label}</div><div className="pf text-[8px]" style={{ color: t.level > 0 ? 'var(--good)' : 'var(--muted)' }}>TIER {t.level}/{t.max}</div></div>
      <div className="pixel-bar my-1.5" style={{ height: 10, borderWidth: 2 }}><i style={{ width: Math.round(t.progress * 100) + '%', background: 'var(--good)' }} /></div>
      <div className="text-[9px] text-[#8A8A90] tnum">{count} so far{t.next != null ? ` · next tier at ${t.next}` : ' · maxed out'} · {hint}</div>
    </div>;
  };
  return <div className="fade-in">
    <button onClick={onBack} className="text-[11px] text-[#8A8A90] mb-3">‹ Back to dex</button>
    <div className="flex items-center gap-2 mb-3"><PixelGlyph kind="trophy" color="var(--fat)" size={16} /><h2 className="text-lg font-semibold">Trophy cabinet</h2></div>
    <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Streak records</div>
    <div className="grid grid-cols-2 gap-2 mb-4">
      <div className="pixel-box p-3 text-center" style={{ background: 'var(--surface3)', boxShadow: 'none' }}><div className="text-xl font-bold tnum" style={{ color: 'var(--fat)' }}>{streak || 0}</div><div className="text-[9px] text-[#8A8A90]">current streak</div></div>
      <div className="pixel-box p-3 text-center" style={{ background: 'var(--surface3)', boxShadow: 'none' }}><div className="text-xl font-bold tnum" style={{ color: 'var(--fat)' }}>{longest}</div><div className="text-[9px] text-[#8A8A90]">longest ever</div></div>
    </div>
    <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Badges</div>
    <Track label="Check-ins completed" count={badges.checkins || 0} hint="show up for the weekly read" />
    <Track label="In-range check-ins" count={badges.inRange || 0} hint="trend within 0.1 kg/wk of target" />
    <div className="pf text-[8px] uppercase text-[#8A8A90] mt-4 mb-2">Trophies</div>
    {trophyIds.length ? <div className="space-y-2 mb-4">{trophyIds.map(id => { const it = ITEMS[id];
      return <div key={id} className="pixel-box p-3 flex items-center gap-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
        <PixelGlyph kind="trophy" color="var(--fat)" size={18} />
        <div className="min-w-0 flex-1"><div className="text-[11px] font-bold">{it.name} <span className="text-[#8A8A90]">×{items[id]}</span></div><div className="text-[9px] text-[#8A8A90] leading-snug">{it.desc}</div></div>
      </div>; })}</div>
      : <div className="text-[10px] text-[#8A8A90] mb-4">No trophies yet. Beat the weekly boss for Amber, clear the ladder for the Champion Belt, complete a biome for a Medal.</div>}
    <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Shiny gallery</div>
    {shinies.length ? <div className="grid grid-cols-3 gap-2">{shinies.map(c => { const g = dex[c.id]; const form = creatureForm(c, g.count);
      return <div key={c.id} className="pixel-box p-2 flex flex-col items-center text-center" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: 'var(--fat)' }}>
        <div className="h-14 flex items-center justify-center" style={crFx(true, form.aura)}><Sprite art={form.art} colors={crShiny(form.colors)} px={4} /></div>
        <div className="text-[9px] mt-1 truncate w-full">{form.name} <span style={{ color: 'var(--fat)' }}>✦</span></div>
      </div>; })}</div>
      : <div className="text-[10px] text-[#8A8A90]">No shinies yet. A perfect macro day has a chance to gleam gold.</div>}
  </div>;
}
/* ---- Auto-battle: your buddy (stats from your recent eating) vs a rival ladder + rotating weekly boss ---- */
const FIGHT_LADDER = [
  { name: 'Dinky', art: 'hatch', colors: crC('#7FD46B', '#3f8e2f'), power: 1, ability: 'none' },
  { name: 'Pebble', art: 'boulder', colors: crC('#9FB8C9', '#5f7d90'), power: 1, ability: 'none' },
  { name: 'Carbo', art: 'saur', colors: crC('#4A90E2', '#2f66b0'), power: 2, ability: 'dodge' },
  { name: 'Sprowl', art: 'sprout', colors: crC('#5FBF4A', '#2f7a24'), power: 2, ability: 'heal' },
  { name: 'Fatzilla', art: 'blob', colors: crC('#F5C518', '#c99a10'), power: 3, ability: 'rage' },
  { name: 'Protops', art: 'longneck', colors: crC('#E5556B', '#a83145'), power: 3, ability: 'dodge' },
  { name: 'Triceros', art: 'trike', colors: crC('#E0975B', '#a8642f'), power: 4, ability: 'heal' },
  { name: 'Platealon', art: 'stego', colors: crC('#2FB0A0', '#1e7a70'), power: 4, ability: 'rage' },
  { name: 'Veloci', art: 'raptor', colors: crC('#B06BE0', '#7a3fb0'), power: 5, ability: 'dodge' },
  { name: 'Rexosaur', art: 'rex', colors: crC('#6B5FC0', '#3a3170'), power: 6, ability: 'rage' },
];
const FIGHT_BOSSES = [
  { name: 'KING REX', art: 'rex', colors: crC('#E5342A', '#8e1e18'), power: 6, ability: 'rage' },
  { name: 'TITANOPS', art: 'longneck', colors: crC('#C0392B', '#7a2018'), power: 6, ability: 'heal' },
  { name: 'DREADPLATE', art: 'stego', colors: crC('#8E44AD', '#5b2c6f'), power: 6, ability: 'dodge' },
  { name: 'GRIMHORN', art: 'trike', colors: crC('#34506B', '#1f3243'), power: 7, ability: 'rage' },
];
const ABIL_LABEL = { none: '', dodge: 'Nimble, darts aside', heal: 'Regrows wounds', rage: 'Frenzies when hurt' };
function fightWeekKey() { const t = new Date(); const on = new Date(t.getFullYear(), 0, 1); const days = Math.floor((t - on) / 86400000); return t.getFullYear() + '-' + Math.floor((days + on.getDay()) / 7); }
function bossForWeek() { return FIGHT_BOSSES[crHash(fightWeekKey()) % FIGHT_BOSSES.length]; }
function buddyStageIndex(streak) { let si = 0; BUDDY_STAGES.forEach((x, i) => { if (streak >= x.min) si = i; }); return si; }
// Buddy fight stats grow from the last 7 days of eating: protein → attack, fibre → defence, consistency → HP.
function buddyStats(db, streak, siOverride) {
  const today = Store.todayISO(); let pro = 0, fib = 0, per = 0;
  for (let i = 0; i < 7; i++) { const q = dayQuality(db, shiftISO(today, -i)); if (q) { if (q.proteinHit) pro++; if (q.fiberHit) fib++; if (q.perfect) per++; } }
  const si = siOverride != null ? siOverride : buddyStageIndex(streak);
  return { hp: Math.min(220, 90 + streak * 2 + per * 5), atk: 10 + si * 2 + pro * 2 + per, def: 4 + fib * 2 + si, si, pro, fib, per, ability: 'none' };
}
function rivalStats(rival, rank, prestige) {
  const sc = 1 + (prestige || 0) * 0.4;
  return { hp: Math.round((80 + rank * 12) * sc), atk: Math.round((9 + rival.power * 3 + rank) * sc), def: Math.round((3 + rival.power * 2) * sc), ability: rival.ability || 'none' };
}
const FIGHT_HIT = ['{x} chomps down', '{x} swings its tail', '{x} rakes with its claws', '{x} headbutts hard', '{x} lets out a roar', '{x} snaps its jaws', '{x} gores with its horns', '{x} stomps in'];
// Macro types for the fight: label + colour + the macro that feeds them.
const TYPE_META = { power: ['Power', 'var(--pro)', 'protein'], guard: ['Guard', 'var(--fat)', 'fats'], swift: ['Swift', 'var(--carb)', 'carbs'], renew: ['Renew', 'var(--good)', 'fibre'], balanced: ['Balanced', 'var(--muted)', 'a balance'] };
function TypeChip({ t }) { const m = TYPE_META[t] || TYPE_META.balanced; return <span className="pf text-[7px] uppercase px-1 py-0.5 rounded" style={{ color: m[1], background: 'color-mix(in srgb, ' + m[1] + ' 16%, transparent)' }}>{m[0]}</span>; }

function FightModal({ db, update, streak, onClose }) {
  useBackClose(onClose);
  const fight = db.fight || { rank: 0, wins: 0, trophies: 0, lastBossWeek: null, prestige: 0 };
  const today = Store.todayISO();
  // Fighter fights at the buddy's high-water stage; a nap never shrinks it back to the egg.
  const si = Math.max(buddyStageIndex(streak), (db.buddy && db.buddy.stage) || 0);
  const b = BUDDY_STAGES[Math.min(si, BUDDY_STAGES.length - 1)];
  // Once hatched, the fighter wears the buddy's actual species + bond-evolved form (stats unchanged).
  const fSpecies = CR_BY_ID[(db.buddy && db.buddy.speciesId) || ''];
  const fForm = fSpecies ? buddyForm(fSpecies, (db.buddy && db.buddy.evoStage) || 0, 0) : null;
  const vis = (si > 0 && fForm) ? fForm : b;
  const fighter = { name: vis.name, art: vis.art, colors: vis.colors, stats: buddyStats(db, streak, si) };
  // Fight 2.0: macros are types. The buddy fights as its habitat; the week's eating is its loadout.
  const buddyType = Game.typeForBiome(fSpecies && fSpecies.biome);
  const loadout = Game.weeklyLoadout(fighter.stats.pro, fighter.stats.fib, fighter.stats.per);
  const weekKey = fightWeekKey();
  const weakness = Game.bossWeakness(weekKey);            // type/macro that turns the boss fight
  const weakMacro = Game.TYPE_MACRO[weakness];
  let weakDays = 0;
  for (let i = 0; i < 7; i++) { const q = dayQuality(db, shiftISO(today, -i)); if (q) { const hit = weakMacro === 'protein' ? q.proteinHit : weakMacro === 'fat' ? q.fatHit : weakMacro === 'carbs' ? q.carbHit : q.fiberHit; if (hit) weakDays++; } }
  const weaknessExploited = buddyType === weakness || weakDays >= 4;
  // Readiness buff: a well-rested, recovered morning makes the dino hit harder today; a rough night
  // gives a defensive, self-healing stance instead of a penalty. Rewards good sleep + recovery.
  const readiness = readinessFor(db, today);
  const readyBuff = readiness != null ? Game.readinessBuff(readiness) : { band: null, atk: 1, def: 1, heal: 0, label: null };
  const rivalMult = Game.typeMult(buddyType, Game.typeForName(FIGHT_LADDER[Math.min(fight.rank || 0, FIGHT_LADDER.length - 1)].name));
  // Ladder gating: one attempt per day, and only on a day with food logged. Weekly boss unchanged.
  const loggedToday = (db.log_entries || []).some(e => e.date === today);
  const gate = Game.fightGate(fight.lastAttemptDate, loggedToday, today);
  const ladderCleared = (fight.rank || 0) >= FIGHT_LADDER.length;
  const rivalBase = FIGHT_LADDER[Math.min(fight.rank || 0, FIGHT_LADDER.length - 1)];
  const rival = Object.assign({}, rivalBase, { type: Game.typeForName(rivalBase.name), stats: rivalStats(rivalBase, fight.rank || 0, fight.prestige || 0) });
  const weekBoss = bossForWeek();
  const boss = Object.assign({}, weekBoss, { type: Game.typeForName(weekBoss.name), stats: rivalStats(weekBoss, FIGHT_LADDER.length, fight.prestige || 0) });
  const bossReady = fight.lastBossWeek !== fightWeekKey();

  const [phase, setPhase] = useState(si === 0 ? 'egg' : 'select');
  const [opp, setOpp] = useState(null); const [isBoss, setIsBoss] = useState(false);
  const [hpA, setHpA] = useState(100); const [hpB, setHpB] = useState(100);
  const [maxA, setMaxA] = useState(100); const [maxB, setMaxB] = useState(100);
  const [log, setLog] = useState([]); const [winner, setWinner] = useState(null); const [drops, setDrops] = useState([]);
  const [lungeA, setLungeA] = useState(false); const [lungeB, setLungeB] = useState(false);
  const [pop, setPop] = useState(null); const [shake, setShake] = useState(false); const [intro, setIntro] = useState(false);
  const rewarded = useRef(false); const timers = useRef([]);
  const effRef = useRef(null);          // buddy's effective stats for the current fight (type/weakness applied)
  const [lastMult, setLastMult] = useState(1);
  const [stance, setStance] = useState('steady');   // pre-fight tactical choice
  const [useSpecial, setUseSpecial] = useState(false);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The fight opens like a monster battle: both fighters slide onto their platforms and a VS flashes,
  // then the auto-battle begins. `intro` holds the combat loop until the entrance finishes. The buddy's
  // attack is scaled by the type matchup (and the boss-weakness bonus when exploited) before the bout.
  function start(opponent, boss) {
    const mult = Game.fightAtkMult(buddyType, opponent.type, !!boss, weaknessExploited);
    const sm = Game.stanceMult(stance);
    const spec = (useSpecial && loadout.special > 0) ? Game.SPECIAL_ATK : 1;
    const eff = Object.assign({}, fighter.stats, {
      atk: Math.max(1, Math.round(fighter.stats.atk * mult * sm.atk * spec * readyBuff.atk)),
      def: Math.max(1, Math.round(fighter.stats.def * sm.def * readyBuff.def)),
      hp: Math.max(1, Math.round(fighter.stats.hp * (1 + (readyBuff.heal || 0)))), // a recovery day starts you tankier
    });
    effRef.current = eff; setLastMult(mult);
    setOpp(opponent); setIsBoss(!!boss); setMaxA(eff.hp); setMaxB(opponent.stats.hp); setHpA(eff.hp); setHpB(opponent.stats.hp); setLog([]); setWinner(null); setDrops([]); rewarded.current = false; setIntro(true); setPhase('fight'); const it = setTimeout(() => setIntro(false), 950); timers.current.push(it);
  }
  function prestige() { update(d => { d.fight = d.fight || {}; d.fight.rank = 0; d.fight.prestige = (d.fight.prestige || 0) + 1; }); setPhase('select'); }

  useEffect(() => {
    if (phase !== 'fight' || !opp || intro) return;
    const my = effRef.current || fighter.stats, rv = opp.stats;
    let a = my.hp, d2 = rv.hp, round = 0, alive = true;
    const rnd = (n) => Math.floor(Math.random() * n);
    const step = () => {
      if (!alive) return; round++;
      if (rv.ability === 'heal' && d2 > 0 && d2 < rv.hp * 0.7) { d2 = Math.min(rv.hp, d2 + Math.round(rv.hp * 0.06)); setHpB(d2); }
      const aAtk = Math.random() < my.atk / (my.atk + rv.atk);
      const atk = aAtk ? my : rv, def = aAtk ? rv : my;
      const defAbil = aAtk ? rv.ability : my.ability;
      if (defAbil === 'dodge' && Math.random() < 0.22) {
        setLog(l => [(aAtk ? opp.name : fighter.name) + ' darts aside!', ...l].slice(0, 5));
      } else {
        let dmg = Math.max(3, atk.atk - Math.round(def.def / 2) + rnd(7));
        const atkHp = aAtk ? a : d2, atkMax = aAtk ? my.hp : rv.hp;
        if (atk.ability === 'rage' && atkHp < atkMax * 0.35) dmg = Math.round(dmg * 1.5);
        const big = dmg >= 22;
        const hitTxt = big ? 'CRUNCH!' : (round % 3 === 0 ? 'CHOMP!' : round % 3 === 1 ? 'SMASH!' : 'THWACK!');
        if (big) { setShake(true); const shk = setTimeout(() => setShake(false), 320); timers.current.push(shk); }
        if (aAtk) { d2 = Math.max(0, d2 - dmg); setHpB(d2); setLungeA(true); const lt = setTimeout(() => setLungeA(false), 350); timers.current.push(lt); setPop({ side: 'r', text: hitTxt, num: dmg, big, id: round }); }
        else { a = Math.max(0, a - dmg); setHpA(a); setLungeB(true); const lt = setTimeout(() => setLungeB(false), 350); timers.current.push(lt); setPop({ side: 'l', text: hitTxt, num: dmg, big, id: round }); }
        const nm = aAtk ? fighter.name : opp.name;
        setLog(l => [FIGHT_HIT[rnd(FIGHT_HIT.length)].replace('{x}', nm) + (big ? '! Big one!' : '.'), ...l].slice(0, 5));
      }
      if (a <= 0 || d2 <= 0 || round >= 32) { alive = false; const win = d2 <= 0 ? true : a <= 0 ? false : (a / my.hp) >= (d2 / rv.hp); const et = setTimeout(() => { setWinner(win ? 'you' : 'them'); setPhase('done'); }, 750); timers.current.push(et); return; }
      const t = setTimeout(step, 760); timers.current.push(t);
    };
    const t0 = setTimeout(step, 300); timers.current.push(t0);
    return () => { alive = false; };
  }, [phase, opp, intro]);

  useEffect(() => {
    if (phase !== 'done' || winner == null || rewarded.current) return;
    rewarded.current = true;
    if (winner === 'you') {
      const got = [];
      update(d => {
        d.fight = d.fight || { rank: 0, wins: 0, trophies: 0, lastBossWeek: null, prestige: 0 };
        d.fight.wins = (d.fight.wins || 0) + 1; d.items = d.items || {}; d.game_awards = d.game_awards || {};
        const give = (id) => { d.items[id] = (d.items[id] || 0) + 1; got.push(id); };
        if (isBoss) { d.fight.trophies = (d.fight.trophies || 0) + 1; d.fight.lastBossWeek = fightWeekKey(); give('amber'); if (crHash(fightWeekKey() + 's') % 2 === 0) give('golden_steak'); }
        else if ((d.fight.rank || 0) < FIGHT_LADDER.length) {
          d.fight.rank = (d.fight.rank || 0) + 1;
          if (d.fight.rank % 3 === 0) give('lure');
          if (d.fight.rank >= FIGHT_LADDER.length && !d.game_awards['belt']) { d.game_awards['belt'] = true; give('belt'); }
        }
      });
      setDrops(got);
    }
  }, [phase, winner]);

  const HpBar = ({ hp, max, color, align }) => (
    <div className={align === 'r' ? 'text-right' : ''}>
      <div className="pixel-bar" style={{ height: 12, borderWidth: 2 }}><i style={{ width: Math.max(0, Math.min(100, hp / max * 100)) + '%', background: color, transition: 'width .3s' }} /></div>
    </div>
  );
  const Ring = () => (
    <div className={'pixel-box relative overflow-hidden mb-3' + (shake ? ' fshake' : '')} style={{ height: 188, background: 'linear-gradient(var(--surface3) 0%, var(--surface3) 61%, var(--surface2) 61%)' }}>
      {/* horizon line where sky meets ground */}
      <div className="absolute left-0 right-0" style={{ top: '61%', height: 3, background: 'var(--border)' }} />
      {/* opponent battle platform (far, upper right) */}
      <div className="absolute" style={{ top: 82, right: 16, width: 98, height: 15, background: 'var(--surface2)', border: '3px solid var(--border)', borderRadius: '50%' }} />
      {/* player battle platform (near, lower left) */}
      <div className="absolute" style={{ bottom: 11, left: 12, width: 118, height: 20, background: 'var(--surface3)', border: '3px solid var(--border)', borderRadius: '50%' }} />
      {/* opponent, smaller (further away), facing the player, feet resting on its platform */}
      <div className={'absolute ' + (intro ? 'fslideR' : (lungeB ? 'flungeLflip' : 'fbobFlip'))} style={{ top: 25, right: 34 }}><Sprite art={opp.art} colors={opp.colors} px={5.5} /></div>
      {/* player, larger (nearer) */}
      <div className={'absolute ' + (intro ? 'fslideL' : (lungeA ? 'flungeR' : 'fbob'))} style={{ bottom: 22, left: 26 }}><Sprite art={fighter.art} colors={fighter.colors} px={7} /></div>
      {/* VS flash on entry */}
      {intro && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="pf fvs" style={{ fontSize: 26, color: 'var(--fat)', WebkitTextStroke: '1px var(--border)' }}>VS</div></div>}
      {/* damage / hit pops */}
      {pop && <div key={pop.id} className="absolute text-center" style={{ top: 40, [pop.side === 'r' ? 'right' : 'left']: 34 }}>
        <div className="pf fpop" style={{ fontSize: pop.big ? 15 : 12, color: 'var(--fat)' }}>{pop.text}</div>
        {pop.num != null && <div className="pf fdmg tnum" style={{ fontSize: pop.big ? 16 : 12, color: 'var(--danger)' }}>-{pop.num}</div>}
      </div>}
    </div>
  );
  const StatLine = ({ s }) => <div className="text-[8px] text-[#8A8A90] tnum">HP {s.hp} · ATK {s.atk} · DEF {s.def}</div>;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">Dino fight</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>

        {phase === 'egg' && <div className="text-center py-6">
          <div className="flex justify-center mb-3"><Sprite art="egg" colors={crC('#EAD9A0', '#C77D3A')} px={7} /></div>
          <div className="text-sm font-bold mb-1">Your buddy is still an egg</div>
          <div className="text-[12px] text-[#8A8A90] mb-4">Log a day to hatch a fighter, then step into the pit.</div>
          <Btn kind="accent" className="w-full" onClick={onClose}>Got it</Btn>
        </div>}

        {phase === 'select' && <div className="fade-in">
          {/* progress eyebrow */}
          <div className="text-center pf text-[8px] uppercase text-[#8A8A90] mb-3 inline-flex items-center justify-center gap-1.5 w-full flex-wrap">
            {(fight.prestige || 0) > 0 && <span style={{ color: 'var(--fat)' }}>Prestige {fight.prestige} ·</span>}
            <span>{ladderCleared ? 'Ladder cleared' : `Rung ${(fight.rank || 0) + 1}/${FIGHT_LADDER.length}`} · {fight.wins || 0} wins · {fight.trophies || 0}</span>
            <PixelGlyph kind="trophy" color="var(--fat)" size={11} />
          </div>

          {/* VS matchup, with the type verdict beneath */}
          <div className="pixel-box p-3.5 mb-3.5" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>
            <div className="flex items-center gap-2">
              <div className="text-center flex-1 min-w-0">
                <div className="pixel-box p-2 inline-block" style={{ background: 'var(--surface3)' }}><div style={crFx(false, null, (db.buddy && (db.buddy.evoStage || 0) > 0) ? db.buddy.affinity : null)}><Sprite art={fighter.art} colors={fighter.colors} px={5} /></div></div>
                <div className="text-[11px] mt-2 font-bold truncate">{fighter.name}</div>
                <div className="my-1"><TypeChip t={buddyType} /></div>
                <StatLine s={fighter.stats} />
              </div>
              <div className="pf text-[13px] text-[#8A8A90] self-center shrink-0">VS</div>
              <div className="text-center flex-1 min-w-0">
                <div className="pixel-box p-2 inline-block" style={{ background: 'var(--surface3)' }}><span style={{ display: 'inline-block', transform: 'scaleX(-1)' }}><Sprite art={rival.art} colors={rival.colors} px={5} /></span></div>
                <div className="text-[11px] mt-2 font-bold truncate">{rival.name}</div>
                <div className="my-1"><TypeChip t={rival.type} /></div>
                <StatLine s={rival.stats} />
                {rival.ability !== 'none' && <div className="text-[8px] mt-0.5" style={{ color: 'var(--fat)' }}>{ABIL_LABEL[rival.ability]}</div>}
              </div>
            </div>
            {!ladderCleared && rivalMult !== 1 && <div className="text-[10px] text-center mt-3 pt-2.5" style={{ borderTop: '2px solid var(--border)', color: rivalMult > 1 ? 'var(--good)' : 'var(--danger)' }}>{rivalMult > 1 ? `${TYPE_META[buddyType][0]} is super-effective here, +25% attack` : `${rival.name} resists your type, −20% attack`}</div>}
          </div>

          {/* readiness buff: today's recovery turned into a battle edge */}
          {readyBuff.band && <div className="text-center mb-3.5 pixel-box p-2" style={{ background: 'var(--surface2)', boxShadow: 'none', border: '2px solid ' + (readyBuff.band === 'apex' ? 'var(--good)' : readyBuff.band === 'drowsy' ? 'var(--warn)' : 'var(--border)') }}>
            <span className="pf text-[8px] uppercase" style={{ color: readyBuff.band === 'apex' ? 'var(--good)' : readyBuff.band === 'drowsy' ? 'var(--warn)' : 'var(--text)' }}>Readiness {Game.READY_BAND[readyBuff.band].label}</span>
            <span className="text-[10px] ml-1.5" style={{ color: 'var(--text)' }}>{readyBuff.atk > 1 ? readyBuff.label + ', +' + Math.round((readyBuff.atk - 1) * 100) + '% attack' : readyBuff.atk < 1 ? readyBuff.label + ', +' + Math.round((readyBuff.def - 1) * 100) + '% defence & a heal' : 'steady, no change'}</span>
          </div>}

          {/* battle plan: your one tactical choice before the bout */}
          {(gate.can || bossReady) && <div className="pixel-box p-3.5 mb-3.5" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>
            <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Battle plan</div>
            <div className="flex gap-2">
              {[['press', 'Press', '+ATK'], ['steady', 'Steady', 'balanced'], ['dig', 'Dig in', '+DEF']].map(([k, label, hint]) => (
                <button key={k} onClick={() => setStance(k)} className="flex-1 pixel-btn py-2 px-1" style={{ background: stance === k ? 'var(--accent)' : 'var(--surface3)', color: stance === k ? 'var(--on-accent)' : 'var(--text)' }}>
                  <div className="pf text-[9px] leading-tight">{label}</div>
                  <div className="text-[7px] mt-0.5" style={{ opacity: 0.8 }}>{hint}</div>
                </button>
              ))}
            </div>
            {loadout.special > 0 && <button onClick={() => setUseSpecial(s => !s)} className="w-full pixel-btn py-2 mt-2" style={{ background: useSpecial ? 'var(--fat)' : 'var(--surface3)', color: useSpecial ? '#1a1400' : 'var(--text)' }}>
              <span className="pf text-[8px]">{useSpecial ? '✦ Special armed · +30% ATK' : 'Unleash perfect-day Special · +30% ATK'}</span>
            </button>}
          </div>}

          {/* primary action */}
          {ladderCleared
            ? <Btn kind="accent" className="w-full mb-3.5" onClick={prestige}>Prestige ↑, tougher ladder, better drops</Btn>
            : gate.can
              ? <Btn kind="accent" className="w-full mb-3.5" onClick={() => { update(d => { d.fight = d.fight || { rank: 0, wins: 0, trophies: 0, lastBossWeek: null, prestige: 0 }; d.fight.lastAttemptDate = today; }); start(rival, false); }}>Fight {rival.name} · 1 attempt today</Btn>
              : <div className="pixel-box p-3 mb-3.5 text-center text-[11px] text-[#8A8A90]" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>{gate.reason === 'used' ? 'Today’s attempt is used. A fresh one lands tomorrow.' : 'Log a meal today to earn your attempt, a fed buddy fights best.'}</div>}

          {/* how the week armed the fighter */}
          {(() => {
            const s = fighter.stats;
            const rows = [
              { label: 'Protein', n: s.pro, add: s.pro * 2, unit: 'ATK', color: 'var(--pro)' },
              { label: 'Fibre', n: s.fib, add: s.fib * 2, unit: 'DEF', color: 'var(--carb)' },
              { label: 'Perfect', n: s.per, add: s.per * 5, unit: 'HP', color: 'var(--good)' },
            ];
            return <div className="pixel-box p-3.5 mb-3" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>
              <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2.5 flex items-center justify-between"><span>This week armed you</span><span style={{ color: TYPE_META[buddyType][1] }}>fed by {TYPE_META[buddyType][2]}</span></div>
              <div className="space-y-2">
                {rows.map(r => <div key={r.label} className="flex items-center gap-2 text-[9px]">
                  <span className="w-16 shrink-0 text-[#8A8A90] tnum">{r.label} {r.n}/7</span>
                  <div className="pixel-bar flex-1" style={{ height: 10, borderWidth: 2 }}><i style={{ width: (r.n / 7 * 100) + '%', background: r.color, transition: 'width .4s' }} /></div>
                  <span className="w-12 shrink-0 text-right tnum" style={{ color: r.add > 0 ? 'var(--text)' : 'var(--muted)' }}>+{r.add} {r.unit}</span>
                </div>)}
              </div>
            </div>;
          })()}

          {/* weekly boss: weakness and challenge in one card */}
          {bossReady
            ? <div className="pixel-box p-3.5" style={{ background: 'var(--surface2)', boxShadow: 'none', border: '2px solid ' + (weaknessExploited ? 'var(--good)' : 'var(--border)') }}>
                <div className="flex items-center justify-between mb-2 gap-2"><span className="pf text-[8px] uppercase" style={{ color: 'var(--danger)' }}>Weekly boss · {boss.name}</span><span className="pf text-[7px] uppercase inline-flex items-center gap-1 text-[#8A8A90] shrink-0">weak <TypeChip t={weakness} /></span></div>
                <div className="text-[10px] leading-snug mb-3">{weaknessExploited
                  ? <span style={{ color: 'var(--good)' }}>Weakness exploited: your buddy strikes at +35% this week. Take it down!</span>
                  : <span className="text-[#8A8A90]">Raise a {TYPE_META[weakness][0]} buddy or eat {TYPE_META[weakness][2]}, {weakDays}/4 days hit this week for +35% attack.</span>}</div>
                <Btn kind="danger" className="w-full inline-flex items-center justify-center gap-2" onClick={() => start(boss, true)}><PixelGlyph kind="glove" color="currentColor" size={14} /> Challenge {boss.name}</Btn>
              </div>
            : <div className="text-[11px] text-[#8A8A90] text-center">Weekly boss beaten, a new challenger arrives next week.</div>}
        </div>}

        {(phase === 'fight' || phase === 'done') && opp && <div className="fade-in">
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div><div className="text-[9px] mb-1 font-bold truncate">{fighter.name}</div><HpBar hp={hpA} max={maxA} color="var(--good)" /></div>
            <div><div className="text-[9px] mb-1 font-bold text-right truncate">{opp.name}</div><HpBar hp={hpB} max={maxB} color="var(--danger)" align="r" /></div>
          </div>
          <Ring />
          <div className="pixel-box p-2 mb-3 text-[10px] text-[#8A8A90] leading-relaxed" style={{ background: 'var(--surface3)', minHeight: 56 }}>{log.map((l, i) => <div key={i} style={{ opacity: 1 - i * 0.16 }}>› {l}</div>)}</div>
          {phase === 'done' && <div className="text-center fade-in">
            <div className="pf text-2xl mb-1" style={{ color: winner === 'you' ? 'var(--good)' : 'var(--danger)' }}>{winner === 'you' ? 'VICTORY ROAR!' : 'DOWN AND OUT'}</div>
            <div className="text-[11px] text-[#8A8A90] mb-2">{winner === 'you' ? (isBoss ? 'Boss felled! Trophy earned.' : ladderCleared ? 'The apex predator holds the pit.' : 'You climb the food chain!') : 'Your buddy needs a good feed, come back tomorrow and go again.'}</div>
            {winner === 'you' && drops.length > 0 && <div className="text-[11px] mb-3" style={{ color: 'var(--good)' }}>Loot: {drops.map(id => ITEMS[id].name).join(', ')}</div>}
            <div className="flex gap-2"><Btn kind="ghost" className="flex-1" onClick={() => setPhase('select')}>Back</Btn><Btn kind="accent" className="flex-1" onClick={onClose}>Done</Btn></div>
          </div>}
        </div>}
      </div>
    </div>
  );
}
// Slim weight-trend teaser for the dashboard: latest weight + a sparkline, taps through to
// the Goal tab where the full trend, weigh-in log and burn estimate live.
function HomeWeightSpark({ db, onOpen }) {
  const unit = db.profile.weight_unit;
  const ws = db.weight_entries.slice(-21);
  const pts = ws.map(w => (w.trend_weight != null ? w.trend_weight : w.scale_weight)).filter(v => v != null);
  const last = db.weight_entries[db.weight_entries.length - 1];
  if (!last) return null;
  return (
    <button onClick={onOpen} className="w-full text-left bg-[#161618] pixel-box p-4 mb-4">
      <div className="flex justify-between items-center mb-2"><span className="pf text-[9px] uppercase text-[#8A8A90]">Weight trend</span><span className="pf text-[8px]" style={{ color: 'var(--accent)' }}>Progress ›</span></div>
      <div className="flex items-end gap-3">
        <div className="shrink-0 leading-none"><span className="text-2xl font-bold tnum">{fmtWeight(last.scale_weight, unit)}</span></div>
        <div className="flex-1 min-w-0"><MiniSpark points={pts} color="var(--weight)" /></div>
      </div>
    </button>
  );
}

// Move & rest: today's steps (vs your activity-band goal) and last night's sleep (score ring vs
// target) share one compact tile so the dashboard carries a single activity card. Both sync from
// Google Health; steps stay hand-loggable, sleep's one editable is the nightly target. Steps also feed
// the check-in's steps-first coaching. The morning-catch line and one sync status sit along the bottom.
// One dial in the Today status card: the headline number with room to breathe, over an ascending
// pixel "power-level" meter (a fighting-game gauge, not a played-out ring). Consistent across
// Move / Sleep / Ready so the three read as one glanceable row on mobile.
const DIAL_SEGMENTS = 7;
function StatDial({ label, fill, big, sub, color, subColor, active, onTap }) {
  const has = fill != null;
  const lit = has ? Math.round(Math.max(0, Math.min(100, fill)) / 100 * DIAL_SEGMENTS) : 0;
  return (
    <button type="button" onClick={onTap} className="flex-1 min-w-0 flex flex-col items-center text-center py-1.5 px-1"
      style={{ background: 'transparent', border: 0 }}>
      <div className="pf text-[8px] uppercase truncate w-full" style={{ color: active ? color : 'var(--muted)' }}>{label}</div>
      <div className="tnum font-bold leading-none mt-2 mb-2.5" style={{ fontSize: 25, color: has ? 'var(--text)' : 'var(--muted)' }}>{big}</div>
      <div className="flex gap-[3px] w-full justify-center items-end" style={{ height: 18 }} aria-hidden="true">
        {Array.from({ length: DIAL_SEGMENTS }).map((_, i) => (
          <div key={i} style={{
            flex: '0 0 auto', width: 6, height: Math.round((i + 1) / DIAL_SEGMENTS * 100) + '%',
            background: i < lit ? color : 'var(--surface3)',
            border: '1.5px solid ' + (i < lit ? color : 'var(--border)'),
            transition: 'background .35s, border-color .35s',
          }} />
        ))}
      </div>
      <div className="text-[9.5px] tnum truncate w-full mt-2 leading-tight" style={{ color: subColor || 'var(--muted)' }}>{sub}</div>
    </button>
  );
}

// Today status: Move / Sleep / Ready as three comparable dials, with the readiness -> Fight buff as the
// payoff strip. Steps + sleep-target edit inline; Google Health drives it, manual entry is the fallback.
function StepsSleepCard({ db, update, onOpenPlay }) {
  const today = Store.todayISO();
  const k = n => Math.round(n).toLocaleString('en-GB');
  const kShort = n => n >= 1000 ? (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : String(Math.round(n));
  // Steps: today vs the activity-band (or custom) goal.
  const steps = db.steps || {};
  const todaySteps = +steps[today] || 0;
  const stepGoal = stepGoalFor(db);
  const stepPct = stepGoal ? Math.min(100, Math.round((todaySteps / stepGoal) * 100)) : 0;
  const goalHit = stepGoal > 0 && todaySteps >= stepGoal;
  // Sleep: last synced night, scored live so a target edit moves the ring.
  const sleep = db.sleep || {};
  const sdates = Object.keys(sleep).filter(dt => ((sleep[dt] || {}).min > 0)).sort();
  const lastDate = sdates.length ? sdates[sdates.length - 1] : null;
  const rec = lastDate ? sleep[lastDate] : null;
  const targetMin = (db.profile && db.profile.sleepTargetMin) || Game.SLEEP_TARGET_DEFAULT;
  const stages = rec && (rec.deep != null || rec.rem != null || rec.light != null || rec.awake != null)
    ? { deep: rec.deep || 0, rem: rec.rem || 0, light: rec.light || 0, awake: rec.awake || 0 } : null;
  const score = rec ? Game.sleepScore(rec.min, targetMin, stages) : null; // null = stage-less night, show hours
  const hasScore = isFinite(score);
  const sHrs = rec ? Math.floor(rec.min / 60) : 0, sMins = rec ? rec.min % 60 : 0;
  const sHrsLabel = sHrs + 'h' + (sMins ? ' ' + sMins + 'm' : '');
  const targetH = targetMin / 60, targetHLabel = Number.isInteger(targetH) ? String(targetH) : targetH.toFixed(1);
  // Readiness: our recovery score + the band it grants. The Fight buff it powers now lives in the
  // Play hub's boss card, so this dial just shows the band and taps through to Play.
  const readiness = readinessFor(db, today);
  const rBand = Game.readinessBand(readiness);
  const rInfo = rBand ? Game.READY_BAND[rBand] : null;
  const R_COLOR = { apex: 'var(--good)', prowling: 'var(--accent)', drowsy: 'var(--warn)' };
  const rColor = rBand ? R_COLOR[rBand] : 'var(--muted)';
  // One editor at a time: null | 'steps' | 'sleep'.
  const [edit, setEdit] = useState(null);
  const [val, setVal] = useState('');
  function saveSteps() {
    const n = Math.max(0, Math.round(+val || 0));
    update(d => { d.steps = d.steps || {}; if (n > 0) d.steps[today] = n; else delete d.steps[today]; });
    setEdit(null);
  }
  function saveSleep() {
    const h = Math.max(0, +val || 0);
    update(d => { d.profile = d.profile || {}; if (h > 0) d.profile.sleepTargetMin = Math.round(h * 60); else delete d.profile.sleepTargetMin; });
    setEdit(null);
  }
  const synced = db.googleHealth && db.googleHealth.connected;
  return (
    <Card className="p-3 mb-4">
      <div className="flex items-center justify-between mb-0.5 px-1">
        <div className="pf text-[9px] uppercase" style={{ color: 'var(--muted)' }}>Today</div>
        {synced
          ? <span className="pf text-[7px] uppercase" style={{ color: 'var(--good)' }}>✓ Synced</span>
          : ghConfigured()
            ? <button onClick={ghConnect} className="pf text-[7px] uppercase" style={{ color: 'var(--accent)' }}>Connect Health ›</button>
            : <span className="pf text-[7px] uppercase" style={{ color: 'var(--muted)' }}>Health soon</span>}
      </div>

      {/* Three dials: Move / Sleep / Ready, all 0..100 so they read as one row */}
      <div className="flex items-stretch">
        <StatDial label="Move" fill={stepGoal > 0 ? stepPct : null} color="var(--good)"
          big={stepGoal > 0 ? (goalHit ? '✓' : stepPct) : '–'}
          sub={todaySteps ? kShort(todaySteps) + (stepGoal > 0 ? ' / ' + kShort(stepGoal) : '') : 'Tap to log'}
          onTap={() => { setVal(todaySteps || ''); setEdit(edit === 'steps' ? null : 'steps'); }} />
        <div style={{ width: 1, background: 'var(--border)' }} className="my-2" />
        <StatDial label="Sleep" fill={hasScore ? Math.min(100, score) : null} color="var(--accent)"
          big={rec ? (hasScore ? score : sHrsLabel) : '–'}
          sub={rec ? (hasScore ? sHrsLabel : 'Hours only · no stages') : 'No data'}
          onTap={() => { setVal(targetH || ''); setEdit(edit === 'sleep' ? null : 'sleep'); }} />
        <div style={{ width: 1, background: 'var(--border)' }} className="my-2" />
        <StatDial label="Ready" fill={readiness != null ? Math.min(100, readiness) : null} color={rColor}
          big={readiness != null ? readiness : '–'} active={!!rBand}
          sub={rInfo ? rInfo.label : (synced ? 'Pending' : 'No data')} subColor={rBand ? rColor : 'var(--muted)'}
          onTap={onOpenPlay} />
      </div>

      {/* Inline editor for whichever field is being changed */}
      {edit === 'steps' && (
        <div className="flex items-center gap-2 mt-2.5">
          <div className="flex-1"><NumInput value={val} onChange={e => setVal(e.target.value)} placeholder="Steps today, e.g. 8500" autoFocus /></div>
          <Btn kind="accent" className="text-sm" onClick={saveSteps}>Save</Btn>
          <button onClick={() => setEdit(null)} className="text-[#8A8A90] text-sm px-1">Cancel</button>
        </div>
      )}
      {edit === 'sleep' && (
        <div className="flex items-center gap-2 mt-2.5">
          <div className="flex-1"><NumInput value={val} onChange={e => setVal(e.target.value)} placeholder="Sleep target hours, e.g. 8" autoFocus /></div>
          <Btn kind="accent" className="text-sm" onClick={saveSleep}>Save</Btn>
          <button onClick={() => setEdit(null)} className="text-[#8A8A90] text-sm px-1">Cancel</button>
        </div>
      )}

    </Card>
  );
}

// Breakthrough meter: 7 stamps, one per logged day. Reused on the dashboard card and inside the
// Macrodex Active section so the two surfaces stay identical.
function BreakthroughMeter({ state, size = 10 }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: state.goal }).map((_, i) => (
        <div key={i} className="flex-1 pixel-box" style={{ height: size, boxShadow: 'none', borderWidth: 2, background: i < state.stamps ? 'var(--good)' : 'var(--surface3)', borderColor: i < state.stamps ? 'var(--good)' : 'var(--border)' }} />
      ))}
    </div>
  );
}

// Hatch-and-name: turn the generic buddy into an individual. Shown from the home strip; on an
// account with no name yet it reads as "hatching", afterwards as a rename.
function NameBuddyModal({ db, update, buddy, onClose }) {
  useBackClose(onClose);
  const b = db.buddy || {};
  const species = CR_BY_ID[b.speciesId] || CR_BY_ID['dinky'];
  const form = buddyForm(species, b.evoStage || 0, 0) || BUDDY_STAGES[Math.min(buddy.stage, BUDDY_STAGES.length - 1)];
  const pers = PERSONALITIES.find(p => p.key === b.personality) || PERSONALITIES[0];
  const [name, setName] = useState(b.name || '');
  function save() {
    const nm = name.trim().slice(0, 16); if (!nm) return;
    update(d => { d.buddy = d.buddy || { stage: 0 }; d.buddy.name = nm; });
    onClose();
  }
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-sm pixel-box p-5 sheet-up" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center mb-4">
          <div className="pixel-box p-2 mb-3" style={{ background: 'var(--surface3)' }}><div style={crFx(false, form.aura, (b.evoStage || 0) > 0 ? b.affinity : null)}><Sprite art={form.art} colors={form.colors} px={5} /></div></div>
          <div className="pf text-[8px] uppercase text-[#8A8A90]">{form.name}{(b.evoStage || 0) > 0 && b.affinity ? ' ' + AFFINITY_META[b.affinity][0] : ''} · {pers.label}</div>
          <div className="text-[11px] text-[#8A8A90] mt-1 leading-snug">{pers.blurb.charAt(0).toUpperCase() + pers.blurb.slice(1)}. Give it a name, it’s yours to raise.</div>
        </div>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={16} autoFocus placeholder="Name your buddy"
          className={inputCls + ' text-center'} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        <button onClick={save} disabled={!name.trim()} className="pixel-btn w-full py-3 mt-3" style={{ background: 'var(--accent)', color: 'var(--on-accent)', opacity: name.trim() ? 1 : 0.5 }}>
          <span className="pf text-[10px]">{b.name ? 'RENAME' : 'HATCH'}</span>
        </button>
      </div>
    </div>
  );
}

// One mini-card in a scrolling rail. `tag` is an optional corner label (e.g. "fits").
function RecipeMini({ r, onOpen, tag }) {
  const img = r.photo || r.thumbnail;
  return (<button onClick={onOpen} className="shrink-0 w-[150px] text-left active:opacity-90">
    <div className="pixel-box overflow-hidden" style={{ background: 'var(--card)' }}>
      <div className="relative w-full" style={{ aspectRatio: '16 / 10', background: 'var(--surface3)' }}>
        <RecipeImg src={img} iconSize={26} />
        {tag && <div className="absolute top-1.5 left-1.5 pf text-[7px] uppercase px-1.5 py-0.5 rounded" style={{ background: 'var(--good)', color: '#111' }}>{tag}</div>}
      </div>
      <div className="p-2">
        <div className="text-[12px] font-bold leading-tight" style={clamp2}>{r.title}</div>
        <div className="text-[10px] text-[#8A8A90] mt-1 tnum"><span className="font-bold" style={{ color: CAL }}>{Math.round(r.macros_per_serving.kcal)}</span> kcal · <span className="font-bold" style={{ color: PRO }}>{Math.round(r.macros_per_serving.protein)}g</span> P</div>
      </div>
    </div>
  </button>);
}
function RecipeRail({ title, meta, tag, items, onOpenRecipe }) {
  if (!items || !items.length) return null;
  return (<div className="mb-4">
    <div className="flex items-baseline justify-between flex-wrap gap-x-3 mb-2">
      <div className="text-lg font-bold">{title}</div>
      {meta && <div className="text-[11px] text-[#8A8A90] tnum whitespace-nowrap">{meta}</div>}
    </div>
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {items.map(r => <RecipeMini key={r.id} r={r} tag={tag} onOpen={() => onOpenRecipe(r.id)} />)}
    </div>
  </div>);
}
// Turn the library into a few purposeful, labelled rails instead of one random-feeling strip. The
// tracker's edge is the top rail: recipes that fit what's LEFT of today's macros, protein-ranked.
// The rest are time-of-day aware and use the auto-tags. Recipes are deduped across rails so each is
// a fresh reason to tap. Rails need >=2 cards to earn their caption; empty facets simply don't show.
function buildRecipeRails(db) {
  const today = Store.todayISO();
  const et = effectiveTarget(db, today);
  const priced = (db.recipes || []).filter(r => r.macros_per_serving && r.macros_per_serving.kcal > 0);
  if (priced.length < 2) return [];
  const used = new Set();
  const take = (arr, n) => { const out = []; for (const r of arr) { if (used.has(r.id)) continue; out.push(r); used.add(r.id); if (out.length >= (n || 8)) break; } return out; };
  const density = r => { const m = r.macros_per_serving; return m.kcal > 0 ? m.protein * 4 / m.kcal : 0; };
  const rails = [];
  if (et) {
    const tot = sumMacros(entriesOn(db, today));
    const rem = { kcal: et.eff.kcal - tot.kcal, protein: et.eff.protein_g - tot.protein, carbs: et.eff.carbs_g - tot.carbs, fat: et.eff.fat_g - tot.fat };
    if (rem.kcal >= 150) {
      const fits = priced.map(r => ({ r, fit: Rcp.fitScore(r.macros_per_serving, rem) })).filter(x => x.fit.fitsKcal)
        .sort((a, b) => (b.fit.proteinPer100kcal - a.fit.proteinPer100kcal) || (b.r.macros_per_serving.kcal - a.r.macros_per_serving.kcal)).map(x => x.r);
      const items = take(fits, 8);
      if (items.length >= 2) rails.push({ key: 'fits', title: 'Cook for your gap', tag: 'fits', meta: Math.max(0, Math.round(rem.kcal)) + ' kcal · ' + Math.max(0, Math.round(rem.protein)) + 'g protein left', items });
    }
  }
  const hr = new Date().getHours();
  if (hr < 11) { const items = take(priced.filter(r => (r.tags || {}).meal === 'breakfast'), 8); if (items.length >= 2) rails.push({ key: 'breakfast', title: 'Breakfast ideas', items }); }
  else if (hr >= 16) { const items = take(priced.filter(r => (r.tags || {}).effort === 'quick' && ((r.tags || {}).meal === 'dinner' || !(r.tags || {}).meal)), 8); if (items.length >= 2) rails.push({ key: 'quick', title: 'Quick tonight', items }); }
  const hp = take(priced.filter(r => density(r) >= 0.4).sort((a, b) => density(b) - density(a)), 8);
  if (hp.length >= 2) rails.push({ key: 'protein', title: 'High protein', items: hp });
  const counts = {}; priced.forEach(r => { const c = (r.tags || {}).cuisine; if (c && c !== 'other') counts[c] = (counts[c] || 0) + 1; });
  const topC = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).find(c => counts[c] >= 2);
  if (topC) { const items = take(priced.filter(r => (r.tags || {}).cuisine === topC), 8); if (items.length >= 2) rails.push({ key: 'cuisine', title: 'More ' + Rcp.taxLabel(topC), items }); }
  if (!rails.length) { const items = take(priced.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)), 8); if (items.length) rails.push({ key: 'recent', title: 'Your recipes', items }); }
  return rails;
}
function RecipeRails({ db, onOpenRecipe, limit }) {
  const rails = buildRecipeRails(db).slice(0, limit || 4);
  if (!rails.length) return null;
  return <>{rails.map(rl => <RecipeRail key={rl.key} title={rl.title} meta={rl.meta} tag={rl.tag} items={rl.items} onOpenRecipe={onOpenRecipe} />)}</>;
}
// Dashboard keeps it tight: the top two rails only (fits-your-gap + one more).
function CookGapStrip({ db, onOpenRecipe }) { return <RecipeRails db={db} onOpenRecipe={onOpenRecipe} limit={2} />; }
// Dashboard strip: batch-cooked meals with servings still going spare, so leftovers get used (and
// logged) before you cook something new. Taps through to the recipe to log a serving.
function LeftoversStrip({ db, onOpenRecipe }) {
  const left = (db.recipes || []).filter(r => Rcp.batchLeft(r) > 0);
  if (!left.length) return null;
  return (<div className="mb-4">
    <div className="text-lg font-bold mb-2">Leftovers to use up</div>
    <div className="space-y-2">
      {left.map(r => (
        <button key={r.id} onClick={() => onOpenRecipe(r.id)} className="w-full flex items-center gap-3 pixel-box px-3 py-2.5 text-left" style={{ background: 'var(--card)' }}>
          <span className="pf text-[8px] uppercase px-1.5 py-1 rounded shrink-0" style={{ background: 'var(--good)', color: '#111' }}>{Rcp.batchLeft(r)} left</span>
          <span className="flex-1 min-w-0 text-[14px] truncate">{r.title}</span>
          {r.macros_per_serving && r.macros_per_serving.kcal > 0 && <span className="text-[11px] text-[#8A8A90] tnum shrink-0">{Math.round(r.macros_per_serving.kcal)} kcal</span>}
          <Icon.chevron width="15" height="15" style={{ color: 'var(--muted)' }} />
        </button>))}
    </div>
  </div>);
}
// Free-tier upsell card: contextual, trial-forward, and dismissable (re-shows after 7 days so it
// nudges without nagging). One per surface only, to stay on the honest-coaching side of the line.
// Opens the existing paywall via the global MPAYWALL, so it works from any screen without prop-drilling.
function PremiumNudge({ db, update, headline, blurb, reason, trackKey, className = '' }) {
  const dm = (db.profile && db.profile.nudgesDismissed) || {};
  const until = dm[trackKey];
  if (until && (Date.now() - until) < 7 * 864e5) return null;
  const open = () => {
    try { window.MPAYWALL && window.MPAYWALL({ type: reason || 'manual' }); } catch (_) {}
    try { window.MTRACK && window.MTRACK('paywall_view', { reason: trackKey }); } catch (_) {}
  };
  const dismiss = (e) => {
    e.stopPropagation();
    update(d => { d.profile = d.profile || {}; d.profile.nudgesDismissed = Object.assign({}, d.profile.nudgesDismissed || {}, { [trackKey]: Date.now() }); });
  };
  return (
    <div onClick={open} className={'pixel-box p-3.5 relative cursor-pointer active:opacity-90 ' + className} style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent)' }}>
      <div className="pf text-[8px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--accent)' }}>Macrosaurus Premium</div>
      <div className="text-sm font-bold mb-1 pr-6">{headline}</div>
      <div className="text-[11px] text-[#8A8A90] leading-snug mb-2.5">{blurb}</div>
      <div className="pf text-[8px] uppercase" style={{ color: 'var(--accent)' }}>Try Premium free ›</div>
      <button onClick={dismiss} className="hit absolute top-1.5 right-1.5 text-[#8A8A90] text-base leading-none px-1.5 py-0.5" aria-label="Not now">×</button>
    </div>
  );
}
function Dashboard({ db, update, onCheckIn, onReview, setView, onQuickAdd, showToast, onOpenRecipe, onOpenPlay, isPremium, aiCalls }) {
  const [mode, setMode] = useState('remaining'); // Consumed/Remaining lens, shared with the Food log card
  const [span, setSpan] = useState('today');
  const [showStats, setShowStats] = useState(false);
  const [showCarry, setShowCarry] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const today = Store.todayISO();
  const et = effectiveTarget(db, today); if (!et) return null;
  const todayTot = sumMacros(entriesOn(db, today));
  const last30 = Array.from({ length: 30 }, (_, i) => shiftISO(today, -(29 - i)));
  const weighSet = new Set(db.weight_entries.map(w => w.date));
  const logSet = new Set(db.log_entries.map(e => e.date));
  const weighDays = last30.map(d => weighSet.has(d)); const logDays = last30.map(d => logSet.has(d));
  const last7 = Array.from({ length: 7 }, (_, i) => shiftISO(today, -(6 - i)));
  const weighWk = last7.filter(d => weighSet.has(d)).length; const logWk = last7.filter(d => logSet.has(d)).length;
  const t = currentTargets(db);
  const unit = db.profile.weight_unit;
  // 7-day average of daily intake (over logged days only)
  const loggedDates = Array.from(logSet).filter(x => x <= today).sort().slice(-7);
  const avgTot = loggedDates.length ? (() => { const n = loggedDates.length; const a = loggedDates.map(dd => sumMacros(entriesOn(db, dd))).reduce((x, s) => ({ kcal: x.kcal + s.kcal, protein: x.protein + s.protein, carbs: x.carbs + s.carbs, fat: x.fat + s.fat, fiber: x.fiber + s.fiber }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }); return { kcal: a.kcal / n, protein: a.protein / n, carbs: a.carbs / n, fat: a.fat / n, fiber: a.fiber / n }; })() : todayTot;
  const tot = span === 'avg' ? avgTot : todayTot;
  // Balance: shift today's leftover calories between carbs and fat (protein fixed). Editable right
  // here on Today now, so the Food log no longer needs to repeat the whole macro card.
  const override = (db.day_overrides || {})[today] || { shiftKcal: 0 };
  const setShift = (v) => update(d => { d.day_overrides = Object.assign({}, d.day_overrides || {}, { [today]: { shiftKcal: v } }); });
  const remCarbs = Math.max(0, Math.round(et.eff.carbs_g - todayTot.carbs));
  const remFat = Math.max(0, Math.round(et.eff.fat_g - todayTot.fat));
  // streak: consecutive ACTIVE days (food logged OR weighed in) ending today, with a
  // monthly freeze forgiving one miss.
  const frozenSet = new Set((db.freezes && db.freezes.frozen) || []);
  const activeSet = new Set([...logSet, ...weighSet]);
  const streakInfo = computeStreak(activeSet, frozenSet, today);
  const streak = streakInfo.streak;
  const freezeAvail = freezeReady(frozenSet, today);
  const newFrozenKey = streakInfo.newFrozen.join(',');
  useEffect(() => {
    if (!newFrozenKey) return;
    update(d => { d.freezes = d.freezes || { frozen: [] }; const s = new Set(d.freezes.frozen); newFrozenKey.split(',').forEach(x => s.add(x)); d.freezes.frozen = Array.from(s).sort().slice(-120); });
  }, [newFrozenKey]);
  // Per-user catch seeding: mint a stable random salt once, so daily rolls differ between users.
  useEffect(() => {
    if (db.game_salt) return;
    const salt = Game.makeSalt();
    update(d => { if (!d.game_salt) d.game_salt = salt; });
  }, [db.game_salt]);
  // Buddy is a HIGH-WATER mark: the stage never falls back to the egg. After a break it
  // naps at its best-ever stage and wakes after 3 active days. Also track the longest streak.
  const buddyHw = (db.buddy && db.buddy.stage) || 0;
  const buddy = Game.buddyView(buddyHw, streak);
  const buddyLvl = useMemo(() => buddyLevel(db), [db.log_entries]);
  const bp = buddyProfile(db, streak, buddy, buddyLvl);
  useEffect(() => {
    const longest = (db.records && db.records.longestStreak) || 0;
    if (!buddy.ratchet && streak <= longest) return;
    update(d => {
      d.buddy = d.buddy || { stage: 0 };
      if (buddy.stage > (d.buddy.stage || 0)) d.buddy.stage = buddy.stage;
      d.records = d.records || { longestStreak: 0 };
      if (streak > (d.records.longestStreak || 0)) d.records.longestStreak = streak;
    });
  }, [streak]);
  // Seed the buddy's identity once: hatch date, personality, and the species it's raised from.
  // Additive and idempotent, so returning accounts get an individual without losing anything.
  useEffect(() => {
    const b = db.buddy || {};
    if (b.hatchedISO && b.personality && b.speciesId) return;
    const dates = (db.log_entries || []).map(e => e.date).sort();
    const firstLog = dates[0] || today;
    const spec = buddySpeciesId(db);
    update(d => {
      d.buddy = d.buddy || { stage: 0 };
      if (!d.buddy.hatchedISO) d.buddy.hatchedISO = firstLog;
      if (!d.buddy.personality) d.buddy.personality = personalityFor(d.game_salt || firstLog || 'egg').key;
      if (!d.buddy.speciesId) d.buddy.speciesId = spec;
      if (d.buddy.evoStage == null) d.buddy.evoStage = 0;
    });
  }, [db.buddy, db.log_entries]);
  // Bond-gated evolution (Gen 2 friendship): advance the buddy's form when it has BOTH grown
  // (quality-day level) AND is well cared for (bond hearts). High-water, so a cooled bond never
  // de-evolves it.
  useEffect(() => {
    const b = db.buddy || {};
    const species = CR_BY_ID[b.speciesId]; if (!species || !species.evo || !species.evo.length) return;
    const eligible = Game.buddyEvoStage(buddyLvl, bp.bond.hearts, species.evo.map(e => e.at), EVO_HEART_REQ);
    if (eligible > (b.evoStage || 0)) {
      // Day/night path (Espeon/Umbreon): set once, by the clock at the first evolution.
      const aff = Game.dayNightAffinity(new Date().getHours());
      update(d => { d.buddy = d.buddy || { stage: 0 }; d.buddy.evoStage = eligible; if (!d.buddy.affinity) d.buddy.affinity = aff; });
    }
  }, [buddyLvl, bp.bond.hearts, db.buddy && db.buddy.speciesId]);
  // Migratory visitor: 20 logged days inside the calendar month lands Drizzlodon (once per month).
  const monthYm = today.slice(0, 7);
  const monthLogs = Game.monthlyLogCount(Array.from(logSet), monthYm);
  useEffect(() => {
    if (monthLogs < 20 || (db.game_awards || {})['migratory:' + monthYm]) return;
    update(d => {
      d.game_awards = d.game_awards || {};
      if (d.game_awards['migratory:' + monthYm]) return;
      d.game_awards['migratory:' + monthYm] = true;
      d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || [];
      arr.push({ id: 'drizzlodon', shiny: false, migratory: monthYm });
      d.catch_log[today] = arr;
    });
    if (showToast) showToast('A migratory Drizzlodon lands in your dex! 20 days logged this month.');
  }, [monthLogs]);
  // Monthly Expedition: a featured creature caught by reaching a quality-day goal this month.
  const monthQualityDays = Array.from(logSet).filter(d => d.slice(0, 7) === monthYm && isQualityDay(db, d)).length;
  const expeditionId = Game.monthlyFeatured(monthYm);
  const expedition = Game.expeditionState(monthQualityDays);
  useEffect(() => {
    if (!expedition.ready || (db.game_awards || {})['expedition:' + monthYm]) return;
    const shiny = Game.seedFor(db.game_salt || '', 'exp#' + monthYm) % 5 === 0;
    update(d => {
      d.game_awards = d.game_awards || {};
      if (d.game_awards['expedition:' + monthYm]) return;
      d.game_awards['expedition:' + monthYm] = true;
      d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || [];
      arr.push({ id: expeditionId, shiny: shiny, expedition: monthYm });
      d.catch_log[today] = arr;
    });
    if (showToast) showToast('Monthly Expedition complete! ' + ((CR_BY_ID[expeditionId] || {}).name || 'A rare creature') + ' joins your dex.');
  }, [expedition.ready, monthYm]);
  // Weekly Breakthrough: every 7 logged days earns a guaranteed rare+ catch plus an Incubator
  // (a Pokemon GO style Research Breakthrough). A per-user baseline is set the first time this
  // runs so existing history never awards a backlog of rewards at once.
  const loggedTotal = logSet.size;
  const bt = db.breakthrough;
  const btState = Game.breakthroughState(loggedTotal, bt ? bt.base : loggedTotal);
  useEffect(() => {
    if (!bt) { update(d => { if (!d.breakthrough) d.breakthrough = { base: loggedTotal, claimed: 0, lastDate: null, lastId: null, lastShiny: false }; }); return; }
    const target = bt.claimed + 1;
    if (btState.breakthroughs < target) return; // not enough logged days for the next one yet
    const c = Game.breakthroughCatch(db.game_salt || '', target);
    update(d => {
      if (!d.breakthrough || d.breakthrough.claimed >= target) return; // guard against a double-award
      d.breakthrough.claimed = target;
      d.breakthrough.lastDate = today; d.breakthrough.lastId = c.id; d.breakthrough.lastShiny = !!c.shiny;
      d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || [];
      if (!arr.some(x => x.breakthrough === target)) arr.push({ id: c.id, shiny: !!c.shiny, breakthrough: target });
      d.catch_log[today] = arr;
      d.items = d.items || {}; d.items.incubator = (d.items.incubator || 0) + 1;
    });
    const cr = CR_BY_ID[c.id];
    if (showToast && cr) showToast('Weekly Breakthrough! A ' + (c.shiny ? 'shiny ' : '') + cr.name + ' joins your dex, plus an Incubator.');
  }, [btState.breakthroughs, bt ? bt.claimed : -1]);
  // Egg incubation: one egg always incubates, its distance is quality days since it appeared.
  // When it fills it hatches (a tier-scaled catch) and the next egg appears automatically.
  const eggs = db.eggs;
  const egg = eggs && eggs.cur ? eggs.cur : null;
  const eggElapsed = egg ? incubationDaysAfter(db, egg.startDate, today) : 0;
  const eggProg = egg ? Game.eggProgress(eggElapsed, egg.tier) : null;
  useEffect(() => {
    const salt = db.game_salt || '';
    if (!egg) { update(d => { if (d.eggs && d.eggs.cur) return; const n = (d.eggs && d.eggs.hatched) || 0; d.eggs = Object.assign({ hatched: 0 }, d.eggs, { cur: { startDate: today, tier: Game.nextEggTier(salt, n), seed: n } }); }); return; }
    if (!eggProg || !eggProg.ready) return;
    const n = eggs.hatched || 0;
    const c = Game.eggHatch(salt, egg.tier, n);
    update(d => {
      if (!d.eggs || !d.eggs.cur || d.eggs.cur.startDate !== egg.startDate) return; // already hatched elsewhere
      const hn = (d.eggs.hatched || 0) + 1;
      d.eggs.hatched = hn; d.eggs.lastId = c.id; d.eggs.lastShiny = !!c.shiny; d.eggs.lastTier = c.tier; d.eggs.lastDate = today;
      d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || [];
      if (!arr.some(x => x.egg === egg.startDate)) arr.push({ id: c.id, shiny: !!c.shiny, egg: egg.startDate });
      d.catch_log[today] = arr;
      d.eggs.cur = { startDate: today, tier: Game.nextEggTier(salt, hn), seed: hn };
    });
    const cr = CR_BY_ID[c.id];
    if (showToast && cr) showToast('Your ' + egg.tier + '-day egg hatched! A ' + (c.shiny ? 'shiny ' : '') + cr.name + ' joins your dex.');
  }, [!!egg, eggProg ? eggProg.steps : -1, eggProg ? eggProg.ready : false]);
  // Sleep morning catch (a Pokemon Sleep style encounter): last night's sleep score powers a single
  // catch whose rarity climbs with how well you slept, and it carries a "sleep style" for the style
  // dex. Only the newest night awards; any older un-awarded nights are silently baselined so a first
  // sync (or a few missed days) never dumps a backlog of catches.
  const sleepDates = Object.keys(db.sleep || {}).filter(dt => ((db.sleep[dt] || {}).min > 0)).sort();
  const latestSleep = sleepDates.length ? sleepDates[sleepDates.length - 1] : null;
  const sleepClaimed = (db.sleepDex && db.sleepDex.claimed) || {};
  const sleepPending = latestSleep && !sleepClaimed[latestSleep] ? latestSleep : null;
  useEffect(() => {
    if (!db || !latestSleep) return;
    const claimed = (db.sleepDex && db.sleepDex.claimed) || {};
    const older = sleepDates.slice(0, -1).filter(dt => !claimed[dt]);
    const need = !claimed[latestSleep];
    if (!older.length && !need) return;
    const rec = db.sleep[latestSleep] || {};
    const stages = (rec.deep != null || rec.rem != null || rec.light != null || rec.awake != null)
      ? { deep: rec.deep || 0, rem: rec.rem || 0, light: rec.light || 0, awake: rec.awake || 0 } : null;
    // A stage-less night has no quality score (we show hours, not a number), but the morning catch should
    // still happen and stay fair: tier it by duration alone rather than dumping every such night in 'poor'.
    const catchTarget = (db.profile && db.profile.sleepTargetMin) || Game.SLEEP_TARGET_DEFAULT;
    const catchScore = isFinite(rec.score) ? rec.score : Math.round(Math.min((rec.min || 0) / catchTarget, 1) * 100);
    const band = Game.sleepBand(catchScore);
    const c = Game.sleepCatch(db.game_salt || '', latestSleep, band);
    const style = Game.sleepStyleFor(catchScore, stages);
    update(d => {
      d.sleepDex = d.sleepDex || { claimed: {} };
      d.sleepDex.claimed = d.sleepDex.claimed || {};
      older.forEach(dt => { d.sleepDex.claimed[dt] = true; });
      if (need && !d.sleepDex.claimed[latestSleep]) {
        d.sleepDex.claimed[latestSleep] = true;
        d.sleepDex.lastDate = latestSleep; d.sleepDex.lastId = c.id; d.sleepDex.lastShiny = !!c.shiny; d.sleepDex.lastStyle = style;
        d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || [];
        if (!arr.some(x => x.sleep === latestSleep)) arr.push({ id: c.id, shiny: !!c.shiny, sleep: latestSleep, style: style });
        d.catch_log[today] = arr;
      }
    });
    if (need && showToast) { const cr = CR_BY_ID[c.id]; if (cr) showToast('You slept well. A ' + style + ' ' + (c.shiny ? 'shiny ' : '') + cr.name + ' joins your dex.'); }
  }, [latestSleep, sleepPending]);
  // Primed morning catch (Phase C, reward for recovery): an Apex-readiness morning draws a bonus, rarer
  // creature into your dex, once a day, distinct from the sleep-style catch. db-null-safe + deduped.
  const todayReadyBand = Game.readinessBand(readinessFor(db, today));
  const primedPending = todayReadyBand === 'apex' && !((db.primed && db.primed.claimed) || {})[today] ? today : null;
  useEffect(() => {
    if (!db || todayReadyBand !== 'apex') return;
    if (db.primed && db.primed.claimed && db.primed.claimed[today]) return;
    const c = Game.primedCatch(db.game_salt || '', today);
    update(d => {
      d.primed = d.primed || { claimed: {} };
      d.primed.claimed = d.primed.claimed || {};
      if (d.primed.claimed[today]) return;
      d.primed.claimed[today] = true;
      d.primed.lastDate = today; d.primed.lastId = c.id; d.primed.lastShiny = !!c.shiny;
      d.catch_log = d.catch_log || {}; const arr = d.catch_log[today] || [];
      if (!arr.some(x => x.primed === today)) arr.push({ id: c.id, shiny: !!c.shiny, primed: today });
      d.catch_log[today] = arr;
    });
    if (showToast) { const cr = CR_BY_ID[c.id]; if (cr) showToast('Primed and recovered! A ' + (c.shiny ? 'shiny ' : '') + cr.name + ' joins your dex.'); }
  }, [primedPending]);
  // Persist Macrodex catches so a creature you've seen stays caught even if you later edit that day's food.
  // Past days lock the first time they're recorded; today accumulates any newly-seen creature as macros change.
  const todayCr = creatureForDay(db, today);
  const catchSig = Array.from(logSet).sort().join(',') + '|' + (todayCr ? todayCr.id + (todayCr.shiny ? 's' : '') : '');
  useEffect(() => {
    const cl = db.catch_log || {};
    const adds = [];
    Array.from(logSet).forEach(d => {
      const c = creatureForDay(db, d); if (!c) return;
      const arr = cl[d] || [];
      const isToday = d === today;
      if (arr.length === 0 || (isToday && !arr.some(x => x.id === c.id))) adds.push([d, c]);
      else if (isToday && c.shiny && arr.some(x => x.id === c.id && !x.shiny)) adds.push([d, c]); // a perfect finish turns today's catch shiny
    });
    if (adds.length) update(dd => {
      dd.catch_log = dd.catch_log || {};
      adds.forEach(([d, c]) => { const arr = dd.catch_log[d] || []; const ex = arr.find(x => x.id === c.id); if (ex) { if (c.shiny) ex.shiny = true; } else arr.push({ id: c.id, shiny: !!c.shiny }); dd.catch_log[d] = arr; });
    });
  }, [catchSig]);
  // One-time item / milestone rewards: streak tiers, a perfect week, and completing a Macrodex biome.
  useEffect(() => {
    const aw = db.game_awards || {};
    const pending = [];
    const g = (key, id) => { if (!aw[key]) pending.push([key, id]); };
    if (streak >= 7) g('streak7', 'lure');
    if (streak >= 14) g('streak14', 'golden_steak');
    if (streak >= 30) g('streak30', 'incubator');
    if (perfectDaysIn(db, today, 7) >= 5) g('perfweek:' + fightWeekKey(), 'golden_steak');
    const dex = macrodex(db);
    BIOMES.forEach(bm => { const list = CREATURES.filter(c => c.biome === bm.id); if (list.length && list.every(c => dex[c.id])) g('biome:' + bm.id, 'medal'); });
    if (!pending.length) return;
    update(d => { d.game_awards = d.game_awards || {}; d.items = d.items || {}; pending.forEach(([k, id]) => { if (!d.game_awards[k]) { d.game_awards[k] = true; d.items[id] = (d.items[id] || 0) + 1; } }); });
  }, [streak, catchSig]);
  const remindOn = db.profile.reminders !== false;
  const missWeigh = !weighSet.has(today), missLog = !logSet.has(today);
  const nudgeHour = db.profile.nudgeHour == null ? 14 : db.profile.nudgeHour;
  const showNudge = remindOn && (missLog || missWeigh) && !db.paused && new Date().getHours() >= nudgeHour && !nudgeDismissed;
  const quote = DINO_QUOTES[new Date(today + 'T00:00:00').getDate() % DINO_QUOTES.length];
  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pb-28 lg:pb-16 pt-6 fade-in">
      <PageHeader kicker={prettyDate(today)} title="Today" />
      <OnboardingChecklist db={db} update={update} onLog={() => onQuickAdd(false)} onOpenDex={onOpenPlay} />
      <InstallCard />

      {/* flex-wrap: on narrow phones the pixel font is wide, so the pill drops below rather than colliding */}
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1.5 mb-3">
        <div className="text-lg font-bold">Today's macros</div>
        <Pill value={span} onChange={setSpan} options={[{ v: 'today', l: 'Today' }, { v: 'avg', l: '7d avg' }]} />
      </div>
      <Card className="p-5 mb-4">
        <div className="flex justify-center -mt-1 mb-3"><Pill value={mode} onChange={setMode} options={[{ v: 'consumed', l: 'Consumed' }, { v: 'remaining', l: 'Remaining' }, { v: 'balance', l: 'Balance' }]} /></div>
        {mode === 'balance' ? (
          <div className="fade-in">
            <div className="text-[12px] text-[#8A8A90] mb-3">Shift today's leftover calories between carbs and fat. Protein stays fixed.</div>
            <div className="flex justify-between text-[11px] text-[#8A8A90] mb-1"><span>More carbs</span><span>More fat</span></div>
            <input type="range" min="-400" max="400" step="10" value={override.shiftKcal} onChange={e => setShift(+e.target.value)} className="w-full accent-[#4A9EEB]" />
            <div className="flex justify-between items-center mt-3">
              <div className="leading-tight"><div className="text-[16px] font-bold tnum" style={{ color: CARB }}>{remCarbs}g</div><div className="pf text-[7px] uppercase text-[#8A8A90]">carbs left</div></div>
              {override.shiftKcal ? <button onClick={() => setShift(0)} className="pf text-[8px] uppercase" style={{ color: 'var(--accent)' }}>Reset</button> : <span className="pf text-[8px] uppercase text-[#8A8A90]">Balanced</span>}
              <div className="text-right leading-tight"><div className="text-[16px] font-bold tnum" style={{ color: FAT }}>{remFat}g</div><div className="pf text-[7px] uppercase text-[#8A8A90]">fat left</div></div>
            </div>
          </div>
        ) : (<>
          <MacroSummaryCard et={et} tot={tot} mode={mode} avg={span === 'avg'} />
          {/* Footers share one grid: muted label on the left, an accent tap-through on the right. */}
          {(et.cyc !== 0 || et.carry !== 0) && (() => {
            const adj = et.eff.kcal - et.base.kcal;
            const cd = et.carryDetail;
            const canOpen = !!(cd && cd.days && cd.days.length) || et.cyc !== 0;
            const label = (et.cyc && et.carry) ? 'adjusted' : et.cyc ? (et.cyc > 0 ? 'high day' : 'low day') : (et.carry > 0 ? 'carried over' : 'carried back');
            const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
            return <div className="mt-3 pt-2.5 border-t border-[#262629] flex items-center justify-between text-[11px] text-[#8A8A90]">
              <span className="tnum"><span style={{ color: adj > 0 ? 'var(--good)' : 'var(--fat)' }}>{sgn(adj)}</span> kcal {label}</span>
              {canOpen && <button onClick={() => setShowCarry(true)} className="pf text-[8px] uppercase" style={{ color: 'var(--accent)' }}>Details ›</button>}
            </div>;
          })()}
          {(() => {
            const dayEntries = entriesOn(db, today);
            if (!dayEntries.length) return null;
            const totalKcal = Math.round(sumMacros(dayEntries).kcal);
            const nMeals = mealsForDay(db, today).filter(m => dayEntries.some(e => e.meal_id === m.id)).length;
            return <button onClick={() => setView('foodlog')} className="mt-3 pt-2.5 border-t border-[#262629] w-full flex items-center justify-between text-[11px] text-[#8A8A90]">
              <span className="truncate">{nMeals} meal{nMeals === 1 ? '' : 's'} · <span className="tnum font-bold" style={{ color: 'var(--text)' }}>{totalKcal.toLocaleString('en-GB')}</span> kcal</span>
              <span className="pf text-[8px] shrink-0 ml-2" style={{ color: 'var(--accent)' }}>Food log ›</span>
            </button>;
          })()}
        </>)}
      </Card>

      {!isPremium && (() => {
        const freeLeft = Math.max(0, FREE_AI_MONTHLY - (aiCalls || 0));
        return freeLeft <= 3
          ? <PremiumNudge db={db} update={update} className="mb-4" reason="free_limit" trackKey="dash_ai_low"
              headline={freeLeft > 0 ? (freeLeft + ' AI log' + (freeLeft === 1 ? '' : 's') + ' left this month') : "You've used your free AI logs"}
              blurb="Premium is unlimited photo, label and describe logging, plus body-fat photo scans. 7 days free, then cancel anytime." />
          : <PremiumNudge db={db} update={update} className="mb-4" reason="manual" trackKey="dash_premium"
              headline="Log a meal in one snap"
              blurb="Premium unlocks unlimited AI logging (photo, label, describe) and body-fat photo scans. Try it free for 7 days." />;
      })()}

      {/* Progress: check-in, weigh-in, the coach line AND the weight-trend spark in one surface.
          (Recipe rails live on the Cook tab now, so Today stays about today's food and progress.) */}
      <div id="checkin-card"><StatusCard db={db} update={update} onCheckIn={onCheckIn} onReview={onReview} streak={streak} onOpenProgress={() => setView('goals')} /></div>

      <DietBreakCard db={db} update={update} />

      {/* Today status: Move / Sleep / Ready as three dials (Google Health). The readiness -> Fight
          payoff moved into the Play hub, so this stays a calm glance. */}
      <StepsSleepCard db={db} update={update} onOpenPlay={onOpenPlay} />

      {/* Play: the game lives behind the dino now. One compact entry into the full hub, so the
          dashboard stays about today's food and progress. Fight + naming stay reachable here. */}
      <button onClick={onOpenPlay} className="w-full text-left bg-[#161618] pixel-box p-4 mb-4 flex items-center gap-3">
        <div className="shrink-0"><PixelDino size={30} color="var(--good)" /></div>
        <div className="flex-1 min-w-0 leading-tight">
          <div className="flex items-baseline gap-2">
            <span className="pf text-[9px] uppercase">Play</span>
            {db.buddy && db.buddy.name && <span className="text-[11px] font-bold truncate">{db.buddy.name}</span>}
          </div>
          <div className="text-[10px] text-[#8A8A90] tnum truncate">
            {streak > 0 && <><span style={{ color: 'var(--fat)' }}>▲ {streak}d</span> · </>}
            {egg && eggProg && <>egg {eggProg.steps}/{eggProg.tier} · </>}
            {Object.keys(macrodex(db)).length} in Macrodex
          </div>
        </div>
        <span className="pf text-[8px] shrink-0" style={{ color: 'var(--accent)' }}>Open ›</span>
      </button>

      <div className="text-center text-[10px] text-[#8A8A90] mt-8 px-4 leading-relaxed">{quote}</div>
      {showCarry && <CarryoverSheet et={et} onClose={() => setShowCarry(false)} />}
    </div>
  );
}

function CarryoverSheet({ et, onClose }) {
  useBackClose(onClose);
  const cd = et.carryDetail;
  const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const dd = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const dShort = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
  const maxAbs = (cd && cd.days.length) ? Math.max(1, ...cd.days.map(d => Math.abs(d.delta))) : 1;
  const Row = ({ label, val, color, bold }) => (
    <div className="flex justify-between tnum text-[11px] py-1">
      <span className={bold ? 'font-bold' : 'text-[#8A8A90]'} style={bold ? { color: 'var(--text)' } : null}>{label}</span>
      <span className="font-bold" style={color ? { color } : (bold ? { color: 'var(--text)' } : null)}>{val}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1"><h2 className="text-lg font-semibold">Today's target</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>
        <div className="text-[11px] text-[#8A8A90] mb-4 leading-snug">Where today's {et.eff.kcal} kcal comes from.</div>

        <div className="pixel-box p-3 mb-4" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
          <Row label="Base target" val={et.base.kcal} />
          {et.cyc !== 0 && <Row label={et.cyc > 0 ? 'High day' : 'Low day'} val={sgn(et.cyc)} color={et.cyc > 0 ? 'var(--good)' : 'var(--fat)'} />}
          {et.carry !== 0 && <Row label={et.carry > 0 ? 'Carried over' : 'Carried back'} val={sgn(et.carry)} color={et.carry > 0 ? 'var(--good)' : 'var(--fat)'} />}
          <div className="border-t border-[#262629] mt-1 pt-1"><Row label="Today you get" val={et.eff.kcal + ' kcal'} bold /></div>
        </div>

        {cd && cd.days.length > 0 && <>
          <div className="pf text-[8px] uppercase text-[#8A8A90] mb-3">This week · since {dd(cd.cycleStart)}</div>
          <div className="flex items-end gap-1.5 mb-2" style={{ height: '64px' }}>
            {cd.days.map((d, i) => {
              const h = Math.round(5 + (Math.abs(d.delta) / maxAbs) * 40);
              const under = d.delta > 0, over = d.delta < 0;
              return <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: '100%' }}>
                <span className="tnum text-[7px] mb-1" style={{ color: under ? 'var(--good)' : over ? 'var(--fat)' : 'var(--muted)' }}>{sgn(d.delta)}</span>
                <div style={{ width: '100%', height: h + 'px', background: under ? 'var(--good)' : over ? 'var(--fat)' : 'var(--border)' }}></div>
              </div>;
            })}
          </div>
          <div className="flex gap-1.5 mb-3">
            {cd.days.map((d, i) => <div key={i} className="flex-1 text-center pf text-[7px] text-[#8A8A90]">{dShort(d.date)}</div>)}
          </div>
          <div className="flex justify-between text-[9px] text-[#8A8A90] mb-4">
            <span><span style={{ color: 'var(--good)' }}>■</span> under target</span>
            <span><span style={{ color: 'var(--fat)' }}>■</span> over target</span>
          </div>

          <div className="pixel-box p-3 mb-3 flex justify-between items-center tnum text-[11px]" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
            <span className="font-bold">Running balance</span>
            <span className="font-bold" style={{ color: cd.balance > 0 ? 'var(--good)' : cd.balance < 0 ? 'var(--fat)' : 'var(--text)' }}>{sgn(cd.balance)} kcal</span>
          </div>

          <div className="text-[10px] text-[#8A8A90] leading-relaxed">{cd.mode === 'dispersed'
            ? `Dispersed mode spreads this ${sgn(cd.balance)} balance across the ${cd.remaining} day${cd.remaining === 1 ? '' : 's'} left this week, so ${sgn(cd.applied)} lands on today.`
            : `Aggressive mode applies the whole ${sgn(cd.balance)} balance to today (${sgn(cd.applied)}), capped at ±${cd.cap} kcal a day.`}</div>
        </>}

        <button onClick={onClose} className="pixel-btn w-full mt-4 py-2.5 text-[11px]" style={{ background: 'var(--surface2)' }}>Got it</button>
      </div>
    </div>
  );
}

/* =====================================================================
   FOOD LOG (calendar + diary)
   ===================================================================== */
const PAW_GRID = ['#..#..#', '#..#..#', '.#.#.#.', '.#.#.#.', '..###..', '.#####.', '.#####.', '..###..'];
function PixelGrip() {
  // A universal drag handle: two columns of pixel dots (clearer than the old paw glyph).
  const pts = [[1, 1], [4, 1], [1, 3], [4, 3], [1, 5], [4, 5]];
  return <svg viewBox="0 0 6 7" width="14" height="16" fill="currentColor" style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges', display: 'block' }}>{pts.map(([x, y], i) => <rect key={i} x={x} y={y} width="1" height="1" />)}</svg>;
}
function FoodLog({ db, update, openLog, showToast }) {
  const today = Store.todayISO();
  const [date, setDate] = useState(today);
  const [menu, setMenu] = useState(null);
  const [mealMenu, setMealMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  const [mode, setMode] = useState('consumed');
  const [editMeal, setEditMeal] = useState(null); const [mealName, setMealName] = useState('');
  const [nameSheet, setNameSheet] = useState(null); // { meal, entries } for "Save as meal"
  const [showCal, setShowCal] = useState(false);
  const [copyTo, setCopyTo] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(today + 'T00:00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const meals = mealsForDay(db, date);
  const day = entriesOn(db, date); const et = effectiveTarget(db, date); const tot = sumMacros(day);
  const override = (db.day_overrides || {})[date] || { shiftKcal: 0 };
  const setShift = (v) => update(d => { d.day_overrides = Object.assign({}, d.day_overrides || {}, { [date]: { shiftKcal: v } }); });
  const remCarbs = et ? Math.max(0, Math.round(et.eff.carbs_g - tot.carbs)) : 0;
  const remFat = et ? Math.max(0, Math.round(et.eff.fat_g - tot.fat)) : 0;
  const toast = (m, a, fn) => showToast && showToast(m, a, fn);
  const del = (e) => { update(d => { tombstone(d, [e.id]); d.log_entries = d.log_entries.filter(x => x.id !== e.id); }); setMenu(null); toast('Deleted ' + e.name, 'Undo', () => update(d => { untombstone(d, [e.id]); d.log_entries.push(e); })); };
  const dup = (e) => { update(d => d.log_entries.push(Object.assign({}, e, { id: Store.uid() }))); setMenu(null); };
  const copyEntriesTo = (entries, targetDate, targetMeal) => {
    const copies = entries.map(e => Object.assign({}, e, { id: Store.uid(), date: targetDate }, targetMeal ? { meal_id: targetMeal } : {}));
    update(d => copies.forEach(c => d.log_entries.push(c))); setCopyTo(null);
    const lbl = targetDate === today ? 'today' : targetDate === shiftISO(today, 1) ? 'tomorrow' : new Date(targetDate + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    toast(copies.length + (copies.length === 1 ? ' item' : ' items') + ' copied to ' + lbl, 'Undo', () => update(d => { const idl = copies.map(c => c.id); tombstone(d, idl); const ids = new Set(idl); d.log_entries = d.log_entries.filter(x => !ids.has(x.id)); }));
  };
  const clearMeal = (m, me) => { const removed = me.slice(); update(d => { tombstone(d, removed.map(x => x.id)); d.log_entries = d.log_entries.filter(x => !(x.meal_id === m.id && x.date === date)); }); setMealMenu(null); toast('Cleared ' + m.name, 'Undo', () => update(d => { untombstone(d, removed.map(x => x.id)); removed.forEach(e => d.log_entries.push(e)); })); };
  // ---- per-day meal editing (only this date; other days + the Settings default are untouched) ----
  const renameMeal = (m, name) => { if (!name.trim()) return; update(d => { const arr = ensureDayMeals(d, date); const mm = arr.find(x => x.id === m.id); if (mm) mm.name = name.trim(); }); };
  const addDayMeal = () => update(d => { const arr = ensureDayMeals(d, date); const maxS = arr.length ? Math.max.apply(null, arr.map(x => x.sort_order)) : -1; arr.push({ id: Store.uid(), user_id: Store.USER, name: 'Meal ' + (arr.length + 1), sort_order: maxS + 1 }); });
  const moveMeal = (m, dir) => update(d => { const arr = ensureDayMeals(d, date); arr.sort((a, b) => a.sort_order - b.sort_order); const i = arr.findIndex(x => x.id === m.id); const j = dir < 0 ? i - 1 : i + 1; if (j < 0 || j >= arr.length) return; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; arr.forEach((x, k) => x.sort_order = k); });
  const deleteMeal = (m) => {
    const hadOverride = !!(db.day_meals && db.day_meals[date]);
    const prevMeals = hadOverride ? db.day_meals[date].map(x => Object.assign({}, x)) : null;
    const affected = day.filter(e => e.meal_id === m.id).map(e => e.id);
    update(d => {
      const arr = ensureDayMeals(d, date); arr.sort((a, b) => a.sort_order - b.sort_order);
      const i = arr.findIndex(x => x.id === m.id); if (i < 0) return;
      const target = arr[i - 1] || arr[i + 1] || null;
      if (target && affected.length) { const ids = new Set(affected); d.log_entries.forEach(e => { if (ids.has(e.id)) e.meal_id = target.id; }); }
      arr.splice(i, 1); arr.forEach((x, k) => x.sort_order = k);
    });
    setMealMenu(null);
    toast('Deleted ' + m.name, 'Undo', () => update(d => {
      if (!d.day_meals) d.day_meals = {};
      if (prevMeals) d.day_meals[date] = prevMeals; else delete d.day_meals[date];
      const ids = new Set(affected); d.log_entries.forEach(e => { if (ids.has(e.id)) e.meal_id = m.id; });
    }));
  };
  // Opens the in-app naming sheet (no more window.prompt); the save itself happens in its onSave.
  const saveMeal = (m, me) => { setMealMenu(null); setNameSheet({ meal: m, entries: me.slice() }); };
  const saveEdit = (patch) => { applyEntryPatch(update, editing.id, patch); setEditing(null); toast('Updated ' + patch.name); };

  // ---- drag & drop: move a logged entry to another meal / reorder within a meal ----
  const [drag, setDrag] = useState(null);   // { id, name, mc }
  const [ghost, setGhost] = useState(null); // { x, y } floating chip position
  const [dropAt, setDropAt] = useState(null); // { mealId, beforeId }
  const moveEntry = (dragId, targetMealId, beforeId) => update(d => {
    const arr = d.log_entries; const idx = arr.findIndex(x => x.id === dragId); if (idx < 0) return;
    const item = arr.splice(idx, 1)[0]; item.meal_id = targetMealId;
    let insertAt;
    if (beforeId) { insertAt = arr.findIndex(x => x.id === beforeId); if (insertAt < 0) insertAt = arr.length; }
    else { let last = -1; for (let i = 0; i < arr.length; i++) { if (arr[i].date === date && arr[i].meal_id === targetMealId) last = i; } insertAt = last >= 0 ? last + 1 : arr.length; }
    arr.splice(insertAt, 0, item);
  });
  const beginDrag = (entry, mc, x, y) => { const m = entry.computed_macros || {}; setDrag({ id: entry.id, name: entry.name, mc, kind: foodKind(entry.name, entry.is_alcohol), kcal: Math.round(m.kcal || 0), qty: entry.qty_label, p: m.protein, c: m.carbs, f: m.fat }); setGhost({ x, y }); if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} } };
  // Small friction: require a brief press-and-hold before a drag arms, so a quick brush doesn't grab.
  const [arming, setArming] = useState(null); // entry id currently being held
  const startDrag = (ev, entry, mc) => {
    ev.preventDefault(); ev.stopPropagation(); setMenu(null); setMealMenu(null);
    const sx = ev.clientX, sy = ev.clientY; setArming(entry.id);
    const timer = setTimeout(() => { cleanup(); setArming(null); beginDrag(entry, mc, sx, sy); }, 180);
    const onMove = (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(timer); cleanup(); setArming(null); } };
    const onUp = () => { clearTimeout(timer); cleanup(); setArming(null); };
    function cleanup() { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); }
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  };
  useEffect(() => {
    if (!drag) return;
    const computeDrop = (x, y) => {
      // Walk every element under the finger, skipping the floating drag preview, and take
      // the first logged row (preferred) or meal drop-zone we hit.
      const els = (document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)]).filter(Boolean);
      let mealEl = null;
      for (let i = 0; i < els.length; i++) {
        const el = els[i]; if (!el.closest || el.closest('[data-ghost]')) continue;
        const row = el.closest('[data-entry-id]');
        if (row) {
          const mealId = row.getAttribute('data-meal-id'); const eid = row.getAttribute('data-entry-id');
          const r = row.getBoundingClientRect(); const after = y > r.top + r.height / 2;
          const list = entriesOn(db, date).filter(e => e.meal_id === mealId).map(e => e.id);
          const idx = list.indexOf(eid); const beforeId = after ? (list[idx + 1] || null) : eid;
          return { mealId, beforeId };
        }
        if (!mealEl) { const me = el.closest('[data-meal-drop]'); if (me) mealEl = me; }
      }
      if (mealEl) return { mealId: mealEl.getAttribute('data-meal-drop'), beforeId: null };
      return null;
    };
    const move = (ev) => {
      const x = ev.clientX, y = ev.clientY; setGhost({ x, y }); setDropAt(computeDrop(x, y));
      const es = y < 100 ? -14 : y > window.innerHeight - 130 ? 14 : 0; if (es) window.scrollBy(0, es);
      ev.preventDefault();
    };
    const up = (ev) => {
      const t = computeDrop(ev.clientX, ev.clientY);
      if (t && t.beforeId !== drag.id) moveEntry(drag.id, t.mealId, t.beforeId);
      setDrag(null); setDropAt(null); setGhost(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    const prevSel = document.body.style.userSelect; document.body.style.userSelect = 'none';
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); document.body.style.userSelect = prevSel; };
  }, [drag]);

  const renderEntry = (e, m, mc) => { const dragging = drag && drag.id === e.id; return (
    <div key={e.id} data-entry-id={e.id} data-meal-id={m.id} className="flex items-center gap-2 py-2.5 mt-2 relative" style={{ borderTop: '1px solid var(--surface2)', borderLeft: '4px solid ' + mc, paddingLeft: 8, opacity: dragging ? 0.45 : 1, outline: dragging ? '2px dashed var(--muted)' : 'none', outlineOffset: '-2px', background: dragging ? 'var(--surface2)' : undefined }}>
      {drag && dropAt && dropAt.mealId === m.id && dropAt.beforeId === e.id && <div className="absolute -top-1 left-0 right-0 h-1.5 pointer-events-none" style={{ background: 'var(--accent)', boxShadow: '2px 2px 0 0 var(--shadow)' }} />}
      <div className="w-9 h-9 pixel-box flex items-center justify-center shrink-0" style={{ background: mc }}><PixelGlyph kind={foodKind(e.name, e.is_alcohol)} color="rgba(0,0,0,0.8)" size={20} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{e.name}</div>
        <div className="flex items-center gap-1 text-[11px] tnum mt-0.5" style={{ color: 'var(--text2)' }}><PixelGlyph kind="scale" color="var(--muted)" size={11} />{e.qty_label || '1 portion'}</div>
        {/* whitespace-nowrap: the macro line stays one line on phones instead of orphaning "0.8F" */}
        <div className="text-[11px] tnum mt-0.5 whitespace-nowrap overflow-hidden"><span className="font-bold" style={{ color: mc }}>{Math.round(e.computed_macros.kcal)}</span><span className="text-[#8A8A90]"> kc</span> <span style={{ color: PRO }}>{e.computed_macros.protein}P</span> <span style={{ color: CARB }}>{e.computed_macros.carbs}C</span> <span style={{ color: FAT }}>{e.computed_macros.fat}F</span></div>
      </div>
      <button onPointerDown={(ev) => startDrag(ev, e, mc)} className="hit shrink-0 px-2 py-2 cursor-grab select-none flex items-center justify-center" style={{ touchAction: 'none', color: (dragging || arming === e.id) ? 'var(--accent)' : 'var(--muted)', transform: arming === e.id ? 'scale(1.35)' : 'none', transition: 'transform .16s ease' }} title="Press and hold to drag"><PixelGrip /></button>
      <button onClick={(ev) => { ev.stopPropagation(); setMealMenu(null); setMenu(menu === e.id ? null : e.id); }} className="hit px-2 text-[#8A8A90] shrink-0" aria-label="Entry options">⋯</button>
      {menu === e.id && (<div className="absolute right-2 top-9 z-20 bg-[#1E1E22] border border-[#262629] rounded-2xl py-1 text-sm shadow-xl" onClick={ev => ev.stopPropagation()}>
        <button onClick={() => { setEditing(e); setMenu(null); }} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Edit</button>
        <button onClick={() => dup(e)} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Duplicate</button>
        <button onClick={() => { setCopyTo({ title: 'Copy ' + e.name, entries: [e], srcDate: date, pickMeal: true, meal: e.meal_id }); setMenu(null); }} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Copy to…</button>
        <button onClick={() => del(e)} className="block w-full text-left px-4 py-2 text-[#ff6b6b] hover:bg-[#262629]">Delete</button>
      </div>)}
    </div>); };

  const first = new Date(calMonth.y, calMonth.m, 1); const startDow = (first.getDay() + 6) % 7; // Mon=0
  const daysIn = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startDow; i++) cells.push(null);
  for (let dd = 1; dd <= daysIn; dd++) cells.push(Store.isoOf(new Date(calMonth.y, calMonth.m, dd)));
  const logSet = new Set(db.log_entries.map(e => e.date));
  const monthName = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="max-w-md lg:max-w-5xl mx-auto px-5 pb-28 lg:pb-12 pt-6 fade-in" onClick={() => { if (menu) setMenu(null); if (mealMenu) setMealMenu(null); }}>
      <PageHeader kicker="Your food diary" title="Food log" />
      <div className="lg:grid lg:grid-cols-2 lg:gap-6 lg:items-start">
      <div className="min-w-0">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setDate(shiftISO(date, -1))} className="text-[#8A8A90] px-3 py-2 text-lg">‹</button>
        <button onClick={() => { if (!showCal) { const d = new Date(date + 'T00:00:00'); setCalMonth({ y: d.getFullYear(), m: d.getMonth() }); } setShowCal(s => !s); }} className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#1E1E22] border border-[#262629]">
          <span className="text-sm font-semibold">{date === today ? 'Today' : date === shiftISO(today, 1) ? 'Tomorrow' : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span className="text-[#8A8A90] text-[10px]">{showCal ? '▲' : '▼'}</span>
        </button>
        <button onClick={() => setDate(shiftISO(date, 1))} className="text-[#8A8A90] px-3 py-2 text-lg">›</button>
      </div>
      {showCal && <Card className="p-4 mb-4 fade-in">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setCalMonth(c => { const m = c.m - 1; return m < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m }; })} className="text-[#8A8A90] px-2 py-1">‹</button>
          <div className="text-sm font-semibold">{monthName}</div>
          <button onClick={() => setCalMonth(c => { const m = c.m + 1; return m > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m }; })} className="text-[#8A8A90] px-2 py-1">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[#8A8A90] mb-1">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">{cells.map((c, i) => c ? (
          <button key={i} onClick={() => { setDate(c); setShowCal(false); }} className={`aspect-square rounded-lg text-[12px] tnum flex flex-col items-center justify-center relative ${c === date ? 'bg-white text-black font-bold' : c === today ? 'bg-[#1E1E22] text-white' : c > today ? 'text-[#8A8A90]' : 'text-[#C9C9CF]'}`}>
            {new Date(c + 'T00:00:00').getDate()}
            {logSet.has(c) && (() => { const cd = catchForDay(db, c); const cr = cd && CR_BY_ID[cd.id]; return cr ? <span className="absolute -bottom-0.5 right-0"><Sprite art={cr.art} colors={cd.shiny ? crShiny(cr.colors) : cr.colors} px={1.4} /></span> : null; })()}
          </button>) : <div key={i} />)}</div>
      </Card>}

      {/* Slim remaining-at-a-glance while you log; the full hero + Balance live on the Today tab. */}
      {et && (() => {
        const rem = et.eff.kcal - tot.kcal;
        const over = rem < 0;
        return <Card className="p-4 mb-4">
          <div className="flex items-baseline justify-between mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="pf text-[8px] uppercase text-[#8A8A90]">{over ? 'Over by' : 'Kcal left'}</span>
              <span className="text-2xl font-bold tnum" style={{ color: over ? 'var(--danger)' : 'var(--hero)' }}>{Math.abs(Math.round(rem))}</span>
            </div>
            <span className="text-[10px] text-[#8A8A90] tnum">of {et.eff.kcal}</span>
          </div>
          <div className="space-y-2">
            {[['PROT', tot.protein, et.eff.protein_g, PRO], ['CARB', tot.carbs, et.eff.carbs_g, CARB], ['FATS', tot.fat, et.eff.fat_g, FAT]].map(([l, e, t, c]) => (
              <div key={l} className="flex items-center gap-2.5">
                <span className="pf text-[8px] w-8 shrink-0 text-[#8A8A90]">{l}</span>
                <div className="pixel-bar flex-1" style={{ height: 9, borderWidth: 2 }}><i style={{ width: Math.min(100, t > 0 ? e / t * 100 : 0) + '%', background: c }} /></div>
                <span className="tnum text-[10px] w-[72px] text-right shrink-0 whitespace-nowrap"><span className="font-bold">{Math.max(0, Math.round(t - e))}</span><span className="text-[#8A8A90]">g left</span></span>
              </div>
            ))}
          </div>
        </Card>;
      })()}

      {day.length > 0 && <button onClick={() => setCopyTo({ title: 'Copy this whole day', entries: day, srcDate: date })} className="w-full text-[12px] text-[#8A8A90] mb-3 flex items-center justify-center gap-1.5 py-1.5">⧉ Copy this day to another date…</button>}
      </div>

      <div className="min-w-0">
      {db.log_entries.length === 0 && <Card className="p-4 mb-3 fade-in" style={{ borderTopColor: 'var(--accent)', borderTopWidth: '5px' }}>
        <div className="text-[13px] font-semibold mb-1">Log your first item</div>
        <div className="text-[11px] text-[#8A8A90] leading-relaxed">Tap <span className="text-[#4A9EEB] font-medium">+ Add food</span> on any meal below, or the big ✚ button. You can snap a label photo, describe a meal out loud, scan a barcode, or search, the AI does the maths and you just confirm.</div>
      </Card>}
      {meals.map((m, mi) => {
        const me = day.filter(e => e.meal_id === m.id); const ms = sumMacros(me);
        const mc = [PRO, CARB, FAT, 'var(--accent)', 'var(--weight)'][mi % 5];
        return (
          <Card key={m.id} className="p-4 mb-3" data-meal-drop={m.id} style={drag && dropAt && dropAt.mealId === m.id ? { outline: '4px solid var(--accent)', outlineOffset: '-4px', boxShadow: '4px 4px 0 0 var(--accent)' } : undefined}>
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="flex flex-col -my-1 shrink-0">
                  <button onClick={() => moveMeal(m, -1)} disabled={mi === 0} style={{ opacity: mi === 0 ? 0.25 : 1 }} className="hit text-[#8A8A90] leading-none text-[10px] px-1 py-1.5" title="Move up">▲</button>
                  <button onClick={() => moveMeal(m, 1)} disabled={mi === meals.length - 1} style={{ opacity: mi === meals.length - 1 ? 0.25 : 1 }} className="hit text-[#8A8A90] leading-none text-[10px] px-1 py-1.5" title="Move down">▼</button>
                </div>
                {editMeal === m.id
                  ? <input autoFocus value={mealName} onChange={e => setMealName(e.target.value)} onBlur={() => { renameMeal(m, mealName); setEditMeal(null); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} className="bg-[#1E1E22] border border-[#262629] rounded-lg px-2 py-1 text-sm font-semibold w-40" />
                  : <button onClick={() => { setEditMeal(m.id); setMealName(m.name); }} className="hit font-semibold flex items-center gap-1.5 pt-0.5 min-w-0" title="Rename meal"><span className="truncate">{m.name}</span><span className="text-[#5A5A62] text-[11px] shrink-0">✎</span></button>}
              </div>
              <div className="flex items-start gap-1.5">
                <div className="text-[11px] text-[#8A8A90] tnum text-right leading-tight pt-0.5">
                  <div className="font-semibold text-[#C9C9CF]">{Math.round(ms.kcal)} kcal</div>
                  {me.length > 0 && <div><span style={{ color: PRO }}>P{Math.round(ms.protein)}</span> <span style={{ color: CARB }}>C{Math.round(ms.carbs)}</span> <span style={{ color: FAT }}>F{Math.round(ms.fat)}</span></div>}
                </div>
                <div className="relative">
                  <button onClick={ev => { ev.stopPropagation(); setMenu(null); setMealMenu(mealMenu === m.id ? null : m.id); }} className="hit px-1 text-[#8A8A90]" aria-label="Meal options">⋯</button>
                  {mealMenu === m.id && <div className="absolute right-0 top-7 z-20 bg-[#1E1E22] border border-[#262629] rounded-2xl py-1 text-sm shadow-xl w-40" onClick={ev => ev.stopPropagation()}>
                    {me.length > 0 && <button onClick={() => saveMeal(m, me)} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Save as meal</button>}
                    {me.length > 0 && <button onClick={() => { setCopyTo({ title: 'Copy ' + m.name, entries: me, srcDate: date, pickMeal: true, meal: m.id }); setMealMenu(null); }} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Copy to…</button>}
                    {me.length > 0 && <button onClick={() => clearMeal(m, me)} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Clear food</button>}
                    <button onClick={() => { setMealMenu(null); setConfirm({ title: 'Delete ' + m.name + '?', body: me.length ? `Its ${me.length} logged item${me.length === 1 ? '' : 's'} will move to the meal above so nothing is lost. Only ${date === today ? 'today' : 'this day'} changes.` : `Removes this meal from ${date === today ? 'today' : 'this day'} only.`, confirmLabel: 'Delete meal', onConfirm: () => deleteMeal(m) }); }} className="block w-full text-left px-4 py-2 text-[#ff6b6b] hover:bg-[#262629]">Delete meal</button>
                  </div>}
                </div>
              </div>
            </div>
            {me.map(e => renderEntry(e, m, mc))}
            {drag && me.length === 0 && <div className="mt-2 py-4 text-center text-[11px] pf uppercase" style={{ color: 'var(--accent)', border: '2px dashed var(--accent)' }}>Drop here</div>}
            <button onClick={() => openLog({ date, mealId: m.id })} className="mt-2 text-[13px] text-[#4A9EEB] font-medium">+ Add food</button>
          </Card>);
      })}
      {(() => {
        const mealIds = new Set(meals.map(m => m.id));
        const orphans = day.filter(e => !mealIds.has(e.meal_id));
        if (!orphans.length) return null;
        const um = { id: '__unsorted__' };
        return (<Card className="p-4 mb-3" style={{ borderColor: 'var(--muted)' }}>
          <div className="flex justify-between items-center">
            <div className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>Unsorted</div>
            <div className="text-[11px] text-[#8A8A90] tnum">{Math.round(sumMacros(orphans).kcal)} kcal</div>
          </div>
          <div className="text-[11px] text-[#8A8A90] mt-1 mb-1">These were logged under a meal that isn't on this day. Drag each into a meal above.</div>
          {orphans.map(e => renderEntry(e, um, 'var(--muted)'))}
        </Card>);
      })()}
      <button onClick={addDayMeal} className="w-full text-sm text-[#8A8A90] border border-dashed border-[#262629] rounded-2xl py-3">+ Add a meal to this day</button>
      </div>
      </div>
      {editing && <EditEntryModal entry={editing} onSave={saveEdit} onClose={() => setEditing(null)} />}
      {nameSheet && <NameSheet title="Save as meal" hint="Save this meal for one-tap logging. Name it:" initial={nameSheet.meal.name} saveLabel="Save meal" onSave={(name) => {
        const items = nameSheet.entries.map(e => ({ name: e.name, source: e.source, is_alcohol: e.is_alcohol, alcohol_split: e.alcohol_split, qtyLabel: e.qty_label, macros: e.computed_macros }));
        update(d => { d.saved_meals = (d.saved_meals || []).concat([{ id: Store.uid(), name, items, created_at: Date.now() }]); });
        setNameSheet(null); toast('Saved "' + name + '", find it under Meals when logging');
      }} onClose={() => setNameSheet(null)} />}
      {copyTo && <CopyToModal key={(copyTo.entries[0] ? copyTo.entries[0].id : '') + '|' + (copyTo.pickMeal ? 'm' : 'd') + '|' + copyTo.title} title={copyTo.title} srcDate={copyTo.srcDate} entries={copyTo.entries} loggedDates={logSet} meals={copyTo.pickMeal ? meals : null} defaultMeal={copyTo.meal} onPick={(t, mealId) => copyEntriesTo(copyTo.entries, t, mealId)} onClose={() => setCopyTo(null)} />}
      {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel} onConfirm={confirm.onConfirm} onClose={() => setConfirm(null)} />}
      {drag && ghost && (() => {
        const W = Math.min(320, (typeof window !== 'undefined' ? window.innerWidth : 360) - 40);
        return <div data-ghost className="fixed z-[80] pointer-events-none pixel-box" style={{ width: W, left: ghost.x - W + 14, top: ghost.y - 28, background: 'var(--card)', boxShadow: '5px 5px 0 0 var(--shadow)', transform: 'scale(1.02)', borderLeft: '4px solid ' + drag.mc, opacity: 0.97, pointerEvents: 'none' }}>
          <div className="flex items-center gap-3 py-2.5 px-2">
            <div className="w-9 h-9 pixel-box flex items-center justify-center shrink-0" style={{ background: drag.mc, boxShadow: 'none' }}><PixelGlyph kind={drag.kind} color="rgba(0,0,0,0.8)" size={20} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm truncate">{drag.name}</div>
              <div className="flex items-center gap-1 text-[11px] tnum mt-0.5" style={{ color: 'var(--text2)' }}><PixelGlyph kind="scale" color="var(--muted)" size={11} />{drag.qty || '1 portion'}</div>
              <div className="text-[11px] tnum mt-0.5"><span className="font-bold" style={{ color: drag.mc }}>{drag.kcal}</span><span className="text-[#8A8A90]"> kc</span> <span style={{ color: PRO }}>{drag.p}P</span> <span style={{ color: CARB }}>{drag.c}C</span> <span style={{ color: FAT }}>{drag.f}F</span></div>
            </div>
            <span className="shrink-0 pr-1" style={{ color: drag.mc }}><PixelGrip /></span>
          </div>
        </div>;
      })()}
    </div>
  );
}
// Parse a stored qty label (e.g. "150 g", "2 cans", "1 can (500 ml)") back into amount + unit + noun.
function parseQty(label) {
  if (!label) return null;
  const m = String(label).trim().match(/^([0-9]*\.?[0-9]+|[¼½⅓⅔¾])\s*(.*)$/);
  if (!m) return null;
  const fracMap = { '¼': 0.25, '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¾': 0.75 };
  const amt = fracMap[m[1]] != null ? fracMap[m[1]] : parseFloat(m[1]);
  if (!isFinite(amt) || amt <= 0) return null;
  const rest = (m[2] || '').trim();
  if (rest === '' || /^g\b/.test(rest) || rest === 'g') return { amount: amt, unit: 'g', noun: 'g' };
  if (/^oz\b/.test(rest)) return { amount: amt, unit: 'oz', noun: 'oz' };
  const noun = rest.replace(/s$/i, '') || 'serving';
  return { amount: amt, unit: 'serv', noun };
}
// Apply an entry edit: update the logged entry and carry the change back to the saved food so
// Recents re-adds with the latest details. Shared by the Food log editor and the post-log
// "Adjust" toast action.
function applyEntryPatch(update, id, patch) {
  update(d => {
    const x = d.log_entries.find(y => y.id === id); if (!x) return;
    x.name = patch.name; x.qty_label = patch.qty; x.computed_macros = patch.macros;
    if (patch.amount != null) x.amount = patch.amount; if (patch.unit) x.unit = patch.unit; if (patch.unit_noun) x.unit_noun = patch.unit_noun;
    if (patch.alcohol_split !== undefined) x.alcohol_split = patch.alcohol_split;
    const key = patch.name.trim().toLowerCase(); const food = d.foods.find(y => y.name.trim().toLowerCase() === key && !!y.is_alcohol === !!x.is_alcohol);
    if (food) { food.macros = patch.macros; food.last_qty = patch.qty || food.last_qty; food.updated_at = Date.now(); if (patch.alcohol_split !== undefined) food.alcohol_split = patch.alcohol_split; }
  });
}
// Small in-app naming sheet (replaces window.prompt): prefilled text, Save/Cancel.
function NameSheet({ title, hint, initial, saveLabel, onSave, onClose }) {
  useBackClose(onClose);
  const [name, setName] = useState(initial || '');
  return (<div className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
    <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} className="hit text-[#8A8A90] text-2xl leading-none">×</button></div>
      {hint && <div className="text-[12px] text-[#8A8A90] mb-3 leading-snug">{hint}</div>}
      <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }} />
      <div className="flex gap-2 mt-4">
        <Btn kind="ghost" className="flex-1" onClick={onClose}>Cancel</Btn>
        <Btn kind="accent" className="flex-1" disabled={!name.trim()} style={{ opacity: name.trim() ? 1 : 0.5 }} onClick={() => onSave(name.trim())}>{saveLabel || 'Save'}</Btn>
      </div>
    </div>
  </div>);
}
function EditEntryModal({ entry, onSave, onClose, title, saveLabel }) {
  useBackClose(onClose);
  const m = entry.computed_macros || {};
  const parsed = (entry.amount && +entry.amount > 0)
    ? { amount: +entry.amount, unit: entry.unit === 'g' || entry.unit === 'oz' ? entry.unit : 'serv', noun: entry.unit_noun || 'serving' }
    : parseQty(entry.qty_label);
  const amt0 = parsed ? parsed.amount : 1;
  const unit = parsed ? parsed.unit : 'serv';
  const noun = parsed ? parsed.noun : 'serving';
  const [name, setName] = useState(entry.name || '');
  const [amount, setAmount] = useState(String(amt0));
  const [base, setBase] = useState({ protein: (m.protein || 0) / amt0, carbs: (m.carbs || 0) / amt0, fat: (m.fat || 0) / amt0, fiber: (m.fiber || 0) / amt0, kcal: (m.kcal || 0) / amt0 });
  const [edit, setEdit] = useState(false);
  const a = +amount || 0;
  const total = { protein: +(base.protein * a).toFixed(1), carbs: +(base.carbs * a).toFixed(1), fat: +(base.fat * a).toFixed(1), fiber: +(base.fiber * a).toFixed(1), kcal: Math.round(base.kcal * a) };
  const step = unit === 'g' ? gramStep(a) : 1;
  const bump = (d) => setAmount(x => String(Math.max(0, +(((+x || 0) + d)).toFixed(2))));
  const setTotalField = (k, val) => { const v = +val || 0; setBase(b => Object.assign({}, b, { [k]: a > 0 ? v / a : v })); };
  const plural = (+amount > 1 && /^[a-z]+$/i.test(noun)) ? 's' : '';
  const label = unit === 'g' ? `${fmtCount(amount)} g` : unit === 'oz' ? `${fmtCount(amount)} oz` : `${fmtCount(amount)} ${noun}${plural}`;
  const unitWord = unit === 'g' ? 'grams' : unit === 'oz' ? 'ounces' : (noun + (/^[a-z]+$/i.test(noun) ? 's' : ''));
  // Alcohol calories carry no protein, they are split across carbs and fat. Let a logged drink's
  // split be re-balanced after the fact with a slider, keeping the calories fixed.
  const isAlc = !!entry.is_alcohol;
  const [carbPct, setCarbPct] = useState(() => (m.kcal > 0 ? Math.max(0, Math.min(100, Math.round(((m.carbs || 0) * 4 / m.kcal) * 10) * 10)) : 50));
  function setSplit(pct) { setCarbPct(pct); setBase(b => Object.assign({}, b, b.kcal > 0 ? { carbs: (b.kcal * pct / 100) / 4, fat: (b.kcal * (100 - pct) / 100) / 9 } : {})); }
  function save() { onSave({ name: name || entry.name, qty: label, macros: { kcal: total.kcal, protein: total.protein, carbs: total.carbs, fat: total.fat, fiber: total.fiber }, amount: a, unit, unit_noun: noun, alcohol_split: isAlc ? { carb_pct: carbPct, fat_pct: 100 - carbPct } : undefined }); }
  return (<div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
    <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">{title || 'Edit food'}</h2><button onClick={onClose} className="hit text-[#8A8A90] text-2xl leading-none">×</button></div>
      <Field label="Name"><TextInput value={name} onChange={e => setName(e.target.value)} /></Field>
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">How much did you have?</div>
      <div className="flex items-center gap-3">
        <button onClick={() => bump(-step)} className="w-12 h-12 pixel-box flex items-center justify-center text-2xl leading-none shrink-0" style={{ boxShadow: 'none', background: 'var(--surface2)' }}>−</button>
        <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={inputCls + ' text-center text-lg font-bold flex-1'} />
        <button onClick={() => bump(step)} className="w-12 h-12 pixel-box flex items-center justify-center text-2xl leading-none shrink-0" style={{ boxShadow: 'none', background: 'var(--surface2)' }}>+</button>
      </div>
      <div className="text-[11px] text-[#8A8A90] mt-1.5 mb-3">{unitWord}{unit === 'g' ? ` · ±${step} g per tap` : ''}</div>
      <div className="pixel-box p-3 mb-3 flex justify-between items-center" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
        <div className="text-[12px] tnum"><span style={{ color: PRO }}>P{total.protein}</span> <span style={{ color: CARB }}>C{total.carbs}</span> <span style={{ color: FAT }}>F{total.fat}</span></div>
        <div className="text-lg font-bold tnum">{total.kcal}<span className="text-[10px] text-[#8A8A90]"> kcal</span></div>
      </div>
      {isAlc && <div className="mb-3">
        <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Split these calories</div>
        <Field label={`${carbPct}% carbs · ${100 - carbPct}% fat`}>
          <input type="range" min="0" max="100" step="10" value={carbPct} onChange={e => setSplit(+e.target.value)} className="w-full accent-[#4A9EEB]" />
          <div className="text-sm text-[#8A8A90] mt-2 tnum">= {total.carbs}g carbs · {total.fat}g fat</div>
        </Field>
      </div>}
      <button onClick={() => setEdit(e => !e)} className="text-[11px] text-[#8A8A90] mb-2">{edit ? '▲ Hide exact macros' : '▾ Numbers off? Edit exact macros'}</button>
      {edit && <div className="fade-in mb-2">
        <div className="grid grid-cols-3 gap-2.5"><Field label="Protein (g)"><NumInput value={total.protein} onChange={e => setTotalField('protein', e.target.value)} /></Field><Field label="Carbs (g)"><NumInput value={total.carbs} onChange={e => setTotalField('carbs', e.target.value)} /></Field><Field label="Fat (g)"><NumInput value={total.fat} onChange={e => setTotalField('fat', e.target.value)} /></Field></div>
        <div className="grid grid-cols-2 gap-2.5"><Field label="Fibre (g)"><NumInput value={total.fiber} onChange={e => setTotalField('fiber', e.target.value)} /></Field><Field label="Calories"><NumInput value={total.kcal} onChange={e => setTotalField('kcal', e.target.value)} /></Field></div>
      </div>}
      <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={save}>{saveLabel || 'Save changes'}</Btn><Btn kind="ghost" onClick={onClose}>Cancel</Btn></div>
    </div>
  </div>);
}

function CopyToModal({ title, srcDate, entries, loggedDates, meals, defaultMeal, onPick, onClose }) {
  useBackClose(onClose);
  const today = Store.todayISO();
  const [cm, setCm] = useState(() => { const d = new Date((srcDate || today) + 'T00:00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selMeal, setSelMeal] = useState(defaultMeal || (meals && meals[0] && meals[0].id));
  const first = new Date(cm.y, cm.m, 1); const startDow = (first.getDay() + 6) % 7;
  const daysIn = new Date(cm.y, cm.m + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startDow; i++) cells.push(null);
  for (let dd = 1; dd <= daysIn; dd++) cells.push(Store.isoOf(new Date(cm.y, cm.m, dd)));
  const monthName = new Date(cm.y, cm.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const logged = loggedDates || new Set();
  // What's being copied, so the user has confidence before they pick a day.
  const count = (entries || []).length;
  const kcal = Math.round(sumMacros(entries || []).kcal);
  const pick = (c) => onPick(c, meals ? selMeal : undefined);
  // One-tap targets for the common cases, so most copies never touch the calendar.
  const quick = [{ iso: shiftISO(today, -1), label: 'Yesterday' }, { iso: today, label: 'Today' }, { iso: shiftISO(today, 1), label: 'Tomorrow' }];
  return (<div className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
    <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-1"><h2 className="text-lg font-semibold truncate pr-2">{title}</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none shrink-0">×</button></div>
      {count > 0 && <div className="text-[11px] tnum mb-3" style={{ color: 'var(--text2)' }}>{count}{count === 1 ? ' item' : ' items'} <span className="text-[#5A5A62]">·</span> <span className="font-semibold" style={{ color: 'var(--accent)' }}>{kcal}</span> kcal</div>}
      {meals && <div className="mb-3">
        <div className="pf text-[9px] uppercase text-[#8A8A90] mb-1.5">Into which meal</div>
        <div className="flex gap-1.5 flex-wrap">{meals.map(m => <button key={m.id} onClick={() => setSelMeal(m.id)} className={`pixel-box px-2.5 py-1.5 text-[11px] ${selMeal === m.id ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ boxShadow: 'none' }}>{m.name}</button>)}</div>
      </div>}
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-1.5">Quick copy to</div>
      <div className="flex gap-1.5 mb-3">{quick.map(q => <button key={q.iso} onClick={() => pick(q.iso)} className={`flex-1 pixel-box px-2 py-2 text-[11px] font-bold ${q.iso === srcDate ? 'bg-[#262629] text-[#8A8A90]' : 'bg-[#1E1E22] text-white'}`} style={{ boxShadow: 'none' }}>{q.label}</button>)}</div>
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-1.5">Or pick a day</div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setCm(c => { const m = c.m - 1; return m < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m }; })} className="text-[#8A8A90] px-2 py-1">‹</button>
        <div className="text-sm font-semibold">{monthName}</div>
        <button onClick={() => setCm(c => { const m = c.m + 1; return m > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m }; })} className="text-[#8A8A90] px-2 py-1">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[#8A8A90] mb-1">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">{cells.map((c, i) => c ? (
        <button key={i} onClick={() => pick(c)} className={`relative aspect-square text-[12px] tnum flex items-center justify-center pixel-box ${c === today ? 'bg-white text-black font-bold' : c === srcDate ? 'bg-[#262629] text-[#8A8A90]' : 'bg-[#1E1E22]'}`} style={{ boxShadow: 'none' }}>{new Date(c + 'T00:00:00').getDate()}{logged.has(c) && c !== today && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1" style={{ background: 'var(--accent)' }} />}</button>
      ) : <div key={i} />)}</div>
      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-[#5A5A62]"><span className="inline-block w-1 h-1" style={{ background: 'var(--accent)' }} /> has food logged</div>
    </div>
  </div>);
}

/* =====================================================================
   LOG SHEET
   ===================================================================== */
// Unified "Food" tab: one search box over your own foods AND the Open Food Facts database, your
// recents/favourites when empty, saved meals, and a manual-entry fallback. Replaces the old
// separate Recent / Search / Meals / Manual tabs so logging is one clean screen.
function FoodTab({ db, update, mealName, onPick, onLogMeal, onAskAI }) {
  const [q, setQ] = useState('');
  const [dbResults, setDbResults] = useState([]); const [dbLoading, setDbLoading] = useState(false); const [dbErr, setDbErr] = useState('');
  const [sel, setSel] = useState(null); const [manual, setManual] = useState(false); const [confirmDel, setConfirmDel] = useState(null);
  const [qtyFor, setQtyFor] = useState(null); // tap the qty text on a row to adjust the amount before logging
  const query = q.trim().toLowerCase();
  const foods = db.foods.filter(f => !f.is_alcohol);
  const freq = useMemo(() => {
    const total = {}, perMeal = {}, cache = {};
    const nameOf = (date, mealId) => { const ms = cache[date] || (cache[date] = mealsForDay(db, date)); const m = ms.find(x => x.id === mealId); return m ? m.name : ''; };
    (db.log_entries || []).forEach(e => { const k = (e.name || '').toLowerCase(); if (!k) return; total[k] = (total[k] || 0) + 1; if (mealName && nameOf(e.date, e.meal_id) === mealName) perMeal[k] = (perMeal[k] || 0) + 1; });
    return { total, perMeal };
  }, [db.log_entries, mealName]);
  const score = (f) => { const k = f.name.toLowerCase(); return (freq.perMeal[k] || 0) * 100 + (freq.total[k] || 0); };
  const myMatches = foods.filter(f => !query || f.name.toLowerCase().includes(query));
  const favs = !query ? myMatches.filter(f => f.is_favorite).sort((a, b) => b.updated_at - a.updated_at) : [];
  const nonFav = query ? myMatches : myMatches.filter(f => !f.is_favorite);
  const ranked = nonFav.slice().sort((a, b) => query ? (b.updated_at - a.updated_at) : ((score(b) - score(a)) || (b.updated_at - a.updated_at)));
  const myShown = ranked.slice(0, query ? 40 : 25);
  useEffect(() => {
    if (query.length < 2) { setDbResults([]); setDbErr(''); setDbLoading(false); return; }
    let cancel = false; setDbLoading(true); setDbErr('');
    const t = setTimeout(async () => {
      try {
        const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(query) + '&search_simple=1&action=process&json=1&page_size=30&fields=product_name,brands,nutriments,serving_size,serving_quantity';
        const data = await (await fetch(url)).json();
        if (cancel) return;
        const items = (data.products || []).map(p => { const n = p.nutriments || {}; const k = n['energy-kcal_100g']; if (!p.product_name || k == null) return null; return { name: p.product_name, brand: p.brands || '', serving: p.serving_size || null, servingG: +p.serving_quantity || null, per100: { kcal: +k, protein: +n.proteins_100g || 0, carbs: +n.carbohydrates_100g || 0, fat: +n.fat_100g || 0, fiber: +n.fiber_100g || 0 } }; }).filter(Boolean);
        setDbResults(items);
      } catch (e) { if (!cancel) setDbErr('Couldn\'t reach the food database.'); }
      if (!cancel) setDbLoading(false);
    }, 450);
    return () => { cancel = true; clearTimeout(t); };
  }, [query]);
  const savedMeals = (db.saved_meals || []).slice().sort((a, b) => b.created_at - a.created_at);
  const delMeal = (id) => update(d => { d.saved_meals = (d.saved_meals || []).filter(x => x.id !== id); });
  const mealTotal = (items) => items.reduce((a, i) => ({ kcal: a.kcal + (i.macros.kcal || 0), protein: a.protein + (i.macros.protein || 0), carbs: a.carbs + (i.macros.carbs || 0), fat: a.fat + (i.macros.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const star = (food) => update(d => { const x = d.foods.find(y => y.id === food.id); if (x) x.is_favorite = !x.is_favorite; });
  // If a saved food carries per-unit values (a smart food or a remembered AI estimate), open the
  // gram-scalable confirm so it can be re-logged at any weight; otherwise one-tap log the last amount.
  const pickMine = (f) => { if (!f.is_alcohol && f.corrected && f.saved_base) { setSel({ name: f.name }); return; } onPick({ name: f.name, source: f.source, is_alcohol: f.is_alcohol, macros: f.macros, alcohol_split: f.alcohol_split, qtyLabel: f.last_qty }); };
  if (sel) { const sc = savedCorrection(db, sel.name); if (sc) return <ConfirmFood {...parsedFromSaved(sc, 'Using the values you saved for this food.')} onAdd={onPick} onCancel={() => setSel(null)} onAskAI={onAskAI} />;
    return <ConfirmFood note="From the food database. Check it looks right before logging." per100 source="off" branded={!!sel.brand} servingG={sel.servingG} servingLabel={sel.serving} initial={{ name: sel.name, kcal: Math.round(sel.per100.kcal), protein: sel.per100.protein, carbs: sel.per100.carbs, fat: sel.per100.fat, fiber: sel.per100.fiber }} onAdd={onPick} onCancel={() => setSel(null)} onAskAI={onAskAI} />; }
  if (manual) return <ManualTab onPick={onPick} onCancel={() => setManual(false)} />;
  const MyRow = (f) => (<div key={f.id} className="flex items-center justify-between bg-[#1E1E22] rounded-2xl px-3 py-2.5">
    <button onClick={() => pickMine(f)} className="text-left min-w-0 flex-1"><div className="text-sm truncate">{f.name}{f.last_qty ? <span onClick={ev => { ev.stopPropagation(); setQtyFor(f); }} className="text-[#8A8A90]" style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }} title="Adjust the amount"> · {f.last_qty}</span> : ''}</div><div className="text-[11px] text-[#8A8A90] tnum">{Math.round(f.macros.kcal)} kcal · P{f.macros.protein} C{f.macros.carbs} F{f.macros.fat}</div></button>
    <button onClick={() => star(f)} className="hit px-2 shrink-0" style={{ color: f.is_favorite ? FAT : '#3A3A42' }}><Icon.star width="18" height="18" fill="currentColor" /></button></div>);
  const Head = (t) => <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mt-4 mb-2">{t}</div>;
  return (<div>
    <TextInput placeholder="Search your foods and the database…" value={q} onChange={e => setQ(e.target.value)} />
    {!query && <>
      {favs.length > 0 && <>{Head('Favourites')}<div className="space-y-2">{favs.map(MyRow)}</div></>}
      {myShown.length > 0 && <>{Head('Recent')}<div className="space-y-2">{myShown.map(MyRow)}</div></>}
      {savedMeals.length > 0 && <>{Head('Saved meals')}<div className="space-y-2">{savedMeals.map(sm => { const t = mealTotal(sm.items); return (<div key={sm.id} className="flex items-center justify-between bg-[#1E1E22] rounded-2xl px-3 py-2.5"><button onClick={() => onLogMeal(sm.items)} className="text-left min-w-0 flex-1"><div className="text-sm truncate">{sm.name} <span className="text-[#8A8A90]">· {sm.items.length} item{sm.items.length === 1 ? '' : 's'}</span></div><div className="text-[11px] text-[#8A8A90] tnum">{Math.round(t.kcal)} kcal · P{Math.round(t.protein)} C{Math.round(t.carbs)} F{Math.round(t.fat)}</div></button><button onClick={() => setConfirmDel(sm)} className="hit px-2 shrink-0 text-[#8A8A90] text-lg leading-none" aria-label="Delete saved meal">×</button></div>); })}</div></>}
      {!favs.length && !myShown.length && !savedMeals.length && <div className="text-center text-[#8A8A90] text-sm py-8"><div className="flex justify-center mb-3"><PixelDino size={40} color="var(--muted)" /></div>Search for a food above, scan a barcode, or estimate a meal. Anything you log appears here for one-tap logging next time.</div>}
    </>}
    {query && <>
      {myShown.length > 0 && <>{Head('Your foods')}<div className="space-y-2">{myShown.map(MyRow)}</div></>}
      {Head('Food database')}
      {dbLoading && <div className="text-[12px] text-[#4A9EEB] py-2">Searching…</div>}
      {!dbLoading && dbResults.length > 0 && <div className="space-y-2">{dbResults.map((r, idx) => (<button key={'db' + idx} onClick={() => setSel(r)} className="w-full flex items-center justify-between gap-2 bg-[#1E1E22] rounded-2xl px-3 py-2.5 text-left"><div className="min-w-0"><div className="text-sm truncate">{r.name}{r.brand ? <span className="text-[#8A8A90]"> · {r.brand.split(',')[0]}</span> : ''}</div><div className="text-[11px] text-[#8A8A90] tnum">{Math.round(r.per100.kcal)} kcal · <span style={{ color: PRO }}>P {Math.round(r.per100.protein)}g</span> / 100 g</div></div><span className="text-[#8A8A90] shrink-0 text-lg leading-none">›</span></button>))}</div>}
      {!dbLoading && !dbResults.length && !dbErr && <div className="text-[12px] text-[#8A8A90] py-1">No database matches.</div>}
      {dbErr && <div className="text-[12px] text-[#F5C542] py-1">{dbErr}</div>}
    </>}
    <div className="mt-5">
      <div className="flex items-center gap-3 mb-2.5"><div className="flex-1 h-px" style={{ background: 'var(--border)' }} /><span className="text-[10px] uppercase tracking-widest text-[#8A8A90]">Can't find it?</span><div className="flex-1 h-px" style={{ background: 'var(--border)' }} /></div>
      {onAskAI && <button onClick={onAskAI} className="w-full flex items-center gap-3 bg-[#1E1E22] pixel-box p-3.5 text-left active:scale-[.99] transition mb-2">
        <div className="w-9 h-9 rounded-xl bg-[#F5C542]/15 flex items-center justify-center shrink-0"><PixelGlyph kind="sun" color={FAT} size={17} /></div>
        <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">Describe it to the AI</div><div className="text-[11px] text-[#8A8A90]">Estimate a meal from text, voice or a photo</div></div>
        <span className="text-[#8A8A90] shrink-0 text-lg leading-none">›</span>
      </button>}
      <button onClick={() => setManual(true)} className="w-full flex items-center gap-3 bg-[#1E1E22] pixel-box p-3.5 text-left active:scale-[.99] transition">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.05)' }}><Icon.plus width="18" height="18" style={{ color: 'var(--muted)' }} /></div>
        <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">Enter it manually</div><div className="text-[11px] text-[#8A8A90]">Type in the macros yourself</div></div>
        <span className="text-[#8A8A90] shrink-0 text-lg leading-none">›</span>
      </button>
    </div>
    {confirmDel && <ConfirmDialog title={'Delete "' + confirmDel.name + '"?'} body="This removes the saved meal. Food already logged from it stays in your diary." confirmLabel="Delete" onConfirm={() => delMeal(confirmDel.id)} onClose={() => setConfirmDel(null)} />}
    {qtyFor && <EditEntryModal title="How much this time?" saveLabel="Add to log" entry={{ name: qtyFor.name, qty_label: qtyFor.last_qty, computed_macros: qtyFor.macros }} onSave={(patch) => { onPick({ name: patch.name, source: qtyFor.source, is_alcohol: qtyFor.is_alcohol, alcohol_split: qtyFor.alcohol_split, macros: patch.macros, qtyLabel: patch.qty, amount: patch.amount, unit: patch.unit, unitNoun: patch.unit_noun }); setQtyFor(null); }} onClose={() => setQtyFor(null)} />}
  </div>);
}
// Store.uid() is Date.now().toString(36) + 5 random chars, so a log entry's id encodes the exact time
// it was added. Recover the local hour-of-day from it (null if it doesn't look like a real timestamp).
function hourFromId(id) {
  if (!id || id.length < 6) return null;
  const ts = parseInt(id.slice(0, -5), 36);
  if (!isFinite(ts) || ts < 1600000000000 || ts > 4000000000000) return null; // ~2020..2096 sanity window
  return new Date(ts).getHours();
}
// Fallback when there isn't enough history: match a meal by name for the time of day, else split the
// day's meals across morning/midday/evening/late by their order.
function timeDefaultMealId(meals, H) {
  const byName = (kw) => meals.find(m => new RegExp(kw, 'i').test(m.name || ''));
  let want;
  if (H >= 4 && H < 11) want = byName('break|morning|brunch');
  else if (H >= 11 && H < 15) want = byName('lunch|midday|noon');
  else if (H >= 15 && H < 18) want = byName('snack|after');
  else if (H >= 18 && H < 22) want = byName('dinner|evening|tea\\b|supper|main');
  else want = byName('snack|night|late|supper');
  if (want) return want.id;
  const n = meals.length; let idx;
  if (H >= 4 && H < 11) idx = 0;
  else if (H >= 11 && H < 16) idx = Math.min(1, n - 1);
  else if (H >= 16 && H < 22) idx = Math.min(2, n - 1);
  else idx = n - 1;
  return (meals[idx] || meals[0]).id;
}
// The meal you last logged to this sitting (in-memory, resets on reload). Lets a burst of adds all
// default to the same meal even if the clock would suggest another.
let LAST_MEAL = null;
function isWeekendISO(dateISO) { const d = weekdayIdx(dateISO); return d === 0 || d === 6; }
// Suggest which meal the food is probably for. Priority: the meal you were just adding to (within the
// last 45 min), then WHEN you usually log to each meal, weighting days of the same type (weekday vs
// weekend) more heavily so a lazy-weekend-breakfast pattern is respected; then a time-of-day fallback.
function suggestMealId(db, meals, now) {
  now = now || new Date();
  const H = now.getHours();
  const ids = new Set(meals.map(m => m.id));
  if (LAST_MEAL && (Date.now() - LAST_MEAL.t) < 45 * 60 * 1000 && ids.has(LAST_MEAL.id)) return LAST_MEAL.id;
  const weekendNow = now.getDay() === 0 || now.getDay() === 6;
  const cutoff = shiftISO(Store.todayISO(), -90);
  const counts = {}; // mealId -> { same:[24], other:[24] } split by matching day-type
  for (const e of (db.log_entries || [])) {
    if (!ids.has(e.meal_id) || e.date < cutoff) continue;
    const h = hourFromId(e.id); if (h == null) continue;
    const b = counts[e.meal_id] || (counts[e.meal_id] = { same: new Array(24).fill(0), other: new Array(24).fill(0) });
    (isWeekendISO(e.date) === weekendNow ? b.same : b.other)[h]++;
  }
  let best = null, bestScore = 0;
  for (const m of meals) {
    const c = counts[m.id]; if (!c) continue;
    let sc = 0; for (let d = -2; d <= 2; d++) { const hh = (H + d + 24) % 24, w = 3 - Math.abs(d); sc += c.same[hh] * w * 2 + c.other[hh] * w; }
    if (sc > bestScore) { bestScore = sc; best = m.id; }
  }
  return (bestScore > 0 && best) ? best : timeDefaultMealId(meals, H);
}
// The tab you last logged from, remembered for the session so repeat logging (e.g. barcode after
// barcode) doesn't reset to the Food tab every time.
let LAST_LOG_TAB = null;
function LogSheet({ db, update, meals, target, onAdd, onAddMeal, onClose, isPremium, aiCalls }) {
  useBackClose(onClose);
  const [isAlc, setIsAlc] = useState(!!target.alc);
  const [tab, setTabRaw] = useState(target.scan ? 'photo' : target.alc ? 'recent' : (['food', 'photo', 'describe'].includes(LAST_LOG_TAB) ? LAST_LOG_TAB : 'food'));
  const setTab = (t) => { setTabRaw(t); setScanNow(0); if (!isAlc) LAST_LOG_TAB = t; };
  // Bumping this signal tells PhotoTab to jump straight into the barcode scanner.
  const [scanNow, setScanNow] = useState(target.scan ? 1 : 0);
  const [mealId, setMealId] = useState(target.mealId || suggestMealId(db, meals) || meals[0].id);
  const tabs = isAlc ? [['recent', 'Recents'], ['manual', 'New drink'], ['photo', 'Scan'], ['describe', 'Estimate']] : [['food', 'Food'], ['photo', 'Scan'], ['describe', 'Estimate']];
  useEffect(() => { if (isAlc && tab === 'food') setTabRaw('recent'); if (!isAlc && (tab === 'recent' || tab === 'manual')) setTabRaw(['photo', 'describe'].includes(LAST_LOG_TAB) ? LAST_LOG_TAB : 'food'); }, [isAlc]);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box sheet-up flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-5 pb-3 flex-none">
          <div className="w-10 h-1 bg-[#262629] rounded-full mx-auto mb-4" />
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">Log {isAlc ? 'alcohol' : 'food'}</h2>
            <div className="flex items-center gap-4">
              <button onClick={() => { setTab('photo'); setScanNow(n => n + 1); }} className="hit text-[#8A8A90]" aria-label="Scan a barcode" title="Scan a barcode"><Icon.barcode width="20" height="20" /></button>
              <button onClick={onClose} className="hit text-[#8A8A90] text-2xl leading-none" aria-label="Close">×</button>
            </div>
          </div>
          <div className="mb-3"><Field label="Meal"><Dropdown value={mealId} onChange={setMealId} options={meals.map(m => ({ v: m.id, l: m.name }))} /></Field></div>
          <div className="mb-3"><Field label="Type"><Seg value={isAlc ? 'alc' : 'food'} onChange={v => setIsAlc(v === 'alc')} options={[{ v: 'food', l: <span className="inline-flex items-center justify-center gap-2"><PixelGlyph kind="plate" color="currentColor" size={15} /> Food</span> }, { v: 'alc', l: <span className="inline-flex items-center justify-center gap-2"><PixelGlyph kind="drink" color="currentColor" size={15} /> Alcohol</span> }]} /></Field></div>
          <div className="flex gap-1 bg-[#1E1E22] p-1 rounded-2xl">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2 px-0.5 text-[12px] transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}</button>)}</div>
        </div>
        <div className="px-5 pt-1 overflow-y-auto flex-1 min-h-0" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          {!isPremium && (tab === 'photo' || tab === 'describe') && (() => {
            const left = Math.max(0, FREE_AI_MONTHLY - (aiCalls || 0));
            return <button onClick={() => { try { window.MPAYWALL && window.MPAYWALL({ type: left > 0 ? 'manual' : 'free_limit' }); } catch (_) {} }} className="w-full text-left mb-2 px-3 py-2 pixel-box flex items-center justify-between gap-2" style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text)' }}>{left > 0 ? (left + ' of ' + FREE_AI_MONTHLY + ' free AI logs left this month') : 'No free AI logs left this month'}</span>
              <span className="pf text-[8px] uppercase shrink-0" style={{ color: 'var(--accent)' }}>Go unlimited ›</span>
            </button>;
          })()}
          {tab === 'food' && <FoodTab db={db} update={update} mealName={(meals.find(m => m.id === mealId) || {}).name} onPick={i => onAdd(mealId, i)} onLogMeal={items => onAddMeal(mealId, items)} onAskAI={() => setTab('describe')} />}
          {tab === 'recent' && <RecentTab db={db} update={update} isAlc={isAlc} mealName={(meals.find(m => m.id === mealId) || {}).name} onPick={i => onAdd(mealId, i)} />}
          {tab === 'describe' && <DescribeTab db={db} onPick={i => onAdd(mealId, isAlc ? Object.assign({}, i, { is_alcohol: true }) : i)} onScan={() => setTab('photo')} />}
          {tab === 'manual' && (isAlc ? <AlcoholTab onPick={i => onAdd(mealId, i)} /> : <ManualTab onPick={i => onAdd(mealId, i)} />)}
          {tab === 'photo' && <PhotoTab db={db} asAlcohol={isAlc} autoScan={scanNow} onPick={i => onAdd(mealId, i)} onAskAI={() => setTab('describe')} />}
        </div>
      </div>
    </div>
  );
}
function RecentTab({ db, update, isAlc, mealName, onPick }) {
  const [q, setQ] = useState('');
  const [qtyFor, setQtyFor] = useState(null); // tap the qty text on a row to adjust the amount before logging
  const foods = db.foods.filter(f => !!f.is_alcohol === isAlc).filter(f => !q || f.name.toLowerCase().includes(q.toLowerCase()));
  // How often each food has been logged overall, and how often into THIS meal (by meal name).
  const freq = useMemo(() => {
    const total = {}, perMeal = {}, cache = {};
    const nameOf = (date, mealId) => { const ms = cache[date] || (cache[date] = mealsForDay(db, date)); const m = ms.find(x => x.id === mealId); return m ? m.name : ''; };
    (db.log_entries || []).forEach(e => {
      const k = (e.name || '').toLowerCase(); if (!k) return;
      total[k] = (total[k] || 0) + 1;
      if (mealName && nameOf(e.date, e.meal_id) === mealName) perMeal[k] = (perMeal[k] || 0) + 1;
    });
    return { total, perMeal };
  }, [db.log_entries, mealName]);
  const score = (f) => { const k = f.name.toLowerCase(); return (freq.perMeal[k] || 0) * 100 + (freq.total[k] || 0); };
  const favs = foods.filter(f => f.is_favorite).sort((a, b) => b.updated_at - a.updated_at);
  const nonFav = foods.filter(f => !f.is_favorite);
  // Recent is smart-ranked: foods you usually eat for THIS meal float to the top, then your
  // overall most-logged, with recency breaking ties and filling the long tail. When searching,
  // fall back to plain recency so results feel predictable.
  const allRecents = nonFav.slice().sort((a, b) => q ? (b.updated_at - a.updated_at) : ((score(b) - score(a)) || (b.updated_at - a.updated_at)));
  const CAP = 25; const recents = q ? allRecents : allRecents.slice(0, CAP); const moreCount = q ? 0 : allRecents.length - recents.length;
  const star = (food) => update(d => { const x = d.foods.find(y => y.id === food.id); if (x) x.is_favorite = !x.is_favorite; });
  const pick = (f) => onPick({ name: f.name, source: f.source, is_alcohol: f.is_alcohol, macros: f.macros, alcohol_split: f.alcohol_split, qtyLabel: f.last_qty });
  const Row = (f) => (<div key={f.id} className="flex items-center justify-between bg-[#1E1E22] rounded-2xl px-3 py-2.5">
    <button onClick={() => pick(f)} className="text-left min-w-0 flex-1"><div className="text-sm truncate">{f.name}{f.last_qty ? <span onClick={ev => { ev.stopPropagation(); setQtyFor(f); }} className="text-[#8A8A90]" style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }} title="Adjust the amount"> · {f.last_qty}</span> : ''}</div><div className="text-[11px] text-[#8A8A90] tnum">{Math.round(f.macros.kcal)} kcal · P{f.macros.protein} C{f.macros.carbs} F{f.macros.fat}</div></button>
    <button onClick={() => star(f)} className="hit px-2 shrink-0" style={{ color: f.is_favorite ? FAT : '#3A3A42' }}><Icon.star width="18" height="18" fill="currentColor" /></button></div>);
  return (<div>
    <TextInput placeholder="Search your foods…" value={q} onChange={e => setQ(e.target.value)} />
    <div className="text-[11px] text-[#8A8A90] mt-2 mb-3">Tap any {isAlc ? 'drink' : 'food'} to add it again with the amount you had last time, or tap the underlined amount to change it first.</div>
    {!foods.length && <div className="text-center text-[#8A8A90] text-sm py-8"><div className="flex justify-center mb-3"><PixelDino size={40} color="var(--muted)" /></div>Nothing here yet. Anything you log shows up here so you can add it again in one tap.</div>}
    {favs.length > 0 && <><div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">Favourites</div><div className="space-y-2 mb-4">{favs.map(Row)}</div></>}
    {recents.length > 0 && <><div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">Recent</div><div className="space-y-2">{recents.map(Row)}</div>{moreCount > 0 && <div className="text-[11px] text-[#8A8A90] mt-3 text-center">+ {moreCount} more, type above to search all your foods.</div>}</>}
    {qtyFor && <EditEntryModal title="How much this time?" saveLabel="Add to log" entry={{ name: qtyFor.name, qty_label: qtyFor.last_qty, computed_macros: qtyFor.macros }} onSave={(patch) => { onPick({ name: patch.name, source: qtyFor.source, is_alcohol: qtyFor.is_alcohol, alcohol_split: qtyFor.alcohol_split, macros: patch.macros, qtyLabel: patch.qty, amount: patch.amount, unit: patch.unit, unitNoun: patch.unit_noun }); setQtyFor(null); }} onClose={() => setQtyFor(null)} />}
  </div>);
}
// Manual entry: capture the food's nutrition on a clear basis (per 100 g, or per serving), then hand
// off to the SAME confirm screen for the amount, so it scales exactly like a scan or a database hit.
function ManualTab({ onPick, onCancel }) {
  const [parsed, setParsed] = useState(null);
  const [v, setV] = useState({ name: '', protein: '', carbs: '', fat: '', fiber: '', kcal: '', basis: '100g', servG: '', servName: '' });
  const set = (k, x) => setV(p => Object.assign({}, p, { [k]: x }));
  const autoKcal = (+v.protein || 0) * 4 + (+v.carbs || 0) * 4 + (+v.fat || 0) * 9;
  function next() {
    if (!v.name.trim()) return;
    const macros = { kcal: Math.round(+v.kcal || autoKcal), protein: +v.protein || 0, carbs: +v.carbs || 0, fat: +v.fat || 0, fiber: +v.fiber || 0 };
    if (v.basis === '100g') setParsed({ per100: true, source: 'custom', branded: false, servingG: 0, servingLabel: null, initial: Object.assign({ name: v.name.trim() }, macros) });
    else { const sn = v.servName.trim(); const sgv = +v.servG || 0; setParsed({ perServing: macros, source: 'custom', branded: true, servingG: sgv, servingLabel: sn ? ('1 ' + sn) : (sgv ? ('1 serving (' + sgv + ' g)') : '1 serving'), initial: { name: v.name.trim() } }); }
  }
  if (parsed) return <ConfirmFood {...parsed} onAdd={onPick} onCancel={() => setParsed(null)} />;
  return (<div>
    {onCancel && <button onClick={onCancel} className="text-[13px] text-[#8A8A90] mb-3">‹ Back</button>}
    <Field label="Name"><TextInput value={v.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Baked beans" /></Field>
    <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">These numbers are per</div>
    <div className="mb-3"><Seg value={v.basis} onChange={x => set('basis', x)} options={[{ v: '100g', l: '100 g' }, { v: 'serving', l: 'A serving' }]} /></div>
    {v.basis === 'serving' && <div className="grid grid-cols-2 gap-2.5">
      <Field label="Serving weight (g)" hint="Optional, lets you also log by grams"><NumInput value={v.servG} onChange={e => set('servG', e.target.value)} placeholder="e.g. 125" /></Field>
      <Field label="Serving name" hint="e.g. pot, slice, biscuit"><TextInput value={v.servName} onChange={e => set('servName', e.target.value)} placeholder="serving" /></Field>
    </div>}
    <div className="grid grid-cols-3 gap-2.5"><Field label="Protein (g)"><NumInput value={v.protein} onChange={e => set('protein', e.target.value)} /></Field><Field label="Carbs (g)"><NumInput value={v.carbs} onChange={e => set('carbs', e.target.value)} /></Field><Field label="Fat (g)"><NumInput value={v.fat} onChange={e => set('fat', e.target.value)} /></Field></div>
    <div className="grid grid-cols-2 gap-2.5"><Field label="Fibre (g)"><NumInput value={v.fiber} onChange={e => set('fiber', e.target.value)} /></Field><Field label="Calories" hint="Auto from macros"><NumInput value={v.kcal} onChange={e => set('kcal', e.target.value)} placeholder={autoKcal ? String(autoKcal) : '0'} /></Field></div>
    <Btn kind="accent" className="w-full mt-1" disabled={!v.name.trim()} style={{ opacity: v.name.trim() ? 1 : 0.5 }} onClick={next}>Next: choose amount</Btn>
  </div>);
}
// Shared adaptive gram stepper: fine control at small amounts, bigger jumps as the number grows.
// Used by the entry editor, the scan/database confirm screen and the AI single-item confirm.
function gramStep(n) { return n < 25 ? 1 : n < 250 ? 5 : 10; }
// Pretty count for portion labels: 0.5 -> "½", 2 -> "2", 1.5 -> "1.5"
function fmtCount(n) {
  n = +n; if (!isFinite(n)) return '1';
  const r = Math.round(n * 100) / 100;
  const fr = { 0.25: '¼', 0.33: '⅓', 0.5: '½', 0.67: '⅔', 0.75: '¾' };
  if (fr[r]) return fr[r];
  if (Math.abs(r - 1 / 3) < 0.02) return '⅓';
  if (Math.abs(r - 2 / 3) < 0.02) return '⅔';
  return String(r);
}
// Natural portion phrase, e.g. "2 cans", "½ pack", "1 can (500 ml)", never "2 × 1 can".
function portionPhrase(count, servingLabel) {
  const cs = fmtCount(count);
  if (servingLabel && /^\s*\d/.test(servingLabel)) return servingLabel.replace(/^\s*\d+(?:\.\d+)?/, cs);
  if (servingLabel) return cs + ' ' + servingLabel;
  return cs + ' portion' + (+count > 1 ? 's' : '');
}
const PORTION_FRACTIONS = [['1/4', 0.25], ['1/3', 0.333], ['1/2', 0.5], ['2/3', 0.667], ['3/4', 0.75], ['1', 1], ['2', 2]];
function FractionChips({ value, onPick }) {
  return (<div className="flex gap-1.5 mb-3 flex-wrap">{PORTION_FRACTIONS.map(([l, val]) =>
    <button key={l} type="button" onClick={() => onPick(val)} className={`pixel-box px-2.5 py-1.5 text-[11px] ${Math.abs((+value || 0) - val) < 0.01 ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ boxShadow: 'none' }}>{l}</button>)}</div>);
}
// --- macro maths helpers for the confirm screen (one gram / one serving bases) ---
// Thin delegates to the tested quantity module (app/quantity.js), kept so existing call sites are unchanged.
function _macNums(v) { return Q.macNums(v); }
function _macScale(m, f) { return Q.macScale(m, f); }
function _macRound(m) { return Q.macRound(m); }
function ConfirmFood({ note, per100, source, initial, servingG, servingLabel, branded, perServing, estimated, onAdd, onCancel, onRescan, onAskAI, saved, barcode, badgeLabel, asAlcohol }) {
  useBackClose(onCancel);
  const basisIsServing = !!perServing;
  const base0 = perServing || { kcal: initial.kcal, protein: initial.protein, carbs: initial.carbs, fat: initial.fat, fiber: initial.fiber };
  const [v, setV] = useState({ name: initial.name || '', kcal: base0.kcal || '', protein: base0.protein || '', carbs: base0.carbs || '', fat: base0.fat || '', fiber: base0.fiber || '' });
  const set = (k, x) => setV(p => Object.assign({}, p, { [k]: x }));
  const [edit, setEdit] = useState(!!estimated);
  // Calories follow the macros by default (protein*4 + carbs*4 + fat*9), so a slip can't silently
  // inflate them, but stay editable: once you type your own calorie figure it sticks. Scanned/label
  // values come in pre-filled and are kept unless they run clearly higher than the macros justify.
  const [kcalTouched, setKcalTouched] = useState(false);
  const _atw = (o) => Math.round((+o.protein || 0) * 4 + (+o.carbs || 0) * 4 + (+o.fat || 0) * 9);
  const setMacro = (k, x) => setV(p => { const n = Object.assign({}, p, { [k]: x }); if (!kcalTouched) n.kcal = String(_atw(n)); return n; });
  const setKcal = (x) => { setKcalTouched(true); set('kcal', x); };
  const applyAtwater = () => { setKcalTouched(false); setV(p => Object.assign({}, p, { kcal: String(_atw(p)) })); };
  const sg = +servingG || 0;
  const m = _macNums(v);
  // Did the user change the food's nutrition from what came in? If so we remember it as a correction.
  const _b0 = _macNums(base0);
  const editedNums = Math.round(m.kcal) !== Math.round(_b0.kcal) || m.protein !== _b0.protein || m.carbs !== _b0.carbs || m.fat !== _b0.fat || m.fiber !== _b0.fiber;
  // AI-backup nudge for database/barcode entries: missing numbers, or calories that don't match macros.
  const _kc = m.kcal; const _dk = m.protein * 4 + m.carbs * 4 + m.fat * 9;
  const _missing = _kc <= 0 || (m.protein <= 0 && m.carbs <= 0 && m.fat <= 0);
  const _mismatch = _kc > 0 && _dk > 0 && Math.abs(_dk - _kc) / _kc > 0.3;
  const dodgy = (!!onRescan || !!onAskAI) && (_missing || _mismatch);
  // Calories run clearly higher than the macros can account for: the classic scan/entry-slip signature.
  // Skipped for alcohol (7 kcal/g) and when the dodgy card already covers it with scan/AI options.
  const atwaterK = Math.round(_dk);
  const kcalHigh = !dodgy && source !== 'alcohol' && !asAlcohol && _dk > 0 && _kc > _dk * 1.15 + 15;
  // Canonical bases (perGram = macros for one gram, perServMac = macros for one serving/piece),
  // derived by the tested quantity module so this scaling has regression coverage.
  const { perGram, perServMac } = Q.deriveBases({ per100: per100, basisIsServing: basisIsServing, sg: sg, m: m });
  const servNounRaw = (servingLabel || '').trim().replace(/^[\d.]+\s*/, '').toLowerCase();
  const servNoun = (!servNounRaw || /^(g|kg|mg|ml|cl|l|oz|fl oz|lb)$/.test(servNounRaw)) ? 'serving' : servNounRaw;
  const complexNoun = /[\s(]/.test(servNoun);
  const servNounPlural = complexNoun ? servNoun : servNoun + (/s$/.test(servNoun) ? '' : 's');
  const units = [];
  if (perServMac) units.push('serv');
  if (perGram) units.push('g');
  const defUnit = (perServMac && (branded || basisIsServing)) ? 'serv' : (perGram ? 'g' : 'serv');
  const gramDefault = sg || 100;
  const [unit, setUnit] = useState(defUnit);
  const [amount, setAmount] = useState(defUnit === 'g' ? gramDefault : 1);
  function chooseUnit(u) { if (u === unit) return; setUnit(u); setAmount(u === 'g' ? gramDefault : 1); }
  const a = +amount || 0;
  const r1 = (x) => Math.round(x * 100) / 100;
  const step = unit === 'g' ? gramStep(a) : 1;
  const stepBy = (d) => setAmount(String(Math.max(0, r1((+amount || 0) + d))));
  const final = _macRound(_macScale(unit === 'g' ? perGram : perServMac, a) || { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const qtyLabel = unit === 'g' ? (fmtCount(a) + ' g') : (complexNoun ? portionPhrase(a, servingLabel) : (fmtCount(a) + ' ' + (a === 1 ? servNoun : servNounPlural)));
  const implausible = final.kcal > 4000;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return (<div className="fade-in">
    <button onClick={onCancel} className="text-[13px] text-[#8A8A90] mb-2">‹ Back</button>
    {estimated
      ? <div className="pixel-box p-2.5 mb-3 text-[11px] leading-snug" style={{ background: 'var(--accent-dim)', boxShadow: 'none', borderColor: 'var(--fat)' }}><span className="pf text-[8px] mr-1.5" style={{ color: 'var(--fat)' }}>ESTIMATE</span>{note}</div>
      : saved
        ? <div className="pixel-box p-2.5 mb-3 text-[11px] leading-snug flex items-center gap-2" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: 'var(--good)' }}><span className="pf text-[8px] px-1.5 py-0.5 shrink-0" style={{ color: 'var(--good)', border: '1px solid var(--good)' }}>{badgeLabel || 'SAVED'}</span><span className="text-[#8A8A90]">{note}</span></div>
        : <div className="text-[12px] text-[#8A8A90] mb-3">{note}</div>}
    {dodgy && <div className="pixel-box p-3 mb-3" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: 'var(--fat)' }}>
      <div className="text-[12px] font-semibold mb-1">{_missing ? 'Some numbers are missing' : 'These numbers look off'}</div>
      <div className="text-[11px] text-[#8A8A90] leading-snug mb-2.5">{_missing ? "This came from the food database and doesn't have all the values." : "This came from the food database and the calories don't add up from the macros."} Get the real numbers a better way:</div>
      {onRescan && <Btn kind="accent" className="w-full" onClick={onRescan}>Scan the nutrition label</Btn>}
      {onAskAI && <button onClick={onAskAI} className="w-full text-[12px] mt-2 py-2 text-center rounded-xl border font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--accent)', background: 'var(--bg)' }}>Or describe it and let the AI work it out</button>}
    </div>}
    <Field label="Name"><TextInput value={v.name} onChange={e => set('name', e.target.value)} /></Field>
    <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">How much did you have?</div>
    {units.length > 1 && <div className="mb-2.5"><Seg value={unit} onChange={chooseUnit} options={units.map(u => ({ v: u, l: u === 'g' ? 'Grams' : cap(servNoun) }))} /></div>}
    <div className="flex items-center gap-2">
      <button onClick={() => stepBy(-step)} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="Less">−</button>
      <div className="flex-1"><NumInput value={amount} onChange={e => setAmount(e.target.value)} className={inputCls + ' text-center'} /></div>
      <button onClick={() => stepBy(step)} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="More">+</button>
      <div className="text-[12px] text-[#8A8A90] shrink-0 w-16 text-center">{unit === 'g' ? 'grams' : servNounPlural}</div>
    </div>
    <div className="pixel-box p-3 my-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
      <div className="text-[11px] text-[#8A8A90] mb-0.5">Logging {qtyLabel}</div>
      <div className="tnum"><span className="text-xl font-bold" style={{ color: 'var(--text)' }}>{final.kcal}</span> <span className="text-[12px] text-[#8A8A90]">kcal</span> · <span style={{ color: PRO }}>{final.protein}g P</span> · <span style={{ color: CARB }}>{final.carbs}g C</span> · <span style={{ color: FAT }}>{final.fat}g F</span></div>
      {implausible && <div className="text-[11px] mt-1.5" style={{ color: 'var(--fat)' }}>That is a very large amount, double-check the quantity.</div>}
    </div>
    <button onClick={() => setEdit(e => !e)} className="text-[11px] text-[#8A8A90] mb-2">{edit ? '▲ Hide the numbers' : '▾ Numbers look off? Edit them'}</button>
    {edit && <div className="fade-in mb-2">
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-1.5">{basisIsServing ? ('Per ' + servNoun) : (per100 ? 'Per 100 g' : 'Per serving')}</div>
      <div className="grid grid-cols-3 gap-2.5"><Field label="Protein (g)"><NumInput value={v.protein} onChange={e => setMacro('protein', e.target.value)} /></Field><Field label="Carbs (g)"><NumInput value={v.carbs} onChange={e => setMacro('carbs', e.target.value)} /></Field><Field label="Fat (g)"><NumInput value={v.fat} onChange={e => setMacro('fat', e.target.value)} /></Field></div>
      <div className="grid grid-cols-2 gap-2.5"><Field label="Fibre (g)"><NumInput value={v.fiber} onChange={e => setMacro('fiber', e.target.value)} /></Field><Field label="Calories" hint={kcalTouched ? 'Your own figure' : 'Auto from macros'}><NumInput value={v.kcal} onChange={e => setKcal(e.target.value)} /></Field></div>
      {_dk > 0 && kcalTouched && Math.round(_kc) !== atwaterK && <button type="button" onClick={applyAtwater} className="text-[11px] mt-1.5" style={{ color: 'var(--accent)' }}>↺ Calculate calories from the macros ({atwaterK} kcal)</button>}
    </div>}
    {(onRescan || onAskAI) && !dodgy && <div className="mt-4 mb-1">
      <div className="flex items-center gap-3 mb-2.5"><div className="flex-1 h-px" style={{ background: 'var(--border)' }} /><span className="text-[10px] uppercase tracking-widest text-[#8A8A90]">Not the right food?</span><div className="flex-1 h-px" style={{ background: 'var(--border)' }} /></div>
      {onRescan && <button onClick={onRescan} className="w-full flex items-center gap-3 bg-[#1E1E22] pixel-box p-3.5 text-left active:scale-[.99] transition mb-2">
        <div className="w-9 h-9 rounded-xl bg-[#4A9EEB]/15 flex items-center justify-center shrink-0"><Icon.cam width="18" height="18" style={{ color: CAL }} /></div>
        <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">Scan the label instead</div><div className="text-[11px] text-[#8A8A90]">Wrong product, or the numbers look off</div></div>
        <span className="text-[#8A8A90] shrink-0 text-lg leading-none">›</span>
      </button>}
      {onAskAI && <button onClick={onAskAI} className="w-full flex items-center gap-3 bg-[#1E1E22] pixel-box p-3.5 text-left active:scale-[.99] transition">
        <div className="w-9 h-9 rounded-xl bg-[#F5C542]/15 flex items-center justify-center shrink-0"><PixelGlyph kind="sun" color={FAT} size={17} /></div>
        <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">Describe it to the AI</div><div className="text-[11px] text-[#8A8A90]">Not packaged, or nothing to scan</div></div>
        <span className="text-[#8A8A90] shrink-0 text-lg leading-none">›</span>
      </button>}
    </div>}
    {kcalHigh && <div className="pixel-box p-3 mt-3 mb-2" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: 'var(--fat)' }}>
      <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--fat)' }}>Calories look high for these macros</div>
      <div className="text-[11px] text-[#8A8A90] leading-snug mb-2.5">This shows {Math.round(_kc)} kcal {basisIsServing ? ('per ' + servNoun) : (per100 ? 'per 100 g' : 'per serving')}, but the protein, carbs and fat only add up to about {atwaterK} kcal. That is usually a scan or entry slip, worth a quick check before you log it.</div>
      <Btn kind="accent" className="w-full" onClick={applyAtwater}>Use {atwaterK} kcal (from the macros)</Btn>
    </div>}
    <Btn kind={kcalHigh ? 'ghost' : 'accent'} className="w-full mt-3" disabled={a <= 0} style={{ opacity: a <= 0 ? 0.5 : 1 }} onClick={() => onAdd({ name: v.name || 'Food', source, qtyLabel, macros: final, unit, amount: a, unitNoun: unit === 'g' ? 'g' : servNoun, edited: editedNums || saved, baseMacros: { protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber, kcal: m.kcal }, baseKind: per100 ? 'per100' : 'serving', savedServingG: sg, savedServingLabel: servingLabel || '', barcode: barcode || null, is_alcohol: !!asAlcohol })}>{kcalHigh ? ('Log ' + final.kcal + ' kcal anyway') : 'Add to log'}</Btn>
  </div>);
}
function AiConfirm({ est, onAdd, onCancel, onRefine, busy }) {
  useBackClose(onCancel);
  const src = est || {};
  const [name, setName] = useState(src.name || 'Meal (AI estimate)');
  const [fix, setFix] = useState('');
  const conf = src.confidence || 'medium';
  // If the user gave an explicit weight in their description (e.g. "225g of chicken"), the estimator
  // pins that item's grams; open the breakdown by default so they see it carried through and can edit it.
  const anyStated = (src.items || []).some(it => it.user_specified);
  const [edit, setEdit] = useState(conf === 'low' || anyStated);
  const [portion, setPortion] = useState('1');
  const [items, setItems] = useState(() => (src.items || []).map(it => {
    const grams = +it.grams || 0;
    const kcal = +it.kcal || 0, protein = +it.protein_g || 0, carbs = +it.carbs_g || 0, fat = +it.fat_g || 0, fiber = +it.fiber_g || 0;
    return { name: it.name || 'Item', grams: grams, kcal: kcal, protein: protein, carbs: carbs, fat: fat, fiber: fiber, assumption: it.assumption || '', userSpecified: !!it.user_specified, per: grams > 0 ? { kcal: kcal / grams, protein: protein / grams, carbs: carbs / grams, fat: fat / grams, fiber: fiber / grams } : null };
  }));
  function setGrams(i, val) {
    setItems(arr => arr.map((it, idx) => {
      if (idx !== i) return it;
      if (val === '') return Object.assign({}, it, { grams: '' });
      const g = +val;
      if (it.per && !isNaN(g)) return Object.assign({}, it, { grams: g, kcal: Math.round(it.per.kcal * g), protein: +(it.per.protein * g).toFixed(1), carbs: +(it.per.carbs * g).toFixed(1), fat: +(it.per.fat * g).toFixed(1), fiber: +(it.per.fiber * g).toFixed(1) });
      return Object.assign({}, it, { grams: g });
    }));
  }
  function removeItem(i) { setItems(arr => arr.filter((_, idx) => idx !== i)); }
  // Base total = the full meal the AI estimated (summed live from the possibly-edited breakdown, so
  // removing a glass of wine you didn't drink updates it). The portion multiplier on top says how
  // much of that meal you actually ate, mirroring the scan screen's amount control.
  const hadItems = (src.items || []).length > 0;
  // A one-food estimate (e.g. "tandoori roti") logs like a normal by-grams food: the item's grams are
  // the editable quantity that carries straight through to the log, instead of a "× meal" multiplier.
  const single = (src.items || []).length === 1;
  const only = single ? items[0] : null;
  const gStep = gramStep; // shared adaptive stepper
  const base = hadItems
    ? items.reduce((a, it) => ({ kcal: a.kcal + (+it.kcal || 0), protein: a.protein + (+it.protein || 0), carbs: a.carbs + (+it.carbs || 0), fat: a.fat + (+it.fat || 0), fiber: a.fiber + (+it.fiber || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })
    : { kcal: +src.kcal || 0, protein: +src.protein_g || 0, carbs: +src.carbs_g || 0, fat: +src.fat_g || 0, fiber: +src.fiber_g || 0 };
  const p = Math.max(0, +portion || 0);
  const final = { kcal: Math.round(base.kcal * p), protein: +(base.protein * p).toFixed(1), carbs: +(base.carbs * p).toFixed(1), fat: +(base.fat * p).toFixed(1), fiber: +(base.fiber * p).toFixed(1) };
  const confColor = conf === 'high' ? 'var(--good)' : conf === 'medium' ? 'var(--fat)' : 'var(--danger)';
  const low = Math.round((+src.kcal_low || 0) * p), high = Math.round((+src.kcal_high || 0) * p);
  const implausible = final.kcal > 4000;
  // Same guard as the scan/database confirm screen: flag when the total calories run clearly higher
  // than the macros account for. The fix here is to tweak an item or ask the AI to redo it.
  const atwT = Math.round(final.protein * 4 + final.carbs * 4 + final.fat * 9);
  const kcalHigh = final.kcal > 0 && atwT > 0 && final.kcal > atwT * 1.15 + 25;
  const stepP = (d) => setPortion(String(Math.max(0, Math.round(((+portion || 0) + d) * 100) / 100)));
  const portionLabel = single ? (fmtCount(+(only && only.grams) || 0) + ' g') : (p === 1 ? 'the whole meal' : (fmtCount(p) + ' of the meal'));
  const qtyLabel = p === 1 ? '' : (fmtCount(p) + ' portion');
  return (<div className="fade-in">
    <button onClick={onCancel} className="text-[13px] text-[#8A8A90] mb-2">‹ Start over</button>
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="text-[12px] text-[#8A8A90] leading-snug">Here's what I think you ate. Set how much you had, then log it.</div>
      <span className="text-[8px] px-2 py-1 rounded-md shrink-0" style={{ color: confColor, border: '1px solid ' + confColor }}>{conf.toUpperCase()}</span>
    </div>
    <Field label="Name"><TextInput value={name} onChange={e => setName(e.target.value)} /></Field>
    <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">How much did you have?</div>
    {single ? <div className="flex items-center gap-2">
      <button onClick={() => setGrams(0, String(Math.max(0, (+only.grams || 0) - gStep(+only.grams || 0))))} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="Less">−</button>
      <div className="flex-1"><NumInput value={only.grams} onChange={e => setGrams(0, e.target.value)} className={inputCls + ' text-center'} /></div>
      <button onClick={() => setGrams(0, String((+only.grams || 0) + gStep(+only.grams || 0)))} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="More">+</button>
      <div className="text-[12px] text-[#8A8A90] shrink-0 w-16 text-center">grams</div>
    </div> : <div className="flex items-center gap-2">
      <button onClick={() => stepP(-0.25)} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="Less">−</button>
      <div className="flex-1"><NumInput value={portion} onChange={e => setPortion(e.target.value)} className={inputCls + ' text-center'} /></div>
      <button onClick={() => stepP(0.25)} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="More">+</button>
      <div className="text-[12px] text-[#8A8A90] shrink-0 w-16 text-center">× meal</div>
    </div>}
    <div className="pixel-box p-3 my-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
      <div className="text-[11px] text-[#8A8A90] mb-0.5">Logging {portionLabel}</div>
      <div className="tnum"><span className="text-xl font-bold" style={{ color: 'var(--text)' }}>{final.kcal}</span> <span className="text-[12px] text-[#8A8A90]">kcal</span> · <span style={{ color: PRO }}>{final.protein}g P</span> · <span style={{ color: CARB }}>{final.carbs}g C</span> · <span style={{ color: FAT }}>{final.fat}g F</span></div>
      {implausible && <div className="text-[11px] mt-1.5" style={{ color: 'var(--fat)' }}>That is a very large amount, double-check the portion.</div>}
      {final.kcal <= 0 && <div className="text-[11px] mt-1.5" style={{ color: 'var(--danger)' }}>The AI couldn't read the calories. Tell it what to fix below, or start over.</div>}
    </div>
    {high > low && low > 0 && <div className="text-[11px] mb-2" style={{ color: 'var(--muted)' }}>Honest range: {low}–{high} kcal. Logging your total, no sugar-coating.</div>}
    {src.assumptions && <div className="text-[11px] text-[#8A8A90] mb-2 leading-relaxed">Assumed: {src.assumptions}</div>}
    {hadItems && !single && <button onClick={() => setEdit(e => !e)} className="text-[11px] text-[#8A8A90] mb-2">{edit ? '▲ Hide the breakdown' : '▾ Adjust the breakdown, item by item'}</button>}
    {hadItems && !single && edit && <div className="fade-in space-y-2 mb-3">
      <div className="text-[10px] text-[#8A8A90] leading-snug">These are the amounts for the full meal. Edit the grams, or remove anything you didn't have.</div>
      {items.map((it, i) => (
        <div key={i} className="bg-[#1E1E22] rounded-2xl p-3 border border-[#262629]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><div className="text-[13px] truncate">{it.name}{it.userSpecified && <span className="ml-1.5 text-[8px] px-1 py-0.5 rounded" style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}>YOU SAID</span>}</div><div className="text-[10px] text-[#8A8A90] tnum">{Math.round(it.kcal)} kcal · P{it.protein} C{it.carbs} F{it.fat}</div></div>
            <input type="number" inputMode="decimal" value={it.grams} onChange={e => setGrams(i, e.target.value)} className="w-16 bg-[#0F0F12] rounded-lg border border-[#262629] px-2 py-1.5 text-[12px] text-[var(--text)] text-right" /><span className="text-[10px] text-[#8A8A90]">g</span>
            <button onClick={() => removeItem(i)} className="text-[#8A8A90] pl-1 text-lg leading-none shrink-0" aria-label={`Remove ${it.name}`}>×</button>
          </div>
          {it.assumption && <div className="text-[10px] text-[#8A8A90] mt-1 leading-snug">↳ {it.assumption}</div>}
        </div>))}
      {items.length === 0 && <div className="text-[11px] text-[#8A8A90] py-1">All items removed. Tell the AI what to fix below, or start over.</div>}
    </div>}
    {onRefine && <div className="rounded-2xl p-3 mb-3 border border-[#262629]" style={{ background: 'var(--surface3)' }}>
      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Not quite right? Tell the AI what to fix</div>
      <textarea value={fix} onChange={e => setFix(e.target.value)} rows={2} className={inputCls + ' resize-y leading-relaxed'} placeholder="e.g. it was a large, extra cheese, no chips" />
      <Btn kind="ghost" className="w-full mt-2" disabled={busy || !fix.trim()} style={{ opacity: (busy || !fix.trim()) ? 0.5 : 1 }} onClick={() => onRefine(fix.trim())}>{busy ? 'Re-estimating…' : 'Re-estimate with this'}</Btn>
    </div>}
    {kcalHigh && <div className="pixel-box p-3 mb-2" style={{ background: 'var(--surface3)', boxShadow: 'none', borderColor: 'var(--fat)' }}>
      <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--fat)' }}>Calories look high for these macros</div>
      <div className="text-[11px] text-[#8A8A90] leading-snug">This totals {final.kcal} kcal, but the protein, carbs and fat only add up to about {atwT} kcal. If that is not right, tweak an item above or use "Tell the AI what to fix".</div>
    </div>}
    <Btn kind={kcalHigh ? 'ghost' : 'accent'} className="w-full" disabled={final.kcal <= 0} style={{ opacity: final.kcal <= 0 ? 0.5 : 1 }} onClick={() => { if (final.kcal <= 0) return; const remember = items.filter(it => (+it.grams) > 0 && (+it.kcal) > 0).map(it => ({ name: it.name, grams: +it.grams, kcal: +it.kcal, protein: +it.protein || 0, carbs: +it.carbs || 0, fat: +it.fat || 0, fiber: +it.fiber || 0 })); if (single) { const g = +only.grams || 0; onAdd({ name: name || only.name || 'Food', source: 'ai_estimate', qtyLabel: g > 0 ? fmtCount(g) + ' g' : '', macros: final, unit: 'g', amount: g, unitNoun: 'g', rememberItems: remember }); } else { onAdd({ name: name || 'Meal', source: 'ai_estimate', qtyLabel: qtyLabel, macros: final, rememberItems: remember }); } }}>{kcalHigh ? ('Log ' + final.kcal + ' kcal anyway') : 'Add to log'}</Btn>
  </div>);
}
// Text/voice logging: describe a meal or named order in words → Sonnet estimates the macros (with
// UK chain anchoring, ideal for a "grande oat caramel macchiato") → the shared AiConfirm sheet.
function DescribeTab({ db, onPick, onScan }) {
  const key = db.profile.aiKey || 'builtin';
  const [text, setText] = useState('');
  const [imgs, setImgs] = useState([]); const MAX_PHOTOS = 3;
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [result, setResult] = useState(null); const [ver, setVer] = useState(0);
  const [listening, setListening] = useState(false); const [cam, setCam] = useState(false); const [pushText, setPushText] = useState(false);
  const recRef = useRef(null); const taRef = useRef(null);
  function addHint(w) { setText(t => (t.trim() ? t.trim() + ', ' + w : w)); setPushText(false); if (taRef.current) taRef.current.focus(); }
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  function addImgs(list) { const arr = Array.from(list || []).map(f => ({ id: Store.uid(), file: f, url: URL.createObjectURL(f) })); setImgs(x => x.concat(arr).slice(0, MAX_PHOTOS)); }
  function remImg(id) { setImgs(x => x.filter(f => f.id !== id)); }
  function stopMic() { try { recRef.current && recRef.current.stop(); } catch (e) {} setListening(false); }
  function toggleMic() {
    if (!SR) return;
    if (listening) { stopMic(); return; }
    let r; try { r = new SR(); } catch (e) { return; }
    recRef.current = r; r.lang = 'en-GB'; r.interimResults = true; r.continuous = false;
    const base = text.trim() ? text.trim() + ' ' : '';
    r.onresult = (e) => { let s = ''; for (let i = e.resultIndex; i < e.results.length; i++) s += e.results[i][0].transcript; setText(base + s); };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    setListening(true); try { r.start(); } catch (e) { setListening(false); }
  }
  const ctx = () => 'Context: food or drink consumed in England.' + (imgs.length ? ' Photos of the food and/or menu are attached.' : '') + ' If a UK chain is named (e.g. Starbucks, Costa, Caffè Nero, Pret, Greggs, McDonald\'s, Nando\'s, Wagamama, Wetherspoons), anchor to that chain\'s PUBLISHED nutrition for the named item(s), adjusting for size and add-ons (syrups, milk type, extra shots, sides).' + (text.trim() ? ' Description: "' + text.trim() + '"' : '');
  async function run() {
    if (!text.trim() && !imgs.length) { setErr('Describe what you had, or add a photo.'); return; }
    // Soft gate: a photo with no words is much less accurate, so nudge for a description first.
    // If they still want to go photo-only, a second tap ("Estimate from the photo anyway") proceeds.
    if (imgs.length && !text.trim() && !pushText) { setPushText(true); setErr(''); if (taRef.current) taRef.current.focus(); return; }
    if (listening) stopMic();
    setBusy(true); setErr('');
    try {
      const est = await claudeVision(key, imgs.map(i => i.file), AI_PROMPT + '\n\n' + ctx(), { model: AI_MODEL, maxTokens: 2048, maxImg: 768 });
      setResult(est); setVer(v => v + 1);
    } catch (e) { setErr('Estimate failed: ' + e.message); }
    setBusy(false);
  }
  async function refine(correction) {
    setBusy(true); setErr('');
    try {
      const prompt = 'Revise this meal estimate (consumed in England).' + (imgs.length ? ' Photos are attached.' : '') + ' Previous estimate JSON: ' + JSON.stringify(result) + (text.trim() ? '\nOriginal description: "' + text.trim() + '"' : '') + '\nThe user says: "' + correction + '". Return the SAME JSON structure, adjusted. Keep totals equal to the sum of items, stay honest and do not round down. Keep any weights the user explicitly stated fixed at their stated grams (user_specified true) unless they now change them. Respond ONLY with the JSON.';
      const est = await claudeVision(key, imgs.map(i => i.file), prompt, { model: AI_MODEL, maxTokens: 2048, maxImg: 768 });
      setResult(est); setVer(v => v + 1);
    } catch (e) { setErr('Re-estimate failed: ' + e.message); }
    setBusy(false);
  }
  if (result) return (<div className="fade-in"><AiConfirm key={ver} est={result} busy={busy} onRefine={refine} onAdd={onPick} onCancel={() => setResult(null)} />{err && <div className="text-[12px] text-[#F5C542] mt-3">{err}</div>}</div>);
  if (cam) return <MealCamera onFiles={fs => { addImgs(fs); setCam(false); }} onClose={() => setCam(false)} />;
  if (busy) return <DinoLoader label="Working out your meal" />;
  return (<div>
    <div className="text-[12px] text-[#8A8A90] mb-3">Type, say or snap what you had. A photo plus a few words is most accurate: it catches portions, oils and extras. You confirm before anything's logged.</div>
    {onScan && <div className="flex items-center justify-between gap-2 rounded-2xl p-3 mb-3 border border-[#262629]" style={{ background: 'var(--surface3)' }}>
      <div className="text-[11px] text-[#8A8A90] leading-snug">Packaged, with a barcode or label? Scanning it is more accurate.</div>
      <button onClick={onScan} className="text-[11px] font-semibold shrink-0 px-2.5 py-1.5 rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}>Scan instead</button>
    </div>}
    <textarea ref={taRef} value={text} onChange={e => { setText(e.target.value); if (e.target.value.trim()) setPushText(false); }} rows={3} className={inputCls + ' resize-y leading-relaxed'} placeholder={imgs.length ? 'Add a few words for a sharper estimate: how big it was, how it was cooked, oil or butter, sauces, the brand, and how much you ate' : 'e.g. Starbucks grande oat milk caramel macchiato and a butter croissant'} />
    {listening && <div className="text-[11px] mt-1.5 flex items-center gap-1.5" style={{ color: FAT }}><span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: FAT }} />Listening… tap the mic again to stop.</div>}
    {imgs.length > 0 && <div className="flex gap-2 flex-wrap mt-3">{imgs.map(i => (<div key={i.id} className="relative"><img src={i.url} className="w-16 h-16 object-cover rounded-xl border border-[#262629]" /><button onClick={() => remImg(i.id)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-[#262629] text-white text-xs leading-none">×</button></div>))}</div>}
    {imgs.length < MAX_PHOTOS && <button onClick={() => setCam(true)} className="w-full flex items-center justify-center gap-2 mt-3 pixel-btn py-3 text-[13px] font-medium" style={{ background: 'var(--surface3)', color: 'var(--text)', border: '1px solid var(--border)' }}><Icon.cam width="18" height="18" /> {imgs.length ? 'Add another photo' : 'Take or upload a photo'}</button>}
    {imgs.length > 0 && !text.trim() && <div className="rounded-2xl p-3 mt-3" style={{ background: pushText ? 'var(--accent-dim)' : 'var(--surface3)', border: '1px solid ' + (pushText ? 'var(--fat)' : 'var(--border)') }}>
      <div className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text)' }}>{pushText ? 'Add a few words first, it really helps' : 'A quick description makes this far more accurate'}</div>
      <div className="text-[11px] text-[#8A8A90] leading-snug mb-2.5">A photo alone can't see portion size, cooking oils or hidden extras. Tap to add detail, or type your own:</div>
      <div className="flex gap-1.5 flex-wrap">{['Large portion', 'Small portion', 'Ate half', 'Homemade', 'Fried in oil', 'Extra cheese', 'With sauce'].map(w => <button key={w} type="button" onClick={() => addHint(w)} className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>+ {w}</button>)}</div>
    </div>}
    <div className="flex items-stretch gap-2 mt-3">
      {SR && <button type="button" onClick={toggleMic} aria-label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={listening} title={listening ? 'Stop dictation' : 'Dictate'} className="pixel-btn shrink-0 w-14 flex items-center justify-center transition active:scale-95" style={{ background: listening ? FAT : 'var(--surface3)', color: listening ? '#fff' : 'var(--text)', border: '1px solid var(--border)' }}><Icon.mic width="20" height="20" /></button>}
      <Btn kind="accent" className="flex-1" onClick={run}>{imgs.length && !text.trim() && pushText ? 'Estimate from the photo anyway' : 'Estimate with AI'}</Btn>
    </div>
    {err && <div className="text-[12px] text-[#F5C542] mt-3 fade-in">{err}</div>}
  </div>);
}
const MEAL_SOURCES = [{ v: 'home', l: 'Home-cooked' }, { v: 'restaurant', l: 'Restaurant' }, { v: 'takeaway', l: 'Takeaway' }];
function MealEstimate({ apiKey, onPick, onBack, initialFiles }) {
  const [imgs, setImgs] = useState(() => (initialFiles || []).slice(0, 3).map(f => ({ id: Store.uid(), file: f, url: URL.createObjectURL(f) }))); // { id, file, url }
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [result, setResult] = useState(null); const [ver, setVer] = useState(0);
  const MAX_PHOTOS = 3;
  function addImgs(list) { const arr = Array.from(list || []).map(f => ({ id: Store.uid(), file: f, url: URL.createObjectURL(f) })); setImgs(x => x.concat(arr).slice(0, MAX_PHOTOS)); }
  function remove(id) { setImgs(x => x.filter(f => f.id !== id)); }
  function ctx() { return 'Context: a meal eaten in England. If the notes name a UK restaurant or chain, anchor to that chain\'s published nutrition.' + (notes.trim() ? ' Notes: ' + notes.trim() : ''); }
  async function run() {
    if (!imgs.length && !notes.trim()) { setErr('Add a food photo, a menu photo, or a description.'); return; }
    setBusy(true); setErr('');
    try { const est = await claudeVision(apiKey, imgs.map(i => i.file), AI_PROMPT + '\n\n' + ctx(), { model: AI_MODEL, maxTokens: 2048, maxImg: 768 }); setResult(est); setVer(v => v + 1); }
    catch (e) { setErr('Estimate failed: ' + e.message); }
    setBusy(false);
  }
  async function refine(correction) {
    setBusy(true); setErr('');
    try {
      // Slim refine: the previous JSON already carries the schema, so we skip resending the full estimator prompt.
      const prompt = 'Revise this meal estimate. ' + ctx() + '\nPrevious estimate JSON: ' + JSON.stringify(result) + '\nThe user says: "' + correction + '". Return the SAME JSON structure, adjusted to reflect their correction. Keep totals equal to the sum of items, stay honest and do not round down. Keep any weights the user explicitly stated fixed at their stated grams (user_specified true) unless they now change them. Respond ONLY with the JSON.';
      const est = await claudeVision(apiKey, imgs.map(i => i.file), prompt, { model: AI_MODEL, maxTokens: 2048, maxImg: 768 }); setResult(est); setVer(v => v + 1);
    } catch (e) { setErr('Re-estimate failed: ' + e.message); }
    setBusy(false);
  }
  if (result) return (<div className="fade-in"><AiConfirm key={ver} est={result} busy={busy} onRefine={refine} onAdd={onPick} onCancel={() => setResult(null)} />{err && <div className="text-[12px] text-[#F5C542] mt-3">{err}</div>}</div>);
  if (busy) return <DinoLoader label="Estimating your meal" />;
  return (<div className="fade-in">
    <button onClick={onBack} className="text-[13px] text-[#8A8A90] mb-3">‹ Back</button>
    <div className="text-[12px] text-[#8A8A90] mb-3">Add a photo of the food or menu, plus any notes. The AI proposes what you ate, then you confirm or correct it. For a known chain it anchors to their published nutrition.</div>
    <div className="mb-1"><PhotoButton label="Add photos" multiple onFiles={addImgs} className="w-full" /></div>
    <div className="text-[10px] text-[#8A8A90] mb-3">Add your food and/or the menu (up to 3 photos), take a new photo or choose from your library.</div>
    {imgs.length > 0 && <div className="flex gap-2 flex-wrap mb-3">{imgs.map(i => (<div key={i.id} className="relative"><img src={i.url} className="w-16 h-16 object-cover rounded-xl border border-[#262629]" /><button onClick={() => remove(i.id)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-[#262629] text-white text-xs leading-none">×</button></div>))}</div>}
    <Field label="Notes (optional)" hint="Name the place or dish for the best guess, plus size, sides and sauces.">
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} className={inputCls + ' resize-y leading-relaxed'} style={{ minHeight: 120 }} placeholder="e.g. Nando's, half chicken, medium, peri chips and coleslaw, ate it all" />
    </Field>
    <Btn kind="accent" className="w-full" onClick={run}>{busy ? 'Estimating…' : 'Estimate with AI'}</Btn>
    {err && <div className="text-[12px] text-[#F5C542] mt-3 fade-in">{err}</div>}
  </div>);
}
// Load an external UMD script once, resolving when its global is present. Used to lazy-load the barcode
// scanner library only when someone actually scans, so it never slows the normal app load.
function loadExternalScript(src, globalName) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) return resolve();
    let s = document.querySelector('script[data-src="' + src + '"]');
    if (!s) { s = document.createElement('script'); s.src = src; s.async = true; s.setAttribute('data-src', src); document.head.appendChild(s); }
    s.addEventListener('load', () => (window[globalName] ? resolve() : reject(new Error('missing global'))));
    s.addEventListener('error', () => reject(new Error('script load failed')));
    if (window[globalName]) resolve();
  });
}
// Barcode scanning uses the standard BarcodeDetector API. Android/Chrome have it natively (fast). iOS
// Safari does not, so we polyfill it with a WebAssembly build of ZBar (near-native and reliable for
// EAN/UPC), dynamically imported from the CDN only when needed; the polyfill self-loads its WASM engine.
// Verified decoding real EAN-13/UPC barcodes. The import() is wrapped in Function() so the build step
// leaves it untouched, since the app ships as a classic (non-module) script.
const BARCODE_POLYFILL_ESM = 'https://cdn.jsdelivr.net/npm/@undecaf/barcode-detector-polyfill@0.9.23/dist/main.js';
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
async function ensureBarcodeDetector() {
  if (window.BarcodeDetector) return; // native, e.g. Android Chrome
  const importESM = new Function('u', 'return import(u)');
  const mod = await importESM(BARCODE_POLYFILL_ESM);
  if (!window.BarcodeDetector && mod && mod.BarcodeDetectorPolyfill) window.BarcodeDetector = mod.BarcodeDetectorPolyfill;
}
function LiveScanner({ onFound, onClose }) {
  useBackClose(onClose); // back dismisses the camera, not the whole sheet
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const stoppedRef = useRef(false); const streamRef = useRef(null); const detectorRef = useRef(null); const timerRef = useRef(null);
  useEffect(() => {
    stoppedRef.current = false;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErr('This browser cannot open the camera. Scan the label with a photo, or search for the food instead.'); return;
      }
      try {
        await ensureBarcodeDetector();
        if (stoppedRef.current) return;
        if (!window.BarcodeDetector) throw new Error('no barcode detector');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (stoppedRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream; await videoRef.current.play();
        detectorRef.current = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
        let inFlight = false;
        const tick = async () => {
          if (stoppedRef.current) return;
          const v = videoRef.current;
          if (!inFlight && v && v.readyState >= 2 && v.videoWidth) {
            inFlight = true;
            try { const codes = await detectorRef.current.detect(v); if (codes && codes.length && !stoppedRef.current) { stoppedRef.current = true; onFound(codes[0].rawValue); return; } } catch (e) {}
            inFlight = false;
          }
          timerRef.current = setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        setErr('Could not start the camera. Allow camera access, or scan the label with a photo, or search instead.');
      }
    })();
    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      const st = streamRef.current; if (st) { try { st.getTracks().forEach(t => t.stop()); } catch (e) {} }
    };
  }, []);
  // Manual trigger: decode the current frame on demand, for when the continuous loop has not caught it.
  async function captureAndDecode() {
    if (busy || stoppedRef.current || !detectorRef.current) return;
    const v = videoRef.current; if (!v || !v.videoWidth) { setMsg('Camera is still starting, give it a second.'); return; }
    setBusy(true); setMsg('Reading the barcode…');
    try {
      const codes = await detectorRef.current.detect(v);
      if (codes && codes.length && !stoppedRef.current) { stoppedRef.current = true; onFound(codes[0].rawValue); return; }
      setMsg('Did not catch it. Fill the box with the barcode, hold steady, and tap again.');
    } catch (e) { setMsg('Did not catch it. Get a bit closer and tap again.'); }
    setBusy(false);
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex justify-between items-center px-4 pb-3 text-white" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.9rem)' }}><span className="font-semibold">Scan barcode</span><button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-2xl leading-none" style={{ background: 'rgba(255,255,255,0.18)' }}>×</button></div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
        {!err && <div className="absolute" style={{ width: '78%', maxWidth: '340px', height: '150px', border: '3px solid rgba(255,255,255,0.75)' }} />}
        {err && <div className="absolute inset-x-6 text-center text-[#F5C542] text-sm">{err}</div>}
      </div>
      <div className="px-4 pt-3 flex flex-col items-center gap-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
        {!err && <button onClick={captureAndDecode} disabled={busy} className="w-16 h-16 rounded-full bg-white active:scale-95 disabled:opacity-50" style={{ boxShadow: '0 0 0 4px rgba(255,255,255,0.35)' }} aria-label="Scan now" />}
        <div className="text-white/70 text-[12px] text-center leading-snug">{err ? '' : (msg || "Line up the barcode. It scans on its own, or tap the button to grab it.")}</div>
        <button onClick={onClose} className="text-white/90 text-[13px] mt-1 px-4 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.14)' }}>Cancel</button>
      </div>
    </div>
  );
}
// Live in-app camera capture for nutrition labels, mirrors the barcode scanner, but grabs a still
// frame on tap and hands it to the AI. Falls back to an upload for desktop / no-camera.
function LabelScanner({ onCapture, onClose }) {
  useBackClose(onClose); // back dismisses the camera, not the whole sheet
  const videoRef = useRef(null); const [err, setErr] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream, stopped = false;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setErr('nocam'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream; await videoRef.current.play(); setReady(true);
      } catch (e) { setErr('blocked'); }
    })();
    return () => { stopped = true; if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);
  function capture() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => { if (b) onCapture(new File([b], 'label.jpg', { type: 'image/jpeg' })); }, 'image/jpeg', 0.9);
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex justify-between items-center px-4 pb-3 text-white" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.9rem)' }}><div><div className="font-semibold leading-tight">Scan nutrition label</div><div className="text-[11px] text-white/60">We'll read the exact numbers off the pack</div></div><button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-2xl leading-none" style={{ background: 'rgba(255,255,255,0.18)' }}>×</button></div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {ready && !err && <div className="absolute inset-x-8 h-56 border-2 border-white/70 rounded-xl" />}
        {err && <div className="absolute inset-x-8 text-center text-white/90 text-sm">Camera unavailable here, upload a photo of the label instead.</div>}
      </div>
      <div className="p-5 flex flex-col items-center gap-3">
        {!err && <button onClick={capture} disabled={!ready} className="w-16 h-16 rounded-full bg-white active:scale-95 disabled:opacity-40" style={{ boxShadow: '0 0 0 4px rgba(255,255,255,0.35)' }} aria-label="Capture" />}
        {!err && <div className="text-white/60 text-[12px]">Line up the nutrition label, then tap to capture. It reads the exact figures.</div>}
        <label className="text-white/80 text-[13px] underline cursor-pointer">Upload a photo instead<input type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files[0]) onCapture(e.target.files[0]); }} /></label>
        <button onClick={onClose} className="text-white/90 text-[13px] mt-1 px-4 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.14)' }}>Cancel</button>
      </div>
    </div>
  );
}
// Custom in-app camera for the Estimate tab: a live viewfinder to snap a plated meal, with an
// on-screen "upload instead" option, matching the nutrition-label scanner. Returns File(s) via onFiles.
function MealCamera({ onFiles, onClose }) {
  useBackClose(onClose); // back dismisses the camera, not the whole sheet
  const videoRef = useRef(null); const [err, setErr] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => {
    let stream, stopped = false;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setErr('nocam'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream; await videoRef.current.play(); setReady(true);
      } catch (e) { setErr('blocked'); }
    })();
    return () => { stopped = true; if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);
  function capture() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => { if (b) onFiles([new File([b], 'meal.jpg', { type: 'image/jpeg' })]); }, 'image/jpeg', 0.9);
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      <div className="flex justify-between items-center px-4 pb-3 text-white" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.9rem)' }}><div><div className="font-semibold leading-tight">Photograph your meal</div><div className="text-[11px] text-white/60">Great for a plate a barcode can't capture</div></div><button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-2xl leading-none" style={{ background: 'rgba(255,255,255,0.18)' }}>×</button></div>
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
        {ready && !err && <div className="absolute rounded-2xl" style={{ inset: '1.75rem', border: '2px solid rgba(255,255,255,0.5)' }} />}
        {err && <div className="absolute inset-x-8 text-center text-white/90 text-sm">Camera unavailable here, upload a photo of your meal instead.</div>}
      </div>
      <div className="p-5 flex flex-col items-center gap-3">
        {!err && <button onClick={capture} disabled={!ready} className="w-16 h-16 rounded-full bg-white active:scale-95 disabled:opacity-40" style={{ boxShadow: '0 0 0 4px rgba(255,255,255,0.35)' }} aria-label="Capture" />}
        {!err && <div className="text-white/60 text-[12px]">Fit your whole meal in the frame, then tap to capture.</div>}
        <label className="text-white/80 text-[13px] underline cursor-pointer">Upload a photo instead<input type="file" accept="image/*" multiple className="hidden" onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) onFiles(fs); }} /></label>
        <button onClick={onClose} className="text-white/90 text-[13px] mt-1 px-4 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.14)' }}>Cancel</button>
      </div>
    </div>
  );
}
// Is a label OCR result reliable enough to trust the cheap fast model, or should we escalate to the
// strong model? We escalate when the AI estimated a macro, when numbers are missing, or when the
// calories don't add up from the macros (a tell-tale sign of a misread on a hard-to-read label).
function labelReadReliable(est) {
  if (!est) return false;
  if (est.macros_estimated) return false;
  const cols = [est.per_100g, est.per_serving].filter(c => c && (+c.kcal) > 0);
  if (!cols.length) return false;
  return cols.every(c => {
    const kc = +c.kcal || 0;
    if (kc <= 0 || ((+c.protein_g || 0) + (+c.carbs_g || 0) + (+c.fat_g || 0)) <= 0) return false;
    const dk = (+c.protein_g || 0) * 4 + (+c.carbs_g || 0) * 4 + (+c.fat_g || 0) * 9;
    return Math.abs(dk - kc) / kc <= 0.20;
  });
}
function PhotoTab({ db, onPick, onAskAI, asAlcohol, autoScan }) {
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [parsed, setParsed] = useState(null); const [mode, setMode] = useState(autoScan ? 'scan' : null); const [notFound, setNotFound] = useState(false); const [rescan, setRescan] = useState(false);
  // The LogSheet barcode shortcut (and ?action=scan) jump straight into the live scanner.
  useEffect(() => { if (autoScan) { setNotFound(false); setMode('scan'); } }, [autoScan]);
  const key = db.profile.aiKey || 'builtin';
  async function onLabel(file) { if (!file) return; const wasRescan = rescan; setRescan(false); const srcNote = wasRescan ? 'Read from your nutrition label, replacing the database numbers.' : 'Read straight from your nutrition label.'; setBusy('Reading the label…'); setErr('');
    try {
      // Cost-smart OCR at high resolution: read with the cheap fast model first, and only escalate to
      // the strong model when that read looks unreliable (calories not matching macros, values missing,
      // or estimated). Easy labels stay cheap; harder ones automatically get the stronger reader.
      const read = (model, mt) => claudeVision(key, [file], LABEL_PROMPT, { model, maxTokens: mt, maxImg: 1568 });
      let est = await read(AI_MODEL_FAST, 1200);
      if (!labelReadReliable(est)) { setBusy('Double-checking the label…'); est = await read(AI_MODEL, 1500); }
      const sg = +est.serving_g || null;
      const ps = est.per_serving || {}, p100 = est.per_100g || {};
      const hasServing = (+ps.kcal || 0) > 0 || (+ps.carbs_g || 0) > 0 || (+ps.protein_g || 0) > 0 || (+ps.fat_g || 0) > 0;
      const label = est.serving_label || (sg ? `1 serving (${sg} g)` : '1 serving');
      // Macros were estimated if the AI says so, or a column has calories but every macro is still 0.
      const estCol = (c) => (+c.kcal || 0) > 0 && !(+c.protein_g) && !(+c.carbs_g) && !(+c.fat_g);
      const estimated = !!est.macros_estimated || (hasServing ? estCol(ps) : estCol(p100));
      if (hasServing) {
        // Per-serving column exists: log the whole serving/can by its own figures, no per-100 scaling.
        setParsed({ source: 'label', branded: true, servingG: sg, servingLabel: label, estimated,
          note: estimated ? ('Your label showed calories but not the macros, so I\'ve estimated protein, carbs and fat for one ' + label + '. Check them below and edit anything that\'s off.') : (srcNote + ' One ' + label + '. Change the amount below if you had more or less.'),
          perServing: { kcal: Math.round(+ps.kcal || 0), protein: +ps.protein_g || 0, carbs: +ps.carbs_g || 0, fat: +ps.fat_g || 0, fiber: +ps.fiber_g || 0 },
          initial: { name: est.name || 'Scanned food' } });
      } else {
        setParsed({ per100: true, source: 'label', branded: true, servingG: sg, servingLabel: est.serving_label || (sg ? `1 portion (${sg} g)` : null), estimated,
          note: estimated ? ('Your label showed calories but not the macros, so I\'ve estimated protein, carbs and fat. Check them below and edit anything that\'s off.') : (srcNote + ' Pick the amount below.'),
          initial: { name: est.name || 'Scanned food', kcal: Math.round(+p100.kcal || 0), protein: +p100.protein_g, carbs: +p100.carbs_g, fat: +p100.fat_g, fiber: +p100.fiber_g } });
      }
    } catch (e) { setErr('Label read failed: ' + e.message); } setBusy(''); }
  async function lookupBarcode(code) { setMode(null); setBusy('Looking up product…'); setErr(''); setNotFound(false);
    try {
      const j = await (await fetch('https://world.openfoodfacts.org/api/v2/product/' + code + '.json')).json();
      const pname = j.product ? (j.product.product_name || 'Product') : '';
      // Smart foods: if you've corrected this exact product before (by barcode, or by name), start from
      // your saved figures instead of the database's.
      const sc = savedByBarcode(db, code) || (pname && savedCorrection(db, pname));
      if (sc) { setParsed(Object.assign(parsedFromSaved(sc, 'Using the values you saved for this product.'), { barcode: code })); setBusy(''); return; }
      // Community consensus: if two or more people have scanned and corrected this exact barcode, trust
      // their agreed figures over the database (and even when the database has no record of it).
      if (supa) {
        try { const r = await supa.rpc('get_community_food', { p_barcode: code }); const row = r && r.data && r.data[0]; if (row && row.votes >= 2) { setParsed(parsedFromCommunity(row, code)); setBusy(''); return; } } catch (e) {}
      }
      if (!j.product) { setNotFound(true); setBusy(''); return; }
      const n = j.product.nutriments || {};
      setParsed({ per100: true, source: 'off', branded: true, barcode: code, note: 'From the Open Food Facts database. Check it looks right before logging.', servingG: +j.product.serving_quantity || null, servingLabel: j.product.serving_size || null, initial: { name: pname, kcal: Math.round(n['energy-kcal_100g'] || 0), protein: n.proteins_100g, carbs: n.carbohydrates_100g, fat: n.fat_100g, fiber: n.fiber_100g } });
    } catch (e) { setErr('Lookup failed. Please try again.'); }
    setBusy('');
  }
  if (parsed) return <ConfirmFood {...parsed} asAlcohol={asAlcohol} onAdd={onPick} onCancel={() => { setParsed(null); setMode(null); }} onRescan={(parsed.source === 'off' || parsed.source === 'community') ? () => { setRescan(true); setParsed(null); setMode('label'); } : undefined} onAskAI={onAskAI} />;
  if (mode === 'meal') return <MealEstimate apiKey={key} onPick={onPick} onBack={() => setMode(null)} />;
  if (mode === 'scan') return <LiveScanner onFound={lookupBarcode} onClose={() => setMode(null)} />;
  if (mode === 'label') return <LabelScanner onCapture={f => { setMode(null); onLabel(f); }} onClose={() => setMode(null)} />;
  if (busy) return <DinoLoader label={busy} />;
  return (<div>
    <div className="text-[12px] text-[#8A8A90] mb-4">The quickest, most accurate way to log packaged food. No barcode, or not found? Scan the label instead.</div>
    {notFound && <div className="pixel-box p-3.5 mb-3 fade-in" style={{ background: 'var(--surface3)', borderColor: 'var(--fat)' }}>
      <div className="text-[12px] mb-2.5" style={{ color: 'var(--text)' }}>That barcode isn't in the food database. Scan the nutrition label instead and it will read the numbers for you.</div>
      <div className="flex gap-2">
        <Btn kind="accent" className="flex-1" onClick={() => { setNotFound(false); setMode('label'); }}>Scan the label</Btn>
        <Btn kind="ghost" onClick={() => { setNotFound(false); setMode('scan'); }}>Try again</Btn>
      </div>
    </div>}
    <button onClick={() => { setNotFound(false); setMode('scan'); }} className="w-full flex items-center gap-3 rounded-2xl p-4 text-left active:scale-[.99] transition" style={{ background: 'var(--accent)', color: '#0d0d0d' }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(0,0,0,0.12)' }}><Icon.barcode width="22" height="22" /></div>
      <div className="min-w-0"><div className="text-sm font-bold">Scan a barcode</div><div className="text-[11px]" style={{ opacity: 0.85 }}>The quickest, most accurate way to log packaged food.</div></div>
    </button>
    <button onClick={() => setMode('label')} className="w-full flex items-center gap-3 bg-[#1E1E22] rounded-2xl p-4 text-left border border-[#262629] active:scale-[.99] transition mt-2.5">
      <div className="w-11 h-11 rounded-xl bg-[#4A9EEB]/15 flex items-center justify-center shrink-0"><Icon.cam width="22" height="22" style={{ color: CAL }} /></div>
      <div className="min-w-0"><div className="text-sm font-medium">No barcode? Scan the label</div><div className="text-[11px] text-[#8A8A90]">Point your camera at the nutrition label and it reads the exact numbers.</div></div>
    </button>
    {onAskAI && <div className="flex items-center gap-3 my-3"><div className="flex-1 h-px" style={{ background: 'var(--border)' }} /><span className="text-[10px] uppercase tracking-widest text-[#8A8A90]">or</span><div className="flex-1 h-px" style={{ background: 'var(--border)' }} /></div>}
    {onAskAI && <button onClick={onAskAI} className="w-full flex items-center gap-3 bg-[#1E1E22] rounded-2xl p-4 text-left border border-[#262629] active:scale-[.99] transition">
      <div className="w-11 h-11 rounded-xl bg-[#F5C542]/15 flex items-center justify-center shrink-0"><PixelGlyph kind="sun" color={FAT} size={20} /></div>
      <div className="min-w-0"><div className="text-sm font-medium">Nothing to scan? Describe it to the AI</div><div className="text-[11px] text-[#8A8A90]">Type, say, or photograph a meal and the AI estimates it.</div></div>
    </button>}
    {busy && <div className="text-[12px] text-[#4A9EEB] mt-3 fade-in">{busy}</div>}{err && <div className="text-[12px] text-[#F5C542] mt-3 fade-in">{err}</div>}</div>);
}
// UK drink standards: [label, default ABV %, residual carbs g/100ml]. Calories = alcohol (7 kcal/g,
// ethanol 0.789 g/ml) + the drink's residual carbs, so a stated ABV and measure give an accurate figure.
const DRINK_CATS = {
  beer: { label: 'Beer / Cider', styleLabel: 'Style', defServe: 1,
    styles: [['Lager', 4.5, 3.3], ['IPA / pale ale', 5.5, 3.5], ['Bitter / ale', 4.0, 3.5], ['Stout', 4.2, 3.0], ['Cider (medium)', 4.5, 7.0], ['Cider (dry)', 5.0, 2.5], ['Custom', 4.5, 3.3]],
    servings: [['Half', 284], ['Pint', 568], ['Bottle 330', 330], ['Can 440', 440], ['Can 500', 500]] },
  wine: { label: 'Wine', styleLabel: 'Style', defServe: 1,
    styles: [['Red', 13, 2.5], ['White', 12.5, 2.5], ['Rosé', 12, 3.0], ['Prosecco', 11.5, 1.5], ['Champagne', 12, 1.5], ['Custom', 13, 2.5]],
    servings: [['125ml', 125], ['175ml', 175], ['250ml', 250], ['Bottle', 750]] },
  spirit: { label: 'Spirits', styleLabel: 'Spirit', defServe: 0,
    styles: [['Gin', 40, 0], ['Vodka', 40, 0], ['Whisky', 40, 0], ['Rum', 40, 0], ['Tequila', 38, 0], ['Custom', 40, 0]],
    servings: [['Single 25ml', 25], ['Double 50ml', 50], ['Large 35ml', 35]] }
};
// [label, kcal] for a typical ~150ml mixer serving.
const MIXERS = [['No mixer', 0], ['Cola', 63], ['Diet / slimline', 1], ['Tonic', 52], ['Slimline tonic', 4], ['Lemonade', 38], ['Soda / water', 0], ['Orange juice', 63]];
const ETHANOL_G_PER_ML = 0.789, KCAL_PER_G_ALC = 7;
function AlcoholTab({ onPick }) {
  const [cat, setCat] = useState('beer');
  const [styleIdx, setStyleIdx] = useState(0);
  const [abv, setAbv] = useState(DRINK_CATS.beer.styles[0][1]);
  const [serveIdx, setServeIdx] = useState(DRINK_CATS.beer.defServe);
  const [customMl, setCustomMl] = useState('');
  const [mixerIdx, setMixerIdx] = useState(0);
  const [count, setCount] = useState(1);
  const [manual, setManual] = useState(false);
  const [carbPct, setCarbPct] = useState(50); // alcohol calories split across BOTH carbs and fat
  const [mc, setMc] = useState({ protein: '', carbs: '', fat: '' });
  const [otherName, setOtherName] = useState('Drink');
  const [otherKcal, setOtherKcal] = useState(150);
  const D = cat === 'other' ? null : DRINK_CATS[cat];
  function chooseCat(c) { setCat(c); setStyleIdx(0); setCustomMl(''); setMixerIdx(0); if (DRINK_CATS[c]) { setAbv(DRINK_CATS[c].styles[0][1]); setServeIdx(DRINK_CATS[c].defServe); } }
  function chooseStyle(i) { setStyleIdx(i); const s = D.styles[i]; if (s[0] !== 'Custom') setAbv(s[1]); }
  const residualPer100 = D ? D.styles[styleIdx][2] : 0;
  const serving = D ? D.servings[serveIdx] : null;
  const ml = customMl ? +customMl : (serving ? serving[1] : 0);
  const mixerKcal = cat === 'spirit' ? MIXERS[mixerIdx][1] : 0;
  const perDrink = cat === 'other' ? (+otherKcal || 0) : Math.round(ml * (+abv / 100) * ETHANOL_G_PER_ML * KCAL_PER_G_ALC + ml * (residualPer100 / 100) * 4 + mixerKcal);
  const n = Math.max(1, +count || 1);
  const totalKcal = perDrink * n;
  const autoCarbs = (totalKcal * carbPct / 100) / 4, autoFat = (totalKcal * (100 - carbPct) / 100) / 9;
  const styleName = D ? D.styles[styleIdx][0] : '';
  const serveName = customMl ? (customMl + 'ml') : (serving ? serving[0] : '');
  const mixerName = MIXERS[mixerIdx][0];
  const drinkName = cat === 'other' ? (otherName || 'Drink')
    : cat === 'spirit' ? (mixerIdx > 0 ? styleName + ' & ' + mixerName.toLowerCase() : styleName)
      : styleName + ' (' + abv + '%)';
  const qtyLabel = (n > 1 ? n + '× ' : '') + (cat === 'other' ? 'serving' : serveName);
  function add() {
    const macros = manual
      ? { kcal: totalKcal, protein: (+mc.protein || 0) * n, carbs: (+mc.carbs || 0) * n, fat: (+mc.fat || 0) * n, fiber: 0 }
      : { kcal: totalKcal, protein: 0, carbs: +autoCarbs.toFixed(1), fat: +autoFat.toFixed(1), fiber: 0 };
    onPick({ name: drinkName, source: 'alcohol', is_alcohol: true, qtyLabel: qtyLabel, alcohol_split: manual ? null : { carb_pct: carbPct, fat_pct: 100 - carbPct }, macros: macros, amount: n, unitNoun: 'drink' });
  }
  return (<div>
    <div className="text-[12px] text-[#8A8A90] mb-3">Tell me the drink and measure and I'll work the calories from its strength. They split across carbs and fat so your day still balances.</div>
    <div className="mb-3"><Seg value={cat} onChange={chooseCat} options={[{ v: 'beer', l: 'Beer' }, { v: 'wine', l: 'Wine' }, { v: 'spirit', l: 'Spirits' }, { v: 'other', l: 'Other' }]} /></div>
    {cat === 'other' ? (<>
      <Field label="Name"><TextInput value={otherName} onChange={e => setOtherName(e.target.value)} /></Field>
      <Field label="Calories (per drink)"><NumInput value={otherKcal} onChange={e => setOtherKcal(e.target.value)} /></Field>
    </>) : (<>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><Field label={D.styleLabel}><Dropdown value={String(styleIdx)} onChange={v => chooseStyle(+v)} options={D.styles.map((s, i) => ({ v: String(i), l: s[0] }))} /></Field></div>
        <Field label="ABV %"><NumInput value={abv} onChange={e => setAbv(e.target.value)} /></Field>
      </div>
      <Field label="Measure">
        <div className="flex gap-1.5 flex-wrap">{D.servings.map((s, i) => (
          <button key={i} onClick={() => { setServeIdx(i); setCustomMl(''); }} className={`pixel-box px-2.5 py-2 text-[11px] ${!customMl && serveIdx === i ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ boxShadow: 'none' }}>{s[0]}</button>
        ))}</div>
        <div className="mt-2"><NumInput value={customMl} onChange={e => setCustomMl(e.target.value)} placeholder="or custom ml" /></div>
      </Field>
      {cat === 'spirit' && <Field label="Mixer"><Dropdown value={String(mixerIdx)} onChange={v => setMixerIdx(+v)} options={MIXERS.map((m, i) => ({ v: String(i), l: m[0] }))} /></Field>}
    </>)}
    <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2 mt-1">How many?</div>
    <div className="flex items-center gap-2 mb-3">
      <button onClick={() => setCount(c => Math.max(1, (+c || 1) - 1))} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="Fewer">−</button>
      <div className="flex-1"><NumInput value={count} onChange={e => setCount(e.target.value)} className={inputCls + ' text-center'} /></div>
      <button onClick={() => setCount(c => (+c || 1) + 1)} className="pixel-btn w-12 h-12 flex items-center justify-center text-xl bg-[#1E1E22] text-[var(--text)]" aria-label="More">+</button>
      <div className="text-[12px] text-[#8A8A90] shrink-0 w-16 text-center">drink{n > 1 ? 's' : ''}</div>
    </div>
    <div className="pixel-box p-3 mb-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
      <div className="tnum"><span className="text-xl font-bold" style={{ color: 'var(--text)' }}>{totalKcal}</span> <span className="text-[12px] text-[#8A8A90]">kcal</span>{n > 1 && <span className="text-[11px] text-[#8A8A90]"> · {perDrink} each</span>}</div>
    </div>
    <div className="mb-3"><Seg value={manual ? 'manual' : 'auto'} onChange={v => setManual(v === 'manual')} options={[{ v: 'auto', l: 'Auto split' }, { v: 'manual', l: 'Enter macros' }]} /></div>
    {!manual ? (<Field label={`Split: ${carbPct}% carbs · ${100 - carbPct}% fat`}><input type="range" min="0" max="100" step="10" value={carbPct} onChange={e => setCarbPct(+e.target.value)} className="w-full accent-[#4A9EEB]" /><div className="text-sm text-[#8A8A90] mt-2 tnum">= {autoCarbs.toFixed(1)}g carbs · {autoFat.toFixed(1)}g fat</div></Field>) : (<div className="grid grid-cols-3 gap-3"><Field label="Protein"><NumInput value={mc.protein} onChange={e => setMc(p => Object.assign({}, p, { protein: e.target.value }))} /></Field><Field label="Carbs"><NumInput value={mc.carbs} onChange={e => setMc(p => Object.assign({}, p, { carbs: e.target.value }))} /></Field><Field label="Fat"><NumInput value={mc.fat} onChange={e => setMc(p => Object.assign({}, p, { fat: e.target.value }))} /></Field></div>)}
    <Btn kind="accent" className="w-full mt-1" disabled={totalKcal <= 0} style={{ opacity: totalKcal <= 0 ? 0.5 : 1 }} onClick={add}>Add {n > 1 ? n + ' drinks' : 'drink'}</Btn>
  </div>);
}

/* =====================================================================
   STRATEGY (goal, check-in, cycling, carryover, coach)
   ===================================================================== */
function GoalCard({ active, onClick, title, sub, glyph }) {
  return (
    <button onClick={onClick} className={`text-left pixel-box p-3 ${active ? 'bg-white text-black' : 'bg-[#1E1E22] text-white'}`} style={{ boxShadow: active ? '3px 3px 0 0 var(--shadow)' : 'none' }}>
      <div className="mb-1.5"><PixelGlyph kind={glyph} color="currentColor" size={20} /></div>
      <div className="font-semibold text-[13px]">{title}</div>
      <div className={`text-[10px] mt-0.5 ${active ? 'text-black/60' : 'text-[#8A8A90]'}`}>{sub}</div>
    </button>
  );
}

function Goals({ db, update, showToast, onCheckIn }) {
  const p = db.profile; const unit = p.weight_unit;
  const base = currentTargets(db);
  const today = Store.todayISO();
  const [showAdv, setShowAdv] = useState(false);
  const seedGW = kgToStLb(p.goalWeightKg || p.weightKg);
  const [g, setG] = useState({ goalType: p.goalType, rateKgPerWeek: p.rateKgPerWeek, dietStyle: p.dietStyle, proteinGPerKgLBM: p.proteinGPerKgLBM || E.defaultProteinPerKgLBM(p.goalType) });
  const setg = (k, v) => setG(x => Object.assign({}, x, { [k]: v }));
  const [gProteinTouched, setGProteinTouched] = useState(!!p.proteinGPerKgLBM);
  const pickGoal = (gt) => { setg('goalType', gt); if (!gProteinTouched) setg('proteinGPerKgLBM', E.defaultProteinPerKgLBM(gt)); };
  const [gwKg, setGwKg] = useState(p.goalWeightKg || ''); const [gwSt, setGwSt] = useState(p.goalWeightKg ? seedGW.st : ''); const [gwLb, setGwLb] = useState(p.goalWeightKg ? seedGW.lb : '');
  const [confirming, setConfirming] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [wErr, setWErr] = useState('');
  const seed = kgToStLb(p.weightKg); const [kg, setKg] = useState(p.weightKg); const [st, setSt] = useState(seed.st); const [lb, setLb] = useState(seed.lb);
  const goalWChanged = unit === 'st_lb' ? (gwSt ? +stLbToKg(gwSt, gwLb).toFixed(2) : null) !== (p.goalWeightKg || null) : (+gwKg || null) !== (p.goalWeightKg || null);
  // Plan-affecting changes retune macros and re-anchor the trend; target weight is just a progress marker.
  const planChanged = g.goalType !== p.goalType || g.rateKgPerWeek !== p.rateKgPerWeek || g.dietStyle !== p.dietStyle || g.proteinGPerKgLBM !== (p.proteinGPerKgLBM || E.defaultProteinPerKgLBM(p.goalType));
  const changed = planChanged || goalWChanged;
  // Save only the target weight, no current-weight re-anchor, no macro rebuild, no check-in reset.
  function saveTargetOnly() {
    const goalW = g.goalType === 'maintain' ? null : (unit === 'st_lb' ? (gwSt ? stLbToKg(gwSt, gwLb) : null) : (+gwKg || null));
    update(d => { d.profile = Object.assign({}, d.profile, { goalWeightKg: goalW ? +goalW.toFixed(2) : null }); });
    showToast && showToast('Target weight saved');
  }
  function apply() {
    const weightKg = unit === 'st_lb' ? stLbToKg(st, lb) : +kg; if (!weightKg) { setWErr("Enter your current weight to continue."); return; }
    setWErr('');
    const goalW = g.goalType === 'maintain' ? null : (unit === 'st_lb' ? (gwSt ? stLbToKg(gwSt, gwLb) : null) : (+gwKg || null));
    update(d => {
      d.profile = Object.assign({}, d.profile, { goalType: g.goalType, rateKgPerWeek: g.rateKgPerWeek, dietStyle: g.dietStyle, proteinGPerKgLBM: g.proteinGPerKgLBM, weightKg: +weightKg.toFixed(2), goalWeightKg: goalW ? +goalW.toFixed(2) : null });
      const t = Store.todayISO(); const ex = d.weight_entries.find(x => x.date === t);
      if (ex) ex.scale_weight = +weightKg.toFixed(2); else d.weight_entries.push({ id: Store.uid(), date: t, scale_weight: +weightKg.toFixed(2) });
      recomputeTrend(d);
      // Build the new plan on the LEARNED expenditure when we have a recent one, so a goal change
      // doesn't throw away weeks of adaptive tuning by resetting to the formula.
      const prior = learnedTdee(d, t);
      const nt = E.computeInitialTargets(withActivity(d.profile), prior ? { priorTdee: prior } : undefined); nt.id = Store.uid(); nt.effective_date = t; nt.source = 'goal-change'; d.targets.push(nt);
      d.last_checkin = t; d.paused = false;
    });
    setConfirming(false);
    showToast && showToast('Goal updated, plan re-anchored from today');
  }
  function pause() { update(d => { d.paused = true; }); showToast && showToast('Goal paused'); }
  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pb-28 lg:pb-12 pt-6 fade-in">
      <PageHeader kicker="What you're working towards" title="Progress" />

      {!db.paused && (() => {
        const daysSince = db.last_checkin ? daysBetween(db.last_checkin, today) : 999;
        const ready = daysSince >= 5, due = daysSince >= 7;
        return <Card className="p-4 mb-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="pf text-[9px] uppercase text-[#8A8A90] mb-1">Weekly check-in</div>
              <div className="text-[13px] font-bold">{due ? 'Due now' : ready ? 'Ready when you are' : `Next in ${7 - daysSince} day${7 - daysSince === 1 ? '' : 's'}`}</div>
              <div className="text-[10px] text-[#8A8A90]">Reads your week and suggests a small tweak. Nothing changes until you approve it.</div>
            </div>
            <Btn kind={ready ? 'accent' : 'ghost'} disabled={!ready} style={{ opacity: ready ? 1 : .5 }} onClick={onCheckIn}>Check in</Btn>
          </div>
        </Card>;
      })()}

      {/* Progress: the full weight trend, weigh-in log, check-in history and live burn estimate.
          Moved here from the dashboard so Home stays a quick daily glance. */}
      <div className="text-lg font-bold mb-3">Progress</div>
      <ProgressPanel db={db} update={update} />
      <ExpenditureCard db={db} />
      <div className="mb-6"><ConsistencyHeatmap db={db} today={today} /></div>

      {base && <Card className="p-4 mb-5">
        <div className="flex items-center justify-between">
          <div><div className="pf text-[9px] uppercase text-[#8A8A90] mb-1">Current plan</div><div className="text-xl font-bold tnum">{base.kcal} kcal</div></div>
          <div className="text-right text-[13px] tnum"><span style={{ color: PRO }}>P{base.protein_g}</span> <span style={{ color: CARB }}>C{base.carbs_g}</span> <span style={{ color: FAT }}>F{base.fat_g}</span></div>
        </div>
        <div className="text-[11px] text-[#8A8A90] mt-2">{p.goalType === 'cut' ? 'Cutting' : p.goalType === 'gain' ? 'Lean gain' : 'Maintaining'}{p.goalType !== 'maintain' ? ` at ${p.rateKgPerWeek} kg/week` : ''}{p.goalWeightKg ? ` · target ${fmtWeight(p.goalWeightKg, unit)}` : ''}.{db.paused ? ' Currently paused.' : ''}</div>
        {base.squeezed && <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--fat)' }}>This target sits at the safety floor, so fat (and possibly protein) had to be trimmed to fit. Your desired rate may not be achievable.</div>}
      </Card>}

      <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">Goal</div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <GoalCard active={g.goalType === 'cut'} onClick={() => pickGoal('cut')} glyph="down" title="Fat loss" sub="Lose fat" />
        <GoalCard active={g.goalType === 'maintain'} onClick={() => pickGoal('maintain')} glyph="scale" title="Maintain" sub="Hold steady" />
        <GoalCard active={g.goalType === 'gain'} onClick={() => pickGoal('gain')} glyph="up" title="Lean gain" sub="Build muscle" />
      </div>

      <Card className="p-5 mb-6">
        {g.goalType !== 'maintain' && <>
          <Field label={`Rate: ${g.rateKgPerWeek} kg/week`} hint={g.goalType === 'gain' ? 'How fast you aim to gain. A gentler pace stays leaner; faster adds more fat alongside the muscle.' : 'How fast you aim to lose. A gentler pace is easier to sustain; faster brings more hunger.'}>
            <input type="range" min="0.1" max="1.2" step="0.05" value={g.rateKgPerWeek} onChange={e => setg('rateKgPerWeek', +e.target.value)} className="w-full accent-[#4A9EEB]" />
            {(() => { const rl = rateLabel(g.rateKgPerWeek, g.goalType); return <div className="text-[12px] mt-1.5" style={{ color: rl.c }}>Pace: {rl.t}</div>; })()}
            {(() => {
              const rg = E.rateGuidance({ weightKg: p.weightKg, bodyFatPct: p.bodyFatPct, sex: p.sex, goalType: g.goalType, rateKgPerWeek: g.rateKgPerWeek });
              if (!rg.tooFast || !rg.maxKg) return null;
              const mk = unit === 'st_lb' ? (rg.maxKg * 2.20462).toFixed(1) + ' lb' : rg.maxKg + ' kg';
              return <div className="text-[11px] mt-1.5 leading-snug" style={{ color: 'var(--fat)' }}>That's ~{rg.pctOfBW}% of your bodyweight a week. The evidence favours ≤ ~{mk}/week ({rg.pctCap * 100}% of bodyweight) {g.goalType === 'gain' ? 'to keep the gain lean' : 'to protect muscle and stay sustainable'}.</div>;
            })()}
          </Field>
          <Field label="Target weight" hint="Optional. Shows your progress towards it.">{unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={gwSt} onChange={e => setGwSt(e.target.value)} placeholder="st" /><span className="text-[#8A8A90]">st</span><NumInput value={gwLb} onChange={e => setGwLb(e.target.value)} placeholder="lb" /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={gwKg} onChange={e => setGwKg(e.target.value)} placeholder="kg" />}</Field>
        </>}
        <button type="button" onClick={() => setShowAdv(s => !s)} className="text-[11px] text-[#8A8A90] mb-2">{showAdv ? '▲ Hide advanced' : '▾ Advanced: protein and diet style'}</button>
        {showAdv && <div className="fade-in">
          <Field label={`Protein: ${Math.round(g.proteinGPerKgLBM * leanKg(p))} g (${g.proteinGPerKgLBM.toFixed(1)} g/kg lean mass)`} hint={`Set per kg of LEAN mass so body fat doesn't inflate it. Your ${g.goalType === 'gain' ? 'lean-gain' : g.goalType} default is ${E.defaultProteinPerKgLBM(g.goalType)} g/kg lean. Evidence: Helms 2014 = 2.3–3.1 g/kg lean to hold muscle in a deficit; Jeff Nippard = 1.8–2.7 g/kg bodyweight when cutting.`}><input type="range" min="1.8" max="3.1" step="0.1" value={g.proteinGPerKgLBM} onChange={e => { setGProteinTouched(true); setg('proteinGPerKgLBM', +e.target.value); }} className="w-full accent-[#4A9EEB]" /></Field>
          <Field label="Diet style" hint="Shifts the carb/fat balance. Protein stays fixed."><Seg value={g.dietStyle} onChange={v => setg('dietStyle', v)} options={[{ v: 'balanced', l: 'Balanced' }, { v: 'lower_carb', l: 'Lower carb' }, { v: 'higher_carb', l: 'Higher carb' }]} /></Field>
        </div>}
        {!confirming
          ? <Btn kind="accent" className="w-full" disabled={!changed} style={{ opacity: changed ? 1 : .5 }} onClick={() => planChanged ? setConfirming(true) : saveTargetOnly()}>{!changed ? 'No changes to save' : planChanged ? 'Save & update goal' : 'Save target weight'}</Btn>
          : <div className="pixel-box bg-[#1E1E22] p-4 mt-1 fade-in" style={{ boxShadow: 'none' }}>
            <div className="text-[12px] text-[#8A8A90] mb-3">Confirm your current weight to re-anchor. Your next check-in unlocks from day 5 (7-day cycle recommended).</div>
            <Field label="Current weight">{unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(+e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(+e.target.value)} /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={kg} onChange={e => setKg(e.target.value)} />}</Field>
            {wErr && <div className="text-[11px] mb-2" style={{ color: 'var(--danger)' }}>{wErr}</div>}
            <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={apply}>Confirm & update</Btn><Btn kind="ghost" onClick={() => { setConfirming(false); setWErr(''); }}>Cancel</Btn></div>
          </div>}
      </Card>

      <Section title="Pause goal">
        {db.paused
          ? <div className="text-[12px] text-[#8A8A90] pixel-box bg-[#1E1E22] px-4 py-3.5" style={{ boxShadow: 'none' }}>Your goal's paused. Resume from the Dashboard when you're ready: you'll weigh in and pick up from there.</div>
          : <><div className="text-[12px] text-[#8A8A90] mb-3">Going on holiday or taking a break? Pausing stops your check-in clock and holds your macros. Resume any time from the Dashboard.</div><Btn kind="ghost" className="w-full" onClick={() => setPauseOpen(true)}>Pause goal</Btn></>}
      </Section>
      {pauseOpen && <ConfirmDialog title="Pause your goal?" body="Your check-in clock stops and your macros hold steady until you resume from the Dashboard." confirmLabel="Pause goal" confirmKind="accent" onConfirm={pause} onClose={() => setPauseOpen(false)} />}
    </div>
  );
}

/* =====================================================================
   MORE (personal details + settings)
   ===================================================================== */
function SaveBar({ dirty, saved, onSave, label }) {
  return <div className="mt-1 mb-2"><Btn kind="accent" className="w-full" disabled={!dirty && !saved} style={{ opacity: (dirty || saved) ? 1 : .5 }} onClick={onSave}>{saved ? '✓ Saved' : (label || 'Save changes')}</Btn></div>;
}

const COACH_MODES = [
  { v: 'coached', l: 'Coached', d: 'Macrosaurus applies your new macros automatically at each check-in. Best if you want it hands-off and just told what to eat.' },
  { v: 'collaborative', l: 'Approve', d: 'We suggest a change at each check-in and you approve it or stick with your current macros. A middle ground with you in the loop.' },
  { v: 'manual', l: 'Manual', d: 'We never change your macros for you. You read the trends and adjust your goal yourself whenever you want.' },
];

// A one-tap "pull fresh data now" button. Google Health already auto-syncs on app open and on a slow
// interval, but this bypasses the throttle for an on-demand refresh. Shares the exact merge path the
// auto-sync uses, so results are identical; drops the connection flag if the Google link has expired.
function GhResyncButton({ db, update, className }) {
  const [busy, setBusy] = useState(false);
  async function resync() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await ghPost('sync', {});
      update(d => { d.googleHealth = Object.assign({}, d.googleHealth, { connected: true, lastSync: r.last_sync || new Date().toISOString() }); mergeStepsInto(d, r.steps); mergeSleepInto(d, r.sleep); mergeHealthInto(d, r.health); });
    } catch (e) {
      if (e && e.gh && e.gh.type === 'reauth_required') update(d => { if (d.googleHealth) d.googleHealth.connected = false; });
    } finally { setBusy(false); }
  }
  return <Btn kind="ghost" className={className || 'text-sm'} onClick={resync} disabled={busy}>{busy ? 'Syncing…' : 'Re-sync'}</Btn>;
}
// Sync diagnostics: show exactly what Google Health handed us for the last few nights, so "is my sleep
// scoring?" has a definite answer. Stage fields present => the device's deep/REM/light breakdown survived
// the sync (a real quality score); absent => hours-only. HRV/resting-HR rows show whether readiness has
// the recovery signals it needs (and their rolling baselines, which take ~2 weeks to fill).
function GhDebug({ db, update }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sleep = db.sleep || {}, health = db.health || {};
  const sdates = Object.keys(sleep).filter(dt => (sleep[dt] || {}).min > 0).sort().slice(-7).reverse();
  const hdates = Object.keys(health).sort().slice(-7).reverse();
  const hasStages = r => r && (r.deep != null || r.rem != null || r.light != null || r.awake != null);
  const hm = m => Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  async function resync() {
    setBusy(true); setMsg('');
    try {
      const r = await ghPost('sync', {});
      update(d => { d.googleHealth = Object.assign({}, d.googleHealth, { connected: true, lastSync: r.last_sync || new Date().toISOString() }); mergeStepsInto(d, r.steps); mergeSleepInto(d, r.sleep); mergeHealthInto(d, r.health); });
      setMsg('Synced. Check the nights below - stage fields mean quality data came through.');
    } catch (e) {
      setMsg('Sync failed: ' + (e && e.message ? e.message : 'unknown error'));
      if (e && e.gh && e.gh.type === 'reauth_required') update(d => { if (d.googleHealth) d.googleHealth.connected = false; });
    } finally { setBusy(false); }
  }
  const row = { color: 'var(--muted)', fontSize: 11 };
  return (
    <details className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <summary className="pf text-[9px] uppercase cursor-pointer" style={{ color: 'var(--muted)' }}>Sync diagnostics</summary>
      <div className="mt-2">
        <Btn kind="ghost" className="text-sm" onClick={resync} disabled={busy}>{busy ? 'Syncing…' : 'Re-sync now'}</Btn>
        {msg ? <div className="mt-1.5 text-[11px]" style={{ color: 'var(--text)' }}>{msg}</div> : null}
        <div className="pf text-[8px] uppercase mt-3 mb-1" style={{ color: 'var(--muted)' }}>Sleep · last synced nights</div>
        {sdates.length ? sdates.map(dt => {
          const r = sleep[dt];
          return <div key={dt} className="tnum leading-snug" style={row}>
            <b style={{ color: 'var(--text)' }}>{dt}</b> · {hm(r.min)} · {hasStages(r)
              ? <span>deep {r.deep || 0} / rem {r.rem || 0} / light {r.light || 0} / awake {r.awake || 0} to score <b style={{ color: 'var(--accent)' }}>{isFinite(r.score) ? r.score : '-'}</b></span>
              : <span style={{ color: 'var(--warn)' }}>no stage data (hours only)</span>}
          </div>;
        }) : <div style={row}>No sleep synced yet.</div>}
        <div className="pf text-[8px] uppercase mt-3 mb-1" style={{ color: 'var(--muted)' }}>Recovery signals · HRV / resting HR</div>
        {hdates.length ? hdates.map(dt => {
          const h = health[dt];
          return <div key={dt} className="tnum leading-snug" style={row}>
            <b style={{ color: 'var(--text)' }}>{dt}</b> · HRV {h.hrv != null ? h.hrv : '-'}{h.hrvBaseline != null ? ' (base ' + h.hrvBaseline + ')' : ''} · RHR {h.rhr != null ? h.rhr : '-'}{h.rhrBaseline != null ? ' (base ' + h.rhrBaseline + ')' : ''}
          </div>;
        }) : <div style={row}>No HRV / resting-HR synced yet - readiness needs ~14 days of these to build a baseline.</div>}
      </div>
    </details>
  );
}
function SettingsTab({ db, update }) {
  const p = db.profile;
  const init = () => ({ checkinDay: p.checkinDay == null ? 1 : p.checkinDay, weight_unit: p.weight_unit, height_unit: p.height_unit, aiKey: p.aiKey || '', reminders: p.reminders !== false, nudgeHour: p.nudgeHour == null ? 14 : p.nudgeHour, theme: p.theme || 'light', stepGoal: p.stepGoal || '', sleepTargetHours: p.sleepTargetMin ? +(p.sleepTargetMin / 60).toFixed(2).replace(/\.00$/, '') : '' });
  const [s, setS] = useState(init);
  const sset = (k, v) => setS(x => Object.assign({}, x, { [k]: v }));
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  // Web Push opt-in for this device (separate from the in-app banner below).
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  useEffect(() => { let ok = true; pushStatus().then(v => { if (ok) setPushOn(v); }); return () => { ok = false; }; }, []);
  async function togglePush() {
    setPushMsg('');
    if (pushOn) { setPushBusy(true); await pushDisable(); setPushOn(false); setPushBusy(false); return; }
    setPushBusy(true);
    try { await pushEnable(s.nudgeHour); setPushOn(true); }
    catch (e) {
      const m = e && e.message;
      setPushMsg(m === 'denied' ? 'Notifications are blocked. Allow them for this site in your browser settings, then try again.'
        : m === 'signedout' ? 'Sign in first to turn on push reminders.'
        : m === 'unsupported' ? 'This browser does not support push notifications.'
        : 'Could not turn on push reminders. Please try again.');
    }
    setPushBusy(false);
  }
  // Default meals are staged locally and committed on Save, so editing a meal name
  // flips the Save button just like every other setting on this tab.
  const initMeals = () => db.meal_templates.slice().sort((a, b) => a.sort_order - b.sort_order).map(m => ({ id: m.id, name: m.name }));
  const [dm, setDm] = useState(initMeals);
  const mealsChanged = JSON.stringify(dm) !== JSON.stringify(initMeals());
  const dirty = mealsChanged || JSON.stringify(s) !== JSON.stringify(init());
  function save() {
    update(d => {
      Object.assign(d.profile, s);
      // Normalise the two Google Health targets: blank means "use the automatic default".
      const sg = Math.round(+s.stepGoal) || 0; if (sg > 0) d.profile.stepGoal = sg; else delete d.profile.stepGoal;
      const sh = +s.sleepTargetHours || 0; if (sh > 0) d.profile.sleepTargetMin = Math.round(sh * 60); else delete d.profile.sleepTargetMin;
      delete d.profile.sleepTargetHours; // staging-only field, never persisted
      d.meal_templates = dm.map((m, i) => { const ex = d.meal_templates.find(x => x.id === m.id); return Object.assign({}, ex || { id: m.id, user_id: Store.USER }, { name: (m.name || '').trim() || 'Meal', sort_order: i }); });
    });
    if (pushOn) pushSyncHour(s.nudgeHour);
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }
  const renameDef = (id, name) => setDm(a => a.map(x => x.id === id ? Object.assign({}, x, { name }) : x));
  const addDef = () => setDm(a => a.concat([{ id: Store.uid(), name: 'Meal ' + (a.length + 1) }]));
  const removeDef = (id) => setDm(a => a.filter(x => x.id !== id));
  const moveDef = (id, dir) => setDm(a => { const i = a.findIndex(x => x.id === id); const j = dir < 0 ? i - 1 : i + 1; if (j < 0 || j >= a.length) return a; const b = a.slice(); const t = b[i]; b[i] = b[j]; b[j] = t; return b; });
  return (<>
    <Section title="Appearance">
      <Field label="Theme" hint="Dark is neon-on-black; Light is Game Boy Color.">
        <Seg value={s.theme} onChange={v => sset('theme', v)} options={[{ v: 'light', l: <span className="inline-flex items-center justify-center gap-1.5"><PixelGlyph kind="sun" color="currentColor" size={12} /> GB Color</span> }, { v: 'dark', l: <span className="inline-flex items-center justify-center gap-1.5"><PixelGlyph kind="moon" color="currentColor" size={12} /> Dark GB</span> }]} />
      </Field>
      <Field label="Weight units"><Seg value={s.weight_unit} onChange={v => sset('weight_unit', v)} options={[{ v: 'st_lb', l: 'st / lb' }, { v: 'kg', l: 'kg' }]} /></Field>
      <Field label="Height units"><Seg value={s.height_unit} onChange={v => sset('height_unit', v)} options={[{ v: 'cm', l: 'cm' }, { v: 'ft_in', l: 'ft / in' }]} /></Field>
    </Section>
    <Section title="Connected apps">
      <div className="text-[12px] text-[#8A8A90] mb-3">Auto-sync your daily steps and sleep from Google Health (Fitbit included). Read-only. Steps feed your dashboard, coaching and egg; a good night's sleep draws a creature into your dex each morning.</div>
      {(() => {
        const gh = db.googleHealth;
        if (!ghConfigured()) return <div className="text-[12px] text-[#8A8A90]">Auto-sync is coming soon.</div>;
        if (gh && gh.connected) return (
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px]"><span style={{ color: 'var(--good)' }}>Google Health connected</span>{gh.lastSync ? <span className="text-[#8A8A90]"> · synced {new Date(gh.lastSync).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> : ''}</div>
              <div className="flex items-center gap-2">
                <GhResyncButton db={db} update={update} />
                <Btn kind="ghost" className="text-sm" onClick={async () => { try { await ghPost('disconnect', {}); } catch (_) {} update(d => { d.googleHealth = { connected: false }; }); }}>Disconnect</Btn>
              </div>
            </div>
            <GhDebug db={db} update={update} />
          </div>
        );
        return <Btn kind="accent" className="w-full" onClick={ghConnect}>Connect Google Health</Btn>;
      })()}
    </Section>
    <Section title="Daily targets">
      <div className="text-[12px] text-[#8A8A90] mb-3">Set your own daily step goal and nightly sleep target. Leave blank to use the automatic default (steps from your activity level, sleep at 8 hours).</div>
      <Field label="Step goal" hint={'Blank uses your activity level (' + (withActivity(p).avgSteps || 0).toLocaleString('en-GB') + '/day).'}>
        <NumInput value={s.stepGoal} onChange={e => sset('stepGoal', e.target.value)} placeholder={String(withActivity(p).avgSteps || 8000)} />
      </Field>
      <Field label="Sleep target (hours)" hint="Blank uses 8 hours. Your sleep score is measured against this.">
        <NumInput value={s.sleepTargetHours} onChange={e => sset('sleepTargetHours', e.target.value)} placeholder="8" />
      </Field>
    </Section>
    <Section title="Meals">
      <div className="text-[12px] text-[#8A8A90] mb-3">Your default meals for each new day. Set the standard layout here, you can still add, remove or reorder meals on any individual day in the Food log without changing this default.</div>
      {dm.map((m, i) => (
        <div key={m.id} className="flex items-center gap-2 mb-2">
          <div className="flex flex-col -my-1 shrink-0">
            <button onClick={() => moveDef(m.id, -1)} disabled={i === 0} style={{ opacity: i === 0 ? 0.25 : 1 }} className="hit text-[#8A8A90] text-[10px] leading-none px-1 py-1.5" title="Move up">▲</button>
            <button onClick={() => moveDef(m.id, 1)} disabled={i === dm.length - 1} style={{ opacity: i === dm.length - 1 ? 0.25 : 1 }} className="hit text-[#8A8A90] text-[10px] leading-none px-1 py-1.5" title="Move down">▼</button>
          </div>
          <TextInput value={m.name} onChange={e => renameDef(m.id, e.target.value)} />
          <button onClick={() => setConfirmDel(m)} disabled={dm.length <= 1} style={{ opacity: dm.length <= 1 ? 0.3 : 1 }} className="hit px-2 text-[#8A8A90] text-lg leading-none shrink-0" title="Remove">×</button>
        </div>
      ))}
      <button onClick={addDef} className="w-full text-sm text-[#8A8A90] border border-dashed border-[#262629] rounded-2xl py-2.5 mt-1">+ Add default meal</button>
    </Section>
    <Section title="Notifications">
      <Field label="Check-in day" hint="Your preferred weekly check-in day. Once a check-in unlocks (day 5 of the cycle), the dashboard nudges you on and after this day. The day-5 gate stays the source of truth.">
        <div className="flex gap-1.5">{DOW.map((d, i) => <button key={i} onClick={() => sset('checkinDay', i)} className={`flex-1 pixel-box py-2 text-[11px] ${s.checkinDay === i ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ boxShadow: 'none' }}>{d[0]}</button>)}</div>
      </Field>
      {pushSupported()
        ? <>
            <RowToggle label="Push reminders (your buddy nudges you to log)" on={pushOn} onClick={togglePush} />
            {pushBusy && <div className="text-[12px] text-[#8A8A90] mb-1">Working...</div>}
            {pushMsg && <div className="text-[12px] mb-1" style={{ color: 'var(--fat)' }}>{pushMsg}</div>}
            {!pushOn && !pushBusy && pushNeedsInstall() && <div className="text-[12px] text-[#8A8A90] mb-1">On iPhone or iPad, add Macrosaurus to your Home Screen first (Share, then Add to Home Screen) to receive push reminders.</div>}
          </>
        : <div className="text-[12px] text-[#8A8A90] mb-2">This browser does not support push notifications. The in-app banner below still works.</div>}
      <RowToggle label="Also show an in-app nudge banner when I open the app" on={s.reminders} onClick={() => sset('reminders', !s.reminders)} />
      {(pushOn || s.reminders) && <Field label="Nudge after" hint="On a day you have not logged food or weighed in, before a miss would spend your monthly streak freeze. Sets both the push reminder (fires around this hour) and the in-app banner (shows when you next open the app).">
        <Dropdown value={s.nudgeHour} onChange={v => sset('nudgeHour', +v)} options={[12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => ({ v: h, l: (h > 12 ? h - 12 : h) + (h >= 12 ? 'pm' : 'am') }))} />
      </Field>}
    </Section>
    {p.sex === 'female' && (() => {
      const m = db.menstrual || { enabled: false, lastStart: null, cycleLen: 28 };
      const setM = (patch) => update(d => { d.menstrual = Object.assign({ enabled: false, lastStart: null, cycleLen: 28 }, d.menstrual, patch); });
      const ph = m.enabled ? E.menstrualPhase(m, Store.todayISO()) : null;
      return <Section title="Menstrual cycle">
        <div className="text-[12px] text-[#8A8A90] mb-3">Optional. If you track this, Macrosaurus expects the water-weight rise in the week before your period and will not cut your calories on it, so a normal premenstrual bump on the scale does not throw off your plan.</div>
        <RowToggle label="Track my cycle" on={!!m.enabled} onClick={() => setM({ enabled: !m.enabled })} />
        {m.enabled && <>
          <Field label="Last period start">
            <input type="date" className={inputCls} value={m.lastStart || ''} max={Store.todayISO()} onChange={e => setM({ lastStart: e.target.value || null })} />
            <button onClick={() => setM({ lastStart: Store.todayISO() })} className="text-[12px] text-[#4A9EEB] mt-1.5">My period started today</button>
          </Field>
          <Field label={`Average cycle length: ${m.cycleLen || 28} days`}>
            <input type="range" min="21" max="40" step="1" value={m.cycleLen || 28} onChange={e => setM({ cycleLen: +e.target.value })} className="w-full accent-[#4A9EEB]" />
          </Field>
          {ph && <div className="text-[12px] mt-1 leading-snug" style={{ color: ph.waterHigh ? 'var(--fat)' : ph.lowWater ? 'var(--good)' : 'var(--muted)' }}>Today: cycle day {ph.cycleDay + 1}, {ph.phase} phase.{ph.waterHigh ? ' Water weight often runs high now (it peaks on day one of your period), so the scale may read up. Your check-in will hold rather than cut on it.' : ph.lowWater ? ' Water weight is at its lowest, so this is the cleanest window for a weigh-in or check-in.' : ' Water weight runs highest around your period; it is settling now.'}</div>}
        </>}
      </Section>;
    })()}
    <Section title="AI food logging">
      <div className="text-[13px] text-[var(--text)] mb-1">AI is built in. No setup needed.</div>
      <div className="text-[12px] text-[#8A8A90]">Label scanning, photo meal estimates and the Describe tab all just work. Each account gets a monthly AI allowance; if you ever hit it, it resets on the 1st of the month.</div>
    </Section>
    <SaveBar dirty={dirty} saved={saved} onSave={save} label="Save settings" />
    {confirmDel && <ConfirmDialog title={'Remove ' + confirmDel.name + '?'} body="This removes it from your default meals for new days once you Save. Days you've already set up won't change." confirmLabel="Remove" onConfirm={() => removeDef(confirmDel.id)} onClose={() => setConfirmDel(null)} />}
  </>);
}

function AdvancedTab({ db, update }) {
  const p = db.profile; const base = currentTargets(db);
  const initCarry = () => ({ enabled: !!(p.carryover && p.carryover.enabled), mode: (p.carryover && p.carryover.mode) || 'aggressive', capKcal: (p.carryover && p.carryover.capKcal) || 400 });
  const initCyc = () => ({ enabled: !!(p.cycling && p.cycling.enabled), highDays: (p.cycling && p.cycling.highDays) || [], deltaPct: (p.cycling && p.cycling.deltaPct) || 0.15 });
  const [carry, setCarry] = useState(initCarry);
  const [cyc, setCyc] = useState(initCyc);
  const [manual, setManual] = useState({ enabled: false, kcal: base ? base.kcal : '', protein_g: base ? base.protein_g : '', carbs_g: base ? base.carbs_g : '', fat_g: base ? base.fat_g : '' });
  const mset = (k, v) => setManual(m => Object.assign({}, m, { [k]: v }));
  const [coach, setCoach] = useState(p.program_mode);
  const [saved, setSaved] = useState(false);
  const dirty = manual.enabled || coach !== p.program_mode || JSON.stringify({ carry, cyc }) !== JSON.stringify({ carry: initCarry(), cyc: initCyc() });
  function save() {
    update(d => {
      d.profile.carryover = carry; d.profile.cycling = cyc; d.profile.program_mode = coach;
      if (manual.enabled) {
        const kcal = Math.round(+manual.kcal || 0);
        if (kcal > 0) { const cur = currentTargets(d) || {}; d.targets.push({ id: Store.uid(), effective_date: Store.todayISO(), source: 'manual', kcal, protein_g: Math.round(+manual.protein_g || 0), carbs_g: Math.round(+manual.carbs_g || 0), fat_g: Math.round(+manual.fat_g || 0), estimatedTDEE: cur.estimatedTDEE }); }
      }
    });
    setManual(m => Object.assign({}, m, { enabled: false }));
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }
  return (<>
    <div className="text-[12px] text-[#8A8A90] mb-4">How your targets are set and adjusted. The defaults work great, so tune these only if you want to.</div>
    <Section title="Coaching mode">
      <div className="text-[12px] text-[#8A8A90] mb-3">Whether Macrosaurus adjusts your numbers at each check-in, or leaves them exactly where you set them.</div>
      <Seg value={coach} onChange={setCoach} options={COACH_MODES.map(m => ({ v: m.v, l: m.l }))} />
      <div className="mt-3 space-y-2">{COACH_MODES.map(m => (<div key={m.v} className={`pixel-box px-3 py-2.5 text-[12px] transition ${coach === m.v ? 'bg-[#1E1E22]' : 'opacity-45'}`} style={{ boxShadow: 'none' }}><span className="font-semibold">{m.l}.</span> <span className="text-[#8A8A90]">{m.d}</span></div>))}</div>
    </Section>
    <Section title="Calorie carryover">
      <div className="text-[12px] text-[#8A8A90] mb-3">Over- or under-eat and the difference gets made up later, so a single off day doesn't derail the week.</div>
      <RowToggle label="Carry surplus/deficit forward" on={carry.enabled} onClick={() => setCarry(c => Object.assign({}, c, { enabled: !c.enabled }))} />
      {carry.enabled && <>
        <Field label="How to make it up"><Seg value={carry.mode} onChange={v => setCarry(c => Object.assign({}, c, { mode: v }))} options={[{ v: 'dispersed', l: 'Dispersed' }, { v: 'aggressive', l: 'Aggressive' }]} /></Field>
        <div className="rounded-xl px-3 py-2.5 text-[12px] bg-[#1E1E22] border border-[#262629] mb-3.5">
          {carry.mode === 'dispersed'
            ? <><span className="font-semibold">Dispersed</span> <span className="text-[var(--good)]">· recommended.</span> <span className="text-[#8A8A90]">Adds up your running surplus/deficit since the last check-in and spreads it evenly across the days left in the week. Gentle: one big day barely nudges any single day.</span></>
            : <><span className="font-semibold">Aggressive.</span> <span className="text-[#8A8A90]">Dumps your whole running surplus/deficit onto the next day (deficits and surpluses add up day over day), capped below. Faster to clear, but swings each day harder.</span></>}
        </div>
        <Field label={`Daily cap: ±${carry.capKcal} kcal`} hint="The most any single day can shift, whichever mode you pick."><input type="range" min="100" max="800" step="50" value={carry.capKcal} onChange={e => setCarry(c => Object.assign({}, c, { capKcal: +e.target.value }))} className="w-full accent-[#4A9EEB]" /></Field>
      </>}
    </Section>
    <Section title="High / low days">
      <div className="text-[12px] text-[#8A8A90] mb-3">Eat more on some days and less on others, same weekly total. Handy for weekends or training days.</div>
      <RowToggle label="Cycle calories across the week" on={cyc.enabled} onClick={() => setCyc(c => Object.assign({}, c, { enabled: !c.enabled }))} />
      {cyc.enabled && <>
        <div className="text-[11px] text-[#8A8A90] mb-2">Pick your high days. The rest come down to keep your weekly total the same.</div>
        <div className="flex gap-1.5 mb-3">{DOW.map((d, i) => { const on = cyc.highDays.includes(i); return <button key={i} onClick={() => setCyc(c => Object.assign({}, c, { highDays: on ? c.highDays.filter(x => x !== i) : c.highDays.concat([i]) }))} className={`flex-1 pixel-box py-2 text-[11px] ${on ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ boxShadow: 'none' }}>{d[0]}</button>; })}</div>
        <Field label={`High-day boost: +${Math.round(cyc.deltaPct * 100)}%`}><input type="range" min="5" max="35" value={Math.round(cyc.deltaPct * 100)} onChange={e => setCyc(c => Object.assign({}, c, { deltaPct: +e.target.value / 100 }))} className="w-full accent-[#4A9EEB]" /></Field>
        {base && <div className="grid grid-cols-7 gap-1 mt-1">{DOW.map((d, i) => { const k = base.kcal + E.cyclingDelta(Object.assign({}, cyc, { enabled: true }), i, base.kcal); const hi = cyc.highDays.includes(i); return <div key={i} className="text-center"><div className="text-[10px] text-[#8A8A90]">{d[0]}</div><div className={`text-[11px] tnum ${hi ? 'text-[#4A9EEB]' : 'text-white'}`}>{Math.round(k)}</div></div>; })}</div>}
      </>}
    </Section>
    <Section title="Custom calories & macros">
      <div className="text-[12px] text-[#8A8A90] mb-3">Ignore the engine and set your own numbers. Heads up: in Coached mode a check-in can still change these, so set Coaching mode to Manual above to lock them.</div>
      <RowToggle label="Set my own targets" on={manual.enabled} onClick={() => mset('enabled', !manual.enabled)} />
      {manual.enabled && <div className="grid grid-cols-2 gap-3">
        <Field label="Calories"><NumInput value={manual.kcal} onChange={e => mset('kcal', e.target.value)} /></Field>
        <Field label="Protein (g)"><NumInput value={manual.protein_g} onChange={e => mset('protein_g', e.target.value)} /></Field>
        <Field label="Carbs (g)"><NumInput value={manual.carbs_g} onChange={e => mset('carbs_g', e.target.value)} /></Field>
        <Field label="Fat (g)"><NumInput value={manual.fat_g} onChange={e => mset('fat_g', e.target.value)} /></Field>
      </div>}
    </Section>
    <SaveBar dirty={dirty} saved={saved} onSave={save} label="Save advanced settings" />
  </>);
}

function ProfileTab({ db, update, onFreshStart }) {
  const p = db.profile;
  const act = ACTIVITY.find(a => a.v === p.activityLevel) || ACTIVITY[2];
  const [edit, setEdit] = useState(false);
  const [saved, setSaved] = useState(false);
  const init = () => { const h = cmToFtIn(p.heightCm); return { sex: p.sex, age: p.age, heightCm: p.heightCm, ft: h.ft, inch: h.inch, activityLevel: p.activityLevel }; };
  const [f, setF] = useState(init);
  const fset = (k, v) => setF(x => Object.assign({}, x, { [k]: v }));
  const ftIn = p.height_unit === 'ft_in';
  function cancel() { setF(init()); setEdit(false); }
  function save() {
    update(d => {
      const np = Object.assign({}, d.profile, {
        sex: f.sex,
        age: Math.round(+f.age) || d.profile.age,
        heightCm: ftIn ? ftInToCm(+f.ft || 0, +f.inch || 0) : (Math.round(+f.heightCm) || d.profile.heightCm),
        activityLevel: f.activityLevel,
      });
      d.profile = np;
      // Keep the learned expenditure when it's recent; only fall back to the formula otherwise.
      const prior = learnedTdee(d, Store.todayISO());
      const nt = E.computeInitialTargets(withActivity(np), prior ? { priorTdee: prior } : undefined); nt.id = Store.uid(); nt.effective_date = Store.todayISO(); nt.source = 'profile-edit'; d.targets.push(nt);
    });
    setEdit(false); setSaved(true); setTimeout(() => setSaved(false), 2200);
  }
  if (edit) return (
    <Section title="Edit profile">
      <Field label="Sex"><Seg value={f.sex} onChange={v => fset('sex', v)} options={[{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }]} /></Field>
      <Field label="Age"><NumInput value={f.age} onChange={e => fset('age', e.target.value)} /></Field>
      <Field label="Height">{ftIn
        ? <div className="flex gap-2 items-center"><NumInput value={f.ft} onChange={e => fset('ft', e.target.value)} /><span className="text-[#8A8A90]">ft</span><NumInput value={f.inch} onChange={e => fset('inch', e.target.value)} /><span className="text-[#8A8A90]">in</span></div>
        : <div className="flex gap-2 items-center"><NumInput value={f.heightCm} onChange={e => fset('heightCm', e.target.value)} /><span className="text-[#8A8A90]">cm</span></div>}
      </Field>
      <Field label="Activity"><Dropdown value={f.activityLevel} onChange={v => fset('activityLevel', v)} options={ACTIVITY.map(a => ({ v: a.v, l: a.l }))} />
        <div className="text-[12px] text-[#8A8A90] mt-1.5 leading-snug">{(ACTIVITY.find(a => a.v === f.activityLevel) || act).d}</div>
      </Field>
      <div className="pixel-box p-3 text-[12px] text-[#8A8A90] leading-snug mb-4" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>Saving rebuilds today's calorie &amp; macro targets from these details. Your food log and weigh-in history stay put, weight and body fat only change at a check-in.</div>
      <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={save}>Save &amp; recalculate</Btn><Btn kind="ghost" onClick={cancel}>Cancel</Btn></div>
    </Section>
  );
  return (<>
    <Card className="p-5 mb-4">
      <Row2 k="Sex" v={p.sex === 'male' ? 'Male' : 'Female'} />
      <Row2 k="Age" v={p.age + ' years'} />
      <Row2 k="Height" v={fmtHeight(p.heightCm, p.height_unit)} />
      <Row2 k="Activity" v={act.l} />
      <Row2 k="Current weight" v={fmtWeight(p.weightKg, p.weight_unit)} />
      <Row2 k="Body fat" v={p.bodyFatPct != null ? p.bodyFatPct + '%' : '–'} />
      <Row2 k="Lean mass" v={fmtWeight(leanKg(p), p.weight_unit)} last />
    </Card>
    {saved && <div className="text-[12px] mb-3 fade-in" style={{ color: 'var(--good)' }}>Saved. Targets recalculated.</div>}
    <Btn kind="accent" className="w-full mb-3" onClick={() => { setF(init()); setEdit(true); }}>Edit details</Btn>
    <div className="text-[12px] text-[#8A8A90] mb-2 leading-snug">Editing these recalculates your targets and keeps your history. To change your weight or rebuild, use full setup.</div>
    <Btn kind="ghost" className="w-full" onClick={onFreshStart}>Full setup &amp; recalculate</Btn>
  </>);
}
// Change password while signed in. We re-verify the current password first (signInWithPassword)
// so a merely-unlocked session can't silently change someone's credentials.
function ChangePassword({ email }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [ok, setOk] = useState(false);
  function reset() { setCur(''); setPw(''); setPw2(''); setMsg(''); setOk(false); }
  async function save() {
    setMsg(''); setOk(false);
    if (pw.length < 6) { setMsg('Your new password must be at least 6 characters.'); return; }
    if (pw !== pw2) { setMsg("The new passwords don't match."); return; }
    if (!supa) { setMsg('You need to be online to change your password.'); return; }
    setBusy(true);
    try {
      const v = await supa.auth.signInWithPassword({ email, password: cur });
      if (v.error) throw new Error('Your current password is incorrect.');
      const r = await supa.auth.updateUser({ password: pw });
      if (r.error) throw r.error;
      setOk(true); setMsg('Password updated.'); setCur(''); setPw(''); setPw2('');
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  return (<div>
    <MenuRow label="Change password" onClick={() => { if (open) { setOpen(false); reset(); } else { reset(); setOpen(true); } }} right={open ? '⌄' : '›'} />
    {open && <div className="pixel-box p-4 mt-2 fade-in" style={{ background: 'var(--card)' }}>
      <Field label="Current password"><input type="password" autoComplete="current-password" className={inputCls} value={cur} onChange={e => setCur(e.target.value)} placeholder="current password" /></Field>
      <Field label="New password"><input type="password" autoComplete="new-password" className={inputCls} value={pw} onChange={e => setPw(e.target.value)} placeholder="at least 6 characters" /></Field>
      <Field label="Confirm new password"><input type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={e => setPw2(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="type it again" /></Field>
      {msg && <div className="text-[12px] mt-1 mb-1" style={{ color: ok ? 'var(--good)' : 'var(--danger)' }}>{msg}</div>}
      <div className="flex gap-2 mt-2">
        <Btn kind="accent" className="flex-1" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Update password'}</Btn>
        <Btn kind="ghost" onClick={() => { setOpen(false); reset(); }}>{ok ? 'Done' : 'Cancel'}</Btn>
      </div>
    </div>}
  </div>);
}
// ---- Support tickets / feature requests -----------------------------------------------------
// A signed-in user submits via the `support` edge function (which stores the row and emails us);
// they read back their own tickets directly (RLS returns only their rows) to track status + reply.
async function submitTicket({ kind, body }) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token;
  if (!token) throw new Error('Please sign in to send feedback.');
  const res = await fetch(SUPA_URL + '/functions/v1/support', {
    method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify({ kind, body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error((j.error && (j.error.message || j.error)) || ('Request failed (' + res.status + ')'));
  return j.ticket;
}
async function loadMyTickets() {
  if (!supa) return [];
  const r = await supa.from('support_tickets').select('id, kind, body, status, admin_reply, created_at, updated_at').order('created_at', { ascending: false });
  if (r.error) throw new Error(r.error.message);
  return r.data || [];
}
const TICKET_KINDS = [{ v: 'bug', l: 'Bug' }, { v: 'feature', l: 'Feature' }, { v: 'question', l: 'Question' }];
const TICKET_PLACEHOLDER = {
  bug: 'What went wrong, and what were you doing when it happened?',
  feature: 'What would you like Macrosaurus to do?',
  question: 'What can we help you with?',
};
function ticketKindLabel(k) { return k === 'bug' ? 'Bug' : k === 'feature' ? 'Feature request' : 'Question'; }
function ticketStatusMeta(s) {
  if (s === 'resolved') return { label: 'Resolved', color: 'var(--good)' };
  if (s === 'in_review') return { label: 'In review', color: 'var(--accent)' };
  return { label: 'Received', color: 'var(--muted)' };
}
// The user-facing feedback sheet: one message with a type picker, plus the user's own ticket
// history with live status and any reply. Opened from a MenuRow in Menu → Account.
function FeedbackSheet({ email, onClose }) {
  useBackClose(onClose);
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [tickets, setTickets] = useState(null);
  const refresh = () => loadMyTickets().then(setTickets, () => setTickets([]));
  useEffect(() => { refresh(); }, []);
  async function submit() {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await submitTicket({ kind, body });
      setText(''); setMsg("Thanks, we've got it. Any reply shows up below.");
      refresh();
    } catch (e) { setErr(e.message || 'Could not send. Please try again.'); }
    setBusy(false);
  }
  return (
    <div className="fixed inset-0 z-[85] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1"><h2 className="text-lg font-semibold">Send feedback</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none" aria-label="Close">×</button></div>
        <div className="text-[12px] text-[#8A8A90] mb-4 leading-relaxed">Report a bug, request a feature, or ask a question. We read every message{email ? ' and may reply to ' + email : ''}.</div>
        <Field label="Type"><Seg value={kind} options={TICKET_KINDS} onChange={setKind} /></Field>
        <Field label="Message">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={4000} className={inputCls + ' resize-y leading-relaxed'} placeholder={TICKET_PLACEHOLDER[kind]} />
        </Field>
        {err && <div className="text-[12px] mb-2" style={{ color: 'var(--danger)' }}>{err}</div>}
        {msg && <div className="text-[12px] mb-2" style={{ color: 'var(--good)' }}>{msg}</div>}
        <Btn kind="accent" className="w-full" disabled={!text.trim() || busy} style={{ opacity: (!text.trim() || busy) ? 0.5 : 1 }} onClick={submit}>{busy ? 'Sending…' : 'Send'}</Btn>
        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] pb-2 px-0.5">Your requests</div>
          {tickets === null ? <div className="py-4"><DinoLoader label="Loading" /></div>
            : tickets.length === 0 ? <div className="text-[12px] text-[#8A8A90]">Nothing yet. Anything you send shows up here with its status.</div>
              : <div className="space-y-2">{tickets.map(t => {
                const st = ticketStatusMeta(t.status);
                return (<div key={t.id} className="pixel-box p-3 bg-[#1E1E22]">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="pf text-[8px] uppercase px-1.5 py-0.5" style={{ color: st.color, border: '2px solid ' + st.color }}>{st.label}</span>
                    <span className="text-[10px] text-[#8A8A90]">{ticketKindLabel(t.kind)} · {adminFmtWhen(t.created_at)}</span>
                  </div>
                  <div className="text-[12px] whitespace-pre-wrap break-words">{t.body}</div>
                  {t.admin_reply && <div className="mt-2 pixel-box p-2.5 bg-[#0F0F12]" style={{ borderColor: 'var(--accent)' }}>
                    <div className="pf text-[8px] uppercase mb-1" style={{ color: 'var(--accent)' }}>Reply from Macrosaurus</div>
                    <div className="text-[12px] whitespace-pre-wrap break-words">{t.admin_reply}</div>
                  </div>}
                </div>);
              })}</div>}
        </div>
      </div>
    </div>
  );
}
function More({ db, update, onSignOut, onReset, onDeleteAccount, onFreshStart, email, isAdmin, onOpenAdmin, sub, isPremium, aiCalls, onUpgrade, onManage, rewards, showToast }) {
  const [tab, setTab] = useState('details');
  const [invite, setInvite] = useState(false);
  const daysLeft = (iso) => { if (!iso) return ''; const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000); return d > 0 ? d + ' day' + (d === 1 ? '' : 's') + ' left' : 'ends soon'; };
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };
  const freeLeft = Math.max(0, FREE_AI_MONTHLY - (aiCalls || 0));
  const [guide, setGuide] = useState(false);
  const [delOpen, setDelOpen] = useState(false); const [delText, setDelText] = useState(''); const [delBusy, setDelBusy] = useState(false); const [delErr, setDelErr] = useState('');
  const [resetOpen, setResetOpen] = useState(false); const [legal, setLegal] = useState(null);
  const [feedback, setFeedback] = useState(false);
  async function doDelete() { setDelBusy(true); setDelErr(''); try { await onDeleteAccount(); } catch (e) { setDelErr(e.message || 'Something went wrong.'); setDelBusy(false); } }
  function exportData() {
    try {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'macrosaurus-data-' + Store.todayISO() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { alert('Could not export: ' + (e.message || e)); }
  }
  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pb-28 lg:pb-12 pt-6 fade-in">
      <PageHeader kicker="Your profile & settings" title="You" />
      <div className="flex gap-1 mb-5 bg-[#1E1E22] p-1 rounded-2xl">{[['details', 'Profile'], ['settings', 'Settings'], ['advanced', 'Advanced'], ['account', 'Account']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2.5 text-[12px] transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}</button>)}</div>

      {tab === 'details' && <ProfileTab db={db} update={update} onFreshStart={onFreshStart} />}

      {tab === 'settings' && <SettingsTab db={db} update={update} />}
      {tab === 'advanced' && <AdvancedTab db={db} update={update} />}

      {tab === 'account' && <div className="space-y-2.5">
        <div className="pixel-box p-4" style={{ background: 'var(--card)' }}>
          <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-1">Signed in as</div>
          <div className="text-sm font-semibold break-all">{email || 'your account'}</div>
        </div>

        {isPremium ? (
          <div className="pixel-box p-4" style={{ background: 'var(--card)', borderColor: 'var(--accent)' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] uppercase tracking-widest pf" style={{ color: 'var(--accent)' }}>Premium</div>
              {sub && sub.status === 'trialing' && sub.trial_end && <div className="text-[10px] text-[#8A8A90]">Trial: {daysLeft(sub.trial_end)}</div>}
            </div>
            <div className="text-sm font-semibold mb-1">{sub && sub.status === 'trialing' ? 'Free trial active' : 'Premium active'}{sub && sub.plan ? ' · ' + (sub.plan === 'annual' ? 'Annual' : 'Monthly') : ''}</div>
            <div className="text-[11px] text-[#8A8A90] mb-3 leading-relaxed">{sub && sub.cancel_at_period_end ? 'Cancels at the end of the current period.' : (sub && sub.current_period_end ? 'Renews ' + fmtDate(sub.current_period_end) + '.' : 'Unlimited AI logging and body-fat scans.')}</div>
            <button onClick={onManage} className="w-full pixel-btn py-2.5 text-[11px] pf" style={{ background: 'var(--surface2)', color: 'var(--text)' }}>MANAGE SUBSCRIPTION</button>
          </div>
        ) : (
          <div className="pixel-box p-4" style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent)' }}>
            <div className="text-[11px] uppercase tracking-widest pf mb-1" style={{ color: 'var(--accent)' }}>Free plan</div>
            <div className="text-sm font-semibold mb-1">Try Premium free for 7 days</div>
            <div className="text-[11px] text-[#8A8A90] mb-3 leading-relaxed">{freeLeft} of {FREE_AI_MONTHLY} free AI logs left this month{rewards && rewards.bonus_ai_remaining > 0 ? ', plus ' + rewards.bonus_ai_remaining + ' bonus from referrals' : ''}. Premium unlocks unlimited AI logging and body-fat scans. 7 days free, then cancel anytime.</div>
            <button onClick={onUpgrade} className="w-full pixel-btn py-2.5 text-[11px] pf" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>START FREE TRIAL</button>
          </div>
        )}

        {isAdmin && <MenuRow label="Admin panel" desc="Manage users, AI limits and support" tone="accent" onClick={onOpenAdmin} />}
        <MenuRow label="Invite friends, get free AI logs" desc={'You and a friend each get 5 free AI logs and a rare dino' + (rewards && rewards.referrals_count ? ' · ' + rewards.referrals_count + ' joined so far' : '')} tone="accent" onClick={() => setInvite(true)} />
        <InstallMenuRow />
        <ChangePassword email={email} />
        <MenuRow label="Replay the intro tour" desc="How Macrosaurus adapts your plan, logging and check-ins" onClick={() => setGuide(true)} />
        <MenuRow label="Export my data" desc="Download a JSON backup of everything" onClick={exportData} />
        <MenuRow label="Sign out" onClick={onSignOut} />

        <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] pt-4 pb-1 px-1">Help & feedback</div>
        <MenuRow label="Send feedback or get help" desc="Report a bug or request a feature" onClick={() => setFeedback(true)} />

        <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] pt-4 pb-1 px-1">Legal & privacy</div>
        <MenuRow label="Privacy Policy" desc="What we collect and your rights" onClick={() => setLegal('privacy')} />
        <MenuRow label="Terms of Use" desc="The rules for using Macrosaurus" onClick={() => setLegal('terms')} />
        <MenuRow label="Health disclaimer" desc="Macrosaurus is not medical advice" onClick={() => setLegal('health')} />

        <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] pt-4 pb-1 px-1">Danger zone</div>
        <MenuRow label="Reset all data" desc="Wipe your data and start over, keeps your login" tone="danger" onClick={() => setResetOpen(true)} />
        <MenuRow label="Delete account" desc="Permanently remove your account and all data" tone="danger" onClick={() => { setDelOpen(true); setDelText(''); setDelErr(''); }} />

        <div className="text-[11px] text-[#8A8A90]/70 pt-4 text-center">{BRAND} · your data syncs to your account</div>
      </div>}
      {resetOpen && <ConfirmDialog title="Reset all data & start over?" body="This wipes your profile, food log, weigh-ins and history, then returns you to setup. Your login stays. This cannot be undone, so export your data first if you want a copy." confirmLabel="Reset everything" onConfirm={onReset} onClose={() => setResetOpen(false)} />}
      {legal && <LegalDoc doc={legal} onClose={() => setLegal(null)} />}
      {delOpen && <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => { setDelOpen(false); setDelErr(''); }}>
        <div className="w-full max-w-sm pixel-box p-5 fade-in" style={{ background: '#0F0F12' }} onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--danger)' }}>Delete your account?</h2>
          <div className="text-[12px] text-[#8A8A90] mb-3 leading-relaxed">This permanently erases your account and all of your data, and cannot be undone. You would need to sign up again to come back. Type <span className="font-bold text-white">DELETE</span> to confirm.</div>
          <TextInput value={delText} onChange={e => setDelText(e.target.value)} placeholder="DELETE" />
          {delErr && <div className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{delErr}</div>}
          <div className="flex gap-2 mt-4">
            <Btn kind="ghost" className="flex-1" onClick={() => { setDelOpen(false); setDelErr(''); }}>Cancel</Btn>
            <Btn kind="danger" className="flex-1" disabled={delText.trim().toUpperCase() !== 'DELETE' || delBusy} style={{ opacity: (delText.trim().toUpperCase() !== 'DELETE' || delBusy) ? 0.5 : 1 }} onClick={doDelete}>{delBusy ? 'Deleting…' : 'Delete forever'}</Btn>
          </div>
        </div>
      </div>}
      {guide && <WelcomeCarousel reviewing theme={(db.profile && db.profile.theme) || 'light'} onDone={() => setGuide(false)} />}
      {feedback && <FeedbackSheet email={email} onClose={() => setFeedback(false)} />}
      {invite && <InviteSheet rewards={rewards} onClose={() => setInvite(false)} toast={showToast} />}
    </div>
  );
}
function Row2({ k, v, last }) { return (<div className={`flex justify-between items-center py-2.5 ${last ? '' : 'border-b border-[#262629]'}`}><span className="text-[#8A8A90] text-sm">{k}</span><span className="font-medium tnum">{v}</span></div>); }
// A clean, tappable settings row: label (+ optional description) on the left, chevron on the right.
function MenuRow({ label, desc, onClick, tone, right }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'accent' ? 'var(--accent)' : 'var(--text)';
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between gap-3 pixel-box p-3.5 text-left active:scale-[.99] transition" style={{ background: 'var(--card)' }}>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color }}>{label}</div>
        {desc && <div className="text-[11px] text-[#8A8A90] mt-0.5 leading-snug">{desc}</div>}
      </div>
      <span className="text-[#8A8A90] shrink-0 text-lg leading-none">{right || '›'}</span>
    </button>
  );
}

/* =====================================================================
   ADMIN, owner/admin-only support panel. All privileged reads/writes go through the
   `admin-api` edge function, which re-checks admin status server-side and logs every action.
   The UI here is only a convenience gate: security does NOT depend on it being hidden.
   ===================================================================== */
async function adminCall(action, payload) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token;
  if (!token) throw new Error('Not signed in.');
  const res = await fetch(SUPA_URL + '/functions/v1/admin-api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error((j.error && (j.error.message || j.error)) || ('Request failed (' + res.status + ')'));
  return j;
}
// This month's AI spend split by model (admin only). Separate lightweight endpoint so it can never
// affect the main admin actions. Returns { modelUsage: [{ model, spend_usd, calls }] }.
async function adminUsage() {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token; if (!token) return { modelUsage: [] };
  const res = await fetch(SUPA_URL + '/functions/v1/admin-usage', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY }, body: '{}' });
  return await res.json().catch(() => ({ modelUsage: [] }));
}
function modelLabel(m) { return !m ? 'Other' : (m.indexOf('haiku') !== -1 ? 'Haiku (label OCR)' : m.indexOf('sonnet') !== -1 ? 'Sonnet (estimates)' : m); }
function adminFmtDate(s) { try { return s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'unknown'; } catch (e) { return 'unknown'; } }
function adminFmtWhen(s) { try { return s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'; } catch (e) { return 'unknown'; } }

// Admin billing/tiers endpoint (raw fetch like adminCall, so no CORS preflight headers needed).
async function adminBilling(action, payload) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token; if (!token) throw new Error('Not signed in.');
  const res = await fetch(SUPA_URL + '/functions/v1/admin-billing', {
    method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error((j.error && (j.error.message || j.error)) || ('Request failed (' + res.status + ')'));
  return j;
}
// Admin support-ticket triage endpoint (raw fetch like adminCall). list_tickets / open_count /
// set_ticket_status / reply_ticket, all admin-gated + audited server-side.
async function adminSupport(action, payload) {
  const sess = supa ? (await supa.auth.getSession()).data.session : null;
  const token = sess && sess.access_token; if (!token) throw new Error('Not signed in.');
  const res = await fetch(SUPA_URL + '/functions/v1/admin-support', {
    method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token, 'apikey': SUPA_KEY },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error((j.error && (j.error.message || j.error)) || ('Request failed (' + res.status + ')'));
  return j;
}
// Support tab: users' bug reports / feature requests / questions, with status + reply controls.
function AdminSupport() {
  const [tickets, setTickets] = useState(null); const [err, setErr] = useState('');
  const [filter, setFilter] = useState('open'); // 'open' = anything not resolved
  function load() {
    setTickets(null); setErr('');
    const payload = (filter === 'open' || filter === 'all') ? {} : { status: filter };
    adminSupport('list_tickets', payload).then(j => {
      let rows = j.tickets || [];
      if (filter === 'open') rows = rows.filter(t => t.status !== 'resolved');
      setTickets(rows);
    }, e => setErr(e.message));
  }
  useEffect(() => { load(); }, [filter]);
  function patch(updated) { setTickets(ts => (ts || []).map(t => t.id === updated.id ? updated : t)); }
  const FILTERS = [['open', 'Open'], ['received', 'New'], ['in_review', 'In review'], ['resolved', 'Resolved'], ['all', 'All']];
  return (<div className="fade-in">
    <div className="text-[11px] text-[#8A8A90] mb-3 leading-relaxed">Bug reports, feature requests and questions from users. Set a status or write a reply, and the user sees both in the app. You're also emailed at olly@macrosaurus.com when a new one lands.</div>
    <div className="flex gap-1 mb-3 overflow-x-auto">{FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`pf text-[8px] uppercase px-2.5 py-1.5 shrink-0 ${filter === k ? 'bg-white text-black' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ border: '2px solid var(--border)' }}>{l}</button>)}</div>
    {err && <div className="text-[12px] mb-3" style={{ color: 'var(--danger)' }}>{err}</div>}
    {!tickets ? <div className="mt-6"><DinoLoader label="Loading tickets" /></div>
      : !tickets.length ? <div className="text-[12px] text-[#8A8A90] mt-4">No tickets here{filter !== 'all' ? ' for this filter' : ''}.</div>
        : <div className="space-y-2">{tickets.map(t => <AdminTicketCard key={t.id} ticket={t} onPatch={patch} />)}</div>}
  </div>);
}
function AdminTicketCard({ ticket, onPatch }) {
  const t = ticket;
  const [reply, setReply] = useState(t.admin_reply || '');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const st = ticketStatusMeta(t.status);
  async function setStatus(status) { if (status === t.status) return; setBusy('status'); setErr(''); try { const j = await adminSupport('set_ticket_status', { ticketId: t.id, status }); onPatch(j.ticket); } catch (e) { setErr(e.message); } setBusy(''); }
  async function sendReply() { const r = reply.trim(); if (!r) return; setBusy('reply'); setErr(''); try { const j = await adminSupport('reply_ticket', { ticketId: t.id, reply: r }); onPatch(j.ticket); } catch (e) { setErr(e.message); } setBusy(''); }
  return (<div className="pixel-box p-3 bg-[#1E1E22]">
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="pf text-[8px] uppercase px-1.5 py-0.5" style={{ color: st.color, border: '2px solid ' + st.color }}>{st.label}</span>
      <span className="text-[10px] text-[#8A8A90]">{ticketKindLabel(t.kind)} · {adminFmtWhen(t.created_at)}</span>
    </div>
    <div className="text-[11px] text-[#8A8A90] mb-1 break-all">{t.email || 'unknown'}</div>
    <div className="text-[13px] whitespace-pre-wrap break-words mb-3">{t.body}</div>
    <div className="flex gap-1 mb-2">{[['received', 'New'], ['in_review', 'In review'], ['resolved', 'Resolved']].map(([k, l]) => <button key={k} onClick={() => setStatus(k)} disabled={busy === 'status'} className={`pf text-[8px] uppercase px-2 py-1 shrink-0 ${t.status === k ? 'bg-white text-black' : 'bg-[#0F0F12] text-[#8A8A90]'}`} style={{ border: '2px solid var(--border)' }}>{l}</button>)}</div>
    <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} maxLength={4000} className={inputCls + ' resize-y leading-relaxed text-[12px]'} placeholder="Write a reply (the user sees this; sending resolves the ticket)…" />
    <div className="flex justify-between items-center mt-2 gap-2">
      {err ? <span className="text-[11px]" style={{ color: 'var(--danger)' }}>{err}</span> : <span />}
      <Btn kind="accent" disabled={busy === 'reply' || !reply.trim()} onClick={sendReply}>{busy === 'reply' ? 'Sending…' : (t.admin_reply ? 'Update reply' : 'Reply & resolve')}</Btn>
    </div>
  </div>);
}
// Global free/premium tier controls: enforcement toggle + the free AI count and premium ceiling.
function AdminTiers() {
  const [cfg, setCfg] = useState(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [free, setFree] = useState(''); const [pcap, setPcap] = useState('');
  useEffect(() => { adminBilling('get_config').then(c => { setCfg(c); setFree(String(c.free_ai_monthly)); setPcap(String(c.premium_cap_usd)); }, e => setErr(e.message)); }, []);
  async function toggleEnforce() {
    setBusy(true); setErr(''); setMsg('');
    try { const c = await adminBilling('set_config', { enforceTiers: !cfg.enforce_tiers }); setCfg(c); setMsg(c.enforce_tiers ? 'Tiering ON: free users are limited, premium is unlimited.' : 'Tiering OFF: everyone uses the legacy AI cap.'); }
    catch (e) { setErr(e.message); } setBusy(false);
  }
  async function saveNums() {
    const f = Number(free), p = Number(pcap);
    if (!isFinite(f) || f < 0 || !isFinite(p) || p < 0) { setErr('Enter valid numbers.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try { const c = await adminBilling('set_config', { freeAiMonthly: f, premiumCap: p }); setCfg(c); setFree(String(c.free_ai_monthly)); setPcap(String(c.premium_cap_usd)); setMsg('Saved.'); }
    catch (e) { setErr(e.message); } setBusy(false);
  }
  if (!cfg) return <Section title="Premium & tiers" className="mt-6"><div className="text-[12px] text-[#8A8A90]">{err || 'Loading…'}</div></Section>;
  return (
    <Section title="Premium & tiers" className="mt-6">
      <div className="flex items-center justify-between gap-3 pixel-box p-3 bg-[#1E1E22] mb-3">
        <div className="min-w-0"><div className="text-[13px] font-semibold">Enforce free / premium tiers</div><div className="text-[11px] text-[#8A8A90] leading-snug">On: free users get {cfg.free_ai_monthly} AI logs/month and body-fat is premium-only; premium is unlimited (fair-use ${cfg.premium_cap_usd.toFixed(2)}). Off: legacy cap for all. You are always exempt.</div></div>
        <button onClick={toggleEnforce} disabled={busy} className="shrink-0 pixel-btn px-4 py-2 text-[11px] pf disabled:opacity-50" style={{ background: cfg.enforce_tiers ? 'var(--good)' : 'var(--surface2)', color: cfg.enforce_tiers ? '#05140a' : 'var(--text)' }}>{cfg.enforce_tiers ? 'ON' : 'OFF'}</button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div><div className="text-[11px] text-[#8A8A90] mb-1">Free AI logs / month</div><TextInput value={free} onChange={e => setFree(e.target.value)} placeholder="10" /></div>
        <div><div className="text-[11px] text-[#8A8A90] mb-1">Premium ceiling ($/mo)</div><TextInput value={pcap} onChange={e => setPcap(e.target.value)} placeholder="3.00" /></div>
      </div>
      <Btn kind="accent" disabled={busy} onClick={saveNums}>{busy ? 'Saving…' : 'Save tier limits'}</Btn>
      {msg && <div className="text-[11px] mt-2" style={{ color: 'var(--good)' }}>{msg}</div>}
      {err && <div className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{err}</div>}
    </Section>
  );
}
// Per-user complimentary Premium grant/revoke (shown inside a user's detail).
function AdminUserPremium({ userId }) {
  const [state, setState] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const load = () => adminBilling('get_premium', { userId }).then(setState, e => setErr(e.message));
  useEffect(() => { setState(null); setMsg(''); setErr(''); load(); }, [userId]);
  async function toggle(make) { setBusy(true); setErr(''); setMsg(''); try { await adminBilling('set_premium', { userId, premium: make }); await load(); setMsg(make ? 'Premium granted (complimentary).' : 'Premium revoked.'); } catch (e) { setErr(e.message); } setBusy(false); }
  const premium = !!(state && state.premium); const comp = !!(state && state.comp);
  const status = state && state.subscription && state.subscription.status;
  const label = !state ? '…' : premium ? (comp ? 'Premium (complimentary)' : status === 'trialing' ? 'Premium (trial)' : 'Premium (Stripe)') : (status === 'canceled' ? 'Free (was subscribed)' : 'Free');
  return (
    <Section title="Subscription">
      <Row2 k="Plan" v={label} last />
      <div className="text-[12px] text-[#8A8A90] mt-3 mb-2">Grant complimentary Premium (no charge, no Stripe) or revoke it. A paid Stripe subscription is managed by the customer and re-syncs automatically.</div>
      {premium
        ? <Btn kind="ghost" className="w-full" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => toggle(false)}>{busy ? 'Working…' : 'Revoke Premium'}</Btn>
        : <Btn kind="ghost" className="w-full" style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--border)' }} disabled={busy} onClick={() => toggle(true)}>{busy ? 'Working…' : 'Grant Premium (free)'}</Btn>}
      {msg && <div className="text-[11px] mt-2" style={{ color: 'var(--good)' }}>{msg}</div>}
      {err && <div className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{err}</div>}
    </Section>
  );
}
function AdminStat({ label, value, sub }) {
  return (<div className="pixel-box p-3 bg-[#1E1E22]"><div className="text-[11px] text-[#8A8A90]">{label}</div><div className="text-xl font-bold tnum mt-0.5">{value}</div>{sub && <div className="text-[10px] text-[#8A8A90] mt-0.5">{sub}</div>}</div>);
}
function AdminAudit() {
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { adminCall('list_audit').then(j => setRows(j.audit || []), e => setErr(e.message)); }, []);
  if (err) return <div className="text-[12px] mt-4" style={{ color: 'var(--danger)' }}>{err}</div>;
  if (!rows) return <div className="mt-6"><DinoLoader label="Loading log" /></div>;
  if (!rows.length) return <div className="text-[12px] text-[#8A8A90] mt-4">No admin actions logged yet.</div>;
  const L = { view_user: 'viewed', set_cap: 'set cap for', set_config: 'set default cap', grant_admin: 'made admin', revoke_admin: 'revoked admin from', suspend_user: 'suspended', unsuspend_user: 'reinstated', add_note: 'noted', delete_note: 'deleted note for', update_state: 'edited data of', reset_user: 'reset data of', reset_usage: 'reset usage of', delete_user: 'deleted', resend_confirmation: 'resent confirm to', set_password: 'set password for', view_ai_logs: 'browsed AI logs', view_ai_log: 'opened an AI log for', clear_ai_logs: 'cleared AI logs' };
  return (<div className="fade-in mt-1 space-y-1.5">
    {rows.map(r => (<div key={r.id} className="pixel-box p-2.5 bg-[#1E1E22]">
      <div className="text-[12px]"><span className="font-medium">{(r.admin_email || 'admin').split('@')[0]}</span> <span className="text-[#8A8A90]">{L[r.action] || r.action}</span>{r.target_email && <> <span className="font-medium">{r.target_email.split('@')[0]}</span></>}{r.meta && r.meta.cap != null && <span className="text-[#8A8A90]"> → ${Number(r.meta.cap).toFixed(2)}</span>}{r.meta && r.meta.default_cap_usd != null && <span className="text-[#8A8A90]"> → ${Number(r.meta.default_cap_usd).toFixed(2)}</span>}</div>
      <div className="text-[10px] text-[#8A8A90] mt-0.5">{adminFmtWhen(r.created_at)}</div>
    </div>))}
  </div>);
}
function aiFeatureLabel(f) { return f === 'meal' ? 'Meal estimate' : f === 'label' ? 'Label scan' : f === 'coach' ? 'Coach note' : f === 'other' ? 'Other' : f; }
function aiFeatureColor(f) { return f === 'meal' ? 'var(--carb)' : f === 'label' ? 'var(--pro)' : f === 'coach' ? 'var(--good)' : 'var(--muted)'; }
// Browse the AI proxy's request/response log so the owner can vet prompts, input images and results
// and tune the AI features. Metadata comes back in the list; images/prompt/result load per-row on tap.
function AdminAiLogs() {
  const [logs, setLogs] = useState(null); const [err, setErr] = useState('');
  const [feature, setFeature] = useState('all');
  const [sel, setSel] = useState(null); const [selLoading, setSelLoading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false); const [clearing, setClearing] = useState(false);
  function load() { setLogs(null); setErr(''); adminCall('list_ai_logs', { feature }).then(j => setLogs(j.logs || []), e => setErr(e.message)); }
  useEffect(() => { load(); }, [feature]);
  async function open(id) { setSelLoading(true); try { const j = await adminCall('get_ai_log', { logId: id }); setSel(j.log); } catch (e) { setErr(e.message); } setSelLoading(false); }
  async function clearAll() { setClearing(true); try { await adminCall('clear_ai_logs'); setConfirmClear(false); load(); } catch (e) { setErr(e.message); } setClearing(false); }
  const FILTERS = [['all', 'All'], ['meal', 'Meals'], ['label', 'Labels'], ['coach', 'Coach'], ['other', 'Other']];
  return (<div className="fade-in">
    <div className="text-[11px] text-[#8A8A90] mb-3 leading-relaxed">Every AI request, its prompt, input images and result, from the label scanner, meal estimator and coach. Use it to vet quality and tune the prompts. Body-fat photo reads are never logged, and everything auto-clears after 30 days.</div>
    <div className="flex gap-1 mb-3 overflow-x-auto">{FILTERS.map(([k, l]) => <button key={k} onClick={() => setFeature(k)} className={`pf text-[8px] uppercase px-2.5 py-1.5 shrink-0 ${feature === k ? 'bg-white text-black' : 'bg-[#1E1E22] text-[#8A8A90]'}`} style={{ border: '2px solid var(--border)' }}>{l}</button>)}</div>
    {err && <div className="text-[12px] mb-3" style={{ color: 'var(--danger)' }}>{err}</div>}
    {!logs ? <div className="mt-6"><DinoLoader label="Loading logs" /></div>
      : !logs.length ? <div className="text-[12px] text-[#8A8A90] mt-4">No AI calls logged yet{feature !== 'all' ? ' for this filter' : ''}. They show up here as people use the AI features.</div>
        : <div className="space-y-2">
          {logs.map(r => (
            <button key={r.id} onClick={() => open(r.id)} className="w-full text-left pixel-box p-3 bg-[#1E1E22] active:scale-[.99] transition">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="pf text-[8px] uppercase px-1.5 py-0.5" style={{ color: aiFeatureColor(r.feature), border: '2px solid ' + aiFeatureColor(r.feature) }}>{aiFeatureLabel(r.feature)}</span>
                <span className="text-[10px] text-[#8A8A90]">{adminFmtWhen(r.created_at)}</span>
              </div>
              <div className="text-[12px] truncate">{(r.email || 'unknown').split('@')[0]}{r.status === 'error' && <span className="text-[10px] ml-1.5" style={{ color: 'var(--danger)' }}>error</span>}</div>
              <div className="text-[10px] text-[#8A8A90] tnum mt-0.5">{r.image_count > 0 ? r.image_count + ' img · ' : ''}{modelLabel(r.model)}{r.cost_usd ? ' · $' + (+r.cost_usd).toFixed(4) : ''}</div>
            </button>
          ))}
          <button onClick={() => setConfirmClear(true)} className="text-[11px] text-[#8A8A90] mt-3 w-full text-center py-2">Clear all logs</button>
        </div>}
    {selLoading && <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center"><DinoLoader label="Opening" /></div>}
    {sel && <AdminAiLogDetail log={sel} onClose={() => setSel(null)} onImage={setLightbox} />}
    {lightbox && <div className="fixed inset-0 z-[95] bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}><img src={lightbox} className="max-w-full max-h-full" alt="AI input" /></div>}
    {confirmClear && <ConfirmDialog title="Clear all AI logs?" body="This permanently deletes every logged prompt, image and result across all users. It does not touch anyone's own data or their macros." confirmLabel={clearing ? 'Clearing…' : 'Clear all'} onConfirm={clearAll} onClose={() => setConfirmClear(false)} />}
  </div>);
}
function AdminAiLogDetail({ log, onClose, onImage }) {
  useBackClose(onClose);
  let resultDisplay = log.result || '(no result)';
  try { resultDisplay = JSON.stringify(JSON.parse(log.result), null, 2); } catch (e) { /* not JSON, show raw */ }
  return (
    <div className="fixed inset-0 z-[85] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md pixel-box p-5 max-h-[90vh] overflow-y-auto sheet-up" style={{ paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-1"><h2 className="text-lg font-semibold">{aiFeatureLabel(log.feature)}</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>
        <div className="text-[11px] text-[#8A8A90] mb-4 break-words">{(log.email || 'unknown')} · {adminFmtWhen(log.created_at)} · {modelLabel(log.model)}{log.status === 'error' ? ' · error' : ''}</div>
        {log.images && log.images.length > 0 && <div className="mb-4">
          <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Input images ({log.images.length})</div>
          <div className="grid grid-cols-3 gap-2">{log.images.map((src, i) => <button key={i} onClick={() => onImage(src)} className="pixel-box overflow-hidden p-0" style={{ aspectRatio: '1', boxShadow: 'none' }}><img src={src} className="w-full h-full object-cover" alt={'input ' + (i + 1)} /></button>)}</div>
          <div className="text-[10px] text-[#8A8A90] mt-1.5">Tap to enlarge.</div>
        </div>}
        <div className="mb-4">
          <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Result</div>
          <pre className="text-[11px] whitespace-pre-wrap break-words bg-[#161618] pixel-box p-3" style={{ boxShadow: 'none' }}>{resultDisplay}</pre>
        </div>
        <details>
          <summary className="pf text-[8px] uppercase text-[#8A8A90] cursor-pointer">Prompt sent ▾</summary>
          <pre className="text-[10px] whitespace-pre-wrap break-words bg-[#161618] pixel-box p-3 mt-2" style={{ boxShadow: 'none', color: '#8A8A90' }}>{log.prompt || '(none)'}</pre>
        </details>
        <div className="text-[10px] text-[#8A8A90] tnum mt-4 pt-3 border-t border-[#262629]">{(log.input_tokens || 0) + ' tokens in · ' + (log.output_tokens || 0) + ' out'}{log.cost_usd ? ' · $' + (+log.cost_usd).toFixed(5) : ''}</div>
      </div>
    </div>
  );
}
function AdminPanel({ onBack, adminEmail, update }) {
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true); const [err, setErr] = useState('');
  const [devMsg, setDevMsg] = useState('');
  const [supportOpen, setSupportOpen] = useState(0); // unresolved ticket count, for the tab badge
  useEffect(() => { adminSupport('open_count').then(j => setSupportOpen(j.open || 0), () => {}); }, [tab]);
  // Reset the Dino Fight day-gate on your OWN account, through the normal sync path, so a fresh
  // ladder attempt (and this week's boss) is available again for testing.
  function resetBattle() { update(d => { d.fight = d.fight || {}; d.fight.lastAttemptDate = null; d.fight.lastBossWeek = null; }); setDevMsg("Done. Today's ladder attempt and this week's boss are available again on your account."); }
  const [users, setUsers] = useState([]); const [defaultCap, setDefaultCap] = useState(1); const [modelUsage, setModelUsage] = useState([]);
  const [q, setQ] = useState(''); const [sel, setSel] = useState(null); const [selLoading, setSelLoading] = useState(false);
  const [capInput, setCapInput] = useState(''); const [capBusy, setCapBusy] = useState(false); const [capMsg, setCapMsg] = useState('');
  async function loadList() { setLoading(true); setErr(''); try { const j = await adminCall('list_users'); setUsers(j.users || []); setDefaultCap(j.defaultCap || 1); setCapInput(String(j.defaultCap || 1)); try { const m = await adminUsage(); setModelUsage(m.modelUsage || []); } catch (e) {} } catch (e) { setErr(e.message); } setLoading(false); }
  useEffect(() => { loadList(); }, []);
  async function openUser(id) { setSelLoading(true); setErr(''); try { const j = await adminCall('get_user', { userId: id }); setSel(j); } catch (e) { setErr(e.message); } setSelLoading(false); }
  async function saveDefaultCap() { const c = Number(capInput); if (!isFinite(c) || c < 0) { setCapMsg('Enter a valid amount.'); return; } setCapBusy(true); setCapMsg(''); try { const j = await adminCall('set_config', { defaultCap: c }); setDefaultCap(Number(j.default_cap_usd)); setCapMsg('Saved. New/unlimited users default to $' + Number(j.default_cap_usd).toFixed(2) + '/mo.'); } catch (e) { setCapMsg(e.message); } setCapBusy(false); }
  if (sel) return <AdminUserDetail detail={sel} adminEmail={adminEmail} onBack={() => { setSel(null); loadList(); }} reload={() => openUser(sel.user.id)} />;

  const within = (s, n) => s && (Date.now() - new Date(s).getTime()) <= n * 86400000;
  const meLower = (adminEmail || '').toLowerCase();
  const total = users.length;
  const unconfirmed = users.filter(u => !u.confirmed).length;
  const signups7 = users.filter(u => within(u.created_at, 7)).length;
  const active7 = users.filter(u => within(u.last_sign_in_at, 7)).length;
  const totalSpend = users.reduce((a, u) => a + (u.spend_usd || 0), 0);
  const totalCalls = users.reduce((a, u) => a + (u.calls || 0), 0);
  const overCap = users.filter(u => u.spend_usd >= u.cap_usd && (u.email || '').toLowerCase() !== meLower).length;
  const filtered = users.filter(u => !q || (u.email || '').toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.spend_usd - a.spend_usd);

  return (
    <div className="max-w-md lg:max-w-3xl mx-auto px-5 pb-28 lg:pb-12 pt-6 fade-in">
      <button onClick={onBack} className="text-[12px] text-[#8A8A90] mb-2">← Back to menu</button>
      <PageHeader kicker="Admin" title="Control room" />
      <div className="flex gap-1 mb-4 bg-[#1E1E22] p-1 rounded-2xl">{[['overview', 'Overview'], ['support', 'Support'], ['users', 'Users'], ['ailogs', 'AI logs'], ['audit', 'Audit log']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2 text-[12px] transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}{k === 'support' && supportOpen > 0 && <span className="ml-1 text-[10px] px-1 rounded" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{supportOpen}</span>}</button>)}</div>
      {err && <div className="text-[12px] mb-3" style={{ color: 'var(--danger)' }}>{err}</div>}
      {loading ? <div className="mt-6"><DinoLoader label="Loading" /></div> : <>
        {tab === 'overview' && <div className="fade-in">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <AdminStat label="Total users" value={total} sub={unconfirmed ? unconfirmed + ' unconfirmed' : 'all confirmed'} />
            <AdminStat label="New · 7 days" value={signups7} sub={active7 + ' active this wk'} />
            <AdminStat label="AI spend · mo" value={'$' + totalSpend.toFixed(2)} sub={totalCalls + ' call' + (totalCalls === 1 ? '' : 's')} />
            <AdminStat label="At/over cap" value={overCap} sub="this month" />
          </div>
          {modelUsage.length > 0 && <Section title="Spend by model" className="mt-6">
            <div className="space-y-2">{modelUsage.map(m => (
              <div key={m.model} className="flex items-center justify-between text-[12px]">
                <span>{modelLabel(m.model)}</span>
                <span className="tnum text-[#8A8A90]">${(+m.spend_usd).toFixed(3)} · {m.calls} call{m.calls === 1 ? '' : 's'}</span>
              </div>))}</div>
            <div className="text-[11px] text-[#8A8A90] mt-3">Haiku runs the cheap label OCR; Sonnet runs meal estimates and body-fat reads. Tracked from this update, so it can sit below the historical total above.</div>
          </Section>}
          <Section title="Cost controls" className="mt-6">
            <div className="text-[12px] text-[#8A8A90] mb-2">Global default monthly AI cap for any user without a custom limit. Your own account is always exempt.</div>
            <div className="flex gap-2"><TextInput value={capInput} onChange={e => setCapInput(e.target.value)} placeholder="1.00" className="flex-1" /><Btn kind="accent" disabled={capBusy} onClick={saveDefaultCap}>{capBusy ? 'Saving…' : 'Save default'}</Btn></div>
            {capMsg && <div className="text-[11px] mt-2" style={{ color: 'var(--muted)' }}>{capMsg}</div>}
            <div className="text-[11px] text-[#8A8A90] mt-3">Current default ${defaultCap.toFixed(2)}/mo · total spend across all users this month ${totalSpend.toFixed(2)}.</div>
          </Section>
          <AdminTiers />
          <Section title="Dev tools" className="mt-6">
            <div className="text-[12px] text-[#8A8A90] mb-2">Reset the Dino Fight day-gate on your own account so you can test again. This clears today's ladder attempt and re-arms this week's boss, nothing else changes.</div>
            <Btn kind="accent" onClick={resetBattle}>Reset today's battle</Btn>
            {devMsg && <div className="text-[11px] mt-2" style={{ color: 'var(--good)' }}>{devMsg}</div>}
          </Section>
        </div>}
        {tab === 'users' && <div className="fade-in">
          <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search by email…" />
          <div className="mt-4 space-y-2">
            {filtered.map(u => (
              <button key={u.id} onClick={() => openUser(u.id)} className="w-full text-left pixel-box p-3 bg-[#1E1E22] active:scale-[.99] transition">
                <div className="flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{u.email}{u.is_admin && <span className="text-[10px] ml-1.5 px-1 rounded" style={{ background: 'var(--pro)', color: '#fff' }}>admin</span>}{u.banned && <span className="text-[10px] ml-1.5 px-1 rounded" style={{ background: 'var(--danger)', color: '#fff' }}>suspended</span>}{!u.confirmed && <span className="text-[10px] ml-1.5 px-1 rounded" style={{ background: 'var(--fat)', color: '#fff' }}>unconfirmed</span>}</div>
                    <div className="text-[11px] text-[#8A8A90]">{u.hasProfile ? (u.goal || 'profile set') : 'no profile'} · joined {adminFmtDate(u.created_at)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] tnum" style={{ color: u.spend_usd >= u.cap_usd ? 'var(--danger)' : 'var(--muted)' }}>${u.spend_usd.toFixed(2)}/${u.cap_usd.toFixed(2)}</div>
                    <div className="text-[10px] text-[#8A8A90]">{u.calls} call{u.calls === 1 ? '' : 's'} this mo.</div>
                  </div>
                </div>
              </button>
            ))}
            {!filtered.length && <div className="text-[12px] text-[#8A8A90] mt-4">No matching users.</div>}
          </div>
        </div>}
        {tab === 'support' && <AdminSupport />}
        {tab === 'ailogs' && <AdminAiLogs />}
        {tab === 'audit' && <AdminAudit />}
      </>}
      {selLoading && <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center"><DinoLoader label="Opening account" /></div>}
    </div>
  );
}

function AdminUserDetail({ detail, onBack, reload, adminEmail }) {
  const u = detail.user;
  const [cap, setCap] = useState(String(detail.cap_usd));
  const [jsonText, setJsonText] = useState(JSON.stringify(detail.state || {}, null, 2));
  const [editData, setEditData] = useState(false);
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [confirmKind, setConfirmKind] = useState(null); const [delText, setDelText] = useState('');
  const [adminRole, setAdminRole] = useState(!!detail.is_admin);
  const [banned, setBanned] = useState(!!(detail.user && detail.user.banned));
  const [notes, setNotes] = useState(detail.notes || []); const [noteText, setNoteText] = useState('');
  const [newPw, setNewPw] = useState(''); const [showPw, setShowPw] = useState(false);
  const isSelf = (u.email || '').toLowerCase() === (adminEmail || '').toLowerCase();
  const prof = detail.state && detail.state.profile;
  function flash(m) { setMsg(m); setErr(''); }
  async function saveCap() { const c = Number(cap); if (!isFinite(c) || c < 0) { setErr('Enter a valid amount.'); return; } setBusy('cap'); setErr(''); setMsg(''); try { const j = await adminCall('set_cap', { userId: u.id, cap: c }); flash('Monthly cap set to $' + Number(j.cap_usd).toFixed(2) + '.'); } catch (e) { setErr(e.message); } setBusy(''); }
  async function saveData() { let data; try { data = JSON.parse(jsonText); } catch (e) { setErr('Invalid JSON: ' + e.message); return; } setBusy('data'); setErr(''); setMsg(''); try { await adminCall('update_state', { userId: u.id, data }); flash('User data saved.'); setEditData(false); } catch (e) { setErr(e.message); } setBusy(''); }
  async function doReset() { setBusy('reset'); setErr(''); try { await adminCall('reset_user', { userId: u.id }); setConfirmKind(null); flash('User data reset to a fresh account.'); reload(); } catch (e) { setErr(e.message); setConfirmKind(null); } setBusy(''); }
  async function doDelete() { setBusy('delete'); setErr(''); try { await adminCall('delete_user', { userId: u.id }); onBack(); } catch (e) { setErr(e.message); setBusy(''); setConfirmKind(null); } }
  async function doResend() { setBusy('resend'); setErr(''); setMsg(''); try { const j = await adminCall('resend_confirmation', { userId: u.id }); flash(j.note || 'Confirmation link generated.'); } catch (e) { setErr(e.message); } setBusy(''); }
  async function doResetUsage() { setBusy('usage'); setErr(''); try { await adminCall('reset_usage', { userId: u.id }); setConfirmKind(null); flash("This month's AI usage was reset to $0."); } catch (e) { setErr(e.message); setConfirmKind(null); } setBusy(''); }
  async function doGrant() { setBusy('admin'); setErr(''); try { await adminCall('set_admin', { userId: u.id, makeAdmin: true }); setAdminRole(true); setConfirmKind(null); flash(u.email + ' is now an admin.'); } catch (e) { setErr(e.message); setConfirmKind(null); } setBusy(''); }
  async function doRevoke() { setBusy('admin'); setErr(''); try { await adminCall('set_admin', { userId: u.id, makeAdmin: false }); setAdminRole(false); setConfirmKind(null); flash('Admin access revoked.'); } catch (e) { setErr(e.message); setConfirmKind(null); } setBusy(''); }
  async function toggleBan() { setBusy('ban'); setErr(''); try { const j = await adminCall('set_ban', { userId: u.id, banned: !banned }); setBanned(j.banned); setConfirmKind(null); flash(j.banned ? 'Account suspended. They can no longer sign in.' : 'Account reinstated.'); } catch (e) { setErr(e.message); setConfirmKind(null); } setBusy(''); }
  async function addNote() { const t = noteText.trim(); if (!t) return; setBusy('note'); setErr(''); try { const j = await adminCall('add_note', { userId: u.id, note: t }); setNotes([j.note].concat(notes)); setNoteText(''); } catch (e) { setErr(e.message); } setBusy(''); }
  async function delNote(id) { setErr(''); try { await adminCall('delete_note', { userId: u.id, noteId: id }); setNotes(notes.filter(n => n.id !== id)); } catch (e) { setErr(e.message); } }
  function exportData() { try { const blob = new Blob([JSON.stringify(detail.state || {}, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'macrosaurus-' + (u.email || 'account') + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { setErr('Export failed: ' + e.message); } }
  async function doRecovery() { setBusy('recovery'); setErr(''); try { const j = await adminCall('send_recovery', { userId: u.id }); if (j.action_link) { try { await navigator.clipboard.writeText(j.action_link); flash('Reset link generated and copied to your clipboard. Send it to the user. ' + (j.note || '')); } catch (_) { flash('Reset link generated. ' + (j.note || '')); } } else { flash(j.note || 'Reset link generated.'); } } catch (e) { setErr(e.message); } setBusy(''); }
  // Set a new password for the user directly (support does the typing, then hands it over securely).
  // Kept behind an explicit confirm because it locks the user out of their old password immediately.
  async function doSetPassword() { const p = newPw; if (!p || p.length < 6) { setErr('Password must be at least 6 characters.'); return; } setBusy('pw'); setErr(''); setMsg(''); try { await adminCall('set_password', { userId: u.id, password: p }); setNewPw(''); setConfirmKind(null); flash('Password updated. Their old password no longer works - share the new one with them securely and suggest they change it after logging in.'); } catch (e) { setErr(e.message); setConfirmKind(null); } setBusy(''); }
  return (
    <div className="max-w-md lg:max-w-2xl mx-auto px-5 pb-28 lg:pb-12 pt-6 fade-in">
      <button onClick={onBack} className="text-[12px] text-[#8A8A90] mb-2">← All users</button>
      <PageHeader kicker="Admin · user" title={u.email} />
      {msg && <div className="text-[12px] mb-3" style={{ color: 'var(--good)' }}>{msg}</div>}
      {err && <div className="text-[12px] mb-3" style={{ color: 'var(--danger)' }}>{err}</div>}

      <Section title="Account">
        <Row2 k="Email" v={u.email} />
        <Row2 k="Confirmed" v={u.confirmed ? 'Yes' : 'No'} />
        <Row2 k="Status" v={banned ? 'Suspended' : 'Active'} />
        <Row2 k="Joined" v={adminFmtDate(u.created_at)} />
        <Row2 k="Last sign-in" v={adminFmtWhen(u.last_sign_in_at)} last />
        <div className="flex gap-2 mt-3">
          {!u.confirmed && <Btn kind="ghost" className="flex-1" disabled={busy === 'resend'} onClick={doResend}>{busy === 'resend' ? 'Working…' : 'Resend confirmation'}</Btn>}
          <Btn kind="ghost" className="flex-1" disabled={isSelf || busy === 'ban'} style={{ opacity: isSelf ? 0.5 : 1, color: banned ? 'var(--good)' : 'var(--danger)' }} onClick={() => banned ? toggleBan() : setConfirmKind('ban')}>{busy === 'ban' ? 'Working…' : (banned ? 'Reinstate account' : 'Suspend account')}</Btn>
        </div>
        <Btn kind="ghost" className="w-full mt-2" disabled={busy === 'recovery'} onClick={doRecovery}>{busy === 'recovery' ? 'Generating…' : 'Send password-reset link'}</Btn>
        <div className="text-[12px] text-[#8A8A90] mt-4 mb-1.5">Set a new password directly</div>
        <div className="flex gap-2">
          <TextInput type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="at least 6 characters" autoComplete="new-password" className="flex-1" />
          <Btn kind="ghost" onClick={() => setShowPw(v => !v)}>{showPw ? 'Hide' : 'Show'}</Btn>
        </div>
        <Btn kind="accent" className="w-full mt-2" disabled={busy === 'pw' || newPw.length < 6} onClick={() => setConfirmKind('pw')}>{busy === 'pw' ? 'Saving…' : 'Set password'}</Btn>
        <div className="text-[11px] text-[#8A8A90] mt-1.5 leading-relaxed">Use this when someone is locked out and the reset email won't reach them. It takes effect immediately and their old password stops working.</div>
      </Section>

      <Section title="AI usage this month">
        <Row2 k="Spent" v={'$' + Number(detail.spend_usd).toFixed(2)} />
        <Row2 k="Calls" v={detail.calls} last />
        <div className="text-[12px] text-[#8A8A90] mt-3 mb-1.5">Monthly spend cap (USD){isSelf ? '. Note: your own account is exempt from the cap regardless of this value.' : ''}</div>
        <div className="flex gap-2">
          <TextInput value={cap} onChange={e => setCap(e.target.value)} placeholder="1.00" className="flex-1" />
          <Btn kind="accent" disabled={busy === 'cap'} onClick={saveCap}>{busy === 'cap' ? 'Saving…' : 'Save cap'}</Btn>
        </div>
        {detail.spend_usd > 0 && <Btn kind="ghost" className="w-full mt-2" disabled={busy === 'usage'} onClick={() => setConfirmKind('usage')}>Reset this month's usage to $0</Btn>}
      </Section>

      <AdminUserPremium userId={u.id} />

      <Section title="Access">
        <Row2 k="Role" v={adminRole ? 'Admin' : 'User'} last />
        <div className="text-[12px] text-[#8A8A90] mt-3 mb-2">Admins can see and manage every account. Grant this only to people you trust.</div>
        {adminRole
          ? <Btn kind="ghost" className="w-full" disabled={isSelf || busy === 'admin'} style={{ opacity: isSelf ? 0.5 : 1 }} onClick={() => setConfirmKind('revoke')}>{isSelf ? "This is your account" : (busy === 'admin' ? 'Working…' : 'Revoke admin access')}</Btn>
          : <Btn kind="ghost" className="w-full" style={{ background: 'var(--pro)', color: '#fff', borderColor: 'var(--border)' }} disabled={busy === 'admin'} onClick={() => setConfirmKind('grant')}>{busy === 'admin' ? 'Working…' : 'Make this user an admin'}</Btn>}
      </Section>

      <Section title="Support notes">
        <div className="flex gap-2 mb-3">
          <TextInput value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note (e.g. emailed re: billing)" className="flex-1" />
          <Btn kind="accent" disabled={busy === 'note' || !noteText.trim()} onClick={addNote}>{busy === 'note' ? '…' : 'Add'}</Btn>
        </div>
        {notes.length === 0 ? <div className="text-[12px] text-[#8A8A90]">No notes yet.</div> : <div className="space-y-1.5">
          {notes.map(n => <div key={n.id} className="pixel-box p-2.5 bg-[#1E1E22]">
            <div className="text-[13px] whitespace-pre-wrap break-words">{n.note}</div>
            <div className="flex justify-between items-center mt-1"><span className="text-[10px] text-[#8A8A90]">{adminFmtWhen(n.created_at)}</span><button onClick={() => delNote(n.id)} className="text-[10px] text-[#8A8A90] underline">delete</button></div>
          </div>)}
        </div>}
      </Section>

      {prof && <Section title="Profile summary">
        <Row2 k="Goal" v={prof.goalType || 'not set'} />
        {prof.weightKg != null && <Row2 k="Weight (kg)" v={prof.weightKg} />}
        {prof.bodyFatPct != null && <Row2 k="Body fat %" v={prof.bodyFatPct} />}
        {prof.rateKgPerWeek != null && <Row2 k="Rate kg/wk" v={prof.rateKgPerWeek} last />}
      </Section>}

      <Section title="Raw data">
        <div className="text-[12px] text-[#8A8A90] mb-2">The user's full stored state. Editing this changes their account, so use it carefully. Updated {adminFmtWhen(detail.updated_at)}.</div>
        {!editData
          ? <div className="flex gap-2"><Btn kind="ghost" className="flex-1" onClick={() => setEditData(true)}>View / edit raw data</Btn><Btn kind="ghost" className="flex-1" onClick={exportData}>Export data (JSON)</Btn></div>
          : <div>
            <textarea value={jsonText} onChange={e => setJsonText(e.target.value)} rows={12} className={inputCls + ' font-mono text-[11px] leading-snug'} spellCheck={false} />
            <div className="flex gap-2 mt-2">
              <Btn kind="accent" className="flex-1" disabled={busy === 'data'} onClick={saveData}>{busy === 'data' ? 'Saving…' : 'Save data'}</Btn>
              <Btn kind="ghost" onClick={() => { setEditData(false); setJsonText(JSON.stringify(detail.state || {}, null, 2)); setErr(''); }}>Cancel</Btn>
            </div>
          </div>}
      </Section>

      <Section title="Danger zone">
        <div className="text-[12px] text-[#8A8A90] mb-3">Reset wipes their data but keeps the login. Delete removes the account and all data permanently (for GDPR/erasure requests).</div>
        <Btn kind="ghost" className="w-full mb-2" style={{ background: 'var(--fat)', color: '#fff', borderColor: 'var(--border)' }} disabled={busy === 'reset'} onClick={() => setConfirmKind('reset')}>Reset this user's data</Btn>
        <Btn kind="danger" className="w-full" onClick={() => { setConfirmKind('delete'); setDelText(''); }}>Delete this account</Btn>
        {isSelf && <div className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>Heads up: this is your own account.</div>}
      </Section>

      {confirmKind === 'pw' && <ConfirmDialog title={'Set a new password for ' + u.email + '?'} body="Their current password stops working right away and they'll need the new one to log in. Share it with them securely, and suggest they change it once they're back in." confirmLabel={busy === 'pw' ? 'Setting…' : 'Set password'} confirmKind="accent" onConfirm={doSetPassword} onClose={() => setConfirmKind(null)} />}
      {confirmKind === 'ban' && <ConfirmDialog title={'Suspend ' + u.email + '?'} body="They'll be signed out and blocked from logging in until you reinstate them. Their data is kept, and this is reversible." confirmLabel={busy === 'ban' ? 'Suspending…' : 'Suspend account'} onConfirm={toggleBan} onClose={() => setConfirmKind(null)} />}
      {confirmKind === 'grant' && <ConfirmDialog title={'Make ' + u.email + ' an admin?'} body="They'll be able to view and manage every user account, including AI spend limits and deletions. Only do this for people you trust." confirmLabel={busy === 'admin' ? 'Working…' : 'Make admin'} confirmKind="accent" onConfirm={doGrant} onClose={() => setConfirmKind(null)} />}
      {confirmKind === 'revoke' && <ConfirmDialog title="Revoke admin access?" body={'This removes ' + u.email + "'s access to the admin panel. They keep their normal account."} confirmLabel={busy === 'admin' ? 'Working…' : 'Revoke access'} onConfirm={doRevoke} onClose={() => setConfirmKind(null)} />}
      {confirmKind === 'usage' && <ConfirmDialog title="Reset this month's AI usage?" body={'This sets ' + u.email + "'s AI spend back to $0 for this month, giving them their full allowance again."} confirmLabel={busy === 'usage' ? 'Resetting…' : 'Reset usage'} confirmKind="accent" onConfirm={doResetUsage} onClose={() => setConfirmKind(null)} />}
      {confirmKind === 'reset' && <ConfirmDialog title="Reset this user's data?" body={'This wipes ' + u.email + "'s profile, food log and history back to a fresh account. Their login stays. This cannot be undone."} confirmLabel={busy === 'reset' ? 'Resetting…' : 'Reset user'} onConfirm={doReset} onClose={() => setConfirmKind(null)} />}
      {confirmKind === 'delete' && <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setConfirmKind(null)}>
        <div className="w-full max-w-sm pixel-box p-5 fade-in" style={{ background: '#0F0F12' }} onClick={e => e.stopPropagation()}>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--danger)' }}>Delete this account?</h2>
          <div className="text-[12px] text-[#8A8A90] mb-3 leading-relaxed">Permanently removes <span className="text-white break-all">{u.email}</span> and every trace of their data. This cannot be undone. Type <span className="font-bold text-white">DELETE</span> to confirm.</div>
          <TextInput value={delText} onChange={e => setDelText(e.target.value)} placeholder="DELETE" />
          <div className="flex gap-2 mt-4">
            <Btn kind="ghost" className="flex-1" onClick={() => setConfirmKind(null)}>Cancel</Btn>
            <Btn kind="danger" className="flex-1" disabled={delText.trim().toUpperCase() !== 'DELETE' || busy === 'delete'} style={{ opacity: (delText.trim().toUpperCase() !== 'DELETE' || busy === 'delete') ? 0.5 : 1 }} onClick={doDelete}>{busy === 'delete' ? 'Deleting…' : 'Delete forever'}</Btn>
          </div>
        </div>
      </div>}
    </div>
  );
}

/* =====================================================================
   ROOT
   ===================================================================== */
const SUPA_URL = 'https://wnbksotvcjqfslrttjxy.supabase.co';
const SUPA_KEY = 'sb_publishable_IMKN6PzhKwUZQp8n1RlKaQ_t2_1iQXB';
const supa = (typeof window !== 'undefined' && window.supabase) ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;

/* ---------- Web Push nudges ----------
   The buddy reaches you outside the app: at your nudge hour on a day you have not logged, the
   push-nudge edge function sends "Rex is peckish" to this device. Opt-in per device: we register a
   PushManager subscription (VAPID) and upsert it to push_subscriptions (RLS-scoped to the user).
   The VAPID PUBLIC key is safe to ship in the client; the private key lives server-side only. */
const VAPID_PUBLIC = 'BLgtXjzArEUpXssjnf98rBDp7CyRegyV44aaNFKU95_sKzrLE_R4140-7HDDRu6bTzLBgjX9fAaS4B2_8FjtkxI';
function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
// iOS/iPadOS only deliver Web Push to an installed (home-screen) PWA. Detect so we can guide the user.
function pushNeedsInstall() {
  try {
    var iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    return iOS && !standalone;
  } catch (_) { return false; }
}
function urlB64ToUint8(base64) {
  var pad = '='.repeat((4 - base64.length % 4) % 4);
  var b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(b64); var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function pushTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } }
// Is this device currently subscribed (permission granted + a live subscription)?
async function pushStatus() {
  if (!pushSupported() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try { var reg = await navigator.serviceWorker.ready; var sx = await reg.pushManager.getSubscription(); return !!sx; }
  catch (_) { return false; }
}
// Turn push on for this device: ask permission, subscribe, store the subscription for the sender.
async function pushEnable(nudgeHour) {
  if (!pushSupported() || !supa) throw new Error('unsupported');
  var perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  var reg = await navigator.serviceWorker.ready;
  var sx = await reg.pushManager.getSubscription();
  if (!sx) sx = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
  var j = sx.toJSON();
  var sess = (await supa.auth.getSession()).data.session;
  if (!sess) throw new Error('signedout');
  var row = { endpoint: sx.endpoint, user_id: sess.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth, tz: pushTz(), nudge_hour: nudgeHour == null ? 14 : nudgeHour, enabled: true, updated_at: new Date().toISOString() };
  var res = await supa.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
  if (res.error) throw res.error;
  try { window.MTRACK && MTRACK('push_enable'); } catch (_) {}
}
// Turn push off for this device: unsubscribe locally and mark the stored row disabled.
async function pushDisable() {
  try {
    var reg = await navigator.serviceWorker.ready;
    var sx = await reg.pushManager.getSubscription();
    if (sx) {
      if (supa) { try { await supa.from('push_subscriptions').update({ enabled: false, updated_at: new Date().toISOString() }).eq('endpoint', sx.endpoint); } catch (_) {} }
      try { await sx.unsubscribe(); } catch (_) {}
    }
  } catch (_) {}
  try { window.MTRACK && MTRACK('push_disable'); } catch (_) {}
}
// Keep the stored nudge hour in step with the setting while push stays on.
async function pushSyncHour(nudgeHour) {
  try {
    if (!supa || !pushSupported()) return;
    var reg = await navigator.serviceWorker.ready;
    var sx = await reg.pushManager.getSubscription();
    if (sx) await supa.from('push_subscriptions').update({ nudge_hour: nudgeHour, tz: pushTz(), updated_at: new Date().toISOString() }).eq('endpoint', sx.endpoint);
  } catch (_) {}
}

/* ---------- Referrals ----------
   A friend opens macrosaurus.com/?ref=CODE and signs up: the `referral` edge function credits BOTH
   people a one-time pool of 5 free AI logs and a rare Macrodex creature. We stash the code at load
   (before the launch-intent handler strips the query string), claim it once the user is signed in,
   then drain any pending creature rewards into the local dex. All awards are server-authoritative. */
let PENDING_REF = null;
try {
  const _rc = new URLSearchParams(window.location.search).get('ref');
  if (_rc) { PENDING_REF = _rc.trim().slice(0, 32); try { localStorage.setItem('mac_ref', PENDING_REF); } catch (_) {} }
  else { try { PENDING_REF = localStorage.getItem('mac_ref'); } catch (_) {} }
} catch (_) {}
function referralCall(action, extra) {
  if (!supa) return Promise.resolve(null);
  return supa.functions.invoke('referral', { body: Object.assign({ action: action }, extra || {}) })
    .then(function (r) { return (r && r.data) || null; }, function () { return null; });
}
// The invite sheet: the user's share link plus a running tally of friends joined and bonus earned.
function InviteSheet({ rewards, onClose, toast }) {
  useBackClose(onClose);
  const link = (rewards && rewards.link) || SHARE_URL;
  const count = (rewards && rewards.referrals_count) || 0;
  const bonus = (rewards && rewards.bonus_ai_remaining) || 0;
  async function doShare() {
    const text = 'Track your macros and catch dinos with me on Macrosaurus. Join with my link and we both get 5 free AI logs and a rare dino: ' + link;
    try { if (navigator.share) { await navigator.share({ title: 'Macrosaurus', text: text, url: link }); window.MTRACK && MTRACK('referral_share', { method: 'native' }); return; } }
    catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link); toast && toast('Invite link copied'); window.MTRACK && MTRACK('referral_share', { method: 'copy' }); }
    catch (_) { toast && toast('Could not copy link'); }
  }
  async function copy() { try { await navigator.clipboard.writeText(link); toast && toast('Invite link copied'); } catch (_) {} }
  return (<div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
    <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-8 fade-in" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-1"><div className="text-lg font-bold">Invite friends</div><button onClick={onClose} className="text-[#8A8A90] text-xl leading-none" aria-label="Close">×</button></div>
      <div className="text-[12px] text-[#8A8A90] mb-4 leading-relaxed">Share your link. When a friend joins with it, you <b style={{ color: 'var(--text)' }}>both</b> get <b style={{ color: 'var(--text)' }}>5 free AI logs</b> and a <b style={{ color: 'var(--text)' }}>rare dino</b>.</div>
      <div className="pixel-box p-3 mb-3 flex items-center gap-2" style={{ background: 'var(--surface3)' }}>
        <div className="min-w-0 flex-1 text-[12px] tnum truncate">{link}</div>
        <button onClick={copy} className="pixel-btn px-3 py-1.5 text-[10px] pf shrink-0" style={{ background: 'var(--surface2)', color: 'var(--text)' }}>COPY</button>
      </div>
      <button onClick={doShare} className="w-full pixel-btn py-3 text-[11px] pf inline-flex items-center justify-center gap-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}><ShareIOSIcon size={14} /> SHARE INVITE</button>
      <div className="flex gap-2 mt-4 text-center">
        <div className="flex-1 pixel-box p-3" style={{ background: 'var(--card)' }}><div className="text-lg font-bold tnum">{count}</div><div className="text-[10px] text-[#8A8A90]">friends joined</div></div>
        <div className="flex-1 pixel-box p-3" style={{ background: 'var(--card)' }}><div className="text-lg font-bold tnum" style={{ color: 'var(--accent)' }}>{bonus}</div><div className="text-[10px] text-[#8A8A90]">bonus AI logs left</div></div>
      </div>
    </div>
  </div>);
}
let _saveTimer = null;
// Demo mode: ?demo seeds a local sample account and bypasses sign-in. It NEVER touches the cloud
// (cloudSave is a hard no-op below), so real accounts are completely unaffected. For previews + tests.
const DEMO = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
function cloudSave(uid, data) {
  if (DEMO || !supa || !uid) return;
  clearTimeout(_saveTimer);
  var snapshot = data;
  _saveTimer = setTimeout(function () {
    // Merge with the current cloud copy before writing, so a save can only ADD entries, never drop
    // ones another device recorded. This makes stale-copy overwrites (silent data loss) impossible.
    cloudLoad(uid).then(function (remote) {
      var merged = Store.mergeStates(snapshot, remote);
      return supa.from('user_state').upsert({ user_id: uid, data: merged, updated_at: new Date().toISOString() });
    }).then(function (r) { if (r && r.error) console.warn('cloud save failed:', r.error.message); },
      function (e) { console.warn('cloud save skipped (offline?):', e && e.message); });
  }, 700);
}
async function cloudLoad(uid) { const r = await supa.from('user_state').select('data').eq('user_id', uid).maybeSingle(); if (r.error) throw r.error; return r.data ? r.data.data : null; }
// ---- Local offline store (IndexedDB): a snapshot of your data so the app opens and logs with no
// connection, then reconciles with the cloud (last-write-wins by _rev) when you're back online. ----
const IDB_NAME = 'macrosaurus', IDB_STORE = 'kv';
function _idbOpen() { return new Promise(function (res, rej) { try { const r = indexedDB.open(IDB_NAME, 1); r.onupgradeneeded = function () { r.result.createObjectStore(IDB_STORE); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; } catch (e) { rej(e); } }); }
function idbGet(key) { return _idbOpen().then(function (dbc) { return new Promise(function (res) { const q = dbc.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }).catch(function () { return null; }); }
function idbSet(key, val) { return _idbOpen().then(function (dbc) { return new Promise(function (res) { const q = dbc.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key); q.onsuccess = function () { res(true); }; q.onerror = function () { res(false); }; }); }).catch(function () { return false; }); }
function localLoad(uid) { return idbGet('state:' + uid); }
function localSave(uid, data) { if (uid) idbSet('state:' + uid, data); }
// A representative sample account for ?demo mode: a mid-cut male with a part-logged day, a fortnight
// of weigh-ins trending down, a week of steps, and a hatched buddy, enough to show every surface.
function demoState() {
  const today = Store.todayISO();
  const s = Store.defaultState();
  s.profile = {
    sex: 'male', age: 32, heightCm: 178, weightKg: 84, bodyFatPct: 22,
    activityLevel: 'moderate', goalType: 'cut', rateKgPerWeek: 0.5, dietStyle: 'balanced',
    weight_unit: 'kg', height_unit: 'cm', theme: 'light', reminders: true, nudgeHour: 14,
    carryover: { enabled: true, mode: 'dispersed', capKcal: 400 },
    cycling: { enabled: false, highDays: [], deltaPct: 0.15 },
    program_mode: 'collaborative', proteinGPerKgLBM: 2.0, goalWeightKg: 78, aiKey: '',
  };
  const t = E.computeInitialTargets(withActivity(s.profile)); t.id = Store.uid(); t.effective_date = shiftISO(today, -14); t.source = 'initial';
  s.targets = [t];
  const mk = (meal, name, kcal, p, c, f, fib) => ({ id: Store.uid(), date: today, meal_id: meal, name, computed_macros: { kcal, protein: p, carbs: c, fat: f, fiber: fib } });
  s.log_entries = [
    mk('m_1', 'Porridge, banana & whey', 430, 34, 58, 8, 7),
    mk('m_2', 'Chicken & rice bowl', 620, 48, 72, 14, 6),
    mk('m_s', 'Greek yoghurt & berries', 180, 18, 16, 4, 3),
  ];
  s.weight_entries = [[14, 84.6], [12, 84.4], [10, 84.1], [8, 83.9], [6, 83.6], [4, 83.5], [2, 83.2], [0, 83.0]]
    .map(([ago, w]) => ({ id: Store.uid(), date: shiftISO(today, -ago), scale_weight: w }));
  s.last_checkin = shiftISO(today, -6);
  s.steps = {}; [8200, 11040, 7650, 9980, 12010, 8420, 9310].forEach((v, i) => { s.steps[shiftISO(today, -(6 - i))] = v; });
  // A week of synced sleep (keyed by wake date) with a couple of stage-detailed nights, so the sleep
  // tile and the morning Macrodex catch have something to show in the demo.
  s.sleep = {};
  const sleepNights = [[462, null], [405, null], [498, { deep: 118, rem: 96, light: 260, awake: 24 }], [372, null], [510, { deep: 132, rem: 108, light: 246, awake: 24 }], [447, null], [489, { deep: 110, rem: 92, light: 262, awake: 25 }]];
  sleepNights.forEach(([min, st], i) => { const d = shiftISO(today, -(6 - i)); s.sleep[d] = Object.assign({ min, score: Game.sleepScore(min, 480, st) }, st || {}); });
  // Last night's morning catch, already awarded, so the demo shows the sleep loop populated. Every
  // prior night is marked claimed too, matching how the live effect baselines older nights.
  s.game_salt = 'demo-salt';
  const lastNight = shiftISO(today, 0); const lnRec = s.sleep[lastNight]; const lnStages = { deep: lnRec.deep, rem: lnRec.rem, light: lnRec.light, awake: lnRec.awake };
  const lnCatch = Game.sleepCatch(s.game_salt, lastNight, Game.sleepBand(lnRec.score)); const lnStyle = Game.sleepStyleFor(lnRec.score, lnStages);
  s.sleepDex = { claimed: Object.fromEntries(Object.keys(s.sleep).map(d => [d, true])), lastDate: lastNight, lastId: lnCatch.id, lastShiny: lnCatch.shiny, lastStyle: lnStyle };
  s.catch_log = s.catch_log || {}; s.catch_log[today] = (s.catch_log[today] || []).concat([{ id: lnCatch.id, shiny: lnCatch.shiny, sleep: lastNight, style: lnStyle }]);
  const rcp = (title, platform, kcal, p, c, f, fib, meal, main, effort) => ({
    id: Store.uid(), user_id: Store.USER, title, source_platform: platform, source_url: 'https://example.com/' + encodeURIComponent(title),
    thumbnail: null, servings: 2, ingredients: [{ id: Store.uid(), name: '1 portion', quantity: 1, unit: 'x', grams: 100, have: false }],
    steps: ['Prep the ingredients.', 'Cook and plate up.'], macros_per_serving: { kcal, protein: p, carbs: c, fat: f, fiber: fib },
    macros_confidence: 'high', tags: { meal, cuisine: 'british', main, effort, diet: p >= 30 ? ['high-protein'] : [] },
    private: false, created_at: Date.now(), updated_at: Date.now(),
  });
  s.recipes = [
    rcp('High-protein chicken pesto pasta', 'instagram', 540, 46, 58, 14, 6, 'dinner', 'chicken', 'quick'),
    rcp('Smash burger tacos', 'tiktok', 620, 38, 44, 30, 4, 'dinner', 'beef', 'standard'),
    rcp('Cottage cheese protein bagel', 'youtube', 310, 28, 40, 4, 5, 'breakfast', 'cheese', 'quick'),
  ];
  s.buddy = { stage: 3, name: 'Chompers', personality: 'plucky', hatchedISO: shiftISO(today, -20), speciesId: null, evoStage: 0, affinity: null };
  s.game_salt = 'demo-salt';
  s.onboarding = { welcomed: true, sawDex: true, dismissed: true };
  s._rev = Date.now();
  return s;
}
function stateRev(d) { return (d && d._rev) || 0; }
// Record deletion tombstones so the merge-based sync never resurrects a deleted item. Call inside an
// update() draft when removing entries; untombstone on undo so re-adding the same id sticks.
function tombstone(d, ids) { d.deleted = d.deleted || {}; var t = Date.now(); ids.forEach(function (id) { if (id != null) d.deleted[id] = t; }); }
function untombstone(d, ids) { if (!d.deleted) return; ids.forEach(function (id) { if (id != null) delete d.deleted[id]; }); }

// Brief egg-crack reveal of the day's provisional catch after the FIRST food log of the day.
// Non-blocking (pointer-events pass through) and gone in under 1.5s.
function CatchReveal({ c }) {
  const [cracked, setCracked] = useState(false);
  useEffect(() => { const t = setTimeout(() => setCracked(true), 550); return () => clearTimeout(t); }, []);
  const cr = CR_BY_ID[c.id]; if (!cr) return null;
  // A choreographed notification, not a random centre pop: it slides up from the bottom like a toast,
  // the egg wobbles, then the creature settles into place.
  return (
    <div className="fixed left-0 right-0 z-[70] flex justify-center px-4 pointer-events-none" style={{ bottom: 96 }}>
      <div className="pixel-box px-4 py-3 flex items-center gap-3 sheet-up" style={{ background: 'var(--surface3)' }}>
        {cracked
          ? <>
              <div className="crpop shrink-0" style={crFx(c.shiny, null)}><Sprite art={cr.art} colors={c.shiny ? crShiny(cr.colors) : cr.colors} px={5} /></div>
              <div className="min-w-0">
                <div className="pf text-[8px] uppercase text-[#8A8A90] mb-0.5">Catch on the line</div>
                <div className="pf text-[10px]" style={{ color: CR_RARITY_COLOR[cr.rarity] }}>{cr.name}{c.shiny ? ' ✦' : ''}</div>
              </div>
            </>
          : <>
              <div className="crwobble shrink-0"><Sprite art="egg" colors={crC('#EAD9A0', '#C77D3A')} px={5} /></div>
              <div className="text-[10px] text-[#8A8A90]">Something's hatching...</div>
            </>}
      </div>
    </div>
  );
}
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="fixed left-0 right-0 z-[60] flex justify-center px-4" style={{ bottom: 86 }}>
      <div className="bg-[#1E1E22] border border-[#262629] rounded-2xl px-4 py-3 flex items-center gap-4 shadow-xl shadow-black/50 fade-in">
        <span className="text-sm">{toast.msg}</span>
        {toast.action2Label && <button onClick={toast.onAction2} className="hit text-sm font-semibold text-[#4A9EEB] shrink-0">{toast.action2Label}</button>}
        {toast.actionLabel && <button onClick={toast.onAction} className="hit text-sm font-semibold text-[#4A9EEB] shrink-0">{toast.actionLabel}</button>}
      </div>
    </div>
  );
}

const NAV_ITEMS = [['dashboard', 'TODAY', Icon.dash], ['foodlog', 'FOOD', Icon.food], ['recipes', 'COOK', Icon.recipe], ['goals', 'PROGRESS', Icon.goal], ['more', 'YOU', Icon.more]];
// The bottom bar has room for four destinations plus the centre Add button, so MENU lives in the
// header (MobileHeader) and the desktop Sidebar instead. Bottom bar order: HOME, FOOD, (Add), GOAL, COOK.
const BOTTOM_NAV = ['dashboard', 'foodlog', 'recipes', 'goals'].map(k => NAV_ITEMS.find(([n]) => n === k)); // Today, Food, (Add), Cook, Progress: matches the desktop sidebar order
function BottomNav({ view, setView, onAdd }) {
  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 max-w-md mx-auto border-t-[3px] flex items-center z-40 px-2" style={{ height: 'calc(64px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)', background: 'var(--header)', borderColor: 'var(--border)' }}>
      {BOTTOM_NAV.slice(0, 2).map(([k, l, Ic]) => <NavBtn key={k} k={k} l={l} Ic={Ic} view={view} setView={setView} />)}
      <div className="flex-1 flex justify-center"><button onClick={onAdd} className="w-[68px] h-[68px] pixel-btn flex items-center justify-center -mt-[72px]" style={{ background: '#fff', color: '#111' }}><Icon.plus width="32" height="32" /></button></div>
      {BOTTOM_NAV.slice(2).map(([k, l, Ic]) => <NavBtn key={k} k={k} l={l} Ic={Ic} view={view} setView={setView} />)}
    </div>
  );
}
function NavBtn({ k, l, Ic, view, setView }) { return (<button onClick={() => setView(k)} className="flex-1 self-stretch flex flex-col items-center justify-center gap-1.5" style={{ color: view === k ? 'var(--accent)' : 'rgba(255,255,255,0.6)' }}><Ic width="22" height="22" /><span className="pf text-[7px]">{l}</span></button>); }
function Sidebar({ view, setView, onAdd, onOpenPlay }) {
  // Desktop nav: the four functional tabs, then a Play button (the game hub lives behind the dino).
  const tabs = NAV_ITEMS.filter(([k]) => k !== 'more');
  return (
    <div className="hidden lg:flex fixed left-0 top-0 bottom-0 w-56 flex-col bg-[#0F0F12] border-r-[3px] border-[#262629] p-4 z-40">
      <button onClick={onOpenPlay} aria-label="Open Play" className="px-1 py-3 mb-3 text-left"><div className="flex items-center gap-2.5"><PixelDino size={22} color="var(--good)" /><span className="pf text-[13px]">MACROSAURUS</span></div><div className="flex gap-1 mt-2 ml-8">{[PRO, CARB, FAT, 'var(--accent)'].map((c, i) => <span key={i} className="w-2.5 h-2.5" style={{ background: c }} />)}</div></button>
      <button onClick={onAdd} className="pixel-btn flex items-center justify-center gap-2 bg-white text-black py-3 font-bold mb-4"><Icon.plus width="18" height="18" /> Log food</button>
      <div className="flex flex-col gap-2">{tabs.map(([k, l, Ic]) => <button key={k} onClick={() => setView(k)} className={`pixel-box flex items-center gap-3 px-3 py-2.5 text-sm ${view === k ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`}><Ic width="20" height="20" /> {l}</button>)}
        <button onClick={onOpenPlay} className="pixel-box flex items-center gap-3 px-3 py-2.5 text-sm bg-[#1E1E22] text-[#8A8A90]"><PixelDino size={20} color="var(--good)" /> PLAY</button>
        <button onClick={() => setView('more')} className={`pixel-box flex items-center gap-3 px-3 py-2.5 text-sm ${view === 'more' ? 'bg-white text-black font-bold' : 'bg-[#1E1E22] text-[#8A8A90]'}`}><Icon.more width="20" height="20" /> YOU</button>
      </div>
      <div className="mt-auto pf text-[8px] text-[#8A8A90] px-1">{BRAND}</div>
    </div>
  );
}
function MobileHeader({ onOpenPlay, onOpenYou, streak }) {
  return (
    <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 border-b-[3px]" style={{ background: 'var(--header)', borderColor: 'var(--border)' }}>
      {/* The dino is your buddy: tap it to open the Play hub (Macrodex, egg, catches). */}
      <button onClick={onOpenPlay} aria-label="Open Play" className="flex items-center gap-2.5 text-left">
        <div className="pixel-box w-9 h-9 flex items-center justify-center" style={{ background: '#111', borderColor: '#000' }}><PixelDino size={20} color="#fff" /></div>
        <div className="leading-tight">
          <div className="pf text-[12px]" style={{ color: 'var(--header-text)' }}>MACROSAURUS</div>
          <div className="text-[9px] flex items-center gap-1.5">
            {streak > 0 && <span style={{ color: 'var(--fat)' }}>▲ {streak}d</span>}
            <span className="pf text-[7px] uppercase" style={{ color: 'var(--accent)' }}>Play ›</span>
          </div>
        </div>
      </button>
      <button onClick={onOpenYou} aria-label="You and settings" className="pixel-box flex items-center gap-1.5 h-9 px-2.5" style={{ background: '#111', borderColor: '#000', color: '#fff' }}>
        <Icon.gear width="18" height="18" />
        <span className="pf text-[8px]">YOU</span>
      </button>
    </div>
  );
}

// First-run welcome tour: a few full-screen slides teaching the core concepts. Shown once to new
// users after setup, and replayable from the menu (reviewing=true just changes the button labels).
const WELCOME_SLIDES = [
  { title: 'Welcome to Macrosaurus', body: "A macro tracker that adapts to you. Most apps hand you one fixed number. This one learns from your results and retunes itself every week." },
  { title: 'Logging is quick', body: "Tap the plus to add food by photo, voice or barcode. The AI does the maths, you just confirm." },
  { title: 'Weigh in, then relax', body: "A few times a week is plenty. Macrosaurus follows your trend, not one noisy day, and adjusts your targets weekly." },
  { title: 'Make it a habit', body: "Every logged day hatches your dino, catches Macrodex creatures and feeds your streak. Tap the dino any time to play." },
];
function WelcomeCarousel({ onDone, reviewing, theme }) {
  useBackClose(onDone);
  const [i, setI] = useState(0);
  const last = i === WELCOME_SLIDES.length - 1;
  const s = WELCOME_SLIDES[i];
  const dark = theme === 'dark';
  const brand = dark ? 'var(--accent)' : 'var(--header)';   // --header is black in dark, so use accent
  const onBrand = dark ? '#111' : '#fff';
  return (<div className={'fixed inset-0 z-[95] ' + (dark ? 'theme-dark' : 'theme-light') + ' flex flex-col'} style={{ background: 'var(--bg)', color: 'var(--text)' }}>
    <div className="flex justify-between items-center px-5 py-4">
      <span className="pf text-[11px]" style={{ color: brand }}>MACROSAURUS</span>
      <button onClick={onDone} className="text-[12px] text-[#8A8A90]">{reviewing ? 'Close' : 'Skip'}</button>
    </div>
    <div className="flex-1 flex flex-col justify-center items-center text-center px-8 max-w-sm mx-auto">
      <div className="pixel-box p-6 mb-6" style={{ background: brand, borderColor: 'var(--border)' }}><PixelDino size={64} color={onBrand} /></div>
      <h2 className="pf text-base mb-3 leading-relaxed" style={{ color: brand }}>{s.title}</h2>
      <p className="text-[14px] leading-relaxed">{s.body}</p>
    </div>
    <div className="px-6 pb-10 max-w-sm mx-auto w-full">
      <div className="flex justify-center gap-1.5 mb-5">{WELCOME_SLIDES.map((_, k) => <div key={k} className="h-1.5 rounded-full transition-all" style={{ width: k === i ? 18 : 6, background: k === i ? brand : 'var(--border)' }} />)}</div>
      <button onClick={() => last ? onDone() : setI(i + 1)} className="w-full pixel-btn py-3 text-[11px] pf" style={{ background: brand, color: onBrand }}>{last ? (reviewing ? 'DONE' : 'START TRACKING') : 'NEXT'}</button>
      {i > 0 && <button onClick={() => setI(i - 1)} className="w-full text-[11px] text-[#8A8A90] mt-3">Back</button>}
    </div>
  </div>);
}
// Getting-started checklist card on the dashboard. Drives first actions; completion is derived from
// real data (plus a "saw the Macrodex" flag). Hides once everything's done or the user dismisses it.
function OnboardingChecklist({ db, update, onLog, onOpenDex }) {
  const ob = db.onboarding || {};
  if (!ob.welcomed || ob.dismissed) return null;
  const today = Store.todayISO();
  const et = effectiveTarget(db, today);
  const proteinTgt = et ? et.eff.protein : 0;
  const todayProtein = sumMacros(entriesOn(db, today)).protein;
  const items = [
    { k: 'meal', label: 'Log your first meal', done: db.log_entries.length > 0, go: onLog },
    { k: 'ai', label: 'Try a Photo or Describe estimate', done: db.log_entries.some(e => e.source === 'ai_estimate' || e.source === 'label'), go: onLog },
    { k: 'protein', label: 'Hit your protein target today', done: proteinTgt > 0 && todayProtein >= proteinTgt, go: onLog },
    { k: 'dex', label: 'Meet your first Macrodex dino', done: !!ob.sawDex, go: onOpenDex },
  ];
  const doneCount = items.filter(x => x.done).length;
  if (doneCount === items.length) return null;
  return (<Card className="p-4 mb-4 fade-in">
    <div className="flex justify-between items-center mb-2">
      <div className="text-sm font-bold">Getting started</div>
      <div className="flex items-center gap-2"><span className="text-[11px] text-[#8A8A90]">{doneCount}/{items.length}</span><button onClick={() => update(d => { d.onboarding = d.onboarding || {}; d.onboarding.dismissed = true; })} className="text-[#8A8A90] text-lg leading-none" aria-label="Dismiss">×</button></div>
    </div>
    <div className="text-[11px] text-[#8A8A90] mb-2.5 leading-snug">Tap a task to jump straight to it. Each one ticks off on its own once you have done it.</div>
    <div className="space-y-0.5">
      {items.map(it => (
        <button key={it.k} onClick={it.done ? undefined : it.go} className="w-full flex items-center gap-3 text-left py-2 active:opacity-60 transition-opacity">
          <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px]" style={{ border: '2px solid ' + (it.done ? 'var(--good)' : 'var(--border)'), background: it.done ? 'var(--good)' : 'transparent', color: '#fff' }}>{it.done ? '✓' : ''}</span>
          <span className="text-[13px] flex-1 min-w-0" style={{ color: it.done ? 'var(--muted)' : 'var(--text)', textDecoration: it.done ? 'line-through' : 'none' }}>{it.label}</span>
          {!it.done && <span className="pf text-[8px] shrink-0" style={{ color: 'var(--accent)' }}>DO IT ›</span>}
        </button>
      ))}
    </div>
  </Card>);
}

/* ========================== Recipes module ==========================
   Share a YouTube Short / Instagram Reel / TikTok (or paste a link/caption) -> the recipe-extract Edge
   Function pulls the public text -> ai-proxy structures it into ingredients + steps + per-serving
   macros -> save it, tick what you have (the rest rolls up into a shopping list), and log a cooked
   serving straight into the food diary via the same addEntry path everything else uses. */
const MACRO_KEYS = [['kcal', 'kcal', CAL], ['protein', 'P', PRO], ['carbs', 'C', CARB], ['fat', 'F', FAT], ['fiber', 'Fibre', 'var(--good)']];
function RecipeMacroStrip({ macros, per }) {
  return (<div className="flex flex-wrap gap-x-4 gap-y-1">
    {MACRO_KEYS.map(([k, l, c]) => (
      <div key={k} className="flex items-baseline gap-1">
        <span className="tnum text-[13px] font-bold" style={{ color: c }}>{Math.round(macros[k] || 0)}{k === 'kcal' ? '' : 'g'}</span>
        <span className="text-[10px] text-[#8A8A90]">{l}</span>
      </div>
    ))}
    {per && <span className="text-[10px] text-[#8A8A90] self-center">/ serving</span>}
  </div>);
}
const clamp2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
// Recipe art with a graceful pixel fallback: recipes imported before thumbnails were inlined can
// hold expired CDN links, so a failed load swaps to the placeholder instead of a broken grey block.
function RecipeImg({ src, iconSize = 34 }) {
  const [dead, setDead] = useState(false);
  useEffect(() => { setDead(false); }, [src]);
  if (!src || dead) return <div className="w-full h-full flex items-center justify-center"><Icon.recipe width={iconSize} height={iconSize} style={{ color: 'var(--muted)' }} /></div>;
  return <img src={src} className="w-full h-full object-cover" alt="" loading="lazy" onError={() => setDead(true)} />;
}
// Ids we've already tried to repair this session, so a dead source can't trigger repeat fetches.
const thumbFixTried = new Set();
// Same idea for tag backfill: classify each legacy recipe at most once per session.
const tagFixTried = new Set();
// Recipes already pushed to the shared library this session (seeds the pool from pre-consent imports).
const sharedThisSession = new Set();
// Recipes we've re-extracted this session to recover the original creator (for pre-creator-capture imports).
const authorFixTried = new Set();
// The chips under a card: auto-tags (meal/cuisine) for browsing + live macro badges (high protein
// etc). Capped so a card stays calm; the high-protein badge is emphasised as the tracker's signal.
function recipeChips(recipe) {
  const t = recipe.tags || {}, out = [];
  const badges = Rcp.badges(recipe);
  if (badges.some(b => b.key === 'high-protein')) out.push({ label: 'High protein', hero: true });
  if (t.meal) out.push({ label: Rcp.taxLabel(t.meal) });
  if (t.cuisine && t.cuisine !== 'other') out.push({ label: Rcp.taxLabel(t.cuisine) });
  if (out.length < 3 && t.effort === 'quick') out.push({ label: 'Quick' });
  return out.slice(0, 3);
}
function RecipeCard({ recipe, onOpen, onFav }) {
  const m = recipe.macros_per_serving || {};
  const img = recipe.photo || recipe.thumbnail;
  const chips = recipeChips(recipe);
  return (<div onClick={onOpen} className="cursor-pointer active:opacity-90 transition-opacity">
    <div className="pixel-box overflow-hidden" style={{ background: 'var(--card)' }}>
      <div className="relative w-full" style={{ aspectRatio: '16 / 9', background: 'var(--surface3)' }}>
        <RecipeImg src={img} iconSize={34} />
        <div className="absolute inset-x-0 bottom-0 pt-8 px-3 pb-2.5" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.78))' }}>
          {/* explicit #fff: the .theme-light .text-white remap would paint this dark on the dark scrim */}
          <div className="font-bold text-[15px] leading-tight" style={{ ...clamp2, color: '#fff' }}>{recipe.title}</div>
        </div>
        <div className="absolute top-2 right-2 pixel-box px-2 py-1 text-[11px] font-bold tnum" style={{ background: 'var(--bg)', color: m.kcal > 0 ? 'var(--text)' : 'var(--muted)' }}>{m.kcal > 0 ? Math.round(m.kcal) + ' kcal' : 'Tap to price'}</div>
        {onFav && <button onClick={e => { e.stopPropagation(); onFav(); }} aria-label="Favourite" className="absolute top-2 left-2 w-8 h-8 pixel-box flex items-center justify-center" style={{ background: 'var(--bg)', color: recipe.favorite ? FAT : 'var(--muted)' }}><Icon.star width="16" height="16" fill="currentColor" /></button>}
      </div>
      {chips.length > 0 && <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
        {chips.map((c, i) => <span key={i} className="pf text-[7px] uppercase px-1.5 py-1 leading-none" style={c.hero ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { background: 'var(--surface3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>{c.label}</span>)}
      </div>}
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[#8A8A90]">
        <span>{Rcp.platformLabel(recipe.source_platform)}</span><span>·</span><span>serves {recipe.servings}</span>
        {m.protein > 0 && <><span>·</span><span className="tnum font-semibold" style={{ color: PRO }}>{Math.round(m.protein)}g protein</span></>}
      </div>
    </div>
  </div>);
}
// The headline how-to: sharing a Reel/Short straight into the app is the best path (no link to copy),
// so we show this prominently on the empty state and the importer.
function ShareTip({ className = '' }) {
  return (<Card className={'p-3.5 ' + className} style={{ background: 'var(--surface3)' }}>
    <div className="flex items-center gap-2 mb-1.5"><Icon.share width="16" height="16" style={{ color: 'var(--accent)' }} /><div className="text-[13px] font-bold">Best way: share it straight to Macrosaurus</div></div>
    <div className="text-[12px] text-[#8A8A90] leading-snug">In Instagram, TikTok or YouTube, tap <span className="font-semibold" style={{ color: 'var(--text)' }}>Share</span> on the Reel, video or Short, then pick <span className="font-semibold" style={{ color: 'var(--text)' }}>Macrosaurus</span>. It opens here and becomes a recipe automatically, nothing to copy or paste.</div>
  </Card>);
}
// The import + review flow. `initialUrl` is set when arriving from a share; otherwise the user pastes
// a link or (fallback) a caption / screenshots. Any extraction failure reveals the manual fallbacks.
function RecipeImport({ initialUrl, onSaved, onCancel }) {
  useBackClose(onCancel);
  const [url, setUrl] = useState(initialUrl || '');
  const [caption, setCaption] = useState('');
  const [imgs, setImgs] = useState([]); // { id, file, url }
  const [showFallback, setShowFallback] = useState(false);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const [draft, setDraft] = useState(null);
  const ran = useRef(false);
  function addImgs(list) { const arr = Array.from(list || []).map(f => ({ id: Store.uid(), file: f, url: URL.createObjectURL(f) })); setImgs(x => x.concat(arr).slice(0, 3)); }
  function removeImg(id) { setImgs(x => x.filter(f => f.id !== id)); }

  async function fromLink(u) {
    setErr(''); setBusy('Reading the video...');
    try {
      const src = await extractRecipeSource(u);
      // Prefer inlined thumbnail bytes over the (expiring) CDN link; fall back to the URL if absent.
      const meta = { platform: src.platform || (Rcp.detectShare(u) || {}).platform || '', url: u, title: src.title || '', author: src.author || '', thumbnail: (await inlineThumb(src)) || src.thumbnail || '' };
      if (!src.ok || !src.sourceText) {
        // No usable caption text. Before falling back to manual entry, try reading the recipe straight
        // off the video's cover frame; Reels/TikToks very often overlay the ingredient list on it.
        const coverBlob = coverBlobFromSrc(src);
        if (coverBlob) {
          setBusy('Reading the recipe from the video...');
          try {
            const draft = await structureRecipeFromImages([coverBlob], meta, [src.title, src.sourceText].filter(Boolean).join('\n'));
            if (draft && Array.isArray(draft.ingredients) && draft.ingredients.length) { setDraft(draft); setBusy(''); return; }
          } catch (e) { /* fall through to the manual fallback below */ }
        }
        setShowFallback(true);
        setErr(src.note || 'Could not read that link automatically. Paste the caption or add a screenshot below.');
        setBusy(''); return;
      }
      setBusy('Building the recipe...');
      setDraft(await structureRecipe(src.sourceText, meta)); // review prices the macros in the background
    } catch (e) { setErr(e.message || 'Import failed.'); setShowFallback(true); }
    setBusy('');
  }
  async function fromCaption() {
    if (!caption.trim()) { setErr('Paste the recipe caption or text first.'); return; }
    setErr(''); setBusy('Building the recipe...');
    try {
      const meta = { platform: (Rcp.detectShare(url) || {}).platform || '', url: url.trim(), title: '' };
      setDraft(await structureRecipe(caption.trim(), meta));
    } catch (e) { setErr(e.message || 'Import failed.'); }
    setBusy('');
  }
  async function fromImages() {
    if (!imgs.length) { setErr('Add at least one screenshot of the recipe.'); return; }
    setErr(''); setBusy('Reading the screenshots...');
    try {
      const meta = { platform: (Rcp.detectShare(url) || {}).platform || '', url: url.trim(), title: '' };
      setDraft(await structureRecipeFromImages(imgs.map(i => i.file), meta));
    } catch (e) { setErr(e.message || 'Import failed.'); }
    setBusy('');
  }
  // Auto-run once when opened straight from a share.
  useEffect(() => { if (initialUrl && !ran.current) { ran.current = true; fromLink(initialUrl); } }, [initialUrl]);

  if (draft) return <RecipeReview recipe={draft} onSave={onSaved} onCancel={() => setDraft(null)} />;
  if (busy) return <DinoLoader label={busy} />;
  return (<div className="fade-in">
    <button onClick={onCancel} className="text-[13px] text-[#8A8A90] mb-3">‹ Back</button>
    <div className="text-lg font-bold mb-3">Import a recipe</div>
    <ShareTip className="mb-4" />
    <div className="text-[11px] uppercase pf text-[#8A8A90] mb-2">Or paste a link</div>
    <Field label="Video link">
      <input value={url} onChange={e => setUrl(e.target.value)} className={inputCls} placeholder="https://www.youtube.com/shorts/... or instagram.com/reel/..." inputMode="url" autoCapitalize="off" autoCorrect="off" />
    </Field>
    <Btn kind="accent" className="w-full" onClick={() => url.trim() ? fromLink(url.trim()) : setErr('Paste a YouTube or Instagram link first.')}>Get recipe from link</Btn>
    <button onClick={() => setShowFallback(v => !v)} className="w-full text-[12px] text-[#8A8A90] mt-4 underline">{showFallback ? 'Hide' : 'Link not working? Paste the caption or add a screenshot'}</button>
    {showFallback && <div className="mt-3 fade-in">
      <Field label="Paste caption / recipe text" hint="The description or caption under the video usually has the full recipe.">
        <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} className={inputCls + ' resize-y leading-relaxed'} placeholder="Paste the recipe text here" />
      </Field>
      <Btn kind="ghost" className="w-full mb-4" onClick={fromCaption}>Build from pasted text</Btn>
      <div className="mb-1"><PhotoButton label="Add recipe screenshots" multiple onFiles={addImgs} className="w-full" /></div>
      {imgs.length > 0 && <div className="flex gap-2 flex-wrap my-3">{imgs.map(i => (<div key={i.id} className="relative"><img src={i.url} className="w-16 h-16 object-cover rounded-xl border border-[#262629]" /><button onClick={() => removeImg(i.id)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-[#262629] text-white text-xs leading-none">×</button></div>))}</div>}
      {imgs.length > 0 && <Btn kind="ghost" className="w-full" onClick={fromImages}>Build from screenshots</Btn>}
    </div>}
    {err && <div className="text-[12px] text-[#F5C542] mt-3 fade-in leading-snug">{err}</div>}
  </div>);
}
// Editable review before saving: title, servings (rescales amounts), ingredients, steps, per-serving macros.
function RecipeReview({ recipe, onSave, onCancel }) {
  const [d, setD] = useState(recipe);
  const set = (patch) => setD(x => Object.assign({}, x, patch));
  const setLine = (i, v) => setD(x => { const ings = x.ingredients.slice(); ings[i] = Object.assign({}, ings[i], { line: v, name: Rcp.nameFromLine(v) }); return Object.assign({}, x, { ingredients: ings }); });
  const delIng = (i) => setD(x => ({ ...x, ingredients: x.ingredients.filter((_, k) => k !== i) }));
  const addIng = () => setD(x => ({ ...x, ingredients: x.ingredients.concat([{ id: 'ing_' + Store.uid(), line: '', name: '', grams: 0, macros: null, resolved: null, have: false }]) }));
  const setSteps = (txt) => setD(x => ({ ...x, steps: txt.split('\n').map(s => s.trim()).filter(Boolean) }));
  const priced = d.macros_per_serving.kcal > 0;
  return (<div className="fade-in">
    <button onClick={onCancel} className="text-[13px] text-[#8A8A90] mb-3">‹ Start over</button>
    <div className="text-lg font-bold mb-1">Check the recipe</div>
    <div className="text-[12px] text-[#8A8A90] mb-3 leading-snug">Got {d.ingredients.length} ingredient{d.ingredients.length === 1 ? '' : 's'}{d.steps.length ? ' and ' + d.steps.length + ' step' + (d.steps.length === 1 ? '' : 's') : ''}{d.source_platform ? ' from ' + Rcp.platformLabel(d.source_platform) : ''}. Each ingredient is one line, amount first. Fix anything, then save it to your Cook library, you can work out the macros or cook it whenever.</div>
    {priced && <Card className="p-3 mb-3"><div className="text-[11px] text-[#8A8A90] mb-2">Macros per serving</div><RecipeMacroStrip macros={d.macros_per_serving} per /></Card>}
    {priced && (() => { const s = Rcp.macroSanity(d); return s ? <div className="pixel-box p-3 mb-3 text-[12px] leading-snug" style={{ background: 'var(--surface3)', borderColor: '#F5C542', color: '#F5C542' }}>Heads up: {s.msg}</div> : null; })()}
    <Field label="Title"><input value={d.title} onChange={e => set({ title: e.target.value })} className={inputCls} /></Field>
    <Field label="Servings"><input type="number" min="1" value={d.servings} onChange={e => set({ servings: Math.max(1, Math.round(+e.target.value) || 1) })} className={inputCls + ' w-28'} /></Field>
    <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2 mt-1">Ingredients</div>
    <div className="space-y-2 mb-2">
      {d.ingredients.map((ing, i) => (
        <div key={ing.id} className="flex items-center gap-2">
          <input value={Rcp.lineOf(ing)} onChange={e => setLine(i, e.target.value)} className={inputCls + ' flex-1 py-2'} placeholder="e.g. 150 g cottage cheese" />
          <button onClick={() => delIng(i)} className="text-[#8A8A90] text-lg leading-none px-1" aria-label="Remove">×</button>
        </div>
      ))}
    </div>
    <button onClick={addIng} className="text-[12px] mb-4" style={{ color: 'var(--accent)' }}>+ Add ingredient</button>
    <Field label="Method (one step per line)">
      <textarea value={(d.steps || []).join('\n')} onChange={e => setSteps(e.target.value)} rows={Math.max(4, (d.steps || []).length + 1)} className={inputCls + ' resize-y leading-relaxed'} placeholder="One instruction per line" />
    </Field>
    <Btn kind="accent" className="w-full mt-1" onClick={() => onSave(d)} disabled={!d.title.trim() || !d.ingredients.some(x => Rcp.lineOf(x).trim())}>Save to my recipes</Btn>
  </div>);
}
// Open Food Facts search-by-name, for the per-ingredient brand override. Returns per-100g options.
async function offSearchByName(query) {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(query) + '&search_simple=1&action=process&json=1&page_size=20&fields=product_name,brands,code,nutriments';
  const j = await (await fetch(url)).json();
  return (j.products || []).map(p => { const n = p.nutriments || {}; const k = +n['energy-kcal_100g']; if (!p.product_name || !k) return null; return { name: p.product_name, brand: p.brands || '', code: p.code || '', per100: { kcal: Math.round(k), protein: +n.proteins_100g || 0, carbs: +n.carbohydrates_100g || 0, fat: +n.fat_100g || 0, fiber: +n.fiber_100g || 0 } }; }).filter(Boolean).slice(0, 12);
}
// Override one ingredient's macros by any method. Calls onResolve(macros, meta) with the macros for
// this whole ingredient. AI estimates the line; Manual takes your own numbers; Search finds a UK brand
// (per-100g, scaled by the grams you give). This is the fix-it path; the recipe is priced automatically.
function IngredientMacroSheet({ ingredient, onResolve, onClose }) {
  useBackClose(onClose);
  const [tab, setTab] = useState('ai');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const [q, setQ] = useState(ingredient.name || Rcp.nameFromLine(ingredient.line || ''));
  const [grams, setGrams] = useState(ingredient.grams || '');
  const [results, setResults] = useState(null);
  const [man, setMan] = useState({ kcal: '', protein: '', carbs: '', fat: '', fiber: '' });
  const line = Rcp.lineOf(ingredient);
  async function aiEstimate() { setBusy('ai'); setErr(''); try { const r = await aiAnalyzeLines([line]); const m = r.per_ingredient[0] && r.per_ingredient[0].macros; if (!m || !m.kcal) { setErr('Could not estimate that line.'); setBusy(''); return; } onResolve(m, { source: 'ai' }); } catch (e) { setErr('Estimate failed: ' + e.message); setBusy(''); } }
  async function search() { if (!q.trim()) return; setBusy('search'); setErr(''); setResults(null); try { const r = await offSearchByName(q.trim()); setResults(r); if (!r.length) setErr('No products found.'); } catch (e) { setErr('Search failed.'); } setBusy(''); }
  function pickProduct(p) { const g = +grams || ingredient.grams || 0; if (!(g > 0)) { setErr('Enter the grams so we can scale the label numbers.'); return; } onResolve(Rcp.macrosFromPer100(p.per100, g), { source: 'off', product: p.name, barcode: p.code }); }
  const tabs = [['ai', 'Estimate'], ['search', 'Search'], ['manual', 'Manual']];
  return (<div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
    <div className="w-full lg:max-w-md rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[88vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-1"><div className="text-base font-bold truncate pr-2">Macros for “{line}”</div><button onClick={onClose} className="text-[#8A8A90] text-xl leading-none shrink-0">×</button></div>
      <div className="text-[11px] text-[#8A8A90] mb-3">Set exact numbers for this ingredient if the automatic ones look off.</div>
      <div className="flex gap-1 bg-[#1E1E22] p-1 rounded-2xl mb-3">{tabs.map(([k, l]) => <button key={k} onClick={() => { setTab(k); setErr(''); }} className={`flex-1 rounded-xl py-2 text-[12px] transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}</button>)}</div>
      {tab === 'ai' && <div className="text-center py-1"><div className="text-[12px] text-[#8A8A90] mb-3 leading-snug">Estimate the macros for this exact line with AI.</div><Btn kind="accent" className="w-full" onClick={aiEstimate}>{busy === 'ai' ? 'Estimating...' : 'Estimate with AI'}</Btn></div>}
      {tab === 'search' && <div>
        <div className="flex gap-2 mb-2"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} className={inputCls + ' flex-1'} placeholder="brand or food" /><input value={grams} onChange={e => setGrams(e.target.value)} type="number" inputMode="numeric" className={inputCls + ' w-20 text-right tnum'} placeholder="g" /></div>
        <Btn kind="accent" className="w-full mb-2" onClick={search}>{busy === 'search' ? 'Searching...' : 'Search Open Food Facts'}</Btn>
        {results && <div className="space-y-1.5">{results.map((p, i) => (<button key={i} onClick={() => pickProduct(p)} className="w-full text-left pixel-box p-3" style={{ background: 'var(--surface3)' }}><div className="text-[13px] font-semibold truncate">{p.name}</div><div className="text-[11px] text-[#8A8A90] truncate">{p.brand ? p.brand + ' · ' : ''}{p.per100.kcal} kcal / 100 g · P{Math.round(p.per100.protein)} C{Math.round(p.per100.carbs)} F{Math.round(p.per100.fat)}</div></button>))}</div>}
      </div>}
      {tab === 'manual' && <div>
        <div className="text-[12px] text-[#8A8A90] mb-2">The macros for this whole ingredient (your own food or off a label).</div>
        <div className="grid grid-cols-5 gap-2 mb-3">{[['kcal', 'kcal'], ['protein', 'P'], ['carbs', 'C'], ['fat', 'F'], ['fiber', 'Fibre']].map(([k, l]) => <label key={k} className="block"><div className="text-[10px] text-[#8A8A90] mb-1">{l}</div><input type="number" inputMode="decimal" value={man[k]} onChange={e => setMan(m => Object.assign({}, m, { [k]: e.target.value }))} className={inputCls + ' px-2 py-2 text-center tnum'} /></label>)}</div>
        <Btn kind="accent" className="w-full" onClick={() => onResolve({ kcal: +man.kcal || 0, protein: +man.protein || 0, carbs: +man.carbs || 0, fat: +man.fat || 0, fiber: +man.fiber || 0 }, { source: 'manual' })} disabled={!(+man.kcal || +man.protein || +man.carbs || +man.fat)}>Save these numbers</Btn>
      </div>}
      {err && <div className="text-[12px] text-[#F5C542] mt-3">{err}</div>}
    </div>
  </div>);
}
// Full-screen, step-by-step cooking view: big type, screen kept awake, per-step timer when a duration
// is mentioned, an ingredients drawer, and a finish step that hands off to logging. The moment a saved
// recipe becomes a cooked meal.
function CookMode({ recipe, onClose, onLogDone }) {
  useBackClose(onClose);
  const steps = (recipe.steps || []);
  const [i, setI] = useState(0);
  const [showIng, setShowIng] = useState(false);
  const [checked, setChecked] = useState({});
  const [timer, setTimer] = useState(null); // { left, total, on }
  // Keep the screen awake while cooking (re-acquire when returning to the tab).
  useEffect(() => {
    let lock, dead = false;
    const acquire = async () => { try { if (navigator.wakeLock && !dead) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* unsupported */ } };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { dead = true; document.removeEventListener('visibilitychange', onVis); try { lock && lock.release(); } catch (e) {} };
  }, []);
  useEffect(() => {
    if (!timer || !timer.on) return;
    if (timer.left <= 0) { try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch (e) {} return; }
    const t = setTimeout(() => setTimer(x => (x && x.on) ? Object.assign({}, x, { left: x.left - 1 }) : x), 1000);
    return () => clearTimeout(t);
  }, [timer]);
  if (!steps.length) return null;
  const last = i >= steps.length - 1;
  const durMin = (() => { const m = String(steps[i] || '').match(/(\d+)\s*(?:to|-|–)?\s*\d*\s*min/i); return m ? +m[1] : 0; })();
  const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const startTimer = () => setTimer({ left: durMin * 60, total: durMin * 60, on: true });
  return (<div className="fixed inset-0 z-[95] flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
    <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
      <button onClick={() => setShowIng(true)} className="pixel-box px-3 py-1.5 text-[12px] flex items-center gap-1.5" style={{ background: 'var(--surface3)' }}><Icon.recipe width="14" height="14" /> Ingredients</button>
      <div className="pf text-[10px] text-[#8A8A90]">STEP {i + 1} / {steps.length}</div>
      <button onClick={onClose} className="text-2xl leading-none text-[#8A8A90]" aria-label="Close">×</button>
    </div>
    <div className="h-1 mx-5 mb-2 rounded-full" style={{ background: 'var(--surface3)' }}><div className="h-1 rounded-full" style={{ width: ((i + 1) / steps.length * 100) + '%', background: 'var(--accent)' }} /></div>
    <div className="flex-1 overflow-y-auto px-6 flex flex-col justify-center">
      <div className="max-w-lg mx-auto w-full">
        <div className="pf text-[11px] mb-4" style={{ color: 'var(--accent)' }}>STEP {i + 1}</div>
        <div className="font-bold leading-snug" style={{ fontSize: 'clamp(1.4rem, 5vw, 2rem)' }}>{steps[i]}</div>
        {durMin > 0 && <div className="mt-6">
          {(!timer) ? <button onClick={startTimer} className="pixel-btn px-4 py-3 text-[14px] font-bold" style={{ background: 'var(--accent)', color: '#111' }}>Start {durMin} min timer</button>
            : <div className="flex items-center gap-3"><div className="tnum text-3xl font-bold" style={{ color: timer.left <= 0 ? 'var(--good)' : 'var(--text)' }}>{timer.left <= 0 ? 'Done!' : mmss(timer.left)}</div>
              <button onClick={() => setTimer(x => x && Object.assign({}, x, { on: !x.on }))} className="pixel-box px-3 py-2 text-[13px]" style={{ background: 'var(--surface3)' }}>{timer.on && timer.left > 0 ? 'Pause' : 'Resume'}</button>
              <button onClick={() => setTimer(null)} className="text-[13px] text-[#8A8A90] underline">Clear</button></div>}
        </div>}
      </div>
    </div>
    <div className="flex items-center gap-3 px-5 pt-3 pb-6" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
      <button onClick={() => { setTimer(null); setI(x => Math.max(0, x - 1)); }} disabled={i === 0} className="pixel-box px-4 py-3 text-[14px] disabled:opacity-40" style={{ background: 'var(--surface3)' }}>Back</button>
      {last ? <Btn kind="accent" className="flex-1" onClick={() => { onClose(); onLogDone(); }}>Done - log what you cooked</Btn>
        : <Btn kind="accent" className="flex-1" onClick={() => { setTimer(null); setI(x => Math.min(steps.length - 1, x + 1)); }}>Next step</Btn>}
    </div>
    {showIng && <div className="absolute inset-0 z-10 bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setShowIng(false)}>
      <div className="w-full lg:max-w-md rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[80vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><div className="text-base font-bold">Ingredients</div><button onClick={() => setShowIng(false)} className="text-xl leading-none text-[#8A8A90]">×</button></div>
        <div className="space-y-0.5">{recipe.ingredients.map(ing => (
          <button key={ing.id} onClick={() => setChecked(c => Object.assign({}, c, { [ing.id]: !c[ing.id] }))} className="w-full flex items-center gap-3 text-left py-2">
            <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[11px]" style={{ border: '2px solid ' + (checked[ing.id] ? 'var(--good)' : 'var(--border)'), background: checked[ing.id] ? 'var(--good)' : 'transparent', color: '#fff' }}>{checked[ing.id] ? '✓' : ''}</span>
            <span className="text-[14px]" style={{ color: checked[ing.id] ? 'var(--muted)' : 'var(--text)', textDecoration: checked[ing.id] ? 'line-through' : 'none' }}>{Rcp.lineOf(ing)}</span>
          </button>))}</div>
      </div>
    </div>}
  </div>);
}
function RecipeDetail({ recipe, db, update, showToast, onBack, onDelete, onLogRecipe, onSaveMeal }) {
  useBackClose(onBack);
  const [pickMeal, setPickMeal] = useState(null);
  const [portion, setPortion] = useState(1);
  const [macrosIng, setMacrosIng] = useState(null);
  const [busy, setBusy] = useState('');
  const [editIng, setEditIng] = useState(false);
  const [editSteps, setEditSteps] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [showColl, setShowColl] = useState(false);
  const [newColl, setNewColl] = useState('');
  const autoTried = useRef(false);
  const meals = mealsForDay(db, Store.todayISO());
  const today = Store.todayISO();
  const et = effectiveTarget(db, today);
  const tot = et ? sumMacros(entriesOn(db, today)) : null;
  const rem = et ? { kcal: et.eff.kcal - tot.kcal, protein: et.eff.protein_g - tot.protein, carbs: et.eff.carbs_g - tot.carbs, fat: et.eff.fat_g - tot.fat } : null;
  const fit = rem ? Rcp.fitScore(recipe.macros_per_serving, rem) : null;
  const total = (recipe.ingredients || []).length;
  const resolved = Rcp.resolvedCount(recipe);
  const missing = recipe.ingredients.filter(i => !i.have);
  const hasMacros = recipe.macros_per_serving.kcal > 0;

  // Mutate this recipe in the store; recompute per-serving macros from resolved ingredients.
  function patch(fn) {
    update(d => { const r = (d.recipes || []).find(x => x.id === recipe.id); if (!r) return; fn(r, d); if (Rcp.resolvedCount(r) > 0) r.macros_per_serving = Rcp.computePerServing(r).macros; r.updated_at = Date.now(); });
  }
  const setLine = (ingId, v) => patch((r) => { const ing = r.ingredients.find(x => x.id === ingId); if (ing) { ing.line = v; ing.name = Rcp.nameFromLine(v); } });
  const removeIng = (ingId) => patch((r) => { r.ingredients = r.ingredients.filter(x => x.id !== ingId); });
  const addIng = () => patch((r) => { r.ingredients = r.ingredients.concat([{ id: 'ing_' + Store.uid(), line: '', name: '', grams: 0, macros: null, resolved: null, have: false }]); });
  const toggleHave = (ingId) => patch((r) => { const ing = r.ingredients.find(x => x.id === ingId); if (ing) ing.have = !ing.have; });
  const setServings = (n) => patch((r) => { const s2 = Rcp.scaleServings(r, Math.max(1, n)); r.servings = s2.servings; r.ingredients = s2.ingredients; });
  const setTitle = (t) => patch((r) => { if (t.trim()) r.title = t.trim(); });
  const setSteps = (txt) => patch((r) => { r.steps = txt.split('\n').map(s => s.trim()).filter(Boolean); });
  const useStated = () => patch((r) => { if (r.stated_macros) { r.macros_per_serving = r.stated_macros; r.macros_source = 'stated'; } });
  const setIngMacros = (ingId, macros, meta) => patch((r) => { const ing = r.ingredients.find(x => x.id === ingId); if (!ing) return; ing.macros = { kcal: Math.round(+macros.kcal || 0), protein: +(+macros.protein || 0).toFixed(1), carbs: +(+macros.carbs || 0).toFixed(1), fat: +(+macros.fat || 0).toFixed(1), fiber: +(+macros.fiber || 0).toFixed(1) }; ing.resolved = Object.assign({ source: 'manual' }, meta || {}); r.macros_source = 'computed'; });
  async function addPhoto(e) { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; try { const im = await imageToB64(f, 720); patch((r) => { r.photo = 'data:' + im.mime + ';base64,' + im.b64; }); showToast('Photo added'); } catch (err) { showToast('Could not add that photo'); } }
  const toggleFav = () => patch((r) => { r.favorite = !r.favorite; });
  const shareOn = !(db.profile && db.profile.shareRecipes === false); // shared by default; opt-out only
  // Toggle whether this recipe joins the shared Discover pool. When sharing is on, push the change
  // straight away so the pool reflects it (browse hides anything flagged private).
  const togglePrivate = () => patch((r) => { r.private = !r.private; if (shareOn && r.source_url) submitPublicRecipe(r); });
  const toggleColl = (name) => patch((r) => { const s = new Set(r.collections || []); s.has(name) ? s.delete(name) : s.add(name); r.collections = Array.from(s); });
  const allCollections = Array.from(new Set((db.recipes || []).flatMap(r => r.collections || []))).sort();

  // Price the recipe from its ingredient lines: nutrition database first, AI fallback. Always numbers.
  async function analyze(auto) {
    const lines = (recipe.ingredients || []).map(i => Rcp.lineOf(i));
    if (!lines.some(l => l.trim())) return;
    setBusy('Working out the macros...');
    let result;
    try { result = await analyzeRecipe(recipe.title, lines); }
    catch (e) { setBusy(''); if (!auto) showToast('Could not work out macros: ' + e.message); return; }
    patch((r) => {
      (result.per_ingredient || []).forEach((p, i) => {
        const ing = r.ingredients[i]; if (!ing) return;
        const m = p && p.macros;
        if (m && (m.kcal || m.protein || m.carbs || m.fat)) { ing.macros = { kcal: Math.round(m.kcal), protein: +(+m.protein || 0).toFixed(1), carbs: +(+m.carbs || 0).toFixed(1), fat: +(+m.fat || 0).toFixed(1), fiber: +(+m.fiber || 0).toFixed(1) }; ing.grams = +p.weight || ing.grams || 0; ing.resolved = { source: p.source || result.source }; }
      });
      if (Rcp.resolvedCount(r) > 0) r.macros_source = result.source === 'edamam' ? 'analysed' : result.source;
    });
    setBusy('');
    if (!auto) showToast('Macros updated');
  }
  useEffect(() => { if (!autoTried.current && total && resolved < total && recipe.macros_source !== 'stated') { autoTried.current = true; analyze(true); } }, []);

  function doLog(mode, opts) { setPortion(1); setPickMeal(Object.assign({ mode }, opts)); }
  function logToMeal(mealId) {
    onLogRecipe(mealId, recipe, pickMeal.mode, portion);
    if (pickMeal.batch) patch(r => { r.batch = { left: Math.max(0, (r.servings || 1) - portion), cooked_at: Date.now() }; });
    else if (pickMeal.leftover) patch(r => { if (r.batch) r.batch.left = Math.max(0, (r.batch.left || 0) - portion); });
    setPickMeal(null);
  }
  function addMissingToShopping() {
    const additions = missing.map(i => ({ line: Rcp.lineOf(i), recipe_id: recipe.id }));
    let added = 0;
    update(d => {
      const pantry = {}; (d.pantry || []).forEach(n => { pantry[n] = 1; });
      const res = Rcp.addToShoppingList(d.shopping_list || [], additions, { uid: Store.uid, pantry, now: Date.now() });
      added = res.added; d.shopping_list = res.list;
    });
    showToast(added ? ('Added ' + added + ' to your shopping list') : 'Already on your list or in your pantry');
  }
  const srcLabel = { stated: 'as stated in the recipe', analysed: 'from a nutrition database', table: 'from standard measures', off: 'from Open Food Facts', mixed: 'standard measures, Open Food Facts and AI', ai: 'AI estimate', computed: 'from your ingredients', pending: 'not worked out yet' };
  const srcNote = srcLabel[recipe.macros_source] || (resolved > 0 ? 'from ' + resolved + ' of ' + total + ' ingredients' : 'not worked out yet');
  const fitColor = !fit ? MUTED : fit.fitsKcal ? 'var(--good)' : fit.overKcal <= (rem.kcal * 0.15) ? '#F5C542' : '#ff6b6b';
  const srcDot = { edamam: 'var(--good)', analysed: 'var(--good)', table: 'var(--good)', off: 'var(--good)', ai: '#F5C542', manual: 'var(--accent)', legacy: MUTED };
  return (<div className="fade-in">
    <div className="flex items-center justify-between mb-3">
      <button onClick={onBack} className="text-[13px] text-[#8A8A90]">‹ Recipes</button>
      <div className="flex items-center gap-3"><button onClick={() => onSaveMeal(recipe)} className="text-[12px]" style={{ color: 'var(--accent)' }}>Save as meal</button><button onClick={onDelete} className="text-[12px]" style={{ color: '#ff6b6b' }}>Delete</button></div>
    </div>
    <div className="relative w-full mb-3 pixel-box overflow-hidden" style={{ aspectRatio: '16 / 9', background: 'var(--surface3)' }}>
      <RecipeImg src={recipe.photo || recipe.thumbnail} iconSize={40} />
      {hasMacros && <div className="absolute top-2 right-2 pixel-box px-2.5 py-1 text-[12px] font-bold tnum" style={{ background: 'var(--bg)', color: 'var(--text)' }}>{Math.round(recipe.macros_per_serving.kcal)} kcal / serving</div>}
      <button onClick={toggleFav} aria-label="Favourite" className="absolute top-2 left-2 w-9 h-9 pixel-box flex items-center justify-center" style={{ background: 'var(--bg)', color: recipe.favorite ? FAT : 'var(--muted)' }}><Icon.star width="18" height="18" fill="currentColor" /></button>
      <label className="absolute bottom-2 right-2 pixel-box px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 cursor-pointer" style={{ background: 'var(--bg)', color: 'var(--text)' }}><Icon.cam width="14" height="14" /> {recipe.photo ? 'Change' : 'Photo'}<input type="file" accept="image/*" className="hidden" onChange={addPhoto} /></label>
    </div>
    {/* textarea, not input: long titles wrap instead of clipping at the card edge; auto-grows to fit */}
    <textarea key={recipe.id} defaultValue={recipe.title} rows={1}
      ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
      onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
      onBlur={e => setTitle(e.target.value)}
      className="text-xl font-bold leading-tight mb-1 w-full bg-transparent focus:outline-none resize-none overflow-hidden" />
    <div className="text-[12px] text-[#8A8A90] mb-2">{Rcp.platformLabel(recipe.source_platform)}{recipe.source_url ? ' · ' : ''}{recipe.source_url && <a href={recipe.source_url} target="_blank" rel="noreferrer" className="underline">watch original</a>} · tap anything to make it yours</div>
    <div className="flex flex-wrap items-center gap-2 mb-1">
      {(recipe.collections || []).map(c => <span key={c} className="pixel-box px-2 py-1 text-[11px]" style={{ background: 'var(--surface3)' }}>{c}</span>)}
      <button onClick={() => setShowColl(true)} className="text-[11px]" style={{ color: 'var(--accent)' }}>{(recipe.collections || []).length ? '+ collection' : '+ Add to a collection'}</button>
    </div>
    <Card className="p-3 mb-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-[#8A8A90]">Macros per serving · {srcNote}</div>
        {fit && hasMacros && <span className="pf text-[8px] uppercase px-2 py-1 rounded" style={{ color: fitColor, border: '1px solid ' + fitColor }}>{fit.fitsKcal ? 'fits today' : fit.overKcal + ' over'}</span>}
      </div>
      {hasMacros ? <RecipeMacroStrip macros={recipe.macros_per_serving} per /> : <div className="text-[12px] text-[#8A8A90]">Tap “Work out the macros” below.</div>}
      {fit && rem && hasMacros && <div className="text-[11px] text-[#8A8A90] mt-2 leading-snug">A serving is {Math.round(recipe.macros_per_serving.kcal)} kcal; you have {Math.max(0, Math.round(rem.kcal))} kcal and {Math.max(0, Math.round(rem.protein))} g protein left today.</div>}
    </Card>
    {hasMacros && (() => { const s = Rcp.macroSanity(recipe); return s ? <div className="pixel-box p-3 mb-3 text-[12px] leading-snug" style={{ background: 'var(--surface3)', borderColor: '#F5C542', color: '#F5C542' }}>Heads up: {s.msg} <button onClick={() => analyze(false)} className="underline font-semibold">Re-work out</button></div> : null; })()}
    {busy ? <div className="text-[12px] mb-4 flex items-center gap-2" style={{ color: 'var(--accent)' }}><PixelDino size={16} color="var(--accent)" /> {busy}</div>
      : <div className="flex gap-2 mb-3">
        <Btn kind={hasMacros ? 'ghost' : 'accent'} className="flex-1" onClick={() => analyze(false)}>{hasMacros ? 'Re-work out the macros' : 'Work out the macros'}</Btn>
      </div>}
    {recipe.stated_macros && recipe.macros_source !== 'stated' && <button onClick={useStated} className="text-[12px] mb-4 underline" style={{ color: 'var(--accent)' }}>Use the recipe's stated macros instead</button>}
    {(recipe.steps || []).length > 0 && <Btn kind="accent" className="w-full mb-4 flex items-center justify-center gap-2" onClick={() => setCooking(true)}><Icon.recipe width="18" height="18" /> Start cooking</Btn>}
    <div className="flex items-center justify-between mb-2 mt-2">
      <div className="flex items-center gap-3"><div className="text-lg font-bold">Ingredients</div><button onClick={() => setEditIng(v => !v)} className="pf text-[9px] uppercase px-2 py-1 rounded" style={{ color: editIng ? '#111' : 'var(--accent)', background: editIng ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)' }}>{editIng ? 'Done' : 'Edit'}</button></div>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-[#8A8A90]">Serves</span>
        <button onClick={() => setServings(recipe.servings - 1)} className="pixel-box w-7 h-7 flex items-center justify-center" style={{ background: 'var(--surface3)' }}>-</button>
        <span className="tnum w-5 text-center font-bold">{recipe.servings}</span>
        <button onClick={() => setServings(recipe.servings + 1)} className="pixel-box w-7 h-7 flex items-center justify-center" style={{ background: 'var(--surface3)' }}>+</button>
      </div>
    </div>
    {editIng ? <>
      <div className="text-[11px] text-[#8A8A90] mb-2">Edit each line, amount first (e.g. "150 g cottage cheese"), then tap Done.</div>
      <div className="space-y-2 mb-2">
        {recipe.ingredients.map((ing) => (
          <div key={ing.id} className="flex items-center gap-2">
            <input key={Rcp.lineOf(ing)} defaultValue={Rcp.lineOf(ing)} onBlur={e => setLine(ing.id, e.target.value)} placeholder="e.g. 150 g cottage cheese" className={inputCls + ' flex-1 py-2 text-[14px]'} />
            <button onClick={() => removeIng(ing.id)} className="text-[#8A8A90] text-xl leading-none px-1 shrink-0" aria-label="Remove">×</button>
          </div>
        ))}
      </div>
      <button onClick={addIng} className="text-[12px] mb-2" style={{ color: 'var(--accent)' }}>+ Add ingredient</button>
      <Btn kind="ghost" className="w-full mb-4" onClick={() => analyze(false)} disabled={!!busy}>Re-work out the macros</Btn>
    </> : <>
      <div className="text-[11px] text-[#8A8A90] mb-2">Tick what you have. Tap a macro line to fix its numbers, or Edit to change the ingredients.</div>
      {resolved > 0 && <div className="text-[10px] text-[#8A8A90] mb-2 flex flex-wrap items-center gap-x-3 gap-y-1"><span><span style={{ color: 'var(--good)' }}>●</span> database</span><span><span style={{ color: '#F5C542' }}>●</span> AI estimate</span><span><span style={{ color: 'var(--accent)' }}>●</span> your number</span></div>}
      <div className="space-y-2.5 mb-4">
        {recipe.ingredients.map((ing) => (
          <div key={ing.id} className="flex items-start gap-2.5">
            <button onClick={() => toggleHave(ing.id)} className="w-5 h-5 mt-0.5 rounded flex items-center justify-center shrink-0 text-[11px]" style={{ border: '2px solid ' + (ing.have ? 'var(--good)' : 'var(--border)'), background: ing.have ? 'var(--good)' : 'transparent', color: '#fff' }}>{ing.have ? '✓' : ''}</button>
            <div className="flex-1 min-w-0">
              <button onClick={() => toggleHave(ing.id)} className="block w-full text-left text-[14px]" style={{ color: ing.have ? 'var(--muted)' : 'var(--text)', textDecoration: ing.have ? 'line-through' : 'none' }}>{Rcp.lineOf(ing)}</button>
              <button onClick={() => setMacrosIng(ing)} className="text-[11px] flex items-center gap-1.5 mt-0.5" style={{ color: ing.macros ? 'var(--muted)' : 'var(--accent)' }}>
                {ing.resolved && <span style={{ color: srcDot[ing.resolved.source] || MUTED }}>●</span>}
                {ing.macros ? <span className="tnum">{Math.round(ing.macros.kcal)} kcal · P{Math.round(ing.macros.protein)} C{Math.round(ing.macros.carbs)} F{Math.round(ing.macros.fat)} · edit</span> : <span>Set macros ›</span>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>}
    <Btn kind="ghost" className="w-full mb-5" onClick={addMissingToShopping} disabled={!missing.length}>{missing.length ? ('Add ' + missing.length + ' missing to shopping list') : 'You have everything'}</Btn>
    <div className="flex items-center justify-between mb-2"><div className="text-lg font-bold">Method</div><button onClick={() => setEditSteps(v => !v)} className="text-[12px]" style={{ color: 'var(--accent)' }}>{editSteps ? 'Done' : 'Edit'}</button></div>
    {editSteps ? <textarea defaultValue={(recipe.steps || []).join('\n')} onBlur={e => setSteps(e.target.value)} rows={Math.max(4, (recipe.steps || []).length + 1)} className={inputCls + ' resize-y leading-relaxed mb-6'} placeholder="One instruction per line" />
      : (recipe.steps || []).length > 0 ? <ol className="space-y-2 mb-6">{recipe.steps.map((s, i) => (<li key={i} className="flex gap-3"><span className="pf text-[10px] shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>{i + 1}</span><span className="text-[14px] leading-relaxed">{s}</span></li>))}</ol>
      : <div className="text-[12px] text-[#8A8A90] mb-6">No method yet. Tap Edit to add the steps.</div>}
    {Rcp.batchLeft(recipe) > 0 && <div className="pixel-box p-3 mb-3 flex items-center gap-3" style={{ background: 'var(--surface3)', borderColor: 'var(--good)' }}>
      <div className="flex-1 min-w-0"><div className="text-[13px] font-bold">{Rcp.batchLeft(recipe)} serving{Rcp.batchLeft(recipe) === 1 ? '' : 's'} of leftovers</div><div className="text-[11px] text-[#8A8A90]">Batch cooked. Log one when you eat it.</div></div>
      <Btn kind="accent" className="shrink-0" onClick={() => doLog('single', { leftover: true })} disabled={!hasMacros}>Log one</Btn>
    </div>}
    <Btn kind="accent" className="w-full" onClick={() => doLog('single')} disabled={!hasMacros}>{hasMacros ? 'Log a serving to today' : 'Work out the macros to log this'}</Btn>
    {resolved > 0 && hasMacros && <button onClick={() => doLog('items')} className="w-full text-[12px] text-[#8A8A90] mt-3 underline">Log itemised (one diary entry per ingredient)</button>}
    {hasMacros && Rcp.batchLeft(recipe) === 0 && <button onClick={() => doLog('single', { batch: true })} className="w-full text-[12px] text-[#8A8A90] mt-3 underline">Batch cooking? Log a serving and keep the rest as leftovers</button>}
    {shareOn && recipe.source_url && <button onClick={togglePrivate} className="w-full flex items-center justify-center gap-2 text-[12px] text-[#8A8A90] mt-4">
      <span className="w-4 h-4 rounded flex items-center justify-center text-[10px]" style={{ border: '2px solid ' + (recipe.private ? 'var(--accent)' : 'var(--border)'), background: recipe.private ? 'var(--accent)' : 'transparent', color: '#111' }}>{recipe.private ? '✓' : ''}</span>
      Keep this recipe private (off Discover)
    </button>}
    {pickMeal && <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setPickMeal(null)}>
      <BackClose onClose={() => setPickMeal(null)} />
      <div className="w-full lg:max-w-sm rounded-t-3xl lg:rounded-3xl p-5 pb-8" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
        <div className="text-base font-bold mb-1">Log {recipe.title}</div>
        <div className="text-[12px] text-[#8A8A90] mb-3">{portion === 1 ? '1 serving' : portion + ' servings'} · {Math.round((recipe.macros_per_serving.kcal || 0) * portion)} kcal · P{Math.round((recipe.macros_per_serving.protein || 0) * portion)}{pickMeal.mode === 'items' ? ' · itemised' : ''}</div>
        {pickMeal.batch && <div className="pixel-box p-2.5 mb-3 text-[11px] leading-snug" style={{ background: 'var(--surface3)', color: 'var(--muted)' }}>Logs this serving now; the other {Math.max(0, (recipe.servings || 1) - portion)} become leftovers you can log on later days.</div>}
        <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">How much</div>
        {(() => { const fp = rem && Rcp.fitPortion(recipe.macros_per_serving, rem); return fp ? (
          <button onClick={() => setPortion(fp)} className="w-full pixel-box px-3 py-2.5 mb-2 text-left text-[12px] flex items-center justify-between" style={{ background: portion === fp ? 'var(--accent)' : 'var(--surface3)', color: portion === fp ? '#111' : 'var(--text)' }}>
            <span className="font-bold">Fit my day · {fp}×</span>
            <span className="tnum">{Math.round((recipe.macros_per_serving.kcal || 0) * fp)} kcal · P{Math.round((recipe.macros_per_serving.protein || 0) * fp)}</span>
          </button>) : null; })()}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {[0.5, 1, 1.5, 2].map(pp => <button key={pp} onClick={() => setPortion(pp)} className="pixel-box px-3 py-2 text-[13px]" style={{ background: portion === pp ? 'var(--accent)' : 'var(--surface3)', color: portion === pp ? '#111' : 'var(--text)', fontWeight: portion === pp ? 700 : 400 }}>{pp === 1 ? '1' : pp}×</button>)}
          <input type="number" step="0.25" min="0.25" value={portion} onChange={e => setPortion(Math.max(0.25, +e.target.value || 1))} className={inputCls + ' w-20 py-2 text-center tnum'} aria-label="Custom portion" />
        </div>
        <div className="pf text-[9px] uppercase text-[#8A8A90] mb-2">To which meal</div>
        <div className="space-y-2">{meals.map(m => <button key={m.id} onClick={() => logToMeal(m.id)} className="w-full pixel-box px-4 py-3 text-left text-[14px]" style={{ background: 'var(--surface3)' }}>{m.name}</button>)}</div>
      </div>
    </div>}
    {macrosIng && <IngredientMacroSheet ingredient={recipe.ingredients.find(x => x.id === macrosIng.id) || macrosIng} onResolve={(macros, meta) => { setIngMacros(macrosIng.id, macros, meta); setMacrosIng(null); showToast('Set macros for ' + (macrosIng.name || 'ingredient')); }} onClose={() => setMacrosIng(null)} />}
    {cooking && <CookMode recipe={recipe} onClose={() => setCooking(false)} onLogDone={() => doLog('single')} />}
    {showColl && <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setShowColl(false)}>
      <BackClose onClose={() => setShowColl(false)} />
      <div className="w-full lg:max-w-sm rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[80vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><div className="text-base font-bold">Collections</div><button onClick={() => setShowColl(false)} className="text-xl leading-none text-[#8A8A90]">×</button></div>
        <div className="text-[12px] text-[#8A8A90] mb-3">Group this recipe so you can find it later (e.g. Weeknight, High-protein, Fakeaways).</div>
        <div className="space-y-1.5 mb-4">{allCollections.map(c => { const on = (recipe.collections || []).includes(c); return (
          <button key={c} onClick={() => toggleColl(c)} className="w-full flex items-center gap-3 pixel-box px-3 py-2.5 text-left text-[14px]" style={{ background: 'var(--surface3)' }}>
            <span className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[11px]" style={{ border: '2px solid ' + (on ? 'var(--good)' : 'var(--border)'), background: on ? 'var(--good)' : 'transparent', color: '#fff' }}>{on ? '✓' : ''}</span>{c}
          </button>); })}</div>
        <div className="flex gap-2"><input value={newColl} onChange={e => setNewColl(e.target.value)} className={inputCls + ' flex-1'} placeholder="New collection" /><Btn kind="accent" onClick={() => { const n = newColl.trim(); if (n) { toggleColl(n); setNewColl(''); } }}>Add</Btn></div>
      </div>
    </div>}
  </div>);
}

function ShoppingListView({ db, update, showToast, onBack }) {
  useBackClose(onBack);
  const toast = (m) => { if (showToast) showToast(m); };
  const [add, setAdd] = useState('');
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [showPantry, setShowPantry] = useState(false);
  const rtitle = {}; (db.recipes || []).forEach(r => { rtitle[r.id] = r.title; });
  const listAll = db.shopping_list || [];
  const pantry = db.pantry || [];
  const unchecked = listAll.filter(x => !x.checked);
  const checked = listAll.filter(x => x.checked).sort((a, b) => (b.added_at || 0) - (a.added_at || 0));
  const groups = {}; unchecked.forEach(it => { const c = it.category || 'Other'; (groups[c] = groups[c] || []).push(it); });
  Object.keys(groups).forEach(c => groups[c].sort((a, b) => (b.added_at || 0) - (a.added_at || 0)));
  const known = Rcp.CATEGORY_ORDER || [];
  const cats = known.filter(c => groups[c]).concat(Object.keys(groups).filter(c => known.indexOf(c) < 0));

  const toggle = (id) => update(d => { const it = (d.shopping_list || []).find(x => x.id === id); if (it) it.checked = !it.checked; });
  const removeItem = (id) => update(d => { tombstone(d, [id]); d.shopping_list = (d.shopping_list || []).filter(x => x.id !== id); });
  const clearChecked = () => update(d => { const ids = (d.shopping_list || []).filter(x => x.checked).map(x => x.id); tombstone(d, ids); d.shopping_list = (d.shopping_list || []).filter(x => !x.checked); });
  const alwaysHave = (it) => update(d => {
    const key = Rcp._norm(it.name); const p = (d.pantry || []).slice(); if (p.indexOf(key) < 0) p.push(key); d.pantry = p;
    tombstone(d, [it.id]); d.shopping_list = (d.shopping_list || []).filter(x => x.id !== it.id);
    toast('Moved to your pantry, we\'ll stop adding it');
  });
  const removeFromPantry = (name) => update(d => { d.pantry = (d.pantry || []).filter(n => n !== name); });
  function addManual() {
    const line = add.trim(); if (!line) return;
    update(d => { const res = Rcp.addToShoppingList(d.shopping_list || [], [{ line, recipe_id: null }], { uid: Store.uid, pantry: {}, now: Date.now(), manual: true }); d.shopping_list = res.list; });
    setAdd('');
  }
  function saveEdit(id) {
    const val = editVal.trim(); const tok = Rcp.parseQtyToken(val);
    update(d => { const it = (d.shopping_list || []).find(x => x.id === id); if (it) { it.qtys = tok ? Rcp.addQty({}, tok) : {}; it.qty_label = val; } });
    setEditId(null); setEditVal('');
  }
  const attrOf = (it) => { const ts = (it.recipe_ids || []).map(id => rtitle[id]).filter(Boolean); if (!ts.length) return ''; return ts.length === 1 ? ('for ' + ts[0]) : ('for ' + ts[0] + ' +' + (ts.length - 1)); };
  function listText() {
    let out = 'Shopping list';
    cats.forEach(c => { out += '\n\n' + c + '\n' + groups[c].map(it => '- ' + it.name + (it.qty_label ? ' (' + it.qty_label + ')' : '')).join('\n'); });
    return out;
  }
  async function shareList() {
    const text = listText();
    try { if (navigator.share) { await navigator.share({ title: 'Shopping list', text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('List copied'); } catch (e) { toast('Could not copy'); }
  }

  const row = (it) => (
    <div key={it.id} className="flex items-center gap-2.5 py-2">
      <button onClick={() => toggle(it.id)} aria-label={it.checked ? 'Untick' : 'Tick'} className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[11px]" style={{ border: '2px solid ' + (it.checked ? 'var(--good)' : 'var(--border)'), background: it.checked ? 'var(--good)' : 'transparent', color: '#fff' }}>{it.checked ? '✓' : ''}</button>
      <button onClick={() => toggle(it.id)} className="flex-1 min-w-0 text-left">
        <div className="text-[14px] truncate" style={{ color: it.checked ? 'var(--muted)' : 'var(--text)', textDecoration: it.checked ? 'line-through' : 'none' }}>{it.name}</div>
        {!it.checked && attrOf(it) && <div className="text-[11px] text-[#8A8A90] truncate">{attrOf(it)}</div>}
      </button>
      {editId === it.id
        ? <input autoFocus value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => saveEdit(it.id)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(it.id); }} className="w-16 text-[12px] text-right bg-transparent shrink-0" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }} />
        : <button onClick={() => { setEditId(it.id); setEditVal(it.qty_label || ''); }} className="text-[12px] text-[#8A8A90] tnum shrink-0 min-w-[24px] text-right">{it.qty_label || '+'}</button>}
      {!it.checked && <button onClick={() => alwaysHave(it)} title="Always have (stop adding this to lists)" aria-label="Always have" className="pf text-[6.5px] uppercase text-[#8A8A90] shrink-0 leading-none" style={{ letterSpacing: '.5px' }}>Have</button>}
      <button onClick={() => removeItem(it.id)} aria-label="Remove" className="text-[#8A8A90] text-lg leading-none px-0.5 shrink-0">×</button>
    </div>
  );

  return (<div className="fade-in">
    <button onClick={onBack} className="text-[13px] text-[#8A8A90] mb-3">‹ Recipes</button>
    <div className="flex items-center justify-between mb-3 gap-3">
      <h1 className="text-xl font-bold">Shopping list</h1>
      <div className="flex items-center gap-3 shrink-0">
        {unchecked.length > 0 && <button onClick={shareList} className="text-[12px] flex items-center gap-1" style={{ color: 'var(--accent)' }}><Icon.share width="14" height="14" /> Share</button>}
        {checked.length > 0 && <button onClick={clearChecked} className="text-[12px] text-[#8A8A90] underline">Clear ticked</button>}
      </div>
    </div>

    <form onSubmit={e => { e.preventDefault(); addManual(); }} className="flex gap-2 mb-4">
      <input value={add} onChange={e => setAdd(e.target.value)} placeholder="Add an item, e.g. 2 milk" className="flex-1 min-w-0 pixel-box px-3 py-2 text-[14px] bg-transparent" style={{ color: 'var(--text)' }} />
      <Btn kind="primary" type="submit" disabled={!add.trim()} className="shrink-0 px-4">Add</Btn>
    </form>

    {!listAll.length
      ? <Card className="p-6 text-center"><div className="text-[13px] font-semibold mb-1">Nothing to buy yet</div><div className="text-[12px] text-[#8A8A90]">Add an item above, or open a recipe and add its missing ingredients. Items combine and sort themselves into aisles.</div></Card>
      : <>
        {cats.map(c => (
          <div key={c} className="mb-4">
            <div className="pf text-[8px] uppercase tracking-widest text-[#8A8A90] mb-1.5">{c}</div>
            <div className="space-y-0.5">{groups[c].map(row)}</div>
          </div>
        ))}
        {checked.length > 0 && <div className="mb-4 pt-2" style={{ borderTop: '2px solid var(--border)' }}>
          <div className="pf text-[8px] uppercase tracking-widest text-[#8A8A90] mb-1.5">Ticked ({checked.length})</div>
          <div className="space-y-0.5">{checked.map(row)}</div>
        </div>}
      </>}

    {pantry.length > 0 && <div className="mt-2">
      <button onClick={() => setShowPantry(v => !v)} className="text-[11px] text-[#8A8A90]">{showPantry ? 'Hide' : 'Show'} pantry ({pantry.length}) {showPantry ? '' : '›'}</button>
      {showPantry && <Card className="p-3 mt-2">
        <div className="text-[11px] text-[#8A8A90] mb-2">Things you always have. We won't add these from recipes. Remove one to start buying it again.</div>
        <div className="flex flex-wrap gap-1.5">{pantry.map(n => (
          <button key={n} onClick={() => removeFromPantry(n)} className="pf text-[7px] uppercase px-2 py-1 leading-none flex items-center gap-1" style={{ background: 'var(--surface3)', color: 'var(--muted)', border: '1px solid var(--border)' }}>{n} ×</button>
        ))}</div>
      </Card>}
    </div>}
  </div>);
}
// The Cook game layer: cooking recipes climbs a Chef level, so the gamification spans the recipe hub
// and reinforces the two moats (fun + recipes). Progression only for now; a Chef-exclusive Macrodex
// catch at a milestone is the planned payoff.
const CHEF_TIERS = [1, 5, 15, 40, 100];
const CONTRIB_LEVELS = ['Getting started', 'Contributor', 'Regular', 'Curator', 'Cookbook builder', 'Community legend'];
function chefLevel(n) { return Game.badgeTier(n || 0, CHEF_TIERS); }
// Recipes you've added to the shared library (priced + not private) - the behaviour that grows the
// community cookbook the whole app runs on. Uploading is the reward, not cooking.
function sharedCount(db) { return ((db && db.recipes) || []).filter(r => r.source_url && !r.private && (r.macros_per_serving || {}).kcal > 0).length; }
function ChefCard({ db }) {
  const shared = sharedCount(db);
  const cooked = (db.cook_stats && db.cook_stats.cooked) || 0;
  const bt = chefLevel(shared);
  const name = CONTRIB_LEVELS[Math.min(bt.level, CONTRIB_LEVELS.length - 1)];
  const nextName = CONTRIB_LEVELS[Math.min(bt.level + 1, CONTRIB_LEVELS.length - 1)];
  const toGo = bt.next != null ? bt.next - shared : 0;
  return (
    <div className="pixel-box p-3.5 mb-4" style={{ background: 'var(--card)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <div className="pf text-[8px] uppercase tracking-widest text-[#8A8A90]">Community cookbook · Lvl {bt.level}</div>
          <div className="text-sm font-bold truncate">{name}</div>
        </div>
        <div className="text-right shrink-0 pl-3"><div className="text-lg font-bold tnum leading-none" style={{ color: 'var(--accent)' }}>{shared}</div><div className="pf text-[7px] uppercase text-[#8A8A90] mt-1">shared{cooked ? ' · ' + cooked + ' cooked' : ''}</div></div>
      </div>
      {bt.next != null ? <>
        <div className="pixel-bar mb-1.5" style={{ height: 8, borderWidth: 2 }}><i style={{ width: Math.round((bt.progress || 0) * 100) + '%', background: 'var(--accent)' }} /></div>
        <div className="text-[10px] text-[#8A8A90] leading-snug">{toGo} more to <b style={{ color: 'var(--text)' }}>{nextName}</b>. Every import joins the shared cookbook, always credited to its creator.</div>
      </> : <div className="text-[10px] text-[#8A8A90] leading-snug">{shared} recipes shared. You're keeping the whole cookbook stocked.</div>}
    </div>
  );
}
// Format the original creator's credit: Instagram handles get an @, YouTube channels shown as-is.
function creditName(pub) {
  const a = String(pub.source_author || '').trim();
  if (!a) return Rcp.platformLabel(pub.source_platform);
  // Handles (no spaces) get an @; real display names ("Emily English") are shown as-is.
  return (pub.source_platform === 'instagram' && !a.startsWith('@') && !/\s/.test(a)) ? '@' + a : a;
}
// Image-forward, reel-shaped (portrait) card - Instagram covers are portrait, so this frames them
// naturally. Everything sits on the image: title + protein + creator on a scrim, kcal badge on top.
function PublicRecipeCard({ pub, onOpen }) {
  return (<button onClick={onOpen} className="text-left w-full active:opacity-95">
    <div className="pixel-box overflow-hidden" style={{ background: 'var(--card)' }}>
      <div className="relative w-full" style={{ aspectRatio: '3 / 4', background: 'var(--surface3)' }}>
        <RecipeImg src={pub.thumbnail} iconSize={34} />
        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-bold tnum" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{Math.round(pub.kcal)} kcal</div>
        <div className="absolute inset-x-0 bottom-0 pt-10 px-2.5 pb-2" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}>
          <div className="font-bold text-[13px] leading-tight mb-1" style={{ ...clamp2, color: '#fff' }}>{pub.title}</div>
          <div className="flex items-center gap-1.5 text-[10px] min-w-0">
            <span className="tnum font-bold shrink-0" style={{ color: '#7CFF9B' }}>{Math.round(pub.protein)}g protein</span>
            {pub.source_author ? <span className="truncate" style={{ color: 'rgba(255,255,255,0.72)' }}>· {creditName(pub)}</span> : null}
          </div>
        </div>
      </div>
    </div>
  </button>);
}
// The global recipe hub: a Mob-style library of every recipe the community has imported, credited to
// the original creator. Browsing it is the paid feature (free users get a blurred taste + upsell);
// importing and cooking your own is always free. Rendered as a tab, so no header/back of its own.
function RecipeHub({ db, isPremium, onSaveCopy, onConsent, showToast, onImport, onGoMine }) {
  const consent = db.profile ? db.profile.shareRecipes : undefined;
  const today = Store.todayISO();
  const et = effectiveTarget(db, today);
  const remKcal = et ? Math.max(0, Math.round(et.eff.kcal - sumMacros(entriesOn(db, today)).kcal)) : 0;
  // One filter axis, Mob-style: a single row of pills. "For today" = fits your remaining macros,
  // "High protein", then meal categories. Search also matches creators, so there's no separate creator row.
  const [pick, setPick] = useState(remKcal > 0 ? 'today' : 'all'); // today | protein | all | <meal>
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [teaser, setTeaser] = useState([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const openPaywall = () => { try { window.MPAYWALL && window.MPAYWALL({ type: 'premium_required' }); } catch (_) {} };
  async function load() {
    setBusy(true); setErr('');
    try {
      const opts = { search: q };
      if (pick === 'today') opts.kcalMax = remKcal || null;
      else if (pick === 'protein') opts.minProtein = 25;
      else if (pick === 'quick') opts.effort = 'quick';
      else if (pick === 'breakfast') opts.meal = 'breakfast';
      else if (pick && pick.indexOf('m:') === 0) opts.main = pick.slice(2);
      setItems(await browsePublicRecipes(opts));
    } catch (e) { setErr('Could not load recipes just now.'); setItems([]); }
    setBusy(false);
  }
  // Free users still get a blurred taste of what is inside, so the lock sells itself.
  useEffect(() => { if (!isPremium) browsePublicRecipes({ limit: 6 }).then(setTeaser, () => {}); }, [isPremium]);
  useEffect(() => { if (isPremium) load(); }, [isPremium, pick]);
  useEffect(() => { if (!isPremium) return; const t = setTimeout(load, 350); return () => clearTimeout(t); }, [q]);

  if (!isPremium) {
    return (<div className="fade-in">
      <div className="pixel-box overflow-hidden mb-4" style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent)' }}>
        <div className="p-4">
          <div className="pf text-[8px] uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Macrosaurus Premium</div>
          <div className="text-lg font-bold mb-1.5 leading-tight">Every recipe, from everyone</div>
          <div className="text-[12px] text-[#8A8A90] leading-snug mb-3">Unlock the full community library: Instagram &amp; YouTube recipes other members have imported, priced for macros and credited to the original creator. Filter by meal, cuisine or creator and find tonight's cook in seconds.</div>
          <button onClick={openPaywall} className="w-full pixel-btn py-2.5 text-[11px] pf" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>TRY PREMIUM FREE</button>
          <div className="text-[10px] text-center text-[#8A8A90] mt-2">7 days free, then cancel anytime</div>
        </div>
      </div>
      {teaser.length > 0 && <div className="relative mb-4" onClick={openPaywall}>
        <div className="grid grid-cols-2 gap-3" style={{ filter: 'blur(3px)', opacity: 0.85, pointerEvents: 'none' }}>{teaser.slice(0, 4).map((p, i) => <PublicRecipeCard key={i} pub={p} onOpen={() => {}} />)}</div>
        <div className="absolute inset-0 flex items-center justify-center"><span className="pixel-box px-4 py-2 text-[11px] pf" style={{ background: 'var(--bg)', color: 'var(--text)' }}>🔒 Unlock the library</span></div>
      </div>}
      <button onClick={onGoMine} className="w-full text-center text-[12px] text-[#8A8A90] py-2 leading-snug">Free forever: import and cook your own recipes. <span style={{ color: 'var(--accent)' }}>My recipes ›</span></button>
    </div>);
  }

  // Lead with the axes that actually help you decide what to cook (Mob-style): fit, protein, speed,
  // breakfast (the one distinct meal), then main ingredient. Lunch/dinner are tied together as "everything else".
  const pills = [...(remKcal > 0 ? [['today', 'For today']] : []), ['protein', 'High protein'], ['quick', 'Quick'], ['breakfast', 'Breakfast'], ['m:chicken', 'Chicken'], ['m:beef', 'Beef'], ['m:fish', 'Fish'], ['m:veg', 'Veggie'], ['all', 'All']];
  const pm = preview ? { kcal: preview.kcal, protein: preview.protein, carbs: preview.carbs, fat: preview.fat, fiber: preview.fiber } : null;
  const chipStyle = on => ({ background: on ? 'var(--accent)' : 'var(--surface3)', color: on ? 'var(--on-accent)' : 'var(--text)', fontWeight: on ? 700 : 400 });
  const chipCls = 'pixel-box px-3 py-1.5 text-[12px] whitespace-nowrap shrink-0';
  const filtered = q.trim() || (pick && pick !== 'today' && pick !== 'all');
  return (<div className="fade-in">
    <TextInput placeholder="Search recipes or creators…" value={q} onChange={e => setQ(e.target.value)} />
    <div className="flex gap-2 overflow-x-auto pb-1 mt-3 mb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {pills.map(([k, l]) => <button key={k} onClick={() => setPick(k)} className={chipCls} style={chipStyle(pick === k)}>{l}</button>)}
    </div>
    {consent === undefined && <Card className="p-3 mb-3 mt-1" style={{ background: 'var(--surface3)' }}>
      <div className="text-[12px] leading-snug mb-2"><span className="font-bold">Recipes you import join the library.</span> Shared with everyone, credited to the original creator, never to you. You can keep any recipe private.</div>
      <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={() => { onConsent(true); showToast('Great - your imports help everyone'); }}>Sounds good</Btn><Btn kind="ghost" onClick={() => onConsent(false)}>Keep mine private</Btn></div>
    </Card>}
    {busy ? <DinoLoader label="Finding recipes" />
      : err ? <div className="text-center text-[13px] text-[#F5C542] py-8">{err}</div>
      : items && items.length ? <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-1">{items.map((p, i) => <PublicRecipeCard key={i} pub={p} onOpen={() => setPreview(p)} />)}</div>
      : <Card className="p-6 text-center"><div className="text-[14px] font-semibold mb-1">{filtered ? 'No recipes match' : 'The library is just getting started'}</div><div className="text-[12px] text-[#8A8A90] leading-relaxed max-w-[18rem] mx-auto">{filtered ? 'Try a different search or category.' : 'Be one of the first: '}{!filtered && <button onClick={onImport} style={{ color: 'var(--accent)' }}>import a recipe</button>}{!filtered ? ' and it joins the hub for everyone.' : ''}</div></Card>}
    {preview && <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setPreview(null)}>
      <BackClose onClose={() => setPreview(null)} />
      <div className="w-full lg:max-w-md rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[88vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
        <div className="relative w-full mb-3 pixel-box overflow-hidden" style={{ aspectRatio: '16 / 9', background: 'var(--surface3)' }}><RecipeImg src={preview.thumbnail} iconSize={40} /></div>
        <div className="flex items-start justify-between gap-3 mb-1"><div className="text-lg font-bold leading-tight">{preview.title}</div><button onClick={() => setPreview(null)} className="text-xl leading-none text-[#8A8A90] shrink-0">×</button></div>
        {preview.source_author ? <div className="text-[12px] mb-2" style={{ color: 'var(--accent)' }}>via {creditName(preview)}</div> : null}
        <Card className="p-3 mb-3"><div className="text-[11px] text-[#8A8A90] mb-2">Per serving · serves {preview.servings}</div><RecipeMacroStrip macros={pm} per /></Card>
        <div className="text-[13px] font-bold mb-1">Ingredients</div>
        <ul className="space-y-1 mb-3 text-[13px]">{(preview.ingredients || []).map((l, i) => <li key={i}>{l}</li>)}</ul>
        {(preview.steps || []).length > 0 && <><div className="text-[13px] font-bold mb-1">Method</div><ol className="space-y-1.5 mb-4 text-[13px]">{preview.steps.map((s, i) => <li key={i} className="flex gap-2"><span className="pf text-[9px] mt-0.5" style={{ color: 'var(--accent)' }}>{i + 1}</span><span>{s}</span></li>)}</ol></>}
        <Btn kind="accent" className="w-full" onClick={() => { onSaveCopy(preview); setPreview(null); }}>Save to my recipes</Btn>
        {preview.source_url && <a href={preview.source_url} target="_blank" rel="noreferrer" className="block text-center text-[12px] mt-3 underline text-[#8A8A90]">Watch the original</a>}
      </div>
    </div>}
  </div>);
}
// Weekly meal planner: drop recipes onto days, see planned macros vs your target, build one shopping
// list for the week, and log a planned meal to the diary when you cook it. Ties recipes -> shopping
// -> diary and gives the adaptive engine a forward view of intake.
function PlannerView({ db, update, showToast, onBack, onOpenRecipe, onLogOn }) {
  useBackClose(onBack);
  const today = Store.todayISO();
  const [weekStart, setWeekStart] = useState(today);
  const [pick, setPick] = useState(null); // date being planned
  const days = Array.from({ length: 7 }, (_, i) => shiftISO(weekStart, i));
  const byId = {}; (db.recipes || []).forEach(r => { byId[r.id] = r; });
  const priced = (db.recipes || []).filter(r => r.macros_per_serving && r.macros_per_serving.kcal > 0).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const planFor = (d) => (db.meal_plan || []).filter(p => p.date === d);
  const addToPlan = (date, recipeId) => { update(d => { d.meal_plan = (d.meal_plan || []).concat([{ id: Store.uid(), date, recipe_id: recipeId, portion: 1, cooked: false, added_at: Date.now() }]); }); setPick(null); showToast('Added to ' + dayLabel(date)); };
  const removeFromPlan = (id) => update(d => { tombstone(d, [id]); d.meal_plan = (d.meal_plan || []).filter(p => p.id !== id); });
  const logPlanned = (p) => { const r = byId[p.recipe_id]; if (!r) return; onLogOn(p.date, r, p.portion || 1); update(d => { const e = (d.meal_plan || []).find(x => x.id === p.id); if (e) e.cooked = true; }); showToast('Logged ' + r.title + ' to ' + dayLabel(p.date)); };
  function dayLabel(d) { return d === today ? 'today' : new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }); }
  function addWeekToShopping() {
    const additions = [];
    days.forEach(d => planFor(d).forEach(p => { const r = byId[p.recipe_id]; if (!r) return; (r.ingredients || []).filter(i => !i.have).forEach(i => additions.push({ line: Rcp.lineOf(i), recipe_id: r.id })); }));
    let added = 0;
    update(d => {
      const pantry = {}; (d.pantry || []).forEach(n => { pantry[n] = 1; });
      const res = Rcp.addToShoppingList(d.shopping_list || [], additions, { uid: Store.uid, pantry, now: Date.now() });
      added = res.added; d.shopping_list = res.list;
    });
    showToast(added ? ('Added this week to your shopping list') : 'Those are already on your list or in your pantry');
  }
  const plannedCount = days.reduce((n, d) => n + planFor(d).length, 0);
  return (<div className="fade-in">
    <button onClick={onBack} className="text-[13px] text-[#8A8A90] mb-3">‹ Recipes</button>
    <div className="flex items-center justify-between mb-3">
      <PageHeader kicker="Cook" title="Meal plan" />
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={() => setWeekStart(shiftISO(weekStart, -7))} className="pixel-box w-9 h-9 flex items-center justify-center" style={{ background: 'var(--surface3)' }} aria-label="Previous week">‹</button>
        <button onClick={() => setWeekStart(today)} className="pixel-box px-2.5 h-9 text-[11px] flex items-center" style={{ background: 'var(--surface3)' }}>This week</button>
        <button onClick={() => setWeekStart(shiftISO(weekStart, 7))} className="pixel-box w-9 h-9 flex items-center justify-center" style={{ background: 'var(--surface3)' }} aria-label="Next week">›</button>
      </div>
    </div>
    {plannedCount > 0 && <Btn kind="ghost" className="w-full mb-4 flex items-center justify-center gap-2" onClick={addWeekToShopping}><Icon.cart width="16" height="16" /> Add this week's ingredients to shopping</Btn>}
    <div className="space-y-3">
      {days.map(d => {
        const entries = planFor(d);
        const et = effectiveTarget(db, d);
        const planned = Rcp.planMacros(entries, byId);
        const targetK = et ? Math.round(et.eff.kcal) : 0;
        const isToday = d === today;
        return (<Card key={d} className="p-3.5" style={isToday ? { borderColor: 'var(--accent)' } : null}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold">{new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}{isToday ? ' · today' : ''}</div>
            {entries.length > 0 && targetK > 0 && <div className="text-[11px] tnum" style={{ color: planned.kcal > targetK * 1.05 ? '#ff6b6b' : 'var(--muted)' }}>{planned.kcal} / {targetK} kcal</div>}
          </div>
          {entries.length > 0 && <div className="space-y-1.5 mb-2">
            {entries.map(p => { const r = byId[p.recipe_id]; if (!r) return null; const mk = Math.round((r.macros_per_serving.kcal || 0) * (p.portion || 1)); return (
              <div key={p.id} className="flex items-center gap-2">
                <button onClick={() => onOpenRecipe(r.id)} className="flex-1 min-w-0 text-left flex items-center gap-2">
                  <span className="text-[13px] truncate" style={{ textDecoration: p.cooked ? 'line-through' : 'none', color: p.cooked ? 'var(--muted)' : 'var(--text)' }}>{r.title}</span>
                  <span className="text-[10px] text-[#8A8A90] tnum shrink-0">{mk} kcal</span>
                </button>
                {!p.cooked && <button onClick={() => logPlanned(p)} className="pf text-[8px] uppercase px-2 py-1 rounded shrink-0" style={{ color: 'var(--accent)', border: '1px solid var(--accent)' }}>Log</button>}
                <button onClick={() => removeFromPlan(p.id)} className="text-[#8A8A90] text-lg leading-none px-0.5 shrink-0" aria-label="Remove">×</button>
              </div>); })}
          </div>}
          <button onClick={() => setPick(d)} className="text-[12px]" style={{ color: 'var(--accent)' }}>+ Add a recipe</button>
        </Card>);
      })}
    </div>
    {pick && <div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setPick(null)}>
      <BackClose onClose={() => setPick(null)} />
      <div className="w-full lg:max-w-md rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[80vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><div className="text-base font-bold">Add to {new Date(pick + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })}</div><button onClick={() => setPick(null)} className="text-xl leading-none text-[#8A8A90]">×</button></div>
        {priced.length ? <div className="space-y-1.5">{priced.map(r => (
          <button key={r.id} onClick={() => addToPlan(pick, r.id)} className="w-full flex items-center gap-3 pixel-box px-3 py-2.5 text-left" style={{ background: 'var(--surface3)' }}>
            <span className="flex-1 min-w-0 text-[14px] truncate">{r.title}</span>
            <span className="text-[11px] text-[#8A8A90] tnum shrink-0">{Math.round(r.macros_per_serving.kcal)} kcal</span>
          </button>))}</div>
          : <div className="text-[13px] text-[#8A8A90] text-center py-6">No priced recipes yet. Import a recipe and work out its macros first.</div>}
      </div>
    </div>}
  </div>);
}
// Faceted filter + sort sheet for the recipe library. Only shows facet values that actually exist in
// the user's recipes, so at 5 recipes it's tiny and at 500 it's rich, no dead options either way.
function RecipeFilterSheet({ db, facets, setFacet, sort, setSort, onClear, onClose }) {
  const present = k => { const s = new Set(); (db.recipes || []).forEach(r => { const v = (r.tags || {})[k]; if (v) s.add(v); }); return Rcp.TAX[k].filter(x => s.has(x)); };
  const diets = (() => { const s = new Set(); (db.recipes || []).forEach(r => (((r.tags || {}).diet) || []).forEach(d => s.add(d))); return Rcp.TAX.diet.filter(x => s.has(x)); })();
  const Group = ({ label, k, values }) => values.length ? (<div className="mb-4">
    <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">{label}</div>
    <div className="flex flex-wrap gap-2">
      {values.map(v => { const on = facets[k] === v; return <button key={v} onClick={() => setFacet(k, v)} className="pixel-box px-2.5 py-1.5 text-[12px]" style={{ background: on ? 'var(--accent)' : 'var(--surface3)', color: on ? 'var(--on-accent)' : 'var(--text)', fontWeight: on ? 700 : 400 }}>{Rcp.taxLabel(v)}</button>; })}
    </div>
  </div>) : null;
  const sorts = [['recent', 'Recent'], ['protein', 'Most protein'], ['kcal', 'Fewest calories'], ['quick', 'Quickest']];
  return (<div className="fixed inset-0 z-[85] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
    <BackClose onClose={onClose} />
    <div className="w-full lg:max-w-md rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4"><div className="text-base font-bold">Filter &amp; sort</div><button onClick={onClose} className="text-xl leading-none text-[#8A8A90]" aria-label="Close">×</button></div>
      <div className="mb-4">
        <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Show</div>
        <div className="flex flex-wrap gap-2"><button onClick={() => setFacet('badge', 'high-protein')} className="pixel-box px-2.5 py-1.5 text-[12px]" style={{ background: facets.badge === 'high-protein' ? 'var(--accent)' : 'var(--surface3)', color: facets.badge === 'high-protein' ? 'var(--on-accent)' : 'var(--text)', fontWeight: facets.badge === 'high-protein' ? 700 : 400 }}>High protein</button></div>
      </div>
      <Group label="Meal" k="meal" values={present('meal')} />
      <Group label="Cuisine" k="cuisine" values={present('cuisine')} />
      <Group label="Main ingredient" k="main" values={present('main')} />
      <Group label="Effort" k="effort" values={present('effort')} />
      {diets.length > 0 && <div className="mb-4">
        <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Diet</div>
        <div className="flex flex-wrap gap-2">{diets.map(v => { const on = facets.diet === v; return <button key={v} onClick={() => setFacet('diet', v)} className="pixel-box px-2.5 py-1.5 text-[12px]" style={{ background: on ? 'var(--accent)' : 'var(--surface3)', color: on ? 'var(--on-accent)' : 'var(--text)', fontWeight: on ? 700 : 400 }}>{Rcp.taxLabel(v)}</button>; })}</div>
      </div>}
      <div className="mb-5">
        <div className="pf text-[8px] uppercase text-[#8A8A90] mb-2">Sort by</div>
        <div className="flex flex-wrap gap-2">{sorts.map(([k, l]) => <button key={k} onClick={() => setSort(k)} className="pixel-box px-2.5 py-1.5 text-[12px]" style={{ background: sort === k ? 'var(--accent)' : 'var(--surface3)', color: sort === k ? 'var(--on-accent)' : 'var(--text)', fontWeight: sort === k ? 700 : 400 }}>{l}</button>)}</div>
      </div>
      <div className="flex gap-2"><Btn kind="ghost" className="flex-1" onClick={onClear}>Clear all</Btn><Btn kind="accent" className="flex-1" onClick={onClose}>Show recipes</Btn></div>
    </div>
  </div>);
}
function Recipes({ db, update, showToast, importUrl, onConsumeImport, openRecipeId, onConsumeOpen, onLogRecipe, onLogOn, onSaveMeal, isPremium }) {
  const [screen, setScreen] = useState('list'); // list | import | detail | shopping | discover | plan
  const [activeId, setActiveId] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'fav' | a collection name
  const [facets, setFacets] = useState({}); // { meal, cuisine, main, effort, diet, badge } - taxonomy filters
  const [sort, setSort] = useState('recent'); // recent | protein | kcal | quick
  const [showFilters, setShowFilters] = useState(false);
  const [hubTab, setHubTab] = useState('discover'); // discover (the community hub) | mine (your own recipes)
  const facetCount = Object.values(facets).filter(Boolean).length;
  const setFacet = (k, v) => setFacets(f => { const n = Object.assign({}, f); if (n[k] === v) delete n[k]; else n[k] = v; return n; });
  // Arriving from a share: jump straight into the importer with the shared link.
  useEffect(() => { if (importUrl) { setScreen('import'); } }, [importUrl]);
  // Arriving from the dashboard gap strip: jump straight to that recipe's detail.
  useEffect(() => { if (openRecipeId) { setActiveId(openRecipeId); setScreen('detail'); onConsumeOpen && onConsumeOpen(); } }, [openRecipeId]);
  const allRecipes = (db.recipes || []).slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const collections = Array.from(new Set(allRecipes.flatMap(r => r.collections || []))).sort();
  const ql = q.trim().toLowerCase();
  // Search now also matches the auto-tags, so typing "thai" or "high protein" just works.
  const tagText = r => { const t = r.tags || {}; return [t.meal, t.cuisine, t.main, t.effort].concat(t.diet || []).filter(Boolean).join(' '); };
  const recipes = allRecipes.filter(r => {
    if (filter === 'fav' && !r.favorite) return false;
    if (filter !== 'all' && filter !== 'fav' && !((r.collections || []).includes(filter))) return false;
    if (facetCount && !Rcp.matchesFilters(r, facets)) return false;
    if (!ql) return true;
    return (r.title || '').toLowerCase().includes(ql) || tagText(r).includes(ql) || (r.ingredients || []).some(i => (Rcp.lineOf(i) || '').toLowerCase().includes(ql));
  });
  const density = r => { const m = r.macros_per_serving || {}; return m.kcal > 0 ? m.protein * 4 / m.kcal : 0; };
  if (sort === 'protein') recipes.sort((a, b) => density(b) - density(a));
  else if (sort === 'kcal') recipes.sort((a, b) => ((a.macros_per_serving || {}).kcal || 1e9) - ((b.macros_per_serving || {}).kcal || 1e9));
  else if (sort === 'quick') recipes.sort((a, b) => (((a.tags || {}).effort === 'quick') ? 0 : 1) - (((b.tags || {}).effort === 'quick') ? 0 : 1));
  // Rails only headline the browse home: plain "All", no search, no facets. Filtering shows the flat grid.
  const showRails = filter === 'all' && !ql && !facetCount;
  const toggleFav = (id) => update(d => { const r = (d.recipes || []).find(x => x.id === id); if (r) r.favorite = !r.favorite; });
  // One-time repair: recipes imported before thumbnails were inlined still point at expiring
  // Instagram CDN links. Quietly re-extract each one's art and store it as a data URL. A few at a
  // time, once per session per recipe; failures just keep the placeholder.
  useEffect(() => {
    const stale = (db.recipes || []).filter(r => !r.photo && r.source_url && /^https?:\/\//.test(r.thumbnail || '') && /(cdninstagram\.com|fbcdn\.net)\//.test(r.thumbnail) && !thumbFixTried.has(r.id));
    if (!stale.length) return;
    let stop = false;
    (async () => {
      for (const r of stale.slice(0, 4)) {
        thumbFixTried.add(r.id);
        try {
          const src = await extractRecipeSource(r.source_url);
          const dataUrl = await inlineThumb(src);
          if (!stop && dataUrl) update(d => { const t = (d.recipes || []).find(x => x.id === r.id); if (t) { t.thumbnail = dataUrl; t.updated_at = Date.now(); } });
        } catch (e) { /* leave the placeholder; retried next session */ }
      }
    })();
    return () => { stop = true; };
  }, []);
  // Seed the shared library from recipes imported before sharing was on: once consent is granted,
  // push the user's priced, non-private recipes up (credited to the original creator), once each per session.
  useEffect(() => {
    if (db.profile && db.profile.shareRecipes === false) return; // shared by default (opt-out only)
    (db.recipes || [])
      .filter(r => !r.private && r.source_url && (r.macros_per_serving || {}).kcal > 0 && !sharedThisSession.has(r.id))
      .slice(0, 25)
      .forEach(r => { sharedThisSession.add(r.id); submitPublicRecipe(r); });
  }, [db.profile && db.profile.shareRecipes, (db.recipes || []).length]);
  // One-time tag backfill: recipes imported before the taxonomy existed have no tags. Classify each
  // from its title + ingredients (cheap fast-model call), a few per session. Once per recipe per session.
  useEffect(() => {
    const untagged = (db.recipes || []).filter(r => !(r.tags && r.tags.meal) && !tagFixTried.has(r.id));
    if (!untagged.length) return;
    let stop = false;
    (async () => {
      for (const r of untagged.slice(0, 6)) {
        tagFixTried.add(r.id);
        const tags = await tagRecipe(r);
        if (!stop && tags) update(d => { const t = (d.recipes || []).find(x => x.id === r.id); if (t) { t.tags = tags; t.updated_at = Date.now(); } });
      }
    })();
    return () => { stop = true; };
  }, []);
  // Creator backfill: recipes imported before creator-capture existed have no source_author. Re-extract
  // the original creator from the source link and, if sharing is on, re-share so the pool gets credited
  // too. A few per session; Instagram sometimes hides it, in which case we just leave it blank.
  useEffect(() => {
    const need = (db.recipes || []).filter(r => r.source_url && !((r.source_author || '').trim()) && !authorFixTried.has(r.id));
    if (!need.length) return;
    let stop = false;
    (async () => {
      for (const r of need.slice(0, 6)) {
        authorFixTried.add(r.id);
        try {
          const src = await extractRecipeSource(r.source_url);
          if (!stop && src && src.author) update(d => {
            const t = (d.recipes || []).find(x => x.id === r.id);
            if (t) { t.source_author = String(src.author).trim(); t.updated_at = Date.now(); if (!(d.profile && d.profile.shareRecipes === false) && !t.private) submitPublicRecipe(t); }
          });
        } catch (_) { /* creator not recoverable - leave blank */ }
      }
    })();
    return () => { stop = true; };
  }, []);
  const active = allRecipes.find(r => r.id === activeId);
  // If the open recipe vanishes (deleted, or its id no longer resolves), fall back to the list.
  useEffect(() => { if (screen === 'detail' && !active) setScreen('list'); }, [screen, active]);
  const shoppingCount = (db.shopping_list || []).filter(x => !x.checked).length;
  function saveRecipe(rec) {
    const id = Store.uid();
    const saved = Object.assign({}, rec, { id, user_id: Store.USER, created_at: Date.now(), updated_at: Date.now() });
    update(d => { d.recipes = (d.recipes || []).concat([saved]); });
    onConsumeImport && onConsumeImport();
    setActiveId(id); setScreen('detail');
    showToast('Saved ' + rec.title);
    // Contribute to the shared library if the user has opted in and it is not marked private.
    if (!(db.profile && db.profile.shareRecipes === false) && !saved.private) submitPublicRecipe(saved);
  }
  // Save a copy of a Discover recipe into the user's own collection. It is already priced, so keep
  // the stated per-serving macros. Mark it as a copy so it is not re-submitted as if it were ours.
  function saveCopyFromPublic(pub) {
    const rec = Rcp.normalize({
      title: pub.title, servings: pub.servings, ingredients: pub.ingredients || [], steps: pub.steps || [],
      stated_macros_per_serving: { kcal: pub.kcal, protein_g: pub.protein, carbs_g: pub.carbs, fat_g: pub.fat, fiber_g: pub.fiber },
      source_platform: pub.source_platform, tags: { meal: pub.meal, cuisine: pub.cuisine, main: pub.main, effort: pub.effort },
    }, { platform: pub.source_platform, url: pub.source_url, author: pub.source_author || '', thumbnail: pub.thumbnail || '' });
    rec.private = true; // a saved copy stays private - the original submitter already seeded it
    const id = Store.uid();
    update(d => { d.recipes = (d.recipes || []).concat([Object.assign({}, rec, { id, user_id: Store.USER, created_at: Date.now(), updated_at: Date.now() })]); });
    setActiveId(id); setScreen('detail');
    showToast('Saved ' + rec.title);
  }
  // Record the one-time sharing choice. Turning it on backfills the pool with existing priced recipes.
  function setShareConsent(on) {
    update(d => { d.profile = d.profile || {}; d.profile.shareRecipes = !!on; });
    if (on) (db.recipes || []).forEach(r => { if (!r.private) submitPublicRecipe(r); });
  }
  function deleteRecipe(id) {
    const r = allRecipes.find(x => x.id === id);
    update(d => { tombstone(d, [id]); d.recipes = (d.recipes || []).filter(x => x.id !== id); });
    setScreen('list'); setActiveId(null);
    showToast('Deleted ' + (r ? r.title : 'recipe'), 'Undo', () => update(d => { if (r) { untombstone(d, [id]); d.recipes = (d.recipes || []).concat([r]); } }));
  }
  function cancelImport() { onConsumeImport && onConsumeImport(); setScreen('list'); }

  return (<div className="max-w-md lg:max-w-2xl mx-auto px-5 pb-28 lg:pb-12 pt-6 fade-in">
    {screen === 'list' && <>
      <div className="flex items-center justify-between mb-4">
        <PageHeader kicker="Cook" title="Recipes" />
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setScreen('plan')} className="pixel-box w-10 h-10 flex items-center justify-center" style={{ background: 'var(--surface3)' }} aria-label="Meal plan">
            <Icon.calendar width="19" height="19" />
          </button>
          <button onClick={() => setScreen('shopping')} className="relative pixel-box w-10 h-10 flex items-center justify-center" style={{ background: 'var(--surface3)' }} aria-label="Shopping list">
            <Icon.cart width="20" height="20" />
            {shoppingCount > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: 'var(--accent)', color: '#111' }}>{shoppingCount}</span>}
          </button>
        </div>
      </div>
      <ChefCard db={db} />
      {/* The Cook page is the recipe hub: Discover = the whole community library (premium), Mine = yours (free). */}
      <div className="flex gap-1 mb-4 pixel-box p-1 text-[12px]" style={{ background: 'var(--surface2)', boxShadow: 'none' }}>
        <button onClick={() => setHubTab('discover')} className={`flex-1 py-2 flex items-center justify-center gap-1.5 ${hubTab === 'discover' ? 'bg-white text-black font-bold' : 'text-[#8A8A90]'}`} style={{ borderRadius: 2 }}>Discover{!isPremium && <span style={{ opacity: 0.7 }}>🔒</span>}</button>
        <button onClick={() => setHubTab('mine')} className={`flex-1 py-2 ${hubTab === 'mine' ? 'bg-white text-black font-bold' : 'text-[#8A8A90]'}`} style={{ borderRadius: 2 }}>My recipes</button>
      </div>
      {hubTab === 'discover'
        ? <RecipeHub db={db} isPremium={isPremium} onSaveCopy={saveCopyFromPublic} onConsent={setShareConsent} showToast={showToast} onImport={() => setScreen('import')} onGoMine={() => setHubTab('mine')} />
        : !allRecipes.length ? <>
        <Btn kind="accent" className="w-full mb-3" onClick={() => setScreen('import')}>Import a recipe from a video</Btn>
        <ShareTip className="mb-4" />
        <Card className="p-6 text-center">
          <div className="mb-3 flex justify-center"><Icon.recipe width="32" height="32" style={{ color: 'var(--muted)' }} /></div>
          <div className="text-[14px] font-semibold mb-1">No recipes yet</div>
          <div className="text-[12px] text-[#8A8A90] leading-relaxed max-w-[18rem] mx-auto">Send a cooking Reel or Short here and it turns into ingredients, a method and per-serving macros you can log.</div>
        </Card>
      </> : <>
        <Btn kind="accent" className="w-full mb-3" onClick={() => setScreen('import')}>Import a recipe from a video</Btn>
        <div className="flex gap-2 items-stretch">
          <div className="flex-1 min-w-0"><TextInput placeholder="Search your recipes…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button onClick={() => setShowFilters(true)} className="pixel-box px-3 flex items-center gap-1.5 shrink-0 text-[12px]" style={{ background: facetCount ? 'var(--accent)' : 'var(--surface3)', color: facetCount ? 'var(--on-accent)' : 'var(--text)' }} aria-label="Filters"><Icon.sliders width="15" height="15" />{facetCount ? <span className="pf text-[8px]">{facetCount}</span> : <span className="hidden sm:inline">Filters</span>}</button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 my-3 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {[['all', 'All'], ['fav', '★ Favourites']].concat(collections.map(c => [c, c])).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className="pixel-box px-3 py-1.5 text-[12px] whitespace-nowrap shrink-0" style={{ background: filter === k ? 'var(--accent)' : 'var(--surface3)', color: filter === k ? '#111' : 'var(--text)', fontWeight: filter === k ? 700 : 400 }}>{l}</button>
          ))}
        </div>
        {showRails
          ? <div className="mt-1"><RecipeRails db={db} onOpenRecipe={id => { setActiveId(id); setScreen('detail'); }} limit={4} /></div>
          : recipes.length ? <>
            {(facetCount || sort !== 'recent') && <div className="text-[11px] text-[#8A8A90] mb-2 tnum">{recipes.length} recipe{recipes.length === 1 ? '' : 's'}{sort !== 'recent' ? ' · ' + ({ protein: 'most protein', kcal: 'fewest calories', quick: 'quickest' })[sort] : ''}</div>}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{recipes.map(r => <RecipeCard key={r.id} recipe={r} onOpen={() => { setActiveId(r.id); setScreen('detail'); }} onFav={() => toggleFav(r.id)} />)}</div>
          </>
          : <div className="text-center text-[13px] text-[#8A8A90] py-10">No recipes match. <button onClick={() => { setFacets({}); setQ(''); setFilter('all'); }} style={{ color: 'var(--accent)' }}>Clear filters</button></div>}
      </>}
      {showFilters && <RecipeFilterSheet db={db} facets={facets} setFacet={setFacet} sort={sort} setSort={setSort} onClear={() => { setFacets({}); setSort('recent'); }} onClose={() => setShowFilters(false)} />}
    </>}
    {screen === 'import' && <RecipeImport initialUrl={importUrl || ''} onSaved={saveRecipe} onCancel={cancelImport} />}
    {screen === 'detail' && active && <RecipeDetail recipe={active} db={db} update={update} showToast={showToast} onBack={() => setScreen('list')} onDelete={() => deleteRecipe(active.id)} onLogRecipe={onLogRecipe} onSaveMeal={onSaveMeal} />}
    {screen === 'shopping' && <ShoppingListView db={db} update={update} showToast={showToast} onBack={() => setScreen("list")} />}
    {screen === 'plan' && <PlannerView db={db} update={update} showToast={showToast} onBack={() => setScreen('list')} onOpenRecipe={(id) => { setActiveId(id); setScreen('detail'); }} onLogOn={onLogOn} />}
  </div>);
}
// Premium upsell sheet. Opened manually (menu) or automatically when the AI proxy returns a
// free-limit / premium-only error. Checkout runs entirely server-side (billing edge function),
// so no Stripe code or keys live in the app; we just redirect to the returned Checkout URL.
function Paywall({ reason, onCheckout, onClose }) {
  const [plan, setPlan] = useState('annual');
  const [busy, setBusy] = useState(false);
  const headline = reason === 'premium_required' ? 'Body-fat scans are Premium'
    : reason === 'free_limit' ? "You've used your free AI logs"
    : 'Unlock Macrosaurus Premium';
  const blurb = reason === 'free_limit'
    ? `That's your ${FREE_AI_MONTHLY} free AI logs for this month. Go Premium for unlimited AI logging.`
    : reason === 'premium_required'
    ? 'AI body-fat estimates from a progress photo are a Premium feature.'
    : 'More AI, more insight, same honest coaching.';
  const benefits = [
    ['Unlimited AI logging', 'Snap a meal, scan a label, or describe it, with no monthly limit'],
    ['Body-fat photo scans', 'Estimate your body fat from a progress photo'],
    ['Everything in Free', 'Barcode, database, manual entry, the adaptive engine and the whole game'],
  ];
  async function go() { setBusy(true); try { await onCheckout(plan); } catch (_) {} setBusy(false); }
  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="w-full max-w-md pixel-box flex flex-col max-h-[92vh] overflow-hidden sheet-up" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
        <div className="p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest pf" style={{ color: 'var(--accent)' }}>Macrosaurus Premium</div>
            <button onClick={onClose} aria-label="Close" className="text-[#8A8A90] text-2xl leading-none">×</button>
          </div>
          <h2 className="text-xl font-bold mb-1">{headline}</h2>
          <div className="text-[12px] text-[#8A8A90] leading-relaxed mb-4">{blurb}</div>
          <div className="space-y-2.5 mb-4">
            {benefits.map(([t, d], i) => (
              <div key={i} className="flex gap-2.5 items-start">
                <div className="mt-0.5 shrink-0 font-bold" style={{ color: 'var(--good)' }}>✓</div>
                <div><div className="text-[13px] font-semibold">{t}</div><div className="text-[11px] text-[#8A8A90] leading-snug">{d}</div></div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mb-3">
            {[['annual', PRICE_ANNUAL_LABEL, '/year', 'Save 33%'], ['monthly', PRICE_MONTHLY_LABEL, '/month', '']].map(([k, price, per, tag]) => (
              <button key={k} onClick={() => setPlan(k)} className="flex-1 pixel-box p-3 text-left transition active:scale-[.99]"
                style={{ background: plan === k ? 'var(--accent-dim)' : 'var(--card)', borderColor: plan === k ? 'var(--accent)' : 'var(--surface2)' }}>
                <div className="flex items-baseline gap-1"><span className="text-lg font-bold">{price}</span><span className="text-[10px] text-[#8A8A90]">{per}</span></div>
                {tag ? <div className="text-[9px] pf mt-1" style={{ color: 'var(--accent)' }}>{tag}</div> : <div className="text-[9px] mt-1 text-[#8A8A90]">Billed monthly</div>}
              </button>
            ))}
          </div>
          <button onClick={go} disabled={busy} className="w-full pixel-btn py-3 text-[12px] pf disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            {busy ? 'STARTING…' : 'START 7-DAY FREE TRIAL'}
          </button>
          <div className="text-[10px] text-[#8A8A90] text-center mt-2 leading-relaxed">
            7 days free, then {plan === 'annual' ? PRICE_ANNUAL_LABEL + '/year' : PRICE_MONTHLY_LABEL + '/month'}. Cancel anytime.
          </div>
        </div>
      </div>
    </div>
  );
}
function App() {
  const [session, setSession] = useState(undefined);
  const [db, setDb] = useState(null);
  const [view, setView] = useState('dashboard');
  const [dexOpen, setDexOpen] = useState(false); // Play/Macrodex hub, opened from the header dino (mobile) or sidebar (desktop)
  const [fightOpen, setFightOpen] = useState(false); // boss fight, launched from inside the Play hub
  const [nameOpen, setNameOpen] = useState(false);   // name-your-dino, launched from inside the Play hub
  const [isAdmin, setIsAdmin] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [adding, setAdding] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false); // true = fresh check-in, 'review' = reopen the pending proposal
  const [adjusting, setAdjusting] = useState(null);    // log-entry id being tweaked from the post-log "Adjust" toast action
  const [shared, setShared] = useState(null); // { files, text } handed off from a Web Share / shortcut
  const [recipeImport, setRecipeImport] = useState(null); // a shared YouTube/Instagram link to import as a recipe
  const [openRecipeId, setOpenRecipeId] = useState(null); // a recipe to open straight to detail (from the dashboard gap strip)
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const entryHandled = useRef(false);
  const ghHandled = useRef(false);
  const [reveal, setReveal] = useState(null);
  const revealTimer = useRef(null);
  const [sub, setSub] = useState(null);           // this user's subscription row (or null = free)
  const [aiCalls, setAiCalls] = useState(0);      // AI actions used this month (for the free-tier meter)
  const [paywall, setPaywall] = useState(null);   // { reason } when the upsell sheet is open
  const [rewards, setRewards] = useState(null);   // { code, link, referrals_count, bonus_ai_remaining }
  const rewardsSyncedRef = useRef(false);
  const isPremium = !!sub && (sub.status === 'active' || sub.status === 'trialing');
  function showToast(msg, actionLabel, onAction, action2Label, onAction2) {
    clearTimeout(toastTimer.current);
    setToast({
      msg, actionLabel, onAction: onAction ? () => { onAction(); setToast(null); } : null,
      action2Label, onAction2: onAction2 ? () => { onAction2(); setToast(null); } : null,
    });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }
  // Celebrate the day's catch in the logging flow: an egg-crack reveal on the FIRST log of the
  // day, and an "upgraded" toast when a later log improves the provisional catch.
  function celebrateCatch(dateISO, newEntries) {
    if (!db || dateISO !== Store.todayISO()) return;
    const before = creatureForDay(db, dateISO);
    const sim = Object.assign({}, db, { log_entries: db.log_entries.concat(newEntries) });
    const after = creatureForDay(sim, dateISO);
    if (!after) return;
    if (!before) {
      clearTimeout(revealTimer.current);
      setReveal({ id: after.id, shiny: !!after.shiny });
      revealTimer.current = setTimeout(() => setReveal(null), 1450);
    } else if (before.id !== after.id && RARITY_RANK[CR_BY_ID[after.id].rarity] >= RARITY_RANK[CR_BY_ID[before.id].rarity]) {
      showToast("Today's catch upgraded: " + CR_BY_ID[after.id].name + '!');
    }
  }

  const themePref = (db && db.profile && db.profile.theme) === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('theme-light', themePref === 'light');
    el.classList.toggle('theme-dark', themePref !== 'light');
    // Match the phone's browser/status-bar chrome to the in-app theme (the header colour), overriding
    // the static prefers-color-scheme metas so a user who picks a theme in-app sees it edge to edge.
    let tc = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!tc) { tc = document.createElement('meta'); tc.setAttribute('name', 'theme-color'); document.head.appendChild(tc); }
    tc.setAttribute('content', themePref === 'light' ? '#5B4FA6' : '#000000');
    if (!document.getElementById('scanline')) { const d = document.createElement('div'); d.id = 'scanline'; d.className = 'scanline'; document.body.appendChild(d); }
  }, [themePref]);

  useEffect(() => {
    if (DEMO) { setSession({ user: { id: 'demo', email: 'demo@macrosaurus.app' } }); return; }
    if (!supa) { setSession(null); return; }
    supa.auth.getSession().then(function (r) { const ss = r.data.session || null; setSession(ss); if (ss && ss.user) window.MIDENTIFY && MIDENTIFY(ss.user.id); });
    const sub = supa.auth.onAuthStateChange(function (e, s) { if (e === 'PASSWORD_RECOVERY') setRecovering(true); setSession(s || null); if (!s) setDb(null); if (s && s.user) { window.MIDENTIFY && MIDENTIFY(s.user.id); } else { window.MRESET && MRESET(); } });
    return function () { sub.data.subscription.unsubscribe(); };
  }, []);
  // Am I an admin? A user may read only their own admins row (RLS), so this just decides whether to
  // surface the admin entry. Real authorisation is enforced server-side by the admin-api function.
  useEffect(() => {
    if (!session || !supa) { setIsAdmin(false); return; }
    let cancelled = false;
    supa.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle()
      .then(function (r) { if (!cancelled) setIsAdmin(!!(r && r.data)); }, function () { if (!cancelled) setIsAdmin(false); });
    return function () { cancelled = true; };
  }, [session]);
  // Subscription status + this month's AI usage (drives the paywall, premium badge and free meter).
  // The webhook writes the subscription row; the user may read only their own (RLS).
  useEffect(() => {
    if (!session || !supa) { setSub(null); setAiCalls(0); return; }
    let cancelled = false; const uid = session.user.id; const period = new Date().toISOString().slice(0, 7);
    const load = () => Promise.all([
      supa.from('subscriptions').select('status, plan, trial_end, current_period_end, cancel_at_period_end').eq('user_id', uid).maybeSingle(),
      supa.from('ai_usage').select('calls').eq('user_id', uid).eq('period', period).maybeSingle(),
    ]).then(function (res) { if (cancelled) return; setSub((res[0] && res[0].data) || null); setAiCalls(Number((res[1] && res[1].data && res[1].data.calls) || 0)); }, function () {});
    load();
    window.MREFRESH_SUB = load; // so the checkout-return handler can re-fetch once the webhook lands
    return function () { cancelled = true; try { if (window.MREFRESH_SUB === load) delete window.MREFRESH_SUB; } catch (_) {} };
  }, [session]);
  // Let aiRequest (a top-level helper) open the paywall when the proxy reports a limit/premium error.
  useEffect(() => {
    window.MPAYWALL = function (err) { const reason = (err && err.type) || 'manual'; setPaywall({ reason: reason }); window.MTRACK && MTRACK('paywall_view', { reason: reason }); };
    return function () { try { delete window.MPAYWALL; } catch (_) {} };
  }, []);
  // Referrals: once signed in with data loaded, claim any pending ?ref code, fetch our own link and
  // tally, and drain any creature rewards (ours, or ones a friend just earned us) into the dex. Runs
  // once per session; server-authoritative so a replay can never double-award.
  useEffect(() => {
    if (DEMO || !session || !supa || !db || rewardsSyncedRef.current) return;
    rewardsSyncedRef.current = true;
    let cancelled = false;
    (async function () {
      if (PENDING_REF) { await referralCall('claim', { code: PENDING_REF }); try { localStorage.removeItem('mac_ref'); } catch (_) {} PENDING_REF = null; }
      const mine = await referralCall('mine');
      if (!mine || cancelled) return;
      setRewards({ code: mine.code, link: mine.link, referrals_count: mine.referrals_count, bonus_ai_remaining: mine.bonus_ai_remaining });
      const pend = Array.isArray(mine.pending) ? mine.pending.filter(function (p) { return p && p.id && p.rid; }) : [];
      if (!pend.length) return;
      update(function (d) {
        d.catch_log = d.catch_log || {}; const day = Store.todayISO(); const arr = d.catch_log[day] || [];
        pend.forEach(function (p) { if (!arr.some(function (x) { return x.rid === p.rid; })) arr.push({ id: p.id, shiny: !!p.shiny, src: 'referral', rid: p.rid }); });
        d.catch_log[day] = arr;
      });
      referralCall('ack', { ids: pend.map(function (p) { return p.rid; }) });
      const cr = CR_BY_ID[pend[0].id];
      showToast(pend.length === 1 && cr
        ? 'Referral reward! ' + cr.name + ' joined your dex, plus 5 bonus AI logs.'
        : pend.length + ' referral rewards added, plus bonus AI logs.');
      window.MTRACK && MTRACK('referral_reward', { count: pend.length });
    })();
    return function () { cancelled = true; };
  }, [session, !!db]);
  // Expose premium state globally so deep, non-billing components (e.g. the body-fat trend teaser)
  // can gate an upsell without threading the flag through every parent. Read at render time.
  useEffect(() => { window.MISPREMIUM = isPremium; }, [isPremium]);
  // Celebrate climbing a Chef level (the Cook game layer). Ref-guarded so it only fires on a real rise.
  const chefLvlRef = useRef(null);
  useEffect(() => {
    if (!db) return;
    const lvl = chefLevel(sharedCount(db)).level;
    if (chefLvlRef.current != null && lvl > chefLvlRef.current) {
      showToast('You reached ' + CONTRIB_LEVELS[Math.min(lvl, CONTRIB_LEVELS.length - 1)] + ' in the community cookbook!');
      try { window.MTRACK && MTRACK('cookbook_levelup', { level: lvl }); } catch (_) {}
    }
    chefLvlRef.current = lvl;
  }, [db && sharedCount(db)]);
  // Returning from Stripe Checkout / the billing portal (?sub=success|cancel|portal).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('sub');
    if (!s) return;
    try { const u = new URL(window.location.href); u.searchParams.delete('sub'); window.history.replaceState({}, '', u.pathname + u.search + u.hash); } catch (_) {}
    if (s === 'success') { showToast('Welcome to Premium! Your subscription is active.'); window.MTRACK && MTRACK('checkout_success'); }
    else if (s === 'cancel') showToast('Checkout canceled, no charge was made.');
    const refresh = function () { window.MREFRESH_SUB && window.MREFRESH_SUB(); };
    refresh(); setTimeout(refresh, 2500); setTimeout(refresh, 6000); // the webhook may land a moment after redirect
  }, []);
  // Start a subscription Checkout, or open the Stripe billing portal. Both return a hosted URL we
  // redirect to; the secret key never touches the client.
  async function startCheckout(plan) {
    window.MTRACK && MTRACK('checkout_start', { plan: plan });
    try {
      const r = await supa.functions.invoke('billing', { body: { action: 'checkout', plan: plan, origin: window.location.origin } });
      const url = r && r.data && r.data.url;
      if (url) { window.location.href = url; return; }
    } catch (_) {}
    showToast('Could not start checkout. Please try again.');
  }
  async function openPortal() {
    try {
      const r = await supa.functions.invoke('billing', { body: { action: 'portal', origin: window.location.origin } });
      const url = r && r.data && r.data.url;
      if (url) { window.location.href = url; return; }
    } catch (_) {}
    showToast('Could not open billing. Please try again.');
  }
  useEffect(() => {
    if (DEMO) { setDb(demoState()); return; } // seed a fresh sample account; never load/save cloud
    if (!session) return; let cancelled = false; const uid = session.user.id;
    (async function () {
      // 1) Paint instantly from the local snapshot, this is what makes the app work offline.
      const local = await localLoad(uid);
      if (local && !cancelled) setDb(Store.migrate(local));
      // 2) Reconcile with the cloud when reachable; newest _rev wins, offline edits get pushed up.
      try {
        const remote = await cloudLoad(uid);
        if (cancelled) return;
        // Merge local + remote so neither can lose the other's entries, then converge both stores.
        // (Replaces the old highest-_rev-wins reconcile that let a stale copy overwrite good data.)
        const merged = Store.mergeStates(local, remote);
        if (merged) {
          setDb(Store.migrate(merged)); localSave(uid, merged);
          // If we hold entries the cloud was missing, push the union up to repair a prior overwrite.
          if (!remote || (merged.log_entries || []).length > ((remote.log_entries || []).length)
                       || (merged.weight_entries || []).length > ((remote.weight_entries || []).length)) cloudSave(uid, merged);
        } else { setDb(Store.defaultState()); }
      } catch (e) {
        if (!cancelled && !local) setDb(Store.defaultState()); // offline with no snapshot yet
      }
    })();
    return function () { cancelled = true; };
  }, [session]);

  const dbRef = useRef(null); dbRef.current = db;
  useEffect(() => {
    function flush() { if (session && dbRef.current) cloudSave(session.user.id, dbRef.current); }
    window.addEventListener('online', flush);
    return function () { window.removeEventListener('online', flush); };
  }, [session]);

  // Offer a reload when a freshly deployed service worker takes over. sw.js calls skipWaiting, so a
  // new build activates immediately; a controllerchange after we already had a controller means the
  // running page is now on old code. We also poll for a new deploy on load and on tab refocus.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    function onChange() { if (hadController) setUpdateReady(true); }
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    function check() { navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); }, function () {}); }
    check();
    function onVis() { if (document.visibilityState === 'visible') check(); }
    document.addEventListener('visibilitychange', onVis);
    return function () { navigator.serviceWorker.removeEventListener('controllerchange', onChange); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Handle launch intents once data is ready: home-screen shortcuts (?action=log/weigh) and Web
  // Share hand-offs (?shared=1 → pick the stashed photos out of the SW cache into the estimator).
  useEffect(() => {
    if (!db || !db.profile || entryHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action'), isShared = params.get('shared');
    if (!action && !isShared) { entryHandled.current = true; return; }
    entryHandled.current = true;
    const meals = mealsForDay(db, Store.todayISO());
    const firstMeal = meals[0] && meals[0].id;
    if (action === 'log') setAdding({ date: Store.todayISO(), mealId: firstMeal });
    else if (action === 'scan') setAdding({ date: Store.todayISO(), mealId: firstMeal, scan: true });
    else if (action === 'weigh') { setView('dashboard'); setTimeout(() => { const el = document.getElementById('checkin-card'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 400); }
    if (isShared) (async () => {
      try {
        const cache = await caches.open('share-incoming');
        const metaR = await cache.match('/shared-meta'); const meta = metaR ? await metaR.json() : { count: 0, text: '' };
        const files = [];
        for (let i = 0; i < (meta.count || 0); i++) { const r = await cache.match('/shared-file-' + i); if (r) { const b = await r.blob(); files.push(new File([b], 'shared-' + i + '.jpg', { type: b.type || 'image/jpeg' })); } }
        await Promise.all((await cache.keys()).map(k => cache.delete(k)));
        // A shared YouTube/Instagram link (no photos) means "import this as a recipe": jump to the
        // Recipes module and open the importer with the link. Photos still go to the meal estimator.
        const recShare = files.length ? null : (Rcp && Rcp.detectShare(meta.text || ''));
        if (recShare) { setRecipeImport(recShare.url); setView('recipes'); }
        else if (files.length) setShared({ files: files, text: meta.text || '' });
        else if (meta.text && firstMeal) setAdding({ date: Store.todayISO(), mealId: firstMeal });
      } catch (e) { /* ignore */ }
    })();
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) {}
  }, [db]);

  // Google Health: finish the OAuth callback (swap the code for step/sleep data), then a first sync.
  // Ongoing freshness is handled by the foreground/interval effect below. Tokens stay server-side.
  useEffect(() => {
    if (!db || !db.profile || !session || ghHandled.current) return;
    if (!ghConfigured()) { ghHandled.current = true; return; }
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code'), state = params.get('state');
    const savedState = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('gh_state') : null;
    const isCallback = code && state && savedState && state === savedState && String(state).startsWith('ghealth_');
    ghHandled.current = true;
    if (isCallback) {
      const verifier = sessionStorage.getItem('gh_pkce');
      sessionStorage.removeItem('gh_state'); sessionStorage.removeItem('gh_pkce');
      try { const u = new URL(window.location.href); ['code', 'state', 'scope', 'authuser', 'prompt', 'hd'].forEach(k => u.searchParams.delete(k)); window.history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (_) {}
      (async () => {
        try {
          const r = await ghPost('exchange', { code, code_verifier: verifier, redirect_uri: ghRedirectUri() });
          update(d => { d.googleHealth = { connected: true, lastSync: r.last_sync || new Date().toISOString() }; mergeStepsInto(d, r.steps); mergeSleepInto(d, r.sleep); mergeHealthInto(d, r.health); });
          showToast('Google Health connected. Your steps and sleep sync automatically now.');
        } catch (e) { showToast('Could not connect Google Health: ' + e.message); }
      })();
      return;
    }
    const gh = db.googleHealth;
    if (gh && gh.connected) {
      const last = gh.lastSync ? Date.parse(gh.lastSync) : 0;
      if (Date.now() - last >= GH_SYNC_GAP_MS) (async () => {
        try {
          const r = await ghPost('sync', {});
          update(d => { d.googleHealth = Object.assign({}, d.googleHealth, { connected: true, lastSync: r.last_sync || new Date().toISOString() }); mergeStepsInto(d, r.steps); mergeSleepInto(d, r.sleep); mergeHealthInto(d, r.health); });
        } catch (e) {
          if (e.gh && e.gh.type === 'reauth_required') update(d => { if (d.googleHealth) d.googleHealth.connected = false; });
        }
      })();
    } else {
      // Self-heal: the server may still hold a live connection even if this device's copy lost the
      // flag (a concurrent save from another session/tab can overwrite it on merge, since state carries
      // the newest _rev wholesale). Ask the server for the truth and reconnect the UI if so.
      (async () => {
        try {
          const st = await ghPost('status', {});
          if (st && st.connected) {
            const r = await ghPost('sync', {}).catch(() => null);
            update(d => {
              d.googleHealth = { connected: true, lastSync: (r && r.last_sync) || st.last_sync || new Date().toISOString() };
              if (r) { mergeStepsInto(d, r.steps); mergeSleepInto(d, r.sleep); mergeHealthInto(d, r.health); }
            });
          }
        } catch (_) { /* offline or not signed in: leave the UI as-is */ }
      })();
    }
  }, [db, session]);

  // Keep Google Health fresh through the day: re-sync when the app returns to the foreground and on a
  // slow interval, throttled to GH_SYNC_GAP_MS so we never poll harder than roughly four times an hour.
  useEffect(() => {
    if (!session || !ghConfigured()) return;
    let syncing = false;
    async function ghRefresh() {
      const gh = dbRef.current && dbRef.current.googleHealth;
      if (!gh || !gh.connected || syncing) return;
      const last = gh.lastSync ? Date.parse(gh.lastSync) : 0;
      if (Date.now() - last < GH_SYNC_GAP_MS) return; // throttle
      syncing = true;
      try {
        const r = await ghPost('sync', {});
        update(d => { d.googleHealth = Object.assign({}, d.googleHealth, { connected: true, lastSync: r.last_sync || new Date().toISOString() }); mergeStepsInto(d, r.steps); mergeSleepInto(d, r.sleep); mergeHealthInto(d, r.health); });
      } catch (e) {
        if (e.gh && e.gh.type === 'reauth_required') update(d => { if (d.googleHealth) d.googleHealth.connected = false; });
      } finally { syncing = false; }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') ghRefresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', ghRefresh);
    const iv = setInterval(ghRefresh, GH_SYNC_GAP_MS);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', ghRefresh); clearInterval(iv); };
  }, [session]);

  function update(m) { setDb(prev => { const n = JSON.parse(JSON.stringify(prev)); m(n); n._rev = Date.now(); if (session) { localSave(session.user.id, n); cloudSave(session.user.id, n); } return n; }); }
  function saveProfile(profile, isNew) {
    setDb(prev => {
      const n = JSON.parse(JSON.stringify(prev || Store.defaultState())); n.profile = profile;
      n.goals = { goal_type: profile.goalType, rate_per_week_kg: profile.rateKgPerWeek };
      const t = E.computeInitialTargets(withActivity(profile)); t.id = Store.uid(); t.effective_date = Store.todayISO(); n.targets.push(t);
      if (isNew && !n.weight_entries.length) { const seed = { id: Store.uid(), date: Store.todayISO(), scale_weight: +profile.weightKg.toFixed(2), trend_weight: +profile.weightKg.toFixed(2) }; if (profile.bodyFatPct != null) seed.bodyfat = +profile.bodyFatPct; n.weight_entries.push(seed); }
      n.last_checkin = Store.todayISO();
      if (n.profile.checkinDay == null) n.profile.checkinDay = new Date(Store.todayISO() + 'T00:00:00').getDay();
      if (isNew) { n.onboarding = Object.assign({ welcomed: false, sawDex: false, dismissed: false }, n.onboarding); n.onboarding.welcomed = true; }
      if (session) cloudSave(session.user.id, n); return n;
    });
    setFresh(false);
    if (isNew) setShowWelcome(true);
  }
  function addEntry(date, mealId, item) {
    const entryId = Store.uid();
    if (date === Store.todayISO()) LAST_MEAL = { id: mealId, t: Date.now() };
    const macros = normalizeMacros(item.macros, item.is_alcohol);
    celebrateCatch(date, [{ date, computed_macros: macros, is_alcohol: !!item.is_alcohol }]);
    update(d => {
      d.log_entries.push({ id: entryId, date, meal_id: mealId, ref_type: item.is_alcohol ? 'alcohol' : 'food', name: item.name, source: item.source, is_alcohol: !!item.is_alcohol, alcohol_split: item.alcohol_split, qty_label: item.qtyLabel || '', amount: item.amount, unit: item.unit, unit_noun: item.unitNoun, computed_macros: macros, sort_order: d.log_entries.length });
      const key = item.name.trim().toLowerCase(); let food = d.foods.find(x => x.name.trim().toLowerCase() === key && !!x.is_alcohol === !!item.is_alcohol);
      if (food) { food.macros = macros; food.last_qty = item.qtyLabel || food.last_qty; food.updated_at = Date.now(); }
      else { food = { id: Store.uid(), name: item.name, source: item.source, is_alcohol: !!item.is_alcohol, is_favorite: false, last_qty: item.qtyLabel || '', macros: macros, alcohol_split: item.alcohol_split, updated_at: Date.now() }; d.foods.push(food); }
      // Smart foods: if the user corrected the numbers, remember the per-unit values so the next scan or
      // database pick of this food starts from THEIR figures. Barcode kept as the strongest match key.
      if (food && item.edited && item.baseMacros) {
        food.corrected = true;
        food.saved_base = item.baseMacros;
        food.saved_kind = item.baseKind || 'per100';
        food.saved_serving_g = +item.savedServingG || 0;
        food.saved_serving_label = item.savedServingLabel || '';
        if (item.barcode) food.barcode = item.barcode;
      }
      // Remember each AI-estimated component as a reusable, gram-scalable food, so it can be searched
      // and re-logged at any weight later. Keyed by normalised name, so a single "225 g chicken"
      // estimate enriches its own meal food rather than creating a duplicate.
      if (item.rememberItems && item.rememberItems.length) {
        item.rememberItems.forEach(ri => {
          const g = +ri.grams || 0; if (g <= 0) return;
          const rk = (ri.name || '').trim().toLowerCase(); if (!rk) return;
          const per100 = { kcal: Math.round((+ri.kcal || 0) / g * 100), protein: +((+ri.protein || 0) / g * 100).toFixed(1), carbs: +((+ri.carbs || 0) / g * 100).toFixed(1), fat: +((+ri.fat || 0) / g * 100).toFixed(1), fiber: +((+ri.fiber || 0) / g * 100).toFixed(1) };
          let rf = d.foods.find(x => x.name.trim().toLowerCase() === rk && !x.is_alcohol);
          if (!rf) { rf = { id: Store.uid(), name: ri.name, source: 'ai_estimate', is_alcohol: false, is_favorite: false, last_qty: g + ' g', macros: { kcal: +ri.kcal || 0, protein: +ri.protein || 0, carbs: +ri.carbs || 0, fat: +ri.fat || 0, fiber: +ri.fiber || 0 }, updated_at: Date.now() }; d.foods.push(rf); }
          rf.corrected = true; rf.saved_base = per100; rf.saved_kind = 'per100'; rf.saved_serving_g = g; rf.saved_serving_label = ''; rf.updated_at = Date.now();
        });
      }
    });
    // Community food DB: if this was a barcoded food whose numbers the user corrected, contribute the
    // correction to the shared consensus (fire-and-forget, aggregate-only, guarded server-side).
    if (item.edited && item.baseMacros && item.barcode && supa && session) {
      const b = item.baseMacros;
      supa.rpc('submit_food_correction', { p_barcode: item.barcode, p_kcal: +b.kcal || 0, p_protein: +b.protein || 0, p_carbs: +b.carbs || 0, p_fat: +b.fat || 0, p_fiber: +b.fiber || 0, p_basis: item.baseKind || 'per100', p_serving_g: +item.savedServingG || 0, p_serving_label: item.savedServingLabel || '', p_name: item.name || '', p_source: item.source || '' }).then(function () {}, function () {});
    }
    setAdding(null);
    window.MTRACK && MTRACK('food_logged', { count: 1, source: item.source || 'manual' });
    showToast('Added ' + item.name, 'Undo', () => update(d => { tombstone(d, [entryId]); d.log_entries = d.log_entries.filter(x => x.id !== entryId); }), 'Adjust', () => setAdjusting(entryId));
  }
  function addMeal(date, mealId, items) {
    const ids = items.map(() => Store.uid());
    if (date === Store.todayISO()) LAST_MEAL = { id: mealId, t: Date.now() };
    celebrateCatch(date, items.map(item => ({ date, computed_macros: normalizeMacros(item.macros, item.is_alcohol), is_alcohol: !!item.is_alcohol })));
    update(d => {
      items.forEach((item, i) => d.log_entries.push({ id: ids[i], date, meal_id: mealId, ref_type: item.is_alcohol ? 'alcohol' : 'food', name: item.name, source: item.source, is_alcohol: !!item.is_alcohol, alcohol_split: item.alcohol_split, qty_label: item.qtyLabel || '', computed_macros: normalizeMacros(item.macros, item.is_alcohol), sort_order: d.log_entries.length + i }));
    });
    setAdding(null);
    window.MTRACK && MTRACK('food_logged', { count: items.length, source: 'meal' });
    showToast('Logged ' + items.length + ' item' + (items.length === 1 ? '' : 's'), 'Undo', () => update(d => { tombstone(d, ids); const s = new Set(ids); d.log_entries = d.log_entries.filter(x => !s.has(x.id)); }));
  }
  // Macros for `grams` of one of the user's own saved smart foods (per-100g or per-serving base).
  function macrosFromSavedFood(f, grams) {
    if (!f || !f.saved_base || !(grams > 0)) return null;
    const b = f.saved_base; let per100;
    if (f.saved_kind === 'serving') { const sg = +f.saved_serving_g || 0; if (!sg) return null; per100 = { kcal: b.kcal / sg * 100, protein: b.protein / sg * 100, carbs: b.carbs / sg * 100, fat: b.fat / sg * 100, fiber: (b.fiber || 0) / sg * 100 }; }
    else per100 = b;
    const s = grams / 100;
    return { kcal: Math.round(per100.kcal * s), protein: +(per100.protein * s).toFixed(1), carbs: +(per100.carbs * s).toFixed(1), fat: +(per100.fat * s).toFixed(1), fiber: +((per100.fiber || 0) * s).toFixed(1) };
  }
  // Log one serving of a recipe. mode 'items' writes one diary entry PER ingredient (and makes each a
  // reusable, gram-scalable smart food, enriching the food database); mode 'single' writes one entry
  // named after the recipe with the ingredients remembered behind it. Each ingredient prefers the
  // user's OWN saved numbers for that food when they exist, so recipes fold into the rest of the tracker.
  function logRecipeServing(date, mealId, recipe, mode, portion) {
    const p = portion > 0 ? portion : 1;
    const pLabel = (p === 1 ? '1 serving' : (Number.isInteger(p) ? p : p) + ' servings');
    const raw = Rcp.perServingIngredients(recipe);
    const items = raw.map(it => { const sc = it.grams > 0 ? savedCorrection(db, it.name) : null; const m = sc ? macrosFromSavedFood(sc, it.grams) : null; const base = m || it.macros; return Object.assign({}, it, { grams: it.grams ? Math.round(it.grams * p) : it.grams, macros: Rcp.scaleMacros(base, p) }); });
    if (mode === 'single' || !items.length) {
      addEntry(date, mealId, { name: recipe.title + ' (' + pLabel + ')', source: 'recipe', is_alcohol: false, qtyLabel: pLabel, macros: Rcp.scaleMacros(recipe.macros_per_serving, p), rememberItems: items.map(it => ({ name: it.name, grams: it.grams, kcal: it.macros.kcal, protein: it.macros.protein, carbs: it.macros.carbs, fat: it.macros.fat, fiber: it.macros.fiber })) });
      update(d => { d.cook_stats = d.cook_stats || {}; d.cook_stats.cooked = (d.cook_stats.cooked || 0) + 1; d.cook_stats.last = date; });
      return;
    }
    const ids = items.map(() => Store.uid());
    if (date === Store.todayISO()) LAST_MEAL = { id: mealId, t: Date.now() };
    celebrateCatch(date, items.map(it => ({ date, computed_macros: normalizeMacros(it.macros, false), is_alcohol: false })));
    update(d => {
      items.forEach((it, i) => {
        const macros = normalizeMacros(it.macros, false);
        d.log_entries.push({ id: ids[i], date, meal_id: mealId, ref_type: 'food', name: it.name, source: 'recipe', is_alcohol: false, qty_label: it.grams > 0 ? it.grams + ' g' : '', computed_macros: macros, sort_order: d.log_entries.length + i });
        const rk = it.name.trim().toLowerCase(); const g = it.grams;
        let rf = d.foods.find(x => x.name.trim().toLowerCase() === rk && !x.is_alcohol);
        if (!rf) { rf = { id: Store.uid(), name: it.name, source: 'recipe', is_alcohol: false, is_favorite: false, last_qty: g > 0 ? g + ' g' : '', macros: macros, updated_at: Date.now() }; d.foods.push(rf); }
        else { rf.macros = macros; rf.last_qty = g > 0 ? g + ' g' : rf.last_qty; rf.updated_at = Date.now(); }
        if (g > 0) { rf.corrected = true; rf.saved_base = { kcal: Math.round(macros.kcal / g * 100), protein: +(macros.protein / g * 100).toFixed(1), carbs: +(macros.carbs / g * 100).toFixed(1), fat: +(macros.fat / g * 100).toFixed(1), fiber: +((macros.fiber || 0) / g * 100).toFixed(1) }; rf.saved_kind = 'per100'; rf.saved_serving_g = g; rf.saved_serving_label = ''; }
      });
      d.cook_stats = d.cook_stats || {}; d.cook_stats.cooked = (d.cook_stats.cooked || 0) + 1; d.cook_stats.last = date;
    });
    window.MTRACK && MTRACK('food_logged', { count: items.length, source: 'recipe' });
    showToast('Logged ' + items.length + ' ingredient' + (items.length === 1 ? '' : 's') + ' from ' + recipe.title, 'Undo', () => update(d => { tombstone(d, ids); const s = new Set(ids); d.log_entries = d.log_entries.filter(x => !s.has(x.id)); }));
  }
  // Save a recipe as a one-tap meal (appears in normal food search / quick-log), built from its
  // per-serving ingredients so re-logging it itemises exactly like cooking it does.
  function saveRecipeAsMeal(recipe) {
    const perServ = Rcp.perServingIngredients(recipe);
    const items = perServ.length ? perServ.map(it => ({ name: it.name, macros: it.macros, qtyLabel: it.grams > 0 ? it.grams + ' g' : '1 serving' })) : [{ name: recipe.title, macros: recipe.macros_per_serving, qtyLabel: '1 serving' }];
    update(d => { d.saved_meals = (d.saved_meals || []).concat([{ id: Store.uid(), name: recipe.title, items: items, created_at: Date.now() }]); });
    showToast('Saved ' + recipe.title + ' as a meal you can quick-log');
  }
  async function signOut() { if (supa) await supa.auth.signOut(); setDb(null); setView('dashboard'); }
  function resetAll() { const prevKey = (db && db.profile && db.profile.aiKey) || ''; const f2 = Store.defaultState(); f2.aiKey = prevKey; const t = Date.now(); f2._wipe = t; f2._rev = t; setDb(f2); if (session) { localSave(session.user.id, f2); cloudSave(session.user.id, f2); } setView('dashboard'); }
  async function deleteAccount() {
    if (!supa) throw new Error('Account deletion needs an internet connection.');
    // Server-side function verifies the caller's own JWT, then deletes their data + auth record.
    const r = await supa.functions.invoke('delete-account');
    if (r.error) throw new Error((r.error && r.error.message) || 'Could not delete your account. Please try again.');
    await supa.auth.signOut();
    setDb(null); setSession(null); setView('dashboard');
  }

  if (session === undefined) return <Loading text="Waking the Macrosaurus…" />;
  if (recovering) return <ResetPassword onDone={() => setRecovering(false)} />;
  if (!session) return <Auth />;
  if (!db) return <Loading text="Digging up your data…" />;
  if (fresh) return <Wizard initial={db.profile} onDone={(pr) => saveProfile(pr, false)} onCancel={() => setFresh(false)} />;
  if (!db.profile) return <Wizard onDone={(pr) => saveProfile(pr, true)} initialKey={db.aiKey || ''} />;
  const meals = mealsForDay(db, Store.todayISO());
  // App-level streak so the Play hub (Macrodex) can open from the header/sidebar, not just the dashboard.
  const _today = Store.todayISO();
  const appStreak = computeStreak(new Set([...db.log_entries.map(e => e.date), ...db.weight_entries.map(w => w.date)]), new Set((db.freezes && db.freezes.frozen) || []), _today).streak;
  const appBuddy = Game.buddyView((db.buddy && db.buddy.stage) || 0, appStreak);
  return (
    <div className="lg:pl-56">
      <Sidebar view={view} setView={setView} onAdd={() => setAdding({ date: Store.todayISO(), mealId: meals[0].id })} onOpenPlay={() => setDexOpen(true)} />
      <MobileHeader onOpenPlay={() => setDexOpen(true)} onOpenYou={() => setView('more')} streak={appStreak} db={db} />
      {updateReady && <div className="fixed top-0 inset-x-0 z-[100] flex justify-center px-3" style={{ paddingTop: 'calc(0.6rem + env(safe-area-inset-top))' }}>
        <div className="pixel-box w-full max-w-md flex items-center gap-3 p-3 fade-in" style={{ background: 'var(--surface3)', borderColor: 'var(--accent)' }}>
          <PixelDino size={20} color="var(--accent)" />
          <div className="min-w-0 flex-1 text-[12px]">A new version is ready.</div>
          <button onClick={() => window.location.reload()} className="pixel-btn px-3 py-2 text-[11px] shrink-0" style={{ background: 'var(--accent)', color: '#111' }}>Reload</button>
        </div>
      </div>}
      {view === 'dashboard' && <Dashboard db={db} update={update} onCheckIn={() => setCheckingIn(true)} onReview={() => setCheckingIn('review')} setView={setView} onQuickAdd={(alc) => setAdding({ date: Store.todayISO(), mealId: meals[0].id, alc: !!alc })} showToast={showToast} onOpenRecipe={(id) => { setOpenRecipeId(id); setView('recipes'); }} onOpenPlay={() => setDexOpen(true)} isPremium={isPremium} aiCalls={aiCalls} />}
      {view === 'foodlog' && <FoodLog db={db} update={update} openLog={setAdding} showToast={showToast} />}
      {view === 'recipes' && <Recipes db={db} update={update} showToast={showToast} importUrl={recipeImport} onConsumeImport={() => setRecipeImport(null)} openRecipeId={openRecipeId} onConsumeOpen={() => setOpenRecipeId(null)} onLogRecipe={(mealId, recipe, mode, portion) => logRecipeServing(Store.todayISO(), mealId, recipe, mode, portion)} onLogOn={(date, recipe, portion) => logRecipeServing(date, mealsForDay(db, date)[0].id, recipe, 'single', portion)} onSaveMeal={saveRecipeAsMeal} isPremium={isPremium} />}
      {view === 'goals' && <Goals db={db} update={update} showToast={showToast} onCheckIn={() => setCheckingIn(true)} />}
      {view === 'more' && <More db={db} update={update} onSignOut={signOut} onReset={resetAll} onDeleteAccount={deleteAccount} onFreshStart={() => setFresh(true)} email={session.user.email} isAdmin={isAdmin} onOpenAdmin={() => setView('admin')} sub={sub} isPremium={isPremium} aiCalls={aiCalls} onUpgrade={() => { setPaywall({ reason: 'manual' }); window.MTRACK && MTRACK('paywall_view', { reason: 'menu' }); }} onManage={openPortal} rewards={rewards} showToast={showToast} />}
      {view === 'admin' && isAdmin && <AdminPanel onBack={() => setView('more')} adminEmail={session.user.email} update={update} />}
      <BottomNav view={view} setView={setView} onAdd={() => setAdding({ date: Store.todayISO(), mealId: meals[0].id })} />
      {adding && <LogSheet db={db} update={update} meals={mealsForDay(db, adding.date)} target={adding} onAdd={(mealId, item) => addEntry(adding.date, mealId, item)} onAddMeal={(mealId, items) => addMeal(adding.date, mealId, items)} onClose={() => setAdding(null)} isPremium={isPremium} aiCalls={aiCalls} />}
      {checkingIn && <CheckInModal db={db} update={update} onClose={() => setCheckingIn(false)} resume={checkingIn === 'review' ? db.pending_adjustment : null} />}
      {adjusting && (() => { const en = db.log_entries.find(x => x.id === adjusting); return en ? <EditEntryModal entry={en} title="Adjust entry" onSave={(patch) => { applyEntryPatch(update, adjusting, patch); setAdjusting(null); showToast('Updated ' + patch.name); }} onClose={() => setAdjusting(null)} /> : null; })()}
      {shared && shared.files && shared.files.length > 0 && <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center" onClick={() => setShared(null)}>
        <BackClose onClose={() => setShared(null)} />
        <div className="w-full lg:max-w-md rounded-t-3xl lg:rounded-3xl p-5 pb-8 max-h-[92vh] overflow-y-auto" style={{ background: 'var(--bg)' }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1"><div className="text-lg font-bold">Log shared photo{shared.files.length === 1 ? '' : 's'}</div><button onClick={() => setShared(null)} className="text-[#8A8A90] text-xl leading-none">×</button></div>
          <div className="text-[12px] text-[#8A8A90] mb-3">The AI reads {shared.files.length === 1 ? 'it' : 'them'} and proposes a meal, you confirm before it's logged.</div>
          <MealEstimate apiKey={db.profile.aiKey} initialFiles={shared.files} onBack={() => setShared(null)} onPick={(item) => { const meals = mealsForDay(db, Store.todayISO()); if (meals[0]) addEntry(Store.todayISO(), meals[0].id, item); setShared(null); }} />
        </div>
      </div>}
      {paywall && <Paywall reason={paywall.reason} onCheckout={startCheckout} onClose={() => setPaywall(null)} />}
      {dexOpen && <MacrodexModal db={db} update={update} streak={appStreak} onOpenFight={() => setFightOpen(true)} onOpenName={() => setNameOpen(true)} onClose={() => setDexOpen(false)} />}
      {fightOpen && <FightModal db={db} update={update} streak={appStreak} onClose={() => setFightOpen(false)} />}
      {nameOpen && <NameBuddyModal db={db} update={update} buddy={appBuddy} onClose={() => setNameOpen(false)} />}
      <Toast toast={toast} />
      {reveal && <CatchReveal c={reveal} />}
      {showWelcome && <WelcomeCarousel theme={(db.profile && db.profile.theme) || 'light'} onDone={() => setShowWelcome(false)} />}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
