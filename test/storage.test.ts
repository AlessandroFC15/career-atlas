import { beforeEach, describe, expect, it } from 'vitest';
import { appendExpansionPage, loadGraph } from '../src/storage';
import type { CareerGraph, PersonNode } from '../src/types';

/** Minimal chrome.storage.local stand-in: one in-memory bag, get by key. */
let store: Record<string, unknown> = {};
beforeEach(() => {
  store = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
    },
  };
});

function graphWith(people: unknown[]): CareerGraph {
  return {
    nodes: [],
    edges: [],
    derivedFrom: 0,
    expansions: {
      acme: { people: people as PersonNode[], keyword: 'Acme', fetchedAt: 1 },
    },
  };
}

const base = {
  id: 'acme:jo',
  kind: 'person',
  level: 1,
  parentId: 'acme',
  vanity: 'jo',
  profileUrl: 'https://linkedin.com/in/jo',
  name: 'Jo',
  order: 0,
};

describe('loadGraph legacy status migration', () => {
  it("maps a stored 'expanded' person to 'traced' and keeps the stamp", async () => {
    store.graph = graphWith([
      { ...base, status: 'expanded', expandedAt: 1234, onward: [] },
    ]);
    const graph = await loadGraph();
    const person = graph!.expansions!.acme.people[0];
    expect(person.status).toBe('traced');
    expect(person.tracedAt).toBe(1234);
    expect(person).not.toHaveProperty('expandedAt');
  });

  it('leaves raw, dismissed and already-traced people alone', async () => {
    store.graph = graphWith([
      { ...base, id: 'acme:a', status: 'raw' },
      { ...base, id: 'acme:b', status: 'dismissed' },
      { ...base, id: 'acme:c', status: 'traced', tracedAt: 9 },
    ]);
    const graph = await loadGraph();
    expect(
      graph!.expansions!.acme.people.map((p) => [p.status, p.tracedAt]),
    ).toEqual([
      ['raw', undefined],
      ['dismissed', undefined],
      ['traced', 9],
    ]);
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadGraph()).toBeNull();
  });
});

describe('appendExpansionPage', () => {
  const person = (id: string, extra: Record<string, unknown> = {}) => ({
    ...base,
    id,
    vanity: id.split(':')[1],
    status: 'raw',
    ...extra,
  });

  it('appends the new people and records the page count', async () => {
    store.graph = graphWith([person('acme:a')]);
    const graph = await appendExpansionPage('acme', {
      people: [person('acme:a'), person('acme:b')] as PersonNode[],
      pagesLoaded: 2,
      exhausted: false,
    });
    const expansion = graph!.expansions!.acme;
    expect(expansion.people.map((p) => p.id)).toEqual(['acme:a', 'acme:b']);
    expect(expansion.people.map((p) => p.order)).toEqual([0, 1]);
    expect(expansion.pagesLoaded).toBe(2);
    expect(expansion.exhausted).toBe(false);
  });

  it('does not clobber a trace that landed while the page was in flight', async () => {
    // Stored: 'a' was traced mid-fetch. The caller's page still carries the
    // pre-fetch 'raw' snapshot of 'a' — the stored status must win.
    store.graph = graphWith([person('acme:a', { status: 'traced', tracedAt: 5 })]);
    const graph = await appendExpansionPage('acme', {
      people: [person('acme:a'), person('acme:b')] as PersonNode[],
      pagesLoaded: 2,
      exhausted: false,
    });
    const people = graph!.expansions!.acme.people;
    expect(people[0].status).toBe('traced');
    expect(people[0].tracedAt).toBe(5);
    expect(people[1].id).toBe('acme:b');
  });

  it('marks the search exhausted when a page brings nobody new', async () => {
    store.graph = graphWith([person('acme:a')]);
    const graph = await appendExpansionPage('acme', {
      people: [person('acme:a')] as PersonNode[],
      pagesLoaded: 3,
      exhausted: true,
    });
    expect(graph!.expansions!.acme.people).toHaveLength(1);
    expect(graph!.expansions!.acme.exhausted).toBe(true);
  });

  it('is a no-op when the company was never expanded', async () => {
    store.graph = graphWith([person('acme:a')]);
    expect(
      await appendExpansionPage('other', {
        people: [],
        pagesLoaded: 2,
        exhausted: false,
      }),
    ).toBeNull();
  });
});
