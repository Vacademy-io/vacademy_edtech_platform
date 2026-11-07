import { QuestionType } from '@/constants/dummy-data';
import { MainViewComponentFactory } from '@/routes/assessment/question-papers/-components/QuestionPaperTemplatesTypes/MainViewComponentFactory';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { FormProvider, UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { VideoPlayerTimeFormType } from '../../-form-schemas/video-player-time-schema';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { useSlides } from '../../-hooks/use-slides';
import { converDataToVideoFormat } from '../../-helper/helper';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Route } from '../..';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

const VideoQuestionDialogAddPreview = ({
    videoQuestionForm,
    addedQuestionForm,
    videoPlayerTimeFrameForm,
    formRefData,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    previewQuestionDialog,
    setPreviewQuestionDialog,
    formData,
    setFormData,
    isAddTimeFrameRef,
    isAddQuestionTypeRef,
}: {
    videoQuestionForm: UseFormReturn<QuestionPaperForm>;
    addedQuestionForm: UseFormReturn<QuestionPaperForm>;
    videoPlayerTimeFrameForm: UseFormReturn<VideoPlayerTimeFormType>;
    formRefData: MutableRefObject<UploadQuestionPaperFormType>;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: Dispatch<SetStateAction<number>>;
    previewQuestionDialog: boolean;
    setPreviewQuestionDialog: Dispatch<SetStateAction<boolean>>;
    formData: UploadQuestionPaperFormType;
    setFormData: Dispatch<SetStateAction<UploadQuestionPaperFormType>>;
    isAddTimeFrameRef: React.RefObject<HTMLButtonElement>;
    isAddQuestionTypeRef: React.RefObject<HTMLButtonElement>;
}) => {
    const { t } = useTranslation('studyLibraryVideoQuestionDialogAddPreview');
    const { activeItem, setActiveItem } = useContentStore();
    // Slide context + save mutation so a newly added question persists to the
    // backend right away (same wiring edit/delete already use).
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
    const handleClose = () => {
        setCurrentQuestionIndex(0);
        videoQuestionForm.reset({
            questionPaperId: '1',
            isFavourite: false,
            title: '',
            createdOn: new Date(),
            yearClass: '',
            subject: '',
            questionsType: '',
            optionsType: '',
            answersType: '',
            explanationsType: '',
            fileUpload: undefined,
            questions: [],
        });

        videoPlayerTimeFrameForm.reset({
            hrs: '',
            min: '',
            sec: '',
            canSkip: true,
        });
        setPreviewQuestionDialog(false);
        isAddTimeFrameRef.current?.click();
        isAddQuestionTypeRef.current?.click();
    };
    const handleAddQuestionInAddedForm = async () => {
        // Clone the questions properly to avoid reference issues
        const videoQuestions = JSON.parse(JSON.stringify(videoQuestionForm.getValues('questions')));

        // Update addedQuestionForm with deep-cloned data
        addedQuestionForm.reset({
            ...addedQuestionForm.getValues(),
            questions: [...addedQuestionForm.getValues('questions'), ...videoQuestions],
        });

        // Update formRefData with deep-cloned data
        formRefData.current = {
            ...formRefData.current,
            questions: [...formRefData.current.questions, ...videoQuestions],
        };

        // Update formData state with deep-cloned data
        setFormData((prevData) => ({
            ...prevData,
            questions: [...prevData.questions, ...videoQuestions],
        }));

        const updatedSlide: any = {
            ...activeItem,
            video_slide: {
                ...activeItem?.video_slide,
                questions: [...formData.questions, ...videoQuestions],
            },
        };
        setActiveItem(updatedSlide);

        // Persist the new question to the backend immediately, keeping the
        // slide's current status — same as the edit/delete flows. Without this
        // the question only lived in memory until a manual Save/Publish.
        try {
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
        }

        // Close after data is properly updated
        handleClose();
    };

    return (
        <Dialog open={previewQuestionDialog} onOpenChange={setPreviewQuestionDialog}>
            <DialogContent className="no-scrollbar !m-0 flex h-full !w-full !max-w-full flex-col !gap-0 overflow-y-auto !rounded-none !p-0 [&>button]:hidden">
                <div className="flex w-full items-center justify-between bg-primary-50">
                    <h1 className="p-4 font-semibold text-primary-500">{t('question')}</h1>
                    <div className="mr-4 flex items-center gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            layoutVariant="default"
                            className="mr-3"
                            onClick={() => setPreviewQuestionDialog(false)}
                        >
                            {t('close')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            layoutVariant="default"
                            className="mr-3"
                            onClick={handleAddQuestionInAddedForm}
                        >
                            {t('done')}
                        </MyButton>
                    </div>
                </div>
                <div>
                    <FormProvider {...videoQuestionForm}>
                        {videoQuestionForm.getValues('questions')?.length === 0 ? (
                            <p>{t('nothingToShow')}</p>
                        ) : (
                            <div className="my-4 flex flex-col gap-2">
                                <MainViewComponentFactory
                                    key={currentQuestionIndex}
                                    type={
                                        videoQuestionForm.getValues(
                                            `questions.${currentQuestionIndex}.questionType`
                                        ) as QuestionType
                                    }
                                    props={{
                                        form: videoQuestionForm,
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
            </DialogContent>
        </Dialog>
    );
};

export default VideoQuestionDialogAddPreview;
