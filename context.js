/// <reference no-default-lib="true"/>
/// <reference lib="es2022"/>
// SPDX-License-Identifier: MIT

// ==== Living Meters: CONTEXT tab ============================================
// Paste this into the "Context" script.
//
// This tab is where the per-turn tick happens and where a `/command` halt is
// executed, so it must be installed even if you set inject: "frontMemory".

const modifier = (text) => {
  // Your other context modifier scripts go here (preferred)

  [text, stop] = RM.context(text, stop);

  // Your other context modifier scripts go here (alternative)

  return { text, stop };
};

// Don't modify this part
modifier(text);
