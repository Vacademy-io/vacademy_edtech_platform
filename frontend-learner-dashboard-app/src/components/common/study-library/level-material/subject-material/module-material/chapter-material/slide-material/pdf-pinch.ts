/** The viewer stops being useful outside this zoom range. */
export const PINCH_MIN_SCALE = 0.4;
export const PINCH_MAX_SCALE = 4;

/** The zoom a pinch asks for: the start zoom, scaled by how far the fingers moved. */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (startDistance <= 0) return startScale;
  const next = startScale * (distance / startDistance);
  return Math.min(PINCH_MAX_SCALE, Math.max(PINCH_MIN_SCALE, next));
}
