import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  type AiReportWebData, type Outcome, type ReportQuestion,
  confidenceQuadrant, count, easyMarksMissed, expertise, hasClassOf5, histogram, mmss, negativeMarking, num, num1,
  pct, quarterAccuracy, questionTitle, speedBands, uniformPenalty,
} from "./ai-report-rich-data";

/**
 * The sections of the on-screen AI report that are drawn from the marks (the AI-written
 * sections live in ai-report-sections). Each one shows exactly when the PDF prints it.
 */

// Chart colours come from the theme tokens, so an institute's theme carries into the charts.
const C = {
  primary: "hsl(var(--primary-500))",
  primarySoft: "hsl(var(--primary-200))",
  success: "hsl(var(--success-500))",
  warning: "hsl(var(--warning-500))",
  danger: "hsl(var(--danger-500))",
  muted: "hsl(var(--muted-foreground))",
  grid: "hsl(var(--border))",
};

const OUTCOME_BOX: Record<Outcome, string> = {
  CORRECT: "bg-success-500 text-white",
  PARTIAL: "bg-warning-500 text-white",
  WRONG: "bg-danger-500 text-white",
  PENDING: "border-2 border-dashed border-muted-foreground/40 bg-background text-muted-foreground",
  SKIPPED: "bg-muted text-muted-foreground",
};

const OUTCOME_BADGE: Record<Outcome, string> = {
  CORRECT: "border-success-200 bg-success-50 text-success-700",
  PARTIAL: "border-warning-200 bg-warning-50 text-warning-700",
  WRONG: "border-danger-200 bg-danger-50 text-danger-700",
  PENDING: "border-border bg-muted text-muted-foreground",
  SKIPPED: "border-border bg-muted text-muted-foreground",
};

function accuracyText(p: number) {
  return p >= 70 ? "text-success-600" : p >= 40 ? "text-warning-600" : "text-danger-600";
}

function accuracyColor(p: number) {
  return p >= 70 ? C.success : p >= 40 ? C.warning : C.danger;
}

function SectionCard({ title, caption, children, className }: {
  title: string; caption?: string | null; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-1">
        <CardTitle className="text-base">{title}</CardTitle>
        {caption && <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Tile({ value, label, tone }: { value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 text-center">
      <div className={cn("text-2xl font-bold font-mono", tone)}>{value}</div>
      <div className="text-3xs uppercase tracking-wide text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

// ── Result ──

export function HeroCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  const class5 = hasClassOf5(d);
  const right = count(d, "CORRECT") + count(d, "PARTIAL");
  const wrong = count(d, "WRONG");
  const skipped = count(d, "SKIPPED");
  const pending = count(d, "PENDING");
  const penalty = uniformPenalty(d);
  const better = d.percentile != null ? Math.round(d.percentile) : null;
  const timeLabel = [
    t("aiReportDetails.rich.hero.timeUsed"),
    d.duration_limit_minutes != null ? t("aiReportDetails.rich.hero.timeOf", { value: d.duration_limit_minutes }) : null,
    class5 && d.class_average_time_seconds != null ? t("aiReportDetails.rich.hero.classTime", { value: mmss(d.class_average_time_seconds) }) : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardContent className="p-5 md:p-6 space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">{t("aiReportDetails.rich.hero.kicker")}</p>
            {d.headline && <h2 className="text-xl font-bold">{d.headline}</h2>}
            {d.subline && <p className="text-sm text-muted-foreground">{d.subline}</p>}
          </div>
          <div className="md:text-end">
            <div className="font-mono font-bold text-primary-500">
              <span className="text-4xl">{num(d.score)}</span>
              <span className="text-lg text-muted-foreground">/{num(d.max_score)}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {class5 && d.rank != null
                ? t("aiReportDetails.rich.hero.rankOf", { rank: d.rank, total: d.participants })
                : `${Math.round(pct(d.score, d.max_score))}%`}
            </p>
          </div>
        </div>

        {class5 && better != null && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("aiReportDetails.rich.hero.betterThan", { value: better })}</span>
              {d.class_average != null && d.class_highest != null && (
                <span>{t("aiReportDetails.rich.hero.classLine", { avg: num1(d.class_average), high: num(d.class_highest) })}</span>
              )}
            </div>
            <Progress value={Math.max(2, Math.min(100, better))} className="h-2" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile value={right} tone="text-success-600"
            label={count(d, "PARTIAL") > 0 ? t("aiReportDetails.rich.hero.rightOrPartly") : t("aiReportDetails.rich.hero.correct")} />
          <Tile value={wrong} tone="text-danger-600"
            label={penalty ? t("aiReportDetails.rich.hero.wrongEach", { value: penalty }) : t("aiReportDetails.rich.hero.wrong")} />
          {pending > 0
            ? <Tile value={pending} label={[t("aiReportDetails.rich.hero.pending"),
                skipped > 0 ? t("aiReportDetails.rich.hero.skippedCount", { count: skipped }) : null].filter(Boolean).join(" · ")} />
            : <Tile value={skipped} label={t("aiReportDetails.rich.hero.skipped")} />}
          {d.time_taken_seconds != null && d.time_taken_seconds > 0
            ? <Tile value={mmss(d.time_taken_seconds)} label={timeLabel} />
            : <Tile value={d.questions.length} label={t("aiReportDetails.rich.hero.questions")} />}
        </div>
        {d.marking_note && <p className="text-xs text-muted-foreground">{d.marking_note}</p>}
      </CardContent>
    </Card>
  );
}

/** You against the class average, and how the class's scores spread. */
export function StandingCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  if (!hasClassOf5(d)) return null;
  const bins = histogram(d.class_scores, d.score, d.max_score);
  const avg = d.class_average ?? 0;
  return (
    <SectionCard title={t("aiReportDetails.rich.standing.title")}
      caption={t("aiReportDetails.rich.standing.caption", { total: d.participants })}>
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground mb-2">{t("aiReportDetails.vsClass.marksCaption")}</p>
          <Progress value={pct(Math.max(0, d.score), d.max_score)} className="h-2" />
          <div className="flex justify-between text-xs mt-1.5">
            <span className="font-bold text-primary-500">{t("aiReportDetails.vsClass.you", { value: num(d.score) })}</span>
            <span className="text-muted-foreground">{t("aiReportDetails.vsClass.avg", { value: num1(avg) })}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span><b>{t("aiReportDetails.vsClass.highest")}</b> {d.class_highest != null ? num(d.class_highest) : "-"}</span>
          <span><b>{t("aiReportDetails.vsClass.participants")}</b> {d.participants ?? "-"}</span>
          {d.percentile != null && (
            <span><b>{t("aiReportDetails.scoreOverview.percentile")}</b> {Math.round(d.percentile)}%</span>
          )}
        </div>
      </div>
      {bins.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={bins} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={48} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => [v, t("aiReportDetails.rich.standing.students")]} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {bins.map((b) => <Cell key={b.label} fill={b.mine ? C.primary : C.primarySoft} />)}
              <LabelList dataKey="count" position="top" fontSize={10} fill={C.muted}
                formatter={(v: number) => (v > 0 ? v : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <p className="text-xs text-muted-foreground mt-2">{t("aiReportDetails.rich.standing.legend")}</p>
    </SectionCard>
  );
}

export function SectionMarksCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  if (d.sections.length < 2) return null;
  const withClass = d.has_class && d.sections.some((s) => s.class_average != null);
  return (
    <SectionCard title={t("aiReportDetails.rich.sections.title")}
      caption={withClass ? t("aiReportDetails.rich.sections.caption") : t("aiReportDetails.rich.sections.captionNoClass")}>
      <div className="space-y-4">
        {d.sections.map((s) => {
          const mine = Math.max(0, Math.min(100, pct(s.score, s.max)));
          const avg = s.class_average != null ? Math.max(0, Math.min(100, pct(s.class_average, s.max))) : null;
          return (
            <div key={s.id} className="space-y-1">
              <div className="flex justify-between gap-3 text-sm">
                <span className="font-medium">{s.name}</span>
                <span className={cn("font-mono font-bold", accuracyText(pct(s.score, s.max)))}>{num(s.score)}/{num(s.max)}</span>
              </div>
              {/* Bar length and the class tick position are data values, so they are inline styles. */}
              <div className="relative h-2.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${mine}%` }} />
                {withClass && avg != null && (
                  <div className="absolute -top-1 h-4 w-0.5 rounded bg-foreground" style={{ left: `${avg}%` }} />
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                {withClass && s.class_average != null && <span>{t("aiReportDetails.rich.sections.avg", { value: num1(s.class_average) })}</span>}
                {withClass && s.class_top != null && <span>{t("aiReportDetails.rich.sections.top", { value: num(s.class_top) })}</span>}
                {s.time_seconds > 0 && <span>{t("aiReportDetails.rich.sections.time", { value: mmss(s.time_seconds) })}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

export function SectionTimeCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  if (d.sections.length < 2 || d.sections.reduce((a, s) => a + s.time_seconds, 0) <= 0) return null;
  const withClass = d.sections.every((s) => s.class_average_time_seconds != null);
  const data = d.sections.map((s) => ({
    name: s.name,
    you: Math.round((s.time_seconds / 60) * 10) / 10,
    klass: withClass ? Math.round(((s.class_average_time_seconds ?? 0) / 60) * 10) / 10 : undefined,
  }));
  const caption = [
    withClass ? t("aiReportDetails.rich.time.caption") : t("aiReportDetails.rich.time.captionNoClass"),
    d.duration_limit_minutes != null ? t("aiReportDetails.rich.time.allowed", { value: d.duration_limit_minutes }) : null,
  ].filter(Boolean).join(" ");
  return (
    <SectionCard title={t("aiReportDetails.rich.time.title")} caption={caption}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 16, right: 8, left: -16, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 10 }} unit="m" />
          <Tooltip formatter={(v: number) => `${v} ${t("aiReportDetails.rich.time.minutes")}`} />
          <Legend wrapperStyle={{ fontSize: 12 }}
            formatter={(value: string) => <span className="text-muted-foreground">{value}</span>} />
          <Bar dataKey="you" name={t("aiReportDetails.rich.time.you")} fill={C.primary} radius={[4, 4, 0, 0]} />
          {withClass && <Bar dataKey="klass" name={t("aiReportDetails.rich.time.class")} fill={C.primarySoft} radius={[4, 4, 0, 0]} />}
        </BarChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}

/** One box per question, coloured by the result, with the seconds spent on it. */
export function AnswerMapCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  if (d.hide_question_wise || d.questions.length === 0) return null;
  const showTime = d.questions.length <= 120;
  const isFast = (q: ReportQuestion) => q.outcome !== "SKIPPED" && q.time_seconds != null && q.time_seconds < 10;
  const anyFast = d.questions.some(isFast);
  const anyTime = d.questions.some((q) => q.time_seconds != null);
  const bySection = new Map<string, ReportQuestion[]>();
  for (const q of d.questions) bySection.set(q.section_id, [...(bySection.get(q.section_id) ?? []), q]);
  const present = (["CORRECT", "PARTIAL", "WRONG", "SKIPPED", "PENDING"] as Outcome[]).filter((o) => count(d, o) > 0);
  return (
    <SectionCard title={t("aiReportDetails.rich.answers.title")}
      caption={[
        anyTime ? t("aiReportDetails.rich.answers.caption") : t("aiReportDetails.rich.answers.captionNoTime"),
        anyFast ? t("aiReportDetails.rich.answers.fast") : null,
      ].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap gap-3 mb-4 text-xs text-muted-foreground">
        {present.map((o) => (
          <span key={o} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm", OUTCOME_BOX[o])} />
            {t(`aiReportDetails.rich.outcome.${o}`)} ({count(d, o)})
          </span>
        ))}
      </div>
      <div className="space-y-4">
        {[...bySection.values()].map((rows) => (
          <div key={rows[0]!.section_id} className="space-y-2">
            {bySection.size > 1 && <p className="text-xs font-semibold text-muted-foreground">{rows[0]!.section_name}</p>}
            <div className="flex flex-wrap gap-1.5">
              {rows.map((q) => (
                <div key={q.question_id}
                  title={`${questionTitle(d, q)} · ${t(`aiReportDetails.rich.outcome.${q.outcome}`)}`}
                  className={cn("flex size-11 flex-col items-center justify-center rounded-md text-xs font-bold leading-tight",
                    OUTCOME_BOX[q.outcome], isFast(q) && "ring-2 ring-warning-400 ring-offset-1")}>
                  <span>{q.number}</span>
                  {showTime && anyTime && (
                    <span className="text-3xs font-normal opacity-90">
                      {q.outcome === "SKIPPED" ? t("aiReportDetails.rich.answers.skip") : q.time_seconds != null ? `${q.time_seconds}s` : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Questions the class did differently ──

function QuestionBarList({ d, rows, tone, sub, right }: {
  d: AiReportWebData; rows: ReportQuestion[]; tone: "warning" | "primary";
  sub: (q: ReportQuestion) => string; right: (q: ReportQuestion) => string;
}) {
  return (
    <div className="space-y-3">
      {rows.map((q) => (
        <div key={q.question_id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {questionTitle(d, q)}{q.short_text ? ` · ${q.short_text}` : ""}
            </p>
            <p className={cn("text-xs", tone === "primary" ? "text-success-600" : "text-muted-foreground")}>{sub(q)}</p>
          </div>
          <div className="w-full shrink-0 sm:w-40">
            <Progress value={Math.max(3, q.class_correct_percent ?? 0)}
              className={cn("h-2", tone === "warning" && "bg-warning-100 [&>div]:bg-warning-500")} />
            <p className="text-3xs text-muted-foreground mt-1 sm:text-end">{right(q)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EasyMarksCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  const rows = easyMarksMissed(d);
  if (rows.length === 0) return null;
  return (
    <SectionCard title={t("aiReportDetails.rich.easy.title")} caption={t("aiReportDetails.rich.easy.caption")}>
      <QuestionBarList d={d} rows={rows} tone="warning"
        sub={(q) => q.outcome === "SKIPPED" ? t("aiReportDetails.rich.easy.skipped")
          : q.time_seconds != null ? t("aiReportDetails.rich.easy.took", { value: q.time_seconds }) : ""}
        right={(q) => t("aiReportDetails.rich.easy.classRight", { value: Math.round(q.class_correct_percent ?? 0) })} />
    </SectionCard>
  );
}

export function ExpertiseCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  const rows = expertise(d);
  if (rows.length === 0) return null;
  return (
    <SectionCard title={t("aiReportDetails.rich.expertise.title")} caption={t("aiReportDetails.rich.expertise.caption")}>
      <QuestionBarList d={d} rows={rows} tone="primary"
        sub={() => t("aiReportDetails.rich.expertise.gotIt")}
        right={(q) => t("aiReportDetails.rich.expertise.onlyClass", { value: Math.round(q.class_correct_percent ?? 0) })} />
    </SectionCard>
  );
}

export function PotentialCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  const p = d.potential;
  if (!p) return null;
  const class5 = hasClassOf5(d);
  const tiles: { label: string; from: string; to: string }[] = [
    { label: t("aiReportDetails.rich.potential.score"), from: num(d.score), to: num(p.score) },
  ];
  if (class5 && p.rank != null && d.rank != null) {
    tiles.push({ label: t("aiReportDetails.rich.potential.rank"), from: `#${d.rank}`, to: `#${p.rank}` });
  }
  if (class5 && p.percentile != null && d.percentile != null) {
    tiles.push({ label: t("aiReportDetails.rich.potential.betterThan"), from: `${Math.round(d.percentile)}%`, to: `${Math.round(p.percentile)}%` });
  }
  return (
    <SectionCard title={t("aiReportDetails.rich.potential.title")}
      caption={t("aiReportDetails.rich.potential.caption", { count: p.skipped_considered, score: num(p.score) })}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl bg-primary-50 p-3 text-center">
            <p className="text-3xs uppercase tracking-wide text-muted-foreground">{x.label}</p>
            <p className="font-mono text-xl font-bold">
              <span className="text-muted-foreground">{x.from}</span>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className="text-primary-500">{x.to}</span>
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── How the test was taken ──

export function SpeedAccuracyCard({ d, className }: { d: AiReportWebData; className?: string }) {
  const { t } = useTranslation("layoutCommonB");
  const bands = speedBands(d.questions);
  if (bands.reduce((a, b) => a + b.total, 0) < 6) return null;
  const data = bands.map((b) => ({
    ...b,
    label: t(`aiReportDetails.rich.speed.${b.key}`),
    value: Math.round(b.percent),
    note: b.total > 0 ? t("aiReportDetails.rich.speed.right", { right: b.right, total: b.total }) : "",
  }));
  return (
    <SectionCard className={className} title={t("aiReportDetails.rich.speed.title")} caption={t("aiReportDetails.rich.speed.caption")}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
          <Tooltip formatter={(v: number, _n, item: any) => [`${v}% (${item?.payload?.note ?? ""})`, ""]} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((b) => <Cell key={b.key} fill={b.total > 0 ? accuracyColor(b.value) : C.grid} />)}
            <LabelList dataKey="note" position="top" fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}

export function StaminaCard({ d, className }: { d: AiReportWebData; className?: string }) {
  const { t } = useTranslation("layoutCommonB");
  const q = quarterAccuracy(d.questions);
  if (!q) return null;
  const data = q.map((x) => ({ label: x.label, value: Math.round(x.percent) }));
  return (
    <SectionCard className={className} title={t("aiReportDetails.rich.stamina.title")} caption={t("aiReportDetails.rich.stamina.caption")}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 20, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} padding={{ left: 24, right: 24 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Line type="monotone" dataKey="value" stroke={C.primary} strokeWidth={2.5} dot={{ r: 4, fill: C.primary }}>
            <LabelList dataKey="value" position="top" fontSize={10} fill={C.muted} formatter={(v: number) => `${v}%`} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}

export function NegativeMarkingCard({ d, className }: { d: AiReportWebData; className?: string }) {
  const { t } = useTranslation("layoutCommonB");
  const n = negativeMarking(d);
  if (!n) return null;
  return (
    <SectionCard className={className} title={t("aiReportDetails.rich.negative.title")}
      caption={t("aiReportDetails.rich.negative.caption", { value: num(-n.lost) })}>
      <div className="grid grid-cols-3 gap-2">
        <Tile value={`+${num(n.earned)}`} tone="text-success-600" label={t("aiReportDetails.rich.negative.earned")} />
        <Tile value={num(n.lost)} tone="text-danger-600" label={t("aiReportDetails.rich.negative.lost")} />
        <Tile value={num(d.score)} tone="text-primary-500" label={t("aiReportDetails.rich.negative.net")} />
      </div>
      {n.withoutGuesses != null && (
        <p className="text-sm text-muted-foreground mt-3">
          {t("aiReportDetails.rich.negative.withoutGuesses", { count: n.guesses, value: num(n.withoutGuesses) })}
        </p>
      )}
    </SectionCard>
  );
}

/**
 * The AI's confidence insight is shown here only when the AI confidence card is not
 * (older reports carry the insight without the confidence numbers); never twice.
 */
export function QuadrantCard({ d, showInsight, className }: { d: AiReportWebData; showInsight: boolean; className?: string }) {
  const { t } = useTranslation("layoutCommonB");
  const q = confidenceQuadrant(d.questions);
  if (!q) return null;
  const cells = [
    { n: q.quickRight, title: "confident", cls: "bg-success-500 text-white" },
    { n: q.slowRight, title: "worked", cls: "bg-success-50 text-success-700" },
    { n: q.quickWrong, title: "rushed", cls: "bg-danger-500 text-white" },
    { n: q.slowWrong, title: "stuck", cls: "bg-danger-50 text-danger-700" },
  ];
  const insight = showInsight ? d.ai?.confidence_estimation?.insight : null;
  return (
    <SectionCard className={className} title={t("aiReportDetails.rich.quadrant.title")}
      caption={q.classRef ? t("aiReportDetails.rich.quadrant.captionClass") : t("aiReportDetails.rich.quadrant.captionSelf")}>
      <div className="grid grid-cols-2 gap-2">
        {cells.map((c) => (
          <div key={c.title} className={cn("rounded-xl p-3 text-center", c.cls)}>
            <p className="font-mono text-2xl font-bold">{c.n}</p>
            <p className="text-sm font-semibold">{t(`aiReportDetails.rich.quadrant.${c.title}`)}</p>
            <p className="text-3xs opacity-90">{t(`aiReportDetails.rich.quadrant.${c.title}Sub`)}</p>
          </div>
        ))}
      </div>
      {insight && <p className="text-sm text-muted-foreground mt-3">{insight}</p>}
    </SectionCard>
  );
}

export function ProgressCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  if (d.history.length < 2) return null;
  const data = d.history.map((h, i) => ({
    label: i === d.history.length - 1 ? t("aiReportDetails.rich.progress.thisTest") : h.assessment_name || `#${i + 1}`,
    value: Math.round(h.percent),
  }));
  return (
    <SectionCard title={t("aiReportDetails.rich.progress.title")}
      caption={t("aiReportDetails.rich.progress.caption", { count: d.history.length })}>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 20, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} padding={{ left: 32, right: 32 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Line type="monotone" dataKey="value" stroke={C.primary} strokeWidth={2.5} dot={{ r: 4, fill: C.primary }}>
            <LabelList dataKey="value" position="top" fontSize={10} fill={C.muted} formatter={(v: number) => `${v}%`} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </SectionCard>
  );
}

// ── Question by question ──

const FIRST_QUESTIONS = 10;

function QuestionCard({ d, q }: { d: AiReportWebData; q: ReportQuestion }) {
  const { t } = useTranslation("layoutCommonB");
  const showYours = !d.hide_your_answer;
  const showRight = q.correct_answer != null;
  const meta = [
    t("aiReportDetails.rich.qbq.marks", { marks: `${q.marks > 0 ? "+" : ""}${num(q.marks)}`, max: num(q.max) }),
    q.time_seconds != null && q.time_seconds > 0 ? t("aiReportDetails.rich.qbq.seconds", { value: q.time_seconds }) : null,
    d.has_class && q.class_correct_percent != null ? t("aiReportDetails.rich.qbq.classRight", { value: Math.round(q.class_correct_percent) }) : null,
    d.has_class && q.class_average_time_seconds != null ? t("aiReportDetails.rich.qbq.classAvgTime", { value: Math.round(q.class_average_time_seconds) }) : null,
  ].filter(Boolean);
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold">Q{q.number}</span>
          {q.type && <span className="text-xs text-muted-foreground">{q.type}</span>}
        </div>
        <Badge variant="outline" className={OUTCOME_BADGE[q.outcome]}>{t(`aiReportDetails.rich.outcome.${q.outcome}`)}</Badge>
      </div>
      {q.text && <p className="text-sm whitespace-pre-line">{q.text}</p>}
      {(showYours || showRight) && (
        <div className={cn("grid gap-2", showYours && showRight && "sm:grid-cols-2")}>
          {showYours && (
            <div className={cn("rounded-lg border p-3 text-sm",
              q.outcome === "CORRECT" ? "border-success-200 bg-success-50"
                : q.outcome === "WRONG" ? "border-danger-200 bg-danger-50" : "border-border bg-muted/60")}>
              <p className="text-3xs font-bold uppercase tracking-wide text-muted-foreground mb-1">{t("aiReportDetails.rich.qbq.yourAnswer")}</p>
              <p className="whitespace-pre-line">
                {q.your_answer ?? (q.outcome === "SKIPPED" ? t("aiReportDetails.rich.qbq.notAttempted") : "-")}
              </p>
            </div>
          )}
          {showRight && (
            <div className="rounded-lg border border-success-200 p-3 text-sm">
              <p className="text-3xs font-bold uppercase tracking-wide text-success-700 mb-1">{t("aiReportDetails.rich.qbq.rightAnswer")}</p>
              <p className="whitespace-pre-line">{q.correct_answer}</p>
            </div>
          )}
        </div>
      )}
      {q.feedback && (
        <p className="text-sm text-muted-foreground"><b>{t("aiReportDetails.rich.qbq.feedback")}</b> {q.feedback}</p>
      )}
      {q.criteria.length > 0 && (
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p className="font-semibold">{t("aiReportDetails.rich.qbq.howMarked")}</p>
          {q.criteria.map((c, i) => (
            <p key={i}>{c.name} ({t("aiReportDetails.rich.qbq.criterionMarks", { marks: c.marks })}){c.reason ? `: ${c.reason}` : ""}</p>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{meta.join("  ·  ")}</p>
      {q.explanation && (
        <div className="rounded-lg bg-primary-50 p-3 text-sm">
          <b className="text-primary-500">{t("aiReportDetails.rich.qbq.explanation")}</b> <span className="whitespace-pre-line">{q.explanation}</span>
        </div>
      )}
    </div>
  );
}

export function QuestionByQuestionCard({ d }: { d: AiReportWebData }) {
  const { t } = useTranslation("layoutCommonB");
  const [all, setAll] = useState(false);
  if (d.hide_question_wise || d.questions.length === 0) return null;
  const shown = all ? d.questions : d.questions.slice(0, FIRST_QUESTIONS);
  return (
    <SectionCard title={t("aiReportDetails.rich.qbq.title")}
      caption={t("aiReportDetails.rich.qbq.caption", { count: d.questions.length })}>
      <div className="space-y-3">
        {shown.map((q, i) => (
          <div key={`${q.section_id}:${q.question_id}`} className="space-y-3">
            {d.sections.length > 1 && (i === 0 || shown[i - 1]!.section_id !== q.section_id) && (
              <p className="pt-1 text-sm font-semibold text-muted-foreground">{q.section_name}</p>
            )}
            <QuestionCard d={d} q={q} />
          </div>
        ))}
      </div>
      {d.questions.length > FIRST_QUESTIONS && (
        <div className="flex justify-center mt-4">
          <Button variant="outline" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? t("aiReportDetails.rich.qbq.showLess") : t("aiReportDetails.rich.qbq.showAll", { count: d.questions.length })}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
