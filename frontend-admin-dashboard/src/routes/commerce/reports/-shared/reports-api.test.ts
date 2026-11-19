/**
 * WP-51 contract §7.3: query parameters are built from the filters; downloads
 * send `format` and ask for a blob; the keyset cursor is passed; answers are
 * normalised (sections as a map or a list); a refusal sent as a Blob is read
 * back so its code reaches the screen.
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn() }));
const saved = vi.hoisted(() => ({ saveBlob: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/axiosInstance', () => ({ default: http }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/save-blob', () => saved);

import { readReportError } from './report-errors';
import {
    downloadAudit,
    downloadReport,
    fetchApprovals,
    fetchAudit,
    fetchAuditKinds,
    fetchReport,
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

    it('without a server name the file is <report>-<from>-<to>.csv, the GST pack <report>-<month>.xlsx', async () => {
        http.get.mockResolvedValue({ data: new Blob(['x']), headers: {} });
        expect(await downloadReport('day-book', { from: '2026-11-19', to: '2026-11-19' }, 'csv')).toBe(
            'day-book-2026-11-19-2026-11-19.csv'
        );
        expect(await downloadReport('gst-pack', { month: '2026-10', sellerGstin: 'G' }, 'xlsx')).toBe('gst-pack-2026-10.xlsx');
        expect(lastParams()).toMatchObject({ month: '2026-10', sellerGstin: 'G', format: 'xlsx' });
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

    it('normalises columns, positional rows, sections as a map, the check and warnings', () => {
        const answer = normalizeReport({
            report: 'gstr1',
            columns: [{ key: 'rate', type: 'percent', label_en: 'Rate', label_hi: 'दर' }, { key: 'taxable', type: 'MONEY' }],
            rows: [[5, '100.00']],
            totals: { taxable: '100.00' },
            sections: { b2b: { rows: [{ rate: 5, taxable: 10 }] } },
            check: { difference: '0.00', taxable: { sections: '10.00', documents: '10.00', difference: '0.00' } },
            warnings: [{ code: 'HSN_MISSING', message: 'x', ref: 'INV-1' }, 'QTY_ROUNDED'],
            next_cursor: 7,
            as_of: '2026-11-19T10:00:00Z',
        });
        expect(answer.columns.map((c) => c.type)).toEqual(['PERCENT', 'MONEY']);
        expect(answer.rows).toEqual([{ rate: 5, taxable: '100.00' }]);
        expect(answer.sections[0]).toMatchObject({ key: 'b2b', rows: [{ rate: 5, taxable: 10 }] });
        expect(answer.sections[0]?.columns).toHaveLength(2);
        expect(answer.check).toEqual({
            difference: '0.00',
            lines: [{ key: 'taxable', sections: '10.00', documents: '10.00', difference: '0.00' }],
        });
        expect(answer.warnings.map((w) => w.code)).toEqual(['HSN_MISSING', 'QTY_ROUNDED']);
        expect(answer.nextCursor).toBe('7');
        expect(normalizeReport(null, 'sales')).toMatchObject({ report: 'sales', rows: [], sections: [], warnings: [] });
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
