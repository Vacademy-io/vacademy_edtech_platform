import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Exam, FileText, CaretRight } from "@phosphor-icons/react";
import { ModuleScaffold } from "../../-components/ModuleScaffold";
import {
  useChildAssessments,
  useChildReports,
  useChildOverview,
} from "../../-hooks/use-parent-child";

export const Route = createFileRoute("/parent/child/$childId/assessments/")({
  component: AssessmentsScreen,
});

// The assessment history serializes snake_case (@JsonNaming) — total_marks,
// class_average, assessment_id. name/subject/date/marks/percentage stay as-is.
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function marksLabel(a: Record<string, unknown>): string | null {
  const marks = num(a.marks);
  const total = num(a.total_marks);
  if (marks == null) return null;
  return total != null ? `${marks}/${total}` : String(marks);
}

function metaLine(a: Record<string, unknown>): string {
  const subject = typeof a.subject === "string" ? a.subject : "";
  const rawDate = typeof a.date === "string" ? a.date : "";
  let dateLabel = "";
  if (rawDate) {
    const d = new Date(rawDate);
    dateLabel = Number.isNaN(d.getTime())
      ? rawDate
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  return [subject, dateLabel].filter(Boolean).join(" · ");
}

function AssessmentsScreen() {
  const { childId } = useParams({ from: "/parent/child/$childId/assessments/" });
  const { t } = useTranslation("parent");
  const navigate = useNavigate();
  const overview = useChildOverview(childId);
  const { data: history, isLoading, isError, refetch } = useChildAssessments(childId);
  const { data: reports } = useChildReports(childId);

  const childName = overview.data?.child?.fullName || t("common.yourChild");
  const assessmentsArr = Array.isArray((history as Record<string, unknown> | null)?.assessments)
    ? ((history as Record<string, unknown>).assessments as Record<string, unknown>[])
    : [];
  const count = assessmentsArr.length;

  return (
    <ModuleScaffold
      childId={childId}
      title={t("tiles.assessments")}
      icon="assessments"
      summary={t("assessments.summary", { name: childName, count })}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isEmpty={count === 0 && (reports?.length ?? 0) === 0}
      emptyIcon={Exam}
      emptyTitle={t("assessments.emptyTitle")}
      emptyBody={t("assessments.emptyBody")}
    >
      <div className="flex flex-col gap-5">
        {assessmentsArr.length > 0 ? (
          <ul className="flex flex-col gap-stack">
            {assessmentsArr.map((a, i) => {
              const meta = metaLine(a);
              const marks = marksLabel(a);
              const pct = num(a.percentage);
              const grade = typeof a.grade === "string" ? a.grade : "";
              const classAvg = num(a.class_average);
              const rank = num(a.rank);
              const percentile = num(a.percentile);
              const accuracy = num(a.accuracy);
              const statParts: string[] = [];
              if (rank != null) statParts.push(t("assessments.rank", { value: rank }));
              if (percentile != null) statParts.push(t("assessments.percentile", { value: Math.round(percentile) }));
              if (accuracy != null) statParts.push(t("assessments.accuracy", { value: Math.round(accuracy) }));
              const stats = statParts.join(" · ");
              return (
                <li
                  key={String(a.assessment_id ?? a.assessmentId ?? i)}
                  className="flex items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 shadow-sm"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-body font-medium text-foreground">
                      {String(a.name ?? t("assessments.test"))}
                    </span>
                    {meta ? <span className="text-caption text-muted-foreground">{meta}</span> : null}
                    {classAvg != null ? (
                      <span className="text-caption text-muted-foreground">
                        {t("assessments.classAvg", { value: Math.round(classAvg) })}
                      </span>
                    ) : null}
                    {stats ? <span className="text-caption text-muted-foreground">{stats}</span> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {marks ? (
                      <span className="text-body font-bold tabular-nums text-foreground">{marks}</span>
                    ) : null}
                    {pct != null ? (
                      <span className="text-caption font-semibold text-primary-500">{Math.round(pct)}%</span>
                    ) : null}
                    {grade ? (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-semibold text-primary-500">
                        {grade}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {/* Staff-generated detailed report cards, if any exist */}
        {(reports?.length ?? 0) > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-body font-semibold text-foreground">{t("assessments.fullReports")}</h2>
            <ul className="flex flex-col gap-2">
              {reports?.map((r) => (
                <li key={r.processId}>
                  <button
                    onClick={() =>
                      navigate({ to: `/parent/child/${childId}/reports/${r.processId}` as never })
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-card shadow-sm px-4 py-3 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                  >
                    <span className="flex items-center gap-2 text-body text-foreground">
                      <FileText weight="duotone" className="size-5 text-primary-400" aria-hidden />
                      {r.name || t("assessments.report")}
                    </span>
                    <CaretRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ModuleScaffold>
  );
}
