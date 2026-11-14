import { Badge } from "@/components/ui/badge";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { assessmentTypes } from "@/types/assessment";
import { PlayCircle, CalendarDots, ClockCounterClockwise } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";

const tabIcons = {
  [assessmentTypes.LIVE]: PlayCircle,
  [assessmentTypes.UPCOMING]: CalendarDots,
  [assessmentTypes.PAST]: ClockCounterClockwise,
};

const tabLabelKeys: Record<string, string> = {
  [assessmentTypes.LIVE]: "scheduleTest.tabs.live",
  [assessmentTypes.UPCOMING]: "scheduleTest.tabs.upcoming",
  [assessmentTypes.PAST]: "scheduleTest.tabs.past",
};

const ScheduleTestTabList = ({
  selectedTab,
  totalAssessments,
}: {
  selectedTab: string;
  totalAssessments: { [key: string]: number };
}) => {
  const { t } = useTranslation("assessment");
  const stripRef = useRef<HTMLDivElement>(null);
  const counts = Object.values(assessmentTypes).map((type) => totalAssessments[type]).join();

  // Keep the selected tab whole inside the sideways-scrolling strip. This moves the
  // strip only, never the page, so opening the screen stays where it is.
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!strip || !tab || strip.scrollWidth <= strip.clientWidth) return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const overBy =
      tabBox.left < stripBox.left
        ? tabBox.left - stripBox.left
        : Math.max(0, tabBox.right - stripBox.right);
    if (overBy === 0) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    strip.scrollBy({ left: overBy, behavior: reduceMotion ? "auto" : "smooth" });
  }, [selectedTab, counts]);

  return (
    <div ref={stripRef} className="no-scrollbar flex items-center pb-4 overflow-x-auto">
      <TabsList className="h-auto p-1 bg-muted w-max min-w-full shrink-0 sm:w-auto sm:min-w-0">
        {Object.values(assessmentTypes).map((type) => {
          const Icon = tabIcons[type as assessmentTypes];
          const count = totalAssessments[type];
          return (
            <TabsTrigger
              key={type}
              value={type}
              className={cn(
                "flex items-center gap-1 px-2 py-2 text-sm sm:gap-2 sm:px-4 font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
                "flex-1 sm:flex-none justify-center"
              )}
            >
              <Icon className="w-4 h-4" />
              <span>
                {t(tabLabelKeys[type as assessmentTypes])}
              </span>
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className="rounded-full sm:ms-1 px-2 py-0.5 text-caption h-5 min-w-5 flex items-center justify-center bg-primary/10 text-primary hover:bg-primary/20"
                >
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </div>
  );
};

export default ScheduleTestTabList;
