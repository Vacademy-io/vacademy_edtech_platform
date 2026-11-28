import React, { useLayoutEffect, useRef, useState } from "react";
import { ImageSquare, PaperPlaneTilt, Sigma, SpinnerGap, Stop, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatbotContext } from "./useChatbotContext";
import { MicButton } from "./MicButton";
import { ChatSuggestions } from "./ChatSuggestions";
import type { ChatAttachments } from "./useChatAttachments";

const LATEX_SYMBOLS = [
  { label: "√", insert: "\\sqrt{}" },
  { label: "x²", insert: "^{2}" },
  { label: "xₙ", insert: "_{n}" },
  { label: "∫", insert: "\\int_{a}^{b}" },
  { label: "Σ", insert: "\\sum_{i=1}^{n}" },
  { label: "π", insert: "\\pi" },
  { label: "α", insert: "\\alpha" },
  { label: "β", insert: "\\beta" },
  { label: "θ", insert: "\\theta" },
  { label: "∞", insert: "\\infty" },
  { label: "≠", insert: "\\neq" },
  { label: "≤", insert: "\\leq" },
  { label: "≥", insert: "\\geq" },
  { label: "÷", insert: "\\frac{}{}" },
  { label: "lim", insert: "\\lim_{x \\to }" },
  { label: "dx", insert: "\\frac{d}{dx}" },
  { label: "∂", insert: "\\partial" },
  { label: "±", insert: "\\pm" },
];

const PREVIEW_REMARK = [remarkMath];
const PREVIEW_REHYPE = [rehypeKatex];
const TEXTAREA_MAX_HEIGHT = 120;

const ICON_BUTTON =
  "h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface ChatComposerProps {
  /** Owned by the panel so a drop anywhere on it lands here. */
  attachments: ChatAttachments;
  className?: string;
}

/**
 * The message box shared by both chat panels: suggestions, attached images,
 * the LaTeX helper + preview, mic, and send.
 */
export const ChatComposer: React.FC<ChatComposerProps> = ({ attachments, className }) => {
  const { t } = useTranslation("chatFeatureB");
  const {
    messages,
    inputValue,
    setInputValue,
    sendMessage,
    isLoading,
    isStreaming,
    stopGeneration,
    sessionId,
  } = useChatbotContext();
  const [showLatexHelper, setShowLatexHelper] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { ready, isUploading } = attachments;
  const hasText = inputValue.trim().length > 0;
  // Image-only messages are allowed; nothing goes while an upload is running.
  const canSend = !!sessionId && !isLoading && !isUploading && (hasText || ready.length > 0);
  // While the AI works, Send becomes Stop; the box stays typeable.
  const isBusy = !!sessionId && (isLoading || isStreaming);

  // Grow with the text, including text set from outside (mic, suggestions),
  // and shrink back once the message is sent.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? "auto" : "hidden";
  }, [inputValue]);

  const handleSend = () => {
    if (!canSend) return;
    // Backend auto-classifies the intent from the text.
    sendMessage(hasText ? inputValue : "", undefined, ready.length > 0 ? ready : undefined);
    attachments.clear();
  };

  return (
    <div
      className={cn(
        "border-t border-border/40 px-2.5 py-2 shrink-0 max-h-pct-45 overflow-y-auto flex flex-col gap-2 bg-background",
        className,
      )}
    >
      {/* Until the first question, the starters sit in the conversation instead. */}
      {!hasText && messages.some((m) => m.role === "user") && <ChatSuggestions compact />}

      {attachments.attachments.length > 0 && (
        <ul className="flex gap-1.5 w-full px-1 py-1">
          {attachments.attachments.map((att) => (
            <li key={att.key} className="relative size-12 rounded border overflow-hidden">
              <img
                src={att.previewUrl || att.url}
                alt={att.name || t("common.attachmentAlt")}
                className="size-full object-cover"
              />
              {!att.url && (
                <div className="absolute inset-0 bg-foreground/40 flex items-center justify-center">
                  <SpinnerGap className="h-4 w-4 text-background animate-spin" aria-hidden="true" />
                  <span className="sr-only">{t("composer.uploading")}</span>
                </div>
              )}
              <button
                type="button"
                className="absolute top-0.5 end-0.5 size-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => attachments.remove(att.key)}
                aria-label={t("composer.removeImage")}
                title={t("composer.removeImage")}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) attachments.addFile(file);
          e.target.value = "";
        }}
      />

      {showLatexHelper && (
        <div className="w-full flex flex-wrap gap-1 px-1 py-1 bg-muted/30 rounded-lg border border-border/50">
          {LATEX_SYMBOLS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="h-7 min-w-8 px-1.5 text-xs font-mono rounded bg-background hover:bg-primary/10 hover:text-primary border border-border/50 transition-colors"
              onClick={() => {
                // Wrap in $ delimiters unless the learner is already inside one.
                const hasOpenDelimiter = inputValue.lastIndexOf("$") > inputValue.lastIndexOf(" ");
                setInputValue(inputValue + (hasOpenDelimiter ? item.insert : `$${item.insert}$`));
                textareaRef.current?.focus();
              }}
              title={item.insert}
              aria-label={item.insert}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {inputValue.includes("$") && (
        <div className="w-full px-2 py-1 bg-muted/20 rounded border border-dashed border-border/50 text-xs overflow-x-auto space-y-0.5">
          <span className="text-muted-foreground text-caption block">{t("common.preview")}</span>
          <ReactMarkdown remarkPlugins={PREVIEW_REMARK} rehypePlugins={PREVIEW_REHYPE}>
            {inputValue}
          </ReactMarkdown>
        </div>
      )}

      <div className="w-full flex items-end gap-1 bg-muted/40 rounded-xl p-1 ring-1 ring-border/50 focus-within:ring-2 focus-within:ring-primary/30 transition-all">
        <textarea
          ref={textareaRef}
          placeholder={t("sidePanel.inputPlaceholder")}
          aria-label={t("sidePanel.inputPlaceholder")}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={!sessionId}
          rows={1}
          className="flex-1 min-h-8 max-h-32 overflow-hidden px-3 py-1.5 text-sm bg-transparent border-0 shadow-none focus:outline-none focus-visible:ring-0 placeholder:text-muted-foreground/50 resize-none disabled:opacity-50"
        />
        <button
          type="button"
          className={cn(ICON_BUTTON, showLatexHelper && "bg-primary/10 text-primary hover:text-primary")}
          onClick={() => setShowLatexHelper((prev) => !prev)}
          aria-label={t("common.mathSymbols")}
          aria-pressed={showLatexHelper}
          title={t("common.mathSymbols")}
        >
          <Sigma className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          onClick={() => fileInputRef.current?.click()}
          disabled={!sessionId || isLoading || isUploading}
          aria-label={t("panel.attachImageTitle")}
          title={t("panel.attachImageTitle")}
        >
          {isUploading ? (
            <SpinnerGap className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImageSquare className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <MicButton
          sessionId={sessionId || ""}
          disabled={!sessionId || isLoading}
          // The transcript only fills the box; the learner reviews and sends.
          onTranscript={(text) => setInputValue(text)}
        />
        {isBusy ? (
          <Button
            type="button"
            onClick={stopGeneration}
            size="icon"
            aria-label={t("composer.stop")}
            title={t("composer.stop")}
            className="h-8 w-8 shrink-0 rounded-lg bg-foreground text-background shadow-sm transition-all hover:bg-foreground/80"
          >
            <Stop className="h-4 w-4" weight="fill" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            size="icon"
            aria-label={t("composer.send")}
            title={t("composer.send")}
            className={cn(
              "h-8 w-8 shrink-0 rounded-lg transition-all",
              hasText || ready.length > 0
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground",
            )}
          >
            <PaperPlaneTilt className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
};

/** Shown over a panel while an image is dragged onto it. */
export const ImageDropOverlay: React.FC = () => {
  const { t } = useTranslation("chatFeatureB");
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/5 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-2 text-primary">
        <ImageSquare className="h-10 w-10" aria-hidden="true" />
        <span className="text-sm font-medium">{t("common.dropImageHere")}</span>
      </div>
    </div>
  );
};
