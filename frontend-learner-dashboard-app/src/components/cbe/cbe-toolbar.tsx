/**
 * Toolbar primitives shared by the CBE spreadsheet and document editors.
 * Learner app: built on the canonical `Toggle` (pressed state) and its
 * `toggleVariants` (plain actions), so the toolbar themes with the app.
 */
import type { MouseEvent, ReactNode } from "react";
import { Toggle, toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

type ToolButtonProps = {
  label: string;
  children: ReactNode;
  onClick: () => void;
  /** Present = toggle button showing this pressed state; absent = one-shot action. */
  active?: boolean;
  disabled?: boolean;
};

// Keep the editor's selection: toolbar clicks must not steal focus.
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function ToolButton({ label, children, onClick, active, disabled }: ToolButtonProps) {
  if (active !== undefined) {
    return (
      <Toggle
        size="sm"
        pressed={active}
        onPressedChange={() => onClick()}
        onMouseDown={keepFocus}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="data-[state=on]:bg-primary-50 data-[state=on]:text-primary-500"
      >
        {children}
      </Toggle>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={keepFocus}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(toggleVariants({ size: "sm" }), "text-neutral-600")}
    >
      {children}
    </button>
  );
}

export function ToolDivider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

export function Toolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Short text glyph for buttons without a fitting icon ("1,000", ".0+"). */
export function ToolText({ children }: { children: ReactNode }) {
  return <span className="text-caption font-semibold tabular-nums">{children}</span>;
}
