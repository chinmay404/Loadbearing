# 06 — Screen: The checkpoint

**Chapter boss. The real product with the training wheels still on.**

## Job

Prove the chapter's five micro-steps combine into a design. This is where a learner first sees
a full brief, a full canvas and a real scenario — so the screen's job is to make the step up
feel earned rather than sudden.

## What is different from a micro-step

| | Micro-step | Checkpoint |
| --- | --- | --- |
| Duration | 2–5 min | 15–20 min |
| Canvas | pre-drawn, one gap | starts with a partial system, several gaps |
| Brief | two sentences | full problem brief: functional list, numbers, constraints |
| Palette | 4 components | this chapter's + everything already learned (~10–20) |
| **Flow** | implicit | **pre-declared, shown read-only** |
| Findings | max 3, declared | whatever the engine emits |
| Gate | one | one or two, plus a component-kill scenario |
| Reward | XP + next step | chapter complete + a level unlocks in the full bank |

## The flow strip — the most important new element

A beginner has no concept of a "flow" (one request's journey through the system), and the
simulator's numbers depend on it. So on a checkpoint the flow is **given**, displayed as a
read-only horizontal strip above the canvas:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ FLOW · product browse · read · 900 rps baseline                          │
│  Client ─▶ CDN ─▶ Load Balancer ─▶ API ─▶ ? ─▶ Postgres                  │
│                                            ▲ this step is not in your    │
│                                              drawing yet                 │
└──────────────────────────────────────────────────────────────────────────┘
```

- Each hop is a chip. Hops present in the drawing take `--pass` text; hops missing take
  `--fail` and a caption. This turns "declare your flows" — the hardest concept in the product
  — into a checklist.
- 40px tall, `--ink-2`, mono chips, sits between header and canvas.
- On the *unscaffolded* product this strip becomes editable. Here it is read-only, and a small
  `--pencil` note says so: *"On real sheets you write this yourself."* Foreshadowing.

## Layout — desktop 1440

Same two-pane structure as the micro-step so the learner is not relearning the interface, plus
the flow strip, plus a brief that now needs room.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← Chapter 2 · Checkpoint          Two of everything            ▲4  340 XP     │ 44
├───────────────────────────────────────────────────────────────────────────────┤
│ FLOW · product browse · read · 900 rps    Client ▶ CDN ▶ LB ▶ API ▶ Postgres  │ 40
├──────────────────────────────────────────────┬────────────────────────────────┤
│                                              │ THE PROBLEM              [▾]   │
│           the canvas, wider                  │ One VM runs the storefront…    │
│           several gaps                       │                                │
│                                              │ MUST DO                        │
│                                              │ · Browse products              │
│                                              │ · Place an order               │
│                                              │ · Serve product images         │
│                                              │                                │
│                                              │ THE NUMBERS                    │
│                                              │ peak        900 rps            │
│                                              │ writes       25 rps            │
│                                              │ p99         300 ms             │
│                                              │ images   1.2 TB/mo             │
│                                              │                                │
│                                              │ CONSTRAINTS                    │
│                                              │ · No application rewrite       │
│                                              │ · Two engineers                │
│                                              │ · $180 → $900/month            │
│                                              │ ─────────────────────────────  │
│                                              │ COMPONENTS         [search]    │
│                                              │ (grouped, ~14 available)       │
│                                              │ ─────────────────────────────  │
│                                              │ WHAT'S WRONG (4)               │
├──────────────────────────────────────────────┴────────────────────────────────┤
│ [ RUN ]  ⬢ TV spot — FAIL 34% dropped   ⬡ Box reboots — not run   $412/$900   │ 64
└───────────────────────────────────────────────────────────────────────────────┘
```

## Panel changes

- **The problem** is collapsible (`[▾]`), open by default, so the panel can become mostly
  palette once the learner has read it.
- **The numbers** is a two-column mono table — label `--graphite`, value `--chalk`. This is a
  learner's first exposure to non-functional requirements as *quantities*, so it gets its own
  block rather than being buried in prose.
- **Constraints** as a bulleted list, `--load` bullet glyphs — they are the things that make
  the problem hard, and should read as friction.
- **Components** gains a search field (foreshadowing `Ctrl+K` in the real product) and category
  grouping, because 14 cards need structure where 4 did not.

## Run bar changes

Two or three gate chips instead of one, laid out horizontally, each independently resolvable.
Budget moves into the run bar to make room in the panel. A learner should be able to see, in
one strip, every machine-checked thing standing between them and chapter complete.

## States

1. **Fresh** — several gaps, all gates not-run, flow strip showing missing hops in `--fail`.
2. **Partially correct** — one gate green, one red. Both chips visible simultaneously. This
   state matters: it teaches that designs are not binary.
3. **All gates green, budget exceeded** — cannot complete. The one place the checkpoint is
   stricter than a micro-step, because cost discipline is the chapter's real lesson.
4. **Complete** — full-width banner slides down from the flow strip: chapter name, *"chapter
   complete"*, and a second line in `--brass`: **"Level 1 of the full bank is now open."**
   Two buttons: *Next chapter* (filled) and *See what opened* (text).
5. **Returning to a cleared checkpoint** — everything as left, gates green, banner replaced by
   a quiet `--pass` line. Nothing re-awards.

## Do not

- Make the flow strip editable here. That is the graduation gift.
- Hide the numbers behind a tab. First contact with quantified requirements is the point.
- Award partial credit or a percentage. Gates are gates.
