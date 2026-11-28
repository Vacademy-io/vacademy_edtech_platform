import type { ReactNode } from 'react';
import { DateFilter } from './date-filter';
import { BatchFilter } from './batch-filter';
import { StatusFilter } from './status-filter';
import { TypeFilter } from './type-filter';
import { AssigneeFilter } from './assignee-filter';
import { Funnel } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

/**
 * @param actions Rendered at the right end of the "Filters" header row — the Inbox/Board view
 *        toggle lives here so it doesn't cost the page another row of height.
 */
export const Filters = ({ actions }: { actions?: ReactNode }) => {
    const { t } = useTranslation('studyLibraryFilters');
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <Funnel size={14} weight="duotone" className="text-primary-500" />
                    {t('filtersLabel')}
                </div>
                {actions}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <StatusFilter />
                <TypeFilter />
                <AssigneeFilter />
                <BatchFilter />
                <DateFilter />
            </div>
        </div>
    );
};
