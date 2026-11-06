// Little toy builders for buildings under construction (owner 2026-11-06: "let them SEE the building being upgraded, with
// workers working around it while the timer runs"). Original drawings in code, Toy Diorama style: flat shapes, warm ink
// outlines, no blur. Animation is plain CSS (.vv-wk-* in views/village/village.css): no per-frame JS.

import type { CSSProperties } from 'react';
import { PLACEMENT, iso, plotUV } from './buildings.ts';
import type { BuildingId } from '@clanfire/engine';

const INK = '#2B211C';
const SKIN = '#F1C9A0';
const SKIN_DARK = '#D9A57A';
const CHEEK = '#E8907A';
/** Builder's felt cap: light, mid and shade (sun yellow, like the units' gold trims). */
const CAP = { light: '#FFE08F', mid: '#F2B33D', dark: '#B9791F' };
const WOOD = { light: '#E4B67C', mid: '#B07D46', dark: '#714B29' };
const BOOT = '#5B4636';
/** Tunic colours from the village palette (terracotta, teal), with their shade. */
const TUNICS = [
  { mid: '#C4623A', dark: '#843A23' },
  { mid: '#2F9AA0', dark: '#1F6B70' },
  { mid: '#5E8C3A', dark: '#3A5E27' },
] as const;
type Tunic = (typeof TUNICS)[number];

/**
 * One builder, drawn like our unit figures (design/sprites/units): a chunky toy piece on a round wooden base, big head,
 * felt cap, rosy cheek, thick warm-ink outline and flat 3-tone shading lit from the top left. Feet at (0, 0), about 46 units
 * tall in these units (the caller scales it down), facing right (+x); mirror with scale(-1, 1) to face left. The hammer arm
 * swings around the shoulder (.vv-wk-arm, -75deg up to +24deg); at each strike a dust puff and sparks pop on the plank
 * lying across a little trestle in front of him. The carrier has a plank on his shoulder instead.
 */
function Worker({ tunic, dur, delay, carry }: { tunic: Tunic; dur: number; delay: number; carry?: boolean }) {
  const t = { '--wd': `${dur}s`, animationDelay: `${delay}s` } as CSSProperties;
  return (
    <g strokeLinejoin="round" strokeLinecap="round" strokeWidth={2.2} stroke={INK}>
      {/* contact shadow and the round wooden toy base */}
      <ellipse cx={1.5} cy={2.2} rx={12.5} ry={4.2} fill={INK} opacity={0.25} stroke="none" />
      <path d="M-11 0 V2 A11 3.8 0 0 0 11 2 V0 Z" fill={WOOD.mid} />
      <ellipse cx={0} cy={0} rx={11} ry={3.8} fill={WOOD.light} />
      {/* the trestle and the plank he is nailing (strike point about 18, -15) */}
      {!carry && (
        <g>
          <path d="M14 0 L16 -13 M22 0 L20 -13" fill="none" stroke={INK} strokeWidth={4.2} />
          <path d="M14 0 L16 -13 M22 0 L20 -13" fill="none" stroke={WOOD.mid} strokeWidth={1.8} />
          <path d="M11 -16.6 H25 V-13 H11 Z" fill={WOOD.light} />
          <path d="M11 -13.9 H25" fill="none" stroke={WOOD.dark} strokeWidth={1} />
        </g>
      )}
      {/* boots */}
      <path d="M-6.2 -7 H-1 V-1.6 Q-1 0 -2.6 0 H-6.2 Q-7.6 0 -7.6 -1.4 V-5.6 Q-7.6 -7 -6.2 -7 Z" fill={BOOT} />
      <path d="M1 -7 H6.2 Q7.6 -7 7.6 -5.6 V-1.4 Q7.6 0 6.2 0 H2.6 Q1 0 1 -1.6 Z" fill={BOOT} />
      {/* back arm (hanging, or holding the plank on the shoulder) */}
      {carry ? (
        <path d="M-6 -21 Q-9 -26 -5 -30" fill="none" stroke={INK} strokeWidth={5.6} />
      ) : (
        <path d="M-6 -21 Q-9.5 -16 -8.5 -12" fill="none" stroke={INK} strokeWidth={5.6} />
      )}
      {carry ? (
        <path d="M-6 -21 Q-9 -26 -5 -30" fill="none" stroke={tunic.dark} strokeWidth={3.2} />
      ) : (
        <path d="M-6 -21 Q-9.5 -16 -8.5 -12" fill="none" stroke={tunic.dark} strokeWidth={3.2} />
      )}
      {!carry && <circle cx={-8.4} cy={-11.2} r={2.3} fill={SKIN} strokeWidth={1.8} />}
      {/* tunic: rounded body, shade on the right, leather apron with a pocket, belt with a gold buckle */}
      <path d="M-7.5 -23 Q-8.6 -15 -8 -7.4 Q0 -5.4 8 -7.4 Q8.6 -15 7.5 -23 Q0 -26 -7.5 -23 Z" fill={tunic.mid} />
      <path d="M3.6 -24.4 Q7.4 -23.6 7.5 -23 Q8.6 -15 8 -7.4 Q5.6 -6.8 3.6 -6.6 Z" fill={tunic.dark} stroke="none" />
      <path d="M-4.6 -16 H4.6 V-8 Q0 -6.6 -4.6 -8 Z" fill={WOOD.mid} strokeWidth={1.8} />
      <path d="M-2 -12.6 H2 V-9.6 H-2 Z" fill={WOOD.dark} strokeWidth={1.2} />
      <path d="M-8 -16.2 Q0 -14.6 8 -16.2" fill="none" stroke={INK} strokeWidth={3.4} />
      <path d="M-8 -16.2 Q0 -14.6 8 -16.2" fill="none" stroke={WOOD.dark} strokeWidth={1.6} />
      <rect x={-1.6} y={-17.2} width={3.2} height={2.6} rx={0.6} fill={CAP.mid} strokeWidth={1} />
      {/* head: big round toy head, cheek, eye with a brow, small smile */}
      <circle cx={0.8} cy={-31} r={8.2} fill={SKIN} />
      <path d="M6.6 -36.6 A8.2 8.2 0 0 1 6.4 -25.6 A9 9 0 0 0 6.6 -36.6 Z" fill={SKIN_DARK} stroke="none" />
      <circle cx={5.6} cy={-28.4} r={1.7} fill={CHEEK} opacity={0.75} stroke="none" />
      <ellipse cx={4.4} cy={-31.6} rx={0.9} ry={1.3} fill={INK} stroke="none" />
      <path d="M2.8 -34.2 L5.8 -33.6" fill="none" strokeWidth={1.2} />
      <path d="M3.4 -27.2 Q5 -26 6.4 -27.4" fill="none" strokeWidth={1.1} />
      {/* felt cap: crown with a highlight and a shaded band, wide brim */}
      <path d="M-6.6 -35.4 Q-6.4 -43.6 1 -43.6 Q8 -43.6 8.2 -35.4 Z" fill={CAP.mid} />
      <path d="M-4.6 -37 Q-4 -41.8 0 -42.4" fill="none" stroke={CAP.light} strokeWidth={1.6} />
      <path d="M-6.6 -36.4 H8.2 V-35 H-6.6 Z" fill={CAP.dark} strokeWidth={1.2} />
      <path d="M-9.4 -35 Q1 -32.4 11.6 -35.4 Q1.4 -37.6 -9.4 -35 Z" fill={CAP.mid} strokeWidth={1.8} />
      {carry ? (
        // the plank on his shoulder, held by the back hand
        <g className="vv-wk-carry">
          <path d="M-14 -33 L14 -27 L14 -23.6 L-14 -29.6 Z" fill={WOOD.light} />
          <path d="M-14 -30.8 L14 -24.8" fill="none" stroke={WOOD.dark} strokeWidth={1} />
          <circle cx={-5} cy={-30} r={2.3} fill={SKIN} strokeWidth={1.8} />
        </g>
      ) : (
        <>
          {/* hammer arm: rotates around the shoulder */}
          <g transform="translate(5 -21)">
            <g className="vv-wk-arm" style={t}>
              <path d="M0 0 L6.4 0" fill="none" stroke={INK} strokeWidth={5.6} />
              <path d="M0 0 L6.4 0" fill="none" stroke={tunic.mid} strokeWidth={3.2} />
              <path d="M8 0 H14.6" fill="none" stroke={INK} strokeWidth={3.6} />
              <path d="M8 0 H14.6" fill="none" stroke={WOOD.mid} strokeWidth={1.6} />
              <circle cx={8} cy={0} r={2.4} fill={SKIN} strokeWidth={1.8} />
              <path d="M13.2 -3.6 H17.6 V3.6 H13.2 Z" fill="#A39E94" strokeWidth={1.8} />
              <path d="M15.8 -3 V3" fill="none" stroke="#7C756B" strokeWidth={1.4} />
            </g>
          </g>
          {/* strike: dust puff and sparks, same rhythm as the arm, popping on the plank */}
          <g className="vv-wk-fx" pointerEvents="none" style={t}>
            <circle className="vv-wk-puff" cx={19} cy={-17.4} r={3.6} fill="#F7F1E3" style={t} />
            <circle className="vv-wk-spark" cx={22.5} cy={-20} r={1.4} fill="#FFDC7A" style={t} />
            <circle className="vv-wk-spark vv-wk-spark-b" cx={16} cy={-21} r={1.2} fill="#FFDC7A" style={t} />
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
  // About 23 scene units tall (owner 2026-11-06: the builders must be easy to see); the figure is drawn 46 units tall.
  const s = (id === 'wall' ? 1.05 : 1.2 + 0.2 * Math.min(sc, 1.4)) * 0.5;
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
