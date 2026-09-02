import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bucketCount, isOptedOut, setOptedOut, track } from '../src/analytics';

/** Minimal chrome.storage.local stand-in, matching test/storage.test.ts. */
let store: Record<string, unknown> = {};
beforeEach(() => {
  store = {};
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** POSTHOG_PROJECT_API_KEY is read once at module load from
 *  import.meta.env.VITE_POSTHOG_PROJECT_API_KEY (see src/analytics.ts) —
 *  whatever happens to be in this machine's .env. To test both the
 *  "configured" and "not configured" paths deterministically regardless of
 *  that, stub the env var and force a fresh module instance rather than
 *  relying on the statically-imported one above. */
async function freshAnalytics(apiKey: string) {
  vi.stubEnv('VITE_POSTHOG_PROJECT_API_KEY', apiKey);
  vi.resetModules();
  return import('../src/analytics');
}

describe('bucketCount', () => {
  it('buckets counts into fixed ranges rather than exact numbers', () => {
    expect(bucketCount(0)).toBe('0');
    expect(bucketCount(2)).toBe('1-2');
    expect(bucketCount(5)).toBe('3-5');
    expect(bucketCount(10)).toBe('6-10');
    expect(bucketCount(20)).toBe('11-20');
    expect(bucketCount(21)).toBe('21+');
    expect(bucketCount(500)).toBe('21+');
  });
});

describe('opt-out', () => {
  it('defaults to opted in', async () => {
    expect(await isOptedOut()).toBe(false);
  });

  it('persists the toggle', async () => {
    await setOptedOut(true);
    expect(await isOptedOut()).toBe(true);
    await setOptedOut(false);
    expect(await isOptedOut()).toBe(false);
  });

  it('drops whatever is queued when turned off', async () => {
    await track({ name: 'galaxy_entered' });
    expect(store.analyticsQueue).toBeDefined();
    await setOptedOut(true);
    expect(store.analyticsQueue).toBeUndefined();
  });
});

describe('track', () => {
  it('does nothing while opted out', async () => {
    await setOptedOut(true);
    await track({ name: 'galaxy_entered' });
    expect(store.analyticsQueue).toBeUndefined();
  });

  it('tags every event with the analytics environment (never a name/company/URL)', async () => {
    // Explicit no-key module so track()'s own internal auto-flush (fire-and-
    // forget) can never race this assertion: with no key it always returns
    // before touching storage, so nothing else can mutate the queue we're
    // about to inspect.
    const { track: trackFresh } = await freshAnalytics('');
    await trackFresh({ name: 'atlas_returned' });
    const queue = store.analyticsQueue as Array<{ properties: Record<string, unknown> }>;
    expect(queue[0].properties).toEqual({ environment: 'development' });
  });

  it('with no api key configured, flush is a no-op that leaves the event queued', async () => {
    const { flushQueue } = await freshAnalytics('');
    store.analyticsQueue = [{ event: 'atlas_returned', properties: {}, timestamp: 't' }];
    await flushQueue();
    expect(store.analyticsQueue).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('with an api key configured, flush sends the batch and clears the queue', async () => {
    const { flushQueue } = await freshAnalytics('phc_test_key');
    store.analyticsQueue = [{ event: 'atlas_returned', properties: {}, timestamp: 't' }];
    await flushQueue();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/batch/');
    expect(JSON.parse(init.body).api_key).toBe('phc_test_key');
    expect(store.analyticsQueue).toBeUndefined();
  });

  it('leaves the queue untouched when the request fails, so the next alarm retries it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { flushQueue } = await freshAnalytics('phc_test_key');
    store.analyticsQueue = [{ event: 'atlas_returned', properties: {}, timestamp: 't' }];
    await flushQueue();
    expect(store.analyticsQueue).toHaveLength(1);
  });
});
