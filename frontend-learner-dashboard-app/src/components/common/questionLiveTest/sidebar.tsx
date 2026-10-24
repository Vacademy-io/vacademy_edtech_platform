"use client";

import { useTranslation } from "react-i18next";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { QuestionNavigator } from "./question-navigator";

/**
 * Mobile question palette.
 *
 * A bottom sheet rather than the old left drawer: on a phone the palette is a
 * reach-target the learner opens from the footer, and a side drawer both covered
 * the question and put the grid out of thumb range. Desktop renders the same
 * palette body inline as a right rail instead (see `page.tsx`).
 */
export function Sidebar({
  isOpen,
  onClose,
  evaluationType,
}: {
  isOpen: boolean;
  onClose: () => void;
  evaluationType: string;
}) {
  const { t } = useTranslation("questionTest");
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        hideCloseButton
        aria-label={t("sidebar.paletteAriaLabel")}
        className="flex h-screen-85 flex-col rounded-t-2xl border-neutral-200 p-0"
      >
        <div className="grid flex-none place-items-center py-2">
          <span className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>
        <div className="min-h-0 flex-1">
          <QuestionNavigator onClose={onClose} evaluationType={evaluationType} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
