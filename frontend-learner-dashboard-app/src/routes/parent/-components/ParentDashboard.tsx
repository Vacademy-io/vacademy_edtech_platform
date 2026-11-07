// ─────────────────────────────────────────────────────────────
// Parent Dashboard — Per-child overview
// ─────────────────────────────────────────────────────────────

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ChildProfile } from "@/types/parent-portal";
import {
  useAdmissionStages,
  useApplicantStages,
} from "@/hooks/use-parent-portal";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Clock,
  ClipboardText,
  CurrencyDollar,
  ArrowRight,
  Warning,
  Confetti,
  Info,
} from "@phosphor-icons/react";

import { type TabId } from "./navigation-config";
import { getInstituteId } from "@/constants/helper";

interface ParentDashboardProps {
  child: ChildProfile;
  onNavigate: (tab: TabId) => void;
}

export function ParentDashboard({ child, onNavigate }: ParentDashboardProps) {
  const { t } = useTranslation("parent");
  const [instituteId, setInstituteId] = useState<string>("");

  useEffect(() => {
    getInstituteId().then((id) => {
      setInstituteId(id || "");
    });
  }, []);

  const statusInfo = getAdmissionStatusInfo("APPLICATION", t);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6 pb-20 lg:pb-8">
      {/* ── Welcome Header ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            {t("admissionPortal.dashboard.title", { name: child.full_name })}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {child.grade_applying
              ? t("admissionPortal.dashboard.applyingFor", {
                  grade: child.grade_applying,
                })
              : t("admissionPortal.dashboard.inProgress")}
            {child.academic_year ? ` • ${child.academic_year}` : ""}
          </p>
        </div>
        <Badge
          className={`${statusInfo.badge} self-start sm:self-auto text-xs font-medium px-3 py-1`}
        >
          {statusInfo.label}
        </Badge>
      </motion.div>

      {/* ── Admission Progress ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("admissionPortal.dashboard.progressTitle")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("admissionPortal.dashboard.progressSubtitle")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdmissionProgressSteps child={child} instituteId={instituteId} />
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ── Admission Progress Steps ─────────────────────────────────────

function AdmissionProgressSteps({
  child,
  instituteId,
}: {
  child: ChildProfile;
  instituteId: string;
}) {
  const { t, i18n } = useTranslation("parent");
  const { data: stages, isLoading: isStagesLoading } =
    useAdmissionStages(instituteId);

  const { data: applicantStages, isLoading: isApplicantStagesLoading } =
    useApplicantStages("539c7877-f749-4c84-aa4e-bb92bbedb802");

  const isLoading = isStagesLoading || isApplicantStagesLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  // Sort stages by sequence
  const sortedStages = [...(stages || [])].sort((a, b) => {
    const seqA = parseInt(a.sequence) || 0;
    const seqB = parseInt(b.sequence) || 0;
    return seqA - seqB;
  });

  // Create a map of stageId -> applicantStage for easy lookup
  const applicantStageMap = new Map(
    applicantStages?.map((s) => [s.stage_id, s]) || [],
  );

  if (sortedStages.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-muted-foreground">
          {t("admissionPortal.dashboard.noStagesConfigured")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Timeline */}
      <div className="space-y-0">
        {sortedStages.map((stage, idx) => {
          const userStage = applicantStageMap.get(stage.id);
          const isCompleted = userStage?.stage_status === "COMPLETED";
          const isCurrent = userStage?.stage_status === "PENDING";
          const isLast = idx === sortedStages.length - 1;

          return (
            <div key={stage.id} className="flex items-start gap-3">
              {/* Vertical line + dot */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                    isCompleted
                      ? "bg-emerald-500 text-white"
                      : isCurrent
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : "bg-muted border-2 border-border"
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle size={14} />
                  ) : isCurrent ? (
                    <Clock size={12} />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                {!isLast && (
                  <div
                    className={`w-0.5 h-8 ${
                      isCompleted ? "bg-emerald-500" : "bg-border"
                    }`}
                  />
                )}
              </div>

              {/* Label */}
              <div className="pb-6">
                <p
                  className={`text-sm font-medium ${
                    isCompleted
                      ? "text-foreground"
                      : isCurrent
                        ? "text-primary font-semibold"
                        : "text-muted-foreground"
                  }`}
                >
                  {stage.stage_name}
                </p>
                {isCurrent && (
                  <p className="text-caption text-primary/70 mt-0.5">
                    {t("admissionPortal.dashboard.stepInProgress")}
                  </p>
                )}
                {userStage?.completed_at && (
                  <p className="text-caption text-muted-foreground mt-0.5">
                    {t("admissionPortal.dashboard.completedOn", {
                      date: new Date(
                        userStage.completed_at,
                      ).toLocaleDateString(i18n.language),
                    })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Status Info Helper ───────────────────────────────────────────

function getAdmissionStatusInfo(status: string, t: TFunction) {
  const map: Record<
    string,
    {
      label: string;
      badge: string;
      borderColor: string;
      iconBg: string;
      bannerIcon: React.ReactNode;
      bannerTitle: string;
      bannerDescription: string;
      actionTab?: TabId;
      actionLabel?: string;
    }
  > = {
    ENQUIRY: {
      label: t("admissionPortal.dashboard.statusInfo.enquiry.label"),
      badge: "bg-blue-100 text-blue-700 hover:bg-blue-200",
      borderColor: "border-s-blue-500",
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      bannerIcon: <Info size={20} className="text-blue-600" />,
      bannerTitle: t("admissionPortal.dashboard.statusInfo.enquiry.bannerTitle"),
      bannerDescription: t(
        "admissionPortal.dashboard.statusInfo.enquiry.bannerDescription",
      ),
    },
    REGISTRATION_PENDING: {
      label: t("admissionPortal.dashboard.statusInfo.registrationPending.label"),
      badge:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
      borderColor: "border-s-amber-500",
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      bannerIcon: <Warning size={20} className="text-amber-600" />,
      bannerTitle: t(
        "admissionPortal.dashboard.statusInfo.registrationPending.bannerTitle",
      ),
      bannerDescription: t(
        "admissionPortal.dashboard.statusInfo.registrationPending.bannerDescription",
      ),
      actionTab: "application",
      actionLabel: t(
        "admissionPortal.dashboard.statusInfo.registrationPending.actionLabel",
      ),
    },
    APPLICATION: {
      label: t("admissionPortal.dashboard.statusInfo.application.label"),
      badge:
        "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
      borderColor: "border-s-yellow-500",
      iconBg: "bg-yellow-100 dark:bg-yellow-900/30",
      bannerIcon: <ClipboardText size={20} className="text-yellow-600" />,
      bannerTitle: t(
        "admissionPortal.dashboard.statusInfo.application.bannerTitle",
      ),
      bannerDescription: t(
        "admissionPortal.dashboard.statusInfo.application.bannerDescription",
      ),
      actionTab: "application",
      actionLabel: t(
        "admissionPortal.dashboard.statusInfo.application.actionLabel",
      ),
    },
    PAYMENT_PENDING: {
      label: t("admissionPortal.dashboard.statusInfo.paymentPending.label"),
      badge:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
      borderColor: "border-s-orange-500",
      iconBg: "bg-orange-100 dark:bg-orange-900/30",
      bannerIcon: <CurrencyDollar size={20} className="text-orange-600" />,
      bannerTitle: t(
        "admissionPortal.dashboard.statusInfo.paymentPending.bannerTitle",
      ),
      bannerDescription: t(
        "admissionPortal.dashboard.statusInfo.paymentPending.bannerDescription",
      ),
      actionTab: "payments",
      actionLabel: t(
        "admissionPortal.dashboard.statusInfo.paymentPending.actionLabel",
      ),
    },
    ADMITTED: {
      label: t("admissionPortal.dashboard.statusInfo.admitted.label"),
      badge:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      borderColor: "border-s-emerald-500",
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      bannerIcon: <Confetti size={20} className="text-emerald-600" />,
      bannerTitle: t("admissionPortal.dashboard.statusInfo.admitted.bannerTitle"),
      bannerDescription: t(
        "admissionPortal.dashboard.statusInfo.admitted.bannerDescription",
      ),
    },
  };

  return (
    map[status] || {
      label: status.replace(/_/g, " "),
      badge: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300",
      borderColor: "border-s-gray-400",
      iconBg: "bg-gray-100 dark:bg-gray-900/30",
      bannerIcon: <Info size={20} className="text-gray-600" />,
      bannerTitle: t("admissionPortal.dashboard.statusInfo.default.bannerTitle"),
      bannerDescription: t(
        "admissionPortal.dashboard.statusInfo.default.bannerDescription",
      ),
    }
  );
}
