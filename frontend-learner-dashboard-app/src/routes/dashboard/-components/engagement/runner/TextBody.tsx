import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import { parseQuestionPayload, type EngagementItem } from "@/services/engagement";
import { ecn, skinClasses } from "../engagement-tone";
import { RichText } from "./QuestionBody";

/**
 * A written answer (D29). The draft lives in the engagement draft store
 * (mirrored to sessionStorage), so it survives closing the runner, the Today
 * module switching slots and an offline submit. A counter shows the limit.
 */

/** Longest written answer the app accepts. */
export const TEXT_ANSWER_MAX = 2000;
/** From here the counter turns to a warning. */
const NEAR_LIMIT = 0.9;

export interface TextBodyProps {
  item: EngagementItem;
  value: string;
  onChange: (text: string) => void;
  /**
   * Answered or read-only: show this text instead of the editor ("" when the
   * text isn't known, e.g. a task finished on another device: nothing shows).
   */
  submitted?: string | null;
  disabled?: boolean;
}

export function TextBody({ item, value, onChange, submitted, disabled }: TextBodyProps) {
  const { t } = useTranslation("dashboardEngagement");
  const promptId = useId();
  const counterId = useId();
  const hintId = useId();
  const prompt = parseQuestionPayload(item)?.prompt ?? item.promptText ?? "";
  const length = value.length;
  const near = length >= TEXT_ANSWER_MAX * NEAR_LIMIT;

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-6">
      {prompt ? (
        <RichText id={promptId} html={prompt} className={ecn("text-subtitle font-medium", skinClasses("ink"))} />
      ) : (
        <p id={promptId} className={ecn("text-subtitle font-medium", skinClasses("ink"))}>
          {item.title}
        </p>
      )}

      {submitted != null ? (
        submitted && (
          <div
            className={ecn(
              "min-w-0 rounded-lg border p-card",
              skinClasses("divider"),
              "bg-muted/40 [.ui-cleaner-play_&]:bg-cp-bg-deep"
            )}
          >
            <p className={ecn("text-caption font-medium", skinClasses("mutedInk"))}>{t("result.youWrote")}</p>
            <p dir="auto" className={ecn("mt-1 whitespace-pre-wrap break-words text-body", skinClasses("ink"))}>
              {submitted}
            </p>
          </div>
        )
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value.slice(0, TEXT_ANSWER_MAX))}
            maxLength={TEXT_ANSWER_MAX}
            rows={7}
            dir="auto"
            disabled={disabled}
            placeholder={t("runner.text.placeholder")}
            aria-labelledby={promptId}
            aria-describedby={`${hintId} ${counterId}`}
            className="min-h-40 resize-y"
          />
          <div className="flex items-start justify-between gap-3">
            <p id={hintId} className={ecn("text-caption", skinClasses("mutedInk"))}>
              {t("runner.text.hint")}
            </p>
            <p
              id={counterId}
              aria-live={near ? "polite" : "off"}
              className={ecn(
                "shrink-0 text-caption tabular-nums",
                near ? "font-medium text-warning-700 [.ui-play_&]:text-play-warn-soft-ink" : skinClasses("mutedInk")
              )}
            >
              {t("runner.text.charCount", { count: length, max: TEXT_ANSWER_MAX })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
