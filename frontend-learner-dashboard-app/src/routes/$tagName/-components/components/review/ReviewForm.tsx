import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { CheckCircle, Star } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ReviewService } from "../../../-services/review-service";
import { siteVisitorId } from "../../../-utils/site-visitor";
import {
  buildReviewSubmission,
  fieldMaxLength,
  validateReviewForm,
  type ReviewField,
  type ReviewFieldError,
  type ReviewFormValues,
} from "../../../-utils/review-collector";

/**
 * The review form itself: the block's fields in the admin's order — stars,
 * name and review plus course / city / designation and any custom questions.
 * Used inside the popup, the launcher's panel and the inline section alike.
 */

export interface ReviewFormLabels {
  heading?: string;
  subheading?: string;
  submitLabel?: string;
  successHeading?: string;
  successMessage?: string;
}

export interface ReviewFormProps extends ReviewFormLabels {
  instituteId: string;
  tagName?: string;
  pageRoute?: string;
  fields: ReviewField[];
  /** Editor preview: shows the success state without sending anything. */
  isPreviewMode?: boolean;
  titleId?: string;
  onSubmitted?: () => void;
}

/* ── stars ───────────────────────────────────────────────────────────── */

const StarRatingInput: React.FC<{
  value: number;
  onChange: (v: number) => void;
  invalid: boolean;
  labelId: string;
  describedBy?: string;
}> = ({ value, onChange, invalid, labelId, describedBy }) => {
  const { t } = useTranslation("coursePlayerB");
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className="flex items-center gap-1"
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <label
          key={n}
          className="cursor-pointer rounded-catalogue-sm p-0.5 transition-transform hover:scale-110 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-300 motion-reduce:transition-none motion-reduce:hover:scale-100"
          onMouseEnter={() => setHover(n)}
        >
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            className="sr-only"
            aria-label={t("reviewCollector.starsA11y", { count: n })}
          />
          <Star
            size={32}
            weight={n <= shown ? "fill" : "regular"}
            className={n <= shown ? "text-warning-500" : "text-catalogue-text-muted"}
            aria-hidden="true"
          />
        </label>
      ))}
      <span className="ms-2 text-sm font-medium text-catalogue-text-secondary" aria-live="polite">
        {shown ? t(`reviewCollector.ratingName.${shown}`) : ""}
      </span>
    </div>
  );
};

/* ── form ────────────────────────────────────────────────────────────── */

const AUTOCOMPLETE: Partial<Record<ReviewField["kind"], string>> = {
  reviewerName: "name",
  city: "address-level2",
  designation: "organization-title",
  email: "email",
  phone: "tel",
};

export const ReviewForm: React.FC<ReviewFormProps> = ({
  instituteId, tagName, pageRoute, fields, isPreviewMode = false, titleId, onSubmitted,
  heading, subheading, submitLabel, successHeading, successMessage,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [values, setValues] = useState<ReviewFormValues>({});
  const [errors, setErrors] = useState<Record<string, ReviewFieldError>>({});
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "failed" | "limited">("idle");
  const formId = useId();
  const inputId = (f: ReviewField) => `${formId}-${f.id}`;
  const errId = (f: ReviewField) => `${formId}-${f.id}-error`;

  /** The label the visitor sees: the admin's, else the built-in wording. */
  const labelOf = (f: ReviewField): string => {
    if (f.label && f.label.trim()) return f.label.trim();
    switch (f.kind) {
      case "rating":
        return t("reviewCollector.ratingLabel");
      case "reviewerName":
        return t("reviewCollector.nameLabel");
      case "reviewText":
        return t("reviewCollector.textLabel");
      case "courseName":
        return t("reviewCollector.courseLabel");
      case "city":
        return t("reviewCollector.cityLabel");
      case "designation":
        return t("reviewCollector.designationLabel");
      default:
        return t("reviewCollector.customFieldLabel");
    }
  };
  const placeholderOf = (f: ReviewField): string | undefined =>
    f.placeholder?.trim() || (f.kind === "reviewText" ? t("reviewCollector.textPlaceholder") : undefined);

  const set = (id: string, value: string | number) => {
    setValues((v) => ({ ...v, [id]: value }));
    if (errors[id]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[id];
        return next;
      });
    }
  };

  const errorText = (f: ReviewField) => {
    const code = errors[f.id];
    if (!code) return null;
    const msg =
      f.kind === "rating"
        ? t("reviewCollector.ratingRequired")
        : code === "required"
          ? t("reviewCollector.fieldRequired")
          : t(`reviewCollector.${code}`);
    return (
      <p id={errId(f)} className="mt-1 text-xs text-danger-600">
        {msg}
      </p>
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateReviewForm(fields, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (isPreviewMode) {
      setStatus("done");
      return;
    }
    setStatus("sending");
    try {
      await ReviewService.submit({
        instituteId,
        catalogueTag: tagName,
        pageRoute,
        visitorKey: siteVisitorId(),
        website: honeypot,
        ...buildReviewSubmission(fields, values, labelOf),
      });
      setStatus("done");
      onSubmitted?.();
    } catch (err) {
      setStatus(axios.isAxiosError(err) && err.response?.status === 429 ? "limited" : "failed");
    }
  };

  if (status === "done") {
    return (
      <div className="flex flex-col items-center py-6 text-center" role="status">
        <CheckCircle size={48} weight="fill" className="text-success-500" aria-hidden="true" />
        <h2 id={titleId} className="catalogue-h3 mt-4 text-catalogue-text-primary">
          {successHeading || t("reviewCollector.successHeading")}
        </h2>
        <p className="mt-2 text-sm text-catalogue-text-secondary">
          {successMessage || t("reviewCollector.successMessage")}
        </p>
        {isPreviewMode && <p className="mt-3 text-xs text-catalogue-text-muted">{t("reviewCollector.previewNoSave")}</p>}
      </div>
    );
  }

  const control = (f: ReviewField) => {
    const id = inputId(f);
    const value = values[f.id];
    const common = {
      id,
      value: value === undefined ? "" : String(value),
      "aria-invalid": errors[f.id] ? true : undefined,
      "aria-describedby": errors[f.id] ? errId(f) : undefined,
    };
    const label = (
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-catalogue-text-secondary">
        {labelOf(f)}
        {f.required && <span className="ms-1 text-catalogue-brand-ink">*</span>}
      </label>
    );

    if (f.kind === "rating") {
      const labelId = `${id}-label`;
      return (
        <>
          <p id={labelId} className="mb-1.5 text-sm font-medium text-catalogue-text-secondary">
            {labelOf(f)}
            <span className="ms-1 text-catalogue-brand-ink">*</span>
          </p>
          <StarRatingInput
            value={Number(value) || 0}
            onChange={(n) => set(f.id, n)}
            invalid={!!errors[f.id]}
            labelId={labelId}
            describedBy={errors[f.id] ? errId(f) : undefined}
          />
        </>
      );
    }
    if (f.kind === "reviewText" || f.kind === "textarea") {
      return (
        <>
          {label}
          <textarea
            {...common}
            rows={f.kind === "reviewText" ? 4 : 3}
            maxLength={fieldMaxLength(f.kind)}
            placeholder={placeholderOf(f)}
            onChange={(e) => set(f.id, e.target.value)}
            className="catalogue-input w-full resize-y"
          />
        </>
      );
    }
    if ((f.kind === "select" || f.kind === "courseName") && f.options && f.options.length > 0) {
      return (
        <>
          {label}
          <select {...common} onChange={(e) => set(f.id, e.target.value)} className="catalogue-input w-full">
            <option value="">{f.placeholder?.trim() || t("reviewCollector.selectPlaceholder")}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </>
      );
    }
    return (
      <>
        {label}
        <input
          {...common}
          type={f.kind === "email" ? "email" : f.kind === "phone" ? "tel" : f.kind === "number" ? "number" : "text"}
          inputMode={f.kind === "number" ? "decimal" : undefined}
          autoComplete={AUTOCOMPLETE[f.kind]}
          maxLength={f.kind === "number" ? undefined : fieldMaxLength(f.kind)}
          placeholder={placeholderOf(f)}
          onChange={(e) => set(f.id, e.target.value)}
          className="catalogue-input w-full"
        />
      </>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <h2 id={titleId} className="catalogue-h3 text-catalogue-text-primary">
          {heading || t("reviewCollector.heading")}
        </h2>
        <p className="mt-1 text-sm text-catalogue-text-secondary">{subheading || t("reviewCollector.subheading")}</p>
      </div>

      {/* Half-width fields share a row on wider screens, in the admin's order. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.id} className={cn(f.width !== "half" && "sm:col-span-2")} data-review-field={f.kind}>
            {control(f)}
            {errorText(f)}
          </div>
        ))}
      </div>

      {/* Honeypot: off-screen and skipped by keyboard and autofill; people never fill it. */}
      <div className="sr-only" aria-hidden="true">
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </label>
      </div>

      {(status === "failed" || status === "limited") && (
        <p className="rounded-catalogue-md bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
          {status === "limited" ? t("reviewCollector.tooMany") : t("reviewCollector.failed")}
        </p>
      )}

      <button type="submit" disabled={status === "sending"} className="catalogue-btn catalogue-btn-primary w-full">
        {status === "sending" ? t("reviewCollector.sending") : submitLabel || t("reviewCollector.submit")}
      </button>
    </form>
  );
};
