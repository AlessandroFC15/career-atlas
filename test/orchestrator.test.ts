import { afterEach, describe, expect, it } from 'vitest';
import { injectedCheckSupportedLocale, peopleSearchUrl } from '../src/orchestrator';

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

// Issue #13: the parsers understand English and Portuguese markup, but LinkedIn's
// UI language is an account setting with no per-request URL override for a
// signed-in session, so any other language is caught with a loud, clear error
// instead of silently parsing nothing.
describe('injectedCheckSupportedLocale', () => {
  const original = document.documentElement.lang;
  afterEach(() => {
    document.documentElement.lang = original;
  });

  it('passes when the page declares English', () => {
    document.documentElement.lang = 'en';
    expect(injectedCheckSupportedLocale()).toBe(true);
    document.documentElement.lang = 'en-US';
    expect(injectedCheckSupportedLocale()).toBe(true);
  });

  it('passes when the page declares Portuguese', () => {
    document.documentElement.lang = 'pt';
    expect(injectedCheckSupportedLocale()).toBe(true);
    document.documentElement.lang = 'pt-BR';
    expect(injectedCheckSupportedLocale()).toBe(true);
  });

  it('passes when the page declares no lang at all (permissive)', () => {
    document.documentElement.lang = '';
    expect(injectedCheckSupportedLocale()).toBe(true);
  });

  it('fails when the page declares an unsupported lang', () => {
    document.documentElement.lang = 'fr';
    expect(injectedCheckSupportedLocale()).toBe(false);
  });
});
