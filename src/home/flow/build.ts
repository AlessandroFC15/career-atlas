import type { Edge, Node } from '@xyflow/react';
import { formatTenure } from '../../format';
import {
  AXIS_LEFT,
  AXIS_WIDTH,
  GALAXY_RESERVE_BELOW,
  GALAXY_TITLE_DROP,
  LANE_GAP,
  galaxyGeometry,
  layout,
  layoutCluster,
  layoutGalaxyFocus,
  layoutSwimlanes,
} from '../../graph';
import type {
  CareerGraph as CareerGraphModel,
  DateParts,
  GraphNode,
  PersonNode as PersonNodeModel,
} from '../../types';
import {
  NODE_WIDTH,
  ONWARD_NODE_WIDTH,
  ONWARD_ORB,
  PERSON_NODE_WIDTH,
  PERSON_ORB,
  ROLE_BEAD_MAX,
  ROLE_BEAD_MIN,
  ROLE_BEAD_STEP,
} from './dimensions';
import type {
  CompanyNodeData,
  LoadMoreData,
  OngoingNodeData,
  OnwardNodeData,
  PersonNodeData,
  RoleBeadData,
} from './nodes';

/** A company's full LinkedIn URL from its (possibly relative) stored link, so
 *  the focus orb can offer an "open on LinkedIn" badge. */
function linkedInUrl(companyUrl?: string): string | undefined {
  if (!companyUrl) return undefined;
  if (/^https?:\/\//i.test(companyUrl)) return companyUrl;
  return 'https://www.linkedin.com' + (companyUrl.startsWith('/') ? '' : '/') + companyUrl;
}

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
    // target orb's chain order, so the intro can draw each beam in step with
    // the orb it points at (the edge layer can't inherit the node's --i).
    data: { faded: fading, index: orderById.get(e.target) ?? 0 },
  }));
  return { nodes, edges };
}

/** Build one company's galaxy: focused orb, the candidate cluster, and (M3)
 *  the swimlane band of traced colleagues below it.
 *
 * Everything is positioned RELATIVE TO THE COMPANY'S ATLAS COORDINATES (`base`),
 * not a fresh origin, so the focused orb occupies the exact same world point in
 * the galaxy as it did in the chain. That is what makes the drill-in a smooth
 * fly-in rather than a teleport: the camera moves, the orb does not.
 *
 * People split by trace status (m3-plan §3, §6): 'raw'/'dismissed' stay in the
 * candidate cluster (re-indexed so a pulled-out orb's gap closes); 'traced'
 * become lane faces in the band, each with its onward leaves on the time axis.
 * `now` is injected (the layout stays pure); everything App knows and the graph
 * does not — what is mid-flight, what just arrived — rides in `view`. */
export interface GalaxyView {
  /** Orbs with a trace in flight: they show a spinner in place. */
  tracingIds: Set<string>;
  /** Dominant brand colour per onward destination, keyed by convergence key. */
  onwardColors: Record<string, string>;
  /** The people search is spent: the "more" orb settles into its terminator. */
  exhausted: boolean;
  /** A page of people is in flight right now. */
  loading: boolean;
  /** Arrived on the last page: they reveal as a batch, without the entry gate. */
  fresh: Set<string>;
}

export function buildGalaxy(
  focus: GraphNode,
  people: PersonNodeModel[],
  colors: Record<string, string>,
  now: DateParts,
  view: GalaxyView,
): { nodes: Node[]; edges: Edge[] } {
  const { tracingIds, onwardColors } = view;
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

  // Candidates (still in the cluster) vs traced colleagues (in the band). Newest
  // trace on top: sort by tracedAt DESCENDING, so a fresh lane appears just
  // under the cluster and pushes the earlier ones down.
  const cluster = people.filter((p) => p.status !== 'traced');
  const traced = people
    .filter((p) => p.status === 'traced')
    .sort((a, b) => (b.tracedAt ?? 0) - (a.tracedAt ?? 0));

  // The "show more" orb trails the last face on its row, so it counts as a slot
  // when centering that row: faces + orb are centered together, otherwise the
  // row leans left as the orb tacks on past the centered faces.
  //
  // It loads MORE colleagues, which has nothing to do with how many of the
  // current batch you have clicked: so it stays as long as this galaxy has any
  // people at all, even once every candidate has been traced into a lane (the
  // cluster is then empty but more may still be out there). It only disappears
  // for a truly empty galaxy (no colleagues to page past).
  //
  // Once the search is exhausted the orb does NOT vanish: it stays in its slot
  // as a spent, unclickable terminator ("all here"), so the row ends with an
  // answer to "is that everyone?" rather than a silent stop. Keeping the slot
  // also means exhaustion doesn't re-center the row under the user's cursor.
  const hasMore = people.length > 0;

  // The cluster wraps every GALAXY_ROW_MAX FACES (see layoutCluster), so paging
  // in more people grows it downward rather than stretching one row off both
  // edges of the screen. `galaxyGeometry` owns where that leaves everything
  // below it. The "more" orb rides the last row's trailing slot, so it never
  // adds a row of its own.
  const slots = layoutCluster(cluster.length, hasMore);
  const geo = galaxyGeometry(cluster.length);

  // Re-index the cluster among its own members (not p.order), so pulling one orb
  // out into a lane closes the gap and the rest re-center.
  // A freshly paged-in orb waves in among ITS OWN batch (0, 1, 2, …), not from
  // its grid slot, so the batch sweeps cleanly even when it starts mid-row and
  // the wave's length tracks the page size, not the cluster size.
  const freshOrder = new Map(
    cluster.filter((p) => view.fresh.has(p.id)).map((p, n) => [p.id, n] as const),
  );
  const personNodes: Node<PersonNodeData>[] = cluster.map((p, i) => {
    const rel = slots[i];
    return {
      id: p.id,
      type: 'person',
      position: {
        x: rowCenterX + rel.x - PERSON_NODE_WIDTH / 2,
        y: base.y + rel.y,
      },
      // Explicit dimensions so React Flow renders the orb visible at once instead
      // of hiding it until a ResizeObserver measures it: those measurements fire
      // per-node in no set order, which shreds the left-to-right --i stagger (each
      // orb reveals whenever its own measure lands). The node is just the orb (the
      // name chip floats absolutely on hover), so PERSON_ORB is its real size.
      width: PERSON_NODE_WIDTH,
      height: PERSON_ORB,
      data: {
        name: p.name,
        photoDataUrl: p.photoDataUrl,
        // Reveal index: a diagonal wave across the grid (col + row), not the
        // raw slot. On a single row that is just the slot, as before; wrapped,
        // it keeps the whole cascade inside about a second instead of letting
        // 30 orbs stagger for three and a half.
        index: freshOrder.get(p.id) ?? rel.col + rel.row,
        fresh: freshOrder.has(p.id),
        status: p.status,
        tracing: tracingIds.has(p.id),
        companyName: focus.name,
      },
      draggable: false,
    };
  });

  // The "show more people" orb: the next orb in the row, in the slot right after
  // the last face (centered together with the faces, so the row stays balanced as
  // candidates are traced out). Placed here, not as a screen-pinned pill, so
  // "more" reads right where the cluster ends. When the cluster is empty (every
  // candidate traced into a lane), the orb sits alone in the row's single slot,
  // still offering to page in more colleagues. Its loading and spent states are
  // owned by App (like tracingIds), so a failed page has somewhere to surface.
  // layoutCluster only emits the trailing slot when asked for it, so this is
  // present exactly when the orb is.
  const moreSlot = hasMore ? slots[cluster.length] : undefined;
  const moreNodes: Node<LoadMoreData>[] = !moreSlot
    ? []
    : [
        {
          id: `more-${focus.id}`,
          type: 'loadMore',
          position: {
            x: rowCenterX + moreSlot.x - PERSON_NODE_WIDTH / 2,
            y: base.y + moreSlot.y,
          },
          // Same fixed size as the faces so it reveals in step with the row,
          // not whenever its own measurement lands (see person nodes above).
          width: PERSON_NODE_WIDTH,
          height: PERSON_ORB,
          data: {
            // Its own grid cell, trailing the last face, so its reveal staggers
            // in as the LAST orb of the wave rather than ahead of the faces.
            index: moreSlot.col + moreSlot.row,
            loading: view.loading,
            exhausted: view.exhausted,
          },
          draggable: false,
          // Selectable keeps pointer-events on for the orb's own click/hover.
          selectable: true,
        },
      ];

  // The swimlane band: one lane per traced colleague (face + onward leaves),
  // lane beams in date order, and convergence threads where ≥2 lanes share a
  // destination (m3-plan §6).
  const sw = layoutSwimlanes(focus, traced, now, geo.bandTop);
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
        status: 'traced',
        companyName: focus.name,
        // The face is a link to the colleague's profile (the orb's click is
        // otherwise dead once traced).
        profileUrl: lane.person.profileUrl,
      } as PersonNodeData,
      draggable: false,
    });

    // No onward leaves = still at the focus company: a visible orb of its
    // own on the now-line (not just a caption), so the lane still reads as
    // reaching today like every other one. Earlier roles[] thread as beads on
    // the beam leading to it, so a promotion in place reads as a path with
    // stops rather than one flat line.
    if (lane.leaves.length === 0) {
      anyPresent = true;
      const focusColor = colors[focus.id];
      const ongoingId = `${faceId}::ongoing`;

      // The exact points the beam itself runs between (face's right handle,
      // ongoing orb's left handle), so beads land ON the line, not near it.
      const faceHandleX = rowCenterX + lane.faceX + PERSON_NODE_WIDTH / 2;
      const faceHandleY = base.y + lane.faceY + PERSON_ORB / 2;
      const ongoingHandleX = nowWorldX - ONWARD_ORB / 2;
      const ongoingHandleY = base.y + lane.faceY + ONWARD_ORB / 2;

      // `currentRoles` is sorted ascending by start (oldest first). The last
      // one is their current title (the orb's own always-on label), and the
      // first is just their original hire (no promotion into it, so no
      // marker — the face already stands for "joined"). Anything strictly
      // between those two is an intermediate promotion, one bead each, in
      // the chronological order they need (oldest nearest the face).
      const roles = lane.person.currentRoles ?? [];
      const current = roles.at(-1);
      const priorRoles = roles.slice(1, -1);
      priorRoles.forEach((role, i) => {
        const t = (i + 1) / (priorRoles.length + 1);
        // Grows step to step (oldest title smallest), so climbing the beam
        // toward the current title reads as levelling up, not just a list.
        const size = Math.min(ROLE_BEAD_MIN + i * ROLE_BEAD_STEP, ROLE_BEAD_MAX);
        laneNodes.push({
          id: `${faceId}::role::${i}`,
          type: 'roleBead',
          position: {
            x: faceHandleX + (ongoingHandleX - faceHandleX) * t - size / 2,
            y: faceHandleY + (ongoingHandleY - faceHandleY) * t - size / 2,
          },
          width: size,
          height: size,
          data: {
            title: role.title,
            year: String(role.start.year),
            color: focusColor,
          } as RoleBeadData,
          draggable: false,
          selectable: true,
        });
      });

      laneNodes.push({
        id: ongoingId,
        type: 'ongoing',
        position: {
          x: nowWorldX - ONWARD_NODE_WIDTH / 2,
          y: base.y + lane.faceY,
        },
        data: {
          name: focus.name,
          logoDataUrl: focus.logoDataUrl,
          color: focusColor,
          currentTitle: current?.title,
          currentYear: current && String(current.start.year),
        } as OngoingNodeData,
        draggable: false,
        selectable: true,
      });
      laneEdges.push({
        id: `ongoing-${faceId}`,
        type: 'next',
        source: faceId,
        target: ongoingId,
        sourceHandle: 'r',
        targetHandle: 'l',
        data: { index: 0, color: focusColor, present: true },
      });
    }

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
          companyUrl: linkedInUrl(leaf.stint.companyUrl),
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

      // Extend a dashed "ongoing" beam from this leaf to the shared now-line, in
      // THIS company's colour, so it reads as the line reaching today.
      if (leaf.reachesNow) {
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
      position: { x: nowWorldX, y: base.y + geo.bandTop - NOW_PAD },
      data: { height: sw.bottomY - geo.bandTop + NOW_PAD * 2 },
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
  const reserveY = traced.length
    ? base.y + sw.bottomY + LANE_GAP
    : base.y + geo.clusterBottom + GALAXY_RESERVE_BELOW;
  const reserveNode: Node = {
    id: `reserve-${focus.id}`,
    type: 'spacer',
    position: { x: rowCenterX, y: reserveY },
    data: {},
    draggable: false,
    selectable: false,
  };

  // No people at all yet (loading): just the orb + the bounds reserve.
  if (people.length === 0) {
    return { nodes: [focusNode, reserveNode], edges: [] };
  }

  // The title sits between the orb and the row. Its origin is the row center;
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
    nodes: [
      focusNode,
      titleNode,
      reserveNode,
      ...personNodes,
      ...moreNodes,
      ...laneNodes,
    ],
    edges: laneEdges,
  };
}
