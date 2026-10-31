import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useAttendanceStats,
  AttendancePeriod,
} from "@/services/attendance/useAttendanceStats";
import { useWeeklyAttendanceQuery } from "@/services/attendance/getWeeklyAttendance";
import {
  ChartBar,
  CaretRight,
  Check,
  X,
  Minus,
} from "@phosphor-icons/react";
import { format, isToday, parseISO } from "date-fns";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import iconAttendance from "@/assets/cleaner-play/icon-attendance.webp";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";

function getPercentageColor(pct: number) {
  if (pct >= 75) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

function getPercentageBg(pct: number) {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function DayDot({
  status,
  label,
  isCurrentDay = false,
}: {
  status: "PRESENT" | "ABSENT" | "UNMARKED" | "PENDING" | "NO_CLASS";
  label: string;
  isCurrentDay?: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const isFuturePending = status === "PENDING" && !isCurrentDay;
  const title =
    status === "PRESENT"
      ? t("attendance.dayStatus.present")
      : status === "ABSENT"
        ? t("attendance.dayStatus.absent")
        : status === "NO_CLASS"
          ? t("attendance.dayStatus.noClass")
          : isFuturePending
            ? t("liveClasses.upcomingBadge")
            : t("attendance.dayStatus.notMarked");

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        title={title}
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center transition-colors",
          status === "PRESENT" && "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300",
          status === "ABSENT" && "bg-red-100 text-red-700 ring-1 ring-red-300",
          status === "UNMARKED" && "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
          status === "PENDING" &&
            isCurrentDay &&
            "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
          isFuturePending && "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
          status === "NO_CLASS" && "bg-slate-50 text-slate-300 ring-1 ring-slate-100"
        )}
      >
        {status === "PRESENT" && <Check size={14} weight="bold" />}
        {status === "ABSENT" && <X size={14} weight="bold" />}
        {status === "UNMARKED" && <Minus size={12} weight="bold" />}
        {status === "PENDING" && isCurrentDay && (
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        )}
      </div>
      <span className="text-caption text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Attendance for the dashboard rail.
 *
 * There is exactly one streak on the dashboard (the server's learning streak,
 * shown by the hero / streak widgets), so this card no longer carries an
 * attendance streak of its own (D9): the middle tile says how many of this
 * week's class days the learner attended ("3 of 4 live classes this week").
 */
export function AttendanceWidget() {
  const { t } = useTranslation("dashboard");
  const { t: tE } = useTranslation("dashboardEngagement");
  const [period, setPeriod] = useState<AttendancePeriod>("7d");
  const { data: stats, isLoading } = useAttendanceStats({ period });
  const { data: weeklyData, isLoading: isLoadingWeekly } =
    useWeeklyAttendanceQuery();
  const navigate = useNavigate();
  const isPlay = usePlayTheme();
  const isCleanerPlay = useCleanerPlayTheme();
  // Attendance tracks a learner's live classes, so the label follows the
  // institute's renamed term for LiveSession, lowercased for mid-sentence use.
  const liveClassTerm = getTerminology(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  ).toLocaleLowerCase();
  const liveClassPluralTerm = getTerminologyPlural(
    ContentTerms.LiveSession,
    SystemTerms.LiveSession
  ).toLocaleLowerCase();
  const PERIOD_LABELS: Record<AttendancePeriod, string> = {
    "7d": t("attendance.period7d"),
    "30d": t("attendance.period30d"),
    "90d": t("attendance.period90d"),
  };

  if (isLoading && isLoadingWeekly) {
    return (
      <Card
        className={cn(
          "h-full",
          "cp-card",
          "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-border [.ui-play_&]:bg-play-success-soft/50 [.ui-play_&]:shadow-play-soft-card"
        )}
      >
        <CardContent className="p-card space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="flex gap-4">
            <Skeleton className="h-16 w-20" />
            <Skeleton className="h-16 w-20" />
            <Skeleton className="h-16 w-20" />
          </div>
          <div className="flex gap-2 justify-between">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-7 rounded-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const pct = stats?.attendancePercentage ?? 0;
  const present = stats?.presentDays ?? 0;
  const total = stats?.totalClassDays ?? 0;
  // First-run state: nothing has been marked yet (no present days and no
  // PRESENT/ABSENT day in the week), so show goal-framed copy instead of a
  // wall of zeros that reads as failure to a new learner.
  const hasMarkedDay =
    weeklyData?.days?.some(
      (d) => d.status === "PRESENT" || d.status === "ABSENT"
    ) ?? false;
  const isEmpty = total === 0 || (present === 0 && !hasMarkedDay);

  // This week (Mon-Sun): class days so far and ahead, and how many attended.
  const weekDays = weeklyData?.days ?? [];
  const weekClassDays = weekDays.filter((d) => d.status !== "NO_CLASS").length;
  const weekPresent = weekDays.filter((d) => d.status === "PRESENT").length;
  const weekSummary =
    weekClassDays > 0
      ? tE("attendanceWeek.summary", {
          present: weekPresent,
          count: weekClassDays,
          liveClass: weekClassDays === 1 ? liveClassTerm : liveClassPluralTerm,
        })
      : tE("attendanceWeek.none", { liveClass: liveClassPluralTerm });

  // The chosen period is only an upper bound: the backend also floors results at
  // the learner's enrolment date, and a studio may have no older sessions. When
  // it does, "30 Days" and "3 Months" return the identical set and the card
  // reads as broken — state the span actually covered so the numbers make sense.
  const coverageNote =
    !isEmpty && stats?.firstClassDay
      ? t("attendance.coverageNote", {
          count: total,
          liveClass: liveClassTerm,
          date: format(parseISO(stats.firstClassDay), "d MMM"),
        })
      : null;

  // No streak framing: attendance has no streak of its own any more.
  const emptyTitle = t("attendance.emptyTitleNoStreak", { liveClass: liveClassTerm });
  const emptyBody = t("attendance.emptyBodyNoStreak");
  const statGridClass = "grid-cols-3";

  const goToAttendance = () =>
    navigate({ to: "/learning-centre/attendance" });

  if (isPlay) {
    return (
      // Non-interactive shell: the period toggles and the details chevron are
      // real sibling <button>s (nesting them inside one big card-button is
      // invalid HTML and hides them from screen readers). The card body still
      // opens details on mouse click as a convenience; keyboard/SR users get
      // the dedicated chevron button.
      <div
        onClick={goToAttendance}
        className="flex h-full w-full cursor-pointer flex-col gap-4 rounded-play-card-sm border border-border bg-play-success-soft p-4 text-start shadow-play-soft-card"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={iconAttendance}
              alt=""
              aria-hidden="true"
              className="h-11 w-11 object-contain"
            />
            <p className="text-body font-black uppercase tracking-wide text-play-success-soft-ink">
              {t("attendance.title")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {!isEmpty &&
              (Object.keys(PERIOD_LABELS) as AttendancePeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPeriod(p);
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-3xs font-black uppercase tracking-wide transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-play-ink/30",
                    period === p ? "bg-white text-play-success-soft-ink shadow-sm" : "text-play-ink/50"
                  )}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goToAttendance();
              }}
              aria-label={t("attendance.viewDetailsAria")}
              className="ms-1 rounded-full p-1 text-play-ink/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-play-ink/30"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>

        {isEmpty ? (
          <div className="space-y-1.5 py-3 text-center">
            <p className="text-body font-black text-play-ink">{emptyTitle}</p>
            <p className="text-caption font-bold text-play-ink/60">{emptyBody}</p>
          </div>
        ) : (
          <>
            <div className={cn("grid gap-2", statGridClass)}>
              <div className="min-w-0 rounded-xl bg-white/70 px-2 py-2 text-center">
                <div className={cn("text-h3 font-black", getPercentageColor(pct))}>
                  {isLoading ? <Skeleton className="mx-auto h-8 w-12" /> : `${pct}%`}
                </div>
                <div className="mt-0.5 text-3xs font-bold text-play-ink/60">{t("attendance.overall")}</div>
              </div>

              <div
                className="min-w-0 rounded-xl bg-white/70 px-2 py-2 text-center"
                title={weekSummary}
              >
                <div className="text-h3 font-black tabular-nums text-play-ink">
                  {isLoadingWeekly ? (
                    <Skeleton className="mx-auto h-8 w-12" />
                  ) : (
                    <span aria-hidden>
                      {weekPresent}
                      {weekClassDays > 0 && (
                        <span className="text-body text-play-ink/60">/{weekClassDays}</span>
                      )}
                    </span>
                  )}
                </div>
                <span className="sr-only">{weekSummary}</span>
                <div className="mt-0.5 text-3xs font-bold text-play-ink/60" aria-hidden>
                  {t("attendance.thisWeek")}
                </div>
              </div>

              <div className="min-w-0 rounded-xl bg-white/70 px-2 py-2 text-center">
                <div className="text-h3 font-black text-play-ink">
                  {isLoading ? (
                    <Skeleton className="mx-auto h-8 w-16" />
                  ) : (
                    <span>
                      {present}
                      <span className="text-body text-play-ink/60">/{total}</span>
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-3xs font-bold text-play-ink/60">{t("attendance.daysPresent")}</div>
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/70">
              <div
                className={cn("h-full rounded-full transition-all duration-500", getPercentageBg(pct))}
                style={{ width: `${pct}%` }} // design-lint-ignore: dynamic attendance percentage
              />
            </div>

            {coverageNote && (
              <p className="text-3xs font-bold text-play-ink/60">{coverageNote}</p>
            )}

            {weeklyData && (
              <div className="space-y-1.5">
                {/* Always the CURRENT Mon-Sun week — it does not follow the
                    period toggle above, so it is labelled to say so. */}
                <p className="text-3xs font-bold uppercase tracking-widest text-play-ink/60">{t("attendance.thisWeek")}</p>
                <div className="flex justify-between px-1">
                  {weeklyData.days.map((day) => (
                    <DayDot
                      key={day.day}
                      status={day.status}
                      label={day.day}
                      isCurrentDay={isToday(day.date)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (isCleanerPlay) {
    return (
      // Same shell pattern as the Play branch above: non-interactive card,
      // real sibling buttons for the toggles + details chevron.
      <div
        onClick={goToAttendance}
        className="cp-card flex h-full w-full cursor-pointer flex-col gap-4 p-4 text-start"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={iconAttendance}
              alt=""
              aria-hidden="true"
              className="h-11 w-11 object-contain"
            />
            <p className="cp-heading text-body">{t("attendance.title")}</p>
          </div>
          <div className="flex items-center gap-1">
            {!isEmpty &&
              (Object.keys(PERIOD_LABELS) as AttendancePeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPeriod(p);
                  }}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-3xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    period === p ? "bg-cp-sage-tint text-cp-sage" : "cp-muted"
                  )}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goToAttendance();
              }}
              aria-label={t("attendance.viewDetailsAria")}
              className="cp-muted ms-1 rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>

        {isEmpty ? (
          <div className="space-y-1.5 py-3 text-center">
            <p className="cp-heading text-body">{emptyTitle}</p>
            <p className="cp-muted text-caption">{emptyBody}</p>
          </div>
        ) : (
          <>
            <div className={cn("grid gap-2", statGridClass)}>
              <div className="min-w-0 rounded-xl bg-cp-bg-deep px-2 py-2 text-center">
                <div className={cn("text-h3 font-bold", getPercentageColor(pct))}>
                  {isLoading ? <Skeleton className="mx-auto h-8 w-12" /> : `${pct}%`}
                </div>
                <div className="cp-muted mt-0.5 text-3xs">{t("attendance.overall")}</div>
              </div>

              <div
                className="min-w-0 rounded-xl bg-cp-bg-deep px-2 py-2 text-center"
                title={weekSummary}
              >
                <div className="cp-heading text-h3 tabular-nums">
                  {isLoadingWeekly ? (
                    <Skeleton className="mx-auto h-8 w-12" />
                  ) : (
                    <span aria-hidden>
                      {weekPresent}
                      {weekClassDays > 0 && (
                        <span className="cp-muted text-body">/{weekClassDays}</span>
                      )}
                    </span>
                  )}
                </div>
                <span className="sr-only">{weekSummary}</span>
                <div className="cp-muted mt-0.5 text-3xs" aria-hidden>
                  {t("attendance.thisWeek")}
                </div>
              </div>

              <div className="min-w-0 rounded-xl bg-cp-bg-deep px-2 py-2 text-center">
                <div className="cp-heading text-h3">
                  {isLoading ? (
                    <Skeleton className="mx-auto h-8 w-16" />
                  ) : (
                    <span>
                      {present}
                      <span className="cp-muted text-body">/{total}</span>
                    </span>
                  )}
                </div>
                <div className="cp-muted mt-0.5 text-3xs">{t("attendance.daysPresent")}</div>
              </div>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-cp-bg-deep">
              <div
                className={cn("h-full rounded-full transition-all duration-500", getPercentageBg(pct))}
                style={{ width: `${pct}%` }} // design-lint-ignore: dynamic attendance percentage
              />
            </div>

            {coverageNote && (
              <p className="cp-muted text-3xs">{coverageNote}</p>
            )}

            {weeklyData && (
              <div className="space-y-1.5">
                {/* Always the CURRENT Mon-Sun week — it does not follow the
                    period toggle above, so it is labelled to say so. */}
                <p className="cp-muted text-3xs uppercase tracking-widest">{t("attendance.thisWeek")}</p>
                <div className="flex justify-between px-1">
                  {weeklyData.days.map((day) => (
                    <DayDot
                      key={day.day}
                      status={day.status}
                      label={day.day}
                      isCurrentDay={isToday(day.date)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "attendance-widget-card group relative overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-md hover:border-primary/20 h-full",
        // Vibrant: tenant-primary wash + top rail; success/danger stay
        // reserved for the actual attendance statuses inside
        "[.ui-vibrant_&]:bg-primary-50/50 [.ui-vibrant_&]:border-primary-100",
        "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300"
      )}
      onClick={goToAttendance}
    >
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
              <ChartBar size={18} weight="duotone" />
            </div>
            <CardTitle className="text-sm font-semibold">{t("attendance.title")}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {!isEmpty &&
              (Object.keys(PERIOD_LABELS) as AttendancePeriod[]).map((p) => (
                <Button
                  key={p}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPeriod(p);
                  }}
                  className={cn(
                    "h-6 px-2 text-caption font-medium rounded-md",
                    period === p
                      ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {PERIOD_LABELS[p]}
                </Button>
              ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goToAttendance();
              }}
              aria-label={t("attendance.viewDetailsAria")}
              className="ms-1 rounded-full p-1 text-muted-foreground transition-all duration-300 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:translate-x-0.5 group-hover:text-primary"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-4">
        {isEmpty ? (
          <div className="text-center py-3 space-y-1.5">
            <p className="text-sm font-bold text-foreground">{emptyTitle}</p>
            <p className="text-xs text-muted-foreground">{emptyBody}</p>
          </div>
        ) : (
          <>
            <div className={cn("grid gap-3", statGridClass)}>
              {/* Overall % */}
              <div className="text-center">
                <div className={cn("text-2xl font-bold", getPercentageColor(pct))}>
                  {isLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    `${pct}%`
                  )}
                </div>
                <div className="text-caption text-muted-foreground mt-0.5">
                  {t("attendance.overall")}
                </div>
              </div>

              {/* This week: attended class days of this week's class days */}
              <div className="text-center" title={weekSummary}>
                <div className="text-h2 font-bold tabular-nums text-foreground">
                  {isLoadingWeekly ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    <span aria-hidden>
                      {weekPresent}
                      {weekClassDays > 0 && (
                        <span className="text-muted-foreground text-title">/{weekClassDays}</span>
                      )}
                    </span>
                  )}
                </div>
                <span className="sr-only">{weekSummary}</span>
                <div className="text-caption text-muted-foreground mt-0.5" aria-hidden>
                  {t("attendance.thisWeek")}
                </div>
              </div>

              {/* Present / Total */}
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground">
                  {isLoading ? (
                    <Skeleton className="h-8 w-16 mx-auto" />
                  ) : (
                    <span>
                      <span className="text-emerald-600">{present}</span>
                      <span className="text-muted-foreground text-lg">/{total}</span>
                    </span>
                  )}
                </div>
                <div className="text-caption text-muted-foreground mt-0.5">
                  {t("attendance.daysPresent")}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden dark:bg-slate-800">
              <div
                className={cn("h-full rounded-full transition-all duration-500", getPercentageBg(pct))}
                style={{ width: `${pct}%` }} // design-lint-ignore: dynamic width tracks the computed attendance percentage
              />
            </div>

            {/* Weekly grid */}
            {coverageNote && (
              <p className="text-3xs text-muted-foreground">{coverageNote}</p>
            )}

            {weeklyData && (
              <div className="space-y-1.5">
                {/* Always the CURRENT Mon-Sun week — it does not follow the
                    period toggle above, so it is labelled to say so. */}
                <p className="text-3xs uppercase tracking-widest text-muted-foreground">{t("attendance.thisWeek")}</p>
                <div className="flex justify-between px-1">
                  {weeklyData.days.map((day) => (
                    <DayDot
                      key={day.day}
                      status={day.status}
                      label={day.day}
                      isCurrentDay={isToday(day.date)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
