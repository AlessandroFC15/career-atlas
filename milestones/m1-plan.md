# M1 — Plot the Seed: Detailed Plan

Detailed implementation plan for Milestone 1 (see `milestones.md`). Every decision below was resolved in a design interview; the choices and their rationale are recorded in the Decision Log at the end. This plan builds directly on M0 (`m0-plan.md`), reusing its `Seed`, parser, image cache, and UI shell unchanged.

> **Topology change from the vision docs.** M1 renders the seed as a **horizontal career chain** (`[first company] → [next] → …`), not the "you at the center, companies radiating" star described in `vision.md` §1/§4. This is a deliberate supersede; the required doc-deltas are listed in §12. Note the chain is already closer to the left-to-right flow drawn in `journey.md` §0.

---

## 1. Definition of done

With a seed already captured (from M0, or freshly seeded), the user:

1. Opens the extension. The seeded view is now a **graph**, not a list.
2. Sees a **header bar** (avatar + name + company count + Re-seed) above a full-tab graph canvas.
3. The canvas shows their companies as a **left-to-right chain**, earliest on the left: `[Acme] ▶ [Beta] ▶ [Gamma]`, each node showing **logo + name + tenure**, connected by directed arrows in career order.
4. The graph **fits to view** on load; the user can **pan and zoom**. Nodes are static (no drag, no click action yet).
5. **Reopening the extension re-renders the same graph from the materialized `graph` store**, not by re-deriving from the Seed and never by re-reading LinkedIn.

Plus: a stored M0-era seed (which has no `graph` yet) **migrates silently on mount**. Pure derivation and layout functions have unit tests.

The graph is **not interactive beyond pan/zoom** in M1. Expansion is M2.

---

## 2. Tech foundation

- Unchanged from M0: TypeScript + Vite (CRXJS), React 18, Chrome MV3, full extension page as the home surface.
- **New dependency: `@xyflow/react` (React Flow).** React-native nodes/edges, built-in pan/zoom/fit-view, custom React node components (lets us reuse M0's `Avatar`/`CompanyLogo`), and click handlers ready to wire in M2.
- No manifest/permission changes: no new hosts, no new APIs. React Flow is bundled into the page build. (Risk to verify: React Flow injects a stylesheet; confirm it loads under the extension page CSP — see §11.)

---

## 3. Architecture and component topology

```
storage.local
  seed   ── raw capture (M0, unchanged)
  graph  ── NEW: materialized working model { nodes, edges }

HOME TAB (React)
  mount → load seed + graph
        → if seed && !graph: derive(seed) → write graph   (migration)
  view === 'seeded':
        <Header avatar name count onReseed/>
        <CareerGraph graph={graph} />        ◀── React Flow
              nodeTypes={{ company: CompanyNode }}
              positions from layout(order)   (computed, not stored)
              fitView, pan/zoom, nodesDraggable={false}
```

- The graph is a **materialized store**, a second `chrome.storage.local` key `graph`, derived from the `Seed`. The `Seed` remains the raw capture; `graph` is the mutable working model that M2–M4 append people/companies/prune into. M1 therefore proves *graph* persistence, not merely the Seed persistence M0 already had.
- **Empty / seeding / error states are reused from M0 unchanged.** Only the `seeded` view changes: the list component is retired and replaced by `<CareerGraph>`.
- Orchestration (the seed run) is untouched from M0; M1 only adds a derivation step after a successful seed and the graph render.

---

## 4. Data model

New types (in `src/types.ts`), alongside the existing `Seed`:

```ts
/** One node in the working graph. M1 only emits company nodes (Level 0). */
interface GraphNode {
  id: string;            // stable per stint: `c${index}` (NOT the URN — boomerangs collide)
  kind: 'company';       // M2 adds 'person'; M4 adds 'onward'
  level: 0;              // Level 0 = your own companies (the expandable tier, later)
  order: number;         // chain position, 0-based, by ascending start date
  name: string;
  companyUrl?: string;
  companyUrn?: string;
  logoDataUrl?: string;
  start: DateParts;      // aggregate tenure (from the ExperienceEntry)
  end: DateParts | null; // null = Present
  rawDateText: string;
  roleCount: number;     // >1 ⇒ multi-role stint (face shows tenure; roles deferred)
}

interface GraphEdge {
  id: string;            // `e${i}` 
  source: string;        // company id at order i
  target: string;        // company id at order i+1
  kind: 'next';          // career-progression edge
}

interface CareerGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  derivedFrom: number;   // seed.seededAt this graph was built from (staleness check)
}
```

- **One `GraphNode` = one `ExperienceEntry` = one tenure.** A company worked in two separate stints is **two nodes** at two chain positions (boomerang), so node id is per-stint (`c${index}`), never the URN. There is **no company dedup in M1** (it would fold the timeline); the company-key/normalize util stays an M4 concern. This does not affect M4's *onward-company* dedup, which is a different axis.
- **No x/y is stored.** Positions are a pure function of `order` computed at render (§6), so the store stays layout-agnostic and re-layout is free.
- Stored under a single new key `graph`. Re-seeding overwrites it (idempotent rebuild).

---

## 5. Derivation: Seed → CareerGraph

A pure function `deriveGraph(seed: Seed): CareerGraph`.

1. Sort `seed.experiences` by ascending start (`year*12 + (month ?? 0)`), the same key M0's list used.
2. Emit one `GraphNode` per entry, `order = index`, `id = c${index}`, copying name/url/urn/logoDataUrl/start/end/rawDateText and `roleCount = entry.roles.length`.
3. Emit a `next` edge between each consecutive pair (`c${i} → c${i+1}`). A single-company seed yields one node and zero edges.
4. Set `derivedFrom = seed.seededAt`.

**Concurrency:** overlapping tenures are simply placed in start-date order on the one line (accepted imperfection; a parallel-branch rendering is a possible future refinement, not M1).

---

## 6. Layout

A pure function `layout(order: number): { x: number; y: number }`:

- `x = order * COL_GAP`, `y = 0` (single horizontal row, earliest at left).
- Constants (`COL_GAP`, node dimensions) tuned during implementation for legibility.
- Deterministic and unit-testable: same `order` ⇒ same coordinates, stable across reopens.
- React Flow's `fitView` frames the whole chain on load regardless of company count.

---

## 7. Rendering (React Flow)

- `<ReactFlow nodes edges nodeTypes={{ company: CompanyNode }} fitView nodesDraggable={false} nodesConnectable={false} />`.
- **`CompanyNode`** (custom node): logo (reuse M0 `CompanyLogo`, initials-tile fallback) + company name + tenure (reuse M0 `formatTenure`). Rendered in a **dormant Level-0 style** that visually marks it as the expandable tier, with **no click handler** in M1 (M2 wires the same node's click). No fake affordance that does nothing.
- **Edges:** default React Flow edge with an arrowhead marker; no labels.
- **Chrome:** include zoom `<Controls>`; **no MiniMap** (the chain is small); a subtle `<Background>` is optional. Pan/zoom enabled.
- Import React Flow's stylesheet (`@xyflow/react/dist/style.css`) in the graph module.

---

## 8. UI states (React)

- **Empty / Seeding / Error:** unchanged from M0.
- **Seeded:** `<Header>` (avatar + name + "N companies" + Re-seed button, lifted from M0's `SeededState` header) above `<CareerGraph>`. The M0 company-list markup is removed.
- **Re-seed:** overwrites `seed` and **fully regenerates** `graph` via `deriveGraph` (idempotent). Acceptable in M1 because the graph is pure seed-derived. *(Flagged for later: once M2+ store expansion progress in the graph, re-seed must preserve or warn. Out of M1 scope; noted in §10.)*

---

## 9. Persistence and migration

- New storage helpers in `src/storage.ts`: `loadGraph()`, `saveGraph(graph)` (mirroring the existing `loadSeed`/`saveSeed`; new key `graph`).
- **On successful seed:** after writing `seed`, derive and write `graph`.
- **On mount:** load both. If `seed` exists but `graph` is absent (the M0-era stored seed), derive it then and persist, then render. Existing data upgrades silently with no re-seed and no LinkedIn hit.
- **Staleness guard:** if `graph.derivedFrom !== seed.seededAt` (e.g. a seed written by an older path), re-derive. Cheap correctness insurance.

---

## 10. Testing

- **Unit (Vitest + jsdom, as M0):**
  - `deriveGraph(seed)` — node/edge shape and count; ascending-start ordering; **boomerang ⇒ two nodes with distinct ids**; single-company ⇒ one node, zero edges; missing-URN entry still produces a node; `roleCount` reflects multi-role stints.
  - `layout(order)` — deterministic, monotonically increasing x, stable coordinates.
- **Manual live render:** load the unpacked extension and confirm the chain renders, fits to view, pans/zooms, and that **reopening renders from the `graph` store** (verify no re-derive/re-seed: e.g. a one-time log or DevTools storage inspection).
- **No React Flow component/render test** in M1: it needs ResizeObserver/measurement mocks for fiddly value at this stage. The render is eyeballed, as M0's was.

---

## 11. Risks / things to verify

- **React Flow under extension-page CSP.** React Flow injects styles and measures the DOM; confirm it renders correctly inside a `chrome-extension://` page (CRXJS build). If the injected stylesheet is blocked, import the CSS as a bundled asset. Verify early.
- **Node sizing vs. fit-view.** Custom nodes with images need stable dimensions for `fitView` to frame correctly; set explicit node width/height.
- **Long chains.** Many companies ⇒ a wide canvas; `fitView` + pan/zoom is the mitigation. No virtualization needed at career scale.

---

## 12. Doc-deltas required (apply to keep docs consistent)

This plan supersedes the vision in two places; like `journey.md`'s existing deltas, these should be written back:

1. **`vision.md` §1 / §4 — topology.** "You at the center, your companies radiating as Level 0 nodes" is **replaced** by a **horizontal career chain**: companies in chronological order, each linked to the next, with the user shown in a header bar (no self node in the graph). Companies remain the Level 0 (later-expandable) tier.
2. **Boomerang.** The dedup-by-URN-into-one-company-node assumption (`journey.md` Dedup; `m0-plan.md` §13) is **locally excepted for the seed chain**: two stints at one company = two chain nodes at two time points. M4's *onward-company* dedup is unaffected.

*(I can apply these edits on request; they are not made as part of writing this plan.)*

---

## 13. Tensions and deferrals carried forward

- **Re-seed wipes graph state.** Harmless in M1 (graph is pure-derived) but must be revisited at M2+ when the graph holds non-derivable expansion progress. (§8)
- **Concurrency rendering.** Overlapping tenures sit inline in start order; a parallel-branch treatment is a possible future refinement. (§5)
- **Click is a no-op.** Company nodes carry dormant Level-0 styling but no behavior; M2 wires the click for expansion onto the same node. (§7)
- **Two-stint reconciliation** (from `m0-plan.md` §13) is resolved *for the chain* as two nodes; the broader URN reconciliation remains an M4 topic.

---

## 14. Decision log

| Topic | Decision |
|-------|----------|
| Persisted unit | **Materialize a `graph` store** now (nodes/edges), derived from `Seed`; Seed stays the raw capture |
| Rendering library | **React Flow (`@xyflow/react`)** |
| Topology | **Horizontal career chain** (first company → next → …), not a star |
| Self node | **None** in the graph; avatar + name live in a header bar |
| Ordering | **Chronological by start date**, ascending |
| Concurrency | Overlapping tenures sit **inline in start order** (parallel branching deferred) |
| Direction | **Horizontal, left→right** (earliest left); directed arrow edges, no labels |
| Boomerang (two stints) | **Two nodes** at two time points; **no dedup** in M1 |
| Node id | Per-stint `c${index}` (URN would collide on boomerangs) |
| Node face | **Logo + name + tenure** (reuse `CompanyLogo` + `formatTenure`); roles deferred |
| Interaction | **Pan/zoom + fit-view; nodes static** (no drag, no click action) |
| Dormant styling | Mark Level 0 visually; no behavior until M2 |
| List view | **Replaced** by the graph; list component retired |
| Positions | **Computed at render** via `layout(order)`; **not stored** |
| Derivation timing | **At seed-time + lazy migration on mount** for M0-era seeds |
| Re-seed | **Overwrite seed + full graph regenerate** (idempotent) |
| Testing | **Unit-test `deriveGraph` + `layout`**; manual live render validation |
| Manifest/permissions | **Unchanged** (no new hosts/APIs) |
