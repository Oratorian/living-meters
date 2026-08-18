# Living Meters

**Living Meters is an AI Dungeon scenario script that turns tracked numbers into behaviour the AI
plays out.** Health, hunger, ammo, fuel, mana, sanity, coin, police heat, reputation: each one drifts
every turn, reacts to what the story says, and reaches the model as an instruction about how the
character should *feel and behave*, never as a stat line.

At Oxygen 32/100 the AI is not told "Oxygen 32". It is told *"The air is thin and stale. The
character tires quickly and has a persistent headache,"* and it writes a tired character.

The meters are *living* because they move on their own. That is the difference between this and a
static stat sheet.

It is deliberately story-agnostic. A meter is just **a number with a range, a per-turn drift, some
narrative bands, and some word triggers**. Five presets ship in the box (survival, fantasy, sci-fi,
noir, mechanic); a completely custom set is about ten lines of config.

> The code namespace is `RM` / `RM_CONFIG` / `RM_PRESETS` and the saved state lives at `state.RM`.
> That is the original working name, kept on purpose: it is short, it collides with nothing, and
> changing it would invalidate saved adventures for no benefit.

## Try it in your browser

**<https://oratorian.github.io/living-meters/>**

Paste a config and press a button. **Run tuning** simulates 30 turns and reports what a live
adventure would take an hour to reveal. **Run tests** runs the full 65-check correctness suite.
No install, no account, and nothing is uploaded; it all executes in your tab.

Two development tools come with it. Neither is pasted into AI Dungeon, and both are on that page as
well as on the command line:

| Tool | Question it answers | Without Node |
| --- | --- | --- |
| `node test-harness.js` | *Is the framework still correct?* | *Run tests* |
| `node playthrough.js` | *Is my scenario tuned?* | *Run tuning* |

---

## Contents

- [Try it in your browser](#try-it-in-your-browser)
- [Install](#install)
- [How it works](#how-it-works) (the mechanism, in detail)
- [Configuring for the scenario creator](#configuring-for-the-scenario-creator)
- [Configuring for the player](#configuring-for-the-player)
- [Things worth knowing before you ship](#things-worth-knowing-before-you-ship)
- [Using it from your own script](#using-it-from-your-own-script)
- [Development tools](#development-tools) (how the two test scripts work)
- [Files](#files)

---

## Install

1. Edit a **Simple Start** or **Character Creator** scenario, go to the **Details** tab, scroll to
   **Scripting**, toggle **Scripts Enabled**, then press **Edit Scripts**.
2. Paste each file into the matching tab, replacing everything that's there:

   | File | Tab |
   | --- | --- |
   | `library.js` | Library |
   | `input.js` | Input |
   | `context.js` | Context |
   | `output.js` | Output |

3. Press **Save**.
4. Turn on **Gameplay > Memory System > Memory Bank**. Story card writes silently fail without it,
   which disables the player settings card.

All four tabs are required, even if you set `inject: "none"`, because the Context tab is where the
per-turn tick runs and where `/commands` halt.

> Scripts also need the player's **Account Settings > Gameplay > Scripts** toggle on. It is a global
> kill switch, it defaults on, and it produces **no error** when off. It is the single most common
> cause of "the script does nothing".

---

## How it works

### The turn lifecycle

AI Dungeon gives a script three hooks per generation. The framework uses all three, and each does a
different job:

```text
player types "I weld the plate"
        │
        │  platform rewrites to second person and prefixes it
        ▼
   ┌──────────┐   RM.input(text)
   │ onInput  │   • reset the per-turn trigger latch
   │          │   • intercept /commands
   └──────────┘   • scan the player's action for trigger words
        │         • (if inject:"frontMemory") write the status block
        ▼
   platform assembles the model context
        │
        ▼
   ┌──────────────┐   RM.context(text, stop)
   │onModelContext│   • execute a pending /command halt
   │              │   • ADVANCE THE TURN: apply per-turn drift
   └──────────────┘   • (if inject:"context") append the status block
        │             • re-truncate to info.maxChars
        ▼
      AI model
        │
        ▼
   ┌──────────┐   RM.output(text)
   │ onOutput │   • skip if this output was already scanned (retry)
   │          │   • scan the AI's narration for trigger words
   └──────────┘   • release the per-turn trigger latch
        │
        ▼
   shown to the player
```

**The tick lives in the Context hook** because that is the only hook that runs on *every* generation.
A Continue action produces no `onInput` call at all, so ticking in Input would silently stop the
clock whenever a player presses Continue.

### The Library runs three times per turn

AI Dungeon prepends the Library tab's source to whichever hook script is running, on **every hook
invocation**. That has consequences the framework is built around:

- Anything at Library top level executes **three times per turn**.
- Library variables do **not** persist between hooks or turns. `state` is the only persistence.
- The Library's cost counts against the **same 2-second budget** as the hook it is prepended to.
- Scope is one-way: Library identifiers are visible in Input/Context/Output, never the reverse.

Everything here lives inside one IIFE (`RM`) with no top-level side effects, so the triple execution
costs only re-parsing.

### What is stored, and where

`state.RM` is the entire persisted footprint, typically **250 to 600 characters**:

| Field | Purpose |
| --- | --- |
| `v` | Schema version. A mismatch discards the old state rather than corrupting a run. |
| `res` | `{ id: value }`, the actual numbers. |
| `band` | Last announced band per resource, so a crossing is toasted exactly once. |
| `turn` | The framework's own turn counter, not `info.actionCount`. |
| `hlen` | `history.length` at the last counted turn; half of the turn detector. |
| `outHash` | Hash of the last scanned AI output; the retry guard. |
| `fired` | Trigger keys already counted this turn; the once-per-turn latch. |
| `over` | Player overrides parsed from the story card. |
| `msgPrev` | The last toast we wrote, for cooperative `state.message` use. |
| `msgOpen` | Whether a flush already happened this generation, so a later hook adds to the message instead of replacing it. |
| `cardOK` `warned` `cfgWarned` `pendingStop` | Small flags. |

> **A toast cannot contain a line break.** The client collapses whitespace, so a newline renders as
> a space and `padEnd` padding disappears entirely. A markdown hard break (two trailing spaces) was
> tried in a live game and did not work either. Rows are therefore separated by a visible marker,
> `RM_CONFIG.toastSeparator`, and joined internally with U+00A0 so a wrap lands between rows rather
> than inside one. Without that last part a bar, being a single unbreakable token, wraps on its own
> and strands its icon and label on the line above. If you find a break that does work in your
> client, put it in `toastSeparator`.

`state` is **JSON-serialised between turns**, so it holds plain data only. Compiled regexes live in
the Library and are rebuilt each hook, never stored.

`hydrate()` validates every field on the way in and falls back to a default for anything missing or
of the wrong type. That is what lets you edit `RM_CONFIG` **mid-adventure** without corrupting a
run in progress.

### The resource model

```js
{
  id: "o2", label: "Oxygen", icon: "🫁",
  min: 0, max: 100, start: 100,
  perTurn: -1.3,
  bands: [ ... ],
  triggers: [ ... ],
}
```

**Drift** (`perTurn`) is applied once per advanced turn. Negative drains, positive accumulates.
Radiation with `perTurn: +0.2` is a dose meter that only climbs.

**Bands** convert a number into a narrative state. The **first band whose `upTo` is at least the
current value wins**, read low to high. `tell` is the sentence handed to the AI; leave it `""` for
the normal band so nothing is injected while things are fine.

**Triggers** react to what the text says. Each has `on` (`"input"` / `"output"` / `"both"`), a word
list, and a `delta`.

Values are always clamped to `[min, max]`. `min` does **not** have to be zero: the deep-space config
gives Thermal `min: 15` because a crewed ship has an ambient floor.

### How a word list becomes a pattern

You never write a regular expression. At load, each trigger is compiled once:

1. Every word is escaped, so `"c++"` and `"o2 tank"` are safe.
2. A trailing `*` becomes `\w*`, so `"loot*"` becomes `loot\w*`.
3. The alternatives are joined and wrapped: `(?:^|\W)(?:loot\w*|reward\w*)(?!\w)`, case-insensitive.

The boundary form is deliberate. `\b` is **not** used because it needs a word character to sit
against, which breaks entries ending in punctuation like `"c++"`. The leading `(?:^|\W)` consumes one
character, which is harmless for a boolean test, and avoids depending on lookbehind support.

The result: `"rest"` fires on *"you rest"* but not on *restaurant*, *restore* or *arrest*.

### Negated clauses do not fire

A word list only asks whether a word is present, which meant every preset paid out for declining:
*"you do not eat"* fed the character and *"you don't drink"* watered them. A trigger word sitting
in a negated clause is now ignored.

A negator (`not`, `n't`, `never`, `cannot`, `refuse`, `decline`, `avoid`, `without`, `instead of`, `rather than`, `unable to`, `fail to`, `decide against`)
only reaches back to the last clause break,
so *"It was not a good day. You eat."* still feeds you, and every occurrence is checked, so *"you do
not eat the berries, then you eat the fish"* does too.

A comma counts as a break. That mis-reads a negated list, *"you do not eat, drink, or rest"*, where
the later items should stay suppressed. It is the better default anyway: getting a comma wrong means
firing, which is what the framework did before the guard existed, while leaving the comma out means
silently withholding a payout the player earned.

Bare `no` and `none` are deliberately not negators. They negate as often as not, but they also appear
in *"no choice but to eat"*. Set `negationGuard: false` for the old behaviour.

### Firing rules

A trigger fires **at most once per turn**, even if its word appears in both the player's action and
the AI's narration. *"You weld the plate"* followed by *"You weld it down"* is one weld.

The latch is `state.RM.fired`, keyed `resourceId#triggerIndex`. It is cleared at the **start of the
Input hook** and again at the **end of the Output hook**, so it spans exactly one turn and behaves
correctly on Continue actions, which have no Input hook.

**Retries reuse the cached model output.** The Output hook hashes the text it receives (FNV-1a) and
skips scanning entirely if the hash matches the previous turn's. Otherwise every retry would apply
the same damage again.

### Detecting that a turn advanced

There is no "the turn advanced" API, and `info.actionCount` is not a clean counter. It increments
**twice** on a Do/Say/Story turn, **once** on a Continue, has been observed to **decrement** on a
Retry, and has been reported **negative** in production.

So the framework cross-references two clocks:

```js
const hl = history.length;
const ac = Math.abs(info.actionCount);

if (Math.abs(hl - ac) < 2) {
  // The two agree, so history has not been truncated. Trust it.
  // A retry regenerates without growing history, so this is retry-safe.
  if (hl > s.hlen) { s.hlen = hl; return true; }
  return false;
}
// history has been truncated by the platform; fall back to the action counter.
return ac > s.turn;
```

### Layered configuration

Four layers, each overriding the one before:

```text
framework defaults  ->  RM_PRESETS[preset]  ->  RM_CONFIG.resources  ->  ⚙️ Living Meters card
   (min 0, max 100)      (ships in the box)        (the creator)         (the player, in-game)
```

Presets and `RM_CONFIG.resources` are merged by `id`, so reusing an id **tweaks** a preset resource
and a new id **adds** one. Player overrides are re-read from the card on every hook, so an edit takes
effect on the next turn without restarting.

`difficulty` multiplies **losses only** (`easy` 0.5x, `normal` 1x, `hard` 1.75x), so a hard run
drains faster but does not hand out bigger rewards. Direct `/commands` bypass the multiplier.

### How the AI is told

| `inject` | Mechanism | Trade-off |
| --- | --- | --- |
| `"context"` | Appends the block in `onModelContext` and re-truncates to `info.maxChars` | Accurate and current, but **silently ignored** on Optimized Context models |
| `"frontMemory"` | Writes `state.memory.frontMemory` | Survives Optimized Context; lags one turn |
| `"none"` | Nothing | Track only |

The block itself is assembled from every visible resource plus the `tell` of whichever band each is
currently in:

```text
[Ship and crew status: Hull 86/100 (sound), Oxygen 32/100 (thin), Radiation 47/100 (sick).
 The air is thin and stale. The character tires quickly and has a persistent headache.
 Radiation sickness has set in: vomiting, hair loss, bruising under the skin.
 Reflect this in the narration through behaviour and sensation; never state the numbers themselves.]
```

It is deliberately written in **complete bracketed sentences**. An unterminated fragment in
`frontMemory` invites the model to finish it.

### The player story card

One card, two halves, opposite owners:

| Field | Owner | Contents |
| --- | --- | --- |
| **NOTES** (`description`) | the player | Settings. The framework only ever reads it. |
| **ENTRY** (`entry`) | the framework | A live dashboard, rewritten each turn. |
| **TRIGGERS** (`keys`) | nobody | `%RM%`, a sentinel that cannot occur in normal prose. |

Because the trigger never matches, the card is **never injected into the AI's context**. It is pure
UI, and neither half reaches the model.

Creating it takes a workaround: `addStoryCard` returns the new array **length**, not a reference, and
cannot set `description` at all. So the framework adds a card with a sentinel title, scans
`storyCards` for that title to obtain a real object reference, and mutates all five fields in place.

If the Memory Bank is off, card writes fail. The framework detects that, warns the player once, sets
`cardOK = false`, and carries on. Everything except the card keeps working.

### Commands and the halt

AI Dungeon has no clean "handle this without calling the AI" path, and returning `stop` from the
Input hook throws a player-visible error. So a command is split across two hooks:

1. **Input** parses it, applies it, queues the result as a toast, and sets `pendingStop`.
2. **Context** sees `pendingStop`, returns `stop: true`, and clears the flag. It is a one-shot halt
   that returns *before* the tick, so a command turn does not advance resource drift.

The cost is the *"Sorry, the AI is stumped"* banner. Set `haltOnCommand: false` to let commands fall
through to the AI instead: no banner, but it costs one generation.

### Failure containment

Every hook body is wrapped in `try/catch`. On an exception the framework logs (when `debug: true`)
and still returns valid text, so a script bug degrades the run rather than breaking the adventure.

The Output hook never returns an empty string, which AI Dungeon treats as a hard error.

Toasts are buffered during a hook and flushed once, and `state.message` is only overwritten if it
still holds what *we* last put there, so another installed script's toast is never clobbered.

---

## Configuring for the scenario creator

Everything lives in `RM_CONFIG` at the top of `library.js`.

### Pick a preset

```js
preset: "survival",   // "survival" | "fantasy" | "scifi" | "noir" | "mechanic" | "none"
```

| Preset | Resources |
| --- | --- |
| `survival` | Health, Food, Water, Warmth |
| `fantasy` | Health, Mana, Coin |
| `scifi` | Integrity, Oxygen, Power |
| `noir` | Condition, Heat, Leads |
| `mechanic` | Engine, Diesel, Coolant, Tires, Brakes, Drive Time, Alertness, Settlement |
| `none` | nothing; define your own |

Preview one without committing: `node playthrough.js 40 --preset noir`.

**`mechanic` is the worked example of interlocking.** It was written for long-haul trucking
but fits anything where the vehicle is a character. The other presets are mostly independent
meters; this one is deliberately not. Climbing a grade burns diesel *and* raises coolant temp.
Coming down the far side costs brakes, and standing on the service brakes instead of gearing
down costs three times as much. Repairs cost money you only earn by delivering, and delivering
costs the legal drive time you only get back by stopping for the night. Two details in it are
worth copying: `temp` is inverted with a `min` of **160**, because a gauge in degrees has a
floor that is not zero, and `hos` runs 0 to 11 because a legal day is eleven hours, not a
percentage.

### Add or override resources

`RM_CONFIG.resources` is merged **over** the preset, matched by `id`. Reuse an id to tweak it; use a
new id to add one.

```js
resources: [
  // retune a preset resource; everything else about it is inherited
  { id: "thirst", perTurn: -4 },

  // add a new one
  {
    id: "ammo", label: "Ammo", icon: "🔫",
    min: 0, max: 12, start: 12, perTurn: 0,
    bands: [
      { upTo: 0,  name: "empty", tell: "The character's weapon is empty. They cannot shoot." },
      { upTo: 3,  name: "low",   tell: "The character is nearly out of ammunition and knows it." },
      { upTo: 12, name: "ok",    tell: "" }
    ],
    triggers: [
      { on: "output", words: ["fire", "fires", "fired", "shot", "shoot*"], delta: -1 },
      { on: "both",   words: ["reload*", "magazine", "ammo box"], delta: 12 }
    ]
  }
]
```

### Writing triggers

Trigger words are **plain text; you never write a regular expression**.

| You write | It matches |
| --- | --- |
| `"coin"` | the whole word `coin` only |
| `"loot*"` | `loot`, `looted`, `looting`, `looter` |
| `"dead body"` | the phrase, as written |
| `"c++"` | punctuation is fine; it is escaped for you |

Matching is case-insensitive and respects word boundaries, so `"rest"` will **not** fire on
*restaurant* or *arrest*. Add the `*` yourself when you want word endings to count. This is the one
place a hand-written pattern is easy to get subtly wrong: `/\brest\w*\b/i` looks correct and quietly
matches *restore*, *restless* and *restaurant*.

**One event, several resources.** There is no cross-resource syntax; declare the same words on each
resource the event should touch. This is how repairs cost parts and the reactor costs heat:

```js
{ id: "hull",  triggers: [{ on: "both", words: ["weld*"], delta:  20 }] },
{ id: "parts", triggers: [{ on: "both", words: ["weld*"], delta:  -6 }] },

{ id: "power", triggers: [{ on: "both", words: ["reactor"], delta: 34 }] },
{ id: "heat",  triggers: [{ on: "both", words: ["reactor"], delta: 13 }] },
{ id: "rads",  triggers: [{ on: "both", words: ["reactor"], delta:  5 }] },
```

**Watch for words that contain other words.** A positive `"recycler"` and a negative
`"recycler failure"` on the same resource cancel each other out, because text matching the second
also matches the first. `test-harness.js` catches this class of mistake automatically.

If you genuinely want your own pattern, `match: /.../i` works as an escape hatch, but it must be a
real RegExp, not a string.

### Bad config is reported, not swallowed

A trigger that never fires is very hard to notice. Every problem found at load (a `match` written as
a string, missing `words`, a missing or zero `delta`, an inverted `min`/`max`) is shown once as a
toast and written to the Console Log:

```text
Living Meters, check your config:
• ammo trigger #1: "match" must be a regular expression like /word/i, not a string. Use words: ["word"] instead.
• ammo trigger #2: needs a non-zero numeric "delta".
```

The rest of the script keeps running; only the broken trigger is skipped.

### The rest of the options

| Option | Default | What it does |
| --- | --- | --- |
| `inject` | `"context"` | How the AI is told: `"context"` \| `"frontMemory"` \| `"none"` |
| `injectLabel` | `"Character status"` | Prefix inside the injected bracket |
| `announceBandChanges` | `true` | Toast the player when something crosses into a new band |
| `statusEvery` | `0` | Toast the full status every N turns; `0` disables |
| `playerCard` | `true` | Maintain the settings and status story card |
| `playerCardTitle` | `"⚙️ Living Meters"` | The card's name |
| `commandPrefix` | `"/"` | Change if it collides with another script |
| `haltOnCommand` | `true` | Stop the AI when a command runs; see the banner note below |
| `scanInput` / `scanOutput` | `true` | Which text triggers are matched against |
| `difficulty` | `"normal"` | `easy` 0.5x \| `normal` 1x \| `hard` 1.75x on **losses only** |
| `debug` | `false` | Diagnostics to the Console Log panel |

---

## Configuring for the player

The script maintains a story card called **⚙️ Living Meters**. Its **NOTES** field is the settings panel;
its **ENTRY** field is a live read-only dashboard. Neither is ever shown to the AI.

Players edit NOTES with plain lines, or use `/set` and never open the card at all:

```text
difficulty = hard
thirst.perTurn = -4
hp.max = 120
warmth.off
```

| Form | Effect |
| --- | --- |
| `difficulty = easy\|normal\|hard` | Scales every loss |
| `statusEvery = 5` | Show the full status block every N turns, `0` to disable |
| `<id>.perTurn = -3` | Change the per-turn drift |
| `<id>.max = 150` / `<id>.min = 0` | Move the ceiling or floor |
| `<id>.start = 60` | The value `/reset` restores |
| `<id>.visible = off` | Track it, but hide it from the AI and the dashboard |
| `<id>.off` / `<id>.on` | Stop or resume tracking entirely |

`#` starts a comment, and a malformed value falls back to the creator's setting rather than
breaking the run.

A line whose key is not in that table is **reported to the player once**, naming the key. Silence
would be worse: the parser accepts any `key = value`, so a case slip like `hp.perturn` would
otherwise sit in the card being ignored while the player waited for it to do something. Fix the line
and the warning stops; make a different mistake and it raises a fresh one.

`/set` writes to that same card rather than to `state`, which is not an implementation detail worth
hiding: `syncCard()` re-parses the card on every hook and replaces the override map, so a command
that only wrote state would be erased inside the same turn. Keeping the card authoritative means
`/set` and hand-editing cannot disagree, and the player can always see what they changed.

> Adding a setting to that table is **two** edits, not one. Put the key in `OVER_GLOBALS` or
> `OVER_FIELDS` so it passes validation, **and** read it through `optNum` at the point of use. Miss
> the second and the value is parsed, stored, reported as valid, and never read.

### Commands

| Command | Effect |
| --- | --- |
| `/status` | Show every tracked resource |
| `/hp` | Query one resource |
| `/hp +10` `/hp -5` `/hp =80` | Adjust it (ignores difficulty scaling) |
| `/set <key> <value>` | Change a setting without opening the card |
| `/set` | List what you have changed |
| `/reset` | Restore starting values, including a `start` set in the card |
| `/help` | List the commands |

---

## Things worth knowing before you ship

**`inject: "context"` silently does nothing on Optimized Context models.** On cache-efficient models
(Atlas, Raven, and anything with *Optimized Context* switched on) the platform runs the context hook
but **ignores its return value**. Everything still tracks correctly; the AI just never hears about
it. If your players use those models, switch to `inject: "frontMemory"`.

**Commands show an error banner.** See [Commands and the halt](#commands-and-the-halt).

**Story cards need the Memory Bank on.** With it off, card writes fail silently. The script detects
this, warns once, and carries on without the settings card.

**Triggers are keyword matching, not comprehension.** `"drink"` fires on *"you drink"* and on *"you
would never drink that"*. Keep words specific, keep deltas modest, and let per-turn drift do most of
the work.

**Composing with other scripts.** Keep exactly one `const modifier` per tab and add other scripts'
calls beside the `RM.*` line. Everything here is namespaced under `RM`, `RM_CONFIG` and `RM_PRESETS`.

---

## Using it from your own script

```js
RM.get("hp")            // 72
RM.set("hp", 100)       // { id, before, after, def }
RM.add("coin", -15)     // ignores difficulty scaling
RM.all()                // { hp: 72, hunger: 40, ... }
RM.status()             // the dashboard block
RM.line()               // one-line summary
RM.directive()          // exactly what the AI is being told this turn
RM.defs()               // effective definitions after player overrides (JSON-safe)
RM.problems()           // config problems found at load
RM.toast("Skill +1")    // queue a toast through RM's buffer
```

**Use `RM.toast()` rather than assigning `state.message` yourself.** `state.message` is one global
slot with no ownership protocol, so the framework only overwrites what it recognises as its own and
yields otherwise. That politeness has a cost for you: assign the slot directly and the framework
steps aside, taking any band announcement on that turn with it. Because the band is already recorded
as announced, it never comes back. `RM.toast()` puts your line in the same buffer, so both are
flushed together. Call it before `RM.input` / `RM.context` in the same hook.

`RM.defs()` and `RM.problems()` are what make both development tools config-driven.

---

## Development tools

Both are plain Node scripts. **Node 18+**, no dependencies, no install step.

```bash
cd "path/to/AID ResourceManager"
node test-harness.js
node playthrough.js
```

Neither is pasted into AI Dungeon. Both read `library.js`, `input.js`, `context.js` and `output.js`
straight off disk, so they always test **exactly** what you would paste in.

### No install: run either tool in your browser

**<https://oratorian.github.io/living-meters/>**

Paste your `library.js` and press **Run tuning** or **Run tests**. It loads the shipped config for
you, and nothing is uploaded anywhere; the whole thing executes in your tab.

It runs each hook in a throwaway `<iframe>`, whose `contentWindow` is a genuinely fresh global. That
is the closest a browser gets to AI Dungeon's fresh isolate per hook, and it means `const RM_CONFIG`
cannot collide between runs.

**Both tools are there.** *Run tuning* gives you the simulated run and tuning report. *Run tests*
gives you the full correctness suite, the same 65 checks `node test-harness.js` runs.

**Hook tabs.** The page runs the three hook tabs too, and defaults them to the stock ones. If your
`library.js` is more than the framework, if it adds a system of its own beside `RM`, that system
needs calling from the tabs or the sandbox runs without it and the report describes a scenario
nobody is playing. Open the **Hook tabs** panel under the report and add the calls; edits persist in
your browser, and *Reset to the stock tabs* puts them back. You do not have to remember to check: if
the pasted `library.js` defines something no tab calls, the run says so at the top of the report.

The CLI tools never needed this. They read your actual `input.js`, `context.js` and `output.js` off
disk, so whatever you installed is what they run.

Nothing is duplicated to make that work. `docs/engine.js` holds the scheduling and analysis, and
`docs/tests.js` holds every assertion. The browser page and the two CLI scripts all import them, so
they cannot drift apart and report different things about the same config. The only difference is
how a hook is sandboxed: a Node `vm` context on the command line, a throwaway iframe in the page.

The test suite makes around **370 sandbox runs**, which means 370 iframes, so it takes a few seconds
and the tab is busy while it works. The CLI is faster if you have Node. The page asserts a looser
per-hook time budget (1500 ms rather than 500 ms) because standing up an iframe costs more than
entering a `vm` context.

### How they fake the sandbox

Both build the same simulation, because a shortcut here would hide the bugs that matter:

| Real AI Dungeon | What the tools do |
| --- | --- |
| Each hook runs in a fresh V8 isolate | `vm.createContext()` per hook, from a fresh object |
| Library is prepended to the hook script | `library.js + "\n\n" + input.js` before every run |
| `state` is JSON-serialised between turns | `JSON.parse(JSON.stringify(state))` between **every** hook |
| 2-second execution timeout | `{ timeout: 2000 }` |
| `addStoryCard` takes 6 args, returns the new **length** | Implemented to that contract, with string ids |
| No Node globals in the sandbox | Only `text stop state storyCards history info memory log console` plus the card functions |

The JSON round-trip is the important one. It is stricter than the platform (which only serialises
between turns, not between hooks) and it is what catches *"I stored a RegExp, Map or function in
`state`"*, a bug that otherwise appears a turn later, in someone's live adventure.

Stack traces are labelled `<isolated-vm>`, matching the real engine.

---

### test-harness.js: is the framework correct?

```bash
node test-harness.js          # exit code 0 = all passed, 1 = something failed
```

Run it after **any** edit to `library.js`. It takes about a second.

It is **config-driven**: it calls `RM.defs()` first and then tests whatever you have configured. It
does not know or care that the shipped config is a space scenario. Swap in a fantasy set and the
same assertions still apply, now phrased in terms of your resources.

```text
=== Living Meters harness ===
configured: 12 resources: hull, power, fuel, heat, o2, food, water, hp, rads, morale, parts, credits

0. config
  ok   config has no problems
  ...
=== 65 passed, 0 failed ===
```

**What each section covers:**

| Section | What it proves |
| --- | --- |
| 0. config | No load-time problems; every resource has a label, starts in range, and has bands covering its max |
| 1. cold start | State initialises, every resource appears, the player card is created with a sentinel key, the status block reaches the context |
| 2. per-turn drift | A draining resource drops by **exactly** `perTurn`, so no double-tick; an accumulating one climbs; a `perTurn: 0` one does not move |
| 3. trigger coverage | **Every configured trigger** fires in the direction its `delta` says, plus the once-per-turn rule for `on: "both"` |
| 4. retry safety | Re-running Output with identical text does not re-apply the damage |
| 5. commands | A command toasts, applies, halts in the Context hook, and the halt is one-shot; `/status` lists every visible resource |
| 6. player overrides | A card edit changes drift and difficulty; a disabled resource stops drifting and vanishes from the AI's block |
| 7. clamping and bands | Values clamp at `min` and `max`; the worst band's `tell` actually reaches the AI |
| 8. state hygiene | State survives a JSON round-trip, stays small, and contains no compiled patterns |
| 9. degraded mode | With `addStoryCard` throwing (Memory Bank off), the turn still completes and the player is warned |
| 10. presets | All six presets load and track the expected number of resources |
| 11. trigger word lists | `word*` suffixes, whole-word boundaries, phrases, escaped punctuation, and every config-error message |
| 12. performance | 25 turns of realistic load stay far under the 2-second budget and the state stays small |

**Section 3 is the one that pays for itself.** For every trigger it runs a *control* turn and a
*treatment* turn from a clean slate, seeding the resource to its midpoint first so a gain is not
clamped away at the ceiling, then compares. Per-turn drift cancels out of the comparison. This is
what catches:

- a word that never matches because of a typo
- a positive and negative trigger on the same resource that **cancel each other out** because one
  word contains the other (`"recycler"` versus `"recycler failure"`)
- a trigger that fires twice because its word appears in both the action and the narration

Section 11 builds **synthetic one-meter configs in memory** and runs the real hooks against them,
which is how it can assert on error messages without touching your `library.js`.

The assertions live in `docs/tests.js`, so the same 65 checks run from the
[browser page](#try-it-in-your-browser) with no Node at all.

---

### playthrough.js: is my scenario tuned?

```bash
node playthrough.js                    # 30 turns, deterministic
node playthrough.js 120                # longer run, reaches the late bands
node playthrough.js --quiet            # tuning report only, no per-turn detail
node playthrough.js 30 --seed 7        # shuffle the event order
node playthrough.js 40 --preset noir   # preview a built-in preset on its own
```

| Flag | Effect |
| --- | --- |
| *(a bare number)* | Turn count. Default 30. |
| `--quiet` | Skip the per-turn log; print only the final state, tuning report and runtime |
| `--seed N` | Reshuffle the event order. Without it the run is identical every time |
| `--preset <name>` | Preview a built-in preset **on its own**, ignoring `RM_CONFIG.resources`. Rewrites the source in memory; `library.js` is never modified |

`test-harness.js` proves the framework works. This one asks whether **your numbers** work, and it
builds the whole run from your config, so you never edit this file.

#### How the run is synthesised

1. **Read the config.** `RM.defs()` yields every enabled resource, its drift, its bands, and every
   trigger with the original word list.
2. **Turn each trigger into an event.** Per resource, losses are interleaved *before* gains, because
   a gain tested at full health is clamped away and looks broken.
3. **Round-robin across resources**, so no single resource gets hammered while the others idle.
4. **Lay out the turns.** Turn 1, the final turn, and every sixth turn are left **quiet**, so
   per-turn drift is observable on its own. The rest get one event; every third busy turn gets a
   **second event on a different resource**, which is how interlocking configs reveal themselves.
5. **Render text.** The trigger word is dropped into a bland carrier sentence, such as *"There is
   canteen to deal with now."* Prose quality is not the point; placing the word in scannable text is.
   `on: "input"` words go in the player's action, everything else in the narration.
6. **Run it** through the real Input, Context and Output hooks, with full state persistence.

#### Reading the per-turn log

```text
Turn  5  ▸ You deal with the weld.
        ◂ And then: hull breach.
   🛡️ Hull           64.0 →    84.0  ▲20.0     <- coloured: a trigger fired
   🫁 Oxygen         72.8 →    71.5  ▼1.3      <- grey: ordinary per-turn drift
   🔩 Spare Parts    22.0 →    16.0  ▼6.0
   ⚠  Thermal: cool -> warm                    <- a band crossing
```

Every tenth turn it prints the **exact text handed to the AI**, so you can read the directive the
model will actually receive.

#### Reading the tuning report

```text
  🫁 Oxygen       -1.3/turn → floor in ~77 turns    bands 4/4
  🌡️ Thermal      -0.8/turn → floor in ~17 turns    bands 2/3
  🪙 Credits      no drift, triggers only           bands 1/2
```

- **The projection** is how many turns drift alone needs to exhaust the resource from its starting
  value. `Oxygen -1.3/turn, floor in ~77 turns` tells you when the crisis arrives if nobody
  intervenes.
- **Band coverage** is how many distinct bands were actually entered. `bands 1/4` means three of your
  `tell` instructions were **never sent to the AI** during the run.

Then the warnings:

| Warning | Means |
| --- | --- |
| *spent N% of the run on its floor* | Bottoms out and stays there. Fine for a spike-and-decay resource; otherwise raise `start`, soften `perTurn`, or add a recovery trigger |
| *spent N% at its ceiling* | Under no real pressure, and gains are being clamped away |
| *has triggers but none changed it* | The words are wrong, or it is pinned at a limit |
| *no triggers and no drift* | Nothing can ever change it |
| *bands stop at N but max is M* | Values above N fall back to the last band |

And, as information rather than a fault, the list of bands not reached, because a 30-turn run simply
may not get there. Try `node playthrough.js 120` to find out whether they are reachable **at all**.

Finally the runtime block: worst hook time against the 2000 ms budget, state size in characters, the
story card that was created, and how many toasts fired.

#### A worked example

The shipped deep-space config looks fine at 30 turns. At 120:

```text
  🫁 Oxygen       -1.3/turn → floor in ~77 turns    bands 4/4

  1 thing(s) worth looking at:
   • Oxygen spent 39% of the run on its floor (0). ...

  Bands not reached in 120 turns: Hull 1/4, Condition 1/4, ...
```

Two real findings. Oxygen's recovery triggers cannot keep up with its drain over a long adventure.
And Hull and Condition never left their healthy band, so three-quarters of the narrative instructions
written for them have never once been given to the model.

---

### Which tool, when

| You just... | Run |
| --- | --- |
| edited framework code in `library.js` | `node test-harness.js` |
| added or changed a resource, trigger or band | both, harness first |
| changed `perTurn`, `start`, `min`/`max`, or band thresholds | `node playthrough.js --quiet` |
| want to know if a long adventure holds up | `node playthrough.js 150 --quiet` |
| are choosing a preset to start from | `node playthrough.js 40 --preset fantasy` |
| are about to publish | both, then a real playtest |

Neither replaces playing the scenario. They replace the *first twenty* playtests.

---

## Files

| File | Purpose |
| --- | --- |
| `library.js` | Config, presets, and the whole framework. Paste into the **Library** tab |
| `input.js` `context.js` `output.js` | Thin hook adapters. Paste into the matching tabs |
| `test-harness.js` | Correctness tests. Config-driven, so it keeps working when you rewrite `RM_CONFIG` |
| `playthrough.js` | Tuning tool. Builds a run from your config |
| `docs/engine.js` | Scheduling and analysis, shared by the CLI and the browser page |
| `docs/tests.js` | Every correctness assertion, shared by `test-harness.js` and the page |
| `docs/index.html` | The browser version, served at the GitHub Pages link above |
| `README.md` | This file |
| `LICENSE` | MIT |

Only `library.js` and the three hook files go into AI Dungeon.

---

## License

License. [MIT](LICENSE)

Use it, change it, ship it in your own scenario, bundle it inside your own script, sell the result.
Keeping the copyright notice is the only condition.
