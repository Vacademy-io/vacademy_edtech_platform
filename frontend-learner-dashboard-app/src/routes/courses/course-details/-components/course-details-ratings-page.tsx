import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useRef, useCallback } from "react";
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
} from "../-services/rating-services";
import { StarRatingComponent } from "@/components/common/star-rating-component";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { ProgressBar } from "@/components/ui/custom-progress-bar";
import { getPublicUrl } from "@/services/upload_file";
import { ReviewItem, type Review } from "@/components/common/review-item";
import { useRouter } from "@tanstack/react-router";
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
            id: rating.user.id,
            name: rating.user.full_name || rating.user.username,
            avatarUrl: rating.user.profile_pic_file_id || "",
        },
        createdAt: rating.created_at,
        rating: rating.points,
        description: rating.text,
        likes: rating.likes,
        dislikes: rating.dislikes,
    };
};

function timeAgo(dateString: string) {
    const now = new Date();
    const date = new Date(dateString);
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
}

export function CourseDetailsRatingsComponent({
    packageSessionId,
    onRatingsLoadingChange,
}: {
    packageSessionId: string | null;
    onRatingsLoadingChange?: (loading: boolean) => void;
}) {
    const { t } = useTranslation("coursesRouteB");
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
            } catch (error) {
                console.error("Failed to get current user ID:", error);
                setCurrentUserId(null);
            }
        };

        fetchCurrentUserId();
    }, []);

    const { data: ratingData, isLoading: isRatingLoading } =
        useSuspenseQuery<PaginatedResponse>(
            handleGetRatingDetails({
                pageNo: page,
                pageSize: 10,
                data: {
                    source_id: packageSessionId || "",
                    source_type: "PACKAGE_SESSION",
                },
            })
        );

    const { data: overallRatingData, isLoading: isOverallRatingLoading } =
        useSuspenseQuery(
            handleGetOverAllRatingDetails({
                source_id: packageSessionId || "",
            })
        );

    // Memoized callback for loading state changes
    const handleLoadingChange = useCallback(
        (loading: boolean) => {
            if (onRatingsLoadingChange) {
                onRatingsLoadingChange(loading);
            }
        },
        [onRatingsLoadingChange]
    );

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
                (review) =>
                    review.user.avatarUrl &&
                    !fetchedUrlsRef.current.has(review.id)
            );

            if (reviewsNeedingUrls.length === 0) return;

            const urlPromises = reviewsNeedingUrls.map(async (review) => {
                try {
                    const url = await getPublicUrl(review.user.avatarUrl);
                    // Mark this review as fetched
                    fetchedUrlsRef.current.add(review.id);
                    return { reviewId: review.id, url };
                } catch (error) {
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
            setAvatarUrls((prev) => ({ ...prev, ...newUrls }));
        };

        if (reviews.length > 0) {
            fetchAvatarUrls();
        }
    }, [reviews]);

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
                [
                    "GET_ALL_USER_COURSE_RATINGS",
                    page,
                    10,
                    {
                        source_id: packageSessionId || "",
                        source_type: "PACKAGE_SESSION",
                    },
                ],
                (oldData: any) => {
                    if (!oldData) return oldData;

                    // Find the original review to revert changes
                    const originalReview = reviews.find(
                        (r) => r.id === variables.id
                    );
                    if (!originalReview) return oldData;

                    return {
                        ...oldData,
                        content: oldData.content.map((rating: any) =>
                            rating.id === variables.id
                                ? {
                                      ...rating,
                                      likes: originalReview.likes,
                                      dislikes: originalReview.dislikes,
                                      status: "ACTIVE", // Revert status if it was deleted
                                  }
                                : rating
                        ),
                        totalElements:
                            oldData.totalElements +
                            (variables.status === "DELETED" ? 1 : 0), // Revert total count if deleted
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
                console.error("Unexpected error:", error);
            }
        },
    });

    const handlePageChange = (pageNo: number) => {
        setPage(pageNo);
    };

    // Handler functions for ReviewItem with optimistic updates
    const handleLike = (reviewId: string) => {
        const review = reviews.find((r) => r.id === reviewId);
        if (review) {
            // Update the query cache optimistically
            queryClient.setQueryData(
                [
                    "GET_ALL_USER_COURSE_RATINGS",
                    page,
                    10,
                    {
                        source_id: packageSessionId || "",
                        source_type: "PACKAGE_SESSION",
                    },
                ],
                (oldData: any) => ({
                    ...oldData,
                    content: oldData.content.map((rating: any) =>
                        rating.id === reviewId
                            ? { ...rating, likes: rating.likes + 1 }
                            : rating
                    ),
                })
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
        const review = reviews.find((r) => r.id === reviewId);
        if (review) {
            // Update the query cache optimistically
            queryClient.setQueryData(
                [
                    "GET_ALL_USER_COURSE_RATINGS",
                    page,
                    10,
                    {
                        source_id: packageSessionId || "",
                        source_type: "PACKAGE_SESSION",
                    },
                ],
                (oldData: any) => ({
                    ...oldData,
                    content: oldData.content.map((rating: any) =>
                        rating.id === reviewId
                            ? { ...rating, dislikes: rating.dislikes + 1 }
                            : rating
                    ),
                })
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
        const review = reviews.find((r) => r.id === reviewId);
        if (review) {
            // Update the query cache optimistically
            queryClient.setQueryData(
                [
                    "GET_ALL_USER_COURSE_RATINGS",
                    page,
                    10,
                    {
                        source_id: packageSessionId || "",
                        source_type: "PACKAGE_SESSION",
                    },
                ],
                (oldData: any) => ({
                    ...oldData,
                    content: oldData.content.filter(
                        (rating: any) => rating.id !== reviewId
                    ),
                    totalElements: oldData.totalElements - 1,
                })
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

    if (isRatingLoading || isOverallRatingLoading || !packageSessionId)
        return <DashboardLoader />;

    return (
        <div className="flex flex-col gap-5">
            <h1 className="text-2xl font-bold">{t("ratings.heading")}</h1>
            {reviews.length > 0 && (
                <div className="flex w-full gap-12">
                    <div className="flex flex-col gap-2 text-center">
                        <h1 className="text-3xl">
                            {overallRatingData?.average_rating !== null &&
                            overallRatingData?.average_rating !== undefined
                                ? Number(
                                      overallRatingData.average_rating
                                  ).toFixed(1)
                                : t("ratings.notAvailable")}
                        </h1>
                        <StarRatingComponent
                            score={
                                overallRatingData?.average_rating !== null &&
                                overallRatingData?.average_rating !== undefined
                                    ? Number(overallRatingData.average_rating) *
                                      20
                                    : 0
                            }
                            starColor={true}
                        />
                        <span>
                            {t("ratings.reviewsCount", {
                                count:
                                    overallRatingData?.total_reviews !== null &&
                                    overallRatingData?.total_reviews !== undefined
                                        ? overallRatingData.total_reviews
                                        : 0,
                            })}
                        </span>
                    </div>
                    <div className="flex w-full flex-col gap-4">
                        <div className="flex w-1/2 items-center gap-2">
                            <span>5</span>
                            <ProgressBar
                                value={
                                    overallRatingData?.percent_five_star ?? 0
                                }
                            />
                            <span>
                                {overallRatingData?.percent_five_star !==
                                    null &&
                                overallRatingData?.percent_five_star !==
                                    undefined
                                    ? `${overallRatingData.percent_five_star}%`
                                    : "0%"}
                            </span>
                        </div>
                        <div className="flex w-1/2 items-center gap-2">
                            <span>4</span>
                            <ProgressBar
                                value={
                                    overallRatingData?.percent_four_star ?? 0
                                }
                            />
                            <span>
                                {overallRatingData?.percent_four_star !==
                                    null &&
                                overallRatingData?.percent_four_star !==
                                    undefined
                                    ? `${overallRatingData.percent_four_star}%`
                                    : "0%"}
                            </span>
                        </div>
                        <div className="flex w-1/2 items-center gap-2">
                            <span>3</span>
                            <ProgressBar
                                value={
                                    overallRatingData?.percent_three_star ?? 0
                                }
                            />
                            <span>
                                {overallRatingData?.percent_three_star !==
                                    null &&
                                overallRatingData?.percent_three_star !==
                                    undefined
                                    ? `${overallRatingData.percent_three_star}%`
                                    : "0%"}
                            </span>
                        </div>
                        <div className="flex w-1/2 items-center gap-2">
                            <span>2</span>
                            <ProgressBar
                                value={overallRatingData?.percent_two_star ?? 0}
                            />
                            <span>
                                {overallRatingData?.percent_two_star !== null &&
                                overallRatingData?.percent_two_star !==
                                    undefined
                                    ? `${overallRatingData.percent_two_star}%`
                                    : "0%"}
                            </span>
                        </div>
                        <div className="flex w-1/2 items-center gap-2">
                            <span>1</span>
                            <ProgressBar
                                value={overallRatingData?.percent_one_star ?? 0}
                            />
                            <span>
                                {overallRatingData?.percent_one_star !== null &&
                                overallRatingData?.percent_one_star !==
                                    undefined
                                    ? `${overallRatingData.percent_one_star}%`
                                    : "0%"}
                            </span>
                        </div>
                    </div>
                </div>
            )}
            {/* User Reviews List */}
            <div
                className={`${reviews.length === 0 ? "mt-0" : "mt-8"} flex flex-col gap-4`}
            >
                {isRatingLoading || isOverallRatingLoading ? (
                    // Add loading skeleton here if needed
                    <div>{t("ratings.loading")}</div>
                ) : reviews.length === 0 ? (
                    <div className="text-center text-neutral-500">
                        {t("ratings.empty")}
                    </div>
                ) : (
                    reviews.map((review) => (
                        <ReviewItem
                            key={review.id}
                            review={review}
                            avatarUrl={avatarUrls[review.id]}
                            onLike={handleLike}
                            onDislike={handleDislike}
                            onDelete={handleDelete}
                            showActions={true}
                            variant="default"
                        />
                    ))
                )}
                {totalPages > 1 && (
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={handlePageChange}
                    />
                )}
            </div>
        </div>
    );
}
