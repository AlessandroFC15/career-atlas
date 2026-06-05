import { useEffect, useMemo, useState } from 'react';
import { loadSeed } from '../storage';
import { runSeed, SeedError } from '../orchestrator';
import { formatTenure } from '../format';
import type { DateParts, Seed } from '../types';
import { Avatar, CompanyLogo, Spinner } from './components';

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'seeding'; message: string }
  | { kind: 'seeded'; seed: Seed }
  | { kind: 'error'; code: string; message: string };

/** Sort key: oldest start first (chronological, m0-plan §10). */
function startValue(d: DateParts): number {
  return d.year * 12 + (d.month ?? 0);
}

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  // Read-on-mount: render any persisted seed (§9).
  useEffect(() => {
    loadSeed().then((seed) => {
      setView(seed ? { kind: 'seeded', seed } : { kind: 'empty' });
    });
  }, []);

  async function handleSeed() {
    setView({ kind: 'seeding', message: 'Starting…' });
    try {
      const seed = await runSeed({
        onProgress: (message) => setView({ kind: 'seeding', message }),
      });
      setView({ kind: 'seeded', seed });
    } catch (err) {
      const e = err instanceof SeedError ? err : null;
      setView({
        kind: 'error',
        code: e?.code ?? 'GENERIC',
        message: e?.message ?? 'Something went wrong.',
      });
    }
  }

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__brand">Career Atlas</span>
      </header>
      <main className="app__main">
        {view.kind === 'loading' && <Spinner />}
        {view.kind === 'empty' && <EmptyState onSeed={handleSeed} />}
        {view.kind === 'seeding' && <SeedingState message={view.message} />}
        {view.kind === 'seeded' && (
          <SeededState seed={view.seed} onReseed={handleSeed} />
        )}
        {view.kind === 'error' && (
          <ErrorState code={view.code} message={view.message} onRetry={handleSeed} />
        )}
      </main>
    </div>
  );
}

function EmptyState({ onSeed }: { onSeed: () => void }) {
  return (
    <div className="center">
      <p className="muted">Build your career graph from your own LinkedIn history.</p>
      <button className="btn btn--primary" onClick={onSeed}>
        Seed my graph
      </button>
    </div>
  );
}

function SeedingState({ message }: { message: string }) {
  return (
    <div className="center">
      <Spinner />
      <p className="muted">{message}</p>
    </div>
  );
}

function ErrorState({
  code,
  message,
  onRetry,
}: {
  code: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="center">
      <div className="error-card">
        <p className="error-card__title">
          {code === 'LOGGED_OUT' ? 'Not logged in' : 'Seeding failed'}
        </p>
        <p className="muted">{message}</p>
        <button className="btn btn--primary" onClick={onRetry}>
          {code === 'LOGGED_OUT' ? 'Seed again' : 'Retry'}
        </button>
      </div>
    </div>
  );
}

function SeededState({ seed, onReseed }: { seed: Seed; onReseed: () => void }) {
  const ordered = useMemo(
    () => [...seed.experiences].sort((a, b) => startValue(a.start) - startValue(b.start)),
    [seed.experiences],
  );

  return (
    <div className="seeded">
      <section className="profile">
        <Avatar dataUrl={seed.avatarDataUrl} name={seed.name} />
        <div className="profile__meta">
          <h1 className="profile__name">{seed.name}</h1>
          <p className="muted">
            {ordered.length} {ordered.length === 1 ? 'company' : 'companies'}
          </p>
        </div>
        <button className="btn btn--ghost" onClick={onReseed}>
          Re-seed
        </button>
      </section>

      <ul className="company-list">
        {ordered.map((entry, i) => (
          <li className="company-row" key={`${entry.companyUrn ?? entry.companyName}-${i}`}>
            <CompanyLogo dataUrl={entry.logoDataUrl} name={entry.companyName} />
            <div className="company-row__meta">
              <span className="company-row__name">{entry.companyName}</span>
              <span className="muted">{formatTenure(entry)}</span>
              {entry.roles.length > 1 && (
                <span className="company-row__roles">
                  {entry.roles.map((r) => r.title).join(' · ')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
