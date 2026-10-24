import { cloneElement, useEffect, useMemo, useState, type ReactElement } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaretDown, Check, DownloadSimple, Funnel, WarningCircle, X } from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { StatusChip } from '@/components/design-system/status-chips';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getPublicUrls } from '@/services/upload_file';
import {
    downloadItemTrackingCsv,
    getEngagementPlan,
    getItemCardStats,
    getItemTracking,
} from '../-services/engagement-service';
import type { EngagementItemDTO, EngagementSlotDTO, OptionCount } from '../-types/types';
import {
    formatDay,
    formatNumber,
    formatPercent,
    formatSlotWindow,
    formatTimeRange,
    formatTime,
    instituteTimeZone,
    slotLastDate,
    todayInZone,
} from '../-utils/format';
import { typeMeta } from '../-utils/type-meta';
import { EngagementStat, type EngagementStatProps } from './shared/EngagementStat';
import {
    OptionDistribution,
    buildDistribution,
    optionLetter,
    parseQuestionPayload,
} from './tracking/OptionDistribution';
import { FlashcardCardStats } from './tracking/FlashcardCardStats';
import { AnswerReviewPanel } from './tracking/AnswerReviewPanel';
import {
    buildTrackingColumns,
    formatGameValue,
    fraction,
    formatShare,
    hardestCard,
    isReviewable,
    scoreSummary,
    trackingKind,
    type CardStatsData,
    type FileDetail,
    type TrackingData,
    type TrackingFilter,
    type TrackingKind,
    type TrackingRow,
} from './tracking/tracking-columns';

const PAGE_SIZE = 20;
/** The server's page cap: the option filter and the score summary read this many completions. */
const SUMMARY_SIZE = 200;
const ROOT = `${BASE_URL}/admin-core-service/engagement/admin/v1`;

/**
 * Fetches one page of tracking with a status filter. The shared `getItemTracking`
 * drops `status=ALL` (it predates the insight contract), and without it the server
 * returns attempts only, so the never-opened learners would be missing from "All".
 * Every other filter goes through the shared service.
 */
async function fetchTracking(
    itemId: string,
    filter: TrackingFilter,
    page: number,
    size: number
): Promise<TrackingData> {
    if (filter !== 'ALL') {
        return (await getItemTracking(itemId, page, size, { status: filter })) as TrackingData;
    }
    const { data } = await authenticatedAxiosInstance.get<TrackingData>(
        `${ROOT}/item/${itemId}/tracking`,
        { params: { instituteId: getInstituteId(), page, size, status: 'ALL' } }
    );
    return data;
}

function firstString(...values: unknown[]): string {
    for (const value of values) if (typeof value === 'string' && value) return value;
    return '';
}

/**
 * Resolved uploads by id, in one request per page of rows. Unresolved ids are left out.
 * media-service serialises FileDetailsDTO in snake_case (`file_name`, `file_type`);
 * camelCase is accepted too in case that ever changes.
 */
async function fetchFileDetails(ids: string[]): Promise<Record<string, FileDetail>> {
    const out: Record<string, FileDetail> = {};
    const details: unknown = await getPublicUrls(ids.join(','));
    if (!Array.isArray(details)) return out;
    for (const entry of details as Record<string, unknown>[]) {
        const id = typeof entry?.id === 'string' ? entry.id : '';
        if (!id) continue;
        out[id] = {
            id,
            url: firstString(entry.url),
            fileName: firstString(entry.file_name, entry.fileName),
            fileType: firstString(entry.file_type, entry.fileType),
        };
    }
    return out;
}

/** "23:55" now, on the plan's wall clock. */
function wallClockNow(timeZone: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(new Date());
    } catch {
        return '';
    }
}

function padTime(hhmm: string): string {
    const [h = '', m = ''] = hhmm.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0').slice(0, 2)}`;
}

type RevealState =
    | { kind: 'instant' }
    | { kind: 'out' }
    | { kind: 'today'; time: string }
    | { kind: 'on'; day: string; time: string }
    | { kind: 'daily'; time: string };

/**
 * Whether the slot's answers are out yet, on the plan's calendar. The reveal time only
 * holds results back when the task opts in (`hideResultUntilReveal`); otherwise a
 * learner sees the result as soon as they answer.
 */
function revealState(
    slot: EngagementSlotDTO,
    timeZone: string,
    holdsBack: boolean
): RevealState | null {
    if (!holdsBack) return { kind: 'instant' };
    if (!slot.revealTime) return null;
    // A join-based day reveals on each learner's own day: "each day at …".
    if (slot.startDay != null) return { kind: 'daily', time: slot.revealTime };
    const reveal = padTime(slot.revealTime);
    const today = todayInZone(timeZone);
    const last = slotLastDate(slot);
    const now = wallClockNow(timeZone);
    if (today > last || (today === last && now && now >= reveal)) return { kind: 'out' };
    if (last !== slot.startDate) return { kind: 'daily', time: slot.revealTime };
    if (today === slot.startDate) return { kind: 'today', time: slot.revealTime };
    return { kind: 'on', day: slot.startDate, time: slot.revealTime };
}

/**
 * Who did what on one task.
 *
 * - A caption line (type · format · day and window · when answers come out) and a
 *   collapsible "Question & answer key".
 * - A top section per type: poll and MCQ distributions, "Answers to read" for written
 *   and uploaded answers, average and median for games and flashcards.
 * - Done · Opened · Not done filters with counts, over every enrolled learner.
 * - A review panel with Prev / Next for written and uploaded answers.
 * - For flashcards, a Cards tab with every card's results.
 *
 * `slot` and `timezone` are optional: without them the dialog reads the plan (the same
 * query the plan card uses, so usually from cache) to find the task's day and zone.
 */
export function ItemTrackingDialog({
    item,
    open,
    onOpenChange,
    slot: slotProp,
    timezone: timezoneProp,
}: {
    item: EngagementItemDTO | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The task's day; read from the plan when absent. */
    slot?: EngagementSlotDTO | null;
    /** The plan's timezone; read from the plan when absent. */
    timezone?: string | null;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    // Radix Tabs stamps dir="ltr" on its root unless told otherwise.
    const dir = i18n.dir(lang);
    const itemId = item?.id ?? null;

    const [filter, setFilter] = useState<TrackingFilter>('ALL');
    const [optionFilter, setOptionFilter] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [tab, setTab] = useState<'learners' | 'cards'>('learners');
    const [keyOpen, setKeyOpen] = useState(false);
    const [reviewId, setReviewId] = useState<string | null>(null);
    const [pendingReview, setPendingReview] = useState<'first' | 'last' | null>(null);
    // Where a cross-page Prev / Next started, to return to if no answer lies that way.
    const [reviewOrigin, setReviewOrigin] = useState<{ page: number; userId: string } | null>(null);
    // The direction known to hold no more answers (later pages can be all "Not started").
    const [reviewEdge, setReviewEdge] = useState<'next' | 'prev' | null>(null);

    // Start clean for every task, and after closing, so a reopen never flashes old filters.
    useEffect(() => {
        setFilter('ALL');
        setOptionFilter(null);
        setPage(0);
        setTab('learners');
        setKeyOpen(false);
        setReviewId(null);
        setPendingReview(null);
        setReviewOrigin(null);
        setReviewEdge(null);
    }, [open, itemId]);

    const kind: TrackingKind = trackingKind(item);
    const question = useMemo(
        () => parseQuestionPayload(item?.payloadJson, item?.itemType),
        [item?.payloadJson, item?.itemType]
    );
    const gradable = kind === 'mcq' && Boolean(question.correctOptionId);
    const hasOptions = kind === 'mcq' || kind === 'poll';
    const readable = kind === 'text' || kind === 'upload';

    // ── Queries ──────────────────────────────────────────────────────────────

    const planQuery = useQuery({
        queryKey: ['engagement-plan', item?.planId],
        queryFn: () => getEngagementPlan(item!.planId),
        enabled: open && Boolean(item?.planId) && !(slotProp && timezoneProp),
        staleTime: 60_000,
    });
    const slot = slotProp ?? planQuery.data?.slots?.find((s) => s.id === item?.slotId) ?? null;
    const timeZone = timezoneProp || planQuery.data?.timezone || instituteTimeZone();
    // A days-after-joining slot stores placeholder dates (2000-01-0N); name its days instead.
    const slotCaption = !slot
        ? null
        : slot.startDay != null
          ? [
                (slot.endDay ?? slot.startDay) > slot.startDay
                    ? t('composer.relative.dayRange', { from: slot.startDay, to: slot.endDay })
                    : t('composer.relative.day', { n: slot.startDay }),
                formatTimeRange(slot.startTime, slot.endTime, lang),
            ].join(' · ')
          : formatSlotWindow(slot, lang, timeZone);

    const tablePage = optionFilter ? 0 : page;
    const trackingQuery = useQuery({
        queryKey: ['engagement-item-tracking', itemId, filter, tablePage],
        queryFn: () => fetchTracking(itemId!, filter, tablePage, PAGE_SIZE),
        enabled: open && Boolean(itemId),
        placeholderData: keepPreviousData,
    });
    const data = trackingQuery.data;
    // An older server ignores `status` and answers with attempts only (status null).
    const serverFilters = !data || data.status != null;

    // Every completion (up to the page cap): the option filter, game and flashcard
    // averages, and option counts on an older server that doesn't send them.
    const needsAllDone =
        Boolean(optionFilter) ||
        kind === 'game' ||
        kind === 'flashcards' ||
        (hasOptions && Boolean(data) && data?.optionCounts == null);
    const allDoneQuery = useQuery({
        queryKey: ['engagement-item-tracking', itemId, 'DONE', 'summary'],
        queryFn: () => fetchTracking(itemId!, 'DONE', 0, SUMMARY_SIZE),
        enabled: open && Boolean(itemId) && needsAllDone,
    });
    const completedRows = useMemo(
        () => (allDoneQuery.data?.rows ?? []).filter((r) => r.status === 'COMPLETED'),
        [allDoneQuery.data]
    );
    const summaryTruncated =
        (allDoneQuery.data?.totalRows ?? 0) > (allDoneQuery.data?.rows?.length ?? 0);

    const cardStatsQuery = useQuery({
        queryKey: ['engagement-item-card-stats', itemId],
        queryFn: async () => (await getItemCardStats(itemId!)) as CardStatsData,
        enabled: open && Boolean(itemId) && kind === 'flashcards',
    });

    // ── Rows on screen ───────────────────────────────────────────────────────

    const optionRows = useMemo(
        () =>
            optionFilter ? completedRows.filter((r) => r.selectedOptionId === optionFilter) : [],
        [completedRows, optionFilter]
    );
    const displayRows: TrackingRow[] = useMemo(
        () =>
            optionFilter
                ? optionRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                : data?.rows ?? [],
        [optionFilter, optionRows, page, data?.rows]
    );
    const totalRows = optionFilter ? optionRows.length : data?.totalRows ?? 0;
    const totalPages = optionFilter
        ? Math.max(1, Math.ceil(optionRows.length / PAGE_SIZE))
        : Math.max(1, data?.totalPages ?? 1);
    const tableLoading = optionFilter ? allDoneQuery.isLoading : trackingQuery.isLoading;
    const tableStale = optionFilter ? false : trackingQuery.isPlaceholderData;

    const fileIds = useMemo(() => {
        if (!readable) return [];
        const ids = new Set<string>();
        for (const row of displayRows) for (const id of row.fileIds ?? []) if (id) ids.add(id);
        return Array.from(ids).sort();
    }, [displayRows, readable]);
    const filesQuery = useQuery({
        queryKey: ['engagement-tracking-files', fileIds],
        queryFn: () => fetchFileDetails(fileIds),
        enabled: open && fileIds.length > 0,
        staleTime: 30 * 60_000,
    });
    const files = useMemo(() => filesQuery.data ?? {}, [filesQuery.data]);

    // ── Review panel ─────────────────────────────────────────────────────────

    const reviewable = useMemo(() => displayRows.filter(isReviewable), [displayRows]);
    // "All" lists attempts first and never-opened learners after them, so once a page
    // reaches a Not started row no later page holds an answer; Not done has none at all.
    const noAnswersAfterPage =
        !optionFilter &&
        (filter === 'NOT_DONE' ||
            (filter === 'ALL' && displayRows.some((r) => r.status === 'NOT_STARTED')));
    const reviewIndex = reviewId ? reviewable.findIndex((r) => r.userId === reviewId) : -1;
    const reviewRow = reviewIndex >= 0 ? reviewable[reviewIndex]! : null;

    useEffect(() => {
        if (!pendingReview || tableStale || tableLoading) return;
        if (reviewable.length > 0) {
            const next =
                pendingReview === 'first' ? reviewable[0]! : reviewable[reviewable.length - 1]!;
            setReviewId(next.userId);
            setPendingReview(null);
            setReviewOrigin(null);
        } else if (pendingReview === 'first' && page + 1 < totalPages && !noAnswersAfterPage) {
            setPage((p) => p + 1);
        } else if (pendingReview === 'last' && page > 0) {
            setPage((p) => p - 1);
        } else {
            // Nothing to read that way: go back to the answer the teacher was on.
            if (reviewOrigin) {
                setPage(reviewOrigin.page);
                setReviewId(reviewOrigin.userId);
            }
            setReviewEdge(pendingReview === 'first' ? 'next' : 'prev');
            setPendingReview(null);
            setReviewOrigin(null);
        }
    }, [
        pendingReview,
        tableStale,
        tableLoading,
        reviewable,
        page,
        totalPages,
        reviewOrigin,
        noAnswersAfterPage,
    ]);

    function openReview(row: TrackingRow) {
        if (!isReviewable(row)) return;
        setPendingReview(null);
        setReviewOrigin(null);
        setReviewEdge(null);
        setReviewId(row.userId);
    }
    function reviewNext() {
        if (reviewEdge === 'prev') setReviewEdge(null);
        if (reviewIndex >= 0 && reviewIndex < reviewable.length - 1) {
            setReviewId(reviewable[reviewIndex + 1]!.userId);
        } else if (page + 1 < totalPages && !noAnswersAfterPage) {
            setReviewOrigin(reviewRow ? { page, userId: reviewRow.userId } : null);
            setPendingReview('first');
            setPage((p) => p + 1);
        }
    }
    function reviewPrev() {
        if (reviewEdge === 'next') setReviewEdge(null);
        if (reviewIndex > 0) {
            setReviewId(reviewable[reviewIndex - 1]!.userId);
        } else if (page > 0) {
            setReviewOrigin(reviewRow ? { page, userId: reviewRow.userId } : null);
            setPendingReview('last');
            setPage((p) => p - 1);
        }
    }

    // ── Columns ──────────────────────────────────────────────────────────────

    const cardFronts = useMemo(() => {
        const map = new Map<string, string>();
        for (const card of cardStatsQuery.data?.cards ?? []) map.set(card.cardId, card.front);
        if (map.size === 0 && kind === 'flashcards') {
            try {
                const payload = JSON.parse(item?.payloadJson ?? '{}') as {
                    cards?: { id?: string; front?: string }[];
                };
                for (const card of payload.cards ?? []) {
                    if (card?.id) map.set(card.id, card.front ?? '');
                }
            } catch {
                // An unreadable deck: "Still learning" falls back to "Removed card".
            }
        }
        return map;
    }, [cardStatsQuery.data, item?.payloadJson, kind]);

    const columns = useMemo(
        () =>
            buildTrackingColumns({
                kind,
                t,
                lang,
                timeZone,
                options: question.options,
                gradable,
                maxScore: data?.maxScore ?? item?.maxScore ?? null,
                cardFronts,
                files,
                onReview: openReview,
            }),
        // openReview only sets state; it is stable in effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            kind,
            t,
            lang,
            timeZone,
            question.options,
            gradable,
            data?.maxScore,
            item?.maxScore,
            cardFronts,
            files,
        ]
    );

    // ── Counts ───────────────────────────────────────────────────────────────

    const enrolled = data?.enrolledCount ?? null;
    const done = data?.completedCount ?? 0;
    const opened = data?.startedCount ?? null;
    const notDone =
        data?.notDoneCount ??
        (enrolled != null && opened != null ? Math.max(0, enrolled - done - opened) : null);
    const late = data?.lateCount ?? 0;

    const optionCounts: OptionCount[] | null = useMemo(() => {
        if (!hasOptions) return null;
        if (data?.optionCounts) return data.optionCounts;
        if (!allDoneQuery.data) return null;
        const counts = new Map<string, number>();
        for (const row of completedRows) {
            if (row.selectedOptionId) {
                counts.set(row.selectedOptionId, (counts.get(row.selectedOptionId) ?? 0) + 1);
            }
        }
        return Array.from(counts, ([optionId, count]) => ({ optionId, count }));
    }, [hasOptions, data?.optionCounts, allDoneQuery.data, completedRows]);

    const distribution = useMemo(
        () =>
            buildDistribution(
                question.options,
                optionCounts,
                kind === 'mcq' ? question.correctOptionId : null
            ),
        [question.options, question.correctOptionId, optionCounts, kind]
    );

    const summary = useMemo(() => scoreSummary(completedRows, kind), [completedRows, kind]);
    const hardest = hardestCard(cardStatsQuery.data?.cards);

    const failed = trackingQuery.isError && !data;

    function chooseFilter(next: TrackingFilter) {
        setFilter(next);
        setOptionFilter(null);
        setPage(0);
        setReviewEdge(null);
    }
    function chooseOption(optionId: string | null) {
        setOptionFilter(optionId);
        setFilter(optionId ? 'DONE' : 'ALL');
        setPage(0);
        setReviewEdge(null);
    }

    async function handleExport() {
        if (!item) return;
        try {
            await downloadItemTrackingCsv(item.id, item.title);
        } catch {
            toast.error(t('tracking.exportError'));
        }
    }

    // ── Render ───────────────────────────────────────────────────────────────

    const meta = typeMeta(item?.itemType);
    const TypeIcon = meta.icon;
    // A written or uploaded answer has nothing to reveal unless the task holds back an
    // explanation (or opts into a reveal time), so "shown on submit" would only be noise.
    const holdsBack = item?.hideResultUntilReveal === true;
    const reveal =
        slot && (hasOptions || (readable && (holdsBack || Boolean(question.explanation))))
            ? revealState(slot, timeZone, holdsBack)
            : null;
    const revealWord = kind === 'poll' ? 'results' : 'answers';

    const selectedOption = optionFilter
        ? distribution.find((row) => row.id === optionFilter) ?? null
        : null;

    const footerSummary = data ? (
        <p className="text-body text-neutral-600" aria-live="polite">
            {enrolled != null && enrolled > 0
                ? t('tracking.footer.doneOf', {
                      done: fraction(done, enrolled, lang),
                      percent: formatPercent(done / enrolled, lang),
                  })
                : t('tracking.footer.done', { count: done, n: formatNumber(done, lang) })}
            {trackingQuery.isFetching && (
                <span className="text-neutral-400"> · {t('tracking.loading')}</span>
            )}
        </p>
    ) : (
        <span />
    );

    const filterValue: TrackingFilter = optionFilter ? 'DONE' : filter;
    const tableArea = (
        <div className="space-y-3">
            {selectedOption && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary-200 bg-primary-50 px-3 py-2 text-body text-neutral-800">
                    <Funnel size={16} className="shrink-0 text-primary-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                        {t('tracking.optionFilter', {
                            option: selectedOption.removed
                                ? t('tracking.distribution.removedOption')
                                : [selectedOption.letter, selectedOption.text]
                                      .filter(Boolean)
                                      .join(' · '),
                        })}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={() => chooseOption(null)}
                    >
                        <X size={14} aria-hidden="true" />
                        {t('tracking.clearFilter')}
                    </MyButton>
                </div>
            )}

            {failed ? (
                <Alert className="border-danger-200 bg-danger-50">
                    <WarningCircle size={18} className="text-danger-600" />
                    <AlertDescription className="space-y-3 text-danger-700">
                        <p>{t('tracking.loadError')}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={trackingQuery.isFetching}
                            onClick={() => void trackingQuery.refetch()}
                        >
                            {t('tracking.retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            ) : optionFilter && allDoneQuery.isError ? (
                <Alert className="border-danger-200 bg-danger-50">
                    <WarningCircle size={18} className="text-danger-600" />
                    <AlertDescription className="space-y-3 text-danger-700">
                        <p>{t('tracking.loadError')}</p>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={allDoneQuery.isFetching}
                            onClick={() => void allDoneQuery.refetch()}
                        >
                            {t('tracking.retry')}
                        </MyButton>
                    </AlertDescription>
                </Alert>
            ) : !tableLoading && totalRows === 0 ? (
                <EmptyRows
                    filter={optionFilter ? 'OPTION' : filter}
                    kind={kind}
                    legacy={!serverFilters}
                />
            ) : (
                <div
                    className={cn('transition-opacity', tableStale && 'opacity-60')}
                    aria-busy={tableStale || tableLoading}
                >
                    <MyTable<TrackingRow>
                        data={
                            tableLoading
                                ? undefined
                                : ({
                                      content: displayRows,
                                      total_pages: totalPages,
                                      page_no: page,
                                      page_size: PAGE_SIZE,
                                      total_elements: totalRows,
                                      last: page + 1 >= totalPages,
                                  } satisfies TableData<TrackingRow>)
                        }
                        columns={columns}
                        isLoading={tableLoading}
                        error={null}
                        currentPage={page}
                        enableColumnPinning={false}
                        onCellClick={readable ? (row) => openReview(row) : undefined}
                    />
                </div>
            )}

            {optionFilter && summaryTruncated && (
                <p className="text-caption text-neutral-500">
                    {t('tracking.summaryCapped', { n: formatNumber(SUMMARY_SIZE, lang) })}
                </p>
            )}

            {!failed && totalPages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={totalPages}
                    onPageChange={(next) => {
                        setPage(next);
                        setReviewEdge(null);
                    }}
                    totalElements={totalRows}
                    pageSize={PAGE_SIZE}
                />
            )}
        </div>
    );

    // With a server that filters, the filters are tabs and the table is the active
    // tab's panel; an older server gets the plain attempts table.
    const learnersPanel =
        serverFilters && data && !failed ? (
            <Tabs
                dir={dir}
                value={filterValue}
                onValueChange={(value) => chooseFilter(value as TrackingFilter)}
            >
                <TabsList
                    className="h-auto flex-wrap justify-start"
                    aria-label={t('tracking.filters.label')}
                >
                    <FilterTab value="ALL" label={t('tracking.filters.all')} />
                    <FilterTab value="DONE" label={t('tracking.filters.done')} count={done} />
                    <FilterTab
                        value="STARTED"
                        label={t('tracking.filters.opened')}
                        count={opened}
                    />
                    <FilterTab
                        value="NOT_DONE"
                        label={t('tracking.filters.notDone')}
                        count={notDone}
                    />
                    {late > 0 && (
                        <FilterTab value="LATE" label={t('tracking.filters.late')} count={late} />
                    )}
                </TabsList>
                <TabsContent value={filterValue} className="mt-3">
                    {tableArea}
                </TabsContent>
            </Tabs>
        ) : (
            tableArea
        );

    return (
        <>
            <MyDialog
                heading={item?.title ?? t('tracking.task')}
                open={open}
                onOpenChange={onOpenChange}
                dialogWidth="max-w-4xl"
                footerLeft={footerSummary}
                footer={
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disable={
                            !data || (data.completedCount === 0 && data.startedCount === 0)
                                ? true
                                : undefined
                        }
                        onAsyncClick={handleExport}
                        loadingText={t('tracking.preparing')}
                    >
                        <DownloadSimple size={16} aria-hidden="true" />
                        {t('tracking.export')}
                    </MyButton>
                }
            >
                {item && (
                    <div className="space-y-5">
                        {/* Caption: type · format · day and window · when answers come out. */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-neutral-600">
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium',
                                    meta.accent.soft
                                )}
                            >
                                <TypeIcon size={14} aria-hidden="true" />
                                {t(meta.labelKey)}
                            </span>
                            {question.format && item.itemType === 'QUESTION_OF_DAY' && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span>{t(`tracking.formats.${question.format}`)}</span>
                                </>
                            )}
                            {slot ? (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <span className="whitespace-nowrap">{slotCaption}</span>
                                </>
                            ) : planQuery.isLoading ? (
                                <Skeleton className="h-4 w-40" />
                            ) : null}
                            {reveal && (
                                <>
                                    <span aria-hidden="true">·</span>
                                    <StatusChip
                                        textSize="text-caption"
                                        status={reveal.kind === 'out' ? 'SUCCESS' : 'INFO'}
                                        showIcon={reveal.kind === 'out'}
                                        text={
                                            reveal.kind === 'instant'
                                                ? t(`tracking.reveal.${revealWord}Instant`)
                                                : reveal.kind === 'out'
                                                  ? t(`tracking.reveal.${revealWord}Out`)
                                                  : reveal.kind === 'daily'
                                                    ? t(`tracking.reveal.${revealWord}Daily`, {
                                                          time: formatTime(reveal.time, lang),
                                                      })
                                                    : reveal.kind === 'today'
                                                      ? t(`tracking.reveal.${revealWord}At`, {
                                                            time: formatTime(reveal.time, lang),
                                                        })
                                                      : t(`tracking.reveal.${revealWord}On`, {
                                                            day: formatDay(reveal.day, lang),
                                                            time: formatTime(reveal.time, lang),
                                                        })
                                        }
                                    />
                                </>
                            )}
                        </div>

                        <AnswerKey
                            kind={kind}
                            item={item}
                            open={keyOpen}
                            onOpenChange={setKeyOpen}
                        />

                        {/* Top section by type. */}
                        {hasOptions && !failed && (
                            <OptionDistribution
                                rows={distribution}
                                kind={kind === 'poll' ? 'poll' : 'mcq'}
                                respondents={done}
                                enrolled={enrolled}
                                selectedId={optionFilter}
                                onSelect={serverFilters ? chooseOption : undefined}
                                loading={!data || (optionCounts == null && allDoneQuery.isLoading)}
                            />
                        )}

                        {!failed && kind !== 'poll' && (
                            <StatTiles
                                kind={kind}
                                loading={!data}
                                done={done}
                                enrolled={enrolled}
                                opened={opened}
                                late={late}
                                correct={data?.correctCount ?? 0}
                                graded={data?.gradedCount ?? done}
                                gradable={gradable}
                                summary={summary}
                                summaryLoading={allDoneQuery.isLoading}
                                summaryCapped={summaryTruncated}
                                maxScore={data?.maxScore ?? item.maxScore ?? null}
                                hardestFront={hardest?.front ?? null}
                                hardestRate={hardest?.stillLearningRate ?? null}
                                hardestLoading={cardStatsQuery.isLoading}
                                onShowCards={
                                    kind === 'flashcards' && hardest
                                        ? () => setTab('cards')
                                        : undefined
                                }
                            />
                        )}

                        {kind === 'flashcards' ? (
                            <Tabs
                                dir={dir}
                                value={tab}
                                onValueChange={(value) => setTab(value as 'learners' | 'cards')}
                            >
                                <TabsList>
                                    <TabsTrigger value="learners">
                                        {t('tracking.tabs.learners')}
                                    </TabsTrigger>
                                    <TabsTrigger value="cards">
                                        {t('tracking.tabs.cards')}
                                    </TabsTrigger>
                                </TabsList>
                                <TabsContent value="learners" className="mt-3">
                                    {learnersPanel}
                                </TabsContent>
                                <TabsContent value="cards" className="mt-3">
                                    <FlashcardCardStats
                                        stats={cardStatsQuery.data}
                                        loading={cardStatsQuery.isLoading}
                                        error={cardStatsQuery.isError}
                                        retrying={cardStatsQuery.isFetching}
                                        onRetry={() => void cardStatsQuery.refetch()}
                                    />
                                </TabsContent>
                            </Tabs>
                        ) : (
                            <section className="space-y-3" aria-label={t('tracking.learnersTitle')}>
                                {kind === 'poll' && (
                                    <h3 className="text-subtitle font-semibold text-neutral-900">
                                        {t('tracking.whoVoted')}
                                    </h3>
                                )}
                                {learnersPanel}
                            </section>
                        )}
                    </div>
                )}
            </MyDialog>

            {readable && (
                <AnswerReviewPanel
                    open={open && (reviewId != null || pendingReview != null)}
                    onOpenChange={(next) => {
                        if (!next) {
                            setReviewId(null);
                            setPendingReview(null);
                        }
                    }}
                    row={pendingReview ? null : reviewRow}
                    position={reviewIndex + 1}
                    total={reviewable.length}
                    hasPrev={reviewIndex > 0 || (page > 0 && reviewEdge !== 'prev')}
                    hasNext={
                        (reviewIndex >= 0 && reviewIndex < reviewable.length - 1) ||
                        (page + 1 < totalPages && reviewEdge !== 'next' && !noAnswersAfterPage)
                    }
                    onPrev={reviewPrev}
                    onNext={reviewNext}
                    loading={pendingReview != null}
                    prompt={question.prompt}
                    files={files}
                    filesLoading={filesQuery.isLoading}
                    timeZone={timeZone}
                />
            )}
        </>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function FilterTab({
    value,
    label,
    count,
}: {
    value: TrackingFilter;
    label: string;
    count?: number | null;
}) {
    const { i18n } = useTranslation('engagement');
    return (
        <TabsTrigger value={value} className="gap-1.5">
            {label}
            {count != null && (
                <span className="rounded-full bg-neutral-200 px-1.5 text-caption tabular-nums text-neutral-700">
                    {formatNumber(count, i18n.language)}
                </span>
            )}
        </TabsTrigger>
    );
}

function EmptyRows({
    filter,
    kind,
    legacy,
}: {
    filter: TrackingFilter | 'OPTION';
    kind: TrackingKind;
    /** An older server that lists attempts only. */
    legacy: boolean;
}) {
    const { t } = useTranslation('engagement');
    const everyoneDone = filter === 'NOT_DONE';
    const key = legacy
        ? 'tracking.nobody'
        : filter === 'OPTION'
          ? kind === 'poll'
              ? 'tracking.empty.optionPoll'
              : 'tracking.empty.option'
          : `tracking.empty.${filter}`;
    return (
        <div
            className={cn(
                'flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center',
                everyoneDone ? 'border-success-200 bg-success-50' : 'border-neutral-300'
            )}
        >
            {everyoneDone && (
                <span className="flex size-8 items-center justify-center rounded-full bg-success-100 text-success-700">
                    <Check size={16} weight="bold" aria-hidden="true" />
                </span>
            )}
            <p className={cn('text-body', everyoneDone ? 'text-success-700' : 'text-neutral-500')}>
                {t(key)}
            </p>
        </div>
    );
}

function StatTiles({
    kind,
    loading,
    done,
    enrolled,
    opened,
    late,
    correct,
    graded,
    gradable,
    summary,
    summaryLoading,
    summaryCapped,
    maxScore,
    hardestFront,
    hardestRate,
    hardestLoading,
    onShowCards,
}: {
    kind: TrackingKind;
    loading: boolean;
    done: number;
    enrolled: number | null;
    opened: number | null;
    late: number;
    correct: number;
    graded: number;
    gradable: boolean;
    summary: ReturnType<typeof scoreSummary>;
    summaryLoading: boolean;
    summaryCapped: boolean;
    maxScore: number | null;
    hardestFront: string | null;
    hardestRate: number | null;
    hardestLoading: boolean;
    onShowCards?: () => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const cappedHint = summaryCapped
        ? t('tracking.stats.capped', { n: formatNumber(SUMMARY_SIZE, lang) })
        : undefined;

    const tiles: ReactElement<EngagementStatProps>[] = [
        <EngagementStat
            key="completed"
            label={t('tracking.completed')}
            value={
                enrolled != null && enrolled > 0
                    ? fraction(done, enrolled, lang)
                    : formatNumber(done, lang)
            }
            progress={enrolled != null && enrolled > 0 ? done / enrolled : null}
            progressLabel={
                enrolled != null && enrolled > 0
                    ? t('tracking.stats.completedLabel', {
                          percent: formatPercent(done / enrolled, lang),
                      })
                    : undefined
            }
            hint={
                late > 0
                    ? t('tracking.stats.late', { count: late, n: formatNumber(late, lang) })
                    : undefined
            }
            loading={loading}
        />,
    ];

    if (kind === 'mcq' && gradable) {
        tiles.push(
            <EngagementStat
                key="correct"
                label={t('tracking.correct')}
                value={formatNumber(correct, lang)}
                hint={
                    graded > 0
                        ? t('tracking.stats.accuracy', {
                              percent: formatPercent(correct / graded, lang),
                          })
                        : undefined
                }
                loading={loading}
            />
        );
    }
    if (kind === 'text' || kind === 'upload') {
        tiles.push(
            <EngagementStat
                key="toRead"
                label={t('tracking.answersToRead')}
                value={formatNumber(done, lang)}
                hint={t('tracking.stats.toReadHint')}
                loading={loading}
            />
        );
    }
    if (kind === 'game') {
        tiles.push(
            <EngagementStat
                key="average"
                label={t('tracking.stats.average')}
                value={formatGameValue(summary.average, maxScore, lang)}
                hint={cappedHint}
                loading={loading || summaryLoading}
            />,
            <EngagementStat
                key="median"
                label={t('tracking.stats.median')}
                value={formatGameValue(summary.median, maxScore, lang)}
                loading={loading || summaryLoading}
            />
        );
    }
    if (kind === 'flashcards') {
        tiles.push(
            <EngagementStat
                key="average"
                label={t('tracking.stats.averageKnown')}
                value={formatShare(summary.average, lang)}
                hint={cappedHint}
                loading={loading || summaryLoading}
            />,
            <EngagementStat
                key="median"
                label={t('tracking.stats.medianKnown')}
                value={formatShare(summary.median, lang)}
                loading={loading || summaryLoading}
            />,
            <EngagementStat
                key="hardest"
                label={t('tracking.stats.hardest')}
                value={
                    <span className="line-clamp-1 break-words text-body font-semibold">
                        {hardestFront ?? '—'}
                    </span>
                }
                hint={
                    hardestRate != null
                        ? t('tracking.stats.hardestHint', {
                              percent: formatPercent(hardestRate, lang),
                          })
                        : undefined
                }
                loading={hardestLoading}
                onClick={onShowCards}
            />
        );
    }
    if (kind === 'content' || (kind === 'mcq' && !gradable)) {
        tiles.push(
            <EngagementStat
                key="opened"
                label={t('tracking.stats.opened')}
                value={opened == null ? '—' : formatNumber(opened, lang)}
                hint={t('tracking.stats.openedHint')}
                loading={loading}
            />
        );
    }

    // Two across even on a phone, so four tiles don't push the table off screen; an odd
    // last tile spans the row until the wide layout fits them all on one line.
    return (
        <div
            className={cn(
                'grid gap-3',
                tiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
                tiles.length >= 4 ? 'lg:grid-cols-4' : tiles.length === 3 && 'lg:grid-cols-3'
            )}
        >
            {tiles.length > 1 && tiles.length % 2 === 1
                ? tiles.map((tile, index) =>
                      index === tiles.length - 1
                          ? cloneElement(tile, { className: 'col-span-2 lg:col-span-1' })
                          : tile
                  )
                : tiles}
        </div>
    );
}

/** The collapsible "Question & answer key" (or the deck, for flashcards). */
function AnswerKey({
    kind,
    item,
    open,
    onOpenChange,
}: {
    kind: TrackingKind;
    item: EngagementItemDTO;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const question = useMemo(
        () => parseQuestionPayload(item.payloadJson, item.itemType),
        [item.payloadJson, item.itemType]
    );
    const deck = useMemo(() => {
        if (kind !== 'flashcards') return [];
        try {
            const payload = JSON.parse(item.payloadJson ?? '{}') as {
                cards?: { id?: string; front?: string; back?: string }[];
            };
            return (payload.cards ?? []).filter((card) => card && card.id);
        } catch {
            return [];
        }
    }, [item.payloadJson, kind]);

    if (kind === 'game' || kind === 'content') return null;
    if (kind === 'flashcards' && deck.length === 0) return null;
    if (kind !== 'flashcards' && !question.prompt && question.options.length === 0) return null;

    const title =
        kind === 'flashcards'
            ? t('tracking.key.deck', { count: deck.length, n: formatNumber(deck.length, lang) })
            : kind === 'poll'
              ? t('tracking.key.poll')
              : kind === 'mcq' && question.correctOptionId
                ? t('tracking.key.questionAndKey')
                : t('tracking.key.question');

    return (
        <Collapsible
            open={open}
            onOpenChange={onOpenChange}
            className="rounded-lg border border-neutral-200"
        >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-start text-body font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                {title}
                <CaretDown
                    size={16}
                    className={cn(
                        'shrink-0 text-neutral-500 transition-transform',
                        open && 'rotate-180'
                    )}
                    aria-hidden="true"
                />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t border-neutral-200 px-4 py-3">
                {kind === 'flashcards' ? (
                    <ol className="max-h-72 space-y-2 overflow-y-auto">
                        {deck.map((card, index) => (
                            <li key={card.id} className="flex gap-3 text-body">
                                <span className="w-6 shrink-0 text-end tabular-nums text-neutral-400">
                                    {formatNumber(index + 1, lang)}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block break-words font-medium text-neutral-900">
                                        {card.front}
                                    </span>
                                    <span className="block break-words text-neutral-600">
                                        {card.back}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <>
                        {question.prompt && (
                            <p className="whitespace-pre-wrap break-words text-body text-neutral-900">
                                {question.prompt}
                            </p>
                        )}
                        {question.options.length > 0 && (kind === 'mcq' || kind === 'poll') && (
                            <ul className="space-y-1.5">
                                {question.options.map((option, index) => {
                                    const correct =
                                        kind === 'mcq' && option.id === question.correctOptionId;
                                    return (
                                        <li
                                            key={option.id}
                                            className={cn(
                                                'flex items-start gap-2 rounded-md px-2 py-1 text-body',
                                                correct
                                                    ? 'bg-success-50 text-success-700'
                                                    : 'text-neutral-700'
                                            )}
                                        >
                                            <span className="w-5 shrink-0 font-semibold">
                                                {optionLetter(index)}
                                            </span>
                                            <span className="min-w-0 flex-1 break-words">
                                                {option.text}
                                            </span>
                                            {correct && (
                                                <span className="inline-flex shrink-0 items-center gap-1 text-caption font-medium">
                                                    <Check
                                                        size={14}
                                                        weight="bold"
                                                        aria-hidden="true"
                                                    />
                                                    {t('tracking.distribution.correct')}
                                                </span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {question.explanation && (
                            <div className="space-y-0.5">
                                <p className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                                    {t('tracking.key.explanation')}
                                </p>
                                <p className="whitespace-pre-wrap break-words text-body text-neutral-700">
                                    {question.explanation}
                                </p>
                            </div>
                        )}
                    </>
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}
