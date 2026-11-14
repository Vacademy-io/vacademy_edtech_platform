import { useTranslation } from 'react-i18next';
import { QuickViews } from '@/components/shared/crm-enhance';

/** Chatbot Flows: a count per flow status, from the list already loaded. */
export function FlowsEnhancedCounts({ statuses }: { statuses: string[] }) {
    const { t } = useTranslation('crmPages');
    if (statuses.length === 0) return null;
    const n = (s: string) => statuses.filter((x) => x === s).length;
    return (
        <div className="mb-4">
            <QuickViews
                views={[
                    { key: 'all', label: t('flows.all'), count: statuses.length },
                    {
                        key: 'active',
                        label: t('flows.active'),
                        count: n('ACTIVE'),
                        tone: 'success',
                    },
                    { key: 'draft', label: t('flows.draft'), count: n('DRAFT') },
                    {
                        key: 'inactive',
                        label: t('flows.inactive'),
                        count: n('INACTIVE'),
                        tone: 'warning',
                    },
                    {
                        key: 'archived',
                        label: t('flows.archived'),
                        count: n('ARCHIVED'),
                        tone: 'danger',
                    },
                ]}
            />
        </div>
    );
}
