/* ---- train tab ----------------------------------------------------------------------
 * the Train tab itself: the router, the home screen and the week in front of you
 *
 * Part of the Train module, which was one 6,200-line file. The sources have no imports:
 * build.mjs concatenates them in the order given by app/src/manifest.json and hands the lot
 * to Babel, so everything here shares one scope with the rest of the app. Function
 * declarations hoist across the whole bundle, which is why these files can call each other
 * freely; module-level `const` does not, so anything declared with one has to appear before
 * the code that reads it AT MODULE SCOPE. Nothing here does, but that is the rule.
 * ------------------------------------------------------------------------------------- */
// ---- the tab ----------------------------------------------------------------------------------
function TrainTab({ db, update, showToast, isPremium, onUpgrade, onFocusMode, importUrl, onConsumeImport }) {
  // Which screen you are on is component state, and this component is unmounted every time you look
  // at another tab - `{view === 'train' && <TrainTab/>}` in app.jsx - and again on every reload. A
  // live session is the one screen in the app that owns the phone for an hour, and it was the one
  // screen that could not survive a glance at your macros. It opens on whatever session is still
  // open, if one is; leaving the player clears that, so this only ever reopens a session you did not
  // choose to leave.
  const [screen, setScreen] = useState(() => openScreen(db) || { name: 'home' });
  const [pendingStart, setPendingStart] = useState(null);  // waiting on "which gym are you at?"
  const t = tdb(db);
  const block = activeBlock(db);
  const go = (name, props) => setScreen(Object.assign({ name: name }, props || {}));

  /* Written while the player is open, and NOT cleared merely because you left it.
   *
   * Leaving used to delete this, which is why a live session felt like a room with the door locked:
   * the one control that reached Train home also threw away the only record that you were mid
   * session, so stepping out to check a macro and abandoning the workout were the same act. Now the
   * record outlives the screen. `stepOut` marks it, `closeSession` clears it, and nothing else
   * touches it. Kept out of render: it is a store write. */
  useEffect(() => {
    if (screen.name === 'player') {
      const want = { sessionId: screen.sessionId || null, blockId: screen.blockId || null,
        logId: screen.logId || null, freeform: !!screen.freeform, atISO: Store.todayISO() };
      const have = tdb(db).open;
      if (have && !have.steppedOut && have.sessionId === want.sessionId && have.blockId === want.blockId
        && have.logId === want.logId && have.freeform === want.freeform && have.atISO === want.atISO) return;
      // Re-entering clears the mark as well as writing the pointer: you are back in it.
      trainUpdate(update, (tr) => { tr.open = want; });
      return;
    }
    /* Not in the player. A VALID record is left exactly where it is - carrying it out here is the
       whole point of the change. A DEAD one is swept: yesterday's, or a pointer at a block or
       session that has been deleted underneath it. That sweep used to happen by accident, because
       leaving deleted the record either way; now it has to be asked for, or a pointer at something
       that no longer exists would sit in the store forever offering to resume it. */
    if (tdb(db).open && !openRecord(db)) trainUpdate(update, (tr) => { delete tr.open; });
  }, [screen.name, screen.sessionId, screen.blockId, screen.logId, screen.freeform]);

  /* Out of the player, session intact. The record stays so the tab can offer it back, and is marked
     so the router stops pulling you into it - see `openScreen` in train-core.jsx. */
  function stepOut(to) {
    trainUpdate(update, (tr) => { if (tr.open) tr.open = Object.assign({}, tr.open, { steppedOut: true }); });
    go(to || 'home');
  }
  // Done with it - finished, signed off, or it turned out to have nothing in it. This is the only
  // thing that throws the record away.
  function closeSession(to) {
    trainUpdate(update, (tr) => { delete tr.open; });
    go(to || 'home');
  }

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
  // A session that is not in the plan: a class, a holiday gym, ten minutes of arms on the way past.
  // It goes through the same gym question as a planned one, because standing somewhere with no
  // barbell matters just as much when nobody wrote the session down.
  function startFreeform() {
    if (gymsOf(db).length > 1) { setPendingStart({ sessionId: null, blockId: null, freeform: true }); return; }
    go('player', { freeform: true });
  }
  // Looking is not starting. A tap on a day opens the plan; the button on that screen begins it.
  function previewSession(session, blk) {
    go('preview', { sessionId: session ? session.id : null, blockId: blk ? blk.id : null });
  }

  // Every Train screen sits in the app's standard page shell, the same one Today, Food and Progress
  // use: centred, 20px gutters, room at the bottom for the tab bar. Without it these screens ran
  // edge to edge while every other tab was inset, which is the kind of inconsistency you feel before
  // you can name it. The session player gets a tighter bottom pad because it hides the tab bar.
  //
  // The gym question rides along with EVERY screen, not just home. It used to be rendered beside the
  // home screen alone, and `startSession` is called from the preview and from the builder as well:
  // on an account with two gyms saved, tapping "Start" or "Carry on with it" set the pending start
  // and then rendered nothing at all, because the only thing that draws the picker had already been
  // returned past. The button that begins a session did nothing, on the two screens most people
  // begin one from.
  const page = (node, focused) => (
    <div>
      <div className={'max-w-md lg:max-w-2xl mx-auto px-5 pt-6 ' + (focused ? 'pb-6' : 'pb-36 lg:pb-12')}>{node}</div>
      {pendingStart && (
        <GymPicker db={db} update={update} onClose={() => setPendingStart(null)}
          onPicked={() => { const p = pendingStart; setPendingStart(null); go('player', p); }} />
      )}
    </div>
  );

  if (screen.name === 'player') {
    return page(<SessionPlayer db={db} update={update} showToast={showToast} onFocusMode={onFocusMode}
      sessionId={screen.sessionId} blockId={screen.blockId} freeform={screen.freeform} openLogId={screen.logId}
      gym={currentGym(db)}
      onExit={() => stepOut(screen.from || 'home')}
      onFinish={() => closeSession(screen.from || 'home')} />, true);
  }
  if (screen.name === 'preview') {
    const blk = screen.blockId ? t.blocks.filter(b => b.id === screen.blockId)[0] : null;
    const sess = blk ? (blk.sessions || []).filter(s => s.id === screen.sessionId)[0] : null;
    if (!sess) return page(<TrainHome db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
      block={block} onOpen={previewSession} onResume={startSession} onFreeform={startFreeform} go={go} />);
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
        // Same one call the wizard makes, on the same answers it last saved - nothing about building
        // straight from the draft screen is a different code path. The source is INSPIRATION unless
        // the shape says "as brought": the movements and rep ranges are theirs, the day count is the
        // one the person chose, and the volume, the climb and the walk to failure are ours.
        const prefs = tdb(db).prefs || {};
        const gym = currentGym(db);
        const block = Training.blockFromSource(draft.days, {
          gym: gym, daysPerWeek: prefs.daysPerWeek || (prefs.style === 'landmarks' ? 4 : 5),
          weeks: blockWeeks(prefs.shape || (prefs.style === 'landmarks' ? 'build4' : 'minmax4')),
          shape: prefs.shape || (prefs.style === 'landmarks' ? 'build4' : 'minmax4'),
          style: prefs.style || 'minmax',
          targets: trainTargets(db, prefs.style || 'minmax'), custom: tdb(db).custom,
          equipment: (prefs.equipment || []).length ? prefs.equipment : null, dislikes: prefs.dislikes,
          sessionMinutes: prefs.sessionMinutes || 60,
          name: draft.name || 'My block', startISO: Store.todayISO(),
          sourceRef: { kind: 'draft', days: draft.days.length, importedISO: Store.todayISO() },
        });
        block.gymId = gym ? gym.id : null;
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
      onProgramme={(key) => go('builder', { from: 'blocks', draft: Training.programmeBlock(key, { custom: tdb(db).custom, startISO: Store.todayISO() }) })}
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
    return page(<TrainHistory db={db} update={update} onBack={() => go('home')} onOpenExercise={(id) => go('exercise', { exerciseId: id })}
      onOpenSession={(log) => go('player', { logId: log.id, sessionId: log.sessionId || null, blockId: log.blockId || null, from: 'history' })} />);
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
  return page(<TrainHome db={db} update={update} showToast={showToast} isPremium={isPremium} onUpgrade={onUpgrade}
    block={block} onOpen={previewSession} onResume={startSession} onFreeform={startFreeform} go={go} />);
}

// ---- home -------------------------------------------------------------------------------------
/* The two programmes the app ships with, offered as one tap.
 *
 * Everything else on the Train tab asks you questions first, which is right when the answer changes
 * what gets built - but somebody who just wants a good plan on a Monday morning should not have to
 * answer seven of them. These are written plans, not generated ones: what the generator is aiming
 * at, run exactly as they are, with the movements the programme deliberately leaves open still open.
 *
 * Tapping one opens the builder on it, which is where the choices get made and where it is saved or
 * started - the same screen a generated block lands on, so nothing here is a second way to save a
 * block that could drift from the first. */
function ProgrammeCards({ db, onPick, className }) {
  const t = tdb(db);
  const list = Training.PROGRAMMES.map(p => Training.programmeSummary(p.key, t.custom));
  if (!list.length) return null;
  return (
    <Card className={'p-0 overflow-hidden ' + (className || '')}>
      <CardHead title="Macrosaurus programmes" right="Written, not generated" />
      <div className="p-3.5">
        {/* One sentence. The card is the shortcut for somebody who does not want to be asked seven
            questions, and three lines of prose above the two things you came to tap is the screen
            asking anyway. What the block IS gets read off the rows below it. */}
        <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
          Four weeks, written rather than generated, every last set taken to where the weight stops moving.
        </div>
        {list.map(p => (
          <button key={p.key} onClick={() => onPick(p.key)}
            className="w-full text-left p-3 mb-2 last:mb-0 flex items-center gap-2.5"
            style={{ border: '2px solid var(--border)', background: 'var(--surface2)' }}>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold leading-tight">{p.name}</span>
              {/* Numbers first, split second - the same order and the same two tiers the blocks
                  screen uses on a block, because these become one. The split can truncate on a
                  narrow phone and the line that must not truncate is above it. */}
              <span className="block text-[12px] tnum mt-1" style={{ color: 'var(--muted)' }}>
                {p.daysPerWeek} days a week &middot; {p.sets} hard sets
              </span>
              <span className="block text-[12px] mt-0.5 truncate" style={{ color: 'var(--muted2)' }}>{p.dayNames.join(' \u00b7 ')}</span>
            </span>
            {/* Every other row in this module that opens something carries one. Without it this reads
                as a panel of facts rather than as two things you can tap. */}
            <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </Card>
  );
}

function TrainHome({ db, update, showToast, isPremium, onUpgrade, block, onOpen, onResume, onFreeform, go }) {
  const t = tdb(db);
  const today = Store.todayISO();
  const units = t.prefs.units;
  // The landmarks of the block being LOOKED at. Somebody running an imported min-max block while
  // the wizard is still set to the volume model was being told a complete six-set chest week was
  // short on chest - the app disagreeing with a plan it is running, in a bar with no explanation.
  const targets = trainTargets(db, block ? block.style : undefined);
  const prog = block ? Training.blockProgress(block, today) : null;
  const thisWeek = block && prog ? weekPlan(block, prog.week, t.logs) : [];
  /* ---- the week you are LOOKING at, which is not always the week you are IN ----
     `null` means "follow the block", so the card opens on the current week every time and only
     stays somewhere else while you are deliberately reading ahead.

     Reading a future week used to mean the block BUILDER - three taps away, past the start-date
     field and the volume editors, on a screen that edits the whole four-week programme rather than
     answering "what is on Thursday". SessionPreview was built to be that answer and has always
     accepted any session of any block; nothing ever handed it a day outside this week.

     TrainHeroic's athletes ask for the opposite of a day-by-day calendar - "show what week I am on"
     and "the whole week at once" - which is the shape this card already had. So this adds the one
     thing it was missing, a way to MOVE between weeks, and changes nothing about how a week reads. */
  const [weekAt, setWeekAt] = useState(null);
  const [weekPick, setWeekPick] = useState(false);
  const shownWeek = block && prog ? (weekAt || prog.week) : 1;
  const viewingAhead = !!(block && prog && shownWeek !== prog.week);
  // A week that has not happened yet has nothing to REPORT, only something to show. A past week you
  // are looking back at does, so the two are not the same case.
  const weekAhead = !!(block && prog && shownWeek > prog.week);
  const shownWeekPlan = viewingAhead ? weekPlan(block, shownWeek, t.logs) : thisWeek;
  const doneShown = shownWeekPlan.filter(x => x.log && !x.live).length;
  // A session started this morning and left half-way is NOT one of the week's done sessions, and
  // counting it as one was how walking out of the gym read as the week ticking itself off.
  // The next session is the one you are in the middle of, if there is one, and otherwise the first
  // this week with nothing logged against it. Every OTHER session stays tappable too: real weeks do
  // not run in order, and an app that only lets you do "the next one" makes you fight it the first
  // time you swap legs to Thursday.
  const live = thisWeek.filter(x => x.live)[0];
  const next = live || thisWeek.filter(x => !x.log)[0];
  // Coverage is deliberately NOT computed here any more. See the note further down: a volume gap is
  // a question for the build screens, and this one is about the week you are actually running.
  const blockDone = prog && prog.done;
  const isDeload = block && prog && Training.weekSessions(block, prog.week).some(s => s.deload);
  // The opening week of a min-max block is deliberately a rep or two short of where the rest of it
  // lives, and nothing said so until you opened a movement and read the RIR. It is the week people
  // quit a programme over, thinking it is too soft.
  const isIntro = !!(block && prog && prog.week === 1 && (Training.SHAPES[block.shape] || {}).intro);
  // Monday-first, like every dayOfWeek in this module. app.jsx counts from Sunday because it indexes
  // Date.getDay(); borrowing that here would move every session by a day.
  const todayDow = (new Date(today + 'T00:00:00').getDay() + 6) % 7;
  const restDays = block && prog && !blockDone ? Training.restDaysOfWeek(block, prog.week) : [];
  const restToday = restDays.indexOf(todayDow) !== -1;
  const trainingToday = thisWeek.filter(x => x.session.dayOfWeek === todayDow);
  const lastLog = t.logs.slice().sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1))[0];
  const draftDays = ((t.draft && t.draft.days) || []).length;
  const [whyEmpty, setWhyEmpty] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState(false);

  /* ---- a session you stepped out of ----
     Stepping out of the player no longer ends anything, so the tab has to carry the session back.
     For a PLANNED session in the week you are looking at, the block card below already does exactly
     that - "In progress", how many sets you are in, and a button reading "Carry on with Upper 1" -
     and a second banner saying the same thing would be one more button to choose between, which is
     the complaint this whole change is answering.

     So this covers only what that card cannot see: a freeform session, a session on an account with
     no block running, and the moments you are reading a different week.

     And only when there is something to carry. Opening a session, ticking nothing and stepping back
     out leaves a pointer but no work, and "Still open - nothing ticked yet" next to the block card's
     own "Open Lower B" is two buttons for one session, which is the complaint this is answering. No
     ticks, no banner: the ordinary way in is the right one. */
  const openRec = openRecord(db);
  const resumeCovered = !!(block && !blockDone && live && !viewingAhead);
  const resume = openRec && !resumeCovered ? (() => {
    const log = openRec.logId
      ? t.logs.filter(l => l.id === openRec.logId)[0]
      : t.logs.filter(l => openRec.sessionId ? l.sessionId === openRec.sessionId : !l.sessionId)
        .slice().sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1))[0];
    const blk = openRec.blockId ? t.blocks.filter(b => b.id === openRec.blockId)[0] : null;
    const sess = blk && openRec.sessionId ? (blk.sessions || []).filter(x => x.id === openRec.sessionId)[0] : null;
    const ticked = ((log && log.sets) || []).filter(x => x.done && (x.type || 'work') !== 'warmup').length;
    if (!ticked) return null;
    const name = (sess && sess.name) || (log && log.name) || 'Empty session';
    return { name: name.split(' - ')[0], ticked: ticked };
  })() : null;

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

      {/* A session left open, on the screens where nothing else says so. Same shape as the draft
          card further down - a thing in progress, what state it is in, and the way back into it -
          because that is the same promise-to-yourself object. */}
      {resume && (
        <button onClick={() => go('player', { sessionId: openRec.sessionId, blockId: openRec.blockId, logId: openRec.logId, freeform: openRec.freeform })}
          className="pixel-box w-full text-left p-4 mb-4 flex items-center justify-between gap-3"
          style={{ background: 'color-mix(in srgb, var(--accent) 12%, var(--card))' }}>
          <span className="min-w-0">
            <span className="pf text-[9px] uppercase block" style={{ color: 'var(--accent-ink)', letterSpacing: '0.1em' }}>Still open</span>
            <span className="block text-[13px] font-semibold mt-1 truncate">{resume.name}</span>
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
              {resume.ticked} set{resume.ticked === 1 ? '' : 's'} in, all saved
            </span>
          </span>
          <span className="pf text-[10px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>carry on ›</span>
        </button>
      )}

      {/* ---- the block ---- */}
      {block && !blockDone && (
        /* The block, as a titled panel: its name on the ink bar with the week's progress in accent
           beside it, which is the pair the design puts there and the two facts you open this page
           for.

           The count used to be a BUTTON into the block list, which is the one route on this screen
           that never said where it went: `CardHead` draws its right slot with no verb and no
           chevron, so "2 / 4 done" was a progress readout that silently navigated - and the Blocks
           button further down the same page already goes there, labelled. Two routes to one screen,
           one of them disguised as a number. It is a number again. */
        <Card className="p-0 mb-4 overflow-hidden">
          <CardHead title={block.name} right={weekAhead
            ? shownWeekPlan.length + (shownWeekPlan.length === 1 ? ' session' : ' sessions')
            : doneShown + ' / ' + shownWeekPlan.length + ' done'} />
          {/* The week, as a meter and one sentence, in its own band above the sessions. The card used
              to open straight onto the list, which answered "what are the days" but never "where am I
              in the week" - the question the page is actually opened to settle. */}
          <div className="px-3 py-3 flex flex-col gap-2" style={{ borderBottom: '2px solid var(--border)' }}>
            {/* Which week, and WHEN it runs. The same control the builder uses, in the same shape and
                the same words, because a row of "W1 W2 W3 W4" tabs tells you which week and never
                which dates - and reading ahead is exactly the moment you want the dates. Only drawn
                on a block long enough to have somewhere to go. */}
            {block.weeks > 1 && (<>
              <button onClick={() => setWeekPick(!weekPick)} className="w-full flex items-center justify-between gap-2 text-left"
                aria-label="Choose which week to look at">
                <span className="min-w-0">
                  <span className="pf text-[9px] uppercase" style={{ color: viewingAhead ? 'var(--accent-ink)' : 'var(--muted)', letterSpacing: '0.1em' }}>
                    Week {shownWeek} of {block.weeks}{Training.weekSessions(block, shownWeek).some(x => x.deload) ? ' \u00b7 deload' : ''}{viewingAhead ? '' : ' \u00b7 now'}
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted2)' }}>{weekRangeLabel(block.startISO, shownWeek)}</span>
                </span>
                <span className="shrink-0" style={{ color: 'var(--muted2)', transform: weekPick ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>
                  <Icon.chevron width="16" height="16" />
                </span>
              </button>
              {weekPick && (
                <div className="flex flex-col gap-1.5 mb-1">
                  {Array.from({ length: block.weeks }, (_, i) => i + 1).map(w => (
                    <button key={w} onClick={() => { setWeekAt(w === prog.week ? null : w); setWeekPick(false); }}
                      className="w-full p-2.5 flex items-center justify-between gap-2 text-left"
                      style={{ border: '2px solid var(--border)', background: w === shownWeek ? 'color-mix(in srgb, var(--accent) 16%, var(--surface2))' : 'var(--surface2)' }}>
                      <span className="pf text-[9px] uppercase" style={{ color: w === shownWeek ? 'var(--accent-ink)' : 'var(--text2)', letterSpacing: '0.1em' }}>
                        Week {w}{w === prog.week ? ' \u00b7 now' : ''}
                      </span>
                      <span className="text-[11px]" style={{ color: Training.weekSessions(block, w).some(x => x.deload) ? 'var(--warn)' : 'var(--muted)' }}>
                        {Training.weekSessions(block, w).some(x => x.deload) ? 'deload' : weekRangeLabel(block.startISO, w)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>)}
            {!weekAhead && <PipLine pct={shownWeekPlan.length ? (doneShown / shownWeekPlan.length) * 100 : 0} color="var(--accent)" height={11} cells={Math.max(1, shownWeekPlan.length)} />}
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {/* Reading ahead is a different question from running the week, so it gets a different
                  sentence. "2 sessions left" and "Next is Upper 1" are facts about the week you are
                  IN; said over week 3 they would be the card telling you where you are while showing
                  you somewhere else. */}
              {viewingAhead
                ? shownWeekPlan.length + ' session' + (shownWeekPlan.length === 1 ? '' : 's') + ' planned.'
                  + (doneShown ? ' ' + doneShown + ' already done.' : '')
                : doneShown >= shownWeekPlan.length
                  ? 'That is the whole week done.'
                  : (shownWeekPlan.length - doneShown) + ' session' + (shownWeekPlan.length - doneShown === 1 ? '' : 's') + ' left this week' + (live
                    ? '. ' + live.session.name.split(' - ')[0] + ' is still open.'
                    : next ? '. ' + (next.dayLabel ? next.dayLabel + ' is ' : 'Next is ') + next.session.name.split(' - ')[0] + '.' : '.')}
              {!viewingAhead && restDays.length > 0 && restDays.length < 7 && (
                <span style={{ color: 'var(--muted2)' }}> Rest on {restDays.map(d => WEEKDAYS[d]).join(' and ')}.</span>
              )}
            </span>
          </div>
          <div className="p-3.5">

          {isDeload && !viewingAhead && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--warn) 14%, var(--surface2))', color: 'var(--warn)' }}>
              Deload week. Lighter on purpose, so the next block starts on a fresh body.
            </div>
          )}

          {isIntro && !isDeload && !viewingAhead && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--accent) 14%, var(--surface2))', color: 'var(--accent-ink)' }}>
              Intro week, and it is meant to feel easy. Everything stops a rep or two further from failure than it will from next week on: this is the week that earns the five after it.
            </div>
          )}

          {/* A rest day is prescribed, not a day you failed to train. Saying so is the difference
              between a week that is going to plan and a week that looks like it is slipping. */}
          {restToday && !trainingToday.length && !viewingAhead && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--accent) 14%, var(--surface2))', color: 'var(--text2)' }}>
              <b>Today is a rest day.</b> That is the plan, not a gap in it - the week is built around
              {restDays.length === 1 ? ' it' : ' these two'}. Next up is {next ? next.session.name.split(' - ')[0] : 'the next session'}.
            </div>
          )}

          {/* The week used to be four full-width rows, one per day, whether or not there was
              anything left to say about them: a done day and an untouched one took the same amount
              of screen. Three of those four rows carry exactly one fact - done - so they are folded
              into a single line of names, each still its own button into that day's plan. Only the
              week's total set count earns a number of its own, on the right where the old per-row
              set counts used to scatter. */}
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap text-[12.5px]">
              {shownWeekPlan.map(({ session, log, live: inPlay }, i) => {
                const done = !!log && !inPlay;
                const isNext = next && session.id === next.session.id;
                return (
                  <span key={session.id} className="flex items-center gap-1.5">
                    {i > 0 && <span style={{ color: 'var(--muted2)' }}>·</span>}
                    <button onClick={() => onOpen(session, block)} className="hit"
                      style={{ color: done ? 'var(--muted)' : isNext ? 'var(--text)' : 'var(--muted)', fontWeight: isNext ? 600 : 400 }}>
                      {session.name.split(' - ')[0]}{done ? ' ✓' : inPlay ? ' …' : ''}
                    </button>
                  </span>
                );
              })}
            </div>
            <span className="text-[12px] tnum shrink-0" style={{ color: 'var(--muted)' }}>
              {shownWeekPlan.reduce((a, x) => a + (x.session.exercises || []).reduce((y, e) => y + (e.target.sets || 0), 0), 0)} sets
            </span>
          </div>

          {/* The next session, and the button that opens it, belong to the week you are IN. While you
              are reading ahead they step aside: a "Next · Thursday" card under week 3's day list
              would be offering you this week's session off another week's page. Coming back to the
              current week brings both back. */}
          {viewingAhead ? (
            <button onClick={() => { setWeekAt(null); setWeekPick(false); }}
              className="pixel-box w-full py-3 text-[12px] mb-1" style={{ background: 'var(--surface2)' }}>
              Back to week {prog.week}
            </button>
          ) : next ? (
            /* One nested card now, not a boxed "Opening with" panel plus a floating sentence plus a
               hint nobody needed once the roll-up above made every day tappable by name. NEXT · DAY
               names when, the day's own name and its cost sit on one row, and what it opens with is
               one sentence rather than a mini exercise card of its own - the whole point of the fold
               is that this is a preview, not the session. */
            <div className="mb-3 px-3 py-3" style={{ background: 'var(--surface2)', border: '2px solid var(--border)' }}>
              <div className="pf text-[8px] uppercase mb-1" style={{ color: 'var(--accent-ink)', letterSpacing: '0.1em' }}>
                {live ? 'In progress' : 'Next'} · {WEEKDAYS[next.session.dayOfWeek] || ''}
              </div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <span className="text-[14px] font-bold">{next.session.name.split(' - ')[0]}</span>
                <span className="text-[11px] tnum shrink-0" style={{ color: 'var(--muted)' }}>
                  {(next.session.exercises || []).reduce((a, e) => a + (e.target.sets || 0), 0)} sets · about {sessionMins(next.session.exercises)} min
                </span>
              </div>
              {(() => {
                const items = (next.session.exercises || []).slice().sort((a, b) => a.order - b.order);
                if (!items.length) return null;
                // Half-way through it, so what it OPENS with is not the useful sentence any more.
                if (live) {
                  const ticked = (live.log.sets || []).filter(x => x.done && (x.type || 'work') !== 'warmup').length;
                  const planned = items.reduce((a, e) => a + (e.target.sets || 0), 0);
                  return (
                    <div className="text-[12px] leading-snug" style={{ color: 'var(--text2)' }}>
                      You are {ticked} set{ticked === 1 ? '' : 's'} into this one{planned ? ' of ' + planned : ''}. Everything you ticked is saved - carrying on picks it up where you left it.
                    </div>
                  );
                }
                const style = Training.styleOf(block.style);
                const lead = items[0];
                const leadEx = Training.byId(lead.exerciseId, t.custom);
                const effort = style.toFailure
                  ? ((lead.target.rirLast == null ? lead.target.rir : lead.target.rirLast) > 0
                    ? 'stopping short this week'
                    : (lead.target.rir > 0 ? 'last set to failure' : 'to failure'))
                  : lead.target.rir + ' RIR';
                return (
                  <div className="text-[12px] leading-snug" style={{ color: 'var(--text2)' }}>
                    Opens with {leadEx ? leadEx.name : lead.exerciseId} {lead.target.sets}×{lead.target.repLow}-{lead.target.repHigh} · {effort}
                    {items.length > 1 ? ', then ' + (items.length - 1) + ' more.' : '.'}
                    {restDays.length > 0 && restDays.length < 7 ? ' Rest ' + restDays.map(d => WEEKDAYS[d]).join('-') + '.' : ''}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="text-[12.5px] text-center py-3" style={{ color: 'var(--good)' }}>
              Week {prog.week} done. That is the whole week, in the bag.
            </div>
          )}
          {/* The page's one primary action, so it wears the accent rather than a hardcoded white
              slab - which was also the last control in Train that stayed daylight at night. */}
          {/* "Looking is not starting" is the rule for a session you have not begun: the tap opens the
              plan and the button on THAT screen starts it. A session you are already inside is not
              looking, and sending it through the preview meant resuming a workout you were standing
              in the middle of cost two taps and a screen you did not need. Live goes straight in. */}
          {next && !viewingAhead && (
            <button onClick={() => (live && onResume ? onResume(next.session, block) : onOpen(next.session, block))}
              className="pixel-btn w-full py-3.5 pf text-[12px] uppercase" style={{ background: 'var(--accent)', color: 'var(--on-accent)', letterSpacing: '0.06em' }}>
              <Icon.play width="16" /> {live ? 'Carry on with ' : 'Open '}{next.session.name.split(' - ')[0]}
            </button>
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
                {(() => {
                  // What the block would actually be. The promise has to come off the STYLE, because
                  // that is what decides whether volume climbs: reading it off the shape meant a
                  // min-max block set to four weeks was described as one that "builds on each other
                  // and then backs off", which is the one thing min-max never does - it adds no sets
                  // at all, and neither of its shapes has a back-off week. The length is a separate
                  // question and the intro week belongs to the shape, so both are asked separately.
                  const shape = plannedShape(t.prefs);
                  const n = plannedWeeks(t.prefs);
                  const intro = !!(Training.SHAPES[shape] || {}).intro;
                  const tail = t.logs.length
                    ? ' I will keep the numbers.'
                    : ' Bring one you already follow, take one off the shelf, or I will write you one.';
                  // plannedStyle, not styleOf: this sentence is a promise about the block that WOULD
                  // be built, and styleOf answers for blocks that already exist. Reading the promise
                  // off styleOf meant somebody with no style recorded was offered a six-week block
                  // and told, in the same breath, that it would build week on week and then back off.
                  if (Training.styleOf(plannedStyle(t.prefs)).toFailure) {
                    return n + ' weeks' + (intro ? ', an easier first one and ' + (n - 1) + ' hard ones' : '')
                      + '. One or two sets a movement, taken to where the weight stops moving, and nothing added week to week: the weight does the moving.' + tail;
                  }
                  return n + ' weeks that build on each other and then back off'
                    + (t.logs.length ? ', so you start the next one fresher than you finished this one.' : '.') + tail;
                })()}
              </div>
            </div>
          </div>
          <button onClick={() => go('wizard')} className="pixel-btn w-full h-14 font-bold mb-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Build a {plannedWeeks(t.prefs)}-week block
          </button>
          <div className="flex gap-2 mb-2">
            <button onClick={() => go('library')} className="pixel-box flex-1 h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Browse blocks</button>
          </div>
          <button onClick={() => setWhyEmpty(true)} className="w-full py-2 text-[12px]" style={{ color: 'var(--accent-ink)' }}>
            Or start an empty session and log what you did
          </button>
        </Card>
      )}

      {/* Under the build card, not above it: building one against your own kit and days is still the
          better answer, and this is the shortcut for anyone who would rather not be asked. */}
      {!block && <ProgrammeCards db={db} className="mb-4" onPick={(key) => go('builder', { draft: Training.programmeBlock(key, { custom: t.custom, startISO: Store.todayISO() }) })} />}

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
        <button onClick={() => go('history')} className="pixel-box w-full text-left px-3.5 py-3 mb-4 flex items-center justify-between gap-3"
          style={{ background: 'var(--card)' }}>
          {/* Recognition, not a second dashboard. This used to be a titled card with three stat
              tiles under it - a whole panel to say "yes, you trained yesterday". One line does the
              same job: which session, when, what it cost, and a way in if you want more. */}
          <span className="min-w-0">
            <span className="pf text-[8px] uppercase block mb-1" style={{ color: 'var(--muted2)', letterSpacing: '0.08em' }}>
              Last · {(lastLog.name || 'Session').split(' - ')[0]} · {relativeDay(lastLog.dateISO, today).toLowerCase()}
            </span>
            <span className="text-[13px] tnum" style={{ color: 'var(--text)' }}>
              {(() => {
                const sets = (lastLog.sets || []).filter(s => s.done).length;
                const kg = toDisplayWeight(Training.tonnage(lastLog), units);
                const vol = kg >= 1000 ? (Math.round(kg / 100) / 10) + 't' : Math.round(kg) + unitLabel(units);
                return <><b>{sets}</b> sets · <b>{vol}</b> moved</>;
              })()}
            </span>
          </span>
          <span className="pf text-[10px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>view ›</span>
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

      {/* ---- where new blocks come from, when there is nothing running to browse or build past.
              One route in: bringing a source (a reel, a PDF, a screenshot) and building from scratch
              are the same wizard, not a choice between two screens. Once a block IS running, both of
              these are one tap further away inside "Blocks" - showing them here too was two routes
              to the same place for the case that matters least. ---- */}
      {!block && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button onClick={() => go('library')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
            Browse<br />blocks
          </button>
          <button onClick={() => go('wizard')} className="pixel-box py-3 px-1 text-[11.5px] leading-tight" style={{ background: 'var(--surface2)' }}>
            Build<br />a block
          </button>
        </div>
      )}

      {/* ---- quick links, as three real buttons rather than four text links in a row. Text links
              this close together and this low-contrast were the least discoverable controls in the
              app; a button is a button whether it says HISTORY or OPEN LOWER B. "Your blocks" is
              renamed to fit a one-word button and match the block card's own name for itself. ---- */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <button onClick={() => go('history')} className="pixel-box h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>History</button>
        <button onClick={() => go('stats')} className="pixel-box h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Stats</button>
        <button onClick={() => go('blocks')} className="pixel-box h-11 text-[12px]" style={{ background: 'var(--surface2)' }}>Blocks</button>
      </div>

      {/* "Empty session" is for the days that are not in the plan: a class, a holiday gym, a bit of
          arms on the way past. Worth having, not worth a fourth button - it lives as a quiet link
          under the three real ones, and only shows once there is a block for it to be an exception
          to at all. */}
      {block && !blockDone && onFreeform && (
        <div className="text-center mb-4">
          <button onClick={() => setWhyEmpty(true)} className="pf text-[10px] uppercase" style={{ color: 'var(--accent-ink)', letterSpacing: '0.08em' }}>
            Empty session
          </button>
        </div>
      )}

      {/* This used to set a piece of state that nothing rendered, so the link was a dead button: the
          one way into a session outside the plan, and it did nothing at all. */}
      {whyEmpty && (
        <ConfirmDialog title="Start an empty session?"
          body="Nothing prescribed - you add the movements as you go. It is for the days that are not in your block: a class, a holiday gym, a bit of arms on the way past. It still counts towards your volume and your records, and it does not touch the week's plan."
          confirmLabel="Start one" confirmKind="accent"
          onConfirm={onFreeform} onClose={() => setWhyEmpty(false)} />
      )}

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