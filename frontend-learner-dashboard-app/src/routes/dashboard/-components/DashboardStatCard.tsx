import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CaretRight, ArrowRight } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";

export const StatCardSkeleton = () => (
    <Card className="h-full">
        <CardContent className="p-card sm:p-5 flex flex-col justify-between h-full space-y-4">
            <div className="flex items-center justify-between">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-5 w-5 rounded-full" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-4 w-24" />
            </div>
        </CardContent>
    </Card>
);

/**
 * "stack" is the tile used when stat cards sit side by side in a row of two or
 * three. "row" is for the case where the institute's display settings left only
 * ONE stat visible: a lone tile stretched across the full column reads as a
 * mostly-empty box, so it lays out horizontally (icon | text | chevron) and
 * becomes a banner instead.
 */
export type StatCardLayout = "stack" | "row";

export const StatCard = ({
    title,
    count,
    icon: Icon,
    onClick,
    isLoading = false,
    className,
    iconClassName,
    cleanerIllustrationSrc,
    emptyActionLabel,
    layout = "stack",
}: {
    title: string;
    count: number | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: any;
    onClick: () => void;
    isLoading?: boolean;
    className?: string;
    iconClassName?: string;
    /** Play + Cleaner Play — a shared raster (webp) icon illustration, since
     *  both skins' art is generated imagery, not an SVG component. */
    cleanerIllustrationSrc?: string;
    /** Shown instead of the title when the count is genuinely 0, turning the
     *  card into an invitation (e.g. "Browse Courses") rather than a dead zero. */
    emptyActionLabel?: string;
    /** See {@link StatCardLayout}. Defaults to the side-by-side tile. */
    layout?: StatCardLayout;
}) => {
    const { t } = useTranslation("dashboard");
    const isPlay = usePlayTheme();
    const isCleanerPlay = useCleanerPlayTheme();
    const isRow = layout === "row";

    // Skeleton while loading — covers the count-not-yet-known (undefined/null) case
    if (isLoading) return <StatCardSkeleton />;

    const isEmpty = (count ?? 0) === 0;
    const showAction = isEmpty && !!emptyActionLabel;
    const subtitleText = showAction ? emptyActionLabel : title;
    const cardAriaLabel = showAction
        ? t("statCard.ariaAction", { title, action: emptyActionLabel })
        : t("statCard.ariaView", { title, count: count ?? 0 });

    if (isCleanerPlay) {
        return (
            <button
                type="button"
                onClick={onClick}
                aria-label={cardAriaLabel}
                className={cn(
                    "cp-card group flex h-full w-full gap-3 p-4 text-start transition-transform duration-base ease-out-soft hover:-translate-y-0.5",
                    isRow
                        ? "flex-row items-center sm:gap-4"
                        : "flex-col items-start"
                )}
            >
                <div
                    className={cn(
                        "flex items-center",
                        isRow ? "shrink-0" : "w-full justify-between"
                    )}
                >
                    {cleanerIllustrationSrc ? (
                        <img
                            src={cleanerIllustrationSrc}
                            alt=""
                            aria-hidden="true"
                            className="h-11 w-11 object-contain"
                        />
                    ) : (
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cp-sage-tint text-cp-sage">
                            <Icon size={20} weight="duotone" />
                        </span>
                    )}
                    {!isRow && (
                        <CaretRight
                            size={16}
                            className="cp-muted transition-transform duration-300 group-hover:translate-x-0.5"
                        />
                    )}
                </div>
                <div
                    className={cn(
                        "flex flex-col",
                        isRow ? "min-w-0 flex-1 gap-1" : "gap-3"
                    )}
                >
                    {showAction ? (
                        <span className="cp-heading inline-flex flex-wrap items-center gap-1 text-h3 sm:text-h2">
                            {t("statCard.getStarted")}
                            <ArrowRight size={16} weight="bold" />
                        </span>
                    ) : (
                        <span className="cp-heading block text-h3 tabular-nums sm:text-h2">
                            {(count ?? 0).toLocaleString()}
                        </span>
                    )}
                    <span className="cp-muted block text-caption font-medium">
                        {subtitleText}
                    </span>
                </div>
                {isRow && (
                    <CaretRight
                        size={16}
                        className="cp-muted shrink-0 transition-transform duration-300 group-hover:translate-x-0.5"
                    />
                )}
            </button>
        );
    }

    return (
        <Card
            onClick={onClick}
            className={cn(
                "group relative overflow-hidden cursor-pointer transition-all duration-base ease-out-soft hover:shadow-md hover:border-primary/20 h-full",
                // Vibrant: card stays white unless the caller passes the
                // primary-50 wash + top-rail via className (tenant grammar)
                // Play Mode Styles — the Dashboard's quiet card-sm chrome
                // (12px radius, hairline border, near-flat shadow). These
                // !important utilities are the single source of truth for
                // stat-card border/radius/shadow; play-theme.css's
                // .stat-card-* rules only contribute the pastel background.
                "[.ui-play_&]:!rounded-play-card-sm [.ui-play_&]:!border [.ui-play_&]:!border-border [.ui-play_&]:!shadow-play-soft-card",
                "[.ui-play_&]:hover:-translate-y-1 [.ui-play_&]:active:translate-y-0.5 [.ui-play_&]:active:!shadow-none",
                className
            )}
            tabIndex={0}
            role="button"
            aria-label={cardAriaLabel}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
        >
            {/* Play mode: pastel-tint card, felted icon top-left + chevron, ink text below */}
            {isPlay ? (
                <div
                    className={cn(
                        "flex h-full p-3 sm:p-4",
                        isRow
                            ? "flex-row items-center gap-3 sm:gap-4"
                            : "flex-col justify-between"
                    )}
                >
                    <div
                        className={cn(
                            "flex items-center",
                            isRow ? "shrink-0" : "mb-3 justify-between"
                        )}
                    >
                        {cleanerIllustrationSrc ? (
                            <img
                                src={cleanerIllustrationSrc}
                                alt=""
                                aria-hidden="true"
                                className="h-11 w-11 object-contain"
                            />
                        ) : (
                            <div className={cn("p-2 rounded-md transition-colors", iconClassName)}>
                                <Icon size={20} weight="fill" className="w-5 h-5 sm:w-6 sm:h-6" />
                            </div>
                        )}
                        {!isRow && (
                            <CaretRight
                                size={16}
                                className="text-play-ink/50 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-play-ink"
                            />
                        )}
                    </div>
                    <div className={cn("space-y-1", isRow && "min-w-0 flex-1")}>
                        {showAction ? (
                            <div className="inline-flex items-center gap-1 text-xl font-black tracking-tight text-play-ink sm:text-2xl">
                                {t("statCard.getStarted")}
                                <ArrowRight size={16} weight="bold" />
                            </div>
                        ) : (
                            <div className="text-2xl font-black tracking-tight text-play-ink tabular-nums sm:text-3xl">
                                {(count ?? 0).toLocaleString()}
                            </div>
                        )}
                        <div className="text-caption font-bold uppercase tracking-wide text-play-ink/70">
                            {subtitleText}
                        </div>
                    </div>
                    {isRow && (
                        <CaretRight
                            size={16}
                            className="shrink-0 text-play-ink/50 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-play-ink"
                        />
                    )}
                </div>
            ) : (
                /* Default / Vibrant layout */
                <>
                    <CardContent className={cn(
                        "p-3 sm:p-4 flex h-full relative z-10",
                        isRow
                            ? "flex-row items-center gap-3 sm:gap-4"
                            : "flex-col justify-between"
                    )}>
                        <div className={cn(
                            "flex items-center",
                            isRow ? "shrink-0" : "justify-between mb-3"
                        )}>
                            <div className={cn(
                                "p-2 bg-primary/10 rounded-md text-primary ring-1 ring-primary/20 transition-colors group-hover:bg-primary/20",
                                "[.ui-vibrant_&]:ring-0",
                                iconClassName
                            )}>
                                <Icon size={20} weight="duotone" className="w-5 h-5 sm:w-6 sm:h-6" />
                            </div>
                            {!isRow && (
                                <CaretRight size={16}
                                    className="text-muted-foreground group-hover:text-primary transition-all duration-300 group-hover:translate-x-0.5"
                                />
                            )}
                        </div>
                        <div className={cn("space-y-1", isRow && "min-w-0 flex-1")}>
                            {showAction ? (
                                // Empty: a "Get started" invitation, never a dead "0".
                                <div className="inline-flex items-center gap-1 text-lg sm:text-xl font-bold tracking-tight text-primary">
                                    {t("statCard.getStarted")}
                                    <ArrowRight
                                        size={16}
                                        weight="bold"
                                        className="transition-transform duration-300 group-hover:translate-x-0.5"
                                    />
                                </div>
                            ) : (
                                <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                                    {(count ?? 0).toLocaleString()}
                                </div>
                            )}
                            <div className={cn(
                                "text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors line-clamp-1",
                                "[.ui-vibrant_&]:text-primary/70 [.ui-vibrant_&]:group-hover:text-primary",
                                showAction && "text-muted-foreground font-medium"
                            )}>
                                {subtitleText}
                            </div>
                        </div>
                        {isRow && (
                            <CaretRight size={16}
                                className="shrink-0 text-muted-foreground group-hover:text-primary transition-all duration-300 group-hover:translate-x-0.5"
                            />
                        )}
                    </CardContent>
                    {/* Vibrant Decorator */}
                    <div className="absolute -bottom-6 -end-6 w-24 h-24 bg-primary/5 rounded-full blur-2xl hidden [.ui-vibrant_&]:block group-hover:scale-150 transition-transform duration-500 pointer-events-none" />
                </>
            )}
        </Card>
    );
};
