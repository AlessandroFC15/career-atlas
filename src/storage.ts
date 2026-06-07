import type {
  CareerGraph,
  CompanyExpansion,
  OnwardStint,
  Seed,
} from './types';

// Single source of truth in M0 (m0-plan §9). One key, overwritten on re-seed.
const SEED_KEY = 'seed';
// M1 (§9): the materialized graph, a second key derived from the seed.
const GRAPH_KEY = 'graph';

export async function loadSeed(): Promise<Seed | null> {
  const out = await chrome.storage.local.get(SEED_KEY);
  return (out[SEED_KEY] as Seed | undefined) ?? null;
}

export async function saveSeed(seed: Seed): Promise<void> {
  await chrome.storage.local.set({ [SEED_KEY]: seed });
}

export async function loadGraph(): Promise<CareerGraph | null> {
  const out = await chrome.storage.local.get(GRAPH_KEY);
  return (out[GRAPH_KEY] as CareerGraph | undefined) ?? null;
}

export async function saveGraph(graph: CareerGraph): Promise<void> {
  await chrome.storage.local.set({ [GRAPH_KEY]: graph });
}

/**
 * Merge one company's expansion into the stored graph (M2, m2-plan §10). Reads
 * the current graph, sets `expansions[companyId]`, and writes it back. The atlas
 * nodes/edges are untouched. Returns the updated graph (or null if none stored).
 */
export async function saveExpansion(
  companyId: string,
  expansion: CompanyExpansion,
): Promise<CareerGraph | null> {
  const graph = await loadGraph();
  if (!graph) return null;
  const next: CareerGraph = {
    ...graph,
    expansions: { ...(graph.expansions ?? {}), [companyId]: expansion },
  };
  await saveGraph(next);
  return next;
}

/**
 * Patch one traced person in place (M3, m3-plan §8, §10). Reads the graph, finds
 * the matching person inside `expansions[companyId].people`, and merges the
 * status (+ onward trajectory) onto it. Mirrors `saveExpansion`: the atlas and
 * every other person are untouched. Returns the updated graph (null if none, or
 * if the company has no expansion / the person is absent).
 */
export async function saveTrace(
  companyId: string,
  personId: string,
  patch: { status: 'expanded' | 'dismissed'; onward?: OnwardStint[]; expandedAt?: number },
): Promise<CareerGraph | null> {
  const graph = await loadGraph();
  if (!graph) return null;
  const expansion = graph.expansions?.[companyId];
  if (!expansion) return null;
  const next: CareerGraph = {
    ...graph,
    expansions: {
      ...graph.expansions,
      [companyId]: {
        ...expansion,
        people: expansion.people.map((p) =>
          p.id === personId ? { ...p, ...patch } : p,
        ),
      },
    },
  };
  await saveGraph(next);
  return next;
}
