import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { EngagementFeed, EngagementItem } from "@/services/engagement";
import { isCompleted } from "./engagement-copy";
import { usePinnedUpNext } from "./engagement-draft-store";
import { findEngagementItem, useEngagementFeed } from "./use-engagement-feed";
import { EngagementTaskRunner } from "./runner/EngagementTaskRunner";
import { openLessonTarget, useLessonReturn } from "./runner/use-lesson-return";

/**
 * The one place a Daily Engagement task opens (learner plan §3.1, §3.5).
 *
 * Mount `EngagementTaskHostProvider` ABOVE everything that opens tasks (the
 * Today module in either slot, the `/engagement` page), so a resize that moves
 * the module between slots never drops an open runner. It owns:
 * - the single runner Sheet;
 * - `open(itemId, {queue, readOnly, item})` and `openSlot(slotId)` (the push
 *   notification deep link, D49);
 * - "Next task" through the queue;
 * - the lesson round trip: "Open lesson" goes straight to the slide, and the
 *   claim happens silently when the learner comes back (D12).
 */

export interface EngagementTaskOpenOptions {
  /** The order "Next" walks (item ids). Default: today's tasks, then catch-ups. */
  queue?: string[];
  /** Show the task and its result without an action (a Done row). */
  readOnly?: boolean;
  /** The row the opener already has, so the header shows at once. */
  item?: EngagementItem;
}

export interface EngagementTaskHostValue {
  open: (itemId: string, opts?: EngagementTaskOpenOptions) => void;
  openSlot: (slotId: string) => void;
  close: () => void;
}

const EngagementTaskHostContext = createContext<EngagementTaskHostValue | null>(null);

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

/** Today's tasks then the catch-ups, when `itemId` is one of them. */
export function defaultQueue(feed: EngagementFeed | null | undefined, itemId: string): string[] | null {
  if (!feed) return null;
  const ids = [...feed.items, ...feed.catchUp].map((i) => i.id);
  return ids.includes(itemId) ? ids : null;
}

/**
 * The task after `currentId` that still needs doing: the next one in the queue,
 * wrapping round to earlier ones the learner skipped. Null when none is left.
 */
export function nextTaskId(
  queue: readonly string[] | null | undefined,
  currentId: string,
  isDone: (itemId: string) => boolean
): string | null {
  if (!queue || queue.length === 0) return null;
  const at = queue.indexOf(currentId);
  const ordered = at < 0 ? [...queue] : [...queue.slice(at + 1), ...queue.slice(0, at)];
  return ordered.find((id) => id !== currentId && !isDone(id)) ?? null;
}

/**
 * What a slot deep link opens: its first task still to do (with the slot's open
 * tasks as the queue), else a finished one read-only. Null when the slot isn't
 * in the feed any more.
 */
export function slotTarget(
  feed: EngagementFeed | null | undefined,
  slotId: string
): { itemId: string; queue: string[]; readOnly: boolean } | null {
  if (!feed) return null;
  const open = [...feed.items, ...feed.catchUp].filter((i) => i.slotId === slotId && !isCompleted(i));
  if (open.length > 0) return { itemId: open[0]!.id, queue: open.map((i) => i.id), readOnly: false };
  const finished =
    feed.doneToday.find((i) => i.slotId === slotId) ??
    [...feed.items, ...feed.catchUp].find((i) => i.slotId === slotId);
  return finished ? { itemId: finished.id, queue: [finished.id], readOnly: true } : null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

// ── Provider ────────────────────────────────────────────────────────────────

interface HostSession {
  itemId: string;
  queue: string[] | null;
  readOnly: boolean;
  seed: EngagementItem | null;
}

export function EngagementTaskHostProvider({
  children,
  showGamification = true,
}: {
  children: ReactNode;
  /** The dashboard's gamification switch: off hides points, rewards and celebrations. */
  showGamification?: boolean;
}) {
  const { t } = useTranslation("dashboardEngagement");
  const navigate = useNavigate();
  const { feed, status } = useEngagementFeed();
  const { pinnedId, release } = usePinnedUpNext();
  const [session, setSession] = useState<HostSession | null>(null);
  const [visible, setVisible] = useState(false);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef(feed);
  feedRef.current = feed;

  useLessonReturn({ showPoints: showGamification });

  const show = useCallback(
    (itemId: string, opts: EngagementTaskOpenOptions = {}) => {
      const current = feedRef.current;
      const seed = opts.item ?? findEngagementItem(current, itemId) ?? null;
      // A lesson goes straight to its slide; the claim happens on the way back.
      if (
        !opts.readOnly &&
        seed &&
        seed.itemType === "COURSE_SLIDE" &&
        !isCompleted(seed) &&
        seed.claimable !== true &&
        openLessonTarget(navigate, seed)
      ) {
        setVisible(false);
        return;
      }
      setSession({
        itemId,
        queue: opts.queue && opts.queue.length > 0 ? opts.queue : defaultQueue(current, itemId),
        readOnly: Boolean(opts.readOnly),
        seed,
      });
      setVisible(true);
    },
    [navigate]
  );

  const open = useCallback(
    (itemId: string, opts?: EngagementTaskOpenOptions) => {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      show(itemId, opts);
    },
    [show]
  );

  const openSlot = useCallback((slotId: string) => {
    if (slotId) setPendingSlot(slotId);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  // Resolve a slot deep link once the feed has loaded.
  useEffect(() => {
    if (!pendingSlot || status === "loading") return;
    const target = status === "ready" ? slotTarget(feed, pendingSlot) : null;
    setPendingSlot(null);
    if (!target) {
      toast(t("runner.slotMissing"));
      return;
    }
    show(target.itemId, { queue: target.queue, readOnly: target.readOnly });
  }, [pendingSlot, status, feed, show, t]);

  const isDone = useCallback(
    (itemId: string) => {
      const row = findEngagementItem(feed, itemId);
      return row ? isCompleted(row) : false;
    },
    [feed]
  );

  const nextId = session && !session.readOnly ? nextTaskId(session.queue, session.itemId, isDone) : null;
  const nextItem = nextId ? (findEngagementItem(feed, nextId) ?? null) : null;
  const position = useMemo(() => {
    if (!session?.queue) return null;
    const index = session.queue.indexOf(session.itemId);
    return index < 0 ? null : { index, total: session.queue.length };
  }, [session]);

  const goNext = useCallback(() => {
    if (!session || !nextItem) return;
    // The Today module keeps an answered task pinned until the learner moves on.
    if (pinnedId === session.itemId) release();
    show(nextItem.id, { queue: session.queue ?? undefined, item: nextItem });
  }, [session, nextItem, pinnedId, release, show]);

  const onOpenChange = useCallback((next: boolean) => {
    setVisible(next);
  }, []);

  // D41: give focus back to the row that opened the runner, or the next row.
  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      const opener = returnFocusRef.current;
      const nextRow = nextId
        ? document.querySelector<HTMLElement>(`[data-engagement-item-id="${cssEscape(nextId)}"]`)
        : null;
      const target = opener && opener.isConnected ? opener : nextRow;
      if (target) {
        event.preventDefault();
        target.focus({ preventScroll: false });
      }
      returnFocusRef.current = null;
    },
    [nextId]
  );

  const value = useMemo<EngagementTaskHostValue>(() => ({ open, openSlot, close }), [open, openSlot, close]);

  return (
    <EngagementTaskHostContext.Provider value={value}>
      {children}
      <EngagementTaskRunner
        open={visible && session != null}
        onOpenChange={onOpenChange}
        itemId={session?.itemId ?? null}
        seed={session?.seed ?? null}
        readOnly={session?.readOnly}
        position={position}
        nextItem={nextItem}
        onNext={goNext}
        showPoints={showGamification}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    </EngagementTaskHostContext.Provider>
  );
}

const MISSING_HOST: EngagementTaskHostValue = {
  open: () => {
    if (import.meta.env.DEV) {
      console.warn("[engagement] useEngagementTaskHost() used outside EngagementTaskHostProvider");
    }
  },
  openSlot: () => {},
  close: () => {},
};

/**
 * Open, deep-link or close the task runner. Outside a provider it returns a
 * no-op (with a dev warning) rather than throwing, so a surface rendered
 * without the host degrades to "nothing opens" instead of crashing the page.
 */
export function useEngagementTaskHost(): EngagementTaskHostValue {
  return useContext(EngagementTaskHostContext) ?? MISSING_HOST;
}
