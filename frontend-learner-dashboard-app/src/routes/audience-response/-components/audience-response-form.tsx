import { useEffect, useMemo, useState } from "react";
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
import { AssessmentCustomFieldOpenRegistration } from "@/types/assessment-open-registration";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { ModernCard } from "@/components/design-system/modern-card";
import { InstituteBrandingComponent } from "@/components/common/institute-branding";
import { MyButton } from "@/components/design-system/button";
import { CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { FormControl, FormField, FormItem } from "@/components/ui/form";
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
import { cn } from "@/lib/utils";
import type { AudienceCampaignResponse } from "../-services/audience-campaign-services";
import {
  submitAudienceLead,
  handleSubmitAudienceLead,
  extractRespondentIdentity,
} from "../-services/audience-campaign-services";
import { trackUtmAttribution } from "@/lib/utm-attribution";
import { identityFromFormValues } from "@/lib/learner-identity";
import {
  parsePostSubmitConfiguration,
  applyPostSubmitTokens,
  sanitizePostSubmitHtml,
  resolvePostSubmitButtons,
  isExternalPostSubmitUrl,
  type PostSubmitTokens,
} from "../-utils/post-submit-config";
import { PostSubmitArtwork } from "./post-submit-artwork";
import { useEmbedHeight } from "../-utils/use-embed-height";
import {
  AUDIENCE_FORM_HOOKS,
  parseAudienceFormAppearance,
  resolveFormSubtitle,
  resolveFormSubtitleHtml,
  hasStructuredHeroContent,
  resolveHeroHtml,
  sanitizeCustomCss,
} from "../-utils/form-appearance";
import {
  FORM_ACCENT_BUTTON_CLASS,
  FORM_ACCENT_METER_CLASS,
  FORM_BACKGROUND_CLASS,
  FORM_CARD_CLASS,
  FORM_CARD_VARIANT,
  FORM_RICH_TEXT_CLASS,
  FORM_TEXT_ALIGN_CLASS,
  FORM_WIDTH_CLASS,
} from "../-utils/form-appearance-styles";
import {
  BACKDROP_TEMPLATES,
  FORM_TEMPLATE_LOOK,
  isShellTemplate,
} from "../-utils/form-template-styles";
import { AudienceFormHero } from "./audience-form-hero";
import { AudienceFormTemplateShell } from "./audience-form-template-shell";
import { usePostSubmitRedirect } from "../-utils/use-post-submit-redirect";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface AudienceResponseFormProps {
  campaignData: AudienceCampaignResponse;
  instituteId: string;
  audienceId: string;
}

/** Shape the form actually stores per field key. */
interface AudienceFieldValue {
  id: string;
  name: string;
  value: string;
  is_mandatory: boolean;
  type: string;
  config?: string;
  /**
   * Only ever set by callers that pre-parse a dropdown's options. This form
   * does not — options are parsed out of `config` by CustomFieldRenderer — but
   * the shape must match the renderer's prop, not the raw comma-separated
   * string the API field is named after.
   */
  comma_separated_options?: Array<{ _id?: number; value: string; label: string }>;
  render_type?: FieldRenderType;
}

// Convert audience campaign custom fields to the format expected by the form
const convertAudienceCustomFields = (
  customFields: AudienceCampaignResponse["institute_custom_fields"]
): AssessmentCustomFieldOpenRegistration[] => {
  return customFields
    .map((field) => {
      const customField = field.custom_field;
      return {
        id: customField.id,
        field_name: customField.fieldName,
        field_key: customField.fieldKey,
        // Order by the per-form mapping order (individual_order) so each form controls
        // its own field sequence. Fall back to the nested/master order only when the
        // mapping has none. Use ?? (not ||) so a valid 0 (first position) is respected.
        field_order:
          field.individual_order ??
          customField.individualOrder ??
          customField.formOrder ??
          0,
        comma_separated_options: customField.config || "",
        config: customField.config || "{}",
        status: field.status || "ACTIVE",
        // Per-form answer first, master row second — same precedence as field_order above.
        // The mapping's is_mandatory is what the campaign builder's Required switch writes;
        // reading only the shared master meant that switch changed nothing on this form.
        // `??` (not ||) so an explicit false is respected.
        is_mandatory: field.is_mandatory ?? customField.isMandatory ?? false,
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
  const { t } = useTranslation("liveClassGuest");
  const domainRouting = useDomainRouting();
  const { setInstituteDetails } = useInstituteDetailsStore();
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  // Inside an iframe, tells the host page how tall the form is (see the embed
  // snippet). Does nothing on the standalone page.
  const embedHeightRef = useEmbedHeight();
  // What the visitor typed, kept after the form resets so the thank-you screen
  // can resolve {{name}} / {{email}} tokens.
  const [respondent, setRespondent] = useState<PostSubmitTokens>({});

  // Admin-authored look of the page. Unlike the post-submit config there is no
  // master switch — an unstyled campaign gets the shipped defaults, which ARE
  // the design. See -utils/form-appearance.ts.
  const appearance = useMemo(
    () => parseAudienceFormAppearance(campaignData.setting_json),
    [campaignData.setting_json]
  );

  // Admin-authored thank-you screen / redirect. Falls back to the previous
  // hardcoded copy for campaigns that predate the feature.
  const postSubmitConfig = useMemo(
    () => parsePostSubmitConfiguration(campaignData.setting_json),
    [campaignData.setting_json]
  );
  const postSubmitTokens: PostSubmitTokens = useMemo(
    () => ({ ...respondent, campaignName: campaignData.campaign_name }),
    [respondent, campaignData.campaign_name]
  );
  const { redirectUrl, secondsLeft } = usePostSubmitRedirect(
    postSubmitConfig,
    postSubmitTokens,
    // Gated on the master switch: a campaign that never enabled this must never
    // redirect anyone, whatever else is sitting in its setting_json.
    isSubmitted && postSubmitConfig.enabled
  );

  const { data: instituteData, isLoading: isInstituteLoading } =
    useSuspenseQuery(handleGetPublicInstituteDetails({ instituteId }));

  const formFields = useMemo(
    () => convertAudienceCustomFields(campaignData.institute_custom_fields || []),
    [campaignData.institute_custom_fields]
  );

  // Create dynamic schema. A dependent dropdown (e.g. Course → Query) is only
  // required when its parent's value offers it options, which a static schema
  // cannot know — onSubmit checks those.
  const zodSchema = getDynamicSchema(
    formFields.map((field) =>
      getParentFieldKey(field.config) ? { ...field, is_mandatory: false } : field
    )
  );
  type FormValues = z.infer<typeof zodSchema>;

  // Initialize form with default values
  const defaultValues = useMemo(
    () =>
      formFields.reduce(
        (
          defaults: Record<string, AudienceFieldValue>,
          field: AssessmentCustomFieldOpenRegistration
        ) => {
          // Multi-input revamp (2026-04): always forward `config` and the parsed
          // options so non-dropdown types (radio, date, file, checkbox, etc.) can
          // read their metadata from `value.config` inside CustomFieldRenderer.
          // Previously only dropdown fields carried `config`, so the shared
          // renderer fell back to text input for everything else.
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
        {}
      ),
    [formFields]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues,
    mode: "onChange",
  });

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

  /**
   * Completion meter over the REQUIRED fields only. Optional fields left blank
   * are not "incomplete" — counting them would show a visitor 3/7 on a form
   * they have in fact finished.
   */
  const requiredProgress = useMemo(() => {
    const values = (watchedFormValues ?? {}) as Record<
      string,
      AudienceFieldValue | undefined
    >;
    const required = formFields.filter(
      (field) =>
        field.is_mandatory &&
        resolveDependentField(field.config, (k) => values[k]?.value).kind !== "empty"
    );
    if (required.length === 0) return null;
    const completed = required.filter((field) =>
      String(values[field.field_key]?.value ?? "").trim()
    ).length;
    return { completed, total: required.length };
  }, [formFields, watchedFormValues]);

  /**
   * Names of the fields the resolver rejected, for the summary above the submit
   * button. Long forms scroll the offending field out of view, so "Submit" that
   * merely does nothing is the single most common complaint about this page.
   */
  const invalidFieldNames = useMemo(() => {
    const errors = form.formState.errors as Record<string, unknown>;
    return formFields
      .filter((field) => Boolean(errors[field.field_key]))
      .map((field) => capitalise(field.field_name));
  }, [form.formState.errors, formFields]);

  const onSubmit = async (values: FormValues) => {
    const current = values as Record<string, AudienceFieldValue | undefined>;
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
    setLoading(true);
    try {
      // Build the payload using the helper function
      // Pass formFields to maintain the order from GET API (sorted by field_order)
      // This ensures custom_field_values in POST payload matches the order from GET API
      const customFieldsOrder = formFields.map((field) => ({
        id: field.id,
        field_key: field.field_key,
      }));
      const payload = handleSubmitAudienceLead(
        values,
        audienceId,
        campaignData.id,
        customFieldsOrder
      );

      await submitAudienceLead(payload);

      // Attribute the lead to the campaign that produced it. Fired after the
      // submit succeeded and before the reset, while the identity is still in
      // scope; it never throws, so it cannot turn a successful submission into
      // an error toast.
      // Fall back to the shared resolver when the payload's own lookup came up
      // empty. That lookup asks "does the field key contain 'email'?", which
      // finds nothing on an institute naming the field `cf_9812` or
      // `whatsapp_no` — and a touch with no identity is dropped by the server,
      // so that institute's campaign reporting stays silently empty with no
      // error to explain it. Additive: the payload sent to the lead API is
      // deliberately untouched.
      const resolvedIdentity = identityFromFormValues(values);
      trackUtmAttribution({
        instituteId,
        email: payload.user_dto?.email || resolvedIdentity.email || undefined,
        mobileNumber:
          payload.user_dto?.mobile_number || resolvedIdentity.phone || undefined,
        sourceType: "AUDIENCE",
        sourceId: audienceId,
      });

      // Capture identity BEFORE the reset — the thank-you screen and the
      // redirect URL both interpolate it.
      setRespondent(
        extractRespondentIdentity(
          values as Record<string, { value: string; id: string }>
        )
      );

      setIsSubmitted(true);
      form.reset();
    } catch (error: unknown) {
      console.error("Error submitting audience response:", error);
      const axiosLike = error as {
        response?: { data?: { message?: string; error?: string } };
        message?: string;
      };
      const errorMessage =
        axiosLike?.response?.data?.message ||
        axiosLike?.response?.data?.error ||
        axiosLike?.message ||
        t("audienceResponse.form.toast.submitFailed");
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Escape hatch. `customCss` rides a <style> element React owns, so it is
  // removed the moment this route unmounts and cannot bleed into the rest of
  // the SPA. `heroHtml` replaces the structured hero entirely.
  const customCss = useMemo(
    () => sanitizeCustomCss(appearance.customCss),
    [appearance.customCss]
  );
  const heroHtml = useMemo(() => resolveHeroHtml(appearance), [appearance]);
  // Card sub-heading: the admin's rich text, else their plain text, else the
  // translated default.
  const formSubtitleHtml = useMemo(
    () => resolveFormSubtitleHtml(appearance),
    [appearance]
  );

  // Whole-page template. Anything but `standard` owns the layout, background,
  // card and width; `standard` leaves all four to the individual knobs, which
  // is the page exactly as it rendered before templates existed.
  const shellTemplate = isShellTemplate(appearance.template)
    ? appearance.template
    : null;
  const look = shellTemplate ? FORM_TEMPLATE_LOOK[shellTemplate] : null;
  const cardVariant = look?.cardVariant ?? FORM_CARD_VARIANT[appearance.cardStyle];
  const cardClass = look?.card ?? FORM_CARD_CLASS[appearance.cardStyle];
  const columnClass = look?.column ?? FORM_WIDTH_CLASS[appearance.width];
  const pageClass = look?.page ?? FORM_BACKGROUND_CLASS[appearance.background];
  // These templates paint the cover image behind the heading, so the heading
  // block must not draw it a second time above itself.
  const coverOnBackdrop =
    shellTemplate !== null && BACKDROP_TEMPLATES.includes(shellTemplate);

  /**
   * Sticky branding bar — identical on the form and the thank-you screen.
   * `showHeader: false` drops it on both, for a page embedded under the
   * institute's own site header.
   */
  const header = appearance.showHeader && (
    <nav
      className={cn(
        AUDIENCE_FORM_HOOKS.header,
        // Solid, not translucent-blurred: a hairline-bordered white bar is the
        // standard header for a page whose whole job is one form.
        "sticky top-0 z-30 border-b border-border bg-card",
        look?.header
      )}
    >
      <div className={cn("mx-auto w-full px-page py-3", columnClass)}>
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
    </nav>
  );

  if (isInstituteLoading) {
    return <DashboardLoader />;
  }

  // Show success message after submission
  if (isSubmitted) {
    // Master switch off (the default) → the exact screen this page rendered
    // before the feature existed.
    const useCustomScreen = postSubmitConfig.enabled;
    const successTitle = applyPostSubmitTokens(
      postSubmitConfig.successTitle,
      postSubmitTokens
    );
    const successMessage = applyPostSubmitTokens(
      postSubmitConfig.successMessage,
      postSubmitTokens
    );
    // Custom HTML replaces the plain message when the admin supplied one.
    const successHtml = postSubmitConfig.content.trim()
      ? sanitizePostSubmitHtml(
          applyPostSubmitTokens(postSubmitConfig.content, postSubmitTokens)
        )
      : "";
    // Buttons pointing somewhere unsafe are dropped, not rendered dead.
    const actionButtons = resolvePostSubmitButtons(
      postSubmitConfig,
      postSubmitTokens
    );
    const showAnother = postSubmitConfig.allowAnotherResponse;
    const anotherLabel =
      applyPostSubmitTokens(postSubmitConfig.anotherResponseText, postSubmitTokens) ||
      t("audienceResponse.form.success.submitAnotherDefault");

    const handleAnotherResponse = () => {
      form.reset(defaultValues);
      setRespondent({});
      setIsSubmitted(false);
    };

    return (
      <div
        ref={embedHeightRef}
        className={cn(
          AUDIENCE_FORM_HOOKS.page,
          AUDIENCE_FORM_HOOKS.success,
          "min-h-screen w-full",
          pageClass
        )}
      >
        {customCss && <style>{customCss}</style>}
        {header}

        <main className="px-page py-8 sm:py-12">
          <div className={cn("mx-auto w-full", columnClass)}>
            <ModernCard
              variant={cardVariant}
              padding="lg"
              rounded="lg"
              className={cardClass}
            >
              <div className="flex flex-col items-center gap-section py-4 text-center sm:py-8">
                <PostSubmitArtwork config={postSubmitConfig} size="lg" />

                {/* Copy, CTA and redirect all come from the campaign's Post
                    Submit Configuration. */}
                <div className="flex flex-col gap-3">
                  {(useCustomScreen
                    ? successTitle
                    : t("audienceResponse.form.success.defaultTitle")) && (
                    <h1 className="text-h2 font-semibold text-foreground sm:text-h1">
                      {useCustomScreen
                        ? successTitle
                        : t("audienceResponse.form.success.defaultTitle")}
                    </h1>
                  )}
                  {useCustomScreen && successHtml ? (
                    <div
                      className={cn(
                        "text-subtitle text-muted-foreground",
                        FORM_RICH_TEXT_CLASS
                      )}
                      dangerouslySetInnerHTML={{ __html: successHtml }}
                    />
                  ) : (
                    (useCustomScreen
                      ? successMessage
                      : t("audienceResponse.form.success.defaultMessage")) && (
                      <p className="whitespace-pre-line text-subtitle text-muted-foreground">
                        {useCustomScreen
                          ? successMessage
                          : t("audienceResponse.form.success.defaultMessage")}
                      </p>
                    )
                  )}
                  {campaignData.send_respondent_email && (
                    <p className="text-caption text-muted-foreground">
                      {t("audienceResponse.form.success.confirmationEmailNotice")}
                    </p>
                  )}
                  {redirectUrl && secondsLeft !== null && (
                    <p className="text-caption text-muted-foreground">
                      {t("audienceResponse.form.success.redirecting", {
                        count: secondsLeft,
                      })}
                    </p>
                  )}
                </div>

                {useCustomScreen && (actionButtons.length > 0 || showAnother) && (
                  <div className="flex w-full flex-col flex-wrap items-stretch justify-center gap-stack sm:w-auto sm:flex-row sm:items-center">
                    {actionButtons.map((button) => (
                      // Anchors, not buttons: middle-click / "open in new tab"
                      // is what people expect from a link on a thank-you page.
                      <a
                        key={button.id}
                        href={button.href}
                        {...(isExternalPostSubmitUrl(button.href)
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        className={cn(
                          "inline-flex h-10 items-center justify-center rounded-md px-6 text-subtitle font-semibold transition-colors",
                          button.variant === "primary"
                            ? // Brand, NOT `accent`. `accent` defaults to
                              // "success" so the icon bubble stays the green
                              // check this screen has always shown; wiring the
                              // CTA to it too would silently repaint every
                              // existing campaign's button green.
                              "bg-primary-500 text-white hover:bg-primary-400"
                            : "border border-border text-foreground hover:bg-accent"
                        )}
                      >
                        {button.text}
                      </a>
                    ))}
                    {showAnother && (
                      <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="large"
                        layoutVariant="default"
                        onClick={handleAnotherResponse}
                      >
                        {anotherLabel}
                      </MyButton>
                    )}
                  </div>
                )}
              </div>
            </ModernCard>
          </div>
        </main>
      </div>
    );
  }

  // Every structured block switched off → no hero at all, so the classic
  // layout does not wrap an empty card and split does not keep an empty column.
  const showHero =
    Boolean(heroHtml) ||
    hasStructuredHeroContent(appearance, {
      name: campaignData.campaign_name,
      description: campaignData.description,
      objective: campaignData.campaign_objective,
    });

  const hero = heroHtml ? (
    // Hand-built pitch. Sanitized upstream, and deliberately WITHOUT the
    // rich-text class map: those are Tailwind arbitrary variants like
    // `[&_ul]:list-disc` at specificity (0,2,0), which outrank an admin's own
    // `.my-list { list-style: none }` and would quietly override the styling
    // they wrote. Taking over the hero means owning its CSS too.
    <div
      className={AUDIENCE_FORM_HOOKS.hero}
      dangerouslySetInnerHTML={{ __html: heroHtml }}
    />
  ) : (
    <AudienceFormHero
      appearance={
        coverOnBackdrop ? { ...appearance, coverImageUrl: "" } : appearance
      }
      tone={look?.heroTone}
      campaignName={campaignData.campaign_name}
      campaignDescription={campaignData.description}
      campaignObjective={campaignData.campaign_objective}
      objectiveLabel={t("audienceResponse.form.campaign.objectiveLabel")}
      className={AUDIENCE_FORM_HOOKS.hero}
    />
  );

  const formCard = (
    <ModernCard
      variant={cardVariant}
      padding="lg"
      rounded="lg"
      className={cn(AUDIENCE_FORM_HOOKS.card, "flex flex-col gap-section", cardClass)}
      id="response-form-card"
    >
      <div
        className={cn(
          AUDIENCE_FORM_HOOKS.cardHeader,
          "flex flex-col gap-2",
          FORM_TEXT_ALIGN_CLASS[appearance.formHeaderAlign]
        )}
      >
        <h2 className="text-h3 font-semibold text-foreground">
          {appearance.formTitle.trim() ||
            t("audienceResponse.form.details.title")}
        </h2>
        {formSubtitleHtml ? (
          <div
            className={cn("text-body text-muted-foreground", FORM_RICH_TEXT_CLASS)}
            dangerouslySetInnerHTML={{ __html: formSubtitleHtml }}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            {resolveFormSubtitle(appearance) ||
              t("audienceResponse.form.details.subtitle")}
          </p>
        )}

        {appearance.showProgress && requiredProgress && (
          <div className="mt-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-caption text-muted-foreground">
              <span>
                {t("audienceResponse.form.details.progress", {
                  completed: requiredProgress.completed,
                  total: requiredProgress.total,
                })}
              </span>
              <span aria-hidden="true">
                {Math.round(
                  (requiredProgress.completed / requiredProgress.total) * 100
                )}
                %
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={requiredProgress.total}
              aria-valuenow={requiredProgress.completed}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300 ease-out",
                  FORM_ACCENT_METER_CLASS[appearance.accent]
                )}
                // The only genuinely dynamic value on the page — a percentage
                // that cannot be enumerated as a Tailwind class.
                style={{
                  width: `${Math.round(
                    (requiredProgress.completed / requiredProgress.total) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {appearance.showRequiredLegend && (
          <p className="text-caption text-muted-foreground">
            <span className="text-danger-600">*</span>{" "}
            {t("audienceResponse.form.details.requiredLegend")}
          </p>
        )}
      </div>

      <FormProvider {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex w-full flex-col gap-section"
          // Deliberately NOT noValidate. getDynamicSchema only enforces
          // `z.string().min(1)` on mandatory fields — nothing checks that an
          // email looks like an email. That check comes entirely from the
          // browser, via CustomFieldRenderer's inputType="email" / "url".
          // Turning native validation off here would let malformed addresses
          // through and silently break the respondent confirmation email.
        >
          {formFields.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <WarningCircle
                className="size-8 text-muted-foreground"
                weight="duotone"
                aria-hidden="true"
              />
              <p className="text-subtitle font-semibold text-foreground">
                {t("audienceResponse.form.noFields.title")}
              </p>
              <p className="text-body text-muted-foreground">
                {t("audienceResponse.form.noFields.description")}
              </p>
            </div>
          ) : (
            <div className={cn(AUDIENCE_FORM_HOOKS.fields, "flex flex-col gap-4 sm:gap-5")}>
              {formFields.map((field) => {
                const key = field.field_key;
                // Watched values are undefined on the very first render pass;
                // fall back so a field never renders without its metadata.
                const formValues = (watchedFormValues ??
                  defaultValues) as Record<
                  string,
                  AudienceFieldValue | undefined
                >;
                const value = formValues[key] ?? defaultValues[key];

                const renderType =
                  value?.render_type ??
                  getFieldRenderType(
                    key,
                    value?.type || field.field_type || "text"
                  );
                const label = capitalise(value?.name ?? field.field_name);
                const isMandatory = value?.is_mandatory ?? field.is_mandatory;
                // Cascading dropdown: options follow the parent field's value.
                const dependent = resolveDependentField(
                  value?.config ?? field.config,
                  (k) => formValues[k]?.value
                );
                if (dependent.kind === "empty") return null;
                const parentLabel =
                  dependent.kind === "waiting"
                    ? capitalise(
                        formFields.find((f) => f.field_key === dependent.parentFieldKey)
                          ?.field_name ?? ""
                      )
                    : "";

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
                              label={label}
                              placeholder={t("common.phoneExamplePlaceholder")}
                              name={`${key}.value`}
                              control={form.control}
                              country={phoneCountryCode}
                              required={isMandatory}
                              labelClassName="text-body font-semibold text-foreground"
                              inputClassName="!h-10 !text-subtitle placeholder:!text-body"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  );
                }

                // All other types — shared renderer handles text, number,
                // email, url, date, textarea, checkbox, radio, dropdown, file
                return (
                  <FormField
                    key={key}
                    control={form.control}
                    name={`${key}.value`}
                    render={({ field: formField }) => (
                      <FormItem>
                        <div className="flex flex-col gap-1.5">
                          {/* Checkbox fields render their own inline label
                              (and optional description block) inside the
                              renderer — skip the label-above to avoid a
                              duplicate. */}
                          {renderType !== FieldRenderType.CHECKBOX && (
                            <label className="text-body font-semibold text-foreground">
                              {label}
                              {isMandatory && (
                                <span className="text-danger-600"> *</span>
                              )}
                            </label>
                          )}
                          <FormControl>
                            <CustomFieldRenderer
                              type={renderType}
                              name={value?.name ?? field.field_name}
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
                              config={value?.config ?? field.config}
                              options={
                                dependent.kind === "ready"
                                  ? dependent.options
                                  : value?.comma_separated_options
                              }
                              disabled={dependent.kind === "waiting"}
                              placeholder={
                                dependent.kind === "waiting" && parentLabel
                                  ? t("audienceResponse.form.selectParentFirst", {
                                      name: parentLabel.toLowerCase(),
                                    })
                                  : undefined
                              }
                              required={isMandatory}
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

          {invalidFieldNames.length > 0 && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-danger-200 bg-danger-50 p-card"
            >
              <WarningCircle
                className="mt-0.5 size-5 shrink-0 text-danger-600"
                weight="duotone"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-1">
                <p className="text-body font-semibold text-danger-600">
                  {t("audienceResponse.form.errors.title")}
                </p>
                <p className="text-caption text-neutral-600">
                  {invalidFieldNames.join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Rendered even with zero fields, exactly as before. Hiding it would
              be a nicer empty state but it removes a submit path that shipped,
              and this is a public page — not the place to change what a visitor
              can do. */}
          <div className="flex justify-end">
              <MyButton
                type="submit"
                buttonType="primary"
                scale="large"
                layoutVariant="default"
                disabled={loading}
                className={cn(
                  AUDIENCE_FORM_HOOKS.submit,
                  "w-full sm:w-auto",
                  appearance.accent !== "primary" &&
                    FORM_ACCENT_BUTTON_CLASS[appearance.accent],
                  look?.submit
                )}
              >
                <span className="inline-flex items-center gap-2">
                  {loading && (
                    <CircleNotch
                      className="size-4 animate-spin"
                      weight="bold"
                      aria-hidden="true"
                    />
                  )}
                  {loading
                    ? t("audienceResponse.form.submitButton.submitting")
                    : appearance.submitLabel.trim() ||
                      t("audienceResponse.form.submitButton.default")}
                </span>
              </MyButton>
          </div>
        </form>
      </FormProvider>
    </ModernCard>
  );

  const footerNoteHtml = appearance.footerNote.trim()
    ? sanitizePostSubmitHtml(appearance.footerNote)
    : "";
  const footer = footerNoteHtml && (
    <div
      className={cn(
        AUDIENCE_FORM_HOOKS.footer,
        "mx-auto mt-8 max-w-2xl text-center text-caption text-muted-foreground",
        FORM_RICH_TEXT_CLASS,
        look?.footer
      )}
      dangerouslySetInnerHTML={{ __html: footerNoteHtml }}
    />
  );

  return (
    <div
      ref={embedHeightRef}
      className={cn(AUDIENCE_FORM_HOOKS.page, "min-h-screen w-full", pageClass)}
    >
      {/* Admin-authored CSS. Rendered by React so it is torn down with the
          route — a global stylesheet would follow the visitor around the SPA. */}
      {customCss && <style>{customCss}</style>}
      {header}

      {shellTemplate ? (
        <AudienceFormTemplateShell
          template={shellTemplate}
          columnClass={columnClass}
          coverImageUrl={appearance.coverImageUrl}
          logoFileId={instituteData?.institute_logo_file_id ?? null}
          hero={showHero ? hero : null}
          formCard={formCard}
          footer={footer}
        />
      ) : (
        <main className="px-page py-8 sm:py-12">
          <div className={cn("mx-auto w-full", columnClass)}>
            {appearance.layout === "split" && showHero ? (
              // Two columns from `lg` up: the pitch stays in view while a long
              // form scrolls beside it.
              <div className="grid gap-section lg:grid-cols-12">
                <div className="lg:col-span-5">
                  <div className="lg:sticky lg:top-24">{hero}</div>
                </div>
                <div className="lg:col-span-7">{formCard}</div>
              </div>
            ) : (
              <div className="flex flex-col gap-section">
                {!showHero ? null : appearance.layout === "classic" ? (
                  // The pre-2026-08 shape: the pitch in its own card.
                  <ModernCard
                    variant={cardVariant}
                    padding="lg"
                    rounded="lg"
                    className={cardClass}
                  >
                    {hero}
                  </ModernCard>
                ) : (
                  hero
                )}
                {formCard}
              </div>
            )}

            {footer}
          </div>
        </main>
      )}
    </div>
  );
};

export default AudienceResponseForm;
