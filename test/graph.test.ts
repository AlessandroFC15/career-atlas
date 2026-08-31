import { describe, expect, it } from 'vitest';
import {
  AXIS_LEFT,
  AXIS_WIDTH,
  BAND_TOP,
  COL_GAP,
  FACE_GUTTER,
  GALAXY_DROP,
  GALAXY_PERSON_GAP,
  GALAXY_ROW_GAP,
  LANE_GAP,
  MIN_LEAF_GAP,
  galaxyGeometry,
  clusterRowCount,
  deriveGraph,
  deriveOnward,
  layout,
  layoutGalaxyFocus,
  layoutCluster,
  layoutSwimlanes,
  mergePeople,
  personNodesFromRecords,
  swimlaneX,
} from '../src/graph';
import type {
  DateParts,
  ExperienceEntry,
  GraphNode,
  OnwardStint,
  PersonNode,
  PersonRecord,
  Seed,
} from '../src/types';

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

function record(vanity: string, opts: Partial<PersonRecord> = {}): PersonRecord {
  return {
    vanity,
    profileUrl: `https://www.linkedin.com/in/${vanity}/`,
    name: opts.name ?? vanity,
    headline: opts.headline,
    location: opts.location,
    photoUrl: opts.photoUrl,
  };
}

describe('layoutGalaxy', () => {
  it('pins the focused company at the origin', () => {
    expect(layoutGalaxyFocus()).toEqual({ x: 0, y: 0 });
  });

  it('centers a single person directly under the focused star', () => {
    expect(layoutCluster(1, false)[0]).toEqual({ x: 0, y: GALAXY_DROP, row: 0, col: 0 });
  });

  it('keeps the people row clear of the focused star', () => {
    expect(layoutCluster(4, false)[0].y).toBeGreaterThan(layoutGalaxyFocus().y);
  });

  it('keeps a cluster of ten faces on one row', () => {
    const ys = layoutCluster(10, false).map((s) => s.y);
    expect(new Set(ys).size).toBe(1);
    expect(clusterRowCount(10)).toBe(1);
  });

  it('wraps the eleventh face onto a second row', () => {
    const slots = layoutCluster(11, false);
    expect(slots[10].y).toBe(slots[9].y + GALAXY_ROW_GAP);
    expect(clusterRowCount(11)).toBe(2);
  });

  it('never puts more than ten faces on any row', () => {
    const perRow = new Map<number, number>();
    for (const { y } of layoutCluster(34, false)) {
      perRow.set(y, (perRow.get(y) ?? 0) + 1);
    }
    expect(Math.max(...perRow.values())).toBeLessThanOrEqual(10);
    expect(perRow.size).toBe(clusterRowCount(34)); // 4 rows: 10/10/10/4
  });

  it('centers each row on its own occupancy, including a part-full last row', () => {
    // 23 people wrap 10 / 10 / 3. Every row's x-range must be symmetric about 0.
    const xs = layoutCluster(23, false).map((s) => s.x);
    for (const [from, to] of [[0, 9], [10, 19], [20, 22]]) {
      expect(xs[from] + xs[to]).toBeCloseTo(0);
    }
  });

  it('slides everything below the cluster down by each extra row', () => {
    // BAND_TOP and GALAXY_DROP describe the one-row case only; the band and the
    // last cluster row move together as the cluster wraps.
    expect(galaxyGeometry(10)).toEqual({
      rows: 1,
      bandTop: BAND_TOP,
      clusterBottom: GALAXY_DROP,
    });
    expect(galaxyGeometry(11)).toEqual({
      rows: 2,
      bandTop: BAND_TOP + GALAXY_ROW_GAP,
      clusterBottom: GALAXY_DROP + GALAXY_ROW_GAP,
    });
    expect(galaxyGeometry(21).bandTop).toBe(BAND_TOP + 2 * GALAXY_ROW_GAP);
  });
});

describe('layoutCluster: the trailing "more" orb', () => {
  it('trails the last face on a part-full row', () => {
    const slots = layoutCluster(3, true);
    expect(slots).toHaveLength(4);
    expect(slots[3].y).toBe(slots[2].y); // same row as the faces
    expect(slots[3].x).toBe(slots[2].x + GALAXY_PERSON_GAP);
  });

  it('takes an eleventh slot rather than a lonely row when the row is full', () => {
    const slots = layoutCluster(20, true);
    expect(slots).toHaveLength(21);
    // Row 2 is ten faces plus the orb: the orb stays ON that row, and the
    // composition is still two rows tall (the regression this fixes).
    expect(slots[20].y).toBe(slots[19].y);
    expect(slots[20].x).toBe(slots[19].x + GALAXY_PERSON_GAP);
    expect(clusterRowCount(20)).toBe(2);
    expect(new Set(slots.map((s) => s.y)).size).toBe(2);
  });

  it('centers the orb row counting the orb, so it does not lean left', () => {
    const slots = layoutCluster(20, true);
    const last = slots.slice(10); // ten faces + the orb
    expect(last[0].x + last[last.length - 1].x).toBeCloseTo(0);
    // The full row WITHOUT the orb stays centered on its own ten.
    expect(slots[0].x + slots[9].x).toBeCloseTo(0);
  });

  it('centers the orb alone when there are no faces left to trail', () => {
    expect(layoutCluster(0, true)).toEqual([{ x: 0, y: GALAXY_DROP, row: 0, col: 0 }]);
  });

  it('emits nothing extra when there is no more to load', () => {
    expect(layoutCluster(5, false)).toHaveLength(5);
  });

  it('carries each slot\'s grid cell, so the renderer never re-derives the wrap', () => {
    const slots = layoutCluster(12, true);
    expect(slots.map((s) => [s.row, s.col]).slice(0, 2)).toEqual([[0, 0], [0, 1]]);
    expect([slots[10].row, slots[10].col]).toEqual([1, 0]); // wrapped
    expect([slots[12].row, slots[12].col]).toEqual([1, 2]); // the trailing orb
  });
});

describe('personNodesFromRecords', () => {
  it('scopes ids to the company so the same person under two companies differs', () => {
    const recs = [record('ada-lovelace')];
    const a = personNodesFromRecords('c0', recs);
    const b = personNodesFromRecords('c2', recs);
    expect(a[0].id).toBe('c0:ada-lovelace');
    expect(b[0].id).toBe('c2:ada-lovelace');
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('builds raw Level 1 nodes carrying the parsed fields and column order', () => {
    const nodes = personNodesFromRecords('c1', [
      record('grace-hopper', {
        name: 'Grace Hopper',
        headline: 'Compiler Pioneer',
        location: 'Arlington',
        photoUrl: 'https://media.licdn.com/grace.jpg',
      }),
      record('alan-turing', { name: 'Alan Turing' }),
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === 'person' && n.level === 1)).toBe(true);
    expect(nodes.every((n) => n.status === 'raw')).toBe(true);
    expect(nodes.map((n) => n.parentId)).toEqual(['c1', 'c1']);
    expect(nodes.map((n) => n.order)).toEqual([0, 1]);
    expect(nodes[0].name).toBe('Grace Hopper');
    expect(nodes[0].photoUrl).toBe('https://media.licdn.com/grace.jpg');
    // Photo bytes are fetched later by the orchestrator, not here.
    expect(nodes[0].photoDataUrl).toBeUndefined();
    // M3 regression: fresh people carry no onward trajectory until traced.
    expect(nodes.every((n) => n.onward === undefined)).toBe(true);
  });
});

// --- M5: folding a second page of people into the ones already held ---

describe('mergePeople', () => {
  it('appends genuinely new people and re-indexes the whole row', () => {
    const page1 = personNodesFromRecords('c1', [record('a'), record('b')]);
    const page2 = personNodesFromRecords('c1', [record('c'), record('d')]);
    const merged = mergePeople(page1, page2);
    expect(merged.map((p) => p.vanity)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.map((p) => p.order)).toEqual([0, 1, 2, 3]);
  });

  it('keeps a traced person traced when the next page lists them again', () => {
    const [ada] = personNodesFromRecords('c1', [record('ada')]);
    const kept = [{ ...ada, status: 'traced' as const, onward: [], tracedAt: 7 }];
    // page 2 re-serves Ada as a fresh 'raw' record, plus someone new.
    const incoming = personNodesFromRecords('c1', [record('ada'), record('bob')]);
    const merged = mergePeople(kept, incoming);
    expect(merged).toHaveLength(2);
    expect(merged[0].status).toBe('traced');
    expect(merged[0].tracedAt).toBe(7);
    expect(merged[1].vanity).toBe('bob');
  });

  it('keeps a dismissed person dismissed', () => {
    const [x] = personNodesFromRecords('c1', [record('x')]);
    const merged = mergePeople(
      [{ ...x, status: 'dismissed' as const }],
      personNodesFromRecords('c1', [record('x')]),
    );
    expect(merged.map((p) => p.status)).toEqual(['dismissed']);
  });

  it('is idempotent: merging the same page twice adds nobody', () => {
    const page1 = personNodesFromRecords('c1', [record('a')]);
    const page2 = personNodesFromRecords('c1', [record('b')]);
    const once = mergePeople(page1, page2);
    expect(mergePeople(once, page2)).toEqual(once);
  });

  it('dedups within a single incoming page', () => {
    const merged = mergePeople(
      [],
      personNodesFromRecords('c1', [record('a'), record('a'), record('b')]),
    );
    expect(merged.map((p) => p.vanity)).toEqual(['a', 'b']);
  });

  it('scopes dedup to the company, so the same human under two is two nodes', () => {
    const merged = mergePeople(
      personNodesFromRecords('c1', [record('a')]),
      personNodesFromRecords('c2', [record('a')]),
    );
    expect(merged.map((p) => p.id)).toEqual(['c1:a', 'c2:a']);
  });
});

// --- M3: deriveOnward + swimlane layout ---

function company(
  name: string,
  start: DateParts,
  opts: Partial<GraphNode> = {},
): GraphNode {
  return {
    id: opts.id ?? 'c0',
    kind: 'company',
    level: 0,
    order: opts.order ?? 0,
    name,
    companyUrl: opts.companyUrl,
    companyUrn: opts.companyUrn,
    logoDataUrl: opts.logoDataUrl,
    start,
    end: opts.end ?? null,
    rawDateText: opts.rawDateText ?? '',
    roleCount: opts.roleCount ?? 1,
  };
}

describe('deriveOnward', () => {
  it('anchors on the shared company by URN and returns later stints', () => {
    const focus = company('Escale', { year: 2017 }, { companyUrn: 'urn:escale' });
    const { matched, onward } = deriveOnward(focus, [
      entry('Escale', { year: 2017 }, { year: 2020 }, { companyUrn: 'urn:escale' }),
      entry('Nubank', { year: 2020, month: 3 }, null, { companyUrn: 'urn:nubank' }),
    ]);
    expect(matched).toBe(true);
    expect(onward.map((o) => o.companyName)).toEqual(['Nubank']);
  });

  it('falls back to normalized name when a URN is missing on either side', () => {
    // Styling drift + no URN on the colleague side: match on name regardless.
    const focus = company('Escale', { year: 2017 }, { companyUrn: 'urn:escale' });
    const { matched, onward } = deriveOnward(focus, [
      entry('  ESCALE · Full-time ', { year: 2017 }, { year: 2019 }),
      entry('Loft', { year: 2019, month: 6 }, null),
    ]);
    expect(matched).toBe(true);
    expect(onward.map((o) => o.companyName)).toEqual(['Loft']);
  });

  it('anchors a boomerang on the EARLIEST matching stint', () => {
    // Colleague worked at Acme twice; the earliest end (2017) is the cut point,
    // so Detour (2017) and everything later counts; the second Acme stint is
    // excluded as the shared company itself.
    const focus = company('Acme', { year: 2015 }, { companyUrn: 'urn:acme' });
    const { matched, onward } = deriveOnward(focus, [
      entry('Acme', { year: 2015 }, { year: 2017 }, { companyUrn: 'urn:acme' }),
      entry('Detour', { year: 2018 }, { year: 2019 }),
      entry('Acme', { year: 2020 }, null, { companyUrn: 'urn:acme' }),
    ]);
    expect(matched).toBe(true);
    expect(onward.map((o) => o.companyName)).toEqual(['Detour']);
  });

  it('drops earlier-overlapping side roles, keeps on-or-after employers', () => {
    const focus = company('Core', { year: 2018, month: 1 }, { companyUrn: 'urn:core' });
    const { onward } = deriveOnward(focus, [
      entry('Core', { year: 2018, month: 1 }, { year: 2021, month: 6 }, {
        companyUrn: 'urn:core',
      }),
      // Side gig that started before they left Core (overlap) — dropped.
      entry('Sideproject', { year: 2020 }, { year: 2022 }),
      // True next employer — kept.
      entry('Next', { year: 2021, month: 9 }, null),
    ]);
    expect(onward.map((o) => o.companyName)).toEqual(['Next']);
  });

  it('keeps a job that starts the SAME month they left (seamless move)', () => {
    const focus = company('Anchor', { year: 2018, month: 1 }, { companyUrn: 'urn:anchor' });
    const { onward } = deriveOnward(focus, [
      entry('Anchor', { year: 2018, month: 1 }, { year: 2020, month: 12 }, {
        companyUrn: 'urn:anchor',
      }),
      // Started the exact month they left Anchor — a seamless next move, counts.
      entry('Seamless', { year: 2020, month: 12 }, null),
    ]);
    expect(onward.map((o) => o.companyName)).toEqual(['Seamless']);
  });

  it('treats Present-at-company as terminal (matched, empty onward)', () => {
    const focus = company('Stay', { year: 2019 }, { companyUrn: 'urn:stay' });
    const { matched, onward } = deriveOnward(focus, [
      entry('Stay', { year: 2019 }, null, { companyUrn: 'urn:stay' }),
    ]);
    expect(matched).toBe(true);
    expect(onward).toEqual([]);
  });

  it('returns matched:false when the profile never lists the company', () => {
    const focus = company('Escale', { year: 2017 }, { companyUrn: 'urn:escale' });
    const { matched, onward } = deriveOnward(focus, [
      entry('Somewhere Else', { year: 2017 }, null),
    ]);
    expect(matched).toBe(false);
    expect(onward).toEqual([]);
  });

  it('sorts onward stints ascending by start (deterministic)', () => {
    const focus = company('Base', { year: 2010 }, { companyUrn: 'urn:base' });
    const { onward } = deriveOnward(focus, [
      entry('Base', { year: 2010 }, { year: 2012 }, { companyUrn: 'urn:base' }),
      entry('Later', { year: 2018 }, null),
      entry('Middle', { year: 2014, month: 2 }, { year: 2018 }),
      entry('First', { year: 2012, month: 5 }, { year: 2014 }),
    ]);
    expect(onward.map((o) => o.companyName)).toEqual(['First', 'Middle', 'Later']);
  });
});

function personWithOnward(
  id: string,
  onward: OnwardStint[],
): PersonNode {
  return {
    id,
    kind: 'person',
    level: 1,
    parentId: 'c0',
    vanity: id,
    profileUrl: `https://www.linkedin.com/in/${id}/`,
    name: id,
    status: 'traced',
    onward,
    order: 0,
  };
}

function stint(name: string, start: DateParts, opts: Partial<OnwardStint> = {}): OnwardStint {
  return {
    companyName: name,
    companyUrn: opts.companyUrn,
    start,
    end: opts.end ?? null,
    ...opts,
  };
}

describe('swimlaneX', () => {
  const min: DateParts = { year: 2017 };
  const max: DateParts = { year: 2027 }; // 10-year span

  it('places the range start at the axis left edge', () => {
    expect(swimlaneX(min, min, max)).toBeCloseTo(AXIS_LEFT);
  });

  it('places the range end at the axis right edge', () => {
    expect(swimlaneX(max, min, max)).toBeCloseTo(AXIS_LEFT + AXIS_WIDTH);
  });

  it('maps the midpoint to the axis center', () => {
    expect(swimlaneX({ year: 2022 }, min, max)).toBeCloseTo(AXIS_LEFT + AXIS_WIDTH / 2);
  });

  it('clamps dates outside the fixed range to the edges', () => {
    expect(swimlaneX({ year: 2010 }, min, max)).toBeCloseTo(AXIS_LEFT);
    expect(swimlaneX({ year: 2040 }, min, max)).toBeCloseTo(AXIS_LEFT + AXIS_WIDTH);
  });
});

describe('layoutSwimlanes', () => {
  const focus = company('Hub', { year: 2017 }, { companyUrn: 'urn:hub' });
  const now: DateParts = { year: 2027 };

  it('stacks one lane per colleague in click order, appended downward', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [stint('A', { year: 2020 })]),
        personWithOnward('p1', [stint('B', { year: 2021 })]),
      ],
      now,
      BAND_TOP,
    );
    expect(out.lanes.map((l) => l.laneIndex)).toEqual([0, 1]);
    expect(out.lanes[0].faceY).toBe(BAND_TOP);
    expect(out.lanes[1].faceY).toBe(BAND_TOP + LANE_GAP);
    expect(out.lanes.every((l) => l.faceX === AXIS_LEFT - FACE_GUTTER)).toBe(true);
  });

  it('keeps the face clear of a first stint that starts before the axis does', () => {
    // A colleague who left while you were still at the focus company: the stint
    // clamps to the axis start, which is where the face used to sit.
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('Early', { year: 2016 })])],
      now,
      BAND_TOP,
    );
    const lane = out.lanes[0];
    expect(lane.leaves[0].x - lane.faceX).toBeGreaterThanOrEqual(FACE_GUTTER - 0.001);
  });

  it('keeps the face clear of a bunch of stints that all clamp to the axis start', () => {
    // Re-centering pulls the first of a colliding run left; it must not drift
    // into the gutter.
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('One', { year: 2015 }),
          stint('Two', { year: 2016 }),
          stint('Three', { year: 2017 }),
        ]),
      ],
      now,
      BAND_TOP,
    );
    const lane = out.lanes[0];
    expect(lane.leaves[0].x).toBeGreaterThanOrEqual(AXIS_LEFT - 0.001);
    expect(lane.leaves[0].x - lane.faceX).toBeGreaterThanOrEqual(FACE_GUTTER - 0.001);
  });

  it('keeps the face clear of a stint a couple of months after the focus start', () => {
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('Soon', { year: 2017, month: 3 })])],
      now,
      BAND_TOP,
    );
    const lane = out.lanes[0];
    expect(lane.leaves[0].x - lane.faceX).toBeGreaterThanOrEqual(FACE_GUTTER - 0.001);
  });

  it('positions leaves at their true date x on the lane row', () => {
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('Mid', { year: 2022 })])],
      now,
      BAND_TOP,
    );
    const leaf = out.lanes[0].leaves[0];
    expect(leaf.x).toBeCloseTo(AXIS_LEFT + AXIS_WIDTH / 2);
    expect(leaf.y).toBe(BAND_TOP);
  });

  it('flags a company reached by ≥2 colleagues as a convergence group', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [stint('Nubank', { year: 2020 }, { companyUrn: 'urn:nubank' })]),
        personWithOnward('p1', [
          stint('Detour', { year: 2021 }),
          stint('Nubank', { year: 2023 }, { companyUrn: 'urn:nubank' }),
        ]),
      ],
      now,
      BAND_TOP,
    );
    expect(out.convergences).toHaveLength(1);
    expect(out.convergences[0].key).toBe('urn:nubank');
    expect(out.convergences[0].members).toHaveLength(2);
    // Both Nubank leaves flagged; the lone Detour leaf is not.
    const nubankLeaves = out.lanes.flatMap((l) =>
      l.leaves.filter((leaf) => leaf.stint.companyName === 'Nubank'),
    );
    expect(nubankLeaves.every((leaf) => leaf.convergent)).toBe(true);
    const detour = out.lanes[1].leaves.find((leaf) => leaf.stint.companyName === 'Detour');
    expect(detour?.convergent).toBe(false);
  });

  it('does not converge a company that appears in only one lane', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('Solo', { year: 2020 }),
          stint('Solo', { year: 2022 }), // same name, same lane → not a convergence
        ]),
      ],
      now,
      BAND_TOP,
    );
    expect(out.convergences).toEqual([]);
  });

  it('leaves a well-spaced lane exactly where the dates put it', () => {
    // A 10-year axis at 920px: five years apart is ~460px, far past the gap.
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('A', { year: 2019 }), stint('B', { year: 2024 })])],
      now,
      BAND_TOP,
    );
    const [a, b] = out.lanes[0].leaves;
    expect(a.x).toBeCloseTo(swimlaneX({ year: 2019 }, { year: 2017 }, now));
    expect(b.x).toBeCloseTo(swimlaneX({ year: 2024 }, { year: 2017 }, now));
  });

  it('pushes leaves apart to MIN_LEAF_GAP when their dates are close', () => {
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('RNP', { year: 2018 }), stint('UFPA', { year: 2019 })])],
      now,
      BAND_TOP,
    );
    const [a, b] = out.lanes[0].leaves;
    expect(b.x - a.x).toBeCloseTo(MIN_LEAF_GAP);
  });

  it('splits the drift both ways around the run instead of shoving it right', () => {
    const min: DateParts = { year: 2017 };
    const trueA = swimlaneX({ year: 2018 }, min, now);
    const trueB = swimlaneX({ year: 2019 }, min, now);
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('RNP', { year: 2018 }), stint('UFPA', { year: 2019 })])],
      now,
      BAND_TOP,
    );
    const [a, b] = out.lanes[0].leaves;
    expect(a.x).toBeLessThan(trueA);
    expect(b.x).toBeGreaterThan(trueB);
    // The run keeps its original midpoint.
    expect((a.x + b.x) / 2).toBeCloseTo((trueA + trueB) / 2);
  });

  it('separates consecutive months, the worst case', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('One', { year: 2021, month: 1 }),
          stint('Two', { year: 2021, month: 2 }),
          stint('Three', { year: 2021, month: 3 }),
        ]),
      ],
      now,
      BAND_TOP,
    );
    const xs = out.lanes[0].leaves.map((l) => l.x);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(MIN_LEAF_GAP - 0.001);
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(MIN_LEAF_GAP - 0.001);
  });

  it('keeps a pushed lane inside the axis rather than past the today line', () => {
    // Three stints bunched at the far right would otherwise overflow the axis.
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('One', { year: 2026, month: 10 }),
          stint('Two', { year: 2026, month: 11 }),
          stint('Three', { year: 2026, month: 12 }),
        ]),
      ],
      now,
      BAND_TOP,
    );
    const xs = out.lanes[0].leaves.map((l) => l.x);
    expect(xs[xs.length - 1]).toBeLessThanOrEqual(AXIS_LEFT + AXIS_WIDTH + 0.001);
    expect(xs[0]).toBeGreaterThanOrEqual(AXIS_LEFT - 0.001);
  });

  it('reports the nudged x in the convergence group, not the raw date x', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('Near', { year: 2020 }),
          stint('Nubank', { year: 2020, month: 6 }, { companyUrn: 'urn:nubank' }),
        ]),
        personWithOnward('p1', [stint('Nubank', { year: 2023 }, { companyUrn: 'urn:nubank' })]),
      ],
      now,
      BAND_TOP,
    );
    const member = out.convergences[0].members.find((m) => m.laneIndex === 0);
    expect(member?.x).toBeCloseTo(out.lanes[0].leaves[1].x);
  });

  it('keys convergence by normalized name when no URN is present', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [stint('Loft', { year: 2020 })]),
        personWithOnward('p1', [stint('  loft  ', { year: 2022 })]),
      ],
      now,
      BAND_TOP,
    );
    expect(out.convergences).toHaveLength(1);
    expect(out.convergences[0].key).toBe('loft');
  });

  it('flags reachesNow for the last leaf even once it already ended', () => {
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('Mercado Livre', { year: 2021 }, { end: { year: 2022, month: 4 } }),
          stint('Faire', { year: 2022 }, { end: { year: 2026, month: 6 } }),
        ]),
      ],
      now,
      BAND_TOP,
    );
    const leaves = out.lanes[0].leaves;
    expect(leaves[0].reachesNow).toBe(false);
    expect(leaves[1].reachesNow).toBe(true);
  });

  it('flags reachesNow for a leaf that is genuinely still Present', () => {
    const out = layoutSwimlanes(
      focus,
      [personWithOnward('p0', [stint('Faire', { year: 2022 })])],
      now,
      BAND_TOP,
    );
    expect(out.lanes[0].leaves[0].reachesNow).toBe(true);
  });

  it('flags reachesNow for a still-Present stint even when a later, already-ended stint follows it', () => {
    // An overlapping side stint: still there at "Early" while "Later" (which
    // started after) has already wrapped up. Both should reach now: "Early"
    // because it's genuinely current, "Later" because it's the lane's last leaf.
    const out = layoutSwimlanes(
      focus,
      [
        personWithOnward('p0', [
          stint('Early', { year: 2020 }),
          stint('Later', { year: 2021 }, { end: { year: 2022 } }),
        ]),
      ],
      now,
      BAND_TOP,
    );
    const leaves = out.lanes[0].leaves;
    expect(leaves[0].reachesNow).toBe(true);
    expect(leaves[1].reachesNow).toBe(true);
  });
});
