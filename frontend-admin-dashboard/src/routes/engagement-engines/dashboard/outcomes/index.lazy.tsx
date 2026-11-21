import { createLazyFileRoute, Link, useSearch } from '@tanstack/react-router';
import { ArrowLeft } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
    GroupDashboardShell,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { rangeT } from '../-utils/report-range-t';
import { OutcomesBody } from './-components/OutcomesBody';
import type { OutcomesSearch } from './index';

export const Route = createLazyFileRoute('/engagement-engines/dashboard/outcomes/')({
    component: LeadsAndOutcomesPage,
});

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Leads & outcomes: the people behind the daily report's numbers (leads added, demos, status
 * changes, conversions). Opened from the report's links, so it is not in the sidebar; the
 * header link goes back to the report for the same engine and period. Whole-institute data, so
 * admins only.
 */
function LeadsAndOutcomesPage() {
    const { t: plainT } = useTranslation('engagementDailyReport');
    const isAdmin = useIsInstituteAdmin();
    const { engine, date, from, to } = useSearch({ strict: false }) as OutcomesSearch;
    // "On this day" for one day, "in this period" for a range.
    const t = rangeT(plainT, !!from && !!to);
    return (
        <GroupDashboardShell
            title={t('outcomesPage.title')}
            subtitle={t('outcomesPage.subtitle')}
            isAdmin={isAdmin}
            isLoading={false}
            isError={false}
            actions={
                <Link
                    to="/engagement-engines/dashboard"
                    search={{ engine, date, from, to }}
                    className={LINK_BTN}
                >
                    <ArrowLeft size={14} />
                    <span className="text-caption">{t('outcomesPage.back')}</span>
                </Link>
            }
        >
            <OutcomesBody />
        </GroupDashboardShell>
    );
}
