# Career Trajectory Explorer — User Journey & Handling

Companion to `vision.md`. Where the vision doc states *what* we're building and the constraints, this doc walks the user journey end to end, from install to a finished graph, and states *how* each step is handled. Implementation detail is still mostly out of scope; this is the behavioral contract.

This doc assumes the decisions in `vision.md`, and in three places it **supersedes** them. Those deltas are listed explicitly in the final section so the two documents do not drift.

---

## 0. The shape of the journey

The graph is **two levels deep, rooted in your own career**. It does not unfold outward indefinitely.

```
LEVEL 0 (seed)        LEVEL 1 (swept + verified)      LEVEL 2 (leaves)
your companies   ──▶  colleagues you overlapped   ──▶ where each went next
[EXPANDABLE]          with at that company             [NOT expandable]
                      (non-overlaps pruned)
```

The graph answers exactly one question: *for each place I worked, who did I overlap with, and where did each of them go next?*

The single most important rule, because everything downstream depends on it: **only your own companies are expandable.** Onward companies (level 2) are plotted for insight but can never be clicked open. There is no multi-hop crawl. Total page loads over the product's entire life are bounded by your career size (your companies, times the connections on each company's first page), which is what keeps the whole thing defensible against LinkedIn's automation defenses.

---

## 1. Install and first open

The user installs the browser extension and clicks its icon. This opens the **graph home tab**, a dedicated full-page view that is the user's base of operations. LinkedIn is never the home; it is only ever a **worker tab** that the extension drives when an expansion needs a page.

On first open the graph is empty except for a single call to action: **"Seed my graph."** Nothing is read from LinkedIn until the user clicks it. The seed is a deliberate, consented act, not a silent background read.

---

## 2. Seeding your own history

The user clicks **"Seed my graph."**

- **Source (preferred):** the extension resolves the logged-in user's own profile from the active session (for example the `/in/me` redirect or the global-nav identity) and navigates the worker tab there. No URL typed.
- **Source (fallback):** if auto-detection fails, the seed screen asks the user to paste their own logged-in profile URL, and the same parse runs against it.
- **What is read:** the experience section of your own profile, parsed into your list of companies and your dated tenure at each. This is the identical parsing path used later for connections; the seed is not a special export or file upload.

**Result:** your own companies appear as **Level 0 nodes, dormant.** Nothing is swept yet. The graph waits for you.

---

## 3. The core loop: expand one of your companies

This is the only interactive action in the product, and it is available **only on your own companies.** Clicking a Level 0 node runs the following, with the worker tab visible the whole time.

### 3a. Load the company's People page
The extension navigates the worker tab to that company's People view, filtered to your connections. It captures the **first page** of connections (name, headline, location, profile link). One page load, triggered by your one click.

### 3b. Auto-sweep each connection's profile
Overlap cannot be known from the People page; it requires each person's dated tenure, which lives only on their profile. So the extension visits each first-page connection's profile **one at a time, at a human pace**, and for each:

1. Parses their dated experience.
2. Computes **overlap**: does their tenure at *this* company intersect *your* tenure there (a simple date-interval check)?
3. **If overlap:** the person becomes a verified Level 1 node, and their onward workplaces become Level 2 leaf nodes.
4. **If no overlap (or dates missing/unverifiable):** the person is **pruned.** They were not someone you worked with, so they do not belong in the graph, and their onward companies are not plotted.

The graph **updates live, person by person.** It does not wait for the whole sweep to finish; each verified colleague and their destinations appear as they are confirmed.

### 3c. Guardrails on the sweep
The sweep is the one place the design does automated sequential fetching, so it is bounded deliberately:

- **First-page cap.** The sweep covers only the first People page by default. Going deeper is a separate, deliberate action (see 3d).
- **Randomized human pacing.** Variable, reading-time-like delays between profile visits, never fixed or fast intervals.
- **Session fetch budget.** A hard ceiling on total profile fetches per session. When hit, the sweep pauses and tells the user rather than pushing on.
- *(Optional, recommended)* a visible **Stop** affordance so the user can halt a sweep mid-run. Not required, but cheap insurance; included here as a recommendation.

### 3d. Exhaustion and "load more"
The user must always know when a company has nothing left to load. The company node reflects this concretely:

- LinkedIn's People view exposes a result count, so the node shows progress like **"23 of 23 loaded ✓"** and the load-more control disappears at the end.
- Where no count is exposed, the terminal state is "the next page returned no new connections."
- A **"load more"** control fetches the next page of connections (then sweeps those too). Each click is one more page: depth stays user-driven, one page per deliberate action.

No silent stopping, no infinite spinner.

---

## 4. Repeat across your own companies

The user returns to the graph and clicks the next of **their own** companies. The same loop runs. The set of expandable nodes never grows: it is fixed at seed time to the companies you actually worked at.

A useful emergent behavior: when two different colleagues both land at the same onward company, dedup (see below) collapses them onto **one shared Level 2 leaf**, so the graph visibly shows convergence ("two people I worked with both ended up at Z").

---

## 5. Completion

There is no global auto-complete, by design (auto-completing would mean auto-expanding, which is the crawl we ruled out).

- A **company is complete** when all its first-page connections (plus any pages the user loaded) have been swept and the exhaustion state is shown.
- The **graph is complete** when the user has expanded all of their own companies and chooses to stop. Completion is user-defined, because the expandable set is finite and fully under the user's control.

---

## Cross-cutting handling

### Hitting LinkedIn's defenses mid-sweep
If a checkpoint, captcha, or rate-limit interstitial appears during a sweep, the extension:

1. **Detects** it (challenge URL / DOM markers).
2. **Halts** the sweep immediately. No further automated requests.
3. **Surfaces** the worker tab to the user: "LinkedIn needs you to verify. Solve it, then Resume."
4. **Resumes** from where it left off only after the user resolves it.

It never auto-retries through a challenge. Continuing automated traffic right after a flag is the worst possible signal, so the design refuses to.

### Deduplication
Same entity, one node, computed deterministically:

- **Company key:** LinkedIn's company entity ID (URN) where present, falling back to a normalized name (lowercased, with suffixes like Inc/Ltd/GmbH and punctuation stripped). So "Acme Inc." and "acme" collapse to one node.
- **Person key:** profile URL / URN.
- **No Claude in v1.** The fuzzy judgment layer stays optional and deferred (consistent with `vision.md` §4). It can be added later only if deterministic matching proves insufficient.

### Worker tab visibility
The worker tab is **visible by default.** A hidden/background tab is tempting for UX but adds risk on two fronts: it is directly observable (`document.visibilityState === 'hidden'`), and background throttling can break LinkedIn's lazy-loaded, virtualized lists and yield incomplete parses. Hidden mode is **deferred pending real-world verification** of whether it materially affects detection; if pursued, it would be reserved for the lowest-risk single load (your own seed) only.

### Persistence
The graph (nodes, edges, captured tenure, overlap verdicts, exhaustion state) is stored locally. Re-opening a company already explored does not trigger a re-fetch; the stored result is shown.

---

## Deltas to `vision.md` (must be applied to keep the docs consistent)

This journey design overrides the vision doc in three places. These edits should be made to `vision.md`:

1. **§1 (Concept).** The "graph unfolds outward from there / from a person you can expand into the workplaces they moved to" language is **replaced** by the two-level model: only your own companies expand; onward workplaces are terminal leaves. There is no person-expansion action and no outward unfolding.

2. **§2 (Guiding Constraint).** "Automatic recursive crawling is off the table" is **reframed**: a bounded, paced **auto-sweep of one clicked own-company's first-page connections** is an accepted risk. Because onward companies are non-expandable leaves, this is not multi-hop recursion at all; total volume is capped by career size. Unbounded multi-hop crawling remains off the table (and is now structurally impossible).

3. **Open Questions §89** ("how far should onward expansion go") is **resolved**: zero hops. Onward workplaces are leaves and are never expanded.

---

## Still open

- Exact visual treatment of pruned vs. verified vs. leaf nodes (styling, not behavior).
- The specific numbers for the session fetch budget and the pacing jitter window (needs real-world tuning).
- Whether to ship the optional Stop affordance in v1.
- Confirmation that hidden-tab mode is safe enough to ever offer (research task).
