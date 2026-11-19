import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretRight } from '@phosphor-icons/react';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommerceEmptyState } from '@/routes/commerce/-components/CommerceStates';
import {
    type ReportEntry,
    reportHelpKey,
    reportTitleKey,
    visibleReportGroups,
} from '../-shared/report-catalogue';

/**
 * Reports home (contract §7.1): the reports as cards in five groups. A card
 * shows only when the person's features and role open it (§3.5); the server
 * refuses the rest regardless.
 */
export function ReportsHome() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const groups = visibleReportGroups(access);
    if (groups.length === 0) return <CommerceEmptyState title={t('reports.home.none')} />;
    return (
        <div className="flex flex-col gap-6" data-testid="reports-home">
            {groups.map(({ group, entries }) => (
                <section key={group} className="flex flex-col gap-3" aria-labelledby={`reports-group-${group}`}>
                    <h3 id={`reports-group-${group}`} className="text-subtitle font-medium text-foreground">
                        {t(`reports.groups.${group}`)}
                    </h3>
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {entries.map((entry) => (
                            <li key={entry.id}>
                                <ReportCard entry={entry} />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function ReportCard({ entry }: { entry: ReportEntry }) {
    const { t } = useTranslation('commerce');
    const body = (
        <>
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body font-medium text-foreground">{t(reportTitleKey(entry.id))}</span>
                <span className="text-caption text-muted-foreground">{t(reportHelpKey(entry.id))}</span>
            </div>
            <CaretRight size={16} className="shrink-0 text-muted-foreground rtl:rotate-180" />
        </>
    );
    const className =
        'flex h-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300';
    if (entry.view === 'link') {
        return (
            <Link to="/commerce/reports/audit" className={className} data-testid={`report-card-${entry.id}`}>
                {body}
            </Link>
        );
    }
    return (
        <Link
            to="/commerce/reports"
            search={{ report: entry.id } as never}
            className={className}
            data-testid={`report-card-${entry.id}`}
        >
            {body}
        </Link>
    );
}
