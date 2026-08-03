# 01 — Product brief

## What Loadbearing is

You are given a hard, realistic engineering problem — "read-heavy product catalogue API,
900 rps, $900/month, two engineers, one of whom has never run a database failover" — and you
draw the architecture on a canvas. Then a **deterministic simulator** pushes traffic through
your drawing and tells you the truth: which component saturates, what your p99 becomes,
how much traffic you drop, what it costs per month. Kill a component and watch the traffic
re-route or fail. Only after that does a language model review your design against a cited
corpus of documented practice.

The important part, for design purposes: **the feedback is arithmetic, not opinion.** The
product's credibility and its spectacle are the same thing.

## Who it is for

Two audiences, and the whole point of this redesign is to serve both without building two
products.

**The advanced user** (served today). 2–10 years of experience. Knows the vocabulary. Wants
to be argued with, wants to prepare for system-design interviews, or wants a system they
actually run reviewed against its real numbers. Pays.

**The beginner** (not served at all today). Has learned a language, or has been building
things with AI for a year and now knows what an API and a JSON file are. Has ideas. Is
completely lost on how any of it reaches production. This person opens the current product,
sees a palette of 108 typed components and a brief mentioning egress in terabytes, and
leaves.

The memo that triggered this work names the gap precisely: *"from programming language to
shipped software"* and *"don't know what to learn next."*

## Why now

AI writes the small pieces. Humans specify, oversee and are accountable for the
architecture. That shift is the product's reason to exist, and it means the beginner
audience is growing fast — people arrive at software through generated artifacts and hit a
wall that is entirely architectural.

## What has been decided

### Structure

**One product, two depths — not two products.** A beginner walks a ladder that terminates
*inside* the existing product. The ladder is a mode, not a fork.

### The ladder

Chapters. Each chapter is **five micro-steps (2–5 min each) that converge into one guided
checkpoint sheet** using exactly the components those steps introduced. The checkpoint is
the unlock boundary.

Rejected: micro-steps alone (never reaches the real product), and scaffolded full sheets
alone (20–40 minutes before the first win — beginners quit at minute six).

### How a micro-step is judged

Two deterministic signals, both already computed locally, no model involved:

1. **Findings clear.** The structural rule engine emits named findings in a teaching voice.
   A step declares which named findings must stop firing.
2. **A gate goes green.** A load scenario is a machine-checked pass/fail — *"TV spot spike:
   FAIL — 34% of traffic dropped (gate: at most 1%)."* A step may declare one that must pass.

Findings give the learner a specific, worded thing to fix. The gate makes the win physical.

Rejected: asserting a specific graph shape ("a cache must sit between the API and the
database"). It gives crisp feedback but teaches one blessed answer and punishes a learner
who found a different valid one.

### Progression

**Prerequisite completion plus mastery thresholds. No points currency.**

A chapter unlocks when the previous checkpoint is cleared *and* its concepts each pass a
mastery threshold. Mastery is already tracked as a per-concept exponential moving average
that decays on a spaced-repetition clock.

Why not points: a currency invites grinding, and the fastest way to farm points is to replay
a sheet you have already solved — which makes you *worse* at architecture while advancing.
Mastery cannot be farmed, because re-solving a solved sheet does not move an average that is
already high. Duolingo, the reference here, does not gate on currency either: XP feeds
streaks and leaderboards and unlocks nothing; units unlock by completing the previous unit.

**Streak and XP stay** — visible, rewarding, and opening no doors.

### The failure-tolerance mechanic

Duolingo has hearts. Loadbearing has **budget**. Every problem already carries a real
monthly ceiling. A wasteful design burns it. This is a game mechanic that falls out of the
domain instead of being bolted onto it, and it should be visible on every beginner screen.

### Entry

One question after signup: *New to this* / *I've shipped systems*. "Experienced" unlocks
everything immediately. "New" starts the ladder. **Non-binding** — switchable any time, one
click. And **instant-clear counts as complete**: if someone on the ladder passes a step's
gate on the first attempt, it marks done and moves on, so the ramp self-skips for people who
do not need it.

Rejected for v1: a placement test. It is real build cost for a judgement the user can make
about themselves in one click, and a *wrong* placement is worse than none — it either bores
them or drowns them.

## What success looks like

- A beginner reaches their first green gate in **under five minutes** from signup, with no
  API key, no install decision, no reading.
- A beginner finishes chapter 1 wanting chapter 2 more than they want to close the tab.
- An advanced user lands on the cockpit and can answer *"which problem should I do next and
  why"* in one glance.
- Someone watching a ten-second screen recording of the micro-step screen understands what
  the product does and wants to try it.

That last one is the real brief.
