import { terrainAt } from '@clanfire/engine';
import type { Terrain } from '@clanfire/engine';

export const GRASS = 0;
export const FOREST = 1;
export const HILLS = 2;
export const MOUNTAIN = 3;
export const LAKE = 4;

const CODE: Record<Terrain, number> = { grass: GRASS, forest: FOREST, hills: HILLS, mountain: MOUNTAIN, lake: LAKE };
export const TERRAIN_NAME = ['Grassland', 'Forest', 'Hills', 'Mountain', 'Lake'] as const;

const BLOCK = 32;

/** terrainAt() results cached in 32x32 blocks so redraws never recompute noise. */
export class TerrainCache {
  private readonly blocks = new Map<number, Uint8Array>();
  constructor(private readonly seed: number) {}

  get(x: number, y: number): number {
    const bx = Math.floor(x / BLOCK);
    const by = Math.floor(y / BLOCK);
    const key = (bx + 8192) * 16384 + (by + 8192);
    let block = this.blocks.get(key);
    if (!block) {
      block = new Uint8Array(BLOCK * BLOCK);
      for (let j = 0; j < BLOCK; j++) {
        for (let i = 0; i < BLOCK; i++) block[j * BLOCK + i] = CODE[terrainAt(bx * BLOCK + i, by * BLOCK + j, this.seed)];
      }
      this.blocks.set(key, block);
    }
    return block[(y - by * BLOCK) * BLOCK + (x - bx * BLOCK)] ?? GRASS;
  }
}
