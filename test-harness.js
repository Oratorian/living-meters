// SPDX-License-Identifier: MIT
/* ============================================================================
 * Living Meters: correctness tests (Node front end)
 *
 *   node test-harness.js        exit 0 = all passed, 1 = something failed
 *
 * Every assertion lives in docs/tests.js, which the browser page at
 * docs/index.html also runs. This file only supplies the sandbox:
 *
 *   - a FRESH V8 context per hook, with the Library text prepended to the hook
 *     script exactly as the platform does
 *   - `state` and `storyCards` JSON round-tripped between every hook, which is
 *     what catches "I stored a RegExp/Map/function in state" bugs
 *   - addStoryCard implemented per the real extracted sandbox source: six
 *     parameters, returns the new LENGTH, string ids
 *   - no Node globals leak in, so a stray require/setTimeout fails here too
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

require("./docs/tests.js");

// ---- the Node sandbox adapter ------------------------------------------------

let CARD_SEQ = 0;

function makeSandbox(p, opts) {
  const sb = {
    text: p.text, stop: false,
    state: JSON.parse(JSON.stringify(p.state || {})),
    storyCards: JSON.parse(JSON.stringify(p.storyCards || [])),
    history: JSON.parse(JSON.stringify(p.history || [])),
    info: p.info || { actionCount: 1, characterNames: [] },
    memory: {},
  };
  sb.log = () => {};
  sb.console = { log: () => {}, error: () => {} };

  sb.addStoryCard = (keys, entry, type = "Custom", name = keys, notes = "", options) => {
    if (opts && opts.breakCards) throw new Error("Memory Bank is off");
    sb.storyCards.push({
      id: String(++CARD_SEQ), keys, entry, type, title: name, description: notes,
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

function run(libSrc, tailSrc, payload, opts) {
  const sb = makeSandbox(payload, opts);
  const ret = vm.runInContext(libSrc + "\n\n" + tailSrc, vm.createContext(sb),
    { timeout: 2000, filename: "<isolated-vm>" });
  return {
    ret: ret,
    state: JSON.parse(JSON.stringify(sb.state)),
    storyCards: JSON.parse(JSON.stringify(sb.storyCards)),
    message: sb.state && sb.state.message,
  };
}

// ---- drive and report --------------------------------------------------------

const C = {
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

let result;
try {
  result = globalThis.LM_TESTS.runTests({ lib: LIB, hooks: HOOKS, run: run, perfBudget: 500 });
} catch (err) {
  console.log(C.bad("\nThe suite threw before it could finish:\n"));
  console.log(err && err.stack ? err.stack : String(err));
  process.exit(1);
}

console.log("\n" + C.bold("=== Living Meters harness ==="));
console.log(C.dim(`configured: ${result.meters.length} meters: ${result.meters.join(", ")}`));

for (const sec of result.sections) {
  console.log("\n" + sec.name);
  for (const c of sec.checks) {
    console.log(c.ok
      ? "  " + C.ok("ok  ") + " " + c.name
      : "  " + C.bad("FAIL") + " " + c.name + (c.detail ? C.dim("  -> " + c.detail) : ""));
  }
}

const line = `=== ${result.pass} passed, ${result.fail} failed ===`;
console.log("\n" + (result.fail ? C.bad(line) : C.ok(line)) +
  C.dim(`   ${result.steps} sandbox runs, worst hook ${result.worstMs}ms\n`));
process.exit(result.fail ? 1 : 0);
