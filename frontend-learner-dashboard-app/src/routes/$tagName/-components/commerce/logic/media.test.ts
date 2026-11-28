import { describe, expect, it } from 'vitest';
import type { Media } from '../api/types';
import { imageSource, largestSource, mediaChip, orderGallery, thumbUrl } from './media';

const media = (over: Partial<Media>): Media => ({
    kind: 'IMAGE',
    url: 'https://cdn.example/original.jpg',
    alt: null,
    tag: null,
    width: 1600,
    height: 2000,
    renditions: [],
    variant_id: null,
    position: 0,
    ...over,
});

const renditions = [320, 640, 960, 1600].map((width) => ({ width, url: `https://cdn.example/r-${width}.webp` }));

describe('imageSource', () => {
    it('builds srcset from the stored renditions and keeps width and height for the box', () => {
        const source = imageSource(media({ renditions }));
        expect(source?.srcSet).toBe(renditions.map((r) => `${r.url} ${r.width}w`).join(', '));
        expect(source?.src).toBe('https://cdn.example/r-640.webp');
        expect(source?.width).toBe(1600);
        expect(source?.height).toBe(2000);
    });

    it('adds the original only when it is wider than every rendition', () => {
        const source = imageSource(media({ width: 2400, renditions: renditions.slice(0, 3) }));
        expect(source?.srcSet?.endsWith('https://cdn.example/original.jpg 2400w')).toBe(true);
    });

    it('never adds a huge original once the 1600 px rendition exists', () => {
        const source = imageSource(media({ width: 6000, renditions }));
        expect(source?.srcSet).toBe(renditions.map((r) => `${r.url} ${r.width}w`).join(', '));
        expect(source?.srcSet).not.toContain('original.jpg');
    });

    it('falls back to the original for an image without renditions (a migrated 800 px master)', () => {
        const source = imageSource(media({ width: 800, height: 1000, renditions: null }));
        expect(source).toEqual({ src: 'https://cdn.example/original.jpg', srcSet: undefined, width: 800, height: 1000 });
    });

    it('sorts, de-duplicates and ignores broken renditions', () => {
        const source = imageSource(
            media({
                renditions: [
                    { width: 640, url: 'b' },
                    { width: 320, url: 'a' },
                    { width: 640, url: 'b2' },
                    { width: null, url: 'x' },
                    { width: 960, url: null },
                ],
            })
        );
        expect(source?.srcSet).toBe('a 320w, b 640w, https://cdn.example/original.jpg 1600w');
    });

    it('is null without an image', () => {
        expect(imageSource(null)).toBeNull();
        expect(imageSource(media({ url: null }))).toBeNull();
    });

    it('picks the largest and the smallest source', () => {
        const m = media({ renditions });
        expect(largestSource(m)).toBe('https://cdn.example/r-1600.webp');
        // The zoom view stops at the 1600 px rendition; the original is used only when the renditions fall short of it.
        expect(largestSource(media({ width: 2400, renditions }))).toBe('https://cdn.example/r-1600.webp');
        expect(largestSource(media({ width: 2400, renditions: renditions.slice(0, 3) }))).toBe('https://cdn.example/original.jpg');
        expect(thumbUrl(m)).toBe('https://cdn.example/r-320.webp');
        expect(thumbUrl(media({}))).toBe('https://cdn.example/original.jpg');
        expect(thumbUrl(null)).toBeNull();
    });
});

describe('orderGallery', () => {
    const render = media({ url: 'render', tag: 'RENDER', position: 0 });
    const real = media({ url: 'real', tag: 'REAL', position: 1 });
    const plain = media({ url: 'plain', position: 2 });
    const video = media({ url: 'video', kind: 'VIDEO', position: 1 });

    it('keeps the stored order when the seller sets no lead tag', () => {
        expect(orderGallery([plain, real, render], '').map((m) => m.url)).toEqual(['render', 'real', 'plain']);
    });

    it('puts a lead-tag image first', () => {
        expect(orderGallery([render, real, plain], 'REAL').map((m) => m.url)).toEqual(['real', 'render', 'plain']);
    });

    it('never leads with an image of another tag when an untagged one exists', () => {
        expect(orderGallery([render, plain], 'real').map((m) => m.url)).toEqual(['plain', 'render']);
    });

    it('leaves a product with only other-tag images as it is (it carries the chip on image 1)', () => {
        const second = media({ url: 'render2', tag: 'RENDER', position: 1 });
        expect(orderGallery([render, second], 'REAL').map((m) => m.url)).toEqual(['render', 'render2']);
    });

    it('shows the pictures of the picked variant first, and videos after the images', () => {
        const ofVariant = media({ url: 'v2', variant_id: 'v-2', position: 5 });
        expect(orderGallery([plain, video, ofVariant], '', 'v-2').map((m) => m.url)).toEqual(['v2', 'plain', 'video']);
        expect(orderGallery([ofVariant, plain], '').map((m) => m.url)).toEqual(['plain', 'v2']);
    });

    it('drops media without a URL', () => {
        expect(orderGallery([media({ url: null }), plain], '')).toHaveLength(1);
    });
});

describe('mediaChip', () => {
    const labels = { RENDER: 'Styled render' };
    it('labels an image whose tag is not the lead tag', () => {
        expect(mediaChip(media({ tag: 'render' }), 'REAL', labels)).toBe('Styled render');
    });
    it('gives no chip to a lead-tag image, an untagged one, or a tag without a label', () => {
        expect(mediaChip(media({ tag: 'REAL' }), 'REAL', labels)).toBeNull();
        expect(mediaChip(media({}), 'REAL', labels)).toBeNull();
        expect(mediaChip(media({ tag: 'OTHER' }), 'REAL', labels)).toBeNull();
    });
});
