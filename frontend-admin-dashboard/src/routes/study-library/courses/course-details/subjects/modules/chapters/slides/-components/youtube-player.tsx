/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import {
    VideoPlayerTimeFormType,
    videoPlayerTimeSchema,
} from '../-form-schemas/video-player-time-schema';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { useSlideContentProtectionEnabled } from '../-hooks/useSlideContentProtectionEnabled';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useContentStore } from '../-stores/chapter-sidebar-store';
import { useMediaNavigationStore } from '../-stores/media-navigation-store';
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
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';

export interface YTPlayer {
    destroy(): void;
    getCurrentTime(): number;
    getDuration(): number;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getPlayerState(): number;
}

interface YouTubePlayerEvent {
    target: YTPlayer;
    data: number;
}

declare global {
    interface Window {
        onYouTubeIframeAPIReady: () => void;
        YT: {
            Player: new (
                element: HTMLElement | string,
                options: {
                    height?: string | number;
                    width?: string | number;
                    videoId?: string;
                    playerVars?: {
                        autoplay?: number;
                        controls?: number;
                        showinfo?: number;
                        rel?: number;
                        [key: string]: unknown;
                    };
                    events?: {
                        onReady?: (event: YouTubePlayerEvent) => void;
                        onStateChange?: (event: YouTubePlayerEvent) => void;
                        onError?: (event: YouTubePlayerEvent) => void;
                        [key: string]: unknown;
                    };
                }
            ) => YTPlayer;
            PlayerState: {
                PLAYING: number;
                PAUSED: number;
                ENDED: number;
                BUFFERING: number;
                CUED: number;
                UNSTARTED: number;
            };
        };
    }
}

interface YouTubePlayerProps {
    videoUrl: string;
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({ videoUrl }) => {
    const { t } = useTranslation('studyLibraryYoutubePlayer');
    const searchParams = Route.useSearch();
    // Convert formRefData from a ref to useState to trigger re-renders
    const isAddTimeFrameRef = useRef<HTMLButtonElement | null>(null);
    const isAddQuestionTypeRef = useRef<HTMLButtonElement | null>(null);
    const { activeItem, setActiveItem } = useContentStore();
    const { videoSeekTime, clearVideoSeekTime } = useMediaNavigationStore();
    // Slide context + save mutation so deleting a question persists immediately.
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

    // Keep ref for compatibility with existing code
    const formRefData = useRef<UploadQuestionPaperFormType>(formData);

    const videoPlayerTimeFrameForm = useForm<VideoPlayerTimeFormType>({
        resolver: zodResolver(videoPlayerTimeSchema),
        defaultValues: {
            hrs: '',
            min: '',
            sec: '',
            canSkip: true,
        },
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

    const playerRef = useRef<YTPlayer | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);

    // When Slide Content Protection is on, an overlay blocks right-click on the
    // (cross-origin) YouTube iframe. The overlay also swallows clicks, so we
    // forward a click to play/pause; the custom seek bar below still scrubs.
    const contentProtected = useSlideContentProtectionEnabled();
    const togglePlayPause = () => {
        const p = playerRef.current;
        if (!p) return;
        const isPlaying = p.getPlayerState() === window.YT?.PlayerState?.PLAYING;
        if (isPlaying) p.pauseVideo();
        else p.playVideo();
    };
    const [isAPIReady, setIsAPIReady] = useState(false);
    const [videoDuration, setVideoDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [hoveredQuestion, setHoveredQuestion] = useState<StudyLibraryQuestion | null>(null);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [previewQuestionDialog, setPreviewQuestionDialog] = useState(false);
    const closeDeleteDialogRef = useRef<HTMLButtonElement | null>(null);

    // Role display settings to control in-video question UI
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const roles = getUserRoles(accessToken);
        const isAdmin = roles.includes('ADMIN');
        const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
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

    const handleDeleteQuestionFormData = async (questionId: string) => {
        // Remove the question entirely (not a soft DELETE flag). It then drops out
        // of the saved payload, and the backend removes the row whose id is absent.
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

        // Persist immediately so the question is actually deleted on the backend.
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
            toast.error(t('errors.deleteQuestionFailed'));
        }
    };

    const extractVideoId = (url: string): string => {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);

        if (match && match[2] && match[2].length === 11) {
            return match[2];
        }
        return '';
    };

    // Function to load YouTube IFrame API
    const loadYouTubeAPI = () => {
        if (window.YT) {
            setIsAPIReady(true);
            return;
        }

        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';

        window.onYouTubeIframeAPIReady = () => {
            setIsAPIReady(true);
        };

        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    };

    const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!playerRef.current || !timelineRef.current) return;

        const rect = timelineRef.current.getBoundingClientRect();
        const clickPosition = e.clientX - rect.left;
        const clickPercentage = clickPosition / rect.width;
        const newTime = videoDuration * clickPercentage;

        playerRef.current.seekTo(newTime, true);
        setCurrentTime(newTime);
    };

    const handleQuestionClick = (timestamp: number) => {
        if (!playerRef.current) return;

        // Check if player is ready by checking if it has the seekTo method
        if (typeof playerRef.current.seekTo !== 'function') {
            // If not ready, try again after a short delay
            setTimeout(() => handleQuestionClick(timestamp), 100);
            return;
        }

        playerRef.current.seekTo(timestamp, true);
        setCurrentTime(timestamp);
    };

    const handleSetCurrentTimeStamp = () => {
        if (!playerRef.current) return;
        const timestamp = formatTimeStudyLibraryInSeconds(playerRef.current.getCurrentTime());

        // Handle HH:MM:SS or MM:SS format
        const parts = timestamp.split(':');

        if (parts.length === 3) {
            // HH:MM:SS format
            const hrs = String(parseInt(parts[0] as string, 10));
            const min = String(parseInt(parts[1] as string, 10));
            const sec = String(parseInt(parts[2] as string, 10));
            videoPlayerTimeFrameForm.reset({
                hrs,
                min,
                sec,
                canSkip: videoPlayerTimeFrameForm.getValues('canSkip'),
            });
        } else if (parts.length === 2) {
            // MM:SS format
            const min = String(parseInt(parts[0] as string, 10));
            const sec = String(parseInt(parts[1] as string, 10));
            videoPlayerTimeFrameForm.reset({
                hrs: '0',
                min,
                sec,
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

    // Function to update questions in state
    const updateQuestion = (updatedQuestion: StudyLibraryQuestion) => {
        setFormData((prevData) => {
            const updatedQuestions = [...prevData.questions];
            const index = updatedQuestions.findIndex(
                (q) => q.questionId === updatedQuestion.questionId
            );

            if (index !== -1) {
                updatedQuestions[index] = updatedQuestion;
            }

            return {
                ...prevData,
                questions: updatedQuestions,
            };
        });
    };

    // Initialize YouTube API
    useEffect(() => {
        loadYouTubeAPI();

        return () => {
            if (playerRef.current) {
                playerRef.current.destroy();
                playerRef.current = null;
            }
        };
    }, []);

    // Create player when API is ready and URL changes
    useEffect(() => {
        if (!isAPIReady || !videoUrl) return;

        const videoId = extractVideoId(videoUrl);
        if (!videoId || !containerRef.current) return;

        // Destroy existing player
        if (playerRef.current) {
            playerRef.current.destroy();
            playerRef.current = null;
        }

        // Create container element
        const playerContainer = document.createElement('div');
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(playerContainer);

        // Create new player
        const player = new window.YT.Player(playerContainer, {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                autoplay: 0,
                controls: 1,
                showinfo: 0,
                rel: 0,
                modestbranding: 1,
                cc_load_policy: 0,
            },
            events: {
                onReady: (event) => {
                    setVideoDuration(event.target.getDuration());
                },
                onStateChange: (event) => {
                    if (event.data === window.YT.PlayerState.PLAYING) {
                        setVideoDuration(event.target.getDuration());
                    }
                },
                onError: (event) => {
                    console.error('Player error:', event);
                },
            },
        });

        playerRef.current = player;
    }, [isAPIReady, videoUrl]);

    // Update current time for tracking
    useEffect(() => {
        const interval = setInterval(() => {
            try {
                const player = playerRef.current;
                if (player && player.getPlayerState && player.getPlayerState() !== 2) {
                    // not paused
                    setCurrentTime(player.getCurrentTime());
                }
            } catch (e) {
                console.error('Error getting player state:', e);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    // Update ref whenever state changes
    useEffect(() => {
        formRefData.current = formData;
    }, [formData]);

    // Handle video seeking when videoSeekTime changes
    useEffect(() => {
        if (videoSeekTime !== null && playerRef.current) {
            try {
                playerRef.current.seekTo(videoSeekTime, true);
                setCurrentTime(videoSeekTime);
                clearVideoSeekTime();
                toast.success(
                    t('toasts.videoJumpedTo', {
                        time: `${Math.floor(videoSeekTime / 60)}:${Math.floor(videoSeekTime % 60)
                            .toString()
                            .padStart(2, '0')}`,
                    })
                );
            } catch (error) {
                console.error('Error seeking video:', error);
                toast.error(t('errors.seekFailed'));
                clearVideoSeekTime();
            }
        }
    }, [videoSeekTime, clearVideoSeekTime]);

    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            questions: (activeItem?.video_slide?.questions || []) as any,
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoUrl, activeItem?.video_slide?.questions]);

    useEffect(() => {
        if (searchParams.timestamp && playerRef.current) {
            handleQuestionClick(searchParams.timestamp);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.timestamp]);

    return (
        <div className="flex w-full flex-col">
            {/* Video Player Container (preserving your aspect ratio) */}
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <div
                    ref={containerRef}
                    className="absolute left-0 top-0 size-full bg-neutral-100"
                />
                {contentProtected && (
                    <div
                        className="pointer-events-auto absolute inset-0 z-50 cursor-pointer"
                        onContextMenu={(e) => e.preventDefault()}
                        onClick={togglePlayPause}
                        aria-hidden
                    />
                )}
            </div>

            {/* Timeline with Question Markers */}
            <div className="relative mt-2 w-full">
                <div
                    ref={timelineRef}
                    className="relative h-2 w-full cursor-pointer rounded-md bg-gray-200"
                    onClick={handleTimelineClick}
                >
                    {/* Progress Indicator */}
                    <div
                        className="pointer-events-none absolute left-0 top-0 h-2 bg-primary-300 opacity-50"
                        style={{
                            width: `${videoDuration ? (currentTime / videoDuration) * 100 : 0}%`,
                        }}
                    ></div>

                    {/* Question Markers */}
                    {formData.questions?.map((question: StudyLibraryQuestion, idx) => (
                        <div
                            key={idx}
                            className="absolute top-0 -ml-1.5 size-3 -translate-y-1/2 cursor-pointer rounded-full bg-red-500"
                            style={{
                                left: `${(timestampToSeconds(question.timestamp) / videoDuration) * 100
                                    }%`,
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
                                        {t('timestampLabel', {
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

            {/* Add Question Form */}

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
                {formData.questions?.length === 0 ? (
                    <p className="text-sm italic text-gray-500"></p>
                ) : (
                    <ul className="max-h-60 space-y-1 overflow-y-auto">
                        {formData.questions?.map((question, idx) => (
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
                                        {t('questionsList.timeStampLine', {
                                            index: idx + 1,
                                            time: formatTimeStudyLibraryInSeconds(
                                                timestampToSeconds(question.timestamp)
                                            ),
                                        })}
                                    </p>
                                    <VideoQuestionsTimeFrameEditDialog
                                        playerRef={playerRef}
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
                                            updateQuestion={updateQuestion} // Pass updateQuestion function
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
                                                        {t('deleteDialog.cancel')}
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
                                                        {t('deleteDialog.delete')}
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
                                                                        <span className="ms-2 flex shrink-0 items-center gap-1 text-success-600">
                                                                            <CheckCircle
                                                                                size={16}
                                                                                weight="fill"
                                                                            />
                                                                            {t('correctBadge')}
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

export default YouTubePlayer;
