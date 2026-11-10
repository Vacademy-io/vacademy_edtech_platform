/**
 * DOM helpers for the CBE (Spreadsheet & Written Response) answer area.
 *
 * The kit marks the learner's editable answer surfaces — each spreadsheet
 * editor and document editor, not the part prompts or tabs around them — with
 * `data-cbe-workspace`; the live test's proctoring uses this to let copy, cut
 * and text selection work inside the learner's own answer while they stay
 * blocked everywhere else (the question text included).
 */

export const CBE_WORKSPACE_ATTR = "data-cbe-workspace";
export const CBE_WORKSPACE_SELECTOR = `[${CBE_WORKSPACE_ATTR}]`;

/** True when `target` (an event target) sits inside a CBE workspace. */
export function isInsideCbeWorkspace(target: EventTarget | null | undefined): boolean {
  if (!target || typeof (target as Node).nodeType !== "number") return false;
  const node = target as Node;
  const element =
    node.nodeType === 1 /* ELEMENT_NODE */ ? (node as Element) : node.parentElement;
  return !!element?.closest?.(CBE_WORKSPACE_SELECTOR);
}

/** Whitespace-insensitive form used to compare copied and pasted text. */
export const normalizeClipboardText = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim();
