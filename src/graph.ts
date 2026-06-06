// Pure Seed → CareerGraph derivation and layout (m1-plan §5, §6). No DOM, no
// storage, no React: kept side-effect-free so both functions are unit-testable.

import type { CareerGraph, DateParts, Seed } from './types';

/** Sort key: oldest start first (chronological). Same key M0's list used. */
function startValue(d: DateParts): number {
  return d.year * 12 + (d.month ?? 0);
}

/**
 * Derive the materialized career graph from a Seed (§5).
 *
 * One GraphNode per ExperienceEntry (= one tenure), ordered by ascending start
 * date. A company worked twice is two nodes at two chain positions (boomerang),
 * so node ids are per-stint `c${index}`, never the URN. No company dedup in M1.
 */
export function deriveGraph(seed: Seed): CareerGraph {
  const ordered = [...seed.experiences].sort(
    (a, b) => startValue(a.start) - startValue(b.start),
  );

  const nodes = ordered.map((entry, index) => ({
    id: `c${index}`,
    kind: 'company' as const,
    level: 0 as const,
    order: index,
    name: entry.companyName,
    companyUrl: entry.companyUrl,
    companyUrn: entry.companyUrn,
    logoDataUrl: entry.logoDataUrl,
    start: entry.start,
    end: entry.end,
    rawDateText: entry.rawDateText,
    roleCount: entry.roles.length,
  }));

  // A `next` edge between each consecutive pair. One node ⇒ zero edges.
  const edges = nodes.slice(1).map((node, i) => ({
    id: `e${i}`,
    source: nodes[i].id,
    target: node.id,
    kind: 'next' as const,
  }));

  return { nodes, edges, derivedFrom: seed.seededAt };
}

// Layout constants, tuned for legibility against the node dimensions in
// CareerGraph.tsx (orb ~84). COL_GAP > orb width leaves runway for the edge
// beam between stars without crowding the constellation.
export const COL_GAP = 220;

/**
 * Position for a node at chain position `order` (§6): a single horizontal row,
 * earliest at left. Pure and deterministic — same order ⇒ same coordinates,
 * stable across reopens. React Flow's fitView frames the whole chain on load.
 */
export function layout(order: number): { x: number; y: number } {
  return { x: order * COL_GAP, y: 0 };
}
