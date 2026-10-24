import { cn } from "@/lib/utils";
import { Tray, type Icon } from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";

export interface EmptyStateProps {
  /** Phosphor icon component. Defaults to a tray glyph. */
  icon?: Icon;
  title: string;
  description?: string;
  /** Primary call-to-action that helps the user populate this surface. */
  action?: { label: string; onClick: () => void };
  /** Tighter spacing for use inside cards/panels rather than full-page. */
  compact?: boolean;
  className?: string;
}

/**
 * Canonical empty state: composed, friendly, and points the user to a next step.
 * Use on any list/grid/section that can legitimately have no data.
 */
export function EmptyState({
  icon: IconCmp = Tray,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 py-8" : "gap-3 py-16",
        compact ? "" : "[.ui-play_&]:gap-4 [.ui-cleaner-play_&]:gap-4",
        className,
      )}
    >
      {/* Skin-aware medallion.
          This component is the canonical empty state across 15 surfaces, so on a
          fresh or lightly-populated account it is a large share of what a learner
          actually sees — which is precisely why a sparse demo reads as "blank and
          basic". Each skin gets its own treatment rather than the same small
          neutral disc everywhere:
            play         bigger, gold, chunky — an invitation, not an absence
            cleanerPlay  bigger, warm gold tint, matching the felted set
            corporate    a white bordered icon tile with a soft shadow — the
                         modern B2B empty-state idiom; calm, not celebratory
          The icon size override works because CSS beats the presentational
          width/height attributes Phosphor emits for `size`. */}
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500",
          "[.ui-play_&]:size-20 [.ui-play_&]:rounded-play-card [.ui-play_&]:bg-play-gold-soft [.ui-play_&]:text-play-gold-soft-ink [.ui-play_&]:shadow-play-soft-card",
          "[.ui-cleaner-play_&]:size-20 [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-gold",
          "[.ui-corporate_&]:rounded-xl [.ui-corporate_&]:border [.ui-corporate_&]:border-border [.ui-corporate_&]:bg-card [.ui-corporate_&]:text-foreground [.ui-corporate_&]:shadow-sm",
        )}
      >
        <IconCmp
          size={24}
          weight="duotone"
          className="[.ui-play_&]:size-10 [.ui-cleaner-play_&]:size-10"
        />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-title font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="max-w-sm text-body text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <MyButton
          buttonType="primary"
          scale="medium"
          onClick={action.onClick}
          className="mt-2"
        >
          {action.label}
        </MyButton>
      )}
    </div>
  );
}
