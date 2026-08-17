/* ---- train.jsx ----
 * The Train tab: blocks, the in-gym session player, the coverage audit and the block review.
 *
 * Every number shown here comes from Training (app/training.js), which is pure and unit-tested.
 * Nothing in this file does maths of its own, so what you see on screen is always what the tests
 * asserted. AI lives behind trainAI() and only ever proposes exercises or writes prose.
 *
 * Loaded AFTER app.jsx, so these are all function declarations (which hoist across the bundle's
 * single script scope) and they are free to use app.jsx's const helpers at call time.
 */

// ---- state helpers ----------------------------------------------------------------------------
// One accessor so no component has to defend against a half-migrated shape.
function tdb(db) {
  const t = (db && db.training) || {};
  return {
    blocks: t.blocks || [], logs: t.logs || [], custom: t.custom || [],
    volumeTargets: t.volumeTargets || {},
    // The draft basket: days collected from several imports before they become a block. This is how
    // "here is Upper A, here is Upper B, here is Lower A" from four separate posts turns into one
    // programme, rather than four one-day blocks that overwrite each other.
    draft: t.draft || null,
    prefs: Object.assign({ units: 'kg', experience: 'intermediate', equipment: [], daysPerWeek: 4, sessionMinutes: 60, dislikes: [], restTimer: true }, t.prefs || {}),
  };
}
function trainTargets(db) {
  const t = tdb(db);
  return Training.defaultTargets({ experience: t.prefs.experience, volumeTargets: t.volumeTargets });
}
function activeBlock(db) {
  const t = tdb(db);
  const live = t.blocks.filter(b => !b.archived && b.startISO);
  if (!live.length) return null;
  // The most recently started block that has not run past its final week.
  const today = Store.todayISO();
  const running = live.filter(b => !Training.blockProgress(b, today).done);
  const pool = running.length ? running : live;
  return pool.slice().sort((a, b) => (a.startISO < b.startISO ? 1 : -1))[0];
}
function trainUpdate(update, fn) {
  update(d => {
    if (!d.training) d.training = { blocks: [], logs: [], custom: [], volumeTargets: {}, prefs: {} };
    if (!d.training.blocks) d.training.blocks = [];
    if (!d.training.logs) d.training.logs = [];
    if (!d.training.custom) d.training.custom = [];
    fn(d.training, d);
  });
}
function trainUid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// The same seven, written out, for the places somebody is CHOOSING a day rather than reading a label.
// Deliberately not app.jsx's DOW_FULL, which is Sunday-first because it indexes Date.getDay();
// training's dayOfWeek is Monday-first, and quietly borrowing the other one would move every session
// by a day.
const WEEKDAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// "Week 3" on its own never told you WHEN. The dates do, and they are what people check against
// their actual diary.
function weekRangeLabel(startISO, week) {
  if (!startISO) return 'not scheduled yet';
  const start = Date.parse(startISO + 'T00:00:00Z');
  if (isNaN(start)) return '';
  const a = new Date(start + (week - 1) * 7 * 86400000);
  const b = new Date(start + ((week - 1) * 7 + 6) * 86400000);
  const f = d => d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return f(a) + ' to ' + f(b);
}

// Weight display respects the user's unit without ever changing what is stored. Kilograms are the
// only thing that touches the database, exactly as bodyweight is handled elsewhere in the app.
function toDisplayWeight(kg, units) { return units === 'lb' ? Training.round((+kg || 0) * 2.20462, 1) : Training.round(+kg || 0, 1); }
function fromDisplayWeight(v, units) { return units === 'lb' ? Training.round((+v || 0) / 2.20462, 2) : (+v || 0); }
function unitLabel(units) { return units === 'lb' ? 'lb' : 'kg'; }
// Say something only when something CHANGED. The engine hands back a reason for every exercise,
// but "on track, add a rep where you can" repeated down a six-exercise session stops being read
// after the second one, and it repeats what the rep range above it already says. A weight going up,
// or a warning to hold, is worth a line. Steady state is not.
function coachNote(pre) {
  if (!pre || !pre.note) return null;
  return (pre.action === 'load' || pre.action === 'hold') ? pre.note : null;
}
// Day names arrive with wildly inconsistent punctuation across posts ("Upper A", "upper-a", "UPPER A:"),
// and matching them is what stops a re-import leaving you with two of the same day.
function norm2(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
// What today's plan asks for that this gym has not got, with the nearest thing it HAS as the
// suggested replacement. Returns [] when no gym is set, because we should not invent constraints
// for someone who never told us where they train.
function missingHere(items, gym, custom) {
  if (!gym) return [];
  const g = Training.gymEquipment(gym);
  if (!g.equipment) return [];
  const blocked = {};
  (g.excluded || []).forEach(id => { blocked[id] = 1; });
  const present = (items || []).map(it => it.exerciseId);
  const out = [];
  (items || []).forEach((it, index) => {
    const ex = Training.byId(it.exerciseId, custom);
    if (!ex || Training.isCardio(ex)) return;
    const bad = blocked[ex.id] || g.equipment.indexOf(ex.equipment) === -1;
    if (!bad) return;
    let alt = null;
    (ex.primary || []).some(m => {
      const c = Training.suggestFor(m, { equipment: g.equipment, excluded: g.excluded, custom, currentExerciseIds: present, limit: 1 });
      if (c.length) { alt = c[0].id; return true; }
      return false;
    });
    out.push({ index, exerciseId: ex.id, alt });
  });
  return out;
}
function fmtClock(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0');
}
// Rest as a person would say it, not as a raw second count: "2 min", "90s", "2.5 min".
function fmtRest(secs) {
  const s = Math.round(+secs || 0);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + 'm' + r : m + 'm';
}

// Sessions that belong to a given week, ordered, with their log if one exists.
// How long a session will take, from its own prescription: every set costs its rest plus about
// forty seconds of work. Written out inline in three places before this, which meant the block
// preview and the session list could quietly disagree about the same session.
function sessionMins(exercises) {
  return Math.round((exercises || []).reduce((a, e) => a + (((e.target && e.target.sets) || 0) * ((((e.target && e.target.restSec) || 120) + 40) / 60)), 0));
}

function weekPlan(block, week, logs) {
  const comp = Training.completion(block, logs);
  return Training.weekSessions(block, week)
    .slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map(s => ({ session: s, log: comp.logBySession[s.id] || null }));
}

// ---- shared bits ------------------------------------------------------------------------------

/* ---- the coverage instrument, per `Build a block v3.dc.html` ------------------------------------
   One muscle's week as a POSITION on its own MEV-to-MRV band: the shaded stripe is the range where
   the work is worth doing, and the marker is where this week actually puts you.

   It used to be a bar that filled from the left with two hairlines on it, and the fill was the
   problem. A filling bar means more is better - it is how every progress bar and every macro meter
   in this app behaves, correctly - and here more is emphatically not better, because the whole
   argument of the panel is that the range has a TOP as well as a bottom. Someone at 26 sets against
   an MRV of 22 was shown a fuller, healthier-looking bar than someone sitting perfectly in the
   middle of their range. The band reads the right way round: outside the stripe is outside the
   stripe, whichever end you fall off.

   Used on every screen in the module that talks about volume, so the reading is learned once. */
function CoverageRow({ row, compact }) {
  const span = row.mrv + 6;
  const status = row.sets < row.mev ? 'short' : row.sets > row.mrv ? 'over' : 'in';
  const tone = status === 'in' ? 'var(--good)' : status === 'short' ? 'var(--muted2)' : 'var(--warn)';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] truncate" style={{ color: 'var(--text2)' }}>{row.label}</span>
        <span className="text-[11px] tnum shrink-0 font-bold"
          style={{ color: status === 'in' ? 'var(--good-ink)' : status === 'short' ? 'var(--muted)' : 'var(--warn-ink)' }}>
          {row.sets} / {row.mev}-{row.mrv}
        </span>
      </div>
      <div className="relative mt-1.5" style={{ height: compact ? 9 : 10, border: '2px solid var(--border)', background: 'var(--track)' }}>
        <div className="absolute inset-y-0" style={{ left: (row.mev / span * 100) + '%', width: ((row.mrv - row.mev) / span * 100) + '%', background: 'var(--accent-dim)' }} />
        <div className="absolute" style={{
          top: -3, bottom: -3, width: 5, background: tone,
          left: 'calc(' + Math.min(98, row.sets / span * 100) + '% - 2px)',
          transition: 'left .25s cubic-bezier(.2,.8,.2,1)',
        }} />
      </div>
    </div>
  );
}

/* A shaded stripe and a marker mean nothing until somebody says once what they are, so any group of
   these carries the key. Suppressed on the compact/limited variants, where the bars are a glance
   inside a bigger card rather than the thing you came to read. */
function CoverageBars({ coverage, limit, compact, legend }) {
  const rows = limit ? coverage.rows.slice().sort((a, b) => a.pct - b.pct).slice(0, limit) : coverage.rows;
  const showKey = legend != null ? legend : !compact;
  return (
    <div>
      {showKey && (
        <div className="flex gap-3 mb-3 flex-wrap">
          {/* The band swatch is a SLICE OF THE BAR, not a colour chip. As a flat square of
              accent-dim on a cream card it was very nearly invisible: the band only reads at all
              because it sits on the darker track, so the key has to carry the track with it. */}
          <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--muted2)' }}>
            <span className="shrink-0" style={{ width: 22, height: 9, border: '2px solid var(--border)', background: 'var(--track)' }}>
              <span className="block h-full" style={{ width: '60%', marginLeft: '20%', background: 'var(--accent-dim)' }} />
            </span>
            the range
          </span>
          <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--muted2)' }}>
            <span className="shrink-0" style={{ width: 5, height: 11, background: 'var(--good)' }} />in it
          </span>
          <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--muted2)' }}>
            <span className="shrink-0" style={{ width: 5, height: 11, background: 'var(--muted2)' }} />short
          </span>
          <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--muted2)' }}>
            <span className="shrink-0" style={{ width: 5, height: 11, background: 'var(--warn)' }} />past recovery
          </span>
        </div>
      )}
      <div className={'flex flex-col ' + (compact ? 'gap-2' : 'gap-2.5')}>
        {rows.map(r => <CoverageRow key={r.muscle} row={r} compact={compact} />)}
      </div>
    </div>
  );
}

// A single line the user can act on. The audit produces the fact, this writes the sentence.
function gapSentence(gap) {
  if (gap.band === 'none') return gap.label + ' is not trained at all this week.';
  if (gap.band === 'under') return gap.label + ' is well short, ' + gap.sets + ' sets against a floor of ' + gap.mev + '.';
  return gap.label + ' is only being maintained at ' + gap.sets + ' sets, not grown.';
}

// The one primary action of a screen, pinned in the thumb zone. It has to clear the bottom nav,
// which is itself fixed: without the offset the button sits UNDER the tab bar and the last thing
// you need in the gym is the one control you cannot reach. On desktop there is no bottom bar, so
// it drops back into the flow.
function StickyAction({ children, clearsNav = true }) {
  return (
    <div className="fixed inset-x-0 max-w-md mx-auto px-3 pt-3 lg:static lg:p-0 lg:max-w-none z-30"
      style={{
        // The tab bar is 64px and the centre Add button floats about 40px above it, so a bar that
        // only cleared 64px still had its right half sitting under the plus. Screens that hide the
        // nav (the session player) pass clearsNav={false} and sit at the bottom of the screen.
        bottom: clearsNav ? 'calc(104px + env(safe-area-inset-bottom))' : 'env(safe-area-inset-bottom)',
        paddingBottom: '12px',
        background: 'linear-gradient(to top, var(--bg) 65%, transparent)',
      }}>
      {children}
    </div>
  );
}

function ExerciseName({ id, custom, className }) {
  const ex = Training.byId(id, custom);
  return <span className={className}>{ex ? ex.name : id}</span>;
}

function MuscleTags({ exerciseId, custom }) {
  const ex = Training.byId(exerciseId, custom);
  if (!ex) return null;
  const c = Training.setContribution(ex);
  const prim = Object.keys(c).filter(m => c[m] >= 1);
  const sec = Object.keys(c).filter(m => c[m] < 1);
  return (
    <span className="text-[10px]" style={{ color: 'var(--muted2)' }}>
      {prim.map(m => Training.MUSCLE_LABEL[m]).join(', ')}
      {sec.length ? ' · ' + sec.map(m => Training.MUSCLE_LABEL[m]).join(', ') : ''}
    </span>
  );
}

// The buddy, saying something in Train. Everywhere else in the app the companion has a face when it
// speaks: the habitat on Today, the bubbles at check-in, the hatch. Train printed its prose under a
// label reading "Your coach", which is not a character this app has anywhere else, and the effect
// was two narrators in one product. This is the one way anything speaks over here now.
// `tone` colours the name only, for the rare line that is a warning rather than a chat.
function BuddySays({ db, children, tone, className }) {
  return (
    <Card className={'p-4 mb-4' + (className ? ' ' + className : '')}>
      <div className="flex items-center gap-2 mb-3">
        <div className="pixel-box p-1 shrink-0" style={{ background: 'var(--surface3)', boxShadow: 'none', lineHeight: 0 }}>
          <BuddyAvatar buddy={(db && db.buddy) || {}} px={1.6} />
        </div>
        <div className="pf text-[9px] uppercase truncate" style={{ color: tone || 'var(--accent-ink)' }}>{buddyName(db)}</div>
      </div>
      <div className="text-[13px] leading-relaxed whitespace-pre-wrap">{children}</div>
    </Card>
  );
}

// ---- the tab ----------------------------------------------------------------------------------
function TrainTab({ db, update, showToast, isPremium, onUpgrade, onFocusMode, importUrl, onConsumeImport }) {
  const [screen, setScreen] = useState({ name: 'home' });
  const [pendingStart, setPendingStart] = useState(null);  // waiting on "which gym are you at?"
  const t = tdb(db);
  const block = activeBlock(db);
  const go = (name, props) => setScreen(Object.assign({ name: name }, props || {}));

  // A link shared in from another app and routed here rather than to Cook. Open the importer with it
  // already filled in, so the share lands one tap from being read.
  useEffect(() => {
    if (!importUrl) return;
    setScreen({ name: 'wizard', url: importUrl });
    onConsumeImport && onConsumeImport();
  }, [importUrl]);

  // Starting a session is the single most common action, so it is one call from anywhere. If more
  // than one gym is saved we ask which one first, because that is the whole point of saving two.
  function startSession(session, blk) {
    const gyms = gymsOf(db);
    if (gyms.length > 1) {
      setPendingStart({ sessionId: session ? session.id : null, blockId: blk ? blk.id : null });
      return;
    }
    go('player', { sessionId: session ? session.id : null, blockId: blk ? blk.id : null });
  }
  // Looking is not starting. A tap on a day opens the plan; the button on that screen begins it.
  function previewSession(session, blk) {
    go('preview', { sessionId: session ? session.id : null, blockId: blk ? blk.id : null });
  }

  // Every Train screen sits in the app's standard page shell, the same one Today, Food and Progress
  // use: centred, 20px gutters, room at the bottom for the tab bar. Without it these screens ran
  // edge to edge while every other tab was inset, which is the kind of inconsistency you feel before
  // you can name it. The session player gets a tighter bottom pad because it hides the tab bar.
  const page = (node, focused) => (
    <div className={'max-w-md lg:max-w-2xl mx-auto px-5 pt-6 ' + (focused ? 'pb-6' : 'pb-36 lg:pb-12')}>{node}</div>
  );

  if (screen.name === 'player') {
    return page(<SessionPlayer db={db} update={update} showToast={showToast} onFocusMode={onFocusMode}
      sessionId={screen.sessionId} blockId={screen.blockId} freeform={screen.freeform}
      gym={currentGym(db)} onExit={() => go('home')} />, true);
  }
  if (screen.name === 'preview') {
    const blk = screen.blockId ? t.blocks.filter(b => b.id === screen.blockId)[0] : null;
    const sess = blk ? (blk.sessions || []).filter(s => s.id === screen.sessionId)[0] : null;
    if (!sess) return page(<TrainHome db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      block={block} onOpen={previewSession} go={go} />);
    return page(<SessionPreview db={db} update={update} showToast={showToast} session={sess} block={blk}
      onBack={() => go('home')} onStart={() => startSession(sess, blk)} />);
  }
  if (screen.name === 'builder') {
    return page(<BlockBuilder db={db} update={update} showToast={showToast} isPremium={isPremium}
      blockId={screen.blockId} draft={screen.draft} clearDraft={screen.clearDraft} onBack={() => go(screen.from || 'home')}
      onStart={screen.blockId ? startSession : null} />);
  }
  if (screen.name === 'wizard') {
    return page(<BlockWizard db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      initialUrl={screen.url}
      onBack={() => go(screen.from || 'home')}
      onDraft={(draft, opts) => go('builder', Object.assign({ draft: draft }, opts))} onShots={() => go('draft')} />);
  }
  if (screen.name === 'draft') {
    return page(<BlockDraft db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      onBack={() => go('home')} onImport={() => go('wizard', { from: 'draft' })}
      onBuild={(draft) => {
        // The draft's days become week 1 and the block is written on top, exactly as a single
        // build would be - nothing about a multi-source block is a different code path. It takes
        // the source as INSPIRATION, same as a single import now does: our progression and the
        // house intensity apply on top, at whatever shape and style the wizard was last set to,
        // rather than freezing the numbers a screenshot happened to show.
        const prefs = tdb(db).prefs || {};
        const block = Training.blockFromTemplate(draft.days, {
          weeks: 4, shape: prefs.shape || 'build4', intensity: prefs.intensity || 'high',
          targets: trainTargets(db), custom: tdb(db).custom,
          name: draft.name || 'My block', source: 'import', startISO: Store.todayISO(),
          sourceRef: { kind: 'draft', days: draft.days.length, importedISO: Store.todayISO() },
        });
        go('builder', { draft: block, clearDraft: true });
      }} />);
  }
  if (screen.name === 'rerun') {
    return page(<RerunScreen db={db} update={update} showToast={showToast} blockId={screen.blockId}
      onBack={() => go('review', { blockId: screen.blockId })}
      onDraft={(draft) => go('builder', { draft })} />);
  }
  if (screen.name === 'blocks') {
    return page(<BlockList db={db} update={update} showToast={showToast}
      onBack={() => go('home')} onOpen={(blockId) => go('builder', { blockId, from: 'blocks' })} onNew={() => go('wizard', { from: 'blocks' })}
      onCoverage={(blockId) => go('coverage', { blockId, from: 'blocks' })}
      onReview={(blockId) => go('review', { blockId, from: 'blocks' })}
      onStart={(blk) => {
        // Begin a block that was saved and never started. Whatever else was running steps aside, the
        // same way saving a brand-new one has always worked.
        trainUpdate(update, (tr) => {
          tr.blocks.forEach(b => { if (b.id !== blk.id && !b.archived) b.archived = true; });
          const i = tr.blocks.findIndex(b => b.id === blk.id);
          if (i >= 0) { tr.blocks[i] = Object.assign({}, tr.blocks[i], { archived: false, startISO: Store.todayISO() }); }
        });
        showToast && showToast('Started. First session is ready.');
        go('home');
      }} />);
  }
  if (screen.name === 'library') {
    return page(<BlockLibrary db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      onBack={() => go('home')} onAdopt={(block) => go('builder', { draft: block })} />);
  }
  if (screen.name === 'coverage') {
    return page(<CoverageScreen db={db} update={update} isPremium={isPremium} onUpgrade={onUpgrade}
      blockId={screen.blockId} onBack={() => go(screen.from || 'home')} />);
  }
  if (screen.name === 'review') {
    return page(<BlockReviewScreen db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      blockId={screen.blockId} onBack={() => go(screen.from || 'home')}
      onRerun={(blockId) => go('rerun', { blockId })}
      onNext={(draft) => go('builder', { draft })} />);
  }
  if (screen.name === 'history') {
    return page(<TrainHistory db={db} update={update} onBack={() => go('home')} onOpenExercise={(id) => go('exercise', { exerciseId: id })} />);
  }
  if (screen.name === 'exercise') {
    return page(<ExerciseDetail db={db} exerciseId={screen.exerciseId} onBack={() => go('history')} />);
  }
  if (screen.name === 'settings') {
    return page(<TrainSettings db={db} update={update} showToast={showToast} onBack={() => go('home')} onHowItWorks={() => go('how')} />);
  }
  if (screen.name === 'how') {
    return page(<HowItWorks onBack={() => go('settings')} />);
  }
  if (screen.name === 'stats') {
    return page(<StatSheet db={db} onBack={() => go('home')} />);
  }
  const homeScreen = page(<TrainHome db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
    block={block} onOpen={previewSession} go={go} />);
  return (
    <div>
      {homeScreen}
      {pendingStart && (
        <GymPicker db={db} update={update} onClose={() => setPendingStart(null)}
          onPicked={() => { const p = pendingStart; setPendingStart(null); go('player', p); }} />
      )}
    </div>
  );
}

// ---- home -------------------------------------------------------------------------------------
function TrainHome({ db, update, showToast, isPremium, onUpgrade, block, onOpen, go }) {
  const t = tdb(db);
  const today = Store.todayISO();
  const units = t.prefs.units;
  const targets = trainTargets(db);
  const prog = block ? Training.blockProgress(block, today) : null;
  const thisWeek = block && prog ? weekPlan(block, prog.week, t.logs) : [];
  const doneThisWeek = thisWeek.filter(x => x.log).length;
  // The next session is the first one this week without a log against it. Every OTHER session stays
  // tappable too: real weeks do not run in order, and an app that only lets you do "the next one"
  // makes you fight it the first time you swap legs to Thursday.
  const next = thisWeek.filter(x => !x.log)[0];
  // Coverage is deliberately NOT computed here any more. See the note further down: a volume gap is
  // a question for the build screens, and this one is about the week you are actually running.
  const blockDone = prog && prog.done;
  const isDeload = block && prog && Training.weekSessions(block, prog.week).some(s => s.deload);
  const lastLog = t.logs.slice().sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1))[0];
  const draftDays = ((t.draft && t.draft.days) || []).length;
  const [whyEmpty, setWhyEmpty] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState(false);

  return (
    <div className="fade-in">
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <div className="pf text-[9px] uppercase" style={{ color: 'var(--muted)' }}>
            {block && !blockDone ? 'Week ' + prog.week + ' of ' + block.weeks : 'Your training'}
          </div>
          <h1 className="pf text-xl mt-3">Train</h1>
        </div>
        <button onClick={() => go('settings')} aria-label="Training settings"
          className="pixel-box w-11 h-11 flex items-center justify-center shrink-0" style={{ background: 'var(--surface2)' }}>
          <Icon.sliders width="24" height="24" />
        </button>
      </div>

      {/* ---- the block ---- */}
      {block && !blockDone && (
        /* The block, as a titled panel: its name on the ink bar with the week's progress in accent
           beside it, which is the pair the design puts there and the two facts you open this page
           for. The name is still the way into the block itself (renaming it, deleting one built by
           mistake) - that is what the bar's right-hand tap-through leads to. */
        <Card className="p-0 mb-4 overflow-hidden">
          <CardHead title={block.name} right={doneThisWeek + ' / ' + thisWeek.length + ' done'} onRight={() => go('blocks')} />
          {/* The week, as a meter and one sentence, in its own band above the sessions. The card used
              to open straight onto the list, which answered "what are the days" but never "where am I
              in the week" - the question the page is actually opened to settle. */}
          <div className="px-3 py-3 flex flex-col gap-2" style={{ borderBottom: '2px solid var(--border)' }}>
            <PipLine pct={thisWeek.length ? (doneThisWeek / thisWeek.length) * 100 : 0} color="var(--accent)" height={11} cells={Math.max(1, thisWeek.length)} />
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {doneThisWeek >= thisWeek.length
                ? 'That is the whole week done.'
                : (thisWeek.length - doneThisWeek) + ' session' + (thisWeek.length - doneThisWeek === 1 ? '' : 's') + ' left this week' + (next ? '. ' + (next.dayLabel ? next.dayLabel + ' is ' : 'Next is ') + next.session.name.split(' - ')[0] + '.' : '.')}
            </span>
          </div>
          <div className="p-3.5">

          {isDeload && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--warn) 14%, var(--surface2))', color: 'var(--warn)' }}>
              Deload week. Lighter on purpose, so the next block starts on a fresh body.
            </div>
          )}

          {/* This week, as a list you can start any of. Each row says what it is, whether it is done,
              and roughly how long it will take, which is the question people actually ask before
              deciding whether tonight is a gym night. */}
          <div className="mb-4">
            {thisWeek.map(({ session, log }, i) => {
              const done = !!log;
              const isNext = next && session.id === next.session.id;
              const sets = (session.exercises || []).reduce((a, e) => a + (e.target.sets || 0), 0);
              const mins = sessionMins(session.exercises);
              return (
                <button key={session.id} onClick={() => onOpen(session, block)}
                  className="w-full flex items-center gap-3 py-3 text-left"
                  style={{ borderTop: i ? '2px solid var(--border)' : 'none' }}>
                  <span className="w-7 h-7 shrink-0 flex items-center justify-center text-[13px] font-bold pixel-box"
                    style={{ background: done ? 'var(--good)' : isNext ? 'var(--surface2)' : 'transparent', color: done ? '#05140a' : 'var(--muted2)', borderWidth: done || isNext ? undefined : 0 }}>
                    {done ? <Tick /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold truncate" style={{ color: done ? 'var(--muted)' : 'var(--text)' }}>{session.name}</span>
                    <span className="block text-[10.5px] tnum" style={{ color: 'var(--muted2)' }}>
                      {WEEKDAYS[session.dayOfWeek] || '?'} · {done ? (log.sets || []).filter(s => s.done).length + ' sets done' : sets + ' sets · about ' + mins + ' min'}
                    </span>
                  </span>
                  {isNext && <span className="pf text-[7px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>Next</span>}
                  <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
                </button>
              );
            })}
          </div>

          {next ? (
            /* Opens the plan; the Start on that screen begins the session. This button used to start
               it outright on the grounds that pressing "Start" is itself the confirmation, which is
               true but beside the point: the thing people do most often on this screen is check what
               tonight is, and there is now exactly one control in the app that begins a session. A
               session is not a page you visited, it is a timer and a log, and it should take saying
               so. The cost is one tap on the way in. */
            <>
              {/* The page's one primary action, so it wears the accent rather than a hardcoded white
                  slab - which was also the last control in Train that stayed daylight at night. */}
              <button onClick={() => onOpen(next.session, block)} className="pixel-btn w-full py-3.5 pf text-[12px] uppercase" style={{ background: 'var(--accent)', color: 'var(--on-accent)', letterSpacing: '0.06em' }}>
                <Icon.play width="16" /> Open {next.session.name.split(' - ')[0]}
              </button>
              {/* Naming it is the whole of the discoverability. Opening a day has always been how you
                  read it; that it is also how you CHANGE it is not something a chevron can say, and
                  the alternative was people starting a session they did not want to start in order
                  to swap one movement. */}
              <div className="text-[11px] text-center mt-3 leading-snug" style={{ color: 'var(--muted2)' }}>
                Open any day above to see it, swap a movement or move it to another day. None of that starts a session.
              </div>
            </>
          ) : (
            <div className="text-[12.5px] text-center py-3" style={{ color: 'var(--good)' }}>
              Week {prog.week} done. That is the whole week, in the bag.
            </div>
          )}
          </div>
        </Card>
      )}

      {block && blockDone && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--good) 12%, var(--surface2))' }}>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--good)' }}>Block finished</div>
          <div className="text-[15px] font-bold mb-1">{block.name}</div>
          <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
            All {block.weeks} weeks are behind you. See what moved, then build the next one on top of it.
          </div>
          <button onClick={() => go('review', { blockId: block.id })} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            See how it went
          </button>
        </Card>
      )}

      {!block && (
        <Card className="p-4 mb-4">
          {/* Every other empty state in this app has the buddy in it. This one used to be a heading
              and a definition, which is the tone of a manual rather than of the companion who is
              about to run the next four weeks with you. */}
          <div className="flex items-start gap-3 mb-4">
            <div className="pixel-box p-1 shrink-0" style={{ background: 'var(--surface3)', boxShadow: 'none', lineHeight: 0 }}>
              <BuddyAvatar buddy={db.buddy || {}} px={2} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-bold mb-1 leading-tight">
                {t.logs.length ? 'Nothing running right now' : 'Let us get you a block'}
              </div>
              <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
                {t.logs.length
                  ? 'Four weeks that build on each other and then back off, so you start the next one fresher than you finished this one. I will keep the numbers.'
                  : 'Four weeks that build on each other and then back off. Bring one you already follow, take one off the shelf, or I will write you one.'}
              </div>
            </div>
          </div>
          <button onClick={() => go('wizard')} className="pixel-btn w-full h-14 font-bold mb-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Build a 4-week block
          </button>
          <div className="flex gap-2 mb-2">
            <button onClick={() => go('library')} className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Browse blocks</button>
          </div>
          <button onClick={() => setWhyEmpty(true)} className="w-full py-2 text-[12px]" style={{ color: 'var(--accent-ink)' }}>
            Or start an empty session and log what you did
          </button>
        </Card>
      )}

      {/* ---- the gap used to shout from here, and it has been moved to where it can be acted on ----
              A volume gap is a question about what to BUILD. Once a block is running it is not a
              question any more: you chose this plan, and being told every time you open the tab that
              it is short on calves is nagging you about a decision already made. Worse since imports
              run as written, where the gap is the coach's deliberate choice and not an oversight.
              It lives on the draft screen while you are building, and behind Your blocks after, both
              of which are places you went looking for it. ---- */}

      {/* ---- last session, so the tab is never empty and progress is always in view ---- */}
      {lastLog && (
        /* LAST SESSION is a titled panel too, with WHEN on the bar in accent - the design puts the
           recency there because "yesterday" is the thing that makes the card worth a glance, and it
           frees the interior to carry the session and its numbers instead of a three-line stack. */
        <Card className="p-0 mb-4 overflow-hidden">
          <CardHead title="Last session" right={relativeDay(lastLog.dateISO, today)} onRight={() => go('history')} />
          {/* The design turns the session's numbers into three read-at-a-glance tiles rather than a
              run-on line of text, which is what makes this card scannable: you see 24 / 11.3T / 58M
              without parsing a sentence. Tonnage is abbreviated to tonnes so the figure stays short
              enough to sit under its own label. */}
          <button onClick={() => go('history')} className="w-full text-left px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3 mb-2.5">
              <span className="text-[15px] font-semibold truncate">{lastLog.name || 'Session'}</span>
              <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {(() => {
                const sets = (lastLog.sets || []).filter(s => s.done).length;
                const kg = toDisplayWeight(Training.tonnage(lastLog), units);
                const vol = kg >= 1000 ? (Math.round(kg / 100) / 10) + 'T' : Math.round(kg) + unitLabel(units);
                /* THREE tiles, always. The design's row is a fixed trio, and dropping Time when a
                   session has no recorded duration left a two-up grid whose cells were half as wide
                   again as every other card's - the row stopped looking like the same component. An
                   unrecorded duration shows a dash, which is the honest answer and keeps the shape. */
                const secs = lastLog.durationSec || lastLog.duration_sec || (lastLog.endedAt && lastLog.startedAt ? (lastLog.endedAt - lastLog.startedAt) / 1000 : 0);
                const mins = secs > 0 ? Math.round(secs / 60) + 'M' : '–';
                return [['Sets', sets], ['Volume', vol], ['Time', mins]].map(([l, v]) => (
                  <div key={l} className="flex flex-col items-center gap-1 py-2 px-1" style={{ background: 'var(--surface2)', border: '2px solid var(--border)' }}>
                    <span className="pf uppercase" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--muted)' }}>{l}</span>
                    <span className="pf tnum" style={{ fontSize: 15, color: 'var(--good-ink)' }}>{v}</span>
                  </div>
                ));
              })()}
            </div>
          </button>
        </Card>
      )}

      {/* ---- a draft in progress is a promise you made yourself, so it gets a real card ---- */}
      {draftDays > 0 && (
        <div className="pixel-box p-4 mb-4 flex items-center justify-between gap-2" style={{ background: 'color-mix(in srgb, var(--accent) 10%, var(--card))' }}>
          <button onClick={() => go('draft')} className="min-w-0 flex-1 text-left flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="pf text-[9px] uppercase block" style={{ color: 'var(--accent-ink)' }}>Draft block</span>
              <span className="block text-[13px] font-semibold mt-1 truncate">{(t.draft && t.draft.name) || 'My block'}</span>
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                {draftDays} {draftDays === 1 ? 'day' : 'days'} collected, ready when you are
              </span>
            </span>
            <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
          </button>
          {/* Binning a half-read import is at least as common as finishing one, so it does not need
              a trip inside the draft to find. */}
          <button onClick={() => setConfirmDraft(true)} aria-label="Delete draft block"
            className="hit shrink-0 px-2 py-2 text-[12px]" style={{ color: 'var(--danger)' }}>Delete</button>
        </div>
      )}

      {/* ---- where new blocks come from. One route in now: bringing a source (a reel, a PDF, a
              screenshot) and building from scratch are the same wizard, not a choice between two
              screens - the wizard itself asks whether you have something to bring. ---- */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button onClick={() => go('library')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
          Browse<br />blocks
        </button>
        <button onClick={() => go('wizard')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
          Build<br />a block
        </button>
      </div>

      {/* ---- secondary routes ----
              "Empty session" used to sit here as an equal to History and Stats, which oversold it.
              It is for the days that are not in the plan: a class, a holiday gym, a bit of arms on
              the way past. That is worth having and not worth advertising, so it lives with the
              block it is an exception to, and only shows once there is a block to be an exception
              to at all. ---- */}
      <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 py-2 pf text-[10px] uppercase" style={{ letterSpacing: '0.08em' }}>
        <button onClick={() => go('history')} style={{ color: 'var(--accent-ink)' }}>History</button>
        <span style={{ color: 'var(--muted2)' }}>·</span>
        <button onClick={() => go('stats')} style={{ color: 'var(--accent-ink)' }}>Stats</button>
        {/* The only route to a block that is not the one running: an archived one, a finished one, or
            one built by mistake that you want gone. */}
        {t.blocks.length > 0 && <span style={{ color: 'var(--muted2)' }}>·</span>}
        {t.blocks.length > 0 && (
          <button onClick={() => go('blocks')} style={{ color: 'var(--accent-ink)' }}>Your blocks</button>
        )}
        {block && !blockDone && <span style={{ color: 'var(--muted2)' }}>·</span>}
        {block && !blockDone && (
          <button onClick={() => setWhyEmpty(true)} style={{ color: 'var(--accent-ink)' }}>Empty session</button>
        )}
      </div>

      {/* Pricing copy, so it is for people who have not bought yet. A subscriber being told what is
          free and what is Premium is being sold something they already own. */}
      {!isPremium && t.logs.length === 0 && (
        <div className="text-[11px] leading-snug mt-4 text-center" style={{ color: 'var(--muted2)' }}>
          Logging is free and always will be. Building blocks for you, reading a gap and importing a plan are the Premium parts.
        </div>
      )}

      {confirmDraft && (
        <ConfirmDialog title="Throw this draft away?"
          body={'The ' + draftDays + (draftDays === 1 ? ' day' : ' days') + ' collected in it go. Anything you already built into a block stays.'}
          onConfirm={() => { trainUpdate(update, (tr) => { tr.draft = null; }); showToast && showToast('Draft thrown away.'); }}
          onClose={() => setConfirmDraft(false)} />
      )}
    </div>
  );
}

// "Yesterday" beats a date you have to work out. Past a week, the date is more useful than "9 days ago".
function relativeDay(iso, todayISO) {
  const d = daysBetween(iso, todayISO);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return d + ' days ago';
  // Past a week "9 days ago" stops meaning anything, but a raw 2026-08-02 is worse. A written date
  // is what people actually check against their own memory of the week.
  const dt = new Date(iso + 'T00:00:00Z');
  if (isNaN(dt.getTime())) return iso;
  return dt.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
}

// ---- the session player -----------------------------------------------------------------------
// The in-gym screen, rebuilt around one idea: you are looking at ONE exercise at a time.
//
// The first version was a long scroll of expanded cards. It worked, but a six-movement session was
// an enormous page with no sense of where you were in it, which is exactly the complaint every
// logging app eventually gets. The apps that feel good in a gym either keep rows very dense (Hevy)
// or focus one movement at a time (Gravl). We are a PLAN app, and a plan has an order, so focusing
// is the honest fit. The chip strip along the top is the safety valve: the rack being taken is not
// an edge case, so jumping around has to stay a single tap.
//
// Everything else here exists because it removes a real friction: set types so the volume maths is
// honest, supersets because most real programmes have them, a plate calculator so nobody does
// arithmetic under a loaded bar, warm-up suggestions, and a rest timer that behaves.
const SET_TYPES = [
  { v: 'work', label: '', full: 'Working set' },
  { v: 'warmup', label: 'W', full: 'Warm-up' },
  { v: 'drop', label: 'D', full: 'Drop set' },
  { v: 'failure', label: 'F', full: 'To failure' },
];
const SET_TYPE_TONE = { work: null, warmup: 'var(--warn)', drop: 'var(--carb-ink)', failure: 'var(--danger)' };

function SessionPlayer({ db, update, showToast, sessionId, blockId, freeform, onExit, onFocusMode, gym }) {
  const t = tdb(db);
  const today = Store.todayISO();
  const units = t.prefs.units;
  const block = blockId ? t.blocks.filter(b => b.id === blockId)[0] : null;
  const session = block && sessionId ? (block.sessions || []).filter(s => s.id === sessionId)[0] : null;

  const existing = t.logs.filter(l => l.dateISO === today && (sessionId ? l.sessionId === sessionId : !l.sessionId))[0];
  const [logId] = useState(() => (existing ? existing.id : trainUid()));
  const [items, setItems] = useState(() => {
    if (existing) {
      // Reopening a session you already started. Two things used to go missing here, and both of
      // them read as "the app lost my plan".
      //
      // The target was set to null outright, so every header fell back to its "- reps" placeholder
      // and the RIR vanished: the prescription disappeared the moment you came back to the session.
      // The plan is still on the block, so it is read back off it rather than stored twice.
      //
      // And sets were regrouped by EXERCISE, so a day that programmes the same movement twice (a
      // heavy T-bar row and a back-off T-bar row is the ordinary case) came back as one merged
      // movement with both sets under it and one of the two prescriptions gone. Logs written from
      // now on carry the item they belong to; older ones fall back to the old grouping, which is
      // exactly as right as it ever was.
      const order = [], byKey = {};
      (existing.sets || []).forEach(s => {
        const key = s.itemId || s.exerciseId;
        if (!byKey[key]) { byKey[key] = { exerciseId: s.exerciseId, itemId: s.itemId || null, sets: [] }; order.push(key); }
        byKey[key].sets.push(Object.assign({}, s));
      });
      const planned = (session && session.exercises) || [];
      const used = {};
      return order.map(key => {
        const g = byKey[key];
        // Match the logged group back to its line in the plan: by item id when the log has one, and
        // otherwise by the first unused line for that movement, so two T-bar rows take one each
        // rather than both claiming the first.
        let e = g.itemId ? planned.filter(x => x.id === g.itemId)[0] : null;
        if (!e) e = planned.filter(x => x.exerciseId === g.exerciseId && !used[x.id])[0];
        if (e) used[e.id] = 1;
        const saved = (existing.itemTargets || {})[g.itemId] || null;
        return {
          id: (e && e.id) || g.itemId || null,
          exerciseId: g.exerciseId,
          // The plan first, because that is the live prescription and it may have been edited since.
          // What was saved with the session covers what the plan cannot: a movement added on the day,
          // and a freeform session, which has no plan behind it at all.
          target: (e && e.target) || saved,
          sets: g.sets, note: null,
          superset: (e && e.supersetGroup) || null,
        };
      });
    }
    if (!session) return [];
    return (session.exercises || []).slice().sort((a, b) => a.order - b.order).map(e => {
      const pre = Training.prefillSets(e, t.logs, t.custom);
      return { id: e.id || null, exerciseId: e.exerciseId, target: e.target, sets: pre.sets, note: coachNote(pre), superset: e.supersetGroup || null };
    });
  });
  const [focus, setFocus] = useState(0);
  const [picking, setPicking] = useState(false);
  const [swapping, setSwapping] = useState(null);
  const [swapScope, setSwapScope] = useState(null);   // a swap that could apply to the rest of the block
  const [menuOpen, setMenuOpen] = useState(null);  // index of the exercise whose options are open
  const [help, setHelp] = useState(null);          // which "?" explainer is open
  const [pastFor, setPastFor] = useState(null);    // exercise id whose history sheet is open
  const [noteOpen, setNoteOpen] = useState(null);  // exercise id whose note field is open
  const [setMenu, setSetMenu] = useState(null);    // "ii:si" of the set whose type/remove menu is open
  const [justDone, setJustDone] = useState(null);  // "ii:si" of the tick that was just pressed, for the pop
  const [lift, setLift] = useState({ ii: -1, n: 0 });  // bumped on each tick, so the buddy does the rep too
  const [pr, setPr] = useState(null);              // a record just set, showing its celebration
  const [plateFor, setPlateFor] = useState(null);  // "exerciseIndex:setIndex" whose plate breakdown is open
  const [rest, setRest] = useState(null);
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState(existing ? existing.notes || '' : '');
  const [exNotes, setExNotes] = useState(() => (existing && existing.exerciseNotes) || {});
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sessionMenu, setSessionMenu] = useState(false);  // the header's MORE, for the whole session
  const [targetFor, setTargetFor] = useState(null); // index of the movement whose prescription is open
  const [signOff, setSignOff] = useState(null);    // the buddy's send-off, once the session is saved
  const [startedAt] = useState(() => (existing && existing.startedAt ? Date.parse(existing.startedAt) : Date.now()));
  // Anything in today's plan that the gym you are standing in has not got. Computed once, on open,
  // because it is a question about the room you walked into rather than about the plan.
  const [unavailable, setUnavailable] = useState(() => (existing ? [] : missingHere(items, gym, t.custom)));
  // How the night went, from the sleep and recovery the app already syncs. Only offered on a fresh
  // session: coming back to one you started half an hour ago and being asked about your sleep would
  // be daft.
  const [readiness] = useState(() => {
    if (existing || !session) return null;
    try { const r = readinessFor(db, today); return isFinite(r) ? Math.round(r) : null; } catch (_) { return null; }
  });
  const [adjust, setAdjust] = useState(() => {
    if (existing || !session) return null;
    try {
      const r = readinessFor(db, today);
      if (!isFinite(r)) return null;
      const a = Training.readinessAdjust(session, Math.round(r), { custom: t.custom });
      return a.action === 'none' ? null : a;
    } catch (_) { return null; }
  });
  useBackClose(onExit);

  useEffect(() => {
    if (!onFocusMode) return;
    onFocusMode(true);
    return () => onFocusMode(false);
  }, []);
  useEffect(() => { const h = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(h); }, []);

  const restLeft = rest ? Math.max(0, Math.ceil((rest.endsAt - Date.now()) / 1000)) : 0;
  // Fire once, on the tick the timer runs out. `rest.alerted` is the latch: without it every
  // re-render during the zero second would buzz again.
  useEffect(() => {
    if (!rest || restLeft > 0 || rest.alerted) return;
    setRest(r => (r ? Object.assign({}, r, { alerted: true }) : r));
    restAlert(t.prefs);
    const h = setTimeout(() => setRest(null), 2500);
    return () => clearTimeout(h);
  }, [restLeft, rest]);

  function persist(nextItems, nextNotes, nextExNotes) {
    const flat = [];
    (nextItems || items).forEach(it => {
      it.sets.forEach((s, i) => {
        flat.push({
          // itemId says WHICH line of the plan this set belongs to, which exerciseId cannot when a
          // day programmes the same movement twice. Everything downstream still reads exerciseId, so
          // this is additive: history, tonnage and PRs are untouched.
          exerciseId: it.exerciseId, itemId: it.id || null, setIndex: i, type: s.type || 'work',
          weightKg: +s.weightKg || 0, reps: s.reps == null ? null : +s.reps,
          rir: s.rir == null ? null : +s.rir, done: !!s.done,
        });
      });
    });
    // One prescription per MOVEMENT, not per set: a handful of small objects against a session,
    // against the hundreds of set rows it already writes. It is what lets a movement added or swapped
    // mid-session still know what it was asked for when you come back to it, and it covers a freeform
    // session, which has no plan behind it to read from at all.
    const itemTargets = {};
    (nextItems || items).forEach(it => { if (it.id && it.target) itemTargets[it.id] = it.target; });
    trainUpdate(update, (tr) => {
      const i = tr.logs.findIndex(l => l.id === logId);
      const row = {
        id: logId, dateISO: today, blockId: blockId || null, sessionId: sessionId || null,
        name: session ? session.name : 'Empty session',
        startedAt: (i >= 0 && tr.logs[i].startedAt) || new Date(startedAt).toISOString(),
        notes: nextNotes == null ? notes : nextNotes,
        exerciseNotes: nextExNotes || exNotes,
        itemTargets: itemTargets,
        sets: flat,
      };
      if (i >= 0) tr.logs[i] = Object.assign({}, tr.logs[i], row); else tr.logs.push(row);
    });
  }
  function mutate(fn) {
    setItems(prev => {
      // id travels with the item: it is what ties a logged set back to its line in the plan, and it
      // is rebuilt from scratch here on every edit, so leaving it out loses it on the first tap.
      const next = prev.map(it => ({ id: it.id || null, exerciseId: it.exerciseId, target: it.target, note: it.note, superset: it.superset, sets: it.sets.map(s => Object.assign({}, s)) }));
      fn(next);
      persist(next);
      return next;
    });
  }
  function setField(ii, si, key, value) { mutate(n => { n[ii].sets[si][key] = value; }); }
  function cycleType(ii, si) {
    mutate(n => {
      const cur = n[ii].sets[si].type || 'work';
      const i = SET_TYPES.findIndex(x => x.v === cur);
      n[ii].sets[si].type = SET_TYPES[(i + 1) % SET_TYPES.length].v;
    });
  }

  function toggleDone(ii, si) {
    const row = items[ii].sets[si];
    const wasDone = row.done;
    // Work out what the set WILL be before mutating, not after. `mutate` goes through a setState
    // updater, which React runs when it schedules the re-render rather than inline, so anything read
    // back straight afterwards is the old value. That is why the record check silently never fired.
    const tgt = items[ii].target;
    const filled = {
      weightKg: +row.weightKg || 0,
      reps: (row.reps == null || row.reps === '')
        ? (tgt ? tgt.repHigh : (row.lastTime ? row.lastTime.reps : null))
        : +row.reps,
    };
    mutate(n => {
      const s = n[ii].sets[si];
      s.done = !s.done;
      if (s.done && (s.reps == null || s.reps === '')) s.reps = filled.reps;
    });
    if (wasDone) return;   // un-ticking should never start a rest, or claim a record

    // The buzz is the point. Phone on the bench, chalky hands, eyes anywhere but the screen: a short
    // vibration confirms the tap without you having to look back down and check.
    try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
    setJustDone(ii + ':' + si);
    setTimeout(() => setJustDone(j => (j === ii + ':' + si ? null : j)), 220);
    // Your buddy does the rep with you. Driven off the tick rather than a timer, so it moves when
    // you move and stays still when you do.
    setLift(l => ({ ii, n: (l.ii === ii ? l.n : 0) + 1 }));

    // A record, worked out against everything before today plus the earlier sets of this session.
    // Warm-ups and drop sets are excluded, so a light back-off set cannot claim one.
    const setType = items[ii].sets[si].type || 'work';
    if (setType === 'work' && filled && filled.reps > 0 && filled.weightKg > 0) {
      const best = Training.bestBefore(t.logs, items[ii].exerciseId, today, logId);
      items[ii].sets.forEach((prev, pi) => {
        if (pi >= si || !prev.done || (prev.type || 'work') !== 'work') return;
        const pe = Training.e1rm(prev.weightKg, prev.reps);
        if (pe > best.e1rm) best.e1rm = pe;
        if ((+prev.weightKg || 0) > best.weightKg) { best.weightKg = +prev.weightKg || 0; best.repsAtBest = +prev.reps || 0; }
        else if (Math.abs((+prev.weightKg || 0) - best.weightKg) < 0.01 && (+prev.reps || 0) > best.repsAtBest) best.repsAtBest = +prev.reps || 0;
      });
      const hit = Training.prKind(filled.weightKg, filled.reps, best);
      if (hit) {
        try { if (navigator.vibrate) navigator.vibrate([30, 50, 30, 50, 90]); } catch (_) {}
        prFanfare(t.prefs);
        setPr({ exerciseId: items[ii].exerciseId, weightKg: filled.weightKg, reps: filled.reps, kind: hit.kind, label: hit.label });
      }
    }

    const it = items[ii];
    const type = it.sets[si].type || 'work';
    const nextType = it.sets[si + 1] && it.sets[si + 1].type;
    // A drop set is defined by NOT resting into it, and the same goes for the next leg of a
    // superset. Starting a countdown there would be telling the user to do the opposite of the
    // technique they just chose.
    const skipRest = type === 'drop' || nextType === 'drop' || (it.superset && items.some(x => x !== it && x.superset === it.superset));
    if (t.prefs.restTimer && !skipRest) {
      const secs = (it.target && it.target.restSec) || 120;
      // What the rest is FOR. A bare countdown tells you when to move but not what to move to, and
      // the answer is not si + 1: rows get ticked in any order, so the next set is the first one
      // still unlogged. When there is none left, the movement is done and saying so is the point.
      const workRows = it.sets.map((s, i) => ({ s: s, i: i })).filter(x => (x.s.type || 'work') !== 'warmup');
      const nextPos = workRows.findIndex(x => x.i !== si && !x.s.done);
      setRest({
        endsAt: Date.now() + secs * 1000, seconds: secs, alerted: false,
        from: nextPos < 0 ? null : codes[ii] + ' · set ' + (nextPos + 1) + ' of ' + workRows.length,
      });
    }
    // Finishing an exercise moves you on, because otherwise you are looking at a card of ticks.
    const allDone = it.sets.every((s, i) => (i === si ? true : s.done));
    if (allDone) {
      // A distinct double-buzz for finishing a movement, against the single tap for a set. Two
      // different events should never feel like the same event through a pocket, and this is the one
      // that means "that is the last of those, the card is about to change under you".
      try { if (navigator.vibrate) navigator.vibrate([14, 60, 22]); } catch (_) {}
    }
    if (allDone && ii === focus && ii < items.length - 1) {
      setTimeout(() => setFocus(f => (f === ii ? ii + 1 : f)), 450);
    }
  }
  function addSet(ii) {
    mutate(n => {
      const list = n[ii].sets;
      const last = list.filter(s => (s.type || 'work') === 'work').slice(-1)[0] || list[list.length - 1];
      list.push(Object.assign({}, last || { type: 'work' }, { done: false, reps: null, type: 'work', setIndex: list.length }));
    });
  }
  function removeSet(ii, si) { mutate(n => { n[ii].sets.splice(si, 1); }); }
  function addWarmups(ii) {
    mutate(n => {
      const it = n[ii];
      const work = it.sets.filter(s => (s.type || 'work') === 'work')[0];
      const ups = Training.warmupSets((work && work.weightKg) || 0, Training.byId(it.exerciseId, t.custom));
      const rows = ups.map((u, i) => ({ setIndex: i, exerciseId: it.exerciseId, type: 'warmup', weightKg: u.weightKg, reps: null, targetReps: String(u.reps), rir: null, done: false, lastTime: null }));
      it.sets = rows.concat(it.sets.filter(s => (s.type || 'work') !== 'warmup'));
    });
  }
  function addExercise(exId) {
    setPicking(false);
    mutate(n => {
      const pre = Training.prefillSets({ exerciseId: exId, target: { sets: 2, repLow: 8, repHigh: 12 } }, t.logs, t.custom);
      // Added mid-session, so it has no line in the plan to point back to. It gets its own id so
      // its sets still group as one movement when the session is reopened.
      n.push({ id: 'add_' + trainUid(), exerciseId: exId, target: { sets: 2, repLow: 8, repHigh: 12, rir: 2, restSec: 120 }, sets: pre.sets, note: coachNote(pre), superset: null });
    });
    setFocus(items.length);
  }
  function removeExercise(ii) {
    mutate(n => { n.splice(ii, 1); });
    setFocus(f => Math.max(0, Math.min(f, items.length - 2)));
  }
  function swapExercise(ii, exId) {
    const wasId = items[ii] && items[ii].exerciseId;
    mutate(n => {
      const old = n[ii];
      const pre = Training.prefillSets({ exerciseId: exId, target: old.target || { sets: old.sets.length, repLow: 8, repHigh: 12 } }, t.logs, t.custom);
      n[ii] = { id: old.id || ('swap_' + trainUid()), exerciseId: exId, target: old.target, sets: pre.sets, note: coachNote(pre), superset: old.superset };
    });
    // Today is changed. Whether the BLOCK should change is a different question, and only the person
    // knows the answer: a machine being busy is today, a grip that suits you better is the rest of
    // the block. Asked only when there is something to ask about, which is when the movement we just
    // replaced actually appears in sessions still to come.
    if (!block || !session || !wasId || wasId === exId) return;
    const reach = Training.swapReach(block, wasId, session.week);
    if (reach > 1) setSwapScope({ from: wasId, to: exId, week: session.week, reach: reach });
  }
  function move(ii, delta) {
    const to = ii + delta;
    if (to < 0 || to >= items.length) return;
    mutate(n => { const [row] = n.splice(ii, 1); n.splice(to, 0, row); });
    setFocus(to);
  }
  // Pair with the next movement. Supersets are almost always adjacent, so "make a superset" needing
  // a multi-select picker would be ceremony for nothing.
  function toggleSuperset(ii) {
    mutate(n => {
      if (n[ii].superset) {
        const g = n[ii].superset;
        n.forEach(x => { if (x.superset === g) x.superset = null; });
      } else if (n[ii + 1]) {
        const g = 'ss' + Date.now().toString(36);
        n[ii].superset = g; n[ii + 1].superset = g;
      }
    });
  }
  function setExNote(id, v) {
    const next = Object.assign({}, exNotes, { [id]: v });
    setExNotes(next);
    persist(null, null, next);
  }

  // Everything the sign-off needs about the session that has just ended, gathered BEFORE the write
  // so it reads the same list the screen was showing. Facts only; Game.sessionPraise decides which
  // of them is worth leading with.
  function signOffFacts() {
    const work = it => it.sets.filter(s => s.done && (s.type || 'work') !== 'warmup');
    const doneSets = items.reduce((a, it) => a + work(it).length, 0);
    const log = { id: logId, dateISO: today, sets: items.reduce((a, it) => a.concat(it.sets.filter(s => s.done).map(s => Object.assign({}, s, { exerciseId: it.exerciseId }))), []) };
    // Previous sessions only: prsInLog already excludes this log by id, and the averages must not be
    // dragged toward the session they are being compared against.
    const prior = t.logs.filter(l => l.id !== logId);
    const prs = doneSets ? Training.prsInLog(prior, log) : [];
    const priorTon = prior.map(l => Training.tonnage(l)).filter(v => v > 0);
    // Where today sits in the block's week, counting this session, so "that is the week done" can
    // only fire on the session that actually closed it.
    let weekDone = 0, weekOf = 0, finishedBlock = false;
    if (block) {
      const prog = Training.blockProgress(block, today);
      const wk = Training.weekSessions(block, prog.week);
      const loggedIds = {};
      prior.forEach(l => { if (l.sessionId) loggedIds[l.sessionId] = 1; });
      if (sessionId) loggedIds[sessionId] = 1;
      weekOf = wk.length;
      weekDone = wk.filter(s => loggedIds[s.id]).length;
      finishedBlock = (block.sessions || []).every(s => loggedIds[s.id]);
    }
    return {
      sets: doneSets,
      prs: prs.length,
      first: prior.length === 0,
      minutes: Math.max(1, Math.round((Date.now() - startedAt) / 60000)),
      tonnageKg: Training.tonnage(log),
      avgTonnageKg: priorTon.length >= 3 ? priorTon.slice(-8).reduce((a, b) => a + b, 0) / Math.min(8, priorTon.length) : 0,
      weekDone, weekOf, blockFinished: finishedBlock,
      sessionsLast7: prior.filter(l => daysBetween(l.dateISO, today) < 7).length + 1,
      name: (session && session.name) || 'Session',
      blockName: block ? block.name : null,
      // The receipt. The send-off used to be praise and three numbers, which is a lovely moment and
      // no record of what just happened: you closed it and the only way to see what you had actually
      // lifted was to go and find the session in History.
      movementsDone: items.filter(it => it.sets.some(s => s.done && (s.type || 'work') !== 'warmup')).length,
      movementsTotal: items.length,
      prList: prs.slice(0, 3).map(p => ({
        name: (Training.byId(p.exerciseId, t.custom) || {}).name || p.exerciseId,
        label: p.label,
      })),
      movements: items.map((it, ii) => {
        const logged = it.sets.filter(s => s.done && (s.type || 'work') !== 'warmup');
        return {
          name: codes[ii] + ' · ' + ((Training.byId(it.exerciseId, t.custom) || {}).name || it.exerciseId),
          detail: logged.length
            ? logged.map(s => (s.weightKg > 0 ? toDisplayWeight(s.weightKg, units) + unitLabel(units) : 'BW') + ' × ' + (s.reps == null ? '–' : s.reps)).join(' · ')
            : 'not logged',
          logged: logged.length > 0,
        };
      }),
    };
  }

  function finish() {
    const facts = signOffFacts();
    trainUpdate(update, (tr, d) => {
      const i = tr.logs.findIndex(l => l.id === logId);
      if (i >= 0) {
        tr.logs[i].endedAt = new Date().toISOString();
        tr.logs[i].sets = (tr.logs[i].sets || []).filter(s => s.done);
        // Nothing ticked, so nothing to keep. Tombstoned, not just spliced: the sync unions training
        // logs by id, so a row merely removed from this copy is handed straight back by the other one
        // and the session returns looking like one you had started.
        if (!tr.logs[i].sets.length) { tr.logs.splice(i, 1); tombstone(d, [logId]); }
      }
    });
    // An empty session leaves as quietly as it arrived. A real one gets its moment: the buddy, the
    // numbers, and a line about what actually happened, rather than a toast sliding past the button
    // you have just pressed.
    if (!facts.sets) { showToast && showToast('Nothing logged, so nothing saved.'); onExit(); return; }
    setSignOff(facts);
  }

  const totalSets = items.reduce((a, it) => a + it.sets.filter(s => (s.type || 'work') !== 'warmup').length, 0);
  const doneSets = items.reduce((a, it) => a + it.sets.filter(s => s.done && (s.type || 'work') !== 'warmup').length, 0);
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const allWorkDone = totalSets > 0 && doneSets === totalSets;
  const codes = Training.sessionCodes(items);

  return (
    // Finish rides at the end of the list now, so the only thing to clear is the rest bar, and only
    // while it is up. Nothing is pinned over the session otherwise.
    <div className="fade-in" style={{ paddingBottom: rest ? '132px' : '24px' }}>
      {/* ---- SESSION BAR, per `Session.dc.html` ----
          A live session is the one screen in the app that owns the phone for an hour, and the design
          gives it its own chrome to say so: the header's purple, the session's name, the clock in
          gold, and the whole session's progress drawn across the full width underneath with the two
          counts that matter hanging off its ends. On the paper background this was a back link, a
          title and a hairline, which read as a page heading rather than as an instrument you are
          mid-way through. */}
      <div className="sticky top-0 z-20 -mx-5 border-b-[3px]" style={{ background: 'var(--header)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 px-3 pt-2 pb-2">
          <button onClick={onExit} aria-label="Back to Train" className="hit shrink-0 flex items-center" style={{ color: 'var(--nav-off)' }}>
            <Icon.chevron width="16" height="16" style={{ transform: 'rotate(180deg)' }} />
          </button>
          {/* Your buddy is in the room with you for the whole hour, not only on the movement you have
              open. It is the same idle strip the header uses everywhere else, so it costs no new art. */}
          <SessionBuddy db={db} pattern={items[focus] && (Training.byId(items[focus].exerciseId, t.custom) || {}).pattern} trigger={lift.n} />
          <div className="flex-1 min-w-0">
            <div className="pf text-[9.5px] uppercase truncate" style={{ color: 'var(--header-text)', letterSpacing: '0.09em' }}>
              {session ? session.name : 'Empty session'}{session && session.week ? ' · Week ' + session.week : ''}
            </div>
            <div className="pf text-[7.5px] uppercase tnum mt-1" style={{ color: 'var(--on-header-accent)', letterSpacing: '0.11em' }}>{fmtClock(elapsed)} elapsed</div>
          </div>
          <button onClick={() => setSessionMenu(true)} aria-label="Session options"
            className="pf text-[7.5px] uppercase shrink-0 px-2.5"
            style={{ minHeight: 38, background: 'var(--cardhead-bg)', border: '2px solid var(--border)', color: 'var(--header-text)', letterSpacing: '0.1em' }}>More</button>
        </div>
        {/* ---- the spine, per `Session in progress.dc.html` ----
            Orientation without a word: one pip per working set, grouped by movement, so the shape of
            the whole session and where you are inside it are the same picture. The bar it replaces
            was 24 identical segments that knew nothing about movements, so a session with three sets
            left in the last exercise looked the same as one with three left spread across three.
            Deliberately not tappable: the movement headers are the navigation, and two ways to jump
            around was the confusion this screen already had. */}
        <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--card)', borderTop: '3px solid var(--border)' }}>
          <div className="flex gap-[5px] flex-1 min-w-0" aria-hidden="true">
            {items.map((it, ii) => {
              const w = it.sets.filter(s => (s.type || 'work') !== 'warmup');
              if (!w.length) return null;
              return (
                <div key={ii} className="flex gap-[2px]" style={{ flex: w.length }}>
                  {w.map((s, si) => (
                    <i key={si} className="flex-1" style={{
                      height: 10, border: '2px solid var(--border)', transition: 'background .18s',
                      background: s.done ? 'var(--good)' : (ii === focus ? 'var(--accent)' : 'var(--track)'),
                    }} />
                  ))}
                </div>
              );
            })}
          </div>
          <span className="text-[10.5px] tnum shrink-0" style={{ color: 'var(--muted)' }}>{doneSets} / {totalSets} sets</span>
        </div>
      </div>

      {/* Train the day you are actually having. The autoregulation literature is consistent that
          adjusting to how recovered someone is beats running the written plan into the ground, and
          that the useful adjustment is a small one. Almost nobody can do this because it needs to
          know how you slept, and we already sync that for the buddy.
          Always an offer: someone who slept badly and wants to train anyway is allowed to. */}
      {adjust && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--sleep) 14%, var(--surface2))' }}>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--sleep)' }}>
            Readiness {readiness}
          </div>
          <div className="text-[12.5px] mb-4 leading-snug">{adjust.text}</div>
          <div className="flex gap-2">
            <button onClick={() => setAdjust(null)} className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>
              Run it as written
            </button>
            <button onClick={() => {
              mutate(n => {
                (adjust.drop || []).slice().sort((a, b) => b.index - a.index).forEach(d => { n.splice(d.index, 1); });
                if (adjust.rirDelta) n.forEach(it => { if (it.target) it.target = Object.assign({}, it.target, { rir: Math.min(5, (it.target.rir || 2) + adjust.rirDelta) }); });
              });
              showToast && showToast(adjust.action === 'trim' ? 'Trimmed for today.' : 'Eased off for today.');
              setAdjust(null);
            }} className="pixel-btn flex-1 h-11 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
              {adjust.action === 'trim' ? 'Trim it' : 'Ease off'}
            </button>
          </div>
        </Card>
      )}

      {/* The rack is taken, or you are at the hotel gym. Offer the fix rather than making someone
          swap five movements by hand before they can start. */}
      {unavailable.length > 0 && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' }}>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--warn)' }}>Not at {gym ? gym.name : 'this gym'}</div>
          <div className="text-[12.5px] mb-4 leading-snug">
            {unavailable.map(u => (Training.byId(u.exerciseId, t.custom) || {}).name).filter(Boolean).join(', ')}
            {unavailable.length === 1 ? ' is not something you can do here.' : ' are not things you can do here.'}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setUnavailable([])} className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Leave them</button>
            <button onClick={() => {
              mutate(n => {
                unavailable.forEach(u => {
                  if (!u.alt) return;
                  const old2 = n[u.index];
                  if (!old2) return;
                  const pre = Training.prefillSets({ exerciseId: u.alt, target: old2.target || { sets: 2, repLow: 8, repHigh: 12 } }, t.logs, t.custom);
                  n[u.index] = { id: old2.id || ('swap_' + trainUid()), exerciseId: u.alt, target: old2.target, sets: pre.sets, note: coachNote(pre), superset: old2.superset };
                });
              });
              showToast && showToast('Swapped for what is here.');
              setUnavailable([]);
            }} className="pixel-btn flex-1 h-11 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Swap them</button>
          </div>
        </Card>
      )}

      {session && session.deload && (
        <div className="text-[11px] mb-4 px-3 py-2" style={{ background: 'color-mix(in srgb, var(--warn) 14%, var(--surface2))', color: 'var(--warn)' }}>
          Deload week. Keep the weight honest, halve the work, leave plenty in the tank.
        </div>
      )}

      {items.length === 0 && (
        <Card className="p-4 mb-4 mt-2">
          <div className="text-[13px] mb-1">Nothing in this session yet.</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>Add the first movement. Next time it comes back with your weights already in.</div>
        </Card>
      )}

      {/* ---- the session, as an accordion ----
          Every movement stays on screen as a header, so the shape of the session is always visible
          and jumping to any of it is one tap. Only the one you are working on is open. The letter
          codes down the left are how a coach writes a programme: A1 and A2 are done back to back,
          A then B then C is the order. It tells you where you are without a word of explanation. */}
      {items.map((it, ii) => {
        const ex = Training.byId(it.exerciseId, t.custom);
        const tgt = it.target;
        const open = ii === focus;
        const work = it.sets.filter(s => (s.type || 'work') !== 'warmup');
        const done = work.length > 0 && work.every(s => s.done);
        const warmups = it.sets.filter(s => (s.type || 'work') === 'warmup');
        const hist = Training.exerciseHistory(t.logs, it.exerciseId);
        return (
          <div key={it.exerciseId + '_' + ii} className="pixel-box mb-4" style={{ background: 'var(--card)' }}>
            {/* ---- header, always visible ----
                The movement you are ON gets the design's filled ink title bar, the same object every
                panel in this design opens with. The others stay as light rows. That one difference
                is what says "this is the exercise you are doing"; before, six identical cream cards
                said it with nothing but a chevron rotation. */}
            <button onClick={() => { setFocus(open ? -1 : ii); setPlateFor(null); setMenuOpen(false); }}
              className={'w-full flex items-center gap-2.5 text-left ' + (open ? 'px-2.5 py-2' : 'p-3')}
              style={open ? { background: 'var(--cardhead-bg)', borderBottom: '2px solid var(--border)' } : null}>
              <span className="pf text-[10px] shrink-0 flex items-center justify-center"
                style={open
                  ? { color: 'var(--accent)' }
                  : { width: 30, height: 30, border: '2px solid var(--border)', background: done ? 'var(--good)' : 'var(--card)', color: done ? '#fff' : 'var(--accent-ink)' }}>{codes[ii]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold leading-tight" style={{ color: open ? 'var(--cardhead-text)' : done ? 'var(--muted)' : 'var(--text)' }}>
                  {ex ? ex.name : it.exerciseId}
                </span>
                {/* The subtitle answers a different question in each of the three states, which is
                    what makes the closed rows worth reading at all. Open: which set you are on.
                    Finished: what you actually put in, so a scan down the card stack is a receipt.
                    Ahead of you: what you are being asked for. It used to say the prescription in
                    every state, so a movement you had already done still read as work outstanding. */}
                <span className="block pf text-[8px] uppercase mt-1.5" style={{
                  color: open ? 'var(--nav-off)' : done ? 'var(--good-ink)' : 'var(--accent-ink)', letterSpacing: '0.1em',
                }}>
                  {open
                    ? 'Set ' + Math.min(work.length, (work.findIndex(s => !s.done) + 1) || work.length) + ' of ' + work.length
                    : done
                      ? work.length + ' x ' + (work[0] && work[0].weightKg > 0 ? toDisplayWeight(work[0].weightKg, units) + unitLabel(units) : 'BW') + ' logged'
                      : work.length + ' x ' + (tgt ? tgt.repLow + '-' + tgt.repHigh : '–') + (tgt ? ' at ' + tgt.rir + ' RIR' : ' reps')}
                </span>
              </span>
              {open
                ? <span className="shrink-0" style={{ color: 'var(--cardhead-text)' }}><Icon.chevron width="16" height="16" style={{ transform: 'rotate(90deg)' }} /></span>
                : done
                  ? <span className="shrink-0 w-6 h-6 flex items-center justify-center" style={{ background: 'var(--good)', color: '#fff' }}><Tick size={12} /></span>
                  : <span className="shrink-0" style={{ color: 'var(--muted2)' }}><Icon.chevron width="16" height="16" /></span>}
            </button>

            {open && (
              <div className="px-3 pb-3 pt-3">
                {/* ---- the prescription, with the jargon explained where it appears.
                     The design sets the cues as framed chips on the left and what you owe as plain
                     text on the right, so the whole prescription is one line instead of three. ---- */}
                <div className="flex items-center gap-2 mb-4">
                  {tgt && <MetaBit label={tgt.rir + ' RIR'} onHelp={() => setHelp('rir')} hideHelp={t.prefs.hideHelp} />}
                  {tgt && tgt.tempo && <MetaBit label={tgt.tempo} onHelp={() => setHelp('tempo:' + tgt.tempo)} hideHelp={t.prefs.hideHelp} />}
                  {tgt && <MetaBit label={fmtRest(tgt.restSec || 120)} onHelp={() => setHelp('rest')} muted hideHelp={t.prefs.hideHelp} />}
                  {/* The buddy used to stand at the end of this row, where three cues plus the
                      prescription plus a 36px sprite did not fit a 375px card and it hung over the
                      border. It lives in the header now, where it is on screen for the whole session
                      instead of only for whichever movement happens to be open. */}
                  <span className="ml-auto shrink-0 text-[11.5px] text-right" style={{ color: 'var(--muted)' }}>
                    {work.length} {work.length === 1 ? 'set' : 'sets'} · {tgt ? tgt.repLow + '–' + tgt.repHigh : '–'} reps
                  </span>
                </div>

                {it.note && <div className="text-[11.5px] mb-2 leading-snug" style={{ color: 'var(--accent-ink)' }}>{it.note}</div>}

                {/* ---- what you did last time, ABOVE the table ----
                    It used to sit under the set rows, which is the one place it is no use: you type
                    into the first row, and the thing you are trying to beat was below the fold. And
                    it showed a single set, so "30kg x 9, 30kg x 9, 27.5kg x 8", the shape of the
                    session and the drop-off on the last one and the whole reason to look, came back as
                    "30kg x 9". Still only a reference line and never a number in the box: we ask for
                    an effort, and what that costs in kilos is the lifter's call on the day. */}
                {(() => {
                  const lts = it.sets.map(x => x.lastTime).filter(Boolean);
                  if (lts.length) {
                    return (
                      <div className="text-[11.5px] mb-2 leading-snug" style={{ color: 'var(--muted)' }}>
                        <span style={{ color: 'var(--muted2)' }}>Last time: </span>
                        {lts.map(l => (l.weightKg > 0 ? toDisplayWeight(l.weightKg, units) + unitLabel(units) : 'BW') + ' × ' + l.reps).join(', ')}
                      </div>
                    );
                  }
                  // A grip you have never done has no history, so the line borrows the movement it
                  // came from and says whose number it is. Deliberately only the LINE: the weight box
                  // stays empty, because a wide-grip row is not the weight of a plain one and a
                  // number sitting in an input reads as an instruction rather than a reference.
                  const ref = Training.lastReference(t.logs, it.exerciseId, today, t.custom);
                  if (!ref || !ref.borrowed) return null;
                  const from = Training.byId(ref.fromId, t.custom);
                  return (
                    <div className="text-[11.5px] mb-2 leading-snug" style={{ color: 'var(--muted)' }}>
                      New to this one. On {from ? from.name : 'the plain version'} you did {toDisplayWeight(ref.best.weightKg, units)}{unitLabel(units)} × {ref.best.repsAtBest}
                    </div>
                  );
                })()}

                {/* Warm-up, only until you have started. Once the first working set is in, telling
                    you what to warm up with is stale advice taking up a third of the card. */}
                {warmups.length === 0 && !work.some(x => x.done) && work[0] && work[0].weightKg > 0
                  && Training.warmupSets(work[0].weightKg, ex).length > 0 && (
                  <div className="text-[11.5px] mb-4 leading-snug" style={{ color: 'var(--accent-ink)' }}>
                    <span style={{ color: 'var(--muted2)' }}>Warm up: </span>
                    {Training.warmupSets(work[0].weightKg, ex).map(u => u.reps + ' @ ' + toDisplayWeight(u.weightKg, units) + unitLabel(units)).join(', ')}
                  </div>
                )}

                {/* ---- set table ---- */}
                <div className="flex items-center gap-2 pb-2">
                  <div className="w-8 pf text-[7px] uppercase" style={{ color: 'var(--muted2)' }}>Set</div>
                  <div className="flex-1 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>{unitLabel(units)}</div>
                  <div className="flex-1 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>Reps</div>
                  <div className="w-11 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>RIR</div>
                  <div className="w-12 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>Done</div>
                </div>

                {it.sets.map((s, si) => {
                  const type = s.type || 'work';
                  const tone = SET_TYPE_TONE[type];
                  const workIndex = it.sets.slice(0, si + 1).filter(x => (x.type || 'work') !== 'warmup').length;
                  const cellStyle = { background: 'var(--surface2)', color: s.done ? 'var(--text)' : 'var(--muted)' };
                  // 15px could not fit "62.5" in the weight box, and a clipped decimal reads as a
                  // different number rather than as truncation. 13px fits four characters at 375px.
                  // Taller and larger now the Prev column is not stealing the width.
                  const cell = 'h-12 pixel-box text-[15px] text-center tnum min-w-0 px-0.5';
                  return (
                    <div key={si} className="mb-2 -mx-1 px-1 py-0.5">
                      <div className="flex items-center gap-2">
                        {/* Tap the number to change what kind of set it is. Warm-ups stay out of the
                            volume maths; a drop set suppresses the rest timer. */}
                        <button onClick={() => setSetMenu(setMenu === ii + ':' + si ? null : ii + ':' + si)}
                          aria-label={'Set ' + workIndex + ' options. Currently ' + (SET_TYPES.find(x => x.v === type) || {}).full}
                          className="w-11 h-12 flex items-center justify-center shrink-0">
                          <span className="w-7 h-7 flex items-center justify-center pf text-[11px] tnum"
                            style={{
                              // The set number reads green alongside its tick, so a completed row is
                              // one colour from either end rather than a gold square and a gold tick
                              // with a cream row between them. The frame stays either way: losing it
                              // when done made the number jump a pixel as you ticked it.
                              background: s.done ? 'var(--good)' : 'var(--card)',
                              color: s.done ? '#ffffff' : (tone || 'var(--muted)'),
                              border: '2px solid ' + (s.done ? 'var(--border)' : (tone || 'var(--border)')),
                            }}>
                            {type === 'work' ? workIndex : (SET_TYPES.find(x => x.v === type) || {}).label}
                          </span>
                        </button>
                        <input type="number" inputMode="decimal" className={'flex-1 ' + cell} style={cellStyle}
                          value={s.weightKg ? toDisplayWeight(s.weightKg, units) : ''}
                          onFocus={e => { try { e.target.select(); } catch (_) {} }}
                          onChange={e => setField(ii, si, 'weightKg', fromDisplayWeight(e.target.value, units))}
                          placeholder={s.lastTime ? String(toDisplayWeight(s.lastTime.weightKg, units)) : '0'} />
                        <input type="number" inputMode="numeric" className={'flex-1 ' + cell} style={cellStyle}
                          value={s.reps == null ? '' : s.reps}
                          onFocus={e => { try { e.target.select(); } catch (_) {} }}
                          onChange={e => setField(ii, si, 'reps', e.target.value === '' ? null : +e.target.value)}
                          placeholder={tgt ? String(tgt.repHigh) : (s.targetReps ? String(s.targetReps).split('-').pop() : '')} />
                        <input type="number" inputMode="numeric" className={'w-11 ' + cell} style={cellStyle}
                          value={s.rir == null ? '' : s.rir}
                          onFocus={e => { try { e.target.select(); } catch (_) {} }}
                          onChange={e => setField(ii, si, 'rir', e.target.value === '' ? null : +e.target.value)}
                          placeholder={tgt ? String(tgt.rir) : ''} />
                        {/* A ghost tick, visible before you press it, so the control announces what
                            it does. An empty box announced nothing. */}
                        <button onClick={() => toggleDone(ii, si)}
                          aria-label={s.done ? 'Set ' + (si + 1) + ' done, tap to undo' : 'Mark set ' + (si + 1) + ' done'}
                          className="w-11 h-11 pixel-box flex items-center justify-center text-[19px] font-bold shrink-0 transition-transform"
                          style={{
                            // Green, not gold. The design keeps gold for the one thing you are being
                            // asked to press next; a column of gold ticks for sets already behind you
                            // competed with Finish for the loudest colour on the screen.
                            background: s.done ? 'var(--good)' : 'var(--surface2)',
                            color: s.done ? '#ffffff' : 'var(--muted2)',
                            opacity: s.done ? 1 : 0.85,
                            transform: justDone === ii + ':' + si ? 'scale(1.12)' : 'scale(1)',
                          }}>
                          <Tick size={12} />
                        </button>
                      </div>
                      {setMenu === ii + ':' + si && (
                        <div className="flex gap-1 flex-wrap mt-1 mb-2 pl-1">
                          {SET_TYPES.map(st => (
                            <button key={st.v} onClick={() => { setField(ii, si, 'type', st.v); setSetMenu(null); }}
                              className="pixel-box px-3 h-11 text-[11px]"
                              style={{
                                background: type === st.v ? 'var(--accent)' : 'var(--surface2)',
                                color: type === st.v ? 'var(--on-accent)' : 'var(--text2)',
                              }}>
                              {st.full}
                            </button>
                          ))}
                          <button onClick={() => { removeSet(ii, si); setSetMenu(null); }}
                            className="pixel-box px-3 h-11 text-[11px]" style={{ background: 'var(--surface2)', color: 'var(--danger)' }}>
                            Remove set
                          </button>
                        </div>
                      )}
                      {t.prefs.plateCalc !== false && Training.usesBar(ex) && s.weightKg > 0
                        && (si === 0 || it.sets[si - 1].weightKg !== s.weightKg) && (
                        <button onClick={() => setPlateFor(plateFor === ii + ':' + si ? null : ii + ':' + si)}
                          className="text-[10px] pl-10 tnum text-left" style={{ color: 'var(--muted2)' }}>
                          {plateBarLine(s.weightKg, units)}
                        </button>
                      )}
                    </div>
                  );
                })}

                <button onClick={() => addSet(ii)} className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add set</button>

                {/* One tool row, and now BELOW the table. These are the three things you reach for
                    between sets rather than during one, and above the rows they pushed the only part
                    of the card you actually touch while training a third of the way further down. */}
                <div className="flex gap-2 mt-3">
                  <ToolBtn on={noteOpen === it.exerciseId || !!exNotes[it.exerciseId]}
                    onClick={() => setNoteOpen(noteOpen === it.exerciseId ? null : it.exerciseId)}>Note</ToolBtn>
                  <ToolBtn disabled={!hist.length} onClick={() => setPastFor(it.exerciseId)}>History</ToolBtn>
                  <ToolBtn on={menuOpen === ii} onClick={() => setMenuOpen(ii)}>More</ToolBtn>
                </div>

                {(noteOpen === it.exerciseId || exNotes[it.exerciseId]) && (
                  <input value={exNotes[it.exerciseId] || ''} onChange={e => setExNote(it.exerciseId, e.target.value)}
                    placeholder="e.g. seat 3, pin 6" autoFocus={noteOpen === it.exerciseId}
                    className="w-full pixel-box px-3 h-10 text-[12px] mt-2" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
                )}
              </div>
            )}
          </div>
        );
      })}

      <button onClick={() => setPicking(true)} className="pixel-box w-full h-12 text-[13px] mb-4" style={{ background: 'var(--surface2)' }}>+ Add an exercise</button>

      {/* Session notes as the design draws it: a titled panel, open, with the prompt IN the field.
          Folded behind a disclosure it was a row of small print you had to know to look for, on the
          one screen where "what hurt, what to change next week" is the most valuable thing you can
          leave behind. Open it costs three lines and asks the question. */}
      <Card className="p-0 overflow-hidden mb-4">
        <CardHead title="Session notes" right={notes ? 'Written' : 'Optional'} />
        <div className="p-3.5">
          <textarea value={notes} onChange={e => { setNotes(e.target.value); persist(null, e.target.value); }} rows={2}
            placeholder="How the session felt, anything that hurt, what to change next week."
            className="w-full px-3 py-3 text-[13px]" style={{ border: '2px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
        </div>
      </Card>

      {/* ---- FINISH, at the end of the session rather than pinned over it ----
          It was a fixed bar, which meant the loudest control on the screen was permanently the one
          that ENDS the thing you are in the middle of, sitting under your thumb for the whole hour.
          At the end of the list it is where you arrive when the work is done, it can say what state
          you are in, and it gives the rest bar the bottom of the screen to itself. */}
      <div className="mb-2">
        <button onClick={() => setConfirmEnd(true)} className="pixel-btn w-full h-14 pf text-[11px] uppercase"
          style={{ borderWidth: 3, letterSpacing: '0.05em', background: allWorkDone ? 'var(--accent)' : 'var(--surface2)', color: allWorkDone ? 'var(--on-accent)' : 'var(--text2)' }}>
          {allWorkDone ? 'Finish the session' : 'Finish early · ' + doneSets + ' of ' + totalSets}
        </button>
        <div className="text-[10.5px] mt-2 leading-snug" style={{ color: 'var(--muted2)' }}>
          {allWorkDone ? 'Every set is in. Nothing else to do.' : 'What you have logged is kept. The rest stays unlogged.'}
        </div>
      </div>

      {/* ---- THE REST BAR ----
          Now the only thing pinned to the bottom, and only while it is running. The clock is big
          because it is read across a gym at arm's length, and the line beside it says what the rest
          is for: a countdown that does not name the next set makes you go back up and find it. */}
      {rest && (
        <div className="fixed inset-x-0 bottom-0 max-w-md mx-auto z-30 border-t-[3px] fade-in px-3 pt-2.5 pb-3"
          style={{ background: 'var(--cardhead-bg)', borderColor: 'var(--border)', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center gap-2.5">
            <span className="pf text-[20px] tnum shrink-0" role="timer"
              style={{ color: restLeft <= 0 ? 'var(--on-header-accent)' : 'var(--cardhead-text)' }}>
              {restLeft <= 0 ? 'GO' : fmtClock(restLeft)}
            </span>
            <span className="flex-1 min-w-0 text-[11px] leading-snug" style={{ color: 'var(--nav-off)' }}>
              {rest.from ? 'Next: ' + rest.from : 'Movement done. The next one is open below.'}
            </span>
            {/* The timer finishing was announced by a beep and a colour, both of which are no use to
                a screen reader. Only the transition is announced, never the count: a polite region
                on a per-second value would read the whole two minutes out loud. */}
            <span className="sr-only" aria-live="assertive">{restLeft <= 0 ? 'Rest over, next set' : ''}</span>
            {/* Pressed mid-set, one handed, phone on a bench, chalk on your fingers: the worst
                pointing conditions the app ever sees, so all three keep a real 44px target. */}
            <button onClick={() => setRest(r => r && Object.assign({}, r, { endsAt: r.endsAt - 10000 }))} aria-label="Ten seconds less rest"
              className="shrink-0 w-11 h-11 text-[12px]" style={{ border: '2px solid var(--cardhead-text)', color: 'var(--cardhead-text)' }}>−10</button>
            <button onClick={() => setRest(r => r && Object.assign({}, r, { endsAt: r.endsAt + 30000, seconds: r.seconds + 30, alerted: false }))} aria-label="Thirty seconds more rest"
              className="shrink-0 w-11 h-11 text-[12px]" style={{ border: '2px solid var(--cardhead-text)', color: 'var(--cardhead-text)' }}>+30</button>
            <button onClick={() => setRest(null)} aria-label="Skip rest"
              className="shrink-0 h-11 px-3 pf text-[9px] uppercase" style={{ border: '2px solid var(--accent)', background: 'var(--accent)', color: 'var(--on-accent)', letterSpacing: '0.06em' }}>Skip</button>
          </div>
          <div className="mt-2.5" style={{ height: 8, border: '2px solid var(--cardhead-text)', background: 'rgba(255,253,247,0.14)' }}>
            <div style={{
              height: '100%', background: 'var(--accent)', transition: 'width 1s linear',
              width: (rest.seconds > 0 ? Math.max(0, restLeft / rest.seconds * 100) : 0) + '%',
            }} />
          </div>
        </div>
      )}

      {plateFor != null && (() => {
        const [pi, ps] = String(plateFor).split(':').map(Number);
        const s = items[pi] && items[pi].sets[ps];
        return s ? <PlateSheet weightKg={s.weightKg} units={units} onClose={() => setPlateFor(null)} /> : null;
      })()}
      {menuOpen != null && items[menuOpen] && (
        <ActionSheet title={(Training.byId(items[menuOpen].exerciseId, t.custom) || {}).name || 'This movement'}
          onClose={() => setMenuOpen(null)}
          actions={[
            { label: 'Swap for something else', sub: 'Keeps your sets and reps', onClick: () => setSwapping(menuOpen) },
            // The prescription was readable on this screen and editable only back in the builder, so
            // "three sets is plenty today" meant leaving the session to change it. It is the most
            // common on-the-day edit there is and it belongs where the work is happening.
            {
              label: 'Sets and reps',
              sub: items[menuOpen].target
                ? items[menuOpen].target.sets + ' × ' + items[menuOpen].target.repLow + '-' + items[menuOpen].target.repHigh + ' at ' + items[menuOpen].target.rir + ' RIR'
                : 'Set the prescription for today',
              disabled: !items[menuOpen].target,
              onClick: () => setTargetFor(menuOpen),
            },
            { label: 'Log warm-up sets', sub: 'Adds rows above the working sets', onClick: () => addWarmups(menuOpen) },
            items[menuOpen].superset
              ? { label: 'Break the superset', onClick: () => toggleSuperset(menuOpen) }
              : { label: 'Superset with the next', sub: 'No rest between them', disabled: !items[menuOpen + 1], onClick: () => toggleSuperset(menuOpen) },
            { label: 'Move earlier', disabled: menuOpen === 0, onClick: () => move(menuOpen, -1) },
            { label: 'Move later', disabled: menuOpen >= items.length - 1, onClick: () => move(menuOpen, 1) },
            { label: 'Remove from session', danger: true, onClick: () => removeExercise(menuOpen) },
          ]} />
      )}
      {/* Changing the prescription changes the SETS as well, or the number in the header and the
          number of rows underneath it disagree, which is the app arguing with itself. Rows already
          logged are never taken away: dropping a set you have done would delete work you did. */}
      {targetFor != null && items[targetFor] && items[targetFor].target && (
        <TargetSheet row={items[targetFor]} name={(Training.byId(items[targetFor].exerciseId, t.custom) || {}).name}
          onClose={() => setTargetFor(null)}
          onChange={(patch) => mutate(n => {
            const it2 = n[targetFor];
            it2.target = Object.assign({}, it2.target, patch);
            if (patch.sets != null) {
              const work = it2.sets.filter(s => (s.type || 'work') !== 'warmup');
              const want = Math.max(work.filter(s => s.done).length, patch.sets);
              while (work.length > want) { const drop = work.pop(); it2.sets.splice(it2.sets.indexOf(drop), 1); }
              while (work.length < want) {
                const last = work[work.length - 1] || { type: 'work' };
                const row = Object.assign({}, last, { done: false, reps: null, rir: null, type: 'work' });
                it2.sets.push(row); work.push(row);
              }
            }
          })} />
      )}

      {/* The session's own options, off the header. Everything here is about the whole session
          rather than one movement, which is why it was homeless before: adding a movement was a
          button at the bottom of the list and the rest had nowhere to live at all. */}
      {sessionMenu && (
        <ActionSheet title={session ? session.name : 'Empty session'} onClose={() => setSessionMenu(false)}
          actions={[
            { label: 'Add a movement', sub: 'Something you did that is not in the plan', onClick: () => setPicking(true) },
            {
              label: t.prefs.restTimer === false ? 'Turn the rest timer on' : 'Turn the rest timer off',
              sub: t.prefs.restTimer === false ? 'A countdown starts when you tick a set' : 'No countdown when you tick a set',
              onClick: () => {
                const on = t.prefs.restTimer === false;
                trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { restTimer: on }); });
                if (!on) setRest(null);
                showToast && showToast(on ? 'Rest timer on.' : 'Rest timer off.');
              },
            },
            { label: 'Finish the session', sub: doneSets ? doneSets + (doneSets === 1 ? ' set' : ' sets') + ' saved' : 'Nothing ticked, so nothing saved', onClick: () => setConfirmEnd(true) },
            { label: 'Leave without finishing', sub: 'Everything ticked is already saved. Come back to it later.', onClick: onExit },
          ]} />
      )}

      {pr && <PRFlash pr={pr} db={db} units={units} onClose={() => setPr(null)} />}
      {signOff && <SessionSignOff db={db} facts={signOff} units={units} onDone={onExit} />}
      {help && <TrainHelp topic={help} db={db} onClose={() => setHelp(null)}
        onHideForGood={() => { trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { hideHelp: true }); }); setHelp(null); }} />}
      {pastFor && <PastSets db={db} exerciseId={pastFor} onClose={() => setPastFor(null)} />}
      {picking && <ExercisePicker db={db} update={update} onPick={addExercise} onClose={() => setPicking(false)} />}
      {swapping != null && (
        <ExercisePicker db={db} update={update} title="Swap movement"
          basedOn={items[swapping] && items[swapping].exerciseId}
          onPick={(id) => { swapExercise(swapping, id); setSwapping(null); }}
          onClose={() => setSwapping(null)} />
      )}
      {/* The weeks already trained are never touched: they are a record of what you actually did, and
          rewriting them to match a decision made afterwards would make your own history lie. */}
      {swapScope && (() => {
        const from = Training.byId(swapScope.from, t.custom), to = Training.byId(swapScope.to, t.custom);
        return (
          <ActionSheet title={(to ? to.name : 'That') + ' instead of ' + (from ? from.name : 'it')}
            onClose={() => setSwapScope(null)}
            actions={[
              { label: 'Just today', sub: 'The block keeps ' + (from ? from.name : 'the original') },
              {
                label: 'The rest of the block',
                sub: 'Changes ' + swapScope.reach + ' sessions from this week on. Weeks you have trained stay as they were.',
                onClick: () => {
                  trainUpdate(update, (tr) => {
                    const i = tr.blocks.findIndex(b => b.id === block.id);
                    if (i >= 0) Training.swapInBlock(tr.blocks[i], swapScope.from, swapScope.to, swapScope.week);
                  });
                  showToast && showToast((to ? to.name : 'Changed') + ' for the rest of the block.');
                },
              },
            ]} />
        );
      })()}
      {confirmEnd && (
        <ConfirmDialog title="Finish this session?"
          body={doneSets ? doneSets + ' sets will be saved. Anything you did not tick is dropped.' : 'You have not ticked any sets, so nothing will be saved.'}
          confirmLabel="Finish" confirmKind="primary"
          onConfirm={finish} onClose={() => setConfirmEnd(false)} />
      )}
    </div>
  );
}

// One piece of the prescription, with the jargon explained right where it appears. A "?" next to
// "2110 tempo" is worth more than a glossary nobody opens, because the question is only ever asked
// at the moment you are looking at the number.
// The "?" earns its place the first few times and becomes wallpaper after that, so it can be turned
// off for good from inside the explainer it opens. The label stays tappable either way, so the
// explanation is never actually lost, it just stops shouting.
/* ---- your buddy trains with you --------------------------------------------------------------
   The single most on-brand thing available in this module, and it costs no new mechanic and no new
   art: the buddy stands in the corner of the movement you are working on and does the rep when you
   tick it. It drops and springs for a squat, lunges for a press, pulls away for a row, using strips
   the sprite pack already ships.

   Driven off the tick rather than a timer, so it moves when you move and is otherwise perfectly
   still. That distinction is the whole point: a sprite bouncing away on its own in the middle of a
   set is decoration and would be the first thing anyone asked us to turn off. This is company.

   Honours prefers-reduced-motion by simply not playing the one-shot, and an unhatched egg does not
   pretend to lift. */
const PATTERN_ANIM = {
  squat: 'jump', hinge: 'jump', lunge: 'kick',
  horizPress: 'bite', vertPress: 'bite',       // a press is a drive away from the body
  horizPull: 'avoid', vertPull: 'avoid',       // a pull is a drive back toward it
  carry: 'move', core: 'dash', isolation: 'bite',
};
/* The buddy in the session header: framed, idling, and doing the rep with you when you tick a set.
   It used to stand at the end of the prescription row inside the open card, which meant two things
   went wrong at once. It only existed on whichever movement happened to be open, so between
   exercises and while resting the one character in the app was absent from the screen it should own
   most. And three cues plus the prescription plus a 36px sprite do not fit a 375px row, so it hung
   over the card border. In the header it is on screen for the whole hour and has room of its own.

   Driven off the tick rather than a timer, so it moves when you move and is otherwise perfectly
   still. That distinction is the whole point: a sprite bouncing away on its own mid-set is
   decoration and would be the first thing anyone asked us to turn off. This is company. Honours
   prefers-reduced-motion by not playing the one-shot, and an unhatched egg does not pretend to lift. */
function SessionBuddy({ db, pattern, trigger }) {
  const [rep, setRep] = useState(0);
  useEffect(() => { if (trigger > 0) setRep(trigger); }, [trigger]);
  const buddy = (db && db.buddy) || {};
  if (buddy.hatched === false) return null;   // an egg does not come to the gym
  const species = buddy.species || 'doux';
  const move = PATTERN_ANIM[pattern] || 'jump';
  let palette = buddy.palette || 'female';
  // Some male colourways ship without these strips. Falling back keeps the buddy on screen rather
  // than requesting a 404 and leaving a hole where it was standing.
  if (!spriteHasAnim(palette, species, 'base', move) || !spriteHasAnim(palette, species, 'base', 'idle')) palette = 'female';
  const playing = rep > 0 && rep === trigger && !prefersReducedMotion();
  const anim = playing ? move : 'idle';
  return (
    <span className="shrink-0 flex items-center justify-center overflow-hidden" aria-hidden="true"
      style={{ width: 30, height: 30, lineHeight: 0, background: 'var(--cardhead-bg)', border: '2px solid var(--border)' }}>
      <SpriteSheet key={anim + ':' + rep} palette={palette} species={species} group="base" anim={anim}
        px={1.1} fps={playing ? 9 : BUDDY_IDLE_FPS} loop={!playing}
        onEnd={playing ? () => setRep(0) : undefined} />
    </span>
  );
}


/* The prescription line carries up to three of these, and each used to end in a solid accent-filled
   "?" chip: three neon squares in a row on the busiest card in the app, shouting louder than the
   numbers they were explaining. Outlined now, with accent text, so the badge reads as a footnote
   marker rather than as a third thing competing for the eye.

   The chip was also 20 square, which is under the 24 CSS pixel floor in WCAG 2.2 (SC 2.5.8) and
   well under the 44 that anything tapped mid-set should be. The visible mark stays small; `hit`
   grows the real target to 44 behind it. */
/* One prescription cue. `Session.dc.html` draws these as framed chips - the box IS the affordance,
   so the separate "?" bubble beside every one of them goes: three cues meant three labels and three
   question marks fighting for a 375px row, and the pair wrapped "2 RIR" onto two lines. Tapping the
   chip still opens the explainer, which is what the "?" was for. */
function MetaBit({ label, onHelp, muted, hideHelp }) {
  return (
    <button onClick={hideHelp ? undefined : onHelp} aria-label={hideHelp ? label : 'What does ' + label + ' mean?'}
      className="pf text-[9px] uppercase tnum shrink-0 whitespace-nowrap px-2 py-2"
      style={{ letterSpacing: '0.08em', border: '2px solid var(--border)', background: 'var(--surface2)',
        color: muted ? 'var(--muted)' : 'var(--text)' }}>{label}</button>
  );
}

// The explainers behind every "?" on the session screen.
function TrainHelp({ topic, db, onClose, onHideForGood }) {
  useBackClose(onClose);
  const t = tdb(db);
  let title = '', body = '';
  if (topic === 'rir') {
    title = 'Reps in reserve';
    body = 'How many more reps you should have left when you rack it. Two RIR means you could have done two more and stopped. It is a better instruction than "to failure", because taking every set to the limit buys fatigue faster than it buys muscle, and the number walks down as the block goes on so the hard weeks land when you are ready for them.';
  } else if (topic === 'rest') {
    title = 'Rest';
    body = 'How long to leave between sets. Short rests do not make a set count for more, they just make the next one worse, so on the big compounds take the time. The timer starts on its own when you tick a set, and stays quiet after a drop set or mid-superset where the point is to keep going.';
  } else if (String(topic).indexOf('tempo:') === 0) {
    const parts = Training.tempoParts(String(topic).slice(6));
    title = 'Tempo ' + String(topic).slice(6);
    body = (parts ? parts.text + ' ' : '') + 'Four numbers: lowering, pause at the stretch, lifting, pause at the top. The lowering is the half that matters most, and it is the half people rush. Slowing it down is usually worth more than adding weight.';
  } else if (String(topic).indexOf('why:') === 0) {
    const ex = Training.byId(String(topic).slice(4), t.custom);
    title = ex ? ex.name : 'This movement';
    body = [Training.cueFor(ex), Training.whyFor(ex)].filter(Boolean).join('\n\n');
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Explainer" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-5 fade-in max-h-[80vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className="pf text-[12px] mb-4">{title}</h2>
        <div className="text-[13px] leading-relaxed mb-4 whitespace-pre-wrap" style={{ color: 'var(--text2)' }}>{body}</div>
        <Btn kind="ghost" className="w-full" onClick={onClose}>Got it</Btn>
        {!t.prefs.hideHelp && onHideForGood && (
          <button onClick={onHideForGood} className="w-full py-3 text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
            Stop showing the question marks
          </button>
        )}
      </div>
    </div>
  );
}

// Every previous session of this movement, newest first. The question in the gym is never "what is
// my all-time best", it is "what did I do last time, and the time before".
function PastSets({ db, exerciseId, onClose }) {
  useBackClose(onClose);
  const t = tdb(db);
  const units = t.prefs.units;
  const ex = Training.byId(exerciseId, t.custom);
  const logs = t.logs.slice().sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  // Which sets were records ON THE DAY. Scrolling back through your sessions should show where the
  // good days were, not just a wall of numbers, and "that was a best at the time" stays true even
  // after you have since beaten it.
  const rows = logs.map(l => {
    const sets = (l.sets || []).filter(s => s.exerciseId === exerciseId && s.done && (!s.type || s.type === 'work'));
    if (!sets.length) return null;
    const prIdx = {};
    Training.prsInLog(t.logs, l).forEach(p => { if (p.exerciseId === exerciseId) prIdx[p.setIndex] = p; });
    // prsInLog indexes against the log's FULL set list, so map back through it to find which of the
    // filtered rows earned one.
    const all = l.sets || [];
    const marks = sets.map(s => prIdx[all.indexOf(s)] || null);
    return { dateISO: l.dateISO, sets, marks };
  }).filter(Boolean).slice(0, 12);
  return (
    <div role="dialog" aria-modal="true" aria-label="Recent sets" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-5 fade-in max-h-[80vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className="pf text-[11px] mb-4">{ex ? ex.name : 'History'}</h2>
        {rows.length === 0 && <div className="text-[13px]" style={{ color: 'var(--muted)' }}>You have not logged this one yet.</div>}
        {rows.map((r, i) => (
          <div key={i} className="py-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="pf text-[8px] uppercase" style={{ color: 'var(--accent-ink)' }}>{r.dateISO}</span>
              {r.marks.some(Boolean) && (
                <span className="pf text-[7px] uppercase px-2 py-0.5" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>PR</span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {r.sets.map((s, j) => {
                const mark = r.marks[j];
                return (
                  <span key={j} className="text-[12px] tnum px-2 py-1" style={{
                    background: mark ? 'color-mix(in srgb, var(--accent) 22%, var(--surface2))' : 'var(--surface2)',
                    color: mark ? 'var(--accent-ink)' : 'var(--text2)',
                    fontWeight: mark ? 700 : 400,
                  }}>
                    {mark ? <Spark size={12} /> : null}{mark ? ' ' : ''}{toDisplayWeight(s.weightKg, units)}{unitLabel(units)} × {s.reps}{s.rir != null ? ' @' + s.rir : ''}
                  </span>
                );
              })}
            </div>
            {r.marks.filter(Boolean).map((m, k) => (
              <div key={k} className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{m.label}</div>
            ))}
          </div>
        ))}
        <Btn kind="ghost" className="w-full mt-4" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}

// A countdown ring rather than a bar: it reads as "time left" at a glance from arm's length, which
// is the distance this gets looked at from.
/* The rest timer is a character, not a clock.
   Between sets you are looking at this bar and nothing else, for anything from sixty seconds to
   three minutes, several times an hour. It was a ring and two digits. Now your buddy sits inside the
   ring and gets its breath back with you: a slow, heavy idle while there is time, pacing in the last
   ten seconds, and up on its feet the moment the rest is done.

   The ring is untouched in meaning. It is the thing you are actually reading, so it stays the outer
   edge and only gained a passenger. Nothing here changes when the timer fires or what it says. */
function RestRing({ left, total, db }) {
  const size = 46, r = 20, c = 2 * Math.PI * r, mid = size / 2;
  const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const done = left <= 0;
  const buddy = (db && db.buddy) || {};
  // An unhatched egg has no legs to pace on, so it wobbles in its group's own strip exactly as it
  // does everywhere else rather than borrowing a dino's animation.
  const hatched = buddy.hatched !== false;
  const species = buddy.species || 'doux';
  let palette = buddy.palette || 'female';
  // Some male colourways ship without the movement strips; fall back to the complete one rather than
  // requesting a 404 and leaving an empty ring.
  if (!spriteHasAnim(palette, species, 'base', 'move')) palette = 'female';
  const anim = done ? 'jump' : left <= 10 ? 'move' : 'idle';
  // Breathing, not performing: the resting idle runs slower than the buddy's normal pace, and only
  // picks up when the clock does.
  const fps = done ? 10 : left <= 10 ? 8 : 3;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size} className="absolute inset-0">
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--track)" strokeWidth="3" />
        <circle cx={mid} cy={mid} r={r} fill="none" stroke={left <= 10 ? 'var(--good)' : 'var(--accent)'} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform={'rotate(-90 ' + mid + ' ' + mid + ')'} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center" style={{ lineHeight: 0 }}>
        {hatched
          ? <SpriteSheet key={anim} palette={palette} species={species} group="base" anim={anim} px={1.4} fps={fps} />
          : <SpriteSheet {...buddyStageSprite(0, buddy)} px={1.4} />}
      </div>
    </div>
  );
}

// One line of plate maths under the weight box. Full breakdown on tap.
function plateBarLine(weightKg, units) {
  const r = Training.plateBreakdown(weightKg, { units });
  if (!r.ok) {
    if (r.reason === 'under_bar') return 'lighter than the bar';
    return 'closest you can load: ' + toDisplayWeight(r.achievable, units) + unitLabel(units);
  }
  if (!r.perSide.length) return 'empty bar';
  return 'per side: ' + r.perSide.map(p => (p.count > 1 ? p.count + '×' : '') + p.plate).join(' + ');
}

function PlateSheet({ weightKg, units, onClose }) {
  useBackClose(onClose);
  const r = Training.plateBreakdown(weightKg, { units });
  return (
    <div role="dialog" aria-modal="true" aria-label="Loading the bar" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-5 fade-in" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className="pf text-[12px] mb-1">Loading the bar</h2>
        <div className="text-[17px] font-bold tnum mb-1">{toDisplayWeight(weightKg, units)}{unitLabel(units)}</div>
        <div className="text-[12px] mb-4" style={{ color: 'var(--muted)' }}>
          {toDisplayWeight(r.barKg, units)}{unitLabel(units)} bar, plus each side:
        </div>
        {r.ok && r.perSide.length > 0 ? (
          <div className="flex gap-2 flex-wrap mb-4">
            {r.perSide.map((p, i) => (
              <span key={i} className="pixel-box px-3 py-2 text-[14px] tnum" style={{ background: 'var(--surface2)' }}>
                {p.count > 1 ? p.count + ' × ' : ''}{p.plate}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[13px] mb-4" style={{ color: 'var(--warn)' }}>
            {r.reason === 'under_bar'
              ? 'That is lighter than an empty bar.'
              : 'You cannot make that exactly. The closest is ' + toDisplayWeight(r.achievable, units) + unitLabel(units) + '.'}
          </div>
        )}
        <Btn kind="ghost" className="w-full" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}

// The end of a rest. Sound and a buzz while the app is in front of you; a notification when it is
// not. Worth being straight about the limit: an installed PWA cannot reliably wake itself on iOS,
// so on an iPhone with the screen off the alert may arrive late or not at all. The countdown itself
// is always correct on return, because it is stored as an end timestamp rather than a tick count.
function restAlert(prefs) {
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (_) {}
  if (prefs && prefs.restSound === false) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (at, freq) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.type = 'square';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.2);
    };
    beep(0, 880); beep(0.2, 1174);
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 800);
  } catch (_) {}
  // Backstop for when the screen is off or the app is behind something else.
  try {
    if (document.visibilityState === 'hidden' && window.Notification && Notification.permission === 'granted') {
      navigator.serviceWorker && navigator.serviceWorker.ready.then(reg => {
        reg.showNotification('Rest over', { body: 'Next set.', tag: 'rest-timer', silent: false });
      });
    }
  } catch (_) {}
}

// ---- exercise picker --------------------------------------------------------------------------
function ExercisePicker({ db, update, onPick, onClose, title, basedOn, seed }) {
  useBackClose(onClose);
  const t = tdb(db);
  // Opening on the plan's own wording for a movement means the search has already been run and the
  // create form is already named. Nobody should retype a line the app just showed them.
  const [q, setQ] = useState(seed || '');
  const [muscle, setMuscle] = useState('');
  const [creating, setCreating] = useState(false);   // true, or a parent id to vary
  const parent = basedOn ? Training.byId(basedOn, t.custom) : null;
  // Every way of doing the movement being swapped: the plain version and each of its grips, stances
  // or handles. Asked from a variation it returns its siblings, which is the case that matters, since
  // "this grip is not working today" is a thought you have while already on a variation.
  const siblings = basedOn ? Training.variantsOf(basedOn, t.custom) : [];
  let list = Training.search(q, t.custom, 200);
  if (muscle) list = list.filter(e => (e.primary || []).indexOf(muscle) !== -1 || (e.secondary || []).indexOf(muscle) !== -1);
  if (!q) list = list.concat(Training.CARDIO);

  return (
    <div role="dialog" aria-modal="true" aria-label="Pick a movement" className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center gap-2 p-3 border-b-[3px]" style={{ borderColor: 'var(--border)' }}>
        <button onClick={onClose} className="pf text-[9px] uppercase" style={{ color: 'var(--accent-ink)' }}>Close</button>
        <div className="pf text-[10px] flex-1 text-center">{title || 'Add exercise'}</div>
        <button onClick={() => setCreating(true)} className="pf text-[8px] uppercase" style={{ color: 'var(--accent-ink)' }}>New</button>
      </div>
      <div className="p-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search movements" autoFocus
          className="w-full pixel-box px-3 py-3 text-[14px] mb-2" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button onClick={() => setMuscle('')} className="pixel-box px-3 py-2 text-[11px] whitespace-nowrap" style={{ background: muscle ? 'var(--surface2)' : '#fff', color: muscle ? 'var(--text2)' : '#111' }}>All</button>
          {Training.MUSCLES.map(m => (
            <button key={m} onClick={() => setMuscle(muscle === m ? '' : m)} className="pixel-box px-3 py-2 text-[11px] whitespace-nowrap"
              style={{ background: muscle === m ? '#fff' : 'var(--surface2)', color: muscle === m ? '#111' : 'var(--text2)' }}>
              {Training.MUSCLE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {/* The commonest reason a movement is not in the library is that it is a variation of one
            that is: a grip, a stance, an attachment. Making it from its parent inherits what it
            trains, which is the part nobody standing at a machine wants to fill in. */}
        {/* Swapping FROM a movement that has ways of being done: offer them before anything else.
            "Same lift, different grip" is far and away the commonest swap somebody makes standing at
            a machine, and it used to mean searching the library again from scratch. */}
        {parent && siblings.length > 1 && (
          <div className="pixel-box p-3 mb-2" style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--surface2))' }}>
            <div className="pf text-[8px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Ways to do this one</div>
            <div className="flex flex-wrap gap-2">
              {siblings.map(v => (
                <button key={v.id} onClick={() => onPick(v.id)} disabled={v.id === basedOn}
                  className="pixel-box px-3 h-11 text-[11.5px]"
                  style={{ background: v.id === basedOn ? 'var(--accent)' : 'var(--surface2)',
                    color: v.id === basedOn ? 'var(--on-accent)' : 'var(--text2)', opacity: v.id === basedOn ? 0.7 : 1 }}>
                  {v.variantLabel ? v.variantLabel : 'as written'}
                </button>
              ))}
            </div>
          </div>
        )}
        {parent && (
          <button onClick={() => setCreating(basedOn)} className="w-full text-left pixel-box p-3 mb-2"
            style={{ background: 'var(--surface2)' }}>
            <div className="text-[13px] font-bold">Make a variation of {parent.name}</div>
            <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--muted)' }}>A grip, stance or attachment we have not got. Keeps what it trains.</div>
          </button>
        )}
        {list.map(e => {
          // The ways of doing THIS movement, offered right on its row. Search folds them away so a
          // hunt for "row" is not eleven ways to hold a T-bar, and this is where they come back:
          // one tap, on the movement you were already looking at, with no second search.
          const ways = Training.variantsOf(e.id, t.custom).filter(v => v.id !== e.id);
          return (
            <div key={e.id} className="pixel-box p-3 mb-2" style={{ background: 'var(--surface2)' }}>
              <button onClick={() => onPick(e.id)} className="w-full text-left">
                <div className="text-[13px] font-bold">{e.name}</div>
                {Training.isCardio(e)
                  ? <span className="text-[10px]" style={{ color: 'var(--muted2)' }}>Cardio, logged but not counted in your lifting volume</span>
                  : <MuscleTags exerciseId={e.id} custom={t.custom} />}
              </button>
              {ways.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3" style={{ borderTop: '2px solid var(--border)' }}>
                  {ways.map(v => (
                    <button key={v.id} onClick={() => onPick(v.id)} className="pixel-box px-3 h-11 text-[11.5px]"
                      style={{ background: 'var(--card)', color: 'var(--accent-ink)' }}>
                      {v.variantLabel || v.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!list.length && (
          <div className="text-center py-8">
            <div className="text-[13px] mb-2" style={{ color: 'var(--muted)' }}>Nothing matches "{q}".</div>
            <button onClick={() => setCreating(true)} className="pixel-box px-4 py-3 text-[12px]" style={{ background: 'var(--surface2)' }}>Create it</button>
          </div>
        )}
      </div>
      {creating && <CustomExercise db={db} update={update} initialName={q}
        basedOn={typeof creating === 'string' ? creating : null}
        onDone={(id) => { setCreating(false); onPick(id); }} onClose={() => setCreating(false)} />}
    </div>
  );
}

// A user-invented movement still has to say what it trains, or it would sit in the plan
// contributing nothing and quietly making the coverage audit wrong.
function CustomExercise({ db, update, initialName, basedOn, onDone, onClose }) {
  useBackClose(onClose);
  const t0 = tdb(db);
  // A variation arrives with everything but its name already answered, because its parent already
  // answered it. The fields stay editable: inherited is a starting point, not a claim.
  const seed = basedOn ? Training.variationOf(basedOn, 'x', t0.custom) : null;
  const parent = basedOn ? Training.byId(basedOn, t0.custom) : null;
  const [name, setName] = useState(initialName || (parent ? parent.name : ''));
  const [primary, setPrimary] = useState(seed ? seed.primary : []);
  const [secondary, setSecondary] = useState(seed ? seed.secondary : []);
  const [equipment, setEquipment] = useState(seed ? seed.equipment : 'machine');
  function toggle(list, setList, m) { setList(list.indexOf(m) !== -1 ? list.filter(x => x !== m) : list.concat([m])); }
  // A variation opens with its parent's name so you can add to it rather than retype it, which means
  // the one thing that must not happen is saving it unchanged and quietly minting a second exercise
  // with the same name as the first.
  const unchanged = !!parent && norm2(name) === norm2(parent.name);
  function save() {
    if (!name.trim() || !primary.length || unchanged) return;
    const id = 'cu_' + trainUid();
    trainUpdate(update, (tr) => {
      tr.custom.push({
        id: id, name: name.trim(), equipment: equipment,
        // A variation keeps its parent's movement pattern and resistance profile too. Those decide
        // warm-up ramps and which gaps it can fill, and a wide-grip row is still a horizontal pull.
        pattern: seed ? seed.pattern : 'isolation', profile: seed ? seed.profile : 'mid',
        primary: primary, secondary: secondary.filter(m => primary.indexOf(m) === -1),
        custom: true, variantOf: basedOn || null,
      });
    });
    onDone(id);
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="New movement" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-4 fade-in max-h-[85vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className="pf text-[11px] mb-1">{parent ? 'Variation' : 'New exercise'}</h2>
        {parent && (
          <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
            Based on {parent.name}, so it already knows what it trains. Change anything that is not true of yours.
          </div>
        )}
        <Field label="Name"><TextInput value={name} onChange={e => setName(e.target.value)} placeholder="What do you call it?" /></Field>
        <Field label="Equipment">
          <Seg value={equipment} onChange={setEquipment} options={[{ v: 'barbell', l: 'Barbell' }, { v: 'dumbbell', l: 'Dumbbell' }, { v: 'machine', l: 'Machine' }, { v: 'cable', l: 'Cable' }, { v: 'bodyweight', l: 'Body' }]} />
        </Field>
        <Field label="Muscles it mainly works" hint="Pick at least one, or it cannot count toward your weekly volume.">
          <div className="flex gap-2 flex-wrap">
            {Training.MUSCLES.map(m => (
              <button key={m} onClick={() => toggle(primary, setPrimary, m)} className="pixel-box px-2 py-2 text-[11px]"
                style={{ background: primary.indexOf(m) !== -1 ? 'var(--good)' : 'var(--surface2)', color: primary.indexOf(m) !== -1 ? '#05140a' : 'var(--text2)' }}>
                {Training.MUSCLE_LABEL[m]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Muscles that assist" hint="These count as half a set each, the way a coach would count them.">
          <div className="flex gap-2 flex-wrap">
            {Training.MUSCLES.filter(m => primary.indexOf(m) === -1).map(m => (
              <button key={m} onClick={() => toggle(secondary, setSecondary, m)} className="pixel-box px-2 py-2 text-[11px]"
                style={{ background: secondary.indexOf(m) !== -1 ? 'var(--warn)' : 'var(--surface2)', color: secondary.indexOf(m) !== -1 ? '#1a1200' : 'var(--text2)' }}>
                {Training.MUSCLE_LABEL[m]}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex gap-2">
          <Btn kind="ghost" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={save} disabled={!name.trim() || !primary.length || unchanged}>
            {unchanged ? 'Name it' : 'Save'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ---- the mesocycle grid, per `Build a block v3.dc.html` -----------------------------------------
   Weeks down, sessions across, each cell its own set count shaded by how hard that week is. It is
   the climb, drawn, and the climb is the entire argument for a block over a list of workouts.

   Shared by every screen that talks about a whole block - building one, reviewing the one you just
   finished, running it again, looking at somebody else's - because "what is a block" should be the
   same picture everywhere. Before this, four screens each described a block a different way, in
   sentences, and none of them showed the shape.

   `weeks` is [{week, deload, sessions:[{name, sets}]}]; `readBlock` below builds it from a block. */
function MesoGrid({ weeks, sessions }) {
  if (!weeks || !weeks.length || !sessions || !sessions.length) return null;
  const peak = Math.max.apply(null, weeks.map(w => Math.max.apply(null, w.sessions.map(s => s.sets).concat([1]))));
  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col gap-1 pt-[13px] shrink-0">
        {weeks.map(w => (
          <span key={w.week} className="pf text-[7.5px] w-4" style={{ height: 22, lineHeight: '22px', letterSpacing: '0.06em', color: w.deload ? 'var(--warn-ink)' : w.week === 1 ? 'var(--muted)' : 'var(--accent-ink)' }}>W{w.week}</span>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(' + sessions.length + ',1fr)' }}>
          {sessions.map((s, i) => (
            <span key={i} className="pf text-[7px] text-center truncate" style={{ letterSpacing: '0.04em', color: 'var(--muted2)' }}>{s.name.length > 6 ? s.name.slice(0, 5) : s.name}</span>
          ))}
        </div>
        <div className="flex flex-col gap-1 mt-1">
          {weeks.map(w => (
            <div key={w.week} className="grid gap-1" style={{ gridTemplateColumns: 'repeat(' + sessions.length + ',1fr)' }}>
              {w.sessions.map((s, i) => (
                <div key={i} title={s.name + ', week ' + w.week + ': ' + s.sets + ' sets'}
                  className="flex items-center justify-center text-[9.5px] tnum"
                  style={{
                    height: 22, boxSizing: 'border-box', border: '2px solid var(--border)', transition: 'background .25s ease',
                    background: w.deload ? 'var(--surface2)' : 'color-mix(in srgb, var(--accent) ' + Math.min(100, Math.max(18, Math.round(s.sets / peak * 100))) + '%, var(--track))',
                    color: w.deload ? 'var(--muted)' : 'var(--on-accent)',
                  }}>{s.sets}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// A block, read into the shape MesoGrid wants. Reads the block itself rather than recomputing
// anything: training.js owns the numbers, this only arranges them.
function readBlock(block) {
  if (!block) return null;
  const weeks = [];
  for (let w = 1; w <= (block.weeks || 4); w++) {
    const ss = Training.weekSessions(block, w);
    if (!ss.length) continue;
    weeks.push({
      week: w, deload: ss.some(s => s.deload),
      sessions: ss.map(s => ({
        name: s.name, moves: (s.exercises || []).length, mins: sessionMins(s.exercises),
        sets: (s.exercises || []).reduce((a, e) => a + ((e.target && e.target.sets) || 0), 0),
      })),
    });
  }
  if (!weeks.length) return null;
  const s1 = weeks[0].sessions;
  // "Upper A, Lower A, Upper B, Lower B" said back as "UPPER / LOWER x2", which is how anybody who
  // trains would describe it, and how the split reads at a glance in a panel header.
  const bases = [];
  s1.forEach(s => { const b = s.name.replace(/\s+[A-Z0-9]$/, '').trim(); if (bases.indexOf(b) === -1) bases.push(b); });
  const rounds = bases.length ? Math.round(s1.length / bases.length) : 1;
  return {
    weeks: weeks, sessions: s1,
    weekSets: s1.reduce((a, s) => a + s.sets, 0),
    minutesEach: Math.round(s1.reduce((a, s) => a + s.mins, 0) / s1.length),
    movesEach: Math.round(s1.reduce((a, s) => a + s.moves, 0) / s1.length),
    splitName: bases.join(' / ') + (rounds > 1 ? ' x' + rounds : ''),
  };
}

/* ---- the live block preview --------------------------------------------------------------------
   The thing the old wizard never did: show you the block while you are still answering. It was a
   column of segmented controls and a Build button, so the first time you saw what four days and
   sixty minutes actually meant was after it had been generated, and changing your mind meant going
   back and building again. Now every answer redraws this panel above the questions.

   The mesocycle grid is the centrepiece: weeks down, sessions across, each cell its own set count,
   shaded by how hard that week is. It is the climb, drawn, and the climb is the entire argument for
   a block over a list of workouts.

   IMPORTANT: none of these numbers are computed here. The panel runs the real engine and reads the
   real block back, which is the rule the whole module is built on - `training.js` owns every number.
   A preview with its own arithmetic would be a second, quietly different app, and the moment the two
   disagreed the preview would be a lie told at exactly the moment someone is deciding. */
function BlockPreview({ preview, changeLine, brought, sourceCount }) {
  if (!preview) {
    return (
      <Card className="p-4 mb-4">
        <div className="text-[12px]" style={{ color: 'var(--muted)' }}>Working out what that looks like...</div>
      </Card>
    );
  }
  const { weeks, cov, weekSets, sessions, minutesEach, splitName } = preview;
  const shortN = cov.rows.filter(r => r.sets < r.mev).length;
  const overN = cov.rows.filter(r => r.sets > r.mrv).length;
  const settled = !shortN && !overN;
  // Only what is out of range, and only the worst three. All seventeen bars is the coverage screen's
  // job; here it would bury the one or two that actually want a decision.
  const attention = cov.rows.filter(r => r.sets < r.mev || r.sets > r.mrv)
    .sort((a, b) => (b.sets > b.mrv ? 1 : 0) - (a.sets > a.mrv ? 1 : 0)).slice(0, 3);

  return (
    <div className="sticky top-0 z-10 -mx-5 px-5 pb-2.5 mb-3" style={{ background: 'var(--bg)' }}>
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5" style={{ background: 'var(--cardhead-bg)' }}>
          <span className="pf text-[8px] uppercase truncate" style={{ color: 'var(--cardhead-text)', letterSpacing: '0.11em' }}>{splitName}</span>
          <span className="pf text-[8px] uppercase tnum shrink-0" style={{ color: 'var(--on-header-accent)', letterSpacing: '0.11em' }}>{weekSets} sets / wk</span>
        </div>
        <div className="p-3">
          <MesoGrid weeks={weeks} sessions={sessions} />

          <div className="flex items-center gap-2 mt-3 pt-2.5" style={{ borderTop: '2px solid var(--track)' }}>
            <span className="shrink-0" style={{ width: 11, height: 11, border: '2px solid var(--border)', background: settled ? 'var(--good)' : overN ? 'var(--warn)' : 'var(--track)' }} />
            <span className="flex-1 text-[11px] leading-snug" style={{ color: 'var(--text2)' }}>
              {settled
                ? 'Every muscle lands inside the range that works for you.'
                : overN
                  ? overN + (overN === 1 ? ' muscle is' : ' muscles are') + ' past what you can recover from.'
                  : shortN + (shortN === 1 ? ' muscle sits' : ' muscles sit') + ' under the range that grows anything.'}
            </span>
          </div>

          {attention.map(r => <div key={r.muscle} className="mt-2"><CoverageRow row={r} compact /></div>)}

          {/* Every answer writes a one-line consequence. Without it the panel redraws and you are
              left to spot the difference yourself, which nobody does. */}
          <div key={changeLine} className="mt-2.5 px-2.5 py-2 text-[10.5px] leading-snug"
            style={{ borderLeft: '3px solid ' + (changeLine ? 'var(--accent)' : 'var(--track)'), background: 'var(--surface2)', color: changeLine ? 'var(--text2)' : 'var(--muted2)', animation: changeLine ? 'fade .3s ease both' : 'none' }}>
            {changeLine || 'Change any answer and the block redraws above.'}
          </div>

          <div className="flex items-center gap-2 mt-2.5">
            <span className="pf text-[7.5px] uppercase shrink-0 px-1.5 py-1" style={{ letterSpacing: '0.1em', border: '2px solid var(--border)', background: 'var(--accent-dim)', color: 'var(--accent-ink)' }}>
              {brought ? 'Yours + builder' : 'Builder'}
            </span>
            <span className="text-[10.5px] leading-snug" style={{ color: 'var(--muted)' }}>
              {brought
                ? 'Your ' + sourceCount + ' ' + (sourceCount === 1 ? 'day' : 'days') + ' set the movements. The builder sets volume and the four-week climb.'
                : 'No source, so the builder writes all four weeks from your answers below.'}
            </span>
          </div>
          <div className="text-[10.5px] mt-2" style={{ color: 'var(--muted2)' }}>About {minutesEach} min a session.</div>
        </div>
      </Card>
    </div>
  );
}

/* A question, with what it costs shown against its own label. The shared `Field` has no room for
   that readout, and the readout is the point: "Days a week / 4 sessions", "How long a session /
   8 movements" turns a form into a conversation where every answer visibly does something. */
function TrainField({ label, effect, hint, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="pf text-[9px] uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>{label}</span>
        {effect ? <span className="text-[10.5px] shrink-0 tnum" style={{ color: 'var(--accent-ink)' }}>{effect}</span> : null}
      </div>
      {children}
      {hint && <div className="text-[10.5px] mt-2 leading-snug" style={{ color: 'var(--muted)' }}>{hint}</div>}
    </div>
  );
}

// ---- block wizard -----------------------------------------------------------------------------
// Free users get the whole thing built deterministically from their equipment and days. Premium
// adds the AI pass that swaps in movements suited to what they actually like doing.
// ---- the one way in: bring something or don't, answer a few questions, build ------------------
// Used to be two screens competing for the same job: "Import a plan" read a source and froze its
// numbers exactly as written; "Build with AI" started from nothing. But nobody who has a PDF wants
// a SEPARATE "generate one" option once they have brought it, and nobody starting from nothing
// wants to be asked which screen that is. So: one wizard. Bring a source or skip that step
// entirely, answer how many days and how hard, and it builds - taking a source as INSPIRATION
// (exercise selection, day structure, character) with our own progression and house intensity
// applied on top, not a photocopy of someone else's numbers.
function BlockWizard({ db, update, showToast, isPremium, onUpgrade, onBack, onDraft, onShots, initialUrl }) {
  useBackClose(onBack);
  const t = tdb(db);
  const draftDays = ((t.draft && t.draft.days) || []).length;
  const [whyEmpty, setWhyEmpty] = useState(false);
  const [days, setDays] = useState(t.prefs.daysPerWeek || 4);
  const [goal, setGoal] = useState('hypertrophy');
  const [shape, setShape] = useState(t.prefs.shape || 'build4');
  const [intensity, setIntensity] = useState(t.prefs.intensity || 'high');
  const [minutes, setMinutes] = useState(t.prefs.sessionMinutes || 60);
  const [experience, setExperience] = useState(t.prefs.experience || 'intermediate');
  const [equipment, setEquipment] = useState(t.prefs.equipment || []);
  const [gym, setGym] = useState(() => currentGym(db));
  const [gymPick, setGymPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emphasis, setEmphasis] = useState([]);
  const [wish, setWish] = useState('');
  const [wishNote, setWishNote] = useState(null);
  const [wishBusy, setWishBusy] = useState(false);
  // The intake tabs. A file (screenshot, PDF, spreadsheet, plain text) is the common case and comes
  // first; a shared reel is second because the link is usually already on the clipboard; paste is
  // the fallback when neither exists as a file. All three land in the same place: the draft basket.
  const [tab, setTab] = useState(() => initialUrl ? 'link' : 'file');
  const [url, setUrl] = useState(initialUrl || '');
  const [text, setText] = useState('');
  const [ctx, setCtx] = useState('');
  const [readBusy, setReadBusy] = useState('');
  const [readNote, setReadNote] = useState(null);
  const [readErr, setReadErr] = useState(false);
  const [fails, setFails] = useState([]);   // files that did not read, kept so they can be retried

  /* The live preview. Every answer runs the REAL engine and reads the real block back, so what is
     drawn above the questions is the block you will get rather than a sketch of one. Memoised on the
     answers themselves: building four weeks is cheap but not free, and it must not rerun because a
     text box somewhere else on the screen changed. A throw here is not worth a broken screen, so it
     falls back to no preview and the questions still work. */
  const preview = useMemo(() => {
    try {
      const targets = Training.defaultTargets({ experience: experience, volumeTargets: t.volumeTargets });
      const blk = draftDays > 0
        ? Training.blockFromTemplate(t.draft.days, {
          weeks: 4, shape: shape, intensity: intensity, targets: targets, custom: t.custom,
          name: t.draft.name || 'My block', source: 'import', startISO: null,
        })
        : Training.generateBlock({
          daysPerWeek: days, weeks: 4, shape: shape, intensity: intensity, goal: goal, targets: targets,
          gym: gym, equipment: equipment.length ? equipment : null, dislikes: t.prefs.dislikes,
          custom: t.custom, sessionMinutes: minutes, emphasis: emphasis, source: 'generated',
        });
      const read = readBlock(blk);
      if (!read) return null;
      return Object.assign({ cov: Training.coverage(Training.blockWeekVolume(blk, 1, t.custom), targets) }, read);
    } catch (_) { return null; }
  }, [days, minutes, experience, goal, shape, intensity, emphasis, equipment, gym, draftDays, t.draft, t.custom, t.volumeTargets]);

  // The one-line consequence of the answer you just changed. Without it the panel silently redraws
  // and you are left to spot the difference between two grids of numbers, which nobody does.
  const lastPreview = useRef(null);
  const [changeLine, setChangeLine] = useState('');
  useEffect(() => {
    const before = lastPreview.current;
    lastPreview.current = preview;
    if (!before || !preview) return;
    const inRange = (cov, muscle) => {
      const r = cov.rows.filter(x => x.muscle === muscle)[0];
      return !!r && r.sets >= r.mev && r.sets <= r.mrv;
    };
    const parts = [];
    const d = preview.weekSets - before.weekSets;
    if (d) parts.push((d > 0 ? '+' : '') + d + ' sets a week');
    const fixed = preview.cov.rows.filter(r => inRange(preview.cov, r.muscle) && !inRange(before.cov, r.muscle));
    const broke = preview.cov.rows.filter(r => !inRange(preview.cov, r.muscle) && inRange(before.cov, r.muscle));
    if (fixed.length) parts.push(fixed.slice(0, 2).map(r => r.label.toLowerCase()).join(', ') + ' now in range');
    if (broke.length) parts.push(broke.slice(0, 2).map(r => r.label.toLowerCase()).join(', ') + ' dropped out of range');
    if (preview.minutesEach !== before.minutesEach) parts.push('about ' + preview.minutesEach + ' min a session');
    setChangeLine(parts.join(' · ') || 'nothing else moved');
  }, [preview]);

  // Fold a parse's result into the draft basket: the days, any custom exercises it had to guess at
  // (see Training.importTemplate), and everything worth a second look. One place both the batched
  // file reader and the single-shot link/paste readers write through, so there is exactly one way a
  // source becomes part of the draft rather than two slightly different ones.
  function mergeIntoDraft(tr, parts) {
    const d = tr.draft || { name: (parts[0].parsed && parts[0].parsed.name) || 'My block', days: [] };
    parts.forEach(p => Training.mergeDraftDays(d.days, p.res.template, p.sourceRef));
    const newCustom = parts.reduce((a, p) => a.concat((p.res && p.res.newCustom) || []), []);
    if (newCustom.length) tr.custom = (tr.custom || []).concat(newCustom);
    const gather = (k) => parts.reduce((a, p) => a.concat((p.res && p.res[k]) || []), []);
    d.unresolved = (d.unresolved || []).concat(gather('unresolved'));
    d.mismatches = (d.mismatches || []).concat(gather('mismatches'));
    d.loose = (d.loose || []).concat(gather('loose'));
    d.weekLabel = d.weekLabel || parts.map(p => p.res && p.res.weekLabel).filter(Boolean)[0] || null;
    d.source = 'import';
    tr.draft = d;
  }

  // Read one or more files into the draft basket. Each is read on its own, because a screenshot or
  // a page is one session: batching them into a single call would blur four days into one soup and
  // lose which movement belonged to which day. A single PDF holding a whole programme is still one
  // file and one read - `days` tells the model which of its day-count tracks to pull, or how to
  // adapt a single track to fit, so the FIRST upload can already be the whole thing.
  //
  // Three things this has to survive, all of which it did not before. A single hung request used to
  // stall the whole run with no way out, so every read has a deadline and one retry. Five reads in a
  // row is minutes of staring at a button, so they run a few at a time and the label counts what has
  // FINISHED rather than what has started. And a file that fails is named and offered back, instead
  // of disappearing into an anonymous tally.
  async function readFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (!isPremium) { onUpgrade && onUpgrade('workout_import'); return; }
    const note = ctx;
    setReadErr(false); setReadNote(null); setFails([]);
    let done = 0;
    const label = () => setReadBusy('Read ' + done + ' of ' + list.length + '...');
    label();

    async function readOne(file) {
      const content = withImportNote((await workoutContentFromFile(file)).blocks, note);
      // One retry, because the failure this catches is a dropped request rather than an unreadable
      // file, and re-uploading five of them to fix one is a miserable ask.
      let parsed;
      try {
        parsed = await aiParseWorkout(content, { timeoutMs: 90000, days });
      } catch (e) {
        if (e && e.aiError) throw e;              // a paywall or a quota is not worth asking twice
        parsed = await aiParseWorkout(content, { timeoutMs: 90000, days });
      }
      const res = Training.importTemplate(parsed, { custom: t.custom });
      if (!res.template.length) throw new Error('nothing readable in it');
      return { parsed: parsed, res: res, sourceRef: { kind: 'file', name: file.name || 'a file' } };
    }

    // Results are collected in upload order and written once at the end, so the days land in the
    // order they were picked however the reads happen to finish, and the draft is saved once.
    const results = new Array(list.length).fill(null);
    const fails2 = [];
    let cursor = 0;
    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= list.length) return;
        try { results[i] = await readOne(list[i]); }
        catch (e) { fails2.push({ file: list[i], why: (e && e.message) || 'could not be read' }); }
        done++; label();
      }
    }
    await Promise.all(new Array(Math.min(3, list.length)).fill(0).map(worker));

    const got = results.filter(Boolean);
    // Counted out here, not inside the updater: trainUpdate hands React a function it runs when it
    // pleases, so anything tallied in there is still zero by the time the message below reads it.
    const added = got.reduce((a, r) => a + r.res.template.length, 0);
    if (got.length) trainUpdate(update, (tr) => mergeIntoDraft(tr, got));
    setReadBusy('');
    setFails(fails2);
    if (!added) {
      setReadErr(true);
      setReadNote('I could not read a session out of ' + (list.length === 1 ? 'that' : 'those') + '. A file or screenshot showing the exercise names, sets and reps works best.');
      return;
    }
    setReadErr(false);
    setReadNote(added + (added === 1 ? ' day' : ' days') + ' added to your draft'
      + (fails2.length ? ', and ' + fails2.length + ' I could not read: ' + fails2.map(f => f.file.name || 'a file').join(', ') + '.' : '.')
      + (fails2.length ? ' Try those again, or build below.' : ' Add another, or build below.'));
  }

  // Link and paste are single sources, read the same way but without the batching a pile of files
  // needs. Both land in the same draft basket as a file would. Named distinctly from readFiles'
  // OWN internal readOne (per-file, batched) so the two are never mistaken for each other.
  async function readSingleSource(getContent, sourceRef, busyLabel) {
    if (!isPremium) { onUpgrade && onUpgrade('workout_import'); return; }
    setReadErr(false); setReadNote(null); setReadBusy(busyLabel || 'Reading it');
    try {
      const content = withImportNote(await getContent(), ctx);
      setReadBusy('Working out what it says');
      const parsed = await aiParseWorkout(content, { timeoutMs: 120000, days });
      const res = Training.importTemplate(parsed, { custom: t.custom });
      if (!res.template.length) {
        setReadErr(true);
        setReadNote('I could not find any exercises in that. If it is a video where the plan is only spoken over music, a screenshot of the plan usually works better.');
        setReadBusy(''); return;
      }
      trainUpdate(update, (tr) => mergeIntoDraft(tr, [{ parsed: parsed, res: res, sourceRef: sourceRef }]));
      setReadBusy('');
      setReadNote(res.template.length + (res.template.length === 1 ? ' day' : ' days') + ' added to your draft. Add another, or build below.');
    } catch (e) {
      setReadErr(true);
      setReadNote((e && e.message) || 'That did not work. Try another way in.');
      setReadBusy('');
    }
  }
  function readLink() {
    const u = url.trim();
    if (!u) return;
    readSingleSource(async () => {
      const src = await extractRecipeSource(u);
      if (!src || !src.ok || !src.sourceText) {
        throw new Error('I could not read anything public behind that link. Paste the caption in, or upload a screenshot of the plan.');
      }
      return [{ type: 'text', text: 'This was read from a shared ' + (src.platform || 'social') + ' post. It may include the caption and what the creator says out loud.\n\n' + String(src.sourceText).slice(0, 24000) }];
    }, { kind: 'link', url: u }, 'Reading the post');
  }
  function readPaste() {
    const v = text.trim();
    if (!v) return;
    readSingleSource(async () => [{ type: 'text', text: 'A training plan, pasted in by the person who wants to follow it.\n\n' + v.slice(0, 24000) }], { kind: 'paste' }, 'Reading it');
  }

  const EQUIP = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbells'], ['machine', 'Machines'], ['cable', 'Cables'], ['bodyweight', 'Bodyweight'], ['smith', 'Smith'], ['ez', 'EZ bar'], ['kettlebell', 'Kettlebell'], ['trapbar', 'Trap bar']];

  // Say it in a sentence and the coach fills the form in. Deliberately fills the FORM rather than
  // producing a programme directly, so you still see and can change every answer before anything is
  // built. It is a shortcut through the questions, not a black box that hands you a plan.
  async function askCoach() {
    const v = wish.trim();
    if (!v) return;
    if (!isPremium) { onUpgrade && onUpgrade('workout_import'); return; }
    setWishBusy(true); setWishNote(null);
    try {
      const r = await aiParseTrainingWish(v);
      if (r.daysPerWeek) setDays(Math.max(2, Math.min(6, Math.round(r.daysPerWeek))));
      if (r.sessionMinutes) setMinutes(Math.max(30, Math.min(120, Math.round(r.sessionMinutes))));
      if (r.experience) setExperience(r.experience);
      if (r.goal) setGoal(r.goal);
      if (r.equipment && r.equipment.length) setEquipment(r.equipment.filter(e => EQUIP.some(([v2]) => v2 === e)));
      const em = musclesFromLabels(r.emphasis);
      if (em.length) setEmphasis(em);
      setWishNote(r.note || 'Filled in what I could from that.');
    } catch (e) {
      setWishNote('I could not make sense of that, but you can set it all below anyway.');
    }
    setWishBusy(false);
  }

  // Build from whatever is in the draft basket if anything is, else from the form alone. Either way
  // this is the ONE build action: a source is inspiration the engine periodises on top of, at
  // whatever shape and intensity are set below, not a frozen photocopy of someone else's numbers.
  function build() {
    setBusy(true);
    const targets = Training.defaultTargets({ experience: experience, volumeTargets: t.volumeTargets });
    let block;
    if (draftDays > 0) {
      block = Training.blockFromTemplate(t.draft.days, {
        weeks: 4, shape: shape, intensity: intensity, targets: targets, custom: t.custom,
        name: t.draft.name || 'My block', source: 'import', startISO: null,
        sourceRef: { kind: 'draft', days: t.draft.days.length, importedISO: Store.todayISO() },
      });
    } else {
      block = Training.generateBlock({
        daysPerWeek: days, weeks: 4, shape: shape, intensity: intensity, goal: goal, targets: targets,
        gym: gym, equipment: equipment.length ? equipment : null,
        dislikes: t.prefs.dislikes, custom: t.custom,
        sessionMinutes: minutes, emphasis: emphasis, source: 'generated',
      });
    }
    block.gymId = gym ? gym.id : null;
    // Remember the answers, so the next block does not ask again.
    trainUpdate(update, (tr) => {
      tr.prefs = Object.assign({}, tr.prefs, {
        daysPerWeek: days, sessionMinutes: minutes, experience: experience, equipment: equipment,
        shape: shape, intensity: intensity,
      });
    });
    setBusy(false);
    onDraft(block, { clearDraft: draftDays > 0 });
  }

  return (
    <div className="fade-in">
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={onBack} className="pf text-[9px] uppercase hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
        {preview && <span className="text-[10.5px]" style={{ color: 'var(--muted2)' }}>about {preview.minutesEach} min a session</span>}
      </div>
      <h1 className="pf text-lg mt-2 mb-1">Build a block</h1>

      {/* The block, drawn, while you are still answering. */}
      <BlockPreview preview={preview} changeLine={changeLine} brought={draftDays > 0} sourceCount={draftDays} />

      {/* Bringing something beats describing it, and describing it beats filling in a form - so this
          sits first, and it is entirely optional: skip straight to the questions below for a block
          built from nothing. Whatever comes in here is INSPIRATION, not a photocopy: the engine
          still owns the numbers, at the shape and intensity chosen further down. */}
      <Card className="p-4 mb-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Bring a programme (optional)</div>
        <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
          A PDF, a spreadsheet, a coach's message, a reel, or just the text. Set the day count below first if the source offers more than one version, so I pull the right one. Skip this entirely and I will write you one from nothing.
        </div>

        <div className="mb-4"><Pill value={tab} onChange={setTab} options={[{ v: 'file', l: 'File' }, { v: 'link', l: 'Link' }, { v: 'paste', l: 'Paste' }]} /></div>

        {/* The note sits ABOVE the picker, because on a phone the file chooser takes over the screen
            the moment you tap it and whatever you meant to type never gets typed. */}
        <Field label="Anything I should know" hint={IMPORT_NOTE_HINT}>
          <textarea value={ctx} onChange={e => setCtx(e.target.value)} rows={2}
            placeholder="This is the 5 day option. Weights are in pounds."
            className="w-full pixel-box px-3 py-3 text-[13px]" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
        </Field>

        {tab === 'file' && (
          <label className={'pixel-box flex items-center justify-center h-12 text-[12.5px] ' + (readBusy ? 'opacity-60' : 'cursor-pointer')} style={{ background: 'var(--surface2)' }}>
            {readBusy || (isPremium ? 'Choose file(s)' : 'Choose file(s) · Premium')}
            <input type="file" className="hidden" accept=".pdf,.xlsx,.csv,.tsv,.txt,.md,image/*" multiple disabled={!!readBusy}
              onChange={e => { readFiles(e.target.files); e.target.value = ''; }} />
          </label>
        )}
        {tab === 'link' && (
          <div>
            <div className="mb-2"><TextInput value={url} onChange={e => setUrl(e.target.value)} placeholder="Instagram, TikTok or YouTube link" /></div>
            <button onClick={readLink} disabled={!!readBusy || !url.trim()} className="pixel-box w-full h-11 text-[12.5px]" style={{ background: 'var(--surface2)' }}>
              {readBusy || 'Read it'}
            </button>
          </div>
        )}
        {tab === 'paste' && (
          <div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={6}
              placeholder={'Monday - Push\nBench press 4x6-8\nIncline DB press 3x10\n...'}
              className="w-full pixel-box px-3 py-3 text-[13px] mb-2" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
            <button onClick={readPaste} disabled={!!readBusy || !text.trim()} className="pixel-box w-full h-11 text-[12.5px]" style={{ background: 'var(--surface2)' }}>
              {readBusy || 'Read it'}
            </button>
          </div>
        )}

        {readBusy && (
          <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--muted2)' }}>
            Each file is read on its own so the days stay separate, so a handful takes a moment.
          </div>
        )}
        {readNote && <div className="text-[12px] mt-2 leading-snug" style={{ color: readErr ? 'var(--danger)' : 'var(--accent-ink)' }}>{readNote}</div>}
        {/* Whatever failed is still in memory, so retrying is a tap rather than another trip through
            the file picker hunting for which four of the five already worked. */}
        {!readBusy && fails.length > 0 && (
          <button onClick={() => readFiles(fails.map(f => f.file))}
            className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>
            Try {fails.length === 1 ? 'that one' : 'those ' + fails.length} again
          </button>
        )}

        {draftDays > 0 && (
          <div className="text-[12px] mt-3 pt-3 leading-snug border-t" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
            {draftDays} {draftDays === 1 ? 'day' : 'days'} in your draft so far.{' '}
            <button onClick={onShots} className="underline" style={{ color: 'var(--accent-ink)' }}>Review it</button>
          </div>
        )}
      </Card>

      <Card className="p-4 mb-6">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Or tell the coach</div>
        <textarea value={wish} onChange={e => setWish(e.target.value)} rows={2}
          placeholder="4 days a week, full gym, want to bring my shoulders up"
          className="w-full pixel-box px-3 py-3 text-[13px] mb-2" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
        <button onClick={askCoach} disabled={wishBusy || !wish.trim()} className="pixel-box w-full h-11 text-[12.5px]" style={{ background: 'var(--surface2)' }}>
          {wishBusy ? 'Reading that...' : isPremium ? 'Fill it in for me' : 'Fill it in for me · Premium'}
        </button>
        {wishNote && <div className="text-[12px] mt-2 leading-snug" style={{ color: 'var(--accent-ink)' }}>{wishNote}</div>}
      </Card>

      <TrainField label="Days a week" effect={preview ? preview.sessions.length + ' sessions' : ''}
        hint="Also which track I pull from a source that offers more than one.">
        <Seg value={days} onChange={setDays} options={[2, 3, 4, 5, 6].map(n => ({ v: n, l: String(n) }))} />
      </TrainField>
      <TrainField label="How long a session" effect={preview ? preview.movesEach + ' movements' : ''}
        hint="Decides how many movements fit.">
        <Seg value={minutes} onChange={setMinutes} options={[{ v: 40, l: '40 min' }, { v: 60, l: '60 min' }, { v: 80, l: '80 min' }, { v: 100, l: '100 min' }]} />
      </TrainField>
      <TrainField label="Where you are" effect={preview ? preview.weekSets + ' sets' : ''}
        hint="Sets your starting volume. Movable later.">
        <Seg value={experience} onChange={setExperience} options={[{ v: 'beginner', l: 'Newer' }, { v: 'intermediate', l: 'A while' }, { v: 'advanced', l: 'Years' }]} />
      </TrainField>
      <TrainField label="Goal" hint="Shifts rep ranges and what leads each session.">
        <Seg value={goal} onChange={setGoal} options={[{ v: 'hypertrophy', l: 'Muscle' }, { v: 'strength', l: 'Strength' }, { v: 'general', l: 'General' }]} />
      </TrainField>
      {/* The house default: high intensity, lower volume, training close to failure - what the
          research on proximity to failure and the reference programmes this app is built from both
          point at. A real choice, not a hidden constant: pick moderate for more sets and effort that
          stops a few reps short every week instead. */}
      <TrainField label="Training intensity" hint={intensity === 'high'
        ? 'High intensity, lower volume: fewer sets, closer to true failure by the last week. Our default.'
        : 'More volume, moderate effort: more sets, always a rep or two in reserve.'}>
        <Seg value={intensity} onChange={setIntensity} options={[{ v: 'high', l: 'High intensity' }, { v: 'moderate', l: 'More volume' }]} />
      </TrainField>
      <TrainField label="Block shape" hint={Training.SHAPES[shape].label}>
        <Seg value={shape} onChange={setShape} options={[
          { v: 'build4', l: 'Build 4' }, { v: 'build3-deload1', l: '3 + light week' },
          { v: 'as-written', l: 'As brought' },
        ]} />
      </TrainField>
      {/* A gym, not a checkbox grid. It decides both what is available and what to reach for first,
          which is why it replaced the nine tick boxes that used to live here. */}
      <Field label="Where you will train it" hint="Changes which movements the block reaches for.">
        <button onClick={() => setGymPick(true)} className="w-full text-left pixel-box p-4 flex items-center justify-between gap-2" style={{ background: 'var(--surface2)' }}>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold truncate">{gym ? gym.name : 'Choose a gym'}</span>
            <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{gym ? gymSummary(gym) : 'Nothing saved yet'}</span>
          </span>
          <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
        </button>
      </Field>

      {/* Seventeen chips and a forty-five word justification, for a field whose own label says
          "Optional". They were nearly half the controls on this screen and the first thing you met
          before the button that actually builds the block. Folded behind the same inline disclosure
          the screen already opens with, so the default is calm and nothing is lost: the summary
          names what you picked, so a closed row still tells you where you stand. */}
      {/* Out of the disclosure it was folded into. Hiding it made the screen calmer and made the
          field useless: nobody opens a closed row labelled "Optional", so the one question on this
          screen that is about YOUR body rather than your diary was the one nobody answered. It earns
          the space now because every chip you press moves the panel above, so the trade it makes is
          visible instead of promised. */}
      <TrainField label="Anything to bring up"
        effect={emphasis.length ? emphasis.length + ' picked' : ''}
        hint="Whatever you pick starts nearer the top of its useful range, and the rest eases back to pay for it.">
        <div className="flex gap-2 flex-wrap">
          {Training.MUSCLES.map(m => (
            <button key={m} onClick={() => setEmphasis(emphasis.indexOf(m) !== -1 ? emphasis.filter(x => x !== m) : emphasis.concat([m]))}
              className="pixel-box px-2.5 text-[11px]" style={{
                minHeight: 44,
                background: emphasis.indexOf(m) !== -1 ? 'var(--good)' : 'var(--surface2)',
                color: emphasis.indexOf(m) !== -1 ? '#05140a' : 'var(--text2)',
              }}>
              {Training.MUSCLE_LABEL[m]}
            </button>
          ))}
        </div>
      </TrainField>

      {draftDays > 0 && (
        <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
          Building from the {draftDays} {draftDays === 1 ? 'day' : 'days'} you have brought, at the shape and intensity above.
        </div>
      )}
      <button onClick={build} disabled={busy} className="pixel-btn w-full h-14 font-bold mt-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
        {busy ? 'Building...' : draftDays > 0 ? 'Build it from what I brought' : 'Build it'}
      </button>

      {gymPick && <GymPicker db={db} update={update} onClose={() => setGymPick(false)}
        onPicked={(g) => { setGym(g); setGymPick(false); }} />}
      <div className="text-[11px] mt-3 leading-snug" style={{ color: 'var(--muted2)' }}>
        Nothing is saved until you say so.
      </div>
    </div>
  );
}

// ---- block builder / editor -------------------------------------------------------------------
function BlockBuilder({ db, update, showToast, isPremium, blockId, draft, clearDraft, onBack, onStart }) {
  useBackClose(onBack);
  const t = tdb(db);
  const saved = blockId ? t.blocks.filter(b => b.id === blockId)[0] : null;
  const [block, setBlock] = useState(() => JSON.parse(JSON.stringify(draft || saved || Training.generateBlock({ daysPerWeek: 4, weeks: 4 }))));
  const [week, setWeek] = useState(1);
  const [picking, setPicking] = useState(null);   // { sessionId }
  const [name, setName] = useState(block.name);
  const [startISO, setStartISO] = useState(block.startISO || Store.todayISO());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [share, setShare] = useState(() => !!(saved && saved.shared));
  const [weekPick, setWeekPick] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(null);
  const skipSwitchCheck = useRef(false);
  const [openDay, setOpenDay] = useState(null);
  // Which days of this block already have a session logged against them, so a finished day reads as
  // finished here as well as on the Train tab.
  const logBySession = Training.completion(block, tdb(db).logs).logBySession;
  const targets = trainTargets(db);
  const isNew = !saved;

  const sessions = Training.weekSessions(block, week).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const cov = Training.coverage(Training.blockWeekVolume(block, week, t.custom), targets);

  function edit(fn) { setBlock(b => { const n = JSON.parse(JSON.stringify(b)); fn(n); return n; }); }
  function setSets(sessionId, itemId, delta) {
    edit(b => {
      const s = b.sessions.filter(x => x.id === sessionId)[0];
      const it = s.exercises.filter(x => x.id === itemId)[0];
      it.target.sets = Math.max(1, Math.min(8, it.target.sets + delta));
    });
  }
  function removeItem(sessionId, itemId) {
    edit(b => { const s = b.sessions.filter(x => x.id === sessionId)[0]; s.exercises = s.exercises.filter(x => x.id !== itemId); });
  }
  function addItem(sessionId, exId) {
    setPicking(null);
    edit(b => {
      const s = b.sessions.filter(x => x.id === sessionId)[0];
      const ex = Training.byId(exId, t.custom);
      const compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
      s.exercises.push({
        id: exId + '_' + trainUid(), exerciseId: exId, order: s.exercises.length,
        target: { sets: 2, repLow: compound ? 6 : 8, repHigh: compound ? 10 : 12, rir: Math.max(0, 4 - s.week), restSec: compound ? 150 : 120 },
      });
    });
  }
  // `later` saves the block to your shelf without beginning it: no start date, nothing retired, and
  // no question about switching, because nothing is being switched. Building a plan and running a
  // plan are separate decisions, and an app that can only do both at once makes you keep a coach's
  // programme in your camera roll until the week you are ready for it.
  function save(later) {
    // Abandoning a block halfway is the most common way people make no progress: nothing runs long
    // enough to tell you whether it worked. So starting a second one while the first is still going
    // asks once. It is a question, not a block: their training, their call.
    if (isNew && !later && !skipSwitchCheck.current) {
      const live = activeBlock(db);
      if (live && !Training.blockProgress(live, Store.todayISO()).done) {
        setConfirmSwitch(live);
        return;
      }
    }
    const out = Object.assign({}, block, {
      name: name.trim() || block.name,
      startISO: later ? null : startISO,
      shared: share,
    });
    trainUpdate(update, (tr) => {
      const i = tr.blocks.findIndex(b => b.id === out.id);
      if (i >= 0) tr.blocks[i] = out;
      else {
        // Starting a new block retires whatever was running, so "the current block" is never
        // ambiguous. Saving one for later retires nothing: it is not competing with anything yet.
        if (!later) tr.blocks.forEach(b => { if (!b.archived) b.archived = true; });
        tr.blocks.push(out);
      }
      // A block built out of the draft basket consumes it, so the same days cannot be built twice.
      if (clearDraft) tr.draft = null;
    });
    // Publishing is fire and forget: it must never be able to fail the save of your own block.
    if (share) submitPublicBlock(out, tdb(db).prefs, tdb(db).custom);
    else if (saved && saved.shared) retractPublicBlock(out.id);
    showToast && showToast(later ? 'Saved to your blocks. Start it whenever you like.'
      : isNew ? 'Block saved. First session is ready.' : 'Block updated.');
    onBack();
  }
  function remove() {
    if (saved && saved.shared) retractPublicBlock(block.id);
    trainUpdate(update, (tr, d) => { tr.blocks = tr.blocks.filter(b => b.id !== block.id); tombstone(d, [block.id]); });
    showToast && showToast('Block deleted.');
    onBack();
  }

  return (
    <div className="fade-in pb-24">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-4">{isNew ? 'Your new block' : 'Edit block'}</h1>

      <Field label="Name"><TextInput value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Starts" hint="Week 1 runs from this date.">
        <input type="date" value={startISO} onChange={e => setStartISO(e.target.value)}
          className="w-full pixel-box px-3 py-3 text-[14px]" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
      </Field>

      {/* The week you are looking at, and the dates it covers. A row of "W1 W2 W3 W4" tabs told you
          which week but never WHEN, so you could not tell whether you were looking at this week or
          one three weeks out. A named range answers both. */}
      <button onClick={() => setWeekPick(!weekPick)} className="w-full pixel-box p-4 mb-2 flex items-center justify-between gap-2" style={{ background: 'var(--card)' }}>
        <span className="min-w-0 text-left">
          <span className="pf text-[10px] block" style={{ color: 'var(--accent-ink)' }}>
            Week {week}{Training.weekSessions(block, week).some(x => x.deload) ? ' · deload' : ''}
          </span>
          <span className="block text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{weekRangeLabel(startISO, week)}</span>
        </span>
        <span style={{ color: 'var(--muted2)', transform: weekPick ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>
          <Icon.chevron width="16" height="16" />
        </span>
      </button>
      {weekPick && (
        <div className="mb-4">
          {Array.from({ length: block.weeks }, (_, i) => i + 1).map(w => {
            const deload = Training.weekSessions(block, w).some(x => x.deload);
            return (
              <button key={w} onClick={() => { setWeek(w); setWeekPick(false); }}
                className="w-full pixel-box p-3 mb-2 flex items-center justify-between gap-2 text-left"
                style={{ background: week === w ? 'color-mix(in srgb, var(--accent) 16%, var(--surface2))' : 'var(--surface2)' }}>
                <span className="pf text-[10px]" style={{ color: week === w ? 'var(--accent-ink)' : 'var(--text2)' }}>Week {w}</span>
                <span className="text-[11px]" style={{ color: deload ? 'var(--warn)' : 'var(--muted)' }}>
                  {deload ? 'deload' : weekRangeLabel(startISO, w)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ---- Week volume, per `Build a block v3.dc.html` ----
          Every muscle, not the worst five, and drawn as a POSITION on its own MEV-to-MRV band rather
          than as a bar filling up. The distinction matters here more than anywhere: a filling bar
          says more is better, and the entire point of this panel is that there is a top to the range
          as well as a bottom. The legend is there because a shaded band and a marker mean nothing
          until somebody says once what they are. */}
      <Card className="p-4 mb-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="pf text-[9px] uppercase" style={{ color: 'var(--muted)' }}>Week {week} volume</div>
          <div className="text-[11px]" style={{ color: cov.gaps.length || cov.overs.length ? 'var(--warn)' : 'var(--good)' }}>
            {cov.totalSets} sets · {cov.overs.length ? cov.overs.length + ' past recovery' : cov.gaps.length ? cov.gaps.length + ' short' : 'all covered'}
          </div>
        </div>
        <CoverageBars coverage={cov} />
      </Card>

      {/* Day cards, in the same language as the session screen: the coach's letter code, the
          movement, then sets / reps / tempo on one line. Reading the plan and running the plan
          should not look like two different apps. */}
      {sessions.map(s => {
        const ordered = s.exercises.slice().sort((a, b) => a.order - b.order);
        const codes = Training.sessionCodes(ordered.map(e => ({ superset: e.supersetGroup || null })));
        const log = logBySession[s.id];
        const open = openDay === s.id;
        return (
          <div key={s.id} className="pixel-box mb-4" style={{ background: 'var(--card)' }}>
            <button onClick={() => setOpenDay(open ? null : s.id)} className="w-full flex items-center gap-2 p-4 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold leading-tight">{s.name}</span>
                <span className="block text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
                  {WEEKDAYS[s.dayOfWeek] || 'Day ' + (s.dayOfWeek + 1)} · {ordered.length} movements · {ordered.reduce((a, e) => a + e.target.sets, 0)} sets
                </span>
              </span>
              {log
                ? <span className="shrink-0 w-6 h-6 flex items-center justify-center text-[13px] font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}><Tick size={12} /></span>
                : <span className="shrink-0" style={{ color: 'var(--muted2)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><Icon.chevron width="16" height="16" /></span>}
            </button>

            {open && (
              <div className="px-4 pb-4">
                {ordered.map((it, ei) => (
                  <div key={it.id} className="py-3" style={{ borderTop: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }}>
                    <div className="flex items-start gap-2">
                      <span className="pf text-[9px] shrink-0 mt-0.5 w-6" style={{ color: 'var(--accent-ink)' }}>{codes[ei]}</span>
                      <span className="flex-1 min-w-0 text-[13px] font-semibold leading-tight">
                        <ExerciseName id={it.exerciseId} custom={t.custom} />
                      </span>
                      <button onClick={() => removeItem(s.id, it.id)} aria-label="Remove" className="px-1 text-[15px] shrink-0" style={{ color: 'var(--muted2)' }}>&times;</button>
                    </div>
                    <div className="flex items-center gap-2 mt-2 pl-8">
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setSets(s.id, it.id, -1)} className="pixel-box w-7 h-7 text-[13px]" style={{ background: 'var(--surface2)' }}>-</button>
                        <div className="w-14 text-center text-[11px] tnum" style={{ color: 'var(--muted)' }}>{it.target.sets} sets</div>
                        <button onClick={() => setSets(s.id, it.id, 1)} className="pixel-box w-7 h-7 text-[13px]" style={{ background: 'var(--surface2)' }}>+</button>
                      </div>
                      <div className="flex-1 flex items-baseline justify-end gap-3 text-[11px] tnum" style={{ color: 'var(--muted)' }}>
                        <span>{it.target.repLow}-{it.target.repHigh} reps</span>
                        <span>{it.target.tempo || '2010'} tempo</span>
                      </div>
                    </div>
                  </div>
                ))}
                <button onClick={() => setPicking({ sessionId: s.id })} className="pixel-box w-full h-11 text-[11.5px] mt-3" style={{ background: 'var(--surface2)' }}>+ Add movement</button>
                {onStart && !log && (
                  <button onClick={() => onStart(s, block)} className="pixel-btn w-full h-12 font-bold mt-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                    Start this session
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <StickyAction>
        {/* Two exits on a new block, because building one and beginning one are separate decisions.
            Keeping it is the quieter of the two and sits on the left. */}
        {isNew ? (
          <div className="flex gap-2">
            <button onClick={() => save(true)} className="pixel-box flex-1 h-14 text-[12.5px]" style={{ background: 'var(--surface2)' }}>
              Save for later
            </button>
            <button onClick={() => save(false)} className="pixel-btn flex-1 h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
              Start it now
            </button>
          </div>
        ) : (
          <button onClick={() => save(false)} className="pixel-btn w-full py-4 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Save changes
          </button>
        )}
      </StickyAction>

      {/* Sharing publishes ONE WEEK, not your logged sessions and nothing about you. Worth saying
          plainly right next to the switch, because "share my block" could reasonably be read as
          "share my training diary". */}
      <button onClick={() => setShare(!share)} className="w-full flex items-center justify-between gap-3 pixel-box p-4 mb-4 text-left" style={{ background: 'var(--card)' }}>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">Share this block</span>
          <span className="block text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>
            Puts the plan in the library for other members to run. Your sessions, weights and name stay private.
          </span>
        </span>
        <span className="pf text-[9px] px-3 py-2 shrink-0" style={{ background: share ? 'var(--accent)' : 'var(--surface3)', color: share ? 'var(--on-accent)' : 'var(--muted)', border: '2px solid var(--border)' }}>
          {share ? 'ON' : 'OFF'}
        </span>
      </button>

      {!isNew && (
        <button onClick={() => setConfirmDelete(true)} className="w-full py-3 text-[12px] mt-2" style={{ color: 'var(--danger)' }}>Delete this block</button>
      )}

      {picking && <ExercisePicker db={db} update={update} onPick={(id) => addItem(picking.sessionId, id)} onClose={() => setPicking(null)} />}
      {confirmDelete && <ConfirmDialog title="Delete this block?" body="The sessions you already logged are kept. Only the plan goes."
        onConfirm={remove} onClose={() => setConfirmDelete(false)} />}
      {confirmSwitch && (() => {
        const prog = Training.blockProgress(confirmSwitch, Store.todayISO());
        return (
          <ConfirmDialog
            title={'You are on week ' + prog.week + ' of ' + confirmSwitch.weeks}
            body={'"' + confirmSwitch.name + '" has not finished yet. Four weeks is about the shortest run that tells you whether something is working, so it is usually worth seeing out. Start this one instead?'}
            confirmLabel="Start the new one" confirmKind="primary"
            onConfirm={() => { skipSwitchCheck.current = true; setConfirmSwitch(null); setTimeout(() => save(false), 0); }}
            onClose={() => setConfirmSwitch(null)} />
        );
      })()}
    </div>
  );
}

/* ---- what is in a session, and how to change it, before you commit to it -----------------------
   Tapping a day used to drop you straight into the player, which STARTS a session: it stamps a start
   time, and from the second visit onwards the app treats it as one you are part-way through. Most
   taps are not that. They are "what am I doing tonight", asked on the bus, and the answer should not
   begin a workout. So the tap opens the plan and Start begins it.

   This screen is now also where you CHANGE it. Until it was, altering the week meant one of two bad
   options: start the session you did not want to start yet and swap the movement inside it, leaving
   a phantom half-finished session behind, or go two hops into the block editor, which asks a
   different question entirely (it edits the four-week programme, not this Thursday).

   Rearranging the week ahead is a weekly, casual, low-stakes act. The gym is shut, a machine is
   taken, your Wednesday moved. It belongs here, in the place people already look, and not behind a
   mode switch: every row opens its own menu, which is the same gesture the session player uses for
   the same job, so the plan and the running of it stay one app.

   Scope. Sets, reps, order, add and remove change THIS session, which is this week's copy, and the
   screen says so. A swap is the one edit likely to be permanent (a grip that suits you better, a
   machine your gym does not have), so it asks the same question the player asks, with the same
   words and the same reach count. */
function SessionPreview({ db, update, showToast, session, block, onBack, onStart }) {
  useBackClose(onBack);
  const t = tdb(db);
  const units = t.prefs.units;
  const [menuFor, setMenuFor] = useState(null);   // item id whose options sheet is open
  const [tuning, setTuning] = useState(null);     // item id whose sets/reps editor is open
  const [picking, setPicking] = useState(null);   // { mode: 'add' } | { mode: 'swap', itemId }
  const [dayPick, setDayPick] = useState(false);
  const [swapScope, setSwapScope] = useState(null);
  const [undo, setUndo] = useState(null);         // the last removal, restorable for as long as you stay
  // Read the session back off the block on every render, so an edit shows immediately rather than
  // this screen holding a copy that drifts away from what was saved.
  const live = block ? ((block.sessions || []).filter(s => s.id === session.id)[0] || session) : session;
  const items = Training.sessionItems(live);
  const codes = Training.sessionCodes(items);
  const sets = items.reduce((a, e) => a + (e.target.sets || 0), 0);
  const mins = sessionMins(items);
  const log = t.logs.filter(l => l.sessionId === live.id)[0];
  const prog = block ? Training.blockProgress(block, Store.todayISO()) : null;
  const editable = !!(block && update);

  // Every edit goes through here: find this session inside the stored block and mutate it in place.
  // Training owns what the edit MEANS (ordering, clamping, whether a superset survives); this only
  // owns finding the right row and saying what happened.
  function edit(fn, say) {
    if (!editable) return;
    trainUpdate(update, (tr) => {
      const b = tr.blocks.filter(x => x.id === block.id)[0];
      if (!b) return;
      const s = (b.sessions || []).filter(x => x.id === live.id)[0];
      if (s) fn(s, b);
    });
    if (say && showToast) showToast(say);
  }

  function removeItem(itemId) {
    const row = items.filter(x => x.id === itemId)[0];
    const ex = row && Training.byId(row.exerciseId, t.custom);
    // Keep the whole row, not just its id: putting it back has to restore its sets, reps and place
    // in the order, or "undo" is a word for something else.
    setUndo(row ? { row: JSON.parse(JSON.stringify(row)), at: items.indexOf(row) } : null);
    edit(s => Training.removeExerciseFromSession(s, itemId));
    if (showToast) showToast((ex ? ex.name : 'Movement') + ' taken out. Tap undo below to put it back.');
  }
  function undoRemove() {
    if (!undo) return;
    const ex = Training.byId(undo.row.exerciseId, t.custom);
    edit(s => {
      const list = Training.sessionItems(s);
      list.splice(Math.min(undo.at, list.length), 0, undo.row);
      list.forEach((e, i) => { e.order = i; });
      s.exercises = list;
    });
    setUndo(null);
    // Replace the "taken out, tap undo" toast rather than leaving it up: it is still on screen at
    // this point and it now describes the opposite of what is true.
    if (showToast) showToast((ex ? ex.name : 'It') + ' is back where it was.');
  }
  // Every argument is passed in rather than read off state, because the sheet that calls this closes
  // itself first: reaching back for `picking.itemId` afterwards would find it already cleared.
  function doSwap(itemId, fromId, exId, scope) {
    edit((s, b) => {
      if (scope === 'block') Training.swapInBlock(b, fromId, exId, prog ? prog.week : 1);
      else {
        const it = (s.exercises || []).filter(x => x.id === itemId)[0];
        if (it) it.exerciseId = exId;
      }
    });
    const to = Training.byId(exId, t.custom);
    if (showToast) showToast(scope === 'block' ? 'Swapped for the rest of the block.' : (to ? to.name : 'Swapped') + ' for this session.');
  }

  const item = menuFor ? items.filter(x => x.id === menuFor)[0] : null;
  const itemIndex = item ? items.indexOf(item) : -1;
  const itemEx = item ? Training.byId(item.exerciseId, t.custom) : null;
  const tuneRow = tuning ? items.filter(x => x.id === tuning)[0] : null;

  return (
    <div className="fade-in pb-28">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>
        {prog ? 'Week ' + prog.week + ' of ' + block.weeks : 'Tonight'}
      </div>
      <h1 className="text-[19px] font-bold leading-tight mb-2">{live.name}</h1>
      <div className="text-[12px] mb-4 tnum" style={{ color: 'var(--muted)' }}>
        {items.length} movements &middot; {sets} sets &middot; about {mins} min
        {live.deload ? ' · deload week' : ''}
      </div>

      {/* Which day this one falls on, and a tap to move it. Real weeks do not run in order: the gym
          is shut, Wednesday moved, legs went to Thursday. Moving it here changes THIS week only,
          because every week carries its own copy, which is what somebody rearranging one week means. */}
      {editable && (
        <button onClick={() => setDayPick(true)}
          className="w-full pixel-box p-4 mb-4 flex items-center justify-between gap-3 text-left" style={{ background: 'var(--card)' }}>
          <span className="min-w-0">
            <span className="pf text-[9px] uppercase block" style={{ color: 'var(--muted)' }}>Day</span>
            <span className="block text-[13.5px] font-semibold mt-1">{WEEKDAYS_FULL[live.dayOfWeek] || 'Not set'}</span>
            {prog && <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted2)' }}>This week only. Later weeks stay as they are.</span>}
          </span>
          <span className="pf text-[9px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>Move</span>
        </button>
      )}

      {log && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--good) 12%, var(--surface2))' }}>
          <div className="text-[12px] leading-snug">
            You logged this one {relativeDay(log.dateISO, Store.todayISO()).toLowerCase()}, {(log.sets || []).filter(s => s.done).length} sets. Opening it again picks up where you left off.
          </div>
        </Card>
      )}

      {items.map((it, i) => {
        const ex = Training.byId(it.exerciseId, t.custom);
        // A grip you have never used has no history of its own, and a blank row on the way into a
        // session is worse than useless when the number you want is sitting under the movement it
        // came from. Borrowed numbers say whose they are; the personal best stays per lift.
        const ref = Training.lastReference(t.logs, it.exerciseId, Store.todayISO(), t.custom);
        const last = ref && ref.best;
        const refFrom = ref && ref.borrowed ? (Training.byId(ref.fromId, t.custom) || {}).name : null;
        const body = (
          <>
            <span className="pf text-[10px] shrink-0 w-6 mt-0.5" style={{ color: 'var(--accent-ink)' }}>{codes[i]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold leading-tight">{ex ? ex.name : it.exerciseId}</span>
              <span className="block text-[11px] tnum mt-1" style={{ color: 'var(--muted)' }}>
                {it.target.sets} x {it.target.repLow}-{it.target.repHigh} &middot; {it.target.rir} RIR
                {it.target.tempo ? ' · ' + it.target.tempo + ' tempo' : ''}
              </span>
              {/* What you did last time is the number you actually want before you set off. */}
              {last && last.weightKg > 0 && (
                <span className="block text-[11px] tnum mt-0.5" style={{ color: 'var(--muted2)' }}>
                  {refFrom ? 'On ' + refFrom + ' ' : 'Last time '}
                  {toDisplayWeight(last.weightKg, units)}{unitLabel(units)} x {last.repsAtBest}
                  {refFrom ? ' · new to this one' : ''}
                </span>
              )}
            </span>
          </>
        );
        if (!editable) return <Card key={it.id || i} className="p-4 mb-3"><div className="flex items-start gap-3">{body}</div></Card>;
        return (
          <button key={it.id || i} onClick={() => setMenuFor(it.id)}
            aria-label={'Change ' + (ex ? ex.name : 'this movement')}
            className="w-full text-left pixel-box p-4 mb-3 flex items-start gap-3" style={{ background: 'var(--card)' }}>
            {body}
            <span className="shrink-0 mt-1" style={{ color: 'var(--muted2)' }}><Icon.chevron width="16" height="16" /></span>
          </button>
        );
      })}

      {editable && (
        <>
          <button onClick={() => setPicking({ mode: 'add' })} className="pixel-box w-full h-11 text-[12px] mb-3" style={{ background: 'var(--surface2)' }}>
            + Add a movement
          </button>
          {/* Undo lives on the screen rather than inside a toast that has already slid away. Taking a
              movement out is the one edit here that loses work, and the toast is gone in five seconds. */}
          {undo && (
            <button onClick={undoRemove} className="pixel-box w-full h-11 text-[12px] mb-3"
              style={{ background: 'color-mix(in srgb, var(--accent) 14%, var(--surface2))', color: 'var(--accent-ink)' }}>
              Undo: put {(Training.byId(undo.row.exerciseId, t.custom) || {}).name || 'it'} back
            </button>
          )}
          {/* Name the gesture. A chevron says "this opens something", never "this is how you change
              it", and the whole point of the screen is lost on somebody who does not tap a row. */}
          <div className="text-[11px] leading-snug mb-4 text-center" style={{ color: 'var(--muted2)' }}>
            {log
              ? 'Tap a movement to change it. You already logged this one, so edits change the plan for the week rather than what you did.'
              : 'Tap a movement to swap it, change its sets and reps, reorder it or take it out. Everything saves as you go, applies to this week, and none of it starts a session.'}
          </div>
        </>
      )}

      <StickyAction>
        <button onClick={onStart} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          {log ? 'Carry on with it' : 'Start ' + live.name.split(' - ')[0]}
        </button>
      </StickyAction>

      {/* One movement's options. Same sheet, same order, same words as the session player's, because
          it is the same job asked in a different room. */}
      {item && (
        <ActionSheet title={itemEx ? itemEx.name : 'This movement'} onClose={() => setMenuFor(null)}
          actions={[
            { label: 'Swap it', sub: 'Something else that trains the same thing', onClick: () => setPicking({ mode: 'swap', itemId: item.id }) },
            { label: 'Sets and reps', sub: item.target.sets + ' x ' + item.target.repLow + '-' + item.target.repHigh + ' at ' + item.target.rir + ' RIR', onClick: () => setTuning(item.id) },
            {
              label: item.supersetGroup ? 'Break the superset' : 'Superset with the next one',
              sub: item.supersetGroup ? 'Do it on its own again' : (items[itemIndex + 1] && !items[itemIndex + 1].supersetGroup
                ? 'Back to back with ' + ((Training.byId(items[itemIndex + 1].exerciseId, t.custom) || {}).name || 'the next movement')
                : 'Nothing free to pair it with'),
              disabled: !item.supersetGroup && !(items[itemIndex + 1] && !items[itemIndex + 1].supersetGroup),
              onClick: () => edit(s => Training.toggleSuperset(s, item.id)),
            },
            // keepOpen: reordering is the one thing here you do several times in a row, and closing
            // the sheet after each step would make moving the last movement to the top fifteen taps.
            { label: 'Move up', sub: itemIndex <= 0 ? 'Already first' : 'Above ' + ((Training.byId((items[itemIndex - 1] || {}).exerciseId, t.custom) || {}).name || 'the one before'),
              disabled: itemIndex <= 0, keepOpen: true, onClick: () => edit(s => Training.moveExercise(s, item.id, -1)) },
            { label: 'Move down', sub: itemIndex >= items.length - 1 ? 'Already last' : 'Below ' + ((Training.byId((items[itemIndex + 1] || {}).exerciseId, t.custom) || {}).name || 'the next one'),
              disabled: itemIndex < 0 || itemIndex >= items.length - 1, keepOpen: true, onClick: () => edit(s => Training.moveExercise(s, item.id, 1)) },
            { label: 'Take it out', danger: true, sub: 'You can undo this', onClick: () => removeItem(item.id) },
          ]} />
      )}

      {tuneRow && <TargetSheet row={tuneRow} name={(Training.byId(tuneRow.exerciseId, t.custom) || {}).name}
        onChange={patch => edit(s => Training.setExerciseTarget(s, tuneRow.id, patch))}
        onClose={() => setTuning(null)} />}

      {picking && (
        <ExercisePicker db={db} update={update}
          title={picking.mode === 'swap' ? 'Swap movement' : 'Add a movement'}
          basedOn={picking.mode === 'swap' ? (items.filter(x => x.id === picking.itemId)[0] || {}).exerciseId : null}
          onPick={(exId) => {
            if (picking.mode === 'add') {
              edit(s => Training.addExerciseToSession(s, exId, t.custom, exId + '_' + trainUid()));
              const ex = Training.byId(exId, t.custom);
              if (showToast) showToast((ex ? ex.name : 'Movement') + ' added to ' + live.name + '.');
              setPicking(null);
              return;
            }
            const row = items.filter(x => x.id === picking.itemId)[0];
            setPicking(null);
            if (!row) return;
            // A swap changes this session for certain. Whether it should change the REST of the block
            // is a different question and only the person knows the answer: a machine being busy is
            // this week, a grip that suits you better is the rest of it. Asked once, and only when
            // there is genuinely more than one session it could touch.
            const reach = block ? Training.swapReach(block, row.exerciseId, prog ? prog.week : 1) : 1;
            if (reach > 1) setSwapScope({ exId, reach, itemId: row.id, fromId: row.exerciseId });
            else doSwap(row.id, row.exerciseId, exId, 'session');
          }}
          onClose={() => setPicking(null)} />
      )}

      {swapScope && (() => {
        const from = Training.byId(swapScope.fromId, t.custom);
        const to = Training.byId(swapScope.exId, t.custom);
        const sc = swapScope;
        return (
          <ActionSheet title={(to ? to.name : 'That') + ' instead of ' + (from ? from.name : 'it')}
            onClose={() => setSwapScope(null)}
            actions={[
              { label: 'Just this session', sub: 'The rest of the block keeps ' + (from ? from.name : 'the original'),
                onClick: () => doSwap(sc.itemId, sc.fromId, sc.exId, 'session') },
              { label: 'The rest of the block',
                sub: 'Changes ' + sc.reach + ' sessions from this week on. Weeks you have trained stay as they were.',
                onClick: () => doSwap(sc.itemId, sc.fromId, sc.exId, 'block') },
            ]} />
        );
      })()}

      {dayPick && (
        <ActionSheet title={'Which day is ' + live.name + '?'} onClose={() => setDayPick(false)}
          actions={WEEKDAYS_FULL.map((label, d) => {
            const also = block && prog ? Training.sessionsOnDay(block, prog.week, d, live.id) : [];
            return {
              label,
              sub: d === live.dayOfWeek ? 'Where it is now' : (also.length ? also.join(' and ') + ' ' + (also.length === 1 ? 'is' : 'are') + ' also on this day' : null),
              onClick: () => {
                edit(s => Training.setSessionDay(s, d));
                if (showToast) showToast(live.name + ' moved to ' + label + ' this week.');
              },
            };
          })} />
      )}
    </div>
  );
}

/* The prescription, as four numbers you can actually change. This is the one edit in the module with
   no obvious gesture: sets and reps are not a list to reorder or an item to pick, they are a dial.
   Steppers rather than free text, because the range each one is allowed to take is narrow and known,
   and a number pad on a phone for a value between 1 and 10 is three taps to do what one should. */
function TargetSheet({ row, name, onChange, onClose }) {
  useBackClose(onClose);
  const t = row.target || {};
  const Stepper = ({ label, value, sub, onMinus, onPlus, atMin, atMax }) => (
    <div className="flex items-center gap-3 py-3" style={{ borderTop: '2px solid var(--border)' }}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{label}</span>
        {sub && <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted2)' }}>{sub}</span>}
      </span>
      <button onClick={onMinus} disabled={atMin} aria-label={'Fewer ' + label.toLowerCase()}
        className="pixel-box w-11 h-11 text-[15px] shrink-0" style={{ background: 'var(--surface2)', opacity: atMin ? 0.4 : 1 }}>-</button>
      <span className="pf text-[13px] tnum w-14 text-center shrink-0">{value}</span>
      <button onClick={onPlus} disabled={atMax} aria-label={'More ' + label.toLowerCase()}
        className="pixel-box w-11 h-11 text-[15px] shrink-0" style={{ background: 'var(--surface2)', opacity: atMax ? 0.4 : 1 }}>+</button>
    </div>
  );
  return (
    <div role="dialog" aria-modal="true" aria-label="Sets and reps" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box fade-in max-h-[80vh] overflow-y-auto p-4" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <div className="pf text-[11px] mb-1">SETS AND REPS</div>
        <div className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>{name || 'This movement'}</div>
        <Stepper label="Sets" value={t.sets}
          atMin={t.sets <= Training.SETS_MIN} atMax={t.sets >= Training.SETS_MAX}
          onMinus={() => onChange({ sets: t.sets - 1 })} onPlus={() => onChange({ sets: t.sets + 1 })} />
        <Stepper label="Reps from" value={t.repLow} sub="The bottom of the range"
          atMin={t.repLow <= Training.REPS_MIN} atMax={t.repLow >= Training.REPS_MAX}
          onMinus={() => onChange({ repLow: t.repLow - 1 })} onPlus={() => onChange({ repLow: t.repLow + 1 })} />
        <Stepper label="Reps to" value={t.repHigh} sub="The top of the range"
          atMin={t.repHigh <= Training.REPS_MIN} atMax={t.repHigh >= Training.REPS_MAX}
          onMinus={() => onChange({ repHigh: t.repHigh - 1 })} onPlus={() => onChange({ repHigh: t.repHigh + 1 })} />
        <Stepper label="RIR" value={t.rir} sub="Reps you leave in the tank"
          atMin={t.rir <= 0} atMax={t.rir >= Training.RIR_MAX}
          onMinus={() => onChange({ rir: t.rir - 1 })} onPlus={() => onChange({ rir: t.rir + 1 })} />
        {/* A sheet with a button at the bottom reads as a form with a Save on it, and this one is not:
            every tap above has already been written. Saying so is the difference between closing it
            confidently and closing it wondering. */}
        <div className="text-[11px] text-center mt-3 leading-snug" style={{ color: 'var(--muted2)' }}>Saved as you change it.</div>
        <button onClick={onClose} className="pixel-btn w-full h-12 font-bold mt-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Done</button>
      </div>
    </div>
  );
}

// ---- your blocks ------------------------------------------------------------------------------
// Every block you have ever made. This screen was missing, and its absence was a one-way door:
// the home tab only ever shows the block that is RUNNING, saving a new one archives the rest out of
// sight, and nothing anywhere opened the editor on a saved block, so BlockBuilder's "Delete this
// block" button could not be reached at all. A block built by mistake was permanent. Editing and
// deleting are the same screen because they answer the same question: this one is wrong, now what.
function BlockList({ db, update, showToast, onBack, onOpen, onNew, onCoverage, onReview, onStart }) {
  useBackClose(onBack);
  const t = tdb(db);
  const today = Store.todayISO();
  const [confirm, setConfirm] = useState(null);
  const [fixing, setFixing] = useState(null);
  const live = activeBlock(db);
  const liveId = live ? live.id : null;
  // What is running first, then most recently started. An undated block sorts last: it is one that
  // was never actually begun, which is exactly the kind you came here to throw away.
  const fixes = {};
  t.blocks.forEach(b => { fixes[b.id] = Training.blockFixes(b, t.custom); });
  const blocks = t.blocks.slice().sort((a, b) => {
    if ((a.id === liveId) !== (b.id === liveId)) return a.id === liveId ? -1 : 1;
    return String(b.startISO || '').localeCompare(String(a.startISO || ''));
  });

  function remove(block) {
    // Same two steps as the editor's delete: pull the public copy first, so a block that was shared
    // does not outlive the copy you can see.
    if (block.shared) retractPublicBlock(block.id);
    trainUpdate(update, (tr, d) => { tr.blocks = tr.blocks.filter(b => b.id !== block.id); tombstone(d, [block.id]); });
    showToast && showToast('Block deleted.');   // ConfirmDialog closes itself once onConfirm returns
  }

  function statusOf(block) {
    const prog = Training.blockProgress(block, today);
    if (block.id === liveId && !prog.done) return prog.notStarted ? 'Starts ' + weekRangeLabel(block.startISO, 1).split(' to ')[0] : 'Running · week ' + prog.week + ' of ' + block.weeks;
    if (prog.done) return 'Finished';
    return 'Not running';
  }

  return (
    <div className="fade-in">
      <SubHeader back={onBack} backLabel="Train" title="Your blocks" />
      <div className="pf text-[9px] uppercase mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}>Built, imported and archived</div>
      <h1 className="pf text-lg mb-2">Your blocks</h1>
      <div className="text-[12.5px] mb-4 leading-relaxed" style={{ color: 'var(--muted)' }}>
        Everything you have built or imported. Tap one to change it, or delete one you made by mistake. The sessions you logged against a block are kept either way.
      </div>

      {/* The design's empty slot: a dashed frame, not a solid card. A card says "here is a thing";
          this has to say "here is where a thing would go", and a dashed edge is how every design
          since graph paper has said that. */}
      {!blocks.length && (
        <div className="p-5 text-center mb-4" style={{ border: '2px dashed var(--border)' }}>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}>Nothing here yet</div>
          <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            Build one from your kit and your days, or import a plan you already follow.
          </div>
        </div>
      )}

      {blocks.map(block => {
        const comp = Training.completion(block, t.logs.filter(l => l.blockId === block.id));
        const running = block.id === liveId && !Training.blockProgress(block, today).done;
        const prog = Training.blockProgress(block, today);
        const pct = comp.total > 0 ? comp.done / comp.total : 0;
        return (
          <Card key={block.id} className="p-0 overflow-hidden mb-3">
            {/* The head carries the block's STATE, which is the thing you scan this list for, and
                leaves the body to carry the block. It was a muted line of text under the name,
                reading as a third tier of caption. */}
            <CardHead title={running ? 'Running' : prog.done ? 'Archived' : 'Not running'}
              right={running ? 'Week ' + prog.week + ' of ' + block.weeks : prog.done ? 'Finished' : (block.startISO ? null : 'Never started')} />
            <div className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => onOpen(block.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-[15px] font-semibold leading-tight" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{block.name}</span>
                {/* What KIND of block it is, in the same words the builder's panel header uses.
                    "4 days a week" does not distinguish an upper/lower from a push/pull/legs, and
                    that is the first thing you want when picking one out of a list of six. */}
                <span className="block text-[12px] tnum mt-1" style={{ color: 'var(--muted)' }}>
                  {(read => read ? read.splitName + ' · ' + read.weekSets + ' sets a week' : (block.daysPerWeek || (block.days || []).length) + ' days a week')(readBlock(block))}
                </span>
                <span className="block text-[12px] tnum mt-0.5" style={{ color: 'var(--muted2)' }}>
                  {comp.done} of {comp.total} sessions logged{block.shared ? ' · shared' : ''}
                </span>
              </button>
              <button onClick={() => setConfirm(block)} aria-label={'Delete ' + block.name}
                className="hit shrink-0 px-2 py-1 text-[12px] underline" style={{ color: 'var(--danger-ink)' }}>Delete</button>
            </div>
            {/* How far through it you are, in the house meter. The design gives every block one, and
                it is the difference between reading "7 of 16" and seeing it. */}
            <div className="flex gap-[1px] mt-2.5" style={{ border: '2px solid var(--border)', background: 'var(--border)' }}>
              {Array.from({ length: 20 }, (_, i) => (
                <i key={i} className="flex-1" style={{ height: 11, background: i < Math.round(pct * 20) ? (prog.done ? 'var(--good)' : 'var(--accent)') : 'var(--track)' }} />
              ))}
            </div>
            {/* A block built before a rule existed does not get it retroactively, and the ones that
                show are the ones you read every day. Offered, never applied quietly: two of these
                three change what the block asks of you. */}
            {fixes[block.id] && fixes[block.id].length > 0 && (
              <button onClick={() => setFixing(block)} className="w-full text-left mt-3 pt-3 text-[12px]" style={{ borderTop: '2px solid var(--border)', color: 'var(--warn)' }}>
                {fixes[block.id].length} thing{fixes[block.id].length === 1 ? '' : 's'} here predate how the app builds blocks now &rsaquo;
              </button>
            )}
            {/* Framed buttons, per the design, not a row of blue-ish words. These are the two things
                you came to this card to do, and a text link at 12px is the weakest control the app
                has for the strongest intent on the row. */}
            <div className="flex gap-2 mt-3">
              {!block.startISO && (
                <button onClick={() => onStart(block)} className="pixel-btn flex-1 py-2.5 text-[12.5px]" style={{ borderWidth: 2, background: 'var(--accent)', color: 'var(--on-accent)' }}>Start this block</button>
              )}
              <button onClick={() => onCoverage(block.id)} className="pixel-btn flex-1 py-2.5 text-[12.5px]" style={{ borderWidth: 2, background: 'var(--surface2)' }}>What it covers</button>
              {comp.done > 0 && (
                <button onClick={() => onReview(block.id)} className="pixel-btn flex-1 py-2.5 text-[12.5px]" style={{ borderWidth: 2, background: 'var(--surface2)' }}>How it went</button>
              )}
            </div>
            </div>
          </Card>
        );
      })}

      {/* One way to get another one, at the bottom where the design puts it, reachable whether the
          list is empty or twelve long. Bringing a source is a step inside this now, not a separate
          screen competing with it. */}
      <div className="mt-1">
        <button onClick={onNew} className="pixel-btn w-full py-3.5 px-2 pf text-[10px] uppercase" style={{ borderWidth: 2, letterSpacing: '0.06em', background: 'var(--accent)', color: 'var(--on-accent)' }}>Build a block</button>
      </div>

      {fixing && (() => {
        const list = Training.blockFixes(fixing, t.custom);
        const LABEL = {
          dayName: 'Name the days for what they train',
          blockName: 'Name the block for what it is',
          asWritten: 'Run it as its author wrote it',
        };
        function applyKinds(kinds, msg) {
          trainUpdate(update, (tr) => {
            const i = tr.blocks.findIndex(b => b.id === fixing.id);
            if (i >= 0) Training.applyBlockFixes(tr.blocks[i], kinds, tr.custom || []);
          });
          showToast && showToast(msg);
        }
        const actions = list.map(f => ({
          label: LABEL[f.kind] || f.kind,
          sub: f.from + '  \u2192  ' + f.to,
          onClick: () => applyKinds([f.kind], 'Done. Your logged sessions are untouched.'),
        }));
        if (list.length > 1) {
          actions.push({
            label: 'All of it',
            sub: 'Applies the ' + list.length + ' changes above',
            onClick: () => applyKinds(list.map(f => f.kind), 'Block brought up to date.'),
          });
        }
        return <ActionSheet title={'Bring "' + fixing.name + '" up to date'} actions={actions} onClose={() => setFixing(null)} />;
      })()}
      {confirm && (
        <ConfirmDialog title={'Delete "' + confirm.name + '"?'}
          body={(Training.completion(confirm, t.logs.filter(l => l.blockId === confirm.id)).done
            ? 'The sessions you already logged against it are kept, and still count towards your history. Only the plan goes. '
            : 'Nothing has been logged against it, so nothing else goes with it. ')
            + 'This cannot be undone.'}
          onConfirm={() => remove(confirm)} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

// ---- coverage screen --------------------------------------------------------------------------
function CoverageScreen({ db, update, isPremium, onUpgrade, blockId, onBack }) {
  useBackClose(onBack);
  const t = tdb(db);
  const block = t.blocks.filter(b => b.id === blockId)[0] || activeBlock(db);
  const targets = trainTargets(db);
  const today = Store.todayISO();
  const prog = block ? Training.blockProgress(block, today) : null;
  const [week, setWeek] = useState(prog ? prog.week : 1);
  const [lens, setLens] = useState('planned');
  const [advice, setAdvice] = useState(null);
  const [busy, setBusy] = useState(false);

  // Performed is judged over the last seven days, which is how anyone actually thinks about a week.
  const weekAgo = new Date(Date.parse(today + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
  const recentLogs = t.logs.filter(l => l.dateISO >= weekAgo && l.dateISO <= today);
  const volume = lens === 'planned' && block
    ? Training.blockWeekVolume(block, week, t.custom)
    : Training.performedVolume(recentLogs, t.custom);
  const cov = Training.coverage(volume, targets);
  const freq = block ? Training.frequency(Training.weekSessions(block, week), t.custom) : {};

  async function askAI() {
    if (!isPremium) { onUpgrade && onUpgrade('coverage'); return; }
    setBusy(true);
    try {
      const res = await coverageAdvice(db, cov, block, week);
      setAdvice(res);
    } catch (e) {
      setAdvice({ error: 'Could not reach ' + buddyName(db) + ' just now. The numbers above are still right.' });
    }
    setBusy(false);
  }

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">Coverage</h1>
      <Collapsible label="Hard sets per muscle, per week" sub="How this is counted" variant="inline" className="mb-4">
        <div className="text-[12px] leading-snug mt-2" style={{ color: 'var(--muted)' }}>
          A movement gives a full set to what it mainly works and half a set to what it assists, which is how a coach counts it. The band beside each muscle is the range that grows it: below the first number you are only maintaining, above the second you are past what you can recover from.
        </div>
      </Collapsible>

      <div className="flex items-center gap-2 mb-4">
        <Pill value={lens} onChange={setLens} options={[{ v: 'planned', l: 'Planned' }, { v: 'done', l: 'Last 7 days' }]} />
      </div>

      {lens === 'planned' && block && (
        <div className="flex gap-2 mb-4">
          {Array.from({ length: block.weeks }, (_, i) => i + 1).map(w => (
            <button key={w} onClick={() => setWeek(w)} className="pixel-box flex-1 py-2 pf text-[9px]"
              style={{ background: week === w ? '#fff' : 'var(--surface2)', color: week === w ? '#111' : 'var(--text2)' }}>W{w}</button>
          ))}
        </div>
      )}

      <Card className="p-4 mb-4">
        <div className="flex items-baseline justify-between mb-4">
          <div className="pf text-[18px]" style={{ color: cov.score >= 70 ? 'var(--good)' : cov.score >= 40 ? 'var(--warn)' : 'var(--danger)' }}>{cov.score}%</div>
          <div className="text-[11px] text-right" style={{ color: 'var(--muted)' }}>{cov.totalSets} hard sets counted<br /><span style={{ color: 'var(--muted2)' }}>across every muscle</span></div>
        </div>
        <CoverageBars coverage={cov} />
      </Card>

      {cov.gaps.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>What is short</div>
          {cov.gaps.slice(0, 5).map(g => (
            <div key={g.muscle} className="mb-4">
              <div className="text-[13px] mb-2">{gapSentence(g)}</div>
              <div className="flex gap-2 flex-wrap">
                {Training.suggestFor(g.muscle, {
                  equipment: t.prefs.equipment, dislikes: t.prefs.dislikes, custom: t.custom, limit: 3,
                  currentExerciseIds: block ? Training.weekSessions(block, week).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []) : [],
                }).map(e => (
                  <span key={e.id} className="pixel-box px-2 py-1 text-[11px]" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>{e.name}</span>
                ))}
              </div>
            </div>
          ))}
          <button onClick={askAI} disabled={busy} className="pixel-btn w-full py-3 font-bold mt-1" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            {busy ? 'Thinking...' : isPremium ? 'Ask what to change' : 'Ask what to change · Premium'}
          </button>
        </Card>
      )}

      {advice && <BuddySays db={db} tone={advice.error ? 'var(--warn)' : null}>{advice.error || advice.text}</BuddySays>}

      {block && lens === 'planned' && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>How often each muscle is hit</div>
          <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            Twice a week beats once at the same total. {(() => {
              const once = Training.MUSCLES.filter(m => freq[m] === 1 && cov.rows.filter(r => r.muscle === m)[0].sets >= cov.rows.filter(r => r.muscle === m)[0].mev);
              return once.length
                ? once.slice(0, 4).map(m => Training.MUSCLE_LABEL[m]).join(', ') + (once.length > 4 ? ' and others are' : (once.length === 1 ? ' is' : ' are')) + ' getting all their work in one session.'
                : 'Everything you train enough of is spread over at least two sessions.';
            })()}
          </div>
        </Card>
      )}

      <div className="text-[11px] leading-snug" style={{ color: 'var(--muted2)' }}>
        These bands are a starting point, not a rule. They move as your blocks teach us what you actually recover from.
      </div>
    </div>
  );
}

// ---- block review -----------------------------------------------------------------------------
function BlockReviewScreen({ db, update, showToast, isPremium, onUpgrade, blockId, onBack, onNext, onRerun }) {
  useBackClose(onBack);
  const t = tdb(db);
  const block = t.blocks.filter(b => b.id === blockId)[0];
  const targets = trainTargets(db);
  const units = t.prefs.units;
  const [prose, setProse] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!block) return <div className="fade-in"><button onClick={onBack} className="pf text-[9px] uppercase" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button><div className="mt-6 text-[13px]">That block is gone.</div></div>;
  const review = Training.reviewBlock(block, t.logs, targets, t.custom);

  async function writeUp() {
    if (!isPremium) { onUpgrade && onUpgrade('blockreview'); return; }
    setBusy(true);
    try { setProse(await blockReviewProse(db, review)); }
    catch (e) { setProse('Could not reach ' + buddyName(db) + ' just now. The numbers below are still yours.'); }
    setBusy(false);
  }
  function buildNext() {
    const tuned = Training.tuneTargets(targets, review);
    trainUpdate(update, (tr) => { tr.volumeTargets = tuned; });
    const draft = Training.nextBlock(block, review, targets, {
      equipment: t.prefs.equipment, dislikes: t.prefs.dislikes, custom: t.custom,
      sessionMinutes: t.prefs.sessionMinutes, startISO: Store.todayISO(),
    });
    onNext(draft);
  }

  return (
    <div className="fade-in pb-24">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">How it went</h1>
      <div className="text-[12px] mb-6" style={{ color: 'var(--muted)' }}>{block.name}</div>

      <div className="grid grid-cols-3 gap-2 mb-6">
        <Card className="p-3 text-center">
          <div className="pf text-[15px]" style={{ color: review.adherence >= 80 ? 'var(--good)' : 'var(--warn)' }}>{review.adherence}%</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>sessions done</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="pf text-[15px]">{review.improved.length}</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>lifts up</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="pf text-[15px]">{Math.round(toDisplayWeight(review.tonnage, units) / 1000)}k</div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>{unitLabel(units)} moved</div>
        </Card>
      </div>

      {/* The deload question, answered from what actually happened rather than from the calendar.
          This is where the decision gets made, so it sits above everything else. */}
      {(() => {
        const d = Training.deloadAdvice(block, t.logs, targets, {
          custom: t.custom,
          inDeficit: !!(db.profile && db.profile.goalType === 'cut') && !db.paused,
          poorSleep: recentSleepShort(db),
        });
        const tone = d.needed ? 'var(--warn)' : d.borderline ? 'var(--muted)' : 'var(--good)';
        return (
          <Card className="p-4 mb-4" style={{ background: d.needed ? 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' : 'var(--card)' }}>
            <div className="pf text-[9px] uppercase mb-2" style={{ color: tone }}>
              {d.needed ? 'Take a lighter week' : d.borderline ? 'Your call' : 'Straight on'}
            </div>
            <div className="text-[13px] leading-snug mb-2">{d.advice}</div>
            {d.reasons.length > 0 && (
              <div className="text-[11.5px] leading-snug" style={{ color: 'var(--muted)' }}>
                {d.reasons.map(r => r.text).join(' ')}
              </div>
            )}
            {!d.needed && !d.borderline && (
              <div className="text-[11.5px] leading-snug mt-1" style={{ color: 'var(--muted2)' }}>
                A lighter week you have not earned costs you a productive one, so we only ask for it when something says you need it.
              </div>
            )}
          </Card>
        );
      })()}

      {review.adherence < 60 && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' }}>
          <div className="text-[13px] leading-snug">
            You ran a bit over half of this block. That is worth knowing before we read anything into the numbers: a plan you cannot get to is a plan to change, not a body to blame. The next one can be shorter sessions or fewer days.
          </div>
        </Card>
      )}

      {review.lifts.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-4" style={{ color: 'var(--muted)' }}>Your lifts</div>
          {review.lifts.slice(0, 10).map(l => (
            <div key={l.exerciseId} className="flex items-baseline justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="min-w-0">
                <div className="text-[13px] truncate">{l.name}</div>
                <div className="text-[10px]" style={{ color: 'var(--muted2)' }}>{l.sessions} sessions</div>
              </div>
              <div className="text-right whitespace-nowrap">
                <div className="text-[13px] font-bold" style={{ color: l.deltaPct > 1 ? 'var(--good)' : l.deltaPct < -1 ? 'var(--danger)' : 'var(--muted)' }}>
                  {l.deltaPct > 0 ? '+' : ''}{l.deltaPct}%
                </div>
                <div className="text-[10px]" style={{ color: 'var(--muted2)' }}>est. 1RM</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {review.stalled.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--warn)' }}>Stalled</div>
          {review.stalled.map(l => (
            <div key={l.exerciseId} className="text-[12px] mb-2 leading-snug">
              <span className="font-bold">{l.name}.</span> {l.stall.advice}
            </div>
          ))}
        </Card>
      )}

      {/* The block you just ran, in the same grid the builder drew it in. Closing the loop matters
          here: you agreed to this climb four weeks ago as a picture, and this is that picture again
          next to what you actually did with it. */}
      {(() => {
        const read = readBlock(block);
        if (!read) return null;
        return (
          <Card className="p-0 overflow-hidden mb-4">
            <CardHead title={read.splitName} right={read.weekSets + ' sets / wk'} />
            <div className="p-3.5">
              <div className="text-[11px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>What you signed up for, four weeks ago.</div>
              <MesoGrid weeks={read.weeks} sessions={read.sessions} />
            </div>
          </Card>
        );
      })()}

      <Card className="p-4 mb-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>What you actually trained</div>
        <div className="text-[11px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>Average sets a week, from the sessions you logged rather than the ones we wrote down.</div>
        <CoverageBars coverage={review.coverage} />
      </Card>

      {prose && <BuddySays db={db}>{prose}</BuddySays>}
      {!prose && (
        <button onClick={writeUp} disabled={busy} className="pixel-box w-full py-3 text-[12px] mb-4" style={{ background: 'var(--surface2)' }}>
          {busy ? 'Writing...' : isPremium ? 'Read it back to me · ' + buddyName(db) : 'Read it back to me · Premium'}
        </button>
      )}

      <StickyAction>
        {/* Two ways on, and running THIS block again is the one most people want. "Build the next
            block" throws the plan away and generates a fresh one, which is the wrong answer for
            somebody who imported a coach's programme, liked it, and wants another four weeks of it
            with the things that stalled changed. */}
        <div className="flex gap-2">
          <button onClick={buildNext} className="pixel-box flex-1 h-14 text-[12.5px]" style={{ background: 'var(--surface2)' }}>
            Build a new one
          </button>
          <button onClick={() => onRerun(block.id)} className="pixel-btn flex-1 h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Run this again
          </button>
        </div>
      </StickyAction>
    </div>
  );
}

// ---- running the same block again ---------------------------------------------------------------
// Every proposal Training.rerunPlan made, each with the reason it was made and a switch. Nothing is
// applied until you say so, and what you turn down survives exactly as your coach wrote it. The
// engine decides WHAT to propose; this screen only decides what you accepted.
function RerunScreen({ db, update, showToast, blockId, onBack, onDraft }) {
  useBackClose(onBack);
  const t = tdb(db);
  const targets = trainTargets(db);
  const block = t.blocks.filter(b => b.id === blockId)[0];
  const plan = useMemo(() => (block ? Training.rerunPlan(block, t.logs, targets, t.custom) : null), [blockId]);
  const [off, setOff] = useState({});          // proposals turned down, by index
  const [pick, setPick] = useState({});         // a different alternative chosen, by index
  if (!block || !plan) {
    return (
      <div className="fade-in">
        <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
        <Card className="p-4"><div className="text-[13px]">That block is not here any more.</div></Card>
      </div>
    );
  }
  const actionable = plan.changes.filter(c => c.kind !== 'keep');
  const kept = plan.changes.filter(c => c.kind === 'keep');
  const accepted = actionable
    .map((c, i) => ({ c, i }))
    .filter(x => !off[x.i])
    .map(x => (pick[x.i] ? Object.assign({}, x.c, { to: pick[x.i].id, toName: pick[x.i].name }) : x.c));

  function build() {
    const next = Training.applyRerun(block, accepted, {
      targets: targets, custom: t.custom, startISO: Store.todayISO(),
    });
    onDraft(next);
  }

  const LABEL = { swap: 'Swap', sets: 'More work', add: 'Missing' };
  return (
    <div className="fade-in pb-28">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; How it went</button>
      <h1 className="pf text-lg mb-1">Run it again</h1>
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>{plan.headline}</div>

      {/* The block you are about to run, drawn, before the list of individual changes. The screen
          was a column of swap decisions with no sense of the whole, so you were agreeing to changes
          without seeing the thing they add up to. */}
      {(() => {
        const read = readBlock(block);
        if (!read) return null;
        return (
          <Card className="p-0 overflow-hidden mb-4">
            <CardHead title={read.splitName} right={read.weekSets + ' sets / wk'} />
            <div className="p-3.5"><MesoGrid weeks={read.weeks} sessions={read.sessions} /></div>
          </Card>
        );
      })()}

      {!actionable.length && (
        <Card className="p-4 mb-4">
          <div className="text-[13px] mb-1">Nothing to change.</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
            Every lift moved and there is no room worth adding. Run it as it stands.
          </div>
        </Card>
      )}

      {actionable.map((c, i) => {
        const isOff = !!off[i];
        const chosen = pick[i] || (c.to ? { id: c.to, name: c.toName } : null);
        return (
          <Card key={i} className="p-4 mb-3" style={{ opacity: isOff ? 0.5 : 1 }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="pf text-[9px] uppercase mb-2" style={{ color: c.kind === 'add' ? 'var(--warn)' : 'var(--accent-ink)' }}>
                  {LABEL[c.kind]}{c.dayName ? ' · ' + c.dayName : ''}
                </div>
                <div className="text-[13.5px] font-semibold leading-tight">
                  {c.kind === 'swap' && <span>{c.fromName} &rarr; {chosen ? chosen.name : c.toName}</span>}
                  {c.kind === 'sets' && <span>{c.fromName}, {c.from} to {c.to} sets</span>}
                  {c.kind === 'add' && <span>Add {chosen ? chosen.name : c.toName}, {c.sets} sets</span>}
                </div>
              </div>
              <button onClick={() => setOff(o => Object.assign({}, o, { [i]: !isOff }))}
                className="pf text-[9px] px-3 py-2 shrink-0"
                style={{ background: isOff ? 'var(--surface3)' : 'var(--accent)', color: isOff ? 'var(--muted)' : 'var(--on-accent)', border: '2px solid var(--border)' }}>
                {isOff ? 'OFF' : 'ON'}
              </button>
            </div>
            <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>{c.why}</div>
            {/* The engine's first pick is a suggestion, not a verdict. The others it shortlisted are
                right here, because "not that one, the cable version" is the commonest correction. */}
            {!isOff && (c.alts || []).length > 1 && (
              <div className="flex gap-2 flex-wrap mt-3">
                {c.alts.map(a => {
                  const on = chosen && chosen.id === a.id;
                  return (
                    <button key={a.id} onClick={() => setPick(p => Object.assign({}, p, { [i]: a }))}
                      className="pixel-box px-2 py-2 text-[11px]"
                      style={{ background: on ? 'var(--good)' : 'var(--surface2)', color: on ? '#05140a' : 'var(--text2)' }}>
                      {a.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}

      {kept.length > 0 && (
        <Card className="p-4 mb-3">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--good)' }}>Left alone on purpose</div>
          {kept.map((c, i) => (
            <div key={i} className="text-[12px] leading-snug mb-2" style={{ color: 'var(--text2)' }}>
              <span className="font-semibold">{c.fromName}</span>
              <span style={{ color: 'var(--muted)' }}> &middot; {c.why}</span>
            </div>
          ))}
        </Card>
      )}

      <StickyAction>
        <button onClick={build} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          Build it{accepted.length ? ' with ' + accepted.length + ' change' + (accepted.length === 1 ? '' : 's') : ' unchanged'}
        </button>
      </StickyAction>
    </div>
  );
}

// Has sleep been short lately? Feeds the deload decision, because the same block costs more on
// five hours a night. Uses the sleep the app already syncs; absent data simply does not vote.
function recentSleepShort(db) {
  const sleep = db.sleep || {};
  const keys = Object.keys(sleep).sort().slice(-10);
  const mins = keys.map(k => (sleep[k] || {}).min).filter(m => m > 0);
  if (mins.length < 5) return false;
  return (mins.reduce((a, b) => a + b, 0) / mins.length) < 390;   // under 6.5 hours on average
}

// ---- history ------------------------------------------------------------------------------------
// Rebuilt around the question people actually come here with: "what's my best on X?"
//
// It used to open on a wall of every session ever, with the records buried in a list above them.
// That is the wrong default: session-by-session browsing is something you do occasionally, looking
// up a lift is something you do standing in front of a rack. So a search box comes first, every
// movement you have ever trained is one keystroke away with its best beside it, and the sessions
// list is the second tab rather than the whole page.
function TrainHistory({ db, update, onBack, onOpenExercise }) {
  useBackClose(onBack);
  const t = tdb(db);
  const units = t.prefs.units;
  const [tab, setTab] = useState('lifts');
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(null);

  const logs = t.logs.slice().sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  const prs = Training.computePRs(t.logs);
  const prsBySession = {};
  t.logs.forEach(l => { const p = Training.prsInLog(t.logs, l); if (p.length) prsBySession[l.id] = p; });

  // Every movement you have ever logged, with its best and when you last did it. Sorted by
  // recency, because the thing you trained on Monday is far more likely to be what you are
  // looking for than the thing you did once in March.
  const lifts = (() => {
    const by = {};
    t.logs.forEach(l => {
      (l.sets || []).forEach(s => {
        if (!s.done || (s.type && s.type !== 'work')) return;
        const r = by[s.exerciseId] || (by[s.exerciseId] = { exerciseId: s.exerciseId, sessions: new Set(), lastISO: '', topKg: 0, topReps: 0 });
        r.sessions.add(l.id);
        if (l.dateISO > r.lastISO) r.lastISO = l.dateISO;
        if ((+s.weightKg || 0) > r.topKg) { r.topKg = +s.weightKg || 0; r.topReps = +s.reps || 0; }
      });
    });
    return Object.keys(by).map(k => {
      const ex = Training.byId(k, t.custom);
      return Object.assign({}, by[k], { name: ex ? ex.name : k, sessions: by[k].sessions.size, e1rm: (prs[k] || {}).e1rm || 0 });
    }).sort((a, b) => (a.lastISO < b.lastISO ? 1 : a.lastISO > b.lastISO ? -1 : 0));
  })();

  const needle = q.trim().toLowerCase();
  const shown = needle ? lifts.filter(l => l.name.toLowerCase().indexOf(needle) !== -1) : lifts;

  return (
    <div className="fade-in">
      <SubHeader back={onBack} backLabel="Train" title="History" />
      <div className="pf text-[9px] uppercase mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}>Every lift you have logged</div>
      <h1 className="pf text-lg mb-4">History</h1>

      <div className="mb-4"><Pill value={tab} onChange={setTab} options={[{ v: 'lifts', l: 'Your lifts' }, { v: 'sessions', l: 'Sessions' }]} /></div>

      {tab === 'lifts' && (
        <div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a movement"
            className="w-full pixel-box px-3 h-12 text-[14px] mb-4" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />

          {lifts.length === 0 && (
            <Card className="p-4">
              <div className="text-[13px] mb-1">Nothing logged yet.</div>
              <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
                Once you have trained something, your best on it lives here.
              </div>
            </Card>
          )}

          {lifts.length > 0 && shown.length === 0 && (
            <div className="text-[12.5px] py-6 text-center" style={{ color: 'var(--muted)' }}>
              You have not logged anything matching "{q}".
            </div>
          )}

          {/* ONE panel with ruled rows, per `Train Subscreens.dc.html`. Twenty-five separately framed
              cards each with their own offset shadow is the "box soup" this whole overhaul is against:
              a list of lifts is one object, and the rules between its rows say so at a fraction of the
              ink. The name still gets its own line - "Seated cab..." tells you nothing, and the pixel
              font eats horizontal space fast - so the numbers keep a row to themselves. */}
          {shown.length > 0 && <Card className="p-0 overflow-hidden">
            <CardHead title="Your lifts" right="Best set shown" />
            {shown.map((l, i) => (
              <button key={l.exerciseId} onClick={() => onOpenExercise(l.exerciseId)}
                className="w-full text-left px-3.5 py-3 flex items-start justify-between gap-3"
                style={i ? { borderTop: '2px solid var(--border)' } : null}>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-tight">{l.name}</span>
                  <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                    {relativeDay(l.lastISO, Store.todayISO())} · {l.sessions} {l.sessions === 1 ? 'session' : 'sessions'}
                  </span>
                </span>
                {/* The best, which is the whole reason for coming to this screen. */}
                <span className="text-right shrink-0">
                  <span className="block pf text-[10px] tnum" style={{ color: 'var(--accent-ink)', letterSpacing: '0.06em' }}>
                    {toDisplayWeight(l.topKg, units)}{unitLabel(units)} × {l.topReps}
                  </span>
                  {l.e1rm > 0 && (
                    <span className="block text-[11px] tnum mt-0.5" style={{ color: 'var(--muted)' }}>
                      {toDisplayWeight(l.e1rm, units)}{unitLabel(units)} est. 1RM
                    </span>
                  )}
                </span>
              </button>
            ))}
          </Card>}
        </div>
      )}

      {tab === 'sessions' && (
        <div>
          {logs.length === 0 && (
            <Card className="p-4"><div className="text-[13px]" style={{ color: 'var(--muted)' }}>Nothing logged yet. Your first session will show up here.</div></Card>
          )}
          {logs.map(l => {
            const exIds = [];
            (l.sets || []).forEach(s => { if (exIds.indexOf(s.exerciseId) === -1) exIds.push(s.exerciseId); });
            const sessionPRs = prsBySession[l.id] || [];
            return (
              <Card key={l.id} className="p-4 mb-4">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="text-[13px] font-bold flex items-center gap-2 min-w-0">
                    <span className="truncate">{l.name || 'Session'}</span>
                    {sessionPRs.length > 0 && (
                      <span className="pf text-[7px] uppercase px-2 py-0.5 shrink-0" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                        {sessionPRs.length > 1 ? sessionPRs.length + ' PBs' : 'PB'}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] shrink-0" style={{ color: 'var(--muted2)' }}>{l.dateISO}</div>
                </div>
                <div className="text-[11px] mb-2" style={{ color: 'var(--muted)' }}>
                  {(l.sets || []).filter(s => s.done).length} sets · {toDisplayWeight(Training.tonnage(l), units)}{unitLabel(units)} moved
                </div>
                {sessionPRs.length > 0 && (
                  <div className="text-[11px] mb-2 leading-snug" style={{ color: 'var(--accent-ink)' }}>
                    {sessionPRs.map((p, pi) => {
                      const e = Training.byId(p.exerciseId, t.custom);
                      return <span key={p.exerciseId + pi}>{pi > 0 ? ' · ' : ''}<Spark size={12} /> {(e ? e.name : p.exerciseId) + ', ' + p.label.toLowerCase()}</span>;
                    })}
                  </div>
                )}
                <div className="text-[11px] leading-snug" style={{ color: 'var(--muted2)' }}>
                  {exIds.map(id => (Training.byId(id, t.custom) || {}).name || id).join(', ')}
                </div>
                {l.notes && <div className="text-[11px] mt-2 italic" style={{ color: 'var(--muted)' }}>{l.notes}</div>}
                <button onClick={() => setConfirm(l.id)} className="text-[10px] mt-2" style={{ color: 'var(--muted2)' }}>Delete</button>
              </Card>
            );
          })}
        </div>
      )}

      {confirm && <ConfirmDialog title="Delete this session?" body="It comes out of your volume and your records too."
        onConfirm={() => trainUpdate(update, (tr, d) => { tr.logs = tr.logs.filter(x => x.id !== confirm); tombstone(d, [confirm]); })}
        onClose={() => setConfirm(null)} />}
    </div>
  );
}

function ExerciseDetail({ db, exerciseId, onBack }) {
  useBackClose(onBack);
  const t = tdb(db);
  const units = t.prefs.units;
  const ex = Training.byId(exerciseId, t.custom);
  const hist = Training.exerciseHistory(t.logs, exerciseId);
  const stall = Training.detectStall(hist);
  const max = Math.max.apply(null, hist.map(h => h.e1rm).concat([1]));

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; History</button>
      <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Movement</div>
      <h1 className="text-[19px] font-bold leading-tight mb-2">{ex ? ex.name : exerciseId}</h1>
      <div className="mb-6"><MuscleTags exerciseId={exerciseId} custom={t.custom} /></div>

      {hist.length > 1 && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-4" style={{ color: 'var(--muted)' }}>Estimated 1RM</div>
          <div className="flex items-end gap-1 h-24">
            {hist.slice(-24).map((h, i) => (
              <div key={i} className="flex-1" style={{ height: Math.max(2, (h.e1rm / max) * 100) + '%', background: 'var(--accent)' }} title={h.dateISO} />
            ))}
          </div>
          <div className="flex justify-between text-[10px] mt-2" style={{ color: 'var(--muted2)' }}>
            <span>{hist[Math.max(0, hist.length - 24)].dateISO}</span><span>{hist[hist.length - 1].dateISO}</span>
          </div>
        </Card>
      )}

      {stall && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' }}>
          <div className="text-[13px] leading-snug">{stall.advice}</div>
        </Card>
      )}

      <Card className="p-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Every session</div>
        {hist.slice().reverse().map((h, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{h.dateISO}</span>
            <span className="text-[12px]">{h.sets} sets · top {toDisplayWeight(h.topWeight, units)}{unitLabel(units)} x {h.topReps}</span>
          </div>
        ))}
        {!hist.length && <div className="text-[12px]" style={{ color: 'var(--muted)' }}>No sessions with this movement yet.</div>}
      </Card>
    </div>
  );
}

// ---- settings ---------------------------------------------------------------------------------
function TrainSettings({ db, update, showToast, onBack, onHowItWorks }) {
  useBackClose(onBack);
  const t = tdb(db);
  const [prefs, setPrefs] = useState(t.prefs);
  const [gymEdit, setGymEdit] = useState(null);
  const gyms = gymsOf(db);
  const targets = trainTargets(db);
  function saveGym(g) {
    trainUpdate(update, (tr) => {
      tr.gyms = tr.gyms || [];
      const i = tr.gyms.findIndex(x => x.id === g.id);
      if (i >= 0) tr.gyms[i] = g; else tr.gyms.push(g);
      if (!tr.prefs.currentGymId) tr.prefs = Object.assign({}, tr.prefs, { currentGymId: g.id });
    });
    setGymEdit(null);
  }
  function set(k, v) {
    const next = Object.assign({}, prefs, { [k]: v });
    setPrefs(next);
    trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { [k]: v }); });
  }
  function resetTargets() {
    trainUpdate(update, (tr) => { tr.volumeTargets = {}; });
    showToast && showToast('Volume bands back to the defaults for your experience.');
  }
  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-4">Training settings</h1>
      {/* Gyms come first: they change what gets programmed more than any other setting here. */}
      <Card className="p-4 mb-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Where you train</div>
        <div className="text-[11px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
          Save each place you train. You pick one when a session starts, and anything it has not got is swapped for something that works.
        </div>
        {gyms.map(g => (
          <button key={g.id} onClick={() => setGymEdit(g)} className="w-full text-left flex items-center justify-between gap-2 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold truncate">{g.name}</span>
              <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{gymSummary(g)}</span>
            </span>
            <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
          </button>
        ))}
        {!gyms.length && <div className="text-[12px] mb-2" style={{ color: 'var(--muted2)' }}>None saved yet.</div>}
        <button onClick={() => setGymEdit('new')} className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add a gym</button>
      </Card>

      <button onClick={onHowItWorks} className="w-full text-left pixel-box p-4 mb-4 flex items-center justify-between gap-3" style={{ background: 'var(--card)' }}>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">How your plan is built</span>
          <span className="block text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>
            The rules behind the volume bands, the effort targets and the four-week shape.
          </span>
        </span>
        <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
      </button>

      <Field label="Weight units" hint="Only changes what you see. Everything is stored the same way underneath.">
        <Seg value={prefs.units} onChange={v => set('units', v)} options={[{ v: 'kg', l: 'kg' }, { v: 'lb', l: 'lb' }]} />
      </Field>
      <Field label="Experience" hint="Sets the volume bands your coverage is judged against.">
        <Seg value={prefs.experience} onChange={v => set('experience', v)} options={[{ v: 'beginner', l: 'Newer' }, { v: 'intermediate', l: 'A while' }, { v: 'advanced', l: 'Years' }]} />
      </Field>
      <Field label="Rest timer" hint="Starts when you tick a working set. Stays quiet after a drop set or mid-superset, where the point is not to rest.">
        <Seg value={prefs.restTimer ? 'on' : 'off'} onChange={v => set('restTimer', v === 'on')} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} />
      </Field>
      <Field label="Sound when rest ends" hint="It buzzes either way. On an iPhone with the screen off the alert can arrive late, which is a limit of installed web apps rather than something we can fix.">
        <Seg value={prefs.restSound === false ? 'off' : 'on'} onChange={v => set('restSound', v === 'on')} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} />
      </Field>
      <Field label="Plate calculator" hint="Shows what to hang on each side under barbell movements.">
        <Seg value={prefs.plateCalc === false ? 'off' : 'on'} onChange={v => set('plateCalc', v === 'on')} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} />
      </Field>
      <Card className="p-4 mb-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Your volume bands</div>
        <div className="text-[11px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
          These start from the research and then move as your blocks show what you recover from.
        </div>
        {Training.MUSCLES.map(m => (
          <div key={m} className="flex items-baseline justify-between py-1 text-[12px]">
            <span style={{ color: 'var(--text2)' }}>{Training.MUSCLE_LABEL[m]}</span>
            <span style={{ color: 'var(--muted)' }}>{targets[m].mev} - {targets[m].mav} <span style={{ color: 'var(--muted2)' }}>(max {targets[m].mrv})</span></span>
          </div>
        ))}
        <button onClick={resetTargets} className="pixel-box w-full py-3 text-[12px] mt-3" style={{ background: 'var(--surface2)' }}>Reset to defaults</button>
      </Card>

      {gymEdit && (
        <GymEditor gym={gymEdit === 'new' ? null : gymEdit} onSave={saveGym} onClose={() => setGymEdit(null)}
          onDelete={(id) => {
            trainUpdate(update, (tr) => {
              tr.gyms = (tr.gyms || []).filter(x => x.id !== id);
              if (tr.prefs.currentGymId === id) tr.prefs = Object.assign({}, tr.prefs, { currentGymId: (tr.gyms[0] || {}).id || null });
            });
            setGymEdit(null);
          }} />
      )}
    </div>
  );
}

/* ============================================================================
 * AI: proposals and prose only
 * ----------------------------------------------------------------------------
 * Three calls, and not one of them returns a number the engine could compute.
 * They read messy sources, choose between movements we already shortlisted, and
 * write sentences. Every set count, every rep range, every volume judgement on
 * screen comes from training.js. Each is Premium-gated in ai-proxy by the
 * signature phrase at the top of its prompt.
 * ==========================================================================*/

// Read a plan out of whatever we managed to get hold of. `content` is an array of Anthropic content
// blocks, so the same function serves pasted text, a PDF, a screenshot and a scraped caption.
// `days` is the day count chosen in the wizard: it decides which track a multi-option source hands
// back, and how a single-track source gets adapted. {{DAYS}} appears more than once in the prompt, so
// this needs a global replace, unlike the single {{NAME}} swap in buddyVoice().
async function aiParseWorkout(content, opts) {
  const days = (opts && opts.days) || 4;
  const prompt = WORKOUT_PROMPT.replace(/\{\{DAYS\}\}/g, String(days));
  const j = await aiRequest({
    model: AI_MODEL, max_tokens: 3000,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }].concat(content) }],
  }, opts);
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
  if (!txt.trim()) throw new Error('Nothing came back. Try a clearer source.');
  return parseModelJSON(txt);
}

// Hand the plan back to the model with the person's notes on what is wrong with it. What comes back
// is re-resolved by Training.importTemplate exactly like a fresh import, so a tweak cannot smuggle in
// a movement the library does not have any more than the first read could.
async function aiTweakWorkout(plan, comments) {
  const j = await aiRequest({
    model: AI_MODEL, max_tokens: 4000,
    messages: [{ role: 'user', content: [
      { type: 'text', text: WORKOUT_TWEAK_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'THE PLAN AS IT STANDS:\n' + JSON.stringify(plan) },
      { type: 'text', text: 'WHAT THEY WANT CHANGED:\n' + String(comments || '').slice(0, 2000) },
    ] }],
  }, { timeoutMs: 120000 });
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
  if (!txt.trim()) throw new Error('Nothing came back. Try saying it another way.');
  return parseModelJSON(txt);
}

// The draft, in the shape the tweak pass reads and returns: the library's names rather than the
// coach's, because that is what is actually on screen and what the person is describing when they say
// "the hamstring curl is wrong".
function draftAsPlan(draft, custom) {
  return {
    name: (draft && draft.name) || 'My block',
    days: ((draft && draft.days) || []).map(d => ({
      name: d.name, dayOfWeek: d.dayOfWeek == null ? null : d.dayOfWeek,
      exercises: (d.exercises || []).map(e => {
        const ex = Training.byId(e.exerciseId, custom);
        return {
          name: (ex && ex.name) || e.exerciseId,
          sets: e.target.sets, repLow: e.target.repLow, repHigh: e.target.repHigh,
          rir: e.target.rir, restSec: e.target.restSec, tempo: e.target.tempo || null,
        };
      }),
    })),
  };
}

// Both training write-ups are spoken by the buddy, not by an anonymous coach, so the prompt gets the
// name of the individual the person is actually raising. {{NAME}} lives in prompts.jsx purely so that
// file can stay strings and nothing else.
function buddyVoice(prompt, db) {
  return String(prompt).replace('{{NAME}}', buddyName(db));
}
// The buddy's name, or a stand-in that still reads as a companion rather than a job title. Shared by
// every Train surface that speaks, so one unnamed buddy cannot be "Your buddy" here and blank there.
function buddyName(db) {
  return ((db && db.buddy && db.buddy.name) || '').trim() || 'your buddy';
}
// Advice on a gap. The audit is handed over finished, and the shortlist of movements is computed by
// Training.suggestFor, so the model is choosing and explaining rather than prescribing.
async function coverageAdvice(db, cov, block, week) {
  const t = tdb(db);
  const currentIds = block ? Training.weekSessions(block, week).reduce((a, s) => a.concat(s.exercises.map(e => e.exerciseId)), []) : [];
  const payload = {
    weeklySets: cov.rows.map(r => ({ muscle: r.label, sets: r.sets, mev: r.mev, mav: r.mav, mrv: r.mrv, band: r.band })),
    aboveCeiling: cov.overs.map(r => r.label),
    shortlist: cov.gaps.slice(0, 4).map(g => ({
      muscle: g.label,
      options: Training.suggestFor(g.muscle, { equipment: t.prefs.equipment, dislikes: t.prefs.dislikes, custom: t.custom, currentExerciseIds: currentIds, limit: 4 }).map(e => e.name),
    })),
    currentPlan: currentIds.map(id => (Training.byId(id, t.custom) || {}).name).filter(Boolean),
    // Whether they are cutting changes what "good" looks like, and the buddy should know.
    eatingPhase: db.profile && db.profile.goal ? db.profile.goal : null,
  };
  const j = await aiRequest({
    model: AI_MODEL_FAST, max_tokens: 400,
    messages: [{ role: 'user', content: buddyVoice(COVERAGE_PROMPT, db) + '\n\nThe audit (JSON):\n' + JSON.stringify(payload) + '\n\nYour advice:' }],
  });
  return { text: ((j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '').trim() };
}

// The end-of-block write-up, from figures Training.reviewBlock already settled.
async function blockReviewProse(db, review) {
  const payload = {
    adherencePct: review.adherence,
    sessionsLogged: review.sessionsLogged,
    lifts: review.lifts.slice(0, 8).map(l => ({ name: l.name, changePct: l.deltaPct, sessions: l.sessions })),
    stalled: review.stalled.map(l => l.name),
    weeklySetsActual: review.coverage.rows.map(r => ({ muscle: r.label, sets: r.sets, band: r.band })),
    eatingPhase: db.profile && db.profile.goal ? db.profile.goal : null,
  };
  const j = await aiRequest({
    model: AI_MODEL_FAST, max_tokens: 450,
    messages: [{ role: 'user', content: buddyVoice(BLOCK_REVIEW_PROMPT, db) + '\n\nThe block (JSON):\n' + JSON.stringify(payload) + '\n\nYour write-up:' }],
  });
  return ((j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '').trim();
}

/* ---- reading files ---------------------------------------------------------
 * A coach's plan arrives as a PDF, a spreadsheet or a photo of a whiteboard.
 * Each is turned into content blocks the model can read, with the STRUCTURE
 * kept wherever it exists: a spreadsheet flattened into prose loses the fact
 * that columns are weeks and rows are exercises, which is most of its meaning.
 * ------------------------------------------------------------------------- */

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

// Minimal .xlsx reader. An xlsx is a zip of XML, and browsers can inflate a raw deflate stream, so
// this needs no library: walk the zip's central directory, inflate the two parts we care about
// (the shared string table and the first worksheet), then read the cells. Anything unexpected
// throws and the caller falls back to asking for a CSV, which is a fair thing to ask.
async function readXlsx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  // End of central directory: scan back for its signature (0x06054b50).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries[name] = { method, compSize, localOff };
    p += 46 + nameLen + extraLen + commentLen;
  }
  async function read(name) {
    const e = entries[name];
    if (!e) return '';
    // The local header repeats the name and extra fields, and its lengths are the authoritative ones.
    const lnameLen = dv.getUint16(e.localOff + 26, true);
    const lextraLen = dv.getUint16(e.localOff + 28, true);
    const start = e.localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + e.compSize);
    if (e.method === 0) return new TextDecoder().decode(raw);
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([raw]).stream().pipeThrough(ds));
    return await out.text();
  }
  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = [];
  String(sharedXml).replace(/<si>([\s\S]*?)<\/si>/g, (_, si) => {
    // A cell's string can be split across several runs, so gather every <t> inside the item.
    let s = '';
    String(si).replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (__, t) => { s += t; return ''; });
    shared.push(s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    return '';
  });
  const sheetName = Object.keys(entries).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const sheetXml = await read(sheetName);
  if (!sheetXml) throw new Error('no worksheet');
  // Rebuild the grid, keeping empty columns so a week-per-column layout stays aligned.
  const rows = [];
  String(sheetXml).replace(/<row[^>]*>([\s\S]*?)<\/row>/g, (_, rowXml) => {
    const cells = [];
    String(rowXml).replace(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g, (__, attrs, inner) => {
      const a = attrs || '';
      const ref = (a.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
      let col = 0;
      for (let i = 0; i < ref.length; i++) col = col * 26 + (ref.charCodeAt(i) - 64);
      const isShared = /t="s"/.test(a);
      const v = ((inner || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const inlineT = ((inner || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
      let text = inlineT != null ? inlineT : (v == null ? '' : (isShared ? (shared[+v] || '') : v));
      while (cells.length < Math.max(0, col - 1)) cells.push('');
      cells.push(String(text));
      return '';
    });
    if (cells.some(c => c !== '')) rows.push(cells);
    return '';
  });
  if (!rows.length) throw new Error('empty sheet');
  return rows.map(r => r.join('\t')).join('\n');
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsText(file);
  });
}

// One file in, content blocks out. The caller does not care which kind it was.
async function workoutContentFromFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  if (type.indexOf('image/') === 0) {
    const im = await imageToB64(file, 1600);   // plans are dense text, so read them at a decent size
    return { blocks: [{ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.b64 } }, { type: 'text', text: 'This is a photo or screenshot of a training plan. Read it.' }], kind: 'photo' };
  }
  if (type === 'application/pdf' || /\.pdf$/.test(name)) {
    const b64 = await fileToB64(file);
    return { blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: 'This PDF is a training plan from a coach. Read it.' }], kind: 'pdf' };
  }
  if (/\.xlsx$/.test(name) || type.indexOf('spreadsheetml') !== -1) {
    const grid = await readXlsx(file);
    return { blocks: [{ type: 'text', text: 'This is a training plan exported from a spreadsheet. Rows and columns are preserved as tab-separated text, so a column is very often a week and a row an exercise. Read the FIRST week only.\n\n' + grid.slice(0, 24000) }], kind: 'spreadsheet' };
  }
  if (/\.(csv|tsv|txt|md)$/.test(name) || type.indexOf('text/') === 0) {
    const txt = await readTextFile(file);
    return { blocks: [{ type: 'text', text: 'This is a training plan as a text or CSV file. Where it looks like a grid, a column is very often a week and a row an exercise. Read the FIRST week only.\n\n' + txt.slice(0, 24000) }], kind: 'text' };
  }
  throw new Error('That file type is not one I can read. PDF, spreadsheet, CSV, text or a photo all work.');
}

// A screenshot is missing everything that was not on screen: which day of the week it is, that the
// numbers are in pounds, that the top half is last week. The person importing it knows all of that,
// so this bolts their note onto whatever the source turned into. Appended AFTER the source so it
// reads as a correction to it rather than a preamble, and clipped because it is a note, not a plan.
function withImportNote(blocks, note) {
  const v = String(note || '').trim();
  if (!v) return blocks;
  return blocks.concat([{ type: 'text', text: 'WHAT THE PERSON SAID ABOUT THIS:\n' + v.slice(0, 1200) }]);
}
const IMPORT_NOTE_HINT = 'Optional. Anything the picture cannot say.';

/* ============================================================================
 * The shared block library
 * ----------------------------------------------------------------------------
 * The community cookbook pattern, applied to training. What is published is ONE
 * WEEK (the template), never the built-out four weeks, because whoever runs it
 * next re-periodises it against their own volume landmarks and their own kit.
 * A block written by someone training six days on a full rack should not land on
 * a beginner with three dumbbells as-is. See Training.templateOf / adoptTemplate.
 * ==========================================================================*/

// Publish (or update) one of your blocks. Fire and forget, like submitPublicRecipe.
async function submitPublicBlock(block, prefs, custom) {
  try {
    if (!supa || !block) return;
    const template = Training.templateOf(block);
    if (!template.length) return;
    const sess = (await supa.auth.getSession()).data.session; if (!sess) return;
    const muscles = Training.plannedVolume(template, custom);
    await supa.rpc('submit_public_block', {
      p_block_key: block.id,
      p_title: block.name || 'Training block',
      p_goal: block.goal || 'hypertrophy',
      p_split: Training.splitKind(template, custom),
      p_days_per_week: template.length,
      p_weeks: block.weeks || 4,
      p_shape: block.shape || 'build3-deload1',
      p_experience: (prefs && prefs.experience) || 'intermediate',
      p_equipment: (prefs && prefs.equipment) || [],
      p_template: template,
      p_muscles: muscles,
      p_total_sets: Training.round(Object.keys(muscles).reduce((a, m) => a + muscles[m], 0), 1),
      p_source_url: (block.sourceRef && block.sourceRef.url) || null,
      p_source_platform: (block.sourceRef && block.sourceRef.kind) || null,
      p_author_name: block.authorName || null,
      p_private: !!block.private,
    });
  } catch (e) { /* fire and forget */ }
}
async function retractPublicBlock(blockId) {
  try { if (supa) await supa.rpc('retract_public_block', { p_block_key: blockId }); } catch (e) {}
}
async function browsePublicBlocks(opts) {
  opts = opts || {};
  if (!supa) return [];
  const r = await supa.rpc('browse_public_blocks', {
    p_limit: opts.limit || 40, p_goal: opts.goal || null, p_days: opts.days || null,
    p_split: opts.split || null, p_experience: opts.experience || null,
    p_search: (opts.search && opts.search.trim()) || null,
  });
  if (r.error) throw new Error(r.error.message);
  return r.data || [];
}
async function bumpPublicBlockRuns(id) {
  try { if (supa) await supa.rpc('bump_public_block_runs', { p_id: id }); } catch (e) {}
}

const SPLIT_LABEL = { full: 'Full body', upper_lower: 'Upper / lower', ppl: 'Push pull legs', other: 'Custom split' };

// ---- the library screen -------------------------------------------------------------------------
function BlockLibrary({ db, update, showToast, isPremium, onUpgrade, onBack, onAdopt }) {
  useBackClose(onBack);
  const t = tdb(db);
  const targets = trainTargets(db);
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [days, setDays] = useState(t.prefs.daysPerWeek || null);
  const [split, setSplit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);

  async function load() {
    setBusy(true); setErr('');
    try { setItems(await browsePublicBlocks({ days: days, split: split, search: q })); }
    catch (e) { setErr('Could not reach the library just now.'); setItems([]); }
    setBusy(false);
  }
  useEffect(() => { load(); }, [days, split]);
  useEffect(() => { const h = setTimeout(load, 350); return () => clearTimeout(h); }, [q]);

  if (preview) {
    return <SharedBlockPreview db={db} pub={preview} onBack={() => setPreview(null)} onAdopt={onAdopt} />;
  }

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">Block library</h1>
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
        Blocks other members are running. Whatever you pick gets rebuilt around your kit and the volume you recover from.
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search blocks"
        className="w-full pixel-box px-3 h-12 text-[14px] mb-4" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />

      {/* One row of filters, the two that actually decide whether a block fits your life. */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-1">
        <FilterPill on={!days && !split} onClick={() => { setDays(null); setSplit(null); }}>All</FilterPill>
        {[2, 3, 4, 5, 6].map(n => (
          <FilterPill key={n} on={days === n} onClick={() => setDays(days === n ? null : n)}>{n} days</FilterPill>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {['full', 'upper_lower', 'ppl'].map(s => (
          <FilterPill key={s} on={split === s} onClick={() => setSplit(split === s ? null : s)}>{SPLIT_LABEL[s]}</FilterPill>
        ))}
      </div>

      {busy && items === null && <SkeletonRows n={4} />}
      {err && <Card className="p-4 mb-4"><div className="text-[12px]">{err}</div></Card>}
      {/* Only one of these at a time: a failure and "nothing here yet" are different stories, and
          showing both makes the app look like it does not know which one happened. */}
      {items && items.length === 0 && !busy && !err && (
        <Card className="p-4">
          <div className="text-[13px] mb-1">Nothing here yet.</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
            The library fills up as people share what they are running. Build or import a block and you can be the first.
          </div>
        </Card>
      )}

      {(items || []).map(pub => (
        <button key={pub.id} onClick={() => setPreview(pub)} className="w-full text-left pixel-box p-4 mb-4" style={{ background: 'var(--card)' }}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[14px] font-bold truncate">{pub.title}</span>
            {pub.runs > 0 && <span className="text-[10px] shrink-0 tnum" style={{ color: 'var(--muted2)' }}>{pub.runs} running</span>}
          </div>
          <div className="text-[11px] mb-2" style={{ color: 'var(--muted)' }}>
            {pub.days_per_week} days · {SPLIT_LABEL[pub.split] || 'Custom split'} · {Math.round(pub.total_sets)} sets a week
            {pub.author_name ? ' · ' + pub.author_name : ''}
          </div>
          {/* The muscles it hits hardest, so you can tell at a glance whether it matches what you want. */}
          <div className="flex gap-1 flex-wrap">
            {topMuscles(pub.muscles, 4).map(m => (
              <span key={m} className="text-[10px] px-2 py-0.5" style={{ background: 'var(--surface2)', color: 'var(--muted)' }}>{Training.MUSCLE_LABEL[m]}</span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

function FilterPill({ on, onClick, children }) {
  return (
    <button onClick={onClick} className="pixel-box px-3 h-11 text-[12px] whitespace-nowrap shrink-0"
      style={{ background: on ? '#fff' : 'var(--surface2)', color: on ? '#111' : 'var(--text2)', fontWeight: on ? 700 : 400 }}>
      {children}
    </button>
  );
}
function topMuscles(muscles, n) {
  const m = muscles || {};
  return Object.keys(m).filter(k => m[k] > 0).sort((a, b) => m[b] - m[a]).slice(0, n || 4);
}

// What you see before committing to someone else's block: what it is, what it trains, and
// crucially what WE would change about it for you. Adopting silently would be the wrong move.
function SharedBlockPreview({ db, pub, onBack, onAdopt }) {
  useBackClose(onBack);
  const t = tdb(db);
  const targets = trainTargets(db);
  const [result] = useState(() => Training.adoptTemplate(pub.template, {
    weeks: pub.weeks || 4, shape: pub.shape || 'build3-deload1', targets: targets,
    equipment: t.prefs.equipment, dislikes: t.prefs.dislikes, custom: t.custom,
    goal: pub.goal, name: pub.title, daysPerWeek: pub.days_per_week,
    source: 'library', sourceRef: { kind: 'library', id: pub.id, author: pub.author_name || null },
  }));
  const cov = Training.coverage(Training.blockWeekVolume(result.block, 1, t.custom), targets);
  const authorSets = Math.round(pub.total_sets);
  const yourSets = Math.round(cov.totalSets);

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Library</button>
      <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Shared block</div>
      <h1 className="text-[19px] font-bold leading-tight mb-2">{pub.title}</h1>
      <div className="text-[12px] mb-4" style={{ color: 'var(--muted)' }}>
        {pub.days_per_week} days a week · {SPLIT_LABEL[pub.split] || 'Custom split'}
        {pub.author_name ? ' · by ' + pub.author_name : ''}
        {pub.experience ? ' · written by someone ' + ({ beginner: 'newer to lifting', intermediate: 'a few years in', advanced: 'training for years' }[pub.experience] || 'training') : ''}
      </div>

      {/* The honest bit. This is what makes adopting safe rather than a leap of faith. */}
      {(result.swaps.length > 0 || Math.abs(authorSets - yourSets) > 4) && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>What we changed for you</div>
          {Math.abs(authorSets - yourSets) > 4 && (
            <div className="text-[12.5px] mb-2 leading-snug">
              The author runs about {authorSets} sets a week. Yours starts at {yourSets}, because week 1 should be
              somewhere you can definitely recover from, and the block builds from there.
            </div>
          )}
          {result.swaps.map((s, i) => (
            <div key={i} className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
              {s.to ? s.from + ' becomes ' + s.to : s.from + ' left out, no kit for it'}
              <span style={{ color: 'var(--muted2)' }}> ({s.day})</span>
            </div>
          ))}
        </Card>
      )}

      {/* The shape of the thing you are about to take on, before the movement lists. "Four weeks,
          four days" is a sentence; this is the climb, and it is what tells you whether somebody
          else's block is a week you can actually stand up to. Same grid as the builder draws, so a
          block adopted from the library and a block you wrote look like the same kind of object. */}
      {(() => {
        const read = readBlock(result.block);
        if (!read) return null;
        return (
          <Card className="p-0 overflow-hidden mb-4">
            <CardHead title={read.splitName} right={read.weekSets + ' sets / wk'} />
            <div className="p-3.5">
              <MesoGrid weeks={read.weeks} sessions={read.sessions} />
              <div className="text-[10.5px] mt-2.5" style={{ color: 'var(--muted2)' }}>
                About {read.minutesEach} min a session, once it is re-periodised to your numbers.
              </div>
            </div>
          </Card>
        );
      })()}

      <Card className="p-4 mb-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Your week 1</div>
        <CoverageBars coverage={cov} limit={6} compact />
      </Card>

      {Training.weekSessions(result.block, 1).map(s => (
        <Card key={s.id} className="p-4 mb-4">
          <div className="text-[13px] font-bold mb-2">{s.name}</div>
          {s.exercises.map(e => (
            <div key={e.id} className="flex items-baseline justify-between gap-2 py-1 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className="text-[12px] truncate"><ExerciseName id={e.exerciseId} custom={t.custom} /></span>
              <span className="text-[11px] tnum whitespace-nowrap" style={{ color: 'var(--muted)' }}>{e.target.sets} x {e.target.repLow}-{e.target.repHigh}</span>
            </div>
          ))}
        </Card>
      ))}

      <StickyAction>
        <button onClick={() => { bumpPublicBlockRuns(pub.id); onAdopt(result.block); }} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          Run this block
        </button>
      </StickyAction>
    </div>
  );
}

// ---- the draft basket ---------------------------------------------------------------------------
// Where days collected from several sources wait until there are enough of them to be a programme.
// This is the answer to "I follow someone who posts Upper A on Monday and Lower B on Thursday":
// import each post as it lands, and build the block once the week is complete.
function BlockDraft({ db, update, showToast, isPremium, onUpgrade, onBack, onBuild, onImport }) {
  useBackClose(onBack);
  const t = tdb(db);
  const targets = trainTargets(db);
  const draft = t.draft;
  const [name, setName] = useState((draft && draft.name) || 'My block');
  const [confirmClear, setConfirmClear] = useState(false);
  const [picking, setPicking] = useState(null);   // day index we are adding a movement to
  const [tweak, setTweak] = useState('');
  const [tweakBusy, setTweakBusy] = useState(false);
  const [tweakNote, setTweakNote] = useState(null);
  const [tweakErr, setTweakErr] = useState(false);

  // Say what is wrong in your own words and it re-reads the plan with that in hand. This is the step
  // that was missing: a screenshot cannot say which day is the Friday or that the coach's "hamstring
  // curl" is the machine one, so the first read is a draft in the real sense, and this is how you
  // correct it without retyping a five-day programme by hand.
  async function applyTweak() {
    const v = tweak.trim();
    if (!v || !draft) return;
    if (!isPremium) { onUpgrade && onUpgrade('workout_import'); return; }
    setTweakBusy(true); setTweakNote(null); setTweakErr(false);
    try {
      const revised = await aiTweakWorkout(draftAsPlan(draft, t.custom), v);
      const res = Training.importTemplate(revised, { custom: t.custom });
      if (!res.template.length) throw new Error('That left nothing I could read. Try describing the change another way.');
      trainUpdate(update, (tr) => {
        // A movement the tweak added or renamed can need a fresh guess exactly as a first import
        // can, and it has to land in t.custom or the day above points at an id nothing holds.
        if (res.newCustom && res.newCustom.length) tr.custom = (tr.custom || []).concat(res.newCustom);
        // The revision REPLACES the draft rather than merging into it, because it is the same plan
        // corrected, not another source arriving. Merging would leave both readings side by side.
        tr.draft = Object.assign({}, tr.draft, {
          name: (revised && revised.name) || (tr.draft && tr.draft.name) || 'My block',
          days: res.template.map((d, i) => Object.assign({}, d, {
            dayOfWeek: i,
            sourceRef: ((tr.draft && tr.draft.days) || []).map(x => x.sourceRef)[i] || null,
          })),
          unresolved: res.unresolved,
        });
      });
      if (revised && revised.name) setName(revised.name);
      setTweak('');
      setTweakNote((revised && revised.note) || 'Done. Have a look and change anything else.');
    } catch (e) {
      setTweakErr(true);
      setTweakNote((e && e.message) || 'I could not apply that. Try saying it a different way.');
    }
    setTweakBusy(false);
  }
  if (!draft || !draft.days.length) {
    return (
      <div className="fade-in">
        <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
        <h1 className="pf text-lg mb-2">Draft block</h1>
        <Card className="p-4">
          <div className="text-[13px] mb-1">Nothing collected yet.</div>
          <div className="text-[12px] leading-snug mb-4" style={{ color: 'var(--muted)' }}>
            Import a session and choose "Add to draft" instead of building straight away. Do that for each day of someone's week and they stack up here.
          </div>
          <button onClick={onImport} className="pixel-btn w-full h-12 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Import a session</button>
        </Card>
        {/* A draft can be empty and still exist: delete every day one by one and the basket itself is
            still there, named, holding nothing. Without this there is no way to be rid of it. */}
        {draft && (
          <button onClick={() => { trainUpdate(update, (tr) => { tr.draft = null; }); onBack(); }}
            className="w-full py-3 text-[12px] mt-3" style={{ color: 'var(--danger)' }}>Throw the empty draft away</button>
        )}
      </div>
    );
  }

  const cov = Training.coverage(Training.plannedVolume(draft.days, t.custom), targets);
  // Lines the import marked as worth a second look, across every day. One number for the whole draft.
  const flagged = draft.days.reduce((a, d) => a + (d.exercises || []).filter(e => !!e.check).length, 0);
  function edit(fn) { trainUpdate(update, (tr) => { fn(tr.draft); tr.draft.days.forEach((d, i) => { d.dayOfWeek = i; }); }); }

  return (
    /* pb-28 clears the StickyAction bar, which is fixed 104px off the bottom and stands about 170px
       tall with its gradient. Without it the LAST thing on this screen sits underneath the Build
       button, and the last thing on this screen is how you throw the draft away. */
    <div className="fade-in pb-28">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      {/* "Draft block" named the object; "What I read" names what you are here to do, which is check
          the app's reading of somebody else's plan before four weeks get built on top of it. */}
      <h1 className="pf text-lg mb-1">What I read</h1>
      <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
        {draft.days.length} {draft.days.length === 1 ? 'day' : 'days'} read from your plan. Sets, reps and the four-week climb come from the builder.
      </div>

      {/* ---- the count bar, per `Build a block v3.dc.html` ----
          How many lines want a look, pinned while you scroll the days. The flags were already on the
          rows, but they were scattered through three day cards, so the only way to know whether you
          had dealt with them all was to scroll back up and count. This says it, and follows you.
          "Everything matched" is worth showing just as loudly: the fear with an importer is that it
          quietly dropped something, and the answer to that fear is a number, not silence. */}
      <div className="sticky top-0 z-10 -mx-5 px-5 pb-2.5 mb-3" style={{ background: 'var(--bg)' }}>
        <div className="pixel-box flex items-center gap-2.5 px-2.5 py-2" style={{ background: 'var(--card)' }}>
          <span className="shrink-0 flex items-center justify-center pf text-[10px]"
            style={{ width: 26, height: 26, border: '2px solid var(--border)', background: flagged ? 'var(--warn)' : 'var(--good)', color: flagged ? '#241f2e' : '#05140a' }}>
            {flagged ? String(flagged) : <Tick size={12} />}
          </span>
          <span className="flex-1 text-[11.5px] leading-snug" style={{ color: 'var(--text2)' }}>
            {flagged
              ? flagged + (flagged === 1 ? ' line needs a look' : ' lines need a look') + '. Everything else matched.'
              : 'Everything is placed. Nothing was dropped.'}
          </span>
          {flagged > 0 && (
            <button onClick={() => edit(d => d.days.forEach(day => (day.exercises || []).forEach(e => { delete e.check; })))}
              className="pf text-[7.5px] uppercase shrink-0 px-2" style={{ minHeight: 44, letterSpacing: '0.1em', border: '2px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
              Accept all
            </button>
          )}
        </div>
      </div>

      <Field label="Call it"><TextInput value={name} onChange={e => { setName(e.target.value); edit(d => { d.name = e.target.value; }); }} /></Field>

      {/* The two things that are ABOUT the whole draft rather than about one movement, both folded
          away. Correcting a single line is now a tap on that line, so a note in words is the fallback
          rather than the main event, and coverage is a question you ask once before building rather
          than a wall you read past on the way to the days. */}
      <Collapsible label="Anything read wrong?" sub="Say it in words" variant="inline" className="mb-4">
        <textarea value={tweak} onChange={e => setTweak(e.target.value)} rows={3}
          placeholder={'The hamstring curl is the seated machine, not Nordics.\nDay 1 is Monday, day 5 is Friday.\nKeep every set count exactly as the plan says.'}
          className="w-full pixel-box px-3 py-3 text-[13px] mb-2" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
        <button onClick={applyTweak} disabled={tweakBusy || !tweak.trim()} className="pixel-box w-full h-11 text-[12.5px]" style={{ background: 'var(--surface2)' }}>
          {tweakBusy ? 'Changing it...' : isPremium ? 'Apply these changes' : 'Apply these changes \u00b7 Premium'}
        </button>
        {tweakNote && <div className="text-[12px] mt-2 leading-snug" style={{ color: tweakErr ? 'var(--danger)' : 'var(--accent-ink)' }}>{tweakNote}</div>}
      </Collapsible>

      <Collapsible
        label={cov.gaps.length ? 'What it covers' : 'Covers every muscle'}
        sub={cov.gaps.length ? cov.gaps.length + ' short' : 'Show'} variant="inline" className="mb-5">
        {cov.gaps.filter(g => !g.sets).length > 0 && (
          <div className="text-[12px] mb-2 leading-snug" style={{ color: 'var(--warn)' }}>
            Nothing at all for {cov.gaps.filter(g => !g.sets).map(g => g.label.toLowerCase()).join(', ')}. That may well be deliberate on your coach's part, but it is worth knowing now.
          </div>
        )}
        {cov.gaps.filter(g => g.sets > 0).length > 0 && (
          <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
            Light on {cov.gaps.filter(g => g.sets > 0).slice(0, 3).map(g => g.label.toLowerCase()).join(', ')}.
          </div>
        )}
        <CoverageBars coverage={cov} limit={6} compact />
      </Collapsible>

      {/* Which week of somebody else's programme this is. One line, because it is one fact about the
          whole import, and it is the only warning left that is not about a specific movement. */}
      {draft.weekLabel && (
        <div className="text-[12px] mb-4 leading-snug px-3 py-3" style={{ background: 'color-mix(in srgb, var(--danger) 10%, var(--surface2))', color: 'var(--text2)' }}>
          These screenshots were showing <strong>{draft.weekLabel}</strong>. All four weeks get built from it.
        </div>
      )}

      {draft.days.map((day, di) => (
        <Card key={di} className="p-4 mb-4">
          <div className="flex items-baseline justify-between gap-2 mb-2">
            <input value={day.name} onChange={e => edit(d => { d.days[di].name = e.target.value; })}
              className="text-[13.5px] font-bold bg-transparent min-w-0 flex-1" style={{ color: 'var(--text)' }} aria-label="Day name" />
            <button onClick={() => edit(d => { d.days.splice(di, 1); })} aria-label="Remove day" className="px-2 text-[16px] shrink-0" style={{ color: 'var(--muted2)' }}>&times;</button>
          </div>
          {day.sourceRef && (
            <div className="text-[10px] mb-2" style={{ color: 'var(--muted2)' }}>
              from {day.sourceRef.kind === 'link' ? 'a shared post' : day.sourceRef.kind === 'file' ? (day.sourceRef.name || 'a file') : 'text you pasted'}
            </div>
          )}
          {day.exercises.map((e, ei) => {
            const lib = Training.byId(e.exerciseId, t.custom);
            const shown = e.sourceName || (lib ? lib.name : e.exerciseId);
            // Only worth saying when the two differ. "Pendulum squat, counted as Pendulum squat" is
            // noise on every line; "Smith machine split squat, counted as Split squat" is the whole
            // point, and it is one tap from being corrected.
            // The engine decides what is worth a second look, and marks it on the row at import.
            // Anything unmarked matched cleanly enough that saying so would be noise on every line.
            const differs = !!e.check && lib;
            return (
              <div key={e.id || ei} className="flex items-start justify-between gap-2 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => setPicking({ day: di, index: ei })} className="min-w-0 flex-1 text-left">
                  <span className="block text-[12.5px] leading-snug">{shown}</span>
                  {/* Three words and the name. The row is tappable, so the note's whole job is to
                      say what happened, not to argue for it. */}
                  {differs && (
                    <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--warn)' }}>
                      {e.check === 'kit' ? 'Counted as ' + lib.name
                        : e.check === 'auto' ? 'Not in the library - guessed which muscle, tap to check'
                          : 'Read as ' + lib.name + '?'}
                    </span>
                  )}
                </button>
                {/* Agreeing with the guess is the common answer and it had no control at all: the
                    only way to clear a flag was to open the picker and re-choose the movement the
                    app had already chosen. Now the row offers both, and the count bar above can
                    actually reach zero. */}
                {differs && (
                  <button onClick={() => edit(d => { delete d.days[di].exercises[ei].check; })}
                    aria-label={'Keep ' + shown + ' as ' + lib.name}
                    className="shrink-0 px-2 text-[11px]" style={{ minHeight: 44, border: '2px solid var(--border)', background: 'var(--surface2)', color: 'var(--text2)' }}>
                    Keep
                  </button>
                )}
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] tnum" style={{ color: 'var(--muted)' }}>
                    {e.target.sets} x {e.target.repLow}-{e.target.repHigh}
                    {e.target.tempo ? ' · ' + e.target.tempo : ''}
                  </span>
                  <button onClick={() => edit(d => { d.days[di].exercises.splice(ei, 1); })} aria-label={'Remove ' + shown} className="text-[14px]" style={{ color: 'var(--muted2)' }}>&times;</button>
                </span>
              </div>
            );
          })}
          {/* What this day had that could not be placed, sitting IN the day rather than in a list of
              warnings further up. The day then shows every movement the source did, and the fix is
              next to the gap instead of a screen away. */}
          {(day.missing || []).map((m, mi) => (
            <button key={'m' + mi} onClick={() => setPicking({ day: di, index: null, replacing: mi })}
              className="w-full flex items-start justify-between gap-2 py-2 border-t text-left" style={{ borderColor: 'var(--border)' }}>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] leading-snug" style={{ color: 'var(--muted2)' }}>{m.name}</span>
                <span className="block text-[10.5px] mt-0.5" style={{ color: 'var(--warn)' }}>not recognised &middot; choose the movement</span>
              </span>
            </button>
          ))}
          <button onClick={() => setPicking({ day: di, index: null })} className="pixel-box w-full h-11 text-[11px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add movement</button>
        </Card>
      ))}

      <div className="flex gap-2 mb-4">
        <button onClick={onImport} className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Import another day</button>
        <button onClick={() => edit(d => { d.days.push({ name: 'Day ' + (d.days.length + 1), kind: 'full', exercises: [] }); })}
          className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Add a blank day</button>
      </div>

      <button onClick={() => setConfirmClear(true)} className="w-full py-3 text-[12px]" style={{ color: 'var(--danger)' }}>Throw the draft away</button>

      <StickyAction>
        <button onClick={() => onBuild(draft)} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          Build the 4-week block
        </button>
      </StickyAction>

      {/* One picker, three jobs: swap the movement on a row, place one the library could not read,
          or add a new one. Swapping keeps the row's own sets, reps and tempo, because the coach
          prescribed those for the slot and only the movement was ever in question. */}
      {picking != null && (
        <ExercisePicker db={db} update={update} onClose={() => setPicking(null)}
          title={picking.index != null ? 'Change movement' : 'Add movement'}
          {...(() => {
            const day = draft.days[picking.day] || {};
            // Tapping a movement offers a variation OF that movement, which is the commonest reason a
            // library match is wrong: a grip, a stance, an attachment. This is where an import is most
            // likely to need it, and until now it was only offered mid-session.
            if (picking.index != null) {
              const row = (day.exercises || [])[picking.index];
              return { basedOn: row && row.exerciseId };
            }
            // Nothing to vary from when the library never placed it, so the next best thing is to
            // arrive with the plan's own words already in the box.
            const miss = picking.replacing != null ? (day.missing || [])[picking.replacing] : null;
            return miss ? { seed: miss.name } : {};
          })()}
          onPick={(id) => {
            const ex = Training.byId(id, t.custom);
            const compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
            const di = picking.day;
            edit(d => {
              const day = d.days[di];
              if (picking.index != null) {
                const row = day.exercises[picking.index];
                row.exerciseId = id;
                row.id = id + '_d' + di + '_' + picking.index;
                // Their correction becomes the name on the row: they have just told us what it is.
                row.sourceName = ex ? ex.name : row.sourceName;
                return;
              }
              const from = picking.replacing != null ? (day.missing || [])[picking.replacing] : null;
              day.exercises.push({
                id: id + '_d' + di + '_' + day.exercises.length, exerciseId: id,
                order: day.exercises.length,
                // A movement placed by hand keeps the plan's wording for it where there was one.
                sourceName: from ? from.name : (ex ? ex.name : null),
                target: { sets: 2, repLow: compound ? 6 : 8, repHigh: compound ? 10 : 12, rir: 2, restSec: compound ? 150 : 120 },
              });
              if (picking.replacing != null && day.missing) day.missing.splice(picking.replacing, 1);
            });
            setPicking(null);
          }} />
      )}
      {confirmClear && <ConfirmDialog title="Throw this draft away?" body="The days you collected go. Anything you already built into a block stays."
        onConfirm={() => { trainUpdate(update, (tr) => { tr.draft = null; }); onBack(); }} onClose={() => setConfirmClear(false)} />}
    </div>
  );
}

// Turn a sentence into block settings. The model only ever fills in the FORM: days, minutes, kit,
// and which muscles to bias. The block itself is still built by Training.generateBlock from those
// answers, so "make me a programme" cannot produce a programme nobody checked.
// Signature 'You turn a sentence about training into JSON' maps to workout_import in ai-proxy.
async function aiParseTrainingWish(text) {
  const rules = 'You turn a sentence about training into JSON settings for a programme builder. Read ONLY what the person said and leave anything they did not mention as null. Respond ONLY with compact JSON: {"daysPerWeek": number|null, "sessionMinutes": number|null, "experience": "beginner"|"intermediate"|"advanced"|null, "goal": "hypertrophy"|"strength"|"general"|null, "equipment": string[]|null, "emphasis": string[]|null, "note": string}. equipment uses only these words: barbell, dumbbell, machine, cable, bodyweight, smith, ez, kettlebell, trapbar. emphasis is the muscles they want to prioritise, using only these words: chest, front delts, side delts, rear delts, lats, upper back, lower back, biceps, triceps, forearms, abs, obliques, quads, hamstrings, glutes, adductors, calves. If they name a body part loosely ("shoulders", "arms", "back", "legs"), expand it to the specific muscles that make it up. note = one short British-English sentence back to them confirming what you understood.';
  const j = await aiRequest({ model: AI_MODEL_FAST, max_tokens: 500, messages: [{ role: 'user', content: rules + '\n\nWhat they said:\n' + String(text || '').slice(0, 1200) + '\n\nJSON:' }] });
  const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
  return parseModelJSON(txt);
}

// Muscle words back to the engine's keys. The model is told to use these exact labels, but people's
// phrasing leaks through, so match on the label rather than trusting an id.
function musclesFromLabels(labels) {
  const byLabel = {};
  Training.MUSCLES.forEach(m => { byLabel[Training.MUSCLE_LABEL[m].toLowerCase()] = m; });
  const extra = { shoulders: ['fd', 'sd', 'rd'], arms: ['bi', 'tr'], back: ['lt', 'ub'], legs: ['qu', 'ha', 'gl'], delts: ['sd', 'rd'], traps: ['ub'], core: ['ab', 'ob'] };
  const out = [];
  (labels || []).forEach(l => {
    const k = String(l || '').toLowerCase().trim();
    if (byLabel[k]) out.push(byLabel[k]);
    else if (extra[k]) extra[k].forEach(m => out.push(m));
  });
  return out.filter((m, i) => out.indexOf(m) === i);
}

/* ============================================================================
 * Gyms
 * ----------------------------------------------------------------------------
 * Nobody thinks about their gym as nine equipment checkboxes, and most people
 * train in more than one place. A saved gym carries what is there AND what to
 * reach for first, because the best choice for a muscle genuinely differs by
 * setting: in a full gym a machine or cable usually wins for hypertrophy work,
 * while at home with nobody to spot you the safe way to train hard is
 * stretch-biased dumbbell work you can bail out of.
 * ==========================================================================*/

function gymsOf(db) { return (tdb(db).gyms) || []; }
function currentGym(db) {
  const t = tdb(db);
  const list = t.gyms || [];
  if (!list.length) return null;
  return list.filter(g => g.id === t.prefs.currentGymId)[0] || list[0];
}
function gymSummary(g) {
  if (!g) return 'Not set';
  const base = Training.GYMS[g.type] || Training.GYMS.custom;
  const bits = [base.label];
  if (g.type === 'home' || g.type === 'minimal') {
    bits.push(g.bench === false ? 'no bench' : 'bench');
    bits.push(g.pullupBar === false ? 'no bar' : 'pull-up bar');
  }
  return bits.join(' · ');
}

// Create or edit one gym. The two follow-ups for a home setup are not optional detail: a bench
// unlocks every pressing angle and most rowing, and a bar is the only real vertical pull. Getting
// them wrong is how an app ends up prescribing incline presses to someone with no bench.
function GymEditor({ gym, onSave, onDelete, onClose }) {
  useBackClose(onClose);
  const [name, setName] = useState((gym && gym.name) || '');
  const [type, setType] = useState((gym && gym.type) || 'commercial');
  const [bench, setBench] = useState(gym ? gym.bench !== false : true);
  const [bar, setBar] = useState(gym ? gym.pullupBar !== false : true);
  const [equipment, setEquipment] = useState((gym && gym.equipment) || []);
  const EQUIP = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbells'], ['machine', 'Machines'], ['cable', 'Cables'],
    ['bodyweight', 'Bodyweight'], ['band', 'Bands'], ['kettlebell', 'Kettlebells'], ['smith', 'Smith'], ['ez', 'EZ bar'], ['trapbar', 'Trap bar']];
  const asksKit = type === 'home' || type === 'minimal';

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit gym" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-4 fade-in max-h-[88vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className="pf text-[12px] mb-4">{gym ? 'Edit gym' : 'Add a gym'}</h2>
        <Field label="Call it"><TextInput value={name} onChange={e => setName(e.target.value)} placeholder="My gym" /></Field>
        <Field label="What kind of place">
          <div className="flex flex-col gap-2">
            {Object.keys(Training.GYMS).map(k => {
              const g = Training.GYMS[k];
              return (
                <button key={k} onClick={() => setType(k)} className="pixel-box p-3 text-left"
                  style={{ background: type === k ? '#fff' : 'var(--surface2)', color: type === k ? '#111' : 'var(--text2)' }}>
                  <span className="block text-[13px] font-semibold">{g.label}</span>
                  <span className="block text-[11px] mt-0.5" style={{ color: type === k ? '#555' : 'var(--muted)' }}>{g.hint}</span>
                </button>
              );
            })}
          </div>
        </Field>

        {asksKit && (
          <Field label="What have you got" hint="These two decide more than anything else. Without a bench there is no incline work and not much rowing; without a bar there is no real vertical pull.">
            <div className="flex gap-2">
              <button onClick={() => setBench(!bench)} className="pixel-box flex-1 h-11 text-[12px]"
                style={{ background: bench ? 'var(--good)' : 'var(--surface2)', color: bench ? '#05140a' : 'var(--muted)' }}>
                {bench ? <span>Bench <Tick /></span> : 'No bench'}
              </button>
              <button onClick={() => setBar(!bar)} className="pixel-box flex-1 h-11 text-[12px]"
                style={{ background: bar ? 'var(--good)' : 'var(--surface2)', color: bar ? '#05140a' : 'var(--muted)' }}>
                {bar ? <span>Pull-up bar <Tick /></span> : 'No bar'}
              </button>
            </div>
          </Field>
        )}

        {type === 'custom' && (
          <Field label="Kit that is there">
            <div className="flex gap-2 flex-wrap">
              {EQUIP.map(([v, l]) => (
                <button key={v} onClick={() => setEquipment(equipment.indexOf(v) !== -1 ? equipment.filter(x => x !== v) : equipment.concat([v]))}
                  className="pixel-box px-3 py-2 text-[12px]"
                  style={{ background: equipment.indexOf(v) !== -1 ? 'var(--good)' : 'var(--surface2)', color: equipment.indexOf(v) !== -1 ? '#05140a' : 'var(--text2)' }}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="flex gap-2 mt-1">
          <Btn kind="ghost" className="flex-1" onClick={onClose}>Cancel</Btn>
          <Btn className="flex-1" onClick={() => onSave({
            id: (gym && gym.id) || 'gym_' + trainUid(),
            name: name.trim() || (Training.GYMS[type] || Training.GYMS.custom).label,
            type, bench, pullupBar: bar,
            equipment: type === 'custom' ? equipment : null,
          })}>Save</Btn>
        </div>
        {gym && onDelete && (
          <button onClick={() => onDelete(gym.id)} className="w-full py-3 text-[12px] mt-1" style={{ color: 'var(--danger)' }}>Delete this gym</button>
        )}
      </div>
    </div>
  );
}

// Pick where you are, at the start of a session. The reason this exists rather than one global
// setting: people genuinely train at home some days and a gym others, and a plan built for a cable
// stack is useless in a garage.
function GymPicker({ db, update, onClose, onPicked }) {
  useBackClose(onClose);
  const t = tdb(db);
  const gyms = gymsOf(db);
  const [editing, setEditing] = useState(gyms.length ? null : 'new');
  function save(g) {
    trainUpdate(update, (tr) => {
      tr.gyms = tr.gyms || [];
      const i = tr.gyms.findIndex(x => x.id === g.id);
      if (i >= 0) tr.gyms[i] = g; else tr.gyms.push(g);
      tr.prefs = Object.assign({}, tr.prefs, { currentGymId: g.id });
    });
    setEditing(null);
    onPicked && onPicked(g);
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Your gyms" className="fixed inset-0 z-[85] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-4 fade-in" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className="pf text-[12px] mb-1">Where are you training?</h2>
        <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
          Anything your plan needs and this place has not got gets swapped for something that works.
        </div>
        {gyms.map(g => (
          <button key={g.id} onClick={() => {
            trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { currentGymId: g.id }); });
            onPicked && onPicked(g);
          }} className="w-full text-left pixel-box p-3 mb-2 flex items-center justify-between gap-2"
            style={{ background: t.prefs.currentGymId === g.id ? 'color-mix(in srgb, var(--good) 16%, var(--surface2))' : 'var(--surface2)' }}>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold truncate">{g.name}</span>
              <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{gymSummary(g)}</span>
            </span>
            <span onClick={(e) => { e.stopPropagation(); setEditing(g); }} className="pf text-[8px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>Edit</span>
          </button>
        ))}
        <button onClick={() => setEditing('new')} className="pixel-box w-full h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>+ Add a gym</button>
        <button onClick={onClose} className="w-full py-3 text-[12px] mt-1" style={{ color: 'var(--muted)' }}>Close</button>
      </div>
      {editing && (
        <GymEditor gym={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)}
          onDelete={(id) => {
            trainUpdate(update, (tr) => { tr.gyms = (tr.gyms || []).filter(x => x.id !== id); });
            setEditing(null);
          }} />
      )}
    </div>
  );
}

// How the app programmes, in one screen. The engine has always worked this way; it just never said
// so, which made it look like it was guessing. Principles rather than names: the evidence base here
// is shared across the coaches who teach it, and putting individuals in the product would read as an
// endorsement nobody has given us.
function HowItWorks({ onBack }) {
  useBackClose(onBack);
  const rows = [
    ['Four weeks, then decide',
      'A block runs four weeks and you stay on it. Changing things every time a session feels hard is the most reliable way to make no progress at all, because nothing gets long enough to work. Four weeks is enough to know whether something is working and short enough that being wrong costs little.'],
    ['A lighter week when you have earned one',
      'We do not put a light week into every block on principle. Coaches in strength and physique sports take them roughly every four to eight weeks, and about as often when the athlete needs one as on a fixed schedule. So at the end of a block we look at what actually happened: whether lifts have stopped moving, whether the same sets are costing you more than they did, how much you got to, how close to your ceiling you have been running, and whether you are dieting or short on sleep. If enough of that lines up, we ask for a lighter week. If it does not, you carry on. A deload you have not earned just spends a good week.'],
    ['Volume, in hard sets',
      'Every muscle has three numbers: the least that grows it, the range where growth is best, and the point where fatigue outruns what you can recover from. Your plan aims at the middle band and is never allowed past the top one.'],
    ['Half a set for helping',
      'A movement gives a full set to what it mainly works and half a set to what it assists. It is how a coach counts, and it is what stops a push day looking like it covers your triceps when it does not.'],
    ['Effort in reps left, not "to failure"',
      'Sets are prescribed by how many reps you should have left. Week one leaves about three and that walks down as the block goes on, so the hardest weeks land when you are ready for them. Somewhere between none and about four reps left captures nearly all of the growth for a fraction of the fatigue that training to failure every set costs.'],
    ['Reps before weight',
      'When you clear the top of the rep range on every set, the weight goes up and the reps reset to the bottom. Before that, the job is another rep. Only after both does the plan add a set.'],
    ['Falling numbers mean less, not more',
      'If a lift stops moving at high volume, the answer is to cut the volume or change the movement. Adding more into a hole is the most common way people stall for months.'],
    ['Where a movement is hard',
      'Some exercises are hardest with the muscle stretched, some in the middle, some at the squeeze. A good week has a mix for each muscle rather than three versions of the same one.'],
    ['What we do not know',
      'Individual variation on all of this is large, and the honest answer to "how much volume do you need" is that it depends on the person more than on any number we could print. Your own bands move as your blocks show what you actually recover from, which matters more than where they started.'],
  ];
  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Training</button>
      <h1 className="pf text-lg mb-2">How your plan is built</h1>
      <div className="text-[12px] mb-6 leading-snug" style={{ color: 'var(--muted)' }}>
        None of this is guesswork or an AI making it up as it goes. These rules are written into the app, tested, and every number you see comes out of them.
      </div>
      {rows.map(([h, b], i) => (
        <Card key={i} className="p-4 mb-4">
          <div className="text-[13.5px] font-bold mb-1">{h}</div>
          <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>{b}</div>
        </Card>
      ))}
      <div className="text-[11px] leading-snug mt-2" style={{ color: 'var(--muted2)' }}>
        Where the research is genuinely unsettled we pick the more conservative option. None of it is a substitute for a coach who can watch you lift.
      </div>
    </div>
  );
}

// A small labelled action under an exercise. Four of these replaced four stacked full-width blocks:
// same reach, a quarter of the height, and the set table now starts where your thumb already is.
function ToolBtn({ children, onClick, on, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="pixel-box flex-1 h-11 text-[11px]"
      style={{
        background: on ? 'var(--accent)' : 'var(--surface2)',
        color: on ? 'var(--on-accent)' : (disabled ? 'var(--muted2)' : 'var(--text2)'),
        opacity: disabled ? 0.45 : 1,
      }}>
      {children}
    </button>
  );
}

// Beating your best used to happen in silence. It is the single most motivating thing that occurs in
// a gym and the app said nothing at all, which is a waste of the one moment that is genuinely worth
// celebrating. Rare, earned, and tied to a real number, so it never reads as a participation badge.
// Auto-dismisses, because a modal you have to close mid-set is a punishment, not a reward.
function PRFlash({ pr, db, units, onClose }) {
  const t = tdb(db);
  const ex = Training.byId(pr.exerciseId, t.custom);
  const buddy = db.buddy || {};
  useEffect(() => {
    const h = setTimeout(onClose, 2600);
    return () => clearTimeout(h);
  }, []);
  return (
    <div className="fixed inset-0 z-[92] flex items-center justify-center p-6 pointer-events-none" aria-live="polite">
      <div className="confetti" aria-hidden="true">
        {Array.from({ length: 22 }).map((_, i) => (
          <i key={i} style={{
            left: (5 + i * 4.3) + '%', animationDelay: (i % 6) * 0.16 + 's',
            animationDuration: (1.9 + (i % 4) * 0.3) + 's',
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          }} />
        ))}
      </div>
      <button onClick={onClose} className="pixel-box p-5 text-center fade-in pointer-events-auto max-w-[300px]"
        style={{ background: 'var(--card)', boxShadow: '0 0 0 4px var(--accent)' }}>
        {/* The buddy's real sprite, at its real stage, wearing what the person actually bought it.
            This used to render a bare SpriteSheet pinned to stage 3, so a hatchling flexed like a
            Rexosaur and 180 Amber of Ember Aura was invisible on the one screen that celebrates. */}
        <div className="flex justify-center mb-2">
          <BuddyAvatar buddy={buddy} px={4} />
        </div>
        <div className="pf text-[13px] mb-2" style={{ color: 'var(--accent-ink)' }}>NEW BEST</div>
        <div className="text-[15px] font-bold leading-tight mb-1">{ex ? ex.name : 'Personal record'}</div>
        <div className="pf text-[16px] tnum mb-2">{toDisplayWeight(pr.weightKg, units)}{unitLabel(units)} × {pr.reps}</div>
        <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>{pr.label}</div>
      </button>
    </div>
  );
}

/* ---- the send-off -------------------------------------------------------------------------------
   Finishing a session used to be a toast: "14 sets logged. Good work.", sliding past the button you
   had just pressed, and then the Train tab again. That is a flat ending for the hardest hour of
   somebody's day, and it is the one moment in the module where the buddy has something unarguable
   to react to, because the work is already done and nothing is being asked of anybody.

   So the buddy meets you at the door. Game.sessionPraise picks the single thing worth leading with,
   ordered by how rare it is rather than by how good it sounds, and the numbers underneath are the
   ones the session actually produced. One button out. No CTA to do more, no "keep it up tomorrow":
   the session is over, and the last word belongs to what just happened. */
function signOffLine(praise, facts, who, units) {
  if (!praise) return null;
  const k = praise.kind;
  if (k === 'first') return { head: 'Your first one', body: 'That is your first session in the book, ' + praise.sets + ' sets of it. Everything from here has something to be measured against, which is the part most people never get to.' };
  if (k === 'block_done') return { head: 'Block finished', body: 'That was the last session of ' + (facts.blockName ? '"' + facts.blockName + '"' : 'the block') + '. Four weeks, all the way through. Go and see what moved before you build the next one.' };
  if (k === 'pr') return { head: praise.prs === 1 ? 'A new best' : praise.prs + ' new bests', body: praise.prs === 1 ? 'You lifted something today you have never lifted before. I was watching.' : 'Two of your movements went past anything you had done before. Days like this are not the norm, so enjoy it.' };
  if (k === 'week_done') return { head: 'Week done', body: 'That is all ' + praise.weekOf + ' sessions this week, in the bag. Weeks like this one are what the block is actually made of.' };
  if (k === 'big') return { head: 'Heavy day', body: 'You moved about ' + praise.pct + '% more than your usual session today. Eat properly tonight and I will put it to work.' };
  if (k === 'short') return { head: 'In and out', body: praise.sets + (praise.sets === 1 ? ' set' : ' sets') + ' and gone. A short session you actually did beats the perfect one you skipped, every time.' };
  return { head: 'Logged', body: praise.sessionsLast7 >= 3 ? praise.sets + ' sets down, and that is ' + praise.sessionsLast7 + ' sessions this week. You are in a proper rhythm.' : praise.sets + ' sets down and all of it recorded. Get some protein in while you are still warm.' };
}
function SessionSignOff({ db, facts, units, onDone }) {
  useBackClose(onDone);
  const praise = Game.sessionPraise(facts);
  const line = signOffLine(praise, facts, buddyName(db), units);
  const buddy = db.buddy || {};
  const stage = Math.min((buddy.stage != null ? buddy.stage : 0), BUDDY_STAGES.length - 1);
  // Confetti belongs to the genuinely rare ones. On an ordinary Tuesday it would be the participation
  // badge the whole design is trying not to be.
  const party = praise && (praise.kind === 'block_done' || praise.kind === 'pr' || praise.kind === 'first');
  const stat = (label, value) => (
    <div className="flex-1 text-center">
      <div className="pf text-[13px] tnum">{value}</div>
      <div className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>{label}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.72)' }} role="dialog" aria-modal="true">
      {party && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 22 }).map((_, i) => (
            <i key={i} style={{
              left: (5 + i * 4.3) + '%', animationDelay: (i % 6) * 0.16 + 's',
              animationDuration: (2 + (i % 4) * 0.3) + 's',
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            }} />
          ))}
        </div>
      )}
      <div className="w-full max-w-sm pixel-box fade-in p-5 max-h-[88vh] overflow-y-auto" style={{ background: 'var(--card)' }}>
        <div className="flex justify-center mb-4">
          <BuddyScene buddy={buddy} stageIndex={stage} px={4} w={150} h={112}
            floor={26} spriteBottom={6} shadowW={62} eq={equippedCosmetics(buddy)} />
        </div>
        <div className="pf text-[11px] text-center mb-2" style={{ color: 'var(--accent-ink)' }}>{(line ? line.head : 'Logged').toUpperCase()}</div>
        <div className="text-[13px] leading-relaxed text-center mb-4">{line ? line.body : 'Session saved.'}</div>

        {/* Tonnage only appears when there is tonnage. A bodyweight session, or one logged without
            weights, would otherwise be handed a celebratory "0 kg moved", which is the app calling
            the work they just did nothing. */}
        <div className="flex items-start gap-1 py-3 mb-4" style={{ borderTop: '2px solid var(--border)', borderBottom: '2px solid var(--border)' }}>
          {stat(facts.sets === 1 ? 'set' : 'sets', facts.sets)}
          {facts.tonnageKg > 0 && stat(unitLabel(units) + ' moved', Math.round(toDisplayWeight(facts.tonnageKg, units)).toLocaleString())}
          {stat(facts.minutes === 1 ? 'minute' : 'minutes', facts.minutes)}
          {facts.movementsTotal > 0 && stat('movements', facts.movementsDone + '/' + facts.movementsTotal)}
        </div>

        {/* A record is the one thing here worth its own frame. Named, with the number, because
            "1 PR" is a badge and "Incline dumbbell press, heaviest ever" is the thing you tell
            somebody about. Capped at three: past that it is a list, not a moment. */}
        {(facts.prList || []).map((p, i) => (
          <div key={i} className="pixel-box p-3 mb-2 text-[11.5px] leading-snug"
            style={{ borderColor: 'var(--good)', background: 'var(--card)', color: 'var(--good-ink)' }}>
            <span className="font-bold">{p.name}</span> · {p.label}
          </div>
        ))}

        {/* What you actually lifted, movement by movement. */}
        {(facts.movements || []).length > 0 && (
          <div className="pixel-box mb-4" style={{ background: 'var(--card)' }}>
            {facts.movements.map((m, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5" style={i ? { borderTop: '2px solid var(--track)' } : null}>
                <span className="flex-1 min-w-0 text-[12px] leading-snug" style={{ color: m.logged ? 'var(--text2)' : 'var(--muted2)' }}>{m.name}</span>
                <span className="text-[11px] tnum shrink-0 text-right" style={{ color: 'var(--muted)' }}>{m.detail}</span>
              </div>
            ))}
          </div>
        )}

        {/* The one place the streak is worth mentioning: a session is an active day now, and the
            person who trained instead of logging their dinner should be told their run is safe. */}
        <div className="text-[11px] text-center mb-4 leading-snug" style={{ color: 'var(--muted2)' }}>
          Today counts toward your streak.
        </div>
        <button onClick={onDone} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Done</button>
      </div>
    </div>
  );
}

// A short rising fanfare. Deliberately different from the rest-timer beep: one says "go", this says
// "you have never done that before", and they should never be mistaken for one another.
function prFanfare(prefs) {
  if (prefs && prefs.restSound === false) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[0, 523], [0.09, 659], [0.18, 784], [0.29, 1047]].forEach(([at, freq]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.26);
    });
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 1200);
  } catch (_) {}
}

// ---- the character sheet ------------------------------------------------------------------------
// The coverage panel was already a row of bars that looked exactly like RPG stats, so this leans all
// the way in: your buddy has four stats and every one of them comes out of sets you actually logged.
// Nothing is awarded for opening the app. That is the difference between a number that means
// something and a badge that does not.
function StatSheet({ db, onBack }) {
  useBackClose(onBack);
  const t = tdb(db);
  const units = t.prefs.units;
  const buddy = db.buddy || {};
  const stats = Training.statSheet(t.logs, {
    bodyweightKg: (db.profile && db.profile.weightKg) || 75,
    targets: trainTargets(db), custom: t.custom,
  });
  const name = buddy.name || 'Your buddy';
  const rows = [
    ['str', 'Strength', 'How much of the four big movement patterns you have built, against your bodyweight. Missing one costs you here.'],
    ['pow', 'Power', 'Your single best lift, against your bodyweight.'],
    ['end', 'Endurance', 'How much work you get through in a week, and how much of it lives in the higher rep ranges.'],
    ['bal', 'Balance', 'How evenly the work is spread across your body. The only stat you can raise without lifting anything heavier.'],
  ];
  const untrained = t.logs.length === 0;

  return (
    <div className="fade-in">
      <SubHeader back={onBack} backLabel="Train" title="Stats" />
      <div className="pf text-[9px] uppercase mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}>What the training adds up to</div>
      <h1 className="pf text-lg mb-4">Stats</h1>

      <Card className="p-0 overflow-hidden mb-4">
        <CardHead title={name + ' · overall'} />
        <div className="p-4 text-center">
          {/* The character sheet is the buddy's own screen, so it shows the buddy: its stage, its
              colourway and its terrarium, not a stage-3 stand-in with the cosmetics stripped off. */}
          <div className="flex justify-center mb-2">
            <BuddyScene buddy={buddy} stageIndex={Math.min(buddy.stage || 0, BUDDY_STAGES.length - 1)}
              px={4} w={150} h={112} floor={26} spriteBottom={6} shadowW={62} eq={equippedCosmetics(buddy)} />
          </div>
          <div className="pf text-[30px] mb-2" style={{ color: 'var(--accent-ink)' }}>{stats.overall}</div>
          <div className="text-[11.5px] leading-relaxed" style={{ color: 'var(--muted)' }}>Worked out from what you have actually lifted, against your bodyweight. It moves slowly and it does not lie.</div>
        </div>
      </Card>

      {untrained ? (
        <Card className="p-4">
          <div className="text-[13px] mb-1">Nothing to measure yet.</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
            Log a session and these fill in. Every one of them comes from real sets, so none of them move until you do.
          </div>
        </Card>
      ) : (
        // Ruled between the four, per the design. Stacked with nothing but whitespace, a bar and its
        // explanation drifted towards the bar below it and the four read as one long column.
        <Card className="p-0 overflow-hidden mb-4">
          {rows.map(([k, label, why], i) => (
            <div key={k} className="p-3.5" style={i ? { borderTop: '2px solid var(--border)' } : null}>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="pf text-[9px] uppercase" style={{ letterSpacing: '0.14em' }}>{label}</span>
                <span className="pf text-[13px] tnum" style={{ color: 'var(--accent-ink)' }}>{stats[k]}</span>
              </div>
              {/* Segmented, so it reads as a Game Boy power bar rather than a progress spinner. The
                  frame and the ink hairlines are the house meter, same as everywhere else. */}
              <div className="flex gap-[1px] mb-2" style={{ border: '2px solid var(--border)', background: 'var(--border)' }}>
                {Array.from({ length: 20 }, (_, j) => (
                  <span key={j} className="flex-1" style={{ height: 11, background: j * 5 < stats[k] ? 'var(--accent)' : 'var(--track)' }} />
                ))}
              </div>
              <div className="text-[11.5px] leading-snug" style={{ color: 'var(--muted)' }}>{why}</div>
            </div>
          ))}
        </Card>
      )}

      {!untrained && (
        <Card className="p-0 overflow-hidden">
          <CardHead title="Behind the numbers" />
          <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]">
            <span>Best single lift</span>
            <span className="pf text-[10px] tnum shrink-0" style={{ color: 'var(--accent-ink)', letterSpacing: '0.06em' }}>{toDisplayWeight(stats.bestLiftKg, units)}{unitLabel(units)} est. 1RM</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]" style={{ borderTop: '2px solid var(--border)' }}>
            <span>Hard sets a week</span>
            <span className="pf text-[10px] tnum shrink-0" style={{ color: 'var(--accent-ink)', letterSpacing: '0.06em' }}>{stats.setsPerWeek}</span>
          </div>
          {Object.keys(stats.patterns).length > 0 && Object.keys(stats.patterns).map(p => (
            <div key={p} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-[13px]" style={{ borderTop: '2px solid var(--border)' }}>
              <span>
                {{ squat: 'Best squat pattern', hinge: 'Best hinge', horizPress: 'Best press', vertPull: 'Best pull-up or pulldown' }[p] || p}
              </span>
              <span className="pf text-[10px] tnum shrink-0" style={{ color: 'var(--accent-ink)', letterSpacing: '0.06em' }}>{toDisplayWeight(stats.patterns[p], units)}{unitLabel(units)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// A list of things you can do, as a sheet. The grid of chunky boxes this replaced was crammed two
// across in the middle of the card you were working in, so it read as part of the layout rather than
// as a menu, and there was no room for any of the options to say what they actually did.
function ActionSheet({ title, actions, onClose }) {
  useBackClose(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label="Options" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box fade-in max-h-[80vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        {/* Everything in this app is set in a pixel face, which runs about a full em per character.
            A 13px label that would be one comfortable line in a normal typeface wraps to two here
            and turns a six-item menu into a full-screen scroll, so the sizes are a step down from
            what they would otherwise be. */}
        <div className="px-4 pt-4 pb-2">
          <div className="pf text-[8px] uppercase" style={{ color: 'var(--muted)' }}>{title}</div>
        </div>
        {/* Two things this list has to get right, both of them from the same finding: a consequential
            option sitting flush against a benign one gets picked by accident (NN/g, "Dangerous UX:
            Consequential Options Close to Benign Options").
            1. A destructive row is separated by a real gap, not just coloured red, so the tap that
               lands one row low from "Move down" lands in the gap rather than on "Take it out".
            2. `keepOpen` leaves the sheet up after the tap, for actions that are meant to be repeated.
               Reordering a six-movement session by closing the menu every time is fifteen taps, and
               menu-driven reorder is the ACCESSIBLE alternative to dragging, so it has to not be
               punishing to use. */}
        {(actions || []).filter(Boolean).map((a, i) => {
          const prev = (actions || []).filter(Boolean)[i - 1];
          const opensGap = a.danger && prev && !prev.danger;
          return (
            <button key={i} disabled={a.disabled}
              onClick={() => { if (!a.keepOpen) onClose(); if (a.onClick) a.onClick(); }}
              className="w-full text-left px-4 py-3"
              style={{
                borderTop: '2px solid var(--border)',
                marginTop: opensGap ? 12 : 0,
                color: a.disabled ? 'var(--muted2)' : (a.danger ? 'var(--danger)' : 'var(--text)'),
                opacity: a.disabled ? 0.5 : 1,
              }}>
              <span className="block text-[12px] font-semibold leading-tight">{a.label}</span>
              {a.sub && <span className="block text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--muted)' }}>{a.sub}</span>}
            </button>
          );
        })}
        <button onClick={onClose} className="w-full px-4 py-3 text-[12px]" style={{ borderTop: '2px solid var(--border)', color: 'var(--muted)' }}>Cancel</button>
      </div>
    </div>
  );
}

// Placeholder rows while something loads. "Loading..." as a line of text reads as a screen that has
// gone wrong; an outline of the shape that is coming reads as a screen that is working.
function SkeletonRows({ n = 3 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="pixel-box p-4 mb-4" style={{ background: 'var(--card)', opacity: 0.55 }}>
          <div className="h-3 mb-2" style={{ background: 'var(--track)', width: (55 + (i % 3) * 12) + '%', animation: 'fade 1.1s ease-in-out infinite alternate' }} />
          <div className="h-2 mb-4" style={{ background: 'var(--track)', width: (30 + (i % 2) * 15) + '%', animation: 'fade 1.1s ease-in-out infinite alternate' }} />
          <div className="flex gap-1">
            {[0, 1, 2].map(k => <div key={k} className="h-2 flex-1" style={{ background: 'var(--track)', animation: 'fade 1.1s ease-in-out infinite alternate' }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
