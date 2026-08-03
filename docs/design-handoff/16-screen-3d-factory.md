# 16 — Screen: The 3D factory

**The product's primary visual identity. An isometric plant floor where your architecture runs as
a factory: stations, conveyors, piles of unfinished work, machines that strain and stop, and
intruders at the fence.**

## Why a factory and not a diagram

Queueing theory came out of manufacturing. Little's Law, the theory of constraints, the
bottleneck that governs the whole line's rate — computing borrowed all of it, and `The Phoenix
Project` teaches the analogy to engineers on purpose. So the factory is not a costume over the
simulator; it is the simulator's own ancestry.

Which means every element of the metaphor maps to a value the engine **already computes**:

| Factory | Loadbearing | Source |
| --- | --- | --- |
| Station / machine | Component | node |
| Machine running hot | Utilisation past the knee | `utilisation` |
| Pile of unfinished work beside a station | Queue depth | `queueDepth` |
| Conveyor | Edge | edge + kind |
| Items on the conveyor | Requests per second | flow rps |
| The line's governing bottleneck | The saturated component | max utilisation |
| Parts falling off the belt | Dropped requests | drop % |
| Cost per unit produced | Monthly cost ÷ throughput | derivable |

Nothing here needs new arithmetic. It needs staging.

## The five constraints this design must satisfy

Isometric graphs fail in known ways. These are not preferences — a design that breaks one of them
produces the unreadable Cloudcraft-style result.

**1 · Orthographic, never perspective.** True isometric with no vanishing point. A 2-unit bar is
the same number of pixels wherever it sits on the floor, so utilisation stays comparable across
the whole plant. Perspective would make the product's most important comparison unreliable.

**2 · Fixed camera.** One angle: 30° elevation, 45° azimuth. Pan and zoom only — **no free
orbit**. A rotatable scene means every layout is sometimes occluded, and no amount of care fixes it.
Offer four snap angles (45°/135°/225°/315°) as discrete "walk around the plant" steps if a
learner needs to see behind something.

**3 · Grid-snapped floor with reserved lanes.** Stations occupy whole cells on a 2×2-unit grid;
conveyors run in the lanes between. Occlusion is prevented by *layout*, not avoided by luck.
Auto-layout keeps a one-cell clearance behind every station so nothing tall hides anything.

**4 · Billboarded labels.** Every label and number renders as a screen-facing element at constant
pixel size, unaffected by depth. Text is never part of the 3D scene. This is what keeps a dense
plant readable.

**5 · Height encodes exactly one variable: utilisation.** Never two. The moment height means both
load and cost, the scene stops being a readout.

## Layout — desktop 1440

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ← Ch.2 · Step 3    Two of everything      [◫ 2D] [◰ 3D]   ▲4  340 XP     [≡]  │ 44
├────────────────────────────────────────────┬───────────────────────────────────┤
│                                            │ Your API is one instance.         │
│           ╱╲                               │ Traffic tripled this morning.     │
│         ╱    ╲   ← intruder probe          │                                   │
│       ╱  ▓▓▓   ╲                           │ ──────────────────────────────    │
│      │ ░░░░░░░  │  perimeter fence         │ BUDGET      $412 / $900           │
│      │   ┌───┐  │                          │ ▓▓▓▓▓░░░░░                        │
│      │   │███│  │  ← API station,          │ ──────────────────────────────    │
│      │   │███│▪▪▪  94%, tall + red,        │ THE LINE                          │
│      │   └───┘  │    WIP pile beside it     │ throughput   612 / 900 rps       │
│      │  ═══╪═══ │  ← conveyor, items        │ bottleneck   API   94%           │
│      │   ┌───┐  │    flowing, some          │ WIP          1,840 queued        │
│      │   │▓▓ │  │    falling off            │ falling off  34%                 │
│      │   └───┘  │  ← Postgres, 31%, short   │ cost/1k req  $0.11               │
│      │ ┌ ─ ─ ┐  │                           │ ──────────────────────────────    │
│      │ ╎  ?  ╎  │  ← the gap, a marked      │ ADD                              │
│      │ └ ─ ─ ┘  │    empty floor cell       │ (4 palette cards)                │
│       ╲        ╱                            │ ──────────────────────────────    │
│         ╲    ╱                              │ WHAT'S WRONG                      │
│           ╲╱                                │ ● Load Balancer balances across… │
├────────────────────────────────────────────┴───────────────────────────────────┤
│ [ RUN ]  [▶ Watch it break]  ⬢ Morning surge — FAIL · 34% dropped (max 1%)      │ 64
└────────────────────────────────────────────────────────────────────────────────┘
```

Panel is unchanged from [05-screen-micro-step.md](05-screen-micro-step.md) — same brief, budget,
palette and findings — plus one new block, **THE LINE**, which is the factory's readout.

## The floor

Warm dark concrete: `--ink` base with a 1px `--rule` grid at 2-unit spacing, fading out toward
the edges so the plant has no visible boundary. Grid lines brighten faintly under the hovered
cell.

A **perimeter fence** rings the whole plant as a thin `--rule-2` line with corner posts — the
security boundary, and the thing an intruder has to cross. Where a WAF, API gateway or auth
component exists, the fence gains a visible **gate** at that point. Where nothing establishes who
the caller is, the fence has a visible **gap**. A learner should be able to see the hole in the
fence before any finding tells them.

## Stations (components)

A low box on its cell — 2×2 units of floor, height driven by utilisation.

- **Body**: `--ink-3`, flat-shaded, no gloss, no reflection. Three faces at fixed brightness
  (top 100%, left 78%, right 62%) — flat-shaded orthographic reads as *technical drawing*, and
  any specular highlight pushes it toward toy.
- **Category stripe**: the component's colour on the top face's leading edge, 0.25 units.
- **Height**: `0.6 + utilisation × 1.4` units. A calm station is a slab; a saturated one is a
  tower. **The plant's silhouette is the load profile** — you can read the bottleneck from across
  the room without a single number.
- **Utilisation band**: a horizontal fill wrapping the visible side faces, coloured by the strain
  bands in [09-motion-spec.md §2](09-motion-spec.md#2--utilisation-bar). Because projection is
  orthographic, band heights compare honestly between stations.
- **Billboarded label** floating just above: name in `--sheet-font` 12px `--chalk`, then `--mono`
  11px — `94% · 2 × 500 rps`. Constant pixel size at all zooms.
- **Replicas**: drawn as *n* adjacent narrower boxes sharing a cell, not as a number. Two replicas
  looks like two machines. This is the clearest thing 3D buys the product.

### Strain, staged

| Utilisation | Station |
| --- | --- |
| `< 0.50` | short, `--pass` band, calm |
| `0.50–0.70` | taller, `--load` band |
| `0.70–0.85` | edges brighten to `--rule-2`, a faint heat shimmer above the top face |
| `0.85–1.00` | `--fail` band, 0.4px jitter at 8Hz, WIP pile grows beside it |
| `≥ 1.00` | jitter continues, a `SHEDDING` billboard chip, parts visibly falling off the infeed |

## Work in progress — the best thing the factory metaphor gives you

**Queue depth becomes a physical pile beside the station.** Small stacked units on the floor,
count proportional to `queueDepth` (one unit per 50 queued, cap ~40 units, then the pile grows in
height rather than count).

This makes the abstract concept in the product concrete: a queue is *unfinished work that has
nowhere to go*. When a learner adds a second replica and watches the pile shrink, they have
learned backpressure without the word being used.

For an actual message queue component, the pile *is* the component — a hopper whose fill level is
the backlog, with a `--fail` overflow mark at the depth limit.

## Conveyors (edges)

A flat belt in the lane between stations, 0.5 units wide, `--rule-2` surface with faint tread
marks, running along the edge's existing routing — never crossing a station cell.

- **Items** ride the belt: small flat plates, one per 20 rps, capped at 24 per belt, coloured by
  the source station's category hue.
- **Speed** is inverse to the target's service latency, exactly as in
  [09-motion-spec.md §1](09-motion-spec.md#1--particle-flow-on-edges). Slow paths must look slow.
- **Bunching**: past 0.85 utilisation, items compress in the final 15% before the station — a
  visible jam at the infeed.
- **Falling off**: at the drop rate, an item tips off the belt edge, tumbles to the floor and
  fades over 500ms with a `--fail` trail. Dropped requests as litter on the factory floor is the
  most legible thing in this entire design.
- **Async belts** are dashed with gaps and move in bursts. **Replication belts** run under the
  floor as a dim recessed channel — visibly *not* a request path, which kills the most common
  misreading of the 2D canvas.

## The gap (a micro-step's empty cell)

A marked-out floor cell: dashed `--rule-2` outline, hatched `--ink-2` fill, a floating billboarded
`?` in `--pencil`, and a slow `--brass` breathing glow on the outline. The only idle animation in
the product.

On a valid drag-over the cell fills `--brass` at 15% and the connecting belts preview as ghosts.
On an invalid one, the cell edges go `--fail` dashed with the one-line reason billboarded above it.

## Intruders

Fires **deterministically**, never randomly — because the design has an opening, and it stops
because the design closed it. Randomness here would break the product's core promise that the
feedback is arithmetic.

The rules that already exist drive it: `no-auth-boundary`, `llm-without-guardrail`,
`pii-unencrypted-third-party`. And `server/src/scoring/attacks.ts` already validates an attack
against the drawing, dropping any that names a component the sheet does not have.

**Absorbed** (the design is sound):
```
t+0ms      a --fail probe enters from outside the fence, low and fast
t+600ms    it reaches the gate — the WAF or gateway station
t+900ms    gate flashes --brass once; probe breaks apart and fades
t+1100ms   billboard above the gate: "blocked at the perimeter"
```
This is what paying for a WAF *looks like*. Money made visible.

**Through** (the design has a hole):
```
t+0ms      probe enters, finds the gap in the fence
t+800ms    it travels the unauthenticated path — belts light --fail behind it
t+1600ms   it reaches the datastore; the station floods --fail
t+1800ms   the path stays lit; the finding appears, quoting the real rule text:
           "Nothing on the path from Web Client to SQL Database establishes who
            the caller is, so every request is trusted simply because it arrived."
```

The lit path persists until fixed. A learner should be able to trace the intrusion route with a
finger.

## "Watch it break" — the staged ramp

A second button beside RUN. Four seconds, non-interactive, camera drifting slowly:

```
0.0s   1× load, plant calm, everything --pass
1.0s   ramp begins; belts speed up; item density climbs
2.0s   the bottleneck station grows visibly taller, band → --load
2.8s   band → --fail, jitter starts, WIP pile begins accumulating
3.4s   items start tipping off the infeed belt
4.0s   hold on the final frame; THE LINE panel counts up to final numbers
```

Then stillness, and the gate chip resolves. This is simultaneously the teaching moment, the
graduation set-piece, and the ten-second video that sells the product.

## Terminology: this is 2.5D, and that is the point

Worth being exact, because it changes the engineering estimate. Everything specified here is
**2.5D**, not true 3D:

- Orthographic projection — no vanishing point, no perspective distortion.
- One fixed camera angle, with four discrete snaps. No free orbit.
- Height is a *data channel* (utilisation), not modelled geometry.
- Stations are extruded footprints on a grid, not meshes.

That is a 2D scene graph drawn with a tilt and a height axis. It buys nearly all of the factory
feeling for a fraction of true-3D cost, and it is the only version that keeps quantities
comparable. Nobody should be building meshes, lighting rigs or orbit controls.

## The tilt: one continuum, not two modes

Rather than a hard switch between two canvases, make **tilt a continuous control**. One slider (or
one toggle that animates through it):

```
tilt  0°  → flat top-down. Heights collapse to utilisation bars. This IS the 2D canvas.
tilt 12°  → a hint of depth; belts gain thickness; piles begin to read
tilt 30°  → full isometric plant. The default for the beginner ladder.
```

Why this is better than a switch:

1. **One renderer, one layout, one set of states to maintain.** 2D stops being a separate screen
   and becomes tilt=0. That halves the design surface and removes the risk of the two views
   drifting apart.
2. **The transition teaches.** Animating 0° → 30° over 600ms *lifts the towers out of the flat
   diagram* — the learner watches the tall red station rise out of a plan they already understood.
   That is a genuinely memorable way to introduce the metaphor, and it is free.
3. **It degrades honestly.** Reduced-motion, screen-reader, low-GPU and dense-advanced-sheet cases
   all become "tilt is 0", not "you get the lesser product".
4. **It settles the argument empirically.** Ship the slider and watch where people leave it. If
   advanced users sit at 0° and beginners at 30°, that is the answer, and no one had to guess.

Header control: `[◫ ──●── ◰]` — a 3-stop slider with the ends labelled, defaulting to 30° on the
ladder and 0° on advanced sheets. Remembered per user, per view.

## 2D is a first-class equal, not a fallback

Whether implemented as tilt=0 or as a separate mode, the flat top-down canvas specified in
[05-screen-micro-step.md](05-screen-micro-step.md) stays fully supported because:

- Dense advanced sheets — 20+ components — read better flat.
- Precise editing is faster flat.
- It is the honest answer for reduced-motion, screen-reader and low-GPU users.
- Mermaid and `.drawio` export come from the flat graph anyway.

**Both views render the same graph model.** 3D is a renderer, not a second data structure — that
is what keeps the cost bounded and lets the view ship before the editor does.

## Editing in 3D

- Dragging is constrained to the **floor plane**. Height is computed, never user-controlled, so
  there is no depth ambiguity.
- Components snap to whole cells; belts auto-route through free lanes.
- Wiring: click a station's outfeed, click a target's infeed. No free-form dragging of belt
  geometry.
- The four snap camera angles handle anything hidden.
- Everything selection-related — pin, group, reorder — stays in 2D only. Do not port it.

## Performance budget

60fps at 40 stations and 60 belts on integrated graphics. Instanced meshes for items and WIP
units, one draw call per category. Above 40 stations, drop item density before dropping frame
rate — a plant that stutters reads as broken software, and this product is *about* things being
overloaded, so the irony is expensive.

## States to deliver

1. **Calm plant** — everything under 50%, belts flowing, no piles.
2. **One bottleneck** — one tall red station, WIP pile, items tipping off, everything else calm.
3. **The gap** — empty cell breathing, belts stubbed either side.
4. **Intruder absorbed** — probe breaking apart at a lit gate.
5. **Intruder through** — path lit `--fail` from fence to datastore, station flooded.
6. **Station killed** — machine dark and still, its belts stopped, traffic visibly re-routed to a
   sibling, downstream station reddening.
7. **Passing state** — every band in colour, no piles, nothing falling, gate chip `--pass`.
8. **2D toggle** — the same design flat, to prove parity.

## Do not

- Add perspective, free orbit, gloss, bloom, lens flare, or a skybox.
- Put text into the 3D scene.
- Encode two variables in height.
- Make the intruder random.
- Let the 3D view become the only way to draw.
- Add machine sound effects. A silent plant keeps the instrument's nerve.
