import { MyButton } from '@/components/design-system/button';
import { Funnel, X } from '@phosphor-icons/react';
import { Filters } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/myFilter';
import { StudentSearchBox } from '@/components/common/student-search-box';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { InstituteDetailsType } from '@/schemas/student/student-list/institute-schema';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { removeDefaultPrefix } from '@/utils/helpers/removeDefaultPrefix';
import { useSelectedSessionStore } from '@/stores/study-library/selected-session-store';
import { useQuery } from '@tanstack/react-query';
import { handleFetchCampaignsList } from '@/routes/audience-manager/list/-services/get-campaigns-list';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { CustomFieldMultiSelectFilter } from '@/components/shared/leads/custom-field-multi-select-filter';
import { useListCustomFieldControls } from '@/components/shared/leads/use-list-custom-field-controls';
import { fetchContactCustomFieldValues } from '../-services/get-contact-custom-field-values';
import { ManageListFiltersLink } from '@/components/shared/leads/manage-list-filters-link';
import { UtmFilterControls } from '@/components/shared/leads/utm-filter-controls';
import {
    readUtmSelection,
    utmFilterId,
    utmValueLabel,
} from '@/components/shared/leads/utm-filter-encoding';
import { useTranslation } from 'react-i18next';
import { CustomFieldRangeFilter } from '@/components/shared/leads/custom-field-range-filter';
import {
    isRangeFieldType,
    sentinelLabel,
} from '@/components/shared/leads/custom-field-filter-encoding';

interface ContactFiltersProps {
    filters: {
        searchInput: string;
        searchFilter: string;
        columnFilters: { id: string; value: { id: string; label: string }[] }[];
        handleSearchInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
        handleSearchEnter: () => void;
        handleClearSearch: () => void;
        handleFilterChange: (filterId: string, values: { id: string; label: string }[]) => void;
        handleFilterClick: () => void;
        handleClearFilters: () => void;
        getActiveFiltersState: () => boolean;
        clearFilters: boolean;
    };
}

export const ContactFilters = ({ filters }: ContactFiltersProps) => {
    const {
        searchInput,
        searchFilter,
        columnFilters,
        handleSearchInputChange,
        handleSearchEnter,
        handleClearSearch,
        handleFilterChange,
        handleFilterClick,
        handleClearFilters,
        getActiveFiltersState,
        clearFilters,
    } = filters;

    const { instituteDetails } = useInstituteDetailsStore();
    const { selectedSession } = useSelectedSessionStore();
    const instituteId = getCurrentInstituteId() || '';

    // Fetch audience/campaign list for the audience filter
    const { data: campaignsData } = useQuery(
        handleFetchCampaignsList({
            institute_id: instituteId,
            page: 0,
            size: 100,
        })
    );

    const filterConfig = buildFilterConfig(
        instituteDetails,
        selectedSession?.id || '',
        campaignsData?.content
    );

    // Custom-field filters enabled for the CONTACTS surface in Settings →
    // Display Settings → "List Filters & Sorting — Custom Fields". Selections
    // ride in columnFilters under `cf:<custom_field_id>` and apply with the
    // same "Apply Filters" button as every other chip on this page.
    const { fields: customFieldFilterFields } = useListCustomFieldControls(
        'CONTACTS',
        instituteId || undefined
    );
    const selectedCustomFieldValues = (fieldId: string): string[] =>
        columnFilters.find((f) => f.id === `cf:${fieldId}`)?.value.map((v) => v.id) ?? [];

    // Campaign (UTM) filters — rendered only while the institute's UTM setting
    // is on and this surface isn't hidden in display settings. Selections ride
    // columnFilters under `utm:<dimension>` like every other chip here.
    const { t: tUtm } = useTranslation('utmListFilters');
    const utmSelection = readUtmSelection(columnFilters);

    return (
        <div className="animate-fadeIn space-y-4">
            <div className="rounded-xl border border-neutral-200/50 bg-gradient-to-r from-white to-neutral-50/30 p-4 shadow-sm">
                <div className="flex flex-col gap-4">
                    <div className="w-full lg:max-w-md">
                        <StudentSearchBox
                            searchInput={searchInput}
                            searchFilter={searchFilter}
                            onSearchChange={handleSearchInputChange}
                            onSearchEnter={handleSearchEnter}
                            onClearSearch={handleClearSearch}
                            placeholder="Search by name"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
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
                                    onFilterChange={(values) => handleFilterChange(filter.id, values)}
                                    clearFilters={clearFilters}
                                    filterId={filter.id}
                                    columnFilters={columnFilters}
                                />
                            </div>
                        ))}
                        {customFieldFilterFields.map((field) =>
                            isRangeFieldType(field.fieldType) ? (
                                <CustomFieldRangeFilter
                                    key={field.customFieldId}
                                    fieldId={field.customFieldId}
                                    fieldName={field.fieldName}
                                    fieldType={field.fieldType}
                                    selected={selectedCustomFieldValues(field.customFieldId)}
                                    onChange={(values) =>
                                        handleFilterChange(
                                            `cf:${field.customFieldId}`,
                                            values.map((v) => ({
                                                id: v,
                                                label: sentinelLabel(v) ?? v,
                                            }))
                                        )
                                    }
                                />
                            ) : (
                                <CustomFieldMultiSelectFilter
                                    key={field.customFieldId}
                                    instituteId={instituteId}
                                    fieldId={field.customFieldId}
                                    fieldName={field.fieldName}
                                    selected={selectedCustomFieldValues(field.customFieldId)}
                                    onChange={(values) =>
                                        handleFilterChange(
                                            `cf:${field.customFieldId}`,
                                            values.map((v) => ({
                                                id: v,
                                                label: sentinelLabel(v) ?? v,
                                            }))
                                        )
                                    }
                                    fetchValues={fetchContactCustomFieldValues}
                                    variant="pill"
                                    cacheScope="contacts"
                                />
                            )
                        )}
                        <UtmFilterControls
                            surface="CONTACTS"
                            instituteId={instituteId}
                            variant="pill"
                            selection={utmSelection}
                            onChange={(dimension, values) =>
                                handleFilterChange(
                                    utmFilterId(dimension),
                                    values.map((v) => ({
                                        id: v,
                                        label: utmValueLabel(v, tUtm('untagged')),
                                    }))
                                )
                            }
                        />
                        <ManageListFiltersLink surface="CONTACTS" />
                    </div>

                    {(columnFilters.length > 0 || getActiveFiltersState()) && (
                        <div className="animate-scaleIn flex flex-wrap items-center gap-3 border-t border-neutral-200/50 pt-2">
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                layoutVariant="default"
                                className="hover:scale-102 to-primary-600 hover:from-primary-600 hover:to-primary-700 group flex h-8 items-center gap-2 bg-gradient-to-r from-primary-500 shadow-md transition-all duration-200"
                                onClick={handleFilterClick}
                            >
                                <Funnel className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                                Apply Filters
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="default"
                                className="hover:scale-102 group flex h-8 items-center gap-2 border border-neutral-300 bg-neutral-100 transition-all duration-200 hover:border-neutral-400 hover:bg-neutral-200 active:border-neutral-500 active:bg-neutral-300"
                                onClick={handleClearFilters}
                            >
                                <X className="size-3.5 transition-transform duration-200 group-hover:scale-110" />
                                Reset All
                            </MyButton>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

function buildFilterConfig(
    instituteDetails: InstituteDetailsType | null,
    currentSessionId: string,
    campaigns?: { id?: string; campaign_id?: string; audience_id?: string; campaign_name: string }[]
) {
    const filters: { id: string; title: string; filterList: { id: string; label: string }[] }[] = [];

    // Batch/Course filter
    const batches = (instituteDetails?.batches_for_sessions || [])
        .filter((batch) => batch.session.id === currentSessionId)
        .map((batch) => ({
            id: batch.id,
            label: `${removeDefaultPrefix(batch.package_dto.package_name)}${batch.level.level_name && batch.level.level_name !== 'DEFAULT' ? ` - ${removeDefaultPrefix(batch.level.level_name)}` : ''}`.trim(),
        }))
        .slice(0, 10);

    if (batches.length > 0) {
        filters.push({
            id: 'batch',
            title: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
            filterList: batches,
        });
    }

    // Status filter
    const statuses = (instituteDetails?.student_statuses || []).map((status, index) => ({
        id: index.toString(),
        label: status,
    }));
    if (statuses.length > 0) {
        filters.push({ id: 'statuses', title: 'Status', filterList: statuses });
    }

    // Gender filter
    const genders = (instituteDetails?.genders || []).map((gender, index) => ({
        id: index.toString(),
        label: gender,
    }));
    if (genders.length > 0) {
        filters.push({ id: 'gender', title: 'Gender', filterList: genders });
    }

    // Source filter (Institute Users / Audience Respondents)
    filters.push({
        id: 'source',
        title: 'Source',
        filterList: [
            { id: 'INSTITUTE', label: 'Institute Users' },
            { id: 'AUDIENCE', label: 'Audience Respondents' },
        ],
    });

    // Audience filter
    if (campaigns && campaigns.length > 0) {
        const audienceOptions = campaigns
            // The backend matches against `audience_response.audience_id`, which is the
            // campaign identifier resolved as campaign_id || id || audience_id (the same
            // resolution used throughout audience-manager). Using `c.id` alone mismatched.
            .map((c) => ({
                id: (c.campaign_id || c.id || c.audience_id) ?? '',
                label: c.campaign_name,
            }))
            .filter((o) => o.id);

        if (audienceOptions.length > 0) {
            filters.push({
                id: 'audience_list',
                title: 'Audience',
                filterList: audienceOptions,
            });
        }
    }

    return filters;
}
