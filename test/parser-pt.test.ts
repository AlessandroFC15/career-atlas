import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { injectedScrapeExperience } from '../src/parser';
import type { ExperienceEntry } from '../src/types';

// Real Brazilian-Portuguese details/experience markup, live-captured via
// Claude-in-Chrome (issue #13 — see fixtures/experience-pt.html). Exercises
// the "de"-joined date format, PT-BR month abbreviations that differ from
// their English ones, and the "o momento" ongoing-role marker.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'experience-pt.html'), 'utf-8');

function byCompany(entries: ExperienceEntry[], name: string): ExperienceEntry {
  const e = entries.find((x) => x.companyName === name);
  if (!e) throw new Error(`No entry for ${name}`);
  return e;
}

describe('injectedScrapeExperience (PT-BR)', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it('finds every top-level card in the PT-BR markup', async () => {
    const entries = await injectedScrapeExperience(1000);
    expect(entries.map((e) => e.companyName).sort()).toEqual([
      'Acception Tecnologia',
      'Engine',
      'Latitud',
      'Monarch Money',
    ]);
  });

  it('parses "ago de 2025 - o momento" as an ongoing role', async () => {
    const monarch = byCompany(await injectedScrapeExperience(1000), 'Monarch Money');
    expect(monarch.start).toEqual({ year: 2025, month: 8 });
    expect(monarch.end).toBeNull();
  });

  it('parses "jun de 2024 - ago de 2025" as closed dates', async () => {
    const engine = byCompany(await injectedScrapeExperience(1000), 'Engine');
    expect(engine.start).toEqual({ year: 2024, month: 6 });
    expect(engine.end).toEqual({ year: 2025, month: 8 });
  });

  it('parses PT-BR month abbreviations that differ from English ("abr"/"mai")', async () => {
    const latitud = byCompany(await injectedScrapeExperience(1000), 'Latitud');
    expect(latitud.roles).toHaveLength(2);
    // Aggregate: earliest start ("out de 2021"), latest end ("mai de 2024").
    expect(latitud.start).toEqual({ year: 2021, month: 10 });
    expect(latitud.end).toEqual({ year: 2024, month: 5 });
  });

  it('skips a "Tempo integral"/"Estágio" employment-type line between title and date', async () => {
    const acception = byCompany(
      await injectedScrapeExperience(1000),
      'Acception Tecnologia',
    );
    expect(acception.roles).toHaveLength(2);
    expect(acception.roles[0].title).toBe('Junior Software Developer');
    // "ago de 2017 - set de 2018": PT-BR "ago"/"set" differ from EN "aug"/"sep".
    expect(acception.roles[0].start).toEqual({ year: 2017, month: 8 });
    expect(acception.roles[0].end).toEqual({ year: 2018, month: 9 });
    expect(acception.roles[1].title).toBe('Intern');
  });
});
