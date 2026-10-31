import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarPlus, ChatCircle, UserPlus, UsersThree, VideoCamera } from "@phosphor-icons/react";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import iconMentors from "@/assets/cleaner-play/icon-mentors.webp";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MyButton } from "@/components/design-system/button";
import { getInstituteId } from "@/constants/helper";
import { getCurrentUserId } from "@/lib/auth/sessionUtility";
import { describeDirectChatError, openDirectConversation } from "@/services/chat/chatApi";
import { useChatEnabled } from "@/hooks/use-chat-enabled";
import {
    handleGetMentorDirectory,
    handleGetMyBookings,
    handleGetMyMentors,
    type MyBooking,
    type MyMentor,
} from "@/routes/my-mentors/-services/my-mentors-service";
import { MentorAvatar } from "@/routes/my-mentors/-components/MentorAvatar";

function fmtWhen(v?: string | number | null): string {
    if (v == null) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
    });
}

/**
 * Learner dashboard widget: the student's assigned mentors + their next upcoming
 * mentor session, with quick Book / Message. A student with no mentor yet gets a
 * prompt into the directory instead — but only when their institute actually lists
 * mentors, so the widget still self-hides where mentorship isn't in use.
 */
export function MyMentorsWidget() {
    const isPlay = usePlayTheme();
    const isCleanerPlay = useCleanerPlayTheme();
    const { t } = useTranslation("dashboard");
    const navigate = useNavigate();
    const [instituteId, setInstituteId] = useState<string | undefined>();
    const [userId, setUserId] = useState<string | undefined>();
    const [messagingId, setMessagingId] = useState<string | null>(null);
    // Chat is off by default institute-wide; without this the learner gets a
    // Message button whose only outcome is "Couldn't open the chat".
    const chat = useChatEnabled();

    useEffect(() => {
        getInstituteId().then((id) => setInstituteId(id ?? undefined));
        getCurrentUserId().then((id) => setUserId(id ?? undefined));
    }, []);

    const mentorsQuery = useQuery(handleGetMyMentors(instituteId));
    const bookingsQuery = useQuery(handleGetMyBookings(instituteId, userId));
    // Only asked for when there's nothing to show yet — a student who already has
    // a mentor never needs the directory to decide what this widget renders.
    const directoryQuery = useQuery({
        ...handleGetMentorDirectory(instituteId),
        enabled: !!instituteId && mentorsQuery.isSuccess && (mentorsQuery.data?.length ?? 0) === 0,
    });

    const mentors = (mentorsQuery.data ?? []) as MyMentor[];

    const nextSession = useMemo<MyBooking | undefined>(() => {
        const now = Date.now();
        return ((bookingsQuery.data ?? []) as MyBooking[])
            .filter(
                (b) =>
                    b.status !== "CANCELLED" &&
                    b.status !== "RESCHEDULED" &&
                    b.scheduled_start_utc != null &&
                    new Date(b.scheduled_start_utc).getTime() >= now
            )
            .sort(
                (a, b) =>
                    new Date(a.scheduled_start_utc as string).getTime() -
                    new Date(b.scheduled_start_utc as string).getTime()
            )[0];
    }, [bookingsQuery.data]);

    if (mentorsQuery.isLoading) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t("mentors.title")}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-stack">
                    {Array.from({ length: 2 }, (_, i) => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="h-9 w-9 rounded-full" />
                            <Skeleton className="h-4 w-32" />
                        </div>
                    ))}
                </CardContent>
            </Card>
        );
    }

    if (mentors.length === 0) {
        if ((directoryQuery.data?.length ?? 0) === 0) return null;
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        {isPlay || isCleanerPlay ? (
                            <img
                                src={iconMentors}
                                alt=""
                                aria-hidden="true"
                                className="h-8 w-8 object-contain"
                            />
                        ) : (
                            <UsersThree size={18} weight="duotone" className="text-primary-500" />
                        )}
                        {t("mentors.emptyStateTitle")}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-start gap-stack">
                    <p className="text-caption text-neutral-500">
                        {t("mentors.emptyStateBody")}
                    </p>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        onClick={() => navigate({ to: "/my-mentors" })}
                    >
                        <UserPlus size={16} /> {t("mentors.findMentorButton")}
                    </MyButton>
                </CardContent>
            </Card>
        );
    }

    const book = (m: MyMentor) => {
        if (!m.booking_page_slug || !instituteId) return;
        navigate({
            to: "/booking-response",
            search: { instituteId, slug: m.booking_page_slug, authed: "1" },
        });
    };

    const message = async (m: MyMentor) => {
        setMessagingId(m.user_id);
        try {
            const conv = await openDirectConversation({
                targetUserId: m.user_id,
                targetUserName: m.name ?? undefined,
                targetUserRole: "TEACHER",
            });
            navigate({ to: "/chat", search: { conversationId: conv.id } });
        } catch (error) {
            // A 403 here is permanent (chat off, or a role pair the institute
            // forbids) — "try again" would be a lie.
            toast.error(
                describeDirectChatError(
                    error,
                    t("mentors.chatOpenError"),
                ),
            );
        } finally {
            setMessagingId(null);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    {isPlay || isCleanerPlay ? (
                        <img
                            src={iconMentors}
                            alt=""
                            aria-hidden="true"
                            className="h-8 w-8 object-contain"
                        />
                    ) : (
                        <UsersThree size={18} weight="duotone" className="text-primary-500" />
                    )}
                    {t("mentors.title")}
                </CardTitle>
                <button
                    type="button"
                    onClick={() => navigate({ to: "/my-mentors" })}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                    {t("mentors.viewAll")}
                </button>
            </CardHeader>
            <CardContent className="flex flex-col gap-stack">
                {nextSession && (
                    <div className="flex flex-col gap-1 rounded-lg border border-primary-200 bg-primary-50 p-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-primary-600">
                            {t("mentors.nextSession")}
                        </span>
                        <span className="text-sm font-medium text-neutral-700">
                            {nextSession.booking_page_title || nextSession.host_name || t("mentors.mentorSessionFallback")}
                        </span>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-neutral-500">
                                {fmtWhen(nextSession.scheduled_start_utc)}
                            </span>
                            {nextSession.meet_link ? (
                                <a
                                    href={nextSession.meet_link}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-1 text-xs font-medium text-primary-600"
                                >
                                    <VideoCamera size={14} /> {t("hero.join")}
                                </a>
                            ) : (
                                // The link is minted after the booking commits, so a fresh
                                // booking can have none yet. Saying so beats a row that
                                // silently offers no way in.
                                <span
                                    className="text-xs text-neutral-400"
                                    title={t("mentors.linkPendingTooltip")}
                                >
                                    {t("mentors.linkComingSoon")}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                {mentors.slice(0, 3).map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <MentorAvatar
                                fileId={m.profile_image_file_id || m.profile_pic_file_id}
                                name={m.display_name || m.name}
                                className="size-9 text-xs"
                            />
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-sm font-medium text-neutral-700">
                                    {m.display_name || m.name || t("mentors.mentorFallbackName")}
                                </span>
                                {m.title && (
                                    <span className="truncate text-xs text-neutral-400">{m.title}</span>
                                )}
                            </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                layoutVariant="icon"
                                onClick={() => book(m)}
                                disable={!m.booking_page_slug}
                            >
                                <CalendarPlus size={16} />
                            </MyButton>
                            {chat.enabled && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    layoutVariant="icon"
                                    onClick={() => message(m)}
                                    disable={messagingId === m.user_id}
                                >
                                    <ChatCircle size={16} />
                                </MyButton>
                            )}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
