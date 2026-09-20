/* ================================================================
   LEVEL UP — Solo Leveling style skill/habit tracker
   ================================================================
   Single source of truth for all client-side logic:
     - Character leveling + XP bar
     - Per-skill leveling + cards
     - Daily quests
     - Trade/activity logging (manual + focus timer + quick-add)
     - Focus mode / Pomodoro-style timer with custom break points
     - Undo system (snapshot/restore around risky actions)
     - All the "juice": particles, screen shake, confetti, chimes

   Persistence: localStorage only (see STORAGE LAYER). Designed so a
   future backend (Flask + SQLite) can swap Store.getJSON/setJSON for
   real API calls without touching the rest of the app.

   HOW THIS FILE IS ORGANIZED
   ---------------------------
   Everything below runs top-to-bottom ONCE when the page loads, ending
   in the call to init() at the very bottom. init() is the entry point —
   read it first if you want the "what happens when the page opens"
   story. Everything above init() is just function/constant DEFINITIONS
   sitting there waiting to be called; nothing actually runs until
   something calls them.

   Numbered sections (1, 2, 3...) are a rough map, not strict boundaries
   — some helper functions live near where they're first used rather
   than in a perfectly separated section.
   ================================================================ */


/* ================================================================
   1. CONFIG
   ================================================================
   Tunable numbers that shape game-feel. Change these first if you
   want to adjust difficulty/pacing without touching any logic.
   ================================================================ */

   const IS_MOBILE = window.innerWidth <= 560; // matches your CSS breakpoint

const QUEST_HOURS_GOAL = 2;      // hours required to complete ONE daily quest (used when a quest is auto-generated or added without a custom hour target)
const QUEST_COUNT      = 3;      // how many activities show up as daily quests in "Automatic" mode
const QUEST_PAGE_SIZE  = 3;      // how many quest rows are shown per page in the quest modal before pagination kicks in
const BURST_RISE_MS    = 3000;  // duration (ms) of the particle-rise animation before a level-up/rank-up overlay actually opens — all the setTimeout delays in the celebration functions are offsets from this number
const DAILY_HOURS_CAP  = 16;    // hard ceiling on total hours loggable across ALL activities combined, per calendar day
const CARD_BOLT_DROP_MS    = 600;   // bolt drop speed once particles finish rising
const CARD_TEXT_DELAY_MS   = 150;   // buffer after impact before LEVEL UP text shows
const CARD_TEXT_VISIBLE_MS = 2000;  // LEVEL UP text stays up 2s
const CARD_BOLT_EXTRA_MS   = 1000; 
 // bolt lingers 1s after the text is gone
// Hunter ranks by CHARACTER level (NOT skill level — skill level drives
// the separate CARD_TIERS system further down). This array only stores
// the LEVEL THRESHOLDS and NAMES for each rank. It intentionally does
// NOT store colors anymore — colors live entirely in styles.css as CSS
// variables (--rank-E-color, --rank-D-color, --rank-B-color,
// --rank-S-color, all defined in :root). That split means:
//   - Want to change what E-rank costs to reach?      Edit HERE.
//   - Want to change what E-rank LOOKS like?           Edit styles.css.
// See getRank() just below for how a level maps to one of these.
const RANK_COLORS = {
    E: '#6b7590',
    D: '#3b7dd8',
    C: '#4fd8ff',
    B: '#7c5cd6',
    A: '#ff9a3d',
    S: '#ffcf6b'
};

const RANKS = [
    { min: 1,  name: 'E' },
    { min: 5,  name: 'D' },
    { min: 15, name: 'C' },
    { min: 30, name: 'B' },
    { min: 50, name: 'A' },
    { min: 75, name: 'S' }
];



/** Given a character level, returns the highest-tier RANKS entry whose
    `min` threshold has been reached. E.g. level 20 -> the 'B' entry
    (min 15), because 30 (the next entry's min) hasn't been reached yet. */
function getRank(level) {
    let current = RANKS[0];
    for (const r of RANKS) {
        if (level >= r.min) current = r;
    }
    return current;
}


/* ----------------------------------------------------------------
   SKILL CARD VISUAL SYSTEM (separate from character RANKS above)
   ----------------------------------------------------------------
   Each skill card's look is driven by CARD_TIERS below. This is a
   PER-SKILL system (each skill levels independently, e.g. "Coding"
   might be level 12 while "Guitar" is level 3) — completely separate
   from the character-wide RANKS array above.

   Design choice: NO interpolation/math between two "endpoints." Every
   number here is hand-typed by you. Each tier has exactly 3 "stages"
   (early/mid/late within that tier's level range), and each stage is
   a flat, fully-specified set of values. This means:
     - You can always name exactly which stage a given level falls into
     - Changing one stage's numbers can NEVER accidentally shift how
       any other stage looks (unlike a lerp/interpolation system,
       where every number is secretly a formula depending on two
       far-apart endpoints)
   ---------------------------------------------------------------- */
const CARD_TIERS = [
    { name: 'gray', minLevel: 1, color: '#7c88a3', stages: [
        { tint: 20,  glow: 0.12, border: 0.40, shine: 10 },   // stage 1 (just arrived at this tier)
        { tint: 50,  glow: 0.40, border: 0.60, shine: 40 },   // stage 2 (midway through)
        { tint: 100, glow: 0.50, border: 1., shine: 50 },   // stage 3 (about to rank up)
    ]},
    { name: 'lightblue', minLevel: 5, stageStep: 3, color: '#4fd8ff', stages: [
        { tint: 40,  glow: 0.22, border: 0.30, shine: 22 },
        { tint: 60, glow: 0.28, border: 0.50, shine: 50 },
        { tint: 100, glow: 1, border: 1, shine: 100 },
    ]},
      { name: 'darkblue', minLevel: 15, stageStep: 3, color: '#5c85dc', stages: [
        { tint: 10, glow: 0.28, border: 0.2, shine: 26, color: '#406dcd' },
        { tint: 40, glow: 0.34, border: 0.55, shine: 34, color: '#5281e6' },
        { tint: 60, glow: 0.40, border: 1, shine: 42, color: '#6a94e6' },
    ]},
    { name: 'purple', minLevel: 30, stageStep: 5, color: '#8b8bf3', stages: [
        { tint: 40, glow: 0.34, border: 0.20, shine: 30 },
        { tint: 50, glow: 0.40, border: 0.40, shine: 38 },
        { tint: 60, glow: 0.46, border: 0.60, shine: 46 },
        { tint: 80, glow: 0.40, border: 0.85, shine: 38 },
        { tint: 100, glow: 0.46, border: 1, shine: 46 },
    ]},
    { name: 'orange', minLevel: 50, color: '#ff9a3d', stages: [
        { tint: 14, glow: 0.40, border: 0.55, shine: 34 },
        { tint: 17, glow: 0.46, border: 0.65, shine: 42 },
        { tint: 20, glow: 0.52, border: 0.75, shine: 50 },
    ]},
    { name: 'gold', minLevel: 75, color: '#ffc857', stages: [
        { tint: 16, glow: 0.46, border: 0.65, shine: 40 },
        { tint: 19, glow: 0.54, border: 0.78, shine: 50 },
        { tint: 22, glow: 0.62, border: 0.90, shine: 60 },
    ]},
];




function getCardLook(level) {
    let tierIdx = 0;
    for (let i = 0; i < CARD_TIERS.length; i++) {
        if (level >= CARD_TIERS[i].minLevel) tierIdx = i;
    }
    const tier = CARD_TIERS[tierIdx];
    const into = level - tier.minLevel;

    let stageIdx;
    if (tier.stageStep) {
        // fixed levels-per-stage — e.g. stageStep 3 means stage boundaries
        // fall every 3 levels from minLevel, clamped to the last defined stage
        stageIdx = Math.min(tier.stages.length - 1, Math.floor(into / tier.stageStep));
    } else {
        // original behavior: divide the tier's whole range evenly into 3
        const next = CARD_TIERS[tierIdx + 1];
        const rangeEnd = next ? next.minLevel - 1 : 100;
        const span = rangeEnd - tier.minLevel + 1;
        stageIdx = Math.min(tier.stages.length - 1, Math.floor((into / span) * tier.stages.length));
    }

       const stage = tier.stages[stageIdx];
    return { name: tier.name, color: stage.color || tier.color, ...stage, stageIdx };
}

/** Writes the computed look for a skill's current level onto its
    <li class="card"> element as CSS custom properties. The actual
    visual recipe (how --tint/--glow-strength/etc turn into gradients,
    borders, glow) lives in styles.css §9 — this function ONLY decides
    the NUMBERS, never draws anything itself. */
function applyCardEvolution(item, data) {
    const look = getCardLook(data.Level);
    item.style.setProperty('--card-color', look.color);
    item.style.setProperty('--rank-color', look.color);      // duplicate var name used by a couple of older CSS rules (card-icon glow, level-pill border) — kept for compatibility
    item.style.setProperty('--tint', look.tint + '%');
    item.style.setProperty('--glow-strength', look.glow);     // NOT a percentage — used directly as a 0–1 multiplier in styles.css
    item.style.setProperty('--border-strength', look.border); // also 0–1, multiplied by 100% inside a color-mix() in CSS
    item.style.setProperty('--shine', look.shine + '%');
    item.dataset.cardRank = look.name;     // exposed as data-card-rank="..." on the element, handy for debugging in devtools
    item.dataset.cardStage = look.stageIdx + 1; // 1-indexed for humans (stage 1/2/3 instead of 0/1/2)
}


/* ================================================================
   2. STORAGE LAYER
   ================================================================
   Every persisted value in this app goes through these four
   functions. Nothing else in the file talks to localStorage directly.
   This is deliberate: if you ever swap localStorage for a real
   backend (Flask + SQLite, per the file header), you only need to
   rewrite THESE four functions — every call site elsewhere (skills,
   streak, dailyQuest, etc.) stays untouched.
   ================================================================ */
const Store = {
    /** Reads a JSON value. Returns `fallback` if the key doesn't exist
        OR if the stored value fails to parse (corrupted/old-format data
        won't crash the app, it'll just silently fall back). */
    getJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            console.warn('Could not read/parse', key, e);
            return fallback;
        }
    },
    setJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('Could not save', key, e);
        }
    },
    /** Plain string read/write — used for simple scalar values
        (character name, streak count, mute flag) where wrapping in
        JSON would be pointless overhead. */
    getStr(key, fallback) {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : raw;
    },
    setStr(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (e) {
            console.warn('Could not save', key, e);
        }
    }
};

function recordHistoryPoint() {
    const idx = history.findIndex(h => h.date === today);
    if (idx >= 0) history[idx].totalHours = totalHours;
    else history.push({ date: today, totalHours });
    Store.setJSON('history', history);
}


/* ================================================================
   3. UTILITIES
   ================================================================
   Small, stateless helper functions used throughout the file. None
   of these touch `el`, localStorage, or any global state — pure
   input-in, output-out functions, safe to call from anywhere.
   ================================================================ */

/** Rounds to 2 decimal places. Used everywhere hours get added/summed
    so floating-point drift (0.1 + 0.2 = 0.30000000000000004 in JS)
    never leaks into what the user sees or what gets saved. */
function round2(n) { return Math.round(n * 100) / 100; }

/** Escapes a string for safe insertion into innerHTML (prevents a
    skill/activity name containing "<script>" etc. from being executed
    as real HTML). Works by letting the browser's own DOM text-escaping
    do the job: set as textContent, read back as innerHTML. */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/* LEVEL_MINUTES_TABLE — the XP curve.
   Key = level number (as a string, since object keys are always
   strings in JS), value = minutes of logged activity required to
   go from that level to the next one.

   Current design: levels 1–10 ramp up fast (15 to 180 min) so new
   users hit early level-ups quickly and get hooked. Levels 11–50
   scale up toward roughly 1000 CUMULATIVE hours total by level 50
   (a long-haul mastery curve). Levels 51–100 intentionally drop back
   down to a flat, much shorter per-level cost — this was a deliberate
   design choice so the back half of the level range doesn't feel like
   an eternal grind; treat it as "endgame levels come faster."
   If you want the exact cumulative total to hit a different number,
   the fastest way is to sum this table (levels 1–50) and scale every
   value in the 11–50 range up or down proportionally. */

const CHARACTER_LEVEL_SCALE = 6; // character needs 6x a single skill's per-level cost — tune this
function hoursNeededForCharacterLevel(level) {
    return hoursNeededForLevel(level) * CHARACTER_LEVEL_SCALE;
}

const LEVEL_MINUTES_TABLE = {
    "1":15,"2":30,"3":45,"4":60,"5":75,"6":90,"7":105,"8":120,"9":120,"10":150,
    "11":150,"12":150,"13":150,"14":165,"15":180,

    "16":300,"17":300,"18":300,"19":300,"20":300,

    "21":450,"22":450,"23":450,"24":450,"25":450,"26":450,"27":450,"28":450,"29":450,"30":450,

    "31":600,"32":600,"33":600,"34":600,"35":600,"36":600,"37":600,"38":600,"39":600,"40":600,

    "41":750,"42":750,"43":750,"44":750,"45":750,"46":750,"47":750,"48":750,"49":750,"50":750,

    "51":900,"52":900,"53":900,"54":900,"55":900,"56":900,"57":900,"58":900,"59":900,"60":900,

    "61":1080,"62":1080,"63":1080,"64":1080,"65":1080,"66":1080,"67":1080,"68":1080,"69":1080,"70":1080,

    "71":1260,"72":1260,"73":1260,"74":1260,"75":1260,"76":1260,"77":1260,"78":1260,"79":1260,"80":1260,

    "81":1440,"82":1440,"83":1440,"84":1440,"85":1440,"86":1440,"87":1440,"88":1440,"89":1440,"90":1440,

    "91":1620,"92":1620,"93":1620,"94":1620,"95":1620,"96":1620,"97":1620,"98":1620,"99":1620,"100":1620
};

/** Converts a level's minute-cost (from the table above) into hours.
    Falls back to the level-100 value for anything beyond 100, so the
    game never breaks if somehow a level counter goes past the table's
    range. */
function hoursNeededForLevel(level) {
    const minutes = LEVEL_MINUTES_TABLE[level] ?? LEVEL_MINUTES_TABLE[100];
    return minutes / 60;
}

/** Human-readable hour formatting: "2 hours", "45m", "1h 30m". Used
    anywhere a duration is shown to the user (XP captions, card meta,
    quest status text, focus timer). */
function formatHours(h) {
    const totalMinutes = Math.round(h * 60);
    const hoursPart = Math.floor(totalMinutes / 60);
    const minutesPart = totalMinutes % 60;
    if (minutesPart === 0) return `${hoursPart} ${hoursPart === 1 ? 'hour' : 'hours'}`;
    if (hoursPart === 0) return `${minutesPart}m`;
    return `${hoursPart}h ${minutesPart}m`;
}

/** Formats a skill's XP progress as "current / total XP" text for the
    card. XP is just hours × 6 under the hood (see logProgress) — this
    function only handles the DISPLAY string, not the actual math of
    gaining XP. */
function formatXP(data) {
    const currentLevelXP = Math.round((data.hours - data.startxp) * 6);
    const totalXP = Math.round(data.totalXP);
    return `${currentLevelXP} / ${totalXP} XP`;
}

/** Formats "how much time is left before this skill levels up" for
    the bottom-right of a skill card. This REPLACED an earlier version
    that showed total hours logged — showing remaining time instead
    gives a clearer "how close am I" signal at a glance. */
function formatHoursRemaining(data) {
    const needed = hoursNeededForLevel(data.Level);
    const progress = data.hours - data.startxp;
    const remaining = Math.max(needed - progress, 0); // clamp at 0 in case of any rounding overshoot
    return `${formatHours(remaining)} left`;
}

/** Reads a pair of "hours" + "minutes" number inputs and combines them
    into one decimal-hours number. Used by every modal that has an
    Hours : Minutes input pair (log activity, quick-add, quest builder,
    quest editing). Returns 0 (not negative, not NaN) if both are empty
    or invalid, so callers can safely check `if (hours > 0)`. */
function readHoursMinutes(hoursEl, minutesEl) {
    const h = parseInt(hoursEl.value || 0, 10);
    const m = parseInt(minutesEl.value || 0, 10);
    const total = (isFinite(h) ? h : 0) + (isFinite(m) ? m : 0) / 60;
    return total > 0 ? total : 0;
}

/** The inverse of readHoursMinutes — given a decimal-hours number,
    fills the paired Hours/Minutes inputs. Used when a preset chip
    (e.g. "1.5h") is clicked, to reflect that choice back into the
    raw number inputs. Empty inputs show as blank (not "0") for a
    cleaner look, via the `|| ''` fallback. */
function writeHoursMinutes(hoursEl, minutesEl, totalHours) {
    const hrs = Math.floor(totalHours);
    const mins = Math.round((totalHours - hrs) * 60);
    hoursEl.value = hrs || '';
    minutesEl.value = mins || '';
}

/** Fisher–Yates shuffle. Returns a NEW array (doesn't mutate the one
    passed in) — used by pickQuestActivities() to randomly select which
    skills become today's auto-generated quests. */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/* --- Short, single-purpose "juice" triggers ---------------------------
   Each of these adds a CSS class for a fixed duration then removes it,
   letting a CSS animation/transition do the actual visual work. Kept
   as separate named functions (rather than inlined everywhere) so the
   celebration sequences later in the file read like a readable script:
   "freeze the world, then shake the screen, then impact the avatar..."
   instead of a wall of raw classList calls. */
function freezeWorld() {
    document.body.classList.add('time-stop');
    setTimeout(() => document.body.classList.remove('time-stop'), 120);
}
function shakeScreen() {
    const scrollY = window.scrollY; // remember where we were
    document.body.classList.add('screen-shake');
    setTimeout(() => {
        document.body.classList.remove('screen-shake');
        window.scrollTo(0, scrollY); // snap back in case the shake nudged it
    }, 1000);
}
function impactAvatar() {
    // remove-then-reflow-then-add is the standard trick for restarting
    // a CSS animation on an element that might already have it applied
    // (e.g. two rank-ups in quick succession) — without this, adding
    // the same class twice in a row does nothing the second time.
    el.avatarFrame.classList.remove('avatar-impact');
    void el.avatarFrame.offsetWidth; // forces the browser to recompute layout NOW, "flushing" the removal before we re-add
    el.avatarFrame.classList.add('avatar-impact');
}
function blastRing() {
    el.avatarRing.classList.remove('active');
    void el.avatarRing.offsetWidth;
    el.avatarRing.classList.add('active');
}
function punchTimer() {
    el.timerDisplay.classList.remove('timer-punch');
    void el.timerDisplay.offsetWidth;
    el.timerDisplay.classList.add('timer-punch');
}

/** Opens the streak notification modal. Currently wired to a temporary
    30-second setTimeout in init() for testing — see the note down
    there. Eventually this should be called from real streak-checking
    logic (e.g. "it's evening and today hasn't been logged yet") rather
    than a fixed timer. */
function showStreakNotification() {
    celebrateStreakContinued(streak || 1); // routes through the real celebration instead of opening a bare modal
}




/* ================================================================
   4. STATE
   ================================================================
   Every mutable variable the app cares about across its lifetime,
   all declared up top so it's obvious at a glance what "the app's
   memory" consists of. Everything here either gets restored from
   localStorage in init(), or starts at a sensible default and gets
   changed by user actions as the app runs.
   ================================================================ */
let history = [];   // [{ date: 'Mon Aug 24 2026', totalHours: 12.5 }, ...] — one entry per calendar day
   let skills = {};              // { [activityName]: { XP, hours, Level, startxp, totalXP, card } } — `card` is a live reference to that skill's DOM element
let level = 1;                 // character level (separate from any individual skill's level)
let totalHours = 0;            // character-wide cumulative hours across ALL skills combined
let starthours = 0;            // totalHours value at which the CURRENT character level began (used to compute XP-bar progress)
let streak = 0;                 // consecutive-day logging streak
let today = new Date().toDateString();  // computed ONCE at page load — deliberately not re-computed on every check, so "today" stays stable for the whole session even if it's near midnight
let dailyQuest = null;          // today's quest state object, loaded/created in loadOrCreateQuest()
let dailyLog = null;            // today's per-activity hours log, loaded/created in loadOrCreateDailyLog()
let editingQuestActivity = null; // which quest (by activity name) is currently in "edit" mode in the quest list, or null if none
let currentQuestPage = 0;        // which page of the quest list is currently shown (quests are paginated QUEST_PAGE_SIZE at a time)
let characterName = 'Hunter';    // editable display name shown in the profile bar
let soundMuted = false;          // global mute flag for playChime/playHoverTick
let pendingDelete = null;        // which skill (by name) the delete-confirmation modal is about to delete, or null
let levelupTimer = null;         // handle for the setTimeout that auto-closes the level-up/ARISE overlay, so a new celebration can cancel a still-pending auto-close from a previous one

let quickAddSkill = null;        // which skill the Quick-Add modal is currently targeting

// --- Focus Mode / Pomodoro timer state ---
let sessionElapsedSeconds = 0;   // total seconds elapsed in the CURRENT focus session (work + break combined) — drives the big timer display
let focusPhases = [];            // array of { type: 'work'|'break', seconds } built by buildFocusPhases() for the current session
let currentPhaseIdx = 0;         // index into focusPhases for whichever phase is currently running
let workSecondsAccrued = 0;      // seconds spent specifically in 'work' phases (breaks don't count) — this is what actually gets logged as progress when the session ends
let selectedSkill = null;        // which skill the user picked in the Focus Mode setup screen
let selectedHours = null;        // chosen session length (decimal hours) from the Focus Mode setup screen
let focusInterval = null;        // handle for the setInterval driving the countdown, so it can be cleared on pause/finish
let secondsRemaining = 0;        // seconds left in the CURRENT phase (work or break) — separate from sessionElapsedSeconds, which never resets between phases
let isPaused = false;
let wasPausedBeforeExit = false; // remembers pre-exit-confirm pause state, so cancelling the "exit session?" confirm can correctly resume (or not) the timer
let breakIdCounter = 0;          // incrementing ID used to give each dynamically-added break row a unique dataset.breakId


// --- Undo/Redo system state (see section 12b) ---
const MAX_UNDO_STEPS = 10; // cap how many steps back you can go, so the stacks don't grow forever
let undoStack = [];         // array of past snapshots, oldest first — .pop() gives the most recent
let redoStack = [];  

let questBuilderType = 'timed';// snapshots you've undone past, available to redo — cleared whenever a NEW action happens

/* ================================================================
   5. DOM REFERENCE CACHE
   ================================================================
   `el` is a plain object that holds a reference to every DOM element
   this app touches more than once. cacheRefs() fills it in ONE pass
   at startup (called first thing in init()) so the rest of the file
   never has to call document.querySelector() again — every other
   function just reads el.whateverItNeeds.

   Why bother? Two reasons: (1) querySelector is a real (if small)
   cost, and doing it once instead of every time a function runs adds
   up; (2) it's a built-in sanity check — if el.something is undefined
   somewhere, it's immediately obvious cacheRefs() has a typo or the
   HTML is missing that element, rather than that error surfacing as
   a confusing crash deep inside some unrelated function later.
   ================================================================ */
const el = {};

function cacheRefs() {

el.streakLightning = document.querySelector('#streak-lightning');


       el.flash          = document.querySelector('.flash');
    el.cardFlash      = document.querySelector('.card-flash');
    el.lightning       = document.querySelector('#lightning');
    el.cardLightningContainer = document.querySelector('#card-lightning-container');
    el.particles       = document.querySelector('#particles');
    el.blastLayer      = document.querySelector('#blast-layer');
    el.confettiLayer   = document.querySelector('#confetti-layer');
    el.levelupLabel = document.querySelector('#levelup-label');
    el.levelupLevel = document.querySelector('#levelup-level');
    el.levelupRank = document.querySelector('#levelup-rank');
    el.levelupEmblemLetter = document.querySelector('#levelup-emblem-letter');
    el.levelupEyebrow = document.querySelector('#levelup-eyebrow');
    el.levelupContinueBtn = document.querySelector('#levelup-continue-btn');
    el.logCancelBtn = document.querySelector('#log-cancel');

    el.log = document.querySelector('#log'); // the <ul> grid that all skill cards live inside

    el.xpBar        = document.querySelector('#xp-bar');
    el.xpCaption     = document.querySelector('#xp-caption');
    el.levelText     = document.querySelector('#level-text');
    el.rankBadge     = document.querySelector('#rank-badge');
    el.avatarFrame   = document.querySelector('#avatar-frame'); // note: no more el.avatarLetter — the letter avatar was replaced by an SVG icon that needs no JS reference at all

    el.avatarRing    = document.querySelector('#avatar-ring');
    el.charName      = document.querySelector('#char-name');

    el.questBtn     = document.querySelector('#quest');
    el.streakCount  = document.querySelector('#streak-count');
    el.muteBtn      = document.querySelector('#mute-toggle');
    el.undoBtn      = document.querySelector('#undo-btn');
    el.redoBtn = document.querySelector('#redo-btn');

    el.questModal     = document.querySelector('#quest-modal');
    el.questList       = document.querySelector('#quest-list');
    el.questPager       = document.querySelector('#quest-pager');
    el.questShowBuilder = document.querySelector('#quest-show-builder');
    el.questBuilder = document.querySelector('#quest-builder');
    el.questRerollBtn     = document.querySelector('#quest-reroll-btn');
    el.questActivityInput = document.querySelector('#quest-activity-input');
    el.questActivityChips = document.querySelector('#quest-activity-chips');
    el.questHoursH        = document.querySelector('#quest-hours-h');
    el.questHoursM        = document.querySelector('#quest-hours-m');
    el.questAddBtn        = document.querySelector('#quest-add-btn');
        el.questAddBtn        = document.querySelector('#quest-add-btn');
    el.questTypeTimedBtn  = document.querySelector('#quest-type-timed');
    el.questTypeTaskBtn   = document.querySelector('#quest-type-task');
    el.questHoursGroup    = document.querySelector('#quest-hours-group');
    el.questChoice          = document.querySelector('#quest-choice');
    el.questBody            = document.querySelector('#quest-body');
    el.questChooseManualBtn = document.querySelector('#quest-choose-manual');
    el.questChooseAutoBtn   = document.querySelector('#quest-choose-auto');
    el.questManualControls  = document.querySelector('#quest-manual-controls');
    el.questAutoControls    = document.querySelector('#quest-auto-controls');
    el.questCloseBtn   = document.querySelector('#quest-close-btn');

    el.logModal        = document.querySelector('#log-modal');
    el.logForm         = document.querySelector('#log-form');
    el.activityInput   = document.querySelector('#activity-input');
    el.activityChips   = document.querySelector('#activity-chips');
    el.hoursInputH     = document.querySelector('#hours-input-h');
    el.hoursInputM     = document.querySelector('#hours-input-m');
    el.logCancel       = document.querySelector('#log-cancel');
    el.logFab          = document.querySelector('#log-fab');



    el.deleteModal  = document.querySelector('#modal');
    el.confirmYes   = document.querySelector('#confirm-yes');
    el.confirmNo    = document.querySelector('#confirm-no');

    el.levelupOverlay = document.querySelector('#levelup-overlay');

    el.completeOverlay = document.querySelector('#complete-overlay');
    el.completeSkill    = document.querySelector('#complete-skill');
    el.completeTime      = document.querySelector('#complete-time');
    el.completeHome      = document.querySelector('#complete-home');
    el.completeAgain     = document.querySelector('#complete-again');

    el.quickaddModal    = document.querySelector('#quickadd-modal');
    el.quickaddTitle     = document.querySelector('#quickadd-title');
    el.quickaddHoursH      = document.querySelector('#quickadd-hours-h');
    el.quickaddHoursM      = document.querySelector('#quickadd-hours-m');
    el.quickaddCancel     = document.querySelector('#quickadd-cancel');
    el.quickaddConfirm     = document.querySelector('#quickadd-confirm');

    el.focusButton       = document.querySelector('#focusButton');
    el.focusOverlay      = document.querySelector('#focusOverlay');
    el.activeFocus        = document.querySelector('#activeFocus');
    el.skillSelect        = document.querySelector('#skillSelect');
    el.startFocusBtn       = document.querySelector('#startFocus');
    el.focusCancelBtn       = document.querySelector('#focusCancel');
    el.pauseFocusBtn         = document.querySelector('#pauseFocus');
    el.exitFocusBtn           = document.querySelector('#exitFocus');
    el.timerDisplay            = document.querySelector('#timer');
    el.currentSkillDisplay      = document.querySelector('#currentSkill');
    el.timeButtons               = document.querySelectorAll('.time-btn'); // NOTE: NodeList, not a single element — used with .forEach()
    el.customTimeRow              = document.querySelector('#customTimeRow');
    el.customHoursInput = document.querySelector('#customHoursInput');
    el.customMinutesInput = document.querySelector('#customMinutesInput');
    el.exitFocusModal                = document.querySelector('#exit-focus-modal');
    el.exitConfirmYes                 = document.querySelector('#exit-confirm-yes');
    el.exitConfirmNo                   = document.querySelector('#exit-confirm-no');
    el.dailyQuestTimeBtn                 = document.querySelector('#dailyQuestTimeBtn');
    el.activeFocusLabel                   = document.querySelector('#active-focus-label');
    el.phaseCountdown                      = document.querySelector('#phase-countdown');

    el.breakList   = document.querySelector('#breakList');
    el.addBreakBtn  = document.querySelector('#addBreakBtn');

    el.streakNotifyOverlay = document.querySelector('#streak-notify-overlay');

    el.themeToggle = document.querySelector('#theme-toggle');
   
    


}

/** Returns the list of "simple" modals that should close when the
    user clicks their dark backdrop (outside the modal card itself).
    Deliberately excludes modals with more deliberate confirm/cancel
    flows (delete confirm, exit-focus confirm, quest modal) — those
    are wired individually further down so an accidental backdrop
    click can't skip a confirmation step. */
function dismissableOverlays() {
    return [el.logModal, el.deleteModal, el.quickaddModal, el.focusOverlay, el.completeOverlay];
}


/* ================================================================
   21. SKILL CARD DRAG-TO-REORDER
   ================================================================
   Custom pointer-based drag (NOT native HTML5 drag-and-drop — that
   API is clunky for "live reordering with a snap-back if you drop
   outside the zone," which is exactly what this needs).

   THE CORE IDEA: while dragging, the REAL card becomes position:fixed
   and follows the cursor directly. A lightweight placeholder <li>
   sits in its old spot in the #log grid, holding that grid slot open.
   As you drag over other cards, the PLACEHOLDER moves around (not the
   real card) — so the grid re-flows live without the real card
   fighting the browser's own layout engine.

   On release:
     - Drop INSIDE #log's bounds  -> the real card is inserted where
       the placeholder currently sits, committing the new order.
     - Drop OUTSIDE #log's bounds -> the placeholder is just discarded
       without ever moving the real card, so it's guaranteed to end up
       exactly back where it started.
   Either way, snapIntoPlace() then animates the real card smoothly
   from wherever it visually was into its final resting position.
   ================================================================ */
const DRAG_START_THRESHOLD = 6; // pixels of movement required before a click is reinterpreted as a drag — keeps quick taps/clicks from accidentally triggering drag mode

/** Called once during setup. Attaches a SINGLE pointerdown listener to
    the whole #log container (event delegation) rather than one
    listener per card — this means newly created cards automatically
    support dragging with zero extra wiring, since the listener is on
    their shared parent, not on each card individually. */
function attachCardDragging() {
    el.log.addEventListener('pointerdown', onCardPointerDown);
}

function onCardPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.delete-btn, .quickadd-btn')) return;

    const card = e.target.closest('.card');
    if (!card || card.classList.contains('card-placeholder')) return;

    const isTouch = e.pointerType === 'touch';
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    let placeholder = null;
    let offsetX = 0, offsetY = 0;
    let longPressTimer = null;

    if (isTouch) {
        // On touch, dragging only starts after a deliberate hold — a quick
        // swipe is treated as a scroll instead, never a drag attempt.
        longPressTimer = setTimeout(() => {
            dragging = true;
            beginDrag();
        }, 450);
    }

    function onMove(ev) {
        if (isTouch && !dragging) {
            // Still waiting on the long-press timer — real movement this
            // early means the user is scrolling, not holding. Cancel the
            // pending drag and let the browser's native scroll take over.
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 10) {
                clearTimeout(longPressTimer);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
            }
            return;
        }
        if (!dragging) {
            if (isTouch) return; // touch NEVER starts a drag from movement alone, only from the long-press timer above
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START_THRESHOLD) return;
            dragging = true;
            beginDrag();
        }
        card.style.left = (ev.clientX - offsetX) + 'px';
        card.style.top  = (ev.clientY - offsetY) + 'px';
        updateDropTarget(ev);
    }

    function beginDrag() {
        const rect = card.getBoundingClientRect();
        offsetX = startX - rect.left;
        offsetY = startY - rect.top;

        // Placeholder takes over the card's old grid slot, matching its
        // measured size exactly so the grid doesn't visually jump when
        // the real card is pulled out of flow.
        placeholder = document.createElement('li');
        placeholder.className = 'card card-placeholder';
        placeholder.style.width  = rect.width + 'px';
        placeholder.style.height = rect.height + 'px';
        card.parentNode.insertBefore(placeholder, card);

        // Pull the real card OUT of normal document flow so it can
        // follow the cursor freely.
        card.classList.add('card-dragging');
        card.style.width = rect.width + 'px';   // fixed positioning loses the flex-item width, so lock it explicitly
        card.style.position = 'fixed';
        card.style.left = rect.left + 'px';
        card.style.top  = rect.top + 'px';
        card.style.zIndex = 4500;
        card.style.pointerEvents = 'none'; // critical: lets document.elementFromPoint() (below) "see through" the dragged card to whatever's underneath it
    }

    /** While dragging, figures out which card (if any) the cursor is
        currently hovering over, and moves the placeholder to just
        before or after it depending on which half of that card the
        cursor is on. This is what makes the reordering feel "live." */
    function updateDropTarget(ev) {
        // Briefly hide the dragged card so elementFromPoint can find
        // whatever's actually underneath the cursor instead of finding
        // the dragged card itself.
        card.style.display = 'none';
        const elUnder = document.elementFromPoint(ev.clientX, ev.clientY);
        card.style.display = '';

        const overCard = elUnder && elUnder.closest('.card');
        if (!overCard || overCard === placeholder || overCard.parentNode !== el.log) return;

        const overRect = overCard.getBoundingClientRect();
        const before = ev.clientX < overRect.left + overRect.width / 2; // cursor on the left half of the hovered card -> insert before it; right half -> insert after
        el.log.insertBefore(placeholder, before ? overCard : overCard.nextSibling);
    }

    function onUp(ev) {
        clearTimeout(longPressTimer);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!dragging) return; // it was just a click, not a drag — nothing to clean up, the click's own handler (delete/quickadd/etc, or nothing) already ran normally

        const logRect = el.log.getBoundingClientRect();
        const margin = 60; // a little slack around the grid's edges still counts as "inside" — makes it more forgiving to drop near the boundary
        const withinBounds =
            ev.clientX >= logRect.left - margin && ev.clientX <= logRect.right + margin &&
            ev.clientY >= logRect.top - margin && ev.clientY <= logRect.bottom + margin;

        endDrag(withinBounds);
    }

    function endDrag(commit) {
        card.classList.remove('card-dragging');
        if (commit) {
            // Insert the REAL card where the placeholder currently is,
            // which is wherever the user last dragged it to.
            placeholder.parentNode.insertBefore(card, placeholder);
        }
        // If NOT committing, we deliberately do nothing to the card's
        // DOM position here — it's still sitting wherever it originally
        // was in #log (the placeholder was inserted right next to it
        // and never moved it). Only the placeholder needs cleanup.
        placeholder.remove();
        snapIntoPlace(card, commit);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    if (!isTouch) e.preventDefault(); // only block native behavior for mouse — touch needs its default scroll to stay alive until a long-press actually commits to dragging
}

/** FLIP-animates `card` from wherever it currently visually is (its
    leftover position:fixed left/top from dragging) into wherever it
    naturally lands once normal document flow takes back over. Used
    both when a reorder is COMMITTED and when it's CANCELLED — the only
    difference between those two cases is whether the card's DOM
    position changed before this function runs; the animation logic
    itself doesn't need to know or care which happened. */
function snapIntoPlace(card, committed) {
    const fromLeft = parseFloat(card.style.left);
    const fromTop  = parseFloat(card.style.top);

    // Clear all the temporary drag-mode inline styles so the card goes
    // back to being a normal flex item, laid out by the grid.
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.zIndex = '';
    card.style.pointerEvents = '';

    // Now that it's back in normal flow, measure where the browser
    // actually put it.
    const toRect = card.getBoundingClientRect();
    const dx = fromLeft - toRect.left;
    const dy = fromTop - toRect.top;

    // FLIP technique: immediately (no transition) shift the card via
    // transform so it VISUALLY appears exactly where it was during the
    // drag, even though its real DOM position/layout has already
    // changed. Then, on the next frame, animate that transform back to
    // zero — the browser tweens the visual position smoothly from "old
    // spot" to "new spot" instead of just teleporting.
    card.style.transition = 'none';
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    void card.offsetWidth; // force a reflow so the browser "locks in" the above transform before the next line changes it — without this the two style changes could get batched together and skip the animation entirely

    requestAnimationFrame(() => {
        card.style.transition = 'transform 0.32s cubic-bezier(.2,.9,.3,1.2)';
        card.style.transform = '';
    });

    card.addEventListener('transitionend', function done(ev) {
        if (ev.propertyName !== 'transform') return; // ignore transitionend events from OTHER properties that might also be transitioning (e.g. hover effects)
        card.style.transition = '';
        card.removeEventListener('transitionend', done);
        if (committed) persistCardOrder(); // only save the new order to localStorage if this was an actual reorder, not a cancelled drag
    }, { once: true });
}

/** Reads the current DOM order of #log's children and saves it as an
    array of activity names to localStorage under 'cardOrder'. Called
    after every action that could change card order: a successful
    drag, a new card being created, or a card being deleted. Read back
    in init() to reconstruct the saved order on page load. */
function persistCardOrder() {
    const order = Array.from(el.log.children)
        .filter(c => c.classList.contains('card') && !c.classList.contains('card-placeholder')) // just in case a placeholder somehow still exists when this runs
        .map(c => c.dataset.activity)
        .filter(Boolean); // drops any card missing a data-activity attribute, just as a safety net
    Store.setJSON('cardOrder', order);
}


/* ================================================================
   6. GENERIC MODAL OPEN / CLOSE
   ================================================================
   Every modal in this app (log, quest, stats, delete-confirm,
   quickadd, focus overlays, level-up overlay, streak notification)
   shares this same open/close mechanism. `overlay.style.display` and
   the `.active` CSS class are handled separately on purpose:
     - display:flex/none controls whether the overlay exists in the
       layout AT ALL (so it doesn't intercept clicks when "closed").
     - .active controls the actual fade/scale-in CSS transition.
   They're offset by a couple of animation frames so the browser has
   a chance to register the element as "displayed" before starting
   the transition — flipping both at once would make the transition
   silently not play, since the element wasn't visible yet at the
   moment the class was added.
   ================================================================ */
function openModal(overlay) {
    overlay.style.display = 'flex';

    // modalToken guards against a rapid open/close/open sequence
    // racing itself — e.g. if a modal is closed and reopened within
    // the same animation-frame window, the STALE closing animation's
    // delayed classList change shouldn't be allowed to stomp on the
    // fresh opening state. Each open/close bumps the token; a delayed
    // callback checks it's still the CURRENT token before acting.
    const token = (Number(overlay.dataset.modalToken) || 0) + 1;
    overlay.dataset.modalToken = token;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (Number(overlay.dataset.modalToken) === token) overlay.classList.add('active');
    }));
}
function closeModal(overlay) {
    overlay.dataset.modalToken = (Number(overlay.dataset.modalToken) || 0) + 1;
    overlay.classList.remove('active'); // starts the fade/scale-out transition
    setTimeout(() => { overlay.style.display = 'none'; }, 260); // only removes it from layout AFTER the transition has had time to finish, so it doesn't visually snap away mid-animation
}


/* ================================================================
   7. AMBIENT PARTICLES + LEVEL-UP EFFECTS
   ================================================================
   All the particle-generation code. Two flavors:
     - initParticles(): the slow-drifting background embers that are
       always present, generated once at startup.
     - surgeParticles(): a short, intense burst used during
       level-up/rank-up celebrations, generated fresh each time.
   ================================================================ */

/** Creates the permanent pool of ~215 slowly-rising ambient ember
    particles. Called once in init(). Each one gets randomized size,
    color, position, and animation timing so the effect doesn't look
    mechanically repetitive. */
function initParticles() {
      const colors = ['var(--current-rank-color)','var(--current-rank-color)', 'var(--current-rank-color)'];
    const count = IS_MOBILE ? 60 : 215;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'ember';
        const c = colors[Math.floor(Math.random() * colors.length)];
        const size = (1 + Math.random() * 2).toFixed(1);
        p.style.left = (Math.random() * 100).toFixed(1) + '%';
        p.style.width = size + 'px';   // NOTE: this looks like it should probably be `size + 'px'` — as written it concatenates the size number directly onto the string "400px" (e.g. "1.5400px"), which the browser will treat as an invalid value and ignore, silently falling back to CSS defaults/inheritance for width. Left as-is since it's pre-existing behavior you may be relying on visually, but flagging it in case the ember sizing ever looks "off" and you go looking for why.
        p.style.height = size + 'px';  // same pattern here
        p.style.background = c;
        p.style.boxShadow = `0 0 6px ${c}`;
        p.style.animationDelay = (Math.random() * 14).toFixed(2) + 's';
        p.style.animationDuration = (10 + Math.random() * 10).toFixed(2) + 's';
        el.particles.appendChild(p);
    }
}

/** Fires a short, intense burst of particles rising from the bottom of
    the screen — used for both regular level-ups and rank-ups (with
    different color palettes, see RANK_PARTICLE_COLORS below). Also
    temporarily speeds up the ambient embers so the WHOLE screen feels
    energized during the burst, then restores their normal speed once
    it's over.
      chargeAvatar: whether to also add the avatar "charging" glow
                    animation (used for rank-ups, not plain skill
                    level-ups).
      colors: array of hex colors to randomly draw from for this
              particular burst — lets rank-ups use rank-appropriate
              colors instead of the default blue/cyan palette. */
function surgeParticles(chargeAvatar = true, colors = ['#ffffff', '#c9f0ff', '#8be9ff', '#3a8dff', '#1b4dcc']) {
    const ambientEmbers = el.particles.querySelectorAll('.ember:not(.burst-ember)');
    ambientEmbers.forEach(p => {
        // Remember each ember's ORIGINAL animation-duration (only once —
        // dataset.origDuration acts as a "have we already saved this"
        // flag) before speeding it up, so it can be restored later.
        if (!p.dataset.origDuration) p.dataset.origDuration = p.style.animationDuration;
        p.style.animationDuration = (parseFloat(p.dataset.origDuration) * 0.2).toFixed(2) + 's'; // 5x faster during the burst
    });
    if (chargeAvatar) el.avatarFrame.classList.add('avatar-charge');

    const burstCount = IS_MOBILE ? 25 : 90;
    for (let i = 0; i < burstCount; i++) {
        const p = document.createElement('div');
        p.className = 'ember burst-ember';
        const color = colors[Math.floor(Math.random() * colors.length)];
        const width = 3 + Math.random() * 2;
        const height = 10 + Math.random() * 8;
        p.style.width = width + 'px';
        p.style.height = height + 'px';
        p.style.left = (Math.random() * 100).toFixed(1) + '%';
        p.style.bottom = (-20 - Math.random() * 30).toFixed(0) + 'px'; // starts slightly below the visible screen so the rise-in feels continuous
        p.style.background = `linear-gradient(180deg, #ffffff, ${color})`;
        p.style.borderRadius = '3px';
        p.style.boxShadow = `0 0 8px ${color}, 0 0 20px ${color}, 0 0 40px rgba(255,255,255,0.55)`;
        p.style.transformOrigin = 'bottom center';
        p.style.animationDuration = BURST_RISE_MS + 'ms';
        p.style.animationDelay = (Math.random() * 150).toFixed(0) + 'ms'; // slight stagger so the burst doesn't look like one flat wall rising at once
        el.particles.appendChild(p);
        p.addEventListener('animationend', () => p.remove(), { once: true }); // burst particles are one-shot — they clean themselves up as soon as their animation finishes, rather than sitting in the DOM forever
    }

    // Restore ambient embers to normal speed shortly before the burst
    // animation itself fully finishes, so the transition back to
    // "calm" feels timed rather than abrupt.
    setTimeout(() => {
        ambientEmbers.forEach(p => {
            if (p.dataset.origDuration) p.style.animationDuration = p.dataset.origDuration;
        });
    }, BURST_RISE_MS - 300);

    setTimeout(() => {
        if (chargeAvatar) el.avatarFrame.classList.remove('avatar-charge');
    }, BURST_RISE_MS + 400);
}

/** Fires the screen-wide lightning-flash effect (white flash + a bolt
    icon that scales/fades). Used at the peak moment of a celebration,
    timed via BURST_RISE_MS in the calling function. */

/** Same remove→reflow→add restart trick as the other one-shot effects.
    Fires the slow drop-down bolt used exclusively for streak-continued. */
function triggerStreakLightning() {
    el.streakLightning.classList.remove('active', 'leaving');

    void el.streakLightning.offsetWidth;

    el.streakLightning.classList.add('active');

    /*
     * The SVG energy paths are CSS-animated:
     *
     * TOP:
     *     L -> N
     *     starts immediately
     *
     * BOTTOM:
     *     G -> N
     *     starts 1 second later
     *
     * Both travel for approximately 3 seconds.
     */
    const streakOverlay = el.streakNotifyOverlay;

    streakOverlay.classList.remove('streak-energy-active');
    void streakOverlay.offsetWidth;
    streakOverlay.classList.add('streak-energy-active');

    // The central bolt remains through the initial strike.
}
function retireStreakLightning() {
    el.streakLightning.classList.remove('active');

    el.streakLightning.classList.add('leaving');

    const streakOverlay = el.streakNotifyOverlay;
    streakOverlay.classList.remove('streak-energy-active');

    setTimeout(() => {
        el.streakLightning.classList.remove('leaving');
    }, 5000);
}

function triggerFlash() {
    el.flash.classList.remove('lightning');
    void el.flash.offsetWidth;
    el.flash.classList.add('lightning');
    setTimeout(() => el.flash.classList.remove('lightning'), 5000);

    el.lightning.classList.remove('active');
    void el.lightning.offsetWidth;
    el.lightning.classList.add('active');
    setTimeout(() => el.lightning.classList.remove('active'), 1000);
}

/** Skill-card-level-up-only bolt: a thin diagonal streak that draws
    from top-right to bottom-left (a little right of dead-center),
    backed by a softer glow line, then a short shake + quick blue
    flash. Fully separate from #lightning (avatar/rank bolt) and
    #streak-lightning (streak drop-bolt). */
function triggerCardLightning() {
    const container = el.cardLightningContainer;

    container.style.setProperty(
        '--card-bolt-duration',
        CARD_BOLT_DROP_MS + 'ms'
    );

    container.classList.remove('active');

    void container.offsetWidth;

    container.classList.add('active');

    setTimeout(() => {
        const scrollY = window.scrollY;

        document.body.classList.remove('card-shake-heavy');
        void document.body.offsetWidth;
        document.body.classList.add('card-shake-heavy');

        setTimeout(() => {
            document.body.classList.remove('card-shake-heavy');
            window.scrollTo(0, scrollY);
        }, 500);
    }, CARD_BOLT_DROP_MS);

    const totalVisibleMs =
        CARD_BOLT_DROP_MS +
        CARD_TEXT_DELAY_MS +
        CARD_TEXT_VISIBLE_MS +
        CARD_BOLT_EXTRA_MS;

    setTimeout(() => {
        container.classList.remove('active');
    }, totalVisibleMs);
}
/** Spawns `count` small circular pieces that explode outward from the
    center of the screen in random directions — used for the
    Training-Complete celebration (see celebrateTrainingComplete). */
function spawnBlast(count) {
    const colors = ['#ffffff', '#8be9ff', '#5fdcff', '#36cfff'];
    for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'blast-piece';
        const angle = Math.random() * Math.PI * 2;      // random direction, in radians
        const distance = 120 + Math.random() * 220;       // random travel distance
        const bx = Math.cos(angle) * distance;             // x/y offset computed from angle+distance, fed to CSS as --bx/--by custom properties (see styles.css .blast-piece / @keyframes blastOut)
        const by = Math.sin(angle) * distance;
        const size = 6 + Math.random() * 10;
        piece.style.width = size + 'px';
        piece.style.height = size + 'px';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.boxShadow = '0 0 10px currentColor';
        piece.style.setProperty('--bx', bx.toFixed(1) + 'px');
        piece.style.setProperty('--by', by.toFixed(1) + 'px');
        piece.style.animationDelay = (Math.random() * 60).toFixed(0) + 'ms';
        el.blastLayer.appendChild(piece);
        piece.addEventListener('animationend', () => piece.remove(), { once: true });
    }
}

/** Spawns `count` confetti pieces radiating from a specific screen
    position (given as percentages of viewport width/height, so it
    still works correctly if the window is resized). Used both for
    the big level-up celebration (radiating from screen center-ish)
    and the small quest-complete pop (radiating from the quest
    button's actual position). */
function spawnConfetti(count, originXPercent, originYPercent) {
    const colors = ['#c9f0ff', 'var(--cyan)', '#3a8dff', '#1b4dcc'];
    for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        const angle = Math.random() * Math.PI * 2;
        const distance = 60 + Math.random() * 140;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        const size = 6 + Math.random() * 6;
        piece.style.width = size + 'px';
        piece.style.height = size + 'px';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px'; // random mix of round/square confetti pieces
        piece.style.setProperty('--dx', dx.toFixed(1) + 'px');
        piece.style.setProperty('--dy', dy.toFixed(1) + 'px');
        piece.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg'); // random spin, up to two full rotations either direction
        piece.style.left = originXPercent + '%';
        piece.style.top = originYPercent + '%';
        piece.style.background = colors[i % colors.length]; // cycles through the palette in order rather than randomly, for a more even color spread
        piece.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
        el.confettiLayer.appendChild(piece);
        piece.addEventListener('animationend', () => piece.remove(), { once: true });
    }
}


/* ================================================================
   8. AUDIO
   ================================================================
   All sound in this app is generated procedurally via the Web Audio
   API — there are no audio FILES being loaded/played anywhere. This
   keeps the app self-contained (no asset loading, no network
   requests, no file-size concerns) at the cost of the sounds being
   simple synthesized tones/noise rather than sampled audio.
   ================================================================ */
let audioCtx = null; // created lazily on first use, not at page load — browsers block audio contexts from starting until the user has interacted with the page at least once, so creating it eagerly at load time would just fail silently anyway

/** Returns the shared AudioContext, creating it on first call. Safe to
    call repeatedly — after the first successful creation, this just
    returns the same instance every time. */
function ensureAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } // webkitAudioContext fallback for older Safari
        catch (e) { audioCtx = null; }
    }
    return audioCtx;
}

/** Plays a short chime built from a handful of sine-wave notes played
    in a quick arpeggio. `big` picks between a longer 4-note "major"
    sounding chime (level-ups, rank-ups) and a shorter 2-note one
    (phase transitions, quest completions). Each note gets its own
    oscillator + gain node with a quick attack/decay envelope so notes
    don't click or pop at the start/end. */
function playChime(big) {
    if (soundMuted) return;
    const ctx = ensureAudio();
    if (!ctx) return; // AudioContext creation can fail in some environments — fail silently rather than throwing
    const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77]; // frequencies in Hz — C5/E5/G5/C6 for the big chime, E5/B5 for the small one
    notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + i * 0.09; // stagger each note slightly so they play as a quick arpeggio rather than all at once
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.15, t0 + 0.02);        // quick fade-in (attack)
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);  // longer fade-out (decay) — exponential ramp sounds more natural than linear for decay
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.4);
    });
}

/** Toggles the mute button's icon/label to match the current
    soundMuted state. Called once at startup (to reflect the saved
    preference) and again every time the mute button is clicked. */
function updateMuteIcon() {
    el.muteBtn.textContent = soundMuted ? '🔇' : '🔊';
    el.muteBtn.setAttribute('aria-label', soundMuted ? 'Unmute sound' : 'Mute sound');
}


/* ================================================================
   9. CELEBRATION SEQUENCES
   ================================================================
   The choreographed, multi-step animations for the app's big
   "reward" moments. Each of these is basically a script: fire off
   several of the effects defined above, each offset by a setTimeout
   delay, so the whole thing feels like a directed sequence rather
   than everything happening at once.
   ================================================================ */

/** Plays when an individual SKILL levels up. Always shows a small
    floating "LEVEL UP" badge above that skill's card. Additionally
    shows the big full-screen overlay UNLESS showOverlay is false —
    that flag exists specifically for the case where a character
    rank-up (celebrateShadowRankUp) is ALSO happening at the same
    moment; in that case the rank-up gets the big overlay and the
    skill level-up just gets its small card badge, so the two
    celebrations don't visually compete with each other. */


    /** Lightens/darkens a hex color by percent (-100 to 100). Used to build
    a burst palette from a single card color. */
function shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#',''), 16);
    let r = (num >> 16) + Math.round(255 * (percent / 100));
    let g = ((num >> 8) & 0x00FF) + Math.round(255 * (percent / 100));
    let b = (num & 0x0000FF) + Math.round(255 * (percent / 100));
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return '#' + (0x1000000 + r*0x10000 + g*0x100 + b).toString(16).slice(1);
}

function buildCardParticlePalette(cardColor) {
    return [
        shadeColor(cardColor, 40),
        shadeColor(cardColor, 20),
        cardColor,
        shadeColor(cardColor, -20),
        shadeColor(cardColor, -40)
    ];
}


function celebrateSkillLevelUp(activity, newLevel, showOverlay = true) {
    const skill = skills[activity];

    /*
     * The card has already been refreshed to the new level before this
     * function runs, so get the exact color that the card is now using.
     */
    const cardColor = getCardLook(newLevel).color;

    /*
     * Everything in this celebration uses the SAME color:
     * particles, bolt, pulse and LEVEL UP text.
     */
    el.cardLightningContainer.style.setProperty('--card-bolt-color', cardColor);
    el.levelupOverlay.style.setProperty('--levelup-color', cardColor);

    clearTimeout(levelupTimer);

/*
 * 1. PARTICLES
 * Start immediately and let them rise for 3 seconds.
 */
const cardParticles = buildCardParticlePalette(cardColor);
surgeParticles(false, cardParticles);

playChime(true);

    setTimeout(() => {
        triggerCardLightning();
    }, BURST_RISE_MS); // bolt drops right as particles finish rising to the top

   

    if (!showOverlay) return;

    const textShowDelay = BURST_RISE_MS + CARD_BOLT_DROP_MS + CARD_TEXT_DELAY_MS;
    setTimeout(() => {
        el.levelupLevel.textContent = newLevel;
        el.levelupLabel.textContent = 'LEVEL UP';
        el.levelupRank.textContent = activity;
        el.levelupRank.style.display = 'block';

        openModal(el.levelupOverlay);

        levelupTimer = setTimeout(() => {
            closeModal(el.levelupOverlay);
        }, CARD_TEXT_VISIBLE_MS);
    }, textShowDelay);
}




/* Separate palette per rank for the rank-up particle burst — kept
   distinct from the CSS-driven --rank-X-color variables because these
   are FIVE shades each (for burst variety), not one flat color each. */
const RANK_PARTICLE_COLORS = {
    E: ['#2a2e3d', '#3a3f52', '#565c73', '#7c88a3', '#9aa6c2'],
    D: ['#0d1424', '#1b2440', '#2c3a63', '#44578c', '#5a76b0'],
    C: ['#0a2e33', '#134a52', '#1f7a87', '#3fc2d6', '#8be9ff'],
      B: ['#05030a', '#0d0614', '#1a1030', '#3a2a6b', '#5a3fa0'],
    A: ['#331a05', '#5c2f0a', '#a35414', '#e08633', '#ffb066'],
    S: ['#1a1206', '#3d2c0a', '#7a5a12', '#c99a2e', '#ffc857']
};

/** Plays when the CHARACTER's overall level crosses into a new rank
    threshold (see the RANKS array). This is the big "ARISE" moment —
    freezes the screen briefly, shakes it, impacts the avatar, and
    shows the shadow-mode level-up overlay with the rank emblem. */
function celebrateShadowRankUp(newLevel, rank, rankChanged = true) {
    el.levelupLevel.textContent = newLevel;
    el.levelupLabel.textContent = 'ARISE';
    el.levelupEmblemLetter.textContent = rank.name;

    document.body.classList.add('rank-' + rank.name);
    const rankColor = RANK_COLORS[rank.name] || '#ffffff';
    el.levelupOverlay.style.setProperty('--shadow-color', rankColor);
    el.levelupOverlay.classList.add('shadow-mode');

    el.levelupRank.textContent = rankChanged
        ? `Character rank ascended to ${rank.name}`
        : `Character reached Level ${newLevel}`;
    el.levelupRank.style.display = 'block';

    clearTimeout(levelupTimer);
    const colors = RANK_PARTICLE_COLORS[rank.name] || RANK_PARTICLE_COLORS.S;
    surgeParticles(true, colors);

    setTimeout(() => freezeWorld(), BURST_RISE_MS - 150);
    setTimeout(() => {
        shakeScreen();
        impactAvatar();
        blastRing();
        playChime(true);
    }, BURST_RISE_MS);
    setTimeout(() => openModal(el.levelupOverlay), BURST_RISE_MS + 150);
}

/** Small celebratory confetti pop, originating from the actual
    on-screen position of the Daily Quest button, when a quest is
    completed. */
function celebrateQuestComplete() {
    const rect = el.questBtn.getBoundingClientRect();
    const originX = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
    const originY = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
     spawnConfetti(30, originX, originY);
    
    playChime(false);
}

/** Plays when a Focus Mode session finishes its FULL planned duration
    (as opposed to being manually exited early — see finishFocusSession
    for how that distinction is made). Blast of particles from screen
    center, a "punch" animation on the timer text, then swaps from the
    active-focus overlay to the Training Complete overlay after a
    short delay so the blast has time to read before the screen changes. */
function celebrateTrainingComplete(skillName, hoursTrained) {
    spawnBlast(40);
    punchTimer();
    playChime(true);
    setTimeout(() => {
        closeModal(el.activeFocus);
        el.completeSkill.textContent = skillName;
        el.completeTime.textContent = formatHours(hoursTrained);
        openModal(el.completeOverlay);
    }, 500);
}


/* ================================================================
   10. PROFILE / XP BAR
   ================================================================ */
function updateProfileVisuals() {
    const rank = getRank(level);
    el.levelText.textContent = 'LEVEL ' + level;
    el.rankBadge.textContent = rank.name + '-RANK';

    document.body.style.setProperty('--current-rank-color', RANK_COLORS[rank.name] || '#ffffff');

    document.body.className = document.body.className.replace(/\brank-\S+/g, '').trim();
    document.body.classList.add('rank-' + rank.name);
}

/** Updates the character-level XP bar's fill width and caption text
    ("X / Y HRS TO NEXT LEVEL"). progress is measured from starthours
    (the totalHours value at which the current level began), so the
    bar always represents progress WITHIN the current level, not
    lifetime total progress. */

    function updateXPBar() {
    const needed = hoursNeededForCharacterLevel(level);
    const progress = totalHours - starthours;
    const pct = Math.min(Math.max((progress / needed) * 100, 0), 100);
    el.xpBar.style.width = pct + '%';
    el.xpCaption.textContent = `${formatHours(progress)} / ${formatHours(needed)} TO NEXT LEVEL`;
}

/** Same idea as updateXPBar but for one individual skill's progress
    bar on its card. */
function updateSkillBar(skill) {
    const needed = hoursNeededForLevel(skill.Level);
    const progress = Math.min(((skill.hours - skill.startxp) / needed) * 100, 100);
    skill.card.querySelector('.skill-bar').style.width = progress + '%';
}


/* ================================================================
   11. SKILL CARDS
   ================================================================
   Building, updating, and deleting the individual <li class="card">
   elements that live inside #log.
   ================================================================ */

/** Builds and inserts a brand-new skill card into #log for `activity`,
    at the given grid index (used for the CSS entrance-animation
    stagger via the --i custom property, if such an animation exists
    in styles.css). Called both when a genuinely NEW skill is first
    logged, and when init() rebuilds all cards from saved data on page
    load. */
function createCard(activity, data, index) {
    const needed = hoursNeededForLevel(data.Level);
    data.totalXP = needed * 6; // XP is defined as hours × 6 throughout this app — see formatXP()/logProgress() for where that multiplier is used
    if (data.startxp === undefined) data.startxp = 0; // defensive default for any legacy saved data that might predate this field existing

    const item = document.createElement('li');
    item.className = 'card';
    item.dataset.activity = activity; // used by persistCardOrder() to read back the saved order, and by the drag system to identify cards
    item.style.setProperty('--i', index || 0);

    item.innerHTML = `
        <button type="button" class="delete-btn" aria-label="Delete ${escapeHtml(activity)}">✕</button>
        <div class="card-sheen"></div>
        <div class="card-head">
            <div class="card-icon">${escapeHtml((activity.trim().charAt(0) || '?').toUpperCase())}</div>
            <div class="card-head-text">
                <div class="title">${escapeHtml(activity)}</div>
                <span class="level-pill">Lv. ${data.Level}</span>
            </div>
        </div>
        <div class="skill-bar-container"><div class="skill-bar"></div></div>
        <div class="card-meta">
            <span class="xp">${formatXP(data)}</span>
            <span class="hours">${formatHoursRemaining(data)}</span>
        </div>
        <button type="button" class="quickadd-btn" aria-label="Add time to ${escapeHtml(activity)}">+</button>
    `;

    item.querySelector('.delete-btn').addEventListener('click', () => deleteSkill(activity));
    item.querySelector('.quickadd-btn').addEventListener('click', () => openQuickAddModal(activity));
    item.addEventListener('mouseenter', () => playHoverTick()); // small audio "tick" feedback on hover — see playHoverTick() below
    item.addEventListener('touchstart', () => playHoverTick(), { passive: true }); // ADD THIS LINE

    data.card = item; // stash a live DOM reference on the skill's data object, so other functions (refreshCardVisuals, restoreState, deleteSkill) can find/update/remove this exact element without re-querying the DOM
    el.log.appendChild(item);
    applyCardEvolution(item, data); // must happen AFTER appendChild — this function needs `item` to actually exist as a real element to set CSS custom properties on it
    updateSkillBar(data);
    persistCardOrder(); // keep the saved order in sync any time the card list changes shape
}

/** Updates an EXISTING skill card's visuals/text after its underlying
    data changes (new hours logged, level up, or an undo restoring old
    values). Does NOT touch the DOM structure — just refreshes text
    content and re-applies the tier/stage visuals. */
function refreshCardVisuals(activity, data) {
    const card = data.card;
    applyCardEvolution(card, data);

    const levelPill = card.querySelector('.level-pill');
    if (levelPill) levelPill.textContent = `Lv. ${data.Level}`;

    const xpElement = card.querySelector('.xp');
    if (xpElement) xpElement.textContent = formatXP(data);

    const hoursElement = card.querySelector('.hours');
    if (hoursElement) hoursElement.textContent = formatHoursRemaining(data);

    updateSkillBar(data);
}

/** Doesn't actually delete anything itself — just remembers WHICH
    skill is pending deletion and opens the confirmation modal. The
    actual removal happens in the #confirm-yes click handler in
    wireEvents(), only after the user explicitly confirms. */
function deleteSkill(activity) {
    pendingDelete = activity;
    openModal(el.deleteModal);
}

/** Generates a very short burst of filtered white noise as a subtle
    "tch" hover-feedback sound, played whenever the cursor enters a
    skill card. Built from raw noise (rather than a simple tone,
    like playChime uses) run through a bandpass filter to shape it
    into something that reads as a soft interface tick rather than
    a harsh crackle or hiss. */
const hoverSound = new Audio('futuristic_hsr_hover_mix.wav');
hoverSound.volume = 0.50;
hoverSound.playbackRate = 1.50; // 50% faster

function playHoverTick() {
    if (soundMuted) return;

    hoverSound.currentTime = 0;
    hoverSound.play().catch(() => {});
}

/* ================================================================
   12. CORE LOGGING LOGIC
   ================================================================
   logProgress() is the single most important function in the app —
   every way of adding time to a skill (manual log modal, quick-add
   modal, and finishing a focus session) all funnel through this one
   function. Everything downstream of "the user logged some hours"
   happens here: XP gain, level-up detection (both skill AND
   character level), streak bookkeeping, quest progress, persistence,
   and triggering the right celebration.
   ================================================================ */
   let lastLogError = null; // { type: 'cap' | 'invalid', message } — set right before logProgress returns false, so whichever modal called it knows WHY, and can shake/message the right input instead of guessing

function logProgress(activityRaw, hoursRaw) {
    lastLogError = null;
    const activity = (activityRaw || '').trim();
    let hours = parseFloat(hoursRaw);
    if (!activity || !isFinite(hours) || hours <= 0) return false; // caller (e.g. the log form's submit handler) uses this false return to know validation failed and should show an input error instead of closing the modal

    const loggedToday = Object.values(dailyLog.hours).reduce((sum, h) => sum + h, 0);
    const remainingToday = round2(DAILY_HOURS_CAP - loggedToday);
    if (remainingToday <= 0) {
        lastLogError = { type: 'cap', message: `Daily cap reached — try again tomorrow` };
        return false;
    }
    if (hours > remainingToday) {
        hours = remainingToday;
    }
    // Snapshot the ENTIRE relevant state BEFORE anything below changes
    // it, so the Undo button can restore this exact moment if the user
    // wants to take it back. See section 12b for what this captures.
    const preSnap = snapshotState();

    document.body.classList.remove('pre-log'); // 'pre-log' dims most HUD controls until the user's very first-ever log — this removes that dimming permanently once they've logged anything at all

    const xpGained = hours * 6;
    const isNewSkill = !(activity in skills);

    if (isNewSkill) {
        skills[activity] = { XP: 0, hours: 0, Level: 1, startxp: 0, totalXP: hoursNeededForLevel(1) * 6 };
    }
    const skill = skills[activity];
    skill.XP += xpGained;
    skill.hours = round2(skill.hours + hours);

    // --- Skill-level-up detection ---
    // A while loop (not an if) because a single big log entry could
    // theoretically cross MULTIPLE level thresholds at once (e.g.
    // logging an 8-hour session on a skill that only needs 1 hour per
    // level right now) — this correctly walks through every level-up
    // that single log triggers, not just the first one.
    let leveledUpSkill = false;
    let needed = hoursNeededForLevel(skill.Level);
    let levelTarget = skill.startxp + needed;
    while (skill.hours >= levelTarget) {
        skill.Level++;
        skill.startxp = levelTarget; // the NEW level's progress starts counting from here
        leveledUpSkill = true;
        needed = hoursNeededForLevel(skill.Level);
        levelTarget = skill.startxp + needed;
    }
    skill.totalXP = hoursNeededForLevel(skill.Level) * 6; // recompute total XP needed for whatever level the skill ended up at

    if (isNewSkill) {
        createCard(activity, skill, Object.keys(skills).length - 1);
    } else {
        refreshCardVisuals(activity, skill);
    }

    // --- Streak bookkeeping ---
    // Only runs once per calendar day. Note it no longer fires the
    // celebration immediately — see the end of this function, where
    // it's timed to never overlap a level-up celebration.
    const savedDate = Store.getStr('lastLogDate', null);
    let streakExtended = false;
    if (savedDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        streakExtended = savedDate === yesterday;
        streak = streakExtended ? streak + 1 : 1;
        Store.setStr('lastLogDate', today);
        Store.setStr('streak', streak);
        el.streakCount.textContent = streak;
    }

    totalHours = round2(totalHours + hours);
    recordHistoryPoint();

    // --- Character-level-up detection (same while-loop pattern as
    //     the skill-level check above, for the same reason: a single
    //     log could cross multiple character-level thresholds) ---
    const prevRank = getRank(level); // captured BEFORE incrementing level, so we can later detect whether the rank actually changed (not just the level)
    let leveledUpMain = false;
    let mainLevelTarget = starthours + hoursNeededForCharacterLevel(level);
    while (totalHours >= mainLevelTarget) {
        level++;
        leveledUpMain = true;
        starthours = mainLevelTarget;
         mainLevelTarget = starthours + hoursNeededForCharacterLevel(level);
    }
    updateXPBar();
    updateProfileVisuals();

    // --- Persist everything that just changed ---
    Store.setJSON('skills', skills);
    Store.setJSON('houred', { starthours, totalHours, level });

    dailyLog.hours[activity] = round2((dailyLog.hours[activity] || 0) + hours);
    Store.setJSON('dailyLog', dailyLog);

    updateQuestProgress(activity, hours);
    renderQuest();

    // --- Trigger the right celebration ---
    // Card level-ups always get their own thing (glow + badge + card
    // bolt). The avatar/character level-up is judged separately: only
    // an ACTUAL rank change (new color stage) gets the big ARISE
    // treatment; leveling within the same rank gets the smaller
    // avatar "LEVEL UP" instead.
 if (leveledUpMain) {
    const newRank = getRank(level);
    const rankChanged = newRank.name !== prevRank.name;
    celebrateShadowRankUp(level, newRank, rankChanged);
} else if (leveledUpSkill) {
    celebrateSkillLevelUp(activity, skill.Level);
}

    // Streak celebration never shares the overlay/lightning/text with
    // a level-up. If one is playing from this same log entry, push
    // the streak popup past its end so they can't visually collide.
    if (streakExtended) {
        const levelUpHappening = leveledUpMain || leveledUpSkill;
        setTimeout(() => celebrateStreakContinued(streak), levelUpHappening ? BURST_RISE_MS + 3600 : 0);
    }

    pushUndoSnapshot(preSnap);

    return true;
}

// guard against overlapping streak celebrations
let streakTimeouts = [];

function celebrateStreakContinued(count) {
    // clear any pending timers from a previous, still-finishing call
    streakTimeouts.forEach(clearTimeout);
    streakTimeouts = [];

    document.getElementById('streak-continue-count').textContent = count;

    const content = document.querySelector('.streak-strike-content');
    content.classList.remove('streak-text-in', 'streak-leaving');

    triggerStreakLightning();
    openModal(el.streakNotifyOverlay);

    streakTimeouts.push(setTimeout(() => {
        document.querySelectorAll('.streak-text-spark').forEach(spark => {
            spark.style.animationDelay = (Math.random() * 0.4).toFixed(2) + 's';
            spark.style.animationDuration = (0.6 + Math.random() * 0.5).toFixed(2) + 's';
        });
        content.classList.add('streak-text-in');
        playChime(true);
    }, 700));

    streakTimeouts.push(setTimeout(() => {
        content.classList.remove('streak-text-in');
        content.classList.add('streak-leaving');
        retireStreakLightning();
    }, 700 + 5000));

    streakTimeouts.push(setTimeout(() => {
        closeModal(el.streakNotifyOverlay);
        content.classList.remove('streak-leaving');
    }, 700 + 5000 + 550));
}

/* ================================================================
   12b. UNDO SYSTEM
   ================================================================
   Lets the user reverse their most recent state-changing action
   (logging progress, adding a custom quest, or editing a quest).
   Only ONE level of undo is supported — starting a new action
   overwrites whatever the previous undoSnapshot was, and the Undo
   button auto-hides (clearing the snapshot) after 8 seconds of
   inactivity.

   Three pieces, all top-level so any function can call them:

     snapshotState()  — takes a deep-ish copy of everything that
                         logProgress/addCustomQuest/saveEditQuest can
                         change, called BEFORE the change happens.

     pushUndoSnapshot() — pushes a snapshot onto the undo stack and clears the redo stack.

     restoreState(snap) — writes a snapshot's values back into the
                         live state + DOM + localStorage, undoing
                         whatever happened since that snapshot was
                         taken.
   ================================================================ */

function snapshotState() {
    return {
        skillsData: Object.fromEntries(Object.entries(skills).map(([k, v]) =>
            [k, { XP: v.XP, hours: v.hours, Level: v.Level, startxp: v.startxp, totalXP: v.totalXP }])),
        totalHours, level, starthours, streak,
        lastLogDate: Store.getStr('lastLogDate', null),
        dailyQuest: JSON.parse(JSON.stringify(dailyQuest)),
        dailyLog: JSON.parse(JSON.stringify(dailyLog))
    };
}

/** Called by logProgress/addCustomQuest/saveEditQuest right after a
    change is made, passing the snapshot taken BEFORE that change.
    Pushes it onto the undo stack, clears the redo stack (a fresh
    action invalidates any "future" you could have redone into — same
    rule every undo/redo system follows), and caps the stack length. */
function pushUndoSnapshot(preSnap) {
    undoStack.push(preSnap);
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift(); // drop the oldest step once over the cap
    redoStack = [];
    showUndoRedoButtons();
}

/** Updates Undo/Redo button enabled/disabled state based on stack
    contents. No auto-hide, no auto-clear — history persists for the
    whole session (until a page reload) or up to MAX_UNDO_STEPS,
    whichever comes first. Both buttons stay visible at all times;
    only their disabled state changes. */
function showUndoRedoButtons() {
    el.undoBtn.disabled = undoStack.length === 0;
    el.redoBtn.disabled = redoStack.length === 0;
}

function applySnapshot(snap) {
    // Remove cards for skills that existed live but aren't in the target snapshot
    Object.keys(skills).forEach(name => {
        if (!(name in snap.skillsData)) {
            skills[name].card.remove();
            delete skills[name];
        }
    });

    // Recreate cards for skills that ARE in the target snapshot but are
    // currently missing (e.g. redoing forward past a point where an
    // earlier undo had already deleted them) — this is the step that
    // was missing before, which is why redo couldn't bring a card back.
    Object.keys(snap.skillsData).forEach(name => {
        if (!skills[name]) {
            skills[name] = { ...snap.skillsData[name] };
            createCard(name, skills[name], Object.keys(skills).length - 1);
        }
    });

    // Sync numeric fields for every skill still present
    Object.entries(snap.skillsData).forEach(([name, data]) => {
        if (skills[name]) Object.assign(skills[name], data);
    });

    totalHours = snap.totalHours;
    level = snap.level;
    starthours = snap.starthours;
    streak = snap.streak;
    Store.setStr('lastLogDate', snap.lastLogDate || '');
    Store.setStr('streak', streak);
    dailyQuest = snap.dailyQuest;
    dailyLog = snap.dailyLog;

    Store.setJSON('skills', skills);
    Store.setJSON('houred', { starthours, totalHours, level });
    Store.setJSON('dailyQuest', dailyQuest);
    Store.setJSON('dailyLog', dailyLog);

    Object.entries(skills).forEach(([name, data]) => refreshCardVisuals(name, data));

    el.streakCount.textContent = streak;
    updateXPBar();
    updateProfileVisuals();
    renderQuest();
}

/** Steps one action backward: snapshots the CURRENT state onto the
    redo stack (so redo can bring you back), then pops and applies the
    most recent undo snapshot. */
function performUndo() {
    if (!undoStack.length) return;
    redoStack.push(snapshotState());
    const prevSnap = undoStack.pop();
    applySnapshot(prevSnap);
    showUndoRedoButtons();
}

/** Steps one action forward: snapshots the CURRENT state onto the
    undo stack, then pops and applies the most recent redo snapshot. */
function performRedo() {
    if (!redoStack.length) return;
    undoStack.push(snapshotState());
    const nextSnap = redoStack.pop();
    applySnapshot(nextSnap);
    showUndoRedoButtons();
}

/* ================================================================
   13. DAILY QUESTS
   ================================================================
   Daily quests come in two flavors, chosen once per day the first
   time the user opens the quest modal:
     - "Automatic": QUEST_COUNT random skills are picked, each with a
       flat QUEST_HOURS_GOAL target.
     - "Manual": the user builds their own quest list from scratch,
       picking activities and custom hour targets one at a time.
   Both flavors share the same dailyQuest.quests array shape and the
   same rendering/progress logic — `dailyQuest.mode` just gates which
   UI controls are shown (see renderQuestModal).
   ================================================================ */

/** Handles the "Close" button on the quest modal. If the user hasn't
    yet chosen Manual/Automatic mode, this REFUSES to close (flashes
    an error on the choice screen instead) — a deliberate design
    choice so the quest modal can't be dismissed in a "limbo" state
    where no mode has been picked. */
function closeQuest() {
    if (dailyQuest.mode === null) {
        flashInputError(el.questChoice);
        return;
    }
    closeModal(el.questModal);
}

function chooseManualMode() {
    dailyQuest.mode = 'manual';
    dailyQuest.quests = []; // manual mode always starts empty — the user builds their list from scratch
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuestModal();
}

function chooseAutoMode() {
    dailyQuest.mode = 'auto';
    dailyQuest.quests = makeQuestList(pickQuestActivities(QUEST_COUNT));
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuestModal();
}

/** Re-rolls the automatic quest list (the "⟳" reroll button, only
    shown in Auto mode). Picks a fresh random set of activities,
    discarding whatever quests/progress existed before. */
function autoGenerateQuests() {
    dailyQuest.quests = makeQuestList(pickQuestActivities(QUEST_COUNT));
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuest();
}

/** Loads today's dailyLog from storage, or creates a fresh empty one
    if none exists yet OR if the saved one is from a previous day
    (the `log.date !== today` check is what makes this "daily" —
    every new calendar day effectively starts a blank log). */
function loadOrCreateDailyLog() {
    let log = Store.getJSON('dailyLog', null);
    if (!log || log.date !== today) {
        log = { date: today, hours: {} };
        Store.setJSON('dailyLog', log);
    }
    if (!log.hours) log.hours = {}; // extra defensive check in case of malformed/old saved data missing this field entirely
    return log;
}

/** Randomly picks up to `n` activity names from the user's existing
    skills, for Automatic quest generation. Returns fewer than `n` if
    the user doesn't have that many skills yet (Math.min guards
    against slice() being asked for more items than exist, which
    would just silently return everything anyway, but the min() makes
    the intent explicit). */
function pickQuestActivities(n) {
    const names = Object.keys(skills);
    if (!names.length) return [];
    return shuffle(names).slice(0, Math.min(n, names.length));
}

/** Converts a flat array of activity names into the full quest-object
    shape used everywhere else (progress tracking, rendering, etc). */
function makeQuestList(activities) {
    if (!activities.length) return [];
    const perQuestHours = round2(QUEST_HOURS_GOAL / activities.length); // split the 2-hour total evenly across today's quests
    return activities.map(a => ({ activity: a, type: 'timed', goalHours: perQuestHours, progress: 0, completed: false }));
}

/** Loads today's dailyQuest from storage, or creates a fresh one (mode:
    null, empty quest list, not yet seen) if none exists or the saved
    one is from a previous day — same "daily reset" pattern as
    loadOrCreateDailyLog above. */
function loadOrCreateQuest() {
    let quest = Store.getJSON('dailyQuest', null);
    if (!quest || quest.date !== today) {
        quest = { date: today, mode: null, quests: [], seen: false };
        Store.setJSON('dailyQuest', quest);
    }
    if (!Array.isArray(quest.quests)) quest.quests = []; // defensive default for malformed saved data
    quest.quests.forEach(q => { if (!q.type) q.type = 'timed'; });
    return quest;
}

/** Adds `hoursToAdd` progress to a single quest, capping it at that
    quest's goal and marking it completed once the goal is reached.
    Handles OVERFLOW: if the hours logged push this quest past its
    goal, the leftover amount is recursively applied to the next
    still-incomplete quest instead of being wasted — so e.g. logging
    a big single session can complete multiple quests in one go if
    there's enough overflow to go around. */
function applyQuestHours(quest, hoursToAdd) {
    quest.progress = round2((quest.progress || 0) + hoursToAdd);  
    quest._justLogged = true;

    if (!quest.completed && quest.progress >= quest.goalHours) {
        const overflow = round2(quest.progress - quest.goalHours);
        quest.progress = quest.goalHours; // clamp the display to exactly the goal, even though more was technically logged
        quest.completed = true;
        celebrateQuestComplete();
        if (overflow > 0) {
            const next = dailyQuest.quests.find(q => q !== quest && !q.completed);
            if (next) applyQuestHours(next, overflow); // recursive call — could theoretically cascade through several quests if there's enough overflow
        }
    }
}

/** Called every time logProgress() records hours for an activity.
    Finds (or creates, if room allows) the matching quest and applies
    the newly logged hours to it. */
function updateQuestProgress(activity, hoursLogged) {
    if (!dailyQuest || dailyQuest.date !== today) return; // safety guard — shouldn't normally trigger since dailyQuest is refreshed at the top of each day, but protects against edge cases around exact midnight
    let quest = dailyQuest.quests.find(q => q.activity === activity);
    if (!quest) {
        // This activity doesn't have a quest yet. If there's still room
        // under QUEST_COUNT, spontaneously create one for it — this is
        // what lets logging a brand-new activity automatically "count"
        // toward today's quests even if it wasn't one of the originally
        // auto-picked ones.
        if (dailyQuest.quests.length >= QUEST_COUNT) return;
        quest = { activity, type: 'timed', goalHours: round2(QUEST_HOURS_GOAL / QUEST_COUNT), progress: 0, completed: false };
        dailyQuest.quests.push(quest);
        // Uses dailyLog.hours[activity] (the running total for TODAY)
        // rather than just hoursLogged (this one log entry) — so if the
        // user had already logged some of this activity earlier today
        // BEFORE this quest existed, that earlier progress still counts
        // retroactively instead of being lost.
        applyQuestHours(quest, dailyLog.hours[activity] || hoursLogged);
        Store.setJSON('dailyQuest', dailyQuest);
        return;
    }
    if (quest.completed) return; // already done, nothing more to apply
    applyQuestHours(quest, hoursLogged);
    Store.setJSON('dailyQuest', dailyQuest);
}

/** Manual-mode "Save Quest" handler — either updates an existing
    quest's goal (if the activity already has a quest) or adds a brand
    new one. Also creates a brand-new SKILL (with its own card) if the
    typed activity name doesn't exist yet — this is one of the ways a
    new skill can enter the app besides the main log modal. */
function addCustomQuest(activity, type, hours) {
    const preSnap = snapshotState();
    activity = activity.trim();
    if (!activity) return false;
    if (type === 'timed' && (!isFinite(hours) || hours <= 0)) return false;

    const existing = dailyQuest.quests.find(q => q.activity === activity);
    if (existing) {
        existing.type = type;
        existing.goalHours = type === 'timed' ? hours : 0;
        existing.progress = 0;
        existing.completed = false;
    } else {
        dailyQuest.quests.push({
            activity, type,
            goalHours: type === 'timed' ? hours : 0,
            progress: 0, completed: false
        });
    }
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuest();
    pushUndoSnapshot(preSnap);
    return true;
}
function toggleTaskQuestComplete(quest) {
    const preSnap = snapshotState();
    quest.completed = !quest.completed;
    if (quest.completed) celebrateQuestComplete();
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuest();
    pushUndoSnapshot(preSnap);
}

/** Saves an in-place edit to an existing quest (activity name and/or
    hour goal), triggered from the "✎ Edit" button on a quest row. If
    the new goal is lower than the progress already logged, progress
    is clamped down to match (and re-checked for completion) so the
    displayed state never shows "120% progress." */
function saveEditQuest(quest, newActivity, newHours) {
    const preSnap = snapshotState();

    quest.activity = newActivity;
    quest.goalHours = round2(newHours);
    quest.progress = Math.min(quest.progress, quest.goalHours);
    quest.completed = quest.progress >= quest.goalHours;

    editingQuestActivity = null; // exit edit mode
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuest();

    pushUndoSnapshot(preSnap);
}

/** The big quest-list render function — rebuilds the entire #quest-list
    <ul> from scratch every time it's called (rather than trying to
    diff/patch individual rows). Handles three states per row: normal
    display, "currently being edited" (shows an inline edit form
    instead), and the special "no quests yet" empty state. Also updates
    the Daily Quest HUD button's pulsing/badge state based on overall
    progress. */
function renderQuest() {
    el.questList.innerHTML = ''; // full rebuild each time — simpler than patching, and this list is never large enough for that to be a performance concern

    const totalPages = Math.max(1, Math.ceil(dailyQuest.quests.length / QUEST_PAGE_SIZE));
    if (currentQuestPage >= totalPages) currentQuestPage = totalPages - 1; // clamp the current page in case quests were removed and the old page number is now out of range
    if (currentQuestPage < 0) currentQuestPage = 0;

    const pageQuests = dailyQuest.quests.slice(
        currentQuestPage * QUEST_PAGE_SIZE,
        (currentQuestPage + 1) * QUEST_PAGE_SIZE
    );

    if (dailyQuest.quests.length === 0 && dailyQuest.mode !== 'manual') {
        // Manual mode with zero quests still shows the builder UI (via
        // renderQuestModal), so this "log something first" empty state
        // is specifically for Automatic mode before the user has logged
        // anything at all yet (auto-quests only populate once activity
        // exists to pick from).
        const empty = document.createElement('li');
        empty.className = 'quest-empty';
        empty.textContent = "Log your first activity to unlock today's quests.";
        el.questList.appendChild(empty);
    } else {
        pageQuests.forEach(q => {
            const li = document.createElement('li');
            li.className = 'quest-item' + (q.completed ? ' quest-item-done' : '');

            if (q.activity === editingQuestActivity) {
                // --- EDIT MODE for this specific row ---
                li.innerHTML = `
                    <div class="quest-item-top">
                        <input type="text" class="quest-edit-activity" value="${escapeHtml(q.activity)}" style="flex:1;">
                    </div>
                    <div class="hm-input-row" style="margin:8px 0;">
                        <input type="number" class="quest-edit-hours-h" min="0" step="1" placeholder="Hours">
                        <span>:</span>
                        <input type="number" class="quest-edit-hours-m" min="0" max="59" step="1" placeholder="Minutes">
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn-ghost quest-edit-cancel">Cancel</button>
                        <button type="button" class="btn-primary quest-edit-save">Save</button>
                    </div>
                `;
                const activityInput = li.querySelector('.quest-edit-activity');
                const hEl = li.querySelector('.quest-edit-hours-h');
                const mEl = li.querySelector('.quest-edit-hours-m');
                writeHoursMinutes(hEl, mEl, q.goalHours); // pre-fill the edit form with the quest's CURRENT goal

                li.querySelector('.quest-edit-cancel').addEventListener('click', () => {
                    editingQuestActivity = null;
                    renderQuest();
                });
                li.querySelector('.quest-edit-save').addEventListener('click', () => {
                    const newActivity = activityInput.value.trim();
                    const newHours = readHoursMinutes(hEl, mEl);
                    if (!newActivity) { flashInputError(activityInput); return; }
                    if (!newHours || newHours <= 0) { flashInputError(hEl); return; }
                    saveEditQuest(q, newActivity, newHours);
                });



                el.questList.appendChild(li);
                return; // skip the normal-display branch below for this row
            }
            if (q.type === 'task') {
    li.innerHTML = `
        <div class="quest-item-top">
            <span class="quest-item-name">${escapeHtml(q.activity)}</span>
         
        </div>`;
    const actions = document.createElement('div');
    actions.className = 'quest-item-actions';
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = q.completed ? 'btn-ghost quest-item-log' : 'btn-primary quest-item-log';
    doneBtn.textContent = q.completed ? 'Undo' : 'Mark Done';
    doneBtn.addEventListener('click', () => toggleTaskQuestComplete(q));
    actions.appendChild(doneBtn);
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-ghost quest-item-edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => { editingQuestActivity = q.activity; renderQuest(); });
    actions.appendChild(editBtn);
    li.appendChild(actions);
    el.questList.appendChild(li);
    return;
}

            // --- NORMAL DISPLAY for this row ---
            const pct = Math.min((q.progress / q.goalHours) * 100, 100);
            li.innerHTML = `
                <div class="quest-item-top">
                    <span class="quest-item-name">${escapeHtml(q.activity)}</span>
                    <span class="quest-item-status">${q.completed ? 'COMPLETE' : formatHours(q.progress) + ' / ' + formatHours(q.goalHours)}</span>
                </div>
                <div class="quest-item-bar-container"><div class="quest-item-bar" style="width:${pct}%"></div></div>
            `;
           const actions = document.createElement('div');
actions.className = 'quest-item-actions';
if (!q.completed) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary quest-item-log';
   
       btn.textContent = 'Log';
    btn.title = `Log ${q.activity}`;

    btn.addEventListener('click', () => { closeQuest(); openLogModal(q.activity); });
    actions.appendChild(btn);
}
const editBtn = document.createElement('button');
editBtn.type = 'button';
editBtn.className = 'btn-ghost quest-item-edit';
editBtn.textContent = '✎';
editBtn.addEventListener('click', () => { editingQuestActivity = q.activity; renderQuest(); });
actions.appendChild(editBtn);
li.appendChild(actions);

if (q._justLogged) {
    li.classList.add('quest-item-flash');
    setTimeout(() => li.classList.remove('quest-item-flash'), 600);
    q._justLogged = false;
}
            el.questList.appendChild(li);
        });
    }

    renderQuestPager(totalPages);

    // --- HUD button state (pulsing glow / badge / "seen" dimming) ---
    const hasQuests = dailyQuest.quests.length > 0;
    const allDone = hasQuests && dailyQuest.quests.every(q => q.completed);
    const needsChoice = dailyQuest.mode === null;
    const hasLoggedToday = dailyLog && Object.keys(dailyLog.hours).length > 0;

    el.questBtn.classList.remove('quest-available', 'quest-seen', 'quest-complete');
    if (needsChoice) {
        // Haven't picked Manual/Automatic yet — only pulse once the
        // user has actually logged something today (no point nagging
        // them to set up quests before they've done anything at all).
        if (hasLoggedToday) el.questBtn.classList.add('quest-available');
    } else if (allDone) {
        el.questBtn.classList.add('quest-complete');
    } else if (!hasQuests || !dailyQuest.seen) {
        el.questBtn.classList.add('quest-available');
    } else {
        el.questBtn.classList.add('quest-seen'); // already looked at today's quests, nothing new to flag
    }
    updateFabPulse();
}

/** Builds the ‹ N/M › pagination controls beneath the quest list. Only
    renders anything if there are more quests than fit on one page —
    otherwise leaves the pager container empty (so no stray controls
    show up for a short list). */
function renderQuestPager(totalPages) {
    el.questPager.innerHTML = '';
    if (dailyQuest.quests.length <= QUEST_PAGE_SIZE) return;

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'quest-pager-btn';
    prevBtn.textContent = '‹';
    prevBtn.disabled = currentQuestPage === 0;
    prevBtn.addEventListener('click', () => { currentQuestPage--; renderQuest(); });

    const label = document.createElement('span');
    label.className = 'quest-pager-label';
    label.textContent = `${currentQuestPage + 1} / ${totalPages}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'quest-pager-btn';
    nextBtn.textContent = '›';
    nextBtn.disabled = currentQuestPage === totalPages - 1;
    nextBtn.addEventListener('click', () => { currentQuestPage++; renderQuest(); });

    el.questPager.appendChild(prevBtn);
    el.questPager.appendChild(label);
    el.questPager.appendChild(nextBtn);
}

/** Decides which "screen" of the quest modal to show: the initial
    Manual-vs-Automatic choice, or the actual quest body (list +
    mode-specific controls) once a mode has been picked. */
function renderQuestModal() {
    if (dailyQuest.mode === null) {
        el.questChoice.style.display = 'block';
        el.questBody.style.display = 'none';
    } else {
        el.questChoice.style.display = 'none';
        el.questBody.style.display = 'block';
        el.questManualControls.style.display = dailyQuest.mode === 'manual' ? 'block' : 'none';
        el.questAutoControls.style.display   = dailyQuest.mode === 'auto'   ? 'block' : 'none';
        el.questBuilder.style.display = 'none';        // the "add a quest" form always starts collapsed...
        el.questShowBuilder.style.display = 'block';    // ...with just the "+ Add Quest" trigger button showing
        renderQuest();
    }
}

/** Fills the chip row in the Manual quest builder with one clickable
    chip per existing skill, so the user can quickly pick an activity
    instead of typing it from scratch. Called when the builder becomes
    visible (see the #quest-show-builder click handler in wireEvents). */
function populateQuestActivityChips() {
    el.questActivityChips.innerHTML = '';
    Object.keys(skills).forEach(name => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = name;
        chip.addEventListener('click', () => { el.questActivityInput.value = name; });
        el.questActivityChips.appendChild(chip);
    });
}

/** Opens the quest modal and marks today's quests as "seen" (so the
    HUD button stops pulsing to draw attention until something new
    happens, per the state logic in renderQuest above). */
function openQuest() {
    openModal(el.questModal);
    dailyQuest.seen = true;
    Store.setJSON('dailyQuest', dailyQuest);
    renderQuestModal();
}


/* ================================================================
   14. LOG MODAL
   ================================================================ */

/** Toggles the log FAB's pulsing "fab-available" animation based on
    whether the user has logged anything yet today — nudges them to
    log their first activity of the day, then stops nagging once
    they have. */
function updateFabPulse() {
    const hasLoggedToday = dailyLog && Object.keys(dailyLog.hours).length > 0;
    el.logFab.classList.toggle('fab-available', !hasLoggedToday);
}

/** Opens the "Log Activity" modal, optionally pre-filling (and
    pre-selecting the matching chip for) a specific activity — used
    when jumping here from a quest's "Log <activity>" button.
    Rebuilds the chip row from current skills every time it opens, so
    it always reflects the latest skill list. */
function openLogModal(prefillActivity) {
    el.activityChips.innerHTML = '';
    const names = Object.keys(skills);
    if (names.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'chip-hint';
        hint.textContent = 'No activities yet — type a new one below';
        el.activityChips.appendChild(hint);
    } else {
        names.forEach(name => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip activity-chip';
            chip.textContent = name;
            if (name === prefillActivity) chip.classList.add('selected');
            chip.addEventListener('click', () => {
                el.activityInput.value = name;
                el.activityChips.querySelectorAll('.activity-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
            });
            el.activityChips.appendChild(chip);
        });
    }
    el.activityInput.value = prefillActivity || '';
    el.hoursInputH.value = '';
    el.hoursInputM.value = '';
    document.querySelectorAll('.hours-chip').forEach(c => c.classList.remove('selected'));
    openModal(el.logModal);
    setTimeout(() => el.activityInput.focus(), 60); // slight delay so focus happens AFTER the modal's open animation has started, feels less jarring than an instant focus-jump
}
function closeLogModal() { closeModal(el.logModal); }

/** Generic input-validation-failure animation — briefly adds/removes
    an 'input-error' class (which triggers a CSS shake animation) on
    whichever input the caller wants to flag. Used across several
    modals (log, quest builder, quest editing, quick-add) rather than
    each having its own copy of this logic. */
function flashInputError(input) {
    input.classList.remove('input-error');
    void input.offsetWidth; // same "force reflow" trick used elsewhere in this file, so the shake can replay even if it was just played a moment ago
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 500);
}
function showFieldError(boxEl, message) {
    flashInputError(boxEl);
    let msg = boxEl.nextElementSibling;
    if (!msg || !msg.classList.contains('input-error-msg')) {
        msg = document.createElement('div');
        msg.className = 'input-error-msg';
        boxEl.insertAdjacentElement('afterend', msg);
    }
    msg.textContent = message;
    clearTimeout(msg._hideTimer);
    msg.classList.add('show');
    msg._hideTimer = setTimeout(() => msg.classList.remove('show'), 2400);
}



/* ================================================================
   16. CHARACTER NAME EDITING
   ================================================================ */

/** Called when the editable #char-name element loses focus (or Enter
    is pressed — see its keydown listener in wireEvents, which just
    blurs the element to trigger this same handler). Falls back to
    "Hunter" if the user cleared the field entirely rather than
    leaving it blank. */
function saveCharName() {
    let val = el.charName.textContent.trim();
    if (!val) val = 'Hunter';
    el.charName.textContent = val;
    characterName = val;
    Store.setStr('characterName', val);
    // NOTE: there used to be an updateAvatarLetter() call here — that
    // function was removed when the avatar switched from a text-letter
    // display to an SVG icon, since the icon no longer depends on the
    // character's name at all. Nothing needs to happen here beyond
    // saving the name itself.
}


/* ================================================================
   17. QUICK-ADD MODAL
   ================================================================
   The small "+" button that appears on hover over a skill card —
   lets the user add time to THAT SPECIFIC skill without opening the
   full Log Activity modal and picking it from the chip list.
   ================================================================ */
function openQuickAddModal(activity) {
    quickAddSkill = activity;
    el.quickaddTitle.textContent = activity;
    el.quickaddHoursH.value = '';
    el.quickaddHoursM.value = '';
    document.querySelectorAll('.qa-hour').forEach(c => c.classList.remove('selected'));
    openModal(el.quickaddModal);
}

function confirmQuickAdd() {
    const hours = readHoursMinutes(el.quickaddHoursH, el.quickaddHoursM);
    if (hours > 0) {
        const ok = logProgress(quickAddSkill, hours); // funnels through the exact same core logging path as every other way of adding time
        if (ok) {
            closeModal(el.quickaddModal);
        } else if (lastLogError && lastLogError.type === 'cap') {
            showFieldError(el.quickaddHoursH.closest('.hm-input-row'), lastLogError.message);
        }
    } else {
        flashInputError(el.quickaddHoursH);
    }
}


/* ================================================================
   18. FOCUS MODE / POMODORO TIMER
   ================================================================
   A full-page timer for dedicated work sessions, with optional
   repeating or one-time break points (e.g. "Pomodoro" = 25 min work /
   5 min break, repeating). The session is broken into a sequence of
   "phases" (buildFocusPhases), and a single interval (startInterval)
   ticks down through them one at a time.
   ================================================================ */

/** Adds one editable "Focus for X minutes, then break for Y minutes"
    row to the custom break-builder UI. Called both for user-added
    custom rows (empty defaults) and for the Pomodoro/50-10 presets
    (pre-filled with those specific values). */
function addBreakRow(workMinutes = '', breakMinutes = '') {
    const id = ++breakIdCounter; // not currently read anywhere else, but keeps each row uniquely identifiable via data-break-id for any future feature that might need to target a specific row
    const row = document.createElement('div');
    row.className = 'break-row';
    row.dataset.breakId = id;
    row.innerHTML = `
        <div class="break-row-fields">
            <div class="break-field">
                <label>Focus for</label>
                <input type="number" class="break-after-input" min="1" step="1" placeholder="Minutes" value="${workMinutes}">
            </div>
            <div class="break-field">
                <label>Then break for</label>
                <input type="number" class="break-length-input" min="1" step="1" placeholder="Minutes" value="${breakMinutes}">
            </div>
        </div>
        <button type="button" class="break-remove-btn" aria-label="Remove break">✕</button>
    `;
    row.querySelector('.break-remove-btn').addEventListener('click', () => row.remove());
    el.breakList.appendChild(row);
}
function clearBreakRows() { el.breakList.innerHTML = ''; }

/** Reads every currently-visible break row and returns an array of
    valid { workMinutes, breakMinutes } pairs — rows with empty/zero/
    invalid values are silently skipped rather than causing an error,
    so an incomplete row just doesn't count instead of blocking the
    whole session from starting. */
function collectBreakPoints() {
    const points = [];
    el.breakList.querySelectorAll('.break-row').forEach(row => {
        const workMin = parseFloat(row.querySelector('.break-after-input').value);
        const breakMin = parseFloat(row.querySelector('.break-length-input').value);
        if (isFinite(workMin) && workMin > 0 && isFinite(breakMin) && breakMin > 0) {
            points.push({ workMinutes: workMin, breakMinutes: breakMin });
        }
    });
    return points;
}

/** Fills the skill-selection buttons in the Focus Mode setup screen.
    If the user has no skills logged yet, shows a hint message instead
    and disables the "Begin Training" button (there's nothing to focus
    ON yet). */
function populateFocusSkills() {
    el.skillSelect.innerHTML = '';
    const names = Object.keys(skills);
    if (names.length === 0) {
        const msg = document.createElement('p');
        msg.className = 'skill-select-empty';
        msg.textContent = 'Log an activity first to unlock it here.';
        el.skillSelect.appendChild(msg);
        el.startFocusBtn.disabled = true;
        return;
    }
    el.startFocusBtn.disabled = false;
    names.forEach(name => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'skill-btn';
        btn.dataset.skill = name;
        btn.textContent = name;
        btn.addEventListener('click', () => {
            selectedSkill = name;
            el.skillSelect.querySelectorAll('.skill-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
        el.skillSelect.appendChild(btn);
    });
}

/** Resets the entire Focus Mode setup screen back to its default
    blank state — called every time the setup overlay is (re)opened,
    so leftover selections from a previous session don't carry over. */
function resetTimeSelection() {
    selectedHours = null;
    el.timeButtons.forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
    el.customTimeRow.style.display = 'none';
    el.customHoursInput.value = '';
    el.customMinutesInput.value = '';
    clearBreakRows();
    document.querySelectorAll('.break-preset-btn').forEach(b => b.classList.remove('selected'));
    const noneBtn = document.querySelector('.break-preset-btn[data-preset="none"]');
    if (noneBtn) noneBtn.classList.add('selected'); // "No Breaks" is the sensible default preset selection
}

function openFocusOverlay() {
    selectedSkill = null;
    populateFocusSkills();
    resetTimeSelection();
    openModal(el.focusOverlay);
}
function closeFocusOverlay() { closeModal(el.focusOverlay); }

/** Updates the big H:MM:SS timer text on the active-focus screen,
    based on sessionElapsedSeconds (total time since the session
    started, spanning both work AND break phases). */
function updateTimerDisplay() {
    const h = Math.floor(sessionElapsedSeconds / 3600);
    const m = Math.floor((sessionElapsedSeconds % 3600) / 60);
    const s = sessionElapsedSeconds % 60;
    el.timerDisplay.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Converts a total session length + a list of break points into an
    ordered sequence of { type: 'work'|'break', seconds } phases. If
    NO break points were configured, the whole session is just one
    single work phase. Otherwise it alternates work/break segments,
    consuming from the total work time each time, until all the
    planned work time has been allocated. `repeat` controls whether
    the break-point list cycles back to the start once exhausted
    (used by the Pomodoro-style "repeating" preset) or is used once
    through and then the remainder becomes one final work phase. */
function buildFocusPhases(totalHours, points, repeat) {
    const totalWorkSeconds = Math.round(totalHours * 3600);
    if (!points.length) return [{ type: 'work', seconds: totalWorkSeconds }];

    const phases = [];
    let remaining = totalWorkSeconds;
    let i = 0;
    while (remaining > 0) {
        const point = points[i];
        if (!point) {
            // Ran out of break points (and not repeating) — whatever
            // work time is left just becomes one final, breakless work
            // phase to finish out the session.
            phases.push({ type: 'work', seconds: remaining });
            remaining = 0;
            break;
        }
        const segSeconds = Math.round(point.workMinutes * 60);
        const workSeg = Math.min(segSeconds, remaining); // don't let a work segment overshoot however much total work time is actually left
        if (workSeg <= 0) break;
        phases.push({ type: 'work', seconds: workSeg });
        remaining -= workSeg;
        if (remaining <= 0) break; // no work time left, no need for a trailing break after the very last segment
        phases.push({ type: 'break', seconds: Math.round(point.breakMinutes * 60) });
        i = repeat ? (i + 1) % points.length : i + 1; // repeat: wrap back to the first break point once we've cycled through all of them; not repeat: just move to the next point in the list each time (and eventually run out, hitting the `!point` branch above)
    }
    return phases;
}

/** Swaps the active-focus screen's visual theme and labels between
    "work" and "break" mode, based on whichever phase is currently
    active. */
function applyPhaseUI() {
    const phase = focusPhases[currentPhaseIdx];
    if (phase.type === 'break') {
        el.activeFocus.classList.add('break-mode'); // re-themes the timer/skill-name text to gold instead of cyan, per styles.css
        el.activeFocusLabel.textContent = 'Break Time';
        el.currentSkillDisplay.textContent = 'Relax & Recharge';
    } else {
        el.activeFocus.classList.remove('break-mode');
        el.activeFocusLabel.textContent = 'In Progress';
        el.currentSkillDisplay.textContent = selectedSkill;
    }
}

/** Updates the small "Break in 4:32" / "Focus session in 0:45"
    countdown badge in the corner of the active-focus screen — shows
    how much time is left in the CURRENT phase, and hides itself
    entirely once there's no next phase left to count down to (i.e.
    this is the final phase of the session). */
function updatePhaseCountdown() {
    if (!el.phaseCountdown) return;
    const phase = focusPhases[currentPhaseIdx];
    const hasNext = currentPhaseIdx + 1 < focusPhases.length;
    if (!hasNext) { el.phaseCountdown.style.display = 'none'; return; }
    const label = phase.type === 'work' ? 'Break in' : 'Focus session in';
    const m = Math.floor(secondsRemaining / 60);
    const s = secondsRemaining % 60;
    el.phaseCountdown.textContent = `${label} ${m}:${String(s).padStart(2, '0')}`;
    el.phaseCountdown.classList.toggle('countdown-break', phase.type !== 'work'); // re-colors the badge gold during a break-countdown vs cyan during a work-countdown
    el.phaseCountdown.style.display = 'block';
}

/** Kicks off a brand new Focus Mode session using whatever the user
    configured in the setup overlay (selectedSkill, selectedHours,
    break rows/preset). Builds the phase sequence, resets all the
    session-tracking counters to zero, and starts the countdown. */
function startFocusTimer() {
    closeFocusOverlay();
    const points = collectBreakPoints();
    const presetBtn = document.querySelector('.break-preset-btn.selected');
    const repeat = !!presetBtn && presetBtn.dataset.preset !== 'none';
    focusPhases = buildFocusPhases(selectedHours, points, repeat);
    currentPhaseIdx = 0;
    workSecondsAccrued = 0;
    sessionElapsedSeconds = 0;
    secondsRemaining = focusPhases[0].seconds;
    isPaused = false;
    updatePauseButton();
    applyPhaseUI();
    updateTimerDisplay();
    updatePhaseCountdown();
    openModal(el.activeFocus);
    startInterval();
}

/** The actual ticking heartbeat of the focus timer — one setInterval
    that fires once per second, decrementing counters and advancing to
    the next phase (or finishing the session entirely) once the
    current phase's time runs out. */
function startInterval() {
    clearInterval(focusInterval); // guards against ever accidentally having two intervals running at once (e.g. if this were somehow called twice in a row)
    focusInterval = setInterval(() => {
        secondsRemaining--;
        sessionElapsedSeconds++;
        if (focusPhases[currentPhaseIdx].type === 'work') workSecondsAccrued++; // only WORK seconds count toward the eventual logProgress() call — break time is tracked for display purposes but never gets logged as skill progress

        updateTimerDisplay();
        updatePhaseCountdown();

        if (secondsRemaining <= 0) {
            currentPhaseIdx++;
            if (currentPhaseIdx >= focusPhases.length) {
                // That was the last phase — the whole session is done.
                clearInterval(focusInterval);
                focusInterval = null;
                finishFocusSession(true); // true = completed naturally (not manually exited)
            } else {
                // Advance into the next phase.
                secondsRemaining = focusPhases[currentPhaseIdx].seconds;
                applyPhaseUI();
                updatePhaseCountdown();
                punchTimer();   // small visual "punch" feedback on the transition
                playChime(false);
            }
        }
    }, 1000);
}

function pauseTimer() {
    clearInterval(focusInterval);
    focusInterval = null;
    isPaused = true;
    updatePauseButton();
}
function resumeTimer() {
    if (secondsRemaining <= 0) return; // safety guard — shouldn't normally be reachable since the interval itself advances phases before this could hit zero, but protects against any edge-case timing
    isPaused = false;
    updatePauseButton();
    startInterval();
}
function updatePauseButton() {
    el.pauseFocusBtn.textContent = isPaused ? 'Continue' : 'Pause';
}

/** Ends the current focus session, either because it ran its full
    planned course (`completed: true`) or because the user manually
    exited early (`completed: false`). Either way, whatever WORK time
    was actually accrued (workSecondsAccrued) gets logged as real
    progress via logProgress() — so even an early exit still "counts"
    for however much genuine focus time happened before the user
    stopped. */
function finishFocusSession(completed) {
    clearInterval(focusInterval);
    focusInterval = null;

    const elapsedHours = workSecondsAccrued / 3600;
    const finishedSkill = selectedSkill; // captured into a local BEFORE the session state gets reset below, since logProgress/celebrateTrainingComplete both need to know which skill this was for

    if (elapsedHours > 0) logProgress(finishedSkill, elapsedHours);

    if (completed) {
        celebrateTrainingComplete(finishedSkill, elapsedHours);
    } else {
        closeModal(el.activeFocus); // early exit just closes the overlay quietly — no celebration for stopping early
    }

    // Reset all session state back to a clean slate for next time.
    el.activeFocus.classList.remove('break-mode');
    selectedSkill = null;
    selectedHours = null;
    isPaused = false;
    focusPhases = [];
    currentPhaseIdx = 0;
    workSecondsAccrued = 0;
}


/* ================================================================
   19. EVENT WIRING
   ================================================================
   Every addEventListener call in the app lives in this one function,
   called once from init() after cacheRefs() has populated `el`. This
   is deliberately separated from the functions the listeners CALL —
   wireEvents() is purely "when X happens, call Y," while the actual
   logic of Y lives in its own named function elsewhere in the file.
   That split means you can read this function top-to-bottom as a
   fairly complete map of "everything the user can click/type, and
   what happens as a result," without wading through implementation
   details.
   ================================================================ */
function wireEvents() {

    // --- Daily Quest builder: "Manual" mode flow -----------------------
    // Clicking "+ Add Quest" swaps the builder into view AND refills the
    // activity chip row with the user's current skill names.
    //
    // IMPORTANT: this used to accidentally have a SECOND, duplicate
    // copy of this exact listener sitting further down in this
    // function (left over from an earlier edit pass). Having it
    // registered twice meant every click fired both listeners back to
    // back — harmless in this particular case since both copies did
    // the same two lines, but exactly the kind of silent duplication
    // that turns into a real bug the moment someone edits one copy and
    // not the other. There is now exactly ONE copy of this listener,
    // right here.
    el.questShowBuilder.addEventListener('click', () => {
        el.questShowBuilder.style.display = 'none';
        el.questBuilder.style.display = 'block';
        populateQuestActivityChips();
    });

    // --- Streak notification modal ---------------------------------------
    // Both buttons currently just close the modal — this is still in
    // its "testing" phase (see the temporary setTimeout trigger for it
    // down in init()). Once real day-boundary streak-checking logic
    // exists, this is where "Not Now" vs "Continue" would meaningfully
    // diverge in behavior.
   

    // --- Skill card drag-to-reorder ---------------------------------------
    // One listener on the whole #log grid (event delegation) — see
    // section 21 above for the full mechanism.
    attachCardDragging();

    // --- HUD: Undo ----------------------------------------------------------
  el.undoBtn.addEventListener('click', performUndo);
el.redoBtn.addEventListener('click', performRedo);
el.logFab.addEventListener('click', () => openLogModal());

    // --- HUD: Daily Quest button + modal -------------------------------------
    el.questBtn.addEventListener('click', openQuest);
    el.questCloseBtn.addEventListener('click', closeQuest);

    el.questChooseManualBtn.addEventListener('click', chooseManualMode);
    el.questChooseAutoBtn.addEventListener('click', chooseAutoMode);
    el.questRerollBtn.addEventListener('click', autoGenerateQuests);

    el.questAddBtn.addEventListener('click', () => {
        const hours = questBuilderType === 'timed' ? readHoursMinutes(el.questHoursH, el.questHoursM) : 0;
const ok = addCustomQuest(el.questActivityInput.value, questBuilderType, hours);
        if (ok) {
            // Collapse the builder back down and reset it for next time.
            el.questBuilder.style.display = 'none';
            el.questShowBuilder.style.display = 'block';
            el.questActivityInput.value = '';
            el.questHoursH.value = '';
            el.questHoursM.value = '';
            questBuilderType = 'timed';
el.questTypeTimedBtn.className = 'btn-primary';
el.questTypeTaskBtn.className = 'btn-ghost';
el.questHoursGroup.style.display = 'block';
            // Jump the pager to whichever page the newly-added quest
            // landed on, so the user immediately sees it without having
            // to manually page forward.
            currentQuestPage = Math.floor((dailyQuest.quests.length - 1) / QUEST_PAGE_SIZE);
            renderQuest();
        }
        // NOTE: if addCustomQuest returned false (invalid input), we
        // deliberately do nothing here — addCustomQuest itself doesn't
        // currently flash an error either. If you want invalid quest
        // input to visibly shake like the other modals do, add a
        // flashInputError() call here in the `else` case.
    });
    el.logCancelBtn.addEventListener('click', closeLogModal);

   
    el.logForm.addEventListener('submit', (e) => {
        e.preventDefault(); // stop the browser's default form-submit page reload
        const totalHours = readHoursMinutes(el.hoursInputH, el.hoursInputM);
        const ok = logProgress(el.activityInput.value, totalHours);
        if (ok) {
            el.activityInput.value = '';
            el.hoursInputH.value = '';
            el.hoursInputM.value = '';
            closeLogModal();
        } else if (lastLogError && lastLogError.type === 'cap') {
            showFieldError(el.hoursInputH.closest('.hm-input-row'), lastLogError.message);
        } else {
            // Flash whichever field is actually the problem: if an
            // activity name WAS typed, the hours must be what's
            // invalid; otherwise the activity name itself is missing.
            flashInputError(el.activityInput.value.trim() ? el.hoursInputH : el.activityInput);
        }
    });
    // Hour preset chips (15m / 30m / 1h / 2h / 3h / Clear) — clicking one
    // fills the Hours/Minutes inputs to match, or clears them for the
    // "Clear" chip specifically.
    document.querySelectorAll('.hours-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.hours-chip').forEach(c => c.classList.remove('selected'));
            if (chip.dataset.clear) {
                el.hoursInputH.value = '';
                el.hoursInputM.value = '';
                return;
            }
            chip.classList.add('selected');
            writeHoursMinutes(el.hoursInputH, el.hoursInputM, parseFloat(chip.dataset.hours));
        });
    });
    // If the user types directly into the hour/minute fields instead of
    // clicking a chip, deselect any chip that was previously selected —
    // otherwise a stale chip could look "selected" while no longer
    // actually matching what's typed.
    el.hoursInputH.addEventListener('input', () => {
        document.querySelectorAll('.hours-chip').forEach(c => c.classList.remove('selected'));
    });
    el.hoursInputM.addEventListener('input', () => {
        document.querySelectorAll('.hours-chip').forEach(c => c.classList.remove('selected'));
    });

    // --- Delete-skill confirmation modal -----------------------------------
    el.confirmYes.addEventListener('click', () => {
        if (pendingDelete && skills[pendingDelete]) {
            skills[pendingDelete].card.remove();
            delete skills[pendingDelete];
            Store.setJSON('skills', skills);
            persistCardOrder(); // keep the saved card order in sync now that one is gone
        }
        pendingDelete = null;
        closeModal(el.deleteModal);
    });
    el.confirmNo.addEventListener('click', () => {
        pendingDelete = null;
        closeModal(el.deleteModal);
    });

    // --- Character name editing -----------------------------------------------
    el.charName.addEventListener('blur', saveCharName);
    el.charName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.charName.blur(); } // Enter triggers a blur, which then triggers saveCharName via the listener above — avoids duplicating the save logic in two places
    });

    // --- Mute toggle -----------------------------------------------------------
    el.muteBtn.addEventListener('click', () => {
        soundMuted = !soundMuted;
        Store.setStr('muted', soundMuted);
        updateMuteIcon();
    });

    // --- Level-up / ARISE overlay dismissal ------------------------------------
    // Clicking anywhere on the overlay (its dark backdrop) dismisses it
    // early, same as the auto-close timer would eventually do.
el.levelupOverlay.addEventListener('click', () => {
    clearTimeout(levelupTimer);
    closeModal(el.levelupOverlay);
    setTimeout(() => {
        el.cardLightningContainer.classList.remove('active', 'pulse'); // ADD — kills the bolt fast on early dismiss
    }, 40);
    setTimeout(() => {
        el.levelupOverlay.classList.remove('shadow-mode');
        el.levelupRank.style.display = 'none';
    }, 260);
});
el.levelupContinueBtn.addEventListener('click', () => {
    closeModal(el.levelupOverlay);
    setTimeout(() => {
        el.cardLightningContainer.classList.remove('active', 'pulse'); // ADD — same fix here
    }, 40);
    setTimeout(() => {
        el.levelupOverlay.classList.remove('shadow-mode');
        el.levelupRank.style.display = 'none';
    }, 260);
});

    // --- Training Complete overlay (shown after a focus session finishes) ------
    el.completeHome.addEventListener('click', () => closeModal(el.completeOverlay));
    el.completeAgain.addEventListener('click', () => {
        closeModal(el.completeOverlay);
        openFocusOverlay(); // jumps straight back into a fresh Focus Mode setup screen
    });

    // --- Quick-Add modal ---------------------------------------------------------
    el.quickaddCancel.addEventListener('click', () => closeModal(el.quickaddModal));
    el.quickaddConfirm.addEventListener('click', confirmQuickAdd);
    document.querySelectorAll('.qa-hour').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.qa-hour').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            writeHoursMinutes(el.quickaddHoursH, el.quickaddHoursM, parseFloat(chip.dataset.hours));
        });
    });
    el.quickaddHoursH.addEventListener('input', () => {
        document.querySelectorAll('.qa-hour').forEach(c => c.classList.remove('selected'));
    });
    el.quickaddHoursM.addEventListener('input', () => {
        document.querySelectorAll('.qa-hour').forEach(c => c.classList.remove('selected'));
    });

    // --- Focus Mode: trigger button + setup overlay ---------------------------------
    el.focusButton.addEventListener('click', openFocusOverlay);
    el.focusCancelBtn.addEventListener('click', closeFocusOverlay);

    // --- Focus Mode: break configuration --------------------------------------------
    el.addBreakBtn.addEventListener('click', () => addBreakRow());
    document.querySelectorAll('.break-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.break-preset-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            clearBreakRows(); // presets REPLACE any custom rows rather than adding to them
            if (btn.dataset.preset === 'pomodoro') addBreakRow(25, 5);
            if (btn.dataset.preset === '50-10') addBreakRow(50, 10);
            // (the "none" preset just clears rows and adds nothing back)
        });
    });

    // --- Focus Mode: session length selection ---------------------------------------
    el.timeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            el.timeButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            if (btn.dataset.custom) {
                // "Custom" button reveals the manual hour/minute input row
                // instead of setting a fixed duration directly.
                el.customTimeRow.style.display = 'block';
                updateCustomTime();
            } else {
                el.customTimeRow.style.display = 'none';
                document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
                el.customHoursInput.value = '';
                el.customMinutesInput.value = '';
                selectedHours = parseFloat(btn.dataset.hours);
            }
        });
    });

    /** Reads the custom hour/minute inputs and updates selectedHours —
        defined as a nested function here (rather than at file scope)
        since it's only ever used by the two listeners directly below it. */
    function updateCustomTime() {
        document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
        const hours = parseInt(el.customHoursInput.value || 0, 10);
        const minutes = parseInt(el.customMinutesInput.value || 0, 10);
        const total = hours + (minutes / 60);
        selectedHours = total > 0 ? total : null;
    }

    el.customHoursInput.addEventListener('input', updateCustomTime);
    el.customMinutesInput.addEventListener('input', updateCustomTime);
    // Quick preset chips within the custom-time row (15m/30m/45m/1h/1.5h/3h)
    document.querySelectorAll('.time-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            const total = parseFloat(chip.dataset.hours);
            const hrs = Math.floor(total);
            const mins = Math.round((total - hrs) * 60);
            el.customHoursInput.value = hrs;
            el.customMinutesInput.value = mins;
            selectedHours = total;
        });
    });

    el.startFocusBtn.addEventListener('click', () => {
        if (!selectedSkill) { alert('Choose a skill first'); return; }
        if (!selectedHours || selectedHours <= 0) { alert('Choose a session length'); return; }
        startFocusTimer();
    });

    // --- Focus Mode: active session controls -----------------------------------------
    el.pauseFocusBtn.addEventListener('click', () => {
        if (isPaused) resumeTimer(); else pauseTimer();
    });

    el.exitFocusBtn.addEventListener('click', () => {
        wasPausedBeforeExit = isPaused; // remember whether it was ALREADY paused before we force-pause it for the confirmation dialog, so cancelling can correctly decide whether to resume
        if (!isPaused) pauseTimer();
        openModal(el.exitFocusModal);
    });
    el.exitConfirmNo.addEventListener('click', () => {
        closeModal(el.exitFocusModal);
        if (!wasPausedBeforeExit) resumeTimer(); // only auto-resume if it WASN'T already paused before the exit-confirm was opened — respects a session the user had deliberately paused themselves
    });
    el.exitConfirmYes.addEventListener('click', () => {
        closeModal(el.exitFocusModal);
        finishFocusSession(false); // false = manually exited, not a natural completion
    });
    el.exitFocusModal.addEventListener('click', (e) => {
        if (e.target === el.exitFocusModal) { // only if the click landed on the backdrop ITSELF, not on the modal card inside it
            closeModal(el.exitFocusModal);
            if (!wasPausedBeforeExit) resumeTimer();
        }
    });

    // --- Generic "click outside closes it" for simple modals -------------------------
    // See dismissableOverlays() for exactly which modals get this
    // behavior — modals with a more deliberate confirm/cancel flow are
    // intentionally excluded so an accidental backdrop click can't skip
    // a confirmation step.
    dismissableOverlays().forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlay);
        });
    });

    // --- Escape key closes whatever's currently open -----------------------------------
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        [el.questModal, el.logModal, el.deleteModal, el.quickaddModal, el.levelupOverlay]
            .forEach(overlay => {
                if (overlay.classList.contains('active')) {
                    if (overlay === el.levelupOverlay) clearTimeout(levelupTimer); // cancel the pending auto-close timer too, since we're closing it manually right now
                    closeModal(overlay);
                }
            });
        if (el.focusOverlay.classList.contains('active')) closeFocusOverlay();
        if (el.exitFocusModal.classList.contains('active')) {
            closeModal(el.exitFocusModal);
            if (!wasPausedBeforeExit) resumeTimer();
        }
    });

    el.themeToggle.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    Store.setStr('lightMode', isLight);
    el.themeToggle.textContent = isLight ? '☀️' : '🌙';
});

    // --- Pause ambient particle animations when the tab isn't visible -------------------
    // Purely a performance courtesy — no reason to keep animating 200+
    // background embers while the browser tab is in the background and
    // nobody can see them.
    document.addEventListener('visibilitychange', () => {
        el.particles.classList.toggle('paused', document.hidden);
    });
    el.questTypeTimedBtn.addEventListener('click', () => {
    questBuilderType = 'timed';
    el.questTypeTimedBtn.className = 'btn-primary';
    el.questTypeTaskBtn.className = 'btn-ghost';
    el.questHoursGroup.style.display = 'block';
});
el.questTypeTaskBtn.addEventListener('click', () => {
    questBuilderType = 'task';
    el.questTypeTaskBtn.className = 'btn-primary';
    el.questTypeTimedBtn.className = 'btn-ghost';
    el.questHoursGroup.style.display = 'none';
});
}


/* ================================================================
   20. INIT
   ================================================================
   The entry point. Everything above this point is just definitions —
   nothing actually happens until init() runs (triggered by the single
   init() call at the very bottom of this file, which executes as soon
   as the browser finishes parsing the script).

   Order matters here: cacheRefs() must run first (everything else
   reads from `el`), and wireEvents() must run LAST (so every element
   it wires up already has its correct starting state/text/visuals in
   place before any click handler could possibly fire).
   ================================================================ */
function init() {
    cacheRefs();
    initParticles();
    history = Store.getJSON('history', []);

    // --- Restore character-level progress ---
    const houredSaved = Store.getJSON('houred', null);
    if (houredSaved) {
        totalHours = houredSaved.totalHours || 0;
        level = houredSaved.level || 1;
        starthours = houredSaved.starthours || 0;
    }

    // --- Restore skills + rebuild their cards in the SAVED order ---
    skills = Store.getJSON('skills', {});

    const savedOrder = Store.getJSON('cardOrder', null);
    let orderedNames = Object.keys(skills);
    if (savedOrder) {
        // Start with whichever saved-order names still actually exist
        // in `skills` (a skill could have been deleted since the order
        // was last saved), then append any skills that exist but
        // WEREN'T in the saved order (e.g. added via some path that
        // doesn't call persistCardOrder, or corrupted/old save data) —
        // so nothing ever silently disappears from the grid even if
        // the order data is incomplete.
        const known = savedOrder.filter(name => name in skills);
        const extra = orderedNames.filter(name => !known.includes(name));
        orderedNames = [...known, ...extra];
    }

    orderedNames.forEach((activity, index) => {
        // Defensive defaults for any saved data that might predate
        // these fields existing.
        if (skills[activity].startxp === undefined) skills[activity].startxp = 0;
        if (skills[activity].hours === undefined) skills[activity].hours = 0;
        createCard(activity, skills[activity], index);
    });

    if (Object.keys(skills).length === 0) document.body.classList.add('pre-log'); // no skills at all yet — dim most HUD controls until the user logs their first activity (see logProgress, which removes this class)

    // --- Restore / validate the logging streak ---
    const savedDate = Store.getStr('lastLogDate', null);
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    streak = parseInt(Store.getStr('streak', '0'), 10) || 0;
    if (savedDate && savedDate !== today && savedDate !== yesterday) {
        // Last log wasn't today OR yesterday — there's a gap of 2+ days,
        // so the streak is broken. Reset it.
        streak = 0;
        Store.setStr('streak', '0');
    }
    el.streakCount.textContent = streak;

    // --- Restore character name ---
    characterName = Store.getStr('characterName', 'Hunter');
    el.charName.textContent = characterName;

    const lightMode = Store.getStr('lightMode', 'false') === 'true';
if (lightMode) document.body.classList.add('light-mode');
el.themeToggle.textContent = lightMode ? '☀️' : '🌙';

    // --- Restore sound preference ---
    soundMuted = Store.getStr('muted', 'false') === 'true'; // localStorage only stores strings, so this compares against the literal string 'true'
    updateMuteIcon();

    updateXPBar();
    updateProfileVisuals();

    if (el.dailyQuestTimeBtn) el.dailyQuestTimeBtn.dataset.hours = QUEST_HOURS_GOAL; // keeps the Focus Mode "Daily Quest" length preset in sync with QUEST_HOURS_GOAL, in case that constant is ever changed

    // --- Load today's quest + log data (creating fresh ones if this is a new day) ---
    dailyQuest = loadOrCreateQuest();
    dailyLog = loadOrCreateDailyLog();
    renderQuest();

    // Wire up every click/input/keydown listener LAST, once everything
    // above has already set the app into its correct starting state.
    wireEvents();

    // ------------------------------------------------------------------
    // TEMPORARY TEST TRIGGER — fires the streak notification 30 seconds
    // after page load, purely so it can be previewed/tweaked without
    // waiting for real day-boundary logic. Replace this with an actual
    // "has the user logged anything today, and is it getting late"
    // check once the notification's design and copy feel right, then
    // delete this line.
    // ------------------------------------------------------------------
    
}

init();