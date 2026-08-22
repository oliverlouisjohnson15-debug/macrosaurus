/* ---- train ----------------------------------------------------------------------
 * everything that happens around a block: the shelf, coverage, the review, the library, importing, gyms, and the write-ups
 *
 * Part of the Train module, which was one 6,200-line file. The sources have no imports:
 * build.mjs concatenates them in the order given by app/src/manifest.json and hands the lot
 * to Babel, so everything here shares one scope with the rest of the app. Function
 * declarations hoist across the whole bundle, which is why these files can call each other
 * freely; module-level `const` does not, so anything declared with one has to appear before
 * the code that reads it AT MODULE SCOPE. Nothing here does, but that is the rule.
 * ------------------------------------------------------------------------------------- */
function BlockList({ db, update, showToast, onBack, onOpen, onNew, onCoverage, onReview, onStart, onProgramme }) {
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

  // Load a block file: a plan somebody already owns, brought straight in. It goes into THEIR blocks
  // and nowhere else - nothing here publishes, and a plan bought from a coach is not ours to put in
  // front of anybody else.
  //
  // Two kinds land here. A block file (.json) has already been read exactly. A SPREADSHEET is read
  // exactly right now: Training.blocksFromGrid takes the grid off the sheet - every set, rep range,
  // RIR pair, rest, substitution and note, all twelve weeks of it - and no model sees it. That is
  // the difference between this and the wizard's importer, which reads a photograph and therefore
  // has to guess, and which can only fit about a quarter of a long sheet into a prompt anyway.
  const [loadBusy, setLoadBusy] = useState('');
  async function loadBlockFile(file) {
    if (!file) return;
    setLoadBusy('Reading it...');
    try {
      const sheet = /\.xlsx$/i.test(file.name || '') || (file.type || '').indexOf('spreadsheetml') !== -1;
      const res = sheet ? await blocksFromSpreadsheet(file, t.custom) : Training.blocksFromFile(await file.text(), { custom: t.custom, fileName: file.name });
      if (!res || !res.blocks.length) throw new Error('I could not find a written programme in that. A block file, or a spreadsheet with a week marker, a day name and one movement a row.');
      addOwnedBlocks(update, res);
      showToast && showToast(res.blocks.length === 1 ? 'Block added.' : res.blocks.length + ' blocks added.');
      setLoadBusy(res.problems.length ? res.problems.slice(0, 3).join('. ') + '.' : '');
    } catch (e) {
      setLoadBusy((e && e.message) || 'That file could not be read.');
    }
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

      {/* A block you already own, as a file. The wizard's importer reads a plan somebody photographed
          and has to guess at every line; a file has already been read exactly, so this path does no
          guessing at all - and it is the honest way to bring in a programme you paid for, because
          nothing about it is published or shared. */}
      <label className={'pixel-box flex items-center justify-center h-12 text-[12.5px] mb-4 ' + (loadBusy === 'Reading it...' ? 'opacity-60' : 'cursor-pointer')}
        style={{ background: 'var(--surface2)' }}>
        {loadBusy === 'Reading it...' ? loadBusy : 'Load a block file or spreadsheet'}
        <input type="file" className="hidden" accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={loadBusy === 'Reading it...'}
          onChange={e => { loadBlockFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
      </label>
      {loadBusy && loadBusy !== 'Reading it...' && (
        <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--warn)' }}>{loadBusy}</div>
      )}

      {/* The shipped programmes, here as well as on the tab: once you have a block the tab's empty
          state is gone, and this is where somebody comes looking for another one. */}
      <ProgrammeCards db={db} className="mb-4"
        onPick={(key) => onProgramme && onProgramme(key)} />

      {blocks.map(block => {
        const comp = Training.completion(block, t.logs.filter(l => l.blockId === block.id), Store.todayISO());
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
        return <ActionSheet kicker="Repairs" title={'Bring "' + fixing.name + '" up to date'} actions={actions} onClose={() => setFixing(null)} />;
      })()}
      {confirm && (
        <ConfirmDialog title={'Delete "' + confirm.name + '"?'}
          body={(Training.completion(confirm, t.logs.filter(l => l.blockId === confirm.id), Store.todayISO()).done
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
  // Same rule as everywhere else that draws a coverage bar: the block decides which landmarks it is
  // measured against, because six sets means two different things on the two styles.
  const targets = trainTargets(db, block ? block.style : undefined);
  const today = Store.todayISO();
  const prog = block ? Training.blockProgress(block, today) : null;
  const [week, setWeek] = useState(prog ? prog.week : 1);
  const [lens, setLens] = useState('planned');
  const [advice, setAdvice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [allMuscles, setAllMuscles] = useState(false);

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
        {/* Collapsed to the three closest to a band edge only when the week is clean - which is the
            state a working block is in most weeks, and seventeen identical green bars answering a
            question nobody asked was the flattest screen in the module. The moment anything IS short
            or over, the fuller picture is the more useful default: a gap is a question about the
            whole week, not one muscle. */}
        {(() => {
          const clean = cov.gaps.length === 0 && cov.overs.length === 0;
          if (!clean || allMuscles) return <CoverageBars coverage={cov} />;
          const edge = r => Math.min(Math.abs(r.sets - r.mev), Math.abs(r.sets - r.mrv));
          const worst = cov.rows.slice().sort((a, b) => edge(a) - edge(b)).slice(0, 3);
          return (
            <>
              <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
                Nothing to fix. The three closest to their band's edge, if you want somewhere to look:
              </div>
              <div className="flex flex-col gap-2.5">
                {worst.map(r => <CoverageRow key={r.muscle} row={r} compact />)}
              </div>
            </>
          );
        })()}
        {cov.gaps.length === 0 && cov.overs.length === 0 && (
          <button onClick={() => setAllMuscles(v => !v)} className="w-full text-left mt-3 pt-3 text-[12px]"
            style={{ borderTop: '2px solid var(--border)', color: 'var(--accent-ink)' }}>
            {allMuscles ? 'Show fewer' : 'All ' + cov.rows.length + ' muscles · open ›'}
          </button>
        )}
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
// The "+ N more" fold for a list of lifts, where a review shows only the biggest movers up front.
// A local toggle rather than state lifted into the caller: nothing outside this list needs to know.
function ExpandableLiftList({ lifts }) {
  const [open, setOpen] = useState(false);
  const row = l => (
    <div key={l.exerciseId} className="flex items-baseline justify-between gap-2 px-3.5 py-2.5" style={{ borderTop: '2px solid var(--border)' }}>
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
  );
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full text-left px-3.5 py-3 text-[12px]"
        style={{ borderTop: '2px solid var(--border)', color: 'var(--accent-ink)' }}>
        + {lifts.length} more, all readable · show ›
      </button>
    );
  }
  return <>{lifts.map(row)}</>;
}

function BlockReviewScreen({ db, update, showToast, isPremium, onUpgrade, blockId, onBack, onNext, onRerun }) {
  useBackClose(onBack);
  const t = tdb(db);
  const block = t.blocks.filter(b => b.id === blockId)[0];
  // Judged against the landmarks of the style THIS block is written for, not whatever the wizard
  // was last set to: six sets of chest is a thin week on one model and a complete one on the other.
  const targets = trainTargets(db, block ? block.style : undefined);
  const units = t.prefs.units;
  const [prose, setProse] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!block) return <div className="fade-in"><button onClick={onBack} className="pf text-[9px] uppercase" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button><div className="mt-6 text-[13px]">That block is gone.</div></div>;
  const review = Training.reviewBlock(block, t.logs, targets, t.custom, Store.todayISO());

  async function writeUp() {
    if (!isPremium) { onUpgrade && onUpgrade('blockreview'); return; }
    setBusy(true);
    try { setProse(await blockReviewProse(db, review)); }
    catch (e) { setProse('Could not reach ' + buddyName(db) + ' just now. The numbers below are still yours.'); }
    setBusy(false);
  }
  return (
    <div className="fade-in pb-2">
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
          custom: t.custom, todayISO: Store.todayISO(),
          inDeficit: !!(db.profile && db.profile.goalType === 'cut') && !db.paused,
          poorSleep: recentSleepShort(db),
        });
        const tone = d.needed ? 'var(--warn)' : d.borderline ? 'var(--muted)' : 'var(--good)';
        return (
          <Card className="p-4 mb-4" style={{ background: d.needed ? 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' : 'var(--card)' }}>
            <div className="pf text-[9px] uppercase mb-2" style={{ color: tone }}>
              The verdict · {d.needed ? 'Take a lighter week' : d.borderline ? 'Your call' : 'Straight on'}
            </div>
            <div className="text-[13px] leading-snug mb-2">{d.advice}</div>
            {(d.reasons.length > 0 || review.adherence < 60) && (
              <div className="text-[11.5px] leading-snug" style={{ color: 'var(--muted)' }}>
                {d.reasons.map(r => r.text).join(' ')}
                {/* deloadAdvice already names the percentage when it is low enough to score, so this
                    adds the reframe without repeating the number. */}
                {review.adherence < 60 ? ' A plan you cannot get to is a plan to change, not a body to blame - shorter sessions or fewer days next time.' : ''}
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

      {/* The biggest movers, signed and already sorted that way by the engine, rather than ten rows
          in session order. The question this card answers is "did it work", not "list everything". */}
      {review.lifts.length > 0 && (
        <Card className="p-0 overflow-hidden mb-4">
          <CardHead title="Your lifts" right="biggest movers" />
          {review.lifts.slice(0, 3).map(l => (
            <div key={l.exerciseId} className="flex items-baseline justify-between gap-2 px-3.5 py-2.5" style={{ borderTop: '2px solid var(--border)' }}>
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
          {review.lifts.length > 3 && <ExpandableLiftList lifts={review.lifts.slice(3)} />}
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
          here: you agreed to this block as a picture, and this is that picture again next to what
          you actually did with it. */}
      {(() => {
        const read = readBlock(block);
        if (!read) return null;
        return (
          <Card className="p-0 overflow-hidden mb-4">
            <CardHead title={read.splitName} right={read.weekSets + ' sets / wk'} />
            <div className="p-3.5">
              <div className="text-[11px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>What you signed up for, {block.weeks} {block.weeks === 1 ? 'week' : 'weeks'} ago.</div>
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

      {/* One way on, not two. "Build a new one" threw the plan away and generated a fresh block,
          which is the wrong answer for anyone who imported a coach's programme, liked it, and wants
          another run with what stalled changed - and it is also what "Run this again" already is:
          RerunScreen keeps every movement that worked, offers a change only where the evidence says
          so, and now learns your landmarks the same way this button used to. Nothing this page could
          do is left on the path fewer people were taking. */}
      <StickyAction>
        <button onClick={() => onRerun(block.id)} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          Plan the next block ›
        </button>
      </StickyAction>
    </div>
  );
}

// ---- running the same block again ---------------------------------------------------------------
// The three tones a verdict comes in, and the words that go with them. Same grammar as the deload
// advice on the screen before this one, deliberately: somebody has just read "Straight on / Your
// call / Take a lighter week" and should not have to learn a second scale a tap later.
const ROTATE_TONE = {
  rotate: { label: 'Worth changing', color: 'var(--warn)' },
  'your-call': { label: 'Your call', color: 'var(--muted)' },
  keep: { label: 'Keep it', color: 'var(--good)' },
};
const ROLE_LABEL = { anchor: 'Anchor lift', main: 'Main lift', accessory: 'Accessory' };

// One movement, its verdict, the evidence behind it, and what it could become.
function RotationCard({ lift, on, chosen, onToggle, onPick, muted }) {
  const tone = ROTATE_TONE[lift.verdict] || ROTATE_TONE.keep;
  return (
    <Card className="p-4 mb-3" style={{ opacity: muted && !on ? 0.62 : 1 }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          {/* Once it is switched on, the label has to say what is HAPPENING. It read "Keep it" over a
              card showing an arrow to a replacement, which is the app disagreeing with itself. */}
          <div className="pf text-[9px] uppercase mb-2" style={{ color: on ? 'var(--accent-ink)' : tone.color }}>
            {on ? 'Changing' : tone.label} &middot; {ROLE_LABEL[lift.role]}{lift.dayName ? ' · ' + lift.dayName : ''}
          </div>
          <div className="text-[13.5px] font-semibold leading-tight">
            {on && chosen ? <span>{lift.name} &rarr; {chosen.name}</span> : <span>{lift.name}</span>}
          </div>
        </div>
        <button onClick={onToggle} disabled={!lift.candidates.length}
          className="pf text-[9px] px-3 py-2 shrink-0 hit"
          style={{
            background: on ? 'var(--accent)' : 'var(--surface3)',
            color: on ? 'var(--on-accent)' : 'var(--muted)',
            border: '2px solid var(--border)', opacity: lift.candidates.length ? 1 : 0.4,
          }}>
          {on ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* The evidence, not a verdict on its own. Somebody turning a rotation down is entitled to see
          exactly what the app thought it knew. */}
      {lift.reasons.length > 0 && (
        <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
          {/* The two that carried the verdict, not all of them. They are pushed in weight order, and
              four sentences of hedging on a movement nobody is changing is a card people stop reading. */}
          {lift.reasons.slice(0, 2).map(r => r.text).join(' ')}
        </div>
      )}

      {on && (lift.candidates || []).length > 1 && (
        <div className="flex gap-2 flex-wrap mt-3">
          {lift.candidates.map(c => {
            const picked = chosen && chosen.id === c.id;
            return (
              <button key={c.id} onClick={() => onPick(c)} className="pixel-box px-2 py-2 text-[11px] text-left hit"
                style={{ background: picked ? 'var(--good)' : 'var(--surface2)', color: picked ? '#05140a' : 'var(--text2)' }}>
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {on && chosen && chosen.note && (
        <div className="text-[11px] leading-snug mt-2" style={{ color: 'var(--muted)' }}>{chosen.note}</div>
      )}
      {/* What it costs, said once, where the decision is being made rather than in a help screen
          nobody opens. Only on the lifts where the cost is real. */}
      {on && lift.cost && (
        <div className="pixel-box p-2.5 mt-3" style={{ background: 'var(--surface3)', boxShadow: 'none' }}>
          <div className="text-[11px] leading-snug" style={{ color: 'var(--text2)' }}>{lift.cost}</div>
        </div>
      )}
    </Card>
  );
}

// Every proposal Training.rerunPlan made, each with the reason it was made and a switch. Nothing is
// applied until you say so, and what you turn down survives exactly as your coach wrote it. The
// engine decides WHAT to propose; this screen only decides what you accepted.
//
// Movements are the rotation engine's business and volume is rerunPlan's, which is why the two lists
// are drawn separately from two calls. They used to be one list of "swaps", and it could not answer
// the question people actually arrive with: not "what does the app want to change" but "I have run
// this incline dumbbell press for three blocks, what else could it be?". Every movement in the block
// is therefore listed and switchable, with the engine's opinion attached rather than in charge.
function RerunScreen({ db, update, showToast, blockId, onBack, onDraft }) {
  useBackClose(onBack);
  const t = tdb(db);
  const block = t.blocks.filter(b => b.id === blockId)[0];
  // Judged against the landmarks of the style THIS block is written for, not whatever the wizard
  // was last set to: six sets of chest is a thin week on one model and a complete one on the other.
  // Read AFTER the block it is reading from: this line used to sit above it and threw on every
  // visit, which is a whole screen dying to a two-line reorder.
  const targets = trainTargets(db, block ? block.style : undefined);
  const gym = currentGym(db);
  const kit = gym ? Training.gymEquipment(gym) : null;
  const plan = useMemo(() => (block ? Training.rerunPlan(block, t.logs, targets, t.custom) : null), [blockId]);
  const rot = useMemo(() => (block ? Training.rotationPlan(block, t.logs, targets, {
    custom: t.custom, equipment: kit, dislikes: t.prefs.dislikes,
    bench: !gym || gym.bench !== false, bar: !gym || gym.pullupBar !== false,
  }) : null), [blockId]);
  const [off, setOff] = useState({});          // volume proposals turned down, by index
  const [swaps, setSwaps] = useState(null);     // rotation choices, by exerciseId
  const [showAll, setShowAll] = useState(false);
  const [expandedKeep, setExpandedKeep] = useState({});  // "keep as-is" rows opened out to the full card

  // The engine's answer is the starting position, not the state: seed once, then it is yours.
  const chosen = swaps || (rot ? rot.lifts.reduce((a, l) => {
    if (l.on && l.candidates.length) a[l.exerciseId] = l.candidates[0];
    return a;
  }, {}) : {});
  const setChosen = (fn) => setSwaps(s => fn(s || chosen));

  if (!block || !plan || !rot) {
    return (
      <div className="fade-in">
        <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
        <Card className="p-4"><div className="text-[13px]">That block is not here any more.</div></Card>
      </div>
    );
  }

  // rerunPlan still owns the volume decisions. Its own swap proposals are dropped here because the
  // rotation list below covers the same ground with the whole block in view rather than only the
  // lifts that stalled.
  const volume = plan.changes.filter(c => c.kind === 'sets' || c.kind === 'add');
  const rotations = Object.keys(chosen).map(id => {
    const lift = rot.lifts.filter(l => l.exerciseId === id)[0];
    return lift ? { day: lift.day, index: lift.index, from: id, to: chosen[id].id } : null;
  }).filter(Boolean);
  const acceptedVolume = volume.map((c, i) => ({ c, i })).filter(x => !off[x.i]).map(x => x.c);
  const changeCount = rotations.length + acceptedVolume.length;

  // Worth a decision now; everything else is a keystroke away rather than gone. "Any movement, if
  // you want to" is the whole point, so nothing is hidden, only folded.
  const upFront = rot.lifts.filter(l => l.verdict !== 'keep' || chosen[l.exerciseId]);
  const rest = rot.lifts.filter(l => upFront.indexOf(l) === -1);

  function toggle(lift) {
    if (!lift.candidates.length) return;
    setChosen(c => {
      const next = Object.assign({}, c);
      if (next[lift.exerciseId]) delete next[lift.exerciseId];
      else next[lift.exerciseId] = lift.candidates[0];
      return next;
    });
  }

  function build() {
    // What the block just taught about your own recovery, merged into the shared landmarks table
    // before the next block is built off it. This used to live only in the OTHER way out of "How it
    // went", which meant choosing "run it again" - the answer most people actually want - quietly
    // skipped the learning. One button now, so it cannot be skipped by picking the popular option.
    const learned = Training.targetChanges(targets, Training.tuneTargets(targets, plan.review, { style: block.style }));
    if (Object.keys(learned).length) {
      trainUpdate(update, (tr) => {
        const key = Training.styleOf(block.style).toFailure ? 'volumeTargetsMinmax' : 'volumeTargets';
        tr[key] = Object.assign({}, tr[key] || {}, learned);
      });
    }
    const out = Training.applyRotation(block, rotations, {
      targets: targets, custom: t.custom, startISO: Store.todayISO(), also: acceptedVolume,
    });
    // The lineage is what keeps a rotated lift's history readable as one run instead of two stubs,
    // so it is written whether or not the draft is ever started: it describes a decision that was
    // made, and the block it belongs to carries its own id.
    if (out.rotations.length) trainUpdate(update, (tr) => { tr.rotations = (tr.rotations || []).concat(out.rotations); });
    onDraft(out.block);
  }

  const LABEL = { sets: 'More work', add: 'Missing' };
  return (
    <div className="fade-in pb-2">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; How it went</button>
      <h1 className="pf text-lg mb-1">Run it again</h1>
      <div className="text-[12px] mb-4 leading-snug" style={{ color: 'var(--muted)' }}>{rot.headline}</div>

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

      {/* Grouped by what the numbers say: the movements worth a decision get the full card,
          everything that earned its place is a row you skim in one line. Both had the same visual
          weight before, which is how thirty-four identical cards happened. */}
      {upFront.length > 0 && (
        <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--accent-ink)' }}>Worth a change · {upFront.length}</div>
      )}
      {upFront.map(l => (
        <RotationCard key={l.exerciseId + '_' + l.day + '_' + l.index} lift={l} on={!!chosen[l.exerciseId]}
          chosen={chosen[l.exerciseId]} onToggle={() => toggle(l)}
          onPick={(c) => setChosen(x => Object.assign({}, x, { [l.exerciseId]: c }))} />
      ))}

      {/* Rotating everything at once is the failure mode the research actually names, so the count is
          said out loud rather than enforced silently. */}
      {rotations.length > (rot.caps.main + rot.caps.accessory) && (
        <Card className="p-4 mb-3" style={{ background: 'color-mix(in srgb, var(--warn) 12%, var(--surface2))' }}>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--warn)' }}>That is a lot at once</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--text2)' }}>
            You are changing {rotations.length} movements. Nothing stops you, but a block where most of
            it is new is a block you cannot compare to this one, and none of what happens can be pinned
            on any one change.
          </div>
        </Card>
      )}

      {/* Everything that earned its place, one line each rather than a dozen near-identical cards
          all saying "nothing to say it has stopped working yet". Any of them is still one tap from
          the full card, because "not that one, THAT one" is a real thing to want even from a lift
          that is doing fine. Three shown, which is enough to prove the list is honest. */}
      {rest.length > 0 && (
        <Card className="p-0 overflow-hidden mb-3">
          <CardHead title="Keep as-is" right={String(rest.length)} />
          {(showAll ? rest : rest.slice(0, 3)).map(l => {
            const key = l.exerciseId + '_' + l.day + '_' + l.index;
            if (expandedKeep[key]) {
              return (
                <div key={key} className="p-3.5" style={{ borderTop: '2px solid var(--border)' }}>
                  <RotationCard lift={l} on={!!chosen[l.exerciseId]} chosen={chosen[l.exerciseId]}
                    onToggle={() => toggle(l)} onPick={(c) => setChosen(x => Object.assign({}, x, { [l.exerciseId]: c }))} />
                </div>
              );
            }
            return (
              <button key={key} onClick={() => setExpandedKeep(x => Object.assign({}, x, { [key]: true }))}
                className="w-full text-left px-3.5 py-3 flex items-center justify-between gap-3" style={{ borderTop: '2px solid var(--border)' }}>
                <span className="text-[13px] font-semibold truncate">{l.name}</span>
                <span className="pf text-[9px] uppercase shrink-0" style={{ color: l.deltaPct > 1 ? 'var(--good-ink)' : 'var(--accent-ink)' }}>
                  {l.deltaPct > 1 ? 'trend ↗' : 'swap ›'}
                </span>
              </button>
            );
          })}
          {rest.length > 3 && (
            <button onClick={() => setShowAll(v => !v)} className="w-full text-left px-3.5 py-3 text-[12px]"
              style={{ borderTop: '2px solid var(--border)', color: 'var(--accent-ink)' }}>
              {showAll ? 'Show fewer' : '+ ' + (rest.length - 3) + ' more, all readable · show ›'}
            </button>
          )}
        </Card>
      )}

      {volume.length > 0 && (
        <div className="pf text-[9px] uppercase mb-2 mt-5" style={{ color: 'var(--accent-ink)' }}>How much</div>
      )}
      {volume.map((c, i) => {
        const isOff = !!off[i];
        return (
          <Card key={i} className="p-4 mb-3" style={{ opacity: isOff ? 0.5 : 1 }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="pf text-[9px] uppercase mb-2" style={{ color: c.kind === 'add' ? 'var(--warn)' : 'var(--accent-ink)' }}>
                  {LABEL[c.kind]}{c.dayName ? ' · ' + c.dayName : ''}
                </div>
                <div className="text-[13.5px] font-semibold leading-tight">
                  {c.kind === 'sets' && <span>{c.fromName}, {c.from} to {c.to} sets</span>}
                  {c.kind === 'add' && <span>Add {c.toName}, {c.sets} sets</span>}
                </div>
              </div>
              <button onClick={() => setOff(o => Object.assign({}, o, { [i]: !isOff }))}
                className="pf text-[9px] px-3 py-2 shrink-0 hit"
                style={{ background: isOff ? 'var(--surface3)' : 'var(--accent)', color: isOff ? 'var(--muted)' : 'var(--on-accent)', border: '2px solid var(--border)' }}>
                {isOff ? 'OFF' : 'ON'}
              </button>
            </div>
            <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>{c.why}</div>
          </Card>
        );
      })}

      <StickyAction>
        <button onClick={build} className="pixel-btn w-full h-14 font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
          Build it{changeCount ? ' with ' + changeCount + ' change' + (changeCount === 1 ? '' : 's') : ' unchanged'}
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
function TrainHistory({ db, update, onBack, onOpenExercise, onOpenSession }) {
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
          {shown.length > 0 && (() => {
            // Recency grouping rather than one flat twenty-six-row wall. What you did this week is
            // what most visits are checking, and it earns a section instead of being row one of
            // twenty-six with nothing marking where "recent" stops.
            const todayISO = Store.todayISO();
            const weekAgo = new Date(Date.parse(todayISO + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10);
            const thisWeek = shown.filter(l => l.lastISO >= weekAgo);
            const earlier = shown.filter(l => l.lastISO < weekAgo);
            const row = (l, i) => (
              <button key={l.exerciseId} onClick={() => onOpenExercise(l.exerciseId)}
                className="w-full text-left px-3.5 py-3 flex items-start justify-between gap-3"
                style={{ borderTop: '2px solid var(--border)' }}>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-tight">{l.name}</span>
                  <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                    {relativeDay(l.lastISO, todayISO)} · {l.sessions} {l.sessions === 1 ? 'session' : 'sessions'}
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
            );
            const heading = (label, ruled) => (
              <div className="px-3.5 pt-3 pb-1 pf text-[8px] uppercase"
                style={{ color: 'var(--muted)', letterSpacing: '0.1em', borderTop: ruled ? '2px solid var(--border)' : null }}>{label}</div>
            );
            return (
              <Card className="p-0 overflow-hidden">
                <CardHead title="Your lifts" right="Best set shown" />
                {thisWeek.length > 0 && heading('This week', false)}
                {thisWeek.map(row)}
                {earlier.length > 0 && heading('Earlier', thisWeek.length > 0)}
                {earlier.map(row)}
              </Card>
            );
          })()}
        </div>
      )}

      {tab === 'sessions' && (
        <div>
          {logs.length === 0 && (
            <Card className="p-4"><div className="text-[13px]" style={{ color: 'var(--muted)' }}>Nothing logged yet. Your first session will show up here.</div></Card>
          )}
          {logs.map(l => {
            const exIds = [];
            // What was actually LIFTED. A movement whose sets were all left unticked was not part of
            // the session, and listing it here would put a lift you skipped in your history.
            (l.sets || []).forEach(s => { if (s.done && exIds.indexOf(s.exerciseId) === -1) exIds.push(s.exerciseId); });
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
                  {liveLog(l, Store.todayISO()) && <span style={{ color: 'var(--warn)' }}> · still open</span>}
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
                {/* A session you have already done is a thing you can go back into, not just a
                    receipt with a Delete under it. You mistyped 100 for 10, you forgot to tick the
                    last two sets, you walked out half-way and finished the session at home: every
                    one of those wanted the session opened again, and the only thing this card
                    offered was throwing the whole night away and starting it from nothing. It opens
                    in the same runner it was logged in, on ITS day rather than today. */}
                <div className="flex items-center gap-3 mt-2">
                  {onOpenSession && (
                    <button onClick={() => onOpenSession(l)} className="pixel-box px-3 py-2 text-[11.5px]" style={{ background: 'var(--surface2)' }}>
                      {liveLog(l, Store.todayISO()) ? 'Carry on with it' : 'Open & edit'}
                    </button>
                  )}
                  <button onClick={() => setConfirm(l.id)} className="text-[10px]" style={{ color: 'var(--muted2)' }}>Delete</button>
                </div>
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
  // The whole run, across every movement this one was rotated into or out of. A rotation restarts
  // the load and nothing else, so a chart that restarts with it turns "I changed the implement" into
  // "I lost my progress", which is both untrue and the fastest way to stop anybody ever rotating
  // anything. Where nothing was ever rotated this is exactly exerciseHistory, so nothing changes for
  // the movements it does not apply to.
  const hist = Training.familyHistory(t.logs, exerciseId, t.custom, t.rotations);
  // Judged on this movement alone, though: a stall is about whether THIS lift is moving, and the
  // sessions before the change were a different exercise.
  const own = hist.filter(h => h.exerciseId === exerciseId);
  const stall = Training.detectStall(own);
  const max = Math.max.apply(null, hist.map(h => h.e1rm).concat([1]));
  const cameFrom = hist.length && hist[0].exerciseId !== exerciseId ? hist.filter(h => h.changed).slice(-1)[0] : null;
  // Where you stand and which way it has gone: the chart shows the shape, this says what it means.
  const shownHist = hist.slice(-24);
  const firstRow = shownHist[0], latest = shownHist[shownHist.length - 1];
  const delta = firstRow && firstRow.e1rm > 0 && latest ? Math.round(((latest.e1rm - firstRow.e1rm) / firstRow.e1rm) * 1000) / 10 : 0;
  const isPB = !!(latest && latest.e1rm > 0 && latest.e1rm >= max);
  // Month ticks under the chart, rather than two raw ISO dates at its ends: "Jun / Jul / Aug" is
  // what anybody scanning the shape of a run actually reads it against.
  const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthTicks = [];
  shownHist.forEach((h, i) => {
    const m = MONTH[parseInt(h.dateISO.slice(5, 7), 10) - 1];
    if (!monthTicks.length || monthTicks[monthTicks.length - 1].label !== m) monthTicks.push({ label: m, i: i });
  });

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; History</button>
      <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)' }}>Movement</div>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h1 className="text-[19px] font-bold leading-tight">{ex ? ex.name : exerciseId}</h1>
        {/* The PR moment the block review celebrates gets a home outside the session too. */}
        {isPB && (
          <span className="pf text-[8px] uppercase shrink-0 px-2 py-1" style={{ background: 'var(--accent)', color: 'var(--on-accent)', letterSpacing: '0.08em' }}>PB ▲</span>
        )}
      </div>
      <div className="mb-6"><MuscleTags exerciseId={exerciseId} custom={t.custom} /></div>

      {hist.length > 1 && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-1" style={{ color: 'var(--muted)' }}>Estimated 1RM</div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="pf text-[18px] tnum">{toDisplayWeight(latest.e1rm, units)}{unitLabel(units)}</span>
            {delta !== 0 && (
              <span className="text-[12px] tnum font-bold" style={{ color: delta > 0 ? 'var(--good-ink)' : 'var(--danger)' }}>{delta > 0 ? '+' : ''}{delta}%</span>
            )}
          </div>
          <div className="flex items-end gap-1 h-24">
            {shownHist.map((h, i) => (
              <div key={i} className="flex-1" title={h.dateISO + ' · ' + h.name}
                style={{
                  height: Math.max(2, (h.e1rm / max) * 100) + '%',
                  // The sessions on an earlier movement are shown, and shown as not-this-movement:
                  // the shape of the run is the useful part, but the bars are not comparable loads.
                  background: h.exerciseId === exerciseId ? 'var(--accent)' : 'var(--surface3)',
                  borderLeft: h.changed ? '2px solid var(--warn)' : 'none',
                }} />
            ))}
          </div>
          <div className="relative mt-2" style={{ height: 12 }}>
            {monthTicks.map((tk, i) => (
              <span key={i} className="absolute text-[10px]" style={{ color: 'var(--muted2)', left: (tk.i / shownHist.length * 100) + '%' }}>{tk.label}</span>
            ))}
          </div>
        </Card>
      )}

      {cameFrom && (
        <Card className="p-4 mb-4">
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--warn)' }}>Rotated</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--text2)' }}>
            You came here from {hist.filter(h => h.exerciseId !== exerciseId).slice(-1)[0].name.toLowerCase()} on {cameFrom.dateISO}.
            The earlier sessions are in the chart in grey, because the muscle carried on from where it
            was but the weight on this movement started again.
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
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {h.dateISO}
              {h.exerciseId !== exerciseId && <span className="block text-[10px]" style={{ color: 'var(--muted2)' }}>{h.name}</span>}
            </span>
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
      const named = Object.assign({}, g, { name: uniqueGymName(tr.gyms, g.name, g.id) });
      const i = tr.gyms.findIndex(x => x.id === named.id);
      if (i >= 0) tr.gyms[i] = named; else tr.gyms.push(named);
      if (!tr.prefs.currentGymId) tr.prefs = Object.assign({}, tr.prefs, { currentGymId: named.id });
    });
    setGymEdit(null);
  }
  function set(k, v) {
    const next = Object.assign({}, prefs, { [k]: v });
    setPrefs(next);
    trainUpdate(update, (tr) => { tr.prefs = Object.assign({}, tr.prefs, { [k]: v }); });
  }
  function resetTargets() {
    const key = Training.styleOf(prefs.style).toFailure ? 'volumeTargetsMinmax' : 'volumeTargets';
    trainUpdate(update, (tr) => { tr[key] = {}; });
    showToast && showToast('Volume bands back to the defaults for your experience.');
  }
  // How many muscles' bands your own blocks have nudged away from the research defaults - the one
  // number that makes folding the seventeen-row table safe, because most visits the answer is none.
  // Judged against the defaults for the STYLE being trained, not against the volume model's. Min-max
  // lands nowhere near the volume bands by design - it is a different bet about how many hard sets a
  // muscle wants - so measuring one against the other told everybody running the house method that
  // all seventeen of their bands had been changed from default, on an account that had never touched
  // one. The line exists to say "you have not moved anything", and it could never say it.
  const defaults = Training.defaultTargets({ experience: prefs.experience, style: prefs.style });
  const changedCount = Training.MUSCLES.filter(m => targets[m].mav !== defaults[m].mav || targets[m].mrv !== defaults[m].mrv).length;
  const [bandsOpen, setBandsOpen] = useState(false);

  return (
    <div className="fade-in">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      <h1 className="pf text-lg mb-4">Training settings</h1>

      {/* Three groups by WHEN a setting matters - you, in a session, the model - rather than by when
          it happened to be added. A seventeen-row bands table and a kg/lb toggle used to sit in one
          undifferentiated list, at the same visual weight. */}
      <Card className="p-0 overflow-hidden mb-4">
        <CardHead title="You" />
        <div className="p-3.5">
          <Field label="Weight units" hint="Only changes what you see. Everything is stored the same way underneath.">
            <Seg value={prefs.units} onChange={v => set('units', v)} options={[{ v: 'kg', l: 'kg' }, { v: 'lb', l: 'lb' }]} />
          </Field>
          <Field label="Experience" hint="Sets the volume bands your coverage is judged against.">
            <Seg value={prefs.experience} onChange={v => set('experience', v)} options={[{ v: 'beginner', l: 'Newer' }, { v: 'intermediate', l: 'A while' }, { v: 'advanced', l: 'Years' }]} />
          </Field>
          <div className="pf text-[9px] uppercase mb-2" style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>Where you train</div>
          {gyms.map(g => (
            <button key={g.id} onClick={() => setGymEdit(g)} className="w-full text-left flex items-center justify-between gap-2 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold truncate">{g.name}</span>
                {/* Only when there is something left to say. On an unnamed commercial gym the kind IS
                    the name, so the second line would repeat the first - which is what made a list of
                    saved gyms read as one gym over and over. The picker marks which one you are set
                    to; so does this, because on a row of same-kind gyms it is the only thing that
                    tells one from another. */}
                {(gymSummary(g) || t.prefs.currentGymId === g.id) && (
                  <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
                    {[t.prefs.currentGymId === g.id ? 'Where you are now' : '', gymSummary(g)].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
            </button>
          ))}
          {!gyms.length && <div className="text-[12px] mb-2" style={{ color: 'var(--muted2)' }}>None saved yet. Anything a saved gym has not got is swapped for something that works.</div>}
          <button onClick={() => setGymEdit('new')} className="pixel-box w-full h-11 text-[12px] mt-2" style={{ background: 'var(--surface2)' }}>+ Add a gym</button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden mb-4">
        <CardHead title="In a session" />
        <div className="p-3.5">
          <Field label="Rest timer" hint="Starts when you tick a working set. Stays quiet after a drop set or mid-superset, where the point is not to rest.">
            <Seg value={prefs.restTimer ? 'on' : 'off'} onChange={v => set('restTimer', v === 'on')} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} />
          </Field>
          <Field label="Sound when rest ends" hint="It buzzes either way. On an iPhone with the screen off the alert can arrive late, which is a limit of installed web apps rather than something we can fix.">
            <Seg value={prefs.restSound === false ? 'off' : 'on'} onChange={v => set('restSound', v === 'on')} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} />
          </Field>
          <Field label="Plate calculator" hint="Shows what to hang on each side under barbell movements.">
            <Seg value={prefs.plateCalc === false ? 'off' : 'on'} onChange={v => set('plateCalc', v === 'on')} options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} />
          </Field>
        </div>
      </Card>

      {/* The bands table folds to a one-line summary that says whether you have touched it at all -
          which used to take reading all seventeen rows to find out - and the rules move in beside it
          as a plain read link rather than a full-width card of its own. */}
      <Card className="p-0 overflow-hidden mb-4">
        <CardHead title="Your volume bands" />
        <button onClick={() => setBandsOpen(v => !v)} className="w-full text-left flex items-center justify-between gap-2 px-3.5 py-3">
          <span className="text-[12.5px]" style={{ color: 'var(--text2)' }}>
            {Training.MUSCLES.length} muscles{changedCount ? ' · ' + changedCount + ' changed from default' : ''}
          </span>
          <span className="pf text-[9px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>{bandsOpen ? 'close' : 'open ›'}</span>
        </button>
        {bandsOpen && (
          <div className="px-3.5 pb-3.5" style={{ borderTop: '2px solid var(--border)' }}>
            <div className="text-[11px] my-3 leading-snug" style={{ color: 'var(--muted)' }}>
              These start from the research and then move as your blocks show what you recover from.
            </div>
            {Training.MUSCLES.map(m => (
              <div key={m} className="flex items-baseline justify-between py-1 text-[12px]">
                <span style={{ color: 'var(--text2)' }}>{Training.MUSCLE_LABEL[m]}</span>
                <span style={{ color: 'var(--muted)' }}>{targets[m].mev} - {targets[m].mav} <span style={{ color: 'var(--muted2)' }}>(max {targets[m].mrv})</span></span>
              </div>
            ))}
            <button onClick={resetTargets} className="pixel-box w-full py-3 text-[12px] mt-3" style={{ background: 'var(--surface2)' }}>Reset to defaults</button>
          </div>
        )}
        <button onClick={onHowItWorks} className="w-full text-left flex items-center justify-between gap-2 px-3.5 py-3" style={{ borderTop: '2px solid var(--border)' }}>
          <span className="text-[12.5px]" style={{ color: 'var(--text2)' }}>How your plan is built</span>
          <span className="pf text-[9px] uppercase shrink-0" style={{ color: 'var(--accent-ink)' }}>read ›</span>
        </button>
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
  const batch = (opts && opts.batch) || 0;
  const prompt = WORKOUT_PROMPT.replace(/\{\{DAYS\}\}/g, String(days));
  // A file in a batch is one PART of the week, not the week. Sent as a separate block after the
  // prompt rather than folded into it, so the big prompt above stays byte-identical and cacheable.
  const head = [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }].concat(
    batch > 1 ? [{ type: 'text', text: WORKOUT_BATCH_NOTE.replace(/\{\{DAYS\}\}/g, String(days)).replace(/\{\{N\}\}/g, String(batch)) }] : []);
  const j = await aiRequest({
    model: AI_MODEL, max_tokens: 3000,
    messages: [{ role: 'user', content: head.concat(content) }],
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
//
// It hands back the GRID, rows of cells, rather than text. A written programme is a grid - column 5
// is the working sets and column 13 is the rest - and Training.blocksFromGrid reads it as one,
// exactly, without a model in the way. Flattening it to text is what you do for the model, and that
// is readXlsxText below.
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
    String(rowXml).replace(/<c([^>]*?)\/>|<c([^>]*?)>([\s\S]*?)<\/c>/g, (__, selfAttrs, attrs, inner) => {
      // The self-closing case FIRST, and non-greedy. A blank-but-styled cell is written
      // `<c r="A14" s="1"/>`, and matching `<c([^>]*)>` against it captures the trailing slash
      // as an attribute and then runs on to the next `</c>` several columns later - swallowing
      // every cell in between and shifting the whole row left. A spreadsheet read that way is
      // not slightly wrong, it is reps in the rest column.
      const a = selfAttrs || attrs || '';
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
  return rows;
}

// The same read, flattened. A model gets tab-separated text; Training.blocksFromGrid gets the grid.
async function readXlsxText(file) {
  return (await readXlsx(file)).map(r => r.join('\t')).join('\n');
}

// A written programme, off a spreadsheet, exactly as written. Returns null when the sheet is not a
// programme - a food diary, a set of body-weight readings, a plan laid out some way this cannot
// read - so the caller can fall back to the importer that copes with anything.
//
// Shaped like Training.blocksFromFile's answer on purpose: the two are the same act from the
// person's point of view, which is bringing in a plan they already own.
async function blocksFromSpreadsheet(file, custom) {
  const rows = await readXlsx(file);
  const res = Training.blocksFromGrid(rows, { custom: custom, fileName: file.name, name: sheetTitle(file.name) });
  if (!res) return null;
  return {
    blocks: res.blocks, custom: res.custom,
    // Named, not silently accepted. These are in the plan - the library grew an entry for each -
    // but a guessed classification is worth a look, and the person is the one who can look.
    problems: res.unknown.length
      ? [(res.unknown.length === 1 ? 'One movement was' : res.unknown.length + ' movements were') + ' not in the library, so I added ' + (res.unknown.length === 1 ? 'it' : 'them') + ': ' + res.unknown.slice(0, 6).join(', ')]
      : [],
  };
}

// Put an imported programme on the shelf: the library entries it needed first, then the blocks,
// re-pointed at whatever those entries collapsed into. Both ways in - the block-file loader on the
// blocks screen and the wizard's exact import - write through here, so a plan somebody owns lands
// the same way whichever door it came in by.
function addOwnedBlocks(update, res) {
  trainUpdate(update, (tr) => {
    if (res.custom && res.custom.length) {
      const merged = Training.mergeCustom(tr.custom || [], res.custom);
      tr.custom = merged.custom;
      Training.remapBlocks(res.blocks, merged.map);
    }
    tr.blocks = (tr.blocks || []).concat(res.blocks);
  });
}

// "The_MinMax_Program_5x.xlsx" is a name somebody chose; "The MinMax Program 5x" is the same name
// with the file system's punctuation taken back out of it.
function sheetTitle(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  return base || 'Imported programme';
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
    const grid = await readXlsxText(file);
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
    const payload = Training.templatePayload(block);
    const template = Training.templateDays(payload);
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
      p_template: payload,
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
      <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
        {['full', 'upper_lower', 'ppl'].map(s => (
          <FilterPill key={s} on={split === s} onClick={() => setSplit(split === s ? null : s)}>{SPLIT_LABEL[s]}</FilterPill>
        ))}
      </div>
      <div className="text-[11px] mb-4" style={{ color: 'var(--muted2)' }}>Filters match your kit and recovery settings by default.</div>

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
  // The author's style, if they published one, judged against YOUR landmarks for that style. A block
  // written to be run at failure on four to ten sets a muscle has to arrive as that block; adopting
  // it into the volume model and re-periodising it produces something its author never wrote.
  const style = Training.templateStyle(pub.template);
  const days = Training.templateDays(pub.template);
  const targets = trainTargets(db, style);
  const [result] = useState(() => Training.adoptTemplate(days, {
    weeks: pub.weeks || 4, shape: pub.shape || 'build3-deload1', targets: targets, style: style,
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
        <Card className="p-4 text-center">
          {/* Every other empty state in the app has the buddy in it. */}
          <div className="flex justify-center mb-4">
            <div className="pixel-box p-2" style={{ background: 'var(--surface3)', boxShadow: 'none', lineHeight: 0 }}>
              <BuddyAvatar buddy={db.buddy || {}} px={2} />
            </div>
          </div>
          <div className="text-[13px] font-bold mb-1">Nothing collected yet</div>
          {/* What a draft IS, in one sentence. The paragraph that used to sit here described the
              button underneath it rather than the idea. */}
          <div className="text-[12px] leading-snug mb-4" style={{ color: 'var(--muted)' }}>
            A draft stacks up single sessions - import one for each day of someone's week, then build the block from the pile.
          </div>
          <button onClick={onImport} className="pixel-btn w-full h-12 font-bold mb-2" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>Import a session</button>
          {/* The escape hatch. Nothing to import yet is not the same as nothing to build, and the old
              dead end offered only the import path. */}
          <button onClick={onImport} className="text-[12px]" style={{ color: 'var(--accent-ink)' }}>
            or build straight away ›
          </button>
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
    <div className="fade-in pb-2">
      <button onClick={onBack} className="pf text-[9px] uppercase mb-4 hit" style={{ color: 'var(--accent-ink)' }}>&lsaquo; Train</button>
      {/* "Draft block" named the object; "What I read" names what you are here to do, which is check
          the app's reading of somebody else's plan before four weeks get built on top of it. */}
      <h1 className="pf text-lg mb-1">What I read</h1>
      <div className="text-[12px] mb-3 leading-snug" style={{ color: 'var(--muted)' }}>
        {draft.days.length} {draft.days.length === 1 ? 'day' : 'days'} read from your plan.{' '}
        {/* What the button at the bottom is going to do with them, said where they are being checked
            rather than left as a surprise. The day count is the person's last answer, not the number
            of days their plan happened to be photographed across. */}
        {(Training.SHAPES[t.prefs.shape] || Training.SHAPES.build4).asWritten
          ? 'They will be built exactly as written, for four weeks.'
          : 'The movements and rep ranges are theirs; the ' + (t.prefs.daysPerWeek || 4) + ' sessions a week, the sets and how the ' + plannedWeeks(t.prefs) + ' weeks run come from the builder.'}
      </div>

      {/* ---- the count bar, per `Build a block v3.dc.html` ----
          How many lines want a look, pinned while you scroll the days. The flags were already on the
          rows, but they were scattered through three day cards, so the only way to know whether you
          had dealt with them all was to scroll back up and count. This says it, and follows you.
          "Everything matched" is worth showing just as loudly: the fear with an importer is that it
          quietly dropped something, and the answer to that fear is a number, not silence. */}
      <div className="sticky z-10 -mx-5 px-5 pb-2.5 mb-3"
        style={{ top: 'var(--appbar-h)', background: 'var(--bg)' }}>
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
          {(day.exercises || []).map((e, ei) => {
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
/* The line UNDER a gym's name, so it must never be the name again.
 *
 * A gym saved without a name takes its KIND as its name (see `uniqueGymName`), and this used to open
 * with that same kind - so every unnamed gym in the list read "Bodybuilding gym" over "Bodybuilding
 * gym", and seven saved gyms looked like the same one drawn seven times. The kind is worth saying
 * only when the name has not already said it. Every caller draws `g.name` directly above this. */
function gymSummary(g) {
  if (!g) return 'Not set';
  const base = Training.GYMS[g.type] || Training.GYMS.custom;
  const bits = [];
  const named = (g.name || '').trim().toLowerCase();
  if (named !== base.label.trim().toLowerCase()) bits.push(base.label);
  if (g.type === 'home' || g.type === 'minimal') {
    bits.push(g.bench === false ? 'no bench' : 'bench');
    bits.push(g.pullupBar === false ? 'no bar' : 'pull-up bar');
  }
  return bits.join(' · ');
}

/* A name that is not already taken.
 *
 * Saving a gym with the "Call it" field blank falls back to the kind's label, which is fine once and
 * indistinguishable twice: a second unnamed commercial gym was also called "Bodybuilding gym", and a
 * seventh was too. Nothing about a commercial gym's record differs from another's, so once the names
 * match there is no way left to tell them apart - not in settings, and not in the picker that asks
 * which one you are standing in. Numbered from the second one on; the first keeps the plain label. */
function uniqueGymName(list, name, selfId) {
  const taken = (list || []).filter(g => g.id !== selfId).map(g => (g.name || '').trim().toLowerCase());
  const base = (name || '').trim();
  if (!base || taken.indexOf(base.toLowerCase()) === -1) return base;
  for (let n = 2; n < 99; n++) {
    const t = base + ' ' + n;
    if (taken.indexOf(t.toLowerCase()) === -1) return t;
  }
  return base;
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
      const named = Object.assign({}, g, { name: uniqueGymName(tr.gyms, g.name, g.id) });
      const i = tr.gyms.findIndex(x => x.id === named.id);
      if (i >= 0) tr.gyms[i] = named; else tr.gyms.push(named);
      tr.prefs = Object.assign({}, tr.prefs, { currentGymId: named.id });
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
              {!!gymSummary(g) && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{gymSummary(g)}</span>}
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
  const [openRule, setOpenRule] = useState(0);
  const rows = [
    ['Four weeks, then decide',
      'A block runs four weeks and you stay on it. Changing things every time a session feels hard is the most reliable way to make no progress at all, because nothing gets long enough to work. Four weeks is enough to know whether something is working and short enough that being wrong costs little.'],
    ['A lighter week when you have earned one',
      'We do not put a light week into every block on principle. Coaches in strength and physique sports take them roughly every four to eight weeks, and about as often when the athlete needs one as on a fixed schedule. So at the end of a block we look at what actually happened: whether lifts have stopped moving, whether the same sets are costing you more than they did, how much you got to, how close to your ceiling you have been running, and whether you are dieting or short on sleep. If enough of that lines up, we ask for a lighter week. If it does not, you carry on. A deload you have not earned just spends a good week.'],
    ['Volume, in hard sets',
      'Every muscle has three numbers: the least that grows it, the range where growth is best, and the point where fatigue outruns what you can recover from. Your plan aims at the middle band and is never allowed past the top one.'],
    ['Two ways to train, and one of them is the default',
      'Min-max is what a new block is built as. Four to ten hard sets a muscle a week, one or two per movement, and the last set of every movement taken to the point where the weight stops moving. It leans on machines and cables because failing safely is what makes an all-out set a training decision rather than a gamble, and it runs upper, lower, rest, upper, lower, arms, rest on five days a week, or full body, rest, upper, lower, arms on four. The other way is the volume model: more sets, each stopping a rep or two short, climbing week by week. Neither is wrong. If you are eating in a deficit the app will point you at min-max, because there is less recovery to go around down there and low volume holds muscle perfectly well.'],
    ['On min-max, the weight is the progression',
      'There are no sets to add, so the last week looks exactly like the first on paper and everything that changed is on the bar. Every movement runs a rep window: 6 to 8 on a muscle\'s first session of the week, 8 to 10 on its second. Hit the top of the window and the weight goes up by the smallest jump the kit allows. Land inside it and the weight stays and the job is one more rep than last time. Fall under the bottom of it and the weight comes down about ten percent, because a weight you cannot get six reps with is a test rather than a stimulus. Where both sets of a movement are taken to failure, the app puts 15 percent less on the second one: an all-out first set means a second at the same weight would miss the window by three reps.'],
    ['The last set is the one that goes',
      'Not literally every set. Where a movement has two, the first stops a rep short on anything you could get hurt failing - a squat, a press - and goes all the way on isolation, where failing a cable curl costs you nothing. The last set always goes. And a block opens with an easier week, a rep or two further back on everything, which is not a courtesy: it is what lets the five weeks after it be as hard as they are. Six weeks, one easier and five hard, is the shape the method is written for.'],
    ['Stalling is a movement problem, not a volume problem',
      'Three sessions at the same weight for the same reps and the app stops asking for more and offers you a different movement instead. On a normal programme a stall is often a sign to take volume away; on min-max there is no volume to take, and grinding at a lift that has stopped moving is where people get hurt. A biomechanically similar movement resets the progression cycle without resetting your training.'],
    ['Changing a movement between blocks',
      'At the end of a block you can rotate any movement for another way of doing the same job, and the app has an opinion about which ones are worth it. Varying exercises is not a growth lever on its own: head to head, changing them and keeping them produce much the same strength and size. What the reviews do support is that systematic variation helps a little and random variation hurts, and they name the two ways it goes wrong. One is swapping for something that gives the same stimulus. The other is changing too often. So a shortlist is built from movements that share the pattern and the lead muscle, and the number of changes is capped, with anything over the line offered as a choice rather than applied.'],
    ['A swap restarts the number, not the muscle',
      'This is the part worth being clear about, because it is the thing people expect a swap to do and it does not. Progressive overload is a property of the muscle, not the barbell. Changing an incline dumbbell press for the Smith version does not continue your run on it, it restarts the number you were reading the run from. The muscle keeps everything it built. So a rotation says so where the cost is real, the history is kept as one continuous run with the change marked, and the first sessions on a new movement are treated as finding the weight rather than as a step backwards. Early neural adaptation runs two to four weeks, which in a four-week block is a quarter to half of it, so a movement you change is changed at the start and held for the whole block.'],
    ['The big lifts are the expensive ones to change',
      'Which is the opposite of how it feels. Strength is skill as well as stimulus, so the heaviest, most technical movement in each pattern is also the one carrying your clearest read on whether anything is working at all. That one is treated as an anchor: it is never switched on for you, however the evidence reads, and it is always there to switch on yourself if you want to. Accessories cost almost nothing to rotate and are the first thing offered. And a movement being new and sore is not evidence it worked: the first time you do anything you get more soreness from the novelty, which is damage rather than stimulus.'],
    ['Every muscle, twice a week',
      'Before a single set is added anywhere for volume, every muscle is guaranteed two sessions a week. When a muscle needs more work, the extra comes from a second exposure on another day rather than from piling more sets into the one session that already trains it. Spreading the same weekly volume over two sessions rather than one is the part of the frequency research that is actually settled.'],
    ['A plan you bring is a starting point, not a stencil',
      'Bring a coach\'s programme, a PDF or a handful of screenshots and what gets kept is the part only its author could give you: the movements they chose, the order they put them in, the rep ranges and tempos they wrote, and whatever the block was plainly built around. What does not get kept is how many days it happened to be written across, how many sets somebody else needed, and whether it trains everything often enough. Those are yours, and they come from your day count, your landmarks and your recovery. If you would rather have the plan exactly as its author wrote it, choose "As brought" and nothing of ours is added to it.'],
    ['Half a set for helping',
      'A movement gives a full set to what it mainly works and half a set to what it assists. It is how a coach counts, and it is what stops a push day looking like it covers your triceps when it does not.'],
    ['Effort in reps left, not "to failure"',
      'Sets are prescribed by how many reps you should have left. Week one leaves about three and that walks down as the block goes on, so the hardest weeks land when you are ready for them. Somewhere between none and about four reps left captures nearly all of the growth for a fraction of the fatigue that training to failure every set costs.'],
    ['Warm-ups follow your number, they do not set it',
      'The app never puts a working weight in the box. What it will do is build the ramp up to one: type the weight you are aiming for into set one and a warm-up appears above the table, scaled to that load and to the movement. Heavy compounds earn several rungs, isolation earns one easy set at most, and where your plan states how many warm-up sets a movement wants, the author\u2019s number wins. Nothing is logged and nothing is ticked. If you would rather warm up your own way, ignore it and nothing changes.'],
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
      {/* An accordion, one row open at a time, rather than eighteen full-length essay cards stacked
          the whole way down. Every headline is visible at once - the table of contents this page
          never had - and nothing is deleted: the words are exactly what they were, read one at a
          time instead of scrolled past twenty times over. */}
      <Card className="p-0 overflow-hidden mb-4">
        {rows.map(([h, b], i) => (
          <div key={i} style={i ? { borderTop: '2px solid var(--border)' } : null}>
            <button onClick={() => setOpenRule(o => (o === i ? -1 : i))} aria-expanded={openRule === i}
              className="w-full text-left flex items-center justify-between gap-3 px-3.5 py-3.5">
              <span className="text-[13.5px] font-bold">{h}</span>
              <span className="shrink-0" style={{ color: 'var(--muted2)', transform: openRule === i ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>
                <Icon.chevron width="16" height="16" />
              </span>
            </button>
            {openRule === i && (
              <div className="px-3.5 pb-4 text-[12px] leading-relaxed fade-in" style={{ color: 'var(--muted)' }}>{b}</div>
            )}
          </div>
        ))}
      </Card>
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

        {/* What you actually lifted, movement by movement.

            STACKED, not two columns. It was a name on the left and every set on the right, and the
            set list is the one thing here with no upper bound: four sets of a compound come to
            "62.5kg x 10 · 62.5kg x 10 · 62.5kg x 9 · 62.5kg x 9", which is far wider than half a
            phone. The number column was `shrink-0`, so it took the whole row and left the name a
            column about one character wide - and because the app sets `overflow-wrap: break-word` on
            this size, the name did not overflow, it WRAPPED, one letter per line, into a fifteen-line
            tower with the weights running off the edge beside it. A row whose right-hand side has no
            natural width cannot be a row; the two facts go one above the other, where each gets the
            full width and the long one wraps like the sentence it is. */}
        {(facts.movements || []).length > 0 && (
          <div className="pixel-box mb-4" style={{ background: 'var(--card)' }}>
            {facts.movements.map((m, i) => (
              <div key={i} className="px-3 py-2.5" style={i ? { borderTop: '2px solid var(--track)' } : null}>
                <div className="text-[12px] leading-snug font-bold" style={{ color: m.logged ? 'var(--text)' : 'var(--muted2)' }}>{m.name}</div>
                <div className="text-[11px] tnum leading-snug mt-0.5" style={{ color: 'var(--muted)' }}>{m.detail}</div>
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
function ActionSheet({ title, kicker, actions, onClose, children }) {
  useBackClose(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label="Options" className="fixed inset-0 z-[86] bg-black/70 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-sm pixel-box fade-in max-h-[80vh] overflow-y-auto" style={{ background: 'var(--card)' }} onClick={e => e.stopPropagation()}>
        {/* Everything in this app is set in a pixel face, which runs about a full em per character.
            A 13px label that would be one comfortable line in a normal typeface wraps to two here
            and turns a six-item menu into a full-screen scroll, so the sizes are a step down from
            what they would otherwise be. */}
        {/* The kicker is the pixel-font part and it is always a fixed string; the title underneath is
            whatever the movement or session happens to be called, in the body face. Six sheets here
            were passing a name the library holds - two of them passing two, joined by "instead of" -
            into a face that runs a full em per character and has no narrow forms. */}
        <div className="px-4 pt-4 pb-2">
          <div className="pf text-[8px] uppercase" style={{ color: 'var(--muted)' }}>{kicker || 'Options'}</div>
          {title && <div className="text-[13.5px] font-semibold leading-tight mt-1">{title}</div>}
        </div>
        {/* Free-form content between the title and the action list, for the rare sheet that needs a
            field rather than a row of choices (session notes is the one caller). Every other sheet
            passes nothing and this renders nothing. */}
        {children && <div className="px-4 pb-3">{children}</div>}
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

/* ---- PROGRESS -----------------------------------------------------------------------------------
 * "Am I getting stronger?" - the question the module could not answer.
 *
 * It was split across two screens and landed on neither. History's first tab listed your BESTS,
 * which is a progress question filed under the record of what happened. Stats answered it with four
 * 0-100 scores against bodyweight which, by their own copy, "move slowly and do not lie" - so
 * nothing changed between visits and not one of them named a lift you could do something about.
 *
 * This is the literal answer instead: estimated 1RM per movement, over the last eight sessions, and
 * which way it is going. The arithmetic is `Training.liftTrends`; the screen only draws it.
 *
 * Ordered by what has STOPPED rather than alphabetically, because the list is not the point. Two or
 * three stalled lifts are the only rows in the module that ask you to decide something, and burying
 * them under twenty that are fine is how a progress screen becomes wallpaper.
 */
function LiftSpark({ series, tone }) {
  // Drawn to ONE fixed range for every row - a sixteen percent swing spans the box - rather than
  // stretched to each lift's own min and max. Per-row normalisation makes a lift that moved a
  // kilogram in two months climb as steeply as one that added thirty, so the picture argues against
  // the number printed beside it, on the screen whose whole job is showing what moves.
  const w = 84, h = 28, FULL = 0.16;
  const v0 = series[0] || 1;
  const mid = h / 2;
  const pts = series.map((v, i) => {
    const x = +(i * (w - 4) / Math.max(1, series.length - 1) + 2).toFixed(1);
    const frac = Math.max(-1, Math.min(1, (v / v0 - 1) / FULL));
    return x + ',' + (+(mid - frac * (mid - 3)).toFixed(1));
  });
  const [lx, ly] = pts[pts.length - 1].split(',');
  return (
    <svg width={w} height={h} viewBox={'0 0 ' + w + ' ' + h} aria-hidden="true" style={{ display: 'block' }}>
      <line x1="2" y1={mid} x2={w - 2} y2={mid} stroke="var(--track)" strokeWidth="1" />
      <polyline points={pts.join(' ')} fill="none" stroke={tone} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <rect x={+lx - 2} y={+ly - 2} width="4" height="4" fill={tone} />
    </svg>
  );
}

function TrainProgress({ db, onBack, onOpenExercise, go }) {
  useBackClose(onBack);
  const t = tdb(db);
  const units = t.prefs.units;
  const today = Store.todayISO();
  const trends = Training.liftTrends(t.logs, { custom: t.custom });
  // Every group folds after four. Capping only the last one left an account a couple of blocks in
  // opening on twenty near-identical rows all reading "up 18%" - an inventory, which is the exact
  // navigability failure that made History hard to use.
  const [open, setOpen] = useState({});
  const LIMIT = 4;

  const row = (r, i) => {
    const tone = r.state === 'down' ? 'var(--danger)' : r.state === 'stuck' ? 'var(--warn)'
      : r.state === 'up' ? 'var(--good)' : 'var(--muted2)';
    const ink = r.state === 'down' ? 'var(--danger-ink)' : r.state === 'stuck' ? 'var(--warn-ink)'
      : r.state === 'up' ? 'var(--good-ink)' : 'var(--muted)';
    return (
      <button key={r.exerciseId} onClick={() => onOpenExercise(r.exerciseId)}
        className="w-full text-left px-3.5 py-3 flex items-center gap-3"
        style={i ? { borderTop: '2px solid var(--track)' } : null}>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold leading-tight">{r.name}</span>
          <span className="block text-[11.5px] tnum mt-0.5" style={{ color: 'var(--muted)' }}>
            {toDisplayWeight(r.e1rm, units)}{unitLabel(units)} est. 1RM · {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}
          </span>
          {/* The advice belongs to the engine, which is the thing that decided it had stalled. */}
          {r.state === 'stuck' && (
            <span className="block text-[11px] mt-1 leading-snug" style={{ color: ink }}>
              No new best in {Math.min(3, r.sessions)} sessions.
            </span>
          )}
          {r.state === 'down' && (
            <span className="block text-[11px] mt-1 leading-snug" style={{ color: ink }}>
              Going backwards since {relativeDay(r.lastISO, today).toLowerCase()}.
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <LiftSpark series={r.series} tone={tone} />
          <span className="block pf text-[10px] tnum mt-1" style={{ color: ink, letterSpacing: '0.04em' }}>
            {r.deltaPct > 0 ? '+' : ''}{r.deltaPct}%
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="fade-in">
      <SubHeader back={onBack} backLabel="Train" title="Progress" />
      <div className="pf text-[9px] uppercase mb-1.5" style={{ color: 'var(--muted)', letterSpacing: '0.14em' }}>Am I getting stronger?</div>
      <h1 className="pf text-lg mb-2">Progress</h1>
      <div className="text-[12.5px] mb-5 leading-snug" style={{ color: 'var(--muted)' }}>
        Your estimated one-rep max on every movement, and which way it is going. Every line is drawn to
        the same scale, so a lift that is moving looks like it.
      </div>

      {trends.rows.length === 0 && (
        <Card className="p-4">
          <div className="text-[13px] mb-1">Not enough logged yet.</div>
          <div className="text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>
            A movement shows up here once you have trained it three times. Two points is not a trend,
            and a screen that called one session's difference progress would be teaching you to read noise.
          </div>
        </Card>
      )}

      {[
        { key: 'look', list: trends.needsLook, title: 'Worth a look', right: trends.needsLook.length + ' of ' + trends.rows.length, warn: true },
        { key: 'up', list: trends.up, title: 'Moving up', right: 'last 8 sessions' },
        { key: 'flat', list: trends.steady, title: 'Ticking along', right: String(trends.steady.length) },
      ].filter(g => g.list.length > 0).map(g => (
        <Card key={g.key} className={'p-0 mb-4 overflow-hidden' + (g.warn ? ' box-warn' : '')}>
          <CardHead title={g.title} right={g.right} />
          {(open[g.key] ? g.list : g.list.slice(0, LIMIT)).map(row)}
          {!open[g.key] && g.list.length > LIMIT && (
            <button onClick={() => setOpen(o => Object.assign({}, o, { [g.key]: true }))}
              className="w-full text-left px-3.5 py-3.5 text-[12px]"
              style={{ borderTop: '2px solid var(--track)', color: 'var(--accent-ink)' }}>
              Show the other {g.list.length - LIMIT} ›
            </button>
          )}
        </Card>
      ))}

      {/* The character sheet is still here, one tap away, rather than being the whole screen. It is a
          game object and it is good at being one - it was filed under a screen people open to make
          training decisions, which is why it read as empty. */}
      <button onClick={() => go('stats')} className="pixel-box w-full text-left p-3.5 flex items-center justify-between gap-3"
        style={{ background: 'var(--surface2)' }}>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">Your character sheet</span>
          <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--muted)' }}>Strength, power, endurance and balance, against your bodyweight</span>
        </span>
        <Icon.chevron width="16" height="16" style={{ color: 'var(--muted2)', flexShrink: 0 }} />
      </button>
    </div>
  );
}
