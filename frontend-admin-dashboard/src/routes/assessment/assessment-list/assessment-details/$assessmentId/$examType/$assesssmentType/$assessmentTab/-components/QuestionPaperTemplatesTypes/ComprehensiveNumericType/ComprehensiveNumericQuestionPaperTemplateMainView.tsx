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
import { useTranslation } from 'react-i18next';
import { SectionQuestionPaperFormProps } from '../../../-utils/assessment-question-paper';
import { formatStructure } from '@/routes/assessment/question-papers/-utils/helper';
import {
    NumericAnswerInput,
    answerSlots,
} from '@/routes/assessment/question-papers/-components/NumericAnswerInput';

export const ComprehensiveNumericQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    selectedSectionIndex,
}: SectionQuestionPaperFormProps) => {
    const { t } = useTranslation('assessmentComprehensiveNumericTemplateList');
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

    const answersType = t('answer.label');
    const explanationsType = t('explanation.label');
    const questionsType = '';

    // const imageDetails = getValues(`questions.${currentQuestionIndex}.imageDetails`);
    const allQuestions = getValues(`sections.${selectedSectionIndex}.questions`) || [];

    const [isExpanded, setIsExpanded] = useState<boolean>(false);

    interface CollapsibleQuillEditorProps {
        value: string | null | undefined;
        onChange: (content: string) => void;
        onBlur: () => void;
    }

    const CollapsibleQuillEditor: React.FC<CollapsibleQuillEditorProps> = ({
        value,
        onChange,
        onBlur,
    }) => {
        const { t } = useTranslation('assessmentComprehensiveNumericTemplateList');
        return (
            <div className="">
                {!isExpanded ? (
                    // Render only a single line preview
                    <div className="flex cursor-pointer flex-row gap-1 border bg-primary-100 p-2">
                        <div className="w-full max-w-[50vw] truncate text-body"> {/* design-lint-ignore: viewport-relative preview cap, no fixed-px token fits this responsive truncated preview */}
                            {value && value.replace(/<[^>]+>/g, '')}
                        </div>
                        <button
                            className="text-body text-blue-500"
                            onClick={() => setIsExpanded(true)}
                        >
                            {t('editor.showMore')}
                        </button>
                    </div>
                ) : (
                    // Render full Quill Editor when expanded
                    <div className="border bg-primary-100 p-2">
                        <MainViewQuillEditor value={value} onChange={onChange} onBlur={onBlur} />
                        <button
                            className="mt-2 text-body text-blue-500"
                            onClick={() => setIsExpanded(false)}
                        >
                            {t('editor.showLess')}
                        </button>
                    </div>
                )}
            </div>
        );
    };

    if (allQuestions.length === 0) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <h1>{t('emptyState.message')}</h1>
            </div>
        );
    }

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
                                <h1 className="text-primary-500">{t('header.questionsSettings')}</h1>
                                <PopoverClose>
                                    <X size={16} />
                                </PopoverClose>
                            </div>
                            <SelectField
                                label={t('header.questionTypeLabel')}
                                name={`questions.${currentQuestionIndex}.questionType`}
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
                                label={t('header.numericalTypeLabel')}
                                name={`questions.${currentQuestionIndex}.numericType`}
                                options={NUMERIC_TYPES.map((option, index) => ({
                                    value: option,
                                    label: option,
                                    _id: index,
                                }))}
                                control={form.control}
                                className="!w-full"
                                required
                            />
                            <div className="flex flex-col gap-2">
                                <h1 className="text-sm font-semibold">{t('timeLimit.title')}</h1>
                                <div className="flex items-center gap-4 text-sm">
                                    <CustomInput
                                        control={form.control}
                                        name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionDuration.hrs`}
                                        label=""
                                        className="w-10"
                                    />
                                    <span>{t('timeLimit.hrs')}</span>
                                    <span>:</span>
                                    <CustomInput
                                        control={form.control}
                                        name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionDuration.min`}
                                        label=""
                                        className="w-10"
                                    />
                                    <span>{t('timeLimit.min')}</span>
                                </div>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
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
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
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
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
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
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
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
