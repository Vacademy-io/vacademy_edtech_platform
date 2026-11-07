import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { useNavigate } from "@tanstack/react-router";
import { useLocation } from "@tanstack/react-router";
import { fetchPreviewData } from "@/routes/assessment/examination/-utils.ts/useFetchAssessment";
import { useProctoring } from "@/hooks/proctoring/useProctoring";
import { AssessmentPreview } from "../questionLiveTest/assessment-preview";
import { Preferences } from "@capacitor/preferences";
import { useAssessmentStore } from "@/stores/assessment-store";
// import { enableProtection } from "@/constants/helper";

interface AssessmentStartModalProps {
  /** Held closed until the learner acknowledges the proctoring rules. */
  disabled?: boolean;
}

const AssessmentStartModal = ({ disabled }: AssessmentStartModalProps) => {
  const { t } = useTranslation("layoutCommonB");
  const location = useLocation();
  const pathSegments = location.pathname.split("/");
  const assessmentId = pathSegments[3];
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [examHasStarted, setExamHasStarted] = useState(false);
  // MANUAL-evaluated assessments are answered by uploading a response (slide /
  // file-upload submission), so the entry button reads "Upload Answer" instead
  // of "Start Assessment". Read from the same storage key the start flow uses.
  const [isManual, setIsManual] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const loadEvaluationType = async () => {
      const stored = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      if (!stored.value) return;
      try {
        const parsed = JSON.parse(stored.value);
        setIsManual(parsed?.evaluation_type === "MANUAL");
      } catch {
        // Ignore malformed storage — fall back to the default label.
      }
    };
    loadEvaluationType();
  }, []);

  const { fullScreen } = useProctoring({
    forceFullScreen: true,
    // preventTabSwitch: true,
    // preventContextMenu: true,
    // preventUserSelection: true,
    // preventCopy: true,
  });

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleAssessmentAction = async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      // Check if this is a Survey assessment
      const assessmentData = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      const assessment = assessmentData.value
        ? JSON.parse(assessmentData.value)
        : null;

      if (assessment?.play_mode === "SURVEY") {
        // For Survey assessments, fetch data and go directly to live test
        const response = await fetchPreviewData(
          assessmentId,
          assessment?.batch_id || assessment?.package_session_id
        );

        if (response) {
          // Ensure the assessment store is properly initialized with the first question
          if (response.section_dtos && response.section_dtos.length > 0) {
            const { setAssessment, saveState } = useAssessmentStore.getState();
            setAssessment(response);
            
            // Save the state to storage so it persists when navigating
            await saveState();
            
            // Verify the first question is set
            const store = useAssessmentStore.getState();
            console.log("Survey assessment initialized:", {
              hasAssessment: !!store.assessment,
              hasCurrentQuestion: !!store.currentQuestion,
              firstQuestionId: store.currentQuestion?.question_id,
              sectionsCount: store.assessment?.section_dtos?.length
            });
          }
          
          fullScreen.trigger();
          setTimeout(() => {
            setIsOpen(false);
            setExamHasStarted(true);
            navigate({
              to: `/assessment/examination/${assessmentId}/LearnerLiveTest`,
              replace: true,
            });
          }, 100);
        } else {
          setIsOpen(false);
        }
      } else {
        // For other assessments, use the normal preview flow
        const response = await fetchPreviewData(
          assessmentId,
          assessment?.batch_id || assessment?.package_session_id
        );

        if (response) {
          fullScreen.trigger();
          // Wait before react finishes updating state
          setTimeout(() => {
            setIsOpen(false);
            setExamHasStarted(true);
            // enableProtection();
            navigate({
              to: `/assessment/examination/${assessmentId}/assessmentPreview`,
              replace: true,
            });
          }, 100);
        } else {
          // setShowErrorAlert(true);
          setIsOpen(false);
        }
      }
    } catch (error) {
      console.error("Error during assessment action:", error);
      // setShowErrorAlert(true);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  };

  const getContent = () => {
    return <AssessmentPreview />;
  };

  return (
    <div className="flex flex-col items-center">
      {examHasStarted ? (
        <div className="test-container">{getContent()}</div>
      ) : (
        <MyButton
          onClick={() => setIsOpen(true)}
          buttonType="primary"
          scale="large"
          layoutVariant="default"
          disable={disabled}
          className="h-12 w-full"
        >
          {isManual ? t("instructionPage.startAssessment.uploadAnswer") : t("instructionPage.startAssessment.startAssessment")}
        </MyButton>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between border-b border-neutral-100 bg-primary-50 p-4">
              <h3 className="text-title font-semibold text-primary-500">
                {t("instructionPage.startAssessment.startAssessment")}
              </h3>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t("instructionPage.startAssessment.close")}
                className="grid size-8 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-white hover:text-neutral-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5">
              <p className="text-body leading-relaxed text-neutral-600">
                {t("instructionPage.startAssessment.confirmBody")}
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-neutral-100 p-4">
              <MyButton
                onClick={handleClose}
                buttonType="secondary"
                scale="medium"
                layoutVariant="default"
                disable={isLoading}
              >
                {t("instructionPage.startAssessment.cancel")}
              </MyButton>
              <MyButton
                onClick={handleAssessmentAction}
                buttonType="primary"
                scale="medium"
                layoutVariant="default"
                disable={isLoading}
              >
                {isLoading ? t("instructionPage.startAssessment.loading") : t("instructionPage.startAssessment.proceed")}
              </MyButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssessmentStartModal;
