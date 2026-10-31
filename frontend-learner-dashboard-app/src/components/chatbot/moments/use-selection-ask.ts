import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { SELECTION_MIN_CHARS } from "./tutor-moments";
import { FRAME_SELECTION_EVENT, type FrameSelectionDetail } from "./frame-selection";

/** A usable text selection inside the watched container, in viewport coordinates. */
export interface AskableSelection {
  text: string;
  rect: { top: number; bottom: number; left: number; right: number };
}

/** Inputs, editors and code panes: selecting there is editing, not asking. */
const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .ProseMirror, .monaco-editor, .cm-editor';

function isEditable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.closest(EDITABLE);
}

/**
 * Watches text selection inside ONE opted-in container (a lesson document, a
 * quiz explanation…) and reports a selection worth asking about: at least
 * SELECTION_MIN_CHARS characters, fully inside the container, not in an input
 * or editor. Listeners exist only while the container is mounted and
 * `enabled` is true; `selectionchange` has to be heard on the document, but
 * anything outside the container is ignored.
 *
 * Text selected inside a sandboxed document frame in the container (creative
 * HTML slides) arrives as FRAME_SELECTION_EVENT, already in viewport
 * coordinates (see frame-selection.ts).
 *
 * Mouse: evaluated on pointer-up, never mid-drag. Touch and keyboard (the
 * native handles, Shift+arrows): `selectionchange`, debounced. Hidden on
 * scroll or resize; `dismiss()` (Escape, a press outside, an action taken)
 * keeps that selection hidden until the learner selects something else.
 */
export function useSelectionAsk(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): { selection: AskableSelection | null; dismiss: () => void; hold: () => void } {
  const [selection, setSelection] = useState<AskableSelection | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const pointerDownRef = useRef(false);
  const holdUntilRef = useRef(0);

  /**
   * Keep the pill up briefly while it is being pressed: on phones a tap
   * anywhere clears the selection, which would otherwise unmount the pill
   * before its button's click lands.
   */
  const hold = useCallback(() => {
    holdUntilRef.current = Date.now() + 800;
  }, []);

  const dismiss = useCallback(() => {
    setSelection((current) => {
      if (current) dismissedRef.current = current.text;
      return null;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      setSelection(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;

    const evaluate = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        const held = holdUntilRef.current - Date.now();
        if (held > 0) {
          schedule(held + 20); // look again once the press is over
          return;
        }
        dismissedRef.current = null;
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const root = containerRef.current;
      if (
        !root ||
        !root.contains(range.commonAncestorContainer) ||
        isEditable(range.commonAncestorContainer) ||
        isEditable(document.activeElement)
      ) {
        setSelection(null);
        return;
      }
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (text.length < SELECTION_MIN_CHARS || text === dismissedRef.current) {
        setSelection(null);
        return;
      }
      const box = range.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) {
        setSelection(null);
        return;
      }
      setSelection({
        text,
        rect: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
      });
    };
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(evaluate, ms);
    };

    const onSelectionChange = () => {
      if (pointerDownRef.current) return; // a mouse drag in progress: wait for pointer-up
      schedule(250);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") pointerDownRef.current = true;
    };
    const onPointerUp = () => {
      pointerDownRef.current = false;
      schedule(60);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.startsWith("Arrow") || e.key === "a") schedule(150);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    container.addEventListener("pointerdown", onPointerDown);
    // Pointer-up can land outside the container after a drag.
    document.addEventListener("pointerup", onPointerUp);
    container.addEventListener("keyup", onKeyUp);
    return () => {
      if (timer) clearTimeout(timer);
      pointerDownRef.current = false;
      document.removeEventListener("selectionchange", onSelectionChange);
      container.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("keyup", onKeyUp);
    };
  }, [containerRef, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onFrameSelection = (e: Event) => {
      const { frame, text: raw, rect } = (e as CustomEvent<FrameSelectionDetail>).detail ?? {};
      if (!frame || !containerRef.current?.contains(frame)) return;
      const text = (raw ?? "").replace(/\s+/g, " ").trim();
      if (!text || !rect) {
        if (holdUntilRef.current > Date.now()) return; // the pill is being pressed
        dismissedRef.current = null;
        setSelection(null);
        return;
      }
      if (text.length < SELECTION_MIN_CHARS || text === dismissedRef.current) {
        setSelection(null);
        return;
      }
      setSelection({ text, rect });
    };
    window.addEventListener(FRAME_SELECTION_EVENT, onFrameSelection);
    return () => window.removeEventListener(FRAME_SELECTION_EVENT, onFrameSelection);
  }, [containerRef, enabled]);

  // While shown: hide on scroll (any scroller) and on resize. Not remembered as
  // dismissed: the next pointer-up or selection change shows it again in place.
  const visible = selection !== null;
  useEffect(() => {
    if (!visible) return;
    const hide = () => setSelection(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [visible]);

  return { selection, dismiss, hold };
}
