import { useTranslation } from 'react-i18next';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import type { BookingInstanceDTO } from '../-types/meetings-types';

/** Card key → the booking status it counts (null = every meeting shown). */
const CARDS: Array<{
    key: string;
    labelKey: string;
    status: string | null;
    tone?: QuickView['tone'];
}> = [
    { key: 'all', labelKey: 'meetings.week.all', status: null },
    {
        key: 'confirmed',
        labelKey: 'meetings.week.confirmed',
        status: 'CONFIRMED',
        tone: 'success',
    },
    { key: 'pending', labelKey: 'meetings.week.pending', status: 'PENDING', tone: 'warning' },
    {
        key: 'rescheduled',
        labelKey: 'meetings.week.rescheduled',
        status: 'RESCHEDULED',
        tone: 'info',
    },
    {
        key: 'cancelled',
        labelKey: 'meetings.week.cancelled',
        status: 'CANCELLED',
        tone: 'danger',
    },
];

/**
 * Status counts for the meetings already on screen (the week or month shown), for
 * My Schedule and Team Meetings. No extra request.
 *
 * Pass `onSelect` to make the cards filter the list below: it receives the card's
 * status (null for "all"), and `active` is the status currently filtered on.
 */
export function MeetingsWeekCounts({
    bookings,
    active,
    onSelect,
}: {
    bookings: BookingInstanceDTO[] | undefined;
    active?: string | null;
    onSelect?: (status: string | null) => void;
}) {
    const { t } = useTranslation('crmPages');
    if (!bookings) return null;
    const n = (s: string) => bookings.filter((b) => b.status === s).length;
    return (
        <QuickViews
            caption={t('meetings.weekCaption')}
            views={CARDS.map((c) => ({
                key: c.key,
                label: t(c.labelKey),
                count: c.status ? n(c.status) : bookings.length,
                tone: c.tone,
                active: onSelect ? (active ?? null) === c.status : undefined,
                onSelect: onSelect ? () => onSelect(c.status) : undefined,
            }))}
        />
    );
}
