import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { SpinnerGap } from "@phosphor-icons/react";

export interface LoadingStateProps {
  /**
   * Shape of the skeleton so the loading layout matches the final content
   * (avoids layout shift). "inline" shows a small spinner for in-button / in-row loads.
   */
  variant?: "list" | "cards" | "page" | "inline";
  /** Number of skeleton items for list/cards variants. */
  count?: number;
  className?: string;
}

/**
 * Canonical loading state. Prefer skeletons that mirror the final layout over a
 * bare spinner; the "inline" variant exists for small in-context loads only.
 */
export function LoadingState({ variant = "list", count = 4, className }: LoadingStateProps) {
  if (variant === "inline") {
    return (
      <span
        className={cn("inline-flex items-center gap-2 text-body text-muted-foreground", className)}
        role="status"
        aria-live="polite"
      >
        <SpinnerGap size={18} className="animate-spin" />
      </span>
    );
  }

  if (variant === "cards") {
    return (
      <div
        className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}
        role="status"
        aria-live="polite"
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-col gap-stack rounded-xl border border-border p-4">
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "page") {
    return (
      <div className={cn("flex flex-col gap-6", className)} role="status" aria-live="polite">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex flex-col gap-stack">
          {Array.from({ length: count }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // list
  return (
    <div className={cn("flex flex-col gap-3", className)} role="status" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
