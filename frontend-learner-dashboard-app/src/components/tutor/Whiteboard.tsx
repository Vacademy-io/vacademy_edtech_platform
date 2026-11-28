import { useEffect, useRef } from "react";
import {
  animateDiagram, drawArrows, isElementOp, mountMediaTask, placeAnnotation, renderOp, revealAllSteps, revealStepsUpTo,
  typesetFormulas, type BoardOp,
} from "./boardRenderer";
import { getPublicUrl } from "@/services/upload_file";
import "@/styles/tutor-board.css";

interface WhiteboardProps {
  /** Cumulative element ops for the current board (topic). */
  ops: BoardOp[];
  /** Live ops from the teacher during a turn: highlight / annotate. */
  liveOps: BoardOp[];
  /** Bumps whenever the board is cleared so entrance animations replay. */
  boardKey: string;
  teacherName?: string;
  /** Bumps when the narration ends: every stepped diagram part still hidden is shown. */
  revealKey?: number;
  /** Narration-synced mode: the sentence being spoken; diagram steps follow it and the newest element pulses. */
  sentence?: number | null;
  /** Ids of the elements to pulse (the ones revealed for the current sentence). */
  focusIds?: string[];
}

/**
 * The whiteboard. Elements are appended (never re-rendered) so an element that
 * is already on the board keeps its place while new ones write themselves in;
 * live highlights toggle a class on the target by data-op-id. After each
 * insertion formulas are typeset, arrows are drawn between their targets and
 * media tasks get their player.
 */
export const Whiteboard: React.FC<WhiteboardProps> = ({ ops, liveOps, boardKey, teacherName, revealKey, sentence, focusIds }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef(boardKey);
  const synced = sentence !== undefined && sentence !== null;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (lastKeyRef.current !== boardKey) {
      root.innerHTML = "";
      renderedRef.current = new Set();
      lastKeyRef.current = boardKey;
    }
    for (const op of ops) {
      if (!isElementOp(op)) continue;
      const id = String(op.id ?? "");
      if (id && renderedRef.current.has(id)) continue;
      const html = renderOp(op);
      if (!html) continue;
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const el = tmp.firstElementChild as HTMLElement | null;
      if (!el) continue;
      // Annotations dock next to their target when it exists.
      const target = op.op === "annotate" ? root.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(String(op.target ?? ""))}"]`) : null;
      if (target) placeAnnotation(el, target, String(op.position ?? "below"));
      else root.appendChild(el);
      if (id) renderedRef.current.add(id);
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetHeight; // reflow so the entrance animation plays
      el.classList.add("tb-enter");
      // Columns: the nested elements enter with their parent and count as rendered.
      el.querySelectorAll<HTMLElement>(".tb-op").forEach((n) => {
        n.classList.add("tb-enter");
        if (n.dataset.opId) renderedRef.current.add(n.dataset.opId);
      });
      if (el.classList.contains("tb-media-task")) void mountMediaTask(el, getPublicUrl);
      if (op.op === "svg") animateDiagram(el, (op.parts as Array<{ id?: unknown; step?: unknown }>) || [], synced);
      el.querySelectorAll<HTMLElement>(".tb-media-task").forEach((m) => void mountMediaTask(m, getPublicUrl));
    }
    typesetFormulas(root);
    drawArrows(root);
    // Again once entrance transforms, fonts and lazy images have settled.
    const t = window.setTimeout(() => drawArrows(root), 1000);
    root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });
    return () => window.clearTimeout(t);
  }, [ops, boardKey, synced]);

  useEffect(() => {
    if (rootRef.current && revealKey) revealAllSteps(rootRef.current);
  }, [revealKey]);

  // Narration sync: diagram steps at or before the spoken sentence appear,
  // and the elements written for this sentence pulse once.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !synced) return;
    revealStepsUpTo(root, sentence as number);
    root.querySelectorAll(".tb-focus").forEach((n) => n.classList.remove("tb-focus"));
    for (const id of focusIds ?? []) {
      const el = root.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(id)}"]`);
      if (el) el.classList.add("tb-focus");
    }
  }, [sentence, focusIds, synced]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onResize = () => drawArrows(root);
    window.addEventListener("resize", onResize);
    // Images and embeds change the layout when they load (capture: load does not bubble).
    root.addEventListener("load", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      root.removeEventListener("load", onResize, true);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll(".tb-live").forEach((n) => n.remove());
    root.querySelectorAll(".tb-highlight").forEach((n) => n.classList.remove("tb-highlight"));
    for (const op of liveOps) {
      if (op.op === "highlight" || op.op === "unhighlight") {
        const t = root.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(String(op.target ?? ""))}"], #${CSS.escape(String(op.target ?? ""))}`);
        if (t) t.classList.toggle("tb-highlight", op.op === "highlight");
      } else if (op.op === "annotate") {
        const t = root.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(String(op.target ?? ""))}"]`);
        const html = renderOp(op);
        if (!html) continue;
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        const el = tmp.firstElementChild as HTMLElement | null;
        if (!el) continue;
        el.classList.add("tb-live", "tb-enter");
        if (t) t.insertAdjacentElement("afterend", el);
        else root.appendChild(el);
      }
    }
    drawArrows(root);
  }, [liveOps]);

  return (
    <div className="tutor-board-preview relative h-full">
      <div ref={rootRef} className="tutor-board h-full overflow-y-auto" aria-live="polite" aria-label={teacherName ? `${teacherName}'s whiteboard` : "whiteboard"} />
    </div>
  );
};
