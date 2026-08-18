// SPDX-License-Identifier: MIT
/* ============================================================================
 * Living Meters: shared correctness suite
 *
 * Every assertion lives here. Both front ends supply nothing but a way to run
 * one hook in a fresh sandbox:
 *
 *   test-harness.js   a fresh Node vm context per hook
 *   docs/index.html   a throwaway <iframe> per hook
 *
 * The tests are CONFIG-DRIVEN. They read RM.defs() and exercise whatever
 * meters and triggers are actually configured, so this file keeps working when
 * you rewrite RM_CONFIG for your own scenario.
 *
 * The adapter contract is a single function:
 *   api.run(libSrc, tailSrc, payload) -> { ret, state, storyCards, message }
 * plus api.hooks (the three hook tab sources), and optionally api.perfBudget
 * and api.onProgress(done, total, label).
 * ==========================================================================*/

(function (root) {
  "use strict";

  function runTests(api) {
    const HOOKS = api.hooks;
    const PERF_BUDGET = api.perfBudget || 500;
    const progress = api.onProgress || function () {};
    const LIB = api.lib;

    const sections = [];
    let cur = null, pass = 0, fail = 0, stepCount = 0;

    function section(name) { cur = { name: name, checks: [] }; sections.push(cur); }
    function check(name, cond, detail) {
      if (cond) pass++; else fail++;
      cur.checks.push({ name: name, ok: !!cond, detail: cond ? "" : (detail || "") });
    }

    // ---- world and helpers, built on the adapter ---------------------------

    const world = { state: {}, storyCards: [], history: [], actionCount: 0 };
    let worstMs = 0;

    function runHook(hook, text, info, lib) {
      const t0 = Date.now();
      let r;
      try {
        r = api.run(lib || LIB, HOOKS[hook], {
          text: text, state: world.state, storyCards: world.storyCards,
          history: world.history, info: info,
        });
      } catch (e) {
        return { error: e };
      }
      worstMs = Math.max(worstMs, Date.now() - t0);
      world.state = r.state;
      world.storyCards = r.storyCards;
      stepCount++;
      if (stepCount % 25 === 0) progress(stepCount, 0, "running");
      return r;
    }

    function turn(playerText, aiText, type) {
      const out = {};
      if (playerText !== null) {
        world.actionCount += 1;
        const r = runHook("input", playerText, { actionCount: world.actionCount, characterNames: [] });
        if (r.error) throw r.error;
        out.input = r;
        world.history.push({ text: playerText, rawText: playerText, type: type || "do" });
      }
      world.actionCount += 1;
      const ctxText = "Plot Essentials\nWorld Lore:\n\nRecent Story:\n" +
        world.history.map((h) => h.text).join("\n");
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

    const EMPTY_INFO = { actionCount: 1, characterNames: [], maxChars: 8000 };

    function inspect(expr, lib) {
      const r = api.run(lib || LIB, ";JSON.stringify(" + expr + ")", {
        text: " ", state: {}, storyCards: [], history: [], info: EMPTY_INFO,
      });
      return JSON.parse(r.ret);
    }

    // One isolated turn from a clean slate. `seed` optionally sets a meter to a
    // value first, so a positive trigger on a meter at its maximum is still
    // measurable.
    function simulate(inputText, outputText, lib, seed) {
      const carry = { state: {}, storyCards: [], history: [] };
      let ac = 0;
      function step(hook, text) {
        ac += 1;
        const r = api.run(lib || LIB, HOOKS[hook], {
          text: text, state: carry.state, storyCards: carry.storyCards,
          history: carry.history, info: { actionCount: ac, characterNames: [], maxChars: 8000 },
        });
        carry.state = r.state;
        carry.storyCards = r.storyCards;
        stepCount++;
      }
      if (seed) {
        step("input", '\n> You say "/' + seed.id + " =" + seed.value + '"');
        step("context", "ctx");   // consumes the halt the command queued
      }
      step("input", inputText);
      carry.history.push({ text: inputText, type: "do" });
      step("context", "ctx");
      step("output", outputText);
      return carry.state.RM ? carry.state.RM.res : {};
    }

    function res(id) {
      return world.state.RM && world.state.RM.res ? world.state.RM.res[id] : undefined;
    }

    // Run three hooks against a variant library built from a resources literal.
    function withConfig(resourcesSrc, playerText, aiText) {
      const src = LIB.replace(/\n  resources: \[[\s\S]*?\n  \],/, "\n  resources: " + resourcesSrc + ",");
      const carry = { state: {}, storyCards: [] };
      let toast = "", threw = null;
      try {
        const seq = [["input", playerText], ["context", "ctx"], ["output", aiText]];
        for (const pair of seq) {
          const r = api.run(src, HOOKS[pair[0]], {
            text: pair[1], state: carry.state, storyCards: carry.storyCards, history: [],
            info: { actionCount: 3, characterNames: [], maxChars: 8000 },
          });
          if (r.state && typeof r.state.message === "string" && r.state.message) toast = r.state.message;
          carry.state = r.state;
          carry.storyCards = r.storyCards;
          stepCount++;
        }
      } catch (e) { threw = e; }
      return { toast: toast, threw: threw, res: carry.state.RM ? carry.state.RM.res : {} };
    }

    // ---- introspect the configured scenario --------------------------------

    const CFG = inspect("RM.defs()").filter((d) => d.enabled);
    const PROBLEMS = inspect("RM.problems()");
    const CARD_TITLE = inspect("RM_CONFIG.playerCardTitle");
    const INJECT_LABEL = inspect("RM_CONFIG.injectLabel");

    const FIRST = CFG[0];
    const DRIFT_DOWN = CFG.filter((d) => d.perTurn < 0)[0];
    const DRIFT_UP = CFG.filter((d) => d.perTurn > 0)[0];
    const STATIC = CFG.filter((d) => d.perTurn === 0)[0];
    const LETHAL = CFG.filter((d) => d.bands.length &&
      d.bands.slice().sort((a, b) => a.upTo - b.upTo)[0].tell)[0];

    if (!CFG.length) {
      section("config");
      check("at least one meter is configured", false, "none found");
      return { sections: sections, pass: pass, fail: fail, meters: [], worstMs: 0 };
    }

    // ---- 0. config ---------------------------------------------------------
    section("0. config");
    check("config has no problems", PROBLEMS.length === 0, PROBLEMS.join(" | "));
    check("at least one meter", CFG.length > 0);
    check("every meter has a label", CFG.every((d) => d.label));
    check("every meter starts in range",
      CFG.every((d) => d.start >= d.min && d.start <= d.max),
      CFG.filter((d) => d.start < d.min || d.start > d.max).map((d) => d.id).join(","));
    check("every band set covers the max",
      CFG.every((d) => !d.bands.length || Math.max.apply(null, d.bands.map((b) => b.upTo)) >= d.max),
      CFG.filter((d) => d.bands.length && Math.max.apply(null, d.bands.map((b) => b.upTo)) < d.max)
        .map((d) => d.id).join(", "));

    // ---- 1. cold start -----------------------------------------------------
    section("1. cold start");
    const t1 = turn("\n> You check the readouts.", "The console glows in the dark.");
    check("state initialised", !!world.state.RM);
    check("all meters present", CFG.every((d) => typeof res(d.id) === "number"),
      CFG.filter((d) => typeof res(d.id) !== "number").map((d) => d.id).join(","));
    check("player card created", world.storyCards.some((c) => c.title === CARD_TITLE), CARD_TITLE);
    check("card key is a sentinel", world.storyCards.some((c) => c.keys === "%RM%"));
    check("status block injected", t1.context.ret.text.indexOf(INJECT_LABEL) !== -1, INJECT_LABEL);
    check("hook under 2s", worstMs < 2000, worstMs + "ms");

    // ---- 2. per-turn drift -------------------------------------------------
    section("2. per-turn drift");
    if (DRIFT_DOWN) {
      const before = res(DRIFT_DOWN.id);
      turn("\n> You wait.", "The room is quiet.");
      const delta = before - res(DRIFT_DOWN.id);
      check(DRIFT_DOWN.id + " drifts down", delta > 0, before + " to " + res(DRIFT_DOWN.id));
      check("ticked exactly once", Math.abs(delta - Math.abs(DRIFT_DOWN.perTurn)) < 0.01,
        "delta " + delta.toFixed(2) + ", expected " + Math.abs(DRIFT_DOWN.perTurn).toFixed(2));
    } else check("no downward-drifting meter configured (skipped)", true);

    if (DRIFT_UP) {
      const before = res(DRIFT_UP.id);
      turn("\n> You wait.", "The room is quiet.");
      check(DRIFT_UP.id + " accumulates", res(DRIFT_UP.id) > before, before + " to " + res(DRIFT_UP.id));
    } else check("no upward-drifting meter configured (skipped)", true);

    if (STATIC) {
      const before = res(STATIC.id);
      turn("\n> You wait.", "The room is quiet.");
      check(STATIC.id + " does not drift", res(STATIC.id) === before, before + " to " + res(STATIC.id));
    } else check("no static meter configured (skipped)", true);

    // ---- 3. trigger coverage ----------------------------------------------
    section("3. trigger coverage");
    let fired = 0;
    const missed = [];
    for (const d of CFG) {
      const seed = { id: d.id, value: Math.round((d.min + d.max) / 2) };
      const control = simulate("\n> You wait.", "Nothing happens here.", null, seed);
      for (const tr of d.triggers) {
        if (tr.words[0] === "(custom pattern)") continue;
        const word = tr.words[0].replace(/\*$/, "");
        const treated = tr.on === "input"
          ? simulate("\n> You " + word + " carefully.", "Nothing happens here.", null, seed)
          : simulate("\n> You wait.", "The crew " + word + " without incident.", null, seed);
        const moved = (treated[d.id] || 0) - (control[d.id] || 0);
        if (Math.sign(moved) === Math.sign(tr.delta) && moved !== 0) fired++;
        else missed.push(d.id + ':"' + tr.words[0] + '" expected ' +
          (tr.delta > 0 ? "+" : "") + tr.delta + ", got " + moved.toFixed(1));
      }
      progress(stepCount, 0, "triggers: " + d.id);
    }
    check("all " + (fired + missed.length) + " triggers fire in the right direction",
      missed.length === 0, missed.slice(0, 6).join(" | "));

    const bothPair = CFG.map((d) => ({
      d: d, tr: d.triggers.filter((x) => x.on === "both" && x.words[0] !== "(custom pattern)")[0],
    })).filter((x) => x.tr)[0];
    if (bothPair) {
      const word = bothPair.tr.words[0].replace(/\*$/, "");
      const seed = { id: bothPair.d.id, value: Math.round((bothPair.d.min + bothPair.d.max) / 2) };
      const base = simulate("\n> You wait.", "Nothing happens here.", null, seed);
      const once = simulate("\n> You wait.", "The crew " + word + " without incident.", null, seed);
      const twice = simulate("\n> You " + word + " carefully.",
        "The crew " + word + " without incident.", null, seed);
      const dOnce = (once[bothPair.d.id] || 0) - (base[bothPair.d.id] || 0);
      const dTwice = (twice[bothPair.d.id] || 0) - (base[bothPair.d.id] || 0);
      check('"' + word + '" in both input and output counts once',
        Math.abs(dOnce - dTwice) < 0.01,
        "output-only " + dOnce.toFixed(1) + ", both " + dTwice.toFixed(1));
    } else check("no on:both trigger configured (skipped)", true);

    // ---- 4. retry safety ---------------------------------------------------
    section("4. retry safety");
    const hazard = CFG.filter((d) => d.triggers.some((x) => x.on === "output" && x.delta < 0))[0];
    if (hazard) {
      const tr = hazard.triggers.filter((x) => x.on === "output" && x.delta < 0)[0];
      const word = tr.words[0].replace(/\*$/, "");
      const line = "Alarms blare as " + word + " tears through the compartment.";
      turn("\n> You brace.", line);
      const after = res(hazard.id);
      world.actionCount += 1;
      runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
      runHook("output", line, { actionCount: world.actionCount, characterNames: [] });
      // The context hook above advances the turn, so one drift tick is expected.
      // The point of the check is that the -delta trigger did NOT fire a second
      // time, which is a far larger move than perTurn. Comparing against zero
      // only ever passed because every shipped preset happened to put its
      // output hazard on a perTurn: 0 meter.
      const tick = Math.abs(hazard.perTurn || 0);
      check("identical output is not re-scanned",
        Math.abs(res(hazard.id) - after) <= tick + 0.001,
        after + " to " + res(hazard.id));
    } else check("no output hazard configured (skipped)", true);

    // ---- 5. commands -------------------------------------------------------
    section("5. commands");
    const before5 = res(FIRST.id);
    const c1 = runHook("input", '\n> You say "/' + FIRST.id + ' +5"',
      { actionCount: world.actionCount, characterNames: [] });
    check("command produced a toast",
      typeof c1.message === "string" && c1.message.length > 0, c1.message);
    check("command applied", res(FIRST.id) !== before5, before5 + " to " + res(FIRST.id));
    const c2 = runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
    check("halt executed in context", c2.ret.stop === true, String(c2.ret.stop));
    const c3 = runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
    check("halt is one-shot", c3.ret.stop === false, String(c3.ret.stop));
    const c4 = runHook("input", '\n> You say "/status"', { actionCount: world.actionCount, characterNames: [] });
    check("/status lists every meter",
      // The toast lays rows out with U+00A0 so a wrap cannot land inside one.
      // Normalise before matching: the label is a real string everywhere it is
      // an API (defs, directive, statusBlock), and a display artifact only here.
      CFG.filter((d) => d.visible).every((d) =>
        (c4.message || "").replace(/\u00a0/g, " ").indexOf(d.label) !== -1),
      (c4.message || "").split("\n")[0]);
    runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });

    // ---- 6. player overrides ----------------------------------------------
    section("6. player overrides");
    const card = world.storyCards.filter((c) => c.title === CARD_TITLE)[0];
    const target = DRIFT_DOWN || FIRST;
    const offTarget = CFG.filter((d) => d.id !== target.id && d.perTurn < 0)[0] || STATIC;
    card.description += "\ndifficulty = hard\n" + target.id + ".perTurn = -10\n" + offTarget.id + ".off\n";
    const offBefore = res(offTarget.id);
    const tgtBefore = res(target.id);
    turn("\n> You press on.", "The corridor stretches ahead.");
    check("override applied (drains faster)", (tgtBefore - res(target.id)) > 9,
      "delta " + (tgtBefore - res(target.id)).toFixed(2) + ", expected 17.50");
    check("disabled meter stops drifting", res(offTarget.id) === offBefore,
      offBefore + " to " + res(offTarget.id));
    const hidden = turn("\n> Onward.", "You walk.").context.ret.text;
    check("disabled meter hidden from the AI", hidden.indexOf(offTarget.label) === -1, offTarget.label);

    // ---- 7. clamping and bands --------------------------------------------
    section("7. clamping and bands");
    runHook("input", '\n> You say "/' + FIRST.id + " =" + FIRST.min + '"',
      { actionCount: world.actionCount, characterNames: [] });
    runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
    check(FIRST.id + " clamped at min", res(FIRST.id) === FIRST.min, String(res(FIRST.id)));
    runHook("input", '\n> You say "/' + FIRST.id + ' =999999"',
      { actionCount: world.actionCount, characterNames: [] });
    runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
    check(FIRST.id + " clamped at max", res(FIRST.id) === FIRST.max, String(res(FIRST.id)));

    if (LETHAL) {
      const worst = LETHAL.bands.slice().sort((a, b) => a.upTo - b.upTo)[0];
      runHook("input", '\n> You say "/' + LETHAL.id + " =" + worst.upTo + '"',
        { actionCount: world.actionCount, characterNames: [] });
      // The command queued a halt; that context returns early without injecting.
      runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
      world.actionCount += 1;
      const shown = runHook("context", "ctx", { actionCount: world.actionCount, maxChars: 8000, characterNames: [] });
      const snippet = worst.tell.split(/[.,]/)[0].slice(0, 30);
      check("worst-band instruction reaches the AI", shown.ret.text.indexOf(snippet) !== -1, snippet);
    } else check("no band instructions configured (skipped)", true);

    // ---- 8. state hygiene --------------------------------------------------
    section("8. state hygiene");
    const ser = JSON.stringify(world.state);
    check("state survives JSON round-trip", ser === JSON.stringify(JSON.parse(ser)));
    check("state stays small", ser.length < 6000, ser.length + " chars");
    check("no compiled patterns leaked into state", !/\(\?:\^\|/.test(ser));

    // ---- 9. degraded mode --------------------------------------------------
    section("9. story cards unavailable");
    const saved = JSON.parse(JSON.stringify(world.state));
    let broken;
    try {
      broken = api.run(LIB, HOOKS.input, {
        text: " ", state: saved, storyCards: [], history: [],
        info: { actionCount: 5, characterNames: [] },
      }, { breakCards: true });
      check("survives card failure", true);
      check("warns the player", /Memory Bank/.test((broken.state && broken.state.message) || ""),
        (broken.state && broken.state.message) || "(no toast)");
    } catch (e) {
      check("survives card failure", false, String(e));
      check("warns the player", false, "did not run");
    }

    // ---- 10. presets -------------------------------------------------------
    section("10. presets");
    const PRESETS = ["survival", "fantasy", "scifi", "noir", "mechanic", "none"];
    for (const name of PRESETS) {
      const src = LIB
        .replace(/preset:\s*"[a-z]+"/, 'preset: "' + name + '"')
        .replace(/\n  resources: \[[\s\S]*?\n  \],/, "\n  resources: [],");
      let ok = true, err = null, tracked = 0;
      const carry = { state: {}, storyCards: [] };
      try {
        for (const hook of ["input", "context", "output"]) {
          const r = api.run(src, HOOKS[hook], {
            text: "\n> You wait.", state: carry.state, storyCards: carry.storyCards,
            history: [], info: { actionCount: 1, characterNames: [], maxChars: 8000 },
          });
          carry.state = r.state;
          carry.storyCards = r.storyCards;
          stepCount++;
        }
        tracked = carry.state.RM ? Object.keys(carry.state.RM.res).length : 0;
      } catch (e) { ok = false; err = e; }
      check('preset "' + name + '" runs', ok, err && String(err));
      check('preset "' + name + '" tracks ' + (name === "none" ? "0" : ">0") + " meters",
        name === "none" ? tracked === 0 : tracked > 0, tracked + " meters");
    }

    // ---- 11. trigger word lists -------------------------------------------
    section("11. trigger word lists");
    function GOLD(words, delta) {
      return '[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50,\n' +
        '    perTurn: 0, bands: [{ upTo: 100, name: "ok", tell: "" }],\n' +
        '    triggers: [{ on: "output", words: ' + JSON.stringify(words) +
        ", delta: " + delta + " }] }]";
    }
    let r;
    r = withConfig(GOLD(["loot*"], 10), "\n> You search.", "You looted the chest.");
    check("word* matches suffixes", r.res.gold === 60, "gold " + r.res.gold);
    r = withConfig(GOLD(["rest"], 10), "\n> You search.", "You found a restaurant on the corner.");
    check("bare word does NOT match a longer word", r.res.gold === 50, "gold " + r.res.gold);
    r = withConfig(GOLD(["rest"], 10), "\n> You search.", "You rest by the fire.");
    check("bare word matches the whole word", r.res.gold === 60, "gold " + r.res.gold);
    r = withConfig(GOLD(["dead body"], 10), "\n> You look.", "There is a dead body in the alley.");
    check("phrases match", r.res.gold === 60, "gold " + r.res.gold);
    r = withConfig(GOLD(["c++", "a.b"], 10), "\n> You look.", "You see a C++ manual.");
    check("regex metacharacters are escaped", r.res.gold === 60, "gold " + r.res.gold);

    const asString = '[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,\n' +
      '    bands: [{ upTo: 100, name: "ok", tell: "" }],\n' +
      '    triggers: [{ on: "output", match: "loot", delta: 10 }] }]';
    r = withConfig(asString, "\n> You search.", "You looted the chest.");
    check("string-instead-of-regex is reported", /must be a regular expression/.test(r.toast),
      r.toast.split("\n")[1] || r.toast);
    check("...and does not crash", !r.threw, r.threw && String(r.threw));

    const noWords = '[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,\n' +
      '    bands: [{ upTo: 100, name: "ok", tell: "" }],\n' +
      '    triggers: [{ on: "output", delta: 10 }] }]';
    r = withConfig(noWords, "\n> You search.", "You looted the chest.");
    check("missing words is reported", /needs words/.test(r.toast), r.toast.split("\n")[1] || r.toast);

    const noDelta = '[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,\n' +
      '    bands: [{ upTo: 100, name: "ok", tell: "" }],\n' +
      '    triggers: [{ on: "output", words: ["loot*"] }] }]';
    r = withConfig(noDelta, "\n> You search.", "You looted the chest.");
    check("missing delta is reported", /non-zero numeric/.test(r.toast), r.toast.split("\n")[1] || r.toast);

    const badRange = '[{ id: "gold", label: "Gold", min: 100, max: 0, start: 50, perTurn: 0,\n' +
      "    bands: [], triggers: [] }]";
    r = withConfig(badRange, "\n> You search.", "Nothing.");
    check("inverted min/max is reported", /must be greater than/.test(r.toast),
      r.toast.split("\n")[1] || r.toast);

    const withRegex = '[{ id: "gold", label: "Gold", min: 0, max: 100, start: 50, perTurn: 0,\n' +
      '    bands: [{ upTo: 100, name: "ok", tell: "" }],\n' +
      "    triggers: [{ on: \"output\", match: /loot(ed)?/i, delta: 10 }] }]";
    r = withConfig(withRegex, "\n> You search.", "You looted the chest.");
    check("explicit regex escape hatch still works", r.res.gold === 60, "gold " + r.res.gold);

    // ---- 12. performance ---------------------------------------------------
    // ---- negation guard ----------------------------------------------
    // Without this a preset pays out for declining: "you do not eat" fed the
    // character. The guard is clause-bounded, so it must not reach past a
    // sentence break, and a later un-negated mention must still count.
    r = withConfig(GOLD(["loot*"], 10), "\n> You search.",
      "You do not loot the chest.");
    check("a negated word does not fire", r.res.gold === 50, "gold " + r.res.gold);

    r = withConfig(GOLD(["loot*"], 10), "\n> You search.",
      "You don't loot the chest.");
    check("a contraction negates too", r.res.gold === 50, "gold " + r.res.gold);

    r = withConfig(GOLD(["loot*"], 10), "\n> You search.",
      "You refuse to loot the chest.");
    check("refuse negates", r.res.gold === 50, "gold " + r.res.gold);

    r = withConfig(GOLD(["loot*"], 10), "\n> You search.",
      "It was not your day. You loot the chest.");
    check("a negator does not reach past a sentence break",
      r.res.gold === 60, "gold " + r.res.gold);

    r = withConfig(GOLD(["loot*"], 10), "\n> You search.",
      "You do not loot the crate, then you loot the chest.");
    check("a later un-negated match still fires", r.res.gold === 60, "gold " + r.res.gold);

    r = withConfig(GOLD(["loot*"], 10), "\n> You search.",
      "You loot the chest.");
    check("an ordinary sentence is unaffected", r.res.gold === 60, "gold " + r.res.gold);

    section("12. performance");
    worstMs = 0;
    for (let i = 0; i < 25; i++) {
      turn("\n> You continue the repairs.",
        "You weld the plate down, drink a water ration, and watch the reactor gauge climb.");
      if (i % 5 === 0) progress(stepCount, 0, "perf " + (i + 1) + "/25");
    }
    check("worst hook under the budget", worstMs < PERF_BUDGET,
      worstMs + "ms, budget " + PERF_BUDGET + "ms");
    check("state still small after 25 turns", JSON.stringify(world.state).length < 6000,
      JSON.stringify(world.state).length + " chars");

    return {
      sections: sections, pass: pass, fail: fail, worstMs: worstMs,
      meters: CFG.map((d) => d.id), steps: stepCount,
    };
  }

  root.LM_TESTS = { runTests: runTests };
})(typeof globalThis !== "undefined" ? globalThis : this);
