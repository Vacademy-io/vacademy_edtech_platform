import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Sliders, X, Plus } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import 'react-quill/dist/quill.snow.css';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PopoverClose } from '@radix-ui/react-popover';
import SelectField from '@/components/design-system/select-field';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { NumericAnswerInput, answerSlots } from '../../NumericAnswerInput';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { QUESTION_TYPES, NUMERIC_TYPES } from '@/constants/dummy-data';
import { Badge } from '@/components/ui/badge';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export const NumericQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    showQuestionNumber = true,
    examType,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentNumericTemplateQP');
    console.log('🎯 NumericQuestionPaperTemplateMainView rendered', {
        examType,
        currentQuestionIndex,
        isSurvey: examType === 'SURVEY'
    });
    // Add defensive check to ensure form is properly initialized
    if (!form || !form.control || !form.getValues || !form.trigger || !form.watch || !form.setValue) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <h1>{t('errors.formNotInitialized')}</h1>
            </div>
        );
    }

    const { control, getValues, trigger, watch } = form;

    const numericType = watch(`questions.${currentQuestionIndex}.numericType`) || '';
    const validAnswers = watch(`questions.${currentQuestionIndex}.validAnswers`) || [0];

    const answersType = getValues('answersType') || t('defaults.answer');
    const explanationsType = getValues('explanationsType') || t('defaults.explanation');
    const questionsType = getValues('questionsType') || '';
    const tags = getValues(`questions.${currentQuestionIndex}.tags`) || [];
    const level = getValues(`questions.${currentQuestionIndex}.level`) || '';

    useEffect(() => {
        try {
            trigger(`questions.${currentQuestionIndex}.validAnswers`);
        } catch (error) {
            console.warn('Trigger validation failed:', error);
        }
    }, [numericType, currentQuestionIndex]);

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
                                label={t('settings.numericalType')}
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
                            <FormField
                                control={form.control}
                                name={`questions.${currentQuestionIndex}.decimals`}
                                render={({ field }) => (
                                    <FormItem className="w-full">
                                        <FormControl>
                                            <Input
                                                type="number"
                                                value={field.value || 0}
                                                onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                                                className="w-full"
                                                placeholder={t('settings.decimalPrecisionPlaceholder')}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            {getValues(`questions.${currentQuestionIndex}.parentRichTextContent`) && (
                <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                    <span>{t('comprehensionText')}</span>
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
                        {t('question.label')}
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
                    <div className="flex flex-row justify-between">
                        <div>{answersType}</div>
                    </div>

                    <FormField
                        control={control}
                        name={`questions.${currentQuestionIndex}.validAnswers`}
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
                                                    const updatedAnswers = [
                                                        ...(field.value ?? []),
                                                    ];
                                                    updatedAnswers[index] = value as number;
                                                    field.onChange(updatedAnswers);
                                                }}
                                            />
                                            {/* Remove button for each answer */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    field.onChange(
                                                        field.value?.filter(
                                                            (_, i) => i !== index
                                                        )
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
