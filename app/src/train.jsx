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
function weekPlan(block, week, logs) {
  const comp = Training.completion(block, logs);
  return Training.weekSessions(block, week)
    .slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map(s => ({ session: s, log: comp.logBySession[s.id] || null }));
}

// ---- shared bits ------------------------------------------------------------------------------

// The coverage instrument. One row per muscle: a track marked at MEV and MAV, and a bar that
// changes tone by band. Deliberately the same "row of discrete blocks" language as the macro
// meters elsewhere in the app, so it reads as the same family of instrument.
function CoverageRow({ row, compact }) {
  const tone = { none: 'var(--danger)', under: 'var(--danger)', maintaining: 'var(--warn)', productive: 'var(--good)', high: 'var(--warn)', over: 'var(--danger)' }[row.band];
  const scale = Math.max(row.mrv, row.sets, 1);
  const pct = v => Math.min(100, (v / scale) * 100);
  return (
    <div className={compact ? 'mb-2' : 'mb-4'}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] truncate" style={{ color: 'var(--text2)' }}>{row.label}</span>
        <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
          <span style={{ color: tone, fontWeight: 700 }}>{row.sets}</span> / {row.mev}-{row.mav}
        </span>
      </div>
      <div className="relative h-2 mt-1" style={{ background: 'var(--track)' }}>
        <div className="absolute inset-y-0 left-0" style={{ width: pct(row.sets) + '%', background: tone }} />
        {/* MEV and MAV markers: the floor that grows and the top of the productive band. */}
        <div className="absolute inset-y-0 w-px" style={{ left: pct(row.mev) + '%', background: 'var(--muted2)' }} />
        <div className="absolute inset-y-0 w-px" style={{ left: pct(row.mav) + '%', background: 'var(--muted2)' }} />
      </div>
    </div>
  );
}

function CoverageBars({ coverage, limit, compact }) {
  const rows = limit ? coverage.rows.slice().sort((a, b) => a.pct - b.pct).slice(0, limit) : coverage.rows;
  return <div>{rows.map(r => <CoverageRow key={r.muscle} row={r} compact={compact} />)}</div>;
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
    setScreen({ name: 'import', url: importUrl });
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
    return page(<SessionPreview db={db} session={sess} block={blk} onBack={() => go('home')}
      onStart={() => startSession(sess, blk)} />);
  }
  if (screen.name === 'builder') {
    return page(<BlockBuilder db={db} update={update} showToast={showToast} isPremium={isPremium}
      blockId={screen.blockId} draft={screen.draft} clearDraft={screen.clearDraft} onBack={() => go(screen.from || 'home')}
      onStart={screen.blockId ? startSession : null} />);
  }
  if (screen.name === 'wizard') {
    return page(<BlockWizard db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      onBack={() => go('home')} onDraft={(draft) => go('builder', { draft })} onShots={() => go('draft')} />);
  }
  if (screen.name === 'import') {
    return page(<WorkoutImport db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      initialUrl={screen.url}
      onBack={() => go(screen.from || 'home')} onDraft={(draft) => go('builder', { draft })}
      onCollected={() => go('draft')} />);
  }
  if (screen.name === 'draft') {
    return page(<BlockDraft db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      onBack={() => go('home')} onImport={() => go('import', { from: 'draft' })}
      onBuild={(draft) => {
        // The draft's days become week 1 and the block is written on top, exactly as a single
        // import would be. Nothing about a multi-source block is a different code path.
        //
        // 'as-written' rather than the app's own periodisation, because these days came off somebody
        // else's plan. Adding a set a week to a programme built on two hard sets is not building on
        // it, it is disagreeing with it, and the person chose that coach over us.
        const block = Training.blockFromTemplate(draft.days, {
          weeks: 4, shape: 'as-written', targets: trainTargets(db), custom: tdb(db).custom,
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
      onBack={() => go('home')} onOpen={(blockId) => go('builder', { blockId, from: 'blocks' })} onNew={() => go('wizard')}
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
          <Icon.sliders width="18" height="18" />
        </button>
      </div>

      {/* ---- the block ---- */}
      {block && !blockDone && (
        <Card className="p-4 mb-4">
          {/* The name is the way into the block itself: editing it, and deleting it if it was built
              by mistake. That used to be reachable from nowhere at all. */}
          <button onClick={() => go('blocks')} className="w-full flex items-start justify-between gap-2 text-left mb-4">
            <span className="min-w-0">
              <span className="block text-[15px] font-bold leading-tight" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{block.name}</span>
              <span className="block text-[11px] tnum mt-1" style={{ color: doneThisWeek === thisWeek.length ? 'var(--good)' : 'var(--muted)' }}>
                {doneThisWeek} of {thisWeek.length} done this week
              </span>
            </span>
            <Icon.chevron width="15" height="15" style={{ color: 'var(--muted2)', flexShrink: 0, marginTop: 2 }} />
          </button>

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
              const mins = Math.round((session.exercises || []).reduce((a, e) => a + (e.target.sets || 0) * (((e.target.restSec || 120) + 40) / 60), 0));
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
                      {done ? (log.sets || []).filter(s => s.done).length + ' sets done' : sets + ' sets · about ' + mins + ' min'}
                    </span>
                  </span>
                  {isNext && <span className="pf text-[7px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>Next</span>}
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
            <button onClick={() => onOpen(next.session, block)} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
              Open {next.session.name.split(' - ')[0]}
            </button>
          ) : (
            <div className="text-[12.5px] text-center py-3" style={{ color: 'var(--good)' }}>
              Week {prog.week} done. That is the whole week, in the bag.
            </div>
          )}
        </Card>
      )}

      {block && blockDone && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--good) 12%, var(--surface2))' }}>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--good)' }}>Block finished</div>
          <div className="text-[15px] font-bold mb-1">{block.name}</div>
          <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
            All {block.weeks} weeks are behind you. See what moved, then build the next one on top of it.
          </div>
          <button onClick={() => go('review', { blockId: block.id })} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
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
          <button onClick={() => go('wizard')} className="pixel-btn w-full h-14 font-bold mb-2" style={{ background: '#fff', color: '#111' }}>
            Build a 4-week block
          </button>
          <div className="flex gap-2 mb-2">
            <button onClick={() => go('import')} className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Import one</button>
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
        <button onClick={() => go('history')} className="w-full text-left pixel-box p-4 mb-4 flex items-center justify-between gap-3" style={{ background: 'var(--card)' }}>
          <span className="min-w-0">
            <span className="pf text-[9px] uppercase block" style={{ color: 'var(--muted)' }}>Last session</span>
            <span className="block text-[13px] font-semibold mt-1 truncate">{lastLog.name || 'Session'}</span>
            <span className="block text-[11px] tnum mt-0.5" style={{ color: 'var(--muted2)' }}>
              {relativeDay(lastLog.dateISO, today)} · {(lastLog.sets || []).filter(s => s.done).length} sets · {Math.round(toDisplayWeight(Training.tonnage(lastLog), units)).toLocaleString()}{unitLabel(units)}
            </span>
          </span>
          <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
        </button>
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

      {/* ---- where new blocks come from. Three routes, given equal weight, because which one a
              person reaches for depends entirely on whether they already follow a coach. ---- */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <button onClick={() => go('library')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
          Browse<br />blocks
        </button>
        <button onClick={() => go('import')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
          Import<br />a plan
        </button>
        <button onClick={() => go('wizard')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
          Build<br />with AI
        </button>
      </div>

      {/* ---- secondary routes ----
              "Empty session" used to sit here as an equal to History and Stats, which oversold it.
              It is for the days that are not in the plan: a class, a holiday gym, a bit of arms on
              the way past. That is worth having and not worth advertising, so it lives with the
              block it is an exception to, and only shows once there is a block to be an exception
              to at all. ---- */}
      <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1 py-1 text-[12px]">
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
      setRest({ endsAt: Date.now() + secs * 1000, seconds: secs, alerted: false });
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
      const pre = Training.prefillSets({ exerciseId: exId, target: { sets: 3, repLow: 8, repHigh: 12 } }, t.logs, t.custom);
      // Added mid-session, so it has no line in the plan to point back to. It gets its own id so
      // its sets still group as one movement when the session is reopened.
      n.push({ id: 'add_' + trainUid(), exerciseId: exId, target: { sets: 3, repLow: 8, repHigh: 12, rir: 2, restSec: 120 }, sets: pre.sets, note: coachNote(pre), superset: null });
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
  const volume = items.reduce((a, it) => a + it.sets.reduce((b, s) => b + (s.done ? (+s.weightKg || 0) * (+s.reps || 0) : 0), 0), 0);
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const pct = totalSets ? Math.round((doneSets / totalSets) * 100) : 0;
  const codes = Training.sessionCodes(items);

  return (
    // Clears the Finish bar AND the rest timer floating above it (96 + 56), plus a line of air, so
    // the last movement can always be scrolled out from under both.
    <div className="fade-in" style={{ paddingBottom: '176px' }}>
      {/* ---- session bar ---- */}
      <div className="sticky top-0 z-20 -mx-5 px-5 pt-1 pb-3" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center gap-2 mb-2">
          <button onClick={onExit} aria-label="Back to Train" className="pf text-[9px] uppercase hit shrink-0" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
          <div className="flex-1 min-w-0 text-center text-[13px] font-bold truncate">{session ? session.name : 'Empty session'}</div>
          <div className="tnum text-[12px] shrink-0 w-12 text-right" style={{ color: 'var(--muted)' }}>{fmtClock(elapsed)}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5" style={{ background: 'var(--track)' }}>
            <div className="h-full transition-all" style={{ width: pct + '%', background: 'var(--accent)' }} />
          </div>
          <div className="tnum text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>
            {doneSets}/{totalSets} · {Math.round(toDisplayWeight(volume, units)).toLocaleString()}{unitLabel(units)}
          </div>
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
            }} className="pixel-btn flex-1 h-11 font-bold" style={{ background: '#fff', color: '#111' }}>
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
                  const pre = Training.prefillSets({ exerciseId: u.alt, target: old2.target || { sets: 3, repLow: 8, repHigh: 12 } }, t.logs, t.custom);
                  n[u.index] = { id: old2.id || ('swap_' + trainUid()), exerciseId: u.alt, target: old2.target, sets: pre.sets, note: coachNote(pre), superset: old2.superset };
                });
              });
              showToast && showToast('Swapped for what is here.');
              setUnavailable([]);
            }} className="pixel-btn flex-1 h-11 font-bold" style={{ background: '#fff', color: '#111' }}>Swap them</button>
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
            {/* ---- header, always visible ---- */}
            <button onClick={() => { setFocus(open ? -1 : ii); setPlateFor(null); setMenuOpen(false); }}
              className="w-full flex items-start gap-3 p-3 text-left">
              <span className="pf text-[10px] shrink-0 mt-0.5 w-6" style={{ color: done ? 'var(--good)' : 'var(--accent-ink)' }}>{codes[ii]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold leading-tight" style={{ color: done ? 'var(--muted)' : 'var(--text)' }}>
                  {ex ? ex.name : it.exerciseId}
                </span>
                <span className="block pf text-[8px] uppercase mt-2" style={{ color: done ? 'var(--good)' : 'var(--accent-ink)' }}>
                  {work.length} {work.length === 1 ? 'set' : 'sets'} / {tgt ? tgt.repLow + '-' + tgt.repHigh : '–'} reps
                  {tgt ? ' / ' + tgt.rir + ' RIR' : ''}
                </span>
              </span>
              {done
                ? <span className="shrink-0 w-6 h-6 flex items-center justify-center text-[13px] font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}><Tick size={13} /></span>
                : <span className="shrink-0 mt-1" style={{ color: 'var(--muted2)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><Icon.chevron width="15" height="15" /></span>}
            </button>

            {open && (
              <div className="px-3 pb-3">
                <div className="h-px mb-4" style={{ background: 'var(--accent)', opacity: 0.35 }} />

                {/* ---- the prescription, with the jargon explained where it appears ---- */}
                <div className="flex items-center gap-3 mb-4">
                  {tgt && <MetaBit label={tgt.rir + ' RIR'} onHelp={() => setHelp('rir')} hideHelp={t.prefs.hideHelp} />}
                  {tgt && tgt.tempo && <MetaBit label={tgt.tempo} onHelp={() => setHelp('tempo:' + tgt.tempo)} hideHelp={t.prefs.hideHelp} />}
                  {tgt && <MetaBit label={fmtRest(tgt.restSec || 120)} onHelp={() => setHelp('rest')} muted hideHelp={t.prefs.hideHelp} />}
                  <span className="ml-auto shrink-0">
                    <LiftBuddy db={db} pattern={ex && ex.pattern} trigger={lift.ii === ii ? lift.n : 0} />
                  </span>
                </div>

                {it.note && <div className="text-[11.5px] mb-2 leading-snug" style={{ color: 'var(--accent-ink)' }}>{it.note}</div>}

                {/* Warm-up, only until you have started. Once the first working set is in, telling
                    you what to warm up with is stale advice taking up a third of the card. */}
                {warmups.length === 0 && !work.some(x => x.done) && work[0] && work[0].weightKg > 0
                  && Training.warmupSets(work[0].weightKg, ex).length > 0 && (
                  <div className="text-[11.5px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
                    <span style={{ color: 'var(--muted2)' }}>Warm up: </span>
                    {Training.warmupSets(work[0].weightKg, ex).map(u => u.reps + ' @ ' + toDisplayWeight(u.weightKg, units) + unitLabel(units)).join(', ')}
                  </div>
                )}

                {/* One tool row where four stacked blocks used to be. The note box, the history
                    button and the options grid were all permanently on screen, so the card was
                    mostly chrome and the set table, which is the only thing you touch while
                    training, started two thirds of the way down. */}
                <div className="flex gap-2 mb-4">
                  <ToolBtn on={noteOpen === it.exerciseId || !!exNotes[it.exerciseId]}
                    onClick={() => setNoteOpen(noteOpen === it.exerciseId ? null : it.exerciseId)}>Note</ToolBtn>
                  <ToolBtn disabled={!hist.length} onClick={() => setPastFor(it.exerciseId)}>History</ToolBtn>
                  <ToolBtn on={menuOpen === ii} onClick={() => setMenuOpen(ii)}>More</ToolBtn>
                </div>

                {(noteOpen === it.exerciseId || exNotes[it.exerciseId]) && (
                  <input value={exNotes[it.exerciseId] || ''} onChange={e => setExNote(it.exerciseId, e.target.value)}
                    placeholder="e.g. seat 3, pin 6" autoFocus={noteOpen === it.exerciseId}
                    className="w-full pixel-box px-3 h-10 text-[12px] mb-4" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
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
                  const cellStyle = { background: s.done ? 'color-mix(in srgb, var(--accent) 16%, var(--surface2))' : 'var(--surface2)', color: 'var(--text)' };
                  // 15px could not fit "62.5" in the weight box, and a clipped decimal reads as a
                  // different number rather than as truncation. 13px fits four characters at 375px.
                  // Taller and larger now the Prev column is not stealing the width.
                  const cell = 'h-12 pixel-box text-[15px] text-center tnum min-w-0 px-0.5';
                  return (
                    <div key={si} className="mb-2 -mx-1 px-1 py-0.5" style={{ background: s.done ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent' }}>
                      <div className="flex items-center gap-2">
                        {/* Tap the number to change what kind of set it is. Warm-ups stay out of the
                            volume maths; a drop set suppresses the rest timer. */}
                        <button onClick={() => setSetMenu(setMenu === ii + ':' + si ? null : ii + ':' + si)}
                          aria-label={'Set ' + workIndex + ' options. Currently ' + (SET_TYPES.find(x => x.v === type) || {}).full}
                          className="w-11 h-12 flex items-center justify-center shrink-0">
                          <span className="w-7 h-7 flex items-center justify-center text-[12px] font-bold"
                            style={{
                              background: s.done ? 'var(--accent)' : 'transparent',
                              color: s.done ? 'var(--on-accent)' : (tone || 'var(--muted)'),
                              border: s.done ? 'none' : '2px solid ' + (tone || 'var(--border)'),
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
                            background: s.done ? 'var(--accent)' : 'var(--surface2)',
                            color: s.done ? 'var(--on-accent)' : 'var(--muted2)',
                            opacity: s.done ? 1 : 0.85,
                            transform: justDone === ii + ':' + si ? 'scale(1.12)' : 'scale(1)',
                          }}>
                          <Tick size={19} />
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

                {/* Last time as a reference line, not a column and not a number typed into the box.
                    We ask for an effort; what that costs in kilos is the lifter's call on the day. */}
                {(() => {
                  const lt = it.sets.map(x => x.lastTime).filter(Boolean)[0];
                  if (!lt) return null;
                  return (
                    <div className="text-[11px] mt-2" style={{ color: 'var(--muted2)' }}>
                      Last time {toDisplayWeight(lt.weightKg, units)}{unitLabel(units)} × {lt.reps}
                    </div>
                  );
                })()}

                <button onClick={() => addSet(ii)} className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add set</button>
              </div>
            )}
          </div>
        );
      })}

      <button onClick={() => setPicking(true)} className="pixel-box w-full h-12 text-[13px] mb-4" style={{ background: 'var(--surface2)' }}>+ Add an exercise</button>

      <Collapsible label="Session notes" sub={notes ? 'Written' : 'Optional'} variant="inline" className="mb-4">
        <textarea value={notes} onChange={e => { setNotes(e.target.value); persist(null, e.target.value); }} rows={3}
          placeholder="Anything worth remembering next time"
          className="w-full pixel-box px-3 py-3 text-[13px] mt-2" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
      </Collapsible>

      {/* ---- rest timer, above the finish button, never shoving the list about ----
           74px cleared the Finish button itself but not the 12px of padding above it, so the two
           pixel-box shadows overlapped and the pair read as one cramped stack. Finish is 56 tall
           inside 12 top and 12 bottom of padding, so 88 is the first value that clears it, plus 8
           off the spacing scale to sit them apart. */}
      {rest && (
        <div className="fixed inset-x-0 max-w-md mx-auto px-3 z-30" style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
          <div className="pixel-box flex items-center gap-3 px-3 h-14" style={{ background: restLeft <= 0 ? 'color-mix(in srgb, var(--accent) 22%, var(--card))' : 'var(--card)' }}>
            <RestRing left={restLeft} total={rest.seconds} db={db} />
            <div className="flex-1 min-w-0">
              <div className="pf text-[15px] tnum" role="timer" style={{ color: restLeft <= 10 ? 'var(--good)' : 'var(--accent-ink)' }}>
                {restLeft <= 0 ? 'Go' : fmtClock(restLeft)}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--muted2)' }}>rest</div>
            </div>
            {/* The timer finishing was announced by a beep and a colour, both of which are no use to
                a screen reader. Only the transition is announced, never the count: a polite region
                on a per-second value would read the whole two minutes out loud. */}
            <span className="sr-only" aria-live="assertive">{restLeft <= 0 ? 'Rest over, next set' : ''}</span>
            {/* Every control on this bar is now a full 44px box. These are pressed mid-set, one
                handed, with the phone on a bench and chalk on your fingers, which is the worst
                pointing conditions the app ever sees; Skip in particular was an 8px label with no
                box around it at all. */}
            <button onClick={() => setRest(r => r && Object.assign({}, r, { endsAt: r.endsAt - 15000 }))} className="pixel-box w-11 h-11 text-[11px] shrink-0" style={{ background: 'var(--surface2)' }}>-15</button>
            <button onClick={() => setRest(r => r && Object.assign({}, r, { endsAt: r.endsAt + 15000, seconds: r.seconds + 15, alerted: false }))} className="pixel-box w-11 h-11 text-[11px] shrink-0" style={{ background: 'var(--surface2)' }}>+15</button>
            <button onClick={() => setRest(null)} aria-label="Skip rest" className="pf text-[8px] uppercase h-11 px-2 shrink-0" style={{ color: 'var(--muted)' }}>Skip</button>
          </div>
        </div>
      )}

      <StickyAction clearsNav={false}>
        <button onClick={() => setConfirmEnd(true)} className="pixel-btn w-full h-14 font-bold"
          style={{ background: doneSets ? 'var(--accent)' : '#fff', color: doneSets ? 'var(--on-accent)' : '#111' }}>
          {doneSets ? 'Finish · ' + doneSets + (doneSets === 1 ? ' set' : ' sets') : 'Finish session'}
        </button>
      </StickyAction>

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
            { label: 'Log warm-up sets', sub: 'Adds rows above the working sets', onClick: () => addWarmups(menuOpen) },
            items[menuOpen].superset
              ? { label: 'Break the superset', onClick: () => toggleSuperset(menuOpen) }
              : { label: 'Superset with the next', sub: 'No rest between them', disabled: !items[menuOpen + 1], onClick: () => toggleSuperset(menuOpen) },
            { label: 'Move earlier', disabled: menuOpen === 0, onClick: () => move(menuOpen, -1) },
            { label: 'Move later', disabled: menuOpen >= items.length - 1, onClick: () => move(menuOpen, 1) },
            { label: 'Remove from session', danger: true, onClick: () => removeExercise(menuOpen) },
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
function LiftBuddy({ db, pattern, trigger }) {
  const [rep, setRep] = useState(0);
  useEffect(() => { if (trigger > 0) setRep(trigger); }, [trigger]);
  const buddy = (db && db.buddy) || {};
  if (buddy.hatched === false) return null;    // an egg has nothing to lift with
  const species = buddy.species || 'doux';
  const move = PATTERN_ANIM[pattern] || 'jump';
  let palette = buddy.palette || 'female';
  // Some male colourways ship without these strips. Falling back keeps the buddy on screen rather
  // than requesting a 404 and leaving a hole where it was standing.
  if (!spriteHasAnim(palette, species, 'base', move) || !spriteHasAnim(palette, species, 'base', 'idle')) palette = 'female';
  const playing = rep > 0 && rep === trigger && !prefersReducedMotion();
  const anim = playing ? move : 'idle';
  return (
    <span className="inline-block" style={{ lineHeight: 0, opacity: 0.9 }} aria-hidden="true">
      <SpriteSheet key={anim + ':' + rep} palette={palette} species={species} group="base" anim={anim}
        px={1.5} fps={playing ? 9 : BUDDY_IDLE_FPS} loop={!playing}
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
function MetaBit({ label, onHelp, muted, hideHelp }) {
  if (hideHelp) {
    return (
      <button onClick={onHelp} className="hit text-[12px] tnum py-2" style={{ color: muted ? 'var(--muted)' : 'var(--text2)' }}>{label}</button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[12px] tnum" style={{ color: muted ? 'var(--muted)' : 'var(--text2)' }}>{label}</span>
      <button onClick={onHelp} aria-label={'What does ' + label + ' mean?'}
        className="hit w-5 h-5 flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: 'transparent', color: 'var(--accent-ink)', border: '2px solid var(--accent)' }}>?</button>
    </span>
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
                    {mark ? '★ ' : ''}{toDisplayWeight(s.weightKg, units)}{unitLabel(units)} × {s.reps}{s.rir != null ? ' @' + s.rir : ''}
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
        {parent && (
          <button onClick={() => setCreating(basedOn)} className="w-full text-left pixel-box p-3 mb-2"
            style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--surface2))' }}>
            <div className="text-[13px] font-bold">Make a variation of {parent.name}</div>
            <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--muted)' }}>A different grip, stance or attachment. Keeps what it trains.</div>
          </button>
        )}
        {list.map(e => (
          <button key={e.id} onClick={() => onPick(e.id)} className="w-full text-left pixel-box p-3 mb-2" style={{ background: 'var(--surface2)' }}>
            <div className="text-[13px] font-bold">{e.name}</div>
            {Training.isCardio(e)
              ? <span className="text-[10px]" style={{ color: 'var(--muted2)' }}>Cardio, logged but not counted in your lifting volume</span>
              : <MuscleTags exerciseId={e.id} custom={t.custom} />}
          </button>
        ))}
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

// ---- block wizard -----------------------------------------------------------------------------
// Free users get the whole thing built deterministically from their equipment and days. Premium
// adds the AI pass that swaps in movements suited to what they actually like doing.
function BlockWizard({ db, update, showToast, isPremium, onUpgrade, onBack, onDraft, onShots }) {
  useBackClose(onBack);
  const t = tdb(db);
  const draftDays = ((t.draft && t.draft.days) || []).length;
  const [whyEmpty, setWhyEmpty] = useState(false);
  const [days, setDays] = useState(t.prefs.daysPerWeek || 4);
  const [goal, setGoal] = useState('hypertrophy');
  const [shape, setShape] = useState('build4');
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
  const [shotBusy, setShotBusy] = useState('');
  const [shotNote, setShotNote] = useState(null);
  const [shotErr, setShotErr] = useState(false);
  const [shotCtx, setShotCtx] = useState('');
  const [shotFails, setShotFails] = useState([]);   // the files that did not read, kept so they can be retried

  // Read one or more screenshots of sessions into the draft basket. Each image is read on its own,
  // because a screenshot is one session: batching them into a single call would blur four days into
  // one soup and lose which movement belonged to which day.
  //
  // Three things this has to survive, all of which it did not before. A single hung request used to
  // stall the whole run with no way out, so every read has a deadline and one retry. Five reads in a
  // row is minutes of staring at a button, so they run a few at a time and the label counts what has
  // FINISHED rather than what has started. And a file that fails is named and offered back, instead
  // of disappearing into an anonymous tally.
  async function readShots(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (!isPremium) { onUpgrade && onUpgrade('workout_import'); return; }
    const ctx = shotCtx;
    setShotErr(false); setShotNote(null); setShotFails([]);
    let done = 0;
    const label = () => setShotBusy('Read ' + done + ' of ' + list.length + '...');
    label();

    async function readOne(file) {
      const content = withImportNote((await workoutContentFromFile(file)).blocks, ctx);
      // One retry, because the failure this catches is a dropped request rather than an unreadable
      // picture, and re-uploading five screenshots to fix one of them is a miserable ask.
      let parsed;
      try {
        parsed = await aiParseWorkout(content, { timeoutMs: 90000 });
      } catch (e) {
        if (e && e.aiError) throw e;              // a paywall or a quota is not worth asking twice
        parsed = await aiParseWorkout(content, { timeoutMs: 90000 });
      }
      const res = Training.importTemplate(parsed, { custom: t.custom });
      if (!res.template.length) throw new Error('nothing readable in it');
      return { parsed: parsed, res: res, template: res.template, file: file };
    }

    // Results are collected in upload order and written once at the end, so the days land in the
    // order they were picked however the reads happen to finish, and the draft is saved once.
    const results = new Array(list.length).fill(null);
    const fails = [];
    let cursor = 0;
    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= list.length) return;
        try { results[i] = await readOne(list[i]); }
        catch (e) { fails.push({ file: list[i], why: (e && e.message) || 'could not be read' }); }
        done++; label();
      }
    }
    await Promise.all(new Array(Math.min(3, list.length)).fill(0).map(worker));

    const got = results.filter(Boolean);
    // Counted out here, not inside the updater: trainUpdate hands React a function it runs when it
    // pleases, so anything tallied in there is still zero by the time the message below reads it.
    const added = got.reduce((a, r) => a + r.template.length, 0);
    if (got.length) {
      trainUpdate(update, (tr) => {
        const d = tr.draft || { name: (got[0].parsed && got[0].parsed.name) || 'My block', days: [] };
        got.forEach(r => Training.mergeDraftDays(d.days, r.template, { kind: 'file', name: r.file.name || 'screenshot' }));
        // Everything the read was unsure about rides along with the draft, so the review screen can
        // show it. A movement the library could not place used to be dropped here without a word,
        // which is how three of Day 3's seven went missing in silence; a movement matched to the
        // wrong piece of kit is worse still, because the day looks right and you find out in the gym.
        const gather = (k) => got.reduce((a, r) => a.concat((r.res && r.res[k]) || []), []);
        d.unresolved = (d.unresolved || []).concat(gather('unresolved'));
        d.mismatches = (d.mismatches || []).concat(gather('mismatches'));
        d.loose = (d.loose || []).concat(gather('loose'));
        d.weekLabel = d.weekLabel || got.map(r => r.res && r.res.weekLabel).filter(Boolean)[0] || null;
        d.source = 'import';
        tr.draft = d;
      });
    }
    setShotBusy('');
    setShotFails(fails);
    if (!added) {
      setShotErr(true);
      setShotNote('I could not read a session out of ' + (list.length === 1 ? 'that' : 'those') + '. A screenshot showing the exercise names, sets and reps works best.');
      return;
    }
    setShotErr(false);
    setShotNote(added + (added === 1 ? ' day' : ' days') + ' added to your draft block'
      + (fails.length ? ', and ' + fails.length + ' I could not read: ' + fails.map(f => f.file.name || 'a screenshot').join(', ') + '.' : '.')
      + (fails.length ? ' Try those again, or open the draft to build what did read.' : ' Add more, or open the draft to build it.'));
    if (!fails.length) onShots && onShots();
  }
  const EQUIP = [['barbell', 'Barbell'], ['dumbbell', 'Dumbbells'], ['machine', 'Machines'], ['cable', 'Cables'], ['bodyweight', 'Bodyweight'], ['smith', 'Smith'], ['ez', 'EZ bar'], ['kettlebell', 'Kettlebell'], ['trapbar', 'Trap bar']];

  // Say it in a sentence and the coach fills the form in. Deliberately fills the FORM rather than
  // producing a programme directly, so you still see and can change every answer before anything is
  // built. It is a shortcut through the questions, not a black box that hands you a plan.
  async function askCoach() {
    const v = wish.trim();
    if (!v) return;
    if (!isPremium) { onUpgrade && onUpgrade('block_generate'); return; }
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

  function build() {
    setBusy(true);
    const targets = Training.defaultTargets({ experience: experience, volumeTargets: t.volumeTargets });
    const block = Training.generateBlock({
      daysPerWeek: days, weeks: 4, shape: shape, goal: goal, targets: targets,
      gym: gym, equipment: equipment.length ? equipment : null,
      dislikes: t.prefs.dislikes, custom: t.custom,
      sessionMinutes: minutes, emphasis: emphasis, source: 'generated',
    });
    block.gymId = gym ? gym.id : null;
    // Remember the answers, so the next block does not ask again.
    trainUpdate(update, (tr) => {
      tr.prefs = Object.assign({}, tr.prefs, { daysPerWeek: days, sessionMinutes: minutes, experience: experience, equipment: equipment });
    });
    setBusy(false);
    onDraft(block);
  }

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">Build a block</h1>
      <Collapsible label="Four weeks that build on each other" sub="What that means" variant="inline" className="mb-6">
        <div className="text-[12px] leading-snug mt-2" style={{ color: 'var(--muted)' }}>
          Week one introduces the work at a volume you can definitely recover from. Weeks two and three add sets where you have room and ask for a little more effort each time. Week four backs off, so the next block starts on a fresh body rather than a tired one.
        </div>
      </Collapsible>

      {/* Three routes in, in the order people actually have something to hand. A screenshot of what
          you already do beats describing it, and describing it beats filling in a form. */}
      <Card className="p-4 mb-4">
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Show the coach</div>
        <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
          Sessions you already do, from any app or a coach's message. Add as many as you like.
        </div>
        {/* The note sits ABOVE the picker, because on a phone the file chooser takes over the screen
            the moment you tap it and whatever you meant to type never gets typed. */}
        <Field label="Anything I should know" hint={IMPORT_NOTE_HINT}>
          <textarea value={shotCtx} onChange={e => setShotCtx(e.target.value)} rows={2}
            placeholder="These are Mon to Fri, in order. Ignore the cardio at the bottom."
            className="w-full pixel-box px-3 py-3 text-[13px]" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
        </Field>
        <label className={'pixel-box flex items-center justify-center h-12 text-[12.5px] ' + (shotBusy ? 'opacity-60' : 'cursor-pointer')} style={{ background: 'var(--surface2)' }}>
          {shotBusy || (isPremium ? 'Upload screenshots' : 'Upload screenshots · Premium')}
          <input type="file" className="hidden" accept="image/*" multiple disabled={!!shotBusy}
            onChange={e => { readShots(e.target.files); e.target.value = ''; }} />
        </label>
        {shotBusy && (
          <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--muted2)' }}>
            Each screenshot is read on its own so the days stay separate, so a handful takes a moment.
          </div>
        )}
        {shotNote && <div className="text-[12px] mt-2 leading-snug" style={{ color: shotErr ? 'var(--danger)' : 'var(--accent-ink)' }}>{shotNote}</div>}
        {/* Whatever failed is still in memory, so retrying is a tap rather than another trip through
            the photo picker hunting for which four of the five already worked. */}
        {!shotBusy && shotFails.length > 0 && (
          <button onClick={() => readShots(shotFails.map(f => f.file))}
            className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>
            Try {shotFails.length === 1 ? 'that one' : 'those ' + shotFails.length} again
          </button>
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

      <Field label="Days a week">
        <Seg value={days} onChange={setDays} options={[2, 3, 4, 5, 6].map(n => ({ v: n, l: String(n) }))} />
      </Field>
      <Field label="How long a session" hint="Decides how many movements fit.">
        <Seg value={minutes} onChange={setMinutes} options={[{ v: 40, l: '40 min' }, { v: 60, l: '60 min' }, { v: 80, l: '80 min' }, { v: 100, l: '100 min' }]} />
      </Field>
      <Field label="Where you are" hint="Sets your starting volume. Movable later.">
        <Seg value={experience} onChange={setExperience} options={[{ v: 'beginner', l: 'Newer' }, { v: 'intermediate', l: 'A while' }, { v: 'advanced', l: 'Years' }]} />
      </Field>
      <Field label="Goal">
        <Seg value={goal} onChange={setGoal} options={[{ v: 'hypertrophy', l: 'Muscle' }, { v: 'strength', l: 'Strength' }, { v: 'general', l: 'General' }]} />
      </Field>
      <Field label="Block shape" hint={Training.SHAPES[shape].label}>
        <Seg value={shape} onChange={setShape} options={[{ v: 'build4', l: 'Build 4' }, { v: 'build3-deload1', l: '3 + light week' }]} />
      </Field>
      {/* A gym, not a checkbox grid. It decides both what is available and what to reach for first,
          which is why it replaced the nine tick boxes that used to live here. */}
      <Field label="Where you will train it" hint="Changes which movements the block reaches for.">
        <button onClick={() => setGymPick(true)} className="w-full text-left pixel-box p-4 flex items-center justify-between gap-2" style={{ background: 'var(--surface2)' }}>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold truncate">{gym ? gym.name : 'Choose a gym'}</span>
            <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{gym ? gymSummary(gym) : 'Nothing saved yet'}</span>
          </span>
          <Icon.chevron width="15" height="15" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
        </button>
      </Field>

      {/* Seventeen chips and a forty-five word justification, for a field whose own label says
          "Optional". They were nearly half the controls on this screen and the first thing you met
          before the button that actually builds the block. Folded behind the same inline disclosure
          the screen already opens with, so the default is calm and nothing is lost: the summary
          names what you picked, so a closed row still tells you where you stand. */}
      <Collapsible
        label={emphasis.length ? 'Bringing up ' + emphasis.map(m => Training.MUSCLE_LABEL[m].toLowerCase()).join(', ') : 'Anything to bring up'}
        sub={emphasis.length ? 'Change' : 'Optional'} variant="inline" className="mb-5">
        <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
          Whatever you pick starts nearer the top of its useful range, and the rest eases back to pay for it.
        </div>
        <div className="flex gap-2 flex-wrap">
          {Training.MUSCLES.map(m => (
            <button key={m} onClick={() => setEmphasis(emphasis.indexOf(m) !== -1 ? emphasis.filter(x => x !== m) : emphasis.concat([m]))}
              className="pixel-box px-2 py-2 text-[11px]"
              style={{ background: emphasis.indexOf(m) !== -1 ? 'var(--good)' : 'var(--surface2)', color: emphasis.indexOf(m) !== -1 ? '#05140a' : 'var(--text2)' }}>
              {Training.MUSCLE_LABEL[m]}
            </button>
          ))}
        </div>
      </Collapsible>

      <button onClick={build} disabled={busy} className="pixel-btn w-full h-14 font-bold mt-2" style={{ background: '#fff', color: '#111' }}>
        {busy ? 'Building...' : 'Build it'}
      </button>

      {draftDays > 0 && (
        <button onClick={onShots} className="pixel-box w-full h-12 text-[12.5px] mt-2" style={{ background: 'var(--surface2)' }}>
          Open your draft ({draftDays} {draftDays === 1 ? 'day' : 'days'})
        </button>
      )}

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
        target: { sets: 3, repLow: compound ? 6 : 10, repHigh: compound ? 10 : 15, rir: Math.max(1, 4 - s.week), restSec: compound ? 150 : 90 },
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

      {/* Live coverage for the week being edited. This is the whole point of building it here. */}
      <Card className="p-4 mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <div className="pf text-[9px] uppercase" style={{ color: 'var(--muted)' }}>Week {week} coverage</div>
          <div className="text-[11px]" style={{ color: cov.gaps.length ? 'var(--warn)' : 'var(--good)' }}>
            {cov.totalSets} sets · {cov.gaps.length ? cov.gaps.length + ' short' : 'all covered'}
          </div>
        </div>
        <CoverageBars coverage={cov} limit={5} compact />
        {cov.overs.length > 0 && (
          <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--danger)' }}>
            {cov.overs[0].label} is past what you can recover from at {cov.overs[0].sets} sets. Take some off.
          </div>
        )}
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
                ? <span className="shrink-0 w-6 h-6 flex items-center justify-center text-[13px] font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}><Tick size={13} /></span>
                : <span className="shrink-0" style={{ color: 'var(--muted2)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><Icon.chevron width="15" height="15" /></span>}
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
                  <button onClick={() => onStart(s, block)} className="pixel-btn w-full h-12 font-bold mt-2" style={{ background: '#fff', color: '#111' }}>
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
            <button onClick={() => save(false)} className="pixel-btn flex-1 h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
              Start it now
            </button>
          </div>
        ) : (
          <button onClick={() => save(false)} className="pixel-btn w-full py-4 font-bold" style={{ background: '#fff', color: '#111' }}>
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

// ---- what is in today's session, before you commit to it --------------------------------------
// Tapping a day used to drop you straight into the player, which starts a session: it stamps a
// start time, and from the second visit onwards the app treats it as one you are part-way through.
// Most taps are not that. They are "what am I doing tonight", asked on the bus, and the answer
// should not begin a workout. So the tap opens the plan and Start begins it.
function SessionPreview({ db, session, block, onBack, onStart }) {
  useBackClose(onBack);
  const t = tdb(db);
  const units = t.prefs.units;
  const items = (session.exercises || []).slice().sort((a, b) => a.order - b.order);
  const codes = Training.sessionCodes(items);
  const sets = items.reduce((a, e) => a + (e.target.sets || 0), 0);
  const mins = Math.round(items.reduce((a, e) => a + (e.target.sets || 0) * (((e.target.restSec || 120) + 40) / 60), 0));
  const log = t.logs.filter(l => l.sessionId === session.id)[0];

  return (
    <div className="fade-in pb-28">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Tonight</div>
      <h1 className="text-[19px] font-bold leading-tight mb-2">{session.name}</h1>
      <div className="text-[12px] mb-4 tnum" style={{ color: 'var(--muted)' }}>
        {items.length} movements &middot; {sets} sets &middot; about {mins} min
        {session.deload ? ' · deload week' : ''}
      </div>

      {log && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--good) 12%, var(--surface2))' }}>
          <div className="text-[12px] leading-snug">
            You logged this one {relativeDay(log.dateISO, Store.todayISO()).toLowerCase()}, {(log.sets || []).filter(s => s.done).length} sets. Opening it again picks up where you left off.
          </div>
        </Card>
      )}

      {items.map((it, i) => {
        const ex = Training.byId(it.exerciseId, t.custom);
        const last = Training.bestBefore(t.logs, it.exerciseId, Store.todayISO());
        return (
          <Card key={it.id || i} className="p-4 mb-3">
            <div className="flex items-baseline gap-3">
              <span className="pf text-[10px] shrink-0 w-6" style={{ color: 'var(--accent-ink)' }}>{codes[i]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold leading-tight">{ex ? ex.name : it.exerciseId}</span>
                <span className="block text-[11px] tnum mt-1" style={{ color: 'var(--muted)' }}>
                  {it.target.sets} x {it.target.repLow}-{it.target.repHigh} &middot; {it.target.rir} RIR
                  {it.target.tempo ? ' · ' + it.target.tempo + ' tempo' : ''}
                </span>
                {/* What you did last time is the number you actually want before you set off. */}
                {last && last.weightKg > 0 && (
                  <span className="block text-[11px] tnum mt-0.5" style={{ color: 'var(--muted2)' }}>
                    Last time {toDisplayWeight(last.weightKg, units)}{unitLabel(units)} x {last.repsAtBest}
                  </span>
                )}
              </span>
            </div>
          </Card>
        );
      })}

      <StickyAction>
        <button onClick={onStart} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
          {log ? 'Carry on with it' : 'Start ' + session.name.split(' - ')[0]}
        </button>
      </StickyAction>
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
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">Your blocks</h1>
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
        Everything you have built or imported. Tap one to change it, or delete one you made by mistake. The sessions you logged against a block are kept either way.
      </div>

      {!blocks.length && (
        <Card className="p-4">
          <div className="text-[13px] mb-1">No blocks yet.</div>
          <div className="text-[12px] leading-snug mb-4" style={{ color: 'var(--muted)' }}>
            Build one from your kit and your days, or import a plan you already follow.
          </div>
          <button onClick={onNew} className="pixel-btn w-full h-12 font-bold" style={{ background: '#fff', color: '#111' }}>Build a block</button>
        </Card>
      )}

      {blocks.map(block => {
        const comp = Training.completion(block, t.logs.filter(l => l.blockId === block.id));
        const running = block.id === liveId && !Training.blockProgress(block, today).done;
        return (
          <Card key={block.id} className="p-4 mb-3">
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => onOpen(block.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-[13.5px] font-semibold" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{block.name}</span>
                <span className="block text-[11px] mt-1" style={{ color: running ? 'var(--accent-ink)' : 'var(--muted)' }}>
                  {statusOf(block)}
                </span>
                <span className="block text-[11px] tnum mt-0.5" style={{ color: 'var(--muted2)' }}>
                  {comp.done} of {comp.total} sessions logged{block.shared ? ' · shared' : ''}
                </span>
              </button>
              <button onClick={() => setConfirm(block)} aria-label={'Delete ' + block.name}
                className="hit shrink-0 px-3 py-2 text-[12px]" style={{ color: 'var(--danger)' }}>Delete</button>
            </div>
            {/* A block built before a rule existed does not get it retroactively, and the ones that
                show are the ones you read every day. Offered, never applied quietly: two of these
                three change what the block asks of you. */}
            {fixes[block.id] && fixes[block.id].length > 0 && (
              <button onClick={() => setFixing(block)} className="w-full text-left mt-3 pt-3 text-[12px]" style={{ borderTop: '2px solid var(--border)', color: 'var(--warn)' }}>
                {fixes[block.id].length} thing{fixes[block.id].length === 1 ? '' : 's'} here predate how the app builds blocks now &rsaquo;
              </button>
            )}
            <div className="flex items-center gap-4 mt-3 pt-3 text-[12px]" style={{ borderTop: '2px solid var(--border)' }}>
              {/* A block that was saved but never begun. Starting it is the whole point of having
                  saved it, so it is one tap from here rather than a trip through the editor. */}
              {!block.startISO && (
                <button onClick={() => onStart(block)} style={{ color: 'var(--accent-ink)' }}>Start this block</button>
              )}
              <button onClick={() => onCoverage(block.id)} style={{ color: 'var(--accent-ink)' }}>What it covers</button>
              {comp.done > 0 && (
                <button onClick={() => onReview(block.id)} style={{ color: 'var(--accent-ink)' }}>How it went</button>
              )}
            </div>
          </Card>
        );
      })}

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
          <button onClick={askAI} disabled={busy} className="pixel-btn w-full py-3 font-bold mt-1" style={{ background: '#fff', color: '#111' }}>
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
          <button onClick={() => onRerun(block.id)} className="pixel-btn flex-1 h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
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
        <button onClick={build} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
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
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
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

          {/* Name on its own line, wrapping rather than truncating: "Seated cab..." tells you nothing,
              and the pixel font eats horizontal space fast. The numbers then get a row to themselves
              instead of fighting the name for the same one. */}
          {shown.map(l => (
            <button key={l.exerciseId} onClick={() => onOpenExercise(l.exerciseId)}
              className="w-full text-left pixel-box p-4 mb-2" style={{ background: 'var(--card)' }}>
              <div className="text-[13.5px] font-semibold leading-tight mb-2">{l.name}</div>
              <div className="flex items-end justify-between gap-3">
                <span className="text-[11px] min-w-0" style={{ color: 'var(--muted2)' }}>
                  {relativeDay(l.lastISO, Store.todayISO())} · {l.sessions} {l.sessions === 1 ? 'session' : 'sessions'}
                </span>
                {/* The best, which is the whole reason for coming to this screen. */}
                <span className="text-right shrink-0">
                  <span className="block pf text-[11px] tnum" style={{ color: 'var(--accent-ink)' }}>
                    {toDisplayWeight(l.topKg, units)}{unitLabel(units)} × {l.topReps}
                  </span>
                  {l.e1rm > 0 && (
                    <span className="block text-[10px] tnum mt-0.5" style={{ color: 'var(--muted2)' }}>
                      {toDisplayWeight(l.e1rm, units)}{unitLabel(units)} est. 1RM
                    </span>
                  )}
                </span>
              </div>
            </button>
          ))}
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
                    {sessionPRs.map(p => {
                      const e = Training.byId(p.exerciseId, t.custom);
                      return '★ ' + (e ? e.name : p.exerciseId) + ', ' + p.label.toLowerCase();
                    }).join(' · ')}
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
            <Icon.chevron width="15" height="15" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
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
async function aiParseWorkout(content, opts) {
  const j = await aiRequest({
    model: AI_MODEL, max_tokens: 3000,
    messages: [{ role: 'user', content: [{ type: 'text', text: WORKOUT_PROMPT, cache_control: { type: 'ephemeral' } }].concat(content) }],
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

// ---- the import screen -------------------------------------------------------------------------
function WorkoutImport({ db, update, showToast, isPremium, onUpgrade, onBack, onDraft, onCollected, initialUrl }) {
  useBackClose(onBack);
  const t = tdb(db);
  const [tab, setTab] = useState('link');
  const [url, setUrl] = useState(initialUrl || '');
  const [text, setText] = useState('');
  const [ctx, setCtx] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);   // { parsed, template, unresolved, source }
  const draftDays = ((t.draft && t.draft.days) || []).length;
  const [whyEmpty, setWhyEmpty] = useState(false);

  function gate() {
    if (isPremium) return true;
    onUpgrade && onUpgrade('workout_import');
    return false;
  }

  async function run(getContent, sourceRef, busyLabel) {
    if (!gate()) return;
    setErr(null); setBusy(busyLabel || 'Reading it');
    try {
      const content = withImportNote(await getContent(), ctx);
      setBusy('Working out what it says');
      const parsed = await aiParseWorkout(content, { timeoutMs: 120000 });
      const res = Training.importTemplate(parsed, { custom: t.custom });
      if (!res.template.length) {
        setErr('I could not find any exercises in that. If it is a video where the plan is only spoken over music, a screenshot of the plan usually works better.');
        setBusy(''); return;
      }
      setResult({ parsed, template: res.template, unresolved: res.unresolved, sourceRef });
    } catch (e) {
      setErr((e && e.message) || 'That did not work. Try another way in.');
    }
    setBusy('');
  }

  function importLink() {
    const u = url.trim();
    if (!u) return;
    run(async () => {
      const src = await extractRecipeSource(u);
      if (!src || !src.ok || !src.sourceText) {
        throw new Error('I could not read anything public behind that link. Paste the caption in, or screenshot the plan and upload it.');
      }
      return [{ type: 'text', text: 'This was read from a shared ' + (src.platform || 'social') + ' post. It may include the caption and what the creator says out loud.\n\n' + String(src.sourceText).slice(0, 24000) }];
    }, { kind: 'link', url: u }, 'Reading the post');
  }

  function importFiles(files) {
    const f = (files || [])[0];
    if (!f) return;
    run(async () => (await workoutContentFromFile(f)).blocks, { kind: 'file', name: f.name }, 'Reading ' + f.name);
  }

  function importText() {
    const v = text.trim();
    if (!v) return;
    run(async () => [{ type: 'text', text: 'A training plan, pasted in by the person who wants to follow it.\n\n' + v.slice(0, 24000) }], { kind: 'paste' }, 'Reading it');
  }

  function accept() {
    const block = Training.blockFromTemplate(result.template, {
      // As written: see the note on the draft screen's build. An import is a plan someone chose.
      weeks: 4, shape: 'as-written', targets: trainTargets(db), custom: t.custom,
      name: (result.parsed && result.parsed.name) || 'Imported block',
      source: 'import', sourceRef: Object.assign({ importedISO: Store.todayISO() }, result.sourceRef || {}),
      startISO: Store.todayISO(),
    });
    onDraft(block);
  }
  // Collect these days instead of building now. Re-importing a corrected "Upper A" from the same
  // source replaces it rather than leaving you with two; a same-named day from a different source is
  // a different day and is kept. See Training.mergeDraftDays.
  function collect() {
    trainUpdate(update, (tr) => {
      const d = tr.draft || { name: (result.parsed && result.parsed.name) || 'My block', days: [] };
      Training.mergeDraftDays(d.days, result.template, result.sourceRef || null);
      tr.draft = d;
    });
    showToast && showToast('Added to your draft block.');
    onCollected && onCollected();
  }

  if (result) {
    return (
      <div className="fade-in pb-24">
        <button onClick={() => setResult(null)} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Try again</button>
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>What I read</div>
        <h1 className="text-[19px] font-bold leading-tight mb-2">{(result.parsed && result.parsed.name) || 'Imported plan'}</h1>
        <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
          Here is what I read. Nothing is saved yet, and you can change every line of it on the next screen.
        </div>

        {result.parsed && result.parsed.confidence === 'low' && (
          <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' }}>
            <div className="text-[12px] leading-snug">Most of that source was hard to read, so check it carefully before you start it.</div>
          </Card>
        )}

        {result.unresolved.length > 0 && (
          <Card className="p-4 mb-4">
            <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--warn)' }}>Left out</div>
            <div className="text-[12px] mb-2 leading-snug" style={{ color: 'var(--muted)' }}>
              I did not recognise these, so I have left them out rather than guess at the wrong movement. Add them yourself on the next screen.
            </div>
            {result.unresolved.map((u, i) => (
              <div key={i} className="text-[12px]" style={{ color: 'var(--text2)' }}>{u.dayName}: {u.name}</div>
            ))}
          </Card>
        )}

        {result.template.map((day, i) => (
          <Card key={i} className="p-4 mb-4">
            <div className="text-[13px] font-bold mb-2">{day.name}</div>
            {day.exercises.map(it => (
              <div key={it.id} className="flex items-baseline justify-between gap-2 py-1 border-t" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[12px] truncate"><ExerciseName id={it.exerciseId} custom={t.custom} /></span>
                <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>{it.target.sets} x {it.target.repLow}-{it.target.repHigh}</span>
              </div>
            ))}
          </Card>
        ))}

        <div className="text-[11px] mb-4 leading-snug" style={{ color: 'var(--muted2)' }}>
          Whatever you build becomes week 1, and the app writes weeks 2 to 4 on top of it, adding work where you have room and backing off at the end.
          {result.template.length < 3
            ? ' If this is one post out of a series, add it to your draft and import the rest before you build.'
            : ''}
          {draftDays ? ' Your draft already has ' + draftDays + (draftDays === 1 ? ' day' : ' days') + ' in it.' : ''}
        </div>

        <StickyAction>
          {/* Two routes out, and which one is primary depends on what we just read. A single day is
              almost always one post out of a series, so collecting is the sensible default there;
              a full week is a whole programme and should just become a block. */}
          {result.template.length >= 3 ? (
            <div className="flex gap-2">
              <button onClick={collect} className="pixel-box flex-1 h-14 text-[12.5px]" style={{ background: 'var(--surface2)' }}>Add to draft</button>
              <button onClick={accept} className="pixel-btn flex-1 h-14 font-bold" style={{ background: '#fff', color: '#111' }}>Build the block</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={accept} className="pixel-box flex-1 h-14 text-[12.5px]" style={{ background: 'var(--surface2)' }}>Build now</button>
              <button onClick={collect} className="pixel-btn flex-1 h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
                Add to draft{draftDays ? ' (' + (draftDays + result.template.length) + ')' : ''}
              </button>
            </div>
          )}
        </StickyAction>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">Import a plan</h1>
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
        A reel, a PDF, a spreadsheet, a screenshot or just the text. It lands as a block you can edit.
      </div>

      <div className="mb-4"><Pill value={tab} onChange={setTab} options={[{ v: 'link', l: 'Link' }, { v: 'file', l: 'File' }, { v: 'paste', l: 'Paste' }]} /></div>

      {/* One note, above the three routes in, because it is worth the same to all of them: a reel
          rarely says which day is which either. It goes to the model with the source. */}
      <Card className="p-4 mb-4">
        <Field label="Anything I should know" hint={IMPORT_NOTE_HINT}>
          <textarea value={ctx} onChange={e => setCtx(e.target.value)} rows={2}
            placeholder="This is the Wednesday session. Weights are in pounds."
            className="w-full pixel-box px-3 py-3 text-[13px]" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
        </Field>
      </Card>

      {tab === 'link' && (
        <Card className="p-4 mb-4">
          <Field label="Instagram, TikTok or YouTube link" hint="Works best when the plan is written in the caption or said out loud. Pure music-over-clips will not read.">
            <TextInput value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste the link" />
          </Field>
          <button onClick={importLink} disabled={!!busy || !url.trim()} className="pixel-btn w-full py-3 font-bold" style={{ background: '#fff', color: '#111' }}>
            {busy || (isPremium ? 'Read it' : 'Read it · Premium')}
          </button>
        </Card>
      )}

      {tab === 'file' && (
        <Card className="p-4 mb-4">
          <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
            PDF, Excel, CSV, a text file or a photo of the plan. Spreadsheets keep their rows and columns, so a week-per-column layout reads properly.
          </div>
          <label className="pixel-box flex items-center justify-center py-6 text-[13px] cursor-pointer" style={{ background: 'var(--surface2)' }}>
            {busy || 'Choose a file'}
            <input type="file" className="hidden" accept=".pdf,.xlsx,.csv,.tsv,.txt,.md,image/*"
              onChange={e => { importFiles(e.target.files); e.target.value = ''; }} />
          </label>
        </Card>
      )}

      {tab === 'paste' && (
        <Card className="p-4 mb-4">
          <Field label="Paste the plan" hint="A message from your coach, a caption you copied, anything with the sessions in it.">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
              placeholder={'Monday - Push\nBench press 4x6-8\nIncline DB press 3x10\n...'}
              className="w-full pixel-box px-3 py-3 text-[13px]" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
          </Field>
          <button onClick={importText} disabled={!!busy || !text.trim()} className="pixel-btn w-full py-3 font-bold" style={{ background: '#fff', color: '#111' }}>
            {busy || (isPremium ? 'Read it' : 'Read it · Premium')}
          </button>
        </Card>
      )}

      {err && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--danger) 12%, var(--surface2))' }}>
          <div className="text-[12px] leading-snug">{err}</div>
        </Card>
      )}

      <div className="text-[11px] leading-snug" style={{ color: 'var(--muted2)' }}>
        Nothing is saved until you say so, and anything I cannot recognise gets shown to you rather than guessed at.
      </div>
    </div>
  );
}

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
        <button onClick={() => { bumpPublicBlockRuns(pub.id); onAdopt(result.block); }} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
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
          <button onClick={onImport} className="pixel-btn w-full h-12 font-bold" style={{ background: '#fff', color: '#111' }}>Import a session</button>
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
  function edit(fn) { trainUpdate(update, (tr) => { fn(tr.draft); tr.draft.days.forEach((d, i) => { d.dayOfWeek = i; }); }); }

  return (
    /* pb-28 clears the StickyAction bar, which is fixed 104px off the bottom and stands about 170px
       tall with its gradient. Without it the LAST thing on this screen sits underneath the Build
       button, and the last thing on this screen is how you throw the draft away. */
    <div className="fade-in pb-28">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-1">Draft block</h1>
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
        {draft.days.length} {draft.days.length === 1 ? 'day' : 'days'} read from your plan. Tap any movement to change it.
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
                      {e.check === 'kit' ? 'Counted as ' + lib.name : 'Read as ' + lib.name + '?'}
                    </span>
                  )}
                </button>
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
        <button onClick={() => onBuild(draft)} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>
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
                target: { sets: 3, repLow: compound ? 6 : 10, repHigh: compound ? 10 : 15, rir: 2, restSec: compound ? 150 : 90 },
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
      <div className="w-full max-w-sm pixel-box fade-in p-5" style={{ background: 'var(--card)' }}>
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
        </div>

        {/* The one place the streak is worth mentioning: a session is an active day now, and the
            person who trained instead of logging their dinner should be told their run is safe. */}
        <div className="text-[11px] text-center mb-4 leading-snug" style={{ color: 'var(--muted2)' }}>
          Today counts toward your streak.
        </div>
        <button onClick={onDone} className="pixel-btn w-full h-14 font-bold" style={{ background: '#fff', color: '#111' }}>Done</button>
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
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>

      <Card className="p-5 mb-4 text-center">
        {/* The character sheet is the buddy's own screen, so it shows the buddy: its stage, its
            colourway and its terrarium, not a stage-3 stand-in with the cosmetics stripped off. */}
        <div className="flex justify-center mb-3">
          <BuddyScene buddy={buddy} stageIndex={Math.min(buddy.stage || 0, BUDDY_STAGES.length - 1)}
            px={4} w={150} h={112} floor={26} spriteBottom={6} shadowW={62} eq={equippedCosmetics(buddy)} />
        </div>
        <div className="pf text-[13px] mb-1">{name.toUpperCase()}</div>
        <div className="pf text-[26px] mb-1" style={{ color: 'var(--accent-ink)' }}>{stats.overall}</div>
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>overall, from what you have lifted</div>
      </Card>

      {untrained ? (
        <Card className="p-4">
          <div className="text-[13px] mb-1">Nothing to measure yet.</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
            Log a session and these fill in. Every one of them comes from real sets, so none of them move until you do.
          </div>
        </Card>
      ) : (
        <Card className="p-4 mb-4">
          {rows.map(([k, label, why]) => (
            <div key={k} className="mb-4 last:mb-0">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="pf text-[9px] uppercase">{label}</span>
                <span className="pf text-[13px] tnum" style={{ color: 'var(--accent-ink)' }}>{stats[k]}</span>
              </div>
              {/* Segmented, so it reads as a Game Boy power bar rather than a progress spinner. */}
              <div className="flex gap-0.5 mb-2">
                {Array.from({ length: 20 }, (_, i) => (
                  <span key={i} className="flex-1 h-2.5" style={{ background: i * 5 < stats[k] ? 'var(--accent)' : 'var(--track)' }} />
                ))}
              </div>
              <div className="text-[11px] leading-snug" style={{ color: 'var(--muted2)' }}>{why}</div>
            </div>
          ))}
        </Card>
      )}

      {!untrained && (
        <Card className="p-4">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Behind the numbers</div>
          <div className="flex items-baseline justify-between py-1 text-[12px]">
            <span style={{ color: 'var(--text2)' }}>Best single lift</span>
            <span className="tnum" style={{ color: 'var(--muted)' }}>{toDisplayWeight(stats.bestLiftKg, units)}{unitLabel(units)} est. 1RM</span>
          </div>
          <div className="flex items-baseline justify-between py-1 text-[12px]">
            <span style={{ color: 'var(--text2)' }}>Hard sets a week</span>
            <span className="tnum" style={{ color: 'var(--muted)' }}>{stats.setsPerWeek}</span>
          </div>
          {Object.keys(stats.patterns).length > 0 && Object.keys(stats.patterns).map(p => (
            <div key={p} className="flex items-baseline justify-between py-1 text-[12px]">
              <span style={{ color: 'var(--text2)' }}>
                {{ squat: 'Best squat pattern', hinge: 'Best hinge', horizPress: 'Best press', vertPull: 'Best pull-up or pulldown' }[p] || p}
              </span>
              <span className="tnum" style={{ color: 'var(--muted)' }}>{toDisplayWeight(stats.patterns[p], units)}{unitLabel(units)}</span>
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
        {(actions || []).filter(Boolean).map((a, i) => (
          <button key={i} disabled={a.disabled}
            onClick={() => { onClose(); if (a.onClick) a.onClick(); }}
            className="w-full text-left px-4 py-3"
            style={{
              borderTop: '2px solid var(--border)',
              color: a.disabled ? 'var(--muted2)' : (a.danger ? 'var(--danger)' : 'var(--text)'),
              opacity: a.disabled ? 0.5 : 1,
            }}>
            <span className="block text-[12px] font-semibold leading-tight">{a.label}</span>
            {a.sub && <span className="block text-[10.5px] mt-1 leading-snug" style={{ color: 'var(--muted)' }}>{a.sub}</span>}
          </button>
        ))}
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
