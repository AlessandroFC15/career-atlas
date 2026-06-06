import type { Edge, Node } from '@xyflow/react';
import { formatTenure } from '../../format';
import {
  GALAXY_DROP,
  GALAXY_RESERVE_BELOW,
  GALAXY_TITLE_DROP,
  layout,
  layoutGalaxyFocus,
  layoutGalaxyPerson,
} from '../../graph';
import type {
  CareerGraph as CareerGraphModel,
  GraphNode,
  PersonNode as PersonNodeModel,
} from '../../types';
import { NODE_WIDTH, PERSON_NODE_WIDTH } from './dimensions';
import type { CompanyNodeData, PersonNodeData } from './nodes';

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

/** Build one company's galaxy: focused star + its people row.
 *
 * Everything is positioned RELATIVE TO THE COMPANY'S ATLAS COORDINATES (`base`),
 * not a fresh origin, so the focused star occupies the exact same world point in
 * the galaxy as it did in the chain. That is what makes the drill-in a smooth
 * fly-in rather than a teleport: the camera moves, the star does not. */
export function buildGalaxy(
  focus: GraphNode,
  people: PersonNodeModel[],
  colors: Record<string, string>,
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
  const personNodes: Node<PersonNodeData>[] = people.map((p) => {
    const rel = layoutGalaxyPerson(p.order, people.length);
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
        index: p.order,
      },
      draggable: false,
    };
  });
  // An invisible node well below the row, ALWAYS present (loading and ready), so
  // the galaxy's vertical bounds are identical the whole time. That keeps the
  // framing constant: the drill-in flies straight to the final position in one
  // move, and people fade in afterwards without the camera shifting. It also
  // reserves room below the row for M4 trajectories.
  const reserveNode: Node = {
    id: `reserve-${focus.id}`,
    type: 'spacer',
    position: { x: rowCenterX, y: base.y + GALAXY_DROP + GALAXY_RESERVE_BELOW },
    data: {},
    draggable: false,
    selectable: false,
  };

  // No people yet (loading): just the star + the bounds reserve.
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

  // No edges in a galaxy: people are an unconnected cluster below the star.
  return {
    nodes: [focusNode, titleNode, reserveNode, ...personNodes],
    edges: [],
  };
}
