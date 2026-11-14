/**
 * One CBE question's answer area: a tab per part ("(a) Spreadsheet · 16 marks"),
 * each with its requirement text and a spreadsheet or document editor. Used by
 * the live test and the question slide.
 *
 * `config` must be the learner-safe (redacted) config. A part with no stored
 * answer starts from `part.template`; a stored blank answer stays blank.
 *
 * The ref handle's `commit()` saves any spreadsheet edit still in progress and
 * returns the up-to-date answer (use it right before submitting).
 */
import { forwardRef, lazy, Suspense, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { FileText, GridFour, WarningCircle } from "@phosphor-icons/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CbeErrorBoundary } from "./cbe-error-boundary";
import { DEFAULT_CBE_STRINGS, useCbeStrings, type CbeStrings } from "./cbe-strings";
import { DocumentView } from "./DocumentView";
import { SpreadsheetEditor, type SpreadsheetEditorHandle } from "./SpreadsheetEditor";
import {
  CBE_MAX_ANSWER_BYTES,
  cbeAnswerSize,
  emptyCbeSheet,
  htmlToPlainText,
  type CbeAnswer,
  type CbeConfig,
  type CbePart,
  type CbePartAnswer,
  type CbeSheet,
} from "./types";

const loadDocumentEditor = () => import("./DocumentEditor");

export type CbeWorkspaceProps = {
  /** Learner-safe config (redactCbeConfig output); secrets are ignored if present. */
  config: CbeConfig | null | undefined;
  value: CbeAnswer | null | undefined;
  onChange?: (answer: CbeAnswer) => void;
  readOnly?: boolean;
  /** Spreadsheet grid height in px (default 460). */
  height?: number;
  className?: string;
};

export type CbeWorkspaceHandle = {
  /** Saves open spreadsheet edits and returns the latest answer. */
  commit: () => CbeAnswer | null;
};

/** "(a) Spreadsheet · 16 marks" */
export const cbePartTabLabel = (
  part: Pick<CbePart, "label" | "kind" | "marks">,
  strings: Pick<CbeStrings, "kind" | "marks"> = DEFAULT_CBE_STRINGS,
): string => `${part.label ? `${part.label} ` : ""}${strings.kind[part.kind] ?? part.kind} · ${strings.marks(part.marks)}`;

/**
 * Content a part starts from: the learner's stored answer (even when they
 * emptied it), else the template, else blank. Only a missing entry — never
 * saved, or dropped by "Clear response" — falls back to the template.
 */
export function seedPartAnswer(part: CbePart, answer: CbePartAnswer | undefined): CbePartAnswer {
  if (answer && answer.kind === part.kind) return answer;
  const tpl = part.template;
  if (part.kind === "SPREADSHEET") {
    const sheet: CbeSheet = tpl && "sheet" in tpl && tpl.sheet?.sheets?.length ? tpl.sheet : emptyCbeSheet();
    return { kind: "SPREADSHEET", sheet };
  }
  return { kind: "DOCUMENT", html: tpl && "html" in tpl ? tpl.html : "" };
}

const formatKb = (bytes: number) => `${Math.ceil(bytes / 1000)} KB`;

export const CbeWorkspace = forwardRef<CbeWorkspaceHandle, CbeWorkspaceProps>(function CbeWorkspace(
  { config, value, onChange, readOnly = false, height = 460, className },
  ref,
) {
  const strings = useCbeStrings();
  const parts = useMemo(() => config?.data?.parts ?? [], [config]);
  const [activeId, setActiveId] = useState<string | undefined>(() => parts[0]?.id);
  const current = parts.some((p) => p.id === activeId) ? activeId : parts[0]?.id;
  const [DocumentEditor, setDocumentEditor] = useState(() => lazy(loadDocumentEditor));
  const retryDocument = useCallback(() => setDocumentEditor(() => lazy(loadDocumentEditor)), []);

  // Debounced editors may report after a newer value arrived: always merge into the latest.
  const valueRef = useRef(value);
  valueRef.current = value;
  const updatePart = useCallback(
    (partId: string, next: CbePartAnswer) => {
      const base = valueRef.current?.parts ?? {};
      const answer: CbeAnswer = { parts: { ...base, [partId]: next } };
      valueRef.current = answer;
      onChange?.(answer);
    },
    [onChange],
  );

  // Mounted spreadsheet editors (only the active tab's is mounted).
  const sheetHandles = useRef(new Map<string, SpreadsheetEditorHandle>());
  const sheetRef = useCallback(
    (partId: string) => (handle: SpreadsheetEditorHandle | null) => {
      if (handle) sheetHandles.current.set(partId, handle);
      else sheetHandles.current.delete(partId);
    },
    [],
  );
  useImperativeHandle(
    ref,
    () => ({
      commit: () => {
        // Each commit reports through updatePart synchronously, which updates valueRef.
        sheetHandles.current.forEach((handle) => handle.commit());
        return valueRef.current ?? null;
      },
    }),
    [],
  );

  const size = useMemo(() => cbeAnswerSize(value), [value]);
  const tooLarge = size > CBE_MAX_ANSWER_BYTES;
  const nearLimit = !tooLarge && size > CBE_MAX_ANSWER_BYTES * 0.9;

  if (!parts.length) {
    return (
      <p className={cn("text-body italic text-muted-foreground", className)}>{strings.noParts}</p>
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-3", className)} data-cbe-workspace-root="">
      {(tooLarge || nearLimit) && !readOnly && (
        <Alert variant={tooLarge ? "destructive" : "default"} className={cn(!tooLarge && "border-warning-300 bg-warning-50")}>
          <WarningCircle size={16} />
          <AlertDescription className="text-body">
            {tooLarge
              ? strings.sizeTooLarge(formatKb(size), formatKb(CBE_MAX_ANSWER_BYTES))
              : strings.sizeNearLimit(formatKb(size), formatKb(CBE_MAX_ANSWER_BYTES))}
          </AlertDescription>
        </Alert>
      )}
      <Tabs value={current} onValueChange={setActiveId} className="flex w-full flex-col gap-3">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 sm:w-fit">
          {parts.map((part) => (
            <TabsTrigger key={part.id} value={part.id} className="gap-1.5 text-body">
              {part.kind === "SPREADSHEET" ? <GridFour size={16} /> : <FileText size={16} />}
              {cbePartTabLabel(part, strings)}
            </TabsTrigger>
          ))}
        </TabsList>
        {parts.map((part) => {
          const seeded = seedPartAnswer(part, value?.parts?.[part.id]);
          return (
            <TabsContent key={part.id} value={part.id} className="mt-0 flex flex-col gap-3">
              {part.promptHtml && htmlToPlainText(part.promptHtml) && (
                <DocumentView html={part.promptHtml} className="text-body" />
              )}
              {seeded.kind === "SPREADSHEET" ? (
                <SpreadsheetEditor
                  ref={sheetRef(part.id)}
                  value={seeded.sheet}
                  readOnly={readOnly}
                  height={height}
                  label={strings.partAnswer(cbePartTabLabel(part, strings))}
                  onChange={(sheet) => updatePart(part.id, { kind: "SPREADSHEET", sheet })}
                />
              ) : (
                <CbeErrorBoundary
                  label="document editor"
                  message={strings.documentLoadFailed}
                  retryLabel={strings.tryAgain}
                  onRetry={retryDocument}
                >
                  <Suspense fallback={<Skeleton className="h-48 w-full" />}>
                    <DocumentEditor
                      value={seeded.html}
                      readOnly={readOnly}
                      label={strings.partAnswer(cbePartTabLabel(part, strings))}
                      onChange={(html) => updatePart(part.id, { kind: "DOCUMENT", html })}
                    />
                  </Suspense>
                </CbeErrorBoundary>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
});

export default CbeWorkspace;
