"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import { MyButton } from "@/components/design-system/button";
import { useRouter } from "@tanstack/react-router";
import { startAssessment } from "@/routes/assessment/examination/-utils.ts/useFetchAssessment";
import { Storage } from "@capacitor/storage";
import { AssessmentPreviewData } from "@/types/assessment";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useProctoring } from "@/hooks";
import { App } from "@capacitor/app";
import { useLocation } from "@tanstack/react-router";
import { PluginListenerHandle } from "@capacitor/core";
import { Clock } from "@phosphor-icons/react";
import { QuestionHtmlContent } from "./question-html-content";
import { useImmersiveMode } from "@/hooks/use-immersive-mode";
import { useIOSSafeAreaInsets } from "@/hooks/use-ios-safe-area-insets";
import { useExamExperienceSettings } from "@/hooks/use-exam-experience-settings";
import { useLiveTestStore } from "@/stores/live-test-store";
import { topSafeAreaInset, bottomSafeAreaInset } from "@/utils/safe-area";

export function AssessmentPreview() {
  const { t } = useTranslation("questionTest");
  const router = useRouter();
  const currentPath = router.state.location.pathname;

  const newPath = currentPath.replace(/\/[^/]+$/, "/LearnerLiveTest");
  const { assessment } = useAssessmentStore();
  const { setAssessment, incrementTabSwitchCount, tabSwitchCount } =
    useAssessmentStore();
  const [activeSection, setActiveSection] = useState(0);
  const [timeLeft, setTimeLeft] = useState(() => {
    return (
      (assessment?.preview_total_time ? assessment.preview_total_time : 0) * 60
    );
  });
  const [showWarningModal, setShowWarningModal] = useState(false);
  // Starting an attempt is a one-shot, non-idempotent transition (PREVIEW -> LIVE).
  // Two entry points can fire it — the Start button and the timeLeft<=0 effect
  // below, which runs on mount whenever the assessment has no preview time — so
  // without a guard a double-tap or a remount sends two concurrent
  // assessment-start-assessment calls. The loser gets "Assessment already live or
  // in preview" (510) and, worse, the two racing writers can overwrite each
  // other's startTime and reset the learner's timer. The ref is what actually
  // guards (it is set synchronously, before any await); the state only drives
  // the disabled styling.
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const { fullScreen } = useProctoring({
    forceFullScreen: true,
    preventTabSwitch: true,
    preventContextMenu: true,
    preventUserSelection: true,
    preventCopy: true,
  });

  const location = useLocation();
  const examExperience = useExamExperienceSettings();
  // Same full-bleed safe zone as the brief and the live test.
  useImmersiveMode(examExperience.mobile.hideAppNavigation);
  useIOSSafeAreaInsets();
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  const [backButtonListener, setBackButtonListener] =
    useState<PluginListenerHandle | null>(null);

  useEffect(() => {
    const setupBackButtonListener = async () => {
      if (location.pathname === "/restricted-page") {
        const listener = await App.addListener("backButton", () => {
          console.log("Back button is disabled on this page");
        });
        setBackButtonListener(listener);
      }
    };

    setupBackButtonListener();

    return () => {
      if (backButtonListener) {
        backButtonListener.remove();
      }
    };
  }, [location.pathname]);

  const calculateMarkingScheme = (marking_json: string) => {
    try {
      const marking_scheme = JSON.parse(marking_json);
      return marking_scheme; // Ensure the JSON contains a number or string
    } catch (error) {
      console.error("Error parsing marking_json:", error);
      return 0; // Default value in case of an error
    }
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };
  const handleStartAssessment = async () => {
    // resetAssessment();
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      await startAssessment();
      router.navigate({ to: newPath, replace: true });
    } catch (error) {
      // Let the learner retry rather than stranding them on a dead button.
      console.error("Error starting assessment:", error);
      startingRef.current = false;
      setStarting(false);
    }
  };

  useEffect(() => {
    const setAssessmentData = async () => {
      try {
        const { value } = await Storage.get({ key: "Assessment_questions" });

        if (!value) {
          console.warn("No assessment data found in storage.");
          return;
        }

        const parsedData: AssessmentPreviewData = JSON.parse(value);
        setAssessment(parsedData);
      } catch (error) {
        console.error("Error parsing assessment data:", error);
      }
    };

    setAssessmentData();
  }, []);

  useEffect(() => {
    if (timeLeft <= 0) {
      handleStartAssessment();
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        incrementTabSwitchCount();
        setShowWarningModal(true);
      } else {
        setShowWarningModal(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [incrementTabSwitchCount]);

  const handleWarningClose = () => {
    setShowWarningModal(false);
    // if (tabSwitchCount >= 3) {
    //   handleSubmit();
    // }
  };

  if (!assessment) return null;

  return (
    <>
      {/* Same full-bleed shell as the live test: the preview is a timed screen
          of its own, so its Start button has to stay reachable on a phone
          rather than sitting at the end of a long page scroll. */}
      <div
        className="fixed inset-0 z-60 flex flex-col bg-neutral-50"
        style={{ // design-lint-ignore: dynamic safe-area inset padding
          paddingTop: topSafeAreaInset(immersiveActive),
        }}
      >
        <header className="flex h-14 flex-none items-center gap-3 border-b border-neutral-200 bg-white px-4 md:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-neutral-900">
              {t("preview.header.title")}
            </p>
            <p className="text-2xs text-neutral-500">
              {t("preview.header.subtitle")}
            </p>
          </div>
          <div className="flex flex-none items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5">
            <Clock size={15} weight="duotone" className="text-neutral-500" />
            <span className="font-mono text-body font-semibold tabular-nums text-neutral-800">
              {formatTime(timeLeft)}
            </span>
          </div>
        </header>

        {assessment.section_dtos.length > 1 && (
          <nav
            aria-label={t("preview.nav.sectionsAriaLabel")}
            className="flex flex-none gap-5 overflow-x-auto border-b border-neutral-200 bg-white px-4 [scrollbar-width:none] md:px-6 [&::-webkit-scrollbar]:hidden"
          >
            {assessment.section_dtos
              ?.map((section, originalIndex) => ({ section, originalIndex }))
              ?.sort(
                (a, b) => a.section.section_order - b.section.section_order,
              )
              ?.map(({ section, originalIndex }) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(originalIndex)}
                  aria-current={
                    activeSection === originalIndex ? "page" : undefined
                  }
                  className={`-mb-px flex flex-none items-center whitespace-nowrap border-b-2 py-3 text-caption font-semibold transition-colors md:text-body ${
                    activeSection === originalIndex
                      ? "border-neutral-900 text-neutral-900"
                      : "border-transparent text-neutral-500 hover:text-neutral-700"
                  }`}
                >
                  {section.name}
                </button>
              ))}
          </nav>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            {assessment.section_dtos[
              activeSection
            ].question_preview_dto_list.map((question, idx) => (
              <div
                key={question.question_id}
                className="rounded-2xl border border-neutral-200 bg-white p-4 md:p-5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-body font-semibold text-neutral-900">
                    {t("common.questionNumber", { number: idx + 1 })}
                  </span>
                  <span className="flex-1" />
                  <span className="rounded-md bg-success-50 px-2 py-1 text-3xs font-semibold uppercase tracking-wide text-success-700">
                    +
                    {
                      calculateMarkingScheme(question.marking_json).data
                        .totalMark
                    }
                  </span>
                </div>

                <QuestionHtmlContent
                  html={question.question.content}
                  className="mb-4 text-body text-neutral-800 md:text-subtitle"
                />

                <div className="flex flex-col gap-2">
                  {question.options.map((option) => (
                    <div
                      key={option.id}
                      className="rounded-xl border border-neutral-200 p-3 text-body text-neutral-700"
                    >
                      <QuestionHtmlContent html={option.text.content} inline />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>

        <div
          className="flex-none border-t border-neutral-200 bg-white px-4 pt-3 md:px-6"
          style={{ // design-lint-ignore: dynamic safe-area inset padding
            paddingBottom: bottomSafeAreaInset(immersiveActive),
          }}
        >
          <div className="mx-auto w-full max-w-4xl">
            <MyButton
              onClick={() => handleStartAssessment()}
              disable={starting}
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              className="h-12 w-full"
            >
              {starting
                ? t("preview.actions.starting")
                : t("preview.actions.startTest")}
            </MyButton>
          </div>
        </div>
      </div>

      <AlertDialog open={showWarningModal} onOpenChange={setShowWarningModal}>
        <AlertDialogContent>
          <AlertDialogDescription>
            {t("common.tabSwitchWarning", { count: tabSwitchCount })}
          </AlertDialogDescription>
          <AlertDialogAction
            onClick={() => {
              fullScreen.trigger();
              setTimeout(() => {
                handleWarningClose();
              }, 100);
            }}
          >
            {t("common.returnToTest")}
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
