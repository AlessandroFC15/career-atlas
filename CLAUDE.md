# Career Atlas

A Chrome extension (MV3) that builds and explores your career graph from your own LinkedIn history. TypeScript + Vite (CRXJS), React 18, React Flow (`@xyflow/react`) for the graph. Design docs live in `docs/`: milestone plans in `docs/milestones/`, focused feature plans in `docs/plans/`.

## Visual direction: cosmic / star chart

**The feeling we're after:** a soulful product, with a lot of craft and care evident in the details. Minimalism is part of that: restraint, generous space, nothing decorative that doesn't earn its place. Polish the small things (motion, spacing, glow, typography); resist clutter and feature-shaped noise. Every element should feel deliberate. When a choice is between "more" and "considered," choose considered.

The product's identity is **your career as a star chart**. Keep this metaphor when adding or changing UI:

- **Deep space background.** Near-black base (`--bg: #05070f`) with a radial "looking into the galaxy" glow toward the top (`--bg-core`), over a layered starfield: a fixed CSS far-field (tiled stars + vignette on `html, body`) plus React Flow's `<Background>` dots as a near-field layer that drifts on pan/zoom (parallax).
- **Companies are stars.** Graph nodes are glassy, softly glowing cards floating in the void (`backdrop-filter: blur`, soft outer glow + inner highlight). Edges are faint beams of light with a subtle glow.
- **Starlight-indigo accent** (`--accent: #7c8cff`), not the old LinkedIn blue. Accent carries a glow (`--glow`) on buttons, brand text, etc.
- **Glassy panels.** Bars, headers, and cards use translucent dark glass so the starfield shows through.
- **Logos** keep a white tile so they read as little glowing badges against the dark; fallbacks are indigo-tinted tiles.

Theme is centralized in CSS variables at the top of `src/home/styles.css` (`--bg`, `--bg-core`, `--card`, `--border`, `--text`, `--muted`, `--accent`, `--accent-dark`, `--glow`, `--edge`). Prefer adjusting variables over hardcoding colors.

Open taste calls (not yet decided): exact accent hue (indigo vs. cyan vs. gold/cartographic), and star density.

## Vocabulary

Settled names for the app's surfaces and actions. Use these in code, docs, and
conversation; don't invent synonyms.

**Two views** (the whole app is `GraphView` in `src/home/CareerGraph.tsx`, a two-mode union):

- **Atlas** (`mode: 'atlas'`): all of your companies as the horizontal career chain. The home view.
- **Galaxy** (`mode: 'galaxy'`, keyed by `companyId`): one company drilled into. That
  company as the major star, its people as a cluster below it, and the swimlanes of
  whoever you've traced. You're in exactly one galaxy at a time.

**Inside a galaxy** (not views, layers within the galaxy):

- **Cluster**: the row of untraced candidate people under the company star.
- **Swimlane**: one traced person's onward path, on the continuous real-time axis.
  One lane per person, stacked in click order. (`Swimlane`, `SwimlaneLeaf`,
  `swimlaneX` in `src/graph.ts`.)
- **Leaf**: a single onward stint on a swimlane. Never expandable.
- **Convergence**: the shared accent + thread when two lanes land at the same company.

**Two actions, two words. Never mix them:**

- **Expand**: a *company* into its people (M2). One people-search page per click.
- **Trace**: a *person* into their onward stints (M3). One profile visit per click.

So: you expand a company, you trace a colleague. A person is `raw` (candidate),
`traced`, or `dismissed` (a keyword false positive).

## Conventions

- Pure, side-effect-free logic (e.g. `deriveGraph`, `layout` in `src/graph.ts`) stays free of DOM/storage/React and is unit-tested (Vitest + jsdom). React Flow rendering is eyeballed, not unit-tested.
- Writing style: no em dashes.
- Git: commit directly to `main` (no feature branch) unless told otherwise.
- After finishing a change that should be live-verified (anything visual or runtime, not just unit-tested logic), always run `npm run build` so the user can load the extension and test it.
