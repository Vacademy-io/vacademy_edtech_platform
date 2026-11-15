import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { MapPin, Password } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable, type TableData } from '@/components/design-system/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { commerceRoleLabel } from '@/lib/commerce/commerce-role-viewer';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { SetPinDialog } from '@/routes/commerce/-components/SetPinDialog';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useCommerceStaff, useMyPinStatus } from '@/routes/commerce/-shared/commerce-hooks';
import type { CommerceStaffMember } from '@/routes/commerce/-shared/commerce-types';
import { StaffLocationsDialog } from './StaffLocationsDialog';
import { settingsBackLink } from './settings-shared';

const asTableData = <T,>(rows: T[]): TableData<T> => ({
    content: rows,
    total_pages: 1,
    page_no: 0,
    page_size: rows.length,
    total_elements: rows.length,
    last: true,
});

/**
 * Settings → Staff and roles (checklist item 9): the manager's own PIN, and
 * which locations each staff member may act at. The roles themselves are
 * granted in Teams by an institute ADMIN, never here. The limits (cashier
 * discount, cash refund, adjustment, cash variance) wait for their settings
 * endpoint.
 */
export function StaffPage() {
    const { t } = useTranslation('commerce');
    return (
        <CommercePage
            navId="commerce-settings"
            anyFeature={[COMMERCE_FEATURE.STOCK, COMMERCE_FEATURE.POS]}
            title={t('settings.cards.staff.title')}
            description={t('staff.description')}
            backTo={settingsBackLink(t)}
        >
            <StaffContent />
        </CommercePage>
    );
}

function MyPinCard() {
    const { t } = useTranslation('commerce');
    const [open, setOpen] = useState(false);
    const query = useMyPinStatus();
    const hasPin = query.data?.has_pin === true;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-title font-medium">
                    <Password size={20} className="text-muted-foreground" />
                    {t('staff.pin.title')}
                </CardTitle>
                <CardDescription className="text-body">
                    {t('staff.pin.description')}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {query.isLoading && <CommerceLoadingRows rows={1} />}
                {query.isError && (
                    <CommerceErrorState
                        message={readCommerceError(query.error, t('staff.pin.loadFailed')).message}
                        onRetry={() => void query.refetch()}
                    />
                )}
                {query.isSuccess && (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <CommerceStatusChip kind="pin" value={hasPin ? 'SET' : 'NOT_SET'} />
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            type="button"
                            onClick={() => setOpen(true)}
                        >
                            {hasPin ? t('staff.pin.change') : t('staff.pin.set')}
                        </MyButton>
                    </div>
                )}
                <SetPinDialog open={open} onOpenChange={setOpen} hasPin={hasPin} />
            </CardContent>
        </Card>
    );
}

function StaffContent() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const canSetPin = access.isFeatureOn(COMMERCE_FEATURE.POS);
    const canAssignLocations = access.isFeatureOn(COMMERCE_FEATURE.STOCK);
    const staffQuery = useCommerceStaff();
    const [member, setMember] = useState<CommerceStaffMember | null>(null);

    const staff = useMemo(
        () => [...(staffQuery.data ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name)),
        [staffQuery.data]
    );

    const columns = useMemo<ColumnDef<CommerceStaffMember>[]>(
        () => [
            {
                id: 'name',
                header: t('staff.columns.name'),
                size: 240,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body font-medium text-foreground">
                            {row.original.full_name || '—'}
                        </span>
                        {row.original.email && (
                            <span className="truncate text-caption text-muted-foreground">
                                {row.original.email}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'roles',
                header: t('staff.columns.roles'),
                size: 260,
                cell: ({ row }) => {
                    const roles = [
                        row.original.is_admin ? t('roles.admin') : null,
                        ...row.original.commerce_roles.map((role) => commerceRoleLabel(role)),
                    ].filter((role): role is string => !!role);
                    return (
                        <span className="text-body text-foreground">
                            {roles.length > 0 ? roles.join(', ') : '—'}
                        </span>
                    );
                },
            },
            {
                id: 'locations',
                header: t('staff.columns.locations'),
                size: 200,
                cell: ({ row }) =>
                    canAssignLocations ? (
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            type="button"
                            onClick={() => setMember(row.original)}
                        >
                            <MapPin size={14} />
                            {t('staff.allowedLocations')}
                        </MyButton>
                    ) : (
                        <span className="text-caption text-muted-foreground">
                            {t('staff.locationsNeedStock')}
                        </span>
                    ),
            },
        ],
        [t, canAssignLocations]
    );

    return (
        <div className="flex flex-col gap-6">
            {canSetPin && <MyPinCard />}
            <Card>
                <CardHeader>
                    <CardTitle className="text-title font-medium">
                        {t('staff.list.title')}
                    </CardTitle>
                    <CardDescription className="text-body">
                        {t('staff.list.description')}{' '}
                        {access.isAdmin && (
                            <Link
                                to="/manage-institute/teams"
                                className="text-primary-500 hover:underline"
                            >
                                {t('staff.list.openTeams')}
                            </Link>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {staffQuery.isLoading && <CommerceLoadingRows rows={3} />}
                    {staffQuery.isError && (
                        <CommerceErrorState
                            message={
                                readCommerceError(staffQuery.error, t('staff.list.loadFailed'))
                                    .message
                            }
                            onRetry={() => void staffQuery.refetch()}
                        />
                    )}
                    {staffQuery.isSuccess && staff.length === 0 && (
                        <CommerceEmptyState
                            title={t('staff.list.emptyTitle')}
                            description={t('staff.list.emptyDescription')}
                        />
                    )}
                    {staffQuery.isSuccess && staff.length > 0 && (
                        <MyTable<CommerceStaffMember>
                            data={asTableData(staff)}
                            columns={columns}
                            isLoading={false}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    )}
                    <p className="text-caption text-muted-foreground">{t('staff.limitsNote')}</p>
                </CardContent>
            </Card>
            <StaffLocationsDialog
                open={member !== null}
                onOpenChange={(open) => {
                    if (!open) setMember(null);
                }}
                member={member}
            />
        </div>
    );
}
