import { useDoubtSidebarStore } from "@/stores/study-library/doubt-sidebar-store";
import { X, ChatText } from "@phosphor-icons/react";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useSidebar } from "@/components/ui/sidebar";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
import { DoubtFilter, Doubt as DoubtType } from "../types/get-doubts-type";
import { useGetDoubts } from "../services/GetDoubts";
import { useTranslation } from "react-i18next";
import { DoubtList } from "./doubt-list";
import { DoubtComposer } from "./DoubtComposer";
import { TimestampDialog } from "./TimestampDialog";
import { MyButton } from "@/components/design-system/button";
import { getUserId } from "@/constants/getUserId";
import { getPackageSessionId } from "@/utils/study-library/get-list-from-stores/getPackageSessionId";
import { formatVideoTime } from "@/utils/study-library/tracking/formatVideoTime";
import { collectAuthorIds, useDoubtAuthors } from "../hooks/useDoubtAuthors";
import { cn } from "@/lib/utils";

type DoubtTab = "ALL" | "ACTIVE" | "RESOLVED";

// Doubts are scoped to one slide, so the window only exists to satisfy the API
// contract — keep it wide enough that a learner revisiting an old slide still
// sees the thread (the previous 30-day window silently hid older doubts).
const HISTORY_WINDOW_DAYS = 3650;

export const DoubtResolutionSidebar = () => {
  const { t } = useTranslation("studyContent");
  const { isOpen: open, closeSidebar, draft, clearDraft } = useDoubtSidebarStore();
  const [showInput, setShowInput] = useState<boolean>(false);
  const [doubt, setDoubt] = useState<string>("");
  const [showPositionDialog, setShowPositionDialog] = useState<boolean>(false);
  const [timestamp, setTimestamp] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<DoubtTab>("ALL");
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const { activeItem, setActiveItem, currentPackageSessionId } = useContentStore();
  const { setOpen: setChapterSidebarOpen } = useSidebar();
  const {
    currentPdfPage,
    currentYoutubeTime,
    currentUploadedVideoTime,
    navigateToPdfPage,
  } = useMediaRefsStore();
  const observer = useRef<IntersectionObserver | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const isVideo = activeItem?.source_type === "VIDEO";
  const isDocument = activeItem?.source_type === "DOCUMENT";
  const hasPosition = isVideo || isDocument;

  const [filter, setFilter] = useState<DoubtFilter>({
    name: "",
    start_date: new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    end_date: new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    user_ids: [],
    content_positions: [],
    content_types: [
      activeItem?.source_type == "DOCUMENT"
        ? activeItem?.document_slide?.type || ""
        : activeItem?.source_type || "",
    ],
    sources: ["SLIDE"],
    source_ids: [activeItem?.id || ""],
    // Both statuses come down in one query; the tabs filter in memory so
    // switching them is instant instead of re-fetching and flashing a loader.
    status: ["ACTIVE", "RESOLVED"],
    sort_columns: {
      created_at: "DESC",
    },
    batch_ids: [],
  });

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useGetDoubts(filter, open);

  const allDoubts: DoubtType[] = useMemo(
    () => data?.pages.flatMap((page) => page.content) ?? [],
    [data]
  );

  const counts = useMemo(
    () => ({
      all: allDoubts.length,
      active: allDoubts.filter((item) => item.status !== "RESOLVED").length,
      resolved: allDoubts.filter((item) => item.status === "RESOLVED").length,
    }),
    [allDoubts]
  );

  const visibleDoubts = useMemo(() => {
    if (tab === "RESOLVED") return allDoubts.filter((item) => item.status === "RESOLVED");
    if (tab === "ACTIVE") return allDoubts.filter((item) => item.status !== "RESOLVED");
    return allDoubts;
  }, [allDoubts, tab]);

  const authorIds = useMemo(() => collectAuthorIds(allDoubts), [allDoubts]);
  const authors = useDoubtAuthors(authorIds);

  useEffect(() => {
    getUserId().then(setViewerUserId);
  }, []);

  // Filter doubts by the course currently being viewed (the route's sessionId,
  // surfaced via the content store). Fall back to the learner's stored default
  // enrollment only when that isn't available, mirroring doubt creation.
  useEffect(() => {
    const applyBatchFilter = async () => {
      const id = currentPackageSessionId || (await getPackageSessionId());

      if (id) {
        setFilter((prev) => ({
          ...prev,
          batch_ids: [id],
        }));
      }
    };

    applyBatchFilter();
  }, [currentPackageSessionId]);

  useEffect(() => {
    setFilter((prev) => ({
      ...prev,
      source_ids: [activeItem?.id || ""],
      content_types: [
        activeItem?.source_type == "DOCUMENT"
          ? activeItem?.document_slide?.type || ""
          : activeItem?.source_type || "",
      ],
    }));
  }, [activeItem]);

  // Close on outside click / Escape, and lock page scroll behind the panel so a
  // phone doesn't scroll the slide underneath while the learner reads a thread.
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (sidebarRef.current?.contains(event.target as Node)) return;
      const target = event.target as Element;
      // Trigger button and any Radix dialog (delete confirm / position picker)
      // live outside the panel — clicking them must not close it.
      if (target.closest('[data-sidebar="trigger"]')) return;
      if (target.closest('[role="alertdialog"], [role="dialog"]')) return;
      closeSidebar();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let an open dialog take the Escape first. The panel itself carries
      // role="dialog", so it must not count as one.
      const otherDialogOpen = Array.from(
        document.querySelectorAll('[role="alertdialog"], [role="dialog"]')
      ).some((element) => element !== sidebarRef.current);
      if (otherDialogOpen) return;
      closeSidebar();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closeSidebar]);

  // Reset the open flag when the sidebar unmounts (e.g. navigating away with
  // it open) so consumers of the store (chatbot visibility) don't get stuck
  useEffect(() => {
    return () => {
      useDoubtSidebarStore.getState().closeSidebar();
    };
  }, []);

  // The infinite-scroll sentinel rides the last VISIBLE card, so a tab whose
  // matches all sit on a later page would have nothing to trigger it and would
  // wrongly read as empty. Pull the next page until this tab has something.
  useEffect(() => {
    if (!open) return;
    if (visibleDoubts.length > 0) return;
    if (allDoubts.length === 0) return;
    if (!hasNextPage || isFetchingNextPage) return;
    fetchNextPage();
  }, [
    open,
    visibleDoubts.length,
    allDoubts.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  const lastDoubtElementRef = useCallback(
    (node: HTMLDivElement) => {
      if (isLoading) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      });
      if (node) observer.current.observe(node);
    },
    [isLoading, hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  /** "1:02" for video, "Page 3" for a document, nothing for other slides. */
  const formatPosition = useCallback(
    (rawPosition?: number | null): string | undefined => {
      if (rawPosition === undefined || rawPosition === null || Number.isNaN(rawPosition)) {
        return undefined;
      }
      if (isVideo) return formatVideoTime(Math.floor(rawPosition / 1000));
      if (isDocument) return t("doubts.pageNumber", { page: rawPosition + 1 });
      return undefined;
    },
    [isVideo, isDocument, t]
  );

  const getPositionLabel = useCallback(
    (item: DoubtType) => formatPosition(parseInt(item.content_position || "0", 10)),
    [formatPosition]
  );

  /** Where the learner is right now — the default anchor for a new doubt. */
  const getCurrentPosition = useCallback((): number | undefined => {
    if (isDocument) return currentPdfPage;
    if (isVideo) {
      const seconds =
        activeItem?.video_slide?.source_type === "FILE_ID"
          ? currentUploadedVideoTime
          : currentYoutubeTime;
      return Math.floor((seconds || 0) * 1000);
    }
    return undefined;
  }, [
    isDocument,
    isVideo,
    activeItem?.video_slide?.source_type,
    currentPdfPage,
    currentUploadedVideoTime,
    currentYoutubeTime,
  ]);

  const handleAskDoubtClick = () => {
    // Pre-fill the position instead of gating the composer behind a dialog —
    // the learner can still change it from the chip.
    setTimestamp(getCurrentPosition());
    setShowInput(true);
  };

  // Started from a note: open the composer with its text and place filled in.
  useEffect(() => {
    if (!draft) return;
    // Plain text from a lesson, going into a rich-text editor.
    setDoubt(
      `<p>${draft.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
    );
    setTimestamp(draft.position);
    setShowInput(true);
    clearDraft();
  }, [draft, clearDraft]);

  const handleCancelComposer = () => {
    setShowInput(false);
    setDoubt("");
    setTimestamp(undefined);
  };

  const handleTimestampSet = (newTimestamp: number) => {
    setTimestamp(newTimestamp);
    setShowPositionDialog(false);
    setShowInput(true);
  };

  // A freshly posted doubt is ACTIVE and sorted first — show the learner it
  // landed even if they were on the Resolved tab or scrolled down the thread.
  const handleDoubtPosted = () => {
    setTimestamp(undefined);
    setTab((current) => (current === "RESOLVED" ? "ALL" : current));
    threadRef.current?.scrollTo({ top: 0 });
  };

  const handleJumpToPosition = (position: number) => {
    if (isDocument) {
      navigateToPdfPage(position);
    } else if (activeItem) {
      setActiveItem({
        ...activeItem,
        new_slide: false,
        percentage_completed: 0,
        progress_marker: position,
      });
    }
    setChapterSidebarOpen(false);
    // Get out of the way — the learner asked to look at that moment.
    closeSidebar();
  };

  // Portalled: the app's bottom tab bar shares this z-index and sits later in the
  // page, so inside the lesson it covered the "Ask a Doubt" button on phones.
  return createPortal(
    <>
      <div
        ref={sidebarRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("doubts.title")}
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 end-0 z-50 flex w-full flex-col border-s border-neutral-200 bg-white shadow-lg",
          "transition-transform duration-200 ease-out sm:w-vw-60 sm:min-w-reg-350 sm:max-w-reg-420 lg:w-vw-35",
          open
            ? "translate-x-0"
            : "pointer-events-none translate-x-full rtl:-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2.5 pt-[calc(env(safe-area-inset-top)+10px)]"> {/* design-lint-ignore: safe-area viewport math */}
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-500">
            <ChatText size={16} weight="fill" className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-subtitle font-semibold text-neutral-900">
              {t("doubts.title")}
            </h2>
            <p className="truncate text-2xs text-neutral-500">
              {activeItem?.title || t("doubts.onThisSlide")}
            </p>
          </div>
          <button
            type="button"
            onClick={closeSidebar}
            aria-label={t("doubts.close")}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filters + thread. TabsContent tracks the active value so exactly one
            list is mounted and the active trigger's aria-controls resolves. */}
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as DoubtTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-neutral-200 px-3 py-2">
            <TabsList className="h-9 w-full gap-0.5 bg-neutral-100 p-0.5">
              {(
                [
                  { value: "ALL", label: t("doubts.tabAllShort"), count: counts.all },
                  { value: "ACTIVE", label: t("doubts.tabPending"), count: counts.active },
                  { value: "RESOLVED", label: t("doubts.tabResolved"), count: counts.resolved },
                ] as const
              ).map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className="h-8 flex-1 gap-1 px-1.5 text-caption font-semibold text-neutral-600 data-[state=active]:bg-white data-[state=active]:text-neutral-900"
                >
                  <span className="truncate">{item.label}</span>
                  {item.count > 0 && (
                    <span className="font-semibold text-neutral-400">{item.count}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent
            ref={threadRef}
            value={tab}
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 py-3"
          >
            {isError ? (
              <div className="flex flex-col items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3">
                <p className="text-caption text-danger-600">{t("doubts.loadError")}</p>
                <MyButton
                  buttonType="secondary"
                  scale="small"
                  onClick={() => refetch()}
                  className="min-w-0 px-3"
                >
                  {t("doubts.retry")}
                </MyButton>
              </div>
            ) : (
              <DoubtList
                allDoubts={visibleDoubts}
                isLoading={isLoading}
                lastDoubtElementRef={lastDoubtElementRef}
                refetch={refetch}
                isFetchingNextPage={isFetchingNextPage}
                status={tab}
                authors={authors}
                viewerUserId={viewerUserId}
                sourceType={activeItem?.source_type}
                onJumpToPosition={handleJumpToPosition}
                getPositionLabel={getPositionLabel}
              />
            )}
          </TabsContent>
        </Tabs>

        {/* Composer */}
        <DoubtComposer
          open={showInput}
          doubt={doubt}
          setDoubt={setDoubt}
          onOpen={handleAskDoubtClick}
          onCancel={handleCancelComposer}
          refetch={refetch}
          setShowInput={setShowInput}
          timestamp={timestamp}
          positionLabel={hasPosition ? formatPosition(timestamp) : undefined}
          isDocument={isDocument}
          onEditPosition={() => setShowPositionDialog(true)}
          onPosted={handleDoubtPosted}
        />
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200"
          onClick={closeSidebar}
        />
      )}

      {hasPosition && (
        <TimestampDialog
          open={showPositionDialog}
          onOpenChange={setShowPositionDialog}
          onTimestampSet={handleTimestampSet}
          initialTimestamp={timestamp}
        />
      )}
    </>,
    document.body
  );
};
