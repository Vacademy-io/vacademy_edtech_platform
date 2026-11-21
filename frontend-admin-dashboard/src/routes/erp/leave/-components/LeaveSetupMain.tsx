import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Check, Minus, PencilSimple, Plus } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { MyTable, type TableData } from '@/components/design-system/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHrRole } from '@/hooks/use-hr-role';
import { formatDate } from '@/lib/formatters';
import type { LeavePolicyDTO, LeaveTypeDTO } from '@/routes/erp/-shared/hr-types';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
    HrNoAccessCard,
} from '@/routes/erp/people/-components/HrStates';
import { useLeavePolicies, useLeaveTypes } from '@/routes/erp/leave/-hooks/use-leave';
import { LeavePolicyDialog } from './LeavePolicyDialog';
import { LeaveTypeDialog } from './LeaveTypeDialog';
import { ACCRUAL_TYPE_LABELS, GENDER_LABELS, formatDays, humanizeToken } from './leave-meta';

const BoolCell = ({ value, t }: { value: boolean | undefined; t: TFunction }) =>
    value ? (
        <Check size={16} className="text-success-600" aria-label={t('yes')} />
    ) : (
        <Minus size={16} className="text-neutral-300" aria-label={t('no')} />
    );

const RecordStatusChip = ({ status }: { status: string | null | undefined }) => {
    const normalized = (status ?? 'ACTIVE').toUpperCase();
    return (
        <StatusChip
            text={humanizeToken(normalized)}
            textSize="text-caption"
            status={normalized === 'ACTIVE' ? 'SUCCESS' : 'INFO'}
            showIcon={false}
        />
    );
};

const asTableData = <T,>(rows: T[]): TableData<T> => ({
    content: rows,
    total_pages: 1,
    page_no: 0,
    page_size: rows.length,
    total_elements: rows.length,
    last: true,
});

/**
 * Leave configuration, in the order it has to be done: define the kinds of leave
 * your institute grants, then write the policy that says how much of each an
 * employee gets and how it arrives. The tabs are that sequence — a policy can't
 * reference a leave type that doesn't exist yet.
 */
export const LeaveSetupMain = () => {
    const { t } = useTranslation('erpLeaveSetupMain');
    const { isHrAdmin, isHrStaff } = useHrRole();
    const [typeDialogOpen, setTypeDialogOpen] = useState(false);
    const [editingType, setEditingType] = useState<LeaveTypeDTO | null>(null);
    const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<LeavePolicyDTO | null>(null);

    const typesQuery = useLeaveTypes();
    const policiesQuery = useLeavePolicies();

    const types = useMemo(
        () =>
            [...(typesQuery.data ?? [])].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
        [typesQuery.data]
    );
    const policies = useMemo(
        () =>
            [...(policiesQuery.data ?? [])].sort((a, b) =>
                (a.leave_type_name ?? '').localeCompare(b.leave_type_name ?? '')
            ),
        [policiesQuery.data]
    );

    const typeNameById = useMemo(() => {
        const map = new Map<string, string>();
        types.forEach((type) => {
            if (type.id) map.set(type.id, type.name || type.code || t('leave'));
        });
        return map;
    }, [types]);

    const openCreateType = () => {
        setEditingType(null);
        setTypeDialogOpen(true);
    };
    const openEditType = (type: LeaveTypeDTO) => {
        setEditingType(type);
        setTypeDialogOpen(true);
    };
    const openCreatePolicy = () => {
        setEditingPolicy(null);
        setPolicyDialogOpen(true);
    };
    const openEditPolicy = (policy: LeavePolicyDTO) => {
        setEditingPolicy(policy);
        setPolicyDialogOpen(true);
    };

    const typeColumns = useMemo<ColumnDef<LeaveTypeDTO>[]>(
        () => [
            {
                id: 'name',
                header: t('columns.leaveType'),
                size: 200,
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body font-semibold text-foreground">
                            {row.original.name || '—'}
                        </span>
                        {row.original.description && (
                            <span className="truncate text-caption text-muted-foreground">
                                {row.original.description}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                id: 'code',
                header: t('columns.code'),
                size: 110,
                cell: ({ row }) => (
                    <span className="font-mono text-caption text-muted-foreground">
                        {row.original.code || '—'}
                    </span>
                ),
            },
            {
                id: 'is_paid',
                header: t('columns.paid'),
                size: 80,
                cell: ({ row }) => <BoolCell value={row.original.is_paid} t={t} />,
            },
            {
                id: 'carry_forward',
                header: t('columns.carryForward'),
                size: 140,
                cell: ({ row }) =>
                    row.original.is_carry_forward ? (
                        <span className="text-body tabular-nums text-foreground">
                            {row.original.max_carry_forward === undefined ||
                            row.original.max_carry_forward === null
                                ? t('uncapped')
                                : t('upTo', { count: row.original.max_carry_forward })}
                        </span>
                    ) : (
                        <BoolCell value={false} t={t} />
                    ),
            },
            {
                id: 'is_encashable',
                header: t('columns.encashable'),
                size: 110,
                cell: ({ row }) => <BoolCell value={row.original.is_encashable} t={t} />,
            },
            {
                id: 'requires_document',
                header: t('columns.document'),
                size: 110,
                cell: ({ row }) => <BoolCell value={row.original.requires_document} t={t} />,
            },
            {
                id: 'min_days',
                header: t('columns.minDays'),
                size: 100,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-muted-foreground">
                        {formatDays(row.original.min_days)}
                    </span>
                ),
            },
            {
                id: 'max_consecutive_days',
                header: t('columns.maxConsecutive'),
                size: 140,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-muted-foreground">
                        {row.original.max_consecutive_days ?? '—'}
                    </span>
                ),
            },
            {
                id: 'applicable_gender',
                header: t('columns.appliesTo'),
                size: 110,
                cell: ({ row }) => (
                    <span className="text-body text-muted-foreground">
                        {GENDER_LABELS[(row.original.applicable_gender ?? 'ALL').toUpperCase()] ??
                            humanizeToken(row.original.applicable_gender)}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('columns.status'),
                size: 110,
                cell: ({ row }) => <RecordStatusChip status={row.original.status} />,
            },
            ...(isHrAdmin
                ? [
                      {
                          id: 'actions',
                          header: '',
                          size: 70,
                          cell: ({ row }) => (
                              <MyButton
                                  buttonType="text"
                                  scale="small"
                                  layoutVariant="icon"
                                  type="button"
                                  aria-label={t('editLeaveType', {
                                      name: row.original.name ?? t('leaveTypeFallback'),
                                  })}
                                  onClick={() => openEditType(row.original)}
                              >
                                  <PencilSimple size={16} />
                              </MyButton>
                          ),
                      } as ColumnDef<LeaveTypeDTO>,
                  ]
                : []),
        ],
        [isHrAdmin, t]
    );

    const policyColumns = useMemo<ColumnDef<LeavePolicyDTO>[]>(
        () => [
            {
                id: 'leave_type',
                header: t('columns.leaveType'),
                size: 190,
                cell: ({ row }) => (
                    <span className="truncate text-body font-semibold text-foreground">
                        {row.original.leave_type_name ||
                            (row.original.leave_type_id
                                ? typeNameById.get(row.original.leave_type_id) ?? '—'
                                : '—')}
                    </span>
                ),
            },
            {
                id: 'annual_quota',
                header: t('columns.annualQuota'),
                size: 120,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-foreground">
                        {formatDays(row.original.annual_quota)}
                    </span>
                ),
            },
            {
                id: 'accrual_type',
                header: t('columns.accrual'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-body text-foreground">
                        {ACCRUAL_TYPE_LABELS[(row.original.accrual_type ?? '').toUpperCase()] ??
                            (humanizeToken(row.original.accrual_type) || '—')}
                    </span>
                ),
            },
            {
                id: 'accrual_amount',
                header: t('columns.perPeriod'),
                size: 110,
                cell: ({ row }) => (
                    <span className="block text-end text-body tabular-nums text-muted-foreground">
                        {formatDays(row.original.accrual_amount)}
                    </span>
                ),
            },
            {
                id: 'pro_rata_enabled',
                header: t('columns.proRata'),
                size: 100,
                cell: ({ row }) => <BoolCell value={row.original.pro_rata_enabled} t={t} />,
            },
            {
                id: 'applicable_after_days',
                header: t('columns.applicableAfter'),
                size: 140,
                cell: ({ row }) => (
                    <span className="text-body text-muted-foreground">
                        {row.original.applicable_after_days
                            ? t('daysCount', { count: row.original.applicable_after_days })
                            : t('fromJoining')}
                    </span>
                ),
            },
            {
                id: 'effective',
                header: t('columns.effective'),
                size: 190,
                cell: ({ row }) => (
                    <span className="text-body text-muted-foreground">
                        {row.original.effective_from
                            ? `${formatDate(row.original.effective_from)} → ${
                                  row.original.effective_to
                                      ? formatDate(row.original.effective_to)
                                      : t('open')
                              }`
                            : '—'}
                    </span>
                ),
            },
            {
                id: 'status',
                header: t('columns.status'),
                size: 110,
                cell: ({ row }) => <RecordStatusChip status={row.original.status} />,
            },
            ...(isHrAdmin
                ? [
                      {
                          id: 'actions',
                          header: '',
                          size: 70,
                          cell: ({ row }) => (
                              <MyButton
                                  buttonType="text"
                                  scale="small"
                                  layoutVariant="icon"
                                  type="button"
                                  aria-label={t('editLeavePolicy', {
                                      name: row.original.leave_type_name ?? t('leaveFallback'),
                                  })}
                                  onClick={() => openEditPolicy(row.original)}
                              >
                                  <PencilSimple size={16} />
                              </MyButton>
                          ),
                      } as ColumnDef<LeavePolicyDTO>,
                  ]
                : []),
        ],
        [isHrAdmin, typeNameById, t]
    );

    if (!isHrStaff) return <HrNoAccessCard />;

    return (
        <div className="flex flex-col gap-4">
            <p className="max-w-3xl text-body text-muted-foreground">{t('intro')}</p>

            <Tabs defaultValue="types" className="flex flex-col gap-2">
                <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
                    <TabsTrigger value="types">{t('tabs.types')}</TabsTrigger>
                    <TabsTrigger value="policies">{t('tabs.policies')}</TabsTrigger>
                </TabsList>

                <TabsContent value="types" className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <p className="max-w-2xl text-body text-muted-foreground">
                            {t('typesTabIntro')}
                        </p>
                        {isHrAdmin && (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                type="button"
                                onClick={openCreateType}
                            >
                                <Plus size={16} /> {t('addLeaveType')}
                            </MyButton>
                        )}
                    </div>

                    {typesQuery.isLoading ? (
                        <HrLoadingRows rows={4} />
                    ) : typesQuery.isError ? (
                        <HrErrorState
                            message={t('errors.loadTypes')}
                            onRetry={() => void typesQuery.refetch()}
                        />
                    ) : types.length === 0 ? (
                        <HrEmptyState
                            title={t('emptyTypes.title')}
                            description={t('emptyTypes.description')}
                        >
                            {isHrAdmin && (
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    type="button"
                                    onClick={openCreateType}
                                >
                                    <Plus size={16} /> {t('addLeaveType')}
                                </MyButton>
                            )}
                        </HrEmptyState>
                    ) : (
                        <MyTable<LeaveTypeDTO>
                            data={asTableData(types)}
                            columns={typeColumns}
                            isLoading={false}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    )}
                </TabsContent>

                <TabsContent value="policies" className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <p className="max-w-2xl text-body text-muted-foreground">
                            {t('policiesTabIntro')}
                        </p>
                        {isHrAdmin && (
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                type="button"
                                onClick={openCreatePolicy}
                            >
                                <Plus size={16} /> {t('addPolicy')}
                            </MyButton>
                        )}
                    </div>

                    {policiesQuery.isLoading ? (
                        <HrLoadingRows rows={4} />
                    ) : policiesQuery.isError ? (
                        <HrErrorState
                            message={t('errors.loadPolicies')}
                            onRetry={() => void policiesQuery.refetch()}
                        />
                    ) : policies.length === 0 ? (
                        <HrEmptyState
                            title={t('emptyPolicies.title')}
                            description={
                                types.length === 0
                                    ? t('emptyPolicies.descriptionNoTypes')
                                    : t('emptyPolicies.description')
                            }
                        >
                            {isHrAdmin && types.length > 0 && (
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    type="button"
                                    onClick={openCreatePolicy}
                                >
                                    <Plus size={16} /> {t('addPolicy')}
                                </MyButton>
                            )}
                        </HrEmptyState>
                    ) : (
                        <MyTable<LeavePolicyDTO>
                            data={asTableData(policies)}
                            columns={policyColumns}
                            isLoading={false}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    )}
                </TabsContent>
            </Tabs>

            {isHrAdmin && (
                <>
                    <LeaveTypeDialog
                        open={typeDialogOpen}
                        onOpenChange={setTypeDialogOpen}
                        leaveType={editingType}
                        existingCodes={types.map((type) => (type.code ?? '').toUpperCase())}
                    />
                    <LeavePolicyDialog
                        open={policyDialogOpen}
                        onOpenChange={setPolicyDialogOpen}
                        policy={editingPolicy}
                        leaveTypes={types}
                    />
                </>
            )}
        </div>
    );
};
