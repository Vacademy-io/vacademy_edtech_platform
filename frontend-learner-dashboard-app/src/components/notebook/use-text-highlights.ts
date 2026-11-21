import { useEffect, type RefObject } from "react";
import { findQuote } from "@/lib/notes/anchors";
import { NOTE_COLORS, type LearnerNote } from "@/lib/notes/types";
import { noteColorOf } from "./note-colors";
import "./notes.css";

type HighlightRegistry = { set: (name: string, value: unknown) => void; delete: (name: string) => void };
type HighlightClass = new (...ranges: Range[]) => unknown;

const registry = (): HighlightRegistry | undefined =>
  (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
const HighlightCtor = (): HighlightClass | undefined =>
  (globalThis as unknown as { Highlight?: HighlightClass }).Highlight;

const nameFor = (color: string) => `vac-note-${color}`;

function textNodesIn(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("script, style, textarea, input, [data-notes-panel]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/**
 * Paints saved text highlights on a rich-text lesson by finding their quotes.
 * The lesson may render late or re-render, so it repaints when the content
 * changes. PDFs have their own layer; sandboxed frames cannot be reached.
 */
export function useTextHighlights(
  containerRef: RefObject<HTMLElement | null>,
  notes: LearnerNote[],
  enabled: boolean,
) {
  useEffect(() => {
    const highlights = registry();
    const Ctor = HighlightCtor();
    const root = containerRef.current;
    if (!enabled || !highlights || !Ctor || !root) return;

    const quoted = notes.filter((note) => note.kind === "HIGHLIGHT" && note.quote_text?.trim());
    const paint = () => {
      const nodes = textNodesIn(root);
      const texts = nodes.map((node) => node.data);
      const byColor = new Map<string, Range[]>();
      for (const note of quoted) {
        const hit = findQuote(texts, note.quote_text as string);
        const start = hit && nodes[hit.startNode];
        const end = hit && nodes[hit.endNode];
        if (!hit || !start || !end) continue;
        const range = document.createRange();
        range.setStart(start, hit.startOffset);
        range.setEnd(end, hit.endOffset);
        const color = noteColorOf(note.color);
        byColor.set(color, [...(byColor.get(color) ?? []), range]);
      }
      for (const color of NOTE_COLORS) {
        const ranges = byColor.get(color);
        if (ranges) highlights.set(nameFor(color), new Ctor(...ranges));
        else highlights.delete(nameFor(color));
      }
    };

    paint();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(paint, 300);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      for (const color of NOTE_COLORS) highlights.delete(nameFor(color));
    };
  }, [containerRef, notes, enabled]);
}
