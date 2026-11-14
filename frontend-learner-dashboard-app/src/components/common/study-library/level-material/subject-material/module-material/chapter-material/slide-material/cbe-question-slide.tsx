/**
 * LMS question slide for a Spreadsheet & Written Response (CBE_RESPONSE)
 * question: scenario + requirements + the answer workspace, an instant AI
 * check on Submit, and the result (marks, verdict, feedback, line-by-line
 * criteria, model solution) with "Try again" while AI checks remain.
 *
 * Contract: docs/CBE_RESPONSE_QUESTION.md §4, §5.2, §6 (Question slide).
 * Server: POST .../question-slide/cbe/submit, GET .../question-slide/cbe/my-attempts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";
import axios from "axios";
import {
  ArrowCounterClockwise,
  CheckCircle,
  DesktopTower,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CbeWorkspace, type CbeWorkspaceHandle } from "@/components/cbe/CbeWorkspace";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { DocumentView } from "@/components/cbe/DocumentView";
import { SheetView } from "@/components/cbe/SheetView";
import {
  CBE_MAX_ANSWER_BYTES,
  cbeAnswerSize,
  cbeTotalMarks,
  htmlToPlainText,
  isCbeAnswerEmpty,
  parseCbeConfig,
  type CbeAnswer,
  type CbeConfig,
} from "@/components/cbe/types";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { cn } from "@/lib/utils";
import {
  CBE_QUESTION_SLIDE_MY_ATTEMPTS,
  CBE_QUESTION_SLIDE_SUBMIT,
} from "@/constants/urls";
import { useResolvedPackageSessionId } from "@/hooks/study-library/useResolvedPackageSessionId";
import { refreshProgressAfterSubmit } from "@/utils/study-library/tracking/refreshProgressAfterSubmit";
import {
  cbeResultView,
  cbeSlideDraftKey,
  cbeVerdictTone,
  formatCbeMarks,
  hasCbeEvaluation,
  parseCbeSlideDraft,
  pickInitialCbeAnswer,
  withPreviousCbeResult,
  type CbeSlideAttempt,
} from "./cbe-slide-state";

export interface CbeQuestionSlideProps {
  questionData: {
    parent_rich_text?: { content?: string | null } | null;
    text_data?: { content?: string | null } | null;
    auto_evaluation_json?: string | null;
    question_type?: string;
  };
}

type Phase = "loading" | "editing" | "checking" | "result";
type Notice =
  | { kind: "noCredits" }
  | { kind: "failed"; message?: string | null }
  | { kind: "network" }
  | { kind: "noAttempts" }
  | { kind: "tooLarge" }
  | { kind: "empty" };

const DRAFT_DEBOUNCE_MS = 800;

const hasVisibleHtml = (html: string | null | undefined): boolean =>
  !!html && (htmlToPlainText(html) !== "" || /<(img|table|svg)\b/i.test(html));

const getSlideId = () => {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("slideId") || "";
};

const TONE_CLASSES = {
  success: "border-success-200 bg-success-50 text-success-700",
  warning: "border-warning-200 bg-warning-50 text-warning-700",
  danger: "border-danger-200 bg-danger-50 text-danger-600",
} as const;

/** GET my-attempts: the attempt (null = none yet), or "failed" on a real error. */
async function fetchLastAttempt(slideId: string): Promise<CbeSlideAttempt | null | "failed"> {
  try {
    const { data } = await authenticatedAxiosInstance.get<CbeSlideAttempt>(CBE_QUESTION_SLIDE_MY_ATTEMPTS, {
      params: { slide_id: slideId },
    });
    return data ?? null;
  } catch (error) {
    // 404 = never attempted; anything else (network, 5xx, auth) is a failure.
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    return "failed";
  }
}

export default function CbeQuestionSlide({ questionData }: CbeQuestionSlideProps) {
  const { t } = useTranslation("libraryCommonB");
  const cbeStrings = useLearnerCbeStrings();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { chapterId, moduleId, subjectId } = router.state.location.search as {
    chapterId?: string;
    moduleId?: string;
    subjectId?: string;
  };
  // The batch of the course being studied — never the single id cached at login.
  const resolvePackageSessionId = useResolvedPackageSessionId();
  const slideId = getSlideId();

  const config: CbeConfig | null = useMemo(
    () => parseCbeConfig(questionData?.auto_evaluation_json),
    [questionData?.auto_evaluation_json],
  );
  const totalMarks = cbeTotalMarks(config);

  const [phase, setPhase] = useState<Phase>("loading");
  const [answer, setAnswer] = useState<CbeAnswer | null>(null);
  const [attempt, setAttempt] = useState<CbeSlideAttempt | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checkingSeconds, setCheckingSeconds] = useState(0);
  /** The previous attempt could not be loaded: Submit stays off until a retry works. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const submitInFlightRef = useRef(false);
  const openedAtRef = useRef(Date.now());
  const dirtyRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const submitRowRef = useRef<HTMLDivElement>(null);
  const focusSubmitRef = useRef(false);
  const workspaceRef = useRef<CbeWorkspaceHandle>(null);

  // --- load: last attempt from the server + any newer local draft ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!slideId) {
        setPhase("editing");
        return;
      }
      const [draftResult, last] = await Promise.all([
        Preferences.get({ key: cbeSlideDraftKey(slideId) }).catch(() => null),
        fetchLastAttempt(slideId),
      ]);
      if (cancelled) return;
      const draft = draftResult ? parseCbeSlideDraft(draftResult.value) : null;
      if (last === "failed") {
        // Keep whatever the learner has (a retry must not wipe edits made meanwhile).
        if (!dirtyRef.current) setAnswer(draft?.answer ?? null);
        setLoadFailed(true);
        setPhase("editing");
        return;
      }
      setLoadFailed(false);
      setAttempt(last);
      if (last?.error_code === "NO_CREDITS") setNotice({ kind: "noCredits" });
      if (dirtyRef.current) {
        // A retry after the learner kept working: keep their answer on screen.
        setPhase("editing");
        return;
      }
      const initial = pickInitialCbeAnswer(draft, last);
      setAnswer(initial.answer);
      setPhase(hasCbeEvaluation(last) && !initial.fromDraft ? "result" : "editing");
    })();
    return () => {
      cancelled = true;
    };
  }, [slideId, loadNonce]);

  // "Try again": the result panel (and its focused button) is gone — move focus to Submit.
  useEffect(() => {
    if (phase !== "editing" || !focusSubmitRef.current) return;
    focusSubmitRef.current = false;
    submitRowRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [phase]);

  // --- draft autosave (Capacitor Preferences) so a refresh keeps the work ----
  useEffect(() => {
    if (!slideId || phase !== "editing" || !answer || !dirtyRef.current) return;
    const handle = window.setTimeout(() => {
      void Preferences.set({
        key: cbeSlideDraftKey(slideId),
        value: JSON.stringify({ answer, savedAt: Date.now() }),
      }).catch(() => {
        /* storage full / unavailable: the in-memory answer is still there */
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [answer, phase, slideId]);

  // Elapsed counter while the AI check runs (it can take up to ~a minute).
  useEffect(() => {
    if (phase !== "checking") return;
    setCheckingSeconds(0);
    const timer = window.setInterval(() => setCheckingSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const handleChange = useCallback((next: CbeAnswer) => {
    dirtyRef.current = true;
    setAnswer(next);
    setNotice((current) =>
      current && (current.kind === "empty" || current.kind === "tooLarge") ? null : current,
    );
  }, []);

  const attemptsLeft = attempt?.attempts_left;
  const outOfAttempts = typeof attemptsLeft === "number" && attemptsLeft <= 0 && !!attempt?.attempt_number;

  const refetchAttempt = useCallback(async () => {
    const last = await fetchLastAttempt(slideId);
    return last === "failed" ? null : last;
  }, [slideId]);

  const clearDraft = useCallback(() => {
    dirtyRef.current = false;
    if (slideId) void Preferences.remove({ key: cbeSlideDraftKey(slideId) }).catch(() => undefined);
  }, [slideId]);

  const handleSubmit = async () => {
    if (submitInFlightRef.current || phase === "checking" || loadFailed) return;
    // Save the cell still being typed in and the spreadsheet's debounced change,
    // and grade exactly what is on screen.
    const current = workspaceRef.current?.commit() ?? answer;
    if (!current || isCbeAnswerEmpty(current, config)) {
      setNotice({ kind: "empty" });
      return;
    }
    if (cbeAnswerSize(current) > CBE_MAX_ANSWER_BYTES) {
      setNotice({ kind: "tooLarge" });
      return;
    }
    submitInFlightRef.current = true;
    setNotice(null);
    setPhase("checking");
    try {
      const packageSessionId = await resolvePackageSessionId();
      const { data } = await authenticatedAxiosInstance.post<CbeSlideAttempt>(CBE_QUESTION_SLIDE_SUBMIT, {
        slide_id: slideId,
        chapter_id: chapterId || "",
        module_id: moduleId || "",
        subject_id: subjectId || "",
        package_session_id: packageSessionId || "",
        answer: { parts: current.parts },
        start_time_in_millis: openedAtRef.current,
      });
      clearDraft();
      setAttempt((previous) => withPreviousCbeResult(previous, data));
      if (chapterId) void refreshProgressAfterSubmit(queryClient, chapterId);
      if (hasCbeEvaluation(data)) {
        setPhase("result");
        setAnnouncement(resultAnnouncement(data, t));
        window.setTimeout(() => {
          resultRef.current?.focus({ preventScroll: true });
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      } else {
        setNotice({ kind: "failed", message: data?.message });
        setPhase("editing");
      }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 402) {
        // Saved (and the slide counted as done) but not graded.
        clearDraft();
        const body = axios.isAxiosError(error) ? (error.response?.data as CbeSlideAttempt | undefined) : undefined;
        if (body && typeof body === "object") setAttempt((previous) => withPreviousCbeResult(previous, body));
        if (chapterId) void refreshProgressAfterSubmit(queryClient, chapterId);
        setNotice({ kind: "noCredits" });
        setPhase("editing");
      } else if (status === 409) {
        const last = await refetchAttempt();
        if (last) setAttempt(last);
        setNotice({ kind: "noAttempts" });
        const lastResult = cbeResultView(last);
        if (lastResult) setAnnouncement(resultAnnouncement(lastResult, t));
        setPhase(lastResult ? "result" : "editing");
      } else {
        setNotice({ kind: "network" });
        setPhase("editing");
      }
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const handleTryAgain = () => {
    setNotice(null);
    setAnnouncement("");
    focusSubmitRef.current = true;
    setPhase("editing");
  };

  if (!config) {
    return (
      <div className="w-full bg-white p-4 sm:p-6">
        <p className="text-body text-neutral-500">{t("cbeSlide.missingConfig")}</p>
      </div>
    );
  }

  const scenarioHtml = questionData?.parent_rich_text?.content ?? "";
  const requirementHtml = questionData?.text_data?.content ?? "";
  const hasScenario = hasVisibleHtml(scenarioHtml);
  // The latest graded check, even when a later submission was refused or failed.
  const resultAttempt = cbeResultView(attempt);
  const evaluation = resultAttempt?.evaluation ?? null;

  return (
    <CbeStringsProvider value={cbeStrings}>
    <div className="flex w-full flex-col gap-5 bg-white p-4 sm:p-6" data-cbe-slide="">
      {/* One persistent live region: the result is announced when the check finishes. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold text-neutral-900">{t("questionSlide.questionLabel")}</h2>
        <Badge variant="outline" className="text-caption font-medium text-neutral-600">
          {t("cbeSlide.typeLabel")}
        </Badge>
        {totalMarks > 0 && (
          <span className="text-caption text-neutral-500">{t("cbeSlide.totalMarks", { count: totalMarks })}</span>
        )}
      </div>

      <Alert className="border-info-200 bg-info-50 md:hidden">
        <DesktopTower size={16} />
        <AlertDescription className="text-caption text-neutral-700">{t("cbeSlide.desktopNotice")}</AlertDescription>
      </Alert>

      <div className={cn("grid min-w-0 gap-5", hasScenario && "lg:grid-cols-5")}>
        {hasScenario && (
          <section
            aria-label={t("cbeSlide.scenario")}
            className="min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 p-4 lg:col-span-2 lg:max-h-reg-600 lg:overflow-auto"
          >
            <h3 className="mb-2 text-3xs font-bold uppercase tracking-wide text-neutral-500">
              {t("cbeSlide.scenario")}
            </h3>
            <div
              className="rich-text-content text-body leading-relaxed text-neutral-800"
              dangerouslySetInnerHTML={{ __html: scenarioHtml }}
            />
          </section>
        )}

        <section className={cn("flex min-w-0 flex-col gap-4", hasScenario && "lg:col-span-3")}>
          {hasVisibleHtml(requirementHtml) && (
            <div className="flex flex-col gap-1.5">
              {hasScenario && (
                <h3 className="text-3xs font-bold uppercase tracking-wide text-neutral-500">
                  {t("cbeSlide.requirements")}
                </h3>
              )}
              <div
                className="rich-text-content text-body text-neutral-800"
                dangerouslySetInnerHTML={{ __html: requirementHtml }}
              />
            </div>
          )}

          {phase === "loading" ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-9 w-64" />
              <Skeleton className="h-reg-420 w-full" />
            </div>
          ) : (
            <CbeWorkspace
              ref={workspaceRef}
              config={config}
              value={answer}
              onChange={handleChange}
              readOnly={phase !== "editing"}
              height={440}
            />
          )}

          {loadFailed && (
            <Alert variant="destructive" role="alert">
              <WarningCircle size={16} />
              <AlertDescription className="flex flex-wrap items-center gap-3 text-body">
                <span>{t("cbeSlide.loadFailed")}</span>
                <MyButton
                  buttonType="secondary"
                  scale="small"
                  layoutVariant="default"
                  onClick={() => setLoadNonce((n) => n + 1)}
                >
                  <ArrowCounterClockwise size={16} />
                  {t("cbeSlide.retryLoad")}
                </MyButton>
              </AlertDescription>
            </Alert>
          )}

          {notice && <SlideNotice notice={notice} t={t} />}

          {phase === "checking" && (
            <div className="flex items-center gap-3 rounded-xl border border-primary-100 bg-primary-50 p-4">
              <SpinnerGap size={20} className="flex-none animate-spin text-primary-500" />
              <div className="flex flex-col">
                {/* Only the static text is live; the ticking counter is not re-announced. */}
                <span role="status" aria-live="polite" className="text-body font-semibold text-neutral-900">
                  {t("cbeSlide.checking")}
                </span>
                <span className="text-caption text-neutral-600">
                  {t("cbeSlide.checkingHint")}{" "}
                  <span aria-hidden className="tabular-nums">
                    {t("cbeSlide.checkingElapsed", { seconds: checkingSeconds })}
                  </span>
                </span>
              </div>
            </div>
          )}

          {(phase === "editing" || phase === "checking") && (
            <div ref={submitRowRef} className="flex flex-wrap items-center gap-3">
              <MyButton
                buttonType="primary"
                scale="medium"
                layoutVariant="default"
                onClick={handleSubmit}
                disable={phase === "checking" || phase !== "editing" || outOfAttempts || loadFailed}
                aria-busy={phase === "checking"}
              >
                {phase === "checking" ? t("cbeSlide.checkingButton") : t("cbeSlide.submit")}
              </MyButton>
              <AttemptsLine attempt={attempt} t={t} />
              {evaluation && phase === "editing" && (
                <MyButton
                  buttonType="text"
                  scale="medium"
                  layoutVariant="default"
                  onClick={() => {
                    setPhase("result");
                    window.setTimeout(() => resultRef.current?.focus(), 50);
                  }}
                >
                  {t("cbeSlide.showLastResult")}
                </MyButton>
              )}
            </div>
          )}
        </section>
      </div>

      {phase === "result" && evaluation && (
        <div
          ref={resultRef}
          tabIndex={-1}
          aria-labelledby="cbe-slide-result-heading"
          className="flex scroll-mt-4 flex-col gap-5 rounded-xl border border-neutral-200 p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:p-5"
        >
          <ResultSummary attempt={resultAttempt} t={t} />
          {evaluation.feedback && (
            <p className="whitespace-pre-line text-body leading-relaxed text-neutral-700">{evaluation.feedback}</p>
          )}
          <CriteriaTable attempt={resultAttempt} t={t} />
          <ModelSolution attempt={resultAttempt} config={config} t={t} />
          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            {outOfAttempts ? (
              <span className="text-body text-neutral-600">{t("cbeSlide.noChecksLeft")}</span>
            ) : (
              <>
                <MyButton buttonType="secondary" scale="medium" layoutVariant="default" onClick={handleTryAgain}>
                  <ArrowCounterClockwise size={16} />
                  {t("cbeSlide.tryAgain")}
                </MyButton>
                <AttemptsLine attempt={attempt} t={t} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
    </CbeStringsProvider>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

const verdictText = (verdict: string | undefined, t: T): string | undefined => {
  const key = (verdict ?? "").toLowerCase();
  return ["correct", "partial", "wrong", "unattempted"].includes(key) ? t(`cbeSlide.verdict.${key}`) : verdict;
};

/** "Result: 13.5 / 20 marks, Partly correct" for the live region. */
function resultAnnouncement(attempt: CbeSlideAttempt | null, t: T): string {
  const evaluation = attempt?.evaluation;
  if (!evaluation) return "";
  const marks = t("cbeSlide.marksOf", {
    marks: formatCbeMarks(evaluation.marks_awarded ?? attempt?.marks ?? undefined),
    max: formatCbeMarks(evaluation.max_marks),
  });
  const verdict = verdictText(evaluation.verdict, t);
  return t("cbeSlide.resultAnnouncement", { result: verdict ? `${marks}, ${verdict}` : marks });
}

function AttemptsLine({ attempt, t }: { attempt: CbeSlideAttempt | null; t: T }) {
  if (typeof attempt?.attempts_left !== "number") return null;
  return (
    <span className="text-caption text-neutral-500">
      {t("cbeSlide.checksLeft", { count: attempt.attempts_left, max: attempt.max_attempts ?? attempt.attempts_left })}
    </span>
  );
}

function SlideNotice({ notice, t }: { notice: Notice; t: T }) {
  const destructive = notice.kind === "network" || notice.kind === "tooLarge";
  const text =
    notice.kind === "noCredits"
      ? t("cbeSlide.notice.noCredits")
      : notice.kind === "failed"
        ? t("cbeSlide.notice.failed")
        : notice.kind === "network"
          ? t("cbeSlide.notice.network")
          : notice.kind === "noAttempts"
            ? t("cbeSlide.notice.noAttempts")
            : notice.kind === "tooLarge"
              ? t("cbeSlide.notice.tooLarge")
              : t("cbeSlide.notice.empty");
  return (
    <Alert
      variant={destructive ? "destructive" : "default"}
      className={cn(!destructive && "border-warning-200 bg-warning-50")}
      role="alert"
    >
      <WarningCircle size={16} />
      <AlertDescription className="text-body">{text}</AlertDescription>
    </Alert>
  );
}

function ResultSummary({ attempt, t }: { attempt: CbeSlideAttempt | null; t: T }) {
  const evaluation = attempt?.evaluation;
  if (!evaluation) return null;
  const marks = evaluation.marks_awarded ?? attempt?.marks ?? undefined;
  const max = evaluation.max_marks;
  const tone = cbeVerdictTone(evaluation.verdict, marks ?? undefined, max);
  const verdictLabel = verdictText(evaluation.verdict, t);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <CheckCircle size={24} weight="duotone" className="flex-none text-primary-500" />
      <div className="flex flex-col">
        <h3 id="cbe-slide-result-heading" className="text-3xs font-bold uppercase tracking-wide text-neutral-500">
          {t("cbeSlide.yourResult")}
        </h3>
        <span className="text-h3 font-semibold tabular-nums text-neutral-900">
          {t("cbeSlide.marksOf", { marks: formatCbeMarks(marks), max: formatCbeMarks(max) })}
        </span>
      </div>
      {verdictLabel && (
        <Badge variant="outline" className={cn("text-caption font-semibold", TONE_CLASSES[tone])}>
          {verdictLabel}
        </Badge>
      )}
    </div>
  );
}

function CriteriaTable({ attempt, t }: { attempt: CbeSlideAttempt | null; t: T }) {
  const rows = attempt?.evaluation?.criteria_breakdown ?? [];
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-subtitle font-semibold text-neutral-900">{t("cbeSlide.breakdown")}</h3>
      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("cbeSlide.columns.line")}</TableHead>
              <TableHead className="text-end">{t("cbeSlide.columns.marks")}</TableHead>
              <TableHead>{t("cbeSlide.columns.reason")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={`${row.criteria_name ?? ""}-${i}`}>
                <TableCell className="font-medium text-neutral-900">{row.criteria_name}</TableCell>
                <TableCell className="whitespace-nowrap text-end tabular-nums text-neutral-900">
                  {formatCbeMarks(row.marks)} / {formatCbeMarks(row.max_marks)}
                </TableCell>
                <TableCell className="text-neutral-600">{row.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ModelSolution({
  attempt,
  config,
  t,
}: {
  attempt: CbeSlideAttempt | null;
  config: CbeConfig;
  t: T;
}) {
  const solutionParts = attempt?.solution?.parts ?? [];
  const byId = new Map(solutionParts.map((p) => [p.id, p]));
  const parts = config.data.parts.filter((p) => byId.get(p.id)?.solution);
  if (!parts.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-subtitle font-semibold text-neutral-900">{t("cbeSlide.modelSolution")}</h3>
      {parts.map((part) => {
        const sp = byId.get(part.id);
        const solution = sp?.solution;
        const highlight = (sp?.markingScheme ?? [])
          .map((line) => line.cellRef)
          .filter((ref): ref is string => !!ref);
        return (
          <div key={part.id} className="flex min-w-0 flex-col gap-2">
            <p className="text-caption font-semibold text-neutral-700">
              {[part.label, part.kind === "SPREADSHEET" ? t("cbeSlide.kindSpreadsheet") : t("cbeSlide.kindDocument")]
                .filter(Boolean)
                .join(" ")}
            </p>
            {solution && "sheet" in solution ? (
              <SheetView sheet={solution.sheet} highlight={highlight} />
            ) : solution && "html" in solution ? (
              <DocumentView html={solution.html} className="rounded-md border border-neutral-200 p-3" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

