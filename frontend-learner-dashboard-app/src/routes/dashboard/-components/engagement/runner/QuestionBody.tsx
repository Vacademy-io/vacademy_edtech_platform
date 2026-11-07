import { useId } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { Info } from "@phosphor-icons/react";
import {
  parseQuestionPayload,
  type EngagementItem,
  type EngagementPollResult,
} from "@/services/engagement";
import { parseHtmlToString } from "@/lib/utils";
import { WhyWrongButton } from "@/components/chatbot/moments/WhyWrongButton";
import { ChoiceOptions, type ChoiceMode } from "../ChoiceOptions";
import { ecn, skinClasses, type EngagementTone } from "../engagement-tone";

/**
 * A multiple-choice question of the day or a poll (D7, D25, D41, D55): the
 * prompt, then a real radio group. Picking only selects; the runner footer's
 * Check / Vote commits. After the answer the same options show the outcome,
 * the key when the server sent it, or the poll split.
 */

/** Teacher rich text, sanitised before it reaches the DOM. */
export function RichText({ html, id, className }: { html: string; id?: string; className?: string }) {
  return (
    <div
      id={id}
      dir="auto"
      className={ecn("rich-text-content min-w-0 break-words", className)}
      // Sanitised here; never pass raw teacher HTML.
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) }}
    />
  );
}

/** What the options show once the question is answered (or the task is done). */
export interface QuestionOutcome {
  selectedId?: string | null;
  correctId?: string | null;
  /** Whether the pick was right; null while the result is held back. */
  isCorrect?: boolean | null;
  pollResults?: EngagementPollResult[] | null;
  responseCount?: number | null;
  explanation?: string | null;
}

export interface QuestionBodyProps {
  item: EngagementItem;
  isPoll: boolean;
  /** The pick while answering. */
  selectedId?: string;
  onSelect: (optionId: string) => void;
  /** Set once answered: the options turn read-only. */
  outcome?: QuestionOutcome | null;
  /** "You'll find out at 8:00 PM · +20 if right", shown before answering. */
  revealHint?: string | null;
  disabled?: boolean;
  tone?: EngagementTone;
  /** Closes the runner sheet before the tutor chat opens ("Why was I wrong?"). */
  onBeforeAskTutor?: () => void;
}

export function QuestionBody({
  item,
  isPoll,
  selectedId,
  onSelect,
  outcome,
  revealHint,
  disabled,
  tone,
  onBeforeAskTutor,
}: QuestionBodyProps) {
  const { t } = useTranslation("dashboardEngagement");
  const promptId = useId();
  const payload = parseQuestionPayload(item);
  const options = payload?.options ?? [];
  const prompt = payload?.prompt ?? item.promptText ?? "";

  let mode: ChoiceMode = isPoll ? "vote" : "answer";
  if (outcome) {
    const hasPollSplit = isPoll && Array.isArray(outcome.pollResults) && outcome.pollResults.length > 0;
    mode = hasPollSplit ? "pollResults" : outcome.correctId ? "revealed" : "result";
  }

  // "Why was I wrong?" only once the key is shown for a missed answer. The
  // server sends the key only after the reveal, when the learner can no longer
  // answer (§19.1), so an open graded question never offers it.
  const pickedText = options.find((o) => o.id === outcome?.selectedId)?.text ?? "";
  const keyText = options.find((o) => o.id === outcome?.correctId)?.text ?? "";
  const canAskWhy =
    !isPoll &&
    !!outcome?.correctId &&
    outcome.isCorrect === false &&
    outcome.selectedId !== outcome.correctId &&
    Boolean(pickedText && keyText);

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-6">
      {prompt ? (
        <RichText
          id={promptId}
          html={prompt}
          className={ecn("text-subtitle font-medium", skinClasses("ink"))}
        />
      ) : (
        <p id={promptId} className="sr-only">
          {item.title}
        </p>
      )}

      {options.length > 0 ? (
        <ChoiceOptions
          options={options}
          mode={mode}
          selectedId={outcome ? (outcome.selectedId ?? null) : (selectedId ?? null)}
          correctId={outcome?.correctId ?? null}
          selectedCorrect={outcome?.isCorrect ?? null}
          pollResults={outcome?.pollResults ?? null}
          responseCount={outcome?.responseCount ?? null}
          promptId={promptId}
          onSelect={onSelect}
          disabled={disabled}
          size="main"
          tone={tone}
        />
      ) : (
        <p className={ecn("text-body", skinClasses("mutedInk"))}>{t("runner.question.noOptions")}</p>
      )}

      {!outcome && revealHint && (
        <p className={ecn("flex items-start gap-2 text-caption", skinClasses("mutedInk"))}>
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{revealHint}</span>
        </p>
      )}

      {outcome?.explanation && (
        <section
          aria-label={t("runner.question.explanation")}
          className={ecn("rounded-lg border p-card", skinClasses("divider"), "bg-muted/40 [.ui-cleaner-play_&]:bg-cp-bg-deep")}
        >
          <p className={ecn("mb-1 text-caption font-semibold", skinClasses("mutedInk"))}>
            {t("runner.question.explanation")}
          </p>
          <RichText html={outcome.explanation} className={ecn("text-body", skinClasses("ink"))} />
        </section>
      )}

      {canAskWhy && (
        <WhyWrongButton
          className="self-start"
          onBeforeAsk={onBeforeAskTutor}
          getDetails={() => ({
            question: prompt ? parseHtmlToString(prompt) : item.title,
            yourAnswer: pickedText,
            correctAnswer: keyText,
            explanation: outcome?.explanation ? parseHtmlToString(outcome.explanation) : null,
            source: item.title,
          })}
        />
      )}
    </div>
  );
}
