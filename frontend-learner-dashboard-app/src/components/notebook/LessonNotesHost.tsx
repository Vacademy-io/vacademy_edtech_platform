import { useEffect, useState, type RefObject } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { NotePencil } from "@phosphor-icons/react";
import { getInstituteId } from "@/constants/helper";
import { bindNotesToLearner } from "@/lib/notes/outbox";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useLessonNotesStore } from "@/stores/study-library/lesson-notes-store";
import { useModulesWithChaptersStore } from "@/stores/study-library/use-modules-with-chapters-store";
import { getChapterName } from "@/utils/study-library/get-name-by-id/getChapterById";
import { LessonNotesPanel } from "./LessonNotesPanel";
import { useTextHighlights } from "./use-text-highlights";

/** Graded work stays closed: notes are for lessons, not for a test in progress. */
const LESSON_TYPES = new Set([
  "DOCUMENT",
  "VIDEO",
  "AI_VIDEO",
  "HTML_VIDEO",
  "AUDIO",
  "PRESENTATION",
  "SCORM",
]);

let notesAllowedCache: boolean | null = null;

/** Notes are on for every institute unless it has switched them off. */
export function useNotesAllowed(): boolean {
  const [allowed, setAllowed] = useState(notesAllowedCache ?? true);
  useEffect(() => {
    getStudentDisplaySettings(false)
      .then((settings) => {
        notesAllowedCache = settings?.courseDetails?.slidesView?.canTakeNotes !== false;
        setAllowed(notesAllowedCache);
      })
      .catch(() => setAllowed(true));
  }, []);
  return allowed;
}

export const isNotableSlide = (sourceType?: string | null) =>
  LESSON_TYPES.has((sourceType ?? "").toUpperCase());

/** Sets up notes for the lesson on screen and mounts the panel. */
export function LessonNotesHost({ contentRef }: { contentRef: RefObject<HTMLElement | null> }) {
  const allowed = useNotesAllowed();
  const activeItem = useContentStore((state) => state.activeItem);
  const packageSessionId = useContentStore((state) => state.currentPackageSessionId);
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const modules = useModulesWithChaptersStore((state) => state.modulesWithChaptersData);
  const notes = useLessonNotesStore((state) => state.notes);
  const setContext = useLessonNotesStore((state) => state.setContext);
  const load = useLessonNotesStore((state) => state.load);
  const sync = useLessonNotesStore((state) => state.sync);
  const closePanel = useLessonNotesStore((state) => state.closePanel);
  const [instituteId, setInstituteId] = useState<string | null>(null);

  // Nothing below runs until storage is bound to whoever is signed in.
  useEffect(() => {
    void Promise.all([getInstituteId(), bindNotesToLearner()]).then(([id, learner]) => {
      if (learner) setInstituteId(id ?? null);
    });
  }, []);

  const slideId = activeItem?.id ?? null;
  const notable = allowed && isNotableSlide(activeItem?.source_type);
  const courseName = useLessonNotesStore((state) => state.courseName);
  const chapterName = search.chapterId ? getChapterName(search.chapterId, modules) : null;

  useEffect(() => {
    if (!notable || !slideId || !instituteId) {
      setContext(null);
      closePanel();
      return;
    }
    setContext({
      institute_id: instituteId,
      slide_id: slideId,
      slide_type: activeItem?.source_type ?? null,
      slide_title: activeItem?.title?.slice(0, 500) ?? null,
      chapter_name: chapterName?.slice(0, 500) ?? null,
      course_name: courseName?.trim().slice(0, 500) || null,
      course_id: search.courseId ?? null,
      level_id: search.levelId ?? null,
      subject_id: search.subjectId ?? null,
      module_id: search.moduleId ?? null,
      chapter_id: search.chapterId ?? null,
      package_session_id: packageSessionId ?? search.sessionId ?? null,
    });
  }, [
    notable,
    slideId,
    instituteId,
    activeItem?.source_type,
    activeItem?.title,
    chapterName,
    courseName,
    packageSessionId,
    search.courseId,
    search.levelId,
    search.subjectId,
    search.moduleId,
    search.chapterId,
    search.sessionId,
    setContext,
    closePanel,
  ]);

  useEffect(() => {
    if (notable && slideId && instituteId) void load(slideId);
  }, [notable, slideId, instituteId, load]);

  // Anything left unsent by an earlier connection goes as soon as it can.
  useEffect(() => {
    if (!instituteId) return;
    void sync();
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [instituteId, sync]);

  useEffect(() => closePanel, [closePanel]);

  // Desktop: the panel sits beside the lesson rather than over it.
  const panelOpen = useLessonNotesStore((state) => state.panelOpen);
  useEffect(() => {
    const root = contentRef.current?.closest<HTMLElement>("[data-lesson-root]");
    if (!root) return;
    const apply = () => {
      const panel = document.querySelector<HTMLElement>("[data-notes-panel]");
      const beside = panelOpen && window.innerWidth >= 640 && panel;
      root.style.paddingInlineEnd = beside ? `${panel.offsetWidth}px` : "";
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.paddingInlineEnd = "";
    };
  }, [panelOpen, contentRef]);

  const isRichText =
    activeItem?.source_type === "DOCUMENT" && activeItem.document_slide?.type === "DOC";
  useTextHighlights(contentRef, notes, notable && isRichText);

  // Keyed by lesson: a half-written note must not be saved onto the next lesson.
  return notable ? <LessonNotesPanel key={slideId} /> : null;
}

/** The "Notes" control in the lesson's top bar. */
export function NotesButton() {
  const { t } = useTranslation("notebook");
  const allowed = useNotesAllowed();
  const activeItem = useContentStore((state) => state.activeItem);
  const toggle = useLessonNotesStore((state) => state.togglePanel);
  const count = useLessonNotesStore((state) => state.notes.length);
  if (!allowed || !isNotableSlide(activeItem?.source_type)) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      data-notes-button
      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
    >
      <NotePencil size={12} className="text-neutral-500" />
      <span>{t("notesButton")}</span>
      {count > 0 && <span className="font-semibold text-primary-500 tabular-nums">{count}</span>}
    </button>
  );
}
