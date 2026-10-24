import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import {
  STUDENT_REPORT_DETAIL_URL,
  STUDENT_REPORT_URL,
} from "@/constants/urls";
import { useNavigate } from "@tanstack/react-router";
import { Report } from "@/types/assessments/assessment-data-type";
import { formatDuration, getSubjectNameById } from "@/constants/helper";
import { formatDateTime } from "@/lib/format-date";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { MyButton } from "@/components/design-system/button";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/design-system/states";
import { FileText, Eye } from "@phosphor-icons/react";
import { getFileDetail } from "@/services/upload_file";
import { toast } from "sonner";
import { EvaluatedReportDialog } from "@/components/common/student-test-records/evaluated-report-dialog";
import { useTranslation } from "react-i18next";
import { isReportableAttempt } from "../-utils/reportable-attempt";
import { openStudentReport } from "@/services/student-report-routing";

interface EvaluatedPreview {
  url: string;
  fileName?: string;
  fileType?: string;
  title: string;
}

const PLAY_MODE_KEYS: Record<string, string> = {
  EXAM: "card.playMode.exam",
  MOCK: "card.playMode.mock",
  PRACTICE: "card.playMode.practice",
  SURVEY: "card.playMode.survey",
  MANUAL_UPLOAD_EXAM: "card.playMode.offlineExam",
};

export const viewStudentReport = async (
  assessmentId: string,
  attemptId: string,
  instituteId: string | null
) => {
  const response = await authenticatedAxiosInstance({
    method: "GET",
    url: STUDENT_REPORT_DETAIL_URL,
    params: {
      assessmentId,
      attemptId,
      instituteId,
    },
  });
  return response?.data;
};

export const handleGetStudentReport = ({
  assessmentId,
  attemptId,
  instituteId,
}: {
  assessmentId: string;
  attemptId: string;
  instituteId: string | null;
}) => {
  return {
    queryKey: ["GET_STUDENT_REPORT", assessmentId, attemptId, instituteId],
    queryFn: () => viewStudentReport(assessmentId, attemptId, instituteId),
    staleTime: 60 * 60 * 1000,
  };
};

const AssessmentReportList = ({
  assessment_types,
}: {
  assessment_types: "HOMEWORK" | "ASSESSMENT";
}) => {
  const { t } = useTranslation("assessment");
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pageNo, setPageNo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 10;
  const observer = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement | null>(null);
  const [instituteDetails, setInstituteDetails] = useState<any>(null);
  // Evaluated copy is rendered in an in-app PDF viewer dialog. Opening the S3
  // signed URL directly with window.open fails in the native app (the URL has
  // no .pdf extension, so the webview/OS can't render it) — hence the dialog.
  const [evaluatedPreview, setEvaluatedPreview] =
    useState<EvaluatedPreview | null>(null);
  const [loadingEvaluatedFor, setLoadingEvaluatedFor] = useState<string | null>(
    null
  );
  const { setNavHeading } = useNavHeadingStore();

  useEffect(() => {
    setNavHeading(t("reportList.navHeading"));
  }, []);

  useEffect(() => {
    const fetchInstituteDetails = async () => {
      const response = await Preferences.get({ key: "InstituteDetails" });
      console.log("response InstituteDetails", response);
      setInstituteDetails(response?.value ? JSON.parse(response.value) : null);
    };

    fetchInstituteDetails();
  }, []);
  // One report per attempt: the AI report once it exists, otherwise the normal report.
  const [openingReportFor, setOpeningReportFor] = useState<string | null>(null);
  const handleViewReport = async (report: Report) => {
    setOpeningReportFor(report.attempt_id);
    try {
      await openStudentReport(navigate as never, {
        assessmentId: report.assessment_id,
        assessmentName: report.assessment_name,
        attemptId: report.attempt_id,
        evaluationType: report.evaluation_type,
        state: { report },
      });
    } finally {
      setOpeningReportFor(null);
    }
  };

  // Open the evaluated copy for a manual report. Rendered in the shared in-app
  // viewer rather than window.open — the signed S3 URL carries no file
  // extension, so the native webview can't open it on its own. The copy may be
  // a PDF or an image (the admin uploads PDF/JPEG/PNG), so we resolve its real
  // name + type and render/download it in that actual format.
  const handleViewEvaluated = async (report: Report) => {
    if (loadingEvaluatedFor) return;
    try {
      setLoadingEvaluatedFor(report.attempt_id);
      const res = await authenticatedAxiosInstance.get(STUDENT_REPORT_DETAIL_URL, {
        params: {
          assessmentId: report.assessment_id,
          attemptId: report.attempt_id,
          instituteId: instituteDetails?.id,
        },
      });
      const fileId = res.data?.evaluated_file_id;
      if (!fileId) {
        toast.error(t("reportList.toast.evaluatedNotAvailable"));
        return;
      }
      const detail = await getFileDetail(fileId);
      if (detail?.url) {
        setEvaluatedPreview({
          url: detail.url,
          fileName:
            detail.fileName ||
            t("reportList.evaluatedFileName", {
              name: report.assessment_name || t("reportList.fallback.assessmentName"),
            }),
          fileType: detail.fileType,
          title: `${report.assessment_name || t("reportList.fallback.evaluatedCopy")}`,
        });
      } else {
        toast.error(t("reportList.toast.evaluatedOpenFailed"));
      }
    } catch {
      toast.error(t("reportList.toast.evaluatedOpenFailed"));
    } finally {
      setLoadingEvaluatedFor(null);
    }
  };

  const isManualReport = (report: Report) =>
    (report.evaluation_type || "").toUpperCase() === "MANUAL";

  const fetchReports = async () => {
    if (loading || !hasMore) return;

    try {
      setLoading(true);
      setError(null);

      // Get details from Preferences
      const StudentDetails = await Preferences.get({ key: "StudentDetails" });
      const InstituteDetails = await Preferences.get({
        key: "InstituteDetails",
      });

      // Parse the JSON strings from Preferences
      const studentData = JSON.parse(StudentDetails.value || "{}");
      const instituteData = JSON.parse(InstituteDetails.value || "{}");

      const response = await authenticatedAxiosInstance.post(
        STUDENT_REPORT_URL,
        {
          name: "",
          status: ["ENDED"],
          // Include PENDING so submitted-but-not-yet-evaluated attempts also show
          // (as "Pending evaluation"). Marks/report stay gated until RELEASED.
          release_result_status: ["RELEASED", "PENDING"],
          assessment_type: [assessment_types],
          sort_columns: {},
        },
        {
          params: {
            studentId: studentData.user_id,
            instituteId: instituteData.id,
            pageNo,
            pageSize,
          },
        }
      );

      const newReports = (response.data.content as Report[]).filter(
        isReportableAttempt
      );
      setReports((prev) =>
        pageNo === 0 ? newReports : [...prev, ...newReports]
      );

      const isLastPage = response.data.last;
      setHasMore(!isLastPage);

      // Infinite scroll advances when the LAST RENDERED row scrolls into view.
      // A page that filters down to nothing (all surveys) renders no new row, so
      // the observer would never fire again and the remaining pages would be
      // unreachable. Pull the next page ourselves instead.
      if (newReports.length === 0 && !isLastPage) {
        setPageNo((prev) => prev + 1);
      }
    } catch (err) {
      console.error("Error fetching reports:", err);
      setError(t("reportList.error.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  // Setup intersection observer for infinite scrolling
  const lastReportElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (loading) return;

      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore) {
            setPageNo((prevPageNo) => prevPageNo + 1);
          }
        },
        { threshold: 0.5 }
      );

      if (node) observer.current.observe(node);
    },
    [loading, hasMore]
  );

  // Load initial data
  useEffect(() => {
    fetchReports();
  }, [pageNo]);

  // Cleanup observer on component unmount
  useEffect(() => {
    return () => {
      if (observer.current) {
        observer.current.disconnect();
      }
    };
  }, []);

  // Legacy rows (no status field) are treated as released to preserve old behavior.
  const isReportReleased = (report: Report) =>
    report.report_release_status !== "PENDING";

  if (error && reports.length === 0) {
    return (
      <div className="p-4 md:p-6 lg:p-8">
        <ErrorState
          title={t("reportList.error.loadTitle")}
          message={error}
          onRetry={() => fetchReports()}
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 p-4 md:p-6 lg:p-8">
      {reports.map((report: Report, index: number) => {
        const released = isReportReleased(report);
        // The list API's `total_marks` is the attempt's achieved score
        // (student_attempt.total_marks) — lead with it instead of burying it.
        // Gated until the result is released (manual attempts await evaluation).
        const score =
          released && report.total_marks != null
            ? Math.round(report.total_marks * 10) / 10
            : null;
        const metaParts = [
          formatDateTime(report.attempt_date),
          getSubjectNameById(
            instituteDetails?.subjects || [],
            report?.subject_id
          ),
          report.duration_in_seconds
            ? formatDuration(report.duration_in_seconds)
            : "",
        ].filter(Boolean);

        return (
          <div
            key={report.attempt_id}
            ref={index === reports.length - 1 ? lastReportElementRef : null}
          >
            <Card className="w-full transition-shadow hover:shadow-sm [.ui-play_&]:rounded-2xl">
              <CardContent className="flex flex-col gap-4 p-card sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                {/* Score first: the figure the learner came for */}
                <div className="flex w-fit shrink-0 items-baseline gap-1.5 rounded-lg bg-primary-50 px-4 py-2 sm:w-24 sm:flex-col sm:items-center sm:gap-0 sm:py-3 [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:bg-play-gold-soft [.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300">
                  <span className="text-h2 font-bold tabular-nums text-primary-500 [.ui-play_&]:font-black [.ui-play_&]:text-play-ink">
                    {score != null ? score : "-"}
                  </span>
                  <span className="text-3xs font-medium uppercase tracking-wide text-muted-foreground [.ui-play_&]:text-play-ink/70">
                    {t("reportList.meta.marksLabel")}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-body font-semibold text-foreground">
                      {report.assessment_name}
                    </h3>
                    {report.evaluation_type && (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-700">
                        {report.evaluation_type === "MANUAL"
                          ? t("reportList.status.manual")
                          : t("reportList.status.auto")}
                      </span>
                    )}
                    <span
                      className={
                        released
                          ? "inline-flex items-center rounded-full border border-green-200 bg-green-100 px-2 py-0.5 text-2xs font-medium text-green-700"
                          : "inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-2xs font-medium text-amber-700"
                      }
                    >
                      {released
                        ? t("reportList.status.released")
                        : t("reportList.status.pendingEvaluation")}
                    </span>
                    {assessment_types !== "HOMEWORK" && (
                      <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                        {PLAY_MODE_KEYS[report.play_mode]
                          ? t(PLAY_MODE_KEYS[report.play_mode])
                          : report.play_mode}
                      </span>
                    )}
                  </div>
                  {metaParts.length > 0 && (
                    <p className="mt-1 text-caption text-muted-foreground">
                      {metaParts.join(" · ")}
                    </p>
                  )}
                </div>

                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <MyButton
                    className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                    onClick={() => handleViewReport(report)}
                    disable={!released || openingReportFor === report.attempt_id}
                  >
                    {openingReportFor === report.attempt_id
                      ? t("reportList.button.opening")
                      : t("reportList.button.viewReport")}
                  </MyButton>
                  {isManualReport(report) && (
                    <MyButton
                      buttonType="secondary"
                      className="min-h-11 w-full sm:min-h-9 sm:w-auto"
                      onClick={() => handleViewEvaluated(report)}
                      disable={!released || !!loadingEvaluatedFor}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Eye className="size-4" />
                        {loadingEvaluatedFor === report.attempt_id
                          ? t("reportList.button.opening")
                          : t("reportList.button.viewEvaluated")}
                      </span>
                    </MyButton>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        );
      })}

      {loading && (
        <div ref={loadingRef}>
          <LoadingState variant="list" count={3} />
        </div>
      )}

      {!hasMore && reports.length > 0 && (
        <p className="text-center text-caption text-muted-foreground py-4">
          {t("reportList.meta.noMore")}
        </p>
      )}

      {reports.length === 0 && !loading && (
        <EmptyState
          icon={FileText}
          title={t("reportList.empty.title")}
          description={t("reportList.empty.description")}
          action={{
            label:
              assessment_types === "HOMEWORK"
                ? t("reportList.empty.actionHomework")
                : t("reportList.empty.actionAssessment"),
            onClick: () =>
              navigate({
                to:
                  assessment_types === "HOMEWORK"
                    ? "/homework/list"
                    : "/assessment/examination",
              }),
          }}
        />
      )}

      {/* In-app evaluated-copy preview — renders the file in its actual format
          (PDF or image) with a real-name download. */}
      <EvaluatedReportDialog
        open={!!evaluatedPreview}
        onOpenChange={(open) => {
          if (!open) setEvaluatedPreview(null);
        }}
        fileUrl={evaluatedPreview?.url ?? null}
        fileName={evaluatedPreview?.fileName}
        fileType={evaluatedPreview?.fileType}
        title={evaluatedPreview?.title || t("reportList.fallback.evaluatedCopy")}
      />
    </div>
  );
};

export default AssessmentReportList;
