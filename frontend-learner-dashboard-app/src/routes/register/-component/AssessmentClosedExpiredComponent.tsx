import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  InstituteBrandingComponent,
  type InstituteBranding,
} from "@/components/common/institute-branding";
import { useInstituteDetails } from "../live-class/-hooks/useInstituteDetails";
import { MyButton } from "@/components/design-system/button";
import {
  ArrowClockwise,
  Clock,
  LinkBreak,
  Lock,
  Warning,
  WifiSlash,
  XCircle,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

/**
 * `expired` / `closed` / `accessDenied` describe the assessment's own state.
 * `notFound` / `network` / `error` describe a failure to LOAD it — they are
 * rendered by the route's errorComponent and must never claim the assessment
 * is over, because we don't actually know.
 */
export type AssessmentStatusVariant =
  | "expired"
  | "closed"
  | "accessDenied"
  | "notFound"
  | "network"
  | "error";

const AssessmentClosedExpiredComponent = ({
  isExpired = false,
  assessmentName,
  isPrivate = false,
  externalBranding,
  variant,
  detail,
  onRetry,
}: {
  isExpired?: boolean;
  /** Omit on load failures — the name is unknown and the box is hidden. */
  assessmentName?: string;
  isPrivate?: boolean;
  externalBranding?: InstituteBranding | null;
  /** Explicit state; falls back to the legacy isPrivate/isExpired flags. */
  variant?: AssessmentStatusVariant;
  /** Backend-provided sentence to show under the description (error variants). */
  detail?: string;
  /** Shown as a "Try again" button when provided. */
  onRetry?: () => void;
}) => {
  const { t } = useTranslation("registrationA");
  const resolvedVariant: AssessmentStatusVariant =
    variant ?? (isPrivate ? "accessDenied" : isExpired ? "expired" : "closed");
  const { data: instituteDetails } = useInstituteDetails();

  const branding: InstituteBranding = externalBranding || {
    instituteId: instituteDetails?.id || null,
    instituteName: instituteDetails?.institute_name || null,
    instituteLogoFileId: instituteDetails?.institute_logo_file_id || null,
    instituteThemeCode: null,
    homeIconClickRoute: instituteDetails?.homeIconClickRoute ?? null,
  };

  const configByVariant = {
    accessDenied: {
      Icon: Lock,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-500",
      ringColor: "ring-amber-100",
      badgeVariant: "secondary" as const,
      badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
      badgeText: t("closedExpired.accessDenied.badge"),
      title: t("closedExpired.accessDenied.title"),
      description: t("closedExpired.accessDenied.description"),
    },
    expired: {
      Icon: XCircle,
      iconBg: "bg-red-50",
      iconColor: "text-red-500",
      ringColor: "ring-red-100",
      badgeVariant: "destructive" as const,
      badgeClass: "bg-red-50 text-red-700 border-red-200",
      badgeText: t("closedExpired.expired.badge"),
      title: t("closedExpired.expired.title"),
      description: t("closedExpired.expired.description"),
    },
    closed: {
      Icon: Clock,
      iconBg: "bg-orange-50",
      iconColor: "text-orange-500",
      ringColor: "ring-orange-100",
      badgeVariant: "secondary" as const,
      badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
      badgeText: t("closedExpired.closed.badge"),
      title: t("closedExpired.closed.title"),
      description: t("closedExpired.closed.description"),
    },
    notFound: {
      Icon: LinkBreak,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-500",
      ringColor: "ring-amber-100",
      badgeVariant: "secondary" as const,
      badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
      badgeText: t("loadError.notFound.badge"),
      title: t("loadError.notFound.title"),
      description: t("loadError.notFound.description"),
    },
    network: {
      Icon: WifiSlash,
      iconBg: "bg-slate-100",
      iconColor: "text-slate-500",
      ringColor: "ring-slate-50",
      badgeVariant: "secondary" as const,
      badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
      badgeText: t("loadError.network.badge"),
      title: t("loadError.network.title"),
      description: t("loadError.network.description"),
    },
    error: {
      Icon: Warning,
      iconBg: "bg-orange-50",
      iconColor: "text-orange-500",
      ringColor: "ring-orange-100",
      badgeVariant: "secondary" as const,
      badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
      badgeText: t("loadError.unknown.badge"),
      title: t("loadError.unknown.title"),
      description: t("loadError.unknown.description"),
    },
  } satisfies Record<AssessmentStatusVariant, unknown>;
  const config = configByVariant[resolvedVariant];

  const { Icon } = config;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <Card className="border-0 shadow-xl shadow-slate-200/60 overflow-hidden">
          {/* Header strip */}
          <div className="h-1.5 bg-gradient-to-r from-primary-400 via-danger-400 to-pink-400" />

          <CardContent className="p-8 sm:p-10">
            {/* Branding */}
            <div className="flex flex-col items-center gap-stack mb-6">
              <InstituteBrandingComponent
                branding={branding}
                size="medium"
                showName={false}
              />
              {branding.instituteName && (
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  {branding.instituteName}
                </p>
              )}
            </div>

            {/* Icon */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="flex justify-center mb-6"
            >
              <div
                className={`relative w-20 h-20 rounded-full ${config.iconBg} flex items-center justify-center ring-8 ${config.ringColor}`}
              >
                <Icon
                  className={`w-10 h-10 ${config.iconColor}`}
                  strokeWidth={2}
                />
              </div>
            </motion.div>

            {/* Status badge */}
            <div className="flex justify-center mb-4">
              <Badge
                variant={config.badgeVariant}
                className={`${config.badgeClass} font-medium px-3 py-1`}
              >
                {config.badgeText}
              </Badge>
            </div>

            {/* Title & description */}
            <div className="text-center space-y-3 mb-6">
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
                {config.title}
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                {config.description}
              </p>
              {detail && (
                <p className="text-xs text-slate-500 leading-relaxed break-words">
                  {detail}
                </p>
              )}
            </div>

            {/* Assessment name — only when we actually know it */}
            {assessmentName && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 space-y-1">
                <p className="text-caption font-medium text-slate-500 uppercase tracking-wider">
                  {t("closedExpired.assessmentLabel")}
                </p>
                <p className="text-sm font-medium text-slate-900 truncate">
                  {assessmentName}
                </p>
              </div>
            )}

            {onRetry && (
              <div className="mt-6 flex justify-center">
                <MyButton
                  type="button"
                  buttonType="primary"
                  scale="large"
                  layoutVariant="default"
                  className="w-full sm:w-auto gap-2"
                  onClick={onRetry}
                >
                  <ArrowClockwise size={16} weight="bold" />
                  {t("loadError.retry")}
                </MyButton>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default AssessmentClosedExpiredComponent;
