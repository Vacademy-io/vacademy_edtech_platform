import { useCallback, useMemo, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import type {
    PanelUsageContent,
    PanelUsageIdleRoom,
    PanelUsageResponse,
    PanelUsageRoom,
    PanelUsageTeacher,
} from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyTable } from '@/components/design-system/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatNumber } from '@/lib/formatters';
import { TableEmpty, useClientPage } from '../TableParts';
import { dayLabel } from './RangeControls';
import { formatHours } from './UsageKpis';
import { durationLabel } from './usageApi';

/** What the session drawer lists: one room's or one teacher's sessions. */
export type SessionsTarget = { kind: 'room' | 'teacher'; id: string; name: string };

const KIND_KEYS = {
    LESSON: 'usage.kinds.LESSON',
    DECK: 'usage.kinds.DECK',
    DECK_LIVE: 'usage.kinds.DECK_LIVE',
    CLASS: 'usage.kinds.CLASS',
    WHITEBOARD: 'usage.kinds.WHITEBOARD',
} as const;

export function useKindLabel() {
    const { t } = useTranslation('settingsClassroomPanels');
    return useCallback(
        (kind: string) => (kind in KIND_KEYS ? t(KIND_KEYS[kind as keyof typeof KIND_KEYS]) : kind),
        [t]
    );
}

const Num = ({ children }: { children: ReactNode }) => (
    <span className="block text-end tabular-nums text-neutral-700">{children}</span>
);

function TableCard<T>({
    title,
    description,
    note,
    rows,
    columns,
    emptyTitle,
    emptyBody,
    onRowClick,
}: {
    title: string;
    description: string;
    note?: ReactNode;
    rows: T[];
    columns: ColumnDef<T>[];
    emptyTitle: string;
    emptyBody: string;
    onRowClick?: (row: T) => void;
}) {
    const { page, setPage, totalPages, pageSize, tableData } = useClientPage(rows);
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <h3 className="text-h3 font-medium">{title}</h3>
                </CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {note}
                {rows.length === 0 ? (
                    <TableEmpty title={emptyTitle} body={emptyBody} />
                ) : (
                    <>
                        <MyTable<T>
                            data={tableData}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={page}
                            enableColumnPinning={false}
                            onCellClick={onRowClick ? (row) => onRowClick(row) : undefined}
                        />
                        {totalPages > 1 && (
                            <MyPagination
                                currentPage={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                                totalElements={rows.length}
                                pageSize={pageSize}
                            />
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

/** The row's name as a text button, so the drawer opens from the keyboard too. */
function OpenSessions({
    label,
    name,
    onOpen,
}: {
    label: string;
    name: string;
    onOpen: () => void;
}) {
    return (
        <MyButton
            type="button"
            buttonType="text"
            scale="small"
            aria-label={label}
            className="h-auto max-w-full justify-start truncate p-0 text-start font-medium"
            onClick={(event) => {
                // The cell click opens the same drawer; one open is enough.
                event.stopPropagation();
                onOpen();
            }}
        >
            {name}
        </MyButton>
    );
}

export function RoomsTable({
    rooms,
    onOpen,
}: {
    rooms: PanelUsageRoom[];
    onOpen: (target: SessionsTarget) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const rows = useMemo(() => [...rooms].sort((a, b) => b.panel_hours - a.panel_hours), [rooms]);
    const open = useCallback(
        (row: PanelUsageRoom) =>
            onOpen({
                kind: 'room',
                id: row.room.id,
                name: row.room.name || t('usage.unknownRoom'),
            }),
        [onOpen, t]
    );
    const columns = useMemo<ColumnDef<PanelUsageRoom>[]>(
        () => [
            {
                id: 'room',
                header: t('usage.rooms.columns.room'),
                size: 220,
                cell: ({ row }) => {
                    const name = row.original.room.name || t('usage.unknownRoom');
                    return (
                        <OpenSessions
                            name={name}
                            label={t('usage.rooms.open', { room: name })}
                            onOpen={() => open(row.original)}
                        />
                    );
                },
            },
            {
                id: 'hours',
                header: t('usage.rooms.columns.hours'),
                size: 120,
                cell: ({ row }) => <Num>{formatHours(row.original.panel_hours)}</Num>,
            },
            {
                id: 'sessions',
                header: t('usage.rooms.columns.sessions'),
                size: 120,
                cell: ({ row }) => <Num>{formatNumber(row.original.sessions)}</Num>,
            },
            {
                id: 'teachers',
                header: t('usage.rooms.columns.teachers'),
                size: 120,
                cell: ({ row }) => <Num>{formatNumber(row.original.teachers)}</Num>,
            },
            {
                id: 'days',
                header: t('usage.rooms.columns.days'),
                size: 120,
                cell: ({ row }) => <Num>{formatNumber(row.original.days_used)}</Num>,
            },
            {
                id: 'lastUsed',
                header: t('usage.rooms.columns.lastUsed'),
                size: 200,
                cell: ({ row }) => (
                    <span className="text-neutral-600">
                        {row.original.last_used_at
                            ? formatDateTime(row.original.last_used_at)
                            : t('common.none')}
                    </span>
                ),
            },
        ],
        [t, open]
    );
    return (
        <TableCard
            title={t('usage.rooms.title')}
            description={t('usage.rooms.description')}
            rows={rows}
            columns={columns}
            emptyTitle={t('usage.rooms.emptyTitle')}
            emptyBody={t('usage.rooms.emptyBody')}
            onRowClick={open}
        />
    );
}

export function TeachersTable({
    teachers,
    onOpen,
}: {
    teachers: PanelUsageTeacher[];
    onOpen: (target: SessionsTarget) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const kindLabel = useKindLabel();
    const rows = useMemo(
        () => [...teachers].sort((a, b) => b.panel_hours - a.panel_hours),
        [teachers]
    );
    const open = useCallback(
        (row: PanelUsageTeacher) =>
            onOpen({
                kind: 'teacher',
                id: row.user.id,
                name: row.user.name || t('usage.unknownTeacher'),
            }),
        [onOpen, t]
    );
    const columns = useMemo<ColumnDef<PanelUsageTeacher>[]>(
        () => [
            {
                id: 'teacher',
                header: t('usage.teachers.columns.teacher'),
                size: 220,
                cell: ({ row }) => {
                    const name = row.original.user.name || t('usage.unknownTeacher');
                    return (
                        <OpenSessions
                            name={name}
                            label={t('usage.teachers.open', { teacher: name })}
                            onOpen={() => open(row.original)}
                        />
                    );
                },
            },
            {
                id: 'hours',
                header: t('usage.teachers.columns.hours'),
                size: 110,
                cell: ({ row }) => <Num>{formatHours(row.original.panel_hours)}</Num>,
            },
            {
                id: 'sessions',
                header: t('usage.teachers.columns.sessions'),
                size: 110,
                cell: ({ row }) => <Num>{formatNumber(row.original.sessions)}</Num>,
            },
            {
                id: 'rooms',
                header: t('usage.teachers.columns.rooms'),
                size: 100,
                cell: ({ row }) => <Num>{formatNumber(row.original.rooms)}</Num>,
            },
            {
                id: 'days',
                header: t('usage.teachers.columns.days'),
                size: 110,
                cell: ({ row }) => <Num>{formatNumber(row.original.days_active)}</Num>,
            },
            {
                id: 'topContent',
                header: t('usage.teachers.columns.topContent'),
                size: 260,
                cell: ({ row }) => {
                    const top = (row.original.top_content ?? [])[0];
                    if (!top) {
                        return (
                            <span className="text-neutral-500">
                                {t('usage.content.notRecorded')}
                            </span>
                        );
                    }
                    return (
                        <span className="block truncate text-neutral-600">
                            {kindLabel(top.kind)}: {top.title || t('usage.content.untitled')} (
                            {durationLabel(t, top.minutes)})
                        </span>
                    );
                },
            },
        ],
        [t, open, kindLabel]
    );
    return (
        <TableCard
            title={t('usage.teachers.title')}
            description={t('usage.teachers.description')}
            rows={rows}
            columns={columns}
            emptyTitle={t('usage.teachers.emptyTitle')}
            emptyBody={t('usage.teachers.emptyBody')}
            onRowClick={open}
        />
    );
}

export function IdleRoomsTable({ rooms }: { rooms: PanelUsageIdleRoom[] }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const columns = useMemo<ColumnDef<PanelUsageIdleRoom>[]>(
        () => [
            {
                id: 'room',
                header: t('usage.idle.columns.room'),
                size: 240,
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-700">
                        {row.original.room.name || t('usage.unknownRoom')}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('usage.idle.columns.status'),
                size: 160,
                cell: ({ row }) => (
                    <StatusChip
                        text={t(row.original.online ? 'usage.idle.online' : 'usage.idle.offline')}
                        textSize="text-caption"
                        status={row.original.online ? 'SUCCESS' : 'INFO'}
                        showIcon={false}
                    />
                ),
            },
            {
                id: 'lastUsed',
                header: t('usage.idle.columns.lastUsed'),
                size: 220,
                cell: ({ row }) => (
                    <span className="text-neutral-600">
                        {row.original.last_used_at
                            ? formatDateTime(row.original.last_used_at)
                            : t('usage.idle.never')}
                    </span>
                ),
            },
        ],
        [t]
    );
    return (
        <TableCard
            title={t('usage.idle.title')}
            description={t('usage.idle.description')}
            rows={rooms}
            columns={columns}
            emptyTitle={t('usage.idle.emptyTitle')}
            emptyBody={t('usage.idle.emptyBody')}
        />
    );
}

/**
 * What was taught. Older panel apps record nothing, so the coverage line says how much of the
 * time is covered, and an empty list reads "not recorded" rather than zero.
 */
export function ContentTable({ usage }: { usage: PanelUsageResponse }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const kindLabel = useKindLabel();
    const coverage = usage.totals.coverage_pct;
    const recordedFrom = usage.notes.content_recorded_from;
    const columns = useMemo<ColumnDef<PanelUsageContent>[]>(
        () => [
            {
                id: 'kind',
                header: t('usage.content.columns.kind'),
                size: 150,
                cell: ({ row }) => (
                    <span className="text-neutral-600">{kindLabel(row.original.kind)}</span>
                ),
            },
            {
                id: 'title',
                header: t('usage.content.columns.title'),
                size: 280,
                cell: ({ row }) => (
                    <span className="block truncate font-medium text-neutral-700">
                        {row.original.title || t('usage.content.untitled')}
                    </span>
                ),
            },
            {
                id: 'minutes',
                header: t('usage.content.columns.time'),
                size: 130,
                cell: ({ row }) => <Num>{durationLabel(t, row.original.minutes)}</Num>,
            },
            {
                id: 'sessions',
                header: t('usage.content.columns.sessions'),
                size: 110,
                cell: ({ row }) => <Num>{formatNumber(row.original.sessions ?? 0)}</Num>,
            },
            {
                id: 'teachers',
                header: t('usage.content.columns.teachers'),
                size: 110,
                cell: ({ row }) => <Num>{formatNumber(row.original.teachers ?? 0)}</Num>,
            },
        ],
        [t, kindLabel]
    );
    const note =
        coverage !== null && usage.content.length > 0 ? (
            <p className="text-caption text-neutral-500">
                {t('usage.content.coverage', { pct: formatNumber(coverage) })}{' '}
                {t('usage.content.coverageWhy')}
                {recordedFrom
                    ? ` ${t('usage.content.recordedFrom', { date: dayLabel(recordedFrom) })}`
                    : ''}
            </p>
        ) : null;
    return (
        <TableCard
            title={t('usage.content.title')}
            description={t('usage.content.description')}
            note={note}
            rows={usage.content}
            columns={columns}
            emptyTitle={t('usage.content.notRecorded')}
            emptyBody={t('usage.content.notRecordedBody')}
        />
    );
}
