import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Brain,
  CaretRight,
  DownloadSimple,
  Exam,
  MagnifyingGlass,
  NotePencil,
  Printer,
  Trash,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { EmptyState, LoadErrorState, LoadingState } from "@/components/design-system/states";
import { Input } from "@/components/ui/input";
import { useAvailableTutor } from "@/components/chatbot/moments/tutor-moments";
import { getInstituteId } from "@/constants/helper";
import { useNavHeadingStore } from "@/stores/layout-container/useNavHeadingStore";
import { fetchDueCount, fetchNotebook, fetchWholeNotebook } from "@/lib/notes/api";
import { bindNotesToLearner, flushOutbox, queueDelete, readOutbox } from "@/lib/notes/outbox";
import {
  groupNotes,
  notePosition,
  notesForTutor,
  notesToMarkdown,
  notesToPrintHtml,
  type ExportLabels,
} from "@/lib/notes/format";
import type { LearnerNote, NoteKind } from "@/lib/notes/types";
import { cn } from "@/lib/utils";
import { NOTE_BAND, noteColorOf } from "./note-colors";
import { NotebookReview } from "./NotebookReview";

type KindFilter = "ALL" | NoteKind;
const FILTERS: KindFilter[] = ["ALL", "HIGHLIGHT", "NOTE", "AREA", "BOOKMARK"];
const PAGE_SIZE = 50;

const LESSON_ROUTE = "/study-library/courses/course-details/subjects/modules/chapters/slides";

function saveTextFile(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prints through a hidden frame, so the learner stays on the page. */
function printHtml(html: string) {
  const frame = document.createElement("iframe");
  // Not display:none: some browsers will not print a frame that is not laid out.
  frame.className = "fixed bottom-0 end-0 size-px border-0 opacity-0";
  frame.setAttribute("sandbox", "allow-modals allow-same-origin");
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

function NotebookRow({
  note,
  onOpen,
  onDelete,
}: {
  note: LearnerNote;
  onOpen: (() => void) | null;
  onDelete: () => void;
}) {
  const { t } = useTranslation("notebook");
  const position = notePosition(note, { page: (page) => t("pageNumber", { page }) });
  const quote = note.quote_text?.trim();
  const fallback = note.kind === "BOOKMARK" ? t("kind.bookmark") : note.kind === "AREA" ? t("kind.area") : null;
  return (
    <li className="flex items-stretch gap-2 rounded-lg border border-neutral-200 bg-white" data-notebook-row>
      <span aria-hidden className={cn("my-2 ms-2 w-1 shrink-0 rounded-full", NOTE_BAND[noteColorOf(note.color)])} />
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen ?? undefined}
        className="min-w-0 flex-1 space-y-1 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 enabled:hover:opacity-80"
      >
        {position && <span className="text-2xs font-semibold text-neutral-500 tabular-nums">{position}</span>}
        {quote && <p className="line-clamp-3 text-caption text-neutral-600">{quote}</p>}
        {note.note_text && <p className="whitespace-pre-wrap text-body text-neutral-800">{note.note_text}</p>}
        {!quote && !note.note_text && fallback && <p className="text-caption text-neutral-500">{fallback}</p>}
      </button>
      <button
        type="button"
        aria-label={t("deleteNote")}
        onClick={onDelete}
        className="flex w-10 shrink-0 items-center justify-center text-neutral-400 hover:text-danger-500"
      >
        <Trash size={16} />
      </button>
    </li>
  );
}

/** Everything the learner has marked, by course and lesson, in one place. */
export function NotebookPage() {
  const { t, i18n } = useTranslation("notebook");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setNavHeading } = useNavHeadingStore();
  const tutor = useAvailableTutor();
  const [instituteId, setInstituteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<KindFilter>("ALL");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setNavHeading(t("title"));
  }, [setNavHeading, t]);
  useEffect(() => {
    void Promise.all([getInstituteId(), bindNotesToLearner()]).then(async ([id]) => {
      // Send anything waiting first, so the list includes it.
      await flushOutbox();
      setInstituteId(id ?? null);
    });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchText.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  const kind = filter === "ALL" ? undefined : filter;
  const list = useInfiniteQuery({
    queryKey: ["notebook", instituteId, kind, search],
    enabled: !!instituteId,
    // Notes are made on other screens, so never show a remembered list.
    staleTime: 0,
    refetchOnMount: "always",
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchNotebook({ instituteId: instituteId as string, kind, q: search || undefined, page: pageParam, size: PAGE_SIZE }),
    getNextPageParam: (last) => (last.last ? undefined : last.page_no + 1),
  });
  const dueCount = useQuery({
    queryKey: ["notebook-due-count", instituteId],
    enabled: !!instituteId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => fetchDueCount(instituteId as string),
  });

  const [locallyDeleted, setLocallyDeleted] = useState<Set<string>>(new Set());
  const notes = useMemo(() => {
    const waiting = new Set(readOutbox().flatMap((e) => (e.op === "delete" ? [e.id] : [])));
    return (list.data?.pages.flatMap((page) => page.content) ?? []).filter(
      (note) => !waiting.has(note.id) && !locallyDeleted.has(note.id),
    );
  }, [list.data, locallyDeleted]);
  const total = list.data?.pages[0]?.total_elements ?? 0;
  const fallbackCourse = t("otherCourse");
  const fallbackLesson = t("untitledLesson");
  const courses = useMemo(() => groupNotes(notes, fallbackCourse, fallbackLesson), [notes, fallbackCourse, fallbackLesson]);

  // Through the same queue as the lesson's writes, so an unsent save of this note
  // is replaced rather than left to bring it back, and it works offline.
  const remove = useMutation({
    mutationFn: async (note: LearnerNote) => {
      setLocallyDeleted((ids) => new Set(ids).add(note.id));
      queueDelete(note.id, note.slide_id);
      return flushOutbox();
    },
    onSuccess: (result) => {
      if (result.rejected > 0) toast.error(t("deleteFailed"));
      void queryClient.invalidateQueries({ queryKey: ["notebook", instituteId] });
      void queryClient.invalidateQueries({ queryKey: ["notebook-due-count", instituteId] });
    },
  });

  const openNote = (note: LearnerNote) => {
    if (!note.subject_id || !note.module_id || !note.chapter_id || !note.package_session_id) return null;
    return () => {
      void navigate({
        to: LESSON_ROUTE,
        search: {
          courseId: note.course_id ?? "",
          levelId: note.level_id ?? undefined,
          subjectId: note.subject_id ?? "",
          moduleId: note.module_id ?? "",
          chapterId: note.chapter_id ?? "",
          slideId: note.slide_id,
          sessionId: note.package_session_id ?? "",
          ...(note.page_index !== null && note.page_index !== undefined ? { page: note.page_index + 1 } : {}),
          ...(note.time_ms ? { t: Math.floor(note.time_ms / 1000) } : {}),
        },
      });
    };
  };

  const exportNotes = async (format: "markdown" | "print") => {
    if (!instituteId || exporting) return;
    setExporting(true);
    try {
      const all = await fetchWholeNotebook(instituteId, kind, search || undefined);
      const labels: ExportLabels = {
        title: t("title"),
        fallbackCourse,
        fallbackLesson,
        markedArea: t("kind.area"),
        bookmark: t("kind.bookmark"),
        page: (page) => t("pageNumber", { page }),
      };
      if (format === "markdown") saveTextFile(notesToMarkdown(all, labels), "my-notebook.md");
      else printHtml(notesToPrintHtml(all, labels, i18n.dir()));
    } catch {
      toast.error(t("exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  if (reviewing && instituteId) {
    return <NotebookReview instituteId={instituteId} onDone={() => setReviewing(false)} />;
  }

  const tutorMaterial = notesForTutor(notes);
  const filtered = !!search || filter !== "ALL";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-h3 font-semibold text-neutral-900">{t("title")}</h1>
          <p className="text-caption text-neutral-500">{t("subtitle")}</p>
        </div>
        {notes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <MyButton buttonType="secondary" scale="small" className="min-w-0 px-2.5" disabled={exporting} onClick={() => void exportNotes("markdown")}>
              <DownloadSimple size={14} className="me-1" />
              {t("exportFile")}
            </MyButton>
            <MyButton buttonType="secondary" scale="small" className="min-w-0 px-2.5" disabled={exporting} onClick={() => void exportNotes("print")}>
              <Printer size={14} className="me-1" />
              {t("exportPrint")}
            </MyButton>
          </div>
        )}
      </header>

      {(dueCount.data ?? 0) > 0 && (
        <button
          type="button"
          data-notebook-review-start
          onClick={() => setReviewing(true)}
          className="flex w-full items-center gap-3 rounded-xl bg-primary-50 p-3 text-start transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Brain size={24} weight="duotone" className="shrink-0 text-primary-500" />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-neutral-900">
              {t("review.ready", { count: dueCount.data ?? 0 })}
            </span>
            <span className="block text-caption text-neutral-600">{t("review.why")}</span>
          </span>
          <CaretRight size={16} className="shrink-0 text-neutral-500 rtl:rotate-180" />
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-60">
          <MagnifyingGlass size={16} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="ps-8"
          />
        </div>
        {tutor && tutorMaterial && (
          <MyButton
            buttonType="secondary"
            scale="small"
            className="min-w-0 px-2.5"
            onClick={() => tutor.openAndSend(t("tutorPrompt.quizNotebook", { notes: tutorMaterial }))}
          >
            <Exam size={14} className="me-1" />
            {t("quizMe")}
          </MyButton>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterLabel")}>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full border px-3 py-1 text-caption font-medium transition-colors",
              filter === value
                ? "border-primary-500 bg-primary-50 text-neutral-900"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50",
            )}
          >
            {t(`filter.${value}`)}
          </button>
        ))}
      </div>

      {list.isLoading || !instituteId ? (
        <LoadingState variant="list" count={4} />
      ) : list.isError ? (
        <LoadErrorState onRetry={() => list.refetch()} />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={NotePencil}
          title={filtered ? t("noMatches") : t("emptyTitle")}
          description={filtered ? t("noMatchesBody") : t("emptyBody")}
        />
      ) : (
        <div className="space-y-6">
          <p className="text-caption text-neutral-500 tabular-nums">{t("count", { count: total })}</p>
          {courses.map((course) => (
            <section key={course.key} className="space-y-3">
              <h2 className="text-subtitle font-semibold text-neutral-900">{course.title}</h2>
              {course.lessons.map((lesson) => (
                <div key={lesson.slideId} className="space-y-1.5">
                  <h3 className="text-caption font-medium text-neutral-600">
                    {lesson.chapter ? `${lesson.chapter} / ` : ""}
                    {lesson.title}
                  </h3>
                  <ul className="space-y-1.5">
                    {lesson.notes.map((note) => (
                      <NotebookRow
                        key={note.id}
                        note={note}
                        onOpen={openNote(note)}
                        onDelete={() => remove.mutate(note)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {list.hasNextPage && (
            <div className="flex justify-center">
              <MyButton buttonType="secondary" scale="medium" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {t("loadMore")}
              </MyButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
