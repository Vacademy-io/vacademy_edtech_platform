import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SpinnerGap } from "@phosphor-icons/react";
import { CustomFieldValueDisplay } from "@/components/common/custom-fields/CustomFieldValueDisplay";
import {
  getResolvedStepFields,
  type OnboardingStepInstanceDTO,
} from "../-services/onboarding-services";

interface SubmittedFormDialogProps {
  stepInstance: OnboardingStepInstanceDTO | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only view of what was actually submitted for a COMPLETED FORM step —
 * previously there was no way for a learner to see this at all (the form
 * only ever rendered for the CURRENT, still-actionable step). Reuses the
 * same role-resolved fields endpoint the active form uses, since it already
 * returns each field's value regardless of the step's status.
 */
export const SubmittedFormDialog = ({ stepInstance, onOpenChange }: SubmittedFormDialogProps) => {
  const { t } = useTranslation("userProfileExtra");
  const { data: fields, isLoading, isError } = useQuery({
    queryKey: ["ONBOARDING_SUBMITTED_FIELDS", stepInstance?.id],
    queryFn: () => getResolvedStepFields(stepInstance!.id),
    enabled: Boolean(stepInstance?.id),
    staleTime: 60 * 1000,
  });

  return (
    <Dialog open={Boolean(stepInstance)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-neutral-700">
            {stepInstance?.step_name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
            <SpinnerGap className="size-4 animate-spin" />
            {t("submittedFormDialog.loading")}
          </div>
        ) : isError ? (
          <p className="py-4 text-sm text-danger-600">
            {t("submittedFormDialog.error")}
          </p>
        ) : !fields || fields.length === 0 ? (
          <p className="py-4 text-sm text-neutral-500">
            {t("submittedFormDialog.empty")}
          </p>
        ) : (
          <dl className="flex flex-col divide-y divide-neutral-100">
            {fields
              .slice()
              .sort((a, b) => (a.field_order ?? 0) - (b.field_order ?? 0))
              .map((field) => (
                <div key={field.institute_custom_field_id} className="flex flex-col gap-0.5 py-2">
                  <dt className="text-xs font-medium text-neutral-500">
                    {field.field_name ?? t("onboardingStepForm.defaultFieldLabel")}
                  </dt>
                  <dd className="text-sm text-neutral-800">
                    {/* By type, not as a string: a file field's value is an upload URL. */}
                    <CustomFieldValueDisplay value={field.value} fieldType={field.field_type} />
                  </dd>
                </div>
              ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
};
