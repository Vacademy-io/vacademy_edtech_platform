"use client";

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { EXPORT_AI_REPORT } from "@/constants/urls";
import { Preferences } from "@capacitor/preferences";
import {
  BehavioralInsightsCard, BloomsCard, ConfidenceCard, FlashcardsCard, LeaderboardCard, LearningPathCard,
  MarkdownCard, MisconceptionsCard, StrengthsWeaknessesCards, TopicAnalysisCard,
  type AiBehaviour, type AiBlooms, type AiConfidence, type AiLearningStep, type AiMisconception, type AiTopic,
} from "./ai-report-sections";

// ─── Types ───
interface AIReportData {
  performance_analysis: string;
  weaknesses: Record<string, number>;
  strengths: Record<string, number>;
  areas_of_improvement: string;
  improvement_path: string;
  flashcards: { front: string; back: string }[];
  confidence_estimation?: AiConfidence;
  topic_analysis?: AiTopic[];
  misconception_analysis?: AiMisconception[];
  blooms_taxonomy?: AiBlooms;
  behavioral_insights?: AiBehaviour;
  recommended_learning_path?: AiLearningStep[];
}

interface AIReportDetailsPageProps {
  report: AIReportData;
  /**
   * Present for assessment reports only. The PDF export is an assessment-service
   * endpoint keyed on it, so the download button is hidden without one — quiz,
   * question and assignment insights have no equivalent export.
   */
  assessmentId?: string;
  /** Heading for the report. For activity insights this is the slide title. */
  assessmentName: string;
  attemptId?: string;
  instituteId?: string;
  comparisonData?: any; // StudentComparisonDto from /comparison API
  /** Optional line under the heading, e.g. "Quiz · 12 Aug 2026". */
  subtitle?: string;
}

// ─── Main Component ───
export default function AIReportDetailsPage({
  report, assessmentId, assessmentName, attemptId, instituteId, comparisonData, subtitle,
}: AIReportDetailsPageProps) {
  const { t } = useTranslation("layoutCommonB");
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true); setDlError(false);
      let instId = instituteId;
      if (!instId) {
        const s = await Preferences.get({ key: "InstituteDetails" });
        instId = JSON.parse(s.value || "{}").id || "";
      }
      const res = await authenticatedAxiosInstance({
        method: "GET", url: EXPORT_AI_REPORT,
        params: { assessmentId, ...(attemptId ? { attemptId } : {}), instituteId: instId }, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url;
      a.download = `${assessmentName || "ai-report"}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch { setDlError(true); setTimeout(() => setDlError(false), 3000); }
    finally { setDownloading(false); }
  };

  const strengths = Object.entries(report.strengths || {}).filter(([, v]) => v > 0);
  const weaknesses = Object.entries(report.weaknesses || {}).filter(([, v]) => v > 0);

  return (
    <div className="w-full space-y-4 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-bold">{assessmentName}</h1>
          <p className="text-sm text-muted-foreground">
            {subtitle ?? t("aiReportDetails.defaultSubtitle")}
          </p>
        </div>
        {assessmentId && (
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}
            className={`gap-1.5 ${dlError ? "border-destructive text-destructive" : ""}`}>
            {downloading ? <SpinnerGap className="h-4 w-4 animate-spin" /> : <DownloadSimple className="h-4 w-4" />}
            {downloading ? t("aiReportDetails.generating") : dlError ? t("aiReportDetails.failed") : t("aiReportDetails.downloadPdf")}
          </Button>
        )}
      </div>

      <div className="space-y-4">

        {/* Score Overview (from comparison data) */}
        {comparisonData && (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-4 bg-white border rounded-xl">
              <div className="text-2xl font-bold text-emerald-600 font-mono">
                {comparisonData.student_marks ?? 0}/{comparisonData.total_marks ?? 0}
              </div>
              <div className="text-3xs text-muted-foreground uppercase tracking-wide mt-1">{t("aiReportDetails.scoreOverview.marksObtained")}</div>
            </div>
            <div className="text-center p-4 bg-white border rounded-xl">
              <div className="text-2xl font-bold text-violet-600 font-mono">
                #{comparisonData.student_rank ?? "-"}
              </div>
              <div className="text-3xs text-muted-foreground uppercase tracking-wide mt-1">
                {t("aiReportDetails.scoreOverview.rankOf", { total: comparisonData.total_participants ?? "-" })}
              </div>
            </div>
            <div className="text-center p-4 bg-white border rounded-xl">
              <div className="text-2xl font-bold text-cyan-600 font-mono">
                {comparisonData.student_percentile ?? 0}%
              </div>
              <div className="text-3xs text-muted-foreground uppercase tracking-wide mt-1">{t("aiReportDetails.scoreOverview.percentile")}</div>
            </div>
          </div>
        )}

        {/* You vs Class */}
        {comparisonData && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.vsClass.title")}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {/* Marks comparison */}
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">{t("aiReportDetails.vsClass.marksCaption")}</p>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full"
                      style={{ width: `${comparisonData.total_marks > 0 ? (comparisonData.student_marks / comparisonData.total_marks) * 100 : 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs mt-1.5">
                    <span className="text-emerald-600 font-bold">{t("aiReportDetails.vsClass.you", { value: comparisonData.student_marks ?? 0 })}</span>
                    <span className="text-muted-foreground">{t("aiReportDetails.vsClass.avg", { value: comparisonData.average_marks ?? 0 })}</span>
                  </div>
                </div>
                {/* Accuracy comparison */}
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">{t("aiReportDetails.vsClass.accuracyCaption")}</p>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${comparisonData.student_accuracy ?? 0}%` }} />
                  </div>
                  <div className="flex justify-between text-xs mt-1.5">
                    <span className="text-blue-600 font-bold">{t("aiReportDetails.vsClass.you", { value: `${comparisonData.student_accuracy ?? 0}%` })}</span>
                    <span className="text-muted-foreground">{t("aiReportDetails.vsClass.avg", { value: `${comparisonData.class_accuracy ?? 0}%` })}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-6 text-xs text-muted-foreground mt-3">
                <span><b>{t("aiReportDetails.vsClass.highest")}</b> {comparisonData.highest_marks ?? "-"}</span>
                <span><b>{t("aiReportDetails.vsClass.lowest")}</b> {comparisonData.lowest_marks ?? "-"}</span>
                <span><b>{t("aiReportDetails.vsClass.participants")}</b> {comparisonData.total_participants ?? "-"}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {comparisonData?.leaderboard && <LeaderboardCard comparisonData={comparisonData} />}

        {report.performance_analysis && (
          <MarkdownCard title={t("aiReportDetails.performanceAnalysis.title")} text={report.performance_analysis} />
        )}

        {report.confidence_estimation && <ConfidenceCard confidence={report.confidence_estimation} />}

        {report.topic_analysis && report.topic_analysis.length >= 3 && (
          <TopicAnalysisCard topics={report.topic_analysis} />
        )}

        <StrengthsWeaknessesCards strengths={strengths} weaknesses={weaknesses} />

        {report.blooms_taxonomy && <BloomsCard blooms={report.blooms_taxonomy} />}

        {report.misconception_analysis && report.misconception_analysis.length > 0 && (
          <MisconceptionsCard items={report.misconception_analysis} />
        )}

        {report.behavioral_insights && <BehavioralInsightsCard insights={report.behavioral_insights} />}

        {report.recommended_learning_path && report.recommended_learning_path.length > 0 && (
          <LearningPathCard steps={report.recommended_learning_path} />
        )}

        {report.areas_of_improvement && (
          <MarkdownCard title={t("aiReportDetails.areasOfImprovement.title")} text={report.areas_of_improvement} />
        )}
        {report.improvement_path && (
          <MarkdownCard title={t("aiReportDetails.improvementPath.title")} text={report.improvement_path} />
        )}

        {report.flashcards && report.flashcards.length > 0 && <FlashcardsCard cards={report.flashcards} />}
      </div>
    </div>
  );
}
