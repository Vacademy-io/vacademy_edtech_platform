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
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
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
  type ReattemptRequestType,
} from "@/services/reattempt-request";
import { findQuestionPosition } from "./question-position";

export type HelpModalType = "instructions" | "alerts" | "reattempt" | "time" | "report";

interface HelpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: HelpModalType;
}

const REQUEST_TYPE: Partial<Record<HelpModalType, ReattemptRequestType>> = {
  reattempt: "REATTEMPT",
  time: "TIME_INCREASE",
  report: "PROBLEM_REPORT",
};

/** A learner's report text is a few sentences; the cap only stops a runaway paste. */
const REPORT_MAX_LENGTH = 1000;

export function HelpModal({ open, onOpenChange, type }: HelpModalProps) {
  const { t } = useTranslation("courseComponentsExtra");
  const [instructions, setInstructions] = useState<RichText>();
  const [assessmentInfo, setAssessmentInfo] = useState<AssessmentType>();
  const [reason, setReason] = useState("");
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  // Field selectors, not the whole store: this dialog is mounted for the whole exam (in every
  // layout), and a whole-store subscription would re-render it on every timer tick.
  const assessment = useAssessmentStore((s) => s.assessment);
  const currentQuestionId = useAssessmentStore((s) => s.currentQuestion?.question_id ?? null);
  //  const { assessment , currentSection} = useAssessmentStore();
  // const { assessment, currentSection } = useAssessmentStore();
  // const { alerts, requests, addRequest } = useAlertsStore();
  const { alerts } = useAlertsStore();
  // The live test has already resolved these; `useLiveTestUi` falls back to the
  // documented defaults when this modal is rendered outside the provider.
  const { settings: examExperience } = useLiveTestUi();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<ReattemptRequest[]>([]);

  const requestType = REQUEST_TYPE[type];
  const isRequestType = requestType !== undefined;
  const isReport = type === "report";
  // A report is about the question on screen when the learner opened the dialog. Held from the
  // moment it opens: on a per-question timed paper the exam can move on while they type.
  const [openedOnQuestionId, setOpenedOnQuestionId] = useState<string | null>(null);
  useEffect(() => {
    if (open) setOpenedOnQuestionId(currentQuestionId);
    // Only when the dialog opens, never while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const reportQuestionId = isReport ? openedOnQuestionId : null;
  const reportQuestion = useMemo(
    () => findQuestionPosition(assessment, reportQuestionId),
    [assessment, reportQuestionId]
  );

  // Reattempt and time requests: one open request per type. Reports: one per question.
  const pendingRequest = useMemo(
    () =>
      myRequests.find(
        (r) =>
          r.request_type === requestType &&
          r.status === "PENDING" &&
          (!isReport || (r.question_id ?? null) === reportQuestionId)
      ) ?? null,
    [myRequests, requestType, isReport, reportQuestionId]
  );

  // What the institute wrote back on this learner's closed reports, newest first.
  const reportReplies = useMemo(
    () =>
      isReport
        ? myRequests.filter(
            (r) =>
              r.request_type === "PROBLEM_REPORT" &&
              r.status === "RESOLVED" &&
              Boolean(r.review_note?.trim())
          )
        : [],
    [myRequests, isReport]
  );

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
        setMyRequests(mine);
      } catch (error) {
        // Non-fatal: worst case the learner sees a blank form and the backend
        // de-duplicates on submit anyway.
        console.error("Could not load existing requests:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isRequestType]);

  const handleSubmitRequest = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const assessmentId = await getAssessmentId();
      if (!assessmentId) {
        throw new Error(t("helpModal.couldNotIdentifyAssessment"));
      }
      if (!requestType) return;
      const created = await createReattemptRequest({
        assessmentId,
        requestType,
        reason: reason.trim(),
        attemptId: assessment?.attempt_id ?? null,
        questionId: reportQuestionId,
      });
      setMyRequests((previous) => [
        created,
        ...previous.filter((r) => r.id !== created.id),
      ]);
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
      case "report":
        return t("helpModal.titles.report");
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
      case "report":
        return (
          <div className="mt-4 space-y-4">
            <p className="text-body text-neutral-600">{t("helpModal.report.intro")}</p>
            {reportQuestion && (
              <p className="inline-flex rounded-full bg-primary-50 px-3 py-1 text-caption font-semibold text-primary-500">
                {reportQuestion.sectionName
                  ? t("helpModal.report.questionInSection", {
                      number: reportQuestion.number,
                      section: reportQuestion.sectionName,
                    })
                  : t("helpModal.report.question", { number: reportQuestion.number })}
              </p>
            )}
            {pendingRequest ? (
              <div className="rounded-lg border border-warning-200 bg-warning-50 p-3">
                <p className="text-body font-semibold text-neutral-800">
                  {t("helpModal.report.alreadyReported")}
                </p>
                <p className="mt-1 text-caption text-neutral-600">
                  {t("helpModal.report.underReview")}
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
                  placeholder={t("helpModal.report.placeholder")}
                  maxLength={REPORT_MAX_LENGTH}
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
                  {isSubmitting ? t("helpModal.sending") : t("helpModal.report.send")}
                </Button>
              </>
            )}
            {reportReplies.length > 0 && (
              <div className="space-y-2 border-t border-neutral-200 pt-3">
                <p className="text-caption font-semibold text-neutral-700">
                  {t("helpModal.report.repliesTitle")}
                </p>
                {reportReplies.map((reply) => {
                  const position = findQuestionPosition(assessment, reply.question_id);
                  return (
                    <div key={reply.id} className="flex items-start gap-2 rounded-lg bg-success-50 p-3">
                      <CheckCircle className="mt-0.5 size-4 shrink-0 text-success-600" weight="fill" />
                      <div className="min-w-0">
                        {position && (
                          <p className="text-caption font-semibold text-neutral-700">
                            {t("helpModal.report.question", { number: position.number })}
                          </p>
                        )}
                        <p className="text-caption text-neutral-700">{reply.review_note}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
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
            {isReport
              ? t("helpModal.report.sentConfirmation")
              : t("helpModal.requestSentConfirmation")}
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
