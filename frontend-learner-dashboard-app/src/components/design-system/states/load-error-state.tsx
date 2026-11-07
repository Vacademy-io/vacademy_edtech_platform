import { useEffect, useState } from "react";
import { CloudSlash, WifiSlash } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./empty-state";

export interface LoadErrorStateProps {
  /** What failed, in the screen's own words, e.g. "Couldn't load your tests". */
  title?: string;
  onRetry: () => void;
  /** Tighter spacing for a failure below content that is already on screen. */
  compact?: boolean;
  className?: string;
}

/**
 * A list or section that could not be fetched: says so plainly and offers Retry.
 * Shares the EmptyState layout so every skin already has its treatment, but never
 * claims there is nothing there. When the device reconnects it retries by itself.
 * Strings live in the `common` namespace, the only one loaded before first paint,
 * so they are still there when a failed connection stops other catalogs loading.
 * Draws no surface of its own: it sits on whatever the page already has around it.
 */
export function LoadErrorState({
  title,
  onRetry,
  compact,
  className,
}: LoadErrorStateProps) {
  const { t } = useTranslation("common");
  const [offline, setOffline] = useState(() => navigator.onLine === false);

  useEffect(() => {
    const handleOffline = () => setOffline(true);
    const handleOnline = () => {
      setOffline(false);
      onRetry();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [onRetry]);

  return (
    <div role="alert" data-alert-surface="none">
      <EmptyState
        icon={offline ? WifiSlash : CloudSlash}
        title={offline ? t("loadError.offlineTitle") : (title ?? t("loadError.title"))}
        description={
          offline ? t("loadError.offlineDescription") : t("loadError.description")
        }
        action={{ label: t("loadError.retry"), onClick: onRetry }}
        compact={compact}
        className={className}
      />
    </div>
  );
}
