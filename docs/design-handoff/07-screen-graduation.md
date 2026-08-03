# 07 — Screen: Graduation

**Fires once, when chapter 7's checkpoint clears. The highest-leverage screen in the product.**

## Job

Convert a learner into a user. Make someone who arrived not knowing what a load balancer was
look at a real, unscaffolded system-design problem and think *I can do that* — then walk into
the full product.

Everything else in this package is craft. This screen is the business case.

## Why it exists

The original product review treated the beginner ladder as the goal. It is not. A ladder that
does not hand over is a separate game sharing a repository. This screen is the hand-off, and it
works by **showing the learner evidence of their own competence** rather than congratulating
them.

## Layout — desktop 1440, full bleed

No header, no chrome, no panel. `--ink` background, edge to edge. Vertically centred, max-width
1180px.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                                                               │
│                                                                               │
│                          You just did this.                                   │  48px display
│                                                                               │
│   ┌─────────────────────────────┐      ┌─────────────────────────────┐        │
│   │                             │      │                             │        │
│   │   [the learner's actual     │      │   [the same problem,        │        │
│   │    checkpoint drawing,      │      │    unscaffolded — full      │        │
│   │    rendered live, dots      │      │    108-component palette    │        │
│   │    still flowing]           │      │    visible down the side,   │        │
│   │                             │      │    blank canvas, editable   │        │
│   │                             │      │    flow row]                │        │
│   └─────────────────────────────┘      └─────────────────────────────┘        │
│     what you drew                        the real thing                       │
│     7 chapters · 35 steps · 6 gates      25 sheets · 108 components           │
│                                                                               │
│                        ┌──────────────────────────┐                           │
│                        │   Open the full bank     │                           │
│                        └──────────────────────────┘                           │
│                             the ladder stays where it is                      │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## The two canvases

**Left — theirs.** Not a screenshot: the live canvas renderer, their actual final drawing,
particles still moving, utilisation bars still in band. Slightly dimmed (85% opacity) and
non-interactive. It is a trophy, and it is a trophy *because it works*.

**Right — the real thing.** The same problem with the scaffolding gone: blank canvas, the
editable flow row where the read-only strip used to be, and the full palette visible as a dense
column of ~108 tiny component chips down one side. Do not hide the density. The density is the
promise — *this is how much there is, and you now have the vocabulary for the first slice of it.*

Both canvases: 1px `--rule` border, 2px radius, `--ink-2` fill, 520×340 each, 40px gutter.

**Captions** under each: label in `--sheet-font` 13px `--chalk`, then a `--mono` 11.5px
`--graphite` stat line. The numbers are the argument — the left column is what they finished,
the right column is what is now available.

## Copy

Headline: **"You just did this."** `--display` 48px `--chalk`. Nothing else. No "congratulations",
no "well done", no exclamation mark. The understatement is the tone of the whole product, and it
is more flattering than enthusiasm.

Button: *Open the full bank* — filled `--brass`, `--ink` text, 260×48, `--display` 16px.

Under the button, `--pencil` 12px: *"the ladder stays where it is"* — removes the fear of losing
progress, which is the only real reason someone would hesitate here.

Optional second line above the headline, `--mono` 11px `--brass`, letter-spacing 0.12em:
`CHAPTER 7 OF 7 · COMPLETE`.

## Motion

The one place in the product where a slow, deliberate sequence is right. See
[09-motion-spec.md](09-motion-spec.md#11-graduation). Roughly: their canvas fades in first and
alone; the real one arrives beside it; the headline draws; the button last. Then complete
stillness. No confetti — the two canvases sitting side by side *are* the celebration.

## States

1. **The moment** — as above, animating in.
2. **Settled** — after the animation, everything static, button focused and keyboard-ready.
3. **Revisited** — reachable from the Path's end marker afterwards. Same layout, no animation,
   headline changes to *"You finished the ladder."*

## Do not

- Use confetti, a mascot, a trophy graphic, a certificate, or a share-to-social prompt.
- Show a score, a rank, or a percentile.
- Put a second competing call to action beside the button.
- Screenshot the left canvas. Render it live — the moving dots are what make it feel alive
  rather than commemorative.
