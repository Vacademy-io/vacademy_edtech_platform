import { describe, expect, it } from 'vitest';
import { applyTheme, primaryRamp } from './theme';

describe('primaryRamp', () => {
    it('reads a preset and a custom hex, and refuses anything else', () => {
        expect(primaryRamp('blue')?.['500']).toBeDefined();
        expect(primaryRamp('#123456')?.['50']).toBeDefined(); // design-lint-ignore: test data
        expect(primaryRamp('no-such-theme')).toBeNull();
        expect(primaryRamp('#12')).toBeNull();
        expect(primaryRamp(null)).toBeNull();
    });
});

describe('applyTheme', () => {
    it('sets the ramp variables, and leaves them alone for an unknown code', () => {
        applyTheme('#123456'); // design-lint-ignore: test data
        const value = document.documentElement.style.getPropertyValue('--primary-500');
        expect(value).toMatch(/^\d+ \d+% \d+%$/);
        applyTheme('no-such-theme');
        expect(document.documentElement.style.getPropertyValue('--primary-500')).toBe(value);
    });
});
