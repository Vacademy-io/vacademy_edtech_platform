/**
 * AI feedback and the per-criterion breakdown of one reviewed question, as the
 * comparison dashboard shows them. Used by the test report dialog, which only
 * showed the teacher's remark — so an AI-graded answer (long answer, CBE
 * spreadsheet / written response) lost its line-by-line marks there.
 */
import type { TFunction } from "i18next";
import { Sparkle } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Criterion = {
  criteria_name?: string;
  marks?: number | string;
  max_marks?: number | string;
  reason?: string;
};

const parseCriteria = (raw: unknown): Criterion[] => {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as Criterion[]) : [];
  } catch {
    return [];
  }
};

const formatMarks = (value: number | string | undefined) =>
  typeof value === "number" ? String(Math.round(value * 100) / 100) : (value ?? "");

export function ReviewAiFeedback({
  review,
  t,
}: {
  review: {
    ai_feedback?: string | null;
    ai_criteria_breakdown?: string | null;
    evaluation_source?: string | null;
  };
  t: TFunction;
}) {
  const criteria = parseCriteria(review.ai_criteria_breakdown);
  if (!review.ai_feedback && criteria.length === 0) return null;
  const isAi =
    review.evaluation_source === "AI" || review.evaluation_source === "AI_REVIEWED";

  return (
    <div className="space-y-3 border-t border-neutral-100 pt-2">
      <div className="flex items-center gap-2">
        <span className="text-body font-semibold text-neutral-700">
          {t("comparisonDashboard.review.feedback")}
        </span>
        {isAi && (
          <Badge variant="secondary" className="gap-1 text-3xs">
            <Sparkle size={12} weight="fill" />
            {review.evaluation_source === "AI_REVIEWED"
              ? t("comparisonDashboard.review.aiAssistedReviewed")
              : t("comparisonDashboard.review.aiAssisted")}
          </Badge>
        )}
      </div>
      {review.ai_feedback && (
        <p className="whitespace-pre-line rounded-lg bg-info-50 p-4 text-body leading-relaxed text-neutral-700">
          {review.ai_feedback}
        </p>
      )}
      {criteria.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("comparisonDashboard.review.criteria")}</TableHead>
                <TableHead>{t("comparisonDashboard.review.reason")}</TableHead>
                <TableHead className="text-end">{t("common.marks")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {criteria.map((c, i) => (
                <TableRow key={`${c.criteria_name ?? ""}-${i}`}>
                  <TableCell className="font-medium text-foreground">{c.criteria_name}</TableCell>
                  <TableCell className="text-neutral-600">{c.reason}</TableCell>
                  <TableCell className="whitespace-nowrap text-end font-semibold tabular-nums text-foreground">
                    {formatMarks(c.marks)}
                    {c.max_marks !== undefined && c.max_marks !== null && ` / ${formatMarks(c.max_marks)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
