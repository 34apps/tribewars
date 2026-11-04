# Village landscape proposal — screenshots NOT produced yet

The unattended run that wrote this proposal had no browser and was not allowed to run scripts or screenshot tools, so
no PNG files exist here. The code is in the working tree (uncommitted):
`apps/web/src/art/landscape.tsx` (new), plus small edits in `apps/web/src/views/village/VillageScene.tsx` and `village.css`.

## How to look at it (and save the six PNGs here)

1. `npm run dev:fast`, sign in, open the village.
2. Settings → Design preview → "All buildings"; set the wall level with the slider.
3. Desktop: browser window 1440 px wide. Phone: DevTools device mode, 360 px wide (drag to pan to the corners).
4. Save as `wall-01-1440.png`, `wall-10-1440.png`, `wall-20-1440.png`, `wall-01-360.png`, `wall-10-360.png`, `wall-20-360.png`.

The landscape grows at village size ≈ 20 % / 45 % / 80 % (wall level 1 = smallest, 10 = middle, 20 = fullest).
