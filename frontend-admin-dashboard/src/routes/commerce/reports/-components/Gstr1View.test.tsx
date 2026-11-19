/**
 * WP-51 contract §7.3, GSTR-1, on the server's answer (`GstReportService.gstr1`):
 * each sheet has its tab and its table; B2C small shows `b2cs_credit_notes`,
 * Documents shows `docs_bill_books`; the check block reads `check.columns`
 * (named by the sheets' column labels): "Adds up" at 0.00, else "Does not add up".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
// The kit reads fixtures through `normalizeReport` (reports-api), which imports these.
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('./report-test-kit')).MockTable }));
vi.mock('@/routes/commerce/-components/CatalogueBits', () => ({ useAdminLanguage: () => 'en' }));

import { GSTR1_TABS } from '../-shared/report-keys';
import { GSTR1_JSON } from '../-shared/report-server-fixtures';
import { checkAddsUp, Gstr1View } from './Gstr1View';
import { answer, fromServer } from './report-test-kit';

const gstr1 = fromServer(GSTR1_JSON);

describe('Gstr1View', () => {
    it('a tab per sheet, each showing its own rows', () => {
        render(<Gstr1View answer={gstr1} />);
        expect(screen.getAllByRole('tab')).toHaveLength(GSTR1_TABS.length);
        GSTR1_TABS.forEach((key) => {
            fireEvent.click(screen.getByText(`reports.gstr1.tabs.${key}`));
            expect(screen.getByRole('tab', { selected: true }).textContent).toBe(`reports.gstr1.tabs.${key}`);
            expect(screen.getByTestId(`report-section-${key}`).textContent).toContain(`DOC-${key}`);
        });
    });

    it('B2C small shows the credit notes netted into it; Documents shows the paper bill books', () => {
        render(<Gstr1View answer={gstr1} />);
        expect(screen.queryByTestId('report-section-b2cs_credit_notes')).toBeNull();
        fireEvent.click(screen.getByText('reports.gstr1.tabs.b2cs'));
        expect(screen.getByTestId('report-section-b2cs_credit_notes').textContent).toContain('CN-netted');
        fireEvent.click(screen.getByText('reports.gstr1.tabs.docs'));
        const books = screen.getByTestId('report-section-docs_bill_books');
        expect(books.querySelector('h3')?.textContent).toBe('Paper bill books');
        expect(books.textContent).toContain('100–199');
        // The series with a gap is in the error colour on the documents sheet too.
        const red = screen.getByTestId('report-section-docs').querySelectorAll('[data-tone="danger"]');
        expect(Array.from(red).some((cell) => cell.textContent?.includes('CN/2627-00001'))).toBe(true);
    });

    it('a sheet total that is a count (documents) is an integer; documents_value is money', () => {
        render(<Gstr1View answer={gstr1} />);
        const extra = screen.getByTestId('report-section-totals-b2b');
        expect(extra.querySelector('[data-total="documents"]')?.textContent).not.toContain('₹');
        expect(extra.querySelector('[data-total="documents_value"]')?.textContent).toContain('₹105.00');
    });

    it('a sheet with no rows says so', () => {
        render(<Gstr1View answer={answer({ sections: [] })} />);
        expect(screen.getByTestId('report-section-b2b').textContent).toContain('reports.table.nothing');
    });

    it('check difference 0.00 reads "Adds up", one line per server check column', () => {
        expect(gstr1.check?.columns.map((c) => c.key)).toEqual(['taxable_value', 'cgst', 'sgst', 'igst', 'cess']);
        render(<Gstr1View answer={gstr1} />);
        const check = screen.getByTestId('gstr1-check');
        expect(check.textContent).toContain('reports.gstr1.check.addsUp');
        // Named by the B2B sheet's column label for taxable_value.
        expect(check.textContent).toContain('Taxable Value');
        expect(check.textContent).toContain('₹900.00');
    });

    it('a difference in one column reads "Does not add up"', () => {
        const off = fromServer({
            ...GSTR1_JSON,
            check: {
                rule: 'x',
                columns: [{ key: 'igst', sections: 10.0, documents: 9.0, difference: 1.0 }],
                difference: 1.0,
            },
        });
        render(<Gstr1View answer={off} />);
        expect(screen.getByTestId('gstr1-check').textContent).toContain('reports.gstr1.check.doesNotAddUp');
        expect(checkAddsUp({ rule: null, difference: '0.01', columns: [] })).toBe(false);
        expect(checkAddsUp({ rule: null, difference: 0, columns: [] })).toBe(true);
    });
});
