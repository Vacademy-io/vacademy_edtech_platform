import { useEffect, useMemo, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { IdentificationCard, Plus, UsersThree } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useHrRole } from '@/hooks/use-hr-role';
import { formatDate } from '@/lib/formatters';
import type { EmployeeProfileDTO } from '@/routes/erp/-shared/hr-types';
import { useDepartments, useDesignations, useEmployees } from './-hooks/use-hr-people';
import {
    buildEmploymentStatusOptions,
    buildEmploymentTypeOptions,
    EmploymentStatusChip,
    humanizeToken,
} from './-components/EmployeeFields';
import { EmployeeFormDialog } from './-components/EmployeeFormDialog';
import { HrEmptyState, HrErrorState, HrLoadingRows, HrNoAccessCard } from './-components/HrStates';
import { SingleFilterChip } from './-components/SingleFilterChip';

export const Route = createLazyFileRoute('/erp/people/')({
    component: EmployeesRoute,
});

const PAGE_SIZE = 10;

function EmployeesRoute() {
    return (
        <LayoutContainer>
            <EmployeesPage />
        </LayoutContainer>
    );
}

function EmployeesPage() {
    const { t } = useTranslation(['erpPeopleIndex', 'erpEmployeeFields']);
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);
    const employmentStatusOptions = useMemo(() => buildEmploymentStatusOptions(t), [t]);
    const employmentTypeOptions = useMemo(() => buildEmploymentTypeOptions(t), [t]);

    const navigate = useNavigate();
    const { isHrAdmin, isHrStaff } = useHrRole();

    const [page, setPage] = useState(0);
    const [status, setStatus] = useState<string | undefined>();
    const [departmentId, setDepartmentId] = useState<string | undefined>();
    const [designationId, setDesignationId] = useState<string | undefined>();
    const [employmentType, setEmploymentType] = useState<string | undefined>();
    const [addOpen, setAddOpen] = useState(false);

    const filters = useMemo(
        () => ({ page, size: PAGE_SIZE, status, departmentId, designationId, employmentType }),
        [page, status, departmentId, designationId, employmentType]
    );

    const employees = useEmployees(filters);
    const departments = useDepartments();
    const designations = useDesignations();

    const anyFilter = !!(status || departmentId || designationId || employmentType);
    /** Narrowing the list always returns to page 1 — page 4 of a two-row result is empty. */
    const applyFilter = (setter: (next: string | undefined) => void) => (next?: string) => {
        setter(next);
        setPage(0);
    };
    const clearFilters = () => {
        setStatus(undefined);
        setDepartmentId(undefined);
        setDesignationId(undefined);
        setEmploymentType(undefined);
        setPage(0);
    };

    const openEmployee = (employee: EmployeeProfileDTO) => {
        if (!employee.id) return;
        navigate({ to: '/erp/people/$employeeId', params: { employeeId: employee.id } });
    };

    const columns = useMemo<ColumnDef<EmployeeProfileDTO>[]>(
        () => [
            {
                id: 'employee_code',
                header: t('table.code'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-body text-muted-foreground">
                        {row.original.employee_code || '—'}
                    </span>
                ),
            },
            {
                id: 'full_name',
                header: t('table.name'),
                size: 200,
                cell: ({ row }) => (
                    <span className="truncate text-body font-semibold text-foreground">
                        {row.original.full_name || row.original.employee_code || t('employee')}
                    </span>
                ),
            },
            {
                id: 'department',
                header: t('table.department'),
                size: 160,
                cell: ({ row }) => (
                    <span className="truncate text-body text-foreground">
                        {row.original.department_name || '—'}
                    </span>
                ),
            },
            {
                id: 'designation',
                header: t('table.designation'),
                size: 160,
                cell: ({ row }) => (
                    <span className="truncate text-body text-foreground">
                        {row.original.designation_name || '—'}
                    </span>
                ),
            },
            {
                id: 'employment_status',
                header: t('table.status'),
                size: 140,
                cell: ({ row }) => <EmploymentStatusChip status={row.original.employment_status} />,
            },
            {
                id: 'employment_type',
                header: t('table.type'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-body text-foreground">
                        {humanizeToken(row.original.employment_type) || '—'}
                    </span>
                ),
            },
            {
                id: 'join_date',
                header: t('table.joined'),
                size: 120,
                cell: ({ row }) => (
                    <span className="text-body text-muted-foreground">
                        {row.original.join_date ? formatDate(row.original.join_date) : '—'}
                    </span>
                ),
            },
        ],
        [t]
    );

    if (!isHrStaff) {
        return (
            <div className="p-4 sm:p-6">
                <HrNoAccessCard />
            </div>
        );
    }

    const rows = employees.data?.content ?? [];
    const totalPages = employees.data?.total_pages ?? 1;
    const totalElements = employees.data?.total_elements ?? rows.length;

    return (
        <div className="flex flex-col gap-6 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h2 className="text-h2-semibold text-foreground">{t('heading')}</h2>
                    <p className="text-body text-muted-foreground">{t('subheading')}</p>
                </div>
                {isHrAdmin && (
                    <div className="flex flex-wrap items-center gap-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => navigate({ to: '/erp/people/staff-bridge' })}
                        >
                            <UsersThree size={18} /> {t('addFromStaff')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            onClick={() => setAddOpen(true)}
                        >
                            <Plus size={18} /> {t('addEmployee')}
                        </MyButton>
                    </div>
                )}
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    <SingleFilterChip
                        label={t('filters.status')}
                        options={employmentStatusOptions.map((option) => ({
                            id: option.value,
                            label: option.label,
                        }))}
                        value={status}
                        onChange={applyFilter(setStatus)}
                    />
                    <SingleFilterChip
                        label={t('filters.department')}
                        options={(departments.data ?? [])
                            .filter((row) => !!row.id)
                            .map((row) => ({
                                id: row.id as string,
                                label: row.name || (row.id as string),
                            }))}
                        value={departmentId}
                        onChange={applyFilter(setDepartmentId)}
                        disabled={(departments.data ?? []).length === 0}
                    />
                    <SingleFilterChip
                        label={t('filters.designation')}
                        options={(designations.data ?? [])
                            .filter((row) => !!row.id)
                            .map((row) => ({
                                id: row.id as string,
                                label: row.name || (row.id as string),
                            }))}
                        value={designationId}
                        onChange={applyFilter(setDesignationId)}
                        disabled={(designations.data ?? []).length === 0}
                    />
                    <SingleFilterChip
                        label={t('filters.employmentType')}
                        options={employmentTypeOptions.map((option) => ({
                            id: option.value,
                            label: option.label,
                        }))}
                        value={employmentType}
                        onChange={applyFilter(setEmploymentType)}
                    />
                </div>
                {anyFilter && (
                    <span className="text-caption text-muted-foreground">
                        {t('matchCount', { count: totalElements })}
                        {' · '}
                        <button
                            type="button"
                            className="font-semibold text-primary-500 hover:text-primary-600"
                            onClick={clearFilters}
                        >
                            {t('clearFilters')}
                        </button>
                    </span>
                )}
            </div>

            {employees.isLoading ? (
                <HrLoadingRows />
            ) : employees.isError ? (
                <HrErrorState message={t('errors.load')} onRetry={() => employees.refetch()} />
            ) : rows.length === 0 ? (
                anyFilter ? (
                    <HrEmptyState
                        title={t('empty.noMatchTitle')}
                        description={t('empty.noMatchDescription')}
                    >
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={clearFilters}
                        >
                            {t('clearFilters')}
                        </MyButton>
                    </HrEmptyState>
                ) : (
                    <HrEmptyState
                        icon={<IdentificationCard size={40} className="text-muted-foreground" />}
                        title={t('empty.noneTitle')}
                        description={t('empty.noneDescription')}
                    >
                        {isHrAdmin && (
                            <>
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => navigate({ to: '/erp/people/staff-bridge' })}
                                >
                                    <UsersThree size={18} /> {t('openStaffCoverage')}
                                </MyButton>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => setAddOpen(true)}
                                >
                                    <Plus size={18} /> {t('addEmployeeManually')}
                                </MyButton>
                            </>
                        )}
                    </HrEmptyState>
                )
            ) : (
                <div className="flex flex-col gap-3">
                    <MyTable<EmployeeProfileDTO>
                        data={{
                            content: rows,
                            total_pages: totalPages,
                            page_no: page,
                            page_size: PAGE_SIZE,
                            total_elements: totalElements,
                            last: employees.data?.last ?? true,
                        }}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={page}
                        onCellClick={(row) => openEmployee(row)}
                        scrollable
                    />
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        totalElements={totalElements}
                        pageSize={PAGE_SIZE}
                    />
                </div>
            )}

            {isHrAdmin && (
                <EmployeeFormDialog
                    open={addOpen}
                    onOpenChange={setAddOpen}
                    departments={departments.data ?? []}
                    designations={designations.data ?? []}
                />
            )}
        </div>
    );
}
