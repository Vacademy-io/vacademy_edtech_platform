import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useListBuiltInFilterControls } from '@/components/shared/leads/use-list-built-in-filter-controls';
import { useLearnerLocationFilterOptions } from '@/routes/manage-students/students-list/-services/getLearnerLocationFilterOptions';
import type { FilterConfig } from '@/routes/manage-students/students-list/-types/students-list-types';
import type { StudentFilterRequest } from '@/types/student-table-types';

type ColumnFilters = { id: string; value: { id: string; label: string }[] }[];

interface UseLearnerLocationFiltersArgs {
    instituteId: string | undefined;
    appliedFilters: StudentFilterRequest;
    setColumnFilters: Dispatch<SetStateAction<ColumnFilters>>;
    setAppliedFilters: Dispatch<SetStateAction<StudentFilterRequest>>;
}

/**
 * City / Region filter chips for every learner list that uses useStudentFilters (the Learner
 * List page and a course's learners tab). Switched on or off for the whole institute from
 * "Manage filters" (Built-in filters, Students tab); on unless an admin turned them off. Their
 * options are the values this institute's learners actually have, so a chip with nothing to
 * pick (no learner has a city, say) is left out.
 */
export function useLearnerLocationFilters({
    instituteId,
    appliedFilters,
    setColumnFilters,
    setAppliedFilters,
}: UseLearnerLocationFiltersArgs): FilterConfig[] {
    const { t } = useTranslation('manageStudentsAllFilters');
    const { isVisible } = useListBuiltInFilterControls('STUDENTS');
    const showCityFilter = isVisible('city');
    const showRegionFilter = isVisible('region');
    const { data: locationOptions } = useLearnerLocationFilterOptions(
        instituteId || undefined,
        showCityFilter || showRegionFilter
    );

    // A filter switched off also stops filtering: drop a City / Region selection that is still
    // applied (e.g. from a ?city= link) once its switch is off, the same as the built-in
    // filters on the lead lists. Does nothing while both are on or nothing is picked.
    const appliedCities = appliedFilters.cities;
    const appliedRegions = appliedFilters.regions;
    useEffect(() => {
        const dropCities = !showCityFilter && (appliedCities?.length ?? 0) > 0;
        const dropRegions = !showRegionFilter && (appliedRegions?.length ?? 0) > 0;
        if (!dropCities && !dropRegions) return;
        setColumnFilters((prev) =>
            prev.filter(
                (f) => !(dropCities && f.id === 'cities') && !(dropRegions && f.id === 'regions')
            )
        );
        setAppliedFilters((prev) => {
            const next = { ...prev };
            if (dropCities) delete next.cities;
            if (dropRegions) delete next.regions;
            return next;
        });
        const params = new URLSearchParams(window.location.search);
        if (dropCities) params.delete('city');
        if (dropRegions) params.delete('region');
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }, [showCityFilter, showRegionFilter, appliedCities, appliedRegions, setColumnFilters, setAppliedFilters]);

    const locationFilters: FilterConfig[] = [];
    if (showCityFilter && locationOptions?.cities.length) {
        locationFilters.push({
            id: 'cities',
            title: t('city.title'),
            filterList: locationOptions.cities.map((o) => ({
                id: o.value,
                label: `${o.value} (${o.count})`,
            })),
        });
    }
    if (showRegionFilter && locationOptions?.regions.length) {
        locationFilters.push({
            id: 'regions',
            title: t('region.title'),
            filterList: locationOptions.regions.map((o) => ({
                id: o.value,
                label: `${o.value} (${o.count})`,
            })),
        });
    }
    return locationFilters;
}

/** Puts the City / Region chips right after Gender, the other learner-profile filter. */
export function withLocationFiltersAfterGender<T extends { id: string }>(
    baseFilters: T[],
    locationFilters: T[]
): T[] {
    const genderIndex = baseFilters.findIndex((f) => f.id === 'gender');
    return genderIndex >= 0
        ? [
              ...baseFilters.slice(0, genderIndex + 1),
              ...locationFilters,
              ...baseFilters.slice(genderIndex + 1),
          ]
        : [...baseFilters, ...locationFilters];
}
