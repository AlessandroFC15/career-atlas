import { mergePeople } from './graph';
import type {
  CareerGraph,
  CompanyExpansion,
  CurrentRole,
  OnwardStint,
  PersonNode,
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
  const graph = (out[GRAPH_KEY] as CareerGraph | undefined) ?? null;
  return graph ? migrateTracedStatus(graph) : null;
}

/**
 * Legacy shape: M3 first shipped a traced person as `status: 'expanded'` with
 * `expandedAt`. "Expand" now belongs to companies only, so a stored graph is
 * mapped to `'traced'` / `tracedAt` on the way out. Without this, an already
 * explored galaxy loses its swimlanes on load (the people match neither status
 * and fall back into the candidate cluster) with no way back but a re-seed.
 */
function migrateTracedStatus(graph: CareerGraph): CareerGraph {
  if (!graph.expansions) return graph;
  let changed = false;
  const expansions: Record<string, CompanyExpansion> = {};
  for (const [companyId, expansion] of Object.entries(graph.expansions)) {
    expansions[companyId] = {
      ...expansion,
      people: expansion.people.map((p) => {
        const legacy = p as Omit<PersonNode, 'status'> & {
          status: PersonNode['status'] | 'expanded';
          expandedAt?: number;
        };
        if (legacy.status !== 'expanded') return p;
        changed = true;
        const { expandedAt, ...rest } = legacy;
        return { ...rest, status: 'traced', tracedAt: p.tracedAt ?? expandedAt };
      }),
    };
  }
  return changed ? { ...graph, expansions } : graph;
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
 * The read-modify-write shell every in-place expansion edit shares: re-read the
 * graph (so the edit lands on what is stored NOW, not on a caller's snapshot
 * that may be seconds old), hand `fn` the company's current expansion, and save
 * what it returns. The atlas and every other company are untouched.
 *
 * Returns the updated graph, or null when there is nothing to patch: no stored
 * graph, or this company was never expanded. Unlike `saveExpansion` it never
 * CREATES the entry — a patch needs a first page to patch.
 */
async function patchExpansion(
  companyId: string,
  fn: (expansion: CompanyExpansion) => CompanyExpansion,
): Promise<CareerGraph | null> {
  const graph = await loadGraph();
  const expansion = graph?.expansions?.[companyId];
  if (!graph || !expansion) return null;
  const next: CareerGraph = {
    ...graph,
    expansions: { ...graph.expansions, [companyId]: fn(expansion) },
  };
  await saveGraph(next);
  return next;
}

/**
 * Append a fetched page of people to a company's expansion (M5).
 *
 * The merge happens HERE, inside the re-read, rather than in the caller: a page
 * load takes seconds and the user can trace a colleague while it is in flight,
 * so the page is folded into whatever is stored now with the stored people
 * winning (see `mergePeople`). Writing the caller's pre-fetch snapshot wholesale
 * would quietly undo that trace.
 */
export async function appendExpansionPage(
  companyId: string,
  page: { people: PersonNode[]; pagesLoaded: number; exhausted: boolean },
): Promise<CareerGraph | null> {
  return patchExpansion(companyId, (expansion) => ({
    ...expansion,
    people: mergePeople(expansion.people, page.people),
    fetchedAt: Date.now(),
    pagesLoaded: page.pagesLoaded,
    exhausted: page.exhausted,
  }));
}

/**
 * Patch one traced person in place (M3, m3-plan §8, §10): find the matching
 * person inside `expansions[companyId].people` and merge the status (+ onward
 * trajectory) onto them. Every other person is untouched. Returns null if the
 * company has no expansion; an absent person is simply a no-op map.
 */
export async function saveTrace(
  companyId: string,
  personId: string,
  patch: {
    status: 'traced' | 'dismissed';
    onward?: OnwardStint[];
    currentRoles?: CurrentRole[];
    tracedAt?: number;
  },
): Promise<CareerGraph | null> {
  return patchExpansion(companyId, (expansion) => ({
    ...expansion,
    people: expansion.people.map((p) => (p.id === personId ? { ...p, ...patch } : p)),
  }));
}
