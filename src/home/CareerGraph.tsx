import { useEffect, useMemo, useState } from 'react';
import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CareerGraph as CareerGraphModel } from '../types';
import { Spinner } from './components';
import { nodeTypes } from './flow/nodes';
import { edgeTypes } from './flow/edges';
import { useLogoColors } from './flow/colors';
import { buildAtlas, buildGalaxy } from './flow/build';

/** The view the graph renders: the atlas chain, or one company's galaxy. */
export type GraphView =
  | { mode: 'atlas' }
  | {
      mode: 'galaxy';
      companyId: string;
      status: 'loading' | 'ready' | 'empty' | 'error';
      message?: string;
    };

/**
 * The inner flow: owns the React Flow instance (via useReactFlow, hence the
 * ReactFlowProvider wrapper below) so it can fly the camera into a star on
 * drill-in and reframe on the way back (m2-plan §7).
 */
function Flow({
  graph,
  view,
  onCompanyClick,
  onBack,
  animateIntro,
}: {
  graph: CareerGraphModel;
  view: GraphView;
  onCompanyClick: (companyId: string) => void;
  onBack: () => void;
  animateIntro: boolean;
}) {
  const rf = useReactFlow();
  const colors = useLogoColors(graph.nodes);

  // The drill-in has three phases so the siblings can fade before the swap:
  //   atlas    → the chain.
  //   entering → still the chain, but the non-focused stars fading to 0 while
  //              the camera begins flying into the focused star.
  //   galaxy   → the focused star + its people.
  // The galaxy is built on the focused company's atlas coordinates (build.ts),
  // so the star never moves across these phases; only the camera flies.
  type Phase =
    | { k: 'atlas' }
    | { k: 'entering'; id: string }
    | { k: 'galaxy'; id: string };
  const [phase, setPhase] = useState<Phase>(
    view.mode === 'galaxy'
      ? { k: 'galaxy', id: view.companyId }
      : { k: 'atlas' },
  );

  const viewKey = view.mode === 'galaxy' ? view.companyId : 'atlas';
  useEffect(() => {
    if (view.mode === 'galaxy' && phase.k === 'atlas') {
      setPhase({ k: 'entering', id: view.companyId });
      const t = setTimeout(
        () => setPhase({ k: 'galaxy', id: view.companyId }),
        240, // let the sibling fade (200ms CSS) finish before the swap
      );
      return () => clearTimeout(t);
    }
    if (view.mode === 'atlas' && phase.k !== 'atlas') {
      setPhase({ k: 'atlas' });
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.mode, viewKey]);

  const atlasNormal = useMemo(() => buildAtlas(graph, colors), [graph, colors]);
  const scene = useMemo(() => {
    if (phase.k === 'entering') return buildAtlas(graph, colors, phase.id);
    if (phase.k === 'galaxy') {
      const focus = graph.nodes.find((n) => n.id === phase.id);
      const people = graph.expansions?.[phase.id]?.people ?? [];
      return focus ? buildGalaxy(focus, people, colors) : atlasNormal;
    }
    return atlasNormal;
  }, [phase, graph, colors, atlasNormal]);

  const inGalaxy = phase.k === 'galaxy';
  const peopleCount =
    phase.k === 'galaxy'
      ? graph.expansions?.[phase.id]?.people?.length ?? 0
      : 0;

  // One continuous fitView per phase change (no teleport, since the focused star
  // keeps its atlas coordinates). The galaxy's bounds are constant from the
  // moment we enter it (the reserve spacer is always present, see build.ts), so
  // this flies straight to the final framing in a single move; people then fade
  // in without the camera shifting again. Entering still renders the (fading)
  // atlas, so fitView there just holds the chain framing until the swap.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (phase.k === 'galaxy') {
        rf.fitView({ duration: 700, padding: 0.22, maxZoom: 1.4 });
      } else {
        rf.fitView({ duration: 700, padding: 0.2 });
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, peopleCount, rf]);

  return (
    <div
      className="career-graph"
      data-mode={inGalaxy ? 'galaxy' : 'atlas'}
      data-intro={animateIntro && phase.k === 'atlas' ? '' : undefined}
    >
      <ReactFlow
        nodes={scene.nodes}
        edges={scene.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (phase.k === 'atlas' && node.type === 'company') {
            onCompanyClick(node.id);
          }
        }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>

      {inGalaxy && <GalaxyChrome view={view} onBack={onBack} />}
    </div>
  );
}

/** Back control plus the loading / empty / error overlays for a galaxy.
 *  (The title lives in the canvas as a node; see flow/nodes.tsx.) */
function GalaxyChrome({ view, onBack }: { view: GraphView; onBack: () => void }) {
  const status = view.mode === 'galaxy' ? view.status : 'ready';
  const message = view.mode === 'galaxy' ? view.message : undefined;
  return (
    <>
      <button className="galaxy-back" onClick={onBack}>
        ← Atlas
      </button>
      {status === 'loading' && (
        <div className="galaxy-overlay">
          <Spinner />
          <p className="muted">{message ?? 'Finding people you know…'}</p>
        </div>
      )}
      {status === 'ready' && (
        // Placeholder for paginated loading (M6). Disabled rather than a no-op,
        // so it is an honest "not yet" instead of a fake affordance.
        <button
          className="galaxy-loadmore"
          disabled
          title="Loading more connections comes in a later milestone"
        >
          Show more people
        </button>
      )}
      {status === 'empty' && (
        <div className="galaxy-overlay">
          <p className="muted">
            {message ?? 'No first-degree connections found here.'}
          </p>
        </div>
      )}
      {status === 'error' && (
        <div className="galaxy-overlay">
          <div className="error-card">
            <p className="error-card__title">Could not load people</p>
            <p className="muted">{message ?? 'Something went wrong.'}</p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Renders the materialized graph: the atlas career chain, or a drilled-in
 * company galaxy. Positions are computed from `order` via the layout helpers,
 * never read from the store. Wrapped in a ReactFlowProvider so Flow can drive
 * the viewport for the fly-in (the flow building blocks live in ./flow).
 */
export function CareerGraph({
  graph,
  view,
  onCompanyClick,
  onBack,
  animateIntro = false,
}: {
  graph: CareerGraphModel;
  view: GraphView;
  onCompanyClick: (companyId: string) => void;
  onBack: () => void;
  animateIntro?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Flow
        graph={graph}
        view={view}
        onCompanyClick={onCompanyClick}
        onBack={onBack}
        animateIntro={animateIntro}
      />
    </ReactFlowProvider>
  );
}
