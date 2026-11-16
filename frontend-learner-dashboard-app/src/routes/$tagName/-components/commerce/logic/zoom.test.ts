import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_RESET, ZOOM_STEP, clampZoom, distance, midpoint, panBy, toggleZoom, zoomAround } from './zoom';

const box = { width: 360, height: 480 };

describe('photo zoom', () => {
    it('keeps the scale between 1 and 4', () => {
        expect(clampZoom({ scale: 0.3, x: 0, y: 0 }, box).scale).toBe(1);
        expect(clampZoom({ scale: 9, x: 0, y: 0 }, box).scale).toBe(ZOOM_MAX);
        expect(clampZoom({ scale: Number.NaN, x: 0, y: 0 }, box).scale).toBe(1);
    });

    it('cannot be panned at scale 1, and never past the edge of the picture', () => {
        expect(panBy(ZOOM_RESET, 80, -40, box)).toEqual(ZOOM_RESET);
        // At 2x the picture overhangs the box by half its size on each side.
        expect(panBy({ scale: 2, x: 0, y: 0 }, 1000, -1000, box)).toEqual({ scale: 2, x: 180, y: -240 });
        expect(panBy({ scale: 2, x: 0, y: 0 }, 50, 60, box)).toEqual({ scale: 2, x: 50, y: 60 });
    });

    it('keeps the point under the fingers in place while pinching', () => {
        // Fingers 100 px right of centre: the picture point there is at 100 before and after.
        const next = zoomAround(ZOOM_RESET, 2, { x: 100, y: 0 }, box);
        expect(next.scale).toBe(2);
        // picture point p satisfies focal = x + p * scale; before: p = 100. After: 100 = x + 100 * 2.
        expect(next.x).toBe(-100);
        expect(next.y).toBe(0);
    });

    it('pinching back out to 1 re-centres the picture', () => {
        const zoomed = zoomAround(ZOOM_RESET, 3, { x: 120, y: 150 }, box);
        expect(zoomAround(zoomed, 1, { x: -50, y: 20 }, box)).toEqual(ZOOM_RESET);
    });

    it('double tap zooms in around the tap and back out', () => {
        const zoomed = toggleZoom(ZOOM_RESET, { x: 0, y: 0 }, box);
        expect(zoomed).toEqual({ scale: ZOOM_STEP, x: 0, y: 0 });
        expect(toggleZoom(zoomed, { x: 40, y: 40 }, box)).toEqual(ZOOM_RESET);
    });

    it('measures a pinch', () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
        expect(midpoint({ x: 0, y: 10 }, { x: 20, y: 30 })).toEqual({ x: 10, y: 20 });
    });
});
