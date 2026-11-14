import { useMemo, useState } from 'react';
import { CalendarBlank, CalendarX, Clock, VideoCamera } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { useMySchedule } from '../-hooks/use-mentorship';
import { SessionActionDialog } from './SessionActionDialog';
import type { BookingInstance, MentorSessionDTO } from '../-types/mentorship-types';

const ymd = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const startMs = (b: BookingInstance): number => {
    if (b.scheduled_start_utc == null) return Number.MAX_SAFE_INTEGER;
    const d = new Date(b.scheduled_start_utc);
    return Number.isNaN(d.getTime()) ? Number.MAX_SAFE_INTEGER : d.getTime();
};

const fmtWhen = (v?: string | number | null): string => {
    if (v == null) return '';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const isToday = (v?: string | number | null): boolean => {
    if (v == null) return false;
    const d = new Date(v);
    const now = new Date();
    return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
    );
};

/**
 * The schedule card reads the booking module's calendar feed, but cancel/reschedule
 * speak the mentorship session shape. This carries across only the fields the action
 * dialog actually uses; nothing here is persisted, so the rest can stay empty.
 */
const asSession = (b: BookingInstance): MentorSessionDTO => {
    const start = b.scheduled_start_utc == null ? null : new Date(b.scheduled_start_utc).getTime();
    const end = b.scheduled_end_utc == null ? null : new Date(b.scheduled_end_utc).getTime();
    return {
        booking_instance_id: b.id,
        title: b.booking_page_title,
        scheduled_start_utc: start != null && !Number.isNaN(start) ? start : null,
        scheduled_end_utc: end != null && !Number.isNaN(end) ? end : null,
        duration_minutes:
            start != null && end != null && !Number.isNaN(start) && !Number.isNaN(end)
                ? Math.round((end - start) / 60000)
                : null,
        booking_status: b.status,
        meet_link: b.meet_link,
        student_name: b.invitee_name,
        lifecycle: 'UPCOMING',
    };
};

interface MyScheduleCardProps {
    instituteId: string | undefined;
}

/** The mentor's own upcoming 1:1 sessions across all mentees (today + next 30 days). */
export function MyScheduleCard({ instituteId }: MyScheduleCardProps) {
    const { t } = useTranslation('mentorshipMyScheduleCard');
    const { startDate, endDate } = useMemo(() => {
        const now = new Date();
        const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        return { startDate: ymd(now), endDate: ymd(end) };
    }, []);

    const { data, isLoading } = useMySchedule(instituteId, startDate, endDate);
    const [acting, setActing] = useState<{
        session: MentorSessionDTO;
        action: 'cancel' | 'reschedule';
    } | null>(null);

    const sessions = useMemo(
        () =>
            (data ?? [])
                .filter((b) => b.status !== 'CANCELLED' && b.status !== 'RESCHEDULED')
                .sort((a, b) => startMs(a) - startMs(b))
                .slice(0, 12),
        [data]
    );

    if (!isLoading && sessions.length === 0) return null;

    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
                <CalendarBlank size={18} weight="bold" className="text-primary-600" />
                <span className="text-body font-semibold text-neutral-700">{t('heading')}</span>
            </div>
            {isLoading ? (
                <div className="py-4 text-caption text-neutral-400">{t('loading')}</div>
            ) : (
                <div className="flex flex-col divide-y divide-neutral-100">
                    {sessions.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="flex min-w-0 flex-col">
                                <span className="flex items-center gap-2 text-body text-neutral-700">
                                    <span className="truncate font-medium">
                                        {s.invitee_name || t('learnerFallback')}
                                    </span>
                                    {isToday(s.scheduled_start_utc) && (
                                        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-600">
                                            {t('todayBadge')}
                                        </span>
                                    )}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {fmtWhen(s.scheduled_start_utc)}
                                    {s.status && s.status !== 'CONFIRMED' ? ` · ${s.status}` : ''}
                                </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                {s.meet_link ? (
                                    <a
                                        href={s.meet_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 px-2 text-caption font-medium text-primary-500 hover:text-primary-600"
                                    >
                                        <VideoCamera size={16} /> {t('joinButton')}
                                    </a>
                                ) : (
                                    // Meet links are minted after the booking commits, so a
                                    // brand-new session can legitimately have none yet — and a
                                    // row with no control at all reads as broken.
                                    <span
                                        className="px-2 text-caption text-neutral-400"
                                        title={t('linkPendingTitle')}
                                    >
                                        {t('linkPendingLabel')}
                                    </span>
                                )}
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    layoutVariant="icon"
                                    onClick={() =>
                                        setActing({ session: asSession(s), action: 'reschedule' })
                                    }
                                    aria-label={t('rescheduleAriaLabel', {
                                        name: s.invitee_name || t('thisLearnerFallback'),
                                    })}
                                    title={t('rescheduleTitle')}
                                >
                                    <Clock size={16} />
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    layoutVariant="icon"
                                    onClick={() =>
                                        setActing({ session: asSession(s), action: 'cancel' })
                                    }
                                    aria-label={t('cancelAriaLabel', {
                                        name: s.invitee_name || t('thisLearnerFallback'),
                                    })}
                                    title={t('cancelTitle')}
                                >
                                    <CalendarX size={16} className="text-danger-500" />
                                </MyButton>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <SessionActionDialog
                session={acting?.session ?? null}
                action={acting?.action ?? null}
                instituteId={instituteId}
                // A mentor acting on their own session: the server refuses anything
                // they don't host, whatever this says.
                asAdmin={false}
                onOpenChange={(o) => {
                    if (!o) setActing(null);
                }}
            />
        </div>
    );
}
