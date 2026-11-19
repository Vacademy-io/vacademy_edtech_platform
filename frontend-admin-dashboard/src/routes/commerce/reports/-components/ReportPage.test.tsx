/**
 * WP-51 contract §7.3, report page: the totals row shows the server's totals
 * (no client sum); a warning renders with its count; the export buttons call
 * the download once on a double click; REPORT_BUSY shows its sentence; a 403
 * shows "no access here"; an empty answer shows the empty state.
 *
 * Answers are the server's JSON (`report-server-fixtures.ts`) through
 * `normalizeReport`: labels from `label`, totals typed by their column, counts
 * that are no column as plain numbers, `*_text` columns in place of the raw ones.
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
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { get: vi.fn() } }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('../-shared/reports-api', async (importOriginal) => ({
    normalizeReport: (await importOriginal<typeof import('../-shared/reports-api')>()).normalizeReport,
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
import {
    COD_OUTSTANDING_JSON,
    CREDIT_NOTES_JSON,
    HSN_SUMMARY_JSON,
    PRODUCTS_JSON,
    SALES_REGISTER_JSON,
} from '../-shared/report-server-fixtures';
import { fromServer, renderWithQuery, serverError } from './report-test-kit';

const fetchReport = vi.mocked(api.fetchReport);
const downloadReport = vi.mocked(api.downloadReport);

// Totals deliberately not the sum of the two rows: the screen must print the server's figure.
const register = fromServer(SALES_REGISTER_JSON);

/** The extra-totals line of one key: its text and how it was typed. */
const extraTotal = (container: HTMLElement, key: string) => {
    const node = container.querySelector(`[data-total="${key}"]`);
    return { text: node?.textContent ?? null, type: node?.getAttribute('data-type') ?? null };
};

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
        expect(table.textContent).toContain('INV/2627-00001');
        // Header = the server's `label`.
        expect(Array.from(table.querySelectorAll('th')).map((th) => th.textContent)).toContain('Taxable value');
        const totalsCells = table.querySelectorAll('[data-totals="true"]');
        const totalsText = Array.from(totalsCells).map((c) => c.textContent).join('|');
        expect(totalsText).toContain('reports.table.total');
        expect(totalsText).toContain('₹999.99');
        expect(totalsText).toContain('₹1,049.99');
        expect(table.textContent).not.toContain('₹150.00');
        // as_of is India ISO with offset: 14:00 India.
        expect(screen.getByTestId('report-as-of').textContent).toContain('14:00');
    });

    it('totals beyond the columns: counts are plain numbers, cancelled_total is money', async () => {
        renderPage();
        const extras = await screen.findByTestId('report-extra-totals');
        expect(extraTotal(extras, 'invoices')).toEqual({ text: 'reports.totals.invoices12', type: 'INT' });
        expect(extraTotal(extras, 'cancelled_invoices')).toEqual({ text: 'reports.totals.cancelled_invoices1', type: 'INT' });
        expect(extraTotal(extras, 'cancelled_total').type).toBe('MONEY');
        expect(extraTotal(extras, 'cancelled_total').text).toContain('₹40.00');
        // A count is never drawn as money.
        expect(extras.textContent).not.toContain('₹12');
        // Column totals stay in the totals row, not in the extra list.
        expect(extraTotal(extras, 'invoice_total').text).toBeNull();
    });

    it('a block report types its top totals by the section columns; round_off and documents_total are money', async () => {
        fetchReport.mockResolvedValue(fromServer(HSN_SUMMARY_JSON));
        renderWithQuery(<ReportPage entry={reportEntry('hsnSummary')!} search={{}} onSearch={() => undefined} />);
        const extras = await screen.findByTestId('report-extra-totals');
        expect(extraTotal(extras, 'total_value')).toEqual({ text: 'Total value₹579.98', type: 'MONEY' });
        expect(extraTotal(extras, 'round_off').type).toBe('MONEY');
        expect(extraTotal(extras, 'documents_total').text).toContain('₹580.00');
        // Section headings are the server's labels (English answer).
        expect(screen.getByTestId('report-section-hsn_b2c').querySelector('h3')?.textContent).toBe('HSN B2C');
        // HSN quantity is a number in display units (UQC beside it).
        expect(screen.getByTestId('report-section-hsn_b2c').textContent).toContain('4.7');
    });

    it('COD totals: order counts as numbers, amounts as money, section counts under their table', async () => {
        fetchReport.mockResolvedValue(fromServer(COD_OUTSTANDING_JSON));
        renderWithQuery(<ReportPage entry={reportEntry('codOutstanding')!} search={{}} onSearch={() => undefined} />);
        const extras = await screen.findByTestId('report-extra-totals');
        expect(extraTotal(extras, 'outstanding_count')).toEqual({ text: 'reports.totals.outstanding_count2', type: 'INT' });
        expect(extraTotal(extras, 'red_flag_count').type).toBe('INT');
        expect(extraTotal(extras, 'outstanding_amount').type).toBe('MONEY');
        expect(extraTotal(extras, 'in_transit_amount').text).toContain('₹300.00');
        // gross / net are remittance columns: money, with the column's label.
        expect(extraTotal(extras, 'net')).toEqual({ text: 'Net received₹475.00', type: 'MONEY' });
        const outstanding = screen.getByTestId('report-section-totals-outstanding');
        expect(extraTotal(outstanding, 'red_flag_orders')).toEqual({ text: 'reports.totals.red_flag_orders1', type: 'INT' });
        expect(extraTotal(outstanding, 'orders').type).toBe('INT');
        const remittances = screen.getByTestId('report-section-totals-remittances');
        expect(extraTotal(remittances, 'remittances')).toEqual({ text: 'reports.totals.remittances1', type: 'INT' });
        // `orders` is a column of the remittances table: in its totals row, not listed again.
        expect(extraTotal(remittances, 'orders').text).toBeNull();
    });

    it('quantities and rates show the server text; the raw columns are hidden on screen', async () => {
        fetchReport.mockResolvedValue(fromServer(PRODUCTS_JSON));
        renderWithQuery(<ReportPage entry={reportEntry('products')!} search={{}} onSearch={() => undefined} />);
        const table = await screen.findByTestId('report-main-table');
        const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent);
        expect(headers).toEqual(expect.arrayContaining(['Sold (with unit)', 'Net (with unit)', 'Average rate']));
        expect(headers).not.toContain('Sold');
        expect(headers).not.toContain('Net units');
        expect(headers).not.toContain('Average rate per unit');
        expect(table.textContent).toContain('5.9 m');
        expect(table.textContent).toContain('₹123.40 / m');
        // The totals row carries the server's text totals.
        expect(Array.from(table.querySelectorAll('[data-totals="true"]')).map((c) => c.textContent)).toContain('4.7 m');
        expect(screen.getByTestId('report-section-totals-never_sold').textContent).toBe('reports.totals.products1');
        // Not paged by the server: no size sent.
        expect(fetchReport).toHaveBeenCalledWith('products', expect.anything(), null, undefined);
    });

    it('credit notes: "1.2 m" and "₹123.40 / m" from the text columns', async () => {
        fetchReport.mockResolvedValue(fromServer(CREDIT_NOTES_JSON));
        renderWithQuery(<ReportPage entry={reportEntry('creditNotes')!} search={{}} onSearch={() => undefined} />);
        const table = await screen.findByTestId('report-main-table');
        const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent);
        expect(headers).toContain('Quantity with unit');
        expect(headers).not.toContain('Quantity');
        expect(headers).not.toContain('Rate per unit');
        expect(headers).toContain('Rate %');
        expect(table.textContent).toContain('1.2 m');
        expect(table.textContent).toContain('₹123.40 / m');
        expect(extraTotal(screen.getByTestId('report-extra-totals'), 'notes').type).toBe('INT');
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

    it('a warning renders once per code with its count, the "and N more" fold included', async () => {
        renderPage();
        const warnings = await screen.findByTestId('report-warnings');
        expect(warnings.textContent).toContain('reports.warnings.HSN_MISSING');
        // Two listed + "and 3 more".
        expect(warnings.textContent).toContain('reports.warnings.count 5');
        expect(warnings.textContent).toContain('INV/2627-00001, INV/2627-00002');
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
        fetchReport.mockResolvedValue(fromServer({ ...SALES_REGISTER_JSON, rows: [], totals: {}, next_cursor: null }));
        renderPage();
        expect(await screen.findByText('reports.page.empty')).toBeTruthy();
    });

    it('a COD order the server flags red is drawn in the error colour', async () => {
        fetchReport.mockResolvedValue(fromServer(COD_OUTSTANDING_JSON));
        renderWithQuery(<ReportPage entry={reportEntry('codOutstanding')!} search={{}} onSearch={() => undefined} />);
        const table = await screen.findByTestId('report-section-outstanding');
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
