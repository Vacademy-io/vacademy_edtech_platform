import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getInstituteId } from '@/constants/helper';
import {
    GET_CUSTOM_FIELD_LIST_WITH_USAGE,
    GET_INSITITUTE_SETTINGS,
    UPDATE_CUSTOM_FIELD_SETTINGS,
} from '@/constants/urls';
import { resolveSystemFieldAccessor } from '@/components/design-system/utils/constants/system-field-columns';
import { parseFieldOptions } from '@/routes/audience-manager/list/-utils/parseFieldOptions';

const CUSTOM_FIELD_SETTINGS_KEY = 'CUSTOM_FIELD_SETTING';
const LOCALSTORAGE_KEY = 'custom-field-settings-cache';
const CACHE_EXPIRY_HOURS = 24; // Cache expires after 24 hours

export const CUSTOM_FIELD_TYPES = [
    { value: 'text', label: 'Text Field' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'number', label: 'Number' },
    { value: 'email', label: 'Email' },
    { value: 'url', label: 'URL' },
    { value: 'date', label: 'Date' },
    { value: 'phone', label: 'Phone Number' },
    { value: 'textarea', label: 'Text Area (Multiline)' },
    { value: 'checkbox', label: 'Checkbox (Yes/No)' },
    { value: 'radio', label: 'Radio Buttons' },
    { value: 'file', label: 'File Upload' },
    { value: 'multi_select', label: 'Multi-Select Checkboxes' },
] as const;

export type CustomFieldType =
    | 'text'
    | 'dropdown'
    | 'number'
    | 'email'
    | 'url'
    | 'date'
    | 'phone'
    | 'textarea'
    | 'checkbox'
    | 'radio'
    | 'file'
    | 'multi_select';

// Sentinel value for the "All Files" option in a file-field's allowed-types
// list. Selecting it is equivalent to leaving the list empty (no restriction)
// but is explicit in the UI and in stored config, so admins don't have to
// know that "check nothing" means "allow anything."
export const ALL_FILES_VALUE = 'all';

export const COMMON_FILE_TYPES: Array<{ value: string; label: string }> = [
    { value: ALL_FILES_VALUE, label: 'All Files' },
    { value: 'pdf', label: 'PDF' },
    { value: 'doc', label: 'DOC' },
    { value: 'docx', label: 'DOCX' },
    { value: 'xls', label: 'XLS' },
    { value: 'xlsx', label: 'XLSX' },
    { value: 'csv', label: 'CSV' },
    { value: 'png', label: 'PNG' },
    { value: 'jpg', label: 'JPG' },
    { value: 'jpeg', label: 'JPEG' },
    { value: 'gif', label: 'GIF' },
    { value: 'svg', label: 'SVG' },
    { value: 'mp4', label: 'MP4' },
    { value: 'mp3', label: 'MP3' },
    { value: 'zip', label: 'ZIP' },
    { value: 'txt', label: 'TXT' },
];

// True when the allowed-types list places no real restriction on uploads:
// unset, empty, or explicitly set to "All Files".
export const isUnrestrictedFileTypes = (allowed?: string[] | null): boolean =>
    !allowed || allowed.length === 0 || allowed.includes(ALL_FILES_VALUE);

// Config JSON structure for dropdown options
export interface DropdownOptionConfig {
    id: number;
    value: string;
    label: string;
}

// Full config structure stored in the `config` column as JSON.
// For dropdown/radio, we historically stored a bare array of DropdownOptionConfig.
// For other types we use this object form with optional extras.
export interface CustomFieldFullConfig {
    options?: DropdownOptionConfig[];
    defaultValue?: string;
    min?: number;
    max?: number;
    minDate?: string;
    maxDate?: string;
    maxLength?: number;
    countryCode?: string;
    allowedFileTypes?: string[];
    maxSizeMB?: number;
    // Optional bold section heading rendered above the description block
    // (e.g. a "Terms & Conditions" title). Pairs with `description`.
    heading?: string;
    // Long descriptive body rendered above the input (e.g. a Terms & Conditions
    // block above a "Yes, I agree" checkbox). Lives in config because fieldName
    // is varchar(255); config is unbounded text. extractConfigExtras forwards
    // it verbatim through buildConfigJson.
    description?: string;
}

// API Response Types (what we get from GET_INSITITUTE_SETTINGS)
export interface ApiCustomField {
    id: string;
    customFieldId: string;
    instituteId: string;
    groupName: string | null;
    fieldName: string;
    fieldType: CustomFieldType;
    individualOrder: number;
    groupInternalOrder: number | null;
    canBeDeleted: boolean;
    canBeEdited: boolean;
    canBeRenamed: boolean;
    locations: string[];
    status: string;
    config?: string; // JSON string for type-specific config (dropdown/radio options, default values, etc.)
}

export interface ApiGroupField {
    id: string;
    customFieldId: string;
    instituteId: string;
    groupName: string;
    fieldName: string;
    fieldType: CustomFieldType;
    individualOrder: number;
    groupInternalOrder: number;
    canBeDeleted: boolean;
    canBeEdited: boolean;
    canBeRenamed: boolean;
    locations: string[];
    status: string;
    config?: string; // JSON string for dropdown options: [{id: number, value: string, label: string}]
}

export interface ApiCustomFieldResponse {
    key: string;
    name: string;
    data: {
        data: {
            groupNames: string[] | null;
            customFieldsNames: string[];
            currentCustomFieldsAndGroups: ApiCustomField[];
            customGroup: Record<string, ApiGroupField>;
            compulsoryCustomFields: string[];
            fixedCustomFields: string[];
            allCustomFields: string[];
            fixedFieldRenameDtos: Array<{
                key: string;
                defaultValue: string;
                customValue: string;
                order: number;
                visibility: boolean;
            }>;
            customFieldLocations: string[];
        };
    };
}

export interface ApiCustomFieldUsageItem {
    custom_field: {
        id: string; // uuid
        fieldKey: string;
        fieldName: string;
        fieldType: string;
        instituteId: string;
        status: string;
        config?: string;
    };
    enroll_invite_count: number;
    audience_count: number;
    session_count: number;
    assessment_count: number;
    default?: boolean;
}

export type ApiCustomFieldUsageResponse = ApiCustomFieldUsageItem[];

// API Request Types (what we send to UPDATE_CUSTOM_FIELD_SETTINGS)
// Note: The API expects snake_case field names
export interface ApiCustomFieldRequest {
    custom_fields_and_groups: ApiCustomField[];
    custom_group: Record<string, ApiGroupField>;
    custom_fields_names: string[];
    compulsory_custom_fields: string[];
    fixed_custom_fields: string[];
    all_custom_fields: string[];
    custom_field_locations: string[];
    group_names?: string[];
    fixed_field_rename_dtos: Array<{
        key: string;
        defaultValue: string;
        customValue: string;
        order: number;
        visibility: boolean;
    }>;
}

// System Field (for fixedFieldRenameDtos)
export interface SystemField {
    key: string;
    defaultValue: string;
    customValue: string;
    order: number;
    visibility: boolean;
}

export interface CustomFieldUsage {
    enrollInviteCount: number;
    audienceCount: number;
    sessionCount: number;
    assessmentCount: number;
    isDefault: boolean;
}

// Field Visibility Interface
//
// Custom Fields Revamp (2026-04): the per-feature locations
// (Invite List, Enroll Request List, Assessment Registration, Live Session
// Registration, Campaign, Enquiry) were removed. Per-feature visibility is
// now controlled by `institute_custom_fields` rows with the right `type`
// and `type_id` (ENROLL_INVITE, AUDIENCE_FORM, SESSION, ASSESSMENT) created
// from each feature's create/edit dialog.
//
// What remains here are only the institute-side admin views where the
// settings page directly controls visibility:
//   - learnersList     → admin learner table columns
//   - learnerEnrollment → admin "enroll learner" form
//   - learnerProfile   → admin learner profile drawer
export interface FieldVisibility {
    learnersList: boolean;
    learnerEnrollment: boolean;
    learnerProfile: boolean;
}

// Custom Field (fully editable)
export interface CustomField {
    id: string; // uuid
    name: string;
    type: CustomFieldType;
    options?: string[]; // for dropdown/radio
    defaultValue?: string;
    fieldConfig?: CustomFieldFullConfig; // type-specific extras (min/max, allowedFileTypes, etc.)
    required: boolean;
    visibility: FieldVisibility;
    order: number;
    canBeDeleted: boolean;
    canBeEdited: boolean;
    canBeRenamed: boolean;
    groupName: string | null;
    usage?: CustomFieldUsage;
}

// Type for creating new custom fields (without ID - backend will assign)
export interface NewCustomField {
    name: string;
    type: CustomFieldType;
    options?: string[];
    defaultValue?: string;
    fieldConfig?: CustomFieldFullConfig;
    visibility: FieldVisibility;
    required: boolean;
    order?: number;
}

export interface FixedField {
    id: string; // customFieldId from API
    name: string;
    type: CustomFieldType;
    options?: string[];
    defaultValue?: string;
    fieldConfig?: CustomFieldFullConfig;
    visibility: FieldVisibility;
    required: boolean;
    canBeDeleted: boolean;
    canBeEdited: boolean;
    canBeRenamed: boolean;
    order: number;
    groupName: string | null; // Comma-separated group names if field is in multiple groups
    usage?: CustomFieldUsage;
}

export interface FieldGroup {
    id: string;
    name: string;
    fields: GroupField[];
    order: number;
}

export interface GroupField {
    id: string; // customFieldId from API
    name: string;
    type: CustomFieldType;
    options?: string[];
    defaultValue?: string;
    fieldConfig?: CustomFieldFullConfig;
    visibility: FieldVisibility;
    required: boolean;
    canBeDeleted: boolean;
    canBeEdited: boolean;
    canBeRenamed: boolean;
    order: number;
    groupInternalOrder: number;
    groupName: string | null; // Comma-separated group names if field is in multiple groups
}

// Type for creating new group fields (without ID - backend will assign)
export interface NewGroupField {
    name: string;
    type: CustomFieldType;
    options?: string[];
    visibility: FieldVisibility;
    required: boolean;
    groupInternalOrder: number;
}

export interface CustomFieldSettingsData {
    systemFields: SystemField[]; // System fields from fixedFieldRenameDtos
    fixedFields: FixedField[];
    instituteFields: CustomField[];
    customFields: CustomField[];
    fieldGroups: FieldGroup[];
    lastUpdated?: string;
    version?: number;
}

interface CachedCustomFieldSettings {
    data: CustomFieldSettingsData;
    timestamp: number;
    instituteId: string;
}

// Location mapping dictionary — only the three admin-side locations remain.
// The six per-feature locations were removed in the custom fields revamp.
// See FieldVisibility above for the rationale.
const LOCATION_TO_VISIBILITY_MAP: Record<string, keyof FieldVisibility> = {
    "Learner's List": 'learnersList',
    "Learner's Enrollment": 'learnerEnrollment',
    'Learner Profile': 'learnerProfile',
};

const VISIBILITY_TO_LOCATION_MAP: Record<keyof FieldVisibility, string> = {
    learnersList: "Learner's List",
    learnerEnrollment: "Learner's Enrollment",
    learnerProfile: 'Learner Profile',
};

// System field identifiers (fieldName from API)
const SYSTEM_FIELD_NAMES = ['full name', 'email', 'phone number'];

/**
 * Convert options array (UI format) to config JSON string (API format)
 * @param options - Array of option strings from the UI
 * @returns JSON string with format: [{id: number, value: string, label: string}]
 */
export const optionsToConfigJson = (options?: string[]): string | undefined => {
    if (!options || options.length === 0) {
        return undefined;
    }

    const config: DropdownOptionConfig[] = options.map((option, index) => ({
        id: index + 1,
        value: option,
        label: option,
    }));

    return JSON.stringify(config);
};

/**
 * Convert config JSON string (API format) to options array (UI format)
 * Handles every stored shape (see parseFieldOptions):
 *   1. Bare array: [{id, value, label}] — the original dropdown-options-only format
 *   2. Object with `options`: {options: [...], defaultValue, ...} — new richer format
 *   3. Legacy {coommaSepartedOptions: "A,B"} and bare "A,B" strings
 * @param configJson - JSON string from API
 * @returns Array of option strings for the UI, or undefined
 */
export const configJsonToOptions = (configJson?: string): string[] | undefined => {
    if (!configJson) {
        return undefined;
    }

    // parseFieldOptions also reads the legacy {"coommaSepartedOptions":"A,B"} and bare
    // "A,B" shapes, which used to come back undefined and render the field as plain text.
    const options = parseFieldOptions(configJson);
    return options.length > 0 ? options : undefined;
};

/**
 * Parse the full config object from a config JSON string.
 * For legacy bare-array format, returns `{options}` only.
 * For object format, returns all top-level keys.
 */
export const configJsonToFullConfig = (configJson?: string): CustomFieldFullConfig | undefined => {
    if (!configJson) return undefined;
    try {
        const parsed = JSON.parse(configJson);
        if (Array.isArray(parsed)) {
            return { options: parsed as DropdownOptionConfig[] };
        }
        if (parsed && typeof parsed === 'object') {
            return parsed as CustomFieldFullConfig;
        }
    } catch (error) {
        console.error('❌ [DEBUG] Error parsing full config JSON:', error);
    }
    return undefined;
};

/**
 * Build the config JSON string for the API from UI state.
 * - If only `options` are present (no extras), returns the legacy bare-array format
 *   for backward compatibility with existing dropdown consumers.
 * - Otherwise, returns an object with `options`, `defaultValue`, and any extras.
 */
export const buildConfigJson = (
    options?: string[],
    defaultValue?: string,
    extras?: Partial<CustomFieldFullConfig>
): string | undefined => {
    const hasOptions = options && options.length > 0;
    const hasDefault = defaultValue !== undefined && defaultValue !== '';
    const hasExtras = extras && Object.keys(extras).some((k) => (extras as any)[k] !== undefined);

    if (!hasOptions && !hasDefault && !hasExtras) {
        return undefined;
    }

    if (hasOptions && !hasDefault && !hasExtras) {
        // Legacy bare-array format for dropdown-only fields
        const optionsConfig: DropdownOptionConfig[] = options!.map((opt, i) => ({
            id: i + 1,
            value: opt,
            label: opt,
        }));
        return JSON.stringify(optionsConfig);
    }

    const fullConfig: CustomFieldFullConfig = { ...(extras || {}) };
    if (hasOptions) {
        fullConfig.options = options!.map((opt, i) => ({
            id: i + 1,
            value: opt,
            label: opt,
        }));
    }
    if (hasDefault) {
        fullConfig.defaultValue = defaultValue;
    }
    return JSON.stringify(fullConfig);
};

/**
 * Default system fields based on table columns
 * Used when API returns empty fixedFieldRenameDtos (first time setup)
 */
export const DEFAULT_SYSTEM_FIELDS: SystemField[] = [
    {
        key: 'FULL_NAME',
        defaultValue: 'Full Name',
        customValue: 'Full Name',
        order: 1,
        visibility: true,
    },
    {
        key: 'USERNAME',
        defaultValue: 'Username',
        customValue: 'Username',
        order: 2,
        visibility: true,
    },
    {
        key: 'INSTITUTE_ENROLLMENT_ID',
        defaultValue: 'Enrollment Number',
        customValue: 'Enrollment Number',
        order: 3,
        visibility: true,
    },
    {
        key: 'LINKED_INSTITUTE_NAME',
        defaultValue: 'College/School',
        customValue: 'College/School',
        order: 4,
        visibility: true,
    },
    { key: 'GENDER', defaultValue: 'Gender', customValue: 'Gender', order: 5, visibility: true },
    {
        key: 'MOBILE_NUMBER',
        defaultValue: 'Mobile Number',
        customValue: 'Mobile Number',
        order: 6,
        visibility: true,
    },
    { key: 'EMAIL', defaultValue: 'Email ID', customValue: 'Email ID', order: 7, visibility: true },
    {
        key: 'FATHER_NAME',
        defaultValue: "Father/Male Guardian's Name",
        customValue: "Father/Male Guardian's Name",
        order: 8,
        visibility: true,
    },
    {
        key: 'MOTHER_NAME',
        defaultValue: "Mother/Female Guardian's Name",
        customValue: "Mother/Female Guardian's Name",
        order: 9,
        visibility: true,
    },
    {
        key: 'PARENTS_MOBILE_NUMBER',
        defaultValue: "Father/Male Guardian's Mobile Number",
        customValue: "Father/Male Guardian's Mobile Number",
        order: 10,
        visibility: true,
    },
    {
        key: 'PARENTS_EMAIL',
        defaultValue: "Father/Male Guardian's Email ID",
        customValue: "Father/Male Guardian's Email ID",
        order: 11,
        visibility: true,
    },
    {
        key: 'PARENTS_TO_MOTHER_MOBILE_NUMBER',
        defaultValue: "Mother/Female Guardian's Mobile Number",
        customValue: "Mother/Female Guardian's Mobile Number",
        order: 12,
        visibility: true,
    },
    {
        key: 'PARENTS_TO_MOTHER_EMAIL',
        defaultValue: "Mother/Female Guardian's Email ID",
        customValue: "Mother/Female Guardian's Email ID",
        order: 13,
        visibility: true,
    },
    { key: 'CITY', defaultValue: 'City', customValue: 'City', order: 14, visibility: true },
    { key: 'REGION', defaultValue: 'State', customValue: 'State', order: 15, visibility: true },
    {
        key: 'ATTENDANCE',
        defaultValue: 'Attendance',
        customValue: 'Attendance',
        order: 16,
        visibility: false,
    },
    {
        key: 'COUNTRY',
        defaultValue: 'Country',
        customValue: 'Country',
        order: 17,
        visibility: false,
    },
    {
        key: 'EXPIRY_DATE',
        defaultValue: 'Session Expiry',
        customValue: 'Session Expiry',
        order: 18,
        visibility: true,
    },
    { key: 'STATUS', defaultValue: 'Status', customValue: 'Status', order: 19, visibility: true },
    // Off by default — the slim list query doesn't populate referral_count today, so the
    // cell renders `-` until the backend adds it. Toggle keeps the column manageable per role.
    {
        key: 'REFERRAL_COUNT',
        defaultValue: 'Referrals Count',
        customValue: 'Referrals Count',
        order: 20,
        visibility: false,
    },
    // Billing contact columns — hidden by default; admins opt in per role from
    // the display-settings UI. Populated only when an invite enabled
    // "Collect Billing Contact Details" and the learner ticked the box.
    {
        key: 'BILLING_CONTACT_NAME',
        defaultValue: 'Billing Contact Name',
        customValue: 'Billing Contact Name',
        order: 21,
        visibility: false,
    },
    {
        key: 'BILLING_CONTACT_EMAIL',
        defaultValue: 'Billing Contact Email',
        customValue: 'Billing Contact Email',
        order: 22,
        visibility: false,
    },
    {
        key: 'BILLING_CONTACT_ROLE',
        defaultValue: 'Billing Contact Role',
        customValue: 'Billing Contact Role',
        order: 23,
        visibility: false,
    },
    // Filter-driven columns (Batch / Plan Type / Amount Paid / Preferred Batch /
    // Enroll Invite Name) intentionally NOT here. They appear only when their
    // corresponding filter is applied and are appended after the configured
    // columns by reorderColumnsBySystemFields.
];

// Standard labels for system fields that predate DEFAULT_SYSTEM_FIELDS (so the
// "Default Name" column reads cleanly for them too).
const EXTRA_DEFAULT_LABELS: Record<string, string> = {
    address_line: 'Address',
    pin_code: 'PIN Code',
    date_of_birth: 'Date of Birth',
};

/**
 * Canonical/standard display name for a system field, for the Settings "Default
 * Name" column. Some institutes have legacy data where `defaultValue` is a raw
 * camelCase key (e.g. "fullName"); this resolves the field to its accessor and
 * returns the proper standard label instead. Falls back to `fallback` if unknown.
 */
export const getSystemFieldDefaultLabel = (key: string, fallback = ''): string => {
    const accessor = resolveSystemFieldAccessor(key);
    if (!accessor) return fallback;
    const canonical = DEFAULT_SYSTEM_FIELDS.find(
        (field) => resolveSystemFieldAccessor(field.key) === accessor
    )?.defaultValue;
    return canonical || EXTRA_DEFAULT_LABELS[accessor] || fallback;
};

// Mapping Functions

/**
 * Convert API locations array to UI visibility object
 */
const mapLocationsToVisibility = (locations: string[]): FieldVisibility => {
    const visibility: FieldVisibility = {
        learnersList: false,
        learnerEnrollment: false,
        learnerProfile: false,
    };

    locations.forEach((location) => {
        const visibilityKey = LOCATION_TO_VISIBILITY_MAP[location];
        if (visibilityKey) {
            visibility[visibilityKey] = true;
        }
    });

    return visibility;
};

/**
 * Convert UI visibility object to API locations array
 */
const mapVisibilityToLocations = (visibility: FieldVisibility): string[] => {
    const locations: string[] = [];

    Object.entries(visibility).forEach(([key, value]) => {
        if (value) {
            const location = VISIBILITY_TO_LOCATION_MAP[key as keyof FieldVisibility];
            if (location) {
                locations.push(location);
            }
        }
    });

    return locations;
};

/**
 * Convert API field to UI fixed field
 */
const mapApiFieldToFixedField = (apiField: ApiCustomField): FixedField => {
    const fullConfig = configJsonToFullConfig(apiField.config);
    return {
        id: apiField.customFieldId,
        name: apiField.fieldName,
        type: apiField.fieldType as CustomFieldType,
        options: configJsonToOptions(apiField.config),
        defaultValue: fullConfig?.defaultValue,
        fieldConfig: fullConfig,
        visibility: mapLocationsToVisibility(apiField.locations),
        required: true, // System fields are typically required
        canBeDeleted: apiField.canBeDeleted,
        canBeEdited: apiField.canBeEdited,
        canBeRenamed: apiField.canBeRenamed,
        order: apiField.individualOrder,
        groupName: apiField.groupName,
    };
};

/**
 * Convert API field to UI custom field
 */
const mapApiFieldToCustomField = (apiField: ApiCustomField): CustomField => {
    const fullConfig = configJsonToFullConfig(apiField.config);
    return {
        id: apiField.customFieldId,
        name: apiField.fieldName,
        type: apiField.fieldType as CustomFieldType,
        options: configJsonToOptions(apiField.config), // Convert config JSON to options array
        defaultValue: fullConfig?.defaultValue,
        fieldConfig: fullConfig,
        visibility: mapLocationsToVisibility(apiField.locations),
        required: false, // Will be determined by compulsoryCustomFields
        canBeDeleted: apiField.canBeDeleted,
        canBeEdited: apiField.canBeEdited,
        canBeRenamed: apiField.canBeRenamed,
        order: apiField.individualOrder,
        groupName: apiField.groupName,
    };
};

/**
 * Convert API group field to UI group field
 */
const mapApiGroupFieldToGroupField = (
    apiGroupField: ApiGroupField | ApiCustomField
): GroupField => {
    const fullConfig = configJsonToFullConfig(apiGroupField.config);
    return {
        id: apiGroupField.customFieldId,
        name: apiGroupField.fieldName,
        type: apiGroupField.fieldType as CustomFieldType,
        options: configJsonToOptions(apiGroupField.config), // Convert config JSON to options array
        defaultValue: fullConfig?.defaultValue,
        fieldConfig: fullConfig,
        visibility: mapLocationsToVisibility(apiGroupField.locations),
        required: false, // Will be determined by compulsoryCustomFields
        canBeDeleted: apiGroupField.canBeDeleted,
        canBeEdited: apiGroupField.canBeEdited,
        canBeRenamed: apiGroupField.canBeRenamed,
        order: apiGroupField.individualOrder,
        groupInternalOrder: apiGroupField.groupInternalOrder || 0,
        groupName: apiGroupField.groupName,
    };
};

/**
 * Convert API response to UI format
 */
const mapApiResponseToUI = (apiResponse: ApiCustomFieldResponse): CustomFieldSettingsData => {
    const systemFields: SystemField[] = [];
    const fixedFields: FixedField[] = [];
    const instituteFields: CustomField[] = [];
    const customFields: CustomField[] = [];
    const fieldGroups: FieldGroup[] = [];

    // CRITICAL FIX: The actual data is nested under apiResponse.data.data
    const actualData = apiResponse.data?.data;

    if (!actualData) {
        console.error('❌ [DEBUG] No nested data found in API response');
        return {
            systemFields: DEFAULT_SYSTEM_FIELDS,
            fixedFields,
            instituteFields,
            customFields,
            fieldGroups,
            lastUpdated: new Date().toISOString(),
            version: 1,
        };
    }

    // Process fixedFieldRenameDtos to get system fields
    const fixedFieldRenameDtos = actualData.fixedFieldRenameDtos || [];

    if (fixedFieldRenameDtos.length > 0) {
        // Use the fixedFieldRenameDtos from API
        fixedFieldRenameDtos.forEach((dto) => {
            systemFields.push({
                key: dto.key,
                defaultValue: dto.defaultValue,
                customValue: dto.customValue,
                order: dto.order,
                visibility: dto.visibility,
            });
        });

        // Merge in any standard system fields the institute's saved config is
        // missing (e.g. Country, Status, Attendance) using their built-in defaults,
        // so every standard field gets a toggle and a proper default visibility.
        // Without this, a field not present in the config has no toggle and the
        // visibility readers fail open (always shown). Dedup by resolved column
        // accessor so a non-standard key (e.g. "fatherName") isn't duplicated by its
        // canonical twin (FATHER_NAME).
        const coveredAccessors = new Set(
            systemFields
                .map((field) => resolveSystemFieldAccessor(field.key))
                .filter((accessor): accessor is string => Boolean(accessor))
        );
        let nextOrder = systemFields.reduce(
            (max, field) => Math.max(max, field.order || 0),
            0
        );
        DEFAULT_SYSTEM_FIELDS.forEach((defaultField) => {
            const accessor = resolveSystemFieldAccessor(defaultField.key);
            if (accessor && !coveredAccessors.has(accessor)) {
                systemFields.push({ ...defaultField, order: ++nextOrder });
                coveredAccessors.add(accessor);
            }
        });
    } else {
        // First time setup - use default system fields
        systemFields.push(...DEFAULT_SYSTEM_FIELDS);
    }

    // Safety check: ensure currentCustomFieldsAndGroups exists and is an array
    const fields = actualData.currentCustomFieldsAndGroups || [];
    const fixedCustomFields = actualData.fixedCustomFields || [];
    const compulsoryCustomFields = actualData.compulsoryCustomFields || [];
    const customGroupData = actualData.customGroup || {};

    // Process individual fields AND build groups from fields with groupName
    const groupsMap = new Map<string, FieldGroup>();

    fields.forEach((apiField: ApiCustomField) => {
        const isSystemField = SYSTEM_FIELD_NAMES.includes(apiField.fieldName.toLowerCase());
        const isFixedField = fixedCustomFields.includes(apiField.customFieldId);
        const isRequired = compulsoryCustomFields.includes(apiField.customFieldId);

        // Add field to individual lists (fixed or custom)
        if (isSystemField || isFixedField) {
            const fixedField = mapApiFieldToFixedField(apiField);
            fixedField.required = isRequired;
            fixedFields.push(fixedField);
        } else {
            const customField = mapApiFieldToCustomField(apiField);
            customField.required = isRequired;
            customFields.push(customField);
        }

        // Also process fields that belong to groups
        if (apiField.groupName) {
            // Split group names by comma and trim whitespace to handle multi-group fields
            const groupNames = apiField.groupName
                .split(',')
                .map((name) => name.trim())
                .filter((name) => name.length > 0);

            groupNames.forEach((groupName) => {
                if (!groupsMap.has(groupName)) {
                    groupsMap.set(groupName, {
                        id: groupName,
                        name: groupName,
                        fields: [],
                        order: 0,
                    });
                }

                const group = groupsMap.get(groupName)!;
                const mappedGroupField = mapApiGroupFieldToGroupField(apiField);
                mappedGroupField.required = isRequired;

                group.fields.push(mappedGroupField);

                // Update group order to minimum field order
                if (group.order === 0 || apiField.individualOrder < group.order) {
                    group.order = apiField.individualOrder;
                }
            });
        }
    });

    // Also process customGroup data (if it exists)
    Object.entries(customGroupData).forEach(([, apiGroupField]) => {
        const groupField = apiGroupField as ApiGroupField;
        const groupName = groupField.groupName;

        if (!groupsMap.has(groupName)) {
            groupsMap.set(groupName, {
                id: groupName,
                name: groupName,
                fields: [],
                order: 0,
            });
        }

        const group = groupsMap.get(groupName)!;

        // Check if this field is already in the group (to avoid duplicates)
        const fieldExists = group.fields.some((f) => f.id === groupField.customFieldId);
        if (!fieldExists) {
            const mappedGroupField = mapApiGroupFieldToGroupField(groupField);
            mappedGroupField.required = compulsoryCustomFields.includes(groupField.customFieldId);
            group.fields.push(mappedGroupField);

            // Update group order to minimum field order
            if (group.order === 0 || mappedGroupField.order < group.order) {
                group.order = mappedGroupField.order;
            }
        }
    });

    fieldGroups.push(...Array.from(groupsMap.values()));

    // Sort fields by order
    fixedFields.sort((a, b) => a.order - b.order);
    customFields.sort((a, b) => a.order - b.order);
    fieldGroups.sort((a, b) => a.order - b.order);
    fieldGroups.forEach((group) => {
        group.fields.sort((a, b) => a.groupInternalOrder - b.groupInternalOrder);
    });

    // Sort system fields by order
    systemFields.sort((a, b) => a.order - b.order);

    return {
        systemFields,
        fixedFields,
        instituteFields,
        customFields,
        fieldGroups,
        lastUpdated: new Date().toISOString(),
        version: 1,
    };
};

/**
 * Store original API data for preserving during save operations
 */
let originalApiData: ApiCustomFieldResponse['data']['data'] | null = null;

/**
 * Set the original API data (called after successful GET request)
 */
export const setOriginalApiData = (apiData: ApiCustomFieldResponse['data']['data']): void => {
    originalApiData = apiData;
};

const extractConfigExtras = (
    fieldConfig?: CustomFieldFullConfig
): Partial<CustomFieldFullConfig> | undefined => {
    if (!fieldConfig) return undefined;
    const { options, defaultValue, ...rest } = fieldConfig;
    // options + defaultValue are merged separately by buildConfigJson
    void options;
    void defaultValue;
    return Object.keys(rest).length > 0 ? rest : undefined;
};

/**
 * Convert UI field back to API field, preserving original API structure
 */
const preserveApiField = (
    uiField: CustomField | FixedField,
    originalApiField: ApiCustomField
): ApiCustomField => {
    const hasOptions = 'options' in uiField && uiField.options;
    const configJson = hasOptions
        ? buildConfigJson(
              uiField.options,
              uiField.defaultValue,
              extractConfigExtras(uiField.fieldConfig)
          )
        : buildConfigJson(
              undefined,
              uiField.defaultValue,
              extractConfigExtras(uiField.fieldConfig)
          ) ?? originalApiField.config;

    return {
        ...originalApiField, // Preserve all original API data
        fieldName: uiField.name, // Update name if changed
        individualOrder: uiField.order, // Update order if changed
        locations: mapVisibilityToLocations(uiField.visibility), // Update visibility
        groupName: uiField.groupName || null, // Update groupName
        config: configJson,
    };
};

/**
 * Convert UI group field back to API group field, preserving original structure
 */
const preserveApiGroupField = (
    uiField: GroupField,
    originalApiField: ApiGroupField
): ApiGroupField => {
    return {
        ...originalApiField, // Preserve all original API data
        fieldName: uiField.name, // Update name if changed
        individualOrder: uiField.order, // Update order if changed
        groupInternalOrder: uiField.groupInternalOrder, // Update group order if changed
        groupName: uiField.groupName || originalApiField.groupName, // Update groupName
        locations: mapVisibilityToLocations(uiField.visibility), // Update visibility
        config: buildConfigJson(
            uiField.options,
            uiField.defaultValue,
            extractConfigExtras(uiField.fieldConfig)
        ),
    };
};

/**
 * Create API field for new custom field (without backend ID)
 */
const createNewApiField = (
    customField: CustomField,
    instituteId: string
): Omit<ApiCustomField, 'id'> => {
    return {
        customFieldId: '', // Backend will assign this
        instituteId,
        groupName: customField.groupName || null,
        fieldName: customField.name,
        fieldType: customField.type,
        individualOrder: customField.order,
        groupInternalOrder: null,
        canBeDeleted: true,
        canBeEdited: true,
        canBeRenamed: true,
        locations: mapVisibilityToLocations(customField.visibility),
        status: 'ACTIVE',
        config: buildConfigJson(
            customField.options,
            customField.defaultValue,
            extractConfigExtras(customField.fieldConfig)
        ),
    };
};

/**
 * Create API group field for new group field (without backend ID)
 */
const createNewApiGroupField = (
    groupField: GroupField,
    instituteId: string,
    groupName: string
): Omit<ApiGroupField, 'id'> => {
    return {
        customFieldId: '', // Backend will assign this
        instituteId,
        groupName,
        fieldName: groupField.name,
        fieldType: groupField.type,
        individualOrder: groupField.order,
        groupInternalOrder: groupField.groupInternalOrder,
        canBeDeleted: true,
        canBeEdited: true,
        canBeRenamed: true,
        locations: mapVisibilityToLocations(groupField.visibility),
        status: 'ACTIVE',
        config: buildConfigJson(
            groupField.options,
            groupField.defaultValue,
            extractConfigExtras(groupField.fieldConfig)
        ),
    };
};

/**
 * Create a fresh API request structure when no original data is available
 * This is used for first-time saves or when the original API data is missing
 */
const mapUIToApiRequestFresh = (
    uiData: CustomFieldSettingsData,
    instituteId: string
): ApiCustomFieldRequest => {
    const currentCustomFieldsAndGroups: ApiCustomField[] = [];
    const customGroup: Record<string, ApiGroupField> = {};
    const customFieldsNames: string[] = [];
    const compulsoryCustomFields: string[] = [];
    const fixedCustomFields: string[] = [];
    const allCustomFields: string[] = [];
    const groupNames: string[] = [];

    // Process fixed fields
    uiData.fixedFields.forEach((fixedField) => {
        // For fresh saves, we create new API field structures
        const apiField: ApiCustomField = {
            id: '', // Backend will assign
            customFieldId: fixedField.id,
            instituteId,
            groupName: fixedField.groupName || null,
            fieldName: fixedField.name,
            fieldType: 'text', // Fixed fields are typically text
            individualOrder: fixedField.order,
            groupInternalOrder: null,
            canBeDeleted: fixedField.canBeDeleted,
            canBeEdited: fixedField.canBeEdited,
            canBeRenamed: fixedField.canBeRenamed,
            locations: mapVisibilityToLocations(fixedField.visibility),
            status: 'ACTIVE',
        };
        currentCustomFieldsAndGroups.push(apiField);

        customFieldsNames.push(fixedField.name);
        fixedCustomFields.push(fixedField.id);
        allCustomFields.push(fixedField.id);

        if (fixedField.required) {
            compulsoryCustomFields.push(fixedField.id);
        }
    });

    // Process institute fields
    uiData.instituteFields.forEach((instituteField) => {
        const apiField: ApiCustomField = {
            id: '', // Backend will assign
            customFieldId: instituteField.id,
            instituteId,
            groupName: instituteField.groupName || null,
            fieldName: instituteField.name,
            fieldType: instituteField.type,
            individualOrder: instituteField.order,
            groupInternalOrder: null,
            canBeDeleted: instituteField.canBeDeleted,
            canBeEdited: instituteField.canBeEdited,
            canBeRenamed: instituteField.canBeRenamed,
            locations: mapVisibilityToLocations(instituteField.visibility),
            status: 'ACTIVE',
            config: buildConfigJson(
                instituteField.options,
                instituteField.defaultValue,
                extractConfigExtras(instituteField.fieldConfig)
            ),
        };
        currentCustomFieldsAndGroups.push(apiField);

        customFieldsNames.push(instituteField.name);
        allCustomFields.push(instituteField.id);

        if (instituteField.required) {
            compulsoryCustomFields.push(instituteField.id);
        }
    });

    // Process custom fields — skip feature-scoped fields (canBeEdited=false)
    uiData.customFields.filter((f) => f.canBeEdited !== false).forEach((customField) => {
        const apiField: ApiCustomField = {
            id: '', // Backend will assign
            customFieldId: isTempField(customField) ? '' : customField.id, // Empty for new fields
            instituteId,
            groupName: customField.groupName || null,
            fieldName: customField.name,
            fieldType: customField.type,
            individualOrder: customField.order,
            groupInternalOrder: null,
            canBeDeleted: customField.canBeDeleted,
            canBeEdited: customField.canBeEdited,
            canBeRenamed: customField.canBeRenamed,
            locations: mapVisibilityToLocations(customField.visibility),
            status: 'ACTIVE',
            config: buildConfigJson(
                customField.options,
                customField.defaultValue,
                extractConfigExtras(customField.fieldConfig)
            ),
        };
        currentCustomFieldsAndGroups.push(apiField);

        customFieldsNames.push(customField.name);

        // Only add to allCustomFields if it's not a temp field
        if (!isTempField(customField)) {
            allCustomFields.push(customField.id);
        }

        if (customField.required) {
            const fieldId = isTempField(customField) ? customField.name : customField.id;
            compulsoryCustomFields.push(fieldId);
        }
    });

    // Process field groups
    uiData.fieldGroups.forEach((fieldGroup) => {
        groupNames.push(fieldGroup.name);

        fieldGroup.fields.forEach((groupField) => {
            const groupKey = `${fieldGroup.name}_${groupField.id}`;

            const apiGroupField: ApiGroupField = {
                id: '', // Backend will assign
                customFieldId: isTempField(groupField) ? '' : groupField.id, // Empty for new fields
                instituteId,
                groupName: fieldGroup.name,
                fieldName: groupField.name,
                fieldType: groupField.type,
                individualOrder: groupField.order,
                groupInternalOrder: groupField.groupInternalOrder,
                canBeDeleted: groupField.canBeDeleted,
                canBeEdited: groupField.canBeEdited,
                canBeRenamed: groupField.canBeRenamed,
                locations: mapVisibilityToLocations(groupField.visibility),
                status: 'ACTIVE',
            };
            customGroup[groupKey] = apiGroupField;

            customFieldsNames.push(groupField.name);

            // Only add to allCustomFields if it's not a temp field
            if (!isTempField(groupField)) {
                allCustomFields.push(groupField.id);
            }

            if (groupField.required) {
                const fieldId = isTempField(groupField) ? groupField.name : groupField.id;
                compulsoryCustomFields.push(fieldId);
            }
        });
    });

    // Map system fields to fixed_field_rename_dtos
    // Use DEFAULT_SYSTEM_FIELDS if systemFields is not provided
    const fixed_field_rename_dtos = (uiData.systemFields || DEFAULT_SYSTEM_FIELDS).map((field) => ({
        key: field.key,
        defaultValue: field.defaultValue,
        customValue: field.customValue,
        order: field.order,
        visibility: field.visibility,
    }));

    const result: ApiCustomFieldRequest = {
        custom_fields_and_groups: currentCustomFieldsAndGroups,
        custom_group: customGroup,
        custom_fields_names: customFieldsNames,
        compulsory_custom_fields: compulsoryCustomFields,
        fixed_custom_fields: fixedCustomFields,
        all_custom_fields: allCustomFields,
        custom_field_locations: Object.values(VISIBILITY_TO_LOCATION_MAP),
        group_names: groupNames.length > 0 ? groupNames : undefined,
        fixed_field_rename_dtos,
    };

    return result;
};

/**
 * Convert UI format to API request, preserving original API structure when available
 */
const mapUIToApiRequest = (uiData: CustomFieldSettingsData): ApiCustomFieldRequest => {
    const instituteId = getInstituteId();
    if (!instituteId) {
        throw new Error('Institute ID not found');
    }

    // If we don't have original API data, we'll create a fresh structure
    // This can happen on first save or if the data wasn't properly loaded
    if (!originalApiData) {
        console.warn('🚨 [DEBUG] No original API data available - creating fresh structure');
        return mapUIToApiRequestFresh(uiData, instituteId);
    }

    // We have original data, so we can preserve the structure

    // Start with the original data structure and modify only what's changed
    const currentCustomFieldsAndGroups: ApiCustomField[] = [];
    // FIXED: Start with empty customGroup - will be populated with only current groups
    let customGroup: Record<string, ApiGroupField> = {};
    const customFieldsNames: string[] = [];
    const compulsoryCustomFields: string[] = [];
    const fixedCustomFields: string[] = [...(originalApiData.fixedCustomFields || [])];
    const allCustomFields: string[] = [];
    // FIXED: Start with empty groupNames - will be populated with only current group names
    const groupNames: string[] = [];

    // Create a map of original fields for easy lookup
    const originalFieldsMap = new Map<string, ApiCustomField>();
    const originalFields = originalApiData.currentCustomFieldsAndGroups || [];
    originalFields.forEach((field) => {
        originalFieldsMap.set(field.customFieldId, field);
    });

    const originalGroupFieldsMap = new Map<string, ApiGroupField>();
    const originalGroupEntries = originalApiData.customGroup || {};
    Object.entries(originalGroupEntries).forEach(([, field]) => {
        originalGroupFieldsMap.set(field.customFieldId, field);
    });

    // Process fixed fields
    uiData.fixedFields.forEach((fixedField) => {
        const originalField = originalFieldsMap.get(fixedField.id);
        if (originalField) {
            // Existing field - preserve original structure, update only changed data
            const apiField = preserveApiField(fixedField, originalField);
            currentCustomFieldsAndGroups.push(apiField);
        } else {
            console.warn(`Fixed field ${fixedField.id} not found in original data`);
        }

        // Add all field names to customFieldsNames for backend compatibility
        customFieldsNames.push(fixedField.name);
        allCustomFields.push(fixedField.id);

        if (fixedField.required) {
            compulsoryCustomFields.push(fixedField.id);
        }
    });

    // Process institute fields
    uiData.instituteFields.forEach((instituteField) => {
        const originalField = originalFieldsMap.get(instituteField.id);
        if (originalField) {
            // Existing field - preserve original structure
            const apiField = preserveApiField(instituteField, originalField);
            currentCustomFieldsAndGroups.push(apiField);
        } else {
            console.warn(`Institute field ${instituteField.id} not found in original data`);
        }

        // Add all field names to customFieldsNames for backend compatibility
        customFieldsNames.push(instituteField.name);
        allCustomFields.push(instituteField.id);

        if (instituteField.required) {
            compulsoryCustomFields.push(instituteField.id);
        }
    });

    // Process custom fields — skip feature-scoped fields (canBeEdited=false)
    // that were merged from the usage response for display only. Saving them
    // here would create a spurious DEFAULT_CUSTOM_FIELD mapping.
    uiData.customFields.filter((f) => f.canBeEdited !== false).forEach((customField) => {
        if (isTempField(customField)) {
            // New field - create new API structure without ID
            const newApiField = createNewApiField(customField, instituteId) as ApiCustomField;
            // For new fields, leave customFieldId empty so backend can assign proper ID
            newApiField.customFieldId = '';
            newApiField.id = ''; // Also ensure id is empty
            currentCustomFieldsAndGroups.push(newApiField);
        } else {
            // Existing field - preserve original structure
            const originalField = originalFieldsMap.get(customField.id);
            if (originalField) {
                const apiField = preserveApiField(customField, originalField);
                currentCustomFieldsAndGroups.push(apiField);
            } else {
                console.warn(`Custom field ${customField.id} not found in original data`);
            }
        }

        customFieldsNames.push(customField.name);
        // For new fields, don't add the temp ID to allCustomFields
        if (!isTempField(customField)) {
            allCustomFields.push(customField.id);
        }

        if (customField.required) {
            // For new fields, use the field name instead of temp ID
            const fieldId = isTempField(customField) ? customField.name : customField.id;
            compulsoryCustomFields.push(fieldId);
        }
    });

    // Process field groups
    const updatedCustomGroup: Record<string, ApiGroupField> = {};

    uiData.fieldGroups.forEach((fieldGroup) => {
        // Add group name to list if it's new
        if (!groupNames.includes(fieldGroup.name)) {
            groupNames.push(fieldGroup.name);
        }

        fieldGroup.fields.forEach((groupField) => {
            const groupKey = `${fieldGroup.name}_${groupField.id}`;

            if (isTempField(groupField)) {
                // New group field
                const newApiGroupField = createNewApiGroupField(
                    groupField,
                    instituteId,
                    fieldGroup.name
                ) as ApiGroupField;
                // For new fields, leave customFieldId empty so backend can assign proper ID
                newApiGroupField.customFieldId = '';
                newApiGroupField.id = '';
                updatedCustomGroup[groupKey] = newApiGroupField;
            } else {
                // Existing group field - preserve original structure
                const originalGroupField = originalGroupFieldsMap.get(groupField.id);
                if (originalGroupField) {
                    const apiGroupField = preserveApiGroupField(groupField, originalGroupField);
                    updatedCustomGroup[groupKey] = apiGroupField;
                } else {
                    console.warn(`Group field ${groupField.id} not found in original data`);
                }
            }

            // For new fields, don't add the temp ID to allCustomFields
            if (!isTempField(groupField)) {
                allCustomFields.push(groupField.id);
            }

            // Add group field names to customFieldsNames for backend compatibility
            customFieldsNames.push(groupField.name);

            if (groupField.required) {
                // For new fields, use the field name instead of temp ID
                const fieldId = isTempField(groupField) ? groupField.name : groupField.id;
                compulsoryCustomFields.push(fieldId);
            }
        });
    });

    // FIXED: Reassign to only include current groups (not merging with old data)
    // This ensures deleted groups are not sent in the payload
    customGroup = updatedCustomGroup;

    // Map system fields to fixed_field_rename_dtos
    // Use DEFAULT_SYSTEM_FIELDS if systemFields is not provided
    const fixed_field_rename_dtos = (uiData.systemFields || DEFAULT_SYSTEM_FIELDS).map((field) => ({
        key: field.key,
        defaultValue: field.defaultValue,
        customValue: field.customValue,
        order: field.order,
        visibility: field.visibility,
    }));

    const result: ApiCustomFieldRequest = {
        custom_fields_and_groups: currentCustomFieldsAndGroups,
        custom_group: customGroup,
        custom_fields_names: customFieldsNames,
        compulsory_custom_fields: compulsoryCustomFields,
        fixed_custom_fields: fixedCustomFields,
        all_custom_fields: allCustomFields,
        custom_field_locations:
            originalApiData.customFieldLocations || Object.values(VISIBILITY_TO_LOCATION_MAP),
        group_names: groupNames.length > 0 ? groupNames : undefined,
        fixed_field_rename_dtos,
    };

    return result;
};

/**
 * Get cached custom field settings from localStorage
 */
const getCachedSettings = (): CustomFieldSettingsData | null => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) {
            console.warn('🚨 [DEBUG] Cannot get cached settings: Institute ID not found');
            return null;
        }

        const cached = localStorage.getItem(LOCALSTORAGE_KEY);
        if (!cached) {
            return null;
        }

        const cachedData: CachedCustomFieldSettings = JSON.parse(cached);

        // Check if cache is for the same institute
        if (cachedData.instituteId !== instituteId) {
            console.warn(
                `🚨 [DEBUG] Cache institute ID mismatch: ${cachedData.instituteId} vs ${instituteId}`
            );
            localStorage.removeItem(LOCALSTORAGE_KEY);
            return null;
        }

        // Check if cache has expired
        const now = Date.now();
        const cacheAge = now - cachedData.timestamp;
        const expiryTime = CACHE_EXPIRY_HOURS * 60 * 60 * 1000; // Convert to milliseconds

        if (cacheAge > expiryTime) {
            console.warn('🚨 [DEBUG] Cache expired, removing from localStorage');
            localStorage.removeItem(LOCALSTORAGE_KEY);
            return null;
        }

        return cachedData.data;
    } catch (error) {
        console.error('❌ [DEBUG] Error reading cached custom field settings:', error);
        localStorage.removeItem(LOCALSTORAGE_KEY);
        return null;
    }
};

/**
 * Save custom field settings to localStorage cache
 */
const setCachedSettings = (settings: CustomFieldSettingsData): void => {
    try {
        const instituteId = getInstituteId();
        if (!instituteId) {
            console.warn('🚨 [DEBUG] Cannot cache settings: Institute ID not found');
            return;
        }

        const cacheData: CachedCustomFieldSettings = {
            data: settings,
            timestamp: Date.now(),
            instituteId,
        };

        localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(cacheData));
    } catch (error) {
        console.error('❌ [DEBUG] Error caching custom field settings:', error);
    }
};

/**
 * Clear cached custom field settings
 */
export const clearCustomFieldSettingsCache = (): void => {
    localStorage.removeItem(LOCALSTORAGE_KEY);
};

/**
 * Get custom field settings synchronously from cache only (no API call)
 * Returns null if no cache is available - forces API call
 */
export const getCustomFieldSettingsFromCache = (): CustomFieldSettingsData | null => {
    const cachedSettings = getCachedSettings();
    return cachedSettings; // No fallback to defaults - must use backend data
};

/**
 * Fetch custom field settings from API and update cache
 */
const fetchCustomFieldSettingsFromAPI = async (): Promise<CustomFieldSettingsData> => {
    try {
        const instituteId = getInstituteId();

        if (!instituteId) {
            throw new Error('Institute ID not found. Please log in again.');
        }

        const [settingsResponse, usageResponse] = await Promise.all([
            authenticatedAxiosInstance.get<ApiCustomFieldResponse>(GET_INSITITUTE_SETTINGS, {
                params: {
                    instituteId,
                    settingKey: CUSTOM_FIELD_SETTINGS_KEY,
                },
            }),
            authenticatedAxiosInstance.get<ApiCustomFieldUsageResponse>(
                GET_CUSTOM_FIELD_LIST_WITH_USAGE,
                {
                    params: {
                        instituteId,
                    },
                }
            ),
        ]);

        let settings: CustomFieldSettingsData;

        // If we get a successful response with data, map it to UI format
        if (settingsResponse.data && settingsResponse.data.data) {
            const apiData = settingsResponse.data.data.data;

            // Build currentCustomFieldsAndGroups entirely from the usage
            // response (the live DB). The blob's list is stale and often
            // contains duplicates from old saves. We keep the blob's OTHER
            // data (fixedFieldRenameDtos, customFieldLocations, etc.) but
            // replace the field list with the authoritative usage data.
            if (usageResponse.data && Array.isArray(usageResponse.data)) {
                const freshFields: ApiCustomField[] = [];
                const freshAllCustomFields: string[] = [];
                const freshCustomFieldsNames: string[] = [];
                const freshCompulsoryCustomFields: string[] = [];
                const freshFixedCustomFields: string[] = [];
                const seenNames = new Set<string>();

                // Build a lookup from the blob for fields that have extra
                // settings (locations, groupName, order, canBe* flags).
                const blobFieldMap = new Map<string, ApiCustomField>();
                if (Array.isArray(apiData.currentCustomFieldsAndGroups)) {
                    apiData.currentCustomFieldsAndGroups.forEach((f) => {
                        if (f.customFieldId) blobFieldMap.set(f.customFieldId, f);
                    });
                }
                const blobFixedSet = new Set<string>(apiData.fixedCustomFields || []);
                const blobCompulsorySet = new Set<string>(apiData.compulsoryCustomFields || []);

                usageResponse.data.forEach((usageItem) => {
                    const fieldId = usageItem.custom_field.id;
                    if (!fieldId) return;

                    // Deduplicate by name (case-insensitive)
                    const nameLower = (usageItem.custom_field.fieldName || '').toLowerCase();
                    if (seenNames.has(nameLower)) return;
                    seenNames.add(nameLower);

                    // If the blob has this field, inherit its UI settings
                    const blobEntry = blobFieldMap.get(fieldId);

                    const field: ApiCustomField = {
                        id: blobEntry?.id || '',
                        customFieldId: fieldId,
                        instituteId: usageItem.custom_field.instituteId || instituteId,
                        groupName: blobEntry?.groupName || null,
                        fieldName: usageItem.custom_field.fieldName,
                        fieldType: (usageItem.custom_field.fieldType as CustomFieldType) || 'text',
                        individualOrder: blobEntry?.individualOrder ?? 999,
                        groupInternalOrder: blobEntry?.groupInternalOrder ?? null,
                        canBeDeleted: blobEntry?.canBeDeleted ?? true,
                        canBeEdited: usageItem.default ? (blobEntry?.canBeEdited ?? true) : false,
                        canBeRenamed: usageItem.default ? (blobEntry?.canBeRenamed ?? true) : false,
                        locations: blobEntry?.locations || [],
                        status: usageItem.custom_field.status || 'ACTIVE',
                        config: usageItem.custom_field.config,
                    };

                    freshFields.push(field);

                    if (usageItem.default) {
                        freshAllCustomFields.push(fieldId);
                        freshCustomFieldsNames.push(field.fieldName);
                        if (blobFixedSet.has(fieldId)) {
                            freshFixedCustomFields.push(fieldId);
                        }
                        if (blobCompulsorySet.has(fieldId)) {
                            freshCompulsoryCustomFields.push(fieldId);
                        }
                    }
                });

                apiData.currentCustomFieldsAndGroups = freshFields;
                apiData.allCustomFields = freshAllCustomFields;
                apiData.customFieldsNames = freshCustomFieldsNames;
                apiData.fixedCustomFields = freshFixedCustomFields;
                apiData.compulsoryCustomFields = freshCompulsoryCustomFields;
            }

            // Store original API data for preservation during save operations
            setOriginalApiData(apiData);

            settings = mapApiResponseToUI(settingsResponse.data);

            // Attach usage data
            if (usageResponse.data && Array.isArray(usageResponse.data)) {
                const usageMap = new Map<string, CustomFieldUsage>();
                usageResponse.data.forEach((item) => {
                    if (item.custom_field?.id) {
                        usageMap.set(item.custom_field.id, {
                            enrollInviteCount: item.enroll_invite_count,
                            audienceCount: item.audience_count,
                            sessionCount: item.session_count ?? 0,
                            assessmentCount: item.assessment_count ?? 0,
                            isDefault: item.default ?? false,
                        });
                    }
                });

                // Attach to instituteFields
                settings.instituteFields.forEach((field) => {
                    if (usageMap.has(field.id)) {
                        field.usage = usageMap.get(field.id);
                    }
                });

                // Attach to customFields
                settings.customFields.forEach((field) => {
                    if (usageMap.has(field.id)) {
                        field.usage = usageMap.get(field.id);
                    }
                });

                // Attach to fixedFields (if applicable, though IDs usually match customFieldId)
                settings.fixedFields.forEach((field) => {
                    if (usageMap.has(field.id)) {
                        field.usage = usageMap.get(field.id);
                    }
                });

                // Attach to group fields
                settings.fieldGroups.forEach((group) => {
                    group.fields.forEach((field) => {
                        if (usageMap.has(field.id)) {
                            // Cast to any because GroupField interface needs update too if we want strict typing there
                            // But since GroupField extends CustomField variants effectively in UI, it might work if Types imply it.
                            // Actually safely casting or adding to interface is better.
                            // Let's assume usage is on the base object.
                            (field as unknown as CustomField).usage = usageMap.get(field.id);
                        }
                    });
                });
            }

            // Validate that we actually got some fields
            const totalFields =
                settings.fixedFields.length +
                settings.customFields.length +
                settings.instituteFields.length;
            if (totalFields === 0) {
                console.warn(
                    '🚨 [DEBUG] No fields found in API response - this may indicate an issue'
                );
            }
        } else {
            // If no data found, throw error - we must have backend data
            throw new Error('No custom field settings found in backend. Please contact support.');
        }

        // Cache the settings - this is critical for the UI to work
        setCachedSettings(settings);

        return settings;
    } catch (error: unknown) {
        console.error('🚨 [DEBUG] Error fetching custom field settings:', error);

        // Check if it's a 510 error (Setting not found) or other error
        const err = error as { response?: { status?: number; data?: { ex?: string } } };
        if (err.response?.status === 510 || err.response?.data?.ex?.includes('Setting not found')) {
            throw new Error(
                'Custom field settings not configured yet. Please contact your administrator to set up field configurations.'
            );
        }

        // For other errors, also throw - no fallback to defaults
        const message = (error as Error)?.message || 'unknown error';
        console.warn('🚨 [DEBUG] Error loading custom field settings:', message);

        // IMPORTANT: Don't use defaults if we have a real API error - this causes UUID issues
        // Instead, throw the error so the UI can handle it properly
        throw new Error(`Failed to load custom field settings: ${message}`);
    }
};

/**
 * Get custom field settings - tries cache first, then API if needed
 */
export const getCustomFieldSettings = async (
    forceRefresh = false
): Promise<CustomFieldSettingsData> => {
    // If forcing refresh, skip cache and fetch from API
    if (forceRefresh) {
        return fetchCustomFieldSettingsFromAPI();
    }

    // Try to get from cache first
    const cachedSettings = getCachedSettings();
    if (cachedSettings) {
        return cachedSettings;
    }

    // If no cache, fetch from API
    return fetchCustomFieldSettingsFromAPI();
};

/**
 * Debug function to validate API request data structure
 */
const validateApiRequest = (apiRequest: ApiCustomFieldRequest): void => {
    // Check for missing IDs in existing fields
    const fieldsWithoutIds = apiRequest.custom_fields_and_groups.filter(
        (field: ApiCustomField) => !field.id && field.customFieldId !== ''
    );
    if (fieldsWithoutIds.length > 0) {
        console.warn('🚨 [DEBUG] Found existing fields without API IDs:', fieldsWithoutIds);
    }

    // Check for new fields (should have empty customFieldId)
};

/**
 * Save custom field settings to API and update cache
 */
export const saveCustomFieldSettings = async (
    settings: CustomFieldSettingsData
): Promise<{ success: boolean; message: string }> => {
    try {
        const instituteId = getInstituteId();

        if (!instituteId) {
            throw new Error('Institute ID not found. Please log in again.');
        }

        // Convert UI data to API format
        const apiRequest = mapUIToApiRequest(settings);

        // Validate the API request structure
        validateApiRequest(apiRequest);

        // Determine if this is a create or update operation
        const cachedSettings = getCachedSettings();
        const isPresent = cachedSettings !== null;

        const requestParams: Record<string, string | boolean> = {
            instituteId,
        };

        // Add isPresent param for updates
        if (isPresent) {
            requestParams.isPresent = true;
        }

        await authenticatedAxiosInstance.post(UPDATE_CUSTOM_FIELD_SETTINGS, apiRequest, {
            params: requestParams,
            headers: {
                'Content-Type': 'application/json',
            },
        });

        // Invalidate the cache, then immediately repopulate it with fresh backend
        // data (real UUIDs). We MUST refetch rather than leave it empty: sync
        // readers (learner list columns, side view, export, import) treat a missing
        // cache as "show everything" (fail-open), so an empty cache makes a just-
        // toggled-off field reappear until something else refetches. Repopulating
        // here means the change is reflected everywhere without a manual reload.
        localStorage.removeItem(LOCALSTORAGE_KEY);
        try {
            await fetchCustomFieldSettingsFromAPI();
        } catch (refetchError) {
            // Best-effort: leave the cache cleared; the next read will refetch.
            console.warn('Failed to refresh custom field settings cache after save:', refetchError);
        }

        return {
            success: true,
            message: 'Custom field settings saved successfully',
        };
    } catch (error) {
        console.error('Error saving custom field settings:', error);
        throw error;
    }
};

/**
 * Validate custom field settings data structure
 */
export const validateCustomFieldSettings = (settings: CustomFieldSettingsData): boolean => {
    try {
        // Check if all required properties exist
        if (!settings.fixedFields || !Array.isArray(settings.fixedFields)) return false;
        if (!settings.instituteFields || !Array.isArray(settings.instituteFields)) return false;
        if (!settings.customFields || !Array.isArray(settings.customFields)) return false;
        if (!settings.fieldGroups || !Array.isArray(settings.fieldGroups)) return false;

        // Validate each field has required properties
        const validateField = (field: CustomField | FixedField): boolean => {
            return !!(
                field.id &&
                field.name &&
                field.visibility &&
                typeof field.required === 'boolean' &&
                typeof field.order === 'number'
            );
        };

        const validateGroupField = (field: GroupField): boolean => {
            return !!(
                field.id &&
                field.name &&
                field.visibility &&
                typeof field.required === 'boolean' &&
                typeof field.order === 'number' &&
                typeof field.groupInternalOrder === 'number'
            );
        };

        const allFieldsValid = [
            ...settings.fixedFields,
            ...settings.instituteFields,
            ...settings.customFields,
        ].every(validateField);

        const allGroupFieldsValid = settings.fieldGroups.every((group) =>
            group.fields.every(validateGroupField)
        );

        return allFieldsValid && allGroupFieldsValid;
    } catch (error) {
        console.error('Error validating custom field settings:', error);
        return false;
    }
};

/**
 * Export field configuration for backup/import purposes
 */
export const exportCustomFieldSettings = (settings: CustomFieldSettingsData): string => {
    try {
        return JSON.stringify(settings, null, 2);
    } catch (error) {
        console.error('Error exporting custom field settings:', error);
        throw new Error('Failed to export settings');
    }
};

/**
 * Import field configuration from backup
 */
export const importCustomFieldSettings = (jsonString: string): CustomFieldSettingsData => {
    try {
        const imported = JSON.parse(jsonString) as CustomFieldSettingsData;

        if (!validateCustomFieldSettings(imported)) {
            throw new Error('Invalid settings format');
        }

        return imported;
    } catch (error) {
        console.error('Error importing custom field settings:', error);
        throw new Error('Failed to import settings: Invalid format');
    }
};

/**
 * Create a new custom field template (without ID - backend will assign the ID)
 */
export const createNewCustomField = (
    name: string,
    type: CustomFieldType,
    options?: string[]
): NewCustomField => {
    return {
        name,
        type,
        options: type === 'dropdown' || type === 'radio' || type === 'multi_select' ? options || [] : undefined,
        visibility: {
            learnersList: false,
            learnerEnrollment: false,
            learnerProfile: false,
        },
        required: false,
        order: 999, // Will be updated when added to settings
    };
};

/**
 * Create a new field group template (without ID - backend will assign the ID)
 */
export const createNewFieldGroup = (name: string): Omit<FieldGroup, 'id'> => {
    return {
        name,
        fields: [],
        order: 999, // Will be updated when added to settings
    };
};

/**
 * Create a temporary custom field for UI purposes (with temporary ID)
 * This should only be used in the UI before saving to backend
 */
export const createTempCustomField = (
    name: string,
    type: CustomFieldType,
    options?: string[],
    defaultValue?: string,
    fieldConfig?: CustomFieldFullConfig
): CustomField => {
    return {
        id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Temporary ID
        name,
        type,
        options: type === 'dropdown' || type === 'radio' || type === 'multi_select' ? options || [] : undefined,
        defaultValue,
        fieldConfig,
        visibility: {
            learnersList: false,
            learnerEnrollment: false,
            learnerProfile: false,
        },
        required: false,
        canBeDeleted: true,
        canBeEdited: true,
        canBeRenamed: true,
        order: 999, // Will be updated when added to settings
        groupName: null, // Initially not in any group
    };
};

/**
 * Check if a field has a temporary ID (not yet saved to backend)
 */
export const isTempField = (field: CustomField | FixedField | GroupField): boolean => {
    return field.id.startsWith('temp_');
};

/**
 * Convert a temporary field to a new field for API submission
 */
export const tempFieldToNewField = (field: CustomField): NewCustomField => {
    return {
        name: field.name,
        type: field.type,
        options: field.options,
        visibility: field.visibility,
        required: field.required,
        order: field.order,
    };
};

/**
 * Example workflow for creating a new custom field
 * This shows the proper sequence for handling new fields
 */
export const createCustomFieldWorkflow = async (
    name: string,
    type: CustomFieldType,
    options?: string[]
): Promise<CustomField> => {
    // Step 1: Create new field data (no ID)
    const newFieldData = createNewCustomField(name, type, options);

    // Step 2: Send to API to create the field (API will assign ID)
    // TODO: This would be a separate API endpoint like POST /custom-fields
    // const response = await authenticatedAxiosInstance.post('/custom-fields', newFieldData);
    // return response.data; // Returns CustomField with backend-assigned ID

    // For now, we'll simulate the response
    const simulatedBackendResponse: CustomField = {
        id: `backend_${Date.now()}`, // This would come from backend
        ...newFieldData,
        order: newFieldData.order || 999, // Ensure order is defined
        canBeDeleted: true,
        canBeEdited: true,
        canBeRenamed: true,
        groupName: null,
    };

    return simulatedBackendResponse;
};
