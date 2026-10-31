import { useTranslation } from 'react-i18next';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { buildEngineStatusMeta } from '../-constants';

const TONE: Record<string, QuickView['tone']> = {
    ACTIVE: 'success',
    PAUSED: 'warning',
    TEMPLATES_PENDING: 'warning',
    DRY_RUN: 'info',
};

const ORDER = ['ACTIVE', 'DRY_RUN', 'TEMPLATES_PENDING', 'PAUSED', 'DRAFT', 'ARCHIVED'];

/**
 * Engagement Engines: a count per engine status, from the list already loaded.
 * With `onSelect` each count filters the list below; "All" leaves archived engines
 * out unless `includeArchived` is on, so it matches what the list shows.
 */
export function EnginesStatusCounts({
    statuses,
    active,
    onSelect,
    includeArchived = true,
}: {
    statuses: string[];
    active?: string;
    onSelect?: (key: string) => void;
    includeArchived?: boolean;
}) {
    const { t } = useTranslation('crmPages');
    const { t: tConstants } = useTranslation('engagementEnginesConstants');
    if (statuses.length === 0) return null;
    const meta = buildEngineStatusMeta(tConstants) as Record<string, { label: string }>;
    const all = includeArchived ? statuses : statuses.filter((s) => s !== 'ARCHIVED');
    const views: QuickView[] = [
        {
            key: 'all',
            label: t('engines.all'),
            count: all.length,
            active: active === 'all',
            onSelect: onSelect ? () => onSelect('all') : undefined,
        },
        ...ORDER.map((s) => ({ s, n: statuses.filter((x) => x === s).length }))
            .filter((x) => x.n > 0)
            .map((x) => ({
                key: x.s,
                label: meta[x.s]?.label ?? x.s,
                count: x.n,
                tone: TONE[x.s] ?? 'neutral',
                active: active === x.s,
                onSelect: onSelect ? () => onSelect(x.s) : undefined,
            })),
    ];
    return <QuickViews views={views} />;
}
