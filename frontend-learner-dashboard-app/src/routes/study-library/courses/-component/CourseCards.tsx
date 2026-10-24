import React, { useEffect, useMemo, useState } from "react";
import { CaretRight, BookOpen, CheckCircle, Clock, Play } from "@phosphor-icons/react";
import { IconRocket, IconMoodSmile, IconAdjustments } from "@tabler/icons-react";
import BoringAvatar from "boring-avatars";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import LocalStorageUtils from "@/utils/localstorage";
import { Star } from "@phosphor-icons/react";
import {
    getResumeForCourse,
    resumeSearchParams,
    RESUME_ROUTE,
} from "@/services/resume-thread";
import { ProgressBar } from "@/components/ui/custom-progress-bar";
import { ProgressRing } from "@/routes/dashboard/-components/play/ProgressRing";
import { cn, toTitleCase } from "@/lib/utils";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils.ts";
import { ContentTerms, RoleTerms, SystemTerms } from "@/types/naming-settings";
import { Card, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMinutesHuman } from "@/utils/courseTime";
import { authorRole, sharedAuthorRole } from "@/lib/course-author-role";

// Avatar gradient ramp passed to boring-avatars (illustration palette, not theme tokens).
const INSTRUCTOR_AVATAR_RAMP = ["#FFE5CC", "#FFCDA8", "#FFA85C", "#E8751A", "#C45A00"]; // design-lint-ignore: illustration ramp

interface Instructor {
    id: string;
    full_name: string;
    image_url?: string;
    author_subtitle?: string;
    author_description?: string;
    /** Display role in this course (Author / Instructor / Acharya …). */
    role_label?: string | null;
}

interface CourseCardProps {
    courseId: string;
    packageSessionId?: string;
    package_name: string;
    level_name: string;

    instructors: Instructor[];
    rating: number;
    description: string;
    percentageCompleted: number;
    tags: string[];
    studentCount?: number;
    previewImageUrl: string;
    selectedTab: string;
    readTimeInMinutes: number;
    /** When true, hide the instructor/teacher name block on the card. */
    hideInstructorName?: boolean;
}

const fallbackInstructorImage =
    "https://api.dicebear.com/7.x/thumbs/svg?seed=anon";

const CourseCard: React.FC<CourseCardProps> = ({
    courseId,
    packageSessionId,
    package_name,
    level_name,
    instructors,
    rating,
    description,
    percentageCompleted,
    tags,
    previewImageUrl,
    selectedTab,
    readTimeInMinutes,
    hideInstructorName = false,
}) => {
    const { t } = useTranslation("study");
    const [courseImageUrl, setCourseImageUrl] = useState<string | null>(null);
    const [loadingImage, setLoadingImage] = useState(true);
    const [imageAspectRatio, setImageAspectRatio] = useState<number>(16 / 9);
    const router = useRouter();

    const instructor = instructors[0];
    const instructorName =
        instructor?.full_name ||
        t("card.unknownInstructor", {
            instructor: getTerminology(RoleTerms.Teacher, SystemTerms.Teacher),
        });
    const instructorImage = instructor?.image_url || fallbackInstructorImage;

    const ratingValue = rating || 0;
    const cappedPercentageCompleted = Math.min(percentageCompleted, 100);
    const isCompleted = cappedPercentageCompleted === 100;
    const isInProgress = cappedPercentageCompleted > 0 && !isCompleted;
    // PROGRESS/COMPLETED tabs only list enrolled courses; any recorded
    // progress implies enrollment too (the ALL tab mixes both).
    const isEnrolled =
        selectedTab === "PROGRESS" ||
        selectedTab === "COMPLETED" ||
        cappedPercentageCompleted > 0;
    // Resume thread: where the learner left off in this course (per-device).
    const resume = useMemo(() => getResumeForCourse(courseId), [courseId]);

    const LevelIcon = useMemo(() => {
        const lvl = (level_name || "").toLowerCase();
        if (lvl === "beginner") return IconMoodSmile;
        if (lvl === "intermediate") return IconAdjustments;
        if (lvl === "advanced") return IconRocket;
        return IconMoodSmile;
    }, [level_name]);

    const handleViewCoureseDetails = (id: string) => {
        try {
            // Persist percentage locally as a fallback for details page
            const key = `COURSE_PCT_${id}`;
            LocalStorageUtils.set(key, {
                value: cappedPercentageCompleted,
                ts: Date.now(),
            });
        } catch {
            // Failed to save percentage to localStorage
        }
        router.navigate({
            to: "/study-library/courses/course-details",
            search: {
                courseId: id,
                packageSessionId: packageSessionId,
                selectedTab: selectedTab,
                percentageCompleted: cappedPercentageCompleted,
            },
        });
    };

    // Continue resumes straight into the last-visited slide when the resume
    // thread has an entry; everything else goes through course details.
    const handleCtaClick = () => {
        if (isInProgress && resume) {
            router.navigate({
                to: RESUME_ROUTE,
                search: resumeSearchParams(resume) as {
                    courseId: string;
                    levelId?: string;
                    subjectId: string;
                    moduleId: string;
                    chapterId: string;
                    slideId: string;
                    sessionId: string;
                },
            });
            return;
        }
        handleViewCoureseDetails(courseId);
    };

    const ctaLabel = isCompleted
        ? t("card.cta.review")
        : isInProgress
          ? t("card.cta.continue")
          : isEnrolled
            ? t("card.cta.startLearning")
            : t("card.cta.view", {
                  course: getTerminology(ContentTerms.Course, SystemTerms.Course),
              });

    const CtaIcon = isCompleted ? CheckCircle : isInProgress ? Play : BookOpen;

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!previewImageUrl) {
                if (isMounted) {
                    setLoadingImage(false);
                    setCourseImageUrl((prev) => (prev === null ? prev : null));
                }
                return;
            }

            setLoadingImage(true);
            try {
                const url = await getPublicUrlWithoutLogin(previewImageUrl);
                if (isMounted) {
                    const next = url || null;
                    setCourseImageUrl((prev) => (prev === next ? prev : next));
                }
            } catch {
                if (isMounted) {
                    setCourseImageUrl((prev) => (prev === null ? prev : null));
                }
            } finally {
                if (isMounted) {
                    setLoadingImage(false);
                }
            }
        };

        load();
        return () => {
            isMounted = false;
        };
    }, [previewImageUrl]);

    const getLevelBadgeVariant = (): "secondary" | "default" | "destructive" | "outline" => {
        // ... (keep existing switch)
        switch (level_name.toLowerCase()) {
            case "beginner":
                return "secondary";
            case "intermediate":
                return "default";
            case "advanced":
                return "destructive";
            default:
                return "outline";
        }
    };

    const getLevelCustomClass = () => {
        // ... (keep existing switch)
        switch (level_name.toLowerCase()) {
            case "beginner":
                return "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-transparent dark:bg-emerald-900/30 dark:text-emerald-300";
            case "intermediate":
                return "bg-amber-100 text-amber-700 hover:bg-amber-200 border-transparent dark:bg-amber900/30 dark:text-amber-300";
            case "advanced":
                return "bg-rose-100 text-rose-700 hover:bg-rose-200 border-transparent dark:bg-rose-900/30 dark:text-rose-300";
            default:
                return "bg-primary-100 text-primary-700 hover:bg-primary-200 border-transparent dark:bg-primary/20 dark:text-primary";
        }
    };

    const levelLower = (level_name || "").trim().toLowerCase();
    const isDefaultLevel = levelLower === "default" || levelLower.includes("default");

    return (
        <Card className={cn(
            "group relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-md flex flex-col w-full max-w-full animate-fade-in-up border-border/60 bg-card/50 hover:bg-card",
            // Vibrant — white card with a top-rail: tenant primary by default,
            // semantic success once the course is completed (status only)
            "[.ui-vibrant_&]:border-t-4",
            isCompleted
                ? "[.ui-vibrant_&]:border-t-success-400"
                : "[.ui-vibrant_&]:border-t-primary-300",

            // Play Styles
            "[.ui-play_&]:rounded-2xl",
            "[.ui-play_&]:hover:-translate-y-1",
            "[.ui-play_&]:transition-all [.ui-play_&]:duration-200"
        )}>
            {/* Background gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg pointer-events-none"></div>

            {/* Image Container — matches the image's natural aspect ratio so the card doesn't letterbox */}
            <div
                className={cn(
                    "relative w-full bg-muted flex items-center justify-center overflow-hidden rounded-t-lg border-b",
                    "[.ui-vibrant_&]:bg-primary-50",
                    "[.ui-play_&]:rounded-t-2xl"
                )}
                // Dynamic: matches the loaded image's natural aspect ratio
                style={{ aspectRatio: courseImageUrl ? imageAspectRatio : 16 / 9 }}
            >
                {loadingImage ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted">
                        <div className="flex flex-col items-center space-y-3">
                            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    </div>
                ) : courseImageUrl ? (
                    <img
                        src={courseImageUrl}
                        alt={package_name}
                        loading="lazy"
                        onLoad={(e) => {
                            const img = e.currentTarget;
                            if (img.naturalWidth && img.naturalHeight) {
                                setImageAspectRatio(img.naturalWidth / img.naturalHeight);
                            }
                        }}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
                        <BookOpen
                            size={40}
                            className="text-primary/60 transition-transform duration-500 group-hover:scale-110"
                        />
                        <span className="text-xs font-medium text-primary/70 px-3 text-center line-clamp-1">
                            {package_name}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex flex-col flex-grow p-4 lg:p-5 gap-stack">
                {/* Header: the level badge on its own line above the title, so a
                    long level name never squeezes the course name into a narrow
                    column and cuts it off. */}
                <div className="flex flex-col items-start gap-2">
                    <Badge
                        variant={getLevelBadgeVariant()}
                        className={cn(
                            "flex-shrink-0 gap-1 px-2.5 py-0.5",
                            getLevelCustomClass(),
                            // Default level logic: hidden by default, shown in vibrant/play mode
                            isDefaultLevel && "hidden [.ui-vibrant_&]:inline-flex [.ui-play_&]:inline-flex",
                            // Vibrant mode override for alignment/style if needed
                            "[.ui-vibrant_&]:shadow-sm",
                            // Play mode: pill badge
                            "[.ui-play_&]:rounded-full [.ui-play_&]:shadow-sm [.ui-play_&]:font-bold"
                        )}
                    >
                        <LevelIcon size={12} className="text-current hidden [.ui-vibrant_&]:block" />
                        {!isDefaultLevel && toTitleCase(level_name)}
                    </Badge>

                    <h3
                        className="text-lg font-bold leading-tight group-hover:text-primary transition-colors duration-200 line-clamp-3 break-words"
                        title={package_name}
                    >
                        {package_name}
                    </h3>
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed flex-grow">
                    {(description || "")
                        .replace(/<[^>]*>/g, " ")
                        .replace(/\s+/g, " ")
                        .trim()}
                </p>

                {/* Instructor */}
                {!hideInstructorName && instructors.length > 0 && (
                    <div className={cn(
                        "flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors duration-200 -mx-2",
                        // Vibrant — primary-50 wash on hover (the one tint family)
                        "[.ui-vibrant_&]:hover:bg-primary-50 dark:[.ui-vibrant_&]:hover:bg-primary-500/10"
                    )}>
                        <div className="relative flex-shrink-0">
                            {instructor?.image_url ? (
                                <img
                                    src={instructorImage}
                                    alt={instructorName}
                                    className="w-8 h-8 rounded-full object-cover ring-2 ring-background"
                                />
                            ) : (
                                <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-background bg-background">
                                    <BoringAvatar
                                        size={32}
                                        name={instructorName}
                                        variant="beam"
                                        colors={INSTRUCTOR_AVATAR_RAMP}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-caption text-muted-foreground font-medium">
                                {sharedAuthorRole(
                                    instructors.map(authorRole),
                                    toTitleCase(getTerminology(RoleTerms.Teacher, SystemTerms.Teacher))
                                )}
                            </p>
                            <div className="text-sm font-medium truncate">
                                {instructors.map((instructor, index) => (
                                    <span key={instructor.id}>
                                        {instructor.full_name}
                                        {index !== instructors.length - 1 ? ", " : ""}
                                    </span>
                                ))}
                            </div>
                            {instructor?.author_subtitle && (
                                <p className="text-xs text-muted-foreground truncate">
                                    {instructor.author_subtitle}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Tags */}
                <div className="min-h-6">
                    {tags && tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {tags.slice(0, 3).map((tag) => (
                                <Badge
                                    key={tag}
                                    variant="secondary"
                                    className="font-normal text-xs bg-tertiary-100 text-tertiary-500 hover:bg-tertiary-200"
                                >
                                    {tag}
                                </Badge>
                            ))}
                            {tags.length > 3 && (
                                <span className="text-xs text-muted-foreground ps-1">
                                    {t("card.tagsMore", { count: tags.length - 3 })}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-2 py-2 border-t border-border/50 mt-1">
                    {/* Rating is hidden until the course actually has reviews;
                        an empty cell keeps the grid alignment intact. */}
                    <div className="flex items-center gap-1.5">
                        {ratingValue > 0 && (
                            <>
                                <Star size={14} weight="fill" className="text-yellow-400" />
                                <span className="text-sm font-semibold">{ratingValue.toFixed(1)}</span>
                            </>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
                        {readTimeInMinutes > 0 && (
                            <div className="flex items-center gap-1">
                                <Clock size={14} />
                                <span>{formatMinutesHuman(readTimeInMinutes)}</span>
                            </div>
                        )}
                    </div>
                </div>

                {(isInProgress || isCompleted || selectedTab === "PROGRESS") && (
                    <div className="space-y-1.5 pt-1">
                        {cappedPercentageCompleted === 0 ? (
                            <Badge
                                variant="outline"
                                className="w-fit gap-1 border-dashed border-neutral-300 text-neutral-500 font-medium text-caption px-2 py-0.5"
                            >
                                <Clock size={12} />
                                {t("card.status.notStarted")}
                            </Badge>
                        ) : isCompleted ? (
                            <div className="flex items-center gap-1.5">
                                <CheckCircle
                                    size={16}
                                    weight="fill"
                                    className="text-success-600 [.ui-play_&]:text-play-success"
                                />
                                <span className="text-caption font-medium text-muted-foreground">
                                    {t("card.status.percentComplete", { percent: 100 })}
                                </span>
                            </div>
                        ) : (
                            <>
                                {/* Default / Vibrant: slim linear progress bar */}
                                <div className="space-y-1 [.ui-play_&]:hidden">
                                    <div className="text-caption font-medium text-muted-foreground">
                                        {t("card.status.percentComplete", {
                                            percent: cappedPercentageCompleted.toFixed(0),
                                        })}
                                    </div>
                                    <ProgressBar value={cappedPercentageCompleted} className="h-1.5" />
                                </div>
                                {/* Play: circular progress ring */}
                                <div className="hidden [.ui-play_&]:flex items-center gap-3">
                                    <ProgressRing value={cappedPercentageCompleted} size={44} strokeWidth={4} />
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold">
                                            {t("card.status.percentComplete", {
                                                percent: cappedPercentageCompleted.toFixed(0),
                                            })}
                                        </span>
                                        <span className="text-caption text-muted-foreground">{t("card.status.keepGoing")}</span>
                                    </div>
                                </div>
                                {resume?.slideTitle && (
                                    <p
                                        className="truncate text-caption text-muted-foreground"
                                        title={resume.slideTitle}
                                    >
                                        {t("card.nextSlide", { title: resume.slideTitle })}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            <CardFooter className="p-card pt-0 mt-auto flex flex-col gap-2">
                <Button
                    className={cn(
                        "w-full font-semibold shadow-sm group/btn",
                        // Vibrant: tenant primary tokens only (default Button styling)
                        "[.ui-vibrant_&]:shadow-md",
                        // Play mode: rounded, 3D press effect
                        "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold",
                        "[.ui-play_&]:shadow-play-4-primary",
                        "[.ui-play_&]:hover:shadow-play-6-primary [.ui-play_&]:hover:-translate-y-0.5",
                        "[.ui-play_&]:active:shadow-play-1-primary [.ui-play_&]:active:translate-y-0.5"
                    )}
                    onClick={handleCtaClick}
                >
                    <CtaIcon
                        size={16}
                        weight={isCompleted || isInProgress ? "fill" : "regular"}
                        className="me-2 transition-transform duration-300 group-hover/btn:scale-110"
                    />
                    <span>{ctaLabel}</span>
                    <CaretRight
                        size={16}
                        className="ms-1 transition-transform duration-300 group-hover/btn:translate-x-1"
                    />
                </Button>
                {/* Continue resumes straight into the viewer, so give learners
                    a second door into the course overview (browse new parts). */}
                {isInProgress && resume && (
                    <Button
                        variant="outline"
                        className={cn(
                            "w-full font-semibold",
                            "[.ui-play_&]:rounded-xl [.ui-play_&]:font-bold [.ui-play_&]:border-2 [.ui-play_&]:border-play-surface [.ui-play_&]:text-play-ink",
                            "[.ui-play_&]:active:translate-y-0.5"
                        )}
                        onClick={() => handleViewCoureseDetails(courseId)}
                        aria-label={t("card.overviewAriaLabel", {
                            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                        })}
                    >
                        <BookOpen size={16} className="me-1.5" />
                        {t("card.overview")}
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
};

export default CourseCard;
