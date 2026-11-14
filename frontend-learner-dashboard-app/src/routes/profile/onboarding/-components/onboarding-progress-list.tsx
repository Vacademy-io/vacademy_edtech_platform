import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusChip, type StatusType } from "@/components/design-system/status-chips";
import type {
  OnboardingStepInstanceDTO,
  OnboardingStepStatus,
} from "../-services/onboarding-services";
import { SubmittedFormDialog } from "./submitted-form-dialog";

const STEP_STATUS_META: Record<
  OnboardingStepStatus,
  { labelKey: string; status: StatusType }
> = {
  PENDING: { labelKey: "pending", status: "INFO" },
  IN_PROGRESS: { labelKey: "inProgress", status: "WARNING" },
  COMPLETED: { labelKey: "completed", status: "SUCCESS" },
  SKIPPED: { labelKey: "skipped", status: "INFO" },
};

interface OnboardingProgressListProps {
  stepInstances: OnboardingStepInstanceDTO[];
}

/**
 * Simple step-name + status-chip timeline — intentionally not a fancy
 * stepper/wizard visual for v1, just enough to show where the learner is in
 * the flow. A COMPLETED FORM step is clickable — opens a read-only view of
 * what was actually submitted (previously there was no way to see this once
 * a step moved past "current").
 */
export const OnboardingProgressList = ({
  stepInstances,
}: OnboardingProgressListProps) => {
  const { t } = useTranslation("userProfileExtra");
  const [viewingStep, setViewingStep] = useState<OnboardingStepInstanceDTO | null>(null);

  if (stepInstances.length === 0) return null;

  return (
    <>
      <ol className="flex flex-col gap-2">
        {stepInstances.map((step, index) => {
          const meta = STEP_STATUS_META[step.status] ?? STEP_STATUS_META.PENDING;
          const canView = step.status === "COMPLETED" && step.step_type === "FORM";
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!canView}
                onClick={() => canView && setViewingStep(step)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left ${
                  canView ? "cursor-pointer hover:border-primary-200 hover:bg-primary-50/40" : ""
                }`}
              >
                <div className="flex items-center gap-2 text-sm text-neutral-600">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xs font-medium text-neutral-500">
                    {index + 1}
                  </span>
                  <span className="font-medium text-neutral-700">{step.step_name}</span>
                  {canView && (
                    <span className="text-2xs text-primary-500 underline-offset-2">
                      {t("onboardingProgress.view")}
                    </span>
                  )}
                </div>
                <StatusChip
                  text={t(`onboardingProgress.status.${meta.labelKey}`)}
                  textSize="text-2xs"
                  status={meta.status}
                />
              </button>
            </li>
          );
        })}
      </ol>
      <SubmittedFormDialog stepInstance={viewingStep} onOpenChange={(open) => !open && setViewingStep(null)} />
    </>
  );
};
