import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { X } from '@phosphor-icons/react';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import QuestionDisplay from './QuestionDisplay';
import { TransformedQuestion } from '../types';

type QuizQuestion = UploadQuestionPaperFormType['questions'][0];

interface PreviewItem {
    key: string;
    question: QuizQuestion;
}

interface QuizQuestionsPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    questions: UploadQuestionPaperFormType['questions'];
    onConfirm: (questions: UploadQuestionPaperFormType['questions']) => void;
    isLoading?: boolean;
}

const QuizQuestionsPreviewDialog = ({
    open,
    onOpenChange,
    questions,
    onConfirm,
    isLoading = false,
}: QuizQuestionsPreviewDialogProps) => {
    const { t } = useTranslation('studyLibraryQuizQuestionsPreviewDialog');
    const keyCounter = useRef(0);
    const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);

    // Reset the list with fresh stable keys every time the dialog opens
    useEffect(() => {
        if (open) {
            setPreviewItems(
                questions.map((q) => ({ key: String(keyCounter.current++), question: q }))
            );
        }
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDelete = (index: number) => {
        setPreviewItems((prev) => prev.filter((_, i) => i !== index));
    };

    const handleConfirm = () => {
        onConfirm(previewItems.map((item) => item.question));
    };

    const mapOptions = (opts?: any[]) =>
        opts?.map(o => ({
            id: o.id || '',
            name: o.name || '',
            isSelected: o.isSelected || false
        }));

    const toTransformedQuestion = (q: QuizQuestion, index: number): TransformedQuestion => ({
        id: (q as any).id || `preview-${index}`,
        questionName: q.questionName || '',
        questionType: q.questionType || 'MCQS',
        questionPenalty: q.questionPenalty || '0',
        questionMark: q.questionMark || '1',
        questionDuration: q.questionDuration || { hrs: '0', min: '0' },
        explanation: q.explanation || '',
        validAnswers: q.validAnswers ?? [0],
        canSkip: q.canSkip ?? false,
        tags: q.tags ?? [],
        parentRichTextContent: q.parentRichTextContent || '',
        subjectiveAnswerText: q.subjectiveAnswerText || '',
        decimals: q.decimals ?? 0,
        numericType: q.numericType || '',
        singleChoiceOptions: mapOptions(q.singleChoiceOptions),
        multipleChoiceOptions: mapOptions(q.multipleChoiceOptions),
        trueFalseOptions: mapOptions(q.trueFalseOptions),
        csingleChoiceOptions: mapOptions(q.csingleChoiceOptions),
        cmultipleChoiceOptions: mapOptions(q.cmultipleChoiceOptions),
    });

    const count = previewItems.length;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-neutral-200 bg-primary-50 px-6 py-4">
                    <h1 className="font-semibold text-primary-500">
                        {t('previewQuestions', { count })}
                    </h1>
                    <button
                        type="button"
                        className="text-neutral-500 hover:text-neutral-700"
                        onClick={() => onOpenChange(false)}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Question List */}
                <div className="flex-1 space-y-4 overflow-y-auto bg-neutral-50 px-6 py-5">
                    {previewItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <p className="text-sm text-neutral-500">
                                {t('allQuestionsRemoved')}
                            </p>
                        </div>
                    ) : (
                        previewItems.map((item, index) => (
                            <QuestionDisplay
                                key={item.key}
                                question={toTransformedQuestion(item.question, index)}
                                questionIndex={index}
                                displayNumber={index + 1}
                                onEdit={() => {}}
                                onDelete={handleDelete}
                            />
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-neutral-200 bg-white px-6 py-4">
                    <p className="text-sm text-neutral-500">
                        {t('questionsWillBeAdded', { count })}
                    </p>
                    <div className="flex gap-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            onClick={() => onOpenChange(false)}
                            disabled={isLoading}
                        >
                            {t('cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            onClick={handleConfirm}
                            disabled={count === 0 || isLoading}
                        >
                            {isLoading ? t('adding') : t('addQuestionsToQuiz', { count })}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default QuizQuestionsPreviewDialog;
