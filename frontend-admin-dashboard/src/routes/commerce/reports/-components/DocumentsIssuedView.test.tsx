/**
 * WP-51 contract §7.3, documents issued, on the server's answer
 * (`GstReportService.documentsIssued`): blocks `system` and `bill_books`
 * headed by the server's labels; "dated in another period" is a column of
 * `system`; the pages "not entered" are listed under their book by `prefix`
 * ("BK: not entered: 102"); a series whose `gap` is not "none" is in the
 * error colour.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
// The kit reads fixtures through `normalizeReport` (reports-api), which imports these.
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('./report-test-kit')).MockTable }));
const lang = vi.hoisted(() => ({ value: 'en' as 'en' | 'hi' }));
vi.mock('@/routes/commerce/-components/CatalogueBits', () => ({ useAdminLanguage: () => lang.value }));

import { DOCUMENTS_ISSUED_JSON } from '../-shared/report-server-fixtures';
import { DocumentsIssuedView, hasGap } from './DocumentsIssuedView';
import { fromServer } from './report-test-kit';

const issued = fromServer(DOCUMENTS_ISSUED_JSON);

describe('DocumentsIssuedView', () => {
    it('system numbers and paper bill books are two blocks, with the server headings', () => {
        lang.value = 'en';
        render(<DocumentsIssuedView answer={issued} />);
        const system = screen.getByTestId('report-section-system');
        const books = screen.getByTestId('report-section-bill_books');
        expect(system.querySelector('h3')?.textContent).toBe('System numbers');
        expect(system.textContent).toContain('INV/2627-00001');
        expect(system.textContent).not.toContain('100–199');
        expect(books.querySelector('h3')?.textContent).toBe('Paper bill books');
        expect(books.textContent).toContain('100–199');
        // "Dated in another period" is a column of the system block, not a block of its own.
        expect(Array.from(system.querySelectorAll('th')).map((th) => th.textContent)).toContain('Dated in another period');
        expect(screen.queryByTestId('report-section-other_period')).toBeNull();
    });

    it('in Hindi the headings and column labels are the server label_hi', () => {
        lang.value = 'hi';
        render(<DocumentsIssuedView answer={issued} />);
        const system = screen.getByTestId('report-section-system');
        expect(system.querySelector('h3')?.textContent).toBe('सिस्टम नंबर');
        expect(Array.from(system.querySelectorAll('th')).map((th) => th.textContent)).toContain('छूटे नंबर');
        lang.value = 'en';
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
        expect(Array.from(danger).some((cell) => cell.textContent?.includes('CN/2627-00001'))).toBe(true);
        expect(Array.from(danger).some((cell) => cell.textContent?.includes('INV/2627-00001'))).toBe(false);
    });

    it('reads a gap from the server text in "gap" ("none" or the numbers)', () => {
        expect(hasGap({ gap: 'none' })).toBe(false);
        expect(hasGap({ gap: '' })).toBe(false);
        expect(hasGap({ gap: 'CN/2627-00003' })).toBe(true);
        expect(hasGap({ missing: [5] })).toBe(false);
    });
});
