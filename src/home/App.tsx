import { useEffect, useRef, useState } from 'react';
import { loadGraph, loadSeed, saveGraph } from '../storage';
import { deriveGraph } from '../graph';
import {
  ExpandError,
  runExpandCompany,
  runSeed,
  runTracePerson,
  SeedError,
  TraceError,
} from '../orchestrator';
import type { CareerGraph as CareerGraphModel, Seed } from '../types';
import { Avatar } from './components';
import { CareerGraph, type GraphView } from './CareerGraph';
import { BreathingStar, LoadingChart, useSeedReveal } from './LoadingChart';

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'seeding' }
  | { kind: 'seeded'; seed: Seed; graph: CareerGraphModel }
  | { kind: 'error'; code: string; message: string };

// The cross-dissolve window (§8): both LoadingChart and CareerGraph are mounted
// while the loading scatter fades out over M1's staggered ignition, then the
// scatter unmounts. Tuned against the intro's first beats, not star coordinates.
const HANDOFF_MS = 1000;
// A short hold on the fully-lit scatter (its phase text already fading out)
// before it dissolves into the graph, so the climax settles without lingering.
const CLIMAX_HOLD_MS = 300;

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  // Paced seeding state driving the LoadingChart (§5): the hook throttles the
  // orchestrator's events to a legible minimum beat. `progress` is kept past
  // success so the fading handoff overlay still shows the full, lit scatter.
  const reveal = useSeedReveal();
  // True only during the brief cross-dissolve after a successful seed.
  const [handoff, setHandoff] = useState(false);
  // The dissolve waits for two independent signals: the seed finishing (the
  // graph is ready) and the climax sweep finishing (every star has ignited).
  // Whichever lands last triggers it, exactly once. Refs, not state: they only
  // gate an imperative timer, never the render.
  const pendingSeed = useRef<{ seed: Seed; graph: CareerGraphModel } | null>(null);
  const climaxDone = useRef(false);
  const dissolved = useRef(false);
  // True only after a fresh seed/re-seed (handleSeed), so the staggered star
  // ignition plays as a reward for that action. The load-on-mount path leaves
  // this false, so reopening an existing graph renders instantly.
  const [animateIntro, setAnimateIntro] = useState(false);
  // Navigation within the seeded view: the atlas chain, or a drilled-in galaxy
  // (m2-plan §3). Transient: never persisted, always starts at the atlas.
  const [nav, setNav] = useState<GraphView>({ mode: 'atlas' });
  // Person ids with a trace in flight (M3): drives the spinner-on-orb. Transient.
  const [expandingIds, setExpandingIds] = useState<Set<string>>(new Set());
  // An unobtrusive note shown when a trace fails (the worker tab is already
  // surfaced for the user to act on). Cleared when the next trace starts.
  const [traceNote, setTraceNote] = useState<string | null>(null);

  // Read-on-mount: render the materialized graph from the store, never by
  // re-reading LinkedIn (m1-plan §9). An M0-era seed (no graph, or a stale one)
  // migrates silently here: derive once, persist, then render.
  useEffect(() => {
    let settled = false;
    // The `loading` view must never be a dead end. If the storage read rejects
    // or hangs (e.g. the extension context was invalidated by a rebuild while
    // this page stayed open), fall back to the welcome instead of the lone
    // loading star sitting forever.
    const leaveLoading = () =>
      setView((v) => (v.kind === 'loading' ? { kind: 'empty' } : v));
    const fallback = setTimeout(() => {
      if (!settled) leaveLoading();
    }, 4000);
    Promise.all([loadSeed(), loadGraph()])
      .then(async ([seed, graph]) => {
        settled = true;
        clearTimeout(fallback);
        if (!seed) {
          setView({ kind: 'empty' });
          return;
        }
        if (!graph || graph.derivedFrom !== seed.seededAt) {
          graph = deriveGraph(seed);
          await saveGraph(graph);
        }
        setView({ kind: 'seeded', seed, graph });
      })
      .catch(() => {
        settled = true;
        clearTimeout(fallback);
        leaveLoading();
      });
    return () => clearTimeout(fallback);
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

  // Fire the dissolve once both the graph is ready and the climax has finished.
  // Holds the lit field a beat, then mounts the graph (firing M1's ignition)
  // under a fading LoadingChart overlay for the cross-dissolve (§8).
  function maybeDissolve() {
    if (dissolved.current) return;
    if (!pendingSeed.current || !climaxDone.current) return;
    dissolved.current = true;
    const { seed, graph } = pendingSeed.current;
    setTimeout(() => {
      setAnimateIntro(true);
      setView({ kind: 'seeded', seed, graph });
      setHandoff(true);
      setTimeout(() => setHandoff(false), HANDOFF_MS);
    }, CLIMAX_HOLD_MS);
  }

  async function handleSeed() {
    setNav({ mode: 'atlas' });
    reveal.reset();
    setHandoff(false);
    pendingSeed.current = null;
    climaxDone.current = false;
    dissolved.current = false;
    setView({ kind: 'seeding' });
    try {
      const seed = await runSeed({ onProgress: reveal.push });
      // runSeed already persisted the graph; derive the same view model here
      // (deriveGraph is pure) rather than a second storage round-trip. The actual
      // swap waits for the climax sweep to finish (see maybeDissolve).
      pendingSeed.current = { seed, graph: deriveGraph(seed) };
      maybeDissolve();
    } catch (err) {
      reveal.reset();
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

  // Trace one clicked colleague (m3-plan §8, §9): spinner on the orb, one
  // profile load, then patch that person in place (status + onward). Never
  // re-fetches an already-expanded person; a dismissed orb re-clicks to retry.
  async function handleTracePerson(personId: string) {
    if (view.kind !== 'seeded' || nav.mode !== 'galaxy') return;
    const companyId = nav.companyId;
    const company = view.graph.nodes.find((n) => n.id === companyId);
    const person = view.graph.expansions?.[companyId]?.people.find(
      (p) => p.id === personId,
    );
    if (!company || !person) return;
    if (person.status === 'expanded') return; // already traced, never re-fetch
    if (expandingIds.has(personId)) return; // a trace is already in flight

    setTraceNote(null);
    setExpandingIds((prev) => new Set(prev).add(personId));
    try {
      const result = await runTracePerson(company, person);
      setView((v) => {
        if (v.kind !== 'seeded') return v;
        const expansion = v.graph.expansions?.[companyId];
        if (!expansion) return v;
        return {
          ...v,
          graph: {
            ...v.graph,
            expansions: {
              ...v.graph.expansions,
              [companyId]: {
                ...expansion,
                people: expansion.people.map((p) =>
                  p.id === personId
                    ? {
                        ...p,
                        status: result.status,
                        onward:
                          result.status === 'expanded' ? result.onward : undefined,
                        expandedAt:
                          result.status === 'expanded'
                            ? result.expandedAt
                            : p.expandedAt,
                      }
                    : p,
                ),
              },
            },
          },
        };
      });
    } catch (err) {
      // Person stays 'raw' (retryable); the worker tab is already surfaced.
      const e = err instanceof TraceError ? err : null;
      setTraceNote(e?.message ?? 'Could not follow them. Try again.');
    } finally {
      setExpandingIds((prev) => {
        const next = new Set(prev);
        next.delete(personId);
        return next;
      });
    }
  }

  function handleBack() {
    setNav({ mode: 'atlas' });
  }

  // Re-seed returns to the initial "Seed my graph" screen rather than launching
  // straight into a seed, so the user re-enters the reveal deliberately. The
  // persisted seed/graph are left untouched (reopening still restores them); this
  // only resets the in-session view.
  function handleReset() {
    setNav({ mode: 'atlas' });
    setView({ kind: 'empty' });
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
          onReseed={handleReset}
          onCompanyClick={handleExpand}
          onPersonClick={handleTracePerson}
          expandingIds={expandingIds}
          traceNote={nav.mode === 'galaxy' ? traceNote : null}
          onBack={handleBack}
          animateIntro={animateIntro}
        />
        {/* Cross-dissolve: the loading scatter fades out over the ignition (§8). */}
        {handoff && <LoadingChart progress={reveal.progress} fading />}
      </div>
    );
  }

  // Seeding is the full-bleed cosmic loading sequence; the other narrow states
  // (empty / error) and the reopen flash sit in the centered main column.
  if (view.kind === 'seeding') {
    return (
      <div className="app">
        <Cosmos />
        <Brand />
        <LoadingChart
          progress={reveal.progress}
          onClimaxDone={() => {
            climaxDone.current = true;
            maybeDissolve();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <Cosmos />
      <Brand />
      <main className="app__main">
        {view.kind === 'loading' && <BreathingStar />}
        {view.kind === 'empty' && <EmptyState onSeed={handleSeed} />}
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

/** The first-run welcome: a quiet anchor star (the same one a seed ignites the
 *  chart around), a headline, the value prop, then the call to seed. */
function EmptyState({ onSeed }: { onSeed: () => void }) {
  return (
    <div className="welcome">
      <span className="welcome__star" aria-hidden="true" />
      <h1 className="welcome__title">Your career, as a star chart</h1>
      <p className="welcome__lede">
        Career Atlas charts your professional history from your own LinkedIn
        profile: every company a star, every move a path between them.
      </p>
      <button className="btn btn--primary welcome__cta" onClick={onSeed}>
        Seed my graph
      </button>
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
  onPersonClick,
  expandingIds,
  traceNote,
  onBack,
  animateIntro,
}: {
  seed: Seed;
  graph: CareerGraphModel;
  view: GraphView;
  onReseed: () => void;
  onCompanyClick: (companyId: string) => void;
  onPersonClick: (personId: string) => void;
  expandingIds: Set<string>;
  traceNote: string | null;
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
        onPersonClick={onPersonClick}
        expandingIds={expandingIds}
        onBack={onBack}
        animateIntro={animateIntro}
      />
      {traceNote && <div className="trace-note">{traceNote}</div>}
    </div>
  );
}
