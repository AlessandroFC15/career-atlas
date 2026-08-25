// Deterministic scatter for the seed reveal's company orbs (seed-reveal-plan
// §7). Pure and side-effect-free (no Math.random), so the field never jitters
// on re-render and the geometry is unit-testable.

// The golden angle (~137.5°) spreads successive points so none align into
// spokes: the classic sunflower / phyllotaxis distribution.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Keep the innermost orbs off the very center, where the "you" orb sits.
const INNER_RADIUS = 0.22;

/**
 * Position the `index`-th of `count` company orbs on a unit disk: a sunflower
 * spiral whose radius grows as sqrt(i) so the field fills evenly rather than
 * crowding the center. Returns `{ x, y }` with `x² + y² ≤ 1`; the view scales
 * this to a viewport field. Same input always yields the same point.
 */
export function scatterPoint(index: number, count: number): { x: number; y: number } {
  if (count <= 0) return { x: 0, y: 0 };
  const t = count <= 1 ? 0 : Math.sqrt((index + 0.5) / count);
  const r = INNER_RADIUS + (1 - INNER_RADIUS) * t;
  const theta = index * GOLDEN_ANGLE;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}
