import { cn } from "@/lib/utils";
import { WarningCircle, ArrowClockwise } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { useTranslation } from "react-i18next";

export interface ErrorStateProps {
  title?: string;
  message?: string;
  /** When provided, renders a retry affordance. Errors should offer a path forward, not just a toast. */
  onRetry?: () => void;
  /** "inline" for a compact strip inside content; "block" for a centered full-section error. */
  variant?: "inline" | "block";
  className?: string;
}

/**
 * Canonical error state. Inline variant for in-context failures (a section that
 * failed to load); block variant for full-surface failures. Both use the danger
 * token family and an explicit retry.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  variant = "block",
  className,
}: ErrorStateProps) {
  const { t } = useTranslation("uiAtomsA");
  const resolvedTitle = title ?? t("errorState.defaultTitle");
  if (variant === "inline") {
    return (
      <div
        role="alert"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-body text-danger-700",
          className,
        )}
      >
        <WarningCircle size={18} weight="fill" className="shrink-0 text-danger-600" />
        <span className="flex-1">{message || resolvedTitle}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-semibold text-danger-700 underline-offset-2 transition-colors hover:underline"
          >
            <ArrowClockwise size={16} />
            {t("errorState.retry")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <WarningCircle size={24} weight="duotone" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-title font-semibold text-foreground">{resolvedTitle}</h3>
        {message && <p className="max-w-sm text-body text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <MyButton buttonType="secondary" scale="medium" onClick={onRetry} className="mt-2">
          <ArrowClockwise size={16} className="me-1" />
          {t("errorState.tryAgain")}
        </MyButton>
      )}
    </div>
  );
}
