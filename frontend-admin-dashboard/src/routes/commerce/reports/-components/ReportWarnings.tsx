import { useTranslation } from 'react-i18next';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import type { ReportWarning } from '../-shared/report-types';
import { REPORT_WARNING_CODES } from '../-shared/report-keys';

const KNOWN = new Set<string>(REPORT_WARNING_CODES);
/** Warnings that mean the figures cannot be filed as they are: error colour. */
const SERIOUS = new Set<string>(['GSTR1_DOES_NOT_ADD_UP', 'SERIES_GAP']);
const MAX_REFS = 5;

export interface WarningGroup {
    code: string;
    /** Rows covered: the server's counts, else one per warning sent. */
    count: number;
    refs: string[];
    message: string;
    serious: boolean;
}

/** One line per code, in the order the server sent them. Counting rows, not adding money. */
export function groupWarnings(warnings: ReportWarning[]): WarningGroup[] {
    const groups = new Map<string, WarningGroup>();
    warnings.forEach((w) => {
        const group = groups.get(w.code) ?? {
            code: w.code,
            count: 0,
            refs: [],
            message: w.message,
            serious: SERIOUS.has(w.code),
        };
        group.count += w.count ?? 1;
        if (w.ref && !group.refs.includes(w.ref)) group.refs.push(w.ref);
        groups.set(w.code, group);
    });
    return Array.from(groups.values());
}

/** Each warning as an alert line with its count (contract §7.2); gaps and a GSTR-1 that does not add up in red. */
export function ReportWarnings({ warnings }: { warnings: ReportWarning[] }) {
    const { t } = useTranslation('commerce');
    const groups = groupWarnings(warnings);
    if (groups.length === 0) return null;
    return (
        <div className="flex flex-col gap-2" data-testid="report-warnings">
            {groups.map((group) => (
                <OrderNotice key={group.code} tone={group.serious ? 'danger' : 'warning'}>
                    <p data-code={group.code}>
                        {KNOWN.has(group.code) ? t(`reports.warnings.${group.code}`) : group.message || group.code}
                        {' · '}
                        {t('reports.warnings.count', { count: group.count })}
                    </p>
                    {group.refs.length > 0 && (
                        <p className="text-caption text-muted-foreground">
                            {group.refs.slice(0, MAX_REFS).join(', ')}
                            {group.refs.length > MAX_REFS ? ` ${t('reports.warnings.more', { count: group.refs.length - MAX_REFS })}` : ''}
                        </p>
                    )}
                </OrderNotice>
            ))}
        </div>
    );
}
