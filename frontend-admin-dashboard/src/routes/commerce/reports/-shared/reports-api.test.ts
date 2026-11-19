/**
 * WP-51 contract §7.3: query parameters are built from the filters; downloads
 * send `format` and ask for a blob; the keyset cursor is passed; answers are
 * read with the server's own keys (`ReportDtos`); a refusal sent as a Blob is
 * read back so its code reaches the screen.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn() }));
const saved = vi.hoisted(() => ({ saveBlob: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/save-blob', () => saved);

import { readReportError } from './report-errors';
import { GSTR1_JSON, SALES_REGISTER_JSON } from './report-server-fixtures';
import {
    downloadAudit,
    downloadReport,
    fetchApprovals,
    fetchAudit,
    defaultFileName,
    fetchAuditActors,
    fetchAuditKinds,
    fetchReport,
    fetchReportPlaces,
    normalizeReport,
} from './reports-api';

const lastParams = () => (http.get.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params;

describe('reports api', () => {
    beforeEach(() => {
        http.get.mockReset();
        saved.saveBlob.mockClear();
    });

    it('builds the query from the filters and leaves empty ones out', async () => {
        http.get.mockResolvedValueOnce({ data: { rows: [], columns: [] } });
        await fetchReport('sales-register', {
            from: '2026-11-01',
            to: '2026-11-19',
            locationId: 'L1',
            channel: 'POS',
            sellerGstin: '23ABCDE1234F1Z5',
            groupBy: '',
        });
        expect(http.get.mock.calls[0]?.[0]).toMatch(/\/commerce\/v1\/reports\/sales-register$/);
        expect(lastParams()).toEqual({
            instituteId: 'inst-1',
            from: '2026-11-01',
            to: '2026-11-19',
            locationId: 'L1',
            channel: 'POS',
            sellerGstin: '23ABCDE1234F1Z5',
            format: 'json',
        });
    });

    it('a register passes its page size and the cursor of the next page', async () => {
        http.get.mockResolvedValue({ data: { rows: [], next_cursor: 'c-2' } });
        const first = await fetchReport('day-book', { from: '2026-11-19', to: '2026-11-19' }, null, 100);
        expect(lastParams()).toMatchObject({ size: 100 });
        expect(lastParams().cursor).toBeUndefined();
        expect(first.nextCursor).toBe('c-2');
        await fetchReport('day-book', { from: '2026-11-19', to: '2026-11-19' }, 'c-2', 100);
        expect(lastParams()).toMatchObject({ cursor: 'c-2', size: 100 });
    });

    it('a download sends the format, asks for a blob and saves under the server file name', async () => {
        const blob = new Blob(['x']);
        http.get.mockResolvedValueOnce({
            data: blob,
            headers: { 'content-disposition': 'attachment; filename="sales-register-2026-11-01-2026-11-19.xlsx"' },
        });
        const name = await downloadReport('sales-register', { from: '2026-11-01', to: '2026-11-19' }, 'xlsx');
        const options = http.get.mock.calls[0]?.[1] as { params: Record<string, unknown>; responseType: string };
        expect(options.responseType).toBe('blob');
        expect(options.params).toMatchObject({ format: 'xlsx', from: '2026-11-01', to: '2026-11-19', instituteId: 'inst-1' });
        expect(name).toBe('sales-register-2026-11-01-2026-11-19.xlsx');
        expect(saved.saveBlob).toHaveBeenCalledWith(blob, name);
    });

    it('M3: without a readable server name the file is <report>-<from>-<to>[-<gstin>]; a GST month is its dates', async () => {
        // The browser cannot read Content-Disposition cross-origin unless CORS exposes it: no header here.
        http.get.mockResolvedValue({ data: new Blob(['x']), headers: {} });
        expect(await downloadReport('day-book', { from: '2026-11-19', to: '2026-11-19' }, 'csv')).toBe(
            'day-book-2026-11-19-2026-11-19.csv'
        );
        const gstin = '23ABCDE1234F1Z5';
        expect(await downloadReport('gst-pack', { month: '2026-10', sellerGstin: gstin }, 'xlsx')).toBe(
            `gst-pack-2026-10-01-2026-10-31-${gstin}.xlsx`
        );
        expect(lastParams()).toMatchObject({ month: '2026-10', sellerGstin: gstin, format: 'xlsx' });
        // Two GSTINs of one month never share a name; the running month ends today; dues carry their day.
        expect(defaultFileName('gst-pack', { month: '2026-10', sellerGstin: '27ABCDE1234F1Z1' }, 'xlsx', '2026-11-19')).toBe(
            'gst-pack-2026-10-01-2026-10-31-27ABCDE1234F1Z1.xlsx'
        );
        expect(defaultFileName('gstr1', { month: '2026-11' }, 'xlsx', '2026-11-19')).toBe('gstr1-2026-11-01-2026-11-19.xlsx');
        expect(defaultFileName('customer-dues', {}, 'csv', '2026-11-19')).toBe('customer-dues-2026-11-19.csv');
        expect(defaultFileName('cod-outstanding', { asOf: '2026-11-18' }, 'csv', '2026-11-19')).toBe(
            'cod-outstanding-2026-11-18.csv'
        );
    });

    it('N9: the bill status and the B2C large limit go to the query', async () => {
        http.get.mockResolvedValueOnce({ data: {} });
        await fetchReport('sales-register', { from: '2026-11-01', to: '2026-11-19', status: 'CANCELLED' });
        expect(lastParams()).toMatchObject({ status: 'CANCELLED' });
        http.get.mockResolvedValueOnce({ data: {} });
        await fetchReport('gstr1', { month: '2026-10', b2clLimit: '250000' });
        expect(lastParams()).toMatchObject({ month: '2026-10', b2clLimit: '250000' });
    });

    it('R9: the places a reader may report on, with GSTIN and the all-places word; a bare list is read too', async () => {
        http.get.mockResolvedValueOnce({
            data: {
                places: [
                    { id: 'L1', name: 'Test Store', gstin: '23ABCDE1234F1Z5' },
                    { id: 'L2', name: 'Test Depot', code: 'D2', gstin: null },
                    { name: 'no id' },
                ],
                all_places: false,
            },
        });
        const answer = await fetchReportPlaces();
        expect(http.get.mock.calls.at(-1)?.[0]).toMatch(/\/commerce\/v1\/reports\/places$/);
        expect(lastParams()).toEqual({ instituteId: 'inst-1' });
        expect(answer).toEqual({
            places: [
                { id: 'L1', name: 'Test Store', code: null, gstin: '23ABCDE1234F1Z5' },
                { id: 'L2', name: 'Test Depot', code: 'D2', gstin: null },
            ],
            allPlaces: false,
        });
        http.get.mockResolvedValueOnce({ data: [{ id: 'L1', name: 'Test Store' }] });
        expect(await fetchReportPlaces()).toMatchObject({ places: [{ id: 'L1' }], allPlaces: null });
    });

    it('R9: the people seen in the audit scope, {actors} or a list; a missing name shows the id', async () => {
        http.get.mockResolvedValueOnce({ data: { actors: [{ user_id: 'u-1', name: 'Test Manager' }, { user_id: 'u-2' }, {}] } });
        expect(await fetchAuditActors()).toEqual([
            { userId: 'u-1', name: 'Test Manager' },
            { userId: 'u-2', name: 'u-2' },
        ]);
        expect(http.get.mock.calls.at(-1)?.[0]).toMatch(/\/commerce\/v1\/reports\/audit\/actors$/);
        http.get.mockResolvedValueOnce({ data: [{ user_id: 'u-3', name: 'Test Cashier' }] });
        expect(await fetchAuditActors()).toEqual([{ userId: 'u-3', name: 'Test Cashier' }]);
    });

    it('a refused download (Blob body) reads as REPORT_BUSY', async () => {
        const body = new Blob([JSON.stringify({ message: 'REPORT_BUSY: another export is running; try again in a minute' })]);
        const error = new AxiosError('busy', '429', undefined, undefined, {
            status: 429,
            data: body,
            headers: {},
            statusText: 'x',
            config: {},
        } as unknown as AxiosResponse);
        http.get.mockRejectedValueOnce(error);
        const failure = await downloadReport('sales', { from: '2026-11-01', to: '2026-11-19' }, 'csv').catch((e) => e);
        expect(readReportError(failure).key).toBe('reports.errors.REPORT_BUSY');
        expect(saved.saveBlob).not.toHaveBeenCalled();
    });

    it('reads the server answer frame: label / label_hi, section labels, check.columns, the warning fold', () => {
        const answer = normalizeReport(GSTR1_JSON);
        const b2b = answer.sections.find((s) => s.key === 'b2b');
        expect(answer.sections.map((s) => s.key)).toEqual([
            'b2b',
            'b2cl',
            'b2cs',
            'b2cs_credit_notes',
            'cdnr',
            'cdnur',
            'exemp',
            'hsn_b2b',
            'hsn_b2c',
            'docs',
            'docs_bill_books',
        ]);
        expect(b2b).toMatchObject({ labelEn: 'B2B', labelHi: 'B2B' });
        expect(b2b?.columns.find((c) => c.key === 'taxable_value')).toEqual({
            key: 'taxable_value',
            labelEn: 'Taxable Value',
            labelHi: 'कर योग्य मूल्य',
            type: 'MONEY',
        });
        expect(b2b?.totals).toMatchObject({ documents: 1, documents_value: 105 });
        expect(answer.check?.rule).toContain('b2b + b2cl');
        expect(answer.check?.columns.map((c) => c.key)).toEqual(['taxable_value', 'cgst', 'sgst', 'igst', 'cess']);
        expect(answer.check?.difference).toBe(0);
        expect(answer.asOf).toBe('2026-11-19T14:00:00+05:30');

        const register = normalizeReport(SALES_REGISTER_JSON);
        expect(register.nextCursor).toBe('c-2');
        expect(register.warnings.map((w) => [w.ref, w.more])).toEqual([
            ['INV/2627-00001', null],
            ['INV/2627-00002', null],
            [null, 3],
        ]);
        // A non-GSTR-1 check is a flat map: no lines, its figures in the server's order (M8).
        expect(register.check).toMatchObject({ rule: expect.any(String), difference: 0, columns: [] });
        expect(register.check?.figures).toEqual([
            ['taxable_value', 999.99],
            ['tax', 50],
            ['round_off', -0.15],
            ['invoice_total', 1049.99],
        ]);
        expect(answer.check?.figures).toEqual([]);
        expect(normalizeReport(null, 'sales')).toMatchObject({ report: 'sales', rows: [], sections: [], warnings: [] });
    });

    it('names the screen used to guess are not read: label_en, title, check.lines, positional rows', () => {
        const answer = normalizeReport({
            columns: [{ key: 'rate', type: 'DATETIME', label_en: 'Rate' }],
            rows: [[5]],
            sections: { b2b: { title: 'B2B', rows: [{ rate: 5 }] } },
            check: { difference: 1, lines: [{ key: 'taxable', difference: 1 }] },
        });
        expect(answer.columns[0]).toEqual({ key: 'rate', labelEn: null, labelHi: null, type: 'TEXT' });
        expect(answer.rows).toEqual([]);
        expect(answer.sections).toEqual([]);
        expect(answer.check?.columns).toEqual([]);
    });

    it('audit filters go to the query; approvals take dates and the document number only', async () => {
        http.get.mockResolvedValue({
            data: {
                rows: [
                    {
                        id: 'a-1',
                        created_at: '2026-11-19T05:00:00Z',
                        actor_user_id: 'u-1',
                        actor_name: 'Test Manager',
                        kind: 'VARIANT_PRICE_CHANGED',
                        reference_label: 'BOTTLE-1',
                        changes: [{ key: 'price', old: 120, new: 130 }],
                    },
                ],
                next_cursor: 'n',
            },
        });
        const filters = { from: '2026-11-01', to: '2026-11-19', actorUserId: 'u-1', locationId: 'L1', kind: 'POS_VOID', reference: ' INV-9 ' };
        const page = await fetchAudit(filters, 'c');
        expect(lastParams()).toEqual({ instituteId: 'inst-1', ...filters, reference: 'INV-9', cursor: 'c', size: 50 });
        expect(page.rows[0]).toMatchObject({ id: 'a-1', actorName: 'Test Manager', changes: [{ key: 'price', old: 120, new: 130 }] });
        await fetchApprovals(filters);
        expect(http.get.mock.calls.at(-1)?.[0]).toMatch(/\/audit\/approvals$/);
        expect(lastParams()).toEqual({ instituteId: 'inst-1', from: '2026-11-01', to: '2026-11-19', reference: 'INV-9', size: 50 });
    });

    it('kinds come back sorted; the audit CSV asks for format csv as a blob', async () => {
        http.get.mockResolvedValueOnce({ data: { kinds: ['POS_VOID', 'INVOICE_CANCELLED'] } });
        expect(await fetchAuditKinds()).toEqual(['INVOICE_CANCELLED', 'POS_VOID']);
        http.get.mockResolvedValueOnce({ data: new Blob(['x']), headers: {} });
        expect(await downloadAudit({ from: '2026-11-01', to: '2026-11-19' })).toBe('audit-2026-11-01-2026-11-19.csv');
        expect(http.get.mock.calls.at(-1)?.[1]).toMatchObject({ responseType: 'blob', params: { format: 'csv' } });
    });
});
