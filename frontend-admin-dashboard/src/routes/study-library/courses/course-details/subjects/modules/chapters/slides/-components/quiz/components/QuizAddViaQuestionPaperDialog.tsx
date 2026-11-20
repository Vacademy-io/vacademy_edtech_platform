import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { X } from '@phosphor-icons/react';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from '@/components/ui/dialog';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { QuestionType } from '@/constants/dummy-data';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import { QuestionPapersTabs } from '@/routes/assessment/question-papers/-components/QuestionPapersTabs';
import QuestionSelectorDialog from '@/routes/assessment/question-papers/-components/QuestionSelectorDialog';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { isCbeQuestionType } from '@/routes/assessment/question-papers/-utils/cbe-question';

type QuizQuestion = UploadQuestionPaperFormType['questions'][number];

/** The question types a quiz slide can hold (the same list as "Add Manually"). */
const QUIZ_QUESTION_TYPES = new Set<string>([
    QuestionType.MCQS,
    QuestionType.MCQM,
    QuestionType.NUMERIC,
    QuestionType.TRUE_FALSE,
    QuestionType.LONG_ANSWER,
    QuestionType.ONE_WORD,
    QuestionType.CBE_RESPONSE,
    QuestionType.CMCQS,
    QuestionType.CMCQM,
    QuestionType.CNUMERIC,
]);

const withoutIds = <T extends { id?: string }>(options: T[] | undefined): T[] | undefined =>
    options?.map((option) => ({ ...option, id: '' }));

/**
 * A paper question becomes a NEW quiz question. The ids it carries belong to the
 * assessment service, so they are all dropped and the quiz save mints its own: reusing
 * them would make two quizzes (or one paper added twice) point at the same rows.
 */
const toQuizQuestion = (question: MyQuestion): QuizQuestion => ({
    ...question,
    id: '',
    questionId: undefined,
    status: undefined,
    newQuestion: true,
    singleChoiceOptions: withoutIds(question.singleChoiceOptions) ?? [],
    multipleChoiceOptions: withoutIds(question.multipleChoiceOptions) ?? [],
    csingleChoiceOptions: withoutIds(question.csingleChoiceOptions) ?? [],
    cmultipleChoiceOptions: withoutIds(question.cmultipleChoiceOptions) ?? [],
    trueFalseOptions: withoutIds(question.trueFalseOptions) ?? [],
    // Admin reads of a paper return the full Spreadsheet & Written Response config, so the
    // quiz owns its solution half and saves it with the new question.
    ...(isCbeQuestionType(question.questionType) ? { cbeSecretStatus: 'owned' as const } : {}),
});

interface QuizAddViaQuestionPaperDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onQuestionsReady: (questions: UploadQuestionPaperFormType['questions']) => void;
}

/**
 * Add questions to a quiz slide from a saved question paper — the same picker as
 * "Choose Saved Paper" in assessment creation: pick a paper, then take all of it, a
 * random number, a number per tag, or choose questions one by one.
 */
const QuizAddViaQuestionPaperDialog = ({
    open,
    onOpenChange,
    onQuestionsReady,
}: QuizAddViaQuestionPaperDialogProps) => {
    const { t } = useTranslation('studyLibraryQuizAddViaQuestionPaperDialog');
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [selectorQuestions, setSelectorQuestions] = useState<MyQuestion[]>([]);

    const handleQuestionsPicked = (
        questions: MyQuestion[],
        { chooseManually }: { chooseManually: boolean }
    ) => {
        onOpenChange(false);

        if (questions.length === 0) {
            toast.error(t('toast.noQuestions'));
            return;
        }
        const supported = questions.filter((q) => QUIZ_QUESTION_TYPES.has(q.questionType));
        const skipped = questions.length - supported.length;
        if (skipped > 0) {
            toast.warning(t('toast.unsupportedSkipped', { count: skipped }));
        }
        if (supported.length === 0) return;

        if (chooseManually) {
            setSelectorQuestions(supported);
            setSelectorOpen(true);
            return;
        }
        onQuestionsReady(supported.map(toQuizQuestion));
    };

    const closeSelector = () => {
        setSelectorOpen(false);
        setSelectorQuestions([]);
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="no-scrollbar !m-0 flex max-h-dialog-tall w-dialog-xl flex-col items-start !gap-0 overflow-y-auto !p-0 [&>button]:hidden">
                    <DialogTitle className="sr-only">{t('title')}</DialogTitle>
                    <DialogDescription className="sr-only">{t('description')}</DialogDescription>
                    <div className="flex h-14 w-full items-center justify-between rounded-md bg-primary-50">
                        <h1 className="rounded-sm p-4 font-bold text-primary-500">{t('title')}</h1>
                        <DialogClose className="mr-4 !border-none bg-primary-50 shadow-none hover:bg-primary-50">
                            <X className="text-neutral-600" />
                        </DialogClose>
                    </div>
                    <div className="size-full overflow-y-auto p-8">
                        <Suspense fallback={<DashboardLoader />}>
                            <QuestionPapersTabs
                                isAssessment={true}
                                currentQuestionIndex={currentQuestionIndex}
                                setCurrentQuestionIndex={setCurrentQuestionIndex}
                                onQuestionsPicked={handleQuestionsPicked}
                            />
                        </Suspense>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Manual mode: rendered outside the paper dialog so it stays mounted once that closes */}
            <QuestionSelectorDialog
                open={selectorOpen}
                onOpenChange={(next) => !next && closeSelector()}
                questions={selectorQuestions}
                onConfirm={(selected) => {
                    closeSelector();
                    if (selected.length > 0) onQuestionsReady(selected.map(toQuizQuestion));
                }}
            />
        </>
    );
};

export default QuizAddViaQuestionPaperDialog;
