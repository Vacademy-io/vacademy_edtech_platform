import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BASE_URL } from "@/constants/urls";
import {
  TreeStructure,
  CaretDown,
  CaretRight,
  Folder,
  FileText,
  PresentationChart,
  FolderOpen,
  FilePdf,
  FileDoc,
  Play,
  Question,
  ClipboardText,
  Exam,
} from "@phosphor-icons/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { getAuthoredChapterDescription } from "@/constants/chapter-description";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { SubjectTileGrid, ContentDrillCrumb } from "./SubjectTileGrid";

interface SubjectType {
  id: string;
  subject_name: string;
  subject_order: number;
  description: string;
  /** Media id for the subject artwork. The open init-details endpoint has
   *  always returned this; only the tile variant renders it. */
  thumbnail_id?: string | null;
}

interface Chapter {
  id: string;
  chapter_name: string;
  chapter_order: number;
  description: string;
  status: string;
  file_id: string | null;
}

interface Module {
  id: string;
  module_name: string;
  module_order: number;
  description: string;
  chapters: Chapter[];
  /** Media id for the module artwork, same as subjects. The raw API object is
   *  passed straight through, so this is present at runtime. */
  thumbnail_id?: string | null;
}

interface ModuleWithChapters {
  module: Module;
  module_order: number | null;
  chapters: Chapter[];
}

interface SubjectModulesMap {
  [subjectId: string]: ModuleWithChapters[];
}

interface Slide {
  id: string;
  title: string;
  slide_order: number;
  slide_type: string;
  description: string;
  file_id: string | null;
  status: string;
  source_type?: string;
  document_slide?: {
    type: string;
    title: string;
  };
  video_slide?: any;
  question_slide?: any;
  assignment_slide?: any;
  quiz_slide?: any;
}

interface CourseStructureDetailsProps {
  courseDepth: number;
  courseId: string;
  instituteId: string;
  packageSessionId: string;
  levelId?: string; // Add levelId parameter
  /**
   * How the top level reads.
   *
   * "tiles" draws the subjects as artwork cards — the same shape
   * the admin dashboard and the enrolled learner's Content Structure use — and
   * drills into one subject at a time beneath the grid. "outline" is the
   * folder-row tree, and the default here so that callers which do not read
   * the institute's learner settings keep what they always showed. The public
   * course page passes the variant those settings imply.
   *
   * Tiles apply only where there is a top level to tile: a depth-5 course with
   * at least one non-"default" subject. Everything shallower, and every course
   * whose subject layer is a single "default" row, renders the outline no
   * matter what is asked for.
   */
  variant?: "outline" | "tiles";
  /** False: no "Course Content (Modules & Slides)" line above the structure. Default true. */
  showContentHeading?: boolean;
}

export const CourseStructureDetails: React.FC<CourseStructureDetailsProps> = ({
  courseDepth,
  courseId,
  instituteId,
  packageSessionId,
  levelId,
  variant = "outline",
  showContentHeading = true,
}) => {
  const { t } = useTranslation("coursePlayerA");
  const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const moduleTerm = getTerminology(ContentTerms.Modules, SystemTerms.Modules);
  const chapterTerm = getTerminology(ContentTerms.Chapters, SystemTerms.Chapters);
  const chaptersTerm = getTerminologyPlural(ContentTerms.Chapters, SystemTerms.Chapters);
  const modulesTerm = getTerminologyPlural(ContentTerms.Modules, SystemTerms.Modules);
  const slidesTerm = getTerminologyPlural(ContentTerms.Slides, SystemTerms.Slides);
  const subjectTerm = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
  const subjectsTerm = getTerminologyPlural(ContentTerms.Subjects, SystemTerms.Subjects);
  const [isLoading, setIsLoading] = useState(true);
  const [studyLibraryData, setStudyLibraryData] = useState<SubjectType[]>([]);
  const [subjectModulesMap, setSubjectModulesMap] = useState<SubjectModulesMap>(
    {}
  );
  const [slidesMap, setSlidesMap] = useState<Record<string, Slide[]>>({});
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set());
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  // Subject artwork for the tile variant, resolved from thumbnail_id. Kept out
  // of the outline path entirely: that variant shows no images, so it should
  // not pay for a request per subject.
  const [subjectThumbs, setSubjectThumbs] = useState<Record<string, string>>({});
  // Which subject's contents the tile grid has drilled into. One at a time —
  // the panel sits under the grid, so two open subjects would push the second
  // one's content far from the card that opened it.
  const [openTileSubject, setOpenTileSubject] = useState<string | null>(null);
  // The module drilled into within the open subject, if any. Together these
  // two say which level the grid is showing: none, a subject, or a module.
  const [openTileModule, setOpenTileModule] = useState<string | null>(null);

  // Helper function to check if a name is "default"
  const isDefaultName = (name: string | undefined | null): boolean => {
    return name ? name.toLowerCase() === "default" : false;
  };

  // Function to get slide icon and color based on slide type
  const getSlideIcon = (slide: Slide) => {
    // Check for video slides first
    if (slide.video_slide) {
      return { Icon: Play, color: "text-red-500", label: t("courseStructureDetails.slideType.video") };
    }

    // Check for question slides
    if (slide.question_slide) {
      return { Icon: Question, color: "text-blue-500", label: t("courseStructureDetails.slideType.question") };
    }

    // Check for assignment slides
    if (slide.assignment_slide) {
      return {
        Icon: ClipboardText,
        color: "text-orange-500",
        label: t("courseStructureDetails.slideType.assignment"),
      };
    }

    // Check for quiz slides
    if (slide.quiz_slide) {
      return { Icon: Exam, color: "text-purple-500", label: t("courseStructureDetails.slideType.quiz") };
    }

    // Check for document slides
    if (slide.document_slide) {
      const docType = slide.document_slide.type;
      if (docType === "PDF") {
        return { Icon: FilePdf, color: "text-red-600", label: t("courseStructureDetails.slideType.pdf") };
      } else if (docType === "DOC" || docType === "DOCX" || docType === "HTML") {
        return { Icon: FileDoc, color: "text-blue-600", label: t("courseStructureDetails.slideType.document") };
      }
    }

    // Default fallback
    return { Icon: PresentationChart, color: "text-catalogue-text-muted", label: getTerminology(ContentTerms.Slides, SystemTerms.Slides) };
  };

  // Step 1: Fetch subjects from init-details API
  const fetchSubjectsFromInitDetails = async () => {
    try {
      const baseUrl = BASE_URL;
      const url = `${baseUrl}/admin-core-service/open/v1/learner-study-library/init-details?packageSessionId=${packageSessionId}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(
        "[CourseStructureDetails] Error fetching subjects data:",
        error
      );
      throw error;
    }
  };

  // Step 2: Fetch modules for subjectId and packageSessionId
  const fetchModules = async (subjectId: string) => {
    try {
      const baseUrl = BASE_URL;
      const url = `${baseUrl}/admin-core-service/open/v1/learner-study-library/modules-with-chapters?subjectId=${subjectId}&packageSessionId=${packageSessionId}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const modules = await response.json();

      if (Array.isArray(modules) && modules.length > 0) {
        // Debug the structure of modules
      }

      return modules || [];
    } catch (error) {
      console.error(
        "[CourseStructureDetails] Error fetching modules for subject",
        subjectId,
        ":",
        error
      );
      return [];
    }
  };

  // Step 3: Fetch slides for a chapter
  const fetchSlidesForChapter = async (chapterId: string) => {
    if (!chapterId || chapterId === null || chapterId === undefined) {
      return [];
    }

    try {
      const baseUrl = BASE_URL;
      const url = `${baseUrl}/admin-core-service/open/v1/learner-study-library/slides?chapterId=${chapterId}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const slides = await response.json();

      return slides || [];
    } catch (error) {
      console.error(
        "[CourseStructureDetails] Error fetching slides for chapter",
        chapterId,
        ":",
        error
      );
      return [];
    }
  };

  // Step 4: Fetch slides for a chapter (lazy loading - only when chapter is expanded)
  const getSlidesWithChapterId = async (chapterId: string) => {
    // Avoid duplicate fetch
    if (slidesMap[chapterId]) return;

    try {
      const baseUrl = BASE_URL;
      const slidesUrl = `${baseUrl}/admin-core-service/open/v1/learner-study-library/slides?chapterId=${chapterId}`;
      const response = await fetch(slidesUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const slides = await response.json();

      const filteredSlides = Array.isArray(slides) ? slides : [];
      setSlidesMap((prev) => ({ ...prev, [chapterId]: filteredSlides }));
    } catch (err) {
      console.error(
        "[CourseStructureDetails] Error fetching slides for chapter",
        chapterId,
        ":",
        err
      );
    }
  };

  // Load data based on course depth following proper API flow: init → modules → chapters → slides
  useEffect(() => {
    const loadData = async () => {
      if (!packageSessionId || !instituteId) return;

      try {
        setIsLoading(true);

        // Step 1: Fetch subjects from init-details API
        const subjectsData = await fetchSubjectsFromInitDetails();

        // Transform subjects data to SubjectType format
        const subjects: SubjectType[] = [];

        if (Array.isArray(subjectsData)) {
          subjectsData.forEach((subject: any, index: number) => {
            if (subject.id) {
              const transformedSubject: SubjectType = {
                id: subject.id,
                subject_name:
                  subject.subject_name ||
                  t("courseStructureDetails.unnamedSubject", { subject: subjectTerm, index: index + 1 }),
                subject_order: subject.subject_order || index,
                description: subject.description || "",
                // The API has always sent this; the transform used to drop it,
                // which left every tile on the artwork fallback even though
                // each subject has a real image.
                thumbnail_id: subject.thumbnail_id ?? null,
              };
              subjects.push(transformedSubject);
            }
          });
        }
        setStudyLibraryData(subjects);

        // Step 2: Fetch modules for each subject
        const modulesMap: SubjectModulesMap = {};

        if (subjects.length === 0) {
          // No subjects found - API calls will not proceed
        } else {
          for (const subject of subjects) {
            const modules = await fetchModules(subject.id);

            // Step 3: Process modules and fetch slides for each chapter
            const modulesWithChapters: ModuleWithChapters[] = [];
            for (const moduleItem of modules) {
              // The API response has structure: { module: {...}, chapters: [...] }
              const moduleData = moduleItem.module;
              const chapters = moduleItem.chapters || [];

              // Fetch slides for each chapter
              const chaptersWithSlides = [];
              for (const chapter of chapters) {
                const slides = await fetchSlidesForChapter(chapter.id);

                chaptersWithSlides.push({
                  ...chapter,
                  slides: slides || [],
                });
              }

              modulesWithChapters.push({
                module: moduleData, // Use the actual module data, not the wrapper
                chapters: chaptersWithSlides,
              });
            }

            modulesMap[subject.id] = modulesWithChapters;
          }
        }

        setSubjectModulesMap(modulesMap);

        // Debug: Count total chapters and modules
        let totalChapters = 0;
        let totalModules = 0;
        Object.values(modulesMap).forEach((modules) => {
          totalModules += modules.length;
          modules.forEach((module) => {
            totalChapters += module.chapters?.length || 0;
          });
        });

        // Step 3: Set up open states based on course depth
        if (courseDepth === 2) {
          // Depth 2: Only show slides - preload ALL slides immediately
          const newSlidesMap: Record<string, Slide[]> = {};
          const slideLoadPromises: Promise<void>[] = [];

          Object.values(modulesMap).forEach((modules) => {
            modules.forEach((mod) => {
              mod.chapters.forEach((ch) => {
                // Fetch slides directly and store in newSlidesMap
                const slidePromise = fetchSlidesForChapter(ch.id).then(
                  (slides) => {
                    newSlidesMap[ch.id] = slides;
                  }
                );
                slideLoadPromises.push(slidePromise);
              });
            });
          });

          // Wait for all slides to load before updating state
          await Promise.all(slideLoadPromises);
          setSlidesMap(newSlidesMap);
        } else if (courseDepth === 3) {
          // Depth 3: Show chapters and slides - preload slides same as depth 2
          const newSlidesMap: Record<string, Slide[]> = {};
          const slideLoadPromises: Promise<void>[] = [];

          Object.values(modulesMap).forEach((modules) => {
            modules.forEach((mod) => {
              mod.chapters.forEach((ch) => {
                const slidePromise = fetchSlidesForChapter(ch.id).then(
                  (slides) => {
                    newSlidesMap[ch.id] = slides;
                  }
                );
                slideLoadPromises.push(slidePromise);
              });
            });
          });

          await Promise.all(slideLoadPromises);
          setSlidesMap(newSlidesMap);
        }
      } catch (error) {
        console.error("[CourseStructureDetails] Error loading data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [courseDepth, packageSessionId, instituteId]);

  const toggleOpenState = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>
  ) => {
    setter((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Resolve subject artwork once the subjects land. Each id costs one request,
  // so this only runs for the tile variant, and a failure is silent: a card
  // without artwork still reads fine, and a broken image would read worse.
  useEffect(() => {
    if (variant !== "tiles" || studyLibraryData.length === 0) return;
    let cancelled = false;
    (async () => {
      const resolved: Record<string, string> = {};
      // Subjects and the modules under them share one map keyed by id, so the
      // nested grid needs no second lookup and no second round of requests.
      const targets: Array<{ id: string; fileId?: string | null }> =
        studyLibraryData.map((s) => ({ id: s.id, fileId: s.thumbnail_id }));
      for (const m of Object.values(subjectModulesMap).flat()) {
        const id = m.module?.id;
        if (id) targets.push({ id, fileId: m.module?.thumbnail_id });
      }
      await Promise.all(
        targets.map(async ({ id, fileId }) => {
          if (!fileId || subjectThumbs[id]) return;
          try {
            const url = await getPublicUrlWithoutLogin(fileId);
            if (url) resolved[id] = url;
          } catch {
            /* no artwork — the card falls back to a glyph */
          }
        }),
      );
      if (!cancelled && Object.keys(resolved).length > 0) {
        setSubjectThumbs((prev) => ({ ...prev, ...resolved }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // subjectThumbs is deliberately not a dep: it is what this effect writes,
    // and including it would re-run the whole prefetch on every resolved image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, studyLibraryData, subjectModulesMap]);

  // Toggle functions with lazy loading (like /courses route)
  const toggleSubject = (subjectId: string) => {
    toggleOpenState(subjectId, setOpenSubjects);
  };

  const toggleModule = (moduleId: string) => {
    toggleOpenState(moduleId, setOpenModules);
  };

  const toggleChapter = (chapterId: string) => {
    const isCurrentlyOpen = openChapters.has(chapterId);
    toggleOpenState(chapterId, setOpenChapters);
    // Load slides when chapter is expanded (if it wasn't open before)
    if (!isCurrentlyOpen) {
      getSlidesWithChapterId(chapterId);
    }
  };

  const expandAll = () => {
    const allSubjectIds = new Set(studyLibraryData.map((s) => s.id));
    const allModuleIds = new Set<string>();
    const allChapterIds = new Set<string>();

    // Collect all module and chapter IDs
    Object.values(subjectModulesMap).forEach((modules) => {
      modules.forEach((module) => {
        allModuleIds.add(module.module.id);
        module.chapters.forEach((chapter) => {
          allChapterIds.add(chapter.id);
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
    studyLibraryData.every((subject) => openSubjects.has(subject.id)) &&
    Object.values(subjectModulesMap).every((modules) =>
      modules.every(
        (module) =>
          openModules.has(module.module.id) &&
          module.chapters.every((chapter) => openChapters.has(chapter.id))
      )
    );

  const renderChapters = (module: ModuleWithChapters) => {
    const chapters = module.chapters || [];

    // Depth 5: Filter out "default" chapters (this function is used by depth 5's renderModules)
    const filteredChapters = chapters.filter(
      (chapter) => !isDefaultName(chapter.chapter_name)
    );

    if (filteredChapters.length === 0) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">
          {t("courseStructureDetails.noChaptersForModule", { chapters: chaptersTerm, module: moduleTerm })}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {filteredChapters.map((chapter, index) => (
          <Collapsible
            key={`${chapter.id}-${index}`}
            open={openChapters.has(chapter.id)}
            onOpenChange={() => toggleChapter(chapter.id)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
              >
                <FileText
                  size={16}
                  className="me-2 text-green-500 flex-shrink-0"
                />
                <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                  {chapter.chapter_name || t("courseStructureDetails.unnamedChapter", { chapter: chapterTerm })}
                </span>
                <div className="flex-shrink-0 ms-2">
                  {openChapters.has(chapter.id) ? (
                    <CaretDown size={16} />
                  ) : (
                    <CaretRight size={16} />
                  )}
                </div>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="ms-4 mt-2">
              {renderSlides(chapter.id)}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    );
  };

  const findChapterById = (chapterId: string): Chapter | undefined => {
    for (const modules of Object.values(subjectModulesMap)) {
      for (const moduleWithChapters of modules) {
        const match = (moduleWithChapters.chapters || []).find(
          (chapter) => chapter.id === chapterId
        );
        if (match) return match;
      }
    }
    return undefined;
  };

  // Author-entered chapter description, shown above the chapter's slides.
  // Mirrors how the module description is rendered one level up.
  const renderChapterDescription = (chapterId: string) => {
    const description = getAuthoredChapterDescription(
      findChapterById(chapterId)?.description
    );

    if (!description) return null;

    return (
      <div className="p-2 bg-catalogue-bg-subtle rounded-catalogue-xs text-sm text-catalogue-text-secondary mb-2 break-words">
        {description}
      </div>
    );
  };

  const renderSlideList = (chapterId: string) => {
    const slides = slidesMap[chapterId] || [];

    // If slides haven't been fetched yet, show loading state
    if (!slidesMap[chapterId]) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">{t("courseStructureDetails.loadingSlides", { slides: slidesTerm })}</div>
      );
    }

    if (slides.length === 0) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">
          {t("courseStructureDetails.noSlidesForChapter", { slides: slidesTerm, chapter: chapterTerm })}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {slides.map((slide, index) => {
          const { Icon, color, label } = getSlideIcon(slide);
          return (
            <div
              key={`${slide.id}-${index}`}
              className="flex items-center gap-2 p-2 border border-catalogue-border rounded-catalogue-md hover:bg-catalogue-bg-subtle overflow-hidden"
            >
              <Icon size={16} className={`flex-shrink-0 ${color}`} />
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-catalogue-text-primary break-words truncate">
                    {slide.title}
                  </span>
                  <span className="text-xs text-catalogue-text-muted whitespace-nowrap flex-shrink-0">
                    ({label})
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Wraps the slide list so every chapter row shows its description first —
  // all six chapter render paths go through here.
  const renderSlides = (chapterId: string) => (
    <>
      {renderChapterDescription(chapterId)}
      {renderSlideList(chapterId)}
    </>
  );

  const renderModules = (subjectId: string) => {
    const modules = subjectModulesMap[subjectId] || [];

    // Depth 5: Filter out "default" modules
    const filteredModules = modules.filter(
      (moduleWithChapters) =>
        !isDefaultName(moduleWithChapters.module?.module_name)
    );

    if (filteredModules.length === 0) return null;

    // Tiles carry down to modules. Chapters below stay as rows: they carry
    // slide counts and run long, so a third grid would cost more scrolling
    // than the pictures are worth.
    if (variant === "tiles") {
      const openModule = filteredModules.find(
        (m) => m.module?.id === openTileModule,
      );
      if (openModule) return renderChapters(openModule);
      return (
        <SubjectTileGrid
          dense
          items={filteredModules.map((m) => ({
            id: m.module.id,
            name:
              m.module?.module_name ||
              t("courseStructureDetails.unnamedModule", { module: moduleTerm }),
            description: m.module?.description,
          }))}
          thumbs={subjectThumbs}
          onOpen={(moduleId) => {
            setOpenTileModule(moduleId);
            toggleOpenState(moduleId, setOpenModules);
          }}
        />
      );
    }

    return (
      <div className="space-y-2">
        {filteredModules.map((moduleWithChapters, index) => (
          <Collapsible
            key={`${moduleWithChapters.module?.id}-${index}`}
            open={openModules.has(moduleWithChapters.module?.id)}
            onOpenChange={() =>
              toggleOpenState(moduleWithChapters.module?.id, setOpenModules)
            }
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
              >
                <Folder
                  size={16}
                  className="me-2 text-orange-500 flex-shrink-0"
                />
                <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                  {moduleWithChapters.module?.module_name || t("courseStructureDetails.unnamedModule", { module: moduleTerm })}
                </span>
                <div className="flex-shrink-0 ms-2">
                  {openModules.has(moduleWithChapters.module?.id) ? (
                    <CaretDown size={16} />
                  ) : (
                    <CaretRight size={16} />
                  )}
                </div>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="ms-4 mt-2">
              {moduleWithChapters.module?.description &&
                moduleWithChapters.module.description.trim() !== "" && (
                  <div className="p-2 bg-catalogue-bg-subtle rounded-catalogue-xs text-sm text-catalogue-text-secondary mb-2">
                    {moduleWithChapters.module.description}
                  </div>
                )}
              {renderChapters(moduleWithChapters)}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    );
  };

  // Render slides only for depth 2 (skip "default" chapters - show slides directly)
  const renderSlidesForDepth2 = () => {
    const result: JSX.Element[] = [];

    Object.values(subjectModulesMap).forEach((modules, subjectIndex) => {
      modules.forEach((moduleWithChapters, moduleIndex) => {
        moduleWithChapters.chapters.forEach((chapter, chapterIndex) => {
          const isChapterDefault = isDefaultName(chapter.chapter_name);

          if (!isChapterDefault) {
            // Chapter is not default, show it with slides
            result.push(
              <Collapsible
                key={`${chapter.id}-${chapterIndex}`}
                open={openChapters.has(chapter.id)}
                onOpenChange={() => toggleChapter(chapter.id)}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                  >
                    <FileText
                      size={16}
                      className="me-2 text-green-500 flex-shrink-0"
                    />
                    <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                      {chapter.chapter_name || t("courseStructureDetails.unnamedChapter", { chapter: chapterTerm })}
                    </span>
                    <div className="flex-shrink-0 ms-2">
                      {openChapters.has(chapter.id) ? (
                        <CaretDown size={16} />
                      ) : (
                        <CaretRight size={16} />
                      )}
                    </div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ms-4 mt-2">
                  {renderSlides(chapter.id)}
                </CollapsibleContent>
              </Collapsible>
            );
          } else {
            // Chapter is "default", render slides directly
            const slides = slidesMap[chapter.id] || [];

            if (slides.length === 0) {
              console.warn(
                `[CourseStructureDetails] [DEPTH-2] No slides found in slidesMap for chapter ${chapter.id}, this might be loading issue`
              );
            }

            slides.forEach((slide, slideIndex) => {
              const { Icon, color, label } = getSlideIcon(slide);
              result.push(
                <div
                  key={`${slide.id}-${slideIndex}`}
                  className="flex items-center gap-2 p-2 border border-catalogue-border rounded-catalogue-md hover:bg-catalogue-bg-subtle overflow-hidden"
                >
                  <Icon size={16} className={`flex-shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-catalogue-text-primary break-words truncate">
                        {slide.title}
                      </span>
                      <span className="text-xs text-catalogue-text-muted whitespace-nowrap flex-shrink-0">
                        ({label})
                      </span>
                    </div>
                  </div>
                </div>
              );
            });
          }
        });
      });
    });

    if (result.length === 0) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">
          {t("courseStructureDetails.loadingCourseContent", { course: courseTerm })}
        </div>
      );
    }

    return <div className="space-y-2">{result}</div>;
  };

  // Render all chapters for depth 3 (skip "default" labels, show content directly)
  const renderAllChaptersForDepth3 = () => {
    const result: JSX.Element[] = [];

    Object.values(subjectModulesMap).forEach((modules) => {
      modules.forEach((moduleWithChapters) => {
        const chapters = moduleWithChapters.chapters || [];

        chapters.forEach((chapter, chapterIndex) => {
          const isChapterDefault = isDefaultName(chapter.chapter_name);

          if (!isChapterDefault) {
            // Chapter is not default, show it
            result.push(
              <Collapsible
                key={`${chapter.id}-${chapterIndex}`}
                open={openChapters.has(chapter.id)}
                onOpenChange={() => toggleChapter(chapter.id)}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                  >
                    <FileText
                      size={16}
                      className="me-2 text-green-500 flex-shrink-0"
                    />
                    <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                      {chapter.chapter_name || t("courseStructureDetails.unnamedChapter", { chapter: chapterTerm })}
                    </span>
                    <div className="flex-shrink-0 ms-2">
                      {openChapters.has(chapter.id) ? (
                        <CaretDown size={16} />
                      ) : (
                        <CaretRight size={16} />
                      )}
                    </div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ms-4 mt-2">
                  {renderSlides(chapter.id)}
                </CollapsibleContent>
              </Collapsible>
            );
          } else {
            // Chapter is "default", render slides directly from chapter.slides
            const slides = (chapter as any).slides || [];

            slides.forEach((slide: Slide, slideIndex: number) => {
              const { Icon, color, label } = getSlideIcon(slide);
              result.push(
                <div
                  key={`${slide.id}-${slideIndex}`}
                  className="flex items-center gap-2 p-2 border border-catalogue-border rounded-catalogue-md hover:bg-catalogue-bg-subtle overflow-hidden"
                >
                  <Icon size={16} className={`flex-shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-catalogue-text-primary break-words truncate">
                        {slide.title}
                      </span>
                      <span className="text-xs text-catalogue-text-muted whitespace-nowrap flex-shrink-0">
                        ({label})
                      </span>
                    </div>
                  </div>
                </div>
              );
            });
          }
        });
      });
    });

    if (result.length === 0) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">
          {t("courseStructureDetails.noContentForCourse", { course: courseTerm })}
        </div>
      );
    }

    return <div className="space-y-2">{result}</div>;
  };

  // Render all modules for depth 4 (skip "default" labels, show content directly)
  const renderModulesForDepth4 = () => {
    const result: JSX.Element[] = [];

    Object.values(subjectModulesMap).forEach((modules) => {
      modules.forEach((moduleWithChapters, moduleIndex) => {
        const isModuleDefault = isDefaultName(
          moduleWithChapters.module?.module_name
        );

        if (!isModuleDefault) {
          // Module is not default, show it with chapters
          result.push(
            <Collapsible
              key={`${moduleWithChapters.module?.id}-${moduleIndex}`}
              open={openModules.has(moduleWithChapters.module?.id)}
              onOpenChange={() => toggleModule(moduleWithChapters.module?.id)}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                >
                  <Folder
                    size={16}
                    className="me-2 text-blue-500 flex-shrink-0"
                  />
                  <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                    {moduleWithChapters.module?.module_name || t("courseStructureDetails.unnamedModule", { module: moduleTerm })}
                  </span>
                  <div className="flex-shrink-0 ms-2">
                    {openModules.has(moduleWithChapters.module?.id) ? (
                      <CaretDown size={16} />
                    ) : (
                      <CaretRight size={16} />
                    )}
                  </div>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="ms-4 mt-2">
                {moduleWithChapters.module?.description &&
                  moduleWithChapters.module.description.trim() !== "" && (
                    <div className="p-2 bg-catalogue-bg-subtle rounded-catalogue-xs text-sm text-catalogue-text-secondary mb-2">
                      {moduleWithChapters.module.description}
                    </div>
                  )}
                {/* Depth 4: Filter chapters within modules */}
                {(() => {
                  const filteredChapters = moduleWithChapters.chapters.filter(
                    (chapter) => !isDefaultName(chapter.chapter_name)
                  );
                  if (filteredChapters.length === 0) {
                    return (
                      <div className="text-sm text-catalogue-text-muted italic">
                        {t("courseStructureDetails.noChaptersForModule", { chapters: chaptersTerm, module: moduleTerm })}
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {filteredChapters.map((chapter, index) => (
                        <Collapsible
                          key={`${chapter.id}-${index}`}
                          open={openChapters.has(chapter.id)}
                          onOpenChange={() => toggleChapter(chapter.id)}
                        >
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="ghost"
                              className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                            >
                              <FileText
                                size={16}
                                className="me-2 text-green-500 flex-shrink-0"
                              />
                              <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                                {chapter.chapter_name || t("courseStructureDetails.unnamedChapter", { chapter: chapterTerm })}
                              </span>
                              <div className="flex-shrink-0 ms-2">
                                {openChapters.has(chapter.id) ? (
                                  <CaretDown size={16} />
                                ) : (
                                  <CaretRight size={16} />
                                )}
                              </div>
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="ms-4 mt-2">
                            {renderSlides(chapter.id)}
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  );
                })()}
              </CollapsibleContent>
            </Collapsible>
          );
        } else {
          // Module is "default", render chapters directly
          const chapters = moduleWithChapters.chapters || [];
          chapters.forEach((chapter, chapterIndex) => {
            const isChapterDefault = isDefaultName(chapter.chapter_name);

            if (!isChapterDefault) {
              // Chapter is not default, show it
              result.push(
                <Collapsible
                  key={`${chapter.id}-${chapterIndex}`}
                  open={openChapters.has(chapter.id)}
                  onOpenChange={() => toggleChapter(chapter.id)}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                    >
                      <FileText
                        size={16}
                        className="me-2 text-green-500 flex-shrink-0"
                      />
                      <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                        {chapter.chapter_name || t("courseStructureDetails.unnamedChapter", { chapter: chapterTerm })}
                      </span>
                      <div className="flex-shrink-0 ms-2">
                        {openChapters.has(chapter.id) ? (
                          <CaretDown size={16} />
                        ) : (
                          <CaretRight size={16} />
                        )}
                      </div>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="ms-4 mt-2">
                    {renderSlides(chapter.id)}
                  </CollapsibleContent>
                </Collapsible>
              );
            } else {
              // Chapter is "default", render slides directly from chapter.slides
              const slides = (chapter as any).slides || [];

              slides.forEach((slide: Slide, slideIndex: number) => {
                const { Icon, color, label } = getSlideIcon(slide);
                result.push(
                  <div
                    key={`${slide.id}-${slideIndex}`}
                    className="flex items-center gap-2 p-2 border border-catalogue-border rounded-catalogue-md hover:bg-catalogue-bg-subtle overflow-hidden"
                  >
                    <Icon size={16} className={`flex-shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-catalogue-text-primary break-words truncate">
                          {slide.title}
                        </span>
                        <span className="text-xs text-catalogue-text-muted whitespace-nowrap flex-shrink-0">
                          ({label})
                        </span>
                      </div>
                    </div>
                  </div>
                );
              });
            }
          });
        }
      });
    });

    if (result.length === 0) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">
          {t("courseStructureDetails.noContentForCourse", { course: courseTerm })}
        </div>
      );
    }

    return <div className="space-y-2">{result}</div>;
  };

  /**
   * Subjects as artwork cards, matched to the admin dashboard and the enrolled
   * learner's Content Structure so an author sees the same shape everywhere.
   *
   * Only the top level is tiled. Opening a card drills into that subject's
   * modules below the grid, reusing the outline renderer — a tile grid all the
   * way down would bury a three-slide chapter behind three clicks.
   *
   * Returns null when there is nothing to tile (every subject named "default",
   * which is how a course with no real subject layer arrives), so the caller
   * can fall back to the outline rather than render an empty grid.
   */
  const renderSubjectsAsTiles = () => {
    const subjects = studyLibraryData.filter(
      (subject) => !isDefaultName(subject.subject_name),
    );
    if (subjects.length === 0) return null;

    const subject = subjects.find((s) => s.id === openTileSubject) ?? null;

    // Top level: just the subject cards, nothing expanded.
    if (!subject) {
      return (
        <SubjectTileGrid
          items={subjects.map((s) => ({
            id: s.id,
            name: s.subject_name,
            description: s.description,
          }))}
          thumbs={subjectThumbs}
          onOpen={(subjectId) => {
            setOpenTileSubject(subjectId);
            setOpenTileModule(null);
            // The outline renderer reads openSubjects to decide what to draw.
            toggleOpenState(subjectId, setOpenSubjects);
          }}
        />
      );
    }

    // Drilled in: the grid is replaced by the level below, headed by a trail
    // back up. One level on screen at a time, so there is never a panel whose
    // owner has to be guessed at.
    const openModule = (subjectModulesMap[subject.id] || []).find(
      (m) => m.module?.id === openTileModule,
    );
    const trail = [
      { id: subject.id, name: subject.subject_name },
      ...(openModule?.module
        ? [
            {
              id: openModule.module.id,
              name:
                openModule.module.module_name ||
                t("courseStructureDetails.unnamedModule", { module: moduleTerm }),
            },
          ]
        : []),
    ];

    return (
      <div>
        <ContentDrillCrumb
          trail={trail}
          rootLabel={subjectsTerm}
          onNavigate={(id) => {
            if (id === null) {
              setOpenTileSubject(null);
              setOpenTileModule(null);
            } else if (id === subject.id) {
              setOpenTileModule(null);
            }
          }}
        />
        {renderModules(subject.id)}
      </div>
    );
  };

  // Render all subjects for depth 5 (skip "default" labels, show content directly)
  const renderSubjectsForDepth5 = () => {
    const result: JSX.Element[] = [];

    studyLibraryData.forEach((subject, subjectIndex) => {
      const modules = subjectModulesMap[subject.id] || [];
      const isSubjectDefault = isDefaultName(subject.subject_name);

      // If subject is not default, show it with its modules
      if (!isSubjectDefault) {
        result.push(
          <Collapsible
            key={`${subject.id}-${subjectIndex}`}
            open={openSubjects.has(subject.id)}
            onOpenChange={() => toggleSubject(subject.id)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start p-3 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
              >
                <FolderOpen
                  size={18}
                  className="me-3 text-purple-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="font-medium text-catalogue-text-primary break-words truncate">
                    {subject.subject_name}
                  </div>
                  <div className="text-sm text-catalogue-text-muted break-words truncate">
                    {subject.description}
                  </div>
                </div>
                <div className="flex-shrink-0 ms-2">
                  {openSubjects.has(subject.id) ? (
                    <CaretDown size={16} />
                  ) : (
                    <CaretRight size={16} />
                  )}
                </div>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="ms-4 mt-2">
              {renderModules(subject.id)}
            </CollapsibleContent>
          </Collapsible>
        );
      } else {
        // Subject is "default", so render modules directly without subject wrapper
        modules.forEach((moduleWithChapters, moduleIndex) => {
          const isModuleDefault = isDefaultName(
            moduleWithChapters.module?.module_name
          );

          if (!isModuleDefault) {
            // Module is not default, show it
            result.push(
              <Collapsible
                key={`${moduleWithChapters.module?.id}-${moduleIndex}`}
                open={openModules.has(moduleWithChapters.module?.id)}
                onOpenChange={() =>
                  toggleOpenState(moduleWithChapters.module?.id, setOpenModules)
                }
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                  >
                    <Folder
                      size={16}
                      className="me-2 text-orange-500 flex-shrink-0"
                    />
                    <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                      {moduleWithChapters.module?.module_name ||
                        t("courseStructureDetails.unnamedModule", { module: moduleTerm })}
                    </span>
                    <div className="flex-shrink-0 ms-2">
                      {openModules.has(moduleWithChapters.module?.id) ? (
                        <CaretDown size={16} />
                      ) : (
                        <CaretRight size={16} />
                      )}
                    </div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="ms-4 mt-2">
                  {moduleWithChapters.module?.description &&
                    moduleWithChapters.module.description.trim() !== "" && (
                      <div className="p-2 bg-catalogue-bg-subtle rounded-catalogue-xs text-sm text-catalogue-text-secondary mb-2">
                        {moduleWithChapters.module.description}
                      </div>
                    )}
                  {renderChapters(moduleWithChapters)}
                </CollapsibleContent>
              </Collapsible>
            );
          } else {
            // Module is "default", render chapters directly
            const chapters = moduleWithChapters.chapters || [];
            chapters.forEach((chapter, chapterIndex) => {
              const isChapterDefault = isDefaultName(chapter.chapter_name);

              if (!isChapterDefault) {
                // Chapter is not default, show it
                result.push(
                  <Collapsible
                    key={`${chapter.id}-${chapterIndex}`}
                    open={openChapters.has(chapter.id)}
                    onOpenChange={() => toggleChapter(chapter.id)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-start p-2 h-auto text-start border border-catalogue-border rounded-catalogue-md overflow-hidden"
                      >
                        <FileText
                          size={16}
                          className="me-2 text-green-500 flex-shrink-0"
                        />
                        <span className="text-sm font-medium text-catalogue-text-primary break-words truncate flex-1 min-w-0">
                          {chapter.chapter_name || t("courseStructureDetails.unnamedChapter", { chapter: chapterTerm })}
                        </span>
                        <div className="flex-shrink-0 ms-2">
                          {openChapters.has(chapter.id) ? (
                            <CaretDown size={16} />
                          ) : (
                            <CaretRight size={16} />
                          )}
                        </div>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="ms-4 mt-2">
                      {renderSlides(chapter.id)}
                    </CollapsibleContent>
                  </Collapsible>
                );
              } else {
                // Chapter is "default", render slides directly from chapter.slides
                const slides = (chapter as any).slides || [];

                slides.forEach((slide: Slide, slideIndex: number) => {
                  const { Icon, color, label } = getSlideIcon(slide);
                  result.push(
                    <div
                      key={`${slide.id}-${slideIndex}`}
                      className="flex items-center gap-2 p-2 border border-catalogue-border rounded-catalogue-md hover:bg-catalogue-bg-subtle overflow-hidden"
                    >
                      <Icon size={16} className={`flex-shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-catalogue-text-primary break-words truncate">
                            {slide.title}
                          </span>
                          <span className="text-xs text-catalogue-text-muted whitespace-nowrap flex-shrink-0">
                            ({label})
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              }
            });
          }
        });
      }
    });

    if (result.length === 0) {
      return (
        <div className="text-sm text-catalogue-text-muted italic">
          {t("courseStructureDetails.noContentForCourse", { course: courseTerm })}
        </div>
      );
    }

    return <div className="space-y-2">{result}</div>;
  };

  if (isLoading) {
    return (
      <div className="bg-catalogue-bg-elevated rounded-catalogue-md shadow-sm border border-catalogue-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-catalogue-bg-muted rounded-catalogue-xs w-1/4"></div>
          <div className="space-y-2">
            <div className="h-3 bg-catalogue-bg-muted rounded-catalogue-xs"></div>
            <div className="h-3 bg-catalogue-bg-muted rounded-catalogue-xs w-5/6"></div>
            <div className="h-3 bg-catalogue-bg-muted rounded-catalogue-xs w-4/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (studyLibraryData.length === 0) {
    return (
      <div className="bg-catalogue-bg-elevated rounded-catalogue-md shadow-sm border border-catalogue-border p-6">
        <div className="text-center">
          <h3 className="text-lg font-medium text-catalogue-text-primary mb-2">
            {t("courseStructureDetails.courseStructure", { course: courseTerm })}
          </h3>
          <p className="text-catalogue-text-muted mb-4">
            {t("courseStructureDetails.noStructureData", { course: courseTerm })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-catalogue-bg-elevated rounded-catalogue-md shadow-sm border border-catalogue-border p-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-catalogue-border pb-3">
          <div className="flex items-center gap-2">
            <TreeStructure size={18} className="text-primary-600" />
            <span className="text-sm font-medium text-catalogue-text-primary">
              {t("courseStructureDetails.courseStructure", { course: courseTerm })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              // The shadcn `outline` variant sets bg-background but no text
              // color, so the label inherited the app default (dark) and went
              // invisible on the dark catalogue surface. Pin catalogue tokens.
              className="border-catalogue-border bg-catalogue-bg-elevated text-catalogue-text-primary hover:bg-catalogue-bg-subtle hover:text-catalogue-text-primary"
              onClick={isAllExpanded ? collapseAll : expandAll}
            >
              {isAllExpanded ? t("courseStructureDetails.collapseAll") : t("courseStructureDetails.expandAll")}
            </Button>
          </div>
        </div>

        {/* Course Structure */}
        <div className="space-y-2">
          {courseDepth === 2 && (
            <div className="space-y-2">
              {showContentHeading && (
                <h3 className="text-lg font-medium text-catalogue-text-primary mb-4">
                  {t("courseStructureDetails.contentHeading.slidesOnly", { course: courseTerm, slides: slidesTerm })}
                </h3>
              )}
              {renderSlidesForDepth2()}
            </div>
          )}

          {courseDepth === 3 && (
            <div className="space-y-2">
              {showContentHeading && (
                <h3 className="text-lg font-medium text-catalogue-text-primary mb-4">
                  {t("courseStructureDetails.contentHeading.chaptersAndSlides", { course: courseTerm, chapters: chaptersTerm, slides: slidesTerm })}
                </h3>
              )}
              {renderAllChaptersForDepth3()}
            </div>
          )}

          {courseDepth === 4 && (
            <div className="space-y-2">
              {showContentHeading && (
                <h3 className="text-lg font-medium text-catalogue-text-primary mb-4">
                  {t("courseStructureDetails.contentHeading.modulesChaptersSlides", { course: courseTerm, modules: modulesTerm, chapters: chaptersTerm, slides: slidesTerm })}
                </h3>
              )}
              {renderModulesForDepth4()}
            </div>
          )}

          {courseDepth === 5 && (
            <div className="space-y-2">
              {showContentHeading && (
                <h3 className="text-lg font-medium text-catalogue-text-primary mb-4">
                  {t("courseStructureDetails.contentHeading.fullStructure", { course: courseTerm })}
                </h3>
              )}
              {/* Tiles are a top-level treatment; a course whose subjects are
                  all "default" has no top level to tile, so it keeps the
                  outline rather than showing an empty grid. */}
              {(variant === "tiles" && renderSubjectsAsTiles()) ||
                renderSubjectsForDepth5()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
