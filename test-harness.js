/* ============================================================================
 * Local test harness for Living Meters.
 *
 *   node test-harness.js
 *
 * Mimics the AI Dungeon sandbox as closely as is practical:
 *   - a FRESH V8 context per hook, with the Library text prepended to the hook
 *     script exactly as the platform does
 *   - `state` and `storyCards` JSON round-tripped between every hook, which is
 *     what catches "I stored a RegExp/Map/function in state" bugs
 *   - addStoryCard implemented per the real extracted sandbox source: six
 *     parameters, returns the new LENGTH, string ids
 *   - no Node globals leak in, so a stray require/setTimeout fails here too
 *
 * The tests are CONFIG-DRIVEN. They read RM.defs() and exercise whatever
 * resources and triggers are actually configured, so this file keeps working
 * when you rewrite RM_CONFIG for your own scenario.
 * ==========================================================================*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const DIR = __dirname;
const LIB = fs.readFileSync(path.join(DIR, "library.js"), "utf8");
const HOOKS = {
  input: fs.readFileSync(path.join(DIR, "input.js"), "utf8"),
  context: fs.readFileSync(path.join(DIR, "context.js"), "utf8"),
  output: fs.readFileSync(path.join(DIR, "output.js"), "utf8"),
};

// ---- sandbox ----------------------------------------------------------------

function makeSandbox(text, state, storyCards, history, info) {
  const sb = {
    text: text, stop: false,
    state: JSON.parse(JSON.stringify(state || {})),
    storyCards: JSON.parse(JSON.stringify(storyCards || [])),
    history: JSON.parse(JSON.stringify(history || [])),
    info: info || { actionCount: 1, characterNames: [] },
    memory: {},
  };
  sb.log = () => {};
  sb.console = { log: () => {}, error: () => {} };
  sb.addStoryCard = (keys, entry, type = "Custom", name = keys, notes = "", options) => {
    sb.storyCards.push({
      id: Math.floor(Math.random() * 1000000000).toString(),
      keys, entry, type, title: name, description: notes,
    });
    if (options && options.returnCard) return sb.storyCards[sb.storyCards.length - 1];
    return sb.storyCards.length;
  };
  sb.removeStoryCard = (i) => {
    if (!sb.storyCards[i]) throw new Error("Story card not found at index " + i);
    sb.storyCards.splice(i, 1);
  };
  sb.updateStoryCard = (i, keys, entry, type, name, notes) => {
    const ex = sb.storyCards[i];
    if (!ex) throw new Error("Story card not found at index " + i);
    sb.storyCards[i] = { id: ex.id, keys, entry,
      type: type ?? ex.type, title: name ?? ex.title, description: notes ?? ex.description };
  };
  return sb;
}

const world = { state: {}, storyCards: [], history: [], actionCount: 0 };

function runHook(hook, text, info, lib) {
  const sb = makeSandbox(text, world.state, world.storyCards, world.history, info);
  const started = Date.now();
  let result;
  try {
    result = vm.runInContext((lib || LIB) + "\n\n" + HOOKS[hook], vm.createContext(sb),
      { timeout: 2000, filename: "<isolated-vm>" });
  } catch (err) {
    return { error: err, ms: Date.now() - started };
  }
  const ms = Date.now() - started;
  world.state = JSON.parse(JSON.stringify(sb.state));
  world.storyCards = JSON.parse(JSON.stringify(sb.storyCards));
  return { result, ms, message: sb.state && sb.state.message };
}

function turn(playerText, aiText, type = "do") {
  const out = {};
  if (playerText !== null) {
    world.actionCount += 1;
    const r = runHook("input", playerText, { actionCount: world.actionCount, characterNames: [] });
    if (r.error) throw r.error;
    out.input = r;
    world.history.push({ text: playerText, rawText: playerText, type });
  }
  world.actionCount += 1;
  const ctxText = "Plot Essentials\nWorld Lore:\n\nRecent Story:\n" +
    world.history.map(h => h.text).join("\n");
  const c = runHook("context", ctxText, {
    actionCount: world.actionCount, characterNames: [],
    maxChars: 8000, memoryLength: 0, contextTokens: 2000,
    storyModel: { name: "Dynamic Small", version: "1.0.0" },
  });
  if (c.error) throw c.error;
  out.context = c;
  const o = runHook("output", aiText, { actionCount: world.actionCount, characterNames: [] });
  if (o.error) throw o.error;
  out.output = o;
  world.history.push({ text: aiText, rawText: aiText, type: "continue" });
  return out;
}

// Evaluate an expression against a fresh library instance.
function inspect(expr, lib) {
  const sb = makeSandbox(" ", {}, [], [], { actionCount: 1, characterNames: [], maxChars: 8000 });
  return JSON.parse(vm.runInContext((lib || LIB) + "\n;JSON.stringify(" + expr + ")",
    vm.createContext(sb), { timeout: 2000 }));
}

// One isolated turn from a clean slate; returns the resulting resource values.
// `seed` optionally sets a resource to a value first, so a positive trigger on
// a resource that starts at its maximum is still measurable.
function simulate(inputText, outputText, lib, seed) {
  const carry = { state: {}, storyCards: [], history: [] };
  let ac = 0;
  const step = (hook, text) => {
    ac += 1;
    const sb = makeSandbox(text, carry.state, carry.storyCards, carry.history,
      { actionCount: ac, characterNames: [], maxChars: 8000 });
    vm.runInContext((lib || LIB) + "\n\n" + HOOKS[hook], vm.createContext(sb), { timeout: 2000 });
    carry.state = JSON.parse(JSON.stringify(sb.state));
    carry.storyCards = JSON.parse(JSON.stringify(sb.storyCards));
  };
  if (seed) {
    step("input", `\n> You say "/${seed.id} =${seed.value}"`);
    step("context", "ctx");   // consumes the halt the command queued
  }
  step("input", inputText);
  carry.history.push({ text: inputText, type: "do" });
  step("context", "ctx");
  step("output", outputText);
  return carry.state.RM ? carry.state.RM.res : {};
}

// ---- assertions -------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  → " + detail : ""}`); }
}
function res(id) { return world.state.RM && world.state.RM.res ? world.state.RM.res[id] : undefined; }

// ---- introspect the configured scenario -------------------------------------

const CFG = inspect("RM.defs()").filter(d => d.enabled);
const PROBLEMS = inspect("RM.problems()");
// Read display strings from the config rather than hardcoding them, so
// renaming the script cannot break the tests.
const CARD_TITLE = inspect("RM_CONFIG.playerCardTitle");
const INJECT_LABEL = inspect("RM_CONFIG.injectLabel");

const FIRST = CFG[0];
const DRIFT_DOWN = CFG.find(d => d.perTurn < 0);
const DRIFT_UP = CFG.find(d => d.perTurn > 0);
const STATIC = CFG.find(d => d.perTurn === 0);
// A resource whose worst band carries an instruction for the AI.
const LETHAL = CFG.find(d => d.bands.length && d.bands.slice()
  .sort((a, b) => a.upTo - b.upTo)[0].tell);

console.log("\n=== Living Meters harness ===");
console.log(`configured: ${CFG.length} resources — ${CFG.map(d => d.id).join(", ")}\n`);

// 0. config sanity
console.log("0. config");
check("config has no problems", PROBLEMS.length === 0, PROBLEMS.join(" | "));
check("at least one resource", CFG.length > 0);
check("every resource has a label", CFG.every(d => d.label), "");
check("every resource starts in range",
  CFG.every(d => d.start >= d.min && d.start <= d.max),
  CFG.filter(d => d.start < d.min || d.start > d.max).map(d => d.id).join(","));
check("every band set covers the max",
  CFG.every(d => !d.bands.length || Math.max(...d.bands.map(b => b.upTo)) >= d.max),
  CFG.filter(d => d.bands.length && Math.max(...d.bands.map(b => b.upTo)) < d.max)
     .map(d => `${d.id} (bands stop at ${Math.max(...d.bands.map(b => b.upTo))}, max ${d.max})`).join(", "));

// 1. cold start
console.log("\n1. cold start");
let t = turn("\n> You check the readouts.", "The console glows in the dark.");
check("state initialised", !!world.state.RM);
check("all resources present", CFG.every(d => typeof res(d.id) === "number"),
  CFG.filter(d => typeof res(d.id) !== "number").map(d => d.id).join(","));
check("player card created", world.storyCards.some(c => c.title === CARD_TITLE), CARD_TITLE);
check("card key is a sentinel", world.storyCards.some(c => c.keys === "%RM%"));
check("status block injected", t.context.result.text.includes(INJECT_LABEL), INJECT_LABEL);
check("hook under 2s", t.context.ms < 2000, t.context.ms + "ms");

// 2. per-turn drift
console.log("\n2. per-turn drift");
if (DRIFT_DOWN) {
  const before = res(DRIFT_DOWN.id);
  turn("\n> You wait.", "The ship hums.");
  const delta = before - res(DRIFT_DOWN.id);
  check(`${DRIFT_DOWN.id} drifts down`, delta > 0, `${before} → ${res(DRIFT_DOWN.id)}`);
  check("ticked exactly once", Math.abs(delta - Math.abs(DRIFT_DOWN.perTurn)) < 0.01,
    `delta ${delta.toFixed(2)}, expected ${Math.abs(DRIFT_DOWN.perTurn).toFixed(2)}`);
} else check("no downward-drifting resource configured (skipped)", true);

if (DRIFT_UP) {
  const before = res(DRIFT_UP.id);
  turn("\n> You wait.", "The ship hums.");
  check(`${DRIFT_UP.id} accumulates`, res(DRIFT_UP.id) > before,
    `${before} → ${res(DRIFT_UP.id)}`);
} else check("no upward-drifting resource configured (skipped)", true);

if (STATIC) {
  const before = res(STATIC.id);
  turn("\n> You wait.", "The ship hums.");
  check(`${STATIC.id} does not drift`, res(STATIC.id) === before, `${before} → ${res(STATIC.id)}`);
} else check("no static resource configured (skipped)", true);

// 3. EVERY configured trigger actually fires
// Control vs treatment, so per-turn drift is subtracted out.
console.log("\n3. trigger coverage (every configured trigger)");
let fired = 0, missed = [];
for (const d of CFG) {
  // Seed to the midpoint so a gain is not clamped away at max and a loss is
  // not clamped away at min. Control uses the same seed, so per-turn drift
  // cancels out of the comparison.
  const seed = { id: d.id, value: Math.round((d.min + d.max) / 2) };
  const control = simulate("\n> You wait.", "Nothing happens aboard the ship.", null, seed);

  for (const tr of d.triggers) {
    if (tr.words[0] === "(custom pattern)") continue;
    const word = tr.words[0].replace(/\*$/, "");
    const treated = tr.on === "input"
      ? simulate(`\n> You ${word} carefully.`, "Nothing happens aboard the ship.", null, seed)
      : simulate("\n> You wait.", `The crew ${word} without incident.`, null, seed);
    const moved = (treated[d.id] ?? 0) - (control[d.id] ?? 0);
    if (Math.sign(moved) === Math.sign(tr.delta) && moved !== 0) fired++;
    else missed.push(`${d.id}:"${tr.words[0]}" expected ${tr.delta > 0 ? "+" : ""}${tr.delta}, got ${moved.toFixed(1)}`);
  }
}
check(`all ${fired + missed.length} triggers fire in the right direction`,
  missed.length === 0, missed.slice(0, 6).join(" | "));

// An `on: "both"` trigger must fire ONCE per turn even when its word appears in
// the player's action AND the AI's narration. One weld is one weld.
const both = CFG.map(d => ({ d, tr: d.triggers.find(x => x.on === "both" && x.words[0] !== "(custom pattern)") }))
                .find(x => x.tr);
if (both) {
  const word = both.tr.words[0].replace(/\*$/, "");
  const seed = { id: both.d.id, value: Math.round((both.d.min + both.d.max) / 2) };
  const base = simulate("\n> You wait.", "Nothing happens aboard the ship.", null, seed);
  const once = simulate("\n> You wait.", `The crew ${word} without incident.`, null, seed);
  const twice = simulate(`\n> You ${word} carefully.`, `The crew ${word} without incident.`, null, seed);
  const dOnce = (once[both.d.id] ?? 0) - (base[both.d.id] ?? 0);
  const dTwice = (twice[both.d.id] ?? 0) - (base[both.d.id] ?? 0);
  check(`"${word}" in both input and output counts once`,
    Math.abs(dOnce - dTwice) < 0.01,
    `output-only ${dOnce.toFixed(1)}, both ${dTwice.toFixed(1)} (${both.d.id})`);
} else check("no on:both trigger configured (skipped)", true);

// 4. retry safety
console.log("\n4. retry safety");
const hazard = CFG.find(d => d.triggers.some(x => x.on === "output" && x.delta < 0));
if (hazard) {
  const tr = hazard.triggers.find(x => x.on === "output" && x.delta < 0);
  const word = tr.words[0].replace(/\*$/, "");
  const line = `Alarms blare as ${word} tears through the compartment.`;
  turn("\n> You brace.", line);
  const after = res(hazard.id);
  // A retry re-runs context+output on the SAME text without growing history.
  world.actionCount += 1;
  runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
  runHook("output", line, { actionCount: world.actionCount, characterNames: [] });
  check("identical output is not re-scanned", res(hazard.id) === after,
    `${after} → ${res(hazard.id)}`);
} else check("no output hazard configured (skipped)", true);

// 5. commands
console.log("\n5. commands");
const before5 = res(FIRST.id);
const c1 = runHook("input", `\n> You say "/${FIRST.id} +5"`,
  { actionCount: world.actionCount, characterNames: [] });
check("command produced a toast", typeof c1.message === "string" && c1.message.length > 0, c1.message);
check("command applied", res(FIRST.id) !== before5, `${before5} → ${res(FIRST.id)}`);
const c2 = runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
check("halt executed in context", c2.result.stop === true, String(c2.result.stop));
const c3 = runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
check("halt is one-shot", c3.result.stop === false, String(c3.result.stop));
const c4 = runHook("input", '\n> You say "/status"', { actionCount: world.actionCount, characterNames: [] });
check("/status lists every resource",
  CFG.filter(d => d.visible).every(d => (c4.message || "").includes(d.label)),
  (c4.message || "").split("\n")[0]);
runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });

// 6. player overrides via the story card
console.log("\n6. player overrides");
const card = world.storyCards.find(c => c.title === CARD_TITLE);
const target = DRIFT_DOWN || FIRST;
const offTarget = CFG.find(d => d.id !== target.id && d.perTurn < 0) || STATIC;
card.description += `\ndifficulty = hard\n${target.id}.perTurn = -10\n${offTarget.id}.off\n`;
const offBefore = res(offTarget.id);
const tgtBefore = res(target.id);
turn("\n> You press on.", "The corridor stretches ahead.");
check("override applied (drains faster)", (tgtBefore - res(target.id)) > 9,
  `delta ${(tgtBefore - res(target.id)).toFixed(2)}, expected 17.50`);
check("disabled resource stops drifting", res(offTarget.id) === offBefore,
  `${offBefore} → ${res(offTarget.id)}`);
check("disabled resource hidden from the AI",
  !new RegExp(offTarget.label).test(turn("\n> Onward.", "You walk.").context.result.text));

// 7. clamping and bands
console.log("\n7. clamping and bands");
runHook("input", `\n> You say "/${FIRST.id} =${FIRST.min}"`, { actionCount: world.actionCount, characterNames: [] });
runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
check(`${FIRST.id} clamped at min`, res(FIRST.id) === FIRST.min, String(res(FIRST.id)));
runHook("input", `\n> You say "/${FIRST.id} =999999"`, { actionCount: world.actionCount, characterNames: [] });
runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
check(`${FIRST.id} clamped at max`, res(FIRST.id) === FIRST.max, String(res(FIRST.id)));

if (LETHAL) {
  const worst = LETHAL.bands.slice().sort((a, b) => a.upTo - b.upTo)[0];
  runHook("input", `\n> You say "/${LETHAL.id} =${worst.upTo}"`, { actionCount: world.actionCount, characterNames: [] });
  // The command queued a halt; that context returns early without injecting.
  runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
  const shown = runHook("context", "ctx", { actionCount: ++world.actionCount, maxChars: 8000, characterNames: [] });
  const snippet = worst.tell.split(/[.,]/)[0].slice(0, 30);
  check("worst-band instruction reaches the AI", shown.result.text.includes(snippet), snippet);
} else check("no band instructions configured (skipped)", true);

// 8. state hygiene
console.log("\n8. state hygiene");
const ser = JSON.stringify(world.state);
check("state survives JSON round-trip", ser === JSON.stringify(JSON.parse(ser)));
check("state stays small", ser.length < 6000, ser.length + " chars");
check("no compiled patterns leaked into state", !/\(\?:\^\|/.test(ser));

// 9. degraded mode — story cards unavailable
console.log("\n9. story cards unavailable (Memory Bank off)");
const saved = JSON.parse(JSON.stringify(world.state));
const broken = (() => {
  const sb = makeSandbox(" ", saved, [], [], { actionCount: 5, characterNames: [] });
  sb.addStoryCard = () => { throw new Error("Memory Bank is off"); };
  try {
    vm.runInContext(LIB + "\n\n" + HOOKS.input, vm.createContext(sb), { timeout: 2000 });
    return { ok: true, msg: sb.state.message };
  } catch (e) { return { ok: false, err: e }; }
})();
check("survives card failure", broken.ok, broken.err && String(broken.err));
check("warns the player", /Memory Bank/.test(broken.msg || ""), broken.msg);

// 10. presets still load
console.log("\n10. presets");
for (const name of ["survival", "fantasy", "scifi", "noir", "none"]) {
  // Swap the preset AND drop the scenario resources, so each preset is alone.
  const src = LIB
    .replace(/preset:\s*"[a-z]+"/, `preset: "${name}"`)
    .replace(/\n  resources: \[[\s\S]*?\n  \],/, "\n  resources: [],");
  let ok = true, err = null, tracked = 0;
  const carry = { state: {}, storyCards: [] };
  try {
    for (const hook of ["input", "context", "output"]) {
      const sb = makeSandbox("\n> You wait.", carry.state, carry.storyCards, [],
        { actionCount: 1, characterNames: [], maxChars: 8000 });
      vm.runInContext(src + "\n\n" + HOOKS[hook], vm.createContext(sb), { timeout: 2000 });
      carry.state = JSON.parse(JSON.stringify(sb.state));
      carry.storyCards = JSON.parse(JSON.stringify(sb.storyCards));
    }
    tracked = carry.state.RM ? Object.keys(carry.state.RM.res).length : 0;
  } catch (e) { ok = false; err = e; }
  check(`preset "${name}" runs`, ok, err && String(err));
  check(`preset "${name}" tracks ${name === "none" ? "0" : ">0"} resources`,
    name === "none" ? tracked === 0 : tracked > 0, tracked + " resources");
}

// 11. trigger word lists — the creator never writes a regex
console.log("\n11. trigger word lists");

function withConfig(resourcesSrc, playerText, aiText) {
  const src = LIB.replace(/\n  resources: \[[\s\S]*?\n  \],/, `\n  resources: ${resourcesSrc},`);
  const carry = { state: {}, storyCards: [] };
  let toast = "", threw = null;
  try {
    for (const [hook, txt] of [["input", playerText], ["context", "ctx"], ["output", aiText]]) {
      const sb = makeSandbox(txt, carry.state, carry.storyCards, [],
        { actionCount: 3, characterNames: [], maxChars: 8000 });
      vm.runInContext(src + "\n\n" + HOOKS[hook], vm.createContext(sb), { timeout: 2000 });
      if (typeof sb.state.message === "string" && sb.state.message) toast = sb.state.message;
      carry.state = JSON.parse(JSON.stringify(sb.state));
      carry.storyCards = JSON.parse(JSON.stringify(sb.storyCards));
    }
  } catch (e) { threw = e; }
  return { toast, threw, res: carry.state.RM ? carry.state.RM.res : {} };
}

const GOLD = (words, delta) => `[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50,
    perTurn: 0, bands: [{ upTo: 100, name: "ok", tell: "" }],
    triggers: [{ on: "output", words: ${JSON.stringify(words)}, delta: ${delta} }] }]`;

let r = withConfig(GOLD(["loot*"], 10), "\n> You search.", "You looted the chest.");
check("word* matches suffixes", r.res.gold === 60, `gold ${r.res.gold}`);

r = withConfig(GOLD(["rest"], 10), "\n> You search.", "You found a restaurant on the corner.");
check("bare word does NOT match a longer word", r.res.gold === 50, `gold ${r.res.gold}`);

r = withConfig(GOLD(["rest"], 10), "\n> You search.", "You rest by the fire.");
check("bare word matches the whole word", r.res.gold === 60, `gold ${r.res.gold}`);

r = withConfig(GOLD(["dead body"], 10), "\n> You look.", "There is a dead body in the alley.");
check("phrases match", r.res.gold === 60, `gold ${r.res.gold}`);

r = withConfig(GOLD(["c++", "a.b"], 10), "\n> You look.", "You see a C++ manual.");
check("regex metacharacters are escaped", r.res.gold === 60, `gold ${r.res.gold}`);

const asString = `[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,
    bands: [{ upTo: 100, name: "ok", tell: "" }],
    triggers: [{ on: "output", match: "loot", delta: 10 }] }]`;
r = withConfig(asString, "\n> You search.", "You looted the chest.");
check("string-instead-of-regex is reported", /must be a regular expression/.test(r.toast), r.toast.split("\n")[1] || r.toast);
check("...and does not crash", !r.threw, r.threw && String(r.threw));

const noWords = `[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,
    bands: [{ upTo: 100, name: "ok", tell: "" }],
    triggers: [{ on: "output", delta: 10 }] }]`;
r = withConfig(noWords, "\n> You search.", "You looted the chest.");
check("missing words is reported", /needs words/.test(r.toast), r.toast.split("\n")[1] || r.toast);

const noDelta = `[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,
    bands: [{ upTo: 100, name: "ok", tell: "" }],
    triggers: [{ on: "output", words: ["loot*"] }] }]`;
r = withConfig(noDelta, "\n> You search.", "You looted the chest.");
check("missing delta is reported", /non-zero numeric/.test(r.toast), r.toast.split("\n")[1] || r.toast);

const badRange = `[{ id: "gold", label: "Gold", min: 100, max: 0, start: 50, perTurn: 0,
    bands: [], triggers: [] }]`;
r = withConfig(badRange, "\n> You search.", "Nothing.");
check("inverted min/max is reported", /must be greater than/.test(r.toast), r.toast.split("\n")[1] || r.toast);

const withRegex = `[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,
    bands: [{ upTo: 100, name: "ok", tell: "" }],
    triggers: [{ on: "output", match: /loot(ed)?/i, delta: 10 }] }]`;
r = withConfig(withRegex, "\n> You search.", "You looted the chest.");
check("explicit regex escape hatch still works", r.res.gold === 60, `gold ${r.res.gold}`);

// 12. performance under a realistic load
console.log("\n12. performance");
let worst = 0;
for (let i = 0; i < 25; i++) {
  const r2 = turn("\n> You continue the repairs.",
    "You weld the plate down, drink a water ration, and watch the reactor gauge climb.");
  worst = Math.max(worst, r2.input.ms, r2.context.ms, r2.output.ms);
}
check("worst hook well under 2000ms", worst < 500, worst + "ms");
check("state still small after 25 turns", JSON.stringify(world.state).length < 6000,
  JSON.stringify(world.state).length + " chars");

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail ? 1 : 0);
