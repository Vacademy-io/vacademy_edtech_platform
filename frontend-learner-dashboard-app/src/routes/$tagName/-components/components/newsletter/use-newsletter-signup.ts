import React from "react";
import { useTranslation } from "react-i18next";
import { isSpamSubmission, submitWebsiteLead } from "../../../-utils/website-lead";

/**
 * Newsletter sign-up: an email sent to the site's lead pipeline as a
 * NEWSLETTER lead (sourceId `<tag>:<sourceSuffix>`), with a honeypot and a
 * "too fast" bot check. Shared by the newsletterSignup section (suffix
 * "newsletter", its original sourceId) and the brand footer
 * ("footer-newsletter"). `audienceId` routes it to a chosen campaign.
 */
export interface NewsletterSignupOptions {
  instituteId?: string | null;
  audienceId?: string;
  tagName?: string;
  sourceSuffix?: string;
}

export const useNewsletterSignup = ({
  instituteId,
  audienceId,
  tagName,
  sourceSuffix = "newsletter",
}: NewsletterSignupOptions) => {
  const { t } = useTranslation("coursePlayerA");
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [honeypot, setHoneypot] = React.useState("");
  const mountedAt = React.useRef(Date.now());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setError("");
    if (isSpamSubmission(honeypot, mountedAt.current)) {
      setSubmitted(true);
      return;
    }
    if (!instituteId) {
      setError(t("jsonRenderer.formNotConnected"));
      return;
    }
    setSubmitting(true);
    try {
      await submitWebsiteLead({
        instituteId,
        audienceId,
        email,
        sourceType: "NEWSLETTER",
        sourceId: `${tagName || "catalogue"}:${sourceSuffix}`,
      });
      setSubmitted(true);
    } catch {
      setError(t("jsonRenderer.somethingWentWrongRetry"));
    } finally {
      setSubmitting(false);
    }
  };

  return { email, setEmail, honeypot, setHoneypot, submitted, submitting, error, handleSubmit };
};
