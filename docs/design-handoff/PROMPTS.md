# Paste-ready prompts

## How to use these

1. **Prime the conversation first.** Paste the contents of
   [01-product-brief.md](01-product-brief.md) and [02-design-language.md](02-design-language.md),
   then say *"Acknowledge, don't design anything yet."*
2. **One prompt per conversation.** Design tools degrade badly when asked for five screens at once.
3. **Start with Prompt 2** (the micro-step in 2.5D). It is the screen the product lives or dies
   on, and everything downstream inherits its aesthetic.
4. After each result, check it against that screen's `states` section in the matching spec file.
   Most first passes are missing states, not missing polish.
5. Motion cannot come back as static frames. For motion, ask for a **coded HTML/CSS prototype** of
   Prompt 2 and hand over [09-motion-spec.md](09-motion-spec.md).

Every prompt below is self-contained — tokens and content are inlined so a fresh conversation
works without the rest of the folder.

---

## Prompt 0 — Shared context (paste before any screen prompt)

```
You are designing "Loadbearing", a software-architecture learning tool. You draw a system
on a canvas; a deterministic simulator pushes traffic through your drawing and tells you
which component saturates, your p99, how much traffic you drop, and what it costs per
month. Kill a component and watch traffic re-route or fail. The feedback is arithmetic,
not opinion — that is both the product's credibility and its spectacle.

Two audiences: experienced engineers (served today) and complete beginners (the reason for
this redesign). Beginners walk a ladder of 2–5 minute steps that ends inside the real product.

VISUAL LANGUAGE — a drafting table, not a dark dashboard
The palette is WARM near-black with chalk and brass. Not cold slate. Not Duolingo cartoon.
The mood is an engineer's drafting table under a lamp, or a flight simulator: dense but
calm, every number looking measured. Border radius 2px everywhere — almost square. Depth
comes from border brightness and surface steps, never drop shadows. No glassmorphism, no
gradients on data, no emoji, no confetti, no mascot.

TOKENS (use exactly)
  surfaces   ink #121110 · ink-2 #1a1917 · ink-3 #23211e · ink-4 #2d2a26
  borders    rule #322e29 · rule-2 #423d36
  text       chalk #ede9e1 · graphite #a09a90 · pencil #726c63
  signals    brass #cfa349 (accent/you) · brass-dim #3a2f16
             load #e2913c (straining) · fail #d9534b (broken) · pass #7ba75f (correct)
             plum #b07ca8 (async)
  type       display: Segoe UI Variable Display / Inter — headings
             ui: Segoe UI Variable Text / Inter — all UI text
             mono: Cascadia Mono / Consolas — EVERY number, no exceptions
  scale      11.5 / 12 / 13 / 15 / 18 / 24 / 32 px
  spacing    4 / 7 / 10 / 12 / 14 / 20 / 28

SIGNAL DISCIPLINE: brass means "you", load means "straining", fail means "broken", pass
means "correct". Never use a signal colour decoratively.

Acknowledge this and wait. Do not design anything yet.
```

---

## Prompt 1 — The Path (beginner home)

```
Design "The Path" — the beginner home screen. Its only job: answer "what do I do next?"
with zero reading.

LAYOUT, desktop 1440
Single centred column, max-width 620px, scrolling vertically. Deliberately narrow — a
spine, not a dashboard. Slim fixed 180px rail on the right. Generous empty ink either
side; the calm here contrasts with the dense canvas screens.

HEADER, 56px: ink-2, 1px rule bottom. Wordmark left, 15px display, chalk. Right: a quiet
text link "full bank ↗" and an account glyph. No nav items at all.

SEVEN CHAPTER SECTIONS, 48px apart. Each has:
· eyebrow — "CHAPTER 2 · IN PROGRESS", mono 11px, 0.08em tracking, pencil; the status word
  takes its state colour (complete pass, in progress brass, locked pencil)
· title — display 24px chalk (pencil when locked)
· promise line — one sentence, ui 13px graphite
· a step row — five 20px circles and one 26px diamond, 44px apart, joined by a 1px line

Use these real chapters:
  1 One box, one problem — complete
  2 Two of everything — in progress, current step is #3
    promise: "Why a second copy is worthless without something in front of it"
  3 Don't ask twice — locked, "Opens when load balancing reaches familiar"
  4 Bytes don't belong in your app — locked
  5 Work you can do later — locked
  6 The database is the hard part — locked
  7 Nobody is watching — locked

STEP NODE STATES (show all of these across the chapters)
  complete         brass fill, 10px ink check
  instant-cleared  brass-dim fill, 1px brass border, brass check + a tiny »
  current          ink-3 fill, 2px brass border, 6px brass dot, soft pulse
  available        ink-3 fill, 1px rule-2 border, empty
  locked           transparent, 1px dashed rule
Connector: brass between completed steps, rule ahead, dashed rule in locked chapters.

ON THE IN-PROGRESS CHAPTER ONLY: the current step's title in 13px chalk with a brass ↑,
and a "Continue" button — brass fill, ink text, 36×140, 2px radius. The ONLY filled
button on the screen.

RIGHT RAIL, 180px, ink-2 card, 1px rule:
· Day streak — mono 32px brass, "4", label 11.5px pencil, small brass chevron glyph
· XP — mono 18px chalk, "340 XP"
· NEXT UNLOCK — the concept name "load balancing", the band "familiar", and a 4px bar,
  brass on brass-dim, at 48%
CRITICAL: never show a point total anywhere. Progression names the concept, never a score.

Deliver desktop 1440 and mobile 375. On mobile the rail becomes a 3-up strip under the
header and Continue is full-width pinned to the bottom at 48px.

Also deliver the DAY-ONE state: chapter 1 expanded and inviting, chapters 2–7 collapsed to
title + lock line only (not a wall of locks), rail showing 0 streak and the line "Finish
your first step and this fills in.", button reading "Start".
```

---

## Prompt 2 — The micro-step in 2.5D  ← START HERE

```
Design the core loop screen — a learner sees this 35 times. The canvas is an isometric
FACTORY FLOOR: the architecture runs as a plant with stations, conveyors, piles of
unfinished work, and machines that strain and stop.

THIS IS 2.5D, NOT 3D. Non-negotiable:
· ORTHOGRAPHIC projection — no vanishing point, no perspective. A 2-unit bar is the same
  pixel height anywhere on the floor, so utilisation stays comparable across the plant.
· ONE fixed camera: 30° elevation, 45° azimuth. No orbit.
· Stations sit on whole cells of a 2×2-unit grid; conveyors run in the lanes between, so
  nothing occludes anything.
· ALL text and numbers are billboarded — screen-facing, constant pixel size, never part of
  the 3D scene.
· Height encodes exactly ONE variable: utilisation. Never two.
· Flat shading only. Three fixed face brightnesses (top 100%, left 78%, right 62%). No
  gloss, no bloom, no shadows beyond a soft contact shadow, no skybox.

LAYOUT 1440: header 44px · canvas 70% left · panel 30% right (380–460px) · run bar 64px.

THE FLOOR: warm dark concrete — ink base, 1px rule grid at 2-unit spacing, fading out at
the edges. A thin rule-2 perimeter fence rings the plant with corner posts.

THE PLANT (place these exactly):
· "Web Client" station, short, calm, at the entry
· conveyor → "API" station: 94% utilised, so TALL, fail-coloured band wrapping its side
  faces, faint jitter, a PILE OF WORK-IN-PROGRESS beside it (small stacked units on the
  floor, ~30 of them)
· conveyor → "SQL Database": 31%, short, pass-coloured band
· BELOW the API, an EMPTY MARKED CELL — the gap: dashed rule-2 outline, hatched ink-2
  fill, a billboarded "?" in pencil, slow brass breathing glow on the outline
Category stripe on each station's top leading edge: API is Compute #c9703f, SQL Database
is Data #9aa95f, Web Client is Edge #e0bd6c.

CONVEYORS: 0.5-unit flat belts, rule-2 surface with faint tread marks. Small flat plates
ride them, coloured by the source station's category hue, one plate per 20 rps. On the
belt INTO the saturated API, plates BUNCH UP in the final 15% — a visible jam at the
infeed. And plates TIP OFF the belt edge, tumbling to the floor with a fail-coloured
trail: dropped requests as litter on the factory floor. This falling-off is the single
most important thing in the image — make it unmistakable.

BILLBOARDED LABEL above each station: name in ui 12px chalk, then mono 11px "94% · 2 × 500 rps".

RIGHT PANEL, ink-2, 1px rule left, 14px padding. Section labels mono 10px uppercase pencil
0.1em. In order:
· BRIEF — ui 15px chalk: "Your API is one instance. Traffic tripled this morning."
· BUDGET — mono 15px "$412 / $900", 6px bar brass on brass-dim at 46%
· THE LINE — a mono two-column readout:
    throughput    612 / 900 rps
    bottleneck    API   94%
    WIP           1,840 queued
    falling off   34%
    cost/1k req   $0.11
· ADD — four palette cards, ink-3, 1px rule, 10px padding, each with a 16px category glyph,
  name in 13px chalk and a real one-line hint in 11.5px graphite:
    "Load Balancer" — Spreads traffic over healthy replicas and hides instance failures
                      from callers.
    "API (second replica)" — A stateless unit of business logic you can scale horizontally.
    "Cache · ch.3" — LOCKED: dashed border, 45% opacity, pencil text
    "CDN · ch.4" — LOCKED
· WHAT'S WRONG — two rows. Open row: 6px fail dot, 12px chalk text, then a brass "Why?"
  link. Use this real copy verbatim:
    "Load Balancer balances across one instance — one instance behind a load balancer is an
     extra hop and an extra thing to fail, not redundancy; when that instance dies the
     balancer keeps forwarding to a corpse."
  Second row RESOLVED: 6px pass dot, text struck through, faded to 45%. The row must NOT
  collapse or reorder.

RUN BAR, 64px, ink-2, 1px rule top:
· "RUN" — brass fill, ink text, 220×40, display 15px. The only filled button here.
· "▶ Watch it break" — outlined, brass border and text
· gate chip — pill, mono 12px, 1px fail border, fail tint at 12%:
    "⬢ Morning surge — FAIL · 34% dropped (max 1%)"
· header right: a 3-stop tilt slider "[◫ ──●── ◰]" set to the isometric end

DELIVER THREE FRAMES:
A) as described above — the failing state
B) THE PASSED STATE: a Load Balancer station now in the gap with two adjacent narrower
   API boxes (two replicas drawn as two machines), all bands pass-coloured, no WIP pile,
   nothing falling off the belts, gate chip pass-tinted reading "⬢ Morning surge — PASS ·
   0.2% dropped (max 1%)", XP counter mid-animation, and the next step card sliding up
   from the bottom edge. THIS IS THE MONEY SHOT — give it the most polish.
C) TILT AT 0° — the same plant flat top-down, heights collapsed into horizontal
   utilisation bars inside rectangular nodes. This proves the 2D/2.5D continuum works.

Never: a spinner on RUN, a score or star rating, text inside the 3D scene, perspective.
```

---

## Prompt 3 — Intruder states

```
Same isometric factory floor as before (orthographic, 30°/45°, grid-snapped, billboarded
labels, warm ink palette, tokens as given). Design the SECURITY INTRUDER moment in two
states.

The plant: Web Client → API Gateway → Service → SQL Database, plus a thin rule-2 perimeter
fence with corner posts around the whole floor.

STATE A — ABSORBED (the design is sound)
The fence has a visible GATE where the API Gateway sits. A fail-coloured probe — a small
angular dart, deliberately not cute — has come in from outside, low and fast, with a motion
trail behind it. It is at the gate, BREAKING APART into fragments that fade. The gate
flashes brass. A billboarded label above the gate, mono 11px pass: "blocked at the
perimeter". Everything else on the plant continues calmly, bands pass-coloured.
This frame's job: make paying for a WAF look like money well spent.

STATE B — THROUGH (the design has a hole)
Same plant, but WITHOUT the gateway: the fence has a visible GAP. The probe has come
through it and travelled all the way to SQL Database. Every conveyor along its route is lit
fail-coloured BEHIND it, so the intrusion path is traceable end to end with a finger. The
SQL Database station is flooded fail-coloured. A finding panel row on the right quotes real
copy: "Nothing on the path from Web Client to SQL Database establishes who the caller is,
so every request is trusted simply because it arrived."

The lit path persists — it is a state, not a flash.

Never: make the probe cartoonish or characterful, add a skull/hacker-hoodie visual, or
imply randomness. It gets in because there is a hole, and it stops because the hole was
closed.
```

---

## Prompt 4 — The cockpit (advanced home)

```
Design the advanced home screen. Brief: complex problems made EASY TO APPROACH — not
simplified, but each one's relevance obvious before it is clicked. Never an
undifferentiated list of 25 titles.

LAYOUT 1440: header 56px · due strip 64px · main column fluid · right rail fixed 300px.

DUE STRIP (spaced-repetition surface, the highest-value element): ink-2, 1px rule top and
bottom. A brass ⟳ glyph, then 13px chalk "3 concepts are due", then concept pills —
brass-dim fill, brass 11.5px text, 1px brass border at 40% — reading "idempotency",
"saga", "cdn". Right-aligned: a brass-filled 36px button "Start today's drill".

FILTER ROW: text tabs, not buttons — "All · Weak concepts · Not attempted · Labs · Mine".
Active tab chalk with a 2px brass underline; the rest graphite.

PROBLEM CARDS in a responsive grid grouped by level, 12px gap, 260px min width. Card:
ink-2, 1px rule, 2px radius, 14px padding. Contents in order:
· mono 10px uppercase pencil — "L2 · INFRASTRUCTURE"
· title, display 15px chalk, max two lines
· up to three concept chips, ink-3 fill, graphite 10.5px — BUT a chip for a concept the
  user is WEAK on renders in load-orange. This detail is most of "made approachable".
· footer row: "best 84" in mono 12px, a 40×14 brass sparkline, and a small pass-coloured
  "✓ᵗ" if the twist round is done

Use these real problems:
  L1 e-commerce   Read-Heavy Product Catalog API      [caching][cdn][capacity]  best 84 ✓ᵗ
  L1 media        User Image Upload and Delivery      [blob][cdn][capacity]     best 71
  L1 social       Paginated Activity Feed API         [pagination][caching]     best 90
  L1 analytics    Page-View Counter for Publishers    [aggregation][async]      not attempted
  L2 infra        URL Shortener at 50k RPS            [sharding][hashing]       not attempted
  L2 infra        Session Store for a Logged-In Product [session][ttl]          best 66
  L2 gaming       Realtime Leaderboard for a Mobile Game [sorted-set][cache]    best 62
  L2 productivity Team File Sharing with Shareable Links [blob][authz]          not attempted
Group headers: "LEVEL 2" in mono 11px pencil with a 1px rule line filling the row and
"1 of 4 done" right-aligned.

RIGHT RAIL, 300px:
· TWO OUTLINED BUTTONS AT THE TOP — brass border and text on ink-2: "Review my system"
  and "Compose a sheet". These are the professional features currently buried; on this
  screen they sit above everything analytical.
· MASTERY — an 8-axis radar, brass stroke with 18% brass fill, thin rule-coloured web.
  Axes: Traffic & Edge, Scaling & Data, Consistency & Transactions, Async & Messaging,
  Reliability, Security, Operations & Cost, AI Systems.
· ALL 45 CONCEPTS — a dense grid of tiny square tiles, brightness = strength, hollow
  outline = never assessed.
· footer stats, mono graphite: "12 sheets · avg 78 · ▲ 4 day streak"

ALSO DELIVER THE COLD-START STATE: zero attempts. Grid full, every card "not attempted".
Rail radar and heatmap as empty outlines with the line "Submit a design and this fills in."
No due strip. One brass hint above the grid: "Level 1 is a good place to start."

Never: show the bank as a table, lead with the radar, hide "Review my system" in a menu,
or use fail-red for a weak concept chip (weak is an opportunity — use load-orange).
```

---

## Prompt 5 — Graduation

```
Design a single full-bleed moment. It fires once, when a learner clears the final chapter,
and its job is to convert a learner into a user by showing them evidence of their own
competence — not by congratulating them.

Full bleed on ink #121110. No header, no chrome, no panel. Vertically centred, max-width
1180px.

· Optional eyebrow, mono 11px brass, 0.12em tracking: "CHAPTER 7 OF 7 · COMPLETE"
· HEADLINE, display 48px chalk: "You just did this."
  Nothing else. No "congratulations", no "well done", no exclamation mark.
· TWO CANVASES side by side, 520×340 each, 40px gutter, 1px rule border, 2px radius,
  ink-2 fill:
    LEFT — the learner's own finished isometric factory: a small, calm, working plant,
    everything pass-coloured, items on the belts. Slightly dimmed to 85%, non-interactive.
    A trophy, and a trophy because it works.
    RIGHT — the same problem UNSCAFFOLDED: an empty canvas, an editable flow row across
    the top, and the FULL palette visible as a dense column of ~108 tiny component chips
    down one side. Do not hide the density — the density is the promise.
· CAPTIONS under each: label in ui 13px chalk, then a mono 11.5px graphite stat line
    left:  "what you drew"    "7 chapters · 35 steps · 6 gates"
    right: "the real thing"   "25 sheets · 108 components"
· BUTTON, brass fill, ink text, 260×48, display 16px: "Open the full bank"
· Under it, pencil 12px: "the ladder stays where it is"

Never: confetti, a mascot, a trophy graphic, a certificate, a share-to-social prompt, a
score, a rank, or a second competing call to action.
```

---

## Prompt 6 — "Watch it break" (motion prototype)

Do not ask a static design tool for this. Ask for a **coded HTML/CSS/JS prototype**, and paste
[09-motion-spec.md](09-motion-spec.md) alongside it.

```
Build a self-contained HTML prototype of a four-second "watch it break" sequence on an
isometric factory floor. Orthographic projection, fixed 30°/45° camera, flat shading,
billboarded labels at constant pixel size. Warm ink palette (tokens as given).

Plant: Web Client → API → SQL Database on a 2-unit grid, conveyors in the lanes.

SEQUENCE, autoplaying on a loop with a replay button:
  0.0s  1× load. Plant calm, all utilisation bands pass-coloured, belts moving slowly.
  1.0s  Ramp begins. Belt speed and item density climb.
  2.0s  The API station GROWS TALLER as utilisation rises; its band turns load-orange.
  2.8s  Band turns fail-red. A 0.4px 8Hz jitter starts. A work-in-progress pile begins
        accumulating beside it, one unit per 50 queued.
  3.4s  Items start TIPPING OFF the infeed belt, tumbling to the floor and fading with a
        fail-coloured trail.
  4.0s  Hold. A readout panel counts up to its final numbers.

RULES
· Station height = 0.6 + utilisation × 1.4 units. Height encodes utilisation ONLY.
· Item density = one plate per 20 rps, capped at 24 per belt.
· Item speed is INVERSE to the target station's service latency — slow paths must look slow.
· Past 0.85 utilisation, items bunch in the final 15% of the belt: a visible jam.
· Bands: <0.50 pass · 0.50-0.70 load · 0.70-0.85 load + brighter edges · 0.85-1.0 fail +
  jitter · ≥1.0 fail + a "SHEDDING" chip.
· Easing: 240ms cubic-bezier(.45,.05,.55,.95) for value changes; 400ms
  cubic-bezier(.22,.61,.36,1) for arrivals.
· Numbers count rather than snap, in a tabular-width monospace.
· Honour prefers-reduced-motion: drop particles, jitter and the ramp; show final static
  values with a per-belt rps label instead.
· No spinner, no sound, no decorative idle motion.

Single file, no external dependencies, no CDN.
```
