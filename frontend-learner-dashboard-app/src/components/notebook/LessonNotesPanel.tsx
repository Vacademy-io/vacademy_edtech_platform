import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import {
  BookmarkSimple,
  ChatText,
  CloudSlash,
  Exam,
  NotePencil,
  PencilSimple,
  Selection,
  Trash,
  X,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { Textarea } from "@/components/ui/textarea";
import { useAvailableTutor } from "@/components/chatbot/moments/tutor-moments";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { useDoubtSidebarStore } from "@/stores/study-library/doubt-sidebar-store";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useLessonNotesStore } from "@/stores/study-library/lesson-notes-store";
import { useMediaRefsStore } from "@/stores/mediaRefsStore";
import { notePosition, notesForTutor, sortByPosition } from "@/lib/notes/format";
import type { LearnerNote } from "@/lib/notes/types";
import { cn } from "@/lib/utils";
import { NOTE_BAND, noteColorOf } from "./note-colors";
import { readLessonPosition, useJumpToNote } from "./use-lesson-position";

const MAX_NOTE = 10000;

function NoteRow({
  note,
  focused,
  canAskDoubt,
}: {
  note: LearnerNote;
  focused: boolean;
  canAskDoubt: boolean;
}) {
  const { t } = useTranslation("notebook");
  const updateNote = useLessonNotesStore((state) => state.updateNote);
  const removeNote = useLessonNotesStore((state) => state.removeNote);
  const clearFocus = useLessonNotesStore((state) => state.clearFocus);
  const closePanel = useLessonNotesStore((state) => state.closePanel);
  const openDoubt = useDoubtSidebarStore((state) => state.openWithDraft);
  const jump = useJumpToNote();
  const rowRef = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState(focused);
  const [text, setText] = useState(note.note_text ?? "");

  useEffect(() => {
    if (!focused) return;
    setEditing(true);
    rowRef.current?.scrollIntoView({ block: "nearest" });
    clearFocus();
  }, [focused, clearFocus]);

  const position = notePosition(note, { page: (page) => t("pageNumber", { page }) });
  const save = () => {
    updateNote(note.id, { note_text: text.trim() || null });
    setEditing(false);
  };
  const quote = note.quote_text?.trim();
  const fallback =
    note.kind === "BOOKMARK" ? t("kind.bookmark") : note.kind === "AREA" ? t("kind.area") : null;

  return (
    <li ref={rowRef} className="flex gap-2 rounded-lg border border-neutral-200 bg-white p-2.5" data-note-row={note.kind}>
      <span aria-hidden className={cn("w-1 shrink-0 rounded-full", NOTE_BAND[noteColorOf(note.color)])} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1">
          {position ? (
            <button
              type="button"
              onClick={() =>
                jump({
                  ...(note.page_index !== null && note.page_index !== undefined
                    ? { page_index: note.page_index }
                    : {}),
                  ...(note.time_ms !== null && note.time_ms !== undefined ? { time_ms: note.time_ms } : {}),
                })
              }
              className="rounded-md bg-primary-50 px-1.5 py-0.5 text-2xs font-semibold text-neutral-800 transition-colors hover:bg-primary-100"
            >
              {position}
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            aria-label={t("editNote")}
            onClick={() => setEditing((on) => !on)}
            className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
          >
            <PencilSimple size={14} />
          </button>
          {canAskDoubt && (
            <button
              type="button"
              aria-label={t("askDoubtAboutThis")}
              onClick={() => {
                // The panel sits above the doubts sheet, so it has to make way.
                closePanel();
                openDoubt({
                  text: quote ?? note.note_text ?? "",
                  position: note.page_index ?? note.time_ms ?? undefined,
                });
              }}
              className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
            >
              <ChatText size={14} />
            </button>
          )}
          <button
            type="button"
            aria-label={t("deleteNote")}
            onClick={() => removeNote(note.id)}
            className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
          >
            <Trash size={14} />
          </button>
        </div>
        {quote && <p className="line-clamp-4 text-caption text-neutral-600">{quote}</p>}
        {!quote && !note.note_text && fallback && (
          <p className="text-caption text-neutral-500">{fallback}</p>
        )}
        {editing ? (
          <div className="space-y-1.5">
            <Textarea
              autoFocus
              value={text}
              maxLength={MAX_NOTE}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("notePlaceholder")}
              aria-label={t("notePlaceholder")}
              className="min-h-16"
            />
            <div className="flex justify-end">
              <MyButton buttonType="primary" scale="small" className="min-w-0 px-3" onClick={save}>
                {t("save")}
              </MyButton>
            </div>
          </div>
        ) : (
          note.note_text && <p className="whitespace-pre-wrap text-caption text-neutral-800">{note.note_text}</p>
        )}
      </div>
    </li>
  );
}

/**
 * The lesson's notes, beside the lesson: a side panel on desktop and a
 * half-height sheet on phones, so what the learner is writing about stays in
 * view. Never modal, for the same reason.
 */
export function LessonNotesPanel() {
  const { t } = useTranslation("notebook");
  const open = useLessonNotesStore((state) => state.panelOpen);
  const notes = useLessonNotesStore((state) => state.notes);
  const context = useLessonNotesStore((state) => state.context);
  const focusNoteId = useLessonNotesStore((state) => state.focusNoteId);
  const areaMode = useLessonNotesStore((state) => state.areaMode);
  const pending = useLessonNotesStore((state) => state.pending);
  const addNote = useLessonNotesStore((state) => state.addNote);
  const removeNote = useLessonNotesStore((state) => state.removeNote);
  const closePanel = useLessonNotesStore((state) => state.closePanel);
  const setAreaMode = useLessonNotesStore((state) => state.setAreaMode);
  const activeItem = useContentStore((state) => state.activeItem);
  const currentPage = useMediaRefsStore((state) => state.currentPdfPage);
  const pauseMedia = useMediaRefsStore((state) => state.pauseActiveMedia);
  const tutor = useAvailableTutor();
  const [draft, setDraft] = useState("");
  const [canAskDoubt, setCanAskDoubt] = useState(true);

  useEffect(() => {
    getStudentDisplaySettings(false)
      .then((settings) => setCanAskDoubt(settings?.courseDetails?.slidesView?.canAskDoubt !== false))
      .catch(() => setCanAskDoubt(true));
  }, []);

  const isPdf = activeItem?.source_type === "DOCUMENT" && activeItem.document_slide?.type === "PDF";
  const sorted = useMemo(() => sortByPosition(notes), [notes]);
  const pageBookmark = useMemo(
    () => (isPdf ? notes.find((n) => n.kind === "BOOKMARK" && n.page_index === currentPage) : undefined),
    [isPdf, notes, currentPage],
  );
  const tutorMaterial = useMemo(() => notesForTutor(sorted), [sorted]);

  if (!open || typeof document === "undefined") return null;

  const saveDraft = () => {
    const text = draft.trim();
    if (!text) return;
    addNote({ kind: "NOTE", color: "blue", note_text: text, ...readLessonPosition() });
    setDraft("");
  };
  const position = notePosition(
    { id: "", institute_id: "", slide_id: "", kind: "NOTE", ...readLessonPosition() },
    { page: (page) => t("pageNumber", { page }) },
  );

  return createPortal(
    <aside
      data-notes-panel
      aria-label={t("panelTitle")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-60 flex h-1/2 flex-col rounded-t-2xl border-t border-neutral-200 bg-white shadow-lg",
        "sm:inset-x-auto sm:inset-y-0 sm:end-0 sm:h-full sm:w-vw-60 sm:min-w-reg-350 sm:max-w-reg-420 sm:rounded-none sm:border-s sm:border-t-0 lg:w-vw-35",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <NotePencil size={18} className="shrink-0 text-primary-500" />
        <h2 className="min-w-0 flex-1 truncate text-subtitle font-semibold text-neutral-900">
          {t("panelTitle")}
          {notes.length > 0 && <span className="ms-1 font-normal text-neutral-500">{notes.length}</span>}
        </h2>
        <Link to="/notebook" className="whitespace-nowrap text-caption font-medium text-primary-500 hover:underline">
          {t("openNotebook")}
        </Link>
        <button
          type="button"
          aria-label={t("close")}
          onClick={closePanel}
          className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-neutral-100 px-3 py-2">
        {isPdf && (
          <>
            <MyButton
              buttonType="secondary"
              scale="small"
              className="min-w-0 px-2.5"
              onClick={() => {
                if (pageBookmark) removeNote(pageBookmark.id);
                else addNote({ kind: "BOOKMARK", color: "yellow", page_index: currentPage });
              }}
            >
              <BookmarkSimple size={14} weight={pageBookmark ? "fill" : "regular"} className="me-1" />
              {pageBookmark ? t("removeBookmark") : t("bookmarkPage")}
            </MyButton>
            <MyButton
              buttonType={areaMode ? "primary" : "secondary"}
              scale="small"
              className="min-w-0 px-2.5"
              onClick={() => setAreaMode(!areaMode)}
            >
              <Selection size={14} className="me-1" />
              {t("markArea")}
            </MyButton>
          </>
        )}
        {tutor && tutorMaterial && (
          <MyButton
            buttonType="secondary"
            scale="small"
            className="min-w-0 px-2.5"
            onClick={() => {
              closePanel();
              tutor.openAndSend(
                t("tutorPrompt.quizLesson", {
                  lesson: context?.slide_title ?? "",
                  notes: tutorMaterial,
                }),
              );
            }}
          >
            <Exam size={14} className="me-1" />
            {t("quizMe")}
          </MyButton>
        )}
      </div>
      {areaMode && (
        <p className="shrink-0 bg-primary-50 px-3 py-1.5 text-caption text-neutral-700">{t("markAreaHint")}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {sorted.length === 0 ? (
          <p className="py-4 text-center text-caption text-neutral-500">
            {isPdf || activeItem?.source_type === "DOCUMENT" ? t("emptyDocument") : t("emptyVideo")}
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((note) => (
              <NoteRow key={note.id} note={note} focused={note.id === focusNoteId} canAskDoubt={canAskDoubt} />
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 space-y-1.5 border-t border-neutral-200 p-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"> {/* design-lint-ignore: safe-area viewport math */}
        {pending > 0 && (
          <p className="flex items-center gap-1 text-2xs text-neutral-500">
            <CloudSlash size={12} />
            {t("savedOnDevice")}
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            maxLength={MAX_NOTE}
            onFocus={() => pauseMedia?.()}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={position ? t("writeAt", { position }) : t("notePlaceholder")}
            aria-label={t("notePlaceholder")}
            className="min-h-10"
            rows={1}
          />
          <MyButton buttonType="primary" scale="small" className="min-w-0 shrink-0 px-3" disabled={!draft.trim()} onClick={saveDraft}>
            {t("save")}
          </MyButton>
        </div>
      </div>
    </aside>,
    document.body,
  );
}
