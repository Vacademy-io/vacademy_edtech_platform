"use client";

import type React from "react";
import {
    useEffect,
    useRef,
    useCallback,
    useState,
    forwardRef,
    useImperativeHandle,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { Trans, useTranslation } from "react-i18next";
import { useTrackingStore } from "@/stores/study-library/youtube-video-tracking-store";
import { getEpochTimeInMillis, safePlay } from "./utils";
import { convertTimeToSeconds } from "@/utils/study-library/tracking/convertTimeToSeconds";
import { formatVideoTime } from "@/utils/study-library/tracking/formatVideoTime";
import { useVideoSync } from "@/hooks/study-library/useVideoSync";
import { ConcentrationSettings } from "@/types/student-display-settings";
import { DEFAULT_STUDENT_DISPLAY_SETTINGS } from "@/constants/display-settings/student-defaults";
import { useSlideDownloadPermission } from "@/hooks/useSlideDownloadPermission";
import { SlideDownloadTypeKey } from "@/constants/slide-download-permission";

import {
    ArrowClockwise,
    ArrowCounterClockwise,
    CornersIn,
    CornersOut,
    DotsThreeVertical,
    DownloadSimple,
    Gauge,
    Pause,
    Play,
    SpeakerHigh,
    SpeakerX,
} from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import VideoQuestionOverlay from "./video-question-overlay";
import { getPublicUrl } from "@/services/upload_file";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
import { cn } from "@/lib/utils";
// import { getPublicUrl } from "@/utils/study-library/storage/get-public-url";

interface CustomVideoPlayerProps {
    videoUrl: string;
    sourceType?: "FILE_ID" | "URL";
    /**
     * True when `videoUrl` is a locally-decrypted offline stream (the native
     * `OfflineMedia` scheme — see src/lib/offline/resolve.ts `offline-stream`
     * kind) rather than a remote signed URL. Forces download affordances off
     * regardless of role permission — there is nothing sensible to "download"
     * from a `offline-media://`/localhost decrypt session, and the whole
     * point of on-device encryption is that no plaintext copy is ever
     * exposed for export.
     */
    isOfflineSource?: boolean;
    onTimeUpdate?: (currentTime: number) => void;
    questions?: Array<{
        id: string;
        question_time_in_millis: number;
        text_data: {
            content: string;
        };
        parent_rich_text?: {
            content: string;
        };
        options: Array<{
            id: string;
            text: {
                content: string;
            };
        }>;
        can_skip?: boolean;
    }>;
    concentrationSettings?: ConcentrationSettings;
}

const SKIP_SECONDS = 10;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function deriveFileName(url: string): string {
    try {
        const path = new URL(url).pathname;
        const last = path.split("/").filter(Boolean).pop();
        if (last && /\.\w{2,4}$/.test(last)) return decodeURIComponent(last);
    } catch {
        /* fall through */
    }
    return "video.mp4";
}

function ControlButton({
    label,
    onClick,
    children,
    className,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={cn(
                "flex items-center justify-center gap-0.5 rounded-md p-1.5 text-white transition-colors hover:bg-white/20 focus-visible:bg-white/20 focus-visible:outline-none",
                className
            )}
        >
            {children}
        </button>
    );
}

const CustomVideoPlayer = forwardRef<any, CustomVideoPlayerProps>(
    ({ videoUrl, sourceType = "URL", isOfflineSource = false, onTimeUpdate, questions = [], concentrationSettings }, ref) => {
        const { t } = useTranslation("libraryCommonA");
        const { activeItem } = useContentStore();
        // Whether this user's role is allowed to download the video. Defaults to
        // false (today's behavior — native download is suppressed). Always
        // false for an offline source, regardless of role permission.
        const { canDownload } = useSlideDownloadPermission();
        const allowVideoDownload = !isOfflineSource && canDownload(SlideDownloadTypeKey.VIDEO);
        // Select only the addActivity function to avoid re-renders due to trackingData updates
        const addActivity = useTrackingStore((state) => state.addActivity);
        const activityId = useRef(uuidv4());
        const currentTimestamps = useRef<
            Array<{
                id: string;
                start_time: string;
                end_time: string;
                start: number;
                end: number;
            }>
        >([]);
        const videoStartTime = useRef<number>(0);
        const videoEndTime = useRef<number>(0);
        const [elapsedTime, setElapsedTime] = useState(0);
        const timerRef = useRef<NodeJS.Timeout | null>(null);
        const currentStartTimeRef = useRef("");
        const timestampDurationRef = useRef(0);
        const [isFirstPlay, setIsFirstPlay] = useState(true);
        const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
        const { syncVideoTrackingData } = useVideoSync();
        const currentStartTimeInEpochRef = useRef<number>(0);

        const [isPlayed, setIsPlayed] = useState(false);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [duration, setDuration] = useState(0);
        const [currentTime, setCurrentTime] = useState(0);
        const [isFullscreen, setIsFullscreen] = useState(false);
        const videoRef = useRef<HTMLVideoElement>(null);
        const playerContainerRef = useRef<HTMLDivElement>(null);
        const concentrationScoreId = useRef(uuidv4());
        const [showFullscreenControls, setShowFullscreenControls] =
            useState(false);
        const fullscreenControlsTimeoutRef = useRef<NodeJS.Timeout | null>(
            null
        );
        const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

        // Question state
        const [currentQuestion, setCurrentQuestion] = useState<any>(null);
        const [showQuestion, setShowQuestion] = useState(false);
        // High-water mark (ms) of the furthest position already scanned for
        // questions, so faster playback or a forward jump can't skip one.
        const lastQuestionCheckTimeRef = useRef(0);
        const [answeredQuestions, setAnsweredQuestions] = useState<
            Record<
                string,
                {
                    answered: boolean;
                    selectedOptions: string | string[];
                    isCorrect?: boolean;
                    timestamp: number;
                }
            >
        >({});

        // Question mapping for time-based lookup
        const [timeToQuestionMap, setTimeToQuestionMap] = useState<
            Array<{
                time: number;
                question: NonNullable<
                    CustomVideoPlayerProps["questions"]
                >[number];
            }>
        >([]);

        // Verification state
        const [showVerification, setShowVerification] = useState(false);
        const [verificationCountdown, setVerificationCountdown] = useState(59);
        const [verificationNumbers, setVerificationNumbers] = useState<
            number[]
        >([]);

        // const [verificationInterval] = useState(180); // Removed fixed interval
        const verificationTimerRef = useRef<NodeJS.Timeout | null>(null);
        const nextVerificationTimeRef = useRef<number>(0);

        // Settings defaults
        const settings = {
            enabled: concentrationSettings?.enabled ?? DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.enabled,
            min_minutes: concentrationSettings?.frequency.min_minutes ?? DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.frequency.min_minutes,
            max_minutes: concentrationSettings?.frequency.max_minutes ?? DEFAULT_STUDENT_DISPLAY_SETTINGS.concentration.frequency.max_minutes,
        };

        // Reset schedule if settings change to ensure we pick up new intervals immediately
        useEffect(() => {
            if (nextVerificationTimeRef.current !== 0) {
                nextVerificationTimeRef.current = 0;
            }
        }, [settings.min_minutes, settings.max_minutes, settings.enabled]);
        // Concentration metrics
        const [tabSwitchCount, setTabSwitchCount] = useState(0);
        const [pauseCount, setPauseCount] = useState(0);
        const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
        const [missedAnswerCount, setMissedAnswerCount] = useState(0);
        const [answerTimesInSeconds, setAnswerTimesInSeconds] = useState<
            number[]
        >([]);
        const [concentrationScore, setConcentrationScore] = useState(100); // Start with perfect score
        const [actualVideoUrl, setActualVideoUrl] = useState<string | null>(
            null
        );

        // Custom control-bar state (matches the admin FileVideoPlayer UX).
        const [volume, setVolume] = useState(1);
        const [muted, setMuted] = useState(false);
        const [playbackRate, setPlaybackRate] = useState(1);
        const [menuOpen, setMenuOpen] = useState(false);
        const [scrubbing, setScrubbing] = useState(false);
        const [adjustingVolume, setAdjustingVolume] = useState(false);
        const progressRef = useRef<HTMLDivElement>(null);
        const volumeRef = useRef<HTMLDivElement>(null);
        const menuRef = useRef<HTMLDivElement>(null);

        const { setCurrentUploadedVideoTime } = useMediaRefsStore();

        useEffect(() => {
            setCurrentUploadedVideoTime(currentTime);
        }, [currentTime]);

        // Expose methods to parent component via ref
        useImperativeHandle(ref, () => ({
            playVideo: () => {
                if (videoRef.current) {
                    safePlay(videoRef.current);
                    setIsPlayed(true);
                }
            },
            pauseVideo: () => {
                if (videoRef.current) {
                    videoRef.current.pause();
                    setIsPlayed(false);
                }
            },
            getCurrentTime: () => {
                return videoRef.current?.currentTime || 0;
            },
            getDuration: () => {
                return videoRef.current?.duration || 0;
            },
            seekTo: (seconds: number) => {
                if (videoRef.current) {
                    videoRef.current.currentTime = seconds;
                    setCurrentTime(seconds);
                }
            },
        }));

        // Load answered questions from storage
        useEffect(() => {
            const loadAnsweredQuestions = async () => {
                try {
                    const { value } = await Preferences.get({
                        key: "video_answered_questions",
                    });
                    if (value) {
                        const stored = JSON.parse(value);
                        // Handle both old and new format
                        const converted: Record<
                            string,
                            {
                                answered: boolean;
                                selectedOptions: string | string[];
                                isCorrect?: boolean;
                                timestamp: number;
                            }
                        > = {};

                        Object.entries(stored).forEach(([key, val]) => {
                            if (typeof val === "boolean") {
                                // Old format
                                converted[key] = {
                                    answered: val,
                                    selectedOptions: [],
                                    isCorrect: true,
                                    timestamp: Date.now(),
                                };
                            } else {
                                // New format
                                converted[key] = val as any;
                            }
                        });

                        setAnsweredQuestions(converted);
                    }
                } catch (error) {
                    console.error("Error loading answered questions:", error);
                }
            };

            loadAnsweredQuestions();
        }, []);

        // Map questions for time-based lookup
        useEffect(() => {
            if (questions && questions.length > 0) {
                const mapped = questions.map((q) => ({
                    time: q.question_time_in_millis,
                    question: q,
                }));
                setTimeToQuestionMap(mapped);
                console.log("Mapped questions:", mapped);
            }
            // Reset answered questions when questions change (new video/slide)
            setAnsweredQuestions({});
        }, []);

        // Reset answered questions when video changes
        useEffect(() => {
            setAnsweredQuestions({});
            lastQuestionCheckTimeRef.current = 0;
        }, [videoUrl]);

        // Save answered question to storage
        const saveAnsweredQuestion = async (
            questionId: string,
            selectedOptions: string | string[] = [],
            isCorrect: boolean = true
        ) => {
            try {
                const newAnsweredQuestions = {
                    ...answeredQuestions,
                    [questionId]: {
                        answered: true,
                        selectedOptions,
                        isCorrect,
                        timestamp: Date.now(),
                    },
                };
                await Preferences.set({
                    key: "video_answered_questions",
                    value: JSON.stringify(newAnsweredQuestions),
                });
                setAnsweredQuestions(newAnsweredQuestions);
            } catch (error) {
                console.error("Error saving answered question:", error);
            }
        };

        // Check for questions at current timestamp
        const checkForQuestions = useCallback(() => {
            if (!questions || questions.length === 0 || !videoRef.current)
                return;
            if (showQuestion) return;

            const currentTimeMs = videoRef.current.currentTime * 1000;
            const prevTimeMs = lastQuestionCheckTimeRef.current;

            // Advance the high-water mark; on a backward seek the crossing window
            // is empty so nothing fires until playback passes it again.
            lastQuestionCheckTimeRef.current = currentTimeMs;
            if (currentTimeMs <= prevTimeMs) return;

            // Fire for any unanswered question crossed since the last check
            // (prevTimeMs, currentTimeMs], earliest first. Range-based detection
            // means fast playback or a forward jump can't skip over a question.
            const questionToShow = questions
                .filter((q) => {
                    if (answeredQuestions[q.id]?.answered) return false;
                    const questionTime = q.question_time_in_millis;
                    return (
                        questionTime > prevTimeMs && questionTime <= currentTimeMs
                    );
                })
                .sort(
                    (a, b) =>
                        a.question_time_in_millis - b.question_time_in_millis
                )[0];

            if (questionToShow) {
                // Re-arm from this question's time so further questions skipped by
                // the same jump surface one-by-one on resume.
                lastQuestionCheckTimeRef.current =
                    questionToShow.question_time_in_millis;
                // Pause the video
                videoRef.current.pause();
                setIsPlayed(false);

                // Show the question
                setCurrentQuestion(questionToShow);
                setShowQuestion(true);
            }
        }, [questions, showQuestion, answeredQuestions]);

        // Handle question submission
        const handleQuestionSubmit = async (
            selectedOption: string | string[]
        ) => {
            if (!currentQuestion) return { success: false };

            // Evaluate the answer (you can enhance this logic)
            const isCorrect = true; // This should be based on actual evaluation logic

            // Mark question as answered with detailed info
            await saveAnsweredQuestion(
                currentQuestion.id,
                selectedOption,
                isCorrect
            );

            // Return mock response (in a real app, this would come from the server)
            return {
                success: true,
                isCorrect: isCorrect,
                explanation: "Great job! You've answered correctly.",
            };
        };

        // Handle closing the question overlay (skip/close)
        const handleQuestionClose = () => {
            // Mark question as skipped only if it's skippable
            if (currentQuestion && currentQuestion.can_skip) {
                setAnsweredQuestions((prev) => ({
                    ...prev,
                    [currentQuestion.id]: {
                        answered: true,
                        selectedOptions: [],
                        isCorrect: false,
                        timestamp: Date.now(),
                    },
                }));
            }

            setShowQuestion(false);
            setCurrentQuestion(null);

            // Resume video playback
            if (videoRef.current) {
                safePlay(videoRef.current);
                setIsPlayed(true);
            }
        };

        // Add cleanup function
        const cleanup = useCallback(() => {
            console.log("Cleaning up video player");
            if (videoRef.current) {
                // Stop video playback
                videoRef.current.pause();
                videoRef.current.src = "";
                videoRef.current.load();
            }

            // Clear all intervals and timeouts
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
            if (verificationTimerRef.current) {
                clearInterval(verificationTimerRef.current);
                verificationTimerRef.current = null;
            }
            if (fullscreenControlsTimeoutRef.current) {
                clearTimeout(fullscreenControlsTimeoutRef.current);
                fullscreenControlsTimeoutRef.current = null;
            }
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
                updateIntervalRef.current = null;
            }

            // Reset states
            setIsPlayed(false);
            setIsLoading(true);
            setError(null);
            setCurrentTime(0);
            setDuration(0);
            setActualVideoUrl(null);
        }, []);

        // Cleanup on unmount
        useEffect(() => {
            return () => {
                cleanup();
            };
        }, [cleanup]);

        // Cleanup when videoUrl changes
        useEffect(() => {
            cleanup();
            loadVideoUrl();
        }, [videoUrl, sourceType, cleanup]);

        // Update loadVideoUrl to handle cleanup
        const loadVideoUrl = async () => {
            try {
                console.log("Loading video URL:", videoUrl);
                console.log("Source type:", sourceType);

                if (!videoUrl) {
                    throw new Error(t("videoPlayer.error.noUrlProvided"));
                }

                // Cleanup existing video before loading new one
                if (videoRef.current) {
                    videoRef.current.pause();
                    videoRef.current.src = "";
                    videoRef.current.load();
                }

                let finalUrl = videoUrl;
                if (sourceType === "FILE_ID") {
                    try {
                        console.log("Converting file ID to URL:", videoUrl);
                        const publicUrl = await getPublicUrl(videoUrl);
                        console.log("getPublicUrl response:", publicUrl);

                        if (!publicUrl) {
                            throw new Error(t("videoPlayer.error.failedFromFileId"));
                        }

                        finalUrl = publicUrl;
                        console.log("Final video URL:", finalUrl);
                    } catch (error) {
                        console.error("Error getting public URL:", error);
                        throw new Error(t("videoPlayer.error.failedFromFileId"));
                    }
                }

                // Set the URL first to allow video element to start loading
                setActualVideoUrl(finalUrl);
                setError(null);
            } catch (error) {
                console.error("Error loading video:", error);
                setError(
                    error instanceof Error
                        ? error.message
                        : t("videoPlayer.error.loadingVideo")
                );
                setActualVideoUrl(null);
            } finally {
                setIsLoading(false);
            }
        };

        // Handle video element events
        const handleLoadedMetadata = () => {
            if (videoRef.current) {
                console.log("Video metadata loaded");
                console.log("Video duration:", videoRef.current.duration);
                console.log("Video ready state:", videoRef.current.readyState);
                setDuration(videoRef.current.duration);
                setIsLoading(false);
                // Re-apply persisted playback preferences to the freshly
                // mounted <video> (state survives slide switches, the element
                // does not).
                videoRef.current.playbackRate = playbackRate;
                videoRef.current.volume = volume;
                videoRef.current.muted = muted;
                // Set the custom video length in the store
                const { setCurrentCustomVideoLength } =
                    useMediaRefsStore.getState();
                setCurrentCustomVideoLength(videoRef.current.duration);
            }
        };

        const handleCanPlay = () => {
            console.log("Video can play");
            setIsLoading(false);
        };

        const handleVideoError = (
            e: React.SyntheticEvent<HTMLVideoElement, Event>
        ) => {
            console.error("Video error:", e);
            const videoElement = e.target as HTMLVideoElement;
            const error = videoElement.error;
            let errorMessage = t("videoPlayer.error.loadingVideo");

            if (error) {
                switch (error.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                        errorMessage = t("videoPlayer.error.aborted");
                        break;
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMessage = t("videoPlayer.error.network");
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMessage = t("videoPlayer.error.formatNotSupported");
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = t("videoPlayer.error.sourceNotSupported");
                        break;
                }
            }

            console.error("Video error details:", {
                error: error,
                networkState: videoElement.networkState,
                readyState: videoElement.readyState,
                src: videoElement.src,
                currentSrc: videoElement.currentSrc,
            });

            setError(errorMessage);
            setIsLoading(false);
        };

        // Load saved verification time from Capacitor preferences
        useEffect(() => {
            const loadSavedData = async () => {
                try {
                    const { value } = await Preferences.get({
                        key: `video_concentration_metrics_${activeItem?.id ?? "global"}`,
                    });
                    if (value) {
                        const savedMetrics = JSON.parse(value);
                        setTabSwitchCount(savedMetrics.tabSwitchCount || 0);
                        setWrongAnswerCount(savedMetrics.wrongAnswerCount || 0);
                        setMissedAnswerCount(
                            savedMetrics.missedAnswerCount || 0
                        );
                        setPauseCount(savedMetrics.pauseCount || 0);
                        setAnswerTimesInSeconds(
                            savedMetrics.answerTimesInSeconds || []
                        );
                        setConcentrationScore(
                            savedMetrics.concentrationScore || 100
                        );
                    }
                } catch (error) {
                    console.error(
                        "Error loading saved concentration metrics:",
                        error
                    );
                }
            };

            loadSavedData();
        }, []);

        // Save concentration metrics to Capacitor preferences
        const saveConcentrationMetrics = async () => {
            try {
                const metrics = {
                    tabSwitchCount,
                    wrongAnswerCount,
                    missedAnswerCount,
                    pauseCount,
                    answerTimesInSeconds,
                    concentrationScore,
                };

                await Preferences.set({
                    key: `video_concentration_metrics_${activeItem?.id ?? "global"}`,
                    value: JSON.stringify(metrics),
                });
            } catch (error) {
                console.error("Error saving concentration metrics:", error);
            }
        };

        // Save verification time to Capacitor preferences
        const saveVerificationTime = async (time: number) => {
            try {
                await Preferences.set({
                    key: "verification_time",
                    value: time.toString(),
                });
            } catch (error) {
                console.error("Error saving verification time:", error);
            }
        };

        // Update concentration score based on metrics
        useEffect(() => {
            // Simple algorithm to calculate concentration score
            // This can be adjusted based on specific requirements
            const baseScore = 100;
            const tabSwitchPenalty = tabSwitchCount * 10;
            const wrongAnswerPenalty = wrongAnswerCount * 5;
            const pouseCountPenalty = pauseCount * 5;
            const missedAnswerPenalty = missedAnswerCount * 20;

            let newScore =
                baseScore -
                tabSwitchPenalty -
                wrongAnswerPenalty -
                missedAnswerPenalty -
                pouseCountPenalty;
            newScore = Math.max(0, newScore); // Ensure score doesn't go below 0

            setConcentrationScore(newScore);
            saveConcentrationMetrics();
        }, [tabSwitchCount, wrongAnswerCount, missedAnswerCount, pauseCount]);

        // Generate verification numbers
        const generateVerificationNumbers = useCallback(() => {
            const correctNum = Math.floor(Math.random() * 100);
            let num1 = correctNum;
            let num2 = correctNum;

            // Ensure numbers are different from the correct one
            while (num1 === correctNum) {
                num1 = Math.floor(Math.random() * 100);
            }

            while (num2 === correctNum || num2 === num1) {
                num2 = Math.floor(Math.random() * 100);
            }

            // Set in a fixed order - correct number is always in the middle
            setVerificationNumbers([num1, correctNum, num2]);
        }, []);

        // Start the verification countdown timer
        const startVerificationTimer = useCallback(() => {
            if (verificationTimerRef.current) {
                clearInterval(verificationTimerRef.current);
            }

            setVerificationCountdown(59);

            verificationTimerRef.current = setInterval(() => {
                setVerificationCountdown((prev) => {
                    if (prev <= 1) {
                        // Time's up, pause the video
                        if (videoRef.current) {
                            videoRef.current.pause();
                            setIsPlayed(false);
                        }
                        // Increment missed answer count
                        setMissedAnswerCount((prev) => prev + 1);
                        // Clear the timer
                        if (verificationTimerRef.current) {
                            clearInterval(verificationTimerRef.current);
                            verificationTimerRef.current = null;
                        }
                        // Close the verification dialog
                        setShowVerification(false);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }, []);

        // Handle verification number click
        const handleVerificationClick = (index: number) => {
            // Clear the verification timer
            if (verificationTimerRef.current) {
                clearInterval(verificationTimerRef.current);
                verificationTimerRef.current = null;
            }

            const responseTime = 59 - verificationCountdown;
            // Add response time to array
            const newAnswerTimes = [...answerTimesInSeconds, responseTime];
            setAnswerTimesInSeconds(newAnswerTimes);
            // Check if correct number was clicked (middle position, index 1)
            // Note: In future we should randomize the correct index too
            if (index === 1) {
                // Record verification time
                const currentTimeInSeconds = Math.floor(Date.now() / 1000);
                saveVerificationTime(currentTimeInSeconds);

                // Hide verification
                setShowVerification(false);

                // Reschedule next check
                scheduleNextVerification();
            } else {
                // Wrong number clicked, increment wrong answer count
                setWrongAnswerCount((prev) => prev + 1);

                // Pause the video
                if (videoRef.current) {
                    videoRef.current.pause();
                    setIsPlayed(false);
                }

                // Close the verification dialog
                setShowVerification(false);
                // We will reschedule only when they resume (via the isPlayed effect)
                nextVerificationTimeRef.current = 0;
            }
        };

        // Schedule next verification
        const scheduleNextVerification = useCallback(() => {
            if (!settings.enabled) return;

            const minSeconds = settings.min_minutes * 60;
            const maxSeconds = settings.max_minutes * 60;
            const randomSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;

            // Set target time based on CURRENT elapsed time + random future duration
            // We use a ref because we don't want to trigger re-renders just for the target time
            nextVerificationTimeRef.current = elapsedTime + randomSeconds;
            console.log(`Next verification scheduled at ${nextVerificationTimeRef.current}s (in ${randomSeconds}s)`);
        }, [settings.enabled, settings.min_minutes, settings.max_minutes, elapsedTime]);


        // Check if verification is needed based on elapsed time (polled via elapsedTime update)
        useEffect(() => {
            if (!settings.enabled) return;

            // If we just started playing and haven't scheduled one yet
            if (isPlayed && nextVerificationTimeRef.current === 0) {
                scheduleNextVerification();
            }

            // Check if we hit the target
            if (
                isPlayed &&
                elapsedTime > 0 &&
                nextVerificationTimeRef.current > 0 &&
                elapsedTime >= nextVerificationTimeRef.current
            ) {
                // Show verification without pausing the video
                setShowVerification(true);
                generateVerificationNumbers();
                startVerificationTimer();

                // Reset/Schedule next
                // We'll reschedule AFTER they complete it, but for now reset to 0 so we don't trigger again immediately
                nextVerificationTimeRef.current = 0;
            }
        }, [
            elapsedTime,
            isPlayed,
            settings.enabled,
            generateVerificationNumbers,
            startVerificationTimer,
            scheduleNextVerification
        ]);

        const calculatePercentageWatched = (totalDuration: number) => {
            if (!totalDuration || totalDuration <= 0) return "0.000";
            const percentage = (currentTime / totalDuration) * 100;
            console.log("Debug - Video Progress:", {
                currentTime: currentTime.toFixed(2),
                totalDuration: totalDuration.toFixed(2),
                percentage: percentage.toFixed(2),
            });
            return percentage.toFixed(2);
        };

        const clearUpdateInterval = useCallback(() => {
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
                updateIntervalRef.current = null;
            }
        }, []);

        const startTimer = useCallback(() => {
            if (timerRef.current) return;
            timerRef.current = setInterval(() => {
                setElapsedTime((prev) => prev + 1);
                timestampDurationRef.current += 1;
            }, 1000);
        }, []);

        const stopTimer = useCallback(() => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }, []);

        // Start progress tracking interval when video is playing
        const startProgressTracking = useCallback(() => {
            if (progressIntervalRef.current) return;
            progressIntervalRef.current = setInterval(() => {
                if (videoRef.current) {
                    const time = videoRef.current.currentTime;
                    setCurrentTime(time);

                    // Check for questions at current timestamp
                    checkForQuestions();

                    if (onTimeUpdate) {
                        onTimeUpdate(time);
                    }
                }
            }, 250); // Update 4 times per second for smoother progress
        }, [onTimeUpdate, checkForQuestions]);

        // Stop progress tracking interval
        const stopProgressTracking = useCallback(() => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        }, []);

        // Function to check if user can navigate to a specific time
        const canNavigateToTime = useCallback(
            (targetTimeSeconds: number) => {
                const targetTimeMs = targetTimeSeconds * 1000;

                // Find all questions that come before or at the target time
                const previousQuestions = timeToQuestionMap.filter(
                    ({ time }) => time <= targetTimeMs
                );

                // Check if all previous questions that cannot be skipped are answered
                for (const { question } of previousQuestions) {
                    if (
                        !question.can_skip &&
                        !answeredQuestions[question.id]?.answered
                    ) {
                        return false; // Cannot navigate forward past unanswered required questions
                    }
                }

                return true;
            },
            [timeToQuestionMap, answeredQuestions]
        );

        // Function to handle question marker click
        const handleQuestionMarkerClick = useCallback(
            (questionData: any) => {
                // Check if we can navigate to this question's time
                const questionTimeSeconds =
                    questionData.question_time_in_millis / 1000;

                if (!canNavigateToTime(questionTimeSeconds)) {
                    // Show a message that they need to answer previous questions first
                    console.log(
                        "Cannot navigate: Please answer previous required questions first"
                    );
                    return;
                }

                // Set the current question and show overlay
                setCurrentQuestion(questionData);
                setShowQuestion(true);

                // Pause the video
                if (videoRef.current) {
                    videoRef.current.pause();
                    setIsPlayed(false);
                    stopProgressTracking();
                    stopTimer();
                }
            },
            [canNavigateToTime, stopProgressTracking, stopTimer]
        );

        // Pause video when tab is switched
        useEffect(() => {
            const handleVisibilityChange = () => {
                if (document.hidden) {
                    // Tab switched away
                    setTabSwitchCount((prev) => prev + 1);

                    if (videoRef.current) {
                        videoRef.current.pause();
                        setIsPlayed(false);
                    }

                    // Close the verification dialog if it's open
                    if (showVerification) {
                        setShowVerification(false);

                        // Clear the verification timer
                        if (verificationTimerRef.current) {
                            clearInterval(verificationTimerRef.current);
                            verificationTimerRef.current = null;
                        }
                    }
                }
            };

            document.addEventListener(
                "visibilitychange",
                handleVisibilityChange
            );

            return () => {
                document.removeEventListener(
                    "visibilitychange",
                    handleVisibilityChange
                );
            };
        }, [showVerification]);

        // Activity tracking effect
        useEffect(() => {
            const endTime = videoEndTime.current || getEpochTimeInMillis();

            const newActivity = {
                id: activeItem?.id || "",
                activity_id: activityId.current,
                source: "VIDEO" as const,
                source_id: videoUrl,
                start_time: videoStartTime.current,
                end_time: endTime,
                duration: elapsedTime.toString(),
                timestamps: currentTimestamps.current,
                percentage_watched: calculatePercentageWatched(duration),
                sync_status: "STALE" as const,
                current_start_time: currentStartTimeRef.current,
                current_start_time_in_epoch: currentStartTimeInEpochRef.current,
                concentration_score: {
                    id: concentrationScoreId.current,
                    concentration_score: concentrationScore,
                    tab_switch_count: tabSwitchCount,
                    pause_count: pauseCount,
                    wrong_answer_count: wrongAnswerCount,
                    missed_answer_count: missedAnswerCount,
                    answer_times_in_seconds: answerTimesInSeconds,
                },
                new_activity: true,
            };
            addActivity(newActivity, true);
        }, [
            elapsedTime,
            duration,
            videoUrl,
            tabSwitchCount,
            wrongAnswerCount,
            missedAnswerCount,
            answerTimesInSeconds,
            pauseCount,
            concentrationScore,
            addActivity,
            activeItem,
        ]);

        // Prevent right-click on the video unless this role may download it.
        useEffect(() => {
            const handleContextMenu = (e: MouseEvent) => {
                if (allowVideoDownload) return;
                e.preventDefault();
            };

            const playerContainer = playerContainerRef.current;
            if (playerContainer) {
                playerContainer.addEventListener(
                    "contextmenu",
                    handleContextMenu
                );
            }

            return () => {
                if (playerContainer) {
                    playerContainer.removeEventListener(
                        "contextmenu",
                        handleContextMenu
                    );
                }
            };
        }, [allowVideoDownload]);

        // Close the overflow menu on outside click / Escape.
        useEffect(() => {
            if (!menuOpen) return undefined;
            const onPointerDown = (e: PointerEvent) => {
                if (!menuRef.current?.contains(e.target as Node))
                    setMenuOpen(false);
            };
            const onKey = (e: KeyboardEvent) => {
                if (e.key === "Escape") setMenuOpen(false);
            };
            document.addEventListener("pointerdown", onPointerDown, true);
            document.addEventListener("keydown", onKey);
            return () => {
                document.removeEventListener("pointerdown", onPointerDown, true);
                document.removeEventListener("keydown", onKey);
            };
        }, [menuOpen]);

        // Show/hide fullscreen controls on mouse movement
        const handleMouseMove = useCallback(() => {
            if (isFullscreen) {
                setShowFullscreenControls(true);

                // Clear any existing timeout
                if (fullscreenControlsTimeoutRef.current) {
                    clearTimeout(fullscreenControlsTimeoutRef.current);
                }

                // Set a new timeout to hide controls after 3 seconds
                fullscreenControlsTimeoutRef.current = setTimeout(() => {
                    setShowFullscreenControls(false);
                }, 3000);
            }
        }, [isFullscreen]);

        // Clean up fullscreen controls timeout
        useEffect(() => {
            return () => {
                if (fullscreenControlsTimeoutRef.current) {
                    clearTimeout(fullscreenControlsTimeoutRef.current);
                }
            };
        }, []);

        useEffect(() => {
            const handleFullscreenChange = () => {
                setIsFullscreen(!!document.fullscreenElement);

                // Show controls briefly when entering/exiting fullscreen
                if (!document.fullscreenElement) {
                    setShowFullscreenControls(true);

                    // Hide controls after 3 seconds
                    if (fullscreenControlsTimeoutRef.current) {
                        clearTimeout(fullscreenControlsTimeoutRef.current);
                    }

                    fullscreenControlsTimeoutRef.current = setTimeout(() => {
                        setShowFullscreenControls(false);
                    }, 3000);
                }
            };

            document.addEventListener(
                "fullscreenchange",
                handleFullscreenChange
            );

            return () => {
                document.removeEventListener(
                    "fullscreenchange",
                    handleFullscreenChange
                );
            };
        }, []);

        const togglePlay = () => {
            // Bookkeeping (segment timestamps, pause counts, first-play sync)
            // lives in handleVideoPlay/handleVideoPause, driven by the media
            // element's own events. Doing it here too ran BOTH paths for a
            // click on the video surface: every pause was counted twice, the
            // first play fired syncVideoTrackingData twice in one tick, and
            // the two paths computed segments with different math (wall-clock
            // ticks here vs the real playhead in handleVideoPause).
            if (!videoRef.current) return;
            if (isPlayed) {
                videoRef.current.pause();
            } else {
                safePlay(videoRef.current);
            }
        };

        // Skip forward/backward. Forward skips still respect the learner
        // navigation gate (unanswered required questions block seeking ahead).
        const skip = (delta: number) => {
            const v = videoRef.current;
            if (!v) return;
            const dur = Number.isFinite(v.duration) ? v.duration : duration;
            const target = Math.min(
                Math.max(v.currentTime + delta, 0),
                dur || Number.MAX_SAFE_INTEGER
            );
            if (delta > 0 && !canNavigateToTime(target)) {
                console.log(
                    "Navigation blocked: Please answer previous required questions first"
                );
                return;
            }
            v.currentTime = target;
            setCurrentTime(target);
        };

        // Scrub/seek from a pointer position on the progress bar. Forward
        // seeks respect the navigation gate.
        const seekToClientX = (clientX: number) => {
            const el = progressRef.current;
            const v = videoRef.current;
            if (!el || !v || !(duration > 0)) return;
            const rect = el.getBoundingClientRect();
            const pct = Math.min(
                Math.max((clientX - rect.left) / rect.width, 0),
                1
            );
            const t = pct * duration;
            if (t > currentTime && !canNavigateToTime(t)) {
                console.log(
                    "Navigation blocked: Please answer previous required questions first"
                );
                return;
            }
            v.currentTime = t;
            setCurrentTime(t);
        };

        const setVol = (val: number) => {
            const v = videoRef.current;
            if (!v) return;
            const nv = Math.min(Math.max(val, 0), 1);
            v.volume = nv;
            v.muted = nv === 0;
            setVolume(nv);
            setMuted(nv === 0);
        };

        const volumeFromClientX = (clientX: number) => {
            const el = volumeRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const pct = Math.min(
                Math.max((clientX - rect.left) / rect.width, 0),
                1
            );
            setVol(pct);
        };

        const toggleMute = () => {
            const v = videoRef.current;
            if (!v) return;
            if (v.muted || v.volume === 0) {
                v.muted = false;
                if (v.volume === 0) {
                    v.volume = 0.5;
                    setVolume(0.5);
                }
                setMuted(false);
            } else {
                v.muted = true;
                setMuted(true);
            }
        };

        const changeRate = (r: number) => {
            const v = videoRef.current;
            if (v) v.playbackRate = r;
            setPlaybackRate(r);
            setMenuOpen(false);
        };

        const handleDownload = async () => {
            setMenuOpen(false);
            if (!actualVideoUrl) return;
            try {
                const res = await fetch(actualVideoUrl);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = deriveFileName(actualVideoUrl);
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            } catch {
                // Cross-origin fetch blocked — fall back to opening the file.
                window.open(actualVideoUrl, "_blank", "noopener");
            }
        };

        // Keyboard shortcuts (ignored while typing or when an overlay is up).
        const handlePlayerKeyDown = (
            e: React.KeyboardEvent<HTMLDivElement>
        ) => {
            const target = e.target as HTMLElement;
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable
            ) {
                return;
            }
            if (showQuestion || showVerification) return;
            switch (e.code) {
                case "Space":
                case "KeyK":
                    e.preventDefault();
                    togglePlay();
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    skip(-SKIP_SECONDS);
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    skip(SKIP_SECONDS);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setVol((muted ? 0 : volume) + 0.1);
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    setVol((muted ? 0 : volume) - 0.1);
                    break;
                case "KeyM":
                    toggleMute();
                    break;
                case "KeyF":
                    toggleFullscreen();
                    break;
                default:
                    return;
            }
            handleMouseMove();
        };

        const toggleFullscreen = useCallback(async () => {
            if (!playerContainerRef.current) {
                console.error("Player container not available");
                return;
            }

            try {
                if (!document.fullscreenElement) {
                    await playerContainerRef.current.requestFullscreen();
                    setIsFullscreen(true);
                    setShowFullscreenControls(true);

                    // Hide controls after 3 seconds
                    if (fullscreenControlsTimeoutRef.current) {
                        clearTimeout(fullscreenControlsTimeoutRef.current);
                    }

                    fullscreenControlsTimeoutRef.current = setTimeout(() => {
                        setShowFullscreenControls(false);
                    }, 3000);
                } else {
                    await document.exitFullscreen();
                    setIsFullscreen(false);
                    setShowFullscreenControls(false);
                }
            } catch (error) {
                console.error("Error toggling fullscreen:", error);
            }
        }, []);

        // Format time for display: h:mm:ss once past an hour, else m:ss
        // (matches the admin FileVideoPlayer so long videos read correctly).
        const formatTime = (timeInSeconds: number) => {
            if (!Number.isFinite(timeInSeconds) || timeInSeconds < 0)
                return "0:00";
            const total = Math.floor(timeInSeconds);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const ss = s.toString().padStart(2, "0");
            if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`;
            return `${m}:${ss}`;
        };


        // Handle video events
        const handleTimeUpdate = () => {
            if (videoRef.current) {
                const newTime = videoRef.current.currentTime;
                setCurrentTime(newTime);
                if (onTimeUpdate) {
                    onTimeUpdate(newTime);
                }
            }
        };

        // Add effect to track percentage changes
        useEffect(() => {
            if (duration > 0) {
                const percentage = calculatePercentageWatched(duration);
                console.log("Video progress:", percentage + "%");
            }
        }, [currentTime, duration]);

        const handleVideoEnded = () => {
            setIsPlayed(false);
            stopTimer();
            stopProgressTracking();

            // Record timestamp for ending
            const now = getEpochTimeInMillis();
            videoEndTime.current = now;

            // On natural end, snap the interval end to the player's actual
            // duration rather than a wall-clock-tick estimate. The 1-Hz timer
            // can lag the onEnded event by up to ~1 s, undercounting the watch.
            const startTimeInMillis =
                convertTimeToSeconds(currentStartTimeRef.current) * 1000;
            const playerDuration = videoRef.current?.duration;
            const endTimeInMillis =
                Number.isFinite(playerDuration) && (playerDuration as number) > 0
                    ? Math.round((playerDuration as number) * 1000)
                    : startTimeInMillis;

            if (endTimeInMillis > startTimeInMillis) {
                const endTimeStamp = formatVideoTime(endTimeInMillis / 1000);
                currentTimestamps.current.push({
                    id: uuidv4(),
                    start_time: currentStartTimeRef.current,
                    end_time: endTimeStamp,
                    start: startTimeInMillis,
                    end: endTimeInMillis,
                });
            }

            currentStartTimeRef.current = formatVideoTime(currentTime);
            timestampDurationRef.current = 0;

            // Sync immediately on natural end so the learner sees 100%
            // without waiting for the periodic timer (or for tab close).
            // syncVideoTrackingData reads from Capacitor Preferences which
            // is populated by the activity-tracking useEffect on every tick;
            // by the time onEnded fires, the latest interval push has
            // already been written.
            syncVideoTrackingData();
        };

        const handleVideoPlay = () => {
            setIsPlayed(true);
            startTimer();
            startProgressTracking();

            // Record timestamp for playing
            const now = getEpochTimeInMillis();
            if (!videoStartTime.current) {
                videoStartTime.current = now;
            }

            if (isFirstPlay) {
                console.log("integrate add video activity api now");
                syncVideoTrackingData();
                setIsFirstPlay(false);

                if (!updateIntervalRef.current) {
                    // Periodic sync cadence = min(video duration, 60s).
                    const durSec = videoRef.current?.duration;
                    const periodMs = Math.max(
                        1000,
                        Math.min(
                            Number.isFinite(durSec) && (durSec as number) > 0
                                ? Math.round((durSec as number) * 1000)
                                : 60000,
                            60000
                        )
                    );
                    updateIntervalRef.current = setInterval(() => {
                        syncVideoTrackingData();
                    }, periodMs);
                }
            }

            currentStartTimeRef.current = formatVideoTime(currentTime);
            currentStartTimeInEpochRef.current =
                convertTimeToSeconds(currentStartTimeRef.current) * 1000;
        };

        const handleVideoPause = () => {
            setIsPlayed(false);
            stopTimer();
            stopProgressTracking();

            // Record timestamp for pausing
            const now = getEpochTimeInMillis();
            videoEndTime.current = now;

            // Use the player's actual playback position rather than a
            // wall-clock-tick estimate. The 1-Hz timer rounds down to the
            // last whole second, undercounting partial seconds.
            const startTimeInMillis =
                convertTimeToSeconds(currentStartTimeRef.current) * 1000;
            const playerCurrent = videoRef.current?.currentTime;
            const endTimeInMillis =
                Number.isFinite(playerCurrent) && (playerCurrent as number) >= 0
                    ? Math.round((playerCurrent as number) * 1000)
                    : startTimeInMillis;

            if (endTimeInMillis > startTimeInMillis) {
                const endTimeStamp = formatVideoTime(endTimeInMillis / 1000);
                currentTimestamps.current.push({
                    id: uuidv4(),
                    start_time: currentStartTimeRef.current,
                    end_time: endTimeStamp,
                    start: startTimeInMillis,
                    end: endTimeInMillis,
                });
            }

            currentStartTimeRef.current = formatVideoTime(currentTime);
            timestampDurationRef.current = 0;
            setPauseCount((prev) => prev + 1);
        };

        // Render question markers on progress bar
        const renderQuestionMarkers = () => {
            if (
                !timeToQuestionMap ||
                timeToQuestionMap.length === 0 ||
                duration <= 0
            )
                return null;

            return timeToQuestionMap.map(({ time, question }, index) => {
                const position = (time / 1000 / duration) * 100;
                const isAnswered = answeredQuestions[question.id]?.answered;
                const canSkip = question.can_skip;

                return (
                    <button
                        key={question.id}
                        className={`absolute w-3 h-3 rounded-full transform -translate-x-1/2 -translate-y-1/2 top-1/2 border-2 border-white shadow-lg transition-all hover:scale-125 z-10 ${isAnswered
                            ? "bg-green-500 hover:bg-green-600"
                            : canSkip
                                ? "bg-yellow-500 hover:bg-yellow-600"
                                : "bg-red-500 hover:bg-red-600"
                            }`}
                        style={{
                            left: `${Math.max(1.5, Math.min(98.5, position))}%`,
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleQuestionMarkerClick(question);
                        }}
                        title={
                            isAnswered
                                ? t("videoPlayer.questionMarker.titleAnswered", { number: index + 1, text: question.text_data.content })
                                : canSkip
                                    ? t("videoPlayer.questionMarker.titleSkippable", { number: index + 1, text: question.text_data.content })
                                    : t("videoPlayer.questionMarker.titleRequired", { number: index + 1, text: question.text_data.content })
                        }
                    >
                        {isAnswered ? (
                            <span className="text-white text-xs font-bold flex items-center justify-center w-full h-full">
                                ✓
                            </span>
                        ) : (
                            <span className="text-white text-xs font-bold flex items-center justify-center w-full h-full">
                                ?
                            </span>
                        )}
                    </button>
                );
            });
        };

        const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
        const isSilent = muted || volume === 0;
        const controlsVisible =
            !isFullscreen ||
            showFullscreenControls ||
            menuOpen ||
            scrubbing ||
            adjustingVolume;

        return (
            <div className="w-full flex flex-col items-center gap-4">
                {/* Non-fullscreen verification overlay - shown outside the player */}
                {showVerification && !isFullscreen && (
                    <div className="w-full mb-2 animate-in fade-in slide-in-from-top duration-300">
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg shadow-lg overflow-hidden">
                            <div className="p-3">
                                <div className="mt-1">
                                    <p className="text-xs text-neutral-600">
                                        <Trans
                                            t={t}
                                            i18nKey="verification.focusPrompt"
                                            values={{
                                                number: verificationNumbers[1],
                                                seconds: verificationCountdown,
                                            }}
                                            components={{
                                                1: <span className="text-primary-500 font-bold" />,
                                                2: <span className="text-primary-500 font-bold" />,
                                            }}
                                        />
                                    </p>
                                </div>
                                <div className="mt-2 flex justify-center space-x-2">
                                    {verificationNumbers.map(
                                        (number, index) => (
                                            <button
                                                key={index}
                                                onClick={() =>
                                                    handleVerificationClick(
                                                        index
                                                    )
                                                }
                                                className="px-2 py-1 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 bg-white text-neutral-600 border border-gray-200 hover:bg-gray-50"
                                            >
                                                {number}
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Video player container with verification overlay */}
                <div
                    ref={playerContainerRef}
                    tabIndex={0}
                    onKeyDown={handlePlayerKeyDown}
                    className="aspect-video w-full relative min-h-reg-200 sm:min-h-reg-250 md:min-h-reg-300 lg:h-full items-center flex justify-center overflow-hidden rounded-lg outline-none"
                    onMouseMove={handleMouseMove}
                >
                    {/* Verification overlay - only shown in fullscreen */}
                    {showVerification && isFullscreen && (
                        <div className="absolute inset-0 z-50 flex items-end justify-center pb-24 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                            <div className="relative animate-in slide-in-from-bottom-10 fade-in duration-500 w-full max-w-lg px-6">
                                <div className="bg-zinc-950 border border-zinc-800 text-white rounded-2xl shadow-2xl overflow-hidden relative">
                                    <div className="absolute bottom-0 start-0 h-1 bg-zinc-800 w-full">
                                        <div
                                            className="h-full bg-emerald-500 transition-all duration-1000 ease-linear"
                                            style={{ width: `${(verificationCountdown / 59) * 100}%` }}
                                        />
                                    </div>

                                    <div className="p-5 flex flex-col sm:flex-row items-center gap-section">
                                        <div className="flex-1 text-center sm:text-start space-y-2">
                                            <div className="flex items-center justify-center sm:justify-start gap-2.5">
                                                <span className="relative flex h-3 w-3">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                                                </span>
                                                <h4 className="text-base font-bold text-white tracking-tight">{t("videoPlayer.verification.focusCheckTitle")}</h4>
                                            </div>
                                            <p className="text-sm text-zinc-400 leading-relaxed">
                                                <Trans
                                                    t={t}
                                                    i18nKey="videoPlayer.verification.selectToMaintainStreak"
                                                    values={{ number: verificationNumbers[1] }}
                                                    components={{ 1: <span className="inline-block px-2 py-0.5 mx-1 bg-zinc-900 border border-zinc-700 rounded text-emerald-400 font-mono font-bold text-base shadow-inner md:align-middle" /> }}
                                                />
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3 shrink-0">
                                            {verificationNumbers.map((number, index) => (
                                                <button
                                                    key={index}
                                                    onClick={() => handleVerificationClick(index)} // Correct index is 1
                                                    className="w-12 h-12 flex items-center justify-center rounded-xl text-base font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all duration-200 active:scale-95 shadow-lg group relative overflow-hidden"
                                                >
                                                    <span className="relative z-10">{number}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-center mt-3">
                                    <span className="text-xs font-medium text-zinc-500 bg-black/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-md">
                                        {t("videoPlayer.verification.closingIn", { countdown: verificationCountdown })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* Verification Overlay - Premium UI */}
                    {showVerification && !isFullscreen && ( // Removed enableConcentrationScore check as it is checked in logic
                        <div className="absolute inset-0 z-50 flex items-end justify-center pb-8 pointer-events-none">
                            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-in fade-in duration-500 pointer-events-auto" />
                            <div className="relative z-50 animate-in slide-in-from-bottom-10 fade-in duration-500 w-full max-w-lg px-6 pointer-events-auto">
                                <div className="bg-zinc-950 border border-zinc-800 text-white rounded-2xl shadow-2xl overflow-hidden relative">
                                    <div className="absolute bottom-0 start-0 h-1 bg-zinc-800 w-full">
                                        <div
                                            className="h-full bg-emerald-500 transition-all duration-1000 ease-linear"
                                            style={{ width: `${(verificationCountdown / 59) * 100}%` }}
                                        />
                                    </div>

                                    <div className="p-5 flex flex-col sm:flex-row items-center gap-section">
                                        <div className="flex-1 text-center sm:text-start space-y-2">
                                            <div className="flex items-center justify-center sm:justify-start gap-2.5">
                                                <span className="relative flex h-3 w-3">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                                                </span>
                                                <h4 className="text-base font-bold text-white tracking-tight">{t("videoPlayer.verification.focusCheckTitle")}</h4>
                                            </div>
                                            <p className="text-sm text-zinc-400 leading-relaxed">
                                                <Trans
                                                    t={t}
                                                    i18nKey="videoPlayer.verification.selectToMaintainStreak"
                                                    values={{ number: verificationNumbers[1] }}
                                                    components={{ 1: <span className="inline-block px-2 py-0.5 mx-1 bg-zinc-900 border border-zinc-700 rounded text-emerald-400 font-mono font-bold text-base shadow-inner md:align-middle" /> }}
                                                />
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-3 shrink-0">
                                            {verificationNumbers.map((number, index) => (
                                                <button
                                                    key={index}
                                                    onClick={() => handleVerificationClick(index)} // Correct index is 1
                                                    className="w-12 h-12 flex items-center justify-center rounded-xl text-base font-bold bg-zinc-900 text-zinc-300 border border-zinc-800 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all duration-200 active:scale-95 shadow-lg group relative overflow-hidden"
                                                >
                                                    <span className="relative z-10">{number}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-center mt-3">
                                    <span className="text-xs font-medium text-zinc-500 bg-black/40 px-3 py-1 rounded-full border border-white/5 backdrop-blur-md">
                                        {t("videoPlayer.verification.closingIn", { countdown: verificationCountdown })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Center play affordance while paused */}
                    {!isPlayed &&
                        !isLoading &&
                        !error &&
                        !showQuestion &&
                        !showVerification &&
                        actualVideoUrl && (
                            <button
                                type="button"
                                aria-label={t("videoPlayer.play")}
                                onClick={togglePlay}
                                className="absolute inset-0 z-20 grid place-items-center bg-black/20 transition-colors hover:bg-black/30"
                            >
                                <span className="grid size-16 place-items-center rounded-full bg-black/60 text-white">
                                    <Play size={30} weight="fill" className="ml-1" />
                                </span>
                            </button>
                        )}

                    {/* Control bar (admin FileVideoPlayer style; one bar for
                        inline + native fullscreen). Auto-hides only while
                        fullscreen, via controlsVisible. */}
                    <div
                        className={cn(
                            "absolute inset-x-0 bottom-0 z-50 flex flex-col gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200",
                            controlsVisible
                                ? "opacity-100"
                                : "pointer-events-none opacity-0"
                        )}
                    >
                        {/* Seek bar */}
                        <div
                            ref={progressRef}
                            onPointerDown={(e) => {
                                e.preventDefault();
                                setScrubbing(true);
                                progressRef.current?.setPointerCapture(
                                    e.pointerId
                                );
                                seekToClientX(e.clientX);
                            }}
                            onPointerMove={(e) => {
                                if (scrubbing) seekToClientX(e.clientX);
                            }}
                            onPointerUp={(e) => {
                                setScrubbing(false);
                                progressRef.current?.releasePointerCapture(
                                    e.pointerId
                                );
                            }}
                            className="group/seek relative flex h-4 cursor-pointer items-center"
                        >
                            <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                                <div
                                    className="h-full rounded-full bg-primary-500"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                            <div
                                className={cn(
                                    "absolute size-3 -translate-x-1/2 rounded-full bg-primary-500 transition-opacity",
                                    scrubbing
                                        ? "opacity-100"
                                        : "opacity-0 group-hover/seek:opacity-100"
                                )}
                                style={{ left: `${progressPct}%` }}
                            />
                            {/* Interactive in-video question markers (learner) */}
                            {renderQuestionMarkers()}
                        </div>

                        {/* Buttons row */}
                        <div className="flex items-center gap-1 text-white">
                            <ControlButton
                                label={isPlayed ? t("videoPlayer.pause") : t("videoPlayer.play")}
                                onClick={togglePlay}
                            >
                                {isPlayed ? (
                                    <Pause size={20} weight="fill" />
                                ) : (
                                    <Play size={20} weight="fill" />
                                )}
                            </ControlButton>

                            <ControlButton
                                label={t("videoPlayer.rewindSeconds", { seconds: SKIP_SECONDS })}
                                onClick={() => skip(-SKIP_SECONDS)}
                            >
                                <ArrowCounterClockwise size={20} weight="bold" />
                                <span className="text-xs font-semibold">
                                    {SKIP_SECONDS}
                                </span>
                            </ControlButton>

                            <ControlButton
                                label={t("videoPlayer.forwardSeconds", { seconds: SKIP_SECONDS })}
                                onClick={() => skip(SKIP_SECONDS)}
                            >
                                <span className="text-xs font-semibold">
                                    {SKIP_SECONDS}
                                </span>
                                <ArrowClockwise size={20} weight="bold" />
                            </ControlButton>

                            <div
                                className="flex items-center gap-1"
                                onMouseEnter={() => setAdjustingVolume(true)}
                                onMouseLeave={() => setAdjustingVolume(false)}
                            >
                                <ControlButton
                                    label={isSilent ? t("videoPlayer.unmute") : t("videoPlayer.mute")}
                                    onClick={toggleMute}
                                >
                                    {isSilent ? (
                                        <SpeakerX size={20} />
                                    ) : (
                                        <SpeakerHigh size={20} />
                                    )}
                                </ControlButton>
                                <div
                                    ref={volumeRef}
                                    onPointerDown={(e) => {
                                        e.preventDefault();
                                        setAdjustingVolume(true);
                                        volumeRef.current?.setPointerCapture(
                                            e.pointerId
                                        );
                                        volumeFromClientX(e.clientX);
                                    }}
                                    onPointerMove={(e) => {
                                        if (adjustingVolume)
                                            volumeFromClientX(e.clientX);
                                    }}
                                    onPointerUp={(e) => {
                                        setAdjustingVolume(false);
                                        volumeRef.current?.releasePointerCapture(
                                            e.pointerId
                                        );
                                    }}
                                    className="hidden h-4 w-16 cursor-pointer items-center sm:flex"
                                >
                                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                                        <div
                                            className="h-full rounded-full bg-white"
                                            style={{
                                                width: `${(isSilent ? 0 : volume) * 100}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            <span className="ml-1 text-xs tabular-nums text-white/90">
                                {formatTime(currentTime)} /{" "}
                                {formatTime(duration)}
                            </span>

                            <div className="ml-auto flex items-center gap-1">
                                <ControlButton
                                    label={
                                        isFullscreen
                                            ? t("videoPlayer.exitFullScreen")
                                            : t("videoPlayer.fullScreen")
                                    }
                                    onClick={toggleFullscreen}
                                >
                                    {isFullscreen ? (
                                        <CornersIn size={20} />
                                    ) : (
                                        <CornersOut size={20} />
                                    )}
                                </ControlButton>

                                <div ref={menuRef} className="relative">
                                    <ControlButton
                                        label={t("videoPlayer.moreOptions")}
                                        onClick={() => setMenuOpen((o) => !o)}
                                        className={cn(menuOpen && "bg-white/20")}
                                    >
                                        <DotsThreeVertical
                                            size={22}
                                            weight="bold"
                                        />
                                    </ControlButton>

                                    {menuOpen && (
                                        <div className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-white/10 bg-black/90 py-1.5 text-white shadow-lg">
                                            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white/70">
                                                <Gauge size={16} weight="bold" />
                                                {t("videoPlayer.playbackSpeed")}
                                            </div>
                                            <div className="flex flex-wrap gap-1 px-3 pb-2 pt-1">
                                                {PLAYBACK_RATES.map((r) => (
                                                    <button
                                                        key={r}
                                                        type="button"
                                                        onClick={() =>
                                                            changeRate(r)
                                                        }
                                                        className={cn(
                                                            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                                                            r === playbackRate
                                                                ? "bg-primary-500 text-white"
                                                                : "bg-white/10 text-white hover:bg-white/20"
                                                        )}
                                                    >
                                                        {r === 1
                                                            ? t("videoPlayer.normalSpeed")
                                                            : `${r}x`}
                                                    </button>
                                                ))}
                                            </div>

                                            {allowVideoDownload && (
                                                <>
                                                    <div className="my-1 h-px bg-white/10" />
                                                    <button
                                                        type="button"
                                                        onClick={handleDownload}
                                                        className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                                                    >
                                                        <DownloadSimple
                                                            size={18}
                                                        />
                                                        <span className="flex-1 text-left">
                                                            {t("common.download")}
                                                        </span>
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Loading indicator */}
                    {isLoading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
                        </div>
                    )}

                    {/* Error message */}
                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <div className="bg-white p-4 rounded-lg shadow-lg max-w-md space-y-2">
                                <p className="text-red-500">{error}</p>
                                <button
                                    onClick={() => {
                                        setError(null);
                                        setIsLoading(true);
                                        loadVideoUrl();
                                    }}
                                    className="text-primary-500 hover:text-primary-600"
                                >
                                    {t("common.tryAgain")}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Video element */}
                    {actualVideoUrl && (
                        <video
                            key={actualVideoUrl}
                            ref={videoRef}
                            className="w-full h-full object-contain"
                            onLoadedMetadata={handleLoadedMetadata}
                            onCanPlay={handleCanPlay}
                            onTimeUpdate={handleTimeUpdate}
                            onError={handleVideoError}
                            onEnded={handleVideoEnded}
                            onPlay={handleVideoPlay}
                            onPause={handleVideoPause}
                            onClick={togglePlay}
                            onVolumeChange={(e) => {
                                setVolume(e.currentTarget.volume);
                                setMuted(e.currentTarget.muted);
                            }}
                            playsInline
                            preload="auto"
                            controlsList={allowVideoDownload ? undefined : "nodownload"}
                            // No crossOrigin: nothing reads the frames (no canvas,
                            // no tracks), and CORS mode only adds ways to fail —
                            // the native OfflineMedia responders send no
                            // Access-Control-Allow-Origin, and Google Meet
                            // recordings on CloudFront fail WebKit's CORS check
                            // ("Video source not supported" on iOS) while
                            // playing fine as a plain media request.
                        >
                            <source src={actualVideoUrl} type="video/mp4" />
                            <source src={actualVideoUrl} type="video/webm" />
                            <source src={actualVideoUrl} type="video/ogg" />
                            {t("videoPlayer.unsupportedBrowser")}
                        </video>
                    )}

                    {/* Question overlay */}
                    {showQuestion && currentQuestion && (
                        <VideoQuestionOverlay
                            question={currentQuestion}
                            onSubmit={handleQuestionSubmit}
                            onClose={handleQuestionClose}
                            onPause={() => {
                                if (videoRef.current) {
                                    videoRef.current.pause();
                                    setIsPlayed(false);
                                }
                            }}
                            previousAnswer={
                                currentQuestion
                                    ? answeredQuestions[currentQuestion.id]
                                        ?.selectedOptions
                                    : undefined
                            }
                        />
                    )}
                </div>
            </div>
        );
    }
);

CustomVideoPlayer.displayName = "CustomVideoPlayer";

export default CustomVideoPlayer;
