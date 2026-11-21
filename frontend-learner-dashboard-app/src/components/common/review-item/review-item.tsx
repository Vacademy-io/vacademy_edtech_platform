import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, Trash } from "@phosphor-icons/react";
import { StarRatingComponent } from "@/components/common/star-rating-component";
import { ReviewItemProps } from "./types";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function ReviewItem({
    review,
    avatarUrl,
    currentUserId,
    onLike,
    onDislike,
    onDelete,
    showActions = true,
    variant = 'default'
}: ReviewItemProps) {
    const { t, i18n } = useTranslation("layoutCommonB");

    // Helper function to format time ago
    const timeAgo = (dateString: string) => {
        const now = new Date();
        const date = new Date(dateString);
        const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (diff < 60) return t("reviewItem.timeAgo.seconds", { count: diff });
        if (diff < 3600) return t("reviewItem.timeAgo.minutes", { count: Math.floor(diff / 60) });
        if (diff < 86400) return t("reviewItem.timeAgo.hours", { count: Math.floor(diff / 3600) });
        if (diff < 604800) return t("reviewItem.timeAgo.days", { count: Math.floor(diff / 86400) });
        return date.toLocaleDateString(i18n.language);
    };

    const isCompact = variant === 'compact';
    const canDelete = currentUserId && review.user.id === currentUserId;
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const handleDeleteClick = () => {
        setShowDeleteDialog(true);
    };

    const handleConfirmDelete = () => {
        onDelete(review.id);
        setShowDeleteDialog(false);
    };

    if (isCompact) {
        return (
            <div className="flex items-center space-x-3 p-3 bg-white/60 rounded-lg border border-gray-200/60">
                {/* Avatar */}
                <Avatar className="w-8 h-8 border border-white shadow-sm">
                    {avatarUrl ? (
                        <AvatarImage
                            src={avatarUrl}
                            alt={review.user.name}
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling?.classList.remove('hidden');
                            }}
                        />
                    ) : null}
                    <AvatarFallback className="bg-gradient-to-br from-primary-500 to-primary-600 text-white text-xs font-semibold">
                        {review.user.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                    </AvatarFallback>
                </Avatar>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 truncate">
                                {review.user.name}
                            </h4>
                            <p className="text-xs text-gray-500">
                                {timeAgo(review.createdAt)}
                            </p>
                        </div>
                        <div className="flex items-center space-x-1">
                            <StarRatingComponent
                                score={review.rating * 20}
                                starColor={true}
                            />
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                {showActions && (
                    <div className="flex items-center space-x-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="flex items-center space-x-1 text-gray-500 hover:text-success-600 hover:bg-success-50 transition-all duration-300 rounded-lg px-2 py-1"
                            onClick={() => onLike(review.id)}
                        >
                            <ThumbsUp size={12} weight="duotone" />
                            <span className="text-xs font-medium">
                                {review.likes}
                            </span>
                        </Button>

                        <Button
                            variant="ghost"
                            size="sm"
                            className="flex items-center space-x-1 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all duration-300 rounded-lg px-2 py-1"
                            onClick={() => onDislike(review.id)}
                        >
                            <ThumbsDown size={12} weight="duotone" />
                            <span className="text-xs font-medium">
                                {review.dislikes}
                            </span>
                        </Button>
                    </div>
                )}
            </div>
        );
    }

    // Default variant (full review card)
    return (
        <>
            <div className="relative bg-white border border-gray-200 rounded-md shadow-sm hover:shadow-md transition-all duration-300 p-3 sm:p-4 group/review overflow-hidden">
                {/* Background gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-transparent opacity-0 group-hover/review:opacity-100 transition-opacity duration-300 rounded-md"></div>

                {/* Floating orb effect */}
                <div className="absolute top-0 end-0 w-10 h-10 bg-primary-100/20 rounded-full blur-2xl opacity-0 group-hover/review:opacity-100 transition-opacity duration-700 -translate-y-1 translate-x-3"></div>

                <div className="relative">
                    {/* User Info */}
                    <div className="flex items-center space-x-3 mb-3">
                        <Avatar className="w-10 h-10 border-2 border-white shadow-lg">
                            {avatarUrl ? (
                                <AvatarImage
                                    src={avatarUrl}
                                    alt={review.user.name}
                                    onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                    }}
                                />
                            ) : null}
                            <AvatarFallback className="bg-gradient-to-br from-primary-500 to-primary-600 text-white font-semibold">
                                {review.user.name
                                    .split(" ")
                                    .map((n) => n[0])
                                    .join("")
                                    .slice(0, 2)
                                    .toUpperCase()}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                                <div>
                                    <h4 className="text-sm font-semibold text-gray-900 truncate">
                                        {review.user.name}
                                    </h4>
                                    <p className="text-xs text-gray-500 flex items-center space-x-1">
                                        <span>
                                            {timeAgo(review.createdAt)}
                                        </span>
                                    </p>
                                </div>
                                <div className="flex items-center space-x-1.5">
                                    <StarRatingComponent
                                        score={review.rating * 20}
                                        starColor={true}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Review Content */}
                    {review.description && review.description !== "No review text provided" && (
                        <div className="mb-3">
                            <p className="text-gray-700 leading-relaxed text-xs sm:text-sm">
                                {review.description}
                            </p>
                        </div>
                    )}

                    {/* Action Buttons */}
                    {showActions && (
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1 sm:space-x-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex items-center space-x-1.5 text-gray-500 hover:text-success-600 hover:bg-success-50 transition-all duration-300 rounded-lg px-2.5 py-1"
                                    onClick={() => onLike(review.id)}
                                >
                                    <ThumbsUp size={14} weight="duotone" />
                                    <span className="text-xs font-medium">
                                        {review.likes}
                                    </span>
                                </Button>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex items-center space-x-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all duration-300 rounded-lg px-2.5 py-1"
                                    onClick={() => onDislike(review.id)}
                                >
                                    <ThumbsDown size={14} weight="duotone" />
                                    <span className="text-xs font-medium">
                                        {review.dislikes}
                                    </span>
                                </Button>
                            </div>

                            {/* Only show delete button if current user is the review creator */}
                            {canDelete && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex items-center space-x-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all duration-300 rounded-lg px-2.5 py-1"
                                    onClick={handleDeleteClick}
                                >
                                    <Trash size={14} weight="duotone" />
                                    <span className="text-xs font-medium">
                                        {t("reviewItem.actions.delete")}
                                    </span>
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {/* Progress indicator */}
                <div className="absolute bottom-0 start-0 h-0.5 bg-gradient-to-r from-primary-400 to-primary-600 w-0 group-hover/review:w-full transition-all duration-500 ease-out rounded-b-md"></div>
            </div>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("reviewItem.deleteDialog.title")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("reviewItem.deleteDialog.description")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("reviewItem.deleteDialog.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            className="bg-red-500 text-white hover:bg-red-600"
                        >
                            {t("reviewItem.deleteDialog.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}