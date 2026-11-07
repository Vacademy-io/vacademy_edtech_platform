import { QuestionType } from '@/constants/dummy-data';
import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { Dispatch, MutableRefObject, SetStateAction, useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { DialogTrigger } from '@radix-ui/react-dialog';
import { PencilSimpleLine } from '@phosphor-icons/react';
import { zodResolver } from '@hookform/resolvers/zod';

type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

import { useRef } from 'react'; // Add useRef import
import { StudyLibraryQuestion } from '@/types/study-library/study-library-video-questions';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { useSlides } from '../../-hooks/use-slides';
import { converDataToVideoFormat } from '../../-helper/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Route } from '../..';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const VideoQuestionDialogEditPreview = ({
    formRefData,
    question,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    updateQuestion, // Add updateQuestion prop
}: {
    formRefData: MutableRefObject<UploadQuestionPaperFormType>;
    question?: StudyLibraryQuestion;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    updateQuestion?: (question: StudyLibraryQuestion) => void; // New prop for updating state
}) => {
    const { t } = useTranslation('studyLibraryVideoQuestionDialogEditPreview');
    const { activeItem, setActiveItem } = useContentStore();
    // Slide context + save mutation so the edit persists to the backend on Save
    // (same wiring the split-screen dialog uses to reach addUpdateVideoSlide).
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } = Route.useSearch();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { addUpdateVideoSlide } = useSlides(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const [isSaving, setIsSaving] = useState(false);
    const form = useForm<QuestionPaperForm>({
        resolver: zodResolver(uploadQuestionPaperFormSchema()),
        mode: 'onChange',
        defaultValues: {
            questionPaperId: '',
            isFavourite: false,
            title: '',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            fileUpload: null as unknown as File,
            questions: [],
        },
    });

    const closeRef = useRef<HTMLButtonElement | null>(null);

    const handleEditQuestionInAddedForm = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();

        // The editor writes the edited question into form.questions[currentQuestionIndex]
        // (MainViewComponentFactory binds to that index). Read it back directly instead
        // of re-finding it by questionId in formRefData — that lookup could return -1
        // (e.g. blank/duplicate questionId) and silently abort the whole save.
        const updatedQuestions = form.getValues('questions');
        const updatedQuestion = Array.isArray(updatedQuestions)
            ? updatedQuestions[currentQuestionIndex]
            : undefined;

        if (!updatedQuestion) {
            closeRef.current?.click();
            return;
        }

        // Keep the compatibility ref in sync.
        if (formRefData.current?.questions?.[currentQuestionIndex] !== undefined) {
            formRefData.current.questions[currentQuestionIndex] = updatedQuestion;
        }

        // Commit the edit to the in-memory list so it reflects immediately.
        const updatedSlide: any = {
            ...activeItem,
            video_slide: {
                ...activeItem?.video_slide,
                questions: updatedQuestions,
            },
        };
        setActiveItem(updatedSlide);
        if (updateQuestion) {
            updateQuestion(updatedQuestion);
        }

        // Persist to the backend right away, keeping the slide's current status.
        // converDataToVideoFormat maps the in-memory (MyQuestion) questions to the
        // snake_case VideoSlideQuestionDTO shape the API expects.
        try {
            setIsSaving(true);
            const payload = converDataToVideoFormat({
                activeItem: updatedSlide,
                status: activeItem?.status || 'DRAFT',
                notify: false,
                newSlide: false,
            });
            await addUpdateVideoSlide(payload);
            toast.success(t('questionSaved'));
        } catch (err) {
            console.error('Failed to save video question:', err);
            toast.error(t('saveFailed'));
        } finally {
            setIsSaving(false);
            closeRef.current?.click();
        }
    };

    // Populate the edit form from the live questions in the store. Reading
    // formRefData.current on mount raced the parent's ref-sync effect (child
    // effects run before parent effects), so the ref was still empty here and the
    // form reset to [] -> "Nothing to show". Source the store directly (same data
    // the list renders) and re-sync whenever the questions change.
    useEffect(() => {
        const questions = (activeItem?.video_slide?.questions as unknown as
            | UploadQuestionPaperFormType['questions']
            | undefined) ?? [];
        form.reset({
            ...form.getValues(),
            questions: [...questions],
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeItem?.video_slide?.questions]);

    return (
        <Dialog>
            <DialogTrigger>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="default"
                    className="h-8 min-w-4"
                >
                    <PencilSimpleLine size={32} />
                </MyButton>
            </DialogTrigger>
            <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0">
                <div className="sticky top-0 z-10 flex w-full items-center justify-between bg-primary-50">
                    <h1 className="p-4 font-semibold text-primary-500">{t('question')}</h1>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        className="mr-4"
                        onClick={handleEditQuestionInAddedForm}
                        disable={isSaving}
                    >
                        {isSaving ? t('savingEllipsis') : t('save')}
                    </MyButton>
                </div>
                <div>
                    <FormProvider {...form}>
                        {form.getValues('questions')?.length === 0 ? (
                            <p>{t('nothingToShow')}</p>
                        ) : (
                            <div className="my-4 flex flex-col gap-2">
                                <MainViewComponentFactory
                                    key={currentQuestionIndex}
                                    type={
                                        form.getValues(
                                            `questions.${currentQuestionIndex}.questionType`
                                        ) as QuestionType
                                    }
                                    props={{
                                        form,
                                        currentQuestionIndex,
                                        setCurrentQuestionIndex,
                                        className:
                                            'dialog-height overflow-auto ml-6 flex w-full flex-col gap-6 pr-6 pt-4',
                                    }}
                                />
                            </div>
                        )}
                    </FormProvider>
                </div>
                <DialogClose asChild>
                    <button ref={closeRef} className="hidden" />
                </DialogClose>
            </DialogContent>
        </Dialog>
    );
};

export default VideoQuestionDialogEditPreview;
