import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { ChildProfile, AdmissionTimelineEvent } from "@/types/parent-portal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, ArrowRight, Circle, CalendarDots, Flag } from "@phosphor-icons/react";
import { formatDate } from "@/lib/formatters";

interface Props { child: ChildProfile; timeline: AdmissionTimelineEvent[] }

export function TrackerDemo({ child, timeline }: Props) {
  const { t } = useTranslation("parent");
  const done = timeline.filter(e => e.status === "COMPLETED").length;
  const pct = Math.round((done / timeline.length) * 100);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-5 pb-20 lg:pb-8">
      <div><h2 className="text-lg sm:text-xl font-bold text-foreground">{t("admissionPortal.tracker.heading")}</h2><p className="text-sm text-muted-foreground mt-0.5">{t("admissionPortal.demo.fullJourneyFor", { name: child.full_name })}</p></div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="shadow-sm overflow-hidden"><CardContent className="p-card">
          <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><Flag size={16} className="text-primary" /><p className="text-sm font-semibold">{t("admissionPortal.tracker.overallProgress")}</p></div><Badge variant="outline" className="text-xs">{t("admissionPortal.tracker.stepsCount", { completed: done, total: timeline.length })}</Badge></div>
          <div className="relative h-2 rounded-full bg-muted overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} className="absolute inset-y-0 start-0 bg-gradient-to-r from-primary to-success-500 rounded-full" /></div>
          <p className="text-xs text-muted-foreground mt-1.5 text-end">{t("admissionPortal.tracker.percentComplete", { percent: pct })}</p>
        </CardContent></Card>
      </motion.div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4"><CardTitle className="text-base flex items-center gap-2"><CalendarDots size={16} />{t("admissionPortal.demo.journeyTimeline")}</CardTitle></CardHeader>
        <CardContent>
          <div className="relative">{timeline.map((e, i) => {
            const comp = e.status === "COMPLETED", cur = e.status === "CURRENT", up = e.status === "UPCOMING", skip = e.status === "SKIPPED", last = i === timeline.length - 1;
            return (
              <motion.div key={e.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${comp ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200 dark:shadow-emerald-900" : cur ? "bg-primary text-primary-foreground ring-4 ring-primary/15 shadow-sm" : skip ? "bg-muted border-2 border-dashed border-border" : "bg-muted border-2 border-border"}`}>
                    {comp ? <CheckCircle size={16} /> : cur ? <Clock size={14} /> : skip ? <ArrowRight size={12} className="text-muted-foreground" /> : <Circle size={8} className="text-muted-foreground/40" />}
                  </div>
                  {!last && <div className={`w-0.5 flex-1 min-h-6 ${comp ? "bg-emerald-400" : "bg-border"}`} />}
                </div>
                <div className={`flex-1 pb-6 min-w-0 ${up ? "opacity-50" : ""} ${skip ? "opacity-40" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><p className={`text-sm font-semibold ${cur ? "text-primary" : comp ? "text-foreground" : "text-muted-foreground"}`}>{e.title}</p>{e.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{e.description}</p>}</div>
                    {cur && <Badge className="bg-primary/10 text-primary text-caption shrink-0 animate-pulse">{t("admissionPortal.demo.current")}</Badge>}
                  </div>
                  {e.timestamp && <p className="text-caption text-muted-foreground/60 mt-1">{formatDate(e.timestamp, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>}
                </div>
              </motion.div>
            );
          })}</div>
        </CardContent>
      </Card>
    </div>
  );
}
