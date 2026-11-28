import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, FileText } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { parseApiError, setAnswerPages } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { normaliseAnswerPages } from '../../-utils/filters';
import { AnswerText, CriteriaTable, FeedbackBlock, QuestionText, type CardProps } from './common';

/**
 * W3e: a handwritten / scanned answer. "What the AI read", the scheme breakdown,
 * "Looks right" for an AI draft, and the page tag so the next viewer lands on the page.
 */
export const HandwrittenCard = (props: CardProps) => {
    const { detail, paper, row, outline, currentRubricVersion, onAcceptAi, acceptingAi, onShowSheet, answerPage } =
        props;
    const { t } = useTranslation('assessmentSubmissionReview');
    const queryClient = useQueryClient();
    const [pages, setPages] = useState(row.answer_pages ?? '');
    useEffect(() => setPages(row.answer_pages ?? ''), [row.answer_pages]);

    const canEdit =
        outline.release.status === 'RELEASED'
            ? outline.permissions.can_edit_after_release
            : outline.permissions.can_edit;

    const savePages = useMutation({
        mutationFn: (value: string) => setAnswerPages(outline.attempt_id, row.section_id, row.question_id, value),
        onSuccess: () => {
            toast.success(t('card.pagesSaved'));
            invalidateAttempt(queryClient, outline.attempt_id);
        },
        onError: (e) => toast.error(parseApiError(e)?.message || t('card.pagesFailed')),
    });

    const submitPages = () => {
        const normalised = normaliseAnswerPages(pages);
        if (normalised == null) {
            toast.error(t('card.pagesInvalid'));
            return;
        }
        if (normalised === (row.answer_pages ?? '')) return;
        savePages.mutate(normalised);
    };

    return (
        <div className="flex flex-col gap-4">
            <QuestionText paper={paper} />
            <AnswerText title={t('card.aiRead')} text={detail.ai?.extracted_answer} />
            {!detail.ai?.extracted_answer && <p className="text-body text-neutral-500">{t('card.onTheSheet')}</p>}
            <CriteriaTable
                detail={detail}
                row={row}
                learnerName={outline.learner.name}
                currentRubricVersion={currentRubricVersion}
            />
            <FeedbackBlock feedback={detail.evaluator_feedback ?? detail.ai?.feedback} />
            <div className="flex flex-wrap items-center gap-2">
                {row.state === 'AI_DRAFT' && onAcceptAi && canEdit && (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        className="gap-1"
                        disabled={acceptingAi}
                        onClick={onAcceptAi}
                    >
                        <Check size={14} weight="bold" />
                        {t('actions.looksRight')}
                    </MyButton>
                )}
                {onShowSheet && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="gap-1"
                        onClick={() => onShowSheet(answerPage ?? null)}
                    >
                        <FileText size={14} />
                        {answerPage ? t('card.showPage', { page: answerPage }) : t('card.showSheet')}
                    </MyButton>
                )}
                {canEdit && (
                    <label className="flex items-center gap-2 text-caption text-neutral-600">
                        {t('card.onPage')}
                        <Input
                            value={pages}
                            onChange={(e) => setPages(e.target.value)}
                            onBlur={submitPages}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitPages();
                            }}
                            className="h-8 w-24"
                            placeholder="3,4"
                            inputMode="numeric"
                            aria-label={t('card.onPage')}
                        />
                    </label>
                )}
            </div>
        </div>
    );
};
