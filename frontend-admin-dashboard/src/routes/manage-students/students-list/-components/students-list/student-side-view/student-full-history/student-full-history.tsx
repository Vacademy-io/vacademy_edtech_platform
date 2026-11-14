import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { handleFetchStudentTimeline } from '@/routes/admissions/-services/timeline-services';
import type { TimelineEvent } from '@/routes/admissions/-services/timeline-services';
import { cn } from '@/lib/utils';
import {
    ClipboardText,
    ClockCounterClockwise,
    NotePencil,
    ArrowsClockwise,
    User,
    ArrowRight,
    Phone,
    EnvelopeSimple,
    CurrencyCircleDollar,
    CalendarCheck,
    GitMerge,
    Buildings,
    BookOpen,
    WhatsappLogo,
    type Icon as PhosphorIcon,
    Repeat,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup } from '@/components/design-system/chips';
import {
    ProfileSkeleton,
    ProfileEmpty,
    ProfileError,
    ProfileHero,
    ProfileTimeline,
    type ProfileTimelineItem,
} from '../profile-ui';
import type { Tone } from '../profile-ui';
import { format, isToday, isYesterday, isThisWeek } from 'date-fns';

// ── Category definitions ──────────────────────────────────────────────────────

type Category = 'all' | 'admission' | 'enrollment' | 'payment' | 'learning' | 'communication';

const CATEGORY_ORDER: Category[] = [
    'all',
    'admission',
    'enrollment',
    'payment',
    'learning',
    'communication',
];

const buildFilterChips = (t: TFunction): { id: Category; label: string }[] =>
    CATEGORY_ORDER.map((id) => ({ id, label: t(`filters.${id}`) }));

// Map action_type → category
const CATEGORY_MAP: Record<string, Category> = {
    APPLICATION_SUBMITTED: 'admission',
    APPLICATION_TRANSITIONED: 'admission',
    COUNSELOR_ASSIGNED: 'admission',
    STATUS_CHANGE: 'enrollment',
    PAYMENT_SUCCESS: 'payment',
    EMAIL_SENT: 'communication',
    PHONE_CALL: 'communication',
    NOTE: 'communication',
    NOTE_ADDED: 'communication',
    CALL_LOG: 'communication',
    FOLLOW_UP: 'communication',
    MEETING: 'communication',
    DUPLICATE_MERGED: 'enrollment',
    RE_ENQUIRY: 'communication',
    REATTEMPT: 'communication',
    CAMPUS_VISIT: 'admission',
};

const getCategoryForEvent = (event: TimelineEvent): Category => {
    const mapped = CATEGORY_MAP[event.action_type];
    if (mapped) return mapped;
    const upper = event.action_type.toUpperCase();
    if (upper.includes('PAYMENT') || upper.includes('INVOICE')) return 'payment';
    if (upper.includes('COURSE') || upper.includes('LESSON') || upper.includes('PROGRESS')) return 'learning';
    if (upper.includes('EMAIL') || upper.includes('SMS') || upper.includes('WHATSAPP')) return 'communication';
    if (upper.includes('ENROLL') || upper.includes('MEMBER')) return 'enrollment';
    if (upper.includes('ADMIT') || upper.includes('APPLY') || upper.includes('APPLICATION')) return 'admission';
    return 'enrollment';
};

// ── Icon + tone per action_type ───────────────────────────────────────────────

type EventStyle = { icon: PhosphorIcon; tone: Tone };

const EVENT_STYLE_MAP: Record<string, EventStyle> = {
    NOTE:                    { icon: NotePencil,           tone: 'primary' },
    NOTE_ADDED:              { icon: NotePencil,           tone: 'primary' },
    CALL_LOG:                { icon: Phone,                tone: 'info' },
    FOLLOW_UP:               { icon: CalendarCheck,        tone: 'warning' },
    MEETING:                 { icon: Buildings,            tone: 'warning' },
    STATUS_CHANGE:           { icon: ArrowsClockwise,      tone: 'warning' },
    COUNSELOR_ASSIGNED:      { icon: User,                 tone: 'primary' },
    APPLICATION_SUBMITTED:   { icon: ClipboardText,        tone: 'success' },
    APPLICATION_TRANSITIONED:{ icon: ArrowRight,           tone: 'info' },
    PHONE_CALL:              { icon: Phone,                tone: 'info' },
    EMAIL_SENT:              { icon: EnvelopeSimple,       tone: 'primary' },
    PAYMENT_SUCCESS:         { icon: CurrencyCircleDollar, tone: 'success' },
    CAMPUS_VISIT:            { icon: Buildings,            tone: 'neutral' },
    DUPLICATE_MERGED:        { icon: GitMerge,             tone: 'neutral' },
    RE_ENQUIRY:              { icon: WhatsappLogo,         tone: 'info' },
    REATTEMPT:               { icon: Repeat,               tone: 'warning' },
};
const FALLBACK_STYLE: EventStyle = { icon: BookOpen, tone: 'neutral' };

const getEventStyle = (actionType: string): EventStyle =>
    EVENT_STYLE_MAP[actionType] ?? FALLBACK_STYLE;

// ── Date bucket helpers ───────────────────────────────────────────────────────

type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

const getBucket = (dateStr: string): Bucket => {
    try {
        const d = new Date(dateStr);
        if (isToday(d)) return 'Today';
        if (isYesterday(d)) return 'Yesterday';
        if (isThisWeek(d, { weekStartsOn: 1 })) return 'This week';
    } catch {
        // fall through
    }
    return 'Earlier';
};

const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'This week', 'Earlier'];

// Bucket values above are internal keys (used for grouping + as React keys) —
// they must stay stable English literals. Only the rendered label is
// translated, via this lookup built once per render with the live t().
const buildBucketLabels = (t: TFunction): Record<Bucket, string> => ({
    Today: t('buckets.today'),
    Yesterday: t('buckets.yesterday'),
    'This week': t('buckets.thisWeek'),
    Earlier: t('buckets.earlier'),
});

// ── Date range formatting ─────────────────────────────────────────────────────

const formatDateRange = (events: TimelineEvent[]): string => {
    if (!events.length) return '';
    const dates = events
        .map((e) => {
            try { return new Date(e.created_at).getTime(); } catch { return NaN; }
        })
        .filter((ts) => !isNaN(ts));
    if (!dates.length) return '';
    const earliest = new Date(Math.min(...dates));
    const latest   = new Date(Math.max(...dates));
    if (earliest.getTime() === latest.getTime()) return format(earliest, 'd MMM yyyy');
    return `${format(earliest, 'd MMM yyyy')} – ${format(latest, 'd MMM yyyy')}`;
};

// ── Component ─────────────────────────────────────────────────────────────────

interface StudentFullHistoryProps {
    studentUserId: string;
}

export const StudentFullHistory = ({ studentUserId }: StudentFullHistoryProps) => {
    const { t } = useTranslation('manageStudentsFullHistory');
    const [page, setPage] = useState(0);
    const [activeFilter, setActiveFilter] = useState<Category>('all');
    const pageSize = 20;

    const filterChips = useMemo(() => buildFilterChips(t), [t]);
    const bucketLabels = useMemo(() => buildBucketLabels(t), [t]);

    const { data, isLoading, error, refetch } = useQuery(
        handleFetchStudentTimeline(studentUserId, page, pageSize)
    );

    // Client-side filter (all data already fetched per page)
    const filteredEvents = useMemo(() => {
        if (!data?.content) return [];
        if (activeFilter === 'all') return data.content;
        return data.content.filter((e) => getCategoryForEvent(e) === activeFilter);
    }, [data, activeFilter]);

    // Group filtered events into date buckets
    const groupedByBucket = useMemo(() => {
        const groups: Record<Bucket, ProfileTimelineItem[]> = {
            Today: [], Yesterday: [], 'This week': [], Earlier: [],
        };
        for (const event of filteredEvents) {
            const bucket = getBucket(event.created_at);
            const { icon, tone } = getEventStyle(event.action_type);
            let metaStr = '';
            try { metaStr = format(new Date(event.created_at), 'd MMM, h:mm a'); } catch { /* noop */ }
            groups[bucket].push({
                id: event.id,
                icon,
                tone,
                title: event.title || event.action_type.replace(/_/g, ' '),
                meta: metaStr || undefined,
                body: event.actor_name
                    ? t('timeline.actorPrefix', { name: event.actor_name })
                    : undefined,
            });
        }
        return groups;
    }, [filteredEvents, t]);

    // ── States ────────────────────────────────────────────────────────────────

    if (isLoading) return <ProfileSkeleton blocks={4} />;

    if (error) {
        return (
            <ProfileError
                title={t('error.title')}
                hint={t('error.hint')}
                onRetry={() => refetch()}
            />
        );
    }

    if (!data || data.content.length === 0) {
        return (
            <ProfileEmpty
                icon={ClipboardText}
                title={t('empty.title')}
                hint={t('empty.hint')}
            />
        );
    }

    const totalCount = data.totalElements ?? data.content.length;
    const dateRange  = formatDateRange(data.content);

    return (
        <div className="flex flex-col gap-3">
            {/* Hero */}
            <ProfileHero
                eyebrow={t('hero.eyebrow')}
                title={t('hero.eventCount', { count: totalCount })}
                subtitle={dateRange || undefined}
                icon={ClockCounterClockwise}
                tone="primary"
            />

            {/* Filter chips */}
            <ChipToggleGroup<Category>
                value={activeFilter}
                onChange={setActiveFilter}
                options={filterChips.map((c) => ({ value: c.id, label: c.label }))}
                ariaLabel={t('filters.ariaLabel')}
            />

            {/* Timeline grouped by date bucket */}
            {filteredEvents.length === 0 ? (
                <ProfileEmpty
                    icon={ClipboardText}
                    title={t('filteredEmpty.title')}
                    hint={t('filteredEmpty.hint')}
                />
            ) : (
                <div className="flex flex-col gap-4">
                    {BUCKET_ORDER.map((bucket) => {
                        const items = groupedByBucket[bucket];
                        if (!items.length) return null;
                        return (
                            <div key={bucket} className="flex flex-col gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                                    {bucketLabels[bucket]}
                                </span>
                                <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                                    <ProfileTimeline items={items} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination */}
            {data.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-neutral-100 pt-3">
                    <span className="text-xs text-neutral-400">
                        {t('pagination.pageOf', { current: page + 1, total: data.totalPages })}
                    </span>
                    <div className="flex gap-1.5">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0}
                        >
                            {t('pagination.previous')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPage((p) => Math.min(data.totalPages - 1, p + 1))}
                            disabled={page >= data.totalPages - 1}
                        >
                            {t('pagination.next')}
                        </MyButton>
                    </div>
                </div>
            )}
        </div>
    );
};
