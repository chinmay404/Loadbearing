# Design system and re-skin — design

Date: 2026-10-04. Sub-project 1 of 5 (design system → component contracts → learner levels →
challenges → Jev decision layer). Approved in conversation; prototypes live in
`.superpowers/brainstorm/` (gitignored): `bench-prototype.html` (the direction) and
`node-designs-v2.html` (the two node skins).

## Intent

The current UI reads as a dense, AI-made tool. Loadbearing should feel like a learning platform:
light by default with a dark toggle, every component designed, motion that explains state.
Overturns the August handoff's "keep the warm dark ink palette" non-negotiable.

## Decisions

- **Direction "Bench"**: light bench `#EEEEE9` with pegboard dots, white surfaces, Geist for text and
  Geist Mono for every number. Cobalt (`#3047F0` light / `#8C9DFF` dark) is the only accent and means
  *you* — primary action, selection, progress. Green / amber / red mean healthy / straining /
  failing and nothing else. Plum is reserved for async and replication connections.
- **Two node skins**: *Instruments* (default) and *Rack* (machined faceplate, glowing screen, three
  status lights, jack sockets). A per-browser setting on the canvas toolbar.
- **Gauge model separate from skin**: each engine family maps to one gauge kind; a pure function
  turns (SimNodeResult + node attrs) into a `GaugeModel`; each skin draws it.

  | Family | Gauge |
  | --- | --- |
  | origin | traffic sparkline + rate |
  | compute, ai | worker slots (replicas × concurrency, busy share, waiting) |
  | datastore | tank fill + connection pool ticks + wait |
  | cache | hit-rate ring + memory |
  | messaging | queue tube + depth + oldest |
  | routing | fan-out split across backends |
  | external | latency against timeout |
  | control, boundary | status light only |

  Gauges show only numbers the engine computes, or values derived by a documented formula. Health
  comes from the engine's `NodeState`; a killed node is grey with its light off. Before a run,
  gauges rest.
- **Density**: roomy for learning, home and review surfaces; `data-density="compact"` for data-heavy
  panels (Inspector, Checks, Flows, Code).
- **Compact level of detail**: below 60% zoom nodes render as chips (icon, name, ring, headline value).
- **Performance**: gauges and request particles run in one animation loop outside React, reading the
  canvas store imperatively; no per-frame React renders; paused when hidden or idle; particle cap.
- **Saved diagrams**: nodes grow (≈208–212px wide). A one-click, undoable "Make room" spreads an
  overlapping layout about its centroid. Never automatic.
- **Theme and node skin** persist in localStorage (per browser), default theme from
  `prefers-color-scheme`, set before first paint to avoid a flash.
- **Shell**: the icon rail becomes a 56px top bar with labelled navigation; Settings and the grader
  model move into the avatar menu.
- **Implementation**: plain CSS on CSS custom properties (no Tailwind, no CSS-in-JS), `styles.css`
  split into layers, self-hosted Geist via `@fontsource-variable`, CSS transitions + WAAPI for
  motion (no animation library). Old token names are aliased onto the new semantic tokens first so
  every screen becomes theme-aware at once, then each surface is restyled properly.
- Lesson-specific pieces from the prototype (goal checklist, scenario card, parts tray) are built
  with the learner-levels project, not here.

## Tokens

Semantic names (old drafting-table names alias onto them during migration):
`--bg --surface --surface-2 --surface-3 --bench --peg --line --line-2 --fg --fg-2 --muted --faint
--accent --accent-fg --accent-soft --accent-line --pass(-soft) --load(-soft) --fail(-soft) --plum
--seg-off --module-top --module-bot --module-edge --shadow-raised --shadow-float --cable --dot`.

Type scale 11 / 12 / 13 / 14 / 15 / 17 / 22 / 29. Spacing on a 4px grid. Radius 6 / 10 / 14 / 18 /
pill. Elevation: flat (border), raised (module shadow), floating. Motion: `--ease-out
cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out cubic-bezier(0.77,0,0.175,1)`; durations press 140,
hover 150, small 200, panel 280, enter 340, theme reveal 560 ms.

## Motion

Press scale 0.97 (140ms). Hover colour 150ms; node lift 2px on fine pointers only. Popovers from
their trigger 180ms. Tab indicator 220ms. Node enter from scale 0.94 + 2px blur, 340ms; cables draw
in. Invalid drop: shake + explanation. Health colour 200ms; failing light blinks 1 Hz. Gauge values
smoothed; numbers tabular. Theme: circular reveal via View Transitions, instant fallback. Never
animated: keyboard shortcuts, command palette, undo/redo; an idle canvas is still. Reduced motion:
no particles, shake, blink or movement; colour and opacity fades stay.

## Order of work

1. Foundation — tokens + aliases, fonts, base elements, theme init and toggle, top-bar shell,
   sign-in.
2. Canvas — background, nodes (Instruments, Rack, compact), cables, particle layer, sim HUD and
   timeline, toolbar, palette, quick add, notes/pen, markers and ghosts.
3. Drawing-board panels (compact density) — Brief, Components, Flows, Inspector, Checks, Code,
   Notes, Review, Ask, Attack, History.
4. Pages (roomy) — Problem index, Progress, Reference, Compose, Projects, Note library, Settings,
   command palette, reference-design modal.

Each step keeps `npm run typecheck` and `npm test` green.

## Verification

Unit tests: gauge model per family, health mapping, LOD threshold, "Make room"; WCAG AA contrast of
token text pairs in both themes; a guard that fails on hard-coded hex colours outside token files.
Browser: drive the real app with a throwaway account in both themes, both skins, compact zoom and
reduced motion. Performance: 30 running nodes at 60fps without per-frame React commits.
