import { useState, useEffect, useRef, useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getLearnerTrackingSettings } from "@/services/learner-tracking-settings";
import { GameController, ArrowSquareOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

// Activity tracking imports
import { v4 as uuidv4 } from "uuid";
import { useTrackingStore } from "@/stores/study-library/pdf-tracking-store";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { usePDFSync } from "@/hooks/study-library/usePdfSync";
import { Preferences } from "@capacitor/preferences";

// Utils for time tracking
const getISTTime = () => {
  return new Date().toISOString();
};

const getEpochTimeInMillis = () => {
  return Date.now();
};

interface ScratchProjectData {
  projectId: string;
  scratchUrl: string;
  embedType: string;
  autoStart: boolean;
  hideControls: boolean;
  editorType: "scratchEditor";
  timestamp: number;
  projectName: string;
}

interface ScratchProjectSlideProps {
  published_data: string;
  documentId: string;
}

export const ScratchProjectSlide: React.FC<ScratchProjectSlideProps> = ({
  published_data,
  documentId,
}) => {
  const { t } = useTranslation("libraryCommonB");
  const [projectData, setProjectData] = useState<ScratchProjectData | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Activity tracking state
  const { addActivity } = useTrackingStore();
  const { activeItem } = useContentStore();
  const { syncPDFTrackingData } = usePDFSync();

  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const activityId = useRef(uuidv4());
  const startTime = useRef(getISTTime());
  const startTimeInMillis = useRef(getEpochTimeInMillis());
  const [isFirstView, setIsFirstView] = useState(true);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Activity tracking for Scratch project (treating each interaction as a "page view")
  const [currentAction, setCurrentAction] = useState(1); // 1 for viewing, 2 for playing, 3 for external access
  const actionStartTime = useRef<Date>(new Date());
  const actionViews = useRef<
    Array<{
      id: string;
      page: number; // Using page as action type (1=viewing, 2=playing, 3=external)
      duration: number;
      start_time: string;
      end_time: string;
      start_time_in_millis: number;
      end_time_in_millis: number;
    }>
  >([]);
  const totalActionsPerformedRef = useRef<number>(0);

  // Verification state
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCountdown, setVerificationCountdown] = useState(59);
  const [verificationNumbers, setVerificationNumbers] = useState<number[]>([]);
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

  // Generate a unique document ID for tracking
  // const documentId = `scratch-project-${activeItem?.id || "unknown"}`;

  // Save verification data
  const saveVerificationTime = async (time: number) => {
    try {
      await Preferences.set({
        key: "scratch_verification_time",
        value: time.toString(),
      });
    } catch (error) {
      console.error("Error saving verification time:", error);
    }
  };

  const saveAnsweredTimeArray = async (times: number[]) => {
    try {
      await Preferences.set({
        key: "scratch_answered_time",
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
          key: "scratch_answered_time",
        });
        if (answeredTimeValue) {
          const savedAnsweredTime = JSON.parse(answeredTimeValue);
          setAnsweredTimeArray(savedAnsweredTime);
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

    inactivityTimeoutRef.current = setTimeout(() => {
      setIsPaused(true);
    }, trackingSettings.focus.hardPauseMinutes * 60 * 1000);

    if (verificationTimeoutRef.current) {
      clearTimeout(verificationTimeoutRef.current);
    }

    if (!showVerification) {
      startInactivityVerification();
    }
  }, [isPaused, showVerification, startInactivityVerification]);

  // Add tab visibility change handler
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden;

      if (isHidden) {
        setTabSwitchCount((prev) => {
          const newCount = prev + 1;
          return newCount;
        });
        setIsPaused(true);
        stopTimer();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [documentId, stopTimer]);

  // Start timer when component mounts
  useEffect(() => {
    startTimer();
    return () => {
      stopTimer();
    };
  }, [startTimer, stopTimer, documentId]);

  // Handle resume activity
  const handleResumeActivity = useCallback(() => {
    setIsPaused(false);
    startTimer();
    handleUserActivity();
  }, [startTimer, handleUserActivity]);

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
              (verificationNumbers[0] !== verificationNumbers[1] &&
                verificationNumbers[0] !== verificationNumbers[2])
          )
        )
      );

      const newAnsweredTimes = [...answeredTimeArray, responseTime];
      setAnsweredTimeArray(newAnsweredTimes);
      saveAnsweredTimeArray(newAnsweredTimes);

      if (index === correctIndex) {
        const currentTimeInSeconds = Math.floor(Date.now() / 1000);
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

    inactivityTimeoutRef.current = setTimeout(() => {
      setIsPaused(true);
    }, trackingSettings.focus.hardPauseMinutes * 60 * 1000);

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

  // Handle document load (first view)
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

  // Track action changes (like opening external link, editing)
  const handleActionChange = useCallback(
    (actionType: number) => {
      const now = getEpochTimeInMillis();
      const duration = Math.round(
        (now - actionStartTime.current.getTime()) / 1000
      );

      if (duration >= trackingSettings.documents.actionDwellSeconds) {
        // Only track actions longer than 5 seconds
        actionViews.current.push({
          id: uuidv4(),
          page: currentAction,
          duration,
          start_time: new Date(actionStartTime.current).toISOString(),
          end_time: new Date(now).toISOString(),
          start_time_in_millis: actionStartTime.current.getTime(),
          end_time_in_millis: now,
        });
      }

      setCurrentAction(actionType);
      actionStartTime.current = new Date();
      handleUserActivity();
    },
    [currentAction, handleUserActivity]
  );

  // Update activity tracking
  useEffect(() => {
    totalActionsPerformedRef.current = new Set(
      actionViews.current.map((v) => v.page)
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
      page_views: actionViews.current,
      total_pages_read: totalActionsPerformedRef.current,
      sync_status: "STALE",
      current_page: currentAction,
      current_page_start_time_in_millis: actionStartTime.current.getTime(),
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
    currentAction,
  ]);

  useEffect(() => {
    try {
      const data = JSON.parse(published_data) as ScratchProjectData;
      setProjectData(data);
      setIsLoading(false);

      // Initialize activity tracking on first load
      handleDocumentLoad();
    } catch (err) {
      console.error("Failed to parse Scratch project data:", err);
      setError(t("scratchSlide.errors.loadConfigFailed"));
      setIsLoading(false);
    }
  }, [published_data]);

  const handleOpenInNewTab = () => {
    if (projectData?.projectId) {
      const embedUrl = `https://scratch.mit.edu/projects/${
        projectData.projectId
      }/embed${projectData.autoStart ? "?autostart=true" : ""}`;
      window.open(embedUrl, "_blank");
      // Track external access
      handleActionChange(3);
    }
  };

  const handleSeeInside = () => {
    if (projectData?.projectId) {
      const editorUrl = `https://scratch.mit.edu/projects/${projectData?.projectId}/editor/`;
      window.open(editorUrl, "_blank");
      // Track external editing access
      handleActionChange(4);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-stack">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
          <div className="text-neutral-500">{t("scratchSlide.loadingProject")}</div>
        </div>
      </div>
    );
  }

  if (error || !projectData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-stack">
          <div className="bg-red-50 rounded-full p-4">
            <GameController size={32} className="text-red-500" />
          </div>
          <div className="text-red-500">
            {error || t("scratchSlide.errors.loadFailed")}
          </div>
        </div>
      </div>
    );
  }

  // Create the embed URL for Scratch
  const embedUrl = `https://scratch.mit.edu/projects/${
    projectData.projectId
  }/embed${projectData.autoStart ? "?autostart=true" : ""}`;

  return (
    <div className="h-full p-1 relative">
      {/* Verification overlay */}
      {showVerification && (
        <div className="absolute top-2 start-1/2 transform -translate-x-1/2 w-full max-w-xs z-50 animate-in fade-in slide-in-from-top duration-300">
          <div className="bg-yellow-50 border bg-primary-500 rounded-lg shadow-lg overflow-hidden">
            <div className="p-2">
              <div className="mt-1">
                <p className="text-xs text-neutral-600">
                  <Trans
                    i18nKey="scratchSlide.verification.prompt"
                    t={t}
                    values={{
                      number: Math.max(
                        ...verificationNumbers.filter(
                          (n) =>
                            n !== verificationNumbers[0] ||
                            (verificationNumbers[0] !== verificationNumbers[1] &&
                              verificationNumbers[0] !== verificationNumbers[2])
                        )
                      ),
                      countdown: verificationCountdown,
                    }}
                    components={{
                      num: <span className="text-primary-500" />,
                      cnt: <span className="text-primary-500" />,
                    }}
                  />
                </p>
              </div>
              <div className="mt-2 flex justify-center space-x-2">
                {verificationNumbers.map((number, index) => (
                  <button
                    key={index}
                    onClick={() => handleVerificationClick(index)}
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
              {t("scratchSlide.paused.title")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("scratchSlide.paused.body", { count: tabSwitchCount })}
            </p>
            <button
              onClick={handleResumeActivity}
              className="rounded bg-primary-500 px-4 py-2 text-white hover:bg-primary-600"
            >
              {t("scratchSlide.paused.resume")}
            </button>
          </div>
        </div>
      )}

      <Card className="h-screen flex flex-col" onClick={handleUserActivity}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-orange-100 rounded-lg p-2">
                <GameController size={20} className="text-orange-600" />
              </div>
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-neutral-900">
                  {projectData.projectName}
                </h3>
                <p className="text-xs text-neutral-500">
                  {t("scratchSlide.header.projectId", { id: projectData.projectId })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleOpenInNewTab();
                  handleUserActivity();
                }}
                className="flex items-center gap-1.5"
              >
                <ArrowSquareOut size={14} />
                {t("scratchSlide.openInScratch")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  handleSeeInside();
                  handleUserActivity();
                }}
                className="flex items-center gap-1.5"
              >
                <ArrowSquareOut size={14} />
                {t("scratchSlide.editInScratch")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0 relative">
          <iframe
            src={embedUrl}
            title={projectData.projectName}
            className="w-full h-full border-none rounded-b-lg"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            loading="lazy"
            onLoad={() => {
              setIsLoading(false);
              handleUserActivity(); // Track iframe load
              handleActionChange(2); // Action type 2 for project interaction
            }}
            onError={() => setError(t("scratchSlide.errors.loadFailed"))}
          />

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-b-lg">
              <div className="flex flex-col items-center gap-stack">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
                <div className="text-neutral-500">
                  {t("scratchSlide.loadingInterface")}
                </div>
              </div>
            </div>
          )}

          {/* Footer overlay */}
          <div className="absolute bottom-0 start-0 end-0 border-t border-neutral-200 bg-white/95 backdrop-blur-sm px-4 py-2 flex items-center justify-between text-xs text-neutral-500">
            <div className="flex items-center gap-4">
              <span>{t("scratchSlide.footer.type")}</span>
              <span>{t("scratchSlide.footer.embedType", { type: projectData.embedType })}</span>
            </div>
            <div className="flex items-center gap-2">
              {projectData.autoStart && (
                <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs">
                  {t("scratchSlide.footer.autoStart")}
                </span>
              )}
              <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs">
                {t("scratchSlide.footer.interactive")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
