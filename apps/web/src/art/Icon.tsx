// Drawn icons for Clanfire (style D · Toy Diorama). Most shapes come straight from the approved artboards in
// design/style-directions/artboards (VillageViewDesktop / VillageViewPhone / ToyMap); the small status and unit
// glyphs at the end are drawn here in the same style (ink outline, 3-tone block shading lit from the top left).
// To restyle an icon, replace its `draw` body; names are stable.

import { useId } from 'react';
import type { ReactNode } from 'react';

const INK = '#2B211C';

/** Toy 3-tone shape: light fill, dark rim offset by `s`, mid face shifted by (x, y), ink outline. */
export function T({
  u,
  d,
  l,
  k,
  m,
  s,
  x,
  y,
  w,
  o = INK,
}: {
  u: string;
  d: string;
  l: string;
  k: string;
  m: string;
  s: number;
  x: number;
  y: number;
  w: number;
  o?: string;
}) {
  const off = `translate(${s} ${s})`;
  return (
    <>
      <defs>
        <path id={u} d={d} />
        <clipPath id={`${u}a`}>
          <use href={`#${u}`} />
        </clipPath>
        <clipPath id={`${u}b`}>
          <use href={`#${u}`} transform={off} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${u}a)`}>
        <use href={`#${u}`} fill={l} />
        <use href={`#${u}`} fill={k} transform={off} />
        <g clipPath={`url(#${u}b)`}>
          <use href={`#${u}`} fill={m} transform={`translate(${x} ${y})`} />
        </g>
      </g>
      <use href={`#${u}`} fill="none" stroke={o} strokeWidth={w} strokeLinejoin="round" />
    </>
  );
}

interface IconDef {
  vb: string;
  draw: (u: string) => ReactNode;
}

const ICONS = {
  flame: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path
          d="M16 3c6 6 9 11 7 17c-1.4 4-4.4 6-7 6s-5.6-2-7-6c-1.2-3.6 0.4-7 3-9.4c0 2.6 1 4 2.4 3.4c1.4-3.6-0.6-6.6 1.6-11z"
          fill="#F2B33D"
          stroke="#2B211C"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M16 15c2.4 2.4 3 4.4 2.2 6.2c-0.6 1.4-1.4 2-2.2 2s-1.8-0.6-2.4-2c-0.6-1.6 0.2-3.2 1.2-4c0.2 1 0.6 1.2 0.9 1c0.4-1 0-2 0.3-3.2z"
          fill="#FFF8E8"
        />
      </>
    ),
  },
  village: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path d="M6 15v12h20V15" fill="#F1E1C2" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
        <path d="M20 15v12h6V15z" fill="#C6AF88" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
        <path d="M3 16L16 5L29 16" fill="#C4623A" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M3 16L16 5L16 9L6 17.5z" fill="#EF9C6E" />
        <path d="M3 16L16 5L29 16" fill="none" stroke="#2B211C" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M12 27v-6a2 2 0 0 1 4 0v6z" fill="#714B29" stroke="#2B211C" strokeWidth="1.6" />
        <rect x="21" y="18" width="3" height="3.5" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.2" />
      </>
    ),
  },
  map: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path d="M2 18L16 11L30 18L16 25z" fill="#A6C964" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
        <path d="M2 18v3l14 7v-3z" fill="#B07D46" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
        <path d="M16 25v3l14-7v-3z" fill="#714B29" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
        <path d="M9 18.5L14 16" stroke="#2F9AA0" strokeWidth="3" strokeLinecap="round" />
        <path d="M19 20l2.5-1.3" stroke="#2B211C" strokeWidth="1.4" strokeDasharray="1.6 1.6" />
        <path d="M20 18V4" stroke="#2B211C" strokeWidth="2" strokeLinecap="round" />
        <path d="M20 4.5h8l-2.5 3l2.5 3h-8z" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
      </>
    ),
  },
  army: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M6 27L25 5" fill="none" stroke="#714B29" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 3l5-1l-1 5z" fill="#E0DCD3" stroke="#2B211C" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M26 27L8 7" fill="none" stroke="#714B29" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 4c4-2 8 0 8 4l-5 4c-3-1-4-5-3-8z" fill="#A39E94" stroke="#2B211C" strokeWidth="1.6" strokeLinejoin="round" />
        <T
          u={u + '0'}
          d="M8 13C8 13 24 13 24 13C24 13 24.3 19.5 23 22C21.7 24.5 18.3 28 16 28C13.7 28 10.3 24.5 9 22C7.7 19.5 8 13 8 13Z"
          l="#EF9C6E"
          k="#843A23"
          m="#C4623A"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <path
          d="M16 15.5c2.6 2.6 3.2 5 1.8 6.6c-1 1-2.6 1-3.6 0c-1.2-1.4-0.6-3 0.6-4c0 1 0.6 1.4 1 1c0.4-1.2-0.2-2.2 0.2-3.6z"
          fill="#F2B33D"
          stroke="#2B211C"
          strokeWidth="1"
        />
      </>
    ),
  },
  reports: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + '0'}
          d="M6.2 8Q6 6 8 6L22 6Q24 6 24.2 8L25.8 24Q26 26 24 26L10 26Q8 26 7.8 24Z"
          l="#FFF8E8"
          k="#C6AF88"
          m="#F1E1C2"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <T
          u={u + '1'}
          d="M5 9L25 9A3 3 0 0 0 25 3L5 3A3 3 0 0 0 5 9Z"
          l="#FFF8E8"
          k="#C6AF88"
          m="#F1E1C2"
          s={1.2}
          x={-1.12}
          y={-1.4}
          w={1.8}
        />
        <path d="M10 12h11M10 16h11M10 20h6" fill="none" stroke="#C6AF88" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <T
          u={u + '2'}
          d="M17.1 22.5A4.4 4.4 0 1 0 25.9 22.5A4.4 4.4 0 1 0 17.1 22.5Z"
          l="#EF9C6E"
          k="#843A23"
          m="#C4623A"
          s={1.2}
          x={-1.28}
          y={-1.6}
          w={1.8}
        />
        <path d="M21.5 20.3l1.5 2.2l-1.5 2.2l-1.5-2.2z" fill="#843A23" />
      </>
    ),
  },
  tribe: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M7 29V4" fill="none" stroke="#714B29" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="4" r="2.4" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.6" />
        <T
          u={u + '0'}
          d="M8 6C8 6 27 6 27 6C27 6 27 22 27 22C27 22 20.7 18 17.5 18C14.3 18 8 22 8 22C8 22 8 6 8 6Z"
          l="#B86C92"
          k="#4A213C"
          m="#7A3B5E"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <path
          d="M17.5 7.5c3 3 4 6 2.3 8c-1.2 1.2-3.4 1.2-4.6 0c-1.4-1.6-0.8-3.6 0.8-5c0 1.2 0.8 1.8 1.3 1.2c0.4-1.4-0.2-2.6 0.2-4.2z"
          fill="#F2B33D"
          stroke="#2B211C"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  wood: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + '0'}
          d="M5 17.2L23 17.2A5.2 5.2 0 0 0 23 6.8L5 6.8A5.2 5.2 0 0 0 5 17.2Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <ellipse cx="23" cy="12" rx="4.6" ry="5.2" fill="#E4B67C" stroke="#2B211C" strokeWidth="1.8" />
        <ellipse cx="23" cy="12" rx="2" ry="2.4" fill="none" stroke="#714B29" strokeWidth="1.2" />
        <T
          u={u + '1'}
          d="M8 27.2L26 27.2A5.2 5.2 0 0 0 26 16.8L8 16.8A5.2 5.2 0 0 0 8 27.2Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <ellipse cx="26" cy="22" rx="4.6" ry="5.2" fill="#E4B67C" stroke="#2B211C" strokeWidth="1.8" />
        <ellipse cx="26" cy="22" rx="2" ry="2.4" fill="none" stroke="#714B29" strokeWidth="1.2" />
        <path
          d="M10 9.5L17 9.5M12 19.5L19 19.5"
          fill="none"
          stroke="#714B29"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  food: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + '0'}
          d="M12.3 20.2L22.3 28.2A2.8 2.8 0 0 0 25.7 23.8L15.7 15.8A2.8 2.8 0 0 0 12.3 20.2Z"
          l="#FFF8E8"
          k="#C6AF88"
          m="#F1E1C2"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <T
          u={u + '1'}
          d="M22.5 24.5A3 3 0 1 0 28.5 24.5A3 3 0 1 0 22.5 24.5Z"
          l="#FFF8E8"
          k="#C6AF88"
          m="#F1E1C2"
          s={1.2}
          x={-1.2}
          y={-1.5}
          w={1.8}
        />
        <T
          u={u + '2'}
          d="M19.5 28A3 3 0 1 0 25.5 28A3 3 0 1 0 19.5 28Z"
          l="#FFF8E8"
          k="#C6AF88"
          m="#F1E1C2"
          s={1.2}
          x={-1.2}
          y={-1.5}
          w={1.8}
        />
        <T
          u={u + '3'}
          d="M5 14C4.8 11.5 6.2 7.8 8 6C9.8 4.2 13.5 2.7 16 3C18.5 3.3 22 5.8 23 8C24 10.2 23.2 13.8 22 16C20.8 18.2 18.2 20.2 16 21C13.8 21.8 10.8 22.2 9 21C7.2 19.8 5.2 16.5 5 14Z"
          l="#EF9C6E"
          k="#843A23"
          m="#C4623A"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <ellipse cx="10" cy="9" rx="2.6" ry="1.6" transform="rotate(-30 10 9)" fill="#FFFFFF" opacity="0.7" />
      </>
    ),
  },
  iron: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path d="M14 16.5L28 13L29 21L13 25Z" fill="#665F57" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 12L14 16.5L13 25L4 20Z" fill="#A39E94" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 12L22 9L28 13L14 16.5Z" fill="#E0DCD3" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M12 12.2L21 10.4" fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  gold: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path d="M6 23v4a10 4 0 0 0 20 0v-4z" fill="#B07720" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
        <ellipse cx="16" cy="23" rx="10" ry="4" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.8" />
        <path d="M6 17v4a10 4 0 0 0 20 0v-4z" fill="#B07720" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
        <ellipse cx="16" cy="17" rx="10" ry="4" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.8" />
        <path d="M6 11v4a10 4 0 0 0 20 0v-4z" fill="#B07720" stroke="#2B211C" strokeWidth="1.8" strokeLinejoin="round" />
        <ellipse cx="16" cy="11" rx="10" ry="4" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.8" />
        <ellipse cx="16" cy="11" rx="5.4" ry="1.9" fill="none" stroke="#FFDC7A" strokeWidth="1.5" />
      </>
    ),
  },
  time: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + '0'}
          d="M7 5.5Q7 4 8.5 4L23.5 4Q25 4 25 5.5L25 6.5Q25 8 23.5 8L8.5 8Q7 8 7 6.5Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <T
          u={u + '1'}
          d="M7 25.5Q7 24 8.5 24L23.5 24Q25 24 25 25.5L25 26.5Q25 28 23.5 28L8.5 28Q7 28 7 26.5Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <path
          d="M10 8h12c0 5-4 6-4 8s4 3 4 8H10c0-5 4-6 4-8s-4-3-4-8z"
          fill="#7AD3CD"
          stroke="#2B211C"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M12.5 22.5c1-2 2.5-3 3.5-3s2.5 1 3.5 3z" fill="#F2B33D" />
        <path d="M13 11h6l-3 3z" fill="#F2B33D" />
      </>
    ),
  },
  upgrade: {
    vb: '0 0 22 22',
    draw: () => (
      <>
        <path d="M11 2L20 11H15V20H7V11H2Z" fill="#FFF8E8" stroke="#2B211C" strokeWidth="2.2" strokeLinejoin="round" />
      </>
    ),
  },
  train: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M6 27L25 5" fill="none" stroke="#714B29" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M23 3l5-1l-1 5z" fill="#E0DCD3" stroke="#2B211C" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M26 27L8 7" fill="none" stroke="#714B29" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 4c4-2 8 0 8 4l-5 4c-3-1-4-5-3-8z" fill="#A39E94" stroke="#2B211C" strokeWidth="1.6" strokeLinejoin="round" />
        <T
          u={u + '0'}
          d="M8 13C8 13 24 13 24 13C24 13 24.3 19.5 23 22C21.7 24.5 18.3 28 16 28C13.7 28 10.3 24.5 9 22C7.7 19.5 8 13 8 13Z"
          l="#EF9C6E"
          k="#843A23"
          m="#C4623A"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <path
          d="M16 15.5c2.6 2.6 3.2 5 1.8 6.6c-1 1-2.6 1-3.6 0c-1.2-1.4-0.6-3 0.6-4c0 1 0.6 1.4 1 1c0.4-1.2-0.2-2.2 0.2-3.6z"
          fill="#F2B33D"
          stroke="#2B211C"
          strokeWidth="1"
        />
      </>
    ),
  },
  queue: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + '0'}
          d="M7 5.5Q7 4 8.5 4L23.5 4Q25 4 25 5.5L25 6.5Q25 8 23.5 8L8.5 8Q7 8 7 6.5Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <T
          u={u + '1'}
          d="M7 25.5Q7 24 8.5 24L23.5 24Q25 24 25 25.5L25 26.5Q25 28 23.5 28L8.5 28Q7 28 7 26.5Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.2}
          x={-1.92}
          y={-2.4}
          w={1.8}
        />
        <path
          d="M10 8h12c0 5-4 6-4 8s4 3 4 8H10c0-5 4-6 4-8s-4-3-4-8z"
          fill="#7AD3CD"
          stroke="#2B211C"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M12.5 22.5c1-2 2.5-3 3.5-3s2.5 1 3.5 3z" fill="#F2B33D" />
        <path d="M13 11h6l-3 3z" fill="#F2B33D" />
      </>
    ),
  },
  arrowRight: {
    vb: '0 0 14 12',
    draw: () => (
      <>
        <path d="M1 6h10M7 2l4 4l-4 4" fill="none" stroke="#FFDC7A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  sign: {
    vb: '0 0 20 20',
    draw: () => (
      <>
        <path d="M10 19V9" stroke="#2B211C" strokeWidth="2.4" strokeLinecap="round" />
        <rect x="2" y="3" width="16" height="8" rx="2" fill="#F2B33D" stroke="#2B211C" strokeWidth="1.8" />
      </>
    ),
  },
  scaffold: {
    vb: '0 0 20 20',
    draw: () => (
      <>
        <path d="M4 18V3M16 18V3M3 7h14M3 13h14M4 18L16 7" stroke="#714B29" strokeWidth="2.2" strokeLinecap="round" />
      </>
    ),
  },
  marker: {
    vb: '0 0 28 26',
    draw: () => (
      <>
        <path d="M8 2h12v9h6L14 24L2 11h6z" fill="#F2B33D" stroke="#2B211C" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M11 5v7" stroke="#FFDC7A" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  tail: {
    vb: '0 0 14 22',
    draw: () => (
      <>
        <path d="M14 1L1 14L14 21" fill="#7AD3CD" stroke="#2B211C" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M12.5 3L12.5 19" stroke="#7AD3CD" strokeWidth="3" />
      </>
    ),
  },
  drag: {
    vb: '0 0 22 22',
    draw: () => (
      <>
        <path
          d="M11 2v18M2 11h18M11 2l-3 3M11 2l3 3M11 20l-3-3M11 20l3-3M2 11l3-3M2 11l3 3M20 11l-3-3M20 11l-3 3"
          fill="none"
          stroke="#FFDC7A"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </>
    ),
  },
  send: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path d="M6 27L25 5" stroke="#2B211C" strokeWidth="3" strokeLinecap="round" />
        <path d="M23 3l6-1l-1 6z" fill="#FFF8E8" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
        <path d="M26 27L8 7" stroke="#2B211C" strokeWidth="3" strokeLinecap="round" />
        <path d="M4 4c4-2 9 0 9 5l-5 4c-3-1-5-6-4-9z" fill="#FFF8E8" stroke="#2B211C" strokeWidth="2" strokeLinejoin="round" />
      </>
    ),
  },
  // ---- Drawn for the client in the artboard style ----
  shield: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + 'a'}
          d="M16 3L27 7.5V15C27 22 22 27 16 29.5C10 27 5 22 5 15V7.5Z"
          l="#7AD3CD"
          k="#1A646B"
          m="#2F9AA0"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <path d="M16 8V25M9.5 14H22.5" stroke="#FFF8E8" strokeWidth="2.4" strokeLinecap="round" />
      </>
    ),
  },
  warning: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + 'a'}
          d="M14.3 4.8Q16 2 17.7 4.8L29.2 25.2Q30.8 28 27.6 28H4.4Q1.2 28 2.8 25.2Z"
          l="#FFDC7A"
          k="#B07720"
          m="#F2B33D"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <path d="M16 11V19" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <circle cx="16" cy="23.5" r="1.9" fill={INK} />
      </>
    ),
  },
  lock: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M10 15V11A6 6 0 0 1 22 11V15" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M10 15V11A6 6 0 0 1 22 11V15" fill="none" stroke="#A39E94" strokeWidth="2.2" strokeLinecap="round" />
        <T
          u={u + 'a'}
          d="M7 16Q7 14 9 14H23Q25 14 25 16V26Q25 28 23 28H9Q7 28 7 26Z"
          l="#FFDC7A"
          k="#B07720"
          m="#F2B33D"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <path d="M16 19.5V23.5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
      </>
    ),
  },
  pin: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <ellipse cx="16" cy="28.5" rx="6" ry="2" fill={INK} opacity="0.25" />
        <T
          u={u + 'a'}
          d="M16 29C16 29 6 19 6 12.5A10 10 0 0 1 26 12.5C26 19 16 29 16 29Z"
          l="#EF9C6E"
          k="#843A23"
          m="#C4623A"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <circle cx="16" cy="12.5" r="3.8" fill="#FFF8E8" stroke={INK} strokeWidth="1.8" />
      </>
    ),
  },
  scout: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T u={u + 'a'} d="M4.5 21.5L19.5 9.5L23.5 14.5L8.5 26.5Z" l="#E0DCD3" k="#665F57" m="#A39E94" s={1.2} x={-1.9} y={-2.4} w={2} />
        <T u={u + 'b'} d="M18 7L23.5 2.6L29.4 10L23.9 14.4Z" l="#FFDC7A" k="#B07720" m="#F2B33D" s={1.2} x={-1.9} y={-2.4} w={2} />
        <path d="M11 18.5l3.5 4.4" stroke={INK} strokeWidth="1.6" />
      </>
    ),
  },
  support: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M9 29V4" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        <T u={u + 'a'} d="M10 5H26L22.5 10.5L26 16H10Z" l="#7AD3CD" k="#1A646B" m="#2F9AA0" s={1.2} x={-1.9} y={-2.4} w={2} />
        <path d="M15 10.5H20M17.5 8V13" stroke="#FFF8E8" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  return: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + 'a'}
          d="M12 4L3 12L12 20V15H19A6 6 0 0 1 19 27H13V31H19A10 10 0 0 0 19 11H12Z"
          l="#FFDC7A"
          k="#B07720"
          m="#F2B33D"
          s={1.2}
          x={-1.9}
          y={-2.4}
          w={2}
        />
      </>
    ),
  },
  tree: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M16 30V18" stroke="#714B29" strokeWidth="4" strokeLinecap="round" />
        <T u={u + 'a'} d="M5 14A11 11 0 1 0 27 14A11 11 0 1 0 5 14Z" l="#A6C964" k="#3A5E27" m="#5E8C3A" s={1.6} x={-2.6} y={-3.2} w={2} />
      </>
    ),
  },
  ruin: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + 'a'}
          d="M4 28V15L8 12V8H12V14L16 11L19 15H23V10H27V28Z"
          l="#E0DCD3"
          k="#665F57"
          m="#A39E94"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <path d="M11 28V22A2.5 2.5 0 0 1 16 22V28" fill={INK} />
      </>
    ),
  },
  close: {
    vb: '0 0 32 32',
    draw: () => <path d="M9 9L23 23M23 9L9 23" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />,
  },
  back: {
    vb: '0 0 32 32',
    draw: () => (
      <path d="M19 7L10 16L19 25" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  // Units: simple tokens until the unit art pass (see design/style-directions/artboards/ToyCast.dc.html).
  pikeman: {
    vb: '0 0 32 32',
    draw: () => (
      <>
        <path d="M7 29L23 7" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M7 29L23 7" stroke="#B07D46" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M21 3L29 1.5L27.5 9.5L22 11L19.5 8.5Z" fill="#E0DCD3" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M17 11.5L22.5 15.5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M17 11.5L22.5 15.5" stroke="#C4623A" strokeWidth="1" strokeLinecap="round" />
      </>
    ),
  },
  guard: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + 'a'}
          d="M7 4H25V19C25 24 21 28 16 30C11 28 7 24 7 19Z"
          l="#EF9C6E"
          k="#843A23"
          m="#C4623A"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <path d="M16 4V30M7 13H25" stroke={INK} strokeWidth="1.6" />
        <circle cx="16" cy="13" r="3" fill="#F2B33D" stroke={INK} strokeWidth="1.6" />
      </>
    ),
  },
  raider: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M8 29L22 8" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M8 29L22 8" stroke="#B07D46" strokeWidth="2.2" strokeLinecap="round" />
        <T
          u={u + 'a'}
          d="M17 5C21 1 28 2 30 6C27 6 24 9 25 13C22 12 18 10 17 5Z"
          l="#E0DCD3"
          k="#665F57"
          m="#A39E94"
          s={1.2}
          x={-1.9}
          y={-2.4}
          w={2}
        />
      </>
    ),
  },
  outrider: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T
          u={u + 'a'}
          d="M9 29C9 22 11 18 13 15L11 9L14 5L17 8C22 7 27 11 28 17L28 21C26 23 24 23 22 21L19 18C18 22 19 26 21 29Z"
          l="#E4B67C"
          k="#714B29"
          m="#B07D46"
          s={1.4}
          x={-2.2}
          y={-2.8}
          w={2}
        />
        <path d="M14 7C12 11 11 15 9 19" fill="none" stroke="#5E3F22" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="21" cy="13" r="1.6" fill={INK} />
      </>
    ),
  },
  knight: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <path d="M16 5C14 2 19 1 21 3" fill="none" stroke="#C4623A" strokeWidth="3" strokeLinecap="round" />
        <T u={u + 'a'} d="M7 15A9 10 0 0 1 25 15V28H7Z" l="#E0DCD3" k="#665F57" m="#A39E94" s={1.4} x={-2.2} y={-2.8} w={2} />
        <path d="M10 16.5H22" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M16 20V26" stroke={INK} strokeWidth="1.6" />
        <path d="M7 28H25" stroke="#F2B33D" strokeWidth="2.4" />
      </>
    ),
  },
  pathfinder: {
    vb: '0 0 32 32',
    draw: (u) => (
      <>
        <T u={u + 'a'} d="M4.5 21.5L19.5 9.5L23.5 14.5L8.5 26.5Z" l="#E4B67C" k="#714B29" m="#B07D46" s={1.2} x={-1.9} y={-2.4} w={2} />
        <T u={u + 'b'} d="M18 7L23.5 2.6L29.4 10L23.9 14.4Z" l="#FFDC7A" k="#B07720" m="#F2B33D" s={1.2} x={-1.9} y={-2.4} w={2} />
      </>
    ),
  },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** One drawn icon. Decorative (aria-hidden) unless `label` is given. */
export function Icon({ name, size = 24, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  const u = `i${useId().replace(/[^\w-]/g, '')}`;
  const def: IconDef = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={def.vb}
      className={className ? `icon ${className}` : 'icon'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {def.draw(u)}
    </svg>
  );
}
