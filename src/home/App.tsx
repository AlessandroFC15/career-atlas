import { useEffect, useRef, useState } from 'react';
import { isOptedOut, setOptedOut, track } from '../analytics';
import { loadGraph, loadSeed, saveGraph } from '../storage';
import { deriveGraph } from '../graph';
import {
  ExpandError,
  runExpandCompany,
  runLoadMorePeople,
  runSeed,
  runTracePerson,
  SeedError,
  TraceError,
  watchForLogin,
} from '../orchestrator';
import type {
  CareerGraph as CareerGraphModel,
  CompanyExpansion,
  Seed,
} from '../types';
import { Avatar, LoggedOutPanel } from './components';
import { CareerGraph, type GraphView } from './CareerGraph';
import { BreathingOrb, LoadingChart, useSeedReveal } from './LoadingChart';
import { t } from '../i18n';

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'seeding' }
  | { kind: 'seeded'; seed: Seed; graph: CareerGraphModel }
  | { kind: 'error'; code: string; message: string };

// The cross-dissolve window (§8): both LoadingChart and CareerGraph are mounted
// while the loading scatter fades out over M1's staggered ignition, then the
// scatter unmounts. Tuned against the intro's first beats, not orb coordinates.
const HANDOFF_MS = 1000;
// A short hold on the fully-lit scatter (its phase text already fading out)
// before it dissolves into the graph, so the climax settles without lingering.
const CLIMAX_HOLD_MS = 300;
// A stable empty set for "nothing arrived on a page here". A fresh `new Set()`
// per render would give the graph a new prop identity every time and bust the
// scene memo for nothing.
const NO_IDS: Set<string> = new Set();

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  // Paced seeding state driving the LoadingChart (§5): the hook throttles the
  // orchestrator's events to a legible minimum beat. `progress` is kept past
  // success so the fading handoff overlay still shows the full, lit scatter.
  const reveal = useSeedReveal();
  // True only during the brief cross-dissolve after a successful seed.
  const [handoff, setHandoff] = useState(false);
  // The dissolve waits for two independent signals: the seed finishing (the
  // graph is ready) and the climax sweep finishing (every orb has ignited).
  // Whichever lands last triggers it, exactly once. Refs, not state: they only
  // gate an imperative timer, never the render.
  const pendingSeed = useRef<{ seed: Seed; graph: CareerGraphModel } | null>(null);
  const climaxDone = useRef(false);
  const dissolved = useRef(false);
  // True only after a fresh seed/re-seed (handleSeed), so the staggered orb
  // ignition plays as a reward for that action. The load-on-mount path leaves
  // this false, so reopening an existing graph renders instantly.
  const [animateIntro, setAnimateIntro] = useState(false);
  // Navigation within the seeded view: the atlas chain, or a drilled-in galaxy
  // (m2-plan §3). Transient: never persisted, always starts at the atlas.
  const [nav, setNav] = useState<GraphView>({ mode: 'atlas' });
  // Person ids with a trace in flight (M3): drives the spinner-on-orb. Transient.
  const [tracingIds, setTracingIds] = useState<Set<string>>(new Set());
  // The company whose next page of people is in flight (M5), or null. A single
  // id, not a set: you are in exactly one galaxy at a time. Lifted here (rather
  // than owned by the orb) so a failed page has somewhere to surface.
  const [loadingMoreId, setLoadingMoreId] = useState<string | null>(null);
  // The people the last "more" click brought in, and the galaxy they belong to.
  // They reveal as their own quick batch rather than waiting out the drill-in
  // camera gate (see styles.css [data-fresh]). Carrying the company id means the
  // batch scopes itself at the point of use: a re-entered galaxy plays its one
  // entry cascade with no effect needed to clear this first.
  const [fresh, setFresh] = useState<{ companyId: string; ids: Set<string> } | null>(
    null,
  );
  // An unobtrusive note shown when a trace or a "more" page fails. `loggedOut`
  // carries a login link instead of the usual "the worker tab is already
  // surfaced" implication, since a logged-out worker tab is closed, not left
  // open (see orchestrator's settleWorkerTab). Cleared when the next one starts.
  const [galaxyNote, setGalaxyNote] = useState<{
    message: string;
    loggedOut: boolean;
  } | null>(null);
  // Whichever action just hit LOGGED_OUT, so the "Log in" button can retry it
  // on its own once the user returns from LinkedIn — no separate "Seed again"
  // click needed. A ref (not state): it only feeds an imperative callback,
  // never the render, and must never go stale between being set and fired.
  const pendingRetry = useRef<() => void>(() => {});

  // Open LinkedIn's login page and, once the user is done with it, replay
  // whatever action was blocked by being logged out.
  function handleLogin() {
    watchForLogin(() => pendingRetry.current());
  }

  // Read-on-mount: render the materialized graph from the store, never by
  // re-reading LinkedIn (m1-plan §9). An M0-era seed (no graph, or a stale one)
  // migrates silently here: derive once, persist, then render.
  useEffect(() => {
    let settled = false;
    // The `loading` view must never be a dead end. If the storage read rejects
    // or hangs (e.g. the extension context was invalidated by a rebuild while
    // this page stayed open), fall back to the welcome instead of the lone
    // loading orb sitting forever.
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

  // Shared by Esc and the back button, so "left the galaxy" is tracked exactly
  // once regardless of which one the user reaches for.
  function goToAtlas() {
    setNav((n) => {
      if (n.mode !== 'galaxy') return n;
      void track({ name: 'atlas_returned' });
      return { mode: 'atlas' };
    });
  }

  // Esc flies back out of a galaxy to the atlas (m2-plan §9).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') goToAtlas();
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
      if (e?.code === 'LOGGED_OUT') pendingRetry.current = handleSeed;
      setView({
        kind: 'error',
        code: e?.code ?? 'GENERIC',
        message: e?.message ?? t('errorGeneric'),
      });
    }
  }

  /** Write one company's expansion into the seeded view. The three fetch paths
   *  (expand, trace, load more) all end here, so the nested spread that reaches
   *  `graph.expansions[companyId]` is written once. `next` may be a value or an
   *  updater over the current expansion; an updater is skipped when the company
   *  has none (nothing to patch). */
  function putExpansion(
    companyId: string,
    next:
      | CompanyExpansion
      | ((current: CompanyExpansion) => CompanyExpansion),
  ) {
    setView((v) => {
      if (v.kind !== 'seeded') return v;
      const current = v.graph.expansions?.[companyId];
      if (typeof next === 'function' && !current) return v;
      const expansion = typeof next === 'function' ? next(current!) : next;
      return {
        ...v,
        graph: {
          ...v.graph,
          expansions: { ...(v.graph.expansions ?? {}), [companyId]: expansion },
        },
      };
    });
  }

  // Drill into a company: fly in immediately, then expand if not already cached
  // (m2-plan §8, §9). Re-entering an expanded company never re-fetches.
  async function handleExpand(companyId: string) {
    if (view.kind !== 'seeded') return;
    const company = view.graph.nodes.find((n) => n.id === companyId);
    if (!company) return;
    void track({ name: 'galaxy_entered' });

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
      putExpansion(companyId, expansion);
      setNav((n) => (stillHere(n) ? { mode: 'galaxy', companyId, status: 'ready' } : n));
    } catch (err) {
      const e = err instanceof ExpandError ? err : null;
      const status =
        e?.code === 'EMPTY' ? 'empty' : e?.code === 'LOGGED_OUT' ? 'logged-out' : 'error';
      if (status === 'logged-out') pendingRetry.current = () => handleExpand(companyId);
      setNav((n) =>
        stillHere(n)
          ? { mode: 'galaxy', companyId, status, message: e?.message }
          : n,
      );
    }
  }

  // Trace one clicked colleague (m3-plan §8, §9): spinner on the orb, one
  // profile load, then patch that person in place (status + onward). Never
  // re-fetches an already-traced person; a dismissed orb re-clicks to retry.
  async function handleTracePerson(personId: string) {
    if (view.kind !== 'seeded' || nav.mode !== 'galaxy') return;
    const companyId = nav.companyId;
    const company = view.graph.nodes.find((n) => n.id === companyId);
    const person = view.graph.expansions?.[companyId]?.people.find(
      (p) => p.id === personId,
    );
    if (!company || !person) return;
    if (person.status === 'traced') return; // already traced, never re-fetch
    if (tracingIds.has(personId)) return; // a trace is already in flight

    setGalaxyNote(null);
    setTracingIds((prev) => new Set(prev).add(personId));
    try {
      const result = await runTracePerson(company, person);
      putExpansion(companyId, (expansion) => ({
        ...expansion,
        people: expansion.people.map((p) =>
          p.id === personId
            ? {
                ...p,
                status: result.status,
                onward: result.status === 'traced' ? result.onward : undefined,
                tracedAt:
                  result.status === 'traced' ? result.tracedAt : p.tracedAt,
              }
            : p,
        ),
      }));
    } catch (err) {
      // Person stays 'raw' (retryable).
      const e = err instanceof TraceError ? err : null;
      if (e?.code === 'LOGGED_OUT') {
        pendingRetry.current = () => handleTracePerson(personId);
      }
      setGalaxyNote({
        message: e?.message ?? t('couldNotFollow'),
        loggedOut: e?.code === 'LOGGED_OUT',
      });
    } finally {
      setTracingIds((prev) => {
        const next = new Set(prev);
        next.delete(personId);
        return next;
      });
    }
  }

  // Page in the next batch of colleagues (M5): spinner on the "more" orb, one
  // search load, then the merged people list replaces this company's expansion.
  // Already-traced colleagues keep their status (and so their lanes) through the
  // merge; a page that brings nobody new marks the search exhausted and the orb
  // settles into its spent state.
  async function handleLoadMore(companyId: string) {
    if (view.kind !== 'seeded') return;
    if (loadingMoreId) return; // one page in flight at a time
    const company = view.graph.nodes.find((n) => n.id === companyId);
    const expansion = view.graph.expansions?.[companyId];
    if (!company || !expansion || expansion.exhausted) return;

    setGalaxyNote(null);
    setLoadingMoreId(companyId);
    try {
      const result = await runLoadMorePeople(company, expansion);
      putExpansion(companyId, result.expansion);
      setFresh({ companyId, ids: new Set(result.added.map((p) => p.id)) });
      // Exhaustion is visible on the orb itself, so it needs no note. A page
      // that landed people needs none either: they simply appear.
    } catch (err) {
      const e = err instanceof ExpandError ? err : null;
      if (e?.code === 'LOGGED_OUT') {
        pendingRetry.current = () => handleLoadMore(companyId);
      }
      setGalaxyNote({
        message: e?.message ?? t('couldNotLoadMore'),
        loggedOut: e?.code === 'LOGGED_OUT',
      });
    } finally {
      setLoadingMoreId(null);
    }
  }

  function handleBack() {
    goToAtlas();
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
        <Brand onReseed={handleReset} />
        <SeededState
          seed={view.seed}
          graph={view.graph}
          view={nav}
          onCompanyClick={handleExpand}
          onPersonClick={handleTracePerson}
          onLoadMore={handleLoadMore}
          tracingIds={tracingIds}
          loadingMoreId={loadingMoreId}
          freshIds={
            nav.mode === 'galaxy' && fresh?.companyId === nav.companyId
              ? fresh.ids
              : NO_IDS
          }
          galaxyNote={nav.mode === 'galaxy' ? galaxyNote : null}
          onLogin={handleLogin}
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
        {view.kind === 'loading' && <BreathingOrb />}
        {view.kind === 'empty' && <EmptyState onSeed={handleSeed} />}
        {view.kind === 'error' && view.code === 'LOGGED_OUT' && (
          <LoggedOutPanel
            message={view.message}
            onLogin={handleLogin}
            secondary={{ label: t('seedAgain'), onClick: handleSeed }}
          />
        )}
        {view.kind === 'error' && view.code !== 'LOGGED_OUT' && (
          <ErrorState message={view.message} onRetry={handleSeed} />
        )}
      </main>
    </div>
  );
}

function Brand({ onReseed }: { onReseed?: () => void }) {
  return (
    <header className="app__bar">
      <span className="app__brand">Career Atlas</span>
      <AppMenu onReseed={onReseed} />
    </header>
  );
}

/** The title bar's one overflow menu: re-seed (only once there's a graph to
 *  re-seed) plus the privacy opt-out (issue #11), on by default. Both are
 *  settings/rare actions, so they share a menu tucked behind a hamburger
 *  rather than sitting exposed next to the brand. The opt-out toggle reads
 *  its state from storage once rather than lifting it into App's own state —
 *  no other part of the tree needs to react to it. */
function AppMenu({ onReseed }: { onReseed?: () => void }) {
  const [optedOut, setOptedOutState] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isOptedOut().then(setOptedOutState);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (optedOut === null) return null;

  return (
    <div className="app-menu" ref={ref}>
      <button
        className="app-menu__trigger"
        aria-label={t('menu')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div className="app-menu__panel">
          {onReseed && (
            <>
              <button
                className="app-menu__item"
                onClick={() => {
                  setOpen(false);
                  onReseed();
                }}
              >
                {t('startOver')}
              </button>
              <div className="app-menu__divider" />
            </>
          )}
          <label className="app-menu__option">
            <input
              type="checkbox"
              checked={!optedOut}
              onChange={(e) => {
                const next = !e.target.checked;
                setOptedOutState(next);
                void setOptedOut(next);
              }}
            />
            {t('shareUsageData')}
          </label>
          <a
            className="app-menu__link"
            href="https://github.com/AlessandroFC15/career-atlas/blob/main/docs/privacy-policy.md"
            target="_blank"
            rel="noreferrer"
          >
            {t('privacyPolicy')}
          </a>
        </div>
      )}
    </div>
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

/** The first-run welcome: a quiet anchor orb (the same one a seed ignites the
 *  chart around), a headline, the value prop, then the call to seed. */
function EmptyState({ onSeed }: { onSeed: () => void }) {
  return (
    <div className="welcome">
      <span className="welcome__orb" aria-hidden="true" />
      <h1 className="welcome__title">{t('welcomeTitle')}</h1>
      <p className="welcome__lede">{t('welcomeLede')}</p>
      <button className="btn btn--primary welcome__cta" onClick={onSeed}>
        {t('seedCta')}
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="center">
      <div className="error-card">
        <p className="error-card__title">{t('seedingFailedTitle')}</p>
        <p className="muted">{message}</p>
        <button className="btn btn--primary" onClick={onRetry}>
          {t('retry')}
        </button>
      </div>
    </div>
  );
}

/** Header bar (avatar + name + company count) above the graph (§8). Re-seed
 *  lives in the title bar's overflow menu now (issue #11), not here. */
function SeededState({
  seed,
  graph,
  view,
  onCompanyClick,
  onPersonClick,
  onLoadMore,
  tracingIds,
  loadingMoreId,
  freshIds,
  galaxyNote,
  onLogin,
  onBack,
  animateIntro,
}: {
  seed: Seed;
  graph: CareerGraphModel;
  view: GraphView;
  onCompanyClick: (companyId: string) => void;
  onPersonClick: (personId: string) => void;
  onLoadMore: (companyId: string) => void;
  tracingIds: Set<string>;
  loadingMoreId: string | null;
  freshIds: Set<string>;
  galaxyNote: { message: string; loggedOut: boolean } | null;
  onLogin: () => void;
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
            {t(count === 1 ? 'companyCountOne' : 'companyCountOther', count)}
          </p>
        </div>
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
        onLoadMore={onLoadMore}
        tracingIds={tracingIds}
        loadingMoreId={loadingMoreId}
        freshIds={freshIds}
        onLogin={onLogin}
        onBack={onBack}
        animateIntro={animateIntro}
      />
      {galaxyNote && (
        <div className="galaxy-note">
          {galaxyNote.message}
          {galaxyNote.loggedOut && (
            <button className="galaxy-note__link" onClick={onLogin}>
              {t('logInToLinkedIn')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
