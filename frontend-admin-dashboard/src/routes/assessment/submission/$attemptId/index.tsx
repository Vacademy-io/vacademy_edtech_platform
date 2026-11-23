import { useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaretLeft, FileText } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MyButton } from '@/components/design-system/button';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { cn } from '@/lib/utils';
import { getQuestionsDataForStep2 } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import {
    getEvaluationProgress,
    getLayoutMap,
    type EvaluationProgress,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import type { LayoutMap } from '@/routes/assessment/evaluation-ai/$attemptId/$processId/-components/PdfAnnotationOverlay';
import { acceptAiMarks, getSubmission, httpStatusOf, parseApiError } from '@/services/submission-review/api';
import { invalidateAttempt, submissionKeys } from '@/services/submission-review/query-keys';
import { allRows, releaseTokenOf } from '@/services/submission-review/marks';
import type { QuestionRow } from '@/services/submission-review/types';
import {
    filterCounts,
    filterSections,
    firstAnswerPage,
    parseKey,
    parseRowFilter,
    type RowFilter,
} from './-utils/filters';
import type { Paper } from './-utils/paper';
import type { RowActions } from './-components/actions';
import { SubmissionHeader } from './-components/SubmissionHeader';
import { SubmissionBanners } from './-components/SubmissionBanners';
import { FilterBar } from './-components/FilterBar';
import { SectionBlock } from './-components/SectionBlock';
import { QuickMarksPanel } from './-components/QuickMarksPanel';
import { AnswerSheetPanel } from './-components/AnswerSheetPanel';
import { EditMarksDialog, type EditMode, type PenNotesSource } from './-components/EditMarksDialog';
import { RemarkKeyDialog } from './-components/RemarkKeyDialog';
import { HistoryDrawer } from './-components/HistoryDrawer';
import { isRunActive } from './-components/CheckWithAiButton';
import { useKeepKeyword } from './-components/KeywordSuggestion';

export interface SubmissionSearch {
    /** AI run to show in the banner (the old review page's process id). */
    run?: string;
    /** "sid:qid" to scroll to and open. */
    q?: string;
    mode?: 'quick';
    filter?: RowFilter;
    /** '1' opens the answer sheet beside the marks. */
    sheet?: '1';
}

export const Route = createFileRoute('/assessment/submission/$attemptId/')({
    validateSearch: (search: Record<string, unknown>): SubmissionSearch => ({
        ...(typeof search.run === 'string' && search.run ? { run: search.run } : {}),
        ...(typeof search.q === 'string' && search.q ? { q: search.q } : {}),
        ...(search.mode === 'quick' ? { mode: 'quick' as const } : {}),
        ...(parseRowFilter(search.filter) ? { filter: parseRowFilter(search.filter) } : {}),
        ...(search.sheet === '1' || search.sheet === 1 ? { sheet: '1' as const } : {}),
    }),
    component: SubmissionPage,
});

function SubmissionPage() {
    const { t } = useTranslation('assessmentSubmissionReview');
    const { attemptId } = Route.useParams();
    const search = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const router = useRouter();
    const queryClient = useQueryClient();
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-4">
                <CaretLeft onClick={() => router.history.back()} className="cursor-pointer rtl:rotate-180" />
                <div>{t('nav.heading')}</div>
            </div>
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t]);

    const outlineQuery = useQuery({
        queryKey: submissionKeys.outline(attemptId),
        queryFn: () => getSubmission(attemptId),
        // Live while the AI is checking (W2 banner progress); the page settles when it ends.
        refetchInterval: (query) => (isRunActive(query.state.data?.ai_run?.status) ? 5000 : false),
        retry: (count, error) => httpStatusOf(error) !== 403 && httpStatusOf(error) !== 404 && count < 2,
    });
    const outline = outlineQuery.data;

    // A run that just ended changed marks: refresh the cards and the list counts.
    const lastRunStatus = useRef<string | null>(null);
    useEffect(() => {
        const status = outline?.ai_run?.status ?? null;
        if (lastRunStatus.current && isRunActive(lastRunStatus.current) && !isRunActive(status)) {
            invalidateAttempt(queryClient, attemptId, outline?.assessment_id);
        }
        lastRunStatus.current = status;
    }, [outline?.ai_run?.status, attemptId, outline?.assessment_id, queryClient]);

    const sectionIdsCsv = (outline?.sections ?? []).map((s) => s.section_id).join(',');
    const paperQuery = useQuery({
        queryKey: submissionKeys.paper(outline?.assessment_id ?? '', sectionIdsCsv),
        queryFn: () => getQuestionsDataForStep2({ assessmentId: outline!.assessment_id, sectionIds: sectionIdsCsv }),
        enabled: !!outline?.assessment_id && !!sectionIdsCsv,
        staleTime: 10 * 60_000,
    });
    const paper = paperQuery.data as Paper | undefined;

    // The AI run (picked by ?run= or the newest): pen notes, page layout, checked copy, rubric.
    const processId = search.run ?? outline?.ai_run?.process_id ?? null;
    const progressQuery = useQuery({
        queryKey: ['EVALUATION_PROGRESS', processId],
        queryFn: () => getEvaluationProgress(processId!),
        enabled: !!processId,
        refetchInterval: (query) => {
            const s = (query.state.data as EvaluationProgress | undefined)?.overall_status;
            return s && isRunActive(s) ? 6000 : false;
        },
        staleTime: 0,
    });
    const progress = progressQuery.data;
    const layoutMapUrl = progress?.layout_map_url ?? null;
    const { data: layoutMapData } = useQuery({
        queryKey: ['COPY_CHECK_LAYOUT_MAP', layoutMapUrl],
        queryFn: () => (layoutMapUrl ? getLayoutMap(layoutMapUrl) : null),
        enabled: !!layoutMapUrl,
        staleTime: 5 * 60_000,
    });
    const layoutMap = (layoutMapData ?? null) as LayoutMap | null;
    const pageIndexById = useMemo(() => {
        const out: Record<string, number> = {};
        for (const p of layoutMap?.pages ?? []) out[p.page_id] = p.page_index;
        return out;
    }, [layoutMap]);

    const [sectionId, setSectionId] = useState<string | null>(null);
    const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
    const [sheetPage, setSheetPage] = useState<number | null>(null);
    const [editTarget, setEditTarget] = useState<{ row: QuestionRow; mode: EditMode } | null>(null);
    const [remarkTarget, setRemarkTarget] = useState<QuestionRow | null>(null);
    const [historyTarget, setHistoryTarget] = useState<{ row: QuestionRow | null } | null>(null);

    const filter: RowFilter = search.filter ?? 'all';
    const quickMode = search.mode === 'quick';
    const sheetOpen = search.sheet === '1';
    const setSearch = (patch: Partial<SubmissionSearch>) =>
        navigate({ search: (prev: SubmissionSearch) => ({ ...prev, ...patch }), replace: true });

    // Each learner starts with nothing open, except ?q=.
    useEffect(() => {
        setOpenKeys(new Set());
        setSectionId(null);
        setSheetPage(null);
    }, [attemptId]);

    // ?q=sid:qid opens that card and scrolls to it once the outline is in.
    const scrolledFor = useRef<string | null>(null);
    useEffect(() => {
        const key = parseKey(search.q);
        if (!outline || !key || scrolledFor.current === `${attemptId}|${search.q}`) return;
        scrolledFor.current = `${attemptId}|${search.q}`;
        const fullKey = `${key.sectionId}:${key.questionId}`;
        setOpenKeys((s) => new Set(s).add(fullKey));
        window.setTimeout(() => document.getElementById(`q-${fullKey}`)?.scrollIntoView({ block: 'start' }), 50);
    }, [outline, search.q, attemptId]);

    const acceptOne = useMutation({
        // With the revision on screen: an AI mark re-checked since is not accepted unseen (409).
        mutationFn: (row: QuestionRow) =>
            acceptAiMarks(attemptId, [row.key], releaseTokenOf(outline?.release), { [row.key]: row.revision }),
        onSuccess: () => {
            toast.success(t('card.accepted'));
            invalidateAttempt(queryClient, attemptId, outline?.assessment_id);
        },
        onError: (e) => {
            if (parseApiError(e)?.code === 'STALE_REVISION') {
                toast.error(t('header.acceptStale'));
                invalidateAttempt(queryClient, attemptId, outline?.assessment_id);
                return;
            }
            toast.error(parseApiError(e)?.message || t('header.acceptFailed'));
        },
    });

    const keepKeyword = useKeepKeyword(outline);

    const actions: RowActions = {
        onEdit: (row) => setEditTarget({ row, mode: 'edit' }),
        onNotAnswered: (row) => setEditTarget({ row, mode: 'notAnswered' }),
        onRemark: (row) => setRemarkTarget(row),
        onHistory: (row) => setHistoryTarget({ row }),
        onAcceptAi: (row) => acceptOne.mutate(row),
        acceptingKey: acceptOne.isPending ? acceptOne.variables?.key ?? null : null,
        onKeepKeyword: (row) => keepKeyword.keep(row),
        keepingKey: keepKeyword.keepingKey,
        onShowSheet: (page) => {
            setSheetPage(page);
            if (!sheetOpen) setSearch({ sheet: '1' });
        },
    };

    if (outlineQuery.isLoading) return <DashboardLoader />;
    if (outlineQuery.isError || !outline) {
        const status = httpStatusOf(outlineQuery.error);
        return (
            <LayoutContainer>
                <div className="flex flex-col items-center gap-3 p-10 text-center">
                    <p className="text-body text-neutral-700">
                        {status === 403 ? t('page.forbidden') : status === 404 ? t('page.notFound') : t('page.loadFailed')}
                    </p>
                    <MyButton type="button" buttonType="secondary" onClick={() => router.history.back()}>
                        {t('page.back')}
                    </MyButton>
                </div>
            </LayoutContainer>
        );
    }

    const rows = allRows(outline.sections);
    const counts = filterCounts(rows);
    const sections = filterSections(outline.sections, filter, sectionId);
    const questionCount = new Map<string, number>();
    rows.forEach((r) => questionCount.set(r.question_id, (questionCount.get(r.question_id) ?? 0) + 1));
    const duplicated = new Set([...questionCount].filter(([, n]) => n > 1).map(([id]) => id));
    const questionNumbers = Object.fromEntries(rows.map((r) => [r.key, r.question_number]));
    const hasSheet = !!outline.response_file_id || !!outline.evaluated_file_id || !!progress?.file_id;

    const progressQuestion = (row: QuestionRow) =>
        progress
            ? [...progress.completed_questions, ...progress.pending_questions].find((q) => q.question_id === row.question_id)
            : undefined;
    const penNotesFor = (row: QuestionRow): PenNotesSource | null => {
        const q = progressQuestion(row);
        if (!q) return null;
        return { annotations: q.annotations ?? q.evaluation_details_json?.annotations ?? [], saved: q.annotation_edits };
    };

    const goToAttempt = (id: string) =>
        navigate({
            to: '/assessment/submission/$attemptId',
            params: { attemptId: id },
            search: { ...(quickMode ? { mode: 'quick' as const } : {}), ...(search.filter ? { filter: search.filter } : {}), ...(sheetOpen ? { sheet: '1' as const } : {}) },
        });

    const toggle = (key: string) =>
        setOpenKeys((s) => {
            const next = new Set(s);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    return (
        <LayoutContainer>
            <div className="flex flex-col gap-4">
                <SubmissionHeader
                    outline={outline}
                    quickMode={quickMode}
                    onQuickMode={(on) =>
                        // A handwritten / scanned copy is marked beside its sheet: Quick marks opens it.
                        setSearch({
                            mode: on ? 'quick' : undefined,
                            ...(on && hasSheet && (outline.kind === 'HANDWRITTEN' || outline.kind === 'SCANNED')
                                ? { sheet: '1' as const }
                                : {}),
                        })
                    }
                    onHistory={() => setHistoryTarget({ row: null })}
                    onNavigate={goToAttempt}
                    onAiStarted={(run) => setSearch({ run })}
                    onMarkNow={() => setSearch({ filter: 'needs_marking', mode: undefined })}
                />
                <SubmissionBanners outline={outline} onAiStarted={(run) => setSearch({ run })} />
                {quickMode && hasSheet && (
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType={sheetOpen ? 'primary' : 'secondary'}
                            scale="medium"
                            className="gap-1.5 sm:min-w-0"
                            aria-pressed={sheetOpen}
                            onClick={() => setSearch({ sheet: sheetOpen ? undefined : '1' })}
                        >
                            <FileText size={16} />
                            {t('filters.answerSheet')}
                        </MyButton>
                    </div>
                )}
                {!quickMode && (
                    <FilterBar
                        filter={filter}
                        counts={counts}
                        onFilter={(f) => setSearch({ filter: f === 'all' ? undefined : f })}
                        sections={outline.sections}
                        sectionId={sectionId}
                        onSection={setSectionId}
                        sheetOpen={sheetOpen}
                        hasSheet={hasSheet}
                        onToggleSheet={() => setSearch({ sheet: sheetOpen ? undefined : '1' })}
                    />
                )}
                <div className={cn('grid gap-4', sheetOpen && hasSheet && 'lg:grid-cols-2')}>
                    <div className="flex min-w-0 flex-col gap-5">
                        {quickMode ? (
                            <QuickMarksPanel
                                outline={outline}
                                onFocusRow={(row) => {
                                    // The side sheet follows the focused question: the AI's pages
                                    // for it (from the run), else the teacher's page tag.
                                    const q = progressQuestion(row);
                                    const aiPages = (q?.annotations ?? q?.evaluation_details_json?.annotations ?? [])
                                        .map((a) => a.page_id)
                                        .filter((id): id is string => !!id);
                                    const page = firstAnswerPage(aiPages, row.answer_pages, pageIndexById);
                                    if (page != null) setSheetPage(page);
                                }}
                                onNextAttempt={goToAttempt}
                            />
                        ) : sections.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-body text-neutral-500">
                                {rows.length === 0 ? t('page.noQuestions') : t('page.nothingMatches')}
                            </p>
                        ) : (
                            sections.map((section) => (
                                <SectionBlock
                                    key={section.section_id}
                                    section={section}
                                    rows={section.questions}
                                    outline={outline}
                                    paper={paper}
                                    openKeys={openKeys}
                                    onToggle={toggle}
                                    duplicatedQuestionIds={duplicated}
                                    currentRubricVersion={progress?.rubric_version}
                                    pageIndexById={pageIndexById}
                                    actions={actions}
                                />
                            ))
                        )}
                    </div>
                    {sheetOpen && hasSheet && (
                        <AnswerSheetPanel
                            outline={outline}
                            progress={progress}
                            layoutMap={layoutMap}
                            page={sheetPage}
                            onClose={() => setSearch({ sheet: undefined })}
                        />
                    )}
                </div>
            </div>

            {editTarget && (
                <EditMarksDialog
                    outline={outline}
                    row={rows.find((r) => r.key === editTarget.row.key) ?? editTarget.row}
                    mode={editTarget.mode}
                    open={!!editTarget}
                    onOpenChange={(o) => !o && setEditTarget(null)}
                    penNotes={outline.kind === 'HANDWRITTEN' || outline.kind === 'SCANNED' ? penNotesFor(editTarget.row) : null}
                />
            )}
            {remarkTarget && (
                <RemarkKeyDialog
                    outline={outline}
                    row={remarkTarget}
                    open={!!remarkTarget}
                    onOpenChange={(o) => !o && setRemarkTarget(null)}
                />
            )}
            <HistoryDrawer
                attemptId={attemptId}
                learnerName={outline.learner.name}
                row={historyTarget?.row ?? null}
                open={!!historyTarget}
                onOpenChange={(o) => !o && setHistoryTarget(null)}
                questionNumbers={questionNumbers}
            />
        </LayoutContainer>
    );
}
