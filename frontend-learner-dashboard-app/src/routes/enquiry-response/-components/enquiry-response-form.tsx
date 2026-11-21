import { useEffect, useState } from "react";
import { useForm, FormProvider, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { Preferences } from "@capacitor/preferences";
import { applyTabBranding } from "@/utils/branding";
import { useSuspenseQuery } from "@tanstack/react-query";
import { handleGetPublicInstituteDetails } from "@/components/common/enroll-by-invite/-services/enroll-invite-services";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";
import { getDynamicSchema } from "@/routes/register/-utils/helper";
import { phoneSchema } from "@/lib/phone-validation";
import { AssessmentCustomFieldOpenRegistration } from "@/types/assessment-open-registration";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import {
  ModernCard,
  ModernCardHeader,
  ModernCardTitle,
} from "@/components/design-system/modern-card";
import { InstituteBrandingComponent } from "@/components/common/institute-branding";
import { MyButton } from "@/components/design-system/button";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
import { MyInput } from "@/components/design-system/input";
import SelectField from "@/components/design-system/select-field";
import PhoneInputField from "@/components/design-system/phone-input-field";
import {
  FieldRenderType,
  dependentFieldKeys,
  getFieldRenderType,
  getParentFieldKey,
  resolveDependentField,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { capitalise } from "@/utils/custom-field";
import {
  lookupCountryCode,
  findCountryFieldKey,
} from "@/components/common/enroll-by-invite/-utils/country-code-mapping";
import type { AudienceCampaignResponse } from "../-services/enquiry-campaign-services";
import {
  submitEnquiryWithLead,
  handleSubmitEnquiryWithLead,
} from "../-services/enquiry-campaign-services";
import { toast } from "sonner";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { BASE_URL } from "@/constants/urls";

interface AudienceResponseFormProps {
  campaignData: AudienceCampaignResponse;
  instituteId: string;
  audienceId: string; // Reserved for future use (e.g., submitting response)
}

// Convert audience campaign custom fields to the format expected by the form
const convertAudienceCustomFields = (
  customFields: AudienceCampaignResponse["institute_custom_fields"],
): AssessmentCustomFieldOpenRegistration[] => {
  return customFields
    .map((field) => {
      const customField = field.custom_field;
      return {
        id: customField.id,
        field_name: customField.fieldName,
        field_key: customField.fieldKey,
        field_order: customField.individualOrder || customField.formOrder || 0,
        comma_separated_options: customField.config || "",
        config: customField.config || "{}",
        status: field.status || "ACTIVE",
        is_mandatory: customField.isMandatory || false,
        field_type: customField.fieldType || "text",
        created_at: customField.createdAt,
        updated_at: customField.updatedAt,
      };
    })
    .sort((a, b) => a.field_order - b.field_order);
};

const AudienceResponseForm = ({
  campaignData,
  instituteId,
  audienceId,
}: AudienceResponseFormProps) => {
  const { t } = useTranslation("miscRoutesB");
  const domainRouting = useDomainRouting();
  const { setInstituteDetails } = useInstituteDetailsStore();
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // New state for student/parent/enquiry fields
  const [studentName, setStudentName] = useState("");
  const [studentDob, setStudentDob] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [packageSessions, setPackageSessions] = useState<any[]>([]);

  const { data: instituteData, isLoading: isInstituteLoading } =
    useSuspenseQuery(handleGetPublicInstituteDetails({ instituteId }));

  // Convert custom fields
  const formFields = convertAudienceCustomFields(
    campaignData.institute_custom_fields || [],
  );

  // Fetch package sessions for class/batch dropdown
  useEffect(() => {
    const fetchPackageSessions = async () => {
      try {
        const response = await axios.post(
          `${BASE_URL}/admin-core-service/open/packages/v2/search`,
          {
            status: [],
            level_ids: [],
            faculty_ids: [],
            search_by_name: "",
            tag: [],
            min_percentage_completed: 0,
            max_percentage_completed: 0,
          },
          {
            params: {
              instituteId: instituteId,
              page: 0,
              size: 100,
              sort: "createdAt,desc",
            },
          },
        );
        setPackageSessions(response.data?.content || []);
      } catch (error) {
        console.error("Error fetching package sessions:", error);
      }
    };
    fetchPackageSessions();
  }, [instituteId]);

  // Create dynamic schema and extend it with additional fields
  // A dependent dropdown (e.g. Course → Query) is only required when its
  // parent's value offers it options — onSubmit checks those.
  const baseSchema = getDynamicSchema(
    formFields.map((field) =>
      getParentFieldKey(field.config) ? { ...field, is_mandatory: false } : field
    )
  );
  const zodSchema = baseSchema.extend({
    parentMobile: phoneSchema({
      required: true,
      label: t("enquiryResponse.form.validation.mobileLabel"),
    }),
    gender: z.string().optional(),
    parentRelationWithChild: z
      .string()
      .min(1, t("enquiryResponse.form.validation.relationRequired")),
    packageSessionId: z
      .string()
      .min(1, t("enquiryResponse.form.validation.classRequired")),
  });
  type FormValues = z.infer<typeof zodSchema>;

  // Initialize form with default values
  const defaultValues = formFields.reduce(
    (
      defaults: Record<
        string,
        {
          id: string;
          name: string;
          value: string;
          is_mandatory: boolean;
          type: string;
          config?: string;
          comma_separated_options?: string[];
        }
      >,
      field: AssessmentCustomFieldOpenRegistration,
    ) => {
      // Multi-input revamp (2026-04): always forward `config` so non-dropdown
      // types (radio, date, file, checkbox, etc.) can read their metadata.
      defaults[field.field_key] = {
        id: field.id,
        name: field.field_name,
        value: "",
        is_mandatory: field.is_mandatory || false,
        type: field.field_type,
        config: field.config || "{}",
      };
      return defaults;
    },
    {
      parentMobile: "",
      gender: "",
      parentRelationWithChild: "",
      packageSessionId: "",
    } as any,
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues,
    mode: "onChange",
  });

  // Watch form to ensure it's reactive
  form.watch();

  // Watch all form values for reactivity
  const watchedFormValues = useWatch({
    control: form.control,
  });

  // Apply branding
  useEffect(() => {
    if (instituteData) {
      setInstituteDetails(instituteData);
    }
  }, [instituteData, setInstituteDetails]);

  useEffect(() => {
    const syncBranding = async () => {
      try {
        if (!instituteId || !instituteData) return;

        await Preferences.set({ key: "InstituteId", value: instituteId });

        const mappedDetails = {
          id: instituteId,
          institute_name:
            instituteData?.institute_name ?? instituteData?.name ?? "",
          institute_logo_file_id: instituteData?.institute_logo_file_id ?? null,
          institute_theme_code:
            instituteData?.institute_theme_code ??
            (instituteData?.theme as string) ??
            "primary",
          institute_settings_json: instituteData?.setting ?? "",
        } as unknown as {
          id: string;
          institute_name: string;
          institute_logo_file_id: string | null;
          institute_theme_code: string;
          institute_settings_json: string;
        };

        await Preferences.set({
          key: "InstituteDetails",
          value: JSON.stringify(mappedDetails),
        });

        const learnerKey = `LEARNER_${instituteId}`;
        const learnerSettings = {
          tabText:
            instituteData?.tabText ?? instituteData?.institute_name ?? null,
          tabIconFileId:
            instituteData?.tabIconFileId ??
            instituteData?.institute_logo_file_id ??
            null,
          fontFamily: instituteData?.fontFamily ?? null,
          theme: instituteData?.institute_theme_code ?? null,
          privacyPolicyUrl: null,
          termsAndConditionUrl: null,
          allowSignup: null,
          allowGoogleAuth: null,
          allowGithubAuth: null,
          allowEmailOtpAuth: null,
          allowUsernamePasswordAuth: null,
        };
        await Preferences.set({
          key: learnerKey,
          value: JSON.stringify(learnerSettings),
        });

        await applyTabBranding(document.title);
      } catch (e) {
        console.warn("[Audience Response] Branding sync failed", e);
      }
    };

    void syncBranding();
  }, [instituteId, instituteData]);

  // A country field in this form, when there is one, is the strongest signal
  // — the visitor just told us where they are.
  //
  // Undefined means "no such signal", and PhoneInputField then resolves the
  // country itself through the portal's chain (institute preference, else the
  // region the form is opened in). It has to be undefined rather than that
  // chain's answer read here: a `country` prop overrides the field's own
  // resolution, so passing a value read before domain routing replied would
  // pin the field to the platform fallback (+91) even after the real
  // preference arrived.
  const getPhoneCountryCode = (): string | undefined => {
    const formValues = form.getValues();
    const countryFieldKey = findCountryFieldKey(formValues);
    if (countryFieldKey) {
      return lookupCountryCode(formValues[countryFieldKey]?.value);
    }
    return undefined;
  };

  const onSubmit = async (values: FormValues) => {
    const current = values as unknown as Record<string, { value?: string } | undefined>;
    const missingDependents = formFields.filter((field) => {
      if (!field.is_mandatory || !getParentFieldKey(field.config)) return false;
      const state = resolveDependentField(field.config, (k) => current[k]?.value);
      return state.kind !== "empty" && !String(current[field.field_key]?.value ?? "").trim();
    });
    if (missingDependents.length > 0) {
      missingDependents.forEach((field) =>
        form.setError(`${field.field_key}.value` as never, {
          type: "required",
          message: `${field.field_name} is required`,
        })
      );
      return;
    }
    // Validate required fields
    if (!studentName.trim()) {
      toast.error(t("enquiryResponse.toast.studentNameRequired"));
      return;
    }
    if (!parentEmail.trim()) {
      toast.error(t("enquiryResponse.toast.parentEmailRequired"));
      return;
    }
    const mobileValue = (values as any).parentMobile || "";
    if (!mobileValue.trim()) {
      toast.error(t("enquiryResponse.toast.parentMobileRequired"));
      return;
    }

    setLoading(true);
    try {
      // Build the payload using the new helper function
      const customFieldsOrder = formFields.map((field) => ({
        id: field.id,
        field_key: field.field_key,
      }));

      const payload = handleSubmitEnquiryWithLead(
        values,
        audienceId,
        studentName,
        studentDob,
        (values as any).gender || "",
        (values as any).parentRelationWithChild || "",
        parentName,
        parentEmail,
        (values as any).parentMobile || "",
        addressLine,
        city,
        region,
        pinCode,
        (values as any).packageSessionId || "",
        customFieldsOrder,
      );

      await submitEnquiryWithLead(payload);

      // Show success state
      setIsSubmitted(true);

      // Reset all form fields
      form.reset();
      setStudentName("");
      setStudentDob("");
      setParentName("");
      setParentEmail("");
      setAddressLine("");
      setCity("");
      setRegion("");
      setPinCode("");
    } catch (error: any) {
      console.error("Error submitting enquiry:", error);
      const errorMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        t("enquiryResponse.toast.submitFailed");
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (isInstituteLoading) {
    return <DashboardLoader />;
  }

  // Show success message after submission
  if (isSubmitted) {
    return (
      <div className="w-full h-auto bg-gradient-to-br from-slate-50 to-info-50 min-h-screen">
        {/* Navbar Header */}
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-6">
            <div className="flex items-center justify-start h-18 sm:h-16 py-3 p-3 sm:py-4">
              <InstituteBrandingComponent
                branding={{
                  instituteId: instituteId || null,
                  instituteName:
                    instituteData?.institute_name ??
                    instituteData?.name ??
                    null,
                  instituteLogoFileId:
                    instituteData?.institute_logo_file_id ?? null,
                  instituteThemeCode:
                    (instituteData?.institute_theme_code as string) ||
                    (instituteData?.theme as string) ||
                    null,
                  homeIconClickRoute: domainRouting.homeIconClickRoute ?? null,
                  hideInstituteName: domainRouting.hideInstituteName,
                  logoWidthPx: domainRouting.logoWidthPx,
                  logoHeightPx: domainRouting.logoHeightPx,
                }}
                size="medium"
                showName={true}
                className="!flex-row !items-center !gap-3 sm:!gap-4"
              />
            </div>
          </div>
        </nav>

        {/* Success Message */}
        <div className="py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <ModernCard
              variant="glass"
              padding="lg"
              rounded="lg"
              className="border border-white/40 bg-white/90 backdrop-blur-md shadow-lg"
            >
              <div className="text-center space-y-6 py-8">
                {/* Success Icon */}
                <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-green-100 mb-4">
                  <svg
                    className="h-10 w-10 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>

                {/* Success Message */}
                <div className="space-y-3">
                  <h2 className="text-2xl sm:text-3xl font-bold text-neutral-800">
                    {t("enquiryResponse.success.title")}
                  </h2>
                  <p className="text-lg text-neutral-600">
                    {t("enquiryResponse.success.description")}
                  </p>
                  {campaignData.send_respondent_email && (
                    <p className="text-sm text-neutral-500">
                      {t("enquiryResponse.success.emailNotice")}
                    </p>
                  )}
                </div>

                {/* Campaign Info */}
                <div className="mt-8 pt-6 border-t border-neutral-200">
                  <p className="text-sm text-neutral-600">
                    <span className="font-semibold">{t("enquiryResponse.success.campaignLabel")}</span>{" "}
                    {campaignData.campaign_name}
                  </p>
                </div>
              </div>
            </ModernCard>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-auto bg-gradient-to-br from-slate-50 to-info-50 min-h-screen">
      {/* Navbar Header */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-6">
          <div className="flex items-center justify-start h-18 sm:h-16 py-3 p-3 sm:py-4">
            <InstituteBrandingComponent
              branding={{
                instituteId: instituteId || null,
                instituteName:
                  instituteData?.institute_name ?? instituteData?.name ?? null,
                instituteLogoFileId:
                  instituteData?.institute_logo_file_id ?? null,
                instituteThemeCode:
                  (instituteData?.institute_theme_code as string) ||
                  (instituteData?.theme as string) ||
                  null,
                homeIconClickRoute: domainRouting.homeIconClickRoute ?? null,
                hideInstituteName: domainRouting.hideInstituteName,
                logoWidthPx: domainRouting.logoWidthPx,
                logoHeightPx: domainRouting.logoHeightPx,
              }}
              size="medium"
              showName={true}
              className="!flex-row !items-center !gap-3 sm:!gap-4"
            />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Campaign Header */}
          <ModernCard
            variant="glass"
            padding="lg"
            rounded="lg"
            className="border border-white/40 bg-white/90 backdrop-blur-md shadow-lg"
          >
            <ModernCardHeader className="p-0 mb-4">
              <ModernCardTitle
                size="lg"
                className="text-neutral-800 text-2xl sm:text-3xl"
              >
                {campaignData.campaign_name}
              </ModernCardTitle>
            </ModernCardHeader>
            {campaignData.description && (
              <div
                className="text-neutral-600 text-base leading-relaxed"
                dangerouslySetInnerHTML={{ __html: campaignData.description }}
              />
            )}
            {campaignData.campaign_objective && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold text-neutral-700">
                  {t("enquiryResponse.form.objectiveLabel")}
                </p>
                <p className="text-neutral-600">
                  {campaignData.campaign_objective}
                </p>
              </div>
            )}
          </ModernCard>

          {/* Response Form */}
          <ModernCard
            variant="glass"
            padding="lg"
            rounded="lg"
            className="border border-white/40 bg-white/90 backdrop-blur-md shadow-lg space-y-section"
            id="response-form-card"
          >
            <ModernCardHeader className="p-0 space-y-2">
              <ModernCardTitle
                size="md"
                className="text-neutral-800 text-xl sm:text-2xl"
              >
                {t("enquiryResponse.form.heading")}
              </ModernCardTitle>
              <p className="text-neutral-600 text-sm">
                {t("enquiryResponse.form.description")}
              </p>
            </ModernCardHeader>

            <FormProvider {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="w-full flex flex-col gap-section"
              >
                {/* Student Details Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-neutral-700 border-b pb-2">
                    {t("enquiryResponse.form.student.sectionTitle")}
                  </h3>

                  <MyInput
                    inputType="text"
                    inputPlaceholder={t("enquiryResponse.form.student.fullNamePlaceholder")}
                    input={studentName}
                    onChangeFunction={(e) => setStudentName(e.target.value)}
                    required={true}
                    size="large"
                    label={t("enquiryResponse.form.student.fullName")}
                  />

                  <MyInput
                    inputType="date"
                    inputPlaceholder={t("enquiryResponse.form.student.dobPlaceholder")}
                    input={studentDob}
                    onChangeFunction={(e) => setStudentDob(e.target.value)}
                    required={false}
                    size="large"
                    label={t("enquiryResponse.form.student.dob")}
                  />

                  <SelectField
                    label={t("enquiryResponse.form.student.gender.label")}
                    name="gender"
                    options={[
                      { label: t("enquiryResponse.form.student.gender.male"), value: "MALE", _id: "MALE" },
                      { label: t("enquiryResponse.form.student.gender.female"), value: "FEMALE", _id: "FEMALE" },
                      { label: t("enquiryResponse.form.student.gender.other"), value: "OTHER", _id: "OTHER" },
                    ]}
                    control={form.control}
                    required={false}
                    className="!w-full"
                  />

                  {packageSessions.length > 0 && (
                    <SelectField
                      label={t("enquiryResponse.form.student.class")}
                      name="packageSessionId"
                      options={packageSessions.map((session) => ({
                        label: `${session.package_name} - ${session.level_name || t("enquiryResponse.form.notAvailable")}`,
                        value: session.package_session_id,
                        _id: session.package_session_id,
                      }))}
                      control={form.control}
                      required={true}
                      className="!w-full"
                    />
                  )}
                </div>

                {/* Parent Details Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-neutral-700 border-b pb-2">
                    {t("enquiryResponse.form.parent.sectionTitle")}
                  </h3>

                  <MyInput
                    inputType="text"
                    inputPlaceholder={t("enquiryResponse.form.parent.fullNamePlaceholder")}
                    input={parentName}
                    onChangeFunction={(e) => setParentName(e.target.value)}
                    required={true}
                    size="large"
                    label={t("enquiryResponse.form.parent.fullName")}
                  />

                  <MyInput
                    inputType="email"
                    inputPlaceholder={t("enquiryResponse.form.parent.emailPlaceholder")}
                    input={parentEmail}
                    onChangeFunction={(e) => setParentEmail(e.target.value)}
                    required={true}
                    size="large"
                    label={t("enquiryResponse.form.parent.email")}
                  />

                  <PhoneInputField
                    label={t("enquiryResponse.form.parent.mobile")}
                    placeholder={t("enquiryResponse.form.parent.mobilePlaceholder")}
                    name="parentMobile"
                    control={form.control}
                    required={true}
                    inputClassName="!text-subtitle placeholder:!text-body"
                  />

                  <SelectField
                    label={t("enquiryResponse.form.parent.relation.label")}
                    name="parentRelationWithChild"
                    options={[
                      { label: t("enquiryResponse.form.parent.relation.father"), value: "FATHER", _id: "FATHER" },
                      { label: t("enquiryResponse.form.parent.relation.mother"), value: "MOTHER", _id: "MOTHER" },
                      { label: t("enquiryResponse.form.parent.relation.guardian"), value: "GUARDIAN", _id: "GUARDIAN" },
                    ]}
                    control={form.control}
                    required={true}
                    className="!w-full"
                  />

                  <MyInput
                    inputType="text"
                    inputPlaceholder={t("enquiryResponse.form.parent.addressPlaceholder")}
                    input={addressLine}
                    onChangeFunction={(e) => setAddressLine(e.target.value)}
                    required={false}
                    size="large"
                    label={t("enquiryResponse.form.parent.address")}
                  />

                  <MyInput
                    inputType="text"
                    inputPlaceholder={t("enquiryResponse.form.parent.cityPlaceholder")}
                    input={city}
                    onChangeFunction={(e) => setCity(e.target.value)}
                    required={false}
                    size="large"
                    label={t("enquiryResponse.form.parent.city")}
                  />

                  <MyInput
                    inputType="text"
                    inputPlaceholder={t("enquiryResponse.form.parent.regionPlaceholder")}
                    input={region}
                    onChangeFunction={(e) => setRegion(e.target.value)}
                    required={false}
                    size="large"
                    label={t("enquiryResponse.form.parent.region")}
                  />

                  <MyInput
                    inputType="text"
                    inputPlaceholder={t("enquiryResponse.form.parent.pinCodePlaceholder")}
                    input={pinCode}
                    onChangeFunction={(e) => setPinCode(e.target.value)}
                    required={false}
                    size="large"
                    label={t("enquiryResponse.form.parent.pinCode")}
                  />
                </div>

                {formFields.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-neutral-700 border-b pb-2">
                      {t("enquiryResponse.form.additionalInfo")}
                    </h3>

                    {formFields.map((field) => {
                      const key = field.field_key;
                      // Use watched values or fallback to defaultValues
                      const formValues =
                        watchedFormValues || form.getValues() || defaultValues;
                      const value = formValues[key] || defaultValues[key];

                      if (!value) {
                        // Fallback: render using the shared renderer with whatever
                        // metadata we can derive from the field definition.
                        const fallbackRenderType = getFieldRenderType(
                          key,
                          field.field_type || "text",
                        );
                        return (
                          <FormField
                            key={key}
                            control={form.control}
                            name={`${key}.value`}
                            render={({ field: formField }) => (
                              <FormItem>
                                <div className="flex flex-col gap-1">
                                  <label className="text-subtitle font-regular">
                                    {capitalise(field.field_name)}
                                    {field.is_mandatory && (
                                      <span className="text-danger-600"> *</span>
                                    )}
                                  </label>
                                  <FormControl>
                                    <CustomFieldRenderer
                                      type={fallbackRenderType}
                                      name={field.field_name}
                                      value={formField.value || ""}
                                      onChange={(val) => formField.onChange(val)}
                                      config={field.config}
                                      required={field.is_mandatory}
                                    />
                                  </FormControl>
                                </div>
                              </FormItem>
                            )}
                          />
                        );
                      }

                      const renderType =
                        value.render_type ||
                        getFieldRenderType(
                          key,
                          value.type || field.field_type || "text",
                        );

                      // Phone: use the specialized PhoneInputField with country-code detection
                      if (renderType === FieldRenderType.PHONE) {
                        const phoneCountryCode = getPhoneCountryCode();
                        return (
                          <FormField
                            key={key}
                            control={form.control}
                            name={`${key}.value`}
                            render={() => (
                              <FormItem>
                                <FormControl>
                                  <PhoneInputField
                                    label={capitalise(value.name)}
                                    placeholder="123 456 7890"
                                    name={`${key}.value`}
                                    control={form.control}
                                    country={phoneCountryCode}
                                    required={value.is_mandatory}
                                    labelClassName="text-subtitle font-regular"
                                    inputClassName="!text-subtitle placeholder:!text-body"
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        );
                      }

                      // Cascading dropdown: options follow the parent field's value.
                      const dependent = resolveDependentField(
                        value.config ?? field.config,
                        (k) => formValues[k]?.value
                      );
                      if (dependent.kind === "empty") return null;
                      const parentName =
                        dependent.kind === "waiting"
                          ? capitalise(
                              formFields.find((f) => f.field_key === dependent.parentFieldKey)
                                ?.field_name ?? ""
                            )
                          : "";

                      // All other types — shared renderer handles text, number,
                      // email, url, date, textarea, checkbox, radio, dropdown, file
                      return (
                        <FormField
                          key={key}
                          control={form.control}
                          name={`${key}.value`}
                          render={({ field: formField }) => (
                            <FormItem>
                              <div className="flex flex-col gap-1">
                                <label className="text-subtitle font-regular">
                                  {capitalise(value.name)}
                                  {value.is_mandatory && (
                                    <span className="text-danger-600"> *</span>
                                  )}
                                </label>
                                <FormControl>
                                  <CustomFieldRenderer
                                    type={renderType}
                                    name={value.name}
                                    value={formField.value || ""}
                                    onChange={(val) => {
                                      const changed = val !== formField.value;
                                      formField.onChange(val);
                                      // A changed parent invalidates its dependents' answers.
                                      if (changed)
                                        dependentFieldKeys(
                                          key,
                                          formFields.map((f) => ({ key: f.field_key, config: f.config }))
                                        ).forEach((k) =>
                                          form.setValue(`${k}.value` as never, "" as never)
                                        );
                                    }}
                                    config={value.config}
                                    options={
                                      dependent.kind === "ready"
                                        ? dependent.options
                                        : value.comma_separated_options
                                    }
                                    disabled={dependent.kind === "waiting"}
                                    placeholder={
                                      dependent.kind === "waiting" && parentName
                                        ? t("enquiryResponse.form.selectParentFirst", {
                                            name: parentName.toLowerCase(),
                                          })
                                        : undefined
                                    }
                                    required={value.is_mandatory}
                                  />
                                </FormControl>
                              </div>
                            </FormItem>
                          )}
                        />
                      );
                    })}
                  </div>
                )}

                <div className="flex justify-end mt-4">
                  <MyButton
                    type="submit"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    disabled={loading}
                    className="min-w-32"
                  >
                    {loading
                      ? t("enquiryResponse.form.submitting")
                      : t("enquiryResponse.form.submit")}
                  </MyButton>
                </div>
              </form>
            </FormProvider>
          </ModernCard>
        </div>
      </div>
    </div>
  );
};

export default AudienceResponseForm;
