import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatMoney } from '@/components/design-system/money-cell';
import { MyTable, type TableData } from '@/components/design-system/table';
import { COMMERCE_FEATURE } from '@/lib/commerce/commerce-access';
import { formatDate } from '@/lib/formatters';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import {
    CommerceEmptyState,
    CommerceErrorState,
    CommerceLoadingRows,
    CommerceStatusChip,
} from '@/routes/commerce/-components/CommerceStates';
import { readCommerceError } from '@/routes/commerce/-shared/commerce-errors';
import { useTaxClasses, useTaxSettings } from '@/routes/commerce/-shared/commerce-hooks';
import type { TaxClass, TaxRateRule } from '@/routes/commerce/-shared/commerce-types';
import { TaxClassDialog } from './TaxClassDialog';
import { CaBanner, settingsBackLink } from './settings-shared';

const asTableData = <T,>(rows: T[]): TableData<T> => ({
    content: rows,
    total_pages: 1,
    page_no: 0,
    page_size: rows.length,
    total_elements: rows.length,
    last: true,
});

/** "5% · ₹0.00 to ₹1,000.00 · from 1 Apr 2026", exactly as the server stored it. */
const slabLine = (rule: TaxRateRule, t: TFunction): string => {
    const range =
        rule.max_unit_price === null
            ? t('taxClasses.slabLine.from', { min: formatMoney(rule.min_unit_price) })
            : t('taxClasses.slabLine.range', {
                  min: formatMoney(rule.min_unit_price),
                  max: formatMoney(rule.max_unit_price),
              });
    const cess = rule.cess_percent
        ? t('taxClasses.slabLine.cess', { cess: rule.cess_percent })
        : '';
    return t('taxClasses.slabLine.full', {
        rate: rule.rate_percent,
        cess,
        range,
        date: formatDate(rule.effective_from),
    });
};

/**
 * Settings → Tax classes (checklist item 4). Used only in tax mode Regular; in
 * the other modes no tax lines are printed, and the page says so instead of
 * offering a table that would do nothing.
 */
export function TaxClassesPage() {
    const { t } = useTranslation('commerce');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<TaxClass | null>(null);
    const openCreate = () => {
        setEditing(null);
        setDialogOpen(true);
    };
    return (
        <CommercePage
            navId="commerce-settings"
            anyFeature={[COMMERCE_FEATURE.TAX_REPORTS]}
            title={t('settings.cards.taxClasses.title')}
            description={t('taxClasses.description')}
            backTo={settingsBackLink(t)}
            actions={
                <MyButton buttonType="primary" scale="medium" type="button" onClick={openCreate}>
                    <Plus size={16} />
                    {t('taxClasses.add')}
                </MyButton>
            }
        >
            <TaxClassesContent
                onCreate={openCreate}
                onEdit={(taxClass) => {
                    setEditing(taxClass);
                    setDialogOpen(true);
                }}
                dialogOpen={dialogOpen}
                setDialogOpen={setDialogOpen}
                editing={editing}
            />
        </CommercePage>
    );
}

function TaxClassesContent({
    onCreate,
    onEdit,
    dialogOpen,
    setDialogOpen,
    editing,
}: {
    onCreate: () => void;
    onEdit: (taxClass: TaxClass) => void;
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    editing: TaxClass | null;
}) {
    const { t } = useTranslation('commerce');
    const settings = useTaxSettings();
    const query = useTaxClasses();
    const taxClasses = useMemo(
        () => [...(query.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
        [query.data]
    );
    const taxMode = settings.data?.tax_mode ?? null;

    const columns = useMemo<ColumnDef<TaxClass>[]>(
        () => [
            {
                id: 'name',
                header: t('taxClasses.columns.name'),
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
                id: 'hsn',
                header: t('taxClasses.columns.hsn'),
                size: 110,
                cell: ({ row }) => (
                    <span className="font-mono text-caption text-foreground">
                        {row.original.hsn_code || '—'}
                    </span>
                ),
            },
            {
                id: 'unit',
                header: t('taxClasses.columns.unit'),
                size: 80,
                cell: ({ row }) => (
                    <span className="text-body text-foreground">{row.original.unit || '—'}</span>
                ),
            },
            {
                id: 'slabs',
                header: t('taxClasses.columns.slabs'),
                size: 360,
                cell: ({ row }) =>
                    row.original.rules.length === 0 ? (
                        <span className="text-caption text-warning-600">
                            {t('taxClasses.noSlabs')}
                        </span>
                    ) : (
                        <ul className="flex flex-col gap-0.5">
                            {row.original.rules.map((rule, index) => (
                                <li
                                    key={rule.id ?? index}
                                    className="text-caption tabular-nums text-foreground"
                                >
                                    {slabLine(rule, t)}
                                </li>
                            ))}
                        </ul>
                    ),
            },
            {
                id: 'status',
                header: t('taxClasses.columns.status'),
                size: 110,
                cell: ({ row }) => (
                    <CommerceStatusChip kind="taxClass" value={row.original.status ?? 'ACTIVE'} />
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
                        aria-label={t('taxClasses.edit', { name: row.original.name })}
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
            <CaBanner text={t('taxClasses.caBanner')} />
            {taxMode && taxMode !== 'REGULAR' && (
                <p className="rounded-md bg-info-50 p-3 text-caption text-neutral-600">
                    {t('taxClasses.notRegular')}
                </p>
            )}
            {query.isLoading && <CommerceLoadingRows rows={3} />}
            {query.isError && (
                <CommerceErrorState
                    message={readCommerceError(query.error, t('taxClasses.errors.load')).message}
                    onRetry={() => void query.refetch()}
                />
            )}
            {query.isSuccess && taxClasses.length === 0 && (
                <CommerceEmptyState
                    title={t('taxClasses.empty.title')}
                    description={t('taxClasses.empty.description')}
                >
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={onCreate}
                    >
                        {t('taxClasses.add')}
                    </MyButton>
                </CommerceEmptyState>
            )}
            {query.isSuccess && taxClasses.length > 0 && (
                <MyTable<TaxClass>
                    data={asTableData(taxClasses)}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    scrollable
                />
            )}
            <TaxClassDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                taxClass={editing}
                existingCodes={taxClasses.map((taxClass) => taxClass.code.toUpperCase())}
            />
        </>
    );
}
