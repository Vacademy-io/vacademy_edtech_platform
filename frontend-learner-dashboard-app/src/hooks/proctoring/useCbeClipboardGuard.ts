import { useEffect, useRef } from "react";
import {
  isInsideCbeWorkspace,
  normalizeClipboardText,
} from "@/lib/cbe/workspace-dom";

type Options = {
  enabled: boolean;
  /** Called once per blocked paste or drop (count it, tell the learner). */
  onBlockedPaste: () => void;
};

/** Fortune-sheet keeps its own last copy here (plain text of the copied range). */
const FORTUNE_LOCAL_CLIPBOARD_KEY = "localClipboard";

const readFortuneClipboard = (): string => {
  try {
    return window.sessionStorage.getItem(FORTUNE_LOCAL_CLIPBOARD_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * Live-test paste policy for the CBE answer workspace (contract §6, Proctoring):
 * copy / cut inside the workspace works, and pasting is allowed only when the
 * clipboard holds what was last copied or cut inside it. Anything else — text
 * from another tab, another app, or the question itself — is blocked and
 * reported through `onBlockedPaste` (counted like CODING's paste attempts).
 *
 * Covers keyboard / browser paste, drag-and-drop, and the spreadsheet's own
 * right-click "Paste" (which reads `navigator.clipboard.readText()`).
 */
export function useCbeClipboardGuard({ enabled, onBlockedPaste }: Options) {
  const onBlockedRef = useRef(onBlockedPaste);
  onBlockedRef.current = onBlockedPaste;
  /** Normalized texts that came from inside the workspace. */
  const allowedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const allowed = allowedRef.current;

    const isAllowedText = (text: string): boolean => {
      const normalized = normalizeClipboardText(text);
      if (!normalized) return true; // nothing to paste
      if (allowed.has(normalized)) return true;
      return normalizeClipboardText(readFortuneClipboard()) === normalized;
    };

    const remember = (...texts: Array<string | null | undefined>) => {
      // Only the latest copy is "the internal clipboard".
      allowed.clear();
      texts.forEach((text) => {
        const normalized = normalizeClipboardText(text);
        if (normalized) allowed.add(normalized);
      });
    };

    // Bubble phase on window: runs after the editors' own copy handlers, so a
    // TipTap / grid copy that wrote clipboardData itself can be read back here.
    const onCopyOrCut = (event: ClipboardEvent) => {
      if (!isInsideCbeWorkspace(event.target)) return;
      remember(
        event.clipboardData?.getData("text/plain"),
        window.getSelection()?.toString()
      );
    };

    const block = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      onBlockedRef.current();
    };

    // Capture phase on window: runs before the grid's document-level paste
    // handler and before the document editor sees the event.
    const onPaste = (event: ClipboardEvent) => {
      if (!isInsideCbeWorkspace(event.target)) return;
      const data = event.clipboardData;
      if (!data) return;
      const text = data.getData("text/plain");
      const hasFiles = data.files && data.files.length > 0;
      if (hasFiles || !isAllowedText(text)) block(event);
    };

    let draggedText = "";
    const onDragStart = (event: DragEvent) => {
      draggedText = isInsideCbeWorkspace(event.target)
        ? normalizeClipboardText(window.getSelection()?.toString())
        : "";
    };
    const onDrop = (event: DragEvent) => {
      if (!isInsideCbeWorkspace(event.target)) return;
      const data = event.dataTransfer;
      if (!data) return;
      const text = normalizeClipboardText(data.getData("text/plain"));
      const hasFiles = data.files && data.files.length > 0;
      const fromInside = !!text && text === draggedText;
      if (hasFiles || (!fromInside && !isAllowedText(text))) block(event);
      draggedText = "";
    };

    window.addEventListener("copy", onCopyOrCut);
    window.addEventListener("cut", onCopyOrCut);
    window.addEventListener("paste", onPaste, { capture: true });
    window.addEventListener("dragstart", onDragStart, { capture: true });
    window.addEventListener("drop", onDrop, { capture: true });

    // The grid's context-menu "Paste" reads the system clipboard directly.
    // Returning "" for foreign text makes it fall back to its own in-sheet copy.
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    let patched = false;
    if (clipboard && typeof clipboard.readText === "function") {
      const original = clipboard.readText.bind(clipboard);
      try {
        Object.defineProperty(clipboard, "readText", {
          configurable: true,
          writable: true,
          value: async () => {
            const text = await original();
            if (isAllowedText(text)) return text;
            onBlockedRef.current();
            return "";
          },
        });
        patched = true;
      } catch {
        patched = false;
      }
    }

    return () => {
      window.removeEventListener("copy", onCopyOrCut);
      window.removeEventListener("cut", onCopyOrCut);
      window.removeEventListener("paste", onPaste, { capture: true });
      window.removeEventListener("dragstart", onDragStart, { capture: true });
      window.removeEventListener("drop", onDrop, { capture: true });
      if (patched && clipboard) {
        // Drop the own property so the prototype's readText shows through again.
        delete (clipboard as unknown as Record<string, unknown>).readText;
      }
    };
  }, [enabled]);
}
