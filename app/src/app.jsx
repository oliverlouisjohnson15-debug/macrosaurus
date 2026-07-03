const { useState, useEffect, useMemo } = React;
const E = window.Engine;
const Store = window.Store;
const LB_PER_KG = 2.2046226218;
const BRAND = 'Macrosaurus';
// palette
const CAL = '#4A9EEB', PRO = '#FF5A4D', FAT = '#F5C542', CARB = '#34D399';
const MUTED = '#8A8A90', BORDER = '#262629', CARDBG = '#161618';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

/* ---------- unit helpers ---------- */
function kgToStLb(kg) { const t = kg * LB_PER_KG; const st = Math.floor(t / 14); return { st, lb: +(t - st * 14).toFixed(1) }; }
function stLbToKg(st, lb) { return ((+st || 0) * 14 + (+lb || 0)) / LB_PER_KG; }
function cmToFtIn(cm) { const t = cm / 2.54; const ft = Math.floor(t / 12); return { ft, inch: Math.round(t - ft * 12) }; }
function ftInToCm(ft, inch) { return ((+ft || 0) * 12 + (+inch || 0)) * 2.54; }
function fmtWeight(kg, unit) { if (kg == null || isNaN(kg)) return '–'; if (unit === 'st_lb') { const { st, lb } = kgToStLb(kg); return `${st} st ${lb.toFixed(1)} lb`; } return kg.toFixed(1) + ' kg'; }
function fmtHeight(cm, unit) { if (unit === 'ft_in') { const { ft, inch } = cmToFtIn(cm); return `${ft}'${inch}"`; } return Math.round(cm) + ' cm'; }
function weekdayIdx(d) { return new Date(d + 'T00:00:00').getDay(); }
function shiftISO(d, n) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
function prettyDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase(); }

/* ---------- image / AI helpers ---------- */
function fileToDataURL(file) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); }
async function geminiVision(key, file, prompt) {
  const dataUrl = await fileToDataURL(file);
  const b64 = dataUrl.split(',')[1]; const mime = dataUrl.substring(5, dataUrl.indexOf(';'));
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'API error');
  const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || '';
  const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('no data returned');
  return JSON.parse(m[0]);
}
const LABEL_PROMPT = 'Read this nutrition label. Return ONLY compact JSON with values PER 100 g (use the per-100g column): {"name": string, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number}. If a value is missing use 0.';
const AI_PROMPT = 'You are a nutrition estimator. Estimate macros for the whole food portion in this photo. Respond ONLY with compact JSON: {"name": string, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number}. Assume typical UK preparation.';

/* ---------- data helpers ---------- */
function currentTargets(db) { return db.targets.length ? db.targets[db.targets.length - 1] : null; }
function sumMacros(entries) {
  return entries.reduce((a, e) => ({ kcal: a.kcal + (e.computed_macros.kcal || 0), protein: a.protein + (e.computed_macros.protein || 0), carbs: a.carbs + (e.computed_macros.carbs || 0), fat: a.fat + (e.computed_macros.fat || 0), fiber: a.fiber + (e.computed_macros.fiber || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}
function entriesOn(db, date) { return db.log_entries.filter(e => e.date === date); }
function effectiveTarget(db, date) {
  const base = currentTargets(db); if (!base) return null;
  const p = db.profile;
  const cyc = (p.cycling && p.cycling.enabled) ? E.cyclingDelta(p.cycling, weekdayIdx(date), base.kcal) : 0;
  let carry = 0;
  if (p.carryover && p.carryover.enabled) {
    const prev = shiftISO(date, -1); const pe = entriesOn(db, prev);
    if (pe.length) { const pbk = base.kcal + ((p.cycling && p.cycling.enabled) ? E.cyclingDelta(p.cycling, weekdayIdx(prev), base.kcal) : 0); carry = E.carryover(pbk, sumMacros(pe).kcal, p.carryover.capKcal || 500); }
  }
  let eff = E.applyKcalDelta(base, cyc + carry);
  const ov = (db.day_overrides || {})[date];
  if (ov && ov.shiftKcal) { const s = ov.shiftKcal; eff = Object.assign({}, eff, { carbs_g: Math.max(0, Math.round(eff.carbs_g - s / 4)), fat_g: Math.max(0, Math.round(eff.fat_g + s / 9)) }); }
  return { base, cyc, carry, eff };
}

/* ---------- primitives ---------- */
const inputCls = "w-full bg-[#1E1E22] border border-[#262629] rounded-2xl px-4 py-3.5 text-white focus:outline-none focus:border-[#4A9EEB] transition";
function NumInput(props) { return <input type="number" inputMode="decimal" className={inputCls} {...props} />; }
function TextInput(props) { return <input type="text" className={inputCls} {...props} />; }
function Field({ label, children, hint }) { return (<label className="block mb-3.5"><div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-1.5 font-semibold">{label}</div>{children}{hint && <div className="text-[11px] text-[#8A8A90] mt-1.5 leading-snug">{hint}</div>}</label>); }
function Btn({ children, onClick, kind = 'primary', className = '', ...rest }) {
  const s = { primary: 'bg-white text-black hover:bg-white/90 font-semibold', accent: 'bg-[#4A9EEB] text-white hover:brightness-110 font-semibold', ghost: 'bg-[#1E1E22] text-white border border-[#262629] hover:bg-[#262629]', danger: 'bg-[#2a1416] text-[#ff6b6b] border border-[#3a1c1f] hover:bg-[#3a1c1f]' };
  return <button onClick={onClick} className={`rounded-2xl px-4 py-3.5 transition active:scale-[.98] ${s[kind]} ${className}`} {...rest}>{children}</button>;
}
function Card({ children, className = '' }) { return <div className={`bg-[#161618] border border-[#262629] rounded-3xl ${className}`}>{children}</div>; }
function Section({ title, children, className = '' }) { return (<div className={'mb-6 ' + className}><div className="text-lg font-bold mb-3">{title}</div>{children}</div>); }
function Seg({ value, options, onChange }) { return (<div className="flex gap-2 flex-wrap">{options.map(o => (<button key={o.v} onClick={() => onChange(o.v)} className={`flex-1 min-w-[28%] rounded-2xl py-3 px-2 text-[13px] transition ${value === o.v ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#C9C9CF] border border-[#262629]'}`}>{o.l}</button>))}</div>); }
function Pill({ value, options, onChange }) { return (<div className="inline-flex bg-[#1E1E22] rounded-full p-1">{options.map(o => (<button key={o.v} onClick={() => onChange(o.v)} className={`px-5 py-2 rounded-full text-sm transition ${value === o.v ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{o.l}</button>))}</div>); }
function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false); const cur = options.find(o => o.v === value);
  return (<div className="relative"><button onClick={() => setOpen(o => !o)} className={inputCls + ' flex justify-between items-center text-left'}><span className="truncate">{cur ? cur.l : 'Select'}</span><span className="text-[#8A8A90] ml-2">▾</span></button>
    {open && <div className="absolute z-40 mt-1 w-full bg-[#1E1E22] border border-[#262629] rounded-2xl py-1 max-h-56 overflow-y-auto shadow-2xl">{options.map(o => <button key={o.v} onClick={() => { onChange(o.v); setOpen(false); }} className={`block w-full text-left px-4 py-2.5 text-sm hover:bg-[#262629] ${o.v === value ? 'text-[#4A9EEB]' : 'text-white'}`}>{o.l}</button>)}</div>}</div>);
}
function RowToggle({ label, on, onClick }) { return (<button onClick={onClick} className="w-full flex items-center justify-between bg-[#1E1E22] border border-[#262629] rounded-2xl px-4 py-3.5 mb-3"><span className="text-sm">{label}</span><span className={`w-11 h-6 rounded-full transition relative ${on ? 'bg-[#4A9EEB]' : 'bg-[#262629]'}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></span></button>); }
function Logo({ size = 'text-xl' }) { return (<div className={`${size} font-extrabold tracking-tight flex items-center gap-1.5 text-white`}><span>🦖</span><span>Macro<span className="text-[#4A9EEB]">saurus</span></span></div>); }
function rateLabel(r) { const a = Math.abs(r || 0); if (a <= 0.35) return { t: 'Sustainable, easy to hold', c: CARB }; if (a <= 0.7) return { t: 'Moderate, some hunger', c: FAT }; return { t: 'Aggressive, high hunger', c: PRO }; }

/* ---------- icons ---------- */
const Icon = {
  dash: (a) => <svg {...a} viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></svg>,
  food: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21c4.5 0 7-3.6 7-8.5C19 8 16 4 12 4S5 8 5 12.5C5 17.4 7.5 21 12 21z" /><path d="M12 4c0-1 .5-2 1.5-2.5" /></svg>,
  strategy: (a) => <svg {...a} viewBox="0 0 24 24" fill="currentColor"><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="7" r="2.4" /><circle cx="7" cy="17" r="2.4" /><circle cx="17" cy="17" r="2.4" /></svg>,
  more: (a) => <svg {...a} viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>,
  plus: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M12 5v14M5 12h14" /></svg>,
  cam: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.2" /></svg>,
  barcode: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6v12M7 6v12M11 6v12M15 6v12M19 6v12" /></svg>,
  star: (a) => <svg {...a} viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.4 9.3l6-.7z" /></svg>,
  chevron: (a) => <svg {...a} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>,
};

/* ---------- charts ---------- */
function ArcGauge({ consumed, target }) {
  const R = 82, C = 2 * Math.PI * R, arc = 0.72;
  const pct = target > 0 ? Math.min(consumed / target, 1) : 0;
  const over = consumed > target;
  return (
    <div className="relative flex items-center justify-center" style={{ width: 210, height: 165 }}>
      <svg width="210" height="200" viewBox="0 0 210 200" className="absolute top-0">
        <g transform="rotate(140 105 100)">
          <circle cx="105" cy="100" r={R} fill="none" strokeWidth="12" className="ring-track" strokeLinecap="round" strokeDasharray={`${arc * C} ${C}`} />
          <circle cx="105" cy="100" r={R} fill="none" strokeWidth="12" stroke={over ? PRO : CAL} strokeLinecap="round" strokeDasharray={`${pct * arc * C} ${C}`} style={{ transition: 'stroke-dasharray .5s cubic-bezier(.2,.8,.2,1)' }} />
        </g>
      </svg>
      <div className="text-center mt-1">
        <div className="text-5xl font-bold tnum">{Math.round(consumed)}</div>
        <div className="text-xs text-[#8A8A90] mt-0.5">Consumed</div>
      </div>
    </div>
  );
}
function MacroBar({ label, eaten, target, color, mode }) {
  const pct = target > 0 ? Math.min(eaten / target, 1) : 0;
  const shown = mode === 'remaining' ? Math.max(0, Math.round(target - eaten)) : Math.round(eaten);
  return (
    <div className="text-center">
      <div className="text-sm text-[#8A8A90] mb-1.5">{label}</div>
      <div className="h-1.5 rounded-full mx-auto mb-2" style={{ background: '#262629' }}>
        <div className="h-full rounded-full" style={{ width: (pct * 100) + '%', background: color, transition: 'width .5s' }} />
      </div>
      <div className="text-sm tnum"><span className="font-semibold">{shown}</span><span className="text-[#8A8A90]"> {mode === 'remaining' ? 'left' : '/ ' + Math.round(target) + 'g'}</span></div>
    </div>
  );
}
function MiniSpark({ points, color }) {
  if (!points || points.length < 2) return <div className="h-10" />;
  const W = 120, H = 40, min = Math.min(...points), max = Math.max(...points), span = (max - min) || 1;
  const d = points.map((v, i) => `${(i / (points.length - 1)) * W},${H - ((v - min) / span) * H}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10"><polyline points={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
function HabitGrid({ days, color }) {
  return (<div className="grid grid-cols-10 gap-1">{days.map((on, i) => <div key={i} className="aspect-square rounded-[3px]" style={{ background: on ? color : '#262629' }} />)}</div>);
}

/* =====================================================================
   AUTH (polished email login)
   ===================================================================== */
function Auth() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function submit() {
    if (!supa) { setMsg('Accounts need an internet connection. Open the deployed site.'); return; }
    if (!email || !pw) { setMsg('Enter your email and a password.'); return; }
    setBusy(true); setMsg('');
    try {
      if (mode === 'signup') { const r = await supa.auth.signUp({ email, password: pw }); if (r.error) throw r.error; if (!r.data.session) setMsg('Account created. If prompted, confirm via the email we sent, then log in.'); }
      else { const r = await supa.auth.signInWithPassword({ email, password: pw }); if (r.error) throw r.error; }
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto px-7">
      <div className="flex-1 flex flex-col justify-center fade-in">
        <div className="text-6xl mb-4">🦖</div>
        <h1 className="text-4xl font-extrabold tracking-tight leading-tight">Macrosaurus<span className="text-[#4A9EEB]">.</span></h1>
        <p className="text-[#8A8A90] mt-2 mb-8">Adaptive body composition. Track food, hit your macros, and let your plan retune itself.</p>
        <Field label="Email"><input type="email" autoComplete="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" /></Field>
        <Field label="Password"><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className={inputCls} value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="at least 6 characters" /></Field>
        <Btn className="w-full text-base mt-1" onClick={submit}>{busy ? 'Please wait…' : (mode === 'signup' ? 'Create account' : 'Log in')}</Btn>
        {msg && <div className="text-[13px] text-[#F5C542] mt-3 text-center">{msg}</div>}
        <button onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMsg(''); }} className="text-sm text-[#8A8A90] mt-6 text-center">
          {mode === 'signup' ? <>Already have an account? <span className="text-[#4A9EEB] font-medium">Log in</span></> : <>New here? <span className="text-[#4A9EEB] font-medium">Create an account</span></>}
        </button>
      </div>
      <div className="text-[11px] text-[#8A8A90]/60 text-center pb-6">Your data is private to your account.</div>
    </div>
  );
}

/* =====================================================================
   ONBOARDING WIZARD (account setup)
   ===================================================================== */
function Wizard({ initial, onDone, onCancel }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState(initial || {
    sex: 'male', age: 32, heightCm: 175, height_unit: 'cm', weightKg: 82, weight_unit: 'st_lb', bodyFatPct: 20,
    activityLevel: 'moderate', goalType: 'cut', rateKgPerWeek: 0.5, dietStyle: 'balanced', proteinGPerKgBW: 1.8, proteinManualG: '',
    program_mode: 'collaborative', carryover: { enabled: true, capKcal: 400 }, cycling: { enabled: false, highDays: [6], deltaPct: 0.15 }, aiKey: '',
  });
  const set = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));
  const s0 = kgToStLb(f.weightKg); const [st, setSt] = useState(s0.st); const [lb, setLb] = useState(s0.lb);
  const h0 = cmToFtIn(f.heightCm); const [ft, setFt] = useState(h0.ft); const [inch, setInch] = useState(h0.inch);
  const profile = useMemo(() => {
    const p = Object.assign({}, f);
    if (f.weight_unit === 'st_lb') p.weightKg = stLbToKg(st, lb);
    if (f.height_unit === 'ft_in') p.heightCm = ftInToCm(ft, inch);
    if (f.proteinManualG === '') delete p.proteinManualG;
    return withActivity(p);
  }, [f, st, lb, ft, inch]);
  const preview = useMemo(() => { try { return E.computeInitialTargets(profile); } catch (e) { return null; } }, [profile]);

  const steps = [
    { t: 'About you', body: (
      <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sex"><Seg value={f.sex} onChange={v => set('sex', v)} options={[{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }]} /></Field>
          <Field label="Age"><NumInput value={f.age} onChange={e => set('age', +e.target.value)} /></Field>
        </div>
        <Field label="Height">
          <div className="flex gap-2 mb-2">{[['cm', 'cm'], ['ft_in', 'ft / in']].map(([v, l]) => <button key={v} onClick={() => set('height_unit', v)} className={`flex-1 rounded-2xl py-2.5 text-sm ${f.height_unit === v ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90] border border-[#262629]'}`}>{l}</button>)}</div>
          {f.height_unit === 'cm' ? <NumInput value={f.heightCm} onChange={e => set('heightCm', +e.target.value)} /> : <div className="flex gap-2 items-center"><NumInput value={ft} onChange={e => setFt(+e.target.value)} /><span className="text-[#8A8A90]">ft</span><NumInput value={inch} onChange={e => setInch(+e.target.value)} /><span className="text-[#8A8A90]">in</span></div>}
        </Field>
      </>) },
    { t: 'Your stats', body: (
      <>
        <Field label="Weigh-in units">
          <div className="flex gap-2">{[['st_lb', 'st / lb'], ['kg', 'kg']].map(([v, l]) => <button key={v} onClick={() => set('weight_unit', v)} className={`flex-1 rounded-2xl py-2.5 text-sm ${f.weight_unit === v ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90] border border-[#262629]'}`}>{l}</button>)}</div>
        </Field>
        <Field label="Current weight">
          {f.weight_unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(+e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(+e.target.value)} /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={f.weightKg} onChange={e => set('weightKg', +e.target.value)} />}
        </Field>
        <Field label="Body fat %" hint="A rough estimate is fine. Used to track lean mass."><NumInput value={f.bodyFatPct} onChange={e => set('bodyFatPct', +e.target.value)} /></Field>
      </>) },
    { t: 'Activity level', body: (
      <div className="space-y-2.5">{ACTIVITY.map(a => (
        <button key={a.v} onClick={() => set('activityLevel', a.v)} className={`w-full text-left rounded-2xl p-4 border transition ${f.activityLevel === a.v ? 'border-[#4A9EEB] bg-[#4A9EEB]/10' : 'border-[#262629] bg-[#1E1E22]'}`}>
          <div className="font-semibold">{a.l}</div><div className="text-[12px] text-[#8A8A90]">{a.d}</div>
        </button>))}</div>) },
    { t: 'Your goal', body: (
      <>
        <Field label="Direction"><Seg value={f.goalType} onChange={v => set('goalType', v)} options={[{ v: 'cut', l: '📉 Cut' }, { v: 'maintain', l: '⚖️ Maintain' }, { v: 'gain', l: '📈 Lean gain' }]} /></Field>
        {f.goalType !== 'maintain' && <Field label={`Rate: ${f.rateKgPerWeek} kg/week`}>
          <input type="range" min="0.1" max="1.2" step="0.05" value={f.rateKgPerWeek} onChange={e => set('rateKgPerWeek', +e.target.value)} className="w-full accent-[#4A9EEB]" />
          {(() => { const rl = rateLabel(f.rateKgPerWeek); return <div className="text-[12px] mt-1.5" style={{ color: rl.c }}>Pace: {rl.t}</div>; })()}
        </Field>}
      </>) },
    { t: 'Nutrition', body: (
      <>
        <Field label={`Protein: ${f.proteinManualG || Math.round(f.proteinGPerKgBW * profile.weightKg)} g (${f.proteinGPerKgBW.toFixed(1)} g/kg)`} hint="Benefits plateau around 1.6 g/kg. 1.8 is a solid default.">
          <input type="range" min="1.4" max="2.4" step="0.1" value={f.proteinGPerKgBW} onChange={e => { set('proteinGPerKgBW', +e.target.value); set('proteinManualG', ''); }} className="w-full accent-[#4A9EEB]" />
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
        <div className="text-[12px] text-[#8A8A90] mt-4">Estimated maintenance about {preview.estimatedTDEE} kcal. This retunes automatically from your weekly check-ins.</div>
      </Card>) : <div /> },
  ];
  const last = step === steps.length - 1;
  return (
    <div className="max-w-md mx-auto px-6 pt-10 pb-10 fade-in">
      <div className="flex items-center gap-2 mb-6">{steps.map((_, i) => <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? '#4A9EEB' : '#262629' }} />)}</div>
      <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-1">Step {step + 1} of {steps.length}</div>
      <h1 className="text-3xl font-extrabold mb-6">{steps[step].t}</h1>
      {steps[step].body}
      <div className="flex gap-3 mt-6">
        {step > 0 ? <Btn kind="ghost" onClick={() => setStep(step - 1)}>Back</Btn> : (onCancel ? <Btn kind="ghost" onClick={onCancel}>Cancel</Btn> : null)}
        <Btn className="flex-1" onClick={() => last ? onDone(profile) : setStep(step + 1)}>{last ? 'Save my plan' : 'Continue'}</Btn>
      </div>
    </div>
  );
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */
function Dashboard({ db }) {
  const [mode, setMode] = useState('consumed');
  const today = Store.todayISO();
  const et = effectiveTarget(db, today); if (!et) return null;
  const tot = sumMacros(entriesOn(db, today));
  const remaining = Math.round(et.eff.kcal - tot.kcal);
  const last30 = Array.from({ length: 30 }, (_, i) => shiftISO(today, -(29 - i)));
  const weighSet = new Set(db.weight_entries.map(w => w.date));
  const logSet = new Set(db.log_entries.map(e => e.date));
  const weighDays = last30.map(d => weighSet.has(d)); const logDays = last30.map(d => logSet.has(d));
  const last7 = Array.from({ length: 7 }, (_, i) => shiftISO(today, -(6 - i)));
  const weighWk = last7.filter(d => weighSet.has(d)).length; const logWk = last7.filter(d => logSet.has(d)).length;
  const t = currentTargets(db);
  const wTrend = db.weight_entries.slice(-12).map(w => w.trend_weight != null ? w.trend_weight : w.scale_weight);
  const expTrend = db.targets.slice(-12).map(x => x.estimatedTDEE).filter(Boolean);
  const unit = db.profile.weight_unit;
  return (
    <div className="max-w-md mx-auto px-5 pb-28 pt-6 fade-in">
      <div className="text-[12px] uppercase tracking-widest text-[#8A8A90]">{prettyDate(today)}</div>
      <h1 className="text-4xl font-extrabold mb-5">Dashboard</h1>

      <div className="text-lg font-bold mb-3">Daily Nutrition</div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-center w-16"><div className="text-2xl font-bold tnum">{Math.abs(remaining)}</div><div className="text-[11px] text-[#8A8A90]">{remaining < 0 ? 'Over' : 'Remaining'}</div></div>
        <ArcGauge consumed={tot.kcal} target={et.eff.kcal} />
        <div className="text-center w-16"><div className="text-2xl font-bold tnum">{et.eff.kcal}</div><div className="text-[11px] text-[#8A8A90]">Target</div></div>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <MacroBar label="Protein" eaten={tot.protein} target={et.eff.protein_g} color={PRO} mode={mode} />
        <MacroBar label="Fat" eaten={tot.fat} target={et.eff.fat_g} color={FAT} mode={mode} />
        <MacroBar label="Carbs" eaten={tot.carbs} target={et.eff.carbs_g} color={CARB} mode={mode} />
      </div>
      <div className="flex justify-center mb-8"><Pill value={mode} onChange={setMode} options={[{ v: 'consumed', l: 'Consumed' }, { v: 'remaining', l: 'Remaining' }]} /></div>

      <div className="text-lg font-bold mb-3">Habits</div>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="p-4">
          <div className="font-semibold mb-0.5">Weigh-In</div><div className="text-[11px] text-[#8A8A90] mb-3">Last 30 days</div>
          <HabitGrid days={weighDays} color={CARB} />
          <div className="mt-3 text-sm"><span className="font-semibold tnum">{weighWk}/7</span> <span className="text-[#8A8A90] text-[12px]">this week</span></div>
        </Card>
        <Card className="p-4">
          <div className="font-semibold mb-0.5">Food Logging</div><div className="text-[11px] text-[#8A8A90] mb-3">Last 30 days</div>
          <HabitGrid days={logDays} color={CAL} />
          <div className="mt-3 text-sm"><span className="font-semibold tnum">{logWk}/7</span> <span className="text-[#8A8A90] text-[12px]">this week</span></div>
        </Card>
      </div>

      <div className="text-lg font-bold mb-3">Insights</div>
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4"><div className="text-[12px] text-[#8A8A90]">Expenditure</div><MiniSpark points={expTrend} color={PRO} /><div className="text-lg font-semibold tnum mt-1">{t && t.estimatedTDEE ? t.estimatedTDEE : '–'} <span className="text-[12px] text-[#8A8A90] font-normal">kcal</span></div></Card>
        <Card className="p-4"><div className="text-[12px] text-[#8A8A90]">Weight trend</div><MiniSpark points={wTrend} color="#9B8CFF" /><div className="text-lg font-semibold tnum mt-1">{db.weight_entries.length ? fmtWeight(db.weight_entries[db.weight_entries.length - 1].trend_weight, unit) : '–'}</div></Card>
      </div>
    </div>
  );
}

/* =====================================================================
   FOOD LOG (calendar + diary)
   ===================================================================== */
function FoodLog({ db, update, openLog }) {
  const today = Store.todayISO();
  const [date, setDate] = useState(today);
  const [menu, setMenu] = useState(null);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(today + 'T00:00:00'); return { y: d.getFullYear(), m: d.getMonth() }; });
  const meals = db.meal_templates.slice().sort((a, b) => a.sort_order - b.sort_order);
  const day = entriesOn(db, date); const et = effectiveTarget(db, date); const tot = sumMacros(day);
  const del = (e) => { update(d => { d.log_entries = d.log_entries.filter(x => x.id !== e.id); }); setMenu(null); };
  const dup = (e) => { update(d => d.log_entries.push(Object.assign({}, e, { id: Store.uid() }))); setMenu(null); };
  const copyNext = (e) => { update(d => d.log_entries.push(Object.assign({}, e, { id: Store.uid(), date: shiftISO(e.date, 1) }))); setMenu(null); };

  const first = new Date(calMonth.y, calMonth.m, 1); const startDow = (first.getDay() + 6) % 7; // Mon=0
  const daysIn = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
  const cells = []; for (let i = 0; i < startDow; i++) cells.push(null);
  for (let dd = 1; dd <= daysIn; dd++) cells.push(new Date(calMonth.y, calMonth.m, dd).toISOString().slice(0, 10));
  const logSet = new Set(db.log_entries.map(e => e.date));
  const monthName = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <div className="max-w-md mx-auto px-5 pb-28 pt-6 fade-in" onClick={() => menu && setMenu(null)}>
      <h1 className="text-4xl font-extrabold mb-4">Food Log</h1>
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setCalMonth(c => { const m = c.m - 1; return m < 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m }; })} className="text-[#8A8A90] px-2 py-1">‹</button>
          <div className="text-sm font-semibold">{monthName}</div>
          <button onClick={() => setCalMonth(c => { const m = c.m + 1; return m > 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m }; })} className="text-[#8A8A90] px-2 py-1">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-[#8A8A90] mb-1">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">{cells.map((c, i) => c ? (
          <button key={i} onClick={() => setDate(c)} className={`aspect-square rounded-lg text-[12px] tnum flex flex-col items-center justify-center relative ${c === date ? 'bg-white text-black font-bold' : c === today ? 'bg-[#1E1E22] text-white' : 'text-[#C9C9CF]'} ${c > today ? 'opacity-30' : ''}`}>
            {new Date(c + 'T00:00:00').getDate()}
            {logSet.has(c) && c !== date && <span className="absolute bottom-1 w-1 h-1 rounded-full" style={{ background: CAL }} />}
          </button>) : <div key={i} />)}</div>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-[#8A8A90]">{date === today ? 'Today' : new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
        {et && <div className="text-sm tnum"><span className="font-semibold">{Math.round(tot.kcal)}</span> <span className="text-[#8A8A90]">/ {et.eff.kcal} kcal</span></div>}
      </div>

      {meals.map(m => {
        const me = day.filter(e => e.meal_id === m.id); const ms = sumMacros(me);
        return (
          <Card key={m.id} className="p-4 mb-3">
            <div className="flex justify-between items-center"><div className="font-semibold">{m.name}</div><div className="text-xs text-[#8A8A90] tnum">{Math.round(ms.kcal)} kcal{me.length ? ` · P${Math.round(ms.protein)}` : ''}</div></div>
            {me.map(e => (
              <div key={e.id} className="flex items-center justify-between py-2.5 border-t border-[#262629] mt-2 relative">
                <div className="min-w-0"><div className="text-sm truncate">{e.name}{e.qty_label ? <span className="text-[#8A8A90]"> · {e.qty_label}</span> : ''}</div><div className="text-[11px] text-[#8A8A90] tnum">{Math.round(e.computed_macros.kcal)} kcal · P{e.computed_macros.protein} C{e.computed_macros.carbs} F{e.computed_macros.fat}</div></div>
                <button onClick={(ev) => { ev.stopPropagation(); setMenu(menu === e.id ? null : e.id); }} className="px-2 text-[#8A8A90] shrink-0">⋯</button>
                {menu === e.id && (<div className="absolute right-2 top-9 z-20 bg-[#1E1E22] border border-[#262629] rounded-2xl py-1 text-sm shadow-xl" onClick={ev => ev.stopPropagation()}>
                  <button onClick={() => dup(e)} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Duplicate</button>
                  <button onClick={() => copyNext(e)} className="block w-full text-left px-4 py-2 hover:bg-[#262629]">Copy to tomorrow</button>
                  <button onClick={() => del(e)} className="block w-full text-left px-4 py-2 text-[#ff6b6b] hover:bg-[#262629]">Delete</button>
                </div>)}
              </div>))}
            <button onClick={() => openLog({ date, mealId: m.id })} className="mt-2 text-[13px] text-[#4A9EEB] font-medium">+ Add food</button>
          </Card>);
      })}
    </div>
  );
}

/* =====================================================================
   LOG SHEET
   ===================================================================== */
function LogSheet({ db, update, meals, target, onAdd, onClose }) {
  const [isAlc, setIsAlc] = useState(false);
  const [tab, setTab] = useState('recent');
  const [mealId, setMealId] = useState(target.mealId || meals[0].id);
  const tabs = isAlc ? [['recent', 'Recents'], ['manual', 'New drink']] : [['recent', 'Recents'], ['search', 'Search'], ['manual', 'Manual'], ['photo', 'Photo']];
  useEffect(() => { if (isAlc && (tab === 'search' || tab === 'photo')) setTab('recent'); }, [isAlc]);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center" onClick={onClose}>
      <div className="bg-[#0F0F12] w-full max-w-md rounded-t-3xl border-t border-[#262629] p-5 max-h-[92vh] overflow-y-auto sheet-up" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-[#262629] rounded-full mx-auto mb-4" />
        <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-semibold">Log {isAlc ? 'a drink' : 'food'}</h2><button onClick={onClose} className="text-[#8A8A90] text-2xl leading-none">×</button></div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Meal"><Dropdown value={mealId} onChange={setMealId} options={meals.map(m => ({ v: m.id, l: m.name }))} /></Field>
          <Field label="Type"><div className="flex gap-2">{[['food', '🍽️ Food'], ['alc', '🍺 Drink']].map(([k, l]) => <button key={k} onClick={() => setIsAlc(k === 'alc')} className={`flex-1 rounded-2xl py-3 text-sm ${isAlc === (k === 'alc') ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90] border border-[#262629]'}`}>{l}</button>)}</div></Field>
        </div>
        <div className="flex gap-1.5 mb-4 bg-[#1E1E22] p-1 rounded-2xl">{tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2 text-[13px] transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}</button>)}</div>
        {tab === 'recent' && <RecentTab db={db} update={update} isAlc={isAlc} onPick={i => onAdd(mealId, i)} />}
        {tab === 'search' && <SearchTab onPick={i => onAdd(mealId, i)} />}
        {tab === 'manual' && (isAlc ? <AlcoholTab onPick={i => onAdd(mealId, i)} /> : <ManualTab onPick={i => onAdd(mealId, i)} />)}
        {tab === 'photo' && <PhotoTab db={db} onPick={i => onAdd(mealId, i)} />}
      </div>
    </div>
  );
}
function RecentTab({ db, update, isAlc, onPick }) {
  const [q, setQ] = useState('');
  const foods = db.foods.filter(f => !!f.is_alcohol === isAlc).filter(f => !q || f.name.toLowerCase().includes(q.toLowerCase()));
  const favs = foods.filter(f => f.is_favorite).sort((a, b) => b.updated_at - a.updated_at);
  const recents = foods.filter(f => !f.is_favorite).sort((a, b) => b.updated_at - a.updated_at);
  const star = (food) => update(d => { const x = d.foods.find(y => y.id === food.id); if (x) x.is_favorite = !x.is_favorite; });
  const pick = (f) => onPick({ name: f.name, source: f.source, is_alcohol: f.is_alcohol, macros: f.macros, alcohol_split: f.alcohol_split, qtyLabel: f.last_qty });
  const Row = (f) => (<div key={f.id} className="flex items-center justify-between bg-[#1E1E22] rounded-2xl px-3 py-2.5">
    <button onClick={() => pick(f)} className="text-left min-w-0 flex-1"><div className="text-sm truncate">{f.name}{f.last_qty ? <span className="text-[#8A8A90]"> · {f.last_qty}</span> : ''}</div><div className="text-[11px] text-[#8A8A90] tnum">{Math.round(f.macros.kcal)} kcal · P{f.macros.protein} C{f.macros.carbs} F{f.macros.fat}</div></button>
    <button onClick={() => star(f)} className="px-2 shrink-0" style={{ color: f.is_favorite ? FAT : '#3A3A42' }}><Icon.star width="18" height="18" fill="currentColor" /></button></div>);
  return (<div>
    <TextInput placeholder="Filter your foods…" value={q} onChange={e => setQ(e.target.value)} />
    <div className="text-[11px] text-[#8A8A90] mt-2 mb-3">Tap to log instantly with your remembered serving.</div>
    {!foods.length && <div className="text-center text-[#8A8A90] text-sm py-8">Nothing yet. Log a {isAlc ? 'drink' : 'food'} and it appears here for one-tap re-logging.</div>}
    {favs.length > 0 && <><div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">Favourites</div><div className="space-y-2 mb-4">{favs.map(Row)}</div></>}
    {recents.length > 0 && <><div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">Recent</div><div className="space-y-2">{recents.map(Row)}</div></>}
  </div>);
}
function ManualTab({ onPick }) {
  const [v, setV] = useState({ name: '', qty: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '' });
  const set = (k, x) => setV(p => Object.assign({}, p, { [k]: x }));
  const autoKcal = (+v.protein || 0) * 4 + (+v.carbs || 0) * 4 + (+v.fat || 0) * 9;
  return (<div>
    <div className="text-[12px] text-[#8A8A90] mb-3">Type it in. Enter the totals for the portion you ate.</div>
    <div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Field label="Name"><TextInput value={v.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chicken & rice" /></Field></div><Field label="Serving"><TextInput value={v.qty} onChange={e => set('qty', e.target.value)} placeholder="200 g" /></Field></div>
    <div className="grid grid-cols-4 gap-2.5"><Field label="Prot"><NumInput value={v.protein} onChange={e => set('protein', e.target.value)} /></Field><Field label="Carb"><NumInput value={v.carbs} onChange={e => set('carbs', e.target.value)} /></Field><Field label="Fat"><NumInput value={v.fat} onChange={e => set('fat', e.target.value)} /></Field><Field label="Fibre"><NumInput value={v.fiber} onChange={e => set('fiber', e.target.value)} /></Field></div>
    <Field label="Calories" hint={autoKcal ? `From macros about ${autoKcal} kcal` : ''}><NumInput value={v.kcal} onChange={e => set('kcal', e.target.value)} placeholder={autoKcal ? String(autoKcal) : ''} /></Field>
    <Btn kind="accent" className="w-full" onClick={() => { if (!v.name) return; onPick({ name: v.name, source: 'custom', qtyLabel: v.qty, macros: { kcal: +v.kcal || autoKcal, protein: +v.protein || 0, carbs: +v.carbs || 0, fat: +v.fat || 0, fiber: +v.fiber || 0 } }); }}>Add</Btn>
  </div>);
}
function SearchTab({ onPick }) {
  const [q, setQ] = useState(''); const [loading, setLoading] = useState(false); const [results, setResults] = useState([]); const [err, setErr] = useState(''); const [sel, setSel] = useState(null); const [g, setG] = useState(100);
  async function run() { if (!q.trim()) return; setLoading(true); setErr(''); setResults([]);
    try { const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(q) + '&search_simple=1&action=process&json=1&page_size=25&fields=product_name,brands,nutriments';
      const data = await (await fetch(url)).json();
      const items = (data.products || []).map(p => { const n = p.nutriments || {}; const k = n['energy-kcal_100g']; if (!p.product_name || k == null) return null; return { name: p.product_name, brand: p.brands || '', per100: { kcal: +k, protein: +n.proteins_100g || 0, carbs: +n.carbohydrates_100g || 0, fat: +n.fat_100g || 0, fiber: +n.fiber_100g || 0 } }; }).filter(Boolean);
      setResults(items); if (!items.length) setErr('No results. Try Manual entry.'); } catch (e) { setErr('Search needs internet. Use Manual for now.'); }
    setLoading(false); }
  if (sel) { const f = g / 100; return (<div className="bg-[#1E1E22] rounded-2xl p-4"><div className="font-medium">{sel.name}</div><div className="text-xs text-[#8A8A90] mb-3">{sel.brand} · per 100g {Math.round(sel.per100.kcal)} kcal · P{sel.per100.protein}</div><Field label="Amount (g)"><NumInput value={g} onChange={e => setG(e.target.value)} /></Field><div className="text-sm text-[#8A8A90] mb-3 tnum">= {Math.round(sel.per100.kcal * f)} kcal · P{(sel.per100.protein * f).toFixed(1)} C{(sel.per100.carbs * f).toFixed(1)} F{(sel.per100.fat * f).toFixed(1)}</div><div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={() => onPick({ name: sel.name, source: 'off', qtyLabel: g + ' g', macros: { kcal: Math.round(sel.per100.kcal * f), protein: +(sel.per100.protein * f).toFixed(1), carbs: +(sel.per100.carbs * f).toFixed(1), fat: +(sel.per100.fat * f).toFixed(1), fiber: +(sel.per100.fiber * f).toFixed(1) } })}>Add</Btn><Btn kind="ghost" onClick={() => setSel(null)}>Back</Btn></div></div>); }
  return (<div><div className="flex gap-2 mb-2"><TextInput placeholder="Search foods…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} /><Btn kind="ghost" onClick={run}>{loading ? '…' : 'Go'}</Btn></div><div className="text-[11px] text-[#8A8A90] mb-2">Open Food Facts, strong UK coverage.</div>{err && <div className="text-[#F5C542] text-sm mb-2">{err}</div>}<div className="space-y-2">{results.map((r, i) => (<button key={i} onClick={() => { setSel(r); setG(100); }} className="w-full text-left bg-[#1E1E22] hover:bg-[#262629] rounded-2xl p-3"><div className="text-sm font-medium">{r.name}</div><div className="text-xs text-[#8A8A90] tnum">{r.brand} · {Math.round(r.per100.kcal)} kcal/100g · P{r.per100.protein}</div></button>))}</div></div>);
}
function ConfirmFood({ note, per100, source, initial, onAdd, onCancel }) {
  const [v, setV] = useState({ name: initial.name || '', kcal: initial.kcal || '', protein: initial.protein || '', carbs: initial.carbs || '', fat: initial.fat || '', fiber: initial.fiber || '' });
  const [g, setG] = useState(100); const set = (k, x) => setV(p => Object.assign({}, p, { [k]: x }));
  const f = per100 ? (+g || 0) / 100 : 1;
  const final = { kcal: Math.round((+v.kcal || 0) * f), protein: +((+v.protein || 0) * f).toFixed(1), carbs: +((+v.carbs || 0) * f).toFixed(1), fat: +((+v.fat || 0) * f).toFixed(1), fiber: +((+v.fiber || 0) * f).toFixed(1) };
  return (<div className="fade-in"><div className="text-[12px] text-[#8A8A90] mb-3">{note} Check and edit anything that looks off.</div>
    <Field label="Name"><TextInput value={v.name} onChange={e => set('name', e.target.value)} /></Field>
    <div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-1.5">{per100 ? 'Per 100 g' : 'This portion'}</div>
    <div className="grid grid-cols-4 gap-2.5"><Field label="Kcal"><NumInput value={v.kcal} onChange={e => set('kcal', e.target.value)} /></Field><Field label="Prot"><NumInput value={v.protein} onChange={e => set('protein', e.target.value)} /></Field><Field label="Carb"><NumInput value={v.carbs} onChange={e => set('carbs', e.target.value)} /></Field><Field label="Fat"><NumInput value={v.fat} onChange={e => set('fat', e.target.value)} /></Field></div>
    {per100 && <Field label="Amount eaten (g)"><NumInput value={g} onChange={e => setG(e.target.value)} /></Field>}
    <div className="text-sm text-[#8A8A90] mb-3 tnum">Logging: {final.kcal} kcal · P{final.protein} C{final.carbs} F{final.fat}</div>
    <div className="flex gap-2"><Btn kind="accent" className="flex-1" onClick={() => onAdd({ name: v.name || 'Food', source, qtyLabel: per100 ? g + ' g' : '', macros: final })}>Add</Btn><Btn kind="ghost" onClick={onCancel}>Back</Btn></div></div>);
}
function PhotoTab({ db, onPick }) {
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [parsed, setParsed] = useState(null);
  const key = db.profile.aiKey;
  async function onLabel(file) { if (!file) return; if (!key) { setErr('Add a Gemini key in More, Settings to scan labels.'); return; } setBusy('Reading the label with AI…'); setErr('');
    try { const est = await geminiVision(key, file, LABEL_PROMPT); setParsed({ per100: true, source: 'label', note: 'Read from your label (per 100 g).', initial: { name: est.name || 'Scanned food', kcal: Math.round(est.kcal || 0), protein: est.protein_g, carbs: est.carbs_g, fat: est.fat_g, fiber: est.fiber_g } }); } catch (e) { setErr('Label read failed: ' + e.message); } setBusy(''); }
  async function onMeal(file) { if (!file) return; if (!key) { setErr('Add a Gemini key in More, Settings for AI meal estimates.'); return; } setBusy('Estimating macros with AI…'); setErr('');
    try { const est = await geminiVision(key, file, AI_PROMPT); setParsed({ per100: false, source: 'ai_estimate', note: 'AI estimate (approximate).', initial: { name: est.name || 'Meal (AI estimate)', kcal: Math.round(est.kcal), protein: est.protein_g, carbs: est.carbs_g, fat: est.fat_g } }); } catch (e) { setErr('AI estimate failed: ' + e.message); } setBusy(''); }
  async function onBarcode(file) { if (!file) return; setBusy('Scanning barcode…'); setErr('');
    try { if (!('BarcodeDetector' in window)) throw new Error('This browser cannot scan barcodes. Try Chrome, or use Search.'); const bmp = await createImageBitmap(file); const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }); const codes = await det.detect(bmp); if (!codes.length) throw new Error('No barcode found. Fill the frame and retry.'); const j = await (await fetch('https://world.openfoodfacts.org/api/v2/product/' + codes[0].rawValue + '.json')).json(); if (!j.product) throw new Error('Product not in the database. Use Manual or Search.'); const n = j.product.nutriments || {}; setParsed({ per100: true, source: 'off', note: 'From Open Food Facts (per 100 g).', initial: { name: j.product.product_name || 'Product', kcal: Math.round(n['energy-kcal_100g'] || 0), protein: n.proteins_100g, carbs: n.carbohydrates_100g, fat: n.fat_100g, fiber: n.fiber_100g } }); } catch (e) { setErr(e.message); } setBusy(''); }
  if (parsed) return <ConfirmFood {...parsed} onAdd={onPick} onCancel={() => setParsed(null)} />;
  const opts = [
    { icon: Icon.cam, t: '📸 Scan a nutrition label', d: key ? 'Gemini reads the macros off the pack.' : 'Add a Gemini key in Settings to enable.', on: onLabel, tag: key ? 'AI' : 'Key' },
    { icon: Icon.cam, t: '🍽️ Estimate a meal with AI', d: key ? 'Snap your plate, AI estimates macros.' : 'Add a Gemini key in Settings to enable.', on: onMeal, tag: key ? 'AI' : 'Key' },
    { icon: Icon.barcode, t: '📊 Scan a barcode', d: 'Looks the product up in Open Food Facts.', on: onBarcode, tag: 'Free' },
  ];
  return (<div><div className="text-[12px] text-[#8A8A90] mb-3">Snap or upload a photo. You confirm before it logs.</div>
    <div className="space-y-2.5">{opts.map((o, i) => (<label key={i} className="w-full flex items-center gap-3 bg-[#1E1E22] rounded-2xl p-4 text-left border border-[#262629] cursor-pointer active:scale-[.99] transition">
      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => o.on(e.target.files[0])} />
      <div className="w-11 h-11 rounded-xl bg-[#4A9EEB]/15 flex items-center justify-center shrink-0"><o.icon width="22" height="22" style={{ color: CAL }} /></div>
      <div className="min-w-0"><div className="text-sm font-medium flex items-center gap-2">{o.t} <span className="text-[10px] uppercase tracking-wide text-black bg-white rounded px-1.5 py-0.5">{o.tag}</span></div><div className="text-[11px] text-[#8A8A90]">{o.d}</div></div></label>))}</div>
    {busy && <div className="text-[12px] text-[#4A9EEB] mt-3 fade-in">{busy}</div>}{err && <div className="text-[12px] text-[#F5C542] mt-3 fade-in">{err}</div>}</div>);
}
function AlcoholTab({ onPick }) {
  const PRESETS = [['Pint of lager (4%)', 180], ['Pint of cider', 210], ['175ml wine', 160], ['Single spirit + mixer', 120], ['Bottle of beer', 150], ['Custom', 0]];
  const [name, setName] = useState('Pint of lager (4%)'); const [qty, setQty] = useState('1 pint'); const [kcal, setKcal] = useState(180); const [manual, setManual] = useState(false); const [carbPct, setCarbPct] = useState(100); const [mc, setMc] = useState({ carbs: '', fat: '', protein: '' });
  const autoCarbs = (kcal * carbPct / 100) / 4, autoFat = (kcal * (100 - carbPct) / 100) / 9;
  function add() { const macros = manual ? { kcal: +kcal, protein: +mc.protein || 0, carbs: +mc.carbs || 0, fat: +mc.fat || 0, fiber: 0 } : { kcal: +kcal, protein: 0, carbs: +autoCarbs.toFixed(1), fat: +autoFat.toFixed(1), fiber: 0 }; onPick({ name: name + ' 🍺', source: 'alcohol', is_alcohol: true, qtyLabel: qty, alcohol_split: manual ? null : { carb_pct: carbPct, fat_pct: 100 - carbPct }, macros }); }
  return (<div><div className="text-[12px] text-[#8A8A90] mb-3">Alcohol calories get booked against carbs and fat so your day still balances, or enter your own macros.</div>
    <div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Field label="Drink"><Dropdown value={name} onChange={v => { setName(v); const p = PRESETS.find(x => x[0] === v); if (p && p[1]) setKcal(p[1]); }} options={PRESETS.map(p => ({ v: p[0], l: p[0] }))} /></Field></div><Field label="Serving"><TextInput value={qty} onChange={e => setQty(e.target.value)} /></Field></div>
    <Field label="Calories"><NumInput value={kcal} onChange={e => setKcal(e.target.value)} /></Field>
    <div className="flex gap-2 mb-3">{[['auto', 'Auto split'], ['manual', 'Enter macros']].map(([k, l]) => <button key={k} onClick={() => setManual(k === 'manual')} className={`flex-1 rounded-2xl py-2.5 text-sm ${manual === (k === 'manual') ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90] border border-[#262629]'}`}>{l}</button>)}</div>
    {!manual ? (<Field label={`${carbPct}% carbs · ${100 - carbPct}% fat`}><input type="range" min="0" max="100" step="10" value={carbPct} onChange={e => setCarbPct(+e.target.value)} className="w-full accent-[#4A9EEB]" /><div className="text-sm text-[#8A8A90] mt-2 tnum">= {autoCarbs.toFixed(1)}g carbs · {autoFat.toFixed(1)}g fat</div></Field>) : (<div className="grid grid-cols-3 gap-3"><Field label="Protein"><NumInput value={mc.protein} onChange={e => setMc(p => Object.assign({}, p, { protein: e.target.value }))} /></Field><Field label="Carbs"><NumInput value={mc.carbs} onChange={e => setMc(p => Object.assign({}, p, { carbs: e.target.value }))} /></Field><Field label="Fat"><NumInput value={mc.fat} onChange={e => setMc(p => Object.assign({}, p, { fat: e.target.value }))} /></Field></div>)}
    <Btn kind="accent" className="w-full mt-1" onClick={add}>Add drink</Btn></div>);
}

/* =====================================================================
   STRATEGY (goal, check-in, cycling, carryover, coach)
   ===================================================================== */
function Strategy({ db, update }) {
  const p = db.profile; const unit = p.weight_unit;
  const set = (k, v) => update(d => d.profile[k] = v);
  const setNested = (obj, k, v) => update(d => { d.profile[obj] = Object.assign({}, d.profile[obj], { [k]: v }); });
  const base = currentTargets(db);
  const cyc = p.cycling || { enabled: false, highDays: [], deltaPct: 0.15 };
  function recompute() { update(d => { const t = E.computeInitialTargets(withActivity(d.profile)); t.id = Store.uid(); t.effective_date = Store.todayISO(); t.source = 'manual'; d.targets.push(t); }); }

  // check-in
  const last = db.weight_entries[db.weight_entries.length - 1];
  const seed = kgToStLb(last ? last.scale_weight : p.weightKg);
  const [kg, setKg] = useState(last ? last.scale_weight : p.weightKg); const [st, setSt] = useState(seed.st); const [lb, setLb] = useState(seed.lb);
  const [bf, setBf] = useState(last ? last.bodyfat : p.bodyFatPct); const [result, setResult] = useState(null);
  function saveCheckin() {
    const weightKg = unit === 'st_lb' ? stLbToKg(st, lb) : +kg; if (!weightKg || !bf) { alert('Enter weight and body fat %.'); return; }
    update(d => { d.weight_entries.push({ id: Store.uid(), date: Store.todayISO(), scale_weight: +weightKg.toFixed(2), bodyfat: +bf }); d.weight_entries.sort((a, b) => a.date.localeCompare(b.date)); const ts = E.trendSeries(d.weight_entries.map(x => ({ date: x.date, weightKg: x.scale_weight }))); d.weight_entries.forEach((x, i) => x.trend_weight = ts[i].trendKg); d.profile.weightKg = +weightKg.toFixed(2); d.profile.bodyFatPct = +bf; });
    const cutoff = shiftISO(Store.todayISO(), -14);
    const weights = db.weight_entries.concat([{ date: Store.todayISO(), scale_weight: +weightKg }]).filter(w => w.date >= cutoff);
    const ts = E.trendSeries(weights.map(w => ({ date: w.date, weightKg: w.scale_weight })));
    const byDate = {}; db.log_entries.filter(e => e.date >= cutoff).forEach(e => byDate[e.date] = (byDate[e.date] || 0) + e.computed_macros.kcal); const days = Object.keys(byDate);
    if (ts.length < 2 || days.length < 3) { setResult({ changed: false, reason: 'Keep logging. I need about a week of weigh-ins and food entries before I can retune your targets.' }); return; }
    const est = E.estimateExpenditure({ dailyKcal: days.map(k => byDate[k]), trendStartKg: ts[0].trendKg, trendEndKg: ts[ts.length - 1].trendKg, days: Math.max(7, ts.length) });
    setResult(E.weeklyAdjust({ profile: withActivity(Object.assign({}, p, { weightKg: +weightKg })), currentTargets: base, estimate: est, adherenceDays: days.length }));
  }
  function accept() { update(d => d.targets.push(Object.assign({}, result.newTargets, { id: Store.uid(), effective_date: Store.todayISO(), rationale: result.reason }))); setResult(r => Object.assign({}, r, { accepted: true })); }

  return (
    <div className="max-w-md mx-auto px-5 pb-28 pt-6 fade-in">
      <h1 className="text-4xl font-extrabold mb-5">Strategy</h1>

      <Section title="🎯 Goal">
        <Field label="Direction"><Seg value={p.goalType} onChange={v => { set('goalType', v); }} options={[{ v: 'cut', l: '📉 Cut' }, { v: 'maintain', l: '⚖️ Maintain' }, { v: 'gain', l: '📈 Lean gain' }]} /></Field>
        {p.goalType !== 'maintain' && <Field label={`Rate: ${p.rateKgPerWeek} kg/week`}><input type="range" min="0.1" max="1.2" step="0.05" value={p.rateKgPerWeek} onChange={e => set('rateKgPerWeek', +e.target.value)} className="w-full accent-[#4A9EEB]" />{(() => { const rl = rateLabel(p.rateKgPerWeek); return <div className="text-[12px] mt-1.5" style={{ color: rl.c }}>Pace: {rl.t}</div>; })()}</Field>}
        <Field label={`Protein: ${p.proteinManualG || Math.round((p.proteinGPerKgBW || 1.8) * p.weightKg)} g`}><input type="range" min="1.4" max="2.4" step="0.1" value={p.proteinGPerKgBW || 1.8} onChange={e => { set('proteinGPerKgBW', +e.target.value); set('proteinManualG', ''); }} className="w-full accent-[#4A9EEB]" /></Field>
        <Field label="Diet style"><Seg value={p.dietStyle} onChange={v => set('dietStyle', v)} options={[{ v: 'balanced', l: 'Balanced' }, { v: 'lower_carb', l: 'Lower carb' }, { v: 'higher_carb', l: 'Higher carb' }]} /></Field>
        <Btn kind="ghost" className="w-full" onClick={recompute}>Apply to my targets</Btn>
        {base && <div className="text-[12px] text-[#8A8A90] mt-3 text-center tnum">Current plan: {base.kcal} kcal · P{base.protein_g} C{base.carbs_g} F{base.fat_g}</div>}
      </Section>

      <Section title="⚖️ Weekly check-in">
        <Card className="p-5">
          <div className="text-[12px] text-[#8A8A90] mb-3">Weight updates only happen here. Same time, same scale each week.</div>
          <Field label="Weight">{unit === 'st_lb' ? <div className="flex gap-2 items-center"><NumInput value={st} onChange={e => setSt(+e.target.value)} /><span className="text-[#8A8A90]">st</span><NumInput value={lb} onChange={e => setLb(+e.target.value)} /><span className="text-[#8A8A90]">lb</span></div> : <NumInput value={kg} onChange={e => setKg(e.target.value)} />}</Field>
          <Field label="Body fat %"><NumInput value={bf} onChange={e => setBf(e.target.value)} /></Field>
          <Btn kind="accent" className="w-full" onClick={saveCheckin}>Save & retune</Btn>
          {result && <div className="mt-4 pt-4 border-t border-[#262629]"><div className="text-[11px] uppercase tracking-widest text-[#8A8A90] mb-2">{result.changed ? 'Suggested change' : 'Coaching'}</div><p className="text-sm">{result.reason}</p>{result.estimate && <div className="text-[11px] text-[#8A8A90] mt-2 tnum">Est. burn ~{result.estimate.tdee} · trend {result.estimate.weeklyChangeKg} kg/wk</div>}{result.changed && !result.accepted && <div className="flex gap-2 mt-3"><Btn kind="accent" className="flex-1" onClick={accept}>Accept</Btn><Btn kind="ghost" onClick={() => setResult(null)}>Keep current</Btn></div>}{result.accepted && <div className="text-[#34D399] text-sm mt-2">✓ Targets updated.</div>}</div>}
        </Card>
      </Section>

      <Section title="🏦 Calorie carryover">
        <RowToggle label="Bank surplus/deficit to next day" on={p.carryover?.enabled} onClick={() => setNested('carryover', 'enabled', !p.carryover?.enabled)} />
        {p.carryover?.enabled && <Field label={`Daily cap: ±${p.carryover.capKcal || 400} kcal`}><input type="range" min="100" max="800" step="50" value={p.carryover.capKcal || 400} onChange={e => setNested('carryover', 'capKcal', +e.target.value)} className="w-full accent-[#4A9EEB]" /></Field>}
      </Section>

      <Section title="🔁 High / low days">
        <RowToggle label="Cycle calories across the week" on={cyc.enabled} onClick={() => setNested('cycling', 'enabled', !cyc.enabled)} />
        {cyc.enabled && <>
          <div className="text-[11px] text-[#8A8A90] mb-2">Pick your high days. The rest come down to keep your weekly total the same.</div>
          <div className="flex gap-1.5 mb-3">{DOW.map((d, i) => { const on = cyc.highDays.includes(i); return <button key={i} onClick={() => setNested('cycling', 'highDays', on ? cyc.highDays.filter(x => x !== i) : cyc.highDays.concat([i]))} className={`flex-1 rounded-lg py-2 text-[11px] ${on ? 'bg-[#4A9EEB] text-white font-semibold' : 'bg-[#1E1E22] text-[#8A8A90]'}`}>{d[0]}</button>; })}</div>
          <Field label={`High-day boost: +${Math.round((cyc.deltaPct || 0.15) * 100)}%`}><input type="range" min="5" max="35" value={Math.round((cyc.deltaPct || 0.15) * 100)} onChange={e => setNested('cycling', 'deltaPct', +e.target.value / 100)} className="w-full accent-[#4A9EEB]" /></Field>
          {base && <div className="grid grid-cols-7 gap-1 mt-1">{DOW.map((d, i) => { const k = base.kcal + E.cyclingDelta(Object.assign({}, cyc, { enabled: true }), i, base.kcal); const hi = cyc.highDays.includes(i); return <div key={i} className="text-center"><div className="text-[10px] text-[#8A8A90]">{d[0]}</div><div className={`text-[11px] tnum ${hi ? 'text-[#4A9EEB]' : 'text-white'}`}>{Math.round(k)}</div></div>; })}</div>}
        </>}
      </Section>
    </div>
  );
}

/* =====================================================================
   MORE (personal details + settings)
   ===================================================================== */
function More({ db, update, onSignOut, onReset, onFreshStart, email }) {
  const p = db.profile;
  const set = (k, v) => update(d => d.profile[k] = v);
  const act = ACTIVITY.find(a => a.v === p.activityLevel) || ACTIVITY[2];
  const [tab, setTab] = useState('details');
  return (
    <div className="max-w-md mx-auto px-5 pb-28 pt-6 fade-in">
      <h1 className="text-4xl font-extrabold mb-4">More</h1>
      <div className="flex gap-1.5 mb-5 bg-[#1E1E22] p-1 rounded-2xl">{[['details', 'Personal details'], ['settings', 'Settings']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-xl py-2.5 text-sm transition ${tab === k ? 'bg-white text-black font-semibold' : 'text-[#8A8A90]'}`}>{l}</button>)}</div>

      {tab === 'details' && <>
        <Card className="p-5 mb-4">
          <Row2 k="Sex" v={p.sex === 'male' ? 'Male' : 'Female'} />
          <Row2 k="Age" v={p.age + ' years'} />
          <Row2 k="Height" v={fmtHeight(p.heightCm, p.height_unit)} />
          <Row2 k="Activity" v={act.l} />
          <Row2 k="Current weight" v={fmtWeight(p.weightKg, p.weight_unit)} />
          <Row2 k="Body fat" v={p.bodyFatPct + '%'} last />
        </Card>
        <div className="text-[12px] text-[#8A8A90] mb-3">These are set during setup. Weight and body fat change only through a weekly check-in. To change age, height or activity, run a fresh setup.</div>
        <Btn kind="ghost" className="w-full" onClick={onFreshStart}>Run fresh setup</Btn>
      </>}

      {tab === 'settings' && <>
        <Section title="Nutrition">
          <Field label="Coaching mode"><Seg value={p.program_mode} onChange={v => set('program_mode', v)} options={[{ v: 'coached', l: 'Coached' }, { v: 'collaborative', l: 'Approve' }, { v: 'manual', l: 'Manual' }]} /></Field>
          <Field label="Exact protein target (g, optional)"><NumInput value={p.proteinManualG || ''} onChange={e => set('proteinManualG', e.target.value ? +e.target.value : '')} placeholder="leave blank to use g/kg" /></Field>
        </Section>
        <Section title="Units">
          <Field label="Weight"><div className="flex gap-2">{[['st_lb', 'st / lb'], ['kg', 'kg']].map(([v, l]) => <button key={v} onClick={() => set('weight_unit', v)} className={`flex-1 rounded-2xl py-2.5 text-sm ${p.weight_unit === v ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90] border border-[#262629]'}`}>{l}</button>)}</div></Field>
          <Field label="Height"><div className="flex gap-2">{[['cm', 'cm'], ['ft_in', 'ft / in']].map(([v, l]) => <button key={v} onClick={() => set('height_unit', v)} className={`flex-1 rounded-2xl py-2.5 text-sm ${p.height_unit === v ? 'bg-white text-black font-semibold' : 'bg-[#1E1E22] text-[#8A8A90] border border-[#262629]'}`}>{l}</button>)}</div></Field>
        </Section>
        <Section title="🤖 AI photo features">
          <Field label="Gemini API key" hint="Powers label scanning and AI meal estimates. Saved to your account.">
            <TextInput value={p.aiKey || ''} onChange={e => set('aiKey', e.target.value)} placeholder="paste your Gemini key (AIza...)" />
          </Field>
          <div className="text-[11px] text-[#8A8A90]">Get a free key at aistudio.google.com/app/apikey.</div>
        </Section>
        <Section title="Account">
          {email && <div className="text-[12px] text-[#8A8A90] mb-3">Signed in as <span className="text-white">{email}</span>.</div>}
          <Btn kind="ghost" className="w-full mb-3" onClick={onSignOut}>Sign out</Btn>
          <Btn kind="danger" className="w-full" onClick={() => { if (confirm('Erase all your Macrosaurus data and start over?')) onReset(); }}>Reset all data</Btn>
        </Section>
        <div className="text-[11px] text-[#8A8A90]/70 mt-2 text-center">{BRAND} · your data syncs to your account</div>
      </>}
    </div>
  );
}
function Row2({ k, v, last }) { return (<div className={`flex justify-between items-center py-2.5 ${last ? '' : 'border-b border-[#262629]'}`}><span className="text-[#8A8A90] text-sm">{k}</span><span className="font-medium tnum">{v}</span></div>); }

/* =====================================================================
   ROOT
   ===================================================================== */
const SUPA_URL = 'https://wnbksotvcjqfslrttjxy.supabase.co';
const SUPA_KEY = 'sb_publishable_IMKN6PzhKwUZQp8n1RlKaQ_t2_1iQXB';
const supa = (typeof window !== 'undefined' && window.supabase) ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;
let _saveTimer = null;
function cloudSave(uid, data) { if (!supa || !uid) return; clearTimeout(_saveTimer); _saveTimer = setTimeout(function () { supa.from('user_state').upsert({ user_id: uid, data, updated_at: new Date().toISOString() }).then(function (r) { if (r.error) console.warn('cloud save failed:', r.error.message); }); }, 700); }
async function cloudLoad(uid) { const r = await supa.from('user_state').select('data').eq('user_id', uid).maybeSingle(); if (r.error) throw r.error; return r.data ? r.data.data : null; }

function BottomNav({ view, setView, onAdd }) {
  const items = [['dashboard', 'Dashboard', Icon.dash], ['foodlog', 'Food Log', Icon.food], ['strategy', 'Strategy', Icon.strategy], ['more', 'More', Icon.more]];
  return (
    <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-[#09090B]/95 backdrop-blur border-t border-[#262629] flex items-center z-40 px-2" style={{ height: 74 }}>
      {items.slice(0, 2).map(([k, l, Ic]) => <NavBtn key={k} k={k} l={l} Ic={Ic} view={view} setView={setView} />)}
      <div className="flex-1 flex justify-center"><button onClick={onAdd} className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center -mt-6 shadow-lg shadow-black/40"><Icon.plus width="24" height="24" /></button></div>
      {items.slice(2).map(([k, l, Ic]) => <NavBtn key={k} k={k} l={l} Ic={Ic} view={view} setView={setView} />)}
    </div>
  );
}
function NavBtn({ k, l, Ic, view, setView }) { return (<button onClick={() => setView(k)} className="flex-1 flex flex-col items-center gap-1" style={{ color: view === k ? '#FFFFFF' : '#5A5A62' }}><Ic width="22" height="22" /><span className="text-[10px]">{l}</span></button>); }

function App() {
  const [session, setSession] = useState(undefined);
  const [db, setDb] = useState(null);
  const [view, setView] = useState('dashboard');
  const [adding, setAdding] = useState(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (!supa) { setSession(null); return; }
    supa.auth.getSession().then(function (r) { setSession(r.data.session || null); });
    const sub = supa.auth.onAuthStateChange(function (_e, s) { setSession(s || null); if (!s) setDb(null); });
    return function () { sub.data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!session) return; let cancelled = false;
    cloudLoad(session.user.id).then(function (remote) { if (!cancelled) setDb(Object.assign(Store.defaultState(), remote || {})); }).catch(function () { if (!cancelled) setDb(Store.defaultState()); });
    return function () { cancelled = true; };
  }, [session]);

  function update(m) { setDb(prev => { const n = JSON.parse(JSON.stringify(prev)); m(n); if (session) cloudSave(session.user.id, n); return n; }); }
  function saveProfile(profile, isNew) {
    setDb(prev => {
      const n = JSON.parse(JSON.stringify(prev || Store.defaultState())); n.profile = profile;
      n.goals = { goal_type: profile.goalType, rate_per_week_kg: profile.rateKgPerWeek };
      const t = E.computeInitialTargets(withActivity(profile)); t.id = Store.uid(); t.effective_date = Store.todayISO(); n.targets.push(t);
      if (isNew && !n.weight_entries.length) n.weight_entries.push({ id: Store.uid(), date: Store.todayISO(), scale_weight: +profile.weightKg.toFixed(2), bodyfat: +profile.bodyFatPct, trend_weight: +profile.weightKg.toFixed(2) });
      if (session) cloudSave(session.user.id, n); return n;
    });
    setFresh(false);
  }
  function addEntry(date, mealId, item) {
    update(d => {
      d.log_entries.push({ id: Store.uid(), date, meal_id: mealId, ref_type: item.is_alcohol ? 'alcohol' : 'food', name: item.name, source: item.source, is_alcohol: !!item.is_alcohol, alcohol_split: item.alcohol_split, qty_label: item.qtyLabel || '', computed_macros: item.macros, sort_order: d.log_entries.length });
      const key = item.name.trim().toLowerCase(); let food = d.foods.find(x => x.name.trim().toLowerCase() === key && !!x.is_alcohol === !!item.is_alcohol);
      if (food) { food.macros = item.macros; food.last_qty = item.qtyLabel || food.last_qty; food.updated_at = Date.now(); }
      else d.foods.push({ id: Store.uid(), name: item.name, source: item.source, is_alcohol: !!item.is_alcohol, is_favorite: false, last_qty: item.qtyLabel || '', macros: item.macros, alcohol_split: item.alcohol_split, updated_at: Date.now() });
    });
    setAdding(null);
  }
  async function signOut() { if (supa) await supa.auth.signOut(); setDb(null); setView('dashboard'); }
  function resetAll() { const f2 = Store.defaultState(); setDb(f2); if (session) cloudSave(session.user.id, f2); setView('dashboard'); }

  if (session === undefined) return <div className="max-w-md mx-auto p-10 text-center text-[#8A8A90]">Loading…</div>;
  if (!session) return <Auth />;
  if (!db) return <div className="max-w-md mx-auto p-10 text-center text-[#8A8A90]">Loading your data…</div>;
  if (fresh) return <Wizard initial={db.profile} onDone={(pr) => saveProfile(pr, false)} onCancel={() => setFresh(false)} />;
  if (!db.profile) return <Wizard onDone={(pr) => saveProfile(pr, true)} />;
  const meals = db.meal_templates.slice().sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div>
      {view === 'dashboard' && <Dashboard db={db} />}
      {view === 'foodlog' && <FoodLog db={db} update={update} openLog={setAdding} />}
      {view === 'strategy' && <Strategy db={db} update={update} />}
      {view === 'more' && <More db={db} update={update} onSignOut={signOut} onReset={resetAll} onFreshStart={() => setFresh(true)} email={session.user.email} />}
      <BottomNav view={view} setView={setView} onAdd={() => setAdding({ date: Store.todayISO(), mealId: meals[0].id })} />
      {adding && <LogSheet db={db} update={update} meals={meals} target={adding} onAdd={(mealId, item) => addEntry(adding.date, mealId, item)} onClose={() => setAdding(null)} />}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
