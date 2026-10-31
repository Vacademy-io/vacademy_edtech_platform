import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Helmet } from 'react-helmet';
import { MyButton } from '@/components/design-system/button';
import { MagnifyingGlass, Plus, CaretRight, X, FileText, UserPlus } from '@phosphor-icons/react';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useNavigate } from '@tanstack/react-router';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ScheduleTestFilters } from '@/routes/evaluation/evaluations/-components/ScheduleTestFilters';
import { MyFilterOption } from '@/types/assessments/my-filter';
import {
    fetchApplicantList,
    type Applicant,
    type EnquiryDetailsResponse,
} from '../../-services/applicant-services';
import { EnquirySearchModal } from '../../-components/EnquirySearchModal';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { StudentSidebarProvider } from '@/routes/manage-students/students-list/-providers/student-sidebar-provider';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import type { StudentTable } from '@/types/student-table-types';
import { ApplicationBulkImportDialog } from './ApplicationBulkImportDialog';
import {
    CountChip,
    PillTabs,
    ScreenHeader,
    StatusPill,
    type PillTone,
} from '@/components/shared/crm-enhance/screen-header';

/** Pill colour per registration status (unknown statuses stay neutral). */
const statusTone = (status: string): PillTone =>
    status === 'SUBMITTED'
        ? 'info'
        : status === 'ADMITTED' || status === 'APPROVED' || status === 'ADMISSION_COMPLETED'
          ? 'success'
          : status === 'PENDING'
            ? 'warning'
            : status === 'REJECTED'
              ? 'danger'
              : 'neutral';

// Map an Applicant to a minimal StudentTable shape for the sidebar profile header
const mapApplicantToStudent = (applicant: Applicant): StudentTable =>
    ({
        id: applicant.applicant_id,
        user_id: applicant.applicant_id,
        username: null,
        email: applicant.parent_data?.email || '',
        full_name: applicant.student_data?.full_name || '',
        address_line: '',
        attendance_percent: 0,
        referral_count: 0,
        region: null,
        city: '',
        pin_code: '',
        mobile_number: applicant.parent_data?.mobile_number || '',
        date_of_birth: applicant.student_data?.date_of_birth || '',
        gender: applicant.student_data?.gender || '',
        fathers_name: applicant.parent_data?.full_name || '',
        mothers_name: '',
        father_mobile_number: applicant.parent_data?.mobile_number || '',
        father_email: applicant.parent_data?.email || '',
        mother_mobile_number: '',
        mother_email: '',
        linked_institute_name: null,
        created_at: applicant.created_at || '',
        updated_at: applicant.updated_at || '',
        package_session_id: applicant.package_session?.package_session_id || '',
        institute_enrollment_id: '',
        status: 'ACTIVE',
        session_expiry_days: 0,
        institute_id: '',
        expiry_date: 0,
        face_file_id: null,
        parents_email: applicant.parent_data?.email || '',
        parents_mobile_number: applicant.parent_data?.mobile_number || '',
        parents_to_mother_email: '',
        parents_to_mother_mobile_number: '',
        destination_package_session_id: '',
        enroll_invite_id: '',
        payment_status: '',
        custom_fields: {},
    }) as StudentTable;

function RegistrationListPageInner({
    setIsSidebarOpen,
    setSelectedApplicantId,
}: {
    setIsSidebarOpen: (open: boolean) => void;
    setSelectedApplicantId: (id: string | null) => void;
}) {
    const { t } = useTranslation('admissionsRegistrationListPage');
    const { setSelectedStudent } = useStudentSidebar();
    const { setNavHeading } = useNavHeadingStore();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const { getAllSessions, instituteDetails } = useInstituteDetailsStore();
    const sessions = getAllSessions();
    const [selectedSessionId, setSelectedSessionId] = useState<string>(sessions[0]?.id ?? '');
    const instituteId = instituteDetails?.id || '';

    const [selectedPackageSessions, setSelectedPackageSessions] = useState<MyFilterOption[]>([]);
    const [selectedStatuses, setSelectedStatuses] = useState<MyFilterOption[]>([]);
    const [pageNo, setPageNo] = useState(0);
    const pageSize = 10;

    // Modal states
    const [showRegistrationTypeModal, setShowRegistrationTypeModal] = useState(false);
    const [showEnquiryModal, setShowEnquiryModal] = useState(false);

    const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);

    // Debounce search query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, 500);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Prepare package session options for filter
    const packageSessionOptions: MyFilterOption[] =
        instituteDetails?.batches_for_sessions?.map((batch) => ({
            id: batch.id,
            name: `${batch.package_dto.package_name} - ${batch.level.level_name}`,
        })) || [];

    // Status options for filter
    const statusOptions: MyFilterOption[] = [
        { id: 'PENDING', name: t('status.pending') },
        { id: 'ADMISSION_COMPLETED', name: t('status.admissionCompleted') },
        { id: 'REJECTED', name: t('status.rejected') },
        { id: 'ADMITTED', name: t('status.admitted') },
    ];

    // Map a raw backend registration-status enum to its translated display
    // label. Falls back to the raw value for any status the catalog doesn't
    // yet cover, so an unmapped enum never crashes the render.
    const STATUS_LABEL_KEYS: Record<string, string> = {
        SUBMITTED: 'status.submitted',
        ADMITTED: 'status.admitted',
        APPROVED: 'status.approved',
        PENDING: 'status.pending',
        REJECTED: 'status.rejected',
        ADMISSION_COMPLETED: 'status.admissionCompleted',
    };
    const getStatusLabel = (status: string): string => {
        const key = STATUS_LABEL_KEYS[status];
        return key ? t(key) : status;
    };

    // Fetch applicants with filters
    const {
        data: applicantsData,
        isLoading,
        isError,
    } = useQuery({
        queryKey: [
            'applicants',
            instituteId,
            selectedPackageSessions.map((s) => s.id),
            selectedStatuses.map((s) => s.id),
            selectedStatuses.length,
            selectedPackageSessions.length,
            debouncedSearchQuery,
            pageNo,
            pageSize,
        ],
        queryFn: () =>
            fetchApplicantList(
                {
                    institute_id: instituteId,
                    package_session_ids:
                        selectedPackageSessions.length > 0
                            ? selectedPackageSessions.map((s) => s.id)
                            : undefined,
                    overall_statuses:
                        selectedStatuses.length > 0 ? selectedStatuses.map((s) => s.id) : undefined,
                    search: debouncedSearchQuery || '',
                },
                pageNo,
                pageSize
            ),
        enabled: !!instituteId,
    });

    const applicants = applicantsData?.content || [];
    const totalElements = applicantsData?.totalElements || 0;
    const totalPages = applicantsData?.totalPages || 0;

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{t('navHeading')}</span>
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600">
                    {totalElements}
                </span>
            </div>
        );
    }, [setNavHeading, totalElements, t]);

    // Highlighted quick view: "All" with no status picked, the status when exactly one is.
    const quickStatus =
        selectedStatuses.length === 0
            ? 'ALL'
            : selectedStatuses.length === 1
              ? selectedStatuses[0]?.id ?? ''
              : '';

    const handleNewRegistration = () => {
        setShowRegistrationTypeModal(true);
    };

    const handleNewApplication = () => {
        setShowRegistrationTypeModal(false);
        if (selectedSessionId) {
            navigate({ to: `/admissions/application/new?sessionId=${selectedSessionId}` });
        } else {
            navigate({ to: '/admissions/application/new' });
        }
    };

    const handleFromEnquiry = () => {
        setShowRegistrationTypeModal(false);
        setShowEnquiryModal(true);
    };

    const handleSelectEnquiry = (enquiryData: EnquiryDetailsResponse) => {
        // Guard: should not reach here (button is disabled in modal), but double-check
        if (enquiryData.overall_status === 'APPLICATION' || enquiryData.overall_status === 'ADMISSION') {
            toast.warning(t('toast.enquiryAlreadyConverted'));
            return;
        }

        // Navigate to registration form with enquiry data from the search result (no extra API call)
        const encodedData = encodeURIComponent(JSON.stringify(enquiryData));
        if (selectedSessionId) {
            navigate({ to: `/admissions/application/new?sessionId=${selectedSessionId}&enquiryData=${encodedData}` });
        } else {
            navigate({ to: `/admissions/application/new?enquiryData=${encodedData}` });
        }
    };

    const handleViewDetails = (applicant: Applicant) => {
        // Open the compact side-view sheet, NOT the fullscreen overlay.
        setSelectedStudent(mapApplicantToStudent(applicant), { openOverlay: false });
        setSelectedApplicantId(applicant.applicant_id);
        setIsSidebarOpen(true);
    };

    return (
        <div className="flex h-full w-full min-w-0 flex-1 flex-col">
            <Helmet>
                <title>{t('pageTitle')}</title>
            </Helmet>

            <ScreenHeader
                className="mb-4"
                icon={FileText}
                title={t('header.title')}
                badge={<CountChip>{totalElements.toLocaleString('en-IN')}</CountChip>}
                subtitle={t('header.subtitle')}
                actions={
                    <>
                        <MyButton
                            buttonType="secondary"
                            onClick={() => setIsBulkImportOpen(true)}
                            disabled={!selectedSessionId}
                        >
                            {t('buttons.bulkImport')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            onClick={handleNewRegistration}
                            disabled={!selectedSessionId}
                        >
                            <Plus className="mr-2 size-4" />
                            {t('buttons.newApplication')}
                        </MyButton>
                    </>
                }
            />

            {/* Quick status views — the same Status filter as the dropdown below */}
            <PillTabs
                className="mb-4"
                tabs={[
                    { key: 'ALL', label: t('quickViews.all') },
                    ...statusOptions.map((o) => ({ key: o.id, label: o.name })),
                ]}
                value={quickStatus}
                onChange={(key) => {
                    const option = statusOptions.find((o) => o.id === key);
                    setSelectedStatuses(option ? [option] : []);
                    setPageNo(0);
                }}
            />

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                        <input
                            type="text"
                            placeholder={t('search.placeholder')}
                            className="h-9 w-64 rounded-md border border-neutral-300 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <ScheduleTestFilters
                        label={t('filters.classLabel')}
                        data={packageSessionOptions}
                        selectedItems={selectedPackageSessions}
                        onSelectionChange={setSelectedPackageSessions}
                    />

                    <ScheduleTestFilters
                        label={t('filters.statusLabel')}
                        data={statusOptions}
                        selectedItems={selectedStatuses}
                        onSelectionChange={setSelectedStatuses}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-neutral-500">{t('session.newGoTo')}</span>
                    <Select
                        value={selectedSessionId}
                        onValueChange={setSelectedSessionId}
                        defaultValue={sessions[0]?.id}
                    >
                        <SelectTrigger className="h-9 w-40">
                            <SelectValue placeholder={t('session.placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {sessions.map((session) => (
                                <SelectItem key={session.id} value={session.id}>
                                    {session.session_name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
                {isLoading ? (
                    <div className="flex items-center justify-center p-12">
                        <div className="text-neutral-500">{t('table.loading')}</div>
                    </div>
                ) : isError ? (
                    <div className="flex items-center justify-center p-12">
                        <p className="text-danger-600">{t('table.error')}</p>
                    </div>
                ) : applicants.length === 0 ? (
                    <div className="flex items-center justify-center p-12">
                        <div className="text-center">
                            <p className="text-neutral-500">{t('table.empty.title')}</p>
                            <p className="text-sm text-neutral-400">{t('table.empty.subtitle')}</p>
                            <div className="mt-4 flex justify-center">
                                <MyButton
                                    buttonType="secondary"
                                    onClick={() => setIsBulkImportOpen(true)}
                                    disabled={!selectedSessionId}
                                >
                                    {t('buttons.bulkImport')}
                                </MyButton>
                            </div>
                        </div>
                    </div>
                ) : (
                    <table className="w-full text-left text-sm text-neutral-600">
                        <thead className="bg-neutral-50 text-xs font-semibold uppercase text-neutral-500">
                            <tr>
                                <th className="px-6 py-3">{t('table.headers.trackingId')}</th>
                                <th className="px-6 py-3">{t('table.headers.studentName')}</th>
                                <th className="px-6 py-3">{t('table.headers.class')}</th>
                                <th className="px-6 py-3">{t('table.headers.parentName')}</th>
                                <th className="px-6 py-3">{t('table.headers.mobile')}</th>
                                <th className="px-6 py-3">{t('table.headers.date')}</th>
                                <th className="px-6 py-3">{t('table.headers.status')}</th>
                                <th className="px-6 py-3 text-end">{t('table.headers.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                            {applicants.map((applicant) => (
                                <tr
                                    key={applicant.applicant_id}
                                    className="cursor-pointer hover:bg-neutral-50"
                                    onClick={() => handleViewDetails(applicant)}
                                >
                                    <td className="whitespace-nowrap px-6 py-4 font-medium text-primary-600">
                                        {applicant.tracking_id}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-neutral-900">
                                        {applicant.student_data?.full_name}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        {applicant.student_data?.applying_for_class || applicant.package_session?.level_name || '-'}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        {applicant.parent_data?.full_name}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        {applicant.parent_data?.mobile_number}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        {new Date(applicant.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <StatusPill tone={statusTone(applicant.overall_status)}>
                                            {getStatusLabel(applicant.overall_status)}
                                        </StatusPill>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-right">
                                        <button className="text-neutral-400 hover:text-primary-600">
                                            <CaretRight className="size-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
                <span>
                    {t('pagination.showing', {
                        from: pageNo * pageSize + 1,
                        to: Math.min((pageNo + 1) * pageSize, totalElements),
                        count: totalElements,
                    })}
                </span>
                <div className="flex gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disabled={pageNo === 0}
                        onClick={() => setPageNo((p) => Math.max(0, p - 1))}
                    >
                        {t('buttons.previous')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disabled={pageNo >= totalPages - 1}
                        onClick={() => setPageNo((p) => Math.min(totalPages - 1, p + 1))}
                    >
                        {t('buttons.next')}
                    </MyButton>
                </div>
            </div>

            {/* Registration Type Selection Modal */}
            {showRegistrationTypeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-neutral-900">
                                {t('modal.title')}
                            </h2>
                            <button
                                onClick={() => setShowRegistrationTypeModal(false)}
                                className="text-neutral-400 hover:text-neutral-600"
                            >
                                <X className="size-5" />
                            </button>
                        </div>

                        <p className="mb-6 text-sm text-neutral-600">
                            {t('modal.subtitle')}
                        </p>

                        <div className="space-y-3">
                            <button
                                onClick={handleNewApplication}
                                className="flex w-full items-center gap-4 rounded-lg border border-neutral-200 p-4 text-left transition-all hover:border-primary-500 hover:bg-primary-50"
                            >
                                <div className="flex size-12 items-center justify-center rounded-full bg-primary-100">
                                    <UserPlus className="size-6 text-primary-600" />
                                </div>
                                <div>
                                    <h3 className="font-medium text-neutral-900">
                                        {t('modal.newApplication.title')}
                                    </h3>
                                    <p className="text-sm text-neutral-600">
                                        {t('modal.newApplication.description')}
                                    </p>
                                </div>
                            </button>

                            <button
                                onClick={handleFromEnquiry}
                                className="flex w-full items-center gap-4 rounded-lg border border-neutral-200 p-4 text-left transition-all hover:border-primary-500 hover:bg-primary-50"
                            >
                                <div className="flex size-12 items-center justify-center rounded-full bg-info-50">
                                    <FileText className="size-6 text-info-600" />
                                </div>
                                <div>
                                    <h3 className="font-medium text-neutral-900">{t('modal.fromEnquiry.title')}</h3>
                                    <p className="text-sm text-neutral-600">
                                        {t('modal.fromEnquiry.description')}
                                    </p>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <EnquirySearchModal
                isOpen={showEnquiryModal}
                onClose={() => setShowEnquiryModal(false)}
                onSelectForApplication={handleSelectEnquiry}
            />

            <ApplicationBulkImportDialog
                open={isBulkImportOpen}
                onOpenChange={setIsBulkImportOpen}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['applicants'] })}
            />

            {/* Applicant details now shown in the StudentSidebar on the right */}
        </div>
    );
}

export function RegistrationListPage() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(null);

    return (
        <StudentSidebarProvider>
            <SidebarProvider
                style={{ ['--sidebar-width' as string]: '565px' }}
                defaultOpen={false}
                open={isSidebarOpen}
                onOpenChange={setIsSidebarOpen}
            >
                <RegistrationListPageInner
                    setIsSidebarOpen={setIsSidebarOpen}
                    setSelectedApplicantId={setSelectedApplicantId}
                />
                <StudentSidebar applicantId={selectedApplicantId ?? undefined} className="z-50" />
            </SidebarProvider>
        </StudentSidebarProvider>
    );
}
