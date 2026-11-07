import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CaretDown, CaretRight, ClipboardText, SpinnerGap } from "@phosphor-icons/react";
import { ModernCard } from "@/components/design-system/modern-card";
import { StatusChip, type StatusType } from "@/components/design-system/status-chips";
import { CustomFieldValueDisplay } from "@/components/common/custom-fields/CustomFieldValueDisplay";
import {
  getSubmittedSteps,
  type OnboardingStepStatus,
  type OnboardingSubmittedStepDTO,
} from "../-services/onboarding-services";

const STATUS_META: Record<OnboardingStepStatus, { labelKey: string; status: StatusType }> = {
  PENDING: { labelKey: "pending", status: "INFO" },
  IN_PROGRESS: { labelKey: "inProgress", status: "WARNING" },
  COMPLETED: { labelKey: "completed", status: "SUCCESS" },
  SKIPPED: { labelKey: "skipped", status: "INFO" },
};

/**
 * "My onboarding details" — everything the learner filled in during onboarding, kept available
 * after the flow is over.
 *
 * Until now those answers were reachable only by opening the progress list and clicking each
 * completed step one at a time, which is fine mid-flow ("what did I just submit?") but not for
 * looking something up months later. This lays the whole thing out at once, in flow order.
 *
 * Steps are collapsible and everything starts expanded: the common case is a handful of steps
 * with a few fields each, where hiding them behind a click would just add work.
 *
 * Only steps that HAVE fields to show are rendered — a step whose fields are all admin-only
 * comes back with an empty list (the server filters by the caller's own role), and an empty
 * heading tells the learner nothing.
 */
export const OnboardingDetailsCard = ({ instanceId }: { instanceId: string }) => {
  const { t } = useTranslation("userProfileExtra");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ONBOARDING_SUBMITTED_STEPS", instanceId],
    queryFn: () => getSubmittedSteps(instanceId),
    enabled: Boolean(instanceId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <ModernCard variant="outlined" padding="md" rounded="lg">
        <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
          <SpinnerGap className="size-4 animate-spin" />
          {t("onboardingDetails.loading")}
        </div>
      </ModernCard>
    );
  }

  // Silent on failure rather than showing an error block: this is a supplementary summary
  // sitting under the step list, not the page's reason for existing.
  if (isError) return null;

  const stepsWithAnswers = (data ?? []).filter((s) => (s.fields?.length ?? 0) > 0);
  if (stepsWithAnswers.length === 0) return null;

  return (
    <ModernCard variant="outlined" padding="md" rounded="lg" className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardText className="size-4 text-neutral-400" />
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          {t("onboardingDetails.title")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {stepsWithAnswers.map((step) => (
          <StepBlock
            key={step.step_instance_id}
            step={step}
            collapsed={collapsed[step.step_instance_id] ?? false}
            onToggle={() =>
              setCollapsed((prev) => ({
                ...prev,
                [step.step_instance_id]: !(prev[step.step_instance_id] ?? false),
              }))
            }
          />
        ))}
      </div>
    </ModernCard>
  );
};

const StepBlock = ({
  step,
  collapsed,
  onToggle,
}: {
  step: OnboardingSubmittedStepDTO;
  collapsed: boolean;
  onToggle: () => void;
}) => {
  const { t } = useTranslation("userProfileExtra");
  const meta = STATUS_META[step.status] ?? STATUS_META.PENDING;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          {collapsed ? (
            <CaretRight className="size-3.5 text-neutral-400" />
          ) : (
            <CaretDown className="size-3.5 text-neutral-400" />
          )}
          {step.step_name}
        </span>
        <StatusChip
          text={t(`onboardingProgress.status.${meta.labelKey}`)}
          textSize="text-2xs"
          status={meta.status}
        />
      </button>

      {!collapsed && (
        <dl className="flex flex-col divide-y divide-neutral-100 border-t border-neutral-100 px-3">
          {step.fields
            .slice()
            .sort((a, b) => (a.field_order ?? 0) - (b.field_order ?? 0))
            .map((field) => (
              <div key={field.institute_custom_field_id} className="flex flex-col gap-0.5 py-2">
                <dt className="text-xs font-medium text-neutral-500">
                  {field.field_name ?? t("onboardingStepForm.defaultFieldLabel")}
                </dt>
                <dd className="text-sm text-neutral-800">
                  {/* Renders a file value as an openable file rather than a raw upload URL. */}
                  <CustomFieldValueDisplay value={field.value} fieldType={field.field_type} />
                </dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
};
