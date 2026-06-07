import { injectedReadProfileHeader } from './profileReader';
import { injectedScrapeExperience } from './parser';
import { injectedScrapePeople } from './peopleParser';
import { fetchAsDataUrl } from './images';
import { deriveGraph, personNodesFromRecords } from './graph';
import { saveExpansion, saveGraph, saveSeed } from './storage';
import type {
  CompanyExpansion,
  ExperienceEntry,
  GraphNode,
  ProfileHeader,
  Seed,
} from './types';

// Error variants mirror m0-plan §11. The worker tab is kept open on every
// error (so the user sees the real page) and closed only on success.
export type SeedErrorCode =
  | 'LOGGED_OUT' // A
  | 'PARSE_NOT_READY' // B
  | 'EMPTY' // C
  | 'GENERIC'; // D

export class SeedError extends Error {
  constructor(
    public code: SeedErrorCode,
    message: string,
    public workerTabId?: number,
  ) {
    super(message);
    this.name = 'SeedError';
  }
}

const ME_URL = 'https://www.linkedin.com/in/me/';
const NAV_TIMEOUT = 30000;

/** Resolve when the tab finishes loading (optionally matching a URL fragment). */
function waitForLoad(
  tabId: number,
  opts: { urlIncludes?: string; timeoutMs?: number } = {},
): Promise<chrome.tabs.Tab> {
  const { urlIncludes, timeoutMs = NAV_TIMEOUT } = opts;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new SeedError('GENERIC', 'Timed out waiting for the page to load', tabId));
    }, timeoutMs);
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        if (urlIncludes && !(tab.url || '').includes(urlIncludes)) return;
        cleanup();
        resolve(tab);
      });
    };
    const onRemoved = (id: number) => {
      if (id !== tabId) return;
      cleanup();
      reject(new SeedError('GENERIC', 'The worker tab was closed', tabId));
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

function isLoggedOutUrl(url: string | undefined): boolean {
  return /\/(authwall|login|signup|checkpoint)|uas\/login/i.test(url || '');
}

/** Normalize the resolved /in/me URL to canonical `https://.../in/<vanity>/`. */
function canonicalProfileUrl(resolved: string): string {
  const base = resolved.split('?')[0].split('#')[0];
  return base.endsWith('/') ? base : base + '/';
}

async function injectFunc<A extends unknown[], R>(
  tabId: number,
  func: (...args: A) => R,
  args: A,
): Promise<Awaited<R>> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: func as (...a: unknown[]) => unknown,
    args,
  });
  return result?.result as Awaited<R>;
}

/**
 * A structured progress event for the seed reveal (seed-reveal-plan §5). The
 * phase strings are stable identifiers, not display copy: the human text lives
 * in the view's PHASE_TEXT map, so wording changes never touch orchestration.
 * `companyCount` rides along once parsing returns so the view knows how many
 * dim stars to bloom (never rendered as a number). `logo-cached` fires once per
 * image as it *settles* (resolved or failed), so a logo-less company still ticks.
 */
export type SeedProgress =
  | { phase: 'opening-profile' }
  | { phase: 'reading-header' }
  | { phase: 'opening-experience' }
  | { phase: 'reading-experience'; companyCount?: number }
  | { phase: 'caching'; companyCount: number }
  | { phase: 'logo-cached' };

/**
 * Fetch + cache the avatar and every company logo as data URLs (§8). Emits one
 * `onSettle` tick per image as it settles (the avatar first, so the view can
 * route that one to the "you" star; then each logo). fetchAsDataUrl never
 * rejects, so every settle reliably ticks even for a missing/free-text logo.
 */
async function cacheImages(
  header: ProfileHeader,
  experiences: ExperienceEntry[],
  onSettle: () => void = () => {},
): Promise<{ avatarDataUrl?: string; experiences: ExperienceEntry[] }> {
  const avatarDataUrl = await fetchAsDataUrl(header.avatarUrl);
  onSettle();
  const withLogos = await Promise.all(
    experiences.map(async (e) => {
      const logoDataUrl = await fetchAsDataUrl(e.logoUrl);
      onSettle();
      return { ...e, logoDataUrl };
    }),
  );
  return { avatarDataUrl, experiences: withLogos };
}

export interface SeedRunHooks {
  onProgress?: (progress: SeedProgress) => void;
}

/**
 * The full seed sequence (m0-plan §6), run from the home page when the user
 * clicks "Seed my graph". Returns the persisted Seed on success; throws a
 * SeedError (with the worker tab id) on any failure path.
 */
export async function runSeed(hooks: SeedRunHooks = {}): Promise<Seed> {
  const progress = hooks.onProgress ?? (() => {});
  let workerTabId: number | undefined;

  try {
    // 1. Open the worker tab on /in/me in the BACKGROUND (active: false) so the
    // home tab keeps focus instead of the user being yanked to LinkedIn. The
    // background tab still loads the lazy logo images; the parser waits a grace
    // period for their src to populate before reading (see parser.ts). The error
    // paths below bring this tab to the front only when the user needs to act
    // (log in / inspect a failure).
    progress({ phase: 'opening-profile' });
    const tab = await chrome.tabs.create({ url: ME_URL, active: false });
    workerTabId = tab.id;
    if (workerTabId === undefined) {
      throw new SeedError('GENERIC', 'Could not open a worker tab');
    }

    // 2. Wait for it to resolve; detect logged-out (path A).
    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new SeedError(
        'LOGGED_OUT',
        'Log in to LinkedIn, then click Seed again.',
        workerTabId,
      );
    }
    const profileUrl = canonicalProfileUrl(loaded.url || ME_URL);

    // 3. Read name + avatar URL from the top card.
    progress({ phase: 'reading-header' });
    const header = await injectFunc(workerTabId, injectedReadProfileHeader, [15000]);
    if (!header || !header.name) {
      throw new SeedError(
        'PARSE_NOT_READY',
        'Could not read your profile header. Try again.',
        workerTabId,
      );
    }

    // 4. Navigate to the full experience list.
    progress({ phase: 'opening-experience' });
    await chrome.tabs.update(workerTabId, {
      url: profileUrl + 'details/experience/',
    });
    await waitForLoad(workerTabId, { urlIncludes: 'details/experience' });

    // 5. Inject the parser (polls for the list, then returns entries).
    progress({ phase: 'reading-experience' });
    const experiences = await injectFunc(workerTabId, injectedScrapeExperience, [15000]);
    if (!Array.isArray(experiences)) {
      throw new SeedError(
        'PARSE_NOT_READY',
        'Your experience list did not load in time. Try again.',
        workerTabId,
      );
    }
    if (experiences.length === 0) {
      throw new SeedError('EMPTY', 'No experience found on your profile.', workerTabId);
    }
    // Count is real now: bloom the scatter while still on the reading beat.
    progress({ phase: 'reading-experience', companyCount: experiences.length });

    // 6. Fetch + cache images in the home page, ticking once per settled image.
    progress({ phase: 'caching', companyCount: experiences.length });
    const { avatarDataUrl, experiences: withLogos } = await cacheImages(
      header,
      experiences,
      () => progress({ phase: 'logo-cached' }),
    );

    // 7. Assemble + persist.
    const seed: Seed = {
      name: header.name,
      profileUrl,
      avatarUrl: header.avatarUrl,
      avatarDataUrl,
      seededAt: Date.now(),
      experiences: withLogos,
    };
    await saveSeed(seed);

    // 7b. Materialize the graph from the fresh seed (m1-plan §9). Idempotent:
    // re-seeding fully regenerates it.
    await saveGraph(deriveGraph(seed));

    // 8. Close the worker tab (success only).
    if (workerTabId !== undefined) {
      chrome.tabs.remove(workerTabId).catch(() => {});
    }
    return seed;
  } catch (err) {
    console.error('[career-atlas] seed failed:', err);
    if (err instanceof SeedError) {
      // Attach the worker tab id and surface it (keep it open on error).
      err.workerTabId ??= workerTabId;
      if (err.workerTabId !== undefined) {
        chrome.tabs.update(err.workerTabId, { active: true }).catch(() => {});
      }
      throw err;
    }
    throw new SeedError(
      'GENERIC',
      err instanceof Error ? err.message : 'Something went wrong.',
      workerTabId,
    );
  }
}

// === M2: expand one company into its first page of people (m2-plan §8) ======

/** Same code set as the seed flow; here EMPTY = no first-degree connections. */
export type ExpandErrorCode = SeedErrorCode;

export class ExpandError extends Error {
  constructor(
    public code: ExpandErrorCode,
    message: string,
    public workerTabId?: number,
  ) {
    super(message);
    this.name = 'ExpandError';
  }
}

/** First-degree people search for a company name (m2-plan §5a). */
function peopleSearchUrl(keyword: string): string {
  const k = encodeURIComponent(keyword);
  return `https://www.linkedin.com/search/results/people/?keywords=${k}&network=%5B%22F%22%5D&origin=FACETED_SEARCH`;
}

export interface ExpandRunHooks {
  onProgress?: (message: string) => void;
}

/**
 * Expand a single company node: open the worker tab on its first-degree people
 * search (background, like seed), parse the first page, cache photos, and store
 * the result under `graph.expansions[company.id]`. One page load per click. The
 * worker tab is closed on success, surfaced on any error (a captcha lands as
 * PARSE_NOT_READY; halt-on-challenge detection is deferred to M5).
 */
export async function runExpandCompany(
  company: GraphNode,
  hooks: ExpandRunHooks = {},
): Promise<CompanyExpansion> {
  const progress = hooks.onProgress ?? (() => {});
  const keyword = company.name;
  let workerTabId: number | undefined;

  try {
    progress(`Searching your connections at ${keyword}…`);
    const tab = await chrome.tabs.create({
      url: peopleSearchUrl(keyword),
      active: false,
    });
    workerTabId = tab.id;
    if (workerTabId === undefined) {
      throw new ExpandError('GENERIC', 'Could not open a worker tab');
    }

    // Resolve on first complete load (no urlIncludes), then detect logged-out,
    // so a redirect to the auth wall is reported as LOGGED_OUT, not a timeout.
    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new ExpandError(
        'LOGGED_OUT',
        'Log in to LinkedIn, then try expanding again.',
        workerTabId,
      );
    }

    progress('Reading people you know…');
    const records = await injectFunc(workerTabId, injectedScrapePeople, [15000]);
    if (!Array.isArray(records)) {
      throw new ExpandError(
        'PARSE_NOT_READY',
        'The people results did not load in time. Try again.',
        workerTabId,
      );
    }
    if (records.length === 0) {
      throw new ExpandError(
        'EMPTY',
        `No first-degree connections found at ${keyword}.`,
        workerTabId,
      );
    }

    // Build raw person nodes, then fetch each photo as a data URL (in the home
    // page, where licdn fetches are CORS-allowed) and attach it in place.
    progress('Caching photos…');
    const people = personNodesFromRecords(company.id, records);
    await Promise.all(
      people.map(async (p) => {
        p.photoDataUrl = await fetchAsDataUrl(p.photoUrl);
      }),
    );

    const expansion: CompanyExpansion = {
      people,
      keyword,
      fetchedAt: Date.now(),
    };
    await saveExpansion(company.id, expansion);

    if (workerTabId !== undefined) {
      chrome.tabs.remove(workerTabId).catch(() => {});
    }
    return expansion;
  } catch (err) {
    console.error('[career-atlas] expand failed:', err);
    if (err instanceof ExpandError) {
      err.workerTabId ??= workerTabId;
      if (err.workerTabId !== undefined) {
        chrome.tabs.update(err.workerTabId, { active: true }).catch(() => {});
      }
      throw err;
    }
    throw new ExpandError(
      'GENERIC',
      err instanceof Error ? err.message : 'Something went wrong.',
      workerTabId,
    );
  }
}
