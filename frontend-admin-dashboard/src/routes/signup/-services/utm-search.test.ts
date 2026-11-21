import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { utmContext, utmSearchSchema } from './utm-search';

const schema = z.object({ source: z.string().optional(), ...utmSearchSchema });

describe('utm tags on a sign-up page', () => {
    it('keep the website source and the tags side by side', () => {
        const search = schema.parse({ source: 'website', utm_source: 'instagram', utm_campaign: 'launch' });
        expect(search.source).toBe('website');
        expect(utmContext(search)).toEqual({ utm_source: 'instagram', utm_campaign: 'launch' });
    });

    it('stay text when the router read them as a number or a boolean', () => {
        // ?utm_campaign=2026 reaches the schema as the number 2026; z.string() alone would reject the page.
        const search = schema.parse({ utm_campaign: 2026, utm_term: true });
        expect(search.utm_campaign).toBe('2026');
        expect(search.utm_term).toBe('true');
    });

    it('treat an empty or missing tag as absent', () => {
        const search = schema.parse({ utm_source: '', utm_medium: null });
        expect(search.utm_source).toBeUndefined();
        expect(search.utm_medium).toBeUndefined();
        expect(schema.parse({}).utm_campaign).toBeUndefined();
    });
});
