import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PanelUsageSessionRow } from '@/classroom-shared/apiTypes';
import { MyPagination } from '@/components/design-system/pagination';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/formatters';
import { TableEmpty, TableError } from '../TableParts';
import { dayLabel } from './RangeControls';
import type { SessionsTarget } from './UsageTables';
import { useKindLabel } from './UsageTables';
import {
    SESSIONS_PAGE_SIZE,
    durationLabel,
    fetchUsageSessions,
    usageKeys,
    type UsageRange,
} from './usageApi';

const END_REASONS = new Set([
    'SIGN_OUT',
    'IDLE',
    'CLASS_END',
    'ADMIN',
    'PHONE',
    'REPLACED',
    'SUPERSEDED',
    'UNBOUND',
    'EXPIRED',
    'ACCESS_REMOVED',
    'DEAD_MAN',
]);

/** A translated end reason; a session with none is still signed in. */
export function useEndReasonLabel() {
    const { t } = useTranslation('settingsClassroomPanels');
    return (reason: string | null | undefined) => {
        if (!reason) return t('usage.endReasons.ACTIVE');
        return END_REASONS.has(reason) ? t(`usage.endReasons.${reason}`) : reason;
    };
}

export function useStartedViaLabel() {
    const { t } = useTranslation('settingsClassroomPanels');
    return (via: string | null | undefined) =>
        via === 'QR' || via === 'PASSWORD' ? t(`usage.startedVia.${via}`) : via ?? '';
}

function SessionItem({
    session,
    target,
}: {
    session: PanelUsageSessionRow;
    target: SessionsTarget;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const kindLabel = useKindLabel();
    const endReason = useEndReasonLabel();
    const startedVia = useStartedViaLabel();
    // A room's drawer names the teacher; a teacher's drawer names the room.
    const who =
        target.kind === 'room'
            ? session.user?.name || t('usage.unknownTeacher')
            : session.room?.name || t('usage.unknownRoom');
    return (
        <li className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-neutral-700">{who}</span>
                <span className="text-body tabular-nums text-neutral-600">
                    {durationLabel(t, session.minutes)}
                </span>
            </div>
            <p className="text-caption text-neutral-500">
                {formatDateTime(session.started_at)} · {endReason(session.end_reason)} ·{' '}
                {startedVia(session.started_via)}
            </p>
            {session.events.length === 0 ? (
                <p className="text-caption text-neutral-500">{t('usage.sessions.noContent')}</p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {session.events.map((event, index) => (
                        <li
                            key={`${event.started_at}-${index}`}
                            className="flex items-baseline justify-between gap-3 text-body"
                        >
                            <span className="min-w-0 truncate text-neutral-700">
                                {kindLabel(event.kind)}:{' '}
                                {event.title || t('usage.content.untitled')}
                            </span>
                            <span className="shrink-0 text-caption tabular-nums text-neutral-500">
                                {durationLabel(t, event.minutes)}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}

/** One room's or one teacher's sessions in the chosen dates, a page at a time. */
export function SessionsSheet({
    instituteId,
    range,
    tz,
    target,
    onClose,
}: {
    instituteId: string;
    range: UsageRange;
    tz: string;
    target: SessionsTarget | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [page, setPage] = useState(0);
    useEffect(() => setPage(0), [target?.kind, target?.id, range.from, range.to]);

    const query = {
        institute_id: instituteId,
        from: range.from,
        to: range.to,
        tz,
        room_id: target?.kind === 'room' ? target.id : undefined,
        user_id: target?.kind === 'teacher' ? target.id : undefined,
        page,
        size: SESSIONS_PAGE_SIZE,
    };
    const sessions = useQuery({
        queryKey: usageKeys.sessions(query),
        enabled: !!target,
        retry: false,
        staleTime: 60_000,
        queryFn: () => fetchUsageSessions(query),
    });
    const totalPages = Math.max(1, Math.ceil((sessions.data?.total ?? 0) / SESSIONS_PAGE_SIZE));

    return (
        <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
                <SheetHeader className="text-start">
                    <SheetTitle>
                        {target
                            ? t(
                                  target.kind === 'room'
                                      ? 'usage.sessions.titleRoom'
                                      : 'usage.sessions.titleTeacher',
                                  { name: target.name }
                              )
                            : ''}
                    </SheetTitle>
                    <SheetDescription>
                        {t('usage.range.showing', {
                            from: dayLabel(range.from),
                            to: dayLabel(range.to),
                        })}
                    </SheetDescription>
                </SheetHeader>
                {sessions.isPending && (
                    <div className="flex flex-col gap-3" aria-busy="true">
                        {[0, 1, 2].map((index) => (
                            <Skeleton key={index} className="h-20 w-full rounded-lg" />
                        ))}
                    </div>
                )}
                {sessions.isError && (
                    <TableError
                        message={t('usage.sessions.loadError')}
                        error={sessions.error}
                        onRetry={() => void sessions.refetch()}
                    />
                )}
                {sessions.data && target && (
                    <>
                        {sessions.data.sessions.length === 0 ? (
                            <TableEmpty
                                title={t('usage.sessions.emptyTitle')}
                                body={t('usage.sessions.emptyBody')}
                            />
                        ) : (
                            <ul className="flex flex-col gap-3">
                                {sessions.data.sessions.map((session) => (
                                    <SessionItem
                                        key={session.id}
                                        session={session}
                                        target={target}
                                    />
                                ))}
                            </ul>
                        )}
                        {totalPages > 1 && (
                            <MyPagination
                                currentPage={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                                totalElements={sessions.data.total}
                                pageSize={SESSIONS_PAGE_SIZE}
                                compactOnPhone
                            />
                        )}
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
