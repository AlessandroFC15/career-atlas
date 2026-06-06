// Pure Seed → CareerGraph derivation and layout (m1-plan §5, §6). No DOM, no
// storage, no React: kept side-effect-free so both functions are unit-testable.

import type {
  CareerGraph,
  DateParts,
  PersonNode,
  PersonRecord,
  Seed,
} from './types';

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

// --- M2: galaxy (drill-in) layout and person-node construction (m2-plan §4,
// §6). A galaxy shows one focused company star with its people in a vertical
// column below it. Pure and deterministic, like layout() above. ---

/** Gap below the focused star to the people row. Generous, so the title sits
 *  between them and the star reads as anchored near the top. */
export const GALAXY_DROP = 320;
/** Gap below the focused star to the title (between the star and the row). */
export const GALAXY_TITLE_DROP = 170;
/** Horizontal gap between adjacent people in the row. Tight, since names are
 *  hidden by default (shown on hover), so the orbs read as a close cluster. */
export const GALAXY_PERSON_GAP = 78;
/** Empty room reserved BELOW the people row, so the composition sits high and
 *  there is space for each person's onward trajectory (M4) to grow downward. */
export const GALAXY_RESERVE_BELOW = 300;

/** The focused company sits at the galaxy origin (top, centered). */
export function layoutGalaxyFocus(): { x: number; y: number } {
  return { x: 0, y: 0 };
}

/**
 * Person at position `order` of `count`: a single horizontal row centered below
 * the focused star, so the spokes fan out symmetrically from the company.
 */
export function layoutGalaxyPerson(
  order: number,
  count: number,
): { x: number; y: number } {
  const centered = order - (count - 1) / 2;
  return { x: centered * GALAXY_PERSON_GAP, y: GALAXY_DROP };
}

/**
 * Build raw Level 1 person nodes from parsed search records (§4). Person ids are
 * scoped to the company (`${companyId}:${vanity}`), so the same human under two
 * of your companies is two nodes. `status` starts 'raw' (M3 flips it in place);
 * `photoDataUrl` is filled by the orchestrator after fetching the bytes.
 */
export function personNodesFromRecords(
  companyId: string,
  records: PersonRecord[],
): PersonNode[] {
  return records.map((r, index) => ({
    id: `${companyId}:${r.vanity}`,
    kind: 'person' as const,
    level: 1 as const,
    parentId: companyId,
    vanity: r.vanity,
    profileUrl: r.profileUrl,
    name: r.name,
    headline: r.headline,
    location: r.location,
    photoUrl: r.photoUrl,
    status: 'raw' as const,
    order: index,
  }));
}
