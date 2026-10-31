import { useState, useEffect, useRef, useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { getLearnerTrackingSettings } from "@/services/learner-tracking-settings";
import { ArrowSquareOut, BookOpen } from "@phosphor-icons/react";
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

interface JupyterNotebookData {
  contentUrl: string;
  projectName: string;
  contentBranch: string;
  notebookLocation: string;
  activeTab: string;
  editorType: "jupyterEditor";
  timestamp: number;
}

interface JupyterNotebookSlideProps {
  published_data: string;
  documentId: string;
}

export const JupyterNotebookSlide: React.FC<JupyterNotebookSlideProps> = ({
  published_data,
  documentId,
}) => {
  const { t } = useTranslation("libraryCommonB");
  const [notebookData, setNotebookData] = useState<JupyterNotebookData | null>(
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

  // Activity tracking for Jupyter notebook (treating each interaction as a "page view")
  const [currentAction, setCurrentAction] = useState(1); // 1 for viewing, 2 for interacting, 3 for external access
  const actionStartTime = useRef<Date>(new Date());
  const actionViews = useRef<
    Array<{
      id: string;
      page: number; // Using page as action type (1=viewing, 2=interacting, 3=external)
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
  // const documentId = `jupyter-notebook-${activeItem?.id || "unknown"}`;

  // Save verification data
  const saveVerificationTime = async (time: number) => {
    try {
      await Preferences.set({
        key: "jupyter_verification_time",
        value: time.toString(),
      });
    } catch (error) {
      console.error("Error saving verification time:", error);
    }
  };

  const saveAnsweredTimeArray = async (times: number[]) => {
    try {
      await Preferences.set({
        key: "jupyter_answered_time",
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
          key: "jupyter_answered_time",
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

  // Track action changes (like interacting with notebook, opening external link)
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
      const data = JSON.parse(published_data) as JupyterNotebookData;
      setNotebookData(data);
      setIsLoading(false);

      // Initialize activity tracking on first load
      handleDocumentLoad();
    } catch (err) {
      console.error("Failed to parse Jupyter notebook data:", err);
      setError(t("jupyterSlide.errors.loadConfigFailed"));
      setIsLoading(false);
    }
  }, [published_data]);

  const handleOpenInNewTab = () => {
    if (notebookData?.contentUrl) {
      window.open(notebookData.contentUrl, "_blank");
      // Track external access
      handleActionChange(3);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-stack">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
          <div className="text-neutral-500">{t("jupyterSlide.loadingNotebook")}</div>
        </div>
      </div>
    );
  }

  if (error || !notebookData) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-stack">
          <div className="bg-red-50 rounded-full p-4">
            <BookOpen size={32} className="text-red-500" />
          </div>
          <div className="text-red-500">
            {error || t("jupyterSlide.errors.loadFailed")}
          </div>
        </div>
      </div>
    );
  }

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
                    i18nKey="jupyterSlide.verification.prompt"
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
              {t("jupyterSlide.paused.title")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("jupyterSlide.paused.body", { count: tabSwitchCount })}
            </p>
            <button
              onClick={handleResumeActivity}
              className="rounded bg-primary-500 px-4 py-2 text-white hover:bg-primary-600"
            >
              {t("jupyterSlide.paused.resume")}
            </button>
          </div>
        </div>
      )}

      <Card className="h-screen flex flex-col" onClick={handleUserActivity}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-orange-100 rounded-lg p-2">
                <BookOpen size={20} className="text-orange-600" />
              </div>
              <div className="flex flex-col">
                <h3 className="text-sm font-medium text-neutral-900">
                  {notebookData.projectName}
                </h3>
                <p className="text-xs text-neutral-500">
                  {t("jupyterSlide.header.branchLocation", {
                    branch: notebookData.contentBranch,
                    location: notebookData.notebookLocation,
                  })}
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
                {t("jupyterSlide.openInNewTab")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0 relative">
          <iframe
            src={notebookData.contentUrl}
            title={notebookData.projectName}
            className="w-full h-full border-none rounded-b-lg"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            loading="lazy"
            onLoad={() => {
              setIsLoading(false);
              handleUserActivity(); // Track iframe load
              handleActionChange(2); // Action type 2 for notebook interaction
            }}
            onError={() => setError(t("jupyterSlide.errors.loadFailed"))}
          />

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-b-lg">
              <div className="flex flex-col items-center gap-stack">
                <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
                <div className="text-neutral-500">
                  {t("jupyterSlide.loadingInterface")}
                </div>
              </div>
            </div>
          )}

          {/* Footer overlay */}
          <div className="absolute bottom-0 start-0 end-0 border-t border-neutral-200 bg-white/95 backdrop-blur-sm px-4 py-2 flex items-center justify-between text-xs text-neutral-500">
            <div className="flex items-center gap-4">
              <span>{t("jupyterSlide.footer.type")}</span>
              <span>{t("jupyterSlide.footer.activeTab", { tab: notebookData.activeTab })}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs">
                {t("jupyterSlide.footer.interactive")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
