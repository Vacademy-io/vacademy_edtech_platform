import { type PosTenderMode, REFERENCE_REQUIRED_MODES, type TenderRequest } from './pos-types';

/**
 * Tender maths of the Pay dialog (contract §7.5), pure. Every sum is done in
 * paise (integers) so 0.1 + 0.2 is 0.30 and never 0.30000000000000004. The
 * screen never computes tax: `total` is the server's quote.
 *
 * An exchange credit counts first (it is applied before any tender), up to the
 * bill's total.
 */

export interface TenderRow {
    key: string;
    mode: PosTenderMode;
    /** As typed, in rupees. */
    amount: string;
    reference: string;
    /** CASH only: what the buyer handed over, as typed. Empty = exact. */
    cashTendered: string;
}

/** Rupees (number or typed text) to paise; NaN for text that is not an amount. */
export function toPaise(value: number | string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const text = typeof value === 'number' ? String(value) : value.trim().replace(/,/g, '');
    if (text === '') return 0;
    if (!/^-?\d+(\.\d{0,2})?$/.test(text) && typeof value !== 'number') return Number.NaN;
    return Math.round(Number(text) * 100);
}

export const fromPaise = (paise: number): number => paise / 100;

/** The credit actually used on this bill: never more than the total. */
export const creditApplied = (total: number, credit: number): number =>
    fromPaise(Math.min(Math.max(0, toPaise(credit)), Math.max(0, toPaise(total))));

const sumPaise = (rows: TenderRow[]): number =>
    rows.reduce((sum, row) => {
        const p = toPaise(row.amount);
        return Number.isFinite(p) ? sum + p : sum;
    }, 0);

/** What is still to pay after the credit and the tenders (negative = paid too much). */
export function remaining(total: number, credit: number, rows: TenderRow[]): number {
    const due = toPaise(total) - toPaise(creditApplied(total, credit));
    return fromPaise(due - sumPaise(rows));
}

/** Change to hand back: cash received minus the cash tender's amount, never below 0. */
export function change(rows: TenderRow[]): number {
    const cash = rows.find((row) => row.mode === 'CASH');
    if (!cash || cash.cashTendered.trim() === '') return 0;
    const given = toPaise(cash.cashTendered);
    const amount = toPaise(cash.amount);
    if (!Number.isFinite(given) || !Number.isFinite(amount)) return 0;
    return fromPaise(Math.max(0, given - amount));
}

export type TenderProblem =
    | 'amount'
    | 'reference'
    | 'cashShort'
    | 'twoCash'
    | 'short'
    | 'over'
    | 'tooMany';

export const TENDER_PROBLEMS: readonly TenderProblem[] = [
    'amount',
    'reference',
    'cashShort',
    'twoCash',
    'short',
    'over',
    'tooMany',
];

export const MAX_TENDERS = 10;

/** The first thing stopping payment, or null when Confirm may be pressed. */
export function tenderProblem(total: number, credit: number, rows: TenderRow[]): TenderProblem | null {
    if (rows.length > MAX_TENDERS) return 'tooMany';
    if (rows.filter((row) => row.mode === 'CASH').length > 1) return 'twoCash';
    for (const row of rows) {
        const p = toPaise(row.amount);
        if (!Number.isFinite(p) || p <= 0) return 'amount';
        if (REFERENCE_REQUIRED_MODES.has(row.mode) && row.reference.trim() === '') return 'reference';
        if (row.mode === 'CASH' && row.cashTendered.trim() !== '') {
            const given = toPaise(row.cashTendered);
            if (!Number.isFinite(given) || given < p) return 'cashShort';
        }
    }
    const rest = toPaise(remaining(total, credit, rows));
    if (rest > 0) return 'short';
    if (rest < 0) return 'over';
    return null;
}

export const canPay = (total: number, credit: number, rows: TenderRow[]): boolean =>
    tenderProblem(total, credit, rows) === null;

const two = (paise: number): string => (paise / 100).toFixed(2);

/** The rows as the sale body sends them: strings with 2 decimals. */
export function toTenderRequest(rows: TenderRow[]): TenderRequest[] {
    return rows.map((row) => {
        const amount = toPaise(row.amount);
        const reference = row.reference.trim();
        const given = row.mode === 'CASH' && row.cashTendered.trim() !== '' ? toPaise(row.cashTendered) : null;
        return {
            mode: row.mode,
            amount: two(amount),
            ...(reference ? { reference } : {}),
            ...(given !== null && Number.isFinite(given) ? { cash_tendered: two(given) } : {}),
        };
    });
}

let rowCounter = 0;

/** A new row for `mode`, its amount defaulting to what is still to pay. */
export function newTenderRow(mode: PosTenderMode, rest: number): TenderRow {
    rowCounter += 1;
    const amount = rest > 0 ? rest.toFixed(2) : '';
    return { key: `t${rowCounter}`, mode, amount, reference: '', cashTendered: '' };
}
