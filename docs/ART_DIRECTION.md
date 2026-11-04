# Art direction and redesign plan

Owner's direction (2026-11-02). Read before any visual work.

## Rules
- **Original art only.** Same genre as Tribal Wars and similar games, but never copy their art,
  layouts, icons or text. Reference screenshots the owner shares describe *structure*, not look;
  don't store them in this repo.
- **No generic "AI" look**: no emoji icons, no cream/parchment card UI, no gradient washes, no stock
  fantasy fonts. Every icon and picture is drawn for Clanfire.
- **Web app first**: desktop browsers and phone browsers from one responsive app; native mobile app later.
- Art starts as hand-drawn SVG; 3D models (e.g. Tripo3D) may come later, so prefer forms that can
  become 3D.
- Work **one piece at a time**, each approved by the owner before it goes into the game.
- Approved designs fix the **general concept**; the owner may still touch up details at the end. Keep
  every piece of art swappable (sprite registries, separate SVG files), never baked into layout code.

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
- Map growth stages (row F) and chieftain portraits (row G) — **approved** 2026-11-02; being built in.
  Map stage = `mapStage(points)` (0/15/35/65/100/150), abandoned villages = `ruinStage(points)` (same 6 steps; sprites `abandoned-stage-1..6`, approved 2026-11-04); chieftains in `CHIEFTAINS`
  (config.ts), chosen at sign-up and changeable. Note: map stage follows total points while the village
  view's wall follows the Wall level (owner told; may be revisited).

## Order of work (after the owner picks a style)
1. Design system for the chosen style (tokens, type, buttons, panels, icons) + new app shell.
2. Village view (structure above), approved, then built into the game.
3. Map village growth stages + terrain tiles, approved, then built in.
4. Character set (units, chieftains, advisor) used across screens; building panels and reports.

Owner decision 2026-11-04: the village surroundings are built from the world-map terrain tiles (`apps/web/src/art/landscapeTiles.tsx`, sprites copied to `apps/web/src/art/terrain-sprites/`), laid out by meaning (forest by the Lumber Camp, hills and rocks by the Iron Mine, wheat by the Farm, a river and a straight road from the gate), not scattered.
