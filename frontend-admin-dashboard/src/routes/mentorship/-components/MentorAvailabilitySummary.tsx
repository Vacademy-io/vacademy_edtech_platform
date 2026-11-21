import { CalendarCheck } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export const DAY_ORDER = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
] as const;

export interface AvailabilityPage {
    availability?: {
        weekly_windows?: { day_of_week: string; start_time: string; end_time: string }[];
    } | null;
    duration_minutes?: number | null;
    timezone?: string | null;
}

/** Weekly hours in day order, plus the settings that decide what learners can pick. */
export function AvailabilitySummary({ page }: { page?: AvailabilityPage | null }) {
    const { t } = useTranslation('mentorshipMentorAvailabilitySummary');
    const windows = page?.availability?.weekly_windows ?? [];
    if (windows.length === 0) {
        return <p className="text-caption text-neutral-400">{t('noHoursSet')}</p>;
    }
    const byDay = DAY_ORDER.map((day) => ({
        day,
        ranges: windows.filter((w) => w.day_of_week === day),
    })).filter((d) => d.ranges.length > 0);

    return (
        <div className="flex flex-col gap-1">
            {byDay.map(({ day, ranges }) => (
                <div key={day} className="flex items-center gap-2 text-caption">
                    <span className="w-24 shrink-0 capitalize text-neutral-500">
                        {t(`days.${day.toLowerCase()}`)}
                    </span>
                    <span className="text-neutral-700">
                        {ranges.map((r) => `${r.start_time}–${r.end_time}`).join(', ')}
                    </span>
                </div>
            ))}
            <span className="mt-1 flex items-center gap-1.5 text-caption text-neutral-400">
                <CalendarCheck size={12} />
                {page?.duration_minutes
                    ? t('sessionDuration', { count: page.duration_minutes })
                    : t('defaultLength')}
                {page?.timezone ? ` · ${page.timezone}` : ''}
            </span>
        </div>
    );
}
