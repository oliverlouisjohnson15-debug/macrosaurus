/*
 * training.js - Resistance-training engine (pure, framework-free).
 * Exposes window.Training + Node module.exports. No AI, no network, no React.
 *
 * Everything in here is DETERMINISTIC on purpose. The AI in the app proposes exercises and writes
 * prose; this module owns every number: weekly sets per muscle, coverage against volume landmarks,
 * estimated 1RM, stall detection, and what next week's prescription should be. That split is what
 * stops an "AI coach" hallucinating forty sets of chest, and it is what makes the maths testable.
 * See WORKOUTS_PLAN.md sec 3 and sec 8.
 *
 * Principles encoded (JPS program design, Ryan Jewers, Jeff Nippard, Eric Helms, RP landmarks):
 *   - volume landmarks MEV / MAV / MRV per muscle per week, in HARD sets
 *   - fractional set counting: 1.0 to the primary movers, 0.5 to the secondary movers
 *   - effort prescribed in RIR, walking down to true failure (0 RIR) by the final building week,
 *     not stopping a few reps short forever. Hypertrophy rises as sets get closer to failure, most
 *     of the benefit sitting inside 0-3 RIR (Robinson et al. 2024, Sports Medicine, a meta-regression
 *     across 55 hypertrophy studies) - so a house style that calls itself "high intensity" has to
 *     actually land there, not just start near it and stall.
 *   - EVERY trained muscle hit at least twice a week, not "where volume allows". Twice weekly is the
 *     sensible floor the frequency literature converges on (Schoenfeld, Grgic & Krieger 2019,
 *     Sports Medicine, the volume-equated follow-up to the 2016 review), and splitting a muscle's
 *     weekly sets across two sessions is what keeps any one session low-volume without losing the
 *     week's total stimulus - which is the whole shape of "high intensity, lower volume" rather than
 *     a slogan on top of the same programming.
 *   - lower starting volume, built on intensity rather than junk sets: 2 working sets to start a
 *     movement, not 3, growing across the block instead of arriving there in week 1. This is the
 *     house style set by two reference programs (a 6-week straight-sets block and a 12-week RIR-based
 *     hypertrophy programme) that both run 2-3 hard sets per movement to genuine failure rather than
 *     5+ sets short of it, and both name the same reasoning: "your intensity will determine the
 *     amount of volume you require... you do NOT need a ton of work when training with intent and
 *     high intensity."
 *   - double progression: reps within range first, then load, then a set, then change the movement
 *   - when performance falls, CUT volume. Never add into a hole.
 */
(function (root) {
  'use strict';

  // ---- muscles -------------------------------------------------------------------------------
  // Seventeen groups. Fewer would hide real gaps (side vs rear delts is the classic one people
  // miss); more would be noise, because nobody programs the brachialis separately.
  var MUSCLES = ['ch', 'fd', 'sd', 'rd', 'lt', 'ub', 'lb', 'bi', 'tr', 'fa', 'ab', 'ob', 'qu', 'ha', 'gl', 'ad', 'ca'];
  var MUSCLE_LABEL = {
    ch: 'Chest', fd: 'Front delts', sd: 'Side delts', rd: 'Rear delts', lt: 'Lats',
    ub: 'Upper back', lb: 'Lower back', bi: 'Biceps', tr: 'Triceps', fa: 'Forearms',
    ab: 'Abs', ob: 'Obliques', qu: 'Quads', ha: 'Hamstrings', gl: 'Glutes',
    ad: 'Adductors', ca: 'Calves',
  };
  // Coarse regions, used for split building and for the "you have not trained your posterior
  // chain in three weeks" style of observation.
  var REGION = {
    ch: 'push', fd: 'push', sd: 'push', tr: 'push',
    lt: 'pull', ub: 'pull', rd: 'pull', bi: 'pull', fa: 'pull',
    qu: 'legs', ha: 'legs', gl: 'legs', ad: 'legs', ca: 'legs', lb: 'legs',
    ab: 'core', ob: 'core',
  };

  // Weekly hard-set landmarks for a trained lifter. MEV grows, MAV is the productive band we aim
  // at, MRV is where fatigue outruns recovery. Individual variation is large, so these are a
  // STARTING point that tuneTargets() moves per user as blocks complete.
  var LANDMARKS = {
    ch: { mev: 8, mav: 16, mrv: 22 },
    fd: { mev: 4, mav: 10, mrv: 16 },   // gets a lot indirectly from every press
    sd: { mev: 8, mav: 18, mrv: 26 },   // small, fast to recover, tolerates a lot
    rd: { mev: 6, mav: 16, mrv: 24 },
    lt: { mev: 8, mav: 18, mrv: 25 },
    ub: { mev: 8, mav: 18, mrv: 25 },
    lb: { mev: 4, mav: 8, mrv: 14 },    // recovers slowly, and every hinge already taxes it
    bi: { mev: 8, mav: 16, mrv: 24 },
    tr: { mev: 6, mav: 14, mrv: 22 },
    fa: { mev: 4, mav: 10, mrv: 18 },
    ab: { mev: 6, mav: 14, mrv: 22 },
    ob: { mev: 4, mav: 10, mrv: 16 },
    qu: { mev: 8, mav: 16, mrv: 22 },
    ha: { mev: 6, mav: 14, mrv: 20 },
    gl: { mev: 6, mav: 14, mrv: 22 },
    ad: { mev: 4, mav: 10, mrv: 16 },
    ca: { mev: 8, mav: 16, mrv: 25 },
  };
  // Beginners grow on less and recover from less; advanced lifters need more to move the needle.
  var EXPERIENCE_SCALE = { beginner: 0.7, intermediate: 1, advanced: 1.15 };

  /* ---- the min-max landmarks -------------------------------------------------------------------
   * A second, deliberately small volume model, for the style that trades every extra set for effort.
   * The premise is not that the numbers above are wrong; it is that they describe volume taken to a
   * few reps short of failure, and that a set taken to genuine failure is not the same set. Run that
   * way, "most muscles get six sets a week, some get four, and a few sit in the 8 to 10 range".
   *
   * So this is the whole method's volume in one table: nothing sits under 3 or over 10, the muscles
   * that get a session to themselves (delts, arms, calves) sit at the top of the range, and the big
   * movers that also take the systemic load sit at the bottom. It is NOT experience-scaled - an
   * advanced lifter on this style does not get more sets, they get harder ones - though a person can
   * still override any individual muscle, exactly as they can with the landmarks above.
   */
  /* These are not a guess at what the method ought to prescribe. They are read off what it DOES
   * prescribe: the two written programmes the app ships (see PROGRAMMES) at four and five days,
   * which are the style and the volume everything generated here is aiming at. Every number below
   * contains both of them, because landmarks that flag our own flagship programme as short on abs
   * and over on forearms are landmarks that are wrong - the plan was not the thing in error.
   *
   * A MEV of ZERO is a real answer and it means "this one is not programmed directly". Obliques,
   * adductors, lower back and forearms get no slot of their own in either programme: they are paid
   * by the squat, the RDL, the row and everything you have to brace or hold on to. Spending one of
   * six movements on a Pallof press to satisfy a floor is spending it on the least of the work, and
   * that is exactly what the generator used to do - a lower day with a side plank in it and only
   * four sets of quads. The frequency guarantee skips them for the same reason.
   */
  var MINMAX_LANDMARKS = {
    ch: { mev: 4, mav: 6, mrv: 8 },
    fd: { mev: 2, mav: 3, mrv: 6 },     // every press already pays it
    sd: { mev: 4, mav: 6, mrv: 10 },    // small, fast to recover, and it gets its own day
    rd: { mev: 2, mav: 3, mrv: 8 },
    lt: { mev: 4, mav: 6, mrv: 8 },
    ub: { mev: 4, mav: 8, mrv: 10 },    // rows and pulls both feed it, so it runs high on five days
    lb: { mev: 0, mav: 2, mrv: 6 },     // paid by the hinge; nothing programmes it directly
    bi: { mev: 6, mav: 8, mrv: 10 },
    tr: { mev: 6, mav: 8, mrv: 10 },
    // Every pull pays it and grip fails long before volume does, so this is almost entirely
    // incidental credit rather than sets anybody prescribed - the five-day programme lands at 10.5
    // without a single movement chosen for forearms beyond a wrist curl.
    fa: { mev: 0, mav: 4, mrv: 12 },
    ab: { mev: 2, mav: 4, mrv: 8 },
    ob: { mev: 0, mav: 2, mrv: 6 },     // braced for on everything; not programmed
    qu: { mev: 4, mav: 7, mrv: 10 },
    ha: { mev: 4, mav: 5, mrv: 8 },
    gl: { mev: 4, mav: 6, mrv: 8 },
    ad: { mev: 0, mav: 2, mrv: 6 },     // the squat pays it
    ca: { mev: 3, mav: 4, mrv: 10 },
  };

  /* ---- training styles -------------------------------------------------------------------------
   * Everything that changes when somebody trains a different way, in one table, so the difference
   * between the two is a thing you can read rather than a set of conditionals scattered through the
   * generator.
   *
   * 'landmarks' is the volume-first model this app was built on: start near MEV, add a set a week to
   * whichever muscle has the most room, walk proximity to failure down from 3 reps in reserve to 0
   * by the last building week, and never breach MRV.
   *
   * 'minmax' is the other trade. Volume is capped hard and low, every working set is taken to
   * genuine failure, and progression comes from load and reps rather than from sets - there are no
   * sets to add. It leans on stable kit because a set taken past the point where form can hold is
   * not a harder set, it is an injury, and a machine is what makes the last rep safe to attempt.
   *
   * `sets` is the whole prescription for a movement: everything starts at 2 working sets and nothing
   * may ever exceed 2, so the generator's volume passes trade in movements rather than in sets.
   */
  var STYLES = {
    landmarks: {
      key: 'landmarks', label: 'Volume landmarks',
      startSets: null,          // taken from the intensity setting, as it always was
      maxSets: 5, growSets: true, toFailure: false, shape: 'build4', weeks: 4,
      landmarks: null, stableKit: false, minEx: 4, maxExCap: 9,
      blurb: 'Start near the least volume that grows a muscle, add a set a week where there is room, and finish the block close to failure.',
    },
    minmax: {
      key: 'minmax', label: 'Min-max',
      startSets: 2, maxSets: 2, growSets: false, toFailure: true, shape: 'minmax4', weeks: 4,
      // Build to the MIDDLE of the band, not its floor. On the volume model a block starts near the
      // least that grows a muscle and climbs from there, so MEV is the right thing to aim at. This
      // one adds nothing across the block, so whatever week one prescribes is what all four weeks
      // are - and aiming at the floor means running the whole block at the least that works. The
      // written programmes land at MAV and that is the volume they are for.
      aim: 'mav',
      landmarks: MINMAX_LANDMARKS, stableKit: true, minEx: 5, maxExCap: 9,
      blurb: 'Four to ten hard sets a muscle a week, one or two per movement, every one of them to failure. Progress comes from the weight and the reps, never from more sets.',
    },
  };
  // Absent means the model this app started with: a block saved before styles existed was built that
  // way and must keep behaving that way, whatever the wizard now defaults to.
  function styleOf(key) { return STYLES[key] || STYLES.landmarks; }

  var PRIMARY_WEIGHT = 1;
  var SECONDARY_WEIGHT = 0.5;

  function round(n, dp) { var f = Math.pow(10, dp || 0); return Math.round(n * f) / f; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function uniq(a) { var s = {}, o = []; for (var i = 0; i < a.length; i++) { if (!s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } } return o; }

  // ---- exercise library ----------------------------------------------------------------------
  // Encoded as one line per movement to keep the bundle small and the data reviewable in a diff:
  //   id | name | equipment | pattern | primaries | secondaries | resistance profile
  // Resistance profile is where the movement is hardest relative to the target muscle's length:
  // 'len' = challenged lengthened (RDL for hamstrings), 'mid', 'sho' = challenged shortened
  // (leg curl peak, cable lateral at the top). Varying the profile within a muscle beats running
  // three variations of the same curve, which is why the gap-filler reads it.
  var TABLE = [
    // ---- chest
    'bb_bench|Barbell bench press|barbell|horizPress|ch|fd,tr|mid',
    'bb_incline|Incline barbell press|barbell|horizPress|ch,fd|tr|mid',
    'bb_decline|Decline barbell press|barbell|horizPress|ch|tr|mid',
    'db_bench|Dumbbell bench press|dumbbell|horizPress|ch|fd,tr|len',
    'db_incline|Incline dumbbell press|dumbbell|horizPress|ch,fd|tr|len',
    'db_fly|Dumbbell fly|dumbbell|isolation|ch||len',
    'db_incline_fly|Incline dumbbell fly|dumbbell|isolation|ch||len',
    'cable_fly|Cable fly|cable|isolation|ch||mid',
    'cable_fly_low|Low-to-high cable fly|cable|isolation|ch||mid',
    'cable_fly_high|High-to-low cable fly|cable|isolation|ch||mid',
    'pec_deck|Pec deck|machine|isolation|ch||sho',
    'machine_press|Machine chest press|machine|horizPress|ch|fd,tr|mid',
    'machine_incline|Incline machine press|machine|horizPress|ch,fd|tr|mid',
    'smith_bench|Smith machine bench press|smith|horizPress|ch|fd,tr|mid',
    'pushup|Press-up|bodyweight|horizPress|ch|fd,tr|mid',
    'pushup_deficit|Deficit press-up|bodyweight|horizPress|ch|fd,tr|len',
    'dip_chest|Chest dip|bodyweight|horizPress|ch|tr,fd|len',
    'svend|Svend press|dumbbell|isolation|ch||sho',
    'floor_press|Floor press|dumbbell|horizPress|ch|tr,fd|mid',
    'squeeze_press|Squeeze press|dumbbell|horizPress|ch|tr|sho',
    'converging_press|Converging chest press|machine|horizPress|ch|fd,tr|mid',
    'plate_press|Plate-loaded chest press|machine|horizPress|ch|fd,tr|mid',
    'band_fly|Band fly|band|isolation|ch||mid',
    'pushup_ring|Ring press-up|bodyweight|horizPress|ch|fd,tr|len',
    'pushup_decline|Decline press-up|bodyweight|horizPress|ch,fd|tr|mid',
    'pushup_archer|Archer press-up|bodyweight|horizPress|ch|tr|len',
    // ---- shoulders
    'bb_ohp|Barbell overhead press|barbell|vertPress|fd|sd,tr|mid',
    'db_ohp|Dumbbell shoulder press|dumbbell|vertPress|fd|sd,tr|mid',
    'machine_ohp|Machine shoulder press|machine|vertPress|fd|sd,tr|mid',
    'arnold|Arnold press|dumbbell|vertPress|fd|sd,tr|mid',
    'push_press|Push press|barbell|vertPress|fd|sd,tr|mid',
    'seated_bb_ohp|Seated barbell press|barbell|vertPress|fd|sd,tr|mid',
    'db_lateral|Dumbbell lateral raise|dumbbell|isolation|sd||sho',
    'cable_lateral|Cable lateral raise|cable|isolation|sd||len',
    'machine_lateral|Machine lateral raise|machine|isolation|sd||mid',
    'lean_lateral|Leaning cable lateral raise|cable|isolation|sd||len',
    'upright_row|Upright row|barbell|isolation|sd|ub,bi|mid',
    'db_front_raise|Front raise|dumbbell|isolation|fd||mid',
    'plate_front_raise|Plate front raise|dumbbell|isolation|fd||mid',
    'rear_delt_fly|Rear delt fly|dumbbell|isolation|rd|ub|sho',
    'reverse_pec_deck|Reverse pec deck|machine|isolation|rd|ub|sho',
    'reverse_pec_deck_single|Single-arm reverse pec deck|machine|isolation|rd|ub|len',
    'cable_rear_fly|Cable rear delt fly|cable|isolation|rd|ub|mid',
    'face_pull|Face pull|cable|isolation|rd|ub|mid',
    'facepull_rope_high|High rope face pull|cable|isolation|rd|ub|mid',
    // Bodyweight shoulders. Without these a no-kit user has NO primary work for any of the three
    // heads, which made the minimal gym profile impossible to programme honestly.
    'pike_pushup|Pike press-up|bodyweight|vertPress|fd|sd,tr|mid',
    'deficit_pike_pushup|Deficit pike press-up|bodyweight|vertPress|fd|sd,tr|len',
    'wall_hspu|Wall handstand press-up|bodyweight|vertPress|fd|sd,tr|mid',
    'bw_lateral_raise|Bodyweight lateral raise|bodyweight|isolation|sd||sho',
    'band_lateral|Band lateral raise|band|isolation|sd||sho',
    'band_pull_apart|Band pull-apart|band|isolation|rd|ub|sho',
    'prone_y_raise|Prone Y raise|bodyweight|isolation|rd|ub|sho',
    'prone_t_raise|Prone T raise|bodyweight|isolation|rd|ub|sho',
    'db_lateral_seated|Seated dumbbell lateral raise|dumbbell|isolation|sd||sho',
    'cable_y_raise|Cable Y raise|cable|isolation|sd|rd|mid',
    'db_y_raise_incline|Incline dumbbell Y-raise|dumbbell|isolation|sd|rd,ub|len',
    'machine_rear_delt|Machine rear delt|machine|isolation|rd|ub|sho',
    'db_ohp_single|Single-arm dumbbell press|dumbbell|vertPress|fd|sd,tr,ob|mid',
    'landmine_press|Landmine press|barbell|vertPress|fd|ch,tr|mid',
    'z_press|Z press|barbell|vertPress|fd|sd,tr,ab|mid',
    // ---- back, vertical
    'pullup|Pull-up|bodyweight|vertPull|lt|bi,ub,fa|len',
    'chinup|Chin-up|bodyweight|vertPull|lt,bi|ub,fa|len',
    'neutral_pullup|Neutral-grip pull-up|bodyweight|vertPull|lt|bi,ub|len',
    'lat_pulldown|Lat pulldown|cable|vertPull|lt|bi,ub|len',
    'pulldown_neutral|Neutral-grip pulldown|cable|vertPull|lt|bi,ub|len',
    'pulldown_single|Single-arm lat pulldown|cable|vertPull|lt|bi|len',
    'machine_pulldown|Machine pulldown|machine|vertPull|lt|bi,ub|len',
    'straight_arm_pd|Straight-arm pulldown|cable|isolation|lt||mid',
    'pullover_db|Dumbbell pullover|dumbbell|isolation|lt|ch|len',
    // ---- back, horizontal
    'bb_row|Barbell row|barbell|horizPull|ub,lt|bi,rd,lb|mid',
    'pendlay|Pendlay row|barbell|horizPull|ub,lt|bi,rd,lb|len',
    'db_row|Single-arm dumbbell row|dumbbell|horizPull|ub,lt|bi,rd|mid',
    'chest_supported_row|Chest-supported row|dumbbell|horizPull|ub|lt,bi,rd|mid',
    'tbar_row|T-bar row|barbell|horizPull|ub,lt|bi,rd|mid',
    'seated_cable_row|Seated cable row|cable|horizPull|ub,lt|bi,rd|mid',
    'machine_row|Machine row|machine|horizPull|ub,lt|bi,rd|mid',
    'inverted_row|Inverted row|bodyweight|horizPull|ub|lt,bi|mid',
    'meadows_row|Meadows row|barbell|horizPull|ub,lt|bi,rd|mid',
    'seal_row|Seal row|barbell|horizPull|ub,lt|bi,rd|mid',
    'shrug_bb|Barbell shrug|barbell|isolation|ub||sho',
    'shrug_db|Dumbbell shrug|dumbbell|isolation|ub||sho',
    'shrug_machine|Machine shrug|machine|isolation|ub||sho',
    'shrug_cable|Cable shrug|cable|isolation|ub||mid',
    // Row-position shrugs. A Kelso shrug is a shrug done lying or leaning forward, so the traps work
    // against a horizontal line of pull rather than a vertical one - a different exercise from a
    // standing shrug, not a grip on it, and it turns up in enough written programmes to belong here.
    'kelso_shrug|Kelso shrug|cable|isolation|ub||len',
    'kelso_shrug_db|Incline dumbbell Kelso shrug|dumbbell|isolation|ub||len',
    'shrug_in_cable|Cable shrug-in|cable|isolation|ub|rd|mid',
    'tbar_row_supported|Chest-supported T-bar row|machine|horizPull|ub|lt,bi,rd|mid',
    'plate_row|Plate-loaded row|machine|horizPull|ub,lt|bi,rd|mid',
    'kroc_row|Kroc row|dumbbell|horizPull|ub,lt|bi,fa|mid',
    'cable_row_single|Single-arm cable row|cable|horizPull|ub,lt|bi,rd|mid',
    'cable_row_wide|Wide-grip cable row|cable|horizPull|ub,rd|lt,bi|mid',
    'band_row|Band row|band|horizPull|ub,lt|bi,rd|mid',
    'lat_pulldown_wide|Wide-grip pulldown|cable|vertPull|lt|ub,bi|len',
    'lat_pulldown_reverse|Reverse-grip pulldown|cable|vertPull|lt,bi|ub|len',
    'pullup_weighted|Weighted pull-up|bodyweight|vertPull|lt|bi,ub,fa|len',
    'band_pulldown|Band pulldown|band|vertPull|lt|bi,ub|len',
    'cable_pullover|Cable pullover|cable|isolation|lt|ch|len',
    'machine_pullover|Machine pullover|machine|isolation|lt|ch|len',
    // ---- lower back and posterior chain
    'deadlift|Conventional deadlift|barbell|hinge|lb,gl,ha|ub,lt,fa|mid',
    'sumo_deadlift|Sumo deadlift|barbell|hinge|gl,qu|lb,ha,ad|mid',
    'trapbar_dl|Trap bar deadlift|trapbar|hinge|gl,qu|lb,ha|mid',
    'rdl|Romanian deadlift|barbell|hinge|ha|gl,lb|len',
    'db_rdl|Dumbbell Romanian deadlift|dumbbell|hinge|ha|gl,lb|len',
    'single_leg_rdl|Single-leg Romanian deadlift|dumbbell|hinge|ha|gl,lb|len',
    'stiff_leg_dl|Stiff-leg deadlift|barbell|hinge|ha|gl,lb|len',
    'good_morning|Good morning|barbell|hinge|ha|lb,gl|len',
    'back_extension|Back extension|bodyweight|hinge|lb|gl,ha|sho',
    'back_ext_45|45-degree back extension|machine|hinge|lb|gl,ha|len',
    'jefferson_curl|Jefferson curl|barbell|hinge|lb|ha|len',
    'superman|Superman|bodyweight|hinge|lb|gl|sho',
    'db_back_extension|Weighted back extension|dumbbell|hinge|lb|gl,ha|sho',
    'db_good_morning|Dumbbell good morning|dumbbell|hinge|ha|lb,gl|len',
    'bird_dog|Bird dog|bodyweight|core|lb|ab,gl|sho',
    'db_pullover_floor|Floor dumbbell pullover|dumbbell|isolation|lt|ch,ab|len',
    'reverse_hyper|Reverse hyperextension|machine|hinge|gl|lb,ha|sho',
    'cable_pullthrough|Cable pull-through|cable|hinge|gl|ha,lb|mid',
    'kb_swing|Kettlebell swing|kettlebell|hinge|gl|ha,lb|mid',
    'kb_swing_american|American kettlebell swing|kettlebell|hinge|gl|ha,lb,fd|mid',
    'kb_deadlift|Kettlebell deadlift|kettlebell|hinge|gl,ha|lb|mid',
    'kb_goblet_squat|Kettlebell goblet squat|kettlebell|squat|qu|gl,ad|len',
    'kb_front_squat|Kettlebell front rack squat|kettlebell|squat|qu|gl,ab|len',
    'kb_clean|Kettlebell clean|kettlebell|hinge|gl|ha,ub,fa|mid',
    'kb_press|Kettlebell overhead press|kettlebell|vertPress|fd|sd,tr|mid',
    'kb_push_press|Kettlebell push press|kettlebell|vertPress|fd|sd,tr|mid',
    'kb_row|Kettlebell row|kettlebell|horizPull|ub,lt|bi,rd|mid',
    'kb_snatch|Kettlebell snatch|kettlebell|hinge|gl|ha,fd,fa|mid',
    'kb_get_up|Turkish get-up|kettlebell|carry|ab|ob,fd,gl|mid',
    'kb_windmill|Kettlebell windmill|kettlebell|isolation|ob|ab,ha|len',
    'kb_suitcase_dl|Kettlebell suitcase deadlift|kettlebell|hinge|gl,ha|ob,fa,lb|mid',
    'kb_farmers|Kettlebell carry|kettlebell|carry|fa|ub,ob|mid',
    // ---- quads
    'back_squat|Back squat|barbell|squat|qu|gl,lb,ad|len',
    'front_squat|Front squat|barbell|squat|qu|gl,ub,lb|len',
    'high_bar_squat|High-bar squat|barbell|squat|qu|gl,ad|len',
    'hack_squat|Hack squat|machine|squat|qu|gl|len',
    'pendulum_squat|Pendulum squat|machine|squat|qu|gl|len',
    'smith_squat|Smith machine squat|smith|squat|qu|gl|len',
    'leg_press|Leg press|machine|squat|qu|gl,ad|mid',
    'leg_press_narrow|Narrow-stance leg press|machine|squat|qu|gl|mid',
    'goblet_squat|Goblet squat|dumbbell|squat|qu|gl,ad|len',
    'bulgarian|Bulgarian split squat|dumbbell|lunge|qu,gl|ad,ha|len',
    'split_squat|Split squat|dumbbell|lunge|qu,gl|ad|len',
    'walking_lunge|Walking lunge|dumbbell|lunge|qu,gl|ha,ad|mid',
    'reverse_lunge|Reverse lunge|dumbbell|lunge|gl,qu|ha|mid',
    'step_up|Step-up|dumbbell|lunge|qu,gl|ha|mid',
    'sissy_squat|Sissy squat|bodyweight|isolation|qu||len',
    'leg_extension|Leg extension|machine|isolation|qu||sho',
    'belt_squat|Belt squat|machine|squat|qu|gl|len',
    'air_squat|Bodyweight squat|bodyweight|squat|qu|gl|mid',
    'safety_bar_squat|Safety bar squat|barbell|squat|qu|gl,ub|len',
    'zercher_squat|Zercher squat|barbell|squat|qu|gl,ub,ab|len',
    'box_squat|Box squat|barbell|squat|qu,gl|ad|mid',
    'paused_squat|Paused squat|barbell|squat|qu|gl,ad|len',
    'leg_press_single|Single-leg press|machine|squat|qu|gl|mid',
    'leg_press_wide|Wide-stance leg press|machine|squat|qu,gl|ad|mid',
    'v_squat|Machine V-squat|machine|squat|qu|gl|len',
    'db_squat|Dumbbell squat|dumbbell|squat|qu|gl,ad|len',
    'lateral_lunge|Lateral lunge|dumbbell|lunge|ad,qu|gl|len',
    'curtsy_lunge|Curtsy lunge|dumbbell|lunge|gl,qu|ad|mid',
    'deficit_lunge|Deficit reverse lunge|dumbbell|lunge|gl,qu|ha|len',
    'sled_push|Sled push|machine|squat|qu|gl,ca|mid',
    'db_step_up_high|High step-up|dumbbell|lunge|gl,qu|ha|len',
    'leg_ext_single|Single-leg extension|machine|isolation|qu||sho',
    'reverse_nordic|Reverse Nordic curl|bodyweight|isolation|qu||len',
    'wall_sit|Wall sit|bodyweight|isolation|qu||mid',
    // ---- hamstrings, glutes, adductors, calves
    'lying_leg_curl|Lying leg curl|machine|isolation|ha||sho',
    'seated_leg_curl|Seated leg curl|machine|isolation|ha||len',
    'standing_leg_curl|Standing leg curl|machine|isolation|ha||mid',
    'nordic_curl|Nordic hamstring curl|bodyweight|isolation|ha||len',
    'glute_ham_raise|Glute-ham raise|bodyweight|isolation|ha|gl,lb|len',
    'hip_thrust|Barbell hip thrust|barbell|hinge|gl|ha|sho',
    'machine_hip_thrust|Machine hip thrust|machine|hinge|gl|ha|sho',
    'glute_bridge|Glute bridge|bodyweight|hinge|gl|ha|sho',
    'cable_kickback|Cable glute kickback|cable|isolation|gl|ha|sho',
    'hip_abduction|Machine hip abduction|machine|isolation|gl||sho',
    'cable_abduction|Cable hip abduction|cable|isolation|gl||sho',
    'band_abduction|Band hip abduction|band|isolation|gl||sho',
    'single_leg_curl|Single-leg curl|machine|isolation|ha||sho',
    'db_leg_curl|Dumbbell leg curl|dumbbell|isolation|ha||sho',
    'slider_curl|Slider hamstring curl|bodyweight|isolation|ha|gl|sho',
    'single_leg_hip_thrust|Single-leg hip thrust|bodyweight|hinge|gl|ha|sho',
    'db_hip_thrust|Dumbbell hip thrust|dumbbell|hinge|gl|ha|sho',
    'frog_pump|Frog pump|bodyweight|hinge|gl|ha|sho',
    'b_stance_rdl|B-stance Romanian deadlift|dumbbell|hinge|ha|gl,lb|len',
    'smith_rdl|Smith machine Romanian deadlift|smith|hinge|ha|gl,lb|len',
    '45_hyper|45-degree hyperextension|machine|hinge|gl|ha,lb|sho',
    'hip_adduction|Machine hip adduction|machine|isolation|ad||sho',
    'copenhagen|Copenhagen plank|bodyweight|isolation|ad|ob|len',
    'cable_adduction|Cable hip adduction|cable|isolation|ad||sho',
    'cossack_squat|Cossack squat|bodyweight|lunge|ad,qu|gl|len',
    'sumo_goblet|Sumo goblet squat|dumbbell|squat|ad,qu|gl|len',
    'standing_calf|Standing calf raise|machine|isolation|ca||len',
    'seated_calf|Seated calf raise|machine|isolation|ca||len',
    'leg_press_calf|Leg press calf press|machine|isolation|ca||len',
    'db_calf|Dumbbell calf raise|dumbbell|isolation|ca||len',
    'smith_calf|Smith machine calf raise|smith|isolation|ca||len',
    'bw_calf_raise|Bodyweight calf raise|bodyweight|isolation|ca||len',
    'single_leg_calf|Single-leg calf raise|bodyweight|isolation|ca||len',
    'bb_calf_raise|Barbell calf raise|barbell|isolation|ca||len',
    'donkey_calf|Donkey calf raise|machine|isolation|ca||len',
    'tibialis_raise|Tibialis raise|bodyweight|isolation|ca||sho',
    // ---- biceps
    'bb_curl|Barbell curl|barbell|isolation|bi|fa|mid',
    'ez_curl|EZ-bar curl|ez|isolation|bi|fa|mid',
    'db_curl|Dumbbell curl|dumbbell|isolation|bi|fa|mid',
    'incline_curl|Incline dumbbell curl|dumbbell|isolation|bi|fa|len',
    'preacher_curl|Preacher curl|ez|isolation|bi|fa|len',
    'machine_curl|Machine curl|machine|isolation|bi||mid',
    'cable_curl|Cable curl|cable|isolation|bi|fa|mid',
    'bayesian_curl|Bayesian cable curl|cable|isolation|bi|fa|len',
    'hammer_curl|Hammer curl|dumbbell|isolation|bi,fa||mid',
    'rope_hammer|Rope hammer curl|cable|isolation|bi,fa||mid',
    'concentration_curl|Concentration curl|dumbbell|isolation|bi||sho',
    'spider_curl|Spider curl|dumbbell|isolation|bi||sho',
    'drag_curl|Drag curl|barbell|isolation|bi||sho',
    'db_curl_seated|Seated dumbbell curl|dumbbell|isolation|bi|fa|mid',
    'cable_curl_high|High cable curl|cable|isolation|bi||sho',
    'band_curl|Band curl|band|isolation|bi|fa|sho',
    'chinup_negative|Chin-up negative|bodyweight|vertPull|bi,lt|ub,fa|len',
    'zottman_curl|Zottman curl|dumbbell|isolation|bi,fa||mid',
    'zottman_curl_modified|Modified Zottman curl|dumbbell|isolation|bi,fa||mid',
    'ez_preacher|EZ preacher curl|ez|isolation|bi|fa|len',
    'machine_preacher|Machine preacher curl|machine|isolation|bi||len',
    'crossbody_curl|Cross-body hammer curl|dumbbell|isolation|bi,fa||mid',
    // ---- triceps
    'close_grip_bench|Close-grip bench press|barbell|horizPress|tr|ch,fd|mid',
    'dip_triceps|Triceps dip|bodyweight|horizPress|tr|ch,fd|mid',
    'dip_machine|Seated machine dip|machine|horizPress|tr|ch|mid',
    'skullcrusher|Skullcrusher|ez|isolation|tr||len',
    'db_skullcrusher|Dumbbell skullcrusher|dumbbell|isolation|tr||len',
    'overhead_ext_db|Overhead dumbbell extension|dumbbell|isolation|tr||len',
    'overhead_ext_cable|Overhead cable extension|cable|isolation|tr||len',
    'rope_pushdown|Rope pushdown|cable|isolation|tr||sho',
    'bar_pushdown|Bar pushdown|cable|isolation|tr||sho',
    'machine_pushdown|Machine triceps|machine|isolation|tr||mid',
    'jm_press|JM press|barbell|isolation|tr||mid',
    'jm_press_smith|Smith machine JM press|smith|isolation|tr||mid',
    'kickback|Triceps kickback|dumbbell|isolation|tr||sho',
    'diamond_pushup|Diamond press-up|bodyweight|horizPress|tr|ch|mid',
    'bench_dip|Bench dip|bodyweight|horizPress|tr|ch,fd|mid',
    'cable_kickback_tri|Cable triceps kickback|cable|isolation|tr||sho',
    'single_pushdown|Single-arm pushdown|cable|isolation|tr||sho',
    'overhead_ez|Overhead EZ extension|ez|isolation|tr||len',
    'band_pushdown|Band pushdown|band|isolation|tr||sho',
    'california_press|California press|ez|isolation|tr|ch|mid',
    'tate_press|Tate press|dumbbell|isolation|tr||mid',
    'pushup_close|Close-grip press-up|bodyweight|horizPress|tr|ch,fd|mid',
    // ---- forearms
    'wrist_curl|Wrist curl|dumbbell|isolation|fa||len',
    'reverse_wrist_curl|Reverse wrist curl|dumbbell|isolation|fa||len',
    'reverse_curl|Reverse curl|ez|isolation|fa|bi|mid',
    'farmers_walk|Farmer\'s walk|dumbbell|carry|fa|ub,ob|mid',
    'dead_hang|Dead hang|bodyweight|carry|fa|lt|len',
    'plate_pinch|Plate pinch carry|dumbbell|carry|fa||mid',
    'cable_wrist_curl|Cable wrist curl|cable|isolation|fa||len',
    'wrist_roller|Wrist roller|dumbbell|isolation|fa||mid',
    'towel_hang|Towel hang|bodyweight|carry|fa|lt|len',
    // ---- core
    'plank|Plank|bodyweight|core|ab|ob|mid',
    'ab_wheel|Ab wheel rollout|bodyweight|core|ab|ob,lt|len',
    'hanging_leg_raise|Hanging leg raise|bodyweight|core|ab|ob,fa|len',
    'hanging_knee_raise|Hanging knee raise|bodyweight|core|ab|ob|mid',
    'cable_crunch|Cable crunch|cable|core|ab||sho',
    'crunch|Crunch|bodyweight|core|ab||sho',
    'machine_crunch|Machine ab crunch|machine|core|ab||sho',
    'reverse_crunch|Reverse crunch|bodyweight|core|ab||sho',
    'situp|Sit-up|bodyweight|core|ab|ob|mid',
    'russian_twist|Russian twist|bodyweight|core|ob|ab|mid',
    'pallof_press|Pallof press|cable|core|ob|ab|mid',
    'side_plank|Side plank|bodyweight|core|ob|ab|mid',
    'woodchop|Cable woodchop|cable|core|ob|ab|mid',
    'suitcase_carry|Suitcase carry|dumbbell|carry|ob|fa,ub|mid',
    'dragon_flag|Dragon flag|bodyweight|core|ab|ob|len',
    'toes_to_bar|Toes to bar|bodyweight|core|ab|ob,fa|len',
    'weighted_crunch|Weighted crunch|dumbbell|core|ab||sho',
    'decline_situp|Decline sit-up|bodyweight|core|ab|ob|mid',
    'hollow_hold|Hollow body hold|bodyweight|core|ab|ob|mid',
    'db_side_bend|Dumbbell side bend|dumbbell|core|ob|ab|len',
    'cable_side_bend|Cable side bend|cable|core|ob|ab|len',
    'landmine_twist|Landmine twist|barbell|core|ob|ab|mid',
    'bicycle_crunch|Bicycle crunch|bodyweight|core|ob|ab|mid',
    'ab_machine_twist|Machine rotary torso|machine|core|ob|ab|mid',
    'v_up|V-up|bodyweight|core|ab|ob|mid',
    'dragon_flag_negative|Dragon flag negative|bodyweight|core|ab|ob|len',
    'plank_weighted|Weighted plank|dumbbell|core|ab|ob|mid',
    'copenhagen_short|Short-lever Copenhagen|bodyweight|isolation|ad|ob|len',

    /* ---- the written programmes' own movements ----------------------------------------------
     * Every movement named in the two Macrosaurus programmes (see PROGRAMMES) that the library did
     * not already hold, added under the name its author wrote and then put into house style.
     *
     * These are here rather than resolved by resemblance because a written plan names its movements
     * on purpose. Resemblance re-pointed fifty of the ninety in these two sheets at something the
     * library already had: a close-grip lat pulldown became a neutral-grip one, a smith machine
     * lunge became a split squat, a seated cable deadlift became a seated cable ROW, and three
     * different preacher curls collapsed into one entry whose logged history was then three lifts
     * averaged together. A movement's identity is its name; resemblance decides only what it TRAINS,
     * which is where every classification below came from - each one inherits the attribution of the
     * nearest thing the library knows, then has its equipment corrected from its own name.
     *
     * Sixteen of the fifty are not here, because the sheet and the library were writing one movement
     * two ways: the kit at the other end of the name ("Machine Chest Press" / "Chest press machine"),
     * the kit left implicit ("Dumbbell Hammer Curl" / "Hammer curl"), a spelling ("Cable Flye"), or
     * an abbreviation ("Barbell RDL", "Nordic Ham Curl"). None of those adds, drops or changes a
     * word, which is what makes them the only things allowed to overrule the sheet.
     *
     * Generated by tools/gen-programmes.mjs, styled by tools/name-style.mjs. Run both again and
     * neither should have anything to say.
     */
    'smith_machine_incline_press|Smith machine incline press|smith|horizPress|ch,fd|tr|mid',
    'lat_pulldown_wide_grip|Lat pulldown (wide grip)|machine|vertPull|lt|ub,bi|len',
    '1_arm_cable_pulldown|1-arm cable pulldown|cable|vertPull|lt|bi|len',
    'close_grip_lat_pulldown|Close-grip lat pulldown|machine|vertPull|lt|bi,ub|len',
    'close_grip_pull_up|Close-grip pull-up|bodyweight|vertPull|lt|bi,ub|len',
    'chest_supported_machine_row|Chest-supported machine row|machine|horizPull|ub|lt,bi,rd|mid',
    'high_cable_lateral_raise|High-cable lateral raise|cable|isolation|sd||len',
    '1_arm_reverse_pec_deck|1-arm reverse pec deck|machine|isolation|rd|ub|len',
    'lying_reverse_dumbbell_fly|Lying reverse dumbbell fly|dumbbell|isolation|rd|ub|sho',
    'reverse_cable_crossover|Reverse cable crossover|cable|isolation|rd|ub|mid',
    'machine_crunch2|Machine crunch|machine|core|ab||sho',
    'reverse_nordic2|Reverse Nordic|bodyweight|isolation|qu||len',
    'seated_cable_deadlift|Seated cable deadlift|cable|horizPull|ub,lt|bi,rd|mid',
    '45_hyperextension|45° hyperextension|machine|hinge|gl|ha,lb|sho',
    'barbell_squat|Barbell squat|barbell|squat|qu|gl,lb,ad|len',
    'standing_dumbbell_curl|Standing dumbbell curl|dumbbell|isolation|bi|fa|mid',
    'overhead_cable_triceps_extension|Overhead cable triceps extension|cable|isolation|tr||len',
    'overhead_dumbbell_triceps_extension|Overhead dumbbell triceps extension|dumbbell|isolation|tr||len',
    'skull_crusher|Skull crusher|ez|isolation|tr||len',
    'preacher_hammer_curl|Preacher hammer curl|ez|isolation|bi|fa|len',
    'close_grip_dip|Close-grip dip|bodyweight|horizPress|tr|ch,fd|mid',
    'dumbbell_wrist_extension|Dumbbell wrist extension|dumbbell|isolation|fa||len',
    'cable_wrist_extension|Cable wrist extension|cable|isolation|fa||len',
    'alternating_dumbbell_curl|Alternating dumbbell curl|dumbbell|isolation|bi|fa|mid',
    'seated_cable_kelso_shrug|Seated cable Kelso shrug|cable|isolation|ub||len',
    'ez_bar_preacher_curl|EZ-bar preacher curl|ez|isolation|bi|fa|len',
    'dumbbell_preacher_curl|Dumbbell preacher curl|dumbbell|isolation|bi|fa|len',
    'triceps_pressdown|Triceps pressdown|cable|isolation|tr||sho',
    'bent_knee_dragon_flag|Bent-knee dragon flag|bodyweight|core|ab|ob|len',
    'lying_leg_raise|Lying leg raise|bodyweight|core|ab||sho',
    'smith_machine_lunge|Smith machine lunge|smith|lunge|qu,gl|ad|len',
    'dumbbell_lunge|Dumbbell lunge|dumbbell|lunge|qu,gl|ha,ad|mid',
    'barbell_lunge|Barbell lunge|barbell|lunge|qu,gl|ha,ad|mid',
    'standing_plate_abduction|Standing plate abduction|dumbbell|isolation|gl||sho',

    /* ---- filling the thin cells --------------------------------------------------------------
     * What tools/exercise-gaps.mjs found once the library was laid out as muscle by equipment.
     *
     * The holes were not where you would guess. Chest, lats, upper back and quads had fifty-odd
     * movements each; SIDE DELTS had eleven, on the one muscle this method gives a whole day to and
     * asks four to ten hard sets a week from. Forearms had seventeen and not one barbell among them.
     * Fifteen of the twenty-one ab movements were bodyweight, on a method whose entire progression
     * is the weight going up. And a lower body with no cable Romanian deadlift, no smith hip thrust
     * and no machine leg curl variant beyond three is a lower body the generator cannot build for
     * somebody whose gym is machines and cables - which is most people's gym, and the kit this
     * method asks for first.
     *
     * Every one below is attributed by hand. The alternative was importing an open exercise database
     * - free-exercise-db is 873 movements and public domain - and it does not survive contact with
     * this model: 94 of its movements classify their primary mover as "shoulders", which cannot tell
     * a lateral raise from an overhead press from a face pull, and the volume maths here is built on
     * telling those three apart. It is a fine list to CHECK ourselves against and a poor one to
     * copy from.
     */
    // ---- side delts. Eleven movements for the muscle this method gives a day of its own to and
    // asks four to ten sets a week from, and only one of them loadable in small steps on a machine.
    'single_arm_cable_lateral|Single-arm cable lateral raise|cable|isolation|sd||len',
    'behind_back_cable_lateral|Behind-the-back cable lateral raise|cable|isolation|sd||len',
    'lying_dumbbell_lateral|Lying dumbbell lateral raise|dumbbell|isolation|sd||len',
    'incline_dumbbell_lateral|Incline dumbbell lateral raise|dumbbell|isolation|sd||len',
    'cheat_lateral_raise|Cheat lateral raise|dumbbell|isolation|sd|tr|mid',
    'dumbbell_upright_row|Dumbbell upright row|dumbbell|isolation|sd|ub,bi|sho',
    'cable_upright_row|Cable upright row|cable|isolation|sd|ub,bi|sho',
    'ez_upright_row|EZ-bar upright row|ez|isolation|sd|ub,bi|sho',
    'smith_upright_row|Smith machine upright row|smith|isolation|sd|ub,bi|sho',
    'machine_upright_row|Machine upright row|machine|isolation|sd|ub,bi|sho',
    'plate_lateral_raise|Plate lateral raise|dumbbell|isolation|sd||mid',
    'kettlebell_lateral_raise|Kettlebell lateral raise|kettlebell|isolation|sd||mid',
    'poliquin_raise|Poliquin raise|dumbbell|isolation|sd||len',
    'seated_machine_lateral|Seated machine lateral raise|machine|isolation|sd||mid',

    // ---- calves. Five of the eleven were the same machine in different chairs.
    'seated_dumbbell_calf|Seated dumbbell calf raise|dumbbell|isolation|ca||len',
    'single_leg_dumbbell_calf|Single-leg dumbbell calf raise|dumbbell|isolation|ca||len',
    'hack_squat_calf|Hack squat calf raise|machine|isolation|ca||len',
    'deficit_calf_raise|Deficit calf raise|bodyweight|isolation|ca||len',
    'smith_seated_calf|Smith machine seated calf raise|smith|isolation|ca||len',
    'band_calf_raise|Band calf raise|band|isolation|ca||mid',
    'cable_calf_raise|Cable calf raise|cable|isolation|ca||len',

    // ---- forearms. Not one barbell movement, on the muscle every grip in the library taxes.
    'barbell_wrist_curl|Barbell wrist curl|barbell|isolation|fa||len',
    'barbell_reverse_wrist_curl|Barbell reverse wrist curl|barbell|isolation|fa||len',
    'barbell_reverse_curl|Barbell reverse curl|barbell|isolation|fa|bi|mid',
    'behind_back_wrist_curl|Behind-the-back barbell wrist curl|barbell|isolation|fa||len',
    'cable_reverse_curl|Cable reverse curl|cable|isolation|fa|bi|mid',
    'ez_reverse_wrist_curl|EZ-bar reverse wrist curl|ez|isolation|fa||len',
    'fat_grip_hold|Fat-grip hold|barbell|carry|fa||mid',

    // ---- abs, loaded. Fifteen of twenty-one were bodyweight, which is a muscle you cannot
    // progressively overload in a method whose whole progression is the weight.
    'cable_reverse_crunch|Cable reverse crunch|cable|core|ab||mid',
    'weighted_hanging_knee_raise|Weighted hanging knee raise|dumbbell|core|ab|ob|len',
    'barbell_ab_rollout|Barbell ab rollout|barbell|core|ab|ob|len',
    'captains_chair_leg_raise|Captain\'s chair leg raise|bodyweight|core|ab|ob|len',
    'machine_leg_raise|Machine leg raise|machine|core|ab|ob|mid',
    'kneeling_cable_crunch|Kneeling cable crunch|cable|core|ab||mid',

    // ---- lower back. Seven, and two of those were deadlifts that train it on the way past.
    'machine_back_extension|Machine back extension|machine|hinge|lb|gl,ha|mid',
    'weighted_45_back_ext|Weighted 45-degree back extension|dumbbell|hinge|lb|gl,ha|mid',

    // ---- obliques
    'hanging_oblique_raise|Hanging oblique knee raise|bodyweight|core|ob|ab|len',
    'cable_oblique_crunch|Cable oblique crunch|cable|core|ob|ab|mid',
    'half_kneeling_pallof|Half-kneeling Pallof press|cable|core|ob|ab|mid',
    'machine_side_bend|Machine side bend|machine|core|ob||mid',
    'dumbbell_windmill|Dumbbell windmill|dumbbell|core|ob|sd|len',

    // ---- adductors
    'band_hip_adduction|Band hip adduction|band|isolation|ad||mid',
    'side_lying_hip_adduction|Side-lying hip adduction|bodyweight|isolation|ad||len',

    // ---- hamstrings and glutes, the cells with no cable or smith option at all
    'cable_romanian_deadlift|Cable Romanian deadlift|cable|hinge|ha|gl,lb|len',
    'machine_kneeling_leg_curl|Machine kneeling leg curl|machine|isolation|ha||len',
    'smith_good_morning|Smith machine good morning|smith|hinge|ha|gl,lb|len',
    'machine_glute_kickback|Machine glute kickback|machine|isolation|gl|ha|mid',
    'smith_hip_thrust|Smith machine hip thrust|smith|hinge|gl|ha|sho',
    'band_hip_thrust|Band hip thrust|band|hinge|gl|ha|sho',

    // ---- chest and pressing, the machine and smith cells the method reaches for first
    'smith_decline_press|Smith machine decline press|smith|horizPress|ch|tr|mid',
    'machine_decline_press|Machine decline press|machine|horizPress|ch|tr|mid',
    'machine_fly|Machine fly|machine|isolation|ch||len',
    'cable_press|Cable chest press|cable|horizPress|ch|fd,tr|mid',

    // ---- back, the cells a commercial gym actually has
    'smith_shrug|Smith machine shrug|smith|isolation|ub||mid',
    'machine_rear_delt_row|Machine rear delt row|machine|horizPull|rd|ub|mid',

    // ---- arms, the guided cells
    'machine_dip|Machine dip|machine|horizPress|tr|ch,fd|mid',
    'machine_hammer_curl|Machine hammer curl|machine|isolation|bi,fa||mid',
    'cable_preacher_curl|Cable preacher curl|cable|isolation|bi|fa|len',
    'incline_cable_curl|Incline cable curl|cable|isolation|bi|fa|len',
    'machine_overhead_extension|Machine overhead triceps extension|machine|isolation|tr||len',
    // ---- front delts. Twenty-three movements and three of them on kit you can fail on safely:
    // every press was a barbell, a dumbbell or a handstand.
    'smith_overhead_press|Smith machine overhead press|smith|vertPress|fd|tr,sd|mid',
    'smith_behind_neck_press|Smith machine behind-the-neck press|smith|vertPress|fd,sd|tr|len',
    'cable_front_raise|Cable front raise|cable|isolation|fd||mid',
    'single_arm_cable_front_raise|Single-arm cable front raise|cable|isolation|fd||mid',
    'machine_front_raise|Machine front raise|machine|isolation|fd||mid',
    'cable_overhead_press|Cable overhead press|cable|vertPress|fd|tr,sd|mid',
    'seated_machine_press|Seated machine shoulder press|machine|vertPress|fd|tr,sd|mid',

    // ---- lower back. Nine, of which two were deadlifts that train it on the way past and three
    // were bodyweight holds. Nothing loadable in small steps at all.
    'rack_pull|Rack pull|barbell|hinge|lb|ub,ha,gl|sho',
    'snatch_grip_deadlift|Snatch-grip deadlift|barbell|hinge|lb|ha,gl,ub|len',
    'cable_back_extension|Cable back extension|cable|hinge|lb|gl,ha|mid',
    'smith_rack_pull|Smith machine rack pull|smith|hinge|lb|ub,ha,gl|sho',
    'band_good_morning|Band good morning|band|hinge|lb|ha,gl|len',
    'machine_hyperextension|Machine hyperextension|machine|hinge|lb|gl,ha|len',
    'cable_jefferson_curl|Cable Jefferson curl|cable|hinge|lb|ha|len',

    // ---- adductors. The real pool is small - the machine, the cable and a wide stance - so this is
    // the honest ceiling rather than a shortfall to be padded out with inventions.
    'seated_machine_adduction|Seated machine hip adduction|machine|isolation|ad||len',
    'cable_lateral_lunge|Cable lateral lunge|cable|lunge|ad,qu|gl|len',
    'smith_sumo_squat|Smith machine sumo squat|smith|squat|ad,qu|gl|len',
  ];

  // Alias table: what people actually type or what a caption actually says, mapped to a library id.
  // This is the single biggest determinant of whether an import feels magic or broken, so it is
  // data rather than cleverness, and it is unit-tested.
  var ALIASES = {
    bench: 'bb_bench', 'bench press': 'bb_bench', 'flat bench': 'bb_bench', bp: 'bb_bench',
    'incline bench': 'bb_incline', 'incline press': 'bb_incline', 'incline db press': 'db_incline',
    'db bench': 'db_bench', 'dumbell bench press': 'db_bench', 'db press': 'db_bench',
    'flyes': 'db_fly', 'flys': 'db_fly', 'chest flye': 'db_fly', 'pec fly': 'cable_fly',
    'ohp': 'bb_ohp', 'overhead press': 'bb_ohp', 'military press': 'bb_ohp', 'shoulder press': 'db_ohp',
    'strict press': 'bb_ohp', 'db shoulder press': 'db_ohp',
    'lateral raise': 'db_lateral', 'lat raise': 'db_lateral', 'side raise': 'db_lateral',
    'laterals': 'db_lateral', 'side delt raise': 'db_lateral', 'cable lat raise': 'cable_lateral',
    'rear delt': 'rear_delt_fly', 'reverse fly': 'rear_delt_fly', 'rear flys': 'rear_delt_fly',
    'facepull': 'face_pull', 'face pulls': 'face_pull',
    squat: 'back_squat', squats: 'back_squat', 'back squats': 'back_squat', 'bb squat': 'back_squat',
    'front squats': 'front_squat', 'hacks': 'hack_squat', 'leg press machine': 'leg_press',
    'bulgarians': 'bulgarian', 'bss': 'bulgarian', 'bulgarian split squats': 'bulgarian',
    'split squats': 'split_squat', lunges: 'walking_lunge', lunge: 'walking_lunge',
    'leg ext': 'leg_extension', 'quad extension': 'leg_extension', 'knee extension': 'leg_extension',
    deadlift: 'deadlift', deadlifts: 'deadlift', 'dl': 'deadlift', 'conventional dl': 'deadlift',
    rdl: 'rdl', rdls: 'rdl', romanians: 'rdl', 'romanian dl': 'rdl', 'stiff leg dl': 'stiff_leg_dl',
    'sldl': 'stiff_leg_dl', 'db rdl': 'db_rdl',
    'leg curl': 'lying_leg_curl', 'leg curls': 'lying_leg_curl', 'hamstring curl': 'lying_leg_curl',
    'ham curls': 'lying_leg_curl', 'seated curls': 'seated_leg_curl',
    'hip thrusts': 'hip_thrust', 'thrusts': 'hip_thrust', 'glute bridges': 'glute_bridge',
    'kickbacks': 'cable_kickback', 'abductor machine': 'hip_abduction', 'abductions': 'hip_abduction',
    'calf raise': 'standing_calf', 'calves': 'standing_calf', 'calf raises': 'standing_calf',
    'pull ups': 'pullup', 'pullups': 'pullup', 'pull-ups': 'pullup', 'chins': 'chinup', 'chin ups': 'chinup',
    'pulldown': 'lat_pulldown', 'lat pull down': 'lat_pulldown', 'pulldowns': 'lat_pulldown',
    'lat pull': 'lat_pulldown', 'pull downs': 'lat_pulldown',
    'barbell rows': 'bb_row', 'bent over row': 'bb_row', 'bor': 'bb_row', rows: 'seated_cable_row',
    'cable row': 'seated_cable_row', 'seated row': 'seated_cable_row', 'db rows': 'db_row',
    'one arm row': 'db_row', 'single arm row': 'db_row', 'chest supported rows': 'chest_supported_row',
    shrugs: 'shrug_db', 'traps': 'shrug_db',
    curls: 'db_curl', 'bicep curl': 'db_curl', 'bicep curls': 'db_curl', 'barbell curls': 'bb_curl',
    'hammers': 'hammer_curl', 'hammer curls': 'hammer_curl', 'preacher': 'preacher_curl',
    'incline curls': 'incline_curl', 'cable curls': 'cable_curl',
    'tricep pushdown': 'rope_pushdown', 'pushdowns': 'rope_pushdown', 'tricep extension': 'overhead_ext_cable',
    'overhead tricep': 'overhead_ext_cable', 'skull crushers': 'skullcrusher', 'skulls': 'skullcrusher',
    'cgbp': 'close_grip_bench', 'close grip': 'close_grip_bench', dips: 'dip_triceps',
    'press ups': 'pushup', 'pushups': 'pushup', 'push ups': 'pushup', 'press-ups': 'pushup',
    'ab rollout': 'ab_wheel', 'rollouts': 'ab_wheel', 'leg raises': 'hanging_leg_raise',
    'planks': 'plank', 'crunches': 'crunch', 'cable crunches': 'cable_crunch',
    // Names a coaching app writes that the library has no token in common with, so no amount of
    // scoring reaches them. A "chest fly" is not called that anywhere in the table; a French press
    // is an overhead extension under another name; "decline" on a fly means the high-to-low angle.
    'chest fly': 'cable_fly', 'chest flies': 'cable_fly', 'decline chest fly': 'cable_fly_high',
    'decline fly': 'cable_fly_high', 'incline chest fly': 'db_incline_fly',
    'french press': 'overhead_ez', 'french presses': 'overhead_ez',
    'triceps pushdown': 'rope_pushdown', 'cable triceps pushdown': 'bar_pushdown',
    'cable tricep pushdown': 'bar_pushdown', 'triceps pushdowns': 'rope_pushdown',
    'split squat smith machine': 'split_squat', 'smith machine split squat': 'split_squat',
    'machine adduction': 'hip_adduction', 'machine abduction': 'hip_abduction',
    'machine ab crunch': 'machine_crunch',
  };
  // The alias table is written the way a person types, but lookups arrive already normalised and
  // shorthand-expanded. Building a second copy through the SAME pipeline is what keeps the two in
  // step: without it, teaching cleanName that "tricep" means "triceps" silently unhooks every alias
  // that spells it the short way.
  var ALIAS_N = null;
  /* Coaching-app vocabulary. Every one of these came out of a real published programme where the
   * scorer's best guess was not just weak but WRONG in a way that changes what you train: a lying
   * leg RAISE scored onto a lying leg CURL, a standing dumbbell curl onto a standing leg curl, a
   * close-grip pull-up onto a close-grip press-up, a wrist extension onto an overhead extension.
   * A near-miss on a name is a rounding error; a pull read as a push is a different session.
   */
  var COACH_ALIASES = {
    // Spellings and abbreviations coaches actually write
    'db flye': 'db_fly', 'cable flye': 'cable_fly', 'flye': 'db_fly', 'flyes': 'db_fly',
    'incline db flye': 'db_incline_fly', 'lying reverse db flye': 'rear_delt_fly',
    'reverse cable crossover': 'cable_rear_fly', 'cable crossover': 'cable_fly',
    'barbell rdl': 'rdl', 'bb rdl': 'rdl', 'db lunge': 'walking_lunge', 'barbell lunge': 'walking_lunge',
    'triceps pressdown': 'rope_pushdown', 'tricep pressdown': 'rope_pushdown', 'pressdown': 'rope_pushdown',
    'triceps pushdown': 'rope_pushdown',
    // Pulls that were scoring onto pushes
    'close grip pull up': 'neutral_pullup', 'close grip pull-up': 'neutral_pullup',
    'close grip lat pulldown': 'pulldown_neutral', 'close-grip lat pulldown': 'pulldown_neutral',
    '1 arm cable pulldown': 'pulldown_single', 'one arm cable pulldown': 'pulldown_single',
    'seated cable deadlift': 'seated_cable_row',
    // Hamstrings, quads and abs, each of which was landing on the wrong one
    'nordic ham curl': 'nordic_curl', 'nordic hamstring curl': 'nordic_curl',
    'lying leg raise': 'reverse_crunch', 'standing db curl': 'db_curl', 'standing dumbbell curl': 'db_curl',
    'alternating db curl': 'db_curl', 'bent knee dragon flag': 'dragon_flag',
    'smith machine lunge': 'split_squat', 'reverse nordic': 'reverse_nordic',
    // Forearms: extension is not curl, and it is not an overhead triceps extension either
    'wrist extension': 'reverse_wrist_curl', 'db wrist extension': 'reverse_wrist_curl',
    'dumbbell wrist extension': 'reverse_wrist_curl', 'cable wrist extension': 'reverse_wrist_curl',
    'db wrist curl': 'wrist_curl', 'dumbbell wrist curl': 'wrist_curl',
    // Odds and ends
    'seated dip machine': 'dip_machine', 'close grip dip': 'dip_triceps', 'close-grip dip': 'dip_triceps',
    'standing plate abduction': 'cable_abduction', 'machine hip abduction': 'hip_abduction',
    'weighted crunch': 'weighted_crunch', 'machine crunch': 'machine_crunch',
    'leg press calf press': 'leg_press_calf', 'donkey calf raise': 'donkey_calf',
    'bayesian cable curl': 'bayesian_curl', 'ez bar preacher curl': 'preacher_curl',
    'incline db y raise': 'db_y_raise_incline', 'modified zottman curl': 'zottman_curl_modified',
    'kelso shrug': 'kelso_shrug', 'incline db kelso shrug': 'kelso_shrug_db',
    'seated cable kelso shrug': 'kelso_shrug', 'cable shrug in': 'shrug_in_cable',
    'chest supported t bar row': 'tbar_row_supported', 'chest-supported t-bar row': 'tbar_row_supported',
    '1 arm reverse pec deck': 'reverse_pec_deck_single', 'one arm reverse pec deck': 'reverse_pec_deck_single',
    'smith machine jm press': 'jm_press_smith',
  };
  Object.keys(COACH_ALIASES).forEach(function (k) { if (!ALIASES[k]) ALIASES[k] = COACH_ALIASES[k]; });

  function aliasFor(q) {
    if (!ALIAS_N) {
      ALIAS_N = {};
      Object.keys(ALIASES).forEach(function (k) {
        ALIAS_N[k] = ALIASES[k];
        var expanded = norm(k).split(' ').map(function (t) { return SHORTHAND[t] || t; }).join(' ').trim();
        if (expanded && !ALIAS_N[expanded]) ALIAS_N[expanded] = ALIASES[k];
      });
    }
    return ALIAS_N[q] || null;
  }

  // ---- saying why -----------------------------------------------------------------------------
  // Competitors answer "how do I do this?" with video. We cannot make video, and a stock clip of a
  // stranger benching teaches less than one sentence about WHERE the movement is hard. The
  // resistance profile is already stored for every exercise, so the useful half of that answer is
  // something we hold and nobody else surfaces.
  var PROFILE_WHY = {
    len: 'Hardest at the bottom, with the muscle stretched. That is where a muscle grows most per set, so it earns its place even when the weight looks light.',
    mid: 'Loads the middle of the range hardest, which is where you can move the most weight. Good for adding load over a block.',
    sho: 'Hardest at the top, with the muscle short and squeezing. Fills in the part of the range a stretch-biased movement leaves out.',
  };
  // Setup notes worth writing by hand, because they are the ones people get wrong in a way that
  // costs them the target muscle. Deliberately not one per exercise: a cue on every movement in a
  // 272-strong library would be noise, and most movements have no gotcha worth a sentence.
  var CUES = {
    bb_bench: 'Shoulder blades pinned back and down, feet planted, bar to the lower chest.',
    db_incline: 'Bench at about 30 degrees. Steeper turns it into a shoulder press.',
    db_fly: 'Soft elbows, fixed. Think of hugging round a barrel, not pressing.',
    cable_lateral: 'Cable behind you, not in front. That is what keeps tension at the bottom.',
    db_lateral: 'Lead with the elbow and stop at shoulder height. Higher is traps, not side delt.',
    face_pull: 'Pull to the forehead and rotate outward at the end. High elbows throughout.',
    rdl: 'Push the hips back, bar close to the legs, stop when the hamstrings run out. It is a hinge, not a squat.',
    back_squat: 'Brace before you descend, knees tracking over the toes, hips and shoulders rising together.',
    hip_thrust: 'Chin tucked, ribs down, finish with the hips level. Do not arch the lower back to get higher.',
    seated_leg_curl: 'Torso upright and hips flexed. That is what makes this the stretch-biased curl.',
    lying_leg_curl: 'Hips pressed into the pad, no arching to swing the weight up.',
    lat_pulldown: 'Pull the elbows down to the ribs, chest up. Lean back a few degrees, no more.',
    bb_row: 'Hinge to roughly 45 degrees and hold it. If the torso rises with the bar, the weight is too heavy.',
    pullup: 'Full hang at the bottom, chest toward the bar at the top.',
    deadlift: 'Bar over midfoot, slack pulled out of the bar before you pull, hips and chest rising together.',
    bulgarian: 'Most of the weight on the front foot. Back foot is for balance, not driving.',
    skullcrusher: 'Lower to the forehead or just behind it, upper arms still.',
    overhead_ext_cable: 'Get the elbows above the head so the long head is stretched. That is the point of doing it overhead.',
    rope_pushdown: 'Elbows pinned to the sides, spread the rope at the bottom.',
    incline_curl: 'Let the arms hang behind the body. The stretch at the bottom is the whole reason for the incline.',
    bb_ohp: 'Squeeze the glutes and brace so the lower back does not take the load. Head moves through at the top.',
    hack_squat: 'Full depth if your hips allow it. Cutting it short trades away most of the quad stimulus.',
    leg_press: 'Do not let the lower back round off the pad at the bottom. That is your depth limit.',
    standing_calf: 'Full stretch at the bottom, pause at the top. Bouncing is the calf getting away with it.',
    cable_crunch: 'Round the spine down toward the knees. Hinging at the hips makes it a hip flexor exercise.',
    pike_pushup: 'Hips high, head travels to the floor between the hands.',
    kb_swing: 'It is a hinge and a hip snap, not a squat and a lift. The arms are rope.',
    ab_wheel: 'Ribs down and glutes squeezed the whole way. Stop before the lower back gives.',
    nordic_curl: 'Lower as slowly as you can control, hips extended throughout.',
    close_grip_bench: 'Shoulder-width grip, elbows tucked to about 45 degrees. Narrower hurts wrists without adding triceps.',
    chest_supported_row: 'Let the shoulder blades travel forward at the bottom. That is the stretch you came for.',
  };
  function cueFor(ex) { return ex && CUES[ex.id] ? CUES[ex.id] : null; }
  // Why this movement is in your plan, assembled from what we know rather than written by an AI.
  function whyFor(ex) {
    if (!ex || isCardio(ex)) return null;
    var prim = (ex.primary || []).map(function (m) { return MUSCLE_LABEL[m]; });
    var sec = (ex.secondary || []).map(function (m) { return MUSCLE_LABEL[m]; });
    var lead = prim.length > 1
      ? 'A full set each to ' + prim.slice(0, -1).join(', ') + ' and ' + prim[prim.length - 1] + '.'
      : 'A full set to ' + (prim[0] || 'the target muscle') + '.';
    if (sec.length) lead += ' Half a set each to ' + (sec.length > 1 ? sec.slice(0, -1).join(', ') + ' and ' + sec[sec.length - 1] : sec[0]) + '.';
    return lead + ' ' + (PROFILE_WHY[ex.profile] || '');
  }

  // Cardio and conditioning are LOGGED but never programmed and never counted in volume (see the
  // plan's open questions). Keeping them in one list means the logger can offer them without the
  // coverage maths ever seeing a movement it cannot attribute to a muscle.
  var CARDIO = [
    { id: 'cardio_run', name: 'Run', unit: 'time' },
    { id: 'cardio_walk', name: 'Walk', unit: 'time' },
    { id: 'cardio_bike', name: 'Bike', unit: 'time' },
    { id: 'cardio_row', name: 'Rower', unit: 'time' },
    { id: 'cardio_stairs', name: 'Stairmaster', unit: 'time' },
    { id: 'cardio_elliptical', name: 'Cross trainer', unit: 'time' },
    { id: 'cardio_swim', name: 'Swim', unit: 'time' },
    { id: 'cardio_class', name: 'Class', unit: 'time' },
    { id: 'cardio_sport', name: 'Sport', unit: 'time' },
    { id: 'cardio_other', name: 'Other cardio', unit: 'time' },
  ];
  var CARDIO_BY_ID = {};
  CARDIO.forEach(function (c) { c.cardio = true; CARDIO_BY_ID[c.id] = c; });

  function parseRow(line) {
    var p = line.split('|');
    return {
      id: p[0], name: p[1], equipment: p[2], pattern: p[3],
      primary: p[4] ? p[4].split(',') : [],
      secondary: p[5] ? p[5].split(',') : [],
      profile: p[6] || 'mid',
    };
  }
  var EXERCISES = TABLE.map(parseRow);
  var BY_ID = {};
  EXERCISES.forEach(function (e) { BY_ID[e.id] = e; });

  /* ---- variations: the same movement, done a different way -------------------------------------
   * A wide-grip T-bar row and a neutral-grip T-bar row are not the same lift. They load differently,
   * they get strong at different rates, and somebody who runs both wants to see both. So a variation
   * is a REAL exercise: its own id, its own history, its own personal best, exactly as Wide-grip
   * pulldown and Close-grip bench press already were. What changed is that they are no longer a
   * scattered handful of hand-written rows. Most movements that obviously take a grip or a stance
   * had none at all, and the only way to get one was to hand-build a custom exercise and re-answer
   * every muscle it works.
   *
   * They are generated rather than typed into TABLE for three reasons. A derived variation cannot
   * drift out of step with the movement it came from. The emphasis shift is stated once per grip
   * instead of re-typed per movement, so "wide grip moves work to the rear delts" is one line and
   * not forty. And TABLE stays something a person can read in a diff.
   *
   * WHAT A VARIATION MAY CHANGE: which muscles it mainly works. Nothing else. A wide-grip row is
   * still a horizontal pull done with a barbell at a mid-length resistance profile, and pretending
   * otherwise would corrupt warm-up ramps and gap-filling for the sake of a label.
   */
  var VARIANT_AXES = {
    // Horizontal pulls. Widening the grip rolls the work off the lats and onto the rear delts and
    // upper back; turning the palms up brings the biceps in properly.
    rowGrip: [
      { id: 'neutral', name: 'neutral grip' },
      { id: 'wide', name: 'wide grip', promote: ['rd'], demote: ['lt'] },
      { id: 'underhand', name: 'underhand', promote: ['bi'] },
    ],
    // Vertical pulls. Same idea, and underhand on a pulldown is a genuinely different lift.
    pulldownGrip: [
      { id: 'neutral', name: 'neutral grip' },
      { id: 'wide', name: 'wide grip', promote: ['ub'] },
      { id: 'underhand', name: 'underhand', promote: ['bi'] },
    ],
    // Horizontal presses. Narrowing the grip is the classic triceps builder; widening it is chest.
    pressGrip: [
      { id: 'close', name: 'close grip', promote: ['tr'], demote: ['ch'] },
      { id: 'wide', name: 'wide grip', promote: ['ch'], demote: ['tr'] },
    ],
    // Squat and press stances. Wide takes the adductors and glutes, narrow keeps it on the quads.
    stance: [
      { id: 'narrow', name: 'narrow stance', promote: ['qu'], demote: ['gl'] },
      { id: 'wide', name: 'wide stance', promote: ['ad', 'gl'], demote: ['qu'] },
    ],
    // Cable attachments, where the handle genuinely IS the movement.
    attachment: [
      { id: 'rope', name: 'rope' },
      { id: 'vbar', name: 'V-bar' },
    ],
  };
  /* THREE AXES THAT LOOK OBVIOUS AND ARE DELIBERATELY ABSENT.
   * Single arm and single leg: the library already carries thirteen hand-written unilateral entries
   * (Single-arm dumbbell row, Single-leg extension, Single-arm pushdown and so on). Generating
   * "Leg extension (single leg)" beside "Single-leg extension" would give people two rows for one
   * lift and split the history between them, which is the exact opposite of the point.
   * Bench angle: Incline and Decline are already separate entries for every press that takes them.
   * Cable attachments on triceps work: Rope pushdown and Bar pushdown are already separate entries.
   * Curl grips: Hammer curl and Reverse curl are canonical entries people actually type, and
   * "Dumbbell curl (hammer grip)" beside "Hammer curl" splits one lift's history across two rows.
   * The rule this follows is that a generated variation is only worth having where the library has
   * nothing, and duplicating a hand-written movement is worse than not offering the variation.
   */
  /* Which movements take which axes. Explicit and per-movement rather than derived from the pattern,
   * for two reasons: only some movements genuinely take a given grip (you cannot narrow your stance
   * on a leg curl), and the library already carries a scattering of hand-written variations that a
   * pattern rule would happily duplicate. A value of 1 means every option on the axis; an array
   * means only those options, which is how a movement that already has "Wide-grip pulldown" by hand
   * gets the other two without getting a second wide-grip entry.
   */
  var VARIANTS_FOR = {
    // ---- rows. The case this was built for: T-bar row had no grips at all.
    tbar_row: { rowGrip: 1 },
    bb_row: { rowGrip: 1 },
    pendlay: { rowGrip: ['wide', 'underhand'] },
    // Wide-grip cable row is a hand-written entry, so this one only gains underhand and the handles.
    seated_cable_row: { rowGrip: ['underhand'], attachment: 1 },
    machine_row: { rowGrip: 1 },
    chest_supported_row: { rowGrip: ['neutral', 'wide'] },
    plate_row: { rowGrip: ['neutral', 'wide'] },
    seal_row: { rowGrip: ['neutral', 'wide'] },
    inverted_row: { rowGrip: 1 },
    band_row: { rowGrip: ['neutral', 'wide'] },
    kb_row: { rowGrip: ['wide'] },
    // ---- vertical pulls. Wide, neutral and reverse pulldowns are hand-written entries already, so
    // the pulldown only gains the two attachments the library has no row for.
    lat_pulldown: { attachment: 1 },
    pullup: { pulldownGrip: ['wide', 'underhand'] },
    // ---- horizontal presses. Close-grip bench is a hand-written entry, so the barbell only gains wide.
    bb_bench: { pressGrip: ['wide'] },
    db_bench: { pressGrip: 1 },
    smith_bench: { pressGrip: 1 },
    pushup: { pressGrip: ['wide'] },
    bb_ohp: { pressGrip: 1 },
    // ---- squats and leg presses. Narrow-stance leg press is hand-written, so it only gains wide.
    back_squat: { stance: 1 },
    front_squat: { stance: ['narrow'] },
    hack_squat: { stance: 1 },
    smith_squat: { stance: 1 },
    goblet_squat: { stance: ['wide'] },
    // ---- hinges are deliberately absent. Sumo deadlift, B-stance Romanian deadlift and Single-leg
    // Romanian deadlift are all hand-written already, and a generated "Romanian deadlift (wide
    // stance)" was close enough to the B-stance entry to start capturing imports off it.
    // ---- curls are deliberately absent. Hammer curl and Reverse curl are already canonical
    // hand-written entries covering every grip anybody runs, and "Dumbbell curl (hammer grip)"
    // beside "Hammer curl" is two rows for one lift with the history split between them.
  };
  // Move a muscle into or out of the primary list. Never empties primary: a movement with nothing in
  // it contributes nothing to the coverage audit, which is worse than a slightly generous attribution.
  function shiftEmphasis(parent, opt) {
    var prim = (parent.primary || []).slice();
    var sec = (parent.secondary || []).slice();
    (opt.demote || []).forEach(function (m) {
      if (prim.indexOf(m) < 0 || prim.length <= 1) return;
      prim = prim.filter(function (x) { return x !== m; });
      if (sec.indexOf(m) < 0) sec.push(m);
    });
    (opt.promote || []).forEach(function (m) {
      if (prim.indexOf(m) >= 0) return;
      sec = sec.filter(function (x) { return x !== m; });
      prim.push(m);
    });
    return { primary: prim, secondary: sec };
  }
  function buildVariants() {
    var out = [];
    var takenName = {};
    EXERCISES.forEach(function (e) { takenName[norm(e.name)] = 1; });
    Object.keys(VARIANTS_FOR).forEach(function (pid) {
      var parent = BY_ID[pid];
      if (!parent) return;                       // a renamed movement should not mint orphans
      var axes = VARIANTS_FOR[pid];
      Object.keys(axes).forEach(function (axisId) {
        var opts = VARIANT_AXES[axisId];
        if (!opts) return;
        var only = axes[axisId];
        opts.forEach(function (o) {
          if (only !== 1 && only.indexOf(o.id) < 0) return;
          var id = pid + '__' + o.id;
          var name = parent.name + ' (' + o.name + ')';
          // Belt and braces against the hand-written entries this is meant to complement rather
          // than duplicate.
          if (BY_ID[id] || takenName[norm(name)]) return;
          var em = shiftEmphasis(parent, o);
          var v = {
            id: id, name: name,
            equipment: parent.equipment, pattern: parent.pattern, profile: parent.profile,
            primary: em.primary, secondary: em.secondary.filter(function (m) { return em.primary.indexOf(m) < 0; }),
            variantOf: pid, variant: o.id, variantLabel: o.name,
          };
          takenName[norm(name)] = 1;
          out.push(v);
        });
      });
    });
    return out;
  }
  var VARIANTS = buildVariants();
  VARIANTS.forEach(function (v) { BY_ID[v.id] = v; });
  EXERCISES = EXERCISES.concat(VARIANTS);
  // Parent id -> its variations, built once. The picker and the swap sheet both read this, so a
  // movement's ways of being done are one lookup rather than a scan of three hundred rows.
  var VARIANTS_BY_PARENT = {};
  VARIANTS.forEach(function (v) {
    if (!VARIANTS_BY_PARENT[v.variantOf]) VARIANTS_BY_PARENT[v.variantOf] = [];
    VARIANTS_BY_PARENT[v.variantOf].push(v);
  });
  // The movement a variation came from, or the movement itself when it is not one. Custom variations
  // (the ones people build by hand) carry the same variantOf field, so they answer here too.
  function baseOf(id, custom) {
    var e = byId(id, custom);
    return (e && e.variantOf) || id;
  }
  // Every way of doing this movement: the movement itself first, then its variations, generated and
  // hand-built alike. Given a variation it returns its siblings, because "swap this for another grip"
  // is asked far more often from inside a variation than from the plain version.
  function variantsOf(id, custom) {
    var base = baseOf(id, custom);
    var parent = byId(base, custom);
    if (!parent) return [];
    var kids = (VARIANTS_BY_PARENT[base] || []).slice();
    (custom || []).forEach(function (c) { if (c && c.variantOf === base) kids.push(c); });
    if (!kids.length) return [];
    return [parent].concat(kids);
  }

  // A custom exercise a user invented still needs muscle attribution, otherwise it silently
  // contributes nothing and the coverage panel lies. The UI forces a primary muscle on create.
  function byId(id, custom) {
    if (BY_ID[id]) return BY_ID[id];
    if (CARDIO_BY_ID[id]) return CARDIO_BY_ID[id];
    if (custom && custom.length) { for (var i = 0; i < custom.length; i++) if (custom[i].id === id) return custom[i]; }
    return null;
  }
  function all(custom) { return EXERCISES.concat(custom || []); }
  function isCardio(ex) { return !!(ex && (ex.cardio || CARDIO_BY_ID[ex.id])); }

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\((.*?)\)/g, ' $1 ')
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // Coaching apps and spreadsheets label every movement with the coach's own tag: "CAM - PENDULUM
  // SQUAT", "TW – Leg Press". A short token followed by a SPACED dash is never part of a movement's
  // name, and left in it does real damage: it is one more query token that matched nothing, and the
  // score divides by how much of the query matched, so a whole plan can drop below the threshold and
  // vanish. The spaces are what make this safe, so "T-bar row" and "Low-to-high cable fly" survive.
  // u2013 and u2014 are the en and em dash, written as escapes because the build refuses a literal
  // em dash anywhere in the bundle. Coaching apps use all three separators interchangeably.
  var COACH_PREFIX = /^\s*[^\s]{1,14}(\s+[^\s]{1,14})?\s+[-\u2013\u2014:]\s+/;
  // What people actually write, expanded to what the library calls it. Without this "DB SEATED
  // SHOULDER PRESS" scores 0.33 against "Dumbbell shoulder press" and is thrown away for being one
  // hundredth under the bar.
  // Kit and count abbreviations ONLY. Muscle words are deliberately absent: "lat pulldown" is what
  // the movement is actually called, and expanding it to "lats pulldown" walks straight past both the
  // alias table and the exact-name match. An abbreviation earns a place here when the long form is
  // what the library calls it and the short form is what a coach types.
  var SHORTHAND = {
    db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', kb: 'kettlebell', bw: 'bodyweight',
    ohp: 'overhead press', bor: 'bent over row', ohtx: 'overhead triceps',
    tricep: 'triceps', bicep: 'biceps', mach: 'machine', alt: 'alternating',
    // A spelling, not a movement. Without this the sheets' "Cable Flye" and "DB Flye" mint a second
    // copy of a fly the library already holds, under a spelling nobody would search for.
    flye: 'fly', flyes: 'flies',
    // Universally the Romanian deadlift, and left unexpanded it files "Barbell RDL" as a second
    // entry beside the Romanian deadlift it already is.
    rdl: 'romanian deadlift', rdls: 'romanian deadlift',
    // "Ham curl" is a hamstring curl. Left alone it files the sheets' "Nordic Ham Curl" beside the
    // Nordic hamstring curl already in the library.
    ham: 'hamstring', hams: 'hamstring',
  };
  // Strip the noise a caption or a coach's spreadsheet carries: set/rep counts, tempo, RIR, the
  // numbering people put in front of a movement ("A1.", "3)"), and the coach's own tag.
  function cleanName(s) {
    var raw = String(s || '').replace(COACH_PREFIX, '');
    return norm(raw
      // List markers a coach numbers their plan with: "a) Bench press", "B. Squat", "3 - Deadlift".
      // A BARE hyphen only counts when whitespace follows it, for the same reason COACH_PREFIX above
      // insists on spaces: without that, "B-stance Romanian deadlift" loses its "B-" and becomes
      // "stance Romanian deadlift", and "4-week block" loses its "4-". That used to resolve correctly
      // anyway, but only by luck: "stance" was a rare enough token to carry the match on its own, and
      // it stopped being rare the moment squats gained narrow and wide stance variations. A name that
      // survives cleaning matches exactly and does not depend on how rare its words happen to be.
      .replace(/^\s*[a-dA-D]?\d{0,2}\s*(?:[\).:]\s*|-\s+)/, '')
      .replace(/\b\d+\s*[x×]\s*\d+(\s*-\s*\d+)?\b/g, ' ')
      .replace(/\b\d+\s*(sets?|reps?)\b/g, ' ')
      .replace(/\b\d\s*rir\b/g, ' ')
      .replace(/\b\d{4}\b/g, ' ')
      .replace(/@.*$/, ' '))
      .split(' ').map(function (t, i, a) {
        // "Ham" is shorthand for hamstring - except in "glute-ham raise", where it is half of the
        // movement's actual name and expanding it stops the movement matching itself.
        if ((t === 'ham' || t === 'hams') && a[i - 1] === 'glute') return t;
        return SHORTHAND[t] || t;
      }).join(' ').trim();
  }

  // Resolve a free-text movement name to a library id. Exact, then alias, then a token-overlap
  // score. Returns null rather than guessing wildly, so the import UI can flag it for the user
  // instead of quietly logging bench press as bicep curls.
  function resolve(name, custom) {
    var d = resolveDetail(name, custom);
    return d ? d.id : null;
  }
  // Same work, but it says HOW it got there. An exact name and a 0.35 token overlap both come back as
  // an id, and the person reviewing an import has no way to tell which lines to look at twice. The
  // import screen shows the shaky ones rather than making you re-read all twenty-nine.
  function resolveDetail(name, custom) {
    var q = cleanName(name);
    if (!q) return null;
    var pool = all(custom);
    var i, e;
    for (i = 0; i < pool.length; i++) if (norm(pool[i].name) === q) return { id: pool[i].id, how: 'exact', score: 1 };
    var al = aliasFor(q); if (al) return { id: al, how: 'alias', score: 1 };
    var singular = q.replace(/s$/, '');
    al = aliasFor(singular); if (al) return { id: al, how: 'alias', score: 1 };
    var qt = q.split(' ').filter(Boolean);
    var best = null, bestScore = 0;
    for (i = 0; i < pool.length; i++) {
      e = pool[i];
      var et = norm(e.name).split(' ').filter(Boolean);
      var hit = 0, qw = 0, ew = 0;
      for (var j = 0; j < qt.length; j++) {
        qw += weightOf(qt[j]);
        for (var k = 0; k < et.length; k++) {
          if (tokenMatch(qt[j], et[k])) { hit += weightOf(qt[j]); break; }
        }
      }
      for (k = 0; k < et.length; k++) ew += weightOf(et[k]);
      // Score by how much of BOTH names matched, so "row" does not beat "seated cable row" for the
      // query "seated cable row", and a one-word query cannot claim a five-word name.
      //
      // Tokens are WEIGHTED by how rare they are across the library, which is what lets the score
      // tell "alternating dumbbell HAMMER curl" apart from a plain dumbbell curl: "dumbbell" is in
      // dozens of names and says almost nothing, "hammer" is in a handful and says everything. Under
      // a flat count those two tie and the winner is whichever happens to sit earlier in the table,
      // which is how a hammer curl became a dumbbell curl and a split squat became a Smith squat.
      var score = qw && ew ? (hit / qw) * (hit / ew) : 0;
      // A hand-written movement beats a GENERATED variation at the same score. Both "Hammer curl"
      // and "Dumbbell curl (hammer grip)" are real entries and both score the same against
      // "ALTERNATING DUMBBELL HAMMER CURL", but only one of them is what a coach writing that line
      // meant: the canonical name is the one people type, and the variation exists for somebody
      // choosing it deliberately in the picker. Without this tiebreak, generating variations
      // silently re-pointed imports that had resolved correctly for months.
      if (e.variantOf) score *= 0.98;
      if (score > bestScore) { bestScore = score; best = e.id; }
    }
    // Comfortably clear of the threshold is a match nobody needs to check. Just over it is a guess
    // that happened to win, and those are the ones worth a second look.
    if (bestScore >= 0.34) return { id: best, how: bestScore >= 0.6 ? 'strong' : 'loose', score: bestScore };
    // Last resort, and only ever on a line that was otherwise going to be thrown away: coaches append
    // qualifiers the library has never heard of ("French press (OHTX)", "T-bar row (mega mass)"), so
    // try the alias table against the leading words alone. Running this AFTER scoring is what keeps it
    // safe: it can rescue a dropped movement but never outrank a good match.
    for (var n = qt.length - 1; n >= 2; n--) {
      var lead = aliasFor(qt.slice(0, n).join(' '));
      if (lead) return { id: lead, how: 'loose', score: 0.34 };
    }
    return null;
  }
  function tokenMatch(a, b) {
    return a === b || (a.length > 3 && b.indexOf(a) === 0) || (b.length > 3 && a.indexOf(b) === 0);
  }
  // Inverse document frequency over the library's own names, computed once. A token nothing in the
  // library uses (a coach's tag, a gym's brand) scores high on rarity but can never be MATCHED, so it
  // only ever costs the query, which is exactly the pressure that makes a stray word survivable.
  var DF = null;
  function weightOf(tok) {
    if (!DF) {
      DF = {};
      EXERCISES.forEach(function (e) {
        var seen = {};
        norm(e.name).split(' ').filter(Boolean).forEach(function (t) {
          if (seen[t]) return; seen[t] = 1; DF[t] = (DF[t] || 0) + 1;
        });
      });
    }
    // Match the same prefix rule the scorer uses, so "dumbbell" is not treated as rare just because
    // half its occurrences are spelt "dumbell" or reached by prefix.
    var df = DF[tok] || 0;
    if (!df) for (var k in DF) if (tokenMatch(tok, k)) { df = Math.max(df, DF[k]); }
    return Math.log(1 + EXERCISES.length / (1 + df));
  }

  /* Variations are folded away unless you asked for one. Searching "row" should return the rows, not
   * eleven ways to hold a T-bar with the movement you wanted pushed off the bottom of the list. So a
   * variation is dropped when the movement it came from is also a hit, UNLESS the query says
   * something its parent's name does not: "t-bar row neutral" wants the neutral one, "row" does not.
   * The picker offers the folded-away ones under their parent, so nothing is unreachable.
   */
  function search(q, custom, limit) {
    var n = norm(q);
    var pool = all(custom);
    if (!n) pool = pool.filter(function (e) { return !e.variantOf; });
    if (!n) return pool.slice(0, limit || 30);
    var starts = [], contains = [];
    for (var i = 0; i < pool.length; i++) {
      var nm = norm(pool[i].name);
      if (nm.indexOf(n) === 0) starts.push(pool[i]);
      else if (nm.indexOf(n) !== -1) contains.push(pool[i]);
    }
    // A variation surfaces only when the query names its grip, stance or handle as a WHOLE word.
    // Whole word matters: the list is matched on substrings, and without it a search for "row"
    // returns four narrow-stance squats, because "row" is inside "narrow".
    var qt = n.split(' ').filter(Boolean);
    var hits = starts.concat(contains).filter(function (e) {
      if (!e.variantOf) return true;
      var mod = norm(e.variantLabel || '').split(' ').filter(Boolean);
      return mod.some(function (m) { return qt.indexOf(m) >= 0; });
    });
    return hits.slice(0, limit || 30);
  }

  // ---- volume --------------------------------------------------------------------------------
  // Fractional counting. An exercise gives a full set to everything it primarily moves and half a
  // set to everything it assists. Without the half, a push/pull split looks like it never trains
  // triceps; with a full set for assistance, every pressing day reads as a triceps day.
  function setContribution(ex) {
    var out = {};
    if (!ex || isCardio(ex)) return out;
    (ex.primary || []).forEach(function (m) { out[m] = (out[m] || 0) + PRIMARY_WEIGHT; });
    (ex.secondary || []).forEach(function (m) { if (!out[m]) out[m] = SECONDARY_WEIGHT; });
    return out;
  }

  // Weekly sets per muscle for a set of session prescriptions (the PLAN side).
  // `sessions` is a list of { exercises: [{ exerciseId, target:{sets} }] }.
  function plannedVolume(sessions, custom) {
    var out = {};
    MUSCLES.forEach(function (m) { out[m] = 0; });
    (sessions || []).forEach(function (s) {
      (s.exercises || []).forEach(function (item) {
        var ex = byId(item.exerciseId, custom);
        var sets = (item.target && +item.target.sets) || 0;
        var contrib = setContribution(ex);
        for (var m in contrib) out[m] = round(out[m] + contrib[m] * sets, 2);
      });
    });
    return out;
  }

  // Weekly sets per muscle actually PERFORMED. Only completed working sets count: warm-ups do not
  // grow anything, and an unticked set is an intention, not a stimulus.
  function performedVolume(logs, custom) {
    var out = {};
    MUSCLES.forEach(function (m) { out[m] = 0; });
    (logs || []).forEach(function (log) {
      (log.sets || []).forEach(function (st) {
        if (!st.done) return;
        if (st.type && st.type !== 'work') return;
        var contrib = setContribution(byId(st.exerciseId, custom));
        for (var m in contrib) out[m] = round(out[m] + contrib[m], 2);
      });
    });
    return out;
  }

  // Per-user landmarks. Experience scales the productive band; a user who has completed blocks
  // gets their own tuned numbers layered on top (see tuneTargets).
  function defaultTargets(prefs) {
    var style = styleOf(prefs && prefs.style);
    // Min-max's numbers are the method, not a starting point to be scaled: an advanced lifter on it
    // does not get more sets, they get harder ones. Anything a person has set for themselves still
    // wins below, exactly as it does on the other model.
    var scale = style.landmarks ? 1 : (EXPERIENCE_SCALE[(prefs && prefs.experience) || 'intermediate'] || 1);
    var table = style.landmarks || LANDMARKS;
    var out = {};
    MUSCLES.forEach(function (m) {
      var L = table[m];
      out[m] = {
        // A landmark of nought means "this one is not programmed directly" and has to survive the
        // floor below, or the method cannot say it. Under min-max that is obliques, adductors,
        // lower back and forearms: paid by the squat, the hinge and everything you hold on to, and
        // a floor of one set is enough to make the generator spend a movement on each of them.
        mev: L.mev === 0 ? 0 : Math.max(scale === 1 ? 1 : 3, Math.round(L.mev * (scale < 1 ? scale + 0.15 : 1))),
        mav: Math.round(L.mav * scale),
        mrv: Math.round(L.mrv * scale),
      };
    });
    if (prefs && prefs.volumeTargets) {
      for (var m2 in prefs.volumeTargets) if (out[m2]) out[m2] = Object.assign({}, out[m2], prefs.volumeTargets[m2]);
    }
    return out;
  }

  // The landmarks a call should use when it was not handed any. The style has to be part of that
  // question: asking for a min-max block without passing targets used to build it against the volume
  // model's ceilings - twenty-two sets of chest as the limit on a method that caps at eight - and
  // nothing about the result would have said so.
  function targetsFor(opts) {
    if (opts && opts.targets) return opts.targets;
    var prefs = (opts && opts.prefs) || {};
    return defaultTargets(Object.assign({}, prefs, { style: (opts && opts.style) || prefs.style }));
  }

  // "I want to bring my shoulders up." A block cannot grow everything hardest at once, so emphasis is
  // a TRADE: the named muscles start nearer the top of their productive band, and everything else
  // drops back toward its floor to pay for the extra fatigue. Without the second half this would just
  // be "do more of everything", which is how people end up over-reached and blaming the programme.
  function emphasise(targets, muscles) {
    var out = JSON.parse(JSON.stringify(targets));
    var want = {}; (muscles || []).forEach(function (m) { if (out[m]) want[m] = 1; });
    if (!Object.keys(want).length) return out;
    MUSCLES.forEach(function (m) {
      var t = out[m];
      if (want[m]) t.mev = Math.min(t.mrv - 2, Math.round((t.mev + t.mav) / 2));
      else t.mev = Math.max(3, Math.round(t.mev * 0.8));
    });
    return out;
  }

  var BANDS = ['none', 'under', 'maintaining', 'productive', 'high', 'over'];
  // Where a muscle's weekly volume sits against its own landmarks. 'productive' is the target.
  // 'high' is the top of MAV up to MRV, which is fine for a peak week and not fine for four.
  function band(sets, L) {
    if (!sets) return 'none';
    if (sets < L.mev * 0.55) return 'under';
    if (sets < L.mev) return 'maintaining';
    if (sets <= L.mav) return 'productive';
    if (sets <= L.mrv) return 'high';
    return 'over';
  }

  // The coverage audit. This is the deterministic core the AI is not allowed to touch.
  function coverage(volume, targets) {
    var rows = MUSCLES.map(function (m) {
      var sets = round(volume[m] || 0, 1);
      var L = targets[m];
      return {
        muscle: m, label: MUSCLE_LABEL[m], sets: sets, mev: L.mev, mav: L.mav, mrv: L.mrv,
        band: band(sets, L),
        pct: L.mav ? clamp(sets / L.mav, 0, 1.5) : 0,
        deficit: sets < L.mev ? round(L.mev - sets, 1) : 0,
        excess: sets > L.mrv ? round(sets - L.mrv, 1) : 0,
      };
    });
    var gaps = rows.filter(function (r) {
      // A floor of nought means the style does not programme this muscle at all - obliques and
      // adductors under min-max, paid by the brace and the squat. Nought sets of it is the plan
      // working, not a hole in it, and reporting it as a gap is the app telling somebody their own
      // flagship programme is broken.
      if (!r.mev) return false;
      return r.band === 'none' || r.band === 'under' || r.band === 'maintaining';
    }).sort(function (a, b) { return b.deficit - a.deficit; });
    var overs = rows.filter(function (r) { return r.band === 'over'; })
      .sort(function (a, b) { return b.excess - a.excess; });
    var inBand = rows.filter(function (r) { return r.band === 'productive' || r.band === 'high'; }).length;
    return {
      rows: rows, gaps: gaps, overs: overs,
      score: Math.round((inBand / MUSCLES.length) * 100),
      totalSets: round(rows.reduce(function (a, r) { return a + r.sets; }, 0), 1),
    };
  }

  // How often each muscle is hit across the week. Twice beats once at matched volume, so a muscle
  // sitting at a good weekly total but crammed into one session is still worth flagging.
  function frequency(sessions, custom) {
    var out = {};
    MUSCLES.forEach(function (m) { out[m] = 0; });
    (sessions || []).forEach(function (s) {
      var seen = {};
      (s.exercises || []).forEach(function (item) {
        var c = setContribution(byId(item.exerciseId, custom));
        for (var m in c) if (c[m] >= PRIMARY_WEIGHT) seen[m] = 1;
      });
      for (var m2 in seen) out[m2]++;
    });
    return out;
  }

  // Candidate movements to close a gap, ranked. Respects the user's equipment and dislikes, and
  // prefers a resistance profile they are NOT already running for that muscle. The AI picks from
  // this shortlist and writes the reason; it does not get to invent the shortlist.
  function suggestFor(muscle, opts) {
    opts = opts || {};
    var have = opts.equipment && opts.equipment.length ? opts.equipment : null;
    var dislikes = {}; (opts.dislikes || []).forEach(function (d) { dislikes[d] = 1; });
    (opts.excluded || []).forEach(function (d) { dislikes[d] = 1; });
    var usedProfiles = {}; (opts.currentExerciseIds || []).forEach(function (id) {
      var e = byId(id, opts.custom);
      if (e && (e.primary || []).indexOf(muscle) !== -1) usedProfiles[e.profile] = 1;
    });
    var used = {}; (opts.currentExerciseIds || []).forEach(function (id) { used[id] = 1; });
    return all(opts.custom)
      .filter(function (e) {
        if (isCardio(e) || used[e.id] || dislikes[e.id]) return false;
        if ((e.primary || []).indexOf(muscle) === -1) return false;
        if (have && have.indexOf(e.equipment) === -1) return false;
        return true;
      })
      .map(function (e) {
        var score = 0;
        if (!usedProfiles[e.profile]) score += 3;              // fill a missing resistance profile
        if (e.pattern === 'isolation') score += 1;             // gaps are usually closed with isolation
        if (e.equipment === 'cable' || e.equipment === 'machine') score += 1; // low fatigue cost
        return { exercise: e, score: score };
      })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, opts.limit || 5)
      .map(function (r) { return r.exercise; });
  }

  // ---- strength maths ------------------------------------------------------------------------
  // Epley. Above about 12 reps every 1RM formula drifts badly, so we simply stop reporting one
  // rather than charting a number we know is wrong.
  function e1rm(weightKg, reps) {
    var w = +weightKg || 0, r = +reps || 0;
    if (w <= 0 || r <= 0 || r > 12) return 0;
    if (r === 1) return round(w, 1);
    return round(w * (1 + r / 30), 1);
  }
  function setVolume(st) { return (+st.weightKg || 0) * (+st.reps || 0); }
  function tonnage(log) {
    return round((log && log.sets || []).reduce(function (a, s) {
      return a + (s.done && (!s.type || s.type === 'work') ? setVolume(s) : 0);
    }, 0), 1);
  }
  function bestSet(sets) {
    var best = null, bestE = 0;
    (sets || []).forEach(function (s) {
      if (!s.done) return;
      var e = e1rm(s.weightKg, s.reps);
      if (e > bestE) { bestE = e; best = s; }
    });
    return best ? { set: best, e1rm: bestE } : null;
  }
  // Personal records, rebuilt from the logs rather than stored as truth, so editing a mis-typed
  // set cannot leave a phantom PR behind for ever.
  function computePRs(logs) {
    var out = {};
    (logs || []).forEach(function (log) {
      (log.sets || []).forEach(function (s) {
        if (!s.done || (s.type && s.type !== 'work')) return;
        var e = e1rm(s.weightKg, s.reps);
        if (!e) return;
        var cur = out[s.exerciseId];
        if (!cur || e > cur.e1rm) out[s.exerciseId] = { e1rm: e, weightKg: +s.weightKg || 0, reps: +s.reps || 0, dateISO: log.dateISO };
      });
    });
    return out;
  }
  // ---- personal records ------------------------------------------------------------------------
  // The best you have ever done on a movement, BEFORE a given date. Everything about celebrating a
  // record depends on this being "before", not "including": comparing a set against a list that
  // already contains it means nothing is ever a record.
  function bestBefore(logs, exerciseId, beforeISO, excludeLogId) {
    var best = { e1rm: 0, weightKg: 0, repsAtBest: 0, dateISO: null };
    (logs || []).forEach(function (log) {
      if (beforeISO && log.dateISO >= beforeISO) return;
      if (excludeLogId && log.id === excludeLogId) return;
      (log.sets || []).forEach(function (s) {
        if (!s.done || (s.type && s.type !== 'work')) return;
        if (s.exerciseId !== exerciseId) return;
        var w = +s.weightKg || 0, r = +s.reps || 0;
        var e = e1rm(w, r);
        if (e > best.e1rm) { best.e1rm = e; best.dateISO = log.dateISO; }
        if (w > best.weightKg) { best.weightKg = w; best.repsAtBest = r; }
      });
    });
    return best;
  }

  // Is this set a record, and what kind? Three kinds, because they mean different things and people
  // care about all three: the heaviest you have ever lifted, the most reps you have managed at that
  // weight, and the best estimated one-rep max. A tiny epsilon on e1RM stops floating point noise
  // reporting a "record" that is 0.0001kg better than last week.
  function prKind(weightKg, reps, best) {
    var w = +weightKg || 0, r = +reps || 0;
    if (w <= 0 || r <= 0) return null;
    if (!best || (!best.e1rm && !best.weightKg)) return null;   // a first-ever set is not a record
    if (w > best.weightKg + 0.01) return { kind: 'weight', label: 'Heaviest ever', value: w };
    if (Math.abs(w - best.weightKg) < 0.01 && r > best.repsAtBest) return { kind: 'reps', label: 'Most reps at ' + round(w, 1), value: r };
    var e = e1rm(w, r);
    if (e > best.e1rm + 0.05) return { kind: 'e1rm', label: 'Best estimated 1RM', value: e };
    return null;
  }

  // Every record set inside one logged session, worked out against everything that came before it.
  // Used to mark up history, so scrolling back through your sessions shows where the good days were.
  function prsInLog(logs, log) {
    var out = [];
    if (!log) return out;
    var seen = {};
    (log.sets || []).forEach(function (s, i) {
      if (!s.done || (s.type && s.type !== 'work')) return;
      // Compare against history AND against the earlier sets of this same session, so five identical
      // sets do not report five records.
      var best = bestBefore(logs, s.exerciseId, log.dateISO, log.id);
      (seen[s.exerciseId] || []).forEach(function (p) {
        if (p.e1rm > best.e1rm) { best.e1rm = p.e1rm; }
        if (p.weightKg > best.weightKg) { best.weightKg = p.weightKg; best.repsAtBest = p.reps; }
        else if (Math.abs(p.weightKg - best.weightKg) < 0.01 && p.reps > best.repsAtBest) best.repsAtBest = p.reps;
      });
      var pr = prKind(s.weightKg, s.reps, best);
      if (pr) out.push(Object.assign({ exerciseId: s.exerciseId, setIndex: i }, pr));
      if (!seen[s.exerciseId]) seen[s.exerciseId] = [];
      seen[s.exerciseId].push({ e1rm: e1rm(s.weightKg, s.reps), weightKg: +s.weightKg || 0, reps: +s.reps || 0 });
    });
    // One record per movement per session: the best of them. Working up 95, 110, 125 beats your old
    // best three times over, but nobody says "I set three bench records today", they say what they
    // finished on. Reporting each rung turns a real achievement into a list.
    var bestPerEx = {};
    out.forEach(function (p) {
      var cur = bestPerEx[p.exerciseId];
      if (!cur || p.value > cur.value || (p.kind === 'weight' && cur.kind !== 'weight')) bestPerEx[p.exerciseId] = p;
    });
    return Object.keys(bestPerEx).map(function (k) { return bestPerEx[k]; })
      .sort(function (a, b) { return a.setIndex - b.setIndex; });
  }

  /* What to show under a movement you have not done before, when you HAVE done the one it came from.
   * Picking a grip for the first time is the moment a separate-lift model feels worst: the row goes
   * blank, and a blank row on the way into a session is worse than useless because the number you
   * want is sitting right there under the parent movement.
   *
   * So the reference falls back to the movement it came from, and says so. It never pretends to be
   * this variation's own history: `fromId` is handed back precisely so the caller can label it, and
   * nothing here touches personal bests, which stay strictly per lift as they should.
   */
  function lastReference(logs, exerciseId, beforeISO, custom) {
    var own = bestBefore(logs, exerciseId, beforeISO);
    if (own && own.weightKg > 0) return { best: own, fromId: exerciseId, borrowed: false };
    var base = baseOf(exerciseId, custom);
    if (base === exerciseId) return null;
    var parent = bestBefore(logs, base, beforeISO);
    if (!parent || !(parent.weightKg > 0)) return null;
    return { best: parent, fromId: base, borrowed: true };
  }

  // The e1RM series for one movement, best set per session, oldest first.
  function exerciseHistory(logs, exerciseId) {
    return (logs || [])
      .map(function (log) {
        var sets = (log.sets || []).filter(function (s) { return s.exerciseId === exerciseId && s.done && (!s.type || s.type === 'work'); });
        if (!sets.length) return null;
        var b = bestSet(sets);
        return {
          dateISO: log.dateISO, sets: sets.length,
          tonnage: round(sets.reduce(function (a, s) { return a + setVolume(s); }, 0), 1),
          e1rm: b ? b.e1rm : 0, topWeight: Math.max.apply(null, sets.map(function (s) { return +s.weightKg || 0; })),
          topReps: b ? +b.set.reps || 0 : 0,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : 1; });
  }

  // ---- loading the bar -------------------------------------------------------------------------
  // What to hang on each side to hit a target. Doing this in your head under a loaded bar is the
  // kind of small friction that makes people round to a number they can work out instead of the
  // number they should be lifting.
  var PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
  var PLATES_LB = [45, 35, 25, 10, 5, 2.5];
  function plateBreakdown(totalKg, opts) {
    opts = opts || {};
    var lb = opts.units === 'lb';
    var barKg = opts.barKg != null ? opts.barKg : (lb ? 20.4116 : 20);
    var avail = opts.plates && opts.plates.length ? opts.plates.slice() : (lb ? PLATES_LB : PLATES_KG);
    avail.sort(function (a, b) { return b - a; });
    var total = lb ? (+totalKg || 0) * 2.20462 : (+totalKg || 0);
    var bar = lb ? barKg * 2.20462 : barKg;
    if (total < bar - 0.01) return { ok: false, reason: 'under_bar', barKg: barKg };
    var perSide = (total - bar) / 2;
    var out = [], left = perSide;
    for (var i = 0; i < avail.length; i++) {
      // A tiny epsilon, because 2.5 + 1.25 in floating point does not always land where you expect
      // and a rounding slip here shows up as a phantom plate on the bar.
      var n = Math.floor((left + 1e-6) / avail[i]);
      if (n > 0) { out.push({ plate: avail[i], count: n }); left -= n * avail[i]; }
    }
    return {
      ok: left < 0.02, perSide: out, leftover: round(left, 2), barKg: barKg,
      // What the bar actually weighs once loaded, so the UI can show "closest you can make: 82.5".
      achievable: round((lb ? (bar + (perSide - left) * 2) / 2.20462 : bar + (perSide - left) * 2), 2),
    };
  }
  function usesBar(ex) {
    return !!(ex && (ex.equipment === 'barbell' || ex.equipment === 'ez' || ex.equipment === 'trapbar' || ex.equipment === 'smith'));
  }

  // Warm-up ramp to a working weight. Compounds get a real ramp; isolation gets one easy set at most,
  // because nobody needs three warm-up sets of cable lateral raises and prescribing them wastes the
  // session. Returns [] when the working weight is at or near an empty bar.
  function warmupSets(workingKg, ex, opts) {
    opts = opts || {};
    var w = +workingKg || 0;
    if (w <= 0) return [];
    var compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
    var barKg = usesBar(ex) ? (opts.barKg != null ? opts.barKg : 20) : 0;
    if (!compound) {
      if (opts.count === 0) return [];
      if (w < 15) return [];
      return [{ pct: 0.5, weightKg: roundToIncrement(w * 0.5, ex), reps: 10 }];
    }
    if (w <= barKg * 1.2) return [{ pct: 1, weightKg: barKg || round(w, 1), reps: 10 }];
    // Heavier lifts earn more rungs. A 60kg working set does not need four build-up sets, and
    // prescribing them is how a warm-up turns into the session.
    var ramp = w >= 100 ? [[0.4, 8], [0.6, 5], [0.8, 3], [0.9, 1]]
      : w >= 60 ? [[0.5, 8], [0.75, 4], [0.9, 2]]
      : [[0.5, 8], [0.8, 4]];
    // A written plan often states how many warm-up sets a movement wants - 0 to 1 on a cable curl,
    // 2 to 4 on a squat - and the author's number beats ours, because they know what the movement
    // costs in their programme. Taken from the TOP of the ramp: asked for two, you want the two
    // nearest your working weight, not the two lightest.
    if (opts.count != null) {
      var want = clamp(Math.round(+opts.count), 0, ramp.length);
      if (!want) return [];
      ramp = ramp.slice(ramp.length - want);
    }
    return ramp.map(function (r) {
      return { pct: r[0], weightKg: roundToIncrement(Math.max(barKg, w * r[0]), ex), reps: r[1] };
    }).filter(function (s, i, arr) {
      // Drop a rung that lands on the same weight as the one before it, which happens on light lifts.
      return i === 0 || s.weightKg > arr[i - 1].weightKg;
    });
  }
  function roundToIncrement(kg, ex) {
    var inc = (ex && ex.equipment === 'dumbbell') ? 2 : 2.5;
    return Math.max(inc, Math.round((+kg || 0) / inc) * inc);
  }

  // ---- progression ---------------------------------------------------------------------------
  // Double progression, as the priority order in the plan: reps inside the range, then load with a
  // reset to the bottom of the range, then a set. The load jump is relative because +2.5kg means
  // something different on a leg press and a lateral raise.
  var LOWER_BODY = ['qu', 'ha', 'gl', 'ad', 'ca'];
  // The smallest jump this movement can actually be loaded by. Dumbbells come in pairs and jump in
  // twos; everything else moves in 2.5s.
  function loadUnit(ex) { return (ex && ex.equipment === 'dumbbell') ? 2 : 2.5; }
  function isLowerBody(ex) {
    return !!(ex && (ex.primary || []).filter(function (m) { return LOWER_BODY.indexOf(m) !== -1; }).length);
  }
  function loadStep(ex, weightKg, style) {
    var w = +weightKg || 0;
    if (!w) return 0;
    var inc = loadUnit(ex);
    // On a style where every set is already all-out, a percentage jump is the wrong tool: there is
    // no reserve to absorb it. The step is the smallest the kit allows - one notch upstairs, two on
    // the big lower-body movements, which is the 1.25-2.5kg / 2.5-5kg the method is written around.
    if (styleOf(style).toFailure) return isLowerBody(ex) ? inc * 2 : inc;
    var pct = (ex && (ex.pattern === 'isolation' || ex.pattern === 'core')) ? 0.04 : 0.025;
    var raw = w * pct;
    return Math.max(inc, Math.round(raw / inc) * inc);
  }

  // The second set, when a movement has one. The first set was taken to genuine failure, so asking
  // for the same weight again is asking for a set that lands three reps under the window and teaches
  // nobody anything. Fifteen percent off puts the second set back inside the window it is being
  // judged against, which is the only way it counts as a second working set at all.
  function backOffLoad(topKg, ex) {
    var w = +topKg || 0;
    if (!w) return 0;
    var inc = loadUnit(ex);
    return Math.max(inc, Math.round((w * 0.85) / inc) * inc);
  }

  // Three sessions on identical weight AND identical reps is a plateau, and on this style it is not
  // a volume problem: there is no volume to take away. The answer is a different movement - the same
  // job done by a slightly different pattern, which resets the progression cycle without resetting
  // the person's training. Deliberately stricter than detectStall's e1RM test: a rep either side is
  // somebody still moving, and only a dead-flat repeat is worth interrupting for.
  function minmaxPlateau(history) {
    var h = (history || []).slice(-3);
    if (h.length < 3) return null;
    var w = h[0].topWeight, r = h[0].topReps;
    if (!w || !r) return null;
    var flat = h.every(function (x) { return x.topWeight === w && x.topReps === r; });
    if (!flat) return null;
    return { stalled: true, sessions: h.length, weightKg: w, reps: r };
  }

  // What to swap a stalled movement for: the same job, a different pattern. Same primary muscle
  // first, then whatever the shortlist would offer anybody training that muscle, minus the movement
  // that stalled and anything already in the session.
  function substituteFor(exerciseId, opts) {
    opts = opts || {};
    var ex = byId(exerciseId, opts.custom);
    if (!ex) return [];
    var muscle = (ex.primary || [])[0];
    if (!muscle) return [];
    var out = suggestFor(muscle, {
      equipment: opts.equipment, dislikes: (opts.dislikes || []).concat([exerciseId]),
      custom: opts.custom, currentExerciseIds: (opts.currentExerciseIds || []).concat([exerciseId]),
      limit: (opts.limit || 3) + 2,
    }).filter(function (c) { return c.id !== exerciseId; });
    // Same shape of movement first: swapping a chest press for a fly is a different exercise, not
    // the same exercise done another way.
    var wantStable = styleOf(opts.style).stableKit;
    out.sort(function (a, b) {
      var score = function (c) {
        return (c.pattern === ex.pattern ? 2 : 0) + (wantStable && STABLE_KIT[c.equipment] ? 1 : 0);
      };
      return score(b) - score(a);
    });
    return out.slice(0, opts.limit || 3);
  }

  /* ---- movements that do the same job ----------------------------------------------------------
   * Hand-written, and deliberately kept apart from the programmes' own `alts`. Those are a
   * transcription of the author's spreadsheet, checked against it column by column by
   * tools/verify-programmes.mjs, and our opinions do not belong in somebody else's plan.
   *
   * This is the app's own knowledge instead, and it answers a question the plan cannot: what to do
   * when a movement is not in a written programme at all, or when the two substitutions the author
   * had room for are both unavailable too. The incline press is the case that names the pattern -
   * the bar, the Smith, the machine and the dumbbells are four ways to load the same movement, and
   * a gym that is missing one almost always has another.
   *
   * Only pairs that genuinely swap: same movement, same joint action, same job in a session. A
   * lateral raise is not a Y-raise and a fly is not a press, however close they look on a muscle
   * chart. Anything not listed here still gets suggestions worked out from the muscle and the
   * pattern; this table is for the ones worth being sure about.
   */
  var SAME_JOB = {
    // Presses, by what is holding the weight.
    bb_incline: ['smith_machine_incline_press', 'machine_incline', 'db_incline'],
    smith_machine_incline_press: ['bb_incline', 'machine_incline', 'db_incline'],
    machine_incline: ['bb_incline', 'smith_machine_incline_press', 'db_incline'],
    db_incline: ['machine_incline', 'bb_incline', 'smith_machine_incline_press'],
    bb_bench: ['smith_bench', 'machine_press', 'db_bench'],
    smith_bench: ['bb_bench', 'machine_press', 'db_bench'],
    machine_press: ['smith_bench', 'bb_bench', 'db_bench'],
    db_bench: ['machine_press', 'bb_bench', 'smith_bench'],
    bb_ohp: ['smith_overhead_press', 'machine_ohp', 'db_ohp'],
    machine_ohp: ['smith_overhead_press', 'db_ohp', 'bb_ohp'],
    db_ohp: ['machine_ohp', 'smith_overhead_press', 'bb_ohp'],
    seated_machine_press: ['machine_ohp', 'db_ohp', 'smith_overhead_press'],
    /* Raises that put the arm overhead in a Y. Only these two: the prone version looks like the
     * same movement and is not one - lying face down turns it into a rear-delt and upper-back
     * exercise, which is why the library attributes it that way, and offering it as a sure thing for
     * a side-delt raise would quietly take the side delts out of the session. It can still turn up
     * as a suggestion, where it is marked as our guess rather than something we know. */
    db_y_raise_incline: ['cable_y_raise'],
    cable_y_raise: ['db_y_raise_incline'],
    // Side delts.
    db_lateral: ['cable_lateral', 'machine_lateral'],
    cable_lateral: ['db_lateral', 'machine_lateral'],
    machine_lateral: ['cable_lateral', 'db_lateral'],
    // Hinges, squats and the rest of the big patterns.
    rdl: ['db_rdl', 'good_morning'],
    db_rdl: ['rdl', 'good_morning'],
    back_squat: ['hack_squat', 'smith_squat', 'leg_press'],
    hack_squat: ['back_squat', 'pendulum_squat', 'leg_press'],
    leg_press: ['hack_squat', 'smith_squat'],
    lying_leg_curl: ['seated_leg_curl'],
    seated_leg_curl: ['lying_leg_curl'],
    standing_calf: ['leg_press_calf', 'seated_calf'],
    // Pulls.
    lat_pulldown: ['pullup', 'lat_pulldown_wide_grip'],
    pullup: ['lat_pulldown', 'neutral_pullup'],
    seated_cable_row: ['chest_supported_row', 'chest_supported_machine_row'],
    chest_supported_row: ['seated_cable_row', 'chest_supported_machine_row'],
    // Arms.
    bb_curl: ['ez_curl', 'db_curl'],
    ez_curl: ['bb_curl', 'db_curl'],
    db_curl: ['ez_curl', 'bb_curl'],
    triceps_pressdown: ['rope_pushdown', 'overhead_cable_triceps_extension'],
    rope_pushdown: ['triceps_pressdown', 'overhead_cable_triceps_extension'],
  };
  // Both directions, always. A table written by hand gets edited by hand, and a pair that is listed
  // one way round but not the other is a movement you can leave but never get back to.
  function sameJobFor(id, custom) {
    var out = (SAME_JOB[id] || []).slice();
    Object.keys(SAME_JOB).forEach(function (k) {
      if (k !== id && SAME_JOB[k].indexOf(id) !== -1 && out.indexOf(k) === -1) out.push(k);
    });
    return out.filter(function (x) { return !!byId(x, custom); });
  }

  /* ---- what a movement can be replaced with ----------------------------------------------------
   * "Replace this" is a different question from "search the library", and for years it was answered
   * with the library: tapping a movement opened two hundred exercises and a text box. Somebody stood
   * in front of a busy incline bench does not want to go shopping. They want the two or three things
   * that do THIS movement's job, and for a written programme the author has usually already named
   * them.
   *
   * So the list is assembled in order of how much is actually KNOWN about each option:
   *   original  - what the plan said before it was replaced, so a replacement is never a one-way door
   *   plan      - the author's own substitutions (`alts`), or the options of a slot left open (`choice`)
   *   sameJob   - the library's own hand-written pairs, for the swaps worth being sure about
   *   suggested - worked out from the muscle and the movement pattern, to top a thin list up
   * Each entry says which it is, because "your coach wrote this down", "we know these two are the
   * same movement" and "we think this is similar" are three different claims, and a screen that
   * blurs them is lying quietly.
   *
   * Ways of doing the SAME movement - grips, stances, attachments - are deliberately not in here.
   * The picker already offers those on their own row, and listing them twice would push the genuine
   * alternatives off the bottom of a short list.
   */
  function replacementsFor(item, opts) {
    opts = opts || {};
    var current = item && item.exerciseId;
    if (!current) return [];
    var limit = opts.limit || 5;
    var out = [], seen = {};
    seen[current] = 1;
    // Everything else in the session, so a replacement cannot quietly duplicate a movement that is
    // already two rows further down.
    (opts.currentExerciseIds || []).forEach(function (id) { if (id !== current) seen[id] = 1; });
    function push(id, kind) {
      if (!id || seen[id]) return;
      var ex = byId(id, opts.custom);
      if (!ex) return;
      seen[id] = 1;
      out.push({ id: id, name: ex.name, equipment: ex.equipment, kind: kind });
    }
    push(item.baseExerciseId, 'original');
    // An open slot's options ARE the plan's answer here, and they beat `alts` when a row has both.
    // Length-checked rather than truthiness-checked: an empty array is truthy, so a slot that ended
    // up with no options would have silently swallowed the substitutions written beside it.
    var slot = item.choice && item.choice.options;
    (slot && slot.length ? slot : (item.alts || [])).forEach(function (id) { push(id, 'plan'); });
    // Filtered by what is actually in front of them. The plan's own substitutions are left alone -
    // those are the author's words and worth showing even when the kit is doubtful - but a pair the
    // app volunteers has no such excuse: offering a Smith machine to somebody training in a garage
    // is the same failure as opening a search box on them.
    var kit = opts.equipment && opts.equipment.length ? opts.equipment : null;
    var no = {}; (opts.dislikes || []).forEach(function (d) { no[d] = 1; });
    sameJobFor(current, opts.custom).forEach(function (id) {
      if (no[id]) return;
      var ex = byId(id, opts.custom);
      if (kit && ex && ex.equipment && ex.equipment !== 'bodyweight' && kit.indexOf(ex.equipment) === -1) return;
      push(id, 'sameJob');
    });
    if (out.length < limit) {
      substituteFor(current, {
        style: opts.style, custom: opts.custom, equipment: opts.equipment, dislikes: opts.dislikes,
        currentExerciseIds: Object.keys(seen), limit: limit - out.length,
      }).forEach(function (c) { push(c.id, 'suggested'); });
    }
    return out.slice(0, limit);
  }

  /* Replace one movement with another, in place. Moving the id is the easy part and it is all that
   * used to happen, which left two things behind:
   *
   * The movement it USED to be. `alts` lists what the author offered INSTEAD of the original, so
   * once the original had been overwritten it was gone from its own list and the only route back was
   * to remember its name and search for it. `baseExerciseId` is stamped on the first replacement and
   * never restamped, so a row replaced three times still offers what the plan actually asked for
   * rather than whatever it happened to be ten seconds ago.
   *
   * The coaching note. `planNote` is written about a specific movement - "use a 30 degree incline
   * bench and lift the weight up and out in a Y shape" - and leaving it under a lateral raise is
   * worse than having no note at all. It is put aside rather than thrown away, because going back to
   * the plan's own movement should bring the plan's own words back with it.
   *
   * Returns true when something changed, so a caller never has to re-derive whether it did.
   */
  function replaceExercise(row, toId) {
    if (!row || !toId || row.exerciseId === toId) return false;
    /* Answering an open slot from a movement's own Replace list is the same act as answering it from
     * the block screen's chips, and it has to read the same way: a question answered, not a movement
     * stood in for. Without this, picking the front squat off "Squat (Your Choice)" announced
     * "Front squat instead of Back squat" - naming a movement the plan never asked for - and took
     * the sentence explaining the slot away with it. */
    if (row.choice && (row.choice.options || []).indexOf(toId) !== -1) {
      row.exerciseId = toId;
      if (row.baseExerciseId) {
        if (row.basePlanNote) row.planNote = row.basePlanNote;
        delete row.basePlanNote;
        delete row.baseExerciseId;
      }
      return true;
    }
    if (!row.baseExerciseId) {
      row.baseExerciseId = row.exerciseId;
      if (row.planNote) row.basePlanNote = row.planNote;
    }
    row.exerciseId = toId;
    if (toId === row.baseExerciseId) {
      if (row.basePlanNote) row.planNote = row.basePlanNote;
      delete row.basePlanNote;
      delete row.baseExerciseId;
    } else if (row.planNote) {
      delete row.planNote;
    }
    return true;
  }

  // Given last week's prescription and what was actually done, what should next week say?
  // Returns { sets, repLow, repHigh, rir, weightKg, reason, action }.
  function progressExercise(prescription, performedSets, ex, opts) {
    opts = opts || {};
    var t = Object.assign({ sets: 3, repLow: 8, repHigh: 12, rir: 2 }, prescription || {});
    var done = (performedSets || []).filter(function (s) { return s.done && (!s.type || s.type === 'work'); });
    var next = Object.assign({}, t);
    if (!done.length) return Object.assign(next, { action: 'hold', reason: 'Nothing logged last time, so this repeats.' });

    /* ---- min-max: dynamic double progression off the top set --------------------------------
     * A set taken to genuine failure has already told you everything a percentage table was
     * guessing at, so there is nothing to calculate against a one-rep max: the reps you got at the
     * weight you used ARE the reading. Three outcomes, and only three.
     *
     * The set being read is the FIRST working set, because that is the all-out one. The second, if
     * there is one, was taken at a deliberately lighter weight (see backOffLoad) and judging next
     * week on it would walk the load down a notch every week.
     */
    if (styleOf(opts.style).toFailure) {
      var plateau = minmaxPlateau(opts.history);
      var lead = done[0];
      var w = +lead.weightKg || 0;
      var reps = +lead.reps || 0;
      next.weightKg = w;
      if (plateau) {
        return Object.assign(next, {
          action: 'swap', stalled: plateau,
          reason: 'Three sessions at the same weight for the same ' + plateau.reps + ' reps. That is not a volume problem and there is no volume here to take away, so change the movement rather than grind at this one.',
        });
      }
      if (!w) return Object.assign(next, { action: 'hold', reason: 'No weight logged last time, so this repeats.' });
      // Ceiling hit: the top of the window, in form, at failure. Smallest jump the kit allows.
      if (reps >= t.repHigh) {
        next.weightKg = w + loadStep(ex, w, 'minmax');
        return Object.assign(next, { action: 'load', reason: 'You got ' + reps + ' last time, which is the top of the window. Up one notch, and take it to failure again.' });
      }
      // Inside the window: the weight is right, so the job is one more rep than last time.
      if (reps >= t.repLow) {
        return Object.assign(next, { action: 'reps', reason: 'Same weight as last time. You got ' + reps + ', so the whole job today is ' + (reps + 1) + '.' });
      }
      // Under the floor: too heavy to be a stimulus rather than a test. Ten percent off.
      next.weightKg = Math.max(loadUnit(ex), Math.round((w * 0.9) / loadUnit(ex)) * loadUnit(ex));
      return Object.assign(next, { action: 'lighter', reason: 'Only ' + reps + ' last time, under the ' + t.repLow + ' this window needs. Ten percent off, so the set does some work rather than just being heavy.' });
    }

    var topWeight = Math.max.apply(null, done.map(function (s) { return +s.weightKg || 0; }));
    var atTop = done.filter(function (s) { return (+s.weightKg || 0) >= topWeight; });
    var minReps = Math.min.apply(null, atTop.map(function (s) { return +s.reps || 0; }));
    var avgRir = atTop.reduce(function (a, s) { return a + (s.rir == null ? t.rir : +s.rir); }, 0) / atTop.length;
    next.weightKg = topWeight;

    // Every working set cleared the top of the range: add load and drop back to the bottom.
    if (minReps >= t.repHigh) {
      next.weightKg = topWeight + loadStep(ex, topWeight);
      return Object.assign(next, { action: 'load', reason: 'You cleared ' + t.repHigh + ' on every set last time, so go heavier and aim for ' + t.repLow + ' at ' + t.rir + ' left in the tank.' });
    }
    // Comfortably inside the range: chase reps before weight.
    if (avgRir >= t.rir + 1) {
      return Object.assign(next, { action: 'reps', reason: 'Last time finished easier than ' + t.rir + ' reps left. Same weight, but take it closer.' });
    }
    // Grinding well past the target effort: hold, do not pile on.
    if (avgRir <= t.rir - 2) {
      return Object.assign(next, { action: 'hold', reason: 'Last time you went past ' + t.rir + ' reps left. Stay on that weight until it comes back under control.' });
    }
    return Object.assign(next, { action: 'reps', reason: 'On track. Pick the weight that leaves you ' + t.rir + ' reps short.' });
  }

  // A stall is three sessions with no improvement in e1RM. The response is deliberately NOT
  // "add volume": that is how people dig the hole deeper. Change the movement or back off.
  function detectStall(history, minSessions) {
    var h = (history || []).slice(-(minSessions || 3));
    if (h.length < (minSessions || 3)) return null;
    var first = h[0].e1rm, best = Math.max.apply(null, h.map(function (x) { return x.e1rm; }));
    if (!first) return null;
    if (best <= first * 1.005) {
      return { stalled: true, sessions: h.length, advice: 'This lift has not moved in ' + h.length + ' sessions. Swap the variation or take the load back 10% and build in again.' };
    }
    return null;
  }

  /* EVERY MOVEMENT YOU HAVE TRAINED, AND WHICH WAY IT IS GOING.
   *
   * "Am I getting stronger" had no screen. History listed your BESTS - a progress question filed
   * under the record of what happened - and Stats answered it with four scores against bodyweight
   * that by design move slowly, so nothing changed between visits and none of it named a lift. The
   * one number that actually answers the question, per movement, was computed everywhere and shown
   * nowhere: estimated 1RM over time.
   *
   * Sorted by what is MOVING rather than alphabetically, and split three ways, because the useful
   * part is not the list - it is the two or three lifts that have stopped. Those are the only rows
   * on the screen that ask you to decide something.
   *
   * `series` is the last `window` sessions' e1RM. `deltaPct` is measured across that window rather
   * than against all time: a lift you have trained for a year should be judged on the block you are
   * in, not flattered by where it started.
   *
   * A movement needs `minSessions` before it appears at all. Two points is not a trend, and a screen
   * that calls one session's difference "up 14%" teaches people to read noise as progress.
   */
  function liftTrends(logs, opts) {
    opts = opts || {};
    var window = opts.window || 8;
    var minSessions = opts.minSessions || 3;
    var stallAt = opts.stallSessions || 3;
    var ids = uniq((logs || []).reduce(function (a, l) {
      return a.concat((l.sets || []).filter(function (s) {
        return s.done && (!s.type || s.type === 'work');
      }).map(function (s) { return s.exerciseId; }));
    }, []));
    var rows = ids.map(function (id) {
      var hist = exerciseHistory(logs, id).filter(function (h) { return h.e1rm > 0; });
      if (hist.length < minSessions) return null;
      var win = hist.slice(-window);
      var series = win.map(function (h) { return h.e1rm; });
      var first = series[0] || 0, last = series[series.length - 1] || 0;
      var deltaPct = first ? round(((last - first) / first) * 100, 1) : 0;
      var ex = byId(id, opts.custom);
      var best = hist.reduce(function (a, h) { return h.e1rm > a.e1rm ? h : a; }, hist[0]);
      // Stuck is the engine's existing rule, not a new one: no new best in the last few sessions.
      var stall = detectStall(hist, stallAt);
      return {
        exerciseId: id, name: ex ? ex.name : id,
        sessions: hist.length, lastISO: hist[hist.length - 1].dateISO,
        e1rm: last, bestE1rm: best.e1rm, topKg: best.topWeight, topReps: best.topReps,
        series: series, deltaPct: deltaPct,
        // Falling is its own thing: a lift going backwards is not the same news as one standing
        // still, and lumping them together loses the only bit that is urgent.
        /* Stuck means stuck OVER THE WINDOW, not merely "no new best in the last three".
           Those come apart constantly: a lift can add sixteen percent across eight sessions and
           still not have set a best in the last three, because it just took a deload or because the
           top set landed a fortnight ago. Judging on the short rule alone put rows reading "+16.7%"
           under a heading saying they had stopped - the badge arguing with the label, on the one
           screen that exists to say which lifts are moving. The short rule now only decides between
           stuck and flat once the window itself has gone quiet. */
        state: deltaPct <= -1.5 ? 'down'
          : deltaPct >= 1.5 ? 'up'
            : (stall ? 'stuck' : 'flat'),
        stalled: !!stall,
      };
    }).filter(Boolean);
    var rank = { down: 0, stuck: 1, up: 2, flat: 3 };
    rows.sort(function (a, b) {
      if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
      // Within a group, the biggest mover first, and a tie broken by recency so a lift you trained
      // today outranks one from three weeks ago.
      if (Math.abs(b.deltaPct) !== Math.abs(a.deltaPct)) return Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
      return a.lastISO < b.lastISO ? 1 : -1;
    });
    var needsLook = rows.filter(function (r) { return r.state === 'down' || r.state === 'stuck'; });
    var up = rows.filter(function (r) { return r.state === 'up'; });
    /* THE ANSWER, as a shape the screen can phrase.
     * "Am I getting stronger" is a question with an answer, and the answer is a proportion: how many
     * movements are moving, out of how many you have trained enough to judge. The screen should not
     * be inventing that threshold in its markup, and it should not be left to the reader to work it
     * out of a list either - a list is the evidence, not the answer.
     * Deliberately three bands and no score. Anything finer would be pretending to a precision that
     * eight sessions of estimated 1RM does not carry. */
    var pct = rows.length ? up.length / rows.length : 0;
    var verdict = !rows.length ? 'none'
      : pct >= 0.9 ? 'yes'
        : pct >= 0.6 ? 'mostly'
          : pct >= 0.3 ? 'mixed'
            : 'stalling';
    return {
      rows: rows,
      needsLook: needsLook,
      up: up,
      steady: rows.filter(function (r) { return r.state === 'flat'; }),
      verdict: verdict,
      upCount: up.length,
      total: rows.length,
      // The single biggest gain, which is the one fact worth naming in the summary: it is the
      // evidence for the verdict, and it is the thing somebody actually wants to hear.
      best: up.length ? up.slice().sort(function (a, b) { return b.deltaPct - a.deltaPct; })[0] : null,
    };
  }

  // ---- the character sheet ---------------------------------------------------------------------
  // Four stats, every one of them derived from sets you actually logged. Nothing here is awarded for
  // turning up, which is the whole point: a number that goes up because you opened the app teaches
  // you nothing, and a number that goes up because you lifted more is the reason you came.
  //
  // Scales are relative to bodyweight where that is the honest comparison (a 100kg squat means
  // something different at 60kg and at 110kg), and capped at 100 so the bars stay readable.
  var STAT_LABELS = { str: 'Strength', pow: 'Power', end: 'Endurance', bal: 'Balance' };
  // Bodyweight multiples that read as "as good as it gets" on the bar. Deliberately set at strong
  // rather than elite: a bar that nobody can fill is a bar nobody looks at.
  var STAT_TOP = { squat: 2.0, hinge: 2.5, horizPress: 1.5, vertPull: 1.5 };
  function statSheet(logs, opts) {
    opts = opts || {};
    var bw = +opts.bodyweightKg || 75;
    var custom = opts.custom;
    var prs = computePRs(logs);
    var bestByPattern = {};
    for (var id in prs) {
      var ex = byId(id, custom);
      if (!ex) continue;
      var pat = ex.pattern;
      if (!STAT_TOP[pat]) continue;
      if (!bestByPattern[pat] || prs[id].e1rm > bestByPattern[pat]) bestByPattern[pat] = prs[id].e1rm;
    }
    // STRENGTH: how much of the four main patterns you have built, averaged. A missing pattern
    // scores zero rather than being skipped, because not squatting IS the answer to "how strong".
    var pats = Object.keys(STAT_TOP);
    var strScore = pats.reduce(function (a, p) {
      return a + clamp(((bestByPattern[p] || 0) / bw) / STAT_TOP[p], 0, 1);
    }, 0) / pats.length;

    // POWER: your single best lift relative to bodyweight, whatever it was.
    var bestAny = 0;
    for (var id2 in prs) if (prs[id2].e1rm > bestAny) bestAny = prs[id2].e1rm;
    var powScore = clamp((bestAny / bw) / 2.2, 0, 1);

    // ENDURANCE: how much work you get through in a week, and how much of it is in the higher rep
    // ranges. Both halves matter: 30 heavy triples is not the same quality as 30 sets of 12.
    var recent = (logs || []).slice().sort(function (a, b) { return a.dateISO < b.dateISO ? 1 : -1; }).slice(0, 12);
    var totalSets = 0, highRep = 0, reps = 0;
    recent.forEach(function (l) {
      (l.sets || []).forEach(function (s) {
        if (!s.done || (s.type && s.type !== 'work')) return;
        totalSets++; reps += +s.reps || 0;
        if ((+s.reps || 0) >= 12) highRep++;
      });
    });
    var weeks = Math.max(1, Math.min(4, Math.ceil(recent.length / 3)));
    var setsPerWeek = totalSets / weeks;
    var endScore = clamp(setsPerWeek / 80, 0, 1) * 0.7 + clamp(totalSets ? highRep / totalSets : 0, 0, 0.4) / 0.4 * 0.3;

    // BALANCE: how evenly the work is spread. This is the stat that punishes the classic
    // chest-and-arms week, and the only one you can raise without lifting anything heavier.
    //
    // It measures each muscle's progress TOWARD its own floor and averages that, rather than
    // counting how many muscles are already in the productive band. The band version reads zero for
    // everyone until their volume is already high, which makes it useless as a bar for exactly the
    // people who need to see it move: someone training three muscles hard and ignoring the rest
    // should score badly, but someone training everything a little should not score nothing.
    var perf = performedVolume(recent, custom);
    var targets2 = targetsFor(opts);
    var balScore = MUSCLES.reduce(function (a, m) {
      var perWeek = (perf[m] || 0) / weeks;
      var floor = (targets2[m] && targets2[m].mev) || 1;
      return a + clamp(perWeek / floor, 0, 1);
    }, 0) / MUSCLES.length;

    var pct = function (v) { return Math.round(clamp(v, 0, 1) * 100); };
    return {
      str: pct(strScore), pow: pct(powScore), end: pct(endScore), bal: pct(balScore),
      // The overall figure is the average, so no single stat can carry it. A very strong lifter who
      // trains four muscles is not a well-built dinosaur.
      overall: pct((strScore + powScore + endScore + balScore) / 4),
      bestLiftKg: round(bestAny, 1), setsPerWeek: round(setsPerWeek, 1),
      patterns: bestByPattern, labels: STAT_LABELS,
    };
  }

  // ---- blocks --------------------------------------------------------------------------------
  // Splits by days available. Two days is full body because anything else cannot hit a muscle
  // twice; six is a push/pull/legs run twice, which is the standard high-frequency answer.
  /* WHERE THE TRAINING WEEK FALLS, by how many days you train.
   *
   * The volume model used to put its sessions on consecutive days - four days meant Monday to
   * Thursday and a four-day weekend - because the split said what to train and nothing said when.
   * Consecutive is the one arrangement nobody actually runs: it stacks systemic fatigue into the
   * back half and leaves three quarters of the recovery in one block at the end.
   *
   * The default is a mid-week break: two on, one off, then the rest. It is the cadence the min-max
   * side of the app already prescribed for five days, and the shape most published four and five day
   * programmes run.
   *
   * It is a RECOMMENDATION, and it is the app's only opinion about your calendar. Every session can
   * be moved to whatever weekday actually suits (`reschedule`), and the plan is unchanged by where
   * it lands - what matters is the gap between sessions, not that Tuesday is a leg day.
   */
  var DEFAULT_DOW = {
    1: [0],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],          // Mon Tue / Wed off / Thu Fri / weekend off
    5: [0, 1, 3, 4, 5],       // Mon Tue / Wed off / Thu Fri Sat / Sun off
    6: [0, 1, 2, 3, 4, 5],
  };
  function defaultDows(days) {
    var n = Math.round(+days) || 4;
    if (DEFAULT_DOW[n]) return DEFAULT_DOW[n].slice();
    // More sessions than the week has days is a real import: eight screenshots, eight days. The map
    // stops at six, and returning a four-long array for an eight-session week is worse than useless -
    // the screen that consumes it would drop half the rows. Fill the week and double up from the
    // start, which is what the rest of the module does with an over-long template.
    var out = [];
    for (var i = 0; i < n; i++) out.push(i % 7);
    return out;
  }

  /* What to recommend for THIS block, which is not always the general recommendation.
   *
   * Min-max carries its weekdays in its own split because there the rest days are the method: a day
   * off in the middle of the week and one at the end are what make training everything to failure
   * survivable. Offering to "use the week we recommend" on one of those was the schedule screen
   * offering to overwrite the plan's own prescription with a generic one, under a sentence naming
   * days the block did not run. Everything else has no opinion of its own and takes DEFAULT_DOW.
   */
  function recommendedDows(block, sessionCount) {
    var n = Math.round(+sessionCount) || 4;
    var style = styleOf(block && block.style);
    if (style.toFailure && MINMAX_SPLITS[n]) {
      return MINMAX_SPLITS[n].map(function (d, i) { return d[2] == null ? i : d[2]; });
    }
    return defaultDows(n);
  }
  // Does this block prescribe its own week, or is it taking ours? The screen says a different thing
  // in each case, because "we suggest" and "this method requires" are not the same sentence.
  function prescribesDays(block) {
    return !!styleOf(block && block.style).toFailure;
  }

  var SPLITS = {
    2: [['full', 'Full body A'], ['full', 'Full body B']],
    3: [['full', 'Full body A'], ['full', 'Full body B'], ['full', 'Full body C']],
    4: [['upper', 'Upper A'], ['lower', 'Lower A'], ['upper', 'Upper B'], ['lower', 'Lower B']],
    5: [['push', 'Push A'], ['pull', 'Pull A'], ['legs', 'Legs A'], ['upper', 'Upper B'], ['lower', 'Lower B']],
    6: [['push', 'Push A'], ['pull', 'Pull A'], ['legs', 'Legs A'], ['push', 'Push B'], ['pull', 'Pull B'], ['legs', 'Legs B']],
  };
  /* The min-max week. Five sessions inside a seven-day microcycle, and the two rest days are part of
   * the prescription rather than what is left over: upper, lower, rest, upper, lower, arms, rest.
   * Every muscle still gets trained twice (the arms day is the second exposure for delts and arms),
   * and the systemic load of training everything to failure gets a day off in the middle of the week
   * and a day off at the end of it.
   *
   * Other day counts are allowed, because somebody who can only train three days should still be
   * able to train this way, but five is the shape the method is written for and the wizard says so.
   * The weekday numbers are part of the split, not an afterthought: the rest days only do their job
   * where they actually fall.
   */
  // [day kind, name, weekday, rep window]. The four and five day weeks are the cadences the published
  // programmes actually run - four days is full body, then upper, lower, arms after a gap; five is
  // upper, lower, rest, upper, lower, arms, rest. Two and three go full body for the same reason
  // they do on the other model: an upper/lower week run twice gives the legs one session, and one
  // session of two-set movements is not four sets of quads however hard they are taken.
  //
  // The rep window belongs to the SESSION, not to the movement, because that is how the programmes
  // are written: a muscle's first exposure of the week is the heavier one at 6 to 8 and its second
  // is 8 to 10. Same movements, same sets, a different corner of the rep range - which is variation
  // that costs nothing, unlike variation in volume.
  var MINMAX_SPLITS = {
    2: [['full', 'Full body A', 0, 'low'], ['full', 'Full body B', 3, 'high']],
    3: [['full', 'Full body A', 0, 'low'], ['full', 'Full body B', 2, 'high'], ['full', 'Full body C', 4, 'high']],
    4: [['full', 'Full body', 0, 'low'], ['upper', 'Upper', 3, 'high'], ['lower', 'Lower', 4, 'low'], ['arms', 'Arms and delts', 5, 'high']],
    5: [['upper', 'Upper A', 0, 'low'], ['lower', 'Lower A', 1, 'low'], ['upper', 'Upper B', 3, 'high'], ['lower', 'Lower B', 4, 'high'], ['arms', 'Arms and delts', 5, 'high']],
    6: [['upper', 'Upper A', 0, 'low'], ['lower', 'Lower A', 1, 'low'], ['arms', 'Arms and delts', 2, 'high'], ['upper', 'Upper B', 3, 'high'], ['lower', 'Lower B', 4, 'high'], ['full', 'Whatever is behind', 5, 'low']],
  };

  // Which muscles each day type is responsible for, in the order they should be trained: the
  // biggest compound first, isolation after, so the fatiguing work happens fresh.
  var DAY_MUSCLES = {
    full: ['qu', 'ch', 'lt', 'ha', 'sd', 'tr', 'bi', 'ab'],
    upper: ['ch', 'lt', 'ub', 'sd', 'tr', 'bi', 'rd'],
    lower: ['qu', 'ha', 'gl', 'ca', 'ab', 'ad'],
    push: ['ch', 'fd', 'sd', 'tr'],
    pull: ['lt', 'ub', 'rd', 'bi', 'fa'],
    legs: ['qu', 'ha', 'gl', 'ca', 'ad'],
    // The day the min-max week ends on. Delts and arms recover fastest and carry the most weekly
    // sets under that model, and giving them a session of their own is what buys the two big days
    // either side of it the room to be short.
    arms: ['sd', 'bi', 'tr', 'rd', 'fa'],
  };
  /* The same question answered by the method's own programmes, muscle for muscle.
   *
   * DAY_MUSCLES above is the volume model's answer and it is a fine one for a style where movements
   * are cheap and sets are what is being rationed. Min-max rations movements: five or six a session,
   * one or two sets each, so every slot spent is a slot not spent on something else. Read straight
   * off the two written programmes (see PROGRAMMES) - which is why there are no adductors, obliques
   * or lower back anywhere in it, and why forearms appear on the arms day and nowhere else. Four of
   * the nine movements on their arms and delts day are forearm work; nothing else in either
   * programme picks a movement for grip.
   */
  var MINMAX_DAY_MUSCLES = {
    full: ['qu', 'ch', 'lt', 'ha', 'sd', 'ca'],
    upper: ['ch', 'lt', 'ub', 'sd', 'tr', 'bi', 'rd', 'ab'],
    lower: ['qu', 'ha', 'gl', 'ca', 'ab'],
    push: ['ch', 'fd', 'sd', 'tr'],
    pull: ['lt', 'ub', 'rd', 'bi', 'fa'],
    legs: ['qu', 'ha', 'gl', 'ca'],
    arms: ['sd', 'bi', 'tr', 'fa', 'rd'],
  };

  // Which day kinds are a sane home for a muscle DAY_MUSCLES does not seed anywhere (front delts,
  // lower back, forearms, and on a push/pull/legs split, abs and obliques too). Read by
  // generateBlock's frequency guarantee, so that filling a muscle in to reach twice a week does not
  // land it on a day splitKind would then read as a different split entirely - a lower-back exercise
  // dropped into an "Upper" day quietly turns a clean upper/lower split into 'other'. null means any
  // day kind is fine, which is true of core work: splitKind never weighs abs or obliques either way.
  var DAY_KIND_HOME = {
    ch: { push: 1, upper: 1, full: 1 }, fd: { push: 1, upper: 1, full: 1 },
    sd: { push: 1, upper: 1, full: 1, arms: 1 }, tr: { push: 1, upper: 1, full: 1, arms: 1 },
    lt: { pull: 1, upper: 1, full: 1 }, ub: { pull: 1, upper: 1, full: 1 },
    rd: { pull: 1, upper: 1, full: 1, arms: 1 }, bi: { pull: 1, upper: 1, full: 1, arms: 1 }, fa: { pull: 1, upper: 1, full: 1, arms: 1 },
    qu: { legs: 1, lower: 1, full: 1 }, ha: { legs: 1, lower: 1, full: 1 }, gl: { legs: 1, lower: 1, full: 1 },
    ca: { legs: 1, lower: 1, full: 1 }, ad: { legs: 1, lower: 1, full: 1 }, lb: { legs: 1, lower: 1, full: 1 },
    ab: null, ob: null,
  };
  // Anchor movements: the compound each day should open with if the equipment is there.
  var ANCHORS = {
    ch: ['bb_bench', 'db_bench', 'machine_press', 'pushup'],
    lt: ['pullup', 'lat_pulldown', 'machine_pulldown'],
    ub: ['bb_row', 'seated_cable_row', 'chest_supported_row', 'inverted_row'],
    qu: ['back_squat', 'hack_squat', 'leg_press', 'goblet_squat', 'air_squat'],
    ha: ['rdl', 'db_rdl', 'seated_leg_curl', 'nordic_curl'],
    gl: ['hip_thrust', 'cable_pullthrough', 'glute_bridge'],
    fd: ['bb_ohp', 'db_ohp', 'machine_ohp'],
    sd: ['db_lateral', 'cable_lateral', 'machine_lateral'],
    rd: ['face_pull', 'reverse_pec_deck', 'rear_delt_fly'],
    tr: ['close_grip_bench', 'rope_pushdown', 'overhead_ext_cable', 'diamond_pushup'],
    bi: ['bb_curl', 'db_curl', 'incline_curl'],
    ca: ['standing_calf', 'seated_calf', 'db_calf'],
    ab: ['cable_crunch', 'hanging_leg_raise', 'ab_wheel', 'crunch'],
    ad: ['hip_adduction', 'copenhagen'],
    fa: ['hammer_curl', 'reverse_curl'],
    // good_morning used to sit here, but its primary mover is hamstrings, not lower back (see
    // TABLE) - it let pickFor('lb', ...) hand back a movement that does not actually train lb,
    // which the frequency guarantee in generateBlock surfaced immediately.
    lb: ['back_extension', 'back_ext_45'],
    ob: ['pallof_press', 'side_plank'],
  };

  // ---- gyms ------------------------------------------------------------------------------------
  // Nobody thinks about their gym as nine equipment checkboxes. They think "my gym" or "the hotel
  // one". A profile carries two things a checkbox list cannot: what is there, AND what to reach for
  // first, because the best choice for a muscle genuinely differs by setting. In a full gym a
  // machine or cable usually wins for hypertrophy work: it is stable, easy to load and easy to take
  // close to failure on your own. At home, with dumbbells and nobody to spot you, the safe way to
  // train hard is stretch-biased work you can bail out of.
  var GYMS = {
    commercial: {
      label: 'Commercial gym', hint: 'Full rack, machines and cables',
      equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'ez', 'kettlebell', 'trapbar', 'bodyweight', 'band'],
      prefer: ['machine', 'cable'], repBias: 0,
    },
    bodybuilding: {
      label: 'Bodybuilding gym', hint: 'Specialist plate-loaded kit as well',
      equipment: ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'ez', 'kettlebell', 'trapbar', 'bodyweight', 'band'],
      prefer: ['machine', 'cable', 'dumbbell'], repBias: 0,
    },
    home: {
      label: 'Home gym', hint: 'Dumbbells, a bench, maybe a bar',
      equipment: ['dumbbell', 'bodyweight', 'band', 'ez', 'kettlebell'],
      prefer: ['dumbbell'], repBias: 2,
      // Two questions that change a home gym more than anything else. A bench unlocks every pressing
      // angle and most rowing; a bar is the only real vertical pull.
      asks: ['bench', 'pullupBar'],
    },
    minimal: {
      label: 'Minimal or hotel', hint: 'Light dumbbells and your bodyweight',
      equipment: ['dumbbell', 'bodyweight', 'band'],
      prefer: ['bodyweight', 'dumbbell'], repBias: 4,
    },
    custom: { label: 'Custom', hint: 'Pick the kit yourself', equipment: null, prefer: [], repBias: 0 },
  };
  // Movements that need a bench or a pull-up bar to exist at all. Without this a home gym with
  // neither gets prescribed incline dumbbell presses and pull-ups, which is the fastest way to make
  // someone stop trusting the app.
  var NEEDS_BENCH = ['db_bench', 'db_incline', 'db_fly', 'db_incline_fly', 'incline_curl', 'db_curl_seated',
    'db_lateral_seated', 'chest_supported_row', 'seal_row', 'db_skullcrusher', 'tate_press', 'spider_curl',
    'preacher_curl', 'ez_preacher', 'bench_dip', 'decline_situp', 'db_step_up_high', 'squeeze_press', 'floor_press'];
  var NEEDS_BAR = ['pullup', 'chinup', 'neutral_pullup', 'pullup_weighted', 'chinup_negative', 'hanging_leg_raise',
    'hanging_knee_raise', 'toes_to_bar', 'dead_hang', 'towel_hang', 'dragon_flag', 'dragon_flag_negative', 'inverted_row'];

  // Resolve a saved gym into the { equipment, prefer, dislikes } the builder actually consumes.
  function gymEquipment(gym) {
    if (!gym) return { equipment: null, prefer: [], excluded: [] };
    var base = GYMS[gym.type] || GYMS.custom;
    var equipment = gym.equipment && gym.equipment.length ? gym.equipment : base.equipment;
    var excluded = [];
    if (gym.bench === false) excluded = excluded.concat(NEEDS_BENCH);
    if (gym.pullupBar === false) excluded = excluded.concat(NEEDS_BAR);
    return { equipment: equipment, prefer: base.prefer || [], excluded: excluded, repBias: base.repBias || 0 };
  }

  /* ---- how close to failure, per movement ------------------------------------------------------
   * Min-max does not take literally every set to failure, and the published programmes are precise
   * about it: the LAST set of a movement is the all-out one, and where a movement has two sets the
   * first stops a rep short. Isolation goes to failure on both, because the cost of failing a cable
   * curl is nothing; a squat's first set stops short, because the cost of failing that is a squat
   * you have to get out from under.
   *
   * The opening week of a block is easier again - one rep further back on everything, two on the
   * heaviest free-weight compounds. That is the intro week, and it is not a formality: it is what
   * lets weeks two to six be as hard as they are.
   */
  function minmaxEffort(ex, sets, intro) {
    var compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
    var heavy = compound && ex && !STABLE_KIT[ex.equipment] && ex.equipment !== 'bodyweight';
    var last = 0;
    var first = compound ? 1 : 0;
    if (intro) { var bump = heavy ? 2 : 1; first += bump; last += bump; }
    // One set means one all-out set: there is no earlier set for it to be the harder half of.
    return sets > 1 ? { rir: first, rirLast: last } : { rir: last, rirLast: last };
  }

  // Kit that holds the path of the bar for you, so the last rep of a set to failure is a rep that
  // stops rather than a rep that goes wrong. Trap bar counts: it is the one loaded free-weight
  // pattern where failing is a matter of setting it down.
  var STABLE_KIT = { machine: 1, cable: 1, smith: 1, trapbar: 1 };

  function pickFor(muscle, opts) {
    var have = opts.equipment && opts.equipment.length ? opts.equipment : null;
    var dislikes = {}; (opts.dislikes || []).forEach(function (d) { dislikes[d] = 1; });
    (opts.excluded || []).forEach(function (d) { dislikes[d] = 1; });
    var used = opts.used || {};
    var prefer = opts.prefer || [];
    // Movements the person brought, in the order their own plan listed them. A brought plan is a
    // list of choices somebody made on purpose - the machine their gym has, the variation their
    // shoulder tolerates, the movement their coach built the session around - and none of that is
    // recoverable from a muscle name. So when one of them trains the muscle being picked for, it
    // wins outright, and their own compound-first sequencing survives with it.
    var preferIds = {};
    (opts.preferIds || []).forEach(function (id, i) { if (preferIds[id] === undefined) preferIds[id] = i; });
    var anchors = ANCHORS[muscle] || [];
    var pool = anchors.concat(
      all(opts.custom).filter(function (e) { return (e.primary || []).indexOf(muscle) !== -1; }).map(function (e) { return e.id; })
    );
    // Score rather than take the first hit, so a gym's preferred kit actually changes what gets
    // picked. Anchor order still dominates (it encodes "open the day with the big compound"), but a
    // commercial gym reaches for the machine version of an accessory and a home gym does not.
    var best = null, bestScore = -1;
    for (var i = 0; i < pool.length; i++) {
      var e = byId(pool[i], opts.custom);
      if (!e || used[e.id] || dislikes[e.id]) continue;
      if (have && have.indexOf(e.equipment) === -1) continue;
      var anchorRank = anchors.indexOf(e.id);
      var score = anchorRank >= 0 ? (100 - anchorRank * 10) : 0;
      if (prefer.indexOf(e.equipment) !== -1) score += 6;
      // Training to failure changes what a good exercise is. The last rep of an all-out set is the
      // one where form goes, and on a barbell that is where the injury lives; on a machine or a
      // cable the worst case is that the weight stops moving. So a stable movement is worth a big
      // swing here - enough to take a machine press over a barbell one, which is exactly the trade
      // the method asks for, and not enough to reach for something that does not train the muscle.
      // Big enough to outrank the anchor order entirely, because that is what the method asks for:
      // a guided movement is not a tiebreak here, it is the requirement. Anchor rank still decides
      // between two machines. Bodyweight sits in the middle - nothing to drop on yourself, but not
      // loadable in the small steps the progression model runs on either.
      if (opts.stableKit) score += STABLE_KIT[e.equipment] ? 120 : (e.equipment === 'bodyweight' ? 40 : 0);
      if (preferIds[e.id] !== undefined) score += 1000 - Math.min(preferIds[e.id], 500);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // Tempo, written the way every coach writes it: four digits for the lowering, the pause at the
  // stretch, the lift, and the pause at the top. "0" means no deliberate pause, "X" means move it as
  // fast as you can. A controlled lowering is the half that actually matters for growth, which is why
  // the default puts two or three seconds there and nothing clever anywhere else.
  function defaultTempo(ex) {
    if (!ex) return '2010';
    if (ex.pattern === 'core' || ex.pattern === 'carry') return '2020';
    if (ex.profile === 'len') return '3010';   // stretch-biased work earns a slower lowering
    return ex.pattern === 'isolation' ? '2011' : '2010';
  }
  function tempoParts(tempo) {
    var t = String(tempo || '2010');
    if (!/^[0-9X]{4}$/i.test(t)) return null;
    var n = function (c) { return c.toUpperCase() === 'X' ? 'as fast as you can' : (c === '0' ? 'no pause' : c + ' sec'); };
    return {
      lower: n(t[0]), stretch: n(t[1]), lift: n(t[2]), top: n(t[3]),
      text: t[0] === '0' ? 'Lower under control.' :
        t[0] + ' seconds down' + (t[1] !== '0' ? ', ' + t[1] + ' at the stretch' : '') +
        (t[2].toUpperCase() === 'X' ? ', drive up fast' : ', ' + t[2] + ' up') +
        (t[3] !== '0' ? ', ' + t[3] + ' squeeze at the top' : '') + '.',
    };
  }

  // The letters on a coach's programme. A1/A2 are a superset done back to back; A, B, C are the
  // order you work through. Reading "C1" tells you where you are in the session at a glance, which is
  // exactly what a bare list of names does not.
  function sessionCodes(exercises) {
    var out = [], letter = 0, groupOf = {}, seen = {};
    (exercises || []).forEach(function (e) {
      var g = e.superset || e.supersetGroup || null;
      if (g && seen[g] == null) { seen[g] = letter++; }
      else if (!g) { seen['_' + out.length] = letter++; }
    });
    letter = 0;
    var groupIndex = {};
    (exercises || []).forEach(function (e, i) {
      var g = e.superset || e.supersetGroup || null;
      var l;
      if (g) {
        if (groupOf[g] == null) { groupOf[g] = letter++; groupIndex[g] = 0; }
        l = groupOf[g];
        out.push(String.fromCharCode(65 + (l % 26)) + (++groupIndex[g]));
      } else {
        l = letter++;
        out.push(String.fromCharCode(65 + (l % 26)) + '1');
      }
    });
    return out;
  }

  // The house style is a CHOICE, not a fact, so it is a parameter, not a constant baked into the
  // maths. 'high' (the default) is the pair of reference programmes this was built from: 2 working
  // sets to start a movement, RIR walking to true failure by the final building week, isolation work
  // held to the same 8-12 rep / long-rest range as the compounds. 'moderate' is the RP-style band
  // this replaced: more sets, effort stopping a few reps short, isolation allowed a wider, shorter
  // rest range - a real alternative for someone who finds training that close to failure unsustainable
  // week after week, not a worse version of the default.
  var INTENSITY = {
    high: { startSets: 2, rirFloor: 0, isoRepLow: 8, isoRepHigh: 12, isoRest: 120 },
    moderate: { startSets: 3, rirFloor: 1, isoRepLow: 10, isoRepHigh: 15, isoRest: 90 },
  };
  function intensityOf(key) { return INTENSITY[key] || INTENSITY.high; }

  function repScheme(ex, muscle, bias, intensity, style, window) {
    var b = +bias || 0;   // light kit means the same effort has to come from more reps, not more load
    var iv = intensityOf(intensity);
    var compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
    // Min-max runs two windows and nothing else, because the window IS the progression model: reach
    // the top of it in good form and the weight goes up, fall out of the bottom and it comes down.
    // Heavy compounds get 6 to 9, everything else 10 to 15. Rest is long, because one set decides
    // the movement and a set taken to failure on a half-recovered system is a wasted one.
    if (styleOf(style && style.key ? style.key : style).toFailure) {
      // Two windows, 6-8 and 8-10, and which one you are in is the session's business rather than
      // the movement's (see MINMAX_SPLITS). Rest is by how much of you the movement uses: three to
      // five minutes on the heavy compounds, two to three on the rest of them, one to two on
      // isolation - a set to failure on a half-recovered system is a wasted set.
      var rest = !compound ? 90 : (ex && !STABLE_KIT[ex.equipment] && isLowerBody(ex) ? 240 : 150);
      if (ex && ex.pattern === 'core') return { repLow: 6, repHigh: 8, restSec: 90 };
      return window === 'high'
        ? { repLow: 8 + b, repHigh: 10 + b, restSec: rest }
        : { repLow: 6 + b, repHigh: 8 + b, restSec: rest };
    }
    if (ex && ex.pattern === 'core') return { repLow: 10, repHigh: 20, restSec: 60 };
    // Both reference programmes hold isolation work in the same low-to-mid range as the compounds
    // (5-10 majority, "3/4 of your training" per the RIR-based programme's own rep-range chapter)
    // and rest it just as long: "long rest periods are superior to short... this also applies to
    // unilateral training". Longer, harder-recovered sets beat quick, shallow ones for growth.
    if (muscle === 'ca') return { repLow: 10 + b, repHigh: 15 + b, restSec: iv.isoRest };
    return compound
      ? { repLow: 6 + b, repHigh: 10 + b, restSec: 150 }
      : { repLow: iv.isoRepLow + b, repHigh: iv.isoRepHigh + b, restSec: iv.isoRest };
  }

  // Block shapes. The DEFAULT is four building weeks with no deload baked in, and that is a
  // deliberate change from the old "three on, one light" every single block.
  //
  // The survey evidence on what coaches in strength and physique sports actually do puts deloads at
  // roughly every 4 to 8 weeks (about 5.6 on average), for around 6 days, and describes them as
  // either preplanned OR autoregulated. A hard deload every fourth week sits at the very frequent
  // end of that range and applies it whether or not anything has accumulated. The cost is real:
  // an unnecessary deload interrupts the rhythm and throws away a productive week.
  //
  // So: build for four, then let deloadAdvice() read what actually happened and say whether a lighter
  // week is earned. Anyone who prefers the fixed rhythm can still choose it.
  var SHAPES = {
    // The house block, and the shape the app is built around: FOUR weeks, every one of them run at
    // the intensity a longer block would only reach at its end. No intro week - the ramp-in is what
    // a twelve-week programme spends its first week on because it has eleven more to come, and a
    // four-week block does not have a week to give away. So the last set of every movement is an
    // all-out set from session one.
    //
    // Four weeks is the shape on purpose. It is short enough to finish, short enough to hold a hard
    // prescription all the way through, and it puts a review and a fresh set of decisions in front
    // of somebody once a month rather than once a quarter.
    'minmax4': { build: 4, deload: false, label: '4 weeks, every one of them all-out' },
    // The twelve-week programmes' own shape, kept for anyone running one as its author wrote it:
    // six weeks, the first an intro week a rep or two further from failure on everything.
    'minmax6': { build: 6, deload: false, intro: true, label: '6 weeks: an easier first week, then five hard ones' },
    'build4': { build: 4, deload: false, label: '4 building weeks, then we check whether you need a lighter one' },
    'build3-deload1': { build: 3, deload: true, label: '3 building weeks and a lighter fourth, every block' },
    // Somebody else's plan, run the way they wrote it. No set added per week, no lighter fourth, no
    // trimming to our volume landmarks. It exists because importing a coach's block is a decision:
    // a plan built on two hard sets per movement is not an undercooked version of ours to be topped
    // up, it is a different bet, and quietly turning it into four sets by week three is not
    // periodisation, it is overruling the person whose plan you chose to follow.
    'as-written': { build: 0, deload: false, asWritten: true, label: 'Exactly as the plan is written, all four weeks' },
  };

  // Should the next week be a light one? Read off the markers the app already holds, in the order a
  // coach would weigh them. Deliberately conservative: it takes more than one soft signal to
  // recommend giving up a training week, because the default should be to keep going.
  //
  // Everything here is a marker the deloading literature and coaching practice actually name:
  // lifts stalling, effort creeping up for the same work, sessions being missed, volume sitting near
  // the ceiling, and life stress. The calorie-deficit input is ours: nobody else's training app
  // knows you are dieting, and dieting is the single biggest multiplier on all of it.
  function deloadAdvice(block, logs, targets, opts) {
    opts = opts || {};
    var blockLogs = (logs || []).filter(function (l) { return !block || l.blockId === block.id; });
    var reasons = [], score = 0;

    // 1. Lifts that have stopped moving. The clearest signal there is.
    var exIds = uniq(blockLogs.reduce(function (a, l) { return a.concat((l.sets || []).map(function (s) { return s.exerciseId; })); }, []));
    var stalled = exIds.filter(function (id) { return !!detectStall(exerciseHistory(blockLogs, id)); });
    if (stalled.length >= 2) { score += 2; reasons.push({ key: 'stalled', text: stalled.length + ' lifts have stopped moving.' }); }
    else if (stalled.length === 1) { score += 1; reasons.push({ key: 'stalled', text: 'One lift has stopped moving.' }); }

    // 2. Effort creeping up for the same work: the same weights are costing more reps in reserve
    // than they did at the start of the block. This is the "bar speed looks worse" signal, in the
    // only form we can measure.
    var early = [], late = [];
    blockLogs.slice().sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : 1; }).forEach(function (l, i, arr) {
      (l.sets || []).forEach(function (s) {
        if (!s.done || (s.type && s.type !== 'work') || s.rir == null) return;
        (i < arr.length / 2 ? early : late).push(+s.rir);
      });
    });
    if (early.length >= 6 && late.length >= 6) {
      var em = early.reduce(function (a, b) { return a + b; }, 0) / early.length;
      var lm = late.reduce(function (a, b) { return a + b; }, 0) / late.length;
      if (lm <= em - 0.75) { score += 2; reasons.push({ key: 'effort', text: 'The same sets are costing you more than they did at the start.' }); }
    }

    // 3. Sessions being missed. Often the first thing to go when someone is cooked.
    if (block) {
      var comp = completion(block, blockLogs, opts.todayISO);
      if (comp.total && comp.pct < 70) { score += 1; reasons.push({ key: 'missed', text: 'You got to ' + comp.pct + '% of the sessions.' }); }
    }

    // 4. Volume sitting near the ceiling for several muscles.
    if (block) {
      var weeks = Math.max(1, block.weeks || 4);
      var perf = performedVolume(blockLogs, custom0(opts));
      var perWeek = {}; MUSCLES.forEach(function (m) { perWeek[m] = round((perf[m] || 0) / weeks, 1); });
      var high = coverage(perWeek, targets).rows.filter(function (r) { return r.band === 'high' || r.band === 'over'; });
      if (high.length >= 4) { score += 1; reasons.push({ key: 'volume', text: high.length + ' muscles have been running near your ceiling.' }); }
    }

    // 5. Life. A deficit, bad sleep or a rough few weeks all raise the cost of everything above.
    if (opts.inDeficit) { score += 1; reasons.push({ key: 'deficit', text: 'You are eating in a deficit, which slows recovery.' }); }
    if (opts.poorSleep) { score += 1; reasons.push({ key: 'sleep', text: 'Your sleep has been short lately.' }); }

    return {
      needed: score >= 3,
      borderline: score === 2,
      score: score,
      reasons: reasons,
      advice: score >= 3
        ? 'Take a lighter week before the next block. Same movements, about half the sets, nothing near failure.'
        : score === 2
          ? 'You could go straight on, but a lighter week would not be wasted. Your call.'
          : 'Nothing here says you need a lighter week. Start the next block.',
    };
  }
  function custom0(opts) { return opts && opts.custom; }

  // Turn ONE week of sessions into a periodised block. Every route into a block goes through here:
  // the generator, an import from a video or a spreadsheet, and a hand-built routine. That is the
  // point, because it means a plan lifted off Instagram gets the same progression and the same MRV
  // ceiling as one we wrote ourselves, rather than being four identical weeks with no overload.
  //
  //   `template` = [{ kind, name, dayOfWeek, exercises: [{ id, exerciseId, order, target }] }]
  function blockFromTemplate(template, opts) {
    // Same rule as everywhere else a weekday is defaulted. A template that already carries days keeps
    // them; one that does not takes the recommended week, not 0,1,2,3.
    var tplDows = defaultDows((template || []).length);
    opts = opts || {};
    var weeks = opts.weeks || 4;
    var shape = SHAPES[opts.shape] ? opts.shape : 'build4';
    var targets = targetsFor(opts);
    var iv = intensityOf(opts.intensity);

    // Adding a set a week is how a block builds, but it must never walk a muscle past its own
    // ceiling. Triceps is the one that catches you out: every press feeds it half a set, so a
    // three-day week can cross MRV on assistance alone without any single exercise looking greedy.
    function trimToMRV(weekSess) {
      for (var guard = 0; guard < 60; guard++) {
        var overs = coverage(plannedVolume(weekSess, opts.custom), targets).overs;
        if (!overs.length) return;
        var m = overs[0].muscle;
        var cut = null;
        // Take the set off something that PRIMARILY trains it first, so we shrink the direct work
        // rather than gutting a compound the rest of the session is built around.
        for (var pri = 1; pri >= 0 && !cut; pri--) {
          for (var s = 0; s < weekSess.length && !cut; s++) {
            for (var e = 0; e < weekSess[s].exercises.length; e++) {
              var item = weekSess[s].exercises[e];
              if (item.target.sets <= 1) continue;
              var c = setContribution(byId(item.exerciseId, opts.custom));
              var isPrimary = c[m] >= PRIMARY_WEIGHT;
              if (c[m] && (pri ? isPrimary : !isPrimary)) { cut = item; break; }
            }
          }
        }
        if (!cut) return;   // nothing left to take, so stop rather than loop for ever
        cut.target.sets--;
      }
    }

    var asWritten = !!SHAPES[shape].asWritten;
    var style = styleOf(opts.style);
    // Minted before the sessions, not after, so every session and every line hangs off it. Ids used
    // to be derived from the template alone, which made two blocks built from one template share
    // every session id they had - fine while everything that reads a log filters by block first, and
    // a trap set for the first thing that does not.
    var blockId = 'blk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var sessions = [];
    for (var w = 1; w <= weeks; w++) {
      var isDeload = SHAPES[shape].deload && w === weeks;
      // Walks 3-2-1-0 on the default 'high' intensity: the final building week lands at true failure
      // (0 RIR), not a floor of 1. Stopping short of failure every week is the thing "high intensity"
      // is supposed to rule out. 'moderate' keeps the old floor of 1 for anyone who wants it.
      // Min-max walks nothing down across the block: weeks two to six are all as hard as each other,
      // and the only week that stops short is the one at the front (and a lighter week, if the shape
      // asks for one). Everything else that changes between week two and week six is on the bar.
      var isIntro = !!(style.toFailure && SHAPES[shape].intro && w === 1);
      var rir = style.toFailure ? 0 : (isDeload ? 4 : Math.max(iv.rirFloor, 4 - w));
      var weekSess = [];
      template.forEach(function (day, di) {
        weekSess.push({
          id: blockId + '_w' + w + 'd' + di,
          // Clamped for the same reason the draft basket clamps: a template holding more days than a
          // week has cannot hand a session a weekday that does not exist. It doubles up on Sunday
          // and can be moved from there, rather than landing somewhere nothing can draw or schedule.
          week: w, dayOfWeek: day.dayOfWeek == null ? tplDows[di] : clamp(+day.dayOfWeek, 0, 6),
          name: day.name || ('Day ' + (di + 1)), kind: day.kind || 'full',
          deload: isDeload,
          exercises: (day.exercises || []).map(function (item, ei) {
            var extra = isDeload ? 0 : (w - 1);
            var exx = byId(item.exerciseId, opts.custom);
            // Growth goes to the muscles with the most room left, not evenly across everything.
            var room = (exx && exx.primary || []).reduce(function (a, m) {
              var L = targets[m]; return Math.max(a, L ? L.mav - L.mev : 0);
            }, 0);
            var base = Math.max(1, (item.target && item.target.sets) || 3);
            // A style that does not grow sets does not grow them here either. Min-max progresses on
            // the weight and the reps, which is a thing that happens in the log rather than in the
            // plan: week four's prescription is week one's, and what changed is what is on the bar.
            var sets = (asWritten || !style.growSets)
              ? (isDeload ? Math.max(1, Math.round(base / 2)) : base)
              : (isDeload
                ? Math.max(1, Math.round(base / 2))
                : base + (room >= 6 ? Math.min(extra, 2) : Math.min(extra, 1)));
            if (style.maxSets) sets = Math.min(sets, style.maxSets);
            // As written means as written: the effort target comes from the plan too, and where the
            // plan does not state one we hold it steady rather than walking it in a week at a time.
            var effort = asWritten
              ? (item.target && item.target.rir != null ? item.target.rir : 2)
              : rir;
            // The min-max pair: the last set of a movement is the all-out one, the set before it
            // stops a rep short on anything you could get hurt failing, and the intro week sits a
            // rep or two behind both.
            var pair = (style.toFailure && !asWritten) ? minmaxEffort(exx, sets, isIntro || isDeload) : null;
            return {
              id: blockId + '_' + (item.id || (item.exerciseId + '_' + di + '_' + ei)) + '_w' + w,
              exerciseId: item.exerciseId, order: item.order == null ? ei : item.order,
              // Everything on a line that belongs to whoever WROTE it rather than to the week it
              // landed in: the slot they left open, the substitutions they offered, the technique
              // they asked for on the last set, their warm-up count, their note, their own name for
              // the movement. templateOf has carried these for a while; this did not, so a block
              // built from a template arrived with every choice already made for you, no
              // substitutions, and the notes gone. Carrying a programme forward to the next block
              // went through here, which is where they were being lost.
              choice: item.choice || null, alts: item.alts || null,
              technique: item.technique || null, planNote: item.planNote || null,
              warmups: item.warmups == null ? null : item.warmups,
              sourceName: item.sourceName || null,
              target: Object.assign({ sets: 3, repLow: 8, repHigh: 12, restSec: 120, tempo: defaultTempo(exx) }, item.target,
                { sets: sets, rir: pair ? pair.rir : effort },
                pair ? { rirLast: pair.rirLast } : {}),
            };
          }),
        });
      });
      // Trimming to MRV is us editing the plan, which is the one thing "as written" promises not to
      // do. The volume is still MEASURED, and the coverage screen still says plainly if a week sits
      // over the ceiling, so nothing is hidden: it is shown and left to the person, not cut for them.
      if (!asWritten) trimToMRV(weekSess);
      sessions = sessions.concat(weekSess);
    }
    return {
      id: blockId,
      // An imported plan keeps the name its author gave it; anything built here gets named for what
      // it is rather than "4-week growth block", which every generated block used to be called.
      name: opts.name || blockName(template, opts),
      goal: opts.goal || 'hypertrophy',
      weeks: weeks, shape: shape, daysPerWeek: opts.daysPerWeek || template.length,
      // How this block is meant to be run, stored on it, because everything downstream - the session
      // runner's copy, what it asks you to log, how next week's numbers are worked out - has to know
      // and cannot be asked to guess from the set counts.
      style: opts.style || null,
      // Stored on the block, not just used to build it, so a later "add a movement mid-block" or
      // "build my next block" carries the same style forward instead of silently reverting to the
      // default the moment nobody is explicitly passing it any more.
      intensity: opts.intensity || 'high',
      startISO: opts.startISO || null,
      source: opts.source || 'generated',
      sourceRef: opts.sourceRef || null,
      sessions: sessions,
    };
  }

  // Turn what the AI read out of a video caption, a PDF or a spreadsheet into a template we can
  // build a block from. The AI hands over names and numbers; THIS decides what each name actually
  // is, and it refuses to guess. Anything unresolved comes back in `unresolved` so the import
  // screen can ask rather than silently dropping a movement or logging the wrong one.
  // A name-derived id, so the SAME unresolved movement named twice (two lines in one source, or the
  // same source re-imported) mints or finds ONE custom exercise rather than a fresh one every time.
  function autoCustomId(name) {
    var slug = norm(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    return 'cu_auto_' + (slug || 'exercise');
  }
  var VALID_EQUIPMENT = { barbell: 1, dumbbell: 1, machine: 1, cable: 1, smith: 1, ez: 1, kettlebell: 1, trapbar: 1, bodyweight: 1, band: 1 };

  function importTemplate(parsed, opts) {
    opts = opts || {};
    // Where a source states no weekday, the recommended week rather than the array index. See
    // DEFAULT_DOW: consecutive days were never a decision.
    var importDows = defaultDows(((parsed && parsed.days) || []).length);
    var unresolved = [];   // rows the library had no match for - still IN the plan, via newCustom
    var loose = [];        // matched, but on a weak score - worth a second look
    var mismatches = [];   // right movement, kit the source did not ask for
    var newCustom = [];    // custom exercises minted this call, for the caller to save into t.custom
    var mintedById = {};

    // Mint (or reuse) a custom exercise from the model's own best-guess classification, for a name
    // the library genuinely has nothing for. This is what makes importing never drop a line: it used
    // to leave a gap only a human could fill; now the plan gets everything the source had, with the
    // guessed ones flagged (check: 'auto') for a second look rather than left out.
    function autoResolve(raw) {
      var id = autoCustomId(raw.name);
      if (mintedById[id]) return mintedById[id];
      var already = byId(id, opts.custom);
      if (already) { mintedById[id] = already; return already; }
      // The same movement written two ways is one movement. A slug off the name alone makes "Incline
      // DB press" and "DB incline press" two entries in the library, two rows in the plan and two
      // separate lots of logged history for one lift - and screenshots of one programme are exactly
      // where both spellings turn up. sameMovement compares the words rather than the string, so the
      // second spelling reuses the first entry instead of minting beside it.
      var twin = newCustom.concat(opts.custom || []).filter(function (x) {
        return sameMovement(x.name, tidyName(raw.name) || raw.name);
      })[0];
      if (twin) { mintedById[id] = twin; return twin; }
      var guess = MUSCLES.filter(function (m) { return (raw.muscle || []).indexOf(m) !== -1; });
      // No usable guess at all (an old caller, or the model skipped the field): still cannot fail to
      // mint one, so fall back to a plausible default rather than leaving the exercise out.
      if (!guess.length) guess = ['ch'];
      var pattern = raw.pattern === 'isolation' ? 'isolation' : raw.pattern === 'core' ? 'core' : 'compound';
      var equipment = VALID_EQUIPMENT[raw.equipment] ? raw.equipment : 'bodyweight';
      var ex = {
        id: id, name: tidyName(raw.name) || String(raw.name || 'Exercise'),
        equipment: equipment, pattern: pattern, profile: 'mid',
        primary: guess, secondary: [], custom: true, auto: true,
      };
      mintedById[id] = ex;
      newCustom.push(ex);
      return ex;
    }

    var customPool = (opts.custom || []).concat(newCustom);
    var template = ((parsed && parsed.days) || []).map(function (day, di) {
      var exercises = [];
      var dayName = day.name || ('Day ' + (di + 1));
      (day.exercises || []).forEach(function (raw, ei) {
        var id, how = 'exact', minted = null;
        if (raw.exerciseId && byId(raw.exerciseId, opts.custom)) { id = raw.exerciseId; }
        else {
          var d = resolveDetail(raw.name, opts.custom);
          if (d) { id = d.id; how = d.how; }
        }
        if (!id) {
          minted = autoResolve(raw);
          id = minted.id; how = 'auto';
          unresolved.push({ day: di, dayName: dayName, name: raw.name, index: ei, autoId: id });
        }
        if (how === 'loose') loose.push({ day: di, dayName: dayName, name: raw.name, matched: (byId(id, opts.custom) || {}).name });
        var kit = how === 'auto' ? null : kitMismatch(raw.name, id, opts.custom);
        if (kit) mismatches.push({ day: di, dayName: dayName, name: raw.name, said: kit.said, got: kit.got, matched: kit.name });
        // Which rows are worth a second look, marked ON the row. A screen that says "counted as" on
        // every line says nothing: "Hanging leg raises, counted as Hanging leg raise" is a plural,
        // not a decision. Three things are: kit the library has no version of, a match that only just
        // cleared the threshold, and a name the library had nothing at all for (auto-created).
        var check = kit ? 'kit' : how === 'auto' ? 'auto' : (how === 'loose' ? 'loose' : null);
        // A weak SCORE on a name that ends up identical to the library's is not a weak match, it is
        // the scorer being cautious about a word it had not seen ("T-bar row (mega mass)"). Nothing
        // to look at, so nothing to say.
        if (check === 'loose' && sameMovement(tidyName(raw.name), (byId(id, opts.custom) || {}).name)) check = null;
        var ex = minted || byId(id, opts.custom);
        var compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
        var lo = +raw.repLow || 0, hi = +raw.repHigh || 0;
        // A source that gives one rep number ("4 x 10") means a target, not a range. Open it into a
        // range around that number so double progression has somewhere to go.
        if (lo && !hi) hi = lo + 2;
        if (hi && !lo) lo = Math.max(3, hi - 3);
        if (!lo && !hi) { lo = compound ? 6 : 10; hi = compound ? 10 : 15; }
        exercises.push({
          id: id + '_i' + di + '_' + exercises.length,
          exerciseId: id, order: exercises.length,
          // What the plan called it, tidied but not replaced. The library match is what the maths
          // counts; this is what the person reads, because it is their coach's session.
          sourceName: tidyName(raw.name) || null,
          check: check,
          target: {
            sets: clamp(+raw.sets || 3, 1, 8),
            repLow: clamp(lo, 1, 40), repHigh: clamp(Math.max(hi, lo + 1), 2, 50),
            rir: raw.rir == null ? 2 : clamp(+raw.rir, 0, 5),
            restSec: +raw.restSec || (compound ? 150 : 90),
            tempo: /^[0-9X]{4}$/i.test(String(raw.tempo || '')) ? String(raw.tempo).toUpperCase() : defaultTempo(ex),
          },
        });
      });
      var row = {
        kind: 'full', name: dayName,
        dayOfWeek: day.dayOfWeek == null ? importDows[di] : clamp(+day.dayOfWeek, 0, 6),
        exercises: exercises,
      };
      // Name it for what it trains, once the movements are known - including anything auto-created
      // this call, so a day built entirely from guessed movements still gets a real name instead of
      // falling back to "Day 1".
      row.name = nameDay(row.name, row, customPool);
      // Nothing is ever left off the day any more (see autoResolve above), so this always empty now.
      // Kept so any saved draft from before this change, or a caller still reading it, sees an array.
      row.missing = [];
      return row;
    }).filter(function (d) { return d.exercises.length > 0; });
    return {
      template: template, unresolved: unresolved, loose: loose, mismatches: mismatches, newCustom: newCustom,
      days: template.length,
      // Whatever the source said about which week this is. The app builds four weeks from one, so a
      // screenshot taken on week four of somebody's programme is worth saying out loud.
      weekLabel: (parsed && parsed.week_label) ? String(parsed.week_label).slice(0, 40) : null,
    };
  }

  // ---- naming a day ---------------------------------------------------------------------------
  // "Day 1" tells you nothing standing in the gym holding your phone. What a session IS is the thing
  // you want on the card, and it is already knowable: the movements say which regions the day trains,
  // so the name can say it too. Coaching apps export "DAY 1" through "DAY 5" and rely on you
  // remembering which is which, which is exactly the memory nobody has on a Wednesday evening.
  var REGION = {
    ch: 'chest', fd: 'delts', sd: 'delts', rd: 'delts',
    lt: 'back', ub: 'back', lb: 'back',
    bi: 'arms', tr: 'arms', fa: 'arms',
    ab: 'core', ob: 'core',
    qu: 'legs', ha: 'legs', gl: 'legs', ad: 'legs', ca: 'legs',
  };
  var REGION_LABEL = { chest: 'chest', back: 'back', delts: 'shoulders', arms: 'arms', legs: 'legs', core: 'core' };
  // A name that carries no information about the session. These are what apps and spreadsheets emit
  // when nobody has named the day, and they are the only ones worth overwriting: a coach who wrote
  // "Upper A" or "Push" has already said something, and it is not ours to relabel.
  var GENERIC_DAY = /^(day|session|workout|training)\s*\d+\s*[a-d]?$|^[wd]\s*\d+\s*[a-d]?$|^w\s*\d+\s*d\s*\d+$|^\d+$|^[a-d]$/i;
  // The order people say these in. Regions are CHOSEN by how much work they carry but NAMED in this
  // order, because "chest and back" is what a person says and "back and chest" is what a sort
  // function says.
  var REGION_ORDER = ['chest', 'back', 'delts', 'arms', 'legs', 'core'];

  // Which regions a day is actually ABOUT.
  //
  // Deliberately counts primary movers only, where the rest of the volume maths counts assistance at
  // half a set. Those are different questions. For coverage, the triceps a bench press trains are
  // real and must be counted. For a name, they are not what the day is: counting them turned a chest
  // and back day into "back, arms and chest", because every row and pulldown fed the biceps enough to
  // clear the bar. What a session is called should be what you would tell someone you were doing.
  function dayRegions(day, custom) {
    var byRegion = {}, total = 0;
    (day.exercises || []).forEach(function (it) {
      var ex = byId(it.exerciseId, custom);
      if (!ex || isCardio(ex)) return;
      var sets = (it.target && it.target.sets) || 0;
      (ex.primary || []).forEach(function (m) {
        var r = REGION[m]; if (!r) return;
        byRegion[r] = (byRegion[r] || 0) + sets; total += sets;
      });
    });
    if (!total) return [];
    return REGION_ORDER.filter(function (r) {
      // A region has to be a real part of the session to get named. Under a sixth of the work is a
      // finisher or a bit of assistance, and naming it makes the label lie about what the day is.
      return byRegion[r] && byRegion[r] / total >= 0.16;
    });
  }

  // "Chest and back", "Legs", "Shoulders and arms". Written the way a person says it out loud.
  function dayFocus(day, custom) {
    var rs = dayRegions(day, custom);
    if (!rs.length) return '';
    if (rs.length >= 4) return 'Full body';
    var names = rs.map(function (r) { return REGION_LABEL[r]; });
    var out = names.length === 1 ? names[0]
      : names.length === 2 ? names[0] + ' and ' + names[1]
      : names[0] + ', ' + names[1] + ' and ' + names[2];
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  // The day's name, with what it trains added when the name on its own says nothing. "Day 1" becomes
  // "Day 1 - Chest and back"; "Upper A" and "Push" are left exactly as their author wrote them.
  function nameDay(name, day, custom) {
    var raw = String(name || '').trim();
    var focus = dayFocus(day, custom);
    if (!focus) return raw;
    if (!raw) return focus;
    if (!GENERIC_DAY.test(raw)) return raw;
    return raw + ' - ' + focus;
  }

  // ---- the movement's name, as its author wrote it ----------------------------------------------
  // An imported movement had two names and the app showed the wrong one. The plan says "CAM - SPLIT
  // SQUAT SMITH MACHINE"; the library's nearest match is "Split squat", a dumbbell movement. Showing
  // the library's name is the same silent substitution that as-written was built to stop: you are
  // reading your coach's session and every line has been quietly renamed to something you did not
  // write and, in that case, cannot do.
  //
  // So the source's own words are kept and only tidied. What tidying means is narrow on purpose:
  // remove what is not part of a movement's name (the coach's tag, a parenthetical aside), expand the
  // abbreviations a phone keyboard encourages, and move a trailing piece of kit to the front so it
  // reads the way a person says it. Nothing is dropped that carries meaning, and no word is invented.
  var KIT_TAIL = /\s+(smith machine|smith|machine|cable|dumbbell|barbell|kettlebell|band|ez bar|ez)$/i;
  var KEEP_CAPS = { ez: 'EZ', rdl: 'RDL', ohp: 'OHP', bb: 'barbell', db: 'dumbbell' };
  function tidyName(raw) {
    var s = String(raw || '').replace(COACH_PREFIX, '');
    s = s.replace(/\([^)]*\)/g, ' ');                       // "(OHTX)", "(mega mass)" - an aside, not a name
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    // A trailing piece of kit reads backwards. "Split squat smith machine" is how a spreadsheet column
    // sorts; "Smith machine split squat" is how a person says it.
    var m = s.match(KIT_TAIL);
    if (m) s = (m[1] + ' ' + s.slice(0, s.length - m[0].length)).replace(/\s+/g, ' ').trim();
    var words = s.toLowerCase().split(' ').map(function (w) { return KEEP_CAPS[w] || w; });
    var out = words.join(' ');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  // Two names for the same movement, allowing for the plural and the word order a source happens to
  // use. "Leg extensions" and "Leg extension" are not a substitution worth telling anyone about.
  // Two names that differ only in where the piece of kit sits. Everything that is not equipment has
  // to survive in the same order, so this can move "machine" and nothing else.
  var KIT_WORDS = { smith: 1, machine: 1, cable: 1, dumbbell: 1, barbell: 1, kettlebell: 1, band: 1, ez: 1, bodyweight: 1 };
  function stripKit(x) {
    return norm(String(x || '')).split(' ').filter(Boolean)
      .filter(function (w) { return !KIT_WORDS[w]; })
      .map(function (w) { return w.replace(/s$/, ''); }).join(' ');
  }
  // Two names for one movement, where the only difference is where the kit sits in the name or
  // whether it is written at all. "Machine chest press" / "Chest press machine"; "Hammer curl" /
  // "Dumbbell hammer curl", where the library leaves the dumbbell implicit and the spreadsheet
  // spells it out. What is left after the kit is removed has to be the same words in the SAME ORDER,
  // and the EQUIPMENT has to agree - which is what makes this a rewrite rather than a substitution,
  // and what keeps "Chest-supported machine row" apart from "Chest-supported row".
  function sameButForKit(ex, name, equipment) {
    if (!ex || !name) return false;
    var sa = stripKit(ex.name), sb = stripKit(name);
    return !!sa && sa === sb && ex.equipment === equipment;
  }

  function sameMovement(a, b) {
    var key = function (x) {
      return norm(String(x || '')).split(' ').filter(Boolean)
        .map(function (w) { return w.replace(/s$/, ''); }).sort().join(' ');
    };
    return !!a && !!b && key(a) === key(b);
  }

  // ---- a variation of a movement you already have ------------------------------------------------
  // "Wide grip T-bar row" is a T-bar row. The hard part of adding a movement is not its name, it is
  // saying what it trains, and a variation of something already in the library trains what that
  // trains. Asking someone standing at the machine to tick seventeen muscle chips to record a change
  // of grip is how a library stays empty and how a plan quietly stops matching what is being done.
  //
  // So a variation inherits its parent's attribution, equipment and pattern wholesale, and remembers
  // what it came from. Nothing is guessed: every field is copied from a movement the library already
  // describes, and it stays editable like any other custom exercise.
  function variationOf(parentId, name, custom) {
    var p = byId(parentId, custom);
    if (!p || !String(name || '').trim()) return null;
    return {
      name: String(name).trim(),
      equipment: p.equipment, pattern: p.pattern, profile: p.profile,
      primary: (p.primary || []).slice(), secondary: (p.secondary || []).slice(),
      custom: true, variantOf: parentId,
    };
  }

  // ---- changing a movement for the rest of a block -----------------------------------------------
  // Swapping a movement mid-session changes today. Whether it should change the block is a different
  // question and only the person can answer it: a machine being busy is today, and a grip that suits
  // you better is the rest of the block. Apps that guess this either make you redo the swap every
  // week or silently rewrite a plan you did not mean to change, and both are worse than asking.
  //
  // Only sessions from `fromWeek` on are touched. The weeks you already trained are a record of what
  // you actually did, and rewriting those to match a decision made afterwards would make the history
  // lie. Returns how many sessions changed so the caller can say.
  function swapInBlock(block, fromId, toId, fromWeek) {
    var n = 0;
    ((block && block.sessions) || []).forEach(function (s) {
      if (fromWeek != null && s.week < fromWeek) return;
      var hit = false;
      (s.exercises || []).forEach(function (e) {
        if (e.exerciseId !== fromId) return;
        // Through replaceExercise rather than by hand, so a movement changed across a whole block
        // keeps the same way back, and drops the same stale note, as one changed for a single day.
        if (replaceExercise(e, toId)) hit = true;
      });
      if (hit) n++;
    });
    return n;
  }
  // How many sessions a swap WOULD change, so the question can say what it is asking about rather
  // than asking in the abstract.
  function swapReach(block, fromId, fromWeek) {
    var n = 0;
    ((block && block.sessions) || []).forEach(function (s) {
      if (fromWeek != null && s.week < fromWeek) return;
      if ((s.exercises || []).some(function (e) { return e.exerciseId === fromId; })) n++;
    });
    return n;
  }

  /* ---- editing a planned session, without setting foot in the gym ------------------------------
   * Until these existed, the only way to change tonight's plan was to START the session. That
   * stamps a start time, writes a log row, and from the second visit onward the app treats it as one
   * you are part-way through. So "I want to do deadlifts instead of squats on Thursday", asked on
   * the bus on Tuesday, cost you a phantom Thursday session you then had to go and delete.
   *
   * The other route was the block editor, which is a different question entirely: it edits the
   * PROGRAMME, across four weeks, and it is two hops behind a secondary link. Rearranging the week
   * in front of you is a weekly, casual act and it deserved to live where the week is.
   *
   * All of these MUTATE the session or block handed to them, matching swapInBlock and
   * applyBlockFixes, so a caller runs them straight inside a trainUpdate draft. They return a truthy
   * result on success and a falsy one when the edit was not possible, so a caller never has to
   * re-derive whether anything happened.
   */
  var SETS_MIN = 1, SETS_MAX = 10;
  var REPS_MIN = 1, REPS_MAX = 50;
  var RIR_MAX = 6;

  function sessionItems(session) {
    return (((session && session.exercises) || []).slice())
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  function indexOfItem(list, itemId) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === itemId) return i;
    return -1;
  }
  // Densely renumber `order` from the array's own positions. Imports and generated blocks both leave
  // gaps and duplicates in `order`, and a reorder that only swapped two numbers would inherit them,
  // so the list on screen and the list in the data could drift apart.
  function renumberSession(session, list) {
    for (var i = 0; i < list.length; i++) list[i].order = i;
    session.exercises = list;
    return list;
  }
  // Move one movement up or down the session. Supersets travel as written: the pair is defined by
  // being ADJACENT, so moving one leg out from beside the other has to break the pairing rather than
  // leave two rows labelled A1 and A2 with a squat sitting between them.
  function moveExercise(session, itemId, delta) {
    var list = sessionItems(session);
    var i = indexOfItem(list, itemId);
    var to = i + (+delta || 0);
    if (i < 0 || to < 0 || to >= list.length) return false;
    var row = list.splice(i, 1)[0];
    list.splice(to, 0, row);
    renumberSession(session, list);
    dropBrokenSupersets(session);
    return true;
  }
  // A superset is a promise about ORDER: these two, back to back, no rest between. Once the two legs
  // are no longer next to each other the promise is not true any more, so the group goes rather than
  // the codes lying about it.
  function dropBrokenSupersets(session) {
    var list = sessionItems(session);
    var seen = {};
    list.forEach(function (e, i) {
      var g = e.supersetGroup;
      if (!g) return;
      if (!seen[g]) seen[g] = [];
      seen[g].push(i);
    });
    Object.keys(seen).forEach(function (g) {
      var at = seen[g];
      var contiguous = at.length >= 2;
      for (var i = 1; i < at.length; i++) if (at[i] !== at[i - 1] + 1) contiguous = false;
      if (!contiguous) at.forEach(function (i) { list[i].supersetGroup = null; });
    });
    renumberSession(session, list);
    return session;
  }
  // Pair a movement with the one after it, or break the pair it is already in. Adjacent-only, which
  // is how supersets are actually written: needing a multi-select picker to say "these two, together"
  // would be ceremony for the one case that is not already obvious from the order.
  function toggleSuperset(session, itemId) {
    var list = sessionItems(session);
    var i = indexOfItem(list, itemId);
    if (i < 0) return false;
    var g = list[i].supersetGroup;
    if (g) {
      list.forEach(function (e) { if (e.supersetGroup === g) e.supersetGroup = null; });
      renumberSession(session, list);
      return true;
    }
    var next = list[i + 1];
    if (!next || next.supersetGroup) return false;   // nothing after it, or the next one is spoken for
    var id = 'ss' + i + '_' + (session.id || 'x');
    list[i].supersetGroup = id;
    next.supersetGroup = id;
    renumberSession(session, list);
    return true;
  }
  // Append a movement, prescribed the way the block builder prescribes one: a compound gets fewer
  // reps and longer rest than an isolation, and the RIR follows the week, so a movement added in
  // week 3 is not softer than everything around it.
  function addExerciseToSession(session, exerciseId, custom, itemId, intensity) {
    var ex = byId(exerciseId, custom);
    if (!ex || !session) return null;
    var iv = intensityOf(intensity);
    var compound = ex.pattern !== 'isolation' && ex.pattern !== 'core';
    var list = sessionItems(session);
    var item = {
      id: itemId || (exerciseId + '_a' + list.length),
      exerciseId: exerciseId,
      order: list.length,
      target: {
        sets: iv.startSets,
        repLow: compound ? 6 : iv.isoRepLow, repHigh: compound ? 10 : iv.isoRepHigh,
        rir: Math.max(iv.rirFloor, 4 - (session.week || 1)),
        restSec: compound ? 150 : iv.isoRest,
      },
    };
    list.push(item);
    renumberSession(session, list);
    return item;
  }
  function removeExerciseFromSession(session, itemId) {
    var list = sessionItems(session);
    var i = indexOfItem(list, itemId);
    if (i < 0) return false;
    list.splice(i, 1);
    renumberSession(session, list);
    dropBrokenSupersets(session);   // a pair with one leg gone is not a pair
    return true;
  }
  // Change what a movement asks for. Everything is clamped, and the rep range is kept in order from
  // whichever end was just edited: a range reading "12-8" is a typo somebody is about to train from.
  function setExerciseTarget(session, itemId, patch) {
    var list = sessionItems(session);
    var i = indexOfItem(list, itemId);
    if (i < 0 || !patch) return null;
    var t = Object.assign({}, list[i].target || {});
    if (patch.sets != null) t.sets = clamp(Math.round(+patch.sets || 0), SETS_MIN, SETS_MAX);
    if (patch.repLow != null) t.repLow = clamp(Math.round(+patch.repLow || 0), REPS_MIN, REPS_MAX);
    if (patch.repHigh != null) t.repHigh = clamp(Math.round(+patch.repHigh || 0), REPS_MIN, REPS_MAX);
    if (patch.rir != null) t.rir = clamp(Math.round(+patch.rir || 0), 0, RIR_MAX);
    if (patch.rirLast != null) t.rirLast = clamp(Math.round(+patch.rirLast || 0), 0, RIR_MAX);
    // The last set can be harder than the ones before it but never easier: that is what makes it the
    // last set. A movement edited into an impossible pair drags the earlier sets down with it rather
    // than refusing the edit, because the person is plainly telling us where they want to end up.
    if (t.rirLast != null && t.rirLast > t.rir) {
      if (patch.rirLast != null) t.rir = t.rirLast; else t.rirLast = t.rir;
    }
    if (patch.restSec != null) t.restSec = clamp(Math.round(+patch.restSec || 0), 15, 600);
    if (t.repLow != null && t.repHigh != null && t.repLow > t.repHigh) {
      if (patch.repLow != null) t.repHigh = t.repLow; else t.repLow = t.repHigh;
    }
    list[i].target = t;
    return t;
  }
  // Which weekday a session falls on. Per-week by construction, because every week carries its own
  // session rows, so moving this Thursday's legs to Friday leaves next Thursday exactly where it was.
  // That is what somebody rearranging THIS week means, and quietly moving all four weeks because a
  // gym was shut once would be the app deciding something it was not asked to decide.
  function setSessionDay(session, dayOfWeek) {
    var d = Math.round(+dayOfWeek);
    if (!session || !(d >= 0 && d <= 6)) return false;
    session.dayOfWeek = d;
    return true;
  }
  /* The block's SCHEDULE: which weekday each session of the week falls on, in every week of it.
   *
   * `setSessionDay` is a different act and stays one - it moves THIS Thursday's legs to Friday
   * because a gym was shut, and leaves next Thursday alone. This is the plan: answering "I train
   * Monday, Wednesday, Saturday and Sunday" has to reach all four weeks, or the answer is undone the
   * moment the week turns over.
   *
   * `dows` is parallel to the week's sessions in order, so [0, 2, 5, 6] reads as "first session
   * Monday, second Wednesday, third Saturday, fourth Sunday". A null entry leaves that session where
   * it is, which is what makes it usable for changing one row without restating the rest.
   */
  function reschedule(block, dows, todayISO) {
    if (!block || !dows || !dows.length) return false;
    /* WEEKS YOU HAVE ALREADY TRAINED STAY AS THEY WERE.
     *
     * This walked every week of the block, including the ones behind you, so moving Thursday to
     * Saturday in week three rewrote weeks one and two to claim their sessions had been on a
     * Saturday. The logs keep their own dates so no data was lost, but paging back a week showed a
     * tick sitting on a day nobody trained, and `restDaysOfWeek` called a training day a rest day.
     * History is not a thing a preference gets to edit.
     *
     * It is the rule the rest of the module already follows - `swapInBlock` takes the current week
     * and the builder says "weeks you have trained stay as they were" in as many words. With no date
     * to hand there is no past to protect, which is what a caller with no clock means.
     */
    var from = 0;
    if (todayISO) {
      var pg = blockProgress(block, todayISO);
      if (!pg.notStarted) from = pg.week;
    }
    var byWeek = {};
    (block.sessions || []).forEach(function (s) {
      if (from && (+s.week || 1) < from) return;
      (byWeek[s.week] = byWeek[s.week] || []).push(s);
    });
    var changed = false;
    Object.keys(byWeek).forEach(function (w) {
      byWeek[w].forEach(function (s, i) {
        var d = dows[i];
        if (d == null) return;
        d = Math.round(+d);
        if (!(d >= 0 && d <= 6) || s.dayOfWeek === d) return;
        s.dayOfWeek = d;
        changed = true;
      });
    });
    // How many days a week this block trains is a fact about its schedule, and the blocks list and
    // the nutrition side both read it. Left alone it would still report the count the block was
    // BUILT with after somebody doubled two sessions onto one day.
    if (changed) {
      var wk1 = byWeek[Object.keys(byWeek).sort(function (a, b) { return a - b; })[0]] || [];
      block.daysPerWeek = uniq(wk1.map(function (s) { return s.dayOfWeek; })).length;
    }
    return changed;
  }

  // The weekdays a block's week currently runs on, in session order: what `reschedule` would take to
  // leave it exactly as it is, and what an editor opens showing.
  function scheduleOf(block, todayISO) {
    var sessions = (block && block.sessions) || [];
    // The week being LOOKED at, which is the week you are in. Always reading week one meant that on
    // week three the screen showed week one's days: any one-off move made this week was invisible,
    // the save button read "nothing to change" over an arrangement plainly different from the strip
    // above it, and saving silently reverted the move.
    var want = null;
    if (todayISO && block && block.startISO) {
      var pg = blockProgress(block, todayISO);
      if (!pg.notStarted && !pg.done) want = pg.week;
    }
    if (want == null) {
      sessions.forEach(function (s) {
        var w = +s.week || 1;
        if (want == null || w < want) want = w;
      });
    }
    // `week` has always been written by every producer, but a hand-edited or half-migrated block
    // without it matched EVERY session here (undefined == null), returning the whole block as one
    // week - sixteen rows on a four-week block, and a daysPerWeek of seven after a save.
    return sessions.filter(function (s) { return (+s.week || 1) === want; })
      .map(function (s) { return { id: s.id, name: s.name, dayOfWeek: s.dayOfWeek }; });
  }

  // Anything else already on that day, so the move can say "Upper A is there too" rather than either
  // blocking it (two-a-days are real) or letting two sessions land on one day in silence.
  function sessionsOnDay(block, week, dayOfWeek, exceptId) {
    return weekSessions(block, week).filter(function (s) {
      return s.id !== exceptId && s.dayOfWeek === dayOfWeek;
    }).map(function (s) { return s.name; });
  }

  // ---- naming a block -------------------------------------------------------------------------
  // "4-week growth block" is what every generated block was called, so a person with three of them
  // had three identically-named blocks and no way to tell which was which. Everything needed to name
  // one properly is already known at the moment it is built: what shape the week is, how many days it
  // asks for, and what it was told to bring up. It is still only a default, sitting in an editable
  // box on the next screen, so the job is to be recognisable rather than clever.
  var SPLIT_LABEL = { full: 'Full body', ppl: 'Push pull legs', upper_lower: 'Upper/lower' };
  function emphasisLabel(emphasis) {
    var got = [];
    (emphasis || []).forEach(function (m) { var r = REGION[m]; if (r && got.indexOf(r) === -1) got.push(r); });
    if (!got.length) return '';
    // Named in the order a person says them, and never more than two: a name listing four body parts
    // has stopped being a name.
    var names = REGION_ORDER.filter(function (r) { return got.indexOf(r) !== -1; })
      .map(function (r) { return REGION_LABEL[r]; }).slice(0, 2);
    return names.length === 2 ? names[0] + ' and ' + names[1] : names[0];
  }
  function blockName(template, opts) {
    opts = opts || {};
    var days = (template || []).length;
    var head = SPLIT_LABEL[splitKind(template, opts.custom)] || (days ? 'Split' : 'Block');
    var parts = [head];
    if (days) parts.push(days + (days === 1 ? ' day' : ' days'));
    // What you asked it to bring up is the thing that tells two otherwise identical blocks apart, so
    // it beats the goal to the name. Where nothing was emphasised, a strength block says so, because
    // growth is the assumption everywhere else in the app.
    var em = emphasisLabel(opts.emphasis);
    if (em) parts.push(em + ' up');
    else if (opts.goal === 'strength') parts.push('for strength');
    return parts.join(', ');
  }

  // ---- did we match the right piece of kit? -----------------------------------------------------
  // Resolving "SPLIT SQUAT SMITH MACHINE" to a dumbbell split squat is the right MOVEMENT on the
  // wrong equipment, and that is invisible in a list of names: the day looks correct and you find out
  // in the gym. The source usually names its kit outright, so when it does and the match disagrees,
  // say so rather than quietly substituting.
  var KIT_WORDS = {
    smith: 'smith', machine: 'machine', cable: 'cable', dumbbell: 'dumbbell', dumbell: 'dumbbell',
    db: 'dumbbell', barbell: 'barbell', bb: 'barbell', ez: 'ez', kettlebell: 'kettlebell',
    kb: 'kettlebell', band: 'band', bodyweight: 'bodyweight', trapbar: 'trapbar',
  };
  function kitMismatch(sourceName, exerciseId, custom) {
    var ex = byId(exerciseId, custom);
    if (!ex || !ex.equipment) return null;
    var toks = norm(String(sourceName || '').replace(COACH_PREFIX, '')).split(' ');
    var said = [];
    toks.forEach(function (t) {
      var k = KIT_WORDS[t];
      if (k && said.indexOf(k) === -1) said.push(k);
    });
    if (!said.length) return null;
    if (said.indexOf(ex.equipment) !== -1) return null;
    // "Machine" against a cable stack is a quibble, not a mismatch: a plate-loaded pulldown and a
    // cable pulldown are the same movement on the same line of the plan. Kit that changes how the
    // movement is actually performed is what deserves flagging.
    if (said.length === 1 && said[0] === 'machine' && (ex.equipment === 'cable' || ex.equipment === 'smith')) return null;
    return { said: said, got: ex.equipment, name: ex.name };
  }

  // Two sources are "the same source" when re-reading one should REPLACE what it gave last time.
  // Two different screenshots are never the same source, even when both name their day "Day 1".
  function sameSource(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === 'file') return norm(a.name) === norm(b.name);
    if (a.kind === 'link') return String(a.url || '') === String(b.url || '');
    return true;
  }
  // Are these two days the same session read twice? Judged on the movements, because that is the
  // only evidence a screenshot reliably carries: the name comes from whatever heading happened to be
  // in shot, so one session can arrive as "Day 2" and as "Tuesday - Pull", and two genuinely
  // different days can both arrive as "Day 1". The bar is deliberately high, because keeping a
  // duplicate day costs one tap on the draft screen and losing a real one costs a session nobody
  // notices is missing: at least two movements in common and nearly all of the shorter reading
  // inside the longer one, and more of both when the names do not agree either.
  function sameSession(a, b) {
    var ax = (a && a.exercises) || [], bx = (b && b.exercises) || [];
    if (ax.length < 2 || bx.length < 2) return false;
    // A multiset, not a set: a day that programmes a heavy T-bar row and a back-off T-bar row needs
    // two of them on the other side before both count as shared.
    var pool = bx.map(function (e) { return e.exerciseId || e.id; });
    var shared = 0;
    ax.forEach(function (e) {
      var at = pool.indexOf(e.exerciseId || e.id);
      if (at >= 0) { shared++; pool.splice(at, 1); }
    });
    var ratio = shared / Math.min(ax.length, bx.length);
    // Same name is corroboration, so a lower bar clears. Without it the movements carry it alone,
    // and an Upper A / Upper B pair sharing its presses and rows must not collapse into one day.
    return norm(a.name) === norm(b.name) ? (shared >= 2 && ratio >= 0.75) : (shared >= 3 && ratio >= 0.85);
  }

  // Fold custom movements minted by separate parses into one library.
  //
  // Every file in a batch is parsed on its own, against the same snapshot of the library, so none of
  // them can see what the others have just invented. Five screenshots of one programme therefore mint
  // five separate entries for the coach's own name for a machine, and the person ends up with a
  // library full of near-identical movements and their logged history split across them. This is the
  // one place that can see all five at once, so this is where they collapse: an entry that is the
  // same movement as one already there (or as a movement the real library has under a different word
  // order) is dropped, and the days that pointed at it are re-pointed at the survivor.
  function mergeCustom(existing, minted) {
    var out = (existing || []).slice();
    var map = {};
    (minted || []).forEach(function (m) {
      if (!m || !m.id) return;
      // The real library first: if a minted guess turns out to be a movement we already describe
      // properly, that entry is better than the guess in every way.
      var twin = EXERCISES.concat(out).filter(function (x) {
        return x.id === m.id || sameMovement(x.name, m.name);
      })[0];
      if (twin) { if (twin.id !== m.id) map[m.id] = twin.id; return; }
      out.push(m);
    });
    return { custom: out, map: map };
  }
  // Re-point days at the ids that survived a mergeCustom, in place. A day pointing at an id nothing
  // holds any more is a movement that vanishes off the screen, which is worse than the duplicate.
  function remapDays(days, map) {
    if (!map || !Object.keys(map).length) return days;
    (days || []).forEach(function (d) {
      (d.exercises || []).forEach(function (e) {
        if (map[e.exerciseId]) e.exerciseId = map[e.exerciseId];
      });
    });
    return days;
  }

  // The same re-pointing, for a block rather than a draft's days. An imported programme carries the
  // id in three places - the line itself, its substitutions, and the options behind a "your choice"
  // slot - and a merge that fixed only the first would leave a chooser offering a movement that no
  // longer exists.
  function remapBlocks(blocks, map) {
    if (!map || !Object.keys(map).length) return blocks;
    (blocks || []).forEach(function (b) {
      (b.sessions || []).forEach(function (s) {
        (s.exercises || []).forEach(function (e) {
          if (map[e.exerciseId]) e.exerciseId = map[e.exerciseId];
          if (e.alts) e.alts = e.alts.map(function (a) { return map[a] || a; });
          if (e.choice && e.choice.options) e.choice.options = e.choice.options.map(function (a) { return map[a] || a; });
        });
      });
    });
    return blocks;
  }

  // Merge imported days into the draft basket, in place, and renumber.
  //
  // The rule that matters is the one about collisions. Keying purely on the day's NAME meant five
  // screenshots that each called themselves "Day 1" landed as one day: four uploads silently ate
  // each other and the basket showed four days for five files. So a name only replaces an existing
  // day when it came from the SAME source (re-importing a corrected "Upper A" from the same file,
  // which is the behaviour that keying by name was for). A same-named day from a different source is
  // a different day: it is kept, and its name made unique so the two can be told apart.
  //
  // The asymmetry is deliberate. Deleting a duplicate day on the draft screen is one tap; a day that
  // was silently overwritten is gone with nothing on screen to say so.
  //
  // The one thing a DIFFERENT source can be is the same session photographed twice. Screenshots of a
  // coaching app overlap: shot three catches the last two movements of Tuesday above the whole of
  // Wednesday, so Tuesday arrives again from a file that has never been read before. Same-source
  // matching cannot see that, and the name rule above turns it into "Push (2)" - which is how five
  // screenshots become an eight-day week. So a day that is plainly a second reading of one already in
  // the basket collapses into it, and the fuller of the two readings is the one kept.
  function mergeDraftDays(days, incoming, sourceRef) {
    days = days || [];
    // Days written by THIS call are off limits as replacement targets. One screenshot the model reads
    // as two sessions both called "Day 1" is two days, not a day and a correction of it, so a single
    // read can never overwrite itself either. Only a LATER re-read of the same source corrects.
    var fresh = {};
    (incoming || []).forEach(function (day) {
      var row = Object.assign({}, day, { sourceRef: sourceRef || null });
      var same = -1;
      for (var i = 0; i < days.length; i++) {
        if (fresh[i]) continue;
        if (norm(days[i].name) === norm(row.name) && sameSource(days[i].sourceRef, sourceRef)) { same = i; break; }
      }
      if (same >= 0) { days[same] = row; fresh[same] = 1; return; }
      // A second reading of a day already in the basket, from a source that overlapped the last one.
      // Days written by this call are exempt for the same reason they are above: one screenshot read
      // as two sessions is two sessions.
      var dupe = -1;
      for (var j = 0; j < days.length; j++) {
        if (fresh[j]) continue;
        if (sameSession(days[j], row)) { dupe = j; break; }
      }
      if (dupe >= 0) {
        // Whichever reading saw more of the session wins outright, name included: the fuller one is
        // the shot that had the whole thing on screen, heading and all.
        if ((row.exercises || []).length > (days[dupe].exercises || []).length) days[dupe] = row;
        fresh[dupe] = 1;
        return;
      }
      var clash = days.some(function (x) { return norm(x.name) === norm(row.name); });
      if (clash) {
        var base = row.name, n = 2;
        while (days.some(function (x) { return norm(x.name) === norm(base + ' (' + n + ')'); })) n++;
        row.name = base + ' (' + n + ')';
      }
      fresh[days.length] = 1;
      days.push(row);
    });
    // A week has seven days, so the eighth thing in the basket cannot have a weekday of its own:
    // dayOfWeek 7 is off the end of every weekday label in the app and off the end of the schedule.
    // It doubles up on Sunday instead, which the block builder already supports (two sessions on one
    // day is an ordinary thing to programme), and which the person can move wherever they like.
    // The recommended week, not the array index. This used to ASSIGN `Math.min(i, 6)` over the top of
    // whatever had been read off the plan, so every imported programme - the whole point of the
    // Premium importer - came back on consecutive days with a four-day weekend, which is the very
    // thing DEFAULT_DOW exists to stop. A weekday the source actually stated is kept.
    /* The basket's weekdays: what the SOURCE said where it said anything, and the recommended week
       for everything else.
       This used to assign `Math.min(i, 6)` over the top of every day, so an imported programme - the
       whole point of the importer - always came back on consecutive days with a four-day weekend.
       Two things have to hold at once. A weekday the plan actually states is the author's and is
       kept. And the basket must always end with as many DISTINCT days as it has sessions, because
       phone screenshots of a plan very often all call themselves "Day 1" and a read that gives five
       of them the same weekday would stack all five on Monday.
       `dowAuto` marks a day this function placed, so re-running it as each new screenshot lands
       re-places them together rather than letting each arrival grab whatever was free - which came
       out distinct but scattered (Mon, Thu, Fri, Tue, Sat for five plain days). */
    var taken = {};
    days.forEach(function (x) {
      if (x.dayOfWeek != null && !x.dowAuto) { x.dayOfWeek = clamp(Math.round(+x.dayOfWeek), 0, 6); taken[x.dayOfWeek] = 1; }
    });
    var basketDows = defaultDows(days.length);
    days.forEach(function (x, i) {
      if (x.dayOfWeek != null && !x.dowAuto) return;
      var rec = basketDows[i];
      var want = (rec != null && !taken[rec]) ? rec : null;
      for (var d = 0; want == null && d <= 6; d++) if (!taken[d]) want = d;
      if (want == null) want = Math.min(i, 6);
      taken[want] = 1;
      x.dayOfWeek = want;
      x.dowAuto = true;
    });
    // Re-mint the exercise ids against the day's position in the BASKET. importTemplate numbers them
    // by the day's index within its own parse, and a batch of screenshots is one parse each, so every
    // one of them thinks it is day zero: five screenshots produce five sets of identical ids. Those
    // ids are what a logged set points back at to find its line in the plan, so a collision between
    // day one and day four is a real one. Deterministic, because this file has to stay testable.
    days.forEach(function (d, di) {
      d.exercises = (d.exercises || []).map(function (e, ei) {
        return Object.assign({}, e, { id: e.exerciseId + '_d' + di + '_' + ei, order: ei });
      });
    });
    return days;
  }

  // One movement, prescribed the way a given block prescribes them. Used wherever somebody adds a
  // movement by hand - the block editor, and mid-session - so a line added to a block always speaks
  // that block's language rather than the defaults of whichever model the app was written around
  // first. A movement dropped into a min-max block used to arrive with the volume model's ramp,
  // three reps in reserve walking down, in the middle of a block that takes its last set to failure.
  function newItemFor(exerciseId, opts) {
    opts = opts || {};
    var ex = byId(exerciseId, opts.custom);
    var style = styleOf(opts.style);
    var week = opts.week || 1;
    var rs = repScheme(ex, (ex && ex.primary && ex.primary[0]) || null, 0, opts.intensity, style, opts.window);
    var sets = style.startSets || 2;
    var pair = minmaxEffort(ex, sets, false);
    var target = {
      sets: sets, repLow: rs.repLow, repHigh: rs.repHigh,
      rir: style.toFailure ? pair.rir : Math.max(0, 4 - week),
      restSec: rs.restSec, tempo: defaultTempo(ex),
    };
    if (style.toFailure) target.rirLast = pair.rirLast;
    return { exerciseId: exerciseId, target: target };
  }

  /* ---- what a second block adds, when there are no sets to add ----------------------------------
   * The published min-max programmes run twelve weeks as two six-week blocks, and the difference
   * between the blocks is not volume - it is identical - and not effort, which is already at failure.
   * It is a technique on the LAST set of about four movements in ten: two drop sets, myo-reps, a set
   * extended with lengthened partials, a static hold. That is the whole progression model between
   * blocks on a style that has run out of sets to give.
   *
   * Which movement gets which is not arbitrary either, and the rule the sheets follow is about what
   * is safe to fail twice on. Nothing goes on a loaded free-weight compound: a drop set on a squat is
   * a second failure with a bar on your back. Bodyweight compounds are fine, which is why the pull-up
   * carries one and the barbell incline press does not.
   */
  var TECHNIQUES = {
    drop: 'Two drop sets (~25% each)',
    myo: 'Myo-reps',
    partials: 'Lengthened partials (extend the set)',
    hold: 'Weighted static hold (30 sec)',
  };
  function techniqueFor(ex) {
    if (!ex) return null;
    var compound = ex.pattern !== 'isolation' && ex.pattern !== 'core';
    var guided = !!STABLE_KIT[ex.equipment];
    var loadedFree = ex.equipment === 'barbell' || ex.equipment === 'dumbbell'
      || ex.equipment === 'kettlebell' || ex.equipment === 'ez';
    // Core work is out. A plank has no rep to extend, no weight to drop and no lengthened position
    // to hold, and "two drop sets" against a Pallof press is the app talking nonsense confidently.
    if (ex.pattern === 'core') return null;
    // And nothing goes on a compound you could be pinned under.
    if (compound && loadedFree) return null;
    // The hold is for grip: a movement whose only job is the forearms. A hammer curl trains them
    // too, and it is still a curl.
    if ((ex.primary || []).length === 1 && ex.primary[0] === 'fa') return 'hold';
    // A stretched position is where extra partial reps are worth having, which is why partials are
    // the technique the published programmes reach for most.
    if (ex.profile === 'len') return 'partials';
    if (guided) return 'drop';
    return 'myo';
  }
  // Decorate a built block. Deterministic, and taken from the END of each session: a technique is
  // fatigue you are choosing to buy, and it is worth buying on the accessory work rather than on the
  // movement the session is built around. The opener never gets one.
  function applyTechniques(block, opts) {
    opts = opts || {};
    var share = opts.share == null ? 0.45 : opts.share;
    var given = 0;
    ((block && block.sessions) || []).forEach(function (s) {
      var items = (s.exercises || []).slice().sort(function (a, b) { return a.order - b.order; });
      var cap = Math.floor(items.length * share);
      var done = 0;
      for (var i = items.length - 1; i >= 1 && done < cap; i--) {
        var key = techniqueFor(byId(items[i].exerciseId, opts.custom));
        if (!key) continue;
        items[i].technique = TECHNIQUES[key];
        done++; given++;
      }
    });
    return given;
  }
  // Does this block already run techniques? Read rather than remembered, so a block edited by hand
  // answers honestly.
  function hasTechniques(block) {
    return ((block && block.sessions) || []).some(function (s) {
      return (s.exercises || []).some(function (e) { return !!e.technique; });
    });
  }

  /* ---- movements the programme leaves up to you ------------------------------------------------
   * A written programme often prescribes a SLOT rather than a movement: "Squat (Your Choice)", with
   * a note listing the back squat, front squat, pendulum, hack, belt and Smith versions. That is not
   * vagueness, it is the author saying this slot is about the pattern and the gym you are standing
   * in decides the rest.
   *
   * So the slot survives the import. An item carries `choice: { key, label, options: [ids] }`, its
   * exerciseId is whichever option is currently picked, and picking a different one moves EVERY week
   * of the block at once - a programme where week one squats and week four hack squats is not the
   * programme. `alts` is the same idea one step weaker: the substitutions the author wrote against a
   * movement, offered first when somebody swaps it because the machine is busy.
   */
  function blockChoices(block, custom) {
    var seen = {}, out = [];
    ((block && block.sessions) || []).forEach(function (s) {
      (s.exercises || []).forEach(function (e) {
        var c = e.choice;
        if (!c || !c.key || seen[c.key]) return;
        seen[c.key] = 1;
        out.push({
          key: c.key, label: c.label || 'Your choice',
          options: (c.options || []).filter(function (id) { return !!byId(id, custom); }),
          picked: e.exerciseId,
          sessions: uniq(((block.sessions) || []).filter(function (x) {
            return (x.exercises || []).some(function (y) { return y.choice && y.choice.key === c.key; });
          }).map(function (x) { return x.name; })),
        });
      });
    });
    return out;
  }
  // Pick one, everywhere it appears. Mutates the block, like swapInBlock, so a caller can run it
  // inside a store update. Returns how many lines moved.
  function applyChoice(block, key, exerciseId) {
    var n = 0;
    ((block && block.sessions) || []).forEach(function (s) {
      (s.exercises || []).forEach(function (e) {
        if (!e.choice || e.choice.key !== key) return;
        // replaceExercise knows that answering a slot is not replacing anything, so this is the same
        // rule rather than a second copy of it. A pick outside the listed options still counts as an
        // answer here: this IS the slot's own control, whatever it has been pointed at.
        if (e.exerciseId !== exerciseId) {
          if ((e.choice.options || []).indexOf(exerciseId) !== -1) replaceExercise(e, exerciseId);
          else { e.exerciseId = exerciseId; delete e.basePlanNote; delete e.baseExerciseId; }
        }
        n++;
      });
    });
    return n;
  }

  /* ---- changing a block from a sentence ---------------------------------------------------------
   * "Swap the barbell incline for the machine press, my gym only has one bench" is a perfectly clear
   * instruction and, until this existed, the only way to carry it out was fourteen taps: find the
   * movement, open the picker, search, pick, repeat on the day it also appears on, then remember it
   * has to hold for four weeks. The written programmes are the worst case, because they are the
   * blocks people least want to rebuild and most often cannot run exactly as printed - a gym without
   * a pendulum squat does not make the programme wrong, it makes one line of it wrong.
   *
   * So a model reads the sentence and writes down what it wants changed, and THIS applies it. The
   * split is the same one the rest of the module keeps: the model proposes, the engine decides. It
   * proposes in the only vocabulary there is - a fixed list of operations, movements named in words -
   * and everything else is settled here, where it is testable:
   *
   *   - Every movement name is resolved against the real library. A name that resolves to nothing is
   *     REJECTED rather than minted as a custom exercise. Importing somebody else's plan mints them,
   *     because the alternative is dropping a line of their programme; here the person already has a
   *     working block and quietly inventing a movement nobody can look up is the worse outcome.
   *   - Every number goes through setExerciseTarget, so the clamps, the rep-range ordering and the
   *     "last set is never easier" rule apply exactly as they do to a stepper tap.
   *   - Weeks already trained are never touched. `fromWeek` is the floor every other editing route
   *     in this module uses, and an instruction that only reaches week four of four says so.
   *   - A change reaches EVERY remaining week, because the person is editing a programme rather than
   *     a Tuesday. Set counts move by their delta rather than to a flat number, so a block that ramps
   *     three-four-five sets still ramps after being asked for one more set.
   *
   * It mutates nothing it was handed: the block comes back as a copy, so a caller can show what
   * would happen and put the old one back. `applied` and `rejected` are plain sentences, because the
   * whole feature rests on the person being able to read what it did before they keep it.
   */
  // Monday-first, matching this module's own dayOfWeek everywhere else. Written out here rather than
  // borrowed from the app, because training.js is pure and is tested on its own.
  var DOW_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var TWEAK_OPS = ['swap', 'add', 'remove', 'sets', 'reps', 'rest', 'effort', 'day', 'rename', 'choice'];
  // A ceiling on one instruction, so a misread sentence cannot rewrite a block wholesale. Twenty-four
  // is comfortably more than any real request ("no barbell anywhere" is about eight) and far less
  // than a programme.
  var TWEAK_MAX_OPS = 24;

  // The sessions an instruction is talking about: a day name, matched loosely, across every week the
  // edit is allowed to reach. No name means the whole block.
  function tweakSessions(block, dayName, fromWeek) {
    var all = ((block && block.sessions) || []).filter(function (s) {
      return fromWeek == null || s.week >= fromWeek;
    });
    var q = norm(dayName);
    if (!q) return all;
    var exact = all.filter(function (s) { return norm(s.name) === q; });
    if (exact.length) return exact;
    // "upper" for "Upper 1", "arms" for "Arms and delts". A day name is short and people shorten it
    // further, and refusing the whole instruction over a missing digit helps nobody.
    return all.filter(function (s) {
      var n = norm(s.name);
      return n.indexOf(q) === 0 || q.indexOf(n) === 0;
    });
  }
  // The movement an instruction names, resolved against what is actually IN the block first. A person
  // saying "the squat" means the squat in front of them, and the library's nearest match to a bare
  // "squat" is not necessarily the one their programme prescribes.
  function tweakExercise(block, name, custom, fromWeek) {
    var q = cleanName(name);
    if (!q) return null;
    var inBlock = {};
    ((block && block.sessions) || []).forEach(function (s) {
      if (fromWeek != null && s.week < fromWeek) return;
      (s.exercises || []).forEach(function (e) { inBlock[e.exerciseId] = 1; });
    });
    var ids = Object.keys(inBlock);
    var i;
    for (i = 0; i < ids.length; i++) {
      var ex = byId(ids[i], custom);
      if (ex && norm(ex.name) === q) return ids[i];
    }
    var d = resolveDetail(name, custom);
    // A loose match against the whole library is how "chest fly" becomes a cable crossover nobody
    // asked for. The import screen can afford a shaky read because it shows every line for checking;
    // this applies straight to a block, so it takes the confident matches only.
    if (d && (d.how === 'exact' || d.how === 'alias' || d.score >= 0.55)) return d.id;
    return null;
  }
  // Rows in a session that are the named movement. Matched on the movement rather than on one row,
  // exactly as the block editor's own replace does: the same lift can appear twice in a day.
  function tweakRows(session, exerciseId) {
    return (session.exercises || []).filter(function (e) { return e.exerciseId === exerciseId; });
  }
  function tweakName(id, custom) { var e = byId(id, custom); return e ? e.name : id; }
  // "in every week", "in weeks 2 to 4", "in Upper 1" - said once at the end of a sentence so the
  // person can see how far a change reached without counting sessions.
  function tweakReach(sessions, block) {
    var weeks = uniq(sessions.map(function (s) { return s.week; })).sort(function (a, b) { return a - b; });
    var days = uniq(sessions.map(function (s) { return s.name; }));
    var total = uniq(((block && block.sessions) || []).map(function (s) { return s.week; })).length;
    var where = days.length === 1 ? days[0] : days.length + ' days';
    if (weeks.length >= total) return where + ', all ' + total + ' weeks';
    if (weeks.length === 1) return where + ', week ' + weeks[0];
    return where + ', weeks ' + weeks[0] + '-' + weeks[weeks.length - 1];
  }

  function blockTweak(block, ops, opts) {
    opts = opts || {};
    var custom = opts.custom;
    var fromWeek = opts.fromWeek == null ? null : opts.fromWeek;
    var out = JSON.parse(JSON.stringify(block || {}));
    var applied = [], rejected = [];
    var list = (ops || []).filter(function (o) { return o && TWEAK_OPS.indexOf(o.op) !== -1; });
    if (list.length > TWEAK_MAX_OPS) {
      rejected.push('That came back as ' + list.length + ' separate changes, which is more than one instruction should be. Nothing was applied - try asking for one thing at a time.');
      return { block: JSON.parse(JSON.stringify(block || {})), applied: applied, rejected: rejected, ops: 0 };
    }
    list.forEach(function (o) {
      var sessions = tweakSessions(out, o.day, fromWeek);
      if (!sessions.length) {
        rejected.push(o.day ? 'There is no "' + o.day + '" in this block.' : 'There is nothing left in this block to change.');
        return;
      }
      if (o.op === 'rename') {
        var newName = String(o.name || '').trim().slice(0, 40);
        if (!newName) { rejected.push('A day cannot be renamed to nothing.'); return; }
        sessions.forEach(function (s) { s.name = newName; });
        applied.push('Renamed ' + o.day + ' to ' + newName + '.');
        return;
      }
      if (o.op === 'day') {
        var dow = Math.round(+o.dayOfWeek);
        if (!(dow >= 0 && dow <= 6)) { rejected.push('"' + o.day + '" was given a weekday I could not read.'); return; }
        var moved = 0;
        sessions.forEach(function (s) { if (setSessionDay(s, dow)) moved++; });
        if (!moved) { rejected.push('Could not move "' + o.day + '".'); return; }
        applied.push('Moved ' + (sessions[0].name || o.day) + ' to ' + DOW_NAME[dow] + '.');
        return;
      }
      if (o.op === 'choice') {
        var chosen = tweakExercise(out, o.exercise, custom, null);
        var slot = blockChoices(out, custom).filter(function (c) {
          return norm(c.label).indexOf(norm(o.label || '')) !== -1 || (c.options || []).indexOf(chosen) !== -1;
        })[0];
        if (!chosen || !slot) { rejected.push('Could not answer the open slot with "' + (o.exercise || '') + '".'); return; }
        applyChoice(out, slot.key, chosen);
        applied.push(slot.label + ': ' + tweakName(chosen, custom) + '.');
        return;
      }
      if (o.op === 'add') {
        var addId = tweakExercise(out, o.exercise, custom, null);
        if (!addId) { rejected.push('There is no "' + (o.exercise || '') + '" in the exercise library, so I left it out.'); return; }
        if (!o.day) { rejected.push('"' + (o.exercise || '') + '" was not given a day to go on, so I left it out.'); return; }
        var added = 0;
        sessions.forEach(function (s) {
          var item = addExerciseToSession(s, addId, custom, addId + '_t' + s.id + '_' + (s.exercises || []).length, out.intensity);
          if (!item) return;
          // Prescribed the way THIS block prescribes things, so a movement dropped into a min-max
          // block does not arrive carrying the volume model's ramp. Same rule as the builder's own
          // "+ Add movement", which is the control this is standing in for.
          var fresh = newItemFor(addId, { style: out.style, week: s.week, window: s.window, custom: custom, intensity: out.intensity });
          item.target = fresh.target;
          setExerciseTarget(s, item.id, {
            sets: o.sets == null ? null : o.sets,
            repLow: o.repLow == null ? null : o.repLow,
            repHigh: o.repHigh == null ? null : o.repHigh,
          });
          added++;
        });
        if (!added) { rejected.push('Could not add ' + tweakName(addId, custom) + '.'); return; }
        applied.push('Added ' + tweakName(addId, custom) + ' to ' + tweakReach(sessions, out) + '.');
        return;
      }
      // Everything below names a movement that has to already be in the block.
      var id = tweakExercise(out, o.exercise || o.from, custom, fromWeek);
      if (!id) {
        rejected.push('There is no "' + (o.exercise || o.from || '') + '" in the weeks I am allowed to change.');
        return;
      }
      var touched = sessions.filter(function (s) { return tweakRows(s, id).length > 0; });
      if (!touched.length) {
        rejected.push(tweakName(id, custom) + ' is not in ' + (o.day ? '"' + o.day + '"' : 'the weeks I am allowed to change') + '.');
        return;
      }
      if (o.op === 'remove') {
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) { removeExerciseFromSession(s, e.id); });
        });
        applied.push('Took ' + tweakName(id, custom) + ' out of ' + tweakReach(touched, out) + '.');
        return;
      }
      if (o.op === 'swap') {
        var toId = tweakExercise(out, o.to, custom, null);
        if (!toId) { rejected.push('There is no "' + (o.to || '') + '" in the exercise library, so ' + tweakName(id, custom) + ' was left alone.'); return; }
        if (toId === id) { rejected.push(tweakName(id, custom) + ' is already what it was asked to become.'); return; }
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) { replaceExercise(e, toId); });
        });
        applied.push(tweakName(id, custom) + ' → ' + tweakName(toId, custom) + ' (' + tweakReach(touched, out) + ').');
        return;
      }
      if (o.op === 'sets') {
        var want = Math.round(+o.sets);
        if (!(want >= SETS_MIN && want <= SETS_MAX)) { rejected.push('"' + o.sets + '" is not a set count I can use.'); return; }
        // The DELTA, not the number. A block that ramps two, three, four sets across its weeks is
        // still meant to ramp after somebody asks for one more set of rows; writing the flat number
        // into every week would quietly delete the progression the block was built on.
        var base = null;
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) {
            if (base == null) base = e.target.sets;
          });
        });
        var delta = want - base;
        if (!delta) { rejected.push(tweakName(id, custom) + ' is already on ' + want + ' sets.'); return; }
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) { setExerciseTarget(s, e.id, { sets: e.target.sets + delta }); });
        });
        applied.push(tweakName(id, custom) + ': ' + base + ' → ' + want + ' sets (' + tweakReach(touched, out) + ').');
        return;
      }
      if (o.op === 'reps') {
        if (o.repLow == null && o.repHigh == null) { rejected.push('No rep range was given for ' + tweakName(id, custom) + '.'); return; }
        var shown = null;
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) {
            var t = setExerciseTarget(s, e.id, { repLow: o.repLow, repHigh: o.repHigh });
            if (t && !shown) shown = t.repLow + '-' + t.repHigh;
          });
        });
        applied.push(tweakName(id, custom) + ': ' + shown + ' reps (' + tweakReach(touched, out) + ').');
        return;
      }
      if (o.op === 'rest') {
        var secs = Math.round(+o.restSec);
        if (!(secs >= 15 && secs <= 600)) { rejected.push('"' + o.restSec + '" is not a rest I can use.'); return; }
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) { setExerciseTarget(s, e.id, { restSec: secs }); });
        });
        applied.push(tweakName(id, custom) + ': rest ' + secs + 's (' + tweakReach(touched, out) + ').');
        return;
      }
      if (o.op === 'effort') {
        if (o.rir == null && o.rirLast == null) { rejected.push('No effort target was given for ' + tweakName(id, custom) + '.'); return; }
        var eff = null;
        touched.forEach(function (s) {
          tweakRows(s, id).forEach(function (e) {
            var t = setExerciseTarget(s, e.id, { rir: o.rir, rirLast: o.rirLast });
            if (t && !eff) eff = t;
          });
        });
        applied.push(tweakName(id, custom) + ': ' + (eff.rirLast != null && eff.rirLast !== eff.rir
          ? eff.rir + ' RIR, last set ' + eff.rirLast : eff.rir + ' RIR')
          + ' (' + tweakReach(touched, out) + ').');
        return;
      }
    });
    // A superset whose partner has been taken out is not a superset, and a block that ends up with a
    // row labelled A1 and nothing labelled A2 is a block that reads wrong on every screen.
    (out.sessions || []).forEach(function (s) { dropBrokenSupersets(s); });
    return { block: out, applied: applied, rejected: rejected, ops: list.length };
  }

  /* ---- a programme that arrives as a spreadsheet -------------------------------------------------
   * A written programme in a spreadsheet does not need a model to read it. It has columns, and the
   * columns say what they mean: the exercise, the working sets, the rep range, the reps in reserve,
   * the rest, the substitutions, the notes. Handing that to a language model - which is what the
   * photo importer does, because a photograph genuinely needs one - costs a guess on every line and
   * cannot see more of a long sheet than fits in a prompt. A twelve-week programme is about 93,000
   * characters of grid; the prompt carries 24,000 of it. Three quarters of the plan never arrives.
   *
   * So this reads the grid directly, and reads all of it. Every set, rep range, RIR pair, rest and
   * note comes off the sheet, and the same sheet gives the same answer every time.
   *
   * The layout it knows is the one every coaching-app export shares: a week marker on its own row, a
   * day label on the row its first movement sits on, then the movement and its columns. It returns
   * null the moment the grid does not look like that, so an ordinary spreadsheet of numbers falls
   * through to the importer that can cope with anything.
   */
  var SHEET = {
    day: 1, name: 2, technique: 3, warmups: 4, sets: 5, reps: 6,
    rir: 11, rirLast: 12, rest: 13, sub1: 14, sub2: 15, note: 16,
  };
  // Excel reads "6-8" as the sixth of August and stores a date serial: days since 1899-12-30. The
  // rep range and the warm-up count are the two columns it does this to, and a plan whose rep ranges
  // have silently become dates is a plan nobody can read.
  function serialToRange(n) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
  }
  function sheetCell(row, i) {
    var v = (row && row[i] == null) ? '' : String(row[i]).trim();
    if ((i === SHEET.warmups || i === SHEET.reps) && /^\d+(\.\d+)?$/.test(v) && +v > 20000) v = serialToRange(+v);
    return v;
  }
  function sheetRange(v) {
    var m = String(v).match(/^(\d+)\s*-\s*(\d+)$/);
    return m ? { low: +m[1], high: +m[2] } : null;
  }
  // "This can be a Barbell Back Squat, Barbell Front Squat, Pendulum Squat, Hack Squat, Belt Squat,
  // or Smith Machine Squat." A slot the author left open, and the note is the list of what fills it.
  function sheetChoice(name, note, resolve) {
    if (!/your choice/i.test(name) && !/^this can be/i.test(note || '')) return null;
    var listed = String(note || '').replace(/^this can be (a|an)\s*/i, '').replace(/\.$/, '')
      .split(/,| or /i).map(function (x) { return x.trim(); }).filter(Boolean);
    var options = [];
    listed.forEach(function (n) {
      var id = resolve(n);
      if (id && options.indexOf(id) === -1) options.push(id);
    });
    if (options.length < 2) return null;
    var label = name.replace(/\s*\(your choice\)\s*/i, '').trim() || 'Your choice';
    return { key: norm(label).replace(/[^a-z0-9]+/g, '_'), label: label + ' - your choice', options: options };
  }
  var SHEET_KIND = function (name) {
    var n = norm(name);
    if (n.indexOf('full') !== -1) return 'full';
    if (n.indexOf('arm') !== -1 || n.indexOf('delt') !== -1) return 'arms';
    if (n.indexOf('upper') !== -1) return 'upper';
    if (n.indexOf('lower') !== -1 || n.indexOf('leg') !== -1) return 'lower';
    return 'full';
  };
  // Where a week's sessions fall. These sheets write "1-2 Rest Days" between days rather than naming
  // weekdays, so the gaps are kept where the programme puts them.
  // A sheet says what to train and almost never says when, so an import lands on the same
  // recommended week as anything else the app builds. See DEFAULT_DOW.
  var SHEET_DOW = DEFAULT_DOW;

  // What a movement is, read off its own name. The photo importer gets this from the model that read
  // the photograph; a sheet has no model, so a name the library has never seen is classified here.
  // It is a guess and it is flagged as one (auto: true), but a guessed entry keeps the line IN the
  // programme, and a dropped line is a set the person paid for and will never be asked to do.
  var SHEET_KIT = [
    [/\bsmith\b/, 'smith'], [/\b(barbell|bb)\b/, 'barbell'], [/\b(dumbbell|db)\b/, 'dumbbell'],
    [/\bez\b/, 'ez'], [/\bcable\b/, 'cable'], [/\bkettlebell\b/, 'kettlebell'],
    [/\btrap.?bar\b/, 'trapbar'], [/\bband\b/, 'band'], [/\bplate\b/, 'dumbbell'],
    // Word-bounded on every alternative, not just the first and the last. `\bmachine|press|...\b`
    // binds the \b to `machine` and to the final branch only, so "press" matched inside
    // "pressdown" and a cable triceps pressdown came out as a machine.
    [/\b(machine|press|pulldown|pec deck|leg press|leg curl|leg extension)\b/, 'machine'],
  ];
  var SHEET_MUSCLE = [
    [/calf|calve/, ['ca']], [/quad|squat|leg extension|leg press|lunge|split squat|sissy/, ['qu']],
    [/hamstring|leg curl|rdl|romanian|good ?morning|nordic/, ['ha']],
    [/glute|hip thrust|kickback|abduction/, ['gl']], [/adduct/, ['ad']],
    [/tricep|pushdown|skull ?crusher|overhead extension|dip/, ['tr']],
    [/bicep|curl/, ['bi']], [/forearm|wrist|grip/, ['fa']],
    [/oblique|side bend|woodchop/, ['ob']], [/ab |abs|crunch|leg raise|plank|rollout/, ['ab']],
    [/rear delt|reverse (fly|pec)|face pull/, ['rd']], [/lateral raise|side raise|y.?raise/, ['sd']],
    [/shoulder press|overhead press|front raise/, ['fd']],
    [/row|shrug|pull.?over/, ['ub']], [/lat |lats|pulldown|pull.?up|chin.?up/, ['lt']],
    [/chest|bench|pec|fly|push.?up/, ['ch']], [/deadlift/, ['lb']],
  ];
  var SHEET_ISOLATION = /curl|raise|extension|fly|pushdown|kickback|shrug|calf|crunch|pull.?over|face pull/;

  function blocksFromGrid(rows, opts) {
    opts = opts || {};
    var custom = (opts.custom || []).slice();
    var unknown = [], minted = [];

    /* A movement named on the sheet becomes a movement in the library, under the sheet's own name.
     *
     * The rule here is EXACT NAME OR NOTHING, and it is the whole point. A written programme names
     * its movements deliberately: a close-grip lat pulldown is not a neutral-grip pulldown, a smith
     * machine lunge is not a split squat, an EZ-bar preacher curl is not a dumbbell one, and a
     * seated cable deadlift is certainly not a seated cable row. Matching by resemblance re-pointed
     * fifty-four of the ninety movements in these two programmes at something the library already
     * had, and every one of those is a line of somebody's plan quietly replaced with a different
     * exercise - and, worse, three different preacher curls collapsing into one entry whose logged
     * history is then three lifts averaged together.
     *
     * So resemblance decides only what a movement IS - which muscles, which kit, which pattern -
     * and never which movement it is. The nearest thing the library knows is a good classifier even
     * when it is the wrong exercise, so a new entry inherits its attribution and then has its
     * equipment corrected from its own name. Nothing is guessed from scratch and nothing is
     * silently substituted.
     */
    // The sheet's words, minus the one parenthetical that is an instruction rather than part of the
    // name. "Dead Hang (optional)" is a dead hang; everything else in brackets - "(Wide Grip)",
    // "(V-bar)" - is the movement.
    function sheetName(name) {
      var s = String(name).replace(/\s*\((optional|if available|as needed)\)\s*/i, ' ').replace(/\s+/g, ' ').trim();
      // The abbreviations a spreadsheet writes and a library does not: DB, BB, OHP. Expanded with
      // the same table cleanName expands a QUERY with, which is what makes the stored name findable
      // - a movement filed as "DB Incline Press" is one whose own name cleans to "dumbbell incline
      // press" and therefore never matches itself, so every re-import mints another copy of it.
      // Expanding an abbreviation is not substituting a movement; it is the same words, spelled out.
      return s.split(' ').map(function (w) {
        var key = w.toLowerCase().replace(/[^a-z0-9']/g, '');
        var full = SHORTHAND[key];
        if (!full) return w;
        return w.replace(new RegExp(key, 'i'), full.charAt(0).toUpperCase() + full.slice(1));
      }).join(' ');
    }
    function sheetExercise(name) {
      var n = norm(name);
      var near = resolveDetail(name, custom);
      var parent = near ? byId(near.id, custom) : null;
      var kit = parent ? parent.equipment : 'machine';
      for (var i = 0; i < SHEET_KIT.length; i++) if (SHEET_KIT[i][0].test(n)) { kit = SHEET_KIT[i][1]; break; }
      var muscle = parent ? (parent.primary || []).slice() : null;
      if (!muscle || !muscle.length) {
        muscle = ['ch'];
        for (var j = 0; j < SHEET_MUSCLE.length; j++) if (SHEET_MUSCLE[j][0].test(n)) { muscle = SHEET_MUSCLE[j][1]; break; }
      }
      return {
        // The sheet's name as written, not tidied. tidyName strips a parenthetical - "Pull-Up (Wide
        // Grip)" becomes "Pull-up" - which is both a different movement's name and a name that no
        // longer matches the sheet it came from, so importing the same programme twice would mint a
        // second copy every time. Gospel means the words as written.
        id: autoCustomId(sheetName(name)), name: sheetName(name), equipment: kit,
        pattern: parent ? parent.pattern : (SHEET_ISOLATION.test(n) ? 'isolation' : 'compound'),
        profile: parent ? parent.profile : 'mid',
        primary: muscle, secondary: parent ? (parent.secondary || []).slice() : [],
        custom: true, auto: true, fromName: parent ? parent.id : null,
      };
    }
    function mint(name) {
      var id = autoCustomId(sheetName(name));
      var twin = custom.filter(function (x) { return x.id === id; })[0];
      if (twin) return twin.id;
      var ex = sheetExercise(name);
      custom.push(ex); minted.push(ex);
      return id;
    }
    // The sheet's word is final. Only a movement the library already holds under THIS NAME is the
    // same movement; anything else gets its own entry rather than being read as something near it.
    function resolve(name) {
      if (!name) return null;
      // Asked and stored under the same cleaned name, so a second import of the same sheet resolves
      // against what the first one added rather than minting a second copy of everything.
      var clean = sheetName(name);
      var d = resolveDetail(clean, custom);
      if (d && d.how === 'exact') return d.id;
      // The same words with only the EQUIPMENT moved are the same movement. "Machine Chest Press"
      // and "Chest press machine" are one exercise written two ways round, and tidyName already
      // moves a trailing piece of kit to the front for exactly this reason.
      //
      // Only the equipment, and only its position. A plain sorted-word comparison looks like the
      // same idea and is not: "Low-to-high cable fly" and "High-to-low cable fly" are the same five
      // words and two different movements, and the library holds both. So the words either side of
      // the kit have to be in the SAME ORDER, which is what makes this a rewrite rather than a
      // substitution - and it stays the only thing allowed to override the sheet's own name.
      var pool = all(custom);
      var mine = sheetExercise(clean);
      for (var i = 0; i < pool.length; i++) if (sameButForKit(pool[i], clean, mine.equipment)) return pool[i].id;
      if (unknown.indexOf(clean) === -1) unknown.push(clean);
      return mint(clean);
    }
    // Exercise SELECTION is a different question. "This can be a Barbell Back Squat, a Pendulum
    // Squat, a Hack Squat..." is the author describing the kinds of squat that would do, in prose,
    // in a note - not naming the movement they prescribed. Those are generic variants and they read
    // against the library as they always did, so the choice a person is offered is six movements
    // they already have rather than six new entries beside them.
    function resolveChoice(name) {
      var d = name ? resolveDetail(name, custom) : null;
      return d ? d.id : null;
    }
    var weeks = [], week = null, day = null;
    (rows || []).forEach(function (r) {
      var marker = sheetCell(r, SHEET.day);
      if (/^week \d+$/i.test(marker)) { week = { n: +marker.split(/\s+/)[1], days: [] }; weeks.push(week); day = null; return; }
      var name = sheetCell(r, SHEET.name);
      if (!week || !name || name === 'Exercise') return;
      if (marker && !/^week/i.test(marker)) { day = { name: marker, items: [] }; week.days.push(day); }
      if (!day) { day = { name: 'Day ' + (week.days.length + 1), items: [] }; week.days.push(day); }
      var reps = sheetRange(sheetCell(r, SHEET.reps));
      var warm = sheetRange(sheetCell(r, SHEET.warmups));
      var rest = sheetRange(String(sheetCell(r, SHEET.rest)).replace(/\s*min.*/i, ''));
      var rirOf = function (i) { var v = sheetCell(r, i); return /^\d+$/.test(v) ? +v : null; };
      var note = sheetCell(r, SHEET.note);
      var choice = sheetChoice(name, note, resolveChoice);
      // "Squat (Your Choice)" with no list behind it is still a squat. Resolved without the
      // parenthetical, so the library gets a movement rather than a piece of the author's phrasing.
      var id = choice ? choice.options[0] : resolve(name.replace(/\s*\((your )?choice\)\s*/i, ' ').trim());
      if (!id) return;
      var alts = [sheetCell(r, SHEET.sub1), sheetCell(r, SHEET.sub2)]
        .filter(function (x) { return x && !/^(n\/a|see notes)$/i.test(x); })
        .map(resolve).filter(Boolean);
      alts = alts.filter(function (a) { return a !== id; });
      var tech = sheetCell(r, SHEET.technique);
      day.items.push({
        exerciseId: id, sourceName: name, sets: +sheetCell(r, SHEET.sets) || 1,
        repLow: reps ? reps.low : null, repHigh: reps ? reps.high : null,
        rir: rirOf(SHEET.rir), rirLast: rirOf(SHEET.rirLast),
        restSec: rest ? Math.round(((rest.low + rest.high) / 2) * 60) : null,
        technique: (tech && !/^n\/a$/i.test(tech)) ? tech : null,
        warmups: warm ? Math.round((warm.low + warm.high) / 2) : null,
        choice: choice, alts: alts.length ? alts : null, note: note || null,
      });
    });
    // Does this actually look like a programme? A week with days, days with movements, and every
    // week the same shape. Anything else is a spreadsheet, and the importer that copes with anything
    // should have it instead.
    weeks = weeks.filter(function (w) { return w.days.length && w.days.some(function (d) { return d.items.length; }); });
    if (!weeks.length || !weeks[0].days.length) return null;
    var dayCount = weeks[0].days.length;
    if (weeks.some(function (w) { return w.days.length !== dayCount; })) return null;

    var splitAt = opts.splitAt || 6;
    var chunks = weeks.length > splitAt ? [weeks.slice(0, splitAt), weeks.slice(splitAt)] : [weeks];
    var name = opts.name || 'Imported programme';
    var stamp = Date.now().toString(36);
    var blocks = chunks.map(function (chunk, ci) {
      // A sheet import is built as a min-max block (`style: 'minmax'` below), so it takes the week
      // that method prescribes rather than the general recommendation. Pointing SHEET_DOW at
      // DEFAULT_DOW made a fresh 4-day import open on Mon/Tue/Thu/Fri while the schedule screen told
      // it that "this plan is written around Mon, Thu, Fri, Sat" - the app disagreeing with itself
      // about a block it had just built.
      var dows = recommendedDows({ style: 'minmax' }, dayCount);
      // Fresh every time, so two imports of one sheet cannot collide on the shelf. A caller that
      // wants a stable file on disk (tools/minmax-import.mjs) passes its own prefix instead.
      var id = opts.idPrefix ? opts.idPrefix + (chunks.length > 1 ? '_b' + (ci + 1) : '') : 'blk_' + stamp + '_' + ci + Math.random().toString(36).slice(2, 5);
      var sessions = [];
      chunk.forEach(function (w, wi) {
        w.days.forEach(function (d, di) {
          sessions.push({
            id: id + '_w' + (wi + 1) + 'd' + di, week: wi + 1,
            dayOfWeek: dows[di] == null ? Math.min(di, 6) : dows[di],
            name: d.name, kind: SHEET_KIND(d.name), deload: false,
            exercises: d.items.map(function (it, ei) {
              return {
                id: id + '_w' + (wi + 1) + 'd' + di + '_e' + ei,
                exerciseId: it.exerciseId, order: ei, sourceName: it.sourceName,
                choice: it.choice || null, alts: it.alts || null,
                technique: it.technique || null, planNote: it.note || null,
                warmups: it.warmups == null ? null : it.warmups,
                target: {
                  sets: clamp(it.sets, SETS_MIN, SETS_MAX),
                  repLow: clamp(it.repLow || 6, REPS_MIN, REPS_MAX),
                  repHigh: clamp(it.repHigh || 10, REPS_MIN, REPS_MAX),
                  rir: clamp(it.rir == null ? 1 : it.rir, 0, RIR_MAX),
                  rirLast: clamp(it.rirLast == null ? (it.rir == null ? 0 : it.rir) : it.rirLast, 0, RIR_MAX),
                  restSec: clamp(it.restSec || 120, 30, 600),
                  tempo: null,
                },
              };
            }),
          });
        });
      });
      return {
        id: id, name: chunks.length > 1 ? name + ' - Block ' + (ci + 1) : name,
        goal: 'hypertrophy', weeks: chunk.length, shape: 'as-written', style: 'minmax',
        daysPerWeek: dayCount, intensity: 'high', startISO: null, archived: false, shared: false,
        source: 'file', sourceRef: { kind: 'file', name: opts.fileName || 'a spreadsheet' },
        sessions: sessions,
      };
    });
    return { blocks: blocks, unknown: uniq(unknown), custom: minted, weeks: weeks.length, daysPerWeek: dayCount };
  }

  /* ---- the programmes the app ships with --------------------------------------------------------
   * Two written programmes, in the app, ready to run: a four-day and a five-day. They are the house
   * method as an actual plan rather than as a set of rules - what the generator is aiming at when it
   * builds somebody a block, and what somebody who does not want to answer questions can just start.
   *
   * WHAT THEY ARE. One week each, exactly as written: the movements in their order, the working
   * sets, the rep range, the reps in reserve on the first set and on the last, the rest, the
   * author's own warm-up count, their note, and the substitutions they offered. Where the programme
   * leaves a slot open - the squat - it stays open and the person picks (see blockChoices).
   *
   * WHY ONE WEEK AND NOT TWELVE. The sheets they came from run twelve weeks, and the movements,
   * sets, rep ranges and rests are identical in every one of them. What changes is effort: week one
   * is an intro week a rep or two off failure, weeks two to six are the working prescription, and
   * weeks eight to twelve are that again with intensity techniques over the top. The block this app
   * runs is FOUR weeks and has no week to give away to a ramp-in, so what ships is the working week
   * and every last set is an all-out set from the first session. The techniques are the block after
   * this one (applyTechniques), not a thing to open with.
   *
   * Generated by tools/gen-programmes.mjs from the source spreadsheets. Edit the sheet and re-run
   * it; do not hand-edit what is below, because a plan re-typed by hand is a plan with a typo in it.
   */
  var PROGRAMMES = [
  { key: "mac4", name: "Macrosaurus 4 Day", daysPerWeek: 4, template: [
    {"name":"Full body","kind":"full","dayOfWeek":0,"exercises":[{"exerciseId":"lying_leg_curl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["seated_leg_curl","nordic_curl"],"warmups":2,"planNote":"Set the machine so that you get the biggest stretch possible at the bottom. Prevent your butt from popping up as you curl.","sourceName":"Lying Leg Curl"},{"exerciseId":"back_squat","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":240},"choice":{"key":"squat","label":"Squat - your choice","options":["back_squat","front_squat","pendulum_squat","hack_squat","belt_squat","smith_squat"]},"warmups":3,"planNote":"This can be a Barbell Back Squat, Barbell Front Squat, Pendulum Squat, Hack Squat, Belt Squat, or Smith Machine Squat.","sourceName":"Squat (Your Choice)"},{"exerciseId":"bb_incline","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":240},"alts":["smith_machine_incline_press","db_incline"],"warmups":3,"planNote":"A 30° or 45° bench will work here. Pause for 1 second at the bottom of each rep while maintaining tension on the pecs.","sourceName":"Barbell Incline Press"},{"exerciseId":"db_y_raise_incline","target":{"sets":1,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_y_raise","machine_lateral"],"warmups":1,"planNote":"Use a 30° incline bench (back against the bench) and lift the weight up and out in a Y shape.","sourceName":"Incline DB Y-Raise"},{"exerciseId":"pullup__wide","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":150},"alts":["lat_pulldown_wide_grip","1_arm_cable_pulldown"],"warmups":2,"planNote":"Control the negative and feel your lats pulling apart. Full ROM!","sourceName":"Pull-Up (Wide Grip)"},{"exerciseId":"standing_calf","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["leg_press_calf","donkey_calf"],"warmups":1,"planNote":"1-2 second pause at the bottom of each rep. Instead of just going up onto your toes, think about rolling your ankle back and forth on the balls of your feet.","sourceName":"Standing Calf Raise"}]},
    {"name":"Upper","kind":"upper","dayOfWeek":3,"exercises":[{"exerciseId":"close_grip_lat_pulldown","target":{"sets":2,"repLow":8,"repHigh":10,"rir":1,"rirLast":0,"restSec":150},"alts":["close_grip_pull_up","1_arm_cable_pulldown"],"warmups":3,"planNote":"Lean back by ~15° and drive your elbows down as you squeeze your shoulder blades together. This should feel like a mix of lats and mid-traps.","sourceName":"Close-Grip Lat Pulldown"},{"exerciseId":"tbar_row_supported","target":{"sets":2,"repLow":8,"repHigh":10,"rir":1,"rirLast":0,"restSec":150},"alts":["chest_supported_machine_row","chest_supported_row"],"warmups":3,"planNote":"Flare elbows out at roughly 45° and squeeze your shoulder blades together hard at the top of each rep.","sourceName":"Chest-Supported T-Bar Row"},{"exerciseId":"shrug_machine","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["shrug_bb","shrug_in_cable"],"warmups":2,"planNote":"Think about shrugging \"up to your ears\". Use straps, if possible.","sourceName":"Machine Shrug"},{"exerciseId":"machine_press","target":{"sets":2,"repLow":8,"repHigh":10,"rir":1,"rirLast":0,"restSec":240},"alts":["smith_bench","db_bench"],"warmups":3,"planNote":"1 second pause at the bottom of each rep while maintaining tension on the pecs.","sourceName":"Machine Chest Press"},{"exerciseId":"high_cable_lateral_raise","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["db_lateral","machine_lateral"],"warmups":1,"planNote":"Set the cable at roughly hip height. Let your hand go slightly past your midline at the bottom of each rep to get a deep stretch on the side delt.","sourceName":"High-Cable Lateral Raise"},{"exerciseId":"1_arm_reverse_pec_deck","target":{"sets":1,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["lying_reverse_dumbbell_fly","reverse_cable_crossover"],"warmups":1,"planNote":"Sweep the weight out to create the largest semi-circle possible with your arm.","sourceName":"1-Arm Reverse Pec Deck"},{"exerciseId":"cable_crunch","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["weighted_crunch","machine_crunch2"],"warmups":1,"planNote":"Round your lower back as you crunch. Maintain a mind-muscle connection with your 6-pack.","sourceName":"Cable Crunch"}]},
    {"name":"Lower","kind":"lower","dayOfWeek":4,"exercises":[{"exerciseId":"leg_extension","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["reverse_nordic2","sissy_squat"],"warmups":2,"planNote":"Set the seat back as far as it will go while still feeling comfortable. Grab the handles as hard as you can to pull your butt down into the seat (using straps can help here).","sourceName":"Leg Extension"},{"exerciseId":"rdl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":2,"rirLast":1,"restSec":150},"alts":["db_rdl","seated_cable_deadlift"],"warmups":3,"planNote":"Stick your glutes straight back as you lower the bar straight down, centered over the middle of your foot. Get a nice deep stretch at the bottom, but keep your spine neutral (don't round forward).","sourceName":"Barbell RDL"},{"exerciseId":"machine_hip_thrust","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":150},"alts":["hip_thrust","45_hyperextension"],"warmups":3,"planNote":"Squeeze your glutes hard at the top and control the weight on the way down.","sourceName":"Machine Hip Thrust"},{"exerciseId":"leg_press","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":150},"alts":["smith_squat","barbell_squat"],"warmups":3,"planNote":"Feet lower on the platform for more quad focus. Get as deep as you can without excessive back rounding.","sourceName":"Leg Press"},{"exerciseId":"standing_calf","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["leg_press_calf","donkey_calf"],"warmups":1,"planNote":"1-2 second pause at the bottom of each rep. Instead of just going up onto your toes, think about rolling your ankle back and forth on the balls of your feet.","sourceName":"Standing Calf Raise"}]},
    {"name":"Arms and delts","kind":"arms","dayOfWeek":5,"exercises":[{"exerciseId":"bayesian_curl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["incline_curl","standing_dumbbell_curl"],"warmups":1,"planNote":"As you curl, optionally lean forward to prevent the cable from hitting your wrist at the top. Control the negative and feel a deep stretch at the bottom of each rep.","sourceName":"Bayesian Cable Curl"},{"exerciseId":"overhead_cable_triceps_extension","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["overhead_dumbbell_triceps_extension","skull_crusher"],"warmups":1,"planNote":"Feel a deep stretch on the triceps throughout the entire negative.","sourceName":"Overhead Cable Triceps Extension"},{"exerciseId":"zottman_curl_modified","target":{"sets":1,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["hammer_curl","preacher_hammer_curl"],"warmups":1,"planNote":"Hammer curl on the way up and supinated curl (palms up) on the way down.","sourceName":"Modified Zottman Curl"},{"exerciseId":"cable_kickback_tri","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["dip_machine","close_grip_dip"],"warmups":1,"planNote":"Keep your upper arm behind your torso throughout the ROM.","sourceName":"Cable Triceps Kickback"},{"exerciseId":"wrist_curl","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_wrist_curl"],"warmups":1,"planNote":"Smooth, controlled reps.","sourceName":"DB Wrist Curl"},{"exerciseId":"dumbbell_wrist_extension","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_wrist_extension"],"warmups":1,"planNote":"Smooth, controlled reps.","sourceName":"DB Wrist Extension"},{"exerciseId":"alternating_dumbbell_curl","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["bb_curl","ez_curl"],"warmups":1,"planNote":"Slow, controlled reps!","sourceName":"Alternating DB Curl"},{"exerciseId":"machine_lateral","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["high_cable_lateral_raise","db_lateral"],"warmups":1,"planNote":"Focus on squeezing your side delt to move the weight.","sourceName":"Machine Lateral Raise"},{"exerciseId":"dead_hang","target":{"sets":2,"repLow":6,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"warmups":1,"planNote":"Try to add a few more seconds each week!","sourceName":"Dead Hang (optional)"}]}
  ] },
  { key: "mac5", name: "Macrosaurus 5 Day", daysPerWeek: 5, template: [
    {"name":"Upper 1","kind":"upper","dayOfWeek":0,"exercises":[{"exerciseId":"bb_incline","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":240},"alts":["smith_machine_incline_press","db_incline"],"warmups":3,"planNote":"A 30° or 45° bench will work here. Pause for 1 second at the bottom of each rep while maintaining tension on the pecs.","sourceName":"Barbell Incline Press"},{"exerciseId":"pec_deck","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["db_fly","cable_fly"],"warmups":2,"planNote":"Pause for 1 second at the bottom of each rep while maintaining tension on the pecs","sourceName":"Pec Deck"},{"exerciseId":"db_y_raise_incline","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_y_raise","machine_lateral"],"warmups":1,"planNote":"Use a 30° incline bench (back against the bench) and lift the weight up and out in a Y shape.","sourceName":"Incline DB Y-Raise"},{"exerciseId":"pullup__wide","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":150},"alts":["lat_pulldown_wide_grip","1_arm_cable_pulldown"],"warmups":2,"planNote":"Control the negative and feel your lats pulling apart. Full ROM!","sourceName":"Pull-Up (Wide Grip)"},{"exerciseId":"kelso_shrug","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":150},"alts":["seated_cable_kelso_shrug","kelso_shrug_db"],"warmups":2,"planNote":"Pause for about 1 second at the top and then allow your shoulder blades to peel apart on the way back down, under control.","sourceName":"Kelso Shrug"},{"exerciseId":"ez_bar_preacher_curl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["machine_preacher","dumbbell_preacher_curl"],"warmups":1,"planNote":"Keep your triceps firmly pinned against the pad as you curl. Smooth controlled reps.","sourceName":"EZ-Bar Preacher Curl"},{"exerciseId":"triceps_pressdown","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["close_grip_bench","jm_press_smith"],"warmups":1,"planNote":"You can use a rope or bar attachment for these, whichever you find more comfortable.","sourceName":"Triceps Pressdown"},{"exerciseId":"dragon_flag","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["bent_knee_dragon_flag","lying_leg_raise"],"warmups":1,"planNote":"Keep your body as rigid as possible throughout the ROM.","sourceName":"Dragon Flag"}]},
    {"name":"Lower 1","kind":"lower","dayOfWeek":1,"exercises":[{"exerciseId":"lying_leg_curl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["seated_leg_curl","nordic_curl"],"warmups":2,"planNote":"Set the machine so that you get the biggest stretch possible at the bottom. Prevent your butt from popping up as you curl.","sourceName":"Lying Leg Curl"},{"exerciseId":"back_squat","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":240},"choice":{"key":"squat","label":"Squat - your choice","options":["back_squat","front_squat","pendulum_squat","hack_squat","belt_squat","smith_squat"]},"warmups":3,"planNote":"This can be a Barbell Back Squat, Barbell Front Squat, Pendulum Squat, Hack Squat, Belt Squat, or Smith Machine Squat.","sourceName":"Squat (Your Choice)"},{"exerciseId":"smith_machine_lunge","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":180},"alts":["dumbbell_lunge","barbell_lunge"],"warmups":3,"planNote":"Minimize contribution from your back leg!","sourceName":"Smith Machine Lunge"},{"exerciseId":"leg_extension","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["reverse_nordic2","sissy_squat"],"warmups":2,"planNote":"Set the seat back as far as it will go while still feeling comfortable. Grab the handles as hard as you can to pull your butt down into the seat (using straps can help here).","sourceName":"Leg Extension"},{"exerciseId":"hip_abduction","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_abduction","standing_plate_abduction"],"warmups":1,"planNote":"If possible, place foam pads in between the outside of your knees and the pads on the machine. This will increase your range of motion on the machine.","sourceName":"Machine Hip Abduction"},{"exerciseId":"standing_calf","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["leg_press_calf","donkey_calf"],"warmups":1,"planNote":"1-2 second pause at the bottom of each rep. Instead of just going up onto your toes, think about rolling your ankle back and forth on the balls of your feet.","sourceName":"Standing Calf Raise"}]},
    {"name":"Upper 2","kind":"upper","dayOfWeek":3,"exercises":[{"exerciseId":"close_grip_lat_pulldown","target":{"sets":2,"repLow":8,"repHigh":10,"rir":1,"rirLast":0,"restSec":150},"alts":["close_grip_pull_up","1_arm_cable_pulldown"],"warmups":3,"planNote":"Lean back by ~15° and drive your elbows down as you squeeze your shoulder blades together. This should feel like a mix of lats and mid-traps.","sourceName":"Close-Grip Lat Pulldown"},{"exerciseId":"tbar_row_supported","target":{"sets":2,"repLow":8,"repHigh":10,"rir":1,"rirLast":0,"restSec":150},"alts":["chest_supported_machine_row","chest_supported_row"],"warmups":3,"planNote":"Flare elbows out at roughly 45° and squeeze your shoulder blades together hard at the top of each rep.","sourceName":"Chest-Supported T-Bar Row"},{"exerciseId":"shrug_machine","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["shrug_bb","shrug_in_cable"],"warmups":2,"planNote":"Think about shrugging \"up to your ears\". Use straps, if possible.","sourceName":"Machine Shrug"},{"exerciseId":"machine_press","target":{"sets":2,"repLow":8,"repHigh":10,"rir":1,"rirLast":0,"restSec":240},"alts":["smith_bench","db_bench"],"warmups":3,"planNote":"1 second pause at the bottom of each rep while maintaining tension on the pecs.","sourceName":"Machine Chest Press"},{"exerciseId":"high_cable_lateral_raise","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["db_lateral","machine_lateral"],"warmups":1,"planNote":"Set the cable at roughly hip height. Let your hand go slightly past your midline at the bottom of each rep to get a deep stretch on the side delt.","sourceName":"High-Cable Lateral Raise"},{"exerciseId":"1_arm_reverse_pec_deck","target":{"sets":1,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["lying_reverse_dumbbell_fly","reverse_cable_crossover"],"warmups":1,"planNote":"Sweep the weight out to create the largest semi-circle possible with your arm.","sourceName":"1-Arm Reverse Pec Deck"},{"exerciseId":"cable_crunch","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["weighted_crunch","machine_crunch2"],"warmups":1,"planNote":"Round your lower back as you crunch. Maintain a mind-muscle connection with your 6-pack.","sourceName":"Cable Crunch"}]},
    {"name":"Lower 2","kind":"lower","dayOfWeek":4,"exercises":[{"exerciseId":"leg_extension","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["reverse_nordic2","sissy_squat"],"warmups":2,"planNote":"Set the seat back as far as it will go while still feeling comfortable. Grab the handles as hard as you can to pull your butt down into the seat (using straps can help here).","sourceName":"Leg Extension"},{"exerciseId":"rdl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":2,"rirLast":1,"restSec":150},"alts":["db_rdl","seated_cable_deadlift"],"warmups":3,"planNote":"Stick your glutes straight back as you lower the bar straight down, centered over the middle of your foot. Get a nice deep stretch at the bottom, but keep your spine neutral (don't round forward).","sourceName":"Barbell RDL"},{"exerciseId":"machine_hip_thrust","target":{"sets":2,"repLow":6,"repHigh":8,"rir":1,"rirLast":0,"restSec":150},"alts":["hip_thrust","45_hyperextension"],"warmups":3,"planNote":"Squeeze your glutes hard at the top and control the weight on the way down.","sourceName":"Machine Hip Thrust"},{"exerciseId":"leg_press","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":150},"alts":["smith_squat","barbell_squat"],"warmups":3,"planNote":"Feet lower on the platform for more quad focus. Get as deep as you can without excessive back rounding.","sourceName":"Leg Press"},{"exerciseId":"standing_calf","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["leg_press_calf","donkey_calf"],"warmups":1,"planNote":"1-2 second pause at the bottom of each rep. Instead of just going up onto your toes, think about rolling your ankle back and forth on the balls of your feet.","sourceName":"Standing Calf Raise"}]},
    {"name":"Arms and delts","kind":"arms","dayOfWeek":5,"exercises":[{"exerciseId":"bayesian_curl","target":{"sets":2,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["incline_curl","standing_dumbbell_curl"],"warmups":1,"planNote":"As you curl, optionally lean forward to prevent the cable from hitting your wrist at the top. Control the negative and feel a deep stretch at the bottom of each rep.","sourceName":"Bayesian Cable Curl"},{"exerciseId":"overhead_cable_triceps_extension","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["overhead_dumbbell_triceps_extension","skull_crusher"],"warmups":1,"planNote":"Feel a deep stretch on the triceps throughout the entire negative.","sourceName":"Overhead Cable Triceps Extension"},{"exerciseId":"zottman_curl_modified","target":{"sets":1,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["hammer_curl","preacher_hammer_curl"],"warmups":1,"planNote":"Hammer curl on the way up and supinated curl (palms up) on the way down.","sourceName":"Modified Zottman Curl"},{"exerciseId":"cable_kickback_tri","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["dip_machine","close_grip_dip"],"warmups":1,"planNote":"Keep your upper arm behind your torso throughout the ROM.","sourceName":"Cable Triceps Kickback"},{"exerciseId":"wrist_curl","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_wrist_curl"],"warmups":1,"planNote":"Smooth, controlled reps.","sourceName":"DB Wrist Curl"},{"exerciseId":"dumbbell_wrist_extension","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["cable_wrist_extension"],"warmups":1,"planNote":"Smooth, controlled reps.","sourceName":"DB Wrist Extension"},{"exerciseId":"alternating_dumbbell_curl","target":{"sets":1,"repLow":6,"repHigh":8,"rir":0,"rirLast":0,"restSec":90},"alts":["bb_curl","ez_curl"],"warmups":1,"planNote":"Slow, controlled reps!","sourceName":"Alternating DB Curl"},{"exerciseId":"machine_lateral","target":{"sets":2,"repLow":8,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"alts":["high_cable_lateral_raise","db_lateral"],"warmups":1,"planNote":"Focus on squeezing your side delt to move the weight.","sourceName":"Machine Lateral Raise"},{"exerciseId":"dead_hang","target":{"sets":2,"repLow":6,"repHigh":10,"rir":0,"rirLast":0,"restSec":90},"warmups":1,"planNote":"Try to add a few more seconds each week!","sourceName":"Dead Hang (optional)"}]}
  ] }
];

  function programmeOf(key) {
    var found = PROGRAMMES.filter(function (p) { return p.key === key; });
    return found.length ? found[0] : null;
  }
  // A fresh block off one of them. Fresh every call - new block id, new session ids - so starting the
  // same programme twice is two blocks rather than one overwriting the other.
  function programmeBlock(key, opts) {
    opts = opts || {};
    var p = programmeOf(key);
    if (!p) return null;
    var block = blockFromTemplate(p.template, {
      // as-written, because this IS the plan: no set added per week, no trimming to our own
      // ceilings, and the effort target on every line is the one the programme states.
      weeks: opts.weeks || 4, shape: 'as-written', style: 'minmax',
      daysPerWeek: p.daysPerWeek, intensity: 'high', goal: 'hypertrophy',
      name: opts.name || p.name, custom: opts.custom, startISO: opts.startISO || null,
      source: 'programme', sourceRef: { kind: 'programme', name: p.key },
    });
    block.archived = false;
    block.shared = false;
    return block;
  }
  // What to say about one on a card, without hard-coding numbers that would rot the moment a sheet
  // changes: read them off the programme itself.
  function programmeSummary(key, custom) {
    var p = programmeOf(key);
    if (!p) return null;
    var sets = p.template.reduce(function (a, d) {
      return a + d.exercises.reduce(function (b, e) { return b + (e.target.sets || 0); }, 0);
    }, 0);
    var moves = p.template.reduce(function (a, d) { return a + d.exercises.length; }, 0);
    return {
      key: p.key, name: p.name, daysPerWeek: p.daysPerWeek, weeks: 4,
      sets: sets, movements: moves,
      dayNames: p.template.map(function (d) { return d.name; }),
      volume: plannedVolume(p.template, custom),
    };
  }

  /* ---- loading a block somebody already owns ----------------------------------------------------
   * A plan bought as a spreadsheet, converted once (see tools/minmax-import.mjs) and loaded straight
   * in. No model, no guessing, and nothing published: the file lands in the person's own blocks and
   * goes no further, which is the only sane way to handle a plan they paid somebody else for.
   *
   * Everything is re-minted on the way in - block id, session ids, exercise line ids - because two
   * imports of the same file, or a file somebody edited by hand, must not collide with what is
   * already on the shelf or with each other. Anything pointing at a movement this library does not
   * have is reported rather than dropped in silence.
   */
  function blocksFromFile(json, opts) {
    opts = opts || {};
    var problems = [];
    var doc = json;
    if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { throw new Error('That is not a block file: ' + e.message); } }
    var list = doc && doc.blocks ? doc.blocks : (doc && doc.sessions ? [doc] : null);
    if (!list || !list.length) throw new Error('That file has no blocks in it.');
    var stamp = Date.now().toString(36);
    var out = list.map(function (b, bi) {
      if (!b || !b.sessions || !b.sessions.length) { problems.push('A block in the file had no sessions.'); return null; }
      var id = 'blk_' + stamp + '_' + bi + Math.random().toString(36).slice(2, 5);
      var sessions = b.sessions.map(function (s, si) {
        var exercises = (s.exercises || []).map(function (e, ei) {
          if (!byId(e.exerciseId, opts.custom)) {
            problems.push((e.sourceName || e.exerciseId) + ' is not in the library');
            return null;
          }
          var t = e.target || {};
          return {
            id: id + '_s' + si + '_e' + ei,
            exerciseId: e.exerciseId, order: e.order == null ? ei : e.order,
            sourceName: e.sourceName || null,
            choice: e.choice || null, alts: e.alts || null,
            technique: e.technique || null, planNote: e.planNote || null,
            warmups: e.warmups == null ? null : clamp(Math.round(+e.warmups), 0, 6),
            supersetGroup: e.supersetGroup || null,
            target: {
              sets: clamp(+t.sets || 2, SETS_MIN, SETS_MAX),
              repLow: clamp(+t.repLow || 6, REPS_MIN, REPS_MAX),
              repHigh: clamp(+t.repHigh || 10, REPS_MIN, REPS_MAX),
              rir: clamp(t.rir == null ? 1 : +t.rir, 0, RIR_MAX),
              rirLast: clamp(t.rirLast == null ? (t.rir == null ? 0 : +t.rir) : +t.rirLast, 0, RIR_MAX),
              restSec: clamp(+t.restSec || 120, 30, 600),
              tempo: t.tempo || null,
            },
          };
        }).filter(Boolean);
        return {
          id: id + '_s' + si, week: +s.week || 1,
          dayOfWeek: clamp(+s.dayOfWeek || 0, 0, 6),
          name: s.name || ('Day ' + (si + 1)), kind: s.kind || 'full', deload: !!s.deload,
          exercises: exercises,
        };
      }).filter(function (s) { return s.exercises.length; });
      if (!sessions.length) { problems.push('Nothing in "' + (b.name || 'a block') + '" could be read.'); return null; }
      return {
        id: id, name: b.name || 'Imported block', goal: b.goal || 'hypertrophy',
        weeks: Math.max.apply(null, sessions.map(function (s) { return s.week; })),
        shape: SHAPES[b.shape] ? b.shape : 'as-written',
        style: STYLES[b.style] ? b.style : null,
        daysPerWeek: b.daysPerWeek || uniq(sessions.filter(function (s) { return s.week === 1; }).map(function (s) { return s.dayOfWeek; })).length,
        intensity: b.intensity || 'high',
        startISO: null, archived: false, shared: false,
        source: 'file', sourceRef: b.sourceRef || { kind: 'file', name: opts.fileName || 'a block file' },
        sessions: sessions,
      };
    }).filter(Boolean);
    if (!out.length) throw new Error('Nothing in that file could be read as a block.');
    return { blocks: out, problems: uniq(problems) };
  }

  /* ---- a block, stored small ---------------------------------------------------------------------
   * A block holds every week in full: twelve weeks of a five-day programme is sixty sessions, and
   * eighty-three percent of what gets written to disk is weeks two to six repeating week one. The
   * whole state blob is rewritten on every save - Postgres cannot update a TOASTed value in place,
   * so each save costs its full size in dead rows - and that churn is already the biggest thing in
   * this database. Two imported programmes were 269KB of it.
   *
   * So a block is packed for storage and expanded on read. What varies between weeks is tiny and, as
   * it turns out, always the same handful of things: the ids, the week number, and one or two target
   * fields. Everything else is week one repeated. Rather than name those fields - a list that would
   * rot the first time a new one is added - the pack diffs generically: any key whose value differs
   * from the template's is carried, and everything else is inherited.
   *
   * The safety property that makes this worth doing at all: nothing is ever stored in a form we
   * cannot reproduce. packBlock unpacks its own output and compares it to what it was given, and
   * hands back the original block untouched if they differ by so much as a key. A block that cannot
   * be packed losslessly is simply stored as it always was.
   */
  function canonOf(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonOf).join(',') + ']';
    var keys = Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonOf(v[k]); }).join(',') + '}';
  }
  // Keys whose value differs between a template entry and a later one, plus the keys the later one
  // has dropped. `skip` is for the sub-objects handled separately (a session's exercises, an
  // exercise's target), which are diffed on their own terms rather than as opaque blobs.
  function diffKeys(base, other, skip) {
    var out = null, dropped = null;
    Object.keys(other).forEach(function (k) {
      if (skip && skip[k]) return;
      if (canonOf(other[k]) === canonOf(base[k])) return;
      (out = out || {})[k] = other[k];
    });
    Object.keys(base).forEach(function (k) {
      if ((skip && skip[k]) || k in other) return;
      (dropped = dropped || []).push(k);
    });
    if (dropped) (out = out || {}).__drop = dropped;
    return out;
  }
  function applyDiff(base, diff) {
    var out = JSON.parse(JSON.stringify(base));
    if (!diff) return out;
    ((diff.__drop) || []).forEach(function (k) { delete out[k]; });
    Object.keys(diff).forEach(function (k) { if (k !== '__drop') out[k] = diff[k]; });
    return out;
  }

  function packBlock(block) {
    if (!block || block.packed || !block.sessions || block.sessions.length < 2) return block;
    var byWeek = {}, weeks = [];
    block.sessions.forEach(function (s) {
      var w = s.week || 1;
      if (!byWeek[w]) { byWeek[w] = []; weeks.push(w); }
      byWeek[w].push(s);
    });
    weeks.sort(function (a, b) { return a - b; });
    if (weeks.length < 2) return block;
    var template = byWeek[weeks[0]];
    var rest = [];
    for (var i = 1; i < weeks.length; i++) {
      var list = byWeek[weeks[i]];
      if (list.length !== template.length) return block;         // not the same week twice: leave it
      var sessions = [];
      for (var si = 0; si < list.length; si++) {
        var t = template[si], s2 = list[si];
        if ((t.exercises || []).length !== (s2.exercises || []).length) return block;
        var d = diffKeys(t, s2, { exercises: 1 }) || {};
        var ex = (s2.exercises || []).map(function (e, ei) {
          var te = t.exercises[ei];
          var ed = diffKeys(te, e, { target: 1 });
          var td = diffKeys(te.target || {}, e.target || {}, null);
          if (td) (ed = ed || {}).target = td;
          return ed;
        });
        if (ex.some(Boolean)) d.ex = ex;
        sessions.push(Object.keys(d).length ? d : null);
      }
      rest.push({ week: weeks[i], sessions: sessions });
    }
    var packed = Object.assign({}, block, { packed: 1, template: template, weekDiffs: rest });
    delete packed.sessions;
    // The whole bet, checked rather than assumed.
    if (canonOf(unpackBlock(packed)) !== canonOf(block)) return block;
    return packed;
  }

  function unpackBlock(block) {
    if (!block || !block.packed) return block;
    var sessions = (block.template || []).slice();
    // The sub-objects are rebuilt on their own terms, so they are lifted OUT of the diff rather than
    // set to undefined on it: a key holding undefined is still a key, and a block that comes back
    // carrying `ex: undefined` is not the block that went in however identical it looks printed.
    var without = function (obj, key) {
      if (!obj) return null;
      var out = null;
      Object.keys(obj).forEach(function (k) { if (k !== key) (out = out || {})[k] = obj[k]; });
      return out;
    };
    (block.weekDiffs || []).forEach(function (wk) {
      (block.template || []).forEach(function (t, si) {
        var d = (wk.sessions || [])[si];
        var s = applyDiff(t, without(d, 'ex'));
        s.week = (d && d.week) || wk.week;
        s.exercises = (t.exercises || []).map(function (te, ei) {
          var ed = d && d.ex ? d.ex[ei] : null;
          var e = applyDiff(te, without(ed, 'target'));
          var td = ed && ed.target;
          if (td || te.target) e.target = applyDiff(te.target || {}, td);
          return e;
        });
        sessions.push(s);
      });
    });
    var out = Object.assign({}, block, { sessions: sessions });
    delete out.packed; delete out.template; delete out.weekDiffs;
    return out;
  }

  // The two above, over a whole account's blocks. This is what the storage layer calls.
  function packBlocks(blocks) { return (blocks || []).map(packBlock); }
  function unpackBlocks(blocks) { return (blocks || []).map(unpackBlock); }

  // ---- sharing -------------------------------------------------------------------------------
  // Pull the week-1 template back out of a built block. This is what gets shared, NOT the expanded
  // four weeks: whoever runs it next re-periodises against their own landmarks, so an advanced
  // lifter's block cannot drop 25 weekly sets on a beginner. The author's day names, movements,
  // rep ranges and set counts all survive; only the week-on-week build is recomputed.
  function templateOf(block) {
    return weekSessions(block, 1).slice().sort(function (a, b) { return a.dayOfWeek - b.dayOfWeek; })
      .map(function (s, i) {
        return {
          name: s.name, kind: s.kind || 'full', dayOfWeek: s.dayOfWeek == null ? i : s.dayOfWeek,
          exercises: (s.exercises || []).slice().sort(function (a, b) { return a.order - b.order; })
            .map(function (e, ei) {
              return {
                id: e.exerciseId + '_t' + i + '_' + ei, exerciseId: e.exerciseId, order: ei,
                // The parts of a movement that belong to its AUTHOR rather than to the week it sat
                // in: a slot they left open, the substitutions they wrote, the technique they asked
                // for on the last set. Dropping these was how a shared min-max block arrived as a
                // volume-model block wearing its movements.
                choice: e.choice || null, alts: e.alts || null, technique: e.technique || null,
                warmups: e.warmups || null, planNote: e.planNote || null, sourceName: e.sourceName || null,
                target: {
                  sets: e.target.sets, repLow: e.target.repLow, repHigh: e.target.repHigh,
                  // Week 1's RIR is the author's starting effort. The receiving block walks it down
                  // again from there, so carrying week 3's RIR would start someone at 1 RIR.
                  rir: e.target.rir, rirLast: e.target.rirLast == null ? null : e.target.rirLast,
                  restSec: e.target.restSec, tempo: e.target.tempo || null,
                },
              };
            }),
        };
      });
  }

  /* What gets published, and how it is read back.
   *
   * The shared library's template column has always been a bare array of days, and a block's STYLE
   * has nowhere to live in that - so every block published from this app arrived at whoever adopted
   * it as a volume-model block, however it had been written. Rather than a migration for one field,
   * the payload is versioned in the column it already has: an array is the old shape and still
   * reads, an object is the new one and carries the style with the days.
   */
  function templatePayload(block) {
    return { v: 2, style: (block && block.style) || null, days: templateOf(block) };
  }
  function templateDays(payload) {
    if (Array.isArray(payload)) return payload;                 // everything published before v2
    return (payload && payload.days) || [];
  }
  function templateStyle(payload) {
    return (payload && !Array.isArray(payload) && payload.style) || null;
  }

  // What kind of split a template is, so the library can be filtered by it. Read off what each day
  // actually trains rather than trusting the author's day names, because "Push A" is sometimes a
  // full-body session and the label would lie.
  function splitKind(template, custom) {
    var days = (template || []).length;
    if (!days) return 'other';
    var kinds = (template || []).map(function (day) {
      var vol = plannedVolume([day], custom);
      var upper = ['ch', 'fd', 'sd', 'rd', 'lt', 'ub', 'bi', 'tr'].reduce(function (a, m) { return a + (vol[m] || 0); }, 0);
      var lower = ['qu', 'ha', 'gl', 'ca', 'ad'].reduce(function (a, m) { return a + (vol[m] || 0); }, 0);
      // Full body means both halves get real work, not that they get EQUAL work. A ratio test fails
      // here: a genuine full-body day is usually upper-heavy simply because there are more upper
      // muscles to cover, and it would get filed as an upper day on that alone.
      if (upper >= 4 && lower >= 4) return 'full';
      if (lower > upper) return 'lower';
      // An upper day that is nearly all pressing is a push day; nearly all pulling, a pull day.
      var push = ['ch', 'fd', 'sd', 'tr'].reduce(function (a, m) { return a + (vol[m] || 0); }, 0);
      var pull = ['lt', 'ub', 'rd', 'bi'].reduce(function (a, m) { return a + (vol[m] || 0); }, 0);
      if (push > 0 && pull > 0 && Math.min(push, pull) / Math.max(push, pull) > 0.4) return 'upper';
      return push > pull ? 'push' : 'pull';
    });
    var has = function (k) { return kinds.indexOf(k) !== -1; };
    if (kinds.every(function (k) { return k === 'full'; })) return 'full';
    if (has('push') && has('pull') && has('lower')) return 'ppl';
    if (has('upper') && has('lower') && !has('push') && !has('pull')) return 'upper_lower';
    return 'other';
  }

  // Take someone else's template and make it yours: swap out anything your equipment cannot do, then
  // rebuild the four weeks against YOUR volume landmarks. Returns the block plus a list of what was
  // changed, because a silent substitution is how you end up doing a movement you never chose.
  function adoptTemplate(template, opts) {
    opts = opts || {};
    if (opts.gym) {
      var ag = gymEquipment(opts.gym);
      opts = Object.assign({}, opts, {
        equipment: opts.equipment || ag.equipment,
        dislikes: (opts.dislikes || []).concat(ag.excluded),
      });
    }
    var have = opts.equipment && opts.equipment.length ? opts.equipment : null;
    var dislikes = {}; (opts.dislikes || []).forEach(function (d) { dislikes[d] = 1; });
    var swaps = [];
    var adapted = (template || []).map(function (day, di) {
      var used = {};
      (day.exercises || []).forEach(function (e) { used[e.exerciseId] = 1; });
      var exercises = [];
      (day.exercises || []).forEach(function (item, ei) {
        var ex = byId(item.exerciseId, opts.custom);
        if (!ex) return;                                    // a movement we no longer know: drop it
        var blocked = (have && have.indexOf(ex.equipment) === -1) || dislikes[ex.id];
        if (!blocked) { exercises.push(Object.assign({}, item, { order: exercises.length })); return; }
        // Find the nearest thing that trains the same primary muscles with kit you have.
        var alt = null;
        var wanted = ex.primary || [];
        for (var w = 0; w < wanted.length && !alt; w++) {
          var cands = suggestFor(wanted[w], {
            equipment: opts.equipment, dislikes: opts.dislikes, custom: opts.custom,
            currentExerciseIds: Object.keys(used), limit: 3,
          });
          if (cands.length) alt = cands[0];
        }
        if (!alt) { swaps.push({ from: ex.name, to: null, day: day.name }); return; }
        used[alt.id] = 1;
        swaps.push({ from: ex.name, to: alt.name, day: day.name });
        // A swapped movement cannot keep the author's choice list - that list was about the movement
        // they wrote, not the one your gym forced - but the technique and the substitutions still
        // describe the SLOT, so they travel.
        exercises.push(Object.assign({}, item, { id: alt.id + '_a' + di + '_' + ei, exerciseId: alt.id, order: exercises.length, choice: null }));
      });
      return Object.assign({}, day, { exercises: exercises });
    }).filter(function (d) { return d.exercises.length > 0; });

    var block = blockFromTemplate(adapted, Object.assign({}, opts, { source: opts.source || 'library' }));
    return { block: block, swaps: swaps };
  }

  // ---- a brought plan, read as inspiration ------------------------------------------------------
  // What is worth keeping out of somebody else's programme, and what is not.
  //
  // Worth keeping: the MOVEMENTS they chose, in the order they chose them, and the rep range and
  // tempo they wrote against each one. That is the character of a plan and the part no engine can
  // derive - it encodes the kit in their gym, the variations their joints tolerate, and what their
  // coach built the session around. Worth keeping too: which muscles the plan clearly prioritised,
  // read off its own weekly volume against the person's landmarks rather than guessed at.
  //
  // Not worth keeping: how many days it happened to be photographed across, how many sets its author
  // wrote for somebody else's recovery, and whether it trains every muscle twice a week. Those are
  // the parts this engine is for, and they are what the person asked for when they picked a day count
  // and an intensity. So the day count comes from the wizard, the volume comes from the landmarks,
  // the progression and the walk to failure come from the block shape - and the movements come from
  // them. "As brought" is how somebody says they want the photocopy instead.
  function inspirationFrom(template, opts) {
    opts = opts || {};
    var pool = [], seen = {}, prescriptions = {};
    (template || []).forEach(function (day) {
      (day.exercises || []).forEach(function (item) {
        var ex = byId(item.exerciseId, opts.custom);
        if (!ex || seen[ex.id]) return;
        seen[ex.id] = 1;
        pool.push(ex.id);
        prescriptions[ex.id] = item.target || null;
      });
    });
    // What the plan pushed. Measured against the person's OWN landmarks, not against the other
    // muscles in the plan: a muscle sitting at or past its productive band is the author saying this
    // is what the block is for, and it is the one thing about their volume worth carrying over.
    var vol = plannedVolume(template, opts.custom);
    var targets = targetsFor(opts);
    var emphasis = MUSCLES.filter(function (m) {
      return targets[m] && vol[m] && vol[m] >= targets[m].mav;
    }).sort(function (a, b) {
      return (vol[b] / targets[b].mav) - (vol[a] / targets[a].mav);
    }).slice(0, 4);
    return { pool: pool, prescriptions: prescriptions, emphasis: emphasis, days: (template || []).length };
  }

  // Build a 4-week block from scratch. Week 1 sits near MEV on 2 working sets a movement, not 3:
  // start on intensity, not volume. Weeks 2 and 3 add a set to the muscles that most need it, week 4
  // is the deload (or not, depending on shape). RIR walks 3-2-1-0, reaching true failure by the last
  // building week. Every muscle is guaranteed at least two sessions a week before volume is topped
  // up, so the extra stimulus a muscle needs comes from another low-volume exposure, not from piling
  // more sets into the one session that already trains it.
  function generateBlock(opts) {
    opts = opts || {};
    // A gym profile is just a tidier way of saying equipment + preferences, so resolve it once here
    // and everything downstream keeps working on the plain fields it always used.
    if (opts.gym) {
      var g = gymEquipment(opts.gym);
      opts = Object.assign({}, opts, {
        equipment: opts.equipment || g.equipment,
        prefer: g.prefer,
        excluded: (opts.excluded || []).concat(g.excluded),
        repBias: g.repBias,
      });
    }
    var days = clamp(opts.daysPerWeek || 4, 2, 6);
    var weeks = opts.weeks || 4;
    var shape = SHAPES[opts.shape] ? opts.shape : 'build4';
    var iv = intensityOf(opts.intensity);
    var style = styleOf(opts.style);
    // One or two working sets, and never a third, is not a starting point on this style - it is the
    // prescription. Everything below that would otherwise add a set adds a movement or nothing.
    var startSets = style.startSets || iv.startSets;
    // Anything brought in is read for its movements and its priorities, and for nothing else. The
    // split below is still ours and still sized to the day count the person asked for.
    var insp = (opts.inspiration && opts.inspiration.length)
      ? inspirationFrom(opts.inspiration, opts) : null;
    // What they said they want brought up, plus what the plan they brought was plainly built around.
    // Theirs first: an explicit answer to a question on screen outranks something read off a PDF.
    var wants = uniq((opts.emphasis || []).concat(insp ? insp.emphasis : []));
    var targets = wants.length
      ? emphasise(targetsFor(opts), wants)
      : targetsFor(opts);
    // The split, and where in the week it falls. Min-max carries its own weekdays because the rest
    // days are part of the prescription; everything else runs on consecutive days as it always has.
    var split = (style.toFailure && MINMAX_SPLITS[days]) || SPLITS[days];
    var dayPlan = defaultDows(days);
    // 45 to 60 minutes and about six movements. Sets are the thing being spent sparingly on this
    // style, so a session that runs long is a session with filler in it.
    var maxEx = opts.sessionMinutes
      ? clamp(Math.floor(opts.sessionMinutes / 9), style.minEx, style.maxExCap)
      : (style.toFailure ? 6 : 6);
    var pickOpts = {
      equipment: opts.equipment, dislikes: opts.dislikes, excluded: opts.excluded,
      prefer: opts.prefer, custom: opts.custom, preferIds: insp ? insp.pool : null,
      stableKit: !!style.stableKit,
    };
    // On a style where a session is meant to be six movements and 45 minutes, maxEx is a ceiling
    // rather than a first pass: the frequency and MEV fillers below must not quietly add a ninth
    // movement to a day. On the volume model they still may, which is the behaviour it has always
    // had - there the movements are the cheap thing and the sets are what is being rationed.
    // The fillers may go one past the session's own target when a muscle is genuinely short, which
    // is where "5 to 7 movements" comes from: six is the shape, seven is what covering everything
    // occasionally costs.
    var hardCap = style.toFailure ? Math.max(maxEx, style.maxExCap) : Infinity;
    // Reps, rest and tempo for a movement once it has been chosen. A movement they brought keeps the
    // prescription their plan wrote against it - the rep range and the tempo ARE the plan's character,
    // and re-deriving them from a muscle name throws that away for nothing. Sets and proximity to
    // failure are never theirs to set: those are the two things that have to answer to the person's
    // own landmarks and to the week of the block they are standing in.
    function schemeFor(ex, muscle, window) {
      var rs = repScheme(ex, muscle, opts.repBias, opts.intensity, style, window);
      var src = insp && insp.prescriptions[ex.id];
      if (!src) return rs;
      var lo = clamp(+src.repLow || rs.repLow, 1, 40);
      var hi = clamp(Math.max(+src.repHigh || rs.repHigh, lo + 1), 2, 50);
      return { repLow: lo, repHigh: hi, restSec: +src.restSec || rs.restSec, tempo: src.tempo || null };
    }

    // Week 1 template: for each day, pick movements for the muscles it owns until the session is
    // full, then set the sets so the WEEKLY total for each muscle lands at or just above MEV.
    var used = {};
    var template = split.map(function (d, i) {
      var kind = d[0], name = d[1], window = d[3] || null;
      // Each style seeds a day from its own list. They genuinely differ: adductors have a slot on a
      // lower day under the volume model and none at all under min-max, where the squat pays them,
      // and forearms have one on the arms day under min-max and nowhere under the other.
      var muscles = (style.toFailure && MINMAX_DAY_MUSCLES[kind]) || DAY_MUSCLES[kind];
      var exercises = [];
      for (var m = 0; m < muscles.length && exercises.length < maxEx; m++) {
        var ex = pickFor(muscles[m], Object.assign({ used: used }, pickOpts));
        if (!ex) continue;
        used[ex.id] = 1;
        var rs = schemeFor(ex, muscles[m], window);
        var ef = minmaxEffort(ex, startSets, false);
        exercises.push({
          id: ex.id + '_' + i + '_' + exercises.length,
          exerciseId: ex.id, order: exercises.length,
          target: Object.assign({ sets: startSets, repLow: rs.repLow, repHigh: rs.repHigh, rir: style.toFailure ? ef.rir : 3, restSec: rs.restSec, tempo: rs.tempo || defaultTempo(ex) },
            style.toFailure ? { rirLast: ef.rirLast } : {}),
        });
      }
      // Min-max carries its own weekdays in the split, because the rest days are part of that
      // prescription. Everything else takes the recommended week (DEFAULT_DOW) rather than landing on
      // consecutive days, which was never a decision - it was the array index showing through.
      return { kind: kind, name: name, dayOfWeek: d[2] == null ? (dayPlan[i] == null ? i : dayPlan[i]) : d[2], window: window, exercises: exercises };
    });

    // Frequency floor: every muscle at least twice a week, before volume gets topped up at all.
    // "At least twice weekly" is the sensible default the frequency literature converges on
    // (Schoenfeld, Grgic & Krieger 2019), and it matters more here than usual, because a split's day
    // types (DAY_MUSCLES) do not seed every muscle in every session type - abs, obliques, lower back
    // and forearms in particular can otherwise end up confined to whichever single session the MEV
    // gap-filler below happens to reach for first. Run this BEFORE that pass, so a muscle needing
    // more volume gets a second low-set exposure on another day rather than a bigger single session.
    function sessionsTraining(m) {
      return template.filter(function (d) {
        return d.exercises.some(function (item) {
          var exx = byId(item.exerciseId, opts.custom);
          return exx && (exx.primary || []).indexOf(m) !== -1;
        });
      });
    }
    if (days >= 2) {
      MUSCLES.forEach(function (m) {
        // A muscle the style does not programme directly (MEV of nought - obliques, adductors,
        // lower back, forearms under min-max) gets no frequency guarantee either. Guaranteeing one
        // is how a five-movement lower day ended up spending two of those movements on a side plank
        // and a Copenhagen plank while quads took four sets for the week.
        if (!(targets[m] && targets[m].mev > 0)) return;
        // Keep adding, not just once: a muscle no DAY_MUSCLES list seeds at all (front delts,
        // forearms) starts from zero sessions, and a single top-up only gets it to one.
        for (var guard = 0; guard < 2; guard++) {
          var trainedIn = sessionsTraining(m);
          if (trainedIn.length >= 2) break;
          var spare = template.filter(function (d) { return trainedIn.indexOf(d) === -1 && d.exercises.length < hardCap; })
            .sort(function (a, b) { return a.exercises.length - b.exercises.length; });
          // Prefer a day whose kind this muscle actually belongs on. Only fall back to any spare day
          // (still correct, just a less tidy label) when the split has nowhere else free.
          var home = DAY_KIND_HOME[m];
          var onKind = home ? spare.filter(function (d) { return home[d.kind]; }) : spare;
          // Falling back to any day with room is fine on the volume model, where a movement is the
          // cheap thing and a slightly untidy label is the whole cost. On a style with five or six
          // movements in a session it is not: a glute bridge on the arms and delts day spends one
          // of five on work that day is not for. There, a muscle with nowhere sensible to go waits.
          var dest = (onKind.length ? onKind : (style.toFailure ? [] : spare))[0];
          if (!dest) break;
          var exf = pickFor(m, Object.assign({ used: used }, pickOpts));
          if (!exf) break;
          used[exf.id] = 1;
          var rsf = schemeFor(exf, m, dest.window);
          var eff = minmaxEffort(exf, startSets, false);
          dest.exercises.push({
            id: exf.id + '_freq' + guard + '_' + dest.exercises.length, exerciseId: exf.id, order: dest.exercises.length,
            target: Object.assign({ sets: startSets, repLow: rsf.repLow, repHigh: rsf.repHigh, rir: style.toFailure ? eff.rir : 3, restSec: rsf.restSec, tempo: rsf.tempo || defaultTempo(exf) },
              style.toFailure ? { rirLast: eff.rirLast } : {}),
          });
        }
      });
    }

    // Everything they brought that has not found a slot yet, placed rather than dropped.
    //
    // Somebody who uploads a coach's programme has handed over a list of choices. Keeping only the
    // ones that happen to fall out of a split's own shape - one movement per muscle per day, capped
    // by how long they said a session runs - throws most of that away silently, and the movements it
    // throws away are the interesting ones: the second chest movement, the machine their gym has, the
    // variation somebody wrote in for a reason. So each unused one is put on the day it belongs to.
    //
    // This runs BEFORE the MEV pass below on purpose, so the volume that pass hands out lands on
    // THEIR movements rather than on ones we picked to fill a gap they had already filled. And it
    // does not need a volume opinion of its own: everything goes in at the same starting sets as
    // anything else, and trimToMRV shaves back anything that pushes a muscle past its ceiling.
    //
    // The one thing it will not do is put the same movement in twice under two spellings, which is
    // the actual cost of being lenient here - "Incline DB press" and "DB incline press" are one
    // movement, and a plan carrying both is a plan that looks like it was assembled by a machine.
    var spare = [];
    if (insp && opts.keepBrought !== false) {
      var roomCap = style.toFailure ? maxEx + 2 : maxEx + 4;
      // Lenient about which of their movements to keep, never about what they can actually do. A
      // movement needing kit this gym has not got, or one they have said no to, is not made an
      // exception of because a PDF used it - the same rule the picking above works to.
      var haveKit = opts.equipment && opts.equipment.length ? opts.equipment : null;
      var noKit = {};
      (opts.dislikes || []).concat(opts.excluded || []).forEach(function (d) { noKit[d] = 1; });
      insp.pool.forEach(function (id) {
        if (used[id]) return;
        var exb = byId(id, opts.custom);
        if (!exb) return;
        if (noKit[exb.id] || (haveKit && haveKit.indexOf(exb.equipment) === -1)) { spare.push(id); return; }
        var have = template.some(function (d) {
          return d.exercises.some(function (item) {
            var x = byId(item.exerciseId, opts.custom);
            return x && (x.id === exb.id || sameMovement(x.name, exb.name));
          });
        });
        if (have) { used[id] = 1; return; }
        var prim = (exb.primary || []);
        // The days this movement actually belongs on: the ones whose kind owns one of its muscles,
        // or that DAY_KIND_HOME says are a sane home for a muscle no split seeds directly. Core work
        // (home null) belongs anywhere, which is true of it.
        var homes = template.filter(function (d) {
          return prim.some(function (m) {
            var home = DAY_KIND_HOME[m];
            return (DAY_MUSCLES[d.kind] || []).indexOf(m) !== -1 || (home === null) || (home && home[d.kind]);
          });
        });
        var dest2 = (homes.length ? homes : template)
          .filter(function (d) { return d.exercises.length < roomCap; })
          .sort(function (a, b) { return a.exercises.length - b.exercises.length; })[0];
        // Nowhere left with room. Kept as a note ON the block rather than forgotten, so the screen
        // can say which of their movements did not make it instead of quietly being a shorter plan.
        if (!dest2) { spare.push(id); return; }
        used[id] = 1;
        var rsb = schemeFor(exb, prim[0], dest2.window);
        var efb = minmaxEffort(exb, startSets, false);
        dest2.exercises.push({
          id: exb.id + '_brought_' + dest2.exercises.length, exerciseId: exb.id, order: dest2.exercises.length,
          target: Object.assign({ sets: startSets, repLow: rsb.repLow, repHigh: rsb.repHigh, rir: style.toFailure ? efb.rir : 3, restSec: rsb.restSec, tempo: rsb.tempo || defaultTempo(exb) },
            style.toFailure ? { rirLast: efb.rirLast } : {}),
        });
      });
    }

    // Nudge week 1 to MEV: while a muscle is short, add a set to the exercise that serves it best.
    // Starting at 2 sets a movement instead of 3 means more muscles start further from MEV, so this
    // needs more passes than it used to - and a muscle the library has genuinely run out of
    // candidates for must be set aside, not allowed to abort the pass for every OTHER muscle still
    // waiting its turn.
    // Which line of the landmarks this style builds to. See STYLES.minmax.aim: a model that climbs
    // across the block aims at the floor and grows into the rest; one that prescribes the same four
    // weeks throughout has to aim where it means to end up.
    var aimAt = style.aim === 'mav' ? 'mav' : 'mev';
    function shortfalls() {
      var vol = plannedVolume(template, opts.custom);
      return MUSCLES.filter(function (m) {
        var L = targets[m];
        // MEV of nought means the style does not programme this one directly (see MINMAX_LANDMARKS),
        // so it is never short: it takes what the squat, the hinge and the row pay it and no
        // movement is ever spent on it.
        return L && L.mev > 0 && L[aimAt] > 0 && (vol[m] || 0) < L[aimAt] && !stuck[m];
      }).map(function (m) {
        return { muscle: m, short: targets[m][aimAt] - (plannedVolume(template, opts.custom)[m] || 0) };
      }).sort(function (a, b) { return b.short - a.short; });
    }
    var stuck = {};
    for (var pass = 0; pass < 40; pass++) {
      var gaps = shortfalls();
      if (!gaps.length) break;
      var gap = gaps[0];
      var addedThisPass = false;
      for (var s = 0; s < template.length && !addedThisPass; s++) {
        for (var e = 0; e < template[s].exercises.length; e++) {
          var item = template[s].exercises[e];
          var exx = byId(item.exerciseId, opts.custom);
          if (exx && (exx.primary || []).indexOf(gap.muscle) !== -1 && item.target.sets < style.maxSets) {
            item.target.sets++; addedThisPass = true; break;
          }
        }
      }
      // Nothing in the plan trains it, so add a movement to the shortest session.
      if (!addedThisPass) {
        var ex2 = pickFor(gap.muscle, Object.assign({ used: used }, pickOpts));
        if (!ex2) { stuck[gap.muscle] = true; continue; }
        used[ex2.id] = 1;
        // The shortest day this muscle actually BELONGS on. Taking the shortest day outright is how
        // a pendulum squat landed on an upper day and a trap bar deadlift on arms and delts: the day
        // with room is not the same question as the day the work goes on, and a split whose "Upper"
        // session opens with a squat is not an upper/lower split any more.
        var roomy = template.filter(function (d) { return d.exercises.length < hardCap; })
          .sort(function (a, b) { return a.exercises.length - b.exercises.length; });
        var home2 = DAY_KIND_HOME[gap.muscle];
        var onKind2 = home2 ? roomy.filter(function (d) { return home2[d.kind] || (DAY_MUSCLES[d.kind] || []).indexOf(gap.muscle) !== -1; }) : roomy;
        // No day this belongs on has room. Leave it short rather than put it somewhere it does not
        // belong: a glute bridge on the arms and delts day is not four sets of glutes, it is a
        // session that no longer means what its name says.
        var shortest = onKind2[0];
        if (!shortest) { stuck[gap.muscle] = true; continue; }
        var rs2 = schemeFor(ex2, gap.muscle, shortest.window);
        var ef2 = minmaxEffort(ex2, startSets, false);
        shortest.exercises.push({
          id: ex2.id + '_add_' + shortest.exercises.length, exerciseId: ex2.id, order: shortest.exercises.length,
          target: Object.assign({ sets: startSets, repLow: rs2.repLow, repHigh: rs2.repHigh, rir: style.toFailure ? ef2.rir : 3, restSec: rs2.restSec, tempo: rs2.tempo || defaultTempo(ex2) },
            style.toFailure ? { rirLast: ef2.rirLast } : {}),
        });
      }
    }

    /* Order, warm-ups and the opener's rest - stamped once every pass has finished adding.
     *
     * DAY_MUSCLES puts the big compound first and says so in its own comment, but that only held
     * until a filler appended something: a day could open with a cable fly and finish with a leg
     * press, which is the fatiguing work done last and the freshest work spent on the smallest
     * movement. The written programmes are unambiguous about this - every session opens with its
     * heaviest compound, three warm-up sets and four minutes' rest, and descends from there to
     * isolation at ninety seconds and one warm-up. So does this now.
     */
    template.forEach(function (day) {
      var rank = function (item) {
        var x = byId(item.exerciseId, opts.custom);
        if (!x) return 1;
        return x.pattern === 'core' ? 2 : x.pattern === 'isolation' ? 1 : 0;
      };
      day.exercises = day.exercises
        .map(function (item, i) { return { item: item, i: i, r: rank(item) }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; })     // stable: ties keep their order
        .map(function (x, i) { x.item.order = i; return x.item; });
      day.exercises.forEach(function (item, i) {
        var x = byId(item.exerciseId, opts.custom);
        var compound = x && x.pattern !== 'isolation' && x.pattern !== 'core';
        // The author's own counts, in the programmes' own pattern: three on the opener, two on the
        // other compounds, one on an isolation. Warming up is not free time, and a cable curl does
        // not need the four rungs a heavy press does.
        item.warmups = (i === 0 && compound) ? 3 : compound ? 2 : 1;
        // Four minutes on the movement the session is built around. Everything downstream of it is
        // already at the rest its own size earns.
        if (i === 0 && compound) item.target.restSec = Math.max(item.target.restSec || 0, 240);
      });
    });

    var built = blockFromTemplate(template, Object.assign({}, opts, { weeks: weeks, shape: shape, targets: targets, daysPerWeek: days }));
    // What they brought, and what of it could not be fitted. Stored on the block because it is the
    // honest answer to "where did my movement go", and because the picker can offer them back.
    if (insp) {
      built.brought = insp.pool.slice();
      built.broughtSpare = spare;
    }
    return built;
  }

  // The one way a plan somebody brought becomes a block, so the preview, the wizard and the draft
  // screen cannot drift into three different answers to the same question.
  //
  // "As brought" is the photocopy: their days, their sets, their numbers, run for four weeks with
  // nothing of ours added. Every other shape reads what they brought as INSPIRATION - their
  // movements, their rep ranges and tempos, and whatever their plan was plainly built around, laid
  // out across the day count the person actually asked for and progressed against their own
  // landmarks. That is the difference between importing somebody else's block and being handed a
  // block of your own that was informed by it, and it is what the shape control has always been
  // asking about; it just used to have no teeth once a source was involved.
  function blockFromSource(template, opts) {
    opts = opts || {};
    if (SHAPES[opts.shape] && SHAPES[opts.shape].asWritten) {
      return blockFromTemplate(template, Object.assign({}, opts, { source: opts.source || 'import' }));
    }
    return generateBlock(Object.assign({}, opts, { inspiration: template, source: opts.source || 'inspired' }));
  }

  // Weekly sets for one week of a block, so the coverage panel can show week 1 vs week 3.
  function weekSessions(block, week) {
    return (block && block.sessions || []).filter(function (s) { return s.week === week; });
  }
  function blockWeekVolume(block, week, custom) { return plannedVolume(weekSessions(block, week), custom); }

  // Where the user is in a block right now, from its start date.
  function blockProgress(block, todayISO) {
    if (!block || !block.startISO) return { week: 1, dayIndex: 0, done: false };
    var start = Date.parse(block.startISO + 'T00:00:00Z');
    var now = Date.parse(todayISO + 'T00:00:00Z');
    if (isNaN(start) || isNaN(now)) return { week: 1, dayIndex: 0, done: false };
    var dayNo = Math.floor((now - start) / 86400000);
    if (dayNo < 0) return { week: 1, dayIndex: 0, done: false, notStarted: true };
    var week = Math.floor(dayNo / 7) + 1;
    return { week: Math.min(week, block.weeks), dayIndex: dayNo % 7, done: week > block.weeks, dayNo: dayNo };
  }

  /* A session that is being written RIGHT NOW, as opposed to one that is done.
   *
   * A log row is written the moment the first set is ticked, so the existence of one says the
   * session was started, not that it was finished. `endedAt` is written by the runner's Finish and
   * by nothing else, which makes its absence the signal.
   *
   * It is only trusted for the day given: logs written before the field existed carry no `endedAt`
   * either, and a session walked out of on Tuesday should read as the work it was rather than
   * reopening itself for the rest of the week. Pass no date and nothing counts as open, which is
   * what every caller with no clock to hand wants.
   */
  var OPEN_CARRY_MS = 8 * 3600 * 1000;
  function sessionOpen(log, todayISO, nowMs) {
    if (!log || log.endedAt || !todayISO) return false;
    if (log.dateISO === todayISO) return true;
    // Midnight is not the end of a session. Somebody who started at half past eleven and is still
    // between sets at ten past twelve is in the same session, and splitting their log in two at the
    // date line would put half a session on each of two days and tell them the first one is done.
    // Only with a clock to hand, and only for a session that started within the last few hours.
    if (!nowMs || !log.startedAt || !(log.dateISO < todayISO)) return false;
    var started = Date.parse(log.startedAt);
    return isFinite(started) && nowMs >= started && (nowMs - started) <= OPEN_CARRY_MS;
  }

  // Sessions in a block that have a matching log. Used for "3 of 4 done this week".
  //
  // A session run more than once has more than one log against it, so which one represents it has to
  // be decided rather than left to array order: the one still open if there is one, and otherwise
  // the most recent. Taking whatever happened to be last meant a repeat logged out of order showed
  // the older attempt.
  //
  // `done` counts sessions that are FINISHED. A session you are in the middle of is not one of them,
  // which is the difference between "3 of 4 done" and a week that ticks itself off the moment you
  // tick your first set.
  function completion(block, logs, todayISO, nowMs) {
    var byId2 = {};
    (logs || []).forEach(function (l) {
      if (!l || !l.sessionId) return;
      var cur = byId2[l.sessionId];
      if (!cur) { byId2[l.sessionId] = l; return; }
      if (sessionOpen(cur, todayISO, nowMs)) return;
      if (sessionOpen(l, todayISO, nowMs) || (l.dateISO || '') >= (cur.dateISO || '')) byId2[l.sessionId] = l;
    });
    var openById = {};
    for (var sid in byId2) { if (sessionOpen(byId2[sid], todayISO, nowMs)) openById[sid] = byId2[sid]; }
    var sessions = (block && block.sessions) || [];
    var done = sessions.filter(function (s) { return byId2[s.id] && !openById[s.id]; }).length;
    var total = sessions.length;
    return {
      done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0,
      logBySession: byId2, openBySession: openById,
      open: Object.keys(openById).length,
    };
  }

  /* ONE BLOCK, WEEK BY WEEK: how many of each week's sessions are finished, and which week you are
   * in. The Train tab draws it as a ladder; `blockSpine` reads the same rows for its live segment,
   * so there is one definition of "week three is done" rather than two that can drift.
   *
   * `full` requires the week to HAVE sessions, so an empty week never reads as completed - the same
   * rule `completion` uses, for the same reason: a week with nothing in it is not an achievement.
   */
  function blockWeeks(block, logs, todayISO) {
    if (!block) return [];
    var mine = (logs || []).filter(function (l) { return l.blockId === block.id; });
    var comp = completion(block, mine, todayISO);
    var prog = blockProgress(block, todayISO);
    var weeks = Math.max(1, block.weeks || 1);
    var out = [];
    for (var w = 1; w <= weeks; w++) {
      var ws = weekSessions(block, w);
      var got = ws.filter(function (s) {
        return comp.logBySession[s.id] && !comp.openBySession[s.id];
      }).length;
      out.push({
        week: w, done: got, total: ws.length,
        full: ws.length > 0 && got === ws.length,
        now: !prog.notStarted && !prog.done && w === prog.week,
        past: !prog.notStarted && (prog.done || w < prog.week),
        deload: ws.some(function (s) { return !!s.deload; }),
      });
    }
    return out;
  }

  /* Every block you have actually RUN, oldest first: the Train tab's spine.
   *
   * The tab could say where you are in the block you are in, and nothing at all about the three you
   * ran before it - they lived behind a button, so the screen read as though training began this
   * month. This is the shape that puts them on one line: a segment per block, in order, the running
   * one carrying its own weeks so "where am I" and "what have I done" are one picture rather than
   * two screens.
   *
   * Only blocks with a `startISO` are on it. A block that was built and never begun is a plan, not a
   * thing you did, and putting it on a timeline of your training would be the app taking credit on
   * your behalf.
   *
   * `max` caps the segments so a long history cannot shave them to slivers; `hidden` counts what was
   * dropped so the caller can say so rather than quietly showing less than there is.
   *
   * `weeksTrained` counts weeks you actually TRAINED in - at least one session finished - not weeks
   * elapsed. A fortnight off in the middle of a block is not two weeks of training, and a number
   * that says it is turns the one honest figure on the screen into a participation trophy.
   */
  function blockSpine(blocks, logs, todayISO, opts) {
    opts = opts || {};
    var max = opts.max == null ? 6 : opts.max;
    var all = (blocks || []).filter(function (b) { return b && b.startISO; }).slice()
      .sort(function (a, b) { return a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0; });
    var hidden = Math.max(0, all.length - max);
    var shown = hidden ? all.slice(all.length - max) : all;
    /* WHICH ONE IS LIVE, decided once for the whole spine.
     *
     * "not archived and not finished" is a per-block predicate, and two blocks can satisfy it at
     * once - overlapping blocks are creatable, and two saved on the same day certainly are. That put
     * two tall framed segments and two "now" labels on one timeline, and made this function disagree
     * with `activeBlock`, which takes the NEWEST. One winner, chosen the same way, so the spine and
     * the rest of the app cannot name different blocks as the one you are in.
     */
    var liveId = null, liveStart = null;
    shown.forEach(function (b) {
      var pg = blockProgress(b, todayISO);
      if (b.archived || pg.done || pg.notStarted) return;
      if (liveStart == null || b.startISO >= liveStart) { liveStart = b.startISO; liveId = b.id; }
    });
    var segments = shown.map(function (b) {
      var mine = (logs || []).filter(function (l) { return l.blockId === b.id; });
      var comp = completion(b, mine, todayISO);
      var prog = blockProgress(b, todayISO);
      var running = b.id === liveId;
      var weeks = Math.max(1, b.weeks || 1);
      // One definition of "how did each week go", shared with the Train tab's ladder.
      var weekFill = blockWeeks(b, mine, todayISO).map(function (x) {
        return { week: x.week, done: x.done, total: x.total, full: x.full, now: running && x.now };
      });
      return {
        id: b.id, name: b.name, weeks: weeks, startISO: b.startISO,
        // A block dated into the future is not one you abandoned. It fell through to 'stopped' and
        // was drawn as most-of-a-block-you-walked-away-from, on a timeline of things you have done,
        // while the lines below it said "week 1 of 4" - the screen calling it history and present at
        // the same time. It has its own state, and it is the only one that has not happened yet.
        state: prog.notStarted ? 'planned' : running ? 'running' : prog.done ? 'done' : 'stopped',
        week: running ? prog.week : null,
        done: comp.done, total: comp.total,
        pct: comp.total ? comp.done / comp.total : 0,
        weekFill: weekFill,
        weeksWorked: weekFill.filter(function (x) { return x.done > 0; }).length,
      };
    });
    return {
      segments: segments, hidden: hidden,
      running: segments.filter(function (x) { return x.state === 'running'; })[0] || null,
      // What you have BEHIND you, which is neither the block you are in nor one that has not begun.
      before: segments.filter(function (x) {
        return x.state !== 'running' && x.state !== 'planned';
      }).length + hidden,
      weeksTrained: all.reduce(function (a, b) {
        var mine = (logs || []).filter(function (l) { return l.blockId === b.id; });
        var comp = completion(b, mine, todayISO);
        var n = 0;
        for (var w = 1; w <= Math.max(1, b.weeks || 1); w++) {
          var hit = weekSessions(b, w).some(function (s) {
            return comp.logBySession[s.id] && !comp.openBySession[s.id];
          });
          if (hit) n++;
        }
        return a + n;
      }, 0),
    };
  }

  // ---- block review --------------------------------------------------------------------------
  // The end-of-block payoff. Numbers only; the buddy's prose is written elsewhere from this shape.
  function reviewBlock(block, logs, targets, custom, todayISO) {
    var blockLogs = (logs || []).filter(function (l) { return l.blockId === block.id; });
    var comp = completion(block, blockLogs, todayISO);
    var exIds = uniq(blockLogs.reduce(function (a, l) { return a.concat((l.sets || []).map(function (s) { return s.exerciseId; })); }, []));
    var lifts = exIds.map(function (id) {
      var h = exerciseHistory(blockLogs, id);
      if (h.length < 2) return null;
      var first = h[0], last = h[h.length - 1];
      var delta = first.e1rm ? round(((last.e1rm - first.e1rm) / first.e1rm) * 100, 1) : 0;
      var ex = byId(id, custom);
      return {
        exerciseId: id, name: ex ? ex.name : id, sessions: h.length,
        startE1rm: first.e1rm, endE1rm: last.e1rm, deltaPct: delta,
        stall: detectStall(h),
      };
    }).filter(Boolean).sort(function (a, b) { return b.deltaPct - a.deltaPct; });

    // Coverage judged on what was PERFORMED, averaged per week, not on what was written down.
    var weeks = Math.max(1, block.weeks || 4);
    var perf = performedVolume(blockLogs, custom);
    var perWeek = {}; MUSCLES.forEach(function (m) { perWeek[m] = round((perf[m] || 0) / weeks, 1); });
    var cov = coverage(perWeek, targets);

    return {
      blockId: block.id, name: block.name,
      completion: comp,
      sessionsLogged: blockLogs.length,
      tonnage: round(blockLogs.reduce(function (a, l) { return a + tonnage(l); }, 0), 0),
      lifts: lifts,
      improved: lifts.filter(function (l) { return l.deltaPct > 1; }),
      stalled: lifts.filter(function (l) { return l.stall; }),
      coverage: cov,
      adherence: comp.pct,
    };
  }

  // ---- what the buddy knows about your training ------------------------------------------------
  // The buddy has always run entirely on food: quality days, macros and the scale. It knew nothing
  // whatsoever about lifting, which made a nonsense of a chat prompt that promises to answer
  // questions about training, and left the one tab where somebody is physically working hardest as
  // the one tab their companion had nothing to say about.
  //
  // This is the single shape every buddy-side surface reads from: the chat snapshot, the Today coach
  // line, the session sign-off and the push nudge. One derivation means the buddy can never say
  // something the Train tab disagrees with, which is the whole reason it is here and not four
  // separate reads spread across app.jsx.
  //
  // Deliberately SMALL. It is sent to a model on every chat turn, so every field has to earn the
  // tokens: a number the buddy would actually say out loud in a sentence, and nothing else.
  function trainingSummary(training, todayISO, opts) {
    opts = opts || {};
    var t = training || {};
    var custom = t.custom;
    var logs = (t.logs || []).filter(function (l) { return l && l.dateISO; })
      .sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0; });
    var since = function (iso) { return iso ? Math.round((Date.parse(todayISO + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 86400000) : null; };
    var last = logs.length ? logs[logs.length - 1] : null;
    var daysSince = last ? since(last.dateISO) : null;
    var within = function (n) { return logs.filter(function (l) { var d = since(l.dateISO); return d != null && d >= 0 && d < n; }); };
    var last7 = within(7), last28 = within(28);

    // The block the person is actually running, chosen exactly as the Train tab chooses it: the most
    // recently started live block that has not run past its final week. Anything else and the buddy
    // would talk about a block the tab is not showing.
    var live = (t.blocks || []).filter(function (b) { return b && !b.archived && b.startISO; });
    var running = live.filter(function (b) { return !blockProgress(b, todayISO).done; });
    var pool = running.length ? running : live;
    var block = pool.slice().sort(function (a, b) { return a.startISO < b.startISO ? 1 : -1; })[0] || null;
    var blockOut = null;
    if (block) {
      var prog = blockProgress(block, todayISO);
      var wk = weekSessions(block, prog.week);
      var loggedIds = {};
      logs.forEach(function (l) { if (l.sessionId) loggedIds[l.sessionId] = l; });
      var doneThisWeek = wk.filter(function (s) { return loggedIds[s.id]; }).length;
      var next = wk.filter(function (s) { return !loggedIds[s.id]; })[0] || null;
      blockOut = {
        name: block.name || 'your block', week: prog.week, weeks: block.weeks || 4,
        finished: !!prog.done,
        sessionsThisWeek: wk.length, doneThisWeek: doneThisWeek,
        nextSession: next ? next.name : null,
        deloadWeek: wk.some(function (s) { return !!s.deload; }),
      };
    }

    // Stalls the buddy is entitled to mention: only movements trained at least three times in the
    // last month, because detectStall on two sessions is reading tea leaves, and only the worst
    // couple, because a companion that lists six stalled lifts is a spreadsheet.
    var recentIds = uniq(last28.reduce(function (a, l) {
      return a.concat((l.sets || []).filter(function (s) { return s.done && (!s.type || s.type === 'work'); })
        .map(function (s) { return s.exerciseId; }));
    }, []));
    var stalled = [];
    recentIds.forEach(function (id) {
      var h = exerciseHistory(last28, id);
      if (h.length < 3) return;
      if (detectStall(h)) { var ex = byId(id, custom); stalled.push(ex ? ex.name : id); }
    });

    return {
      everTrained: logs.length > 0,
      sessions: logs.length,
      trainedToday: !!last && last.dateISO === todayISO,
      lastSessionISO: last ? last.dateISO : null,
      lastSessionName: last ? (last.name || 'a session') : null,
      daysSinceSession: daysSince,
      sessionsLast7: last7.length,
      sessionsLast28: last28.length,
      tonnageLast7Kg: round(last7.reduce(function (a, l) { return a + tonnage(l); }, 0), 0),
      block: blockOut,
      stalledLifts: stalled.slice(0, 2),
    };
  }

  // Landmarks tuned by what actually happened: if a muscle was trained above MAV and its lifts
  // still went up, that user tolerates more; if lifts stalled at high volume, they tolerate less.
  // Deliberately timid, +/- 2 sets per block, because over-reacting to one block is noise-chasing.
  function tuneTargets(targets, review, opts) {
    opts = opts || {};
    var out = JSON.parse(JSON.stringify(targets));
    if (!review || review.adherence < 70) return out;   // do not tune on a block nobody ran
    // On min-max the numbers are the method rather than an estimate of it. Learning "you tolerated
    // eight sets, so have ten" from a block is how a 4-to-10 rule quietly becomes a 6-to-14 one over
    // three blocks, having never been a decision anybody made. What a block CAN still teach is the
    // other direction: a muscle that stalled at the top of its band is one to give less of, and that
    // is worth keeping whichever way you train.
    var mayRaise = !styleOf(opts.style).toFailure;
    var stalledMuscles = {};
    (review.stalled || []).forEach(function (l) {
      var ex = byId(l.exerciseId);
      (ex && ex.primary || []).forEach(function (m) { stalledMuscles[m] = 1; });
    });
    (review.coverage.rows || []).forEach(function (r) {
      var t = out[r.muscle];
      if (!t) return;
      if (mayRaise && r.band === 'high' && !stalledMuscles[r.muscle]) { t.mav = Math.min(t.mrv, t.mav + 2); }
      if (stalledMuscles[r.muscle] && (r.band === 'high' || r.band === 'over')) {
        // Proportional, not a flat two sets. Two off a ceiling of 22 is a tenth of it; two off a
        // ceiling of 8 is a quarter, and clamped by a floor written for wide bands it came out as
        // nothing at all - so on min-max, the one adjustment a block genuinely earns did not happen.
        var step = Math.max(1, Math.round(t.mrv * 0.1));
        t.mav = Math.max(t.mev + 1, t.mav - step);
        t.mrv = Math.max(t.mav + 1, t.mrv - step);
      }
    });
    return out;
  }
  // Only the muscles a tune actually moved. The review screen used to save the WHOLE table as the
  // person's own landmarks, which meant finishing one block stamped seventeen muscles' worth of
  // numbers over their settings whether or not anything had been learned about them.
  function targetChanges(before, after) {
    var out = {};
    MUSCLES.forEach(function (m) {
      var a = (before || {})[m], b = (after || {})[m];
      if (!a || !b) return;
      if (a.mev !== b.mev || a.mav !== b.mav || a.mrv !== b.mrv) out[m] = { mev: b.mev, mav: b.mav, mrv: b.mrv };
    });
    return out;
  }

  // Carry a finished block forward: same skeleton, loads and gaps updated. This is the one-tap
  // "build my next block" from the review screen.
  // "Macrosaurus 5 Day" then "Macrosaurus 5 Day - Block 2", then 3. Counting rather than stacking
  // suffixes, so a fourth block is not called "Block 2 - Block 2 - Block 2".
  function nextBlockName(name) {
    var m = String(name).match(/^(.*) - Block (\d+)$/);
    return m ? m[1] + ' - Block ' + (+m[2] + 1) : name + ' - Block 2';
  }

  function nextBlock(block, review, targets, opts) {
    opts = opts || {};
    // On min-max the next block is not a fresh answer to the same question - it is THIS block again
    // with a technique on the last set of the accessories. The published programmes run the same
    // twelve movements for twelve weeks and change nothing else, and regenerating would quietly
    // reshuffle exercise selection on a style whose progression depends on running the same lift
    // long enough to load it. A lift that actually stalled is a different matter, and rerunPlan is
    // where that decision lives.
    if (styleOf(block.style).toFailure && !hasTechniques(block)) {
      var same = blockFromTemplate(templateOf(block), Object.assign({}, opts, {
        weeks: block.weeks, shape: block.shape, style: block.style, intensity: block.intensity,
        daysPerWeek: block.daysPerWeek, goal: block.goal, targets: targets,
        // The same plan, so the same name. Regenerating a name from the split turned "Macrosaurus
        // 5 Day" into "Upper/lower, 5 days" between block one and block two of a programme somebody
        // deliberately chose, which reads as having been moved onto something else.
        name: block.name ? nextBlockName(block.name) : null,
        source: block.source, sourceRef: block.sourceRef || null,
      }));
      applyTechniques(same, { custom: opts.custom });
      same.previousBlockId = block.id;
      return same;
    }
    var next = generateBlock(Object.assign({}, opts, {
      daysPerWeek: block.daysPerWeek, weeks: block.weeks, shape: block.shape,
      goal: block.goal, targets: tuneTargets(targets, review, { style: block.style }),
      // The style carries forward by default, same as the shape and the days do - it is a standing
      // choice, not a one-off, unless the caller explicitly asks for something else this time.
      intensity: opts.intensity || block.intensity,
      style: opts.style || block.style,
      name: null,
    }));
    next.previousBlockId = block.id;
    return next;
  }

  // ---- running the same block again, changed ----------------------------------------------------
  // nextBlock() throws the old block away and generates a fresh one. That is the wrong answer for
  // somebody who imported a coach's plan, liked it, and wants another four weeks of it: what they
  // want is THIS plan, with the handful of things that did not work changed.
  //
  // What the evidence actually supports changing between blocks, and what it does not:
  //
  // ROTATE WHAT STALLED, KEEP WHAT MOVED. The case for swapping exercises wholesale every block is
  // weak, and it costs something real: a movement you keep is a movement whose load you can still
  // read a trend from. The case for swapping a lift that has stopped moving at adequate volume is
  // much stronger, and it is the same advice detectStall already gives per lift. So rotation here is
  // targeted, not scheduled.
  //
  // ADD WHERE THERE IS ROOM, AND ONLY IF YOU TURNED UP. Volume added to a plan somebody only half
  // ran is volume that will not happen either. Adherence under about 70 percent means the block was
  // too big for the life around it, and the honest change is a smaller one, which is exactly what
  // BLOCK_REVIEW_PROMPT already tells the coach to say. So a poor block never grows.
  //
  // NOTHING CROSSES MRV. Every proposal is checked against the ceiling before it is offered.
  //
  // Returns proposals, not a block. Each carries its own reason so the person can turn any of them
  // down: it is their training and a machine that silently rewrites their coach's plan has overstepped
  // exactly the way the as-written import was built to stop.
  function rerunPlan(block, logs, targets, custom) {
    var review = reviewBlock(block, logs, targets, custom);
    var template = templateOf(block);
    var adherence = review.adherence;
    var canGrow = adherence >= 70;
    var currentIds = template.reduce(function (a, d) {
      return a.concat((d.exercises || []).map(function (e) { return e.exerciseId; }));
    }, []);
    var weekVol = plannedVolume(template, custom);
    var cov = coverage(weekVol, targets);
    var bandOf = {}; cov.rows.forEach(function (r) { bandOf[r.muscle] = r; });
    var changes = [];

    // 1. Lifts that stopped moving. A variation on the same muscle, at the same sets and reps, so the
    //    only thing that changed is the one thing that was not working.
    (review.stalled || []).forEach(function (l) {
      var here = null;
      template.forEach(function (d, di) {
        (d.exercises || []).forEach(function (e, ei) {
          if (!here && e.exerciseId === l.exerciseId) here = { day: di, index: ei, item: e };
        });
      });
      if (!here) return;
      var ex = byId(l.exerciseId, custom);
      var muscle = ex && (ex.primary || [])[0];
      if (!muscle) return;
      var alts = suggestFor(muscle, { template: template, targets: targets, custom: custom, currentExerciseIds: currentIds, limit: 3 });
      if (!alts.length) return;
      changes.push({
        kind: 'swap', day: here.day, dayName: template[here.day].name, index: here.index,
        from: l.exerciseId, fromName: ex.name, to: alts[0].id, toName: alts[0].name,
        alts: alts.map(function (a) { return { id: a.id, name: a.name }; }),
        why: 'It has not moved in ' + (l.stall.sessions || 3) + ' sessions at this volume. A different movement on the same muscle gives it somewhere new to go.',
      });
      currentIds.push(alts[0].id);
    });

    // 2. Lifts that did move. Named explicitly and left alone, because "keep this" is a real decision
    //    and seeing it made is what stops the list reading as a machine changing things for its own sake.
    (review.improved || []).slice(0, 4).forEach(function (l) {
      changes.push({
        kind: 'keep', from: l.exerciseId, fromName: l.name,
        why: 'Up ' + l.deltaPct + ' percent over the block. Keep it and keep the run going.',
      });
    });

    // 3. Room to grow, on a block you actually ran. One set at a time, on the muscle furthest from
    //    the middle of its productive band, and never past the ceiling.
    if (canGrow) {
      cov.rows.filter(function (r) { return r.sets > 0 && (r.band === 'under' || r.band === 'maintaining' || r.band === 'productive'); })
        .filter(function (r) { return r.sets < targets[r.muscle].mav; })
        .sort(function (a, b) { return (a.sets / targets[a.muscle].mav) - (b.sets / targets[b.muscle].mav); })
        .slice(0, 3)
        .forEach(function (r) {
          var pick = null;
          template.forEach(function (d, di) {
            (d.exercises || []).forEach(function (e, ei) {
              var ex = byId(e.exerciseId, custom);
              if (!ex || (ex.primary || []).indexOf(r.muscle) === -1) return;
              // Not past the style's own per-movement ceiling. Proposing a sixth set on a style that
              // clamps at five is a change the build silently discards, so the screen offers work
              // that never arrives.
              if (e.target.sets >= (styleOf(block.style).maxSets || 6)) return;
              if (!pick || e.target.sets < pick.item.target.sets) pick = { day: di, index: ei, item: e, ex: ex };
            });
          });
          if (!pick) return;
          if (r.sets + 1 > targets[r.muscle].mrv) return;
          changes.push({
            kind: 'sets', day: pick.day, dayName: template[pick.day].name, index: pick.index,
            from: pick.item.target.sets, to: pick.item.target.sets + 1,
            exerciseId: pick.ex.id, fromName: pick.ex.name, muscle: r.muscle,
            why: MUSCLE_LABEL[r.muscle] + ' sat at ' + r.sets + ' sets against a productive band of ' + targets[r.muscle].mev + ' to ' + targets[r.muscle].mav + '. One more set is the smallest step that changes anything.',
          });
        });
    }

    // 4. Muscles the plan never trains at all. Offered, never applied quietly: a plan with no calf
    //    work may be a plan that does not want calf work.
    cov.rows.filter(function (r) { return r.sets === 0; }).slice(0, 3).forEach(function (r) {
      var alts = suggestFor(r.muscle, { template: template, targets: targets, custom: custom, currentExerciseIds: currentIds, limit: 3 });
      if (!alts.length) return;
      changes.push({
        kind: 'add', muscle: r.muscle, to: alts[0].id, toName: alts[0].name,
        alts: alts.map(function (a) { return { id: a.id, name: a.name }; }),
        sets: 2, day: dayFor(r.muscle, template, custom), dayName: template[dayFor(r.muscle, template, custom)].name,
        why: 'Nothing in the block trains ' + MUSCLE_LABEL[r.muscle].toLowerCase() + '. Two sets is a floor, not a project.',
      });
    });

    return {
      adherence: adherence, canGrow: canGrow, review: review, changes: changes,
      headline: !canGrow
        ? 'You finished ' + adherence + ' percent of it, so the useful change is a smaller block rather than a bigger one. Nothing below adds work.'
        : (review.stalled || []).length
          ? (review.stalled || []).length + ' ' + ((review.stalled || []).length === 1 ? 'lift stopped' : 'lifts stopped') + ' moving. Those are the ones worth changing; the rest earned their place.'
          : 'Everything moved. This is a block worth running again, with a little more where you have room.',
    };
  }
  function shortestDay(template) {
    var best = 0, bestSets = Infinity;
    (template || []).forEach(function (d, i) {
      var s = (d.exercises || []).reduce(function (a, e) { return a + (e.target.sets || 0); }, 0);
      if (s < bestSets) { bestSets = s; best = i; }
    });
    return best;
  }
  // Where a new movement belongs. The shortest day is the right answer only when no day is a better
  // one: dropping a lateral raise onto leg day because leg day happens to be short is how a coherent
  // split turns into a list. So put it with the region it belongs to, and among those days pick the
  // one carrying least work.
  function dayFor(muscle, template, custom) {
    var want = REGION[muscle];
    var best = -1, bestSets = Infinity;
    (template || []).forEach(function (d, i) {
      if (dayRegions(d, custom).indexOf(want) === -1) return;
      var s = (d.exercises || []).reduce(function (a, e) { return a + (e.target.sets || 0); }, 0);
      if (s < bestSets) { bestSets = s; best = i; }
    });
    return best >= 0 ? best : shortestDay(template);
  }

  // Turn accepted proposals into the next block. The template is the OLD one with the accepted
  // changes written into it, so everything nobody chose to change survives exactly as it was.
  function applyRerun(block, changes, opts) {
    opts = opts || {};
    var template = JSON.parse(JSON.stringify(templateOf(block)));
    (changes || []).forEach(function (c) {
      if (c.kind === 'swap') {
        var it = template[c.day] && template[c.day].exercises[c.index];
        if (it && it.exerciseId === c.from) { it.exerciseId = c.to; it.id = c.to + '_r' + c.day + '_' + c.index; }
      } else if (c.kind === 'sets') {
        var s = template[c.day] && template[c.day].exercises[c.index];
        if (s) s.target = Object.assign({}, s.target, { sets: c.to });
      } else if (c.kind === 'add') {
        var d = template[c.day];
        if (!d) return;
        var ex = byId(c.to, opts.custom);
        var compound = ex && ex.pattern !== 'isolation' && ex.pattern !== 'core';
        d.exercises.push({
          id: c.to + '_add' + d.exercises.length, exerciseId: c.to, order: d.exercises.length,
          target: { sets: c.sets || 2, repLow: compound ? 6 : 10, repHigh: compound ? 10 : 15, rir: 2, restSec: compound ? 150 : 90 },
        });
      }
    });
    var next = blockFromTemplate(template, {
      weeks: block.weeks || 4,
      // A rerun keeps the shape it was run under. An imported plan stays as written; the app's own
      // block keeps periodising.
      shape: block.shape, targets: targetsFor(Object.assign({ style: block.style }, opts)), custom: opts.custom,
      name: opts.name || nextRunName(block.name),
      goal: block.goal, source: block.source || 'generated',
      sourceRef: block.sourceRef || null, startISO: opts.startISO || null,
    });
    next.previousBlockId = block.id;
    return next;
  }
  // "Cam Kissel's Program" becomes "Cam Kissel's Program, run 2", then run 3. The name has to say
  // which time round it is or the history reads as one block you kept editing.
  function nextRunName(name) {
    var n = String(name || 'Block');
    var m = n.match(/^(.*), run (\d+)$/);
    if (m) return m[1] + ', run ' + (parseInt(m[2], 10) + 1);
    return n + ', run 2';
  }

  /* ---- rotating a movement between blocks -------------------------------------------------------
   * rerunPlan() rotates a lift when the engine spots a stall. This is the other half: the person
   * standing at the end of a block who wants to CHOOSE what changes, because they have run the same
   * incline dumbbell press for three blocks and would like the Smith version for a while.
   *
   * What the evidence says, and what it does not:
   *
   * VARIATION IS NOT A GROWTH LEVER ON ITS OWN. Head to head, varied and constant exercise selection
   * produce close to the same strength and hypertrophy. So nothing here sells a rotation as extra
   * progress. What the reviews DO support is that SYSTEMATIC variation helps a little and RANDOM
   * variation hurts, with two named failure modes: swapping for something that gives the same
   * stimulus, and changing too often. Both are guarded below, the first by ranking candidates on the
   * job they do rather than on novelty, the second by CAPS.
   *
   * PROGRESSIVE OVERLOAD LIVES IN THE MUSCLE, NOT THE BARBELL. A swap does not continue your run on a
   * lift, it restarts the number you were reading the run from. The tissue keeps its adaptation; the
   * trend line does not. Every rotation therefore carries its cost in words, and the lineage is
   * recorded so the history can still be read as one thing (see familyHistory).
   *
   * STRENGTH IS SKILL-SPECIFIC, SO THE BIG LIFTS ARE THE EXPENSIVE ONES TO ROTATE. This is the part
   * that surprises people, because the big lifts are the ones they most want to change. A barbell
   * squat is a skill as well as a stimulus, and rotating it costs both the skill and the only
   * long-run signal you have. So the heaviest, most skilled movement in each pattern is an ANCHOR: it
   * is scored with a penalty and never switched on by default. It is still offered, because it is
   * their training and a stalled squat is a real reason.
   *
   * THERE IS A RE-LEARNING TAX. Early neural adaptation runs two to four weeks, so the first sessions
   * on a new movement are load-finding rather than overload. In a four-week block that is a quarter
   * to half of it. Hence rotations happen at the START of a block and hold for all of it, which is
   * what returning proposals for the NEXT block (rather than a swap into this one) already enforces.
   *
   * Returns verdicts, never a block. `on` is the engine's default answer and the caller is free to
   * ignore it: this decides what to RECOMMEND, the screen decides what was accepted.
   */

  // Every other way of doing the same job. Tier 1 is the same movement on different kit, which is
  // what somebody means by "the Smith version": same pattern, same primary muscles, so the only
  // thing that changed is what you are holding. Tier 2 widens to the same pattern on the same lead
  // muscle, which is a different angle on the same job and the honest second answer. Generated grip
  // and stance variants are tier 0, because changing your stance is the smallest change there is.
  //
  // Ranking prefers the SAME resistance profile, which reads backwards until you remember what this
  // is for: a rotation is meant to keep the job and change the implement. A movement that loads a
  // different part of the range is a different exercise, and the reviews are explicit that swapping
  // for a redundant or unrelated stimulus is where variation stops paying.
  // The words in a movement's name that say what the movement IS, with the ones that only say what
  // you are holding removed: those are the words a rotation is deliberately changing.
  //
  // Named JOB_ rather than KIT_WORDS on purpose. There are already two module-level KIT_WORDS in this
  // file and a third quietly won, because `var` at this scope is one shared name: it took kitMismatch
  // out and two import tests with it. Everything declared out here is global to the bundle, so a
  // generic name is a live hazard rather than a style question.
  var JOB_KIT_WORDS = { barbell: 1, dumbbell: 1, cable: 1, machine: 1, smith: 1, kettlebell: 1, band: 1, ez: 1, bar: 1, trap: 1, weighted: 1, single: 1, arm: 1 };
  function jobWords(name) {
    return norm(name).split(' ').filter(function (w) { return w.length > 2 && !JOB_KIT_WORDS[w]; });
  }
  function sharedWords(a, b) {
    var seen = {}; b.forEach(function (w) { seen[w] = 1; });
    return a.filter(function (w) { return seen[w]; }).length;
  }
  function sameJob(exerciseId, opts) {
    opts = opts || {};
    var base = byId(exerciseId, opts.custom);
    if (!base || isCardio(base)) return [];
    var lead = (base.primary || [])[0];
    if (!lead) return [];
    var have = opts.equipment && opts.equipment.length ? opts.equipment : null;
    var blocked = {}; (opts.dislikes || []).forEach(function (d) { blocked[d] = 1; });
    (opts.exclude || []).forEach(function (d) { blocked[d] = 1; });
    blocked[exerciseId] = 1;
    var key = function (e) { return (e.primary || []).slice().sort().join(','); };
    var baseKey = key(base);
    var kin = {}; (variantsOf(exerciseId, opts.custom) || []).forEach(function (v) { kin[v.id] = 1; });
    var baseWords = jobWords(base.name);

    return all(opts.custom)
      .filter(function (e) {
        if (isCardio(e) || blocked[e.id]) return false;
        if (e.pattern !== base.pattern) return false;
        if ((e.primary || []).indexOf(lead) === -1) return false;
        if (have && have.indexOf(e.equipment) === -1) return false;
        // A movement that needs kit the gym has not got is not an option, however well it scores.
        if (have && NEEDS_BENCH[e.id] && !opts.bench) return false;
        if (have && NEEDS_BAR[e.id] && !opts.bar) return false;
        return true;
      })
      .map(function (e) {
        var tier = kin[e.id] ? 0 : key(e) === baseKey ? 1 : 2;
        // Tier 1 leads, not tier 0. A stance change is the smallest possible change and it is worth
        // offering, but somebody at the end of a block asking to rotate their squat means the hack
        // squat, not the same bar an inch wider.
        var score = tier === 1 ? 5 : tier === 0 ? 3 : 1;
        if (e.profile === base.profile) score += 2;          // same job, different implement
        if (e.equipment !== base.equipment) score += 1;      // the point of the exercise
        // Rotating a loaded press onto press-ups is not a rotation, it is a demotion: you cannot add
        // 2.5kg to your own bodyweight next week, so the thing the whole block is for stops being
        // possible. Offered further down the list, never first.
        if (LOADABLE[base.equipment] && !LOADABLE[e.equipment]) score -= 4;
        // What people actually reach for when they rotate a free-weight lift is the guided version of
        // it, so a machine, cable or Smith answer outranks another free-weight one at the same tier.
        if (STABLE_KIT[e.equipment]) score += 1;
        // And the strongest signal that two movements are the same job is that they are called nearly
        // the same thing: "incline machine press" against "incline dumbbell press" shares the words
        // that carry the meaning, which is exactly the pair somebody has in mind.
        score += 2 * sharedWords(baseWords, jobWords(e.name));
        return { ex: e, tier: tier, score: score };
      })
      .sort(function (a, b) { return b.score - a.score || a.ex.name.localeCompare(b.ex.name); })
      // One answer per movement. "Machine row" and "Machine row (neutral grip)" are the same
      // suggestion twice, and offering both spends half a four-slot shortlist saying nothing.
      .filter(function (r, i, arr) {
        var fam = baseOf(r.ex.id, opts.custom);
        return !arr.some(function (o, j) { return j < i && baseOf(o.ex.id, opts.custom) === fam; });
      })
      .slice(0, opts.limit || 4)
      .map(function (r) {
        return {
          id: r.ex.id, name: r.ex.name, equipment: r.ex.equipment, profile: r.ex.profile, tier: r.tier,
          note: r.tier === 0 ? 'The same movement, held differently.'
            : r.ex.profile === base.profile ? 'The same job on different kit.'
              : PROFILE_WHY[r.ex.profile] || 'A different angle on the same muscle.',
        };
      });
  }

  // The heaviest, most skilled movement in a pattern is the one whose number is worth protecting.
  // Barbell and Smith work scores highest because that is where technique carries most of the load,
  // free weights next, machines and cables least: a leg press is a stimulus, not a skill.
  // Kit you can add weight to next week. Bodyweight and bands can be progressed, but not in the
  // small honest steps a block is built on.
  var LOADABLE = { barbell: 1, trapbar: 1, smith: 1, dumbbell: 1, kettlebell: 1, ez: 1, cable: 1, machine: 1 };
  var SKILL_KIT = { barbell: 3, trapbar: 3, smith: 2, dumbbell: 2, kettlebell: 2, ez: 1, cable: 1, machine: 0, bodyweight: 1, band: 0 };
  function skillOf(ex) {
    if (!ex) return 0;
    if (ex.pattern === 'isolation' || ex.pattern === 'core' || ex.pattern === 'carry') return 0;
    return 1 + (SKILL_KIT[ex.equipment] || 0);
  }
  function roleOf(ex) {
    if (!ex) return 'accessory';
    if (ex.pattern === 'isolation' || ex.pattern === 'core' || ex.pattern === 'carry') return 'accessory';
    return 'main';
  }

  // How many separate blocks this movement has been trained across. "Blocks run" is the unit the
  // rotation guidance is written in (roughly every two to five blocks, not every one), and it is the
  // number a person actually feels: three blocks of the same press is when it starts to go stale.
  function blocksRunOn(logs, exerciseId) {
    var seen = {};
    (logs || []).forEach(function (l) {
      if (!l.blockId) return;
      if ((l.sets || []).some(function (s) { return s.exerciseId === exerciseId && s.done; })) seen[l.blockId] = 1;
    });
    return Object.keys(seen).length;
  }

  // Mean reps in reserve early in the block against late, for one movement. Negative means the same
  // work is costing more than it did, which is the closest thing to "bar speed looks worse" that a
  // phone can measure.
  function rirDrift(blockLogs, exerciseId) {
    var early = [], late = [];
    var sorted = (blockLogs || []).slice().sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : 1; });
    sorted.forEach(function (l, i) {
      (l.sets || []).forEach(function (s) {
        if (s.exerciseId !== exerciseId || !s.done || (s.type && s.type !== 'work') || s.rir == null) return;
        (i < sorted.length / 2 ? early : late).push(+s.rir);
      });
    });
    if (early.length < 3 || late.length < 3) return null;
    var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    return round(mean(late) - mean(early), 2);
  }

  var ROTATE_MAIN_CAP = 1;        // per block, and an anchor counts against it
  var ROTATE_ACCESSORY_CAP = 2;

  function rotationPlan(block, logs, targets, opts) {
    opts = opts || {};
    var custom = opts.custom;
    var blockLogs = (logs || []).filter(function (l) { return l.blockId === block.id; });
    var template = templateOf(block);
    var niggles = {}; (opts.niggles || []).forEach(function (id) { niggles[id] = 1; });
    var currentIds = template.reduce(function (a, d) {
      return a.concat((d.exercises || []).map(function (e) { return e.exerciseId; }));
    }, []);

    // The anchor of each pattern: most skilled first, and among equals the one with the longest run,
    // because the lift you have the most history on is the one whose history is worth most.
    var anchorOf = {};
    template.forEach(function (d, di) {
      (d.exercises || []).forEach(function (e, ei) {
        var ex = byId(e.exerciseId, custom);
        if (!ex || roleOf(ex) !== 'main') return;
        var cur = anchorOf[ex.pattern];
        var mine = { id: e.exerciseId, skill: skillOf(ex), runs: blocksRunOn(logs, e.exerciseId) };
        if (!cur || mine.skill > cur.skill || (mine.skill === cur.skill && mine.runs > cur.runs)) anchorOf[ex.pattern] = mine;
      });
    });

    var lifts = [];
    template.forEach(function (d, di) {
      (d.exercises || []).forEach(function (e, ei) {
        var ex = byId(e.exerciseId, custom);
        if (!ex || isCardio(ex)) return;
        var role = roleOf(ex);
        var anchor = anchorOf[ex.pattern] && anchorOf[ex.pattern].id === e.exerciseId;
        if (anchor) role = 'anchor';
        var h = exerciseHistory(blockLogs, e.exerciseId);
        var sessions = h.length;
        var stall = sessions >= 2 ? detectStall(h) : null;
        var delta = (sessions >= 2 && h[0].e1rm) ? round(((h[sessions - 1].e1rm - h[0].e1rm) / h[0].e1rm) * 100, 1) : 0;
        var runs = blocksRunOn(logs, e.exerciseId);
        var drift = rirDrift(blockLogs, e.exerciseId);
        var planned = (block.sessions || []).filter(function (s) {
          return (s.exercises || []).some(function (x) { return x.exerciseId === e.exerciseId; });
        }).length;
        var loggedIds = {}; blockLogs.forEach(function (l) { if (l.sessionId) loggedIds[l.sessionId] = 1; });
        var missed = (block.sessions || []).filter(function (s) {
          return !loggedIds[s.id] && (s.exercises || []).some(function (x) { return x.exerciseId === e.exerciseId; });
        }).length;

        var score = 0, reasons = [];
        if (stall) { score += 2; reasons.push({ key: 'stall', text: 'It has not moved in ' + (stall.sessions || sessions) + ' sessions.' }); }
        else if (sessions >= 3 && delta <= 0) { score += 2; reasons.push({ key: 'flat', text: 'It finished the block no stronger than it started.' }); }
        if (runs >= 3) { score += 1; reasons.push({ key: 'runs', text: 'You have run it for ' + runs + ' blocks.' }); }
        if (drift != null && drift <= -0.75) { score += 1; reasons.push({ key: 'effort', text: 'The same sets are costing you more than they did at the start.' }); }
        if (planned >= 3 && missed / planned >= 0.4) { score += 1; reasons.push({ key: 'missed', text: 'You skipped ' + missed + ' of the ' + planned + ' sessions it was in.' }); }
        if (niggles[e.exerciseId]) { score += 2; reasons.push({ key: 'niggle', text: 'You flagged this one as sore in the bad way.' }); }
        // And everything that argues for leaving it exactly where it is.
        if (delta > 3) { score -= 3; reasons.push({ key: 'moved', text: 'Up ' + delta + ' percent over the block. That is a run worth keeping.' }); }
        if (role === 'anchor') { score -= 1; reasons.push({ key: 'anchor', text: 'It is the heaviest skilled movement of its kind here, so it is also your clearest read on whether anything is working.' }); }
        if (runs <= 1) { score -= 1; reasons.push({ key: 'new', text: 'One block in. There is nothing to say it has stopped working yet.' }); }
        if (sessions && sessions < 3) { score -= 1; reasons.push({ key: 'thin', text: 'Only ' + sessions + ' logged ' + (sessions === 1 ? 'session' : 'sessions') + ', which is not enough to read.' }); }
        if (!sessions) { score -= 1; reasons.push({ key: 'unlogged', text: 'Never logged this block, so there is nothing to judge it on.' }); }

        lifts.push({
          exerciseId: e.exerciseId, name: ex.name, day: di, index: ei, dayName: d.name,
          role: role, equipment: ex.equipment, pattern: ex.pattern,
          score: score, reasons: reasons,
          sessions: sessions, deltaPct: delta, blocksRun: runs, stalled: !!stall, missed: missed, plannedSessions: planned,
          verdict: score >= 3 ? 'rotate' : score === 2 ? 'your-call' : 'keep',
          on: false,
          candidates: sameJob(e.exerciseId, {
            custom: custom, equipment: opts.equipment, dislikes: opts.dislikes,
            bench: opts.bench, bar: opts.bar, exclude: currentIds, limit: 4,
          }),
          // The cost, in the only terms that matter, and only where it is real. Restarting the number
          // on a lateral raise is not news; restarting it on the squat is the whole decision.
          cost: role === 'accessory' ? null
            : 'Your run on ' + ex.name.toLowerCase() + ' stops here. The muscle keeps what it built, but the numbers start again on the new movement.',
        });
      });
    });

    // Nothing to swap TO is not a recommendation to swap.
    lifts.forEach(function (l) { if (!l.candidates.length && l.verdict !== 'keep') { l.verdict = 'keep'; l.reasons.push({ key: 'nowhere', text: 'There is nothing in your gym that does the same job.' }); } });

    // THE CAP, which is the whole guard against the failure mode the reviews name. Changing three
    // movements is variation; changing nine is a different programme with no thread running through
    // it, and you would not be able to tell afterwards which change did anything. Everything over the
    // line drops to "your call" rather than disappearing, with the cap named as the reason, because a
    // proposal that quietly vanishes reads as a bug.
    var mains = 0, accessories = 0;
    lifts.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (l) {
      if (l.verdict !== 'rotate') return;
      // An anchor is never switched on for you, however the evidence reads. Rotating the one lift
      // your whole history hangs off is a decision with a real cost, and a decision with a real cost
      // should be made by the person paying it. It stays on the list, marked, ready to be turned on.
      if (l.role === 'anchor') {
        l.verdict = 'your-call';
        l.reasons.push({ key: 'anchor-hold', text: 'Turn it on if you want to. It is not switched on for you, because this is the lift you read everything else against.' });
        return;
      }
      var isMain = l.role !== 'accessory';
      if (isMain && mains < ROTATE_MAIN_CAP) { l.on = true; mains++; return; }
      if (!isMain && accessories < ROTATE_ACCESSORY_CAP) { l.on = true; accessories++; return; }
      l.verdict = 'your-call';
      l.reasons.push({ key: 'cap', text: 'Worth changing, but you are already changing enough this block. Rotating everything at once means nothing you learn can be pinned on anything.' });
    });

    var offered = lifts.filter(function (l) { return l.on; }).length;
    return {
      blockId: block.id,
      lifts: lifts.sort(function (a, b) { return b.score - a.score || a.day - b.day || a.index - b.index; }),
      offered: offered,
      caps: { main: ROTATE_MAIN_CAP, accessory: ROTATE_ACCESSORY_CAP },
      headline: offered
        ? offered + ' ' + (offered === 1 ? 'movement is' : 'movements are') + ' worth changing. Everything else earned its place, and keeping it is what lets you read the next block against this one.'
        : lifts.some(function (l) { return l.verdict === 'your-call'; })
          ? 'Nothing here has to change. A few are borderline if you fancy a change, and they are marked.'
          : 'Nothing here needs changing. Movements you keep are movements whose numbers you can still read a trend from.',
    };
  }

  // Turn accepted rotations into the next block, plus the lineage rows that keep the history whole.
  // Shares applyRerun's contract: the OLD template with the accepted changes written into it, so
  // everything nobody chose to change survives exactly as it was.
  function applyRotation(block, picks, opts) {
    opts = opts || {};
    var changes = (picks || []).map(function (p) {
      return { kind: 'swap', day: p.day, index: p.index, from: p.from, to: p.to };
    });
    // The volume proposals from rerunPlan ride along, because they are decisions about the SAME next
    // block and applying them in two passes would build two blocks.
    var next = applyRerun(block, changes.concat(opts.also || []), opts);
    var when = opts.startISO || null;
    var rotations = (picks || []).map(function (p) {
      return { from: p.from, to: p.to, dateISO: when, blockId: next.id, fromBlockId: block.id };
    });
    return { block: next, rotations: rotations };
  }

  // ---- reading a lift's history across the rotations ---------------------------------------------
  // A rotation restarts the load, and if the history restarts with it then every rotation looks like
  // losing your progress, which is both wrong and the fastest way to make somebody never rotate
  // anything. The lineage rows say which movement became which, so a chain can be walked in both
  // directions and the whole run shown as one thing with a marker where the movement changed.
  function rotationChain(rotations, exerciseId) {
    var rows = (rotations || []).filter(function (r) { return r && r.from && r.to; });
    var chain = [exerciseId], guard = 0;
    // Backwards, to whatever this came from.
    for (var back = exerciseId; guard < 20; guard++) {
      var prev = null;
      rows.forEach(function (r) { if (r.to === back && chain.indexOf(r.from) === -1) prev = r; });
      if (!prev) break;
      chain.unshift(prev.from); back = prev.from;
    }
    // Forwards, to whatever it became.
    for (var fwd = exerciseId, g2 = 0; g2 < 20; g2++) {
      var nextRow = null;
      rows.forEach(function (r) { if (r.from === fwd && chain.indexOf(r.to) === -1) nextRow = r; });
      if (!nextRow) break;
      chain.push(nextRow.to); fwd = nextRow.to;
    }
    return chain;
  }
  // The same rows exerciseHistory returns, for every movement in the chain, in date order, each
  // tagged with the movement it was actually done on so a chart can mark where the change happened.
  function familyHistory(logs, exerciseId, custom, rotations) {
    var chain = rotationChain(rotations, exerciseId);
    var out = [];
    chain.forEach(function (id) {
      var ex = byId(id, custom);
      exerciseHistory(logs, id).forEach(function (row) {
        out.push(Object.assign({}, row, { exerciseId: id, name: ex ? ex.name : id, changed: false }));
      });
    });
    out.sort(function (a, b) { return a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0; });
    out.forEach(function (row, i) { if (i && out[i - 1].exerciseId !== row.exerciseId) row.changed = true; });
    return out;
  }

  // ---- bringing an older block up to date --------------------------------------------------------
  // A block built before a rule existed does not get the rule retroactively, and the ones that hurt
  // are the ones you look at every day: days called "Day 1", a block called "4-week growth block",
  // and an imported plan quietly periodised into something its author did not write.
  //
  // Only what is repairable FROM THE BLOCK ITSELF is offered. The movements' original names are not:
  // an older import stored only the library match, and the coach's own wording is gone. Inventing it
  // back would be worse than leaving it, so it is not on this list and re-importing is the honest
  // answer for that one.
  function blockFixes(block, custom) {
    var fixes = [], seen = {};
    ((block && block.sessions) || []).forEach(function (s) {
      if (seen[s.name]) return; seen[s.name] = 1;
      var better = nameDay(s.name, s, custom);
      if (better !== s.name) fixes.push({ kind: 'dayName', from: s.name, to: better });
    });
    // The name every generated block used to be given.
    if (/^\d+-week (growth|strength) block$/.test(String(block && block.name || ''))) {
      fixes.push({ kind: 'blockName', from: block.name, to: blockName(templateOf(block), { custom: custom, goal: block.goal }) });
    }
    // An imported plan carrying our periodisation rather than its author's prescription.
    if (block && block.source === 'import' && block.shape !== 'as-written') {
      var w1 = weekSessions(block, 1), wLast = weekSessions(block, block.weeks || 4);
      var a = w1.reduce(function (x, s) { return x + (s.exercises || []).reduce(function (y, e) { return y + e.target.sets; }, 0); }, 0);
      var b2 = wLast.reduce(function (x, s) { return x + (s.exercises || []).reduce(function (y, e) { return y + e.target.sets; }, 0); }, 0);
      if (a !== b2) fixes.push({ kind: 'asWritten', from: a + ' sets in week 1, ' + b2 + ' in week ' + (block.weeks || 4), to: a + ' sets every week, as the plan is written' });
    }
    return fixes;
  }

  // Apply the chosen fixes, IN PLACE, without rebuilding the block. Rebuilding would re-mint the ids
  // that logged sessions and logged sets point back at, so a repair would cost you the history it was
  // supposed to be tidying up. Every change here edits fields and touches no id.
  function applyBlockFixes(block, kinds, custom) {
    var want = {}; (kinds || []).forEach(function (k) { want[k] = 1; });
    if (want.dayName) {
      var rename = {};
      ((block.sessions) || []).forEach(function (s) {
        if (rename[s.name] === undefined) rename[s.name] = nameDay(s.name, s, custom);
      });
      (block.sessions || []).forEach(function (s) { if (rename[s.name]) s.name = rename[s.name]; });
    }
    if (want.blockName) block.name = blockName(templateOf(block), { custom: custom, goal: block.goal });
    if (want.asWritten) {
      // Week 1 is the plan its author wrote; the rest were our arithmetic on top of it. Copy week 1's
      // prescription across, matched by position, and drop the deload nobody asked for.
      var base = weekSessions(block, 1);
      (block.sessions || []).forEach(function (s) {
        if (s.week === 1) return;
        var from = base.filter(function (x) { return x.dayOfWeek === s.dayOfWeek; })[0];
        if (!from) return;
        (s.exercises || []).forEach(function (e, i) {
          var src = (from.exercises || [])[i];
          if (!src) return;
          e.target = Object.assign({}, e.target, {
            sets: src.target.sets, repLow: src.target.repLow, repHigh: src.target.repHigh,
            rir: src.target.rir, tempo: src.target.tempo,
          });
        });
        s.deload = false;
      });
      block.shape = 'as-written';
    }
    return block;
  }

  // ---- training to the day you are actually having ---------------------------------------------
  // The deloading and autoregulation literature keeps landing on the same point: adjusting to the
  // athlete's current state beats running a fixed plan into the ground, and the adjustment that
  // works is usually a small one rather than halving everything.
  //
  // Almost no training app can do this, because it needs to know how you slept. Macrosaurus already
  // syncs sleep and steps for the buddy's readiness score, so the input is sitting there unused.
  //
  // Two rules the shape of this follows. First, the main lift is never what gets cut: on a rough day
  // the compound you came for is the thing worth keeping and the third set of a cable movement is
  // not. Second, it is always an OFFER. Somebody who slept badly and wants to train anyway is
  // allowed to, and an app that silently deletes half their session has taken that away from them.
  function readinessAdjust(session, readiness, opts) {
    opts = opts || {};
    var r = readiness == null ? null : +readiness;
    if (r == null || isNaN(r)) return { level: 'unknown', action: 'none' };
    var exercises = ((session && session.exercises) || []).slice().sort(function (a, b) { return a.order - b.order; });
    if (r >= 70 || !exercises.length) {
      return { level: 'good', action: 'none', text: 'You look recovered. Run it as written.' };
    }

    // Accessories, judged by what they are rather than by position: isolation and core work is what
    // comes off, and never the first movement of the day whatever it is.
    var accessoryIdx = [];
    exercises.forEach(function (e, i) {
      if (i === 0) return;
      var ex = byId(e.exerciseId, opts.custom);
      if (ex && (ex.pattern === 'isolation' || ex.pattern === 'core')) accessoryIdx.push(i);
    });

    if (r >= 50) {
      return {
        level: 'ok', action: 'soften', rirDelta: 1, setsCut: 0, drop: [],
        text: 'You are a bit under par. Same session, but leave one more rep in the tank on every set.',
      };
    }
    // Genuinely rough. Take the last couple of accessories off and ease the effort, keeping the
    // movements that the session actually exists for.
    var drop = accessoryIdx.slice(-2);
    return {
      level: 'low', action: 'trim', rirDelta: 1, setsCut: drop.length,
      drop: drop.map(function (i) { return { index: i, exerciseId: exercises[i].exerciseId }; }),
      text: drop.length
        ? 'Rough night. Keep the main work, drop the last ' + (drop.length === 1 ? 'movement' : 'couple of movements') + ', and leave a rep more in the tank.'
        : 'Rough night. Keep the session but leave a rep more in the tank on every set.',
    };
  }

  // ---- session helpers -----------------------------------------------------------------------
  // Pre-fill a session from the last time this exercise was done, which is the single feature that
  // makes a logger feel fast. Falls back to the prescription when there is no history.
  // Open a session's sets ready to fill in.
  //
  // What this deliberately does NOT do is put a weight in the box. Telling somebody to bench 82.5kg
  // today, because of what happened last Tuesday, is a guess dressed up as an instruction: it knows
  // nothing about how they slept, what they have eaten, or which bar is free. The autoregulation
  // literature keeps landing in the same place, which is that prescribing EFFORT and letting the
  // load follow works better than prescribing load and hoping the effort lands.
  //
  // So the target is reps at an RIR, last time's numbers sit underneath as the reference, and the
  // person picks the weight that hits it. `suggested` is still computed and still explains itself,
  // but it is a note, not a number typed into the box on their behalf.
  function prefillSets(sessionExercise, logs, custom, opts) {
    opts = opts || {};
    var t = sessionExercise.target || {};
    var ex = byId(sessionExercise.exerciseId, custom);
    var style = styleOf(opts.style);
    var hist = exerciseHistory(logs, sessionExercise.exerciseId);
    var last = hist.length ? hist[hist.length - 1] : null;
    var prevSets = last ? (logs.filter(function (l) { return l.dateISO === last.dateISO; })[0].sets || [])
      .filter(function (s) { return s.exerciseId === sessionExercise.exerciseId && s.done && (!s.type || s.type === 'work'); }) : [];
    var progressed = prevSets.length
      ? progressExercise(t, prevSets, ex, { style: opts.style, history: hist })
      : null;
    var n = (progressed && progressed.sets) || t.sets || 3;
    var out = [];
    for (var i = 0; i < n; i++) {
      var prev = prevSets[i] || prevSets[prevSets.length - 1];
      // The weight for the top set is what the progression said. What happens on the second set
      // depends on what the first one was: where the plan stops set one a rep short (the compounds),
      // set two is the all-out set at the SAME weight, which is how the published programmes are
      // written. Where BOTH sets are to failure - isolation, where failing costs nothing - a second
      // set at the same load lands three reps under the window and teaches nobody anything, so the
      // app takes 15% off it.
      var lead = progressed ? +progressed.weightKg || 0 : 0;
      var bothToFailure = (t.rir === 0);
      var planned = style.toFailure && lead
        ? (i === 0 || !bothToFailure ? lead : backOffLoad(lead, ex))
        : 0;
      out.push({
        setIndex: i, exerciseId: sessionExercise.exerciseId, type: 'work',
        weightKg: planned,
        reps: null, targetReps: (t.repLow || 8) + '-' + (t.repHigh || 12), rir: null, done: false,
        lastTime: prev ? { weightKg: +prev.weightKg || 0, reps: +prev.reps || 0 } : null,
        // What this row is FOR, so the runner can label a backed-off second set as the deliberate
        // thing it is rather than leaving somebody to wonder why the app dropped their weight.
        backOff: !!(style.toFailure && lead && i > 0 && bothToFailure),
        // What THIS set is being asked for, since the last set of a movement is the all-out one and
        // the set before it is not. A single number on the movement cannot say that.
        targetRir: style.toFailure ? (i === n - 1 ? (t.rirLast == null ? t.rir : t.rirLast) : t.rir) : t.rir,
      });
    }
    return {
      sets: out,
      note: progressed ? progressed.reason : null,
      action: progressed ? progressed.action : null,
      suggested: progressed ? progressed.weightKg : null,
      stalled: progressed ? progressed.stalled || null : null,
    };
  }

  // Which weekday numbers a block trains, so the nutrition side can line carb-cycling high days up
  // with training days. This is the hook into Engine.cycling (see WORKOUTS_PLAN.md sec 9).
  // The weekdays a block does NOT train, which is a different thing from the days it has no session
  // left on. A rest day is prescribed: on min-max it is half of what makes the week work, and an app
  // that cannot tell one from a day you skipped is an app that makes a good week look like a bad one.
  function restDaysOfWeek(block, week) {
    var trained = {};
    weekSessions(block, week || 1).forEach(function (s) { trained[s.dayOfWeek] = 1; });
    var out = [];
    for (var d = 0; d < 7; d++) if (!trained[d]) out.push(d);
    return out;
  }

  function trainingDaysOfWeek(block) {
    var wk1 = weekSessions(block, 1);
    return uniq(wk1.map(function (s) { return s.dayOfWeek; })).sort();
  }

  var Training = {
    MUSCLES: MUSCLES, MUSCLE_LABEL: MUSCLE_LABEL, REGION: REGION, LANDMARKS: LANDMARKS,
    BANDS: BANDS, SHAPES: SHAPES, SPLITS: SPLITS, CARDIO: CARDIO, EXERCISES: EXERCISES, ALIASES: ALIASES,
    PRIMARY_WEIGHT: PRIMARY_WEIGHT, SECONDARY_WEIGHT: SECONDARY_WEIGHT,
    byId: byId, all: all, isCardio: isCardio, search: search, resolve: resolve, cleanName: cleanName,
    setContribution: setContribution, plannedVolume: plannedVolume, performedVolume: performedVolume,
    defaultTargets: defaultTargets, emphasise: emphasise, band: band, coverage: coverage, frequency: frequency, suggestFor: suggestFor,
    templateOf: templateOf, templatePayload: templatePayload, templateDays: templateDays, templateStyle: templateStyle, splitKind: splitKind, adoptTemplate: adoptTemplate, mergeDraftDays: mergeDraftDays,
    resolveDetail: resolveDetail, dayFocus: dayFocus, nameDay: nameDay, kitMismatch: kitMismatch,
    rerunPlan: rerunPlan, applyRerun: applyRerun, nextRunName: nextRunName, blockName: blockName, tidyName: tidyName,
    sameJob: sameJob, skillOf: skillOf, roleOf: roleOf, blocksRunOn: blocksRunOn, rirDrift: rirDrift,
    rotationPlan: rotationPlan, applyRotation: applyRotation, rotationChain: rotationChain, familyHistory: familyHistory,
    variationOf: variationOf, swapInBlock: swapInBlock, swapReach: swapReach,
    replacementsFor: replacementsFor, replaceExercise: replaceExercise, sameJobFor: sameJobFor,
    VARIANT_AXES: VARIANT_AXES, VARIANTS_FOR: VARIANTS_FOR,
    baseOf: baseOf, variantsOf: variantsOf,
    sessionItems: sessionItems, moveExercise: moveExercise, toggleSuperset: toggleSuperset,
    addExerciseToSession: addExerciseToSession, removeExerciseFromSession: removeExerciseFromSession,
    setExerciseTarget: setExerciseTarget, setSessionDay: setSessionDay, sessionsOnDay: sessionsOnDay,
    dropBrokenSupersets: dropBrokenSupersets,
    SETS_MIN: SETS_MIN, SETS_MAX: SETS_MAX, REPS_MIN: REPS_MIN, REPS_MAX: REPS_MAX, RIR_MAX: RIR_MAX,
    blockFixes: blockFixes, applyBlockFixes: applyBlockFixes,
    GYMS: GYMS, gymEquipment: gymEquipment, NEEDS_BENCH: NEEDS_BENCH, NEEDS_BAR: NEEDS_BAR,
    cueFor: cueFor, whyFor: whyFor, defaultTempo: defaultTempo, tempoParts: tempoParts, sessionCodes: sessionCodes,
    e1rm: e1rm, tonnage: tonnage, bestSet: bestSet, computePRs: computePRs, exerciseHistory: exerciseHistory,
    bestBefore: bestBefore, lastReference: lastReference, prKind: prKind, prsInLog: prsInLog, statSheet: statSheet, STAT_LABELS: STAT_LABELS,
    loadStep: loadStep, progressExercise: progressExercise, detectStall: detectStall,
    blockSpine: blockSpine, blockWeeks: blockWeeks, reschedule: reschedule, scheduleOf: scheduleOf, defaultDows: defaultDows,
    liftTrends: liftTrends,
    recommendedDows: recommendedDows, prescribesDays: prescribesDays,

    plateBreakdown: plateBreakdown, usesBar: usesBar, warmupSets: warmupSets, PLATES_KG: PLATES_KG, PLATES_LB: PLATES_LB,
    generateBlock: generateBlock, blockFromTemplate: blockFromTemplate, importTemplate: importTemplate,
    blockFromSource: blockFromSource, inspirationFrom: inspirationFrom,
    blockChoices: blockChoices, applyChoice: applyChoice, blocksFromFile: blocksFromFile,
    blockTweak: blockTweak, TWEAK_OPS: TWEAK_OPS, TWEAK_MAX_OPS: TWEAK_MAX_OPS,
    packBlock: packBlock, unpackBlock: unpackBlock, packBlocks: packBlocks, unpackBlocks: unpackBlocks,
    blocksFromGrid: blocksFromGrid, remapBlocks: remapBlocks,
    PROGRAMMES: PROGRAMMES, programmeOf: programmeOf, programmeBlock: programmeBlock, programmeSummary: programmeSummary,
    TECHNIQUES: TECHNIQUES, newItemFor: newItemFor, techniqueFor: techniqueFor, applyTechniques: applyTechniques, hasTechniques: hasTechniques,
    STYLES: STYLES, styleOf: styleOf, MINMAX_LANDMARKS: MINMAX_LANDMARKS, MINMAX_SPLITS: MINMAX_SPLITS,
    backOffLoad: backOffLoad, minmaxPlateau: minmaxPlateau, substituteFor: substituteFor,
    mergeCustom: mergeCustom, remapDays: remapDays,
    INTENSITY: INTENSITY, intensityOf: intensityOf,
    weekSessions: weekSessions, blockWeekVolume: blockWeekVolume,
    blockProgress: blockProgress, completion: completion, sessionOpen: sessionOpen,
    reviewBlock: reviewBlock, trainingSummary: trainingSummary,
    tuneTargets: tuneTargets, targetChanges: targetChanges, nextBlock: nextBlock, prefillSets: prefillSets, deloadAdvice: deloadAdvice, readinessAdjust: readinessAdjust,
    trainingDaysOfWeek: trainingDaysOfWeek, restDaysOfWeek: restDaysOfWeek, round: round,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Training;
  root.Training = Training;
})(typeof window !== 'undefined' ? window : this);
