// Dashboard demo — props-driven (no API)
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile, AdmissionOverview } from "@/types/parent-portal";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Clock,
  ClipboardText,
  CalendarCheck,
  CurrencyDollar,
  FileText,
  ArrowRight,
  Info,
} from "@phosphor-icons/react";
import { formatDate } from "@/lib/formatters";

type TabId =
  | "dashboard"
  | "registration"
  | "schedule"
  | "admission"
  | "documents"
  | "payments"
  | "tracker";
interface Props {
  child: ChildProfile;
  overview: AdmissionOverview;
  onNavigate: (tab: TabId) => void;
}

export function ParentDashboardDemo({ child, overview, onNavigate }: Props) {
  const { t } = useTranslation("parent");
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full space-y-6 pb-20 lg:pb-8">
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
        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 self-start text-xs font-medium px-3 py-1">
          {t("admissionPortal.demo.registrationInProgress")}
        </Badge>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="border-s-4 border-s-yellow-500 shadow-sm">
          <CardContent className="p-card sm:p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 shrink-0 mt-0.5">
                <ClipboardText size={20} className="text-yellow-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("admissionPortal.dashboard.statusInfo.application.bannerTitle")}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {t(
                    "admissionPortal.dashboard.statusInfo.application.bannerDescription",
                  )}
                </p>
                <Button
                  size="sm"
                  onClick={() => onNavigate("registration")}
                  className="mt-3 h-8 text-xs rounded-lg gap-1.5"
                >
                  {t("admissionPortal.dashboard.statusInfo.application.actionLabel")}
                  <ArrowRight size={12} />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

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
              {t("admissionPortal.demo.trackEachStep")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressSteps currentStatus={child.admission_status} />
          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          {
            id: "registration" as TabId,
            icon: ClipboardText,
            label: t("admissionPortal.demo.nav.registration"),
            desc: t("admissionPortal.demo.tiles.registrationDesc"),
            color: "text-blue-600 dark:text-blue-400",
            bg: "bg-blue-50 dark:bg-blue-950/30",
            d: 0.15,
          },
          {
            id: "schedule" as TabId,
            icon: CalendarCheck,
            label: t("admissionPortal.nav.interviewAndTests"),
            desc: t("admissionPortal.demo.tiles.scheduleDesc"),
            color: "text-violet-600 dark:text-violet-400",
            bg: "bg-violet-50 dark:bg-violet-950/30",
            d: 0.2,
          },
          {
            id: "admission" as TabId,
            icon: FileText,
            label: t("admissionPortal.demo.tiles.admissionForm"),
            desc: t("admissionPortal.demo.tiles.admissionFormDesc"),
            color: "text-indigo-600 dark:text-indigo-400",
            bg: "bg-indigo-50 dark:bg-indigo-950/30",
            d: 0.25,
          },
          {
            id: "documents" as TabId,
            icon: ClipboardText,
            label: t("admissionPortal.nav.verification"),
            desc: t("admissionPortal.demo.tiles.verificationDesc"),
            color: "text-amber-600 dark:text-amber-400",
            bg: "bg-amber-50 dark:bg-amber-950/30",
            d: 0.3,
          },
          {
            id: "payments" as TabId,
            icon: CurrencyDollar,
            label: t("admissionPortal.demo.tiles.feePayment"),
            desc: t("admissionPortal.demo.tiles.feePaymentDesc"),
            color: "text-emerald-600 dark:text-emerald-400",
            bg: "bg-emerald-50 dark:bg-emerald-950/30",
            d: 0.35,
          },
        ].map((c) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: c.d }}
          >
            <Card
              className="shadow-sm hover:shadow-md transition-all cursor-pointer group active:scale-[0.98]"
              onClick={() => onNavigate(c.id)}
            >
              <CardContent className="p-card flex flex-col items-start gap-2.5">
                <div className={`p-2 rounded-lg ${c.bg}`}>
                  <c.icon size={20} className={c.color} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {c.label}
                  </p>
                  <p className="text-caption text-muted-foreground">{c.desc}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {overview.timeline.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <Card className="shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {t("admissionPortal.demo.recentActivity")}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("admissionPortal.demo.latestUpdates")}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => onNavigate("tracker")}
              >
                {t("admissionPortal.demo.viewAll")}
                <ArrowRight size={12} className="ms-1" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.timeline.slice(0, 4).map((e) => (
                <div key={e.id} className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${e.status === "COMPLETED" ? "bg-emerald-500" : e.status === "CURRENT" ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground font-medium">
                      {e.title}
                    </p>
                    {e.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.description}
                      </p>
                    )}
                    {e.timestamp && (
                      <p className="text-caption text-muted-foreground/60 mt-1">
                        {formatDate(e.timestamp, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function useDemoSteps() {
  const { t } = useTranslation("parent");
  return [
    { key: "ENQUIRY", label: t("admissionPortal.demo.steps.enquirySubmitted") },
    { key: "APPLICATION", label: t("admissionPortal.demo.steps.applicationFormFilled") },
    { key: "INTERVIEW_COMPLETED", label: t("admissionPortal.interview.heading") },
    { key: "ADMISSION_ACCEPTED", label: t("admissionPortal.demo.tiles.admissionForm") },
    { key: "DOCUMENTS_VERIFIED", label: t("admissionPortal.demo.steps.documentsVerification") },
    { key: "PAYMENT_COMPLETED", label: t("admissionPortal.demo.tiles.feePayment") },
    { key: "ENROLLED", label: t("admissionPortal.status.enrolled") },
  ];
}
const ORDER = [
  "INQUIRY_SUBMITTED",
  "INQUIRY_REVIEWED",
  "REGISTRATION_PENDING",
  "REGISTRATION_IN_PROGRESS",
  "REGISTRATION_SUBMITTED",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_COMPLETED",
  "ASSESSMENT_SCHEDULED",
  "ASSESSMENT_COMPLETED",
  "ADMISSION_OFFERED",
  "ADMISSION_ACCEPTED",
  "DOCUMENTS_PENDING",
  "DOCUMENTS_SUBMITTED",
  "DOCUMENTS_VERIFIED",
  "PAYMENT_PENDING",
  "PAYMENT_PARTIAL",
  "PAYMENT_COMPLETED",
  "ENROLLED",
];

function ProgressSteps({ currentStatus }: { currentStatus: string }) {
  const { t } = useTranslation("parent");
  const STEPS = useDemoSteps();
  const ci = ORDER.indexOf(currentStatus);
  return (
    <div className="space-y-0">
      {STEPS.map((s, i) => {
        const si = ORDER.indexOf(s.key);
        const done = ci >= si;
        const cur =
          !done && (i === 0 || ci >= ORDER.indexOf(STEPS[i - 1]!.key));
        const last = i === STEPS.length - 1;
        return (
          <div key={s.key} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-emerald-500 text-white" : cur ? "bg-primary text-primary-foreground ring-4 ring-primary/20" : "bg-muted border-2 border-border"}`}
              >
                {done ? (
                  <CheckCircle size={14} />
                ) : cur ? (
                  <Clock size={12} />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                )}
              </div>
              {!last && (
                <div
                  className={`w-0.5 h-8 ${done ? "bg-emerald-500" : "bg-border"}`}
                />
              )}
            </div>
            <div className="pb-6">
              <p
                className={`text-sm font-medium ${done ? "text-foreground" : cur ? "text-primary font-semibold" : "text-muted-foreground"}`}
              >
                {s.label}
              </p>
              {cur && (
                <p className="text-caption text-primary/70 mt-0.5">
                  {t("admissionPortal.dashboard.stepInProgress")}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
