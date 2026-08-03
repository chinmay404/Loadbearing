# Loadbearing — UI/UX design handoff

Everything a designer (human or Claude Design) needs to design the new Loadbearing
interface without reading the source. Written 2026-08-03.

## What is being designed

Loadbearing today is a tool for people who already know what a reverse proxy is. This
package designs the **second half**: a beginner ladder that receives someone who has just
learned their first language, walks them up, and hands them to the existing product — plus
a redesign of the advanced home so hard problems become approachable rather than
intimidating.

## Read in this order

| File | What it settles |
| --- | --- |
| [01-product-brief.md](01-product-brief.md) | What the product is, who it is for, what was decided and why |
| [02-design-language.md](02-design-language.md) | The drafting-table metaphor, real tokens, what to avoid |
| [03-flows.md](03-flows.md) | Entry fork, the ladder, the loop, graduation, cockpit |
| [04-screen-the-path.md](04-screen-the-path.md) | Screen spec: beginner home |
| [05-screen-micro-step.md](05-screen-micro-step.md) | Screen spec: **the core loop — most important screen** |
| [06-screen-checkpoint.md](06-screen-checkpoint.md) | Screen spec: chapter boss |
| [07-screen-graduation.md](07-screen-graduation.md) | Screen spec: the handoff moment |
| [08-screen-cockpit.md](08-screen-cockpit.md) | Screen spec: advanced home |
| [16-screen-3d-factory.md](16-screen-3d-factory.md) | Screen spec: **the 2.5D isometric factory floor — the primary visual identity** |
| [09-motion-spec.md](09-motion-spec.md) | Every animation, with timings and triggers |
| [10-states-matrix.md](10-states-matrix.md) | Every state that must be delivered |
| [11-content-inventory.md](11-content-inventory.md) | **Real** component names, findings copy, numbers, chapter ladder |
| [12-voice-and-copy.md](12-voice-and-copy.md) | How this product talks |
| [13-accessibility.md](13-accessibility.md) | Reduced motion, contrast, keyboard, colour-blind safety |
| [14-references.md](14-references.md) | Duolingo, Khan Academy, Brilliant, sFlow, diagramming tools — what to take and what not to |
| [15-explored-ideas.md](15-explored-ideas.md) | The factory metaphor, intruders, and the 3D decision with its trade-offs |
| [PROMPTS.md](PROMPTS.md) | **Paste-ready prompts**, one per screen, in sequence |

## How to use it with Claude Design

1. Paste [01-product-brief.md](01-product-brief.md) and [02-design-language.md](02-design-language.md)
   first, as context. Do not ask for a screen yet.
2. Then paste **one** prompt from [PROMPTS.md](PROMPTS.md). One screen per conversation —
   they degrade when asked for five at once.
3. Start with **Prompt 2 (the micro-step in 2.5D)**, not Prompt 1. It is the screen the
   product lives or dies on; if its aesthetic is wrong, everything downstream inherits the
   mistake.
4. When it returns something, check it against the matching `states` section before asking
   for changes. Most first passes are missing states, not missing polish.
5. Motion cannot be designed in static frames. Hand [09-motion-spec.md](09-motion-spec.md)
   to whoever implements, or ask for a coded prototype of the micro-step specifically.

## Non-negotiables

Three things in here are load-bearing decisions, not preferences. Everything else is open.

- **No points currency.** Progression gates on completing the previous chapter plus
  per-concept mastery thresholds. A design that shows "60/50 points" is wrong. See
  [01-product-brief.md](01-product-brief.md#progression).
- **No LLM in the beginner loop.** Every beginner verdict comes from local arithmetic, so
  there is never a spinner, a cost, or a wait on the canvas.
- **Keep the warm ink palette.** Duolingo's *mechanics* transfer to this product; its
  cartoon *aesthetic* does not, and copying it would cost credibility with the audience
  most likely to pay. See [02-design-language.md](02-design-language.md#what-to-avoid).
- **The factory is 2.5D, not 3D.** Orthographic projection, one fixed camera, height as a
  data channel. Perspective, free orbit and gloss are all off the table — they would break
  the quantitative comparison the product's credibility rests on. See
  [16-screen-3d-factory.md](16-screen-3d-factory.md#the-five-constraints-this-design-must-satisfy).

## Source of truth

Values in [02-design-language.md](02-design-language.md) and
[11-content-inventory.md](11-content-inventory.md) were read out of the running codebase
(`client/src/styles.css`, `client/src/canvas/nodeCatalog.ts`,
`shared/src/compatibility.ts`, `shared/src/concepts.ts`). They are not invented. Where a
designer wants to change one, that is a real product decision, not a mockup detail.
