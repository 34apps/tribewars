import { formatAgo } from '../format.ts';
import { useGame } from '../game.ts';
import { useTribe } from './context.ts';

export function Log() {
  const { data } = useTribe();
  const { now } = useGame();
  return (
    <section className="card" aria-labelledby="log-title">
      <h2 id="log-title" className="card-title">Tribe log</h2>
      {data.events.length === 0 ? (
        <p className="muted">Nothing has happened yet.</p>
      ) : (
        <ol className="log-list">
          {data.events.map((e) => (
            <li key={e.id}>
              <span className="log-text">{e.text}</span>
              <span className="muted small">{formatAgo(e.createdAt, now)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
