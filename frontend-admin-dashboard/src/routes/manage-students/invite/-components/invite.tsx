import EmptyInvitePage from '@/assets/svgs/empty-invite-page.svg';
import { InviteCardMenuOptions } from './InviteCardMenuOptions';
import { MyPagination } from '@/components/design-system/pagination';
import { usePaginationState } from '@/hooks/pagination';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { InviteLink } from '../../-components/InviteLink';
import CreateInvite from './create-invite/CreateInvite';
import { useSuspenseQuery } from '@tanstack/react-query';
import { handleFetchInviteLinks } from '@/routes/study-library/courses/course-details/-services/get-invite-links';
import { InviteLinkDataInterface } from '@/schemas/study-library/invite-links-schema';
import { getDateFromUTCString } from '@/constants/helper';
import { useState, useMemo, useCallback } from 'react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';
import { Filters } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/myFilter';
import { StudentSearchBox } from '@/components/common/student-search-box';
import { MyButton } from '@/components/design-system/button';
import { Funnel, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

export const Invite = () => {
    const { t } = useTranslation('manageStudentsInvite');
    const { page, pageSize, handlePageChange } = usePaginationState({
        initialPage: 0,
        initialPageSize: 5,
    });

    const { instituteDetails, getCourseFromPackage, getLevelsFromPackage, getSessionFromPackage } =
        useInstituteDetailsStore();

    // Filter state
    const [columnFilters, setColumnFilters] = useState<
        { id: string; value: { id: string; label: string }[] }[]
    >([]);
    const [clearFilters, setClearFilters] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [appliedPackageSessionIds, setAppliedPackageSessionIds] = useState<string[]>([]);

    // Terminology from naming settings
    const packageLabel = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const levelLabel = getTerminology(ContentTerms.Level, SystemTerms.Level);
    const sessionLabel = getTerminology(ContentTerms.Session, SystemTerms.Session);

    // Build filter options
    const packageOptions = useMemo(
        () =>
            getCourseFromPackage(undefined).map((c) => ({
                id: c.id,
                label: removeDefaultPrefix(c.name),
            })),
        [instituteDetails]
    );

    const levelOptions = useMemo(() => {
        const selectedPkgs = columnFilters.find((f) => f.id === 'package')?.value.map((v) => v.id);
        if (selectedPkgs && selectedPkgs.length === 1) {
            return getLevelsFromPackage({ courseId: selectedPkgs[0] }).map((l) => ({
                id: l.id,
                label: removeDefaultPrefix(l.name),
            }));
        }
        return getLevelsFromPackage(undefined).map((l) => ({
            id: l.id,
            label: removeDefaultPrefix(l.name),
        }));
    }, [columnFilters, instituteDetails]);

    const sessionOptions = useMemo(() => {
        const selectedPkgs = columnFilters.find((f) => f.id === 'package')?.value.map((v) => v.id);
        const selectedLvls = columnFilters.find((f) => f.id === 'level')?.value.map((v) => v.id);
        const params: { courseId?: string; levelId?: string } = {};
        if (selectedPkgs && selectedPkgs.length === 1) params.courseId = selectedPkgs[0];
        if (selectedLvls && selectedLvls.length === 1) params.levelId = selectedLvls[0];
        return getSessionFromPackage(Object.keys(params).length > 0 ? params : undefined).map(
            (s) => ({ id: s.id, label: s.name })
        );
    }, [columnFilters, instituteDetails]);

    const filterConfig = [
        { id: 'package', title: packageLabel, filterList: packageOptions },
        { id: 'level', title: levelLabel, filterList: levelOptions },
        { id: 'session', title: sessionLabel, filterList: sessionOptions },
    ];

    // Derive package_session_ids from selected filters
    const derivePackageSessionIds = useCallback(
        (filters: { id: string; value: { id: string; label: string }[] }[]) => {
            const selectedPkgs = filters.find((f) => f.id === 'package')?.value.map((v) => v.id) || [];
            const selectedLvls = filters.find((f) => f.id === 'level')?.value.map((v) => v.id) || [];
            const selectedSessions = filters.find((f) => f.id === 'session')?.value.map((v) => v.id) || [];

            if (selectedPkgs.length === 0 && selectedLvls.length === 0 && selectedSessions.length === 0) {
                return [];
            }

            const batches = instituteDetails?.batches_for_sessions || [];
            return batches
                .filter((b) => {
                    if (selectedPkgs.length > 0 && !selectedPkgs.includes(b.package_dto.id)) return false;
                    if (selectedLvls.length > 0 && !selectedLvls.includes(b.level.id)) return false;
                    if (selectedSessions.length > 0 && !selectedSessions.includes(b.session.id)) return false;
                    return true;
                })
                .map((b) => b.id);
        },
        [instituteDetails]
    );

    const handleFilterChange = (filterId: string, options: { id: string; label: string }[]) => {
        setColumnFilters((prev) => {
            const existing = prev.filter((f) => f.id !== filterId);
            if (options.length === 0) return existing;
            return [...existing, { id: filterId, value: options }];
        });
    };

    const handleFilterClick = () => {
        setAppliedPackageSessionIds(derivePackageSessionIds(columnFilters));
        setAppliedSearch(searchInput);
    };

    const handleClearFilters = () => {
        setClearFilters(true);
        setColumnFilters([]);
        setSearchInput('');
        setAppliedSearch('');
        setAppliedPackageSessionIds([]);
    };

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchInput(event.target.value);
    };

    const handleSearchEnter = () => {
        setAppliedSearch(searchInput);
    };

    const handleClearSearch = () => {
        setSearchInput('');
        setAppliedSearch('');
    };

    const hasActiveFilters =
        columnFilters.some((f) => f.value.length > 0) || Boolean(searchInput.trim());

    const {
        data: inviteList,
        isLoading,
        isError,
    } = useSuspenseQuery(
        handleFetchInviteLinks(appliedPackageSessionIds, page, pageSize, appliedSearch)
    );

    return (
        <div className="flex w-full flex-col gap-10">
            <div className="flex items-center justify-between">
                <p className="text-h3 font-semibold">
                    {t('heading.linkList', {
                        term: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
                    })}
                </p>
                <CreateInvite />
            </div>

            {/* Filters */}
            <div className="rounded-xl border border-neutral-200/50 bg-gradient-to-r from-white to-neutral-50/30 p-4 shadow-sm">
                <div className="flex flex-col gap-4">
                    <div className="w-full lg:max-w-md">
                        <StudentSearchBox
                            searchInput={searchInput}
                            searchFilter={appliedSearch}
                            onSearchChange={handleSearchChange}
                            onSearchEnter={handleSearchEnter}
                            onClearSearch={handleClearSearch}
                            placeholder={t('search.placeholder')}
                        />
                    </div>

                    <div className="flex flex-wrap gap-3">
                        {filterConfig.map((filter, index) => (
                            <div
                                key={filter.id}
                                className="animate-slideInRight"
                                style={{ animationDelay: `${index * 0.1}s` }}
                            >
                                <Filters
                                    filterDetails={{
                                        label: filter.title,
                                        filters: filter.filterList,
                                    }}
                                    onFilterChange={(values) =>
                                        handleFilterChange(filter.id, values)
                                    }
                                    clearFilters={clearFilters}
                                    filterId={filter.id}
                                    columnFilters={columnFilters}
                                />
                            </div>
                        ))}
                    </div>

                    {hasActiveFilters && (
                        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200/50 pt-2">
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                className="hover:scale-102 to-primary-600 hover:from-primary-600 hover:to-primary-700 group flex h-8 items-center gap-2 bg-gradient-to-r from-primary-500 shadow-md transition-all duration-200"
                                onClick={handleFilterClick}
                            >
                                <Funnel className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                                {t('filters.apply')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                className="hover:scale-102 group flex h-8 items-center gap-2 border border-neutral-300 bg-neutral-100 transition-all duration-200 hover:border-neutral-400 hover:bg-neutral-200 active:border-neutral-500 active:bg-neutral-300"
                                onClick={handleClearFilters}
                            >
                                <X className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                                {t('filters.resetAll')}
                            </MyButton>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex w-full flex-col gap-10">
                {isError ? (
                    <p>{t('state.error')}</p>
                ) : isLoading ? (
                    <DashboardLoader />
                ) : !inviteList || !inviteList.content || inviteList?.content.length == 0 ? (
                    <div className="flex h-[70vh] w-full flex-col items-center justify-center gap-2"> {/* design-lint-ignore: viewport-relative full-page state height, no vh design token exists */}
                        <EmptyInvitePage />
                        <p>{t('state.empty')}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-10">
                        {inviteList.content?.map(
                            (obj: InviteLinkDataInterface, index: number) => (
                                <div
                                    key={index}
                                    className="flex w-full flex-col gap-4 rounded-lg border border-neutral-300 p-6"
                                >
                                    <div className="flex items-center justify-between">
                                        <p className="text-title font-semibold">{obj.name}</p>
                                        <InviteCardMenuOptions invite={obj} />
                                    </div>
                                    <div className="flex items-center gap-12 text-body font-regular">
                                        <p>
                                            {t('card.createdOn', {
                                                date: getDateFromUTCString(obj.created_at),
                                            })}
                                        </p>
                                        <p>
                                            {t('card.acceptedBy', {
                                                count: obj.accepted_by,
                                            })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <p className="text-body font-semibold">{t('card.inviteLink')}</p>
                                        <InviteLink
                                            inviteCode={obj.invite_code || ''}
                                            inviteName={obj.name}
                                        />
                                    </div>
                                </div>
                            )
                        )}
                        <MyPagination
                            currentPage={page}
                            totalPages={inviteList.totalPages}
                            onPageChange={handlePageChange}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
