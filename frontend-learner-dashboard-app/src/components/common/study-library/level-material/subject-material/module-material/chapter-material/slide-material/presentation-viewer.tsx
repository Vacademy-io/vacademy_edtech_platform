import type React from "react";
import { getLearnerTrackingSettings } from "@/services/learner-tracking-settings";
import { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { FileX } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

// Lazy load ExcalidrawViewer (3.7MB) - only load when presentation slide is viewed
const ExcalidrawViewer = lazy(() =>
  import("./ExcalidrawViewer").then(mod => ({ default: mod.ExcalidrawViewer }))
);

// Loading fallback for Excalidraw
const ExcalidrawLoadingFallback = () => {
  const { t } = useTranslation("studyContent");
  return (
    <div className="flex items-center justify-center w-full h-screen-80 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex flex-col items-center space-y-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="text-sm text-gray-600 font-medium">{t("presentation.loadingViewer")}</p>
      </div>
    </div>
  );
};
import { Slide } from '@/hooks/study-library/use-slides';
import { usePresentationTrackingStore } from "@/stores/study-library/presentation-tracking-store";
import { usePresentationSync } from "@/hooks/study-library/usePresentationSync";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { v4 as uuidv4 } from 'uuid';

interface PresentationViewerProps {
  slide: Slide;
}

// Helper functions for time management
const getISTTime = () => new Date().toISOString();
const getEpochTimeInMillis = () => Date.now();

const PresentationViewer: React.FC<PresentationViewerProps> = ({ slide }) => {
  const { t } = useTranslation("studyContent");
  const { addActivity } = usePresentationTrackingStore();
  const { syncPresentationTrackingData } = usePresentationSync();
  const { activeItem } = useContentStore();

  // Get fileId from slide.document_slide.published_data
  const fileId = slide.document_slide?.published_data;

  // Activity tracking state
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const activityId = useRef(uuidv4());
  const startTime = useRef(getISTTime());
  const startTimeInMillis = useRef(getEpochTimeInMillis());
  const [isFirstView, setIsFirstView] = useState(true);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Session tracking
  const sessionStartTime = useRef<Date>(new Date());
  const viewSessions = useRef<Array<{
    id: string;
    start_time: string;
    end_time: string;
    start_time_in_millis: number;
    end_time_in_millis: number;
    duration: number;
  }>>([]);
  const totalViewingTimeRef = useRef<number>(0);

  // Verification state for concentration tracking
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCountdown, setVerificationCountdown] = useState(59);
  const [verificationNumbers, setVerificationNumbers] = useState<number[]>([]);
  const [, setResponseTimesArray] = useState<number[]>([]);
  const [answeredTimeArray, setAnsweredTimeArray] = useState<number[]>([]);
  const verificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityTimeRef = useRef<number>(Date.now());
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Activity metrics
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [missedAnswerCount, setMissedAnswerCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [isTabHidden, setIsTabHidden] = useState(false);

  // Handle user activity to reset inactivity timer
  const handleUserActivity = useCallback(() => {
    lastActivityTimeRef.current = Date.now();

    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }

    // Institute-configurable idle threshold (Settings -> Learner Activity)
    const trackingSettings = getLearnerTrackingSettings();
    inactivityTimeoutRef.current = setTimeout(() => {
      if (trackingSettings.focus.idlePopupEnabled && !showVerification) {
        triggerVerification();
      }
    }, trackingSettings.focus.idlePopupDelaySeconds * 1000);
  }, [showVerification]);

  // Trigger verification popup
  const triggerVerification = useCallback(() => {
    const numbers = Array.from({ length: 3 }, () => Math.floor(Math.random() * 10));
    setVerificationNumbers(numbers);
    setVerificationCountdown(59);
    setShowVerification(true);

    // const startTime = Date.now(); // Future use for response time tracking

    // Countdown timer
    const countdownInterval = setInterval(() => {
      setVerificationCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          setShowVerification(false);
          setMissedAnswerCount(count => count + 1);
          setIsPaused(true);

          setTimeout(() => {
            setIsPaused(false);
            handleUserActivity();
          }, 2000);

          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    verificationTimerRef.current = countdownInterval;
  }, [handleUserActivity]);

  // Handle verification click
  const handleVerificationClick = useCallback((clickedIndex: number) => {
    const endTime = Date.now();
    const responseTime = endTime - (Date.now() - verificationCountdown * 1000);

    const targetNumber = Math.max(...verificationNumbers.filter((_, i) => i !== 0 ||
      (verificationNumbers[0] !== verificationNumbers[1] && verificationNumbers[0] !== verificationNumbers[2])));

    const isCorrect = verificationNumbers[clickedIndex] === targetNumber;

    if (isCorrect) {
      setResponseTimesArray(prev => [...prev, responseTime]);
      setAnsweredTimeArray(prev => [...prev, Math.round(responseTime / 1000)]);
    } else {
      setWrongAnswerCount(count => count + 1);
    }

    if (verificationTimerRef.current) {
      clearTimeout(verificationTimerRef.current);
    }

    setShowVerification(false);
    handleUserActivity();
  }, [verificationNumbers, verificationCountdown, handleUserActivity]);

  // Handle tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden;
      setIsTabHidden(isHidden);

      if (isHidden) {
        setTabSwitchCount(count => count + 1);
      } else {
        handleUserActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [handleUserActivity]);

  // Start tracking when component mounts
  useEffect(() => {
    if (!fileId) return;

    // Initialize activity tracking
    setIsFirstView(true);
    handleUserActivity();

    // Start the activity timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    // Start the periodic update
    if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
    updateIntervalRef.current = setInterval(() => {
      if (!isPaused && !isTabHidden) {
        const now = getEpochTimeInMillis();
        const duration = Math.round((now - sessionStartTime.current.getTime()) / 1000);

        if (duration >= getLearnerTrackingSettings().documents.pageDwellSeconds) {
          viewSessions.current.push({
            id: uuidv4(),
            start_time: new Date(sessionStartTime.current).toISOString(),
            end_time: new Date(now).toISOString(),
            start_time_in_millis: sessionStartTime.current.getTime(),
            end_time_in_millis: now,
            duration,
          });

          sessionStartTime.current = new Date(); // Reset session start time
        }
      }
    }, 30000); // Update every 30 seconds

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (updateIntervalRef.current) clearInterval(updateIntervalRef.current);
      if (verificationTimerRef.current) clearTimeout(verificationTimerRef.current);
      if (inactivityTimeoutRef.current) clearTimeout(inactivityTimeoutRef.current);
    };
  }, [fileId, isPaused, isTabHidden, handleUserActivity]);

  // Update activity tracking data
  useEffect(() => {
    if (!fileId) return;

    totalViewingTimeRef.current = viewSessions.current.reduce(
      (total, session) => total + session.duration,
      0
    );

    const activityData = {
      slide_id: activeItem?.id || "",
      activity_id: activityId.current,
      source: "PRESENTATION" as const,
      source_id: fileId || "",
      start_time: startTime.current,
      end_time: getISTTime(),
      start_time_in_millis: startTimeInMillis.current,
      end_time_in_millis: getEpochTimeInMillis(),
      duration: elapsedTime.toString(),
      view_sessions: viewSessions.current,
      total_viewing_time: totalViewingTimeRef.current,
      sync_status: "STALE" as const,
      current_session_start_time_in_millis: sessionStartTime.current.getTime(),
      new_activity: isFirstView,
      concentration_score: {
        id: activityId.current,
        concentration_score: 0,
        tab_switch_count: tabSwitchCount,
        pause_count: missedAnswerCount,
        wrong_answer_count: wrongAnswerCount,
        answer_times_in_seconds: answeredTimeArray,
      },
    };

    console.log("💾 [PresentationViewer] Adding activity to store:", {
      slideId: activityData.slide_id,
      activityId: activityData.activity_id,
      isFirstView: isFirstView,
      viewSessions: viewSessions.current.length,
      elapsedTime
    });

    addActivity(activityData, !isFirstView);

    // Immediately sync data when presentation is first viewed to set progress to 100%
    if (isFirstView) {
      console.log("🎯 [PresentationViewer] First view detected, triggering immediate sync");

      // Create an initial view session for immediate tracking
      if (viewSessions.current.length === 0) {
        const now = getEpochTimeInMillis();
        viewSessions.current.push({
          id: uuidv4(),
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
          start_time_in_millis: now,
          end_time_in_millis: now,
          duration: 1, // Minimal duration for initial view
        });
        console.log("📊 [PresentationViewer] Created initial view session for immediate tracking");
      }

      setIsFirstView(false);
      // Trigger immediate sync for first-time viewing (reduced delay for promptness)
      setTimeout(() => {
        console.log("⏰ [PresentationViewer] Executing immediate sync after delay");
        syncPresentationTrackingData()
          .then(() => {
            console.log("✅ [PresentationViewer] Immediate sync completed successfully");
          })
          .catch((error) => {
            console.error("❌ [PresentationViewer] Immediate sync failed:", error);
          });
      }, 500); // Reduced to 500ms for faster response
    }
  }, [
    elapsedTime,
    fileId,
    isPaused,
    answeredTimeArray,
    tabSwitchCount,
    missedAnswerCount,
    wrongAnswerCount,
    activeItem?.id,
    addActivity,
    isFirstView,
  ]);

  // Sync data periodically
  useEffect(() => {
    const syncInterval = setInterval(() => {
      console.log("🔄 [PresentationViewer] Periodic sync triggered");
      syncPresentationTrackingData()
        .then(() => {
          console.log("✅ [PresentationViewer] Periodic sync completed");
        })
        .catch((error) => {
          console.error("❌ [PresentationViewer] Periodic sync failed:", error);
        });
    }, 60000); // Sync every minute

    return () => clearInterval(syncInterval);
  }, [syncPresentationTrackingData]);

  // If fileId is undefined, show error state
  if (!fileId) {
    return (
      <div className="flex items-center justify-center h-full min-h-reg-400 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-center space-y-4 p-8 max-w-md mx-auto">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
            <FileX size={32} weight="duotone" className="text-gray-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-gray-900">
              {t("presentation.notAvailableTitle")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("presentation.notAvailableBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" onClick={handleUserActivity} onMouseMove={handleUserActivity}>
      {/* Verification overlay */}
      {showVerification && (
        <div className="absolute top-2 start-1/2 transform -translate-x-1/2 w-full max-w-xs z-50 animate-in fade-in slide-in-from-top duration-300">
          <div className="bg-yellow-50 border bg-primary-500 rounded-lg shadow-lg overflow-hidden">
            <div className="p-2">
              <div className="mt-1">
                <p className="text-xs text-neutral-600">
                  Just ensuring that you are actively learning, please click the
                  number{" "}
                  <span className="text-primary-500">
                    {Math.max(
                      ...verificationNumbers.filter(
                        (_, i) =>
                          i !== 0 ||
                          (verificationNumbers[0] !== verificationNumbers[1] &&
                            verificationNumbers[0] !== verificationNumbers[2])
                      )
                    )}
                  </span>{" "}
                  within{" "}
                  <span className="text-primary-500">
                    {verificationCountdown}{" "}
                  </span>
                  seconds.
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
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 text-center space-y-2">
            <h3 className="text-lg font-medium text-gray-900">
              {t("presentation.sessionPausedTitle")}
            </h3>
            <p className="text-sm text-gray-600">
              {t("presentation.sessionPausedBody")}
            </p>
          </div>
        </div>
      )}

      <Suspense fallback={<ExcalidrawLoadingFallback />}>
        <ExcalidrawViewer fileId={fileId} />
      </Suspense>
    </div>
  );
};

export default PresentationViewer;
