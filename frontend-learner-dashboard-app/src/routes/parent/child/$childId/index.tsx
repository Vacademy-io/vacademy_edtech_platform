import { useEffect } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { CheckCircle, Receipt, Exam, VideoCamera } from "@phosphor-icons/react";
import { LoadingState, ErrorState } from "@/components/design-system/states";
import heroGreeting from "@/assets/cleaner-play/hero-greeting.webp";
import { ParentModuleIcon } from "@/components/parent/ParentModuleIcon";
import { ParentChildShell } from "../-components/ParentChildShell";
import { ParentQuickSearch } from "../-components/ParentQuickSearch";
import { AttentionCard } from "../-components/AttentionCard";
import { ParentInfoRow } from "../-components/ParentInfoRow";
import { getParentFirstName } from "../-lib/parent-identity";
import { buildParentTourSteps } from "../-components/ParentHelpButton";
import { runParentTour } from "../-lib/parent-tour";
import { MODULE_TILES } from "../-components/module-tiles";
import { useChildAttendance, useChildOverview } from "../-hooks/use-parent-child";
import { buildAttentionItems } from "../-lib/summaries";
import { computeAttendanceStats } from "@/services/attendance/useAttendanceStats";
import type { ScheduleItem } from "@/services/attendance/getAttendanceReport";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/parent/child/$childId/")({
  component: ChildHome,
});

function ChildHome() {
  const { childId } = useParams({ from: "/parent/child/$childId/" });
  const { t } = useTranslation("parent");
  const navigate = useNavigate();
  const { data: overview, isLoading, isError, refetch } = useChildOverview(childId);
  // Same day-wise attendance as the Attendance tab, so the landing headline and the
  // tab never disagree (the backend overview % is session-wise and would differ).
  const { data: attendance } = useChildAttendance(childId);

  // First-visit guided tour (once). Small settle delay so anchors are painted.
  useEffect(() => {
    if (isLoading || isError || !overview) return;
    const KEY = "parent-tour-seen";
    if (localStorage.getItem(KEY)) return;
    const timer = setTimeout(() => {
      localStorage.setItem(KEY, "1");
      runParentTour(buildParentTourSteps(t));
    }, 700);
    return () => clearTimeout(timer);
  }, [isLoading, isError, overview, t]);

  if (isLoading) return <LoadingState variant="card" />;
  if (isError || !overview) {
    return (
      <ParentChildShell childId={childId} backTo="picker">
        <ErrorState
          title={t("common.errorTitle")}
          message={t("common.errorBody")}
          onRetry={() => refetch()}
        />
      </ParentChildShell>
    );
  }

  const childName = overview.child?.fullName || t("common.yourChild");
  const parentFirstName = getParentFirstName();
  const available = new Set(overview.availableModules ?? []);
  const tiles = MODULE_TILES.filter((tile) => available.has(tile.key));
  const attention = buildAttentionItems(overview, t);

  const goTo = (segment: string) =>
    navigate({ to: `/parent/child/${childId}/${segment}` as never });

  const pendingFees = overview.pendingInvoiceCount ?? 0;

  // Day-wise % from the shared schedules; fall back to the overview number only
  // until the attendance query resolves.
  const attSchedules = (attendance?.schedules ?? []) as unknown as ScheduleItem[];
  const attStats = computeAttendanceStats(attSchedules);
  const attendancePercent =
    attSchedules.length > 0
      ? attStats.attendancePercentage
      : overview.attendancePercent != null
        ? Math.round(overview.attendancePercent)
        : null;
  const attendanceTone =
    attendancePercent == null
      ? "neutral"
      : attendancePercent >= 75
        ? "good"
        : attendancePercent >= 60
          ? "watch"
          : "action";

  return (
    <ParentChildShell childId={childId} backTo="picker">
      <div className="flex flex-col gap-5">
        {/* ── Hero band: 3D child character + parent greeting ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="rounded-3xl bg-gradient-to-br from-primary-100 to-secondary-50 p-5 shadow-sm sm:p-6"
        >
          <div className="flex items-center gap-4">
            <motion.img
              src={heroGreeting}
              alt=""
              aria-hidden
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, y: [0, -6, 0] }}
              transition={{
                scale: { delay: 0.1, type: "spring", stiffness: 180, damping: 12 },
                opacity: { delay: 0.1, duration: 0.3 },
                y: { repeat: Infinity, repeatType: "loop", duration: 3.5, ease: "easeInOut" },
              }}
              className="h-24 w-auto shrink-0 sm:h-28"
            />
            <div className="min-w-0">
              {parentFirstName ? (
                <p className="text-caption font-semibold text-primary-500">
                  {t("home.hiParent", { name: parentFirstName })}
                </p>
              ) : null}
              <h1 className="text-h1 font-semibold text-foreground">
                {t("home.greeting", { name: childName })}
              </h1>
            </div>
          </div>
        </motion.div>

        <ParentQuickSearch childId={childId} availableKeys={available} />

        {/* ── Section shortcuts: felt-clay icons, no boxes (CuePilot-style) ── */}
        <div data-tour="parent-tiles" className="grid grid-cols-3 gap-2 xs:gap-3">
          {tiles.map((tile, idx) => (
            <motion.button
              key={tile.key}
              data-tour={tile.tour}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.3, ease: "easeOut" }}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.94 }}
              onClick={() => goTo(tile.segment)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl p-2",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
              )}
            >
              <div className="size-16">
                <ParentModuleIcon name={tile.icon} />
              </div>
              <span className="text-center text-caption font-medium leading-tight text-foreground">
                {t(tile.labelKey)}
              </span>
            </motion.button>
          ))}
        </div>

        {/* ── At-a-glance info rows ── */}
        <div className="flex flex-col gap-stack">
          <ParentInfoRow
            icon={CheckCircle}
            title={t("info.attendance")}
            tone={attendanceTone}
            value={attendancePercent != null ? `${attendancePercent}%` : undefined}
            onClick={() => goTo("attendance")}
          />

          {overview.assessmentCount != null && available.has("assessments") ? (
            <ParentInfoRow
              icon={Exam}
              title={t("info.tests")}
              tone="neutral"
              value={t("tiles.sub.tests", { count: overview.assessmentCount })}
              onClick={() => goTo("assessments")}
            />
          ) : null}

          {overview.upcomingSessionCount != null && available.has("liveSessions") ? (
            <ParentInfoRow
              icon={VideoCamera}
              title={t("info.liveClasses")}
              tone={overview.upcomingSessionCount > 0 ? "watch" : "neutral"}
              value={t("tiles.sub.upcoming", { count: overview.upcomingSessionCount })}
              onClick={() => goTo("live-classes")}
            />
          ) : null}

          <AttentionCard childId={childId} items={attention} />

          <ParentInfoRow
            icon={Receipt}
            title={t("info.fees")}
            tone={pendingFees > 0 ? "action" : "good"}
            value={
              pendingFees > 0
                ? t("tiles.sub.feesDue", { count: pendingFees })
                : t("tiles.sub.feesPaid")
            }
            onClick={() => goTo("payments")}
          />
        </div>
      </div>
    </ParentChildShell>
  );
}
