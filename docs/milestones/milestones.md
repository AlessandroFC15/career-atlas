# Career Trajectory Explorer — Milestones

Companion to `vision.md` and `journey.md`. Where those docs state *what* we're building and *how* each step behaves, this doc defines the **implementation path**: an ordered set of milestones, each a concrete desired end state you can look at and demo, each building on the one before it.

The ordering is deliberate. The riskiest deterministic work (reading a real LinkedIn page) is proven first, on the smallest possible scope, before anything depends on it.

---

## M0 — Seed and show ✅

*Status: shipped (commit `8253708`).*

Install the extension, click its icon, the home tab opens. Click **"Seed my graph"**, the worker tab navigates to your own logged-in profile, parses your experience section, and the home tab shows **your name and a plain list of the companies you've worked for** (with tenure dates). No graph yet, just a list.

**Proves:** extension plumbing, home-tab/worker-tab messaging, and the profile-parse path, which is the same parser reused everywhere downstream.

---

## M1 — Plot the seed ✅

*Status: shipped (commit `debbe5a`). Detailed plan in `m1-plan.md`. Rendered with React Flow; the seed is materialized into a separate `graph` store. Visuals went beyond the brief into a cosmic star-chart treatment (see `CLAUDE.md`).*

Same data, now rendered as an actual graph: your companies as a **horizontal career chain** (chronological, each linked to the next), as dormant **Level 0 nodes**. You appear in a header bar, not as a graph node. Reopening the extension shows the same graph from local storage instead of re-reading.

**Proves:** the graph rendering/layout layer and persistence.

---

## M2 — Expand a company into its people ✅

*Status: shipped (commit `1fcd75f`). Detailed plan in `m2-plan.md`.* Click a Level 0 node and **drill into that company's galaxy** (the chain fades, the camera flies into the focused star). The worker tab loads a **first-degree people search keyed on the company name** (`network=["F"]`, one query instead of a current/past company facet), captures the **first page** (~10), and plots those people as raw **Level 1 nodes** in a horizontal row below the company (names on hover). Not confirmed yet, just the initial candidate list. A back affordance (and Esc) returns to the atlas.

**Proves:** the people-search parser, the drill-in galaxy navigation, and the one-page-per-click expansion model (plus the graph store now holding non-derivable expansion data).

---

## M3 — Trace where a colleague went ✅

*Status: shipped (commit `27772dc`, with follow-up polish). Detailed plan in `m3-plan.md`.* From an expanded galaxy (M2), **you click the people you actually worked with**, one at a time. Each click visits that one person's profile, parses their dated tenure (reusing the seed experience parser), anchors on the shared company, and plots the stints they took **after they left** it as **Level 2 leaf nodes** (never expandable). The clicked orb **animates out of the candidate cluster into its own swimlane**, where their onward stints sit on a **continuous real-time axis**. When two colleagues landed at the same place, a **convergence accent** (shared glow + connecting thread) links the stars at their true dates. A profile that doesn't list the company at all is a keyword false positive: the orb returns to the cluster, dimmed.

This **replaces** the originally-planned auto-overlap-prune M3 *and* absorbs the old "onward workplaces" M4. **You** are the verifier now (clicking confirms the relationship), so the speculative bulk profile sweep and the overlap date-interval logic are cut.

**Proves:** the per-person trace (one profile load per click), the anchor + onward-cut logic, the swimlane time-axis layout, and convergence. This is the first "it works end to end" state.

---

## M4 — Human-shaped guardrails ⬅ next

Randomized reading-time pacing between profile visits, a session fetch budget that pauses and tells you when hit, halt-on-challenge detection (captcha/checkpoint) with a Resume affordance, and a visible Stop button.

**Proves:** the traffic discipline that makes per-click tracing safe to run at real scale.

---

## M5 — Load more and exhaustion

The company node shows progress ("23 of 23 loaded ✓"), a **load-more** control fetches the next page of people, and the terminal state is shown clearly. No silent stops, no infinite spinner.

**Proves:** user-driven depth control.

---

## M6 — Polish and robustness

Fallback paste-your-profile-URL seed when auto-detection fails, distinct styling for raw vs. traced vs. dismissed vs. leaf nodes, empty/error states, and confirming that re-opening an explored company or colleague never re-fetches.

---

## Open decisions carried into implementation

1. **Guardrails timing.** M3 does real profile fetches against LinkedIn before M4 (guardrails) exists. Because tracing is now **manual and one-fetch-per-click** (not a bulk sweep), the pre-guardrails exposure is far lower than the original auto-sweep M3 would have been; test M3 against a handful of profiles until M4 lands.
2. **M4 vs. M5 order.** Safety (M4) is placed before load-more (M5) deliberately, since load-more multiplies the number of people available to trace. Flipping them increases exposure.
</content>
</invoke>
