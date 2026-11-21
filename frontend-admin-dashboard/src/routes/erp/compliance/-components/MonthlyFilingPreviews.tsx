import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getInstituteId } from '@/constants/helper';
import { MoneyCell } from '@/components/design-system/money-cell';
import { ERP_KEY } from '@/routes/erp/-shared/hr-service';
import {
    fetchEsiReturn,
    fetchPfEcr,
    fetchPtReturn,
    fetchWpsExport,
} from '@/routes/erp/-shared/hr-service';
import type { MonthValue } from '@/components/design-system/month-picker';
import {
    HrEmptyState,
    HrErrorState,
    HrLoadingRows,
} from '@/routes/erp/people/-components/HrStates';
import { ComplianceSkipped, ComplianceStat, ComplianceWarnings } from './compliance-shared';

/** Shared frame: loading / error / empty, then the caller's summary + table. */
const PreviewFrame = ({
    isLoading,
    isError,
    onRetry,
    isEmpty,
    emptyText,
    children,
}: {
    isLoading: boolean;
    isError: boolean;
    onRetry: () => void;
    isEmpty: boolean;
    emptyText: string;
    children: React.ReactNode;
}) => {
    const { t } = useTranslation('erpMonthlyFilingPreviews');
    if (isLoading) return <HrLoadingRows rows={5} />;
    if (isError) {
        return <HrErrorState message={t('errors.build')} onRetry={onRetry} />;
    }
    if (isEmpty) return <HrEmptyState title={t('empty.nothingToFile')} description={emptyText} />;
    return <>{children}</>;
};

const TableShell = ({
    headers,
    children,
}: {
    headers: string[];
    children: React.ReactNode;
}) => (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="w-full text-body">
            <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-caption uppercase text-neutral-500">
                    {headers.map((h, i) => (
                        <th
                            key={h}
                            className={`px-3 py-2 font-medium ${i === 0 ? 'text-start' : 'text-end'}`}
                        >
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    </div>
);

export const EcrPreview = ({ period }: { period: MonthValue }) => {
    const { t } = useTranslation('erpMonthlyFilingPreviews');
    const query = useQuery({
        queryKey: [...ERP_KEY, 'ecr', period.year, period.month],
        queryFn: () => fetchPfEcr(period.month, period.year),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.rows ?? [];

    return (
        <PreviewFrame
            isLoading={query.isLoading}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={rows.length === 0 && !data?.skipped?.length}
            emptyText={t('ecr.emptyText')}
        >
            <div className="flex flex-col gap-4">
                <ComplianceWarnings warnings={data?.warnings} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ComplianceStat
                        label={t('stats.members')}
                        value={data?.memberCount ?? rows.length}
                    />
                    <ComplianceStat label={t('stats.epfWages')} value={data?.totalEpfWages} isMoney />
                    <ComplianceStat
                        label={t('stats.epfContribution')}
                        value={data?.totalEpfContri}
                        isMoney
                    />
                    <ComplianceStat
                        label={t('stats.epsContribution')}
                        value={data?.totalEpsContri}
                        isMoney
                    />
                </div>
                <ComplianceSkipped skipped={data?.skipped} />
                <TableShell
                    headers={[
                        t('table.member'),
                        t('table.uan'),
                        t('table.epfWages'),
                        t('table.employeeShare'),
                        t('table.eps'),
                        t('table.diff'),
                        t('table.ncp'),
                    ]}
                >
                    {rows.map((r, i) => (
                        <tr
                            key={`${r.uan ?? r.employeeCode ?? i}`}
                            className="border-b border-neutral-100 last:border-0"
                        >
                            <td className="px-3 py-2 text-neutral-700">
                                {r.memberName || r.employeeCode || '—'}
                            </td>
                            <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                {r.uan || '—'}
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.epfWages ?? null} />
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.epfContriRemitted ?? null} />
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.epsContriRemitted ?? null} />
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.epfEpsDiffRemitted ?? null} />
                            </td>
                            <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                {r.ncpDays ?? 0}
                            </td>
                        </tr>
                    ))}
                </TableShell>
            </div>
        </PreviewFrame>
    );
};

export const EsiPreview = ({ period }: { period: MonthValue }) => {
    const { t } = useTranslation('erpMonthlyFilingPreviews');
    const query = useQuery({
        queryKey: [...ERP_KEY, 'esi', period.year, period.month],
        queryFn: () => fetchEsiReturn(period.month, period.year),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.rows ?? [];

    return (
        <PreviewFrame
            isLoading={query.isLoading}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={rows.length === 0 && !data?.skipped?.length}
            emptyText={t('esi.emptyText')}
        >
            <div className="flex flex-col gap-4">
                <ComplianceWarnings warnings={data?.warnings} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <ComplianceStat
                        label={t('stats.insuredPersons')}
                        value={data?.ipCount ?? rows.length}
                    />
                    <ComplianceStat label={t('stats.totalWages')} value={data?.totalWages} isMoney />
                    <ComplianceStat
                        label={t('stats.ipContribution')}
                        value={data?.totalIpContribution}
                        isMoney
                    />
                    <ComplianceStat
                        label={t('stats.employerContribution')}
                        value={data?.totalEmployerContribution}
                        isMoney
                    />
                </div>
                <ComplianceSkipped skipped={data?.skipped} />
                <TableShell
                    headers={[
                        t('table.employee'),
                        t('table.ipNumber'),
                        t('table.days'),
                        t('table.wage'),
                        t('table.ip'),
                        t('table.employer'),
                    ]}
                >
                    {rows.map((r, i) => (
                        <tr
                            key={`${r.ipNumber ?? r.employeeCode ?? i}`}
                            className="border-b border-neutral-100 last:border-0"
                        >
                            <td className="px-3 py-2 text-neutral-700">
                                {r.name || r.employeeCode || '—'}
                            </td>
                            <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                {r.ipNumber || '—'}
                            </td>
                            <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                {r.daysWorked ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.monthlyWage ?? null} />
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.ipContribution ?? null} />
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.employerContribution ?? null} />
                            </td>
                        </tr>
                    ))}
                </TableShell>
            </div>
        </PreviewFrame>
    );
};

export const PtPreview = ({ period }: { period: MonthValue }) => {
    const { t } = useTranslation('erpMonthlyFilingPreviews');
    const query = useQuery({
        queryKey: [...ERP_KEY, 'pt', period.year, period.month],
        queryFn: () => fetchPtReturn(period.month, period.year),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const rows = data?.rows ?? [];

    return (
        <PreviewFrame
            isLoading={query.isLoading}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={rows.length === 0}
            emptyText={t('pt.emptyText')}
        >
            <div className="flex flex-col gap-4">
                <ComplianceWarnings warnings={data?.warnings} />
                <div className="grid gap-3 sm:grid-cols-3">
                    <ComplianceStat label={t('stats.state')} value={data?.stateCode ?? '—'} />
                    <ComplianceStat
                        label={t('stats.employees')}
                        value={data?.employeeCount ?? rows.length}
                    />
                    <ComplianceStat label={t('stats.totalPt')} value={data?.grandTotalPt} isMoney />
                </div>

                {data?.slabs?.length ? (
                    <div className="flex flex-col gap-2">
                        <span className="text-caption uppercase text-neutral-500">
                            {t('pt.slabSummary')}
                        </span>
                        <TableShell
                            headers={[t('table.slabAmount'), t('table.employees'), t('table.total')]}
                        >
                            {data.slabs.map((s, i) => (
                                <tr key={i} className="border-b border-neutral-100 last:border-0">
                                    <td className="px-3 py-2">
                                        <MoneyCell value={s.ptAmount ?? null} className="text-start" />
                                    </td>
                                    <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                        {s.employeeCount ?? '—'}
                                    </td>
                                    <td className="px-3 py-2">
                                        <MoneyCell value={s.totalAmount ?? null} />
                                    </td>
                                </tr>
                            ))}
                        </TableShell>
                    </div>
                ) : null}

                <TableShell headers={[t('table.employee'), t('table.gross'), t('table.pt')]}>
                    {rows.map((r, i) => (
                        <tr
                            key={`${r.employeeCode ?? i}`}
                            className="border-b border-neutral-100 last:border-0"
                        >
                            <td className="px-3 py-2 text-neutral-700">
                                {r.name || r.employeeCode || '—'}
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.grossSalary ?? null} />
                            </td>
                            <td className="px-3 py-2">
                                <MoneyCell value={r.ptAmount ?? null} />
                            </td>
                        </tr>
                    ))}
                </TableShell>
            </div>
        </PreviewFrame>
    );
};

export const WpsPreview = ({ period }: { period: MonthValue }) => {
    const { t } = useTranslation('erpMonthlyFilingPreviews');
    const query = useQuery({
        queryKey: [...ERP_KEY, 'wps', period.year, period.month],
        queryFn: () => fetchWpsExport(period.month, period.year),
        enabled: !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const data = query.data;
    const isSaudi = (data?.format ?? '').toUpperCase().includes('SAUDI');
    const rows = isSaudi ? (data?.saudiRows ?? []) : (data?.edrRows ?? []);

    return (
        <PreviewFrame
            isLoading={query.isLoading}
            isError={query.isError}
            onRetry={() => void query.refetch()}
            isEmpty={rows.length === 0 && !data?.skipped?.length}
            emptyText={t('wps.emptyText')}
        >
            <div className="flex flex-col gap-4">
                <ComplianceWarnings warnings={data?.warnings} />
                <div className="grid gap-3 sm:grid-cols-3">
                    <ComplianceStat
                        label={t('stats.employees')}
                        value={data?.employeeCount ?? rows.length}
                    />
                    <ComplianceStat
                        label={t('stats.totalNetPay')}
                        value={data?.totalNetPay}
                        currency={data?.currency}
                        isMoney
                    />
                    <ComplianceStat
                        label={t('stats.establishment')}
                        value={data?.establishmentId ?? '—'}
                    />
                </div>
                <ComplianceSkipped skipped={data?.skipped} />

                {isSaudi ? (
                    <TableShell
                        headers={[
                            t('table.employee'),
                            t('table.iban'),
                            t('table.basic'),
                            t('table.other'),
                            t('table.deductions'),
                            t('table.net'),
                        ]}
                    >
                        {(data?.saudiRows ?? []).map((r, i) => (
                            <tr
                                key={`${r.employeeCode ?? i}`}
                                className="border-b border-neutral-100 last:border-0"
                            >
                                <td className="px-3 py-2 text-neutral-700">
                                    {r.employeeName || r.employeeCode || '—'}
                                </td>
                                <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                    {r.iban || '—'}
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.basicSalary ?? null} currency={r.currency} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.otherEarnings ?? null} currency={r.currency} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.deductions ?? null} currency={r.currency} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.netSalary ?? null} currency={r.currency} />
                                </td>
                            </tr>
                        ))}
                    </TableShell>
                ) : (
                    <TableShell
                        headers={[
                            t('table.employee'),
                            t('table.iban'),
                            t('table.days'),
                            t('table.fixed'),
                            t('table.variable'),
                            t('table.net'),
                        ]}
                    >
                        {(data?.edrRows ?? []).map((r, i) => (
                            <tr
                                key={`${r.employeeCode ?? i}`}
                                className="border-b border-neutral-100 last:border-0"
                            >
                                <td className="px-3 py-2 text-neutral-700">
                                    {r.employeeName || r.employeeCode || '—'}
                                </td>
                                <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                    {r.iban || '—'}
                                </td>
                                <td className="px-3 py-2 text-end tabular-nums text-neutral-600">
                                    {r.daysInPeriod ?? '—'}
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.fixedIncome ?? null} currency={r.currency} />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell
                                        value={r.variableIncome ?? null}
                                        currency={r.currency}
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <MoneyCell value={r.netPay ?? null} currency={r.currency} />
                                </td>
                            </tr>
                        ))}
                    </TableShell>
                )}
            </div>
        </PreviewFrame>
    );
};
