import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getLearnerTrackingSettings, getRequiredReadSeconds } from "@/services/learner-tracking-settings";
import { v4 as uuidv4 } from "uuid";
import { useTrackingStore } from "@/stores/study-library/pdf-tracking-store";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
import { getISTTime, getEpochTimeInMillis } from "./utils";
import { usePDFSync } from "@/hooks/study-library/usePdfSync";
import { Preferences } from "@capacitor/preferences";
import {
    DocViewerComponent,
    DocViewerComponentRef,
} from "./doc-viewer-component";

// Helper to strip expired query params from public AWS S3 URLs inside strings/HTML.
// Bounds the HTML case to real src/href/poster attribute values so it can never
// over-match a signed S3 URL inside a data-* block and truncate the slide (the
// whole-document scan used to). A bare URL is still stripped fully.
const stripAwsQueryParamsFromUrls = (input: string): string => {
    if (!input) return input;
    const dropQuery = (url: string): string => {
        if (!/amazonaws\.com/i.test(url)) return url;
        const q = url.indexOf("?");
        return q === -1 ? url : url.slice(0, q);
    };
    if (!/[<>]/.test(input) && /^\s*https?:\/\//i.test(input)) {
        return dropQuery(input.trim());
    }
    return input.replace(
        /(\b(?:src|href|poster)\s*=\s*)(["'])([^"']*)\2/gi,
        (_m: string, prefix: string, quote: string, url: string): string =>
            `${prefix}${quote}${dropQuery(url)}${quote}`
    );
};

interface DocViewerProps {
    docUrl: string;
    documentId: string;
    isHtml?: boolean;
    // Creative HTML (type 'HTML') â rendered in a sandboxed iframe.
    creativeHtml?: boolean;
}

export const DocViewer: React.FC<DocViewerProps> = ({
    docUrl,
    documentId,
    isHtml = false,
    creativeHtml = false,
}) => {
    const { t } = useTranslation("libraryCommonA");
    const { addActivity } = useTrackingStore();
    const { activeItem } = useContentStore();
    const { setCurrentPdfPage, navigationTrigger } = useMediaRefsStore();
    const { syncPDFTrackingData } = usePDFSync();
    //const [lastVerificationTime, setLastVerificationTime] = useState(0);
    // Activity tracking state
    const [elapsedTime, setElapsedTime] = useState(0);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const activityId = useRef(uuidv4());
    const startTime = useRef(getISTTime());
    const startTimeInMillis = useRef(getEpochTimeInMillis());
    const [isFirstView, setIsFirstView] = useState(true);
    const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Page tracking
    const [currentPage, setCurrentPage] = useState(0);
    //const [totalPages, setTotalPages] = useState(0);
    const pageStartTime = useRef<Date>(new Date());
    const pageViews = useRef<
        Array<{
            id: string;
            page: number;
            duration: number;
            start_time: string;
            end_time: string;
            start_time_in_millis: number;
            end_time_in_millis: number;
        }>
    >([]);
    const totalPagesReadRef = useRef<number>(0);

    // Verification state
    const [showVerification, setShowVerification] = useState(false);
    const [verificationCountdown, setVerificationCountdown] = useState(59);
    const [verificationNumbers, setVerificationNumbers] = useState<number[]>(
        []
    );
    //const [lastVerificationTime, setLastVerificationTime] = useState(0);
    const [responseTimesArray, setResponseTimesArray] = useState<number[]>([]);
    const [answeredTimeArray, setAnsweredTimeArray] = useState<number[]>([]);
    const verificationTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastActivityTimeRef = useRef<number>(Date.now());
    const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [isPaused, setIsPaused] = useState(false);

    // Activity metrics
    const [tabSwitchCount, setTabSwitchCount] = useState(0);
    const [missedAnswerCount, setMissedAnswerCount] = useState(0);
    const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
    const verificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    // Institute-configurable (Settings -> Learner Activity); defaults preserve the old constants.
  const trackingSettings = getLearnerTrackingSettings();
  const inactivityThreshold = trackingSettings.focus.idlePopupDelaySeconds * 1000;

    // Add ref for DOC viewer component
    const docViewerRef = useRef<DocViewerComponentRef>(null);

    // Add state for tab visibility
    const [isTabHidden, setIsTabHidden] = useState(document.hidden);
    // Sanitize incoming docUrl once per change (handles both raw HTML and plain URLs)
    const sanitizedDocUrl = useMemo(() => stripAwsQueryParamsFromUrls(docUrl || ""), [docUrl]);

    // Content-aware completion gate. A one-viewport HTML/DOC slide counted as
    // fully read after a single dwell window regardless of how much text it
    // held. Estimate the read time from the visible word count (institute-
    // configurable wpm + clamps); the synthetic "current page" view that
    // drives completion is withheld until the learner has that much focused
    // time on the slide.
    const requiredReadSeconds = useMemo(() => {
        const html = (sanitizedDocUrl || "").trim();
        let wordCount = 0;
        if (html && !/^https?:\/\//.test(html)) {
            wordCount = html
                .replace(/<style[\s\S]*?<\/style>/gi, " ")
                .replace(/<script[\s\S]*?<\/script>/gi, " ")
                .replace(/<[^>]*>/g, " ")
                .split(/\s+/)
                .filter(Boolean).length;
        }
        return getRequiredReadSeconds(wordCount, 1);
    }, [sanitizedDocUrl]);

    //const lastVisibilityState = useRef(document.hidden);

    // Save verification data
    const saveVerificationTime = async (time: number) => {
        try {
            await Preferences.set({
                key: "doc_verification_time",
                value: time.toString(),
            });
        } catch (error) {
            console.error("Error saving verification time:", error);
        }
    };

    const saveAnsweredTimeArray = async (times: number[]) => {
        try {
            await Preferences.set({
                key: "doc_answered_time",
                value: JSON.stringify(times),
            });
        } catch (error) {
            console.error("Error saving answered time array:", error);
        }
    };

    // Load saved verification data
    useEffect(() => {
        const loadSavedData = async () => {
            try {
                const { value: answeredTimeValue } = await Preferences.get({
                    key: "doc_answered_time",
                });
                if (answeredTimeValue) {
                    const savedAnsweredTime = JSON.parse(answeredTimeValue);
                    setAnsweredTimeArray(savedAnsweredTime);
                }

                const { value } = await Preferences.get({
                    key: "doc_verification_time",
                });
                if (value) {
                    //const savedTime = Number.parseInt(value, 10);
                    // setLastVerificationTime(savedTime);
                }
            } catch (error) {
                console.error("Error loading saved verification data:", error);
            }
        };

        loadSavedData();
    }, []);

    // Timer management
    const startTimer = useCallback(() => {
        if (timerRef.current) return;
        timerRef.current = setInterval(() => {
            setElapsedTime((prev) => prev + 1);
        }, 1000);
    }, []);

    const stopTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    // Generate verification numbers
    const generateVerificationNumbers = useCallback(() => {
        const correctNum = Math.floor(Math.random() * 100);
        let num1 = correctNum;
        let num2 = correctNum;
        while (num1 === correctNum) num1 = Math.floor(Math.random() * 100);
        while (num2 === correctNum || num2 === num1)
            num2 = Math.floor(Math.random() * 100);
        const numbers = [num1, correctNum, num2];
        for (let i = numbers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
        }
        setVerificationNumbers(numbers);
        return numbers.indexOf(correctNum);
    }, []);

    // Start verification timer
    const startVerificationTimer = useCallback(() => {
        if (verificationTimerRef.current)
            clearInterval(verificationTimerRef.current);
        setVerificationCountdown(59);
        verificationTimerRef.current = setInterval(() => {
            setVerificationCountdown((prev) => {
                if (prev <= 1) {
                    setIsPaused(true);
                    setMissedAnswerCount((prev) => prev + 1);
                    if (verificationTimerRef.current) {
                        clearInterval(verificationTimerRef.current);
                        verificationTimerRef.current = null;
                    }
                    setShowVerification(false);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    // Inactivity verification
    const startInactivityVerification = useCallback(() => {
        if (verificationTimeoutRef.current)
            clearTimeout(verificationTimeoutRef.current);
        verificationTimeoutRef.current = setTimeout(() => {
            if (trackingSettings.focus.idlePopupEnabled && !showVerification && !isPaused) {
                setShowVerification(true);
                generateVerificationNumbers();
                startVerificationTimer();
            }
        }, inactivityThreshold);
    }, [
        generateVerificationNumbers,
        isPaused,
        showVerification,
        startVerificationTimer,
    ]);

    // User activity tracking
    const handleUserActivity = useCallback(() => {
        lastActivityTimeRef.current = Date.now();

        if (isPaused) {
            setIsPaused(false);
        }

        if (inactivityTimeoutRef.current) {
            clearTimeout(inactivityTimeoutRef.current);
        }

        inactivityTimeoutRef.current = setTimeout(
            () => {
                setIsPaused(true);
            },
            trackingSettings.focus.hardPauseMinutes * 60 * 1000
        );

        if (verificationTimeoutRef.current) {
            clearTimeout(verificationTimeoutRef.current);
        }

        if (!showVerification) {
            startInactivityVerification();
        }
    }, [isPaused, showVerification, startInactivityVerification]);

    // Add tab visibility change handler
    useEffect(() => {
        console.log(
            "Setting up visibility change handler for document:",
            documentId
        );

        const handleVisibilityChange = () => {
            const isHidden = document.hidden;
            console.log("Visibility changed:", {
                hidden: isHidden,
                documentId,
                timestamp: new Date().toISOString(),
            });

            if (isHidden) {
                // Tab switched away
                console.log("Tab switched away - incrementing count");
                setTabSwitchCount((prev) => {
                    const newCount = prev + 1;
                    console.log("New tab switch count:", newCount);
                    return newCount;
                });
                setIsPaused(true);
                setIsTabHidden(true);
                stopTimer();
            } else {
                // Tab switched back
                console.log("Tab switched back - waiting for user interaction");
                setIsTabHidden(false);
                // Don't automatically resume, wait for user interaction
            }
        };

        // Check initial visibility state
        console.log("Initial visibility state:", {
            hidden: document.hidden,
            documentId,
            timestamp: new Date().toISOString(),
        });

        // Add visibility change listener
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // Cleanup
        return () => {
            console.log(
                "Cleaning up visibility change handler for document:",
                documentId
            );
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );
        };
    }, [documentId, stopTimer]);

    // Start timer when component mounts
    useEffect(() => {
        console.log("Starting initial timer for document:", documentId);
        startTimer();
        return () => {
            console.log("Cleaning up timer for document:", documentId);
            stopTimer();
        };
    }, [startTimer, stopTimer, documentId]);

    // Handle resume reading
    const handleResumeReading = useCallback(() => {
        console.log("Resuming reading:", {
            documentId,
            timestamp: new Date().toISOString(),
            isPaused,
            tabSwitchCount,
            isTabHidden,
        });

        setIsPaused(false);
        setIsTabHidden(false);
        startTimer();
        handleUserActivity();
    }, [
        startTimer,
        handleUserActivity,
        documentId,
        isPaused,
        tabSwitchCount,
        isTabHidden,
    ]);

    // Handle verification click
    const handleVerificationClick = useCallback(
        (index: number) => {
            if (verificationTimerRef.current) {
                clearInterval(verificationTimerRef.current);
                verificationTimerRef.current = null;
            }

            const responseTime = 59 - verificationCountdown;
            const correctIndex = verificationNumbers.indexOf(
                Math.max(
                    ...verificationNumbers.filter(
                        (n) =>
                            n !== verificationNumbers[0] ||
                            (verificationNumbers[0] !==
                                verificationNumbers[1] &&
                                verificationNumbers[0] !==
                                    verificationNumbers[2])
                    )
                )
            );

            const newAnsweredTimes = [...answeredTimeArray, responseTime];
            setAnsweredTimeArray(newAnsweredTimes);
            saveAnsweredTimeArray(newAnsweredTimes);

            if (index === correctIndex) {
                const currentTimeInSeconds = Math.floor(Date.now() / 1000);
                //setLastVerificationTime(currentTimeInSeconds);
                saveVerificationTime(currentTimeInSeconds);

                const newResponseTimes = [...responseTimesArray, responseTime];
                setResponseTimesArray(newResponseTimes);

                setIsPaused(false);
                setShowVerification(false);
                startInactivityVerification();
            } else {
                setIsPaused(true);
                setWrongAnswerCount((prev) => prev + 1);
                setShowVerification(false);
            }
        },
        [
            verificationCountdown,
            verificationNumbers,
            answeredTimeArray,
            responseTimesArray,
            startInactivityVerification,
        ]
    );

    // Add event listeners for user activity
    useEffect(() => {
        window.addEventListener("mousemove", handleUserActivity);
        window.addEventListener("mousedown", handleUserActivity);
        window.addEventListener("keydown", handleUserActivity);
        window.addEventListener("touchstart", handleUserActivity);
        window.addEventListener("scroll", handleUserActivity);

        inactivityTimeoutRef.current = setTimeout(
            () => {
                setIsPaused(true);
            },
            trackingSettings.focus.hardPauseMinutes * 60 * 1000
        );

        startInactivityVerification();

        return () => {
            window.removeEventListener("mousemove", handleUserActivity);
            window.removeEventListener("mousedown", handleUserActivity);
            window.removeEventListener("keydown", handleUserActivity);
            window.removeEventListener("touchstart", handleUserActivity);
            window.removeEventListener("scroll", handleUserActivity);

            if (inactivityTimeoutRef.current) {
                clearTimeout(inactivityTimeoutRef.current);
            }

            if (verificationTimeoutRef.current) {
                clearTimeout(verificationTimeoutRef.current);
            }
        };
    }, [handleUserActivity, startInactivityVerification]);

    // Timer management
    useEffect(() => {
        if (isPaused) {
            stopTimer();
        } else {
            startTimer();
        }
    }, [isPaused, startTimer, stopTimer]);

    // Handle document load
    const handleDocumentLoad = () => {
        if (isFirstView) {
            syncPDFTrackingData();
            setIsFirstView(false);

            if (!updateIntervalRef.current) {
                updateIntervalRef.current = setInterval(() => {
                    syncPDFTrackingData();
                }, 60 * 1000);
            }
        }
    };

    // Interactive creative-HTML slides (quiz/game) report their outcome via
    // postMessage; fold it into the SAME document activity the wrapper already
    // syncs â completion + quiz stats land in percentage_watched /
    // concentration_score with no separate pipeline.
    const interactionPctRef = useRef(0);

    const handleSlideProgress = useCallback(
        (percent: number) => {
            interactionPctRef.current = Math.max(
                interactionPctRef.current,
                Math.min(100, Math.max(0, percent))
            );
            handleUserActivity();
        },
        [handleUserActivity]
    );

    const handleSlideComplete = useCallback(
        (r: { score?: number; maxScore?: number; wrong?: number; timesSec?: number[] }) => {
            const wrong =
                typeof r.wrong === "number"
                    ? r.wrong
                    : typeof r.maxScore === "number" && typeof r.score === "number"
                      ? Math.max(0, r.maxScore - r.score)
                      : undefined;
            if (typeof wrong === "number") setWrongAnswerCount((prev) => Math.max(prev, wrong));
            if (Array.isArray(r.timesSec) && r.timesSec.length) {
                const nums = r.timesSec.filter((n) => typeof n === "number" && isFinite(n));
                if (nums.length) setAnsweredTimeArray((prev) => [...prev, ...nums]);
            }
            interactionPctRef.current = 100;
            // Guarantee a page_view exists so the activity syncs even on a fast finish.
            if (pageViews.current.length === 0) {
                const now = getEpochTimeInMillis();
                pageViews.current.push({
                    id: uuidv4(),
                    page: 0,
                    duration: Math.max(1, Math.round((now - startTimeInMillis.current) / 1000)),
                    start_time: new Date(startTimeInMillis.current).toISOString(),
                    end_time: new Date(now).toISOString(),
                    start_time_in_millis: startTimeInMillis.current,
                    end_time_in_millis: now,
                });
            }
            totalPagesReadRef.current = Math.max(totalPagesReadRef.current, 1);
            setTimeout(() => syncPDFTrackingData(), 150);
        },
        [syncPDFTrackingData]
    );

    // Handle page change
    const handlePageChange = useCallback(
        (page: number) => {
            const now = getEpochTimeInMillis();
            const duration = Math.round(
                (now - pageStartTime.current.getTime()) / 1000
            );

            if (duration >= trackingSettings.documents.pageDwellSeconds) {
                pageViews.current.push({
                    id: uuidv4(),
                    page: currentPage,
                    duration,
                    start_time: new Date(pageStartTime.current).toISOString(),
                    end_time: new Date(now).toISOString(),
                    start_time_in_millis: pageStartTime.current.getTime(),
                    end_time_in_millis: now,
                });
            }

            setCurrentPage(page);
            setCurrentPdfPage(page);
            pageStartTime.current = new Date();
            handleUserActivity();
        },
        [currentPage, handleUserActivity]
    );

    // Update activity tracking
    useEffect(() => {
        // Only run for the current slide
        if (activeItem?.id !== documentId) return;

        totalPagesReadRef.current = new Set(
            pageViews.current.map((v) => v.page)
        ).size;

        addActivity({
            slide_id: activeItem?.id || "",
            activity_id: activityId.current,
            source: "DOCUMENT" as const,
            source_id: documentId || "",
            start_time: startTime.current,
            end_time: getISTTime(),
            start_time_in_millis: startTimeInMillis.current,
            end_time_in_millis: getEpochTimeInMillis(),
            duration: elapsedTime.toString(),
            page_views: pageViews.current,
            total_pages_read: totalPagesReadRef.current,
            sync_status: "STALE",
            // The sync layer manufactures a page view for the current page
            // from these two fields — the mechanism that completes a
            // single-page document. Withhold them until the learner has spent
            // the estimated read time (focused, pause-aware) on the slide.
            ...(elapsedTime >= requiredReadSeconds
                ? {
                      current_page: currentPage,
                      current_page_start_time_in_millis:
                          pageStartTime.current.getTime(),
                  }
                : {}),
            new_activity: true,
            concentration_score: {
                id: activityId.current,
                concentration_score: 0,
                tab_switch_count: tabSwitchCount,
                pause_count: missedAnswerCount,
                wrong_answer_count: wrongAnswerCount,
                answer_times_in_seconds: answeredTimeArray,
            },
        });
    }, [
        elapsedTime,
        documentId,
        isPaused,
        answeredTimeArray,
        tabSwitchCount,
        missedAnswerCount,
        wrongAnswerCount,
        activeItem?.id,
        addActivity,
        currentPage,
    ]);

    // Listen for navigation triggers from global store
    useEffect(() => {
        if (navigationTrigger > 0 && docViewerRef.current) {
            const { currentPdfPage } = useMediaRefsStore.getState();
            docViewerRef.current.jumpToPage(currentPdfPage);
        }
    }, [navigationTrigger]);

    return (
        <div className="relative h-full w-full">
            {/* Verification overlay */}
            {showVerification && (
                <div className="absolute top-2 start-1/2 transform -translate-x-1/2 w-full max-w-xs z-50 animate-in fade-in slide-in-from-top duration-300">
                    <div className="bg-yellow-50 border bg-primary-500 rounded-lg shadow-lg overflow-hidden">
                        <div className="p-2">
                            <div className="mt-1">
                                <p className="text-xs text-neutral-600">
                                    <Trans
                                        t={t}
                                        i18nKey="verification.focusPrompt"
                                        values={{
                                            number: Math.max(
                                                ...verificationNumbers.filter(
                                                    (n) =>
                                                        n !==
                                                            verificationNumbers[0] ||
                                                        (verificationNumbers[0] !==
                                                            verificationNumbers[1] &&
                                                            verificationNumbers[0] !==
                                                                verificationNumbers[2])
                                                )
                                            ),
                                            seconds: verificationCountdown,
                                        }}
                                        components={{
                                            1: <span className="text-primary-500" />,
                                            2: <span className="text-primary-500" />,
                                        }}
                                    />
                                </p>
                            </div>
                            <div className="mt-2 flex justify-center space-x-2">
                                {verificationNumbers.map((number, index) => (
                                    <button
                                        key={index}
                                        onClick={() =>
                                            handleVerificationClick(index)
                                        }
                                        className="px-2 py-1 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 bg-white text-neutral-600 border-xl"
                                    >
                                        {number}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Pause overlay */}
            {isPaused && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="rounded-lg bg-white p-6 text-center space-y-4">
                        <h3 className="text-lg font-semibold">
                            {t("docViewer.pausedHeading")}
                        </h3>
                        <p className="text-sm text-gray-600">
                            {t("docViewer.pausedMessage", { count: tabSwitchCount })}
                        </p>
                        <button
                            onClick={handleResumeReading}
                            className="rounded bg-primary-500 px-4 py-2 text-white hover:bg-primary-600"
                        >
                            {t("docViewer.resumeReading")}
                        </button>
                    </div>
                </div>
            )}

            {/* Activity status */}
            {/* <div className="mb-2 text-xs text-gray-500">
        <span>Time spent: {Math.floor(elapsedTime / 60)}m {elapsedTime % 60}s</span> |{' '}
        <span className="font-medium text-primary-500">Tab switches: {tabSwitchCount}</span>
      </div> */}

            <DocViewerComponent
                ref={docViewerRef}
                docUrl={sanitizedDocUrl}
                handleDocumentLoad={handleDocumentLoad}
                handlePageChange={handlePageChange}
                initialPage={currentPage}
                isHtml={isHtml}
                creativeHtml={creativeHtml}
                onSlideProgress={handleSlideProgress}
                onSlideComplete={handleSlideComplete}
                scormSlideId={documentId}
            />
        </div>
    );
};
