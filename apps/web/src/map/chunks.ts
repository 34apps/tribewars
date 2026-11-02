import type { MapVillageDto } from '@clanfire/engine';
import { MAP_MAX_SPAN } from '@clanfire/engine';
import { api } from '../api.ts';

export const CHUNK = 30;
const STALE_MS = 30_000;
const RETRY_MS = 5_000;
const MAX_INFLIGHT = 3;

if (CHUNK > MAP_MAX_SPAN) throw new Error('CHUNK must not exceed MAP_MAX_SPAN');

interface Chunk {
  villages: MapVillageDto[];
  byTile: Map<number, MapVillageDto>;
  fetchedAt: number;
}

const tileKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
const chunkKey = (ci: number, cj: number) => `${ci},${cj}`;

/** Cache of /api/map results in CHUNK x CHUNK blocks; refetches blocks older than 30 s when asked. */
export class MapChunks {
  private readonly chunks = new Map<string, Chunk>();
  private readonly loading = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private wanted: Array<{ ci: number; cj: number }> = [];
  private inflight = 0;
  private disposed = false;
  /** Called after a chunk arrived. */
  onChange: (() => void) | null = null;

  constructor(private readonly radius: number) {}

  /** Start receiving change notifications (safe to call again after detach, e.g. React StrictMode). */
  attach(onChange: () => void): void {
    this.disposed = false;
    this.onChange = onChange;
  }

  detach(): void {
    this.disposed = true;
    this.onChange = null;
  }

  /** Make sure every chunk touching the tile rectangle is loaded and fresh, nearest to (cx, cy) first. */
  ensure(minX: number, minY: number, maxX: number, maxY: number, cx: number, cy: number): void {
    const r = this.radius;
    const x0 = Math.max(-r, minX);
    const x1 = Math.min(r, maxX);
    const y0 = Math.max(-r, minY);
    const y1 = Math.min(r, maxY);
    const wanted: Array<{ ci: number; cj: number; d: number }> = [];
    if (x0 <= x1 && y0 <= y1) {
      const now = Date.now();
      for (let ci = Math.floor(x0 / CHUNK); ci <= Math.floor(x1 / CHUNK); ci++) {
        for (let cj = Math.floor(y0 / CHUNK); cj <= Math.floor(y1 / CHUNK); cj++) {
          const key = chunkKey(ci, cj);
          if (this.loading.has(key)) continue;
          const failed = this.failedAt.get(key);
          if (failed !== undefined && now - failed < RETRY_MS) continue;
          const have = this.chunks.get(key);
          if (have && now - have.fetchedAt < STALE_MS) continue;
          const dx = ci * CHUNK + CHUNK / 2 - cx;
          const dy = cj * CHUNK + CHUNK / 2 - cy;
          wanted.push({ ci, cj, d: dx * dx + dy * dy });
        }
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    this.wanted = wanted;
    this.pump();
  }

  /** Villages stored in chunk (ci, cj); empty until loaded. */
  villagesIn(ci: number, cj: number): readonly MapVillageDto[] {
    return this.chunks.get(chunkKey(ci, cj))?.villages ?? [];
  }

  villageAt(x: number, y: number): MapVillageDto | undefined {
    return this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)))?.byTile.get(tileKey(x, y));
  }

  isLoaded(x: number, y: number): boolean {
    return this.chunks.has(chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK)));
  }

  /** Force every chunk to refetch on the next ensure() (e.g. after leaving beginner protection). */
  invalidate(): void {
    for (const c of this.chunks.values()) c.fetchedAt = 0;
  }

  private pump(): void {
    while (!this.disposed && this.inflight < MAX_INFLIGHT) {
      const next = this.wanted.shift();
      if (!next) return;
      void this.load(next.ci, next.cj);
    }
  }

  private async load(ci: number, cj: number): Promise<void> {
    const key = chunkKey(ci, cj);
    if (this.loading.has(key)) return;
    this.loading.add(key);
    this.inflight += 1;
    const r = this.radius;
    const x0 = Math.max(-r, ci * CHUNK);
    const y0 = Math.max(-r, cj * CHUNK);
    const x1 = Math.min(r, ci * CHUNK + CHUNK - 1);
    const y1 = Math.min(r, cj * CHUNK + CHUNK - 1);
    try {
      const res = await api.map(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      if (this.disposed) return;
      const byTile = new Map<number, MapVillageDto>();
      for (const v of res.villages) byTile.set(tileKey(v.x, v.y), v);
      this.chunks.set(key, { villages: res.villages, byTile, fetchedAt: Date.now() });
      this.failedAt.delete(key);
      this.onChange?.();
    } catch {
      this.failedAt.set(key, Date.now());
    } finally {
      this.loading.delete(key);
      this.inflight -= 1;
      this.pump();
    }
  }
}
