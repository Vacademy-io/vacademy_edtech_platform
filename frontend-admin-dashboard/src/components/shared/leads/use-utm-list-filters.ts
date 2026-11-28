import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDisplaySettingsWithFallback } from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, type ListCustomFieldSurface } from '@/types/display-settings';
import { useUtmBuilderEnabled } from '@/hooks/use-utm-builder-enabled';
import {
    CORE_UTM_FILTER_DIMENSIONS,
    EMPTY_UTM_FILTER_OPTIONS,
    UTM_FILTER_DIMENSIONS,
    fetchUtmFilterOptions,
    utmFilterOptionsQueryKey,
    type UtmFilterDimension,
    type UtmFilterOptions,
} from '@/services/utm-list-filters';

export interface UtmListFilterDimensionConfig {
    dimension: UtmFilterDimension;
    /** Values to offer — distinct recorded values plus the institute's own pick lists. */
    options: string[];
}

export interface UtmListFiltersResult {
    /**
     * Whether the campaign filters render on this surface at all. Requires the
     * institute's UTM setting to be ON, and the surface not to be explicitly
     * hidden in display settings. Pessimistic (false) until both are known.
     */
    enabled: boolean;
    /** Dimensions to render, in display order, each with its option list. */
    dimensions: UtmListFilterDimensionConfig[];
    /** Raw distinct values from the data — for callers that build their own controls. */
    options: UtmFilterOptions;
    isLoading: boolean;
}

const OPTIONS_KEY: Record<UtmFilterDimension, keyof Omit<UtmFilterOptions, 'total_touches'>> = {
    source: 'sources',
    medium: 'mediums',
    campaign: 'campaigns',
    content: 'contents',
    term: 'terms',
    source_type: 'source_types',
};

/**
 * Which campaign (UTM) filters an admin list surface shows, and what each
 * dropdown offers.
 *
 * Three inputs, resolved from one cached request each:
 *  - the institute UTM setting (the master switch — the same query key the
 *    share surfaces gate "Generate UTM link" on, so a flip in Settings shows up
 *    everywhere at once);
 *  - the ADMIN display-settings blob's listUtmFilterControls[surface] — the
 *    per-surface override; absent = follow the master switch, which is what
 *    "filters switch on automatically when UTM is enabled" means in practice;
 *  - the distinct-values endpoint, so the option lists are exactly what the
 *    data holds. The institute's curated source / medium pick lists are
 *    unioned in, so a campaign that was set up in Settings but has not brought
 *    anyone yet is still selectable.
 *
 * Nothing is fetched beyond the settings read until the master switch is on,
 * so institutes that never use campaign links pay one cached settings read.
 */
export function useUtmListFilters(
    surface: ListCustomFieldSurface,
    instituteId?: string
): UtmListFiltersResult {
    const utm = useUtmBuilderEnabled();

    const { data: displaySettings, isLoading: settingsLoading } = useQuery({
        // Same key as useListCustomFieldControls so the "Manage filters" popup's
        // invalidation refreshes both families of controls in one go.
        queryKey: ['display-settings', ADMIN_DISPLAY_SETTINGS_KEY, 'list-custom-field-controls'],
        queryFn: () => getDisplaySettingsWithFallback(ADMIN_DISPLAY_SETTINGS_KEY),
        enabled: Boolean(instituteId) && utm.enabled,
        staleTime: 0,
    });

    const surfaceControls = displaySettings?.listUtmFilterControls?.[surface];
    const enabled = utm.enabled && surfaceControls?.enabled !== false;

    const { data: options, isLoading: optionsLoading } = useQuery({
        queryKey: utmFilterOptionsQueryKey(instituteId ?? ''),
        queryFn: () => fetchUtmFilterOptions(instituteId ?? ''),
        enabled: Boolean(instituteId) && enabled,
        staleTime: 60 * 1000,
    });

    const dimensions = useMemo<UtmListFilterDimensionConfig[]>(() => {
        if (!enabled) return [];
        const data = options ?? EMPTY_UTM_FILTER_OPTIONS;
        const pinned = surfaceControls?.dimensions;
        const active: UtmFilterDimension[] = pinned
            ? UTM_FILTER_DIMENSIONS.filter((d) => pinned.includes(d))
            : UTM_FILTER_DIMENSIONS.filter(
                  (d) => CORE_UTM_FILTER_DIMENSIONS.includes(d) || data[OPTIONS_KEY[d]].length > 0
              );
        return active.map((dimension) => {
            const fromData = data[OPTIONS_KEY[dimension]];
            const curated =
                dimension === 'source'
                    ? utm.settings.sources
                    : dimension === 'medium'
                      ? utm.settings.mediums
                      : [];
            const merged = Array.from(
                new Set([...fromData, ...curated.map((v) => v.toLowerCase())])
            ).sort((a, b) => a.localeCompare(b));
            return { dimension, options: merged };
        });
    }, [enabled, options, surfaceControls, utm.settings.sources, utm.settings.mediums]);

    return {
        enabled,
        dimensions,
        options: options ?? EMPTY_UTM_FILTER_OPTIONS,
        isLoading: !utm.isResolved || (enabled && (settingsLoading || optionsLoading)),
    };
}
