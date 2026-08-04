/// <reference no-default-lib="true"/>
/// <reference lib="es2022"/>
// SPDX-License-Identifier: MIT

// ==== Living Meters: OUTPUT tab =============================================
// Paste this into the "Output" script.

const modifier = (text) => {
  // Your other output modifier scripts go here (preferred)

  text = RM.output(text);

  // Your other output modifier scripts go here (alternative)

  return { text };
};

// Don't modify this part
modifier(text);
