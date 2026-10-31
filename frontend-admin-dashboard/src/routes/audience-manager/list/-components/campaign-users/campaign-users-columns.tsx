import { ColumnDef, Row } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { Trash, UserPlus, ArrowSquareOut } from '@phosphor-icons/react';
import { LeadActivityNotesCell } from '@/components/shared/lead-activity-notes-cell';
import { Badge } from '@/components/ui/badge';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { CustomFieldSetupItem } from '../../-services/get-custom-field-setup';
import {
    getCampaignCustomFields,
    CampaignFormCustomField,
} from '../../-utils/getCampaignCustomFields';
import { LeadScoreBadge } from '@/components/shared/lead-score-badge';
import { counsellorDisplayName } from '@/components/shared/leads/counsellor-display';
import { LeadConversionBadge } from '@/components/shared/leads';
import { TatStatusBadge } from '@/components/shared/tat-status-badge';
import { SlaDeadlineCell } from '@/components/shared/sla-deadline-cell';
import { LeadStatusChip } from '@/components/shared/lead-status-chip';
import { LeadStatusSelect } from '@/components/shared/lead-status-select';
import { type LeadStatus } from '@/hooks/use-lead-statuses';
import type { CustomLeadStatus } from '@/hooks/use-lead-settings';
import type { LeadProfileSummary } from '@/hooks/use-lead-profiles';
import type { LatestNoteSummary } from '@/hooks/use-latest-notes-batch';
import {
    formatCustomFieldValue,
    isMultiSelectType,
    parseMultiSelectValue,
} from '../../-utils/format-custom-field-value';

// Details cell — opens the side view via SidebarTrigger, mirroring the
// "Details" column used in manage-students and manage-contacts so the affordance
// is consistent across audience tables.
const DetailsCell = ({
    row,
    onSelect,
}: {
    row: Row<CampaignUserTable>;
    onSelect: (row: CampaignUserTable) => void;
}) => {
    const handleClick = () => {
        onSelect(row.original);
    };
    return (
        <SidebarTrigger onClick={handleClick}>
            <ArrowSquareOut className="size-10 cursor-pointer text-neutral-600" />
        </SidebarTrigger>
    );
};

// Helper function to generate key from name
const generateKeyFromName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

export interface CampaignUserTable {
    id: string;
    index: number;
    submittedAt?: string;
    // Underscore-prefixed fields hold the source user info for the side-view click,
    // so they don't collide with dynamic custom-field accessors.
    _user_id?: string;
    _user?: {
        id?: string;
        full_name?: string;
        email?: string;
        mobile_number?: string;
        username?: string;
        gender?: string;
        date_of_birth?: string;
        city?: string;
        region?: string | null;
        pin_code?: string;
        address_line?: string;
        face_file_id?: string | null;
        profile_pic_file_id?: string | null;
    };
    _custom_field_values?: Record<string, string | null>;
    // TAT / follow-up SLA deadlines + badge (visual only)
    _tat_due_at?: string | null;
    _tat_due_overridden?: boolean | null; // admin set the TAT deadline by hand
    _is_duplicate?: boolean | null; // enquiry repeats an existing lead
    _follow_up_priority?: boolean | null; // open priority follow-up (reattempt)
    _first_response_at?: string | null; // drives "Responded in N" in the Reach-out-by cell
    _follow_up_due_at?: string | null;
    _tat_overdue?: boolean | null;
    _tat_due_soon?: boolean | null;
    _follow_up_overdue?: boolean | null;
    _sla_closed?: boolean | null; // Lost / Converted: no Pending / Overdue
    // Custom pipeline status (enquiry_status)
    _lead_status?: string | null;
    // Audience response id — required to update the lead status inline.
    _response_id?: string | null;
    [key: string]: any; // Allow dynamic custom field properties
}

// S.No column (index column) - always shown
const buildIndexColumn = (t: TFunction): ColumnDef<CampaignUserTable> => ({
    accessorKey: 'index',
    header: t('columns.serialNumber'),
    size: 80,
    minSize: 80,
    maxSize: 80,
    enableResizing: false,
    cell: ({ row }) => <div className="p-3 text-sm text-neutral-700">{row.original.index + 1}</div>,
});

const getFieldFromLookup = (
    lookup: Map<string, CustomFieldSetupItem> | undefined,
    identifier?: string
) => {
    if (!lookup || !identifier) return undefined;
    return lookup.get(identifier) || lookup.get(identifier.toLowerCase());
};

// Helper to check if a field is Name (full_name or name)
const isNameField = (fieldKey?: string, fieldName?: string): boolean => {
    if (!fieldKey && !fieldName) return false;
    const normalizedKey = fieldKey?.toLowerCase() || '';
    const normalizedName = fieldName?.toLowerCase() || '';
    return (
        normalizedKey === 'full_name' ||
        normalizedKey === 'name' ||
        normalizedName === 'full name' ||
        normalizedName === 'name'
    );
};

// Helper to check if a field is Email
const isEmailField = (fieldKey?: string, fieldName?: string): boolean => {
    if (!fieldKey && !fieldName) return false;
    const normalizedKey = fieldKey?.toLowerCase() || '';
    const normalizedName = fieldName?.toLowerCase() || '';
    return normalizedKey === 'email' || normalizedName === 'email';
};

/**
 * Generate dynamic columns based on custom fields from the campaign
 * This function:
 * 1. Extracts field IDs from campaign's institute_custom_fields
 * 2. Maps field IDs to field names using the custom field setup API response
 * 3. Creates table columns with field names as headers
 * 4. Uses field IDs as accessorKeys to get values from custom_field_values
 * All fields (including Name and Email) are treated dynamically from the API response
 */
export const generateDynamicColumns = (
    t: TFunction,
    campaignCustomFields: any[] = [],
    fieldLookup?: Map<string, CustomFieldSetupItem>,
    onDelete?: (responseId: string) => void,
    campaignFieldsMap?: Map<string, { name: string; key?: string }>,
    fieldMetadataMap?: Map<string, { fieldName?: string; fieldKey?: string; fieldType?: string }>,
    onRowClick?: (row: CampaignUserTable) => void,
    onSelectRow?: (row: CampaignUserTable) => void,
    leadProfiles?: Record<string, LeadProfileSummary>,
    latestNotes?: Record<string, LatestNoteSummary>,
    onAddNote?: (userId: string, userName: string) => void,
    onAssignCounsellor?: (userId: string, userName: string) => void,
    customStatuses?: CustomLeadStatus[],
    // Full status catalog (with ids) + refetch enable the inline editable status.
    leadStatusCatalog?: LeadStatus[],
    onLeadStatusUpdated?: () => void
): ColumnDef<CampaignUserTable>[] => {
    // When a select-row callback is provided, render a "Details" column first —
    // matching manage-students and manage-contacts so the side-view affordance is
    // discoverable in the same place across audience tables.
    const columns: ColumnDef<CampaignUserTable>[] = [];
    if (onSelectRow) {
        columns.push({
            id: 'details',
            size: 80,
            minSize: 60,
            maxSize: 120,
            enablePinning: true,
            header: t('columns.details'),
            cell: ({ row }) => <DetailsCell row={row} onSelect={onSelectRow} />,
        });
    }
    columns.push(buildIndexColumn(t)); // S.No column

    try {
        const lookup = fieldLookup ?? new Map<string, CustomFieldSetupItem>();

        // Collect all field IDs from campaign/API that we need to create columns for
        const fieldMappings: Array<{ id: string; name: string; key: string }> = [];
        const processedFieldIds = new Set<string>(); // Track processed field IDs to avoid duplicates
        const fieldIdsToProcess = new Set<string>();

        if (campaignCustomFields && campaignCustomFields.length > 0) {
            campaignCustomFields.forEach((campaignField: any) => {
                const fieldId =
                    campaignField.custom_field?.id ||
                    campaignField.id ||
                    campaignField._id ||
                    campaignField.field_id;
                if (fieldId) {
                    fieldIdsToProcess.add(fieldId);
                }
            });
        }

        // Process all field IDs from campaign - treat all fields dynamically (including Name and Email)
        fieldIdsToProcess.forEach((fieldId) => {
            if (!processedFieldIds.has(fieldId)) {
                let fieldInfo =
                    getFieldFromLookup(lookup, fieldId) ||
                    getFieldFromLookup(lookup, fieldId?.toLowerCase());

                // Exhaustive search through all setup entries if simple lookup failed
                if (!fieldInfo && lookup.size > 0) {
                    const searchId = fieldId.toLowerCase();
                    const searchIdNormalized = searchId.replace(/[^a-zA-Z0-9]/g, '');
                    for (const [, field] of lookup.entries()) {
                        const cfId = field.custom_field_id?.toLowerCase();
                        const fKey = field.field_key?.toLowerCase();
                        if (
                            cfId === searchId ||
                            fKey === searchId ||
                            cfId?.replace(/[^a-zA-Z0-9]/g, '') === searchIdNormalized ||
                            fKey?.replace(/[^a-zA-Z0-9]/g, '') === searchIdNormalized
                        ) {
                            fieldInfo = field;
                            break;
                        }
                    }
                }

                if (fieldInfo) {
                    const fieldName = fieldInfo.field_name
                        ? fieldInfo.field_name.charAt(0).toUpperCase() +
                          fieldInfo.field_name.slice(1)
                        : fieldInfo.field_key || fieldId;
                    const fieldKey =
                        fieldInfo.field_key || generateKeyFromName(fieldInfo.field_name || fieldId);

                    fieldMappings.push({
                        id: fieldId,
                        name: fieldName,
                        key: fieldKey,
                    });
                    processedFieldIds.add(fieldId);
                } else {
                    // Fallback: try campaign config, then API metadata, then field ID
                    const campaignField =
                        campaignFieldsMap?.get(fieldId) ||
                        campaignFieldsMap?.get(fieldId.toLowerCase());
                    const apiMeta = fieldMetadataMap?.get(fieldId);

                    let fieldName = fieldId;
                    let fieldKey = generateKeyFromName(fieldId);

                    if (campaignField?.name) {
                        fieldName =
                            campaignField.name.charAt(0).toUpperCase() +
                            campaignField.name.slice(1);
                        fieldKey = campaignField.key || generateKeyFromName(fieldName);
                    } else if (apiMeta?.fieldName) {
                        fieldName =
                            apiMeta.fieldName.charAt(0).toUpperCase() + apiMeta.fieldName.slice(1);
                        fieldKey = apiMeta.fieldKey || generateKeyFromName(fieldName);
                    }

                    fieldMappings.push({
                        id: fieldId,
                        name: fieldName,
                        key: fieldKey,
                    });
                    processedFieldIds.add(fieldId);
                }
            }
        });

        // Sort field mappings to prioritize Name and Email first
        // Priority order: Name (full_name/name) -> Email -> Other fields
        const sortedFieldMappings = fieldMappings.sort((a, b) => {
            const aIsName = isNameField(a.key, a.name);
            const bIsName = isNameField(b.key, b.name);
            const aIsEmail = isEmailField(a.key, a.name);
            const bIsEmail = isEmailField(b.key, b.name);

            // Priority: Name (1) > Email (2) > Others (3)
            const getPriority = (isName: boolean, isEmail: boolean) => {
                if (isName) return 1;
                if (isEmail) return 2;
                return 3;
            };

            const aPriority = getPriority(aIsName, aIsEmail);
            const bPriority = getPriority(bIsName, bIsEmail);

            // If same priority, maintain original order
            if (aPriority === bPriority) {
                return 0;
            }

            return aPriority - bPriority;
        });

        // Create columns for each field mapping (Name and Email first, then others)
        sortedFieldMappings.forEach((fieldMapping) => {
            const { id: fieldId, name: fieldName, key: fieldKey } = fieldMapping;

            // Determine cell styling based on field type
            const isNameFieldCell = isNameField(fieldKey, fieldName);

            // Resolve the field's *content* type once per column (dropdown,
            // multi_select, checkbox, file, …) so cell rendering can format
            // the stored string for human display instead of dumping raw JSON.
            const setupEntry =
                lookup.get(fieldId) || lookup.get(fieldId.toLowerCase());
            const apiMeta = fieldMetadataMap?.get(fieldId);
            const fieldType =
                apiMeta?.fieldType ?? setupEntry?.field_type ?? 'textfield';
            const isMultiSelect = isMultiSelectType(fieldType);

            columns.push({
                accessorKey: fieldId, // Use field ID as accessorKey to match custom_field_values
                header: fieldName,
                size: isNameFieldCell ? 220 : 200,
                minSize: isNameFieldCell ? 180 : 150,
                maxSize: isNameFieldCell ? 300 : 250,
                cell: ({ row }) => {
                    // Value can be null if the user doesn't have data for this field
                    const rawValue = row.original[fieldId];
                    const valueAsString =
                        rawValue === null || rawValue === undefined
                            ? null
                            : (rawValue as string);
                    const clickable = !!onRowClick && !!row.original._user_id;
                    // Augment the Name cell with a HOT/WARM/COLD lead-score badge
                    // when the lead system is on and a profile exists for this row's
                    // user. Leads without a linked user_id silently render no badge.
                    const userId = row.original._user_id;
                    const leadProfile =
                        isNameFieldCell && leadProfiles && userId
                            ? leadProfiles[userId]
                            : undefined;

                    // Multi-select renders as a row of chips so several picks
                    // read cleanly instead of as a JSON-encoded string.
                    if (isMultiSelect) {
                        const items = parseMultiSelectValue(valueAsString);
                        return (
                            <div
                                className={`p-3 text-sm ${clickable ? 'cursor-pointer hover:text-primary-600' : ''}`}
                                onClick={
                                    clickable ? () => onRowClick!(row.original) : undefined
                                }
                            >
                                {items.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                        {items.map((item, idx) => (
                                            <Badge
                                                key={`${item}-${idx}`}
                                                variant="secondary"
                                                className="bg-neutral-100 text-neutral-700 hover:bg-neutral-100"
                                            >
                                                {item}
                                            </Badge>
                                        ))}
                                    </div>
                                ) : (
                                    <span className="text-neutral-500">-</span>
                                )}
                            </div>
                        );
                    }

                    const displayValue = formatCustomFieldValue(valueAsString, fieldType, t);
                    return (
                        <div
                            className={`p-3 text-sm ${isNameFieldCell ? 'font-medium text-neutral-900' : 'text-neutral-700'} ${clickable ? 'cursor-pointer hover:text-primary-600' : ''}`}
                            onClick={clickable ? () => onRowClick!(row.original) : undefined}
                        >
                            <div className="flex flex-col gap-0.5">
                                <span>{displayValue}</span>
                                {isNameFieldCell && (
                                    <div className="flex flex-wrap items-center gap-1">
                                        {leadProfile && leadProfile.conversion_status !== 'CONVERTED' && (
                                            <LeadScoreBadge
                                                score={leadProfile.best_score}
                                                tier={leadProfile.lead_tier}
                                                size="sm"
                                            />
                                        )}
                                        <LeadConversionBadge
                                            conversionStatus={leadProfile?.conversion_status}
                                        />
                                        <TatStatusBadge
                                            tatOverdue={row.original._tat_overdue}
                                            tatDueSoon={row.original._tat_due_soon}
                                            followUpOverdue={row.original._follow_up_overdue}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                },
            });
        });
    } catch (error) {
        console.error('❌ Error generating dynamic columns:', error);
    }

    // Lead status (custom pipeline stage) column — inline-editable chip when the
    // full catalog + a response id are available, otherwise a read-only chip.
    const hasEditableStatus = !!(leadStatusCatalog && leadStatusCatalog.length > 0);
    if (hasEditableStatus || (customStatuses && customStatuses.length > 0)) {
        columns.push({
            id: 'lead_status',
            header: t('columns.status'),
            size: 160,
            minSize: 120,
            maxSize: 200,
            cell: ({ row }) => {
                if (hasEditableStatus && row.original._response_id) {
                    return (
                        <div className="p-3">
                            <LeadStatusSelect
                                responseId={row.original._response_id}
                                currentStatus={row.original._lead_status}
                                statuses={leadStatusCatalog as LeadStatus[]}
                                onUpdated={onLeadStatusUpdated}
                            />
                        </div>
                    );
                }
                return row.original._lead_status ? (
                    <div className="p-3">
                        <LeadStatusChip
                            status={row.original._lead_status}
                            statuses={customStatuses ?? []}
                        />
                    </div>
                ) : (
                    <div className="p-3 text-sm text-neutral-400">—</div>
                );
            },
        });
    }

    // SLA deadline columns (reach-out / follow-up) — shown with the other lead-ops columns.
    if (onAssignCounsellor) {
        columns.push({
            id: 'reach_out_by',
            header: t('columns.reachOutIn'),
            size: 160,
            minSize: 130,
            maxSize: 200,
            cell: ({ row }) => (
                <div className="p-3">
                    <SlaDeadlineCell
                        mode="response"
                        dueAt={row.original._tat_due_at}
                        overdue={row.original._tat_overdue}
                        respondedAt={row.original._first_response_at}
                        baselineAt={row.original.submittedAt}
                        responseId={row.original._response_id}
                        dueOverridden={row.original._tat_due_overridden}
                        closed={row.original._sla_closed}
                    />
                </div>
            ),
        });
        columns.push({
            id: 'follow_up_by',
            header: t('columns.followUpAt'),
            size: 150,
            minSize: 120,
            maxSize: 180,
            cell: ({ row }) => (
                <div className="p-3">
                    <SlaDeadlineCell
                        dueAt={row.original._follow_up_due_at}
                        overdue={row.original._follow_up_overdue}
                        closed={row.original._sla_closed}
                    />
                </div>
            ),
        });
    }

    // Counsellor column — uses the batched LeadProfileSummary so we don't
    // re-fetch counselor info per row. When unassigned, render an "Assign"
    // affordance that opens AssignCounselorToLeadDialog at the table level.
    if (onAssignCounsellor) {
        columns.push({
            id: 'counsellor',
            header: t('columns.counsellor'),
            size: 200,
            minSize: 160,
            maxSize: 240,
            cell: ({ row }) => {
                const userId = row.original._user_id;
                const userName =
                    (row.original.full_name as string) ||
                    row.original._user?.full_name ||
                    '';
                const profile = userId && leadProfiles ? leadProfiles[userId] : undefined;
                const counselorName = counsellorDisplayName(profile);
                if (!userId) {
                    return <div className="p-3 text-sm text-neutral-400">—</div>;
                }
                if (counselorName) {
                    return (
                        <div className="flex items-center justify-between gap-2 p-3">
                            <div className="flex min-w-0 items-center gap-2">
                                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                                    {counselorName[0]?.toUpperCase()}
                                </div>
                                <span className="truncate text-sm text-neutral-800">
                                    {counselorName}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAssignCounsellor(userId, userName);
                                }}
                                className="shrink-0 text-xs text-neutral-400 hover:text-primary-600"
                            >
                                {t('actions.reassign')}
                            </button>
                        </div>
                    );
                }
                return (
                    <div className="p-3">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onAssignCounsellor(userId, userName);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-primary-300 hover:text-primary-600"
                        >
                            <UserPlus className="size-3.5" />
                            {t('actions.assign')}
                        </button>
                    </div>
                );
            },
        });
    }

    // Activity & Notes column — shows up to 5 most-recent cross-stage events
    // stacked compactly (title, truncated description, date, actor) and a
    // small Add button. Empty state offers a single "Add Note" affordance.
    if (onAddNote) {
        columns.push({
            id: 'activity_notes',
            header: t('columns.activityNotes'),
            size: 320,
            minSize: 260,
            maxSize: 420,
            cell: ({ row }) => {
                const userId = row.original._user_id;
                if (!userId) {
                    return <div className="p-3 text-sm text-neutral-400">—</div>;
                }
                const userName =
                    (row.original.full_name as string) ||
                    row.original._user?.full_name ||
                    '';
                const summary = latestNotes ? latestNotes[userId] : undefined;
                return (
                    <div className="p-2">
                        <LeadActivityNotesCell
                            recent={summary?.recent ?? []}
                            count={summary?.count ?? 0}
                            onAdd={() => onAddNote(userId, userName)}
                        />
                    </div>
                );
            },
        });
    }

    // Add "Submitted On" column at the end
    columns.push({
        accessorKey: 'submittedAt',
        header: t('columns.submittedOn'),
        size: 250,
        minSize: 220,
        maxSize: 300,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.submittedAt || '-'}</div>
        ),
    });

    if (onDelete) {
        columns.push({
            id: 'actions',
            header: '',
            size: 60,
            minSize: 60,
            maxSize: 60,
            enableResizing: false,
            cell: ({ row }) => (
                <div className="flex items-center justify-center p-2">
                    <button
                        onClick={() => onDelete(row.original.id)}
                        className="text-neutral-400 transition-colors hover:text-red-500"
                        title={t('actions.deleteLead')}
                    >
                        <Trash className="size-4" />
                    </button>
                </div>
            ),
        });
    }

    return columns;
};

// Default columns (fallback when no custom fields) - uses getCampaignCustomFields() for all columns
export const buildCampaignUsersColumns = (t: TFunction): ColumnDef<CampaignUserTable>[] => {
    const columns: ColumnDef<CampaignUserTable>[] = [buildIndexColumn(t)];

    try {
        const campaignCustomFields = getCampaignCustomFields();

        campaignCustomFields.forEach((field: CampaignFormCustomField) => {
            const fieldName = field.name;
            const fieldKey = field.key;

            if (!fieldName || !fieldKey) return;

            const isNameField = fieldKey === 'full_name';

            columns.push({
                accessorKey: fieldKey,
                header: fieldName,
                size: isNameField ? 220 : 200,
                minSize: isNameField ? 180 : 150,
                cell: ({ row }) => {
                    const value = row.original[fieldKey];
                    return (
                        <div
                            className={`p-3 text-sm ${isNameField ? 'font-medium text-neutral-900' : 'text-neutral-700'}`}
                        >
                            {value && value !== '-' && value !== 'N/A' ? String(value) : '-'}
                        </div>
                    );
                },
            });
        });
    } catch (error) {
        console.error('❌ Error generating default columns:', error);
    }

    // Add "Submitted On" column at the end
    columns.push({
        accessorKey: 'submittedAt',
        header: t('columns.submittedOn'),
        size: 200,
        minSize: 180,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.submittedAt || '-'}</div>
        ),
    });

    return columns;
};
