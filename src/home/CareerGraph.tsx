import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CareerGraph as CareerGraphModel, DateParts } from '../types';
import { Spinner } from './components';
import { onwardAccentKey } from '../graph';
import { nodeTypes } from './flow/nodes';
import { edgeTypes } from './flow/edges';
import { useLogoColors, useSampledColors } from './flow/colors';
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
  onPersonClick,
  expandingIds,
  onBack,
  animateIntro,
}: {
  graph: CareerGraphModel;
  view: GraphView;
  onCompanyClick: (companyId: string) => void;
  onPersonClick: (personId: string) => void;
  expandingIds: Set<string>;
  onBack: () => void;
  animateIntro: boolean;
}) {
  const rf = useReactFlow();
  const colors = useLogoColors(graph.nodes);
  // Current month, injected into the pure swimlane layout (which never reads the
  // clock itself). Computed once per mount.
  const now = useMemo<DateParts>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, []);

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

  // The ignition is a one-shot reward for seeding. Once the user leaves the
  // atlas (drills into a galaxy), it must not replay on the way back: latch it
  // off the moment we leave. A re-seed remounts this component (keyed by the
  // seed timestamp in App), which resets the latch so the next seed replays it.
  const introSpent = useRef(false);

  const viewKey = view.mode === 'galaxy' ? view.companyId : 'atlas';
  useEffect(() => {
    if (view.mode === 'galaxy' && phase.k === 'atlas') {
      introSpent.current = true;
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

  // Dominant brand colour per onward destination (keyed by convergence key, so
  // the same company is one colour across lanes). Sampled from the leaf logos,
  // reusing the atlas corona sampler. Feeds each lane beam + leaf its hue.
  const onwardItems = useMemo(() => {
    if (phase.k !== 'galaxy') return [] as { key: string; dataUrl?: string }[];
    const people = graph.expansions?.[phase.id]?.people ?? [];
    const seen = new Map<string, string | undefined>();
    for (const p of people) {
      if (p.status !== 'expanded' || !p.onward) continue;
      for (const s of p.onward) {
        const key = onwardAccentKey(s);
        if (!seen.has(key)) seen.set(key, s.logoDataUrl);
      }
    }
    return Array.from(seen, ([key, dataUrl]) => ({ key, dataUrl }));
  }, [phase, graph]);
  const onwardColors = useSampledColors(onwardItems);

  const atlasNormal = useMemo(() => buildAtlas(graph, colors), [graph, colors]);
  const scene = useMemo(() => {
    if (phase.k === 'entering') return buildAtlas(graph, colors, phase.id);
    if (phase.k === 'galaxy') {
      const focus = graph.nodes.find((n) => n.id === phase.id);
      const people = graph.expansions?.[phase.id]?.people ?? [];
      return focus
        ? buildGalaxy(focus, people, colors, now, expandingIds, onwardColors)
        : atlasNormal;
    }
    return atlasNormal;
  }, [phase, graph, colors, atlasNormal, now, expandingIds, onwardColors]);

  const inGalaxy = phase.k === 'galaxy';
  const peopleCount =
    phase.k === 'galaxy'
      ? graph.expansions?.[phase.id]?.people?.length ?? 0
      : 0;
  // Lanes grow the band; reframe when a colleague is traced (the people array is
  // patched in place, so the total count alone wouldn't change).
  const laneCount =
    phase.k === 'galaxy'
      ? graph.expansions?.[phase.id]?.people?.filter((p) => p.status === 'expanded')
          .length ?? 0
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
  }, [phase, peopleCount, laneCount, rf]);

  return (
    <div
      className="career-graph"
      data-mode={inGalaxy ? 'galaxy' : 'atlas'}
      data-intro={
        animateIntro && phase.k === 'atlas' && !introSpent.current
          ? ''
          : undefined
      }
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
          } else if (phase.k === 'galaxy' && node.type === 'person') {
            // Trace this colleague (App no-ops if already expanded; a dismissed
            // orb retries). Onward leaves are type 'onward' → not clickable.
            onPersonClick(node.id);
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
      {/* "Show more people" now lives in the canvas as the next star in the row
          (see flow/nodes LoadMoreNode), not a pill pinned to the window. */}
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
  onPersonClick,
  expandingIds,
  onBack,
  animateIntro = false,
}: {
  graph: CareerGraphModel;
  view: GraphView;
  onCompanyClick: (companyId: string) => void;
  onPersonClick: (personId: string) => void;
  expandingIds: Set<string>;
  onBack: () => void;
  animateIntro?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Flow
        graph={graph}
        view={view}
        onCompanyClick={onCompanyClick}
        onPersonClick={onPersonClick}
        expandingIds={expandingIds}
        onBack={onBack}
        animateIntro={animateIntro}
      />
    </ReactFlowProvider>
  );
}
