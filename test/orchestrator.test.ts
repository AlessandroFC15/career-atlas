import { describe, expect, it } from 'vitest';
import { peopleSearchUrl } from '../src/orchestrator';

describe('peopleSearchUrl', () => {
  it('builds the first-degree search and leaves page 1 off the URL', () => {
    const url = peopleSearchUrl('Acme Corp');
    expect(url).toContain('keywords=Acme%20Corp');
    expect(url).toContain('network=%5B%22F%22%5D');
    expect(url).not.toContain('page=');
  });

  it('adds LinkedIn’s 1-based page parameter from page 2 on', () => {
    expect(peopleSearchUrl('Acme', 2)).toContain('&page=2');
    expect(peopleSearchUrl('Acme', 7)).toContain('&page=7');
  });

  it('escapes a keyword that would otherwise break the query string', () => {
    expect(peopleSearchUrl('R&D / Ops', 2)).toContain('keywords=R%26D%20%2F%20Ops');
  });
});
