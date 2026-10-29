import { describe, expect, it } from 'vitest';
import { checkAssetsFile, formatBytes, isHttpsUrl, mediaTypeFromMime } from '../assets';

const MB = 1024 * 1024;

describe('assets media types', () => {
    it('infers the kind from the MIME type', () => {
        expect(mediaTypeFromMime('application/pdf')).toBe('document');
        expect(mediaTypeFromMime('image/png')).toBe('image');
        expect(mediaTypeFromMime('video/mp4')).toBe('video');
        expect(mediaTypeFromMime('audio/mpeg')).toBe('audio');
        expect(mediaTypeFromMime('application/zip')).toBeNull();
        expect(mediaTypeFromMime('')).toBeNull();
    });

    it('enforces WhatsApp size limits per kind', () => {
        expect(checkAssetsFile({ type: 'image/png', size: 5 * MB }).ok).toBe(true);
        expect(checkAssetsFile({ type: 'image/png', size: 5 * MB + 1 }).ok).toBe(false);
        expect(checkAssetsFile({ type: 'video/mp4', size: 17 * MB })).toMatchObject({
            ok: false,
            limitMb: 16,
        });
        expect(checkAssetsFile({ type: 'application/pdf', size: 99 * MB }).ok).toBe(true);
        expect(checkAssetsFile({ type: 'application/x-msdownload', size: 1 })).toMatchObject({
            ok: false,
            reason: 'unsupported',
        });
    });

    it('accepts only https links', () => {
        expect(isHttpsUrl('https://example.com/a.pdf')).toBe(true);
        expect(isHttpsUrl('http://example.com')).toBe(false);
        expect(isHttpsUrl('https://')).toBe(false);
    });

    it('formats sizes', () => {
        expect(formatBytes(2048)).toBe('2 KB');
        expect(formatBytes(3 * MB)).toBe('3.0 MB');
        expect(formatBytes(undefined)).toBe('');
    });
});
