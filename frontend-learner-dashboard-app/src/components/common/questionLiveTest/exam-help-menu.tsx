import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HelpModal, type HelpModalType } from "@/components/modals/help-modals";

/**
 * The live test's Help menu: report a problem with the question on screen, read the
 * instructions or alerts, or ask the institute for a reattempt or more time. Each layout
 * passes its own trigger (an icon button in the default header, a header link in the exam
 * consoles), so every layout offers the same requests.
 */
export function ExamHelpMenu({
  trigger,
  align = "end",
}: {
  /** Must accept a ref and props (rendered with `asChild`). */
  trigger: ReactNode;
  align?: "start" | "center" | "end";
}) {
  const { t } = useTranslation("questionTest");
  const [helpType, setHelpType] = useState<HelpModalType | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          <DropdownMenuItem onClick={() => setHelpType("report")}>
            {t("navbar.help.menu.reportProblem")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setHelpType("instructions")}>
            {t("navbar.help.menu.instructions")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHelpType("alerts")}>
            {t("navbar.help.menu.alerts")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHelpType("reattempt")}>
            {t("navbar.help.menu.reattempt")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHelpType("time")}>
            {t("navbar.help.menu.timeIncrease")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <HelpModal
        open={helpType !== null}
        onOpenChange={(open) => !open && setHelpType(null)}
        type={helpType ?? "instructions"}
      />
    </>
  );
}
