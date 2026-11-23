import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise, X } from '@phosphor-icons/react';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import SimplePDFViewer from '@/components/common/simple-pdf-viewer';
import { getPublicUrl } from '@/services/upload_file';
import { getAssessmentSettingsFromCache } from '@/services/assessment-settings';
import type { EvaluationProgress } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import {
    PdfAnnotationOverlay,
    type Annotation,
    type LayoutMap,
} from '@/routes/assessment/evaluation-ai/$attemptId/$processId/-components/PdfAnnotationOverlay';
import { RegenerateCopyDialog } from '@/routes/assessment/evaluation-ai/$attemptId/$processId/-components/RegenerateCopyDialog';
import type { SubmissionOutline } from '@/services/submission-review/types';
import { invalidateAttempt } from '@/services/submission-review/query-keys';

type SheetTab = 'learner' | 'checked';

/**
 * Side panel: the learner's sheet or the checked copy, opened at the focused question's
 * page; Redraw checked copy for an AI-checked copy (same dialog as the AI review page).
 */
export const AnswerSheetPanel = ({
    outline,
    progress,
    layoutMap,
    page,
    onClose,
}: {
    outline: SubmissionOutline;
    progress: EvaluationProgress | null | undefined;
    layoutMap: LayoutMap | null;
    /** 1-based page to open on. */
    page: number | null;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const queryClient = useQueryClient();
    const [redrawOpen, setRedrawOpen] = useState(false);

    // The run's own checked copy when it finished, else the attempt's saved one.
    const checkedFileId =
        (progress?.overall_status === 'COMPLETED' ? progress.file_id : null) ?? outline.evaluated_file_id ?? null;
    const learnerFileId = outline.response_file_id;
    const [tab, setTab] = useState<SheetTab>(checkedFileId ? 'checked' : 'learner');
    useEffect(() => {
        if (tab === 'checked' && !checkedFileId) setTab('learner');
        if (tab === 'learner' && !learnerFileId && checkedFileId) setTab('checked');
    }, [tab, checkedFileId, learnerFileId]);
    const fileId = tab === 'checked' ? checkedFileId : learnerFileId;

    const { data: url, isLoading, isError } = useQuery({
        queryKey: ['PUBLIC_FILE_URL', fileId],
        queryFn: () => getPublicUrl(fileId),
        enabled: !!fileId,
        staleTime: 10 * 60_000,
    });

    // The overlay only stands in for a finished run that drew no checked copy.
    const annotations: Annotation[] = useMemo(() => {
        const out: Annotation[] = [];
        for (const q of progress?.completed_questions ?? []) {
            for (const a of q.annotations ?? q.evaluation_details_json?.annotations ?? []) {
                out.push({ ...a, question_id: q.question_id });
            }
        }
        return out;
    }, [progress?.completed_questions]);
    const showOverlay =
        tab === 'learner' && progress?.overall_status === 'COMPLETED' && !progress?.file_id && annotations.length > 0;
    const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

    // A teacher's change after the copy was drawn is not on the PDF yet.
    const copyIsStale = useMemo(() => {
        if (!progress?.file_id) return false;
        const redrawnAt = progress.copy_redrawn_at ? new Date(progress.copy_redrawn_at).getTime() : 0;
        return (progress.completed_questions ?? []).some(
            (q) => q.is_edited && (!q.edited_at || new Date(q.edited_at).getTime() > redrawnAt)
        );
    }, [progress]);

    const processId = outline.ai_run?.process_id ?? progress?.evaluation_process_id ?? null;
    const canRedraw = !!processId && !!progress?.file_id;

    return (
        <aside className="flex h-dialog-tall min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white lg:sticky lg:top-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                <ChipToggleGroup
                    size="sm"
                    variant="outline"
                    ariaLabel={t('sheet.ariaLabel')}
                    value={tab}
                    onChange={(v) => setTab(v as SheetTab)}
                    options={[
                        ...(learnerFileId ? [{ value: 'learner' as const, label: t('sheet.learner') }] : []),
                        ...(checkedFileId ? [{ value: 'checked' as const, label: t('sheet.checked') }] : []),
                    ]}
                />
                <div className="flex items-center gap-1">
                    {page != null && <span className="text-caption text-neutral-500">{t('sheet.page', { page })}</span>}
                    {canRedraw && (
                        <MyButton
                            type="button"
                            buttonType={copyIsStale ? 'primary' : 'secondary'}
                            scale="small"
                            className="gap-1 sm:min-w-0"
                            onClick={() => setRedrawOpen(true)}
                        >
                            <ArrowsClockwise size={14} />
                            {t('sheet.redraw')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        layoutVariant="icon"
                        aria-label={t('sheet.close')}
                        onClick={onClose}
                    >
                        <X size={16} />
                    </MyButton>
                </div>
            </div>
            {copyIsStale && tab === 'checked' && (
                <p className="border-b border-warning-200 bg-warning-50 px-3 py-2 text-caption text-warning-700">
                    {t('sheet.stale')}
                </p>
            )}
            <div className="min-h-0 flex-1 bg-neutral-100 p-2">
                {!fileId ? (
                    <p className="p-4 text-body text-neutral-500">{t('sheet.none')}</p>
                ) : isLoading ? (
                    <DashboardLoader />
                ) : isError || !url ? (
                    <p className="p-4 text-body text-danger-600">{t('sheet.loadFailed')}</p>
                ) : (
                    <div ref={setContainerEl} className="relative size-full">
                        {/* Keyed by the file only: a new question's page moves the open copy instead of reloading it. */}
                        <SimplePDFViewer
                            key={url}
                            pdfUrl={url}
                            initialPage={page != null && page > 0 ? page - 1 : undefined}
                            page={page != null && page > 0 ? page - 1 : undefined}
                        />
                        {showOverlay && (
                            <PdfAnnotationOverlay pdfContainerEl={containerEl} layoutMap={layoutMap} annotations={annotations} />
                        )}
                    </div>
                )}
            </div>
            {redrawOpen && processId && (
                <RegenerateCopyDialog
                    open={redrawOpen}
                    onOpenChange={setRedrawOpen}
                    processId={processId}
                    defaultPen={getAssessmentSettingsFromCache().aiCopyCheck?.penStyle}
                    onDone={() => {
                        queryClient.invalidateQueries({ queryKey: ['EVALUATION_PROGRESS', processId] });
                        invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
                    }}
                />
            )}
        </aside>
    );
};
