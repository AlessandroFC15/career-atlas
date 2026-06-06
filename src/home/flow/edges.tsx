import type { CSSProperties } from 'react';
import { getStraightPath, type EdgeProps } from '@xyflow/react';

/**
 * A line of light between two stars. Direction is implied by a gradient that
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
  const meta = data as { faded?: boolean; index?: number } | undefined;
  const className = 'career-edge' + (meta?.faded ? ' career-edge--faded' : '');
  // --i = the target star's chain order, so the intro staggers each beam to draw
  // as its destination star ignites (see styles.css). The whole group fades, so
  // the blurred glow underlay lights up with the sharp beam, not before it.
  const style = { '--i': meta?.index ?? 0 } as CSSProperties;
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
          <stop offset="0%" stopColor="rgba(168, 182, 235, 0.12)" />
          <stop offset="100%" stopColor="rgba(180, 196, 255, 0.75)" />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="rgba(124, 140, 255, 0.35)"
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
      />
    </g>
  );
}

export const edgeTypes = { next: ConstellationEdge };
