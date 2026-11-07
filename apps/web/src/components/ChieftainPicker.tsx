// "Choose your chieftain": big preview of the selection plus a grid of the ten (approved artboard ChieftainPicker).
// Loaded lazily (sign-up step and the Change chieftain dialog), so the flavour lines stay out of the main bundle.

import { CHIEFTAINS } from '@clanfire/engine';
import { ChieftainAvatar } from '../art/Chieftain.tsx';
import { CHIEFTAIN_FLAVOUR } from '../art/chieftainLines.ts';
import { Mags } from '../art/Mags.tsx';

export default function ChieftainPicker({
  value,
  onChange,
  welcome,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Show Mags' welcome bubble above the preview (sign-up). */
  welcome?: boolean;
  disabled?: boolean;
}) {
  const sel = CHIEFTAINS.find((c) => c.id === value) ?? CHIEFTAINS[0];
  const flavour = CHIEFTAIN_FLAVOUR[sel.id];
  return (
    <div className="cp">
      {welcome && (
        <div className="cp-mags">
          <span className="cp-mags-face">
            <Mags size={64} />
          </span>
          <p className="cp-bubble">
            <strong>Mags, the Tinker</strong>
            Pick your chieftain.
          </p>
        </div>
      )}
      <div className="cp-stage">
        <ChieftainAvatar id={sel.id} size={160} className="cp-big" eager />
        <div className="cp-info" aria-live="polite" aria-atomic="true">
          <h3 className="cp-name">{sel.name}</h3>
          <span className="cp-pill" style={flavour ? { background: flavour.pill.bg, color: flavour.pill.fg } : undefined}>
            {sel.title}
          </span>
          {flavour && <p className="cp-line">{flavour.line}</p>}
        </div>
      </div>
      <div className="cp-grid" role="group" aria-label="Chieftains">
        {CHIEFTAINS.map((c) => {
          const on = c.id === sel.id;
          return (
            <button key={c.id} type="button" className={`cp-tile${on ? ' is-on' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => onChange(c.id)}>
              <ChieftainAvatar id={c.id} size={56} className="cp-thumb" />
              <span className="cp-tile-name" aria-hidden="true">{c.name.replace('-', '\u2011')}</span>
              {on && (
                <span className="cp-check" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.2 8.6l3 3 6.6-7" fill="none" stroke="#2B211C" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
