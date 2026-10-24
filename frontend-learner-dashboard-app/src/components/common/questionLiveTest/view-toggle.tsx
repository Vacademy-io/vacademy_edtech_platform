import { GridFour, List } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import type { QuestionPaletteView } from "@/types/assessment-experience";

interface ViewToggleProps {
  view: QuestionPaletteView;
  onViewChange: (view: QuestionPaletteView) => void;
}

const getOptions = (
  t: TFunction,
): Array<{
  value: QuestionPaletteView;
  label: string;
  Icon: typeof GridFour;
}> => [
  { value: "grid", label: t("viewToggle.grid"), Icon: GridFour },
  { value: "list", label: t("viewToggle.list"), Icon: List },
];

/** Segmented control for the question palette's grid / list modes. */
export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
  const { t } = useTranslation("questionTest");
  const OPTIONS = getOptions(t);
  return (
    <div className="flex flex-none gap-0.5 rounded-lg bg-neutral-200 p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = view === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => onViewChange(value)}
            className={cn(
              "grid size-7 place-items-center rounded-md transition-colors",
              isActive
                ? "bg-white text-neutral-800 shadow-sm"
                : "text-neutral-500 hover:text-neutral-700",
            )}
          >
            <Icon size={15} weight={isActive ? "fill" : "regular"} />
          </button>
        );
      })}
    </div>
  );
}
