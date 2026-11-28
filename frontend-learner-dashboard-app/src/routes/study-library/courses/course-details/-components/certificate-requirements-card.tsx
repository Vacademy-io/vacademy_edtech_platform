import { useTranslation } from "react-i18next";
import { Certificate } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { StatusChip, type StatusType } from "@/components/design-system/status-chips";
import { Progress } from "@/components/ui/progress";
import type {
  CertificateEligibility,
  CertificateTestStatus,
} from "@/services/certificates";

interface CertificateRequirementsCardProps {
  eligibility: CertificateEligibility | null;
  /** Once a certificate exists the completion banner takes over. */
  hasCertificate: boolean;
}

const STATUS_CHIP: Record<CertificateTestStatus, StatusType> = {
  PASSED: "SUCCESS",
  COMPLETED: "SUCCESS",
  FAILED: "DANGER",
  AWAITING_RESULT: "WARNING",
  NOT_ATTEMPTED: "INFO",
};

/**
 * What the learner still has to do for a certificate earned by test marks:
 * the rule in plain words, how far along they are, and each test that counts
 * with their best result. Rendered only for courses whose rule involves marks -
 * progress-only courses keep the sidebar's "certificate on completion" note.
 */
export const CertificateRequirementsCard = ({
  eligibility,
  hasCertificate,
}: CertificateRequirementsCardProps) => {
  const { t } = useTranslation("certificateRequirements");

  if (!eligibility || !eligibility.enabled || !eligibility.score_required || hasCertificate) {
    return null;
  }

  const total = eligibility.tests_total;
  const passed = eligibility.tests_passed;
  const average = eligibility.pass_rule === "AVERAGE";
  const required = eligibility.tests_required ?? total;

  const ruleText = average
    ? t("rule.average", {
        bar: eligibility.pass_percent ?? 0,
        total,
        avg: eligibility.average_score_percent ?? 0,
      })
    : eligibility.pass_rule === "AT_LEAST"
      ? t("rule.atLeast", { required, total, passed })
      : t("rule.all", { total, passed });

  const progressValue = average
    ? Math.min(
        100,
        ((eligibility.average_score_percent ?? 0) * 100) /
          Math.max(1, eligibility.pass_percent ?? 100),
      )
    : Math.min(100, (passed * 100) / Math.max(1, required));

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-500">
          <Certificate size={20} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-subtitle font-semibold text-neutral-800 dark:text-neutral-100">
            {eligibility.eligible ? t("titleReady") : t("title")}
          </h3>
          <p className="text-body text-neutral-600 dark:text-neutral-300">
            {eligibility.eligible ? t("readyBody") : ruleText}
          </p>
          {eligibility.progress_required && !eligibility.progress_met && (
            <p className="text-caption text-neutral-500 dark:text-neutral-400">
              {t("progressAlso", {
                threshold: eligibility.threshold_percent,
                pct: Math.floor(eligibility.completion_percentage ?? 0),
              })}
            </p>
          )}
          {eligibility.tests_awaiting_result > 0 && (
            <p className="text-caption text-warning-600">
              {t("awaiting", { count: eligibility.tests_awaiting_result })}
            </p>
          )}
          {eligibility.score_blocker && (
            <p className="text-caption text-neutral-500 dark:text-neutral-400">
              {t(`blocker.${eligibility.score_blocker}`, { defaultValue: t("blocker.fallback") })}
            </p>
          )}
        </div>
      </div>

      {total > 0 && !eligibility.eligible && <Progress value={progressValue} className="h-2" />}

      {eligibility.tests.length > 0 && (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-100 dark:divide-neutral-700 dark:border-neutral-700">
          {eligibility.tests.map((test) => (
            <li
              key={test.slide_id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body text-neutral-700 dark:text-neutral-200">
                  {test.title || t("untitled")}
                </span>
                {(test.module_name || test.chapter_name) && (
                  <span className="truncate text-caption text-neutral-400">
                    {[test.module_name, test.chapter_name].filter(Boolean).join(" › ")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {test.score_percent !== null && (
                  <span
                    className={cn(
                      "text-caption",
                      test.status === "PASSED" ? "text-success-600" : "text-neutral-500",
                    )}
                  >
                    {test.pass_percent !== null
                      ? t("scoreOfPass", { pct: test.score_percent, pass: test.pass_percent })
                      : t("score", { pct: test.score_percent })}
                  </span>
                )}
                <StatusChip
                  text={t(`status.${test.status}`)}
                  textSize="text-caption"
                  status={STATUS_CHIP[test.status]}
                  showIcon={false}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-caption text-neutral-400">{t("note")}</p>
    </div>
  );
};
