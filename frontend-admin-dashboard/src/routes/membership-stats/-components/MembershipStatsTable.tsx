import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ColumnDef } from '@tanstack/react-table';
import { MyTable, TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { Badge } from '@/components/ui/badge';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { format } from 'date-fns';
import { User, Users } from '@phosphor-icons/react';
import type { AllStudentStatsResponse, StudentStatsDTO } from '@/types/membership-stats';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface MembershipStatsTableProps {
    data: AllStudentStatsResponse | undefined;
    isLoading: boolean;
    error: Error | null;
    currentPage: number;
    onPageChange: (page: number) => void;
    packageSessions: Record<string, string>;
}

export function MembershipStatsTable({
    data,
    isLoading,
    error,
    currentPage,
    onPageChange,
    packageSessions,
}: MembershipStatsTableProps) {
    const { t, i18n } = useTranslation('membershipStatsMembershipStatsTable');
    // Transform API response to TableData format
    const tableData: TableData<StudentStatsDTO> | undefined = useMemo(() => {
        if (!data) return undefined;
        return {
            content: data.content,
            total_pages: data.total_pages,
            page_no: data.page_no,
            page_size: data.page_size,
            total_elements: data.total_elements,
            last: data.last,
        };
    }, [data]);

    const columns = useMemo<ColumnDef<StudentStatsDTO>[]>(
        () => [
            {
                id: 'user',
                header: t('columns.user'),
                accessorFn: (row) => row.user_dto.full_name,
                cell: ({ row }) => (
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                            <User size={20} weight="bold" />
                        </div>
                        <div>
                            <p className="font-medium text-gray-900">
                                {row.original.user_dto.full_name}
                            </p>
                            <p className="text-xs text-gray-500">
                                {row.original.user_dto.email}
                            </p>
                            <p className="text-xs text-gray-500">
                                {row.original.user_dto.mobile_number}
                            </p>
                        </div>
                    </div>
                ),
                size: 250,
            },
            {
                id: 'user_type',
                header: t('columns.userType'),
                accessorFn: (row) => row.user_type,
                cell: ({ row }) => (
                    <Badge
                        variant={row.original.user_type === 'NEW_USER' ? 'default' : 'secondary'}
                        className="uppercase"
                    >
                        {row.original.user_type === 'NEW_USER' ? t('newUser') : t('retainer')}
                    </Badge>
                ),
                size: 150,
            },
            {
                id: 'packages',
                header: getTerminologyPlural(ContentTerms.Package, SystemTerms.Package),
                accessorFn: (row) => row.package_session_ids.join(','),
                cell: ({ row }) => (
                    <div className="flex flex-col gap-1">
                        {row.original.package_session_ids && row.original.package_session_ids.length > 0 ? (
                            row.original.package_session_ids.map((id) => (
                                <span
                                    key={id}
                                    className="inline-flex max-w-52 truncate rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                                    title={packageSessions[id] || id}
                                >
                                    {packageSessions[id] || 'Unknown Session'}
                                </span>
                            ))
                        ) : (
                            <span className="text-gray-400 italic">{t('noPackages')}</span>
                        )}
                    </div>
                ),
                size: 200,
            },
            {
                id: 'joined_on',
                header: t('columns.joinedOn'),
                accessorFn: (row) => row.created_at,
                cell: ({ row }) => (
                    <div>
                        <p className="text-sm text-gray-700">
                            {format(new Date(row.original.created_at), 'PPP')}
                        </p>
                        <p className="text-xs text-gray-500">
                            {format(new Date(row.original.created_at), 'p')}
                        </p>
                    </div>
                ),
                size: 150,
            },
            {
                id: 'roles',
                header: t('columns.roles'),
                accessorFn: (row) => row.comma_separated_org_roles,
                cell: ({ row }) => (
                    <div className="flex flex-wrap gap-1">
                        {(row.original.comma_separated_org_roles || '')
                            .split(',')
                            .filter(Boolean)
                            .map((role, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                    {role.trim()}
                                </Badge>
                            ))}
                    </div>
                ),
                size: 150,
            },
        ],
        [packageSessions, t]
    );

    if (isLoading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <DashboardLoader />
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
                <p className="text-red-800">{t('errorLoading')}</p>
                <p className="mt-2 text-sm text-red-600">{error.message}</p>
            </div>
        );
    }

    if (!tableData) {
        return null;
    }

    if (tableData.content.length === 0) {
        return (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-12 text-center">
                <div className="flex flex-col items-center justify-center">
                    <Users size={48} className="mb-4 text-gray-400" />
                    <p className="text-lg font-medium text-gray-600">{t('noRecordsFound')}</p>
                    <p className="mt-2 text-sm text-gray-500">
                        {t('tryAdjustingFilters')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
                <MyTable
                    data={tableData}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={currentPage}
                    scrollable={true}
                    enableColumnResizing={true}
                    enableColumnPinning={false}
                />
            </div>

            {tableData.total_pages > 1 && (
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                    <div className="text-sm text-gray-600">
                        {t('showingRange', {
                            start: tableData.page_no * tableData.page_size + 1,
                            end: Math.min(
                                (tableData.page_no + 1) * tableData.page_size,
                                tableData.total_elements
                            ),
                            count: tableData.total_elements,
                        })}
                    </div>
                    <MyPagination
                        currentPage={currentPage}
                        totalPages={tableData.total_pages}
                        onPageChange={onPageChange}
                    />
                </div>
            )}
        </div>
    );
}
