import { MCQS, MCQM, Numerical, TrueFalse, LongAnswer, SingleWord, CMCQS, CMCQM } from '@/svgs';
import { QuestionType as QuestionTypeList } from '@/constants/dummy-data';
import { Separator } from '@/components/ui/separator';
import { z } from 'zod';
import { questionsFormSchema } from '@/routes/assessment/question-papers/-utils/question-form-schema';
import { useFieldArray, UseFormReturn } from 'react-hook-form';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { Dispatch, MutableRefObject, SetStateAction, useState } from 'react';
import { VideoPlayerTimeFormType } from '../../-form-schemas/video-player-time-schema';
import VideoQuestionDialogAddPreview from './video-question-dialog-add-preview';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { timestampToSeconds } from '../../-helper/helper';

export interface QuestionTypeProps {
    icon: React.ReactNode; // Accepts an SVG or any React component
    text: string; // Accepts the text label
    type?: QuestionTypeList;
    handleAddQuestion: (type: string) => void;
}

export type QuestionPaperFormType = z.infer<typeof questionsFormSchema>;
type QuestionPaperForm = z.infer<ReturnType<typeof uploadQuestionPaperFormSchema>>;

const QuestionType = ({
    icon,
    text,
    type = QuestionTypeList.MCQS,
    handleAddQuestion,
}: QuestionTypeProps) => {
    return (
        <div
            className="flex w-full cursor-pointer flex-row items-center gap-4 rounded-md border px-4 py-3"
            onClick={() => handleAddQuestion(type)}
        >
            {icon}
            <div className="text-body">{text}</div>
        </div>
    );
};

const AddVideoQuestionDialog = ({
    addedQuestionForm,
    videoQuestionForm,
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
    videoDuration,
}: {
    addedQuestionForm: UseFormReturn<QuestionPaperForm>;
    videoQuestionForm: UseFormReturn<QuestionPaperForm>;
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
    videoDuration: number;
}) => {
    const { t } = useTranslation('studyLibraryAddVideoQuestionDialog');
    const { append: appendVideoQuestion } = useFieldArray({
        control: videoQuestionForm.control,
        name: 'questions', // Name of the field array
    });

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { hrs, min, sec } = videoPlayerTimeFrameForm.watch();
    videoPlayerTimeFrameForm.watch('canSkip');
    const isButtonDisabled = !hrs && !min && !sec;

    // Function to handle adding a new question
    const handleAddQuestion = (newQuestionType: string) => {
        setCurrentQuestionIndex(0);
        videoQuestionForm.reset();
        appendVideoQuestion({
            id: '',
            questionId: String(formRefData.current.questions.length + 1),
            questionName: '',
            explanation: '',
            questionType: newQuestionType,
            questionPenalty: '',
            questionDuration: {
                hrs: '',
                min: '',
            },
            questionMark: '',
            singleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            multipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            csingleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            cmultipleChoiceOptions: Array(4).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            trueFalseOptions: Array(2).fill({
                id: '',
                name: '',
                isSelected: false,
            }),
            parentRichTextContent: '',
            decimals: 0,
            numericType: '',
            validAnswers: [],
            questionResponseType: '',
            subjectiveAnswerText: '',
            timestamp: `${videoPlayerTimeFrameForm.getValues(
                'hrs'
            )}:${videoPlayerTimeFrameForm.getValues('min')}:${videoPlayerTimeFrameForm.getValues(
                'sec'
            )}`,
            canSkip: videoPlayerTimeFrameForm.getValues('canSkip') || false,
        });
        videoQuestionForm.trigger();
        setPreviewQuestionDialog(true);
    };

    const handleNextClick = () => {
        if (handleCheckEligibilityForNext()) {
            setIsDialogOpen(true);
        }
    };

    const handleCheckEligibilityForNext = () => {
        const timestamp = timestampToSeconds(
            `${videoPlayerTimeFrameForm.getValues('hrs')}:${videoPlayerTimeFrameForm.getValues(
                'min'
            )}:${videoPlayerTimeFrameForm.getValues('sec')}`
        );
        if (timestamp === null || timestamp < 0 || timestamp > videoDuration) {
            toast.error(
                t('invalidTimestamp'),
                {
                    className: 'error-toast',
                    duration: 3000,
                }
            );
            return false;
        }
        return true;
    };

    return (
        <>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    className="mr-3"
                    disable={isButtonDisabled}
                    onClick={handleNextClick}
                >
                    {t('next')}
                </MyButton>
                <DialogContent className="size-[500px] p-0">
                    <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                        {t('addQuestion')}
                    </h1>
                    <div className="overflow-auto p-4">
                        <div className="flex flex-col gap-4">
                            <div className="text-subtitle font-semibold">{t('quickAccess')}</div>
                            <QuestionType
                                icon={<MCQS />}
                                text={t('questionTypes.mcqSingle')}
                                type={QuestionTypeList.MCQS}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                icon={<MCQM />}
                                text={t('questionTypes.mcqMultiple')}
                                type={QuestionTypeList.MCQM}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                icon={<Numerical />}
                                text={t('questionTypes.numerical')}
                                type={QuestionTypeList.NUMERIC}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                type={QuestionTypeList.TRUE_FALSE}
                                icon={<TrueFalse />}
                                text={t('questionTypes.trueFalse')}
                                handleAddQuestion={handleAddQuestion}
                            />
                        </div>
                        <Separator className="my-6" />
                        <div className="flex flex-col gap-4">
                            <div className="text-subtitle font-semibold">{t('optionBased')}</div>
                            <QuestionType
                                icon={<MCQS />}
                                text={t('questionTypes.mcqSingle')}
                                type={QuestionTypeList.MCQS}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                icon={<MCQM />}
                                text={t('questionTypes.mcqMultiple')}
                                type={QuestionTypeList.MCQM}
                                handleAddQuestion={handleAddQuestion}
                            />
                        </div>
                        <Separator className="my-6" />
                        <div className="flex flex-col gap-4">
                            <div className="text-subtitle font-semibold">{t('mathBased')}</div>
                            <QuestionType
                                icon={<Numerical />}
                                text={t('questionTypes.numerical')}
                                type={QuestionTypeList.NUMERIC}
                                handleAddQuestion={handleAddQuestion}
                            />
                        </div>
                        <Separator className="my-6" />
                        <div className="flex flex-col gap-4">
                            <div className="text-subtitle font-semibold">{t('writingSkills')}</div>
                            <QuestionType
                                icon={<LongAnswer />}
                                type={QuestionTypeList.LONG_ANSWER}
                                text={t('questionTypes.longAnswer')}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                icon={<SingleWord />}
                                type={QuestionTypeList.ONE_WORD}
                                text={t('questionTypes.singleWord')}
                                handleAddQuestion={handleAddQuestion}
                            />
                        </div>
                        <Separator className="my-6" />
                        <div className="flex flex-col gap-4">
                            <div className="text-subtitle font-semibold">{t('readingSkills')}</div>
                            <QuestionType
                                icon={<CMCQS />}
                                text={t('questionTypes.comprehensionMcqSingle')}
                                type={QuestionTypeList.CMCQS}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                icon={<CMCQM />}
                                text={t('questionTypes.comprehensionMcqMultiple')}
                                type={QuestionTypeList.CMCQM}
                                handleAddQuestion={handleAddQuestion}
                            />
                            <QuestionType
                                icon={<CMCQM />}
                                text={t('questionTypes.comprehensionNumeric')}
                                type={QuestionTypeList.CNUMERIC}
                                handleAddQuestion={handleAddQuestion}
                            />
                        </div>
                    </div>
                    <DialogClose asChild>
                        <button ref={isAddQuestionTypeRef} className="hidden" />
                    </DialogClose>
                </DialogContent>
            </Dialog>
            <VideoQuestionDialogAddPreview
                videoQuestionForm={videoQuestionForm}
                addedQuestionForm={addedQuestionForm}
                videoPlayerTimeFrameForm={videoPlayerTimeFrameForm}
                formRefData={formRefData}
                currentQuestionIndex={currentQuestionIndex}
                setCurrentQuestionIndex={setCurrentQuestionIndex}
                previewQuestionDialog={previewQuestionDialog}
                setPreviewQuestionDialog={setPreviewQuestionDialog}
                formData={formData}
                setFormData={setFormData}
                isAddTimeFrameRef={isAddTimeFrameRef}
                isAddQuestionTypeRef={isAddQuestionTypeRef}
            />
        </>
    );
};

export default AddVideoQuestionDialog;
