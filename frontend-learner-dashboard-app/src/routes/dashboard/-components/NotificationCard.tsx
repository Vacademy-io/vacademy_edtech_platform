import { Bell, CaretRight, Clock, Megaphone, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface NotificationCardProps {
  title?: string;
  description?: string;
  date?: string;
  isNew?: boolean;
  /** How many identical notifications collapsed into this row (1 = no chip). */
  count?: number;
  variant?: "general" | "announcement";
  onClick?: () => void;
  /** Dismiss this row. Omit to hide the clear affordance entirely. */
  onClear?: () => void;
  clearing?: boolean;
}

/**
 * One notification row. It is a real <button>: the whole card opens the detail
 * dialog, so it must be reachable by keyboard and announce itself as an action.
 *
 * The clear (×) control is a SIBLING of that button, positioned over its corner,
 * not a child — a <button> inside a <button> is invalid HTML and the inner one
 * does not reliably receive clicks.
 *
 * Contrast rules (the reason the ink colors below are explicit rather than
 * inherited): on the Play skin an unread card sits on the `--play-c-info-soft`
 * tint, where the shared `text-muted-foreground` slate lands at
 * 4.33:1 — under AA — and reads as washed-out blue-on-blue. Every text layer
 * therefore names its own Play ink, and the "View details" affordance sits on
 * an opaque `bg-background` chip so it never depends on the card's tint.
 */
export function NotificationCard({
  title,
  description,
  date,
  isNew = true,
  count = 1,
  variant = "general",
  onClick,
  onClear,
  clearing = false,
}: NotificationCardProps) {
  const { t } = useTranslation("dashboard");
  const Icon = variant === "announcement" ? Megaphone : Bell;

  return (
    <div className={cn("group relative", clearing && "pointer-events-none opacity-50")}>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={clearing}
          aria-label={t("notifications.clearOne", { title: title ?? "" })}
          title={t("notifications.clear")}
          className={cn(
            "absolute end-2 top-2 z-10 flex size-7 items-center justify-center rounded-full",
            "text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            "[.ui-play_&]:text-play-ink/75"
          )}
        >
          <X size={14} weight="bold" />
        </button>
      )}

      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative block w-full overflow-hidden rounded-xl border text-start",
          "transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isNew
            ? "border-primary-200 bg-primary-50/50 shadow-sm"
            : "border-border bg-card shadow-sm",
          // Vibrant: a touch more lift, no new tint (tints are what hurt the ink).
          "[.ui-vibrant_&]:hover:shadow-lg [.ui-vibrant_&]:hover:border-primary-300",
          // Play: `notification-card-new` owns the pastel surface + radius via
          // play-theme.css (!important), so only the ink is set here.
          isNew && "notification-card-new"
        )}
      >
      {/* Unread accent rail — the primary unread signal, so the surface tint
          can stay light enough for body text to stay legible. */}
      {isNew && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 start-0 w-1 bg-primary-500 [.ui-play_&]:bg-play-info"
        />
      )}

      <span className="flex items-start gap-3 p-card sm:gap-4 sm:p-5">
        <span
          className={cn(
            "flex size-9 flex-shrink-0 items-center justify-center rounded-lg",
            isNew
              ? "bg-primary-100 text-primary-500"
              : "bg-muted text-muted-foreground",
            isNew && "[.ui-play_&]:bg-white [.ui-play_&]:text-play-info-soft-ink"
          )}
        >
          <Icon size={18} weight={isNew ? "fill" : "regular"} />
        </span>

        <span className="min-w-0 flex-1">
          {/* `pe-7` only on the title row: it keeps the badges clear of the
              absolutely-positioned × without insetting the footer too. */}
          <span
            className={cn(
              "mb-1 flex items-start justify-between gap-2",
              onClear && "pe-7"
            )}
          >
            <span
              className={cn(
                "line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground sm:text-base",
                "[.ui-play_&]:font-bold [.ui-play_&]:text-play-ink"
              )}
            >
              {title}
            </span>

            <span className="flex flex-shrink-0 items-center gap-1.5">
              {count > 1 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-caption font-semibold tabular-nums text-foreground/70 [.ui-play_&]:bg-white [.ui-play_&]:text-play-ink">
                  {t("notifications.occurrenceCount", { count })}
                </span>
              )}
              {isNew && (
                /* Dark ink on a white pill with a brand dot, NOT white-on-
                   brand-fill: primary-500 is tuned as a fill, and white text
                   on it measures 2.8:1 on the stock brand — the badge would
                   be the least readable thing on the card. */
                <span className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-caption font-semibold text-foreground ring-1 ring-primary-200">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-primary-500" />
                  {t("notifications.newBadge")}
                </span>
              )}
            </span>
          </span>

          {description && (
            <span
              className={cn(
                "line-clamp-2 block break-words text-sm leading-relaxed text-muted-foreground",
                "[.ui-play_&]:font-medium [.ui-play_&]:text-play-ink/80"
              )}
            >
              {description}
            </span>
          )}

          <span className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs">
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-muted-foreground",
                "[.ui-play_&]:text-play-ink/75"
              )}
            >
              <Clock size={13} />
              <span>{date}</span>
            </span>

            {/* Always visible — this used to be `opacity-0 group-hover:opacity-100`,
                which meant the only affordance was invisible at rest and
                unreachable entirely on touch devices. */}
            <span
              className={cn(
                "flex flex-shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1",
                "font-semibold text-foreground transition-colors",
                "group-hover:border-primary-300 group-hover:bg-primary-50"
              )}
            >
              {t("notifications.viewDetails")}
              <CaretRight
                size={12}
                weight="bold"
                className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
              />
            </span>
          </span>
        </span>
      </span>
      </button>
    </div>
  );
}
