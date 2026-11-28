import React, { useEffect, useState } from "react";
import { ArrowSquareOut, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { LeadFormComponent } from "./components/LeadFormComponent";
import { useSiteT } from "../-utils/catalogue-locale";
import {
  markResourceUnlocked,
  rememberResourceIdentity,
  trackResourceDownload,
} from "../-utils/resource-unlock";

/**
 * Audience Form popup — lets ANY catalogue button open a campaign's form as a
 * modal instead of navigating away ("register for the webinar" without
 * leaving the page).
 *
 * Opened via the `openAudienceForm` window CustomEvent (detail: {audienceId,
 * title}) — the same event mechanism the legacy lead-collection modal uses,
 * so buttons rendered anywhere in the JSON tree can trigger it without prop
 * drilling. The page shell (CourseSubPage / CourseCataloguePage) owns the
 * listener and mounts this once.
 *
 * Gated resources (featureGrid `resource` cards) pass `unlockUrl`: on submit
 * the list is remembered as unlocked for this browser and the panel offers
 * the file — as a real link the visitor clicks, because opening a tab after
 * an async submit would be swallowed by popup blockers.
 */

export interface AudienceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  audienceId: string;
  title?: string;
  instituteId: string;
  /** Resource to hand over once the form is submitted. */
  unlockUrl?: string;
  /** Button text for that resource (the card's own label, e.g. "Download"). */
  unlockLabel?: string;
  /** The card's title — what the admin sees in the lead's download list. */
  unlockTitle?: string;
  /** Editor preview: the form shows but never submits. */
  isPreviewMode?: boolean;
}

export const AudienceFormModal: React.FC<AudienceFormModalProps> = ({
  isOpen,
  onClose,
  audienceId,
  title,
  instituteId,
  unlockUrl,
  unlockLabel,
  unlockTitle,
  isPreviewMode = false,
}) => {
  const { t } = useTranslation("coursePlayerA");
  const [unlocked, setUnlocked] = useState(false);
  // Most openers pass text that is already in the visitor's language (props
  // the renderer localized). A few pass authored or live text as is (the
  // mobile bar's raw header links, coming-soon courses, HTML pages) — those
  // are translated here. Text that is already translated has no dictionary
  // entry of its own, so it passes through unchanged.
  const siteT = useSiteT();
  const shownTitle = title ? siteT(title) : title;
  const shownUnlockLabel = unlockLabel ? siteT(unlockLabel) : unlockLabel;

  // A fresh open (possibly for a different card) starts from the form again.
  useEffect(() => {
    if (isOpen) setUnlocked(false);
  }, [isOpen, unlockUrl]);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !audienceId) return null;

  return (
    <div
      className="fixed inset-0 z-catalogue-fixed flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={shownTitle || t("audienceFormModal.registrationForm")}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t("audienceFormModal.closeForm")}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      {/* Panel — bottom sheet on mobile, centered card on desktop */}
      <div className="relative max-h-screen-90 w-full overflow-y-auto overscroll-contain rounded-t-catalogue-lg bg-catalogue-bg p-5 shadow-2xl sm:max-w-lg sm:rounded-catalogue-lg sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          {shownTitle ? (
            <h2 className="catalogue-h3 text-catalogue-text-primary">{shownTitle}</h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="catalogue-btn catalogue-btn-secondary catalogue-btn-icon size-9 shrink-0 justify-center rounded-full"
          >
            <X className="size-4" weight="bold" aria-hidden="true" />
          </button>
        </div>

        <LeadFormComponent
          audienceId={audienceId}
          instituteId={instituteId}
          variant="embedded"
          layout="bare"
          isPreviewMode={isPreviewMode}
          onSubmitted={
            unlockUrl
              ? (identity) => {
                  rememberResourceIdentity(identity);
                  markResourceUnlocked(audienceId);
                  setUnlocked(true);
                }
              : undefined
          }
        />

        {unlocked && unlockUrl && (
          <div className="flex flex-col items-center gap-2 text-center">
            <a
              href={unlockUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackResourceDownload({ url: unlockUrl, title: unlockTitle, audienceId })}
              onAuxClick={(e) => {
                if (e.button === 1) trackResourceDownload({ url: unlockUrl, title: unlockTitle, audienceId });
              }}
              className="catalogue-btn catalogue-btn-primary w-full justify-center sm:w-auto"
            >
              <ArrowSquareOut className="size-4" weight="bold" aria-hidden="true" />
              {shownUnlockLabel || t("audienceFormModal.openResource")}
            </a>
            <p className="text-sm text-catalogue-text-muted">
              {t("audienceFormModal.resourcesUnlocked")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudienceFormModal;
