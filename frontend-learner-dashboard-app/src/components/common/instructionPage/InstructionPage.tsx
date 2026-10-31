import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "@tanstack/react-router";
import AssessmentStartModal from "./StartAssessment";
import { Preferences } from "@capacitor/preferences";
import { GET_TEXT_VIA_IDS } from "@/constants/urls";
import { fetchDataByIds } from "@/services/GetDataById";
import { RichText, Assessment as AssessmentType } from "@/types/assessment";
import {
  resolveAssessmentById,
  storeAssessmentInfo,
} from "@/routes/assessment/examination/-utils.ts/useFetchAssessment";
import AssessmentNavbar from "./AssessmentNavbar";
import { AssessmentInstructions } from "./AssessmentInstructions";
import { SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useExamExperienceSettings } from "@/hooks/use-exam-experience-settings";
import { useImmersiveMode } from "@/hooks/use-immersive-mode";
import { useIOSSafeAreaInsets } from "@/hooks/use-ios-safe-area-insets";
import { useLiveTestStore } from "@/stores/live-test-store";
import { bottomSafeAreaInset } from "@/utils/safe-area";
import { ProctorCheckIn } from "@/components/common/proctoring/ProctorCheckIn";
import { fetchProctoringConfig } from "@/services/proctoring";
import { isProctored, type ProctoringConfig } from "@/types/proctoring";

const InstructionPage = () => {
  const { t } = useTranslation("layoutCommonB");
  const [instructions, setInstructions] = useState<RichText>();
  const [assessmentInfo, setAssessmentInfo] = useState<AssessmentType>();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // Proctoring (V48). null until fetched; a failed fetch resolves to "off", so
  // the Start button never waits on this for an unproctored assessment.
  const [proctoring, setProctoring] = useState<ProctoringConfig | null>(null);
  const [proctorReady, setProctorReady] = useState(false);
  const { assessmentId } = useParams({ strict: false });
  const examExperience = useExamExperienceSettings();
  // The brief is part of the assessment safe zone: it is a full-bleed screen
  // with a sticky Start bar, so Android's system bars must come down here too,
  // not only once the paper opens.
  useImmersiveMode(examExperience.mobile.hideAppNavigation);
  useIOSSafeAreaInsets();
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);

  const fetchInstructions = async () => {
    setIsLoading(true);
    setHasError(false);
    try {
      const AssessmentData = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      let Assessment = AssessmentData.value
        ? JSON.parse(AssessmentData.value)
        : null;

      // First-load / public-link fallback: resolve from backend when storage key
      // is absent (direct link, race with navigation source's write).
      if (!Assessment?.instruction_id && assessmentId) {
        const resolved = await resolveAssessmentById(assessmentId);
        if (resolved) {
          await storeAssessmentInfo(resolved);
          Assessment = resolved;
        }
      }

      if (!Assessment) {
        setHasError(true);
        return;
      }

      setAssessmentInfo(Assessment);

      // Instructions are optional — show the page even if they fail to load.
      if (Assessment.instruction_id) {
        try {
          const data = await fetchDataByIds(
            Assessment.instruction_id,
            GET_TEXT_VIA_IDS
          );
          setInstructions(data[0]);
        } catch {
          console.warn("Could not fetch instructions for", Assessment.instruction_id);
        }
      }
    } catch (error) {
      console.error("Error fetching assessment:", error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInstructions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  useEffect(() => {
    if (!assessmentId) return;
    let cancelled = false;
    fetchProctoringConfig(assessmentId).then((cfg) => {
      if (!cancelled) setProctoring(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const isReady = !isLoading && !hasError && !!assessmentInfo;
  const needsCheckIn = isProctored(proctoring);
  const canStart = isReady && agreed && (!needsCheckIn || proctorReady);

  return (
    // fixed inset-0 rather than min-h-screen: the brief is a full-bleed screen
    // with its own scroller, so the sticky start bar stays reachable on a phone
    // instead of sitting below the fold behind the system nav bar.
    <div className="fixed inset-0 flex flex-col bg-neutral-50">
      <AssessmentNavbar title={assessmentInfo?.name ?? ""} />

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-8">
        <div className="mx-auto w-full max-w-2xl">
          {isLoading ? (
            <div className="flex min-h-reg-320 flex-col items-center justify-center gap-4">
              <SpinnerGap
                size={40}
                className="animate-spin text-primary-400"
                weight="bold"
              />
              <p className="text-body text-neutral-500">
                {t("instructionPage.instructionPage.loadingDetails")}
              </p>
            </div>
          ) : hasError || !assessmentInfo ? (
            <div className="flex min-h-reg-320 flex-col items-center justify-center gap-4 text-center">
              <WarningCircle size={48} className="text-danger-400" weight="duotone" />
              <p className="text-title font-semibold text-neutral-700">
                {t("instructionPage.instructionPage.detailsUnavailable")}
              </p>
              <p className="max-w-sm text-body text-neutral-500">
                {t("instructionPage.instructionPage.loadFailed")}
              </p>
            </div>
          ) : (
            <>
              <AssessmentInstructions
                instructions={instructions?.content ?? ""}
                duration={assessmentInfo.duration}
                preview={assessmentInfo.preview_time > 0}
                canSwitchSections={assessmentInfo.can_switch_section}
                assessmentInfo={assessmentInfo}
                examExperience={examExperience}
              />

              {/* Explicit acknowledgement. Proctoring can auto-submit a paper,
                  so the learner confirms they know that before the timer can
                  start — the Start button below stays disabled until they do. */}
              <label
                className={cn(
                  "mt-5 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                  agreed
                    ? "border-primary-300 bg-primary-50"
                    : "border-neutral-200 bg-white"
                )}
              >
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                  className="mt-0.5 size-4 flex-none accent-primary-500"
                />
                <span className="text-body leading-relaxed text-neutral-700">
                  {t("instructionPage.instructionPage.acknowledgement")}
                </span>
              </label>

              {needsCheckIn && proctoring && assessmentId && (
                <ProctorCheckIn
                  assessmentId={assessmentId}
                  config={proctoring}
                  onReadyChange={setProctorReady}
                />
              )}
            </>
          )}
        </div>
      </main>

      <div
        className="flex-none border-t border-neutral-200 bg-white px-4 pt-3 sm:px-6"
        style={{ // design-lint-ignore: dynamic safe-area inset padding
          paddingBottom: bottomSafeAreaInset(immersiveActive),
        }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <AssessmentStartModal disabled={!canStart} />
          {isReady && !agreed && (
            <p className="mt-2 text-center text-caption text-neutral-400">
              {t("instructionPage.instructionPage.tickToBegin")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default InstructionPage;
