# 09 — Motion spec

Motion cannot be designed in static frames. Hand this file to whoever implements, or ask for a
coded prototype of the micro-step screen specifically.

**Governing rule:** every animation in this product is a *readout of a computed value*. The
engine already produces utilisation, service latency, drop rate, queue depth and cost. Motion
exists to make those legible, never to decorate. If an animation does not correspond to a
number, it should not exist.

## Tokens

```
fast     120ms   hover, tooltips, small state flips
base     240ms   value changes, colour transitions, strike-through
slow     400ms   re-routes, spring rewards, layout arrivals
reveal   600ms   once-per-session moments (unlock, graduation)

ease-out      cubic-bezier(.22, .61, .36, 1)    things arriving
ease-in-out   cubic-bezier(.45, .05, .55, .95)  things changing value
spring        cubic-bezier(.34, 1.56, .64, 1)   things succeeding — success only
```

Nothing in the core loop exceeds 600ms. `spring` is reserved for the gate chip and nothing else,
so that overshoot *means* "you got it right."

---

## 1 · Particle flow on edges

The signature effect. Reference implementation worth studying: sFlow-RT's `particle`
visualiser, which maps particle **size and frequency to traffic intensity** and routes dots
along quadratic Bézier curves rather than straight lines — curves read as flow, straight lines
read as decoration.

```
density   one dot per 20 rps · floor 1 · cap 24 per edge
speed     inverse of the TARGET node's service latency
            8ms service   → dot crosses in ~400ms
            120ms service → ~1.2s
            800ms service → ~2.4s
colour    source node's category hue at 60% opacity
size      2.5px · 3.5px above 5k rps · 4.5px above 20k rps
path      quadratic Bézier following the edge's routing, never straight-line
```

Slow paths must **look** slow. A learner should be able to see that the third-party payment call
is the sluggish one without reading a number.

**Queueing.** When the target's utilisation exceeds 0.85, dots bunch in the final 15% of the
edge and their spacing compresses — a visible backlog at the door. This is the queueing formula
made physical and it is worth getting exactly right.

**Edge kinds.** Sync: continuous dots. Async: dashed path, dots in bursts of 3–5 with gaps —
work is deferred, not streaming. Replication: 30% opacity, reverse direction, no queueing
behaviour ever, because a replication edge is a data copy and not a request path.

## 2 · Utilisation bar

```
trigger    any change to computed utilisation
property   width
duration   240ms ease-in-out
```

Never snaps. Bands, from `latency = service ÷ (1 − utilisation)`:

| Utilisation | Bar colour | Node treatment |
| --- | --- | --- |
| `< 0.50` | `--pass` | calm |
| `0.50–0.70` | `--load` | calm |
| `0.70–0.85` | `--load` | border → `--rule-2`, bar gains 1px inner highlight |
| `0.85–1.00` | `--fail` | translate jitter, 0.4px amplitude, 8Hz |
| `≥ 1.00` | `--fail` | jitter continues + `SHEDDING` chip fades in, 120ms |

**Crossing a band boundary** flashes the node border once at 120ms. The jitter amplitude is
deliberately tiny — 0.4px reads as *strain*, 2px reads as *broken toy*.

## 3 · Dropped requests

```
detach at   80% along the edge
path        arc downward 40px, ease-in
duration    500ms
opacity     100% → 0%
trail       2px --fail, fading
rate        matches computed drop percentage — 34% dropped ≈ one dot in three
```

Never animate a drop the engine did not compute. This effect is the product's most
communicative moment; faking it would be the one lie that matters.

## 4 · Node kill (chaos and scenario runs)

```
t+0ms     node desaturates to 30% opacity, 240ms
t+100ms   its edges dim to 15%; in-flight dots on them stop dead and fade over 120ms
t+200ms   surviving path's particle density rises to absorb the load, 400ms ease-out
t+400ms   downstream node's utilisation bar animates to its new value;
          if it crosses a band, the band flash fires
```

The re-route at t+200 is the entire point of the feature. If a viewer cannot see traffic move to
the other path, the animation has failed. Reverse on restore, same timings.

## 5 · Live connection warning (pre-drop)

```
on hover over candidate target → run checkConnection
invalid   pending line → --fail dashed, tooltip fades in at 120ms near cursor
valid     pending line → --pass, 120ms
```

No layout shift, no modal, no debounce. The engine already computes this for a connection that
does not exist yet — surfacing it instantly is the "how did it know" moment.

## 6 · Finding resolved

```
strike-through   left → right wipe, 240ms ease-out
text             → 45% opacity, 240ms
dot              --fail → --pass cross-fade, 240ms
row position     UNCHANGED — no collapse, no reorder
```

The list holding still is what makes the strike-through readable. A row that vanishes reads as
*deleted*, not *solved*.

## 7 · Gate chip flip (fail → pass)

```
scale        1 → 1.06 → 1, spring, 400ms
background   --fail tint → --pass tint, 240ms
label        swaps at the midpoint, 200ms
stagger      80ms between multiple chips
```

Exactly one chip animates at a time. This is the product's reward moment and the only place
`spring` appears.

## 8 · Step complete (the Path)

```
t+0ms      gate chip flip (§7)
t+400ms    XP counter ticks up, ~30 numerals/sec, mono, no easing on digits
t+700ms    spine step node fills --brass; check mark path draws in over 240ms
t+900ms    spine connector brightens toward the next node, 400ms
t+1100ms   next step card slides up 24px and fades in, 400ms ease-out
```

Total under 1.6s, skippable by click at any point. Numerals count rather than snap, and must be
tabular-width or the whole strip jitters.

## 9 · Chapter unlock

```
section brightness   dim → full, 600ms
lock glyph           rotate 90° out + fade, 240ms
sweep                one soft --brass gradient passes down the section, 600ms
auto-scroll          section into view, 400ms ease-out
```

Fires **once**, never on revisit. A once-only animation that replays on every page load stops
feeling like an achievement within a day.

## 10 · Load slider scrub

Everything above stays continuous while dragging: utilisation bars, particle density, drop rate,
queue depth and the cost figure all update per frame.

```
no spinner · no debounce · no "recomputing" state
cost figure    counts rather than snaps, 240ms ease-in-out on numerals
```

The model is local synchronous arithmetic. Letting it feel that way — 50× traffic scrubbed in
real time with the whole canvas responding — is a large part of why this product feels
different from a diagram tool.

## 11 · Graduation

```
t+0ms      learner's canvas fades in, 600ms — alone, and it keeps its live particles
t+400ms    the real canvas fades in beside it, 600ms
t+800ms    headline draws in, 600ms reveal
t+1400ms   button fades in, 400ms
then       complete stillness
```

No confetti, no sound, no looping shimmer. The stillness after is what gives the moment weight.

## 12 · Reduced motion — `prefers-reduced-motion: reduce`

**Remove:** particles (replace with a static `--mono` rps label on each edge), all jitter, the
spring overshoot, unlock sweeps, slide-ins, auto-scroll.

**Keep:** every colour transition, utilisation bar width transitions, the strike-through wipe,
numeral counting.

**Rule: nothing that conveys state may be motion-only.** A saturated node must be identifiable
from colour and its numeric readout with every animation disabled. Test the whole micro-step
loop with the flag on — it must remain fully playable.

## Never

- Loading spinners anywhere on the canvas.
- Any core-loop animation over 600ms.
- Decorative idle motion. The single exception is the empty-gap breathing glow on a micro-step,
  which is a call to action.
- Animation on scroll.
- Motion that continues after the value stops changing.
