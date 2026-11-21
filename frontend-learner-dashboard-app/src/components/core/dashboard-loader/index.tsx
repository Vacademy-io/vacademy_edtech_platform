import { Component, ErrorInfo, ReactNode, useEffect, useState } from "react";
import { Warning, ArrowClockwise } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { MyButton } from "@/components/design-system/button";
import { useTheme } from "@/providers/theme/theme-provider";
import { getCachedInstituteBranding } from "@/services/domain-routing";
import { useQuery } from "@tanstack/react-query";
import { getInstituteLogoQuery } from "@/services/institute-logo";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-reg-400 flex-col items-center justify-center rounded-xl border border-red-200 bg-gradient-to-br from-danger-50 to-primary-50 px-6 py-12 text-center">
          <div className="mb-6 rounded-full bg-red-100 p-4">
            <Warning className="size-12 text-red-600" />
          </div>

          <h2 className="mb-3 text-xl font-semibold text-neutral-800">
            {i18n.t("courseComponentsExtra:common.somethingWentWrong")}
          </h2>

          <p className="mb-6 max-w-md text-sm leading-relaxed text-neutral-600">
            {i18n.t("courseComponentsExtra:dashboardLoader.errorBoundaryDescription")}
          </p>

          <div className="flex flex-col items-center gap-stack sm:flex-row">
            <MyButton
              onClick={this.handleReset}
              buttonType="primary"
              scale="medium"
              className="flex items-center gap-2"
            >
              <ArrowClockwise className="size-4" />
              {i18n.t("courseComponentsExtra:common.tryAgain")}
            </MyButton>

            <MyButton
              onClick={() => window.location.reload()}
              buttonType="secondary"
              scale="medium"
            >
              {i18n.t("courseComponentsExtra:runtimeErrorPage.reloadPage")}
            </MyButton>
          </div>

          {process.env.NODE_ENV === "development" && this.state.error && (
            <details className="mt-6 max-w-full overflow-auto rounded-lg bg-red-100 p-4 text-start space-y-2">
              <summary className="cursor-pointer text-sm font-medium text-red-800">
                {i18n.t("courseComponentsExtra:dashboardLoader.errorDetailsDev")}
              </summary>
              <pre className="whitespace-pre-wrap break-words text-xs text-red-700">
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

const VacademyLogoSVG = ({ className = "" }: { className?: string }) => {
  const { t } = useTranslation("courseComponentsExtra");
  return (
  <svg
    className={className}
    viewBox="0 0 80 80"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>{t("dashboardLoader.loading")}</title>
    <circle cx="40" cy="40" r="32" fill="#F8FAFC" /> {/* design-lint-ignore: SVG illustration fill */}
    <circle
      cx="40"
      cy="40"
      r="28"
      stroke="#E2E8F0" // design-lint-ignore: SVG illustration stroke
      strokeWidth="4"
      strokeDasharray="4 12"
      strokeLinecap="round"
      opacity="0.7"
    />
    <circle
      cx="40"
      cy="40"
      r="28"
      stroke="#6366F1" // design-lint-ignore: SVG illustration stroke
      strokeWidth="4"
      strokeLinecap="round"
      strokeDasharray="60 110"
      transform="rotate(-90 40 40)"
    />
    <circle cx="40" cy="40" r="6" fill="#6366F1" opacity="0.6" /> {/* design-lint-ignore: SVG illustration fill */}
  </svg>
  );
};

const Logo = ({ className = "" }: { className?: string }) => {
  const { t } = useTranslation("courseComponentsExtra");
  const [logoLoaded, setLogoLoaded] = useState(false);
  const cachedBranding = getCachedInstituteBranding();

  // Use React Query to fetch and cache the logo URL (24-hour cache)
  const { data: cachedLogoUrl, isLoading } = useQuery(
    getInstituteLogoQuery(cachedBranding?.instituteLogoFileId ?? null)
  );

  // Determine which logo URL to use
  const logoUrl = cachedBranding?.instituteLogoUrl || cachedLogoUrl || null;

  if (isLoading) {
    return <div className={className} />;
  }

  if (logoUrl && !logoLoaded) {
    return (
      <img
        src={logoUrl}
        alt={t("dashboardLoader.logoAlt")}
        className={className}
        onLoad={() => setLogoLoaded(true)}
        onError={() => {
          setLogoLoaded(true);
        }}
      />
    );
  }

  if (logoUrl && logoLoaded) {
    return <img src={logoUrl} alt={t("dashboardLoader.logoAlt")} className={className} />;
  }

  return <VacademyLogoSVG className={className} />;
};

interface DashboardLoaderProps {
  height?: string;
  fullscreen?: boolean;
}

export const DashboardLoader = ({
  height = "",
  fullscreen = false,
}: DashboardLoaderProps) => {
  const { getPrimaryColorCode } = useTheme();
  const [loaderColor, setLoaderColor] = useState<string>(getPrimaryColorCode());
  const containerMinHeight = height || "100%";

  useEffect(() => {
    const cachedBranding = getCachedInstituteBranding();
    if (cachedBranding?.instituteThemeCode) {
      setLoaderColor(cachedBranding.instituteThemeCode);
    } else {
      setLoaderColor(getPrimaryColorCode());
    }
  }, [getPrimaryColorCode]);

  return (
    <ErrorBoundary>
      <div
        className={`${
          fullscreen ? "fixed inset-0" : "w-full"
        } flex items-center justify-center bg-background`}
        style={{ minHeight: containerMinHeight }}
      >
        <div className="flex flex-col items-center justify-center gap-4 px-4">
          <Logo className="size-16 object-contain sm:size-12 md:size-14" />

          <div className="w-32 sm:w-40 md:w-48">
            <div className="h-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  background: loaderColor,
                  animation: "loading-progress 2s ease-in-out infinite",
                }}
              />
            </div>
          </div>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
            @keyframes loading-progress {
              0% {
                width: 0%;
                margin-left: 0%;
              }
              50% {
                width: 70%;
                margin-left: 15%;
              }
              100% {
                width: 0%;
                margin-left: 100%;
              }
            }
          `,
          }}
        />
      </div>
    </ErrorBoundary>
  );
};
