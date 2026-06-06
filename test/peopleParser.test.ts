import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { injectedScrapePeople } from '../src/peopleParser';
import type { PersonRecord } from '../src/types';

// A synthetic first-degree people-search page, reconstructed from the live 2026
// DOM (see fixtures/people.html). No real PII; structure is faithful so the
// degree-badge anchor, vanity normalization, dedup, and noise exclusion are all
// exercised offline in jsdom.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'people.html'), 'utf-8');

function byVanity(records: PersonRecord[], vanity: string): PersonRecord {
  const r = records.find((x) => x.vanity === vanity);
  if (!r) throw new Error(`No record for ${vanity}`);
  return r;
}

describe('injectedScrapePeople', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it('parses exactly the real result cards, excluding facepile + sidebar links', async () => {
    const records = await injectedScrapePeople(1000);
    expect(records.map((r) => r.vanity).sort()).toEqual([
      'ada-lovelace',
      'alan-turing',
      'grace-hopper',
      'margaret-hamilton',
    ]);
    // The mutual-connections facepile and "people also viewed" sidebar carry no
    // degree badge, so their /in/ links must not appear.
    const vanities = records.map((r) => r.vanity);
    expect(vanities).not.toContain('george-boole');
    expect(vanities).not.toContain('claude-shannon');
    expect(vanities).not.toContain('john-von-neumann');
  });

  it('extracts name, headline, location and photo from a full card', async () => {
    const ada = byVanity(await injectedScrapePeople(1000), 'ada-lovelace');
    expect(ada.name).toBe('Ada Lovelace');
    expect(ada.headline).toBe('Engineering Lead at Beacon');
    expect(ada.location).toBe('London, England, United Kingdom');
    expect(ada.photoUrl).toBe('https://media.licdn.com/dms/image/ada-lovelace.jpg');
    expect(ada.profileUrl).toBe('https://www.linkedin.com/in/ada-lovelace/');
  });

  it('drops the "Current:", mutual-connections and action lines from the headline/location', async () => {
    const ada = byVanity(await injectedScrapePeople(1000), 'ada-lovelace');
    expect(ada.headline).not.toMatch(/current/i);
    expect(ada.headline).not.toMatch(/mutual/i);
    expect(ada.location).not.toMatch(/message|mutual/i);
  });

  it('normalizes a locale-suffixed profile URL to the bare vanity', async () => {
    // href was /in/grace-hopper/en/?miniProfileUrn=abc
    const grace = byVanity(await injectedScrapePeople(1000), 'grace-hopper');
    expect(grace.profileUrl).toBe('https://www.linkedin.com/in/grace-hopper/');
    expect(grace.headline).toBe('Compiler Pioneer at Univac');
  });

  it('leaves photoUrl undefined when only a ghost placeholder is present', async () => {
    const alan = byVanity(await injectedScrapePeople(1000), 'alan-turing');
    expect(alan.photoUrl).toBeUndefined();
    expect(alan.headline).toBe('Cryptanalyst at Bletchley');
  });

  it('tolerates a missing location line', async () => {
    const margaret = byVanity(await injectedScrapePeople(1000), 'margaret-hamilton');
    expect(margaret.headline).toBe('Director of Software Engineering at Apollo');
    expect(margaret.location).toBeUndefined();
  });

  it('dedupes the doubled a11y name echo (one record per person)', async () => {
    const records = await injectedScrapePeople(1000);
    expect(records.filter((r) => r.vanity === 'ada-lovelace')).toHaveLength(1);
  });

  it('returns an empty array when there are no result cards (no throw)', async () => {
    document.body.innerHTML = '<main></main>';
    const records = await injectedScrapePeople(300);
    expect(records).toEqual([]);
  });
});
