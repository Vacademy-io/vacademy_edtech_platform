/**
 * WP-51 contract §7.3: "2.5 m"; "₹123.40 / m"; the India date of
 * 2026-10-31T18:30:00Z is 1 November; place of supply "23-…". Also the range
 * rules and defaults of the report page (§3.1) and the error map (§6.3).
 */
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { reportEntry } from './report-catalogue';
import { readReportError, REPORT_ERROR_CODES } from './report-errors';
import {
    addDays,
    cellText,
    formatIndiaDate,
    formatIndiaTime,
    formatQuantityCell,
    formatRateCell,
    indiaDay,
    indiaToday,
    isZeroFigure,
    monthRange,
    placeOfSupplyText,
} from './report-format';
import { rangeProblem, resolveReportFilters, validateReportsSearch } from './report-search';

const t = ((key: string) => (key === 'states.23' ? 'Test State' : key === 'orders.units.metre' ? 'm' : key)) as never;

const serverError = (status: number, message: string) =>
    new AxiosError(message, String(status), undefined, undefined, {
        status,
        data: { message },
        headers: {},
        statusText: 'x',
        config: {},
    } as unknown as AxiosResponse);

describe('report cells', () => {
    it('a measured quantity reads in display units: "2.5 m"', () => {
        expect(formatQuantityCell({ base: 25, qty_scale: 10, unit: 'MTR' })).toBe('2.5 m');
        expect(formatQuantityCell({ base: 59, qty_scale: 10, unit: 'MTR' }, t)).toBe('5.9 m');
        expect(formatQuantityCell('1.2 m')).toBe('1.2 m');
        expect(formatQuantityCell({ base: 12, qty_scale: 1, unit: 'PCS' })).toBe('12');
        expect(cellText('QTY', { base: 25, qty_scale: 10, unit: 'MTR' })).toBe('2.5 m');
    });

    it('a rate per display unit reads "₹123.40 / m"', () => {
        expect(formatRateCell({ unit_price: 12.34, qty_scale: 10, unit: 'MTR' })).toBe('₹123.40 / m');
        expect(formatRateCell({ amount: 123.4, unit: 'MTR' })).toBe('₹123.40 / m');
        expect(formatRateCell('₹123.40 / m')).toBe('₹123.40 / m');
        expect(formatRateCell({ amount: 45, unit: 'PCS' })).toBe('₹45.00');
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

    it('place of supply reads "23-Test State"', () => {
        expect(placeOfSupplyText('23', t)).toBe('23-Test State');
        expect(placeOfSupplyText(23, t)).toBe('23-Test State');
        expect(placeOfSupplyText('23-Test State', t)).toBe('23-Test State');
        expect(cellText('STATE', '23', t)).toMatch(/^23-/);
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
        });
        expect(validateReportsSearch({ report: 'unknown' }).report).toBeUndefined();
    });
});

describe('report errors (contract §6.3)', () => {
    it.each(REPORT_ERROR_CODES.filter((c) => c !== 'ROLE_NOT_ALLOWED' && c !== 'LOCATION_NOT_ALLOWED'))(
        '%s maps to its sentence',
        (code) => {
            expect(readReportError(serverError(400, `${code}: something`)).key).toBe(`reports.errors.${code}`);
        }
    );

    it('REPORT_BUSY (429) reads "another download is running"', () => {
        const read = readReportError(serverError(429, 'REPORT_BUSY: another export is running; try again in a minute'));
        expect(read.key).toBe('reports.errors.REPORT_BUSY');
        expect(readReportError(serverError(429, '')).key).toBe('reports.errors.REPORT_BUSY');
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

    it('VALIDATION shows the server sentence under ours; no answer is the network sentence', () => {
        const read = readReportError(serverError(400, 'VALIDATION: range is more than 366 days'));
        expect(read.showServerSentence).toBe(true);
        expect(read.message).toBe('range is more than 366 days');
        expect(readReportError(new AxiosError('Network Error', 'ERR_NETWORK')).key).toBe('reports.errors.network');
    });
});
