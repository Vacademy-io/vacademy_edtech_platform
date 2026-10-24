import { useEffect, useState } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { MyButton } from '@/components/design-system/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useHrRole } from '@/hooks/use-hr-role';
import { useDepartments, useDesignations, useEmployee } from '../-hooks/use-hr-people';
import { EmploymentStatusChip, type EmployeeDetailTab } from '../-components/EmployeeFields';
import { EmployeeEmploymentTab } from '../-components/EmployeeEmploymentTab';
import { EmployeeFormDialog } from '../-components/EmployeeFormDialog';
import { EmployeeProfileTab } from '../-components/EmployeeProfileTab';
import { EmployeeSalaryTab } from '../-components/EmployeeSalaryTab';
import { HrErrorState, HrLoadingRows, HrNoAccessCard, HrEmptyState } from '../-components/HrStates';

export const Route = createLazyFileRoute('/erp/people/$employeeId/')({
    component: EmployeeDetailRoute,
});

function EmployeeDetailRoute() {
    return (
        <LayoutContainer>
            <EmployeeDetailPage />
        </LayoutContainer>
    );
}

function EmployeeDetailPage() {
    const { t } = useTranslation('erpEmployeeDetail');
    const { employeeId } = Route.useParams();
    const { tab = 'profile' } = Route.useSearch();
    const navigate = useNavigate();

    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('navHeading')}</h1>);
    }, [setNavHeading, t]);

    const { isHrAdmin, isHrStaff } = useHrRole();
    const employeeQuery = useEmployee(employeeId);
    const departments = useDepartments();
    const designations = useDesignations();
    const [editOpen, setEditOpen] = useState(false);

    const setTab = (next: EmployeeDetailTab) =>
        navigate({
            to: '.',
            search: next === 'profile' ? {} : { tab: next },
            replace: true,
        });

    if (!isHrStaff) {
        return (
            <div className="p-4 sm:p-6">
                <HrNoAccessCard />
            </div>
        );
    }

    const employee = employeeQuery.data;

    return (
        <div className="flex flex-col gap-6 p-4 sm:p-6">
            <MyButton
                type="button"
                buttonType="text"
                scale="small"
                className="w-fit"
                onClick={() => navigate({ to: '/erp/people' })}
            >
                <ArrowLeft size={16} /> {t('backButton')}
            </MyButton>

            {employeeQuery.isLoading ? (
                <HrLoadingRows rows={4} />
            ) : employeeQuery.isError ? (
                <HrErrorState
                    message={t('errorMessage')}
                    onRetry={() => employeeQuery.refetch()}
                />
            ) : !employee ? (
                <HrEmptyState
                    title={t('emptyTitle')}
                    description={t('emptyDescription')}
                />
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-h2-semibold text-foreground">
                            {employee.full_name || employee.employee_code || t('fallbackName')}
                        </h2>
                        <EmploymentStatusChip status={employee.employment_status} />
                        {employee.employee_code && (
                            <span className="text-body text-muted-foreground">
                                {employee.employee_code}
                            </span>
                        )}
                    </div>

                    <Tabs value={tab} onValueChange={(value) => setTab(value as EmployeeDetailTab)}>
                        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
                            <TabsTrigger value="profile">{t('tabs.profile')}</TabsTrigger>
                            <TabsTrigger value="salary">{t('tabs.salary')}</TabsTrigger>
                            <TabsTrigger value="employment">{t('tabs.employment')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="profile" className="mt-6">
                            <EmployeeProfileTab
                                employee={employee}
                                canEdit={isHrAdmin}
                                onEdit={() => setEditOpen(true)}
                            />
                        </TabsContent>
                        <TabsContent value="salary" className="mt-6">
                            <EmployeeSalaryTab employeeId={employeeId} />
                        </TabsContent>
                        <TabsContent value="employment" className="mt-6">
                            <EmployeeEmploymentTab employee={employee} canEdit={isHrAdmin} />
                        </TabsContent>
                    </Tabs>

                    {/*
                     * Bank details, documents and leave balances are separate endpoints and
                     * separate screens — deliberately not stubbed here as empty tabs.
                     */}

                    {isHrAdmin && (
                        <EmployeeFormDialog
                            open={editOpen}
                            onOpenChange={setEditOpen}
                            employee={employee}
                            departments={departments.data ?? []}
                            designations={designations.data ?? []}
                        />
                    )}
                </>
            )}
        </div>
    );
}
