import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { DotsThree } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { useState } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import 'react-quill/dist/quill.snow.css';
import { PPTViewQuillEditor } from '@/components/quill/PPTViewQuillEditor';
import { SectionQuestionPaperFormProps } from '../../../-utils/assessment-question-paper';
import { useTranslation } from 'react-i18next';

interface ImageDetail {
    imageId: string;
    imageName: string;
    imageTitle: string;
    imageFile: string;
    isDeleted: boolean;
}

interface ChoiceOption {
    name: string;
    isSelected: boolean;
    image: ImageDetail;
}

export const SingleCorrectQuestionPaperTemplatePPTView = ({
    form,
    selectedSection,
    currentQuestionIndexes,
    setCurrentQuestionIndexes,
    currentQuestionIndex,
    className,
    selectedSectionIndex,
}: SectionQuestionPaperFormProps) => {
    const { control, getValues, setValue } = form;
    const { t } = useTranslation('homeworkCreationSingleCorrectPPTView');

    const [isDropdownVisible, setIsDropdownVisible] = useState(false); // State to track dropdown visibility
    const [isDropdownOpen, setIsDropdownOpen] = useState(false); // State for dropdown open state
    const allQuestions = getValues(`sections.${selectedSectionIndex}.questions`) || [];
    const option1 = getValues(
        `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${0}`
    ) as ChoiceOption;
    const option2 = getValues(
        `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${1}`
    ) as ChoiceOption;
    const option3 = getValues(
        `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${2}`
    ) as ChoiceOption;
    const option4 = getValues(
        `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${3}`
    ) as ChoiceOption;

    const handleDeleteSlide = () => {
        const currentIndex = currentQuestionIndexes[selectedSection] ?? 0; // Default to 0
        if (
            currentIndex !== undefined && // This check is now redundant but kept for clarity
            currentIndex === allQuestions.length - 1 &&
            currentIndex > 0
        ) {
            setCurrentQuestionIndexes((prev) => {
                const updatedIndexes = {
                    ...prev,
                    [selectedSection]: Math.max(0, currentIndex - 1),
                };
                return updatedIndexes;
            });
        }

        allQuestions.splice(currentIndex, 1);
        setValue(`sections.${selectedSectionIndex}.questions`, allQuestions); // Ensure new reference
    };

    const handleDuplicateSlide = () => {
        const questionToDuplicate = allQuestions[currentQuestionIndex];
        if (questionToDuplicate) {
            const duplicatedQuestion = {
                ...questionToDuplicate,
                questionId: questionToDuplicate.questionId || '',
                questionName: questionToDuplicate.questionName || '',
                explanation: questionToDuplicate.explanation || '',
                singleChoiceOptions: questionToDuplicate.singleChoiceOptions || [],
            };
            allQuestions.splice(currentQuestionIndex, 0, duplicatedQuestion);
            setValue(`sections.${selectedSectionIndex}.questions`, allQuestions);
        }
    };

    const handleOptionChange = (optionIndex: number) => {
        const options = [0, 1, 2, 3];

        // Check current state of the selected option
        const isCurrentlySelected = getValues(
            `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${optionIndex}.isSelected`
        );

        options.forEach((option) => {
            setValue(
                `sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${option}.isSelected`,
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
                    name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.questionName`}
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
                                <span className="!p-0 text-sm">{t('optionLabels.a')}</span>
                            </div>
                        </div>
                        <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                            <FormField
                                control={control}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${0}.isSelected`}
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
                                <span className="!p-0 text-sm">{t('optionLabels.b')}</span>
                            </div>
                        </div>
                        <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                            <FormField
                                control={control}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${1}.isSelected`}
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
                <div className="flex gap-2">
                    <div
                        className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-2 ${
                            option3?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                        }`}
                    >
                        <div className="flex w-full items-center gap-4">
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                <span className="!p-0 text-sm">{t('optionLabels.c')}</span>
                            </div>
                        </div>
                        <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                            <FormField
                                control={control}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${2}.isSelected`}
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
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>
                    <div
                        className={`flex w-1/2 items-center justify-between gap-4 rounded-md bg-neutral-100 p-2 ${
                            option4?.isSelected ? 'border border-primary-300 bg-primary-50' : ''
                        }`}
                    >
                        <div className="flex w-full items-center gap-4">
                            <div className="flex size-10 items-center justify-center rounded-full bg-white px-3">
                                <span className="!p-0 text-sm">{t('optionLabels.d')}</span>
                            </div>
                        </div>
                        <div className="flex size-10 items-center justify-center rounded-full bg-white px-4">
                            <FormField
                                control={control}
                                name={`sections.${selectedSectionIndex}.questions.${currentQuestionIndex}.singleChoiceOptions.${3}.isSelected`}
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
                                {t('menu.duplicateSlide')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleDeleteSlide}>
                                {t('menu.deleteSlide')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
};
