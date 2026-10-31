import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Percent, Wallet } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { ManageFinancesFilters } from './-components/ManageFinancesFilters';
import { ManageFinancesTable } from './-components/ManageFinancesTable';
import { fetchManageFinancesLogs, getManageFinancesQueryKey } from '@/services/manage-finances';
import { FeeSearchFilterDTO } from '@/types/manage-finances';

export const Route = createLazyFileRoute('/financial-management/manage-finances/')({
    component: () => (
        <LayoutContainer>
            <ManageFinancesLayoutPage />
        </LayoutContainer>
    ),
});

function ManageFinancesLayoutPage() {
    const { t } = useTranslation('financialManagementManageFinancesIndex');
    const terms = instituteTerms();
    const { setNavHeading } = useNavHeadingStore();
    const { getAllSessions } = useInstituteDetailsStore();

    const [selectedSessionId, setSelectedSessionId] = useState<string>('');

    const [filter, setFilter] = useState<FeeSearchFilterDTO>({
        page: 0,
        size: 20,
        sortBy: 'studentName',
        sortDirection: 'ASC',
        filters: {},
    });

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('pageTitle')}</h1>);
    }, [setNavHeading, t]);

    // Build session dropdown list
    const allSessionsLabel = t('allSessions');
    const sessions = getAllSessions();
    const sessionDropdownList = [
        allSessionsLabel,
        ...sessions.map((s: any) => s.session_name || s.id),
    ];

    const handleSessionChange = (value: string) => {
        if (value === allSessionsLabel) {
            setSelectedSessionId('');
        } else {
            const session = sessions.find(
                (s: any) => (s.session_name || s.id) === value
            );
            setSelectedSessionId(session?.id || '');
        }
    };

    const currentSessionLabel = selectedSessionId
        ? sessions.find((s: any) => s.id === selectedSessionId)?.session_name || allSessionsLabel
        : allSessionsLabel;

    const {
        data: financesData,
        isLoading,
        error,
    } = useQuery({
        queryKey: getManageFinancesQueryKey(filter),
        queryFn: () => fetchManageFinancesLogs(filter),
        staleTime: 30000,
    });

    const handlePageChange = (page: number) => {
        setFilter((prev) => ({ ...prev, page }));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleClearFilters = () => {
        setFilter((prev) => ({
            ...prev,
            page: 0,
            filters: {},
        }));
    };

    return (
        <>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta
                    name="description"
                    content={t('metaDescription')}
                />
            </Helmet>

            <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-6 duration-300 animate-in fade-in">
                {/* Page header: title + session + quick actions */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <Wallet size={20} weight="duotone" />
                        </span>
                        <div>
                            <h2 className="text-h3 font-semibold text-neutral-900">
                                {t('pageTitle')}
                            </h2>
                            <p className="mt-0.5 text-body text-neutral-500">
                                {t('redesign.subtitle', { learner: terms.learner.toLowerCase() })}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2">
                            <span className="text-body font-medium text-neutral-500">
                                {t('sessionLabel')}
                            </span>
                            <MyDropdown
                                currentValue={currentSessionLabel}
                                dropdownList={sessionDropdownList}
                                handleChange={handleSessionChange}
                                placeholder={allSessionsLabel}
                            />
                        </div>
                        <Link to="/financial-management/adjustment-approvals">
                            <MyButton buttonType="secondary" scale="medium">
                                <Percent className="mr-1 size-4" />
                                {t('redesign.adjustments')}
                            </MyButton>
                        </Link>
                        <Link to="/financial-management/pay-installments">
                            <MyButton buttonType="primary" scale="medium">
                                <HandCoins className="mr-1 size-4" />
                                {t('redesign.collectPayment')}
                            </MyButton>
                        </Link>
                    </div>
                </div>

                {/* Filters */}
                <ManageFinancesFilters
                    filter={filter}
                    onFilterChange={setFilter}
                    onClearFilters={handleClearFilters}
                    selectedSessionId={selectedSessionId}
                />

                {/* Table */}
                <ManageFinancesTable
                    data={financesData}
                    isLoading={isLoading}
                    error={error as Error}
                    currentPage={filter.page}
                    onPageChange={handlePageChange}
                    isFeeTypeFiltered={!!filter.filters.feeTypeIds?.length}
                />
            </div>
        </>
    );
}
