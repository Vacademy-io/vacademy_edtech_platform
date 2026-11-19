/**
 * WP-51 contract §7.3, GSTR-1: each sheet has its tab and its table; the
 * check block reads "Adds up" when the server's difference is 0.00 and
 * "Does not add up" otherwise.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('./report-test-kit')).MockTable }));

import { GSTR1_TABS } from '../-shared/report-keys';
import type { ReportSection } from '../-shared/report-types';
import { checkAddsUp, Gstr1View } from './Gstr1View';
import { answer, column } from './report-test-kit';

const cols = [column('invoice_number'), column('rate', 'PERCENT'), column('taxable', 'MONEY')];
const section = (key: string, invoice: string): ReportSection => ({
    key,
    title: null,
    columns: cols,
    rows: [{ invoice_number: invoice, rate: 5, taxable: '100.00' }],
    totals: { taxable: '100.00' },
});

const gstr1 = answer({
    report: 'gstr1',
    sections: [
        ...GSTR1_TABS.map((key) => section(key, `DOC-${key}`)),
        section('b2cs_credit_notes', 'CN-netted'),
    ],
    check: {
        difference: '0.00',
        lines: [{ key: 'taxable', sections: '900.00', documents: '900.00', difference: '0.00' }],
    },
});

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

    it('B2C small shows the credit notes netted into it', () => {
        render(<Gstr1View answer={gstr1} />);
        expect(screen.queryByTestId('report-section-b2cs_credit_notes')).toBeNull();
        fireEvent.click(screen.getByText('reports.gstr1.tabs.b2cs'));
        expect(screen.getByTestId('report-section-b2cs_credit_notes').textContent).toContain('CN-netted');
    });

    it('a sheet with no rows says so', () => {
        render(<Gstr1View answer={answer({ sections: [] })} />);
        expect(screen.getByTestId('report-section-b2b').textContent).toContain('reports.table.nothing');
    });

    it('check difference 0.00 reads "Adds up"', () => {
        render(<Gstr1View answer={gstr1} />);
        const check = screen.getByTestId('gstr1-check');
        expect(check.textContent).toContain('reports.gstr1.check.addsUp');
        expect(check.textContent).toContain('reports.gstr1.check.keys.taxable');
        expect(check.textContent).toContain('₹900.00');
    });

    it('a difference reads "Does not add up"', () => {
        const off = { difference: '0.00', lines: [{ key: 'igst', sections: '10.00', documents: '9.00', difference: '1.00' }] };
        render(<Gstr1View answer={answer({ check: off })} />);
        expect(screen.getByTestId('gstr1-check').textContent).toContain('reports.gstr1.check.doesNotAddUp');
        expect(checkAddsUp({ difference: '0.01', lines: [] })).toBe(false);
        expect(checkAddsUp({ difference: 0, lines: [] })).toBe(true);
    });
});
