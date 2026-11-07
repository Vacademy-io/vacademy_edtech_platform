import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, UsersThree, Warning } from "@phosphor-icons/react";
import { formatPercent } from "@/lib/formatters";
import { parseHtmlToString } from "@/lib/utils";
import { WhyWrongButton } from "@/components/chatbot/moments/WhyWrongButton";
import { SelectionAskZone } from "@/components/chatbot/moments/SelectionAskPill";
import { getFileDetail } from "@/services/upload_file";
import { parseQuestionPayload, type EngagementItem } from "@/services/engagement";
import { ChoiceOptions } from "@/routes/dashboard/-components/engagement/ChoiceOptions";
import { StateBadge, type EngagementBadgeKind } from "@/routes/dashboard/-components/engagement/EngagementBadge";
import { visualFor } from "@/routes/dashboard/-components/engagement/engagement-visuals";
import { promptTextFor } from "@/routes/dashboard/-components/engagement/engagement-preview";
import {
  ecn,
  skinClasses,
  toneClasses,
} from "@/routes/dashboard/-components/engagement/engagement-tone";
import {
  answerFormat,
  formatClock,
  revealCopy,
  typeLabel,
} from "@/routes/dashboard/-components/engagement/engagement-copy";
import { isoDayShort } from "./DayStrip";
import { EarnedPoints } from "./PastRow";

/**
 * One answered question or poll on the Answers tab (D10, D25).
 *
 * - Multiple choice: the options with the right answer and the learner's pick
 *   marked, "62% of your class got it right", and the teacher's explanation.
 * - Poll: the vote split as bars (percentages only from 5 votes, as the server rule).
 * - Written / uploaded: "You wrote…" or the file chips, "Sent to your teacher", and
 *   the model answer once the reveal passes.
 *
 * `waiting` is the same card before the reveal: the learner's own answer, locked,
 * with when the result or answer arrives.
 */

/** Learner-contract fields the shared `EngagementItem` type does not list yet. */
export type EngagementAnswerItem = EngagementItem & {
  /** The learner's own written answer (TEXT question), on a completed attempt. */
  textAnswer?: string | null;
  /** The learner's own file ids (UPLOAD question), on a completed attempt. */
  fileIds?: string[] | null;
  /** Revealed keyed questions: share of right answers, 0..1; null under 5 answers. */
  correctRate?: number | null;
};

export interface RevealCardProps {
  item: EngagementAnswerItem;
  variant: "revealed" | "waiting";
  showPoints: boolean;
  /** Server "now" (ms). */
  now: number;
  className?: string;
}

interface AnswerPayload {
  options?: { id: string; text: string }[];
  correctOptionId?: string;
  explanation?: string;
  /** A written question's model answer (sent only once the key may be shown). */
  answer?: unknown;
}

function readPayload(item: EngagementItem): AnswerPayload {
  return (parseQuestionPayload(item) as AnswerPayload | null) ?? {};
}

const HTML_TAG = /<[a-z][\s\S]*>/i;

/** Teacher text, rich or plain. Rich text is sanitised before it touches the DOM. */
function TeacherText({ value, className }: { value: string; className?: string }) {
  if (HTML_TAG.test(value)) {
    return (
      <div
        dir="auto"
        className={ecn(
          "min-w-0 break-words text-body [&_a]:text-primary-500 [&_a]:underline [&_li]:ms-5 [&_ol]:list-decimal [&_p+p]:mt-2 [&_ul]:list-disc",
          skinClasses("ink"),
          className
        )}
        // Teacher-authored rich text, sanitised; never learner input.
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value, { USE_PROFILES: { html: true } }) }}
      />
    );
  }
  return (
    <p dir="auto" className={ecn("min-w-0 whitespace-pre-wrap break-words text-body", skinClasses("ink"), className)}>
      {value}
    </p>
  );
}

function Block({ label, children, tone = "plain" }: { label: string; children: ReactNode; tone?: "plain" | "key" }) {
  return (
    <div
      className={ecn(
        "flex min-w-0 flex-col gap-1 rounded-md border p-3",
        tone === "key"
          ? "border-success-200 bg-success-50 [.ui-play_&]:border-play-success-deep [.ui-play_&]:bg-play-success-soft [.ui-cleaner-play_&]:border-cp-sage [.ui-cleaner-play_&]:bg-cp-sage-tint"
          : "border-border bg-muted/40 [.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-bg-deep"
      )}
    >
      <p className={ecn("text-caption font-medium", skinClasses("mutedInk"))}>{label}</p>
      {children}
    </div>
  );
}

/** One uploaded file, resolved to a signed link on demand. */
function FileChip({ fileId, index }: { fileId: string; index: number }) {
  const { t } = useTranslation("dashboardEngagement");
  const detail = useQuery({
    queryKey: ["engagement", "file", fileId],
    queryFn: () => getFileDetail(fileId),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const name = detail.data?.fileName || t("page.answers.file", { index: index + 1 });
  const chip =
    "inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-border bg-card px-3 text-body [.ui-cleaner-play_&]:border-cp-border";
  if (detail.data?.url) {
    return (
      <a
        href={detail.data.url}
        target="_blank"
        rel="noopener noreferrer"
        className={ecn(
          chip,
          "text-primary-500 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
        )}
      >
        <Paperclip aria-hidden className="size-4 shrink-0" />
        <span dir="auto" className="min-w-0 truncate">
          {name}
        </span>
      </a>
    );
  }
  return (
    <span className={ecn(chip, skinClasses("mutedInk"))}>
      {detail.isError ? (
        <Warning aria-hidden className="size-4 shrink-0" />
      ) : (
        <Paperclip aria-hidden className="size-4 shrink-0" />
      )}
      <span className="min-w-0 truncate">
        {detail.isError ? t("page.answers.fileUnavailable", { index: index + 1 }) : name}
      </span>
    </span>
  );
}

function outcomeBadge(item: EngagementItem): EngagementBadgeKind | null {
  if (item.itemType === "POLL") return null;
  const format = answerFormat(item);
  if (format !== "MCQ") return item.isLate ? "late" : "done";
  if (item.resultPending === true) return "pending";
  if (item.isCorrect === true) return "correct";
  if (item.isCorrect === false) return "wrong";
  return "done";
}

export function RevealCard({ item, variant, showPoints, now, className }: RevealCardProps) {
  const { t } = useTranslation("dashboardEngagement");
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const visual = visualFor(item);
  const TypeIcon = visual.icon;
  const payload = readPayload(item);
  const format = answerFormat(item);
  const isPoll = item.itemType === "POLL";
  const options = payload.options ?? [];
  const correctId = item.correctOptionId ?? payload.correctOptionId ?? null;
  const explanation = item.explanation ?? payload.explanation ?? null;
  const prompt = promptTextFor(item);
  const showPrompt = Boolean(prompt) && prompt !== item.title;
  // The options are named by the prompt, or by the title when the two are the same.
  const promptId = showPrompt ? `${baseId}-prompt` : titleId;
  const badge = outcomeBadge(item);
  const waiting = variant === "waiting";

  const modelAnswer =
    typeof payload.answer === "string" && payload.answer.trim() ? payload.answer : null;
  const revealAhead = (() => {
    const ms = Date.parse(item.revealAt ?? "");
    return Number.isFinite(ms) && ms > now && item.isRevealed !== true;
  })();

  // --- Body by type -----------------------------------------------------------------
  let body: ReactNode = null;
  if (isPoll) {
    const hasResults = Boolean(item.pollResults && item.pollResults.length > 0);
    body = (
      <ChoiceOptions
        options={options}
        mode={waiting && !hasResults ? "result" : "pollResults"}
        selectedId={item.selectedOptionId}
        pollResults={item.pollResults}
        responseCount={item.responseCount}
        promptId={promptId}
        size="main"
        tone={visual.tone}
      />
    );
  } else if (format === "MCQ") {
    body = (
      <ChoiceOptions
        options={options}
        mode={correctId ? "revealed" : "result"}
        selectedId={item.selectedOptionId}
        correctId={correctId}
        selectedCorrect={item.resultPending === true ? null : item.isCorrect}
        promptId={promptId}
        size="main"
        tone={visual.tone}
      />
    );
  } else if (format === "TEXT") {
    body = item.textAnswer ? (
      <Block label={t("result.youWrote")}>
        <p dir="auto" className={ecn("whitespace-pre-wrap break-words text-body", skinClasses("ink"))}>
          {item.textAnswer}
        </p>
      </Block>
    ) : null;
  } else if (format === "UPLOAD") {
    const files = item.fileIds ?? [];
    body =
      files.length > 0 ? (
        <Block label={t("page.answers.youSent", { count: files.length })}>
          <div className="flex flex-wrap gap-2">
            {files.map((id, i) => (
              <FileChip key={id} fileId={id} index={i} />
            ))}
          </div>
        </Block>
      ) : null;
  }

  // --- Lines after the body ------------------------------------------------------------
  const rate =
    format === "MCQ" && typeof item.correctRate === "number" && Number.isFinite(item.correctRate)
      ? item.correctRate
      : null;
  const whenLine = waiting ? revealCopy(item, null, t, now) : null;
  const modelAnswerLater =
    waiting && (format === "TEXT" || format === "UPLOAD") && revealAhead
      ? t("page.answers.modelAnswerAt", { time: formatClock(item.revealAt, now) })
      : null;
  const earned = showPoints && (item.pointsAwarded ?? 0) > 0;
  const dateLabel = isoDayShort(item.runDate);

  // "Why was I wrong?" only on the revealed card of a keyed question the
  // learner missed: the key is on screen (the server sends it only after the
  // reveal, once the learner can no longer answer — §19.1).
  const pickedText = options.find((o) => o.id === item.selectedOptionId)?.text ?? "";
  const keyText = options.find((o) => o.id === correctId)?.text ?? "";
  const canAskWhy =
    !waiting &&
    !isPoll &&
    format === "MCQ" &&
    item.isRevealed !== false &&
    item.resultPending !== true &&
    item.isCorrect === false &&
    Boolean(correctId && pickedText && keyText) &&
    item.selectedOptionId !== correctId;

  return (
    <article
      aria-labelledby={titleId}
      className={ecn(skinClasses("card"), "flex min-w-0 flex-col gap-3 p-3 sm:gap-stack sm:p-card", className)}
    >
      <header className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="shrink-0">
          <span
            className={ecn(
              "flex size-9 items-center justify-center rounded-lg [.ui-cleaner-play_&]:hidden",
              toneClasses(visual.tone, "tile")
            )}
          >
            <TypeIcon weight="duotone" className="size-5" />
          </span>
          <img src={visual.art} alt="" className="hidden size-9 object-contain [.ui-cleaner-play_&]:block" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className={ecn("text-caption", skinClasses("mutedInk"))}>
            {dateLabel ? t("page.answers.typeAndDate", { type: typeLabel(item, t), date: dateLabel }) : typeLabel(item, t)}
          </p>
          <h3
            id={titleId}
            dir="auto"
            className={ecn("line-clamp-2 break-words text-body font-semibold", skinClasses("ink"))}
          >
            {item.title}
          </h3>
        </div>
        {badge && <StateBadge kind={badge} now={now} className="shrink-0" />}
      </header>

      {showPrompt && (
        <p id={promptId} dir="auto" className={ecn("break-words text-body", skinClasses("ink"))}>
          {prompt}
        </p>
      )}

      {body}

      {rate != null && (
        <p className={ecn("inline-flex items-center gap-1.5 text-caption", skinClasses("mutedInk"))}>
          <UsersThree aria-hidden className="size-4 shrink-0" />
          {typeof item.responseCount === "number" && item.responseCount > 0
            ? t("page.answers.correctRateOf", {
                percent: formatPercent(rate, { maximumFractionDigits: 0 }),
                count: item.responseCount,
              })
            : t("page.answers.correctRate", { percent: formatPercent(rate, { maximumFractionDigits: 0 }) })}
        </p>
      )}

      {!waiting && explanation && format === "MCQ" && (
        <Block label={t("page.answers.why")}>
          <SelectionAskZone lessonName={item.title}>
            <TeacherText value={explanation} />
          </SelectionAskZone>
        </Block>
      )}

      {canAskWhy && (
        <WhyWrongButton
          className="self-start"
          getDetails={() => ({
            question: prompt || item.title,
            yourAnswer: pickedText,
            correctAnswer: keyText,
            explanation: explanation ? parseHtmlToString(explanation) : null,
            source: showPrompt ? item.title : typeLabel(item, t),
          })}
        />
      )}

      {!waiting && (format === "TEXT" || format === "UPLOAD") && (modelAnswer || explanation) && (
        <Block label={t("page.answers.modelAnswer")} tone="key">
          <TeacherText value={(modelAnswer ?? explanation) as string} />
        </Block>
      )}

      {(whenLine || modelAnswerLater || earned) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {whenLine && (
            <p className={ecn("text-caption font-medium", skinClasses("ink"))}>{whenLine}</p>
          )}
          {modelAnswerLater && (
            <p className={ecn("text-caption", skinClasses("mutedInk"))}>{modelAnswerLater}</p>
          )}
          {earned && <EarnedPoints item={item} className="ms-auto" />}
        </div>
      )}
    </article>
  );
}
