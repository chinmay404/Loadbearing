# 02 — Design language

## The metaphor: a drafting table

The existing palette is not a generic dark theme. Read the token names: `--ink`, `--chalk`,
`--graphite`, `--pencil`, `--brass`, `--rule`. Border radius is **2px** — nearly square.
The container class is `.sheet`. Borders are called *rules*, as a draughtsman would.

This is an engineer's drafting table under a warm lamp: dark waxed paper, chalk and graphite
marks, brass instruments. It is coherent, it is unusual, and it is worth more than a repaint.
**Design into this metaphor, not away from it.**

The one-line positioning: *an engineering instrument that happens to be a game* — never *a
game about engineering*.

## Tokens

Read from `client/src/styles.css`. Authoritative. Note the surfaces are **warm** near-blacks
(a red/yellow cast), not cold slate — this matters, and getting it wrong is the single most
common way a mockup ends up looking like every other dark dashboard.

### Surfaces

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#121110` | Page and canvas background |
| `--ink-2` | `#1a1917` | Panels, cards |
| `--ink-3` | `#23211e` | Raised elements, node fills, inputs |
| `--ink-4` | `#2d2a26` | Hover, pressed, selected fill |
| `--rule` | `#322e29` | Default 1px border |
| `--rule-2` | `#423d36` | Emphasised border, hover border |

### Marks

| Token | Value | Use |
| --- | --- | --- |
| `--chalk` | `#ede9e1` | Primary text, headings |
| `--graphite` | `#a09a90` | Secondary text, labels |
| `--pencil` | `#726c63` | Tertiary text, disabled, placeholders |

### Signals

| Token | Value | Meaning — do not reuse for anything else |
| --- | --- | --- |
| `--brass` | `#cfa349` | The accent. Primary action, current position, selection, XP |
| `--brass-dim` | `#3a2f16` | Brass at rest: fills, tracks, inactive accent |
| `--load` | `#e2913c` | Load and warning. A component working hard but coping |
| `--fail` | `#d9534b` | Failure, saturation, dropped traffic, open findings |
| `--pass` | `#7ba75f` | Passing gates, resolved findings, healthy utilisation |
| `--plum` | `#b07ca8` | Reserved — async and messaging accents |

**Signal discipline is the whole visual system.** Brass means *you*, `--load` means
*straining*, `--fail` means *broken*, `--pass` means *correct*. If a decorative element uses
`--fail`, the canvas stops being readable at a glance, which is the one thing it must be.

### Type

| Token | Stack | Use |
| --- | --- | --- |
| `--display` | Segoe UI Variable Display, Segoe UI Semibold, Inter, system-ui | Headings, screen titles |
| `--sheet-font` | Segoe UI Variable Text, Segoe UI, Inter, system-ui | All UI text |
| `--mono` | Cascadia Mono, Cascadia Code, Consolas, SF Mono | **Every number, without exception** |

Scale: 11.5 / 12 / 13 / 15 / 18 / 24 / 32. Small sizes carry most of the interface — this is
a dense instrument, and 12px `--graphite` labels are the workhorse.

**Every quantity is monospaced.** RPS, latency, utilisation, cost, capacity, scores, XP.
Numerals that shift width while animating destroy the instrument feeling instantly.

### Geometry

- Radius `2px` everywhere. Pills only for concept chips and gate chips.
- Borders `1px solid var(--rule)`. Depth comes from **border brightness and surface step**,
  never from drop shadows.
- Spacing scale: 4 / 7 / 10 / 12 / 14 / 20 / 28.
- Grid: 12-column at 1440px, 24px gutters. Canvas screens are two-pane, not grid-based.

## Component colours (the palette of 108)

Each architecture component type carries a hue by category. Real values from
`client/src/canvas/nodeCatalog.ts` — hues run brass-gold through olive to sage across the
categories, which keeps the whole canvas inside the drafting-table warmth:

| Category | Example | Colour |
| --- | --- | --- |
| Edge & Traffic | CDN | `#cfa349` |
| Edge & Traffic | Load Balancer | `#d9b45f` |
| Edge & Traffic | API Gateway | `#e3c47a` |
| Data | Cache | `#a8b56b` |
| Data | Read Replica | `#8d9c54` |
| Async | Worker | `#84b586` |

Full category list, in palette order: Edge & Traffic, Compute, Data, Async, Integration,
Media, AI, Security, Ops, Layout.

A node shows its category colour as a **left edge bar**, not as a fill — fills stay
`--ink-3` so utilisation bars and strain colouring remain readable on top.

## The core aesthetic thesis

> The arithmetic is the spectacle.

The product already computes utilisation, the queueing knee, dropped traffic and monthly
cost. Today those numbers live in a side panel. The redesign's job is to move them **onto the
objects**: utilisation as a fill level inside the node, latency inflating visibly as a
component approaches saturation, dropped requests physically falling off the wire.

Nothing needs to be invented to make this impressive. It needs to be *shown*.

## What to avoid

- **Duolingo's look.** Rounded cartoon shapes, saturated green, mascot, bouncy everything.
  The mechanics transfer; the aesthetic does not, and it would cost credibility with the
  audience that pays. Copy the *path*, not the owl.
- **Cold slate.** `#0f172a`-family blues. The palette is warm; drifting cool loses the
  drafting-table identity and makes it interchangeable.
- **Drop shadows and glassmorphism.** Wrong century for this metaphor.
- **Decorative motion.** A still canvas must mean a still system. Idle animation lies.
- **Gradients on data.** A bar whose fill is a gradient cannot be read as a value.
- **Rounded avatars, badges with ribbons, confetti.** Achievement can be quiet. A gate
  turning `--pass` is a bigger reward here than a trophy, because it means something.
- **Spinners on the canvas.** The model is local arithmetic. There is nothing to wait for,
  and a spinner would imply otherwise.
