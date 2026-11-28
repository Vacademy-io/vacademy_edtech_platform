import { DotsSixVertical } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { ResizableSplit } from "./use-resizable-split";

/**
 * The draggable, keyboard-operable divider between the two panes of a
 * {@link useResizableSplit} row. Double-click puts it back at the default.
 */
export function SplitDivider({
  split,
  label,
  valueText,
}: {
  split: ResizableSplit;
  /** Accessible name, e.g. "Resize scenario and answer panes". */
  label: string;
  /** Spoken value, e.g. "Scenario 40% of the width". */
  valueText: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(split.split)}
      aria-valuemin={Math.round(split.bounds.min)}
      aria-valuemax={Math.round(split.bounds.max)}
      aria-valuetext={valueText}
      tabIndex={0}
      onPointerDown={split.onDividerPointerDown}
      onPointerMove={split.onDividerPointerMove}
      onPointerUp={split.onDividerPointerUp}
      onPointerCancel={split.onDividerPointerUp}
      onKeyDown={split.onDividerKeyDown}
      onDoubleClick={() => split.updateSplit(split.defaultPct)}
      className={cn(
        "group flex w-3 flex-none cursor-col-resize touch-none items-center justify-center border-x border-neutral-200 bg-neutral-100 transition-colors",
        "hover:bg-primary-50 focus-visible:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300",
      )}
    >
      <DotsSixVertical size={14} className="text-neutral-400 group-hover:text-primary-500" aria-hidden />
    </div>
  );
}
