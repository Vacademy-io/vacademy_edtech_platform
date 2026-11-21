import { useTranslation } from 'react-i18next';
import { InsightStrip, QuickViews, type Insight } from '@/components/shared/crm-enhance';
import type { TagItem } from '@/services/tag-management';

/**
 * User Tags: tag counts and the most-used tags, from the tags and per-tag
 * user counts this page already loads.
 */
export function TagsEnhancedHeader({
    instituteTags,
    defaultTags,
    counts,
}: {
    instituteTags: TagItem[];
    defaultTags: TagItem[];
    counts: Record<string, number>;
}) {
    const { t } = useTranslation('crmPages');
    const all = [...instituteTags, ...defaultTags].filter((x) => x.status !== 'DELETED');
    const unused = all.filter((x) => !counts[x.id]).length;
    const inactive = all.filter((x) => x.status === 'INACTIVE').length;
    const top = [...all]
        .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
        .filter((x) => (counts[x.id] ?? 0) > 0);
    const insights: Insight[] = top.slice(0, 2).map((x, i) => ({
        key: x.id,
        tone: i === 0 ? 'success' : 'info',
        title: t('tags.insights.top.title', { name: x.tagName }),
        text: t('tags.insights.top.text', { total: (counts[x.id] ?? 0).toLocaleString('en-IN') }),
    }));
    if (unused > 0) {
        insights.push({
            key: 'unused',
            tone: 'warning',
            title: t('tags.insights.unused.title', { total: unused }),
            text: t('tags.insights.unused.text'),
        });
    }
    return (
        <div className="space-y-4">
            <QuickViews
                views={[
                    { key: 'all', label: t('tags.all'), count: all.length },
                    {
                        key: 'institute',
                        label: t('tags.institute'),
                        count: instituteTags.filter((x) => x.status !== 'DELETED').length,
                        tone: 'info',
                    },
                    {
                        key: 'system',
                        label: t('tags.system'),
                        count: defaultTags.filter((x) => x.status !== 'DELETED').length,
                    },
                    {
                        key: 'unused',
                        label: t('tags.unused'),
                        count: unused,
                        tone: unused > 0 ? 'warning' : 'neutral',
                    },
                    { key: 'inactive', label: t('tags.inactive'), count: inactive },
                ]}
            />
            <InsightStrip insights={insights} />
        </div>
    );
}
