/**
 * Report views of a Spreadsheet & Written Response (CBE_RESPONSE) answer:
 * the learner's parts (read-only sheet / document) and, once the result is
 * released, the model solution per part. Uses the light SheetView /
 * DocumentView renderers only — Fortune-sheet and TipTap never load here.
 *
 * Inputs are the report review row's raw JSON strings:
 *  - `student_response_options`: the attempt's question node
 *    (`{ questionId, …, responseData: { type, answer: { parts } } }`);
 *  - `correct_options`: the question config (`{ type, data: { parts } }`),
 *    redacted by the server until the attempt's report is released.
 */
import type { TFunction } from "i18next";
import { FileText, GridFour, ClipboardText } from "@phosphor-icons/react";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { DocumentView } from "@/components/cbe/DocumentView";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { SheetView } from "@/components/cbe/SheetView";
import {
  CBE_QUESTION_TYPE,
  isCbePartAnswerEmpty,
  parseCbeConfig,
  type CbeConfig,
  type CbeMarkingLine,
  type CbePart,
  type CbePartAnswer,
  type CbePartContent,
} from "@/components/cbe/types";

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The learner's `{ parts }` and paste counter from a review's student_response_options. */
export function parseCbeStudentResponse(raw: unknown): {
  parts: Record<string, CbePartAnswer>;
  pasteAttemptCount: number;
} {
  const node = parseJson(raw);
  const responseData = isRecord(node) && isRecord(node.responseData) ? node.responseData : node;
  const answer = isRecord(responseData) ? responseData.answer : null;
  const parts = isRecord(answer) && isRecord(answer.parts) ? (answer.parts as Record<string, CbePartAnswer>) : {};
  const pasteAttemptCount =
    isRecord(responseData) && typeof responseData.pasteAttemptCount === "number"
      ? responseData.pasteAttemptCount
      : 0;
  return { parts, pasteAttemptCount };
}

/** The question config from a review's correct_options (null when unparseable). */
export const parseCbeReviewConfig = (raw: unknown): CbeConfig | null => parseCbeConfig(parseJson(raw));

/** True once the config carries at least one part's model solution (i.e. after release). */
export const cbeConfigHasSolution = (config: CbeConfig | null): boolean =>
  !!config?.data.parts.some((p) => !!p.solution);

/** "(a) Spreadsheet · 16 marks" */
export function cbePartTitle(
  part: Pick<CbePart, "label" | "kind" | "marks">,
  t: TFunction,
): string {
  const kind = part.kind === "SPREADSHEET" ? t("cbeReview.kindSpreadsheet") : t("cbeReview.kindDocument");
  const marks = t("cbeReview.marks", { count: part.marks ?? 0 });
  return [part.label, kind].filter(Boolean).join(" ") + ` · ${marks}`;
}

function PartHeading({ part, t }: { part: Pick<CbePart, "label" | "kind" | "marks">; t: TFunction }) {
  const Icon = part.kind === "SPREADSHEET" ? GridFour : FileText;
  return (
    <p className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
      <Icon size={14} className="flex-none text-muted-foreground" aria-hidden />
      {cbePartTitle(part, t)}
    </p>
  );
}

function PartContent({
  content,
  highlight,
  emptyText,
}: {
  content: CbePartAnswer | CbePartContent | null | undefined;
  highlight?: string[];
  emptyText: string;
}) {
  if (content && "sheet" in content && content.sheet) {
    return <SheetView sheet={content.sheet} highlight={highlight} emptyText={emptyText} />;
  }
  if (content && "html" in content) {
    return <DocumentView html={content.html} emptyText={emptyText} className="rounded-md border border-border bg-card p-3" />;
  }
  return <p className="text-caption italic text-muted-foreground">{emptyText}</p>;
}

/** Parts in config order; answer-only parts (config missing) follow in key order. */
function orderedParts(
  config: CbeConfig | null,
  answers: Record<string, CbePartAnswer>,
): Array<Pick<CbePart, "id" | "label" | "kind" | "marks" | "template">> {
  const fromConfig = config?.data.parts ?? [];
  const known = new Set(fromConfig.map((p) => p.id));
  const extra = Object.entries(answers)
    .filter(([id]) => !known.has(id))
    .map(([id, a], i) => ({
      id,
      label: `(${String.fromCharCode(97 + fromConfig.length + i)})`,
      kind: a.kind,
      marks: 0,
      template: null,
    }));
  return [...fromConfig, ...extra];
}

export function CbeStudentResponse({
  studentResponse,
  correctOptions,
  t,
}: {
  studentResponse: unknown;
  correctOptions: unknown;
  t: TFunction;
}) {
  const cbeStrings = useLearnerCbeStrings();
  const config = parseCbeReviewConfig(correctOptions);
  const { parts: answers, pasteAttemptCount } = parseCbeStudentResponse(studentResponse);
  const parts = orderedParts(config, answers);
  const answered = parts.filter((p) => !isCbePartAnswerEmpty(answers[p.id], p.template ?? null));

  if (!answered.length) {
    return <p>{t("questionResponseRenderer.noResponse")}</p>;
  }

  return (
    <CbeStringsProvider value={cbeStrings}>
    <div className="flex w-full min-w-0 flex-col gap-4" data-cbe-review="">
      {pasteAttemptCount > 0 && (
        <span className="w-fit rounded-md bg-warning-50 px-1.5 py-0.5 text-caption text-warning-700">
          {t("questionResponseRenderer.pasteAttempts", { count: pasteAttemptCount })}
        </span>
      )}
      {parts.map((part) => {
        const answer = answers[part.id];
        const empty = isCbePartAnswerEmpty(answer, part.template ?? null);
        return (
          <div key={part.id} className="flex min-w-0 flex-col gap-2">
            <PartHeading part={part} t={t} />
            {empty ? (
              <p className="text-caption italic text-muted-foreground">{t("cbeReview.noAnswerForPart")}</p>
            ) : (
              <PartContent content={answer} emptyText={t("cbeReview.noAnswerForPart")} />
            )}
          </div>
        );
      })}
    </div>
    </CbeStringsProvider>
  );
}

function MarkingLines({ lines, t }: { lines: CbeMarkingLine[]; t: TFunction }) {
  if (!lines.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-caption text-muted-foreground">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap gap-x-2">
          <span className="font-medium text-foreground">{line.label}</span>
          <span className="tabular-nums">{t("cbeReview.marks", { count: line.marks })}</span>
          {line.expected && <span>{t("cbeReview.expected", { value: line.expected })}</span>}
          {line.cellRef && <span className="font-mono">{line.cellRef}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Model solution per part, or — before release, when the server has stripped
 * it — a note that it will appear once results are released.
 */
export function CbeCorrectAnswer({ correctOptions, t }: { correctOptions: unknown; t: TFunction }) {
  const cbeStrings = useLearnerCbeStrings();
  const config = parseCbeReviewConfig(correctOptions);
  if (!config || !cbeConfigHasSolution(config)) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <ClipboardText size={14} className="flex-none" aria-hidden />
        {t("cbeReview.solutionAfterRelease")}
      </p>
    );
  }
  return (
    <CbeStringsProvider value={cbeStrings}>
    <div className="flex w-full min-w-0 flex-col gap-4" data-cbe-solution="">
      {config.data.parts.map((part) => {
        const lines = part.markingScheme ?? [];
        const highlight = lines.map((l) => l.cellRef).filter((ref): ref is string => !!ref);
        return (
          <div key={part.id} className="flex min-w-0 flex-col gap-2">
            <PartHeading part={part} t={t} />
            <PartContent content={part.solution} highlight={highlight} emptyText={t("cbeReview.noSolutionForPart")} />
            <MarkingLines lines={lines} t={t} />
          </div>
        );
      })}
    </div>
    </CbeStringsProvider>
  );
}

/**
 * Report badge text for a question type: CBE_RESPONSE gets its friendly name
 * (the raw enum means nothing to a learner); other types keep their existing
 * badge text.
 */
export const reportQuestionTypeLabel = (type: string | null | undefined, t: TFunction): string =>
  type === CBE_QUESTION_TYPE ? t("cbeReview.typeLabel") : String(type ?? "");
