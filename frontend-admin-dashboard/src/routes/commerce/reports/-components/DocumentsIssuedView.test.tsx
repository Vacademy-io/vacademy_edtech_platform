/**
 * WP-51 contract §7.3, documents issued: system numbers and paper bill books
 * are two blocks; the pages "not entered" are listed under their book
 * ("not entered: 102"); a series with a gap is drawn in the error colour.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('./report-test-kit')).MockTable }));

import { DocumentsIssuedView, hasGap } from './DocumentsIssuedView';
import { answer, column } from './report-test-kit';

const systemCols = [column('prefix'), column('from_number'), column('to_number'), column('total', 'INT'), column('gap')];
const bookCols = [column('book_prefix'), column('book_range'), column('total', 'INT'), column('not_entered')];

const issued = answer({
    report: 'documents-issued',
    sections: [
        {
            key: 'system',
            title: null,
            columns: systemCols,
            rows: [
                { prefix: 'INV/', from_number: 'INV/2627-00001', to_number: 'INV/2627-00009', total: 9, gap: 'none' },
                { prefix: 'CN/', from_number: 'CN/2627-00001', to_number: 'CN/2627-00004', total: 3, gap: ['CN/2627-00003'] },
            ],
            totals: null,
        },
        {
            key: 'bill_books',
            title: null,
            columns: bookCols,
            rows: [{ book_prefix: 'BK', book_range: '100–199', total: 2, not_entered: [102] }],
            totals: null,
        },
    ],
});

describe('DocumentsIssuedView', () => {
    it('system numbers and paper bill books are two blocks', () => {
        render(<DocumentsIssuedView answer={issued} />);
        const system = screen.getByTestId('report-section-system');
        const books = screen.getByTestId('report-section-bill_books');
        expect(system.textContent).toContain('reports.sections.system');
        expect(system.textContent).toContain('INV/2627-00001');
        expect(system.textContent).not.toContain('100–199');
        expect(books.textContent).toContain('reports.sections.bill_books');
        expect(books.textContent).toContain('100–199');
    });

    it('lists the pages not entered under the book: "not entered: 102"', () => {
        render(<DocumentsIssuedView answer={issued} />);
        const list = within(screen.getByTestId('report-section-bill_books')).getByTestId('not-entered');
        expect(list.textContent).toBe('reports.documents.notEntered BK 102');
    });

    it('a series with a gap is in the error colour; one without is not', () => {
        render(<DocumentsIssuedView answer={issued} />);
        const system = screen.getByTestId('report-section-system');
        const danger = system.querySelectorAll('[data-tone="danger"]');
        expect(danger.length).toBeGreaterThan(0);
        danger.forEach((cell) => expect(cell.className).toContain('text-danger-600'));
        expect(Array.from(danger).some((cell) => cell.textContent?.includes('CN/2627-00003'))).toBe(true);
        expect(Array.from(danger).some((cell) => cell.textContent?.includes('INV/2627-00001'))).toBe(false);
    });

    it('reads a gap from "gap" or "missing"', () => {
        expect(hasGap({ gap: 'none' })).toBe(false);
        expect(hasGap({ gap: [] })).toBe(false);
        expect(hasGap({ missing: [5] })).toBe(true);
        expect(hasGap({ gap: '5, 6' })).toBe(true);
    });
});
