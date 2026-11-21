import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface SectionData {
  section_id: string;
  section_name: string;
  student_marks: number;
  section_total_marks: number;
  section_average_marks: number;
  section_highest_marks: number;
  cut_off_marks: number | null;
  student_accuracy: number;
  class_accuracy: number;
  passed: boolean;
}

// Per-section response tally derived from the answer-review detail (when the
// attempt has per-question responses; manual attempts won't).
export interface SectionResponseCounts {
  correct: number;
  incorrect: number;
  unanswered: number;
}

interface SectionComparisonTableProps {
  sections: SectionData[];
  responseCounts?: Record<string, SectionResponseCounts> | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function SectionComparisonTable({
  sections,
  responseCounts,
}: SectionComparisonTableProps) {
  const { t } = useTranslation("testRecords");
  if (!sections || sections.length === 0) return null;

  const hasCutOff = sections.some((s) => s.cut_off_marks != null);
  const hasCounts =
    !!responseCounts && sections.some((s) => responseCounts[s.section_id]);
  const hasClassMax = sections.some((s) => s.section_highest_marks != null);

  const totals = sections.reduce(
    (acc, s) => {
      acc.marks += s.student_marks || 0;
      acc.total += s.section_total_marks || 0;
      acc.avg += s.section_average_marks || 0;
      const c = responseCounts?.[s.section_id];
      if (c) {
        acc.correct += c.correct;
        acc.incorrect += c.incorrect;
        acc.unanswered += c.unanswered;
      }
      return acc;
    },
    { marks: 0, total: 0, avg: 0, correct: 0, incorrect: 0, unanswered: 0 }
  );

  const headCell =
    "py-2 px-3 text-3xs font-semibold uppercase tracking-widest text-muted-foreground";
  const numCell = "py-2.5 px-3 text-end tabular-nums";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b-2 border-border">
            <th className={cn(headCell, "text-start")}>{t("sectionComparisonTable.section")}</th>
            {hasCounts && (
              <>
                <th className={cn(headCell, "text-end")}>{t("common.correct")}</th>
                <th className={cn(headCell, "text-end")}>{t("common.incorrect")}</th>
                <th className={cn(headCell, "text-end")}>{t("common.notAnswered")}</th>
              </>
            )}
            <th className={cn(headCell, "text-end")}>{t("sectionComparisonTable.yourMarks")}</th>
            <th className={cn(headCell, "text-end")}>{t("sectionComparisonTable.total")}</th>
            <th className={cn(headCell, "text-end")}>{t("sectionComparisonTable.classAvg")}</th>
            {hasClassMax && <th className={cn(headCell, "text-end")}>{t("sectionComparisonTable.classMax")}</th>}
            <th className={cn(headCell, "text-start")}>{t("common.accuracy")}</th>
            {hasCutOff && (
              <>
                <th className={cn(headCell, "text-end")}>{t("sectionComparisonTable.cutOff")}</th>
                <th className={cn(headCell, "text-start")}>{t("sectionComparisonTable.status")}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => {
            const accuracy =
              section.student_accuracy ??
              (section.section_total_marks > 0
                ? Math.round(
                    (section.student_marks / section.section_total_marks) * 100
                  )
                : 0);
            const counts = responseCounts?.[section.section_id];

            return (
              <tr
                key={section.section_id}
                className="border-b border-border/60 last:border-b-0"
              >
                <td className="py-2.5 px-3 font-medium text-foreground">
                  {section.section_name}
                </td>
                {hasCounts && (
                  <>
                    <td className={cn(numCell, "text-muted-foreground")}>
                      {counts ? counts.correct : "—"}
                    </td>
                    <td className={cn(numCell, "text-muted-foreground")}>
                      {counts ? counts.incorrect : "—"}
                    </td>
                    <td className={cn(numCell, "text-muted-foreground")}>
                      {counts ? counts.unanswered : "—"}
                    </td>
                  </>
                )}
                <td className={cn(numCell, "font-semibold text-foreground")}>
                  {round1(section.student_marks)}
                </td>
                <td className={cn(numCell, "text-muted-foreground")}>
                  {section.section_total_marks}
                </td>
                <td className={cn(numCell, "text-muted-foreground")}>
                  {section.section_average_marks != null
                    ? round1(section.section_average_marks)
                    : "—"}
                </td>
                {hasClassMax && (
                  <td className={cn(numCell, "text-muted-foreground")}>
                    {section.section_highest_marks != null
                      ? round1(section.section_highest_marks)
                      : "—"}
                  </td>
                )}
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <Progress value={accuracy} className="h-1.5 w-16" />
                    <span className="text-caption tabular-nums text-muted-foreground">
                      {Math.round(accuracy)}%
                    </span>
                  </div>
                </td>
                {hasCutOff && (
                  <>
                    <td className={cn(numCell, "text-muted-foreground")}>
                      {section.cut_off_marks ?? "—"}
                    </td>
                    <td className="py-2.5 px-3">
                      {section.cut_off_marks != null && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-sm px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide",
                            section.passed
                              ? "bg-success-50 text-success-700"
                              : "bg-danger-50 text-danger-700"
                          )}
                        >
                          {section.passed ? t("sectionComparisonTable.pass") : t("sectionComparisonTable.fail")}
                        </span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
          {sections.length > 1 && (
            <tr className="border-t-2 border-border">
              <td className="py-2.5 px-3 text-caption font-semibold uppercase tracking-wide text-foreground">
                {t("sectionComparisonTable.total")}
              </td>
              {hasCounts && (
                <>
                  <td className={cn(numCell, "font-semibold")}>{totals.correct}</td>
                  <td className={cn(numCell, "font-semibold")}>{totals.incorrect}</td>
                  <td className={cn(numCell, "font-semibold")}>
                    {totals.unanswered}
                  </td>
                </>
              )}
              <td className={cn(numCell, "font-semibold text-foreground")}>
                {round1(totals.marks)}
              </td>
              <td className={cn(numCell, "font-semibold")}>{totals.total}</td>
              <td className={cn(numCell, "font-semibold")}>{round1(totals.avg)}</td>
              {hasClassMax && <td className={numCell} />}
              <td className="py-2.5 px-3" />
              {hasCutOff && (
                <>
                  <td className={numCell} />
                  <td className="py-2.5 px-3" />
                </>
              )}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
