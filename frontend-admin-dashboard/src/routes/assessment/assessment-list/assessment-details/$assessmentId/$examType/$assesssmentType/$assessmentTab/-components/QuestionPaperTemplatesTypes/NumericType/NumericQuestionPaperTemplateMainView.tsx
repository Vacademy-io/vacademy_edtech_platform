import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Sliders, X, Plus } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import 'react-quill/dist/quill.snow.css';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PopoverClose } from '@radix-ui/react-popover';
import SelectField from '@/components/design-system/select-field';
import CustomInput from '@/components/design-system/custom-input';
import { MainViewQuillEditor } from '@/components/quill/MainViewQuillEditor';
import { QUESTION_TYPES, NUMERIC_TYPES } from '@/constants/dummy-data';
import { useState, useEffect } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SectionQuestionPaperFormProps } from '../../../-utils/assessment-question-paper';
import { CollapsibleQuillEditor } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/CollapsibleQuillEditor';
import { formatStructure } from '@/routes/assessment/question-papers/-utils/helper';
import {
    NumericAnswerInput,
    answerSlots,
} from '@/routes/assessment/question-papers/-components/NumericAnswerInput';

export const NumericQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    selectedSectionIndex,
}: SectionQuestionPaperFormProps) => {
    const { t } = useTranslation('assessmentNumericTemplateList');
    const { control, getValues, trigger, watch } = form;

    const numericType = watch(
        `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.numericType`
    );
    const validAnswers = watch(
        `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.validAnswers`
    );
    useEffect(() => {
        trigger(`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.validAnswers`);
    }, [numericType, currentQuestionIndex, trigger]);
    const formValues = useWatch({ control });
    useEffect(() => {
        console.log('Form data changed: ', formValues);
    }, [formValues]);
    const answersType = t('defaults.answer');
    const explanationsType = t('defaults.explanation');
    const questionsType = '';

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
                                <h1 className="text-primary-500">{t('settings.title')}</h1>
                                <PopoverClose>
                                    <X size={16} />
                                </PopoverClose>
                            </div>
                            <SelectField
                                label={t('settings.questionType')}
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
                            <SelectField
                                label={t('settings.numericalType')}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.numericType`}
                                options={NUMERIC_TYPES.map((option, index) => ({
                                    value: option,
                                    label: option,
                                    _id: index,
                                }))}
                                control={form.control}
                                className="!w-full"
                                required
                            />
                            <CustomInput
                                control={form.control}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.decimals`}
                                label={t('settings.decimalPrecision')}
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
                    {t('question.label')}&nbsp;
                    {questionsType
                        ? formatStructure(questionsType, currentQuestionIndex + 1)
                        : currentQuestionIndex + 1}
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
                <FormField
                    control={control}
                    name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.validAnswers`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <div className="flex flex-row justify-between">
                                    <div>{answersType}</div>
                                </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={control}
                    name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.validAnswers`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <div className="flex flex-row flex-wrap items-center gap-4">
                                    {answerSlots(field.value).map((answer, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            {/* Input for each validAnswer */}
                                            <NumericAnswerInput
                                                value={answer}
                                                onChange={(value) => {
                                                    const updatedAnswers = [...(field.value ?? [])];
                                                    updatedAnswers[index] = value as number;
                                                    field.onChange(updatedAnswers);
                                                }}
                                            />
                                            {/* Remove button for each answer */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    field.onChange(
                                                        field.value?.filter((_, i) => i !== index)
                                                    );
                                                }}
                                            >
                                                <X />
                                            </button>
                                        </div>
                                    ))}
                                    {/* Add new answer */}
                                    <Button
                                        variant="outline"
                                        type="button"
                                        className="cursor-pointer"
                                        onClick={() => {
                                            field.onChange([...answerSlots(field.value), null]);
                                        }}
                                    >
                                        <Plus size={20} />
                                    </Button>
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
