import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile, InterviewSchedule, AssessmentSchedule } from "@/types/parent-portal";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Clock, MapPin, VideoCamera, Timer, ArrowSquareOut, CalendarDots } from "@phosphor-icons/react";
import { formatDate } from "@/lib/formatters";

interface Props { child: ChildProfile; interview: InterviewSchedule; assessment: AssessmentSchedule }

export function InterviewDemo({ child, interview, assessment }: Props) {
  const { t } = useTranslation("parent");
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-6 pb-20 lg:pb-8">
      <div><h2 className="text-lg sm:text-xl font-bold text-foreground">{t("admissionPortal.interview.heading")}</h2><p className="text-sm text-muted-foreground mt-0.5">{t("admissionPortal.interview.subheading", { name: child.full_name })}</p></div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <ScheduleCard type={t("admissionPortal.interview.interviewType")} date={interview.scheduled_date} time={interview.scheduled_time} dur={interview.duration_minutes} mode={interview.mode} link={interview.meeting_link} location={interview.location} icon={<VideoCamera size={20} className="text-violet-600 dark:text-violet-400" />} accent="violet" />
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <ScheduleCard type={t("admissionPortal.interview.assessmentType")} date={assessment.scheduled_date} time={assessment.scheduled_time} dur={assessment.duration_minutes} mode={assessment.mode} location={assessment.location} icon={<CalendarCheck size={20} className="text-blue-600 dark:text-blue-400" />} accent="blue" />
      </motion.div>
    </div>
  );
}

function ScheduleCard({ type, date, time, dur, mode, link, location, icon, accent }: { type: string; date: string; time: string; dur: number; mode: string; link?: string; location?: string; icon: React.ReactNode; accent: "violet" | "blue" }) {
  const { t } = useTranslation("parent");
  const dateStr = formatDate(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const bg = accent === "violet" ? "bg-violet-50 dark:bg-violet-950/20" : "bg-blue-50 dark:bg-blue-950/20";
  const border = accent === "violet" ? "border-s-violet-500" : "border-s-blue-500";
  return (
    <Card className={`shadow-sm border-s-4 ${border}`}>
      <CardHeader className="pb-3"><div className="flex items-center gap-2.5"><div className={`p-2 rounded-lg ${bg}`}>{icon}</div><div><CardTitle className="text-base">{type}</CardTitle><CardDescription className="text-xs">{t("admissionPortal.interview.upcoming")}</CardDescription></div></div></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 text-sm"><CalendarDots size={14} className="text-muted-foreground" /><span>{dateStr}</span></div>
          <div className="flex items-center gap-2 text-sm"><Clock size={14} className="text-muted-foreground" /><span>{time}</span></div>
          <div className="flex items-center gap-2 text-sm"><Timer size={14} className="text-muted-foreground" /><span className="text-muted-foreground">{t("admissionPortal.interview.durationMin", { duration: dur })}</span></div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {mode === "ONLINE" ? <VideoCamera size={14} className="text-muted-foreground" /> : <MapPin size={14} className="text-muted-foreground" />}
          <span>{mode === "ONLINE" ? t("admissionPortal.interview.online") : location || t("admissionPortal.interview.onCampus")}</span>
          <Badge variant="outline" className="text-caption ms-auto">{mode}</Badge>
        </div>
        {link && <Button variant="outline" size="sm" className="w-full sm:w-auto gap-1.5 text-xs h-8" onClick={() => window.open(link, "_blank")}><VideoCamera size={12} />{t("admissionPortal.demo.joinMeeting")}<ArrowSquareOut size={10} /></Button>}
      </CardContent>
    </Card>
  );
}
