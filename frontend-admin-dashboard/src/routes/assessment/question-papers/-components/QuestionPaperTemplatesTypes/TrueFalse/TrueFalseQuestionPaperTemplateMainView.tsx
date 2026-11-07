import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Sliders, X } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import 'react-quill/dist/quill.snow.css';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PopoverClose } from '@radix-ui/react-popover';
import SelectField from '@/components/design-system/select-field';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { QUESTION_TYPES } from '@/constants/dummy-data';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';

// Helper component for question settings popover
const QuestionSettingsPopover = ({ form, currentQuestionIndex }: { form: any; currentQuestionIndex: number }) => {
    const { t } = useTranslation('assessmentTrueFalseTemplateQP');

    return (
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
                                <h1 className="text-primary-500">{t('settingsPopover.title')}</h1>
                                <PopoverClose>
                                    <X size={16} />
                                </PopoverClose>
                            </div>
                            <SelectField
                                label={t('settingsPopover.questionTypeLabel')}
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
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
    );
};

// Helper component for question header
const QuestionHeader = ({
    form,
    currentQuestionIndex,
    showQuestionNumber,
    questionsType,
    level,
    tags
}: {
    form: any;
    currentQuestionIndex: number;
    showQuestionNumber: boolean;
    questionsType: string;
    level: string;
    tags: string[];
}) => {
    const { t } = useTranslation('assessmentTrueFalseTemplateQP');

    return (
            <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                <div className="flex items-center gap-2">
                    <span>
                        {t('questionHeader.questionLabel')}
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
            control={form.control}
                    name={`questions.${currentQuestionIndex}.questionName`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
                                    value={field.value}
                                    onBlur={field.onBlur}
                                    onChange={field.onChange}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="mt-2 flex items-center gap-2">
            {tags?.map((tag, idx) => (
                            <Badge variant="outline" key={idx}>
                                {tag}
                            </Badge>
            ))}
                </div>
            </div>
    );
};

// Helper component for true/false option
const TrueFalseOption = ({
    optionIndex,
    optionName,
    isSelected,
    examType,
    optionsType,
    form,
    currentQuestionIndex,
    onOptionChange
}: {
    optionIndex: number;
    optionName: string;
    isSelected: boolean;
    examType: string;
    optionsType: string;
    form: any;
    currentQuestionIndex: number;
    onOptionChange: (optionIndex: number) => void;
}) => {
    const { t } = useTranslation('assessmentTrueFalseTemplateQP');
    const optionLabel = optionIndex === 0 ? 'a' : 'b';

    return (
                    <div
                        className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-4 ${
                isSelected && examType !== 'SURVEY' ? 'border border-primary-300 bg-primary-50' : ''
                        }`}
                    >
                        <div className="flex w-full items-center gap-4">
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                <span className="!p-0 text-sm">
                        {optionsType
                            ? formatStructure(optionsType, optionLabel)
                            : t('trueFalseOption.markerFallback', { label: optionLabel })}
                                </span>
                            </div>
                <div>{optionName}</div>
                        </div>
                        {examType !== 'SURVEY' && (
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                                <FormField
                        control={form.control}
                        name={`questions.${currentQuestionIndex}.trueFalseOptions.${optionIndex}.isSelected`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                        onCheckedChange={() => onOptionChange(optionIndex)}
                                                    className={`mt-1 size-5 rounded-xl border-2 shadow-none ${
                                                        field.value
                                                ? 'border-none bg-green-500 text-white'
                                                : ''
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        )}
                    </div>
    );
};

// Helper component for options section
const TrueFalseOptions = ({
    form,
    currentQuestionIndex,
    examType,
    optionsType,
    onOptionChange
}: {
    form: any;
    currentQuestionIndex: number;
    examType: string;
    optionsType: string;
    onOptionChange: (optionIndex: number) => void;
}) => {
    const { t } = useTranslation('assessmentTrueFalseTemplateQP');
    const answersType = form.getValues('answersType') || t('trueFalseOptions.answerDefaultLabel');
    const option1 = form.getValues(`questions.${currentQuestionIndex}.trueFalseOptions.${0}`);
    const option2 = form.getValues(`questions.${currentQuestionIndex}.trueFalseOptions.${1}`);

    return (
        <div className="flex w-full grow flex-col gap-4">
            <span className="-mb-3">{answersType}</span>
            <div className="flex gap-4">
                <TrueFalseOption
                    optionIndex={0}
                    optionName={t('trueFalseOption.trueLabel')}
                    isSelected={option1?.isSelected}
                    examType={examType}
                    optionsType={optionsType}
                    form={form}
                    currentQuestionIndex={currentQuestionIndex}
                    onOptionChange={onOptionChange}
                />
                <TrueFalseOption
                    optionIndex={1}
                    optionName={t('trueFalseOption.falseLabel')}
                    isSelected={option2?.isSelected}
                    examType={examType}
                    optionsType={optionsType}
                    form={form}
                    currentQuestionIndex={currentQuestionIndex}
                    onOptionChange={onOptionChange}
                />
            </div>
        </div>
    );
};

// Helper component for explanation section
const ExplanationSection = ({ form, currentQuestionIndex }: { form: any; currentQuestionIndex: number }) => {
    const { t } = useTranslation('assessmentTrueFalseTemplateQP');
    const explanationsType = form.getValues('explanationsType') || t('explanationSection.defaultLabel');

    return (
            <div className="mb-6 flex w-full flex-col !flex-nowrap items-start gap-1">
                <span>{explanationsType}</span>
                <FormField
                control={form.control}
                    name={`questions.${currentQuestionIndex}.explanation`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <RichTextEditor
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
    );
};

export const TrueFalseQuestionPaperTemplateMainView = ({
    form,
    currentQuestionIndex,
    className,
    showQuestionNumber = true,
    examType = 'EXAM',
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentTrueFalseTemplateQP');
    const { control, getValues, setValue } = form;
    const questionsType = getValues('questionsType') || '';
    const optionsType = getValues('optionsType') || '';
    const allQuestions = getValues('questions') || [];
    const tags = getValues(`questions.${currentQuestionIndex}.tags`) || [];
    const level = getValues(`questions.${currentQuestionIndex}.level`) || '';

    const handleOptionChange = (optionIndex: number) => {
        // For survey questions, don't handle correct answer selection
        if (examType === 'SURVEY') {
            return;
        }

        const options = [0, 1];
        const isCurrentlySelected = getValues(
            `questions.${currentQuestionIndex}.trueFalseOptions.${optionIndex}.isSelected`
        );

        options.forEach((option) => {
            setValue(
                `questions.${currentQuestionIndex}.trueFalseOptions.${option}.isSelected`,
                option === optionIndex ? !isCurrentlySelected : false,
                { shouldDirty: true, shouldValidate: true }
            );
        });
        form.trigger(`questions.${currentQuestionIndex}.trueFalseOptions`);
    };

    useEffect(() => {
        setValue(`questions.${currentQuestionIndex}.trueFalseOptions.${0}.name`, 'True');
        setValue(`questions.${currentQuestionIndex}.trueFalseOptions.${1}.name`, 'False');
    }, [currentQuestionIndex, setValue]);

    if (allQuestions.length === 0) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <h1>{t('emptyState.message')}</h1>
            </div>
        );
    }

    return (
        <div className={className}>

            <QuestionHeader
                form={form}
                currentQuestionIndex={currentQuestionIndex}
                showQuestionNumber={showQuestionNumber}
                questionsType={questionsType}
                level={level}
                tags={tags}
            />

            <TrueFalseOptions
                form={form}
                currentQuestionIndex={currentQuestionIndex}
                examType={examType}
                optionsType={optionsType}
                onOptionChange={handleOptionChange}
            />

            <ExplanationSection form={form} currentQuestionIndex={currentQuestionIndex} />
        </div>
    );
};
