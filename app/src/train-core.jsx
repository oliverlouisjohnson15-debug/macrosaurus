/* ---- train core ----------------------------------------------------------------------
 * shared helpers, formatters and the small pieces every Train screen is built from
 *
 * Part of the Train module, which was one 6,200-line file. The sources have no imports:
 * build.mjs concatenates them in the order given by app/src/manifest.json and hands the lot
 * to Babel, so everything here shares one scope with the rest of the app. Function
 * declarations hoist across the whole bundle, which is why these files can call each other
 * freely; module-level `const` does not, so anything declared with one has to appear before
 * the code that reads it AT MODULE SCOPE. Nothing here does, but that is the rule.
 * ------------------------------------------------------------------------------------- */
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
    // Landmarks learned on the min-max style, kept apart from the volume model's. Six sets and
    // sixteen sets are both "a week of chest" and neither number means anything in the other's
    // units, so one saved table cannot serve both: a recovery ceiling learned at failure would
    // read as a catastrophic cut on the model that trains a rep or two short of it.
    volumeTargetsMinmax: t.volumeTargetsMinmax || {},
    // The draft basket: days collected from several imports before they become a block. This is how
    // "here is Upper A, here is Upper B, here is Lower A" from four separate posts turns into one
    // programme, rather than four one-day blocks that overwrite each other.
    draft: t.draft || null,
    // The saved gyms. They are written straight onto db.training.gyms, and every reader goes through
    // here, so leaving the key out of this object made every saved gym invisible: the picker never
    // fired and the kit swaps had nothing to offer.
    gyms: t.gyms || [],
    // Which movement became which, written when a block-end rotation is accepted. It is what lets a
    // rotated lift's history read as one run rather than two unrelated stubs.
    rotations: t.rotations || [],
    prefs: Object.assign({ units: 'kg', experience: 'intermediate', equipment: [], daysPerWeek: 4, sessionMinutes: 60, dislikes: [], restTimer: true }, t.prefs || {}),
  };
}
// The volume landmarks every screen judges a week against. Which set of them depends on how the
// block in front of you is meant to be run: six sets of chest is a thin week on the volume model and
// a complete one on min-max, and a coverage bar that does not know which is being looked at is a bar
// that tells somebody their programme is broken when it is working exactly as designed.
function trainTargets(db, style) {
  const t = tdb(db);
  const s = style === undefined ? t.prefs.style : style;
  return Training.defaultTargets({
    experience: t.prefs.experience,
    volumeTargets: Training.styleOf(s).toFailure ? t.volumeTargetsMinmax : t.volumeTargets,
    style: s,
  });
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
  // On the volume model most of these notes say what you already know from the prescription, so only
  // the two that change something are shown. The min-max ones ARE the prescription: the plan says
  // nothing about weight, and "one more rep than last time" is the entire instruction for the day.
  const loud = { load: 1, hold: 1, reps: 1, lighter: 1, swap: 1 };
  return loud[pre.action] ? pre.note : null;
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
  return Math.round((exercises || []).reduce((a, e) => {
    const sets = (e.target && e.target.sets) || 0;
    const rest = (e.target && e.target.restSec) || 120;
    // A last-set technique is another two or three minutes of work and recovery on that movement -
    // two drop sets and their rests, or a set extended past failure. Counting it keeps "about 50
    // minutes" honest on the block that adds them, which is the block people are most likely to run
    // out of time on.
    return a + sets * ((rest + 40) / 60) + (e.technique ? 2.5 : 0);
  }, 0));
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
