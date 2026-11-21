/**
 * The AI check price and confirm dialog, shared by the Submissions row menu ("Evaluate
 * with AI") and the Submission page ("Check with AI"). Moved here unchanged from
 * student-attempt-dropdown.tsx; strings stay in assessmentStudentAttemptDropdown.
 */
import { useTranslation } from 'react-i18next';
import { Coins, WarningCircle } from '@phosphor-icons/react';
import { DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { perPageCredits, typedPerAnswerCredits } from '@/services/ai-credits/get-ai-credits';

/**
 * What one AI check of this paper costs against the institute's balance. The dashboard's
 * server side only quotes (credit-check.dashboard-enforced=false in prod), so this is the
 * one thing stopping a check the institute cannot pay for. The check is billed per
 * question, and the saved sections carry no questions, so they come from the per-section
 * query (same count as the bulk quote). `enabled` keeps a row from fetching until its
 * menu is open.
 */
export const useAiCheckCost = (enabled: boolean, typedAnswerCount?: number) => {
    // A copy: the pages are counted when the copy is read, so the screen shows the
    // rate, and the balance check uses the minimum: one page. Typed (online) answers:
    // billed per written answer at the row's typed_per_answer rate; a teacher's check
    // grades every written question on the paper, so that count is the price.
    const typed = typedAnswerCount != null;
    const cost = useToolCostPreview(
        'copy_check_evaluation',
        typed
            ? { answer_mode: 'TYPED', num_answers: Math.max(1, typedAnswerCount) }
            : { num_pages: 1 },
        enabled
    );
    return {
        ...cost,
        creditsPerPage: typed ? null : perPageCredits(cost.rate),
        creditsPerAnswer: typed ? typedPerAnswerCredits(cost.rate) : null,
    };
};

/**
 * A copy (or typed answers) already checked or under evaluation: a new check costs
 * credits and replaces its marks. Typed answers always come here first, also when not
 * marked yet (`firstCheck`): the teacher sees the price before the institute pays it.
 */
export const ReCheckWithAIConfirm = ({
    student,
    cost,
    isStarting,
    typedAnswers = false,
    firstCheck = false,
    note,
    onConfirm,
    onClose,
}: {
    student: { full_name: string };
    cost: ReturnType<typeof useAiCheckCost>;
    isStarting: boolean;
    /** An online test: the AI marks typed answers, billed per answer, not pages of a copy. */
    typedAnswers?: boolean;
    /** Typed answers not marked yet: a first check, not a re-check. */
    firstCheck?: boolean;
    /** An extra line under the message (the Submission page: teacher marks are kept). */
    note?: string | null;
    onConfirm: () => void;
    onClose: () => void;
}) => {
    const { t } = useTranslation('assessmentStudentAttemptDropdown');
    const firstTyped = typedAnswers && firstCheck;
    const perUnit = typedAnswers ? cost.creditsPerAnswer : cost.creditsPerPage;

    return (
        <DialogContent className="flex flex-col gap-4 p-0">
            <h1 className="rounded-md bg-primary-50 p-4 text-primary-500">
                {firstTyped
                    ? t('dialogs.evaluateWithAI.checkTitleTyped')
                    : typedAnswers
                      ? t('dialogs.evaluateWithAI.recheckTitleTyped')
                      : t('dialogs.evaluateWithAI.recheckTitle')}
            </h1>
            <div className="flex flex-col gap-4 p-4">
                <p className="text-sm text-neutral-700">
                    {firstTyped
                        ? t('dialogs.evaluateWithAI.checkMessageTyped', { name: student.full_name })
                        : typedAnswers
                          ? t('dialogs.evaluateWithAI.recheckMessageTyped', {
                                name: student.full_name,
                            })
                          : t('dialogs.evaluateWithAI.recheckMessage', {
                                name: student.full_name,
                            })}
                </p>

                {note && <p className="text-caption text-neutral-600">{note}</p>}

                {perUnit != null && (
                    <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 p-3">
                        <div className="flex items-center gap-2 text-sm text-neutral-700">
                            <Coins size={16} className="text-primary-500" />
                            <span>
                                {t('dialogs.evaluateWithAI.estimatedCostLabel')}{' '}
                                <span className="font-semibold text-neutral-900">
                                    {typedAnswers
                                        ? `${t('dialogs.evaluateWithAI.creditsCount', {
                                              count: cost.credits ?? 0,
                                          })} (${t('dialogs.evaluateWithAI.creditsPerAnswer', {
                                              count: perUnit,
                                          })})`
                                        : t('dialogs.evaluateWithAI.creditsPerPage', {
                                              count: perUnit,
                                          })}
                                </span>
                            </span>
                        </div>
                        {cost.currentBalance != null && (
                            <span className="text-xs text-neutral-500">
                                {t('dialogs.evaluateWithAI.balance', {
                                    count: cost.currentBalance,
                                })}
                            </span>
                        )}
                    </div>
                )}

                {cost.sufficient === false && (
                    <div className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-xs text-danger-600">
                        <WarningCircle size={16} className="mt-0.5 shrink-0" />
                        <p>{t('dialogs.evaluateWithAI.insufficientCredits')}</p>
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={onClose}
                        disabled={isStarting}
                    >
                        {t('dialogs.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        onClick={onConfirm}
                        disabled={isStarting || cost.sufficient === false}
                    >
                        {isStarting
                            ? t('dialogs.evaluateWithAI.starting')
                            : firstTyped
                              ? t('dialogs.evaluateWithAI.checkConfirm')
                              : t('dialogs.evaluateWithAI.recheckConfirm')}
                    </MyButton>
                </div>
            </div>
        </DialogContent>
    );
};
