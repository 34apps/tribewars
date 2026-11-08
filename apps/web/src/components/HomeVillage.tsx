// The homepage's village: a pre-rendered picture of the REAL scene (every building at max level), not the live scene art,
// so it shows almost at once and the lobby bundle stays small. A tiny inlined placeholder paints with the first frame
// (with the flame loader on top) and the sharp picture fades in over it.
//
// The pictures are generated: after building art, the landscape or the scene layout change, run `npm run home:art`
// (scripts/render-home-village.mjs; src/dev/HomeVillageLive.tsx is what it photographs) and commit src/art/home-village/.

import { useEffect, useRef, useState } from 'react';
import { HOME_ART } from '../art/home-village/index.ts';
import { Flame } from './Flame.tsx';

const { sources, stageW, stageH, frameW, frameH, placeholder } = HOME_ART;
const SRC_SET = sources.map((s) => `${s.src} ${s.width}w`).join(', ');
// The picture is shown at the scale the live scene had: the village box fills the hero frame (see .home-village-art).
// ~ the hero frame is 64 % of the viewport on desktop and the full width on a phone.
const SIZES = '(min-width: 900px) 64vw, 112vw';

export default function HomeVillage({ onReady }: { onReady?: () => void }) {
  const [ready, setReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Already in the cache: onLoad may have fired before React attached it.
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setReady(true);
  }, []);
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);
  const mid = sources[1] ?? sources[0]!;
  return (
    <div
      className={`home-village-art${ready ? ' is-ready' : ''}`}
      data-ready={ready ? 'true' : 'false'}
      style={{ '--art-ratio': stageW / stageH, '--art-k': frameW / stageW, '--art-aspect': `${frameW} / ${frameH}`, '--art-ph': `url("${placeholder}")` } as React.CSSProperties}
    >
      <img
        ref={imgRef}
        className="home-village-img"
        src={mid.src}
        srcSet={SRC_SET}
        sizes={SIZES}
        width={frameW}
        height={frameH}
        alt="A fully built Clanfire village"
        fetchPriority="high"
        decoding="async"
        onLoad={() => setReady(true)}
        onError={() => setReady(true)}
      />
      <span className="home-village-loader" aria-hidden="true">
        <Flame size={72} loading />
      </span>
    </div>
  );
}
