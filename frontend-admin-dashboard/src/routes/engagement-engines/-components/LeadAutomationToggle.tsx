import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, Robot } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useLeadAutomation, useSetLeadAutomation } from '../-hooks/actions';

/**
 * B8: the per-lead "Do not automate" switch, for the lead side panel. With it on, engagement
 * engines still read the lead and draft for the inbox, but never send or act on their own.
 * Renders nothing without a lead row id (a learner who is not a lead).
 */
export function LeadAutomationToggle({ leadId }: { leadId?: string | null }) {
    const { t } = useTranslation('engagementEnginesActions');
    const { data, isLoading, isError, refetch } = useLeadAutomation(leadId);
    const set = useSetLeadAutomation(leadId ?? '');
    if (!leadId) return null;
    if (isLoading) return <Skeleton className="h-12 w-full rounded-lg" />;
    if (isError) {
        return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3">
                <span className="text-body text-danger-600">{t('lead.loadFailed')}</span>
                <MyButton buttonType="secondary" scale="small" onClick={() => refetch()}>
                    <ArrowsClockwise className="me-1 size-4" aria-hidden /> {t('lead.retry')}
                </MyButton>
            </div>
        );
    }
    const on = !!data?.doNotAutomate;
    return (
        <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
            <Robot className="mt-0.5 size-4 shrink-0 text-neutral-500" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-semibold text-neutral-900">{t('lead.title')}</span>
                <span id={`lead-automation-hint-${leadId}`} className="text-caption text-neutral-500">
                    {on ? t('lead.onHint') : t('lead.offHint')}
                </span>
            </span>
            <Switch
                checked={on}
                disabled={set.isPending}
                onCheckedChange={(v) => set.mutate(v)}
                aria-label={t('lead.title')}
                aria-describedby={`lead-automation-hint-${leadId}`}
            />
        </label>
    );
}
