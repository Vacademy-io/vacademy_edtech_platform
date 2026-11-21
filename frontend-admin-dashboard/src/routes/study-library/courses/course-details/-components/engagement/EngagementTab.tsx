import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
    ArrowClockwise,
    ArrowRight,
    CalendarPlus,
    Plus,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { listPlans } from '@/routes/engagement/-services/engagement-service';
import type { EngagementPlanDTO, PlanLifecycle } from '@/routes/engagement/-types/types';
import { planDateRange, planLifecycle } from '@/routes/engagement/-utils/format';
import { AiPlanWizard } from '@/routes/engagement/-components/AiPlanWizard';
import { PlanComposerDialog } from '@/routes/engagement/-components/PlanComposerDialog';
import { PlanCard, lookAlikePlanIds } from '@/routes/engagement/-components/PlanCard';

/** Plans read for the summary; a batch never has more in practice. */
const SUMMARY_SIZE = 100;
/** Current plans shown on the tab before "Open plans". */
const SHOWN = 3;
const SUMMARY_ORDER: PlanLifecycle[] = ['RUNNING', 'UPCOMING', 'DRAFT'];

function rankOf(state: PlanLifecycle | null): number {
    return state ? SUMMARY_ORDER.indexOf(state) : SUMMARY_ORDER.length;
}

/**
 * Counts per lifecycle, and the plans a teacher is working with now: running first,
 * then upcoming (soonest first), then drafts.
 */
export function summarizePlans(plans: EngagementPlanDTO[]): {
    counts: Record<PlanLifecycle, number>;
    current: EngagementPlanDTO[];
} {
    const counts: Record<PlanLifecycle, number> = {
        DRAFT: 0,
        UPCOMING: 0,
        RUNNING: 0,
        ENDED: 0,
        ARCHIVED: 0,
    };
    const withState = plans.map((plan) => ({ plan, state: planLifecycle(plan) }));
    for (const { state } of withState) if (state) counts[state] += 1;
    const current = withState
        // A null state is a published plan an older server sent without dates: keep it
        // visible (after the known ones) rather than hide a live plan.
        .filter(({ state }) => !state || SUMMARY_ORDER.includes(state))
        .sort((a, b) => {
            const rank = rankOf(a.state) - rankOf(b.state);
            if (rank !== 0) return rank;
            const aFirst = planDateRange(a.plan)?.first ?? '';
            const bFirst = planDateRange(b.plan)?.first ?? '';
            return aFirst.localeCompare(bFirst);
        })
        .map(({ plan }) => plan);
    return { counts, current };
}

/**
 * Course page → Engagement tab: a summary of the batch's daily engagement.
 *
 * Shows how many plans are running, upcoming and in draft, the plans a teacher is
 * working with now, and "Open plans" to the full list filtered to this batch. New plan
 * and Plan with AI are seeded with this batch (the composer still allows adding more).
 */
export function EngagementTab({ packageSessionId }: { packageSessionId: string }) {
    const { t } = useTranslation('engagement');
    const [composerOpen, setComposerOpen] = useState(false);
    // Bumped on every open so the composer mounts fresh: no fields, days or tasks carried
    // over from the previous plan.
    const [composerKey, setComposerKey] = useState(0);
    const [composerPlanId, setComposerPlanId] = useState<string | null>(null);
    const openComposer = (planId: string | null = null) => {
        setComposerPlanId(planId);
        setComposerKey((n) => n + 1);
        setComposerOpen(true);
    };
    const [aiOpen, setAiOpen] = useState(false);

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['engagement-plans', { packageSessionId, summary: true }],
        queryFn: () => listPlans({ packageSessionId, size: SUMMARY_SIZE }),
        enabled: Boolean(packageSessionId),
    });
    const reload = () => void refetch();

    // A batch switch on the course page should not leave the previous batch's
    // composer open over the new one.
    useEffect(() => {
        setComposerOpen(false);
    }, [packageSessionId]);

    const { counts, current } = useMemo(() => summarizePlans(data?.plans ?? []), [data]);
    const total = data?.totalRows ?? data?.plans.length ?? 0;
    const shown = current.slice(0, SHOWN);
    const lookAlikes = lookAlikePlanIds(shown);
    const moreCurrent = current.length - shown.length;

    if (!packageSessionId) {
        return (
            <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-body text-neutral-600">
                {t('page.pickBatch')}
            </p>
        );
    }

    const countParts = SUMMARY_ORDER.filter((state) => counts[state] > 0).map((state) =>
        t(`tab.counts.${state}`, { count: counts[state] })
    );
    const pastCount = counts.ENDED + counts.ARCHIVED;
    if (pastCount > 0) countParts.push(t('tab.counts.PAST', { count: pastCount }));

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <h2 className="text-h3-semibold text-neutral-900">{t('page.tabTitle')}</h2>
                    <p className="mt-0.5 text-body text-neutral-600">{t('page.tabSubtitle')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        className="sm:min-w-0"
                        onClick={() => setAiOpen(true)}
                    >
                        <Sparkle size={16} aria-hidden /> {t('page.planWithAi')}
                    </MyButton>
                    <MyButton type="button" className="sm:min-w-0" onClick={() => openComposer()}>
                        <Plus size={16} aria-hidden /> {t('page.newPlan')}
                    </MyButton>
                </div>
            </div>

            {isLoading && (
                <div className="space-y-3" aria-busy>
                    <Skeleton className="h-12 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                </div>
            )}

            {/* Before the empty state: a failed load must not read as "nothing scheduled". */}
            {isError && !isLoading && (
                <Alert className="border-danger-200 bg-danger-50 text-danger-700">
                    <div className="flex flex-wrap items-center gap-3">
                        <WarningCircle size={18} className="shrink-0" aria-hidden />
                        <AlertDescription className="min-w-0 flex-1">
                            {t('page.loadError')}
                        </AlertDescription>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={reload}
                        >
                            <ArrowClockwise size={14} aria-hidden /> {t('common.retry')}
                        </MyButton>
                    </div>
                </Alert>
            )}

            {!isLoading && !isError && total === 0 && (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 p-8 text-center sm:p-10">
                    <CalendarPlus size={28} aria-hidden className="text-neutral-400" />
                    <div>
                        <p className="text-subtitle font-semibold text-neutral-900">
                            {t('page.nothingScheduled')}
                        </p>
                        <p className="mt-1 text-body text-neutral-600">
                            {t('page.nothingScheduledHint')}
                        </p>
                    </div>
                </div>
            )}

            {!isLoading && !isError && total > 0 && (
                <>
                    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                        <p className="text-body text-neutral-700">
                            {countParts.length > 0
                                ? countParts.join(' · ')
                                : t('tab.counts.total', { count: total })}
                        </p>
                        <Link
                            to="/engagement"
                            search={{ packageSessionId }}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md text-body font-semibold text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        >
                            {t('tab.openPlans')}
                            <ArrowRight size={14} aria-hidden className="rtl:rotate-180" />
                        </Link>
                    </div>

                    {shown.length === 0 ? (
                        <p className="text-body text-neutral-600">{t('tab.noCurrent')}</p>
                    ) : (
                        <ul className="space-y-3">
                            {shown.map((plan) => (
                                <li key={plan.id}>
                                    <PlanCard
                                        plan={plan}
                                        hideBatch
                                        showCreated={lookAlikes.has(plan.id)}
                                        onChanged={reload}
                                        onOpenPlan={(planId) => openComposer(planId)}
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                    {moreCurrent > 0 && (
                        <p className="text-caption text-neutral-600">
                            {t('tab.more', { count: moreCurrent })}
                        </p>
                    )}
                </>
            )}

            <AiPlanWizard
                open={aiOpen}
                onOpenChange={setAiOpen}
                onCreated={reload}
                defaultPackageSessionId={packageSessionId}
            />

            <PlanComposerDialog
                key={composerKey}
                open={composerOpen}
                onOpenChange={setComposerOpen}
                onCreated={reload}
                defaultPackageSessionId={packageSessionId}
                planId={composerPlanId}
            />
        </div>
    );
}
