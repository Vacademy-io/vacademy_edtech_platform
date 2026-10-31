import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { useTranslation } from "react-i18next";
import { useEffect, useState, useCallback } from "react";
import { PullToRefreshWrapper } from "@/components/design-system/pull-to-refresh";
import { fetchStudyLibraryDetails } from "@/services/study-library/getStudyLibraryDetails";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toTitleCase } from "@/lib/utils";
import {
  CaretDown,
  CaretRight,
  Folder,
  FileText,
  PresentationChart,
  TreeStructure,
  FolderOpen,
} from "@phosphor-icons/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { fetchModulesWithChaptersPublic } from "@/services/study-library/getModulesWithChapters";
import { SubjectType } from "@/stores/study-library/use-study-library-store";
import { useMutation } from "@tanstack/react-query";
import {
  fetchSlidesByChapterId,
  Slide,
} from "@/hooks/study-library/use-slides-public";
import { Button } from "@/components/ui/button";
import { TabType } from "@/components/common/study-library/level-material/subject-material/-constants/constant";
import { getIcon } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/chapter-sidebar-slides";
import { getSubjectDetails } from "../-utils/helper";
import { CourseDetailsFormValues } from "./course-details-schema";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";

// Course-structure data contract — shared with the other course-details view so
// the two cannot drift on the server payload. Re-exported because existing call
// sites import these types from this module.
import type {
  Chapter,
  ChapterMetadata,
  Module,
  ModuleWithChapters,
  SubjectModulesMap,
} from "@/types/course-structure";
export type {
  Chapter,
  ChapterMetadata,
  Module,
  ModuleWithChapters,
  SubjectModulesMap,
};

export const CourseStructureDetails = ({
  selectedSession,
  selectedLevel,
  courseStructure,
  courseData,
  packageSessionId,
  onModulesLoadingChange,
}: {
  selectedSession: string;
  selectedLevel: string;
  courseStructure: number;
  courseData: CourseDetailsFormValues;
  packageSessionId: string;
  onModulesLoadingChange?: (loading: boolean) => void;
}) => {
  // courseStructure value: ${courseStructure}
  const { t } = useTranslation("coursesRouteB");
  const { setNavHeading } = useNavHeadingStore();

  const [studyLibraryData, setStudyLibraryData] = useState<SubjectType[]>([]);

  const [selectedTab, setSelectedTab] = useState<string>(TabType.OUTLINE);
  const handleTabChange = (value: string) => setSelectedTab(value);
  const [subjectModulesMap, setSubjectModulesMap] = useState<SubjectModulesMap>(
    {}
  );
  const [slidesMap, setSlidesMap] = useState<Record<string, Slide[]>>({});
  const [thumbUrlById, setThumbUrlById] = useState<Record<string, string>>({});

  // Loading state management
  const [isLoading, setIsLoading] = useState(false);

  // Memoized callback for loading state changes
  const handleLoadingChange = useCallback(
    (loading: boolean) => {
      setIsLoading(loading);
      if (onModulesLoadingChange) {
        onModulesLoadingChange(loading);
      }
    },
    [onModulesLoadingChange]
  );

  // Update loading state for parent component
  useEffect(() => {
    handleLoadingChange(isLoading);
  }, [isLoading, handleLoadingChange]);

  const getSlidesWithChapterId = async (chapterId: string) => {
    // Avoid duplicate fetch
    if (slidesMap[chapterId]) return;

    try {
      const slides = await fetchSlidesByChapterId(chapterId);
      setSlidesMap((prev) => ({ ...prev, [chapterId]: slides }));
    } catch (err) {
      console.log(err);
    }
  };

  const useModulesMutation = () => {
    return useMutation({
      mutationFn: async ({
        subjects: currentSubjects,
      }: {
        subjects: SubjectType[];
      }) => {
        const results = await Promise.all(
          currentSubjects?.map(async (subject) => {
            const res = await fetchModulesWithChaptersPublic(
              subject.id,
              packageSessionId
            );
            return { subjectId: subject.id, modules: res };
          })
        );

        const modulesMap: SubjectModulesMap = {};
        results.forEach(({ subjectId, modules }) => {
          modulesMap[subjectId] = modules;
        });

        return modulesMap;
      },
    });
  };

  const { mutateAsync: fetchModules } = useModulesMutation();

  const refreshData = async () => {
    const data = await fetchStudyLibraryDetails(packageSessionId);
    setStudyLibraryData(data);
  };

  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());

  const toggleOpenState = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>
  ) => {
    setter((prev) => {
      const updated = new Set(prev);
      if (updated.has(id)) {
        updated.delete(id);
      } else {
        updated.add(id);
      }
      return new Set(updated); // ensure a new Set reference
    });
  };

  const toggleSubject = (id: string) => toggleOpenState(id, setOpenSubjects);
  const toggleModule = (id: string) => toggleOpenState(id, setOpenModules);
  const toggleChapter = (id: string) => toggleOpenState(id, setOpenChapters);

  // Expand all functionality
  const expandAll = () => {
    if (!studyLibraryData) return;

    const allSubjectIds = new Set<string>(
      studyLibraryData.map((s: SubjectType) => s.id)
    );
    const allModuleIds = new Set<string>();
    const allChapterIds = new Set<string>();

    Object.values(subjectModulesMap).forEach((modules) => {
      modules.forEach((mod) => {
        allModuleIds.add(mod.module.id);
        mod.chapters.forEach((ch) => {
          allChapterIds.add(ch.id);
          // Load slides for each chapter
          getSlidesWithChapterId(ch.id);
        });
      });
    });

    setOpenSubjects(allSubjectIds);
    setOpenModules(allModuleIds);
    setOpenChapters(allChapterIds);
  };

  const collapseAll = () => {
    setOpenSubjects(new Set());
    setOpenModules(new Set());
    setOpenChapters(new Set());
  };

  const isAllExpanded =
    studyLibraryData?.every((subject: SubjectType) =>
      openSubjects.has(subject.id)
    ) &&
    Object.values(subjectModulesMap).every((modules) =>
      modules.every(
        (mod) =>
          openModules.has(mod.module.id) &&
          mod.chapters.every((ch) => openChapters.has(ch.id))
      )
    );

  useEffect(() => {
    if (courseData && selectedSession && selectedLevel) {
      const subjects = getSubjectDetails(
        courseData,
        selectedSession,
        selectedLevel
      );
      setStudyLibraryData(subjects);
    }
  }, [courseData, selectedSession, selectedLevel]);

  useEffect(() => {
    // Don't call module-with-chapters API until packageSessionId is available from course-init
    if (!packageSessionId) return;

    const loadModules = async () => {
      try {
        setIsLoading(true);
        const modulesMap = await fetchModules({
          subjects: getSubjectDetails(
            courseData,
            selectedSession,
            selectedLevel
          ),
        });
        setSubjectModulesMap(modulesMap);

        // Auto-expand only the first item in each level
        const subjects = getSubjectDetails(
          courseData,
          selectedSession,
          selectedLevel
        );
        const firstSubjectId = subjects[0]?.id;

        if (firstSubjectId) {
          const firstSubjectModules = modulesMap[firstSubjectId] || [];
          const firstModuleId = firstSubjectModules[0]?.module.id;
          const firstChapterId = firstSubjectModules[0]?.chapters[0]?.id;

          const openSubjectsSet = new Set<string>([firstSubjectId]);
          const openModulesSet = new Set<string>();
          const openChaptersSet = new Set<string>();

          if (firstModuleId) {
            openModulesSet.add(firstModuleId);
          }
          if (firstChapterId) {
            openChaptersSet.add(firstChapterId);
            // Automatically load slides for the first opened chapter
            getSlidesWithChapterId(firstChapterId);
          }

          setOpenSubjects(openSubjectsSet);
          setOpenModules(openModulesSet);
          setOpenChapters(openChaptersSet);
        }
      } catch (error) {
        console.error("Failed to fetch modules:", error);
        setSubjectModulesMap({});
      } finally {
        setIsLoading(false);
      }
    };
    loadModules();
  }, [studyLibraryData, packageSessionId, fetchModules]);

  // Prefetch thumbnails for subjects, modules, and chapters
  useEffect(() => {
    const prefetchThumbnails = async () => {
      try {
        // [thumb] prefetch start - subjects: ${(studyLibraryData ?? []).length}, modules: ${Object.keys(subjectModulesMap).length}
        const updates: Record<string, string> = {};

        // Subjects
        for (const subject of studyLibraryData ?? []) {
          const key = `subject:${subject.id}`;
          const fileId = subject.thumbnail_id ?? undefined;
          // [thumb] subject candidate - key: ${key}, hasUrl: ${Boolean(thumbUrlById[key])}
          if (fileId && !thumbUrlById[key]) {
            try {
              const url = await getPublicUrlWithoutLogin(fileId);
              // [thumb] subject url fetched - key: ${key}
              if (url) updates[key] = url;
            } catch (err) {
              console.debug(
                "prefetchThumbnails: subject thumbnail fetch failed",
                err
              );
            }
          }
        }

        // Apply subject URL updates immediately
        if (Object.keys(updates).length > 0) {
          setThumbUrlById((prev) => ({ ...prev, ...updates }));
        }

        // Modules and Chapters
        Object.values(subjectModulesMap).forEach((mods) => {
          for (const mod of mods ?? []) {
            // Module thumbnail
            const moduleKey = `module:${mod.module.id}`;
            const moduleFileId =
              (mod.module as { thumbnail_id?: string | null }).thumbnail_id ??
              undefined;
            // [thumb] module candidate - key: ${moduleKey}, hasUrl: ${Boolean(thumbUrlById[moduleKey])}
            if (moduleFileId && !thumbUrlById[moduleKey]) {
              updates[moduleKey] = updates[moduleKey] || ""; // mark to fetch
            }

            // Chapters thumbnails
            for (const ch of mod.chapters ?? []) {
              const chapterKey = `chapter:${ch.id}`;
              const chapterFileId = ch.file_id ?? undefined;
              // [thumb] chapter candidate - key: ${chapterKey}, hasUrl: ${Boolean(thumbUrlById[chapterKey])}
              if (chapterFileId && !thumbUrlById[chapterKey]) {
                updates[chapterKey] = updates[chapterKey] || ""; // mark to fetch
              }
            }
          }
        });

        // Actually fetch pending updates
        const fetchPairs: Array<{ key: string; fileId: string }> = [];

        // Add module and chapter fetches
        Object.values(subjectModulesMap).forEach((mods) => {
          for (const mod of mods ?? []) {
            const moduleKey = `module:${mod.module.id}`;
            const moduleFileId =
              (mod.module as { thumbnail_id?: string | null }).thumbnail_id ??
              undefined;
            if (moduleFileId && !thumbUrlById[moduleKey]) {
              fetchPairs.push({ key: moduleKey, fileId: moduleFileId });
            }

            for (const ch of mod.chapters ?? []) {
              const chapterKey = `chapter:${ch.id}`;
              const chapterFileId = ch.file_id ?? undefined;
              if (chapterFileId && !thumbUrlById[chapterKey]) {
                fetchPairs.push({ key: chapterKey, fileId: chapterFileId });
              }
            }
          }
        });

        // Deduplicate by key
        const seen = new Set<string>();
        const uniquePairs = fetchPairs.filter(({ key }) => {
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const results = await Promise.all(
          uniquePairs.map(async ({ key, fileId }) => {
            try {
              const url = await getPublicUrlWithoutLogin(fileId);
              // [thumb] fetched - key: ${key}
              return { key, url } as const;
            } catch (err) {
              console.debug(
                "prefetchThumbnails: module/chapter thumbnail fetch failed",
                err
              );
              return { key, url: "" } as const;
            }
          })
        );

        const finalUpdates: Record<string, string> = {};
        for (const { key, url } of results) {
          if (url) finalUpdates[key] = url;
        }

        if (Object.keys(finalUpdates).length > 0) {
          setThumbUrlById((prev) => ({ ...prev, ...finalUpdates }));
        }
      } catch (err) {
        console.debug("prefetchThumbnails: unexpected error", err);
      }
    };

    prefetchThumbnails();
  }, [studyLibraryData, subjectModulesMap]);

  useEffect(() => {
    setStudyLibraryData(
      getSubjectDetails(courseData, selectedSession, selectedLevel)
    );
  }, [selectedSession, selectedLevel]);

  useEffect(() => {
    setNavHeading(
      <div className="flex items-center gap-2">
        <div>
          {t("courseStructure.navHeading", {
            course: getTerminology(ContentTerms.Course, SystemTerms.Course),
          })}
        </div>
      </div>
    );
  }, [t]);

  // Mount/unmount tracking removed for cleaner console

  useEffect(() => {
    setStudyLibraryData(
      getSubjectDetails(courseData, selectedSession, selectedLevel)
    );
  }, [selectedSession, selectedLevel]);

  const tabContent: Partial<Record<TabType, React.ReactNode>> = {
    [TabType.OUTLINE]: (
      <div className="space-y-4">
        {/* Expand/Collapse Controls */}
        <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
          <div className="flex items-center gap-2">
            <TreeStructure size={18} className="text-primary-600" />
            <span className="text-sm font-medium text-neutral-700">
              {t("courseStructure.heading", {
                course: getTerminology(ContentTerms.Course, SystemTerms.Course),
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={isAllExpanded ? collapseAll : expandAll}
              className="h-7 px-3 text-xs border-neutral-300 hover:border-primary-300 hover:bg-primary-50/50"
            >
              {isAllExpanded ? (
                <>
                  <FolderOpen size={14} className="me-1.5" />
                  {t("courseStructure.collapseAll")}
                </>
              ) : (
                <>
                  <Folder size={14} className="me-1.5" />
                  {t("courseStructure.expandAll")}
                </>
              )}
            </Button>
          </div>
        </div>
        <div className="max-w-2xl space-y-1.5">
          {courseStructure === 5 &&
            studyLibraryData?.map((subject: SubjectType, idx: number) => {
              const isSubjectOpen = openSubjects.has(subject.id);
              const baseIndent = "ps-struct-base";
              const subjectContentIndent = `${baseIndent} ps-6`;

              return (
                <Collapsible
                  key={subject.id}
                  open={isSubjectOpen}
                  onOpenChange={() => toggleSubject(subject.id)}
                >
                  <CollapsibleTrigger className="group flex w-full items-center rounded-lg px-3 py-2 text-start text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-primary-50/60 hover:border-primary-200/60 border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      {isSubjectOpen ? (
                        <CaretDown
                          size={18}
                          weight="bold"
                          className="shrink-0 text-neutral-500 group-hover:text-primary-600 transition-colors"
                        />
                      ) : (
                        <CaretRight
                          size={18}
                          weight="bold"
                          className="shrink-0 text-neutral-500 group-hover:text-primary-600 transition-colors"
                        />
                      )}
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold shrink-0">
                        {isSubjectOpen ? (
                          <FolderOpen size={12} />
                        ) : (
                          <Folder size={12} />
                        )}
                      </div>
                      {thumbUrlById[`subject:${subject.id}`] && (
                        <img
                          src={thumbUrlById[`subject:${subject.id}`]}
                          alt=""
                          className="w-6 h-6 rounded-sm object-cover border border-neutral-200"
                          onLoad={() => {
                            /* Image loaded successfully */
                          }}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}

                      <span
                        className="truncate font-medium group-hover:text-primary-700 transition-colors"
                        title={toTitleCase(subject.subject_name)}
                      >
                        {toTitleCase(subject.subject_name)}
                      </span>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent
                    className={`pb-1 pt-2 ${subjectContentIndent}`}
                  >
                    <div className="space-y-1 border-s-2 border-primary-200/60 ps-3 relative">
                      <div className="absolute start-0 top-0 w-0.5 h-full bg-primary-300/60"></div>
                      {(subjectModulesMap[subject.id] ?? []).map(
                        (mod, modIdx) => {
                          const isModuleOpen = openModules.has(mod.module.id);
                          const moduleContentIndent = `ps-struct-module`;
                          return (
                            <Collapsible
                              key={mod.module.id}
                              open={isModuleOpen}
                              onOpenChange={() => toggleModule(mod.module.id)}
                            >
                              <CollapsibleTrigger className="group flex w-full items-center rounded-md px-2.5 py-1.5 text-start text-sm font-medium text-neutral-600 transition-all duration-200 hover:bg-blue-50/70 hover:border-blue-200/60 border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  {isModuleOpen ? (
                                    <CaretDown
                                      size={16}
                                      className="shrink-0 text-neutral-500 group-hover:text-blue-600 transition-colors"
                                    />
                                  ) : (
                                    <CaretRight
                                      size={16}
                                      className="shrink-0 text-neutral-500 group-hover:text-blue-600 transition-colors"
                                    />
                                  )}
                                  <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-600 text-white">
                                    <FileText size={12} />
                                  </div>
                                  {thumbUrlById[`module:${mod.module.id}`] && (
                                    <img
                                      src={
                                        thumbUrlById[`module:${mod.module.id}`]
                                      }
                                      alt=""
                                      className="w-5 h-5 rounded-sm object-cover border border-neutral-200"
                                      onLoad={() =>
                                        console.log("[thumb] module img load", {
                                          id: mod.module.id,
                                        })
                                      }
                                      onError={(e) => {
                                        console.warn(
                                          "[thumb] module img error",
                                          {
                                            id: mod.module.id,
                                            src: e.currentTarget.src,
                                          }
                                        );
                                        e.currentTarget.style.display = "none";
                                      }}
                                    />
                                  )}

                                  <span
                                    className="truncate group-hover:text-blue-700 transition-colors"
                                    title={toTitleCase(mod.module.module_name)}
                                  >
                                    {toTitleCase(mod.module.module_name)}
                                  </span>
                                </div>
                              </CollapsibleTrigger>
                              <CollapsibleContent
                                className={`pb-1 pt-2 ${moduleContentIndent}`}
                              >
                                <div className="space-y-1 border-s-2 border-blue-200/60 ps-3 relative">
                                  <div className="absolute start-0 top-0 w-0.5 h-full bg-blue-300/60"></div>
                                  {mod.chapters.map((ch, chIdx) => {
                                    const isChapterOpen = openChapters.has(
                                      ch.id
                                    );
                                    const chapterContentIndent = `ps-struct-chapter`;
                                    return (
                                      <Collapsible
                                        key={ch.id}
                                        open={isChapterOpen}
                                        onOpenChange={() =>
                                          toggleChapter(ch.id)
                                        }
                                      >
                                        <CollapsibleTrigger className="group flex w-full items-center rounded px-2 py-1 text-start text-sm font-medium text-neutral-600 transition-all duration-200 hover:bg-indigo-50/70 hover:border-indigo-200/60 border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1">
                                          <div className="flex min-w-0 flex-1 items-center gap-2">
                                            {isChapterOpen ? (
                                              <CaretDown
                                                size={14}
                                                className="shrink-0 text-neutral-500 group-hover:text-indigo-600 transition-colors"
                                              />
                                            ) : (
                                              <CaretRight
                                                size={14}
                                                className="shrink-0 text-neutral-500 group-hover:text-indigo-600 transition-colors"
                                              />
                                            )}
                                            <div className="flex items-center justify-center w-4 h-4 rounded bg-indigo-600 text-white">
                                              <PresentationChart size={10} />
                                            </div>
                                            {thumbUrlById[
                                              `chapter:${ch.id}`
                                            ] && (
                                              <img
                                                src={
                                                  thumbUrlById[
                                                    `chapter:${ch.id}`
                                                  ]
                                                }
                                                alt=""
                                                className="w-4 h-4 rounded-sm object-cover border border-neutral-200"
                                                onLoad={() =>
                                                  console.log(
                                                    "[thumb] chapter img load",
                                                    { id: ch.id }
                                                  )
                                                }
                                                onError={(e) => {
                                                  console.warn(
                                                    "[thumb] chapter img error",
                                                    {
                                                      id: ch.id,
                                                      src: e.currentTarget.src,
                                                    }
                                                  );
                                                  e.currentTarget.style.display =
                                                    "none";
                                                }}
                                              />
                                            )}

                                            <span
                                              className="truncate group-hover:text-indigo-700 transition-colors"
                                              title={toTitleCase(
                                                ch.chapter_name
                                              )}
                                            >
                                              {toTitleCase(ch.chapter_name)}
                                            </span>
                                          </div>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent
                                          className={`pb-1 pt-2 ${chapterContentIndent}`}
                                        >
                                          <div className="space-y-1 border-s-2 border-gradient-to-b from-indigo-200/60 to-neutral-200/40 ps-3 relative">
                                            <div className="absolute start-0 top-0 w-0.5 h-full bg-indigo-300/80"></div>
                                            {slidesMap[ch.id]?.map(
                                              (slide, slideIdx) => (
                                                <div
                                                  key={slide.id}
                                                  className="group/item flex items-center gap-2 px-2 py-1.5 rounded text-sm text-neutral-600 hover:bg-purple-50/70 hover:border-purple-200/60 border border-transparent transition-all duration-200 hover:shadow-sm"
                                                >
                                                  <div className="flex items-center justify-center w-4 h-4 rounded bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                                                    {getIcon(slide, "4")}
                                                  </div>

                                                  <span
                                                    className="truncate group-hover/item:text-purple-700 transition-colors"
                                                    title={toTitleCase(
                                                      slide.title
                                                    )}
                                                  >
                                                    {toTitleCase(slide.title)}
                                                  </span>
                                                </div>
                                              )
                                            )}
                                          </div>
                                        </CollapsibleContent>
                                      </Collapsible>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        }
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          {courseStructure === 4 &&
            studyLibraryData?.map((subject: SubjectType) => {
              const isSubjectOpen = openSubjects.has(subject.id);
              return (
                <Collapsible
                  key={subject.id}
                  open={isSubjectOpen}
                  onOpenChange={() => toggleSubject(subject.id)}
                >
                  <CollapsibleContent className={`pb-1 pt-2 `}>
                    <div className="space-y-1 relative">
                      {(subjectModulesMap[subject.id] ?? []).map(
                        (mod, modIdx) => {
                          const isModuleOpen = openModules.has(mod.module.id);
                          const moduleContentIndent = `ps-struct-module`;
                          return (
                            <Collapsible
                              key={mod.module.id}
                              open={isModuleOpen}
                              onOpenChange={() => toggleModule(mod.module.id)}
                            >
                              <CollapsibleTrigger className="group flex w-full items-center rounded-md px-2.5 py-1.5 text-start text-sm font-medium text-neutral-600 transition-all duration-200 hover:bg-blue-50/70 hover:border-blue-200/60 border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  {isModuleOpen ? (
                                    <CaretDown
                                      size={16}
                                      className="shrink-0 text-neutral-500 group-hover:text-blue-600 transition-colors"
                                    />
                                  ) : (
                                    <CaretRight
                                      size={16}
                                      className="shrink-0 text-neutral-500 group-hover:text-blue-600 transition-colors"
                                    />
                                  )}
                                  <div className="flex items-center justify-center w-5 h-5 rounded bg-blue-600 text-white">
                                    <FileText size={12} />
                                  </div>
                                  {thumbUrlById[`module:${mod.module.id}`] && (
                                    <img
                                      src={
                                        thumbUrlById[`module:${mod.module.id}`]
                                      }
                                      alt=""
                                      className="w-5 h-5 rounded-sm object-cover border border-neutral-200"
                                    />
                                  )}

                                  <span
                                    className="truncate group-hover:text-blue-700 transition-colors"
                                    title={mod.module.module_name}
                                  >
                                    {mod.module.module_name}
                                  </span>
                                </div>
                              </CollapsibleTrigger>

                              <CollapsibleContent
                                className={`py-1 ${moduleContentIndent}`}
                              >
                                <div className="space-y-0.5 border-s-2 border-blue-200/40 ps-2.5 relative">
                                  <div className="absolute start-0 top-0 w-0.5 h-full bg-blue-300/60"></div>
                                  {(mod.chapters ?? []).map((ch, chIdx) => {
                                    const isChapterOpen = openChapters.has(
                                      ch.id
                                    );

                                    return (
                                      <Collapsible
                                        key={ch.id}
                                        open={isChapterOpen}
                                        onOpenChange={() => {
                                          toggleChapter(ch.id);
                                          getSlidesWithChapterId(ch.id);
                                        }}
                                      >
                                        <CollapsibleTrigger className="group flex w-full items-center rounded-md px-2 py-1 text-start text-sm text-neutral-600 transition-all duration-200 hover:bg-green-50/70 hover:border-green-200/60 border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-1">
                                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            {isChapterOpen ? (
                                              <CaretDown
                                                size={14}
                                                className="shrink-0 text-neutral-500 group-hover:text-green-600 transition-colors"
                                              />
                                            ) : (
                                              <CaretRight
                                                size={14}
                                                className="shrink-0 text-neutral-500 group-hover:text-green-600 transition-colors"
                                              />
                                            )}
                                            <div className="flex items-center justify-center w-4 h-4 rounded bg-green-600 text-white">
                                              <PresentationChart size={10} />
                                            </div>
                                            {thumbUrlById[
                                              `chapter:${ch.id}`
                                            ] && (
                                              <img
                                                src={
                                                  thumbUrlById[
                                                    `chapter:${ch.id}`
                                                  ]
                                                }
                                                alt=""
                                                className="w-4 h-4 rounded-sm object-cover border border-neutral-200"
                                              />
                                            )}
                                            \
                                            <span
                                              className="truncate group-hover:text-green-700 transition-colors text-xs"
                                              title={toTitleCase(
                                                ch.chapter_name
                                              )}
                                            >
                                              {toTitleCase(ch.chapter_name)}
                                            </span>
                                          </div>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <div className="space-y-px ms-5 border-s border-green-200/50 py-1 ps-2 relative">
                                            <div className="absolute start-0 top-0 w-px h-full bg-green-300/50"></div>
                                            {(slidesMap[ch.id] ?? []).length ===
                                            0 ? (
                                              <div className="text-xs px-2 py-1 text-neutral-400 italic bg-neutral-50/50 rounded">
                                                {t("courseStructure.noSlides")}
                                              </div>
                                            ) : (
                                              (slidesMap[ch.id] ?? []).map(
                                                (slide, sIdx) => (
                                                  <div
                                                    key={slide.id}
                                                    className="group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-neutral-500 rounded hover:bg-amber-50/60 hover:border-amber-200/40 border border-transparent transition-all duration-200"
                                                  >
                                                    <div className="shrink-0 group-hover:scale-110 transition-transform">
                                                      {getIcon(slide, "3")}
                                                    </div>
                                                    <span
                                                      className="truncate group-hover:text-amber-700 transition-colors"
                                                      title={slide.title}
                                                    >
                                                      {slide.title}
                                                    </span>
                                                  </div>
                                                )
                                              )
                                            )}
                                          </div>
                                        </CollapsibleContent>
                                      </Collapsible>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        }
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          {courseStructure === 3 &&
            studyLibraryData?.map((subject: SubjectType) => {
              const isSubjectOpen = openSubjects.has(subject.id);
              return (
                <Collapsible
                  key={subject.id}
                  open={isSubjectOpen}
                  onOpenChange={() => toggleSubject(subject.id)}
                >
                  <CollapsibleContent className={`pb-1 pt-2 `}>
                    <div className="space-y-1 relative">
                      {(subjectModulesMap[subject.id] ?? []).map((mod) => {
                        const isModuleOpen = openModules.has(mod.module.id);
                        return (
                          <Collapsible
                            key={mod.module.id}
                            open={isModuleOpen}
                            onOpenChange={() => toggleModule(mod.module.id)}
                          >
                            <CollapsibleContent className={`py-1`}>
                              <div className="space-y-0.5">
                                {(mod.chapters ?? []).map((ch, chIdx) => {
                                  const isChapterOpen = openChapters.has(ch.id);

                                  return (
                                    <Collapsible
                                      key={ch.id}
                                      open={isChapterOpen}
                                      onOpenChange={() => {
                                        toggleChapter(ch.id);
                                        getSlidesWithChapterId(ch.id);
                                      }}
                                    >
                                      <CollapsibleTrigger className="group flex w-full items-center rounded-md px-2 py-1 text-start text-sm text-neutral-600 transition-all duration-200 hover:bg-green-50/70 hover:border-green-200/60 border border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-1">
                                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                          {isChapterOpen ? (
                                            <CaretDown
                                              size={14}
                                              className="shrink-0 text-neutral-500 group-hover:text-green-600 transition-colors"
                                            />
                                          ) : (
                                            <CaretRight
                                              size={14}
                                              className="shrink-0 text-neutral-500 group-hover:text-green-600 transition-colors"
                                            />
                                          )}
                                          <div className="flex items-center justify-center w-4 h-4 rounded bg-green-600 text-white">
                                            <PresentationChart size={10} />
                                          </div>

                                          <span
                                            className="truncate group-hover:text-green-700 transition-colors text-xs"
                                            title={toTitleCase(ch.chapter_name)}
                                          >
                                            {toTitleCase(ch.chapter_name)}
                                          </span>
                                        </div>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent>
                                        <div className="space-y-px ms-5 border-s border-green-200/50 py-1 ps-2 relative">
                                          <div className="absolute start-0 top-0 w-px h-full bg-green-300/50"></div>
                                          {(slidesMap[ch.id] ?? []).length ===
                                          0 ? (
                                            <div className="text-xs px-2 py-1 text-neutral-400 italic bg-neutral-50/50 rounded">
                                              {t("courseStructure.noSlides")}
                                            </div>
                                          ) : (
                                            (slidesMap[ch.id] ?? []).map(
                                              (slide, sIdx) => (
                                                <div
                                                  key={slide.id}
                                                  className="group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-neutral-500 rounded hover:bg-amber-50/60 hover:border-amber-200/40 border border-transparent transition-all duration-200"
                                                >
                                                  <div className="shrink-0 group-hover:scale-110 transition-transform">
                                                    {getIcon(slide, "3")}
                                                  </div>
                                                  <span
                                                    className="truncate group-hover:text-amber-700 transition-colors"
                                                    title={slide.title}
                                                  >
                                                    {slide.title}
                                                  </span>
                                                </div>
                                              )
                                            )
                                          )}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}

          {courseStructure === 2 &&
            studyLibraryData?.map((subject: SubjectType) => {
              const isSubjectOpen = openSubjects.has(subject.id);
              return (
                <Collapsible
                  key={subject.id}
                  open={isSubjectOpen}
                  onOpenChange={() => toggleSubject(subject.id)}
                >
                  <CollapsibleContent className={`pb-1 pt-2 `}>
                    <div className="space-y-1 relative">
                      {(subjectModulesMap[subject.id] ?? []).map((mod) => {
                        const isModuleOpen = openModules.has(mod.module.id);
                        return (
                          <Collapsible
                            key={mod.module.id}
                            open={isModuleOpen}
                            onOpenChange={() => toggleModule(mod.module.id)}
                          >
                            <CollapsibleContent className={`py-1`}>
                              <div className="space-y-0.5">
                                {(mod.chapters ?? []).map((ch) => {
                                  const isChapterOpen = openChapters.has(ch.id);

                                  return (
                                    <Collapsible
                                      key={ch.id}
                                      open={isChapterOpen}
                                      onOpenChange={() => {
                                        toggleChapter(ch.id);
                                        getSlidesWithChapterId(ch.id);
                                      }}
                                    >
                                      <CollapsibleContent>
                                        <div className="space-y-px ps-2 relative">
                                          {(slidesMap[ch.id] ?? []).length ===
                                          0 ? (
                                            <div className="text-xs px-2 text-neutral-400 italic bg-neutral-50/50 rounded">
                                              {t("courseStructure.noSlides")}
                                            </div>
                                          ) : (
                                            (slidesMap[ch.id] ?? []).map(
                                              (slide, sIdx) => (
                                                <div
                                                  key={slide.id}
                                                  className="group flex cursor-pointer items-center gap-1.5 px-2 py-1 text-xs text-neutral-500 rounded hover:bg-amber-50/60 hover:border-amber-200/40 border border-transparent transition-all duration-200"
                                                >
                                                  <div className="shrink-0 group-hover:scale-110 transition-transform">
                                                    {getIcon(slide, "3")}
                                                  </div>
                                                  <span
                                                    className="truncate group-hover:text-amber-700 transition-colors"
                                                    title={slide.title}
                                                  >
                                                    {slide.title}
                                                  </span>
                                                </div>
                                              )
                                            )
                                          )}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
        </div>
      </div>
    ),
  };

  return (
    <PullToRefreshWrapper onRefresh={refreshData}>
      <div className="flex size-full flex-col gap-0 rounded-lg bg-gradient-to-br from-neutral-50/50 to-white py-4 text-neutral-700">
        <Tabs
          value={selectedTab}
          onValueChange={handleTabChange}
          className="w-full overflow-scroll"
        >
          <TabsContent
            key={selectedTab}
            value={selectedTab}
            className="mt-0 rounded-lg bg-white border border-neutral-200/60 p-4"
          >
            {(selectedTab as TabType) === TabType.CONTENT_STRUCTURE
              ? tabContent[TabType.OUTLINE]
              : tabContent[selectedTab as TabType]}
          </TabsContent>
        </Tabs>
      </div>
    </PullToRefreshWrapper>
  );
};
