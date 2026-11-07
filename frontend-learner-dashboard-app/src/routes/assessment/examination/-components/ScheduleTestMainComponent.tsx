import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useEffect, useState, useRef, useCallback } from "react";
import ScheduleTestTabList from "./ScheduleTestTabList";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { assessmentTypes, Assessment } from "@/types/assessment";
import {
  fetchAssessmentData,
  fetchAssessmentFolderList,
} from "../-utils.ts/useFetchAssessment";
import { AssessmentCard } from "../-components/AssessmentCard";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { EmptyState, LoadErrorState } from "@/components/design-system/states";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveListView, type RequestStatus } from "@/lib/list-status";
import { Exam } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import {
  getAssessmentFoldersEnabled,
  OTHERS_FOLDER_ID,
  type LearnerFolderList,
} from "@/services/assessment-folders";
import {
  AssessmentFolderGrid,
  AssessmentFolderHeader,
} from "./AssessmentFolderGrid";

const NO_COUNTS: Record<string, number> = {};

/** Stands in for AssessmentCard, so the list keeps its shape when the tests arrive. */
const AssessmentListSkeleton = () => (
  <div className="flex flex-col gap-4" role="status" aria-live="polite">
    {[0, 1, 2].map((i) => (
      <Card key={i} className="flex w-full flex-col gap-stack p-4 sm:p-5">
        <Skeleton className="h-6 w-16 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-11 w-full sm:w-36 sm:self-end" />
      </Card>
    ))}
  </div>
);

const AssessmentListView = ({
  assessment_types,
  folderId,
  header,
}: {
  assessment_types: "HOMEWORK" | "ASSESSMENT";
  /** Only this folder's tests (or OTHERS_FOLDER_ID); undefined = all. */
  folderId?: string;
  /** Shown above the tabs, e.g. the open folder with a back button. */
  header?: React.ReactNode;
}) => {
  const { t } = useTranslation("assessment");
  const setNavHeading = useNavHeadingStore((s) => s.setNavHeading);
  const [selectedTab, setSelectedTab] = useState<assessmentTypes>(
    assessmentTypes.LIVE
  );
  const [assessmentData, setAssessmentData] = useState<{
    [key in assessmentTypes]: Assessment[];
  }>({
    [assessmentTypes.LIVE]: [],
    [assessmentTypes.UPCOMING]: [],
    [assessmentTypes.PAST]: [],
  });
  const [totalCounts, setTotalCounts] = useState<{
    [key in assessmentTypes]: number;
  }>({
    [assessmentTypes.LIVE]: 0,
    [assessmentTypes.UPCOMING]: 0,
    [assessmentTypes.PAST]: 0,
  });
  const [hasMorePages, setHasMorePages] = useState<{
    [key in assessmentTypes]: boolean;
  }>({
    [assessmentTypes.LIVE]: true,
    [assessmentTypes.UPCOMING]: true,
    [assessmentTypes.PAST]: true,
  });

  // Per tab: all three are fetched together and answer in any order.
  const [statusByTab, setStatusByTab] = useState<
    Record<assessmentTypes, RequestStatus>
  >({
    [assessmentTypes.LIVE]: "loading",
    [assessmentTypes.UPCOMING]: "loading",
    [assessmentTypes.PAST]: "loading",
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState<
    Partial<Record<assessmentTypes, boolean>>
  >({});
  const [page, setPage] = useState<{ [key in assessmentTypes]: number }>({
    [assessmentTypes.LIVE]: 0,
    [assessmentTypes.UPCOMING]: 0,
    [assessmentTypes.PAST]: 0,
  });

  const inFlightRef = useRef<Partial<Record<assessmentTypes, boolean>>>({});
  const loadingMoreRef = useRef(loadingMore);
  const hasMorePagesRef = useRef(hasMorePages);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  useEffect(() => {
    hasMorePagesRef.current = hasMorePages;
  }, [hasMorePages]);

  const observer = useRef<IntersectionObserver | null>(null);
  const pageSize = 5;

  const fetchMoreData = useCallback(
    async (tab: assessmentTypes, pageNum: number, isInitialLoad = false) => {
      if (
        inFlightRef.current[tab] ||
        (loadingMoreRef.current && !isInitialLoad) ||
        !hasMorePagesRef.current[tab]
      )
        return;

      inFlightRef.current[tab] = true;
      if (isInitialLoad) {
        setStatusByTab((prev) => ({ ...prev, [tab]: "loading" }));
      } else {
        setLoadingMore(true);
        setLoadMoreFailed((prev) => ({ ...prev, [tab]: false }));
      }

      try {
        const data = await fetchAssessmentData(
          pageNum,
          pageSize,
          tab,
          assessment_types,
          folderId
        );

        // A missing or malformed payload is a failed load, not an empty list,
        // and would otherwise crash inside React's setState updater.
        if (!data || !Array.isArray(data.content)) {
          throw new Error("Unexpected assessment list response");
        }

        setAssessmentData((prevData) => ({
          ...prevData,
          [tab]: isInitialLoad
            ? data.content
            : [...prevData[tab], ...data.content],
        }));

        setTotalCounts((prevCounts) => ({
          ...prevCounts,
          [tab]: data.total_elements,
        }));

        setHasMorePages((prev) => ({
          ...prev,
          [tab]: !data.last,
        }));

        setPage((prevPage) => ({
          ...prevPage,
          [tab]: pageNum + 1,
        }));

        if (isInitialLoad) {
          setStatusByTab((prev) => ({ ...prev, [tab]: "success" }));
        }
      } catch (error) {
        console.error(error);
        if (isInitialLoad) {
          setStatusByTab((prev) => ({ ...prev, [tab]: "error" }));
        } else {
          setLoadMoreFailed((prev) => ({ ...prev, [tab]: true }));
        }
      } finally {
        inFlightRef.current[tab] = false;
        if (!isInitialLoad) setLoadingMore(false);
      }
    },
    [assessment_types, folderId]
  );

  const fetchAllTabsData = useCallback(() => {
    Object.values(assessmentTypes).forEach((tab) => {
      fetchMoreData(tab, 0, true);
    });
  }, [fetchMoreData]);

  useEffect(() => {
    const nextHeading =
      assessment_types === "ASSESSMENT"
        ? t("scheduleTest.navHeading.assessment")
        : t("scheduleTest.navHeading.homework");
    setNavHeading(nextHeading);
  }, [assessment_types, setNavHeading, t]);

  useEffect(() => {
    fetchAllTabsData();
  }, [fetchAllTabsData]);

  const retryFailedTabs = () => {
    Object.values(assessmentTypes)
      .filter((tab) => statusByTab[tab] === "error")
      .forEach((tab) => fetchMoreData(tab, 0, true));
  };

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loadingMore || !hasMorePages[selectedTab]) return;
      if (observer.current) observer.current.disconnect();
      // Waits for the Retry below; re-observing would refetch in a loop.
      if (loadMoreFailed[selectedTab]) return;
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          fetchMoreData(selectedTab, page[selectedTab]);
        }
      });
      if (node) observer.current.observe(node);
    },
    [loadingMore, loadMoreFailed, selectedTab, page, hasMorePages, fetchMoreData]
  );

  const listView = resolveListView(
    statusByTab[selectedTab],
    assessmentData[selectedTab].length
  );

  return (
    <div className="w-full space-y-6">
      {header}
      <Tabs
        value={selectedTab}
        onValueChange={(tab) => {
          setSelectedTab(tab as assessmentTypes);
        }}
        className="w-full"
      >
        <ScheduleTestTabList
          selectedTab={selectedTab}
          totalAssessments={totalCounts}
        />

        <TabsContent
          key={selectedTab}
          value={selectedTab}
          className="mt-6 flex flex-col gap-4 focus-visible:outline-none"
        >
          {listView === "loading" && <AssessmentListSkeleton />}

          {listView === "error" && (
            <LoadErrorState
              title={
                assessment_types === "HOMEWORK"
                  ? t("scheduleTest.loadError.homework")
                  : t("scheduleTest.loadError.assessment")
              }
              onRetry={retryFailedTabs}
            />
          )}

          {listView === "data" &&
            assessmentData[selectedTab].map((assessment, index) => {
              if (index === assessmentData[selectedTab].length - 1) {
                return (
                  <div ref={lastElementRef} key={assessment.assessment_id}>
                    <AssessmentCard
                      assessmentInfo={assessment}
                      assessmentType={selectedTab}
                      assessment_types={assessment_types}
                    />
                  </div>
                );
              }
              return (
                <AssessmentCard
                  key={assessment.assessment_id}
                  assessmentInfo={assessment}
                  assessmentType={selectedTab}
                  assessment_types={assessment_types}
                />
              );
            })}

          {listView === "empty" && (
            <EmptyState
              icon={Exam}
              title={
                selectedTab === assessmentTypes.LIVE
                  ? t("scheduleTest.empty.live.title")
                  : selectedTab === assessmentTypes.UPCOMING
                    ? t("scheduleTest.empty.upcoming.title")
                    : t("scheduleTest.empty.past.title")
              }
              description={
                selectedTab === assessmentTypes.LIVE
                  ? t("scheduleTest.empty.live.description")
                  : selectedTab === assessmentTypes.UPCOMING
                    ? t("scheduleTest.empty.upcoming.description")
                    : t("scheduleTest.empty.past.description")
              }
              action={
                selectedTab === assessmentTypes.LIVE
                  ? {
                      label: t("scheduleTest.empty.live.action"),
                      onClick: () => setSelectedTab(assessmentTypes.UPCOMING),
                    }
                  : undefined
              }
            />
          )}

          {loadingMore && (
            <div className="py-4 flex flex-col items-center gap-2">
              <div className="text-sm text-muted-foreground">
                {t("scheduleTest.loading.more")}
              </div>
              <DashboardLoader />
            </div>
          )}

          {listView === "data" && loadMoreFailed[selectedTab] && (
            <LoadErrorState
              compact
              title={t("scheduleTest.loadError.more")}
              onRetry={() => fetchMoreData(selectedTab, page[selectedTab])}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

type FolderView =
  | { mode: "loading"; foldersOn?: boolean }
  | { mode: "flat" }
  | { mode: "grid"; data: LearnerFolderList }
  | { mode: "folder"; data: LearnerFolderList | null };

/**
 * The learner's assessments. With assessment folders turned on (and at least one
 * folder holding a test for this learner) it opens on the folder cards; `folderId`
 * (from `?folderId=`) shows one folder's tests with the usual tabs.
 */
export const ScheduleTestMainComponent = ({
  assessment_types,
  folderId,
}: {
  assessment_types: "HOMEWORK" | "ASSESSMENT";
  folderId?: string;
}) => {
  const { t } = useTranslation("assessment");
  const navigate = useNavigate();
  const setNavHeading = useNavHeadingStore((s) => s.setNavHeading);
  const foldersApply = assessment_types === "ASSESSMENT";
  const [view, setView] = useState<FolderView>(
    foldersApply ? { mode: "loading" } : { mode: "flat" }
  );

  useEffect(() => {
    if (!foldersApply) return;
    let cancelled = false;
    (async () => {
      const enabled = await getAssessmentFoldersEnabled();
      if (!enabled) {
        if (!cancelled) setView({ mode: "flat" });
        return;
      }
      if (!cancelled) {
        setView((v) => (v.mode === "loading" ? { mode: "loading", foldersOn: true } : v));
      }
      let data: LearnerFolderList | null = null;
      try {
        data = await fetchAssessmentFolderList(assessment_types);
      } catch (error) {
        console.error("Failed to load assessment folders", error);
      }
      if (cancelled) return;
      if (folderId) setView({ mode: "folder", data });
      else if (data && data.folders.length > 0) setView({ mode: "grid", data });
      else setView({ mode: "flat" });
    })();
    return () => {
      cancelled = true;
    };
  }, [foldersApply, assessment_types, folderId]);

  useEffect(() => {
    if (view.mode === "grid") setNavHeading(t("scheduleTest.navHeading.assessment"));
  }, [view.mode, setNavHeading, t]);

  const openFolder = (id: string | undefined) =>
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, folderId: id }),
    });

  if (view.mode === "loading") {
    // Folder cards are about to take over: tabs here would appear only to vanish.
    if (view.foldersOn && !folderId) return <AssessmentListSkeleton />;
    // The frame AssessmentListView draws, so nothing moves when it takes over.
    return (
      <Tabs value={assessmentTypes.LIVE} className="w-full">
        <div className="pointer-events-none">
          <ScheduleTestTabList selectedTab={assessmentTypes.LIVE} totalAssessments={NO_COUNTS} />
        </div>
        <div className="mt-6">
          <AssessmentListSkeleton />
        </div>
      </Tabs>
    );
  }

  if (view.mode === "grid") {
    // Folder cards first; tests that are in no folder follow in the usual tabs.
    return (
      <div className="flex flex-col gap-8">
        <AssessmentFolderGrid data={view.data} onOpen={openFolder} />
        {view.data.unfiled_count > 0 ? (
          <AssessmentListView
            assessment_types={assessment_types}
            folderId={OTHERS_FOLDER_ID}
            header={
              <h2 className="text-h3 font-semibold text-foreground">
                {t("scheduleTest.folders.otherTests")}
              </h2>
            }
          />
        ) : null}
      </div>
    );
  }

  if (view.mode === "folder" && folderId) {
    const isOthers = folderId === OTHERS_FOLDER_ID;
    const folder = view.data?.folders.find((f) => f.id === folderId);
    return (
      <AssessmentListView
        assessment_types={assessment_types}
        folderId={folderId}
        header={
          <AssessmentFolderHeader
            name={
              isOthers
                ? t("scheduleTest.folders.others")
                : (folder?.name ?? t("scheduleTest.folders.fallbackName"))
            }
            imageUrl={folder?.image_url}
            count={isOthers ? view.data?.unfiled_count : folder?.assessment_count}
            isOthers={isOthers}
            onBack={() => openFolder(undefined)}
          />
        }
      />
    );
  }

  return <AssessmentListView assessment_types={assessment_types} />;
};
