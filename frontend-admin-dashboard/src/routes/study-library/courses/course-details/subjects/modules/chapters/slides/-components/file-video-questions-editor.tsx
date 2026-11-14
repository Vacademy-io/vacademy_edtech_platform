/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    VideoPlayerTimeFormType,
    videoPlayerTimeSchema,
} from '../-form-schemas/video-player-time-schema';
import { UploadQuestionPaperFormType } from '@/routes/assessment/question-papers/-components/QuestionPaperUpload';
import { uploadQuestionPaperFormSchema } from '@/routes/assessment/question-papers/-utils/upload-question-paper-form-schema';
import VideoQuestionsTimeFrameAddDialog from './video-questions-add-timeframe';
import VideoQuestionsTimeFrameEditDialog from './video-questions-edit-timeframe';
import VideoQuestionDialogEditPreview from './slides-sidebar/video-question-dialog-edit-preview';
import { StudyLibraryQuestion } from '@/types/study-library/study-library-video-questions';
import {
    formatTimeStudyLibraryInSeconds,
    timestampToSeconds,
    converDataToVideoFormat,
} from '../-helper/helper';
import { useSlides } from '../-hooks/use-slides';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import { TrashSimple, CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Route } from '..';
import { VideoSplitScreenAddDialog } from './video-split-screen-add-dialog';
import { getTokenFromCookie, getUserRoles } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';
import { type DisplaySettingsData } from '@/types/display-settings';

interface FileVideoQuestionsEditorProps {
    /** Shared with FileVideoPlayer so the editor drives the same <video>. */
    videoRef: React.RefObject<HTMLVideoElement>;
}

/**
 * In-video question authoring + "Convert to Split Screen" for uploaded
 * (FILE_ID) videos. Mirrors the authoring surface that lives inside
 * `youtube-player.tsx` for YouTube videos, but is driven by the raw
 * <video> element (via `videoRef`) instead of the YouTube IFrame player.
 *
 * The question data model, save path (converDataToVideoFormat +
 * addUpdateVideoSlide) and the reused dialogs are all source-agnostic, so
 * uploaded videos store/reload questions exactly like YouTube.
 */
export const FileVideoQuestionsEditor: React.FC<FileVideoQuestionsEditorProps> = ({
    videoRef,
}) => {
    const { t } = useTranslation('studyLibraryFileVideoQuestionsEditor');
    const searchParams = Route.useSearch();
    const isAddTimeFrameRef = useRef<HTMLButtonElement | null>(null);
    const isAddQuestionTypeRef = useRef<HTMLButtonElement | null>(null);
    const { activeItem, setActiveItem } = useContentStore();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { addUpdateVideoSlide } = useSlides(
        searchParams.chapterId || '',
        searchParams.moduleId || '',
        searchParams.subjectId || '',
        getPackageSessionId({
            courseId: searchParams.courseId || '',
            levelId: searchParams.levelId || '',
            sessionId: searchParams.sessionId || '',
        }) || ''
    );

    const [formData, setFormData] = useState<UploadQuestionPaperFormType>({
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

    const formRefData = useRef<UploadQuestionPaperFormType>(formData);

    const videoPlayerTimeFrameForm = useForm<VideoPlayerTimeFormType>({
        resolver: zodResolver(videoPlayerTimeSchema),
        defaultValues: { hrs: '', min: '', sec: '', canSkip: true },
    });

    const addedQuestionForm = useForm<UploadQuestionPaperFormType>({
        resolver: zodResolver(uploadQuestionPaperFormSchema() as any),
        mode: 'onChange',
        defaultValues: {
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
        },
    });

    const videoQuestionForm = useForm<UploadQuestionPaperFormType>({
        resolver: zodResolver(uploadQuestionPaperFormSchema() as any),
        mode: 'onChange',
        defaultValues: {
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
        },
    });

    const timelineRef = useRef<HTMLDivElement>(null);
    const closeDeleteDialogRef = useRef<HTMLButtonElement | null>(null);
    const [videoDuration, setVideoDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [hoveredQuestion, setHoveredQuestion] = useState<StudyLibraryQuestion | null>(null);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [previewQuestionDialog, setPreviewQuestionDialog] = useState(false);

    // Adapter that gives the shared YouTube-authoring dialogs a `playerRef`-like
    // handle over the raw <video> element. Stable ref; methods read videoRef live.
    const controllerRef = useRef({
        getCurrentTime: () => videoRef.current?.currentTime ?? 0,
        getDuration: () => videoRef.current?.duration ?? 0,
        seekTo: (seconds: number) => {
            if (videoRef.current) videoRef.current.currentTime = seconds;
        },
        getPlayerState: () => (videoRef.current?.paused ? 2 : 1),
    });

    // Role display settings gate the in-video question UI (same key as YouTube).
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        getUserRoles(accessToken);
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
            return;
        }
        getDisplaySettings(roleKey)
            .then(setRoleDisplay)
            .catch(() => setRoleDisplay(null));
    }, []);
    const showInVideoQuestion = roleDisplay?.contentTypes?.video?.showInVideoQuestion !== false;

    useEffect(() => {
        formRefData.current = formData;
    }, [formData]);

    // Pull the current slide's questions into local editor state.
    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            questions: (activeItem?.video_slide?.questions || []) as any,
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeItem?.id, activeItem?.video_slide?.questions]);

    // Track playback time/duration off the shared <video> to drive the timeline.
    useEffect(() => {
        const interval = setInterval(() => {
            const v = videoRef.current;
            if (!v) return;
            if (!v.paused) setCurrentTime(v.currentTime);
            if (Number.isFinite(v.duration) && v.duration > 0) {
                setVideoDuration((prev) => (prev !== v.duration ? v.duration : prev));
            }
        }, 500);
        return () => clearInterval(interval);
    }, [videoRef]);

    const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const v = videoRef.current;
        if (!v || !timelineRef.current || !videoDuration) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const clickPercentage = (e.clientX - rect.left) / rect.width;
        const newTime = videoDuration * clickPercentage;
        v.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const handleQuestionClick = (timestamp: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = timestamp;
        setCurrentTime(timestamp);
    };

    const handleSetCurrentTimeStamp = () => {
        const timestamp = formatTimeStudyLibraryInSeconds(controllerRef.current.getCurrentTime());
        const parts = timestamp.split(':');
        if (parts.length === 3) {
            videoPlayerTimeFrameForm.reset({
                hrs: String(parseInt(parts[0] as string, 10)),
                min: String(parseInt(parts[1] as string, 10)),
                sec: String(parseInt(parts[2] as string, 10)),
                canSkip: videoPlayerTimeFrameForm.getValues('canSkip'),
            });
        } else if (parts.length === 2) {
            videoPlayerTimeFrameForm.reset({
                hrs: '0',
                min: String(parseInt(parts[0] as string, 10)),
                sec: String(parseInt(parts[1] as string, 10)),
                canSkip: videoPlayerTimeFrameForm.getValues('canSkip'),
            });
        }
    };

    const handleGetOptions = (question: StudyLibraryQuestion) => {
        if (question.questionType === 'MCQS') return question.singleChoiceOptions;
        else if (question.questionType === 'CMCQS') return question.csingleChoiceOptions;
        else if (question.questionType === 'MCQM') return question.multipleChoiceOptions;
        else if (question.questionType === 'CMCQM') return question.cmultipleChoiceOptions;
        else if (question.questionType === 'TRUE_FALSE') return question.trueFalseOptions;
        else if (question.questionType === 'NUMERIC' || question.questionType === 'CNUMERIC')
            return question.validAnswers;
        return question.subjectiveAnswerText;
    };

    function chunkArray<T>(arr: T[], size: number): T[][] {
        const result: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            result.push(arr.slice(i, i + size));
        }
        return result;
    }

    const updateQuestion = (updatedQuestion: StudyLibraryQuestion) => {
        setFormData((prevData) => {
            const updatedQuestions = [...prevData.questions];
            const index = updatedQuestions.findIndex(
                (q) => q.questionId === updatedQuestion.questionId
            );
            if (index !== -1) updatedQuestions[index] = updatedQuestion;
            return { ...prevData, questions: updatedQuestions };
        });
    };

    const handleDeleteQuestionFormData = async (questionId: string) => {
        const remainingQuestions = (activeItem?.video_slide?.questions || []).filter(
            (q: any) => q.questionId !== questionId
        );

        setFormData((prevData) => ({
            ...prevData,
            questions: prevData.questions.filter((q) => q.questionId !== questionId),
        }));

        const updatedSlide: any = {
            ...activeItem,
            video_slide: {
                ...activeItem?.video_slide,
                questions: remainingQuestions,
            },
        };
        setActiveItem(updatedSlide);
        closeDeleteDialogRef.current?.click();

        try {
            const payload = converDataToVideoFormat({
                activeItem: updatedSlide,
                status: activeItem?.status || 'DRAFT',
                notify: false,
                newSlide: false,
            });
            await addUpdateVideoSlide(payload);
            toast.success(t('toasts.questionDeleted'));
        } catch (err) {
            console.error('Failed to delete question:', err);
            toast.error(t('toasts.questionDeleteFailed'));
        }
    };

    // Render the list/markers straight off the store (source of truth) so a
    // freshly added/deleted question shows immediately. `activeItem` here is the
    // live store value (useContentStore), unlike the parent VideoSlidePreview
    // which receives a possibly-stale activeItem via prop/content snapshot.
    const savedQuestions: StudyLibraryQuestion[] =
        (activeItem?.video_slide?.questions as StudyLibraryQuestion[]) || [];

    return (
        <div className="flex w-full flex-col">
            {/* Timeline with Question Markers */}
            <div className="relative mt-2 w-full">
                <div
                    ref={timelineRef}
                    className="relative h-2 w-full cursor-pointer rounded-md bg-gray-200"
                    onClick={handleTimelineClick}
                >
                    <div
                        className="pointer-events-none absolute left-0 top-0 h-2 bg-primary-300 opacity-50"
                        style={{
                            width: `${videoDuration ? (currentTime / videoDuration) * 100 : 0}%`,
                        }}
                    ></div>

                    {savedQuestions.map((question: StudyLibraryQuestion, idx) => (
                        <div
                            key={idx}
                            className="absolute top-0 -ml-1.5 size-3 -translate-y-1/2 cursor-pointer rounded-full bg-red-500"
                            style={{
                                left: `${(timestampToSeconds(question.timestamp) / videoDuration) * 100}%`,
                                top: '50%',
                            }}
                            onMouseEnter={() => setHoveredQuestion(question)}
                            onMouseLeave={() => setHoveredQuestion(null)}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleQuestionClick(timestampToSeconds(question.timestamp));
                            }}
                        >
                            {hoveredQuestion === question && (
                                <div className="absolute bottom-5 left-1/2 z-10 w-48 -translate-x-1/2 rounded border border-gray-300 bg-white p-4 shadow-xl">
                                    <p className="text-sm text-gray-500">
                                        {t('labels.timestamp', {
                                            time: formatTimeStudyLibraryInSeconds(
                                                timestampToSeconds(question.timestamp)
                                            ),
                                        })}
                                    </p>
                                    <span
                                        className="text-sm font-medium"
                                        dangerouslySetInnerHTML={{
                                            __html: question.questionName || '',
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                    <span>{formatTimeStudyLibraryInSeconds(currentTime)}</span>
                    <span>{formatTimeStudyLibraryInSeconds(videoDuration)}</span>
                </div>
            </div>

            {/* Add Question + Split Screen */}
            <div className="flex gap-2">
                {showInVideoQuestion && (
                    <VideoQuestionsTimeFrameAddDialog
                        addedQuestionForm={addedQuestionForm}
                        videoQuestionForm={videoQuestionForm}
                        formRefData={formRefData}
                        videoPlayerTimeFrameForm={videoPlayerTimeFrameForm}
                        handleSetCurrentTimeStamp={handleSetCurrentTimeStamp}
                        currentQuestionIndex={currentQuestionIndex}
                        setCurrentQuestionIndex={setCurrentQuestionIndex}
                        previewQuestionDialog={previewQuestionDialog}
                        setPreviewQuestionDialog={setPreviewQuestionDialog}
                        formData={formData}
                        setFormData={setFormData}
                        isAddTimeFrameRef={isAddTimeFrameRef}
                        isAddQuestionTypeRef={isAddQuestionTypeRef}
                        videoDuration={videoDuration}
                    />
                )}
                {activeItem?.source_type === 'VIDEO' && !activeItem?.splitScreenMode && (
                    <div className="my-2">
                        <VideoSplitScreenAddDialog
                            videoSlideId={activeItem?.id || ''}
                            isEditable={true}
                        />
                    </div>
                )}
            </div>

            {/* Questions List */}
            <div className="mt-4 w-full">
                {savedQuestions.length === 0 ? (
                    <p className="text-sm italic text-gray-500"></p>
                ) : (
                    <ul className="max-h-60 space-y-1 overflow-y-auto">
                        {savedQuestions.map((question, idx) => (
                            <li
                                key={idx}
                                className="cursor-pointer rounded-md bg-white p-2 text-sm hover:bg-gray-50"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuestionClick(timestampToSeconds(question.timestamp));
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <p className="font-semibold">
                                        {t('labels.timeStampIndexed', {
                                            index: idx + 1,
                                            time: formatTimeStudyLibraryInSeconds(
                                                timestampToSeconds(question.timestamp)
                                            ),
                                        })}
                                    </p>
                                    <VideoQuestionsTimeFrameEditDialog
                                        playerRef={controllerRef}
                                        formRefData={formRefData}
                                        question={question}
                                        videoDuration={videoDuration}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span
                                        className="font-thin"
                                        dangerouslySetInnerHTML={{
                                            __html: question.questionName || '',
                                        }}
                                    />
                                    <div className="flex items-center gap-2">
                                        <div className="rounded-lg border p-1.5 px-2.5">
                                            <span>{question.questionType}</span>
                                        </div>
                                        <VideoQuestionDialogEditPreview
                                            formRefData={formRefData}
                                            question={question}
                                            currentQuestionIndex={idx}
                                            setCurrentQuestionIndex={setCurrentQuestionIndex}
                                            updateQuestion={updateQuestion}
                                        />
                                        <Dialog>
                                            <DialogTrigger>
                                                <MyButton
                                                    buttonType="secondary"
                                                    scale="small"
                                                    layoutVariant="default"
                                                    className="h-8 min-w-4"
                                                >
                                                    <TrashSimple size={18} />
                                                </MyButton>
                                            </DialogTrigger>
                                            <DialogContent className="flex w-full max-w-md flex-col gap-0 p-0">
                                                <DialogClose asChild>
                                                    <button
                                                        ref={closeDeleteDialogRef}
                                                        className="hidden"
                                                    />
                                                </DialogClose>
                                                <h1 className="rounded-t-lg bg-primary-50 p-4 font-semibold text-primary-500">
                                                    {t('deleteDialog.title')}
                                                </h1>
                                                <div className="flex flex-col gap-1 p-5">
                                                    <p className="text-subtitle font-semibold text-neutral-700">
                                                        {t('deleteDialog.confirmMessage')}
                                                    </p>
                                                    <p className="text-body text-neutral-500">
                                                        {t('deleteDialog.description')}
                                                    </p>
                                                </div>
                                                <div className="flex flex-col-reverse justify-end gap-2 border-t border-neutral-200 p-4 sm:flex-row sm:gap-3">
                                                    <MyButton
                                                        type="button"
                                                        buttonType="secondary"
                                                        scale="medium"
                                                        layoutVariant="default"
                                                        onClick={() =>
                                                            closeDeleteDialogRef.current?.click()
                                                        }
                                                    >
                                                        {t('actions.cancel')}
                                                    </MyButton>
                                                    <MyButton
                                                        type="button"
                                                        buttonType="primary"
                                                        scale="medium"
                                                        layoutVariant="default"
                                                        className="!bg-danger-600 hover:!bg-danger-500"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteQuestionFormData(
                                                                question.questionId || ''
                                                            );
                                                        }}
                                                    >
                                                        {t('actions.delete')}
                                                    </MyButton>
                                                </div>
                                            </DialogContent>
                                        </Dialog>
                                    </div>
                                </div>
                                {(question.questionType === 'LONG_ANSWER' ||
                                    question.questionType === 'ONE_WORD') && (
                                    <span className="flex w-1/2 rounded-xl border bg-neutral-50 p-4 font-thin">
                                        <span
                                            dangerouslySetInnerHTML={{
                                                __html: handleGetOptions(question) || '',
                                            }}
                                        />
                                    </span>
                                )}
                                {(question.questionType === 'NUMERIC' ||
                                    question.questionType === 'CNUMERIC') && (
                                    <div className="mt-4 flex w-full flex-col gap-4">
                                        {chunkArray((handleGetOptions(question) || []) as any[], 2).map(
                                            (optionPair: any[], rowIdx: number) => (
                                                <div
                                                    key={rowIdx}
                                                    className="mb-2 flex w-full items-center gap-4"
                                                >
                                                    {optionPair.map((option, idx) => {
                                                        const globalIndex = rowIdx * 2 + idx;
                                                        return (
                                                            <span
                                                                key={`option-${globalIndex}-${idx}`}
                                                                className="flex w-1/2 rounded-xl border bg-neutral-50 p-4 font-thin"
                                                            >
                                                                <span
                                                                    dangerouslySetInnerHTML={{
                                                                        __html: option || '',
                                                                    }}
                                                                />
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}
                                {!['LONG_ANSWER', 'ONE_WORD', 'NUMERIC', 'CNUMERIC'].includes(
                                    question.questionType
                                ) && (
                                    <div className="mt-4 flex w-full flex-col gap-4">
                                        {chunkArray((handleGetOptions(question) || []) as any[], 2).map(
                                            (optionPair: any[], rowIdx: number) => (
                                                <div
                                                    key={rowIdx}
                                                    className="mb-2 flex w-full items-center gap-4"
                                                >
                                                    {optionPair.map((option: any, idx: number) => {
                                                        const globalIndex = rowIdx * 2 + idx;
                                                        return (
                                                            <span
                                                                key={`option-${globalIndex}-${idx}`}
                                                                className={cn(
                                                                    'flex w-1/2 items-center justify-between rounded-xl border p-4 font-thin',
                                                                    option?.isSelected
                                                                        ? 'border-success-500 bg-success-50'
                                                                        : 'bg-neutral-50'
                                                                )}
                                                            >
                                                                <span className="flex items-center">
                                                                    <span className="mr-1">
                                                                        (
                                                                        {String.fromCharCode(
                                                                            97 + globalIndex
                                                                        )}
                                                                        .)
                                                                    </span>
                                                                    <span
                                                                        dangerouslySetInnerHTML={{
                                                                            __html: option?.name || '',
                                                                        }}
                                                                    />
                                                                </span>
                                                                {option?.isSelected && (
                                                                    <span className="ml-2 flex shrink-0 items-center gap-1 text-success-600">
                                                                        <CheckCircle
                                                                            size={16}
                                                                            weight="fill"
                                                                        />
                                                                        {t('labels.correct')}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            )
                                        )}
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default FileVideoQuestionsEditor;
