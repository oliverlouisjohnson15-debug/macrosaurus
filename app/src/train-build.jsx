/* ---- train build ----------------------------------------------------------------------
 * building and editing a block: the preview, the wizard, the editor, one session
 *
 * Part of the Train module, which was one 6,200-line file. The sources have no imports:
 * build.mjs concatenates them in the order given by app/src/manifest.json and hands the lot
 * to Babel, so everything here shares one scope with the rest of the app. Function
 * declarations hoist across the whole bundle, which is why these files can call each other
 * freely; module-level `const` does not, so anything declared with one has to appear before
 * the code that reads it AT MODULE SCOPE. Nothing here does, but that is the rule.
 * ------------------------------------------------------------------------------------- */
function MesoGrid({ weeks, sessions }) {
  if (!weeks || !weeks.length || !sessions || !sessions.length) return null;
  const peak = Math.max.apply(null, weeks.map(w => Math.max.apply(null, w.sessions.map(s => s.sets).concat([1]))));
  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col gap-1 pt-[13px] shrink-0">
        {weeks.map(w => (
          <span key={w.week} className="pf text-[11px] w-4" style={{ height: 22, lineHeight: '22px', letterSpacing: '0.06em', color: w.deload ? 'var(--warn-ink)' : 'var(--muted)' }}>W{w.week}</span>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(' + sessions.length + ',1fr)' }}>
          {sessions.map((s, i) => (
            <span key={i} className="pf text-[11px] text-center truncate" style={{ letterSpacing: '0.04em', color: 'var(--muted2)' }}>{s.name.length > 6 ? s.name.slice(0, 5) : s.name}</span>
          ))}
        </div>
        <div className="flex flex-col gap-1 mt-1">
          {weeks.map(w => (
            <div key={w.week} className="grid gap-1" style={{ gridTemplateColumns: 'repeat(' + sessions.length + ',1fr)' }}>
              {w.sessions.map((s, i) => (
                <div key={i} title={s.name + ', week ' + w.week + ': ' + s.sets + ' sets'}
                  className="flex items-center justify-center text-[11px] tnum"
                  style={{
                    height: 22, boxSizing: 'border-box', border: '2px solid var(--border)', transition: 'background .25s ease',
                    // The Seg's ink, not gold: gold is a screen's one primary action (DESIGN.md), and
                    // twenty gold cells sat right above the gold button on every screen this draws on.
                    background: w.deload ? 'var(--surface2)' : 'color-mix(in srgb, var(--seg-on) ' + Math.min(100, Math.max(12, Math.round(s.sets / peak * 100))) + '%, var(--track))',
                    color: w.deload ? 'var(--muted)' : (s.sets / peak > 0.55 ? 'var(--seg-on-text)' : 'var(--text)'),
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


// ---- block builder / editor -------------------------------------------------------------------
function BlockBuilder({ db, update, showToast, isPremium, onUpgrade, blockId, draft, onBack, onStart, onSchedule }) {
  const t = tdb(db);
  const saved = blockId ? t.blocks.filter(b => b.id === blockId)[0] : null;
  const [block, setBlock] = useState(() => JSON.parse(JSON.stringify(draft || saved || Training.generateBlock({ daysPerWeek: 4, weeks: 4 }))));
  const [week, setWeek] = useState(() => {
    const b = draft || saved;
    if (!b || !b.startISO) return 1;
    const p = Training.blockProgress(b, Store.todayISO());
    return p.done ? 1 : Math.min(p.week, b.weeks || 1);
  });
  const [picking, setPicking] = useState(null);   // { sessionId }
  const [name, setName] = useState(block.name);
  const [startISO, setStartISO] = useState(block.startISO || Store.todayISO());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [share, setShare] = useState(() => !!(saved && saved.shared));
  const [weekPick, setWeekPick] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(null);
  const skipSwitchCheck = useRef(false);
  const [openDay, setOpenDay] = useState(null);
  const [openRegion, setOpenRegion] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // { text, before, was } - the receipt for a day-count change, and the block as it stood before it.
  const [daysResult, setDaysResult] = useState(null);
  /* Everything on this screen is an edit buffer: sets, movements, the name, the start date, the
     week you are looking at. None of it is written until the button at the bottom says so, which is
     the right model for a screen where one tap changes twelve weeks - and it meant the back arrow
     silently threw away a block you had just spent five minutes rebuilding, without a word. The
     snapshot is taken once, on open, and compared with what is on screen. */
  const opened = useRef(null);
  const nowJSON = JSON.stringify({ b: block, n: name, s: startISO, sh: share });
  if (opened.current === null) opened.current = nowJSON;
  const dirty = opened.current !== nowJSON;
  // A block that has never been saved is ALL unsaved work - the wizard's answers, the generator's
  // run, or a programme you opened to make yours - so leaving it loses the lot whether or not you
  // touched anything on the way past.
  const leave = () => { if (dirty || isNew) setConfirmLeave(true); else onBack(); };
  useBackClose(leave);
  // Which days of this block already have a session logged against them, so a finished day reads as
  // finished here as well as on the Train tab.
  // ... and which of those are still being written, so a session you are half-way through does not
  // wear the same tick as one you finished. The start button below reads the same pair.
  const comp = Training.completion(block, tdb(db).logs, Store.todayISO(), Date.now());
  const logBySession = comp.logBySession;
  // The block being edited decides which landmarks it is judged against, not the wizard's last answer.
  const targets = trainTargets(db, block ? block.style : undefined);
  // Where a running block has got to. Null for one that has not started, which is the case with no
  // trained weeks to protect and so no floor on what an edit may touch.
  const prog = block && block.startISO ? Training.blockProgress(block, Store.todayISO()) : null;
  const isNew = !saved;

  const sessions = Training.weekSessions(block, week).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  /* Reordering a day is an edit to the PLAN, so it reaches this week and every week after it - the
     same reach as replacing a movement here, and for the same reason: a running order that reverts
     the moment the week turns over is not an answer to "I want legs to start with squats". Weeks
     already trained stay as they were. Like every edit on this screen it waits in the buffer until
     the button at the bottom writes it. */
  const dragDay = sessions.filter(s => s.id === openDay)[0] || null;
  const dragRows = dragDay ? dragDay.exercises.slice().sort((a, b) => a.order - b.order) : [];
  const dnd = useDragList({
    ids: dragRows.map(it => it.id),
    onDrop: (id, to) => { if (dragDay) edit(b => { Training.moveSlotInBlock(b, dragDay.id, id, to, prog ? prog.week : null); }); },
    unitOf: (id) => (dragRows.filter(x => x.id === id)[0] || {}).supersetGroup || null,
    disabled: !!picking,
  });
  const cov = Training.coverage(Training.blockWeekVolume(block, week, t.custom), targets);
  // Movements the plan left open, e.g. "Squat (Your Choice)". Empty for anything the app generated,
  // which never leaves a slot open: it has already made the pick.
  const choices = Training.blockChoices(block, t.custom);
  const techniques = Training.weekSessions(block, 1).reduce((a, s) => a + (s.exercises || []).filter(e => e.technique).length, 0);

  /* ---- changing the day count -------------------------------------------------------------------
     Training.setDaysPerWeek does the work and this shows the receipt: the change is applied into the
     same edit buffer as a set stepper, so nothing is written
     until the exits at the bottom of the page say so, and Undo puts the block back as it was.

     The floor is the one every editing route on this screen uses. A block three weeks in keeps those
     three weeks at the day count they were actually run at, because they are a record of what was
     lifted rather than a plan to edit. */
  const dayCount = block.daysPerWeek || Training.weekSessions(block, 1).length;
  function applyDays(n) {
    if (n === dayCount) return;
    const before = JSON.parse(JSON.stringify(block));
    const res = Training.setDaysPerWeek(block, n, {
      custom: t.custom, targets: targets, gym: currentGym(db),
      dislikes: t.prefs.dislikes, sessionMinutes: t.prefs.sessionMinutes || 60,
      fromWeek: prog ? prog.week : null,
    });
    if (!res.changed) return;
    const say = (a) => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    const parts = [];
    if (res.added.length) parts.push('Added ' + say(res.added) + ', every week.');
    if (res.removed.length) parts.push('Took out ' + say(res.removed) + '.');
    if (res.fromWeek > 1) parts.push('Week' + (res.fromWeek > 2 ? 's 1 to ' + (res.fromWeek - 1) : ' 1') + ' you have already trained, so ' + (res.fromWeek > 2 ? 'they were' : 'it was') + ' left alone.');
    // The sets moved because the week did, and a block that quietly gained thirty sets is worth a
    // sentence: the volume panel above is already redrawn, this says which way to look.
    const shown = Math.max(week, res.fromWeek || 1);
    const sets = Training.weekSessions(res.block, shown)
      .reduce((a, s) => a + (s.exercises || []).reduce((x, e) => x + ((e.target && e.target.sets) || 0), 0), 0);
    parts.push('Week ' + shown + ' is now ' + sets + ' hard sets across ' + res.days + ' days.');
    setBlock(res.block);
    setOpenDay(null);
    setDaysResult({ text: parts.join(' '), before: before, was: res.was });
  }
  function undoDays() {
    if (!daysResult) return;
    setBlock(daysResult.before);
    setOpenDay(null);
    setDaysResult(null);
  }
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
  /* Replacing a movement on the block screen changes the PLAN, which is what this screen is for, so
     it moves every week rather than asking the mid-block question about tonight. What it must not do
     is move weeks that have already happened. This editor opens on running blocks as well as new
     ones - the save button on it says in as many words that changes apply to the weeks you have not
     trained yet - so a block already three weeks in gets the same floor every other route uses, and
     only a block that has not started moves the lot.

     What it moves is the ROW that was tapped, in every week ahead of you - not every row that
     happens to hold the same movement. A day can programme the same lift twice on purpose (a heavy
     set and a back-off) and an upper/lower split writes the same day twice a week, so matching on
     the movement made "change this one to the wide grip" silently change four rows when the question
     was asked about one.

     It says nothing when it works, which is how everything else on this screen behaves: adding a
     movement and taking one out are both silent, because the edit is in front of you and none of it
     is written until the button at the bottom of the page says so. The one case worth a word is a
     replacement that could not move anything. */
  function replaceItem(sessionId, itemId, exId) {
    setPicking(null);
    const s0 = (block.sessions || []).filter(x => x.id === sessionId)[0];
    const row = s0 && (s0.exercises || []).filter(x => x.id === itemId)[0];
    if (!row || row.exerciseId === exId) return;
    const fromId = row.exerciseId;
    // Null only for a block that has not begun. A running one is floored at the week it is on, so
    // the weeks behind it stay a record of what was actually lifted.
    const from = prog ? prog.week : null;
    // Counted before the edit, because afterwards there is nothing left to count.
    const reach = Training.slotReach(block, sessionId, itemId, from);
    // Nothing left to change: this line only exists in weeks behind the one you are on, and those
    // are a record of what was lifted rather than a plan to edit. Saying "replaced" over a block
    // that did not move is worse than saying nothing.
    if (!reach) {
      const fromEx = Training.byId(fromId, t.custom);
      showToast && showToast((fromEx ? fromEx.name : 'That movement')
        + ' only appears in weeks you have already trained, so nothing changed.');
      return;
    }
    edit(b => { Training.swapSlotInBlock(b, sessionId, itemId, exId, from); });
  }
  function addItem(sessionId, exId) {
    setPicking(null);
    edit(b => {
      const s = b.sessions.filter(x => x.id === sessionId)[0];
      // Prescribed the way THIS block prescribes things. A movement dropped into a min-max block was
      // arriving with the volume model's ramp - three reps in reserve in week one, walking down -
      // in the middle of a block where every other movement takes its last set to failure.
      s.exercises.push(Object.assign({ id: exId + '_' + trainUid(), order: s.exercises.length },
        Training.newItemFor(exId, { style: b.style, week: s.week, window: s.window, custom: t.custom })));
    });
  }
  // Where a programme came from, so the way back to it as written is always one tap. Offered only on
  // a block that has not been saved yet: rebuilding it mints fresh session ids, and on a block that
  // is already running those are what the logs point at.
  const fromProgramme = isNew && block.sourceRef && block.sourceRef.kind === 'programme'
    ? Training.programmeOf(block.sourceRef.name) : null;
  function resetToProgramme() {
    const fresh = Training.programmeBlock(block.sourceRef.name, { custom: t.custom, startISO: startISO, name: name, additions: !!block.sourceRef.additions });
    setConfirmReset(false);
    if (!fresh) return;
    fresh.id = block.id;
    setBlock(fresh);
    showToast && showToast('Back to ' + fromProgramme.name + ' as written.');
  }
  /* ---- the Macrosaurus additions, and a priority muscle ------------------------------------------
     Both are changes to a block that has not been run yet. The additions layer rebuilds the block
     from the programme, because it adds and swaps lines the author did not write; the priority muscle
     adds a set and moves a line, and keeps the block as it stood a moment before it (stripped on
     save) so choosing a different muscle, or none, starts again from there rather than stacking. */
  const hasAdditions = !!(fromProgramme && Training.PROGRAMME_ADDITIONS[block.sourceRef.name]);
  const additionsOn = !!(block.sourceRef && block.sourceRef.additions);
  function toggleAdditions() {
    const fresh = Training.programmeBlock(block.sourceRef.name, { custom: t.custom, startISO: startISO, name: name, additions: !additionsOn });
    if (!fresh) return;
    fresh.id = block.id;
    if (block.priority) Training.applyPriority(fresh, block.priority, { custom: t.custom });
    setBlock(fresh);
    opened.current = JSON.stringify({ b: fresh, n: name, s: startISO, sh: share });
    showToast && showToast(additionsOn ? 'Back to ' + fromProgramme.name + ' as written.' : 'Macrosaurus additions added.');
  }
  const [priorityOpen, setPriorityOpen] = useState(false);
  // Only muscles this block trains as a main mover can be a priority: anything else has no line to
  // lift. Read off week 1, which is the shape every week repeats.
  const priorityChoices = Training.MUSCLES.filter(m => Training.weekSessions(block, 1).some(sess =>
    (sess.exercises || []).some(e => (Training.setContribution(Training.byId(e.exerciseId, t.custom) || {})[m] || 0) >= 1)));
  function pickPriority(m) {
    setBlock(b => {
      const n = JSON.parse(JSON.stringify(b));
      if (n._beforePriority) n.sessions = n._beforePriority; else n._beforePriority = JSON.parse(JSON.stringify(n.sessions));
      delete n.priority;
      if (m) Training.applyPriority(n, m, { custom: t.custom }); else delete n._beforePriority;
      return n;
    });
  }
  // `later` saves the block to your shelf without beginning it: no start date, nothing retired, and
  // no question about switching, because nothing is being switched. Building a plan and running a
  // plan are separate decisions, and an app that can only do both at once makes you keep a coach's
  // programme in your camera roll until the week you are ready for it.
  function save(later, quiet) {
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
    delete out._beforePriority;
    trainUpdate(update, (tr) => {
      const i = tr.blocks.findIndex(b => b.id === out.id);
      if (i >= 0) tr.blocks[i] = out;
      else {
        // Starting a new block retires whatever was running, so "the current block" is never
        // ambiguous. Saving one for later retires nothing: it is not competing with anything yet.
        if (!later) tr.blocks.forEach(b => { if (!b.archived) b.archived = true; });
        tr.blocks.push(out);
      }
      // A day count changed here is a change of mind about your WEEK, not about this block alone, so
      // the next thing you build starts from the answer you just gave rather than asking again. Only
      // when it was actually changed on this visit: opening an old three-day block to read it must
      // not quietly move your default.
      if (daysResult) tr.prefs = Object.assign({}, tr.prefs, { daysPerWeek: out.daysPerWeek });
    });
    // Publishing is fire and forget: it must never be able to fail the save of your own block.
    if (share) submitPublicBlock(out, tdb(db).prefs, tdb(db).custom);
    else if (saved && saved.shared) retractPublicBlock(out.id);
    opened.current = JSON.stringify({ b: out, n: name, s: startISO, sh: share });
    // Saved on the way into a session rather than on the way out of the screen: nothing to announce
    // and nowhere to go.
    if (quiet) return;
    showToast && showToast(later ? 'Saved to your programmes. Start it whenever you like.'
      : isNew ? 'Programme saved.' : 'Programme updated.');
    /* A NEW block that starts now goes straight to the days question.
       The plan is the hard part and the calendar is the easy one, so the calendar was never asked
       about: a block was built, given a default week, and handed over. The default is a good one and
       it is still only a guess about somebody's Tuesdays - and the moment it is cheapest to correct
       is now, before the first session has been run against it. Editing a block already underway
       goes back where it came from, because that is a change of mind about a plan, not a first
       answer to a question nobody asked. */
    if (isNew && !later && onSchedule) { onSchedule(out.id); return; }
    onBack();
  }
  function remove() {
    if (saved && saved.shared) retractPublicBlock(block.id);
    trainUpdate(update, (tr, d) => { tr.blocks = tr.blocks.filter(b => b.id !== block.id); tombstone(d, [block.id]); });
    showToast && showToast('Programme deleted.');
    onBack();
  }

  return (
    <div className="fade-in pb-2">
      <SubHeader back={leave} backLabel="Back" title={isNew ? 'Your new programme' : 'Edit programme'} />
      

      <Field label="Name"><TextInput value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="Starts" hint="Week 1 runs from this date.">
        <input type="date" value={startISO} onChange={e => setStartISO(e.target.value)}
          className="w-full pixel-box px-3 py-3 text-[14px]" style={{ background: 'var(--surface2)', color: 'var(--text)' }} />
      </Field>

      {hasAdditions && isNew && (
        <div className="mb-3">
          <RowToggle label="Macrosaurus additions" on={additionsOn} onClick={toggleAdditions} />
          <div className="text-[12px] -mt-1 px-0.5" style={{ color: 'var(--muted)' }}>
            {Training.programmeSummary(block.sourceRef.name, t.custom).additions.note} Off, this is {fromProgramme.name} exactly as it was written.
          </div>
        </div>
      )}
      {priorityChoices.length > 0 && (
        <div className="mb-3">
          <Row title="Priority muscle" sub={block.priority ? 'A set more in every session that trains it, and earlier in the session' : 'Optional. Pick a weak point and it gets more work, while you are fresh'}
            value={block.priority ? Training.MUSCLE_LABEL[block.priority] : 'None'} onClick={() => setPriorityOpen(true)} />
        </div>
      )}
      {priorityOpen && (
        <ActionSheet kicker="Priority muscle" title="Which one needs more?" onClose={() => setPriorityOpen(false)}
          actions={[{ label: 'None', sub: block.priority ? 'Back to the programme as it was before' : null, onClick: () => pickPriority(null) }].concat(
            priorityChoices.map(m => ({ label: Training.MUSCLE_LABEL[m], sub: block.priority === m ? 'Current choice' : null, onClick: () => pickPriority(m) })))} />
      )}

      {/* The week you are looking at, and the dates it covers. A row of "W1 W2 W3 W4" tabs told you
          which week but never WHEN, so you could not tell whether you were looking at this week or
          one three weeks out. A named range answers both. */}
      <button onClick={() => setWeekPick(!weekPick)} className="w-full pixel-box p-4 mb-2 flex items-center justify-between gap-2" style={{ background: 'var(--card)' }}>
        <span className="min-w-0 text-left">
          <span className="pf text-[11px] block" style={{ color: 'var(--accent-ink)' }}>
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
                <span className="pf text-[11px]" style={{ color: week === w ? 'var(--accent-ink)' : 'var(--text2)' }}>Week {w}</span>
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
      {/* Four body-region groups rather than all seventeen muscles laid open at once. The headline -
          "all covered", or how many are short - answers the only question most visits are asking; a
          region only needs opening when something in it wants a look, and each muscle inside is
          still drawn as a POSITION on its own MEV-to-MRV band, never a bar filling up. */}
      <Card className="p-4 mb-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="pf text-[11px] uppercase" style={{ color: 'var(--muted)' }}>Week {week} volume</div>
          <div className="text-[11px]" style={{ color: cov.gaps.length || cov.overs.length ? 'var(--warn)' : 'var(--good)' }}>
            {cov.totalSets} sets · {cov.overs.length ? cov.overs.length + ' past recovery' : cov.gaps.length ? cov.gaps.length + ' short' : 'all covered'}
          </div>
        </div>
        {(() => {
          const GROUPS = [
            { key: 'legs', label: 'Legs', regions: ['legs'] },
            { key: 'back', label: 'Back', regions: ['back'] },
            { key: 'chest', label: 'Chest & shoulders', regions: ['chest', 'delts'] },
            { key: 'rest', label: 'Arms, core & the rest', regions: ['arms', 'core'] },
          ];
          return (
            <div className="flex flex-col gap-2">
              {GROUPS.map(g => {
                const rows = cov.rows.filter(r => g.regions.indexOf(Training.REGION[r.muscle]) !== -1);
                if (!rows.length) return null;
                const regionSets = rows.reduce((a, r) => a + r.sets, 0);
                const short = rows.filter(r => r.sets < r.mev).length;
                const over = rows.filter(r => r.sets > r.mrv).length;
                const open = openRegion === g.key;
                return (
                  <div key={g.key} className="pixel-box" style={{ background: 'var(--surface2)' }}>
                    <button onClick={() => setOpenRegion(open ? null : g.key)} className="w-full flex items-center justify-between gap-2 p-3 text-left">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold">{g.label}</span>
                        <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--muted2)' }}>
                          {rows.map(r => r.label.toLowerCase()).join(', ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] tnum flex items-center gap-2"
                        style={{ color: over ? 'var(--warn-ink)' : short ? 'var(--muted)' : 'var(--good-ink)' }}>
                        {regionSets} sets
                        <span style={{ color: 'var(--muted2)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><Icon.chevron width="16" height="16" /></span>
                      </span>
                    </button>
                    {open && (
                      <div className="px-3 pb-3 flex flex-col gap-2.5">
                        {rows.map(r => <CoverageRow key={r.muscle} row={r} compact />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
        <Collapsible label="See it on a body" sub="Show" variant="inline" className="mt-2">
          <MuscleMap coverage={cov} />
        </Collapsible>
      </Card>

      {/* What a second min-max block adds, since it adds nothing else: no extra sets, no extra
          weeks, no harder RIR. Worth saying plainly on the screen where you accept the block. */}
      {techniques > 0 && (
        <div className="text-[12px] mb-4 leading-snug px-3 py-3"
          style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface2))', color: 'var(--text2)' }}>
          {techniques} {techniques === 1 ? 'movement finishes' : 'movements finish'} with an intensity technique on the last set - drop sets, myo-reps, partials past the point the set would have ended. That is what this block adds over the last one: the volume and the weeks are the same.
        </div>
      )}

      {/* Slots the programme deliberately left open. A written plan that says "Squat (Your Choice)"
          and lists six of them is not being vague: it is saying this slot is about the pattern, and
          the gym you are standing in decides the rest. So the slot survives the import and gets
          asked once, here, before the block starts - and picking moves every week of the block at
          once, because a programme that squats in week one and hack squats in week four is not the
          programme. */}
      {choices.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="pf text-[11px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Your call</div>
          <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
            {choices.length === 1 ? 'One movement in this plan is' : choices.length + ' movements in this plan are'} left up to you. Pick a default here - you can switch at each workout.
          </div>
          {choices.map(c => (
            <div key={c.key} className="mb-3">
              <div className="text-[12.5px] font-semibold mb-1">{c.label}</div>
              <div className="text-[11px] mb-2" style={{ color: 'var(--muted2)' }}>{c.sessions.join(', ')}</div>
              <div className="flex gap-2 flex-wrap">
                {c.options.map(id => {
                  const ex = Training.byId(id, t.custom);
                  const on = c.picked === id;
                  return (
                    <button key={id} onClick={() => edit(b => { Training.applyChoice(b, c.key, id); })}
                      className="pixel-box px-2.5 text-[11px]" style={{
                        minHeight: 44,
                        // The picked one wears the app's one "this is the chosen thing" treatment:
                        // the accent as a FILL with --on-accent as its ink, exactly as the picker's
                        // own selected chip does. It used to be a hardcoded #05140a - the DARK
                        // theme's ink - sitting on the light theme's teal, which measured 3.84:1
                        // and is the same fill-instead-of-ink slip design-plans/20-ui-review.md
                        // found on the macro figures.
                        background: on ? 'var(--seg-on)' : 'var(--surface2)',
                        color: on ? 'var(--seg-on-text)' : 'var(--text2)',
                      }}>
                      {ex ? ex.name : id}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* The way back to the programme as it was written. A written plan is the one thing on this
          screen somebody might be nervous about editing, and knowing the original is one tap away is
          what makes editing it feel allowed at all. */}
      {fromProgramme && (
        <button onClick={() => setConfirmReset(true)} className="w-full text-[12px] mb-4 py-2 text-left" style={{ color: 'var(--link)' }}>
          Start again from {fromProgramme.name} as written
        </button>
      )}

      {/* ---- how many days a week ---------------------------------------------------------------
          The one answer from the build wizard that used to be final. Every other thing on this
          screen can be changed after the fact, and the day count - the answer most likely to go out
          of date, because it is about your week rather than your training - sent you back to build
          the block again from scratch.

          It sits directly above the day cards it adds to and takes from, so the change lands in
          your reading order rather than three screens away, and it behaves like the other change
          control on this page: applied straight away, with a receipt naming every session that
          arrived or left, and one tap to put it back. Nothing here is written until the button at
          the bottom of the page says so. */}
      <Card className="p-4 mb-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="pf text-[11px] uppercase" style={{ color: 'var(--accent-ink)' }}>Days a week</div>
          <div className="text-[11px] tnum" style={{ color: 'var(--muted)' }}>
            {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} in week {week}
          </div>
        </div>
        <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
          {Training.prescribesDays(block)
            ? 'The days you have are kept as they are. Going up adds the session this week is missing; going down takes days off the end. Min-max prescribes its own week, so the rest days move with the count.'
            : 'The days you have are kept as they are - same movements, same sets, same weekdays. Going up adds the session this week is missing; going down takes days off the end.'}
          {prog && prog.week > 1 ? ' Weeks you have already trained are left exactly as they were.' : ''}
        </div>
        <Seg value={dayCount} onChange={applyDays} options={[2, 3, 4, 5, 6].map(n => ({ v: n, l: String(n) }))} />
        {/* The receipt. A day count is one tap and up to six weeks of sessions, so "5" going bold is
            not an answer to what just happened to the plan. */}
        {daysResult && (
          <div className="mt-3 pt-3" style={{ borderTop: '2px solid var(--border)' }}>
            <div className="text-[12px] leading-snug" style={{ color: 'var(--text2)' }}>{daysResult.text}</div>
            <Btn kind="ghost" onClick={undoDays} className="w-full mt-2">
              Put it back to {daysResult.was} days
            </Btn>
          </div>
        )}
      </Card>

      {/* Day cards, in the same language as the session screen: the coach's letter code, the
          movement, then sets / reps / tempo on one line. Reading the plan and running the plan
          should not look like two different apps. */}
      {/* Two-up rather than a full-width stack: a session summary is a name, a day and a count -
          three short facts that do not need the whole width - and a five-day block ran five cards
          deep before you reached the save buttons. Tapping either card opens its detail full-width
          below the grid, since a half-width column is nowhere to put a set stepper. */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {sessions.map(s => {
          const ordered = s.exercises.slice().sort((a, b) => a.order - b.order);
          const log = logBySession[s.id];
          const open = openDay === s.id;
          return (
            <button key={s.id} onClick={() => setOpenDay(open ? null : s.id)}
              className="pixel-box p-3 text-left" style={{ background: open ? 'color-mix(in srgb, var(--accent) 14%, var(--card))' : 'var(--card)' }}>
              <span className="flex items-start justify-between gap-1.5">
                <span className="block text-[13px] font-bold leading-tight">{s.name}</span>
                {log && (comp.openBySession[s.id]
                  ? <span className="shrink-0 pf text-[11px]" style={{ color: 'var(--warn)' }}>Open</span>
                  : <span className="shrink-0 w-5 h-5 flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}><Tick size={10} /></span>)}
              </span>
              <span className="block text-[11px] mt-1.5" style={{ color: 'var(--muted)' }}>
                {WEEKDAYS[s.dayOfWeek] || 'Day ' + (s.dayOfWeek + 1)} · {ordered.length} mv · {ordered.reduce((a, e) => a + e.target.sets, 0)} sets
              </span>
            </button>
          );
        })}
      </div>

      {sessions.filter(s => openDay === s.id).map(s => {
        const base = s.exercises.slice().sort((a, b) => a.order - b.order);
        const byKey = {};
        base.forEach(e => { byKey[e.id] = e; });
        // The drag preview, so the day reshuffles under the finger. It is the saved order otherwise.
        const ordered = dnd.order.map(k => byKey[k]).filter(Boolean);
        const codes = Training.sessionCodes(ordered.map(e => ({ superset: e.supersetGroup || null })));
        const log = logBySession[s.id];
        const open = true;
        return (
          <div key={s.id} className="pixel-box mb-4" style={{ background: 'var(--card)' }}>
            <div className="w-full flex items-center gap-2 p-4 text-left">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold leading-tight">{s.name}</span>
                <span className="block text-[11px] mt-2" style={{ color: 'var(--muted)' }}>
                  {WEEKDAYS[s.dayOfWeek] || 'Day ' + (s.dayOfWeek + 1)} · {ordered.length} movements · {ordered.reduce((a, e) => a + e.target.sets, 0)} sets
                </span>
              </span>
              <button onClick={() => setOpenDay(null)} aria-label="Close" className="shrink-0 hit" style={{ color: 'var(--muted2)' }}>
                <Icon.chevron width="16" height="16" style={{ transform: 'rotate(90deg)' }} />
              </button>
            </div>

            {open && (
              <div className="px-4 pb-4">
                {ordered.map((it, ei) => { const rp = dnd.rowProps(it.id); return (
                  <div key={it.id} ref={rp.ref} data-drag-id={rp['data-drag-id']} onPointerDown={rp.onPointerDown} className="py-3"
                    style={Object.assign({ borderTop: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)' }, rp.style)}>
                    <div className="flex items-start gap-2">
                      <DragHandle dnd={dnd} id={it.id} label={(Training.byId(it.exerciseId, t.custom) || {}).name}
                        onTap={() => setPicking({ sessionId: s.id, itemId: it.id })} />
                      <span className="pf text-[11px] shrink-0 mt-0.5 w-6" style={{ color: 'var(--accent-ink)' }}>{codes[ei]}</span>
                      <button onClick={() => setPicking({ sessionId: s.id, itemId: it.id })}
                        aria-label={'Replace ' + ((Training.byId(it.exerciseId, t.custom) || {}).name || 'this movement')}
                        className="flex-1 min-w-0 text-left text-[13px] font-semibold leading-tight">
                        <span className="block min-w-0">
                          <ExerciseName id={it.exerciseId} custom={t.custom} />
                          {it.choice && (
                            <span className="pf text-[11px] uppercase ml-1.5 px-1 py-0.5 align-middle"
                              style={{ border: '1px solid var(--accent)', color: 'var(--accent-ink)', letterSpacing: '0.08em' }}>Your call</span>
                          )}
                          {/* Replaced, and by whose hand. Without this a block you edited three weeks
                              ago reads exactly like one you did not, and the movement the programme
                              actually asked for is nowhere on the screen. */}
                          {it.baseExerciseId && (
                            <span className="block text-[11px] font-normal mt-1" style={{ color: 'var(--muted2)' }}>
                              instead of <ExerciseName id={it.baseExerciseId} custom={t.custom} />
                            </span>
                          )}
                        </span>
                      </button>
                      <button onClick={() => removeItem(s.id, it.id)} aria-label="Remove" className="px-1 text-[15px] shrink-0" style={{ color: 'var(--muted2)' }}>&times;</button>
                    </div>
                    <div className="flex items-center gap-2 mt-2" style={{ paddingLeft: 84 }}>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setSets(s.id, it.id, -1)} className="pixel-box w-7 h-7 text-[13px]" style={{ background: 'var(--surface2)' }}>-</button>
                        <div className="w-14 text-center text-[11px] tnum" style={{ color: 'var(--muted)' }}>{it.target.sets} sets</div>
                        <button onClick={() => setSets(s.id, it.id, 1)} className="pixel-box w-7 h-7 text-[13px]" style={{ background: 'var(--surface2)' }}>+</button>
                      </div>
                      <div className="flex-1 flex items-baseline justify-end gap-3 text-[11px] tnum" style={{ color: 'var(--muted)' }}>
                        <span>{Training.repLabel(it.target)} reps</span>
                        <span>{it.target.tempo || '2010'} tempo</span>
                      </div>
                    </div>
                  </div>
                ); })}
                <div className="text-[11px] mt-3 leading-snug" style={{ color: 'var(--muted2)' }}>
                  Hold a movement and drag it to reorder it, in every week from this one. Tap a movement to replace it, wherever it appears in the block{prog && prog.week > 1 ? '. Weeks you have trained stay as they were' : ''}.
                </div>
                <button onClick={() => setPicking({ sessionId: s.id })} className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add movement</button>
                {/* A session with a log against it used to lose this button altogether, which meant
                    the one screen that could put you back into a session you had walked out of was
                    the one screen that hid the way in. Started-and-not-finished carries on; finished
                    can be run again, and says so rather than pretending it cannot be. */}
                {onStart && (
                  <button onClick={() => { if (dirty) save(false, true); onStart(s, block); }} className="pixel-btn w-full h-12 font-bold mt-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                    {!log ? 'Start this session' : liveLog(log, Store.todayISO()) ? 'Carry on with it' : log.dateISO === Store.todayISO() ? 'Open today\u2019s session' : 'Do this session again'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Sharing publishes ONE WEEK, not your logged sessions and nothing about you. Worth saying
          plainly right next to the switch, because "share my block" could reasonably be read as
          "share my training diary". */}
      <button onClick={() => setShare(!share)} className="w-full flex items-center justify-between gap-3 pixel-box p-4 mb-4 text-left" style={{ background: 'var(--card)' }}>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">Share this programme</span>
          <span className="block text-[12px] mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>
            Puts the plan in the library for other members to run. Your sessions, weights and name stay private.
          </span>
        </span>
        <span className="pf text-[11px] px-3 py-2 shrink-0" style={{ background: share ? 'var(--accent)' : 'var(--surface3)', color: share ? 'var(--on-accent)' : 'var(--muted)', border: '2px solid var(--border)' }}>
          {share ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* ---- the commit, in the flow at the end of the block rather than floating over it ----
          A pinned bar is right for a screen with one action and a short page. This screen is neither:
          it is a block you read down - name, volume, every day - and deciding at the end is the whole
          shape of it. Pinned, the loudest thing on screen was permanently "Start it now" sitting on
          top of the block you had not finished reading, and because the bar reserved no space it
          covered the last day card as well.

          Two exits on a new block, because building one and beginning one are separate decisions:
          keeping it is the quieter of the two and sits on the left. */}
      <div className="mt-5">
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
          <button onClick={() => save(false)} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Save changes
          </button>
        )}
        <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--muted)' }}>
          {isNew
            ? 'Saving for later puts it on your shelf without starting it. Nothing is running until you say so.'
            : 'Changes apply to the weeks you have not trained yet. Sessions you already logged stay as they were.'}
        </div>
      </div>

      {confirmLeave && (
        <ConfirmDialog title={isNew ? 'Throw this programme away?' : 'Leave without saving?'}
          body={isNew
            ? 'It has not been saved yet, so leaving loses it. "Save for later" puts it on your shelf without starting it.'
            : 'The changes you have made to this programme have not been written yet. Leaving now loses them.'}
          confirmLabel={isNew ? 'Throw it away' : 'Discard changes'} confirmKind="danger"
          onConfirm={onBack} onClose={() => setConfirmLeave(false)} />
      )}

      {/* Deleting is not one of the two things above, so it does not sit against them: a tap that
          lands one row low on "Save changes" must not find "Delete". Ruled off and quiet, at the end. */}
      {!isNew && (
        <div className="mt-8 pt-4 text-center" style={{ borderTop: '2px solid var(--border)' }}>
          <button onClick={() => setConfirmDelete(true)} className="py-2 text-[12px]" style={{ color: 'var(--danger)' }}>Delete this programme</button>
        </div>
      )}

      {picking && (() => {
        const s0 = picking.itemId && (block.sessions || []).filter(x => x.id === picking.sessionId)[0];
        const row = (s0 && (s0.exercises || []).filter(x => x.id === picking.itemId)[0]) || null;
        const sameDay = s0 ? (s0.exercises || []).map(x => x.exerciseId) : [];
        return (
          <ExercisePicker db={db} update={update}
            title={row ? 'Replace movement' : 'Add a movement'}
            basedOn={row ? row.exerciseId : null}
            offer={row ? Training.replacementsFor(row, {
              style: block.style, custom: t.custom,
              equipment: t.prefs.equipment, dislikes: t.prefs.dislikes,
              currentExerciseIds: sameDay,
            }) : null}
            onPick={(id) => (row ? replaceItem(picking.sessionId, picking.itemId, id) : addItem(picking.sessionId, id))}
            onClose={() => setPicking(null)} />
        );
      })()}
      {confirmDelete && <ConfirmDialog title="Delete this programme?" body="The sessions you already logged are kept. Only the plan goes."
        onConfirm={remove} onClose={() => setConfirmDelete(false)} />}
      {confirmReset && fromProgramme && (
        <ConfirmDialog title={'Back to ' + fromProgramme.name + '?'}
          body="Every change you have made to this programme goes, and it comes back exactly as the programme is written. Nothing that is saved or logged is touched."
          confirmLabel="Start again" confirmKind="danger"
          onConfirm={resetToProgramme} onClose={() => setConfirmReset(false)} />
      )}
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
  // The room you train in. Its machines are shown in place of the plan's, without touching the plan.
  const gymNow = currentGym(db);
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
  // The most recent log against this session, and whether it is one you are still IN. The screen
  // used to take any log at all as "carry on where you left off" and then hand you a brand-new empty
  // session for today, because the runner only ever resumes a log from today. Two different things,
  // said as two different things.
  const log = t.logs.filter(l => l.sessionId === live.id).slice().sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1))[0];
  const openNow = liveLog(log, Store.todayISO());              // started today, not finished
  const sameDay = !!(log && log.dateISO === Store.todayISO()); // today's, finished or not: the button edits it
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

  // Rows are picked up and put down where you want them. The order on screen is the order the session
  // runs in, so what you drag is what you will do. A superset pair moves as one.
  const dnd = useDragList({
    ids: items.map(it => it.id),
    onDrop: (id, to) => edit(s => Training.moveExerciseTo(s, id, to)),
    unitOf: (id) => (items.filter(x => x.id === id)[0] || {}).supersetGroup || null,
    disabled: !editable || !!menuFor || !!tuning || !!picking || !!swapScope || dayPick,
  });

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
      // The row that was tapped, across the weeks ahead - not every row holding the same movement.
      // Same reason as the block screen: a day can write the same lift twice, and a split can write
      // the same day twice.
      if (scope === 'block') Training.swapSlotInBlock(b, live.id, itemId, exId, prog ? prog.week : 1);
      else {
        const it = (s.exercises || []).filter(x => x.id === itemId)[0];
        if (it) Training.replaceExercise(it, exId);
      }
    });
    const to = Training.byId(exId, t.custom);
    if (showToast) showToast(scope === 'block' ? 'Swapped for the rest of the programme.' : (to ? to.name : 'Swapped') + ' for this session.');
  }

  // Answering an "or" line from the session screen. From this week on, and every day that shares the
  // question, because that is what the author asked - see Training.applyChoiceFrom.
  function pickChoice(it, exId) {
    if (!it || !it.choice) return;
    edit((s, b) => { Training.applyChoiceFrom(b, it.choice.key, exId, live.week || 1); });
    const to = Training.byId(exId, t.custom);
    if (showToast) showToast((to ? to.name : 'That') + ' from now on. Switch back here any time.');
  }

  const item = menuFor ? items.filter(x => x.id === menuFor)[0] : null;
  const itemIndex = item ? items.indexOf(item) : -1;
  const itemEx = item ? Training.byId(item.exerciseId, t.custom) : null;
  const tuneRow = tuning ? items.filter(x => x.id === tuning)[0] : null;

  // One body, wherever a movement lives, so a main lift opened as a full card and an accessory read
  // as a single line still say the same things about themselves in the same words.
  function movementBody(it, code) {
    const useId = Training.atGym(it.exerciseId, gymNow, t.custom);
    const ex = Training.byId(useId, t.custom);
    // A grip you have never used has no history of its own, and a blank row on the way into a
    // session is worse than useless when the number you want is sitting under the movement it
    // came from. Borrowed numbers say whose they are; the personal best stays per lift.
    const ref = Training.lastReference(t.logs, useId, Store.todayISO(), t.custom);
    const last = ref && ref.best;
    const refFrom = ref && ref.borrowed ? (Training.byId(ref.fromId, t.custom) || {}).name : null;
    return (
      <>
        <span className="pf text-[11px] shrink-0 w-6 mt-0.5" style={{ color: 'var(--accent-ink)' }}>{code}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold leading-tight">{ex ? ex.name : it.exerciseId}</span>
          <span className="block text-[11px] tnum mt-1" style={{ color: 'var(--muted)' }}>
            {it.target.sets} x {Training.repLabel(it.target)} &middot; {it.target.rir} RIR
            {it.target.tempo ? ' · ' + it.target.tempo + ' tempo' : ''}
          </span>
          {useId !== it.exerciseId && (
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted2)' }}>
              for {(Training.byId(it.exerciseId, t.custom) || {}).name || 'the plan'}, at {gymNow.name}
            </span>
          )}
          {/* What you did last time is the number you actually want before you set off. */}
          {it.baseExerciseId && (
            <span className="block text-[11px] mt-0.5" style={{ color: 'var(--muted2)' }}>
              instead of {(Training.byId(it.baseExerciseId, t.custom) || {}).name || 'what the plan said'}
            </span>
          )}
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
  }
  // The one-line form an accessory takes: name, and its prescription as a chip. Eight heavy boxed
  // cards read as eight decisions; five accessory ROWS read as a list you skim once and trust, which
  // is closer to how anybody actually treats the last five things on a leg day.
  function accessoryRow(it) {
    const ex = Training.byId(Training.atGym(it.exerciseId, gymNow, t.custom), t.custom);
    return (
      <span className="flex items-center justify-between gap-3 min-w-0 flex-1">
        <span className="min-w-0 truncate text-[13px] font-semibold">{ex ? ex.name : it.exerciseId}</span>
        <span className="pf text-[11px] tnum shrink-0 px-2 py-1" style={{ border: '2px solid var(--border)', background: 'var(--surface2)' }}>
          {it.target.sets} x {Training.repLabel(it.target)}
        </span>
      </span>
    );
  }

  return (
    <div className="fade-in pb-2">
      <SubHeader back={onBack} backLabel="Train" title={live.name} />
      <div className="text-[13px] mb-1" style={{ color: 'var(--muted)', fontWeight: 600 }}>
        {live.focus ? live.focus + ' · ' : ''}{prog ? 'Week ' + prog.week + ' of ' + block.weeks : 'Tonight'}
      </div>
      <div className="text-[12px] mb-4 tnum" style={{ color: 'var(--muted)' }}>
        {items.length} movements &middot; {sets} sets &middot; about {mins} min
        {live.deload ? ' · deload week' : ''}
      </div>

      {/* The day, and a tap to move it, as one line under the header rather than its own tappable
          panel above the content people came to read. Real weeks do not run in order: the gym is
          shut, Wednesday moved, legs went to Thursday. Moving it changes THIS week only, because
          every week carries its own copy. */}
      {editable && (
        <div className="text-[12px] mb-4" style={{ color: 'var(--muted)' }}>
          {WEEKDAYS_FULL[live.dayOfWeek] || 'Not set'} · this week only ·{' '}
          <button onClick={() => setDayPick(true)} className="hit" style={{ color: 'var(--link)' }}>move ›</button>
        </div>
      )}

      {log && (
        <Card className="p-4 mb-4" style={{ background: 'color-mix(in srgb, var(--good) 12%, var(--surface2))' }}>
          <div className="text-[12px] leading-snug">
            You logged this one {relativeDay(log.dateISO, Store.todayISO()).toLowerCase()}, {(log.sets || []).filter(s => s.done).length} sets.{' '}
            {openNow
              ? 'It is still open, so this picks up exactly where you left off.'
              : sameDay
                ? 'Opening it again goes back into today\u2019s session, so you can correct it or add to it.'
                : 'Starting it now logs a new session against today. To change that one, open it from History.'}
          </div>
        </Card>
      )}

      {/* The page's one action, above the fold. It used to sit below every movement card, so on an
          eight-movement day you scrolled the whole session to reach the button that starts it - the
          thing most people open this screen to do. */}
      <button onClick={onStart} className="pixel-btn w-full h-14 font-bold mb-5" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
        <Icon.play width="16" /> {openNow ? 'Carry on with it' : sameDay ? 'Open today\u2019s session' : log ? 'Do it again' : 'Start ' + live.name.split(' - ')[0]}
      </button>

      {/* ONE list, in the order the session runs. It used to be split into main lifts and accessories,
          which is a tidy picture of the session and not the session: an accessory you had put first
          still sat under the heading for the heavy ones, so what you saw was not the order you were
          trying to change. Heavy lifts keep their full row and accessories their one line, in
          whatever order they actually fall. */}
      {(() => {
        const byId = {};
        items.forEach(it => { byId[it.id] = it; });
        const shown = dnd.order.map(id => byId[id]).filter(Boolean);
        // Lettered by where the row is NOW, so the codes follow it as it moves under your finger.
        const live = Training.sessionCodes(shown.map(it => ({ superset: it.supersetGroup || null })));
        return (
          <Card className="p-0 mb-3 overflow-hidden">
            {shown.map((it, i) => {
              const ex = Training.byId(it.exerciseId, t.custom);
              const acc = Training.roleOf(ex) === 'accessory';
              const name = ex ? ex.name : 'this movement';
              const body = acc
                ? <><span className="pf text-[11px] shrink-0 w-6" style={{ color: 'var(--accent-ink)' }}>{live[i]}</span>{accessoryRow(it)}</>
                : movementBody(it, live[i]);
              const rule = i ? { borderTop: '2px solid var(--border)' } : null;
              if (!editable) {
                return <div key={it.id || i} className="px-4 py-3 flex items-start gap-3" style={rule}>{body}</div>;
              }
              const rp = dnd.rowProps(it.id);
              // An "or" line carries its options on the row, so the call is made here, on the way
              // into the session, rather than three screens back in the builder.
              const toggle = it.choice ? <ChoiceToggle item={it} custom={t.custom} onPick={(id) => pickChoice(it, id)} /> : null;
              return (
                <div key={it.id || i} ref={rp.ref} data-drag-id={rp['data-drag-id']} onPointerDown={rp.onPointerDown}
                  style={Object.assign({ background: 'var(--card)' }, rp.style, rule)}>
                  <div className="flex items-stretch">
                    <button onClick={() => { if (dnd.justDropped()) return; setMenuFor(it.id); }}
                      aria-label={'Change ' + name}
                      className={'flex-1 min-w-0 text-left pl-4 py-3 flex gap-3 ' + (acc ? 'items-center' : 'items-start')}>
                      {body}
                    </button>
                    <DragHandle dnd={dnd} id={it.id} label={name} onTap={() => setMenuFor(it.id)} />
                  </div>
                  {toggle && <div className="pl-[52px] pr-4 pb-3 -mt-1">{toggle}</div>}
                </div>
              );
            })}
          </Card>
        );
      })()}

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
          <div className="text-[11px] leading-snug mb-4 text-center" style={{ color: 'var(--muted)' }}>
            {log
              ? 'Tap a movement to change it, or hold and drag to reorder. You already logged this one, so edits change the plan for the week rather than what you did.'
              : 'Hold a movement and drag it to reorder, or grab the dots. Tap one to replace it, change its sets and reps or take it out. Everything saves as you go, applies to this week, and none of it starts a session.'}
          </div>
        </>
      )}

      {/* One movement's options. Same sheet, same order, same words as the session player's, because
          it is the same job asked in a different room. */}
      {item && (
        <ActionSheet kicker="Movement" title={itemEx ? itemEx.name : 'This movement'} onClose={() => setMenuFor(null)}
          actions={[
            { label: 'Replace it', sub: 'Something else that trains the same thing', onClick: () => setPicking({ mode: 'swap', itemId: item.id }) },
            { label: 'Sets and reps', sub: item.target.sets + ' x ' + Training.repLabel(item.target) + ' at ' + item.target.rir + ' RIR', onClick: () => setTuning(item.id) },
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
            { label: 'Move to the top', disabled: itemIndex <= 0, keepOpen: true, onClick: () => edit(s => Training.moveExerciseTo(s, item.id, 0)) },
            { label: 'Move to the bottom', disabled: itemIndex < 0 || itemIndex >= items.length - 1, keepOpen: true, onClick: () => edit(s => Training.moveExerciseTo(s, item.id, items.length)) },
            { label: 'Take it out', danger: true, sub: 'You can undo this', onClick: () => removeItem(item.id) },
          ]} />
      )}

      {tuneRow && <TargetSheet row={tuneRow} name={(Training.byId(tuneRow.exerciseId, t.custom) || {}).name}
        onChange={patch => edit(s => Training.setExerciseTarget(s, tuneRow.id, patch))}
        onClose={() => setTuning(null)} />}

      {picking && (
        <ExercisePicker db={db} update={update}
          title={picking.mode === 'swap' ? 'Replace movement' : 'Add a movement'}
          basedOn={picking.mode === 'swap' ? (items.filter(x => x.id === picking.itemId)[0] || {}).exerciseId : null}
          offer={picking.mode === 'swap' ? Training.replacementsFor(items.filter(x => x.id === picking.itemId)[0] || {}, {
            style: block && block.style, custom: t.custom,
            equipment: t.prefs.equipment, dislikes: t.prefs.dislikes,
            currentExerciseIds: items.map(x => x.exerciseId),
          }) : null}
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
            const reach = block ? Training.slotReach(block, live.id, row.id, prog ? prog.week : 1) : 1;
            const offer = gymOffer(gymNow, row.exerciseId, exId, t.custom);
            if (reach > 1 || offer) setSwapScope({ exId, reach, itemId: row.id, fromId: row.exerciseId, offer });
            else doSwap(row.id, row.exerciseId, exId, 'session');
          }}
          onClose={() => setPicking(null)} />
      )}

      {swapScope && (() => {
        const from = Training.byId(swapScope.fromId, t.custom);
        const to = Training.byId(swapScope.exId, t.custom);
        const sc = swapScope;
        return (
          <ActionSheet kicker="Replace" title={(to ? to.name : 'That') + ' instead of ' + (from ? from.name : 'it')}
            onClose={() => setSwapScope(null)}
            actions={[
              { label: 'Just this session', sub: 'The rest of the programme keeps ' + (from ? from.name : 'the original'),
                onClick: () => doSwap(sc.itemId, sc.fromId, sc.exId, 'session') },
              sc.offer && { label: 'Always at ' + gymNow.name,
                sub: 'Any plan that asks for ' + (from ? from.name : 'it') + ' gets ' + (to ? to.name : 'this') + ' here. The programme itself is not changed.',
                onClick: () => {
                  rememberAtGym(update, gymNow.id, sc.fromId, sc.exId);
                  if (showToast) showToast((to ? to.name : 'It') + ' is your ' + (from ? from.name : 'machine') + ' at ' + gymNow.name + ' now.');
                } },
              sc.reach > 1 && { label: 'The rest of the programme',
                sub: 'Changes ' + sc.reach + ' sessions from this week on. Weeks you have trained stay as they were.',
                onClick: () => doSwap(sc.itemId, sc.fromId, sc.exId, 'block') },
            ]} />
        );
      })()}

      {dayPick && (
        <ActionSheet kicker="Move to" title={'Which day is ' + live.name + '?'} onClose={() => setDayPick(false)}
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
        <div className="pf text-[11px] mb-1">Sets and reps</div>
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
        {/* Two steppers where a movement runs a pair, one where it does not. A block written to take
            its LAST set to failure and the ones before it a rep short cannot say so through a single
            number, so a movement added by hand to such a block silently prescribed something else -
            the one thing the editor could not express was the thing the block was built on. */}
        {t.rirLast == null ? (
          <Stepper label="RIR" value={t.rir} sub="Reps you leave in the tank"
            atMin={t.rir <= 0} atMax={t.rir >= Training.RIR_MAX}
            onMinus={() => onChange({ rir: t.rir - 1 })} onPlus={() => onChange({ rir: t.rir + 1 })} />
        ) : (
          <React.Fragment>
            <Stepper label="RIR, earlier sets" value={t.rir} sub={t.sets > 1 ? 'Reps left on the sets before the last one' : 'Not used: this movement is one set'}
              atMin={t.rir <= 0} atMax={t.rir >= Training.RIR_MAX}
              onMinus={() => onChange({ rir: t.rir - 1 })} onPlus={() => onChange({ rir: t.rir + 1 })} />
            <Stepper label="RIR, last set" value={t.rirLast} sub={t.rirLast === 0 ? 'To failure' : 'Reps left when it ends'}
              atMin={t.rirLast <= 0} atMax={t.rirLast >= Training.RIR_MAX}
              onMinus={() => onChange({ rirLast: t.rirLast - 1 })} onPlus={() => onChange({ rirLast: t.rirLast + 1 })} />
          </React.Fragment>
        )}
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
/* ---- WHICH DAYS YOU TRAIN ---------------------------------------------------------------------
 * The plan says what to train and how hard. It has never had a right to say WHEN, and until now it
 * said so anyway: a four-day block landed on Monday to Thursday because that is what the array index
 * did, and somebody who works Tuesdays or plays five-a-side on Thursday had no way to say so short of
 * moving one session, one week at a time, from inside the builder.
 *
 * So this is the one screen in the module that is purely about your calendar. It changes nothing
 * about the programme: same sessions, same order, same volume. What it changes is the gap between
 * them, and that gap is the only thing about a weekday that training cares about - which is why the
 * screen says so out loud rather than implying that Tuesday is a leg day.
 *
 * It writes through `Training.reschedule`, which reaches every week of the block. Setting it on the
 * week in front of you only would undo itself the moment the week turned over, which is the opposite
 * of answering "I train Mondays".
 */
function ScheduleDays({ db, update, showToast, block, fresh, onBack }) {
  const today = Store.todayISO();
  const rows = Training.scheduleOf(block, today);
  const need = rows.length;
  /* Tap the days you can train; the sessions fill in, in order (design: Train: programmes and
     community, screen 5). It used to be a seven-button row for EVERY session - five rows of seven
     for a five-day plan - to answer what is really one question: which days are yours. */
  const initial = Array.from(new Set(rows.map(r => r.dayOfWeek))).sort((x, y) => x - y);
  const [chosen, setChosen] = useState(initial);
  const days = chosen.slice().sort((x, y) => x - y);
  const ready = days.length === need;
  const dows = ready ? days : rows.map(r => r.dayOfWeek);
  // A written programme's own week IS the recommendation: offering a different "week this plan is
  // written for" than the one its author wrote contradicted the plan on its own days screen.
  const prog = block.sourceRef && block.sourceRef.kind === 'programme' ? Training.programmeOf(block.sourceRef.name) : null;
  const written = prog && prog.template.length === need ? prog.template.map(d => d.dayOfWeek).sort((x, y) => x - y) : null;
  const recommended = written || Training.recommendedDows(block, need);
  const ownCadence = Training.prescribesDays(block);
  const dirty = ready && dows.some((d, i) => d !== rows[i].dayOfWeek);
  const isRecommended = recommended.slice().sort((x, y) => x - y).join() === days.join();
  function toggle(d) {
    setChosen(xs => xs.indexOf(d) !== -1 ? xs.filter(x => x !== d) : (xs.length < need ? xs.concat([d]) : xs));
  }
  function save() {
    if (dirty) {
      trainUpdate(update, (tr) => {
        const b = tr.blocks.filter(x => x.id === block.id)[0];
        if (b) Training.reschedule(b, dows, today);
      });
    }
    showToast && showToast(fresh ? 'Your programme is ready. First session is waiting.' : 'Your week is set.');
    onBack();
  }
  const label = (r) => r.name.split(' - ')[0];
  const focusOf = (r) => r.focus || ((block.sessions || []).filter(x => x.id === r.id || x.name === r.name)[0] || {}).focus || null;
  return (
    <div className="fade-in">
      <SubHeader back={onBack} backLabel="Train" title={fresh ? 'Which days?' : 'Your training days'} />
      <p className="text-[15px] leading-snug mb-5">
        Tap the {need} days you can train. The sessions fill in, in order.
      </p>

      <div className="grid gap-1.5 mb-2" role="group" aria-label="Training days" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {WEEKDAYS_FULL.map((full, d) => {
          const on = days.indexOf(d) !== -1;
          return (
            <button key={d} onClick={() => toggle(d)} aria-pressed={on} aria-label={full}
              className="pixel-box text-[15px]" style={{
                minHeight: 48, fontWeight: 700,
                background: on ? 'var(--seg-on)' : 'var(--card)',
                color: on ? 'var(--seg-on-text)' : 'var(--text)',
              }}>
              {(WEEKDAYS[d] || '')[0]}
            </button>
          );
        })}
      </div>
      <div className="text-[13px] mb-5" style={{ color: 'var(--muted)' }}>
        {ready ? 'All ' + need + ' sessions placed.' : 'Pick ' + (need - days.length) + ' more.'}
      </div>

      <Section title="Your week" className="mb-4">
        {WEEKDAYS.map((dow, d) => {
          const at = ready ? days.indexOf(d) : rows.findIndex(r => r.dayOfWeek === d);
          const r = at === -1 ? null : rows[at];
          return (
            <div key={d} className="flex items-center gap-3" style={{ minHeight: 48, borderBottom: '1px solid var(--hairline)' }}>
              <span className="text-[13px] w-9 shrink-0" style={{ color: 'var(--muted)', fontWeight: 600 }}>{dow}</span>
              {r
                ? <span className="text-[15px] min-w-0 truncate" style={{ fontWeight: 600 }}>{label(r)}{focusOf(r) ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {focusOf(r)}</span> : null}</span>
                : <span className="text-[15px]" style={{ color: 'var(--muted)' }}>Rest</span>}
            </div>
          );
        })}
      </Section>

      {!isRecommended && (
        <button onClick={() => setChosen(recommended.slice())} className="w-full text-[13px] mb-2" style={{ color: 'var(--link)', fontWeight: 600, minHeight: 44 }}>
          {written || ownCadence ? 'Back to the week this plan is written for' : 'Use the week we recommend'}
        </button>
      )}
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
        {written
          ? 'This programme is written around ' + recommended.map(d => WEEKDAYS[d]).join(', ') + '. Move it to suit your week; the order of the sessions stays the same.'
          : ownCadence
          ? 'This plan is written around ' + recommended.map(d => WEEKDAYS[d]).join(', ') + ': training everything to failure needs the day off in the middle. You can still move it.'
          : 'We suggest ' + recommended.map(d => WEEKDAYS[d]).join(', ') + ': a break in the middle of the week rather than every rest day stacked at the end of it.'}
      </div>

      {/* On a brand new programme this is the way OUT, so confirming the default is always a real
          answer. On one already running there is nothing to commit until something changes. */}
      <Btn className="w-full" onClick={save} disabled={!ready || (!dirty && !fresh)}
        style={!ready || (!dirty && !fresh) ? { background: 'var(--sunk)', color: 'var(--muted)' } : null}>
        {!ready ? 'Pick ' + (need - days.length) + ' more ' + (need - days.length === 1 ? 'day' : 'days')
          : fresh ? 'Start ' + block.name : dirty ? 'Save these days' : 'Nothing to change'}
      </Btn>
      <div className="text-[12px] mt-3 leading-snug" style={{ color: 'var(--muted)' }}>
        This sets every week of {block.name}. To move one session in one week only, open that day from
        the week and change it there.
      </div>
    </div>
  );
}
