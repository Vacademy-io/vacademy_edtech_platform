import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  ChatConversationResponse,
  ChatMessageResponse,
} from "@/services/chat/chatApi";
import {
  dayKey,
  dayLabel,
  timeLabel,
  initialsOf,
  isImageAttachment,
} from "./chatUtils";
import { MessageText } from "./MessageText";

/** A message augmented with optimistic-send bookkeeping. */
export interface UiChatMessage extends ChatMessageResponse {
  clientDedupKey?: string;
  pending?: boolean;
  failed?: boolean;
}

export interface ChatThreadProps {
  conversation: ChatConversationResponse;
  messages: UiChatMessage[];
  currentUserId: string;
  isLoading?: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Re-send a failed optimistic message (reuses its clientDedupKey). */
  onRetry?: (message: UiChatMessage) => void;
  /** Remove an abandoned failed optimistic row from the thread. */
  onDismissFailed?: (message: UiChatMessage) => void;
  /** Soft-delete one of the user's own messages. */
  onDelete?: (message: UiChatMessage) => void;
  /** Rewrite one of the user's own messages. Resolves once the server has accepted it. */
  onEdit?: (message: UiChatMessage, text: string) => Promise<void>;
}

/** Show sender names for multi-party threads (groups / community), not DMs. */
function showsSenderNames(type: ChatConversationResponse["type"]): boolean {
  return type === "BATCH_GROUP" || type === "COMMUNITY";
}

export function ChatThread({
  conversation,
  messages,
  currentUserId,
  isLoading = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onRetry,
  onDismissFailed,
  onDelete,
  onEdit,
}: ChatThreadProps) {
  const { t } = useTranslation("chatFeatureA");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [editTarget, setEditTarget] = useState<UiChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UiChatMessage | null>(null);
  const lastSeqRef = useRef<number | null>(null);

  // Auto-scroll to the newest message when a new one arrives at the tail.
  useEffect(() => {
    const last = messages[messages.length - 1];
    const lastSeq = last?.seq ?? null;
    if (lastSeq !== lastSeqRef.current) {
      lastSeqRef.current = lastSeq;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  const withNames = showsSenderNames(conversation.type);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-4 overflow-hidden p-4">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}
          >
            <Skeleton className="h-12 w-48 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-caption text-muted-foreground">{t("thread.empty")}</p>
      </div>
    );
  }

  let lastDay = "";
  let lastSenderId: string | null = null;

  return (
    <div
      role="log"
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4"
    >
      {hasMore && (
        <div className="mb-3 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? t("common.loading") : t("thread.loadEarlier")}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {messages.map((msg) => {
          const isOwn = msg.senderId === currentUserId;
          const key = dayKey(msg.createdAt);
          const showDay = key !== lastDay;
          if (showDay) lastDay = key;

          // Group consecutive bubbles from the same sender: only show the
          // sender name on the first of a run (and only in group threads).
          const showName =
            withNames && !isOwn && (showDay || msg.senderId !== lastSenderId);
          lastSenderId = msg.senderId;

          const hasImage = isImageAttachment(msg.attachmentMime, msg.attachmentUrl);
          const isTombstoned = msg.isDeleted === true;
          // Both actions are institute-configurable for learners. `!== false` so a build running
          // against an older backend (which sends neither flag) keeps today's behaviour.
          const canDelete =
            isOwn &&
            !isTombstoned &&
            !msg.pending &&
            !msg.failed &&
            !!onDelete &&
            conversation.canDeleteOwnMessages !== false;
          const canEdit =
            isOwn &&
            !isTombstoned &&
            !msg.pending &&
            !msg.failed &&
            !!onEdit &&
            conversation.canEditOwnMessages !== false;

          return (
            <div key={msg.id} className="flex flex-col">
              {showDay && (
                <div className="my-2 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-caption font-medium text-muted-foreground">
                    {dayLabel(msg.createdAt, {
                      today: t("thread.dayToday"),
                      yesterday: t("thread.dayYesterday"),
                    })}
                  </span>
                </div>
              )}

              <div
                className={cn("flex w-full", isOwn ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "flex gap-2",
                    "max-w-[78%]", // design-lint-ignore: bubble width is a viewport-relative % with no token equivalent
                    isOwn && "flex-row-reverse",
                  )}
                >
                  {withNames && !isOwn && (
                    <span
                      aria-hidden
                      className={cn(
                        "mt-auto flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-500",
                        !showName && "invisible",
                      )}
                    >
                      {initialsOf(msg.senderName)}
                    </span>
                  )}

                  <div className="group/msg min-w-0">
                    {showName && (
                      <span className="mb-0.5 block px-1 text-caption font-medium text-muted-foreground">
                        {msg.senderName || t("common.memberFallback")}
                      </span>
                    )}

                    {isTombstoned ? (
                      <div className="rounded-2xl border border-dashed border-border px-3 py-2 text-body italic text-muted-foreground">
                        {t("thread.deletedMessage")}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "relative rounded-2xl px-3 py-2 text-body",
                          isOwn
                            ? "rounded-ee-md bg-primary text-primary-foreground"
                            : "rounded-es-md bg-muted text-foreground",
                          msg.failed && "opacity-70 ring-1 ring-destructive",
                        )}
                      >
                        {(canEdit || canDelete) && (
                          <div
                            className={cn(
                              "absolute -start-8 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1",
                              "opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
                              // Touch devices never fire hover — keep the controls usable there.
                              "max-md:opacity-100",
                            )}
                          >
                            {canEdit && (
                              <button
                                type="button"
                                aria-label={t("thread.editMessage")}
                                onClick={() => {
                                  setEditTarget(msg);
                                  setEditText(msg.content ?? "");
                                }}
                                className="flex size-7 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm hover:bg-muted"
                              >
                                <PencilSimple size={15} />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                aria-label={t("thread.deleteMessage")}
                                onClick={() => setDeleteTarget(msg)}
                                className="flex size-7 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm hover:bg-muted"
                              >
                                <Trash size={15} />
                              </button>
                            )}
                          </div>
                        )}

                        {hasImage && msg.attachmentUrl && (
                          <a
                            href={msg.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1 block"
                          >
                            <img
                              src={msg.attachmentUrl}
                              alt={msg.attachmentName || t("thread.attachmentAltFallback")}
                              className="max-h-64 w-full rounded-lg object-cover"
                            />
                          </a>
                        )}

                        {!hasImage && msg.attachmentUrl && (
                          <a
                            href={msg.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1 block truncate underline"
                          >
                            {msg.attachmentName || t("thread.attachmentNameFallback")}
                          </a>
                        )}

                        {msg.content && (
                          <MessageText text={msg.content} isOwn={isOwn} />
                        )}

                        {msg.failed ? (
                          <span
                            aria-label={t("thread.failedAria")}
                            className="mt-1 flex items-center justify-end gap-2 text-3xs leading-none"
                          >
                            <button
                              type="button"
                              onClick={() => onRetry?.(msg)}
                              className={cn(
                                "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium underline-offset-2 hover:underline",
                                isOwn
                                  ? "text-primary-foreground"
                                  : "text-destructive",
                              )}
                            >
                              <ArrowClockwise size={12} />
                              {t("thread.retry")}
                            </button>
                            {onDismissFailed && (
                              <button
                                type="button"
                                aria-label={t("thread.dismissFailedAria")}
                                onClick={() => onDismissFailed(msg)}
                                className={cn(
                                  "flex items-center rounded-md p-0.5 hover:opacity-80",
                                  isOwn
                                    ? "text-primary-foreground/80"
                                    : "text-muted-foreground",
                                )}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </span>
                        ) : (
                          <span
                            aria-label={msg.pending ? t("thread.sendingAria") : undefined}
                            className={cn(
                              "mt-0.5 block text-end text-3xs leading-none",
                              isOwn
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground",
                            )}
                          >
                            {msg.pending
                              ? t("thread.sending")
                              : msg.isEdited
                                ? t("thread.timestampEdited", { time: timeLabel(msg.createdAt) })
                                : timeLabel(msg.createdAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div ref={bottomRef} />

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingEdit) setEditTarget(null);
        }}
      >
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-body font-semibold">
              {t("thread.editMessage")}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label={t("thread.editDialog.inputAria")}
            rows={4}
            maxLength={8000}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          <p className="text-caption text-muted-foreground">
            {t("thread.editDialog.notice")}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isSavingEdit}
              onClick={() => setEditTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                isSavingEdit ||
                !editText.trim() ||
                editText.trim() === (editTarget?.content ?? "").trim()
              }
              onClick={() => {
                const target = editTarget;
                if (!target || !onEdit) return;
                setIsSavingEdit(true);
                void onEdit(target, editText.trim())
                  .then(() => setEditTarget(null))
                  .finally(() => setIsSavingEdit(false));
              }}
            >
              {isSavingEdit ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="w-full max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-body font-semibold">
              {t("thread.deleteMessage")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-body text-muted-foreground">{t("thread.deleteDialog.body")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) onDelete?.(target);
              }}
            >
              {t("thread.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
