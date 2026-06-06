import { useEffect, useState } from 'react';
import { loadGraph, loadSeed, saveGraph } from '../storage';
import { deriveGraph } from '../graph';
import {
  ExpandError,
  runExpandCompany,
  runSeed,
  SeedError,
} from '../orchestrator';
import type { CareerGraph as CareerGraphModel, Seed } from '../types';
import { Avatar, Spinner } from './components';
import { CareerGraph, type GraphView } from './CareerGraph';

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'seeding'; message: string }
  | { kind: 'seeded'; seed: Seed; graph: CareerGraphModel }
  | { kind: 'error'; code: string; message: string };

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  // True only after a fresh seed/re-seed (handleSeed), so the staggered star
  // ignition plays as a reward for that action. The load-on-mount path leaves
  // this false, so reopening an existing graph renders instantly.
  const [animateIntro, setAnimateIntro] = useState(false);
  // Navigation within the seeded view: the atlas chain, or a drilled-in galaxy
  // (m2-plan §3). Transient: never persisted, always starts at the atlas.
  const [nav, setNav] = useState<GraphView>({ mode: 'atlas' });

  // Read-on-mount: render the materialized graph from the store, never by
  // re-reading LinkedIn (m1-plan §9). An M0-era seed (no graph, or a stale one)
  // migrates silently here: derive once, persist, then render.
  useEffect(() => {
    Promise.all([loadSeed(), loadGraph()]).then(async ([seed, graph]) => {
      if (!seed) {
        setView({ kind: 'empty' });
        return;
      }
      if (!graph || graph.derivedFrom !== seed.seededAt) {
        graph = deriveGraph(seed);
        await saveGraph(graph);
      }
      setView({ kind: 'seeded', seed, graph });
    });
  }, []);

  // Esc flies back out of a galaxy to the atlas (m2-plan §9).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setNav((n) => (n.mode === 'galaxy' ? { mode: 'atlas' } : n));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleSeed() {
    setNav({ mode: 'atlas' });
    setView({ kind: 'seeding', message: 'Starting…' });
    try {
      const seed = await runSeed({
        onProgress: (message) => setView({ kind: 'seeding', message }),
      });
      // runSeed already persisted the graph; derive the same view model here
      // (deriveGraph is pure) rather than a second storage round-trip.
      setAnimateIntro(true);
      setView({ kind: 'seeded', seed, graph: deriveGraph(seed) });
    } catch (err) {
      const e = err instanceof SeedError ? err : null;
      setView({
        kind: 'error',
        code: e?.code ?? 'GENERIC',
        message: e?.message ?? 'Something went wrong.',
      });
    }
  }

  // Drill into a company: fly in immediately, then expand if not already cached
  // (m2-plan §8, §9). Re-entering an expanded company never re-fetches.
  async function handleExpand(companyId: string) {
    if (view.kind !== 'seeded') return;
    const company = view.graph.nodes.find((n) => n.id === companyId);
    if (!company) return;

    if (view.graph.expansions?.[companyId]) {
      setNav({ mode: 'galaxy', companyId, status: 'ready' });
      return;
    }

    setNav({ mode: 'galaxy', companyId, status: 'loading' });
    // Only apply results if the user is still looking at this galaxy.
    const stillHere = (n: GraphView) =>
      n.mode === 'galaxy' && n.companyId === companyId;
    try {
      const expansion = await runExpandCompany(company, {
        onProgress: (message) =>
          setNav((n) => (stillHere(n) ? { ...n, status: 'loading', message } : n)),
      });
      setView((v) =>
        v.kind === 'seeded'
          ? {
              ...v,
              graph: {
                ...v.graph,
                expansions: {
                  ...(v.graph.expansions ?? {}),
                  [companyId]: expansion,
                },
              },
            }
          : v,
      );
      setNav((n) => (stillHere(n) ? { mode: 'galaxy', companyId, status: 'ready' } : n));
    } catch (err) {
      const e = err instanceof ExpandError ? err : null;
      const status = e?.code === 'EMPTY' ? 'empty' : 'error';
      setNav((n) =>
        stillHere(n)
          ? { mode: 'galaxy', companyId, status, message: e?.message }
          : n,
      );
    }
  }

  function handleBack() {
    setNav({ mode: 'atlas' });
  }

  // Seeded is a full-bleed graph surface; other states sit in the narrow main.
  if (view.kind === 'seeded') {
    return (
      <div className="app">
        <Cosmos />
        <Brand />
        <SeededState
          seed={view.seed}
          graph={view.graph}
          view={nav}
          onReseed={handleSeed}
          onCompanyClick={handleExpand}
          onBack={handleBack}
          animateIntro={animateIntro}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Cosmos />
      <Brand />
      <main className="app__main">
        {view.kind === 'loading' && <Spinner />}
        {view.kind === 'empty' && <EmptyState onSeed={handleSeed} />}
        {view.kind === 'seeding' && <SeedingState message={view.message} />}
        {view.kind === 'error' && (
          <ErrorState code={view.code} message={view.message} onRetry={handleSeed} />
        )}
      </main>
    </div>
  );
}

function Brand() {
  return (
    <header className="app__bar">
      <span className="app__brand">Career Atlas</span>
    </header>
  );
}

/**
 * The deep-space backdrop: a fixed, full-viewport star field that shows through
 * every (transparent) surface above it. A static dense base for stability, two
 * star layers that twinkle out of phase to give the void some life, and a faint
 * nebula for depth and colour. Purely decorative.
 */
function Cosmos() {
  return (
    <div className="cosmos" aria-hidden="true">
      <div className="cosmos__nebula" />
      <div className="cosmos__stars cosmos__stars--base" />
      <div className="cosmos__stars cosmos__stars--a" />
      <div className="cosmos__stars cosmos__stars--b" />
    </div>
  );
}

function EmptyState({ onSeed }: { onSeed: () => void }) {
  return (
    <div className="center">
      <p className="muted">Build your career graph from your own LinkedIn history.</p>
      <button className="btn btn--primary" onClick={onSeed}>
        Seed my graph
      </button>
    </div>
  );
}

function SeedingState({ message }: { message: string }) {
  return (
    <div className="center">
      <Spinner />
      <p className="muted">{message}</p>
    </div>
  );
}

function ErrorState({
  code,
  message,
  onRetry,
}: {
  code: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="center">
      <div className="error-card">
        <p className="error-card__title">
          {code === 'LOGGED_OUT' ? 'Not logged in' : 'Seeding failed'}
        </p>
        <p className="muted">{message}</p>
        <button className="btn btn--primary" onClick={onRetry}>
          {code === 'LOGGED_OUT' ? 'Seed again' : 'Retry'}
        </button>
      </div>
    </div>
  );
}

/** Header bar (avatar + name + company count + Re-seed) above the graph (§8). */
function SeededState({
  seed,
  graph,
  view,
  onReseed,
  onCompanyClick,
  onBack,
  animateIntro,
}: {
  seed: Seed;
  graph: CareerGraphModel;
  view: GraphView;
  onReseed: () => void;
  onCompanyClick: (companyId: string) => void;
  onBack: () => void;
  animateIntro: boolean;
}) {
  const count = graph.nodes.length;
  return (
    <div className="career-page">
      <section className="career-header">
        <Avatar dataUrl={seed.avatarDataUrl} name={seed.name} size={48} />
        <div className="career-header__meta">
          <h1 className="career-header__name">{seed.name}</h1>
          <p className="muted">
            {count} {count === 1 ? 'company' : 'companies'}
          </p>
        </div>
        <button className="btn btn--ghost" onClick={onReseed}>
          Re-seed
        </button>
      </section>
      {/* Key by the seed timestamp so a re-seed remounts the graph and the
          one-shot CSS ignition replays (CSS animations don't re-fire on a
          mere re-render). Expansions reuse the same mount (no remount). */}
      <CareerGraph
        key={graph.derivedFrom}
        graph={graph}
        view={view}
        onCompanyClick={onCompanyClick}
        onBack={onBack}
        animateIntro={animateIntro}
      />
    </div>
  );
}
