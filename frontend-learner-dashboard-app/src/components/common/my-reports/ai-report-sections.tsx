import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { ArrowCounterClockwise, CaretLeft, CaretRight } from "@phosphor-icons/react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The AI-written sections of the learner AI report, as cards. Shared by the summary view
 * (ai-report-details-page) and the full on-screen report (ai-report-rich-view).
 */

export interface AiConfidence {
  overall_confidence: number;
  high_confidence_correct: number;
  high_confidence_wrong: number;
  low_confidence_correct: number;
  guessed_correct: number;
  insight: string;
  per_question?: Record<string, number>;
}

export interface AiTopic {
  topic: string; questions_count: number; correct: number;
  accuracy: number; avg_time_seconds: number; mastery_level: string;
}

export interface AiMisconception {
  question_summary: string; student_answer?: string; correct_answer?: string;
  misconception: string; remediation: string;
}

export interface AiBehaviour {
  time_management?: string; difficulty_response?: string;
  fatigue_indicator?: string; skip_pattern?: string;
}

export interface AiLearningStep {
  priority: number; topic: string; current_level: string;
  target_level: string; suggestion: string; estimated_time: string;
}

export type AiBlooms = Record<string, { total: number; correct: number }>;

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

export function MarkdownCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="prose prose-sm max-w-none text-muted-foreground">
        <ReactMarkdown remarkPlugins={[remarkBreaks]}>{text}</ReactMarkdown>
      </CardContent>
    </Card>
  );
}

/** Top ranks and the ranks around the learner, from the /comparison response. */
export function LeaderboardCard({ comparisonData }: { comparisonData: any }) {
  const { t } = useTranslation("layoutCommonB");
  return (
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
  );
}

export function ConfidenceCard({ confidence }: { confidence: AiConfidence }) {
  const { t } = useTranslation("layoutCommonB");
  const confEntries = confidence.per_question ? Object.entries(confidence.per_question) : [];
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{t("aiReportDetails.confidence.title")}</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.confidence.caption")}</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-start gap-4 mb-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#f0f0f0" strokeWidth="10" /> {/* design-lint-ignore: chart series colors */}
              <circle cx="60" cy="60" r="50" fill="none" stroke="#8b5cf6" strokeWidth="10" // design-lint-ignore: chart series colors
                strokeDasharray={`${(confidence.overall_confidence / 100) * 314} 314`}
                strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold text-violet-600">{confidence.overall_confidence}%</span>
            </div>
          </div>
          <div className="grid w-full grid-cols-1 gap-x-6 gap-y-1 text-sm flex-1 sm:grid-cols-2">
            {[
              { l: t("aiReportDetails.confidence.highConfCorrect"), v: confidence.high_confidence_correct, c: "bg-emerald-500" },
              { l: t("aiReportDetails.confidence.highConfWrong"), v: confidence.high_confidence_wrong, c: "bg-red-500" },
              { l: t("aiReportDetails.confidence.lowConfCorrect"), v: confidence.low_confidence_correct, c: "bg-amber-500" },
              { l: t("aiReportDetails.confidence.likelyGuessed"), v: confidence.guessed_correct, c: "bg-gray-400" },
            ].map(s => (
              <div key={s.l} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${s.c}`} />
                <span className="text-muted-foreground">{s.l}</span>
                <b className="ms-auto">{s.v}</b>
              </div>
            ))}
          </div>
        </div>
        {confidence.insight && (
          <div className="text-sm text-muted-foreground bg-violet-50 border-s-3 border-violet-400 p-3 rounded-md mb-3">
            <b className="text-violet-600">{t("aiReportDetails.confidence.aiInsight")}</b> {confidence.insight}
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
  );
}

/** The radar needs 3 topics to draw a shape; the table is shown for any number. */
export function TopicAnalysisCard({ topics }: { topics: AiTopic[] }) {
  const { t } = useTranslation("layoutCommonB");
  const radarData = topics.map(x => ({ topic: x.topic, accuracy: x.accuracy, fullMark: 100 }));
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{t("aiReportDetails.topicAnalysis.title")}</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.topicAnalysis.caption")}</p>
      </CardHeader>
      <CardContent>
        {radarData.length >= 3 && (
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="62%" margin={{ left: 24, right: 24 }}>
              <PolarGrid stroke="#e5e7eb" /> {/* design-lint-ignore: chart series colors */}
              <PolarAngleAxis dataKey="topic" tick={{ fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Radar dataKey="accuracy" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} strokeWidth={2.5} dot={{ fill: "#8b5cf6", r: 4 }} /> {/* design-lint-ignore: chart series colors */}
            </RadarChart>
          </ResponsiveContainer>
        )}
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
              {topics.map((x, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2.5 font-medium">{x.topic}</td>
                  <td className="py-2.5 text-center">{x.questions_count}</td>
                  <td className="py-2.5 text-center">{x.correct}</td>
                  <td className="py-2.5 text-center">
                    <span className={`font-mono font-bold ${x.accuracy >= 70 ? "text-emerald-600" : x.accuracy >= 40 ? "text-amber-600" : "text-red-500"}`}>{x.accuracy}%</span>
                  </td>
                  <td className="py-2.5 text-center text-muted-foreground">{x.avg_time_seconds}s</td>
                  <td className="py-2.5 text-center">
                    <Badge variant="outline" className={MASTERY_VARIANT[x.mastery_level] || ""}>{x.mastery_level}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function StrengthsWeaknessesCards({ strengths, weaknesses }: {
  strengths: [string, number][]; weaknesses: [string, number][];
}) {
  const { t } = useTranslation("layoutCommonB");
  if (strengths.length === 0 && weaknesses.length === 0) return null;
  return (
    <div className={`grid gap-4 ${strengths.length > 0 && weaknesses.length > 0 ? "md:grid-cols-2" : ""}`}>
      {strengths.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base text-emerald-600">{t("aiReportDetails.strengths.title")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {strengths.map(([name, s]) => (
              <div className="space-y-1" key={name}>
                <div className="flex justify-between text-sm"><span>{name}</span><span className="font-mono font-bold text-emerald-600">{s}%</span></div>
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
            {weaknesses.map(([name, s]) => (
              <div className="space-y-1" key={name}>
                <div className="flex justify-between text-sm"><span>{name}</span><span className="font-mono font-bold text-red-500">{s}%</span></div>
                <Progress value={s} className="h-2 [&>div]:bg-red-500 bg-red-100" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function BloomsCard({ blooms }: { blooms: AiBlooms }) {
  const { t } = useTranslation("layoutCommonB");
  const BLOOM_LABELS: Record<string, string> = {
    remember: t("aiReportDetails.bloomLevels.remember"),
    understand: t("aiReportDetails.bloomLevels.understand"),
    apply: t("aiReportDetails.bloomLevels.apply"),
    analyze: t("aiReportDetails.bloomLevels.analyze"),
    evaluate: t("aiReportDetails.bloomLevels.evaluate"),
    create: t("aiReportDetails.bloomLevels.create"),
  };
  const bloomsData = ["remember", "understand", "apply", "analyze", "evaluate", "create"]
    .filter(l => blooms[l])
    .map(l => {
      const d = blooms[l]!;
      return { level: BLOOM_LABELS[l] ?? l, key: l,
        accuracy: d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0,
        correct: d.correct, total: d.total };
    });
  if (bloomsData.length === 0) return null;
  return (
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
  );
}

/** The learner's answer and the right answer are left out when the report options hide them. */
export function MisconceptionsCard({ items }: { items: AiMisconception[] }) {
  const { t } = useTranslation("layoutCommonB");
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{t("aiReportDetails.misconceptions.title")}</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">{t("aiReportDetails.misconceptions.caption")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((m, i) => (
          <div key={i} className="border border-red-200 bg-red-50/60 rounded-xl p-4">
            <p className="font-semibold text-sm mb-2">{m.question_summary}</p>
            {(m.student_answer != null || m.correct_answer != null) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2">
                {m.student_answer != null && (
                  <span className="text-red-500"><b>{t("aiReportDetails.misconceptions.yourAnswer")}</b> {m.student_answer}</span>
                )}
                {m.correct_answer != null && (
                  <span className="text-emerald-600"><b>{t("aiReportDetails.misconceptions.correct")}</b> {m.correct_answer}</span>
                )}
              </div>
            )}
            <div className="text-xs bg-orange-50 border-s-3 border-orange-400 p-2.5 rounded mb-1.5">
              <b className="text-orange-500">{t("aiReportDetails.misconceptions.misconceptionLabel")}</b> {m.misconception}
            </div>
            <p className="text-xs text-blue-500">{m.remediation}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function BehavioralInsightsCard({ insights }: { insights: AiBehaviour }) {
  const { t } = useTranslation("layoutCommonB");
  return (
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
            const val = insights[item.k];
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
  );
}

export function LearningPathCard({ steps }: { steps: AiLearningStep[] }) {
  const { t } = useTranslation("layoutCommonB");
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t("aiReportDetails.learningPath.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {steps.map((s, i) => (
          <div key={`${s.priority}-${i}`} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-violet-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">{s.priority ?? i + 1}</div>
            <div className="flex-1">
              <p className="font-semibold text-sm">{s.topic}</p>
              {s.current_level && s.target_level && (
                <p className="text-xs text-muted-foreground">{s.current_level} → {s.target_level}</p>
              )}
              <p className="text-sm mt-1 text-muted-foreground">{s.suggestion}</p>
              <p className="text-xs text-cyan-600 font-semibold mt-1">{s.estimated_time}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function FlashcardsCard({ cards }: { cards: { front: string; back: string }[] }) {
  const { t } = useTranslation("layoutCommonB");
  const [flashIdx, setFlashIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const fc = cards[flashIdx];
  if (!fc) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {t("aiReportDetails.flashcards.title")} <span className="text-sm font-normal text-muted-foreground">({flashIdx + 1}/{cards.length})</span>
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
            <Button variant="outline" size="sm" onClick={() => { setFlashIdx(p => p === 0 ? cards.length - 1 : p - 1); setShowAnswer(false); }}
              disabled={cards.length <= 1}><CaretLeft size={16} /></Button>
            <Button variant="outline" size="sm" onClick={() => setShowAnswer(!showAnswer)}>
              <ArrowCounterClockwise size={14} className="me-1" /> {t("aiReportDetails.flashcards.flip")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setFlashIdx(p => p === cards.length - 1 ? 0 : p + 1); setShowAnswer(false); }}
              disabled={cards.length <= 1}><CaretRight size={16} /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
