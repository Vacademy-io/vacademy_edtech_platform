/**
 * WP-51 contract §7.3 on the server's cell types: QTY a number, TIME India
 * wall text printed as sent, `*_text` columns in place of the raw ones,
 * totals typed by column; the India date of 2026-10-31T18:30:00Z (as_of) is
 * 1 November. Also the range rules and defaults of the report page (§3.1) and
 * the error map (§6.3).
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { reportEntry } from './report-catalogue';
import { readReportError, REPORT_ERROR_CODES, retryAfterMs } from './report-errors';
import {
    addDays,
    cellText,
    formatIndiaDate,
    formatIndiaTime,
    formatQuantityCell,
    formatWallTime,
    indiaDay,
    indiaToday,
    isZeroFigure,
    monthRange,
} from './report-format';
import { cancelledRows, codeText, columnLabel, screenColumns, totalType } from './report-columns';
import type { ReportColumn } from './report-types';
import { rangeProblem, resolvedMonth, resolveReportFilters, validateReportsSearch } from './report-search';

/** `t` that shows the key it was asked for. */
const keyT = ((key: string) => key) as unknown as Parameters<typeof codeText>[2];


const serverError = (status: number, message: string) =>
    new AxiosError(message, String(status), undefined, undefined, {
        status,
        data: { message },
        headers: {},
        statusText: 'x',
        config: {},
    } as unknown as AxiosResponse);

describe('report cells', () => {
    it('a QTY cell is the server number in display units; the unit is in the *_text column', () => {
        expect(formatQuantityCell(5.9)).toBe('5.9');
        expect(formatQuantityCell('4.7')).toBe('4.7');
        expect(cellText('QTY', 1.3)).toBe('1.3');
        expect(cellText('TEXT', '5.9 m')).toBe('5.9 m');
        expect(cellText('TEXT', '₹123.40 / m')).toBe('₹123.40 / m');
    });

    it('a TIME cell is India wall text printed as it is: never shifted by 5:30', () => {
        expect(formatWallTime('2026-11-19 10:30')).toBe('19 Nov 2026, 10:30');
        expect(cellText('TIME', '2026-11-19 23:59')).toBe('19 Nov 2026, 23:59');
        expect(cellText('TIME', '2026-11-19 00:05')).toBe('19 Nov 2026, 00:05');
        // A date-only event: the server's "—" as sent.
        expect(cellText('TIME', '—')).toBe('—');
    });

    it('a *_text column hides its raw companion; labels are label / label_hi', () => {
        const c = (key: string, type: ReportColumn['type'], labelEn: string, labelHi: string | null = null): ReportColumn => ({
            key,
            type,
            labelEn,
            labelHi,
        });
        const shown = screenColumns([
            c('rate', 'PERCENT', 'Rate %'),
            c('quantity', 'QTY', 'Quantity'),
            c('quantity_text', 'TEXT', 'Quantity with unit'),
            c('rate_per_unit', 'MONEY', 'Rate per unit'),
            c('rate_text', 'TEXT', 'Rate per unit (as printed)'),
            c('net_units', 'QTY', 'Net units'),
            c('net_text', 'TEXT', 'Net (with unit)'),
            c('average_rate', 'MONEY', 'Average rate per unit'),
            c('average_rate_text', 'TEXT', 'Average rate'),
        ]).map((col) => col.key);
        expect(shown).toEqual(['rate', 'quantity_text', 'rate_text', 'net_text', 'average_rate_text']);
        expect(columnLabel(c('due', 'MONEY', 'Due', 'बकाया'), 'hi')).toBe('बकाया');
        expect(columnLabel(c('due', 'MONEY', 'Due', 'बकाया'), 'en')).toBe('Due');
        expect(columnLabel(c('due', 'MONEY', 'Due'), 'hi')).toBe('Due');
    });

    it('a total is typed by its column; a key that is no column is a count unless the server names it as money', () => {
        const own: ReportColumn[] = [{ key: 'orders', type: 'INT', labelEn: 'Orders', labelHi: null }];
        const all: ReportColumn[] = [{ key: 'net', type: 'MONEY', labelEn: 'Net received', labelHi: null }];
        expect(totalType('orders', own, all)).toBe('INT');
        expect(totalType('net', own, all)).toBe('MONEY');
        ['credit_notes', 'closed_sessions', 'open_sessions', 'red_flag_orders', 'remittances', 'sessions', 'products', 'count', 'outstanding_count'].forEach(
            (key) => expect(totalType(key, own)).toBe('INT')
        );
        ['documents_value', 'documents_total', 'cash_at_tills', 'cancelled_total', 'outstanding_amount', 'net_money'].forEach((key) =>
            expect(totalType(key, own)).toBe('MONEY')
        );
    });

    it('the India date of 2026-10-31T18:30:00Z is 1 November', () => {
        expect(indiaDay('2026-10-31T18:30:00Z')).toBe('2026-11-01');
        expect(indiaDay('2026-10-31T18:29:59Z')).toBe('2026-10-31');
        // A stored timestamp without an offset is UTC (contract §3.1).
        expect(indiaDay('2026-10-31T18:31:00')).toBe('2026-11-01');
        expect(formatIndiaDate('2026-10-31T18:30:00Z')).toMatch(/^1 Nov 2026$/);
        expect(formatIndiaTime('2026-10-31T18:31:00Z')).toBe('00:01');
        // A date-only value is already an India date: never shifted.
        expect(formatIndiaDate('2026-11-01')).toBe('1 Nov 2026');
        expect(formatIndiaTime('2026-11-01')).toBe('—');
        expect(indiaToday(new Date('2026-11-19T20:00:00Z'))).toBe('2026-11-20');
    });

    it('a zero figure is compared, never added', () => {
        expect(isZeroFigure('0.00')).toBe(true);
        expect(isZeroFigure(-0)).toBe(true);
        expect(isZeroFigure('0.01')).toBe(false);
        expect(isZeroFigure(null)).toBe(false);
    });
});

describe('report page filters', () => {
    const today = '2026-11-19';

    it('defaults: this month; day book today; GST month to today; COD as of today', () => {
        expect(resolveReportFilters(reportEntry('salesRegister')!, {}, today)).toEqual({ from: '2026-11-01', to: today });
        expect(resolveReportFilters(reportEntry('dayBook')!, {}, today)).toEqual({ from: today, to: today });
        expect(resolveReportFilters(reportEntry('gstr1')!, { month: '2026-10' }, today)).toEqual({
            from: '2026-10-01',
            to: '2026-10-31',
        });
        expect(resolveReportFilters(reportEntry('gstPack')!, { month: '2026-10', gstin: '23ABCDE1234F1Z5' }, today)).toEqual({
            month: '2026-10',
            sellerGstin: '23ABCDE1234F1Z5',
        });
        expect(resolveReportFilters(reportEntry('codOutstanding')!, {}, today).asOf).toBe(today);
        expect(resolveReportFilters(reportEntry('customerDues')!, { from: '2026-01-01', location: 'L2' }, today)).toEqual({
            locationId: 'L2',
        });
        expect(resolveReportFilters(reportEntry('sales')!, { groupBy: 'staff' }, today).groupBy).toBe('staff');
        expect(resolveReportFilters(reportEntry('sales')!, { groupBy: 'nonsense' }, today).groupBy).toBe('day');
    });

    it('range rules: order, at most 366 days (day book 31), nothing after today', () => {
        const register = reportEntry('salesRegister')!;
        expect(rangeProblem(register, { from: '2026-11-10', to: '2026-11-01' }, today)).toBe('order');
        // 367 days refused, 366 taken (contract §3.1, ReportRangeTest).
        expect(rangeProblem(register, { from: '2025-11-18', to: today }, today)).toBe('tooLong');
        expect(rangeProblem(register, { from: '2025-11-19', to: today }, today)).toBeNull();
        expect(rangeProblem(register, { from: '2026-11-01', to: '2026-11-20' }, today)).toBe('future');
        expect(rangeProblem(reportEntry('dayBook')!, { from: '2026-10-19', to: today }, today)).toBe('tooLong');
        expect(rangeProblem(reportEntry('dayBook')!, { from: '2026-10-20', to: today }, today)).toBeNull();
        expect(rangeProblem(reportEntry('gstPack')!, { month: '2026-12' }, today)).toBe('futureMonth');
        expect(monthRange('2026-11', today)).toEqual({ from: '2026-11-01', to: today });
        expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('the address keeps known values only', () => {
        expect(
            validateReportsSearch({ report: 'gstr1', month: '2026-13', channel: 'pos', gstin: '23abcde1234f1z5', from: 'x' })
        ).toEqual({
            report: 'gstr1',
            from: undefined,
            to: undefined,
            location: undefined,
            channel: 'POS',
            gstin: '23ABCDE1234F1Z5',
            month: undefined,
            groupBy: undefined,
            asOf: undefined,
            status: undefined,
            b2clLimit: undefined,
            tab: undefined,
        });
        expect(validateReportsSearch({ report: 'unknown' }).report).toBeUndefined();
        expect(validateReportsSearch({ status: 'cancelled', tab: 'docs', b2clLimit: '250000' })).toMatchObject({
            status: 'CANCELLED',
            tab: 'docs',
            b2clLimit: '250000',
        });
        expect(validateReportsSearch({ status: 'nope', tab: 'nope' })).toMatchObject({ status: undefined, tab: undefined });
    });

    it('M1: GSTR-1 and the GST pack open on the month gone by, not the running one', () => {
        expect(resolvedMonth({}, today)).toBe('2026-10');
        expect(resolvedMonth({}, '2027-01-05')).toBe('2026-12');
        expect(resolvedMonth({ month: '2026-11' }, today)).toBe('2026-11');
        expect(resolveReportFilters(reportEntry('gstr1')!, {}, today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
        expect(resolveReportFilters(reportEntry('gstPack')!, {}, today)).toEqual({ month: '2026-10' });
    });

    it('N9: the sales register sends the bill status, GSTR-1 and the pack the B2C large limit', () => {
        expect(resolveReportFilters(reportEntry('salesRegister')!, { status: 'CANCELLED' }, today).status).toBe('CANCELLED');
        expect(resolveReportFilters(reportEntry('gstr1')!, { b2clLimit: '250000' }, today).b2clLimit).toBe('250000');
        expect(resolveReportFilters(reportEntry('gstPack')!, { b2clLimit: '250000' }, today).b2clLimit).toBe('250000');
        // Reports that do not take them never send them.
        expect(resolveReportFilters(reportEntry('sales')!, { status: 'CANCELLED', b2clLimit: '1' }, today)).not.toHaveProperty('status');
    });

    it('R5: a B2C large limit outside 1..1,00,00,000 or with 3 decimals, and dates over 3 years back, are not asked for', () => {
        const gstr1 = reportEntry('gstr1')!;
        expect(rangeProblem(gstr1, { from: '2026-10-01', to: '2026-10-31', b2clLimit: '250000' }, today)).toBeNull();
        expect(rangeProblem(gstr1, { from: '2026-10-01', to: '2026-10-31', b2clLimit: '250000.25' }, today)).toBeNull();
        ['0', '0.5', '10000000.01', '250000.255', '-5', '2,50,000', 'abc', '1e6'].forEach((limit) =>
            expect(rangeProblem(gstr1, { from: '2026-10-01', to: '2026-10-31', b2clLimit: limit }, today), limit).toBe('b2clLimit')
        );
        expect(rangeProblem(gstr1, { b2clLimit: '10000000' }, today)).toBeNull();
        const register = reportEntry('salesRegister')!;
        expect(rangeProblem(register, { from: '2023-11-18', to: '2023-12-01' }, today)).toBe('tooOld');
        expect(rangeProblem(register, { from: '2023-11-19', to: '2023-12-01' }, today)).toBeNull();
        expect(rangeProblem(reportEntry('gstPack')!, { month: '2023-10' }, today)).toBe('tooOld');
        expect(rangeProblem(reportEntry('codOutstanding')!, { asOf: '2023-01-01' }, today)).toBe('tooOld');
    });
});

describe('report screen words (reports fix round)', () => {
    it('M2: codes in the admin\'s words; CASH+UPI part by part; a sales month by name; unknown codes as sent', () => {
        expect(codeText('type', 'SALE_PAYMENT', keyT)).toBe('reports.values.SALE_PAYMENT');
        expect(codeText('status', 'ACTIVE', keyT)).toBe('reports.values.ACTIVE');
        expect(codeText('channel', 'POS', keyT)).toBe('reports.values.POS');
        expect(codeText('document_type', 'TAX_INVOICE', keyT)).toBe('reports.values.TAX_INVOICE');
        expect(codeText('payment_method', 'COD', keyT)).toBe('reports.values.COD');
        expect(codeText('payment_mode', 'CASH+UPI', keyT)).toBe('reports.values.CASH + reports.values.UPI');
        expect(codeText('month', '2026-11', keyT)).toBe('November 2026');
        // The GST offline tool's own codes stay as they are; other columns are not touched.
        expect(codeText('type', 'OE', keyT)).toBeNull();
        expect(codeText('payment_mode', 'CASH+BARTER', keyT)).toBeNull();
        expect(codeText('customer', 'ACTIVE', keyT)).toBeNull();
    });

    it('N3: beside a date column the time cell is the clock only', () => {
        expect(formatWallTime('2026-11-19 10:30', true)).toBe('10:30');
        expect(cellText('TIME', '2026-11-19 10:30', true)).toBe('10:30');
        expect(cellText('TIME', '—', true)).toBe('—');
    });

    it('N4: the unit column is hidden when a quantity text carries the unit', () => {
        const c = (key: string, type: ReportColumn['type']): ReportColumn => ({ key, type, labelEn: key, labelHi: null });
        expect(
            screenColumns([c('quantity', 'QTY'), c('unit', 'TEXT'), c('quantity_text', 'TEXT')]).map((col) => col.key)
        ).toEqual(['quantity_text']);
        // No quantity text (never-sold list, HSN with its UQC): the unit stays.
        expect(screenColumns([c('product', 'TEXT'), c('unit', 'TEXT')]).map((col) => col.key)).toEqual(['product', 'unit']);
    });

    it('R2: the lines of a cancelled bill are marked, its further lines too; the next bill is not', () => {
        expect(
            cancelledRows([
                { invoice_number: 'INV-1', status: 'CANCELLED' },
                { invoice_number: null, status: null },
                { invoice_number: 'INV-2', status: 'ACTIVE' },
                { invoice_number: null, status: null },
                { number: 'B-3', status: 'VOID' },
                { number: 'B-4' },
            ])
        ).toEqual([true, true, false, false, true, false]);
    });

    it('R2/R8: cancelled_value is money; distinct_invoices is a count', () => {
        expect(totalType('cancelled_value', [])).toBe('MONEY');
        expect(totalType('distinct_invoices', [])).toBe('INT');
    });
});

describe('report errors (contract §6.3)', () => {
    it.each(REPORT_ERROR_CODES.filter((c) => c !== 'ROLE_NOT_ALLOWED' && c !== 'LOCATION_NOT_ALLOWED'))(
        '%s maps to its sentence',
        (code) => {
            expect(readReportError(serverError(400, `${code}: something`)).key).toBe(`reports.errors.${code}`);
        }
    );

    it('REPORT_BUSY (429) reads "another download is running"; it is not tried again on its own', () => {
        const read = readReportError(serverError(429, 'REPORT_BUSY: another export is running; try again in a minute'));
        expect(read.key).toBe('reports.errors.REPORT_BUSY');
        expect(read.busy).toBe(false);
    });

    it('R6: REPORTS_BUSY (429, screen reads) and a bare 429 are "busy": many reports are being read', () => {
        const read = readReportError(serverError(429, 'REPORTS_BUSY: too many reports at once; try again shortly'));
        expect(read.key).toBe('reports.errors.REPORTS_BUSY');
        expect(read.busy).toBe(true);
        expect(read.retryable).toBe(true);
        expect(readReportError(serverError(429, '')).key).toBe('reports.errors.REPORTS_BUSY');
    });

    it('R6: the wait before trying again is the server Retry-After (seconds), else 3 s, at most 30 s', () => {
        const withWait = (value: unknown) => {
            const error = serverError(429, 'REPORTS_BUSY: x');
            (error.response as { headers: Record<string, unknown> }).headers = { 'retry-after': value };
            return error;
        };
        expect(retryAfterMs(withWait('2'))).toBe(2000);
        expect(retryAfterMs(withWait(0))).toBe(0);
        expect(retryAfterMs(withWait('600'))).toBe(30000);
        expect(retryAfterMs(withWait('soon'))).toBe(3000);
        expect(retryAfterMs(serverError(429, ''))).toBe(3000);
    });

    it('N5: a refusal a second try cannot mend offers no Retry', () => {
        expect(readReportError(serverError(403, 'FEATURE_DISABLED: x')).retryable).toBe(false);
        expect(readReportError(serverError(400, 'VALIDATION: x')).retryable).toBe(false);
        expect(readReportError(serverError(400, 'EXPORT_TOO_LARGE: x')).retryable).toBe(false);
        expect(readReportError(serverError(503, 'REPORT_TIMEOUT: x')).retryable).toBe(true);
    });

    it('any 403 is "no access at this location"; FEATURE_DISABLED keeps its own sentence', () => {
        expect(readReportError(serverError(403, 'LOCATION_NOT_ALLOWED: L1')).key).toBe('reports.errors.noAccess');
        expect(readReportError(serverError(403, 'ROLE_NOT_ALLOWED: x')).noAccess).toBe(true);
        expect(readReportError(serverError(403, '')).key).toBe('reports.errors.noAccess');
        expect(readReportError(serverError(403, 'FEATURE_DISABLED: x')).key).toBe('reports.errors.FEATURE_DISABLED');
    });

    it('GSTIN_REQUIRED lists the GSTINs for the picker', () => {
        const read = readReportError(
            serverError(400, 'GSTIN_REQUIRED: pick one of 23ABCDE1234F1Z5, 27ABCDE1234F1Z1')
        );
        expect(read.gstins).toEqual(['23ABCDE1234F1Z5', '27ABCDE1234F1Z1']);
    });

    it('R5/N7: a VALIDATION the screen can word is said in its own words, without the server English', () => {
        const cases: [string, string][] = [
            ['VALIDATION: b2clLimit must be an amount in rupees', 'b2clLimit'],
            ['VALIDATION: size must be 1 to 200', 'size'],
            ['VALIDATION: the cursor is not valid', 'cursor'],
            ['VALIDATION: from is more than 3 years back', 'tooOld'],
            ['VALIDATION: to is after today', 'future'],
            ['VALIDATION: range is more than 366 days', 'tooLong'],
            ['VALIDATION: the range is at most 31 days', 'tooLong'],
            ['VALIDATION: month must be YYYY-MM', 'month'],
            ['VALIDATION: status must be ACTIVE, CANCELLED or ALL', 'status'],
        ];
        cases.forEach(([sentence, reason]) => {
            const read = readReportError(serverError(400, sentence));
            expect(read.key, sentence).toBe(`reports.errors.validation.${reason}`);
            expect(read.showServerSentence, sentence).toBe(false);
        });
    });

    it('a VALIDATION the screen cannot word keeps the server sentence under ours; no answer is the network sentence', () => {
        const read = readReportError(serverError(400, 'VALIDATION: something new'));
        expect(read.key).toBe('reports.errors.VALIDATION');
        expect(read.showServerSentence).toBe(true);
        expect(read.message).toBe('something new');
        expect(readReportError(new AxiosError('Network Error', 'ERR_NETWORK')).key).toBe('reports.errors.network');
    });
});
