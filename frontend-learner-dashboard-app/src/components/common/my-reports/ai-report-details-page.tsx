"use client";

import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { CaretLeft, CaretRight, ArrowCounterClockwise, DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { EXPORT_AI_REPORT } from "@/constants/urls";
import { Preferences } from "@capacitor/preferences";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ─── Types ───
interface AIReportData {
  performance_analysis: string;
  weaknesses: Record<string, number>;
  strengths: Record<string, number>;
  areas_of_improvement: string;
  improvement_path: string;
  flashcards: { front: string; back: string }[];
  confidence_estimation?: {
    overall_confidence: number;
    high_confidence_correct: number;
    high_confidence_wrong: number;
    low_confidence_correct: number;
    guessed_correct: number;
    insight: string;
    per_question?: Record<string, number>;
  };
  topic_analysis?: {
    topic: string; questions_count: number; correct: number;
    accuracy: number; avg_time_seconds: number; mastery_level: string;
  }[];
  misconception_analysis?: {
    question_summary: string; student_answer: string; correct_answer: string;
    misconception: string; remediation: string;
  }[];
  blooms_taxonomy?: Record<string, { total: number; correct: number }>;
  behavioral_insights?: {
    time_management?: string; difficulty_response?: string;
    fatigue_indicator?: string; skip_pattern?: string;
  };
  recommended_learning_path?: {
    priority: number; topic: string; current_level: string;
    target_level: string; suggestion: string; estimated_time: string;
  }[];
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

const MASTERY_VARIANT: Record<string, string> = {
  Expert: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Proficient: "bg-blue-100 text-blue-700 border-blue-200",
  Developing: "bg-amber-100 text-amber-700 border-amber-200",
  Beginner: "bg-red-100 text-red-700 border-red-200",
};

const BLOOM_COLORS: Record<string, string> = {
  remember: "#10b981", understand: "#3b82f6", apply: "#8b5cf6", // design-lint-ignore: chart series colors
  analyze: "#f59e0b", evaluate: "#f97316", create: "#ef4444", // design-lint-ignore: chart series colors
};

const BLOOM_BG: Record<string, string> = {
  remember: "bg-emerald-500", understand: "bg-blue-500", apply: "bg-violet-500",
  analyze: "bg-amber-500", evaluate: "bg-orange-500", create: "bg-red-500",
};

// ─── Main Component ───
export default function AIReportDetailsPage({
  report, assessmentId, assessmentName, attemptId, instituteId, comparisonData, subtitle,
}: AIReportDetailsPageProps) {
  const { t } = useTranslation("layoutCommonB");
  const BLOOM_LABELS: Record<string, string> = {
    remember: t("aiReportDetails.bloomLevels.remember"),
    understand: t("aiReportDetails.bloomLevels.understand"),
    apply: t("aiReportDetails.bloomLevels.apply"),
    analyze: t("aiReportDetails.bloomLevels.analyze"),
    evaluate: t("aiReportDetails.bloomLevels.evaluate"),
    create: t("aiReportDetails.bloomLevels.create"),
  };
  const [flashIdx, setFlashIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
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

  const fc = report.flashcards?.[flashIdx];

  // Chart data
  const radarData = report.topic_analysis?.map(t => ({ topic: t.topic, accuracy: t.accuracy, fullMark: 100 }));

  const bloomsData = report.blooms_taxonomy
    ? ["remember", "understand", "apply", "analyze", "evaluate", "create"]
        .filter(l => report.blooms_taxonomy?.[l])
        .map(l => {
          const d = report.blooms_taxonomy![l]!;
          return { level: BLOOM_LABELS[l] ?? l, key: l,
            accuracy: d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0,
            correct: d.correct, total: d.total };
        })
    : [];

  const confEntries = report.confidence_estimation?.per_question
    ? Object.entries(report.confidence_estimation.per_question) : [];

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

        {/* Leaderboard */}
        {comparisonData?.leaderboard && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.leaderboard.title")}</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="pb-2 text-start font-medium">{t("aiReportDetails.leaderboard.rank")}</th>
                    <th className="pb-2 text-start font-medium">{t("aiReportDetails.leaderboard.student")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.leaderboard.marks")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.leaderboard.percentile")}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.leaderboard.top_ranks?.map((e: any, i: number) => (
                    <tr key={`top-${i}`} className={`border-b ${e.rank === comparisonData.student_rank ? "bg-amber-50" : ""}`}>
                      <td className="py-2 font-medium">{e.rank}</td>
                      <td className="py-2">{e.rank === comparisonData.student_rank ? t("aiReportDetails.leaderboard.youMarker", { name: e.student_name }) : e.student_name}</td>
                      <td className="py-2 text-center font-mono font-bold text-emerald-600">{e.achieved_marks}/{comparisonData.total_marks ?? ""}</td>
                      <td className="py-2 text-center">{e.percentile}%</td>
                    </tr>
                  ))}
                  {comparisonData.leaderboard.has_gap && (
                    <tr><td colSpan={4} className="text-center py-1 text-muted-foreground text-xs">···</td></tr>
                  )}
                  {comparisonData.leaderboard.surrounding_ranks?.map((e: any, i: number) => (
                    <tr key={`sur-${i}`} className={`border-b ${e.rank === comparisonData.student_rank ? "bg-amber-50" : ""}`}>
                      <td className="py-2 font-medium">{e.rank}</td>
                      <td className="py-2">{e.rank === comparisonData.student_rank ? t("aiReportDetails.leaderboard.youMarker", { name: e.student_name }) : e.student_name}</td>
                      <td className="py-2 text-center font-mono font-bold text-emerald-600">{e.achieved_marks}/{comparisonData.total_marks ?? ""}</td>
                      <td className="py-2 text-center">{e.percentile}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-center text-xs text-muted-foreground mt-3">
                {t("aiReportDetails.leaderboard.yourRankPrefix")}{" "}
                <b className="text-violet-600">#{comparisonData.student_rank ?? "-"}</b>{" "}
                {t("aiReportDetails.leaderboard.ofNStudents", { total: comparisonData.total_participants ?? "-" })}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Performance Analysis */}
        {report.performance_analysis && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.performanceAnalysis.title")}</CardTitle></CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkBreaks]}>{report.performance_analysis}</ReactMarkdown>
            </CardContent>
          </Card>
        )}

        {/* Confidence Estimation */}
        {report.confidence_estimation && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{t("aiReportDetails.confidence.title")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.confidence.caption")}</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 mb-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#f0f0f0" strokeWidth="10" /> {/* design-lint-ignore: chart series colors */}
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#8b5cf6" strokeWidth="10" // design-lint-ignore: chart series colors
                      strokeDasharray={`${(report.confidence_estimation.overall_confidence / 100) * 314} 314`}
                      strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold text-violet-600">{report.confidence_estimation.overall_confidence}%</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm flex-1">
                  {[
                    { l: t("aiReportDetails.confidence.highConfCorrect"), v: report.confidence_estimation.high_confidence_correct, c: "bg-emerald-500" },
                    { l: t("aiReportDetails.confidence.highConfWrong"), v: report.confidence_estimation.high_confidence_wrong, c: "bg-red-500" },
                    { l: t("aiReportDetails.confidence.lowConfCorrect"), v: report.confidence_estimation.low_confidence_correct, c: "bg-amber-500" },
                    { l: t("aiReportDetails.confidence.likelyGuessed"), v: report.confidence_estimation.guessed_correct, c: "bg-gray-400" },
                  ].map(s => (
                    <div key={s.l} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.c}`} />
                      <span className="text-muted-foreground">{s.l}</span>
                      <b className="ms-auto">{s.v}</b>
                    </div>
                  ))}
                </div>
              </div>
              {report.confidence_estimation.insight && (
                <div className="text-sm text-muted-foreground bg-violet-50 border-s-3 border-violet-400 p-3 rounded-md mb-3">
                  <b className="text-violet-600">{t("aiReportDetails.confidence.aiInsight")}</b> {report.confidence_estimation.insight}
                </div>
              )}
              {confEntries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-3xs uppercase tracking-wider text-muted-foreground font-semibold">{t("aiReportDetails.confidence.perQuestion")}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {confEntries.map(([q, c]) => (
                      <div key={q} className={`rounded-lg p-2 text-center border ${c >= 70 ? "bg-emerald-50 border-emerald-200" : c >= 40 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
                        <p className="text-3xs text-muted-foreground">{q}</p>
                        <p className={`text-lg font-bold font-mono ${c >= 70 ? "text-emerald-600" : c >= 40 ? "text-amber-600" : "text-red-500"}`}>{c}%</p>
                        <p className={`text-3xs font-bold ${c >= 70 ? "text-emerald-600" : c >= 40 ? "text-amber-600" : "text-red-500"}`}>{c >= 70 ? t("aiReportDetails.confidence.high") : c >= 40 ? t("aiReportDetails.confidence.medium") : t("aiReportDetails.confidence.low")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Topic Analysis — Radar */}
        {radarData && radarData.length >= 3 && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{t("aiReportDetails.topicAnalysis.title")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.topicAnalysis.caption")}</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="#e5e7eb" /> {/* design-lint-ignore: chart series colors */}
                  <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Radar dataKey="accuracy" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} strokeWidth={2.5} dot={{ fill: "#8b5cf6", r: 4 }} /> {/* design-lint-ignore: chart series colors */}
                </RadarChart>
              </ResponsiveContainer>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-muted-foreground">
                    <th className="pb-2 text-start font-medium">{t("aiReportDetails.topicAnalysis.table.topic")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.topicAnalysis.table.questions")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.topicAnalysis.table.correct")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.topicAnalysis.table.accuracy")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.topicAnalysis.table.avgTime")}</th>
                    <th className="pb-2 text-center font-medium">{t("aiReportDetails.topicAnalysis.table.mastery")}</th>
                  </tr></thead>
                  <tbody>
                    {report.topic_analysis!.map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2.5 font-medium">{t.topic}</td>
                        <td className="py-2.5 text-center">{t.questions_count}</td>
                        <td className="py-2.5 text-center">{t.correct}</td>
                        <td className="py-2.5 text-center">
                          <span className={`font-mono font-bold ${t.accuracy >= 70 ? "text-emerald-600" : t.accuracy >= 40 ? "text-amber-600" : "text-red-500"}`}>{t.accuracy}%</span>
                        </td>
                        <td className="py-2.5 text-center text-muted-foreground">{t.avg_time_seconds}s</td>
                        <td className="py-2.5 text-center">
                          <Badge variant="outline" className={MASTERY_VARIANT[t.mastery_level] || ""}>{t.mastery_level}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Strengths & Weaknesses */}
        {(strengths.length > 0 || weaknesses.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {strengths.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base text-emerald-600">{t("aiReportDetails.strengths.title")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {strengths.map(([t, s]) => (
                    <div className="space-y-1" key={t}>
                      <div className="flex justify-between text-sm"><span>{t}</span><span className="font-mono font-bold text-emerald-600">{s}%</span></div>
                      <Progress value={s} className="h-2 [&>div]:bg-emerald-500 bg-emerald-100" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {weaknesses.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base text-red-500">{t("aiReportDetails.weaknesses.title")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {weaknesses.map(([t, s]) => (
                    <div className="space-y-1" key={t}>
                      <div className="flex justify-between text-sm"><span>{t}</span><span className="font-mono font-bold text-red-500">{s}%</span></div>
                      <Progress value={s} className="h-2 [&>div]:bg-red-500 bg-red-100" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Bloom's Taxonomy */}
        {bloomsData.length > 0 && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{t("aiReportDetails.bloomsTaxonomy.title")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.bloomsTaxonomy.caption")}</p>
            </CardHeader>
            <CardContent>
              <p className="text-3xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">{t("aiReportDetails.bloomsTaxonomy.performanceByLevel")}</p>
              <div className="space-y-2.5 mb-5">
                {bloomsData.map(d => (
                  <div key={d.key} className="flex items-center gap-3">
                    <span className="w-20 text-xs font-semibold text-end text-muted-foreground">{d.level}</span>
                    <div className="flex-1 h-7 bg-gray-100 rounded-md overflow-hidden">
                      <div className={`h-full rounded-md ${BLOOM_BG[d.key]} flex items-center px-2 text-white text-xs font-bold`}
                        style={{ width: `${Math.max(d.accuracy, 5)}%` }}>{d.accuracy}%</div>
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-end font-mono">{d.correct}/{d.total}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bloomsData} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /> {/* design-lint-ignore: chart series colors */}
                  <XAxis dataKey="level" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }} formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
                    {bloomsData.map(d => <Cell key={d.key} fill={BLOOM_COLORS[d.key] || "#8b5cf6"} />)} {/* design-lint-ignore: chart series colors */}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Misconception Analysis */}
        {report.misconception_analysis && report.misconception_analysis.length > 0 && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">{t("aiReportDetails.misconceptions.title")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.misconceptions.caption")}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.misconception_analysis.map((m, i) => (
                <div key={i} className="border border-red-200 bg-red-50/60 rounded-xl p-4">
                  <p className="font-semibold text-sm mb-2">{m.question_summary}</p>
                  <div className="flex gap-4 text-xs mb-2">
                    <span className="text-red-500"><b>{t("aiReportDetails.misconceptions.yourAnswer")}</b> {m.student_answer}</span>
                    <span className="text-emerald-600"><b>{t("aiReportDetails.misconceptions.correct")}</b> {m.correct_answer}</span>
                  </div>
                  <div className="text-xs bg-orange-50 border-s-3 border-orange-400 p-2.5 rounded mb-1.5">
                    <b className="text-orange-500">{t("aiReportDetails.misconceptions.misconceptionLabel")}</b> {m.misconception}
                  </div>
                  <p className="text-xs text-blue-500">{m.remediation}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Behavioral Insights */}
        {report.behavioral_insights && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.behavioralInsights.title")}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-3">
                {([
                  { k: "time_management", l: t("aiReportDetails.behavioralInsights.timeManagement"), c: "border-blue-500 bg-blue-50/50", tc: "text-blue-600" },
                  { k: "fatigue_indicator", l: t("aiReportDetails.behavioralInsights.fatigueIndicator"), c: "border-red-500 bg-red-50/50", tc: "text-red-500" },
                  { k: "difficulty_response", l: t("aiReportDetails.behavioralInsights.difficultyResponse"), c: "border-orange-500 bg-orange-50/50", tc: "text-orange-500" },
                  { k: "skip_pattern", l: t("aiReportDetails.behavioralInsights.skipPattern"), c: "border-gray-400 bg-gray-50/50", tc: "text-gray-500" },
                ] as const).map(item => {
                  const val = report.behavioral_insights?.[item.k as keyof typeof report.behavioral_insights];
                  if (!val) return null;
                  return (
                    <div key={item.k} className={`p-3 rounded-lg border-s-4 ${item.c}`}>
                      <p className={`text-3xs font-bold uppercase tracking-wide mb-1 ${item.tc}`}>{item.l}</p>
                      <p className="text-sm text-muted-foreground">{val}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recommended Learning Path */}
        {report.recommended_learning_path && report.recommended_learning_path.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.learningPath.title")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {report.recommended_learning_path.map(s => (
                <div key={s.priority} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">{s.priority}</div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{s.topic}</p>
                    <p className="text-xs text-muted-foreground">{s.current_level} → {s.target_level}</p>
                    <p className="text-sm mt-1 text-muted-foreground">{s.suggestion}</p>
                    <p className="text-xs text-cyan-600 font-semibold mt-1">{s.estimated_time}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Areas of Improvement / Improvement Path */}
        {report.areas_of_improvement && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.areasOfImprovement.title")}</CardTitle></CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkBreaks]}>{report.areas_of_improvement}</ReactMarkdown>
            </CardContent>
          </Card>
        )}
        {report.improvement_path && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.improvementPath.title")}</CardTitle></CardHeader>
            <CardContent className="prose prose-sm max-w-none text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkBreaks]}>{report.improvement_path}</ReactMarkdown>
            </CardContent>
          </Card>
        )}

        {/* Flashcards */}
        {report.flashcards && report.flashcards.length > 0 && fc && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {t("aiReportDetails.flashcards.title")} <span className="text-sm font-normal text-muted-foreground">({flashIdx + 1}/{report.flashcards.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center gap-4">
                <div
                  onClick={() => setShowAnswer(!showAnswer)}
                  className={`w-full max-w-md min-h-reg-200 rounded-xl border-2 cursor-pointer transition-all hover:shadow-md flex items-center justify-center p-6 ${showAnswer ? "bg-emerald-50/50 border-emerald-200" : "bg-violet-50/50 border-violet-200"}`}
                >
                  <div className="text-center">
                    <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${showAnswer ? "text-emerald-600" : "text-violet-600"}`}>
                      {showAnswer ? t("aiReportDetails.flashcards.answer") : t("aiReportDetails.flashcards.question")}
                    </p>
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkBreaks]}>{showAnswer ? fc.back : fc.front}</ReactMarkdown>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => { setFlashIdx(p => p === 0 ? report.flashcards.length - 1 : p - 1); setShowAnswer(false); }}
                    disabled={report.flashcards.length <= 1}><CaretLeft size={16} /></Button>
                  <Button variant="outline" size="sm" onClick={() => setShowAnswer(!showAnswer)}>
                    <ArrowCounterClockwise size={14} className="me-1" /> {t("aiReportDetails.flashcards.flip")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setFlashIdx(p => p === report.flashcards.length - 1 ? 0 : p + 1); setShowAnswer(false); }}
                    disabled={report.flashcards.length <= 1}><CaretRight size={16} /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
