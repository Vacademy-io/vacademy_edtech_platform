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
/** Features on for the person (all unless a test narrows them, N8). */
const features = vi.hoisted(() => ({ on: null as string[] | null }));
vi.mock('@/lib/commerce/use-commerce-access', async () => {
    const { resolveCommerceAccess, COMMERCE_ROLE } = await import('@/lib/commerce/commerce-access');
    return {
        useCommerceAccess: () => ({
            ...resolveCommerceAccess({
                roles: [COMMERCE_ROLE.STORE_MANAGER],
                isFeatureOn: (key: string) => features.on === null || features.on.includes(key),
            }),
            isResolved: true,
        }),
    };
});
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
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
    fetchReportPlaces: vi.fn(async () => ({ places: [], allPlaces: null })),
    fetchAuditActors: vi.fn(async () => []),
}));

import * as api from '../-shared/reports-api';
import { reportEntry } from '../-shared/report-catalogue';
import { ReportPage } from './ReportPage';
import {
    COD_OUTSTANDING_JSON,
    CREDIT_NOTES_JSON,
    DAY_BOOK_JSON,
    GSTR1_JSON,
    HSN_SUMMARY_JSON,
    PRODUCTS_JSON,
    SALES_REGISTER_JSON,
} from '../-shared/report-server-fixtures';
import { fromServer, renderWithQuery, serverError } from './report-test-kit';

const fetchReport = vi.mocked(api.fetchReport);
const downloadReport = vi.mocked(api.downloadReport);
const fetchReportPlaces = vi.mocked(api.fetchReportPlaces);

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
        features.on = null;
        fetchReport.mockResolvedValue(register);
        fetchReportPlaces.mockResolvedValue({ places: [], allPlaces: null });
    });

    it('M4: the server totals sit under the table, outside its scroll box, marked "all pages"; never a sum of the rows', async () => {
        renderPage();
        const table = await screen.findByTestId('report-main-table');
        expect(table.textContent).toContain('INV/2627-00001');
        // Header = the server's `label`.
        expect(Array.from(table.querySelectorAll('th')).map((th) => th.textContent)).toContain('Taxable value');
        // No totals row inside the (scrolling) table.
        expect(table.textContent).not.toContain('₹999.99');
        expect(table.textContent).not.toContain('₹150.00');
        const strip = screen.getByTestId('report-extra-totals');
        expect(table.contains(strip)).toBe(false);
        expect(strip.querySelector('h4')?.textContent).toBe('reports.table.totalAllPages');
        expect(extraTotal(strip, 'taxable_value')).toEqual({ text: 'Taxable value₹999.99', type: 'MONEY' });
        expect(extraTotal(strip, 'invoice_total').text).toContain('₹1,049.99');
        expect(strip.querySelector('[data-total="invoice_total"]')?.getAttribute('data-column')).toBe('true');
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
        // Column totals come first, named by their column; the extra figures follow.
        const keys = Array.from(extras.querySelectorAll('[data-total]')).map((n) => n.getAttribute('data-total'));
        expect(keys.indexOf('invoice_total')).toBeLessThan(keys.indexOf('invoices'));
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
        // `orders` is a column of the remittances table: named by that column, counted once.
        expect(extraTotal(remittances, 'orders')).toEqual({ text: 'Orders1', type: 'INT' });
        expect(remittances.querySelectorAll('[data-total="orders"]')).toHaveLength(1);
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
        // N4: "5.9 m" carries the unit: no "Unit" column beside it.
        expect(headers).not.toContain('Unit');
        // The totals carry the server's text totals.
        expect(extraTotal(screen.getByTestId('report-extra-totals'), 'net_text').text).toBe('Net (with unit)4.7 m');
        expect(extraTotal(screen.getByTestId('report-section-totals-never_sold'), 'products')).toEqual({
            text: 'reports.totals.products1',
            type: 'INT',
        });
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

    it('N1: while one download runs, every download button is disabled', async () => {
        downloadReport.mockImplementation(() => new Promise<string>(() => undefined));
        renderPage({ from: '2026-11-01', to: '2026-11-10' });
        fireEvent.click(screen.getByTestId('report-download-csv'));
        await waitFor(() => expect(screen.getByTestId('report-download-xlsx')).toBeDisabled());
        expect(screen.getByTestId('report-download-csv')).toBeDisabled();
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

    it('N5: customer dues (no dates) empty reads "nothing right now"; a report that is off offers no Retry', async () => {
        fetchReport.mockResolvedValue(fromServer({ ...SALES_REGISTER_JSON, report: 'customer-dues', rows: [], totals: {} }));
        renderWithQuery(<ReportPage entry={reportEntry('customerDues')!} search={{}} onSearch={() => undefined} />);
        expect(await screen.findByText('reports.page.emptyNow')).toBeTruthy();
        expect(screen.queryByText('reports.page.empty')).toBeNull();
    });

    it('N5: FEATURE_DISABLED shows its sentence without a Retry that cannot help', async () => {
        fetchReport.mockRejectedValue(serverError(403, 'FEATURE_DISABLED: reports are off'));
        renderPage();
        expect(await screen.findByText('reports.errors.FEATURE_DISABLED')).toBeTruthy();
        expect(screen.queryByText('common.retry')).toBeNull();
    });

    it('N8: a deep link to a report whose feature is off asks the server nothing', async () => {
        features.on = ['commerce.orders'];
        renderPage();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fetchReport).not.toHaveBeenCalled();
    });

    it('R6: a busy refusal (429 REPORTS_BUSY) is tried again on its own after Retry-After', async () => {
        const busy = serverError(429, 'REPORTS_BUSY: too many reports at once');
        (busy.response as { headers: Record<string, unknown> }).headers = { 'retry-after': '0' };
        fetchReport.mockRejectedValueOnce(busy).mockResolvedValueOnce(register);
        renderPage();
        expect(await screen.findByTestId('report-main-table')).toBeTruthy();
        expect(fetchReport).toHaveBeenCalledTimes(2);
    });

    it('R6: still busy after the tries on its own: the busy sentence with Retry', async () => {
        const busy = serverError(429, 'REPORTS_BUSY: too many reports at once');
        (busy.response as { headers: Record<string, unknown> }).headers = { 'retry-after': '0' };
        fetchReport.mockRejectedValue(busy);
        renderPage();
        expect(await screen.findByText('reports.errors.REPORTS_BUSY')).toBeTruthy();
        expect(fetchReport).toHaveBeenCalledTimes(3);
        expect(screen.getByText('common.retry')).toBeTruthy();
    });

    it('R5: a refused filter is said in the screen\'s own words', async () => {
        fetchReport.mockRejectedValue(serverError(400, 'VALIDATION: size must be 1 to 200'));
        renderPage();
        expect(await screen.findByText('reports.errors.validation.size')).toBeTruthy();
    });

    it('M8: the sales register draws its check block: "Adds up", the rule, the server figures', async () => {
        renderPage();
        const check = await screen.findByTestId('report-check');
        expect(check.textContent).toContain('reports.gstr1.check.addsUp');
        expect(check.textContent).toContain('reports.check.rules.sales-register');
        // A figure with a column's key is named by the column; the others by the screen's words.
        expect(check.querySelector('[data-figure="taxable_value"]')?.textContent).toBe('Taxable value₹999.99');
        expect(check.querySelector('[data-figure="tax"]')?.textContent).toBe('reports.check.figures.tax₹50.00');
        expect(check.querySelector('[data-figure="difference"]')?.textContent).toContain('₹0.00');
    });

    it('M8: a check that does not add up says so on any report', async () => {
        fetchReport.mockResolvedValue(
            fromServer({ ...CREDIT_NOTES_JSON, check: { rule: 'x', amount: 10, round_off: 0, note_total: 9, difference: 1 } })
        );
        renderWithQuery(<ReportPage entry={reportEntry('creditNotes')!} search={{}} onSearch={() => undefined} />);
        const check = await screen.findByTestId('report-check');
        expect(check.textContent).toContain('reports.gstr1.check.doesNotAddUp');
        // note_total is a column of the register: its label; amount is no column: the screen's words.
        expect(check.querySelector('[data-figure="note_total"]')?.textContent).toBe('Note total₹9.00');
        expect(check.querySelector('[data-figure="amount"]')?.textContent).toBe('reports.check.figures.amount₹10.00');
    });

    it('M2/R2: codes read in the admin\'s words; a cancelled bill\'s lines are struck through', async () => {
        fetchReport.mockResolvedValue(
            fromServer({
                ...SALES_REGISTER_JSON,
                columns: [...(SALES_REGISTER_JSON.columns as object[]), { key: 'cancelled_value', label: 'Cancelled value', label_hi: 'रद्द रकम', type: 'MONEY' }],
                rows: [
                    ...(SALES_REGISTER_JSON.rows as object[]),
                    { invoice_number: 'INV/2627-00003', document_type: 'TAX_INVOICE', channel: 'POS', payment_mode: 'CASH+UPI', status: 'CANCELLED', taxable_value: null, invoice_total: null, cancelled_value: 40.0 },
                    { invoice_number: null, hsn: '5208', status: null, taxable_value: null, cancelled_value: null },
                ],
            })
        );
        renderPage();
        const table = await screen.findByTestId('report-main-table');
        expect(table.textContent).toContain('reports.values.TAX_INVOICE');
        expect(table.textContent).toContain('reports.values.CASH + reports.values.UPI');
        expect(table.textContent).toContain('reports.values.CANCELLED');
        expect(table.textContent).not.toContain('SALE_PAYMENT');
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const struck = (row: Element | undefined) => row?.querySelectorAll('[data-cancelled="true"]').length ?? 0;
        expect(struck(rows[0])).toBe(0);
        expect(struck(rows[2])).toBeGreaterThan(0);
        expect(struck(rows[3])).toBeGreaterThan(0);
        expect(rows[2]?.textContent).toContain('₹40.00');
    });

    it('M5: a COD order the server flags red has the error colour and an icon with words, not colour only', async () => {
        fetchReport.mockResolvedValue(fromServer(COD_OUTSTANDING_JSON));
        renderWithQuery(<ReportPage entry={reportEntry('codOutstanding')!} search={{}} onSearch={() => undefined} />);
        const table = await screen.findByTestId('report-section-outstanding');
        const red = Array.from(table.querySelectorAll('[data-tone="danger"]')).map((c) => c.textContent ?? '');
        expect(red.some((text) => text.includes('ORD-1'))).toBe(true);
        expect(red.some((text) => text.includes('ORD-2'))).toBe(false);
        // One flag per red row, in its first cell, with the sentence for a screen reader (days from the answer).
        const flags = table.querySelectorAll('[data-testid="report-row-flag"]');
        expect(flags).toHaveLength(1);
        expect(flags[0]?.querySelector('.sr-only')?.textContent).toBe('reports.table.redFlag 10');
        expect(flags[0]?.getAttribute('title')).toBe('reports.table.redFlag 10');
    });

    it('a range the server would refuse is not asked for', async () => {
        renderPage({ from: '2026-11-10', to: '2026-11-01' });
        expect(screen.getByTestId('report-range-problem').textContent).toContain('reports.filters.problems.order');
        expect(fetchReport).not.toHaveBeenCalled();
    });
});

describe('ReportPage, GST month reports and learned filters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        features.on = null;
        fetchReport.mockResolvedValue(fromServer({ ...GSTR1_JSON, from: '2026-10-01', to: '2026-10-31' }));
        fetchReportPlaces.mockResolvedValue({ places: [], allPlaces: null });
    });

    it('M1: GSTR-1 opens on the month gone by and says the dates the figures cover', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-05T06:00:00Z'));
        try {
            renderWithQuery(<ReportPage entry={reportEntry('gstr1')!} search={{}} onSearch={() => undefined} />);
            await screen.findByTestId('gstr1-view');
            expect(fetchReport).toHaveBeenCalledWith('gstr1', { from: '2026-10-01', to: '2026-10-31' }, null, undefined);
            expect(screen.getByTestId('report-range').textContent).toBe('reports.page.range 1 Oct 2026 31 Oct 2026');
            expect(screen.queryByTestId('report-month-so-far')).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('M1: the running month, picked on purpose, is marked "month so far"', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-05T06:00:00Z'));
        fetchReport.mockResolvedValue(fromServer({ ...GSTR1_JSON, from: '2026-11-01', to: '2026-11-05' }));
        try {
            renderWithQuery(<ReportPage entry={reportEntry('gstr1')!} search={{ month: '2026-11' }} onSearch={() => undefined} />);
            const note = await screen.findByTestId('report-month-so-far');
            expect(note.textContent).toBe('reports.page.monthSoFar 1 Nov 2026 5 Nov 2026');
        } finally {
            vi.useRealTimers();
        }
    });

    it('M1: the GST pack (file only) shows the month it will hold', () => {
        renderWithQuery(<ReportPage entry={reportEntry('gstPack')!} search={{ month: '2026-09' }} onSearch={() => undefined} />);
        expect(screen.getByTestId('report-range').textContent).toBe('reports.page.range 1 Sept 2026 30 Sept 2026');
    });

    it('M7: GSTINs named by a refused download stay on offer in the GSTIN picker', async () => {
        downloadReport.mockRejectedValue(serverError(400, 'GSTIN_REQUIRED: pick one of 23ABCDE1234F1Z5, 27ABCDE1234F1Z1'));
        renderWithQuery(<ReportPage entry={reportEntry('gstPack')!} search={{}} onSearch={() => undefined} />);
        expect(screen.queryByText('reports.filters.gstin')).toBeNull();
        fireEvent.click(screen.getByTestId('report-download-xlsx'));
        expect(await screen.findByText('reports.filters.gstin')).toBeTruthy();
    });

    it('M7/R9: the GSTINs of the places are offered from the start', async () => {
        fetchReportPlaces.mockResolvedValue({
            places: [
                { id: 'L1', name: 'Test Store', code: null, gstin: '23ABCDE1234F1Z5' },
                { id: 'L2', name: 'Test Depot', code: null, gstin: '27ABCDE1234F1Z1' },
            ],
            allPlaces: true,
        });
        renderWithQuery(<ReportPage entry={reportEntry('gstPack')!} search={{}} onSearch={() => undefined} />);
        expect(await screen.findByText('reports.filters.gstin')).toBeTruthy();
    });

    it('N6: the GSTR-1 sheet comes from the address and a tab click goes to it', async () => {
        const onSearch = vi.fn();
        renderWithQuery(<ReportPage entry={reportEntry('gstr1')!} search={{ month: '2026-10', tab: 'docs' }} onSearch={onSearch} />);
        await screen.findByTestId('gstr1-view');
        expect(screen.getByRole('tab', { selected: true }).textContent).toBe('reports.gstr1.tabs.docs');
        fireEvent.click(screen.getByText('reports.gstr1.tabs.hsn_b2c'));
        expect(onSearch).toHaveBeenCalledWith({ tab: 'hsn_b2c' });
    });

    it('N7: a ROWS_CUT warning names the block by its heading, not its key', async () => {
        fetchReport.mockResolvedValue(
            fromServer({ ...DAY_BOOK_JSON, warnings: [{ code: 'ROWS_CUT', message: 'cut at 5000 rows', ref: 'documents' }] })
        );
        renderWithQuery(<ReportPage entry={reportEntry('dayBook')!} search={{}} onSearch={() => undefined} />);
        const warnings = await screen.findByTestId('report-warnings');
        expect(warnings.textContent).toContain('Documents');
        expect(warnings.textContent).not.toMatch(/(^|[^A-Z])documents/);
    });
});
