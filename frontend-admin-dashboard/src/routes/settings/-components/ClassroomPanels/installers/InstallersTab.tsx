import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Prohibit } from '@phosphor-icons/react';
import type { PanelPartnerLinkRow } from '@/classroom-shared/apiTypes';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, getActiveLocale } from '@/lib/formatters';
import { compareNames } from '../api';
import { ConfirmActionDialog } from '../ConfirmActionDialog';
import { StaleNote, TableEmpty, TableError, useClientPage } from '../TableParts';
import { partnersQueryKey, revokePartnerLink, usePartnersQuery } from './api';
import { InviteDialog } from './InviteDialog';

export interface InstallersTabProps {
    instituteId: string;
}

const VIA_LABEL = {
    SCHOOL_CODE: 'installers.via.SCHOOL_CODE',
    SUPER_ADMIN: 'installers.via.SUPER_ADMIN',
} as const;

/**
 * Settings, Classroom Panels, Installers: the installer organisations linked to this institute,
 * a one-time code to link another, and removal. What an installer sets up waits for approval in
 * Panels & rooms.
 */
export function InstallersTab({ instituteId }: InstallersTabProps) {
    const { t } = useTranslation('settingsClassroomPanels');
    const partners = usePartnersQuery(instituteId);
    const queryClient = useQueryClient();
    const [inviting, setInviting] = useState(false);
    const [revokeTarget, setRevokeTarget] = useState<PanelPartnerLinkRow | null>(null);

    const rows = useMemo(() => {
        const locale = getActiveLocale();
        return [...(partners.data ?? [])].sort((a, b) =>
            compareNames(a.partner_name, b.partner_name, locale)
        );
    }, [partners.data]);
    const { page, setPage, totalPages, pageSize, tableData } = useClientPage(rows);

    const columns = useMemo<ColumnDef<PanelPartnerLinkRow>[]>(
        () => [
            {
                id: 'name',
                header: t('installers.columns.name'),
                size: 180,
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-700">
                        {row.original.partner_name}
                    </span>
                ),
            },
            {
                id: 'linked',
                header: t('installers.columns.linked'),
                size: 140,
                cell: ({ row }) => (
                    <div className="flex flex-col gap-0.5">
                        <span className="text-neutral-700">
                            {formatDate(row.original.created_at)}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {t(VIA_LABEL[row.original.linked_via])}
                        </span>
                    </div>
                ),
            },
            {
                id: 'until',
                header: t('installers.columns.until'),
                size: 150,
                cell: ({ row }) => {
                    const until = row.original.install_until;
                    if (!until) {
                        return <span className="text-neutral-500">{t('installers.noEnd')}</span>;
                    }
                    const ended = new Date(until).getTime() <= Date.now();
                    return (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-neutral-700">{formatDate(until)}</span>
                            {ended && (
                                <span className="text-caption text-neutral-500">
                                    {t('installers.ended')}
                                </span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'installs',
                header: t('installers.columns.installs'),
                size: 110,
                cell: ({ row }) => (
                    <span className="text-neutral-700">{row.original.installs}</span>
                ),
            },
            {
                id: 'actions',
                header: t('installers.columns.actions'),
                size: 80,
                cell: ({ row }) => (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="icon"
                        aria-label={t('installers.revokeFor', {
                            name: row.original.partner_name,
                        })}
                        onClick={() => setRevokeTarget(row.original)}
                    >
                        <Prohibit size={18} />
                    </MyButton>
                ),
            },
        ],
        [t]
    );

    const inviteButton = (primary: boolean) => (
        <MyButton
            type="button"
            buttonType={primary ? 'primary' : 'secondary'}
            className="shrink-0 gap-2"
            onClick={() => setInviting(true)}
        >
            <Plus size={16} />
            {t('installers.invite.open')}
        </MyButton>
    );

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1.5">
                    <CardTitle>
                        <h2 className="text-h3 font-medium">{t('installers.title')}</h2>
                    </CardTitle>
                    <CardDescription>{t('installers.description')}</CardDescription>
                </div>
                {inviteButton(true)}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {partners.isPending && (
                    <MyTable<PanelPartnerLinkRow>
                        data={undefined}
                        columns={columns}
                        isLoading
                        error={null}
                        currentPage={0}
                        enableColumnPinning={false}
                    />
                )}
                {partners.isError && !partners.data && (
                    <TableError
                        message={t('installers.loadError')}
                        error={partners.error}
                        onRetry={() => void partners.refetch()}
                    />
                )}
                {partners.data && (
                    <>
                        {partners.isError && <StaleNote onRetry={() => void partners.refetch()} />}
                        {rows.length === 0 ? (
                            <TableEmpty
                                title={t('installers.empty.title')}
                                body={t('installers.empty.body')}
                                action={inviteButton(false)}
                            />
                        ) : (
                            <>
                                <MyTable<PanelPartnerLinkRow>
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
                    </>
                )}
            </CardContent>

            <InviteDialog
                open={inviting}
                instituteId={instituteId}
                onClose={() => setInviting(false)}
            />
            <ConfirmActionDialog
                open={!!revokeTarget}
                title={t('installers.revoke.title', { name: revokeTarget?.partner_name ?? '' })}
                body={t('installers.revoke.body', { name: revokeTarget?.partner_name ?? '' })}
                confirmLabel={t('installers.revoke.confirm')}
                onCancel={() => setRevokeTarget(null)}
                onConfirm={async () => {
                    if (!revokeTarget) return;
                    const name = revokeTarget.partner_name;
                    await revokePartnerLink(revokeTarget.link_id);
                    await queryClient.invalidateQueries({
                        queryKey: partnersQueryKey(instituteId),
                    });
                    setRevokeTarget(null);
                    toast.success(t('installers.revoke.success', { name }));
                }}
            />
        </Card>
    );
}
