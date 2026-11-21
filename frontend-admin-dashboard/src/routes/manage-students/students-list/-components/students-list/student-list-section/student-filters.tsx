// components/StudentFilters.tsx
import { MyButton } from '@/components/design-system/button';
import { Export, Plus, Funnel, X } from '@phosphor-icons/react';
import { Filters } from './myFilter';
import { CustomFieldMultiSelectFilter } from '@/components/shared/leads/custom-field-multi-select-filter';
import { fetchStudentCustomFieldValues } from '@/routes/manage-students/students-list/-services/get-student-custom-field-values';
import { StudentSearchBox } from '../../../../../../components/common/student-search-box';
import { StudentFiltersProps } from '@/routes/manage-students/students-list/-types/students-list-types';
import { useMemo, useRef, useState } from 'react';
import { buildExportAccountDetails } from '../../../-services/exportAccountDetails';
import { ExportColumnsDialog } from './export-columns-dialog';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { AddSessionDialog } from '@/routes/manage-institute/sessions/-components/session-operations/add-session/add-session-dialog';
import { useAddSession } from '@/services/study-library/session-management/addSession';
import { AddSessionDataType } from '@/routes/manage-institute/sessions/-components/session-operations/add-session/add-session-form';
import { toast } from 'sonner';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useCompactMode } from '@/hooks/use-compact-mode';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChipsWrapper } from '@/components/design-system/chips';
import { PlusCircle } from '@phosphor-icons/react';
import { ManageListFiltersLink } from '@/components/shared/leads/manage-list-filters-link';
import { UtmFilterControls } from '@/components/shared/leads/utm-filter-controls';
import {
    readUtmSelection,
    utmFilterId,
    utmValueLabel,
} from '@/components/shared/leads/utm-filter-encoding';
import { CustomFieldRangeFilter } from '@/components/shared/leads/custom-field-range-filter';
import { DateRangeFilter } from '@/components/design-system/date-range-filter';
import { sentinelLabel } from '@/components/shared/leads/custom-field-filter-encoding';
import { useTranslation } from 'react-i18next';

export const StudentFilters = ({
    currentSession,
    filters,
    searchInput,
    searchFilter,
    columnFilters,
    clearFilters,
    getActiveFiltersState,
    onSessionChange,
    onSearchChange,
    onSearchEnter,
    onClearSearch,
    onFilterChange,
    onFilterClick,
    onClearFilters,
    totalElements,
    appliedFilters,
    sessionList,
}: StudentFiltersProps) => {
    const [isAddSessionDiaogOpen, setIsAddSessionDiaogOpen] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const handleOpenAddSessionDialog = () => {
        if (!instituteDetails?.batches_for_sessions.length) return;
        setIsAddSessionDiaogOpen(!isAddSessionDiaogOpen);
    };
    const addSessionMutation = useAddSession();
    const [disableAddButton, setDisableAddButton] = useState(true);
    const { instituteDetails } = useInstituteDetailsStore();
    const { isCompact } = useCompactMode();
    const { t } = useTranslation('manageStudentsFilters');
    const { t: tUtm } = useTranslation('utmListFilters');
    // Campaign (UTM) filters — rendered only while the institute's UTM setting
    // is on and the Students surface isn't hidden in display settings. Their
    // selections ride columnFilters under `utm:<dimension>` like every other
    // chip, so Apply / Reset / the course learners tab all just work.
    const utmSelection = readUtmSelection(columnFilters);

    const handleAddSession = (sessionData: AddSessionDataType) => {
        const processedData = structuredClone(sessionData);

        const transformedData = {
            ...processedData,
            levels: processedData.levels.map((level) => ({
                id: level.level_dto.id,
                new_level: level.level_dto.new_level === true,
                level_name: level.level_dto.level_name,
                duration_in_days: level.level_dto.duration_in_days,
                thumbnail_file_id: level.level_dto.thumbnail_file_id,
                package_id: level.level_dto.package_id,
            })),
        };

        // Use type assertion since we know this is the correct format for the API
        addSessionMutation.mutate(
            { requestData: transformedData as unknown as AddSessionDataType },
            {
                onSuccess: () => {
                    toast.success(
                        t('session.addedSuccess', {
                            term: getTerminology(ContentTerms.Session, SystemTerms.Session),
                        })
                    );
                    setIsAddSessionDiaogOpen(false);
                },
                onError: (error) => {
                    toast.error(
                        error.message ||
                        t('session.addError', {
                            term: getTerminology(
                                ContentTerms.Session,
                                SystemTerms.Session
                            ).toLocaleLowerCase(),
                        })
                    );
                },
            }
        );
    };

    const formSubmitRef = useRef(() => { });

    const submitButton = (
        <div className="flex items-center justify-end">
            <MyButton
                type="submit"
                buttonType="primary"
                layoutVariant="default"
                scale="large"
                className="w-36"
                disable={disableAddButton}
                onClick={() => formSubmitRef.current()}
            >
                {t('session.addButton')}
            </MyButton>
        </div>
    );

    const submitFn = (fn: () => void) => {
        formSubmitRef.current = fn;
    };

    const isFilterActive = useMemo(() => {
        return getActiveFiltersState();
    }, [columnFilters, searchFilter]);

    const handleExportClick = () => {
        setIsExportDialogOpen(true);
    };

    const handleExportAccountDetails = async () => {
        await buildExportAccountDetails(t)({ pageNo: 0, pageSize: totalElements || 0, filters: appliedFilters });
    };

    return (
        <div className="animate-fadeIn space-y-4">
            {/* Top section with session selector and export buttons.
                Mobile: Session row + 2-col Export grid row.
                lg+: All side-by-side in a single row. */}
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                {/* Session selector */}
                <div className="min-w-0 w-full max-w-xs lg:flex-1">
                    {sessionList.length == 0 ? (
                        <AddSessionDialog
                            isAddSessionDiaogOpen={isAddSessionDiaogOpen}
                            handleOpenAddSessionDialog={handleOpenAddSessionDialog}
                            handleSubmit={handleAddSession}
                            trigger={
                                <div className="group relative">
                                    <MyButton
                                        buttonType="text"
                                        className={cn(
                                            "hover:scale-102 group flex items-center gap-2 text-primary-500 transition-all duration-200 disabled:text-primary-300",
                                            isCompact ? "text-xs px-2 py-1" : ""
                                        )}
                                        disable={!instituteDetails?.batches_for_sessions.length}
                                    >
                                        <Plus className={cn("transition-transform duration-200 group-hover:scale-110", isCompact ? "size-3" : "size-4")} />
                                        <span className="hidden sm:inline">{t('session.addNewSession')}</span>
                                        <span className="sm:hidden">{t('session.addSessionShort')}</span>
                                    </MyButton>
                                    {!instituteDetails?.batches_for_sessions.length && (
                                        <p className="-mt-1 text-center text-2xs text-neutral-400">
                                            {t('session.createCourseFirst')}
                                        </p>
                                    )}
                                </div>
                            }
                            submitButton={submitButton}
                            setDisableAddButton={setDisableAddButton}
                            submitFn={submitFn}
                        />
                    ) : (
                        <div className="group">
                            <MyDropdown
                                currentValue={currentSession}
                                dropdownList={sessionList}
                                placeholder={t('session.selectPlaceholder')}
                                handleChange={onSessionChange}
                            />
                        </div>
                    )}
                </div>

                {/* Export buttons — 2-col grid on mobile with full labels, inline row on sm+ */}
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
                    <MyButton
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="default"
                        onAsyncClick={handleExportAccountDetails}
                        loadingText={t('export.exportingLoading')}
                        className={cn(
                            "hover:scale-102 group flex items-center justify-center gap-1.5 bg-gradient-to-r from-neutral-50 to-neutral-100 transition-all duration-200 hover:from-neutral-100 hover:to-neutral-200",
                            isCompact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-xs sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
                        )}
                    >
                        <Export className={cn("shrink-0 transition-transform duration-200 group-hover:scale-110", isCompact ? "size-3" : "size-3.5 sm:size-4")} />
                        <span className="truncate sm:hidden">{t('export.accountDetails.short')}</span>
                        <span className="hidden truncate sm:inline md:hidden">{t('export.accountDetails.medium')}</span>
                        <span className="hidden truncate md:inline">{t('export.accountDetails.full')}</span>
                    </MyButton>
                    <MyButton
                        scale="medium"
                        buttonType="secondary"
                        layoutVariant="default"
                        id="export-data"
                        onClick={handleExportClick}
                        className={cn(
                            "hover:scale-102 group flex items-center justify-center gap-1.5 border-emerald-200 bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 transition-all duration-200 hover:from-emerald-100 hover:to-emerald-200",
                            isCompact ? "px-2 py-1 text-xs" : "px-2.5 py-1.5 text-xs sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
                        )}
                    >
                        <Export className={cn("shrink-0 transition-transform duration-200 group-hover:scale-110", isCompact ? "size-3" : "size-3.5 sm:size-4")} />
                        <span className="truncate sm:hidden">{t('export.data.short')}</span>
                        <span className="hidden truncate sm:inline md:hidden">{t('export.data.medium')}</span>
                        <span className="hidden truncate md:inline">{t('export.data.full')}</span>
                    </MyButton>
                </div>
            </div>

            {/* Filters and search section */}
            <div className={cn(
                "rounded-xl border border-neutral-200/50 bg-gradient-to-r from-white to-neutral-50/30 shadow-sm",
                isCompact ? "p-2" : "p-4"
            )}>
                <div className={cn("flex flex-col", isCompact ? "gap-2" : "gap-4")}>
                    {/* Search box */}
                    <div className="w-full lg:max-w-md">
                        <StudentSearchBox
                            searchInput={searchInput}
                            searchFilter={searchFilter}
                            onSearchChange={onSearchChange}
                            onSearchEnter={onSearchEnter}
                            onClearSearch={onClearSearch}
                        />
                    </div>

                    {/* Filter chips */}
                    <div className="flex flex-wrap gap-3">
                        {filters.map((filter, index) => (
                            <div
                                key={filter.id}
                                className="animate-slideInRight"
                                style={{ animationDelay: `${index * 0.1}s` }}
                            >
                                {filter.kind === 'DATE_RANGE' ? (
                                    <div className="hover:scale-102 group transition-all duration-200">
                                        <Popover>
                                            <PopoverTrigger className="flex items-center">
                                                <button type="button">
                                                    <ChipsWrapper
                                                        className={cn(
                                                            dateRangeLabel(columnFilters, filter.id)
                                                                ? 'border-primary-500 bg-primary-100'
                                                                : 'hover:border-primary-500 hover:bg-primary-50'
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <PlusCircle className="size-4 text-neutral-600" />
                                                            <div className="flex items-center text-body text-neutral-600">
                                                                {dateRangeLabel(columnFilters, filter.id)
                                                                    ? `${filter.title}: ${dateRangeLabel(columnFilters, filter.id)}`
                                                                    : filter.title}
                                                            </div>
                                                        </div>
                                                    </ChipsWrapper>
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent align="start" className="w-auto">
                                                <DateRangeFilter
                                                    onChange={(result) =>
                                                        onFilterChange(
                                                            filter.id,
                                                            result
                                                                ? [
                                                                      {
                                                                          id: `from:${result.startDate}`,
                                                                          label: result.startDate,
                                                                      },
                                                                      {
                                                                          id: `to:${result.endDate}`,
                                                                          label: result.endDate,
                                                                      },
                                                                  ]
                                                                : []
                                                        )
                                                    }
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                ) : filter.kind === 'CUSTOM_FIELD_RANGE' && filter.customFieldId ? (
                                    <CustomFieldRangeFilter
                                        fieldId={filter.customFieldId}
                                        fieldName={filter.title}
                                        fieldType={filter.fieldType ?? 'NUMBER'}
                                        selected={
                                            columnFilters
                                                .find((f) => f.id === filter.id)
                                                ?.value.map((v) => v.id) || []
                                        }
                                        onChange={(values) =>
                                            onFilterChange(
                                                filter.id,
                                                values.map((v) => ({
                                                    id: v,
                                                    label: sentinelLabel(v) ?? v,
                                                }))
                                            )
                                        }
                                    />
                                ) : filter.kind === 'CUSTOM_FIELD_SEARCH' && filter.customFieldId ? (
                                    <CustomFieldMultiSelectFilter
                                        instituteId={instituteDetails?.id || ''}
                                        fieldId={filter.customFieldId}
                                        fieldName={filter.title}
                                        selected={
                                            columnFilters
                                                .find((f) => f.id === filter.id)
                                                ?.value.map((v) => v.id) || []
                                        }
                                        onChange={(values) =>
                                            onFilterChange(
                                                filter.id,
                                                values.map((v) => ({
                                                    id: v,
                                                    label: sentinelLabel(v) ?? v,
                                                }))
                                            )
                                        }
                                        fetchValues={fetchStudentCustomFieldValues}
                                        variant="pill"
                                        cacheScope="students"
                                    />
                                ) : (
                                    <Filters
                                        filterDetails={{
                                            label: filter.title,
                                            filters: filter.filterList.map((filter) => ({
                                                id: filter.id,
                                                label: filter.label,
                                            })),
                                        }}
                                        onFilterChange={(values) => onFilterChange(filter.id, values)}
                                        clearFilters={clearFilters}
                                        filterId={filter.id}
                                        columnFilters={columnFilters}
                                    />
                                )}
                            </div>
                        ))}
                        <UtmFilterControls
                            surface="STUDENTS"
                            instituteId={instituteDetails?.id || ''}
                            variant="pill"
                            selection={utmSelection}
                            onChange={(dimension, values) =>
                                onFilterChange(
                                    utmFilterId(dimension),
                                    values.map((v) => ({
                                        id: v,
                                        label: utmValueLabel(v, tUtm('untagged')),
                                    }))
                                )
                            }
                        />
                        <ManageListFiltersLink surface="STUDENTS" />
                    </div>

                    {/* Filter action buttons */}
                    {(columnFilters.length > 0 || isFilterActive) && (
                        <div className="animate-scaleIn flex flex-wrap items-center gap-3 border-t border-neutral-200/50 pt-2">
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                className="hover:scale-102 to-primary-600 hover:from-primary-600 hover:to-primary-700 group flex h-8 items-center gap-2 bg-gradient-to-r from-primary-500 shadow-md transition-all duration-200"
                                onClick={onFilterClick}
                            >
                                <Funnel className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                                {t('actions.applyFilters')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                className="hover:scale-102 group flex h-8 items-center gap-2 border border-neutral-300 bg-neutral-100 transition-all duration-200 hover:border-neutral-400 hover:bg-neutral-200 active:border-neutral-500 active:bg-neutral-300"
                                onClick={onClearFilters}
                            >
                                <X className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                                {t('actions.resetAll')}
                            </MyButton>
                        </div>
                    )}
                </div>
            </div>

            <ExportColumnsDialog
                open={isExportDialogOpen}
                onOpenChange={setIsExportDialogOpen}
                appliedFilters={appliedFilters}
                totalElements={totalElements || 0}
            />
        </div>
    );
};

/** "03/10/2026 - 17/10/2026" for the chip label, or '' when nothing is picked. */
function dateRangeLabel(
    columnFilters: { id: string; value: { id: string; label: string }[] }[],
    filterId: string
): string {
    const values = columnFilters.find((f) => f.id === filterId)?.value ?? [];
    const from = values.find((v) => v.id.startsWith('from:'))?.label;
    const to = values.find((v) => v.id.startsWith('to:'))?.label;
    return from && to ? `${from} - ${to}` : '';
}
