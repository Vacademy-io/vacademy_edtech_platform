import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowsLeftRight, DotsThree, Plus, Prohibit, SignOut } from '@phosphor-icons/react';
import type { ClassroomRoom, PanelDeviceRow, PanelDeviceStatus } from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime, formatRelative, getActiveLocale } from '@/lib/formatters';
import {
    IN_APP_LIVE_CLASS_MIN_WEBVIEW,
    compareNames,
    endSession,
    panelErrorMessage,
    patchDevice,
    revokeDevice,
    useDevicesQuery,
    useRefreshPanels,
} from './api';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import { MovePanelDialog } from './MovePanelDialog';
import { StaleNote, TableEmpty, TableError, TableSearch, useClientPage } from './TableParts';

function statusChip(row: PanelDeviceRow): { key: string; status: StatusType } {
    const byStatus: Partial<Record<PanelDeviceStatus, { key: string; status: StatusType }>> = {
        CLAIMED: { key: 'panels.status.waiting', status: 'WARNING' },
        REVOKED: { key: 'panels.status.removed', status: 'DANGER' },
    };
    return (
        byStatus[row.status] ??
        (row.online
            ? { key: 'panels.status.online', status: 'SUCCESS' }
            : { key: 'panels.status.offline', status: 'INFO' })
    );
}

export function PanelsCard({
    instituteId,
    rooms,
    roomsLoading,
    onAddPanel,
}: {
    instituteId: string;
    rooms: ClassroomRoom[];
    /** Adding a panel starts from the room list, so it waits for that list. */
    roomsLoading: boolean;
    onAddPanel: () => void;
}) {
    const { t } = useTranslation('settingsClassroomPanels');
    const devices = useDevicesQuery(instituteId);
    const refresh = useRefreshPanels(instituteId);

    const [search, setSearch] = useState('');
    const [showRemoved, setShowRemoved] = useState(false);
    const [moveTarget, setMoveTarget] = useState<PanelDeviceRow | null>(null);
    const [revokeTarget, setRevokeTarget] = useState<PanelDeviceRow | null>(null);
    const [endTarget, setEndTarget] = useState<PanelDeviceRow | null>(null);

    const allRows = useMemo(() => devices.data ?? [], [devices.data]);
    const removedCount = allRows.filter((row) => row.status === 'REVOKED').length;
    const visibleRows = useMemo(() => {
        const locale = getActiveLocale();
        const query = search.trim().toLowerCase();
        return allRows
            .filter((row) => showRemoved || row.status !== 'REVOKED')
            .filter((row) => !query || row.room.name.toLowerCase().includes(query))
            .sort((a, b) => compareNames(a.room.name, b.room.name, locale));
    }, [allRows, search, showRemoved]);
    const { page, setPage, totalPages, pageSize, tableData } = useClientPage(visibleRows);

    const togglePassword = useMutation({
        mutationFn: ({ id, allowed }: { id: string; allowed: boolean }) =>
            patchDevice(id, { password_login_allowed: allowed }),
        onSuccess: async () => {
            await refresh();
        },
        onError: (error) => {
            toast.error(panelErrorMessage(t, error));
        },
    });
    const togglingId = togglePassword.isPending ? togglePassword.variables?.id : null;

    const columns = useMemo<ColumnDef<PanelDeviceRow>[]>(
        () => [
            {
                id: 'room',
                header: t('panels.columns.room'),
                size: 120,
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-700">{row.original.room.name}</span>
                ),
            },
            {
                id: 'state',
                header: t('panels.columns.state'),
                size: 165,
                cell: ({ row }) => {
                    const chip = statusChip(row.original);
                    return (
                        <div className="flex flex-col gap-1">
                            <StatusChip
                                text={t(chip.key)}
                                textSize="text-caption"
                                status={chip.status}
                            />
                            <span className="text-caption text-neutral-500">
                                {row.original.last_seen_at
                                    ? t('panels.lastSeen', {
                                          when: formatRelative(row.original.last_seen_at),
                                      })
                                    : t('panels.neverSeen')}
                            </span>
                            {row.original.last_ip && (
                                <span className="break-words text-caption text-neutral-500">
                                    {t('panels.lastIp', { ip: row.original.last_ip })}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'teacher',
                header: t('panels.columns.teacher'),
                size: 165,
                cell: ({ row }) => {
                    const session = row.original.current_session;
                    if (!session) {
                        return <span className="text-neutral-500">{t('panels.teacher.none')}</span>;
                    }
                    return (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-neutral-700">
                                {session.user_name ?? t('panels.teacher.unknown')}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {session.started_via === 'QR'
                                    ? t('panels.teacher.viaQr')
                                    : t('panels.teacher.viaPassword')}
                            </span>
                            {session.approved_ip && (
                                <span className="text-caption text-neutral-500">
                                    {t('panels.teacher.approvedFrom', { ip: session.approved_ip })}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'device',
                header: t('panels.columns.device'),
                size: 190,
                cell: ({ row }) => {
                    const { manufacturer, model, app_version_code, webview_major } = row.original;
                    const name = [manufacturer, model].filter(Boolean).join(' ');
                    return (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-neutral-700">
                                {name || t('panels.unknownModel')}
                            </span>
                            <span className="text-caption text-neutral-500">
                                {[
                                    app_version_code !== null &&
                                        t('panels.appVersion', { version: app_version_code }),
                                    webview_major !== null &&
                                        t('panels.webview', { version: webview_major }),
                                ]
                                    .filter(Boolean)
                                    .join(', ')}
                            </span>
                            {webview_major !== null &&
                                webview_major < IN_APP_LIVE_CLASS_MIN_WEBVIEW && (
                                    <span className="text-caption text-neutral-500">
                                        {t('panels.liveClassHint')}
                                    </span>
                                )}
                        </div>
                    );
                },
            },
            {
                id: 'paired',
                header: t('panels.columns.paired'),
                size: 125,
                cell: ({ row }) => (
                    <div className="flex flex-col gap-0.5">
                        <span className="text-neutral-700">
                            {row.original.claimed_by_name ?? t('common.none')}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {formatDateTime(row.original.claimed_at)}
                        </span>
                    </div>
                ),
            },
            {
                id: 'password',
                header: t('panels.columns.password'),
                size: 95,
                cell: ({ row }) =>
                    row.original.status === 'REVOKED' ? (
                        t('common.none')
                    ) : (
                        <Switch
                            aria-label={t('panels.passwordToggle', {
                                room: row.original.room.name,
                            })}
                            checked={row.original.password_login_allowed}
                            disabled={togglingId === row.original.id}
                            onCheckedChange={(allowed) =>
                                togglePassword.mutate({ id: row.original.id, allowed })
                            }
                        />
                    ),
            },
            {
                id: 'actions',
                header: t('panels.columns.actions'),
                size: 70,
                cell: ({ row }) =>
                    row.original.status === 'REVOKED' ? null : (
                        // Non-modal: a modal menu that opens a dialog as it closes can leave the
                        // page unable to take pointer events.
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    layoutVariant="icon"
                                    aria-label={t('panels.actionsFor', {
                                        room: row.original.room.name,
                                    })}
                                >
                                    <DotsThree size={20} />
                                </MyButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    className="gap-2"
                                    onSelect={() => setMoveTarget(row.original)}
                                >
                                    <ArrowsLeftRight size={16} />
                                    {t('panels.actions.move')}
                                </DropdownMenuItem>
                                {row.original.current_session && (
                                    <DropdownMenuItem
                                        className="gap-2"
                                        onSelect={() => setEndTarget(row.original)}
                                    >
                                        <SignOut size={16} />
                                        {t('panels.actions.endSession')}
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                    className="gap-2 text-danger-600 focus:text-danger-600"
                                    onSelect={() => setRevokeTarget(row.original)}
                                >
                                    <Prohibit size={16} />
                                    {t('panels.actions.revoke')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ),
            },
        ],
        // togglePassword.mutate is stable across renders.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [t, togglingId]
    );

    const liveCount = allRows.length - removedCount;
    const hasData = !!devices.data;

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1.5">
                    <CardTitle>
                        <h2 className="text-h3 font-medium">{t('panels.title')}</h2>
                    </CardTitle>
                    <CardDescription>{t('panels.description')}</CardDescription>
                </div>
                <MyButton
                    type="button"
                    onClick={onAddPanel}
                    disable={roomsLoading}
                    className="shrink-0 gap-2"
                >
                    <Plus size={16} />
                    {t('panels.add')}
                </MyButton>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {devices.isPending && (
                    <MyTable<PanelDeviceRow>
                        data={undefined}
                        columns={columns}
                        isLoading
                        error={null}
                        currentPage={0}
                        enableColumnPinning={false}
                    />
                )}
                {devices.isError && !hasData && (
                    <TableError
                        message={t('panels.loadError')}
                        error={devices.error}
                        onRetry={() => void devices.refetch()}
                    />
                )}
                {hasData && (
                    <>
                        {devices.isError && <StaleNote onRetry={() => void devices.refetch()} />}
                        {allRows.length > 0 && (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <TableSearch
                                    label={t('panels.search')}
                                    value={search}
                                    onChange={setSearch}
                                />
                                {removedCount > 0 && (
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="classroom-panels-show-removed"
                                            checked={showRemoved}
                                            onCheckedChange={setShowRemoved}
                                        />
                                        <Label
                                            htmlFor="classroom-panels-show-removed"
                                            className="text-body font-regular text-neutral-600"
                                        >
                                            {t('panels.showRemoved')}
                                        </Label>
                                    </div>
                                )}
                            </div>
                        )}
                        {visibleRows.length === 0 ? (
                            liveCount === 0 && !search.trim() ? (
                                <TableEmpty
                                    title={t('panels.empty.title')}
                                    body={t('panels.empty.body')}
                                    action={
                                        <MyButton
                                            type="button"
                                            buttonType="secondary"
                                            disable={roomsLoading}
                                            onClick={onAddPanel}
                                        >
                                            {t('panels.add')}
                                        </MyButton>
                                    }
                                />
                            ) : (
                                <TableEmpty
                                    title={t('common.noMatchTitle')}
                                    body={t('panels.noMatch')}
                                />
                            )
                        ) : (
                            <>
                                <MyTable<PanelDeviceRow>
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

            <MovePanelDialog
                device={moveTarget}
                rooms={rooms}
                onClose={() => setMoveTarget(null)}
                onMoved={async (roomName) => {
                    await refresh();
                    toast.success(t('move.success', { room: roomName }));
                }}
            />
            <ConfirmActionDialog
                open={!!revokeTarget}
                title={t('revoke.title', { room: revokeTarget?.room.name ?? '' })}
                body={t('revoke.body', { room: revokeTarget?.room.name ?? '' })}
                confirmLabel={t('revoke.confirm')}
                onCancel={() => setRevokeTarget(null)}
                onConfirm={async () => {
                    if (!revokeTarget) return;
                    const room = revokeTarget.room.name;
                    await revokeDevice(revokeTarget.id);
                    await refresh();
                    setRevokeTarget(null);
                    toast.success(t('revoke.success', { room }));
                }}
            />
            <ConfirmActionDialog
                open={!!endTarget}
                title={t('endSession.title', { room: endTarget?.room.name ?? '' })}
                body={t('endSession.body', {
                    room: endTarget?.room.name ?? '',
                    teacher: endTarget?.current_session?.user_name ?? t('panels.teacher.unknown'),
                })}
                confirmLabel={t('endSession.confirm')}
                onCancel={() => setEndTarget(null)}
                onConfirm={async () => {
                    const session = endTarget?.current_session;
                    if (!session) return;
                    await endSession(session.id);
                    await refresh();
                    setEndTarget(null);
                    toast.success(t('endSession.success'));
                }}
            />
        </Card>
    );
}
