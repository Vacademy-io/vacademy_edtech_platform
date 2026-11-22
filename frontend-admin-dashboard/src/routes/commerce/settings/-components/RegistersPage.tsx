import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyTable, type TableData } from '@/components/design-system/table';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { SectionCard } from '@/routes/commerce/-components/CatalogueBits';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { useLocations } from '@/routes/commerce/-shared/commerce-hooks';
import { PosErrorNotice, timeOnly } from '@/routes/commerce/pos/-components/pos-ui';
import { usePosManagerAllowed, useRegisters } from '@/routes/commerce/pos/-shared/pos-hooks';
import { REGISTER_SETUP_WARNINGS, type RegisterView } from '@/routes/commerce/pos/-shared/pos-types';
import { BillBooksCard } from './BillBooksCard';
import { PosLimitsCard } from './PosLimitsCard';
import { RegisterDialog } from './RegisterDialog';
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
 * Settings → Billing counters (P9): the registers of each location, the paper
 * bill books for when a till is down, and what a cashier may do without a
 * manager's PIN (the institute admin changes those).
 */
export function RegistersPage() {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<RegisterView | null>(null);
    const registers = useRegisters(access.isManager);
    // The page component runs before CommercePage's gate decides: only a manager of an institute with
    // the counter module on may read the locations (contract §7.1: no request otherwise).
    const posManager = usePosManagerAllowed();
    const locations = useLocations(posManager);
    const list = registers.data ?? [];

    const columns = useMemo<ColumnDef<RegisterView>[]>(
        () => [
            {
                id: 'code',
                header: t('pos.registers.code'),
                cell: ({ row }) => (
                    <span className="flex flex-col">
                        <span className="font-medium text-foreground">{row.original.code}</span>
                        <span className="text-caption text-muted-foreground">{row.original.name}</span>
                    </span>
                ),
            },
            { id: 'location', header: t('pos.registers.location'), cell: ({ row }) => row.original.location_name },
            {
                id: 'status',
                header: t('pos.registers.status'),
                cell: ({ row }) => <CommerceStatusChip kind="posRegister" value={row.original.status} />,
            },
            {
                id: 'session',
                header: t('pos.registers.openNow'),
                cell: ({ row }) =>
                    row.original.open_session
                        ? t('pos.start.openBy', {
                              name: row.original.open_session.cashier_name || t('pos.start.someone'),
                              time: timeOnly(row.original.open_session.opened_at),
                          })
                        : '—',
            },
            {
                id: 'warnings',
                header: t('pos.registers.setup'),
                cell: ({ row }) =>
                    row.original.setup_warnings.length === 0 ? (
                        <span className="text-success-600">{t('pos.registers.ready')}</span>
                    ) : (
                        <span className="flex flex-col text-caption text-warning-600">
                            {row.original.setup_warnings.map((code) => (
                                <span key={code}>
                                    {(REGISTER_SETUP_WARNINGS as readonly string[]).includes(code)
                                        ? t(`pos.registers.warnings.${code}`)
                                        : code}
                                </span>
                            ))}
                        </span>
                    ),
            },
            {
                id: 'edit',
                header: '',
                cell: ({ row }) => (
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="medium"
                        aria-label={t('pos.registers.edit', { code: row.original.code })}
                        onClick={() => {
                            setEditing(row.original);
                            setOpen(true);
                        }}
                    >
                        <PencilSimple size={16} />
                    </MyButton>
                ),
            },
        ],
        [t]
    );

    return (
        <CommercePage
            navId="commerce-settings"
            anyFeature={[COMMERCE_FEATURE.POS]}
            title={t('settings.cards.registers.title')}
            description={t('pos.registers.description')}
            backTo={settingsBackLink(t)}
            actions={
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="medium"
                    onClick={() => {
                        setEditing(null);
                        setOpen(true);
                    }}
                >
                    <Plus size={16} />
                    {t('pos.registers.add')}
                </MyButton>
            }
        >
            <SectionCard title={t('pos.registers.title')}>
                {registers.isLoading && <CommerceLoadingRows rows={3} />}
                {registers.isError && <PosErrorNotice error={registers.error} />}
                {registers.isSuccess && list.length === 0 && (
                    <CommerceEmptyState title={t('pos.start.emptyTitle')} description={t('pos.registers.empty')} />
                )}
                {list.length > 0 && (
                    <MyTable<RegisterView>
                        fillContainer
                        enableColumnResizing={false}
                        data={asTableData(list)}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={0}
                        scrollable
                    />
                )}
            </SectionCard>
            <BillBooksCard locations={locations.data ?? []} />
            <PosLimitsCard editable={access.isAdmin} />
            <RegisterDialog open={open} onOpenChange={setOpen} register={editing} locations={locations.data ?? []} />
        </CommercePage>
    );
}
