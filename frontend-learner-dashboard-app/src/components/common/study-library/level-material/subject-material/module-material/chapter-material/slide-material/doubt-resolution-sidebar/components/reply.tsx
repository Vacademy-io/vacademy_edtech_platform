import { useState } from "react";
import { Doubt } from "../types/get-doubts-type";
import { CaretDown, CaretRight, GraduationCap } from "@phosphor-icons/react";
import { formatISODateTimeReadable, formatRelativeTime } from "@/helpers/formatISOTime";
import { useTranslation } from "react-i18next";
import { DoubtAuthorMap } from "../hooks/useDoubtAuthors";
import { DoubtAvatar } from "./DoubtAvatar";
import { DoubtBadge } from "./DoubtBadge";

interface ReplyProps {
    reply: Doubt;
    /**
     * User id of the original doubt's author. When the replier is not this user and not the
     * viewer, we treat them as a teacher/admin and label accordingly — so the student clearly
     * sees who answered.
     */
    raiserUserId?: string;
    /** Viewer's user id, resolved once by the panel (not per reply). */
    viewerUserId?: string | null;
    /**
     * Names + avatars for the whole thread, fetched in one batch by the panel. Optional so a
     * caller that has no author map (e.g. the "My Queries" list) degrades to the name carried on
     * the reply itself instead of throwing on `authors[reply.user_id]`.
     */
    authors?: DoubtAuthorMap;
}

export const Reply = ({ reply, raiserUserId, viewerUserId, authors = {} }: ReplyProps) => {
    const { t, i18n } = useTranslation("studyContent");
    const [showNested, setShowNested] = useState<boolean>(true);

    const author = authors[reply.user_id];
    const isSelf = !!viewerUserId && reply.user_id === viewerUserId;
    const isRaiser = !!raiserUserId && reply.user_id === raiserUserId;
    const isStaffAnswer = !isSelf && !isRaiser;

    const displayName =
        author?.name || reply.name || (isStaffAnswer ? t("doubts.roleTeacher") : t("doubts.roleUser"));

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <DoubtAvatar name={displayName} url={author?.avatarUrl} className="size-6" />
                <p className="truncate text-caption font-semibold text-neutral-900">{displayName}</p>
                {isStaffAnswer ? (
                    <DoubtBadge tone="info" icon={<GraduationCap size={11} weight="fill" />}>
                        {t("doubts.roleTeacher")}
                    </DoubtBadge>
                ) : isSelf ? (
                    <DoubtBadge tone="neutral">{t("doubts.roleYou")}</DoubtBadge>
                ) : null}
                <span
                    className="ms-auto shrink-0 text-2xs text-neutral-400"
                    title={formatISODateTimeReadable(reply.raised_time)}
                >
                    {formatRelativeTime(reply.raised_time, i18n.language)}
                </span>
            </div>

            <div
                dangerouslySetInnerHTML={{ __html: reply.html_text || "" }}
                className="rich-text-content doubt-html text-body text-neutral-700"
            />

            {reply.replies?.length > 0 && (
                <div className="flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={() => setShowNested((prev) => !prev)}
                        className="flex w-fit items-center gap-1 rounded-md py-0.5 text-2xs font-semibold text-neutral-500 transition-colors hover:text-neutral-700"
                    >
                        {showNested ? <CaretDown size={12} /> : <CaretRight size={12} />}
                        {t("doubts.replies")} · {reply.replies.length}
                    </button>
                    {showNested && (
                        <div className="flex flex-col gap-stack border-s border-neutral-200 ps-3">
                            {reply.replies.map((subReply, key) => (
                                <Reply
                                    key={subReply.id || key}
                                    reply={subReply}
                                    raiserUserId={raiserUserId}
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
