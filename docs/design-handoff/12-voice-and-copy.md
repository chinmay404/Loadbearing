# 12 — Voice and copy

The interface copy matters more than the pixels here. A beginner's entire experience of "is this
for me?" is decided by whether the words feel like a colleague explaining something or a course
talking down at them.

## The voice already exists

The rule engine's findings are written in a distinctive voice and it is the product's biggest
asset. Study one:

> Load Balancer balances across one instance — one instance behind a load balancer is an extra
> hop and an extra thing to fail, not redundancy; when that instance dies the balancer keeps
> forwarding to a corpse.

What it does:

1. **Names the situation factually** — "balances across one instance."
2. **Explains the mechanism** — an extra hop and an extra thing to fail.
3. **Ends on a concrete image** — *forwarding to a corpse.*

It never says "you made a mistake," never says "oops," never uses an exclamation mark, and never
softens the point. It assumes the reader is an adult who wants to know how the thing actually
fails. **All new copy matches this.**

## Rules

**Explain the mechanism, not the rule.** Not *"you should always use a load balancer."* Instead:
*"when that instance dies the balancer keeps forwarding to a corpse."* The mechanism is what
transfers to a problem the learner has not seen.

**Second person, present tense, active.** *"Your API is one instance."* Not *"The API has been
configured with a single instance."*

**Numbers are specific and real.** *"34% of traffic dropped"* — never *"a lot of traffic was
dropped."* The product's authority rests on this.

**No exclamation marks. Anywhere.** Including success states. *"Morning surge — PASS"* is more
satisfying than *"Great job!"* because it is information.

**Say "not yet", never "wrong".** Failure copy states what happened and what was allowed, then
stops. The finding already explains why.

**Never apologise on the user's behalf.** No *"oops"*, no *"don't worry"*, no *"no problem!"*.

**Understate rewards.** *"You just did this."* is the graduation headline. Not *"Congratulations,
you're an architect!"* The understatement flatters; the enthusiasm patronises.

**Glossed, not dumbed down.** A beginner screen can say "p99" as long as something nearby says
what it means. Never replace the real term with a fake-friendly one — the vocabulary *is* the
product.

**Name the concept, never the score.** *"Opens when load balancing reaches 60%"* — never *"48/60
points"*. This is a copy rule enforcing a product decision.

## Patterns

| Situation | Write | Never |
| --- | --- | --- |
| Locked chapter | Opens when load balancing reaches 60% | 🔒 Locked — earn 60 XP |
| Failed run | Morning surge — FAIL · 34% dropped (max 1%) | Not quite! Try again 😊 |
| Passed run | Morning surge — PASS · 0.2% dropped (max 1%) | Perfect! You nailed it! |
| Step complete | Step 3 of 5 · +20 XP | Awesome work! Keep the streak alive! |
| Over budget | Over budget — a cheaper shape exists. | ⚠️ Warning: budget exceeded! |
| Nothing wrong yet | Nothing structural is wrong with this. Now make the gate pass. | All clear! ✅ |
| Empty analytics | Submit a design and this fills in. | No data available |
| Nothing due | Nothing due. Next review in 4 days. | You're all caught up! 🎉 |
| Graduation | You just did this. | Congratulations, graduate! |
| Depth switch | Either way you can switch whenever you like. | Don't worry, you can change this later! |
| Read-only flow strip | On real sheets you write this yourself. | This will be unlocked later |

## Microcopy inventory to write

Every one of these needs an authored line — a designer leaving them as `Lorem` guarantees they
ship as `Lorem`:

- Entry question and its two choices, plus the reassurance line
- Seven chapter titles and seven promise lines *(drafted in [11-content-inventory.md](11-content-inventory.md#the-chapter-ladder))*
- 35 micro-step titles and 35 two-sentence briefs
- All five empty states *(listed in [10-states-matrix.md](10-states-matrix.md#empty-states-worth-authoring-properly))*
- Locked-palette-card label: `Cache · ch.3`
- Budget over-limit note
- Chapter-complete banner, including the level-unlocked line
- Graduation headline, captions, button, sub-line
- Due-strip copy, both states
- Offline strip
- Engine-disagrees-with-server note

## Emoji and iconography

**No emoji in product copy.** The lock glyph on locked chapters should be a drawn 1px icon, not
🔒. Emoji break the drafting-table metaphor harder than any colour mistake, because they carry a
different century's visual language.

Icons: 1px stroke, 16px grid, geometric, no filled shapes except where a component's category
colour is the fill. The existing component icon set is the reference.

## The tone test

Read any line and ask: *would a senior engineer say this to a junior they respected?*

- *"Oops! That didn't work — try again!"* → no.
- *"34% of your traffic is on the floor. The balancer has one backend."* → yes.
