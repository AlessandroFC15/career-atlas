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

## M2 — Expand a company into its people ⬅ next

Click a Level 0 node. The worker tab loads that company's People view filtered to your connections, captures the **first page**, and plots those people as raw **Level 1 nodes** hanging off the company. Not overlap-verified yet, just the initial list.

**Proves:** the People-page parser and the one-page-per-click expansion model.

---

## M3 — Verify overlap (prune to people you actually worked with)

For each connection from M2, the worker tab visits their profile one at a time, parses their dated tenure, and checks whether it overlaps yours at that company. Overlaps stay as verified Level 1 nodes; non-overlaps (and missing-date cases) get pruned. The graph updates **person by person, live**.

**Proves:** the profile sweep loop and the overlap date-interval logic.

---

## M4 — Onward workplaces (the full two-level graph)

For each verified colleague, plot where they went next as **Level 2 leaf nodes** (never expandable). When two colleagues landed at the same place, dedup collapses them onto one shared leaf.

**Proves:** the complete graph answering its one question, plus deduplication. This is the first "it works end to end" state.

---

## M5 — Human-shaped guardrails

Randomized reading-time pacing between profile visits, a session fetch budget that pauses and tells you when hit, halt-on-challenge detection (captcha/checkpoint) with a Resume affordance, and a visible Stop button.

**Proves:** the traffic discipline that makes the sweep safe to run at real scale.

---

## M6 — Load more and exhaustion

The company node shows progress ("23 of 23 loaded ✓"), a **load-more** control fetches and sweeps the next page, and the terminal state is shown clearly. No silent stops, no infinite spinner.

**Proves:** user-driven depth control.

---

## M7 — Polish and robustness

Fallback paste-your-profile-URL seed when auto-detection fails, distinct styling for verified vs. pruned vs. leaf nodes, empty/error states, and confirming that re-opening an explored company never re-fetches.

---

## Open decisions carried into implementation

1. **Guardrails timing.** M3 and M4 do real sequential profile fetches against LinkedIn before M5 exists. Either fold *minimal* pacing into M3, or test M3/M4 against only a handful of profiles until M5 lands.
2. **M5 vs. M6 order.** Safety (M5) is placed before load-more (M6) deliberately, since load-more multiplies fetch volume. Flipping them increases exposure.
</content>
</invoke>
