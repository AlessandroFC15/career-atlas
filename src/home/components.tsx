import { useEffect, useRef } from 'react';
import { initials } from '../format';

/**
 * Decode an image's `src` up front (the moment it mounts), so when the element
 * is finally painted it appears instantly instead of as a blank box that fills
 * in a beat later. This matters for the galaxy orbs: their intro animation holds
 * them at opacity 0 for a stagger delay, and an unpainted <img> doesn't get its
 * data URL decoded until first paint (the reveal). Decoding eagerly here uses
 * that idle delay window so the face lands together with the orb shell.
 */
function useDecodedImage(dataUrl?: string) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    ref.current?.decode?.().catch(() => {
      /* a bad/blank data URL just falls back to normal lazy paint */
    });
  }, [dataUrl]);
  return ref;
}

/** Round profile photo, or an initials circle when no image cached (§8). */
export function Avatar({
  dataUrl,
  name,
  size = 72,
}: {
  dataUrl?: string;
  name: string;
  size?: number;
}) {
  const ref = useDecodedImage(dataUrl);
  const style = { width: size, height: size } as const;
  if (dataUrl) {
    return (
      <img ref={ref} className="avatar" style={style} src={dataUrl} alt={name} />
    );
  }
  return (
    <div className="avatar avatar--fallback" style={style} aria-label={name}>
      {initials(name)}
    </div>
  );
}

/** Square company logo, or an initial-letter tile when no image cached (§8). */
export function CompanyLogo({
  dataUrl,
  name,
  size = 48,
}: {
  dataUrl?: string;
  name: string;
  size?: number;
}) {
  const ref = useDecodedImage(dataUrl);
  const style = { width: size, height: size } as const;
  if (dataUrl) {
    return <img ref={ref} className="logo" style={style} src={dataUrl} alt={name} />;
  }
  return (
    <div className="logo logo--fallback" style={style} aria-label={name}>
      {initials(name).slice(0, 1)}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}
