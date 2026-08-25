import { beforeEach, describe, expect, it } from 'vitest';
import { loadGraph } from '../src/storage';
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
