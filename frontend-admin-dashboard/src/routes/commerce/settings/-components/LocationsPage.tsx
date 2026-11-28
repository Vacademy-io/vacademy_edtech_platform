import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable, type TableData } from '@/components/design-system/table';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useLocations } from '@/routes/commerce/-shared/commerce-hooks';
import type { CommerceLocation } from '@/routes/commerce/-shared/commerce-types';
import { LocationDialog } from './LocationDialog';
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
 * Settings → Locations (checklist item 2). Billing counters per location
 * live under Settings → Billing counters; the note at the foot says so.
 */
export function LocationsPage() {
    const { t } = useTranslation('commerce');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<CommerceLocation | null>(null);

    const openCreate = () => {
        setEditing(null);
        setDialogOpen(true);
    };

    return (
        <CommercePage
            navId="commerce-settings"
            anyFeature={[COMMERCE_FEATURE.STOCK]}
            title={t('settings.cards.locations.title')}
            description={t('locations.description')}
            backTo={settingsBackLink(t)}
            actions={
                <MyButton buttonType="primary" scale="medium" type="button" onClick={openCreate}>
                    <Plus size={16} />
                    {t('locations.add')}
                </MyButton>
            }
        >
            <LocationsTable
                onEdit={(location) => {
                    setEditing(location);
                    setDialogOpen(true);
                }}
                onCreate={openCreate}
                dialogOpen={dialogOpen}
                setDialogOpen={setDialogOpen}
                editing={editing}
            />
        </CommercePage>
    );
}

function LocationsTable({
    onEdit,
    onCreate,
    dialogOpen,
    setDialogOpen,
    editing,
}: {
    onEdit: (location: CommerceLocation) => void;
    onCreate: () => void;
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    editing: CommerceLocation | null;
}) {
    const { t } = useTranslation('commerce');
    const query = useLocations();
    const locations = useMemo(
        () => [...(query.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
        [query.data]
    );

    const columns = useMemo<ColumnDef<CommerceLocation>[]>(
        () => [
            {
                id: 'name',
                header: t('locations.columns.name'),
                size: 220,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body font-medium text-foreground">
                            {row.original.name || '—'}
                        </span>
                        <span className="font-mono text-caption text-muted-foreground">
                            {row.original.code}
                        </span>
                    </div>
                ),
            },
            {
                id: 'type',
                header: t('locations.columns.type'),
                size: 200,
                cell: ({ row }) => {
                    const kinds = [
                        row.original.is_store && t('locations.types.store'),
                        row.original.is_warehouse && t('locations.types.warehouse'),
                        row.original.is_source && t('locations.types.source'),
                        row.original.is_temporary && t('locations.types.temporary'),
                    ].filter((kind): kind is string => !!kind);
                    return (
                        <span className="text-body text-foreground">
                            {kinds.length > 0 ? kinds.join(', ') : '—'}
                        </span>
                    );
                },
            },
            {
                id: 'place',
                header: t('locations.columns.place'),
                size: 200,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body text-foreground">
                            {[row.original.city, row.original.pincode].filter(Boolean).join(' ') ||
                                '—'}
                        </span>
                        {row.original.state_code && (
                            <span className="text-caption text-muted-foreground">
                                {t(`states.${row.original.state_code}`, {
                                    defaultValue: row.original.state_code,
                                })}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'gstin',
                header: t('locations.columns.gstin'),
                size: 170,
                cell: ({ row }) => (
                    <span className="font-mono text-caption text-foreground">
                        {row.original.gstin || '—'}
                    </span>
                ),
            },
            {
                id: 'uses',
                header: t('locations.columns.uses'),
                size: 190,
                cell: ({ row }) => {
                    const uses = [
                        row.original.is_pos_enabled && t('locations.uses.pos'),
                        row.original.sells_online && t('locations.uses.online'),
                    ].filter((use): use is string => !!use);
                    return (
                        <span className="text-body text-foreground">
                            {uses.length > 0 ? uses.join(', ') : '—'}
                        </span>
                    );
                },
            },
            {
                id: 'status',
                header: t('locations.columns.status'),
                size: 110,
                cell: ({ row }) => (
                    <CommerceStatusChip kind="location" value={row.original.status ?? 'ACTIVE'} />
                ),
            },
            {
                id: 'actions',
                header: '',
                size: 70,
                cell: ({ row }) => (
                    <MyButton
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="small"
                        type="button"
                        aria-label={t('locations.edit', { name: row.original.name })}
                        onClick={() => onEdit(row.original)}
                    >
                        <PencilSimple size={14} />
                    </MyButton>
                ),
            },
        ],
        [t, onEdit]
    );

    return (
        <>
            {query.isLoading && <CommerceLoadingRows rows={3} />}
            {query.isError && (
                <CommerceErrorState
                    message={readCommerceError(query.error, t('locations.errors.load')).message}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && locations.length === 0 && (
                <CommerceEmptyState
                    title={t('locations.empty.title')}
                    description={t('locations.empty.description')}
                >
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={onCreate}
                    >
                        {t('locations.add')}
                    </MyButton>
                </CommerceEmptyState>
            )}
            {query.isSuccess && locations.length > 0 && (
                <MyTable<CommerceLocation>
                    fillContainer
                    enableColumnResizing={false}
                    data={asTableData(locations)}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    scrollable
                />
            )}
            <p className="text-caption text-muted-foreground">{t('locations.registersNote')}</p>
            <LocationDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                location={editing}
                existingCodes={locations.map((location) => location.code.toUpperCase())}
            />
        </>
    );
}
