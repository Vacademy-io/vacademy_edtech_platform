import { describe, expect, it } from 'vitest';
import en from '../../../../../../../public/locales/en/scanStation.json';
import hi from '../../../../../../../public/locales/hi/scanStation.json';
import fr from '../../../../../../../public/locales/fr/scanStation.json';
import ar from '../../../../../../../public/locales/ar/scanStation.json';
import {
    AI_SCAN_FLAG_CODES,
    PLANNER_SCAN_FLAG_CODES,
    VERDICT_REASON_CODES,
} from '../-services/scan-station-services';
import { CODE_SEVERITY, flagCopy, KNOWN_FLAG_CODES } from './flag-copy';

const lookup = (catalog: unknown, key: string): unknown =>
    key
        .split('.')
        .reduce<unknown>(
            (node, part) =>
                node && typeof node === 'object'
                    ? (node as Record<string, unknown>)[part]
                    : undefined,
            catalog
        );

const ALL_CODES = [...AI_SCAN_FLAG_CODES, ...PLANNER_SCAN_FLAG_CODES, ...VERDICT_REASON_CODES];

describe('flagCopy', () => {
    it.each(ALL_CODES)('%s has a title, help text and tone in every language', (code) => {
        const copy = flagCopy(code);
        expect(copy.known).toBe(true);
        for (const catalog of [en, hi, fr, ar]) {
            expect(typeof lookup(catalog, copy.titleKey)).toBe('string');
            expect(typeof lookup(catalog, copy.helpKey)).toBe('string');
        }
        expect(['danger', 'warning', 'info']).toContain(copy.tone);
    });

    it('colours by the contract severity when the flag carries none', () => {
        expect(flagCopy('BACK_HAS_LABEL').tone).toBe('danger');
        expect(flagCopy('SAME_NAME').tone).toBe('warning');
        expect(flagCopy('UNSURE_KEPT').tone).toBe('info');
        expect(flagCopy('NO_COPIES').tone).toBe('danger');
    });

    it("lets the server's severity win", () => {
        expect(flagCopy('SAME_NAME', 'BLOCK').tone).toBe('danger');
    });

    it('falls back safely for a code it does not know', () => {
        const copy = flagCopy('SOMETHING_NEW', 'REVIEW');
        expect(copy.known).toBe(false);
        expect(copy.titleKey).toBe('flags.UNKNOWN.title');
        expect(typeof lookup(en, copy.titleKey)).toBe('string');
        expect(copy.tone).toBe('warning');
        expect(flagCopy('toString').known).toBe(false);
        expect(flagCopy('SOMETHING_NEW').tone).toBe('info');
    });

    it('knows exactly the C1 and planner catalogue', () => {
        expect([...KNOWN_FLAG_CODES].sort()).toEqual(Object.keys(CODE_SEVERITY).sort());
        expect(new Set(KNOWN_FLAG_CODES).size).toBe(26);
    });
});
