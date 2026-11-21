import { useTranslation } from "react-i18next";
import { NotePencil } from "@phosphor-icons/react";
import type { AskableSelection } from "@/components/chatbot/moments/use-selection-ask";
import { pdfRectsFromRange } from "@/lib/notes/anchors";
import { NOTE_COLORS, type NoteColor } from "@/lib/notes/types";
import { useLessonNotesStore } from "@/stores/study-library/lesson-notes-store";
import { cn } from "@/lib/utils";
import { NOTE_DOT } from "./note-colors";

const MAX_QUOTE = 4000;

/** Highlight colours and "add a note", shown beside a text selection in a lesson. */
export function NoteSelectionTools({
  selection,
  onDone,
}: {
  selection: AskableSelection;
  onDone: () => void;
}) {
  const { t } = useTranslation("notebook");
  const addNote = useLessonNotesStore((state) => state.addNote);
  const openPanel = useLessonNotesStore((state) => state.openPanel);

  const save = (color: NoteColor, thenWrite: boolean) => {
    const rects = selection.range ? pdfRectsFromRange(selection.range) : [];
    const note = addNote({
      kind: "HIGHLIGHT",
      color,
      quote_text: selection.text.slice(0, MAX_QUOTE),
      ...(rects[0] ? { page_index: rects[0].page, anchor_json: JSON.stringify({ rects }) } : {}),
    });
    document.getSelection()?.removeAllRanges();
    onDone();
    if (note && thenWrite) openPanel(note.id);
  };

  return (
    <div className="flex items-center gap-1" data-notes-tools>
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={t(`highlightIn.${color}`)}
          onClick={() => save(color, false)}
          className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("size-5 rounded-full", NOTE_DOT[color])} />
        </button>
      ))}
      <button
        type="button"
        onClick={() => save("yellow", true)}
        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-2 text-caption font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <NotePencil aria-hidden className="size-3.5" />
        {t("addNote")}
      </button>
    </div>
  );
}
