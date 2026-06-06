import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Controls,
  getStraightPath,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { formatTenure } from '../format';
import { layout } from '../graph';
import type { CareerGraph as CareerGraphModel, GraphNode } from '../types';
import { CompanyLogo } from './components';

// Fixed node dimensions: React Flow's fitView needs stable measurements to
// frame the chain correctly (m1-plan §11). Keep in sync with .career-node CSS.
const ORB = 84; // diameter of the company "star"
const LOGO = 80; // the logo nearly fills the orb; only a thin rim frames it
const NODE_WIDTH = 150;
const NODE_HEIGHT = 138; // orb + label stack
const ORB_INSET = (NODE_WIDTH - ORB) / 2; // align edge handles to the orb rim
// Edges attach at the orb's vertical center and horizontal rim, so the chain
// runs star-to-star rather than from the (taller) node bounding box.
const handleStyle = { top: ORB / 2 } as const;

/** The React Flow data payload carried by each company node. */
type CompanyNodeData = {
  name: string;
  logoDataUrl?: string;
  tenure: string;
  color?: string; // dominant logo colour, for the corona treatment
  index: number; // chain order, for staggering float/glint animations
};

/**
 * Custom Level-0 company node (§7): a round company "star" (the logo as a real
 * coin) with the company name below and tenure demoted to a faint line. Dormant
 * — no click handler in M1; M2 wires expansion onto this same node, so no fake
 * affordance here.
 *
 * The CSS vars `--star-color` / `--i` and the `.career-star__fx` element feed
 * the prototype depth treatments (see PrototypeSwitcher + styles.css).
 */
function CompanyNode({ data }: NodeProps<Node<CompanyNodeData>>) {
  const style = {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    '--star-color': data.color ?? 'rgba(140, 158, 235, 0.9)',
    '--i': data.index,
  } as CSSProperties;
  return (
    <div className="career-node" style={style}>
      {/* Handles carry the chain edges; hidden, since nodes aren't connectable. */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{ ...handleStyle, left: ORB_INSET }}
      />
      {/* Only the visible star + label scale during the intro; the handles stay
          outside this wrapper so React Flow measures their (unscaled) positions
          correctly and the beams stay centered on the orb. */}
      <div className="career-node__pop">
        <div className="career-star" style={{ width: ORB, height: ORB }}>
          <CompanyLogo dataUrl={data.logoDataUrl} name={data.name} size={LOGO} />
        </div>
        <div className="career-node__label">
          <span className="career-node__name" title={data.name}>
            {data.name}
          </span>
          <span className="career-node__tenure">{data.tenure}</span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ ...handleStyle, right: ORB_INSET }}
      />
    </div>
  );
}

const nodeTypes = { company: CompanyNode };

/**
 * A line of light between two stars. Direction (career order) is implied by a
 * gradient that brightens toward the target — the more recent company — rather
 * than a hard arrowhead, with a soft blurred underlay for the glow.
 */
function ConstellationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const gradientId = `beam-${id}`;
  // `--i` is the target node's chain order, so the beam fades in as its target
  // star ignites during the intro (see the `data-intro` rules in styles.css).
  const beamStyle = { '--i': (data?.index as number) ?? 0 } as CSSProperties;
  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor="rgba(168, 182, 235, 0.12)" />
          <stop offset="100%" stopColor="rgba(180, 196, 255, 0.75)" />
        </linearGradient>
      </defs>
      <path
        className="career-beam"
        d={path}
        fill="none"
        stroke="rgba(124, 140, 255, 0.35)"
        strokeWidth={4}
        strokeLinecap="round"
        style={{ ...beamStyle, filter: 'blur(3px)' }}
      />
      <path
        className="career-beam"
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={1.5}
        strokeLinecap="round"
        style={beamStyle}
      />
    </>
  );
}

const edgeTypes = { next: ConstellationEdge };

/** Tenure string for a graph node (reuses M0's formatTenure shape). */
function tenureOf(n: GraphNode): string {
  return formatTenure({
    start: n.start,
    end: n.end,
    rawDateText: n.rawDateText,
    // formatTenure only reads start/end; the rest are unused but typed.
    companyName: n.name,
    roles: [],
  });
}

/** Sample a logo's dominant (brand) colour, biased toward saturated pixels and
 *  ignoring white/black/grey, so the corona glows the company's own hue. */
function sampleDominantColor(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 20;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // transparent
          const cr = data[i];
          const cg = data[i + 1];
          const cb = data[i + 2];
          const max = Math.max(cr, cg, cb);
          const min = Math.min(cr, cg, cb);
          if (max > 240 && min > 240) continue; // near-white
          if (max < 24) continue; // near-black
          const weight = 1 + (max - min) / 48; // favour saturated pixels
          r += cr * weight;
          g += cg * weight;
          b += cb * weight;
          total += weight;
        }
        if (total < 1) return resolve(null);
        resolve(`rgb(${Math.round(r / total)}, ${Math.round(g / total)}, ${Math.round(b / total)})`);
      } catch {
        resolve(null); // tainted canvas etc.
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Map of node id → dominant logo colour, sampled once per graph. */
function useLogoColors(nodes: GraphNode[]): Record<string, string> {
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      nodes.map(async (n) => {
        const c = n.logoDataUrl ? await sampleDominantColor(n.logoDataUrl) : null;
        return [n.id, c] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, c] of entries) if (c) next[id] = c;
      setColors(next);
    });
    return () => {
      cancelled = true;
    };
  }, [nodes]);
  return colors;
}

/**
 * Renders the materialized graph as a left-to-right career chain (§7).
 * Positions are computed from `order` via layout(), never read from the store.
 */
export function CareerGraph({
  graph,
  animateIntro = false,
}: {
  graph: CareerGraphModel;
  animateIntro?: boolean;
}) {
  const colors = useLogoColors(graph.nodes);

  // Chain order keyed by node id, so each edge can carry its target's order
  // and the beam fades in as that star ignites during the intro.
  const orderById = useMemo(
    () => Object.fromEntries(graph.nodes.map((n) => [n.id, n.order])),
    [graph.nodes],
  );

  const nodes = useMemo<Node<CompanyNodeData>[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'company',
        position: layout(n.order),
        data: {
          name: n.name,
          logoDataUrl: n.logoDataUrl,
          tenure: tenureOf(n),
          color: colors[n.id],
          index: n.order,
        },
        draggable: false,
      })),
    [graph.nodes, colors],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        type: 'next',
        source: e.source,
        target: e.target,
        data: { index: orderById[e.target] ?? 0 },
      })),
    [graph.edges, orderById],
  );

  return (
    <div className="career-graph" data-intro={animateIntro ? '' : undefined}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        {/* No React Flow Background: its uniform dot grid reads as graph paper.
            The irregular Cosmos star field behind the canvas carries the void. */}
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
