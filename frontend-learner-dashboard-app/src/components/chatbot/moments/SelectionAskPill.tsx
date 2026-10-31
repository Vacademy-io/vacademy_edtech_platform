import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { selectionPrompt, useAvailableTutor, type SelectionAction } from "./tutor-moments";
import { useSelectionAsk, type AskableSelection } from "./use-selection-ask";

const PILL_HEIGHT = 40;
const EDGE = 8;
/** Room left for the phone's own Copy / Select-all bar above a selection. */
const NATIVE_MENU_ROOM = 56;

const ACTIONS: SelectionAction[] = ["explain", "simplify", "quiz"];

interface PillProps {
  selection: AskableSelection;
  lessonName?: string | null;
  containerRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  onAsk: (prompt: string) => void;
  /** Called on press, before the selection may collapse (touch). */
  onPress: () => void;
}

/**
 * Where the pill goes, in viewport pixels. Mouse: just above the selection
 * (below it when there is no room). Touch: below the selection's handles, so
 * the phone's own selection menu (drawn above it) stays reachable; above with
 * room for that menu when the selection sits at the bottom of the screen.
 */
function pillPosition(rect: AskableSelection["rect"], width: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  let top: number;
  if (coarse) {
    top = rect.bottom + 28;
    if (top + PILL_HEIGHT > vh - EDGE) top = rect.top - PILL_HEIGHT - NATIVE_MENU_ROOM;
  } else {
    top = rect.top - PILL_HEIGHT - EDGE;
    if (top < EDGE) top = rect.bottom + EDGE;
  }
  top = Math.min(Math.max(top, EDGE), vh - PILL_HEIGHT - EDGE);
  const center = (rect.left + rect.right) / 2;
  const left = Math.min(Math.max(center - width / 2, EDGE), Math.max(EDGE, vw - width - EDGE));
  return { top, left };
}

function Pill({ selection, lessonName, containerRef, onDismiss, onAsk, onPress }: PillProps) {
  const { t } = useTranslation("chatFeatureB");
  const tutor = useAvailableTutor();
  const pillRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);

  useLayoutEffect(() => {
    const w = pillRef.current?.offsetWidth;
    if (w && w !== width) setWidth(w);
  }, [width, selection]);

  // Escape and a press elsewhere dismiss; Tab from the selection moves into the pill.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const pill = pillRef.current;
      if (!pill) return;
      if (e.key === "Escape") {
        onDismiss();
        return;
      }
      if (e.key === "Tab" && !e.shiftKey && !pill.contains(document.activeElement)) {
        const active = document.activeElement;
        const fromSelection =
          !active || active === document.body || !!containerRef.current?.contains(active);
        if (!fromSelection) return;
        e.preventDefault();
        pill.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!pillRef.current?.contains(e.target as Node)) onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onDismiss, containerRef]);

  const { top, left } = pillPosition(selection.rect, width);
  const name = tutor?.chatbotSettings.assistant_name ?? "";

  return (
    <div
      ref={pillRef}
      role="toolbar"
      aria-label={t("moments.selection.toolbar", { name })}
      // Pressing a button must not clear the learner's selection.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={onPress}
      className="fixed z-50 flex h-10 items-center gap-0.5 rounded-full border border-border bg-card p-1 text-card-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
      style={{ top, left }} // design-lint-ignore: follows the live selection rectangle
    >
      {ACTIONS.map((action, i) => (
        <button
          key={action}
          type="button"
          onClick={() => onAsk(selectionPrompt(t, action, selection.text, lessonName))}
          className={cn(
            "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-3 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            i === 0
              ? "bg-primary text-primary-foreground hover:bg-primary-400"
              : "text-foreground hover:bg-muted",
          )}
        >
          {i === 0 && <Sparkle aria-hidden weight="fill" className="size-3.5" />}
          {t(`moments.selection.${action}`)}
        </button>
      ))}
    </div>
  );
}

export interface SelectionAskProps {
  /** The opted-in container whose text can be asked about. */
  containerRef: RefObject<HTMLElement | null>;
  /** Lesson (or quiz / task) title quoted in the request. */
  lessonName?: string | null;
  /** Extra gate from the host, e.g. only for document slides. */
  enabled?: boolean;
}

/**
 * Select-to-ask for a container the host already renders: select 12+
 * characters and a small pill offers Explain · Simplify · Quiz me, each sending
 * a complete request that quotes the selection. Renders nothing unless the
 * tutor is available on this page (enabled, visible on the route — never on
 * `/assessment/**` — and not in a voice call).
 */
export function SelectionAsk({ containerRef, lessonName, enabled = true }: SelectionAskProps) {
  const tutor = useAvailableTutor();
  const active = enabled && !!tutor;
  const { selection, dismiss, hold } = useSelectionAsk(containerRef, active);
  if (!active || !selection || typeof document === "undefined") return null;
  return createPortal(
    <Pill
      selection={selection}
      lessonName={lessonName}
      containerRef={containerRef}
      onDismiss={dismiss}
      onPress={hold}
      onAsk={(prompt) => {
        dismiss();
        tutor.openAndSend(prompt);
      }}
    />,
    document.body,
  );
}

/** A block whose text can be asked about — a wrapper around `SelectionAsk`. */
export function SelectionAskZone({
  children,
  lessonName,
  enabled = true,
  className,
}: {
  children: ReactNode;
  lessonName?: string | null;
  enabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className={className}>
      {children}
      <SelectionAsk containerRef={ref} lessonName={lessonName} enabled={enabled} />
    </div>
  );
}
