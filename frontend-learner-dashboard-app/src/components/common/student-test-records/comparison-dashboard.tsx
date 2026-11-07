import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PdfDownloadButton } from "./pdf-download-button";
import { EvaluatedReportDialog } from "./evaluated-report-dialog";
import { AnnotatedCopyDialog } from "./annotated-copy-dialog";
import { MarksDistributionChart } from "./marks-distribution-chart";
import {
  SectionComparisonTable,
  type SectionResponseCounts,
} from "./section-comparison-table";
import { PerformanceBand } from "./performance-band";
import { MarksStatusIndicator } from "./marks-chip";
import { formatDuration } from "@/constants/helper";
import { parseHtmlToString } from "@/lib/utils";
import { useState, useCallback, useEffect, useMemo } from "react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { getFileDetail } from "@/services/upload_file";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  STUDENT_REPORT_DETAIL_URL,
  GET_QUESTIONS_OF_SECTIONS,
  GET_ASSESSMENT_DETAILS,
  LEARNER_OPTION_DISTRIBUTION_URL,
  EXPORT_ASSESSMENT_REPORT,
} from "@/constants/urls";
import {
  renderStudentResponse,
  renderCorrectAnswer,
  type SectionQuestions,
} from "./question-response-renderer";
import {
  ChartBar,
  Clock,
  ListChecks,
  DotsThreeVertical,
  DownloadSimple,
  Eye,
  FileArrowDown,
  Sparkle,
} from "@phosphor-icons/react";
import { formatDateTime, formatTime } from "@/lib/format-date";
import { EmptyState } from "@/components/design-system/states";
import { cn } from "@/lib/utils";
import { playIllustrations } from "@/assets/play-illustrations";

// Verdict thresholds mirror getPerformanceLevel in test-report-dialog.tsx.
// Play-mode variants restate the verdict in play status tokens
// (success / warn / danger) on top of the default semantic chips.
function getVerdict(pct: number, t: TFunction): {
  label: string;
  className: string;
} {
  if (pct >= 90)
    return {
      label: t("common.excellent"),
      className:
        "border-success-200 bg-success-50 text-success-700 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-success-soft [.ui-play_&]:font-black [.ui-play_&]:text-play-success-soft-ink",
    };
  if (pct >= 60)
    return {
      label: t("common.good"),
      className:
        "border-success-200 bg-success-50 text-success-700 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-success-soft [.ui-play_&]:font-black [.ui-play_&]:text-play-success-soft-ink",
    };
  if (pct >= 50)
    return {
      label: t("common.average"),
      className:
        "border-warning-200 bg-warning-50 text-warning-700 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-warn [.ui-play_&]:font-black [.ui-play_&]:text-play-ink",
    };
  return {
    label: t("common.low"),
    className:
      "border-danger-200 bg-danger-50 text-danger-700 [.ui-play_&]:border-transparent [.ui-play_&]:bg-play-danger [.ui-play_&]:font-black [.ui-play_&]:text-white",
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Correct option ids for objective questions, parsed from the review DTO's
// correct_options JSON (shape: { data: { correctOptionIds: [...] } }).
function parseCorrectOptionIds(review: any): string[] {
  try {
    const correct =
      typeof review?.correct_options === "string"
        ? JSON.parse(review.correct_options)
        : review?.correct_options;
    const ids = correct?.data?.correctOptionIds;
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

// Share of the batch that picked the right answer. Only meaningful for
// single-answer objective questions — for MCQM the per-option distribution
// can't tell us who got the full combination right.
function classCorrectPct(
  review: any,
  distribution: Record<string, Record<string, number>> | null
): number | null {
  if (!distribution || !review?.question_id) return null;
  if (!["MCQS", "TRUE_FALSE"].includes(review.question_type)) return null;
  const qDist = distribution[review.question_id];
  if (!qDist) return null;
  const ids = parseCorrectOptionIds(review);
  if (ids.length !== 1) return null;
  const pct = qDist[ids[0]];
  if (pct == null) return null;
  return Math.min(Math.round(pct), 100);
}

interface ComparisonDashboardProps {
  data: any;
  assessmentName: string;
  assessmentId: string;
  attemptId: string;
  instituteId: string;
  evaluationType?: string;
}

export function ComparisonDashboard({
  data,
  assessmentName,
  assessmentId,
  attemptId,
  instituteId,
  evaluationType,
}: ComparisonDashboardProps) {
  const { t } = useTranslation("testRecords");
  // Manual assessments have no per-question learner responses, so the answer
  // review is meaningless there — hide it entirely.
  //
  // `evaluationType` comes from router navigation state, which is lost on a
  // reload / deep-link — so we can't rely on it alone to decide manual-ness.
  // We additionally derive it from the report detail below (presence of an
  // evaluated copy or a learner submission), then use `effectiveIsManual`
  // everywhere so the report-options menu (View evaluated / View submitted)
  // always shows for manual attempts.
  const isManualFromState = (evaluationType || "").toUpperCase() === "MANUAL";

  // For manual assessments, surface the evaluated copy + the learner's own
  // submission via a report-options menu (in place of the plain Download PDF).
  const [reportFiles, setReportFiles] = useState<{
    evaluated?: string | null;
    submitted?: string | null;
    // A report uploaded by the institute (offline data entry), as opposed to
    // the one the platform generates on download.
    report?: string | null;
    remark?: string | null;
  }>({});
  const [downloadingReport, setDownloadingReport] = useState(false);
  // True once the report detail confirms this is a manual attempt (has an
  // evaluated copy and/or a learner submission).
  const [isManualFromDetail, setIsManualFromDetail] = useState(false);
  // The mount-time report detail, kept for section-wise response tallies
  // (correct / incorrect / not answered) — independent of the lazily loaded
  // answer review below.
  const [detailForStats, setDetailForStats] = useState<any>(null);

  const isManual = isManualFromState || isManualFromDetail;

  // In-app viewer (evaluated / submitted) with the teacher's remark. Renders the
  // file in its actual format (PDF or image), so we track its real name + type.
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerRemark, setViewerRemark] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("");
  const [viewerFileName, setViewerFileName] = useState<string | undefined>(
    undefined
  );
  const [viewerFileType, setViewerFileType] = useState<string | undefined>(
    undefined
  );
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);

  // Always fetch the report detail — we can't trust the router-state
  // evaluationType (lost on reload/deep-link) to decide whether to load the
  // evaluated copy + submission. If either file is present it's a manual
  // attempt, which flips `isManualFromDetail` and surfaces the options menu.
  useEffect(() => {
    if (!assessmentId || !attemptId || !instituteId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authenticatedAxiosInstance.get(STUDENT_REPORT_DETAIL_URL, {
          params: { assessmentId, attemptId, instituteId },
        });
        if (cancelled) return;
        setDetailForStats(res.data);
        // The teacher's remark rides on the question's evaluator_feedback.
        const allSections = res.data?.all_sections || {};
        let remark: string | null = null;
        for (const questions of Object.values(allSections)) {
          const found = Array.isArray(questions)
            ? (questions as any[]).find((q) => q?.evaluator_feedback)
            : null;
          if (found?.evaluator_feedback) {
            remark = found.evaluator_feedback;
            break;
          }
        }
        const evaluated = res.data?.evaluated_file_id;
        const submitted = res.data?.response_file_id;
        const report = res.data?.report_file_id;
        setReportFiles({ evaluated, submitted, report, remark });
        // An uploaded report alone is enough to warrant the options menu —
        // otherwise a hand-marked attempt with only a report would fall back to
        // the plain download and the uploaded file would be unreachable here.
        setIsManualFromDetail(!!evaluated || !!submitted || !!report);
      } catch {
        // Best-effort; the menu items just stay disabled if this fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId, attemptId, instituteId]);

  const openInAppViewer = async (
    fileId: string | null | undefined,
    opts: { remark?: string | null; title: string; fallbackName: string }
  ) => {
    if (!fileId || openingFileId) {
      if (!fileId) toast.error(t("comparisonDashboard.errors.fileNotAvailable"));
      return;
    }
    try {
      setOpeningFileId(fileId);
      // Resolve the real name + MIME type so the file renders/downloads in its
      // actual format (the admin may upload a PDF or an image).
      const detail = await getFileDetail(fileId);
      if (!detail?.url) {
        toast.error(t("comparisonDashboard.errors.openFileFailed"));
        return;
      }
      setViewerUrl(detail.url);
      setViewerFileName(detail.fileName || opts.fallbackName);
      setViewerFileType(detail.fileType);
      setViewerRemark(opts.remark ?? null);
      setViewerTitle(opts.title);
      setViewerOpen(true);
    } catch {
      toast.error(t("comparisonDashboard.errors.openFileFailed"));
    } finally {
      setOpeningFileId(null);
    }
  };

  const handleDownloadReport = async () => {
    try {
      setDownloadingReport(true);
      const response = await authenticatedAxiosInstance({
        method: "GET",
        url: EXPORT_ASSESSMENT_REPORT,
        params: { assessmentId, attemptId, instituteId },
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${assessmentName || "assessment"}-report.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t("comparisonDashboard.errors.downloadReportFailed"));
    } finally {
      setDownloadingReport(false);
    }
  };
  const [annotatedOpen, setAnnotatedOpen] = useState(false);
  const [answerReviewOpen, setAnswerReviewOpen] = useState(false);
  const [answerReviewLoading, setAnswerReviewLoading] = useState(false);
  const [reportDetail, setReportDetail] = useState<any>(null);
  const [questionsData, setQuestionsData] = useState<SectionQuestions | null>(null);
  const [sectionsInfo, setSectionsInfo] = useState<{ id: string; name: string }[]>([]);
  const [selectedSection, setSelectedSection] = useState<string | undefined>(undefined);
  const [optionDistribution, setOptionDistribution] = useState<Record<string, Record<string, number>> | null>(null);

  const loadAnswerReview = useCallback(async () => {
    if (reportDetail) {
      setAnswerReviewOpen(true);
      return;
    }

    setAnswerReviewLoading(true);
    try {
      // Fetch report detail, assessment details, and option distribution in parallel
      const [detailRes, assessmentRes, optDistRes] = await Promise.all([
        authenticatedAxiosInstance.get(STUDENT_REPORT_DETAIL_URL, {
          params: { assessmentId, attemptId, instituteId },
        }),
        authenticatedAxiosInstance.get(GET_ASSESSMENT_DETAILS, {
          params: { assessmentId, instituteId, type: "EXAM" },
        }),
        authenticatedAxiosInstance.get(LEARNER_OPTION_DISTRIBUTION_URL, {
          params: { assessmentId, attemptId, instituteId },
        }).catch(() => ({ data: null })),
      ]);

      const detail = detailRes.data;
      setReportDetail(detail);
      setOptionDistribution(optDistRes.data);

      // Extract section info from assessment details
      const sections = assessmentRes.data?.[1]?.saved_data?.sections?.map(
        (s: any) => ({ id: s.id, name: s.name })
      ) || [];
      setSectionsInfo(sections);

      // Set first section as selected
      const allSections = detail?.all_sections;
      const sectionIds = allSections ? Object.keys(allSections) : [];
      if (sectionIds.length > 0) {
        setSelectedSection(sections.length > 0 ? sections[0].id : sectionIds[0]);

        // Fetch questions data for rendering options
        const qRes = await authenticatedAxiosInstance.get(GET_QUESTIONS_OF_SECTIONS, {
          params: { assessmentId, sectionIds: sectionIds.join(",") },
        });
        setQuestionsData(qRes.data);
      }

      setAnswerReviewOpen(true);
    } catch (err) {
      console.error("Error loading answer review:", err);
    } finally {
      setAnswerReviewLoading(false);
    }
  }, [reportDetail, assessmentId, attemptId, instituteId]);

  // Section-wise correct / incorrect / not-answered tallies for the section
  // table, mirroring the printed report. Derived from the mount-time detail;
  // manual attempts (no per-question statuses) simply produce nothing.
  const sectionResponseCounts = useMemo<
    Record<string, SectionResponseCounts> | null
  >(() => {
    const allSections = detailForStats?.all_sections;
    if (!allSections || typeof allSections !== "object") return null;
    const counts: Record<string, SectionResponseCounts> = {};
    let sawStatus = false;
    for (const [sectionId, questions] of Object.entries(allSections)) {
      if (!Array.isArray(questions) || questions.length === 0) continue;
      const tally: SectionResponseCounts = {
        correct: 0,
        incorrect: 0,
        unanswered: 0,
      };
      for (const q of questions as any[]) {
        const status = q?.answer_status;
        if (status === "CORRECT") tally.correct += 1;
        else if (status === "INCORRECT" || status === "PARTIAL_CORRECT")
          tally.incorrect += 1;
        else tally.unanswered += 1;
        if (status && status !== "DEFAULT") sawStatus = true;
      }
      counts[sectionId] = tally;
    }
    return sawStatus ? counts : null;
  }, [detailForStats]);

  // "Easy misses" (questions most of the class solved but you didn't) and
  // "your expertise" (questions few solved but you did) — the two headline
  // insights from the printed report, computed from the option distribution.
  const reviewInsights = useMemo(() => {
    const allSections = reportDetail?.all_sections;
    if (!allSections || !optionDistribution) return null;
    const sectionName = (id: string) =>
      sectionsInfo.find((s) => s.id === id)?.name || "";
    const easyMisses: {
      key: string;
      label: string;
      section: string;
      text: string;
      pct: number;
    }[] = [];
    const expertise: typeof easyMisses = [];
    for (const [sectionId, questions] of Object.entries(allSections)) {
      if (!Array.isArray(questions)) continue;
      (questions as any[]).forEach((q, idx) => {
        const pct = classCorrectPct(q, optionDistribution);
        if (pct == null) return;
        const item = {
          key: q.question_id || `${sectionId}-${idx}`,
          label: `Q${q.question_order ?? idx + 1}`,
          section: sectionName(sectionId),
          text: parseHtmlToString(q.question_name || q.question_text || ""),
          pct,
        };
        if (q.answer_status !== "CORRECT" && pct >= 50) easyMisses.push(item);
        if (q.answer_status === "CORRECT" && pct <= 35) expertise.push(item);
      });
    }
    easyMisses.sort((a, b) => b.pct - a.pct);
    expertise.sort((a, b) => a.pct - b.pct);
    return { easyMisses, expertise };
  }, [reportDetail, optionDistribution, sectionsInfo]);

  if (!data) {
    return (
      <EmptyState
        icon={ChartBar}
        title={t("comparisonDashboard.empty.title")}
        description={t("comparisonDashboard.empty.description")}
      />
    );
  }

  const {
    student_rank,
    student_percentile,
    student_marks,
    total_marks,
    total_participants,
    average_marks,
    highest_marks,
    lowest_marks,
    average_duration,
    student_duration,
    student_accuracy,
    class_accuracy,
    marks_distribution,
    section_wise_comparison,
    leaderboard,
    start_time,
    submit_time,
  } = data;

  const allSections = reportDetail?.all_sections;
  const currentSectionQuestions = selectedSection && allSections
    ? allSections[selectedSection]
    : undefined;

  const achieved = student_marks != null ? round1(student_marks) : null;
  const maxMarks =
    total_marks != null && total_marks > 0 ? round1(total_marks) : null;
  const scorePct =
    achieved != null && maxMarks != null
      ? Math.round((achieved / maxMarks) * 100)
      : null;
  const verdict = scorePct != null ? getVerdict(scorePct, t) : null;
  // "Pass" mirrors the success-tier verdicts (Good / Excellent) above.
  const isPassVerdict = scorePct != null && scorePct >= 60;

  // One quiet metadata line under the report title.
  const metaParts = [
    start_time
      ? t("comparisonDashboard.masthead.attempted", { date: formatDateTime(start_time) })
      : "",
    submit_time
      ? t("comparisonDashboard.masthead.submitted", { time: formatTime(submit_time) })
      : "",
  ].filter(Boolean);

  // Narrative summary, like the printed report's "Summary of your
  // performance" — best and weakest section vs the class average, plus pace.
  const sectionDeltas = ((section_wise_comparison || []) as any[])
    .filter((s) => s.student_marks != null && s.section_average_marks != null)
    .map((s) => ({
      name: s.section_name,
      delta: (s.student_marks || 0) - (s.section_average_marks || 0),
    }));
  const bestSection =
    sectionDeltas.length > 1
      ? sectionDeltas.reduce((a, b) => (b.delta > a.delta ? b : a))
      : null;
  const weakSection =
    sectionDeltas.length > 1
      ? sectionDeltas.reduce((a, b) => (b.delta < a.delta ? b : a))
      : null;
  const summaryItems: { lead: string; text: string }[] = [];
  if (bestSection && bestSection.delta > 0) {
    summaryItems.push({
      lead: t("comparisonDashboard.summary.strengthsLead"),
      text: t("comparisonDashboard.summary.strengthsText", {
        section: bestSection.name,
        delta: round1(bestSection.delta),
      }),
    });
  }
  if (weakSection && weakSection.delta < 0) {
    summaryItems.push({
      lead: t("comparisonDashboard.summary.weaknessLead"),
      text: t("comparisonDashboard.summary.weaknessText", {
        section: weakSection.name,
        delta: round1(Math.abs(weakSection.delta)),
      }),
    });
  }
  if (
    student_duration != null &&
    student_duration > 0 &&
    average_duration != null &&
    average_duration > 0
  ) {
    const faster = student_duration < average_duration;
    summaryItems.push({
      lead: t("comparisonDashboard.summary.paceLead"),
      text: faster
        ? t("comparisonDashboard.summary.paceTextAhead", {
            duration: formatDuration(student_duration),
            avgDuration: formatDuration(Math.round(average_duration)),
          })
        : t("comparisonDashboard.summary.paceTextBehind", {
            duration: formatDuration(student_duration),
            avgDuration: formatDuration(Math.round(average_duration)),
          }),
    });
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6 lg:p-8">
      {/* Masthead — report title block, ruled like the printed report */}
      <header className="flex flex-col justify-between gap-4 border-b-2 border-border pb-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <p className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("comparisonDashboard.masthead.reportType")}
          </p>
          <h1 className="mt-1 text-h3 font-semibold text-foreground sm:text-h2">
            {assessmentName}
          </h1>
          {metaParts.length > 0 && (
            <p className="mt-1 text-caption text-muted-foreground">
              {metaParts.join(" · ")}
            </p>
          )}
        </div>
        {isManual ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t("comparisonDashboard.reportOptionsAriaLabel")}>
                <DotsThreeVertical className="h-5 w-5" weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={handleDownloadReport}
                disabled={downloadingReport}
              >
                <DownloadSimple className="me-2 h-4 w-4" />
                {downloadingReport ? t("common.downloadingEllipsis") : t("comparisonDashboard.menu.downloadReport")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  openInAppViewer(reportFiles.evaluated, {
                    remark: reportFiles.remark,
                    title: t("evaluatedReportDialog.defaultTitle"),
                    fallbackName: `${assessmentName || "assessment"} - evaluated`,
                  })
                }
                disabled={
                  !reportFiles.evaluated ||
                  openingFileId === reportFiles.evaluated
                }
              >
                <Eye className="me-2 h-4 w-4" />
                {t("comparisonDashboard.menu.viewEvaluated")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  openInAppViewer(reportFiles.submitted, {
                    title: t("comparisonDashboard.menu.yourSubmission"),
                    fallbackName: `${assessmentName || "assessment"} - submission`,
                  })
                }
                disabled={
                  !reportFiles.submitted ||
                  openingFileId === reportFiles.submitted
                }
              >
                <FileArrowDown className="me-2 h-4 w-4" />
                {t("comparisonDashboard.menu.viewSubmitted")}
              </DropdownMenuItem>
              {/* Only when the institute uploaded one — "Download report"
                  above already covers the generated report. */}
              {reportFiles.report && (
                <DropdownMenuItem
                  onClick={() =>
                    openInAppViewer(reportFiles.report, {
                      title: t("common.resultReport"),
                      fallbackName: `${assessmentName || "assessment"} - report`,
                    })
                  }
                  disabled={openingFileId === reportFiles.report}
                >
                  <Eye className="me-2 h-4 w-4" />
                  {t("comparisonDashboard.menu.viewResultReport")}
                </DropdownMenuItem>
              )}
              {reportFiles.submitted && (
                <DropdownMenuItem onClick={() => setAnnotatedOpen(true)}>
                  <Sparkle className="me-2 h-4 w-4" />
                  {t("comparisonDashboard.menu.viewAnnotatedCopy")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <PdfDownloadButton
            assessmentId={assessmentId}
            attemptId={attemptId}
            instituteId={instituteId}
            assessmentName={assessmentName}
          />
        )}
      </header>

      {/* Score hero + headline stats — one ruled band, like the printed
          report's stat boxes. Play mode keeps its gold celebration band;
          vibrant keeps the primary wash. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card
          className={cn(
            "col-span-2 rounded-md border-t-2 border-t-primary-400 shadow-none md:col-span-1",
            "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border [.ui-play_&]:border-border [.ui-play_&]:bg-play-gold-soft",
            "[.ui-vibrant_&]:bg-primary-50"
          )}
        >
          <CardContent className="flex h-full flex-col justify-between gap-2 p-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground [.ui-play_&]:text-play-ink/70">
                {t("comparisonDashboard.stats.yourScore")}
              </span>
              {isPassVerdict && (
                <playIllustrations.Winners
                  className="pointer-events-none hidden h-10 w-auto text-play-accent [.ui-play_&]:!block"
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-h1 font-bold tabular-nums text-foreground [.ui-play_&]:font-black [.ui-play_&]:text-play-ink">
                {achieved != null ? achieved : "-"}
              </span>
              {maxMarks != null && (
                <span className="text-body tabular-nums text-muted-foreground [.ui-play_&]:text-play-ink/60">
                  / {maxMarks}
                </span>
              )}
              {scorePct != null && (
                <span className="text-caption font-semibold tabular-nums text-muted-foreground [.ui-play_&]:font-black [.ui-play_&]:text-play-ink/80">
                  {scorePct}%
                </span>
              )}
            </div>
            {verdict && (
              <span
                className={cn(
                  "inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-3xs font-semibold uppercase tracking-wide",
                  verdict.className
                )}
              >
                {verdict.label}
              </span>
            )}
          </CardContent>
        </Card>
        <StatTile
          label={t("comparisonDashboard.stats.classRank")}
          value={student_rank ? `#${student_rank}` : "-"}
          detail={
            total_participants
              ? t("comparisonDashboard.stats.of", { count: total_participants })
              : undefined
          }
        />
        <StatTile
          label={t("common.percentile")}
          value={
            student_percentile != null ? `${round1(student_percentile)}` : "-"
          }
        />
        <StatTile
          label={t("common.accuracy")}
          value={
            student_accuracy != null ? `${Math.round(student_accuracy)}%` : "-"
          }
          detail={
            class_accuracy != null
              ? t("comparisonDashboard.stats.classAccuracy", { pct: Math.round(class_accuracy) })
              : undefined
          }
        />
        <StatTile
          label={t("common.timeTaken")}
          value={
            student_duration != null && student_duration > 0
              ? formatDuration(student_duration)
              : "-"
          }
          detail={
            average_duration != null && average_duration > 0
              ? t("comparisonDashboard.stats.classDuration", {
                  duration: formatDuration(Math.round(average_duration)),
                })
              : undefined
          }
        />
      </div>

      {/* Where you stand — overall score band */}
      {maxMarks != null && achieved != null && (
        <ReportSection
          title={t("comparisonDashboard.sections.whereYouStand", { maxMarks })}
          aside={
            total_participants ? (
              <span className="text-3xs uppercase tracking-wide text-muted-foreground">
                {t("common.studentsCount", { count: total_participants })}
              </span>
            ) : undefined
          }
        >
          <PerformanceBand
            studentMarks={student_marks}
            averageMarks={average_marks}
            highestMarks={highest_marks}
            lowestMarks={lowest_marks}
            totalMarks={total_marks}
          />
        </ReportSection>
      )}

      {/* Narrative summary */}
      {summaryItems.length > 0 && (
        <ReportSection title={t("comparisonDashboard.sections.summaryTitle")}>
          <ul className="space-y-2">
            {summaryItems.map((item) => (
              <li key={item.lead} className="flex gap-2 text-body text-foreground">
                <span
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-primary-400"
                  aria-hidden="true"
                />
                <span>
                  <span className="font-semibold">{item.lead}</span>{" "}
                  <span className="text-neutral-600">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      {/* You vs class average */}
      <ReportSection title={t("comparisonDashboard.sections.vsClassAverage")}>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-3">
          <ComparisonBar
            label={t("common.marks")}
            yourValue={student_marks}
            avgValue={average_marks}
            maxValue={total_marks || highest_marks || 100}
            yourLabel={t("comparisonDashboard.compare.you", { value: round1(student_marks || 0) })}
            avgLabel={t("comparisonDashboard.compare.avg", { value: round1(average_marks || 0) })}
          />
          {student_accuracy != null && (
            <ComparisonBar
              label={t("common.accuracy")}
              yourValue={student_accuracy}
              avgValue={class_accuracy || 0}
              maxValue={100}
              yourLabel={t("comparisonDashboard.compare.you", { value: `${Math.round(student_accuracy)}%` })}
              avgLabel={t("comparisonDashboard.compare.avg", {
                value: `${class_accuracy != null ? Math.round(class_accuracy) : "-"}%`,
              })}
            />
          )}
          {student_duration != null && student_duration > 0 && (
            <ComparisonBar
              label={t("common.timeTaken")}
              yourValue={student_duration}
              avgValue={average_duration}
              maxValue={
                Math.max(student_duration || 0, average_duration || 0) * 1.2
              }
              yourLabel={t("comparisonDashboard.compare.you", { value: formatDuration(student_duration) })}
              avgLabel={t("comparisonDashboard.compare.avg", {
                value: average_duration ? formatDuration(Math.round(average_duration)) : "-",
              })}
            />
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-caption text-muted-foreground">
          <span>
            {t("comparisonDashboard.stats.highest")}{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {highest_marks != null ? round1(highest_marks) : "-"}
            </span>
          </span>
          <span>
            {t("comparisonDashboard.stats.lowest")}{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {lowest_marks != null ? round1(lowest_marks) : "-"}
            </span>
          </span>
          <span>
            {t("comparisonDashboard.stats.participants")}{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {total_participants || "-"}
            </span>
          </span>
        </div>
      </ReportSection>

      {/* Section-Wise Performance */}
      {section_wise_comparison && section_wise_comparison.length > 0 && (
        <ReportSection title={t("comparisonDashboard.sections.sectionWisePerformance")}>
          <SectionComparisonTable
            sections={section_wise_comparison}
            responseCounts={sectionResponseCounts}
          />
        </ReportSection>
      )}

      {/* Marks Distribution */}
      {marks_distribution && marks_distribution.length > 0 && (
        <ReportSection title={t("comparisonDashboard.sections.marksDistribution")}>
          <MarksDistributionChart
            distribution={marks_distribution}
            studentMarks={student_marks}
            totalParticipants={total_participants}
          />
        </ReportSection>
      )}

      {/* Smart Leaderboard */}
      {leaderboard && (
        <ReportSection
          title={t("comparisonDashboard.sections.leaderboardPosition")}
          aside={
            leaderboard.student_rank != null ? (
              <span className="text-3xs uppercase tracking-wide text-muted-foreground">
                {t("comparisonDashboard.leaderboard.rankOf", {
                  rank: leaderboard.student_rank,
                  total: leaderboard.total_participants,
                })}
              </span>
            ) : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="px-3 py-2 text-start text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("comparisonDashboard.leaderboard.rank")}
                  </th>
                  <th className="px-3 py-2 text-start text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("comparisonDashboard.leaderboard.student")}
                  </th>
                  <th className="px-3 py-2 text-end text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("common.marks")}
                  </th>
                  <th className="px-3 py-2 text-end text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("comparisonDashboard.leaderboard.time")}
                  </th>
                  <th className="px-3 py-2 text-end text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("common.percentile")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.top_ranks?.map((entry: any) => (
                  <LeaderboardRow
                    key={entry.attempt_id}
                    entry={entry}
                    isCurrentStudent={entry.rank === leaderboard.student_rank}
                  />
                ))}
                {leaderboard.has_gap && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-1 text-center tracking-widest text-muted-foreground"
                    >
                      · · ·
                    </td>
                  </tr>
                )}
                {leaderboard.surrounding_ranks?.map((entry: any) => (
                  <LeaderboardRow
                    key={entry.attempt_id}
                    entry={entry}
                    isCurrentStudent={entry.rank === leaderboard.student_rank}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </ReportSection>
      )}

      {/* Answer Review — lazy loaded. Shown for MANUAL attempts too so learners
          see their per-question marks, AI/teacher feedback and criteria. */}
      {/* The institute can hide every per-question item for an assessment (report option). */}
      {data?.question_wise_hidden ? null : !answerReviewOpen ? (
        <ReportSection title={t("comparisonDashboard.sections.reviewAndPractice")}>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-body text-muted-foreground">
              {t("comparisonDashboard.review.everyQuestionDesc")}
            </p>
            <Button
              onClick={loadAnswerReview}
              disabled={answerReviewLoading}
              className="whitespace-nowrap"
            >
              {answerReviewLoading ? t("common.loadingEllipsis") : t("comparisonDashboard.review.viewAnswerReview")}
            </Button>
          </div>
        </ReportSection>
      ) : (
        <>
          {/* Headline insights from the class-wide answer data */}
          {reviewInsights &&
            (reviewInsights.easyMisses.length > 0 ||
              reviewInsights.expertise.length > 0) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReportSection
                  title={
                    reviewInsights.easyMisses.length > 0
                      ? t("comparisonDashboard.sections.easyMissesCount", { count: reviewInsights.easyMisses.length })
                      : t("comparisonDashboard.sections.easyMissesNone")
                  }
                  className="border-t-2 border-t-danger-400"
                >
                  {reviewInsights.easyMisses.length > 0 ? (
                    <InsightList
                      items={reviewInsights.easyMisses}
                      pctSuffix={t("comparisonDashboard.review.pctOfClassCorrect")}
                    />
                  ) : (
                    <p className="text-body text-muted-foreground">
                      {t("comparisonDashboard.review.noEasyMisses")}
                    </p>
                  )}
                </ReportSection>
                <ReportSection
                  title={
                    reviewInsights.expertise.length > 0
                      ? t("comparisonDashboard.sections.expertiseCount", { count: reviewInsights.expertise.length })
                      : t("comparisonDashboard.sections.expertiseNone")
                  }
                  className="border-t-2 border-t-success-400"
                >
                  {reviewInsights.expertise.length > 0 ? (
                    <InsightList
                      items={reviewInsights.expertise}
                      pctSuffix={t("comparisonDashboard.review.pctOfClassCorrect")}
                    />
                  ) : (
                    <p className="text-body text-muted-foreground">
                      {t("comparisonDashboard.review.noExpertise")}
                    </p>
                  )}
                </ReportSection>
              </div>
            )}

          {/* Section Tabs */}
          {sectionsInfo.length > 0 && (
            <Tabs
              value={selectedSection}
              onValueChange={setSelectedSection}
              className="w-full"
            >
              <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
                <TabsList className="h-auto w-full justify-start overflow-x-auto bg-transparent p-0">
                  {sectionsInfo.map((section) => (
                    <TabsTrigger
                      key={section.id}
                      value={section.id}
                      className="relative rounded-none border-b-2 px-6 py-3 text-caption font-semibold uppercase tracking-wide transition-all
                        data-[state=active]:border-primary-500 data-[state=active]:text-foreground
                        data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground
                        hover:bg-muted/50 hover:text-foreground"
                    >
                      <span>{section.name}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
            </Tabs>
          )}

          {/* Questions */}
          <ReportSection
            title={t("comparisonDashboard.sections.answerReview")}
            aside={
              <span className="text-3xs uppercase tracking-wide text-muted-foreground">
                {currentSectionQuestions?.length
                  ? t("comparisonDashboard.review.questionsCount", { count: currentSectionQuestions.length })
                  : undefined}
              </span>
            }
          >
            <div className="space-y-5">
              {currentSectionQuestions && currentSectionQuestions.length > 0 ? (
                currentSectionQuestions.map((review: any, index: number) => {
                  const classPct = classCorrectPct(review, optionDistribution);
                  const correctOptionIds = parseCorrectOptionIds(review);
                  return (
                    <div
                      key={index}
                      className="overflow-hidden rounded-md border border-border"
                    >
                      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                        <span className="inline-flex items-center rounded-sm bg-foreground px-2 py-0.5 text-caption font-semibold tabular-nums text-background">
                          Q{review.question_order ?? index + 1}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-3xs font-medium uppercase tracking-wide text-muted-foreground"
                        >
                          {review.question_type}
                        </Badge>
                        <MarksStatusIndicator
                          mark={review.mark}
                          answer_status={
                            review.answer_status as
                              | "CORRECT"
                              | "INCORRECT"
                              | "PARTIAL_CORRECT"
                              | "DEFAULT"
                          }
                        />
                        <span className="ms-auto inline-flex items-center gap-3 text-caption text-muted-foreground">
                          {classPct != null && (
                            <span className="tabular-nums">
                              {t("comparisonDashboard.review.classPctCorrect", { pct: classPct })}
                            </span>
                          )}
                          {review.time_taken_in_seconds != null &&
                            review.time_taken_in_seconds > 0 && (
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <Clock size={14} weight="duotone" />
                                {review.time_taken_in_seconds}s
                              </span>
                            )}
                        </span>
                      </div>

                      <div className="space-y-5 p-4 sm:p-5">
                        <div className="text-body leading-relaxed text-foreground">
                          {parseHtmlToString(review.question_name)}
                        </div>

                        {/* Student Response */}
                        <div className="space-y-1.5">
                          <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                            {t("comparisonDashboard.review.yourResponse")}
                          </span>
                          <Alert
                            className={cn(
                              "border-s-4",
                              review.answer_status === "CORRECT"
                                ? "border-success-200 border-s-success-500 bg-success-50"
                                : review.answer_status === "INCORRECT"
                                  ? "border-danger-200 border-s-danger-500 bg-danger-50"
                                  : review.answer_status === "PARTIAL_CORRECT"
                                    ? "border-warning-200 border-s-warning-500 bg-warning-50"
                                    : "border-border border-s-neutral-400 bg-muted/40"
                            )}
                          >
                            <AlertDescription className="text-body text-foreground">
                              {review.student_response_options
                                ? renderStudentResponse(review, questionsData, t)
                                : review.mark !== 0
                                  ? t("comparisonDashboard.review.marksAwardedDirectly", {
                                      value: `${review.mark > 0 ? "+" : ""}${review.mark}`,
                                    })
                                  : t("comparisonDashboard.review.notAttempted")}
                            </AlertDescription>
                          </Alert>
                        </div>

                        {/* Correct Answer */}
                        {review.answer_status !== "CORRECT" &&
                          review.correct_options && (
                            <div className="space-y-1.5">
                              <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                                {t("comparisonDashboard.review.correctAnswer")}
                              </span>
                              <Alert className="border-success-200 border-s-4 border-s-success-500 bg-success-50">
                                <AlertDescription className="text-body text-foreground">
                                  {renderCorrectAnswer(review, questionsData, t)}
                                </AlertDescription>
                              </Alert>
                            </div>
                          )}

                        {/* Feedback + grading breakdown (AI evaluation / teacher remark) */}
                        {(review.evaluator_feedback ||
                          review.ai_feedback ||
                          review.ai_criteria_breakdown) && (
                          <div className="space-y-3 border-t border-border/60 pt-4">
                            <div className="flex items-center gap-2">
                              <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                                {t("comparisonDashboard.review.feedback")}
                              </span>
                              {(review.evaluation_source === "AI" ||
                                review.evaluation_source === "AI_REVIEWED") && (
                                <Badge
                                  variant="secondary"
                                  className="gap-1 text-3xs"
                                >
                                  <Sparkle size={12} weight="fill" />
                                  {review.evaluation_source === "AI_REVIEWED"
                                    ? t("comparisonDashboard.review.aiAssistedReviewed")
                                    : t("comparisonDashboard.review.aiAssisted")}
                                </Badge>
                              )}
                            </div>
                            {(review.evaluator_feedback || review.ai_feedback) && (
                              <Alert className="border-info-200 border-s-4 border-s-info-500 bg-info-50">
                                <AlertDescription className="whitespace-pre-line text-body text-foreground">
                                  {review.evaluator_feedback || review.ai_feedback}
                                </AlertDescription>
                              </Alert>
                            )}
                            {(() => {
                              let criteria: any[] = [];
                              try {
                                criteria = review.ai_criteria_breakdown
                                  ? JSON.parse(review.ai_criteria_breakdown)
                                  : [];
                              } catch {
                                criteria = [];
                              }
                              if (!Array.isArray(criteria) || criteria.length === 0)
                                return null;
                              return (
                                <div className="overflow-hidden rounded-md border border-border">
                                  <table className="w-full text-body">
                                    <thead className="bg-muted/40">
                                      <tr>
                                        <th className="p-2 text-start text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                                          {t("comparisonDashboard.review.criteria")}
                                        </th>
                                        <th className="p-2 text-start text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                                          {t("comparisonDashboard.review.reason")}
                                        </th>
                                        <th className="p-2 text-end text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                                          {t("common.marks")}
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                      {criteria.map((c: any, i: number) => (
                                        <tr key={i}>
                                          <td className="p-2 font-medium text-foreground">
                                            {c.criteria_name}
                                          </td>
                                          <td className="p-2 text-neutral-600">
                                            {c.reason}
                                          </td>
                                          <td className="p-2 text-end font-semibold tabular-nums text-foreground">
                                            {typeof c.marks === "number"
                                              ? c.marks.toFixed(1)
                                              : c.marks}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Option Distribution */}
                        {optionDistribution &&
                          review.question_id &&
                          optionDistribution[review.question_id] &&
                          ["MCQS", "MCQM", "TRUE_FALSE"].includes(
                            review.question_type
                          ) && (
                            <div className="space-y-2 border-t border-border/60 pt-4">
                              <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                                {t("comparisonDashboard.review.howClassAnswered")}
                              </span>
                              <div className="space-y-2">
                                {(() => {
                                  const dist =
                                    optionDistribution[review.question_id];
                                  // Find all options for this question from questionsData
                                  const questionOptions = questionsData
                                    ? Object.values(questionsData).flatMap((sq) =>
                                        sq
                                          .filter(
                                            (q) =>
                                              q.question_id === review.question_id
                                          )
                                          .flatMap(
                                            (q) =>
                                              q.options_with_explanation ||
                                              q.options ||
                                              []
                                          )
                                      )
                                    : [];

                                  return questionOptions.map((opt: any) => {
                                    const pct = dist[opt.id] || 0;
                                    const isCorrect = correctOptionIds.includes(
                                      opt.id
                                    );
                                    return (
                                      <div className="space-y-0.5" key={opt.id}>
                                        <div className="flex justify-between gap-2 text-caption">
                                          <span
                                            className={cn(
                                              "truncate",
                                              isCorrect
                                                ? "font-medium text-success-700"
                                                : "text-neutral-600"
                                            )}
                                          >
                                            {parseHtmlToString(
                                              opt.text?.content || opt.id
                                            )}
                                          </span>
                                          <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
                                            {pct}%
                                          </span>
                                        </div>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                          <div
                                            className={cn(
                                              "h-full rounded-full",
                                              isCorrect
                                                ? "bg-success-400"
                                                : "bg-neutral-300"
                                            )}
                                            /* Dynamic chart geometry — live class data. */
                                            style={{
                                              width: `${Math.min(pct, 100)}%`,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          )}

                        {/* Explanation */}
                        {review.explanation && (
                          <div className="space-y-1.5 border-t border-border/60 pt-4">
                            <span className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                              {t("common.explanation")}
                            </span>
                            <div className="rounded-md bg-muted/40 p-4 text-body leading-relaxed text-neutral-600">
                              {parseHtmlToString(review.explanation)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  compact
                  icon={ListChecks}
                  title={t("comparisonDashboard.empty.noQuestionsTitle")}
                  description={t("comparisonDashboard.empty.noQuestionsDescription")}
                />
              )}
            </div>
          </ReportSection>
        </>
      )}

      <EvaluatedReportDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        fileUrl={viewerUrl}
        fileName={viewerFileName}
        fileType={viewerFileType}
        remark={viewerRemark}
        title={viewerTitle}
      />

      <AnnotatedCopyDialog
        open={annotatedOpen}
        onOpenChange={setAnnotatedOpen}
        assessmentId={assessmentId}
        attemptId={attemptId}
        submittedFileId={reportFiles.submitted}
      />
    </div>
  );
}

// Ruled report section — uppercase letterspaced heading over a hairline, the
// visual grammar of the printed report.
function ReportSection({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border bg-card p-4 sm:p-5", className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3 border-b border-border pb-2.5">
        <h2 className="text-caption font-semibold uppercase tracking-widest text-neutral-600">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-t-2 border-t-primary-300 bg-card px-4 py-3">
      <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-title font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {detail && (
        <div className="mt-0.5 text-3xs text-muted-foreground">{detail}</div>
      )}
    </div>
  );
}

function ComparisonBar({
  label,
  yourValue,
  avgValue,
  maxValue,
  yourLabel,
  avgLabel,
}: {
  label: string;
  yourValue: number;
  avgValue: number;
  maxValue: number;
  yourLabel: string;
  avgLabel: string;
}) {
  const { t } = useTranslation("testRecords");
  const yourPct = maxValue > 0 ? Math.min((yourValue / maxValue) * 100, 100) : 0;
  const avgPct = maxValue > 0 ? Math.min((avgValue / maxValue) * 100, 100) : 0;

  return (
    <div>
      <div className="mb-1.5 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        {/* Your score fill */}
        <div
          className="absolute start-0 top-0 h-full rounded-full bg-primary-400"
          /* Dynamic chart geometry — live comparison data. */
          style={{ width: `${yourPct}%` }}
        />
        {/* Average marker slit */}
        <div
          className="absolute -top-1 h-4 w-0.5 rounded-sm bg-neutral-600"
          style={{ left: `${avgPct}%` }}
          title={t("common.classAverageValue", { value: avgLabel })}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-caption tabular-nums">
        <span className="font-semibold text-foreground">{yourLabel}</span>
        <span className="text-muted-foreground">{avgLabel}</span>
      </div>
    </div>
  );
}

// Compact list for the easy-misses / expertise insight cards.
function InsightList({
  items,
  pctSuffix,
}: {
  items: { key: string; label: string; section: string; text: string; pct: number }[];
  pctSuffix: string;
}) {
  const { t } = useTranslation("testRecords");
  const shown = items.slice(0, 5);
  return (
    <ul className="divide-y divide-border/60">
      {shown.map((item) => (
        <li key={item.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
          <span className="inline-flex shrink-0 items-center rounded-sm bg-muted px-1.5 py-0.5 text-3xs font-semibold tabular-nums text-neutral-600">
            {item.label}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body text-foreground">
              {item.text}
            </span>
            {item.section && (
              <span className="block text-3xs uppercase tracking-wide text-muted-foreground">
                {item.section}
              </span>
            )}
          </span>
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {item.pct}% <span className="hidden sm:inline">{pctSuffix}</span>
          </span>
        </li>
      ))}
      {items.length > shown.length && (
        <li className="py-2 text-caption text-muted-foreground">
          {t("comparisonDashboard.review.moreInAnswerReview", { count: items.length - shown.length })}
        </li>
      )}
    </ul>
  );
}

function LeaderboardRow({
  entry,
  isCurrentStudent,
}: {
  entry: any;
  isCurrentStudent: boolean;
}) {
  const { t } = useTranslation("testRecords");
  // Medal tint for the podium only; everyone else gets a quiet outline.
  const rankBadgeClass =
    entry.rank === 1
      ? "border-warning-200 bg-warning-100 text-warning-700"
      : entry.rank === 2
        ? "border-neutral-200 bg-neutral-100 text-neutral-600"
        : entry.rank === 3
          ? "border-warning-100 bg-warning-50 text-warning-600"
          : "border-transparent bg-transparent text-muted-foreground";

  return (
    <tr
      className={cn(
        "border-b border-border/60 last:border-b-0",
        isCurrentStudent && "bg-primary-50"
      )}
    >
      <td className="px-3 py-2">
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-full border text-caption font-semibold tabular-nums",
            rankBadgeClass
          )}
        >
          {entry.rank}
        </span>
      </td>
      <td
        className={cn(
          "px-3 py-2",
          isCurrentStudent ? "font-semibold text-foreground" : "text-foreground"
        )}
      >
        {entry.student_name}
        {isCurrentStudent && (
          <span className="ms-2 inline-flex items-center rounded-sm bg-primary-100 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-primary-500">
            {t("common.you")}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-end font-medium tabular-nums">
        {entry.achieved_marks != null ? round1(entry.achieved_marks) : "-"}
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
        {entry.completion_time_in_seconds
          ? formatDuration(entry.completion_time_in_seconds)
          : "-"}
      </td>
      <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
        {entry.percentile != null ? `${round1(entry.percentile)}%` : "-"}
      </td>
    </tr>
  );
}
