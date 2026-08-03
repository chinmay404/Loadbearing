# 08 — Screen: The cockpit

**Advanced home. Replaces today's "Progress" page.**

## Job

The brief was *"complex problems shown in an easy way."* That does not mean simplifying the
problems — it means making a hard problem's **relevance obvious before it is opened**. An
advanced user should answer *"which one should I do next, and why"* in one glance, and never
face an undifferentiated list of 25 titles.

Today's Progress page is a report card: radar, trend, weakest, strongest, heatmap. All useful,
all backward-looking. The cockpit keeps the data and reframes it as *what to attack next*.

## Layout — desktop 1440

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Loadbearing    Sheets  Reference  Progress          [the ladder ↗]  [account] │ 56
├───────────────────────────────────────────────────────────────────────────────┤
│ ⟳ 3 concepts are due   [idempotency] [saga] [cdn]        [ Start today's drill]│ 64  due strip
├──────────────────────────────────────────────────────┬────────────────────────┤
│  All · Weak concepts · Not attempted · Labs · Mine   │  ┌──────────────────┐  │
│  ──────────────────────────────────────────────────  │  │ Review my system │  │
│                                                      │  ├──────────────────┤  │
│  LEVEL 1 ────────────────────────────── 4 of 4 done  │  │ Compose a sheet  │  │
│  ┌───────────────────┐ ┌───────────────────┐         │  └──────────────────┘  │
│  │ L1  e-commerce    │ │ L1  media         │         │                        │
│  │ Read-Heavy        │ │ User Image Upload │         │  MASTERY               │
│  │ Product Catalog   │ │ and Delivery      │         │      ╱╲                │
│  │ API               │ │                   │         │    ╱   ╲   radar,      │
│  │ [caching] [cdn]   │ │ [blob] [cdn]      │         │   ╲    ╱   8 groups    │
│  │ [capacity]        │ │ [capacity]        │         │     ╲╱                 │
│  │ best 84  ╱‾‾╲  ✓ᵗ │ │ best 71  ╱‾╲      │         │                        │
│  └───────────────────┘ └───────────────────┘         │  ALL 45 CONCEPTS       │
│                                                      │  ▪▪▫▪▪▪▫▫▪▪▪▫▪▪▫▪     │
│  LEVEL 2 ────────────────────────────── 1 of 4 done  │  ▪▫▪▪▫▫▪▪▪▫▪▪▪▫▫▪     │
│  ┌───────────────────┐ ┌───────────────────┐         │  ▫▪▪▫▪▪▪▫▪▫▪▪         │
│  │ L2  infrastructure│ │ L2  gaming        │  …      │                        │
│  │ URL Shortener     │ │ Realtime          │         │  ─────────────────────  │
│  │ at 50k RPS        │ │ Leaderboard       │         │  12 sheets · avg 78    │
│  │ [sharding] [hash] │ │ [sorted-set]      │         │  ▲ 4 day streak        │
│  │ not attempted     │ │ best 62  ╲╱‾      │         │                        │
│  └───────────────────┘ └───────────────────┘         │                        │
└──────────────────────────────────────────────────────┴────────────────────────┘
```

Main column fluid, rail fixed **300px**.

## Due strip, 64px

The spaced-repetition surface, and the highest-value element on the screen — it is the only
thing that tells a returning user what to do *today*.

`--ink-2`, 1px `--rule` top and bottom. A `⟳` glyph in `--brass`. Copy: *"3 concepts are due"*
in 13px `--chalk`, then the concept names as pills — `--brass-dim` fill, `--brass` 11.5px text,
1px `--brass` border at 40%. Right-aligned: **Start today's drill**, filled `--brass`, 36px.

Empty state (nothing overdue): the strip stays but goes quiet — `--pencil` text, *"Nothing due.
Next review in 4 days."* No button. Do not remove the strip; a disappearing region makes the
layout jump between visits.

## Filter row

Text tabs, not buttons: `All · Weak concepts · Not attempted · Labs · Mine`. Active tab
`--chalk` with a 2px `--brass` underline; rest `--graphite`. **Weak concepts** is the important
one — it filters the bank by the user's own mastery, and is the mechanism that makes 25 sheets
feel curated rather than listed.

## Problem cards

`--ink-2`, 1px `--rule`, 2px radius, 14px padding, 260px min width, responsive grid, 12px gap.
Every card answers "why this one?" before being clicked:

1. **Level badge + domain** — `--mono` 10px uppercase `--pencil`, e.g. `L2 · INFRASTRUCTURE`.
2. **Title** — `--display` 15px `--chalk`, two lines max.
3. **Concept chips** — up to three, `--ink-3` fill, `--graphite` 10.5px. A chip the user is
   *weak* on renders in `--load` — so a card visually advertises that it targets a gap. This
   single detail is most of "complex made approachable."
4. **Footer row** — `best 84` in `--mono` 12px, a 40×14px sparkline of attempts in `--brass`,
   and a small `✓ᵗ` marker in `--pass` if the twist round is done.

Card states: not attempted (footer reads `not attempted` in `--pencil`, no sparkline) · in
progress (a 2px `--brass` left edge) · attempted · mastered (footer score in `--pass`) ·
lab (a small `⌸` glyph by the level badge) · custom/mine (a `--plum` left edge).

Level group headers: `LEVEL 2` in `--mono` 11px `--pencil` with a 1px `--rule` line filling the
row and `1 of 4 done` right-aligned.

## Right rail, 300px

- **Two promoted buttons at the top**: *Review my system* and *Compose a sheet*. Outlined, not
  filled — `--brass` border and text on `--ink-2`. These are the professional features currently
  buried three clicks deep and the likeliest source of revenue; on this screen they sit above
  everything analytical.
- **Mastery radar** — the existing 8-group SVG radar, unchanged in substance.
  Groups: Traffic & Edge, Scaling & Data, Consistency & Transactions, Async & Messaging,
  Reliability, Security, Operations & Cost, AI Systems.
- **All 45 concepts heatmap** — the existing dense tile grid. Brightness = strength, hollow =
  never assessed. Clicking a tile filters the bank to sheets covering that concept, which is
  what turns the heatmap from a report into a control.
- **Footer stats** — sheets attempted, average score, day streak. Quiet, `--mono`, `--graphite`.

## States

1. **Cold start** (signed up as experienced, zero attempts). Grid full and inviting; every card
   reads `not attempted`. Rail's radar and heatmap are empty outlines with one line: *"Submit a
   design and this fills in."* Due strip absent (nothing can be due). A single `--brass` hint
   above the grid: *"Level 1 is a good place to start."*
2. **Warm** — as drawn.
3. **Filtered to weak concepts** — group headers still shown, cards reduced, and a count line:
   *"9 sheets touch your 5 weakest concepts."*
4. **Everything mastered** — every card `--pass`. The rail promotes *Compose a sheet* and
   *Review my system* to the top of visual weight, because generated and real-world work is
   what remains.

## Do not

- Show the bank as a table or list. The card grid is what makes concept chips and sparklines
  possible, and those are the whole point.
- Lead with the radar. It is context, not the action.
- Hide *Review my system* in a menu.
- Use `--fail` for a weak concept chip. Weak is an opportunity — `--load`. `--fail` is reserved
  for things that are actually broken.
