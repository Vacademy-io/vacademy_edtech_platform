"use client";

import type React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { getLearnerTrackingSettings } from "@/services/learner-tracking-settings";
import { useTranslation } from "react-i18next";
import type {
  DocumentLoadEvent,
  PageChangeEvent,
} from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { v4 as uuidv4 } from "uuid";
import { useTrackingStore } from "@/stores/study-library/pdf-tracking-store";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import { getISTTime } from "./utils";
import { usePDFSync } from "@/hooks/study-library/usePdfSync";
import { getEpochTimeInMillis } from "./utils";
import { PdfViewerComponent, PdfViewerComponentRef } from "./pdf-viewer-component";
import { Preferences } from "@capacitor/preferences";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
// import { useMediaRefs } from "@/stores/mediaRefsStore";

interface PDFViewerProps {
  documentId?: string;
  pdfUrl: string;
  /**
   * Open at this page (1-based, as cited by the chat) instead of the saved
   * progress. Clamped to the page count once the document has loaded.
   */
  startPage?: number;
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  documentId,
  pdfUrl,
  startPage,
}) => {
  const { t } = useTranslation("studyContent");
  const { addActivity } = useTrackingStore();
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [totalPages, setTotalPages] = useState(0);
  const pageStartTime = useRef<Date>(new Date());
  const activityId = useRef(uuidv4());
  const startTime = useRef(getISTTime());
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
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const totalPagesReadRef = useRef<number>(0);
  const startTimeInMillis = useRef(getEpochTimeInMillis());
  const { syncPDFTrackingData } = usePDFSync();
  const [isFirstView, setIsFirstView] = useState(true);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { activeItem } = useContentStore();

  // The slide this viewer's activity buffer belongs to.
  //
  // `activityId` and `pageViews` used to be created once per mount and the
  // buffered activity's slide_id was read from `activeItem` at flush time. When
  // the learner moved to the next slide, the still-mounted viewer rewrote the
  // buffer's slide_id to the new slide while keeping the *previous* slide's
  // page views. The sync then POSTed them under the new slide, and because the
  // backend merges an activity row by its client-supplied id, the whole row was
  // re-parented â the previous slide lost its tracking outright and the new one
  // absorbed page numbers it never had. That is how a 2-page reading note ended
  // up with 14 tracked pages (capped to 100%) while the 14-page PDF next to it
  // sat below 100% with no evidence left to recompute from.
  //
  // Binding the buffer to a slide and resetting it on change keeps each slide's
  // page views its own. Reset happens during render (refs only, no state) so the
  // effect below can never observe a buffer from the previous slide.
  const trackedSlideIdRef = useRef<string | null>(null);
  if (activeItem?.id && trackedSlideIdRef.current !== activeItem.id) {
    trackedSlideIdRef.current = activeItem.id;
    activityId.current = uuidv4();
    pageViews.current = [];
    totalPagesReadRef.current = 0;
    startTime.current = getISTTime();
    startTimeInMillis.current = getEpochTimeInMillis();
    pageStartTime.current = new Date();
  }
  // const { pdfRef } = useMediaRefs();
  // Verification state
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCountdown, setVerificationCountdown] = useState(59);
  const [verificationNumbers, setVerificationNumbers] = useState<number[]>([]);
  const [, setLastVerificationTime] = useState(0);
  const [responseTimesArray, setResponseTimesArray] = useState<number[]>([]);
  const [answeredTimeArray, setAnsweredTimeArray] = useState<number[]>([]);
  const verificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityTimeRef = useRef<number>(Date.now());
  const inactivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Update the state variables to include tab switch tracking and missed answers
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [missedAnswerCount, setMissedAnswerCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);

  // Track user activity
  const verificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Institute-configurable (Settings -> Learner Activity); defaults preserve the old constants.
  const trackingSettings = getLearnerTrackingSettings();
  const inactivityThreshold = trackingSettings.focus.idlePopupDelaySeconds * 1000;
  const {setCurrentPdfPage, navigationTrigger} = useMediaRefsStore();

  // Zero-based cited page, captured once per mount so a later prop change
  // cannot move the reader. Without one the viewer opens at the saved
  // progress marker exactly as before.
  const startPageIndexRef = useRef<number | null>(
    startPage !== undefined && startPage >= 1 ? Math.floor(startPage) - 1 : null
  );
  const openAtPageIndex =
    startPageIndexRef.current ?? activeItem?.progress_marker;

  // Add ref for PDF viewer component
  const pdfViewerRef = useRef<PdfViewerComponentRef>(null);

  // Tap-to-activate PDF on mobile/tablet so the outer page stays scrollable
  // until the user explicitly opts into interacting with the PDF viewer.
  const [isTouchViewport, setIsTouchViewport] = useState(false);
  const [pdfActive, setPdfActive] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return;
    // Phone + tablet screens â Tailwind's `lg` breakpoint is 1024px.
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      setIsTouchViewport(mq.matches);
      if (!mq.matches) setPdfActive(false);
    };
    update();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  // Prevent page scroll bounce on mobile (but allow PDF container to scroll)
  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    if (!isMobile) return;

    const html = document.documentElement;
    const originalHtmlOverscroll = html.style.getPropertyValue("overscroll-behavior");
    const originalBodyOverscroll = document.body.style.getPropertyValue("overscroll-behavior");

    html.style.setProperty("overscroll-behavior", "none");
    document.body.style.setProperty("overscroll-behavior", "none");

    return () => {
      if (originalHtmlOverscroll) {
        html.style.setProperty("overscroll-behavior", originalHtmlOverscroll);
      } else {
        html.style.removeProperty("overscroll-behavior");
      }
      if (originalBodyOverscroll) {
        document.body.style.setProperty("overscroll-behavior", originalBodyOverscroll);
      } else {
        document.body.style.removeProperty("overscroll-behavior");
      }
    };
  }, []);

  // Load saved verification time from Capacitor preferences
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        // Load answered_time array
        const { value: answeredTimeValue } = await Preferences.get({
          key: "pdf_answered_time",
        });
        if (answeredTimeValue) {
          const savedAnsweredTime = JSON.parse(answeredTimeValue);
          setAnsweredTimeArray(savedAnsweredTime);
        }

        // Load last verification time
        const { value } = await Preferences.get({
          key: "pdf_verification_time",
        });
        if (value) {
          const savedTime = Number.parseInt(value, 10);
          setLastVerificationTime(savedTime);
        }
      } catch (error) {
        console.error("Error loading saved verification data:", error);
      }
    };

    loadSavedData();
  }, []);

  // Save verification time to Capacitor preferences
  const saveVerificationTime = async (time: number) => {
    try {
      await Preferences.set({
        key: "pdf_verification_time",
        value: time.toString(),
      });
    } catch (error) {
      console.error("Error saving verification time:", error);
    }
  };

  // Save answered time array to Capacitor preferences
  const saveAnsweredTimeArray = async (times: number[]) => {
    try {
      await Preferences.set({
        key: "pdf_answered_time",
        value: JSON.stringify(times),
      });
    } catch (error) {
      console.error("Error saving answered time array:", error);
    }
  };

  // Update the generateVerificationNumbers function to randomize the order
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

    // Create array with all three numbers
    const numbers = [num1, correctNum, num2];

    // Shuffle the array to randomize the position of the correct number
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }

    setVerificationNumbers(numbers);
    return numbers.indexOf(correctNum);
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
          // Time's up, pause the PDF viewing
          setIsPaused(true);

          // Record missed answer
          setMissedAnswerCount((prev) => prev + 1);

          // Clear the timer
          if (verificationTimerRef.current) {
            clearInterval(verificationTimerRef.current);
            verificationTimerRef.current = null;
          }

          // Hide verification
          setShowVerification(false);

          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Show verification after inactivity
  const startInactivityVerification = useCallback(() => {
    if (verificationTimeoutRef.current) {
      clearTimeout(verificationTimeoutRef.current);
    }

    // Set timeout to show verification after inactivity threshold
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

  // Update the handleVerificationClick function to track wrong answers
  const handleVerificationClick = (index: number) => {
    // Clear the verification timer
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

    // Add response time to arrays regardless of correct/incorrect
    const newAnsweredTimes = [...answeredTimeArray, responseTime];
    setAnsweredTimeArray(newAnsweredTimes);
    saveAnsweredTimeArray(newAnsweredTimes);

    // Check if correct number was clicked
    if (index === correctIndex) {
      // Record verification time
      const currentTimeInSeconds = Math.floor(Date.now() / 1000);
      setLastVerificationTime(currentTimeInSeconds);
      saveVerificationTime(currentTimeInSeconds);

      // Add response time to arrays
      const newResponseTimes = [...responseTimesArray, responseTime];
      setResponseTimesArray(newResponseTimes);

      // Resume PDF viewing
      setIsPaused(false);

      // Hide verification
      setShowVerification(false);

      // Reset inactivity verification timer
      startInactivityVerification();
    } else {
      // Wrong number clicked, keep PDF paused
      setIsPaused(true);

      // Record wrong answer
      setWrongAnswerCount((prev) => prev + 1);

      // Close the verification dialog
      setShowVerification(false);
    }
  };

  // User activity tracking - updated to reset inactivity timer
  const handleUserActivity = useCallback(() => {
    lastActivityTimeRef.current = Date.now();

    // If PDF is paused due to inactivity, resume it
    if (isPaused) {
      setIsPaused(false);
    }

    // Reset inactivity timeout for auto-pause
    if (inactivityTimeoutRef.current) {
      clearTimeout(inactivityTimeoutRef.current);
    }

    // Set new inactivity timeout (5 minutes)
    inactivityTimeoutRef.current = setTimeout(
      () => {
        setIsPaused(true);
      },
      trackingSettings.focus.hardPauseMinutes * 60 * 1000
    );

    // Reset verification timeout
    if (verificationTimeoutRef.current) {
      clearTimeout(verificationTimeoutRef.current);
    }

    // If verification is showing, don't start a new verification timer
    if (!showVerification) {
      startInactivityVerification();
    }
  }, [isPaused, showVerification, startInactivityVerification]);

  // Add event listeners for user activity
  useEffect(() => {
    window.addEventListener("mousemove", handleUserActivity);
    window.addEventListener("mousedown", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("touchstart", handleUserActivity);
    window.addEventListener("scroll", handleUserActivity);

    // Set initial inactivity timeout
    inactivityTimeoutRef.current = setTimeout(
      () => {
        setIsPaused(true);
      },
      trackingSettings.focus.hardPauseMinutes * 60 * 1000
    );

    // Start initial verification timeout
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

  // Pause timer when PDF is paused
  useEffect(() => {
    if (isPaused) {
      stopTimer();
    } else {
      startTimer();
    }
  }, [isPaused]);

  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Start timer when component mounts
  useEffect(() => {
    startTimer();
    return () => {
      stopTimer();
    };
  }, []);

  // Add tab visibility change handler
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab switched away
        setTabSwitchCount((prev) => prev + 1);
        setIsPaused(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Update activity in real-time when elapsedTime changes
  useEffect(() => {
    // Only track the slide this buffer belongs to. Without this the viewer
    // would attribute the buffered page views to whatever slide happens to be
    // active at flush time â see trackedSlideIdRef above.
    const trackedSlideId = trackedSlideIdRef.current;
    if (!trackedSlideId || trackedSlideId !== activeItem?.id) return;

    totalPagesReadRef.current = new Set(
      pageViews.current.map((v) => v.page)
    ).size;

    addActivity(
      {
        slide_id: trackedSlideId,
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
        current_page: currentPage,
        current_page_start_time_in_millis: pageStartTime.current.getTime(),
        new_activity: true,
        // is_paused: isPaused,
        concentration_score: {
          id: activityId.current,
          concentration_score: 0,
          tab_switch_count: tabSwitchCount,
          pause_count: missedAnswerCount,
          wrong_answer_count: wrongAnswerCount,
          answer_times_in_seconds: answeredTimeArray,
        },
      },
      // true
    );
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

  const handleDocumentLoad = (e: DocumentLoadEvent) => {
    setTotalPages(e.doc.numPages);
    console.log(totalPages);
    const now = getEpochTimeInMillis();
    pageStartTime.current = new Date();
    startTimeInMillis.current = now;

    // Set the PDF length in the store
    const { setCurrentPdfLength } = useMediaRefsStore.getState();
    setCurrentPdfLength(e.doc.numPages);

    // A cited page past the end (stale citation, replaced file) lands on the
    // last page rather than leaving the viewer at the top.
    const startPageIndex = startPageIndexRef.current;
    if (
      startPageIndex !== null &&
      e.doc.numPages > 0 &&
      startPageIndex > e.doc.numPages - 1
    ) {
      const lastPageIndex = e.doc.numPages - 1;
      // Deferred a beat: the page layer is still being laid out on load.
      setTimeout(() => pdfViewerRef.current?.jumpToPage(lastPageIndex), 250);
    }

    if (isFirstView) {
      console.log("integrate add document activity api now");
      syncPDFTrackingData();
      setIsFirstView(false);

      // Start the 60-second interval for update notifications
      if (!updateIntervalRef.current) {
        updateIntervalRef.current = setInterval(
          () => {
            syncPDFTrackingData();
          },
          60 * 1000
        ); // 60 seconds in milliseconds
      }
    }
  };

  useEffect(() => {
    // Opened from a citation: the viewer starts at the cited page, so page
    // views are attributed to it rather than to the saved marker.
    if (startPageIndexRef.current !== null) {
      setCurrentPage(startPageIndexRef.current);
      return;
    }
    setCurrentPage(activeItem?.progress_marker || 0);
  }, [activeItem?.progress_marker]);

  const handlePageChange = (e: PageChangeEvent) => {
    const now = getEpochTimeInMillis();
    const duration = Math.round((now - pageStartTime.current.getTime()) / 1000);

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
    // console.log("e.currentPage: ", e.currentPage);
    // pdfRef.current = e.currentPage;
    setCurrentPage(e.currentPage);
    setCurrentPdfPage(e.currentPage);
    pageStartTime.current = new Date();

    // Changing page counts as user activity
    handleUserActivity();
  };

  useEffect(() => {
    startTimer();
    return () => {
      stopTimer();
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
      }
      if (verificationTimerRef.current) {
        clearInterval(verificationTimerRef.current);
      }
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
      }
      if (verificationTimeoutRef.current) {
        clearTimeout(verificationTimeoutRef.current);
      }
    };
  }, []);

  // Listen for navigation triggers from global store
  useEffect(() => {
    if (navigationTrigger > 0 && pdfViewerRef.current) {
      // The currentPdfPage from the store will be updated by navigateToPdfPage
      const { currentPdfPage } = useMediaRefsStore.getState();
      pdfViewerRef.current.jumpToPage(currentPdfPage);
    }
  }, [navigationTrigger]);

  // Update the return JSX to include a more informative pause dialog
  return (
    <div className="relative w-full h-full">
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
                        (n) =>
                          n !== verificationNumbers[0] ||
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
          <div className="bg-white p-4 rounded-lg shadow-lg text-center max-w-md">
            <h3 className="text-lg font-semibold mb-2">{t("pdfViewer.readingPaused")}</h3>
            {document.hidden ? (
              <p className="mb-4">
                {t("pdfViewer.returnToTab")}
              </p>
            ) : missedAnswerCount > 0 || wrongAnswerCount > 0 ? (
              <div className="mb-4">
                <p>{t("pdfViewer.pausedDueTo")}</p>
                {missedAnswerCount > 0 && (
                  <p className="text-amber-600">
                    {t("pdfViewer.missedVerification", { count: missedAnswerCount })}
                  </p>
                )}
                {wrongAnswerCount > 0 && (
                  <p className="text-red-600">
                    {t("pdfViewer.incorrectVerification", { count: wrongAnswerCount })}
                  </p>
                )}
                <p className="mt-2">
                  {t("pdfViewer.clickToResume")}
                </p>
              </div>
            ) : (
              <p className="mb-4">
                {t("pdfViewer.clickOrInteract")}
              </p>
            )}
            <button
              onClick={handleUserActivity}
              className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              {t("pdfViewer.resumeReading")}
            </button>
          </div>
        </div>
      )}

      <PdfViewerComponent
        ref={pdfViewerRef}
        pdfUrl={pdfUrl}
        handlePageChange={handlePageChange}
        handleDocumentLoad={handleDocumentLoad}
        initialPage={openAtPageIndex}
      />

      {/* Tap-to-interact overlay â keeps the outer page scrollable on phones
          and tablets until the user explicitly taps to engage with the PDF. */}
      {isTouchViewport && !pdfActive && (
        <div
          className="absolute inset-0 z-20 flex cursor-pointer items-end justify-center pb-6"
          style={{ touchAction: "pan-y" }}
          onClick={() => setPdfActive(true)}
          role="button"
          tabIndex={0}
          aria-label={t("pdfViewer.tapToEnableScroll")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setPdfActive(true);
          }}
        >
          <div className="pointer-events-none rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white shadow-lg">
            {t("pdfViewer.tapToEnableScroll")}
          </div>
        </div>
      )}

      {/* Floating exit chip at the viewport's bottom-left â always in view
          regardless of where the user has scrolled. */}
      {isTouchViewport && pdfActive && (
        <button
          type="button"
          onClick={() => setPdfActive(false)}
          className="fixed bottom-24 start-2 z-50 flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-1.5 text-2xs font-semibold text-white shadow-lg active:scale-95"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
          {t("pdfViewer.exitScroll")}
        </button>
      )}
    </div>
  );
};

export default PDFViewer;