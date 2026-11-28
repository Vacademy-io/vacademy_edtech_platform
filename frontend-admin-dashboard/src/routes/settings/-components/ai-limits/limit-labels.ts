import type { TFunction } from 'i18next';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import { formatNumber } from '@/lib/formatters';
import type { LimitMetric, LimitRow } from '../../-services/ai-limits-service';

type T = TFunction | ((key: string, options?: Record<string, unknown>) => string);

const tr = (t: T, key: string, options?: Record<string, unknown>) =>
    (t as (k: string, o?: Record<string, unknown>) => string)(key, options);

export const prettyKey = (s: string | null | undefined): string => {
    if (!s) return '';
    const v = s.replace(/[_-]+/g, ' ').trim();
    return v.charAt(0).toUpperCase() + v.slice(1);
};

export function roleClassLabel(t: T, rc: string | null | undefined): string {
    if (!rc) return '';
    const key = `roleClass.${rc}`;
    const out = tr(t, key);
    return out === key ? prettyKey(rc) : out;
}

export function featureGroupLabel(t: T, group: string | null | undefined): string {
    if (!group) return '';
    const key = `featureGroup.${group}`;
    const out = tr(t, key);
    return out === key ? prettyKey(group) : out;
}

export function roleLabel(role: string | null | undefined): string {
    if (!role) return '';
    try {
        return mapRoleToCustomName(role) || prettyKey(role);
    } catch {
        return prettyKey(role);
    }
}

/** "Whole institute", "Each Teacher", "All Evaluators together", a user's name. */
export function subjectText(
    t: T,
    row: Pick<LimitRow, 'subject_kind' | 'subject_value' | 'subject_label' | 'per_member'>
): string {
    switch (row.subject_kind) {
        case 'INSTITUTE':
            return tr(t, 'subject.institute');
        case 'ROLE_CLASS': {
            const name = row.subject_label || roleClassLabel(t, row.subject_value);
            return row.per_member
                ? tr(t, 'subject.eachMember', { name })
                : tr(t, 'subject.pooled', { name });
        }
        case 'ROLE': {
            const name = row.subject_label || roleLabel(row.subject_value);
            return row.per_member
                ? tr(t, 'subject.eachMember', { name })
                : tr(t, 'subject.pooled', { name });
        }
        case 'USER':
            return row.subject_label || row.subject_value || tr(t, 'subject.user');
        default:
            return row.subject_label || row.subject_value || '';
    }
}

export function scopeText(
    t: T,
    row: Pick<LimitRow, 'scope_kind' | 'scope_value' | 'scope_label'>
): string {
    if (row.scope_kind === 'ALL') return tr(t, 'scope.all');
    if (row.scope_kind === 'GROUP') return row.scope_label || featureGroupLabel(t, row.scope_value);
    return row.scope_label || prettyKey(row.scope_value);
}

export function unitText(t: T, metric: LimitMetric | string | null | undefined): string {
    if (metric === 'COUNT') return tr(t, 'unit.requests');
    if (metric === 'COST_USD') return tr(t, 'unit.usd');
    return tr(t, 'unit.credits');
}

export function amount(n: number | null | undefined): string {
    if (n === null || n === undefined) return '';
    return formatNumber(n, { maximumFractionDigits: 2 });
}

/** A limit cell: "—" for no limit, "Off" for a hard limit of 0. */
export function limitCell(t: T, n: number | null, isHard: boolean): string {
    if (n === null) return isHard ? tr(t, 'table.unlimited') : '—';
    if (isHard && n === 0) return tr(t, 'table.featureOff');
    return amount(n);
}
