import { ClockCounterClockwise, NotePencil, Phone, EnvelopeSimple, CalendarCheck, CheckCircle, Lightning, CaretRight, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_CROSS_STAGE_TIMELINE } from '@/constants/urls';
import { MyButton } from '@/components/design-system/button';
import { ProfileSectionCard, ProfileEmpty } from '../profile-ui';

interface TimelineEvent {
    id: string;
    type: string;
    action_type: string;
    actor_name: string;
    title: string;
    description: string;
    created_at: string;
}

interface TimelineResponse {
    content: TimelineEvent[];
    totalElements: number;
}

async function fetchRecentTimeline(userId: string): Promise<TimelineResponse> {
    const response = await authenticatedAxiosInstance({
        method: 'GET',
        url: `${GET_CROSS_STAGE_TIMELINE}/${userId}`,
        params: { page: 0, size: 3 },
    });
    return response.data;
}

// Type → icon mapping mirrors the lead-profile timeline so the same event
// reads consistently across surfaces.
function iconForEvent(event: TimelineEvent): PhosphorIcon {
    const action = (event.action_type || event.type || '').toUpperCase();
    if (action.includes('NOTE')) return NotePencil;
    if (action.includes('CALL')) return Phone;
    if (action.includes('EMAIL')) return EnvelopeSimple;
    if (action.includes('FOLLOW') || action.includes('SCHEDULE')) return CalendarCheck;
    if (action.includes('DONE') || action.includes('COMPLETE')) return CheckCircle;
    return Lightning;
}

function formatRelative(iso: string, t: TFunction): string {
    try {
        const date = new Date(iso);
        const diffMs = Date.now() - date.getTime();
        const diffMin = Math.floor(diffMs / 60_000);
        if (diffMin < 60) return t('relativeTime.minutesAgo', { count: Math.max(1, diffMin) });
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return t('relativeTime.hoursAgo', { count: diffHr });
        const diffDay = Math.floor(diffHr / 24);
        if (diffDay < 7) return t('relativeTime.daysAgo', { count: diffDay });
        return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    } catch {
        return '';
    }
}

/**
 * Recent Activity card — Overview's CRM pulse. Surfaces the 3 most recent
 * cross-stage timeline events (notes, calls, emails, follow-ups) per the
 * Vacademy design handoff Overview section. "All →" jumps to the Lead tab
 * so the admin can drill into the full activity feed.
 *
 * The card hides itself when no learner is selected; renders an empty
 * state when the learner has no recorded activity.
 */
export const OverviewRecentActivity = ({
    userId,
    onViewAll,
}: {
    userId?: string | null;
    /** Switch the active section to Lead. Optional — when omitted the "All"
     *  affordance is suppressed. */
    onViewAll?: () => void;
}) => {
    const { t } = useTranslation('manageStudentsOverviewRecentActivity');
    const enabled = !!userId;
    const { data, isLoading } = useQuery({
        queryKey: ['overview-recent-timeline', userId],
        queryFn: () => fetchRecentTimeline(userId as string),
        enabled,
        staleTime: 60_000,
    });

    if (!enabled) return null;

    const events = data?.content?.slice(0, 3) ?? [];

    return (
        <ProfileSectionCard
            icon={ClockCounterClockwise}
            heading={t('heading')}
            action={
                onViewAll && events.length > 0 ? (
                    <MyButton buttonType="text" scale="small" onClick={onViewAll}>
                        {t('viewAll')}
                        <CaretRight className="size-3.5" />
                    </MyButton>
                ) : undefined
            }
        >
            {isLoading ? (
                <div className="flex items-center gap-2 py-2 text-caption text-muted-foreground">
                    <div className="size-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
                    {t('loading')}
                </div>
            ) : events.length === 0 ? (
                <ProfileEmpty
                    icon={ClockCounterClockwise}
                    title={t('empty.title')}
                    hint={t('empty.hint')}
                />
            ) : (
                <ul className="flex flex-col gap-3">
                    {events.map((event) => {
                        const Icon = iconForEvent(event);
                        return (
                            <li key={event.id} className="flex items-start gap-3">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                    <Icon className="size-4" weight="duotone" />
                                </span>
                                <div className="flex min-w-0 flex-col">
                                    <span
                                        className="truncate text-body font-semibold text-card-foreground"
                                        title={event.title}
                                    >
                                        {event.title || t('fallbackTitle')}
                                    </span>
                                    {event.description && (
                                        <span
                                            className="truncate text-caption text-muted-foreground"
                                            title={event.description}
                                        >
                                            {event.description}
                                        </span>
                                    )}
                                    <span className="text-caption text-muted-foreground">
                                        {event.actor_name
                                            ? `${event.actor_name} · ${formatRelative(event.created_at, t)}`
                                            : formatRelative(event.created_at, t)}
                                    </span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </ProfileSectionCard>
    );
};
