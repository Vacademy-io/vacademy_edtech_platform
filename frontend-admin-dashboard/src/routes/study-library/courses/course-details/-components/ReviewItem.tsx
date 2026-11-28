import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ThumbsUp, ThumbsDown, Trash, Check, X } from '@phosphor-icons/react';
import { StarRatingComponent } from '@/components/common/star-rating-component';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { handleUpdateRating } from '../-services/rating-services';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getInstituteId } from '@/constants/helper';
import { getPublicUrl } from '@/services/upload_file';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ReviewItemProps {
    review: {
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
    };
    courseId: string;
    currentLevel: string;
    currentSession: string;
}

interface Rating {
    id: string;
    points: number;
    likes: number;
    dislikes: number;
    text: string;
    user: {
        id: string;
        username: string;
        email: string;
        full_name: string;
        profile_pic_file_id: string | null;
    };
    created_at: string;
    status: string;
}

function timeAgo(dateString: string, t: TFunction, locale: string) {
    const now = new Date();
    const date = new Date(dateString);
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return t('timeAgo.secondsAgo', { count: diff });
    if (diff < 3600) return t('timeAgo.minutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('timeAgo.hoursAgo', { count: Math.floor(diff / 3600) });
    if (diff < 604800) return t('timeAgo.daysAgo', { count: Math.floor(diff / 86400) });
    return date.toLocaleDateString(locale);
}

export function ReviewItem({ review, courseId, currentLevel, currentSession }: ReviewItemProps) {
    const { t, i18n } = useTranslation('studyLibraryReviewItem');
    // All hooks at the top
    const [localLikes, setLocalLikes] = useState(review.likes);
    const [localDislikes, setLocalDislikes] = useState(review.dislikes);
    const [localStatus, setLocalStatus] = useState(review.status);
    const [isUpdating, setIsUpdating] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string>('');
    const isMounted = useRef(true);
    const instituteId = getInstituteId();
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const hasRoleAdmin = instituteId
        ? tokenData?.authorities[instituteId]?.roles.includes('ADMIN')
        : false;
    const queryClient = useQueryClient();
    const { getPackageSessionId } = useInstituteDetailsStore();

    // Track mount status
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Resolve avatar file ID to public URL
    useEffect(() => {
        let isMountedAvatar = true;
        async function fetchAvatar() {
            if (review.user.avatarUrl) {
                try {
                    const url = await getPublicUrl(review.user.avatarUrl);
                    if (isMountedAvatar) setAvatarUrl(url);
                } catch {
                    if (isMountedAvatar) setAvatarUrl('');
                }
            } else {
                setAvatarUrl('');
            }
        }
        fetchAvatar();
        return () => {
            isMountedAvatar = false;
        };
    }, [review.user.avatarUrl]);

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
            text: string;
        }) => {
            // Debug log for mutation payload
            console.log('handleUpdateRating mutation payload:', {
                id,
                rating,
                source_id,
                status,
                likes,
                dislikes,
                text,
            });
            return handleUpdateRating(id, rating, source_id, status, likes, dislikes, text);
        },
        onSuccess: (_, variables) => {
            if (isMounted.current) {
                setLocalLikes(variables.likes);
                setLocalDislikes(variables.dislikes);
                // Don't set localStatus here for delete/decline, as it's already set before mutation
                setIsUpdating(false);
            }
            queryClient.invalidateQueries({ queryKey: ['GET_ALL_USER_COURSE_RATINGS'] });
            queryClient.invalidateQueries({ queryKey: ['GET_ALL_USER_COURSE_RATINGS_OVERALL'] });
            // Optimistically update the cache without invalidating
            const packageSessionId = getPackageSessionId({
                courseId: courseId || '',
                levelId: currentLevel || '',
                sessionId: currentSession || '',
            });
            queryClient.setQueryData<{
                content: Rating[];
                totalPages: number;
                totalElements: number;
                number: number;
                size: number;
            }>(
                [
                    'GET_ALL_USER_COURSE_RATINGS',
                    0, // Assuming we're on first page, adjust as needed
                    10,
                    {
                        source_id: packageSessionId || '',
                        source_type: 'PACKAGE_SESSION',
                    },
                ],
                (oldData) => {
                    if (!oldData) return oldData;
                    return {
                        ...oldData,
                        content: oldData.content.map((rating: Rating) => {
                            if (rating.id === variables.id) {
                                return {
                                    ...rating,
                                    likes: variables.likes,
                                    dislikes: variables.dislikes,
                                    status: variables.status,
                                };
                            }
                            return rating;
                        }),
                    };
                }
            );
            // Update overall rating cache optimistically
            queryClient.setQueryData<unknown>(
                ['GET_ALL_USER_COURSE_RATINGS_OVERALL', packageSessionId || ''],
                (oldData: unknown) => {
                    if (!oldData) return oldData;
                    // You might want to recalculate these based on the actual change
                    return {
                        ...oldData,
                    };
                }
            );
        },
        onError: (error: unknown) => {
            if (isMounted.current) {
                setLocalLikes(review.likes);
                setLocalDislikes(review.dislikes);
                setLocalStatus(review.status);
                setIsUpdating(false);
            }
            // Enhanced error logging
            if (error instanceof AxiosError) {
                console.error('ReviewItem mutation error:', error?.response?.data);
                toast.error(error?.response?.data?.ex || t('toasts.updateFailed'), {
                    className: 'error-toast',
                    duration: 2000,
                });
            } else {
                console.error('ReviewItem unexpected error:', error);
                toast.error(t('toasts.unexpectedError'), {
                    className: 'error-toast',
                    duration: 2000,
                });
            }
        },
    });

    // Hide deleted reviews immediately (after all hooks)
    if (localStatus === 'DELETED') return null;

    const handleAction = (action: 'like' | 'dislike' | 'approve' | 'decline' | 'delete') => {
        if (isUpdating) return;
        setIsUpdating(true);
        const packageSessionId = getPackageSessionId({
            courseId: courseId || '',
            levelId: currentLevel || '',
            sessionId: currentSession || '',
        });
        let newLikes = localLikes;
        let newDislikes = localDislikes;
        let newStatus = localStatus;
        switch (action) {
            case 'like':
                newLikes = localLikes + 1;
                break;
            case 'dislike':
                newDislikes = localDislikes + 1;
                break;
            case 'approve':
                newStatus = 'ACTIVE';
                if (isMounted.current) setLocalStatus('ACTIVE'); // UI updates instantly
                break;
            case 'decline':
            case 'delete':
                newStatus = 'DELETED';
                if (isMounted.current) setLocalStatus('DELETED'); // Hide immediately
                break;
        }
        const payload = {
            id: review.id,
            rating: review.rating,
            source_id: packageSessionId || '',
            status: newStatus,
            likes: newLikes,
            dislikes: newDislikes,
            text: review.description || '', // Preserve original text, allow empty strings
        };
        if (action === 'approve') {
            console.log('Approve payload:', payload);
        } else if (action === 'decline' || action === 'delete') {
            console.log('Delete/Decline payload:', payload);
        }
        handleUpdateRatingMutation.mutate(payload);
    };

    return (
        <div className="flex flex-col gap-4 rounded-md border bg-card p-4 text-card-foreground md:items-start">
            {/* Top row: Avatar/User Info and Star Rating */}
            <div className="flex w-full items-start justify-between">
                <div className="flex shrink-0 items-center justify-center gap-2">
                    <Avatar>
                        {avatarUrl !== '' ? (
                            <AvatarImage src={avatarUrl} alt={review.user.name} />
                        ) : (
                            <AvatarFallback>
                                {review.user.name
                                    .split(' ')
                                    .map((n) => n[0])
                                    .join('')
                                    .slice(0, 2)}
                            </AvatarFallback>
                        )}
                    </Avatar>
                    <div className="flex flex-col">
                        <span className="font-semibold text-neutral-800">{review.user.name}</span>
                        <span className="mt-0.5 text-xs text-neutral-400">
                            {timeAgo(review.createdAt, t, i18n.language)}
                        </span>
                    </div>
                </div>
                <div className="ml-2 flex items-center">
                    <StarRatingComponent score={review.rating * 20} starColor={true} />
                </div>
            </div>
            <div className="flex flex-col">
                <div className="mt-2 text-neutral-700">{review.description}</div>
                <div className="mt-3 flex items-center justify-start gap-4">
                    {localStatus === 'PENDING' && hasRoleAdmin ? (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex items-center gap-1 text-neutral-400 hover:text-green-600"
                                onClick={() => handleAction('approve')}
                                disabled={isUpdating}
                            >
                                <Check size={18} />
                                <span className="text-xs">{t('actions.approve')}</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex items-center gap-1 text-neutral-400 hover:text-red-600"
                                onClick={() => handleAction('decline')}
                                disabled={isUpdating}
                            >
                                <X size={18} />
                                <span className="text-xs">{t('actions.decline')}</span>
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex items-center gap-1 text-neutral-500 hover:text-blue-600"
                                onClick={() => handleAction('like')}
                                disabled={isUpdating}
                            >
                                <ThumbsUp size={18} />
                                <span className="text-xs">{localLikes}</span>
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="flex items-center gap-1 text-neutral-500 hover:text-red-500"
                                onClick={() => handleAction('dislike')}
                                disabled={isUpdating}
                            >
                                <ThumbsDown size={18} />
                                <span className="text-xs">{localDislikes}</span>
                            </Button>
                            {hasRoleAdmin && (
                                <AlertDialog>
                                    <AlertDialogTrigger>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="flex items-center gap-1 text-neutral-500 hover:text-red-600"
                                            disabled={isUpdating}
                                        >
                                            <Trash size={18} />
                                            <span className="text-xs">{t('actions.delete')}</span>
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>
                                                {t('deleteDialog.title')}
                                            </AlertDialogTitle>
                                            <AlertDialogDescription>
                                                {t('deleteDialog.description')}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>{t('deleteDialog.cancel')}</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => handleAction('delete')}
                                            >
                                                {t('deleteDialog.confirm')}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
