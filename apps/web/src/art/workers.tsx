// Little toy builders for buildings under construction (owner 2026-11-06: "let them SEE the building being upgraded, with
// workers working around it while the timer runs"). Original drawings in code, Toy Diorama style: flat shapes, warm ink
// outlines, no blur. Animation is plain CSS (.vv-wk-* in views/village/village.css): no per-frame JS.

import type { CSSProperties } from 'react';
import { PLACEMENT, iso, plotUV } from './buildings.ts';
import type { BuildingId } from '@clanfire/engine';

const INK = '#2B211C';
const SKIN = '#F1C9A0';
const CAP = '#F2B33D';
const TUNICS = ['#C4623A', '#2F9AA0', '#C4623A'] as const;

/**
 * One builder, feet at (0, 0), about 15 units tall, facing right (+x); mirror with scale(-1, 1) to face left.
 * The arm with the hammer swings around the shoulder; at each strike a dust puff and two sparks pop at the plank.
 */
function Worker({ tunic, dur, delay, carry }: { tunic: string; dur: number; delay: number; carry?: boolean }) {
  const t = { '--wd': `${dur}s`, animationDelay: `${delay}s` } as CSSProperties;
  return (
    <g strokeLinejoin="round" strokeLinecap="round" strokeWidth={1.2} stroke={INK}>
      {/* the plank being nailed (not for the one carrying a plank) */}
      {!carry && <rect x={5.5} y={-2.4} width={6.5} height={2.4} rx={0.6} fill="#B98A55" />}
      {/* legs */}
      <rect x={-2.4} y={-4.2} width={2} height={4.2} rx={0.8} fill="#5B4636" />
      <rect x={0.6} y={-4.2} width={2} height={4.2} rx={0.8} fill="#5B4636" />
      {/* tunic: light on the left, a darker band on the right (lit from the top left) */}
      <rect x={-3.2} y={-9.6} width={6.4} height={6} rx={2} fill={tunic} />
      <path d="M1.2 -9.4 H1.6 Q3.2 -9.4 3.2 -7.6 V-5.6 Q3.2 -3.8 1.6 -3.8 H1.2 Z" fill="#000" fillOpacity={0.14} stroke="none" />
      {/* head and yellow cap with a little peak */}
      <circle cx={0.4} cy={-12} r={3.1} fill={SKIN} />
      <path d="M-2.8 -12.6 Q-2.6 -16 0.6 -15.8 Q3.4 -15.6 3.5 -12.6 Z" fill={CAP} />
      <path d="M2.6 -12.8 H5.4" fill="none" strokeWidth={1.6} />
      <circle cx={1.6} cy={-11.6} r={0.5} fill={INK} stroke="none" />
      {carry ? (
        // carrying a plank on the shoulder
        <g className="vv-wk-carry">
          <rect x={-6} y={-12.4} width={15} height={2.4} rx={0.8} fill="#B98A55" />
          <path d="M1.5 -9 L3.5 -10" fill="none" strokeWidth={1.8} stroke={SKIN} />
        </g>
      ) : (
        <>
          {/* hammer arm: rotates around the shoulder */}
          <g transform="translate(1.6 -8.2)">
            <g className="vv-wk-arm" style={t}>
              <path d="M0 0 L6.2 0" fill="none" strokeWidth={2.2} stroke={SKIN} />
              <path d="M5.4 0 H8.6" fill="none" strokeWidth={1.4} stroke="#8A5A32" />
              <rect x={7.8} y={-2.4} width={3} height={4.8} rx={0.8} fill="#9AA3AB" />
            </g>
          </g>
          {/* strike: dust puff and sparks, same rhythm as the arm, popping at the plank */}
          <g className="vv-wk-fx" pointerEvents="none" style={t}>
            <circle className="vv-wk-puff" cx={9} cy={-3} r={2.2} fill="#F7F1E3" style={t} />
            <circle className="vv-wk-spark" cx={11} cy={-5} r={0.9} fill="#FFDC7A" strokeWidth={0.6} style={t} />
            <circle className="vv-wk-spark vv-wk-spark-b" cx={7.5} cy={-6} r={0.8} fill="#FFDC7A" strokeWidth={0.6} style={t} />
          </g>
        </>
      )}
    </g>
  );
}

/**
 * The builders of one building, standing on the ground in front of its pad (pad half side = 28 * scale grid units):
 * one at the front-left edge, one at the front-right edge, and for big buildings (scale >= 1.3) a third who carries a plank
 * back and forth along the front edge. They face the building. Pointer events none; the caller draws this after the sprite
 * and scaffold so they stand in front.
 */
export function Workers({ id }: { id: BuildingId }) {
  const sc = PLACEMENT[id].scale;
  const { u, v } = plotUV(id);
  const h = 28 * sc;
  // About 1.3x the first size (owner 2026-11-06: the builders must be easy to see).
  const s = id === 'wall' ? 1.05 : 1.2 + 0.2 * Math.min(sc, 1.4);
  const left = iso(u - 0.7 * h, v + 0.85 * h);
  const right = iso(u + 0.85 * h, v - 0.7 * h);
  const big = sc >= 1.3;
  // The carrier walks along the front-left edge, in front of the pad, towards the front corner and back.
  const from = iso(u - 0.1 * h, v + 1.1 * h);
  const to = iso(u + 0.9 * h, v + 1.1 * h);
  const walk = { '--wx': `${to[0] - from[0]}px`, '--wy': `${to[1] - from[1]}px` } as CSSProperties;
  return (
    <g className="vv-wk" pointerEvents="none" aria-hidden="true">
      {/* left worker faces right (towards the building's centre), right worker faces left */}
      <g transform={`translate(${left[0]} ${left[1]}) scale(${s})`}>
        <Worker tunic={TUNICS[0]} dur={0.65} delay={0} />
      </g>
      <g transform={`translate(${right[0]} ${right[1]}) scale(${-s} ${s})`}>
        <Worker tunic={TUNICS[1]} dur={0.7} delay={-0.3} />
      </g>
      {big && (
        <g transform={`translate(${from[0]} ${from[1]})`}>
          <g className="vv-wk-walk" style={walk}>
            <g className="vv-wk-turn">
              <g transform={`scale(${s})`}>
                <Worker tunic={TUNICS[2]} dur={0.7} delay={0} carry />
              </g>
            </g>
          </g>
        </g>
      )}
    </g>
  );
}
