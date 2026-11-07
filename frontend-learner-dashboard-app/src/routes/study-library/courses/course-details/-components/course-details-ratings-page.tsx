import {
    Star,
    ChatCircle,
    TrendUp,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef, useCallback } from "react";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { MyPagination } from "@/components/design-system/pagination";
import { AxiosError } from "axios";
import { toast } from "sonner";
import {
    useMutation,
    useQueryClient,
    useSuspenseQuery,
} from "@tanstack/react-query";
import {
    handleGetOverAllRatingDetails,
    handleGetRatingDetails,
    handleUpdateRating,
    handleSubmitRating,
} from "../-services/rating-services";
import { StarRatingComponent } from "@/components/common/star-rating-component";
// import { DashboardLoader } from "@/components/core/dashboard-loader";
import { ProgressBar } from "@/components/ui/custom-progress-bar";
import { useRouter } from "@tanstack/react-router";
import { MyButton } from "@/components/design-system/button";
import { Textarea } from "@/components/ui/textarea";
import { getPublicUrl } from "@/services/upload_file";
import { ReviewItem, type Review } from "@/components/common/review-item";
import { getUserId } from "@/constants/getUserId";


// Types for API Response
interface User {
    id: string;
    username: string;
    email: string;
    full_name: string;
    profile_pic_file_id: string | null;
}

interface Rating {
    id: string;
    points: number;
    likes: number;
    dislikes: number;
    text: string;
    user: User;
    created_at: string;
}

interface PaginatedResponse {
    content: Rating[];
    totalPages: number;
    totalElements: number;
    number: number;
    size: number;
}

// Helper function to transform API data to Review format
const transformRatingToReview = (rating: Rating): Review => {
    return {
        id: rating.id,
        user: {
            id: rating.user.id, // Include user ID for ownership check
            name: rating.user.full_name || rating.user.username,
            avatarUrl: rating.user.profile_pic_file_id || "",
        },
        createdAt: rating.created_at,
        rating: rating.points,
        description: rating.text || "No review text provided",
        likes: rating.likes,
        dislikes: rating.dislikes,
    };
};



export function CourseDetailsRatingsComponent({
    packageSessionId,
    onLoadingChange,
}: {
    packageSessionId: string | null;
    onLoadingChange?: (loading: boolean) => void;
}) {
    const { t } = useTranslation("courseDetailsA");
    const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const router = useRouter();
    const searchParams = router.state.location.search;
    const queryClient = useQueryClient();
    const [page, setPage] = useState(0);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    // Get current user ID on component mount
    useEffect(() => {
        const fetchCurrentUserId = async () => {
            try {
                const userId = await getUserId();
                setCurrentUserId(userId);
            } catch {
                setCurrentUserId(null);
            }
        };

        fetchCurrentUserId();
    }, []);

    const { data: ratingData, isLoading: isRatingLoading } = useSuspenseQuery<PaginatedResponse>(
        handleGetRatingDetails({
            pageNo: page,
            pageSize: 10,
            data: {
                source_id: packageSessionId || "",
                source_type: "PACKAGE_SESSION",
            },
        })
    );

    const { data: overallRatingData, isLoading: isOverallRatingLoading } = useSuspenseQuery(
        handleGetOverAllRatingDetails({
            source_id: packageSessionId || "",
        })
    );

    // Memoized callback for loading state changes
    const handleLoadingChange = useCallback((loading: boolean) => {
        if (onLoadingChange) {
            onLoadingChange(loading);
        }
    }, [onLoadingChange]);

    // Update loading state for parent component
    useEffect(() => {
        const isAnyLoading = isRatingLoading || isOverallRatingLoading;
        handleLoadingChange(isAnyLoading);
    }, [isRatingLoading, isOverallRatingLoading, handleLoadingChange]);

    // Transform API data to reviews format
    const reviews = ratingData?.content.map(transformRatingToReview) || [];
    const totalPages = ratingData?.totalPages || 0;



    // State to store avatar URLs
    const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
    const fetchedUrlsRef = useRef<Set<string>>(new Set());

    // Fetch avatar URLs when reviews change (only for new reviews)
    useEffect(() => {
        const fetchAvatarUrls = async () => {
            // Only fetch URLs for reviews that we haven't fetched before
            const reviewsNeedingUrls = reviews.filter(
                review => review.user.avatarUrl && !fetchedUrlsRef.current.has(review.id)
            );

            if (reviewsNeedingUrls.length === 0) return;

            const urlPromises = reviewsNeedingUrls.map(async (review) => {
                try {
                    const url = await getPublicUrl(review.user.avatarUrl);
                    // Mark this review as fetched
                    fetchedUrlsRef.current.add(review.id);
                    return { reviewId: review.id, url };
                } catch {
                    // Mark this review as fetched even if it failed
                    fetchedUrlsRef.current.add(review.id);
                    return { reviewId: review.id, url: "" };
                }
            });

            const results = await Promise.all(urlPromises);
            const newUrls: Record<string, string> = {};

            results.forEach(({ reviewId, url }) => {
                if (url) {
                    newUrls[reviewId] = url;
                }
            });

            // Merge with existing URLs instead of replacing
            setAvatarUrls(prev => ({ ...prev, ...newUrls }));
        };

        if (reviews.length > 0) {
            fetchAvatarUrls();
        }
    }, [reviews]);

    const [feedbackText, setFeedbackText] = useState("");
    const [selectedRating, setSelectedRating] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const handleUpdateRatingMutation = useMutation({
        mutationFn: async ({
            id,
            rating,
            source_id,
            status,
            likes,
            dislikes,
            text,
        }: {
            id: string;
            rating: number;
            source_id: string;
            status: string;
            likes: number;
            dislikes: number;
            text?: string;
        }) => {
            return handleUpdateRating(
                id,
                rating,
                source_id,
                status,
                likes,
                dislikes,
                text
            );
        },
        onSuccess: () => {
            // No need to invalidate queries since we're using optimistic updates
            // The UI is already updated optimistically
        },
        onError: (error: unknown, variables) => {
            // Revert optimistic updates on error
            queryClient.setQueryData(
                ["GET_ALL_USER_COURSE_RATINGS", page, 10, { source_id: packageSessionId || "", source_type: "PACKAGE_SESSION" }],
                (oldData: PaginatedResponse | undefined) => {
                    if (!oldData) return oldData;

                    // Find the original review to revert changes
                    const originalReview = reviews.find(r => r.id === variables.id);
                    if (!originalReview) return oldData;

                    return {
                        ...oldData,
                        content: oldData.content.map((rating: Rating) =>
                            rating.id === variables.id
                                ? {
                                    ...rating,
                                    likes: originalReview.likes,
                                    dislikes: originalReview.dislikes,
                                    status: "ACTIVE" // Revert status if it was deleted
                                }
                                : rating
                        ),
                        totalElements: oldData.totalElements + (variables.status === "DELETED" ? 1 : 0) // Revert total count if deleted
                    };
                }
            );

            if (error instanceof AxiosError) {
                toast.error(
                    error?.response?.data?.ex || t("ratings.toast.submitFailed"),
                    {
                        className: "error-toast",
                        duration: 2000,
                    }
                );
            } else {
                toast.error(t("ratings.toast.unexpectedError"), {
                    className: "error-toast",
                    duration: 2000,
                });
            }
        },
    });

    const handlePageChange = (pageNo: number) => {
        setPage(pageNo);
    };

    const handleStarClick = (rating: number) => {
        setSelectedRating(rating);
    };

    // Handler functions for ReviewItem with optimistic updates
    const handleLike = (reviewId: string) => {
        const review = reviews.find(r => r.id === reviewId);
        if (review) {
            // Update the query cache optimistically
            queryClient.setQueryData(
                ["GET_ALL_USER_COURSE_RATINGS", page, 10, { source_id: packageSessionId || "", source_type: "PACKAGE_SESSION" }],
                (oldData: PaginatedResponse | undefined) => {
                    if (!oldData) return oldData;
                    return {
                        ...oldData,
                        content: oldData.content.map((rating: Rating) =>
                            rating.id === reviewId
                                ? { ...rating, likes: rating.likes + 1 }
                                : rating
                        )
                    };
                }
            );

            handleUpdateRatingMutation.mutate({
                id: review.id,
                rating: review.rating,
                source_id: packageSessionId || "",
                status: "ACTIVE",
                likes: review.likes + 1,
                dislikes: review.dislikes,
                text: review.description,
            });
        }
    };

    const handleDislike = (reviewId: string) => {
        const review = reviews.find(r => r.id === reviewId);
        if (review) {
            // Update the query cache optimistically
            queryClient.setQueryData(
                ["GET_ALL_USER_COURSE_RATINGS", page, 10, { source_id: packageSessionId || "", source_type: "PACKAGE_SESSION" }],
                (oldData: PaginatedResponse | undefined) => {
                    if (!oldData) return oldData;
                    return {
                        ...oldData,
                        content: oldData.content.map((rating: Rating) =>
                            rating.id === reviewId
                                ? { ...rating, dislikes: rating.dislikes + 1 }
                                : rating
                        )
                    };
                }
            );

            handleUpdateRatingMutation.mutate({
                id: review.id,
                rating: review.rating,
                source_id: packageSessionId || "",
                status: "ACTIVE",
                likes: review.likes,
                dislikes: review.dislikes + 1,
                text: review.description,
            });
        }
    };

    const handleDelete = (reviewId: string) => {
        const review = reviews.find(r => r.id === reviewId);
        if (review) {
            // Update the query cache optimistically
            queryClient.setQueryData(
                ["GET_ALL_USER_COURSE_RATINGS", page, 10, { source_id: packageSessionId || "", source_type: "PACKAGE_SESSION" }],
                (oldData: PaginatedResponse | undefined) => {
                    if (!oldData) return oldData;
                    return {
                        ...oldData,
                        content: oldData.content.filter((rating: Rating) => rating.id !== reviewId),
                        totalElements: oldData.totalElements - 1
                    };
                }
            );

            handleUpdateRatingMutation.mutate({
                id: review.id,
                rating: review.rating,
                source_id: packageSessionId || "",
                status: "DELETED",
                likes: review.likes,
                dislikes: review.dislikes,
                text: review.description,
            });
        }
    };

    const handleSubmitRatingMutation = useMutation({
        mutationFn: async ({
            rating,
            desc,
            source_id,
        }: {
            rating: number;
            desc: string;
            source_id: string;
        }) => {
            return handleSubmitRating(rating, desc, source_id);
        },
        onSuccess: () => {
            toast.success(t("ratings.toast.thankYou"), {
                className: "success-toast",
                duration: 2000,
            });
            // Reset form
            setFeedbackText("");
            setSelectedRating(null);
            setSubmitting(false);
            queryClient.invalidateQueries({
                queryKey: ["GET_ALL_USER_COURSE_RATINGS"],
            });
            queryClient.invalidateQueries({
                queryKey: ["GET_ALL_USER_COURSE_RATINGS_OVERALL"],
            });
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(
                    error?.response?.data?.ex || t("ratings.toast.submitFailed"),
                    {
                        className: "error-toast",
                        duration: 2000,
                    }
                );
            } else {
                toast.error(t("ratings.toast.unexpectedError"), {
                    className: "error-toast",
                    duration: 2000,
                });
            }
            setSubmitting(false);
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchParams.courseId) return;

        // Ensure rating is selected
        if (!selectedRating) {
            toast.error(t("ratings.toast.selectRatingFirst"), {
                className: "error-toast",
                duration: 2000,
            });
            return;
        }

        setSubmitting(true);
        handleSubmitRatingMutation.mutate({
            rating: selectedRating,
            desc: feedbackText.trim(),
            source_id: packageSessionId || "",
        });
    };

    // if (isRatingLoading || !packageSessionId) return <DashboardLoader />;

    return (
        <div className={cn(
            "relative bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-md shadow-sm hover:shadow-md transition-all duration-200 p-3 group overflow-hidden",
            // Vibrant — white card with a tenant top-rail
            "[.ui-vibrant_&]:border-t-4 [.ui-vibrant_&]:border-t-primary-300",
            "[.ui-vibrant_&]:border-primary/20 [.ui-vibrant_&]:shadow-md",
            // Play Styles — quiet white rail card (one rail language)
            "[.ui-play_&]:bg-white [.ui-play_&]:border-2 [.ui-play_&]:border-play-surface",
            "[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:text-play-ink",
            "[.ui-play_&]:shadow-none [.ui-play_&]:hover:shadow-none"
        )}>
            {/* Background gradient overlay */}
            <div className={cn(
                "absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-md",
                "[.ui-play_&]:hidden"
            )}></div>

            {/* Floating orb effects */}
            <div className={cn(
                "absolute top-0 end-0 w-16 h-16 bg-primary-100/20 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-500 -translate-y-3 translate-x-6",
                "[.ui-play_&]:hidden"
            )}></div>
            <div className={cn(
                "absolute bottom-0 start-0 w-20 h-20 bg-yellow-100/20 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-500 translate-y-3 -translate-x-6",
                "[.ui-play_&]:hidden"
            )}></div>

            <div className="relative space-y-3">
                {/* Enhanced Header */}
                <div className="flex items-center space-x-2 animate-fade-in-down">
                    <div className={cn(
                        "p-1 bg-gradient-to-br from-warning-100 to-warning-200 rounded-md shadow-sm",
                        // Play Styles
                        "[.ui-play_&]:bg-play-gold-soft [.ui-play_&]:rounded-xl"
                    )}>
                        <Star
                            size={14}
                            className={cn(
                                "text-yellow-600",
                                // Play — ink on the bright gold chip, never white/dim
                                "[.ui-play_&]:text-play-ink"
                            )}
                            weight="duotone"
                        />
                    </div>
                    <div className="min-w-0">
                        <h1 className={cn(
                            "text-sm font-bold text-gray-900 tracking-tight leading-tight",
                            "[.ui-play_&]:text-play-ink"
                        )}>
                            {t("ratings.heading")}
                        </h1>
                        <p className={cn(
                            "text-caption text-gray-600 flex items-center gap-1",
                            "[.ui-play_&]:text-play-muted-deep"
                        )}>
                            <ChatCircle
                                size={10}
                                className={cn(
                                    "text-primary-500",
                                    "[.ui-play_&]:text-play-muted-deep"
                                )}
                                weight="duotone"
                            />
                            <span>{t("ratings.subheading")}</span>
                        </p>
                    </div>
                </div>

                <form className={cn(
                    "flex flex-col gap-2 rounded-md border bg-gray-50 dark:bg-neutral-900 p-2.5",
                    "[.ui-play_&]:rounded-xl [.ui-play_&]:border-2 [.ui-play_&]:border-play-surface [.ui-play_&]:bg-white"
                )}>
                    <label className={cn(
                        "text-xs font-semibold text-neutral-700 dark:text-neutral-300",
                        "[.ui-play_&]:text-play-ink [.ui-play_&]:font-bold"
                    )}>
                        {t("ratings.form.feedbackLabel")}
                    </label>
                    <Textarea
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder={t("ratings.form.feedbackPlaceholder")}
                        rows={2}
                        className="resize-none text-xs"
                    />
                    <label className={cn(
                        "text-xs font-semibold text-neutral-700 dark:text-neutral-300",
                        "[.ui-play_&]:text-play-ink [.ui-play_&]:font-bold"
                    )}>
                        {t("ratings.form.ratingLabel")} <span className="text-red-500">*</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                type="button"
                                key={star}
                                onClick={() => handleStarClick(star)}
                                className="focus:outline-none"
                            >
                                <Star
                                    size={20}
                                    weight={
                                        selectedRating && selectedRating >= star
                                            ? "fill"
                                            : "regular"
                                    }
                                    className={cn(
                                        selectedRating && selectedRating >= star
                                            ? "text-yellow-400 [.ui-play_&]:text-play-gold"
                                            : "text-gray-300 [.ui-play_&]:text-neutral-300"
                                    )}
                                />
                            </button>
                        ))}
                        <span className={cn(
                            "ms-1 text-caption text-neutral-500",
                            "[.ui-play_&]:text-play-muted-deep [.ui-play_&]:font-bold"
                        )}>
                            {selectedRating
                                ? t("ratings.form.starCount", { count: selectedRating })
                                : ""}
                        </span>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        disable={
                            submitting ||
                            !selectedRating
                        }
                        scale="small"
                        className={cn(
                            "w-fit",
                            // Play — Duolingo press grammar when enabled
                            "[.ui-play_&]:rounded-xl [.ui-play_&]:font-black [.ui-play_&]:uppercase [.ui-play_&]:tracking-wide",
                            "[.ui-play_&]:enabled:bg-play-success [.ui-play_&]:enabled:hover:bg-play-success-deep",
                            "[.ui-play_&]:enabled:!text-white [.ui-play_&]:enabled:shadow-play-2d-success",
                            "[.ui-play_&]:enabled:active:translate-y-0.5 [.ui-play_&]:enabled:active:shadow-none",
                            // Play — clearly disabled, never pale-on-white
                            "[.ui-play_&]:disabled:bg-play-surface [.ui-play_&]:disabled:!text-play-muted-deep [.ui-play_&]:disabled:shadow-none"
                        )}
                        onClick={handleSubmit}
                    >
                        {submitting ? t("ratings.form.submitting") : t("ratings.form.submit")}
                    </MyButton>
                </form>

                {reviews.length > 0 && (
                    <div
                        className="animate-fade-in-up"
                        style={{ animationDelay: "0.1s" }}
                    >
                        {/* Enhanced Overall Rating Section */}
                        <div className={cn(
                            "relative bg-gradient-to-br from-warning-50/80 to-primary-50/80 border border-yellow-200/60 rounded-md p-2.5 overflow-hidden group/rating",
                            // Vibrant — flat primary-50 wash (tenant family)
                            "[.ui-vibrant_&]:bg-none [.ui-vibrant_&]:bg-primary-50/50 dark:[.ui-vibrant_&]:bg-primary-500/10",
                            "[.ui-vibrant_&]:border-primary-100 dark:[.ui-vibrant_&]:border-primary-500/30",
                            // Play Styles — solid, bold, Duolingo-style
                            "[.ui-play_&]:bg-play-gold-soft [.ui-play_&]:border-border [.ui-play_&]:rounded-play-card-sm [.ui-play_&]:text-play-ink [.ui-play_&]:font-bold",
                            "[.ui-play_&]:shadow-play-soft-card"
                        )}>
                            {/* Background pattern */}
                            <div className={cn(
                                "absolute inset-0 bg-gradient-to-br from-warning-100/20 via-transparent to-primary-100/20 opacity-0 group-hover/rating:opacity-100 transition-opacity duration-500",
                                "[.ui-vibrant_&]:hidden",
                                "[.ui-play_&]:hidden"
                            )}></div>

                            <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-stack">
                                {/* Rating Score */}
                                <div className="lg:col-span-2 text-center lg:text-start space-y-1.5">
                                    <div className="inline-flex flex-col items-center lg:items-start space-y-1">
                                        <div className="text-2xl sm:text-3xl font-bold text-gray-900 leading-none">
                                            {overallRatingData?.average_rating !==
                                                null &&
                                                overallRatingData?.average_rating !==
                                                undefined
                                                ? Number(
                                                    overallRatingData.average_rating
                                                ).toFixed(1)
                                                : "N/A"}
                                        </div>
                                        <div className="flex items-center space-x-1.5">
                                            <StarRatingComponent
                                                score={
                                                    overallRatingData?.average_rating !==
                                                        null &&
                                                        overallRatingData?.average_rating !==
                                                        undefined
                                                        ? Number(
                                                            overallRatingData.average_rating
                                                        ) * 20
                                                        : 0
                                                }
                                                starColor={true}
                                            />
                                        </div>
                                        <div className={cn(
                                            "flex items-center space-x-1.5 text-gray-600",
                                            "[.ui-play_&]:text-play-ink"
                                        )}>
                                            <TrendUp
                                                size={14}
                                                className={cn(
                                                    "text-success-600",
                                                    // Play — ink on the gold surface
                                                    "[.ui-play_&]:text-play-ink"
                                                )}
                                                weight="duotone"
                                            />
                                            <span className="text-xs font-medium">
                                                {t("ratings.reviewsCount", {
                                                    count:
                                                        overallRatingData?.total_reviews !==
                                                            null &&
                                                            overallRatingData?.total_reviews !==
                                                            undefined
                                                            ? overallRatingData.total_reviews
                                                            : 0,
                                                })}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Rating Breakdown */}
                                <div className="lg:col-span-3 space-y-1.5">
                                    {[5, 4, 3, 2, 1].map((stars) => {
                                        const percentKey =
                                            `percent_${stars === 5 ? "five" : stars === 4 ? "four" : stars === 3 ? "three" : stars === 2 ? "two" : "one"}_star` as keyof typeof overallRatingData;
                                        const percent =
                                            overallRatingData?.[percentKey] ??
                                            0;

                                        return (
                                            <div
                                                key={stars}
                                                className="flex items-center gap-2 sm:gap-3 group/bar"
                                            >
                                                <div className={cn(
                                                    "flex items-center space-x-1 text-xs font-medium text-gray-700 min-w-12",
                                                    "[.ui-play_&]:text-play-ink [.ui-play_&]:font-bold"
                                                )}>
                                                    <Star
                                                        size={12}
                                                        className={cn(
                                                            "text-yellow-500",
                                                            // Play — ink stars on the gold surface
                                                            "[.ui-play_&]:text-play-ink"
                                                        )}
                                                        weight="fill"
                                                    />
                                                    <span>{stars}</span>
                                                </div>
                                                <div className="flex-1 relative">
                                                    <ProgressBar
                                                        value={percent}
                                                        className={cn(
                                                            "h-1.5 bg-gray-200 rounded-full overflow-hidden group-hover/bar:h-2 transition-all duration-300",
                                                            // Play — white track + deep-gold fill on the gold box
                                                            "[.ui-play_&]:border-transparent [.ui-play_&]:bg-white/60",
                                                            "[.ui-play_&]:[&>div]:bg-play-gold-deep"
                                                        )}
                                                    />
                                                </div>
                                                <span className="text-xs font-bold text-gray-900 min-w-10 text-end">
                                                    {percent}%
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Reviews List */}
                <div
                    className={`${reviews.length === 0 ? "mt-0" : "mt-3"} space-y-2.5 animate-fade-in-up`}
                    style={{ animationDelay: "0.2s" }}
                >
                    {isRatingLoading ? (
                        <div className="space-y-2">
                            {[1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="bg-white/60 rounded-md p-2.5 animate-pulse space-y-2"
                                >
                                    <div className="flex items-center gap-x-2">
                                        <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                                        <div className="flex-1 space-y-1">
                                            <div className="h-2.5 bg-gray-200 rounded w-1/4"></div>
                                            <div className="h-2 bg-gray-200 rounded w-1/6"></div>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="h-2.5 bg-gray-200 rounded w-full"></div>
                                        <div className="h-2.5 bg-gray-200 rounded w-3/4"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : reviews.length === 0 ? (
                        <div className="relative bg-white/60 border border-gray-200/60 rounded-md p-4 text-center overflow-hidden">
                            {/* Background pattern */}
                            <div className="absolute inset-0 bg-gradient-to-br from-gray-50/30 via-transparent to-primary-50/20 pointer-events-none"></div>

                            <div className="relative">
                                <div className="w-10 h-10 bg-gradient-to-br from-gray-100 to-gray-200 rounded-md mx-auto mb-2 flex items-center justify-center">
                                    <ChatCircle
                                        size={18}
                                        className="text-gray-500"
                                        weight="duotone"
                                    />
                                </div>
                                <h3 className="text-sm font-bold text-gray-900 mb-0.5">
                                    {t("ratings.empty.title")}
                                </h3>
                                <p className="text-gray-600 text-caption">
                                    {t("ratings.empty.description", { course })}
                                </p>
                            </div>
                        </div>
                    ) : (
                        reviews.map((review, index) => (
                            <div
                                key={review.id}
                                className="animate-fade-in-up"
                                style={{
                                    animationDelay: `${0.3 + index * 0.1}s`,
                                }}
                            >
                                <ReviewItem
                                    review={review}
                                    avatarUrl={avatarUrls[review.id]}
                                    onLike={handleLike}
                                    onDislike={handleDislike}
                                    onDelete={handleDelete}
                                    showActions={true}
                                    variant="default"
                                    currentUserId={currentUserId}
                                />
                            </div>
                        ))
                    )}

                    {/* Enhanced Pagination */}
                    {totalPages > 1 && (
                        <div
                            className="flex justify-center mt-3 animate-fade-in-up"
                            style={{ animationDelay: "0.5s" }}
                        >
                            <div className="bg-white border border-gray-200 rounded-md shadow-sm p-1.5">
                                <MyPagination
                                    currentPage={page}
                                    totalPages={totalPages}
                                    onPageChange={handlePageChange}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


