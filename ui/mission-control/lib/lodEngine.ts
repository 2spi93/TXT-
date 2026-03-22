import { decimate, type Bar } from "./dataEngine";

export function getLODLevel(visibleBars: number): number {
  if (visibleBars < 100) return 1;
  if (visibleBars < 300) return 2;
  if (visibleBars < 800) return 4;
  return 10;
}

export function applyDynamicLod(rawBars: Bar[], visibleBars: number): Bar[] {
  const lod = getLODLevel(Math.max(1, visibleBars));
  if (lod <= 1 || rawBars.length <= 120) {
    return rawBars;
  }

  const targetBars = Math.max(60, Math.floor(rawBars.length / lod));
  return decimate(rawBars, targetBars);
}
