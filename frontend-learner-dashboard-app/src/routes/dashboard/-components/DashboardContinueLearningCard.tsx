import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    DashbaordResponse,
    DashboardSlide,
} from "../-types/dashboard-data-types";
import {
    getTerminology,
    getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { Play, Target, BookOpen, CaretRight, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import iconContinue from "@/assets/cleaner-play/icon-continue.webp";
import emptyLearningIllustration from "@/assets/cleaner-play/empty-learning.webp";

// Skeleton mirroring the card layout to avoid layout shift while loading
const ContinueLearningCardSkeleton = () => (
    <Card
        className={cn(
            "h-full",
            "cp-card",
            "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-border [.ui-play_&]:bg-play-navy-soft/50 [.ui-play_&]:shadow-play-soft-card"
        )}
    >
        <CardHeader className="pb-3 px-4 sm:px-6 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-md" />
                <div className="space-y-1.5">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-3 w-24" />
                </div>
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
        </CardHeader>
        <CardContent className="pt-0 px-4 sm:px-6 space-y-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-md" />
        </CardContent>
    </Card>
);

// Enhanced Continue Learning Card
export const ContinueLearningCard = ({
    data,
    onResumeClick,
    isLoading = false,
    hasAnyProgress = false,
}: {
    data: DashbaordResponse | null;
    onResumeClick: (slide: DashboardSlide) => void;
    isLoading?: boolean;
    /** Whether the learner has made any progress at all — splits the empty
     *  state into first-run ("start your first lesson") vs genuinely done. */
    hasAnyProgress?: boolean;
}) => {
    const { t } = useTranslation("dashboard");
    const navigate = useNavigate();
    const isPlay = usePlayTheme();
    const isCleanerPlay = useCleanerPlayTheme();
    // Institutes rename Slide (e.g. "Lesson"/"Topic") — keep the empty-state
    // copy in the same vocabulary as the "N slides in progress" counter.
    const slideTerm = getTerminology(ContentTerms.Slides, SystemTerms.Slides).toLocaleLowerCase();
    const coursesPluralTerm = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
    const slidesPluralTerm = getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides);

    if (isLoading) {
        return <ContinueLearningCardSkeleton />;
    }

    if (!data?.slides || data.slides.length === 0) {
        const isFirstRun = !hasAnyProgress;

        if (isCleanerPlay) {
            return (
                <div className="cp-card flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
                    <img
                        src={emptyLearningIllustration}
                        alt=""
                        aria-hidden="true"
                        className="h-32 w-auto sm:h-36"
                    />
                    <div className="space-y-1">
                        <h3 className="cp-heading text-h3">
                            {isFirstRun ? t("continueLearning.startLearningTitle") : t("continueLearning.allCaughtUpTitle")}
                        </h3>
                        <p className="cp-muted mx-auto max-w-xs text-body">
                            {isFirstRun
                                ? t("continueLearning.browsePrompt", {
                                      courses: coursesPluralTerm,
                                      slide: slideTerm,
                                  })
                                : t("continueLearning.allCompletePrompt", {
                                      slides: slidesPluralTerm,
                                  })}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate({ to: "/study-library/courses" })}
                        className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-body font-semibold text-primary-foreground shadow-sm transition-transform active:translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                    >
                        {isFirstRun ? (
                            <Play weight="fill" size={16} />
                        ) : (
                            <BookOpen weight="fill" size={16} />
                        )}
                        {isFirstRun ? t("continueLearning.startFirstSlideButton", { slide: slideTerm }) : t("continueLearning.exploreContentButton")}
                    </button>
                </div>
            );
        }

        if (isPlay) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-4 rounded-play-card-sm border border-border bg-play-success-soft p-6 text-center shadow-play-soft-card">
                    <img
                        src={emptyLearningIllustration}
                        alt=""
                        aria-hidden="true"
                        className="h-32 w-auto sm:h-36"
                    />
                    <div className="space-y-1">
                        <h3 className="text-h3 font-black text-play-success-soft-ink">
                            {isFirstRun ? t("continueLearning.startLearningTitle") : t("continueLearning.allCaughtUpTitle")}
                        </h3>
                        <p className="mx-auto max-w-xs text-body font-medium text-play-ink/70">
                            {isFirstRun
                                ? t("continueLearning.browsePrompt", {
                                      courses: coursesPluralTerm,
                                      slide: slideTerm,
                                  })
                                : t("continueLearning.allCompletePrompt", {
                                      slides: slidesPluralTerm,
                                  })}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate({ to: "/study-library/courses" })}
                        className="inline-flex items-center gap-2 rounded-play-btn bg-play-success px-6 py-3 text-body font-black uppercase tracking-wide text-white shadow-play-2d-success transition-transform active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-ink/30"
                    >
                        {isFirstRun ? (
                            <Play weight="fill" size={16} />
                        ) : (
                            <BookOpen weight="fill" size={16} />
                        )}
                        {isFirstRun ? t("continueLearning.startFirstSlideButton", { slide: slideTerm }) : t("continueLearning.exploreContentButton")}
                    </button>
                </div>
            );
        }

        return (
            <Card className="continue-learning-card-empty h-full border-dashed bg-muted/40 shadow-none hover:shadow-none transition-none">
                <CardContent className="p-card-lg text-center flex flex-col items-center justify-center h-full space-y-4 relative overflow-hidden">
                    <div className="p-3 bg-primary/10 rounded-full text-primary ring-1 ring-primary/20">
                        {isFirstRun ? (
                            <BookOpen weight="duotone" size={24} />
                        ) : (
                            <Target weight="duotone" size={24} />
                        )}
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-semibold tracking-tight">
                            {isFirstRun ? t("continueLearning.startLearningTitle") : t("continueLearning.allCaughtUpTitle")}
                        </h3>
                        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                            {isFirstRun
                                ? t("continueLearning.browsePrompt", {
                                      courses: coursesPluralTerm,
                                      slide: slideTerm,
                                  })
                                : t("continueLearning.allCompletePrompt", {
                                      slides: slidesPluralTerm,
                                  })}
                        </p>
                    </div>
                    <Button
                        onClick={() => navigate({ to: "/study-library/courses" })}
                        variant="outline"
                        className="gap-2"
                    >
                        {isFirstRun ? (
                            <Play weight="fill" size={16} />
                        ) : (
                            <BookOpen weight="fill" size={16} />
                        )}
                        {isFirstRun ? t("continueLearning.startFirstSlideButton", { slide: slideTerm }) : t("continueLearning.exploreContentButton")}
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (isCleanerPlay) {
        return (
            <div className="cp-card flex h-full flex-col gap-4 p-4 sm:p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <img
                            src={iconContinue}
                            alt=""
                            aria-hidden="true"
                            className="h-11 w-11 object-contain"
                        />
                        <div>
                            <p className="cp-heading text-body">{t("continueLearning.title")}</p>
                            <p className="cp-muted text-caption">
                                {t("continueLearning.slidesInProgress", {
                                    count: data.slides.length,
                                    slide: (data.slides.length === 1
                                        ? getTerminology(ContentTerms.Slides, SystemTerms.Slides)
                                        : getTerminologyPlural(
                                              ContentTerms.Slides,
                                              SystemTerms.Slides
                                          )
                                    ).toLocaleLowerCase(),
                                })}
                            </p>
                        </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-cp-terracotta-tint px-2.5 py-1 text-caption font-semibold text-cp-terracotta">
                        <Sparkle size={10} weight="fill" /> {t("membership.statusActive")}
                    </span>
                </div>

                <div className="flex-1 space-y-2">
                    {data.slides.slice(0, 3).map((slide, index) => (
                        <button
                            type="button"
                            key={slide.slide_id}
                            onClick={() => onResumeClick(slide)}
                            className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-cp-border p-2.5 text-start transition-colors hover:bg-cp-bg-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                            <span
                                className={cn(
                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                                    index === 0
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-cp-bg-deep text-cp-muted"
                                )}
                            >
                                {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <h4 className="cp-heading truncate text-caption font-semibold">
                                    {slide.slide_title}
                                </h4>
                                <p className="cp-muted truncate text-3xs">
                                    {slide.slide_description || t("continueLearning.continueFromWhereLeftOff")}
                                </p>
                            </div>
                            <CaretRight size={14} weight="bold" className="cp-muted shrink-0" />
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => data.slides[0] && onResumeClick(data.slides[0])}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-body font-semibold text-primary-foreground shadow-sm transition-transform active:translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                >
                    <Play weight="fill" size={16} />
                    {t("continueLearning.resumeLearningButton")}
                </button>
            </div>
        );
    }

    if (isPlay) {
        return (
            <div className="flex h-full flex-col gap-4 rounded-play-card-sm border border-border bg-play-navy-soft p-4 shadow-play-soft-card sm:p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <img
                            src={iconContinue}
                            alt=""
                            aria-hidden="true"
                            className="h-11 w-11 object-contain"
                        />
                        <div>
                            <p className="text-body font-black text-play-navy-soft-ink">{t("continueLearning.title")}</p>
                            <p className="text-caption font-bold text-play-ink/60">
                                {t("continueLearning.slidesInProgress", {
                                    count: data.slides.length,
                                    slide: (data.slides.length === 1
                                        ? getTerminology(ContentTerms.Slides, SystemTerms.Slides)
                                        : getTerminologyPlural(
                                              ContentTerms.Slides,
                                              SystemTerms.Slides
                                          )
                                    ).toLocaleLowerCase(),
                                })}
                            </p>
                        </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-caption font-black uppercase tracking-wide text-play-navy-soft-ink shadow-play-soft-card">
                        <Sparkle size={10} weight="fill" /> {t("membership.statusActive")}
                    </span>
                </div>

                <div className="flex-1 space-y-2">
                    {data.slides.slice(0, 3).map((slide, index) => (
                        <button
                            type="button"
                            key={slide.slide_id}
                            onClick={() => onResumeClick(slide)}
                            className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-white/60 p-2.5 text-start transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-play-ink/30"
                        >
                            <span
                                className={cn(
                                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-black",
                                    index === 0
                                        ? "bg-play-navy text-white"
                                        : "bg-white text-play-ink/60"
                                )}
                            >
                                {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <h4 className="truncate text-caption font-bold text-play-ink">
                                    {slide.slide_title}
                                </h4>
                                <p className="truncate text-3xs text-play-ink/60">
                                    {slide.slide_description || t("continueLearning.continueFromWhereLeftOff")}
                                </p>
                            </div>
                            <CaretRight size={14} weight="bold" className="shrink-0 text-play-ink/50" />
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => data.slides[0] && onResumeClick(data.slides[0])}
                    className="flex w-full items-center justify-center gap-2 rounded-play-btn bg-play-navy py-3 text-body font-black uppercase tracking-wide text-white shadow-play-2d-navy transition-transform active:translate-y-0.5 active:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-play-ink/30"
                >
                    <Play weight="fill" size={16} />
                    {t("continueLearning.resumeLearningButton")}
                </button>
            </div>
        );
    }

    return (
        <Card className={cn(
            "continue-learning-card h-full flex flex-col shadow-sm hover:shadow-md transition-all duration-300 group relative overflow-hidden",
            // Vibrant: tenant-primary wash + top rail (no fixed hues)
            "[.ui-vibrant_&]:bg-primary-50 [.ui-vibrant_&]:border-primary-100",
            "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300"
        )}>
            <div>
            <CardHeader className="pb-3 px-4 sm:px-6 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center space-x-3">
                    <div className={cn(
                        "p-2 bg-primary/10 rounded-md text-primary",
                        "[.ui-vibrant_&]:bg-primary-100 [.ui-vibrant_&]:text-primary-500"
                    )}>
                        <Play weight="duotone" size={20} />
                    </div>
                    <div>
                        <CardTitle className="text-lg font-bold">
                            {t("continueLearning.title")}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {t("continueLearning.slidesInProgress", {
                                count: data.slides.length,
                                slide: (data.slides.length === 1
                                    ? getTerminology(ContentTerms.Slides, SystemTerms.Slides)
                                    : getTerminologyPlural(
                                          ContentTerms.Slides,
                                          SystemTerms.Slides
                                      )
                                ).toLocaleLowerCase(),
                            })}
                        </p>
                    </div>
                </div>
                <Badge variant="secondary" className={cn(
                    "bg-primary/10 text-primary border-primary/20 gap-1",
                    "[.ui-vibrant_&]:bg-white/50 [.ui-vibrant_&]:border-primary/30"
                )}>
                    <Sparkle size={10} weight="fill" /> {t("membership.statusActive")}
                </Badge>
            </CardHeader>

            <CardContent className="pt-0 px-4 sm:px-6 flex-1 flex flex-col gap-4">
                <div className="space-y-2 flex-1">
                    {data.slides.slice(0, 3).map((slide, index) => (
                        <button
                            type="button"
                            key={slide.slide_id}
                            onClick={() => onResumeClick(slide)}
                            className={cn(
                                "group/item flex w-full items-center gap-3 p-2.5 rounded-lg text-start hover:bg-muted/80 transition-colors cursor-pointer border border-transparent hover:border-border",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                "[.ui-vibrant_&]:hover:bg-white/60 [.ui-vibrant_&]:hover:border-primary/20"
                            )}
                        >
                            <div className="flex-shrink-0">
                                <span className={cn(
                                    "flex items-center justify-center w-6 h-6 rounded-md text-xs font-medium",
                                    index === 0
                                        ? "bg-primary text-primary-foreground shadow-sm [.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-primary [.ui-vibrant_&]:to-primary/80"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    {index + 1}
                                </span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm truncate group-hover/item:text-primary transition-colors">
                                    {slide.slide_title}
                                </h4>
                                <p className="text-xs text-muted-foreground truncate">
                                    {slide.slide_description || t("continueLearning.continueFromWhereLeftOff")}
                                </p>
                            </div>
                            <CaretRight size={14} weight="bold" className="text-muted-foreground group-hover/item:text-primary transition-colors" />
                        </button>
                    ))}
                </div>

                <Button
                    onClick={() => data.slides[0] && onResumeClick(data.slides[0])}
                    className={cn(
                        "w-full gap-2 font-semibold",
                        "[.ui-vibrant_&]:bg-gradient-to-r [.ui-vibrant_&]:from-primary [.ui-vibrant_&]:to-primary/90 [.ui-vibrant_&]:shadow-lg [.ui-vibrant_&]:shadow-primary/20"
                    )}
                >
                    <Play weight="fill" size={16} />
                    {t("continueLearning.resumeLearningButton")}
                </Button>
            </CardContent>
            </div>
        </Card>
    );
};
