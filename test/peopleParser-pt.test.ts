import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { injectedScrapePeople } from '../src/peopleParser';
import type { PersonRecord } from '../src/types';

// Synthetic Brazilian-Portuguese first-degree people-search results, carrying
// real PT-BR strings live-verified via Claude-in-Chrome (issue #13 — see
// fixtures/people-pt.html). Exercises the "°" degree badge, "Mensagem"
// action, "Atual:"/"Anterior:" summary prefix, and "conexões em comum"
// mutual-connections line.
const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'people-pt.html'), 'utf-8');

function byVanity(records: PersonRecord[], vanity: string): PersonRecord {
  const r = records.find((x) => x.vanity === vanity);
  if (!r) throw new Error(`No record for ${vanity}`);
  return r;
}

describe('injectedScrapePeople (PT-BR)', () => {
  beforeEach(() => {
    document.body.innerHTML = fixture;
  });

  it('finds every real result card via the "°" degree badge', async () => {
    const records = await injectedScrapePeople(1000);
    expect(records.map((r) => r.vanity).sort()).toEqual([
      'bertha-lutz',
      'cesar-lattes',
      'oswaldo-cruz',
      'santos-dumont',
    ]);
  });

  it('drops the "Atual:", mutual-connections and "Mensagem" lines from the headline', async () => {
    const bertha = byVanity(await injectedScrapePeople(1000), 'bertha-lutz');
    expect(bertha.headline).toBe('Líder de Engenharia na Beacon');
    expect(bertha.location).toBe('Londres, Inglaterra, Reino Unido');
    expect(bertha.headline).not.toMatch(/atual/i);
    expect(bertha.headline).not.toMatch(/comum/i);
    expect(bertha.location).not.toMatch(/mensagem|comum/i);
  });

  it('normalizes a locale-suffixed profile URL (/in/oswaldo-cruz/pt/)', async () => {
    const oswaldo = byVanity(await injectedScrapePeople(1000), 'oswaldo-cruz');
    expect(oswaldo.profileUrl).toBe('https://www.linkedin.com/in/oswaldo-cruz/');
    expect(oswaldo.headline).toBe('Pioneiro em Saúde Pública na Univac');
  });
});
