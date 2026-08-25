# Career Trajectory Explorer — User Journey & Handling

Companion to `vision.md`. Where the vision doc states *what* we're building and the constraints, this doc walks the user journey end to end, from install to a finished graph, and states *how* each step is handled. Implementation detail is still mostly out of scope; this is the behavioral contract.

This doc assumes the decisions in `vision.md`, and in three places it **supersedes** them. Those deltas are listed explicitly in the final section so the two documents do not drift.

---

## 0. The shape of the journey

The graph is **two levels deep, rooted in your own career**. It does not unfold outward indefinitely.

```
LEVEL 0 (seed)        LEVEL 1 (you confirm)          LEVEL 2 (leaves)
your companies   ──▶  colleagues you click as    ──▶  where each went next
[EXPANDABLE]          people you worked with            [NOT expandable]
                      (unclicked stay candidates)
```

The graph answers exactly one question: *for each place I worked, who did I work with, and where did each of them go next?*

The single most important rule, because everything downstream depends on it: **only your own companies are expandable**, and **only the people you click are traced.** Onward companies (level 2) are plotted for insight but can never be clicked open. There is no multi-hop crawl and no bulk sweep. Total page loads over the product's entire life are bounded by your career size (your companies, times the people you deliberately choose to trace), which is what keeps the whole thing defensible against LinkedIn's automation defenses.

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

**Result:** your own companies appear as **Level 0 nodes, dormant.** Nothing is traced yet. The graph waits for you.

---

## 3. The core loop: expand a company, then trace the people you worked with

There are two interactive actions, both deliberate clicks, with the worker tab driven only when a click needs a page.

### 3a. Expand one of your companies (load its people)
Available **only on your own companies.** **(Source mechanism decided in M2.)** The extension navigates the worker tab to a **first-degree people search keyed on the company name** (`/search/results/people/?keywords=<company>&network=["F"]`), not the company's People tab. One query covers both current and past employees, relying on LinkedIn's relevance ranking. It captures the **first page** of connections (name, headline, location, profile link, photo). One page load, triggered by your one click. The search can surface people who never actually worked there; that over-matching is handled in 3b (you simply don't click them, or a click is dismissed).

**(Navigation decided in M2.)** Clicking the company orb does not append people to the chain in place: it **drills into that company's galaxy**, a view showing only that company as the major orb with its people as a cluster below. A back affordance (and Esc) returns to the atlas. See `m2-plan.md`.

### 3b. Trace a colleague you click *(decided in M3, supersedes the auto-sweep + overlap framing)*
There is **no automatic sweep and no overlap computation.** **You** are the verifier: you click the people you remember working with, one at a time. For each click, the extension visits that **one** profile (a single page load, human-shaped by construction), and:

1. Parses their dated experience (reusing the seed experience parser).
2. **Anchors** on the shared company: finds their stint at *this* company (by company URN, else normalized name).
3. **If found:** the person is confirmed; their stints **after they left** that company become Level 2 leaf nodes. The orb is pulled out of the candidate cluster into its own **swimlane**, where the onward stints sit on a continuous real-time axis. A colleague still there (or with nothing after) becomes a terminal lane (a lone face, no leaves).
4. **If the company isn't in their history:** it was a search false positive. The orb returns to the cluster **dimmed** ("didn't work here"), recoverable, and nothing is plotted.

Only the people you click are ever fetched. Unclicked people stay as candidates indefinitely. Re-clicking an already-traced colleague never re-fetches.

### 3c. Guardrails on per-click tracing
Each trace is a single user-triggered profile load, so traffic is human-shaped *by construction*. The deliberate bounds (detailed in the guardrails milestone):

- **Randomized human pacing.** Variable, reading-time-like delays around the fetches, never fixed or fast intervals.
- **Session fetch budget.** A hard ceiling on total profile fetches per session. When hit, tracing pauses and tells the user rather than pushing on.
- **Halt-on-challenge.** A captcha/checkpoint halts immediately and surfaces the worker tab (see Cross-cutting).
- *(Optional, recommended)* a visible **Stop** affordance. Cheap insurance; included as a recommendation.

### 3d. Exhaustion and "load more"
The user must always know when a company has no more *people* to surface. The company node reflects this concretely:

- LinkedIn's people search exposes a result count, so the node shows progress like **"23 of 23 loaded ✓"** and the load-more control disappears at the end.
- Where no count is exposed, the terminal state is "the next page returned no new connections."
- A **"load more"** control fetches the next page of connections (which you can then trace by clicking, as in 3b). Each click is one more page: depth stays user-driven, one page per deliberate action.

No silent stopping, no infinite spinner.

---

## 4. Repeat across your own companies

The user returns to the graph and clicks the next of **their own** companies. The same loop runs. The set of expandable nodes never grows: it is fixed at seed time to the companies you actually worked at.

A useful emergent behavior: when two different colleagues both land at the same onward company, the graph visibly shows convergence ("two people I worked with both ended up at Z"). **(Layout decided in M3.)** Rather than merging them onto one node, the two orbs stay at their **true dates** in their own swimlanes and share a **convergence accent** (glow + a faint connecting thread), so the insight and each individual timeline both survive. **(Scoped in M2.)** Because you view one company's galaxy at a time, this convergence is only ever shown **within a single company's galaxy** (two colleagues from the *same* company landing at the same place). Cross-company convergence (colleagues from two *different* of your companies converging) is not surfaced in the drill-in model; a future atlas-wide view could restore it.

---

## 5. Completion

There is no global auto-complete, by design (auto-completing would mean auto-expanding, which is the crawl we ruled out).

- A **company is complete** when its people are fully loaded (the exhaustion state is shown) and the user has traced whichever colleagues they care to. Tracing is opt-in per person, so "complete" here means the user is done clicking, not that every candidate was fetched.
- The **graph is complete** when the user has expanded all of their own companies and chooses to stop. Completion is user-defined, because the expandable set is finite and fully under the user's control.

---

## Cross-cutting handling

### Hitting LinkedIn's defenses mid-trace
If a checkpoint, captcha, or rate-limit interstitial appears while loading a page, the extension:

1. **Detects** it (challenge URL / DOM markers).
2. **Halts** immediately. No further automated requests.
3. **Surfaces** the worker tab to the user: "LinkedIn needs you to verify. Solve it, then try again."
4. **Resumes** only after the user resolves it (the next click proceeds normally).

It never auto-retries through a challenge. Continuing automated traffic right after a flag is the worst possible signal, so the design refuses to.

### Deduplication
Same entity, one node, computed deterministically:

- **Company key:** LinkedIn's company entity ID (URN) where present, falling back to a normalized name (lowercased, with suffixes like Inc/Ltd/GmbH and punctuation stripped). So "Acme Inc." and "acme" collapse to one identity. For **onward (Level 2) companies** this is the **accent key** (M3): orbs sharing a key across two lanes get the convergence glow + thread, rather than being merged into one node.
- **Seed-chain exception (decided in M1).** Your **own** companies are **not** deduped: a company you worked at in two separate stints renders as **two chain nodes** at its two points in time. Deduping them would fold the chronological timeline back on itself. The company-key above is therefore a Level 2 concern, not a seed concern.
- **Person key:** profile URL / URN.
- **No Claude in v1.** The fuzzy judgment layer stays optional and deferred (consistent with `vision.md` §4). It can be added later only if deterministic matching proves insufficient.

### Worker tab visibility
The worker tab is **visible by default.** A hidden/background tab is tempting for UX but adds risk on two fronts: it is directly observable (`document.visibilityState === 'hidden'`), and background throttling can break LinkedIn's lazy-loaded, virtualized lists and yield incomplete parses. Hidden mode is **deferred pending real-world verification** of whether it materially affects detection; if pursued, it would be reserved for the lowest-risk single load (your own seed) only.

### Persistence
The graph (nodes, edges, captured people, traced onward trajectories, per-person status, exhaustion state) is stored locally. Re-opening a company already explored, or re-clicking a colleague already traced, does not trigger a re-fetch; the stored result is shown.

---

## Deltas to `vision.md` (must be applied to keep the docs consistent)

This journey design overrides the vision doc in three places. These edits should be made to `vision.md`:

1. **§1 (Concept).** The "graph unfolds outward from there / from a person you can expand into the workplaces they moved to" language is **replaced** by the two-level model: only your own companies expand; onward workplaces are terminal leaves. There is no person-expansion action and no outward unfolding.

2. **§2 (Guiding Constraint).** "Automatic recursive crawling is off the table" is **reframed**: every page load stays tied to a deliberate click (one people-search per company, one profile per traced person), with no bulk sweep (M3, supersedes the earlier auto-sweep framing). Because onward companies are non-expandable leaves, this is not multi-hop recursion at all; total volume is capped by career size and how many people you choose to trace. Unbounded multi-hop crawling remains off the table (and is now structurally impossible).

3. **Open Questions §89** ("how far should onward expansion go") is **resolved**: zero hops. Onward workplaces are leaves and are never expanded.

---

## Still open

- Exact visual treatment of raw vs. traced vs. dismissed vs. leaf nodes (styling, not behavior).
- The specific numbers for the session fetch budget and the pacing jitter window (needs real-world tuning).
- Whether to ship the optional Stop affordance in v1.
- Confirmation that hidden-tab mode is safe enough to ever offer (research task).
