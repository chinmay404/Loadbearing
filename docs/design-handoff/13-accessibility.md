# 13 — Accessibility

Not a compliance checklist. Two of these constraints are load-bearing for the *product*, because
the whole interface encodes state in colour and motion — the two channels most likely to fail a
real user.

## The two that matter most here

### 1 · Colour is never the only signal

The canvas says "this component is in trouble" with `--fail` and jitter. A red/green colour-blind
user (≈8% of men) cannot see the `--pass` / `--fail` distinction reliably, and `--load` (`#e2913c`)
against `--fail` (`#d9534b`) is a hard pair.

Every state therefore carries a **second channel**:

| State | Colour | Second signal |
| --- | --- | --- |
| Gate pass | `--pass` | Filled hex glyph `⬢` + the word `PASS` |
| Gate fail | `--fail` | Same glyph + the word `FAIL` + the numbers |
| Gate not run | `--pencil` | Hollow glyph `⬡` + the words `not run` |
| Finding open | `--fail` dot | Filled dot |
| Finding resolved | `--pass` dot | Strike-through — a shape change, not a hue change |
| Node saturated | `--fail` bar | The numeric percentage, always visible |
| Node shedding | `--fail` | A `SHEDDING` text chip |
| Weak concept chip | `--load` | Nothing yet — **add a marker**, e.g. a leading `·` |
| Step complete | `--brass` fill | Check mark glyph |
| Step locked | dim | Dashed border + lock glyph |

Test every screen in greyscale. If a state becomes unreadable, it needs a second channel.

### 2 · Reduced motion must leave the product fully playable

`prefers-reduced-motion: reduce` removes particles, jitter, spring and sweeps — which is most of
how the canvas communicates. So:

- Every edge gains a static `--mono` rps label where its particles were.
- Every node's utilisation percentage is **always** rendered as text, animation or not.
- Drop rate appears as a text figure on the edge (`34% dropped`), not only as falling dots.
- Colour transitions, bar widths, strike-through and numeral counting are kept.

**Play the entire chapter-2 micro-step with the flag on.** It must be completable and the
feedback must still be legible. If it is not, the design has put meaning in motion alone.

Full details: [09-motion-spec.md §12](09-motion-spec.md#12--reduced-motion--prefers-reduced-motion-reduce).

## Contrast

Target **WCAG AA**: 4.5:1 body text, 3:1 large text and UI boundaries.

Checked against `--ink` (`#121110`) and `--ink-2` (`#1a1917`):

| Token | On `--ink` | Verdict |
| --- | --- | --- |
| `--chalk` `#ede9e1` | ~15:1 | pass everywhere |
| `--graphite` `#a09a90` | ~7:1 | pass for body |
| `--pencil` `#726c63` | ~3.4:1 | **large text and non-essential only** — never body copy, never a value the user must read |
| `--brass` `#cfa349` | ~8:1 | pass |
| `--load` `#e2913c` | ~7:1 | pass |
| `--fail` `#d9534b` | ~4.6:1 | pass for body, marginal at 11px — do not go smaller |
| `--pass` `#7ba75f` | ~6:1 | pass |

The one real trap is `--pencil`. It is right for eyebrow labels, locked-state text and
placeholders, and wrong for anything a user needs to read. Audit every `--pencil` use against
"could a user miss this and be confused?"

Brass text on brass-dim fill (concept chips, due pills) needs checking at 10.5px — if it fails,
raise the text to `--chalk` and keep brass for the border.

## Keyboard

The micro-step loop must be completable without a mouse. It is the core loop and it repeats 35
times.

```
Tab / Shift+Tab   move through palette → canvas → findings → RUN
Enter / Space     pick up the focused palette component
Arrows            move the held component across the canvas grid
Enter             drop it into the focused gap
R                 run
Esc               cancel a held component
?                 keyboard help
```

Focus ring: **2px `--brass`, 2px offset**, on every interactive element including canvas nodes
and gate chips. Never removed, never replaced by a colour change alone.

Existing product shortcuts to preserve: `V` select · `N` note · `P` pen · `L` pin ·
`Ctrl+K` add component by name · `Ctrl+Z` undo.

## Screen readers

The canvas is the hard part. An SVG graph of boxes is opaque, so provide a parallel structure:

- The canvas carries an `aria-label` summarising the system: *"6 components, 2 flows, 1 component
  over capacity."*
- Each node is a focusable element labelled *"API, 94% utilised, 2 replicas, over capacity."*
- Each edge: *"API to SQL Database, synchronous, 900 requests per second."*
- Gate results and finding changes announce via a **polite live region** — never assertive, or a
  slider scrub would fire dozens of interruptions.
- The scrubber announces on release, not per frame.

## Targets and text

- Minimum interactive target 32×32 desktop, **44×44 mobile** (spine step circles are 24px visual
  with padding to 44px).
- Body text never below 11.5px, and 11.5px only for `--graphite`/`--chalk` labels — never for
  `--pencil`, never for `--fail`.
- Layout must reflow at 200% text zoom: panel scrolls, canvas stays usable, nothing clips.
- No text baked into images — all labels live text.
