/// <reference no-default-lib="true"/>
/// <reference lib="es2022"/>

// SPDX-License-Identifier: MIT

/* ============================================================================
 * LIVING METERS v1: a resource framework for AI Dungeon
 *
 * Copyright (c) 2026 Oratorian. MIT licensed; see the LICENSE file.
 * You may bundle this into your own script. Keeping this notice is all that
 * is asked.
 * ----------------------------------------------------------------------------
 * Tracks any set of numeric resources (health, hunger, ammo, fuel, sanity,
 * gold, reputation...), drifts them each turn, reacts to what the story says,
 * and tells the AI how the character should feel and behave.
 *
 * The meters are "living" because they move on their own: each one drifts every
 * turn, reacts to what the story says, and is handed to the AI as behaviour to
 * play rather than a number to recite.
 *
 * THREE LAYERS OF CONFIGURATION
 *   1. RM_CONFIG below                 the scenario creator edits this.
 *   2. RM_PRESETS                      ready-made resource sets to start from.
 *   3. The "Living Meters" story card  the PLAYER edits this in-game; it
 *                                      overrides the creator's numbers.
 *
 * The RM_ prefix is the original working name and is kept deliberately: it is
 * short, it collides with nothing, and renaming it would break nobody's saves
 * for no gain.
 *
 * INSTALL: paste this whole file into the Library tab, then paste the three
 * companion files into Input / Context / Output. See README.md.
 * ==========================================================================*/

// Some globals are not defined in every hook. Establish them before use.
globalThis.stop ??= false;
globalThis.text ??= " ";
globalThis.state ??= {};
globalThis.history ??= [];
globalThis.storyCards ??= [];
globalThis.info ??= {};

/* ============================================================================
 * 1. CREATOR CONFIG — edit this block
 * ==========================================================================*/

const RM_CONFIG = {
  // Start from a preset, then add or override resources below.
  // "survival" | "fantasy" | "scifi" | "noir" | "mechanic" | "none" |

  // If preset is "none", no resources are added by default and the preset section is ignored.
  // You must then define all resources and triggers you want in the "resources" array below.
  // Starting from line 77 and ending on line 261
  preset: "none",

  // Resources defined here are MERGED over the preset, matched by `id`.
  // Give an id that isn't in the preset to add a brand-new resource.
  //
  // TRIGGERS take plain word lists — you never write a regular expression.
  //   "coin"    matches the whole word "coin" only
  //   "loot*"   matches "loot", "looted", "looting", "looter"
  //   "dead body"  phrases are fine
  // Matching is always case-insensitive and always respects word boundaries,
  // so "rest" will not fire on "restaurant". Add the * yourself when you want
  // word endings to count.
  //
  // ==========================================================================
  // DEEP SPACE — a long-haul salvage run gone wrong.
  //
  // Twelve interlocking systems. The design intent is that no single resource
  // kills you; the ship does, because fixing one thing costs another. A burn
  // spends fuel AND adds heat. Running the reactor restores power but bakes
  // the ship and doses the crew. Repairs eat spare parts you cannot replace
  // out here. Note how several triggers share the same words across different
  // resources — that is how one narrative event moves three numbers at once.
  // ==========================================================================
  resources: [

    // ---- Ship -------------------------------------------------------------
    {
      id: "hull", label: "Hull", icon: "🛡️",
      min: 0, max: 100, start: 100, perTurn: 0,
      bands: [
        { upTo: 0, name: "breached", tell: "The hull has failed. The ship is venting to vacuum and is no longer survivable; narrate the decompression and its consequences." },
        { upTo: 25, name: "critical", tell: "The hull is holed in several places. Bulkheads groan, atmosphere hisses out through patches, and any hard manoeuvre risks tearing it wide open." },
        { upTo: 60, name: "damaged", tell: "The hull is buckled and patched. Stress fractures creak whenever the ship accelerates." },
        { upTo: 100, name: "sound", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["hull breach", "micrometeor*", "collision", "ruptur*", "direct hit", "shrapnel", "debris field"], delta: -18 },
        { on: "both", words: ["weld*", "patch the hull", "hull patch", "seal the breach", "repair the hull"], delta: 20 },
      ],
    },
    {
      id: "power", label: "Power", icon: "🔋",
      min: 0, max: 100, start: 88, perTurn: -0.7,
      bands: [
        { upTo: 0, name: "dark", tell: "The ship is dead. No lights, no heat, no life support, no doors. Only emergency chemical lamps and whatever is in the character's hands." },
        { upTo: 18, name: "brownout", tell: "Power is nearly gone. Lights flicker, non-essential systems are offline, and consoles reboot mid-sentence." },
        { upTo: 50, name: "rationed", tell: "Power is being rationed. Whole decks are dark and the character has to choose which systems to bring up." },
        { upTo: 100, name: "nominal", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["reactor", "spin up the core", "power cell", "solar array", "recharg*"], delta: 34 },
        { on: "both", words: ["reroute power", "divert power", "overclock*", "full burn"], delta: -14 },
        { on: "output", words: ["short circuit", "power surge", "grid failure", "blown coupling"], delta: -20 },
      ],
    },
    {
      id: "fuel", label: "Fuel", icon: "⛽",
      min: 0, max: 100, start: 62, perTurn: 0,
      bands: [
        { upTo: 0, name: "dry", tell: "The tanks are dry. The ship cannot manoeuvre and is on a ballistic course it cannot change." },
        { upTo: 15, name: "reserve", tell: "Fuel is down to the reserve. There is enough for one burn, maybe, and nothing after it." },
        { upTo: 100, name: "ok", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["burn", "burns", "burned", "thrust*", "manoeuvr*", "maneuver*", "course correction"], delta: -13 },
        { on: "both", words: ["refuel*", "fuel line", "siphon*", "tanker", "hydrogen scoop"], delta: 30 },
      ],
    },
    {
      id: "heat", label: "Thermal", icon: "🌡️",
      // Inverted: HIGH is bad. Radiators bleed it off slowly on their own.
      // min is 15, not 0 — a crewed ship has an ambient floor it cannot go
      // below, and `min` does not have to be zero.
      min: 15, max: 100, start: 28, perTurn: -0.8,
      bands: [
        { upTo: 35, name: "cool", tell: "" },
        { upTo: 70, name: "warm", tell: "The ship is running hot. Deck plating is uncomfortable to touch and the air tastes of scorched dust." },
        { upTo: 100, name: "overheating", tell: "The ship is overheating badly. Coolant alarms are constant, sweat runs freely, and electronics are failing from thermal stress." },
      ],
      triggers: [
        { on: "both", words: ["reactor", "overclock*", "full burn", "weapons fire"], delta: 13 },
        { on: "both", words: ["radiator*", "vent heat", "coolant", "shut down the core", "power down"], delta: -22 },
        { on: "output", words: ["stellar flare", "close approach", "sunward"], delta: 16 },
      ],
    },

    // ---- Life support -----------------------------------------------------
    {
      id: "o2", label: "Oxygen", icon: "🫁",
      min: 0, max: 100, start: 100, perTurn: -1.3,
      bands: [
        { upTo: 0, name: "anoxic", tell: "There is no breathable air left. The character is suffocating: vision tunnelling, lungs burning, seconds of consciousness remaining." },
        { upTo: 20, name: "critical", tell: "Oxygen is critically low. Every breath is shallow and insufficient; the character is light-headed and their judgement is visibly slipping." },
        { upTo: 45, name: "thin", tell: "The air is thin and stale. The character tires quickly and has a persistent headache." },
        { upTo: 100, name: "breathable", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["scrubber*", "oxygen candle", "o2 tank", "air supply", "recharge the tanks", "algae tank"], delta: 40 },
        { on: "both", words: ["eva", "spacewalk*", "airlock cycle", "suit up"], delta: -12 },
        // Not bare "vent*" or "leak*": those fire on "ventilation hums" and on
        // a coolant leak, neither of which costs anyone their air.
        { on: "output", words: ["hull breach", "ruptur*", "decompress*", "atmosphere leak", "air leak", "blown seal"], delta: -22 },
      ],
    },
    {
      id: "food", label: "Rations", icon: "🍱",
      min: 0, max: 100, start: 74, perTurn: -0.9,
      bands: [
        { upTo: 0, name: "starving", tell: "The rations are gone. The character is starving: cramping, weak, slow to think, and increasingly willing to consider things they would not have considered." },
        { upTo: 22, name: "rationing", tell: "Food is nearly out. The character is on quarter-rations and thinks about it constantly." },
        { upTo: 100, name: "fed", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["ration pack", "eat", "ate", "eating", "meal", "meals", "protein paste", "galley"], delta: 26 },
        { on: "both", words: ["hydroponic*", "food crate", "resupply", "supply cache"], delta: 34 },
      ],
    },
    {
      id: "water", label: "Water", icon: "💧",
      min: 0, max: 100, start: 80, perTurn: -1.1,
      bands: [
        { upTo: 0, name: "dehydrated", tell: "The water is gone. The character is dangerously dehydrated: cracked lips, dark urine, dizziness, failing concentration." },
        { upTo: 25, name: "short", tell: "Water is short. The character's mouth is permanently dry and they are rationing every sip." },
        { upTo: 100, name: "ok", tell: "" },
      ],
      triggers: [
        // "recycler" is deliberately NOT here: it would also match inside
        // "recycler failure" below and cancel the loss out.
        { on: "both", words: ["drink", "drank", "drinking", "water ration", "condensate", "ice haul", "purifier"], delta: 32 },
        { on: "output", words: ["recycler failure", "water loss", "coolant leak"], delta: -18 },
      ],
    },

    // ---- Crew -------------------------------------------------------------
    {
      id: "hp", label: "Condition", icon: "❤️",
      min: 0, max: 100, start: 100, perTurn: 0,
      bands: [
        { upTo: 0, name: "dead", tell: "The character has died. Narrate the death and its consequences; do not let them act again." },
        { upTo: 22, name: "critical", tell: "The character is critically injured — bleeding, shocky, barely able to stand. Without treatment they will not last long." },
        { upTo: 58, name: "injured", tell: "The character is injured and impaired. Movement is slow and painful, and fine work is difficult." },
        { upTo: 100, name: "well", tell: "" },
      ],
      triggers: [
        // "burn*" is deliberately NOT here: an engine burn is a manoeuvre, and
        // it would injure the crew every time they changed course.
        { on: "output", words: ["scald*", "struck", "crush*", "shrapnel", "fracture*", "bleeding", "electrocut*", "frostbite", "concussion"], delta: -17 },
        { on: "both", words: ["medbay", "medkit", "med kit", "stim", "stims", "sutur*", "treat the wound", "autodoc"], delta: 24 },
      ],
    },
    {
      id: "rads", label: "Radiation", icon: "☢️",
      // Inverted and CUMULATIVE: it only ever goes up unless treated.
      min: 0, max: 100, start: 4, perTurn: 0.2,
      bands: [
        { upTo: 20, name: "background", tell: "" },
        { upTo: 45, name: "exposed", tell: "The character has taken a real dose. Nausea comes in waves and their gums bleed when they clench their jaw." },
        { upTo: 75, name: "sick", tell: "Radiation sickness has set in: vomiting, hair loss, bruising under the skin, exhaustion that sleep does not touch." },
        { upTo: 100, name: "lethal", tell: "The character has absorbed a lethal dose. They are visibly dying — describe the failure of their body honestly and without hope of recovery." },
      ],
      triggers: [
        { on: "output", words: ["reactor breach", "radiation", "irradiat*", "hot zone", "solar storm", "unshielded"], delta: 14 },
        { on: "both", words: ["reactor", "core chamber", "eva", "spacewalk*"], delta: 5 },
        { on: "both", words: ["anti-rad", "antirad", "chelation", "iodine", "decontaminat*"], delta: -22 },
      ],
    },
    {
      id: "morale", label: "Morale", icon: "🧠",
      min: 0, max: 100, start: 72, perTurn: -0.45,
      bands: [
        { upTo: 0, name: "broken", tell: "The character has broken. Describe dissociation, fixed stares, and decisions that make no sense to anyone but them." },
        { upTo: 25, name: "fraying", tell: "The character is coming apart. They hear things in the hull noise, talk to people who are not there, and startle badly." },
        { upTo: 55, name: "strained", tell: "The character is worn thin by isolation. They are irritable, superstitious about the ship's sounds, and sleeping badly." },
        { upTo: 100, name: "steady", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["music", "message from home", "recorded message", "sleep", "slept", "shore leave", "hot meal", "coffee"], delta: 16 },
        { on: "output", words: ["alone", "silence", "no response", "corpse", "body bag", "distress call", "nothing on the scope"], delta: -9 },
      ],
    },

    // ---- Cargo and economy -------------------------------------------------
    {
      id: "parts", label: "Spare Parts", icon: "🔩",
      min: 0, max: 60, start: 22, perTurn: 0,
      bands: [
        { upTo: 0, name: "none", tell: "There are no spare parts left. Nothing further can be repaired; anything that breaks from here stays broken." },
        { upTo: 6, name: "scarce", tell: "Spare parts are almost gone. The character is cannibalising non-essential systems to keep essential ones alive." },
        { upTo: 60, name: "stocked", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["weld*", "patch the hull", "seal the breach", "repair the hull", "jury-rig*", "jury rig*", "cannibalis*", "cannibaliz*"], delta: -6 },
        { on: "both", words: ["salvag*", "strip the wreck", "scav*", "parts cache", "component crate"], delta: 14 },
      ],
    },
    {
      id: "credits", label: "Credits", icon: "🪙",
      min: 0, max: 99999, start: 340, perTurn: 0,
      bands: [
        { upTo: 0, name: "broke", tell: "The character has no credits. No station will sell them fuel, air, or docking time." },
        { upTo: 99999, name: "solvent", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["paid", "bought", "purchase*", "docking fee", "bribe*", "toll"], delta: -60 },
        { on: "output", words: ["sold", "salvage claim", "bounty", "contract payment", "reward*"], delta: 120 },
      ],
    },
  ],

  // How the AI is told about the resources.
  //   "context"     — appended to the model context. Accurate and current.
  //                   SILENTLY DOES NOTHING on models with Optimized Context.
  //   "frontMemory" — written to state.memory.frontMemory. Survives Optimized
  //                   Context, but lags one turn behind.
  //   "none"        — track only, never tell the AI.
  inject: "context",

  // Prefix for the injected block. Keep it bracketed and in complete sentences:
  // an unterminated fragment invites the AI to finish it.
  injectLabel: "Ship and crew status",

  // Show a toast to the player when a resource crosses into a new band.
  announceBandChanges: true,

  // Show the full status toast every N turns. 0 disables.
  statusEvery: 0,

  // Maintain a "Living Meters" story card the player can read and edit.
  playerCard: true,
  playerCardTitle: "⚙️ Living Meters",

  // Command prefix. Players type "/status", "/hp +10", etc.
  commandPrefix: "/",

  // Commands need the turn to stop before the AI runs. AI Dungeon has no clean
  // way to do that: halting shows a "the AI is stumped" banner. Set false to
  // let commands fall through to the AI instead (no banner, costs a
  // generation). See README "Why does a command show an error banner?".
  haltOnCommand: true,

  // Scan player input as well as AI output for trigger matches.
  scanInput: true,
  scanOutput: true,

  // Multiplies every negative drift. The player can override this in the card.
  // easy 0.5 | normal 1 | hard 1.75
  difficulty: "normal",

  // Print diagnostics to the Console Log panel.
  debug: false,
};

/* ============================================================================
 * 2. PRESETS
 * ==========================================================================*/

const RM_PRESETS = {
  none: [],

  survival: [
    {
      id: "hp", label: "Health", icon: "❤️",
      min: 0, max: 100, start: 100, perTurn: 0,
      bands: [
        { upTo: 0, name: "dead", tell: "The character has died. Narrate the death and its consequences; do not let them act." },
        { upTo: 20, name: "critical", tell: "The character is gravely wounded, bleeding and barely conscious. Every action is a struggle." },
        { upTo: 55, name: "hurt", tell: "The character is injured and moves carefully, favouring the wound." },
        { upTo: 100, name: "well", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["stab*", "slash*", "shot", "bitten", "maul*", "struck", "wound*", "burn*"], delta: -14 },
        { on: "both", words: ["bandage*", "tourniquet", "first aid", "stitch*", "treat the wound"], delta: 18 },
        { on: "both", words: ["sleep", "slept", "sleeping", "rest", "rested", "resting", "make camp", "made camp"], delta: 10 },
      ],
    },
    {
      id: "hunger", label: "Food", icon: "🍖",
      min: 0, max: 100, start: 80, perTurn: -1.5,
      bands: [
        { upTo: 0, name: "starving", tell: "The character is starving. Describe cramping hunger, weakness and poor judgement." },
        { upTo: 25, name: "hungry", tell: "The character is very hungry and distracted by it." },
        { upTo: 100, name: "fed", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["eat", "ate", "eating", "meal", "meals", "devour*", "feast*"], delta: 30 },
        { on: "both", words: ["forage*", "hunt", "hunted", "hunting", "butcher*"], delta: 12 },
      ],
    },
    {
      id: "thirst", label: "Water", icon: "💧",
      min: 0, max: 100, start: 85, perTurn: -2.2,
      bands: [
        { upTo: 0, name: "parched", tell: "The character is dangerously dehydrated: cracked lips, dizziness, tunnel vision." },
        { upTo: 30, name: "thirsty", tell: "The character is thirsty and thinking about water." },
        { upTo: 100, name: "watered", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["drink", "drank", "drinking", "water", "canteen", "waterskin", "spring"], delta: 35 },
      ],
    },
    {
      id: "warmth", label: "Warmth", icon: "🔥",
      min: 0, max: 100, start: 70, perTurn: -1,
      bands: [
        { upTo: 0, name: "freezing", tell: "The character is hypothermic: numb hands, slurred speech, dangerous drowsiness." },
        { upTo: 30, name: "cold", tell: "The character is shivering and stiff with cold." },
        { upTo: 100, name: "warm", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["fire", "campfire", "blanket*", "shelter", "coat", "furs"], delta: 25 },
        { on: "output", words: ["snow", "snowing", "blizzard", "freezing rain", "soaked", "drenched"], delta: -12 },
      ],
    },
  ],

  fantasy: [
    {
      id: "hp", label: "Health", icon: "❤️",
      min: 0, max: 100, start: 100, perTurn: 0,
      bands: [
        { upTo: 0, name: "dead", tell: "The character has fallen. Narrate the death and its consequences." },
        { upTo: 25, name: "critical", tell: "The character is gravely wounded and near collapse." },
        { upTo: 60, name: "hurt", tell: "The character is bloodied and slower than usual." },
        { upTo: 100, name: "well", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["stab*", "slash*", "struck", "claw*", "bitten", "blast*"], delta: -15 },
        { on: "both", words: ["heal*", "potion", "cure", "cured", "mend*", "bandage*"], delta: 25 },
      ],
    },
    {
      id: "mana", label: "Mana", icon: "✨",
      min: 0, max: 50, start: 50, perTurn: 1.5,
      bands: [
        { upTo: 0, name: "empty", tell: "The character is magically spent. Spells fail, fizzle or backfire." },
        { upTo: 12, name: "low", tell: "The character's magic is nearly exhausted; casting is an effort." },
        { upTo: 50, name: "ready", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["cast", "casts", "casting", "spell", "spells", "incant*", "conjure*", "hex", "enchant*"], delta: -10 },
        { on: "both", words: ["meditate*", "rest", "rested", "resting", "attune*", "mana potion"], delta: 20 },
      ],
    },
    {
      id: "coin", label: "Coin", icon: "🪙",
      min: 0, max: 99999, start: 30, perTurn: 0,
      bands: [
        { upTo: 0, name: "broke", tell: "The character has no money at all; merchants and innkeepers turn them away." },
        { upTo: 99999, name: "ok", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["buy", "buys", "bought", "paid", "bribe*", "purchase*"], delta: -8 },
        { on: "output", words: ["loot*", "reward*", "treasure", "sold", "found coins"], delta: 15 },
      ],
    },
  ],

  scifi: [
    {
      id: "hp", label: "Integrity", icon: "❤️",
      min: 0, max: 100, start: 100, perTurn: 0,
      bands: [
        { upTo: 0, name: "dead", tell: "The character has died. Narrate the consequences." },
        { upTo: 25, name: "critical", tell: "The character is critically injured; medical attention is urgent." },
        { upTo: 60, name: "hurt", tell: "The character is injured and impaired." },
        { upTo: 100, name: "well", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["shot", "blast*", "burn*", "decompress*", "struck"], delta: -16 },
        { on: "both", words: ["medkit", "medbay", "stim", "stims", "nanite*", "treated"], delta: 22 },
      ],
    },
    {
      id: "o2", label: "Oxygen", icon: "🫁",
      min: 0, max: 100, start: 100, perTurn: -2,
      bands: [
        { upTo: 0, name: "suffocating", tell: "The character is suffocating: vision tunnelling, lungs burning. They have moments left." },
        { upTo: 25, name: "low", tell: "Oxygen is running out. The character is light-headed and breathing hard." },
        { upTo: 100, name: "ok", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["recharge*", "refill*", "airlock", "oxygen", "o2 tank", "air supply"], delta: 45 },
        { on: "output", words: ["breach*", "leak*", "vacuum", "puncture*", "hull rupture"], delta: -20 },
      ],
    },
    {
      id: "power", label: "Power", icon: "🔋",
      min: 0, max: 100, start: 90, perTurn: -1.2,
      bands: [
        { upTo: 0, name: "dead", tell: "All powered equipment is dead. No lights, no tools, no weapons." },
        { upTo: 20, name: "low", tell: "Power is critically low; equipment is flickering and unreliable." },
        { upTo: 100, name: "ok", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["recharge*", "power cell", "battery", "batteries", "solar", "reactor"], delta: 35 },
      ],
    },
  ],

  noir: [
    {
      id: "hp", label: "Condition", icon: "❤️",
      min: 0, max: 100, start: 100, perTurn: 0,
      bands: [
        { upTo: 0, name: "dead", tell: "The character is dead. Narrate the end." },
        { upTo: 30, name: "bad", tell: "The character is badly hurt and running on adrenaline alone." },
        { upTo: 70, name: "banged up", tell: "The character is bruised and aching." },
        { upTo: 100, name: "fine", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["punch*", "shot", "beaten", "slam*", "kick*"], delta: -12 },
        { on: "both", words: ["patch up", "patched up", "doctor", "whiskey", "sleep", "slept"], delta: 12 },
      ],
    },
    {
      id: "heat", label: "Heat", icon: "🚨",
      min: 0, max: 100, start: 10, perTurn: -1,
      bands: [
        { upTo: 30, name: "clean", tell: "" },
        { upTo: 65, name: "watched", tell: "The character is being watched. Police and rivals take an interest." },
        { upTo: 100, name: "hunted", tell: "The character is actively hunted. Every public place is dangerous." },
      ],
      triggers: [
        { on: "output", words: ["gunshot*", "witness*", "police", "siren*", "arrest*", "dead body", "corpse"], delta: 18 },
        { on: "both", words: ["lay low", "laid low", "hide", "hid", "hiding", "disguise*", "alibi", "bribe*"], delta: -15 },
      ],
    },
    {
      id: "leads", label: "Leads", icon: "🔎",
      min: 0, max: 20, start: 0, perTurn: 0,
      bands: [
        { upTo: 0, name: "cold", tell: "The character has no leads. The trail is cold." },
        { upTo: 20, name: "warm", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["clue", "clues", "testimony", "confess*", "evidence", "new lead", "fresh lead"], delta: 1 },
      ],
    },
  ],
  // ==========================================================================
  // MECHANIC — a machine you have to keep alive.
  //
  // Written for long-haul trucking but it fits any scenario where the vehicle
  // is a character: haulage, a road trip in a dying van, a rally, a convoy.
  //
  // The design intent is that almost nothing here fails on its own. It fails
  // because of what you did two hours ago. Climbing a grade burns diesel AND
  // cooks the coolant. Coming down the far side costs brakes, and standing on
  // the service brakes instead of gearing down costs three times as much.
  // Repairs cost money you only get by delivering, and delivering costs hours
  // you only get back by stopping for the night.
  //
  // Watch how "grade", "brake job" and "shut down" each appear on several
  // resources at once. That is how one narrated moment moves three numbers.
  // ==========================================================================
  mechanic: [
    {
      id: "engine", label: "Engine", icon: "🔧",
      // Wears very slowly with distance even when nothing goes wrong, which is
      // what stops a well-maintained truck from simply sitting at 100 forever.
      min: 0, max: 100, start: 82, perTurn: -0.2,
      bands: [
        { upTo: 0, name: "seized", tell: "The engine is dead. It will not turn over, it will not be coaxed back, and the vehicle is going nowhere without a tow. Treat this as final." },
        { upTo: 25, name: "failing", tell: "The engine is failing. It misfires, loses power on any incline, and something metallic is knocking down there. The character expects it to let go at any moment." },
        { upTo: 60, name: "rough", tell: "The engine runs rough. It smokes on startup, hesitates under load, and the character has learned which noises to ignore and which to worry about." },
        { upTo: 100, name: "sound", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["blown gasket", "head gasket", "threw a rod", "turbo failure", "limp mode", "check engine", "engine light", "knocking", "seiz*"], delta: -22 },
        { on: "both", words: ["overhaul*", "rebuild the engine", "mechanic", "repair shop", "service the truck", "new turbo", "top up the oil", "oil change"], delta: 32 },
        // Abuse it and it remembers. "money shift" is a missed downshift at
        // speed, which is exactly the sort of thing a driver does once.
        { on: "both", words: ["redlin*", "over-rev*", "float the gears", "money shift", "ride the clutch"], delta: -9 },
      ],
    },
    {
      id: "fuel", label: "Diesel", icon: "⛽",
      min: 0, max: 100, start: 55, perTurn: -2.2,
      bands: [
        { upTo: 0, name: "dry", tell: "The tanks are dry. The engine has coughed itself quiet and the vehicle is coasting to the shoulder on momentum alone." },
        { upTo: 12, name: "fumes", tell: "The fuel gauge is below the peg and the low-fuel light has been on long enough that the character has stopped looking at it. Every exit sign matters now." },
        { upTo: 32, name: "low", tell: "Fuel is low. The character is doing arithmetic about the next fuel stop instead of paying attention to the road." },
        { upTo: 100, name: "ok", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["fuel island", "fuel up", "fuel stop", "fill the tanks", "top off the tanks", "refuel*", "diesel pump"], delta: 58 },
        { on: "both", words: ["grade", "climb*", "long pull", "mountain pass", "hammer down", "open her up"], delta: -7 },
        { on: "both", words: ["idle", "idles", "idling", "idled"], delta: -3 },
      ],
    },
    {
      id: "temp", label: "Coolant", icon: "🌡️",
      // Inverted: HIGH is bad. Note the min is 160, not 0 — this is a gauge in
      // degrees, and a running engine has a floor it never drops below. It
      // sheds heat on its own every turn, so heat is a debt, not a wound.
      min: 160, max: 260, start: 190, perTurn: -3,
      bands: [
        { upTo: 205, name: "normal", tell: "" },
        { upTo: 232, name: "hot", tell: "The temperature gauge is well above normal and still climbing. The character keeps glancing at it, and the heater is on full with the windows down to pull heat off the engine." },
        { upTo: 260, name: "overheating", tell: "The engine is overheating badly. Steam, an alarm, the smell of hot coolant. Pushing on from here does permanent damage and the character knows it." },
      ],
      triggers: [
        { on: "both", words: ["grade", "climb*", "long pull", "mountain pass", "heavy load", "overweight", "air conditioning", "towing"], delta: 19 },
        { on: "both", words: ["pull over", "shut down", "shut it down", "let her cool", "let it cool", "coolant", "radiator", "downshift*", "idle down"], delta: -26 },
        { on: "output", words: ["overheat*", "steam", "boiled over", "boiling over", "temperature alarm", "coolant leak"], delta: 21 },
      ],
    },
    {
      id: "tires", label: "Tires", icon: "🛞",
      min: 0, max: 100, start: 70, perTurn: -0.4,
      bands: [
        { upTo: 0, name: "blown", tell: "A tire is gone, running on the casing or the rim. The vehicle pulls hard to one side and cannot be driven any distance like this." },
        { upTo: 20, name: "bald", tell: "The tires are down to the cords. They slip on anything wet and the character takes corners like the road is made of glass." },
        { upTo: 55, name: "worn", tell: "The tires are worn thin and uneven. The character can hear them and does not like the sound." },
        { upTo: 100, name: "good", tell: "" },
      ],
      triggers: [
        { on: "output", words: ["blowout", "blew a tire", "tire blew", "flat tire", "gator", "shredded", "tread separat*"], delta: -38 },
        { on: "both", words: ["new tires", "retread*", "tire shop", "change the tire", "swap the tire", "air up the tires", "check the pressure"], delta: 46 },
        { on: "both", words: ["pothole*", "washboard", "rough road", "construction zone", "gravel", "curb", "curbed"], delta: -7 },
      ],
    },
    {
      id: "brakes", label: "Brakes", icon: "🛑",
      min: 0, max: 100, start: 78, perTurn: -0.3,
      bands: [
        { upTo: 0, name: "gone", tell: "The brakes are gone. The pedal goes to the floor. The character is looking for a runaway ramp, a rising shoulder, anything that will take speed off without stopping the vehicle in pieces." },
        { upTo: 22, name: "fading", tell: "The brakes are nearly gone and they smell like it. They fade after one hard application and the character is downshifting for everything instead." },
        { upTo: 55, name: "worn", tell: "The brakes are soft and pull to one side. The character leaves a lot more room than they used to." },
        { upTo: 100, name: "good", tell: "" },
      ],
      triggers: [
        // The descent itself always costs a little. How it is driven costs the
        // rest: standing on the service brakes is what actually kills them.
        { on: "both", words: ["downgrade", "steep grade", "down the mountain", "descend*"], delta: -8 },
        { on: "both", words: ["hard on the brakes", "brake hard", "braked hard", "panic stop", "stood on the brakes", "rode the brakes"], delta: -16 },
        // The whole point of the preset in one line: doing it the right way
        // does not repair anything, it just costs you less. Both this and the
        // descent fire on the same turn, so a jake-braked grade is -2, not -8.
        //
        // Honest caveat: triggers have no conditions, so narrating an engine
        // brake on flat ground credits you 6 you did not really earn. Keep this
        // delta small for that reason, or delete it if your players game it.
        { on: "both", words: ["jake brake", "engine brake", "compression brake", "low gear", "geared down", "gear down"], delta: 6 },
        { on: "both", words: ["brake job", "new pads", "new shoes", "slack adjuster", "adjust the brakes", "brake shop"], delta: 42 },
      ],
    },
    {
      id: "hos", label: "Drive Time", icon: "⏱️",
      // Legal driving hours left in the day. Half an hour per turn. This is the
      // meter that makes the scenario a job rather than a drive: it is the only
      // one you cannot fix with money, and stopping to fix it costs a night.
      min: 0, max: 11, start: 11, perTurn: -0.5,
      bands: [
        { upTo: 0, name: "out of hours", tell: "The character is out of legal driving hours. Every mile from here is a violation they will have to answer for, and the pressure to find somewhere legal to park is immediate and constant." },
        { upTo: 1, name: "final hour", tell: "Less than an hour of legal drive time is left, and the truck stops fill up long before dark. The character is weighing distance against a place to sleep." },
        { upTo: 3, name: "running short", tell: "Drive time is running short. The character is doing the maths on whether this run makes it before the clock does." },
        { upTo: 11, name: "legal", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["ten hour break", "10 hour break", "shut down for the night", "park for the night", "sleeper berth", "reset the clock", "34 hour"], delta: 11 },
        // Buys you time and nothing else. If you add a DOT-attention meter,
        // put these same words on it with a large positive delta.
        { on: "both", words: ["fudge the log", "run illegal", "yellow log", "off the books"], delta: 3 },
      ],
    },
    {
      id: "alert", label: "Alertness", icon: "☕",
      // Drains fast enough that fatigue arrives on its own, without needing a
      // trigger to cause it: "tired" by about turn 12, "exhausted" by turn 24.
      // This is the one meter that should degrade whether or not anything
      // interesting happens, because that is what a long day in a seat is.
      min: 0, max: 100, start: 80, perTurn: -2.4,
      bands: [
        { upTo: 0, name: "microsleeping", tell: "The character is falling asleep at the wheel. They are losing seconds of road at a time and coming back to a lane they do not remember choosing. Narrate this as the emergency it is." },
        { upTo: 22, name: "exhausted", tell: "The character is dangerously tired. Their reactions are slow, their eyes keep closing, and they are arguing with themselves about stopping." },
        { upTo: 50, name: "tired", tell: "The character is tired. Their attention drifts and they have to work to keep it on the road." },
        { upTo: 100, name: "sharp", tell: "" },
      ],
      triggers: [
        // "rest" is safe as a bare word: matching respects word boundaries, so
        // it will not fire on "restaurant" or "arrest".
        { on: "both", words: ["sleep", "slept", "sleeping", "nap", "napped", "rest", "rested", "sleeper berth", "shut down for the night"], delta: 58 },
        { on: "both", words: ["coffee", "caffeine", "energy drink", "black coffee"], delta: 15 },
        { on: "both", words: ["drove through the night", "drive through the night", "push through", "pushed through", "white line fever", "one more hour"], delta: -19 },
      ],
    },
    {
      id: "cash", label: "Settlement", icon: "💵",
      // Starts at roughly one fill plus one repair. Tight on purpose: the
      // maintenance decisions only matter if you cannot afford all of them.
      min: 0, max: 99999, start: 1400, perTurn: 0,
      bands: [
        { upTo: 0, name: "broke", tell: "The character has no money at all. The fuel card is declined, the shop will not start work, and there is nothing to eat that is not already in the cab." },
        { upTo: 250, name: "tight", tell: "Money is tight enough that the character is choosing between fuel and repairs, and putting off the repair." },
        { upTo: 99999, name: "ok", tell: "" },
      ],
      triggers: [
        { on: "both", words: ["deliver*", "unload*", "drop the trailer", "bill of lading", "got paid", "settlement", "signed for the load"], delta: 2200 },
        { on: "both", words: ["mechanic", "repair shop", "brake job", "new tires", "overhaul*", "towed", "tow truck"], delta: -680 },
        { on: "both", words: ["fuel island", "fuel up", "fill the tanks", "refuel*"], delta: -410 },
        { on: "output", words: ["ticket", "citation", "fined", "out of service", "violation"], delta: -900 },
      ],
    },
  ],
};

/* ============================================================================
 * 3. FRAMEWORK — you should not need to edit below this line.
 * ==========================================================================*/

const RM = (function () {
  const VERSION = 1;
  const SENTINEL = "%RM%";          // story card key that will never trigger
  const BUILD_MARK = "%RM_NEW%";    // temporary title used to find a new card
  const DIFFICULTY = { easy: 0.5, normal: 1, hard: 1.75 };

  // ---- small utilities ----------------------------------------------------

  function isNum(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function clamp(v, lo, hi) {
    if (!isNum(v)) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function hash32(s) {
    // FNV-1a. Cheap, good enough to tell "same output as last turn" apart.
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function dbg() {
    if (!RM_CONFIG.debug) return;
    try {
      log("[Living Meters] " + Array.from(arguments).map((a) =>
        typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    } catch (e) { /* logging must never break a turn */ }
  }

  // ---- trigger compilation -----------------------------------------------

  // Config problems are collected here and reported to the creator rather than
  // silently swallowed — a trigger that never fires is very hard to notice.
  const PROBLEMS = [];

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // "loot"  → loot          (whole word only)
  // "loot*" → loot\w*       (word endings count)
  function wordToAlt(w) {
    const raw = String(w).trim();
    if (!raw) return null;
    if (raw.endsWith("*")) {
      const stem = raw.slice(0, -1).trim();
      return stem ? escapeRe(stem) + "\\w*" : null;
    }
    return escapeRe(raw);
  }

  // Turns a creator's trigger into { on, re, delta }, or records why it can't.
  function compileTrigger(resId, t, index) {
    const where = `${resId} trigger #${index + 1}`;

    if (!t || typeof t !== "object") {
      PROBLEMS.push(`${where}: not an object.`);
      return null;
    }
    if (!isNum(t.delta) || t.delta === 0) {
      PROBLEMS.push(`${where}: needs a non-zero numeric "delta".`);
      return null;
    }

    const on = t.on === "input" || t.on === "output" ? t.on : "both";

    // Escape hatch for authors who genuinely want their own pattern.
    if (t.match !== undefined) {
      if (!(t.match instanceof RegExp)) {
        PROBLEMS.push(
          `${where}: "match" must be a regular expression like /word/i, not a string. ` +
          `Use words: ["word"] instead.`
        );
        return null;
      }
      return { on: on, re: t.match, delta: t.delta, words: ["(custom pattern)"] };
    }

    if (!Array.isArray(t.words) || !t.words.length) {
      PROBLEMS.push(`${where}: needs words: ["some", "word*"].`);
      return null;
    }

    const alts = [];
    for (const w of t.words) {
      const a = wordToAlt(w);
      if (a) alts.push(a);
      else PROBLEMS.push(`${where}: ignored an empty entry in "words".`);
    }
    if (!alts.length) {
      PROBLEMS.push(`${where}: no usable words.`);
      return null;
    }

    // Boundaries on both sides, so "rest" fires on "you rest" but not on
    // "restaurant" or "arrest". \b is not used because it needs a word
    // character to sit against, which breaks entries like "c++" or "o2!".
    // The leading alternative consumes a character, which is harmless for
    // .test(), and avoids needing lookbehind support.
    try {
      return {
        on: on,
        re: new RegExp("(?:^|\\W)(?:" + alts.join("|") + ")(?!\\w)", "i"),
        delta: t.delta,
        words: t.words.slice(),   // kept for introspection and testing
      };
    } catch (err) {
      PROBLEMS.push(`${where}: could not build a pattern from those words.`);
      return null;
    }
  }

  // ---- resource definitions ----------------------------------------------

  // Merge RM_CONFIG.resources over the chosen preset, matched by id.
  function buildDefs() {
    const preset = RM_PRESETS[RM_CONFIG.preset] || RM_PRESETS.none;
    const byId = new Map();

    for (const r of preset) byId.set(r.id, Object.assign({}, r));
    for (const r of RM_CONFIG.resources || []) {
      if (!r || typeof r.id !== "string") continue;
      byId.set(r.id, Object.assign({}, byId.get(r.id) || {}, r));
    }

    const out = [];
    for (const r of byId.values()) {
      if (typeof r.id !== "string") continue;

      const min = isNum(r.min) ? r.min : 0;
      const max = isNum(r.max) ? r.max : 100;
      if (max <= min) PROBLEMS.push(`${r.id}: max (${max}) must be greater than min (${min}).`);

      const triggers = [];
      const rawTriggers = Array.isArray(r.triggers) ? r.triggers : [];
      for (let i = 0; i < rawTriggers.length; i++) {
        const c = compileTrigger(r.id, rawTriggers[i], i);
        if (c) triggers.push(c);
      }

      out.push({
        id: r.id,
        label: typeof r.label === "string" ? r.label : r.id,
        icon: typeof r.icon === "string" ? r.icon : "",
        min: min,
        max: max,
        start: isNum(r.start) ? r.start : max,
        perTurn: isNum(r.perTurn) ? r.perTurn : 0,
        visible: r.visible !== false,
        enabled: r.enabled !== false,
        bands: Array.isArray(r.bands) ? r.bands.slice() : [],
        triggers: triggers,
      });
    }
    return out;
  }

  // Definitions live in the Library, never in state — state is JSON-serialized
  // between turns and would silently drop the regexes.
  let DEFS = null;
  function defs() {
    if (!DEFS) DEFS = buildDefs();
    return DEFS;
  }
  function def(id) {
    return defs().find((d) => d.id === id) || null;
  }

  function bandOf(d, value) {
    // First band whose `upTo` is >= the value wins. Bands are read low→high.
    const sorted = d.bands.slice().sort((a, b) => (a.upTo ?? 0) - (b.upTo ?? 0));
    for (const b of sorted) if (value <= (b.upTo ?? 0)) return b;
    return sorted.length ? sorted[sorted.length - 1] : { name: "", tell: "" };
  }

  // ---- state --------------------------------------------------------------

  function freshState() {
    const res = {};
    for (const d of defs()) res[d.id] = clamp(d.start, d.min, d.max);
    return {
      v: VERSION,
      res: res,
      band: {},        // id -> last announced band name
      turn: 0,         // our own turn counter, not info.actionCount
      hlen: 0,         // history.length at the last counted turn
      outHash: 0,      // hash of the last output we scanned
      msgPrev: "",     // last toast we wrote, for cooperative state.message
      msgTurn: -1,     // the turn we wrote it on, so later hooks can add to it
      cardOK: true,    // false once we detect story cards are unavailable
      warned: false,
      pendingStop: false, // a command ran in Input; Context executes the halt
      cfgWarned: false,   // config problems have been shown once
      fired: {},          // trigger keys already counted this turn
      over: {},        // player overrides parsed from the story card
    };
  }

  // Validate every field. A script upgrade mid-adventure must not corrupt a run.
  function hydrate() {
    const raw = state.RM;
    if (!raw || typeof raw !== "object" || raw.v !== VERSION) {
      dbg("initialising state");
      return freshState();
    }
    const s = freshState();
    if (raw.res && typeof raw.res === "object") {
      for (const d of defs()) {
        if (isNum(raw.res[d.id])) s.res[d.id] = clamp(raw.res[d.id], d.min, d.max);
      }
    }
    if (raw.band && typeof raw.band === "object") s.band = raw.band;
    if (isNum(raw.turn)) s.turn = raw.turn;
    if (isNum(raw.hlen)) s.hlen = raw.hlen;
    if (isNum(raw.outHash)) s.outHash = raw.outHash;
    if (typeof raw.msgPrev === "string") s.msgPrev = raw.msgPrev;
    if (isNum(raw.msgTurn)) s.msgTurn = raw.msgTurn;
    if (typeof raw.cardOK === "boolean") s.cardOK = raw.cardOK;
    if (typeof raw.warned === "boolean") s.warned = raw.warned;
    if (typeof raw.pendingStop === "boolean") s.pendingStop = raw.pendingStop;
    if (typeof raw.cfgWarned === "boolean") s.cfgWarned = raw.cfgWarned;
    if (raw.fired && typeof raw.fired === "object") s.fired = raw.fired;
    if (raw.over && typeof raw.over === "object") s.over = raw.over;
    return s;
  }

  function persist(s) {
    state.RM = s;
  }

  // ---- player overrides, read from the story card -------------------------

  // The card's NOTES field is never shown to the AI, which makes it the right
  // place for machine-readable settings the player can edit.
  //
  //   difficulty = hard
  //   show = off
  //   hunger.perTurn = -3
  //   thirst.off
  //
  function parseOverrides(src) {
    const over = {};
    if (typeof src !== "string" || !src) return over;

    for (let line of src.split("\n")) {
      line = line.split("#")[0].trim();
      if (!line) continue;

      // "<id>.off" / "<id>.on"
      const toggle = line.match(/^([A-Za-z0-9_]+)\.(off|on)$/i);
      if (toggle) {
        over[toggle[1] + ".enabled"] = toggle[2].toLowerCase() === "on";
        continue;
      }

      const kv = line.match(/^([A-Za-z0-9_.]+)\s*[=:]\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1].trim();
      const rawVal = kv[2].trim();
      const num = Number(rawVal);

      if (/^(on|true|yes)$/i.test(rawVal)) over[key] = true;
      else if (/^(off|false|no)$/i.test(rawVal)) over[key] = false;
      else if (Number.isFinite(num) && rawVal !== "") over[key] = num;
      else over[key] = rawVal;
    }
    return over;
  }

  function optNum(s, key, fallback) {
    const v = s.over[key];
    return isNum(v) ? v : fallback;
  }
  function optBool(s, key, fallback) {
    const v = s.over[key];
    return typeof v === "boolean" ? v : fallback;
  }

  // Effective definition for a resource, after player overrides.
  function eff(s, d) {
    return {
      id: d.id,
      label: d.label,
      icon: d.icon,
      min: optNum(s, d.id + ".min", d.min),
      max: optNum(s, d.id + ".max", d.max),
      start: optNum(s, d.id + ".start", d.start),
      perTurn: optNum(s, d.id + ".perTurn", d.perTurn),
      visible: optBool(s, d.id + ".visible", d.visible),
      enabled: optBool(s, d.id + ".enabled", d.enabled),
      bands: d.bands,
      triggers: d.triggers,
    };
  }

  function activeDefs(s) {
    return defs().map((d) => eff(s, d)).filter((d) => d.enabled);
  }

  function difficultyMul(s) {
    const key = String(s.over.difficulty || RM_CONFIG.difficulty || "normal").toLowerCase();
    return DIFFICULTY[key] ?? 1;
  }

  // ---- mutation -----------------------------------------------------------

  function setVal(s, id, value) {
    const d = def(id);
    if (!d) return null;
    const e = eff(s, d);
    const before = s.res[id] ?? e.min;
    s.res[id] = round2(clamp(value, e.min, e.max));
    return { id: id, before: before, after: s.res[id], def: e };
  }

  function addVal(s, id, delta, opts) {
    const d = def(id);
    if (!d || !isNum(delta) || delta === 0) return null;
    const e = eff(s, d);
    let amount = delta;
    // Difficulty scales losses only — a hard run drains faster but does not
    // hand out bigger rewards.
    if (amount < 0 && !(opts && opts.raw)) amount *= difficultyMul(s);
    return setVal(s, id, (s.res[id] ?? e.start ?? e.min) + amount);
  }

  // ---- turn detection -----------------------------------------------------

  // There is no "the turn advanced" API, and info.actionCount is not a clean
  // counter: it increments twice on a Do/Say/Story turn, once on a Continue,
  // and has been observed to decrement on a Retry and to go negative.
  // history.length is the more honest signal until the platform truncates it,
  // so use it first and fall back to actionCount once it plateaus.
  function turnAdvanced(s) {
    const hl = Array.isArray(history) ? history.length : 0;
    const ac = Number.isInteger(info?.actionCount) ? Math.abs(info.actionCount) : 0;

    if (Math.abs(hl - ac) < 2) {
      // history is intact — trust it. A retry re-generates without growing it.
      if (hl > s.hlen) { s.hlen = hl; return true; }
      s.hlen = hl;
      return false;
    }
    // history has been truncated; fall back to the action counter.
    if (ac > s.turn) return true;
    return false;
  }

  // ---- per-turn drift -----------------------------------------------------

  function tick(s) {
    const changes = [];
    for (const e of activeDefs(s)) {
      if (!e.perTurn) continue;
      const r = addVal(s, e.id, e.perTurn);
      if (r && r.before !== r.after) changes.push(r);
    }
    s.turn += 1;
    return changes;
  }

  // ---- triggers -----------------------------------------------------------

  // A trigger fires at most ONCE per turn, even when its word appears in both
  // the player's action and the AI's narration. "You weld the plate" followed
  // by "You weld it down" is one weld, not two. s.fired is reset at the start
  // of the Input hook and cleared again at the end of the Output hook, so it
  // spans exactly one turn and behaves correctly on Continue actions too.
  function scan(s, src, phase) {
    if (typeof src !== "string" || !src) return [];
    if (!s.fired || typeof s.fired !== "object") s.fired = {};
    const changes = [];
    for (const e of activeDefs(s)) {
      for (let i = 0; i < e.triggers.length; i++) {
        const t = e.triggers[i];
        // Patterns are compiled and validated once in buildDefs, so anything
        // reaching here is known-good.
        if (t.on !== "both" && t.on !== phase) continue;
        const key = e.id + "#" + i;
        if (s.fired[key]) continue;
        if (!t.re.test(src)) continue;
        s.fired[key] = 1;
        const r = addVal(s, e.id, t.delta);
        if (r && r.before !== r.after) changes.push(r);
      }
    }
    return changes;
  }

  // ---- presentation -------------------------------------------------------

  function bar(value, min, max) {
    const span = max - min;
    if (span <= 0) return "";
    const filled = Math.round(((value - min) / span) * 10);
    return "█".repeat(clamp(filled, 0, 10)) + "░".repeat(10 - clamp(filled, 0, 10));
  }

  function statusLine(s) {
    const parts = [];
    for (const e of activeDefs(s)) {
      if (!e.visible) continue;
      const v = s.res[e.id];
      parts.push(`${e.icon}${e.icon ? " " : ""}${e.label} ${Math.round(v)}/${Math.round(e.max)}`);
    }
    return parts.join("  ·  ");
  }

  function statusBlock(s) {
    const rows = [];
    for (const e of activeDefs(s)) {
      if (!e.visible) continue;
      const v = s.res[e.id];
      const b = bandOf(e, v);
      rows.push(
        `${e.icon || "•"} ${e.label.padEnd(10)} ${bar(v, e.min, e.max)} ` +
        `${String(Math.round(v)).padStart(4)}/${Math.round(e.max)}` +
        (b.name ? `  (${b.name})` : "")
      );
    }
    return rows.join("\n");
  }

  // What the AI is told. Complete sentences only: an unterminated fragment in
  // frontMemory invites the model to finish it.
  function directive(s) {
    const stats = [];
    const tells = [];
    for (const e of activeDefs(s)) {
      const v = s.res[e.id];
      const b = bandOf(e, v);
      if (e.visible) {
        stats.push(`${e.label} ${Math.round(v)}/${Math.round(e.max)}${b.name ? ` (${b.name})` : ""}`);
      }
      if (b.tell) tells.push(b.tell);
    }
    if (!stats.length && !tells.length) return "";

    let out = `[${RM_CONFIG.injectLabel}: ${stats.join(", ")}.`;
    if (tells.length) out += " " + tells.join(" ");
    out += " Reflect this in the narration through behaviour and sensation;" +
           " never state the numbers themselves.]";
    return out;
  }

  // ---- toasts -------------------------------------------------------------

  // Collected during a hook and written once. The Library re-executes on every
  // hook, so this buffer resets by itself each time.
  let TOASTS = [];

  function toast(s, msg) {
    if (msg && TOASTS.indexOf(msg) === -1) TOASTS.push(msg);
  }

  // state.message is a single slot any script can write. Only overwrite what we
  // put there ourselves, so we never clobber another script's toast.
  function flushToast(s) {
    if (!TOASTS.length) return;
    const msg = TOASTS.join("\n");
    TOASTS = [];
    const current = typeof state.message === "string" ? state.message : "";
    if (current && current !== s.msgPrev) return; // somebody else owns the slot

    // The Library re-executes per hook, so every hook flushes its own buffer.
    // Within one turn, ADD to what we already wrote rather than replacing it.
    // statusEvery queues its block during Context; without this an Output-hook
    // band announcement overwrites it and the player never sees the status.
    let out;
    if (current && s.msgTurn === s.turn) {
      if (current.indexOf(msg) !== -1) return;   // already on screen this turn
      out = current + "\n" + msg;
    } else {
      // The client suppresses a toast identical to the previous one; perturb it.
      out = current === msg ? msg + " " : msg;
    }
    state.message = out;
    s.msgPrev = out;
    s.msgTurn = s.turn;
  }

  // ---- story card ---------------------------------------------------------

  const CARD_HEADER = [
    "# Living Meters settings. Edit the lines below, then close this card.",
    "# Lines starting with # are ignored. Delete a line to use the default.",
    "#",
    "#   difficulty = easy | normal | hard",
    "#   <resource>.perTurn = -2      how much it drifts each turn",
    "#   <resource>.max     = 120     raise or lower the ceiling",
    "#   <resource>.off               stop tracking it entirely",
    "#   <resource>.on                track it again",
    "#",
  ].join("\n");

  function findCard() {
    if (!Array.isArray(storyCards)) return null;
    for (const c of storyCards) {
      if (c && c.title === RM_CONFIG.playerCardTitle) return c;
    }
    return null;
  }

  // addStoryCard returns the new LENGTH (the help site says "index" — it is
  // wrong, and has been for years), and cannot set the description field.
  // Creating a card with a sentinel title and then finding it by that title
  // gets us a real object reference to mutate.
  function createCard(s) {
    try {
      addStoryCard(SENTINEL, " ", "Custom", BUILD_MARK, " ");
    } catch (e) {
      s.cardOK = false;
      return null;
    }
    for (const c of storyCards) {
      if (c && c.title === BUILD_MARK) {
        c.title = RM_CONFIG.playerCardTitle;
        c.keys = SENTINEL;
        c.type = "Custom";
        c.entry = " ";
        c.description = CARD_HEADER + "\ndifficulty = " + (RM_CONFIG.difficulty || "normal") + "\n";
        return c;
      }
    }
    // Story card writes silently fail when the Memory Bank feature is off.
    s.cardOK = false;
    return null;
  }

  function syncCard(s) {
    if (!RM_CONFIG.playerCard || !s.cardOK) return;

    let card = findCard();
    if (!card) card = createCard(s);
    if (!card) {
      if (!s.warned) {
        s.warned = true;
        toast(s, "Living Meters: story cards are unavailable. Enable Gameplay > Memory System > Memory Bank.");
      }
      return;
    }

    // The player owns `description`; we only ever read it.
    s.over = parseOverrides(card.description);

    // We own `entry`, and it never reaches the AI because `keys` never matches.
    const block = statusBlock(s);
    const next = `Current status (read-only, updates every turn)\n\n${block}\n`;
    if (card.entry !== next) card.entry = next;
  }

  // ---- commands -----------------------------------------------------------

  function stripPrefix(raw) {
    // Player input arrives pre-processed: "\n> You say \"/status\"\n" and so on.
    // In third person the name replaces "You", so match loosely.
    let t = String(raw || "");
    t = t.replace(/^\s*>\s*/, "");
    t = t.replace(/^[^\s]+\s+(?:say|says|said)[,:]?\s*/i, "");
    t = t.replace(/^["'“”]+|["'“”\s]+$/g, "");
    return t.trim();
  }

  function helpText() {
    const p = RM_CONFIG.commandPrefix;
    return [
      `${p}status        show all resources`,
      `${p}<id> +N       add to a resource   (e.g. ${p}hp +10)`,
      `${p}<id> -N       subtract from it`,
      `${p}<id> =N       set it exactly`,
      `${p}reset         restore starting values`,
      `${p}help          this list`,
    ].join("\n");
  }

  // Returns a message string if the input was a command, else null.
  function handleCommand(s, raw) {
    const p = RM_CONFIG.commandPrefix;
    const t = stripPrefix(raw);
    if (!t.startsWith(p)) return null;

    const body = t.slice(p.length).trim();
    if (!body) return null;
    const parts = body.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === "help") return helpText();
    if (cmd === "status") return statusBlock(s) || "No resources are being tracked.";

    if (cmd === "reset") {
      for (const d of defs()) setVal(s, d.id, d.start);
      s.band = {};
      return "Meters reset.\n\n" + statusBlock(s);
    }

    // "<id> +10" / "<id> -5" / "<id> =80" / "<id>" to query one
    const d = def(cmd);
    if (d) {
      const arg = parts[1];
      if (!arg) {
        const e = eff(s, d);
        return `${e.label}: ${Math.round(s.res[d.id])}/${Math.round(e.max)} (${bandOf(e, s.res[d.id]).name || "-"})`;
      }
      const m = arg.match(/^([+\-=])?(\d+(?:\.\d+)?)$/);
      if (!m) return `Could not read "${arg}". Try ${p}${cmd} +10`;
      const n = Number(m[2]);
      const r = m[1] === "=" ? setVal(s, d.id, n)
              : m[1] === "-" ? addVal(s, d.id, -n, { raw: true })
              : addVal(s, d.id, n, { raw: true });
      if (!r) return "No change.";
      const e = eff(s, d);
      return `${e.label}: ${Math.round(r.before)} → ${Math.round(r.after)}/${Math.round(e.max)}`;
    }

    return `Unknown command "${cmd}". Type ${p}help.`;
  }

  // ---- band-change announcements -----------------------------------------

  function announce(s) {
    if (!RM_CONFIG.announceBandChanges) return;
    const crossed = [];
    for (const e of activeDefs(s)) {
      const b = bandOf(e, s.res[e.id]);
      const name = b.name || "";
      if (s.band[e.id] !== name) {
        if (s.band[e.id] !== undefined && name) {
          crossed.push(`${e.icon || ""}${e.icon ? " " : ""}${e.label}: ${name}`);
        }
        s.band[e.id] = name;
      }
    }
    if (crossed.length) toast(s, crossed.join("   "));
  }

  // ---- config problem reporting ------------------------------------------

  // A misconfigured trigger is invisible otherwise: it simply never fires.
  // Say so, once, rather than letting the creator wonder.
  function reportProblems(s) {
    defs();                       // force compilation so PROBLEMS is populated
    if (!PROBLEMS.length) return;
    for (const p of PROBLEMS) dbg("config:", p);
    if (s.cfgWarned && !RM_CONFIG.debug) return;
    s.cfgWarned = true;
    const shown = PROBLEMS.slice(0, 4);
    toast(s, "Living Meters, check your config:\n• " + shown.join("\n• ") +
      (PROBLEMS.length > shown.length ? `\n• …and ${PROBLEMS.length - shown.length} more` : ""));
  }

  // ---- hook entry points --------------------------------------------------

  function onInput(inText) {
    const s = hydrate();
    let out = typeof inText === "string" ? inText : " ";

    try {
      s.fired = {};              // a new player action begins a new turn
      reportProblems(s);
      syncCard(s);

      const reply = handleCommand(s, out);
      if (reply !== null) {
        toast(s, reply);
        if (RM_CONFIG.haltOnCommand) {
          // stop:true from onInput surfaces an error banner to the player; the
          // working halt is executed from the Context hook instead.
          s.pendingStop = true;
        }
        flushToast(s);
        persist(s);
        return out;
      }

      if (RM_CONFIG.scanInput) scan(s, out, "input");
      announce(s);

      if (RM_CONFIG.inject === "frontMemory") {
        state.memory = state.memory || {};
        state.memory.frontMemory = directive(s);
      }
    } catch (err) {
      dbg("onInput error", String(err));
    }

    flushToast(s);
    persist(s);
    return out;
  }

  function onContext(inText, inStop) {
    const s = hydrate();
    let out = typeof inText === "string" ? inText : " ";
    let halt = inStop === true;

    try {
      if (s.pendingStop) {
        s.pendingStop = false;
        halt = true;
        flushToast(s);
        persist(s);
        return [out, halt];
      }

      reportProblems(s);

      // The Context hook is the only one that runs on every generation,
      // including Continue actions, so the turn tick belongs here.
      if (turnAdvanced(s)) {
        tick(s);
        announce(s);
        if (RM_CONFIG.statusEvery > 0 && s.turn % RM_CONFIG.statusEvery === 0) {
          toast(s, statusBlock(s));
        }
      }

      syncCard(s);

      if (RM_CONFIG.inject === "context") {
        const block = directive(s);
        if (block) {
          const maxChars = isNum(info?.maxChars) ? info.maxChars : 0;
          const joined = out + "\n" + block;
          // The server truncates whatever we return to info.maxChars, and it
          // trims from the front — so trim ourselves and keep our block.
          out = maxChars > 0 && joined.length > maxChars
            ? joined.slice(joined.length - maxChars)
            : joined;
        }
      } else if (RM_CONFIG.inject === "frontMemory") {
        state.memory = state.memory || {};
        state.memory.frontMemory = directive(s);
      }
    } catch (err) {
      dbg("onContext error", String(err));
    }

    flushToast(s);
    persist(s);
    return [out, halt];
  }

  function onOutput(inText) {
    const s = hydrate();
    let out = typeof inText === "string" ? inText : " ";

    try {
      if (RM_CONFIG.scanOutput && out.trim()) {
        // Retries reuse cached outputs, so the same text can arrive twice.
        // Hashing it stops a retry from applying every trigger a second time.
        const h = hash32(out);
        if (h !== s.outHash) {
          s.outHash = h;
          scan(s, out, "output");
          announce(s);
          syncCard(s);
        }
      }
      s.fired = {};              // the turn is over; release every trigger

    } catch (err) {
      dbg("onOutput error", String(err));
    }

    flushToast(s);
    persist(s);
    // Never return an empty string: onOutput throws a player-visible error.
    return out.length ? out : " ";
  }

  // ---- public API (also usable from your own scripts) --------------------

  return {
    input: onInput,
    context: onContext,
    output: onOutput,

    get: (id) => (hydrate().res[id] ?? null),
    set: (id, v) => { const s = hydrate(); const r = setVal(s, id, v); persist(s); return r; },
    add: (id, v) => { const s = hydrate(); const r = addVal(s, id, v, { raw: true }); persist(s); return r; },
    all: () => hydrate().res,
    status: () => statusBlock(hydrate()),
    line: () => statusLine(hydrate()),
    directive: () => directive(hydrate()),

    // Effective definitions after player overrides, as plain JSON-safe data.
    // Compiled patterns are omitted; `words` is the author's original list.
    defs: () => {
      const s = hydrate();
      return defs().map((d) => {
        const e = eff(s, d);
        return {
          id: e.id, label: e.label, icon: e.icon,
          min: e.min, max: e.max, start: e.start, perTurn: e.perTurn,
          visible: e.visible, enabled: e.enabled,
          value: s.res[e.id],
          band: bandOf(e, s.res[e.id]).name || "",
          bands: e.bands.map((b) => ({ upTo: b.upTo, name: b.name, tell: b.tell || "" })),
          triggers: e.triggers.map((t) => ({ on: t.on, delta: t.delta, words: t.words })),
        };
      });
    },
    // Queue a toast through RM's own buffer instead of writing state.message
    // yourself. flushToast stays the single writer, so a scenario add-on's
    // message and a band announcement on the same turn are joined rather than
    // one silently losing the slot: assigning state.message directly makes RM
    // yield, and the band is already recorded as announced, so it never
    // returns. Call this before RM.input/RM.context in the same hook.
    toast: (msg) => { toast(null, msg); },

    problems: () => { defs(); return PROBLEMS.slice(); },
  };
})();
