import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { AI_REPORT_WEB_DATA, EXPORT_AI_REPORT } from "@/constants/urls";
import { Button } from "@/components/ui/button";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { cn } from "@/lib/utils";
import { saveFile } from "@/lib/download/save-file";
import {
  type AiReportWebData, confidenceQuadrant, easyMarksMissed, expertise, negativeMarking, quarterAccuracy, speedBands,
} from "./ai-report-rich-data";
import {
  BehavioralInsightsCard, BloomsCard, ConfidenceCard, FlashcardsCard, LeaderboardCard, LearningPathCard,
  MarkdownCard, MisconceptionsCard, StrengthsWeaknessesCards, TopicAnalysisCard,
} from "./ai-report-sections";
import {
  AnswerMapCard, EasyMarksCard, ExpertiseCard, HeroCard, NegativeMarkingCard, PotentialCard, ProgressCard,
  QuadrantCard, QuestionByQuestionCard, SectionMarksCard, SectionTimeCard, SpeedAccuracyCard, StaminaCard,
  StandingCard,
} from "./ai-report-rich-sections";

interface AiReportRichViewProps {
  assessmentId: string;
  assessmentName: string;
  attemptId?: string;
  /** The /comparison response, for the leaderboard (named ranks); optional. */
  comparisonData?: any;
  /** Rendered instead when the server cannot produce the report data. */
  fallback: ReactNode;
}

// The report data per attempt, kept for the session so switching tabs and coming back does
// not ask the server to build it again. A request still in flight is shared too: the page
// swaps layouts while it loads, and that must not build the report twice.
const loadedReports = new Map<string, AiReportWebData>();
const pendingReports = new Map<string, Promise<AiReportWebData | null>>();

/** A slow server falls back to the summary view instead of spinning forever. */
const REPORT_TIMEOUT_MS = 30_000;

async function currentInstituteId(): Promise<string> {
  const stored = await Preferences.get({ key: "InstituteDetails" });
  try {
    return JSON.parse(stored.value || "{}").id || "";
  } catch {
    return "";
  }
}

export function loadReportData(assessmentId: string, attemptId?: string): Promise<AiReportWebData | null> {
  const key = `${assessmentId}:${attemptId ?? ""}`;
  const done = loadedReports.get(key);
  if (done) return Promise.resolve(done);
  let pending = pendingReports.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const instituteId = await currentInstituteId();
        const res = await authenticatedAxiosInstance<AiReportWebData>({
          method: "GET",
          url: AI_REPORT_WEB_DATA,
          params: { assessmentId, ...(attemptId ? { attemptId } : {}), instituteId },
          timeout: REPORT_TIMEOUT_MS,
        });
        const data = res.data && Array.isArray(res.data.questions) ? res.data : null;
        if (data) loadedReports.set(key, data);
        return data;
      } finally {
        pendingReports.delete(key);
      }
    })();
    pendingReports.set(key, pending);
  }
  return pending;
}

/**
 * The learner's AI report on screen, as cards and interactive charts. It is built from the
 * same data and report options as the "Download PDF" file, so the numbers always agree; the
 * screen adds the full AI text, flip-through flashcards and the named leaderboard.
 */
export function AiReportRichView({ assessmentId, assessmentName, attemptId, comparisonData, fallback }: AiReportRichViewProps) {
  const { t } = useTranslation("layoutCommonB");
  const [data, setData] = useState<AiReportWebData | null>(
    () => loadedReports.get(`${assessmentId}:${attemptId ?? ""}`) ?? null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(data ? "ready" : "loading");
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = loadedReports.get(`${assessmentId}:${attemptId ?? ""}`);
    if (cached) {
      setData(cached);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    loadReportData(assessmentId, attemptId)
      .then((report) => {
        if (cancelled) return;
        if (report) {
          setData(report);
          setStatus("ready");
        } else {
          setStatus("failed");
        }
      })
      .catch((e) => {
        console.warn("On-screen AI report unavailable, showing the summary view:", e);
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [assessmentId, attemptId]);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadFailed(false);
      const instituteId = await currentInstituteId();
      const res = await authenticatedAxiosInstance({
        method: "GET",
        url: EXPORT_AI_REPORT,
        params: { assessmentId, ...(attemptId ? { attemptId } : {}), instituteId },
        responseType: "blob",
      });
      await saveFile(new Blob([res.data], { type: "application/pdf" }), `${assessmentName || "ai-report"}.pdf`);
    } catch {
      setDownloadFailed(true);
      setTimeout(() => setDownloadFailed(false), 3000);
    } finally {
      setDownloading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <DashboardLoader />
      </div>
    );
  }

  if (status === "failed" || !data) return <>{fallback}</>;

  const ai = data.ai ?? {};
  // {topic: percent} maps from the AI; a value may arrive as "40". A 0% weakness is the one that
  // matters most, so it is kept (the summary view drops it).
  const percents = (m: unknown) => Object.entries((m ?? {}) as Record<string, unknown>)
    .map(([k, v]) => [k, Number(v)] as [string, number])
    .filter(([, v]) => Number.isFinite(v));
  const strengths = percents(ai.strengths).filter(([, v]) => v > 0);
  const weaknesses = percents(ai.weaknesses).filter(([, v]) => v >= 0);
  const topics = Array.isArray(ai.topic_analysis) ? ai.topic_analysis.filter((x: any) => x?.topic) : [];
  const confidence = ai.confidence_estimation;
  const hasConfidenceCard = !!confidence && typeof confidence.overall_confidence === "number";
  const hasCards = Array.isArray(ai.flashcards) && ai.flashcards.length > 0;
  // The behaviour charts sit two to a row; an odd last one takes the full row.
  const behaviour = [
    { show: speedBands(data.questions).reduce((a, b) => a + b.total, 0) >= 6,
      render: (c?: string) => <SpeedAccuracyCard key="speed" d={data} className={c} /> },
    { show: quarterAccuracy(data.questions) != null,
      render: (c?: string) => <StaminaCard key="stamina" d={data} className={c} /> },
    { show: negativeMarking(data) != null,
      render: (c?: string) => <NegativeMarkingCard key="negative" d={data} className={c} /> },
    { show: confidenceQuadrant(data.questions) != null,
      render: (c?: string) => <QuadrantCard key="quadrant" d={data} showInsight={!hasConfidenceCard} className={c} /> },
  ].filter((x) => x.show);
  // Two cards side by side on a wide screen; one alone takes the full width.
  const pair = (a: boolean, b: boolean) => cn("grid gap-4 empty:hidden", a && b && "md:grid-cols-2");
  const subtitle = [
    data.student_name,
    data.enrollment_number ? t("aiReportDetails.rich.enrollment", { value: data.enrollment_number }) : null,
    // Same details the PDF prints, chosen per assessment in its report settings.
    ...(data.student_details ?? []).map((d) => (d?.value ? (d.label ? `${d.label}: ${d.value}` : d.value) : null)),
    data.attempt_date ? new Date(data.attempt_date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="w-full space-y-4 p-4 md:p-6 lg:p-8">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-xl font-bold">{assessmentName || data.assessment_name}</h1>
          <p className="text-sm text-muted-foreground">{subtitle || t("aiReportDetails.defaultSubtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          className={cn("gap-1.5", downloadFailed && "border-destructive text-destructive")}
        >
          {downloading ? <SpinnerGap className="size-4 animate-spin" /> : <DownloadSimple className="size-4" />}
          {downloading
            ? t("aiReportDetails.generating")
            : downloadFailed
              ? t("aiReportDetails.failed")
              : t("aiReportDetails.downloadPdf")}
        </Button>
      </div>

      <HeroCard d={data} />

      {typeof ai.performance_analysis === "string" && ai.performance_analysis && (
        <MarkdownCard title={t("aiReportDetails.performanceAnalysis.title")} text={ai.performance_analysis} />
      )}

      <SectionMarksCard d={data} />
      <StandingCard d={data} />
      {comparisonData?.leaderboard && <LeaderboardCard comparisonData={comparisonData} />}
      <SectionTimeCard d={data} />
      <AnswerMapCard d={data} />

      {topics.length > 0 && <TopicAnalysisCard topics={topics} />}
      <StrengthsWeaknessesCards strengths={strengths} weaknesses={weaknesses} />
      {ai.blooms_taxonomy && typeof ai.blooms_taxonomy === "object" && <BloomsCard blooms={ai.blooms_taxonomy} />}

      <div className={pair(easyMarksMissed(data).length > 0, expertise(data).length > 0)}>
        <EasyMarksCard d={data} />
        <ExpertiseCard d={data} />
      </div>
      <PotentialCard d={data} />

      <div className="grid gap-4 empty:hidden md:grid-cols-2">
        {behaviour.map(({ render }, i) =>
          render(behaviour.length % 2 === 1 && i === behaviour.length - 1 ? "md:col-span-2" : undefined))}
      </div>
      {hasConfidenceCard && <ConfidenceCard confidence={confidence} />}
      {ai.behavioral_insights && typeof ai.behavioral_insights === "object" && (
        <BehavioralInsightsCard insights={ai.behavioral_insights} />
      )}

      {Array.isArray(ai.misconception_analysis) && ai.misconception_analysis.length > 0 && (
        <MisconceptionsCard items={ai.misconception_analysis} />
      )}
      {Array.isArray(ai.recommended_learning_path) && ai.recommended_learning_path.length > 0 && (
        <LearningPathCard steps={ai.recommended_learning_path} />
      )}
      {typeof ai.areas_of_improvement === "string" && ai.areas_of_improvement && (
        <MarkdownCard title={t("aiReportDetails.areasOfImprovement.title")} text={ai.areas_of_improvement} />
      )}
      {typeof ai.improvement_path === "string" && ai.improvement_path && (
        <MarkdownCard title={t("aiReportDetails.improvementPath.title")} text={ai.improvement_path} />
      )}

      <div className={pair(hasCards, data.history.length >= 2)}>
        {hasCards && <FlashcardsCard cards={ai.flashcards} />}
        <ProgressCard d={data} />
      </div>

      <QuestionByQuestionCard d={data} />
    </div>
  );
}

export default AiReportRichView;
