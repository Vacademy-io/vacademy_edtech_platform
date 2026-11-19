/**
 * WP-51 contract §7.3, report page: the totals row shows the server's totals
 * (no client sum); a warning renders with its count; the export buttons call
 * the download once on a double click; REPORT_BUSY shows its sentence; a 403
 * shows "no access here"; an empty answer shows the empty state.
 */
import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', async () => {
    const kit = await import('./report-test-kit');
    return { useTranslation: () => ({ t: kit.tWithValues, i18n: { language: 'en' } }) };
});
vi.mock('@/components/design-system/table', async () => ({ MyTable: (await import('./report-test-kit')).MockTable }));
vi.mock('@/routes/commerce/-components/CommercePage', () => ({
    CommercePage: ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
        <div>
            <h2>{title}</h2>
            <div>{actions}</div>
            {children}
        </div>
    ),
}));
vi.mock('@/lib/commerce/use-commerce-access', async () => {
    const { accessFor, MANAGER } = await import('@/routes/commerce/inventory/-shared/inventory-test-fixtures');
    return { useCommerceAccess: () => accessFor(MANAGER) };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/routes/commerce/inventory/-shared/inventory-api', () => ({ fetchInventoryLocations: vi.fn(async () => []) }));
vi.mock('../-shared/reports-api', () => ({
    REPORT_PAGE_SIZE: 100,
    fetchReport: vi.fn(),
    downloadReport: vi.fn(),
    fetchAudit: vi.fn(),
    fetchApprovals: vi.fn(),
    fetchAuditKinds: vi.fn(async () => []),
}));

import * as api from '../-shared/reports-api';
import { reportEntry } from '../-shared/report-catalogue';
import { ReportPage } from './ReportPage';
import { answer, column, renderWithQuery, serverError } from './report-test-kit';

const fetchReport = vi.mocked(api.fetchReport);
const downloadReport = vi.mocked(api.downloadReport);

const register = answer({
    columns: [column('invoice_number', 'TEXT', 'Invoice'), column('taxable', 'MONEY', 'Taxable'), column('total', 'MONEY', 'Total')],
    rows: [
        { invoice_number: 'INV-1', taxable: '100.00', total: '105.00' },
        { invoice_number: 'INV-2', taxable: '50.00', total: '52.50' },
    ],
    // Deliberately not the sum of the two rows: the screen must print the server's figure.
    totals: { taxable: '999.99', total: '1049.99', count: 2, cancelled_total: '40.00' },
    warnings: [
        { code: 'HSN_MISSING', message: 'line without HSN', ref: 'INV-1', count: null },
        { code: 'HSN_MISSING', message: 'line without HSN', ref: 'INV-2', count: null },
    ],
    nextCursor: 'c-2',
});

const renderPage = (search = {}) =>
    renderWithQuery(<ReportPage entry={reportEntry('salesRegister')!} search={search} onSearch={() => undefined} />);

describe('ReportPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchReport.mockResolvedValue(register);
    });

    it('the totals row shows the server totals, never a sum of the rows on screen', async () => {
        renderPage();
        const table = await screen.findByTestId('report-main-table');
        expect(table.textContent).toContain('INV-1');
        const totalsCells = table.querySelectorAll('[data-totals="true"]');
        const totalsText = Array.from(totalsCells).map((c) => c.textContent).join('|');
        expect(totalsText).toContain('reports.table.total');
        expect(totalsText).toContain('₹999.99');
        expect(totalsText).toContain('₹1,049.99');
        expect(table.textContent).not.toContain('₹150.00');
        // Totals beyond the columns (count, cancelled apart) are listed as sent.
        expect(screen.getByTestId('report-extra-totals').textContent).toContain('₹40.00');
        expect(screen.getByTestId('report-as-of').textContent).toContain('14:00');
    });

    it('sends the filters of the address with the register page size', async () => {
        renderPage({ from: '2026-11-01', to: '2026-11-10', location: 'L1', channel: 'POS' });
        await screen.findByTestId('report-main-table');
        expect(fetchReport).toHaveBeenCalledWith(
            'sales-register',
            { from: '2026-11-01', to: '2026-11-10', locationId: 'L1', channel: 'POS' },
            null,
            100
        );
    });

    it('"Next page" asks for the server cursor; "Previous page" goes back', async () => {
        renderPage({ from: '2026-11-01', to: '2026-11-10' });
        await screen.findByTestId('report-main-table');
        fireEvent.click(screen.getByText('reports.table.next'));
        await waitFor(() => expect(fetchReport).toHaveBeenLastCalledWith('sales-register', expect.anything(), 'c-2', 100));
    });

    it('a warning renders once per code with its count', async () => {
        renderPage();
        const warnings = await screen.findByTestId('report-warnings');
        expect(warnings.textContent).toContain('reports.warnings.HSN_MISSING');
        expect(warnings.textContent).toContain('reports.warnings.count 2');
        expect(warnings.textContent).toContain('INV-1, INV-2');
    });

    it('the export buttons call the download once on a double click', async () => {
        let finish: (name: string) => void = () => undefined;
        downloadReport.mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)));
        renderPage({ from: '2026-11-01', to: '2026-11-10' });
        const csv = screen.getByTestId('report-download-csv');
        fireEvent.click(csv);
        fireEvent.click(csv);
        fireEvent.click(screen.getByTestId('report-download-xlsx'));
        expect(downloadReport).toHaveBeenCalledTimes(1);
        expect(downloadReport).toHaveBeenCalledWith('sales-register', { from: '2026-11-01', to: '2026-11-10' }, 'csv');
        finish('sales-register-2026-11-01-2026-11-10.csv');
        expect(await screen.findByText(/reports\.export\.done/)).toBeTruthy();
    });

    it('REPORT_BUSY shows "another download is running"', async () => {
        downloadReport.mockRejectedValue(serverError(429, 'REPORT_BUSY: another export is running; try again in a minute'));
        renderPage();
        fireEvent.click(screen.getByTestId('report-download-xlsx'));
        expect(await screen.findByText('reports.errors.REPORT_BUSY')).toBeTruthy();
    });

    it('a 403 reads "no access at this location", without Retry', async () => {
        fetchReport.mockRejectedValue(serverError(403, 'LOCATION_NOT_ALLOWED: L1'));
        renderPage({ location: 'L1' });
        expect(await screen.findByTestId('report-no-access')).toBeTruthy();
        expect(screen.queryByText('common.retry')).toBeNull();
    });

    it('a load error offers Retry', async () => {
        fetchReport.mockRejectedValueOnce(serverError(503, 'REPORT_TIMEOUT: narrow the dates'));
        renderPage();
        expect(await screen.findByText('reports.errors.REPORT_TIMEOUT')).toBeTruthy();
        fetchReport.mockResolvedValueOnce(register);
        fireEvent.click(screen.getByText('common.retry'));
        expect(await screen.findByTestId('report-main-table')).toBeTruthy();
    });

    it('no rows: "No documents in these dates"', async () => {
        fetchReport.mockResolvedValue(answer({ columns: register.columns }));
        renderPage();
        expect(await screen.findByText('reports.page.empty')).toBeTruthy();
    });

    it('a COD order the server flags red is drawn in the error colour', async () => {
        fetchReport.mockResolvedValue(
            answer({
                columns: [column('order_number'), column('days_outstanding', 'INT'), column('cod_amount', 'MONEY')],
                rows: [
                    { order_number: 'ORD-1', days_outstanding: 12, cod_amount: '500.00', red_flag: true },
                    { order_number: 'ORD-2', days_outstanding: 3, cod_amount: '200.00', red_flag: false },
                ],
            })
        );
        renderWithQuery(<ReportPage entry={reportEntry('codOutstanding')!} search={{}} onSearch={() => undefined} />);
        const table = await screen.findByTestId('report-main-table');
        const red = Array.from(table.querySelectorAll('[data-tone="danger"]')).map((c) => c.textContent);
        expect(red).toContain('ORD-1');
        expect(red).not.toContain('ORD-2');
    });

    it('a range the server would refuse is not asked for', async () => {
        renderPage({ from: '2026-11-10', to: '2026-11-01' });
        expect(screen.getByTestId('report-range-problem').textContent).toContain('reports.filters.problems.order');
        expect(fetchReport).not.toHaveBeenCalled();
    });
});
