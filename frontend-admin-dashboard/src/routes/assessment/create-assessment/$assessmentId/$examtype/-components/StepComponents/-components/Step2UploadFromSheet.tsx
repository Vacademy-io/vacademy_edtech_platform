import { Dispatch, SetStateAction, useRef, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { FileCsv, X } from '@phosphor-icons/react';
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from '@/components/ui/alert-dialog';
import { QuestionPaperUpload } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import QuizAddViaCSVDialog from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-components/quiz/components/QuizAddViaCSVDialog';
import { MyQuestion } from '@/types/assessments/question-paper-form';
import sectionDetailsSchema from '../../../-utils/section-details-schema';

type SectionFormType = z.infer<typeof sectionDetailsSchema>;
type SectionQuestions = SectionFormType['section'][number]['adaptive_marking_for_each_question'];

/**
 * "Upload CSV / Excel" for a section: the quiz's sheet reader, then the same
 * review-and-save dialog a manually created paper uses — the teacher checks
 * the questions there, names the paper and saves it, and the section gets the
 * saved questions exactly as with a document upload.
 *
 * The review opens once the sheet dialog closes, so rows it skipped are seen
 * first. Closing the review without saving puts the section back as it was.
 */
const Step2UploadFromSheet = ({
    form,
    index,
    examType,
    defaultSubject,
    currentQuestionIndex,
    setCurrentQuestionIndex,
}: {
    form: UseFormReturn<SectionFormType>;
    index: number;
    examType: string;
    defaultSubject?: string;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
}) => {
    const { t } = useTranslation('assessmentStep2SectionInfo');
    const [sheetOpen, setSheetOpen] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewQuestions, setReviewQuestions] = useState<MyQuestion[] | null>(null);
    const [reviewKey, setReviewKey] = useState(0);
    // The sheet dialog reports its questions and closes in the same click, so the
    // close handler reads them from a ref — the state update is not visible yet.
    const pending = useRef<MyQuestion[] | null>(null);
    // The review mirrors the sheet's questions into the section while the teacher
    // checks them; closing it without saving must not leave those unsaved rows.
    const snapshot = useRef<{ questions: SectionQuestions; totalMarks: string } | null>(null);

    const handleQuestionsReady = (questions: MyQuestion[]) => {
        // Numbered like questions added by hand in the paper editor.
        pending.current = questions.map((question, i) => ({
            ...question,
            questionId: question.questionId || String(i + 1),
        }));
    };

    const handleSheetOpenChange = (open: boolean) => {
        setSheetOpen(open);
        const ready = pending.current;
        if (open || !ready || ready.length === 0) return;
        snapshot.current = {
            questions: [
                ...(form.getValues(`section.${index}.adaptive_marking_for_each_question`) ?? []),
            ],
            totalMarks: form.getValues(`section.${index}.total_marks`) ?? '',
        };
        setReviewQuestions(ready);
        setReviewKey((k) => k + 1);
        setReviewOpen(true);
    };

    const closeReview = (saved: boolean) => {
        const before = snapshot.current;
        if (!saved && before) {
            form.setValue(`section.${index}.adaptive_marking_for_each_question`, before.questions);
            form.setValue(`section.${index}.total_marks`, before.totalMarks);
            form.trigger(`section.${index}.adaptive_marking_for_each_question`);
        }
        snapshot.current = null;
        pending.current = null;
        setReviewOpen(false);
        setReviewQuestions(null);
    };

    return (
        <>
            <button
                type="button"
                onClick={() => {
                    pending.current = null;
                    setSheetOpen(true);
                }}
                className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-md"
            >
                <div className="flex size-10 items-center justify-center rounded-lg bg-success-50 text-success-600 transition-colors group-hover:bg-success-500 group-hover:text-white">
                    <FileCsv size={20} weight="bold" />
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold text-neutral-800">
                        {t('uploadSection.csvCard.title')}
                    </div>
                    <div className="text-xs text-neutral-500">
                        {t('uploadSection.csvCard.subtitle')}
                    </div>
                </div>
            </button>
            <QuizAddViaCSVDialog
                open={sheetOpen}
                onOpenChange={handleSheetOpenChange}
                onQuestionsReady={(questions) => handleQuestionsReady(questions as MyQuestion[])}
            />
            <AlertDialog
                open={reviewOpen}
                onOpenChange={(open) => {
                    if (!open) closeReview(false);
                }}
            >
                <AlertDialogContent className="p-0">
                    <div className="flex items-center justify-between rounded-md bg-primary-50">
                        <h1 className="rounded-sm p-4 font-bold text-primary-500">
                            {t('uploadSection.csvDialog.title')}
                        </h1>
                        <AlertDialogCancel
                            className="border-none bg-primary-50 shadow-none hover:bg-primary-50"
                            onClick={() => closeReview(false)}
                        >
                            <X className="text-neutral-600" />
                        </AlertDialogCancel>
                    </div>
                    {reviewOpen && reviewQuestions && (
                        <QuestionPaperUpload
                            key={reviewKey}
                            isManualCreated={true}
                            index={index}
                            sectionsForm={form}
                            currentQuestionIndex={currentQuestionIndex}
                            setCurrentQuestionIndex={setCurrentQuestionIndex}
                            examType={examType}
                            defaultSubject={defaultSubject}
                            initialQuestions={reviewQuestions}
                            onSaved={() => closeReview(true)}
                        />
                    )}
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default Step2UploadFromSheet;
