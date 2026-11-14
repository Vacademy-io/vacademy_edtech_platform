import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { useState } from 'react';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { useTranslation } from 'react-i18next';

export const VsmartUpload = ({
    open,
    handleOpen,
    pollGenerateAssessment,
    task,
}: {
    open: boolean;
    handleOpen: (open: boolean) => void;
    pollGenerateAssessment?: (prompt?: string, taskId?: string) => void;
    task: AITaskIndividualListInterface;
}) => {
    const { t } = useTranslation('aiCenterRegenerateVsmartUpload');
    const [prompt, setPrompt] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        pollGenerateAssessment && pollGenerateAssessment(prompt, task.id);
        handleOpen(false);
    };

    const footer = (
        <div className="flex items-center justify-end gap-2">
            <MyButton
                type="button"
                scale="small"
                buttonType="secondary"
                onClick={() => handleOpen(false)}
            >
                {t('actions.cancel')}
            </MyButton>
            <MyButton type="submit" scale="small" buttonType="primary" onClick={handleSubmit}>
                {t('actions.regenerate')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog heading={t('dialog.heading')} open={open} onOpenChange={handleOpen}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <label htmlFor="prompt" className="text-sm font-medium">
                        {t('fields.prompt.label')}
                    </label>
                    <textarea
                        id="prompt"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        className="h-32 w-full resize-none rounded-md border p-2"
                        placeholder={t('fields.prompt.placeholder')}
                    />
                </div>
                {footer}
            </form>
        </MyDialog>
    );
};
