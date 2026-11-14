import { describe, expect, it } from 'vitest';
import {
    IMAGE_SLOTS,
    SMALL_FILE_BYTES,
    canCrop,
    cropShare,
    fitWithin,
    imageAdvice,
    prepPlan,
    slotHint,
    slotOf,
} from './image-slots';

const card = IMAGE_SLOTS.card;

describe('slotOf / slotHint', () => {
    it('resolves a slot by id, a custom slot as given, and nothing to "free"', () => {
        expect(slotOf('card')).toBe(card);
        expect(slotOf(undefined)).toBe(IMAGE_SLOTS.free);
        const custom = { ...card, aspectLabel: '3:2', aspect: 1.5 };
        expect(slotOf(custom)).toBe(custom);
    });

    it('says what to upload', () => {
        expect(slotHint(card)).toBe('Best: 1280 × 720 px (16:9)');
        expect(slotHint(IMAGE_SLOTS.free)).toBe('Best: at least 1600 px wide');
        expect(slotHint(IMAGE_SLOTS.logo)).toContain('transparent background');
    });

    it('matches the site: past 30% cut, an image is shown whole', () => {
        expect(cropShare({ width: 1600, height: 900 }, 16 / 9)).toBeCloseTo(0);
        expect(cropShare({ width: 900, height: 900 }, 16 / 9)).toBeCloseTo(0.4375);
    });
});

describe('imageAdvice', () => {
    it('is quiet for an image that suits the slot, or one not measured yet', () => {
        expect(imageAdvice({ width: 1280, height: 720 }, card)).toEqual([]);
        expect(imageAdvice({ width: 1200, height: 900 }, card)).toEqual([]); // 4:3: a small band cut
        expect(imageAdvice(null, card)).toEqual([]);
        expect(imageAdvice({ width: 0, height: 0 }, card)).toEqual([]);
    });

    it('flags a small image, and a shape the site will show whole', () => {
        const small = imageAdvice({ width: 400, height: 225 }, card);
        expect(small.map((a) => a.kind)).toEqual(['lowRes']);
        expect(small[0]!.message).toContain('400 × 225 px');

        const tall = imageAdvice({ width: 900, height: 1600 }, card);
        expect(tall.map((a) => a.kind)).toEqual(['shape']);
        expect(tall[0]!.message).toContain('tall');
        expect(tall[0]!.message).toContain('16:9');
    });

    it('never asks for a shape where any shape is fine', () => {
        expect(imageAdvice({ width: 900, height: 1600 }, IMAGE_SLOTS.free)).toEqual([]);
        expect(imageAdvice({ width: 3000, height: 300 }, IMAGE_SLOTS.logo)).toEqual([]);
    });
});

describe('prepPlan', () => {
    const jpeg = (size: number) => ({ type: 'image/jpeg', size });

    it('uploads a small image that fits untouched', () => {
        expect(prepPlan(jpeg(200_000), { width: 1280, height: 720 }, card)).toEqual({
            keepOriginal: true,
            width: 1280,
            height: 720,
        });
    });

    it('scales a large photo down to the slot, never up', () => {
        expect(prepPlan(jpeg(5_000_000), { width: 4000, height: 3000 }, card)).toEqual({
            keepOriginal: false,
            width: 1920,
            height: 1440,
        });
        // In bounds but heavy: re-encoded at its own size.
        expect(prepPlan(jpeg(SMALL_FILE_BYTES + 1), { width: 1200, height: 800 }, card)).toEqual({
            keepOriginal: false,
            width: 1200,
            height: 800,
        });
    });

    it('never re-encodes a vector or an animation', () => {
        expect(prepPlan({ type: 'image/svg+xml', size: 9_000_000 }, { width: 5000, height: 5000 }, card).keepOriginal).toBe(true);
        expect(prepPlan({ type: 'image/gif', size: 9_000_000 }, { width: 5000, height: 5000 }, card).keepOriginal).toBe(true);
        expect(canCrop('image/gif')).toBe(false);
        expect(canCrop('image/svg+xml')).toBe(false);
        expect(canCrop('image/png')).toBe(true);
    });

    it('caps a crop at the slot edge, keeping its shape', () => {
        expect(fitWithin({ width: 3840, height: 2160 }, 1920)).toEqual({ width: 1920, height: 1080 });
        expect(fitWithin({ width: 800, height: 450 }, 1920)).toEqual({ width: 800, height: 450 });
    });
});
