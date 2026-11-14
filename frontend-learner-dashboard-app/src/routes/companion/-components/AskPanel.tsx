import { useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "@/styles/katex-dark.css";
import { MagnifyingGlassPlus, PaperPlaneRight, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  askCompanion,
  getAskThread,
  getCompanionSpeech,
  readCompanionError,
  type AskFigure,
  type AskMessage,
  type AskThread,
  type CompanionLeaf,
  type CompanionPublic,
} from "@/services/kb-companion-api";
import type { ReadAloud } from "./useReadAloud";
import { CitationChip, CompanionAvatar } from "./CompanionVisuals";
import { ErrorPanel, ReadAloudButton } from "./CompanionParts";
import { companionKeys } from "./companion-utils";

const MAX_CHARS = 1000;

/**
 * Markdown for answers: GFM tables, lists, bold and KaTeX maths. There is no
 * rehype-raw, so any HTML inside an answer is never rendered as markup.
 */
const markdownComponents = {
  p: (props: HTMLAttributes<HTMLParagraphElement>) => <p className="mb-3 last:mb-0" {...props} />,
  ul: (props: HTMLAttributes<HTMLUListElement>) => <ul className="mb-3 list-disc space-y-1 ps-5" {...props} />,
  ol: (props: HTMLAttributes<HTMLOListElement>) => <ol className="mb-3 list-decimal space-y-1 ps-5" {...props} />,
  h1: (props: HTMLAttributes<HTMLHeadingElement>) => <h4 className="mb-2 mt-3 text-base font-bold" {...props} />,
  h2: (props: HTMLAttributes<HTMLHeadingElement>) => <h4 className="mb-2 mt-3 text-base font-bold" {...props} />,
  h3: (props: HTMLAttributes<HTMLHeadingElement>) => <h4 className="mb-2 mt-3 text-sm font-bold" {...props} />,
  strong: (props: HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-neutral-900 dark:text-neutral-50" {...props} />
  ),
  blockquote: (props: HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="my-3 border-s-4 border-primary-300 bg-primary-50 px-3 py-2 dark:bg-primary-500/10" {...props} />
  ),
  table: (props: HTMLAttributes<HTMLTableElement>) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props: HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-primary-50 dark:bg-primary-500/10" {...props} />
  ),
  th: (props: HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border-b border-neutral-200 px-3 py-2 text-start font-semibold dark:border-neutral-700" {...props} />
  ),
  td: (props: HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border-b border-neutral-100 px-3 py-2 align-top dark:border-neutral-800" {...props} />
  ),
  code: (props: HTMLAttributes<HTMLElement>) => (
    <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs dark:bg-neutral-800" {...props} />
  ),
  a: (props: HTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-primary-500 underline" target="_blank" rel="noopener noreferrer" {...props} />
  ),
};

type Notice = { tone: "warn" | "error"; text: string };

/**
 * Ask: a persistent doubt thread answered only from the knowledge base, with
 * the pages it used and the book's own figures.
 */
export function AskPanel({
  companionId,
  companion,
  contextLeaf,
  onClearContext,
  prefill,
  readAloud,
  suggestionLeaves,
}: {
  companionId: string;
  companion: CompanionPublic;
  contextLeaf: CompanionLeaf | null;
  onClearContext: () => void;
  prefill: { text: string; nonce: number } | null;
  readAloud: ReadAloud;
  suggestionLeaves: CompanionLeaf[];
}) {
  const { t } = useTranslation("kbCompanion");
  const queryClient = useQueryClient();
  const threadKey = companionKeys.thread(companionId);
  const { data: thread, isLoading, isError, refetch } = useQuery({
    queryKey: threadKey,
    queryFn: () => getAskThread(companionId),
    retry: 1,
  });

  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [zoom, setZoom] = useState<AskFigure | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // "Ask about this card" from the lesson player.
  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [prefill]);

  const messages = thread?.messages ?? [];
  useEffect(() => {
    if (messages.length === 0 && !pendingQuestion) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingQuestion]);

  const cap = thread?.daily_cap ?? companion.daily_question_cap ?? null;
  const today = thread?.questions_today ?? 0;
  const capReached = !!cap && today >= cap;

  const send = async (raw: string) => {
    const question = raw.trim().slice(0, MAX_CHARS);
    if (!question || pendingQuestion) return;
    setNotice(null);
    setPendingQuestion(question);
    setInput("");
    const localUser: AskMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: question,
      meta: { node_id: contextLeaf?.id ?? null },
    };
    try {
      const reply = await askCompanion(companionId, {
        question,
        ...(contextLeaf ? { node_id: contextLeaf.id } : {}),
      });
      queryClient.setQueryData<AskThread>(threadKey, (prev) => ({
        messages: [...(prev?.messages ?? []), localUser, reply],
        questions_today: (prev?.questions_today ?? 0) + 1,
        daily_cap: prev?.daily_cap ?? cap,
      }));
    } catch (err) {
      const e = readCompanionError(err);
      if (e.status === 429 || e.status === 402) {
        // Refused before it was stored: give the learner their question back.
        setInput(question);
        setNotice({
          tone: "warn",
          text: e.message || (e.status === 402 ? t("errors.credits") : t("ask.errors.limit")),
        });
      } else {
        // 502 and other failures: the question was stored, so keep it in the thread.
        queryClient.setQueryData<AskThread>(threadKey, (prev) => ({
          messages: [...(prev?.messages ?? []), localUser],
          questions_today: (prev?.questions_today ?? 0) + 1,
          daily_cap: prev?.daily_cap ?? cap,
        }));
        setNotice({
          tone: "error",
          text:
            e.message ||
            (e.status === 403 ? t("errors.forbidden") : t("ask.errors.failed")),
        });
      }
    } finally {
      setPendingQuestion(null);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const starterTopic = contextLeaf?.title ?? suggestionLeaves[0]?.title ?? null;
  const starters = starterTopic
    ? [
        t("ask.starters.explain", { topic: starterTopic }),
        t("ask.starters.example", { topic: starterTopic }),
        t("ask.starters.keyPoints", { topic: starterTopic }),
      ]
    : [];

  if (isError) {
    return <ErrorPanel message={t("ask.errors.thread")} onRetry={() => void refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Thread */}
      <div className="space-y-5" aria-live="polite">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="ms-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-28 w-5/6 rounded-2xl" />
          </div>
        ) : messages.length === 0 && !pendingQuestion ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 px-6 py-10 text-center dark:border-neutral-700">
            <CompanionAvatar emoji={companion.avatar_emoji} accent={companion.accent_color} size="lg" />
            <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
              {t("ask.emptyTitle", { name: companion.name })}
            </p>
            <p className="max-w-sm text-sm text-neutral-600 dark:text-neutral-400">
              {t("ask.emptyBody", { kb: companion.kb_name })}
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageRow
              key={m.id}
              isLast={i === messages.length - 1}
              message={m}
              companion={companion}
              readAloud={readAloud}
              companionId={companionId}
              onFollowUp={(q) => void send(q)}
              onZoom={setZoom}
              busy={!!pendingQuestion}
            />
          ))
        )}

        {pendingQuestion && (
          <>
            <UserBubble text={pendingQuestion} />
            <div className="flex items-start gap-3">
              <CompanionAvatar emoji={companion.avatar_emoji} accent={companion.accent_color} size="sm" />
              <div className="flex items-center gap-2 rounded-2xl rounded-ss-md bg-neutral-100 px-4 py-3 text-sm text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <span className="flex gap-1" aria-hidden>
                  <span className="size-2 animate-bounce rounded-full bg-primary-400" />
                  <span className="size-2 animate-bounce rounded-full bg-primary-400 delay-150" />
                  <span className="size-2 animate-bounce rounded-full bg-primary-400 delay-300" />
                </span>
                {t("ask.thinking")}
              </div>
            </div>
          </>
        )}
        <div ref={endRef} />
      </div>

      {notice && (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm",
            notice.tone === "warn"
              ? "border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-700 dark:bg-warning-700/10 dark:text-warning-200"
              : "border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-700/10 dark:text-danger-200",
          )}
        >
          <WarningCircle className="mt-0.5 size-4 shrink-0" weight="fill" aria-hidden />
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("actions.dismiss")}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Starter questions on an empty thread */}
      {!isLoading && messages.length === 0 && !pendingQuestion && starters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void send(s)}
              disabled={capReached}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-500 transition-colors hover:bg-primary-100 disabled:opacity-50 dark:border-primary-500/30 dark:bg-primary-500/10"
            >
              <Sparkle className="size-3.5" weight="fill" aria-hidden />
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm focus-within:border-primary-300 focus-within:ring-2 focus-within:ring-primary-100 dark:border-neutral-700 dark:bg-neutral-900">
        {contextLeaf && (
          <div className="flex items-center gap-2 px-2 pb-2 pt-1">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-500 dark:bg-primary-500/10">
              <span className="truncate">{t("ask.aboutTopic", { title: contextLeaf.title })}</span>
              <button
                type="button"
                onClick={onClearContext}
                className="shrink-0 rounded-full hover:bg-primary-100"
                aria-label={t("ask.clearContext")}
              >
                <X className="size-3.5" weight="bold" aria-hidden />
              </button>
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={capReached}
            placeholder={capReached ? t("ask.capReached") : t("ask.placeholder")}
            aria-label={t("ask.placeholder")}
            className="min-h-12 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0 dark:text-neutral-100"
          />
          <Button
            onClick={() => void send(input)}
            disabled={!input.trim() || !!pendingQuestion || capReached}
            size="icon"
            className="size-11 shrink-0 rounded-xl"
            aria-label={t("ask.send")}
          >
            <PaperPlaneRight className="size-5 rtl:rotate-180" weight="fill" aria-hidden />
          </Button>
        </div>
      </div>
      {!!cap && (
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          {t("ask.quota", { used: Math.min(today, cap), cap })}
        </p>
      )}

      <Dialog open={!!zoom} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-3xl p-3 sm:p-4">
          <DialogTitle className="sr-only">{zoom?.caption || t("ask.figure")}</DialogTitle>
          {zoom && (
            <figure className="space-y-2">
              <img
                src={zoom.image_url}
                alt={zoom.caption || t("ask.figure")}
                className="max-h-screen w-full rounded-xl bg-white object-contain"
              />
              {(zoom.caption || zoom.page_number) && (
                <figcaption className="text-sm text-neutral-600 dark:text-neutral-300">
                  {zoom.caption}
                  {zoom.page_number ? ` · ${t("ask.page", { page: zoom.page_number })}` : ""}
                </figcaption>
              )}
            </figure>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-prose whitespace-pre-line rounded-2xl rounded-se-md bg-primary-500 px-4 py-2.5 text-sm text-primary-foreground shadow-sm sm:text-base">
        {text}
      </div>
    </div>
  );
}

function citationLabel(label: string, start?: number | null, end?: number | null, pageWord?: string) {
  if (!start || !pageWord) return label;
  const pages = end && end !== start ? `${start}-${end}` : `${start}`;
  return label.includes(String(start)) ? label : `${label}, ${pageWord} ${pages}`;
}

function MessageRow({
  message,
  companion,
  companionId,
  readAloud,
  onFollowUp,
  onZoom,
  busy,
  isLast,
}: {
  message: AskMessage;
  companion: CompanionPublic;
  companionId: string;
  readAloud: ReadAloud;
  onFollowUp: (question: string) => void;
  onZoom: (figure: AskFigure) => void;
  busy: boolean;
  isLast: boolean;
}) {
  const { t } = useTranslation("kbCompanion");
  if (message.role === "user") return <UserBubble text={message.content} />;

  const meta = message.meta ?? {};
  const plain = meta.kind === "care" || meta.kind === "not_found";
  const citations = meta.citations ?? [];
  const figures = (meta.figures ?? []).filter((f) => !!f.image_url);
  // Suggestions only under the latest answer; older ones are history.
  const followUps = isLast ? (meta.follow_ups ?? []) : [];
  const voiceKey = `msg:${message.id}`;
  const persisted = typeof message.id === "number" || /^\d+$/.test(String(message.id));

  return (
    <div className="flex items-start gap-3">
      <CompanionAvatar emoji={companion.avatar_emoji} accent={companion.accent_color} size="sm" />
      <div className="min-w-0 flex-1 space-y-3">
        <div
          className={cn(
            "rounded-2xl rounded-ss-md px-4 py-3 text-sm leading-relaxed sm:text-base",
            plain
              ? "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
              : "border border-neutral-200 bg-white text-neutral-800 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100",
          )}
        >
          {plain ? (
            <p className="whitespace-pre-line">{message.content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        {figures.length > 0 && (
          <div className={cn("grid gap-3", figures.length > 1 && "sm:grid-cols-2")}>
            {figures.map((f, i) => (
              <figure
                key={`${f.image_url}-${i}`}
                className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <button
                  type="button"
                  onClick={() => onZoom(f)}
                  className="group relative block w-full bg-white"
                  aria-label={t("ask.enlarge")}
                >
                  <img
                    src={f.image_url}
                    alt={f.caption || t("ask.figure")}
                    loading="lazy"
                    className="max-h-80 w-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="absolute end-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <MagnifyingGlassPlus className="size-4" aria-hidden />
                  </span>
                </button>
                {(f.caption || f.page_number) && (
                  <figcaption className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                    {f.caption}
                    {f.page_number ? (
                      <span className="text-neutral-400"> · {t("ask.page", { page: f.page_number })}</span>
                    ) : null}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        )}

        {(citations.length > 0 || (companion.voice_enabled && !plain && persisted)) && (
          <div className="flex flex-wrap items-center gap-2">
            {citations.map((c) => (
              <CitationChip
                key={`${c.n}-${c.label}`}
                label={citationLabel(c.label, c.page_start, c.page_end, t("ask.pageShort"))}
              />
            ))}
            {companion.voice_enabled && !plain && persisted && (
              <ReadAloudButton
                compact
                className="ms-auto"
                active={readAloud.activeKey === voiceKey}
                loading={readAloud.activeKey === voiceKey && readAloud.phase === "loading"}
                onClick={() =>
                  void readAloud.play(
                    voiceKey,
                    async () => (await getCompanionSpeech(companionId, { message_id: message.id })).url,
                    message.content.replace(/[#*_`|>]/g, " "),
                  )
                }
              />
            )}
          </div>
        )}

        {followUps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {followUps.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => onFollowUp(q)}
                className="rounded-full border border-primary-200 bg-white px-3 py-1.5 text-start text-sm font-medium text-primary-500 transition-colors hover:bg-primary-50 disabled:opacity-50 dark:border-primary-500/30 dark:bg-neutral-900 dark:hover:bg-primary-500/10"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
