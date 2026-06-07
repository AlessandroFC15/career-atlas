import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { scatterPoint } from '../scatter';
import type { SeedProgress } from '../orchestrator';

// The phases that own a beat in the void. `logo-cached` is a tick, not a phase.
export type SeedPhase = Exclude<SeedProgress['phase'], 'logo-cached'>;

/**
 * The view's derived seeding state (seed-reveal-plan §5): the current phase and,
 * once parsing returns, how many company stars to bloom. App folds the
 * orchestrator's SeedProgress events into this via the useSeedReveal hook.
 *
 * Note: logo-cached ticks are intentionally ignored. Logo caching is near-instant
 * and arrives last, so it is not a meaningful streaming signal (the original plan
 * over-bet on it). The reveal's climax is the single real event "we found your N
 * companies": the stars bloom and ignite on a view-driven sweep, not per logo.
 */
export interface SeedingProgress {
  phase: SeedPhase;
  companyCount: number;
}

export const INITIAL_PROGRESS: SeedingProgress = {
  phase: 'opening-profile',
  companyCount: 0,
};

// Minimum-beat pacing (§11/§12): the seed's real events can fire faster than the
// eye can read, so each phase dwells at least this long before the next is shown.
// A floor on display speed, never a ceiling: a slow seed is not held back.
const MIN_BEAT_MS = 750;

// The climax sweep: each company star arrives this far after the previous, and a
// single arrival (bloom overshoot, dim hold, ignite to warm) lasts this long.
// Kept in sync with the `company-arrive` keyframe + stagger in styles.css; the
// view uses them to time the dissolve (and to fire it under reduced motion,
// where the CSS animation, and thus animationend, would not run).
export const COMPANY_STAGGER_MS = 75;
export const COMPANY_ARRIVE_MS = 1800;

/**
 * Pace the orchestrator's raw SeedProgress events into a legible reveal. Returns
 * the throttled `progress` for the LoadingChart, a `push` to feed events into,
 * and a `reset` for the start of each run. Logo ticks are dropped here.
 */
export function useSeedReveal() {
  const [progress, setProgress] = useState<SeedingProgress>(INITIAL_PROGRESS);
  const queue = useRef<SeedingProgress[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const nextAllowed = useRef(0); // epoch ms when the next beat may be released

  const drain = useCallback(() => {
    if (timer.current != null || queue.current.length === 0) return;
    const wait = Math.max(0, nextAllowed.current - Date.now());
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const next = queue.current.shift();
      if (next) {
        setProgress(next);
        nextAllowed.current = Date.now() + MIN_BEAT_MS;
      }
      drain();
    }, wait);
  }, []);

  const push = useCallback(
    (ev: SeedProgress) => {
      if (ev.phase === 'logo-cached') return; // not a meaningful beat (see above)
      const prev = queue.current[queue.current.length - 1] ?? progress;
      const companyCount =
        'companyCount' in ev && ev.companyCount != null
          ? ev.companyCount
          : prev.companyCount;
      queue.current.push({ phase: ev.phase, companyCount });
      drain();
    },
    [drain, progress],
  );

  const reset = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    queue.current = [];
    nextAllowed.current = 0;
    setProgress(INITIAL_PROGRESS);
  }, []);

  return { progress, push, reset };
}

// Copy lives here, not on the wire: one place to reword a line (§7).
const PHASE_TEXT: Record<SeedPhase, string> = {
  'opening-profile': 'Opening your LinkedIn profile…',
  'reading-header': 'Reading your name and photo…',
  'opening-experience': 'Opening your full experience list…',
  'reading-experience': 'Reading your experience…',
  caching: 'Charting your companies…',
};

// Company-star field radius as a fraction of the viewport's smaller side (vmin),
// so the scatter stays circular and centered on the "you" star at any size.
const FIELD_RADIUS = 32;

/**
 * The loading screen as the birth of the chart (seed-reveal-plan §7). A center
 * "you" star ignites and breathes through the (mostly opaque) page-load wait,
 * carried by a soft focal glow. The climax is the moment your companies are
 * parsed: a deterministic scatter of stars blooms and ignites to warm gold in a
 * staggered sweep, then App cross-dissolves it into the real graph (§8).
 *
 * `fading` renders the static, fully-lit final state (no entrance animations) for
 * the dissolve overlay. `onClimaxDone` fires once the arrival sweep has finished,
 * so App can hold the lit field a beat and then hand off.
 */
export function LoadingChart({
  progress,
  fading = false,
  onClimaxDone,
}: {
  progress: SeedingProgress;
  fading?: boolean;
  onClimaxDone?: () => void;
}) {
  const { phase, companyCount } = progress;
  const ignited = phase !== 'opening-profile';
  // Once the sweep has lit the field, the stars are the message: fade the phase
  // line out rather than letting it sit at full opacity through the hold/dissolve.
  const [swept, setSwept] = useState(false);

  // Fire the climax-done signal on a deterministic timer rather than the last
  // star's animationend, so it still fires under reduced motion (no animation).
  useEffect(() => {
    if (fading || companyCount <= 0) return;
    const dur = (companyCount - 1) * COMPANY_STAGGER_MS + COMPANY_ARRIVE_MS;
    const t = setTimeout(() => {
      setSwept(true);
      onClimaxDone?.();
    }, dur);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyCount, fading]);

  return (
    <div
      className={`loading-chart${fading ? ' loading-chart--fading' : ''}`}
      aria-hidden="true"
    >
      {/* A soft focal glow so the void reads as "something forming" from the
          first frame, before any company star is known (§3, §11). */}
      <div className="loading-chart__core" />
      <div className="loading-chart__field">
        {Array.from({ length: companyCount }, (_, i) => {
          const { x, y } = scatterPoint(i, companyCount);
          const style = {
            '--i': i,
            left: `calc(50% + ${(x * FIELD_RADIUS).toFixed(2)}vmin)`,
            top: `calc(50% + ${(y * FIELD_RADIUS).toFixed(2)}vmin)`,
          } as CSSProperties;
          return <span key={i} className="loading-star loading-star--company" style={style} />;
        })}
        <span
          className={`loading-star loading-star--you${ignited ? ' is-ignited' : ''}`}
        />
        {/* A faint orbit with a circling point: an on-theme "working" indicator
            while the opaque page loads run. Fades out once the field ignites. */}
        {ignited && (
          <div
            className={`loading-chart__orbit${swept ? ' loading-chart__orbit--done' : ''}`}
          />
        )}
      </div>
      {/* Re-key by phase so the fade-in replays as the copy changes; fade out
          once the climax has lit the field, so it never lingers. */}
      <p
        className={`loading-chart__phase${swept ? ' loading-chart__phase--done' : ''}`}
        key={phase}
      >
        {PHASE_TEXT[phase]}
      </p>
    </div>
  );
}

/**
 * The reopen-from-storage flash (§9): a single quiet breathing star, no scatter
 * and no phase text, shown for the brief moment App reads an existing seed from
 * storage. Replaces the old ring spinner so the void is consistent everywhere.
 */
export function BreathingStar() {
  return (
    <div className="loading-chart loading-chart--quiet" aria-hidden="true">
      <div className="loading-chart__core" />
      <div className="loading-chart__field">
        <span className="loading-star loading-star--you is-ignited" />
      </div>
    </div>
  );
}
