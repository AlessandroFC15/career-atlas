# M3 — Trace Where a Colleague Went: Detailed Plan

Detailed implementation plan for Milestone 3 (see `milestones.md`). Every decision below was resolved in a design interview (grill); the choices and their rationale are in the Decision Log at the end. This plan builds on M2 (`m2-plan.md`): the drill-in atlas/galaxy navigation, the `expansions` map on `CareerGraph`, the `runExpandCompany` orchestration pattern, the `PersonNode` model, and the reused `injectedScrapeExperience` parser are all carried forward.

> **One supersede from the earlier milestone plan, deliberate** (full detail in §13):
> The originally-planned M3 ("verify overlap", an automatic profile sweep over *every* surfaced person, computing date-interval overlap with your own tenure and auto-pruning non-overlaps) is **cut entirely**. In its place: **you** are the verifier. You click the people you actually worked with, one at a time, and each click traces that person's onward trajectory. This deletes the speculative bulk sweep and the overlap interval logic, folds in the old M4 (onward workplaces + convergence), and renumbers every later milestone up by one.

---

## 1. Definition of done

With an expanded galaxy (the M2 state: a focused company star on top and a cluster of raw, unverified Level 1 person orbs below it), the user:

1. **Clicks one person orb.** A **spinner appears on that orb** (the fetch is a profile read, a few seconds, not instant).
2. Behind that, the worker tab (background, like seed and M2) opens that person's `…/details/experience/`, and the **reused `injectedScrapeExperience` parser** reads their full history.
3. We **anchor on the shared company**: find their stint at this galaxy's company, and take the stints that started **after they left** it (their "where they went next").
4. On success, the orb **animates out of the candidate cluster and settles into its own swimlane** in a band below; the cluster closes the gap. Unclicked people stay in the cluster, still clickable.
5. The lane plots their onward stints as Level 2 leaf stars on a **continuous real-time x-axis** (left = earlier), the lane originating at the colleague's face. Earlier-joined places sit left, later ones right.
6. When a company appears in **two or more lanes**, the stars stay at their true dates but share a **convergence accent** (matching glow + a faint connecting thread): "they both ended up here." This is the product's payoff moment.
7. **Re-clicking an already-expanded person never re-fetches**; the stored trajectory renders directly. **Re-entering the galaxy** restores every expanded lane from storage.
8. Edge outcomes are handled honestly (§9): a **keyword false positive** (their profile doesn't list this company) returns the orb to the cluster **dimmed/dismissed** with a hover hint; a **terminal colleague** (still there, or nothing after leaving) becomes a lone face in a lane with no beams.

Out of scope, by design (each is a later milestone): randomized pacing / fetch budget / halt-on-challenge / Stop button (M4, the renumbered old M5); load-more pagination of the people search (M5, old M6); broader polish and styling states (M6, old M7). M3 does **exactly one profile load per person click**.

Pure functions (the swimlane layout, the anchor + onward-cut logic) have unit tests; the pull-out animation and camera framing are eyeballed.

---

## 2. Tech foundation

- Unchanged from M2: TypeScript + Vite (CRXJS), React 18, MV3, `@xyflow/react`, the full extension page as home.
- **No new dependency.** The pull-out animation uses React Flow's own node-position transitions (animated node `position` + CSS), the same toolkit the M2 fly-in used.
- **No manifest/permission change.** The worker tab already navigates `linkedin.com`; a person's profile and `details/experience/` are the same host. Logo bytes come from `media.licdn.com`, already fetched for company logos and person photos.
- **Parser reuse, not a new one.** Reading a colleague's history is exactly the seed problem, so `injectedScrapeExperience` is reused verbatim. M3 adds no new injected scraper.

---

## 3. Architecture and navigation model

```
storage.local
  seed   ── raw capture (unchanged)
  graph  ── CareerGraph, expansions[companyId].people[] now also carry
            per-person status + onward trajectory (NEW)

HOME TAB (React)
  nav state (unchanged shape from M2):
     { mode: 'atlas' } | { mode: 'galaxy', companyId, status }   (transient)

  galaxy 'ready' sub-view (M2) gains a per-person interaction:
     click a raw person orb  → markExpanding(personId)            [spinner on orb]
                             → runTracePerson(company, person)    [worker tab]
                             → on success: person.status='expanded', person.onward=[…]
                                          persist, animate orb into a lane
                             → on dismiss: person.status='dismissed' (false positive)
                             → on error:   person.status stays 'raw' (retryable)
     re-click an 'expanded' person → no-op for fetch (already traced)
```

- The galaxy still renders one company subtree at a time (M2). M3 adds a **second visual region inside the galaxy**: the candidate cluster (raw orbs, M2) on top, and the **swimlane band** (expanded colleagues + their trajectories) below.
- **Navigation state stays in React; trajectory data persists** in `graph.expansions`. Closing the tab returns to the atlas (M2 §1.7); re-entering a galaxy restores expanded lanes from storage with no fetch.

---

## 4. Data model

M3 extends the existing `PersonNode` (no new top-level store; the trajectory lives on the person, inside the existing `expansions` map). New types in `src/types.ts`:

```ts
/** One employer a colleague joined after leaving the shared company (a Level 2
 *  leaf). Plotted at its start date on the galaxy time axis. Never expandable. */
interface OnwardStint {
  companyName: string;
  companyUrl?: string;
  companyUrn?: string;     // dedup/accent key when present (else normalized name)
  logoUrl?: string;        // original media.licdn.com URL
  logoDataUrl?: string;    // cached base64, what the UI renders
  start: DateParts;        // join date: the x position on the time axis
  end: DateParts | null;   // null = Present (still there)
}

// PersonNode (M2) gains two fields. `status` widens from the M2 literal 'raw':
interface PersonNode {
  // … all M2 fields unchanged …
  status: 'raw' | 'expanded' | 'dismissed';  // M2 wrote only 'raw'
  onward?: OnwardStint[];   // set when status === 'expanded' (may be empty = terminal)
}
```

- **`status` semantics:**
  - `'raw'`: surfaced by M2, not yet clicked (a candidate). Also the resting state after a *retryable* error.
  - `'expanded'`: clicked, profile read, anchored. `onward` is present (possibly empty, meaning a terminal colleague). Lives in a swimlane.
  - `'dismissed'`: clicked, but their profile does not list this company (a keyword false positive). Stays in the cluster, dimmed, with a hover hint. Recoverable (re-clickable to retry).
- **`onward` is the persisted trajectory.** Empty array = terminal (still at the company, or no later employer). Absent = not yet traced.
- **No schema migration.** M2 graphs have `status: 'raw'` and no `onward`; both load cleanly. The `expansions` map and storage keys are unchanged.

---

## 5. Reading a colleague + the anchor/onward-cut logic

### 5a. The fetch (orchestration, §8)

Reuse `injectedScrapeExperience` against the colleague's `profileUrl + 'details/experience/'`. Their `profileUrl` is already stored on the `PersonNode` from M2, so we can navigate straight there (no `/in/me` resolve step).

### 5b. Anchor + onward cut (pure, unit-tested)

A new pure function in `src/graph.ts`, alongside the existing layout helpers:

```
deriveOnward(companyNode, theirExperiences) → { matched: boolean; onward: OnwardStint[] }
```

1. **Find the shared stint.** Among `theirExperiences`, find the entry matching `companyNode`:
   - by `companyUrn` when **both** sides have one (reliable), else
   - by **normalized name** (lowercase, collapse whitespace, strip a trailing legal/`·`-suffix, same `beforeDot` spirit as the parser).
   - **Boomerang in their history** (the company appears twice): anchor on the **earliest** matching stint. We no longer have overlap to disambiguate; earliest yields the fullest onward trajectory and is deterministic.
   - If no match → `{ matched: false, onward: [] }`. This is the **false-positive** path (§9), not an error.
2. **Cut "after they left."** Let `leftAt = sharedStint.end`. If `leftAt` is `null` (Present) → `{ matched: true, onward: [] }` (terminal). Otherwise keep every other entry whose `start` is **strictly after** `leftAt`, excluding the shared company itself. Side roles that overlapped the shared tenure (start before `leftAt`) are dropped: this is the truest "next employer" reading.
3. **Sort** the kept entries by ascending start; map each to an `OnwardStint`. The orchestrator then fetches logo bytes for each (mirrors how M2 caches person photos).

`DateParts` comparison reuses the same `year*12 + (month ?? 0)` ordering already used by `startValue` / the parser's `dateLE`. "Strictly after" compares those scalars; year-only dates compare as month 0 (a known coarse case, consistent with the rest of the codebase).

---

## 6. Layout: the swimlane band

New pure functions in `src/graph.ts`, alongside `layoutGalaxy*`. Deterministic: same inputs ⇒ same coordinates, unit-testable.

### 6a. Regions

The galaxy keeps M2's top (focused company star) and the candidate cluster. M3 adds the band below:

```
                 ( Escale )            focused company  (M2)
            o   o   o   o              candidate cluster (raw orbs, M2)
   ─────────────────────────────────  band divider
   | 2017 ───────────────────── 2026 |   continuous time axis (fixed range)
   P1  (face)──(A)────────────(Nubank)
   P2  (face)──────────(D)────(Nubank)   ← Nubank shared: glow + thread
   P3  (face)──(C)──(Nubank)
```

### 6b. Time axis (x): continuous, fixed range

- **Range is set once** to `[focusedCompany.start , now]`, where `focusedCompany.start` comes from the seed (no fetch) and `now` is **passed in** from the React layer (the layout stays pure: no `Date.now()` inside it, consistent with the codebase rule).
- `x(date) = AXIS_LEFT + clamp01((value(date) - value(min)) / (value(max) - value(min))) * AXIS_WIDTH`, with `value = year*12 + (month ?? 0)`.
- **Fixed**, so adding a lane never shifts the lanes already on screen (a calm, stable band). A stint outside the range clamps to an edge (accepted).
- The colleague's face anchors the **left of their lane**, at the x of their shared-stint start (where their story with this company began). A terminal colleague is just the face with no leaves to its right.

### 6c. Lanes (y): one row per expanded colleague

- `y(laneIndex) = BAND_TOP + laneIndex * LANE_GAP`. **Lane order = click order**, new lanes appended at the bottom (matches the pull-out-downward motion).
- Onward leaves sit on their lane's row at `x(stint.start)`.

### 6d. Convergence accents

- After positioning, group onward leaves across **all** lanes by **accent key** = `companyUrn` when present, else normalized name. A key with members in ≥2 distinct lanes is a **convergence group**.
- The layout returns these groups (member coordinates) so the renderer can draw the **shared glow + faint connecting threads** between the stars (a constellation line). Stars stay at their **true dates**: nothing is merged or moved.
- **Scope: within one galaxy only** (consistent with the M2 doc-delta; cross-company convergence remains out of scope).

### 6e. Components

- Reuse the M2 `PersonNode` orb for both the cluster and the lane face; add a **`'dismissed'`** visual (dimmed, hover hint) and an **`'expanded'`** treatment (settled into a lane).
- A new **onward leaf star**: smaller than a person, company logo as the coin (reuse the company `Avatar`/logo tile with an indigo-tinted fallback), **Level 2, never expandable** (no click handler). Name on hover, like the cluster orbs.
- Lane beams (face → leaf → leaf, in date order) reuse the atlas edge-beam styling; convergence threads are a distinct, fainter accent.

---

## 7. The pull-out animation

The signature interaction of M3, the sibling of M2's fly-into-a-star.

- On click: set the person `'expanding'` in transient view state → render the **spinner on the orb in place** (still in the cluster).
- On success: the orb's React Flow `position` transitions from its cluster slot to its lane face slot (animated `position` + a short CSS ease), while the cluster's remaining orbs re-flow to close the gap. The lane's leaves fade in along the time axis once the face lands.
- On dismiss: the orb eases back to its cluster slot and crossfades to the dimmed `'dismissed'` style.
- On hard error: the spinner stops and the orb rests as `'raw'` (retryable).
- React Flow `fitView`/`setCenter` reframes the galaxy as the band grows, so new lanes stay in view. **If the literal pull-out tween fights the node-set update**, the fallback (recorded as a deferral, not a scope cut) is an instant slot move + fade, same as M2's fly-in fallback.

---

## 8. Orchestration: `runTracePerson`

A new export in `orchestrator.ts`, mirroring `runExpandCompany`, reusing `waitForLoad`, `injectFunc`, `isLoggedOutUrl`, `cacheImages`-style logo fetching:

```
runTracePerson(company: GraphNode, person: PersonNode, hooks?) → TraceResult
  1. open worker tab, active:false, at person.profileUrl + 'details/experience/'   [background]
  2. waitForLoad; detect logged-out
  3. inject injectedScrapeExperience → ExperienceEntry[]   (reused parser)
  4. deriveOnward(company, experiences) → { matched, onward }
  5. if !matched → DISMISSED outcome (false positive; not an error)
  6. cache each onward logo as a data URL (home page, like M2 photos)
  7. write the person's status ('expanded') + onward[] back into
     graph.expansions[company.id].people[…]  (a new saveTrace in storage.ts)
  8. close worker tab on success; keep open + surfaced on error
```

`TraceResult` distinguishes the **dismiss** outcome (matched: false → `status: 'dismissed'`) from the **expanded** outcome (with `onward`, possibly empty = terminal).

**`TraceError`** mirrors `ExpandError`/`SeedError`: `LOGGED_OUT`, `PARSE_NOT_READY` (experience didn't load), `GENERIC`. Note `EMPTY` is **not** an error here: "no shared stint" is the dismiss outcome and "nothing after" is a valid terminal lane. On any real error the worker tab is surfaced (brought to front) and the person stays `'raw'` (retryable); a captcha/checkpoint lands as `PARSE_NOT_READY` for now (halt-on-challenge detection stays the next milestone).

**Persistence helper.** Add `saveTrace(companyId, personId, patch)` to `storage.ts`, mirroring `saveExpansion`: read graph, update the matching `person` inside `expansions[companyId].people`, write back. Atlas nodes/edges and other people untouched.

---

## 9. UI states and outcomes (React)

Inside the galaxy `ready` view, each candidate orb is interactive:

- **Idle (`'raw'`):** a clickable candidate orb (M2 look).
- **Expanding:** spinner on the orb, in place in the cluster.
- **Expanded (`onward` non-empty):** orb animated into a lane; trajectory leaves fade in; convergence accents drawn where shared.
- **Terminal (`'expanded'`, `onward` empty):** lone face in a lane, quiet "still at \<company\>" / no beams. Not an error.
- **Dismissed (`'dismissed'`):** orb returns to the cluster, dimmed, hover hint "didn't work at \<company\>". Re-clickable to retry.
- **Error (`'raw'` after failure):** spinner stops, orb stays a candidate; worker tab already surfaced; an unobtrusive note (reuse the M2 error affordance shape).

Atlas, breadcrumb/back, Esc, and re-seed behavior are all unchanged from M2. **Re-seed still regenerates the graph and silently drops `expansions`** (now including traced onward data): accepted, rare, explicit.

---

## 10. Persistence

- `saveGraph`/`loadGraph` signatures unchanged (same `graph` key). The object now also carries per-person `status`/`onward` inside `expansions`.
- **On a successful trace:** `saveTrace` patches the one person in place (§8).
- **Re-entering a galaxy:** expanded lanes render straight from `graph.expansions[companyId]`; no worker tab, no fetch. `'raw'` people render as candidates, `'dismissed'` as dimmed, `'expanded'` as lanes.
- **M2 graphs** (people all `'raw'`, no `onward`) load as "nothing traced yet". No migration.

---

## 11. Testing

- **Reuse the seed experience fixture** (`test/fixtures/experience.html`) to exercise `injectedScrapeExperience` on a "colleague" (the parser is already covered; M3 adds no new scraper). If a distinct shape is wanted, scrub a second profile fixture (replace PII, preserve DOM), per the M2 fixture rule.
- **Unit (Vitest + jsdom):**
  - `deriveOnward`: matches by URN; falls back to normalized name; **boomerang anchors on the earliest matching stint**; **"after they left" cut** (excludes overlapping side roles, includes strictly-later employers); Present-at-company → terminal (empty onward); no match → `matched: false`; deterministic sort.
  - swimlane layout: time-axis mapping (fixed range, clamping outside the range, `now` injected), lane stacking by click order, and **convergence grouping** (a company in ≥2 lanes is one group; in 1 lane is not; keyed URN-else-name).
  - `deriveGraph` / re-seed regression: still emits people as `'raw'` with no `onward` after a fresh seed (re-seed wipe stays correct).
- **Manual live render:** click a real colleague, confirm the spinner, the background worker tab, the pull-out animation into a lane, leaves on the time axis, a convergence accent across two colleagues who shared an employer, a false-positive dismiss, a terminal colleague, and that re-entering the galaxy restores lanes **without** a worker tab.

---

## 12. Risks / things to verify

- **The pull-out animation (highest).** Coordinating the orb's position tween, the cluster re-flow, and the lane leaves fading in. Mitigation: build `deriveOnward` + layout + an instant slot-move first, then layer the tween; fall back to instant move + fade (like M2's fly-in fallback) if it fights the node-set update.
- **Anchor matching drift.** Name-fallback is fuzzy (a company can be styled differently on two profiles, e.g. "Escale" vs "Escale Digital"). URN-first mitigates when present; verify name normalization on real profiles. A miss surfaces as a (recoverable) false-positive dismiss, not a crash.
- **Year-only dates.** Coarse "after they left" comparisons when a stint is year-only (month treated as 0), consistent with the rest of the codebase; accept and cover in tests.
- **Fixed-range edge clamping.** A colleague whose onward stint predates the focused company's start (they left before you arrived) clamps to the left edge. Acceptable given manual selection; noted.
- **Fetch volume / pacing.** One profile load per click is human-shaped by construction. Real pacing / budget / Stop is the next milestone (old M5). Because tracing is now manual and per-click (not a bulk sweep), the pre-guardrails exposure is far lower than the original M3 would have been; this is the main reason the cut also de-risks Open Decision #1 in `milestones.md`.

---

## 13. Doc-deltas required (apply to keep docs consistent)

To be written back to the milestone/vision docs (not applied as part of writing this plan):

1. **`milestones.md` (replace and renumber).** The old "M3 — Verify overlap (prune to people you actually worked with)" is **cut**. New **M3 — Trace where a colleague went** (this plan) absorbs the old M4's onward-workplaces + dedup. The old M5/M6/M7 renumber to **M4 (guardrails)**, **M5 (load more)**, **M6 (polish)**. Update Open Decision #1: manual per-click tracing greatly reduces pre-guardrails fetch volume.
2. **`vision.md` / `journey.md` (verification model).** "Automatic overlap pruning" becomes **manual, click-to-confirm**: the user is the verifier; clicking a person both confirms the relationship and traces their onward path. Date-interval overlap logic is removed from the product.
3. **`vision.md` / `journey.md` (onward + convergence).** "Where they went next" is plotted on a **continuous time axis per colleague (swimlanes)**, with shared destinations shown by a **convergence accent** (glow + thread), not merged nodes, **within a single galaxy**.

---

## 14. Tensions and deferrals carried forward

- **Automatic verification dropped.** We trade recall (a bulk sweep would surface everyone who overlapped) for precision and safety (you pick exactly who you remember). Accepted: you know your colleagues better than a date interval does, and overlap was a weak proxy (same big company, never met).
- **Convergence is an accent, not a merge.** Chosen to preserve every personal timeline truthfully (§6d). If the accent reads too softly in practice, a stronger treatment (or an optional merged-summary view) can follow; nothing in the model is merged, so it stays open.
- **Pull-out animation fallback** (§7, §12), same posture as M2's fly-in.
- **Re-seed drops traced data silently** (§9), same posture as M2 expansions.
- **Name-fallback fuzziness** (§5b, §12): surfaces as a recoverable dismiss, revisit if false dismisses are common.

---

## 15. Decision log

| Topic | Decision |
|-------|----------|
| Old M3 (auto overlap-prune) | **Cut entirely**; manual click-to-confirm replaces it; later milestones renumber up by one |
| Core interaction | **Click a person → spinner on the orb → trace that one person.** One profile load per click |
| What's read | **Reuse `injectedScrapeExperience`** on the colleague's `details/experience/`; no new scraper |
| Anchor | Find their stint at this company: **URN-first, name-fallback**; boomerang → **earliest** matching stint |
| Onward cut | Stints starting **after they left** (strictly after the shared stint's end); Present there → terminal |
| False positive (no shared stint) | Orb returns to cluster **dimmed/`'dismissed'`** + hover hint; recoverable |
| Terminal (nothing after) | Lone face in a lane, "still at \<company\>", no beams; not an error |
| Layout | Company top, **candidate cluster mid, swimlane band below**; clicked orb **animates out of the cluster into a lane** |
| X-axis | **Continuous real time**, **fixed range** [focused company start → `now`] (`now` injected); new lanes don't shift old ones; clamp outside |
| Y-axis | One lane per expanded colleague, **click order**, appended at bottom |
| Convergence | Same company in ≥2 lanes → **glow + faint thread** (accent, not merged); stars at true dates; **within one galaxy only** |
| Accent/dedup key | `companyUrn` when present, else **normalized name** |
| Leaves | **Level 2, never expandable** |
| Persistence | `PersonNode` gains `status: 'raw'\|'expanded'\|'dismissed'` + `onward[]`; stored in `expansions`; re-entry restores, re-click never re-fetches |
| Orchestration | New **`runTracePerson`** mirroring `runExpandCompany`; new **`saveTrace`** mirroring `saveExpansion` |
| Errors | **`TraceError`** = LOGGED_OUT / PARSE_NOT_READY / GENERIC (no-match and nothing-after are outcomes, not errors); worker tab surfaced; person stays retryable |
| Safety | One fetch per click only; pacing/budget/Stop deferred to the next milestone |
| Pure/tested | `deriveOnward` + swimlane layout unit-tested; animation + camera eyeballed |
| Manifest/permissions | **Unchanged** |
</content>
</invoke>
