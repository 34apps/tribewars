// The Log sub-tab of the desktop Tribe page (picture: design/proposals/ingame-pages/mix-tribe-log-1440.png): the tribe's events, newest
// first, 11 to a page. The server sends the last 50 with the tribe data.

import { useGame } from '../../game.ts';
import { useTribe } from '../../tribe/context.ts';
import { LOG_PER_PAGE, logTime } from './frame-tribe-logic.ts';
import { PageButtons, usePaged } from './frame-tribe-bits.tsx';

export function FrameTribeLog() {
  const { data } = useTribe();
  const { now } = useGame();
  const log = usePaged(data.events, LOG_PER_PAGE);
  const { pg } = log;
  return (
    <section className="fv-pn frt-grow frt-logp" aria-label="Tribe log">
      <div className="fv-ph frt-ph">
        <h2>Tribe log</h2>
        <span className="fv-sp" />
        <span className="fv-mut">newest first</span>
      </div>
      {data.events.length === 0 ? (
        <p className="fv-empty frt-pad">Nothing has happened yet.</p>
      ) : (
        <table className="frt-lg">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What happened</th>
            </tr>
          </thead>
          <tbody>
            {log.slice.map((e) => (
              <tr key={e.id}>
                <td className="fv-mut">{logTime(e.createdAt, now)}</td>
                <td>{e.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="frt-pgr">
        <span className="fv-mut">{pg.total === 0 ? '0 events' : `${pg.from}–${pg.to} of ${pg.total}`}</span>
        <span className="fv-sp" />
        <PageButtons page={pg.page} pages={pg.pages} onPage={log.setPage} label="events" />
      </div>
    </section>
  );
}
