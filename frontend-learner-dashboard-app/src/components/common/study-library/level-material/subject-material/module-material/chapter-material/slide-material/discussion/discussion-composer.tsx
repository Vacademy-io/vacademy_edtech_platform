import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CircleNotch, PaperPlaneRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MyButton } from "@/components/design-system/button";
import { formatNumber } from "@/lib/formatters";
import { DISCUSSION_MAX_CHARS } from "./discussion-api";

/** The count appears once the learner is this close to the limit. */
const COUNT_FROM_REMAINING = 500;
/** Tallest the box grows before it scrolls, in px. */
const MAX_AUTO_HEIGHT = 360;

const readDraft = (key?: string): string => {
  if (!key) return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

const writeDraft = (key: string | undefined, value: string) => {
  if (!key) return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be blocked (private mode); the draft just isn't kept.
  }
};

export interface DiscussionComposerProps {
  /** Visible label above the box (also its accessible name). */
  label: string;
  /** Hide the label visually, keeping it for screen readers. */
  hideLabel?: boolean;
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
  /** Keeps an unsent draft for this browser tab under this key. */
  draftKey?: string;
  /** Offer "Post anonymously" (only when the discussion allows it). */
  allowAnonymous?: boolean;
  /** Lines under the box: who will see this, approval, etc. */
  notes?: ReactNode;
  compact?: boolean;
  autoFocus?: boolean;
  submitting?: boolean;
  /** Resolve to clear the box; reject to keep the text for another try. */
  onSubmit: (content: string, anonymous: boolean) => Promise<unknown>;
  onCancel?: () => void;
  className?: string;
}

/**
 * The reply box, used for a response, a comment and an edit. Grows with the
 * text, keeps the draft if the learner wanders off, and only counts
 * characters when the limit is actually near.
 */
export function DiscussionComposer({
  label,
  hideLabel = false,
  placeholder,
  submitLabel,
  initialValue = "",
  draftKey,
  allowAnonymous = false,
  notes,
  compact = false,
  autoFocus = false,
  submitting = false,
  onSubmit,
  onCancel,
  className,
}: DiscussionComposerProps) {
  const { t } = useTranslation("studyContent");
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => readDraft(draftKey) || initialValue);
  const [anonymous, setAnonymous] = useState(false);

  // Grow with the text up to a ceiling, then scroll inside.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_AUTO_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  const trimmed = value.trim();
  const remaining = DISCUSSION_MAX_CHARS - value.length;
  const unchanged = trimmed === initialValue.trim() && initialValue !== "";
  const canSubmit = trimmed.length > 0 && remaining >= 0 && !submitting && !unchanged;

  const handleChange = (next: string) => {
    setValue(next);
    writeDraft(draftKey, next);
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await onSubmit(trimmed, allowAnonymous && anonymous);
      setValue("");
      setAnonymous(false);
      writeDraft(draftKey, "");
    } catch {
      // The caller already said what went wrong; the text stays for a retry.
    }
  };

  return (
    <form
      className={cn("flex flex-col", compact ? "gap-2" : "gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label
        htmlFor={id}
        className={cn(
          hideLabel ? "sr-only" : "text-subtitle font-semibold text-foreground"
        )}
      >
        {label}
      </label>
      <Textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          // Cmd/Ctrl+Enter sends; plain Enter is a new line, as people expect
          // when writing more than a sentence.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        maxLength={DISCUSSION_MAX_CHARS}
        disabled={submitting}
        rows={compact ? 2 : 4}
        aria-describedby={`${id}-count`}
        className={cn(
          "resize-none rounded-xl border-border bg-background leading-relaxed text-foreground shadow-none transition-colors",
          "placeholder:text-muted-foreground focus-visible:border-primary-300 focus-visible:ring-2 focus-visible:ring-primary-100",
          compact ? "min-h-16 px-3 py-2 text-body md:text-body" : "min-h-28 px-4 py-3 text-subtitle md:text-subtitle",
          "[.ui-play_&]:border-2 [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-surface"
        )}
      />

      {allowAnonymous && (
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${id}-anon`}
            checked={anonymous}
            onCheckedChange={(checked) => setAnonymous(checked === true)}
            disabled={submitting}
            className="mt-0.5"
          />
          <label htmlFor={`${id}-anon`} className="flex cursor-pointer flex-col gap-0.5">
            <span className="text-body font-medium text-foreground">
              {t("discussion.composer.anonymous")}
            </span>
            <span className="text-caption text-muted-foreground">
              {t("discussion.composer.anonymousHint")}
            </span>
          </label>
        </div>
      )}

      {notes}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p
          id={`${id}-count`}
          aria-live="polite"
          className={cn(
            "text-caption tabular-nums",
            remaining <= 100 ? "text-warning-600" : "text-muted-foreground",
            remaining > COUNT_FROM_REMAINING && "invisible"
          )}
        >
          {remaining <= COUNT_FROM_REMAINING
            ? t("discussion.composer.charactersLeft", {
                count: remaining,
                formatted: formatNumber(remaining),
              })
            : ""}
        </p>
        <div className="ms-auto flex items-center gap-2">
          {onCancel && (
            <MyButton
              type="button"
              buttonType="text"
              scale="medium"
              onClick={onCancel}
              disable={submitting}
              className="min-w-0 px-3 text-muted-foreground hover:text-foreground"
            >
              {t("discussion.composer.cancel")}
            </MyButton>
          )}
          <MyButton
            type="submit"
            buttonType="primary"
            scale="medium"
            disable={!canSubmit}
            className={cn("min-w-0 gap-2 rounded-full px-5", compact && "h-8 px-4 text-caption")}
          >
            {submitting ? (
              <CircleNotch size={16} className="animate-spin" aria-hidden />
            ) : (
              !compact && <PaperPlaneRight size={16} weight="fill" aria-hidden />
            )}
            {submitLabel}
          </MyButton>
        </div>
      </div>
    </form>
  );
}
