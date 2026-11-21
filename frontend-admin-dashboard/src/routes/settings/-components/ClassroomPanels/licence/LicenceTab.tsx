import { useMemo, useState, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Info, WarningCircle } from '@phosphor-icons/react';
import type {
    PanelLicenceGrantView,
    PanelLicenceResponse,
    PanelLicenceRoomRow,
} from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { StatusChip } from '@/components/design-system/status-chips';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, getActiveLocale } from '@/lib/formatters';
import { classroomPanelKeys, compareNames } from '../api';
import { ConfirmActionDialog } from '../ConfirmActionDialog';
import { StaleNote, TableEmpty, TableError, TableSearch, useClientPage } from '../TableParts';
import {
    INSTITUTE_LICENCE_CHIP,
    INSTITUTE_LICENCE_LABEL,
    ROOM_LICENCE_CHIP,
    ROOM_LICENCE_LABEL,
    assignSeat,
    canAssign,
    canRelease,
    licenceErrorMessage,
    licenceQueryKey,
    releaseSeat,
    useLicenceQuery,
} from './api';

export interface LicenceTabProps {
    instituteId: string;
}

/**
 * Settings, Classroom Panels, Licences: the institute's seats and which rooms hold one.
 * Seats belong to rooms, so a replaced panel keeps its room's seat. Grants are set by
 * platform staff; here the admin only moves seats between rooms.
 */
export function LicenceTab({ instituteId }: LicenceTabProps) {
    const { t } = useTranslation('settingsClassroomPanels');
    const licence = useLicenceQuery(instituteId);
    const queryClient = useQueryClient();

    const [assignTarget, setAssignTarget] = useState<PanelLicenceRoomRow | null>(null);
    const [releaseTarget, setReleaseTarget] = useState<PanelLicenceRoomRow | null>(null);

    // A seat change also changes the licence chip on the Panels list.
    const refresh = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: licenceQueryKey(instituteId) }),
            queryClient.invalidateQueries({ queryKey: classroomPanelKeys.devices(instituteId) }),
        ]);

    const data = licence.data;
    return (
        <div className="flex flex-col gap-6">
            {licence.isPending && <SummarySkeleton />}
            {licence.isError && !data && (
                <TableError
                    message={t('licence.loadError')}
                    error={licence.error}
                    onRetry={() => void licence.refetch()}
                />
            )}
            {data && (
                <>
                    {licence.isError && <StaleNote onRetry={() => void licence.refetch()} />}
                    <LicenceSummary data={data} />
                    <LicenceRooms
                        data={data}
                        onAssign={setAssignTarget}
                        onRelease={setReleaseTarget}
                    />
                </>
            )}

            <ConfirmActionDialog
                open={!!assignTarget}
                title={t('licence.assign.title', { room: assignTarget?.room.name ?? '' })}
                body={t('licence.assign.body', { room: assignTarget?.room.name ?? '' })}
                confirmLabel={t('licence.assign.confirm')}
                errorText={(error) => licenceErrorMessage(t, error)}
                onCancel={() => setAssignTarget(null)}
                onConfirm={async () => {
                    if (!assignTarget) return;
                    const room = assignTarget.room;
                    await assignSeat(room.id);
                    await refresh();
                    setAssignTarget(null);
                    toast.success(t('licence.assign.success', { room: room.name }));
                }}
            />
            <ConfirmActionDialog
                open={!!releaseTarget}
                title={t('licence.release.title', { room: releaseTarget?.room.name ?? '' })}
                body={t('licence.release.body', { room: releaseTarget?.room.name ?? '' })}
                confirmLabel={t('licence.release.confirm')}
                errorText={(error) => licenceErrorMessage(t, error)}
                onCancel={() => setReleaseTarget(null)}
                onConfirm={async () => {
                    if (!releaseTarget) return;
                    const room = releaseTarget.room;
                    await releaseSeat(room.id);
                    await refresh();
                    setReleaseTarget(null);
                    toast.success(t('licence.release.success', { room: room.name }));
                }}
            />
        </div>
    );
}

function SummarySkeleton() {
    return (
        <Card aria-busy="true">
            <CardHeader>
                <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-12 w-full" />
                ))}
            </CardContent>
        </Card>
    );
}

function LicenceSummary({ data }: { data: PanelLicenceResponse }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const overLimit = data.rooms.some((row) => row.licence_state === 'OVER_LIMIT');
    const notes: { key: string; tone: 'info' | 'warning' }[] = [];
    if (data.state === 'UNMANAGED') notes.push({ key: 'licence.note.unmanaged', tone: 'info' });
    else if (data.enforcement === 'SHADOW')
        notes.push({ key: 'licence.note.shadow', tone: 'info' });
    if (data.enforcement === 'LIVE' && (data.state === 'EXPIRED' || data.state === 'NONE')) {
        notes.push({ key: 'licence.note.ended', tone: 'warning' });
    }
    if (overLimit) notes.push({ key: 'licence.note.overLimit', tone: 'warning' });

    return (
        <Card>
            <CardHeader className="flex flex-col gap-1.5 space-y-0">
                <CardTitle>
                    <h2 className="text-h3 font-medium">{t('licence.title')}</h2>
                </CardTitle>
                <CardDescription>{t('licence.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryItem label={t('licence.summary.state')}>
                        <StatusChip
                            text={t(INSTITUTE_LICENCE_LABEL[data.state])}
                            textSize="text-caption"
                            status={INSTITUTE_LICENCE_CHIP[data.state]}
                        />
                    </SummaryItem>
                    <SummaryItem label={t('licence.summary.seats')}>
                        {t('licence.summary.seatsValue', {
                            used: data.seats_used,
                            granted: data.seats_granted,
                        })}
                    </SummaryItem>
                    <SummaryItem label={t('licence.summary.endsOn')}>
                        {data.ends_at ? formatDate(data.ends_at) : t('common.none')}
                    </SummaryItem>
                    <SummaryItem label={t('licence.summary.graceUntil')}>
                        {data.grace_ends_at ? formatDate(data.grace_ends_at) : t('common.none')}
                    </SummaryItem>
                </dl>
                {notes.map((note) => (
                    <Alert key={note.key} role="status">
                        <AlertDescription
                            className={
                                note.tone === 'warning'
                                    ? 'flex items-start gap-2 text-warning-600'
                                    : 'flex items-start gap-2 text-neutral-600'
                            }
                        >
                            {note.tone === 'warning' ? (
                                <WarningCircle size={16} className="mt-0.5 shrink-0" />
                            ) : (
                                <Info size={16} className="mt-0.5 shrink-0" />
                            )}
                            <span>{t(note.key)}</span>
                        </AlertDescription>
                    </Alert>
                ))}
                {data.grants.length > 0 && <GrantList grants={data.grants} />}
            </CardContent>
        </Card>
    );
}

function SummaryItem({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="text-caption text-neutral-500">{label}</dt>
            <dd className="text-body font-medium text-neutral-700">{children}</dd>
        </div>
    );
}

const GRANT_KIND_LABEL = {
    TRIAL: 'licence.grants.kind.TRIAL',
    PAID: 'licence.grants.kind.PAID',
    COMPLIMENTARY: 'licence.grants.kind.COMPLIMENTARY',
} as const;

function GrantList({ grants }: { grants: PanelLicenceGrantView[] }) {
    const { t } = useTranslation('settingsClassroomPanels');
    const sorted = [...grants].sort((a, b) => b.ends_at.localeCompare(a.ends_at));
    return (
        <section className="flex flex-col gap-2">
            <h3 className="text-subtitle font-medium text-neutral-700">
                {t('licence.grants.title')}
            </h3>
            <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg border border-neutral-200">
                {sorted.map((grant, index) => (
                    <li
                        key={`${grant.starts_at}-${index}`}
                        className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                        <span className="text-body font-medium text-neutral-700">
                            {t(GRANT_KIND_LABEL[grant.kind])}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {[
                                t('licence.grants.seats', { seats: grant.seats }),
                                t('licence.grants.period', {
                                    from: formatDate(grant.starts_at),
                                    to: formatDate(grant.ends_at),
                                }),
                                grant.grace_days > 0 &&
                                    t('licence.grants.grace', { days: grant.grace_days }),
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function LicenceRooms({
    data,
    onAssign,
    onRelease,
}: {
    data: PanelLicenceResponse;
    onAssign: (row: PanelLicenceRoomRow) => void;
    onRelease: (row: PanelLicenceRoomRow) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const [search, setSearch] = useState('');
    const rows = useMemo(() => {
        const locale = getActiveLocale();
        const query = search.trim().toLowerCase();
        return data.rooms
            .filter((row) => !query || row.room.name.toLowerCase().includes(query))
            .sort((a, b) => compareNames(a.room.name, b.room.name, locale));
    }, [data.rooms, search]);
    const { page, setPage, totalPages, pageSize, tableData } = useClientPage(rows);

    const columns = useMemo<ColumnDef<PanelLicenceRoomRow>[]>(
        () => [
            {
                id: 'room',
                header: t('licence.rooms.columns.room'),
                size: 160,
                cell: ({ row }) => (
                    <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-neutral-700">
                            {row.original.room.name}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {row.original.device_id
                                ? t('licence.rooms.hasPanel')
                                : t('licence.rooms.noPanel')}
                        </span>
                    </div>
                ),
            },
            {
                id: 'state',
                header: t('licence.rooms.columns.state'),
                size: 140,
                cell: ({ row }) => (
                    <StatusChip
                        text={t(ROOM_LICENCE_LABEL[row.original.licence_state])}
                        textSize="text-caption"
                        status={ROOM_LICENCE_CHIP[row.original.licence_state]}
                    />
                ),
            },
            {
                id: 'since',
                header: t('licence.rooms.columns.since'),
                size: 130,
                cell: ({ row }) =>
                    row.original.licensed_at ? (
                        <span className="text-neutral-700">
                            {formatDate(row.original.licensed_at)}
                        </span>
                    ) : (
                        <span className="text-neutral-500">{t('common.none')}</span>
                    ),
            },
            {
                id: 'actions',
                header: t('licence.rooms.columns.actions'),
                size: 130,
                cell: ({ row }) => {
                    const { licence_state, licensed_at, room } = row.original;
                    if (canAssign(licence_state)) {
                        return (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                aria-label={t('licence.rooms.assignFor', { room: room.name })}
                                onClick={() => onAssign(row.original)}
                            >
                                {t('licence.rooms.assign')}
                            </MyButton>
                        );
                    }
                    if (canRelease(licence_state, licensed_at)) {
                        return (
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                aria-label={t('licence.rooms.releaseFor', { room: room.name })}
                                onClick={() => onRelease(row.original)}
                            >
                                {t('licence.rooms.release')}
                            </MyButton>
                        );
                    }
                    return null;
                },
            },
        ],
        [t, onAssign, onRelease]
    );

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>
                    <h2 className="text-h3 font-medium">{t('licence.rooms.title')}</h2>
                </CardTitle>
                {data.rooms.length > 0 && (
                    <TableSearch
                        label={t('licence.rooms.search')}
                        value={search}
                        onChange={setSearch}
                    />
                )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {data.rooms.length === 0 ? (
                    <TableEmpty
                        title={t('licence.rooms.empty.title')}
                        body={t('licence.rooms.empty.body')}
                    />
                ) : rows.length === 0 ? (
                    <TableEmpty
                        title={t('common.noMatchTitle')}
                        body={t('licence.rooms.noMatch')}
                    />
                ) : (
                    <>
                        <MyTable<PanelLicenceRoomRow>
                            data={tableData}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={page}
                            enableColumnPinning={false}
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
