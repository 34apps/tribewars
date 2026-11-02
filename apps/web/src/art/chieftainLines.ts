// Flavour lines and title-pill colours for the ten chieftains (approved artboard Chieftains.dc.html).
// Only the picker imports this, so it ships in the picker's lazy chunk.

export interface ChieftainFlavour {
  line: string;
  /** Title pill: background and text colour. */
  pill: { bg: string; fg: string };
}

export const CHIEFTAIN_FLAVOUR: Record<string, ChieftainFlavour> = {
  'old-orm': { line: 'Has outlived three rivals and two droughts. Still hums at the fire.', pill: { bg: '#FFDC7A', fg: '#2B211C' } },
  ysra: { line: 'Lit her first beacon at fifteen and has not sat down since.', pill: { bg: '#EF9C6E', fg: '#2B211C' } },
  brannoc: { line: 'Lost an eye, kept the grin. Counts loot on nine fingers.', pill: { bg: '#E0DCD3', fg: '#2B211C' } },
  hild: { line: 'Says very little. Her shield wall says the rest.', pill: { bg: '#7AD3CD', fg: '#2B211C' } },
  'barley-tam': { line: 'Feeds three villages and argues with every goose in them.', pill: { bg: '#A6C964', fg: '#2B211C' } },
  maelis: { line: 'Reads the weather, the stars and your letters. Mostly your letters.', pill: { bg: '#3C7A5C', fg: '#FFF8E8' } },
  corwen: { line: 'Inherited a crown two sizes too big and a temper to fill it.', pill: { bg: '#FFF8E8', fg: '#2B211C' } },
  khorza: { line: 'Sleeps in the saddle. His horse, Pell, has the better manners.', pill: { bg: '#E4B67C', fg: '#2B211C' } },
  saffi: { line: 'Never lost a war she could buy her way out of.', pill: { bg: '#7A3B5E', fg: '#FFF8E8' } },
  wren: { line: 'Talks to her hawk, Tilt, more than to her tribe. Tilt agrees.', pill: { bg: '#3D312A', fg: '#FFF8E8' } },
};
