import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Archive, DotsThree, PencilSimple, Plus, Rows } from '@phosphor-icons/react';
import type { ClassroomRoom, PanelDeviceRow, RoomListResponse } from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getActiveLocale } from '@/lib/formatters';
import { compareNames, patchRoom, useDevicesQuery, useRefreshPanels } from './api';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { PasteRoomsDialog, RoomNameDialog } from './RoomDialogs';
import { StaleNote, TableEmpty, TableError, TableSearch, useClientPage } from './TableParts';

export function RoomsCard({
    instituteId,
    rooms,
    onAddPanel,
}: {
    instituteId: string;
    rooms: UseQueryResult<RoomListResponse>;
    onAddPanel: (roomId: string) => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const devices = useDevicesQuery(instituteId);
    const refresh = useRefreshPanels(instituteId);

    const [search, setSearch] = useState('');
    const [adding, setAdding] = useState(false);
    const [pasting, setPasting] = useState(false);
    const [renameTarget, setRenameTarget] = useState<ClassroomRoom | null>(null);
    const [archiveTarget, setArchiveTarget] = useState<ClassroomRoom | null>(null);

    const devicesById = useMemo(() => {
        const map = new Map<string, PanelDeviceRow>();
        devices.data?.forEach((device) => map.set(device.id, device));
        return map;
    }, [devices.data]);

    // An archived room is hidden, not restorable: its name is free for a new room straight away.
    const activeRooms = useMemo(
        () => (rooms.data?.rooms ?? []).filter((room) => room.status === 'ACTIVE'),
        [rooms.data]
    );
    const visibleRows = useMemo(() => {
        const locale = getActiveLocale();
        const query = search.trim().toLowerCase();
        return activeRooms
            .filter((room) => !query || room.name.toLowerCase().includes(query))
            .sort((a, b) => compareNames(a.name, b.name, locale));
    }, [activeRooms, search]);
    const { page, setPage, totalPages, pageSize, tableData } = useClientPage(visibleRows);

    const columns = useMemo<ColumnDef<ClassroomRoom>[]>(
        () => [
            {
                id: 'name',
                header: t('rooms.columns.name'),
                size: 330,
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-700">{row.original.name}</span>
                ),
            },
            {
                id: 'panel',
                header: t('rooms.columns.panel'),
                size: 330,
                cell: ({ row }) => {
                    const deviceId = row.original.device_id;
                    if (!deviceId) {
                        return <span className="text-neutral-500">{t('rooms.noPanel')}</span>;
                    }
                    const device = devicesById.get(deviceId);
                    const name = [device?.manufacturer, device?.model].filter(Boolean).join(' ');
                    return <span className="text-neutral-700">{name || t('rooms.hasPanel')}</span>;
                },
            },
            {
                id: 'actions',
                header: t('rooms.columns.actions'),
                size: 270,
                cell: ({ row }) => (
                    <div className="flex items-center gap-2">
                        {!row.original.device_id && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                aria-label={t('rooms.addPanelFor', { room: row.original.name })}
                                onClick={() => onAddPanel(row.original.id)}
                            >
                                {t('panels.add')}
                            </MyButton>
                        )}
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    layoutVariant="icon"
                                    aria-label={t('rooms.actionsFor', { room: row.original.name })}
                                >
                                    <DotsThree size={20} />
                                </MyButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    className="gap-2"
                                    onSelect={() => setRenameTarget(row.original)}
                                >
                                    <PencilSimple size={16} />
                                    {t('rooms.actions.rename')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="gap-2 text-danger-600 focus:text-danger-600"
                                    onSelect={() => setArchiveTarget(row.original)}
                                >
                                    <Archive size={16} />
                                    {t('rooms.actions.archive')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                ),
            },
        ],
        [t, devicesById, onAddPanel]
    );

    const hasData = !!rooms.data;

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1.5">
                    <CardTitle>
                        <h2 className="text-h3 font-medium">{t('rooms.title')}</h2>
                    </CardTitle>
                    <CardDescription>{t('rooms.description')}</CardDescription>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        className="gap-2"
                        onClick={() => setPasting(true)}
                    >
                        <Rows size={16} />
                        {t('rooms.paste.open')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        className="gap-2"
                        onClick={() => setAdding(true)}
                    >
                        <Plus size={16} />
                        {t('rooms.add.open')}
                    </MyButton>
                </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {rooms.isPending && (
                    <MyTable<ClassroomRoom>
                        data={undefined}
                        columns={columns}
                        isLoading
                        error={null}
                        currentPage={0}
                        enableColumnPinning={false}
                    />
                )}
                {rooms.isError && !hasData && (
                    <TableError
                        message={t('rooms.loadError')}
                        error={rooms.error}
                        onRetry={() => void rooms.refetch()}
                    />
                )}
                {hasData && (
                    <>
                        {rooms.isError && <StaleNote onRetry={() => void rooms.refetch()} />}
                        {activeRooms.length > 0 && (
                            <TableSearch
                                label={t('rooms.search')}
                                value={search}
                                onChange={setSearch}
                            />
                        )}
                        {visibleRows.length === 0 ? (
                            activeRooms.length === 0 ? (
                                <TableEmpty
                                    title={t('rooms.empty.title')}
                                    body={t('rooms.empty.body')}
                                    action={
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            onClick={() => setAdding(true)}
                                        >
                                            {t('rooms.add.open')}
                                        </MyButton>
                                    }
                                />
                            ) : (
                                <TableEmpty
                                    title={t('common.noMatchTitle')}
                                    body={t('rooms.noMatch')}
                                />
                            )
                        ) : (
                            <>
                                <MyTable<ClassroomRoom>
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
                                        totalElements={visibleRows.length}
                                        pageSize={pageSize}
                                    />
                                )}
                            </>
                        )}
                    </>
                )}
            </CardContent>

            <RoomNameDialog
                open={adding || !!renameTarget}
                instituteId={instituteId}
                room={renameTarget}
                onClose={() => {
                    setAdding(false);
                    setRenameTarget(null);
                }}
                onSaved={refresh}
            />
            <PasteRoomsDialog
                open={pasting}
                instituteId={instituteId}
                onClose={() => setPasting(false)}
                onSaved={refresh}
            />
            <ConfirmActionDialog
                open={!!archiveTarget}
                title={t('rooms.archive.title', { room: archiveTarget?.name ?? '' })}
                body={t('rooms.archive.body')}
                confirmLabel={t('rooms.archive.confirm')}
                onCancel={() => setArchiveTarget(null)}
                onConfirm={async () => {
                    if (!archiveTarget) return;
                    const room = archiveTarget.name;
                    await patchRoom(archiveTarget.id, { status: 'ARCHIVED' });
                    await refresh();
                    setArchiveTarget(null);
                    toast.success(t('rooms.archive.success', { room }));
                }}
            />
        </Card>
    );
}
