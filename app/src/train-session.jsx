/* ---- train session ----------------------------------------------------------------------
 * running a session, and everything you reach for while you are in one
 *
 * Part of the Train module, which was one 6,200-line file. The sources have no imports:
 * build.mjs concatenates them in the order given by app/src/manifest.json and hands the lot
 * to Babel, so everything here shares one scope with the rest of the app. Function
 * declarations hoist across the whole bundle, which is why these files can call each other
 * freely; module-level `const` does not, so anything declared with one has to appear before
 * the code that reads it AT MODULE SCOPE. Nothing here does, but that is the rule.
 * ------------------------------------------------------------------------------------- */
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

/* Where to go once a movement is finished: the next one with work left in it, wrapping to the start.
 *
 * NOT the next one along. Sessions get done out of order - a rack is busy, so you take the accessory
 * first, or you jump to the thing by the door before somebody else does - and advancing blindly to
 * `from + 1` lands you on a card of ticks you already filled, with the movement you actually have
 * left further down and nothing saying so. Wraps because "out of order" cuts both ways: finish the
 * fourth movement first and everything still to do is ABOVE you.
 *
 * Its own function so the rule can be tested. Inside the tick handler it sits behind a 450ms timer
 * that lets the tick animation land, and a timer is not where a decision should be kept. */
/* One movement's logged sets, written the way a lifter writes them.
 *
 * Set by set it came out as "62.5kg x 10 · 62.5kg x 10 · 62.5kg x 9 · 62.5kg x 9", which says the
 * weight four times to tell you one thing: you did 62.5 for 10, 10, 9 and 9. Straight sets are the
 * normal case, so the normal case was the longest possible way of putting it - and length is what
 * broke the receipt row it sat in. Runs at the same weight collapse to one weight and their reps;
 * a change of weight starts a new run, because that IS the news.
 *
 * `fmt` formats a weight, so the caller keeps ownership of units.
 */
function setsSummary(sets, fmt) {
  const runs = [];
  (sets || []).forEach(s => {
    // Rounded to the precision the receipt prints at. Strict float equality split a run whose two
    // weights differed in the last decimal - a pound entry round-tripped through the converter - and
    // then printed both halves identically, so the grouping looked broken.
    const kg = +s.weightKg > 0 ? Math.round(+s.weightKg * 100) / 100 : 0;
    const reps = s.reps == null ? '\u2013' : s.reps;
    const last = runs[runs.length - 1];
    if (last && last.kg === kg) last.reps.push(reps);
    else runs.push({ kg: kg, reps: [reps] });
  });
  return runs.map(r => (r.kg > 0 ? fmt(r.kg) : 'BW') + ' \u00d7 ' + r.reps.join(', ')).join(' \u00b7 ');
}

function nextUnfinished(items, from) {
  const n = (items || []).length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (i === from) break;
    const it = items[i];
    // WORK sets only. Warm-up rows are rarely ticked, so counting them left every movement somebody
    // had added a warm-up to reading as unfinished for ever - and sent both the auto-advance and the
    // rest bar's "next" button to a card of green ticks, which is the exact failure this exists to
    // prevent.
    if (it && it.sets && it.sets.some(s => !s.done && (s.type || 'work') !== 'warmup')) return i;
  }
  return -1;
}

/* `onExit` steps OUT of the session and leaves it open, so the tab can offer it straight back.
   `onFinish` ends it. Two different things, and until now one control did both: leaving threw away
   the record that you were mid-session, which is why walking out to check a macro felt identical to
   giving up on the workout. Everything that genuinely ends a session calls onFinish; everything
   that just leaves the screen calls onExit. */
function SessionPlayer({ db, update, showToast, sessionId, blockId, freeform, openLogId, onExit, onFinish, onFocusMode, gym }) {
  const t = tdb(db);
  const today = Store.todayISO();
  const units = t.prefs.units;
  const block = blockId ? t.blocks.filter(b => b.id === blockId)[0] : null;
  const session = block && sessionId ? (block.sessions || []).filter(s => s.id === sessionId)[0] : null;
  // How this block is meant to be run. On the min-max style there is nothing to leave in the tank,
  // so the screen stops asking for it and starts saying the opposite; and next week's numbers come
  // off the top set rather than off a reps-in-reserve estimate nobody can give at failure anyway.
  const style = Training.styleOf(block && block.style);
  const preOpts = { style: block && block.style };

  // Which log this screen is writing to. Opened from History it is a NAMED one, which is what makes
  // a session from three weeks ago something you can go back into and correct rather than a receipt
  // you can only delete. Opened the ordinary way it is today's log for this session, if there is
  // one, which is how coming back to a session you walked out of resumes it.
  const opened = openLogId ? t.logs.filter(l => l.id === openLogId)[0] : null;
  // Today's log for this session, if there is one: reopening a planned session on the day you ran it
  // is editing that session, not starting a second copy of it. An EMPTY session is the exception -
  // it has no plan to be the same session as, so once one has been finished a new one is a new one
  // rather than the morning's reopening itself.
  const mine = (l) => (sessionId ? l.sessionId === sessionId : (!l.sessionId && !l.endedAt));
  const existing = opened
    || t.logs.filter(l => mine(l) && l.dateISO === today)[0]
    // Still open from last night. `sessionOpen` owns the rule, so the runner, the tab and the
    // history screen all agree on when a session that crossed midnight is still the session.
    || t.logs.filter(l => mine(l) && liveLog(l, today))[0];
  const [logId] = useState(() => (existing ? existing.id : trainUid()));
  // The day the WORK happened, which is only today for a session being run now. Editing Tuesday's
  // session on Friday must not move Tuesday's sets to Friday: every write, every record check and
  // the sign-off all read this rather than the clock.
  const dateISO = existing ? (existing.dateISO || today) : today;
  // Editing a session that is over, as opposed to running one. A session that started last night and
  // is still going is on yesterday's date and is emphatically not being edited after the fact, so it
  // is the log being FINISHED that decides this rather than the date on it.
  const past = dateISO !== today && !liveLog(existing, today);
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
      //
      // And `lastTime` was not rebuilt at all. It is not stored on the log - it is worked out from
      // your history when the session is first laid out - so coming back to a session lost every
      // weight placeholder and every "same as last time" the runner leans on. That is backwards:
      // resuming is the NORMAL way to be in a session, because a phone locks itself between sets,
      // and the state you spend an hour in was the state with the least help in it.
      //
      // Keyed by the LINE, not by the movement. A day that programmes the same movement twice - a
      // heavy row and a back-off row, the ordinary case - would otherwise hand both lines the same
      // list of last week's sets, so the back-off row came back holding the heavy row's weights.
      // Once a tick writes that number into the log (see toggleDone) it stops being a wrong
      // placeholder and becomes wrong data feeding next week's progression.
      const lastFor = {};
      (existing.sets || []).forEach(sx => {
        const key = sx.itemId || sx.exerciseId;
        if (lastFor[key] !== undefined) return;
        // Strictly BEFORE the day being edited, not merely "not that day". Correcting Tuesday's
        // session on Friday was taking Thursday's sets as "last time" and, with the carry-over,
        // writing a later workout backwards into an earlier one.
        const on = existing.dateISO || today;
        const hist = Training.exerciseHistory(t.logs, sx.exerciseId).filter(h => h.dateISO < on);
        const prevDay = hist.length ? hist[hist.length - 1] : null;
        const prevLog = prevDay
          ? t.logs.filter(l => l.dateISO === prevDay.dateISO && l.id !== existing.id)[0]
          : null;
        const rows = prevLog ? (prevLog.sets || []) : [];
        // Prefer the same LINE of that session where the log carries item ids; fall back to the
        // movement for logs written before they existed.
        const byItem = rows.filter(r => r.itemId && sx.itemId && r.itemId === sx.itemId
          && r.done && (!r.type || r.type === 'work'));
        lastFor[key] = byItem.length ? byItem
          : rows.filter(r => r.exerciseId === sx.exerciseId && r.done && (!r.type || r.type === 'work'));
      });
      const order = [], byKey = {};
      (existing.sets || []).forEach(s => {
        const key = s.itemId || s.exerciseId;
        if (!byKey[key]) { byKey[key] = { exerciseId: s.exerciseId, itemId: s.itemId || null, sets: [] }; order.push(key); }
        const prevList = lastFor[key] || [];
        // Indexed by WORK set, because that is what `prevList` holds. Counting every row instead put
        // a movement with three warm-ups three places past the end of the list, so all three of its
        // work sets fell back to last week's final set - the light one on any top-set scheme.
        const workSoFar = byKey[key].sets.filter(x => (x.type || 'work') !== 'warmup').length;
        const prev = (s.type || 'work') === 'warmup' ? null
          : (prevList[workSoFar] || prevList[prevList.length - 1]);
        byKey[key].sets.push(Object.assign({}, s, {
          lastTime: s.lastTime || (prev ? { weightKg: +prev.weightKg || 0, reps: +prev.reps || 0 } : null),
        }));
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
        // Did this line get swapped after the session started? The plan row and the log disagree
        // about the movement exactly when it did.
        const same = !!e && e.exerciseId === g.exerciseId;
        return {
          id: (e && e.id) || g.itemId || null,
          exerciseId: g.exerciseId,
          // The plan first, because that is the live prescription and it may have been edited since.
          // What was saved with the session covers what the plan cannot: a movement added on the day,
          // and a freeform session, which has no plan behind it at all.
          target: (e && e.target) || saved,
          sets: g.sets, note: null,
          superset: (e && e.supersetGroup) || null,
          // Everything the plan knows about this line, carried through the resume. Without it a
          // session picked up halfway offered no substitutions, no way back to the movement the plan
          // asked for, and no technique on the last set - on the sessions somebody is most likely to
          // be standing in a gym looking at.
          // Only when the plan row and the logged row are the same MOVEMENT. They part company the
          // moment somebody swaps one just for the day: the log remembers what was actually lifted
          // and the plan still says what was written, and pinning one's substitutions and coaching
          // note onto the other would attribute an author's words to a movement they never chose.
          // The technique is the exception, because it belongs to the slot rather than to whatever
          // is filling it - a line written to finish with a drop set still does.
          alts: same ? (e.alts || null) : null, choice: same ? (e.choice || null) : null,
          planNote: same ? (e.planNote || null) : null,
          technique: (e && e.technique) || null,
          warmups: e && e.warmups != null ? e.warmups : null,
          baseExerciseId: same ? (e.baseExerciseId || null) : (e ? e.exerciseId : null),
          basePlanNote: same ? (e.basePlanNote || null) : (e && e.planNote) || null,
        };
      });
    }
    if (!session) return [];
    return (session.exercises || []).slice().sort((a, b) => a.order - b.order).map(e => {
      const pre = Training.prefillSets(e, t.logs, t.custom, preOpts);
      return { id: e.id || null, exerciseId: e.exerciseId, target: e.target, sets: pre.sets, note: coachNote(pre), swap: pre.stalled ? e.exerciseId : null,
        choice: e.choice || null, alts: e.alts || null, technique: e.technique || null, planNote: e.planNote || null,
        // What the plan asked for before anybody replaced it, so the picker can offer the way back
        // from inside the gym as well as from the plan.
        baseExerciseId: e.baseExerciseId || null, basePlanNote: e.basePlanNote || null,
        warmups: e.warmups == null ? null : e.warmups, superset: e.supersetGroup || null };
    });
  });
  const [focus, setFocus] = useState(0);
  /* Two refs on the open movement, because "have I lost it" and "take me back to it" are different
     questions about different boxes. The rows are what you LOSE - the card's last hundred pixels are
     a note field and three tools, and counting those as the movement being visible means the bar
     stays quiet at exactly the moment every row has gone. The card is where you want to be RETURNED
     to: land on the rows and you arrive with the movement's name, its prescription and half its sets
     already scrolled past above you. */
  const openRowsRef = useRef(null);
  const openCardRef = useRef(null);
  const barRef = useRef(null);   // the session bar, so the observer measures the chrome rather than assuming it
  const [openOffScreen, setOpenOffScreen] = useState(false);
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
  // The rest clock. Held in component state because it ticks, and mirrored into the store because
  // the player gets unmounted by things that are none of its business - a tab switch, a reload, an
  // update landing - and a countdown you cannot see is not a countdown. Only picked back up if it
  // belongs to THIS session and has not already run out.
  const [rest, setRestState] = useState(() => {
    const saved = t.restRun;
    if (!saved || saved.logId !== logId || !(saved.endsAt > Date.now())) return null;
    return { endsAt: saved.endsAt, seconds: saved.seconds, from: saved.from || null, goIi: saved.goIi == null ? null : saved.goIi, alerted: false };
  });
  function setRest(next) {
    setRestState(prev => {
      const val = typeof next === 'function' ? next(prev) : next;
      // Only when the clock itself changes. `alerted` flips on the second it runs out and is no
      // business of the store's.
      if ((prev && prev.endsAt) !== (val && val.endsAt)) {
        trainUpdate(update, (tr) => {
          // `goIi` rides along: it is what makes the next-up line a button, and a rest that
          // survived a reload came back with a dead line instead of a live one.
          if (val) tr.restRun = { endsAt: val.endsAt, seconds: val.seconds, from: val.from || null, goIi: val.goIi == null ? null : val.goIi, logId: logId };
          else delete tr.restRun;
        });
      }
      return val;
    });
  }
  const [tick, setTick] = useState(0);
  const [notes, setNotes] = useState(existing ? existing.notes || '' : '');
  const [exNotes, setExNotes] = useState(() => (existing && existing.exerciseNotes) || {});
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sessionMenu, setSessionMenu] = useState(false);  // the header's MORE, for the whole session
  const [notesOpen, setNotesOpen] = useState(false);        // the session notes field, off the header
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
        id: logId, dateISO: dateISO,
        blockId: blockId || (existing && existing.blockId) || null,
        sessionId: sessionId || (existing && existing.sessionId) || null,
        name: (session && session.name) || (existing && existing.name) || 'Empty session',
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
      // Every row is rebuilt from scratch here on every edit, so anything not named is lost on the
      // first tap - which is why `id` is spelled out: it is what ties a logged set back to its line
      // in the plan. Everything the PLAN says about a line has to survive the same way. It did not,
      // so ticking a single set quietly took away that line's intensity technique, its coaching
      // note, the substitutions its author wrote against it, and any record of what it was before
      // somebody replaced it. None of that is a property of the sets, and none of it should have
      // depended on whether you had touched them yet.
      const next = prev.map(it => ({
        id: it.id || null, exerciseId: it.exerciseId, target: it.target, note: it.note,
        superset: it.superset, sets: it.sets.map(s => Object.assign({}, s)),
        alts: it.alts || null, choice: it.choice || null, technique: it.technique || null,
        planNote: it.planNote || null, warmups: it.warmups == null ? null : it.warmups,
        swap: it.swap || null,
        baseExerciseId: it.baseExerciseId || null, basePlanNote: it.basePlanNote || null,
      }));
      fn(next);
      persist(next);
      return next;
    });
  }
  /* Is the movement you are ON still on screen?

     Scrolling down to see what is coming is the most common thing anyone does mid-session, and it
     used to cost you the set you were in the middle of: you looked, then scrolled back hunting for
     the card, because nothing pinned said which one it was. A sticky card header would answer it,
     and would also cost 46px on top of the 140px the brand bar and the session bar already hold -
     nearly a quarter of the screen given over to chrome on a phone.

     So nothing new is pinned. The bar that is ALREADY pinned changes what it says: while the open
     card is in view it names the session, and once the card is gone it names the movement instead
     and offers the way back. The spine underneath does not change, so the session-level anchor is
     never lost, and neither reading is ever on screen at the same time as the thing it duplicates.

     The margin is the pinned chrome. Without it the card counts as visible while it sits behind the
     two bars, which is the one position where you can see least and most need telling. */
  useEffect(() => {
    const el = openRowsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOpenOffScreen(false); return; }
    let io = null;
    /* The margin is the pinned chrome, MEASURED. It was hardcoded at 146 - the brand bar plus the
       session bar on a phone - and neither number is fixed: `--appbar-h` is zeroed above 1024px
       where the brand bar is not drawn, and the session bar grows when a title wraps or the
       "Editing" line appears. One constant was wrong in both directions: on a desktop window it
       discounted 69px of plainly visible page and flipped the bar while the set table was still on
       screen; on an edited past session it stayed quiet after the rows had gone. */
    const arm = () => {
      if (io) io.disconnect();
      const appbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--appbar-h')) || 0;
      const bar = barRef.current ? barRef.current.getBoundingClientRect().height : 77;
      io = new IntersectionObserver(
        es => setOpenOffScreen(!es[es.length - 1].isIntersecting),
        { rootMargin: '-' + Math.round(appbar + bar) + 'px 0px 0px 0px', threshold: 0 },
      );
      io.observe(el);
    };
    arm();
    // Crossing the desktop breakpoint in a resized window, or an orientation change, changes the
    // chrome without changing anything this effect depends on.
    window.addEventListener('resize', arm);
    return () => { window.removeEventListener('resize', arm); if (io) io.disconnect(); };
  }, [focus, items.length, past]);
  // Back to the set you are on. Also used when you tap what is next from the rest bar, so "take me
  // there" is one behaviour with one implementation rather than two that drift.
  function scrollToOpen() {
    const el = openCardRef.current;
    if (!el || !el.scrollIntoView) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { el.scrollIntoView(); }
  }
  function goTo(ii) {
    setFocus(ii);
    setPlateFor(null);
    setMenuOpen(null);
    // After the focus change has been painted, or there is nothing at the new position to scroll to.
    setTimeout(scrollToOpen, 60);
  }

  function setField(ii, si, key, value) {
    mutate(n => { n[ii].sets[si][key] = value; });
    // Typing a weight by hand is the moment the warm-up hint has done its job, so it retires itself
    // rather than repeating on all eight movements of every session forever. A hint that outstays
    // the thing it is teaching stops reading as help and starts reading as chrome. The rule itself
    // is written up in "How your plan is built", which is where it lives permanently.
    if (key === 'weightKg' && +value > 0 && !t.prefs.sawWarmupHint) {
      trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { sawWarmupHint: true }); });
    }
  }
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
      // The carry-over above is part of what the set WILL be, so the record check has to see it too.
      // Read from the row alone and a personal best logged by a bare tick went uncelebrated.
      weightKg: (+row.weightKg || 0) || (row.lastTime && +row.lastTime.weightKg > 0 && !wasDone ? +row.lastTime.weightKg : 0),
      reps: (row.reps == null || row.reps === '')
        ? (tgt ? tgt.repHigh : (row.lastTime ? row.lastTime.reps : null))
        : +row.reps,
    };
    mutate(n => {
      const s = n[ii].sets[si];
      s.done = !s.done;
      if (s.done && (s.reps == null || s.reps === '')) s.reps = filled.reps;
      // And the weight, but ONLY from a real last time, and only into the box where you can see it.
      //
      // This is a change of mind, so it is worth saying what changed. The rule was that ticking must
      // never write a weight, because a weight the app invented is a weight you did not lift. That
      // is still true of an invented one. But the box opens EMPTY under the effort-not-load rule, so
      // a tick with nothing typed was logging a set of no weight at all: no tonnage, no e1RM, no
      // record check, a hole in the history that the progression then reads. The set was silently
      // worse than not logged.
      //
      // What is written here is not a prescription and never appears before you act. Nothing is
      // suggested up front, the headline still talks in reps and effort, and this lands only once
      // you have said the set happened - at which point "the same as last time" is the single most
      // likely truth, and it is written into the field in plain sight where one tap corrects it.
      // With no last time there is nothing honest to write, so it stays empty.
      if (s.done && !(+s.weightKg > 0) && s.lastTime && +s.lastTime.weightKg > 0) s.weightKg = +s.lastTime.weightKg;
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
      const best = Training.bestBefore(t.logs, items[ii].exerciseId, dateISO, logId);
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
      // Where it is, as well as what it is called: the line naming your next set is the one thing on
      // this bar you might want to ACT on, and it was text.
      const nextMovement = nextUnfinished(items, ii);
      setRest({
        endsAt: Date.now() + secs * 1000, seconds: secs, alerted: false,
        from: nextPos < 0 ? null : codes[ii] + ' · set ' + (nextPos + 1) + ' of ' + workRows.length,
        goIi: nextPos < 0 ? (nextMovement >= 0 ? nextMovement : null) : ii,
      });
    }
    // Finishing an exercise moves you on, because otherwise you are looking at a card of ticks.
    // Same rule as nextUnfinished: an unticked warm-up is not outstanding work, and treating it as
    // such meant the advance never fired at all on those movements.
    const allDone = it.sets.every((s, i) => (i === si ? true : s.done || (s.type || 'work') === 'warmup'));
    if (allDone) {
      // A distinct double-buzz for finishing a movement, against the single tap for a set. Two
      // different events should never feel like the same event through a pocket, and this is the one
      // that means "that is the last of those, the card is about to change under you".
      try { if (navigator.vibrate) navigator.vibrate([14, 60, 22]); } catch (_) {}
    }
    if (allDone && ii === focus) {
      // The next thing with work left in it, which is not the same as the next one along. Sessions
      // get done out of order - a rack is busy, so you take the accessory first - and advancing
      // blindly to ii + 1 landed you on a card of ticks you had already filled, with the actual next
      // movement further down and nothing saying so.
      const nextUp = nextUnfinished(items, ii);
      // Scrolled to, not just switched to. The next movement with work left can be ABOVE the one you
      // just finished - out-of-order sessions are the reason this wraps - and moving focus there
      // reflows the three bands by hundreds of pixels while you are looking at the bottom of the
      // screen. Landing on it is the difference between the page helping and the page lurching.
      if (nextUp >= 0) setTimeout(() => { setFocus(f => (f === ii ? nextUp : f)); setTimeout(scrollToOpen, 80); }, 450);
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
      const ups = Training.warmupSets((work && work.weightKg) || 0, Training.byId(it.exerciseId, t.custom), { count: it.warmups });
      const rows = ups.map((u, i) => ({ setIndex: i, exerciseId: it.exerciseId, type: 'warmup', weightKg: u.weightKg, reps: null, targetReps: String(u.reps), rir: null, done: false, lastTime: null }));
      it.sets = rows.concat(it.sets.filter(s => (s.type || 'work') !== 'warmup'));
    });
  }
  function addExercise(exId) {
    setPicking(false);
    mutate(n => {
      const fresh = Training.newItemFor(exId, { style: block && block.style, week: (session && session.week) || 1, custom: t.custom });
      const pre = Training.prefillSets({ exerciseId: exId, target: fresh.target }, t.logs, t.custom, preOpts);
      // Added mid-session, so it has no line in the plan to point back to. It gets its own id so
      // its sets still group as one movement when the session is reopened.
      n.push({ id: 'add_' + trainUid(), exerciseId: exId, target: fresh.target, sets: pre.sets, note: coachNote(pre), superset: null });
    });
    setFocus(items.length);
  }
  function removeExercise(ii) {
    mutate(n => { n.splice(ii, 1); });
    setFocus(f => Math.max(0, Math.min(f, items.length - 2)));
  }
  /* One movement becoming another, as a row. Every route that replaces something mid-session builds
     the new row through here, because the row is REBUILT rather than edited - fresh prefilled sets,
     a fresh coach note - and each rebuild used to quietly drop the three fields that make a
     replacement reversible: the author's substitution list, the open slot it belongs to, and which
     movement the plan originally asked for. Losing those meant the picker you had just used could
     not offer you the way back. */
  function replacedRow(old, exId) {
    const pre = Training.prefillSets({ exerciseId: exId, target: old.target || { sets: (old.sets || []).length, repLow: 8, repHigh: 12 } }, t.logs, t.custom, preOpts);
    const row = {
      id: old.id || ('swap_' + trainUid()), exerciseId: old.exerciseId, target: old.target,
      sets: pre.sets, note: coachNote(pre), superset: old.superset,
      alts: old.alts || null, choice: old.choice || null,
      // The technique and the warm-ups belong to the SLOT rather than to whatever is filling it: a
      // block built to finish this line with a drop set still finishes it with a drop set when the
      // machine is busy and you are on the dumbbells instead.
      technique: old.technique || null, warmups: old.warmups == null ? null : old.warmups,
      baseExerciseId: old.baseExerciseId, planNote: old.planNote, basePlanNote: old.basePlanNote,
    };
    // Training owns what a replacement MEANS - what the way back is, and which note stops being
    // true - exactly as it does for a replacement made on the plan rather than in the gym.
    Training.replaceExercise(row, exId);
    return row;
  }
  function swapExercise(ii, exId) {
    const wasId = items[ii] && items[ii].exerciseId;
    mutate(n => { n[ii] = replacedRow(n[ii], exId); });
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
    const log = { id: logId, dateISO: dateISO, sets: items.reduce((a, it) => a.concat(it.sets.filter(s => s.done).map(s => Object.assign({}, s, { exerciseId: it.exerciseId }))), []) };
    // Previous sessions only: prsInLog already excludes this log by id, and the averages must not be
    // dragged toward the session they are being compared against.
    const prior = t.logs.filter(l => l.id !== logId);
    const prs = doneSets ? Training.prsInLog(prior, log) : [];
    const priorTon = prior.map(l => Training.tonnage(l)).filter(v => v > 0);
    // Where today sits in the block's week, counting this session, so "that is the week done" can
    // only fire on the session that actually closed it.
    let weekDone = 0, weekOf = 0, finishedBlock = false;
    if (block) {
      const prog = Training.blockProgress(block, dateISO);
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
      sessionsLast7: prior.filter(l => daysBetween(l.dateISO, dateISO) < 7).length + 1,
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
            ? setsSummary(logged, kg => toDisplayWeight(kg, units) + unitLabel(units))
            : 'not logged',
          logged: logged.length > 0,
        };
      }),
    };
  }

  function finish() {
    const facts = signOffFacts();
    trainUpdate(update, (tr, d) => {
      // The session is over, so the countdown into its next set is too.
      if (tr.restRun && tr.restRun.logId === logId) delete tr.restRun;
      const i = tr.logs.findIndex(l => l.id === logId);
      if (i >= 0) {
        tr.logs[i].endedAt = new Date().toISOString();
        // The sets you did not tick used to be deleted here, which made an accidental Finish - or a
        // set you simply forgot to tick - unrecoverable: the rows were gone, and with them what the
        // session had actually asked for. They stay, unticked. Nothing counts them: every reader of
        // a log, in the engine and on the screens alike, filters on `done`, and now that a finished
        // session can be reopened from History, an untidy row is a set you can go back and tick.
        //
        // Nothing ticked at all is still nothing to keep. Tombstoned, not just spliced: the sync
        // unions training logs by id, so a row merely removed from this copy is handed straight back
        // by the other one and the session returns looking like one you had started.
        if (!(tr.logs[i].sets || []).some(s => s.done)) { tr.logs.splice(i, 1); tombstone(d, [logId]); }
      }
    });
    // An empty session leaves as quietly as it arrived. A real one gets its moment: the buddy, the
    // numbers, and a line about what actually happened, rather than a toast sliding past the button
    // you have just pressed.
    if (!facts.sets) { showToast && showToast('Nothing logged, so nothing saved.'); onFinish(); return; }
    // Correcting a session from last Tuesday is not a session ending, and the buddy congratulating
    // you on a workout you finished a week ago would be nonsense. It saves and gets out of the way.
    if (past) { showToast && showToast('Session updated.'); onFinish(); return; }
    setSignOff(facts);
  }

  const totalSets = items.reduce((a, it) => a + it.sets.filter(s => (s.type || 'work') !== 'warmup').length, 0);
  const doneSets = items.reduce((a, it) => a + it.sets.filter(s => s.done && (s.type || 'work') !== 'warmup').length, 0);
  /* The session as its MOVEMENTS: one cell each, in the order they will be done.
   *
   * Each cell fills left to right with its own sets, so the set you are on is still visible inside
   * the movement you are on - eight cells that each know how far through they are, rather than
   * sixteen that know nothing about which lift they belong to. Warm-ups are left out here exactly as
   * they are left out of both counts. */
  const spine = items.map(it => {
    const w = it.sets.filter(s => (s.type || 'work') !== 'warmup');
    const d = w.filter(s => s.done).length;
    return { total: w.length, done: d, complete: w.length > 0 && d === w.length, frac: w.length ? d / w.length : 0 };
  }).filter(x => x.total > 0);
  // The movement you are ON: the one open in front of you if it still has work in it, and otherwise
  // the first one not finished. When everything is done there is no movement to be on.
  const spineAt = (() => {
    const first = spine.findIndex(x => !x.complete);
    if (first < 0) return -1;
    return (spine[focus] && !spine[focus].complete) ? focus : first;
  })();
  const doneMovements = spine.filter(x => x.complete).length;
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const allWorkDone = totalSets > 0 && doneSets === totalSets;
  const codes = Training.sessionCodes(items);
  /* Roughly how much session is left, by the same arithmetic that told you "about 76 min" when you
     picked the day: sets still to do, times their own rest plus the forty seconds the set takes.
     Counted from what is LEFT rather than from the clock, so stopping to talk to somebody does not
     make it claim you are behind - the app has no way of knowing you were resting, and a tracker
     that tells you off for chatting is a tracker people stop opening.

     Deliberately a fact and not a pace judgement. "Running long" is a number plus an opinion about
     how you should be spending your evening, and this app does not hold opinions about that. */
  const minsLeft = Math.round(items.reduce((a, it) => {
    const left = it.sets.filter(sx => !sx.done && (sx.type || 'work') !== 'warmup').length;
    return a + left * ((((it.target && it.target.restSec) || 120) + 40) / 60);
  }, 0));
  // The movement you are on, for the bar to name once its card has scrolled away.
  const focusIt = items[focus];
  const focusEx = focusIt && Training.byId(focusIt.exerciseId, t.custom);
  const focusWork = focusIt ? focusIt.sets.filter(sx => (sx.type || 'work') !== 'warmup') : [];
  const focusNext = focusWork.findIndex(sx => !sx.done);

  return (
    // Finish rides at the end of the list now, so the only thing to clear is the rest bar, and only
    // while it is up. Nothing is pinned over the session otherwise.
    <div className="fade-in" style={{ paddingBottom: rest ? '132px' : '24px' }}>
      {/* ---- SESSION BAR, per `Session.dc.html` ----
          A live session is the one screen in the app that owns the phone for an hour, and the design
          gives it its own chrome to say so: the header's purple, the session's name, and the whole
          session's progress drawn across the full width underneath with the count that matters
          hanging off its end. On the paper background this was a back link, a title and a hairline,
          which read as a page heading rather than as an instrument you are mid-way through.

          It sits directly under the brand bar, which no longer steps aside for a session, so it is one
          purple block with one rule under it, rather than two purple blocks with the page showing
          between them. Its `top-0` needs no safe-area inset for the same reason the brand header
          never did: `theme-color` paints the status bar and the web view begins below it.

          `-mt-6` cancels the page wrapper's `pt-6` exactly as `-mx-5` already cancels its `px-5`.
          That 24px of paper is the gutter that used to sit BETWEEN the two purple bars; with the
          brand bar gone it was left stranded above this one, a cream strip along the top edge of the
          screen at scroll 0. It is not visible once you scroll, which is precisely why a bar that is
          only ever seen mid-scroll can carry a fault like this for months. */}
      <div ref={barRef} className="sticky z-20 -mx-5 -mt-6 mb-6 border-b-[3px]"
        style={{ top: 'var(--appbar-h)', background: 'var(--header)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 px-3 pt-2 pb-2">
          {/* The way back NAMES where it goes, like every other back control in the app
              (`SubScreen`, app.jsx) - and unlike the bare chevron this replaces, which was the only
              unlabelled navigation left in the module. It matters more here than anywhere: the brand
              bar and the tab bar both step aside for a session, so this is the only navigation on
              the screen. It no longer ends anything either - see `onExit` below. */}
          <button onClick={onExit} aria-label="Back to Train"
            className="pf text-[9px] uppercase hit shrink-0 flex items-center gap-1"
            style={{ color: 'var(--nav-off)', letterSpacing: '0.1em' }}>
            <Icon.chevron width="12" height="12" style={{ transform: 'rotate(180deg)' }} />Train
          </button>
          {/* Your buddy is in the room with you for the whole hour, not only on the movement you have
              open. It is the same idle strip the header uses everywhere else, so it costs no new art. */}
          <SessionBuddy db={db} pattern={items[focus] && (Training.byId(items[focus].exerciseId, t.custom) || {}).pattern} trigger={lift.n} />
          {/* Two lines, because one could not hold it. The name, the week and the count were a single
              9.5px pixel string competing with a back link, a sprite and a MORE button for 375px, and
              the pixel face is about twice the width of the body face at the same size: "Lower B ·
              Week 2" alone spent three quarters of what was left, and on a longer day name it
              truncated to nothing. Splitting on the natural break makes the title BIGGER rather than
              smaller, and gives the count somewhere to live that is not the end of the spine.

              What each line answers is different, which is why they separate cleanly: line one is
              WHICH session, line two is WHERE you are in it. */}
          <div className="flex-1 min-w-0 leading-tight">
            {/* Two readings of the same bar, one at a time. While the open card is on screen this
                names the SESSION, which is what a header is for. Once the card has scrolled out from
                under the chrome it names the MOVEMENT and becomes the way back to it, because at
                that moment "which session is this" is a question nobody has and "where was I" is the
                only question anybody has. Nothing new is pinned to do it. */}
            {openOffScreen && focusEx ? (
              <button onClick={scrollToOpen} className="w-full text-left" aria-label={'Back to ' + focusEx.name}>
                <span className="block pf text-[11px] uppercase truncate" style={{ color: 'var(--header-text)', letterSpacing: '0.08em' }}>
                  {codes[focus]} {focusEx.name}
                </span>
                <span className="block pf text-[9px] uppercase truncate mt-[3px]" style={{ color: 'var(--on-header-accent)', letterSpacing: '0.1em' }}>
                  {focusNext < 0 ? 'All sets in' : 'Set ' + (focusNext + 1) + ' of ' + focusWork.length} · Tap to go back
                </span>
              </button>
            ) : (
              <>
                <div className="pf text-[11px] uppercase truncate" style={{ color: 'var(--header-text)', letterSpacing: '0.08em' }}>
                  {(session && session.name) || (existing && existing.name) || 'Empty session'}
                </div>
                <div className="pf text-[9px] uppercase truncate mt-[3px]" style={{ color: 'var(--nav-off)', letterSpacing: '0.1em' }}>
                  {session && session.week ? 'Week ' + session.week + ' · ' : ''}{doneMovements} of {spine.length} done
                </div>
              </>
            )}
            {/* The running clock used to sit here in gold, directly above a spine that reports the
                same session better. After five hours it is measuring how long the phone has been
                unlocked, not how the session is going, and it was the more prominent of the two
                numbers. It moved to the More sheet, which is where you go for a fact ABOUT the
                session rather than for the next set.

                What stays is the one thing the title cannot say for itself - that you are correcting
                a past session rather than running one - and that is a fixed short string, not a
                number that ticks, which is the only thing the pixel face should be asked to set. */}
            {past && <div className="pf text-[9px] uppercase mt-1" style={{ color: 'var(--on-header-accent)', letterSpacing: '0.11em' }}>
              Editing · {relativeDay(dateISO, today).toLowerCase()}
            </div>}
          </div>
          <button onClick={() => setSessionMenu(true)} aria-label="Session options"
            className="pf text-[9px] uppercase shrink-0 px-2.5"
            style={{ minHeight: 38, background: 'var(--cardhead-bg)', border: '2px solid var(--border)', color: 'var(--header-text)', letterSpacing: '0.1em' }}>More</button>
        </div>
        {/* ---- the spine ----
            One cell per MOVEMENT, evenly spaced, in the order you will do them: green once it is
            finished, gold for the one you are on, empty ahead. Each cell fills left to right with
            its own sets, so where you are inside the movement is in the same picture without the
            bar having to be sixteen anonymous cells.

            It used to group cells by movement AND paint the whole current movement gold, which put
            two gold cells above the words "0 / 16 sets" on a session where nothing had been logged
            at all - the bar reading started and the count reading not started, on the same line.
            Gold means one thing now, the movement in front of you, and the count beside it counts
            the same things the cells do.

            Deliberately not tappable: the movement headers are the navigation, and two ways to jump
            around was the confusion this screen already had.

            It sits on the header's own purple with no rule above it, because it is the second LINE
            of one bar and not a second bar. It used to open `--card` behind a 3px border, which is
            what turned one header into two stacked ones. The cells carry their own 2px frames, so
            they still read against the purple.

            It spans the full width now. The "3 / 8 done" count used to sit on its right, which cost
            the bar a fixed 70px at exactly the moment it could least afford it: an eight-movement
            leg day divided what was left into cells about 30px wide, and the one you are ON has to
            be findable at a glance from arm's length. The count says the same thing as the cells, so
            it is not lost by moving up into the title, where it also answers the question the title
            line above it raises. */}
        <div className="px-3 pb-2.5">
          <div className="flex gap-[4px]" aria-hidden="true">
            {spine.map((cell, i) => {
              // What is left of the cell once its finished sets are filled in: gold on the movement
              // you are on, nothing on one you have not reached.
              const rest = i === spineAt ? 'var(--accent)' : 'var(--track)';
              const pct = Math.round(cell.frac * 100);
              return (
                <i key={i} className="flex-1 min-w-0" style={{
                  height: 10, border: '2px solid var(--border)', transition: 'background .18s',
                  background: cell.complete ? 'var(--good)'
                    : pct > 0 ? 'linear-gradient(to right, var(--good) 0 ' + pct + '%, ' + rest + ' ' + pct + '% 100%)'
                      : rest,
                }} />
              );
            })}
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
                  n[u.index] = replacedRow(old2, u.alt);
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
      {/* renderRow is a named function rather than an inline map callback for exactly one reason: the
          movements still to come are drawn as rows inside a shared "Up next" card rather than as
          their own boxes, and the row body - the open and closed headers, the whole working table,
          every handler - has to be identical either way. `grouped` changes nothing but the wrapper. */}
      {(() => { function renderRow(it, ii, grouped) {
        const ex = Training.byId(it.exerciseId, t.custom);
        const tgt = it.target;
        const open = ii === focus;
        const work = it.sets.filter(s => (s.type || 'work') !== 'warmup');
        const done = work.length > 0 && work.every(s => s.done);
        const warmups = it.sets.filter(s => (s.type || 'work') === 'warmup');
        const hist = Training.exerciseHistory(t.logs, it.exerciseId);
        return (
          <div key={it.exerciseId + '_' + ii}
            ref={open ? openCardRef : null}
            className={grouped ? '' : 'pixel-box mb-4'}
            style={Object.assign(
              grouped ? { borderTop: '2px solid var(--border)' } : { background: 'var(--card)' },
              // `scrollIntoView` aligns to the top of the SCROLLPORT, which is underneath 140px of
              // pinned bars, so without this the card is returned to with its header behind the
              // chrome. The browser owns this offset; doing it by hand means measuring the bars.
              open ? { scrollMarginTop: 'calc(var(--appbar-h) + 90px)' } : null,
            )}>
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
                    ? (work.every(s => s.done)
                      // Open and finished: "Set 2 of 2" reads as one still to do, on a card whose
                      // every row is already green.
                      ? 'All ' + work.length + ' sets logged'
                      : 'Set ' + ((work.findIndex(s => !s.done) + 1) || work.length) + ' of ' + work.length)
                    : done
                      ? work.length + ' x ' + (work[0] && work[0].weightKg > 0 ? toDisplayWeight(work[0].weightKg, units) + unitLabel(units) : 'BW') + ' logged'
                      : work.length + ' x ' + (tgt ? tgt.repLow + '-' + tgt.repHigh : '–') + (tgt ? (style.toFailure ? (tgt.rir > 0 ? ' · last set to failure' : ' to failure') : ' at ' + tgt.rir + ' RIR') : ' reps')}
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
                  {tgt && (style.toFailure
                    ? <MetaBit label={(tgt.rirLast == null ? tgt.rir : tgt.rirLast) > 0 ? 'Intro week' : (tgt.rir > 0 ? 'Last set to failure' : 'To failure')}
                      onHelp={() => setHelp('failure')} hideHelp={t.prefs.hideHelp} />
                    : <MetaBit label={tgt.rir + ' RIR'} onHelp={() => setHelp('rir')} hideHelp={t.prefs.hideHelp} />)}
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

                {it.note && (
                  <div className="text-[11.5px] mb-2 leading-snug" style={{ color: 'var(--accent-ink)' }}>
                    {it.note}
                    {/* A stall is the one note that asks for a decision rather than reporting one,
                        and it was asking for it with no way to say yes: you read "change the
                        movement" and then went hunting for the swap tool yourself. The button is
                        the note's own verb. */}
                    {it.swap && (
                      <button onClick={() => setSwapping(ii)}
                        className="pixel-box px-2.5 ml-2 text-[11px] align-middle"
                        style={{ minHeight: 34, background: 'var(--surface2)', color: 'var(--text2)' }}>
                        Change it
                      </button>
                    )}
                  </div>
                )}

                {/* What the plan's author wrote against this movement, and what they asked for on its
                    last set. Both come out of an imported programme and both are instructions, not
                    decoration: "1 second pause at the bottom" and "two drop sets at 25%" are the
                    difference between doing the exercise and doing their exercise. */}
                {it.technique && (
                  <div className="text-[11.5px] mb-2 px-2.5 py-2 leading-snug"
                    style={{ background: 'color-mix(in srgb, var(--warn) 14%, var(--surface2))', color: 'var(--text2)' }}>
                    <b>On the last set:</b> {it.technique}
                  </div>
                )}
                {it.planNote && (
                  <div className="text-[11px] mb-2 leading-snug" style={{ color: 'var(--muted)' }}>{it.planNote}</div>
                )}

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

                {/* Say that the warm-up exists, to the only people who cannot see it.
                    The ramp below is worked out FROM the weight in set one, and set one opens empty,
                    so on a fresh movement the feature was invisible: a line that only appears once
                    you have done the thing that makes it appear teaches nobody it is there. This is
                    the offer, and it is careful to be an offer - the app is not asking what you
                    should lift or telling you what to, it is saying that if you happen to have a
                    number in mind it will do the arithmetic around it. Shown only where a ramp would
                    actually follow, so it never promises something it will not deliver. */}
                {/* Probed at the weight this movement is ACTUALLY likely to carry, not a flat 60kg.
                    `warmupSets` short-circuits on the real number - isolation under 15kg gets nothing
                    at all - so the flat probe promised a ramp to somebody whose lateral raise is 10kg
                    and then produced none, which is the one thing an offer must not do. */}
                {!t.prefs.sawWarmupHint && warmups.length === 0 && !work.some(x => x.done) && work[0] && !(work[0].weightKg > 0)
                  && Training.warmupSets((work[0].lastTime && work[0].lastTime.weightKg) || 60, ex, { count: it.warmups }).length > 0 && (
                  <div className="text-[11.5px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>
                    Got a weight in mind? Put it in set 1 and a warm-up is worked out for it.
                  </div>
                )}

                {/* Warm-up, only until you have started. Once the first working set is in, telling
                    you what to warm up with is stale advice taking up a third of the card. */}
                {warmups.length === 0 && !work.some(x => x.done) && work[0] && work[0].weightKg > 0
                  && Training.warmupSets(work[0].weightKg, ex, { count: it.warmups }).length > 0 && (
                  <div className="text-[11.5px] mb-4 leading-snug" style={{ color: 'var(--accent-ink)' }}>
                    <span style={{ color: 'var(--muted2)' }}>Warm up: </span>
                    {/* A suggestion and nothing more: no rows, no ticks, nothing logged. Where the
                        plan states a count it decides how many rungs are on this line, and says
                        nothing about it - a warm-up that announces itself is a warm-up being treated
                        as a step you owe somebody. */}
                    {Training.warmupSets(work[0].weightKg, ex, { count: it.warmups }).map(u => u.reps + ' @ ' + toDisplayWeight(u.weightKg, units) + unitLabel(units)).join(', ')}
                  </div>
                )}

                {/* One shot. This is the whole psychological mechanism the style runs on: somebody
                    who knows a movement gets three or four cracks treats the first two as rehearsal,
                    and somebody who knows there is one set does not. It is said on the movement you
                    are about to do, once, and only while it is still ahead of you - a line telling
                    you to lock in, above a set you have already finished, is noise. */}
                {style.toFailure && !work.some(x => x.done) && tgt && (
                  <div className="text-[11.5px] mb-3 px-2.5 py-2 leading-snug"
                    style={{ borderLeft: '3px solid var(--accent)', background: 'var(--surface2)', color: 'var(--text2)' }}>
                    {(tgt.rirLast == null ? tgt.rir : tgt.rirLast) > 0
                      ? 'Intro week. Leave ' + (tgt.rirLast == null ? tgt.rir : tgt.rirLast) + ' in the tank on the last set: this week is what earns you the next five.'
                      : work.length === 1
                        ? 'One set here. Make it count: take it to the rep where the weight stops moving.'
                        : tgt.rir > 0
                          ? 'Two sets. Stop the first one a rep short; the second is the one you take until the weight stops moving.'
                          : 'Two sets, both to failure. The second is lighter for exactly that reason.'}
                  </div>
                )}

                {/* ---- set table ----
                    The ref the session bar watches is on the ROWS, not on the card around them.
                    A card is mostly not the set you are on: its last hundred pixels are a note field
                    and three tools, and while those are on screen the card counts as visible even
                    though every row you could log into has gone. Watching the rows asks the question
                    the bar actually answers, which is "can I still reach my next set from here". */}
                <div ref={open ? openRowsRef : null}>
                <div className="flex items-center gap-2 pb-2">
                  <div className="w-8 pf text-[7px] uppercase" style={{ color: 'var(--muted2)' }}>Set</div>
                  <div className="flex-1 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>{unitLabel(units)}</div>
                  <div className="flex-1 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>Reps</div>
                  {!style.toFailure && <div className="w-11 pf text-[7px] uppercase text-center" style={{ color: 'var(--muted2)' }}>RIR</div>}
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
                        {/* The placeholder is what you lifted last time, as a suggestion. Where
                            there is no last time the box stays EMPTY rather than offering "0": the
                            column is headed KG, and a nought sitting in it reads as a weight
                            somebody has already entered rather than as an invitation to type one. */}
                        <input type="number" inputMode="decimal" className={'flex-1 ' + cell} style={cellStyle}
                          value={s.weightKg ? toDisplayWeight(s.weightKg, units) : ''}
                          onFocus={e => { try { e.target.select(); } catch (_) {} }}
                          onChange={e => setField(ii, si, 'weightKg', fromDisplayWeight(e.target.value, units))}
                          placeholder={s.lastTime ? String(toDisplayWeight(s.lastTime.weightKg, units)) : ''} />
                        <input type="number" inputMode="numeric" className={'flex-1 ' + cell} style={cellStyle}
                          value={s.reps == null ? '' : s.reps}
                          onFocus={e => { try { e.target.select(); } catch (_) {} }}
                          onChange={e => setField(ii, si, 'reps', e.target.value === '' ? null : +e.target.value)}
                          placeholder={tgt ? String(tgt.repHigh) : (s.targetReps ? String(s.targetReps).split('-').pop() : '')} />
                        {/* Nothing to ask for on a style where every set ends when the weight stops
                            moving: "how many did you leave" has one answer, and a column asking it
                            anyway is a column that makes people think they were allowed to leave
                            some. The space goes back to the two numbers that matter. */}
                        {!style.toFailure && (
                          <input type="number" inputMode="numeric" className={'w-11 ' + cell} style={cellStyle}
                            value={s.rir == null ? '' : s.rir}
                            onFocus={e => { try { e.target.select(); } catch (_) {} }}
                            onChange={e => setField(ii, si, 'rir', e.target.value === '' ? null : +e.target.value)}
                            placeholder={tgt ? String(tgt.rir) : ''} />
                        )}
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
                            // Faint enough to read as an outline of what the button does rather than
                            // as a set already ticked. At 0.85 a card of untouched sets looked like a
                            // card of finished ones, which is the worst thing this screen can lie
                            // about - and it lied about it hardest on the very first set of a block.
                            opacity: s.done ? 1 : 0.32,
                            transform: justDone === ii + ':' + si ? 'scale(1.12)' : 'scale(1)',
                          }}>
                          <Tick size={12} />
                        </button>
                      </div>
                      {/* A second working set at the same weight as an all-out first one lands three
                          reps under the window and teaches nobody anything, so the app has already
                          taken 15% off. Said out loud, because a weight the app quietly lowered
                          reads as a bug rather than as the protocol it is. */}
                      {style.toFailure && !s.done && (s.backOff || s.targetRir > 0) && (
                        <div className="text-[10.5px] mt-0.5 pl-11 leading-snug" style={{ color: 'var(--muted2)' }}>
                          {s.backOff
                            ? 'Back-off set: 15% lighter, taken to failure again.'
                            : 'Leave ' + s.targetRir + (s.targetRir === 1 ? ' rep' : ' reps') + ' in the tank on this one.'}
                        </div>
                      )}
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
                </div>

                <button onClick={() => addSet(ii)} className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add set</button>

                {/* One tool row, and now BELOW the table. These are the three things you reach for
                    between sets rather than during one, and above the rows they pushed the only part
                    of the card you actually touch while training a third of the way further down. */}
                <div className="flex gap-2 mt-3">
                  <ToolBtn on={noteOpen === it.exerciseId || !!exNotes[it.exerciseId]}
                    onClick={() => setNoteOpen(noteOpen === it.exerciseId ? null : it.exerciseId)}>Note</ToolBtn>
                  {/* Only where there is something to show. A movement you have never trained had a
                      greyed-out third button sitting there, which reads as a broken control rather
                      than as an empty one - and on a first session that was every card. */}
                  {hist.length > 0 && <ToolBtn onClick={() => setPastFor(it.exerciseId)}>History</ToolBtn>}
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
      }

      // Three bands: what is already logged (its own boxed row, a receipt), the one movement open
      // right now (its full card), and what has not been touched yet. That last band used to be N
      // more full-width boxes - readable, but a leg day with six accessories after the lead lift was
      // six decisions' worth of weight for zero decisions actually pending. It becomes one "Up next"
      // card of compact rows, which is what fixed that: the WEIGHT came from six framed boxes each
      // with its own shadow, not from six names.
      //
      // Those rows are now all shown. Folding everything past the second behind "+ 5 more" was
      // solving the same problem twice, and it cost more than it saved. What is left in a session is
      // the single most common thing to want to know mid-set - whether to push the pace, whether the
      // hard movement is still to come, whether to take the long rest - and the fold answered it
      // with a number that names nothing. It was also a disclosure whose own label gave no clue what
      // was behind it, and it hid the very rows it invited you to tap ("tap to jump"). Eight compact
      // rows are about 300px of a page you are already scrolling; the cost of showing them is scroll,
      // which is free, and the cost of hiding them was a decision.
      const doneRows = [], queueRows = [];
      items.forEach((it, ii) => {
        if (ii === focus) return;
        const work = it.sets.filter(s => (s.type || 'work') !== 'warmup');
        ((work.length > 0 && work.every(s => s.done)) ? doneRows : queueRows).push({ it, ii });
      });

      return (
        <>
          {doneRows.map(({ it, ii }) => renderRow(it, ii, false))}
          {items[focus] != null && renderRow(items[focus], focus, false)}
          {queueRows.length > 0 && (
            <div className="pixel-box mb-4 overflow-hidden" style={{ background: 'var(--card)' }}>
              <CardHead title="Up next" right={String(queueRows.length)} />
              {queueRows.map(({ it, ii }) => renderRow(it, ii, true))}
            </div>
          )}
        </>
      );
      })()}

      <button onClick={() => setPicking(true)} className="pixel-box w-full h-12 text-[13px] mb-4" style={{ background: 'var(--surface2)' }}>+ Add an exercise</button>

      {/* The count that used to sit here said "0 of 16 sets logged so far" three inches under the
          spine, which says the same thing permanently and in view. What is worth putting at the foot
          of the session is the one moment the main action changes: every set ticked, nothing left to
          do but finish. Finish otherwise stays in the header's MORE, where it belongs - it is an
          end-of-session tool and this is the end of the session. */}
      {/* ---- the end of the session, at the end of the list ----
          There is a way to finish here in BOTH states now. It used to appear only once every set was
          ticked, so the ordinary end of a session - you got six of eight movements done and the gym
          is closing - had nothing at the bottom of the screen at all, and the way out was a Finish
          buried in the header's MORE sheet. Scrolling to the end of the work and finding no way to
          say you are finished is the plainest kind of dead end.

          The two states are different KINDS of object, not loud and quiet versions of one. Every set
          ticked is a commit and takes the gold: it is the thing you came to do. Sets still open is a
          secondary path, and a gold Finish sitting under a card of empty rows is an invitation to
          stop early - so it gets the inset treatment and, more importantly, it states the score
          rather than asking a question. "20 of 26 ticked" is a fact you can act on; "are you sure?"
          on a button is a question asked before anybody has decided anything.

          The asking belongs one step later, and already happens: the confirm dialog names how many
          sets counted and promises that anything unticked stays on the session, which is the actual
          worry - that finishing early throws the rest away. It does not. */}
      {allWorkDone ? (
        <button onClick={() => setConfirmEnd(true)} className="pixel-btn w-full h-14 font-bold mb-2 fade-in"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          That is every set · finish
        </button>
      ) : (
        <button onClick={() => setConfirmEnd(true)} className="pixel-box w-full h-12 text-[12.5px] mb-2"
          style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
          {doneSets ? 'Finish here · ' + doneSets + ' of ' + totalSets + ' sets ticked' : 'Finish without logging anything'}
        </button>
      )}

      {/* Session notes and finishing both used to live here, at the bottom of the scroll: a titled
          panel and a full-width button sitting under every set on the way past. Both are
          end-of-session tools rather than mid-set ones, so both moved into the header's MORE sheet -
          "Session notes" opens the same field, and "Finish the session" was already there. What is
          worth keeping on the main screen is a plain word of where you stand, which used to be the
          finish button's second job. */}
      {/* ---- THE REST BAR ----
          Now the only thing pinned to the bottom, and only while it is running. The clock is big
          because it is read across a gym at arm's length, and the line beside it says what the rest
          is for: a countdown that does not name the next set makes you go back up and find it.

          Your buddy gets its breath back with you inside the ring, which is what RestRing was
          written for. The redesign that turned this into a bar took the ring off the screen and left
          the component behind it in the tree, rendered by nothing: a minute and a half of every set
          you rest, several times an hour, with the one animation in the app that was drawn for
          exactly that moment sat in a file. The digits stay - a ring is a shape, and the seconds are
          read across a gym. */}
      {rest && (
        <div className="fixed inset-x-0 bottom-0 max-w-md mx-auto z-30 border-t-[3px] fade-in px-3 pt-2.5 pb-3"
          style={{ background: 'var(--cardhead-bg)', borderColor: 'var(--border)', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
          {/* Two rows, because the five things on this bar do not share one.
              The ring, a 20px pixel clock and three 44px targets are all fixed-width and all
              non-negotiable - the clock is read across a gym, and the buttons are pressed one-handed
              with chalk on - which left the one flexible item, the line naming what is next, with
              about fifteen pixels. It wrapped to four lines of two or three characters and made the
              bar taller than the thing it was squeezing. Since the FLEX item is the one that has to
              give, give it the whole width instead: controls on one row, the sentence on the next.
              It is also the half of this bar you read rather than see, so a full-width line at a
              readable size is what it wanted in the first place. */}
          <div className="flex items-center gap-2.5">
            <RestRing left={restLeft} total={rest.seconds} db={db} />
            <span className="pf text-[20px] tnum shrink-0" role="timer"
              style={{ color: restLeft <= 0 ? 'var(--on-header-accent)' : 'var(--cardhead-text)' }}>
              {restLeft <= 0 ? 'GO' : fmtClock(restLeft)}
            </span>
            <span className="flex-1" />
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
          {/* The line you read while you are doing nothing else, so it carries the two facts worth
              having at that moment: what is next, and how much is left.

              What is next is a BUTTON. It was the one thing on this bar you might want to act on and
              it was text, so the way to your next set was to dismiss the timer, scroll, and find the
              card yourself. Resting is exactly when a tracker should be doing that for you.

              The time is the plan's own arithmetic over the sets still to do - the same sum behind
              "about 76 min" on the card you started from - and it is a fact, not a verdict. It reads
              off remaining WORK rather than off the clock, so a long chat with somebody at the water
              fountain does not turn into the app telling you that you are behind. */}
          <div className="mt-2 flex items-baseline gap-3">
            {rest.goIi != null ? (
              <button onClick={() => { goTo(rest.goIi); setRest(null); }}
                className="flex-1 min-w-0 text-left text-[12px] leading-snug truncate"
                style={{ color: 'var(--cardhead-text)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {rest.from ? 'Next: ' + rest.from : 'Next movement is ready'} &rsaquo;
              </button>
            ) : (
              <span className="flex-1 min-w-0 text-[12px] leading-snug truncate" style={{ color: 'var(--nav-off)' }}>
                {rest.from ? 'Next: ' + rest.from : 'That is the last of them'}
              </span>
            )}
            {minsLeft > 0 && (
              <span className="pf text-[9px] uppercase shrink-0 tnum" style={{ color: 'var(--nav-off)', letterSpacing: '0.08em' }}>
                ~{minsLeft} min left
              </span>
            )}
          </div>
          <div className="mt-2" style={{ height: 8, border: '2px solid var(--cardhead-text)', background: 'rgba(255,253,247,0.14)' }}>
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
        <ActionSheet kicker="Movement" title={(Training.byId(items[menuOpen].exerciseId, t.custom) || {}).name || 'This movement'}
          onClose={() => setMenuOpen(null)}
          actions={[
            { label: 'Replace it', sub: 'Something else that does the same job, keeping your sets and reps', onClick: () => setSwapping(menuOpen) },
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
          button at the bottom of the list and the rest had nowhere to live at all.

          Its kicker carries the clock the header used to. A session being corrected says so instead:
          the hour since you opened it is not a fact about the day it happened. */}
      {sessionMenu && (
        <ActionSheet kicker={past ? 'Session · editing' : 'Session · ' + fmtClock(elapsed) + ' elapsed'}
          title={session ? session.name : 'Empty session'} onClose={() => setSessionMenu(false)}
          actions={[
            { label: 'Add a movement', sub: 'Something you did that is not in the plan', onClick: () => setPicking(true) },
            { label: 'Session notes', sub: notes ? 'Written' : 'How it felt, what to change next week', onClick: () => { setSessionMenu(false); setNotesOpen(true); } },
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
            past
              ? { label: 'Save and close', sub: doneSets + (doneSets === 1 ? ' set' : ' sets') + ' on this session', onClick: () => setConfirmEnd(true) }
              : { label: 'Finish the session', sub: doneSets ? doneSets + (doneSets === 1 ? ' set' : ' sets') + ' saved' : 'Nothing ticked, so nothing saved', onClick: () => setConfirmEnd(true) },
            // Now literally true: the session stays open and the Train tab carries it back.
            { label: past ? 'Close' : 'Step out for now', sub: 'Everything ticked is already saved. The session stays open on the Train tab.', onClick: onExit },
          ]} />
      )}

      {/* The notes field, off the header rather than a card sitting under every set on the way past.
          Same field, same prompt, one more tap than before and mid-set zero times. */}
      {notesOpen && (
        <ActionSheet kicker="Session" title="Notes" onClose={() => setNotesOpen(false)}
          actions={[{ label: 'Done', onClick: () => setNotesOpen(false) }]}>
          <textarea value={notes} onChange={e => { setNotes(e.target.value); persist(null, e.target.value); }} rows={3} autoFocus
            placeholder="How the session felt, anything that hurt, what to change next week."
            className="w-full px-3 py-3 text-[13px]" style={{ border: '2px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
        </ActionSheet>
      )}

      {pr && <PRFlash pr={pr} db={db} units={units} onClose={() => setPr(null)} />}
      {signOff && <SessionSignOff db={db} facts={signOff} units={units} onDone={onFinish} />}
      {help && <TrainHelp topic={help} db={db} onClose={() => setHelp(null)}
        onHideForGood={() => { trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { hideHelp: true }); }); setHelp(null); }} />}
      {pastFor && <PastSets db={db} exerciseId={pastFor} onClose={() => setPastFor(null)} />}
      {picking && <ExercisePicker db={db} update={update} onPick={addExercise} onClose={() => setPicking(false)} />}
      {swapping != null && (
        <ExercisePicker db={db} update={update} title="Replace movement"
          basedOn={items[swapping] && items[swapping].exerciseId}
          offer={Training.replacementsFor(items[swapping] || {}, {
            style: block && block.style, custom: t.custom,
            equipment: gym ? Training.gymEquipment(gym).equipment : t.prefs.equipment,
            dislikes: t.prefs.dislikes,
            currentExerciseIds: items.map(x => x.exerciseId),
          })}
          onPick={(id) => { swapExercise(swapping, id); setSwapping(null); }}
          onClose={() => setSwapping(null)} />
      )}
      {/* The weeks already trained are never touched: they are a record of what you actually did, and
          rewriting them to match a decision made afterwards would make your own history lie. */}
      {swapScope && (() => {
        const from = Training.byId(swapScope.from, t.custom), to = Training.byId(swapScope.to, t.custom);
        return (
          <ActionSheet kicker="Replace" title={(to ? to.name : 'That') + ' instead of ' + (from ? from.name : 'it')}
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
        <ConfirmDialog title={past ? 'Save these changes?' : 'Finish this session?'}
          body={doneSets ? doneSets + ' sets counted. Anything you did not tick stays on the session, unticked, so you can come back and tick it.' : 'You have not ticked any sets, so nothing will be saved.'}
          confirmLabel={past ? 'Save' : 'Finish'} confirmKind="primary"
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
  let title = '', body = '', subject = null;
  if (topic === 'failure') {
    title = 'To failure';
    body = 'The LAST set of a movement ends when the weight stops moving, not when it gets hard. Where a movement has two sets, the first stops a rep short on anything you could get hurt failing - a squat, a press - and goes all the way on isolation, where failing a cable curl costs you nothing. That is only a sane instruction because there are so few sets: one or two per movement, four to ten a muscle a week. The first week of a block sits a rep or two further back on everything, and it is not a formality: it is what lets the next five weeks be this hard. Stop if your form breaks rather than grinding a rep that has already gone wrong, and take the machine or cable version where there is one - failing safely is the whole reason this style leans on guided kit.';
  } else if (topic === 'rir') {
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
    // The heading stays a fixed label and the movement's NAME goes underneath in the body face. The
    // pixel font runs about a full em per character and has no narrow forms, so a name the library
    // holds - "Smith machine bench press (close grip)" is thirty-eight characters - wraps a 12px
    // heading to three lines. Labels and short fixed strings only: the rule that fixed six other
    // places in this module, and this was the seventh.
    title = 'Why this movement';
    subject = ex ? ex.name : null;
    body = [Training.cueFor(ex), Training.whyFor(ex)].filter(Boolean).join('\n\n');
  }
  return (
    <div role="dialog" aria-modal="true" aria-label="Explainer" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box p-5 fade-in max-h-[80vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        <h2 className={'pf text-[12px] ' + (subject ? 'mb-1' : 'mb-4')}>{title}</h2>
        {subject && <div className="text-[15px] font-bold leading-tight mb-4">{subject}</div>}
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
        {/* Same rule as everywhere else: the pixel face carries the label, the body face carries the
            name. This heading was setting whatever the library calls a movement in Press Start 2P. */}
        <div className="pf text-[9px] uppercase mb-1" style={{ color: 'var(--muted)' }}>Recent sets</div>
        <h2 className="text-[15px] font-bold leading-tight mb-4">{ex ? ex.name : 'This movement'}</h2>
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
function ExercisePicker({ db, update, onPick, onClose, title, basedOn, seed, offer }) {
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
        {/* What to replace this movement with, before any searching happens. A written programme
            names a substitution or two against each movement, and those beat anything a search can
            rank because the author picked them for this slot; the rest is worked out from the muscle
            and the movement pattern. The two are drawn apart rather than blended into one list: "your
            plan says you can do this instead" and "this looks similar to us" are different claims,
            and somebody deciding at a busy machine deserves to know which one they are reading.

            Only shown before you start typing. Once you are searching you have something else in
            mind, and a list of our ideas is then just in the way. */}
        {!q && (offer || []).length > 0 && (() => {
          const rows = (offer || []).map(o => (typeof o === 'string' ? { id: o, kind: 'plan' } : o))
            .map(o => ({ o, ex: Training.byId(o.id, t.custom) })).filter(r => r.ex);
          const written = rows.filter(r => r.o.kind !== 'suggested');
          const worked = rows.filter(r => r.o.kind === 'suggested');
          /* The plan's own answers are tinted and our worked-out ones are not, which is the same
             device the "Ways to do this one" panel below already uses to mark a set of options as
             the authoritative one. Two headings over two identical stacks of cards put the whole
             distinction on a line of 8px type that anybody scrolling goes straight past - and it
             also left no way to see where the short curated list ended and the library began. */
          const row = ({ o, ex }) => (
            <button key={o.id} onClick={() => onPick(o.id)} className="w-full text-left pixel-box p-3 mb-2 flex items-center gap-2"
              style={{ background: o.kind === 'suggested' ? 'var(--surface2)' : 'color-mix(in srgb, var(--accent) 12%, var(--surface2))' }}>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold truncate">{ex.name}</span>
                <span className="block text-[10.5px]" style={{ color: 'var(--muted)' }}>
                  {(ex.primary || []).map(m => Training.MUSCLE_LABEL[m]).join(', ')} · {ex.equipment}
                </span>
              </span>
              {/* The one option that is not an alternative at all: it is the movement the plan asked
                  for in the first place, and saying so is what makes a replacement undoable. */}
              {o.kind === 'original' && (
                <span className="pf text-[7px] uppercase shrink-0 px-1.5 py-1"
                  style={{ border: '1px solid var(--accent)', color: 'var(--accent-ink)', letterSpacing: '0.08em' }}>As written</span>
              )}
            </button>
          );
          return (
            <div className="mb-3">
              {written.length > 0 && (
                <>
                  <div className="pf text-[8px] uppercase mb-2" style={{ color: 'var(--accent-ink)', letterSpacing: '0.1em' }}>Replace with</div>
                  {written.map(row)}
                </>
              )}
              {worked.length > 0 && (
                <>
                  <div className="pf text-[8px] uppercase mb-2 mt-3" style={{ color: 'var(--muted)', letterSpacing: '0.1em' }}>
                    {written.length ? 'Or something that does the same job' : 'Does the same job'}
                  </div>
                  {worked.map(row)}
                </>
              )}
            </div>
          );
        })()}
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