import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { CheckCircle, Star } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ReviewService } from "../../../-services/review-service";
import { siteVisitorId } from "../../../-utils/site-visitor";
import {
  EMPTY_REVIEW,
  REVIEW_NAME_MAX,
  REVIEW_TEXT_MAX,
  reviewPayload,
  validateReview,
  type ReviewErrorKey,
  type ReviewFields,
  type ReviewValues,
} from "../../../-utils/review-collector";

/**
 * The review form itself — stars, name and whichever of text / city / course /
 * designation the block asks for. Used inside the popup, the launcher's panel
 * and the inline section alike.
 */

export interface ReviewFormLabels {
  heading?: string;
  subheading?: string;
  nameLabel?: string;
  textLabel?: string;
  textPlaceholder?: string;
  cityLabel?: string;
  courseLabel?: string;
  designationLabel?: string;
  submitLabel?: string;
  successHeading?: string;
  successMessage?: string;
}

export interface ReviewFormProps extends ReviewFormLabels {
  instituteId: string;
  tagName?: string;
  pageRoute?: string;
  fields: ReviewFields;
  courseOptions: string[];
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
}> = ({ value, onChange, invalid, labelId }) => {
  const { t } = useTranslation("coursePlayerB");
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const name = useId();
  return (
    <div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
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
    </div>
  );
};

/* ── form ────────────────────────────────────────────────────────────── */

export const ReviewForm: React.FC<ReviewFormProps> = ({
  instituteId, tagName, pageRoute, fields, courseOptions, isPreviewMode = false, titleId, onSubmitted,
  heading, subheading, nameLabel, textLabel, textPlaceholder, cityLabel, courseLabel, designationLabel,
  submitLabel, successHeading, successMessage,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const [values, setValues] = useState<ReviewValues>(EMPTY_REVIEW);
  const [errors, setErrors] = useState<Partial<Record<ReviewErrorKey, string>>>({});
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "failed" | "limited">("idle");
  const ratingLabelId = useId();
  const formId = useId();
  const errId = (key: ReviewErrorKey) => `${formId}-${key}-error`;
  const ids = { name: useId(), text: useId(), city: useId(), course: useId(), designation: useId() };

  const set = (key: keyof ReviewValues, value: string | number) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key as ReviewErrorKey]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const errorText = (key: ReviewErrorKey) => {
    const code = errors[key];
    if (!code) return null;
    const msg =
      key === "rating"
        ? t("reviewCollector.ratingRequired")
        : code === "tooLong"
          ? t("reviewCollector.tooLong")
          : t("reviewCollector.fieldRequired");
    return (
      <p id={errId(key)} className="mt-1 text-xs text-danger-600">
        {msg}
      </p>
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateReview(values, fields);
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
        ...reviewPayload(values, fields),
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

  const label = (htmlFor: string, text: string, required: boolean) => (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-catalogue-text-secondary">
      {text}
      {required && <span className="ms-1 text-catalogue-brand-ink">*</span>}
    </label>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <h2 id={titleId} className="catalogue-h3 text-catalogue-text-primary">
          {heading || t("reviewCollector.heading")}
        </h2>
        <p className="mt-1 text-sm text-catalogue-text-secondary">{subheading || t("reviewCollector.subheading")}</p>
      </div>

      <div>
        <p id={ratingLabelId} className="mb-1.5 text-sm font-medium text-catalogue-text-secondary">
          {t("reviewCollector.ratingLabel")}
          <span className="ms-1 text-catalogue-brand-ink">*</span>
        </p>
        <StarRatingInput value={values.rating} onChange={(n) => set("rating", n)} invalid={!!errors.rating} labelId={ratingLabelId} />
        {errorText("rating")}
      </div>

      {fields.reviewText !== "off" && (
        <div>
          {label(ids.text, textLabel || t("reviewCollector.textLabel"), fields.reviewText === "required")}
          <textarea
            id={ids.text}
            rows={4}
            maxLength={REVIEW_TEXT_MAX}
            value={values.reviewText}
            onChange={(e) => set("reviewText", e.target.value)}
            placeholder={textPlaceholder || t("reviewCollector.textPlaceholder")}
            aria-invalid={!!errors.reviewText || undefined}
            aria-describedby={errors.reviewText ? errId("reviewText") : undefined}
            className="catalogue-input w-full resize-y"
          />
          {errorText("reviewText")}
        </div>
      )}

      <div>
        {label(ids.name, nameLabel || t("reviewCollector.nameLabel"), true)}
        <input
          id={ids.name}
          type="text"
          autoComplete="name"
          maxLength={REVIEW_NAME_MAX}
          value={values.reviewerName}
          onChange={(e) => set("reviewerName", e.target.value)}
          aria-invalid={!!errors.reviewerName || undefined}
          aria-describedby={errors.reviewerName ? errId("reviewerName") : undefined}
          className="catalogue-input w-full"
        />
        {errorText("reviewerName")}
      </div>

      {(fields.city !== "off" || fields.course !== "off") && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.course !== "off" && (
            <div className={cn(fields.city === "off" && "sm:col-span-2")}>
              {label(ids.course, courseLabel || t("reviewCollector.courseLabel"), fields.course === "required")}
              {courseOptions.length > 0 ? (
                <select
                  id={ids.course}
                  value={values.courseName}
                  onChange={(e) => set("courseName", e.target.value)}
                  aria-invalid={!!errors.courseName || undefined}
                  className="catalogue-input w-full"
                >
                  <option value="">{t("reviewCollector.coursePlaceholder")}</option>
                  {courseOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={ids.course}
                  type="text"
                  maxLength={255}
                  value={values.courseName}
                  onChange={(e) => set("courseName", e.target.value)}
                  aria-invalid={!!errors.courseName || undefined}
                  className="catalogue-input w-full"
                />
              )}
              {errorText("courseName")}
            </div>
          )}
          {fields.city !== "off" && (
            <div className={cn(fields.course === "off" && "sm:col-span-2")}>
              {label(ids.city, cityLabel || t("reviewCollector.cityLabel"), fields.city === "required")}
              <input
                id={ids.city}
                type="text"
                autoComplete="address-level2"
                maxLength={120}
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
                aria-invalid={!!errors.city || undefined}
                className="catalogue-input w-full"
              />
              {errorText("city")}
            </div>
          )}
        </div>
      )}

      {fields.designation !== "off" && (
        <div>
          {label(ids.designation, designationLabel || t("reviewCollector.designationLabel"), fields.designation === "required")}
          <input
            id={ids.designation}
            type="text"
            autoComplete="organization-title"
            maxLength={255}
            value={values.designation}
            onChange={(e) => set("designation", e.target.value)}
            aria-invalid={!!errors.designation || undefined}
            className="catalogue-input w-full"
          />
          {errorText("designation")}
        </div>
      )}

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
