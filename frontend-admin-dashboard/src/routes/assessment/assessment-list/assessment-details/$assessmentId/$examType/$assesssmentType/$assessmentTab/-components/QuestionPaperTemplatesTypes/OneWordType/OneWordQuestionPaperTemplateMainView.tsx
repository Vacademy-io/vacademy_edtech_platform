import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Sliders, X } from '@phosphor-icons/react';
import 'react-quill/dist/quill.snow.css';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PopoverClose } from '@radix-ui/react-popover';
import SelectField from '@/components/design-system/select-field';
import { MainViewQuillEditor } from '@/components/quill/MainViewQuillEditor';
import { QUESTION_TYPES } from '@/constants/dummy-data';
import { MyInput } from '@/components/design-system/input';
import { useEffect } from 'react';
import { CollapsibleQuillEditor } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/CollapsibleQuillEditor';
import { formatStructure } from '@/routes/assessment/question-papers/-utils/helper';
import { SectionQuestionPaperFormProps } from '../../../-utils/assessment-question-paper';
import { useTranslation } from 'react-i18next';

export const OneWordQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    selectedSectionIndex,
}: SectionQuestionPaperFormProps) => {
    const { t } = useTranslation('assessmentOneWordTemplateList');
    const { control, getValues } = form;
    const explanationsType = t('explanation.label');
    const questionsType = '';

    useEffect(() => {
        const validAnswrs = form.getValues(
            `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.validAnswers`
        );
        if (!validAnswrs) {
            form.setValue(
                `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.validAnswers`,
                [0]
            );
        }
    }, []);

    return (
        <div className={className}>
            <div className="-mb-8 flex justify-end">
                <Popover>
                    <PopoverTrigger>
                        <Button variant="outline" type="button" className="cursor-pointer px-3">
                            <Sliders size={32} />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent>
                        <div className="mb-2 flex flex-col gap-4">
                            <div className="flex w-full items-center justify-between">
                                <h1 className="text-primary-500">{t('popover.title')}</h1>
                                <PopoverClose>
                                    <X size={16} />
                                </PopoverClose>
                            </div>
                            <SelectField
                                label={t('popover.questionTypeLabel')}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionType`}
                                options={QUESTION_TYPES.map((option, index) => ({
                                    value: option.code,
                                    label: option.display,
                                    _id: index,
                                }))}
                                control={form.control}
                                className="!w-full"
                                required
                            />
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            {getValues(
                `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.parentRichTextContent`
            ) && (
                <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                    <span>{t('comprehensionText')}</span>
                    <FormField
                        control={control}
                        name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.parentRichTextContent`}
                        render={({ field }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <CollapsibleQuillEditor
                                        value={field.value}
                                        onBlur={field.onBlur}
                                        onChange={field.onChange}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            )}
            <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                <span>
                    {questionsType
                        ? t('question.labelWithNumber', {
                              number: formatStructure(questionsType, currentQuestionIndex + 1),
                          })
                        : t('question.labelWithNumber', { number: currentQuestionIndex + 1 })}
                </span>
                <FormField
                    control={control}
                    name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionName`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <MainViewQuillEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>

            <div className="flex w-full flex-col gap-4">
                <span>{t('answer.label')}</span>

                <FormField
                    control={control}
                    name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.subjectiveAnswerText`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <div className="flex flex-row flex-wrap items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <MyInput
                                            input={field.value}
                                            onChangeFunction={field.onChange}
                                        />
                                    </div>
                                </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
            <div className="mb-6 flex w-full flex-col !flex-nowrap items-start gap-1">
                <span>{explanationsType}</span>
                <FormField
                    control={control}
                    name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.explanation`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <MainViewQuillEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
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
