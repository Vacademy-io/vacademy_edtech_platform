import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import {
  ArrowClockwise,
  ChatCircleDots,
  PaperPlaneRight,
  ThumbsDown,
  ThumbsUp,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { MAX_MESSAGE_CHARS, hasContactCard, needsContactFallback } from "./controller";
import { useSiteAssistantUi } from "./context";
import { MarkdownLite } from "./MarkdownLite";
import { SiteAssistantCardView } from "./SiteAssistantCards";
import { safeImageUrl } from "./links";
import type { SiteAssistantCard, SiteAssistantChatMessage, SiteAssistantErrorCode } from "./types";

export interface SiteAssistantDisplay {
  name: string;
  avatarUrl: string | null;
  greeting: string;
  suggestions: string[];
}

interface PanelProps {
  display: SiteAssistantDisplay;
  onClose: () => void;
  /** Shown under a "talk to a person" error when the server sent no contact card. */
  fallbackContact: Extract<SiteAssistantCard, { type: "contact_info" }> | null;
  className?: string;
}

const RETRYABLE: SiteAssistantErrorCode[] = ["internal", "network", "unauthorized", "closed"];
/** Why the chat could not start, when there is a better sentence than "couldn't start". */
const FAILURE_MESSAGES: SiteAssistantErrorCode[] = ["disabled", "not_allowed", "rate_limited"];
/** Failures a retry cannot fix. */
const FINAL_FAILURES: SiteAssistantErrorCode[] = ["disabled", "not_allowed"];

export const AssistantAvatar: React.FC<{ url: string | null; className?: string }> = ({ url, className }) => {
  const safe = safeImageUrl(url);
  const [broken, setBroken] = useState(false);
  if (safe && !broken) {
    return <img src={safe} alt="" className={cn("rounded-full object-cover", className)} onError={() => setBroken(true)} />;
  }
  return (
    <span className={cn("flex items-center justify-center rounded-full bg-primary-500 text-primary-foreground", className)}>
      <ChatCircleDots className="size-1/2" weight="fill" aria-hidden="true" />
    </span>
  );
};

const AssistantTurn: React.FC<{
  message: SiteAssistantChatMessage;
  fallbackContact: PanelProps["fallbackContact"];
}> = ({ message, fallbackContact }) => {
  const { t } = useTranslation("siteAssistant");
  const { controller } = useSiteAssistantUi();
  const waiting = message.pending && !message.text && message.cards.length === 0;
  const showFallback = needsContactFallback(message) && !hasContactCard(message.cards) && fallbackContact;

  return (
    <div className="flex min-w-0 flex-col gap-2 pe-6" data-role="assistant">
      {waiting && (
        <div className="self-start rounded-catalogue-lg bg-palette-cream px-3 py-2 text-sm text-palette-muted">
          <span className="animate-pulse">{t("status.thinking")}</span>
        </div>
      )}
      {message.text && (
        <div className="min-w-0 max-w-full self-start break-words rounded-catalogue-lg bg-palette-cream px-3 py-2 text-sm text-palette-text">
          <MarkdownLite text={message.text} />
        </div>
      )}
      {message.cards.map((card, i) => (
        <SiteAssistantCardView key={`${message.localId}-${i}`} card={card} cardKey={`${message.localId}:${i}`} />
      ))}
      {message.error && (
        <div
          role="alert"
          className="flex flex-col gap-2 self-start rounded-catalogue-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700"
        >
          <span className="flex items-start gap-2">
            <WarningCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t(`errors.${message.error.code}`)}
          </span>
          {RETRYABLE.includes(message.error.code) && (
            <button
              type="button"
              onClick={() => void controller.retry(message.localId)}
              className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm self-start"
            >
              <ArrowClockwise className="size-4" aria-hidden="true" />
              {t("status.retry")}
            </button>
          )}
        </div>
      )}
      {showFallback && <SiteAssistantCardView card={fallbackContact} cardKey={`${message.localId}:fallback`} />}
      {message.messageId && !message.pending && !message.error && (
        <div className="flex items-center gap-1 text-palette-muted">
          {([1, -1] as const).map((rating) => {
            const active = message.feedback === rating;
            const Icon = rating === 1 ? ThumbsUp : ThumbsDown;
            return (
              <button
                key={rating}
                type="button"
                aria-pressed={active}
                aria-label={rating === 1 ? t("feedback.helpful") : t("feedback.notHelpful")}
                title={rating === 1 ? t("feedback.helpful") : t("feedback.notHelpful")}
                onClick={() => void controller.rate(message.localId, rating)}
                className={cn(
                  "catalogue-btn catalogue-btn-ghost catalogue-btn-icon size-8 rounded-full",
                  active && "text-catalogue-brand-ink",
                )}
              >
                <Icon className="size-4" weight={active ? "fill" : "regular"} aria-hidden="true" />
              </button>
            );
          })}
          {message.feedback !== null && (
            <span className="text-xs" role="status">
              {t("feedback.thanks")}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/** The chat: header, conversation, suggestions, composer. Chrome-agnostic (hosted and embed). */
export const SiteAssistantPanel: React.FC<PanelProps> = ({ display, onClose, fallbackContact, className }) => {
  const { t } = useTranslation("siteAssistant");
  const { controller } = useSiteAssistantUi();
  const messages = useStore(controller.store, (s) => s.messages);
  const streaming = useStore(controller.store, (s) => s.streaming);
  const status = useStore(controller.store, (s) => s.status);
  const failure = useStore(controller.store, (s) => s.failure);
  const [draft, setDraft] = useState("");
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Focus the composer when the panel opens.
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  // Follow the conversation while the visitor is at the bottom of it.
  const lastText = messages[messages.length - 1]?.text.length ?? 0;
  const lastCards = messages[messages.length - 1]?.cards.length ?? 0;
  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastText, lastCards]);

  const submit = (text: string) => {
    const clean = text.trim();
    if (!clean || streaming) return;
    stickToBottom.current = true;
    setDraft("");
    void controller.send(clean);
    inputRef.current?.focus();
  };

  const hasUserTurn = messages.some((m) => m.role === "user");
  const remaining = MAX_MESSAGE_CHARS - draft.length;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        "flex flex-col overflow-hidden border border-palette-border bg-catalogue-bg-elevated text-palette-text shadow-xl",
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-palette-border px-4 py-3">
        <AssistantAvatar url={display.avatarUrl} className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-sm font-semibold text-palette-text">
            {display.name}
          </h2>
          <p className="truncate text-xs text-palette-muted">{t("panel.aiNotice")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("panel.close")}
          className="catalogue-btn catalogue-btn-ghost catalogue-btn-icon size-9 rounded-full"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={streaming}
        aria-label={t("panel.conversation")}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4"
      >
        <div className="flex min-w-0 flex-col gap-2 pe-6" data-role="greeting">
          <div className="min-w-0 max-w-full self-start break-words rounded-catalogue-lg bg-palette-cream px-3 py-2 text-sm text-palette-text">
            <MarkdownLite text={display.greeting} />
          </div>
        </div>

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.localId} className="flex min-w-0 justify-end ps-8" data-role="user">
              <p className="min-w-0 max-w-full whitespace-pre-wrap break-words rounded-catalogue-lg bg-primary-500 px-3 py-2 text-sm text-primary-foreground">
                <span className="sr-only">{t("a11y.you")}: </span>
                {m.text}
              </p>
            </div>
          ) : (
            <AssistantTurn key={m.localId} message={m} fallbackContact={fallbackContact} />
          ),
        )}

        {!hasUserTurn && display.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("panel.suggestions")}>
            {display.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                disabled={streaming}
                className="rounded-full border border-palette-border-strong bg-catalogue-bg-elevated px-3 py-1.5 text-start text-sm text-palette-text transition hover:bg-palette-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {status === "connecting" && !hasUserTurn && (
          <p className="text-xs text-palette-muted" role="status">
            {t("status.connecting")}
          </p>
        )}
        {status === "failed" && !hasUserTurn && (
          <div role="alert" className="flex flex-col gap-2 rounded-catalogue-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-700">
            <span>{failure && FAILURE_MESSAGES.includes(failure) ? t(`errors.${failure}`) : t("status.connectFailed")}</span>
            {!(failure && FINAL_FAILURES.includes(failure)) && (
              <button
                type="button"
                onClick={() => void controller.connect()}
                className="catalogue-btn catalogue-btn-secondary catalogue-btn-sm self-start"
              >
                <ArrowClockwise className="size-4" aria-hidden="true" />
                {t("status.retry")}
              </button>
            )}
          </div>
        )}
      </div>

      <form
        className="site-assistant-composer flex items-end gap-2 border-t border-palette-border px-3 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${titleId}-input`} className="sr-only">
            {t("composer.label")}
          </label>
          <textarea
            id={`${titleId}-input`}
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={t("composer.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            className="catalogue-input max-h-32 min-h-10 resize-none"
          />
          {remaining <= 100 && (
            <span className="text-xs text-palette-muted" aria-live="polite">
              {t("composer.remaining", { count: remaining })}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!draft.trim() || streaming}
          aria-label={t("composer.send")}
          className="catalogue-btn catalogue-btn-primary catalogue-btn-icon size-10 shrink-0 rounded-full"
        >
          <PaperPlaneRight className="size-5 rtl:-scale-x-100" weight="fill" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
};
