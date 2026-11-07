import React from "react";
import { useTranslation } from "react-i18next";
import { CaretLeft, ClipboardText } from "@phosphor-icons/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useLiveTestStore } from "@/stores/live-test-store";
import { topSafeAreaInset } from "@/utils/safe-area";

interface AssessmentNavbarProps {
  title: string;
}

/**
 * Slim header for the assessment brief.
 *
 * Deliberately does not repeat the paper's name: the name is the page's H1
 * below, where it can wrap. Squeezing it in here truncated almost every real
 * title on a phone ("Class 10 — Term 1 Mock…") while the H1 sat empty.
 */
const AssessmentNavbar: React.FC<AssessmentNavbarProps> = ({ title }) => {
  const { t } = useTranslation("layoutCommonB");
  const router = useRouter();
  const navigate = useNavigate();
  // The brief is a full-bleed fixed screen, so this bar carries the status-bar
  // clearance itself — see `topSafeAreaInset`.
  const immersiveActive = useLiveTestStore((s) => s.immersiveActive);
  const inset = topSafeAreaInset(immersiveActive);

  // Return to wherever the learner came from (usually the assessment list).
  // Direct / public-link entries have no in-app history to pop, so fall back to
  // the assessment tab.
  const handleBack = () => {
    if (window.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: "/assessment/examination" });
    }
  };

  return (
    <div
      className="flex flex-none items-center gap-3 border-b border-neutral-200 bg-white px-3 sm:px-6"
      style={{ // design-lint-ignore: dynamic safe-area inset padding
        paddingTop: inset,
        height: `calc(3.5rem + ${inset})`,
      }}
    >
      <button
        type="button"
        onClick={handleBack}
        aria-label={t("instructionPage.navbar.goBack")}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
      >
        <CaretLeft size={20} weight="bold" />
      </button>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50">
        <ClipboardText size={17} weight="duotone" className="text-primary-500" />
      </div>
      <p
        className="truncate text-caption font-semibold uppercase tracking-wide text-neutral-500"
        title={title}
      >
        {t("instructionPage.navbar.assessmentBrief")}
      </p>
    </div>
  );
};

export default AssessmentNavbar;
