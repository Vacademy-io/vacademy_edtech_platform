import { useTranslation } from "react-i18next";
import { DashboardLoader } from "@/components/core/dashboard-loader";

interface FullScreenLoaderProps {
  /** short human message under the loader, e.g. "Signing you in…" */
  label?: string;
}

/**
 * Full-screen blocking loader for identity transitions (login, switching into /
 * out of student view) — moments where the app would otherwise sit blank while
 * sessions hydrate or a hard reload is prepared. Renders the BRANDED
 * DashboardLoader (institute logo + theme-coloured progress bar), matching the
 * index.html boot splash so the transition reads as one continuous loader.
 */
export function FullScreenLoader({ label }: FullScreenLoaderProps) {
  const { t } = useTranslation("layoutCommonA");
  return (
    <div
      className="fixed inset-0 z-50 bg-background"
      role="status"
      aria-live="polite"
      aria-label={label || t("fullScreenLoader.loadingFallback")}
    >
      <DashboardLoader fullscreen />
      {label ? (
        <p className="absolute inset-x-0 top-2/3 text-center text-body font-medium text-muted-foreground">
          {label}
        </p>
      ) : null}
    </div>
  );
}
