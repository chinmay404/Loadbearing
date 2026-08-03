# 04 — Screen: The Path

**Beginner home. The only navigation a beginner gets.**

## Job

Answer one question with zero reading: *what do I do next?* Everything else on this screen is
secondary to the single glowing node.

## Layout — desktop 1440

Single centred column, max-width **620px**, scrolling vertically. Deliberately narrow — this
is a spine, not a dashboard. A slim fixed rail on the right, 180px, and generous empty ink on
both sides. Empty space here is the point: the contrast with the dense canvas screens is what
makes the ladder feel calm.

```
┌──────────────────────────────────────────────────────────────────┐
│  Loadbearing                          [full bank ↗]  [account]   │  56px header
├──────────────────────────────────────────────────────────────────┤
│                                                    ┌───────────┐ │
│        CHAPTER 1  ·  complete                      │  ▲ 4      │ │
│        One box, one problem                        │  day      │ │
│        ●───●───●───●───●───◆                       │  streak   │ │
│                                                    │           │ │
│        CHAPTER 2  ·  in progress                   │  340 XP   │ │
│        Two of everything                           │           │ │
│        What breaks when there is only one           │  ───────  │ │
│        ●───●───◉───○───○───◇                       │  NEXT     │ │
│           ↑ current: "Add a second replica"        │  UNLOCK   │ │
│           [ Continue ]                             │  Ch.3 at  │ │
│                                                    │  load-bal │ │
│        CHAPTER 3  🔒 locked                        │  60%      │ │
│        Don't ask twice                             │  ▓▓▓▓░ 48%│ │
│        Opens when load balancing reaches 60%        └───────────┘ │
│        ○···○···○···○···○···◇                                     │
│                                                                  │
```

## Regions

### Header, 56px

`--ink-2`, 1px `--rule` bottom. Wordmark left in `--display` 15px `--chalk`. Right: a quiet
text link *full bank ↗* (the depth switch — present but not shouting) and an account glyph.
Nothing else. No nav items.

### Chapter section

Repeats seven times, 48px vertical gap between chapters.

- **Eyebrow**: `CHAPTER 2 · IN PROGRESS`, `--mono` 11px, letter-spacing 0.08em, `--pencil`.
  Status word takes the state colour: complete `--pass`, in progress `--brass`, locked
  `--pencil`.
- **Title**: `--display` 24px `--chalk`. Locked chapters at `--pencil`.
- **Promise line**: one sentence, `--sheet-font` 13px `--graphite`. What you will be able to do.
- **The step row**: five circles and one diamond, connected by a 1px line, 44px apart.
- **Current-step caption**, only on the in-progress chapter: the step's own title in 13px
  `--chalk`, with a small `↑` in `--brass`.
- **Continue button**, only on the in-progress chapter: brass fill, `--ink` text, 2px radius,
  36px tall, 140px wide. The only filled button on the screen.
- **Unlock condition**, only on locked chapters: 12px `--pencil` — *"Opens when load
  balancing reaches 60%"*. Naming the concept, never a point total.

### Step nodes

20px circles. The checkpoint is a 26px diamond (rotated square, 2px radius corners).

| State | Fill | Border | Content |
| --- | --- | --- | --- |
| complete | `--brass` | none | 10px `--ink` check |
| instant-cleared | `--brass-dim` | 1px `--brass` | 10px `--brass` check + tiny `»` |
| current | `--ink-3` | 2px `--brass` | 6px `--brass` dot, soft pulse |
| available | `--ink-3` | 1px `--rule-2` | empty |
| locked | transparent | 1px dashed `--rule` | empty |

Connector line: `--brass` between completed steps, `--rule` ahead, dashed `--rule` in locked
chapters.

**Instant-cleared needs its own visual** — an experienced user self-declaring "new" will have
a row of them, and they should read as *skipped because you already knew it*, not as *earned
the hard way*.

### Right rail, 180px, fixed

`--ink-2` card, 1px `--rule`.

- **Day streak** — `--mono` 32px `--brass`, label 11.5px `--pencil`. A small flame or chevron
  glyph, `--brass`, 14px.
- **XP** — `--mono` 18px `--chalk`. Cosmetic. Never phrased as unlocking anything.
- **Next unlock** — the honest progression display: concept name, current mastery percentage,
  and a thin 4px bar, `--brass` on `--brass-dim`. This is where a lesser design would put
  "48/60 points". It must name the concept instead.

## States

**Day one, nothing complete.** Chapter 1 expanded and inviting; chapters 2–7 collapsed to
title + lock line only, so the screen is not a wall of locks. Rail shows `0` streak, `0` XP,
and instead of "next unlock" a single line: *"Finish your first step and this fills in."*
The Continue button reads **Start** and is the only interactive element above the fold.

**Mid-ladder.** As drawn above.

**Chapter just unlocked.** The newly opened chapter animates in (see
[09-motion-spec.md](09-motion-spec.md#9-chapter-unlock)) and auto-scrolls into view. Fires
once only.

**All seven complete.** Every chapter `--pass`. The spine's end shows a graduation marker with
one line — *"You finished the ladder"* — and a brass button, *Open the full bank*. The Path
remains browsable for revisiting.

## Mobile, 375

The only screen that gets a real mobile treatment. Nobody draws architecture on a phone, but
walking the ladder on a commute is a genuine use case.

- Single column, 16px gutters, spine centred.
- Rail becomes a 3-up horizontal strip pinned under the header: streak · XP · next unlock.
- Step circles 24px (touch target 44px with padding).
- Chapters collapse to title + progress dots; tapping expands one at a time.
- Continue button becomes full-width, pinned to the bottom, 48px.

## Do not

- Add a sidebar, breadcrumbs, or tabs. One spine.
- Show a total point score anywhere.
- Use more than one filled button on the screen.
- Put the streak above the current step in visual weight. The step is the hero; the streak is
  a souvenir.
