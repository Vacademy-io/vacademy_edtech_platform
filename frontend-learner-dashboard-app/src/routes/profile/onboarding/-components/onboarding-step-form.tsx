import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  ListChecks,
  Lock,
  PencilSimpleLine,
  SpinnerGap,
} from "@phosphor-icons/react";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { MyButton } from "@/components/design-system/button";
import { ModernCard } from "@/components/design-system/modern-card";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { CustomFieldValueDisplay } from "@/components/common/custom-fields/CustomFieldValueDisplay";
import { cn } from "@/lib/utils";
import {
  getResolvedStepFields,
  submitStepInstance,
  getOnboardingApiErrorMessage,
  type OnboardingStepInstanceDTO,
} from "../-services/onboarding-services";

const ONBOARDING_STEP_FIELDS_QUERY_KEY = "ONBOARDING_STEP_FIELDS";
export const ONBOARDING_INSTANCES_QUERY_KEY = "ONBOARDING_INSTANCES";

interface OnboardingStepFormProps {
  stepInstance: OnboardingStepInstanceDTO;
  onSubmitted: (updated: OnboardingStepInstanceDTO) => void;
}

/**
 * Renders + submits the FORM step type: one input per field resolved for the
 * caller's own role (`getResolvedStepFields`) — a field they can't view is
 * never sent by the server, and a field they can view but not edit renders
 * read-only (pre-filled with its already-submitted value) instead of an
 * editable text input. Only editable fields are included in the submit
 * payload; the server re-validates mandatory/edit permission regardless.
 */
export const OnboardingStepForm = ({
  stepInstance,
  onSubmitted,
}: OnboardingStepFormProps) => {
  const { t } = useTranslation("userProfileExtra");
  const queryClient = useQueryClient();

  const {
    data: fieldRows,
    isLoading: isLoadingFields,
    isError: isFieldsError,
  } = useQuery({
    queryKey: [ONBOARDING_STEP_FIELDS_QUERY_KEY, stepInstance.id],
    queryFn: () => getResolvedStepFields(stepInstance.id),
    enabled: Boolean(stepInstance.id),
    staleTime: 60 * 1000,
  });

  const fields = useMemo(
    () =>
      [...(fieldRows ?? [])].sort(
        (a, b) => (a.field_order ?? 0) - (b.field_order ?? 0)
      ),
    [fieldRows]
  );
  const editableFields = useMemo(
    () => fields.filter((f) => f.can_edit !== false),
    [fields]
  );
  const readOnlyFields = useMemo(
    () => fields.filter((f) => f.can_edit === false),
    [fields]
  );

  const zodSchema = useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    editableFields.forEach((field) => {
      shape[field.institute_custom_field_id] = field.is_mandatory
        ? z.string().min(
            1,
            t("onboardingStepForm.validation.fieldRequired", {
              field: field.field_name ?? t("onboardingStepForm.validation.fieldRequiredDefaultField"),
            })
          )
        : z.string().optional();
    });
    return z.object(shape);
  }, [editableFields, t]);

  type FormValues = Record<string, string>;

  const defaultValues = useMemo(
    () =>
      Object.fromEntries(
        // A never-answered field falls back to its configured default value.
        editableFields.map((f) => [
          f.institute_custom_field_id,
          f.value ?? f.default_value ?? "",
        ])
      ),
    [editableFields]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues,
  });

  // Fields resolve asynchronously (a separate query) after the form is already
  // constructed with empty defaults -- reset once the real values arrive so
  // previously-submitted values actually show up pre-filled.
  useEffect(() => {
    form.reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues]);

  const submitMutation = useMutation({
    mutationFn: (values: FormValues) =>
      submitStepInstance(stepInstance.id, values),
    onSuccess: (updated) => {
      toast.success(t("onboardingStepForm.toast.submittedTitle"), {
        description: t("onboardingStepForm.toast.submittedDescription", {
          stepName: stepInstance.step_name,
        }),
      });
      queryClient.invalidateQueries({ queryKey: [ONBOARDING_INSTANCES_QUERY_KEY] });
      onSubmitted(updated);
    },
    onError: (error) => {
      toast.error(t("onboardingStepForm.toast.errorTitle"), {
        description: getOnboardingApiErrorMessage(
          error,
          t("onboardingStepForm.toast.errorFallback")
        ),
      });
    },
  });

  const handleSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

  return (
    <ModernCard
      variant="glass"
      padding="lg"
      rounded="lg"
      className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
    >
      <div className="mb-6 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-100 to-primary-50 ring-1 ring-primary-200/60">
          <PencilSimpleLine className="size-5 text-primary-600" weight="fill" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-neutral-800">
            {stepInstance.step_name}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t("onboardingStepForm.subtitle")}
          </p>
        </div>
      </div>

      {isLoadingFields ? (
        <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
          <SpinnerGap className="size-4 animate-spin" />
          {t("onboardingStepForm.loadingForm")}
        </div>
      ) : isFieldsError ? (
        <div className="rounded-lg bg-danger-50 p-4 text-sm text-danger-600">
          {t("onboardingStepForm.loadError")}
        </div>
      ) : fields.length === 0 ? (
        <div className="py-6 text-center text-sm text-neutral-500 space-y-4">
          <p>{t("onboardingStepForm.noFieldsConfigured")}</p>
          <MyButton
            type="button"
            buttonType="primary"
            scale="large"
            layoutVariant="default"
            onClick={() => submitMutation.mutate({})}
            disable={submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <>
                <SpinnerGap className="mr-2 size-4 animate-spin" />
                {t("onboardingStepForm.submitting")}
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 size-4" />
                {t("onboardingStepForm.markAsComplete")}
              </>
            )}
          </MyButton>
        </div>
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex w-full flex-col gap-4"
          >
            {readOnlyFields.map((field) => (
              <div
                key={field.institute_custom_field_id}
                className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-neutral-50/80 px-3.5 py-2.5"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                  <Lock className="size-3.5" />
                  {field.field_name ?? t("onboardingStepForm.defaultFieldLabel")}
                </span>
                <span className="text-sm text-neutral-700">
                  {field.value ? (
                    <CustomFieldValueDisplay value={field.value} fieldType={field.field_type} />
                  ) : (
                    t("onboardingStepForm.notFilledIn")
                  )}
                </span>
              </div>
            ))}

            {editableFields.map((field) => (
              <FormField
                key={field.institute_custom_field_id}
                control={form.control}
                name={field.institute_custom_field_id}
                render={({ field: rhfField, fieldState }) => (
                  <FormItem>
                    <FormControl>
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-sm font-medium text-neutral-700">
                          {field.field_name ?? t("onboardingStepForm.defaultFieldLabel")}
                          {field.is_mandatory && (
                            <span className="ms-0.5 text-danger-600">*</span>
                          )}
                        </Label>
                        <div
                          className={cn(
                            "onboarding-field",
                            fieldState.error && "[&_input]:border-danger-400"
                          )}
                        >
                          {/* Renders the field AS ITS CONFIGURED TYPE — a dropdown's
                              options, a date picker, a phone input, a file upload. Every
                              field used to render through this one plain text <Input>
                              regardless of type. */}
                          <CustomFieldRenderer
                            type={field.field_type ?? "text"}
                            name={field.field_name ?? t("onboardingStepForm.defaultFieldLabel")}
                            value={rhfField.value ?? ""}
                            onChange={rhfField.onChange}
                            config={field.config}
                            required={field.is_mandatory ?? false}
                            placeholder={t("onboardingStepForm.enterPlaceholder", {
                              field: field.field_name ?? t("onboardingStepForm.defaultFieldPlaceholder"),
                            })}
                          />
                        </div>
                        {fieldState.error && (
                          <p className="text-xs font-medium text-danger-600">
                            {fieldState.error.message}
                          </p>
                        )}
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
            ))}

            <MyButton
              type="submit"
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              disable={submitMutation.isPending}
              className="mt-2 w-full"
            >
              {submitMutation.isPending ? (
                <>
                  <SpinnerGap className="mr-2 size-4 animate-spin" />
                  {t("onboardingStepForm.submitting")}
                </>
              ) : (
                t("onboardingStepForm.submit")
              )}
            </MyButton>
          </form>
        </Form>
      )}
    </ModernCard>
  );
};
