import { createLazyFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    CalendarPlus,
    GearSix,
    MagnifyingGlass,
    Plus,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { listPlans } from './-services/engagement-service';
import type { EngagementPlanRequest, PlanListSort } from './-types/types';
import { AiPlanWizard } from '@/routes/engagement/-components/AiPlanWizard';
import { PlanComposerDialog } from './-components/PlanComposerDialog';
import { PlanCard, lookAlikePlanIds } from './-components/PlanCard';
import {
    DEFAULT_LIFECYCLE_FILTER,
    PlanListToolbar,
    isLifecycleFilter,
    lifecycleStatuses,
    type LifecycleFilter,
} from './-components/list/PlanListToolbar';

const routeApi = getRouteApi('/engagement/');

export const Route = createLazyFileRoute('/engagement/')({
    component: EngagementPlans,
});

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** What the page-level composer opens with: a new plan, an existing one, or a draft. */
interface ComposerTarget {
    /** Bumped on every open so the composer mounts fresh (nothing carried over). */
    key: number;
    planId?: string | null;
    draft?: EngagementPlanRequest | null;
}

/** Daily engagement plans: what learners are shown, and when, for every batch. */
function EngagementPlans() {
    const { t } = useTranslation('engagement');
    const navigate = useNavigate();
    const { packageSessionId } = routeApi.useSearch();
    const { setNavHeading } = useNavHeadingStore();

    const [composerOpen, setComposerOpen] = useState(false);
    const [composer, setComposer] = useState<ComposerTarget>({ key: 0 });
    const openComposer = useCallback((target: Omit<ComposerTarget, 'key'> = {}) => {
        setComposer((prev) => ({ key: prev.key + 1, ...target }));
        setComposerOpen(true);
    }, []);
    const [aiOpen, setAiOpen] = useState(false);

    const [lifecycle, setLifecycle] = useState<LifecycleFilter>(DEFAULT_LIFECYCLE_FILTER);
    const [search, setSearch] = useState('');
    const [q, setQ] = useState('');
    const [sort, setSort] = useState<PlanListSort>('CREATED');
    // The page belongs to one set of filters: any filter change starts again at page 1,
    // without first fetching the old page number under the new filters.
    const filterKey = JSON.stringify([packageSessionId ?? '', lifecycle, q, sort]);
    const [paging, setPaging] = useState({ filterKey, page: 0 });
    const page = paging.filterKey === filterKey ? paging.page : 0;
    const setPage = useCallback(
        (next: number) => setPaging({ filterKey, page: Math.max(0, next) }),
        [filterKey]
    );

    useEffect(() => {
        setNavHeading(t('page.title'));
    }, [setNavHeading, t]);

    useEffect(() => {
        const timer = window.setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [search]);

    const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } = useQuery({
        queryKey: ['engagement-plans', { packageSessionId, lifecycle, q, sort, page }],
        queryFn: () =>
            listPlans({
                packageSessionId,
                status: lifecycleStatuses(lifecycle),
                q: q || undefined,
                sort,
                page,
                size: PAGE_SIZE,
            }),
        placeholderData: keepPreviousData,
    });

    const plans = useMemo(() => data?.plans ?? [], [data]);
    const lookAlikes = useMemo(() => lookAlikePlanIds(plans), [plans]);
    // The batch chip's name comes from the plans; remember it so a filter that empties
    // the list does not turn it into "This batch".
    const [knownBatch, setKnownBatch] = useState<{ id: string; label: string } | null>(null);
    const listedBatchLabel = packageSessionId
        ? plans.find((plan) => plan.packageSessionId === packageSessionId)?.packageSessionLabel
        : undefined;
    useEffect(() => {
        if (packageSessionId && listedBatchLabel) {
            setKnownBatch({ id: packageSessionId, label: listedBatchLabel });
        }
    }, [packageSessionId, listedBatchLabel]);
    const batchName =
        listedBatchLabel ??
        (knownBatch && knownBatch.id === packageSessionId ? knownBatch.label : undefined);
    const totalPages = Math.max(1, data?.totalPages ?? 1);

    // Removing the last plan on the last page would leave an empty page behind.
    useEffect(() => {
        if (data && !isPlaceholderData && page > 0 && page >= totalPages) setPage(totalPages - 1);
    }, [data, isPlaceholderData, page, totalPages, setPage]);
    const totalRows = data?.totalRows ?? plans.length;
    const filtered = lifecycle !== DEFAULT_LIFECYCLE_FILTER || Boolean(q);
    const reload = () => void refetch();

    const setBatch = (next: string | undefined) =>
        void navigate({
            to: '/engagement',
            search: { packageSessionId: next },
        });

    const clearFilters = () => {
        setLifecycle(DEFAULT_LIFECYCLE_FILTER);
        setSearch('');
        setQ('');
    };

    return (
        <LayoutContainer>
            <div className="space-y-6 p-4 sm:p-6">
                <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-h2-semibold text-neutral-900">{t('page.title')}</h1>
                        <p className="mt-1 max-w-2xl text-body text-neutral-600">
                            {t('page.subtitle')}
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {/* Icon-only on phones, so the three actions fit on one row. */}
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            className="w-9 px-0 sm:w-auto sm:min-w-0 sm:px-3"
                            aria-label={t('page.settings')}
                            onClick={() =>
                                void navigate({
                                    to: '/settings',
                                    search: { selectedTab: 'engagement' },
                                })
                            }
                        >
                            <GearSix size={16} aria-hidden />
                            <span className="hidden sm:inline">{t('page.settings')}</span>
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            className="sm:min-w-0"
                            onClick={() => setAiOpen(true)}
                        >
                            <Sparkle size={16} aria-hidden /> {t('page.planWithAi')}
                        </MyButton>
                        <MyButton
                            type="button"
                            className="sm:min-w-0"
                            onClick={() => openComposer()}
                        >
                            <Plus size={16} aria-hidden /> {t('page.newPlan')}
                        </MyButton>
                    </div>
                </header>

                <Tabs
                    value={lifecycle}
                    onValueChange={(value) => {
                        if (isLifecycleFilter(value)) setLifecycle(value);
                    }}
                    className="space-y-4"
                >
                    <PlanListToolbar
                        packageSessionId={packageSessionId}
                        batchName={batchName}
                        onBatchChange={setBatch}
                        search={search}
                        onSearchChange={setSearch}
                        sort={sort}
                        onSortChange={setSort}
                    />

                    <TabsContent value={lifecycle} className="mt-0 space-y-4 focus-visible:ring-0">
                        <h2 className="sr-only">{t('list.heading')}</h2>

                        {isLoading && (
                            <div className="space-y-3" aria-busy>
                                {[0, 1, 2].map((n) => (
                                    <Skeleton key={n} className="h-24 w-full rounded-lg" />
                                ))}
                            </div>
                        )}

                        {/* Before the empty state: a failed load must not read as "no plans". */}
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

                        {!isLoading && !isError && plans.length === 0 && (
                            <EmptyState
                                filtered={filtered}
                                forBatch={Boolean(packageSessionId)}
                                onClear={clearFilters}
                                onNew={() => openComposer()}
                                onAi={() => setAiOpen(true)}
                            />
                        )}

                        {!isError && plans.length > 0 && (
                            <>
                                <p className="text-caption text-neutral-600" aria-live="polite">
                                    {t('list.count', { count: totalRows })}
                                </p>
                                <ul
                                    className={
                                        isFetching && isPlaceholderData
                                            ? 'space-y-3 opacity-60 transition-opacity'
                                            : 'space-y-3 transition-opacity'
                                    }
                                    aria-busy={isFetching || undefined}
                                >
                                    {plans.map((plan) => (
                                        <li key={plan.id}>
                                            <PlanCard
                                                plan={plan}
                                                hideBatch={Boolean(packageSessionId)}
                                                showCreated={lookAlikes.has(plan.id)}
                                                onChanged={reload}
                                                onOpenPlan={(planId) => openComposer({ planId })}
                                            />
                                        </li>
                                    ))}
                                </ul>
                                {totalPages > 1 && (
                                    <MyPagination
                                        currentPage={page}
                                        totalPages={totalPages}
                                        onPageChange={setPage}
                                    />
                                )}
                            </>
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            <AiPlanWizard
                open={aiOpen}
                onOpenChange={setAiOpen}
                onCreated={reload}
                defaultPackageSessionId={packageSessionId}
            />

            <PlanComposerDialog
                key={composer.key}
                open={composerOpen}
                onOpenChange={setComposerOpen}
                onCreated={reload}
                defaultPackageSessionId={packageSessionId}
                planId={composer.planId ?? null}
                draft={composer.draft ?? null}
            />
        </LayoutContainer>
    );
}

function EmptyState({
    filtered,
    forBatch,
    onClear,
    onNew,
    onAi,
}: {
    filtered: boolean;
    forBatch: boolean;
    onClear: () => void;
    onNew: () => void;
    onAi: () => void;
}) {
    const { t } = useTranslation('engagement');
    if (filtered) {
        return (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 p-8 text-center sm:p-10">
                <MagnifyingGlass size={28} aria-hidden className="text-neutral-400" />
                <div>
                    <p className="text-subtitle font-semibold text-neutral-900">
                        {t('list.emptyFiltered')}
                    </p>
                    <p className="mt-1 text-body text-neutral-600">{t('list.emptyFilteredHint')}</p>
                </div>
                <MyButton type="button" buttonType="secondary" onClick={onClear}>
                    {t('list.clearFilters')}
                </MyButton>
            </div>
        );
    }
    return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 p-8 text-center sm:p-10">
            <CalendarPlus size={28} aria-hidden className="text-neutral-400" />
            <div>
                <p className="text-subtitle font-semibold text-neutral-900">
                    {forBatch ? t('list.emptyBatch') : t('page.noPlans')}
                </p>
                <p className="mt-1 text-body text-neutral-600">{t('list.emptyHint')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
                <MyButton type="button" buttonType="secondary" onClick={onAi}>
                    <Sparkle size={16} aria-hidden /> {t('page.planWithAi')}
                </MyButton>
                <MyButton type="button" onClick={onNew}>
                    <Plus size={16} aria-hidden /> {t('page.newPlan')}
                </MyButton>
            </div>
        </div>
    );
}
