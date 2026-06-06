import { describe, expect, it } from 'vitest';
import { COL_GAP, deriveGraph, layout } from '../src/graph';
import type { DateParts, ExperienceEntry, Seed } from '../src/types';

function entry(
  companyName: string,
  start: DateParts,
  end: DateParts | null,
  opts: Partial<ExperienceEntry> = {},
): ExperienceEntry {
  return {
    companyName,
    start,
    end,
    roles: opts.roles ?? [
      { title: 'Role', start, end, rawDateText: '' },
    ],
    rawDateText: opts.rawDateText ?? '',
    ...opts,
  };
}

function seed(experiences: ExperienceEntry[], seededAt = 1000): Seed {
  return {
    name: 'Test User',
    profileUrl: 'https://www.linkedin.com/in/test/',
    seededAt,
    experiences,
  };
}

describe('deriveGraph', () => {
  it('emits one node per entry, ordered by ascending start date', () => {
    // Provided out of order; should sort Gamma(2018) → Beta(2020) → Acme(2022).
    const g = deriveGraph(
      seed([
        entry('Beta', { year: 2020, month: 3 }, { year: 2022, month: 1 }),
        entry('Acme', { year: 2022, month: 2 }, null),
        entry('Gamma', { year: 2018, month: 6 }, { year: 2020, month: 2 }),
      ]),
    );
    expect(g.nodes.map((n) => n.name)).toEqual(['Gamma', 'Beta', 'Acme']);
    expect(g.nodes.map((n) => n.order)).toEqual([0, 1, 2]);
    expect(g.nodes.map((n) => n.id)).toEqual(['c0', 'c1', 'c2']);
    expect(g.nodes.every((n) => n.kind === 'company' && n.level === 0)).toBe(true);
  });

  it('connects consecutive companies with directed next edges', () => {
    const g = deriveGraph(
      seed([
        entry('A', { year: 2019 }, { year: 2020 }),
        entry('B', { year: 2020 }, { year: 2021 }),
        entry('C', { year: 2021 }, null),
      ]),
    );
    expect(g.edges).toEqual([
      { id: 'e0', source: 'c0', target: 'c1', kind: 'next' },
      { id: 'e1', source: 'c1', target: 'c2', kind: 'next' },
    ]);
  });

  it('yields one node and zero edges for a single-company seed', () => {
    const g = deriveGraph(seed([entry('Solo', { year: 2021 }, null)]));
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(0);
  });

  it('keeps a boomerang as two distinct nodes (no URN dedup)', () => {
    const g = deriveGraph(
      seed([
        entry('Acme', { year: 2015 }, { year: 2017 }, {
          companyUrn: 'urn:acme',
        }),
        entry('Detour', { year: 2017 }, { year: 2019 }),
        entry('Acme', { year: 2019 }, null, { companyUrn: 'urn:acme' }),
      ]),
    );
    const acme = g.nodes.filter((n) => n.name === 'Acme');
    expect(acme).toHaveLength(2);
    expect(acme[0].id).not.toBe(acme[1].id);
    expect(acme.map((n) => n.order)).toEqual([0, 2]);
  });

  it('still produces a node for an entry with no URN', () => {
    const g = deriveGraph(seed([entry('NoUrn', { year: 2020 }, null)]));
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].companyUrn).toBeUndefined();
  });

  it('reflects multi-role stints in roleCount', () => {
    const multi = entry('Grown', { year: 2018 }, null, {
      roles: [
        { title: 'Junior', start: { year: 2018 }, end: { year: 2020 }, rawDateText: '' },
        { title: 'Senior', start: { year: 2020 }, end: null, rawDateText: '' },
      ],
    });
    const g = deriveGraph(seed([multi]));
    expect(g.nodes[0].roleCount).toBe(2);
  });

  it('records the seededAt it was derived from', () => {
    const g = deriveGraph(seed([entry('A', { year: 2020 }, null)], 4242));
    expect(g.derivedFrom).toBe(4242);
  });
});

describe('layout', () => {
  it('places order 0 at the origin', () => {
    expect(layout(0)).toEqual({ x: 0, y: 0 });
  });

  it('increases x monotonically with order, on a single row', () => {
    const xs = [0, 1, 2, 3].map((o) => layout(o));
    expect(xs.map((p) => p.x)).toEqual([0, COL_GAP, COL_GAP * 2, COL_GAP * 3]);
    expect(xs.every((p) => p.y === 0)).toBe(true);
  });

  it('is deterministic — same order yields identical coordinates', () => {
    expect(layout(5)).toEqual(layout(5));
  });
});
