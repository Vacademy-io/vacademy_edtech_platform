// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { holdZoomableViewport, zoomableViewport } from './viewport';

const APP = 'width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no, viewport-fit=cover';

afterEach(() => {
    document.head.innerHTML = '';
});

describe('zoomableViewport', () => {
    it('takes out maximum-scale and user-scalable and keeps the rest in order', () => {
        expect(zoomableViewport(APP)).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
        expect(zoomableViewport('width=device-width,initial-scale=1')).toBe('width=device-width, initial-scale=1');
        expect(zoomableViewport('width=device-width, User-Scalable = 0')).toBe('width=device-width');
    });
});

describe('holdZoomableViewport', () => {
    it('allows zoom while any shop root holds it and puts the app value back after the last one', () => {
        const meta = document.createElement('meta');
        meta.name = 'viewport';
        meta.content = APP;
        document.head.appendChild(meta);
        const releaseHeader = holdZoomableViewport(document);
        const releasePage = holdZoomableViewport(document);
        expect(meta.content).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
        releasePage();
        releasePage(); // a second call does nothing
        expect(meta.content).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
        releaseHeader();
        expect(meta.content).toBe(APP);
    });

    it('does nothing on a document without a viewport tag', () => {
        const release = holdZoomableViewport(document);
        expect(() => release()).not.toThrow();
    });
});
