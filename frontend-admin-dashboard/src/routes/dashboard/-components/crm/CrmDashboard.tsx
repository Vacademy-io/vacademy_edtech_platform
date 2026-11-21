import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Icon } from '@phosphor-icons/react';
import {
    ArrowClockwise,
    ChartLineUp,
    ListChecks,
    MagnifyingGlass,
    Megaphone,
    PhoneCall,
    SquaresFour,
    UsersThree,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CRM_DASHBOARD_WIDGET_IDS, type CrmDashboardWidgetId } from '../../-utils/crm-widgets';
import FinanceSummaryWidget from '../FinanceSummaryWidget';
import { useAttentionItems } from './attention-items';
import { useNavSnapshotStore } from '@/lib/capabilities/use-entitlement';
import { PlatformNotices, useDashboardWidgetVisibility } from './BusinessWidgets';
import {
    fetchCrmDashboard,
    isEmptyBlock,
    type CrmBlockId,
    type CrmCallsBlock,
    type CrmCounsellorRow,
    type CrmDashboardBlocks,
    type CrmDashboardResponse,
    type CrmFollowupsBlock,
    type CrmListRow,
    type CrmPipelineBlock,
    type CrmQualityBlock,
    type CrmSourceRow,
    type CrmSummaryBlock,
} from '../../-services/crm-dashboard';
import {
    buildCrmWindow,
    buildInsights,
    CRM_RANGE_OPTIONS,
    pipelineStages,
    type CrmRangeDays,
    type CrmWindow,
} from '../../-utils/crm-dashboard';
import {
    AttentionCard,
    CallsCard,
    CounsellorsCard,
    CrmHero,
    CrmLink,
    FollowupHealthCard,
    InsightsRow,
    KpiRow,
    LeaderboardCard,
    ListsCard,
    PipelineCard,
    QualityCard,
    SourcesCard,
    TodayStrip,
} from './crm-cards';

const NS = 'crmDashboard';
const STALE_MS = 5 * 60 * 1000;

/** Which server blocks each card needs; a hidden card's blocks are never requested. */
const WIDGET_BLOCKS: Record<CrmDashboardWidgetId, CrmBlockId[]> = {
    quickActions: [],
    hero: ['summary'],
    today: ['followups', 'summary'],
    kpis: ['summary', 'followups'],
    insights: ['summary', 'followups', 'sources', 'counsellors'],
    pipeline: ['pipeline'],
    sources: ['sources'],
    followups: ['followups', 'counsellors'],
    attention: ['followups', 'counsellors', 'summary', 'lists'],
    counsellors: ['counsellors'],
    calls: ['calls'],
    lists: ['lists'],
    quality: ['quality'],
    money: [],
};
/** Loaded with the first paint; the rest waits until the lower half scrolls into view. */
const FIRST_PAINT: CrmBlockId[] = ['summary', 'followups', 'pipeline', 'sources', 'counsellors'];

/** A block, or undefined when it was not requested, failed, or the caller can see nothing in it. */
function pick<T>(blocks: CrmDashboardBlocks | undefined, id: CrmBlockId): T | undefined {
    const b = blocks?.[id];
    return b === undefined || isEmptyBlock(b) ? undefined : (b as T);
}

function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
    const ref = useRef<T>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        if (seen || !ref.current) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) setSeen(true);
            },
            { rootMargin: '300px' }
        );
        io.observe(ref.current);
        return () => io.disconnect();
    }, [seen]);
    return [ref, seen];
}

const statusOf = (error: unknown): number | undefined =>
    (error as { response?: { status?: number } } | null)?.response?.status;
/** Responses that mean "keep the existing dashboard": not CRM staff, or the API is not live yet. */
const UNAVAILABLE = new Set([403, 404]);

function useCrmBlocks(
    window: CrmWindow,
    blocks: CrmBlockId[],
    enabled: boolean,
    refreshCount: number
): {
    data?: CrmDashboardResponse;
    isLoading: boolean;
    isError: boolean;
    unavailable: boolean;
    refetch: () => void;
} {
    const instituteId = getCurrentInstituteId() || '';
    const q = useQuery({
        // Keyed on the calendar days, not the exact minute: coming back to the page within
        // a few minutes reuses the answer. Refresh bumps refreshCount for a new request.
        // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the minute-level window fields are left out on purpose
        queryKey: [
            'crm-dashboard',
            instituteId,
            window.fromDay,
            window.toDay,
            blocks,
            refreshCount,
        ],
        queryFn: () =>
            fetchCrmDashboard({
                institute_id: instituteId,
                from: window.from,
                to: window.to,
                timezone: window.timezone,
                now: window.now,
                today_end: window.todayEnd,
                blocks,
            }),
        enabled: enabled && !!instituteId && blocks.length > 0,
        staleTime: STALE_MS,
        refetchOnWindowFocus: false,
        // A 403 (not institute staff) or 404 (API not deployed yet) will not change on retry.
        retry: (count, error) => !UNAVAILABLE.has(statusOf(error) ?? 0) && count < 1,
    });
    return {
        data: q.data,
        isLoading: q.isLoading && q.fetchStatus !== 'idle',
        isError: q.isError,
        unavailable: UNAVAILABLE.has(statusOf(q.error) ?? 0),
        refetch: q.refetch,
    };
}

function CardSkeleton({ className }: { className?: string }) {
    return <Skeleton className={cn('h-64 rounded-xl', className)} />;
}

function minutesAgo(iso?: string): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000));
}

export function CrmDashboard({
    displayName,
    fallback,
}: {
    displayName?: string;
    /** Shown instead when the CRM Dashboard refuses this person (403). */
    fallback?: React.ReactNode;
}) {
    const { t } = useTranslation(NS);
    const [rangeDays, setRangeDays] = useState<CrmRangeDays>(30);
    // Recomputed only when the range changes or Refresh is pressed, so the query key is stable.
    const [stamp, setStamp] = useState(() => Date.now());
    const [refreshCount, setRefreshCount] = useState(0);
    const refresh = () => {
        setStamp(Date.now());
        setRefreshCount((n) => n + 1);
    };
    const window = useMemo(() => buildCrmWindow(rangeDays, new Date(stamp)), [rangeDays, stamp]);

    const visible = CRM_DASHBOARD_WIDGET_IDS;

    const needed = useMemo(() => {
        const s = new Set<CrmBlockId>();
        visible.forEach((id) => WIDGET_BLOCKS[id].forEach((b) => s.add(b)));
        return s;
    }, [visible]);
    const firstBlocks = FIRST_PAINT.filter((b) => needed.has(b));
    const laterBlocks = (['calls', 'lists', 'quality'] as CrmBlockId[]).filter((b) =>
        needed.has(b)
    );

    const [lowerRef, lowerInView] = useInView<HTMLDivElement>();
    const first = useCrmBlocks(window, firstBlocks, true, refreshCount);
    const later = useCrmBlocks(window, laterBlocks, lowerInView, refreshCount);

    const blocks = { ...first.data?.blocks, ...later.data?.blocks };
    const errors = { ...first.data?.errors, ...later.data?.errors };
    const summary = pick<CrmSummaryBlock>(blocks, 'summary');
    const followups = pick<CrmFollowupsBlock>(blocks, 'followups');
    const pipeline = pick<CrmPipelineBlock>(blocks, 'pipeline');
    const sources = pick<CrmSourceRow[]>(blocks, 'sources');
    const counsellors = pick<{ rows: CrmCounsellorRow[] }>(blocks, 'counsellors')?.rows;
    const calls = pick<CrmCallsBlock>(blocks, 'calls');
    const lists = pick<CrmListRow[]>(blocks, 'lists');
    const quality = pick<CrmQualityBlock>(blocks, 'quality');
    const isAdmin = first.data?.admin === true;
    const widgetVisibility = useDashboardWidgetVisibility();
    const nothingVisible = Object.values(blocks).some((b) => isEmptyBlock(b));

    const insights = useMemo(
        () => buildInsights({ summary, followups, sources, counsellors }),
        [summary, followups, sources, counsellors]
    );

    const attention = useAttentionItems({ followups, counsellors, summary, lists, window });

    const updated = minutesAgo(first.data?.generated_at);
    const blockFailed = (id: CrmBlockId) => !!errors[id];

    const rangeControl = (
        <div className="flex rounded-lg border border-neutral-200 bg-white p-0.5">
            {CRM_RANGE_OPTIONS.map((d) => (
                <button
                    key={d}
                    type="button"
                    onClick={() => setRangeDays(d)}
                    className={cn(
                        'rounded-md px-3 py-1 font-medium transition-colors',
                        rangeDays === d
                            ? 'bg-primary-500 text-white'
                            : 'text-neutral-600 hover:bg-neutral-100'
                    )}
                >
                    <span className="text-caption">{t('range.days', { count: d })}</span>
                </button>
            ))}
        </div>
    );

    // Only shortcuts this person's sidebar offers (unlocked), so none lands on a locked page.
    const navSnapshot = useNavSnapshotStore((s) => s.snapshot);
    const openPaths = useMemo(() => {
        const set = new Set<string>();
        (navSnapshot?.items ?? []).forEach((item) => {
            if (item.locked) return;
            if (item.to) set.add(item.to.split('?')[0]!);
            (item.subItems ?? []).forEach((sub) => {
                if (!sub.locked && sub.subItemLink) set.add(sub.subItemLink.split('?')[0]!);
            });
        });
        return set;
    }, [navSnapshot]);
    const allQuickActions: Array<[string, Icon, string]> = [
        ['recentLeads', UsersThree, '/audience-manager/recent-leads'],
        ['checkLead', MagnifyingGlass, '/audience-manager/lead-lookup'],
        ['followUps', ListChecks, '/audience-manager/follow-ups?bucket=today'],
        ['callLog', PhoneCall, '/audience-manager/call-log'],
        ['leadLists', SquaresFour, '/audience-manager/list'],
        ['reports', ChartLineUp, '/audience-manager/reports'],
        ['announce', Megaphone, '/announcement/create'],
    ];
    const quickActions = navSnapshot
        ? allQuickActions.filter(([, , href]) => openPaths.has(href.split('?')[0]!))
        : allQuickActions;

    const sections: Record<CrmDashboardWidgetId, React.ReactNode> = {
        quickActions: (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
                {quickActions.map(([key, I, href]) => (
                    <CrmLink
                        key={key}
                        href={href}
                        className="flex flex-col items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-center transition-shadow hover:border-primary-300 hover:shadow-md"
                    >
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <I size={18} weight="duotone" />
                        </span>
                        <span className="font-medium text-neutral-700">
                            <span className="text-caption">{t(`quick.${key}`)}</span>
                        </span>
                    </CrmLink>
                ))}
            </div>
        ),
        hero: summary ? (
            <CrmHero
                summary={summary}
                window={window}
                rangeDays={rangeDays}
                rangeControl={rangeControl}
                actions={
                    <MyButton buttonType="secondary" scale="small" onClick={refresh}>
                        <ArrowClockwise size={14} />
                        {t('common.refresh')}
                    </MyButton>
                }
            />
        ) : first.isLoading ? (
            <CardSkeleton className="h-52" />
        ) : null,
        today: <TodayStrip followups={followups} summary={summary} calls={calls} window={window} />,
        kpis: <KpiRow summary={summary} followups={followups} window={window} />,
        insights: <InsightsRow insights={insights} />,
        pipeline: pipeline ? (
            <PipelineCard
                stages={pipelineStages(pipeline, t('pipeline.noStatus'))}
                window={window}
            />
        ) : blockFailed('pipeline') ? null : first.isLoading ? (
            <CardSkeleton />
        ) : null,
        sources: sources ? (
            <SourcesCard rows={sources} />
        ) : first.isLoading ? (
            <CardSkeleton />
        ) : null,
        followups: followups ? (
            <FollowupHealthCard followups={followups} counsellors={counsellors} />
        ) : first.isLoading ? (
            <CardSkeleton />
        ) : null,
        attention: first.data ? (
            <AttentionCard items={attention} />
        ) : first.isLoading ? (
            <CardSkeleton />
        ) : null,
        counsellors: counsellors ? (
            <div className="grid gap-4 xl:grid-cols-3">
                <div className="min-w-0 xl:col-span-2">
                    <CounsellorsCard rows={counsellors} />
                </div>
                <LeaderboardCard rows={counsellors} />
            </div>
        ) : first.isLoading ? (
            <CardSkeleton />
        ) : null,
        calls: calls ? <CallsCard calls={calls} /> : later.isLoading ? <CardSkeleton /> : null,
        lists: lists ? <ListsCard rows={lists} /> : later.isLoading ? <CardSkeleton /> : null,
        quality: quality ? (
            <QualityCard block={quality} />
        ) : later.isLoading ? (
            <CardSkeleton />
        ) : null,
        money:
            isAdmin && widgetVisibility.visible('financeSummary') ? (
                <FinanceSummaryWidget instituteId={getCurrentInstituteId() || ''} />
            ) : null,
    };

    // Cards that sit side by side. The pipeline list is the tallest card, so the middle
    // of the page is two independent columns (each card keeps its own height) instead
    // of rows, and the short sources card does not leave a gap next to it.
    const COLUMNS: { left: CrmDashboardWidgetId[]; right: CrmDashboardWidgetId[] } = {
        left: ['pipeline', 'followups'],
        right: ['sources', 'attention'],
    };
    const PAIRS: Array<[CrmDashboardWidgetId, CrmDashboardWidgetId]> = [['calls', 'quality']];
    const rendered = new Set<CrmDashboardWidgetId>();
    const lowerStart = visible.findIndex(
        (id) => id === 'calls' || id === 'lists' || id === 'quality'
    );

    // Not institute staff for the CRM (e.g. a counsellor who also holds the learner
    // role), or the dashboard API is not deployed yet: keep their existing dashboard
    // instead of an error card.
    if (first.unavailable && fallback) return <>{fallback}</>;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="font-semibold text-neutral-900">
                        <span className="text-h2">
                            {displayName
                                ? t('header.greeting', { name: displayName })
                                : t('header.title')}
                        </span>
                    </h1>
                    <p className="text-neutral-500">
                        <span className="text-body">
                            {isAdmin ? t('header.subtitleAdmin') : t('header.subtitleScoped')}
                        </span>
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {updated !== null && (
                        <span className="text-neutral-500">
                            <span className="text-caption">
                                {t('header.updated', { count: updated })}
                            </span>
                        </span>
                    )}
                </div>
            </div>

            <PlatformNotices />

            {first.isError && (
                <Card className="rounded-xl border-danger-100 bg-danger-50 p-4 text-danger-600">
                    <span className="text-body">{t('common.loadFailed')}</span>{' '}
                    <MyButton buttonType="text" scale="small" onClick={() => first.refetch()}>
                        {t('common.retry')}
                    </MyButton>
                </Card>
            )}
            {nothingVisible && (
                <Card className="rounded-xl border-neutral-200 p-4 text-neutral-600">
                    <span className="text-body">{t('common.noAccess')}</span>
                </Card>
            )}

            {visible.map((id, i) => {
                if (rendered.has(id)) return null;
                rendered.add(id);
                if ([...COLUMNS.left, ...COLUMNS.right].includes(id)) {
                    [...COLUMNS.left, ...COLUMNS.right].forEach((c) => rendered.add(c));
                    const column = (ids: CrmDashboardWidgetId[]) =>
                        ids.map((c) => (
                            <div key={c} className="min-w-0">
                                {sections[c]}
                            </div>
                        ));
                    return (
                        <div key={id} className="grid items-start gap-4 xl:grid-cols-2">
                            <div className="flex min-w-0 flex-col gap-4">
                                {column(COLUMNS.left)}
                            </div>
                            <div className="flex min-w-0 flex-col gap-4">
                                {column(COLUMNS.right)}
                            </div>
                        </div>
                    );
                }
                const pair = PAIRS.find(([a, b]) => a === id || b === id);
                const partner = pair ? (pair[0] === id ? pair[1] : pair[0]) : null;
                const marker = i === lowerStart ? <div ref={lowerRef} /> : null;
                if (partner && !rendered.has(partner)) {
                    rendered.add(partner);
                    return (
                        <div key={id}>
                            {marker}
                            <div className="grid gap-4 xl:grid-cols-2">
                                <div className="min-w-0">{sections[id]}</div>
                                <div className="min-w-0">{sections[partner]}</div>
                            </div>
                        </div>
                    );
                }
                return (
                    <div key={id} className="min-w-0">
                        {marker}
                        {sections[id]}
                    </div>
                );
            })}
            {lowerStart < 0 && <div ref={lowerRef} />}
        </div>
    );
}
