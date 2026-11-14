import { useMemo, useState } from "react";
import {
    CalendarBlank,
    CalendarX,
    CheckCircle,
    Clock,
    Star,
    UserMinus,
    VideoCamera,
    XCircle,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { MyButton } from "@/components/design-system/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/design-system/states";
import { ModernCard, ModernCardContent } from "@/components/design-system/modern-card";
import { MentorAvatar } from "./MentorAvatar";
import { ManageSessionDialog } from "./ManageSessionDialog";
import type { MyMentor, MyMentorSession } from "../-services/my-mentors-service";
import { isManageable, sessionStatusLabel, sessionWhen, splitSessions } from "../-utils/sessions";

/**
 * The learner's own 1:1s — what's booked, and what they can do about it.
 *
 * Rescheduling and cancelling used to exist only behind the manage-token link in the
 * confirmation email, which meant a learner who lost that email had no way to move a
 * session. This is the same two operations, reachable from the app.
 */
export function MySessionsTab({
    instituteId,
    sessions,
    mentors,
    isLoading,
    isError,
    onRetry,
    onFindMentor,
}: {
    instituteId: string | undefined;
    sessions: MyMentorSession[];
    /** Used to resolve a session's mentor back to their booking slug for rescheduling. */
    mentors: MyMentor[];
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    onFindMentor: () => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const [acting, setActing] = useState<{
        session: MyMentorSession;
        action: "cancel" | "reschedule";
    } | null>(null);

    const { upcoming, past } = useMemo(() => splitSessions(sessions), [sessions]);
    const slugByMentorId = useMemo(() => {
        const map: Record<string, string> = {};
        for (const m of mentors) {
            if (m.booking_page_slug) map[m.id] = m.booking_page_slug;
        }
        return map;
    }, [mentors]);

    if (isLoading) return <LoadingState variant="list" count={3} />;
    if (isError)
        return <ErrorState message={t("myMentors.sessionsTab.loadError")} onRetry={onRetry} />;
    if (sessions.length === 0) {
        return (
            <EmptyState
                icon={CalendarBlank}
                title={t("myMentors.sessionsTab.empty.title")}
                description={t("myMentors.sessionsTab.empty.description")}
                action={{ label: t("myMentors.page.findMentor"), onClick: onFindMentor }}
            />
        );
    }

    return (
        <div className="flex flex-col gap-section">
            <section className="flex flex-col gap-stack">
                <h2 className="text-body font-semibold text-neutral-700">
                    {t("myMentors.sessionsTab.upcoming")}
                    <span className="ms-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption font-medium text-neutral-500">
                        {upcoming.length}
                    </span>
                </h2>
                {upcoming.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-neutral-200 p-6 text-center text-caption text-neutral-500">
                        {t("myMentors.sessionsTab.nothingBooked")}
                    </p>
                ) : (
                    upcoming.map((s) => (
                        <SessionRow
                            key={s.booking_instance_id}
                            session={s}
                            onCancel={() => setActing({ session: s, action: "cancel" })}
                            onReschedule={() => setActing({ session: s, action: "reschedule" })}
                        />
                    ))
                )}
            </section>

            {past.length > 0 && (
                <section className="flex flex-col gap-stack">
                    <h2 className="text-body font-semibold text-neutral-700">
                        {t("myMentors.sessionsTab.past")}
                    </h2>
                    {past.map((s) => (
                        <SessionRow key={s.booking_instance_id} session={s} />
                    ))}
                </section>
            )}

            <ManageSessionDialog
                session={acting?.session ?? null}
                action={acting?.action ?? null}
                instituteId={instituteId}
                mentorSlug={acting?.session.mentor_id ? slugByMentorId[acting.session.mentor_id] : null}
                onOpenChange={(open) => {
                    if (!open) setActing(null);
                }}
            />
        </div>
    );
}

function SessionRow({
    session,
    onCancel,
    onReschedule,
}: {
    session: MyMentorSession;
    onCancel?: () => void;
    onReschedule?: () => void;
}) {
    const { t } = useTranslation("miscRoutesA");
    const manageable = isManageable(session) && !!onCancel && !!onReschedule;
    return (
        <ModernCard variant="default" padding="md" rounded="lg">
            <ModernCardContent>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <MentorAvatar
                            fileId={null}
                            name={session.mentor_name}
                            className="size-10 shrink-0 text-body"
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-body font-semibold text-neutral-700">
                                {session.mentor_name || t("myMentors.common.yourMentor")}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {sessionWhen(session.scheduled_start_utc)}
                                {session.duration_minutes
                                    ? ` · ${t("myMentors.sessionsTab.durationMinutes", {
                                          count: session.duration_minutes,
                                      })}`
                                    : ""}
                            </span>
                            {session.topic && (
                                <span className="truncate text-caption text-neutral-400">
                                    {session.topic}
                                </span>
                            )}
                            {typeof session.rating === "number" && (
                                <span className="flex items-center gap-1 text-caption text-warning-700">
                                    <Star size={12} weight="fill" className="text-warning-500" />
                                    {t("myMentors.sessionsTab.youRated", { rating: session.rating })}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        <SessionStatusBadge lifecycle={session.lifecycle} />
                        <div className="flex flex-wrap justify-end gap-2">
                            {session.meet_link && session.lifecycle === "UPCOMING" && (
                                <a
                                    href={session.meet_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <MyButton type="button" buttonType="primary" scale="small">
                                        <VideoCamera size={16} /> {t("myMentors.sessionsTab.join")}
                                    </MyButton>
                                </a>
                            )}
                            {manageable && (
                                <>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={onReschedule}
                                    >
                                        <Clock size={16} /> {t("myMentors.sessionsTab.reschedule")}
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={onCancel}
                                    >
                                        <CalendarX size={16} /> {t("myMentors.sessionsTab.cancel")}
                                    </MyButton>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </ModernCardContent>
        </ModernCard>
    );
}

/** One word for a session's state, coloured by whether it needs the learner. */
function SessionStatusBadge({ lifecycle }: { lifecycle: string }) {
    const { t } = useTranslation("miscRoutesA");
    const map: Record<string, { tone: string; icon: React.ReactNode }> = {
        UPCOMING: {
            tone: "bg-info-50 text-info-600",
            icon: <CalendarBlank size={12} weight="fill" />,
        },
        AWAITING_REVIEW: {
            tone: "bg-warning-50 text-warning-700",
            icon: <Clock size={12} weight="fill" />,
        },
        COMPLETED: {
            tone: "bg-success-50 text-success-600",
            icon: <CheckCircle size={12} weight="fill" />,
        },
        NO_SHOW: {
            tone: "bg-danger-50 text-danger-600",
            icon: <UserMinus size={12} weight="fill" />,
        },
        CANCELLED: {
            tone: "bg-neutral-100 text-neutral-500",
            icon: <XCircle size={12} weight="fill" />,
        },
        RESCHEDULED: {
            tone: "bg-neutral-100 text-neutral-500",
            icon: <Clock size={12} weight="fill" />,
        },
    };
    const labels: Record<string, string> = {
        UPCOMING: t("myMentors.sessionsTab.status.upcoming"),
        AWAITING_REVIEW: t("myMentors.sessionsTab.status.awaitingReview"),
        COMPLETED: t("myMentors.sessionsTab.status.completed"),
        NO_SHOW: t("myMentors.sessionsTab.status.noShow"),
        CANCELLED: t("myMentors.sessionsTab.status.cancelled"),
        RESCHEDULED: t("myMentors.sessionsTab.status.rescheduled"),
    };
    const entry = map[lifecycle] ?? { tone: "bg-neutral-100 text-neutral-500", icon: null };
    return (
        <span
            className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-caption ${entry.tone}`}
        >
            {entry.icon}
            {labels[lifecycle] ?? sessionStatusLabel(lifecycle)}
        </span>
    );
}
