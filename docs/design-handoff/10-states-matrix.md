# 10 — States matrix

A design that delivers one beautiful frame per screen is not shippable. This is the checklist to
review returned work against. Most first passes are missing states, not missing polish.

## Element states

| Element | States |
| --- | --- |
| **Spine step node** | locked · available · current · complete · instant-cleared |
| **Spine checkpoint (diamond)** | locked · available · current · complete |
| **Spine connector** | ahead · completed · locked (dashed) |
| **Chapter section** | locked-collapsed · locked-expanded · in-progress · complete · just-unlocked |
| **Gate chip** | not-run · pass · fail |
| **Architecture node** | normal · hover · selected · pinned · strained (0.70–0.85) · saturated (0.85–1.0) · shedding (≥1.0) · killed · ghost-suggestion · guilty (named by an open finding) |
| **Edge** | sync · async (dashed) · replication (reversed, dim) · dimmed (dead path) · pending-valid · pending-invalid |
| **The gap** | empty (breathing) · hovered-with-valid-drag · filled |
| **Finding row** | open · resolved · dismissed |
| **Palette card** | available · hover · dragging · locked-this-chapter |
| **Budget** | under · over 80% · exceeded |
| **Problem card** | not attempted · in progress · attempted · mastered · lab · custom |
| **Concept chip** | neutral · weak (`--load`) · due for review (`--brass`) |
| **Due strip** | has items · nothing due · no attempts yet |
| **Run button** | idle (RUN) · after first run (RUN AGAIN) · disabled (nothing placed) |
| **Flow strip hop** | present · missing · not-yet-drawn |

## Screen states

### The Path
- Day one — nothing complete, chapters 2–7 collapsed, button reads **Start**
- Mid-ladder
- Chapter just unlocked (animating, once only)
- All seven complete
- Mobile 375 — each of the above

### Micro-step
- Fresh — gap breathing, gate not-run, findings open
- Dragging over an invalid target
- Placed but not run
- Failed run — saturation, jitter, dots dropping, findings open
- **Passed run** — the money shot
- Over budget but otherwise passing

### Checkpoint
- Fresh — several gaps, flow strip showing missing hops
- Partially correct — one gate green, one red simultaneously
- All gates green but over budget (cannot complete)
- Complete — banner, level-unlocked line
- Revisited after clearing

### Graduation
- The moment (animating)
- Settled
- Revisited later

### Cockpit
- Cold start — zero attempts, empty rail, no due strip
- Warm
- Filtered to weak concepts
- Everything mastered

## Cross-cutting states — the ones most often forgotten

| State | Requirement |
| --- | --- |
| **Reduced motion** | Every screen fully usable and readable with all animation disabled |
| **Keyboard only** | Visible focus ring — 2px `--brass`, 2px offset — on every interactive element; the whole micro-step loop completable without a mouse |
| **Offline / server unreachable** | Beginner loop keeps working (local arithmetic); a quiet `--load` strip says what is unavailable. Never a blocking modal. |
| **Engine disagrees with server verify** | A `--load` note naming both numbers. Never silently pick one. |
| **Long content** | A 40-character component label; a five-line finding; a 12-hop flow. Nothing may clip or overflow. |
| **Text zoom 200%** | Layout reflows, panel scrolls, canvas stays usable |
| **Very wide viewport (2560px)** | Canvas grows; panel and rail stay fixed-width. Nothing stretches to absurdity. |
| **Narrow desktop (1024px)** | Panel narrows to 380px minimum, then the canvas scrolls rather than the panel collapsing |
| **First-ever session, no data anywhere** | Every analytical surface has an authored empty state, not a blank box |

## Empty states worth authoring properly

Each needs one written line, not a shrug:

- Path, day one: *"Finish your first step and this fills in."*
- Cockpit rail, no attempts: *"Submit a design and this fills in."*
- Due strip, nothing overdue: *"Nothing due. Next review in 4 days."*
- Findings panel, nothing wrong: *"Nothing structural is wrong with this. Now make the gate pass."*
- Trend chart, one data point: *"Submit a couple of designs and the trend appears here."*

That last one already exists in the product and its tone is the reference for the others.
