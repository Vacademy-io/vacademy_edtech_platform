import { MyDialog } from '@/components/design-system/dialog';
import { QuestionsFromTextData } from '../../ai-tools/vsmart-prompt/-components/GenerateQuestionsFromText';
import { MyButton } from '@/components/design-system/button';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AITaskIndividualListInterface } from '@/types/ai/generate-assessment/generate-complete-assessment';
import { useTranslation } from 'react-i18next';
const formSchema = z.object({
    text: z.string().min(1),
    num: z.number().min(1),
    class_level: z.string().min(1),
    topics: z.string().min(1),
    question_type: z.string().min(1),
    question_language: z.string().min(1),
});

export const VsmartAudio = ({
    open,
    handleOpen,
    pollGenerateQuestionsFromAudio,
    task,
}: {
    open: boolean;
    handleOpen: (open: boolean) => void;
    pollGenerateQuestionsFromAudio?: (data: QuestionsFromTextData, taskId: string) => void;
    task: AITaskIndividualListInterface;
}) => {
    const { t } = useTranslation('aiCenterRegenerateVsmartAudio');
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<QuestionsFromTextData>({
        resolver: zodResolver(formSchema),
    });

    const onSubmit = (data: QuestionsFromTextData) => {
        pollGenerateQuestionsFromAudio?.(data, task.id);
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
            <MyButton type="submit" scale="small" buttonType="primary">
                {t('actions.regenerate')}
            </MyButton>
        </div>
    );

    return (
        <MyDialog heading={t('heading')} open={open} onOpenChange={handleOpen}>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <label htmlFor="text" className="text-sm font-medium">
                        {t('fields.text.label')}
                    </label>
                    <textarea
                        id="text"
                        {...register('text')}
                        className="h-32 w-full resize-none rounded-md border p-2"
                        placeholder={t('fields.text.placeholder')}
                    />
                    {errors.text && (
                        <span className="text-sm text-red-500">{errors.text.message}</span>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <label htmlFor="num" className="text-sm font-medium">
                        {t('fields.numQuestions.label')}
                    </label>
                    <input
                        id="num"
                        type="number"
                        {...register('num', { valueAsNumber: true })}
                        className="w-full rounded-md border p-2"
                        placeholder={t('fields.numQuestions.placeholder')}
                    />
                    {errors.num && (
                        <span className="text-sm text-red-500">{errors.num.message}</span>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <label htmlFor="class_level" className="text-sm font-medium">
                        {t('fields.classLevel.label')}
                    </label>
                    <input
                        id="class_level"
                        {...register('class_level')}
                        className="w-full rounded-md border p-2"
                        placeholder={t('fields.classLevel.placeholder')}
                    />
                    {errors.class_level && (
                        <span className="text-sm text-red-500">{errors.class_level.message}</span>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <label htmlFor="topics" className="text-sm font-medium">
                        {t('fields.topics.label')}
                    </label>
                    <input
                        id="topics"
                        {...register('topics')}
                        className="w-full rounded-md border p-2"
                        placeholder={t('fields.topics.placeholder')}
                    />
                    {errors.topics && (
                        <span className="text-sm text-red-500">{errors.topics.message}</span>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <label htmlFor="question_type" className="text-sm font-medium">
                        {t('fields.questionType.label')}
                    </label>
                    <input
                        id="question_type"
                        {...register('question_type')}
                        className="w-full rounded-md border p-2"
                        placeholder={t('fields.questionType.placeholder')}
                    />
                    {errors.question_type && (
                        <span className="text-sm text-red-500">{errors.question_type.message}</span>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <label htmlFor="question_language" className="text-sm font-medium">
                        {t('fields.questionLanguage.label')}
                    </label>
                    <input
                        id="question_language"
                        {...register('question_language')}
                        className="w-full rounded-md border p-2"
                        placeholder={t('fields.questionLanguage.placeholder')}
                    />
                    {errors.question_language && (
                        <span className="text-sm text-red-500">
                            {errors.question_language.message}
                        </span>
                    )}
                </div>

                {footer}
            </form>
        </MyDialog>
    );
};

export default VsmartAudio;
