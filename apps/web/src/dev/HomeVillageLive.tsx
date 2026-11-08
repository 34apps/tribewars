// DEV ONLY (never imported by the app): the homepage's village drawn live from the real scene art (SceneArt from the
// in-game village) with every building at its max level, village tier 3 (most landscape), the default 'tiles' landscape
// and the hearth burning. No game state, no labels, no buttons. scripts/render-home-village.mjs screenshots it into the
// pictures the homepage actually shows (components/HomeVillage.tsx). Open /render-home.html on the dev server to see it.

import { useEffect, useState } from 'react';
import { BUILDINGS, BUILDING_IDS } from '@clanfire/engine';
import { SCENE_VIEWBOX, buildingStage, loadSprite, spriteUrl, wallLook } from '../art/buildings.ts';
import type { Stage } from '../art/buildings.ts';
import { SceneArt } from '../views/village/VillageScene.tsx';
import type { Arts } from '../views/village/VillageScene.tsx';
import '../views/village/village.css';

/** Every building at its max level: the grandest look, no queue work, nothing locked. */
const MAX_ARTS = Object.fromEntries(
  BUILDING_IDS.map((id) => {
    const max = BUILDINGS[id].maxLevel;
    return [id, { stage: id === 'wall' ? wallLook(max) : buildingStage(id, max), queued: false, active: false, locked: false }];
  }),
) as Arts;

const VB = SCENE_VIEWBOX;
const noBox = () => undefined;

export default function HomeVillage() {
  // Wait for the building drawings so the village fades in whole instead of popping in piece by piece.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const urls = BUILDING_IDS.filter((id) => id !== 'wall').map((id) => spriteUrl(id, 4 as Stage));
    void Promise.allSettled(urls.map((u) => loadSprite(u))).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className={`home-village-stage${ready ? ' is-ready' : ''}`} role="img" aria-label="A fully built Clanfire village" data-ready={ready ? 'true' : 'false'} style={{ '--vb-ratio': VB.w / VB.h } as React.CSSProperties}>
      <SceneArt arts={MAX_ARTS} vb={VB} tier={3} wide landscape="tiles" selected={null} hearthOut={false} onBox={noBox} onPick={noBox} memoryKey="home" />
    </div>
  );
}
