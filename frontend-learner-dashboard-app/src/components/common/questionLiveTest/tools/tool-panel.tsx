import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface ToolPanelProps {
  title: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Chrome shared by the in-exam tools (calculator, scratchpad).
 *
 * The panel is positioned by its parent, not itself — the exam shell anchors it
 * clear of the footer and, on desktop, clear of the question palette, so a tool
 * never sits on top of the question a learner is reading.
 */
export function ToolPanel({
  title,
  icon,
  onClose,
  children,
  className,
}: ToolPanelProps) {
  const { t } = useTranslation("questionTest");
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg",
        className,
      )}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 py-2 pe-2 ps-3">
        <span className="text-neutral-500">{icon}</span>
        <span className="flex-1 text-caption font-semibold text-neutral-800">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("toolPanel.closeAriaLabel", { title })}
          className="grid size-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
        >
          <X size={15} weight="bold" />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
