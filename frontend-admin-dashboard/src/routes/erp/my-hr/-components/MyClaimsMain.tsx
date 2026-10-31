import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bank, Info, Plus, Receipt } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MoneyCell } from '@/components/design-system/money-cell';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/formatters';
import { humanizeToken } from '@/routes/erp/leave/-components/leave-meta';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import {
    useMyHrIdentity,
    useMyLoans,
    useMyReimbursements,
} from '@/routes/erp/my-hr/-hooks/use-my-hr';
import { NewClaimDialog } from './NewClaimDialog';
import { MyHrNoProfileState, MyHrStat, MyHrStatusChip } from './my-hr-shared';

/**
 * Money owed in both directions: what the institute owes the employee
 * (reimbursements) and what the employee owes the institute (salary advances and
 * loans).
 *
 * They share a screen because they answer the same question — "what is
 * outstanding between me and payroll" — but only one of them is something the
 * employee can start. Loans are set up by HR and shown read-only; offering a
 * "request a loan" button for a flow that does not exist would be a dead end.
 */
export const MyClaimsMain = () => {
    const { t } = useTranslation('erpMyClaimsMain');
    const { employeeId, isProfileLoading, hasNoProfile } = useMyHrIdentity();
    const [claimOpen, setClaimOpen] = useState(false);

    const reimbursementsQuery = useMyReimbursements(employeeId);
    const loansQuery = useMyLoans(employeeId);

    const reimbursements = useMemo(
        () =>
            [...(reimbursementsQuery.data ?? [])].sort((a, b) =>
                (b.expense_date ?? '').localeCompare(a.expense_date ?? '')
            ),
        [reimbursementsQuery.data]
    );

    const loans = useMemo(() => loansQuery.data ?? [], [loansQuery.data]);

    if (isProfileLoading) return <HrLoadingRows rows={4} />;
    if (hasNoProfile) return <MyHrNoProfileState />;

    return (
        <div className="flex flex-col gap-5">
            <p className="max-w-3xl text-body text-muted-foreground">
                {t('intro')}
            </p>

            <Tabs defaultValue="reimbursements" className="flex flex-col gap-2">
                <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
                    <TabsTrigger value="reimbursements">{t('tabs.reimbursements')}</TabsTrigger>
                    <TabsTrigger value="loans">{t('tabs.loans')}</TabsTrigger>
                </TabsList>

                <TabsContent value="reimbursements" className="mt-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <p className="max-w-2xl text-body text-muted-foreground">
                            {t('reimbursementsIntro')}
                        </p>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            type="button"
                            onClick={() => setClaimOpen(true)}
                        >
                            <Plus size={16} /> {t('newClaim')}
                        </MyButton>
                    </div>

                    {reimbursementsQuery.isLoading ? (
                        <HrLoadingRows rows={3} />
                    ) : reimbursementsQuery.isError ? (
                        <HrErrorState
                            message={t('reimbursementsLoadError')}
                            onRetry={() => void reimbursementsQuery.refetch()}
                        />
                    ) : reimbursements.length === 0 ? (
                        <HrEmptyState
                            icon={<Receipt size={40} className="text-muted-foreground" />}
                            title={t('emptyClaimsTitle')}
                            description={t('emptyClaimsDescription')}
                        >
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                type="button"
                                onClick={() => setClaimOpen(true)}
                            >
                                {t('makeClaim')}
                            </MyButton>
                        </HrEmptyState>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {reimbursements.map((claim) => (
                                <Card
                                    key={claim.id}
                                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="flex flex-col gap-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-subtitle font-medium text-foreground">
                                                {humanizeToken(claim.type) || t('defaultExpenseType')}
                                            </span>
                                            <MyHrStatusChip status={claim.status} />
                                        </div>
                                        <span className="text-caption text-muted-foreground">
                                            {claim.expense_date
                                                ? t('spentOn', { date: formatDate(claim.expense_date) })
                                                : t('noExpenseDate')}
                                        </span>
                                        {claim.description && (
                                            <span className="text-caption text-muted-foreground">
                                                {claim.description}
                                            </span>
                                        )}
                                        {claim.rejection_reason && (
                                            <span className="text-caption text-danger-600">
                                                {t('turnedDown', { reason: claim.rejection_reason })}
                                            </span>
                                        )}
                                    </div>
                                    <MoneyCell
                                        value={claim.amount ?? null}
                                        currency={claim.currency}
                                        className="text-start text-subtitle font-medium sm:text-end"
                                    />
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="loans" className="mt-4 flex flex-col gap-4">
                    <p className="flex max-w-2xl items-start gap-2 text-body text-muted-foreground">
                        <Info size={16} className="mt-1 shrink-0" />
                        {t('loansInfo')}
                    </p>

                    {loansQuery.isLoading ? (
                        <HrLoadingRows rows={2} />
                    ) : loansQuery.isError ? (
                        <HrErrorState
                            message={t('loansLoadError')}
                            onRetry={() => void loansQuery.refetch()}
                        />
                    ) : loans.length === 0 ? (
                        <HrEmptyState
                            icon={<Bank size={40} className="text-muted-foreground" />}
                            title={t('emptyLoansTitle')}
                            description={t('emptyLoansDescription')}
                        />
                    ) : (
                        <div className="flex flex-col gap-3">
                            {loans.map((loan) => (
                                <Card key={loan.id} className="flex flex-col gap-3 p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-subtitle font-medium text-foreground">
                                            {humanizeToken(loan.loan_type) || t('defaultLoanType')}
                                        </span>
                                        <MyHrStatusChip status={loan.status} />
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <MyHrStat
                                            label={t('stats.borrowed')}
                                            value={
                                                <MoneyCell
                                                    value={loan.principal_amount ?? null}
                                                    currency={loan.currency}
                                                    className="text-start"
                                                />
                                            }
                                        />
                                        <MyHrStat
                                            label={t('stats.monthlyEmi')}
                                            value={
                                                <MoneyCell
                                                    value={loan.emi_amount ?? null}
                                                    currency={loan.currency}
                                                    className="text-start"
                                                />
                                            }
                                        />
                                        <MyHrStat
                                            label={t('stats.stillToRepay')}
                                            value={
                                                <MoneyCell
                                                    value={loan.balance_amount ?? null}
                                                    currency={loan.currency}
                                                    className="text-start"
                                                />
                                            }
                                            tone={
                                                Number(loan.balance_amount ?? 0) > 0
                                                    ? 'negative'
                                                    : 'positive'
                                            }
                                        />
                                        <MyHrStat
                                            label={t('stats.over')}
                                            value={
                                                loan.tenure_months
                                                    ? t('tenureMonths', { count: loan.tenure_months })
                                                    : '—'
                                            }
                                            hint={
                                                loan.start_month && loan.start_year
                                                    ? t('fromDate', {
                                                          month: String(loan.start_month).padStart(
                                                              2,
                                                              '0'
                                                          ),
                                                          year: loan.start_year,
                                                      })
                                                    : undefined
                                            }
                                        />
                                    </div>
                                    {loan.notes && (
                                        <p className="text-caption text-muted-foreground">
                                            {loan.notes}
                                        </p>
                                    )}
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {employeeId && (
                <NewClaimDialog
                    open={claimOpen}
                    onOpenChange={setClaimOpen}
                    employeeId={employeeId}
                />
            )}
        </div>
    );
};
