import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { DotsThree } from '@phosphor-icons/react';
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

export const LongAnswerQuestionPaperTemplatePPTView = ({
    form,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    className,
}: QuestionPaperTemplateFormProps) => {
    const { t } = useTranslation('assessmentLongAnswerPPTQP');
    const { control, getValues, setValue } = form;

    const [isDropdownVisible, setIsDropdownVisible] = useState(false); // State to track dropdown visibility
    const [isDropdownOpen, setIsDropdownOpen] = useState(false); // State for dropdown open state

    const allQuestions = getValues('questions') || [];

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
                singleChoiceOptions: questionToDuplicate.singleChoiceOptions || [],
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
