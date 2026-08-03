# 14 — References

What to take from each, and — more usefully — what **not** to take. Sources are listed at the
bottom. These were gathered from search summaries and product documentation, not from deep
teardowns of each product; treat the specific claims as directional and verify anything you
plan to copy closely.

---

## Duolingo — the path, and why it exists

**Take: the path itself, and the reason for it.** Duolingo replaced its skill *tree* with a
single winding *path*, and the stated reason maps exactly onto this project's problem. Luis von
Ahn's first objective for the redesign was **to decrease confusion**: under the tree, learners
were never sure whether to press forward or hang back. The path removes the question. The
redesign also deleted "cracked" skills — the decay indicator that made learners feel punished
for not revisiting.

That is precisely the memo's *"don't know what to learn next"* gap, solved by structure rather
than content. It is why [04-screen-the-path.md](04-screen-the-path.md) is one narrow spine with
no sidebar and exactly one glowing node.

**Take: XP and streaks that unlock nothing.** Duolingo's XP feeds streaks, daily goals and
leaderboards. Units unlock by *completing the previous unit*. This separation is the argument
against a points gate — see [01-product-brief.md](01-product-brief.md#progression).

**Do not take: the aesthetic.** Rounded cartoon shapes, saturated green, the mascot, bouncy
easing on everything. Loadbearing's audience includes people evaluating whether to trust its
numbers.

## Khan Academy — the best mastery model in edtech, and a concrete steal

**Take: named mastery bands instead of raw percentages.** Khan Academy uses four named levels —
*attempted* → *familiar* → *proficient* → *mastered* — with explicit criteria, and gates further
content on demonstrated mastery rather than time spent. Mastery Challenges themselves unlock on
a *composition* of states: familiar on 3+ skills, proficient on 1+, and a 12-hour cooldown.

**Actionable change to this design:** Loadbearing tracks per-concept mastery as an exponential
moving average, and the current plan surfaces it as a percentage (*"load balancing 48%"*). Raw
percentages read as grading. Name the bands instead:

| EMA | Band |
| --- | --- |
| never assessed | *not started* |
| < 0.45 | *attempted* |
| 0.45 – 0.65 | *familiar* |
| 0.65 – 0.80 | *proficient* |
| ≥ 0.80 | *solid* |

Then the Path's unlock line becomes *"Opens when load balancing reaches familiar"* — legible,
non-numeric, and still ungrindable. Apply this to the heatmap tooltips and weak-concept chips in
[08-screen-cockpit.md](08-screen-cockpit.md) too.

**Do not take:** Mastery *Points* (100 per skill, 50 for familiar…). It is the currency layer
this product deliberately rejects, and Khan Academy can carry it because its exercises have
single correct answers.

## Brilliant — interactivity as the whole method

**Take: no videos, ever.** Brilliant's method is entirely interactive — manipulating diagrams and
data rather than watching. Loadbearing's micro-step is already this, and should never grow a
"watch this first" step.

**Take: wrong answers open into exploration.** When a Brilliant learner gets something wrong, the
explanation itself is interactive. The analogue here is the `Why?` link on a finding — it should
open a concept card the learner can *poke at*, ideally a miniature runnable canvas showing the
failure, not a wall of prose.

**Take: thematic loading, not spinners.** Brilliant uses tangram-style animations that reinforce
its brand instead of generic spinners. Loadbearing's version of this is stronger: it has
*nothing to load* in the beginner loop. Where a wait genuinely exists (a grader call on an
advanced sheet), animate the *pipeline* — deterministic checks, then retrieval, then the model —
so the wait explains the architecture of the review.

**Take: the "Level Gameboard" idea** — a visible board for a chapter's progress. Chapter sections
on the Path serve this role.

**Do not take: whimsical celebration flourishes.** Brilliant's in-lesson celebrations suit its
brand. Here, a gate flipping to `--pass` with real numbers beside it is the celebration, and
adding sparkle on top would undercut it.

## sFlow-RT `particle` — the closest prior art for the canvas

An open-source real-time network traffic visualiser that animates packets as particles between
hosts. Directly relevant technical decisions:

- **Particle size and frequency encode traffic intensity** — the same mapping used in
  [09-motion-spec.md §1](09-motion-spec.md#1--particle-flow-on-edges).
- **Particles follow quadratic Bézier curves rather than straight lines.** Worth adopting:
  curves read as *flow*, straight lines read as *decoration*.
- **Colour encodes traffic type** — Loadbearing's equivalent is the source node's category hue.

Also relevant: network-monitoring tooling has long combined animated flow with the ability to
**activate/deactivate nodes** and watch the effect. That is exactly Loadbearing's component-kill
feature, and it is worth knowing the interaction pattern is established rather than novel — the
novelty is that here the numbers come from a design the user drew.

## Architecture diagramming tools — the competitive frame

Worth knowing what the adjacent market looks like, because it tells you what Loadbearing must
*not* look like.

- **Eraser** splits the screen between a markdown editor and a canvas, so the "why" sits beside
  the "how", and offers text-to-diagram generation.
- **Cloudcraft** (now inside Datadog) generates diagrams from real cloud state.
- **Excalidraw** is deliberately low-fidelity and fast, optimised for sketching.
- Across recent round-ups, code-to-diagram is the feature these tools compete on.

**The strategic read:** every one of these draws a picture of a system. **None of them tells you
whether the system works.** Loadbearing's simulator is the differentiator, so the UI must not
look like a diagramming tool with a side panel of stats — the numbers have to be *on the
objects*. That is the thesis in [02-design-language.md](02-design-language.md#the-core-aesthetic-thesis),
and this is the evidence for it.

## General gamification research — the caution

Research on gamified learning is consistent on one point: it works when game elements are tied
directly to the learning objective, and backfires when it shifts attention to extrinsic rewards.
Points awarded for *demonstrating mastery* behave differently from points awarded for *completing
tasks*.

For this product the tie is unusually clean — the reward *is* the arithmetic saying your design
survives. Every mechanic should be checked against that: does it reward understanding, or does it
reward showing up? Streaks reward showing up, which is fine as long as they unlock nothing.

---

## Sources

- [Duolingo's new home screen design](https://blog.duolingo.com/new-duolingo-home-screen-design)
- [Duolingo redesign interview — Luis von Ahn, NBC News](https://www.nbcnews.com/tech/tech-news/duolingos-update-redesign-luis-von-ahn-interview-rcna44655)
- [Duolingo new learning path — honest review, duoplanet](https://duoplanet.com/duolingo-new-learning-path-review/)
- [How do Khan Academy's Mastery levels work?](https://support.khanacademy.org/hc/en-us/articles/5548760867853--How-do-Khan-Academy-s-Mastery-levels-work)
- [What are Mastery Challenges? — Khan Academy](https://support.khanacademy.org/hc/en-us/articles/360037494231-What-are-Mastery-Challenges)
- [Why Khan Academy uses "skills to proficient"](https://blog.khanacademy.org/why-khan-academy-will-be-using-skills-to-proficient-to-measure-learning-outcomes/)
- [Brilliant.org × ustwo — design case study](https://ustwo.com/work/brilliant/)
- [How Brilliant.org motivates learners with Rive animations](https://rive.app/blog/how-brilliant-org-motivates-learners-with-rive-animations)
- [Brilliant UI breakdown — screensdesign](https://screensdesign.com/showcase/brilliant-learn-by-doing)
- [About Brilliant](https://brilliant.org/about/)
- [sflow-rt/particle — animated particle traffic visualisation (GitHub)](https://github.com/sflow-rt/particle)
- [Visualizing real-time network traffic flows at scale — sFlow blog](https://blog.sflow.com/2018/07/visualizing-real-time-network-traffic.html)
- [Network monitoring visualization — yWorks](https://www.yworks.com/pages/network-monitoring-visualization)
- [Eraser — architecture diagrams](https://www.eraser.io/use-case/architecture-diagrams)
- [Top diagramming tools for software architecture — IcePanel](https://icepanel.io/blog/2025-09-03-top-8-diagramming-tools-for-software-architecture)
- [Best AWS diagram tools 2026 — Holori](https://holori.com/the-best-aws-diagram-tools/)
- [The 31 core gamification techniques — progress & achievement mechanics](https://sa-liberty.medium.com/the-31-core-gamification-techniques-part-1-progress-achievement-mechanics-d81229732f07)
- [APAR: a design and guidance framework for gamification in education, MDPI](https://www.mdpi.com/2414-4088/10/1/10)
