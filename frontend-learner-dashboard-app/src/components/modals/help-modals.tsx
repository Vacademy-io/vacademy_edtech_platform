import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssessmentStore } from "@/stores/assessment-store";
import useAlertsStore from "@/stores/alerts-store";
// import SectionDetails from "../common/instructionPage/SectionDetails";
import { AssessmentInstructions } from "../common/instructionPage/AssessmentInstructions";
import { GET_TEXT_VIA_IDS } from "@/constants/urls";
import { fetchDataByIds } from "@/services/GetDataById";
import { RichText, Assessment as AssessmentType } from "@/types/assessment";
import { useEffect } from "react";
import { Preferences } from "@capacitor/preferences";
import { useLiveTestUi } from "../common/questionLiveTest/live-test-ui-context";
import { InlineErrorBoundary } from "@/components/core/inline-error-boundary";
import {
  createReattemptRequest,
  getMyReattemptRequests,
  type ReattemptRequest,
} from "@/services/reattempt-request";

interface HelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "instructions" | "alerts" | "reattempt" | "time";
}

export function HelpModal({ open, onOpenChange, type }: HelpModalProps) {
  const { t } = useTranslation("courseComponentsExtra");
  const [instructions, setInstructions] = useState<RichText>();
  const [assessmentInfo, setAssessmentInfo] = useState<AssessmentType>();
  const [reason, setReason] = useState("");
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const { assessment } = useAssessmentStore();
  //  const { assessment , currentSection} = useAssessmentStore();
  // const { assessment, currentSection } = useAssessmentStore();
  // const { alerts, requests, addRequest } = useAlertsStore();
  const { alerts } = useAlertsStore();
  // The live test has already resolved these; `useLiveTestUi` falls back to the
  // documented defaults when this modal is rendered outside the provider.
  const { settings: examExperience } = useLiveTestUi();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<ReattemptRequest | null>(
    null
  );

  const isRequestType = type === "reattempt" || type === "time";
  const requestType = type === "reattempt" ? "REATTEMPT" : "TIME_INCREASE";

  /** The assessment id lives in the same Preferences blob the exam shell reads. */
  const getAssessmentId = async (): Promise<string | null> => {
    const stored = await Preferences.get({ key: "InstructionID_and_AboutID" });
    const parsed = stored.value ? JSON.parse(stored.value) : null;
    return parsed?.assessment_id ?? null;
  };

  // Show a request that is already in flight rather than inviting a duplicate —
  // a learner watching a timer run down will reopen this dialog repeatedly.
  useEffect(() => {
    if (!open || !isRequestType) return;
    let cancelled = false;
    (async () => {
      try {
        const assessmentId = await getAssessmentId();
        if (!assessmentId) return;
        const mine = await getMyReattemptRequests(assessmentId);
        if (cancelled) return;
        setPendingRequest(
          mine.find(
            (r) => r.request_type === requestType && r.status === "PENDING"
          ) ?? null
        );
      } catch (error) {
        // Non-fatal: worst case the learner sees a blank form and the backend
        // de-duplicates on submit anyway.
        console.error("Could not load existing requests:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isRequestType, requestType]);

  const handleSubmitRequest = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const assessmentId = await getAssessmentId();
      if (!assessmentId) {
        throw new Error(t("helpModal.couldNotIdentifyAssessment"));
      }
      const created = await createReattemptRequest({
        assessmentId,
        requestType,
        reason: reason.trim(),
        attemptId: assessment?.attempt_id ?? null,
      });
      setPendingRequest(created);
      setReason("");
      setShowSuccessDialog(true);
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ??
        (error as Error)?.message ??
        t("helpModal.sendRequestFailed");
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };
  const fetchInstructions = async () => {
    try {
      const AssessmentData = await Preferences.get({
        key: "InstructionID_and_AboutID",
      });
      const Assessment = AssessmentData.value
        ? JSON.parse(AssessmentData.value)
        : null;
      setAssessmentInfo(Assessment);
      // Guard against a missing/half-written key — dereferencing
      // Assessment.instruction_id on null throws "Cannot read properties of
      // null (reading 'instruction_id')".
      if (!Assessment?.instruction_id) {
        return;
      }
      const data = await fetchDataByIds(
        Assessment.instruction_id,
        GET_TEXT_VIA_IDS
      );
      setInstructions(data[0]);
    } catch (error) {
      console.error("Error fetching assessments:", error);
      // toast.error("Failed to fetch assessments.");
    }
  };
  useEffect(() => {
    fetchInstructions();
  }, []);
  const getTitle = () => {
    switch (type) {
      case "instructions":
        return t("helpModal.titles.instructions");
      case "alerts":
        return t("helpModal.titles.alerts");
      case "reattempt":
        return t("helpModal.titles.reattempt");
      case "time":
        return t("helpModal.titles.time");
    }
  };

  const getContent = () => {
    switch (type) {
      case "instructions":
        if (!assessment) return null;
        // const currentSectionInstructions =
        //   assessment.section_dtos[currentSection] || "";
        // console.log(assessment);
        return (
          <>
            <div className="space-y-4 mt-4 max-h-96 overflow-y-auto">
              {/* <p>{assessment.assessmentInstruction}</p> */}
              {assessmentInfo && instructions && (
                <AssessmentInstructions
                  instructions={instructions.content}
                  duration={assessmentInfo.duration}
                  preview={assessmentInfo.preview_time > 0 ? true : false}
                  canSwitchSections={assessmentInfo.can_switch_section}
                  assessmentInfo={assessmentInfo}
                  examExperience={examExperience}
                />
              )}
              {/* <p>Current Section Instructions:</p>
              <div className="">
                <SectionDetails
                  section={assessment.section_dtos[currentSection]}
                />
              </div> */}
            </div>
            <div className="">
              {/* {open && type === "instructions" && (
                <div className="space-y-4 mt-4 max-h-96 overflow-y-auto">
                  <AssessmentInstructions
                    instructions={assessment?.assessmentInstruction}
                  />
                  <p>Current Section Instructions:</p>
                  <SectionDetails
                    section={assessment?.sections[currentSection]}
                  />
                </div>
              )} */}
            </div>
          </>
        );
      case "alerts":
        return (
          <div className="space-y-4 mt-4">
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-yellow-600">
                <WarningCircle className="h-5 w-5" />
                <p>{t("helpModal.noActiveAlerts")}</p>
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-2 bg-yellow-50 p-3 rounded-lg"
                >
                  <WarningCircle className="h-5 w-5 text-yellow-500 mt-0.5" />
                  <div>
                    <p className="text-sm text-yellow-700">{alert.message}</p>
                    <p className="text-xs text-yellow-600 mt-1">
                      {new Date(alert.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        );
      case "reattempt":
      case "time":
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-red-50 p-3 rounded-lg mt-4">
              <WarningCircle className="h-5 w-5 text-red-500 mt-0.5" />
              <p className="text-sm text-red-600">
                {t("helpModal.reasonPromptPrefix")}{" "}
                {type === "reattempt"
                  ? t("helpModal.reattemptWord")
                  : t("helpModal.timeExtensionWord")}{" "}
                {t("helpModal.reasonPromptSuffix")}
              </p>
            </div>
            {pendingRequest ? (
              <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
                <p className="text-body font-semibold text-neutral-800">
                  {t("helpModal.requestAlreadySent")}
                </p>
                <p className="mt-1 text-caption text-neutral-600">
                  {t("helpModal.requestUnderReview")}
                </p>
                {pendingRequest.reason && (
                  <p className="mt-2 text-caption italic text-neutral-500">
                    {t("helpModal.quotedReason", { reason: pendingRequest.reason })}
                  </p>
                )}
              </div>
            ) : (
              <>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("helpModal.reasonPlaceholder")}
                  className="min-h-reg-100"
                  disabled={isSubmitting}
                />
                {submitError && (
                  <p className="text-caption text-danger-600">{submitError}</p>
                )}
                <Button
                  className="w-full bg-primary-500"
                  disabled={reason.trim() === "" || isSubmitting}
                  onClick={handleSubmitRequest}
                >
                  {isSubmitting ? t("helpModal.sending") : t("helpModal.submit")}
                </Button>
              </>
            )}
          </div>
        );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle>{getTitle()}</DialogTitle>
          </DialogHeader>
          <InlineErrorBoundary>{getContent()}</InlineErrorBoundary>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogDescription>
            {t("helpModal.requestSentConfirmation")}
          </AlertDialogDescription>
          <AlertDialogAction
            onClick={() => {
              setShowSuccessDialog(false);
              onOpenChange(false);
            }}
          >
            {t("packageSessionMessages.close")}
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
