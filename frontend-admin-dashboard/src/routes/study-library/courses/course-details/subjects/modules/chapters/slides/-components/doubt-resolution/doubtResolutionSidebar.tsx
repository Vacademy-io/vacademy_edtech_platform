import { Sidebar, SidebarContent, SidebarHeader, useSidebar } from '@/components/ui/sidebar';
import { X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { DoubtFilter } from '../../-types/get-doubts-type';
import { useGetDoubts } from '../../-services/GetDoubts';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { Doubt as DoubtType } from '../../-types/get-doubts-type';
import { DoubtList } from './doubtList';
import { get30DaysAgo, getTomorrow } from '@/utils/dateUtils';
import { useRouter } from '@tanstack/react-router';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useGetPackageSessionIdFromCourseInit } from '@/utils/helpers/study-library-helpers.ts/get-list-from-stores/getPackageSessionIdFromCourseInit';

const TabsTriggerClass =
    'flex-1 rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-primary-50 data-[state=active]:text-primary-600 data-[state=active]:shadow-sm';

const DoubtResolutionSidebar = () => {
    const { t } = useTranslation('studyLibraryDoubtResolutionSidebar');
    const { open, setOpen } = useSidebar();
    const { activeItem } = useContentStore();
    const observer = useRef<IntersectionObserver | null>(null);
    const [activeTab, setActiveTab] = useState('ALL');
    const sidebarRef = useRef<HTMLDivElement>(null);
    const router = useRouter();
    const searchParams = router.state.location.search;
    const { courseId, levelId, sessionId } = searchParams;
    const { getPackageSessionId } = useInstituteDetailsStore();

    // Try to get packageSessionId from course-init API first (new approach)
    const packageSessionIdFromCourseInit = useGetPackageSessionIdFromCourseInit(
        courseId || '',
        sessionId || '',
        levelId || ''
    );
    // Fallback to institute details if course-init doesn't have it
    const packageSessionIdFromInstitute = getPackageSessionId({
        courseId: courseId || '',
        levelId: levelId || '',
        sessionId: sessionId || '',
    });
    // Prefer course-init data, fallback to institute details
    const packageSessionId = packageSessionIdFromCourseInit || packageSessionIdFromInstitute;

    const [filter, setFilter] = useState<DoubtFilter>({
        name: '',
        start_date: get30DaysAgo(),
        end_date: getTomorrow(),
        user_ids: [],
        content_positions: [],
        content_types: [
            activeItem?.source_type == 'DOCUMENT'
                ? activeItem?.document_slide?.type || ''
                : activeItem?.source_type || '',
        ],
        sources: ['SLIDE'],
        source_ids: [activeItem?.id || ''],
        status: ['ACTIVE', 'RESOLVED'],
        sort_columns: {
            created_at: 'DESC',
        },
        batch_ids: packageSessionId ? [packageSessionId] : [],
    });

    // Gate the doubts query on sidebar visibility. The sidebar component stays
    // mounted with w-0 when closed, so without this gate the hook would fire
    // on every parent re-render — including the per-keystroke re-renders
    // driven by the chapter-sidebar store's autosave-on-edit pattern. With
    // `enabled: open`, the query simply doesn't run when the panel isn't
    // visible. Opening the sidebar triggers a fresh fetch the first time.
    const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
        useGetDoubts(filter, open);

    const [allDoubts, setAllDoubts] = useState<DoubtType[]>(
        (data as any)?.pages?.flatMap((page: { content: DoubtType[] }) => page.content) || []
    );

    useEffect(() => {
        setAllDoubts(
            (data as any)?.pages?.flatMap((page: { content: DoubtType[] }) => page.content) || []
        );
    }, [data]);

    // Narrow the deps to the primitive fields we actually read inside.
    // Previously this was `[activeItem, packageSessionId]`, but `activeItem`
    // is a reference from the chapter-sidebar store that mutates on every
    // admin-side autosave (per-keystroke), causing the effect to fire on
    // every keystroke and produce a fresh filter object. Now we only re-run
    // when the slide id, slide type, or doc-slide subtype actually change.
    useEffect(() => {
        setFilter((prev) => ({
            ...prev,
            source_ids: [activeItem?.id || ''],
            content_types: [
                activeItem?.source_type == 'DOCUMENT'
                    ? activeItem?.document_slide?.type || ''
                    : activeItem?.source_type || '',
            ],
            batch_ids: packageSessionId ? [packageSessionId] : [],
        }));
    }, [
        activeItem?.id,
        activeItem?.source_type,
        activeItem?.document_slide?.type,
        packageSessionId,
    ]);

    // Note: the previous `useEffect(() => refetch(), [filter])` block was
    // removed. The stable primitive-fielded queryKey on useGetDoubts already
    // makes React Query auto-refetch when any meaningful filter field
    // changes. The manual refetch was firing alongside it (double-fire) AND
    // bypassed the `enabled` gate above, so it would have undone the
    // sidebar-open guard.

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            // Only handle click outside if sidebar is open
            if (!open) return;

            const target = event.target as Element;

            // Check if click is outside the sidebar
            if (sidebarRef.current && !sidebarRef.current.contains(target)) {
                // Check if the click is on a DeleteDoubt component or its children
                const isDeleteDoubtClick = target.closest('[data-delete-doubt]');

                // Check if the click is on a dialog or its children
                const isDialogClick =
                    target.closest('[role="dialog"]') ||
                    target.closest('[data-radix-popper-content-wrapper]') ||
                    target.closest('.radix-dialog-content') ||
                    target.closest('[data-state="open"]') ||
                    target.closest('[data-radix-dialog-content]');

                // If it's not a delete doubt click or dialog click, close the sidebar
                if (!isDeleteDoubtClick && !isDialogClick) {
                    setOpen(false);
                }
            }
        };

        // Add event listener
        document.addEventListener('mousedown', handleClickOutside);

        // Cleanup
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [open, setOpen]);

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        if (value === 'RESOLVED') {
            setFilter((prev) => ({ ...prev, status: ['RESOLVED'] }));
        } else if (value === 'UNRESOLVED') {
            setFilter((prev) => ({ ...prev, status: ['ACTIVE'] }));
        } else {
            setFilter((prev) => ({ ...prev, status: ['ACTIVE', 'RESOLVED'] }));
        }
    };

    const lastDoubtElementRef = useCallback(
        (node: HTMLDivElement) => {
            if (isLoading) return;
            if (observer.current) observer.current.disconnect();
            observer.current = new IntersectionObserver((entries) => {
                if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                }
            });
            if (node) observer.current.observe(node);
        },
        [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage]
    );

    if (isLoading && !data) return <DashboardLoader />;
    if (isError) return <p>{t('errorFetchingDoubts')}</p>;

    return (
        <Sidebar
            ref={sidebarRef}
            side="right"
            className={`fixed right-0 top-0 z-[9999] h-full ${
                open ? 'w-[35vw] min-w-[450px]' : 'w-0'
            } flex flex-col overflow-y-hidden border-l border-neutral-200 bg-white shadow-lg transition-all duration-300 ease-in-out`}
        >
            <SidebarHeader className="flex w-full items-center justify-between border-b border-neutral-200 p-4">
                <div className="flex w-full items-center justify-between">
                    <h1 className="text-lg font-semibold text-neutral-800">{t('doubtResolution')}</h1>
                    <X
                        size={20}
                        className="cursor-pointer text-neutral-500 hover:text-neutral-700"
                        onClick={() => setOpen(false)}
                    />
                </div>
            </SidebarHeader>
            <SidebarContent className="no-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <TabsList className="grid w-full grid-cols-3 gap-2 rounded-lg bg-neutral-100 p-1">
                        <TabsTrigger value="ALL" className={TabsTriggerClass}>
                            {t('tabs.all')}
                        </TabsTrigger>
                        <TabsTrigger value="RESOLVED" className={TabsTriggerClass}>
                            {t('tabs.resolved')}
                        </TabsTrigger>
                        <TabsTrigger value="UNRESOLVED" className={TabsTriggerClass}>
                            {t('tabs.unresolved')}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent
                        value="ALL"
                        className="mt-4 flex flex-col data-[state=inactive]:hidden"
                    >
                        <DoubtList
                            allDoubts={allDoubts}
                            isLoading={
                                isLoading &&
                                (!(data as any)?.pages || (data as any).pages.length === 0)
                            }
                            lastDoubtElementRef={lastDoubtElementRef}
                            refetch={refetch}
                            isFetchingNextPage={isFetchingNextPage}
                            status={activeTab}
                        />
                    </TabsContent>
                    <TabsContent
                        value="RESOLVED"
                        className="mt-4 flex flex-col data-[state=inactive]:hidden"
                    >
                        <DoubtList
                            allDoubts={allDoubts}
                            isLoading={
                                isLoading &&
                                (!(data as any)?.pages || (data as any).pages.length === 0)
                            }
                            lastDoubtElementRef={lastDoubtElementRef}
                            refetch={refetch}
                            isFetchingNextPage={isFetchingNextPage}
                            status={activeTab}
                        />
                    </TabsContent>
                    <TabsContent
                        value="UNRESOLVED"
                        className="mt-4 flex flex-col data-[state=inactive]:hidden"
                    >
                        <DoubtList
                            allDoubts={allDoubts}
                            isLoading={
                                isLoading &&
                                (!(data as any)?.pages || (data as any).pages.length === 0)
                            }
                            lastDoubtElementRef={lastDoubtElementRef}
                            refetch={refetch}
                            isFetchingNextPage={isFetchingNextPage}
                            status={activeTab}
                        />
                    </TabsContent>
                </Tabs>
            </SidebarContent>
        </Sidebar>
    );
};

export default DoubtResolutionSidebar;
