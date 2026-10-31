import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { useIsMobile, useIsTablet } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { List } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export const InternalSidebarComponent = ({
    sidebarComponent,
    mobileButtonText,
}: {
    sidebarComponent: React.ReactNode;
    mobileButtonText?: string;
}) => {
    const { t } = useTranslation('internalSidebarComponent');
    const resolvedMobileButtonText = mobileButtonText ?? t('menu');
    const isMobile = useIsMobile();
    const isTablet = useIsTablet();
    const [isOpen, setIsOpen] = useState(false);

    // Sidebar content - shared between mobile drawer and desktop sidebar.
    // A page-supplied `sidebarComponent` is rendered as the panel's direct child
    // (no wrapper div) so it can own the full column: min-h-full resolves against
    // the h-screen panel, which is what lets a page pin a footer with
    // `sticky bottom-0` instead of a viewport-`fixed` bar that guesses its width.
    // (The old built-in fallback menu listed the retired public /evaluator-ai
    // tool; LayoutContainer only mounts this with a page-supplied component.)
    const sidebarContent = sidebarComponent;

    // Mobile/Tablet: Render as Sheet/Drawer with a trigger button
    if (isMobile || isTablet) {
        return (
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>
                    <Button
                        variant="default"
                        size="sm"
                        className="fixed bottom-6 start-4 z-50 rounded-full bg-primary-500 px-4 py-2 text-white shadow-xl hover:bg-primary-600 md:bottom-8 md:start-6"
                    >
                        <List className="mr-2 size-4" />
                        {resolvedMobileButtonText}
                    </Button>
                </SheetTrigger>
                <SheetContent
                    side="left"
                    className="w-internal-sidebar-drawer overflow-y-auto bg-white p-0"
                >
                    <SheetHeader className="sr-only px-3 pt-6">
                        <SheetTitle>{t('navigation')}</SheetTitle>
                    </SheetHeader>
                    <div
                        className="flex h-full flex-col gap-6 pb-5 pt-10"
                        onClick={(e) => {
                            // Close sidebar when clicking on a link
                            const target = e.target as HTMLElement;
                            if (target.closest('a') || target.closest('[role="button"]')) {
                                setIsOpen(false);
                            }
                        }}
                    >
                        {sidebarContent}
                    </div>
                </SheetContent>
            </Sheet>
        );
    }

    // Desktop: Render as regular sidebar.
    //
    // overflow-x-hidden is load-bearing. With `overflow-y: scroll` alone, CSS
    // computes overflow-x to `auto`, so any child that refuses to shrink (a
    // `truncate` span with no min-w-0 ancestor is the classic one) turns the
    // panel into a horizontally scrollable strip. Once it scrolls even a few
    // pixels the whole panel slides left under the category rail and every row
    // loses its first characters. Clipping the axis removes that failure mode
    // outright. overflow-y-auto (not -scroll) also stops the panel reserving a
    // permanent ~15px scrollbar gutter on content that fits.
    //
    // Vertical padding applies only to the built-in menu; a page that supplies
    // its own `sidebarComponent` owns its spacing (headers meant to sit flush
    // against the top used to fake it with -mt-10).
    return (
        <div
            className={cn(
                'custom-scrollbar relative flex h-screen w-internal-sidebar shrink-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain border-r border-neutral-200 bg-white',
                !sidebarComponent && 'gap-6 pb-5 pt-10'
            )}
        >
            {sidebarContent}
        </div>
    );
};
