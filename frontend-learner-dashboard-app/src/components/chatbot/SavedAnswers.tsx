import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, BookmarkSimple, CaretDown, SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { chatbotAPI, type SavedAnswer } from "@/services/chatbot-api";
import { useChatbotContext } from "./useChatbotContext";
import { ChatMarkdown } from "./MessageBubble";
import { relativeTime } from "./history-time";

type LoadState = "loading" | "ready" | "error";

const SavedAnswerItem: React.FC<{
  item: SavedAnswer;
  busy: boolean;
  onOpen: () => void;
  onUnsave: () => void;
}> = ({ item, busy, onOpen, onUnsave }) => {
  const { t, i18n } = useTranslation("chatFeatureB");
  const [expanded, setExpanded] = useState(false);
  const when = relativeTime(item.saved_at, t, i18n.language);
  const bodyId = `saved-answer-${item.message_id}`;

  return (
    <li className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex w-full items-start gap-2 px-3 pt-2.5 pb-1 text-start transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 text-sm font-semibold text-foreground line-clamp-2">
          {item.question?.trim() || t("saved.untitled")}
        </span>
        <CaretDown
          className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {/* Tapping the excerpt expands it too; the button above is the keyboard control. */}
      <div
        id={bodyId}
        onClick={() => !expanded && setExpanded(true)}
        className={cn(
          "px-3 pb-2 text-muted-foreground",
          // About four lines of the answer (leading-6) until expanded.
          !expanded && "max-h-24 cursor-pointer overflow-hidden",
        )}
      >
        <ChatMarkdown>{item.content}</ChatMarkdown>
      </div>
      <div className="flex items-center gap-1 border-t border-border/40 px-2 py-1">
        {when && <span className="flex-1 truncate px-1 text-caption text-muted-foreground">{when}</span>}
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="ms-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-caption font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowSquareOut className="size-3.5" aria-hidden="true" />
          {t("saved.openChat")}
        </button>
        <button
          type="button"
          onClick={onUnsave}
          disabled={busy}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BookmarkSimple className="size-3.5" weight="fill" aria-hidden="true" />
          {t("saved.unsave")}
        </button>
      </div>
    </li>
  );
};

/**
 * Replies the learner saved, across chats: the question as the title, the
 * answer clamped to a few lines (tap to expand), "Open chat" and "Unsave".
 */
export const SavedAnswersList: React.FC<{
  id: string;
  labelledBy: string;
  /** Called after a chat was opened from the list (back to the conversation). */
  onOpened: () => void;
}> = ({ id, labelledBy, onOpened }) => {
  const { t } = useTranslation("chatFeatureB");
  const { openSession, setSaved } = useChatbotContext();
  const [items, setItems] = useState<SavedAnswer[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    setLoadState("loading");
    chatbotAPI
      .listSaved(50)
      .then((list) => {
        if (!mountedRef.current) return;
        setItems(list);
        setLoadState("ready");
      })
      .catch((err) => {
        console.error("[chatbot] could not load saved answers:", err);
        if (mountedRef.current) setLoadState("error");
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const handleOpen = async (item: SavedAnswer) => {
    if (busyId !== null) return;
    setError(null);
    setBusyId(item.message_id);
    const opened = await openSession(item.session_id);
    if (!mountedRef.current) return;
    setBusyId(null);
    if (opened) onOpened();
    else setError(t("history.openError"));
  };

  const handleUnsave = async (item: SavedAnswer) => {
    if (busyId !== null) return;
    setError(null);
    setBusyId(item.message_id);
    // Optimistic: the answer leaves the list and comes back if the server refuses.
    const index = items.findIndex((x) => x.message_id === item.message_id);
    setItems((prev) => prev.filter((x) => x.message_id !== item.message_id));
    const ok = await setSaved(item.message_id, false, item.session_id);
    if (!mountedRef.current) return;
    setBusyId(null);
    if (!ok) {
      setItems((prev) => {
        if (prev.some((x) => x.message_id === item.message_id)) return prev;
        const next = [...prev];
        next.splice(Math.max(0, index), 0, item);
        return next;
      });
      setError(t("saved.unsaveError"));
    }
  };

  return (
    <ScrollArea
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      className="flex-1 min-h-0 [&>[data-radix-scroll-area-viewport]>div]:!block"
    >
      <div className="flex flex-col gap-2 p-2.5">
        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {loadState === "loading" && items.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground" role="status">
            <SpinnerGap className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            {t("saved.loading")}
          </div>
        )}

        {loadState === "error" && items.length === 0 && (
          <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-xs text-destructive">{t("saved.loadError")}</p>
            <button type="button" onClick={refresh} className="text-xs text-primary underline hover:text-primary/80">
              {t("common.retry")}
            </button>
          </div>
        )}

        {loadState === "ready" && items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookmarkSimple className="size-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium text-foreground">{t("saved.empty")}</p>
            <p className="max-w-reg-250 text-caption text-muted-foreground">{t("saved.emptyHint")}</p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t("saved.listLabel")}>
            {items.map((item) => (
              <SavedAnswerItem
                key={item.message_id}
                item={item}
                busy={busyId !== null}
                onOpen={() => void handleOpen(item)}
                onUnsave={() => void handleUnsave(item)}
              />
            ))}
          </ul>
        )}
      </div>
    </ScrollArea>
  );
};
