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
        // Same one call the wizard makes, on the same answers it last saved - nothing about building
        // straight from the draft screen is a different code path. The source is INSPIRATION unless
        // the shape says "as brought": the movements and rep ranges are theirs, the day count is the
        // one the person chose, and the volume, the climb and the walk to failure are ours.
        const prefs = tdb(db).prefs || {};
        const gym = currentGym(db);
        const block = Training.blockFromSource(draft.days, {
          gym: gym, daysPerWeek: prefs.daysPerWeek || (prefs.style === 'landmarks' ? 4 : 5),
          weeks: blockWeeks(prefs.shape || (prefs.style === 'landmarks' ? 'build4' : 'minmax6')),
          shape: prefs.shape || (prefs.style === 'landmarks' ? 'build4' : 'minmax6'),
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
  // The landmarks of the block being LOOKED at. Somebody running an imported min-max block while
  // the wizard is still set to the volume model was being told a complete six-set chest week was
  // short on chest - the app disagreeing with a plan it is running, in a bar with no explanation.
  const targets = trainTargets(db, block ? block.style : undefined);
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
              {restDays.length > 0 && restDays.length < 7 && (
                <span style={{ color: 'var(--muted2)' }}> Rest on {restDays.map(d => WEEKDAYS[d]).join(' and ')}.</span>
              )}
            </span>
          </div>
          <div className="p-3.5">

          {isDeload && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--warn) 14%, var(--surface2))', color: 'var(--warn)' }}>
              Deload week. Lighter on purpose, so the next block starts on a fresh body.
            </div>
          )}

          {isIntro && !isDeload && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--accent) 14%, var(--surface2))', color: 'var(--accent-ink)' }}>
              Intro week, and it is meant to feel easy. Everything stops a rep or two further from failure than it will from next week on: this is the week that earns the five after it.
            </div>
          )}

          {/* A rest day is prescribed, not a day you failed to train. Saying so is the difference
              between a week that is going to plan and a week that looks like it is slipping. */}
          {restToday && !trainingToday.length && (
            <div className="text-[11px] mb-4 px-3 py-2 leading-snug" style={{ background: 'color-mix(in srgb, var(--accent) 14%, var(--surface2))', color: 'var(--text2)' }}>
              <b>Today is a rest day.</b> That is the plan, not a gap in it - the week is built around
              {restDays.length === 1 ? ' it' : ' these two'}. Next up is {next ? next.session.name.split(' - ')[0] : 'the next session'}.
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
              {/* What you are about to lift, before you commit to lifting it. The tab could tell you
                  how many sessions were left and how long the next one takes but not what was IN it,
                  which is the thing anybody deciding whether tonight is a gym night actually wants -
                  and on a style whose whole psychology is "one set, make it count", the opener and
                  what it asks for is worth reading before you are standing in front of it. */}
              {(() => {
                const items = (next.session.exercises || []).slice().sort((a, b) => a.order - b.order);
                if (!items.length) return null;
                const style = Training.styleOf(block.style);
                const lead = items[0];
                const leadEx = Training.byId(lead.exerciseId, t.custom);
                const effort = style.toFailure
                  ? ((lead.target.rirLast == null ? lead.target.rir : lead.target.rirLast) > 0
                    ? 'stopping short this week'
                    : (lead.target.rir > 0 ? 'last set to failure' : 'to failure'))
                  : lead.target.rir + ' RIR';
                return (
                  <div className="mb-3 px-3 py-2.5" style={{ background: 'var(--surface2)', borderLeft: '3px solid var(--accent)' }}>
                    <div className="pf text-[7.5px] uppercase mb-1.5" style={{ color: 'var(--accent-ink)', letterSpacing: '0.1em' }}>Opening with</div>
                    <div className="text-[12.5px] font-semibold leading-tight">
                      {leadEx ? leadEx.name : lead.exerciseId}
                    </div>
                    <div className="text-[11px] tnum mt-0.5" style={{ color: 'var(--muted)' }}>
                      {lead.target.sets} × {lead.target.repLow}–{lead.target.repHigh} · {effort}
                      {lead.technique ? ' · ' + lead.technique.toLowerCase() : ''}
                    </div>
                    {items.length > 1 && (
                      <div className="text-[10.5px] mt-1.5 leading-snug" style={{ color: 'var(--muted2)' }}>
                        then {items.slice(1, 3).map(e => (Training.byId(e.exerciseId, t.custom) || {}).name).filter(Boolean).join(', ')}
                        {items.length > 3 ? ' and ' + (items.length - 3) + ' more' : ''}
                      </div>
                    )}
                  </div>
                );
              })()}

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
                  if (Training.styleOf(t.prefs.style).toFailure) {
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