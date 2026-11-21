import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowSquareOut, CaretRight, CircleNotch, FileText, PencilSimple, X } from '@phosphor-icons/react';
import { Sidebar, SidebarContent, SidebarHeader, useSidebar } from '@/components/ui/sidebar';
import { MyButton } from '@/components/design-system/button';
import { useCompactMode } from '@/hooks/use-compact-mode';
import { useAssistDockVisible } from '@/components/assist-dock/visibility';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/lib/formatters';
import type { StudentTable } from '@/types/student-table-types';
import type { AssessmentRevaluateStudentInterface } from '@/types/assessments/assessment-overview';
import { getSubmission, httpStatusOf } from '@/services/submission-review/api';
import { invalidateAttempt, submissionKeys } from '@/services/submission-review/query-keys';
import { allRows, formatMarkOutOf } from '@/services/submission-review/marks';
import { markingLabel, resultLabel } from '@/services/submission-review/labels';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';
import { SubmissionActions } from '@/routes/assessment/submission/$attemptId/-components/SubmissionActions';
import { StateBadge } from '@/routes/assessment/submission/$attemptId/-components/StateBadge';
import { MarkedByLabel, useTypeLabel } from '@/routes/assessment/submission/$attemptId/-components/MarkedByLabel';
import { EditMarksDialog } from '@/routes/assessment/submission/$attemptId/-components/EditMarksDialog';
import { HistoryDrawer } from '@/routes/assessment/submission/$attemptId/-components/HistoryDrawer';
import { canEditMarks } from '@/routes/assessment/submission/$attemptId/-components/actions';
import { isRunActive } from '@/routes/assessment/submission/$attemptId/-components/CheckWithAiButton';
import {
    canKeepKeyword,
    KeepKeywordButton,
    KeywordSuggestedText,
    useKeepKeyword,
} from '@/routes/assessment/submission/$attemptId/-components/KeywordSuggestion';
import StudentAttemptDropdown from '../assessment-submissions-dropdown-individual/student-attempt-dropdown';
import { StatusPill } from './StatusPill';
import { useOpenSubmission } from './use-attempt-marking';
import { useSubmissionsSidePanel } from './side-view-store';

const initialsOf = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || '?';

/**
 * The Submissions list's submission side view: one attempt's whole picture (score, marking,
 * result, timings, every question's mark and state) with the same actions as the Submission
 * page, and per-question Edit marks in place. The learner's name at the top opens the
 * student side view; "Open full submission" opens the Submission page.
 */
export const SubmissionSideView = ({
    student,
    assessmentId,
    pageAttemptIds,
    onChanged,
}: {
    /** The list row (already formatted for the table: dates, duration, batch name). */
    student: StudentTable;
    assessmentId: string;
    /** The list page's attempts, for Prev / Next on the Submission page. */
    pageAttemptIds: () => string[];
    /** Marks, total or release changed here: the list refreshes its scores. */
    onChanged: () => void;
}) => {
    const { t } = useTranslation(['assessmentSubmissionReviewList', 'assessmentSubmissionReview']);
    const { setOpen, setOpenMobile } = useSidebar();
    const { isCompact } = useCompactMode();
    const assistDockVisible = useAssistDockVisible();
    const setPanel = useSubmissionsSidePanel((s) => s.setPanel);
    const openSubmission = useOpenSubmission();
    const queryClient = useQueryClient();
    const typeLabel = useTypeLabel();
    const attemptId = (student as StudentTable & { attempt_id?: string }).attempt_id ?? '';

    const [editTarget, setEditTarget] = useState<QuestionRow | null>(null);
    const [historyTarget, setHistoryTarget] = useState<{ row: QuestionRow | null } | null>(null);

    // Same query (and cache) as the Submission page, so the two never disagree.
    const outlineQuery = useQuery({
        queryKey: submissionKeys.outline(attemptId),
        queryFn: () => getSubmission(attemptId),
        enabled: !!attemptId,
        refetchInterval: (query) => (isRunActive(query.state.data?.ai_run?.status) ? 5000 : false),
        retry: (count, error) => httpStatusOf(error) !== 403 && httpStatusOf(error) !== 404 && count < 2,
    });
    const outline = outlineQuery.data;
    // A keep answered after the teacher moved to another learner: the change effect below
    // only sees the learner on screen, so refresh the list for the one that was kept.
    const currentAttemptId = useRef(attemptId);
    useEffect(() => {
        currentAttemptId.current = attemptId;
    }, [attemptId]);
    const keepKeyword = useKeepKeyword(outline, {
        onKept: (keptId) => {
            if (keptId !== currentAttemptId.current) onChanged();
        },
    });

    // The list shows score / status from its own call: refresh it when this attempt's marks
    // or release change here (an edit, Accept AI, Release, Hide, an AI run finishing).
    const changeKey = outline
        ? `${outline.total}|${outline.release.status}|${outline.release.marks_revision}|${outline.release.notified_revision}|${outline.marking}`
        : null;
    const seen = useRef<{ attemptId: string; key: string } | null>(null);
    useEffect(() => {
        if (!changeKey) return;
        const prev = seen.current;
        seen.current = { attemptId, key: changeKey };
        if (prev && prev.attemptId === attemptId && prev.key !== changeKey) onChanged();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [changeKey, attemptId]);

    useEffect(() => {
        setEditTarget(null);
        setHistoryTarget(null);
    }, [attemptId]);

    const close = () => {
        setOpen(false);
        setOpenMobile(false);
    };

    const openPage = (search?: NonNullable<Parameters<typeof openSubmission>[1]>['search']) =>
        openSubmission(attemptId, { assessmentId, attemptIds: pageAttemptIds(), source: 'list', search });

    const row = student as unknown as Record<string, unknown>;
    const str = (key: string) => {
        const v = row[key];
        return v === null || v === undefined || v === '' ? null : String(v);
    };
    const name = outline?.learner.name || student.full_name || '';
    const subline = [outline?.learner.username || student.username, str('package_session_id')]
        .filter(Boolean)
        .join(' · ');

    const timings = [
        { label: t('sideView.attemptDate'), value: str('attempt_date') },
        { label: t('sideView.start'), value: str('start_time') },
        { label: t('sideView.end'), value: str('end_time') },
        { label: t('sideView.duration'), value: str('duration') },
    ].filter((x) => x.value);

    return (
        <Sidebar
            side="right"
            preventOutsideClose
            // Same top as the student side view: under the navbar (see top-navbar.tsx).
            className={cn(isCompact ? '!top-12' : '!top-14 md:!top-[72px]')} // design-lint-ignore: mirrors navbar's md:h-[72px]
        >
            <SidebarContent
                className={cn(
                    'flex flex-col !gap-0 border-l border-t border-neutral-200 bg-white font-app text-neutral-700',
                    assistDockVisible && 'pe-14'
                )}
                data-testid="submission-side-view"
            >
                <SidebarHeader className="sticky top-0 z-10 !mt-0 !gap-2 border-b border-neutral-200 bg-white !px-4 !py-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                            {t('sideView.title')}
                        </span>
                        <div className="flex items-center gap-1">
                            <StudentAttemptDropdown
                                student={student as unknown as AssessmentRevaluateStudentInterface}
                                getPageAttemptIds={pageAttemptIds}
                            />
                            <button
                                type="button"
                                onClick={close}
                                aria-label={t('sideView.close')}
                                className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                    {/* The learner: the way into the student side view. */}
                    <button
                        type="button"
                        onClick={() => setPanel('student', true)}
                        className="group flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 text-start transition-colors hover:border-primary-200 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        data-testid="submission-side-view-student"
                    >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-caption font-semibold text-primary-600">
                            {initialsOf(name)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="truncate text-subtitle font-semibold text-neutral-900">{name}</span>
                            {subline && <span className="truncate text-caption text-neutral-500">{subline}</span>}
                        </span>
                        <span className="flex shrink-0 items-center gap-0.5 text-caption font-semibold text-primary-500">
                            {t('sideView.studentDetails')}
                            <CaretRight size={12} className="rtl:rotate-180" />
                        </span>
                    </button>
                </SidebarHeader>

                <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
                    {outlineQuery.isLoading ? (
                        <div className="flex flex-col gap-3">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="h-12 animate-pulse rounded-lg bg-neutral-100" />
                            ))}
                        </div>
                    ) : outlineQuery.isError || !outline ? (
                        <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-body text-neutral-500">
                            {httpStatusOf(outlineQuery.error) === 403
                                ? t('assessmentSubmissionReview:page.forbidden')
                                : httpStatusOf(outlineQuery.error) === 404
                                  ? t('assessmentSubmissionReview:page.notFound')
                                  : t('assessmentSubmissionReview:page.loadFailed')}
                        </p>
                    ) : (
                        <SubmissionBody
                            outline={outline}
                            timings={timings}
                            onOpenPage={openPage}
                            onEdit={setEditTarget}
                            onKeepKeyword={keepKeyword.keep}
                            keepingKey={keepKeyword.keepingKey}
                            onHistory={(r) => setHistoryTarget({ row: r })}
                            onAiStarted={() => invalidateAttempt(queryClient, attemptId, assessmentId)}
                            typeLabel={typeLabel}
                        />
                    )}
                </div>
            </SidebarContent>

            {outline && editTarget && (
                <EditMarksDialog
                    outline={outline}
                    row={allRows(outline.sections).find((r) => r.key === editTarget.key) ?? editTarget}
                    mode="edit"
                    open={!!editTarget}
                    onOpenChange={(o) => !o && setEditTarget(null)}
                />
            )}
            {outline && (
                <HistoryDrawer
                    attemptId={attemptId}
                    learnerName={outline.learner.name}
                    row={historyTarget?.row ?? null}
                    open={!!historyTarget}
                    onOpenChange={(o) => !o && setHistoryTarget(null)}
                    questionNumbers={Object.fromEntries(allRows(outline.sections).map((r) => [r.key, r.question_number]))}
                />
            )}
        </Sidebar>
    );
};

const SubmissionBody = ({
    outline,
    timings,
    onOpenPage,
    onEdit,
    onKeepKeyword,
    keepingKey,
    onHistory,
    onAiStarted,
    typeLabel,
}: {
    outline: SubmissionOutline;
    timings: { label: string; value: string | null }[];
    onOpenPage: (search?: { q?: string; mode?: 'quick'; filter?: 'all' | 'needs_marking' | 'ai' | 'changed'; sheet?: '1' }) => void;
    onEdit: (row: QuestionRow) => void;
    /** "Keep X / Y" for a keyword-match suggestion (before release). */
    onKeepKeyword: (row: QuestionRow) => void;
    keepingKey: string | null;
    onHistory: (row: QuestionRow | null) => void;
    onAiStarted: () => void;
    typeLabel: (type: string | null | undefined) => string;
}) => {
    const { t } = useTranslation(['assessmentSubmissionReviewList', 'assessmentSubmissionReview']);
    const rows = allRows(outline.sections);
    const released = outline.release.status === 'RELEASED';
    const editable = canEditMarks(outline);
    const marking = markingLabel(outline.marking, outline.counts);
    const result = resultLabel(
        !released ? 'NOT_RELEASED' : outline.release.changed_since_release ? 'RELEASED_CHANGED' : 'RELEASED'
    );
    const hasSheet = !!outline.response_file_id || !!outline.evaluated_file_id;
    const aiRun = outline.ai_run && isRunActive(outline.ai_run.status) ? outline.ai_run : null;
    const counts = [
        { key: 'needs', n: outline.counts.needs_marking, label: t('assessmentSubmissionReview:header.countNeeds', { count: outline.counts.needs_marking }), tone: 'text-warning-700' },
        { key: 'ai', n: outline.counts.ai_draft, label: t('assessmentSubmissionReview:header.countAi', { count: outline.counts.ai_draft }), tone: 'text-info-600' },
        { key: 'marked', n: outline.counts.marked, label: t('assessmentSubmissionReview:header.countMarked', { count: outline.counts.marked }), tone: 'text-success-700' },
        { key: 'na', n: outline.counts.not_answered, label: t('assessmentSubmissionReview:header.countNotAnswered', { count: outline.counts.not_answered }), tone: 'text-neutral-500' },
    ].filter((c) => c.n > 0 || c.key === 'marked');
    const showSectionNames = outline.sections.length > 1;

    return (
        <>
            {/* What and when */}
            <p className="text-caption text-neutral-500">
                {[
                    outline.assessment_name,
                    outline.attempts_total > 1
                        ? t('assessmentSubmissionReview:header.attempt', { n: outline.attempt_number, m: outline.attempts_total })
                        : null,
                    outline.submitted_at
                        ? t('assessmentSubmissionReview:header.submitted', { date: formatDateTime(outline.submitted_at) })
                        : null,
                    t(`assessmentSubmissionReview:kind.${outline.kind}`),
                ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>

            {/* Score, marking, result */}
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-h3 font-semibold tabular-nums text-neutral-900" data-testid="submission-side-view-score">
                        {formatMarkOutOf(outline.total, outline.max_total)}
                    </span>
                    <StatusPill tone={marking.tone}>{t(marking.key, marking.params)}</StatusPill>
                    <StatusPill tone={result.tone}>
                        {released && outline.release.released_at && !outline.release.changed_since_release
                            ? t('assessmentSubmissionReview:header.releasedOn', { date: formatDate(outline.release.released_at) })
                            : t(result.key)}
                    </StatusPill>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption">
                    {counts.map((c) => (
                        <span key={c.key} className={cn('font-medium', c.tone)}>
                            {c.label}
                        </span>
                    ))}
                </div>
                {aiRun && (
                    <p className="flex items-center gap-1.5 text-caption font-medium text-info-600">
                        <CircleNotch size={14} className="animate-spin" />
                        {aiRun.questions_total
                            ? t('sideView.aiChecking', { done: aiRun.questions_completed ?? 0, total: aiRun.questions_total })
                            : t('sideView.aiCheckingNoCount')}
                    </p>
                )}
            </div>

            {timings.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-caption">
                    {timings.map((x) => (
                        <div key={x.label} className="min-w-0">
                            <dt className="text-neutral-500">{x.label}</dt>
                            <dd className="truncate font-medium text-neutral-800">{x.value}</dd>
                        </div>
                    ))}
                </dl>
            )}

            {/* Actions: the full page first, then the same set as the page header. */}
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        className="gap-1.5 sm:min-w-0"
                        onClick={() => onOpenPage()}
                        data-testid="submission-side-view-open"
                    >
                        <ArrowSquareOut size={16} />
                        {t('sideView.openFull')}
                    </MyButton>
                    {hasSheet && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="gap-1.5 sm:min-w-0"
                            onClick={() => onOpenPage({ sheet: '1' })}
                        >
                            <FileText size={16} />
                            {t('sideView.answerSheet')}
                        </MyButton>
                    )}
                </div>
                <SubmissionActions
                    outline={outline}
                    scale="small"
                    onQuickMode={() =>
                        onOpenPage({
                            mode: 'quick',
                            ...(hasSheet && (outline.kind === 'HANDWRITTEN' || outline.kind === 'SCANNED')
                                ? { sheet: '1' as const }
                                : {}),
                        })
                    }
                    onHistory={() => onHistory(null)}
                    onAiStarted={onAiStarted}
                    onMarkNow={() => onOpenPage({ filter: 'needs_marking' })}
                />
                {!editable && (
                    <p className="text-caption text-neutral-500">
                        {released
                            ? t('assessmentSubmissionReview:row.readOnlyReleased')
                            : t('assessmentSubmissionReview:row.readOnly')}
                    </p>
                )}
            </div>

            {/* Every question */}
            <div className="flex flex-col gap-3">
                <h3 className="text-subtitle font-semibold text-neutral-900">
                    {t('sideView.questions', { count: rows.length })}
                </h3>
                {rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-center text-caption text-neutral-500">
                        {t('assessmentSubmissionReview:page.noQuestions')}
                    </p>
                ) : (
                    outline.sections.map((section) => (
                        <div key={section.section_id} className="flex flex-col gap-1.5">
                            {showSectionNames && (
                                <div className="flex items-center justify-between text-caption font-semibold text-neutral-600">
                                    <span className="truncate">{section.name}</span>
                                    <span className="tabular-nums">{formatMarkOutOf(section.total, section.max)}</span>
                                </div>
                            )}
                            <ul className="flex flex-col gap-1.5">
                                {section.questions.map((q) => (
                                    <li
                                        key={q.key}
                                        className={cn(
                                            'flex items-center gap-2 rounded-lg border bg-white px-2.5 py-2',
                                            q.state === 'NEEDS_MARKING' ? 'border-warning-200' : 'border-neutral-200'
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onOpenPage({ q: q.key })}
                                            title={t('sideView.openQuestion', { number: q.question_number })}
                                            className="flex min-w-0 flex-1 flex-col gap-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                        >
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="w-9 shrink-0 font-semibold text-neutral-800">
                                                    {t('assessmentSubmissionReview:row.number', { number: q.question_number })}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-caption text-neutral-600">
                                                    {typeLabel(q.question_type)}
                                                </span>
                                                <span
                                                    className={cn(
                                                        'shrink-0 whitespace-nowrap text-body font-semibold tabular-nums',
                                                        q.state === 'NEEDS_MARKING' ? 'text-neutral-500' : 'text-neutral-900'
                                                    )}
                                                >
                                                    {formatMarkOutOf(q.marks, q.max_marks)}
                                                </span>
                                            </span>
                                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 ps-11">
                                                <StateBadge row={q} hideMarked={q.state === 'MARKED' || q.state === 'AI_DRAFT'} />
                                                {(q.state === 'MARKED' || q.state === 'AI_DRAFT') && <MarkedByLabel row={q} />}
                                                <KeywordSuggestedText row={q} />
                                            </span>
                                        </button>
                                        {canKeepKeyword(q, outline) && (
                                            <KeepKeywordButton
                                                row={q}
                                                onKeep={onKeepKeyword}
                                                busy={keepingKey === q.key}
                                                buttonType="secondary"
                                            />
                                        )}
                                        {editable && (
                                            <button
                                                type="button"
                                                onClick={() => onEdit(q)}
                                                aria-label={t('sideView.edit', { number: q.question_number })}
                                                title={t('sideView.edit', { number: q.question_number })}
                                                className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-primary-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                                data-testid={`submission-side-view-edit-${q.key}`}
                                            >
                                                <PencilSimple size={16} />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))
                )}
            </div>
        </>
    );
};
