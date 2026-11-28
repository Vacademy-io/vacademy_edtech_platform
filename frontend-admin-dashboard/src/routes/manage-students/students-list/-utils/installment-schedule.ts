import type {
    InstallmentIntervalUnit,
    InstallmentSchedule,
    InstallmentScheduleRow,
} from '../-types/bulk-assign-types';
import type {
    CPOFeeType,
    CPOFlexibleDefaults,
} from '@/routes/financial-management/fee-plans/-types/cpo-types';

/**
 * Installment-schedule maths for the Enroll wizard. Mirrors the backend's
 * InstallmentScheduleService exactly, so the preview is what gets written:
 *  - amounts are whole currency units, the remainder (incl. paise) goes on installment #1;
 *  - DAYS: due k = first + k × value days;
 *  - MONTHS: due k = first + k × value months, counted from the first date each time and
 *    clamped to the month's length (31 Jan → 28 Feb → 31 Mar), so dates never drift.
 * See docs/CPO_FLEXIBLE_INSTALLMENTS.md.
 */

/** Same caps as InstallmentScheduleService (MAX_INSTALLMENTS, MAX_INTERVAL_DAYS/MONTHS). */
export const MAX_INSTALLMENTS = 60;
export const MAX_GAP: Record<InstallmentIntervalUnit, number> = { DAYS: 3660, MONTHS: 120 };

/** One fee of a plan and how a schedule treats it (split over the schedule, or paid upfront). */
export interface SchedulePart {
    feeTypeName: string;
    total: number;
    split: boolean;
}

/** Local YYYY-MM-DD for today; avoids the UTC shift of toISOString(). */
export const todayIso = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const parseIso = (iso: string): [number, number, number] | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const toIso = (y: number, m: number, d: number) =>
    `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const addDaysIso = (iso: string, days: number): string => {
    const p = parseIso(iso);
    if (!p) return iso;
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
    return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export const addMonthsIso = (iso: string, months: number): string => {
    const p = parseIso(iso);
    if (!p) return iso;
    const zeroBased = p[1] - 1 + months;
    const y = p[0] + Math.floor(zeroBased / 12);
    const m = (((zeroBased % 12) + 12) % 12) + 1;
    return toIso(y, m, Math.min(p[2], daysInMonth(y, m)));
};

export const generateDueDates = (
    firstDueDate: string,
    count: number,
    unit: InstallmentIntervalUnit,
    value: number
): string[] =>
    Array.from({ length: count }, (_, k) =>
        unit === 'DAYS'
            ? addDaysIso(firstDueDate, k * value)
            : addMonthsIso(firstDueDate, k * value)
    );

/** Whole-unit equal split, remainder on the first part. Works in paise to avoid float drift. */
export const equalSplit = (total: number, count: number): number[] => {
    if (count < 1) return [];
    const totalPaise = Math.round(total * 100);
    const basePaise = Math.floor(totalPaise / count / 100) * 100;
    const firstPaise = totalPaise - basePaise * (count - 1);
    return [firstPaise / 100, ...Array.from({ length: count - 1 }, () => basePaise / 100)];
};

/** The plan's fees as the backend sees them (DELETED rows are not returned by the API). */
export const partsFromFeeTypes = (feeTypes: CPOFeeType[] | undefined): SchedulePart[] => {
    if (!Array.isArray(feeTypes)) return [];
    return feeTypes
        .filter((ft) => ft.assigned_fee_value)
        .map((ft) => {
            const afv = ft.assigned_fee_value;
            const installments = afv.installments ?? [];
            const total =
                installments.length > 0
                    ? installments.reduce((s, i) => s + Number(i.amount ?? 0), 0)
                    : Number(afv.amount ?? 0);
            return {
                feeTypeName: ft.name,
                total,
                split: installments.length > 0 || afv.has_installment === true,
            };
        });
};

/** Starting schedule: the plan's defaults, else its template count, else 3 monthly. */
export const initialSchedule = (
    defaults: CPOFlexibleDefaults | null | undefined,
    templateCount?: number
): InstallmentSchedule => ({
    count: defaults?.count ?? (templateCount && templateCount > 1 ? templateCount : 3),
    interval: defaults?.interval ?? { unit: 'MONTHS', value: 1 },
    first_due_date: todayIso(),
    rows: null,
});

/**
 * Rows generated from the rule, with gross amounts. When the plan splits more than one fee,
 * the amount is the sum of each fee's share of that installment.
 */
export const rowsFromRule = (
    schedule: InstallmentSchedule,
    splitParts: SchedulePart[]
): InstallmentScheduleRow[] => {
    const count = schedule.count ?? 0;
    if (!schedule.first_due_date || count < 1 || count > MAX_INSTALLMENTS) return [];
    const unit = schedule.interval?.unit ?? 'MONTHS';
    const value =
        schedule.interval?.value && schedule.interval.value > 0 ? schedule.interval.value : 1;
    const dates = generateDueDates(schedule.first_due_date, count, unit, value);
    const shares = splitParts.map((p) => equalSplit(p.total, count));
    return dates.map((due_date, k) => ({
        due_date,
        amount: shares.reduce((s, share) => s + (share[k] ?? 0), 0),
    }));
};

/** A schedule problem as a translation key (namespace manageStudentsCpoEnrollmentConfigPanel). */
export interface ScheduleError {
    key: string;
    params?: Record<string, string | number>;
}

/**
 * Validates a schedule against the plan with the backend's rules, so the admin sees the
 * problem before Preview. Returns null when the schedule can be sent.
 */
export const validateSchedule = (
    schedule: InstallmentSchedule | null | undefined,
    parts: SchedulePart[],
    maxCount: number
): ScheduleError | null => {
    if (!schedule) return null;
    const splitParts = parts.filter((p) => p.split);
    if (parts.length > 0 && splitParts.length === 0)
        return { key: 'schedule.errors.nothingToSplit' };
    const max = Math.min(maxCount, MAX_INSTALLMENTS);
    if (!schedule.rows && (schedule.count ?? 0) > 1) {
        const unit = schedule.interval?.unit ?? 'MONTHS';
        const value = schedule.interval?.value ?? 0;
        if (!Number.isInteger(value) || value < 1 || value > MAX_GAP[unit]) {
            return { key: 'schedule.errors.gapRange', params: { max: MAX_GAP[unit] } };
        }
    }
    const rows = schedule.rows ?? rowsFromRule(schedule, splitParts);
    if (rows.length < 1 || rows.length > max)
        return { key: 'schedule.errors.countRange', params: { max } };
    for (let k = 0; k < rows.length; k++) {
        if (!rows[k]?.due_date)
            return { key: 'schedule.errors.missingDueDate', params: { n: k + 1 } };
        if (k > 0 && rows[k]!.due_date < rows[k - 1]!.due_date) {
            return { key: 'schedule.errors.datesOutOfOrder', params: { n: k + 1, prev: k } };
        }
    }
    // A fee smaller than the count would leave installments of zero.
    for (const part of splitParts) {
        if (part.total > 0 && equalSplit(part.total, rows.length).some((a) => a === 0)) {
            return {
                key: 'schedule.errors.tooSmall',
                params: { fee: part.feeTypeName, count: rows.length },
            };
        }
    }
    const withAmount = rows.filter((r) => r.amount != null).length;
    if (withAmount > 0 && withAmount !== rows.length)
        return { key: 'schedule.errors.mixedAmounts' };
    if (withAmount > 0) {
        if (rows.some((r) => (r.amount ?? 0) <= 0))
            return { key: 'schedule.errors.negativeAmount' };
        if (
            rows.some(
                (r) => Math.abs((r.amount ?? 0) * 100 - Math.round((r.amount ?? 0) * 100)) > 1e-6
            )
        ) {
            return { key: 'schedule.errors.decimals' };
        }
        const splitTotal = splitParts.reduce((s, p) => s + p.total, 0);
        const given = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
        if (Math.round(given * 100) !== Math.round(splitTotal * 100)) {
            return {
                key: 'schedule.errors.amountMismatch',
                params: { given: formatInr(given), total: formatInr(splitTotal) },
            };
        }
    }
    const generated = rowsFromRule({ ...schedule, rows: null, count: rows.length }, splitParts);
    for (let k = 0; k < rows.length; k++) {
        const off = rows[k]!.discount ?? 0;
        if (off < 0) return { key: 'schedule.errors.negativeDiscount', params: { n: k + 1 } };
        const gross = rows[k]!.amount ?? generated[k]?.amount;
        if (gross != null && Math.round(off * 100) > Math.round(gross * 100)) {
            return { key: 'schedule.errors.discountTooBig', params: { n: k + 1 } };
        }
    }
    return null;
};

export const formatInr = (n: number) =>
    Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';

/**
 * After the admin sets installment `index` to `amount`, spread what is left of `total` evenly
 * over the installments after it (or, when the last one was edited, over those before it), so
 * the schedule keeps adding up to the fee. Whole units, remainder on the first spread row.
 * When the edited amount leaves nothing (or less than nothing) to spread, only the edited row
 * changes and validation explains the problem.
 */
export const rebalanceRows = (
    rows: InstallmentScheduleRow[],
    index: number,
    amount: number,
    total: number
): InstallmentScheduleRow[] => {
    const next = rows.map((r, k) => ({ ...r, amount: k === index ? amount : r.amount ?? 0 }));
    const n = next.length;
    if (n < 2) return next;
    const targets =
        index < n - 1
            ? Array.from({ length: n - 1 - index }, (_, i) => index + 1 + i)
            : Array.from({ length: n - 1 }, (_, i) => i);
    const fixedPaise = next
        .filter((_, k) => !targets.includes(k))
        .reduce((s, r) => s + Math.round((r.amount ?? 0) * 100), 0);
    const remaining = (Math.round(total * 100) - fixedPaise) / 100;
    if (remaining < 0) return next;
    const shares = equalSplit(remaining, targets.length);
    targets.forEach((k, i) => {
        next[k] = { ...next[k]!, amount: shares[i] ?? 0 };
    });
    return next;
};

/**
 * The discount in money for a plan of `gross` (a percentage is of the whole price), in paise
 * precision and never more than the price.
 */
export const discountAmount = (
    spec: { type: 'PERCENTAGE' | 'FLAT'; value: number } | null | undefined,
    gross: number
): number => {
    if (!spec || !Number.isFinite(spec.value) || spec.value <= 0 || gross <= 0) return 0;
    const raw = spec.type === 'PERCENTAGE' ? (gross * spec.value) / 100 : spec.value;
    return Math.min(Math.round(raw * 100), Math.round(gross * 100)) / 100;
};

/**
 * Splits a discount of `total` over installments of `gross` amounts. EVEN: the same amount off
 * each, whole units with the remainder on the first (an installment too small for its share
 * gives the rest to the others). FIRST / LAST: all off the first / last installment, spilling
 * to the next one when it is used up. Never more off an installment than it is.
 */
export const spreadDiscount = (
    gross: number[],
    total: number,
    split: 'EVEN' | 'FIRST' | 'LAST'
): number[] => {
    const cap = gross.map((g) => Math.max(0, Math.round(g * 100)));
    let rest = Math.min(
        Math.round(total * 100),
        cap.reduce((s, c) => s + c, 0)
    );
    const out = gross.map(() => 0);
    if (rest <= 0 || gross.length === 0) return out;
    if (split === 'EVEN') {
        let open = cap.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
        while (rest > 0 && open.length > 0) {
            const shares = equalSplit(rest / 100, open.length).map((v) => Math.round(v * 100));
            let given = 0;
            const stillOpen: number[] = [];
            open.forEach((i, k) => {
                const take = Math.min(shares[k] ?? 0, cap[i]! - out[i]!);
                out[i] = out[i]! + take;
                given += take;
                if (out[i]! < cap[i]!) stillOpen.push(i);
            });
            rest -= given;
            if (given === 0) break;
            open = stillOpen;
        }
    } else {
        const order = gross.map((_, i) => i);
        if (split === 'LAST') order.reverse();
        for (const i of order) {
            if (rest <= 0) break;
            const take = Math.min(cap[i]!, rest);
            out[i] = take;
            rest -= take;
        }
    }
    return out.map((p) => p / 100);
};

/**
 * The admin typed what the learner pays for installment `index`. Each installment keeps its
 * discount; with `rebalance`, what the others pay is spread so the total to pay stays the
 * same (as rebalanceRows does for amounts). Returns rows with gross = to pay + discount.
 */
export const setToPay = (
    rows: InstallmentScheduleRow[],
    index: number,
    toPay: number,
    rebalance: boolean
): InstallmentScheduleRow[] => {
    const nets = rows.map((r) => ({
        due_date: r.due_date,
        amount: round2((r.amount ?? 0) - (r.discount ?? 0)),
    }));
    const netTotal = nets.reduce((s, r) => s + (r.amount ?? 0), 0);
    const next = rebalance
        ? rebalanceRows(nets, index, toPay, round2(netTotal))
        : nets.map((r, k) => (k === index ? { ...r, amount: toPay } : r));
    return rows.map((r, k) => ({
        ...r,
        amount: round2((next[k]?.amount ?? 0) + (r.discount ?? 0)),
    }));
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The rows a schedule should carry for a discount split EVEN / FIRST / LAST, or null when they
 * already do (CUSTOM is the admin's own and is only cleared when the discount goes away).
 * Shared by the enrollment fee panel and the admission package.
 */
export const respreadScheduleDiscounts = (
    schedule: InstallmentSchedule,
    generated: InstallmentScheduleRow[],
    wanted: number,
    split: 'EVEN' | 'FIRST' | 'LAST' | 'CUSTOM',
    hasDiscount: boolean,
    amountsEditable: boolean
): InstallmentScheduleRow[] | null => {
    if (split === 'CUSTOM' && hasDiscount) return null;
    const base = schedule.rows ?? generated;
    if (base.length === 0) return null;
    const gross = base.map((r, k) => r.amount ?? generated[k]?.amount ?? 0);
    const want =
        wanted > 0
            ? spreadDiscount(gross, wanted, split === 'CUSTOM' ? 'EVEN' : split)
            : gross.map(() => 0);
    const same = base.every(
        (r, k) => Math.round((r.discount ?? 0) * 100) === Math.round((want[k] ?? 0) * 100)
    );
    if (same) return null;
    return base.map((r, k) => ({
        due_date: r.due_date,
        amount: amountsEditable ? r.amount ?? null : null,
        discount: want[k] || null,
    }));
};
