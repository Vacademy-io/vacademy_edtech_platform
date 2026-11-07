import i18next from 'i18next';
import type { PnlSnapshotDTO } from '@/routes/erp/-shared/hr-types';

/**
 * Defensive reader for the P&L snapshot response.
 *
 * The endpoint assembles its answer from three subsystems — payments (collected
 * fee revenue), payroll (employer cost) and the GL (whether the journal exists) —
 * and the contract warns that the nesting "may differ slightly". A finance screen
 * that renders `NaN`, `Infinity` or `₹0.00` because a key moved is worse than one
 * that renders "—": the first quietly reports a wrong number to someone who will
 * act on it.
 *
 * So nothing here indexes a key it has not checked for. Every number is read
 * through `firstNumber`, which walks a list of plausible paths and returns
 * `undefined` — rendered as an em dash — when none of them holds a finite number.
 * Absence is a first-class outcome, never coerced to zero.
 */

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;

/** A finite number, or undefined. Accepts BigDecimal-as-string, rejects '' and NaN. */
const toNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

/** Value at a dotted path, or undefined at the first missing/non-object hop. */
const at = (root: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => asRecord(node)?.[key], root);

/** The first path that holds a finite number. */
const firstNumber = (root: unknown, paths: string[]): number | undefined => {
    for (const path of paths) {
        const value = toNumber(at(root, path));
        if (value !== undefined) return value;
    }
    return undefined;
};

/** The first path that holds a non-empty string. */
const firstString = (root: unknown, paths: string[]): string | undefined => {
    for (const path of paths) {
        const value = at(root, path);
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
};

/** The first path that holds a real boolean — undefined means "not reported". */
const firstBoolean = (root: unknown, paths: string[]): boolean | undefined => {
    for (const path of paths) {
        const value = at(root, path);
        if (typeof value === 'boolean') return value;
    }
    return undefined;
};

const firstArray = (root: unknown, paths: string[]): unknown[] => {
    for (const path of paths) {
        const value = at(root, path);
        if (Array.isArray(value)) return value;
    }
    return [];
};

export interface NormalizedDepartmentCost {
    key: string;
    name: string;
    headcount?: number;
    employerCost?: number;
    /** 0-100, or undefined when the departments carry no cost at all. */
    sharePct?: number;
}

export interface NormalizedJournalPresence {
    /** False when the backend said nothing about the journal either way. */
    reported: boolean;
    exists: boolean;
    posted: boolean;
    count?: number;
}

export interface NormalizedPnl {
    /** Cash collected in the period. Undefined = not reported, NOT zero. */
    revenue?: number;
    employerCost?: number;
    netPay?: number;
    employeeCount?: number;
    runCount?: number;
    margin?: number;
    /** Cost as a percentage of revenue. Undefined when revenue is 0 or missing. */
    costToRevenuePct?: number;
    /** True when `margin` was computed here from revenue − cost rather than sent. */
    marginComputed: boolean;
    currency: string;
    journal: NormalizedJournalPresence;
    departments: NormalizedDepartmentCost[];
    /** Sum of the listed departments — may be less than `employerCost`. */
    departmentTotal?: number;
    warnings: string[];
}

const REVENUE_PATHS = [
    'revenue.total_collected',
    'revenue.collected',
    'revenue.total_collected_amount',
    'revenue.collected_amount',
    'revenue.total',
    'revenue.amount',
    'revenue.total_revenue',
    'collected_revenue',
    'total_collected',
    'revenue',
];

const EMPLOYER_COST_PATHS = [
    'payroll_cost.total_employer_cost',
    'payroll_cost.employer_cost',
    'payroll_cost.total',
    'payroll.total_employer_cost',
    'payroll.employer_cost',
    'total_employer_cost',
    'employer_cost',
    'payroll_cost',
];

/**
 * Read one department row. The list is the part of the payload most likely to be
 * renamed (it is projected from a GROUP BY), so name and cost are both probed.
 */
const readDepartment = (raw: unknown, index: number): NormalizedDepartmentCost => {
    const record = asRecord(raw);
    const name =
        firstString(record, ['department_name', 'name', 'department', 'department_code']) ??
        i18next.t('erpPnlShape:unassignedDepartment');
    return {
        key: firstString(record, ['department_id', 'id']) ?? `${name}-${index}`,
        name,
        headcount: firstNumber(record, ['headcount', 'employee_count', 'count', 'employees']),
        employerCost: firstNumber(record, [
            'employer_cost',
            'total_employer_cost',
            'cost',
            'amount',
            'total',
        ]),
    };
};

/** Strings, or objects that carry their message under a known key. */
const readWarnings = (root: unknown): string[] =>
    firstArray(root, ['warnings', 'warning_messages', 'messages'])
        .map((warning) => {
            if (typeof warning === 'string') return warning.trim();
            return firstString(asRecord(warning), ['message', 'text', 'detail', 'warning']) ?? '';
        })
        .filter((warning) => warning.length > 0);

export function normalizePnlSnapshot(raw: PnlSnapshotDTO | undefined): NormalizedPnl {
    const revenue = firstNumber(raw, REVENUE_PATHS);
    const employerCost = firstNumber(raw, EMPLOYER_COST_PATHS);

    // Margin is unambiguous, so the server's number wins when it sends one; the
    // local fallback is plain arithmetic on two figures already on screen.
    const sentMargin = firstNumber(raw, ['derived.margin', 'derived.net_margin', 'margin']);
    const computedMargin =
        revenue !== undefined && employerCost !== undefined ? revenue - employerCost : undefined;
    const margin = sentMargin ?? computedMargin;

    // The ratio is deliberately NOT read from `derived.cost_to_revenue_ratio`:
    // a bare 1.5 there could mean 150% or 1.5%, and there is no way to tell from
    // the payload. Computing it from two figures we can see removes the guess —
    // and it needs revenue anyway, which is the same precondition.
    const costToRevenuePct =
        revenue !== undefined && revenue !== 0 && employerCost !== undefined
            ? (employerCost / revenue) * 100
            : undefined;

    const departmentRows = firstArray(raw, [
        'payroll_cost.departments',
        'payroll_cost.department_costs',
        'payroll.departments',
        'departments',
        'department_costs',
    ]).map(readDepartment);

    const costed = departmentRows.filter((row) => row.employerCost !== undefined);
    const departmentTotal = costed.length
        ? costed.reduce((sum, row) => sum + (row.employerCost ?? 0), 0)
        : undefined;

    const departments = departmentRows.map((row) => ({
        ...row,
        sharePct:
            departmentTotal !== undefined && departmentTotal !== 0 && row.employerCost !== undefined
                ? (row.employerCost / departmentTotal) * 100
                : undefined,
    }));

    const journalCount = firstNumber(raw, ['journal.count', 'journal_count', 'journal.entries']);
    const journalExists = firstBoolean(raw, ['journal.exists', 'journal_exists']);
    const journalPosted = firstBoolean(raw, ['journal.posted', 'journal_posted']);
    const journalReported =
        journalExists !== undefined || journalPosted !== undefined || journalCount !== undefined;

    return {
        revenue,
        employerCost,
        netPay: firstNumber(raw, [
            'payroll_cost.total_net_pay',
            'payroll_cost.net_pay',
            'total_net_pay',
        ]),
        employeeCount: firstNumber(raw, [
            'payroll_cost.employee_count',
            'payroll_cost.headcount',
            'employee_count',
        ]),
        runCount: firstNumber(raw, ['payroll_cost.run_count', 'run_count', 'payroll.run_count']),
        margin,
        costToRevenuePct,
        marginComputed: sentMargin === undefined && computedMargin !== undefined,
        currency:
            firstString(raw, [
                'currency.code',
                'currency',
                'revenue.currency',
                'payroll_cost.currency',
            ]) ?? 'INR',
        journal: {
            reported: journalReported,
            exists: journalExists ?? (journalCount ?? 0) > 0,
            posted: journalPosted ?? journalExists ?? (journalCount ?? 0) > 0,
            count: journalCount,
        },
        departments,
        departmentTotal,
        warnings: readWarnings(raw),
    };
}
