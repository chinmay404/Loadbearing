# 05 — Screen: The micro-step

**The core loop. A learner sees this 35 times before graduating. If one screen is right, make
it this one.**

## Job

Two to five minutes: understand a one-line problem, place one component, watch the simulation
tell the truth, and get a green gate. Every pixel serves the moment the gate flips.

## Layout — desktop 1440

Two panes. No top nav (the header shrinks to a 44px strip so the canvas dominates), no left
sidebar, no bottom drawer other than the run bar.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← Ch.2 · Step 3 of 5   Two of everything          ▓▓▓░░ 340 XP   ▲4   [≡]    │ 44
├──────────────────────────────────────────────┬────────────────────────────────┤
│                                              │  Your API is one instance.     │
│                                              │  Traffic tripled this morning. │ brief
│    ┌────────┐      ┌────────┐                │                                │
│  ▌ │ Client │ ●●●▶ │  API   │ ●●▶ ┌────────┐ │  ─────────────────────────────  │
│    └────────┘      │ 94% ▓▓▓│     │Postgres│ │  BUDGET      $412 / $900      │ budget
│                    └────────┘     │ 31% ▓░░│ │  ▓▓▓▓▓░░░░░                   │
│                         ▲         └────────┘ │  ─────────────────────────────  │
│                    ┌ ─ ─ ─ ┐                 │  ADD                           │
│                    │   ?   │ ← dashed gap    │  ┌──────────────────────────┐  │
│                    └ ─ ─ ─ ┘                 │  │ ⬡ Load Balancer          │  │ palette
│                                              │  │ Spreads traffic over     │  │
│                                              │  │ healthy replicas…        │  │
│                                              │  └──────────────────────────┘  │
│                                              │  ┌──────────────────────────┐  │
│                                              │  │ ⬡ API (second replica)   │  │
│                                              │  └──────────────────────────┘  │
│                                              │  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│                                              │  ╎ ⬡ Cache      ch.3 🔒    ╎  │
│                                              │  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│                                              │  ─────────────────────────────  │
│                                              │  WHAT'S WRONG                  │
│                                              │  ● API carries "product browse" │ findings
│                                              │    on a single instance…  Why?  │
│                                              │  ⊘ ̶L̶B̶ ̶b̶a̶l̶a̶n̶c̶e̶s̶ ̶a̶c̶r̶o̶s̶s̶ ̶o̶n̶e̶…̶      │
├──────────────────────────────────────────────┴────────────────────────────────┤
│  [        RUN        ]   ⬢ Morning surge — FAIL · 34% dropped (max 1%)        │ 64
└───────────────────────────────────────────────────────────────────────────────┘
```

Canvas **70%**, panel **30%** (min 380px, max 460px). Run bar spans full width.

## The canvas — where the product is won

### Nodes

Rectangle, min 132×64, `--ink-3` fill, 1px `--rule` border, 2px radius. A **4px left edge bar**
in the component's category colour. Inside:

- Label, `--sheet-font` 13px `--chalk`.
- One line of `--mono` 11px `--graphite`: `2 × 500 rps`.
- A **4px utilisation bar** flush across the bottom inside the border, with `--mono` 11px
  percentage right-aligned above it.

The utilisation bar is the most important element on the screen. It is how arithmetic becomes
visible.

### Strain bands

Derived from the real latency formula `service ÷ (1 − utilisation)` — so the visual is the
physics, not a mood:

| Utilisation | Bar | Node |
| --- | --- | --- |
| `< 0.50` | `--pass` | calm |
| `0.50 – 0.70` | `--load` | calm |
| `0.70 – 0.85` | `--load` | border brightens to `--rule-2`, bar gains a 1px inner highlight |
| `0.85 – 1.00` | `--fail` | 0.4px jitter at 8Hz — barely perceptible, unmistakable |
| `≥ 1.00` | `--fail` | jitter continues + a `SHEDDING` chip, `--mono` 10px, `--fail` |

### Edges

1px `--rule-2`, with **animated dots**. Dot density is RPS; dot speed is inverse to the target's
service latency. Dashed for async, 30% opacity and reversed for replication.

**Dropped requests fall off the wire.** A dot detaches at the edge's 80% mark and arcs
downward, fading, with a 2px `--fail` trail. Show this in the mock — it is the single most
communicative element in the product and the thing a ten-second video is built around.

### The gap

A dashed `--rule-2` outline the size of a node, `--ink` fill, a 20px `--pencil` `?` centred.
Faint brass glow on the border, 1.5s ease-in-out breathing. This is the only idle animation
permitted anywhere in the product, and it exists because it is the call to action.

### Live connection warning

While dragging a wire, before the drop: hovering an invalid target turns the pending line
`--fail` dashed and fades in a one-line tooltip near the cursor at 120ms. Valid targets turn
the line `--pass`. **Deliver this as a state** — it is the "how did it know" moment, and it
already exists in the engine.

## The panel

Vertical stack, 14px padding, `--ink-2`, 1px `--rule` left border. Sections separated by 1px
`--rule` with 12px breathing room. Section labels: `--mono` 10px, 0.1em tracking, `--pencil`,
uppercase.

### Brief

Two sentences maximum, `--sheet-font` 15px `--chalk`, line-height 1.5. Written in second
person, present tense, no jargon un-glossed. This is the whole problem statement — a beginner
does not get a wall of requirements.

### Budget

Label + `--mono` 15px: spent in `--chalk`, ceiling in `--pencil`. A 6px bar, `--brass` on
`--brass-dim`. Over 80% the fill turns `--load`; over 100% `--fail` and the figure gets a
one-line note: *"Over budget — a cheaper shape exists."*

### Palette — 4 cards

Each card: `--ink-3`, 1px `--rule`, 10px padding, 2px radius. A 16px category-coloured glyph,
the name in 13px `--chalk`, and **the real one-line hint in 11.5px `--graphite`** (these are
already written — see [11-content-inventory.md](11-content-inventory.md)).

Locked cards: dashed border, 45% opacity, contents `--pencil`, and a `ch.3 🔒` marker. Keeping
them visible is deliberate — the learner sees the world is bigger than this step.

Hover: border `--rule-2`, fill `--ink-4`, cursor grab.

### Findings — "What's wrong"

The diagnostic engine's output, verbatim in its teaching voice. Each row:

- **Open**: 6px `--fail` dot, text 12px `--chalk`, then a `Why?` link in `--brass` 11.5px
  opening the concept card.
- **Resolved**: 6px `--pass` dot, text struck through and faded to 45%. **Row does not collapse
  or reorder** — the list holding still is what makes the strike-through legible.

Never more than three findings on a micro-step. If the engine emits more, show the three the
step declared and nothing else.

## The run bar, 64px

`--ink-2`, 1px `--rule` top.

- **RUN** — the only filled brass button on the screen. 220px × 40px, `--display` 15px, `--ink`
  text. After a first run it reads **RUN AGAIN**.
- **Gate chip** — pill, `--mono` 12px, 1px border, tinted fill at ~12% opacity.
  - not-run: `--pencil` border, `--graphite` text, `⬢ Morning surge — not run`
  - fail: `--fail`, `⬢ Morning surge — FAIL · 34% dropped (max 1%)`
  - pass: `--pass`, `⬢ Morning surge — PASS · 0.2% dropped (max 1%)`

The gate string always states **what happened and what was allowed**. Never a bare FAIL.

## States to deliver

1. **Fresh** — gap breathing, gate not-run, findings open, nothing placed.
2. **Dragging, invalid target** — red dashed pending line, tooltip visible.
3. **Placed, not yet run** — component in the gap, wired, gate still not-run, findings still open.
4. **Failed run** — saturated node jittering at 94%, dots falling off the wire, gate red,
   findings open, guilty node with a 1px `--fail` outline.
5. **Passed run** — all bars in band, gate `--pass`, findings struck through, XP counter
   mid-animation, next-step card sliding up from the bottom edge.
6. **Over budget** — budget bar `--fail`, note visible, everything else passing. Teaches that
   correct-but-wasteful is not finished.

State 5 is the money shot. If only one frame gets polish, polish that one.

## Mobile

Not required. Architecture drawing on a phone is not a real use case, and pretending otherwise
compromises the desktop design. If something is wanted for small screens, it is a read-only
recap of a completed step, not the editor.

## Do not

- Put the numbers in a panel instead of on the nodes. That is the current product's mistake and
  the whole reason for this redesign.
- Add a spinner to RUN. The computation is local and synchronous.
- Show a score, a grade, or a star rating. Pass or not-yet.
- Animate anything idle except the gap.
- Let the findings list reorder on resolve.
