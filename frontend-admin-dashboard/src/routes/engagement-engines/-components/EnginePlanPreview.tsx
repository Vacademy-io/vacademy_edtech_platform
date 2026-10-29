import type { Icon } from '@phosphor-icons/react';
import {
    ArrowsClockwise,
    CalendarCheck,
    ChatCircleText,
    Clock,
    FlagCheckered,
    HandPalm,
    Lightning,
    Path,
    ThumbsDown,
    Trophy,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { QuietHours } from '../-types';
import { cadenceText, sendWindowText } from '../-utils';
import { Chip, IconTile } from './engine-ui';

/** Follow-ups shown after the first touch; the rest is summed up in one "and so on" row. */
const FOLLOW_UPS_SHOWN = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
/** ISO day of week, 1 = Monday. */
const isoDay = (d: Date) => ((d.getDay() + 6) % 7) + 1;

interface PlanStep {
    /** Days after joining, 0 = the day they join. */
    offset: number;
    iso: number;
    first: boolean;
    /** The first touch goes within minutes of joining. */
    immediate: boolean;
}

/**
 * The engine's rhythm for one person who joins today: the first touch, then one follow-up per
 * cadence, each moved to the next day the engine sends on. Mirrors the backend scheduling
 * (EngagementSendSchedule / PolicyGate.scheduleSend); display only.
 */
export function computePlan(cadenceHours: number, qh: QuietHours, start: Date = new Date()): PlanStep[] {
    const days = qh.days?.length ? qh.days : [1, 2, 3, 4, 5, 6, 7];
    const allowed = (offset: number) => days.includes(isoDay(new Date(start.getTime() + offset * DAY_MS)));
    const nextAllowed = (offset: number) => {
        let o = offset;
        for (let i = 0; i < 7 && !allowed(o); i++) o++;
        return o;
    };
    const step = (offset: number, first: boolean, immediate: boolean): PlanStep => ({
        offset,
        iso: isoDay(new Date(start.getTime() + offset * DAY_MS)),
        first,
        immediate,
    });
    const immediate = qh.firstTouch !== 'SCHEDULED';
    // Waiting for the send window: today's when it is still ahead (or open), else tomorrow's.
    const minutesNow = start.getHours() * 60 + start.getMinutes();
    const windowEnd = qh.sendHour != null ? qh.sendHour * 60 + (qh.sendMinute ?? 0) + 60 : 24 * 60;
    const firstOffset = nextAllowed(immediate || minutesNow < windowEnd ? 0 : 1);
    const plan = [step(firstOffset, true, immediate && firstOffset === 0)];
    const gapDays = Math.max(1, Math.ceil(Math.max(1, cadenceHours) / 24));
    let offset = firstOffset;
    for (let i = 0; i < FOLLOW_UPS_SHOWN; i++) {
        offset = nextAllowed(offset + gapDays);
        plan.push(step(offset, false, false));
    }
    return plan;
}

/**
 * "How this engine reaches each person": a day-by-day preview of the first touch and follow-ups,
 * what happens on a reply, and what ends the engine's work for a person.
 */
export function EnginePlanPreview({
    cadenceHours,
    schedule,
    channelLabels,
    stopOnMeeting,
    autoReply,
    bookingPageTitle,
    className,
}: {
    cadenceHours: number;
    schedule: QuietHours;
    channelLabels: string[];
    stopOnMeeting: boolean;
    /** WhatsApp "Reply on its own" is on. */
    autoReply: boolean;
    /** The engine books a meeting here when a lead asks for one; unset = it doesn't book. */
    bookingPageTitle?: string;
    className?: string;
}) {
    const { t } = useTranslation('engagementEnginesConstants');
    const plan = computePlan(cadenceHours, schedule);
    const windowText = sendWindowText(schedule, t);
    const channels = channelLabels.length ? channelLabels.join(', ') : t('plan.noChannels');
    const quiet =
        schedule.startHour != null && schedule.endHour != null && schedule.startHour !== schedule.endHour
            ? t('plan.quiet', {
                  from: `${String(schedule.startHour).padStart(2, '0')}:00`,
                  to: `${String(schedule.endHour).padStart(2, '0')}:00`,
              })
            : null;

    const stops: { icon: Icon; label: string }[] = [
        ...(stopOnMeeting ? [{ icon: CalendarCheck, label: t('plan.stop.meeting') }] : []),
        { icon: Trophy, label: t('plan.stop.converted') },
        { icon: ThumbsDown, label: t('plan.stop.notInterested') },
        { icon: HandPalm, label: t('plan.stop.optOut') },
    ];

    return (
        <section
            className={cn('flex flex-col gap-4 rounded-xl border border-primary-200 bg-primary-50 p-4', className)}
            aria-label={t('plan.title')}
        >
            <div className="flex items-start gap-3">
                <IconTile icon={Path} size="sm" />
                <span className="flex min-w-0 flex-col">
                    <span className="font-semibold text-neutral-800">
                        <span className="text-subtitle">{t('plan.title')}</span>
                    </span>
                    <span className="text-neutral-600">
                        <span className="text-caption">{t('plan.subtitle')}</span>
                    </span>
                </span>
            </div>

            <ol className="flex flex-col rounded-lg bg-white p-3">
                {plan.map((s, i) => (
                    <li key={`${s.offset}-${i}`} className="flex gap-3">
                        <span className="flex w-16 shrink-0 flex-col items-end pt-1 text-right">
                            <span className="font-semibold text-neutral-800">
                                <span className="text-caption">{t('plan.day', { n: s.offset + 1 })}</span>
                            </span>
                            <span className="text-neutral-500">
                                <span className="text-caption">{t(`schedule.day.${s.iso}`)}</span>
                            </span>
                        </span>
                        <span className="flex flex-col items-center">
                            <IconTile
                                icon={s.first ? Lightning : ArrowsClockwise}
                                size="sm"
                                tint={s.first ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-600'}
                            />
                            <span className="my-1 w-px flex-1 bg-neutral-200" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1 pb-4">
                            <span className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-neutral-800">
                                    <span className="text-body">
                                        {s.first ? t('plan.firstTouch') : t('plan.followUp', { n: i })}
                                    </span>
                                </span>
                                <Chip
                                    icon={Clock}
                                    label={s.immediate ? t('plan.withinMinutes') : windowText}
                                    className="bg-primary-50 text-primary-600"
                                />
                            </span>
                            <span className="text-neutral-600">
                                <span className="text-caption">
                                    {s.first
                                        ? t('plan.firstTouchText', { channels })
                                        : t('plan.followUpText')}
                                </span>
                            </span>
                        </span>
                    </li>
                ))}
                <li className="flex gap-3">
                    <span className="w-16 shrink-0" />
                    <IconTile icon={FlagCheckered} size="sm" tint="bg-success-50 text-success-600" />
                    <span className="flex min-w-0 flex-1 flex-col pt-1">
                        <span className="text-neutral-700">
                            <span className="text-caption">
                                {t('plan.andSoOn', { cadence: cadenceText(cadenceHours, t).toLowerCase() })}
                            </span>
                        </span>
                    </span>
                </li>
            </ol>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-lg bg-white p-3">
                    <span className="flex items-center gap-2 font-semibold text-neutral-800">
                        <ChatCircleText size={16} weight="duotone" className="text-info-600" />
                        <span className="text-caption">{t('plan.replyTitle')}</span>
                    </span>
                    <span className="text-neutral-600">
                        <span className="text-caption">
                            {autoReply ? t('plan.replyAuto') : t('plan.replyInbox')}
                            {bookingPageTitle ? ` ${t('plan.replyBooks', { page: bookingPageTitle })}` : ''}
                        </span>
                    </span>
                </div>
                <div className="flex flex-col gap-2 rounded-lg bg-white p-3">
                    <span className="flex items-center gap-2 font-semibold text-neutral-800">
                        <FlagCheckered size={16} weight="duotone" className="text-success-600" />
                        <span className="text-caption">{t('plan.stopTitle')}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                        {stops.map((s) => (
                            <Chip key={s.label} icon={s.icon} label={s.label} />
                        ))}
                    </span>
                </div>
            </div>

            <p className="text-neutral-500">
                <span className="text-caption">{[t('plan.capNote'), quiet].filter(Boolean).join(' ')}</span>
            </p>
        </section>
    );
}
