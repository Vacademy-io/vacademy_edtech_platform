import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Buildings,
  Image as ImageIcon,
  Info,
  Trash,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { ModernCard } from "@/components/design-system/modern-card";
import { MyInput } from "@/components/design-system/input";
import { MyButton } from "@/components/design-system/button";
import PhoneInputField from "@/components/design-system/phone-input-field";
import { useFileUpload } from "@/hooks/use-file-upload";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { isBlankPhone, isValidPhoneValue } from "@/lib/phone-validation";
import { cn } from "@/lib/utils";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";

const buildDetailsSchema = (t: TFunction, admin: string) =>
  z.object({
    orgName: z
      .string()
      .trim()
      .min(1, t("subOrgRegistration.details.validation.orgNameRequired")),
    adminName: z
      .string()
      .trim()
      .min(
        1,
        t("subOrgRegistration.details.validation.adminNameRequired", {
          admin,
        })
      ),
    adminEmail: z
      .string()
      .trim()
      .min(
        1,
        t("subOrgRegistration.details.validation.adminEmailRequired", {
          admin,
        })
      )
      .email(t("subOrgRegistration.details.validation.adminEmailInvalid")),
    adminPhone: z
      .string()
      .optional()
      .refine(
        (v) => !v || isBlankPhone(v) || isValidPhoneValue(v),
        t("subOrgRegistration.details.validation.phoneInvalid")
      ),
    // Address is only collected (and required) when the template asks for it —
    // the conditional requirements live in a superRefine so the output type is
    // identical either way.
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z
      .string()
      .optional()
      .refine(
        (v) => !v || v.trim().length <= 20,
        t("subOrgRegistration.details.validation.pincodeTooLong")
      ),
  });

export type DetailsFormValues = z.infer<ReturnType<typeof buildDetailsSchema>>;

export interface DetailsStepValues extends DetailsFormValues {
  orgLogoFileId: string | null;
}

interface DetailsStepProps {
  /** Previously entered values (edit-details flow) */
  initialValues?: DetailsStepValues | null;
  onSubmit: (values: DetailsStepValues) => void;
  isSubmitting: boolean;
  /** Template's org_name_hint — caption under the Organization Name field. */
  orgNameHint?: string | null;
  /** Template's collect_address — shows the org address fields (line1/city/state/pincode required). */
  collectAddress?: boolean;
  /**
   * The registration is already OTP-verified — submit updates the existing
   * registration (no fresh code unless the email changed).
   */
  isEditingAfterVerification?: boolean;
  /**
   * /start rejected this email because a registration is already in flight —
   * shows the inline "Resume registration" panel under the form.
   */
  resumeEmail?: string | null;
  /** Sends a fresh OTP via /resume and moves the wizard to resume-mode OTP. */
  onResume?: () => void;
  isResuming?: boolean;
  /** /resume failure surfaced inside the panel (not a toast). */
  resumeError?: string | null;
}

/** Step 1 — organization + admin details, POSTs /start (or /update-details) on continue. */
const DetailsStep = ({
  initialValues,
  onSubmit,
  isSubmitting,
  orgNameHint,
  collectAddress = false,
  isEditingAfterVerification = false,
  resumeEmail = null,
  onResume,
  isResuming = false,
  resumeError = null,
}: DetailsStepProps) => {
  const { t } = useTranslation("registrationB");
  const admin = getTerminology(RoleTerms.Admin, SystemTerms.Admin);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFilePublic, isUploading } = useFileUpload();
  const [logoFileId, setLogoFileId] = useState<string | null>(
    initialValues?.orgLogoFileId ?? null
  );
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  const schema = useMemo(() => {
    const base = buildDetailsSchema(t, admin);
    return collectAddress
      ? base.superRefine((values, ctx) => {
          const requireField = (
            key: "addressLine1" | "city" | "state" | "pincode",
            message: string
          ) => {
            if (!values[key]?.trim()) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message,
              });
            }
          };
          requireField(
            "addressLine1",
            t("subOrgRegistration.details.validation.addressLine1Required")
          );
          requireField(
            "city",
            t("subOrgRegistration.details.validation.cityRequired")
          );
          requireField(
            "state",
            t("subOrgRegistration.details.validation.stateRequired")
          );
          requireField(
            "pincode",
            t("subOrgRegistration.details.validation.pincodeRequired")
          );
        })
      : base;
  }, [collectAddress, t, admin]);

  const form = useForm<DetailsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      orgName: initialValues?.orgName ?? "",
      adminName: initialValues?.adminName ?? "",
      adminEmail: initialValues?.adminEmail ?? "",
      adminPhone: initialValues?.adminPhone ?? "",
      addressLine1: initialValues?.addressLine1 ?? "",
      addressLine2: initialValues?.addressLine2 ?? "",
      city: initialValues?.city ?? "",
      state: initialValues?.state ?? "",
      pincode: initialValues?.pincode ?? "",
    },
    mode: "onTouched",
  });

  // Restore the logo preview when re-entering via "Edit Details" (the local
  // object URL from the original upload does not survive the remount).
  useEffect(() => {
    const initialFileId = initialValues?.orgLogoFileId;
    if (!initialFileId) return;
    let cancelled = false;
    getPublicUrlWithoutLogin(initialFileId)
      .then((url) => {
        if (!cancelled && url) {
          setLogoPreviewUrl((current) => current ?? url);
        }
      })
      .catch(() => {
        // Preview is cosmetic — the fileId is still attached to the payload.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error(t("subOrgRegistration.details.toast.logoInvalidType"));
      e.target.value = "";
      return;
    }

    try {
      const fileId = await uploadFilePublic({
        file,
        source: "SUB_ORG_REGISTRATION",
        sourceId: "ORG_LOGO",
      });
      if (fileId) {
        setLogoFileId(fileId);
        setLogoPreviewUrl(URL.createObjectURL(file));
      } else {
        toast.error(t("subOrgRegistration.details.toast.logoUploadFailed"));
      }
    } catch (error) {
      console.error("Logo upload error:", error);
      toast.error(t("subOrgRegistration.details.toast.logoUploadFailed"));
    } finally {
      e.target.value = "";
    }
  };

  const handleRemoveLogo = () => {
    setLogoFileId(null);
    setLogoPreviewUrl(null);
  };

  const handleSubmit = (values: DetailsFormValues) => {
    onSubmit({ ...values, orgLogoFileId: logoFileId });
  };

  return (
    <ModernCard
      variant="glass"
      padding="lg"
      rounded="lg"
      className="border border-white/40 bg-white/90 shadow-lg backdrop-blur-md"
    >
      <div className="mb-5 flex items-start gap-2 sm:gap-3">
        <div className="flex-shrink-0 rounded-lg bg-primary-50 p-1.5 sm:p-2">
          <Buildings className="size-5 text-primary-500 sm:size-6" />
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-tight text-neutral-700">
            {t("subOrgRegistration.details.title")}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t("subOrgRegistration.details.subtitle", { admin })}
          </p>
        </div>
      </div>

      <Separator className="mb-5" />

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex w-full flex-col gap-5"
        >
          <FormField
            control={form.control}
            name="orgName"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormControl>
                  <MyInput
                    label={t("subOrgRegistration.details.orgName.label")}
                    inputType="text"
                    inputPlaceholder={t(
                      "subOrgRegistration.details.orgName.placeholder"
                    )}
                    input={field.value}
                    onChangeFunction={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                    size="large"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          {orgNameHint?.trim() && (
            <p className="-mt-4 text-caption text-neutral-400">
              {orgNameHint.trim()}
            </p>
          )}

          {/* Organization logo (optional) */}
          <div className="flex flex-col gap-1">
            <span className="text-subtitle font-regular">
              {t("subOrgRegistration.details.logo.label")}
            </span>
            <div className="flex items-center gap-3">
              {logoPreviewUrl ? (
                <img
                  src={logoPreviewUrl}
                  alt={t("subOrgRegistration.details.logo.previewAlt")}
                  className="size-16 rounded-lg border border-neutral-200 bg-white object-contain"
                />
              ) : (
                <div
                  className={cn(
                    "flex size-16 items-center justify-center rounded-lg border border-dashed",
                    "border-neutral-300 bg-neutral-50 text-neutral-400"
                  )}
                >
                  {isUploading ? (
                    <SpinnerGap className="size-6 animate-spin" />
                  ) : (
                    <ImageIcon className="size-6" />
                  )}
                </div>
              )}
              <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                  <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="default"
                    onClick={() => fileInputRef.current?.click()}
                    disable={isUploading || isSubmitting}
                  >
                    {isUploading
                      ? t("subOrgRegistration.details.logo.uploading")
                      : logoFileId
                        ? t("subOrgRegistration.details.logo.change")
                        : t("subOrgRegistration.details.logo.upload")}
                  </MyButton>
                  {logoFileId && !isUploading && (
                    <MyButton
                      type="button"
                      buttonType="text"
                      scale="small"
                      layoutVariant="default"
                      onClick={handleRemoveLogo}
                      className="!text-danger-600"
                    >
                      <Trash className="me-1 size-4" />
                      {t("subOrgRegistration.details.logo.remove")}
                    </MyButton>
                  )}
                </div>
                <p className="text-caption text-neutral-400">
                  {t("subOrgRegistration.details.logo.hint")}
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
          </div>

          <Separator />

          <FormField
            control={form.control}
            name="adminName"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormControl>
                  <MyInput
                    label={t("subOrgRegistration.details.adminName.label", {
                      admin,
                    })}
                    inputType="text"
                    inputPlaceholder={t(
                      "subOrgRegistration.details.adminName.placeholder",
                      { admin }
                    )}
                    input={field.value}
                    onChangeFunction={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                    size="large"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="adminEmail"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormControl>
                  <MyInput
                    label={t("subOrgRegistration.details.adminEmail.label", {
                      admin,
                    })}
                    inputType="email"
                    inputPlaceholder={t(
                      "subOrgRegistration.details.adminEmail.placeholder"
                    )}
                    input={field.value}
                    onChangeFunction={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                    size="large"
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <p className="-mt-4 text-caption text-neutral-400">
            {t("subOrgRegistration.details.adminEmail.hint")}
          </p>

          <PhoneInputField
            label={t("subOrgRegistration.details.adminPhone.label", {
              admin,
            })}
            placeholder={t(
              "subOrgRegistration.details.adminPhone.placeholder"
            )}
            name="adminPhone"
            control={form.control}
            required={false}
          />

          {/* Organization address — only when the template collects it */}
          {collectAddress && (
            <>
              <Separator />
              <FormField
                control={form.control}
                name="addressLine1"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormControl>
                      <MyInput
                        label={t(
                          "subOrgRegistration.details.address.line1.label"
                        )}
                        inputType="text"
                        inputPlaceholder={t(
                          "subOrgRegistration.details.address.line1.placeholder"
                        )}
                        input={field.value ?? ""}
                        onChangeFunction={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                        required
                        size="large"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="addressLine2"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormControl>
                      <MyInput
                        label={t(
                          "subOrgRegistration.details.address.line2.label"
                        )}
                        inputType="text"
                        inputPlaceholder={t(
                          "subOrgRegistration.details.address.line2.placeholder"
                        )}
                        input={field.value ?? ""}
                        onChangeFunction={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                        size="large"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormControl>
                        <MyInput
                          label={t(
                            "subOrgRegistration.details.address.city.label"
                          )}
                          inputType="text"
                          inputPlaceholder={t(
                            "subOrgRegistration.details.address.city.placeholder"
                          )}
                          input={field.value ?? ""}
                          onChangeFunction={field.onChange}
                          onBlur={field.onBlur}
                          error={fieldState.error?.message}
                          required
                          size="large"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="state"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormControl>
                        <MyInput
                          label={t(
                            "subOrgRegistration.details.address.state.label"
                          )}
                          inputType="text"
                          inputPlaceholder={t(
                            "subOrgRegistration.details.address.state.placeholder"
                          )}
                          input={field.value ?? ""}
                          onChangeFunction={field.onChange}
                          onBlur={field.onBlur}
                          error={fieldState.error?.message}
                          required
                          size="large"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="pincode"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormControl>
                      <MyInput
                        label={t(
                          "subOrgRegistration.details.address.pincode.label"
                        )}
                        inputType="text"
                        inputPlaceholder={t(
                          "subOrgRegistration.details.address.pincode.placeholder"
                        )}
                        input={field.value ?? ""}
                        onChangeFunction={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                        required
                        size="large"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </>
          )}

          <div className="mt-2 flex justify-end">
            <MyButton
              type="submit"
              buttonType="primary"
              scale="large"
              layoutVariant="default"
              disable={isSubmitting || isUploading}
              className="w-full min-w-32 sm:w-auto"
            >
              {isSubmitting ? (
                <>
                  <SpinnerGap className="me-2 size-4 animate-spin" />
                  {isEditingAfterVerification
                    ? t("subOrgRegistration.details.submit.saving")
                    : t("subOrgRegistration.details.submit.sendingCode")}
                </>
              ) : (
                t("common.continue")
              )}
            </MyButton>
          </div>
        </form>
      </Form>

      {/* Dead-end → door: /start said this email already has an in-flight
          registration — offer to resume it instead of blocking. */}
      {resumeEmail && onResume && (
        <div className="mt-5 space-y-3 rounded-lg border border-primary-200 bg-primary-50 p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 size-5 flex-shrink-0 text-primary-500" />
            <div>
              <p className="text-sm font-medium text-neutral-700">
                {t("subOrgRegistration.details.resume.inProgress")}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {t("subOrgRegistration.details.resume.descriptionPrefix")}{" "}
                <span className="font-medium text-neutral-700">
                  {resumeEmail}
                </span>
                {t("subOrgRegistration.details.resume.descriptionSuffix")}
              </p>
            </div>
          </div>
          {resumeError && (
            <p className="text-sm text-danger-600">{resumeError}</p>
          )}
          <div className="flex justify-end">
            <MyButton
              type="button"
              buttonType="primary"
              scale="medium"
              layoutVariant="default"
              onClick={onResume}
              disable={isResuming || isSubmitting || isUploading}
              className="w-full sm:w-auto"
            >
              {isResuming ? (
                <>
                  <SpinnerGap className="me-2 size-4 animate-spin" />
                  {t("subOrgRegistration.details.submit.sendingCode")}
                </>
              ) : (
                t("subOrgRegistration.details.resume.button")
              )}
            </MyButton>
          </div>
        </div>
      )}
    </ModernCard>
  );
};

export default DetailsStep;
