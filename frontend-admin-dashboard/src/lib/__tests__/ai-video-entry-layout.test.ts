import { describe, expect, it } from 'vitest';
import {
    canvasBackground,
    entryBoxStyle,
    fillSceneGaps,
} from '@/components/ai-video-player/entry-layout';

describe('entryBoxStyle', () => {
    it('places a positioned layer at its own box', () => {
        expect(
            entryBoxStyle(
                { htmlStartX: 0, htmlStartY: 842, htmlEndX: 1920, htmlEndY: 1080 },
                1920,
                1080
            )
        ).toEqual({
            left: '0%',
            top: `${(842 / 1080) * 100}%`,
            width: '100%',
            height: `${(238 / 1080) * 100}%`,
        });
    });
    it('keeps full-frame and coordinate-less entries full-frame', () => {
        const full = { left: 0, top: 0, width: '100%', height: '100%' };
        expect(
            entryBoxStyle(
                { htmlStartX: 0, htmlStartY: 0, htmlEndX: 1920, htmlEndY: 1080 },
                1920,
                1080
            )
        ).toEqual(full);
        expect(entryBoxStyle({}, 1920, 1080)).toEqual(full);
        expect(
            entryBoxStyle({ htmlStartX: 10, htmlStartY: 10, htmlEndX: 5, htmlEndY: 50 }, 1920, 1080)
        ).toEqual(full);
    });
});

describe('fillSceneGaps', () => {
    it('holds the previous scene through a hole, leaving overlays alone', () => {
        const entries = [
            { id: 'shot-5', inTime: 53.38, exitTime: 64.61 },
            { id: 'snippet-lesson-band-0', inTime: 0, exitTime: 64.61 },
            { id: 'shot-7', inTime: 79.94, exitTime: 95.28 },
            { id: 'branding-watermark', inTime: 0, exitTime: 163.54 },
        ];
        const out = fillSceneGaps(entries);
        expect(out.find((e) => e.id === 'shot-5')!.exitTime).toBe(79.94);
        expect(out.find((e) => e.id === 'snippet-lesson-band-0')!.exitTime).toBe(64.61);
        expect(out.find((e) => e.id === 'shot-7')!.exitTime).toBe(95.28);
        expect(entries[0]!.exitTime).toBe(64.61); // input not mutated
    });
    it('returns the same array when there is no hole', () => {
        const entries = [
            { id: 'shot-0', inTime: 0, exitTime: 10 },
            { id: 'shot-1', inTime: 10, exitTime: 20 },
        ];
        expect(fillSceneGaps(entries)).toBe(entries);
    });
});

describe('canvasBackground', () => {
    it('uses the palette background, falling back to white', () => {
        expect(canvasBackground({ background: '#1a3a2a' })).toBe('#1a3a2a'); // design-lint-ignore: palette test data
        expect(canvasBackground({ background: 'url(x)' })).toBe('#ffffff'); // design-lint-ignore: palette test data
        expect(canvasBackground(undefined)).toBe('#ffffff'); // design-lint-ignore: palette test data
    });
});
