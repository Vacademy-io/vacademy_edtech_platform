import { getUserId } from "@/constants/getUserId";
import {
  GET_AI_PROCESSED_LOGS,
  LEARNER_REPORT_COMPARISON_URL,
  PROCESS_AI_REPORT_ON_DEMAND,
} from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { Preferences } from "@capacitor/preferences";
import { createFileRoute } from "@tanstack/react-router";
import { AxiosResponse } from "axios";
import { useEffect, useState } from "react";
import z from "zod";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import AIReportDetailsPage from "@/components/common/my-reports/ai-report-details-page";
import { LayoutContainer } from "@/components/common/layout-container/layout-container";
import { addHours } from "date-fns";
import { formatTime } from "@/lib/format-date";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComparisonDashboard } from "@/components/common/student-test-records/comparison-dashboard";

const aiReportParamsSchema = z.object({
  assessmentId: z.string(),
  assessmentName: z.string(),
  attemptId: z.string().optional(),
});

export const Route = createFileRoute("/assessment/reports/ai-report/")({
  validateSearch: aiReportParamsSchema,
  component: RouteComponent,
});

interface AIReportData {
  id: string;
  user_id: string;
  slide_id: null;
  source_id: string;
  source_type: string;
  status: string;
  processed_json: string;
  created_at: string;
  updated_at: string;
}

interface ParsedProcessedJSON {
  performance_analysis: string;
  areas_of_improvement: string;
  improvement_path: string;
  flashcards: { front: string; back: string }[];
  weaknesses: Record<string, number>;
  strengths: Record<string, number>;
  // New AI sections (optional — backward compatible)
  confidence_estimation?: {
    overall_confidence: number;
    high_confidence_correct: number;
    high_confidence_wrong: number;
    low_confidence_correct: number;
    guessed_correct: number;
    insight: string;
  };
  topic_analysis?: {
    topic: string;
    questions_count: number;
    correct: number;
    accuracy: number;
    avg_time_seconds: number;
    mastery_level: string;
  }[];
  misconception_analysis?: {
    question_summary: string;
    student_answer: string;
    correct_answer: string;
    misconception: string;
    remediation: string;
  }[];
  blooms_taxonomy?: Record<string, { total: number; correct: number }>;
  behavioral_insights?: {
    time_management?: string;
    difficulty_response?: string;
    fatigue_indicator?: string;
    skip_pattern?: string;
  };
  recommended_learning_path?: {
    priority: number;
    topic: string;
    current_level: string;
    target_level: string;
    suggestion: string;
    estimated_time: string;
  }[];
}

function RouteComponent() {
  const { t } = useTranslation("assessment");
  const { assessmentId, assessmentName, attemptId } = Route.useSearch();
  const [parsedProcessedJSON, setParsedProcessedJSON] =
    useState<ParsedProcessedJSON | null>(null);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [instituteId, setInstituteId] = useState<string>("");
  // The AI report is the one report per attempt: its second tab is the full normal
  // report (question by question, marks, class comparison), so nothing is lost.
  const [tab, setTab] = useState<"ai" | "questions">("ai");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    async function loadAIReport() {
      setLoading(true);
      try {
        const userId = await getUserId();
        if (!userId) {
          setLoading(false);
          return;
        }

        // 1. Try the already-processed report first.
        let json = await fetchProcessedReport(userId, assessmentId);

        // 2. Not generated yet → trigger on-demand processing instead of asking the
        //    learner to wait for the hourly scheduler.
        if (!json) {
          setLoading(false);
          setGenerating(true);
          json = await triggerOnDemandReport(userId, assessmentId);
          setGenerating(false);
        }

        setParsedProcessedJSON(json);

        // Fetch comparison data (rank, leaderboard, you vs class)
        if (attemptId) {
          try {
            const stored = await Preferences.get({ key: "InstituteDetails" });
            const instId = JSON.parse(stored.value || "{}").id || "";
            setInstituteId(instId);
            const compRes = await authenticatedAxiosInstance({
              method: "GET",
              url: LEARNER_REPORT_COMPARISON_URL,
              params: { assessmentId, attemptId, instituteId: instId },
            });
            if (compRes.status === 200) setComparisonData(compRes.data);
          } catch (e) {
            console.warn("Failed to fetch comparison data for AI report:", e);
          }
        }
      } catch (error) {
        console.error("Error fetching student report:", error);
      } finally {
        setLoading(false);
        setGenerating(false);
      }
    }

    loadAIReport();
  }, [assessmentId]);

  // GET the already-processed AI report. Returns null when none exists yet.
  async function fetchProcessedReport(
    userId: string,
    sourceId: string
  ): Promise<ParsedProcessedJSON | null> {
    const response: AxiosResponse<{
      activity_logs: AIReportData[];
      count: number;
    }> = await authenticatedAxiosInstance({
      method: "GET",
      url: GET_AI_PROCESSED_LOGS,
      params: { userId, sourceId },
    });
    if (response.status !== 200) return null;
    return parseProcessedJSON(response.data.activity_logs[0]?.processed_json || "");
  }

  // POST to synchronously generate the report for this assessment. The backend runs
  // the LLM and returns the processed result in the same response.
  async function triggerOnDemandReport(
    userId: string,
    sourceId: string
  ): Promise<ParsedProcessedJSON | null> {
    try {
      const response: AxiosResponse<{
        activity_logs: AIReportData[];
        count: number;
      }> = await authenticatedAxiosInstance({
        method: "POST",
        url: PROCESS_AI_REPORT_ON_DEMAND,
        params: { userId, sourceId },
      });
      return parseProcessedJSON(
        response.data?.activity_logs?.[0]?.processed_json || ""
      );
    } catch (e) {
      console.warn("On-demand AI report generation failed:", e);
      // The server may have finished after a gateway timeout — re-fetch once.
      try {
        return await fetchProcessedReport(userId, sourceId);
      } catch {
        return null;
      }
    }
  }

  const parseProcessedJSON = (jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString);
      return parsed as ParsedProcessedJSON;
    } catch (error) {
      console.error("Error parsing processed JSON:", error);
      return null;
    }
  };

  return (
    <>
      <LayoutContainer>
        {loading ? (
          <div className="flex items-center justify-center min-h-screen">
            <DashboardLoader />
          </div>
        ) : generating ? (
          <div className="flex items-center justify-center min-h-screen w-full">
            <div className="text-center flex flex-col items-center gap-stack">
              <DashboardLoader />
              <h2 className="text-xl font-semibold text-gray-900">
                {t("aiReport.generating.title")}
              </h2>
              <p className="text-gray-600">
                {t("aiReport.generating.description")}
              </p>
            </div>
          </div>
        ) : !parsedProcessedJSON ? (
          <div className="flex items-center justify-center min-h-screen w-full">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">
                {t("aiReport.unavailable.title")}
              </h2>
              <p className="text-gray-600 flex items-center flex-col gap-2">
                {t("aiReport.unavailable.description")}
                <span className="text-black">
                  {t("aiReport.unavailable.checkBack", {
                    time: formatTime(addHours(new Date(), 1)),
                  })}
                </span>
              </p>
            </div>
          </div>
        ) : comparisonData && attemptId && instituteId ? (
          <div className="flex flex-col gap-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "ai" | "questions")}>
              <TabsList className="w-full justify-start sm:w-auto">
                <TabsTrigger value="ai">{t("aiReport.tabs.analysis")}</TabsTrigger>
                <TabsTrigger value="questions">{t("aiReport.tabs.questions")}</TabsTrigger>
              </TabsList>
            </Tabs>
            {tab === "ai" ? (
              <AIReportDetailsPage
                report={parsedProcessedJSON}
                assessmentId={assessmentId as string}
                assessmentName={assessmentName as string}
                attemptId={attemptId as string}
                comparisonData={comparisonData}
              />
            ) : (
              <ComparisonDashboard
                data={comparisonData}
                assessmentName={assessmentName as string}
                assessmentId={assessmentId as string}
                attemptId={attemptId as string}
                instituteId={instituteId}
              />
            )}
          </div>
        ) : (
          <AIReportDetailsPage
            report={parsedProcessedJSON}
            assessmentId={assessmentId as string}
            assessmentName={assessmentName as string}
            attemptId={attemptId as string}
            comparisonData={comparisonData}
          />
        )}
      </LayoutContainer>
    </>
  );
}
