import { StarRatingComponent } from '@/components/common/star-rating-component';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MyPagination } from '@/components/design-system/pagination';
import { useQuery } from '@tanstack/react-query';
import {
    handleGetOverAllRatingDetails,
    handleGetRatingDetails,
} from '../-services/rating-services';
import { useRouter } from '@tanstack/react-router';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { ProgressBar } from '@/components/ui/custom-progress-bar';
import { ReviewItem } from './ReviewItem';
import { Star as StarIcon } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';

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
    status: string;
}

// Type for transformed review data
interface Review {
    id: string;
    user: {
        name: string;
        avatarUrl: string;
    };
    createdAt: string;
    rating: number;
    description: string;
    likes: number;
    dislikes: number;
    status: string;
}

// Helper function to transform API data to Review format
const transformRatingToReview = (rating: Rating, t: TFunction): Review => {
    return {
        id: rating.id,
        user: {
            name: rating.user?.full_name || rating.user?.username || t('unknownUser'),
            avatarUrl: rating.user?.profile_pic_file_id || '',
        },
        createdAt: rating.created_at,
        rating: rating.points,
        description: rating.text,
        likes: rating.likes,
        dislikes: rating.dislikes,
        status: rating.status,
    };
};

export function CourseDetailsRatingsComponent({
    currentSession,
    currentLevel,
}: {
    currentSession: string;
    currentLevel: string;
}) {
    const router = useRouter();
    const { t } = useTranslation('studyLibraryCourseDetailsRatingsPage');
    const courseId = router.state.location.search.courseId;
    const [page, setPage] = useState(0);

    const { getPackageSessionId } = useInstituteDetailsStore();

    const packageSessionId = getPackageSessionId({
        courseId: courseId || '',
        levelId: currentLevel || '',
        sessionId: currentSession || '',
    });

    const { data: ratingData, isError: ratingError } = useQuery({
        ...handleGetRatingDetails({
            pageNo: page,
            pageSize: 10,
            data: {
                source_id: packageSessionId || '',
                source_type: 'PACKAGE_SESSION',
            },
        }),
        enabled: !!packageSessionId, // Only run query if packageSessionId exists
    });

    const { data: overallRatingData, isError: overallRatingError } = useQuery({
        ...handleGetOverAllRatingDetails({
            source_id: packageSessionId || '',
        }),
        enabled: !!packageSessionId, // Only run query if packageSessionId exists
    });

    // Transform API data to reviews format and filter out deleted
    const reviews: Review[] = (
        ratingData?.content?.map((rating: Rating) => transformRatingToReview(rating, t)) || []
    ).filter((review: Review) => review.status !== 'DELETED');
    const totalPages = ratingData?.totalPages || 0;

    const handlePageChange = (pageNo: number) => {
        setPage(pageNo);
    };

    // Handle errors
    if (ratingError || overallRatingError) {
        return (
            <div className="flex flex-col gap-5 bg-white p-8">
                <h1 className="mb-2 text-2xl font-bold text-neutral-600">{t('title')}</h1>
                <div className="text-center text-neutral-500">
                    {!packageSessionId ? t('errorMissingCourse') : t('errorGeneric')}
                </div>
            </div>
        );
    }

    const starKeys = ['five', 'four', 'three', 'two', 'one'];

    return (
        <div className="x-auto flex max-w-full flex-col gap-8 rounded-md bg-white p-4 ">
            {/* Feedback Form / Summary */}
            {overallRatingData?.average_rating !== null &&
                overallRatingData?.average_rating !== undefined && (
                    <div className="flex w-full flex-col items-center justify-center gap-8 rounded-xl bg-neutral-50 p-6 md:flex-row">
                        <div className="flex w-full flex-col items-center justify-center gap-2 text-left">
                            <h1 className="mb-3 w-full text-center text-3xl font-bold text-neutral-700">
                                {t('title')}
                            </h1>
                            <h1 className="text-4xl font-bold text-neutral-800">
                                {overallRatingData?.average_rating !== null &&
                                overallRatingData?.average_rating !== undefined
                                    ? Number(overallRatingData.average_rating).toFixed(1)
                                    : t('notAvailable')}
                            </h1>
                            <StarRatingComponent
                                score={
                                    overallRatingData?.average_rating !== null &&
                                    overallRatingData?.average_rating !== undefined
                                        ? Number(overallRatingData.average_rating) * 20
                                        : 0
                                }
                                starColor={true}
                            />
                            <span className="sm text-neutral-500">
                                {t('reviewsCount', {
                                    count:
                                        overallRatingData?.total_reviews !== null &&
                                        overallRatingData?.total_reviews !== undefined
                                            ? overallRatingData.total_reviews
                                            : 0,
                                })}
                            </span>
                        </div>
                        <div className="flex w-full max-w-md flex-col gap-2">
                            {[5, 4, 3, 2, 1].map((num) => (
                                <div key={num} className="flex items-center gap-2">
                                    <span className="flex w-4 items-center gap-1 text-xs">
                                        <StarIcon
                                            size={18}
                                            weight="fill"
                                            className="mr-1 text-yellow-400"
                                        />
                                        {num}
                                    </span>
                                    <ProgressBar
                                        value={
                                            overallRatingData?.[
                                                `percent_${starKeys[5 - num]}_star`
                                            ] ?? 0
                                        }
                                    />
                                    <span className="w-10 text-right text-xs">
                                        {overallRatingData?.[
                                            `percent_${starKeys[5 - num]}_star`
                                        ] !== null &&
                                        overallRatingData?.[`percent_${starKeys[5 - num]}_star`] !==
                                            undefined
                                            ? `${overallRatingData[`percent_${starKeys[5 - num]}_star`]}%`
                                            : '0%'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            <div className="my-2 border-t border-neutral-200" />
            {/* User Reviews List */}
            <div className={`${reviews.length === 0 ? 'mt-0' : 'mt-4'} flex flex-col gap-6`}>
                {reviews.length === 0 ? (
                    <div className="text-center text-neutral-500">{t('noReviewsYet')}</div>
                ) : (
                    reviews.map((review: Review) => (
                        <ReviewItem
                            key={review.id}
                            review={review}
                            courseId={courseId || ''}
                            currentLevel={currentLevel}
                            currentSession={currentSession}
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
