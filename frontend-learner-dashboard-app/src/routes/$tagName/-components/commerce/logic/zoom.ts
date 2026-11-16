/**
 * Pinch, pan and double-tap inside the photo zoom view. Handled by
 * the page itself, because the app's viewport switches the browser's own pinch zoom off. Pure
 * arithmetic here; ui/Gallery.tsx feeds it pointer events.
 */

export interface ZoomState {
    /** 1 = the whole picture fits the box. */
    scale: number;
    /** Offset of the picture's centre from the box's centre, in CSS pixels. */
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** What a double tap (or the zoom button) zooms to. */
export const ZOOM_STEP = 2.5;

export const ZOOM_RESET: ZoomState = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Keeps the scale in range and the picture over the box: no empty band appears while panning. */
export const clampZoom = (state: ZoomState, box: Size): ZoomState => {
    const scale = clamp(Number.isFinite(state.scale) ? state.scale : 1, ZOOM_MIN, ZOOM_MAX);
    const maxX = Math.max(0, (box.width * (scale - 1)) / 2);
    const maxY = Math.max(0, (box.height * (scale - 1)) / 2);
    // "+ 0" turns a negative zero into zero, so a centred picture always compares equal.
    return { scale, x: clamp(state.x, -maxX, maxX) + 0, y: clamp(state.y, -maxY, maxY) + 0 };
};

/**
 * Changes the scale so that the point under the fingers stays under the fingers. `focal` is
 * measured from the box's centre.
 */
export const zoomAround = (state: ZoomState, nextScale: number, focal: { x: number; y: number }, box: Size): ZoomState => {
    const scale = clamp(nextScale, ZOOM_MIN, ZOOM_MAX);
    const ratio = scale / state.scale;
    return clampZoom({ scale, x: focal.x - (focal.x - state.x) * ratio, y: focal.y - (focal.y - state.y) * ratio }, box);
};

export const panBy = (state: ZoomState, dx: number, dy: number, box: Size): ZoomState =>
    clampZoom({ scale: state.scale, x: state.x + dx, y: state.y + dy }, box);

/** Double tap and the zoom button: in to ZOOM_STEP around the tapped point, or back out. */
export const toggleZoom = (state: ZoomState, focal: { x: number; y: number }, box: Size): ZoomState =>
    state.scale > 1.05 ? ZOOM_RESET : zoomAround(state, ZOOM_STEP, focal, box);

export const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

export const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
});
