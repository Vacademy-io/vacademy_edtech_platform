import { useTranslation } from 'react-i18next';
import { useAdminLanguage } from '@/routes/commerce/-components/CatalogueBits';
import { OrderNotice } from '@/routes/commerce/orders/-components/order-ui';
import { sectionLabel } from '../-shared/report-columns';
import type { ReportSection, ReportWarning } from '../-shared/report-types';
import { REPORT_WARNING_CODES, SERIOUS_WARNING_CODES } from '../-shared/report-keys';

const KNOWN = new Set<string>(REPORT_WARNING_CODES);
const SERIOUS = new Set<string>(SERIOUS_WARNING_CODES);
const MAX_REFS = 5;

export interface WarningGroup {
    code: string;
    /** Rows covered: one per warning sent, plus the N of the server's "and N more" fold. */
    count: number;
    refs: string[];
    message: string;
    serious: boolean;
}

/**
 * One line per code, in the order the server sent them. The server lists at
 * most 100 per code and folds the rest into "and N more" (no ref): that one
 * adds N. Counting rows, not adding money.
 */
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
        group.count += w.more ?? 1;
        if (w.ref && !group.refs.includes(w.ref)) group.refs.push(w.ref);
        groups.set(w.code, group);
    });
    return Array.from(groups.values());
}

/**
 * Each warning as an alert line with its count (contract §7.2); gaps and a
 * GSTR-1 that does not add up in red. A ref that names a block of the answer
 * (`ROWS_CUT` on "documents") is shown as that block's heading (N7).
 */
export function ReportWarnings({ warnings, sections = [] }: { warnings: ReportWarning[]; sections?: ReportSection[] }) {
    const { t } = useTranslation('commerce');
    const lang = useAdminLanguage();
    const blocks = new Map(sections.map((section) => [section.key, sectionLabel(section, lang)]));
    const refText = (ref: string) => blocks.get(ref) ?? ref;
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
                            {group.refs.slice(0, MAX_REFS).map(refText).join(', ')}
                            {group.refs.length > MAX_REFS ? ` ${t('reports.warnings.more', { count: group.refs.length - MAX_REFS })}` : ''}
                        </p>
                    )}
                </OrderNotice>
            ))}
        </div>
    );
}
