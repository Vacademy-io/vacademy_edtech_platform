import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { cn } from '@/lib/utils';
import { MODE_META } from '../../create/-utils/constants';
import type { Announcement } from '../-types';
import { humanize, initials, joinParts, wallClockParts, type DateParts } from '../-utils/format';

const ANNOUNCEMENT_TONE: Record<string, StatusType> = {
    ACTIVE: 'SUCCESS',
    DELIVERED: 'SUCCESS',
    SCHEDULED: 'WARNING',
    PENDING_APPROVAL: 'WARNING',
    REJECTED: 'DANGER',
    CANCELLED: 'DANGER',
};

export function AnnouncementStatusChip({ status }: { status?: string }) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (!status) return <span className="text-neutral-400">-</span>;
    return (
        <StatusChip
            text={t(`status.${status}`, { defaultValue: humanize(status) })}
            textSize="text-caption"
            status={ANNOUNCEMENT_TONE[status] ?? 'INFO'}
            showIcon={false}
        />
    );
}

const MESSAGE_TONE: Record<string, StatusType> = {
    DELIVERED: 'SUCCESS',
    READ: 'SUCCESS',
    PENDING: 'WARNING',
    FAILED: 'DANGER',
};

export function MessageStatusChip({ status }: { status?: string }) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (!status) return <span className="text-neutral-400">-</span>;
    return (
        <StatusChip
            text={t(`messageStatus.${status}`, { defaultValue: humanize(status) })}
            textSize="text-caption"
            status={MESSAGE_TONE[status] ?? 'INFO'}
            showIcon={false}
        />
    );
}

/** Mode / medium enums as readable chips ("System alert", "WhatsApp"). */
export function EnumChips({
    values,
    group,
    variant = 'secondary',
}: {
    values: string[];
    group: 'modes' | 'mediums';
    variant?: 'secondary' | 'outline';
}) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (values.length === 0) return <span className="text-neutral-400">-</span>;
    return (
        <div className="flex flex-wrap gap-1">
            {values.map((v) => (
                <Badge key={v} variant={variant} className="whitespace-nowrap font-regular">
                    {t(`${group}.${v}`, { defaultValue: humanize(v) })}
                </Badge>
            ))}
        </div>
    );
}

/**
 * One colour per display location, shared by the history table and the schedule calendar so a
 * placement reads the same everywhere. Categorical colours from the token families (each
 * placement also has its own icon, so colour is never the only cue).
 */
export const MODE_TONE: Record<string, { text: string; dot: string; event: string }> = {
    SYSTEM_ALERT: {
        text: 'text-danger-500',
        dot: 'bg-danger-500',
        event: 'border-danger-500 bg-danger-50',
    },
    DASHBOARD_PIN: {
        text: 'text-warning-500',
        dot: 'bg-warning-500',
        event: 'border-warning-500 bg-warning-50',
    },
    APP_OVERLAY: {
        text: 'text-primary-500',
        dot: 'bg-primary-500',
        event: 'border-primary-500 bg-primary-50',
    },
    DM: { text: 'text-info-500', dot: 'bg-info-500', event: 'border-info-500 bg-info-50' },
    STREAM: {
        text: 'text-success-600',
        dot: 'bg-success-600',
        event: 'border-success-600 bg-success-50',
    },
    RESOURCES: {
        text: 'text-info-700',
        dot: 'bg-info-700',
        event: 'border-info-700 bg-info-100',
    },
    COMMUNITY: {
        text: 'text-danger-300',
        dot: 'bg-danger-300',
        event: 'border-danger-300 bg-danger-50',
    },
    TASKS: {
        text: 'text-success-400',
        dot: 'bg-success-400',
        event: 'border-success-400 bg-success-100',
    },
};

const NEUTRAL_TONE = {
    text: 'text-neutral-500',
    dot: 'bg-neutral-400',
    event: 'border-neutral-400 bg-neutral-50',
};

export const modeTone = (mode?: string) => (mode && MODE_TONE[mode]) || NEUTRAL_TONE;

/** Display locations as small coloured icons, each named in its tooltip. */
export function ModeIcons({ values }: { values: string[] }) {
    const { t } = useTranslation('announcementHistoryIndex');
    if (values.length === 0) return <span className="text-neutral-400">-</span>;
    return (
        <span className="flex flex-wrap items-center gap-1.5">
            {values.map((v) => {
                const ModeIcon = MODE_META.find((m) => m.type === v)?.Icon;
                const label = t(`modes.${v}`, { defaultValue: humanize(v) });
                return ModeIcon ? (
                    <span key={v} title={label} aria-label={label} className={modeTone(v).text}>
                        <ModeIcon className="size-4" weight="duotone" />
                    </span>
                ) : (
                    <span key={v} className="text-caption text-neutral-600">
                        {label}
                    </span>
                );
            })}
        </span>
    );
}

/** Date on top, 12-hour time underneath. */
export function DateTimeStack({ parts }: { parts: DateParts | null }) {
    if (!parts) return <span className="text-neutral-400">-</span>;
    return (
        <div className="whitespace-nowrap">
            <div className="text-body text-neutral-700">{parts.date}</div>
            <div className="text-caption text-neutral-500">{parts.time}</div>
        </div>
    );
}

export function NameAvatar({
    name,
    muted = false,
    className,
}: {
    name: string;
    muted?: boolean;
    className?: string;
}) {
    return (
        <span
            aria-hidden
            className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold',
                muted ? 'bg-neutral-100 text-neutral-500' : 'bg-primary-50 text-primary-600',
                className
            )}
        >
            {initials(name)}
        </span>
    );
}

export function ScheduleSummary({ scheduling }: { scheduling: Announcement['scheduling'] }) {
    const { t } = useTranslation('announcementHistoryIndex');
    const type = scheduling?.scheduleType;
    if (!type) return <span className="text-neutral-400">-</span>;
    if (type === 'IMMEDIATE') return <span>{t('schedule.immediate')}</span>;
    if (type === 'ONE_TIME') {
        return (
            <div>
                <div>{t('schedule.oneTime')}</div>
                <div className="text-caption text-neutral-500">
                    {joinParts(wallClockParts(scheduling?.startDate))}
                </div>
            </div>
        );
    }
    const next = wallClockParts(scheduling?.nextRunTime);
    return (
        <div>
            <div>{t('schedule.recurring')}</div>
            <div className="text-caption text-neutral-500">
                {next
                    ? t('schedule.nextRun', { when: joinParts(next) })
                    : t('schedule.cron', { expr: scheduling?.cronExpression || '-' })}
            </div>
        </div>
    );
}
