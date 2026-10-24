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
import { EmptyState } from "@/components/design-system/states";
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

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState<{ [key in assessmentTypes]: number }>({
    [assessmentTypes.LIVE]: 0,
    [assessmentTypes.UPCOMING]: 0,
    [assessmentTypes.PAST]: 0,
  });

  const loadingRef = useRef(loading);
  const loadingMoreRef = useRef(loadingMore);
  const hasMorePagesRef = useRef(hasMorePages);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

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
        loadingRef.current ||
        (loadingMoreRef.current && !isInitialLoad) ||
        !hasMorePagesRef.current[tab]
      )
        return;

      setLoading(isInitialLoad);
      setLoadingMore(!isInitialLoad);

      try {
        const data = await fetchAssessmentData(
          pageNum,
          pageSize,
          tab,
          assessment_types,
          folderId
        );

        // Defense-in-depth: even with the upstream catch fixed, a missing
        // or malformed payload would crash inside React's setState updater
        // (a hard render error, not a recoverable toast). Bail instead.
        if (!data || !Array.isArray(data.content)) {
          return;
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
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
        setLoadingMore(false);
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
    fetchAllTabsData();
  }, [assessment_types, fetchAllTabsData, setNavHeading, t]);

  const lastElementRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loadingMore || !hasMorePages[selectedTab]) return;
      if (observer.current) observer.current.disconnect();
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          fetchMoreData(selectedTab, page[selectedTab]);
        }
      });
      if (node) observer.current.observe(node);
    },
    [loadingMore, selectedTab, page, hasMorePages, fetchMoreData]
  );

  if (loading) {
    return <DashboardLoader />;
  }

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
          {assessmentData[selectedTab].length > 0 ? (
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
            })
          ) : (
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

          {loading && (
            <div className="text-center text-muted-foreground py-8">{t("scheduleTest.loading.assessments")}</div>
          )}

          {loadingMore && (
            <div className="py-4 flex flex-col items-center gap-2">
              <div className="text-sm text-muted-foreground">
                {t("scheduleTest.loading.more")}
              </div>
              <DashboardLoader />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

type FolderView =
  | { mode: "loading" }
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

  if (view.mode === "loading") return <DashboardLoader />;

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
