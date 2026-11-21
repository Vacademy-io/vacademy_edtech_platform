import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/common/layout-container/sidebar/utils', () => ({ getTerminology: () => 'Course' }));

import { displayName, itemTitle } from './cart-item-display';
import type { ProductPageMappingResponse } from '../-types/product-page-types';

const mapping = (m: Partial<ProductPageMappingResponse>) => m as ProductPageMappingResponse;

describe('cart item names', () => {
    it('hides the placeholder level and session names a course without them carries', () => {
        expect(displayName('default')).toBe('');
        expect(displayName(' DEFAULT ')).toBe('');
        expect(displayName(null)).toBe('');
        expect(displayName('Class 5')).toBe('Class 5');
    });

    it('titles a PDF by its name alone, never "· default · DEFAULT"', () => {
        expect(
            itemTitle(mapping({ package_name: 'NCERT Indian Agriculture PDF', level_name: 'default', session_name: 'DEFAULT' }))
        ).toBe('NCERT Indian Agriculture PDF');
    });

    it('keeps real level and session names as before', () => {
        expect(itemTitle(mapping({ package_name: 'Maths', level_name: 'Class 5', session_name: '2026' }))).toBe(
            'Maths · Class 5 · 2026'
        );
    });
});
