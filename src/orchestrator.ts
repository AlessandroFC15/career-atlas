import { bucketCount, track } from './analytics';
import { t } from './i18n';
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
  | 'GENERIC' // D
  | 'UNSUPPORTED_LOCALE'; // E

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

/** Self-contained (no outer-scope refs, injected via chrome.scripting): reads
 *  the page's declared language. The parsers understand English and Portuguese
 *  markup (see issue #13); LinkedIn's UI language is an account setting with no
 *  per-request URL override for a signed-in session (unlike a public/logged-out
 *  profile view, where `?locale=` does work), so this is the only lever we have
 *  to catch any other language before it silently parses nothing. An
 *  empty/missing `lang` passes rather than blocking, since not every LinkedIn
 *  page sets it reliably. Exported for tests. */
export function injectedCheckSupportedLocale(): boolean {
  const lang = (document.documentElement.lang || '').toLowerCase();
  return lang === '' || lang.startsWith('en') || lang.startsWith('pt');
}

/** LinkedIn's login page, for the logged-out state's "Log in" link. Never the
 *  worker tab's URL: a logged-out /in/me redirects to signup, not login, so
 *  we hand the user this URL ourselves rather than reusing wherever the
 *  worker tab landed. */
export const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';

/** What to do with the worker tab once an error has it: a logged-out
 *  redirect is not something to inspect (it's a signup pitch, never the
 *  page the user wants), so close it and let the styled logged-out state
 *  offer the real login link instead. Every other error is a genuine
 *  failure worth surfacing, so bring that tab forward for the user to see. */
function settleWorkerTab(workerTabId: number | undefined, loggedOut: boolean): void {
  if (workerTabId === undefined) return;
  if (loggedOut) {
    chrome.tabs.remove(workerTabId).catch(() => {});
  } else {
    chrome.tabs.update(workerTabId, { active: true }).catch(() => {});
  }
}

// The tab id of a login watch already in flight, so a second "Log in to
// LinkedIn" click (the button appears in three places) focuses that tab
// instead of opening another and leaking another pair of onUpdated/onRemoved
// listeners (each fires on every tab in the browser, not just this one).
let pendingLoginTabId: number | undefined;

/**
 * Open LinkedIn's login page and call `onReturn` once the user is done with
 * it, so the logged-out state's action can retry itself instead of making the
 * user come back and click "Seed again" (or its expand/trace equivalent) by
 * hand. "Done" is either signal, whichever comes first: the tab navigates
 * somewhere that isn't a logged-out URL (login succeeded), or the user closes
 * the tab themselves (they're finished either way, successful or not; a
 * retry that finds them still logged out just lands back on this same state).
 */
export function watchForLogin(onReturn: () => void): void {
  if (pendingLoginTabId !== undefined) {
    chrome.tabs.update(pendingLoginTabId, { active: true }).catch(() => {});
    return;
  }
  chrome.tabs.create({ url: LINKEDIN_LOGIN_URL }, (tab) => {
    const tabId = tab?.id;
    if (tabId === undefined) return;
    pendingLoginTabId = tabId;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pendingLoginTabId = undefined;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      onReturn();
    };
    const onUpdated = (
      id: number,
      info: chrome.tabs.TabChangeInfo,
      updatedTab: chrome.tabs.Tab,
    ) => {
      if (id !== tabId || info.status !== 'complete') return;
      if (!isLoggedOutUrl(updatedTab.url)) finish();
    };
    const onRemoved = (id: number) => {
      if (id !== tabId) return;
      finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

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
      reject(new SeedError('GENERIC', t('timedOutWaitingPage'), tabId));
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
      reject(new SeedError('GENERIC', t('workerTabClosed'), tabId));
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
  const startedAt = Date.now();
  void track({ name: 'seed_started' });

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
      throw new SeedError('GENERIC', t('couldNotOpenWorkerTab'));
    }

    // 2. Wait for it to resolve; detect logged-out (path A).
    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new SeedError('LOGGED_OUT', t('loggedOutSeed'), workerTabId);
    }
    if (!(await injectFunc(workerTabId, injectedCheckSupportedLocale, []))) {
      throw new SeedError('UNSUPPORTED_LOCALE', t('unsupportedLocale'), workerTabId);
    }
    const profileUrl = canonicalProfileUrl(loaded.url || ME_URL);

    // 3. Read name + avatar URL from the top card.
    progress({ phase: 'reading-header' });
    const header = await injectFunc(workerTabId, injectedReadProfileHeader, [15000]);
    if (!header || !header.name) {
      throw new SeedError('PARSE_NOT_READY', t('couldNotReadProfileHeader'), workerTabId);
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
      throw new SeedError('PARSE_NOT_READY', t('experienceListTimeout'), workerTabId);
    }
    if (experiences.length === 0) {
      throw new SeedError('EMPTY', t('noExperienceFound'), workerTabId);
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
    void track({
      name: 'seed_succeeded',
      companyCount: experiences.length,
      durationMs: Date.now() - startedAt,
    });
    return seed;
  } catch (err) {
    console.error('[career-atlas] seed failed:', err);
    if (err instanceof SeedError) {
      // Attach the worker tab id, then settle it: closed if logged-out,
      // surfaced otherwise.
      err.workerTabId ??= workerTabId;
      settleWorkerTab(err.workerTabId, err.code === 'LOGGED_OUT');
      void track({ name: 'seed_failed', code: err.code, durationMs: Date.now() - startedAt });
      throw err;
    }
    void track({ name: 'seed_failed', code: 'GENERIC', durationMs: Date.now() - startedAt });
    throw new SeedError(
      'GENERIC',
      err instanceof Error ? err.message : t('errorGeneric'),
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
      throw new ExpandError('GENERIC', t('couldNotOpenWorkerTab'));
    }

    // Resolve on first complete load (no urlIncludes), then detect logged-out, so
    // a redirect to the auth wall is reported as LOGGED_OUT, not a timeout.
    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new ExpandError('LOGGED_OUT', loggedOutMessage, workerTabId);
    }
    if (!(await injectFunc(workerTabId, injectedCheckSupportedLocale, []))) {
      throw new ExpandError('UNSUPPORTED_LOCALE', t('unsupportedLocale'), workerTabId);
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

/** Settle the worker tab and rethrow as an ExpandError: closed if logged-out
 *  (never a signup pitch left in the tab strip), surfaced otherwise so the
 *  user sees the real page. */
function asExpandError(err: unknown, workerTabId?: number): ExpandError {
  console.error('[career-atlas] people fetch failed:', err);
  const e =
    err instanceof ExpandError
      ? err
      : new ExpandError(
          'GENERIC',
          err instanceof Error ? err.message : t('errorGeneric'),
          workerTabId,
        );
  e.workerTabId ??= workerTabId;
  settleWorkerTab(e.workerTabId, e.code === 'LOGGED_OUT');
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
  void track({ name: 'expand_started' });

  try {
    progress(t('searchingConnectionsAt', keyword));
    const records = await scrapePeoplePage(
      keyword,
      1,
      t('loggedOutExpand'),
      t('peopleResultsTimeout'),
    );
    if (records.length === 0) {
      throw new ExpandError('EMPTY', t('noFirstDegreeConnectionsAt', keyword));
    }

    progress(t('cachingPhotos'));
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
    void track({ name: 'expand_succeeded', peopleFound: bucketCount(people.length) });
    return expansion;
  } catch (err) {
    const expandErr = asExpandError(err);
    void track({ name: 'expand_failed', code: expandErr.code });
    throw expandErr;
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
    progress(t('lookingForMorePeopleAt', keyword));
    const records = await scrapePeoplePage(
      keyword,
      page,
      t('loggedOutLoadMore'),
      t('nextPageTimeout'),
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
      progress(t('cachingPhotos'));
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
      throw new ExpandError('GENERIC', t('companyNoLongerInAtlas'));
    }
    return { expansion: next, added, exhausted };
  } catch (err) {
    throw asExpandError(err);
  }
}

// === M3: trace where one clicked colleague went (m3-plan §8) =================

/** No EMPTY here: "no shared stint" is the dismiss OUTCOME and "nothing after"
 *  is a valid terminal lane, neither is an error. */
export type TraceErrorCode =
  | 'LOGGED_OUT'
  | 'PARSE_NOT_READY'
  | 'GENERIC'
  | 'UNSUPPORTED_LOCALE';

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
  void track({ name: 'trace_started' });

  try {
    // One-step: open the colleague's experience page directly in a background
    // worker tab. An empty parse (page didn't hydrate cold) is a recoverable
    // PARSE_NOT_READY error (tab surfaced, orb retryable), so we trade the
    // two-step's reliable-but-slow profile-boot (~4s every trace) for speed.
    progress(t('readingPersonPath', person.name));
    const tab = await chrome.tabs.create({
      url: person.profileUrl + 'details/experience/',
      active: false,
    });
    workerTabId = tab.id;
    if (workerTabId === undefined) {
      throw new TraceError('GENERIC', t('couldNotOpenWorkerTab'));
    }

    const loaded = await waitForLoad(workerTabId);
    if (isLoggedOutUrl(loaded.url)) {
      throw new TraceError('LOGGED_OUT', t('loggedOutTrace'), workerTabId);
    }
    if (!(await injectFunc(workerTabId, injectedCheckSupportedLocale, []))) {
      throw new TraceError('UNSUPPORTED_LOCALE', t('unsupportedLocale'), workerTabId);
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
      throw new TraceError('PARSE_NOT_READY', t('theirExperienceTimeout'), workerTabId);
    }

    const { matched, onward } = deriveOnward(company, experiences);

    // False positive: their profile doesn't list this company. A dismiss
    // outcome, not an error — let the orb dim in the cluster.
    if (!matched) {
      await saveTrace(company.id, person.id, { status: 'dismissed' });
      if (workerTabId !== undefined) {
        chrome.tabs.remove(workerTabId).catch(() => {});
      }
      void track({ name: 'trace_succeeded', outcome: 'dismissed' });
      return { status: 'dismissed' };
    }

    // Cache each onward logo as a data URL (home page, CORS-allowed, like photos).
    progress(t('chartingTrajectory'));
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
    void track({
      name: 'trace_succeeded',
      outcome: 'traced',
      onwardCount: bucketCount(withLogos.length),
    });
    return { status: 'traced', onward: withLogos, tracedAt };
  } catch (err) {
    console.error('[career-atlas] trace failed:', err);
    if (err instanceof TraceError) {
      err.workerTabId ??= workerTabId;
      settleWorkerTab(err.workerTabId, err.code === 'LOGGED_OUT');
      void track({ name: 'trace_failed', code: err.code });
      throw err;
    }
    // A SeedError bubbling from waitForLoad (timeout / tab closed) lands here.
    settleWorkerTab(workerTabId, false);
    void track({ name: 'trace_failed', code: 'GENERIC' });
    throw new TraceError(
      'GENERIC',
      err instanceof Error ? err.message : t('errorGeneric'),
      workerTabId,
    );
  }
}
