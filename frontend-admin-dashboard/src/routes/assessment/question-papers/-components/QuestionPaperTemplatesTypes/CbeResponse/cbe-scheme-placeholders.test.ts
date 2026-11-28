import { describe, expect, it } from 'vitest';
import en from '../../../../../../../public/locales/en/assessmentCbeQP.json';
import ar from '../../../../../../../public/locales/ar/assessmentCbeQP.json';
import fr from '../../../../../../../public/locales/fr/assessmentCbeQP.json';
import hi from '../../../../../../../public/locales/hi/assessmentCbeQP.json';

// An empty marking-scheme cell shows its placeholder; a bare figure or working
// ("3,200", "W4: 3,800 − 600 impairment") reads as data that was entered.
describe('marking-scheme placeholders', () => {
    const locales = { en, ar, fr, hi };

    it.each(Object.entries(locales))('%s: optional columns hold no figures', (_locale, file) => {
        const p = file.scheme.placeholders;
        expect(Object.keys(p).sort()).toEqual(['cellRef', 'expected', 'guidance', 'label']);
        expect(p.expected).not.toMatch(/\d/);
        expect(p.guidance).not.toMatch(/\d/);
    });

    it.each(Object.entries(locales))(
        '%s: example values are marked as examples',
        (_locale, file) => {
            const p = file.scheme.placeholders;
            const prefix = p.label.split(' ')[0] ?? '';
            expect(p.cellRef.startsWith(prefix)).toBe(true);
        }
    );
});
