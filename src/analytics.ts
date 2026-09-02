import type { ExpandErrorCode, SeedErrorCode, TraceErrorCode } from './orchestrator';

// Shapes, never contents (issue #11): every event below is a fixed literal
// name plus an allowlisted set of counts/enums/durations. There is no prop
// key anywhere in this union that could carry a person's name, a company
// name, or a LinkedIn URL — adding one would be a type error here, not a
// code-review catch.
type CountBucket = '0' | '1-2' | '3-5' | '6-10' | '11-20' | '21+';

export type AnalyticsEvent =
  | { name: 'seed_started' }
  | { name: 'seed_succeeded'; companyCount: number; durationMs: number }
  | { name: 'seed_failed'; code: SeedErrorCode; durationMs: number }
  | { name: 'expand_started' }
  | { name: 'expand_succeeded'; peopleFound: CountBucket }
  | { name: 'expand_failed'; code: ExpandErrorCode }
  | { name: 'trace_started' }
  | { name: 'trace_succeeded'; outcome: 'traced' | 'dismissed'; onwardCount?: CountBucket }
  | { name: 'trace_failed'; code: TraceErrorCode }
  | { name: 'galaxy_entered' }
  | { name: 'atlas_returned' };

export function bucketCount(n: number): CountBucket {
  if (n <= 0) return '0';
  if (n <= 2) return '1-2';
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  if (n <= 20) return '11-20';
  return '21+';
}

// PostHog's project API key is a write-only token meant to ship in client
// code (https://posthog.com/docs/api#public-endpoints) — it can only submit
// events, never read them back, so baking it into the built bundle (Vite
// inlines import.meta.env.* at build time) is the sanctioned use. It's read
// from an env var rather than hardcoded here purely so the value itself
// (and any dev/prod split) doesn't live in this file's git history; see
// .env.example. Telemetry silently no-ops until it's set.
const POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_PROJECT_API_KEY = import.meta.env.VITE_POSTHOG_PROJECT_API_KEY ?? '';

// `vite build` defaults to production mode for every build — a developer's own
// unpacked test build and the artifact actually uploaded to the Chrome Web
// Store both get import.meta.env.PROD === true, so that flag can't tell them
// apart. This is a second, explicitly-set switch: it stays 'development'
// unless VITE_ANALYTICS_ENV=production is set in the .env used for the one
// build that gets zipped and shipped (see .env.example). Every event carries
// it, so dev noise while testing the extension never mixes with real usage
// in PostHog.
const ANALYTICS_ENV =
  import.meta.env.VITE_ANALYTICS_ENV === 'production' ? 'production' : 'development';

const OPT_OUT_KEY = 'analyticsOptOut';
const ID_KEY = 'analyticsId';
const QUEUE_KEY = 'analyticsQueue';
// Caps storage growth through an extended offline stretch; a burst this size
// is already far more than any single session produces.
const MAX_QUEUE = 200;

interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

export async function isOptedOut(): Promise<boolean> {
  const out = await chrome.storage.local.get(OPT_OUT_KEY);
  return out[OPT_OUT_KEY] === true;
}

/** The UI's single opt-out toggle. Turning it off drops whatever is already
 *  queued rather than sending it late: consent is checked at send time, not
 *  just at record time. */
export async function setOptedOut(optedOut: boolean): Promise<void> {
  await chrome.storage.local.set({ [OPT_OUT_KEY]: optedOut });
  if (optedOut) await chrome.storage.local.remove(QUEUE_KEY);
}

async function getDistinctId(): Promise<string> {
  const out = await chrome.storage.local.get(ID_KEY);
  const existing = out[ID_KEY] as string | undefined;
  if (existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [ID_KEY]: id });
  return id;
}

async function loadQueue(): Promise<QueuedEvent[]> {
  const out = await chrome.storage.local.get(QUEUE_KEY);
  return (out[QUEUE_KEY] as QueuedEvent[] | undefined) ?? [];
}

async function saveQueue(queue: QueuedEvent[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) });
}

/**
 * Record one event into the durable queue (chrome.storage.local, not memory)
 * so it survives the service worker being torn down between now and the next
 * `chrome.alarms` flush (src/background.ts). Also makes a best-effort
 * immediate flush attempt for when the worker is alive long enough to send it
 * right away.
 */
export async function track(event: AnalyticsEvent): Promise<void> {
  if (await isOptedOut()) return;
  const { name, ...properties } = event;
  const queue = await loadQueue();
  queue.push({
    event: name,
    properties: { ...properties, environment: ANALYTICS_ENV },
    timestamp: new Date().toISOString(),
  });
  await saveQueue(queue);
  void flushQueue();
}

/**
 * Send whatever is queued to PostHog's batch capture endpoint (a plain fetch,
 * not the posthog-js SDK: the SDK assumes a `window`/DOM, which the MV3
 * service worker doesn't have, and a JSON POST is all "send shapes" needs).
 * Leaves the queue untouched on any failure (offline, blocked, non-2xx) so
 * the next alarm tick retries the same events rather than losing them.
 */
export async function flushQueue(): Promise<void> {
  if (await isOptedOut()) {
    await chrome.storage.local.remove(QUEUE_KEY);
    return;
  }
  if (!POSTHOG_PROJECT_API_KEY) return;
  const queue = await loadQueue();
  if (queue.length === 0) return;
  const distinctId = await getDistinctId();
  try {
    const res = await fetch(`${POSTHOG_HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: POSTHOG_PROJECT_API_KEY,
        batch: queue.map((e) => ({
          ...e,
          properties: { ...e.properties, distinct_id: distinctId },
        })),
      }),
    });
    if (!res.ok) return;
    await chrome.storage.local.remove(QUEUE_KEY);
  } catch {
    // Offline or blocked; leave queued for the next alarm tick.
  }
}
