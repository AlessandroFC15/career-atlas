import type { CSSProperties } from 'react';
import { getBezierPath, getStraightPath, type EdgeProps } from '@xyflow/react';

/**
 * A line of light between two orbs. Direction is implied by a gradient that
 * brightens toward the target, with a soft blurred underlay for the glow. Used
 * for both the chain edges and the galaxy spokes.
 */
function ConstellationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const gradientId = `beam-${id}`;
  const meta = data as
    | { faded?: boolean; index?: number; color?: string; present?: boolean }
    | undefined;
  const className = 'career-edge' + (meta?.faded ? ' career-edge--faded' : '');
  // --i = the target orb's chain order, so the intro staggers each beam to draw
  // as its destination orb ignites (see styles.css). The whole group fades, so
  // the blurred glow underlay lights up with the sharp beam, not before it.
  const style = { '--i': meta?.index ?? 0 } as CSSProperties;
  // The beam takes its destination company's brand colour (M3 lane beams); the
  // atlas chain passes none and falls back to the default starlight indigo. The
  // gradient still brightens toward the target to imply direction (alpha stops
  // on the same hue), and the blurred underlay carries the glow.
  const core = meta?.color ?? 'rgb(180, 196, 255)';
  return (
    <g className={className} style={style}>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={core} stopOpacity={0.12} />
          <stop offset="100%" stopColor={core} stopOpacity={0.8} />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke={core}
        strokeOpacity={0.32}
        strokeWidth={4}
        strokeLinecap="round"
        style={{ filter: 'blur(3px)' }}
      />
      <path
        className="career-beam"
        d={path}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={1.5}
        strokeLinecap="round"
        // A present-tail (current job → now-line) is dashed, reading as "ongoing"
        // versus the solid beams of moves that already happened.
        strokeDasharray={meta?.present ? '2 5' : undefined}
      />
    </g>
  );
}

/**
 * The convergence thread (m3-plan §6d): a faint accent line linking the same
 * company across two colleague lanes ("they both ended up here"). Distinct from
 * the lane beams: fainter, accent-tinted, gently curved, with a soft glow. The
 * leaf orbs stay at their true dates; this only connects them.
 */
function ConvergenceEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.4,
  });
  return (
    <g className="convergence-edge">
      <path
        d={path}
        fill="none"
        stroke="rgba(124, 140, 255, 0.28)"
        strokeWidth={3}
        strokeLinecap="round"
        style={{ filter: 'blur(3px)' }}
      />
      <path
        className="convergence-thread"
        d={path}
        fill="none"
        stroke="rgba(160, 176, 255, 0.45)"
        strokeWidth={1}
        strokeLinecap="round"
        strokeDasharray="2 5"
      />
    </g>
  );
}

export const edgeTypes = { next: ConstellationEdge, convergence: ConvergenceEdge };
