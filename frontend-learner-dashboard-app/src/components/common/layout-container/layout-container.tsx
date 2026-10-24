import { MySidebar } from "./sidebar/mySidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { Navbar } from "./top-navbar.tsx/navbar";
import { cn } from "@/lib/utils";
import React, { useEffect, useState } from "react";
import useStore from "./sidebar/useSidebar";
import { ChatbotSidePanel } from "@/components/chatbot/ChatbotSidePanel";
import { useChatbotPanelStore } from "@/stores/chatbot/useChatbotPanelStore";
import { useChatbotContext } from "@/components/chatbot/useChatbotContext";
import { usePlayTheme } from "@/hooks/use-play-theme";
import { PlayBottomNav, PlayNavRail } from "./PlayBottomNav";
import { useCleanerPlayTheme } from "@/hooks/use-cleaner-play-theme";
import { getStudentDisplaySettings } from "@/services/student-display-settings";

interface LayoutContainerProps {
    children?: React.ReactNode;
    className?: string;
    sidebarComponent?: React.ReactNode;
    /** Let a custom sidebar that renders the institute itself replace the
     *  app sidebar's branding header rather than stack under it. */
    hideBrandingHeader?: boolean;
    /**
     * Enable the chatbot side panel for this layout.
     * When enabled, the chatbot will render as a docked panel on the right
     * instead of a floating overlay.
     */
    enableChatbotPanel?: boolean;
    /**
     * Bypass the centered max-w-screen-xl content contract for full-bleed
     * surfaces (slide viewer split panes, live-class embeds). Opted-out
     * routes keep the legacy m-3 md:m-5 spacing so they render exactly as
     * they did before the contract existed.
     */
    fullWidth?: boolean;
    /**
     * Pin the page to the viewport: the main column becomes exactly one
     * screen tall and the content wrapper a min-h-0 flex column, so a route
     * can give each of its panes its own scroll (tutor whiteboard, chat rail)
     * instead of growing the whole page. Implies fullWidth.
     */
    fillViewport?: boolean;
    /**
     * Distraction-free: no app sidebar, nav rail or top bar — the route owns
     * the whole viewport (Live AI Tutor lessons). Implies fillViewport.
     */
    immersive?: boolean;
}

export const LayoutContainer = ({
    children,
    className,
    sidebarComponent,
    hideBrandingHeader,
    enableChatbotPanel = true, // Docked panel enabled by default
    fullWidth = false,
    fillViewport: fillViewportProp = false,
    immersive = false,
}: LayoutContainerProps) => {
    const fillViewport = fillViewportProp || immersive;
    const { setHasCustomSidebar } = useStore();
    const { isOpen: chatbotIsOpen } = useChatbotContext();
    const { panelWidth, setIsDockedMode, viewMode, setViewMode } = useChatbotPanelStore();
    const [isMobile, setIsMobile] = useState(false);
    const isPlayTheme = usePlayTheme();
    const isCleanerPlayTheme = useCleanerPlayTheme();
    // Display settings can hide the standard sidebar app-wide
    // (sidebar.visible === false makes MySidebar render null). Track that
    // here so play mode can fill the desktop nav gap with PlayNavRail.
    const [standardSidebarHidden, setStandardSidebarHidden] = useState(false);

    useEffect(() => {
        if (!isPlayTheme && !isCleanerPlayTheme) return;
        let cancelled = false;
        getStudentDisplaySettings(false).then((settings) => {
            if (!cancelled) {
                setStandardSidebarHidden(settings?.sidebar?.visible === false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [isPlayTheme, isCleanerPlayTheme]);

    // Detect mobile viewport
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768); // md breakpoint
        };

        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    // Set docked mode based on enableChatbotPanel prop (and not mobile)
    useEffect(() => {
        setIsDockedMode(enableChatbotPanel && !isMobile);
        return () => setIsDockedMode(false);
    }, [enableChatbotPanel, isMobile, setIsDockedMode]);

    // Keyed on the BOOLEAN, not the element. `sidebarComponent` is a fresh JSX
    // element on every render of the owning route, so keying the effect on it
    // ran it — and wrote to the store twice — on every single render. zustand's
    // set() always allocates a new state object and notifies unconditionally,
    // so any subscriber that re-renders that route then builds a new element
    // and re-triggers this: an infinite update loop.
    const hasCustomSidebar = !!sidebarComponent;
    React.useEffect(() => {
        setHasCustomSidebar(hasCustomSidebar);
        return () => setHasCustomSidebar(false);
    }, [hasCustomSidebar, setHasCustomSidebar]);

    // Show the desktop panel only when enableChatbotPanel is true. Docked = a
    // right-hand column that takes width from the page; popup = a centered
    // overlay that leaves the page alone.
    const showDesktopPanel = enableChatbotPanel && chatbotIsOpen && !isMobile;
    const showDockedPanel = showDesktopPanel && viewMode !== "popup";
    const showPopupPanel = showDesktopPanel && viewMode === "popup";

    // Play desktop nav: sidebar hiding is institute-config driven (not
    // per-route), and the standard sidebar already renders its desktop
    // variant from md up. So the only nav-less desktop case is
    // "sidebar config-hidden + no custom sidebar" — render the play icon
    // rail exactly there (lg+ via CSS inside PlayNavRail) to avoid
    // double-nav everywhere else.
    const showPlayRail =
        (isPlayTheme || isCleanerPlayTheme) &&
        standardSidebarHidden &&
        !sidebarComponent;

    return (
        <>
            {!immersive && (
                <MySidebar
                    sidebarComponent={sidebarComponent}
                    hideBrandingHeader={hideBrandingHeader}
                />
            )}
            {showPlayRail && !immersive && <PlayNavRail />}
            <SidebarInset
                className={cn("overflow-x-hidden w-full", fillViewport && "h-svh max-h-svh overflow-hidden")}
                style={{
                    // Reduce content width when chatbot panel is open (desktop only)
                    marginRight: showDockedPanel ? `${panelWidth}px` : "0",
                    transition: "margin-right 0.2s ease-in-out",
                }}
            >
                {!immersive && <Navbar />}
                {/* One content contract for every routed page: centered, capped
                    at screen-xl, with a consistent gutter + top rhythm. Routes
                    that self-manage (className="!m-0 !p-0 max-w-none") still
                    win via twMerge/!important, and fullWidth keeps the legacy
                    spacing for split-pane/embed surfaces. */}
                <div
                    className={cn(
                        "overflow-x-hidden",
                        fillViewport
                            ? cn("flex min-h-0 flex-1 flex-col max-w-full", immersive ? "p-2 md:p-3" : "p-3 md:p-4")
                            : fullWidth
                              ? "m-3 md:m-5 max-w-full"
                              : "mx-auto w-full max-w-screen-xl px-4 py-4 sm:px-6 lg:px-8 lg:py-6",
                        (isPlayTheme || isCleanerPlayTheme) && isMobile && "pb-20",
                        className
                    )}
                >
                    {children}
                </div>
            </SidebarInset>
            {/* Docked Chatbot Side Panel - fixed position on the right */}
            {showDockedPanel && (
                <div
                    className="fixed top-0 end-0 h-screen z-50"
                    style={{ width: panelWidth }}
                >
                    <ChatbotSidePanel />
                </div>
            )}
            {/* Popup view: same panel, centered over a dimmed page. Clicking the
                backdrop docks it again rather than closing the conversation. */}
            {showPopupPanel && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm md:p-8"
                    onClick={() => setViewMode("docked")}
                >
                    <div
                        className="h-full w-full max-w-3xl overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/40"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <ChatbotSidePanel />
                    </div>
                </div>
            )}
            {/* Play + Cleaner Play: mobile bottom tab bar (skin-aware inside) */}
            {(isPlayTheme || isCleanerPlayTheme) && isMobile && <PlayBottomNav />}
        </>
    );
};


