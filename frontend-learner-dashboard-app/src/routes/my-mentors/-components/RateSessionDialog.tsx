import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { reportApiError } from "@/lib/report-api-error";
import { MyButton } from "@/components/design-system/button";
import { MyDialog } from "@/components/design-system/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
    submitSessionFeedback,
    type PendingFeedback,
} from "../-services/my-mentors-service";
import { MAX_FEEDBACK_COMMENT } from "../-utils/feedback";

/**
 * Rate one finished mentor session. Stars are real buttons rather than a hover
 * widget so the control works with a keyboard and on touch, where hover doesn't
 * exist. The comment is optional — forcing prose is the fastest way to get no
 * ratings at all.
 */
export function RateSessionDialog({
    session,
    instituteId,
    open,
    onOpenChange,
}: {
    session: PendingFeedback | null;
    instituteId: string | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState("");
    const queryClient = useQueryClient();

    const ratingLabels: Record<number, string> = {
        1: t("myMentors.rateDialog.rating.1"),
        2: t("myMentors.rateDialog.rating.2"),
        3: t("myMentors.rateDialog.rating.3"),
        4: t("myMentors.rateDialog.rating.4"),
        5: t("myMentors.rateDialog.rating.5"),
    };

    useEffect(() => {
        if (open) {
            setRating(0);
            setComment("");
        }
    }, [open, session]);

    const submit = useMutation({
        mutationFn: () =>
            submitSessionFeedback({
                instituteId: instituteId ?? "",
                bookingInstanceId: session?.booking_instance_id ?? "",
                rating,
                comment: comment.trim() || undefined,
            }),
        onSuccess: () => {
            toast.success(t("myMentors.rateDialog.toast.thanks"));
            queryClient.invalidateQueries({ queryKey: ["GET_PENDING_MENTOR_FEEDBACK"] });
            onOpenChange(false);
        },
        onError: (error: unknown) =>
            reportApiError(error, {
                feature: "mentorship",
                tags: { "mentorship.action": "submit-feedback" },
                extra: { bookingInstanceId: session?.booking_instance_id, rating },
                fallbackMessage: t("myMentors.rateDialog.toast.saveFailed"),
            }),
    });

    if (!session) return null;

    return (
        <MyDialog
            heading={t("myMentors.rateDialog.heading")}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-md"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t("myMentors.rateDialog.notNow")}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={() => submit.mutate()}
                        disable={rating === 0 || submit.isPending || !instituteId}
                        title={rating === 0 ? t("myMentors.rateDialog.pickStarFirst") : undefined}
                    >
                        {submit.isPending
                            ? t("myMentors.rateDialog.saving")
                            : t("myMentors.rateDialog.submit")}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-1">
                <p className="text-body text-neutral-600">
                    {t("myMentors.rateDialog.question", {
                        session: session.session_title || t("myMentors.common.yourSession"),
                        mentor: session.mentor_name || t("myMentors.common.yourMentor"),
                    })}
                </p>

                <div className="flex flex-col gap-1.5">
                    <div
                        className="flex items-center gap-1"
                        role="group"
                        aria-label={t("myMentors.rateDialog.starRatingAriaLabel")}
                    >
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                type="button"
                                onClick={() => setRating(star)}
                                aria-label={t("myMentors.rateDialog.starAriaLabel", { count: star })}
                                aria-pressed={rating === star}
                                className="rounded p-1 transition-transform hover:scale-110"
                            >
                                <Star
                                    size={30}
                                    weight={star <= rating ? "fill" : "regular"}
                                    className={
                                        star <= rating ? "text-warning-500" : "text-neutral-300"
                                    }
                                />
                            </button>
                        ))}
                    </div>
                    <span className="min-h-5 text-caption text-neutral-500">
                        {rating > 0 ? ratingLabels[rating] : t("myMentors.rateDialog.tapToRate")}
                    </span>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label
                        htmlFor="session-feedback-comment"
                        className="text-caption font-medium text-neutral-600"
                    >
                        {t("myMentors.rateDialog.commentLabel")}
                    </label>
                    <Textarea
                        id="session-feedback-comment"
                        value={comment}
                        maxLength={MAX_FEEDBACK_COMMENT}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={t("myMentors.rateDialog.commentPlaceholder")}
                        className="min-h-20 resize-none"
                    />
                    <span className="flex items-center justify-between text-caption text-neutral-400">
                        <span>{t("myMentors.rateDialog.commentHelper")}</span>
                        <span>
                            {comment.length}/{MAX_FEEDBACK_COMMENT}
                        </span>
                    </span>
                </div>
            </div>
        </MyDialog>
    );
}
