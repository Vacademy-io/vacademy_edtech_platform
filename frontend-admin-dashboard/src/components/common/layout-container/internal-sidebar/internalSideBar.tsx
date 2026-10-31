'use client';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Folder, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export const InternalSideBar = ({
    sideBarList,
    sideBarData,
}: {
    sideBarList?: { value: string; id: string }[];
    sideBarData?: { title: string; listIconText: string; searchParam: string };
}) => {
    const router = useRouter();
    const navigate = useNavigate();
    const { t } = useTranslation('internalSidebar');
    const { search } = router.state.location;
    const isMobile = useIsMobile();
    const isTablet = useIsTablet();
    const [isOpen, setIsOpen] = useState(false);

    const courseId = (search as Record<string, string | undefined>).courseId;

    const handleCourseNavigation = (clickedCourseId: string) => {
        navigate({
            to: '/study-library/courses/course-details',
            search: { courseId: clickedCourseId },
        });
        // Close sheet on mobile after navigation
        if (isMobile || isTablet) {
            setIsOpen(false);
        }
    };

    if (!sideBarList || sideBarList.length === 0) {
        return null;
    }

    // Sidebar content - shared between mobile drawer and desktop sidebar
    const sidebarContent = (
        <>
            <div className="px-3 text-lg font-semibold text-gray-800">{sideBarData?.title}</div>
            <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                {sideBarList.map((course) => {
                    return (
                        <Collapsible
                            key={course.id}
                            open={course.id === courseId}
                            className="space-y-1"
                        >
                            <CollapsibleTrigger
                                className="w-full"
                                onClick={() => handleCourseNavigation(course.id)}
                            >
                                <div
                                    className={cn(
                                        'flex items-center gap-2 rounded-md p-2 text-sm font-medium',
                                        course.id === courseId
                                            ? 'bg-primary-100'
                                            : 'hover:bg-gray-200'
                                    )}
                                >
                                    <Folder
                                        size={18}
                                        weight={course.id === courseId ? 'fill' : 'duotone'}
                                        className={cn(course.id === courseId && 'text-neutral-900')}
                                    />
                                    <span className="flex-1 truncate text-left">
                                        {course.value}
                                    </span>
                                </div>
                            </CollapsibleTrigger>
                        </Collapsible>
                    );
                })}
            </div>
        </>
    );

    // Mobile/Tablet: Render as Sheet/Drawer with a trigger button
    if (isMobile || isTablet) {
        return (
            <>
                {/* Floating button to open sidebar */}
                <Sheet open={isOpen} onOpenChange={setIsOpen}>
                    <SheetTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className="fixed bottom-4 left-4 z-50 shadow-lg md:bottom-6 md:left-6"
                        >
                            <Folder className="mr-2 size-4" />
                            {sideBarData?.title || t('coursesFallback')}
                        </Button>
                    </SheetTrigger>
                    <SheetContent
                        side="left"
                        className="w-[280px] p-0 bg-white"
                    >
                        <SheetHeader className="px-3 pt-6">
                            <SheetTitle className="text-lg font-semibold text-gray-800">
                                {sideBarData?.title}
                            </SheetTitle>
                        </SheetHeader>
                        <div className="flex h-full flex-col gap-4 px-3 py-4 overflow-y-auto">
                            <div className="flex-1 space-y-1 pr-1">
                                {sideBarList.map((course) => {
                                    return (
                                        <Collapsible
                                            key={course.id}
                                            open={course.id === courseId}
                                            className="space-y-1"
                                        >
                                            <CollapsibleTrigger
                                                className="w-full"
                                                onClick={() => handleCourseNavigation(course.id)}
                                            >
                                                <div
                                                    className={cn(
                                                        'flex items-center gap-2 rounded-md p-2 text-sm font-medium',
                                                        course.id === courseId
                                                            ? 'bg-primary-100'
                                                            : 'hover:bg-gray-200'
                                                    )}
                                                >
                                                    <Folder
                                                        size={18}
                                                        weight={course.id === courseId ? 'fill' : 'duotone'}
                                                        className={cn(course.id === courseId && 'text-neutral-900')}
                                                    />
                                                    <span className="flex-1 truncate text-left">
                                                        {course.value}
                                                    </span>
                                                </div>
                                            </CollapsibleTrigger>
                                        </Collapsible>
                                    );
                                })}
                            </div>
                        </div>
                    </SheetContent>
                </Sheet>
            </>
        );
    }

    // Desktop: Render as regular sidebar
    return (
        <div className="flex h-full w-[307px] flex-col gap-4 bg-white border-r border-neutral-200 px-3 py-6">
            {sidebarContent}
        </div>
    );
};
