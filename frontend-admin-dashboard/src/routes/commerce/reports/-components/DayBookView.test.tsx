/**
 * WP-51 contract §7.3, day book: document rows and money rows are two
 * tables; the footer by payment mode and the counter sessions follow, and
 * "cash at the tills" is the server's figure.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('./report-test-kit')).MockTable }));

import { DayBookView, dayBookBlocks } from './DayBookView';
import { answer, column } from './report-test-kit';

const docCols = [column('time', 'TIME'), column('type'), column('number'), column('value', 'MONEY')];
const moneyCols = [column('time', 'TIME'), column('type'), column('mode'), column('amount_in', 'MONEY'), column('amount_out', 'MONEY')];

const day = answer({
    report: 'day-book',
    sections: [
        {
            key: 'documents',
            title: null,
            columns: docCols,
            rows: [{ time: '2026-11-19T05:00:00Z', type: 'INVOICE', number: 'INV/2627-00001', value: '105.00' }],
            totals: null,
        },
        {
            key: 'money',
            title: null,
            columns: moneyCols,
            rows: [{ time: '2026-11-19T05:00:00Z', type: 'SALE_PAYMENT', mode: 'UPI', amount_in: '105.00', amount_out: null }],
            totals: { amount_in: '105.00', amount_out: '0.00' },
        },
        {
            key: 'by_mode',
            title: null,
            columns: [column('mode'), column('amount_in', 'MONEY'), column('amount_out', 'MONEY')],
            rows: [{ mode: 'UPI', amount_in: '105.00', amount_out: '0.00' }],
            totals: null,
        },
        {
            key: 'sessions',
            title: null,
            columns: [column('register'), column('counted', 'MONEY')],
            rows: [{ register: 'R1', counted: '500.00' }],
            totals: { cash_at_tills: '500.00' },
        },
    ],
});

describe('DayBookView', () => {
    it('document rows and money rows are separate tables', () => {
        render(<DayBookView answer={day} />);
        const documents = screen.getByTestId('report-section-documents');
        const money = screen.getByTestId('report-section-money');
        expect(documents.textContent).toContain('INV/2627-00001');
        expect(documents.textContent).not.toContain('SALE_PAYMENT');
        expect(money.textContent).toContain('SALE_PAYMENT');
        expect(money.textContent).not.toContain('INV/2627-00001');
        expect(money.textContent).toContain('₹105.00');
    });

    it('the footer by mode, the sessions and the cash at the tills follow', () => {
        render(<DayBookView answer={day} />);
        expect(screen.getByTestId('report-section-by_mode').textContent).toContain('UPI');
        expect(screen.getByTestId('report-section-sessions').textContent).toContain('R1');
        expect(screen.getByTestId('cash-at-tills').textContent).toContain('₹500.00');
    });

    it('one list with a row_kind column is split by that column', () => {
        const blocks = dayBookBlocks(
            answer({
                columns: [column('row_kind'), column('number')],
                rows: [
                    { row_kind: 'DOCUMENT', number: 'INV-1' },
                    { row_kind: 'MONEY', number: 'INV-1' },
                ],
            })
        );
        expect(blocks.documents.rows).toHaveLength(1);
        expect(blocks.money.rows).toEqual([{ row_kind: 'MONEY', number: 'INV-1' }]);
    });
});
