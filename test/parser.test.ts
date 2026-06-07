import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { injectedScrapeExperience } from '../src/parser';
import type { ExperienceEntry } from '../src/types';

// A real, sanitized snapshot of the author's own details/experience page,
// captured via Claude-in-Chrome. Classes and tracking query strings are
// stripped; the computed font-weight of each <p> is baked inline so the bold
// heading signal survives offline in jsdom (the parser reads getComputedStyle).
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'experience.html'), 'utf-8');

function byCompany(entries: ExperienceEntry[], name: string): ExperienceEntry {
  const e = entries.find((x) => x.companyName === name);
  if (!e) throw new Error(`No entry for ${name}`);
  return e;
}

describe('injectedScrapeExperience', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it('finds every top-level experience card (and skips the header/dividers)', async () => {
    const entries = await injectedScrapeExperience(1000);
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.companyName).sort()).toEqual([
      'Acception Tecnologia',
      'Engine',
      'Escale Digital',
      'Latitud',
      'Monarch Money',
      'iFood',
    ]);
  });

  it('parses a single-role card with a "Present" end', async () => {
    const monarch = byCompany(await injectedScrapeExperience(1000), 'Monarch Money');
    expect(monarch.roles).toHaveLength(1);
    expect(monarch.roles[0].title).toBe('Senior Software Engineer');
    expect(monarch.start).toEqual({ year: 2025, month: 8 });
    expect(monarch.end).toBeNull();
    expect(monarch.companyUrl).toBe('https://www.linkedin.com/company/18984131/');
    expect(monarch.companyUrn).toBe('urn:li:company:18984131');
    expect(monarch.logoUrl).toBe('https://media.licdn.com/logo.png');
  });

  it('parses a single-role card with closed (non-Present) dates', async () => {
    const ifood = byCompany(await injectedScrapeExperience(1000), 'iFood');
    expect(ifood.roles).toHaveLength(1);
    expect(ifood.start).toEqual({ year: 2020, month: 12 });
    expect(ifood.end).toEqual({ year: 2021, month: 10 });
    expect(ifood.companyUrn).toBe('urn:li:company:247645');
  });

  it('collapses a grouped card into one entry with aggregate tenure', async () => {
    const escale = byCompany(await injectedScrapeExperience(1000), 'Escale Digital');
    expect(escale.roles.map((r) => r.title)).toEqual([
      'Senior Software Engineer',
      'Software Engineer',
    ]);
    // Aggregate: earliest start, latest end across the nested roles.
    expect(escale.start).toEqual({ year: 2018, month: 10 });
    expect(escale.end).toEqual({ year: 2020, month: 12 });
    expect(escale.companyUrn).toBe('urn:li:company:3051496');
  });

  it('skips employment-type lines between a role title and its date', async () => {
    // Acception's roles render an extra "Full-time" / "Internship" line; the
    // parser must still pair each title with the *next* date line.
    const acception = byCompany(
      await injectedScrapeExperience(1000),
      'Acception Tecnologia',
    );
    expect(acception.roles).toHaveLength(2);
    expect(acception.roles[0].title).toBe('Junior Software Developer');
    expect(acception.roles[0].start).toEqual({ year: 2017, month: 8 });
    expect(acception.roles[0].end).toEqual({ year: 2018, month: 9 });
    expect(acception.roles[1].title).toBe('Intern');
    expect(acception.start).toEqual({ year: 2016, month: 4 });
    expect(acception.end).toEqual({ year: 2018, month: 9 });
  });

  it('parses a grouped card whose company is unlinked (no company URL)', async () => {
    const latitud = byCompany(await injectedScrapeExperience(1000), 'Latitud');
    expect(latitud.roles).toHaveLength(2);
    expect(latitud.companyUrl).toBeUndefined();
    expect(latitud.companyUrn).toBeUndefined();
    // Aggregate across "Apr 2022 - May 2024" and "Oct 2021 - Apr 2022".
    expect(latitud.start).toEqual({ year: 2021, month: 10 });
    expect(latitud.end).toEqual({ year: 2024, month: 5 });
  });

  it('orders nothing itself — returns DOM order (UI sorts chronologically)', async () => {
    const entries = await injectedScrapeExperience(1000);
    expect(entries[0].companyName).toBe('Monarch Money');
  });

  it('returns an empty array when the list is absent (no throw)', async () => {
    document.body.innerHTML = '<main></main>';
    const entries = await injectedScrapeExperience(300);
    expect(entries).toEqual([]);
  });

  it('ignores a trailing bold "skills" line on a single-role card', async () => {
    // Regression: LinkedIn renders a bold skills summary at the bottom of a card
    // ("JavaScript, React.js and +2 skills"). It must not be counted as a second
    // role title (which would flip the single-role card into a grouped one and
    // drop the whole job). The fix keys on "a date line follows the bold line".
    document.body.innerHTML = `
      <main><section>
        <div>
          <a href="/company/14048993/">Cayena</a>
          <img src="https://media.licdn.com/logo.png" />
          <p style="font-weight: 600">Staff Software Engineer</p>
          <p>Cayena · Full-time</p>
          <p>Oct 2025 - Present · 9 mos</p>
          <p>São Paulo, Brazil · Remote</p>
          <p>Cayena is a B2B marketplace.</p>
          <p style="font-weight: 600">JavaScript, React.js and +2 skills</p>
        </div>
        <div>
          <a href="/company/247645/">iFood</a>
          <img src="https://media.licdn.com/logo.png" />
          <p style="font-weight: 600">Software Engineer</p>
          <p>iFood · Full-time</p>
          <p>Dec 2020 - Oct 2021 · 11 mos</p>
        </div>
      </section></main>`;
    const entries = await injectedScrapeExperience(1000);
    const cayena = byCompany(entries, 'Cayena');
    expect(cayena.roles).toHaveLength(1);
    expect(cayena.roles[0].title).toBe('Staff Software Engineer');
    expect(cayena.start).toEqual({ year: 2025, month: 10 });
    expect(cayena.end).toBeNull();
    expect(cayena.companyUrn).toBe('urn:li:company:14048993');
  });
});
