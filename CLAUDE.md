# Career Atlas

A Chrome extension (MV3) that builds and explores your career graph from your own LinkedIn history. TypeScript + Vite (CRXJS), React 18, React Flow (`@xyflow/react`) for the graph. Milestone plans live in `milestones/`.

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

## Conventions

- Pure, side-effect-free logic (e.g. `deriveGraph`, `layout` in `src/graph.ts`) stays free of DOM/storage/React and is unit-tested (Vitest + jsdom). React Flow rendering is eyeballed, not unit-tested.
- Writing style: no em dashes.
