import { injectedReadProfileHeader } from './profileReader';
import { injectedScrapeExperience } from './parser';
import { injectedScrapePeople } from './peopleParser';
import { fetchAsDataUrl } from './images';
import { deriveGraph, deriveOnward, mergePeople, personNodesFromRecords } from './graph';
import {
  appendExpansionPage,
  saveExpansion,
  saveGraph,
  saveSeed,
  saveTrace,
} from './storage';
import type {
  CompanyExpansion,
  ExperienceEntry,
  GraphNode,
  OnwardStint,
  PersonNode,
  PersonRecord,
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
 * dim orbs to bloom (never rendered as a number). `logo-cached` fires once per
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
 * route that one to the "you" orb; then each logo). fetchAsDataUrl never
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

/** First-degree people search for a company name (m2-plan §5a). `page` is
 *  LinkedIn's own 1-based search pagination; page 1 is left off the URL so the
 *  M2 first load keeps the exact URL it has always used. Exported for tests. */
export function peopleSearchUrl(keyword: string, page = 1): string {
  const k = encodeURIComponent(keyword);
  const base = `https://www.linkedin.com/search/results/people/?keywords=${k}&network=%5B%22F%22%5D&origin=FACETED_SEARCH`;
  return page > 1 ? `${base}&page=${page}` : base;
}

export interface ExpandRunHooks {
  onProgress?: (message: string) => void;
}

/**
 * Open one page of a company's people search in a background worker tab, parse
 * it, and close the tab. The whole worker-tab protocol for people lives here:
 * background open, wait, logged-out detection, inject, and close-on-success. On
 * any failure it throws an ExpandError carrying the tab id, leaving the tab open
 * for the caller to surface.
 *
 * Shared by the first expand and every "more" page so the two can never drift on
 * the timeout, the logged-out URL set, or (later) challenge detection. What they
 * do with the records differs and stays with them: M2 treats an empty first page
 * as EMPTY, M5 treats a page with nobody new as exhaustion.
 */
async function scrapePeoplePage(
  keyword: string,
  page: number,
  loggedOutMessage: string,
  notReadyMessage: string,
): Promise<PersonRecord[]> {
  let workerTabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({
      url: peopleSearchUrl(keyword, page),
      active: false,
    });
    workerTabId = tab.id;
    if (workerTabId === undefined) {
      throw new ExpandError('GENERIC', 'Could not open a worker tab');
    }

    // Resolve on first complete load (no urlIncludes), then detect logged-out, so
    // a redirect to the auth wall is reported as LOGGED_OUT, not a timeout.
    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new ExpandError('LOGGED_OUT', loggedOutMessage, workerTabId);
    }

    const records = await injectFunc(workerTabId, injectedScrapePeople, [15000]);
    if (!Array.isArray(records)) {
      throw new ExpandError('PARSE_NOT_READY', notReadyMessage, workerTabId);
    }

    chrome.tabs.remove(workerTabId).catch(() => {});
    return records;
  } catch (err) {
    // Convert here, while the tab id is still in scope: a SeedError bubbling out
    // of waitForLoad (timeout / tab closed) carries its own id, but a raw throw
    // would lose ours and leave the tab open but unsurfaced.
    throw asExpandError(err, workerTabId);
  }
}

/** Fetch each person's photo as a data URL and attach it in place. Runs in the
 *  home page, where licdn fetches are CORS-allowed (see `cacheImages`). */
async function cachePhotos(people: PersonNode[]): Promise<void> {
  await Promise.all(
    people.map(async (p) => {
      p.photoDataUrl = await fetchAsDataUrl(p.photoUrl);
    }),
  );
}

/** Surface the worker tab and rethrow as an ExpandError. Both people flows keep
 *  the tab open on failure so the user sees the real page. */
function asExpandError(err: unknown, workerTabId?: number): ExpandError {
  console.error('[career-atlas] people fetch failed:', err);
  const e =
    err instanceof ExpandError
      ? err
      : new ExpandError(
          'GENERIC',
          err instanceof Error ? err.message : 'Something went wrong.',
          workerTabId,
        );
  e.workerTabId ??= workerTabId;
  if (e.workerTabId !== undefined) {
    chrome.tabs.update(e.workerTabId, { active: true }).catch(() => {});
  }
  return e;
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

  try {
    progress(`Searching your connections at ${keyword}…`);
    const records = await scrapePeoplePage(
      keyword,
      1,
      'Log in to LinkedIn, then try expanding again.',
      'The people results did not load in time. Try again.',
    );
    if (records.length === 0) {
      throw new ExpandError('EMPTY', `No first-degree connections found at ${keyword}.`);
    }

    progress('Caching photos…');
    const people = personNodesFromRecords(company.id, records);
    await cachePhotos(people);

    const expansion: CompanyExpansion = {
      people,
      keyword,
      fetchedAt: Date.now(),
      pagesLoaded: 1,
      exhausted: false,
    };
    await saveExpansion(company.id, expansion);
    return expansion;
  } catch (err) {
    throw asExpandError(err);
  }
}

// === M5: page in the next batch of people (milestones "Load more and
// exhaustion") ================================================================

/** The outcome of one "more" click. `added` is the genuinely new colleagues
 *  this page brought (the view marks them fresh so they reveal as one batch);
 *  `exhausted` means the search had nothing new left, which is the terminal
 *  state, not an error. */
export interface LoadMoreResult {
  expansion: CompanyExpansion;
  added: PersonNode[];
  exhausted: boolean;
}

/**
 * Load the next page of a company's people search and fold it into the stored
 * expansion. One page load per click, exactly like expand and trace.
 *
 * Exhaustion is "this page brought nobody new", not "this page was empty": a
 * search that keeps re-serving the same faces past its last real page is spent
 * just as surely as one that returns nothing. Either way the orb retires rather
 * than letting the user click into the void.
 *
 * A page that fails to parse is a retryable error (PARSE_NOT_READY, tab
 * surfaced), never exhaustion: we would rather the user click again than
 * silently declare a galaxy finished because LinkedIn was slow to hydrate.
 */
export async function runLoadMorePeople(
  company: GraphNode,
  expansion: CompanyExpansion,
  hooks: ExpandRunHooks = {},
): Promise<LoadMoreResult> {
  const progress = hooks.onProgress ?? (() => {});
  const keyword = expansion.keyword || company.name;
  const page = (expansion.pagesLoaded ?? 1) + 1;

  try {
    progress(`Looking for more people at ${keyword}…`);
    const records = await scrapePeoplePage(
      keyword,
      page,
      'Log in to LinkedIn, then try again.',
      'The next page did not load in time. Try again.',
    );

    // Merge against what we hold to find who is actually new. An empty page and
    // a page of already-known faces both land here as `added.length === 0`.
    const merged = mergePeople(
      expansion.people,
      personNodesFromRecords(company.id, records),
    );
    const added = merged.slice(expansion.people.length);
    const exhausted = added.length === 0;

    if (added.length > 0) {
      progress('Caching photos…');
      await cachePhotos(added);
    }

    const graph = await appendExpansionPage(company.id, {
      people: merged,
      pagesLoaded: page,
      exhausted,
    });
    // Read back the PERSISTED expansion: it merged against whatever landed while
    // this page was in flight, so it is the truth, not our snapshot. Missing it
    // means the company left the atlas mid-fetch (a re-seed) — a real failure,
    // not something to paper over by resurrecting a deleted expansion.
    const next = graph?.expansions?.[company.id];
    if (!next) {
      throw new ExpandError('GENERIC', 'This company is no longer in your atlas.');
    }
    return { expansion: next, added, exhausted };
  } catch (err) {
    throw asExpandError(err);
  }
}

// === M3: trace where one clicked colleague went (m3-plan §8) =================

/** No EMPTY here: "no shared stint" is the dismiss OUTCOME and "nothing after"
 *  is a valid terminal lane, neither is an error. */
export type TraceErrorCode = 'LOGGED_OUT' | 'PARSE_NOT_READY' | 'GENERIC';

export class TraceError extends Error {
  constructor(
    public code: TraceErrorCode,
    message: string,
    public workerTabId?: number,
  ) {
    super(message);
    this.name = 'TraceError';
  }
}

/**
 * The outcome of tracing one colleague. `dismissed` is a keyword false positive
 * (their profile never lists this company); `traced` carries the onward
 * trajectory (possibly empty = terminal: still there, or nothing after).
 */
export type TraceResult =
  | { status: 'dismissed' }
  | { status: 'traced'; onward: OnwardStint[]; tracedAt: number };

export interface TraceRunHooks {
  onProgress?: (message: string) => void;
}

/**
 * Trace a single clicked colleague (m3-plan §8): open their experience page in a
 * background worker tab, reuse `injectedScrapeExperience` to read their history,
 * anchor it on this galaxy's company, and cut to where they went next. One page
 * load per click. The worker tab is closed on success (and on the dismiss
 * outcome), surfaced on any real error. On error the person stays 'raw'
 * (retryable). Persists the result via `saveTrace`.
 */
export async function runTracePerson(
  company: GraphNode,
  person: PersonNode,
  hooks: TraceRunHooks = {},
): Promise<TraceResult> {
  const progress = hooks.onProgress ?? (() => {});
  let workerTabId: number | undefined;

  try {
    // One-step: open the colleague's experience page directly in a background
    // worker tab. An empty parse (page didn't hydrate cold) is a recoverable
    // PARSE_NOT_READY error (tab surfaced, orb retryable), so we trade the
    // two-step's reliable-but-slow profile-boot (~4s every trace) for speed.
    progress(`Reading ${person.name}'s path…`);
    const tab = await chrome.tabs.create({
      url: person.profileUrl + 'details/experience/',
      active: false,
    });
    workerTabId = tab.id;
    if (workerTabId === undefined) {
      throw new TraceError('GENERIC', 'Could not open a worker tab');
    }

    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new TraceError(
        'LOGGED_OUT',
        'Log in to LinkedIn, then try following them again.',
        workerTabId,
      );
    }

    // Shorter logo grace than the seed (2s vs 6s): a trace only needs the few
    // onward companies' logos (the most recent, which load first), and we re-
    // fetch them in the home page anyway. Cuts ~4s off the parser phase.
    const experiences = await injectFunc(
      workerTabId,
      injectedScrapeExperience,
      [15000, 2000],
    );
    // An empty read is a failed read, not "they have no jobs": treat it as a
    // retryable error (tab surfaced), never as a false-positive dismiss. A real
    // false positive is "experiences parsed, but none match" (handled below).
    if (!Array.isArray(experiences) || experiences.length === 0) {
      throw new TraceError(
        'PARSE_NOT_READY',
        'Their experience list did not load in time. Try again.',
        workerTabId,
      );
    }

    const { matched, onward } = deriveOnward(company, experiences);

    // False positive: their profile doesn't list this company. A dismiss
    // outcome, not an error — let the orb dim in the cluster.
    if (!matched) {
      await saveTrace(company.id, person.id, { status: 'dismissed' });
      if (workerTabId !== undefined) {
        chrome.tabs.remove(workerTabId).catch(() => {});
      }
      return { status: 'dismissed' };
    }

    // Cache each onward logo as a data URL (home page, CORS-allowed, like photos).
    progress('Charting their trajectory…');
    const withLogos = await Promise.all(
      onward.map(async (s) => ({
        ...s,
        logoDataUrl: await fetchAsDataUrl(s.logoUrl),
      })),
    );

    // Stamp the trace time so lanes stack in the order colleagues were traced
    // (click order), persisted so re-entry restores the same order.
    const tracedAt = Date.now();
    await saveTrace(company.id, person.id, {
      status: 'traced',
      onward: withLogos,
      tracedAt,
    });

    if (workerTabId !== undefined) {
      chrome.tabs.remove(workerTabId).catch(() => {});
    }
    return { status: 'traced', onward: withLogos, tracedAt };
  } catch (err) {
    console.error('[career-atlas] trace failed:', err);
    if (err instanceof TraceError) {
      err.workerTabId ??= workerTabId;
      if (err.workerTabId !== undefined) {
        chrome.tabs.update(err.workerTabId, { active: true }).catch(() => {});
      }
      throw err;
    }
    // A SeedError bubbling from waitForLoad (timeout / tab closed) lands here.
    if (workerTabId !== undefined) {
      chrome.tabs.update(workerTabId, { active: true }).catch(() => {});
    }
    throw new TraceError(
      'GENERIC',
      err instanceof Error ? err.message : 'Something went wrong.',
      workerTabId,
    );
  }
}
