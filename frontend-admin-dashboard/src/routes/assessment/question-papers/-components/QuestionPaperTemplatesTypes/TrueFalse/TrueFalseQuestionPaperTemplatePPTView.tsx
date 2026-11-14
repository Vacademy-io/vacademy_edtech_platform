import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { DotsThree } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import 'react-quill/dist/quill.snow.css';
import { PPTViewQuillEditor } from '@/components/quill/PPTViewQuillEditor';
import { QuestionPaperTemplateFormProps } from '../../../-utils/question-paper-template-form';
import { formatStructure } from '../../../-utils/helper';

export const TrueFalseQuestionPaperTemplatePPTView = ({
    form,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    className,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentTrueFalsePPTViewQP');
    const { control, getValues, setValue } = form;

    const [isDropdownVisible, setIsDropdownVisible] = useState(false); // State to track dropdown visibility
    const [isDropdownOpen, setIsDropdownOpen] = useState(false); // State for dropdown open state

    const optionsType = getValues('optionsType') || '';
    const allQuestions = getValues('questions') || [];
    const option1 = getValues(`questions.${currentQuestionIndex}.trueFalseOptions.${0}`);
    const option2 = getValues(`questions.${currentQuestionIndex}.trueFalseOptions.${1}`);

    const handleDeleteSlide = () => {
        // If this is the last question, decrease the current question index
        if (currentQuestionIndex === allQuestions.length - 1 && currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }

        // Remove the current question from the questions array
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
                trueFalseOptions: questionToDuplicate.trueFalseOptions || [],
            };
            allQuestions.splice(currentQuestionIndex, 0, duplicatedQuestion);
            setValue('questions', allQuestions);
        }
    };

    const handleOptionChange = (optionIndex: number) => {
        const options = [0, 1, 2, 3];

        // Check current state of the selected option
        const isCurrentlySelected = getValues(
            `questions.${currentQuestionIndex}.trueFalseOptions.${optionIndex}.isSelected`
        );

        options.forEach((option) => {
            setValue(
                `questions.${currentQuestionIndex}.trueFalseOptions.${option}.isSelected`,
                option === optionIndex ? !isCurrentlySelected : false // Toggle only the selected option
            );
        });
    };

    return (
        <div
            className={className}
            onMouseEnter={() => setIsDropdownVisible(true)}
            onMouseLeave={() => !isDropdownOpen && setIsDropdownVisible(false)}
        >
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
            <div className="flex w-full grow flex-col gap-2">
                <div className="flex gap-2">
                    <div
                        className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-2 ${
                            option1?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                        }`}
                    >
                        <div className="flex w-full items-center gap-4">
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                <span className="!p-0 text-sm">
                                    {optionsType
                                        ? formatStructure(optionsType, 'a')
                                        : t('optionMarker.fallback', { label: 'a' })}
                                </span>
                            </div>
                        </div>
                        <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                            <FormField
                                control={control}
                                name={`questions.${currentQuestionIndex}.trueFalseOptions.${0}.isSelected`}
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
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>
                    <div
                        className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-2 ${
                            option2?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                        }`}
                    >
                        <div className="flex w-full items-center gap-4">
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                <span className="!p-0 text-sm">
                                    {optionsType
                                        ? formatStructure(optionsType, 'b')
                                        : t('optionMarker.fallback', { label: 'b' })}
                                </span>
                            </div>
                        </div>
                        <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                            <FormField
                                control={control}
                                name={`questions.${currentQuestionIndex}.trueFalseOptions.${1}.isSelected`}
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
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>
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
                                {t('dropdownMenu.duplicateSlide')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleDeleteSlide}>
                                {t('dropdownMenu.deleteSlide')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
};
