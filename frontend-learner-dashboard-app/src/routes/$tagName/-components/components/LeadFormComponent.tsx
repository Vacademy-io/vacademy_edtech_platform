import React, { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import { CustomFieldRenderer } from "@/components/common/custom-fields/CustomFieldRenderer";
import { getFieldVerification } from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import { FieldVerification } from "@/routes/product-pages/$productPageCode/-components/FieldVerification";
import {
  FieldRenderType,
  dependentFieldKeys,
  getFieldRenderType,
  resolveDependentField,
} from "@/components/common/enroll-by-invite/-utils/custom-field-helpers";
import {
  extractRespondentIdentity,
  handleGetAudienceCampaign,
  handleSubmitAudienceLead,
  submitAudienceLead,
} from "@/routes/audience-response/-services/audience-campaign-services";
import {
  applyPostSubmitTokens,
  isDefaultPostSubmitConfiguration,
  isExternalPostSubmitUrl,
  parsePostSubmitConfiguration,
  resolvePostSubmitButtons,
  sanitizePostSubmitHtml,
  type PostSubmitTokens,
} from "@/routes/audience-response/-utils/post-submit-config";
import { usePostSubmitRedirect } from "@/routes/audience-response/-utils/use-post-submit-redirect";
import { isSpamSubmission } from "../../-utils/website-lead";
import { emitLeadCaptured } from "../../-utils/catalogue-tracking";
import { useSiteT } from "../../-utils/catalogue-locale";

/**
 * Lead Form — an Audience campaign's form rendered natively on a catalogue
 * page (inline section or inside the popup modal).
 *
 * The form DEFINITION lives in the CRM: the campaign's AUDIENCE_FORM custom
 * fields (label, type, options, mandatory, order) are fetched from the
 * anonymous `open/v1/audience/campaign/{instituteId}/{audienceId}` endpoint,
 * so the admin edits fields once in Audience Manager and every placement of
 * the form follows. Submissions go through the same `lead/submit` pipeline
 * the standalone /audience-response page uses — dedup, scoring, counsellor
 * assignment and workflows all behave identically.
 *
 * This intentionally does NOT reuse the /audience-response page component:
 * that renders full-page chrome (nav bar, glass cards) for iframe embedding.
 * Here the fields render bare, on catalogue tokens, inside whatever section
 * or dialog hosts them.
 */

interface LeadFormProps {
  /** The Audience campaign whose form to render. Chosen by the admin. */
  audienceId?: string;
  /** Snapshot of the campaign name for the editor UI; display uses live data. */
  audienceName?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  successMessage?: string;
  /** 'card' wraps the fields in an elevated card; 'bare' for modal/column use. */
  layout?: "card" | "bare";
  align?: "center" | "left";
  backgroundColor?: string;
  /** 'section' renders the full catalogue section; 'embedded' just the form. */
  variant?: "section" | "embedded";
  /**
   * Fired once the visitor's submission is accepted (the gated-resource modal
   * unlocks on it). Carries the email/phone they typed when a lead was really
   * created, so later freebie downloads can be tied to that lead.
   */
  onSubmitted?: (identity?: { email: string; mobileNumber: string }) => void;
  instituteId?: string;
  isPreviewMode?: boolean;
}

interface FormFieldDef {
  id: string;
  key: string;
  name: string;
  type: string;
  config: string;
  mandatory: boolean;
}

export const LeadFormComponent: React.FC<LeadFormProps> = ({
  audienceId,
  title,
  subtitle,
  submitLabel,
  successMessage,
  layout = "card",
  align = "center",
  backgroundColor,
  variant = "section",
  instituteId,
  isPreviewMode = false,
  onSubmitted,
}) => {
  const { t } = useTranslation("coursePlayerB");
  // Field labels come live from the CRM campaign, so they are translated at
  // display only — keys, ids and the submitted values never are.
  const siteT = useSiteT();
  const { data: campaign, isLoading, isError } = useQuery({
    ...handleGetAudienceCampaign({
      instituteId: instituteId || "",
      audienceId: audienceId || "",
    }),
  });

  const [values, setValues] = useState<Record<string, string>>({});
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [respondent, setRespondent] = useState<PostSubmitTokens>({});
  // The VALUE that was verified per field, not a boolean — editing a verified
  // number has to re-arm the gate. Same contract as the checkout form.
  const [verifiedValues, setVerifiedValues] = useState<Record<string, string>>({});
  const mountedAt = useRef(Date.now());

  const fields: FormFieldDef[] = useMemo(() => {
    const raw = campaign?.institute_custom_fields || [];
    return raw
      .filter((f) => f?.custom_field && f.status !== "DELETED")
      .sort((a, b) => (a.individual_order ?? 0) - (b.individual_order ?? 0))
      .map((f) => ({
        id: f.custom_field.id,
        key: f.custom_field.fieldKey,
        name: f.custom_field.fieldName,
        type: f.custom_field.fieldType || "text",
        config: f.custom_field.config || "{}",
        mandatory: !!f.custom_field.isMandatory,
      }));
  }, [campaign]);

  // Post-submit behaviour (thank-you copy, CTA, redirect) is authored once per
  // campaign in Audience Manager and applies to every placement of its form —
  // this inline/modal one included. The builder's own `successMessage` prop
  // still wins when set, since that is a deliberate per-placement override.
  const postSubmitConfig = useMemo(
    () => parsePostSubmitConfiguration(campaign?.setting_json),
    [campaign?.setting_json]
  );
  const postSubmitTokens: PostSubmitTokens = useMemo(
    () => ({ ...respondent, campaignName: campaign?.campaign_name }),
    [respondent, campaign?.campaign_name]
  );
  const { redirectUrl, secondsLeft } = usePostSubmitRedirect(
    postSubmitConfig,
    postSubmitTokens,
    // Gated on the master switch, and never for the admin previewing the page.
    done && !isPreviewMode && postSubmitConfig.enabled
  );

  const isLeft = align === "left";

  const section = (children: React.ReactNode) =>
    variant === "embedded" ? (
      <div>{children}</div>
    ) : (
      <section
        className="catalogue-section bg-catalogue-bg"
        style={backgroundColor ? { backgroundColor } : undefined}
      >
        <div className="catalogue-shell-narrow">
          {(title || subtitle) && (
            <div className={`catalogue-section-header ${isLeft ? "text-start" : "text-center"}`}>
              {title && <h2 className="catalogue-h2 text-catalogue-text-primary">{title}</h2>}
              {subtitle && (
                <p className={`catalogue-lead text-catalogue-text-muted ${isLeft ? "catalogue-measure-start" : "catalogue-measure"}`}>
                  {subtitle}
                </p>
              )}
            </div>
          )}
          {children}
        </div>
      </section>
    );

  // ── Unconfigured / broken: guide the admin, stay invisible to visitors ──
  if (!audienceId || !instituteId) {
    if (!isPreviewMode) return null;
    return section(
      <div className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
        {t("leadForm.emptyConfig")}
      </div>
    );
  }

  if (isLoading) {
    return section(
      <div className="catalogue-card-elevated space-y-4 p-6" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="space-y-2" key={i}>
            <div className="catalogue-skeleton-shimmer h-4 w-1/3 rounded-catalogue-xs" />
            <div className="catalogue-skeleton-shimmer h-10 w-full rounded-catalogue-md" />
          </div>
        ))}
      </div>
    );
  }

  if (isError || fields.length === 0) {
    if (!isPreviewMode) return null;
    return section(
      <div className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
        {isError
          ? t("leadForm.errorLoad")
          : t("leadForm.emptyFields")}
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) return;
    setError("");

    // A dependent dropdown with nothing to offer for the chosen parent is
    // hidden, so it cannot be required either.
    const missing = fields.filter(
      (f) =>
        f.mandatory &&
        resolveDependentField(f.config, (k) => values[k]).kind !== "empty" &&
        !(values[f.key] || "").trim()
    );
    if (missing.length > 0) {
      setError(t("leadForm.missingFields", { fields: missing.map((f) => siteT(f.name)).join(", ") }));
      return;
    }

    // Checked here as well as in the UI — a hidden button is not a guarantee.
    const unverified = fields.filter(
      (f) =>
        getFieldVerification(f.config) &&
        (values[f.key] || "").trim() &&
        verifiedValues[f.key] !== values[f.key],
    );
    if (unverified.length > 0) {
      setError(`Please verify: ${unverified.map((f) => siteT(f.name)).join(", ")}`);
      return;
    }

    // Spam verdicts show the normal success state — never tell a bot it lost.
    // onSubmitted still fires: a fast autofill can trip the timer, and what it
    // unlocks (public resource links) is not worth stranding a real parent.
    if (isSpamSubmission(honeypot, mountedAt.current)) {
      setDone(true);
      onSubmitted?.();
      return;
    }

    setSubmitting(true);
    try {
      const formValues: Record<string, { value: string; id: string }> = {};
      fields.forEach((f) => {
        formValues[f.key] = { value: values[f.key] || "", id: f.id };
      });
      const payload = handleSubmitAudienceLead(
        formValues,
        audienceId,
        audienceId,
        fields.map((f) => ({ id: f.id, field_key: f.key }))
      );
      await submitAudienceLead(payload);
      emitLeadCaptured({ audienceId, sourceType: "AUDIENCE_CAMPAIGN", sourceId: audienceId });
      // Identity feeds the {{name}} / {{email}} tokens on the thank-you screen
      // and in the redirect query string.
      setRespondent(extractRespondentIdentity(formValues));
      setDone(true);
      onSubmitted?.({
        email: payload.user_dto?.email || "",
        mobileNumber: payload.user_dto?.mobile_number || "",
      });
    } catch {
      setError(t("leadForm.genericError"));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    // Campaigns that never opened the Post Submit Configuration card keep the
    // exact block this section rendered before the feature existed — no
    // heading, catalogue check icon, original fallback copy. Imposing default
    // copy on live catalogue pages nobody edited would be a silent regression.
    const untouched = isDefaultPostSubmitConfiguration(postSubmitConfig);

    if (untouched) {
      return section(
        <div
          className="catalogue-card-elevated flex flex-col items-center gap-stack p-8 text-center"
          role="status"
        >
          <CheckCircle
            weight="duotone"
            className="size-10 text-catalogue-brand-ink"
            aria-hidden="true"
          />
          <p className="text-base font-semibold text-catalogue-text-primary">
            {successMessage || t("leadForm.defaultThankYou")}
          </p>
        </div>
      );
    }

    // Precedence: the page-builder's per-placement `successMessage` wins, then
    // the campaign's Post Submit Configuration, then the original fallback copy.
    const heading = applyPostSubmitTokens(
      postSubmitConfig.successTitle,
      postSubmitTokens
    );
    const configuredHtml = postSubmitConfig.content.trim()
      ? sanitizePostSubmitHtml(
          applyPostSubmitTokens(postSubmitConfig.content, postSubmitTokens)
        )
      : "";
    const configuredMessage = applyPostSubmitTokens(
      postSubmitConfig.successMessage,
      postSubmitTokens
    );
    const body =
      successMessage || configuredMessage || t("leadForm.defaultThankYou");
    const actionButtons = resolvePostSubmitButtons(postSubmitConfig, postSubmitTokens);
    const anotherLabel =
      applyPostSubmitTokens(postSubmitConfig.anotherResponseText, postSubmitTokens) ||
      t("leadForm.defaultAnotherResponse");

    const resetForm = () => {
      setValues({});
      setHoneypot("");
      setRespondent({});
      setError("");
      setDone(false);
    };

    return section(
      <div
        className="catalogue-card-elevated flex flex-col items-center gap-stack p-8 text-center"
        role="status"
      >
        <CheckCircle
          weight="duotone"
          className="size-10 text-catalogue-brand-ink"
          aria-hidden="true"
        />
        {heading && (
          <p className="catalogue-h3 text-catalogue-text-primary">{heading}</p>
        )}
        {!successMessage && configuredHtml ? (
          <div
            className="text-base text-catalogue-text-secondary [&_a]:underline [&_h1]:catalogue-h3 [&_h2]:catalogue-h3 [&_img]:mx-auto [&_img]:max-w-full [&_li]:list-inside [&_ol]:list-decimal [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: configuredHtml }}
          />
        ) : (
          <p className="whitespace-pre-line text-base font-semibold text-catalogue-text-primary">
            {body}
          </p>
        )}
        {redirectUrl && secondsLeft !== null && (
          <p className="text-sm text-catalogue-text-muted">
            {t("leadForm.redirectingIn", { count: secondsLeft })}
          </p>
        )}
        {(actionButtons.length > 0 || postSubmitConfig.allowAnotherResponse) && (
          <div className="mt-2 flex flex-col flex-wrap justify-center gap-stack sm:flex-row">
            {actionButtons.map((button) => (
              <a
                key={button.id}
                href={button.href}
                {...(isExternalPostSubmitUrl(button.href)
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                // Catalogue buttons keep catalogue tokens rather than the
                // config's accent, so they stay on the page's own theme.
                className={`catalogue-btn justify-center ${
                  button.variant === "primary"
                    ? "catalogue-btn-primary"
                    : "catalogue-btn-secondary"
                }`}
              >
                {button.text}
              </a>
            ))}
            {postSubmitConfig.allowAnotherResponse && (
              <button
                type="button"
                onClick={resetForm}
                className="catalogue-btn catalogue-btn-secondary justify-center"
              >
                {anotherLabel}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const formBody = (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {fields.map((f) => {
        // A checkbox carries its own label beside the box, and the renderer
        // prints `name` there — pass the human label, not the field key, and
        // skip the label above so the question is not shown twice.
        const renderType = getFieldRenderType(f.key, f.type);
        const isCheckbox = renderType === FieldRenderType.CHECKBOX;
        // Cascading dropdown (e.g. Course → Query): options follow the parent's value.
        const dependent = resolveDependentField(f.config, (k) => values[k]);
        if (dependent.kind === "empty") return null;
        const parentName =
          dependent.kind === "waiting"
            ? siteT(fields.find((p) => p.key === dependent.parentFieldKey)?.name || "")
            : "";
        return (
        <div key={f.id}>
          {!isCheckbox && (
            <label className="mb-1.5 block text-sm font-medium text-catalogue-text-secondary">
              {siteT(f.name)}
              {f.mandatory && <span className="ms-1 text-catalogue-brand-ink">*</span>}
            </label>
          )}
          <CustomFieldRenderer
            type={renderType}
            // A checkbox prints `name` as its visible label; every other type
            // uses it as the field's id, so that one stays the stored key.
            name={isCheckbox ? siteT(f.name) : f.key}
            value={values[f.key] || ""}
            onChange={(v: string) =>
              setValues((prev) => {
                const next = { ...prev, [f.key]: v };
                // A changed parent invalidates whatever its dependents held.
                if (prev[f.key] !== v) dependentFieldKeys(f.key, fields).forEach((k) => delete next[k]);
                return next;
              })
            }
            config={f.config}
            options={dependent.kind === "ready" ? dependent.options : undefined}
            disabled={dependent.kind === "waiting"}
            required={f.mandatory}
            // Without this the renderer falls back to `Enter ${name}` where
            // name is the raw field KEY — visitors saw "Enter full_name" and
            // "Enter details_inst_<uuid>". Use the human label.
            placeholder={
              dependent.kind === "waiting" && parentName
                ? t("leadForm.selectParentFirst", { name: parentName.toLowerCase() })
                : t("leadForm.placeholderPrefix", { name: siteT(f.name).toLowerCase() })
            }
          />
          {/* Same gate the product-page checkout uses, driven by the same
              per-field config — so a form built here can ask a visitor to prove
              they own the number before the lead is accepted. */}
          {(() => {
            const verification = getFieldVerification(f.config);
            if (!verification || !instituteId) return null;
            return (
              <div className="mt-2">
                <FieldVerification
                  verification={verification}
                  value={values[f.key] || ""}
                  instituteId={instituteId}
                  label={siteT(f.name)}
                  verified={
                    !!values[f.key] && verifiedValues[f.key] === values[f.key]
                  }
                  onVerified={(verifiedValue) => {
                    setVerifiedValues((prev) => ({ ...prev, [f.key]: verifiedValue }));
                    setError("");
                  }}
                  disabled={isPreviewMode}
                />
              </div>
            );
          })()}
        </div>
        );
      })}

      {/* Honeypot — visually hidden from humans, irresistible to bots.
          aria-hidden + tabIndex -1 keep it out of assistive tech and tabbing. */}
      <div className="sr-only" aria-hidden="true">
        <label>
          {t("leadForm.companyWebsite")}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="rounded-catalogue-md bg-warning-50 px-4 py-2.5 text-sm text-catalogue-text-secondary" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="catalogue-btn catalogue-btn-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t("leadForm.sending") : submitLabel || t("leadForm.submit")}
        {!submitting && <PaperPlaneTilt className="size-4" weight="bold" aria-hidden="true" />}
      </button>
    </form>
  );

  return section(
    layout === "card" ? (
      <div className="catalogue-card-elevated relative p-6 sm:p-8">{formBody}</div>
    ) : (
      <div className="relative">{formBody}</div>
    )
  );
};

export default LeadFormComponent;
