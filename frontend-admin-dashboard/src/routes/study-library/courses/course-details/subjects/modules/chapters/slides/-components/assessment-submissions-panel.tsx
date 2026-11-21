'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CaretLeft, CaretRight, PencilSimpleLine, UploadSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { convertToLocalDateTime } from '@/constants/helper';
import { getAdminParticipants } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { stashEvalReturnUrl } from '@/routes/evaluation/evaluation-tool/-utils/eval-return';
import { submitEvlauationMarks } from '@/routes/evaluation/evaluations/-services/evaluation-service';
import { useFileUpload } from '@/hooks/use-file-upload';
import { ensureFileHasExtension } from '@/lib/file-download';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { EnableAiChecking } from './enable-ai-checking';

interface AssessmentSubmissionsPanelProps {
    assessmentId: string;
    instituteId: string | undefined;
    playMode?: string | null;
    visibility?: string | null;
}

interface SubmissionRow {
    full_name?: string | null;
    user_id?: string | null;
    attempt_id?: string | null;
    attempt_date?: string | null;
    end_time?: string | null;
    evaluation_status?: string | null;
    score?: number | string | null;
}

const PAGE_SIZE = 8;

// Resolve the max mark from a question's marking_json defensively.
const parseMaxMark = (markingJson?: string): number => {
    try {
        const value = JSON.parse(markingJson || '')?.data?.totalMark;
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
    } catch {
        return 0;
    }
};

const isEvaluatedStatus = (status?: string | null) => {
    const s = (status || '').toUpperCase();
    return s === 'COMPLETED' || s === 'AI_EVALUATION_COMPLETED';
};

// Maps the attempt's evaluation_status to a learner-friendly chip.
const StatusChip = ({ status, t }: { status?: string | null; t: TFunction }) => {
    const s = (status || 'PENDING').toUpperCase();
    const isEvaluated = isEvaluatedStatus(s);
    const isEvaluating = s === 'EVALUATING' || s === 'AI_EVALUATION_IN_PROGRESS';
    const label = isEvaluated
        ? t('status.evaluated')
        : isEvaluating
          ? t('status.evaluating')
          : t('status.pending');
    const cls = isEvaluated
        ? 'border-green-200 bg-green-100 text-green-700'
        : isEvaluating
          ? 'border-blue-200 bg-blue-100 text-blue-700'
          : 'border-amber-200 bg-amber-100 text-amber-700';
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium ${cls}`}
        >
            {label}
        </span>
    );
};

interface QuickEvalState {
    open: boolean;
    attemptId?: string | null;
    name?: string | null;
}

const AssessmentSubmissionsPanel = ({
    assessmentId,
    instituteId,
    playMode,
    visibility,
}: AssessmentSubmissionsPanelProps) => {
    const { t } = useTranslation('studyLibraryAssessmentSubmissionsPanel');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [page, setPage] = useState(0);

    const { data, isLoading, isError } = useQuery({
        queryKey: ['ASSESSMENT_SLIDE_SUBMISSIONS_PANEL', assessmentId, instituteId, page],
        queryFn: () =>
            getAdminParticipants(assessmentId, instituteId, page, PAGE_SIZE, {
                name: '',
                assessment_type: visibility ?? 'PRIVATE',
                attempt_type: ['ENDED'],
                registration_source: 'BATCH_PREVIEW_REGISTRATION',
                batches: [],
                status: ['ACTIVE'],
                sort_columns: {},
            }),
        enabled: Boolean(assessmentId && instituteId),
        staleTime: 30 * 1000,
    });

    // Assessment shape — needed to build the quick-evaluate marks payload (slide
    // assessments are 1 section + 1 question).
    const { data: assessmentDetails } = useQuery({
        ...getAssessmentDetails({ assessmentId, instituteId, type: playMode ?? undefined }),
        enabled: Boolean(assessmentId && instituteId && playMode),
    });

    const sectionIds = useMemo(() => {
        const sections =
            assessmentDetails?.[1]?.saved_data?.sections ??
            assessmentDetails?.[0]?.saved_data?.sections ??
            [];
        return sections
            .map((s: { id?: string }) => s?.id)
            .filter(Boolean)
            .join(',');
    }, [assessmentDetails]);

    const { data: questionData } = useQuery({
        ...getQuestionDataForSection({ assessmentId, sectionIds }),
        enabled: Boolean(assessmentId && sectionIds),
    });

    // The single question the marks/remarks attach to — and how many there are.
    // A test created with AI checking carries the paper's real questions; a
    // one-number quick evaluate would then silently score only the first of
    // them, so it is offered only for the classic single-placeholder shape.
    const { primaryQuestion, questionCount, maxMarksTotal } = useMemo(() => {
        let primary: { sectionId: string; questionId: string; maxMarks: number } | null = null;
        let count = 0;
        let total = 0;
        if (questionData) {
            for (const [sectionId, questions] of Object.entries(
                questionData as Record<string, Array<{ question_id: string; marking_json?: string }>>
            )) {
                for (const q of questions ?? []) {
                    count += 1;
                    total += parseMaxMark(q.marking_json);
                    if (!primary) {
                        primary = {
                            sectionId,
                            questionId: q.question_id,
                            maxMarks: parseMaxMark(q.marking_json),
                        };
                    }
                }
            }
        }
        return { primaryQuestion: primary, questionCount: count, maxMarksTotal: total };
    }, [questionData]);
    const quickEvaluateAvailable = questionCount <= 1;

    const rows: SubmissionRow[] = data?.content ?? [];
    const totalPages: number = data?.total_pages ?? 0;
    const totalElements: number = data?.total_elements ?? 0;

    const goEvaluate = (attemptId?: string | null) => {
        if (!attemptId || !playMode) return;
        // Remember the slide so the evaluator can return here after submitting.
        stashEvalReturnUrl(window.location.href);
        navigate({
            to: '/evaluation/evaluate/$assessmentId/$attemptId/$examType',
            params: { assessmentId, attemptId, examType: playMode },
        });
    };

    // ---- Quick evaluate (inline, no full tool) ----
    const { uploadFile } = useFileUpload();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [quickEval, setQuickEval] = useState<QuickEvalState>({ open: false });
    const [marks, setMarks] = useState('');
    const [remarks, setRemarks] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const openQuickEval = (row: SubmissionRow) => {
        setQuickEval({
            open: true,
            attemptId: row.attempt_id,
            name: row.full_name || t('learnerFallback'),
        });
        setMarks(row.score != null && row.score !== '' ? String(row.score) : '');
        setRemarks('');
        setFile(null);
    };

    const closeQuickEval = () => {
        if (submitting || uploading) return;
        setQuickEval({ open: false });
        setMarks('');
        setRemarks('');
        setFile(null);
    };

    const handleQuickSubmit = async () => {
        if (!primaryQuestion) {
            toast.error(t('errors.couldNotLoadQuestion'));
            return;
        }
        const attemptId = quickEval.attemptId;
        if (!attemptId || !instituteId) return;

        const parsed = parseFloat(marks);
        if (!Number.isFinite(parsed)) {
            toast.error(t('errors.enterMarks'));
            return;
        }
        const cap = primaryQuestion.maxMarks > 0 ? primaryQuestion.maxMarks : Infinity;
        const clamped = Math.min(Math.max(parsed, 0), cap);

        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);

        setSubmitting(true);
        try {
            let fileId = '';
            if (file) {
                fileId =
                    (await uploadFile({
                        // Ensure the evaluated copy carries a correct extension so it
                        // later downloads as e.g. `.pdf` rather than an extension-less file.
                        file: ensureFileHasExtension(file),
                        setIsUploading: setUploading,
                        userId: tokenData?.user ?? '',
                        source: instituteId,
                        sourceId: 'EVALUATIONS',
                    })) || '';
            }

            const dataJson = JSON.stringify({
                attemptId,
                assessmentId,
                evaluatorUserId: tokenData?.user,
                setId: '',
            });

            await submitEvlauationMarks(assessmentId, instituteId, attemptId, {
                set_id: '',
                file_id: fileId,
                data_json: dataJson,
                request: [
                    {
                        section_id: primaryQuestion.sectionId,
                        question_id: primaryQuestion.questionId,
                        status: 'evaluated',
                        marks: clamped,
                        evaluator_feedback: remarks.trim() || undefined,
                    },
                ],
            });

            toast.success(t('toast.evaluationSubmitted'), {
                description: t('toast.evaluationSubmittedDescription', {
                    name: quickEval.name,
                }),
            });
            setQuickEval({ open: false });
            setMarks('');
            setRemarks('');
            setFile(null);
            queryClient.invalidateQueries({ queryKey: ['ASSESSMENT_SLIDE_SUBMISSIONS_PANEL'] });
        } catch (e) {
            console.error(e);
            toast.error(t('errors.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const busy = submitting || uploading;

    // The saved instructions carry the paper PDF the teacher attached; a
    // placeholder-only test can be upgraded to AI checking from that same file.
    const instructionsHtml: string | undefined =
        assessmentDetails?.[0]?.saved_data?.instructions?.content ?? undefined;

    return (
        <div className="rounded-md border border-neutral-200 bg-white">
            <EnableAiChecking
                assessmentId={assessmentId}
                assessmentName={assessmentDetails?.[0]?.saved_data?.name ?? undefined}
                instructionsHtml={instructionsHtml}
                totalMarks={maxMarksTotal > 0 ? maxMarksTotal : null}
            />
            <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
                <p className="text-xs font-semibold text-neutral-800">
                    {t('title')}
                    {totalElements > 0 && (
                        <span className="ms-1 font-normal text-neutral-500">
                            ({totalElements})
                        </span>
                    )}
                </p>
            </div>

            {isLoading ? (
                <div className="px-3 py-8 text-center text-xs text-neutral-500">
                    {t('loading')}
                </div>
            ) : isError ? (
                <div className="px-3 py-8 text-center text-xs text-red-500">
                    {t('errors.couldNotLoadSubmissions')}
                </div>
            ) : rows.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-neutral-500">
                    {t('noSubmissionsYet')}
                </div>
            ) : (
                <ul className="divide-y divide-neutral-100">
                    {rows.map((row) => {
                        const evaluated = isEvaluatedStatus(row.evaluation_status);
                        const hasScore = row.score != null && row.score !== '';
                        return (
                            <li
                                key={row.attempt_id || row.user_id}
                                className="flex items-center justify-between gap-3 px-3 py-2.5"
                            >
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium text-neutral-800">
                                        {row.full_name || t('learnerFallback')}
                                    </span>
                                    <span className="text-2xs text-neutral-500">
                                        {row.end_time || row.attempt_date
                                            ? t('submittedAt', {
                                                  date: convertToLocalDateTime(
                                                      (row.end_time || row.attempt_date) as string
                                                  ),
                                              })
                                            : '—'}
                                    </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    {evaluated && hasScore && (
                                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-2xs font-semibold text-neutral-700">
                                            {row.score}
                                            {maxMarksTotal > 0 ? ` / ${maxMarksTotal}` : ''}
                                        </span>
                                    )}
                                    <StatusChip status={row.evaluation_status} t={t} />
                                    {quickEvaluateAvailable && (
                                        <MyButton
                                            buttonType="primary"
                                            scale="small"
                                            onClick={() => openQuickEval(row)}
                                            disable={!row.attempt_id}
                                        >
                                            <span className="inline-flex items-center gap-1 text-xs">
                                                {evaluated
                                                    ? t('actions.reEvaluate')
                                                    : t('actions.quickEvaluate')}
                                            </span>
                                        </MyButton>
                                    )}
                                    <MyButton
                                        buttonType={quickEvaluateAvailable ? 'secondary' : 'primary'}
                                        scale="small"
                                        onClick={() => goEvaluate(row.attempt_id)}
                                        disable={!row.attempt_id || !playMode}
                                    >
                                        <span className="inline-flex items-center gap-1 text-xs">
                                            <PencilSimpleLine className="size-3.5" />
                                            {t('actions.tool')}
                                        </span>
                                    </MyButton>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-neutral-100 px-3 py-2 text-2xs text-neutral-500">
                    <span>
                        {t('pageOfTotal', { page: page + 1, total: totalPages })}
                    </span>
                    <div className="flex gap-1">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disable={page === 0}
                        >
                            <CaretLeft className="size-3.5" />
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPage((p) => p + 1)}
                            disable={page + 1 >= totalPages}
                        >
                            <CaretRight className="size-3.5" />
                        </MyButton>
                    </div>
                </div>
            )}

            {/* Quick-evaluate dialog — marks + remarks + optional evaluated PDF */}
            <MyDialog
                heading={t('dialog.heading', {
                    name: quickEval.name ?? t('learnerFallback'),
                })}
                open={quickEval.open}
                onOpenChange={(open) => {
                    if (!open) closeQuickEval();
                }}
            >
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-neutral-700">
                            {t('dialog.marks')}
                            {primaryQuestion && primaryQuestion.maxMarks > 0
                                ? t('dialog.outOfMarks', { max: primaryQuestion.maxMarks })
                                : ''}
                        </label>
                        <Input
                            type="number"
                            min={0}
                            max={
                                primaryQuestion && primaryQuestion.maxMarks > 0
                                    ? String(primaryQuestion.maxMarks)
                                    : undefined
                            }
                            step="0.5"
                            value={marks}
                            onChange={(e) => setMarks(e.target.value)}
                            placeholder="0"
                            className="w-32"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-neutral-700">
                            {t('dialog.remarks')}{' '}
                            <span className="text-neutral-400">{t('dialog.optional')}</span>
                        </label>
                        <Textarea
                            rows={3}
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            placeholder={t('dialog.remarksPlaceholder')}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-neutral-700">
                            {t('dialog.evaluatedPdf')}{' '}
                            <span className="text-neutral-400">{t('dialog.optional')}</span>
                        </label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        />
                        <div className="flex items-center gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => fileInputRef.current?.click()}
                                disable={busy}
                            >
                                <span className="inline-flex items-center gap-1 text-xs">
                                    <UploadSimple className="size-3.5" />
                                    {t('dialog.choosePdf')}
                                </span>
                            </MyButton>
                            <span className="truncate text-xs text-neutral-500">
                                {file ? file.name : t('dialog.noFileChosen')}
                            </span>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={closeQuickEval}
                            disable={busy}
                        >
                            {t('dialog.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={handleQuickSubmit}
                            disable={busy || !primaryQuestion || marks.trim() === ''}
                        >
                            {busy ? t('dialog.submitting') : t('dialog.submitEvaluation')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>
        </div>
    );
};

export default AssessmentSubmissionsPanel;
