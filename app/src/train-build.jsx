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
                ? 'Your ' + sourceCount + ' ' + (sourceCount === 1 ? 'day' : 'days') + ' set the movements. The builder sets the volume and how the ' + weeks.length + ' weeks run.'
                : 'No source, so the builder writes all ' + weeks.length + ' weeks from your answers below.'}
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
// How many weeks a block shape runs for. The six-week min-max block is not a four-week block with
// two more stapled on: its first week is an intro week, and the five after it are the block.
function blockWeeks(shape) {
  const sh = Training.SHAPES[shape];
  return (sh && (sh.build + (sh.deload ? 1 : 0))) || 4;
}
// The shape a new block would be built as, from what was last chosen. Every screen that offers to
// build one has to agree with the builder about how long it will be: "Build a 4-week block" on a
// button that produces six is the app misdescribing its own product, and it is the first sentence
// anybody reads.
/* What a NEW block would be built as, which is a different question from how an EXISTING block
 * behaves - and conflating the two is how the tab came to offer a six-week block while describing a
 * four-week one.
 *
 * Training.styleOf answers the second question, and answers it with the volume model when no style
 * is recorded, because a block built before styles existed was built that way and has to keep
 * behaving that way. The wizard answers the first question with min-max, because that is the house
 * method now. Both are right; they are just not the same function.
 *
 * The saved SHAPE needs the same care. Somebody who has been using this app has 'build4' saved from
 * before any of this existed, and that answer carries no opinion about min-max - it was the only
 * option. So it governs only once they have actually chosen a style; until then the style's own
 * shape wins, and a returning user gets the six-week block the wizard would really build rather
 * than a min-max block squeezed into the old default's length.
 */
function plannedStyle(prefs) { return (prefs && prefs.style) || 'minmax'; }
function plannedShape(prefs) {
  const chosen = prefs && prefs.style;
  if (chosen && prefs.shape) return prefs.shape;
  return plannedStyle(prefs) === 'landmarks' ? 'build4' : 'minmax6';
}
function plannedWeeks(prefs) { return blockWeeks(plannedShape(prefs)); }
// Which saved override table a style's landmarks come from. Kept next to the other two so the three
// screens that build a block cannot end up reading different ones.
function styleTargets(t, style) {
  return Training.styleOf(style).toFailure ? t.volumeTargetsMinmax : t.volumeTargets;
}

// What the draft basket will hold once these reads are folded into it. Pure, on a copy, because the
// count has to be known BEFORE the write: trainUpdate hands React a function it runs when it pleases,
// and the message telling somebody what landed is written on the line after. It is also the only way
// to say anything true about repeats - Training.mergeDraftDays collapses a session photographed twice
// into one day, so "five files, five days" is a subtraction, not a tally of what came back.
function mergedDraftDays(days, parts) {
  const out = JSON.parse(JSON.stringify(days || []));
  parts.forEach(p => Training.mergeDraftDays(out, p.res.template, p.sourceRef));
  return out;
}

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
  // Min-max is the house method now, so it is what a new block is unless somebody says otherwise -
  // and five days is the shape it is written for, so that is the day count it arrives on.
  const [style, setStyle] = useState(plannedStyle(t.prefs));
  const [days, setDays] = useState(t.prefs.daysPerWeek || (t.prefs.style === 'landmarks' ? 4 : 5));
  // Recovery is lower in a deficit and low volume holds muscle perfectly well, so somebody who has
  // told the food side of the app they are cutting has already answered this question.
  const cutting = ((db.profile || {}).goalType === 'cut');
  const [goal, setGoal] = useState('hypertrophy');
  const [shape, setShape] = useState(plannedShape(t.prefs));
  // The one answer on this screen that changes what a brought plan IS: their block run as written, or
  // their choices read as inspiration for one of ours. Everything else on the screen is a setting.
  const shapeDef = Training.SHAPES[shape] || Training.SHAPES.build4;
  const asBrought = !!shapeDef.asWritten;
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
  // A spreadsheet that turned out to be a whole written programme, waiting on one question: is it
  // the plan, or the inspiration for one? See readFiles.
  const [exact, setExact] = useState(null);

  /* The live preview. Every answer runs the REAL engine and reads the real block back, so what is
     drawn above the questions is the block you will get rather than a sketch of one. Memoised on the
     answers themselves: building four weeks is cheap but not free, and it must not rerun because a
     text box somewhere else on the screen changed. A throw here is not worth a broken screen, so it
     falls back to no preview and the questions still work. */
  const preview = useMemo(() => {
    try {
      const targets = Training.defaultTargets({ experience: experience, volumeTargets: styleTargets(t, style), style: style });
      // One call whether or not anything was brought, because the answer to "what will I get" has to
      // be the same function that later gives it to you. blockFromSource reads a brought plan as
      // inspiration at the day count set below, or photocopies it when the shape says "as brought".
      const blk = draftDays > 0
        ? Training.blockFromSource(t.draft.days, {
          daysPerWeek: days, weeks: blockWeeks(shape), shape: shape, intensity: intensity, goal: goal, targets: targets,
          style: style, gym: gym, equipment: equipment.length ? equipment : null, dislikes: t.prefs.dislikes,
          custom: t.custom, sessionMinutes: minutes, emphasis: emphasis,
          name: t.draft.name || 'My block', startISO: null,
        })
        : Training.generateBlock({
          daysPerWeek: days, weeks: blockWeeks(shape), shape: shape, intensity: intensity, goal: goal, targets: targets,
          style: style, gym: gym, equipment: equipment.length ? equipment : null, dislikes: t.prefs.dislikes,
          custom: t.custom, sessionMinutes: minutes, emphasis: emphasis, source: 'generated',
        });
      const read = readBlock(blk);
      if (!read) return null;
      return Object.assign({
        cov: Training.coverage(Training.blockWeekVolume(blk, 1, t.custom), targets),
        // How much of what they brought is actually in there, and the names of anything that is not.
        // A block built from somebody's own plan has to be able to answer "where did my movement go".
        brought: (blk.brought || []).length,
        spare: (blk.broughtSpare || []).map(id => (Training.byId(id, t.custom) || {}).name).filter(Boolean),
      }, read);
    } catch (_) { return null; }
  }, [days, minutes, experience, goal, shape, intensity, emphasis, equipment, gym, draftDays, t.draft, t.custom, t.volumeTargets, t.volumeTargetsMinmax, style]);

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
    // Movements the library had nothing for, folded in BEFORE the days are, so a day never lands
    // pointing at an entry that got collapsed into another. Idempotent, so it does not matter that
    // the reader has usually done this already to get an honest count out.
    const newCustom = parts.reduce((a, p) => a.concat((p.res && p.res.newCustom) || []), []);
    if (newCustom.length) {
      const merged = Training.mergeCustom(tr.custom || [], newCustom);
      tr.custom = merged.custom;
      parts.forEach(p => Training.remapDays(p.res.template, merged.map));
    }
    d.days = mergedDraftDays(d.days, parts);
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
  async function readFiles(files, opts) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (!isPremium) { onUpgrade && onUpgrade('workout_import'); return; }
    const note = ctx;
    setReadErr(false); setReadNote(null); setFails([]); setExact(null);

    // A spreadsheet is not a photograph. It has columns, and the columns say what they mean, so a
    // written programme in one can be read EXACTLY - all twelve weeks, every set, rep range, RIR
    // pair, rest and note - with no model in the way. The path below is the inspiration path by
    // design and it can only fit about a quarter of a long sheet into a prompt, which is why
    // uploading a programme here used to come back looking like a cousin of it rather than it.
    // So: read it exactly first, and if it IS a programme, ask which of the two was meant.
    if (!(opts && opts.force)) {
      for (const file of list) {
        if (!/\.xlsx$/i.test(file.name || '') && (file.type || '').indexOf('spreadsheetml') === -1) continue;
        let res = null;
        try { res = await blocksFromSpreadsheet(file, t.custom); } catch (e) { res = null; }
        if (res && res.blocks.length) { setExact({ files: list, file: file, res: res }); return; }
      }
    }
    let done = 0;
    const label = () => setReadBusy('Read ' + done + ' of ' + list.length + '...');
    label();

    async function readOne(file) {
      const content = withImportNote((await workoutContentFromFile(file)).blocks, note);
      // One retry, because the failure this catches is a dropped request rather than an unreadable
      // file, and re-uploading five of them to fix one is a miserable ask.
      let parsed;
      try {
        parsed = await aiParseWorkout(content, { timeoutMs: 90000, days, batch: list.length });
      } catch (e) {
        if (e && e.aiError) throw e;              // a paywall or a quota is not worth asking twice
        parsed = await aiParseWorkout(content, { timeoutMs: 90000, days, batch: list.length });
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
    // `read` is what came back, `added` is what the basket actually grew by - the two differ when
    // two shots caught the same session and the merge kept the fuller reading.
    const read = got.reduce((a, r) => a + r.res.template.length, 0);
    // Two files that each invented the coach's own name for a machine invented it twice, under two
    // spellings, because neither parse could see the other. Collapsed here, before anything is
    // counted or merged, so the day comparison below is working on the ids that will actually be
    // stored - and so the person's library does not fill up with five spellings of one movement.
    Training.remapDays(
      got.reduce((a, r) => a.concat(r.res.template), []),
      Training.mergeCustom(t.custom || [], got.reduce((a, r) => a.concat((r.res && r.res.newCustom) || []), [])).map);
    const basket = ((t.draft && t.draft.days) || []);
    const added = mergedDraftDays(basket, got).length - basket.length;
    const repeats = Math.max(0, read - added);
    if (got.length) trainUpdate(update, (tr) => mergeIntoDraft(tr, got));
    setReadBusy('');
    setFails(fails2);
    if (!read) {
      setReadErr(true);
      setReadNote('I could not read a session out of ' + (list.length === 1 ? 'that' : 'those') + '. A file or screenshot showing the exercise names, sets and reps works best.');
      return;
    }
    setReadErr(false);
    setReadNote(added + (added === 1 ? ' day' : ' days') + ' added to your draft'
      // Said out loud, because a screen that reads "5 days added" for 5 files and then shows 3 is
      // the app quietly disagreeing with itself. Overlapping screenshots are the normal case, not
      // an error, so this is a note on what happened rather than a warning.
      + (repeats ? ', and ' + (repeats === 1 ? 'one that repeated a day you already had' : repeats + ' that repeated days you already had') + ' (I kept the fuller reading)' : '')
      + (fails2.length ? ', and ' + fails2.length + ' I could not read: ' + fails2.map(f => f.file.name || 'a file').join(', ') + '.' : '.')
      + (fails2.length ? ' Try those again, or build below.' : ' Add another, or build below.'));
  }

  // The answer to that question. "Exactly" means exactly: the blocks go on the shelf as the sheet
  // wrote them, and nothing here re-periodises them, re-picks a movement or lays the house intensity
  // over the top. The questions below this card are about a block WE write; this is one somebody
  // already wrote, and the honest thing to do with it is leave it alone.
  function takeExactly() {
    if (!exact) return;
    const res = exact.res;
    addOwnedBlocks(update, res);
    setExact(null);
    showToast && showToast(res.blocks.length === 1 ? 'Added to your blocks. Start it from the Train tab.' : res.blocks.length + ' blocks added. Start the first from the Train tab.');
    onBack && onBack();
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
      const part = { parsed: parsed, res: res, sourceRef: sourceRef };
      const basket = ((t.draft && t.draft.days) || []);
      const added = mergedDraftDays(basket, [part]).length - basket.length;
      trainUpdate(update, (tr) => mergeIntoDraft(tr, [part]));
      setReadBusy('');
      // Same subtraction as the file reader does: a post that covers a day already in the basket
      // merges into it, so what landed is the growth, not what came back.
      setReadNote(added
        ? added + (added === 1 ? ' day' : ' days') + ' added to your draft. Add another, or build below.'
        : 'That was a day you already had, so I kept the fuller reading of it rather than adding it twice.');
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
    const targets = Training.defaultTargets({ experience: experience, volumeTargets: styleTargets(t, style), style: style });
    let block;
    if (draftDays > 0) {
      block = Training.blockFromSource(t.draft.days, {
        daysPerWeek: days, weeks: blockWeeks(shape), shape: shape, intensity: intensity, goal: goal, targets: targets,
        style: style, gym: gym, equipment: equipment.length ? equipment : null,
        dislikes: t.prefs.dislikes, custom: t.custom, sessionMinutes: minutes, emphasis: emphasis,
        name: t.draft.name || 'My block', startISO: null,
        sourceRef: { kind: 'draft', days: t.draft.days.length, importedISO: Store.todayISO() },
      });
    } else {
      block = Training.generateBlock({
        daysPerWeek: days, weeks: blockWeeks(shape), shape: shape, intensity: intensity, goal: goal, targets: targets,
        style: style, gym: gym, equipment: equipment.length ? equipment : null,
        dislikes: t.prefs.dislikes, custom: t.custom,
        sessionMinutes: minutes, emphasis: emphasis, source: 'generated',
      });
    }
    block.gymId = gym ? gym.id : null;
    // Remember the answers, so the next block does not ask again.
    trainUpdate(update, (tr) => {
      tr.prefs = Object.assign({}, tr.prefs, {
        daysPerWeek: days, sessionMinutes: minutes, experience: experience, equipment: equipment,
        shape: shape, intensity: intensity, style: style,
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
          A PDF, a spreadsheet, a coach's message, a reel, or just the text. However many days it is written across, I build it at the day count you set below: what I take is the movements, the rep ranges and what the plan was built around. Skip this entirely and I will write you one from nothing.
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

        {/* The fork. A spreadsheet that turned out to be a whole written programme is the one source
            where "inspiration" is probably not what was meant - somebody who uploads twelve weeks of
            a plan they own usually wants those twelve weeks - but it is still a question, because
            reading it as inspiration is a real thing to want too. Asked once, plainly, with the size
            of what was found on screen so the answer is an informed one. */}
        {exact && (
          <div className="p-3.5 mt-3" style={{ border: '2px solid var(--accent)', background: 'var(--surface2)' }}>
            <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>That is a written programme</div>
            <div className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--text2)' }}>
              I can read {exact.file.name} exactly: <b className="tnum">{exact.res.blocks.reduce((a, b) => a + b.weeks, 0)} weeks</b>, {exact.res.blocks[0].daysPerWeek} days a week, every set, rep range and rest as written. Or I can treat it as inspiration and build you one at the day count and intensity you set below.
            </div>
            <button onClick={takeExactly} className="pixel-box w-full h-11 text-[12.5px] mb-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
              Take it exactly as written
            </button>
            <button onClick={() => { const files = exact.files; setExact(null); readFiles(files, { force: true }); }}
              className="pixel-box w-full h-11 text-[12.5px]" style={{ background: 'var(--surface)' }}>
              Use it as inspiration
            </button>
            {exact.res.problems.length > 0 && (
              <div className="text-[11px] mt-2 leading-snug" style={{ color: 'var(--muted2)' }}>{exact.res.problems[0]}</div>
            )}
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

      {/* The first question, because it is the only one that changes what every answer below MEANS.
          Four sets on one style is a warm-up and on the other it is most of a muscle's week. */}
      <TrainField label="How you want to train"
        effect={style === 'minmax' ? '1-2 sets, to failure' : 'more sets, stopping short'}
        hint={Training.STYLES[style].blurb}>
        <Seg value={style} onChange={v => {
          setStyle(v);
          // The block length belongs to the style: min-max runs six weeks off an intro week, the
          // volume model four. Only moved when the person has not chosen one for themselves.
          if (!t.prefs.shape) setShape(v === 'minmax' ? 'minmax6' : 'build4');
          // Five days is the min-max week and four is the volume model's default shape. Only moved
          // when the person has not set a day count of their own, so a deliberate answer is never
          // overwritten by changing your mind about the style.
          if (!t.prefs.daysPerWeek) setDays(v === 'minmax' ? 5 : 4);
        }} options={[{ v: 'minmax', l: 'Min-max' }, { v: 'landmarks', l: 'Volume' }]} />
      </TrainField>
      {/* The one place the food side of the app gets to answer a training question. Recovery is
          lower in a deficit, and low volume holds muscle perfectly well, so somebody cutting has
          already told us which of the two they should be on. */}
      {cutting && (
        <div className="text-[12px] mb-4 -mt-1 leading-snug px-3 py-2.5"
          style={{ background: 'color-mix(in srgb, var(--accent) 10%, var(--surface2))', color: 'var(--text2)' }}>
          {style === 'minmax'
            ? 'You are eating in a deficit, so this is the one I would pick anyway: recovery is lower down there and low volume holds muscle perfectly well.'
            : 'You are eating in a deficit. Min-max is the safer bet while you are cutting - there is less to recover from, and low volume holds muscle just fine.'}
        </div>
      )}

      <TrainField label="Days a week" effect={preview ? preview.sessions.length + ' sessions' : ''}
        hint={draftDays > 0 && asBrought
          ? 'Which track I pull from a source that offers more than one. "As brought" below runs their days as written, so this does not change the count.'
          : (style === 'minmax'
            ? 'Five is the shape min-max is written for: upper, lower, rest, upper, lower, arms, rest. Fewer works, and the rest days move with it.'
            : 'How many sessions you get, whatever a plan you brought happened to be written across. Also which track I pull from a source that offers more than one.')}>
        <Seg value={days} onChange={setDays} options={[2, 3, 4, 5, 6].map(n => ({ v: n, l: String(n) }))} />
      </TrainField>
      <TrainField label="How long a session" effect={preview ? preview.movesEach + ' movements' : ''}
        hint={draftDays > 0 && !asBrought
          ? 'Decides how many movements I choose for myself. Movements you brought are kept on top of that, so a long plan makes a longer session rather than a shorter plan.'
          : 'Decides how many movements fit.'}>
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
      {/* Nothing to choose once every working set ends when the weight stops moving. The control
          stays for the volume model, where the trade between sets and effort is still open. */}
      {style !== 'minmax' && (
      <TrainField label="Training intensity" hint={intensity === 'high'
        ? 'High intensity, lower volume: fewer sets, closer to true failure by the last week. Our default.'
        : 'More volume, moderate effort: more sets, always a rep or two in reserve.'}>
        <Seg value={intensity} onChange={setIntensity} options={[{ v: 'high', l: 'High intensity' }, { v: 'moderate', l: 'More volume' }]} />
      </TrainField>
      )}
      {/* With something in the basket this is no longer only about deloads: it is the choice between
          somebody else's block and one of yours informed by it, which is the question anybody who has
          just uploaded a coach's programme is actually asking. */}
      <TrainField label="Block shape"
        hint={draftDays > 0
          ? (asBrought
            ? 'Their plan, their sets, their numbers, run for four weeks. Nothing of mine added.'
            : shapeDef.label + ' What you brought sets the movements; the sets, the climb and the day count are mine.')
          : shapeDef.label}>
        <Seg value={shape} onChange={setShape} options={(style === 'minmax'
          ? [{ v: 'minmax6', l: '6 weeks' }, { v: 'build4', l: '4 weeks' }]
          : [{ v: 'build4', l: 'Build 4' }, { v: 'build3-deload1', l: '3 + light week' }]
        ).concat([{ v: 'as-written', l: 'As brought' }])} />
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

      {/* What is about to happen to what they brought, in one line, next to the button that does it.
          The day count is the person's answer, not the source's: a plan that arrived across eight
          screenshots is eight photographs, not an eight-day week, and picking five used to be
          quietly overruled by however many days happened to be in the basket. */}
      {draftDays > 0 && (
        <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
          {asBrought
            ? 'Building the ' + draftDays + ' ' + (draftDays === 1 ? 'day' : 'days') + ' you brought exactly as written, for four weeks.'
            : 'Building you ' + days + ' sessions a week from what you brought: their movements, rep ranges and tempos, laid out '
              + 'across ' + days + ' days and built up against your own volume landmarks.'}
          {/* Every movement they brought is kept if it possibly can be, so the one thing worth saying
              here is whether any of them could not be - named, because "2 did not fit" is the kind of
              sentence that makes somebody go back and count. */}
          {!asBrought && preview && preview.brought > 0 && (
            preview.spare.length
              ? ' All ' + (preview.brought - preview.spare.length) + ' of your ' + preview.brought + ' movements are in it, except '
                + preview.spare.slice(0, 3).join(', ') + (preview.spare.length > 3 ? ' and ' + (preview.spare.length - 3) + ' more' : '')
                + ' - no room, or kit this gym has not got.'
              : ' All ' + preview.brought + ' of the movements you brought are in it.'
          )}
        </div>
      )}
      <button onClick={build} disabled={busy} className="pixel-btn w-full h-14 font-bold mt-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
        {busy ? 'Building...' : draftDays > 0 ? (asBrought ? 'Build it exactly as brought' : 'Build my ' + days + '-day version') : 'Build it'}
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
  // The block being edited decides which landmarks it is judged against, not the wizard's last answer.
  const targets = trainTargets(db, block ? block.style : undefined);
  const isNew = !saved;

  const sessions = Training.weekSessions(block, week).slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const cov = Training.coverage(Training.blockWeekVolume(block, week, t.custom), targets);
  // Movements the plan left open, e.g. "Squat (Your Choice)". Empty for anything the app generated,
  // which never leaves a slot open: it has already made the pick.
  const choices = Training.blockChoices(block, t.custom);
  const techniques = Training.weekSessions(block, 1).reduce((a, s) => a + (s.exercises || []).filter(e => e.technique).length, 0);

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
      // Prescribed the way THIS block prescribes things. A movement dropped into a min-max block was
      // arriving with the volume model's ramp - three reps in reserve in week one, walking down -
      // in the middle of a block where every other movement takes its last set to failure.
      s.exercises.push(Object.assign({ id: exId + '_' + trainUid(), order: s.exercises.length },
        Training.newItemFor(exId, { style: b.style, week: s.week, window: s.window, custom: t.custom })));
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
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Your call</div>
          <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
            {choices.length === 1 ? 'One movement in this plan is' : choices.length + ' movements in this plan are'} left up to you. Pick once and it applies to every week.
          </div>
          {choices.map(c => (
            <div key={c.key} className="mb-3">
              <div className="text-[12.5px] font-semibold mb-1">{c.label}</div>
              <div className="text-[10.5px] mb-2" style={{ color: 'var(--muted2)' }}>{c.sessions.join(', ')}</div>
              <div className="flex gap-2 flex-wrap">
                {c.options.map(id => {
                  const ex = Training.byId(id, t.custom);
                  const on = c.picked === id;
                  return (
                    <button key={id} onClick={() => edit(b => { Training.applyChoice(b, c.key, id); })}
                      className="pixel-box px-2.5 text-[11px]" style={{
                        minHeight: 44,
                        background: on ? 'var(--good)' : 'var(--surface2)',
                        color: on ? '#05140a' : 'var(--text2)',
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
                        {it.choice && (
                          <span className="pf text-[7px] uppercase ml-1.5 px-1 py-0.5 align-middle"
                            style={{ border: '1px solid var(--accent)', color: 'var(--accent-ink)', letterSpacing: '0.08em' }}>Your call</span>
                        )}
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
        <ActionSheet kicker="Movement" title={itemEx ? itemEx.name : 'This movement'} onClose={() => setMenuFor(null)}
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
          <ActionSheet kicker="Swap" title={(to ? to.name : 'That') + ' instead of ' + (from ? from.name : 'it')}
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