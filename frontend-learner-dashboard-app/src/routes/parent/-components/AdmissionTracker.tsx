import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile, ApplicantStage } from "@/types/parent-portal";
import {
  useAdmissionStages,
  useApplicantStages,
} from "@/hooks/use-parent-portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Flag, Confetti, ListNumbers } from "@phosphor-icons/react";

interface AdmissionTrackerProps {
  child: ChildProfile;
}

export function AdmissionTracker({ child }: AdmissionTrackerProps) {
  const { t } = useTranslation("parent");
  const { data: stages, isLoading: isStagesLoading } = useAdmissionStages(
    child.institute_id,
  );

  // Fetch applicant stages (user progress)
  const { data: applicantStages, isLoading: isApplicantStagesLoading } =
    useApplicantStages(child.applicant_id);

  const isLoading = isStagesLoading || isApplicantStagesLoading;

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Calculate progress based on applicant stages
  const totalStages = stages?.length ?? 0;
  const completedStages =
    applicantStages?.filter((s) => s.status === "COMPLETED").length ?? 0;

  // Calculate progress percent from applicant stages and configured stages.
  const progressPercent = totalStages
    ? Math.round((completedStages / totalStages) * 100)
    : 0;

  // Sort stages by sequence
  const sortedStages = [...(stages || [])].sort((a, b) => {
    const seqA = parseInt(a.sequence) || 0;
    const seqB = parseInt(b.sequence) || 0;
    return seqA - seqB;
  });

  // Create a map of stageId -> applicantStage for easy lookup
  const applicantStageMap = new Map<string, ApplicantStage>(
    applicantStages?.map((s) => [s.stage_id, s]) || [],
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-5 pb-20 lg:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-foreground">
          {t("admissionPortal.tracker.heading")}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("admissionPortal.tracker.subheading", { name: child.full_name })}
        </p>
      </div>

      {/* ── Progress Bar ──────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="shadow-sm overflow-hidden">
          <CardContent className="p-card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Flag size={16} className="text-primary" />
                <p className="text-sm font-semibold text-foreground">
                  {t("admissionPortal.tracker.overallProgress")}
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-medium">
                {t("admissionPortal.tracker.stepsCount", {
                  completed: completedStages,
                  total: totalStages,
                })}
              </Badge>
            </div>

            {/* Progress bar */}
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute inset-y-0 start-0 bg-gradient-to-r from-primary to-success-500 rounded-full"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-end">
              {t("admissionPortal.tracker.percentComplete", {
                percent: progressPercent,
              })}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Admission Stages (Roadmap) ────────────────────────── */}
      {sortedStages.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <ListNumbers size={16} />
                {t("admissionPortal.tracker.process")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative border-s-2 border-muted ms-3 space-y-8 ps-6 py-2">
                {sortedStages.map((stage) => {
                  console.log(
                    "Rendering stage:",
                    stage.stage_name,
                    "with applicant stage:",
                    applicantStageMap.get(stage.id),
                  );
                  const userStage = applicantStageMap.get(stage.id);
                  const isCompleted = userStage?.status === "COMPLETED";
                  const isCurrent = userStage?.status === "IN_PROGRESS"; // Or derived logic if only one is in progress
                  const isPending =
                    !userStage || userStage.status === "PENDING";

                  return (
                    <div key={stage.id} className="relative">
                      {/* Dot */}
                      <span
                        className={`absolute -start-[31px] top-1 h-4 w-4 rounded-full border-2 ring-4 ring-background transition-colors ${
                          isCompleted
                            ? "bg-emerald-500 border-emerald-500"
                            : isCurrent
                              ? "bg-primary border-primary animate-pulse"
                              : "bg-background border-muted"
                        }`}
                      />

                      <div className="flex items-start justify-between gap-4">
                        <div className={isPending ? "opacity-60" : ""}>
                          <h4
                            className={`text-sm font-medium leading-none ${
                              isCurrent ? "text-primary" : ""
                            }`}
                          >
                            {stage.stage_name}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("admissionPortal.tracker.step", {
                              number: stage.sequence,
                            })}
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Badge variant="secondary" className="text-caption">
                              {stage.type}
                            </Badge>
                          </div>
                        </div>

                        {/* Status Badge */}
                        {isCompleted && (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 text-caption shrink-0">
                            {t("admissionPortal.tracker.completed")}
                          </Badge>
                        )}
                        {isCurrent && (
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-caption shrink-0">
                            {t("admissionPortal.tracker.inProgress")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Timeline ──────────────────────────────────────────── */}
      {/* Timeline removed — child-scoped timeline endpoint was demo-only */}

      {/* ── Enrolled Celebration ──────────────────────────────── */}
      {child.admission_status === "ENROLLED" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="shadow-sm bg-gradient-to-br from-success-50 to-success-50 dark:from-emerald-950/20 dark:to-green-950/20 border-emerald-200 dark:border-emerald-800">
            <CardContent className="p-card-lg text-center">
              <Confetti
                size={36}
                className="mx-auto text-emerald-600 mb-3"
              />
              <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                {t("admissionPortal.tracker.congratulations")}
              </h3>
              <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mt-1">
                {t("admissionPortal.tracker.enrolledNotice", {
                  name: child.full_name,
                })}
                {child.batch_name &&
                  ` ${t("admissionPortal.tracker.welcomeToBatch", { batch: child.batch_name })}`}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
