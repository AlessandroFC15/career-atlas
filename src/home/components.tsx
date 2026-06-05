import { initials } from '../format';

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
  const style = { width: size, height: size } as const;
  if (dataUrl) {
    return (
      <img className="avatar" style={style} src={dataUrl} alt={name} />
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
  const style = { width: size, height: size } as const;
  if (dataUrl) {
    return <img className="logo" style={style} src={dataUrl} alt={name} />;
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
