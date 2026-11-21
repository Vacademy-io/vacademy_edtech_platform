import { useState } from "react";
import {
    CaretDown,
    CaretRight,
    Check,
    ChatText,
    Clock,
    FilePdf,
    ArrowRight,
    Hourglass,
} from "@phosphor-icons/react";
import { Reply } from "./reply";
import { Doubt as DoubtType } from "../types/get-doubts-type";
import { formatISODateTimeReadable, formatRelativeTime } from "@/helpers/formatISOTime";
import { DeleteDoubt } from "./DeleteDoubt";
import { MarkAsResolved } from "./MarkAsResolved";
import { useTranslation } from "react-i18next";
import { DoubtAuthorMap } from "../hooks/useDoubtAuthors";
import { DoubtAvatar } from "./DoubtAvatar";
import { DoubtBadge } from "./DoubtBadge";

interface DoubtProps {
    doubt: DoubtType;
    refetch: () => void;
    authors: DoubtAuthorMap;
    viewerUserId: string | null;
    /** Source type of the slide being viewed — decides whether a position chip makes sense. */
    sourceType?: string;
    /** Jump the player/PDF to this doubt's position (the panel also closes itself). */
    onJumpToPosition?: (position: number) => void;
    /** Pre-formatted "1:02" / "Page 3" label for this doubt's position. */
    positionLabel?: string;
}

export const Doubt = ({
    doubt,
    refetch,
    authors,
    viewerUserId,
    sourceType,
    onJumpToPosition,
    positionLabel,
}: DoubtProps) => {
    const { t, i18n } = useTranslation("studyContent");
    const [showReplies, setShowReplies] = useState<boolean>(true);

    const author = authors[doubt.user_id];
    const isOwnDoubt = !!viewerUserId && doubt.user_id === viewerUserId;
    const replyCount = doubt.replies?.length ?? 0;
    const isResolved = doubt.status === "RESOLVED";
    const isDocument = sourceType === "DOCUMENT";
    const hasPosition = !!positionLabel && (sourceType === "VIDEO" || isDocument);

    // The institute can define its own statuses (In progress, Being looked into, …); the server
    // sends a learner-safe label + kind for the current one. Internal remarks and assignment
    // history never reach the learner. A CUSTOM status shows its learner label; the built-in
    // Pending keeps the reply-aware "Answered / Awaiting reply" wording (and an older server
    // that sends no learner_status behaves exactly as before).
    const learnerStatus = doubt.learner_status;
    const customOpenStatus =
        learnerStatus && learnerStatus.key !== "PENDING" && learnerStatus.kind !== "RESOLVED"
            ? learnerStatus
            : null;
    const status = isResolved
        ? {
              tone: "success" as const,
              label: learnerStatus?.kind === "RESOLVED" ? learnerStatus.label : t("doubts.statusResolved"),
              icon: <Check size={11} weight="bold" />,
          }
        : customOpenStatus
          ? {
                tone: customOpenStatus.kind === "IN_PROGRESS" ? ("info" as const) : ("warning" as const),
                label: customOpenStatus.label,
                icon:
                    customOpenStatus.kind === "IN_PROGRESS" ? (
                        <Hourglass size={11} weight="fill" />
                    ) : (
                        <Clock size={11} weight="fill" />
                    ),
            }
          : replyCount > 0
            ? {
                  tone: "info" as const,
                  label: t("doubts.statusAnswered"),
                  icon: <ChatText size={11} weight="fill" />,
              }
            : {
                  tone: "warning" as const,
                  label: t("doubts.statusAwaiting"),
                  icon: <Clock size={11} weight="fill" />,
              };

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
            {/* Author + status */}
            <div className="flex items-center gap-2">
                <DoubtAvatar name={author?.name || doubt.name} url={author?.avatarUrl} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-body font-semibold text-neutral-900">
                        {author?.name || doubt.name}
                    </p>
                    <span
                        className="text-2xs text-neutral-500"
                        title={formatISODateTimeReadable(doubt.raised_time)}
                    >
                        {formatRelativeTime(doubt.raised_time, i18n.language)}
                    </span>
                </div>
                <DoubtBadge tone={status.tone} icon={status.icon}>
                    {status.label}
                </DoubtBadge>
            </div>

            {/* Question */}
            <div
                dangerouslySetInnerHTML={{ __html: doubt.html_text || "" }}
                className="rich-text-content doubt-html mt-2 text-body text-neutral-700"
            />

            {/* Position + owner actions */}
            {(hasPosition || isOwnDoubt) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {hasPosition && (
                        <button
                            type="button"
                            onClick={() => onJumpToPosition?.(parseInt(doubt.content_position || "0", 10))}
                            aria-label={t("doubts.jumpTo", { position: positionLabel })}
                            className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-2xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-200"
                        >
                            {isDocument ? <FilePdf size={12} /> : <Clock size={12} />}
                            {positionLabel}
                            <ArrowRight size={11} className="text-neutral-500 rtl:rotate-180" />
                        </button>
                    )}
                    {isOwnDoubt && (
                        <div className="ms-auto flex items-center gap-1">
                            {replyCount > 0 && <MarkAsResolved doubt={doubt} refetch={refetch} />}
                            {replyCount === 0 && <DeleteDoubt doubt={doubt} refetch={refetch} />}
                        </div>
                    )}
                </div>
            )}

            {/* Answers */}
            {replyCount > 0 && (
                <div className="mt-2 border-t border-neutral-100 pt-2">
                    <button
                        type="button"
                        onClick={() => setShowReplies((prev) => !prev)}
                        aria-expanded={showReplies}
                        className="flex w-full items-center gap-1 text-caption font-semibold text-neutral-700 transition-colors hover:text-primary-500"
                    >
                        {showReplies ? <CaretDown size={13} /> : <CaretRight size={13} className="rtl:rotate-180" />}
                        {t("doubts.replies")}
                        <span className="rounded-md bg-neutral-100 px-1.5 text-2xs text-neutral-600">
                            {replyCount}
                        </span>
                    </button>
                    {showReplies && (
                        <div className="mt-2 flex flex-col gap-stack border-s border-neutral-200 ps-3">
                            {doubt.replies.map((reply, key) => (
                                <Reply
                                    key={reply.id || key}
                                    reply={reply}
                                    raiserUserId={doubt.user_id}
                                    viewerUserId={viewerUserId}
                                    authors={authors}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
