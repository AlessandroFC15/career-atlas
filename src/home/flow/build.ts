import type { Edge, Node } from '@xyflow/react';
import { formatTenure } from '../../format';
import {
  AXIS_LEFT,
  AXIS_WIDTH,
  BAND_TOP,
  GALAXY_DROP,
  GALAXY_RESERVE_BELOW,
  GALAXY_TITLE_DROP,
  LANE_GAP,
  layout,
  layoutGalaxyFocus,
  layoutGalaxyPerson,
  layoutSwimlanes,
} from '../../graph';
import type {
  CareerGraph as CareerGraphModel,
  DateParts,
  GraphNode,
  PersonNode as PersonNodeModel,
} from '../../types';
import { NODE_WIDTH, ONWARD_NODE_WIDTH, PERSON_NODE_WIDTH } from './dimensions';
import type { CompanyNodeData, OnwardNodeData, PersonNodeData } from './nodes';

/** Tenure string for a graph node (reuses M0's formatTenure shape). */
export function tenureOf(n: GraphNode): string {
  return formatTenure({
    start: n.start,
    end: n.end,
    rawDateText: n.rawDateText,
    companyName: n.name,
    roles: [],
  });
}

/** Build the atlas (company chain) node/edge sets. When `fadeExceptId` is set
 *  (the drill-in "entering" beat), every company except that one is marked to
 *  fade out, so the siblings dissolve before the galaxy swaps in. */
export function buildAtlas(
  graph: CareerGraphModel,
  colors: Record<string, string>,
  fadeExceptId?: string,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node<CompanyNodeData>[] = graph.nodes.map((n) => ({
    id: n.id,
    type: 'company',
    position: layout(n.order),
    data: {
      name: n.name,
      logoDataUrl: n.logoDataUrl,
      tenure: tenureOf(n),
      color: colors[n.id],
      index: n.order,
      faded: fadeExceptId !== undefined && n.id !== fadeExceptId,
    },
    draggable: false,
  }));
  const fading = fadeExceptId !== undefined;
  const orderById = new Map(graph.nodes.map((n) => [n.id, n.order]));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    type: 'next',
    source: e.source,
    target: e.target,
    sourceHandle: 'r',
    targetHandle: 'l',
    // `faded` dissolves the beams with the siblings on drill-in. `index` is the
    // target star's chain order, so the intro can draw each beam in step with
    // the star it points at (the edge layer can't inherit the node's --i).
    data: { faded: fading, index: orderById.get(e.target) ?? 0 },
  }));
  return { nodes, edges };
}

/** Build one company's galaxy: focused star, the candidate cluster, and (M3)
 *  the swimlane band of traced colleagues below it.
 *
 * Everything is positioned RELATIVE TO THE COMPANY'S ATLAS COORDINATES (`base`),
 * not a fresh origin, so the focused star occupies the exact same world point in
 * the galaxy as it did in the chain. That is what makes the drill-in a smooth
 * fly-in rather than a teleport: the camera moves, the star does not.
 *
 * People split by trace status (m3-plan §3, §6): 'raw'/'dismissed' stay in the
 * candidate cluster (re-indexed so a pulled-out orb's gap closes); 'expanded'
 * become lane faces in the band, each with its onward leaves on the time axis.
 * `now` is injected (the layout stays pure); `expandingIds` marks orbs mid-trace
 * so they show a spinner in place. */
export function buildGalaxy(
  focus: GraphNode,
  people: PersonNodeModel[],
  colors: Record<string, string>,
  now: DateParts,
  expandingIds: Set<string> = new Set(),
  onwardColors: Record<string, string> = {},
): { nodes: Node[]; edges: Edge[] } {
  const base = layout(focus.order);
  const focusRel = layoutGalaxyFocus();
  const focusNode: Node<CompanyNodeData> = {
    id: focus.id,
    type: 'company',
    position: { x: base.x + focusRel.x, y: base.y + focusRel.y },
    data: {
      name: focus.name,
      logoDataUrl: focus.logoDataUrl,
      tenure: tenureOf(focus),
      color: colors[focus.id],
      index: 0,
      focus: true,
    },
    draggable: false,
  };
  // Orbs are centered on the row (rel.x is the orb-center offset); convert to
  // the node's top-left, accounting for the narrow person node.
  const rowCenterX = base.x + NODE_WIDTH / 2;

  // Candidates (still in the cluster) vs traced colleagues (in the band). Lanes
  // stack in trace (click) order via expandedAt, not the original cluster order.
  const cluster = people.filter((p) => p.status !== 'expanded');
  const expanded = people
    .filter((p) => p.status === 'expanded')
    .sort((a, b) => (a.expandedAt ?? 0) - (b.expandedAt ?? 0));

  // Re-index the cluster among its own members (not p.order), so pulling one orb
  // out into a lane closes the gap and the rest re-center.
  const personNodes: Node<PersonNodeData>[] = cluster.map((p, i) => {
    const rel = layoutGalaxyPerson(i, cluster.length);
    return {
      id: p.id,
      type: 'person',
      position: {
        x: rowCenterX + rel.x - PERSON_NODE_WIDTH / 2,
        y: base.y + rel.y,
      },
      data: {
        name: p.name,
        photoDataUrl: p.photoDataUrl,
        index: i,
        status: p.status,
        expanding: expandingIds.has(p.id),
        companyName: focus.name,
      },
      draggable: false,
    };
  });

  // The swimlane band: one lane per expanded colleague (face + onward leaves),
  // lane beams in date order, and convergence threads where ≥2 lanes share a
  // destination (m3-plan §6).
  const sw = layoutSwimlanes(focus, expanded, now);
  const laneNodes: Node[] = [];
  const laneEdges: Edge[] = [];
  const leafId = (laneIndex: number, leafIndex: number) =>
    `${sw.lanes[laneIndex].person.id}::onward::${leafIndex}`;
  // The shared "today" line: the right edge of the fixed time axis. A current
  // job (end = Present) draws a beam from its leaf out to this line, so everyone
  // still employed reaches the same place (m3 present-tail).
  const nowWorldX = rowCenterX + AXIS_LEFT + AXIS_WIDTH;
  let anyPresent = false;

  sw.lanes.forEach((lane) => {
    const faceId = lane.person.id;
    laneNodes.push({
      id: faceId,
      type: 'person',
      position: {
        x: rowCenterX + lane.faceX - PERSON_NODE_WIDTH / 2,
        y: base.y + lane.faceY,
      },
      data: {
        name: lane.person.name,
        photoDataUrl: lane.person.photoDataUrl,
        index: lane.laneIndex,
        status: 'expanded',
        companyName: focus.name,
        // No onward leaves = a terminal colleague (still here / nothing after).
        terminal: lane.leaves.length === 0,
      } as PersonNodeData,
      draggable: false,
    });

    let prevId = faceId;
    // A segment is coloured by the company they were AT during it (its source),
    // not where it points: you aren't at the next company until you arrive. The
    // first beam leaves the focus company, so it carries the focus colour.
    let prevColor = colors[focus.id];
    lane.leaves.forEach((leaf, li) => {
      const id = leafId(lane.laneIndex, li);
      const leafColor = onwardColors[leaf.accentKey];
      laneNodes.push({
        id,
        type: 'onward',
        position: {
          x: rowCenterX + leaf.x - ONWARD_NODE_WIDTH / 2,
          y: base.y + leaf.y,
        },
        data: {
          name: leaf.stint.companyName,
          logoDataUrl: leaf.stint.logoDataUrl,
          index: li,
          convergent: leaf.convergent,
          year: String(leaf.stint.start.year),
          color: leafColor, // the orb's own corona = its company colour
          roles: leaf.stint.roles,
        } as OnwardNodeData,
        draggable: false,
        // Selectable so React Flow keeps pointer-events on the node (needed for
        // the hover title); it has no click handler, so it's still inert.
        selectable: true,
      });
      // Beam INTO this leaf is the SOURCE company's colour (where they were
      // before arriving), so the hue only turns to this company after it.
      laneEdges.push({
        id: `beam-${id}`,
        type: 'next',
        source: prevId,
        target: id,
        sourceHandle: 'r',
        targetHandle: 'l',
        data: { index: li, color: prevColor },
      });

      // Current job (Present): extend a dashed "ongoing" beam from this leaf to
      // the shared now-line, in THIS company's colour (they are here now), so
      // "still there" reads as the line reaching today.
      if (leaf.stint.end === null) {
        anyPresent = true;
        const anchorId = `${faceId}::now::${li}`;
        laneNodes.push({
          id: anchorId,
          type: 'nowAnchor',
          position: { x: nowWorldX, y: base.y + leaf.y + ONWARD_NODE_WIDTH / 2 },
          data: {},
          draggable: false,
          selectable: false,
        });
        laneEdges.push({
          id: `present-${id}`,
          type: 'next',
          source: id,
          target: anchorId,
          sourceHandle: 'r',
          targetHandle: 'l',
          data: { index: li, color: leafColor, present: true },
        });
      }
      prevId = id;
      prevColor = leafColor;
    });
  });

  // The shared "now" line: a faint vertical marker at today (the axis right
  // edge), spanning the lanes, that the present-tails reach. Drawn only when at
  // least one colleague is currently employed somewhere onward.
  if (anyPresent) {
    const NOW_PAD = 46;
    laneNodes.push({
      id: `now-${focus.id}`,
      type: 'nowLine',
      position: { x: nowWorldX, y: base.y + BAND_TOP - NOW_PAD },
      data: { height: sw.bottomY - BAND_TOP + NOW_PAD * 2 },
      draggable: false,
      selectable: false,
    });
  }

  // Convergence threads: link the same company across lanes (top of upper leaf's
  // lane down to the lower), consecutive by lane order for ≥3-way groups.
  sw.convergences.forEach((group) => {
    const members = [...group.members].sort((a, b) => a.laneIndex - b.laneIndex);
    for (let k = 0; k < members.length - 1; k++) {
      const a = members[k];
      const b = members[k + 1];
      laneEdges.push({
        id: `conv-${group.key}-${k}`,
        type: 'convergence',
        source: leafId(a.laneIndex, a.leafIndex),
        target: leafId(b.laneIndex, b.leafIndex),
        sourceHandle: 'b',
        targetHandle: 't',
      });
    }
  });

  // An invisible bounds-extender below the lowest content (the last lane when
  // there are lanes, else the M2 reserve). Keeps fitView framing the whole
  // composition; reframes as the band grows.
  const reserveY = expanded.length
    ? base.y + sw.bottomY + LANE_GAP
    : base.y + GALAXY_DROP + GALAXY_RESERVE_BELOW;
  const reserveNode: Node = {
    id: `reserve-${focus.id}`,
    type: 'spacer',
    position: { x: rowCenterX, y: reserveY },
    data: {},
    draggable: false,
    selectable: false,
  };

  // No people at all yet (loading): just the star + the bounds reserve.
  if (people.length === 0) {
    return { nodes: [focusNode, reserveNode], edges: [] };
  }

  // The title sits between the star and the row. Its origin is the row center;
  // the node centers itself there via CSS (translateX(-50%)), so it can size to
  // its (one-line) text without us knowing the width here.
  const titleNode: Node<{ companyName?: string }> = {
    id: `title-${focus.id}`,
    type: 'galaxyTitle',
    position: { x: rowCenterX, y: base.y + GALAXY_TITLE_DROP },
    data: { companyName: focus.name },
    draggable: false,
    selectable: false,
  };

  return {
    nodes: [focusNode, titleNode, reserveNode, ...personNodes, ...laneNodes],
    edges: laneEdges,
  };
}
