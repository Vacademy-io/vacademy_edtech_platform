/**
 * "Post calendar" tab: the month's posts in date order with a month switcher and an
 * optional status filter. The month and filter live in the URL (?month=yyyy-MM&status=…).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarBlank, CaretLeft, CaretRight, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { marketingErrorMessage } from '../../-marketing/marketing-api';
import type { SocialPost } from '../../-marketing/types';
import { PostRow } from './post-row';
import {
    matchesFilter,
    shiftMonth,
    sortPostsByDate,
    STATUS_FILTERS,
    toMonthKey,
    type StatusFilter,
} from './social-utils';
import { EmptyState, ErrorState } from './states';

export interface PostCalendarProps {
    month: Date;
    onMonthChange: (month: Date) => void;
    filter: StatusFilter;
    onFilterChange: (filter: StatusFilter) => void;
    posts: SocialPost[] | undefined;
    isLoading: boolean;
    isFetching: boolean;
    error: unknown;
    onRetry: () => void;
    isAdmin: boolean;
    currentUserId: string;
    onEdit: (post: SocialPost) => void;
    onCreate: () => void;
}

export function PostCalendar({
    month,
    onMonthChange,
    filter,
    onFilterChange,
    posts,
    isLoading,
    isFetching,
    error,
    onRetry,
    isAdmin,
    currentUserId,
    onEdit,
    onCreate,
}: PostCalendarProps) {
    const { t, i18n } = useTranslation('marketingSocial');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const monthLabel = useMemo(
        () =>
            new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(
                month
            ),
        [i18n.language, month]
    );
    const isCurrentMonth = toMonthKey(month) === toMonthKey(new Date());

    const counts = useMemo(() => {
        const result = {} as Record<StatusFilter, number>;
        for (const key of STATUS_FILTERS) {
            result[key] = (posts ?? []).filter((post) => matchesFilter(post, key)).length;
        }
        return result;
    }, [posts]);

    const visible = useMemo(
        () => sortPostsByDate((posts ?? []).filter((post) => matchesFilter(post, filter))),
        [posts, filter]
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onMonthChange(shiftMonth(month, -1))}
                        className="flex size-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        aria-label={t('calendar.prevMonth')}
                    >
                        <CaretLeft size={16} />
                    </button>
                    <p
                        className="w-36 text-center text-body font-semibold text-neutral-800"
                        aria-live="polite"
                    >
                        {monthLabel}
                    </p>
                    <button
                        type="button"
                        onClick={() => onMonthChange(shiftMonth(month, 1))}
                        className="flex size-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                        aria-label={t('calendar.nextMonth')}
                    >
                        <CaretRight size={16} />
                    </button>
                    {!isCurrentMonth && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            className="ms-1"
                            onClick={() => onMonthChange(new Date())}
                        >
                            {t('calendar.today')}
                        </MyButton>
                    )}
                </div>
                <div
                    className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:pb-0"
                    role="group"
                    aria-label={t('calendar.filterLabel')}
                >
                    {STATUS_FILTERS.map((key) => {
                        const on = key === filter;
                        return (
                            <button
                                key={key}
                                type="button"
                                aria-pressed={on}
                                onClick={() => onFilterChange(key)}
                                className={cn(
                                    'flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                    on
                                        ? 'border-primary-200 bg-primary-50 text-primary-600'
                                        : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                                )}
                            >
                                <span className="text-caption font-medium">
                                    {t(`calendar.filters.${key}`)}
                                </span>
                                {posts && counts[key] > 0 && (
                                    <span className="text-caption tabular-nums text-neutral-500">
                                        {counts[key]}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {isLoading && (
                <ul
                    className="flex flex-col gap-2"
                    aria-busy="true"
                    aria-label={t('calendar.loading')}
                >
                    {[0, 1, 2, 3].map((i) => (
                        <li
                            key={i}
                            className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3"
                        >
                            <Skeleton className="size-14 rounded-md" />
                            <div className="flex flex-1 flex-col gap-2">
                                <Skeleton className="h-4 w-1/2" />
                                <Skeleton className="h-3 w-1/3" />
                                <div className="flex gap-1">
                                    <Skeleton className="size-6 rounded-md" />
                                    <Skeleton className="size-6 rounded-md" />
                                </div>
                            </div>
                            <Skeleton className="h-5 w-20 rounded-full" />
                        </li>
                    ))}
                </ul>
            )}

            {!isLoading && !!error && !posts && (
                <ErrorState
                    message={marketingErrorMessage(error, t('calendar.loadFailed'))}
                    onRetry={onRetry}
                />
            )}

            {!isLoading && posts && visible.length === 0 && (
                <EmptyState
                    icon={<CalendarBlank size={22} />}
                    title={
                        filter === 'ALL'
                            ? t('calendar.empty.title', { month: monthLabel })
                            : t('calendar.empty.filteredTitle', {
                                  status: t(`calendar.filters.${filter}`),
                              })
                    }
                    action={
                        filter === 'ALL' ? (
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                className="gap-1.5"
                                onClick={onCreate}
                            >
                                <Plus size={14} weight="bold" aria-hidden />
                                {t('calendar.empty.cta')}
                            </MyButton>
                        ) : (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => onFilterChange('ALL')}
                            >
                                {t('calendar.empty.showAll')}
                            </MyButton>
                        )
                    }
                >
                    {filter === 'ALL' ? t('calendar.empty.body') : null}
                </EmptyState>
            )}

            {!isLoading && visible.length > 0 && (
                <TooltipProvider delayDuration={150}>
                    <ul
                        className={cn(
                            'flex flex-col gap-2 transition-opacity',
                            isFetching && 'opacity-70'
                        )}
                    >
                        {visible.map((post) => (
                            <PostRow
                                key={post.id}
                                post={post}
                                isAdmin={isAdmin}
                                currentUserId={currentUserId}
                                expanded={expandedId === post.id}
                                onToggle={() =>
                                    setExpandedId((current) =>
                                        current === post.id ? null : post.id
                                    )
                                }
                                onEdit={onEdit}
                            />
                        ))}
                    </ul>
                </TooltipProvider>
            )}
        </div>
    );
}
