import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowsOut } from '@phosphor-icons/react';
import { CbeAnswerView, CbeSolutionView } from '@/components/common/cbe-review';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { cbeConfigFromEvaluationJson, parseCbeAnswer } from '@/routes/assessment/question-papers/-utils/cbe-question';
import { CriteriaTable, FeedbackBlock, Foldable, QuestionText, type CardProps } from './common';

/**
 * W3c: Spreadsheet & written response — each part as a read-only sheet / document (the
 * same renderers as the AI review page), the model solution and marking scheme folded.
 */
export const CbeCard = ({ detail, paper, row, outline, currentRubricVersion }: CardProps) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const [fullOpen, setFullOpen] = useState(false);
    const config = useMemo(
        () => cbeConfigFromEvaluationJson(detail.auto_evaluation_json ?? paper?.auto_evaluation_json ?? paper?.evaluation_json),
        [detail.auto_evaluation_json, paper?.auto_evaluation_json, paper?.evaluation_json]
    );
    const answer = useMemo(
        () => parseCbeAnswer(detail.response_json) ?? parseCbeAnswer(detail.ai?.extracted_answer),
        [detail.response_json, detail.ai?.extracted_answer]
    );
    return (
        <div className="flex flex-col gap-4">
            <QuestionText paper={paper} />
            {answer ? (
                <div className="flex flex-col gap-2">
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            className="gap-1"
                            onClick={() => setFullOpen(true)}
                        >
                            <ArrowsOut size={14} />
                            {t('card.openFullSheet')}
                        </MyButton>
                    </div>
                    <div className="rounded-md border border-neutral-200 p-3">
                        <CbeAnswerView answer={answer} config={config} />
                    </div>
                </div>
            ) : (
                <p className="text-body text-neutral-500">{t('card.noAnswer')}</p>
            )}
            {row.state === 'NEEDS_MARKING' && (
                <p className="rounded-md bg-warning-50 p-3 text-body text-warning-700">{t('card.notMarkedYet')}</p>
            )}
            {config && (
                <Foldable title={t('card.modelSolution')}>
                    <CbeSolutionView config={config} />
                </Foldable>
            )}
            <CriteriaTable
                detail={detail}
                row={row}
                learnerName={outline.learner.name}
                currentRubricVersion={currentRubricVersion}
            />
            <FeedbackBlock feedback={detail.evaluator_feedback ?? detail.ai?.feedback} />
            <Dialog open={fullOpen} onOpenChange={setFullOpen}>
                <DialogContent className="flex max-h-dialog-tall w-dialog-xl flex-col gap-3 overflow-y-auto">
                    <DialogTitle>{t('card.fullSheetTitle', { number: row.question_number })}</DialogTitle>
                    <CbeAnswerView answer={answer} config={config} />
                </DialogContent>
            </Dialog>
        </div>
    );
};
