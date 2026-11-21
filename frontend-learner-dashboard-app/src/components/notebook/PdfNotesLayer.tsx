import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkSimple, NotePencil } from "@phosphor-icons/react";
import type { Plugin, PluginRenderPageLayer } from "@react-pdf-viewer/core";
import { dragRect, parseAnchor } from "@/lib/notes/anchors";
import { useLessonNotesStore } from "@/stores/study-library/lesson-notes-store";
import type { LearnerNote, NoteRect } from "@/lib/notes/types";
import { cn } from "@/lib/utils";
import { NOTE_BAND, NOTE_EDGE, noteColorOf } from "./note-colors";

const MIN_AREA_PERCENT = 1.5;

const placement = (rect: Pick<NoteRect, "x" | "y" | "w" | "h">) => ({
  left: `${rect.x}%`,
  top: `${rect.y}%`,
  width: `${rect.w}%`,
  height: `${rect.h}%`,
});

function rectsOnPage(note: LearnerNote, pageIndex: number): NoteRect[] {
  return (parseAnchor(note.anchor_json).rects ?? []).filter((rect) => rect.page === pageIndex);
}

/** Draws a learner's marks on one PDF page, and takes the drag for "mark an area". */
function PdfNotesLayer({ pageIndex }: { pageIndex: number }) {
  const { t } = useTranslation("notebook");
  const notes = useLessonNotesStore((state) => state.notes);
  const areaMode = useLessonNotesStore((state) => state.areaMode);
  const addNote = useLessonNotesStore((state) => state.addNote);
  const openPanel = useLessonNotesStore((state) => state.openPanel);
  const setAreaMode = useLessonNotesStore((state) => state.setAreaMode);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<NoteRect | null>(null);

  const marks = useMemo(
    () =>
      notes.flatMap((note) => {
        const rects = rectsOnPage(note, pageIndex);
        return rects.length > 0 ? [{ note, rects }] : [];
      }),
    [notes, pageIndex],
  );
  const bookmarked = useMemo(
    () => notes.find((note) => note.kind === "BOOKMARK" && note.page_index === pageIndex),
    [notes, pageIndex],
  );

  const pointAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * 100,
      y: ((e.clientY - box.top) / box.height) * 100,
    };
  };

  const finishArea = (rect: NoteRect | null) => {
    startRef.current = null;
    setDraft(null);
    if (!rect || rect.w < MIN_AREA_PERCENT || rect.h < MIN_AREA_PERCENT) return;
    const note = addNote({
      kind: "AREA",
      color: "yellow",
      page_index: pageIndex,
      anchor_json: JSON.stringify({ rects: [rect] }),
    });
    setAreaMode(false);
    if (note) openPanel(note.id);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-1" data-notes-page={pageIndex}>
      {marks.map(({ note, rects }) =>
        rects.map((rect, index) => (
          <div
            key={`${note.id}-${index}`}
            data-note-mark={note.kind}
            className={cn(
              "absolute",
              note.kind === "AREA"
                ? cn("rounded-sm border-2 opacity-70", NOTE_EDGE[noteColorOf(note.color)])
                : cn("opacity-40 mix-blend-multiply", NOTE_BAND[noteColorOf(note.color)]),
            )}
            style={placement(rect)} // design-lint-ignore: follows the mark's stored position
          />
        )),
      )}

      {marks
        .filter(({ note }) => note.note_text?.trim())
        .map(({ note, rects }) => {
          const last = rects[rects.length - 1] as NoteRect;
          return (
            <button
              key={`${note.id}-open`}
              type="button"
              aria-label={t("openNote")}
              onClick={() => openPanel(note.id)}
              className="pointer-events-auto absolute flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-primary-500 text-white shadow-sm"
              style={{ left: `${Math.min(last.x + last.w, 96)}%`, top: `${last.y}%` }} // design-lint-ignore: follows the mark's stored position
            >
              <NotePencil size={12} weight="fill" />
            </button>
          );
        })}

      {bookmarked && (
        <button
          type="button"
          aria-label={t("openNote")}
          onClick={() => openPanel(bookmarked.id)}
          className="pointer-events-auto absolute end-2 top-0 text-primary-500"
        >
          <BookmarkSimple size={24} weight="fill" />
        </button>
      )}

      {areaMode && (
        <div
          data-notes-area-capture
          className="pointer-events-auto absolute inset-0 cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            startRef.current = pointAt(e);
          }}
          onPointerMove={(e) => {
            if (startRef.current) setDraft(dragRect(pageIndex, startRef.current, pointAt(e)));
          }}
          onPointerUp={(e) => {
            if (startRef.current) finishArea(dragRect(pageIndex, startRef.current, pointAt(e)));
          }}
          onPointerCancel={() => finishArea(null)}
        >
          {draft && (
            <div
              className="absolute rounded-sm border-2 border-primary-500 bg-primary-100 opacity-50"
              style={placement(draft)} // design-lint-ignore: follows the learner's drag
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A viewer plugin: one layer per rendered page. `onScale` reports the viewer's
 * zoom so pinch can start from it.
 */
export function createPdfNotesPlugin(onScale: (scale: number) => void): Plugin {
  return {
    renderPageLayer: (props: PluginRenderPageLayer) => <PdfNotesLayer pageIndex={props.pageIndex} />,
    onViewerStateChange: (state) => {
      onScale(state.scale);
      return state;
    },
  };
}
