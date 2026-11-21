import { createFileRoute, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChartLineUp } from "@phosphor-icons/react";
import { Progress } from "@/components/ui/progress";
import { LoadingState } from "@/components/design-system/states";
import { ModuleScaffold } from "../../-components/ModuleScaffold";
import { useChildSubjectProgress, useChildren } from "../../-hooks/use-parent-child";

export const Route = createFileRoute("/parent/child/$childId/progress/")({
  component: ProgressScreen,
});

// The backend serializes this report in snake_case (@JsonProperty) — the same
// shape the learner dashboard reads: subject_name + module_completion_percentage.
function avgCompletion(subject: Record<string, unknown>): number {
  const modules = Array.isArray(subject.modules) ? (subject.modules as Record<string, unknown>[]) : [];
  const vals = modules
    .map((m) => (typeof m.module_completion_percentage === "number" ? m.module_completion_percentage : null))
    .filter((v): v is number => v !== null);
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * One course loads on its own query, so the screen renders course-by-course as
 * each arrives instead of blocking on a single slow all-courses request (each
 * subject-progress query is a heavy activity-log aggregation). The course name
 * shows immediately (from the enrolment); its subjects stream in after.
 */
function CourseProgressSection({
  childId,
  packageSessionId,
  courseName,
}: {
  childId: string;
  packageSessionId: string;
  courseName?: string;
}) {
  const { t } = useTranslation("parent");
  const { data, isLoading } = useChildSubjectProgress(childId, packageSessionId);
  // Tolerate BOTH response shapes so progress works before and after the backend
  // redeploy: the new per-course wrapper `[{ courseName, subjects[] }]`, and the
  // older flat `subject[]` the currently-deployed BFF still returns.
  const arr = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const first = arr[0] as Record<string, unknown> | undefined;
  const wrapped = !!first && Array.isArray(first.subjects);
  const subjects = wrapped ? (first!.subjects as Record<string, unknown>[]) : arr;
  const label = courseName || String((wrapped ? first!.courseName : undefined) ?? "");

  return (
    <div className="flex flex-col gap-stack">
      {label ? <h2 className="text-body font-semibold text-foreground">{label}</h2> : null}
      {isLoading ? (
        <LoadingState variant="list" />
      ) : subjects.length === 0 ? (
        <p className="rounded-xl bg-card px-4 py-3 text-caption text-muted-foreground shadow-sm">
          {t("progress.noCourseData")}
        </p>
      ) : (
        <ul className="flex flex-col gap-stack">
          {subjects.map((s, i) => {
            const pct = avgCompletion(s);
            return (
              <li key={String(s.subject_id ?? i)} className="rounded-xl bg-card px-4 py-3 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-body font-medium text-foreground">
                    {String(s.subject_name ?? t("progress.subject"))}
                  </span>
                  <span className="text-caption font-semibold text-primary-500">{pct}%</span>
                </div>
                <Progress value={pct} className="h-2" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProgressScreen() {
  const { childId } = useParams({ from: "/parent/child/$childId/progress/" });
  const { t } = useTranslation("parent");
  // The child's enrolled courses come from the (cached, lightweight) picker list —
  // NOT a heavy progress query. Each course then fetches its own progress.
  const { data: children, isLoading, isError, refetch } = useChildren();

  const child = children?.find((c) => c.childUserId === childId);
  const childName = child?.fullName || t("common.yourChild");
  const enrollments = (child?.enrollments ?? []).filter((e) => e.packageSessionId);

  return (
    <ModuleScaffold
      childId={childId}
      title={t("tiles.progress")}
      icon="progress"
      summary={t("progress.summaryGeneric", { name: childName })}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={!isLoading && enrollments.length === 0}
      emptyIcon={ChartLineUp}
      emptyTitle={t("progress.emptyTitle")}
      emptyBody={t("progress.emptyBody")}
    >
      <div className="flex flex-col gap-section">
        {enrollments.map((e) => (
          <CourseProgressSection
            key={e.packageSessionId}
            childId={childId}
            packageSessionId={e.packageSessionId}
            courseName={e.batchName}
          />
        ))}
      </div>
    </ModuleScaffold>
  );
}
