import { MyButton } from "@/components/design-system/button";
import { Calendar, CalendarDots, ListChecks } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export type ActivityPeriod = "today" | "tomorrow" | "all";

interface ActivityPeriodSelectorProps {
  selectedPeriod: ActivityPeriod;
  onSelect: (period: ActivityPeriod) => void;
}

export default function ActivityPeriodSelector({
  selectedPeriod,
  onSelect,
}: ActivityPeriodSelectorProps) {
  const { t } = useTranslation("planning");
  const options: { id: ActivityPeriod; label: string; icon: any }[] = [
    { id: "today", label: t("periodSelector.today"), icon: Calendar },
    { id: "tomorrow", label: t("periodSelector.tomorrow"), icon: CalendarDots },
    { id: "all", label: t("periodSelector.allActivities"), icon: ListChecks },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = selectedPeriod === option.id;
        return (
          <MyButton
            key={option.id}
            buttonType={isSelected ? "primary" : "secondary"}
            scale="small"
            onClick={() => onSelect(option.id)}
            className="gap-2"
          >
            <Icon className="size-4" />
            {option.label}
          </MyButton>
        );
      })}
    </div>
  );
}
