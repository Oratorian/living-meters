/* ============================================================================
 * Universal 30-turn test run
 *
 *   node playthrough.js              30 turns, deterministic
 *   node playthrough.js 60           a longer run
 *   node playthrough.js 30 --seed 7  shuffle the event order
 *   node playthrough.js --quiet      tuning report only
 *
 * Reads whatever is configured in library.js and BUILDS the playthrough from
 * it — every resource, every trigger, whatever preset. Change RM_CONFIG and
 * re-run; you never edit this file.
 *
 * It answers the questions you would otherwise need a live adventure to
 * answer: does anything bottom out and stay there, does a crisis arrive too
 * early or never, is a trigger unreachable, does a band never get entered,
 * and what does the AI actually get told.
 *
 * test-harness.js proves the framework is CORRECT. This shows whether your
 * scenario is TUNED.
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = __dirname;
let LIB = fs.readFileSync(path.join(DIR, "library.js"), "utf8");
const HOOKS = {
  input: fs.readFileSync(path.join(DIR, "input.js"), "utf8"),
  context: fs.readFileSync(path.join(DIR, "context.js"), "utf8"),
  output: fs.readFileSync(path.join(DIR, "output.js"), "utf8"),
};

// ---- args -------------------------------------------------------------------

const ARGV = process.argv.slice(2);
const TURNS = Math.max(1, Number(ARGV.find(a => /^\d+$/.test(a))) || 30);
const QUIET = ARGV.includes("--quiet");
const SEED0 = Number((ARGV[ARGV.indexOf("--seed") + 1]) || 0) || 1;

// --preset <name> previews a built-in preset ON ITS OWN, ignoring the custom
// resources in RM_CONFIG. Useful for deciding which preset to start from.
// library.js itself is never modified.
const PRESET = ARGV.includes("--preset") ? ARGV[ARGV.indexOf("--preset") + 1] : null;
if (PRESET) {
  LIB = LIB
    .replace(/preset:\s*"[a-z]+"/, `preset: "${PRESET}"`)
    .replace(/\n  resources: \[[\s\S]*?\n  \],/, "\n  resources: [],");
}

let SEED = SEED0 * 2654435761 % 2147483647;
const rnd = () => (SEED = (SEED * 48271) % 2147483647) / 2147483647;

// ---- colour -----------------------------------------------------------------

const C = {
  dim: s => `\x1b[90m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  mag: s => `\x1b[35m${s}\x1b[0m`,
};

// ---- sandbox ----------------------------------------------------------------

const world = { state: {}, storyCards: [], history: [], ac: 0 };

function makeSandbox(text, state, cards, hist, info) {
  const sb = {
    text, stop: false,
    state: JSON.parse(JSON.stringify(state || {})),
    storyCards: JSON.parse(JSON.stringify(cards || [])),
    history: JSON.parse(JSON.stringify(hist || [])),
    info, memory: {},
  };
  sb.log = () => {};
  sb.console = { log: () => {}, error: () => {} };
  sb.addStoryCard = (keys, entry, type = "Custom", name = keys, notes = "", options) => {
    sb.storyCards.push({ id: Math.floor(rnd() * 1e9).toString(),
      keys, entry, type, title: name, description: notes });
    if (options && options.returnCard) return sb.storyCards[sb.storyCards.length - 1];
    return sb.storyCards.length;
  };
  sb.removeStoryCard = (i) => { sb.storyCards.splice(i, 1); };
  sb.updateStoryCard = () => {};
  return sb;
}

function step(hook, text, info) {
  const sb = makeSandbox(text, world.state, world.storyCards, world.history, info);
  const t0 = Date.now();
  const r = vm.runInContext(LIB + "\n\n" + HOOKS[hook], vm.createContext(sb),
    { timeout: 2000, filename: "<isolated-vm>" });
  const ms = Date.now() - t0;
  world.state = JSON.parse(JSON.stringify(sb.state));
  world.storyCards = JSON.parse(JSON.stringify(sb.storyCards));
  return { r, ms, message: sb.state.message };
}

function inspect(expr) {
  const sb = makeSandbox(" ", {}, [], [], { actionCount: 1, characterNames: [], maxChars: 8000 });
  return JSON.parse(vm.runInContext(LIB + "\n;JSON.stringify(" + expr + ")",
    vm.createContext(sb), { timeout: 2000 }));
}

// ---- read the creator's configuration ---------------------------------------

const DEFS = inspect("RM.defs()").filter(d => d.enabled);
const PROBLEMS = inspect("RM.problems()");
const SETUP = inspect(
  "({preset: RM_CONFIG.preset, inject: RM_CONFIG.inject, label: RM_CONFIG.injectLabel," +
  " difficulty: RM_CONFIG.difficulty, scanInput: RM_CONFIG.scanInput," +
  " scanOutput: RM_CONFIG.scanOutput, statusEvery: RM_CONFIG.statusEvery})");
// Read from config rather than hardcoding, so a rename cannot break this.
const CARD_TITLE = inspect("RM_CONFIG.playerCardTitle");

if (!DEFS.length) {
  console.log(C.yellow("\nNo resources are configured. Set RM_CONFIG.preset or add entries to " +
    "RM_CONFIG.resources, then run this again.\n"));
  process.exit(1);
}

// ---- synthesise the run -----------------------------------------------------

// Carrier sentences. Deliberately bland and genre-neutral: their only job is to
// place a trigger word into text the framework will scan.
const OUT_FORMS = [
  w => `And then: ${w}.`,
  w => `It happens quickly — ${w} — and the moment passes.`,
  w => `What follows is ${w}, and little else.`,
  w => `There is ${w} to deal with now.`,
  w => `The next stretch of time is all ${w}.`,
];
const IN_FORMS = [
  w => `\n> You deal with the ${w}.`,
  w => `\n> You turn your attention to ${w}.`,
  w => `\n> You do what you can about ${w}.`,
];
const NEUTRAL_IN = [
  "\n> You wait.",
  "\n> You keep going.",
  "\n> You take stock.",
  "\n> You press on.",
  "\n> You rest a moment.",   // note: may itself trigger, which is realistic
];
const NEUTRAL_OUT = [
  "Time passes without incident.",
  "Nothing of consequence occurs.",
  "The moment stretches out and then lets go.",
  "Quiet. For now.",
];

// Every trigger becomes one schedulable event. Losses are scheduled before
// gains on the same resource, so a gain is not clamped away at the ceiling.
function buildEvents() {
  const perResource = DEFS.map(d => {
    const usable = d.triggers.filter(t => t.words[0] !== "(custom pattern)");
    const drains = usable.filter(t => t.delta < 0);
    const gains = usable.filter(t => t.delta > 0);
    const seq = [];
    for (let i = 0; i < Math.max(drains.length, gains.length); i++) {
      if (drains[i]) seq.push({ d, t: drains[i] });
      if (gains[i]) seq.push({ d, t: gains[i] });
    }
    return seq;
  });
  // Round-robin so no single resource is hammered while others idle.
  const flat = [];
  for (let i = 0; ; i++) {
    let any = false;
    for (const seq of perResource) if (seq[i]) { flat.push(seq[i]); any = true; }
    if (!any) break;
  }
  return flat;
}

function buildSchedule(events, turns) {
  const plan = new Array(turns).fill(null);
  // Turn 1 and the last turn are quiet, plus every sixth turn, so per-turn
  // drift is observable on its own.
  for (let i = 0; i < turns; i++) {
    if (i === 0 || i === turns - 1 || (i + 1) % 6 === 0) plan[i] = [];
  }
  if (!events.length) return plan.map(p => p || []);

  const order = events.slice();
  if (SEED0 !== 1) {                                   // --seed shuffles
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  let e = 0;
  for (let i = 0; i < turns; i++) {
    if (plan[i] !== null) continue;
    const batch = [order[e % order.length]];
    e++;
    // Every third busy turn pairs two events on DIFFERENT resources, which is
    // how interlocking configs (repair costs parts) show themselves.
    if (order.length > 1 && i % 3 === 0) {
      const cand = order[e % order.length];
      if (cand.d.id !== batch[0].d.id) { batch.push(cand); e++; }
    }
    plan[i] = batch;
  }
  return plan;
}

const EVENTS = buildEvents();
const PLAN = buildSchedule(EVENTS, TURNS);

function renderTurn(batch, n) {
  if (!batch.length) {
    return [NEUTRAL_IN[n % NEUTRAL_IN.length], NEUTRAL_OUT[n % NEUTRAL_OUT.length]];
  }
  const inWords = [], outWords = [];
  batch.forEach(ev => {
    const w = ev.t.words[Math.floor(rnd() * ev.t.words.length)].replace(/\*$/, "");
    // "input" must appear in the action; everything else goes in the narration,
    // where an on:"both" trigger still fires exactly once.
    (ev.t.on === "input" ? inWords : outWords).push(w);
  });
  const input = inWords.length
    ? IN_FORMS[n % IN_FORMS.length](inWords.join(" and "))
    : NEUTRAL_IN[n % NEUTRAL_IN.length];
  const output = outWords.length
    ? outWords.map((w, i) => OUT_FORMS[(n + i) % OUT_FORMS.length](w)).join(" ")
    : NEUTRAL_OUT[n % NEUTRAL_OUT.length];
  return [input, output];
}

// ---- run --------------------------------------------------------------------

const snap = () => JSON.parse(JSON.stringify(world.state.RM ? world.state.RM.res : {}));
const bandsOf = () => JSON.parse(JSON.stringify(world.state.RM ? world.state.RM.band : {}));

const trace = [];        // per-turn resource values
const seenBands = {};    // id -> Set of band names visited
const moved = {};        // id -> did a trigger ever move it
let worstMs = 0;
const toasts = [];

DEFS.forEach(d => { seenBands[d.id] = new Set(); moved[d.id] = false; });

console.log("");
console.log(C.bold("╔════════════════════════════════════════════════════════════════════════════╗"));
console.log(C.bold("║  " + `Living Meters: ${TURNS}-turn test run`.padEnd(74) + "║"));
console.log(C.bold("╚════════════════════════════════════════════════════════════════════════════╝"));
console.log(`\n  preset ${C.cyan(SETUP.preset)}   inject ${C.cyan(SETUP.inject)}   difficulty ${C.cyan(SETUP.difficulty)}` +
  `   ${C.cyan(DEFS.length)} resources   ${C.cyan(EVENTS.length)} triggers`);
console.log(`  ${DEFS.map(d => (d.icon ? d.icon + " " : "") + d.label).join("   ")}`);
if (PROBLEMS.length) {
  console.log("\n" + C.red("  config problems:"));
  PROBLEMS.forEach(p => console.log(C.red("   • " + p)));
}
if (!QUIET) console.log(C.dim("\n  grey = per-turn drift    green/red = a trigger fired"));

for (let n = 0; n < TURNS; n++) {
  const [action, aiText] = renderTurn(PLAN[n], n);
  const before = snap(), beforeBands = bandsOf();

  world.ac += 1;
  const i = step("input", action, { actionCount: world.ac, characterNames: [] });
  world.history.push({ text: action, rawText: action, type: "do" });

  world.ac += 1;
  const ctxText = "Plot Essentials\nWorld Lore:\n\nRecent Story:\n" +
    world.history.slice(-8).map(h => h.text).join("\n");
  const c = step("context", ctxText, {
    actionCount: world.ac, characterNames: [], maxChars: 8000,
    memoryLength: 0, contextTokens: 2000,
    storyModel: { name: "Dynamic Small", version: "1.0.0" },
  });

  const o = step("output", aiText, { actionCount: world.ac, characterNames: [] });
  world.history.push({ text: aiText, rawText: aiText, type: "continue" });

  worstMs = Math.max(worstMs, i.ms, c.ms, o.ms);
  const after = snap(), afterBands = bandsOf();
  trace.push(after);
  DEFS.forEach(d => { if (afterBands[d.id]) seenBands[d.id].add(afterBands[d.id]); });
  for (const m of [i.message, c.message, o.message]) if (m && !toasts.includes(m)) toasts.push(m);

  if (!QUIET) {
    console.log("\n" + C.dim("─".repeat(78)));
    console.log(C.bold(`Turn ${String(n + 1).padStart(2)}`) + "  " + C.cyan("▸") + " " +
      action.replace(/^\n> /, ""));
    console.log("        " + C.dim("◂ " + (aiText.length > 92 ? aiText.slice(0, 92) + "…" : aiText)));

    const rows = [];
    for (const d of DEFS) {
      const b = before[d.id], a = after[d.id];
      if (b === undefined || a === undefined || Math.abs(a - b) < 0.001) continue;
      const delta = a - b;
      const drifted = Math.abs(delta - d.perTurn) < 0.001;
      if (!drifted) moved[d.id] = true;
      const line = `   ${(d.icon || "•")} ${d.label.padEnd(13)}` +
        `${b.toFixed(1).padStart(7)} → ${a.toFixed(1).padStart(7)}  ` +
        `${delta > 0 ? "▲" : "▼"}${Math.abs(delta).toFixed(1)}`;
      rows.push(drifted ? C.dim(line) : (delta > 0 ? C.green(line) : C.red(line)));
    }
    if (rows.length) console.log(rows.join("\n"));

    for (const d of DEFS) {
      if (beforeBands[d.id] !== undefined && afterBands[d.id] !== beforeBands[d.id]) {
        console.log(C.yellow(`   ⚠  ${d.label}: ${beforeBands[d.id] || "—"} → ${afterBands[d.id]}`));
      }
    }

    if ((n + 1) % 10 === 0 || n === TURNS - 1) {
      const block = SETUP.inject === "frontMemory"
        ? (c.r && c.r.text ? "" : "")
        : c.r.text.split("\n").pop();
      const shown = SETUP.inject === "none" ? "(inject is \"none\" — the AI is told nothing)" : block;
      console.log("\n" + C.mag(`   ┌─ what the AI is told after turn ${n + 1} ` + "─".repeat(36)));
      String(shown).replace(/^\[|\]$/g, "").split(/(?<=\.) /)
        .forEach(s => console.log(C.mag("   │ ") + s.trim()));
      console.log(C.mag("   └" + "─".repeat(72)));
    }
  } else {
    DEFS.forEach(d => {
      const delta = (after[d.id] ?? 0) - (before[d.id] ?? 0);
      if (Math.abs(delta) > 0.001 && Math.abs(delta - d.perTurn) > 0.001) moved[d.id] = true;
    });
  }
}

// ---- tuning report ----------------------------------------------------------

console.log("\n\n" + C.bold("── Final state " + "─".repeat(62)) + "\n");
const final = snap(), finalBands = bandsOf();
for (const d of DEFS) {
  const v = final[d.id];
  const span = d.max - d.min || 1;
  const filled = Math.max(0, Math.min(10, Math.round(((v - d.min) / span) * 10)));
  console.log(`  ${(d.icon || "•")} ${d.label.padEnd(13)}` +
    `${"█".repeat(filled)}${"░".repeat(10 - filled)} ` +
    `${String(Math.round(v)).padStart(6)}/${d.max}   ` + C.dim(finalBands[d.id] || ""));
}

console.log("\n" + C.bold("── Tuning " + "─".repeat(67)) + "\n");

const warnings = [];
const unvisited = [];
for (const d of DEFS) {
  const series = trace.map(t => t[d.id]);

  // Share of the whole run spent pinned at either end. Measuring the whole run
  // rather than just the tail catches a resource that floors early, gets one
  // lucky bump, and floors again.
  const atMin = series.filter(v => v <= d.min + 0.001).length;
  const atMax = series.filter(v => v >= d.max - 0.001).length;

  // Turns until drift alone exhausts it, from where it started.
  let projection = "";
  if (d.perTurn < 0) {
    const n = Math.ceil((d.start - d.min) / Math.abs(d.perTurn));
    projection = n <= 0
      ? `${d.perTurn}/turn → starts on its floor`
      : `${d.perTurn}/turn → floor in ~${n} turns`;
  } else if (d.perTurn > 0) {
    const n = Math.ceil((d.max - d.start) / d.perTurn);
    projection = n <= 0
      ? `+${d.perTurn}/turn → starts at its ceiling, refills after any loss`
      : `+${d.perTurn}/turn → ceiling in ~${n} turns`;
  } else {
    projection = C.dim("no drift — triggers only");
  }

  const visited = seenBands[d.id].size;
  const total = new Set(d.bands.map(b => b.name)).size || 1;

  console.log(`  ${(d.icon || "•")} ${d.label.padEnd(13)}${projection}` +
    `${" ".repeat(Math.max(1, 34 - projection.replace(/\x1b\[[0-9;]*m/g, "").length))}` +
    C.dim(`bands ${visited}/${total}`));

  if (atMin / TURNS >= 0.3)
    warnings.push(`${d.label} spent ${Math.round(atMin / TURNS * 100)}% of the run on its floor ` +
      `(${d.min}). Fine if it is meant to spike and decay back to a baseline; otherwise raise ` +
      `\`start\`, soften \`perTurn\`, or add a stronger recovery trigger.`);
  if (atMax / TURNS >= 0.5 && d.perTurn <= 0 && d.triggers.some(t => t.delta < 0))
    warnings.push(`${d.label} spent ${Math.round(atMax / TURNS * 100)}% of the run at its ceiling ` +
      `(${d.max}) — it is under no real pressure, and gains are being clamped away.`);
  if (!moved[d.id] && d.triggers.length)
    warnings.push(`${d.label} has ${d.triggers.length} trigger(s) but none of them changed it ` +
      `during this run — check the words, or it may be clamped at a limit.`);
  if (!d.triggers.length && !d.perTurn)
    warnings.push(`${d.label} has no triggers and no drift — nothing can ever change it.`);
  const maxBand = Math.max(...d.bands.map(b => b.upTo ?? 0));
  if (d.bands.length && maxBand < d.max)
    warnings.push(`${d.label} bands stop at ${maxBand} but max is ${d.max} — ` +
      `values above ${maxBand} fall back to the last band.`);

  if (visited < total && total > 1) unvisited.push(`${d.label} ${visited}/${total}`);
}

if (warnings.length) {
  console.log("\n" + C.yellow(`  ${warnings.length} thing(s) worth looking at:`));
  warnings.forEach(w => console.log(C.yellow("   • ") + w));
} else {
  console.log("\n" + C.green("  Nothing looks mistuned over this run."));
}

// Not a fault — a 30-turn run simply may not reach every band. Worth knowing
// which narrative instructions the AI has never actually been given.
if (unvisited.length) {
  console.log("\n" + C.dim(`  Bands not reached in ${TURNS} turns: ${unvisited.join(", ")}.`));
  console.log(C.dim(`  Those tells have never been sent to the AI. Try a longer run ` +
    `(node playthrough.js 120) to see whether they are reachable at all.`));
}

// ---- everything else --------------------------------------------------------

const card = world.storyCards.find(c => c.title === CARD_TITLE);
console.log("\n" + C.bold("── Runtime " + "─".repeat(66)) + "\n");
console.log(`  worst hook        ${worstMs} ms ` + C.dim("(budget 2000)"));
console.log(`  state size        ${JSON.stringify(world.state).length} chars`);
console.log(`  story cards       ${world.storyCards.length}` +
  (card ? C.dim(`  — "${card.title}", keys "${card.keys}"`) : C.yellow("  — none created")));
console.log(`  toasts shown      ${toasts.length}`);
if (toasts.length && !QUIET) {
  toasts.slice(0, 4).forEach(t => console.log(C.dim("     " + t.split("\n")[0])));
  if (toasts.length > 4) console.log(C.dim(`     …and ${toasts.length - 4} more`));
}
console.log("");
