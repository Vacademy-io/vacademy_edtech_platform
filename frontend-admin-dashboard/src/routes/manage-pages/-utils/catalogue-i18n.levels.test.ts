import { describe, expect, it } from 'vitest';
import { isTextKey, localizeDeep } from './catalogue-i18n';

// Mirrors the learner renderer (identical catalogue-i18n.ts): a courseCatalog
// customFilters option's `levels` are course level names matched raw, so the
// builder must never offer them for translation either.
describe('catalogue-i18n: customFilters levels', () => {
    it('treats levels as data and labels as text', () => {
        expect(isTextKey('levels')).toBe(false);
        expect(isTextKey('label')).toBe(true);
        const dict = { eBook: 'ई-पुस्तक', 'E-books': 'ई-पुस्तकें' };
        expect(localizeDeep({ options: [{ id: 'ebook', label: 'E-books', levels: ['eBook'] }] }, dict)).toEqual({
            options: [{ id: 'ebook', label: 'ई-पुस्तकें', levels: ['eBook'] }],
        });
    });
});
