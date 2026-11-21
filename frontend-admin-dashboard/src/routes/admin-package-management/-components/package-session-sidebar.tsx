import { Sidebar, SidebarContent, SidebarHeader, useSidebar } from '@/components/ui/sidebar';
import {
    X,
    Package,
    Calendar,
    Clock,
    ListBullets,
    Image,
    FileText,
    Info,
    CaretLeft,
    Ticket,
    Money,
    CreditCard,
    Tag,
    Pencil,
    DotsThreeVertical,
    Trash,
    Users,
    Check,
} from '@phosphor-icons/react';
import {
    PackageSessionDTO,
    PackageDTO,
    EnrollInvite,
    PaymentOption,
    InstructorDTO,
    FacultyAssignmentResponse,
    UpdateCourseRequest,
} from '../-types/package-types';
import { StatusChips } from '@/components/design-system/chips';
import { useQuery } from '@tanstack/react-query';
import {
    fetchPaginatedBatches,
    fetchEnrollInvites,
    fetchEnrollInviteDetail,
    deleteBatches,
    deleteEnrollInvites,
    fetchInstructors,
    assignFaculty,
    fetchFacultyAssignments,
    updatePackageDetails,
} from '../-services/package-service';
import { CourseContentDialog } from '../bulk-create/-components/course-content-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { EditPackageDialog } from './dialogs/edit-package-dialog';
import { EditSessionDialog } from './dialogs/edit-session-dialog';
import { EditInviteDialog } from './dialogs/edit-invite-dialog';
import { EditPaymentOptionDialog } from './dialogs/edit-payment-option-dialog';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useState, useEffect, Suspense } from 'react';
import { MyPagination } from '@/components/design-system/pagination';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Copy, NotePencil } from '@phosphor-icons/react';
import GenerateInviteLinkDialog from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkDialog';
import { handleGetEnrollSingleInviteDetails } from '@/routes/manage-students/invite/-components/create-invite/-services/enroll-invite';
import { handleGetPaymentDetails } from '@/routes/manage-students/invite/-components/create-invite/-services/get-payments';
import { extractBatchesFromInviteDetails } from '@/routes/manage-students/invite/-utils/enrollInviteTransformers';
import { LoadingSpinner } from '@/components/ai-course-builder/LoadingSpinner';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { formatPlanPrice } from '@/utils/finance-utils';

interface PackageSessionSidebarProps {
    selectedPackage: {
        id: string;
        name: string;
    } | null;
}

type TabType = 'sessions' | 'content' | 'media' | 'faculty';

export const PackageSessionSidebar = ({ selectedPackage }: PackageSessionSidebarProps) => {
    const { state, toggleSidebar } = useSidebar();
    const [page, setPage] = useState(0);
    const [activeTab, setActiveTab] = useState<TabType>('sessions');

    const { data: sessionsData, isLoading } = useQuery({
        queryKey: ['package-sessions', selectedPackage?.id, page],
        queryFn: () =>
            fetchPaginatedBatches({
                page,
                size: 20,
                packageId: selectedPackage?.id,
                statuses: ['ACTIVE', 'HIDDEN'],
            }),
        enabled: !!selectedPackage?.id && state === 'expanded',
        staleTime: 60000,
    });

    const packageDto = sessionsData?.content?.[0]?.package_dto;

    const tabs = [
        { id: 'sessions' as TabType, label: 'Sessions', icon: ListBullets },
        { id: 'content' as TabType, label: 'Content', icon: FileText },
        { id: 'media' as TabType, label: 'Media', icon: Image },
        { id: 'faculty' as TabType, label: 'Faculty', icon: Users },
    ];

    const queryClient = useQueryClient();

    const { mutate: updatePackage } = useMutation({
        mutationFn: async (data: Partial<PackageDTO>) => {
            if (!selectedPackage?.id || !packageDto) return;

            const updateData: UpdateCourseRequest = {
                package_name: packageDto.package_name,
                is_course_published_to_catalaouge: packageDto.is_course_published_to_catalaouge,
                tags: packageDto.tags,
                course_depth: packageDto.course_depth,
                thumbnail_file_id: packageDto.thumbnail_file_id,
                course_preview_image_media_id: packageDto.course_preview_image_media_id,
                course_banner_media_id: packageDto.course_banner_media_id,
                course_media_id: packageDto.course_media_id,
                why_learn_html: packageDto.why_learn_html,
                who_should_learn_html: packageDto.who_should_learn_html,
                about_the_course_html: packageDto.about_the_course_html,
                course_html_description_html: packageDto.course_html_description_html,
                drip_condition_json: packageDto.drip_condition_json,
                ...data,
            };

            await updatePackageDetails(selectedPackage.id, updateData);
        },
        onSuccess: () => {
            toast.success('Package updated successfully');
            queryClient.invalidateQueries({ queryKey: ['package-sessions'] });
        },
        onError: () => {
            toast.error('Failed to update package');
        },
    });

    return (
        <Sidebar side="right" className="z-[60]">
            <SidebarContent className="flex h-full flex-col border-l border-neutral-200 bg-white text-neutral-700">
                {/* Header */}
                <SidebarHeader className="shrink-0 border-b border-neutral-100 bg-white px-3 py-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Package className="size-4 text-primary-500" />
                            <span className="text-sm font-semibold text-neutral-800">
                                {selectedPackage?.name || 'Package Details'}
                            </span>
                            {packageDto && (
                                <EditPackageDialog
                                    packageDto={packageDto}
                                    trigger={
                                        <button className="ml-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
                                            <Pencil className="size-3" />
                                        </button>
                                    }
                                />
                            )}
                        </div>
                        <button
                            onClick={toggleSidebar}
                            className="rounded p-1 hover:bg-neutral-100"
                        >
                            <X className="size-4 text-neutral-500" />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="mt-2 flex gap-1 rounded-lg bg-neutral-100 p-0.5">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
                                    activeTab === tab.id
                                        ? 'bg-white text-neutral-800 shadow-sm'
                                        : 'text-neutral-500 hover:text-neutral-700'
                                )}
                            >
                                <tab.icon className="size-3.5" />
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </SidebarHeader>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-6">
                            <DashboardLoader />
                        </div>
                    ) : (
                        <>
                            {activeTab === 'sessions' && (
                                <SessionsTab
                                    sessions={sessionsData?.content || []}
                                    page={page}
                                    totalPages={sessionsData?.total_pages || 1}
                                    totalElements={sessionsData?.total_elements || 0}
                                    onPageChange={setPage}
                                />
                            )}
                            {activeTab === 'content' && (
                                <ContentTab
                                    packageDto={packageDto}
                                    onUpdate={(data) => updatePackage(data)}
                                />
                            )}
                            {activeTab === 'media' && (
                                <MediaTab
                                    packageDto={packageDto}
                                    onUpdate={(data) => updatePackage(data)}
                                />
                            )}
                            {activeTab === 'faculty' && (
                                <FacultyTab
                                    packageId={selectedPackage?.id || ''}
                                    sessions={sessionsData?.content || []}
                                />
                            )}
                        </>
                    )}
                </div>
            </SidebarContent>
        </Sidebar>
    );
};

// Sessions Tab
type SessionViewType = 'list' | 'invites' | 'invite-detail';

const SessionsTab = ({
    sessions,
    page,
    totalPages,
    totalElements,
    onPageChange,
}: {
    sessions: PackageSessionDTO[];
    page: number;
    totalPages: number;
    totalElements: number;
    onPageChange: (page: number) => void;
}) => {
    const [view, setView] = useState<SessionViewType>('list');
    const [selectedSession, setSelectedSession] = useState<PackageSessionDTO | null>(null);
    const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);
    const [editingSession, setEditingSession] = useState<PackageSessionDTO | null>(null);
    const queryClient = useQueryClient();

    const handleSessionClick = (session: PackageSessionDTO) => {
        setSelectedSession(session);
        setView('invites');
    };

    const handleInviteClick = (inviteId: string) => {
        setSelectedInviteId(inviteId);
        setView('invite-detail');
    };

    const handleBackToSessions = () => {
        setView('list');
        setSelectedSession(null);
    };

    const handleBackToInvites = () => {
        setView('invites');
        setSelectedInviteId(null);
    };

    const handleDeleteSession = async (sessionId: string) => {
        if (confirm('Are you sure you want to delete this session?')) {
            await deleteBatches([sessionId]);
            queryClient.invalidateQueries({ queryKey: ['package-sessions'] });
        }
    };

    if (view === 'invites' && selectedSession) {
        return (
            <EnrollInvitesList
                session={selectedSession}
                onBack={handleBackToSessions}
                onInviteClick={handleInviteClick}
            />
        );
    }

    if (view === 'invite-detail' && selectedInviteId) {
        return <InviteDetailView inviteId={selectedInviteId} onBack={handleBackToInvites} />;
    }

    if (sessions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-8 text-center">
                <Package className="mb-2 size-8 text-neutral-300" />
                <p className="text-xs text-neutral-500">No sessions found</p>
            </div>
        );
    }

    return (
        <div className="p-2">
            <div className="mb-2 text-xs text-neutral-500">{totalElements} session(s)</div>
            <div className="space-y-1.5">
                {sessions.map((session) => (
                    <CompactSessionCard
                        key={session.id}
                        session={session}
                        onClick={() => handleSessionClick(session)}
                        onEdit={() => setEditingSession(session)}
                        onDelete={() => handleDeleteSession(session.id)}
                    />
                ))}
            </div>
            {totalPages > 1 && (
                <div className="mt-3 border-t border-neutral-100 pt-2">
                    <MyPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={onPageChange}
                    />
                </div>
            )}

            {editingSession && (
                <EditSessionDialog
                    session={editingSession}
                    open={!!editingSession}
                    onOpenChange={(open) => !open && setEditingSession(null)}
                />
            )}
        </div>
    );
};

const CompactSessionCard = ({
    session,
    onClick,
    onEdit,
    onDelete,
}: {
    session: PackageSessionDTO;
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) => (
    <div
        onClick={onClick}
        className="group flex cursor-pointer items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-xs transition-all hover:border-primary-200 hover:bg-primary-50/30"
    >
        <div className="flex items-center gap-2">
            <StatusChips
                status={
                    (session.status === 'HIDDEN' ? 'INACTIVE' : session.status) as
                        | 'ACTIVE'
                        | 'INACTIVE'
                        | 'TERMINATED'
                }
            />
            <div className="flex flex-col">
                <span className="font-medium text-neutral-700 group-hover:text-primary-700">
                    {session.level.level_name}
                </span>
                <span className="text-neutral-500">{session.session.session_name}</span>
            </div>
        </div>
        <div className="flex items-center gap-2 text-neutral-400">
            {session.group && (
                <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-600">
                    {session.group.group_name}
                </span>
            )}
            {session.read_time_in_minutes > 0 && (
                <span className="flex items-center gap-0.5">
                    <Clock className="size-3" />
                    {Math.round(session.read_time_in_minutes)}m
                </span>
            )}
            <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="rounded p-1 hover:bg-white hover:text-neutral-600">
                            <DotsThreeVertical className="size-3" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[100] w-32">
                        <DropdownMenuItem onClick={onEdit}>
                            <Pencil className="mr-2 size-3" />
                            Update Capacity
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onDelete} className="text-red-600">
                            <Trash className="mr-2 size-3" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    </div>
);

// Full Edit Invite Dialog (reuses GenerateInviteLinkDialog from manage-students)
const FullEditInviteDialogContent = ({
    inviteId,
    onClose,
}: {
    inviteId: string;
    onClose: () => void;
}) => {
    const [open, setOpen] = useState(true);
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();

    const { data: inviteLinkDetails } = useSuspenseQuery(
        handleGetEnrollSingleInviteDetails({ inviteId })
    );
    useSuspenseQuery(handleGetPaymentDetails());

    const selectedBatches = extractBatchesFromInviteDetails(
        inviteLinkDetails,
        getDetailsFromPackageSessionId
    );

    const parentBatch = selectedBatches[0];
    const selectedCourse = parentBatch
        ? { id: parentBatch.package_dto.package_name, name: parentBatch.package_dto.package_name }
        : null;

    return (
        <GenerateInviteLinkDialog
            showSummaryDialog={open}
            setShowSummaryDialog={(v) => {
                setOpen(v);
                if (!v) onClose();
            }}
            selectedCourse={selectedCourse}
            selectedBatches={selectedBatches
                .filter((batch) => batch !== null)
                .map((batch) => ({
                    sessionId: batch.session.id,
                    levelId: batch.level.id,
                    sessionName: batch.session.session_name,
                    levelName: batch.level.level_name,
                    courseId: batch.package_dto.id,
                    courseName: batch.package_dto.package_name,
                    isParent: false,
                }))}
            inviteLinkId={inviteId}
            singlePackageSessionId={true}
            isEditInviteLink={true}
            setDialogOpen={(v) => {
                if (!v) onClose();
            }}
        />
    );
};

// Enroll Invites List Component
const EnrollInvitesList = ({
    session,
    onBack,
    onInviteClick,
}: {
    session: PackageSessionDTO;
    onBack: () => void;
    onInviteClick: (inviteId: string) => void;
}) => {
    const [editingInvite, setEditingInvite] = useState<EnrollInvite | null>(null);
    const [fullEditInviteId, setFullEditInviteId] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { instituteDetails } = useInstituteDetailsStore();

    const { data, isLoading } = useQuery({
        queryKey: ['enroll-invites', session.id],
        queryFn: () => fetchEnrollInvites(session.id),
    });

    const getInviteUrl = (inviteCode: string) =>
        createInviteLink(inviteCode, instituteDetails?.learner_portal_base_url);

    const copyInviteUrl = (inviteCode: string) => {
        navigator.clipboard.writeText(getInviteUrl(inviteCode));
        toast.success('Invite link copied to clipboard');
    };

    const handleDeleteInvite = async (inviteId: string) => {
        if (confirm('Are you sure you want to delete this invite?')) {
            await deleteEnrollInvites([inviteId]);
            queryClient.invalidateQueries({ queryKey: ['enroll-invites', session.id] });
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-100 bg-white p-2">
                <button
                    onClick={onBack}
                    className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
                >
                    <CaretLeft className="size-4" />
                </button>
                <div className="flex flex-col">
                    <span className="text-xs font-semibold text-neutral-800">{`Enroll ${getTerminologyPlural(OtherTerms.Invite, SystemTerms.Invite)}`}</span>
                    <span className="max-w-[200px] truncate text-[10px] text-neutral-500">
                        {session.level.level_name} • {session.session.session_name}
                    </span>
                </div>
            </div>

            <div className="flex-1 p-2">
                {isLoading ? (
                    <div className="flex justify-center py-4">
                        <DashboardLoader />
                    </div>
                ) : !data?.content || data.content.length === 0 ? (
                    <EmptyState message="No enroll invites found" />
                ) : (
                    <div className="space-y-2">
                        {data.content.map((invite) => (
                            <div
                                key={invite.id}
                                onClick={() => onInviteClick(invite.id)}
                                className="group cursor-pointer rounded-lg border border-neutral-100 bg-neutral-50 p-2 transition-all hover:border-primary-200 hover:bg-primary-50/30"
                            >
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-medium text-neutral-700">
                                        {invite.name}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <StatusChips
                                            status={
                                                invite.status as
                                                    | 'ACTIVE'
                                                    | 'INACTIVE'
                                                    | 'ARCHIVED'
                                                    | 'TERMINATED'
                                                    | 'COMPLETED'
                                                    | 'UNPUBLISHED'
                                                    | 'PUBLISHED'
                                                    | 'DRAFT'
                                                    | 'DELETED'
                                            }
                                        />
                                        <div onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button className="rounded p-1 text-neutral-400 hover:bg-white hover:text-neutral-600">
                                                        <DotsThreeVertical className="size-3" />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent
                                                    align="end"
                                                    className="z-[100] w-32"
                                                >
                                                    <DropdownMenuItem
                                                        onClick={() => setEditingInvite(invite)}
                                                    >
                                                        <Pencil className="mr-2 size-3" />
                                                        Quick Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            setFullEditInviteId(invite.id)
                                                        }
                                                    >
                                                        <NotePencil className="mr-2 size-3" />
                                                        Edit Details
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            handleDeleteInvite(invite.id)
                                                        }
                                                        className="text-red-600"
                                                    >
                                                        <Trash className="mr-2 size-3" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                </div>
                                <div className="mb-1 flex items-center gap-1 text-[10px] text-neutral-500">
                                    <Ticket className="size-3 shrink-0" />
                                    <span
                                        className="truncate rounded bg-neutral-100 px-1 font-mono"
                                        title={getInviteUrl(invite.invite_code)}
                                    >
                                        {getInviteUrl(invite.invite_code)}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            copyInviteUrl(invite.invite_code);
                                        }}
                                        className="shrink-0 rounded p-0.5 hover:bg-neutral-200"
                                        title="Copy invite link"
                                    >
                                        <Copy className="size-3" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[10px] text-neutral-500">
                                    <div className="flex items-center gap-1">
                                        <Calendar className="size-3" />
                                        <span>{invite.start_date}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Tag className="size-3" />
                                        <span>{invite.tag}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Money className="size-3" />
                                        <span>{invite.currency}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {editingInvite && (
                <EditInviteDialog
                    invite={editingInvite}
                    open={!!editingInvite}
                    onOpenChange={(open) => !open && setEditingInvite(null)}
                />
            )}

            {fullEditInviteId && (
                <Suspense
                    fallback={
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                            <LoadingSpinner />
                        </div>
                    }
                >
                    <FullEditInviteDialogContent
                        inviteId={fullEditInviteId}
                        onClose={() => {
                            setFullEditInviteId(null);
                            queryClient.invalidateQueries({
                                queryKey: ['enroll-invites', session.id],
                            });
                        }}
                    />
                </Suspense>
            )}
        </div>
    );
};

// Invite Detail View Component
const InviteDetailView = ({ inviteId, onBack }: { inviteId: string; onBack: () => void }) => {
    const [editingPaymentOption, setEditingPaymentOption] = useState<PaymentOption | null>(null);
    const { instituteDetails } = useInstituteDetailsStore();
    const { data: invite, isLoading } = useQuery({
        queryKey: ['enroll-invite-detail', inviteId],
        queryFn: () => fetchEnrollInviteDetail(inviteId),
    });

    // We also need to be able to delete payment options (unlink them) or delete the payment option itself.
    // The prompt requested edits for payment option OR plan.
    // I added EditPaymentOptionDialog which edits the PaymentOption definition.
    // Linking/Unlinking is separate API `updateInvitePaymentOptions`.
    // For now I'll just add "Edit Option" which edits the PaymentOption.

    if (isLoading) {
        return (
            <div className="flex h-full flex-col">
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-100 bg-white p-2">
                    <button
                        onClick={onBack}
                        className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
                    >
                        <CaretLeft className="size-4" />
                    </button>
                    <span className="text-xs font-semibold text-neutral-800">Invite Details</span>
                </div>
                <div className="flex justify-center py-8">
                    <DashboardLoader />
                </div>
            </div>
        );
    }

    if (!invite) return <EmptyState message="Invite details not found" />;

    return (
        <div className="flex h-full flex-col">
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-100 bg-white p-2">
                <button
                    onClick={onBack}
                    className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
                >
                    <CaretLeft className="size-4" />
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-semibold text-neutral-800">Invite Details</span>
                    <div className="flex items-center gap-1">
                        <span
                            className="truncate font-mono text-[10px] text-neutral-500"
                            title={createInviteLink(invite.invite_code, instituteDetails?.learner_portal_base_url)}
                        >
                            {createInviteLink(invite.invite_code, instituteDetails?.learner_portal_base_url)}
                        </span>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(
                                    createInviteLink(invite.invite_code, instituteDetails?.learner_portal_base_url)
                                );
                                toast.success('Invite link copied to clipboard');
                            }}
                            className="shrink-0 rounded p-0.5 hover:bg-neutral-200"
                            title="Copy invite link"
                        >
                            <Copy className="size-3" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-2">
                <div className="rounded-lg border border-neutral-100 bg-white p-3 shadow-sm">
                    <h4 className="mb-2 text-xs font-semibold text-neutral-800">{invite.name}</h4>
                    <div className="space-y-2">
                        <DetailRow
                            label="Status"
                            value={
                                <StatusChips
                                    status={
                                        invite.status as
                                            | 'ACTIVE'
                                            | 'INACTIVE'
                                            | 'ARCHIVED'
                                            | 'TERMINATED'
                                            | 'COMPLETED'
                                            | 'UNPUBLISHED'
                                            | 'PUBLISHED'
                                            | 'DRAFT'
                                            | 'DELETED'
                                    }
                                />
                            }
                        />
                        <DetailRow label="Start Date" value={invite.start_date} />
                        <DetailRow label="Vendor" value={invite.vendor} />
                        <DetailRow label="Currency" value={invite.currency} />
                        <DetailRow
                            label="Created At"
                            value={
                                invite.created_at
                                    ? format(new Date(invite.created_at), 'MMM dd, yyyy')
                                    : '-'
                            }
                        />
                    </div>
                </div>

                <div className="space-y-2">
                    <h4 className="px-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                        Payment Options
                    </h4>
                    {invite.package_session_to_payment_options?.map((option) => (
                        <div
                            key={option.id}
                            className="rounded-lg border border-neutral-100 bg-neutral-50 p-2.5"
                        >
                            <div className="mb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <CreditCard className="size-4 text-neutral-400" />
                                    <span className="text-sm font-medium text-neutral-700">
                                        {option.payment_option.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                            option.payment_option.type === 'FREE'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-blue-100 text-blue-700'
                                        )}
                                    >
                                        {option.payment_option.type.replace(/_/g, ' ')}
                                    </span>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button className="rounded p-1 text-neutral-400 hover:bg-neutral-100">
                                                <DotsThreeVertical className="size-3" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="z-[100]">
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    setEditingPaymentOption(option.payment_option)
                                                }
                                            >
                                                <Pencil className="mr-2 size-3" />
                                                Edit Option
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>

                            {option.payment_option.payment_plans.map((plan) => (
                                <div
                                    key={plan.id}
                                    className="mt-2 rounded border border-neutral-100 bg-white p-2 shadow-sm"
                                >
                                    <div className="mb-1 flex items-center justify-between">
                                        <span className="text-xs font-medium text-neutral-800">
                                            {plan.name}
                                        </span>
                                        <span className="text-xs font-bold text-primary-600">
                                            {plan.currency} {formatPlanPrice(plan.actual_price)}
                                        </span>
                                    </div>
                                    <div className="flex gap-2 text-[10px] text-neutral-500">
                                        <span>validity: {plan.validity_in_days} days</span>
                                        {plan.member_count > 1 && (
                                            <span>• members: {plan.member_count}</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}

                    {(!invite.package_session_to_payment_options ||
                        invite.package_session_to_payment_options.length === 0) && (
                        <div className="py-4 text-center text-xs italic text-neutral-400">
                            No payment options configured
                        </div>
                    )}
                </div>
            </div>

            {editingPaymentOption && (
                <EditPaymentOptionDialog
                    paymentOption={editingPaymentOption}
                    open={!!editingPaymentOption}
                    onOpenChange={(open) => !open && setEditingPaymentOption(null)}
                />
            )}
        </div>
    );
};

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-500">{label}</span>
        <span className="font-medium text-neutral-700">{value}</span>
    </div>
);

// Content Tab
const ContentTab = ({
    packageDto,
    onUpdate,
}: {
    packageDto?: PackageDTO;
    onUpdate?: (data: Partial<PackageDTO>) => void;
}) => {
    const [open, setOpen] = useState(false);

    if (!packageDto) {
        return <EmptyState message="No content available" />;
    }

    const contentItems = [
        { label: 'Why Learn', value: packageDto.why_learn_html },
        { label: 'Who Should Learn', value: packageDto.who_should_learn_html },
        {
            label: `About the ${getTerminology(ContentTerms.Course, SystemTerms.Course)}`,
            value: packageDto.about_the_course_html,
        },
        {
            label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Description`,
            value: packageDto.course_html_description_html,
        },
    ].filter((item) => item.value);

    return (
        <div className="space-y-4 p-2">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-neutral-700">
                    {getTerminology(ContentTerms.Course, SystemTerms.Course)} Content
                </h4>
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                    <Pencil className="mr-2 size-3" />
                    Edit Content
                </Button>
            </div>

            {contentItems.length === 0 ? (
                <EmptyState message="No content configured" />
            ) : (
                <div className="space-y-2">
                    {contentItems.map((item, index) => (
                        <ContentCard key={index} label={item.label} html={item.value!} />
                    ))}
                </div>
            )}

            <CourseContentDialog
                open={open}
                onOpenChange={setOpen}
                courseName={packageDto.package_name || getTerminology(ContentTerms.Package, SystemTerms.Package)}
                defaultTab="content"
                initialData={{
                    why_learn_html: packageDto.why_learn_html,
                    who_should_learn_html: packageDto.who_should_learn_html,
                    about_the_course_html: packageDto.about_the_course_html,
                    course_html_description: packageDto.course_html_description_html,
                    thumbnail_file_id: packageDto.thumbnail_file_id,
                    course_preview_image_media_id: packageDto.course_preview_image_media_id,
                    course_banner_media_id: packageDto.course_banner_media_id,
                    course_media_id: packageDto.course_media_id,
                }}
                onSave={(data) => {
                    if (onUpdate) {
                        onUpdate({
                            why_learn_html: data.why_learn_html,
                            who_should_learn_html: data.who_should_learn_html,
                            about_the_course_html: data.about_the_course_html,
                            course_html_description_html: data.course_html_description,
                            thumbnail_file_id: data.thumbnail_file_id,
                            course_preview_image_media_id: data.course_preview_image_media_id,
                            course_banner_media_id: data.course_banner_media_id,
                            course_media_id: data.course_media_id,
                        });
                    }
                }}
            />
        </div>
    );
};

const ContentCard = ({ label, html }: { label: string; html: string }) => {
    const stripHtml = (str: string) => {
        const tmp = document.createElement('div');
        tmp.innerHTML = str;
        return tmp.textContent || tmp.innerText || '';
    };

    const plainText = stripHtml(html);
    const truncated = plainText.length > 150 ? plainText.slice(0, 150) + '...' : plainText;

    return (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2">
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-600">
                <FileText className="size-3" />
                {label}
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">{truncated}</p>
        </div>
    );
};

// Media Tab
const MediaTab = ({
    packageDto,
    onUpdate,
}: {
    packageDto?: PackageDTO;
    onUpdate?: (data: Partial<PackageDTO>) => void;
}) => {
    const [open, setOpen] = useState(false);

    if (!packageDto) {
        return <EmptyState message="No media available" />;
    }

    const mediaItems = [
        { label: 'Thumbnail', id: packageDto.thumbnail_file_id },
        { label: 'Preview Image', id: packageDto.course_preview_image_media_id },
        { label: 'Banner', id: packageDto.course_banner_media_id },
        {
            label: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} Media`,
            id: packageDto.course_media_id,
        },
    ];

    return (
        <div className="space-y-4 p-2">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-neutral-700">
                    {getTerminology(ContentTerms.Course, SystemTerms.Course)} Media
                </h4>
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                    <Pencil className="mr-2 size-3" />
                    Edit Media
                </Button>
            </div>

            <div className="space-y-1.5">
                {mediaItems.map((item, index) => (
                    <div
                        key={index}
                        className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-2 py-1.5 text-xs"
                    >
                        <span className="text-neutral-600">{item.label}</span>
                        <span
                            className={cn(
                                'rounded px-1.5 py-0.5',
                                item.id
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-neutral-200 text-neutral-500'
                            )}
                        >
                            {item.id ? 'Set' : 'Not set'}
                        </span>
                    </div>
                ))}

                {packageDto.drip_condition_json && (
                    <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5 text-xs">
                        <span className="font-medium text-blue-700">Drip condition configured</span>
                    </div>
                )}
            </div>

            <CourseContentDialog
                open={open}
                onOpenChange={setOpen}
                courseName={packageDto.package_name || getTerminology(ContentTerms.Package, SystemTerms.Package)}
                defaultTab="media"
                initialData={{
                    why_learn_html: packageDto.why_learn_html,
                    who_should_learn_html: packageDto.who_should_learn_html,
                    about_the_course_html: packageDto.about_the_course_html,
                    course_html_description: packageDto.course_html_description_html,
                    thumbnail_file_id: packageDto.thumbnail_file_id,
                    course_preview_image_media_id: packageDto.course_preview_image_media_id,
                    course_banner_media_id: packageDto.course_banner_media_id,
                    course_media_id: packageDto.course_media_id,
                }}
                onSave={(data) => {
                    if (onUpdate) {
                        onUpdate({
                            why_learn_html: data.why_learn_html,
                            who_should_learn_html: data.who_should_learn_html,
                            about_the_course_html: data.about_the_course_html,
                            course_html_description_html: data.course_html_description,
                            thumbnail_file_id: data.thumbnail_file_id,
                            course_preview_image_media_id: data.course_preview_image_media_id,
                            course_banner_media_id: data.course_banner_media_id,
                            course_media_id: data.course_media_id,
                        });
                    }
                }}
            />
        </div>
    );
};

// Empty State
const EmptyState = ({ message }: { message: string }) => (
    <div className="flex flex-col items-center justify-center py-8 text-center">
        <Info className="mb-2 size-6 text-neutral-300" />
        <p className="text-xs text-neutral-500">{message}</p>
    </div>
);

// Faculty Tab
const FacultyTab = ({
    packageId,
    sessions,
}: {
    packageId: string;
    sessions: PackageSessionDTO[];
}) => {
    const queryClient = useQueryClient();
    const [selectedFaculty, setSelectedFaculty] = useState<InstructorDTO | null>(null);
    const [openCombobox, setOpenCombobox] = useState(false);
    const [assignedBatches, setAssignedBatches] = useState<string[]>([]);

    // We will list instructors.
    const { data: instructors } = useQuery({
        queryKey: ['instructors'],
        queryFn: () => fetchInstructors(),
    });

    // When faculty selected, fetch their assignments
    const { data: assignments, isLoading: isLoadingAssignments } = useQuery({
        queryKey: ['faculty-assignments', selectedFaculty?.id, packageId],
        queryFn: () => fetchFacultyAssignments(selectedFaculty!.id),
        enabled: !!selectedFaculty?.id,
    });

    useEffect(() => {
        if (assignments) {
            if (Array.isArray(assignments)) {
                // If it's an array, it might be an array of assignments (with batch_id) or sessions (with id)
                // We use type assertion to handle the potential structure from the API
                const items = assignments as FacultyAssignmentResponse[];
                const batchIds = items
                    .map((a: FacultyAssignmentResponse) => a.batch_id || a.id)
                    .filter((id): id is string => !!id);
                const validBatchIds = sessions.map((s) => s.id);
                setAssignedBatches(batchIds.filter((id) => validBatchIds.includes(id)));
            } else if ((assignments as FacultyAssignmentResponse).batch_ids) {
                // If structure is { batch_ids: [...] }
                const validBatchIds = sessions.map((s) => s.id);
                setAssignedBatches(
                    ((assignments as FacultyAssignmentResponse).batch_ids || []).filter((id) =>
                        validBatchIds.includes(id)
                    )
                );
            }
        } else {
            setAssignedBatches([]);
        }
    }, [assignments, sessions]);

    const { mutate, isPending } = useMutation({
        mutationFn: async () => {
            if (!selectedFaculty) return;
            await assignFaculty({
                user_id: selectedFaculty.id,
                batch_ids: assignedBatches,
                subject_ids: [],
            });
        },
        onSuccess: () => {
            toast.success('Faculty assigned successfully');
            queryClient.invalidateQueries({ queryKey: ['faculty-assignments'] });
            setSelectedFaculty(null);
            setAssignedBatches([]);
        },
        onError: () => toast.error('Failed to assign faculty'),
    });

    return (
        <div className="space-y-4 p-2">
            <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-700">Assign Faculty</label>
                <div className="flex flex-col gap-2">
                    <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={openCombobox}
                                className="w-full justify-between text-xs"
                            >
                                {selectedFaculty ? selectedFaculty.full_name : 'Select faculty...'}
                                <Users className="ml-2 size-3 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="z-[100] w-[200px] p-0" align="start">
                            <Command>
                                <CommandInput
                                    placeholder="Search faculty..."
                                    className="h-8 text-xs"
                                />
                                <CommandList>
                                    <CommandEmpty>No faculty found.</CommandEmpty>
                                    <CommandGroup>
                                        {instructors?.map((instructor) => (
                                            <CommandItem
                                                key={instructor.id}
                                                value={instructor.full_name}
                                                onSelect={() => {
                                                    setSelectedFaculty(instructor);
                                                    setOpenCombobox(false);
                                                }}
                                                className="text-xs"
                                            >
                                                <Check
                                                    className={cn(
                                                        'mr-2 size-3',
                                                        selectedFaculty?.id === instructor.id
                                                            ? 'opacity-100'
                                                            : 'opacity-0'
                                                    )}
                                                />
                                                {instructor.full_name}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>

                    {selectedFaculty && (
                        <div className="space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                            <div className="text-xs font-semibold text-neutral-800">
                                Select Batches for {selectedFaculty.full_name}
                            </div>

                            {isLoadingAssignments ? (
                                <div className="flex justify-center py-4">
                                    <DashboardLoader />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {sessions.map((session) => (
                                        <div
                                            key={session.id}
                                            className="flex items-center space-x-2"
                                        >
                                            <Checkbox
                                                id={`batch-${session.id}`}
                                                checked={assignedBatches.includes(session.id)}
                                                onCheckedChange={(checked) => {
                                                    if (checked) {
                                                        setAssignedBatches([
                                                            ...assignedBatches,
                                                            session.id,
                                                        ]);
                                                    } else {
                                                        setAssignedBatches(
                                                            assignedBatches.filter(
                                                                (id) => id !== session.id
                                                            )
                                                        );
                                                    }
                                                }}
                                            />
                                            <label
                                                htmlFor={`batch-${session.id}`}
                                                className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                            >
                                                {session.level.level_name} -{' '}
                                                {session.session.session_name}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <Button
                                size="sm"
                                onClick={() => mutate()}
                                disabled={isPending}
                                className="w-full"
                            >
                                {isPending ? 'Assigning...' : 'Confirm Assignment'}
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
