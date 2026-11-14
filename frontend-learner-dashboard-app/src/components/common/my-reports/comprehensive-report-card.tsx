import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, Trophy, DownloadSimple } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { downloadReportPdf } from "@/services/student-reports-api";
import type {
  V2ReportData,
  V2HeadlineMetric,
  V2Strength,
  V2Achievement,
  V2Recommendation,
} from "@/services/student-reports-api";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

// ── Helpers ───────────────────────────────────────────────────────────────────

// A subject label is only worth showing if it's a real subject — never a placeholder catch-all.
// The backend omits these now; this guards historical reports too.
const SUBJECT_PLACEHOLDERS = new Set([
  "unknown",
  "other",
  "others",
  "n/a",
  "na",
  "general",
  "misc",
  "miscellaneous",
  "-",
]);
function isRealSubject(subject?: string | null): boolean {
  const s = subject?.trim().toLowerCase();
  return !!s && !SUBJECT_PLACEHOLDERS.has(s);
}

function formatDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function getSubjectBarClass(sentiment?: string, score?: number): string {
  if (sentiment === "good") return "bg-success-500";
  if (sentiment === "attention" || sentiment === "bad") return "bg-danger-500";
  if (sentiment === "neutral") return "bg-primary-400";
  if (score !== undefined) {
    if (score >= 70) return "bg-success-500";
    if (score >= 50) return "bg-warning-500";
    return "bg-danger-500";
  }
  return "bg-primary-400";
}

function getWeeklyBarClass(pct: number): string {
  if (pct >= 90) return "bg-success-500";
  if (pct >= 70) return "bg-warning-500";
  return "bg-danger-500";
}

// ── V2 Section heading ────────────────────────────────────────────────────────

function V2SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-5 rounded-full bg-primary-500 shrink-0" />
      <h2 className="text-base font-semibold text-neutral-800">{children}</h2>
    </div>
  );
}

// ── V2 KPI Tiles ──────────────────────────────────────────────────────────────

function V2KpiTile({ metric }: { metric: V2HeadlineMetric }) {
  const displayValue =
    metric.unit ? `${metric.value}${metric.unit}` : String(metric.value);

  let trendEl: React.ReactNode = null;
  if (metric.trend) {
    const trendClass =
      metric.trend === "up"
        ? "text-success-600"
        : metric.trend === "down"
          ? "text-danger-600"
          : "text-neutral-500";
    const arrow =
      metric.trend === "up" ? "▲" : metric.trend === "down" ? "▼" : "—";
    trendEl = (
      <p className={cn("text-xs font-semibold mt-1", trendClass)}>
        {arrow} {metric.change ?? ""}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-neutral-500">{metric.label}</p>
      <p className="text-2xl font-bold text-neutral-800 mt-1 leading-none">{displayValue}</p>
      {trendEl}
    </div>
  );
}

// ── V2 Attendance Card ────────────────────────────────────────────────────────

function V2AttendanceCard({ att }: { att: NonNullable<V2ReportData["attendance"]> }) {
  const { t } = useTranslation("layoutCommonB");
  const pct = att.overall_percentage;
  const circumference = 339.3;
  const ringStrokeClass =
    pct >= 75 ? "stroke-success-500" : pct >= 50 ? "stroke-warning-500" : "stroke-danger-500";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.attendance.title")}</V2SectionHeading>

      <div className="flex gap-6 items-center flex-wrap mb-5">
        <div className="relative w-32 h-32 shrink-0">
          <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
            <circle cx="64" cy="64" r="54" fill="none" strokeWidth="10" className="stroke-neutral-100" />
            <circle
              cx="64" cy="64" r="54" fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
              className={ringStrokeClass}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-neutral-800">{pct}%</span>
            <span className="text-xs text-neutral-500">{t("comprehensiveReportCard.attendance.presentOfTotal", { present: att.present, total: att.total_sessions })}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 flex-1 min-w-48 text-center">
          <div>
            <span className="block text-xl font-bold text-success-600">{att.present}</span>
            <span className="text-xs text-neutral-500">{t("comprehensiveReportCard.attendance.present")}</span>
          </div>
          <div>
            <span className="block text-xl font-bold text-danger-600">{att.absent}</span>
            <span className="text-xs text-neutral-500">{t("comprehensiveReportCard.attendance.absent")}</span>
          </div>
          <div>
            <span className="block text-xl font-bold text-warning-600">{att.late}</span>
            <span className="text-xs text-neutral-500">{t("comprehensiveReportCard.attendance.late")}</span>
          </div>
        </div>
      </div>

      {att.weekly && att.weekly.length > 0 && (
        <>
          <p className="text-xs text-neutral-500 mb-2">{t("comprehensiveReportCard.attendance.weeklyTrend")}</p>
          <div className="space-y-2">
            {att.weekly.map((w) => (
              <div key={w.week} className="grid items-center gap-3" style={{ gridTemplateColumns: "120px 1fr 48px" }} /* design-lint-ignore: fixed grid column widths, no Tailwind equivalent */>
                <span className="text-sm text-neutral-700 font-medium">{w.week}</span>
                <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", getWeeklyBarClass(w.percentage))}
                    style={{ width: `${w.percentage}%` }} /* design-lint-ignore: dynamic bar width */
                  />
                </div>
                <span className="text-xs text-neutral-500 text-end">{w.percentage}%</span>
              </div>
            ))}
          </div>
        </>
      )}
      {att.note && (
        <p className="text-xs text-neutral-500 mt-3 italic">{att.note}</p>
      )}
    </div>
  );
}

// ── V2 Academic Performance Card ──────────────────────────────────────────────

function V2AcademicsCard({ acs }: { acs: NonNullable<V2ReportData["academics"]> }) {
  const { t } = useTranslation("layoutCommonB");
  const subject = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
  const assessments = acs.assessments ?? [];
  // Never surface a placeholder subject ("Unknown"/"Other"/…). Backend omits these; filter
  // defensively for historical reports too.
  const subjectPerf = (acs.subject_performance ?? []).filter((sp) => isRealSubject(sp.subject));
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.academics.title")}</V2SectionHeading>

      <p className="text-sm text-neutral-500 mb-4 -mt-2">
        {t("comprehensiveReportCard.academics.average")} <span className="font-semibold text-neutral-800">{acs.average_percentage}%</span>{" "}
        {t("comprehensiveReportCard.academics.vsClassAverage", { percent: acs.class_average_percentage })}
        {acs.best_subject && <> &middot; {t("comprehensiveReportCard.academics.best")} <span className="text-success-600 font-medium">{acs.best_subject}</span></>}
        {acs.weakest_subject && <> &middot; {t("comprehensiveReportCard.academics.needsWork")} <span className="text-danger-600 font-medium">{acs.weakest_subject}</span></>}
      </p>

      {assessments.length > 0 && (
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-neutral-500">
                <th className="pb-2 text-start text-xs font-semibold uppercase tracking-wide">{t("comprehensiveReportCard.academics.table.assessment")}</th>
                <th className="pb-2 text-start text-xs font-semibold uppercase tracking-wide">{subject}</th>
                <th className="pb-2 text-end text-xs font-semibold uppercase tracking-wide">{t("comprehensiveReportCard.academics.table.score")}</th>
                <th className="pb-2 text-end text-xs font-semibold uppercase tracking-wide">{t("comprehensiveReportCard.academics.table.rank")}</th>
                <th className="pb-2 text-start text-xs font-semibold uppercase tracking-wide">{t("comprehensiveReportCard.academics.table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {assessments.map((a, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2.5">
                    <p className="font-medium text-neutral-800">{a.name}</p>
                    <p className="text-xs text-neutral-500">{formatDate(a.date)}</p>
                  </td>
                  <td className="py-2.5 text-neutral-600">{isRealSubject(a.subject) ? a.subject : "—"}</td>
                  <td className="py-2.5 text-end font-mono text-neutral-800">
                    {a.marks}/{a.total_marks} · {a.percentage}%
                  </td>
                  <td className="py-2.5 text-end text-neutral-500">
                    {a.rank != null ? a.rank : "-"}
                  </td>
                  <td className="py-2.5">
                    <span className={cn(
                      "inline-block px-2 py-0.5 rounded-full text-xs font-semibold",
                      a.status === "NEEDS_WORK"
                        ? "bg-danger-50 text-danger-700"
                        : a.status === "PASS"
                          ? "bg-success-50 text-success-700"
                          : "bg-neutral-100 text-neutral-600",
                    )}>
                      {a.status === "NEEDS_WORK" ? t("comprehensiveReportCard.academics.table.needsWorkBadge") : a.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subjectPerf.length > 0 && (
        <>
          <p className="text-xs text-neutral-500 mb-3">{t("comprehensiveReportCard.academics.subjectPerformanceVsClass", { subject })}</p>
          <div className="space-y-2.5">
            {subjectPerf.map((sp) => (
              <div key={sp.subject} className="grid items-center gap-3" style={{ gridTemplateColumns: "100px 1fr 100px" }} /* design-lint-ignore: fixed grid column widths, no Tailwind equivalent */>
                <span className="text-sm font-medium text-neutral-800">{sp.subject}</span>
                <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", getSubjectBarClass(sp.sentiment, sp.score_percentage))}
                    style={{ width: `${sp.score_percentage}%` }} /* design-lint-ignore: dynamic bar width */
                  />
                </div>
                <span className="text-xs text-neutral-500 text-end">
                  {sp.score_percentage}% · cls {sp.class_average}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── V2 Marks by Subject ────────────────────────────────────────────────────────

function V2SubjectMarksCard({ sm }: { sm: NonNullable<V2ReportData["subject_marks"]> }) {
  const { t } = useTranslation("layoutCommonB");
  const subject = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
  // Never surface a placeholder subject donut ("Other"/"Unknown"/…).
  const subjects = (sm.subjects ?? []).filter((s) => isRealSubject(s.subject));
  if (subjects.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.subjectMarks.title", { subject })}</V2SectionHeading>
      <p className="text-sm text-neutral-500 mb-4 -mt-2">
        {t("comprehensiveReportCard.subjectMarks.caption")}
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {subjects.map((subj) => {
          const pct = subj.percentage ?? 0;
          const ringStrokeClass =
            pct >= 75 ? "stroke-success-500" : pct >= 50 ? "stroke-warning-500" : "stroke-danger-500";
          const circumference = 169.6;
          return (
            <div
              key={subj.subject}
              className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-3"
            >
              <div className="relative w-16 h-16 shrink-0">
                <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
                  <circle cx="32" cy="32" r="27" fill="none" strokeWidth="6" className="stroke-neutral-100" />
                  <circle
                    cx="32" cy="32" r="27" fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
                    className={ringStrokeClass}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold text-neutral-800">{pct}%</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-neutral-800 truncate max-w-24">{subj.subject}</p>
                <p className="text-xs text-neutral-500">
                  {subj.marks_obtained}/{subj.total_marks}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── V2 Strengths + Areas to Improve ──────────────────────────────────────────

function V2StrengthsCard({
  strengths,
  areasToImprove,
}: {
  strengths: V2Strength[];
  areasToImprove: V2Strength[];
}) {
  const { t } = useTranslation("layoutCommonB");
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      {strengths.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <V2SectionHeading>{t("comprehensiveReportCard.strengths.strengthsTitle")}</V2SectionHeading>
          <div className="space-y-3">
            {strengths.map((s) => (
              <div key={s.topic} className="flex items-center gap-3">
                <span className="text-sm text-neutral-700 w-40 shrink-0">{s.topic}</span>
                <div className="flex-1 h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success-500"
                    style={{ width: `${s.confidence}%` }} /* design-lint-ignore: dynamic bar width */
                  />
                </div>
                <span className="text-sm font-bold text-success-600 w-8 text-end">{s.confidence}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {areasToImprove.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <V2SectionHeading>{t("comprehensiveReportCard.strengths.areasToImproveTitle")}</V2SectionHeading>
          <div className="space-y-3">
            {areasToImprove.map((s) => (
              <div key={s.topic} className="flex items-center gap-3">
                <span className="text-sm text-neutral-700 w-40 shrink-0">{s.topic}</span>
                <div className="flex-1 h-2.5 rounded-full bg-neutral-100 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      s.confidence < 50 ? "bg-danger-500" : "bg-warning-500",
                    )}
                    style={{ width: `${s.confidence}%` }} /* design-lint-ignore: dynamic bar width */
                  />
                </div>
                <span className={cn(
                  "text-sm font-bold w-8 text-end",
                  s.confidence < 50 ? "text-danger-600" : "text-warning-600",
                )}>
                  {s.confidence}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── V2 Study Habits Card ──────────────────────────────────────────────────────

function V2StudyHabitsCard({ sh }: { sh: NonNullable<V2ReportData["study_habits"]> }) {
  const { t } = useTranslation("layoutCommonB");
  const dailyStudyMinutes = sh.daily_study_minutes ?? [];
  const maxMinutes = dailyStudyMinutes.length > 0 ? Math.max(...dailyStudyMinutes.map((d) => d.minutes), 1) : 1;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.studyHabits.title")}</V2SectionHeading>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl border border-neutral-200 p-3">
          <p className="text-xs text-neutral-500">{t("comprehensiveReportCard.studyHabits.activeDays")}</p>
          <p className="text-2xl font-bold text-neutral-800 mt-1">
            {sh.active_days}
            <span className="text-sm text-neutral-500">/{sh.total_days}</span>
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-3">
          <p className="text-xs text-neutral-500">{t("comprehensiveReportCard.studyHabits.longestStreak")}</p>
          <p className="text-2xl font-bold text-neutral-800 mt-1">
            {sh.longest_streak_days}
            <span className="text-sm text-neutral-500"> {t("comprehensiveReportCard.studyHabits.days")}</span>
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-3">
          <p className="text-xs text-neutral-500">{t("comprehensiveReportCard.studyHabits.focusScore")}</p>
          <p className="text-2xl font-bold text-neutral-800 mt-1">
            {sh.focus_score != null ? `${sh.focus_score}%` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 p-3">
          <p className="text-xs text-neutral-500">{t("comprehensiveReportCard.studyHabits.mostActive")}</p>
          <p className="text-xl font-bold text-neutral-800 mt-1">{sh.most_active_time}</p>
        </div>
      </div>

      {dailyStudyMinutes.length > 0 && (
        <>
          <p className="text-xs text-neutral-500 mb-2">{t("comprehensiveReportCard.studyHabits.dailyStudyTime", { count: dailyStudyMinutes.length })}</p>
          <div className="flex items-end gap-px border-b border-neutral-200" style={{ height: 120 }} /* design-lint-ignore: pixel chart height, no Tailwind arbitrary-value in token scale */>
            {/* design-lint-ignore: dynamic bar chart height container */}
            {dailyStudyMinutes.map((d, i) => {
              const pct = maxMinutes > 0 ? Math.round((d.minutes / maxMinutes) * 100) : 0;
              return (
                <div key={i} className="flex-1 bg-primary-50 rounded-t-sm relative" style={{ height: "100%" }} /* design-lint-ignore: 100% fill needed for bar chart container, no Tailwind equivalent */>
                  {/* design-lint-ignore: dynamic bar height */}
                  <div
                    className="absolute bottom-0 start-0 end-0 bg-primary-400 rounded-t-sm"
                    style={{ height: `${pct}%` }} /* design-lint-ignore: dynamic bar height */
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-neutral-400 mt-1">
            <span>{t("comprehensiveReportCard.studyHabits.dayN", { day: 1 })}</span>
            <span>{t("comprehensiveReportCard.studyHabits.dayN", { day: Math.ceil(dailyStudyMinutes.length / 2) })}</span>
            <span>{t("comprehensiveReportCard.studyHabits.dayN", { day: dailyStudyMinutes.length })}</span>
          </div>
        </>
      )}

      <p className="text-sm text-neutral-500 mt-4">
        {t("comprehensiveReportCard.studyHabits.contentExplored")}{" "}
        <span className="font-semibold text-neutral-800">{sh.content_engagement?.videos_watched}</span> {t("comprehensiveReportCard.studyHabits.videos")} &middot;{" "}
        <span className="font-semibold text-neutral-800">{sh.content_engagement?.documents_read}</span> {t("comprehensiveReportCard.studyHabits.documents")} &middot;{" "}
        <span className="font-semibold text-neutral-800">{sh.content_engagement?.quizzes_attempted}</span> {t("comprehensiveReportCard.studyHabits.quizzes")}
      </p>
    </div>
  );
}

// ── V2 Course Progress Card ───────────────────────────────────────────────────

function V2CourseProgressCard({ cp }: { cp: NonNullable<V2ReportData["course_progress"]> }) {
  const { t } = useTranslation("layoutCommonB");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const subjects = cp.subjects ?? [];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.courseProgress.title", { course, percent: cp.overall_completion_percentage })}</V2SectionHeading>

      <div className="space-y-2.5">
        {subjects.map((s) => (
          <div key={s.subject} className="grid items-center gap-3" style={{ gridTemplateColumns: "100px 1fr 80px" }} /* design-lint-ignore: fixed grid column widths, no Tailwind equivalent */>
            <span className="text-sm font-medium text-neutral-800">{s.subject}</span>
            <div className="h-2.5 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className={cn("h-full rounded-full", getSubjectBarClass(undefined, s.completion_percentage))}
                style={{ width: `${s.completion_percentage}%` }} /* design-lint-ignore: dynamic bar width */
              />
            </div>
            <span className="text-xs text-neutral-500 text-end">
              {s.completion_percentage}% · {s.time_hours}h
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── V2 Live Classes + Assignments (two-up) ────────────────────────────────────

function V2LiveClassesAndAssignments({
  lc,
  asgn,
}: {
  lc: NonNullable<V2ReportData["live_classes"]>;
  asgn: NonNullable<V2ReportData["assignments"]>;
}) {
  const { t } = useTranslation("layoutCommonB");
  const liveClasses = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <V2SectionHeading>{liveClasses}</V2SectionHeading>
        <div className="divide-y divide-dashed divide-neutral-200">
          {[
            { label: t("comprehensiveReportCard.liveClasses.total"), value: lc.total ?? 0, cls: undefined },
            { label: t("comprehensiveReportCard.liveClasses.attended"), value: lc.attended ?? 0, cls: "text-success-600" },
            { label: t("comprehensiveReportCard.liveClasses.missed"), value: lc.missed ?? 0, cls: "text-danger-600" },
            { label: t("comprehensiveReportCard.liveClasses.notMarked"), value: lc.unmarked ?? 0, cls: "text-neutral-500" },
            { label: t("comprehensiveReportCard.liveClasses.attendance"), value: lc.attendance_percentage != null ? `${lc.attendance_percentage}%` : "—", cls: undefined },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex justify-between items-center py-1.5">
              <span className="text-sm text-neutral-600">{label}</span>
              <span className={cn("text-sm font-bold font-mono", cls ?? "text-neutral-800")}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <V2SectionHeading>{t("comprehensiveReportCard.assignments.title")}</V2SectionHeading>
        <div className="divide-y divide-dashed divide-neutral-200">
          {[
            { label: t("comprehensiveReportCard.assignments.assigned"), value: asgn.assigned ?? "—", cls: undefined },
            { label: t("comprehensiveReportCard.assignments.submitted"), value: asgn.submitted ?? 0, cls: "text-success-600" },
            { label: t("comprehensiveReportCard.assignments.onTime"), value: asgn.on_time ?? "—", cls: undefined },
            { label: t("comprehensiveReportCard.assignments.late"), value: asgn.late ?? 0, cls: "text-warning-600" },
            { label: t("comprehensiveReportCard.assignments.pending"), value: asgn.pending ?? "—", cls: "text-danger-600" },
            { label: t("comprehensiveReportCard.assignments.avgScore"), value: asgn.avg_score_percentage != null ? `${asgn.avg_score_percentage}%` : "—", cls: undefined },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex justify-between items-center py-1.5">
              <span className="text-sm text-neutral-600">{label}</span>
              <span className={cn("text-sm font-bold font-mono", cls ?? "text-neutral-800")}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── V2 Achievements Card ──────────────────────────────────────────────────────

function V2AchievementsCard({ achievements }: { achievements: V2Achievement[] }) {
  const { t } = useTranslation("layoutCommonB");
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.achievements.title")}</V2SectionHeading>
      <div className="flex flex-wrap gap-3">
        {achievements.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-success-50 text-success-700 text-sm font-semibold border border-success-200"
          >
            <Trophy size={16} className="text-success-600 shrink-0" />
            {a.title}
            {a.issued_at && (
              <span className="text-xs font-normal text-success-600 ms-1">
                ({formatDate(a.issued_at)})
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── V2 AI Insights ────────────────────────────────────────────────────────────

function V2WhatWeNoticed({ insights }: { insights: string[] }) {
  const { t } = useTranslation("layoutCommonB");
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.aiInsights.whatWeNoticed")}</V2SectionHeading>
      <ul className="space-y-2 ps-1">
        {insights.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function V2RecommendedNextSteps({ recommendations }: { recommendations: V2Recommendation[] }) {
  const { t } = useTranslation("layoutCommonB");
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
      <V2SectionHeading>{t("comprehensiveReportCard.aiInsights.recommendedNextSteps")}</V2SectionHeading>
      <div className="space-y-0.5">
        {recommendations.map((rec, i) => {
          const prClass =
            rec.priority === "HIGH"
              ? "bg-danger-50 text-danger-700"
              : rec.priority === "MEDIUM"
                ? "bg-warning-50 text-warning-700"
                : "bg-info-50 text-info-700";
          return (
            <div key={i} className="flex gap-3 py-3 border-b border-neutral-100 last:border-0">
              <span className={cn("shrink-0 self-start text-xs font-bold px-2 py-1 rounded", prClass)}>
                {rec.priority}
              </span>
              <div>
                <p className="text-sm font-semibold text-neutral-800">{rec.area}</p>
                <p className="text-sm text-neutral-500">{rec.suggestion}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ComprehensiveReportCard (V2 full renderer) ────────────────────────────────

export interface ComprehensiveReportCardProps {
  data: V2ReportData;
  /** When provided, a "Download PDF" button is shown in the header. */
  processId?: string;
}

/**
 * Full v2 comprehensive student report card.
 * Render only when `report_version === 'v2'` and `comprehensive_report` is present.
 */
export function ComprehensiveReportCard({ data, processId }: ComprehensiveReportCardProps) {
  const { t } = useTranslation("layoutCommonB");
  const liveClasses = getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
  const { meta, student, institute, period, overview } = data;
  const [downloading, setDownloading] = useState(false);
  const headlineMetrics = overview.headline_metrics ?? [];

  // Institute accent color is user-supplied — dynamic value used only in header gradient.
  const accentColor = institute.theme_color ?? "#2563eb"; // design-lint-ignore: user-supplied institute theme color

  const handleDownload = async () => {
    if (!processId || downloading) return;
    setDownloading(true);
    try {
      await downloadReportPdf(processId);
    } catch (e) {
      console.error("Failed to download report PDF", e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">

        {/* ── 1. HEADER ── */}
        <div
          className="rounded-2xl p-6 mb-5 text-white"
          style={{ background: `linear-gradient(135deg, ${accentColor}, color-mix(in srgb, ${accentColor} 60%, #000))` }} /* design-lint-ignore: user-supplied institute theme color */
        >
          <div className="flex flex-wrap justify-between items-start gap-4">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shrink-0"
                style={{ background: "rgba(255,255,255,0.18)" }} /* design-lint-ignore: header icon bg overlay */
              >
                {institute.logo_url ? (
                  <img src={institute.logo_url} alt={institute.name} className="w-full h-full object-contain rounded-xl" />
                ) : (
                  <span>{institute.name.slice(0, 3).toUpperCase()}</span>
                )}
              </div>
              <div>
                <p className="text-sm opacity-90">{institute.name}</p>
                <h1 className="text-xl font-bold mt-0.5">{t("comprehensiveReportCard.header.title")}</h1>
                <p className="text-xs opacity-80 mt-0.5">{t("comprehensiveReportCard.header.periodGenerated", { period: period.label, date: formatDate(meta.generated_at) })}</p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div
                className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold border border-white/30"
                style={{ background: "rgba(255,255,255,0.16)" }} /* design-lint-ignore: header badge overlay */
              >
                {t("comprehensiveReportCard.header.statusGrade", { status: overview.overall_status, grade: overview.overall_grade })}
              </div>
              {processId && (
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-white/30 disabled:opacity-60"
                  style={{ background: "rgba(255,255,255,0.16)" }} /* design-lint-ignore: header button overlay */
                >
                  <DownloadSimple size={16} />
                  {downloading ? t("comprehensiveReportCard.header.preparing") : t("comprehensiveReportCard.header.downloadPdf")}
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-3 mt-5 pt-4 border-t border-white/20 text-sm">
            <div>
              <span className="opacity-75 text-xs">{t("comprehensiveReportCard.header.student")}</span>
              <p className="font-bold text-base">{student.name}</p>
            </div>
            <div>
              <span className="opacity-75 text-xs">{t("comprehensiveReportCard.header.classBatch")}</span>
              <p className="font-bold">{student.class}</p>
            </div>
            <div>
              <span className="opacity-75 text-xs">{t("comprehensiveReportCard.header.enrollmentNo")}</span>
              <p className="font-bold">{student.enrollment_no}</p>
            </div>
            <div>
              <span className="opacity-75 text-xs">{t("comprehensiveReportCard.header.rollNo")}</span>
              <p className="font-bold">{student.roll_no}</p>
            </div>
          </div>
        </div>

        {/* ── 2. KPI TILES ── */}
        {headlineMetrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            {headlineMetrics.map((m) => (
              <V2KpiTile key={m.key} metric={m} />
            ))}
          </div>
        )}

        {/* ── 3. PARENT SUMMARY ── */}
        {data.parent_summary && (
          <div className="rounded-xl border border-primary-200 border-s-4 border-s-primary-500 bg-primary-50 p-5 mb-5 space-y-2">
            <p className="font-semibold text-neutral-800 flex items-center gap-2">
              <Info size={16} className="text-primary-500 shrink-0" />
              {t("comprehensiveReportCard.parentSummary.title")}
            </p>
            <p className="text-sm text-neutral-700 leading-relaxed">{data.parent_summary}</p>
          </div>
        )}

        {/* ── 4. ATTENDANCE ── */}
        {data.attendance?.available && (
          <V2AttendanceCard att={data.attendance} />
        )}

        {/* ── 5. ACADEMICS ── */}
        {data.academics?.available && (
          <V2AcademicsCard acs={data.academics} />
        )}

        {/* ── 5b. MARKS BY SUBJECT ── */}
        {data.subject_marks?.available && (
          <V2SubjectMarksCard sm={data.subject_marks} />
        )}

        {/* ── 6. STRENGTHS + AREAS TO IMPROVE ── */}
        {((data.strengths && data.strengths.length > 0) || (data.areas_to_improve && data.areas_to_improve.length > 0)) && (
          <V2StrengthsCard
            strengths={data.strengths ?? []}
            areasToImprove={data.areas_to_improve ?? []}
          />
        )}

        {/* ── 7. STUDY HABITS ── */}
        {data.study_habits?.available && (
          <V2StudyHabitsCard sh={data.study_habits} />
        )}

        {/* ── 8. COURSE PROGRESS ── */}
        {data.course_progress?.available && (
          <V2CourseProgressCard cp={data.course_progress} />
        )}

        {/* ── 9. LIVE CLASSES + ASSIGNMENTS ── */}
        {data.live_classes?.available && data.assignments?.available && (
          <V2LiveClassesAndAssignments lc={data.live_classes} asgn={data.assignments} />
        )}
        {data.live_classes?.available && !data.assignments?.available && (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
            <V2SectionHeading>{liveClasses}</V2SectionHeading>
            <div className="divide-y divide-dashed divide-neutral-200">
              {[
                { label: t("comprehensiveReportCard.liveClasses.total"), value: data.live_classes.total ?? 0, cls: undefined },
                { label: t("comprehensiveReportCard.liveClasses.attended"), value: data.live_classes.attended ?? 0, cls: "text-success-600" },
                { label: t("comprehensiveReportCard.liveClasses.missed"), value: data.live_classes.missed ?? 0, cls: "text-danger-600" },
                { label: t("comprehensiveReportCard.liveClasses.notMarked"), value: data.live_classes.unmarked ?? 0, cls: "text-neutral-500" },
                { label: t("comprehensiveReportCard.liveClasses.attendance"), value: data.live_classes.attendance_percentage != null ? `${data.live_classes.attendance_percentage}%` : "—", cls: undefined },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between items-center py-1.5">
                  <span className="text-sm text-neutral-600">{label}</span>
                  <span className={cn("text-sm font-bold font-mono", cls ?? "text-neutral-800")}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {!data.live_classes?.available && data.assignments?.available && (
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm mb-4">
            <V2SectionHeading>{t("comprehensiveReportCard.assignments.title")}</V2SectionHeading>
            <div className="divide-y divide-dashed divide-neutral-200">
              {[
                { label: t("comprehensiveReportCard.assignments.assigned"), value: data.assignments.assigned ?? "—", cls: undefined },
                { label: t("comprehensiveReportCard.assignments.submitted"), value: data.assignments.submitted ?? 0, cls: "text-success-600" },
                { label: t("comprehensiveReportCard.assignments.onTime"), value: data.assignments.on_time ?? "—", cls: undefined },
                { label: t("comprehensiveReportCard.assignments.late"), value: data.assignments.late ?? 0, cls: "text-warning-600" },
                { label: t("comprehensiveReportCard.assignments.pending"), value: data.assignments.pending ?? "—", cls: "text-danger-600" },
                { label: t("comprehensiveReportCard.assignments.avgScore"), value: data.assignments.avg_score_percentage != null ? `${data.assignments.avg_score_percentage}%` : "—", cls: undefined },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between items-center py-1.5">
                  <span className="text-sm text-neutral-600">{label}</span>
                  <span className={cn("text-sm font-bold font-mono", cls ?? "text-neutral-800")}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 10. ACHIEVEMENTS ── */}
        {data.achievements && data.achievements.length > 0 && (
          <V2AchievementsCard achievements={data.achievements} />
        )}

        {/* ── 11. WHAT WE NOTICED ── */}
        {data.ai_insights?.cross_domain_insights && data.ai_insights.cross_domain_insights.length > 0 && (
          <V2WhatWeNoticed insights={data.ai_insights.cross_domain_insights} />
        )}

        {/* ── 12. RECOMMENDED NEXT STEPS ── */}
        {data.ai_insights?.recommendations && data.ai_insights.recommendations.length > 0 && (
          <V2RecommendedNextSteps recommendations={data.ai_insights.recommendations} />
        )}

        {/* ── 13. FOOTER ── */}
        <div className="text-center text-xs text-neutral-400 py-4">
          {t("comprehensiveReportCard.footer", {
            institute: institute.name,
            date: formatDate(meta.generated_at),
            period: period.label,
          })}
        </div>
      </div>
    </div>
  );
}

export default ComprehensiveReportCard;
