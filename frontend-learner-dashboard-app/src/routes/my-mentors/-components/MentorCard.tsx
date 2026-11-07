import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarPlus, ChatCircle } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { reportApiError } from "@/lib/report-api-error";
import { MyButton } from "@/components/design-system/button";
import { ModernCard, ModernCardContent } from "@/components/design-system/modern-card";
import { describeDirectChatError, openDirectConversation } from "@/services/chat/chatApi";
import { useChatEnabled } from "@/hooks/use-chat-enabled";
import type { MyMentor } from "../-services/my-mentors-service";
import { MentorAvatar } from "./MentorAvatar";

export function MentorCard({
    mentor,
    instituteId,
}: {
    mentor: MyMentor;
    instituteId: string | undefined;
}) {
    const { t } = useTranslation("miscRoutesA");
    const navigate = useNavigate();
    const [messaging, setMessaging] = useState(false);
    const canBook = !!mentor.booking_page_slug && !!instituteId;
    // Chat is off by default institute-wide; without this the learner gets a
    // Message button whose only outcome is "Couldn't open the chat".
    const chat = useChatEnabled();

    const book = () => {
        if (!mentor.booking_page_slug || !instituteId) return;
        navigate({
            to: "/booking-response",
            search: { instituteId, slug: mentor.booking_page_slug, authed: "1" },
        });
    };

    // Opens the full In-App Messages screen with this mentor's conversation
    // selected — same surface as the chat tab.
    const message = async () => {
        setMessaging(true);
        try {
            const conv = await openDirectConversation({
                targetUserId: mentor.user_id,
                targetUserName: mentor.display_name || mentor.name || undefined,
                targetUserRole: "TEACHER",
            });
            navigate({ to: "/chat", search: { conversationId: conv.id } });
        } catch (error) {
            reportApiError(error, {
                feature: "mentorship",
                tags: { "mentorship.action": "open-mentor-chat" },
                extra: { mentorUserId: mentor.user_id },
                // A 403 here is permanent (chat off, or a role pair the institute
                // forbids) — "try again" would be a lie.
                fallbackMessage: describeDirectChatError(
                    error,
                    t("myMentors.mentorCard.chatOpenFailed"),
                ),
            });
        } finally {
            setMessaging(false);
        }
    };

    return (
        <ModernCard variant="default" padding="md" rounded="lg">
            <ModernCardContent>
                <div className="flex h-full flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <MentorAvatar
                            fileId={mentor.profile_image_file_id || mentor.profile_pic_file_id}
                            name={mentor.display_name || mentor.name}
                            className="size-12 text-title"
                        />
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate text-body font-semibold text-neutral-700">
                                {mentor.display_name || mentor.name || t("myMentors.common.mentor")}
                            </span>
                            {mentor.title && (
                                <span className="truncate text-caption text-neutral-500">
                                    {mentor.title}
                                </span>
                            )}
                        </div>
                    </div>

                    {(mentor.expertise_tags?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {mentor.expertise_tags?.slice(0, 4).map((tag) => (
                                <span
                                    key={tag}
                                    className="rounded-full bg-primary-50 px-2.5 py-1 text-caption text-primary-600"
                                >
                                    {tag}
                                </span>
                            ))}
                            {(mentor.expertise_tags?.length ?? 0) > 4 && (
                                <span
                                    className="rounded-full bg-neutral-100 px-2.5 py-1 text-caption text-neutral-500"
                                    title={mentor.expertise_tags?.slice(4).join(", ")}
                                >
                                    +{(mentor.expertise_tags?.length ?? 0) - 4}
                                </span>
                            )}
                        </div>
                    )}

                    {mentor.bio && (
                        <p className="line-clamp-3 text-caption text-neutral-500">{mentor.bio}</p>
                    )}

                    <div className="mt-auto flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                onClick={book}
                                disable={!canBook}
                                className="flex-1"
                            >
                                <CalendarPlus size={16} /> {t("myMentors.mentorCard.bookSession")}
                            </MyButton>
                            {chat.enabled && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={message}
                                    disable={messaging}
                                    className="flex-1"
                                >
                                    <ChatCircle size={16} /> {t("myMentors.mentorCard.message")}
                                </MyButton>
                            )}
                        </div>
                        {!canBook && (
                            <span className="text-caption text-neutral-400">
                                {t("myMentors.mentorCard.bookingNotSetUp")}
                            </span>
                        )}
                    </div>
                </div>
            </ModernCardContent>
        </ModernCard>
    );
}
