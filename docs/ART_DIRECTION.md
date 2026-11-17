# Art direction and redesign plan

Owner's direction (2026-11-02). Read before any visual work.

## Rules
- **Original art only.** Same genre as Tribal Wars and similar games, but never copy their art,
  layouts, icons or text. Reference screenshots the owner shares describe *structure*, not look;
  don't store them in this repo.
- **No generic "AI" look**: no emoji icons, no gradient washes, no stock fantasy fonts. Every icon and picture is
  drawn for Clanfire. The app UI is **Parchment** (owner, 2026-11-08, replacing the dark brown look): see "UI colours" below.
- **No one-sided accent stripes** (owner, 2026-11-07: "AI slop"): no thick left/right border bar on rows,
  cards or list items. Mark a state with a thin even border, a filled tag or a background instead.
- **Web app first**: desktop browsers and phone browsers from one responsive app; native mobile app later.
- Art starts as hand-drawn SVG; 3D models (e.g. Tripo3D) may come later, so prefer forms that can
  become 3D.
- Work **one piece at a time**, each approved by the owner before it goes into the game.
- Approved designs fix the **general concept**; the owner may still touch up details at the end. Keep
  every piece of art swappable (sprite registries, separate SVG files), never baked into layout code.

## UI colours: Parchment (owner, 2026-11-08)
Warm paper page (`--page` #f6ecd6, very faint board lines), cream panels (`--surface` #fffaf0, rows `--surface-2`, wells
`--surface-3`) with dark ink text (`--on-surface`, `--on-surface-muted`), a soft tan edge and bottom shadow
(`--edge`, `--edge-soft`, `--edge-shadow`), white inputs (`--input-bg`), gold primary buttons. **Game HUD shell (owner, 2026-11-09):** no top bar or tab bar; cream floating pills
(village name, resources, bell, avatar), a floating bottom dock (7 tabs desktop, 5 + More on phones) and full-bleed village art
(`apps/web/src/hud.css`; pictures `design/proposals/ingame-clarity/`). The `--bar*` tokens remain for leftover honey pieces. Small dark pieces (`--dark` with `--on-dark`: tags, "?" buttons,
selected map tabs) and the Attack card/pill (`--strip-danger` with `--on-strip`) stay strong. Village and map art is unchanged.
All tokens live in `:root` of `apps/web/src/styles.css` next to the raw palette; rules use the semantic names, never
`--c-*` for panel or text colours. The bars re-point the same tokens to honey values (one block under `:root`).
Every text is at least 4.5:1 on its background (disabled buttons excepted). The pilot pictures and tooling are in
`design/proposals/app-colours/` (`after/` = the result).

## Village: back to Toy Diorama (owner, 2026-11-04)
The owner tried style B (Painted Miniature) for the village, then chose to stay with **D · Toy Diorama** for the
whole game; design tweaks will be made inside the toy style. B art is kept in `design/style-directions/village-v2/`.

## Chosen style: D · Toy Diorama (owner, 2026-11-02)
Chunky tabletop toy pieces, 3-tone block shading lit from the top-left, vinyl-toy characters on round
bases (3D-ready for Tripo3D later). Palette Moss #5E8C3A, Terracotta #C4623A, Sky teal #2F9AA0,
Sunflower #F2B33D, Plum #7A3B5E, Warm ink #2B211C; neutrals Bone #F1E1C2, Table wood #B07D46,
Iron #A39E94. Fonts Bagel Fat One (display) + Rubik (text). Advisor: Mags the Tinker. Source art:
`design/style-directions/artboards/Toy*.dc.html`.

## Style directions (explored)
Canvas with four directions, each shown as a phone village screen, desktop village screen, character
sheet (6 units, 2 chieftains, advisor) and isometric map:
https://claude.ai/artifact/MBeYhuGXimx6ASUkUGGQDB (private to the owner)
- A · Ember & Ash — firelit night, carved Nordic shapes (Eczar + Sofia Sans Semi Condensed)
- B · Ink & Vermilion — woodcut/linocut chronicle on grey-green paper (Vollkorn)
- C · Heraldic — flat heraldic tinctures, poster style (Alfa Slab One + Archivo)
- D · Toy Diorama — chunky tabletop toy pieces, 3D-ready (Bagel Fat One + Rubik)
Source files: `design/style-directions/` (artboards + renders).

## Structure the owner wants (from his references — structure only)
1. **Village view**: a full illustrated village seen at an isometric angle. Town Hall and the other
   core buildings sit around a central square inside a ring wall; resource buildings (Lumber Camp at
   the forest edge, Farm fields, Iron Mine in rocks, Gold Mine) sit outside the wall, joined by paths.
   Every building shows a level badge and opens its panel when clicked; buildings look different as
   they level up; not-yet-built buildings show as empty plots.
2. **World map**: 2.5D isometric. Each village's picture grows in visible stages as it gains points —
   e.g. a small hamlet with a palisade → larger palisade village → stone walls → walled town → castle
   (with moat at the top). Abandoned villages look ruined. Tribe allegiance shown by banners/colours.
3. **Characters**: a portrait/figure for each unit, selectable chieftain avatars for players, an
   advisor/guide character for tips and the tutorial, and building art.

## Status
- Village view (row E) — **approved** 2026-11-02; being built into the game. Owner may still change or
  improve designs later: keep art swappable (one sprite map module, sprites in `design/sprites/`).
- **Village layout (owner, 2026-11-06):** all buildings stay inside the ring wall in the original arrangement (the owner rejected moving the resource sites outside and a 4-gate plan: "too small, too empty"); the ring is bigger (plate 273) so no two drawings touch at any look; one main gate with an earth ramp to the road. Selection = outline round the drawing + glowing ring on its lot, no marker arrow.
- **Four looks per building (owner, 2026-11-06):** every building has 4 looks; the 4th shows only at the building's max level (stage 3 runs from the level after stage 2's top to max-1). The ring wall's grand look (drawn in code) now also starts at its max level instead of level 18. Buildings without a `<name>-4.svg` yet show their stage-3 drawing at max level.
- **Longhouse and Wrightyard in the village (2026-11-11, originality pieces 2-3):** art from `design/proposals/originality-art/` (v2, owner approved), four looks each (`longhouse-1..4.svg`, `wrightyard-1..4.svg`), stage ends 6 / 15 (Longhouse) and 3 / 7 (Wrightyard). **Roads v2 + plate 312 (2026-11-11, owner: "roads are too direct line ... tiles design better ... make them look bigger like old design"):** plate 312 (16 land tiles, wall `r` 307); every building at full size (Longhouse 1.35 at the front right, Wrightyard 1.3 left of the main street by the gate); the Drill Yard now stands beside the Barracks left of the square, and the Farm, Storehouse, Iron Mine, Lumber Camp, Barracks and Gold Mine moved out a little to fill the bigger ring. The desktop picture fits `SCENE_FIT_BOX` (contain; the frame's 648 x 410 shape) instead of the whole scene box, so buildings are as big as at plate 273 (0.588 px per unit at 1440x900); the empty side tips of the ring and the top of the grand back tower run past the picture's edges. Phones pan the whole scene box at the old zoom. The main street widens into the plaza; roads have rounded bends and the earth ones a gentle sway. No building may stand behind the front corner tower or the gate towers (layout test). **Roads v3 (owner, 2026-11-11):** each road's surface follows the look of the building it leads to: look 1 dirt with wheel ruts and pebbles, 2 gravel with edge stones, 3 cobbles, 4 flagstones with kerbs; a stretch shared by several buildings takes the best of them; the main street and the plaza follow the Town Hall. Every road runs straight in on its building's door line and ends square, with a doorstep in its own surface, just under the front of the drawing at that look (`DOOR_DEPTH` / `roadEnd` in `buildings.ts`, measured from the masks; layout test: no grass gap, no round end). The Longhouse's roof ends carry plain square-cut crossed gable boards (no dragon heads, no knobs; gold at look 4). Pictures: `roads-v3-*.png`, `road-ends-v4.png`, `roads-v4-mixed.png`, `longhouse-v4.png`. Pictures: `design/proposals/village-layout/roads-v2-*.png`. The Firecart has its four poses and icon in `art/units/`. The Log Ram and Boulder Sling drawings stay in the repo, unused.
- Map growth stages (row F) and chieftain portraits (row G) — **approved** 2026-11-02; being built in.
  Map stage = `mapStage(points)` (0/15/35/65/100/150), abandoned villages = `ruinStage(points)` (same 6 steps; sprites `abandoned-stage-1..6`, approved 2026-11-04); chieftains in `CHIEFTAINS`
  (config.ts), chosen at sign-up and changeable. Note: map stage follows total points while the village
  view's wall follows the Wall level (owner told; may be revisited).

## Order of work (after the owner picks a style)
1. Design system for the chosen style (tokens, type, buttons, panels, icons) + new app shell.
2. Village view (structure above), approved, then built into the game.
3. Map village growth stages + terrain tiles, approved, then built in.
4. Character set (units, chieftains, advisor) used across screens; building panels and reports.

Owner decision 2026-11-04: the village surroundings are the world map's terrain tiles, made for the village (`apps/web/src/art/landscapeTiles.tsx`, sprites in `apps/web/src/art/terrain-sprites/`): visible but softer tile grid, laid out by meaning (groves by the Lumber Camp, hills and rocks by the Iron Mine, small furrowed crop fields by the Farm, a river and a straight tile road from the gate), sized against the village's own trees and houses; fences only where they fully enclose something.
