import { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { DotsThree } from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CustomFieldSetupItem } from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import { CounsellorNameCell } from './CounsellorNameCell';
import { LeadScoreBadge } from '@/components/shared/lead-score-badge';
import { DuplicateBadge } from '@/components/shared/duplicate-badge';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Helper function to generate key from name
const generateKeyFromName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

export interface EnquiryTableRow {
    id: string;
    index: number;

    // Student Details (from child_user)
    studentName: string;
    studentGender?: string | null;
    studentDob?: string | null;

    // Parent Details (from parent_user)
    parentName: string;
    parentEmail: string;
    parentMobile: string;

    // Enquiry Details
    trackingId?: string | null;
    className?: string;
    enquiryStatus: string;
    sourceType: string;
    assignedCounsellor?: string;

    // Phase 1 — Lead score + dedup
    leadScore?: number | null;
    leadTier?: string | null;
    isDuplicate?: boolean | null;
    primaryResponseId?: string | null;

    // Custom Fields (dynamic)
    [key: string]: unknown;
}

const getFieldFromLookup = (
    lookup: Map<string, CustomFieldSetupItem> | undefined,
    identifier?: string
) => {
    if (!lookup || !identifier) return undefined;
    return lookup.get(identifier) || lookup.get(identifier.toLowerCase());
};

/** Translated label for a raw `enquiry_status` enum value from the backend. */
const getEnquiryStatusLabel = (t: TFunction, status?: string | null): string => {
    if (!status) return '-';
    const map: Record<string, string> = {
        NEW: t('admissionsEnquiryTableColumns:status.new'),
        CONTACTED: t('admissionsEnquiryTableColumns:status.contacted'),
        QUALIFIED: t('admissionsEnquiryTableColumns:status.qualified'),
        NOT_ELIGIBLE: t('admissionsEnquiryTableColumns:status.notEligible'),
        FOLLOW_UP: t('admissionsEnquiryTableColumns:status.followUp'),
        CLOSED: t('admissionsEnquiryTableColumns:status.closed'),
        CONVERTED: t('admissionsEnquiryTableColumns:status.converted'),
        ADMITTED: t('admissionsEnquiryTableColumns:status.admitted'),
    };
    // Fall back to the raw value for any status the backend adds before the
    // frontend catalog is updated, so an unknown status still renders instead
    // of disappearing.
    return map[status] ?? status;
};

/** Translated label for a raw `source_type` enum value from the backend. */
const getEnquirySourceLabel = (t: TFunction, source?: string | null): string => {
    if (!source) return '-';
    const map: Record<string, string> = {
        WEBSITE: t('admissionsEnquiryTableColumns:source.website'),
        GOOGLE_ADS: t('admissionsEnquiryTableColumns:source.googleAds'),
        FACEBOOK: t('admissionsEnquiryTableColumns:source.facebook'),
        INSTAGRAM: t('admissionsEnquiryTableColumns:source.instagram'),
        REFERRAL: t('admissionsEnquiryTableColumns:source.referral'),
        OTHER: t('admissionsEnquiryTableColumns:source.other'),
    };
    return map[source] ?? source;
};

/**
 * Generate dynamic columns based on custom fields from the enquiry
 * Columns are organized logically but flattened (no nested column groups)
 */
export const generateDynamicColumns = (
    t: TFunction,
    enquiryCustomFields: Record<string, unknown>[] = [],
    fieldLookup?: Map<string, CustomFieldSetupItem>,
    selectedRows?: Set<string>,
    onRowSelectionChange?: (id: string, selected: boolean) => void,
    onSelectAll?: (selected: boolean) => void,
    onViewDetails?: (enquiryId: string) => void,
    onActivityLog?: (enquiryId: string) => void,
    showLeadScore = true
): ColumnDef<EnquiryTableRow>[] => {
    const columns: ColumnDef<EnquiryTableRow>[] = [];

    // Checkbox column at the start
    columns.push({
        id: 'select',
        header: () => (
            <Checkbox
                checked={false}
                onCheckedChange={(value) => {
                    onSelectAll?.(!!value);
                }}
                aria-label={t('admissionsEnquiryTableColumns:aria.selectAll')}
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={selectedRows?.has(row.original.id)}
                onCheckedChange={(value) => {
                    onRowSelectionChange?.(row.original.id, !!value);
                }}
                aria-label={t('admissionsEnquiryTableColumns:aria.selectRow')}
            />
        ),
        size: 50,
        enableResizing: false,
    });

    // S.No column
    columns.push({
        accessorKey: 'index',
        header: t('admissionsEnquiryTableColumns:columns.serialNumber'),
        size: 80,
        minSize: 80,
        maxSize: 80,
        enableResizing: false,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.index + 1}</div>
        ),
    });

    // Class column (moved to front for visibility)
    columns.push({
        accessorKey: 'className',
        header: t('admissionsEnquiryTableColumns:columns.class'),
        size: 200,
        minSize: 180,
        maxSize: 300,
        cell: ({ row }) => (
            <div className="p-3 text-sm font-medium text-neutral-900">
                {row.original.className || '-'}
            </div>
        ),
    });

    // === STUDENT DETAILS GROUP ===
    columns.push({
        accessorKey: 'studentName',
        header: t('admissionsEnquiryTableColumns:columns.studentName', {
            learnerLabel: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
        }),
        size: 180,
        minSize: 150,
        maxSize: 250,
        cell: ({ row }) => (
            <div className="flex flex-col gap-0.5 p-3">
                <span className="text-sm font-medium text-neutral-900">
                    {row.original.studentName || '-'}
                </span>
                <DuplicateBadge isDuplicate={row.original.isDuplicate} />
            </div>
        ),
    });

    columns.push({
        accessorKey: 'studentGender',
        header: t('admissionsEnquiryTableColumns:columns.gender'),
        size: 120,
        minSize: 100,
        maxSize: 150,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.studentGender || '-'}</div>
        ),
    });

    columns.push({
        accessorKey: 'studentDob',
        header: t('admissionsEnquiryTableColumns:columns.dateOfBirth'),
        size: 140,
        minSize: 120,
        maxSize: 180,
        cell: ({ row }) => {
            const dob = row.original.studentDob;
            let formattedDate = '-';

            if (dob) {
                try {
                    const date = new Date(dob);
                    if (!isNaN(date.getTime())) {
                        const day = String(date.getDate()).padStart(2, '0');
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const year = date.getFullYear();
                        formattedDate = `${day}/${month}/${year}`;
                    }
                } catch (e) {
                    formattedDate = '-';
                }
            }

            return <div className="p-3 text-sm text-neutral-700">{formattedDate}</div>;
        },
    });

    // === PARENT DETAILS GROUP ===
    columns.push({
        accessorKey: 'parentName',
        header: t('admissionsEnquiryTableColumns:columns.parentName'),
        size: 180,
        minSize: 150,
        maxSize: 250,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.parentName || '-'}</div>
        ),
    });

    columns.push({
        accessorKey: 'parentEmail',
        header: t('admissionsEnquiryTableColumns:columns.parentEmail'),
        size: 220,
        minSize: 180,
        maxSize: 300,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.parentEmail || '-'}</div>
        ),
    });

    columns.push({
        accessorKey: 'parentMobile',
        header: t('admissionsEnquiryTableColumns:columns.parentMobile'),
        size: 150,
        minSize: 120,
        maxSize: 180,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">{row.original.parentMobile || '-'}</div>
        ),
    });

    // === ENQUIRY DETAILS GROUP ===
    columns.push({
        accessorKey: 'trackingId',
        header: t('admissionsEnquiryTableColumns:columns.trackingId'),
        size: 150,
        minSize: 120,
        maxSize: 200,
        cell: ({ row }) => (
            <div className="p-3 text-sm font-medium text-neutral-900">
                {row.original.trackingId || '-'}
            </div>
        ),
    });

    columns.push({
        accessorKey: 'enquiryStatus',
        header: t('admissionsEnquiryTableColumns:columns.status'),
        size: 150,
        minSize: 120,
        maxSize: 180,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">
                <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        row.original.enquiryStatus === 'NEW'
                            ? 'bg-blue-100 text-blue-700'
                            : row.original.enquiryStatus === 'CONTACTED'
                              ? 'bg-green-100 text-green-700'
                              : row.original.enquiryStatus === 'QUALIFIED'
                                ? 'bg-purple-100 text-purple-700'
                                : row.original.enquiryStatus === 'NOT_ELIGIBLE'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-gray-100 text-gray-700'
                    }`}
                >
                    {getEnquiryStatusLabel(t, row.original.enquiryStatus)}
                </span>
            </div>
        ),
    });

    columns.push({
        accessorKey: 'sourceType',
        header: t('admissionsEnquiryTableColumns:columns.source'),
        size: 160,
        minSize: 130,
        maxSize: 200,
        cell: ({ row }) => (
            <div className="p-3 text-sm text-neutral-700">
                {getEnquirySourceLabel(t, row.original.sourceType)}
            </div>
        ),
    });

    columns.push({
        id: 'counsellor',
        header: t('admissionsEnquiryTableColumns:columns.counsellor'),
        size: 200,
        minSize: 180,
        maxSize: 250,
        cell: ({ row }) => (
            <CounsellorNameCell
                counsellorId={row.original.assignedCounsellor}
                enquiryId={row.original.id}
            />
        ),
    });

    // === CUSTOM FIELDS (individual columns) ===
    try {
        const lookup = fieldLookup ?? new Map<string, CustomFieldSetupItem>();

        // Collect all field IDs from enquiry/API that we need to create columns for
        const fieldMappings: Array<{ id: string; name: string; key: string }> = [];
        const processedFieldIds = new Set<string>();
        const fieldIdsToProcess = new Set<string>();

        if (enquiryCustomFields && enquiryCustomFields.length > 0) {
            enquiryCustomFields.forEach((enquiryField) => {
                const cf = enquiryField.custom_field as Record<string, unknown> | undefined;
                const fieldId =
                    (cf?.id as string) ||
                    (enquiryField.id as string) ||
                    (enquiryField._id as string) ||
                    (enquiryField.field_id as string);
                if (fieldId) {
                    fieldIdsToProcess.add(fieldId);
                }
            });
        }

        // Process all field IDs from enquiry
        fieldIdsToProcess.forEach((fieldId) => {
            if (!processedFieldIds.has(fieldId)) {
                const fieldInfo =
                    getFieldFromLookup(lookup, fieldId) ||
                    getFieldFromLookup(lookup, fieldId?.toLowerCase());

                // Only create column if field info is found in lookup
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
                }
            }
        });

        // Create columns for each field mapping
        fieldMappings.forEach((fieldMapping) => {
            const { id: fieldId, name: fieldName } = fieldMapping;

            columns.push({
                accessorKey: fieldId,
                header: fieldName,
                size: 200,
                minSize: 150,
                maxSize: 250,
                cell: ({ row }) => {
                    const value = row.original[fieldId];
                    const displayValue =
                        value !== null &&
                        value !== undefined &&
                        value !== '' &&
                        value !== '-' &&
                        value !== 'N/A'
                            ? String(value)
                            : '-';
                    return <div className="p-3 text-sm text-neutral-700">{displayValue}</div>;
                },
            });
        });
    } catch (error) {
        console.error('❌ Error generating dynamic columns:', error);
    }

    // Lead Interest Score column — gated by lead settings config
    if (showLeadScore) {
        columns.push({
            accessorKey: 'leadScore',
            header: t('admissionsEnquiryTableColumns:columns.leadInterestScore'),
            size: 160,
            minSize: 140,
            maxSize: 200,
            cell: ({ row }) => (
                <div className="p-3">
                    <LeadScoreBadge score={row.original.leadScore} size="sm" />
                </div>
            ),
        });
    }

    // Actions column at the end
    columns.push({
        id: 'actions',
        header: t('admissionsEnquiryTableColumns:columns.actions'),
        size: 100,
        enableResizing: false,
        cell: ({ row }) => (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">
                            {t('admissionsEnquiryTableColumns:aria.openMenu')}
                        </span>
                        <DotsThree className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        onClick={() => onViewDetails?.(row.original.id)}
                        className="cursor-pointer"
                    >
                        {t('admissionsEnquiryTableColumns:actionsMenu.viewDetails')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={() => onActivityLog?.(row.original.id)}
                        className="cursor-pointer"
                    >
                        {t('admissionsEnquiryTableColumns:actionsMenu.activityLog')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        ),
    });

    return columns;
};
