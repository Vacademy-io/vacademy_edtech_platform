import { describe, expect, it, vi } from 'vitest';
import {
    findInlineImages,
    inlineImageToFile,
    InlineImageUploadError,
    replaceInlineImages,
} from './inline-images';

// 3,000 base64 chars: over the "worth uploading" threshold.
const BIG = 'A'.repeat(3000);
const jpeg = `data:image/jpeg;base64,${BIG}`;
const png = `data:image/png;base64,${'B'.repeat(2398)}==`;
const tinyIcon = 'data:image/png;base64,iVBORw0KGgo=';

describe('findInlineImages', () => {
    it('finds big base64 images once each, skipping tiny icons', () => {
        const html = `<img src="${jpeg}"><div style="background:url(${png})"></div><img src="${jpeg}"><img src="${tinyIcon}">`;
        const found = findInlineImages(html);
        expect(found.map((f) => f.mime)).toEqual(['image/jpeg', 'image/png']);
        expect(found[1]?.uri).toBe(png);
    });

    it('returns nothing for plain HTML', () => {
        expect(findInlineImages('<p>hi</p><img src="https://cdn.example.com/a.jpg">')).toEqual([]);
    });
});

describe('inlineImageToFile', () => {
    it('decodes to a typed file with a matching extension', () => {
        const [image] = findInlineImages(`<img src="${png}">`);
        const file = inlineImageToFile(image!, 0);
        expect(file.type).toBe('image/png');
        expect(file.name).toMatch(/\.png$/);
        expect(file.size).toBe(1798);
    });
});

describe('replaceInlineImages', () => {
    it('swaps every occurrence for its uploaded URL', async () => {
        const upload = vi
            .fn()
            .mockResolvedValueOnce('https://cdn.example.com/1.jpg')
            .mockResolvedValueOnce('https://cdn.example.com/2.png');
        const html = `<img src="${jpeg}"><i style="background:url(${png})"></i><img src="${jpeg}" alt="again">`;
        const out = await replaceInlineImages(html, upload);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(out.uploaded).toBe(2);
        expect(out.html).toBe(
            '<img src="https://cdn.example.com/1.jpg"><i style="background:url(https://cdn.example.com/2.png)"></i><img src="https://cdn.example.com/1.jpg" alt="again">'
        );
    });

    it('leaves HTML without inline images untouched and uploads nothing', async () => {
        const upload = vi.fn();
        const out = await replaceInlineImages('<p>hello</p>', upload);
        expect(out).toEqual({ html: '<p>hello</p>', uploaded: 0 });
        expect(upload).not.toHaveBeenCalled();
    });

    it('fails without a partial result when an upload fails or returns no URL', async () => {
        const html = `<img src="${jpeg}"><img src="${png}">`;
        const rejecting = vi
            .fn()
            .mockResolvedValueOnce('https://cdn.example.com/1.jpg')
            .mockRejectedValueOnce(new Error('s3'));
        await expect(replaceInlineImages(html, rejecting)).rejects.toThrow('Image 2 of 2');

        const empty = vi.fn().mockResolvedValue('');
        await expect(replaceInlineImages(`<img src="${jpeg}">`, empty)).rejects.toBeInstanceOf(
            InlineImageUploadError
        );
    });
});
