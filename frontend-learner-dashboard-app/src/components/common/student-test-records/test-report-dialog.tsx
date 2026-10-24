import { Export } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  convertToLocalDateTime,
  extractDateTime,
  formatDuration,
  getSubjectNameById,
} from "@/constants/helper";
import { AttemptPapersCard } from "./attempt-papers-card";
import { ResponseBreakdownComponent } from "./response-breakdown-component";
import { MarksBreakdownComponent } from "./marks-breakdown-component";
import { Crown } from "@/svgs";
import { useEffect, useState, useRef } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CaretLeft,
  Clock,
  CalendarBlank,
  Timer,
  TrendUp,
  CheckCircle,
  XCircle,
  MinusCircle,
} from "@phosphor-icons/react";
import { parseHtmlToString } from "@/lib/utils";
import { Preferences } from "@capacitor/preferences";
import { useRouter } from "@tanstack/react-router";
import type {
  ParsedHistoryState,
  Report,
  Section,
  TestReportDialogProps,
} from "@/types/assessments/assessment-data-type";
import {
  EXPORT_ASSESSMENT_REPORT,
  GET_ASSESSMENT_MARKS,
} from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { GET_QUESTIONS_OF_SECTIONS } from "@/constants/urls";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { MarksStatusIndicator } from "./marks-chip";
import { FileText } from "@phosphor-icons/react";
import type {
  DocumentLoadEvent,
  PageChangeEvent,
} from "@react-pdf-viewer/core";
import { PdfViewerComponent } from "../study-library/level-material/subject-material/module-material/chapter-material/slide-material/pdf-viewer-component";
import { getPublicUrl } from "@/services/upload_file";
import {
  renderStudentResponse,
  renderCorrectAnswer,
  SectionQuestions,
} from "./question-response-renderer";
import { getTerminology } from "../layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

type TestMarks = {
  total_achievable_marks: number;
  section_wise_achievable_marks: Record<string, number>;
};

// Function to fetch questions data
const fetchQuestionsData = async (
  assessmentId: string,
  sectionIds: string[]
) => {
  try {
    const response = await authenticatedAxiosInstance.get(
      GET_QUESTIONS_OF_SECTIONS,
      {
        params: {
          assessmentId,
          sectionIds: sectionIds.join(","),
        },
      }
    );
    return response.data as SectionQuestions;
  } catch (error) {
    console.error("Error fetching questions data:", error);
    return null;
  }
};

interface InstituteDetails {
  id: string;
  name: string;
  subjects: Array<{
    id: string;
    subject_name: string;
  }>;
}

export const TestReportDialog = ({
  testReport,
  examType,
  assessmentDetails,
  evaluationType,
}: TestReportDialogProps) => {
  const { t } = useTranslation("testRecords");
  const report = useRouter();
  const [instituteDetails, setInstituteDetails] =
    useState<InstituteDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [questionsData, setQuestionsData] = useState<SectionQuestions | null>(
    null
  );
  const { setNavHeading } = useNavHeadingStore();

  type PdfFileType = {
    fileId: string;
    fileName: string;
    fileUrl: string;
    size: number;
    file: File | null;
  };

  const [pdfFile, setPdfFile] = useState<PdfFileType | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfDocumentInfo, setPdfDocumentInfo] = useState({
    numPages: 0,
    currentPage: 0,
  });

  // Extract IDs from search params (passed from AssessmentCard)
  const searchParams = report.__store.state.location.search as { assessmentId?: string; attemptId?: string };
  const assessmentIdFromSearch = searchParams?.assessmentId;
  const attemptIdFromSearch = searchParams?.attemptId;

  const locationState = report.__store.state.location
    .state as unknown as ParsedHistoryState;
  const defaultReport: Report = {
    assessment_id: "",
    attempt_id: "",
    assessment_name: "",
    assessment_status: "",
    subject_id: "",
    start_time: "",
    end_time: "",
    total_marks: 0,
    duration_in_seconds: 0,
    sections: {},
    attempt_date: "",
    play_mode: "",
    evaluation_type: "",
  };

  // Construct Report object from testReport (AssessmentTestReport) and assessmentDetails
  // testReport has structure: { question_overall_detail_dto, all_sections }
  // We need to map this to Report structure
  const assessmentData = assessmentDetails?.[0] as any; // Cast to any to access properties

  // For Way 1 (AssessmentCard), get assessment info from state
  const assessmentInfoFromState = (locationState as any)?.assessmentInfo;

  const constructedReport: Report = testReport && assessmentData ? {
    assessment_id: assessmentIdFromSearch || assessmentData?.assessment_id || "",
    attempt_id: attemptIdFromSearch || (testReport as any)?.question_overall_detail_dto?.attemptId || "",
    // For Way 1, use name from AssessmentCard state; fallback to assessmentDetails
    assessment_name: assessmentInfoFromState?.name || assessmentData?.name || assessmentData?.assessment_name || "",
    assessment_status: "ENDED",
    subject_id: (testReport as any)?.question_overall_detail_dto?.subjectId || assessmentData?.subject_id || "",
    start_time: (testReport as any)?.question_overall_detail_dto?.startTime || "",
    end_time: (testReport as any)?.question_overall_detail_dto?.submitTime || "",
    total_marks: (testReport as any)?.question_overall_detail_dto?.achievedMarks || 0,
    duration_in_seconds: (testReport as any)?.question_overall_detail_dto?.completionTimeInSeconds || 0,
    sections: (testReport as any)?.all_sections || {},
    attempt_date: (testReport as any)?.question_overall_detail_dto?.startTime || "",
    play_mode: assessmentData?.play_mode || "",
    evaluation_type: evaluationType || assessmentData?.evaluation_type || "",
  } : defaultReport;

  // Smart priority logic:
  // - If locationState.report exists with valid data (Way 2), use it as base
  // - Otherwise, use constructedReport from API (Way 1)
  // - BUT ALWAYS override start_time and end_time with API data for accuracy
  const hasValidLocationReport = locationState?.report && locationState.report.assessment_id;
  const hasValidConstructedReport = testReport && constructedReport.assessment_id;

  let studentReport: Report = hasValidLocationReport
    ? (locationState.report as Report)
    : (hasValidConstructedReport ? constructedReport : defaultReport);

  // CRITICAL FIX: Always use API times regardless of navigation way
  // This ensures both Way 1 and Way 2 show correct times from the API
  if (testReport && (testReport as any)?.question_overall_detail_dto) {
    const apiStartTime = (testReport as any).question_overall_detail_dto.startTime;
    const apiEndTime = (testReport as any).question_overall_detail_dto.submitTime;

    if (apiStartTime) studentReport.start_time = apiStartTime;
    if (apiEndTime) studentReport.end_time = apiEndTime;
  }

  console.log("=== REPORT DATA DEBUG ===");
  console.log("Way 2 (locationState.report) exists:", hasValidLocationReport);
  console.log("Way 1 (constructedReport from API) exists:", hasValidConstructedReport);
  console.log("Using:", hasValidLocationReport ? "Way 2 (locationState.report)" : (hasValidConstructedReport ? "Way 1 (constructedReport)" : "defaultReport"));
  console.log("API Start Time:", (testReport as any)?.question_overall_detail_dto?.startTime);
  console.log("API End Time:", (testReport as any)?.question_overall_detail_dto?.submitTime);
  console.log("studentReport (final):", studentReport);
  console.log("Assessment name:", studentReport.assessment_name);
  console.log("Start time:", studentReport.start_time);
  console.log("End time:", studentReport.end_time);


  // Determine the actual IDs to use with priority: search params → studentReport → fallback to empty
  const actualAssessmentId = assessmentIdFromSearch || studentReport.assessment_id || "";
  const actualAttemptId = attemptIdFromSearch || studentReport.attempt_id || "";

  const [testMarks, setTestMarks] = useState<TestMarks | null>(null);

  // Refs to track if data has been fetched (prevents duplicate calls in Strict Mode)
  const hasFetchedMarks = useRef(false);
  const hasFetchedQuestions = useRef(false);

  useEffect(() => {
    const fetchTestMarks = async () => {
      if (!actualAssessmentId) {
        console.error("No assessment ID available for fetching marks");
        return;
      }

      // Prevent duplicate calls
      if (hasFetchedMarks.current) return;
      hasFetchedMarks.current = true;

      try {
        const response = await authenticatedAxiosInstance({
          method: "GET",
          url: GET_ASSESSMENT_MARKS,
          params: {
            assessmentId: actualAssessmentId,
          },
        });
        const data = response?.data;
        setTestMarks(data);
      } catch (error) {
        console.error("Error fetching test marks:", error);
        hasFetchedMarks.current = false; // Reset on error to allow retry
      }
    };

    fetchTestMarks();
  }, [actualAssessmentId]);

  // Reset guard when assessment ID changes
  useEffect(() => {
    hasFetchedQuestions.current = false;
  }, [actualAssessmentId]);

  useEffect(() => {
    const loadQuestionsData = async () => {
      // For Way 1: testReport has all_sections
      // For Way 2: testReport IS the Report object with sections property
      const sectionsData = (testReport as any)?.all_sections || (testReport as any)?.sections || studentReport?.sections;

      console.log("🔍 [Questions API] Checking if should fetch questions...");
      console.log("  - testReport:", testReport);
      console.log("  - testReport.all_sections:", (testReport as any)?.all_sections);
      console.log("  - testReport.sections:", (testReport as any)?.sections);
      console.log("  - studentReport:", studentReport);
      console.log("  - studentReport.sections:", studentReport?.sections);
      console.log("  - sectionsData:", sectionsData);
      console.log("  - sectionsData keys:", sectionsData ? Object.keys(sectionsData) : "null");
      console.log("  - actualAssessmentId:", actualAssessmentId);
      console.log("  - hasFetchedQuestions.current:", hasFetchedQuestions.current);

      if (sectionsData && actualAssessmentId) {
        const sectionIds = Object.keys(sectionsData);
        console.log("  - sectionIds:", sectionIds);
        console.log("  - sectionIds.length:", sectionIds.length);

        if (sectionIds.length > 0) {
          // Prevent duplicate calls
          if (hasFetchedQuestions.current) {
            console.log("⏭️ [Questions API] Already fetched, skipping...");
            return;
          }
          hasFetchedQuestions.current = true;

          console.log("📡 [Questions API] Fetching questions for sections:", sectionIds);
          console.log("📡 [Questions API] Assessment ID:", actualAssessmentId);

          const data = await fetchQuestionsData(
            actualAssessmentId,
            sectionIds
          );
          console.log("✅ [Questions API] Questions fetched successfully:", data);
          setQuestionsData(data);
        } else {
          console.log("⚠️ [Questions API] No section IDs found");
        }
      } else {
        console.log("⚠️ [Questions API] Missing required data");
        console.log("  - sectionsData exists:", !!sectionsData);
        console.log("  - actualAssessmentId exists:", !!actualAssessmentId);
      }
    };

    loadQuestionsData();
  }, [testReport, studentReport, actualAssessmentId]);

  const heading = (
    <div className="flex items-center gap-2">
      <CaretLeft
        onClick={() => window.history.back()}
        className="cursor-pointer size-5"
      />
      <div>{t("testReportDialog.navHeadingReport")}</div>
    </div>
  );

  useEffect(() => {
    setNavHeading(heading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    const fetchInstituteDetails = async () => {
      const response = await Preferences.get({ key: "InstituteDetails" });
      setInstituteDetails(response?.value ? JSON.parse(response.value) : null);
    };

    fetchInstituteDetails();
  }, []);

  const sectionsInfo = assessmentDetails[1]?.saved_data.sections?.map(
    (section: Section) => ({
      name: section.name,
      id: section.id,
    })
  );

  const handleExport = async () => {
    if (!instituteDetails) return;

    const assessmentId = studentReport.assessment_id;
    const attemptId = studentReport.attempt_id;
    const instituteId = instituteDetails.id;

    setIsLoading(true);

    try {
      // A report uploaded by the institute (offline data entry) is the
      // authoritative one for this attempt — the generated report can't reflect
      // how a hand-checked paper was actually marked. A lookup failure is
      // non-fatal: fall through to the generated report below.
      const uploadedReportId = testReport?.report_file_id;
      if (uploadedReportId) {
        try {
          const uploadedUrl = await getPublicUrl(uploadedReportId);
          if (uploadedUrl) {
            const uploadedLink = document.createElement("a");
            uploadedLink.href = uploadedUrl;
            uploadedLink.download = "assessment_report.pdf";
            uploadedLink.target = "_blank";
            document.body.appendChild(uploadedLink);
            uploadedLink.click();
            document.body.removeChild(uploadedLink);
            return;
          }
        } catch (error) {
          console.error("Error fetching the uploaded report:", error);
        }
      }

      const response = await authenticatedAxiosInstance({
        method: "GET",
        url: EXPORT_ASSESSMENT_REPORT,
        params: {
          assessmentId: assessmentId,
          attemptId: attemptId,
          instituteId: instituteId,
        },
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = window.URL.createObjectURL(blob);
      link.download = "assessment_report.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Error exporting data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const [selectedSection, setSelectedSection] = useState(
    sectionsInfo?.length ? sectionsInfo[0]?.id : undefined
  );
  const evaluation_type = evaluationType;
  const evaluated_file_id = testReport?.evaluated_file_id;
  // For Way 1: use testReport.all_sections, for Way 2: testReport.sections
  const sectionsData = (testReport as any)?.all_sections || (testReport as any)?.sections || studentReport?.sections;
  const currentSectionAllQuestions = selectedSection && sectionsData ? sectionsData[selectedSection] : undefined;

  useEffect(() => {
    if (evaluated_file_id) {
      const fetchAndSetFile = async () => {
        try {
          const publicUrl = await getPublicUrl(evaluated_file_id);
          setPdfFile({
            fileId: evaluated_file_id,
            fileName: t("testReportDialog.evaluatedFileName"),
            fileUrl: publicUrl,
            size: 0,
            file: null,
          });
        } catch (error) {
          console.error("Error fetching public URL:", error);
        }
      };

      fetchAndSetFile();
    }
  }, [evaluated_file_id]);

  const handleDocumentLoad = (e: DocumentLoadEvent) => {
    setPdfDocumentInfo((prev) => ({
      ...prev,
      numPages: e.doc.numPages,
    }));
  };

  const handlePageChange = (e: PageChangeEvent) => {
    setPdfDocumentInfo((prev) => ({
      ...prev,
      currentPage: e.currentPage,
    }));
  };

  const handlePreviewPdf = () => {
    if (pdfFile) {
      setShowPdfPreview(true);
    }
  };

  if (testReport === null || studentReport === null || examType === undefined) {
    return null;
  }

  // For Way 2 (direct navigation), question_overall_detail_dto might not exist
  // Calculate from sections data if needed
  const calculateStatsFromSections = (sections: any) => {
    let correct = 0, partialCorrect = 0, wrong = 0, skipped = 0;

    if (sections) {
      Object.values(sections).forEach((questions: any) => {
        if (Array.isArray(questions)) {
          questions.forEach((q: any) => {
            if (q.answer_status === 'CORRECT') correct++;
            else if (q.answer_status === 'PARTIAL_CORRECT') partialCorrect++;
            else if (q.answer_status === 'INCORRECT') wrong++;
            else skipped++;
          });
        }
      });
    }

    return { correct, partialCorrect, wrong, skipped };
  };

  // Use question_overall_detail_dto if available (Way 1), otherwise calculate from sections (Way 2)
  const stats = testReport?.question_overall_detail_dto
    ? {
      correct: testReport.question_overall_detail_dto.correctAttempt,
      partialCorrect: testReport.question_overall_detail_dto.partialCorrectAttempt,
      wrong: testReport.question_overall_detail_dto.wrongAttempt,
      skipped: testReport.question_overall_detail_dto.skippedCount,
    }
    : calculateStatsFromSections(sectionsData);

  const responseData = {
    attempted: stats.correct + stats.partialCorrect + stats.wrong,
    skipped: stats.skipped,
  };

  const marksData = {
    correct: stats.correct,
    partiallyCorrect: stats.partialCorrect,
    wrongResponse: stats.wrong,
    skipped: stats.skipped,
  };

  // Calculate percentage score
  const percentageScore = testMarks?.total_achievable_marks
    ? Math.round((studentReport.total_marks / testMarks.total_achievable_marks) * 100)
    : 0;

  // Get performance level
  const getPerformanceLevel = (percentage: number) => {
    if (percentage >= 90) return { label: t("common.excellent"), color: "bg-emerald-500" };
    if (percentage >= 75) return { label: t("testReportDialog.veryGood"), color: "bg-green-500" };
    if (percentage >= 60) return { label: t("common.good"), color: "bg-blue-500" };
    if (percentage >= 50) return { label: t("common.average"), color: "bg-amber-500" };
    return { label: t("testReportDialog.needsImprovement"), color: "bg-rose-500" };
  };

  const performanceLevel = getPerformanceLevel(percentageScore);

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
        {/* Premium Header Section */}
        <div className="bg-gradient-to-br from-slate-50 via-white to-info-50/30 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {/* Title and Export Button Row */}
            <div className="flex items-center justify-between mb-6">
              <div>
                {(() => {
                  const subjectName = getSubjectNameById(
                    instituteDetails?.subjects || [],
                    studentReport?.subject_id
                  );
                  const shouldShowSubject = subjectName &&
                    subjectName.trim() !== "" &&
                    subjectName.toUpperCase() !== "N/A";

                  return shouldShowSubject ? (
                    <div className="flex items-center gap-3 mb-2">
                      <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                        {t("testReportDialog.subjectLabel", {
                          subject: getTerminology(ContentTerms.Subjects, SystemTerms.Subjects),
                          name: subjectName,
                        })}
                      </Badge>
                    </div>
                  ) : null;
                })()}
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
                  {studentReport.assessment_name}
                </h1>
              </div>
              <MyButton
                buttonType="secondary"
                scale="large"
                layoutVariant="default"
                onClick={handleExport}
                disabled={isLoading}
              >
                <Export weight="duotone" />
                {isLoading ? <span className="ms-2">{t("testReportDialog.exporting")}</span> : <>{t("testReportDialog.exportReport")}</>}
              </MyButton>
            </div>

            {/* Metadata Cards - Full Width */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md transition-all duration-200 hover:border-blue-300">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <CalendarBlank size={20} weight="duotone" className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("testReportDialog.attemptDate")}</div>
                  <div className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                    {extractDateTime(convertToLocalDateTime(studentReport.start_time)).date}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md transition-all duration-200 hover:border-emerald-300">
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <Timer size={20} weight="duotone" className="text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("testReportDialog.duration")}</div>
                  <div className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                    {formatDuration(studentReport.duration_in_seconds)}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md transition-all duration-200 hover:border-amber-300">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <Clock size={20} weight="duotone" className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("testReportDialog.startTime")}</div>
                  <div className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                    {extractDateTime(convertToLocalDateTime(studentReport.start_time)).time}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl hover:shadow-md transition-all duration-200 hover:border-rose-300">
                <div className="p-2 bg-rose-50 rounded-lg">
                  <Clock size={20} weight="duotone" className="text-rose-600" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("testReportDialog.endTime")}</div>
                  <div className="text-sm md:text-base font-semibold text-slate-900 leading-tight">
                    {extractDateTime(convertToLocalDateTime(studentReport.end_time)).time}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6 md:space-y-8 pb-24 md:pb-8">
          {/* Papers attached to this attempt. Driven purely by which files
              exist — NOT by evaluation_type, because an offline/hand-checked
              paper can carry a checked copy on an otherwise objective
              assessment, and gating on the type hid it from the learner. */}
          <AttemptPapersCard
            papers={[
              {
                key: "submitted",
                label: t("testReportDialog.papers.answerSheetLabel"),
                description: t("testReportDialog.papers.answerSheetDescription"),
                fileId: testReport?.response_file_id,
              },
              {
                key: "checked",
                label: t("testReportDialog.papers.checkedCopyLabel"),
                description: t("testReportDialog.papers.checkedCopyDescription"),
                fileId: testReport?.evaluated_file_id,
              },
              {
                key: "report",
                label: t("common.resultReport"),
                description: t("testReportDialog.papers.resultReportDescription"),
                fileId: testReport?.report_file_id,
              },
            ]}
          />

          {/* Performance Summary Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Score Card */}
            <Card className="lg:col-span-1 border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader className="text-center pb-4">
                <CardDescription className="text-sm font-medium text-slate-600 uppercase tracking-wide">
                  {t("testReportDialog.yourScore")}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <div className="relative inline-flex items-center justify-center">
                  <div className="text-6xl font-bold text-slate-900">
                    {percentageScore}
                    <span className="text-3xl text-slate-500">%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Progress value={percentageScore} className="h-3" />
                  <div className="text-sm font-medium text-slate-600">
                    {t("testReportDialog.marksFraction", {
                      achieved: studentReport.total_marks,
                      total: testMarks?.total_achievable_marks ?? "-",
                    })}
                  </div>
                </div>
                <Badge className={`${performanceLevel.color} text-white border-none px-4 py-1`}>
                  {performanceLevel.label}
                </Badge>
              </CardContent>
            </Card>

            {/* Rank Card */}
            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader className="pb-4">
                <CardDescription className="text-sm font-medium text-slate-600 uppercase tracking-wide text-center">
                  {t("testReportDialog.classRank")}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center space-y-3">
                <div className="flex items-center justify-center gap-3">
                  {testReport.question_overall_detail_dto?.rank === 1 && (
                    <Crown />
                  )}
                  <div className="text-5xl font-bold text-slate-900">
                    {testReport.question_overall_detail_dto?.rank ?? t("testReportDialog.notAvailable")}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-2 text-slate-600">
                  <TrendUp size={20} weight="duotone" className="text-emerald-500" />
                  <span className="text-sm font-medium">
                    {t("testReportDialog.topPercentile", {
                      pct: testReport.question_overall_detail_dto?.percentile ?? 0,
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats Card */}
            <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader className="pb-4">
                <CardDescription className="text-sm font-medium text-slate-600 uppercase tracking-wide text-center">
                  {t("testReportDialog.quickStats")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={20} weight="fill" className="text-emerald-600" />
                    <span className="text-sm font-medium text-slate-700">{t("common.correct")}</span>
                  </div>
                  <span className="text-lg font-bold text-emerald-700">{marksData.correct}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-rose-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <XCircle size={20} weight="fill" className="text-rose-600" />
                    <span className="text-sm font-medium text-slate-700">{t("common.incorrect")}</span>
                  </div>
                  <span className="text-lg font-bold text-rose-700">{marksData.wrongResponse}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <MinusCircle size={20} weight="fill" className="text-slate-600" />
                    <span className="text-sm font-medium text-slate-700">{t("common.skipped")}</span>
                  </div>
                  <span className="text-lg font-bold text-slate-700">{marksData.skipped}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Analytics Section */}
          <Card className="border-slate-200 shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-slate-900">{t("testReportDialog.performanceAnalytics")}</CardTitle>
              <CardDescription>{t("testReportDialog.performanceAnalyticsDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-section md:gap-8">
                {/* Response Breakdown */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-slate-800">{t("testReportDialog.responseBreakdown")}</h3>
                  <div className="flex justify-center">
                    <ResponseBreakdownComponent responseData={responseData} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg">
                      <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                      <span className="text-sm text-slate-700">
                        {t("testReportDialog.attemptedCount", { count: responseData.attempted })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-2 bg-slate-100 rounded-lg">
                      <div className="w-3 h-3 rounded-full bg-slate-400"></div>
                      <span className="text-sm text-slate-700">
                        {t("testReportDialog.skippedCount", { count: responseData.skipped })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Marks Breakdown */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-slate-800">{t("testReportDialog.marksBreakdown")}</h3>
                  <div className="flex justify-center">
                    <MarksBreakdownComponent marksData={marksData} />
                  </div>
                  <div className="space-y-2 mt-4">
                    <div className="flex items-center justify-between p-2 bg-emerald-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <span className="text-sm text-slate-700">{t("common.correct")}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">
                        {t("testReportDialog.marksAwardedWithPlus", {
                          count: marksData.correct,
                          marks: testReport.question_overall_detail_dto?.totalCorrectMarks ?? 0,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-amber-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                        <span className="text-sm text-slate-700">{t("testReportDialog.partial")}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">
                        {t("testReportDialog.marksAwardedWithPlus", {
                          count: marksData.partiallyCorrect,
                          marks: testReport.question_overall_detail_dto?.totalPartialMarks ?? 0,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-rose-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                        <span className="text-sm text-slate-700">{t("common.incorrect")}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900">
                        {t("testReportDialog.marksAwardedPlain", {
                          count: marksData.wrongResponse,
                          marks: testReport.question_overall_detail_dto?.totalIncorrectMarks ?? 0,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Separator className="my-8" />

          {/* Section Tabs */}
          <Tabs
            value={selectedSection}
            onValueChange={setSelectedSection}
            className="w-full"
          >
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-slate-200 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <TabsList className="h-auto bg-transparent p-0 w-full justify-start overflow-x-auto">
                {sectionsInfo?.map((section) => (
                  <TabsTrigger
                    key={section.id}
                    value={section.id}
                    className={`
                      relative px-6 py-4 rounded-none border-b-2 transition-all
                      data-[state=active]:border-slate-900 data-[state=active]:text-slate-900 data-[state=active]:font-semibold
                      data-[state=inactive]:border-transparent data-[state=inactive]:text-slate-600
                      hover:text-slate-900 hover:bg-slate-50
                    `}
                  >
                    <span>{section.name}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>

          {/* Answer Review Section */}
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b border-slate-100">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="text-2xl font-bold text-slate-900">{t("testReportDialog.answerReview")}</CardTitle>
                  <CardDescription className="mt-1">{t("testReportDialog.answerReviewDesc")}</CardDescription>
                </div>
                <Badge variant="outline" className="text-sm font-medium border-slate-300">
                  {t("testReportDialog.sectionTotal", {
                    marks: testMarks?.section_wise_achievable_marks?.[selectedSection ?? "0"],
                  })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-card-lg space-y-6">
              {currentSectionAllQuestions && currentSectionAllQuestions.length > 0 ? (
                currentSectionAllQuestions.map((review: any, index: number) => (
                  <Card key={index} className="border-slate-200 hover:shadow-md transition-shadow">
                    <CardHeader className="bg-slate-50 border-b border-slate-100">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3">
                            <CardTitle className="text-lg font-semibold text-slate-900">
                              {t("testReportDialog.questionNumber", { number: index + 1 })}
                            </CardTitle>
                            <Badge variant="secondary" className="text-xs">
                              {review.question_type}
                            </Badge>
                          </div>
                          <div className="text-sm text-slate-700 leading-relaxed">
                            {parseHtmlToString(review.question_name)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-600 bg-white px-3 py-1.5 rounded-md border border-slate-200">
                          <Clock size={16} weight="duotone" className="text-slate-500" />
                          <span className="font-medium">{review.time_taken_in_seconds}s</span>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="p-card-lg space-y-5">
                      {/* Student Response */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-semibold text-slate-700">{t("common.yourResponse")}</span>
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
                        </div>
                        <Alert
                          className={`border-s-4 ${review.answer_status === "CORRECT"
                            ? "border-s-emerald-500 bg-emerald-50/50 border-emerald-200"
                            : review.answer_status === "INCORRECT"
                              ? "border-s-rose-500 bg-rose-50/50 border-rose-200"
                              : review.answer_status === "PARTIAL_CORRECT"
                                ? "border-s-amber-500 bg-amber-50/50 border-amber-200"
                                : "border-s-slate-500 bg-slate-50/50 border-slate-200"
                            }`}
                        >
                          <AlertDescription className="text-sm text-slate-700">
                            {renderStudentResponse(review, questionsData, t)}
                          </AlertDescription>
                        </Alert>
                      </div>

                      {/* Correct Answer */}
                      {review.answer_status !== "CORRECT" && (
                        <div className="space-y-2">
                          <span className="text-sm font-semibold text-slate-700">{t("testReportDialog.correctAnswerLabel")}</span>
                          <Alert className="border-s-4 border-s-emerald-500 bg-emerald-50/50 border-emerald-200">
                            <AlertDescription className="text-sm text-slate-700">
                              {renderCorrectAnswer(review, questionsData, t)}
                            </AlertDescription>
                          </Alert>
                        </div>
                      )}

                      {/* Explanation */}
                      {review.explanation && (
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <span className="text-sm font-semibold text-slate-700">{t("common.explanation")}</span>
                          <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-4 leading-relaxed">
                            {parseHtmlToString(review.explanation)}
                          </div>
                        </div>
                      )}

                      {/* Evaluator feedback — remark left by the teacher */}
                      {review.evaluator_feedback && (
                        <div className="space-y-2 pt-2 border-t border-neutral-100">
                          <span className="text-sm font-semibold text-primary-500">
                            {t("testReportDialog.evaluatorFeedback")}
                          </span>
                          <div className="whitespace-pre-line rounded-lg bg-primary-50 p-4 text-sm leading-relaxed text-neutral-700">
                            {review.evaluator_feedback}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-12 text-slate-500">
                  <p className="text-lg">{t("testReportDialog.noQuestionsAvailable")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mobile Export Button */}
        <div className="md:hidden fixed bottom-0 start-0 end-0 p-4 pb-safe bg-white border-t border-slate-200 shadow-lg z-40">
          <MyButton
            buttonType="secondary"
            scale="large"
            layoutVariant="default"
            onClick={!isLoading ? handleExport : undefined}
            className="w-full"
          >
            <Export />
            {isLoading ? <span className="ms-2">{t("testReportDialog.exporting")}</span> : <>{t("testReportDialog.exportReport")}</>}
          </MyButton>
        </div>

        {/* PDF Preview Modal */}
        {evaluation_type === "MANUAL" && pdfFile && (
          <div className="fixed bottom-4 end-4 z-50">
            <MyButton
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              onClick={handlePreviewPdf}
              className="shadow-lg"
            >
              <FileText className="h-4 w-4" />
              {t("testReportDialog.viewEvaluatedCopy")}
            </MyButton>
          </div>
        )}

        {showPdfPreview && pdfFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-lg w-full max-w-5xl h-screen-90 flex flex-col shadow-2xl">
              <div className="flex-1 overflow-auto">
                <PdfViewerComponent
                  pdfUrl={pdfFile.fileUrl}
                  handleDocumentLoad={handleDocumentLoad}
                  handlePageChange={handlePageChange}
                />
              </div>
              <div className="p-4 border-t border-slate-200 bg-slate-50">
                <MyButton
                  buttonType="secondary"
                  onClick={() => setShowPdfPreview(false)}
                >
                  {t("testReportDialog.close")}
                </MyButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
