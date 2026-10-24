import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDisplaySettingsWithFallback } from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, type ListCustomFieldSurface } from '@/types/display-settings';
import { useCustomFieldSetup } from '@/routes/audience-manager/list/-hooks/useCustomFieldSetup';
import { isOptionFieldType } from '@/routes/audience-manager/list/-utils/parseFieldOptions';

export interface ListCustomFieldControlField {
    customFieldId: string;
    fieldName: string;
    fieldType: string;
}

export interface ListCustomFieldControlsResult {
    /** Whether the surface has an explicit entry in listCustomFieldControls.
     *  When false the surface-specific legacy fallback applies (LEADS →
     *  leadsFilterCustomFields already folded into `fields`; STUDENTS → the
     *  caller keeps its legacy auto-expose behavior). */
    configured: boolean;
    /** Filter fields resolved against the live custom-field catalog (deleted
     *  fields drop out, order follows form_order). */
    fields: ListCustomFieldControlField[];
    /** Raw sortable field ids for this surface (consumed once custom-field
     *  sorting ships on the surface). */
    sortableFieldIds: string[];
    isLoading: boolean;
}

/**
 * Which custom fields are exposed as filter/sort controls on an admin list
 * surface (Recent Leads / Lead List, All Contacts, Students List). Configured
 * institute-wide in Settings → Display Settings → "List Filters — Custom
 * Fields" and stored in the admin display-settings blob under
 * listCustomFieldControls, with a read-fallback to the legacy
 * leadsFilterCustomFields key for LEADS.
 *
 * Gating: when no fields are enabled, `fields` is empty so the page renders no
 * custom-field controls and never calls its distinct-values API. The catalog
 * fetch only runs when at least one field is enabled.
 *
 * LEADS exception: every visible dropdown / select / radio custom field on the
 * institute's forms is exposed as a filter automatically, on top of whatever the
 * admin ticked. Option-type fields are the natural "pick a bucket" facets
 * (course applied for, city, source…) and admins expect them in Recent Leads
 * without a settings round-trip. Text / number / date fields stay opt-in.
 */
export function useListCustomFieldControls(
    surface: ListCustomFieldSurface,
    instituteId?: string
): ListCustomFieldControlsResult {
    const { data: displaySettings, isLoading: settingLoading } = useQuery({
        queryKey: ['display-settings', ADMIN_DISPLAY_SETTINGS_KEY, 'list-custom-field-controls'],
        queryFn: () => getDisplaySettingsWithFallback(ADMIN_DISPLAY_SETTINGS_KEY),
        enabled: Boolean(instituteId),
        // Refresh on mount so a just-saved settings change shows up when the
        // admin navigates back to the list page. The fetch is
        // localStorage-backed (24h cache) so this stays cheap.
        staleTime: 0,
    });

    const surfaceControls = displaySettings?.listCustomFieldControls?.[surface];
    const configured = Boolean(surfaceControls);

    const enabledIds = useMemo(() => {
        if (surfaceControls) return surfaceControls.filterFields ?? [];
        // Legacy fallback: leads filters configured before the unified controls.
        if (surface === 'LEADS') return displaySettings?.leadsFilterCustomFields ?? [];
        return [];
    }, [surfaceControls, surface, displaySettings]);

    const sortableFieldIds = useMemo(
        () => surfaceControls?.sortableFields ?? [],
        [surfaceControls]
    );

    const hasEnabled = enabledIds.length > 0;
    const autoExposeOptionFields = surface === 'LEADS';

    // Only fetch the catalog when it can contribute a filter: something is
    // enabled, or the surface auto-exposes option-type fields.
    const { data: setup, isLoading: setupLoading } = useCustomFieldSetup(
        hasEnabled || autoExposeOptionFields ? instituteId : undefined
    );

    const fields = useMemo<ListCustomFieldControlField[]>(() => {
        if (!setup) return [];
        const enabledSet = new Set(enabledIds);
        return setup
            .filter(
                (f) =>
                    enabledSet.has(f.custom_field_id) ||
                    (autoExposeOptionFields && !f.is_hidden && isOptionFieldType(f.field_type))
            )
            .sort((a, b) => (a.form_order ?? 0) - (b.form_order ?? 0))
            .map((f) => ({
                customFieldId: f.custom_field_id,
                fieldName: f.field_name,
                fieldType: f.field_type,
            }));
    }, [setup, enabledIds, autoExposeOptionFields]);

    return {
        configured,
        fields,
        sortableFieldIds,
        isLoading: settingLoading || ((hasEnabled || autoExposeOptionFields) && setupLoading),
    };
}
