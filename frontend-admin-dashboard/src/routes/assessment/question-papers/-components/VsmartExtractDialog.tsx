import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { AICenterProvider } from '@/routes/ai-center/-contexts/useAICenterContext';
import GenerateAiQuestionPaperComponent from '@/routes/ai-center/ai-tools/vsmart-extract/-components/GenerateQuestionPaper';
import { PAPER_FOLDERS_QUERY_KEY } from '@/services/question-paper-folders';
import { QUESTION_PAPER_STATS_KEY } from '../-utils/question-paper-list';

interface VsmartExtractDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBack: () => void;
}

/**
 * "Extract with VSmart AI" from the Question Papers screen: the teacher uploads a
 * paper they already have, the VSmart Extract tool (same as AI Center → Reuse
 * Existing Questions) reads it, and "Add to question bank" in its preview saves it.
 */
export const VsmartExtractDialog = ({ open, onOpenChange, onBack }: VsmartExtractDialogProps) => {
    const { t } = useTranslation('assessmentQuestionPapersPage');
    const queryClient = useQueryClient();

    // The preview refreshes the paper list when it saves; the counters and
    // folder tallies above the list are refreshed when this dialog is left.
    const refreshCounts = () => {
        queryClient.invalidateQueries({ queryKey: [QUESTION_PAPER_STATS_KEY] });
        queryClient.invalidateQueries({ queryKey: PAPER_FOLDERS_QUERY_KEY });
    };
    const handleOpenChange = (next: boolean) => {
        if (!next) refreshCounts();
        onOpenChange(next);
    };
    const handleBack = () => {
        refreshCounts();
        onBack();
    };

    return (
        <MyDialog
            heading={t('chooser.vsmart.dialogHeading')}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-4xl"
            footerLeft={
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="medium"
                    layoutVariant="default"
                    className="gap-1 px-0"
                    onClick={handleBack}
                >
                    <ArrowLeft size={16} />
                    {t('form.allOptions')}
                </MyButton>
            }
            footer={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    onClick={() => handleOpenChange(false)}
                >
                    {t('chooser.vsmart.close')}
                </MyButton>
            }
        >
            <div className="flex flex-col gap-6">
                <p className="text-body text-neutral-600">{t('chooser.vsmart.dialogHint')}</p>
                <AICenterProvider>
                    <GenerateAiQuestionPaperComponent embedded />
                </AICenterProvider>
            </div>
        </MyDialog>
    );
};
