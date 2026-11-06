import type { SiteKind } from '@clanfire/engine';
import { UTILITY_ART } from './siteArt.ts';

const INK = '#2B211C';
const STONE = '#BDB5A6';
const STONE_HI = '#D8D1C2';
const STONE_LO = '#8E8678';
const SUN = '#F2B33D';

function Stone({ x, y, h }: { x: number; y: number; h: number }) {
  return <path d={`M${x - 6} ${y}L${x - 4.5} ${y - h + 6}Q${x} ${y - h - 4} ${x + 4.5} ${y - h + 6}L${x + 6} ${y}Z`} fill={STONE} />;
}

/** The map's site marker as a small SVG (panel header and map key): plinth, stones and a brazier, lit when awake; a signpost (Waymark) or a watchtower (Lookout). */
export function SiteGlyph({ kind, awake, size = 72 }: { kind: SiteKind; awake: boolean; size?: number }) {
  const great = kind === 'great_fire';
  if (kind === 'waymark' || kind === 'lookout') {
    return (
      <svg className="wm-glyph-fit" viewBox="-48 -82 96 106" width={size} height={Math.round((size * 106) / 96)} aria-hidden="true" focusable="false">
        <g stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" fill="none">
          <ellipse cx="3" cy="4" rx="34" ry="17" fill="rgba(43,33,28,0.28)" stroke="none" />
          {UTILITY_ART[kind].map((op, i) => (
            <path key={i} d={op.d} fill={op.fill ?? 'none'} stroke={op.stroke ?? INK} strokeWidth={op.sw ?? 3} />
          ))}
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="-48 -76 96 100" width={size} height={Math.round((size * 100) / 96)} aria-hidden="true" focusable="false">
      <g stroke={INK} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        <ellipse cx="3" cy="4" rx="34" ry="17" fill="rgba(43,33,28,0.28)" stroke="none" />
        <Stone x={0} y={-14} h={30} />
        <path d="M-32 -12V0A32 16 0 0 0 32 0V-12A32 16 0 0 1 -32 -12Z" fill={STONE_LO} />
        <ellipse cx="0" cy="-12" rx="32" ry="16" fill={STONE_HI} />
        <ellipse cx="0" cy="-12" rx="20" ry="10" fill={STONE} strokeWidth="2" />
        <path d="M-13 -19Q-12 -4 0 -3Q12 -4 13 -19Z" fill="#5A4A40" />
        <ellipse cx="0" cy="-19" rx="13" ry="5" fill="#3E3028" />
        {awake ? (
          <g transform={`translate(0 -19) scale(${great ? 1.2 : 1})`}>
            <ellipse cx="0" cy="-17" rx="26" ry="28" fill="rgba(242,179,61,0.26)" stroke="none" />
            <path d="M0 -2C-14 -14 -8 -34 0 -50C8 -34 14 -14 0 -2Z" fill="#E0703F" />
            <path d="M0 -2C-14 -14 -8 -34 0 -50C8 -34 14 -14 0 -2Z" fill={SUN} stroke="none" transform="scale(0.72)" />
            <path d="M0 -2C-14 -14 -8 -34 0 -50C8 -34 14 -14 0 -2Z" fill="#FFF1B8" stroke="none" transform="scale(0.4)" />
          </g>
        ) : (
          <>
            <ellipse cx="0" cy="-19" rx="10" ry="3.6" fill={STONE_LO} stroke="none" />
            <circle cx="2" cy="-19.5" r="2" fill="#843A23" stroke="none" />
            <path d="M0 -23C-6 -30 6 -36 0 -44" fill="none" stroke="rgba(214,210,202,0.9)" strokeWidth="2" />
          </>
        )}
        <Stone x={-27} y={-4} h={24} />
        <Stone x={27} y={-4} h={24} />
        {great && (
          <>
            <Stone x={-14} y={9} h={18} />
            <Stone x={14} y={9} h={18} />
            <path d="M-32 -12A32 16 0 0 0 32 -12" fill="none" stroke={SUN} />
          </>
        )}
      </g>
    </svg>
  );
}
