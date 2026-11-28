import { describe, expect, it } from 'vitest';
import { detectLang, fill, STRINGS } from './strings';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('strings', () => {
    it('has the same placeholders in both languages', () => {
        for (const key of Object.keys(STRINGS.en) as Array<keyof typeof STRINGS.en>) {
            expect(placeholders(STRINGS.hi[key]), key).toEqual(placeholders(STRINGS.en[key]));
        }
    });

    it('translates the installer and refusal copy, and names no company', () => {
        const keys = (Object.keys(STRINGS.en) as Array<keyof typeof STRINGS.en>).filter((key) =>
            /^(installer|addSchool|school|panelCode|notInstaller|noSchools|refused|installUntil|continuePanel|enterSchoolCode)/.test(
                key
            )
        );
        expect(keys.length).toBeGreaterThan(20);
        for (const key of keys) {
            expect(STRINGS.hi[key], key).not.toBe(STRINGS.en[key]);
            // Copy says "installer" or "school" and carries no currency amount.
            expect(STRINGS.en[key], key).not.toMatch(/₹|\$/);
        }
    });

    it('fills known values', () => {
        expect(fill('Slide {index} of {total}', { index: 4, total: 20 })).toBe('Slide 4 of 20');
    });

    it('prefers the saved language, then the browser', () => {
        expect(detectLang('hi', 'en-IN')).toBe('hi');
        expect(detectLang(null, 'hi-IN')).toBe('hi');
        expect(detectLang(null, 'en-US')).toBe('en');
        expect(detectLang('xx', undefined)).toBe('en');
    });
});
