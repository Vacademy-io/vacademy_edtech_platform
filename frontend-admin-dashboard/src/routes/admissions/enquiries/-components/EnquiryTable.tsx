import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLeadSettings } from '@/hooks/use-lead-settings';
import { MyTable } from '@/components/design-system/table';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import EmptyInvitePage from '@/assets/svgs/empty-invite-page.svg';
import { Button } from '@/components/ui/button';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { CaretLeft, CaretRight, DownloadSimple } from '@phosphor-icons/react';
import { generateDynamicColumns, EnquiryTableRow } from './enquiry-table-columns';
import { convertToLocalDateTime } from '@/constants/helper';
import { useCustomFieldSetup } from '@/routes/audience-manager/list/-hooks/useCustomFieldSetup';
import { CustomFieldSetupItem } from '@/routes/audience-manager/list/-services/get-custom-field-setup';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { toast } from 'sonner';
import { fetchEnquiries } from '../-services/get-enquiries';
import { useSuspenseQuery } from '@tanstack/react-query';
import { handleFetchEnquiries } from '../-services/get-enquiries';
import { useNavigate } from '@tanstack/react-router';
import { MyButton } from '@/components/design-system/button';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import type { StudentTable } from '@/types/student-table-types';
import type { EnquiryItem } from '../-services/get-enquiries';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    updateEnquiryStatus,
    buildEnquiryStatusOptions,
    buildConversionStatusOptions,
    EnquiryStatus,
    ConversionStatus,
} from '../-services/update-enquiry-status';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ActivityLogDialog } from './enquiry-side-view/activity-log-dialog';
import { EnquiryBulkImportDialog } from './EnquiryBulkImportDialog';

// Helper function to generate key from name
const generateKeyFromName = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

interface EnquiryTableProps {
    enquiryId: string;
    enquiryName?: string;
    customFieldsJson?: string;
    statusFilter?: string;
    sourceFilter?: string;
    packageSessionFilter?: string;
    dateRangeFilter?: { from?: string; to?: string };
    searchFilter?: string;
    // Phase 1 filters
    leadTierFilter?: string;
    excludeDuplicates?: boolean;
    sortBy?: string;
    sortDirection?: string;
    minLeadScore?: number;
    maxLeadScore?: number;
}

interface EnquiryTableInnerProps extends EnquiryTableProps {
    setIsSidebarOpen: (open: boolean) => void;
    setSelectedEnquiryId: (id: string | null) => void;
    onSortChange?: (sortBy: string, direction: string) => void;
}

// Map an EnquiryItem to a minimal StudentTable shape for the sidebar profile header
const mapEnquiryToStudent = (enquiry: EnquiryItem): StudentTable =>
    ({
        id: enquiry.child_user?.id || enquiry.audience_response_id,
        user_id: enquiry.child_user?.id || enquiry.audience_response_id,
        username: enquiry.child_user?.username || null,
        full_name: enquiry.child_user?.full_name || enquiry.parent_name || '',
        email: enquiry.child_user?.email || enquiry.parent_email || '',
        mobile_number: enquiry.child_user?.mobile_number || enquiry.parent_mobile || '',
        date_of_birth: enquiry.child_user?.date_of_birth || '',
        gender: enquiry.child_user?.gender || '',
        face_file_id: enquiry.child_user?.profile_pic_file_id || null,
        status: 'ACTIVE',
        address_line: '',
        attendance_percent: 0,
        referral_count: 0,
        region: null,
        city: '',
        pin_code: '',
        fathers_name: '',
        mothers_name: '',
        father_mobile_number: '',
        father_email: '',
        mother_mobile_number: '',
        mother_email: '',
        linked_institute_name: null,
        created_at: enquiry.enquiry_created_at || '',
        updated_at: '',
        package_session_id: '',
        institute_enrollment_id: '',
        institute_id: '',
        expiry_date: 0,
        parents_email: enquiry.parent_user?.email || enquiry.parent_email || '',
        parents_mobile_number: enquiry.parent_user?.mobile_number || enquiry.parent_mobile || '',
        parents_to_mother_email: '',
        parents_to_mother_mobile_number: '',
        destination_package_session_id: enquiry.destination_package_session_id || '',
        enroll_invite_id: '',
        payment_status: '',
        custom_fields: enquiry.custom_fields || {},
        session_expiry_days: 0,
    }) as StudentTable;

const EnquiryTableInner = ({
    enquiryId,
    enquiryName,
    customFieldsJson,
    statusFilter,
    sourceFilter,
    packageSessionFilter,
    dateRangeFilter,
    searchFilter,
    leadTierFilter,
    excludeDuplicates,
    sortBy,
    sortDirection,
    minLeadScore,
    maxLeadScore,
    setIsSidebarOpen,
    setSelectedEnquiryId,
}: EnquiryTableInnerProps) => {
    const { t } = useTranslation([
        'admissionsEnquiryTable',
        'admissionsEnquiryTableColumns',
        'admissionsUpdateEnquiryStatus',
    ]);
    const enquiryStatusOptions = useMemo(() => buildEnquiryStatusOptions(t), [t]);
    const conversionStatusOptions = useMemo(() => buildConversionStatusOptions(t), [t]);
    const [page, setPage] = useState(0);
    const pageSize = 10;
    const { instituteDetails, getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const instituteId = instituteDetails?.id;
    const leadSettings = useLeadSettings();
    const [isDownloading, setIsDownloading] = useState(false);
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
    const navigate = useNavigate();
    const { setSelectedStudent } = useStudentSidebar();
    const queryClient = useQueryClient();
    const [bulkEnquiryStatus, setBulkEnquiryStatus] = useState<EnquiryStatus | ''>('');
    const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
    const [selectedActivityEnquiryId, setSelectedActivityEnquiryId] = useState<string | null>(null);
    const [bulkConversionStatus, setBulkConversionStatus] = useState<ConversionStatus | ''>('');
    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

    // Reset page and selected rows when enquiry or filters change
    useEffect(() => {
        setPage(0);
        setSelectedRows(new Set());
    }, [
        enquiryId,
        statusFilter,
        sourceFilter,
        packageSessionFilter,
        dateRangeFilter,
        searchFilter,
        leadTierFilter,
        excludeDuplicates,
        sortBy,
        sortDirection,
        minLeadScore,
        maxLeadScore,
    ]);

    const bulkUpdateMutation = useMutation({
        mutationFn: updateEnquiryStatus,
        onSuccess: () => {
            toast.success(t('toast.bulkUpdateSuccess', { count: selectedRows.size }));
            setSelectedRows(new Set());
            setBulkEnquiryStatus('');
            setBulkConversionStatus('');
            queryClient.invalidateQueries();
        },
        onError: () => {
            toast.error(t('toast.bulkUpdateError'));
        },
    });

    const handleBulkApply = () => {
        if (selectedRows.size === 0) return;
        if (!bulkEnquiryStatus && !bulkConversionStatus) {
            toast.warning(t('toast.selectAtLeastOneStatus'));
            return;
        }
        bulkUpdateMutation.mutate({
            enquiry_ids: Array.from(selectedRows),
            ...(bulkEnquiryStatus ? { enquiry_status: bulkEnquiryStatus } : {}),
            ...(bulkConversionStatus ? { conversion_status: bulkConversionStatus } : {}),
        });
    };

    // Parse custom fields from JSON
    const customFields = useMemo(() => {
        if (!customFieldsJson) return [];
        try {
            const parsed = JSON.parse(customFieldsJson);
            const fields = Array.isArray(parsed) ? parsed : [];
            return fields;
        } catch (error) {
            console.error('Error parsing custom fields:', error);
            return [];
        }
    }, [customFieldsJson]);

    const {
        data: customFieldSetup,
        isLoading: isCustomFieldsLoading,
        error: customFieldsError,
    } = useCustomFieldSetup(instituteId);

    const customFieldMap = useMemo(() => {
        const map = new Map<string, CustomFieldSetupItem>();
        if (!customFieldSetup || customFieldSetup.length === 0) {
            return map;
        }

        customFieldSetup.forEach((field) => {
            const registerKey = (key?: string) => {
                if (!key) return;
                map.set(key, field);
                map.set(key.toLowerCase(), field);
                map.set(key.toUpperCase(), field);
                const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (normalized && normalized !== key.toLowerCase()) {
                    map.set(normalized, field);
                }
            };

            registerKey(field.custom_field_id);
            registerKey(field.field_key);
            if (field.field_name) {
                const nameKey = generateKeyFromName(field.field_name);
                registerKey(nameKey);
            }
        });
        return map;
    }, [customFieldSetup]);

    const enquiriesPayload = useMemo(
        () => ({
            audience_id: enquiryId,
            page,
            size: pageSize,
            status: statusFilter,
            source: sourceFilter,
            destination_package_session_id: packageSessionFilter,
            created_from: dateRangeFilter?.from,
            created_to: dateRangeFilter?.to,
            search: searchFilter,
            lead_tier: leadTierFilter,
            exclude_duplicates: excludeDuplicates,
            sort_by: sortBy,
            sort_direction: sortDirection,
            min_lead_score: minLeadScore,
            max_lead_score: maxLeadScore,
        }),
        [
            enquiryId,
            page,
            pageSize,
            statusFilter,
            sourceFilter,
            packageSessionFilter,
            dateRangeFilter,
            searchFilter,
            leadTierFilter,
            excludeDuplicates,
            sortBy,
            sortDirection,
            minLeadScore,
            maxLeadScore,
        ]
    );

    const {
        data: enquiriesResponse,
        isLoading,
        error,
    } = useSuspenseQuery(handleFetchEnquiries(enquiriesPayload));

    const handleOpenSidebar = (enquiryItemId: string) => {
        const item = enquiriesResponse?.content.find(
            (e) => (e.enquiry_id || e.audience_response_id) === enquiryItemId
        );
        if (item) {
            // Open the compact side-view sheet, NOT the fullscreen overlay.
            setSelectedStudent(mapEnquiryToStudent(item), { openOverlay: false });
        }
        setSelectedEnquiryId(enquiryItemId);
        setIsSidebarOpen(true);
    };

    const allFieldIdsFromAllEnquiries = useMemo(() => {
        const allFieldIds = new Set<string>();

        if (customFields && customFields.length > 0) {
            customFields.forEach((enquiryField: Record<string, unknown>) => {
                const cf = enquiryField.custom_field as Record<string, unknown> | undefined;
                const fieldId =
                    (cf?.id as string) ||
                    (enquiryField.id as string) ||
                    (enquiryField._id as string) ||
                    (enquiryField.field_id as string);
                if (fieldId) {
                    allFieldIds.add(fieldId);
                }
            });
        }

        if (enquiriesResponse && enquiriesResponse.content) {
            enquiriesResponse.content.forEach((enquiry) => {
                const customValues = enquiry.custom_fields || {};
                Object.keys(customValues).forEach((fieldId) => {
                    allFieldIds.add(fieldId);
                });
            });
        }

        return Array.from(allFieldIds);
    }, [customFields, enquiriesResponse]);

    const handleRowSelectionChange = (id: string, selected: boolean) => {
        setSelectedRows((prev) => {
            const newSet = new Set(prev);
            if (selected) {
                newSet.add(id);
            } else {
                newSet.delete(id);
            }
            return newSet;
        });
    };

    const handleSelectAll = (selected: boolean) => {
        if (selected && enquiriesResponse?.content) {
            const allIds = enquiriesResponse.content.map(
                (enquiry) => enquiry.enquiry_id || enquiry.audience_response_id || ''
            );
            setSelectedRows(new Set(allIds.filter(Boolean)));
        } else {
            setSelectedRows(new Set());
        }
    };

    const columns = useMemo(() => {
        const allCustomFieldsArray = allFieldIdsFromAllEnquiries.map((fieldId) => ({
            id: fieldId,
            _id: fieldId,
            field_id: fieldId,
        }));

        const fieldIdsToUse = allCustomFieldsArray.length > 0 ? allCustomFieldsArray : customFields;
        return generateDynamicColumns(
            t,
            fieldIdsToUse,
            customFieldMap,
            selectedRows,
            handleRowSelectionChange,
            handleSelectAll,
            handleOpenSidebar,
            (enquiryId) => {
                setSelectedActivityEnquiryId(enquiryId);
                setIsActivityLogOpen(true);
            },
            leadSettings.enabled && leadSettings.showScoreInEnquiryTable
        );
    }, [
        t,
        customFields,
        allFieldIdsFromAllEnquiries,
        customFieldMap,
        selectedRows,
        handleOpenSidebar,
        leadSettings.enabled,
        leadSettings.showScoreInEnquiryTable,
    ]);

    const tableKey = useMemo(() => {
        const fieldIdsKey =
            allFieldIdsFromAllEnquiries.length > 0
                ? allFieldIdsFromAllEnquiries.sort().join('-')
                : 'default';
        return `enquiry-table-${enquiryId}-${fieldIdsKey}`;
    }, [enquiryId, allFieldIdsFromAllEnquiries]);

    const tableData = useMemo(() => {
        if (
            !enquiriesResponse ||
            !enquiriesResponse.content ||
            enquiriesResponse.content.length === 0
        ) {
            return undefined;
        }

        return {
            content: enquiriesResponse.content.map((enquiry, index) => {
                const customValues = enquiry.custom_fields || {};

                // Get class name from package session
                const packageSessionDetails = enquiry.destination_package_session_id
                    ? getDetailsFromPackageSessionId({
                          packageSessionId: enquiry.destination_package_session_id,
                      })
                    : null;

                const className = packageSessionDetails
                    ? `${packageSessionDetails.level.level_name}`
                    : '-';

                const rowData: EnquiryTableRow = {
                    id: enquiry.enquiry_id || enquiry.audience_response_id || `${index}`,
                    index: page * pageSize + index,

                    // Student Details (from child_user)
                    studentName: enquiry.child_user?.full_name || '-',
                    studentGender: enquiry.child_user?.gender || null,
                    studentDob: enquiry.child_user?.date_of_birth || null,

                    // Parent Details (from parent_user)
                    parentName: enquiry.parent_user?.full_name || enquiry.parent_name || '-',
                    parentEmail: enquiry.parent_user?.email || enquiry.parent_email || '-',
                    parentMobile:
                        enquiry.parent_user?.mobile_number || enquiry.parent_mobile || '-',

                    // Enquiry Details
                    trackingId: enquiry.enquiry_tracking_id || null,
                    className,
                    enquiryStatus: enquiry.enquiry_status || '-',
                    sourceType: enquiry.source_type || '-',
                    assignedCounsellor: enquiry.assigned_counsellor_id || undefined,

                    // Phase 1 — Lead score + dedup
                    leadScore: enquiry.lead_score ?? null,
                    leadTier: enquiry.lead_tier ?? null,
                    isDuplicate: enquiry.is_duplicate ?? null,
                    primaryResponseId: enquiry.primary_response_id ?? null,
                };

                // Add custom field values
                allFieldIdsFromAllEnquiries.forEach((fieldId) => {
                    const value = customValues[fieldId];
                    rowData[fieldId] =
                        value !== undefined && value !== null && value !== '' ? value : null;
                });

                return rowData as EnquiryTableRow;
            }),
            total_pages: enquiriesResponse.totalPages,
            page_no: enquiriesResponse.number,
            page_size: enquiriesResponse.size,
            total_elements: enquiriesResponse.totalElements,
            last: enquiriesResponse.last,
        };
    }, [enquiriesResponse, allFieldIdsFromAllEnquiries, page, pageSize]);

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    const handleDownload = async () => {
        if (!tableData?.total_elements) return;

        try {
            setIsDownloading(true);
            toast.info(t('toast.downloadStarting'));

            const allDataPayload = {
                ...enquiriesPayload,
                search: searchFilter,
                page: 0,
                size: tableData.total_elements,
            };

            const response = await fetchEnquiries(allDataPayload);

            if (!response.content || response.content.length === 0) {
                toast.error(t('toast.noDataToDownload'));
                setIsDownloading(false);
                return;
            }

            const csvHeaders = [
                t('csv.headers.enquiryId'),
                t('csv.headers.class'),
                t('csv.headers.studentName'),
                t('csv.headers.gender'),
                t('csv.headers.dateOfBirth'),
                t('csv.headers.parentName'),
                t('csv.headers.parentEmail'),
                t('csv.headers.parentMobile'),
                t('csv.headers.trackingId'),
                t('csv.headers.status'),
                t('csv.headers.source'),
                t('csv.headers.counsellor'),
                t('csv.headers.submittedAt'),
            ];

            // Add custom field headers
            allFieldIdsFromAllEnquiries.forEach((fieldId) => {
                const fieldInfo = customFieldMap.get(fieldId);
                const headerName = fieldInfo?.field_name || fieldId;
                csvHeaders.push(headerName);
            });

            const csvRows = response.content.map((enquiry) => {
                const customValues = enquiry.custom_fields || {};
                const submittedAt = enquiry.submitted_at
                    ? convertToLocalDateTime(enquiry.submitted_at)
                    : '-';

                // Get class name
                const packageSessionDetails = enquiry.destination_package_session_id
                    ? instituteDetails?.batches_for_sessions.find(
                          (batch) => batch.id === enquiry.destination_package_session_id
                      )
                    : null;

                const className = packageSessionDetails
                    ? `${packageSessionDetails.level.level_name}`
                    : '-';

                // Format DOB as dd/MM/yyyy
                const formatDOB = (dob: string | null | undefined) => {
                    if (!dob) return '-';
                    try {
                        const date = new Date(dob);
                        if (!isNaN(date.getTime())) {
                            const day = String(date.getDate()).padStart(2, '0');
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const year = date.getFullYear();
                            return `${day}/${month}/${year}`;
                        }
                    } catch (e) {
                        return '-';
                    }
                    return '-';
                };

                const safeString = (val: unknown) => {
                    if (val === undefined || val === null) return '';
                    const str = String(val);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                };

                const row = [
                    safeString(enquiry.enquiry_id || '-'),
                    safeString(className),
                    safeString(enquiry.child_user?.full_name || '-'),
                    safeString(enquiry.child_user?.gender || '-'),
                    safeString(formatDOB(enquiry.child_user?.date_of_birth)),
                    safeString(enquiry.parent_user?.full_name || enquiry.parent_name || '-'),
                    safeString(enquiry.parent_user?.email || enquiry.parent_email || '-'),
                    safeString(enquiry.parent_user?.mobile_number || enquiry.parent_mobile || '-'),
                    safeString(enquiry.enquiry_tracking_id || '-'),
                    safeString(enquiry.enquiry_status || '-'),
                    safeString(enquiry.source_type || '-'),
                    safeString(
                        enquiry.assigned_counsellor_id
                            ? t('csv.assigned')
                            : t('csv.notAssigned')
                    ),
                    safeString(submittedAt),
                ];

                allFieldIdsFromAllEnquiries.forEach((fieldId) => {
                    const value = customValues[fieldId];
                    row.push(safeString(value));
                });
                return row.join(',');
            });

            const csvContent = [csvHeaders.join(','), ...csvRows].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute(
                'download',
                `${enquiryName || t('csv.filenameFallback')}_${new Date().toISOString().split('T')[0]}.csv`
            );
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            toast.success(t('toast.downloadSuccess'));
        } catch (error) {
            console.error('Download failed:', error);
            toast.error(t('toast.downloadError'));
        } finally {
            setIsDownloading(false);
        }
    };

    if (isLoading || isCustomFieldsLoading) {
        return (
            <div className="flex w-full flex-col items-center gap-4 py-12">
                <DashboardLoader />
                <p className="animate-pulse text-sm text-neutral-500">
                    {t('loading.enquiryResponses')}
                </p>
            </div>
        );
    }

    if (error || customFieldsError) {
        return (
            <div className="flex h-[70vh] w-full flex-col items-center justify-center gap-2"> {/* design-lint-ignore: viewport-relative full-page state height, no vh design token exists */}
                <p className="text-red-500">{t('error.loadingEnquiryResponses')}</p>
            </div>
        );
    }

    if (!tableData || tableData.content.length === 0) {
        return (
            <div className="flex h-[70vh] w-full flex-col items-center justify-center gap-2"> {/* design-lint-ignore: viewport-relative full-page state height, no vh design token exists */}
                <EmptyInvitePage />
                <p>{t('empty.noResponses')}</p>
                <MyButton
                    buttonType="secondary"
                    onClick={() => navigate({ to: `/admissions/new-enquiry/${enquiryId}` })}
                >
                    {t('empty.addNewEnquiryResponse')}
                </MyButton>
                <MyButton buttonType="secondary" onClick={() => setIsBulkImportOpen(true)}>
                    {t('header.bulkImport')}
                </MyButton>
                <EnquiryBulkImportDialog
                    open={isBulkImportOpen}
                    onOpenChange={setIsBulkImportOpen}
                    audienceId={enquiryId}
                    onSuccess={() => queryClient.invalidateQueries({ queryKey: ['enquiries'] })}
                />
            </div>
        );
    }

    return (
        <div className="flex w-full flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-h3 font-semibold">{enquiryName}</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                        {t('header.totalResponses')}{' '}
                        <span className="font-semibold">{tableData.total_elements}</span>
                    </p>
                    {selectedRows.size > 0 && (
                        <p className="mt-1 text-sm text-primary-600">
                            {t('header.rowsSelected', { count: selectedRows.size })}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setIsBulkImportOpen(true)}>
                        {t('header.bulkImport')}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownload}
                        disabled={isDownloading || !tableData?.total_elements}
                    >
                        <DownloadSimple className="me-2 size-4" />
                        {isDownloading ? t('header.downloading') : t('header.downloadCsv')}
                    </Button>
                </div>
            </div>

            <EnquiryBulkImportDialog
                open={isBulkImportOpen}
                onOpenChange={setIsBulkImportOpen}
                audienceId={enquiryId}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['enquiries'] })}
            />

            <div className="rounded-md shadow-sm">
                <MyTable<EnquiryTableRow>
                    key={tableKey}
                    data={tableData}
                    columns={columns}
                    isLoading={isLoading || isCustomFieldsLoading}
                    error={error || customFieldsError}
                    currentPage={page}
                    tableState={{ columnVisibility: {} }}
                    onCellClick={(row, colDef) => {
                        const colId = colDef.id || (colDef as { accessorKey?: string }).accessorKey;
                        if (colId !== 'select' && colId !== 'actions') {
                            handleOpenSidebar(row.id);
                        }
                    }}
                />
            </div>

            {tableData.total_pages > 1 && (
                <Pagination>
                    <PaginationContent>
                        <PaginationItem>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handlePageChange(Math.max(0, page - 1))}
                                disabled={page === 0}
                            >
                                <span className="sr-only">{t('pagination.previous')}</span>
                                <CaretLeft className="size-4" />
                            </Button>
                        </PaginationItem>
                        <PaginationItem className="hidden sm:block">
                            <span className="px-4 text-sm text-muted-foreground">
                                {t('pagination.pageOf', {
                                    page: page + 1,
                                    total: tableData.total_pages,
                                })}
                            </span>
                        </PaginationItem>
                        <PaginationItem>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() =>
                                    handlePageChange(Math.min(tableData.total_pages - 1, page + 1))
                                }
                                disabled={page >= tableData.total_pages - 1}
                            >
                                <span className="sr-only">{t('pagination.next')}</span>
                                <CaretRight className="size-4" />
                            </Button>
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            )}

            {/* Bulk Action Bar */}
            {selectedRows.size > 0 && (
                <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
                    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-5 py-3 shadow-2xl ring-1 ring-black/5">
                        {/* Count Badge */}
                        <div className="flex items-center gap-2">
                            <span className="flex size-7 items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white">
                                {selectedRows.size}
                            </span>
                            <span className="text-sm font-medium text-neutral-700">
                                {t('bulkActionBar.selectedLabel')}
                            </span>
                        </div>

                        <div className="h-5 w-px bg-neutral-200" />

                        {/* Enquiry Status Dropdown */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-neutral-500">
                                {t('bulkActionBar.enquiryStatusLabel')}
                            </span>
                            <Select
                                value={bulkEnquiryStatus}
                                onValueChange={(v) => setBulkEnquiryStatus(v as EnquiryStatus)}
                            >
                                <SelectTrigger className="h-8 w-36 rounded-lg border-neutral-200 text-xs">
                                    <SelectValue placeholder={t('bulkActionBar.selectPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {enquiryStatusOptions.map((opt) => (
                                        <SelectItem
                                            key={opt.value}
                                            value={opt.value}
                                            className="text-xs"
                                        >
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="h-5 w-px bg-neutral-200" />

                        {/* Conversion Status Dropdown */}
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-neutral-500">
                                {t('bulkActionBar.conversionLabel')}
                            </span>
                            <Select
                                value={bulkConversionStatus}
                                onValueChange={(v) =>
                                    setBulkConversionStatus(v as ConversionStatus)
                                }
                            >
                                <SelectTrigger className="h-8 w-28 rounded-lg border-neutral-200 text-xs">
                                    <SelectValue placeholder={t('bulkActionBar.selectPlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {conversionStatusOptions.map((opt) => (
                                        <SelectItem
                                            key={opt.value}
                                            value={opt.value}
                                            className="text-xs"
                                        >
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="h-5 w-px bg-neutral-200" />

                        {/* Apply / Clear */}
                        <Button
                            size="sm"
                            className="h-8 rounded-lg bg-primary-500 px-4 text-xs font-semibold text-white hover:bg-primary-600"
                            onClick={handleBulkApply}
                            disabled={bulkUpdateMutation.isPending}
                        >
                            {bulkUpdateMutation.isPending
                                ? t('bulkActionBar.applying')
                                : t('bulkActionBar.apply')}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 rounded-lg px-3 text-xs text-neutral-500 hover:text-neutral-700"
                            onClick={() => {
                                setSelectedRows(new Set());
                                setBulkEnquiryStatus('');
                                setBulkConversionStatus('');
                            }}
                        >
                            {t('bulkActionBar.clear')}
                        </Button>
                    </div>
                </div>
            )}

            {/* Activity Log Dialog */}
            {selectedActivityEnquiryId && (
                <ActivityLogDialog
                    isOpen={isActivityLogOpen}
                    onOpenChange={setIsActivityLogOpen}
                    enquiryId={selectedActivityEnquiryId}
                />
            )}
        </div>
    );
};

interface EnquiryTableWithSortProps extends EnquiryTableProps {
    onSortChange?: (sortBy: string, direction: string) => void;
}

export const EnquiryTable = (props: EnquiryTableWithSortProps) => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(null);

    return (
        <StudentSidebarProvider>
            <SidebarProvider
                style={{ ['--sidebar-width' as string]: '565px' }}
                defaultOpen={false}
                open={isSidebarOpen}
                onOpenChange={setIsSidebarOpen}
            >
                <EnquiryTableInner
                    {...props}
                    setIsSidebarOpen={setIsSidebarOpen}
                    setSelectedEnquiryId={setSelectedEnquiryId}
                />
                <StudentSidebar enquiryId={selectedEnquiryId ?? undefined} className="z-50" />
            </SidebarProvider>
        </StudentSidebarProvider>
    );
};
