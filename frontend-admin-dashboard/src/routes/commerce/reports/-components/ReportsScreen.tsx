import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { reportEntry } from '../-shared/report-catalogue';
import type { ReportsSearch } from '../-shared/report-search';
import { ReportPage } from './ReportPage';
import { ReportsHome } from './ReportsHome';

/**
 * `/commerce/reports`: the reports home, or one report when the address names
 * it (`?report=salesRegister&from=…`). Filter changes replace the address,
 * so a link carries every filter and Back leaves the report.
 */
export function ReportsScreen() {
    const { t } = useTranslation(['commerce', 'sidebar']);
    const navigate = useNavigate();
    const search = useSearch({ from: '/commerce/reports/' });
    const entry = reportEntry(search.report);

    const setSearch = (next: Partial<ReportsSearch>) =>
        void navigate({
            to: '/commerce/reports',
            search: (previous: Record<string, unknown>) => ({ ...previous, ...next }),
            replace: true,
        });

    if (entry && entry.view !== 'link') {
        return <ReportPage key={entry.id} entry={entry} search={search} onSearch={setSearch} />;
    }
    return (
        <CommercePage
            navId="commerce-reports"
            title={t('sidebar:commerceReports')}
            description={t('commerce:reports.home.description')}
        >
            <ReportsHome />
        </CommercePage>
    );
}
