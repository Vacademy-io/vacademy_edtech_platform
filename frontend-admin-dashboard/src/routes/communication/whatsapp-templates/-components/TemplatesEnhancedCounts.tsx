import { useTranslation } from 'react-i18next';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';

/** `ALL` or a template status (APPROVED, PENDING, ...). */
export type TemplateStatusView = 'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'DRAFT' | 'DISABLED';

/**
 * WhatsApp Templates: a count per approval status, from the list already loaded. When `onSelect`
 * is given the cards double as quick filters for the list below (client-side, no request).
 */
export function TemplatesEnhancedCounts({
    statuses,
    active,
    onSelect,
}: {
    statuses: string[];
    active?: TemplateStatusView;
    onSelect?: (view: TemplateStatusView) => void;
}) {
    const { t } = useTranslation('crmPages');
    const live = statuses.filter((s) => s !== 'DELETED');
    const n = (s: string) => live.filter((x) => x === s).length;
    const views: (Omit<QuickView, 'key'> & { key: TemplateStatusView })[] = [
        { key: 'ALL', label: t('templates.all'), count: live.length },
        { key: 'APPROVED', label: t('templates.approved'), count: n('APPROVED'), tone: 'success' },
        { key: 'PENDING', label: t('templates.pending'), count: n('PENDING'), tone: 'warning' },
        { key: 'REJECTED', label: t('templates.rejected'), count: n('REJECTED'), tone: 'danger' },
        { key: 'DRAFT', label: t('templates.draft'), count: n('DRAFT') },
        { key: 'DISABLED', label: t('templates.disabled'), count: n('DISABLED') },
    ];
    return (
        <div className="mb-4">
            <QuickViews
                caption={t('templates.caption')}
                views={views.map((v) => ({
                    ...v,
                    active: onSelect ? active === v.key : undefined,
                    onSelect: onSelect ? () => onSelect(v.key) : undefined,
                }))}
            />
        </div>
    );
}
