// Pure Seed → CareerGraph derivation and layout (m1-plan §5, §6). No DOM, no
// storage, no React: kept side-effect-free so both functions are unit-testable.

import type {
  CareerGraph,
  DateParts,
  ExperienceEntry,
  GraphNode,
  OnwardStint,
  PersonNode,
  PersonRecord,
  Seed,
} from './types';

/** Sort key: oldest start first (chronological). Same key M0's list used. */
function startValue(d: DateParts): number {
  return d.year * 12 + (d.month ?? 0);
}

/** Normalize a company name for fuzzy matching/dedup: lowercase, collapse
 *  whitespace, strip a trailing `·`-suffix ("· Full-time", "· 2 yrs"). Mirrors
 *  the parser's nested `beforeDot`, which can't be imported (it lives inside the
 *  injected scraper). Used as the anchor name-fallback and the convergence key
 *  when no URN is present. (M3 §5b) */
export function normalizeCompanyName(name: string): string {
  return name.split('·')[0].toLowerCase().replace(/\s+/g, ' ').trim();
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
// beam between orbs without crowding the constellation.
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
// §6). A galaxy shows one focused company orb with its people in a vertical
// column below it. Pure and deterministic, like layout() above. ---

/** Gap below the focused orb to the people row. The title sits between them and
 *  the orb reads as anchored near the top. */
export const GALAXY_DROP = 250;
/** Gap below the focused orb to the title (between the orb and the row). Kept
 *  close to the row so the heading reads as the cluster's label. */
export const GALAXY_TITLE_DROP = 158;
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
 * the focused orb, so the spokes fan out symmetrically from the company.
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

// --- M3: trace where a colleague went (m3-plan §5, §6). Anchor a colleague's
// history on the shared company, cut to "where they went next", and lay those
// onward employers out as a per-colleague swimlane on a continuous time axis.
// All pure and deterministic, like the layout helpers above. ---

/** True when an experience entry is the focused company: URN-equal when BOTH
 *  sides carry one (reliable), else normalized-name-equal (fuzzy fallback). */
function isSharedCompany(company: GraphNode, entry: ExperienceEntry): boolean {
  if (company.companyUrn && entry.companyUrn) {
    return company.companyUrn === entry.companyUrn;
  }
  return normalizeCompanyName(company.name) === normalizeCompanyName(entry.companyName);
}

/**
 * Anchor a colleague's history on the shared company and cut to their onward
 * trajectory (m3-plan §5b):
 *  1. Find their stint(s) at the focused company (URN-first, name-fallback);
 *     boomerang ⇒ anchor on the EARLIEST matching stint (fullest, deterministic).
 *  2. No match ⇒ { matched: false } (the false-positive path, not an error).
 *  3. Cut "after they left": Present at the company ⇒ terminal (empty onward);
 *     else keep entries starting ON OR AFTER the anchor's end, excluding the
 *     shared company itself. A job starting the SAME month they left is a
 *     seamless next move and counts; side roles that started EARLIER (overlapping
 *     the tenure) are dropped.
 *  4. Sort ascending by start; map to OnwardStint (logo bytes fetched later).
 */
export function deriveOnward(
  company: GraphNode,
  theirExperiences: ExperienceEntry[],
): { matched: boolean; onward: OnwardStint[] } {
  const matches = theirExperiences.filter((e) => isSharedCompany(company, e));
  if (matches.length === 0) return { matched: false, onward: [] };

  const anchor = matches.reduce((earliest, e) =>
    startValue(e.start) < startValue(earliest.start) ? e : earliest,
  );

  const leftAt = anchor.end;
  if (leftAt === null) return { matched: true, onward: [] }; // still there (terminal)

  const leftValue = startValue(leftAt);
  const onward = theirExperiences
    .filter((e) => !isSharedCompany(company, e) && startValue(e.start) >= leftValue)
    .sort((a, b) => startValue(a.start) - startValue(b.start))
    .map<OnwardStint>((e) => ({
      companyName: e.companyName,
      companyUrl: e.companyUrl,
      companyUrn: e.companyUrn,
      logoUrl: e.logoUrl,
      logoDataUrl: e.logoDataUrl,
      start: e.start,
      end: e.end,
      roles: e.roles.map((r) => r.title),
    }));

  return { matched: true, onward };
}

// Swimlane band geometry (m3-plan §6). Coordinates are RELATIVE to the galaxy's
// row center (x) and the focused orb's base y, exactly like layoutGalaxyPerson,
// so build.ts can offset them the same way. The band sits below the candidate
// cluster; lanes stack downward in click order.
/** Top of the band, below the people cluster row (GALAXY_DROP). */
export const BAND_TOP = GALAXY_DROP + 155;
/** Vertical gap between adjacent colleague lanes. Roomy enough for the leaf
 *  orbs plus their two-line (name + year) labels. */
export const LANE_GAP = 156;
/** Left edge of the time axis, relative to the row center (so the axis is
 *  centered under the composition). */
export const AXIS_LEFT = -460;
/** Full width of the time axis. */
export const AXIS_WIDTH = 920;

/** Minimum horizontal distance between two leaves on the same lane. The real
 *  footprint of a leaf is its label (120px, `.onward-node__label`), not the
 *  56px orb, so the orbs clear each other long before the labels do. This sits
 *  just under the label width: neighbouring labels can graze, which keeps
 *  leaves closer to their true dates, and the text still reads because a name
 *  rarely fills its box. */
export const MIN_LEAF_GAP = 100;

/** How far left of the axis the lane face sits. The face is not an event on the
 *  time axis, it is the lane's label, so it lives in the margin before time
 *  starts rather than competing for space on it. That keeps it clear of a first
 *  stint that begins at (or before) `focus.start`, which lands exactly on
 *  `AXIS_LEFT`. Same size as `MIN_LEAF_GAP`, for the same label-width reason. */
export const FACE_GUTTER = MIN_LEAF_GAP;

/** The convergence accent key for an onward stint: its URN when present, else
 *  the normalized company name (m3-plan §6d). */
export function onwardAccentKey(stint: OnwardStint): string {
  return stint.companyUrn ?? normalizeCompanyName(stint.companyName);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Map a date to its x on the fixed time axis (m3-plan §6b). Relative to the row
 * center. The range is fixed once (`[min, max]`) so adding a lane never shifts
 * lanes already on screen; a date outside the range clamps to an edge.
 */
export function swimlaneX(date: DateParts, min: DateParts, max: DateParts): number {
  const lo = startValue(min);
  const hi = startValue(max);
  const span = hi - lo;
  const t = span <= 0 ? 0 : clamp01((startValue(date) - lo) / span);
  return AXIS_LEFT + t * AXIS_WIDTH;
}

/** One onward leaf positioned on its lane. */
export interface SwimlaneLeaf {
  stint: OnwardStint;
  x: number; // relative to row center
  y: number; // relative to base y
  accentKey: string;
  convergent: boolean; // shares its accent key with a leaf in another lane
}

/** One colleague's lane: a face in the gutter before the axis, and its onward
 *  leaves on the axis itself. */
export interface Swimlane {
  person: PersonNode;
  laneIndex: number;
  faceX: number; // relative to row center
  faceY: number; // relative to base y
  leaves: SwimlaneLeaf[];
}

/** A company reached by ≥2 colleagues (the convergence payoff, m3-plan §6d). */
export interface ConvergenceGroup {
  key: string;
  members: { laneIndex: number; leafIndex: number; x: number; y: number }[];
}

export interface SwimlaneLayout {
  lanes: Swimlane[];
  convergences: ConvergenceGroup[];
  /** Lowest occupied y (the last lane's row), so the caller can size the band. */
  bottomY: number;
}

/**
 * Nudge leaves apart so no two on a lane are closer than `MIN_LEAF_GAP`, moving
 * them as little as possible from their true dates.
 *
 * `xs` is ascending (leaves are sorted by start). Substituting `z_i = x_i - i*gap`
 * turns "keep a gap between neighbours" into "keep the sequence non-decreasing",
 * which pool-adjacent-violators solves exactly: each run of colliding leaves
 * collapses to a block, and the block sits at the mean of its members' wishes.
 * That is the re-centering we want, the drift splits both ways around the run's
 * original midpoint instead of shoving everything rightward, and leaves that
 * already had room do not move at all.
 */
function spaceLeaves(xs: number[], gap: number): number[] {
  const blocks: { sum: number; n: number }[] = [];
  xs.forEach((x, i) => {
    blocks.push({ sum: x - i * gap, n: 1 });
    // Merge back while the new block would sit left of the one before it.
    while (blocks.length > 1) {
      const cur = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.n <= cur.sum / cur.n) break;
      blocks.pop();
      blocks.pop();
      blocks.push({ sum: prev.sum + cur.sum, n: prev.n + cur.n });
    }
  });

  const out: number[] = [];
  blocks.forEach((b) => {
    const mean = b.sum / b.n;
    for (let k = 0; k < b.n; k++) out.push(mean + out.length * gap);
  });

  // A long lane can be pushed past the shared "today" line, which would make a
  // Present-tail beam point backwards. Slide the whole lane back inside the axis
  // as far as its left edge allows; a lane with more leaves than the axis can
  // hold overflows rather than collapsing on itself.
  const overflow = out.length ? out[out.length - 1] - (AXIS_LEFT + AXIS_WIDTH) : 0;
  if (overflow > 0) {
    const room = Math.max(0, out[0] - AXIS_LEFT);
    const shift = Math.min(overflow, room);
    if (shift > 0) return out.map((x) => x - shift);
  }

  // Re-centering a run whose leaves all sit at the axis start (a colleague who
  // left before you did) drifts the first one left of the axis, into the face's
  // gutter. Slide the lane back so nothing starts before time does; the gaps
  // are already correct, so the whole run moves together.
  const underflow = out.length ? AXIS_LEFT - out[0] : 0;
  if (underflow > 0) return out.map((x) => x + underflow);
  return out;
}

/**
 * Lay out the swimlane band (m3-plan §6): one lane per traced colleague, in
 * the given order (click order), on a continuous time axis fixed to
 * `[focus.start, now]`. Onward leaves sit at their true start dates, nudged apart
 * only where they would otherwise collide (`spaceLeaves`); companies
 * reached by ≥2 colleagues are flagged convergent and returned as groups so the
 * renderer can draw the shared glow + threads. Pure: `now` is injected.
 */
export function layoutSwimlanes(
  focus: GraphNode,
  tracedPeople: PersonNode[],
  now: DateParts,
): SwimlaneLayout {
  const min = focus.start;
  const max = now;

  const lanes: Swimlane[] = tracedPeople.map((person, laneIndex) => {
    const faceY = BAND_TOP + laneIndex * LANE_GAP;
    const stints = person.onward ?? [];
    // True dates first, then a spacing pass so close starts stay readable.
    const xs = spaceLeaves(
      stints.map((stint) => swimlaneX(stint.start, min, max)),
      MIN_LEAF_GAP,
    );
    const leaves: SwimlaneLeaf[] = stints.map((stint, i) => ({
      stint,
      x: xs[i],
      y: faceY,
      accentKey: onwardAccentKey(stint),
      convergent: false,
    }));
    return { person, laneIndex, faceX: AXIS_LEFT - FACE_GUTTER, faceY, leaves };
  });

  // Group leaves across all lanes by accent key; a key spanning ≥2 distinct
  // lanes is a convergence. Flag those leaves and emit the groups.
  const byKey = new Map<string, { laneIndex: number; leafIndex: number }[]>();
  lanes.forEach((lane) => {
    lane.leaves.forEach((leaf, leafIndex) => {
      const list = byKey.get(leaf.accentKey) ?? [];
      list.push({ laneIndex: lane.laneIndex, leafIndex });
      byKey.set(leaf.accentKey, list);
    });
  });

  const convergences: ConvergenceGroup[] = [];
  byKey.forEach((members, key) => {
    const distinctLanes = new Set(members.map((m) => m.laneIndex));
    if (distinctLanes.size < 2) return;
    members.forEach((m) => {
      lanes[m.laneIndex].leaves[m.leafIndex].convergent = true;
    });
    convergences.push({
      key,
      members: members.map((m) => {
        const leaf = lanes[m.laneIndex].leaves[m.leafIndex];
        return { laneIndex: m.laneIndex, leafIndex: m.leafIndex, x: leaf.x, y: leaf.y };
      }),
    });
  });

  const bottomY = lanes.length ? BAND_TOP + (lanes.length - 1) * LANE_GAP : BAND_TOP;
  return { lanes, convergences, bottomY };
}
