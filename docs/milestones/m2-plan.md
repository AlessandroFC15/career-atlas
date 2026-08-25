# M2 — Expand a Company into its People: Detailed Plan

Detailed implementation plan for Milestone 2 (see `milestones.md`). Every decision below was resolved in a design interview (grill); the choices and their rationale are in the Decision Log at the end. This plan builds on M1 (`m1-plan.md`): the materialized `graph` store, React Flow rendering, the `CompanyNode` star, and the `runSeed` orchestration pattern are all reused.

> **Two supersedes from the vision docs, both deliberate** (listed in full in §13):
> 1. **Navigation model.** The "one graph, two levels deep, all visible on one canvas" picture in `vision.md` §1/§4 and `journey.md` §0 is replaced by a **drill-in model**: an **atlas** view (your company chain, level 0) and, per company, a **galaxy** view (that one company plus its people, level 1, and later level 2). You only ever see one company's subtree at a time.
> 2. **Data source.** The company People tab (`/company/<id>/people/`, which would need a current-company *and* a past-company fetch) is replaced by a single **first-degree people search** keyed on the company name. Feasibility was confirmed live (see §5).

---

## 1. Definition of done

With a seeded graph (the M1 atlas), the user:

1. Sees the **atlas** exactly as M1 renders it: their companies as a horizontal chain of stars.
2. **Clicks one of their own company stars.** The camera **flies into that star**: the chain fades away and the view descends into that company's **galaxy**, the clicked company pinned as the major star at top, an in-galaxy loading state below ("Finding people you know at Escale…").
3. Behind that, the worker tab (background, like seed) has loaded the company's **first-degree people search**, parsed the **first page** (~10 connections), and cached their photos.
4. The parsed people **fade in as a vertical column of person stars** below the company, each showing photo + name + headline. These are **raw, unverified Level 1 nodes**: every first-page first-degree result, no overlap check yet.
5. A **back affordance** ("← Atlas" breadcrumb in the header, plus the **Esc** key) flies the camera back out to the atlas.
6. **Re-entering an already-expanded galaxy never re-fetches**: the stored people render straight from the `graph` store.
7. Reopening the home tab lands on the **atlas** (galaxies are transient view state; people data persists).

Out of scope, by design (each is a later milestone): overlap verification and pruning (M3), onward workplaces (M4), pacing / fetch budget / challenge detection (M5), load-more / pagination / exhaustion (M6). M2 does **exactly one search page load per click** and plots the raw first page.

Pure functions (the people parser run offline, the galaxy layout) have unit tests; the fly-in and live render are eyeballed.

---

## 2. Tech foundation

- Unchanged from M1: TypeScript + Vite (CRXJS), React 18, MV3, `@xyflow/react`, the full extension page as home.
- **No new dependency.** The fly-in uses React Flow's own viewport API (`useReactFlow().setCenter` / `fitView` with `duration`), not a new animation library.
- **No manifest/permission change.** The worker tab already navigates `linkedin.com`; the people-search URL is the same host. Photo bytes come from `media.licdn.com` (the image CDN), already fetched for company logos.

---

## 3. Architecture and navigation model

```
storage.local
  seed   ── raw capture (unchanged)
  graph  ── CareerGraph, now also holds `expansions` (NEW)

HOME TAB (React)
  nav state:  { mode: 'atlas' } | { mode: 'galaxy', companyId }   (transient, not persisted)
  view 'seeded':
     mode 'atlas':   <CareerGraph> renders graph.nodes (the company chain)  ◀ M1, unchanged
     mode 'galaxy':  renders [focused company star] + graph.expansions[companyId].people
                     loading / empty / error sub-states inside the galaxy

  click company star → flyInto(node) → setCenter(node, zoom) → set mode 'galaxy'
                     → if no expansion yet: runExpandCompany() (worker tab)
                     → else: render stored people
  back / Esc        → flyOut() → fitView(atlas) → set mode 'atlas'
```

- The **atlas** is M1's `CareerGraph` over `graph.nodes`/`graph.edges`, untouched.
- A **galaxy** is a *different node set* rendered by the **same React Flow instance**: one company node (the focus) plus its people nodes. We swap the `nodes`/`edges` arrays passed to `<ReactFlow>`, we do not mount a second canvas. This keeps one viewport to animate.
- **Navigation state lives in React, not in storage.** Closing the tab resets to atlas (§1.7). What persists is the *data* (`graph.expansions`), so re-entering a galaxy is instant and fetch-free.

---

## 4. Data model

New types in `src/types.ts`, alongside `GraphNode`/`GraphEdge`/`CareerGraph`:

```ts
/** One first-degree connection surfaced under a company. M2 emits these raw. */
interface PersonNode {
  id: string;          // `${companyId}:${vanity}` — scoped PER COMPANY (see below)
  kind: 'person';
  level: 1;
  parentId: string;    // the company GraphNode id this person hangs off
  vanity: string;      // the /in/<vanity> key (person identity)
  profileUrl: string;  // canonical https://www.linkedin.com/in/<vanity>/
  name: string;
  headline?: string;
  location?: string;
  photoUrl?: string;     // original licdn URL
  photoDataUrl?: string; // cached base64, what the UI renders
  status: 'raw';         // M3 adds 'verified' | 'pruned'
  order: number;         // column position within the galaxy
}

/** A company's captured first page of people. */
interface CompanyExpansion {
  people: PersonNode[];
  keyword: string;     // the search keyword used (the company name)
  fetchedAt: number;   // epoch ms
}

// CareerGraph gains one optional field (M1 graphs simply have none):
interface CareerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  derivedFrom: number;
  expansions?: Record<string, CompanyExpansion>; // keyed by company node id
}
```

- **Person identity is the profile vanity** (`/in/<vanity>`), but **person nodes are scoped per company**: `id = ${companyId}:${vanity}`. The same human who was your colleague at two of your companies is two nodes, one in each galaxy. This matches M1's boomerang philosophy and the graph's actual question ("who did I overlap with *at this place*"). Within a single company's results, duplicates (the same vanity appearing twice) collapse by vanity.
- **`expansions` keyed by company node id** (`c${index}`), not by URN, so it lines up with the per-stint chain and a boomerang company's two stints expand independently.
- **`status` is on the node from day one** even though M2 only ever writes `'raw'`. M3 flips it to `'verified'`/`'pruned'` in place; baking the field in now avoids a migration then.

---

## 5. Search URL and the people parser

### 5a. The URL (confirmed live)

```
https://www.linkedin.com/search/results/people/?keywords=<company>&network=%5B%22F%22%5D&origin=FACETED_SEARCH
```

- `keywords` = the company name from the seed (URL-encoded), used verbatim. LinkedIn's relevance ranking does the matching; we do not add company-facet URNs (the whole point of the keyword approach is one query instead of current + past facet fetches).
- `network=["F"]` constrains to **first-degree** only. Confirmed: every returned card carried a `• 1st` badge.
- **Accepted imperfection:** a keyword can match on headline text, not just employment, so the raw list can include people who never actually worked there. That is fine here because **M3's overlap check prunes exactly those** (no overlapping tenure at the company → pruned). The fuzziness of M2 and the pruning of M3 are designed to lean on each other. Generic/short company names will be noisier; accepted, and pruned downstream.

### 5b. The parser: `injectedScrapePeople`

A new injected function in a new module (`src/peopleParser.ts`), under the **same constraints as `injectedScrapeExperience`**: self-contained (no module-scope references, every helper nested), touches only `document`/`getComputedStyle`, returns serializable records, and is importable by unit tests to run against a fixture in jsdom.

**DOM findings from the live probe (2026 search page):**

- Class names are obfuscated hashes (`_7d9e4974`, …), same as the experience page. **No class anchors.**
- The reliable per-card anchor is the **connection-degree badge**: a `<span>` whose text matches `/^•\s*(1st|2nd|3rd)/`. Real result cards have one; **mutual-connection facepiles and sidebar "people also viewed" links do not**, which is how we exclude them (the raw page has ~20+ `/in/` links but only ~10 real results).
- **Strategy:** find every degree-badge span, climb to the enclosing card (nearest ancestor that also contains an `a[href*="/in/"]` and the headline/location lines), and extract per card:
  - **profileUrl / vanity:** from the card's `/in/` link. Normalize to `/in/<vanity>`: strip a trailing locale segment (`/en`), query string, and trailing slash. This is the person key.
  - **name:** the profile link's visible text (e.g. "Ken Diamond").
  - **headline:** the card's headline line (e.g. "Co-Founder & CEO of Escale").
  - **location:** the location line (e.g. "São Paulo, São Paulo, Brazil").
  - **photo:** the card `img` whose `src` is an `https://media.licdn.com/...` URL, skipping `ghost`/placeholder srcs (same filter as `logoUrlFrom`).
- **Dedup by vanity** within a card set: name and badge render twice (once visible, once for screen readers), so the same vanity is seen more than once.
- **Photos lazy-load**, like the experience logos. Reuse the **grace-period poll**: once cards are found, wait a bounded window for photo `src`s to populate, then proceed regardless (a person may have no photo).
- **First page = whatever the search renders without scrolling** (~10). No scroll, no "next", no pagination. That is M6.

Returns `PersonRecord[]` (vanity, name, headline, location, photoUrl); the home page assembles `PersonNode`s and fetches photo bytes (mirrors how `injectedScrapeExperience` returns logo *URLs* and `cacheImages` fetches the bytes).

---

## 6. Layout: the galaxy

Pure functions `layoutGalaxyFocus()` and `layoutGalaxyPerson(order, count)` (in `src/graph.ts`, alongside `layout`):

- **Focused company star** pinned at the top center of the galaxy (`{ x: 0, y: 0 }`), reusing the existing `CompanyNode` visual.
- **People in a single horizontal row below it** (revised from the original vertical-column sketch after eyeballing), centered under the star: `x = (order - (count-1)/2) * GALAXY_PERSON_GAP`, `y = GALAXY_DROP`. Earliest-found first (search rank order).
- **No edges in a galaxy** (revised): the people are an unconnected cluster under the star, not a beamed-out constellation. The chain beams stay an atlas-only thing.
- Deterministic and unit-testable: same `(order, count)` ⇒ same coordinates.
- A single row is fine for ~10; if a future page count makes it too wide, wrapping to multiple rows is a later refinement (not M2). React Flow `fitView` frames the galaxy after the fly-in.

A new **`PersonNode` React component**: a smaller star than the company, photo as its image (reuse `Avatar` with an initials fallback) and the **name only** (revised: headline/location are captured into the model for M3 but not shown, to keep the cluster clean). Styled as **raw/unverified** (M3 will introduce the verified/pruned visual distinction; M2 just needs "a person star").

A **disabled "Show more people" placeholder** sits at the bottom of a ready galaxy: present so its placement is designed now, disabled (not a no-op) so it stays an honest "not yet" rather than a fake affordance. It activates in M6.

---

## 7. The fly-into-star transition

The headline interaction, and the **biggest single risk/effort in M2** (§12).

- On company click, read the node's position, then `useReactFlow().setCenter(x, y, { zoom: <in>, duration: ~600ms })` to push the camera toward that star while the other chain stars cross-fade out (CSS opacity on non-focused nodes).
- At the apex of the zoom, **swap the rendered node set** to the galaxy (focused company + loading/people), then `fitView({ duration })` to settle the galaxy into frame.
- **Back / Esc** reverses it: fade the galaxy, swap back to the atlas node set, `fitView` the chain.
- Coordinating the CSS fade timing with the viewport animation and the node-set swap is the fiddly part. If the polished version slips, the fallback is fade + `fitView` without the literal camera push; recorded as a deferral, not a scope cut, since the user chose the full fly-in.

---

## 8. Orchestration: `runExpandCompany`

A new export in `orchestrator.ts`, mirroring `runSeed`, reusing its helpers (`waitForLoad`, `injectFunc`, `isLoggedOutUrl`; extract them if cleaner):

```
runExpandCompany(company: GraphNode, hooks?) → CompanyExpansion
  1. open worker tab, active:false, at the people-search URL (keywords = company.name)   [background]
  2. waitForLoad; detect logged-out
  3. inject injectedScrapePeople → PersonRecord[]
  4. EMPTY if zero results
  5. cache photos (reuse images.ts / fetchAsDataUrl, in the home page)
  6. assemble PersonNode[] (id = `${company.id}:${vanity}`, status 'raw', order by rank)
  7. write graph.expansions[company.id] = { people, keyword, fetchedAt }
  8. close worker tab on success; keep open + surfaced on error
```

**`ExpandError`** mirrors `SeedError`'s variants: `LOGGED_OUT`, `PARSE_NOT_READY`, `EMPTY` (no first-degree connections found), `GENERIC`. The worker tab stays open and is brought to the front on any error so the user sees the real page. A captcha/checkpoint lands as `PARSE_NOT_READY` for now; real **halt-on-challenge detection stays M5** (a single user-triggered load does not warrant pulling it forward).

---

## 9. UI states and navigation (React)

- **Atlas (mode 'atlas'):** M1 unchanged, except company stars now carry a **click handler** (the dormant Level-0 styling from M1 becomes live).
- **Galaxy (mode 'galaxy', companyId):**
  - **Loading:** focused star + a centered in-galaxy spinner/message ("Finding people you know at <company>…"). We **fly in immediately and populate when ready** (responsive click), rather than stalling on the atlas.
  - **Populated:** focused star + people column, people fading in.
  - **Empty:** focused star + "No first-degree connections found at <company>." with the Back affordance.
  - **Error:** focused star + an error card (reusing the `ErrorState` shape) plus Back; the worker tab is already surfaced.
- **Header in galaxy:** a breadcrumb / back control, e.g. `← Atlas` (or `Atlas / Escale`). **Esc** also flies back out.
- **Re-seed:** still **overwrites `seed` and fully regenerates `graph`**, which **silently drops `expansions`** (accepted; simplest). Re-seed is rare and explicit.

---

## 10. Persistence

- `saveGraph`/`loadGraph` are unchanged in signature (same `graph` key); the object now optionally carries `expansions`.
- **On expand success:** read graph, set `expansions[companyId]`, write graph. (The atlas `nodes`/`edges` are untouched.)
- **Re-entering a galaxy:** if `graph.expansions[companyId]` exists, render it directly, **no worker tab, no fetch**.
- **M1 graphs** have no `expansions` field; it is optional, so they load as "nothing expanded yet". No migration needed.

---

## 11. Testing

- **Fixture (`test/fixtures/people.html`):** capture the live search results HTML, then **scrub it**: replace real names, photos, headlines, and vanities with synthetic values while preserving the DOM structure (obfuscated classes, badge spans, link nesting, lazy-img shape). Commit the scrubbed fixture, so tests are shareable and **no third-party PII is checked in**. (Contrast the M0 experience fixture, which is only the user's own data.)
- **Unit (Vitest + jsdom):**
  - `injectedScrapePeople` against the fixture: exactly N real cards (excludes mutual-connection facepile + sidebar `/in/` links); **vanity-key normalization** (locale `/en`, query, trailing slash all stripped); **dedup** of the doubled a11y name/badge; a card with a missing photo still parses; headline/location extracted.
  - `layoutGalaxy`: focus at top, people in a monotonically descending column, deterministic, stable.
  - `deriveGraph` regression: still emits no `expansions` (re-seed wipe stays correct).
- **Manual live render:** click a real company, confirm the fly-in, the background worker tab, people fading in, photos rendering, Back + Esc, and that re-entering the galaxy does **not** open a worker tab.

---

## 12. Risks / things to verify

- **The fly-into-star transition (highest).** Coordinating viewport animation + CSS fade + node-set swap in React Flow is the fiddly heart of M2. Mitigation: build the data/parser/galaxy first against an instant swap, then layer the camera move; fall back to fade + `fitView` if the literal zoom fights the swap timing.
- **Search DOM drift.** Obfuscated classes mean we depend on the degree-badge + link-text anchors; verify against the captured fixture and re-probe live if results come back empty.
- **Keyword false positives / generic names.** Accepted; pruned by M3. Worth a live sanity check on a generic-named company.
- **Locale-suffixed profile URLs** (`/in/aghion/en`) and **doubled a11y nodes**: both handled by normalization + vanity-dedup; cover in tests.
- **Photo fetch volume:** ~10 image-CDN fetches per click. Low, and against `media.licdn.com`, not LinkedIn pages. Fine.
- **Search rate sensitivity:** one user-triggered load per click is human-shaped by construction; volume guardrails are M5.

---

## 13. Doc-deltas required (apply to keep docs consistent)

Like M1's deltas, these should be written back to the vision docs (not applied as part of writing this plan):

1. **Navigation model (`vision.md` §1/§4, `journey.md` §0).** "Two levels deep, all visible on one rooted graph" becomes a **drill-in model**: an atlas (level 0 company chain) and per-company galaxies (level 1 people, later level 2 leaves). You view one company's subtree at a time and navigate back to the atlas.
2. **Data source (`vision.md` §3 Pull #2, `journey.md` §3a).** The company People tab becomes a **first-degree people search keyed on company name** (`network=["F"]`), one query, with M3 pruning the keyword's false positives.
3. **Cross-company convergence (`journey.md` §4).** Because you see one galaxy at a time, convergence is only ever **within a single company's galaxy** (two colleagues from the same company landing at the same onward place, an M4 effect). The atlas-wide "two people from *different* companies both ended up at Z" view is **not** shown. (A future global view could restore it; out of scope.)
4. **Re-click behavior.** The earlier "expanded company collapses inline" idea is moot: there is no inline expansion. You drill in and navigate back.

---

## 14. Tensions and deferrals carried forward

- **Re-seed drops expansions silently.** Accepted as simplest (§9). If expansions ever get expensive to rebuild, revisit with a warn-or-merge.
- **Fly-in fallback.** If the camera push proves too fiddly, ship fade + `fitView` and carry the literal zoom as polish (§7, §12).
- **Single-column galaxy.** Fine for one page (~10); a fan/multi-column variant waits until M6 load-more makes columns tall.
- **Raw vs verified styling.** M2 person stars are "raw"; the verified/pruned visual language is M3 (§6). The `status` field already exists to carry it.
- **Challenge detection deferred to M5** (§8); M2 surfaces the worker tab on any failure.

---

## 15. Decision log

| Topic | Decision |
|-------|----------|
| M2 scope | **Strict:** one search load per click, parse first page (~10), plot raw Level 1 people. No profile visits, overlap, onward, scroll, or pagination |
| Data source | **First-degree people search** keyed on company name, `network=["F"]`; one query (not company current/past facets) |
| Keyword false positives | **Accepted**, pruned by M3; the two milestones lean on each other |
| Navigation | **Drill-in:** atlas (company chain) ↔ per-company galaxy (focused star + people); one subtree at a time |
| Atlas→galaxy transition | **Full fly-into-the-star** camera move now (fallback: fade + fitView) |
| Back affordance | **`← Atlas` control + Esc key** |
| Reopen state | **Always reopen at the atlas**; navigation state is transient, data persists |
| Cross-company convergence | **Not shown** (per-galaxy only); recorded as a doc-delta |
| Worker tab | **Background** (`active:false`), like seed; surfaced only on error |
| Fetch vs fly-in | **Fly in immediately, populate when ready** (in-galaxy loading state) |
| Person identity | Profile vanity, but **per-company node** (`${companyId}:${vanity}`) |
| Person photos | **Cache as data URLs** now (reuse `images.ts`), people become stars too |
| Store shape | **Separate `expansions` map** on `CareerGraph`, keyed by company node id |
| Person status | **`status` field present from M2** (`'raw'`); M3 writes verified/pruned |
| Parser | New self-contained `injectedScrapePeople`; anchor on **degree badge** + link text (classes obfuscated); normalize vanity; dedup; grace-period photo poll |
| Galaxy layout | Focused star top-center, **people in a vertical column below**, deterministic `layoutGalaxy` |
| Re-entering a galaxy | **No re-fetch**; render stored people |
| Re-seed | **Silently regenerates and drops expansions** (accepted) |
| Error handling | **Mirror `SeedError`** (LOGGED_OUT / PARSE_NOT_READY / EMPTY / GENERIC); **defer captcha/challenge to M5** |
| Test fixture | **Scrub real PII, then commit** `people.html`; unit-test parser + `layoutGalaxy` |
| Manifest/permissions | **Unchanged** |
