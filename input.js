/// <reference no-default-lib="true"/>
/// <reference lib="es2022"/>
// SPDX-License-Identifier: MIT

// ==== Living Meters: INPUT tab ==============================================
// Paste this into the "Input" script. If you already run other scripts, keep
// ONE `const modifier` per tab and add their calls beside the RM line.

const modifier = (text) => {
  // Your other input modifier scripts go here (preferred)

  text = RM.input(text);

  // Your other input modifier scripts go here (alternative)

  return { text };
};

// Don't modify this part
modifier(text);
