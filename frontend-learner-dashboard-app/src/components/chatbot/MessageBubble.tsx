import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "@/styles/katex-dark.css";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useChatbotAvatarUrl } from "@/services/chatbot-settings";
import type { FeedbackRating } from "@/services/chatbot-api";
import { useChatbotContext } from "./useChatbotContext";
import { ChatLink } from "./cards/ChatLink";
import type { Attachment, ChatMessage } from "./types";

// Never add rehype-raw here: replies are model output and must not become HTML.
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks];
const REHYPE_PLUGINS = [rehypeKatex];

/** react-markdown passes its hast `node` to overrides; keep it off the DOM. */
const omitNode = <T extends object>(props: T): T => {
  const rest = { ...props } as T & { node?: unknown };
  delete rest.node;
  return rest;
};

/**
 * The ONE set of markdown overrides for assistant text. The streaming bubble
 * and the final message both use it, so the text does not change style when
 * the finished message replaces the streamed one.
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: (props) => <h1 className="text-base font-bold mt-3 mb-1.5" {...omitNode(props)} />,
  h2: (props) => <h2 className="text-sm font-bold mt-2.5 mb-1" {...omitNode(props)} />,
  h3: (props) => <h3 className="text-sm font-semibold mt-2 mb-1" {...omitNode(props)} />,
  p: (props) => <p className="text-sm leading-6 mb-3 last:mb-0" {...omitNode(props)} />,
  a: ({ href, children }) => (
    <ChatLink href={href} lenient className="text-primary underline hover:text-primary/80">
      {children}
    </ChatLink>
  ),
  ul: (props) => <ul className="list-disc list-inside mb-3 space-y-1 text-sm" {...omitNode(props)} />,
  ol: (props) => <ol className="list-decimal list-inside mb-3 space-y-1 text-sm" {...omitNode(props)} />,
  li: (props) => <li className="ms-2" {...omitNode(props)} />,
  code: (props) => {
    const { className, children, ...rest } = omitNode(props);
    const isInline = !className?.includes("language-");
    return isInline ? (
      <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...rest}>
        {children}
      </code>
    ) : (
      <code
        className="block max-w-full bg-muted p-2 rounded-lg text-xs font-mono mb-3 overflow-x-auto whitespace-pre"
        {...rest}
      >
        {children}
      </code>
    );
  },
  blockquote: (props) => (
    <blockquote
      className="border-s-4 border-primary ps-3 py-1 my-3 italic text-muted-foreground text-sm"
      {...omitNode(props)}
    />
  ),
  hr: (props) => <hr className="my-3 border-border" {...omitNode(props)} />,
  // The tutor is told to answer progress and comparison questions with tables;
  // without these they rendered as unaligned rows with no cell spacing.
  table: (props) => (
    <div className="mb-3 max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" {...omitNode(props)} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted" {...omitNode(props)} />,
  th: (props) => (
    <th
      className="border-b border-border px-2.5 py-1.5 text-start font-semibold"
      {...omitNode(props)}
    />
  ),
  td: (props) => (
    <td className="border-b border-border px-2.5 py-1.5 align-top" {...omitNode(props)} />
  ),
};

/** Markdown + LaTeX exactly as the assistant's replies render it. */
export const ChatMarkdown: React.FC<{ children: string }> = ({ children }) => (
  <div className="min-w-0 max-w-full break-words [&_ol]:ps-4 [&_ul]:ps-4 [&_li]:my-0.5 [&_pre]:overflow-x-auto">
    <ReactMarkdown
      components={MARKDOWN_COMPONENTS}
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
    >
      {children}
    </ReactMarkdown>
  </div>
);

export const AssistantAvatar: React.FC<{ className?: string }> = ({ className }) => {
  const avatarUrl = useChatbotAvatarUrl();
  const { chatbotSettings } = useChatbotContext();
  return (
    <Avatar className={cn("h-6 w-6 shrink-0 ring-1 ring-border/40", className)} aria-hidden="true">
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback className="text-primary font-bold text-caption bg-muted">
        {chatbotSettings.assistant_name.substring(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
};

/**
 * A reply's small action button. Always visible on touch-sized screens; on
 * desktop it shows on hover and whenever it (or anything in the message) has
 * keyboard focus.
 */
export const ACTION_BUTTON =
  "shrink-0 p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const CopyButton: React.FC<{ content: string }> = ({ content }) => {
  const { t } = useTranslation("chatFeatureB");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const label = copied ? t("common.copied") : t("panel.copyMessage");
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(content).catch((err) => {
          console.error("Could not copy text: ", err);
        });
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
      aria-label={label}
      title={label}
      className={ACTION_BUTTON}
    >
      {copied ? <Check className="size-3.5 text-success-600" /> : <Copy className="size-3.5" />}
    </button>
  );
};

/** Thumbs up / down. Clicking the active one clears the rating. */
const RateButtons: React.FC<{
  rating: "up" | "down" | null;
  onRate: (rating: FeedbackRating) => void;
}> = ({ rating, onRate }) => {
  const { t } = useTranslation("chatFeatureB");
  const options = [
    { value: "up" as const, Icon: ThumbsUp, label: t("messageList.rateUp") },
    { value: "down" as const, Icon: ThumbsDown, label: t("messageList.rateDown") },
  ];
  return (
    <>
      {options.map(({ value, Icon, label }) => {
        const active = rating === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onRate(active ? "none" : value)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            // A given rating stays visible on desktop too.
            className={cn(ACTION_BUTTON, active && "text-primary md:opacity-100")}
          >
            <Icon className="size-3.5" weight={active ? "fill" : "regular"} aria-hidden="true" />
          </button>
        );
      })}
    </>
  );
};

export interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  status?: ChatMessage["status"];
  /** The live streamed reply: same look, a caret, no copy button. */
  streaming?: boolean;
  /** Assistant avatar beside the bubble (off for unknown roles). */
  showAvatar?: boolean;
  /** The learner stopped this reply mid-stream: a small note under it. */
  stopped?: boolean;
  /** Current thumbs rating; with onRate, shows the thumbs buttons. */
  rating?: "up" | "down" | null;
  onRate?: (rating: FeedbackRating) => void;
  /** More buttons at the end of the actions row (read aloud, save). */
  extraActions?: React.ReactNode;
  /** A row under the actions (the answer toolbelt on the latest reply). */
  belowActions?: React.ReactNode;
}

/** One chat bubble: the learner's text/images, or an assistant markdown reply. */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  role,
  content,
  attachments,
  status,
  streaming = false,
  showAvatar = true,
  stopped = false,
  rating = null,
  onRate,
  extraActions,
  belowActions,
}) => {
  const { t } = useTranslation("chatFeatureB");

  if (role === "user") {
    const images = attachments?.filter((a) => a.type === "image") ?? [];
    return (
      <div className="flex w-full ms-auto max-w-pct-92 justify-end">
        <div className="min-w-0 max-w-full overflow-hidden rounded-xl rounded-ee-sm bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm [overflow-wrap:anywhere]">
          {images.map((att, i) => (
            <img
              key={i}
              src={att.url}
              alt={att.name || t("common.attachedImageAlt")}
              className="max-w-48 max-h-36 rounded-lg mb-1.5 last:mb-0"
            />
          ))}
          {(content || status === "pending") && (
            <p className="whitespace-pre-wrap">
              {content}
              {status === "pending" && (
                <span
                  role="img"
                  aria-label={t("panel.queuedTooltip")}
                  title={t("panel.queuedTooltip")}
                  className="text-xs text-primary-foreground/60 ms-1"
                >
                  &#x23F3;
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full me-auto max-w-full justify-start gap-1.5">
      {showAvatar && <AssistantAvatar className="mt-0.5" />}
      <div className="group flex min-w-0 max-w-full flex-col items-start gap-0.5">
        <div className="min-w-0 max-w-full overflow-hidden rounded-xl rounded-es-sm bg-card px-3 py-2 text-sm leading-relaxed text-card-foreground shadow-sm ring-1 ring-border/30 [overflow-wrap:anywhere]">
          <ChatMarkdown>{content}</ChatMarkdown>
          {streaming && (
            <span aria-hidden="true" className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ms-0.5 align-middle" />
          )}
        </div>
        {!streaming && content && (
          <div className="flex items-center gap-0.5">
            {stopped && (
              <span className="px-1 text-caption text-muted-foreground">{t("messageList.stopped")}</span>
            )}
            <CopyButton content={content} />
            {onRate && <RateButtons rating={rating} onRate={onRate} />}
            {extraActions}
          </div>
        )}
        {!streaming && content && belowActions}
      </div>
    </div>
  );
};
