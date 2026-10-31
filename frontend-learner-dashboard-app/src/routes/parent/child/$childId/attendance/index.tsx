import type { ReactNode } from "react";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CalendarCheck, Fire, Clock } from "@phosphor-icons/react";
import { ModuleScaffold } from "../../-components/ModuleScaffold";
import { ParentStatusChip } from "../../-components/ParentStatusChip";
import type { ParentStatusTone } from "../../-components/ParentStatusChip";
import { computeAttendanceStats, notStartedYet } from "@/services/attendance/useAttendanceStats";
import type { ScheduleItem } from "@/services/attendance/getAttendanceReport";
import { cn } from "@/lib/utils";
import { useChildAttendance, useChildOverview } from "../../-hooks/use-parent-child";

export const Route = createFileRoute("/parent/child/$childId/attendance/")({
  component: AttendanceScreen,
});

function statusToneLabel(status: unknown, t: TFunction): { tone: ParentStatusTone; label: string } {
  const s = String(status ?? "").toUpperCase();
  if (s === "PRESENT") return { tone: "good", label: t("attendance.present") };
  if (s === "ABSENT") return { tone: "action", label: t("attendance.absent") };
  if (s === "LATE") return { tone: "watch", label: t("attendance.late") };
  return { tone: "neutral", label: t("attendance.notMarked") };
}

function formatDate(meetingDate: unknown): string {
  const raw = typeof meetingDate === "string" ? meetingDate : "";
  if (!raw) return "";
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function formatMinutes(total: number): string {
  if (total <= 0) return "0m";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function AttendanceScreen() {
  const { childId } = useParams({ from: "/parent/child/$childId/attendance/" });
  const { t } = useTranslation("parent");
  const overview = useChildOverview(childId);
  const { data, isLoading, isError, refetch } = useChildAttendance(childId);

  const childName = overview.data?.child?.fullName || t("common.yourChild");
  const schedules = Array.isArray(data?.schedules) ? (data!.schedules as Record<string, unknown>[]) : [];

  // Real time the child actually spent in class — the provider-reported attended
  // minutes summed across every class (not points, not a proxy).
  const totalMinutes = schedules.reduce(
    (sum, s) => sum + (Number(s.durationMinutes) || 0),
    0,
  );

  // Use the SAME day-wise computation as the student app (multiple classes in a
  // day = one day; PRESENT if any class that day was attended), so the parent %
  // matches what the learner sees — not the backend's session-wise number.
  const stats = computeAttendanceStats(schedules as unknown as ScheduleItem[]);
  const percent = schedules.length > 0 ? stats.attendancePercentage : null;
  const total = stats.totalClassDays;
  const pctOf = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  // Most recent classes first.
  const recent = [...schedules].sort((a, b) =>
    String(b.meetingDate ?? "").localeCompare(String(a.meetingDate ?? "")),
  );

  const summaryTone: ParentStatusTone =
    percent === null ? "neutral" : percent >= 75 ? "good" : percent >= 60 ? "watch" : "action";
  const summaryLabelKey =
    percent !== null && percent >= 75
      ? "attendance.statusGood"
      : percent !== null && percent < 60
        ? "attendance.statusLow"
        : "attendance.statusOkay";

  return (
    <ModuleScaffold
      childId={childId}
      title={t("tiles.attendance")}
      icon="attendance"
      summary={
        percent === null
          ? t("attendance.noData", { name: childName })
          : t("attendance.summary", { name: childName, percent })
      }
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={percent === null && schedules.length === 0}
      emptyIcon={CalendarCheck}
      emptyTitle={t("attendance.emptyTitle")}
      emptyBody={t("attendance.emptyBody")}
    >
      <div className="flex flex-col gap-5">
        {/* Headline: big % + how many days attended */}
        {percent !== null ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-card px-5 py-4 shadow-sm">
            <div className="flex flex-col">
              <span className="text-h1 font-semibold text-foreground">{percent}%</span>
              <span className="text-caption text-muted-foreground">
                {t("attendance.daysAttended", { present: stats.presentDays, total })}
              </span>
            </div>
            <ParentStatusChip tone={summaryTone} label={t(summaryLabelKey)} />
          </div>
        ) : null}

        {/* Real time spent in class (summed provider-reported attended minutes) */}
        {totalMinutes > 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-card px-5 py-4 shadow-sm">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-info-50">
              <Clock weight="fill" className="size-6 text-info-600" aria-hidden />
            </span>
            <div className="flex flex-col">
              <span className="text-h2 font-bold text-foreground">{formatMinutes(totalMinutes)}</span>
              <span className="text-caption text-muted-foreground">{t("attendance.timeInClassTitle")}</span>
            </div>
          </div>
        ) : null}

        {/* Breakdown graph: present / absent / unmarked days */}
        {total > 0 ? (
          <div className="flex flex-col gap-stack rounded-2xl bg-card px-5 py-4 shadow-sm">
            <h2 className="text-body font-semibold text-foreground">{t("attendance.graphTitle")}</h2>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {stats.presentDays > 0 ? (
                <div className="bg-success-500" style={{ width: `${pctOf(stats.presentDays)}%` }} />
              ) : null}
              {stats.absentDays > 0 ? (
                <div className="bg-danger-500" style={{ width: `${pctOf(stats.absentDays)}%` }} />
              ) : null}
              {stats.unmarkedDays > 0 ? (
                <div className="bg-warning-400" style={{ width: `${pctOf(stats.unmarkedDays)}%` }} />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <LegendDot className="bg-success-500" label={t("attendance.presentDays")} value={stats.presentDays} />
              <LegendDot className="bg-danger-500" label={t("attendance.absentDays")} value={stats.absentDays} />
              {stats.unmarkedDays > 0 ? (
                <LegendDot className="bg-warning-400" label={t("attendance.unmarkedDays")} value={stats.unmarkedDays} />
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Insight stats: streak + counts */}
        {total > 0 ? (
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              icon={<Fire weight="fill" className="size-5 text-warning-500" aria-hidden />}
              value={stats.currentStreak}
              label={t("attendance.streak")}
            />
            <StatTile value={stats.presentDays} label={t("attendance.presentDays")} tone="text-success-600" />
            <StatTile value={stats.absentDays} label={t("attendance.absentDays")} tone="text-danger-600" />
          </div>
        ) : null}

        {/* Recent classes — each with a present / absent chip */}
        {recent.length > 0 ? (
          <div className="flex flex-col gap-stack">
            <h2 className="text-body font-semibold text-foreground">{t("attendance.recentTitle")}</h2>
            <ul className="flex flex-col gap-2">
              {recent.map((s, i) => {
                // A class that has not started yet is "Upcoming" — never
                // "Not marked"/"Absent" (the backend coalesces it to UNMARKED).
                const upcoming =
                  String(s.attendanceStatus ?? "UNMARKED").toUpperCase() === "UNMARKED" &&
                  notStartedYet(s as unknown as ScheduleItem, new Date());
                const info = upcoming
                  ? { tone: "neutral" as ParentStatusTone, label: t("attendance.upcomingChip") }
                  : statusToneLabel(s.attendanceStatus, t);
                const title = String(s.sessionTitle ?? s.subject ?? t("liveClasses.session"));
                const dateLabel = formatDate(s.meetingDate);
                const mins = Number(s.durationMinutes) || 0;
                return (
                  <li
                    key={String(s.scheduleId ?? i)}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-body font-medium text-foreground">{title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
                        {dateLabel ? <span>{dateLabel}</span> : null}
                        {mins > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Clock weight="fill" className="size-3 text-info-600" aria-hidden />
                            {t("attendance.attendedFor", { duration: formatMinutes(mins) })}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <ParentStatusChip tone={info.tone} label={info.label} />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </ModuleScaffold>
  );
}

function LegendDot({ className, label, value }: { className: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
      <span className={cn("size-2 rounded-full", className)} aria-hidden />
      {label} · <span className="font-semibold text-foreground">{value}</span>
    </span>
  );
}

function StatTile({
  icon,
  value,
  label,
  tone,
}: {
  icon?: ReactNode;
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl bg-card px-3 py-4 text-center shadow-sm">
      {icon}
      <span className={cn("text-h2 font-bold tabular-nums text-foreground", tone)}>{value}</span>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}
