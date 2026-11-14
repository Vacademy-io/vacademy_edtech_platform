import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Sliders, X } from '@phosphor-icons/react';
import 'react-quill/dist/quill.snow.css';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PopoverClose } from '@radix-ui/react-popover';
import SelectField from '@/components/design-system/select-field';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { QUESTION_TYPES } from '@/constants/dummy-data';
import { Badge } from '@/components/ui/badge';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export const OneWordQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    showQuestionNumber = true,
    examType,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentOneWordTemplateQP');
    console.log('🎯 OneWordQuestionPaperTemplateMainView rendered', {
        examType,
        currentQuestionIndex,
        isSurvey: examType === 'SURVEY'
    });
    const { control, getValues, setValue } = form;
    const explanationsType = getValues('explanationsType') || t('explanation.defaultLabel');
    const questionsType = getValues('questionsType') || '';

    const allQuestions = getValues('questions') || [];
    const tags = getValues(`questions.${currentQuestionIndex}.tags`) || [];
    const level = getValues(`questions.${currentQuestionIndex}.level`) || '';

    useEffect(() => {
        try {
            const validAnswers = getValues(`questions.${currentQuestionIndex}.validAnswers`);
            if (!validAnswers) {
                setValue(`questions.${currentQuestionIndex}.validAnswers`, [0]);
            }
        } catch (error) {
            console.warn('Setting default valid answers failed:', error);
        }
    }, [currentQuestionIndex]);

    if (allQuestions.length === 0) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <h1>{t('emptyState.noQuestions')}</h1>
            </div>
        );
    }

    return (
        <div className={className}>
            {getValues(`questions.${currentQuestionIndex}.parentRichTextContent`) && (
                <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                    <span>{t('label.comprehensionText')}</span>
                    <FormField
                        control={control}
                        name={`questions.${currentQuestionIndex}.parentRichTextContent`}
                        render={({ field }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <RichTextEditor
                                        value={field.value}
                                        onBlur={field.onBlur}
                                        onChange={field.onChange}
                                        minHeight={100}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            )}
            <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                <div className="flex items-center gap-2">
                    <span>
                        {t('label.question')}
                        {showQuestionNumber && (
                            <>
                                &nbsp;
                                {questionsType
                                    ? formatStructure(questionsType, currentQuestionIndex + 1)
                                    : currentQuestionIndex + 1}
                            </>
                        )}
                    </span>
                    <Badge variant="outline">{level}</Badge>
                </div>
                <FormField
                    control={control}
                    name={`questions.${currentQuestionIndex}.questionName`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                    minHeight={100}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="mt-2 flex items-center gap-2">
                    {tags?.map((tag, idx) => {
                        return (
                            <Badge variant="outline" key={idx}>
                                {tag}
                            </Badge>
                        );
                    })}
                </div>
            </div>

            {examType !== 'SURVEY' && (
                <div className="flex w-full flex-col gap-4">
                    <span>{t('label.answer')}</span>

                    <FormField
                        control={control}
                        name={`questions.${currentQuestionIndex}.subjectiveAnswerText`}
                        render={({ field }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <input
                                        type="text"
                                        value={field.value || ''}
                                        onChange={(e) => field.onChange(e.target.value)}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                                        placeholder={t('placeholder.correctAnswer')}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            )}
            <div className="mb-6 flex w-full flex-col !flex-nowrap items-start gap-1">
                <span>{explanationsType}</span>
                <FormField
                    control={control}
                    name={`questions.${currentQuestionIndex}.explanation`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                    minHeight={120}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        </div>
    );
};
