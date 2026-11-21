/** WP-44 m1: a bill line the quote refused for its step names the step, never a raw "{{step}}". */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

import { useMarkText } from './pos-ui';

describe('useMarkText', () => {
    it('QUANTITY_STEP on a cloth line reads its step in metres', () => {
        const { result } = renderHook(() => useMarkText());
        const text = result.current({ code: 'QUANTITY_STEP', source: 'quote' }, { qtyStep: 5, qtyScale: 10, unit: 'MTR' });
        expect(text).toBe('Sold in steps of 0.5 m. Change the quantity on the bill.');
        expect(text).not.toContain('{{');
    });

    it('a counted item sold in packs reads its pack size', () => {
        const { result } = renderHook(() => useMarkText());
        expect(result.current({ code: 'QUANTITY_STEP' }, { qtyStep: 6, qtyScale: 1, unit: 'PCS' })).toBe(
            'Sold in steps of 6. Change the quantity on the bill.'
        );
    });
});
