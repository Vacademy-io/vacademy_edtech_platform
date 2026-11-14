/**
 * Toolbar primitives shared by the CBE spreadsheet and document editors.
 * Admin app: icon-only `MyButton` (text variant); pressed tools get the
 * primary tint.
 */
import type { MouseEvent, ReactNode } from "react";
import { MyButton } from "@/components/design-system/button";
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
  return (
    <MyButton
      type="button"
      buttonType="text"
      layoutVariant="icon"
      scale="medium"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disable={disabled}
      onMouseDown={keepFocus}
      onClick={() => onClick()}
      className={cn("size-8 text-neutral-600 hover:bg-neutral-100", active && "bg-primary-50 text-primary-500")}
    >
      {children}
    </MyButton>
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
