# Clanfire — style exploration brief (shared by all four art directions)

Clanfire is an original browser + mobile-browser strategy game: each player has a village on a
shared world map, gathers wood, food, iron and gold, upgrades buildings, trains troops, raids
abandoned villages and fights alongside a tribe (alliances, pacts, enemies). The owner rejected the
current look as "AI slop" and asked to see several genuinely different directions, then choose.
Each direction is drawn as THREE artboards on a design canvas. Make each direction feel like a real,
shippable game with a strong point of view — not a template.

## Hard rules (the owner will reject the work if these slip)
- **No emoji anywhere.** Every icon and picture is hand-drawn inline SVG made for Clanfire.
- No generic "AI app" tropes: no gradient washes or glows-on-everything, no glassmorphism, no white
  rounded cards on cream/parchment, no left-border accent cards, no purple/blue tech gradients, no
  drop-shadow soup, no stock "fantasy" fonts (Cinzel, MedievalSharp, Uncial Antiqua, Pirata One,
  Almendra, IM Fell) and no Inter/Roboto as the display face. Pick 1–2 typefaces (Google Fonts via a
  `css2` `<link>` in `<helmet>` is allowed) that fit YOUR direction, and use them with intent.
- One consistent visual language per direction: same stroke/edge treatment, one light direction
  (top-left), one palette (3–6 colours + neutrals), same character proportions.
- Characters need personality and readable silhouettes at 64 px: distinct pose, prop, headgear,
  colours per unit. Faces/expressions where the style allows.
- Real content only (names and numbers below). No lorem ipsum, no invented features.
- Accessibility as drawn: real `<button>` elements, text contrast ≥ 4.5:1, touch targets ≥ 44 px,
  decorative SVG `aria-hidden="true"`, meaningful SVG `role="img" aria-label="…"`.

## Game content to depict
- Resources: Wood, Food, Iron, Gold (draw an icon for each). Example values: Wood 1,240 / 2,200
  (+350/h), Food 860 / 2,200 (+410/h net), Iron 1,905 / 2,200 (+300/h), Gold 140 / 2,200 (+24/h).
- Buildings: Town Hall, Lumber Camp, Farm, Iron Mine, Gold Mine, Storehouse, Barracks, Stables,
  Wall, Hidden Vault. Example: Town Hall level 4 → upgrade to 5 costs Wood 227, Food 202, Iron 176,
  takes 6m 40s; Lumber Camp level 6 makes +56/h → +65/h at level 7.
- Units (6 characters): Pikeman (cheap defender, long pike, good vs cavalry), Shieldbearer (tower
  shield, good vs infantry), Raider (fierce attacker on foot, axes), Outrider (fast light cavalry —
  draw rider + mount, or a bust with a hint of the horse), Knight (armoured elite rider, costs gold),
  Pathfinder (scout: hood, spyglass or hawk, light and quick).
- Chieftain avatars: the player's leader portrait — draw TWO different chieftains (e.g. an older
  bearded chief with a bone/antler circlet; a young woman with braids and a fur mantle; your call).
- Advisor/guide: a recurring friendly character who teaches new players (e.g. a grizzled
  quartermaster, a raven-keeper with her raven, a tinkerer — your call, make it memorable). On the
  village screen the advisor gives a tip like: "Your Farm feeds the army. Upgrade it before you
  train more Raiders."
- Village: player "Aren" of tribe [EMBR] "Emberhold", village "Aren's Hold" at 12|-40.

## The three artboards per direction (exact files and sizes)
1. `<Prefix>Village.dc.html` (Ember uses `Main.dc.html` instead) — **390×844 phone screen**: top bar
   with the four resources (icon, amount/cap, rate), the village shown as a small isometric 2.5D
   scene with several buildings drawn at their levels, one selected building panel (Town Hall:
   level, what it does, cost, time, an "Upgrade to level 5" button), the advisor with the tip, and a
   bottom tab bar (Village, Map, Army, Reports, Tribe) with custom icons. Fixed 390×844 root.
2. `<Prefix>Cast.dc.html` — **1200×844 character sheet**: all six units as full character
   illustrations with name + one-line role, the two chieftain avatars, the advisor (larger, with
   pose), plus a compact palette strip and type specimen for the direction. Fixed root.
3. `<Prefix>Map.dc.html` — **800×844 isometric world-map snippet**: 2:1 dimetric tiles (grass,
   forest, hills, mountain, water), villages at three growth stages (small / medium / large), an
   abandoned village (ruined), tribe colour/flag markers for own tribe vs ally vs enemy, coordinate
   labels, a marching army moving between two villages (dashed route + small army figure), and a
   selected-village popover (name, owner [TAG], points, distance, "Send troops" button). Fixed root.

## File format (Design canvas artboard, `.dc.html`) — follow exactly
Each file is one self-contained page:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ember & Ash — Village</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap">
<style>
body{margin:0}
a{color:#...}a:hover{color:#...}
</style>
</helmet>
<div style="width: 390px; height: 844px; position: relative; overflow: hidden; ...">
  ... markup with inline styles and inline <svg> art ...
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>
class Component extends DCLogic {
renderVals() { return {}; }
}
</script>
</body>
</html>
```
Rules that fail silently if broken:
- Keep `<script src="./support.js"></script>` exactly. Close every non-void element; quote every
  attribute. All visible UI is markup inside `<x-dc>` (no script-built DOM, no innerHTML).
- Inline `style="…"` for layout and look; `<helmet><style>` only for page basics, `@keyframes` if any,
  and link colours. No `data:` URIs, no external images, no network except the Google Fonts link.
  No `<iframe>`, `<object>`, `<embed>`, no `foreignObject` in SVG.
- `{{hole}}` lookups only come from `renderVals()`; you can keep everything literal (static comps).
- Root size fixed at the artboard size; `$preview` in `data-props` = that size.
- Lay out groups with flex/grid + `gap`. Inline SVG is fine for illustrations (use `<g>`, `<path>`,
  `<defs>` with gradients sparingly if your direction calls for it; give ids a per-file prefix to
  avoid clashes).

## Working method
- Before writing the final files, sketch each character/building as a standalone `.svg` in your own
  scratch subfolder (`/tmp/claude-0/-home-user-meetingnote-web/3a835131-ac72-5ec6-b53e-ff70fc61ea1d/scratchpad/clanfire-styles/sketch-<prefix>/`)
  and render them with Playwright (`require('playwright')`, `chromium.launch()` needs no options) to
  PNG to check they read well; iterate on anything that looks crude, lumpy or generic. Then put the
  final art inline in the three artboard files.
- Write ONLY your three files into `/tmp/claude-0/-home-user-meetingnote-web/3a835131-ac72-5ec6-b53e-ff70fc61ea1d/scratchpad/clanfire-styles/project/`.
  Never touch other directions' files or `canvas.json`.
- Keep each file under ~400 KB.
- Report (under 10 lines): the direction's one-line pitch, fonts used, palette hexes, file sizes,
  and PNG paths of your best renders.
