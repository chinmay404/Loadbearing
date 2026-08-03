# 15 — Explored ideas: the factory, 3D, and intruders

An idea raised during design: make the canvas a **3D factory floor** — isometric, machines and
conveyors, work visibly flowing — and stage events on it: an **intruder** arrives, or the data
rate climbs. Reference given: Cloudcraft's isometric AWS view.

Recorded here in full because two thirds of it are excellent and the remaining third is the
expensive part. Verdict up front: **take the factory semantics, take the intruder, leave the
third dimension out of the editor.**

---

## The factory metaphor — adopt it

This is better than "diagram", and not only aesthetically. Queueing theory *came from
manufacturing*. Little's Law, the theory of constraints, work-in-progress limits, the bottleneck
that governs the whole line — these are factory concepts that were borrowed by computing, and
`The Phoenix Project` teaches a generation of engineers exactly this analogy on purpose.

So a factory framing is not a costume over the simulator. It is the simulator's own intellectual
ancestry, and it gives beginners a physical intuition they already have:

| Factory | Loadbearing | Already computed? |
| --- | --- | --- |
| Station | Component | yes |
| Machine running hot | Utilisation past the knee | yes |
| Pile of unfinished work at a station | Queue depth | yes |
| Conveyor | Edge, with particles | yes |
| The bottleneck that sets the whole line's rate | The saturated component | yes |
| Parts falling off the line | Dropped requests | yes |
| Cost per unit produced | Monthly cost ÷ throughput | derivable |

Every row already exists in the engine. **The metaphor needs no new computation — only new
naming and new emphasis.** That is the cheapest, highest-value part of the idea, and it should
inform copy throughout: a beginner understands "the machine can't keep up and the parts are
piling up" instantly, and "utilisation 0.94" not at all.

## The intruder — the best mechanic in this conversation

Adopt this, and adopt it early. Reasons:

**It already has scaffolding.** `server/src/scoring/attacks.ts` defines an `Attack` with a
`hypothesis`, `killNodes`, `degrade` and third-party latency — and, importantly, it *validates
every attack against the drawing* so an attack naming a component that is not there is dropped
rather than shipped as a gate that cannot fail. There is an `AttackPanel` in the client already.

**It has rules waiting for it.** The engine already emits `no-auth-boundary`,
`llm-without-guardrail`, `pii-unencrypted-third-party` — findings about who is allowed in. Today
they are sentences in a list. As an intruder, they become an *event you watch*:

- A hostile probe enters from the edge of the canvas and travels the perimeter.
- It hits the WAF and dies — a small `--fail` flash absorbed at the boundary. That is what
  spending money on a WAF *looks like*.
- Or it finds the unauthenticated path, walks straight through to the database, and the whole
  path lights `--fail` with one line: *nothing on this path establishes who the caller is.*

That converts security from the most abstract topic in the product into the most visceral one,
and it does it with a rule engine that already knows the answer. Chapter 7 in
[11-content-inventory.md](11-content-inventory.md#the-chapter-ladder) is the natural home.

**Design note:** the intruder must never be a random event. It fires because the design has an
opening, and it fails because the design closed it. A probe that sometimes gets through and
sometimes does not would destroy the product's core promise — that the feedback is arithmetic,
not chance.

## Rising data flow — already built

The load slider already scrubs to 50× with everything recomputing live, and every scenario
carries an `rpsMultiplier`. What is missing is not the capability but the **staging**: a beginner
should see the ramp happen *over a few seconds* with the bottleneck visibly reddening and the
queue piling up, not jump between two static states. That is a motion and pacing change — see
[09-motion-spec.md §10](09-motion-spec.md#10--load-slider-scrub) — not an engine change.

A "watch it break" button that ramps 1× → 12× over four seconds would be the single cheapest
dramatic addition to the product.

## 3D / isometric — not for the editor

Look honestly at the Cloudcraft screenshot that prompted this. It is striking in marketing and
hard to read in use: dozens of near-identical isometric blocks, labels colliding with geometry,
depth making comparison guesswork. That is not a Cloudcraft failure — it is what isometric does
to a dense graph.

Five specific problems for **this** product:

1. **Occlusion.** The core reading task is *"which component is in trouble?"* at a glance. In
   isometric, nodes sit behind other nodes. Depth actively fights the one thing the canvas must do.
2. **Foreshortening destroys quantitative comparison.** The utilisation bar is the most important
   element in the interface. In perspective, a bar's apparent length depends on where it sits, so
   two nodes at 60% and 85% no longer compare reliably. This is the oldest rule in data
   visualisation and the product's credibility rests on exactly this comparison.
3. **Editing in 2.5D is ambiguous.** Where does a dragged wire land in depth? Every isometric
   diagramming tool ends up view-mostly, edit-rarely — and Loadbearing's whole loop is editing.
4. **Cost, in the wrong place.** It means replacing the React Flow canvas with a 3D renderer:
   hit-testing, layout, labels, routing, export, and 108 component models. That is the entire
   budget that should be buying **35 authored lessons**, which is the product's actual bottleneck.
   The engineering is the fun part and it is not what is blocking.
5. **Accessibility.** Occlusion plus depth plus reduced-motion requirements is a hard corner to
   design out of.

## Where 3D genuinely earns its place

**As a spectacle view, not a work surface.** A `Watch it run` mode:

- Non-interactive. A camera drifts slowly over the system in isometric.
- The load ramps 1× → 12× over a few seconds.
- The bottleneck reddens; the queue piles up; parts fall off the conveyor.
- The intruder probes the perimeter and is absorbed — or is not.
- Ends on a still frame with the numbers.

That view is worth building because it is three assets at once: the **ten-second video that
sells the product**, the **graduation moment** in [07-screen-graduation.md](07-screen-graduation.md),
and the thing you put in front of a tech school. It just should not be the thing a learner
drags components around in.

Precedent worth noting: Factorio, the game this idea is really reaching for, is **2D top-down** —
and it is the one that reads clearly at a glance. Its 3D successors are prettier and
significantly harder to parse.

## Recommendation

| Idea | Verdict | Cost |
| --- | --- | --- |
| Factory semantics and vocabulary | **Adopt now.** Copy and emphasis only | very low |
| Queue depth as a visible pile of work | **Adopt now.** Value already computed | low |
| Intruder as a watchable event | **Adopt.** Scaffolding and rules exist | low–medium |
| Staged load ramp ("watch it break") | **Adopt.** Pure motion work | low |
| Isometric 3D factory | **Adopted — product owner's decision.** Designed in [16-screen-3d-factory.md](16-screen-3d-factory.md) | high |

## Decision

The 3D factory is **in**, as the product's primary visual identity. That was the owner's call
after the objections above were raised.

The objections are not thrown away — they become the design constraints. Sections 1–5 above name
five real failure modes for isometric graphs (occlusion, foreshortened comparison, ambiguous
editing, cost, accessibility), and every one of them has a design answer:

| Objection | Answer, specified in [16-screen-3d-factory.md](16-screen-3d-factory.md) |
| --- | --- |
| Occlusion | Grid-snapped floor with reserved lanes — collisions prevented by layout, not by luck |
| Foreshortened comparison | **Orthographic** projection, not perspective, plus billboarded labels at constant pixel size |
| Ambiguous editing | Dragging is constrained to the floor plane; height is never user-controlled |
| Cost | Ship the view first over the existing 2D graph model; the editor follows |
| Accessibility | A 2D top-down mode retained as a first-class equal, not a fallback |

Solving them is what separates this from the Cloudcraft screenshot. The remaining honest caveat
stands and is worth re-reading before committing engineering time: this competes for the same
weeks as the 35 authored lessons, and the lessons are what make the product teach. Sequencing
matters more than choosing.
