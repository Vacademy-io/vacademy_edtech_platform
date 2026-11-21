import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import {
    ArrowRight,
    CircleNotch,
    EnvelopeSimple,
    MagnifyingGlass,
    Plus,
    Users,
    WarningCircle,
    XCircle,
} from '@phosphor-icons/react';
import { handleFetchInviteLinks, handleMakeInviteLinkDefault } from '../-services/get-invite-links';
import { MyPagination } from '@/components/design-system/pagination';
import { usePaginationState } from '@/hooks/pagination';
import type { InviteLinkDataInterface } from '@/schemas/study-library/invite-links-schema';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { UseFormReturn } from 'react-hook-form';
import { CourseDetailsFormValues } from './course-details-schema';
import { useEffect, useMemo, useState } from 'react';
import GenerateInviteLinkDialog from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkDialog';
import { useDeleteEnrollInvites } from '@/routes/manage-students/invite/-services/delete-enroll-invites';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import { useDebouncedValue } from '@/routes/erp/people/-hooks/use-debounced-value';
import { useTranslation } from 'react-i18next';
import { InviteLinkCard } from './invite-links/invite-link-card';

type FlattenedInviteLink = InviteLinkDataInterface & { packageSessionId: string };

const InviteDetailsComponent = ({
    form,
    selectedBatchId,
}: {
    form: UseFormReturn<CourseDetailsFormValues>;
    selectedBatchId?: string;
}) => {
    const { t } = useTranslation('studyLibraryCourseDetailsInviteDetailsComponent');
    const sessionsData = form.getValues('courseData.sessions');
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { instituteDetails, getPackageSessionId, getDetailsFromPackageSessionId } =
        useInstituteDetailsStore();
    const router = useRouter();
    const { courseId } = router.state.location.search;
    const courseName = form.getValues('courseData.packageName') || '';

    const selectedCourse = { id: courseId || '', name: courseName };

    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [addDialogData, setAddDialogData] = useState<{
        packageSessionId: string;
        defaultInviteLinkId: string;
        isEditInviteLink: boolean;
    } | null>(null);
    const [pendingDelete, setPendingDelete] = useState<InviteLinkDataInterface | null>(null);

    // Search is server-side (the list is paginated, so filtering one page
    // client-side would hide matches on the others). Debounced so a fast typist
    // does not fire a request per keystroke.
    const [searchInput, setSearchInput] = useState('');
    const searchTerm = useDebouncedValue(searchInput.trim(), 350);

    // Generate base list of packageSessionIds for each level in each session
    const allPackageSessionIds: string[] = sessionsData
        .flatMap((session) =>
            session.levelDetails.map(
                (level) =>
                    getPackageSessionId({
                        courseId: courseId || '',
                        levelId: level.id,
                        sessionId: session.sessionDetails.id,
                    }) || ''
            )
        )
        .filter(Boolean);

    // If a specific batch/subgroup is selected and present in the list,
    // narrow the invite links to just that package_session_id.
    const packageSessionIds: string[] =
        selectedBatchId && allPackageSessionIds.includes(selectedBatchId)
            ? [selectedBatchId]
            : allPackageSessionIds;

    const { page, pageSize, handlePageChange } = usePaginationState({
        initialPage: 0,
        initialPageSize: 10,
    });

    // A new search term restarts from the first page; page N of the old
    // results is meaningless (and often empty) for the new ones.
    useEffect(() => {
        handlePageChange(0);
    }, [searchTerm, handlePageChange]);

    // Only call the API if there are packageSessionIds.
    //
    // useQuery rather than useSuspenseQuery: the nearest <Suspense> is the app
    // root, so a suspending fetch blanks the whole page for the round-trip.
    // With search re-keying the query on every debounced term that would flash
    // constantly. keepPreviousData holds the last page on screen while the
    // next one loads; the toolbar shows a spinner instead.
    const shouldFetch = packageSessionIds.length > 0;
    const {
        data: inviteLinks,
        isPending,
        isFetching,
        isError,
        refetch,
    } = useQuery({
        ...handleFetchInviteLinks(packageSessionIds, page, pageSize, searchTerm),
        enabled: shouldFetch,
        placeholderData: keepPreviousData,
    });
    const isInitialLoading = shouldFetch && isPending;

    // --- Group invite links by package_session_id ---
    // Flatten so each entry is {inviteLink, packageSessionId}, then group. The
    // server returns newest first; flatMap/grouping preserve that order within
    // each batch, so no client-side sort is needed.
    const groupedEntries = useMemo(() => {
        const content: InviteLinkDataInterface[] = inviteLinks?.content ?? [];
        const grouped: Record<string, FlattenedInviteLink[]> = {};
        content.forEach((inviteLink) => {
            (inviteLink.package_session_ids || []).forEach((packageSessionId) => {
                (grouped[packageSessionId] ??= []).push({ ...inviteLink, packageSessionId });
            });
        });
        return Object.entries(grouped);
    }, [inviteLinks]);

    const totalInvites: number = inviteLinks?.totalElements ?? inviteLinks?.content?.length ?? 0;
    const hasResults = shouldFetch && groupedEntries.length > 0;
    const isSearching = searchTerm.length > 0;

    const showMutationError = (error: unknown, fallback: string) => {
        const message =
            error instanceof AxiosError ? error?.response?.data?.ex || fallback : fallback;
        toast.error(message, { className: 'error-toast', duration: 2000 });
        if (!(error instanceof AxiosError)) console.error('Unexpected error:', error);
    };

    const handleMakeDefaultMutation = useMutation({
        mutationFn: async ({
            packageSessionId,
            inviteLinkId,
        }: {
            packageSessionId: string;
            inviteLinkId: string;
        }) => handleMakeInviteLinkDefault(packageSessionId, inviteLinkId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['GET_INVITE_LINKS'] });
            toast.success(t('madeDefault'));
        },
        onError: (error: unknown) => showMutationError(error, t('unexpectedError')),
    });

    const deleteMutation = useDeleteEnrollInvites();

    const handleConfirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await deleteMutation.mutateAsync([pendingDelete.id]);
            toast.success(t('deleteDialog.success', { name: pendingDelete.name }));
            setPendingDelete(null);
        } catch (error) {
            showMutationError(error, t('deleteDialog.error'));
        }
    };

    const handleEditInviteLink = (inviteLinkId: string, packageSessionId: string) => {
        setAddDialogData({
            packageSessionId,
            defaultInviteLinkId: inviteLinkId,
            isEditInviteLink: true,
        });
        setIsAddDialogOpen(true);
    };

    const handleAddInviteLink = (packageSessionId: string, defaultInviteLinkId: string) => {
        setAddDialogData({ packageSessionId, defaultInviteLinkId, isEditInviteLink: false });
        setIsAddDialogOpen(true);
    };

    const batchLabel = (packageSessionId: string) => {
        const details = getDetailsFromPackageSessionId({ packageSessionId });
        return [courseName, details?.session.session_name, details?.level.level_name]
            .filter(Boolean)
            .join(' · ');
    };

    const addDialogBatch = getDetailsFromPackageSessionId({
        packageSessionId: addDialogData?.packageSessionId || '',
    });

    return (
        <>
            <Dialog>
                <DialogTrigger asChild>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="flex items-center gap-1"
                    >
                        <Plus size={16} />
                        {t('inviteLinks')}
                    </MyButton>
                </DialogTrigger>
                <DialogContent className="flex max-h-dialog-tall w-dialog-xl flex-col gap-0 overflow-hidden p-0">
                    <DialogHeader className="shrink-0 rounded-t-lg border-b border-primary-100 bg-primary-50 p-4">
                        <DialogTitle className="flex items-center gap-2 font-normal text-primary-500">
                            <EnvelopeSimple className="size-5" />
                            {t('inviteLinks')}
                        </DialogTitle>
                    </DialogHeader>

                    {/* Toolbar: search + count. Sticky above the scrolling list. */}
                    <div className="flex shrink-0 flex-col gap-3 border-b border-neutral-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative w-full sm:max-w-md">
                            <MyInput
                                inputType="text"
                                input={searchInput}
                                onChangeFunction={(e) => setSearchInput(e.target.value)}
                                inputPlaceholder={t('searchPlaceholder')}
                                className="w-full px-9 sm:w-full"
                                aria-label={t('searchPlaceholder')}
                            />
                            <MagnifyingGlass className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500" />
                            {searchInput && (
                                <button
                                    type="button"
                                    onClick={() => setSearchInput('')}
                                    aria-label={t('clearSearch')}
                                    className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 focus:outline-none"
                                >
                                    <XCircle className="size-4" />
                                </button>
                            )}
                        </div>
                        <p className="flex shrink-0 items-center gap-1.5 text-caption text-neutral-500">
                            {isFetching && (
                                <CircleNotch
                                    className="size-3.5 animate-spin text-primary-500"
                                    aria-label={t('loading')}
                                />
                            )}
                            {t('resultCount', { count: totalInvites })} · {t('sortedNewest')}
                        </p>
                    </div>

                    <div className="flex-1 space-y-4 overflow-y-auto p-4">
                        {isInitialLoading ? (
                            <div className="flex flex-col gap-3" aria-busy="true">
                                {[0, 1, 2].map((i) => (
                                    <div
                                        key={i}
                                        className="h-28 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100"
                                    />
                                ))}
                            </div>
                        ) : isError ? (
                            <div className="flex flex-col items-center gap-2 py-10 text-center">
                                <WarningCircle className="size-8 text-danger-600" />
                                <p className="text-body text-neutral-600">{t('loadError')}</p>
                                <MyButton
                                    type="button"
                                    scale="small"
                                    buttonType="secondary"
                                    onClick={() => refetch()}
                                >
                                    {t('retry')}
                                </MyButton>
                            </div>
                        ) : hasResults ? (
                            groupedEntries.map(([packageSessionId, inviteLinksArr]) => (
                                <section
                                    key={packageSessionId}
                                    className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4"
                                >
                                    {/* Batch header */}
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <div className="rounded-md bg-primary-100 p-1 text-primary-500">
                                                <Users size={18} />
                                            </div>
                                            <span className="truncate text-subtitle font-semibold text-neutral-700">
                                                {batchLabel(packageSessionId)}
                                            </span>
                                            <span className="shrink-0 text-caption text-neutral-500">
                                                {t('linkCount', {
                                                    count: inviteLinksArr.length,
                                                })}
                                            </span>
                                        </div>
                                        <MyButton
                                            type="button"
                                            scale="small"
                                            buttonType="secondary"
                                            className="flex items-center gap-1"
                                            onClick={() => {
                                                const defaultInviteLink = inviteLinksArr.find(
                                                    (invite) => invite.tag === 'DEFAULT'
                                                );
                                                handleAddInviteLink(
                                                    packageSessionId,
                                                    defaultInviteLink?.id || ''
                                                );
                                            }}
                                        >
                                            <Plus className="size-3.5" />
                                            {t('add')}
                                        </MyButton>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        {inviteLinksArr.map((inviteLink) => (
                                            <InviteLinkCard
                                                key={inviteLink.id + packageSessionId}
                                                invite={inviteLink}
                                                packageSessionId={packageSessionId}
                                                inviteUrl={createInviteLink(
                                                    inviteLink.invite_code,
                                                    instituteDetails?.learner_portal_base_url
                                                )}
                                                onEdit={() =>
                                                    handleEditInviteLink(
                                                        inviteLink.id,
                                                        packageSessionId
                                                    )
                                                }
                                                onDelete={() => setPendingDelete(inviteLink)}
                                                onMakeDefault={() =>
                                                    handleMakeDefaultMutation.mutate({
                                                        packageSessionId,
                                                        inviteLinkId: inviteLink.id,
                                                    })
                                                }
                                                isMakingDefault={
                                                    handleMakeDefaultMutation.isPending
                                                }
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))
                        ) : (
                            <div className="flex flex-col items-center gap-2 py-10 text-center">
                                <MagnifyingGlass className="size-8 text-neutral-300" />
                                <p className="text-body text-neutral-600">
                                    {isSearching
                                        ? t('noSearchResults', { term: searchTerm })
                                        : t('noInviteLinksAvailable')}
                                </p>
                                {isSearching && (
                                    <MyButton
                                        type="button"
                                        scale="small"
                                        buttonType="text"
                                        onClick={() => setSearchInput('')}
                                    >
                                        {t('clearSearch')}
                                    </MyButton>
                                )}
                            </div>
                        )}
                        {hasResults && (inviteLinks?.totalPages ?? 1) > 1 && (
                            <MyPagination
                                currentPage={page}
                                totalPages={inviteLinks?.totalPages ?? 1}
                                onPageChange={handlePageChange}
                            />
                        )}
                    </div>

                    <div className="shrink-0 border-t border-neutral-200 p-4">
                        <MyButton
                            type="button"
                            scale="small"
                            buttonType="secondary"
                            className="flex items-center gap-1"
                            onClick={() => {
                                navigate({ to: '/manage-students/invite' });
                            }}
                        >
                            <ArrowRight size={18} />
                            {t('invitePage')}
                        </MyButton>
                    </div>
                </DialogContent>
            </Dialog>

            <MyDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                }}
                heading={t('deleteDialog.heading')}
                dialogWidth="w-dialog-md"
                footer={
                    <>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => setPendingDelete(null)}
                            disabled={deleteMutation.isPending}
                        >
                            {t('deleteDialog.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            onClick={handleConfirmDelete}
                            disabled={deleteMutation.isPending}
                            className="bg-danger-600 hover:bg-danger-500 active:bg-danger-500"
                        >
                            {deleteMutation.isPending
                                ? t('deleteDialog.deleting')
                                : t('deleteDialog.confirm')}
                        </MyButton>
                    </>
                }
            >
                <p className="text-body text-neutral-600">
                    {t('deleteDialog.confirmText', { name: pendingDelete?.name ?? '' })}
                </p>
            </MyDialog>

            <GenerateInviteLinkDialog
                selectedCourse={selectedCourse}
                selectedBatches={[
                    {
                        sessionId: addDialogBatch?.session.id || '',
                        levelId: addDialogBatch?.level.id || '',
                        sessionName: addDialogBatch?.session.session_name || '',
                        levelName: addDialogBatch?.level.level_name || '',
                        courseId: courseId || '',
                        courseName,
                    },
                ]}
                showSummaryDialog={isAddDialogOpen}
                setShowSummaryDialog={setIsAddDialogOpen}
                inviteLinkId={addDialogData?.defaultInviteLinkId}
                singlePackageSessionId={true}
                isEditInviteLink={addDialogData?.isEditInviteLink}
            />
        </>
    );
};

export default InviteDetailsComponent;
