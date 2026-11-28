/**
 * A missing phone-page chunk must come back as an uncacheable 404, not as the SPA
 * fallback HTML with a 200, and Pages must run the function for those paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS Pages Function, no types
import { onRequest } from '../../functions/classroom-assets/[[path]].js';

const ROOT = path.resolve(__dirname, '../..');

const context = (response: Response) => ({
    request: new Request('https://dash.example/classroom-assets/classroom-abc.js'),
    next: async () => response,
    env: {},
});

describe('/classroom-assets/*', () => {
    it('turns the SPA fallback into a 404 nothing may cache', async () => {
        const fallback = new Response('<!doctype html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });
        const response: Response = await onRequest(context(fallback));
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toContain('no-store');
    });

    it('passes a real file through untouched', async () => {
        const file = new Response('export {}', {
            status: 200,
            headers: { 'content-type': 'application/javascript' },
        });
        expect(await onRequest(context(file))).toBe(file);
    });

    it('is not excluded from Functions in _routes.json', () => {
        const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/_routes.json'), 'utf8'));
        expect(routes.exclude).not.toContain('/classroom-assets/*');
    });
});
