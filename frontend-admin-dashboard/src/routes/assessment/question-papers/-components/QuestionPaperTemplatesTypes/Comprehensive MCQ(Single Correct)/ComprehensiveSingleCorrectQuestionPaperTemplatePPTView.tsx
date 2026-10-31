import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import 'react-quill/dist/quill.snow.css';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';
import { PPTViewQuillEditor } from '@/components/quill/PPTViewQuillEditor';
import { useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { DotsThree } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export const ComprehensiveSingleCorrectQuestionPaperTemplatePPTView = ({
    form,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    className,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentComprehensiveSingleCorrectPPTQP');
    const { control, getValues, setValue } = form;
    const optionsType = getValues('optionsType') || '';
    const allQuestions = getValues('questions') || [];
    const [isDropdownVisible, setIsDropdownVisible] = useState(false); // State to track dropdown visibility
    const [isDropdownOpen, setIsDropdownOpen] = useState(false); // State for dropdown open state

    // Only the options a question actually has are rendered. A FormField on
    // `.N.isSelected` registers that path, and for a question with fewer than
    // four options RHF then adds a phantom option with no text, which the
    // paper save rejected (e.g. an extracted question whose options were images).
    const option1 = getValues(`questions.${currentQuestionIndex}.csingleChoiceOptions.${0}`);
    const option2 = getValues(`questions.${currentQuestionIndex}.csingleChoiceOptions.${1}`);
    const option3 = getValues(`questions.${currentQuestionIndex}.csingleChoiceOptions.${2}`);
    const option4 = getValues(`questions.${currentQuestionIndex}.csingleChoiceOptions.${3}`);

    const handleOptionChange = (optionIndex: number) => {
        // Only the options this question has: setting `.N.isSelected` on one it
        // doesn't have creates a phantom option with no text.
        const options = (
            getValues(`questions.${currentQuestionIndex}.csingleChoiceOptions`) ?? []
        ).map((_, i) => i);

        // Check current state of the selected option
        const isCurrentlySelected = getValues(
            `questions.${currentQuestionIndex}.csingleChoiceOptions.${optionIndex}.isSelected`
        );

        options.forEach((option) => {
            setValue(
                `questions.${currentQuestionIndex}.csingleChoiceOptions.${option}.isSelected`,
                option === optionIndex ? !isCurrentlySelected : false // Toggle only the selected option
            );
        });
    };

    const handleDeleteSlide = () => {
        // If this is the last question, decrease the current question index
        if (currentQuestionIndex === allQuestions.length - 1 && currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }
        allQuestions.splice(currentQuestionIndex, 1);
        setValue('questions', allQuestions);
        form.trigger();
    };

    const handleDuplicateSlide = () => {
        const questionToDuplicate = allQuestions[currentQuestionIndex];
        if (questionToDuplicate) {
            const duplicatedQuestion = {
                ...questionToDuplicate,
                questionId: questionToDuplicate.questionId || '',
                questionName: questionToDuplicate.questionName || '',
                explanation: questionToDuplicate.explanation || '',
                cmultipleChoiceOptions: questionToDuplicate.csingleChoiceOptions || [],
            };
            allQuestions.splice(currentQuestionIndex, 0, duplicatedQuestion);
            setValue('questions', allQuestions);
        }
    };

    return (
        <div
            className={className}
            onMouseEnter={() => setIsDropdownVisible(true)}
            onMouseLeave={() => !isDropdownOpen && setIsDropdownVisible(false)}
        >
            {getValues(`questions.${currentQuestionIndex}.parentRichTextContent`) && (
                <div className="flex w-full flex-col !flex-nowrap items-start gap-1">
                    <span>{t('comprehensionText')}</span>
                    <FormField
                        control={control}
                        name={`questions.${currentQuestionIndex}.parentRichTextContent`}
                        render={({ field }) => (
                            <FormItem className="w-full">
                                <FormControl>
                                    <PPTViewQuillEditor
                                        value={field.value}
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
                <FormField
                    control={control}
                    name={`questions.${currentQuestionIndex}.questionName`}
                    render={({ field }) => (
                        <FormItem className="w-full">
                            <FormControl>
                                <PPTViewQuillEditor value={field.value} onChange={field.onChange} />
                            </FormControl>
                        </FormItem>
                    )}
                />
            </div>

            <div className="flex w-full grow flex-col gap-4">
                <div className="flex gap-4">
                    {option1 && (
                        <div
                            className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-4 ${
                                option1?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                            }`}
                        >
                            <div className="flex w-full items-center gap-4">
                                <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                    <span className="!p-0 text-sm">
                                        {optionsType
                                            ? formatStructure(optionsType, 'a')
                                            : t('optionLabelFallback', { letter: 'a' })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                                <FormField
                                    control={control}
                                    name={`questions.${currentQuestionIndex}.csingleChoiceOptions.${0}.isSelected`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={() => handleOptionChange(0)}
                                                    className={`mt-1 size-5 rounded-xl border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-green-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}
                    {option2 && (
                        <div
                            className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-4 ${
                                option2?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                            }`}
                        >
                            <div className="flex w-full items-center gap-4">
                                <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                    <span className="!p-0 text-sm">
                                        {optionsType
                                            ? formatStructure(optionsType, 'b')
                                            : t('optionLabelFallback', { letter: 'b' })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                                <FormField
                                    control={control}
                                    name={`questions.${currentQuestionIndex}.csingleChoiceOptions.${1}.isSelected`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={() => handleOptionChange(1)}
                                                    className={`mt-1 size-5 rounded-xl border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-green-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex gap-4">
                    {option3 && (
                        <div
                            className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-4 ${
                                option3?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                            }`}
                        >
                            <div className="flex w-full items-center gap-4">
                                <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                    <span className="!p-0 text-sm">
                                        {optionsType
                                            ? formatStructure(optionsType, 'c')
                                            : t('optionLabelFallback', { letter: 'c' })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                                <FormField
                                    control={control}
                                    name={`questions.${currentQuestionIndex}.csingleChoiceOptions.${2}.isSelected`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={() => handleOptionChange(2)}
                                                    className={`mt-1 size-5 rounded-xl border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-green-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}
                    {option4 && (
                        <div
                            className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-4 ${
                                option4?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                            }`}
                        >
                            <div className="flex w-full items-center gap-4">
                                <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                    <span className="!p-0 text-sm">
                                        {optionsType
                                            ? formatStructure(optionsType, 'd')
                                            : t('optionLabelFallback', { letter: 'd' })}
                                    </span>
                                </div>
                            </div>
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                                <FormField
                                    control={control}
                                    name={`questions.${currentQuestionIndex}.csingleChoiceOptions.${3}.isSelected`}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={() => handleOptionChange(3)}
                                                    className={`mt-1 size-5 rounded-xl border-2 shadow-none ${
                                                        field.value
                                                            ? 'border-none bg-green-500 text-white' // Blue background and red tick when checked
                                                            : '' // Default styles when unchecked
                                                    }`}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="absolute bottom-10 right-12">
                {(isDropdownVisible || isDropdownOpen) && (
                    <DropdownMenu
                        onOpenChange={(open) => {
                            setIsDropdownOpen(open);
                            if (!open) setIsDropdownVisible(false); // Reset visibility when closed
                        }}
                    >
                        <DropdownMenuTrigger>
                            <Button
                                type="button"
                                variant="outline"
                                className="scale-[2] border-2 border-primary-300 px-3 font-bold"
                            >
                                <DotsThree size="32" className="font-bold" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="mt-1">
                            <DropdownMenuItem onClick={handleDuplicateSlide}>
                                {t('duplicateSlide')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleDeleteSlide}>
                                {t('deleteSlide')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
};
