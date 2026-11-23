// Module switcher for the slide viewer's sidebar header.
//
// Some courses split their content into modules a learner picks from each
// visit, e.g. a "learn" module next to a "daily practice" one. The course page's
// structure cards are where that choice is made. Inside the viewer, the other
// ways to reach a sibling module were a long scroll down the lesson list, or a
// small breadcrumb popover where a module had to be expanded and then a chapter
// picked. This control shows the current module at full width. One tap lists
// every module, a second opens that module at its first unfinished chapter, and
// the footer goes back to the course page's structure cards.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretUpDown, CheckCircle, SquaresFour } from "@phosphor-icons/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import type { ModulesWithChapters } from "@/stores/study-library/use-modules-with-chapters-store";
import { humanizeTitle } from "./slide-display-utils";

const isDefaultName = (name: string | null | undefined): boolean =>
  (name || "").trim().toLowerCase() === "default";

/**
 * The modules a learner can switch between: the ones with a real name and at
 * least one chapter. A "DEFAULT" module is the placeholder a course without
 * modules carries, not something to pick.
 */
export const switchableModules = (
  modules: ModulesWithChapters[] | null | undefined
): ModulesWithChapters[] =>
  (modules ?? []).filter(
    (m) => !isDefaultName(m.module.module_name) && (m.chapters ?? []).length > 0
  );

/** Where a module opens: its first unfinished chapter, else its first one. */
export const moduleEntryChapterId = (
  mod: ModulesWithChapters,
  threshold: number = getSlideCompletionThreshold()
): string | null => {
  const chapters = mod.chapters ?? [];
  const entry =
    chapters.find((c) => (c.percentage_completed ?? 0) < threshold) ??
    chapters[0];
  return entry?.id ?? null;
};

type Props = {
  /** Already narrowed with `switchableModules`, in course order. */
  modules: ModulesWithChapters[];
  currentModuleId: string;
  onModuleSelect: (moduleId: string, chapterId: string) => void;
  /** Opens the course page, where the structure cards are. */
  onOpenOverview: () => void;
};

export const ModuleSwitcher = ({
  modules,
  currentModuleId,
  onModuleSelect,
  onOpenOverview,
}: Props) => {
  const { t } = useTranslation("libraryCommonB");
  const [open, setOpen] = useState(false);

  const moduleTerm = getTerminology(ContentTerms.Modules, SystemTerms.Modules);
  const modulesTerm = getTerminologyPlural(
    ContentTerms.Modules,
    SystemTerms.Modules
  );
  const chaptersTerm = getTerminologyPlural(
    ContentTerms.Chapters,
    SystemTerms.Chapters
  );
  const threshold = getSlideCompletionThreshold();
  const current = modules.find((m) => m.module.id === currentModuleId);
  const currentName = current
    ? humanizeTitle(current.module.module_name)
    : moduleTerm;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("moduleSwitcher.triggerAria", {
            term: moduleTerm.toLowerCase(),
            name: currentName,
          })}
          className="flex w-full items-center gap-2 rounded-md border border-gray-150 bg-white px-2.5 py-1.5 text-start transition-colors hover:border-gray-300 hover:bg-gray-50 [.ui-play_&]:rounded-lg [.ui-play_&]:border-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-2xs font-medium uppercase tracking-wide text-gray-500">
              {moduleTerm}
            </span>
            <span
              className="block truncate text-caption font-semibold leading-tight text-gray-900"
              title={currentName}
            >
              {currentName}
            </span>
          </span>
          <CaretUpDown
            size={14}
            weight="bold"
            className="shrink-0 text-gray-400"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 overflow-hidden rounded-lg border border-gray-200 p-0 shadow-md"
      >
        <div className="custom-scrollbar max-h-80 overflow-y-auto py-1">
          {modules.map((mod) => {
            const isCurrent = mod.module.id === currentModuleId;
            const chapters = mod.chapters ?? [];
            const total = chapters.length;
            const done = chapters.filter(
              (c) => (c.percentage_completed ?? 0) >= threshold
            ).length;
            const finished = total > 0 && done === total;
            return (
              <button
                key={mod.module.id}
                type="button"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => {
                  setOpen(false);
                  if (isCurrent) return;
                  const chapterId = moduleEntryChapterId(mod, threshold);
                  if (chapterId) onModuleSelect(mod.module.id, chapterId);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-start transition-colors",
                  isCurrent ? "bg-primary-50" : "hover:bg-gray-50"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "line-clamp-2 block text-caption font-semibold leading-snug",
                      isCurrent ? "text-primary-500" : "text-gray-800"
                    )}
                  >
                    {humanizeTitle(mod.module.module_name)}
                  </span>
                  <span className="mt-0.5 block text-2xs tabular-nums text-gray-500">
                    {t("moduleSwitcher.progress", {
                      done,
                      total,
                      term: chaptersTerm.toLowerCase(),
                    })}
                  </span>
                </span>
                {isCurrent ? (
                  <span className="shrink-0 pt-0.5 text-2xs font-bold uppercase tracking-wide text-primary-500">
                    {t("moduleSwitcher.current")}
                  </span>
                ) : finished ? (
                  <CheckCircle
                    size={14}
                    weight="fill"
                    className="mt-0.5 shrink-0 text-success-500"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onOpenOverview();
          }}
          className="flex w-full items-center gap-2 border-t border-gray-100 bg-gray-50 px-3 py-2 text-start text-caption font-semibold text-gray-700 transition-colors hover:bg-gray-100"
        >
          <SquaresFour size={14} weight="bold" className="shrink-0 text-gray-500" />
          {t("moduleSwitcher.viewAll", { term: modulesTerm.toLowerCase() })}
        </button>
      </PopoverContent>
    </Popover>
  );
};
