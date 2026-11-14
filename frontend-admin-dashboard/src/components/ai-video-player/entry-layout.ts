import type { CSSProperties } from 'react';

interface EntryBox {
    htmlStartX?: number;
    htmlStartY?: number;
    htmlEndX?: number;
    htmlEndY?: number;
}

const FULL_FRAME: CSSProperties = { left: 0, top: 0, width: '100%', height: '100%' };

/**
 * Where a timeline entry's layer sits on the canvas.
 *
 * Most AI videos are one full-frame shot at a time, but lesson videos stack
 * positioned layers (board above a caption band, teacher in a corner or side
 * panel). Drawing every layer full-frame let the caption band — the top
 * layer — paint over the whole video. Entries without usable coordinates, or
 * covering the whole canvas, keep the full-frame layout.
 */
export function entryBoxStyle(
    entry: EntryBox,
    canvasWidth: number,
    canvasHeight: number
): CSSProperties {
    const { htmlStartX: x0, htmlStartY: y0, htmlEndX: x1, htmlEndY: y1 } = entry;
    if (
        typeof x0 !== 'number' ||
        typeof y0 !== 'number' ||
        typeof x1 !== 'number' ||
        typeof y1 !== 'number' ||
        !Number.isFinite(x0 + y0 + x1 + y1) ||
        x1 <= x0 ||
        y1 <= y0 ||
        !(canvasWidth > 0) ||
        !(canvasHeight > 0)
    ) {
        return FULL_FRAME;
    }
    if (x0 <= 0 && y0 <= 0 && x1 >= canvasWidth && y1 >= canvasHeight) return FULL_FRAME;
    const pct = (v: number, of: number) => `${(v / of) * 100}%`;
    return {
        left: pct(x0, canvasWidth),
        top: pct(y0, canvasHeight),
        width: pct(x1 - x0, canvasWidth),
        height: pct(y1 - y0, canvasHeight),
    };
}

interface TimedEntry {
    id?: string;
    inTime?: number;
    exitTime?: number;
    start?: number;
    end?: number;
}

const isOverlay = (e: TimedEntry) =>
    !!e.id && (e.id.startsWith('branding-') || e.id.startsWith('snippet-'));

/**
 * Stretch each scene to the start of the next one when the timeline has a
 * hole (e.g. a shot the generator couldn't produce). Overlays such as the
 * caption band and watermark stay active through a hole, so "nothing active"
 * never fires and the viewer saw a blank canvas; holding the previous scene
 * matches what the MP4 renderer does. Overlays are left untouched.
 */
export function fillSceneGaps<T extends TimedEntry>(entries: T[]): T[] {
    const startOf = (e: T) => e.inTime ?? e.start;
    const scenes = entries
        .filter((e) => !isOverlay(e) && typeof startOf(e) === 'number')
        .sort((a, b) => (startOf(a) as number) - (startOf(b) as number));
    const extended = new Map<T, T>();
    for (let i = 0; i < scenes.length - 1; i++) {
        const cur = scenes[i]!;
        const nextStart = startOf(scenes[i + 1]!) as number;
        const usesExit = typeof cur.exitTime === 'number';
        const end = usesExit ? cur.exitTime : cur.end;
        if (typeof end === 'number' && end < nextStart) {
            extended.set(
                cur,
                usesExit ? { ...cur, exitTime: nextStart } : { ...cur, end: nextStart }
            );
        }
    }
    return extended.size ? entries.map((e) => extended.get(e) ?? e) : entries;
}

/** Canvas colour behind the layers: the video's own background, not white. */
export function canvasBackground(palette?: { background?: string } | null): string {
    const bg = palette?.background;
    const fallback = '#ffffff'; // design-lint-ignore: players' historic canvas default; real colour comes from the timeline palette
    return typeof bg === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(bg) ? bg : fallback;
}
