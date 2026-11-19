/**
 * WP-51 contract §7.3, day book, on the server's answer (`DayBookService`):
 * the four sections `documents`, `money`, `by_mode`, `sessions`; TIME cells
 * are India wall text printed as they are ("—" for a paper bill); headings and
 * column labels are the server's; "cash at the tills" is `totals.cash_at_tills`.
 */
import { render, screen } from '@testing-library/react';
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

import { DAY_BOOK_JSON } from '../-shared/report-server-fixtures';
import { DayBookView } from './DayBookView';
import { fromServer } from './report-test-kit';

const day = fromServer(DAY_BOOK_JSON);

describe('DayBookView', () => {
    it('document rows and money rows are separate tables, headed by the server labels', () => {
        render(<DayBookView answer={day} />);
        const documents = screen.getByTestId('report-section-documents');
        const money = screen.getByTestId('report-section-money');
        expect(documents.querySelector('h3')?.textContent).toBe('Documents');
        expect(money.querySelector('h3')?.textContent).toBe('Money');
        expect(documents.textContent).toContain('INV/2627-00001');
        expect(documents.textContent).not.toContain('SALE_PAYMENT');
        expect(money.textContent).toContain('SALE_PAYMENT');
        expect(money.textContent).not.toContain('INV/2627-00001');
        expect(money.textContent).toContain('₹105.00');
        expect(Array.from(money.querySelectorAll('th')).map((th) => th.textContent)).toContain('Amount in');
    });

    it('TIME is the India wall clock as sent: 10:30 stays 10:30; a paper bill reads "—"', () => {
        render(<DayBookView answer={day} />);
        const documents = screen.getByTestId('report-section-documents');
        expect(documents.textContent).toContain('19 Nov 2026, 10:30');
        // The old screen read the text as UTC and added 5:30 again.
        expect(documents.textContent).not.toContain('16:00');
        const cells = Array.from(documents.querySelectorAll('td')).map((td) => td.textContent);
        expect(cells).toContain('—');
    });

    it('block totals beyond the columns: counts as integers, values as money', () => {
        render(<DayBookView answer={day} />);
        const extra = screen.getByTestId('report-section-totals-documents');
        const figure = (key: string) => extra.querySelector(`[data-total="${key}"]`);
        expect(figure('invoices')?.getAttribute('data-type')).toBe('INT');
        expect(figure('invoices')?.textContent).toContain('2');
        expect(figure('invoices')?.textContent).not.toContain('₹');
        expect(figure('credit_notes')?.textContent).not.toContain('₹');
        expect(figure('invoices_value')?.textContent).toContain('₹155.00');
        expect(figure('net')?.textContent).toContain('₹125.00');
        const sessions = screen.getByTestId('report-section-totals-sessions');
        expect(sessions.querySelector('[data-total="sessions"]')?.textContent).not.toContain('₹');
        // Cash at the tills has its own card, not repeated under the sessions.
        expect(sessions.querySelector('[data-total="cash_at_tills"]')).toBeNull();
    });

    it('the footer by mode, the sessions and the cash at the tills follow', () => {
        render(<DayBookView answer={day} />);
        expect(screen.getByTestId('report-section-by_mode').textContent).toContain('UPI');
        expect(screen.getByTestId('report-section-sessions').textContent).toContain('R1');
        expect(screen.getByTestId('cash-at-tills').textContent).toContain('₹500.00');
    });
});
