// SPDX-License-Identifier: MIT
/* ============================================================================
 * Living Meters: shared run engine
 *
 * Pure logic, no DOM and no Node APIs. Given a set of meter definitions and a
 * `runHook` adapter, it schedules a run, drives it, and analyses the result.
 *
 * Two front ends use it:
 *   docs/index.html   runs each hook in a throwaway <iframe>
 *   playthrough.js    runs each hook in a fresh vm context (Node)
 *
 * Keeping the scheduling and analysis here means the browser page and the CLI
 * cannot silently disagree about what a run means.
 * ==========================================================================*/

(function (root) {
  "use strict";

  // Seeded LCG. Deterministic, so the same seed always gives the same run.
  function makeRnd(seed) {
    let s = (seed * 2654435761) % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 48271) % 2147483647;
      return s / 2147483647;
    };
  }

  // Carrier sentences. Deliberately bland: their only job is to place a
  // trigger word into text the framework will scan.
  const OUT_FORMS = [
    (w) => `And then: ${w}.`,
    (w) => `It happens quickly, ${w}, and the moment passes.`,
    (w) => `What follows is ${w}, and little else.`,
    (w) => `There is ${w} to deal with now.`,
    (w) => `The next stretch of time is all ${w}.`,
  ];
  const IN_FORMS = [
    (w) => `\n> You deal with the ${w}.`,
    (w) => `\n> You turn your attention to ${w}.`,
    (w) => `\n> You do what you can about ${w}.`,
  ];
  const NEUTRAL_IN = [
    "\n> You wait.",
    "\n> You keep going.",
    "\n> You take stock.",
    "\n> You press on.",
    "\n> You rest a moment.",
  ];
  const NEUTRAL_OUT = [
    "Time passes without incident.",
    "Nothing of consequence occurs.",
    "The moment stretches out and then lets go.",
    "Quiet. For now.",
  ];

  // Every trigger becomes one schedulable event. Losses are scheduled before
  // gains on the same meter, so a gain is not clamped away at the ceiling.
  function buildEvents(defs) {
    const perMeter = defs.map(function (d) {
      const usable = d.triggers.filter((t) => t.words[0] !== "(custom pattern)");
      const drains = usable.filter((t) => t.delta < 0);
      const gains = usable.filter((t) => t.delta > 0);
      const seq = [];
      for (let i = 0; i < Math.max(drains.length, gains.length); i++) {
        if (drains[i]) seq.push({ d: d, t: drains[i] });
        if (gains[i]) seq.push({ d: d, t: gains[i] });
      }
      return seq;
    });
    // Round-robin, so no single meter is hammered while the others idle.
    const flat = [];
    for (let i = 0; ; i++) {
      let any = false;
      for (const seq of perMeter) if (seq[i]) { flat.push(seq[i]); any = true; }
      if (!any) break;
    }
    return flat;
  }

  function buildSchedule(events, turns, rnd, shuffle) {
    const plan = new Array(turns).fill(null);
    // Turn 1, the last turn and every sixth turn are quiet, so per-turn drift
    // is observable on its own.
    for (let i = 0; i < turns; i++) {
      if (i === 0 || i === turns - 1 || (i + 1) % 6 === 0) plan[i] = [];
    }
    if (!events.length) return plan.map((p) => p || []);

    const order = events.slice();
    if (shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
    }

    let e = 0;
    for (let i = 0; i < turns; i++) {
      if (plan[i] !== null) continue;
      const batch = [order[e % order.length]];
      e++;
      // Every third busy turn pairs two events on DIFFERENT meters, which is
      // how interlocking configs show themselves.
      if (order.length > 1 && i % 3 === 0) {
        const cand = order[e % order.length];
        if (cand.d.id !== batch[0].d.id) { batch.push(cand); e++; }
      }
      plan[i] = batch;
    }
    return plan;
  }

  function renderTurn(batch, n, rnd) {
    if (!batch.length) {
      return [NEUTRAL_IN[n % NEUTRAL_IN.length], NEUTRAL_OUT[n % NEUTRAL_OUT.length]];
    }
    const inWords = [], outWords = [];
    batch.forEach(function (ev) {
      const w = ev.t.words[Math.floor(rnd() * ev.t.words.length)].replace(/\*$/, "");
      // "input" must appear in the action; everything else goes in the
      // narration, where an on:"both" trigger still fires exactly once.
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

  // Turn a completed run into projections and warnings.
  function analyse(defs, trace, seenBands, moved, turns) {
    const rows = [], warnings = [], unvisited = [];

    for (const d of defs) {
      const series = trace.map((t) => t[d.id]);
      const atMin = series.filter((v) => v <= d.min + 0.001).length;
      const atMax = series.filter((v) => v >= d.max - 0.001).length;

      let projection;
      if (d.perTurn < 0) {
        const n = Math.ceil((d.start - d.min) / Math.abs(d.perTurn));
        projection = n <= 0
          ? `${d.perTurn}/turn, starts on its floor`
          : `${d.perTurn}/turn, floor in ~${n} turns`;
      } else if (d.perTurn > 0) {
        const n = Math.ceil((d.max - d.start) / d.perTurn);
        projection = n <= 0
          ? `+${d.perTurn}/turn, starts at its ceiling`
          : `+${d.perTurn}/turn, ceiling in ~${n} turns`;
      } else {
        projection = "no drift, triggers only";
      }

      const visited = seenBands[d.id].size;
      const total = new Set(d.bands.map((b) => b.name)).size || 1;
      rows.push({ def: d, projection: projection, visited: visited, total: total });

      if (atMin / turns >= 0.3)
        warnings.push(`${d.label} spent ${Math.round(atMin / turns * 100)}% of the run on its ` +
          `floor (${d.min}). Fine if it is meant to spike and decay back to a baseline; ` +
          `otherwise raise start, soften perTurn, or add a stronger recovery trigger.`);
      if (atMax / turns >= 0.5 && d.perTurn <= 0 && d.triggers.some((t) => t.delta < 0))
        warnings.push(`${d.label} spent ${Math.round(atMax / turns * 100)}% of the run at its ` +
          `ceiling (${d.max}). It is under no real pressure, and gains are being clamped away.`);
      if (!moved[d.id] && d.triggers.length)
        warnings.push(`${d.label} has ${d.triggers.length} trigger(s) but none of them changed ` +
          `it during this run. Check the words, or it may be clamped at a limit.`);
      if (!d.triggers.length && !d.perTurn)
        warnings.push(`${d.label} has no triggers and no drift, so nothing can ever change it.`);
      const maxBand = d.bands.length ? Math.max.apply(null, d.bands.map((b) => b.upTo || 0)) : 0;
      if (d.bands.length && maxBand < d.max)
        warnings.push(`${d.label} bands stop at ${maxBand} but max is ${d.max}, so values above ` +
          `${maxBand} fall back to the last band.`);

      if (visited < total && total > 1) unvisited.push(`${d.label} ${visited}/${total}`);
    }
    return { rows: rows, warnings: warnings, unvisited: unvisited };
  }

  root.LM_ENGINE = {
    makeRnd: makeRnd,
    buildEvents: buildEvents,
    buildSchedule: buildSchedule,
    renderTurn: renderTurn,
    analyse: analyse,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
